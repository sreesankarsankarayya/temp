"""Self-upgrade (sysadmin+): upload a signed bundle, verify its signature,
take an automatic restore point, stage the upgrade, and roll back if needed.

Bundles are .tar.gz archives signed with HMAC-SHA256 over the raw bytes using
UPGRADE_SIGNING_KEY (hex signature uploaded alongside the bundle). To sign:

    python -c "import hmac,hashlib,sys; print(hmac.new(sys.argv[1].encode(),
        open(sys.argv[2],'rb').read(), hashlib.sha256).hexdigest())" "$UPGRADE_SIGNING_KEY" bundle.tar.gz
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import tarfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from .. import audit, config, db, security
from .backup import create_backup

router = APIRouter(prefix="/api/upgrade", tags=["upgrade"])
log = logging.getLogger("app.upgrade")

guard = Depends(security.require_role("sysadmin"))

MAX_BUNDLE_BYTES = 200 * 1024 * 1024


@router.get("")
def history(user: dict = guard):
    with db.get("system") as conn:
        rows = conn.execute("SELECT * FROM upgrades ORDER BY id DESC").fetchall()
    return [dict(r) for r in rows]


@router.post("/upload", status_code=201)
async def upload(
    bundle: UploadFile = File(...),
    signature: str = Form(...),
    version: str = Form(""),
    user: dict = guard,
):
    data = await bundle.read()
    if len(data) > MAX_BUNDLE_BYTES:
        raise HTTPException(status_code=413, detail="Bundle exceeds 200 MB limit")
    if not data:
        raise HTTPException(status_code=400, detail="Empty bundle")

    expected = hmac.new(config.UPGRADE_SIGNING_KEY.encode(), data, hashlib.sha256).hexdigest()
    signature_ok = hmac.compare_digest(expected, signature.strip().lower())
    if not signature_ok:
        audit.record("upgrade.rejected", username=user["username"], role=user["role"],
                     detail=f"bad signature for {bundle.filename}")
        raise HTTPException(status_code=400, detail="Signature verification failed — bundle rejected")

    sha256 = hashlib.sha256(data).hexdigest()
    filename = Path(bundle.filename or "bundle.tar.gz").name
    with db.get("system") as conn:
        cur = conn.execute(
            "INSERT INTO upgrades (filename, version, sha256, signature_ok, status, uploaded_by) "
            "VALUES (?,?,?,1,'verified',?)",
            (filename, version, sha256, user["username"]),
        )
        upgrade_id = cur.lastrowid
    dest = config.UPGRADE_DIR / f"{upgrade_id}-{filename}"
    dest.write_bytes(data)
    with db.get("system") as conn:
        conn.execute("UPDATE upgrades SET filename = ? WHERE id = ?", (str(dest.name), upgrade_id))

    audit.record("upgrade.uploaded", username=user["username"], role=user["role"],
                 detail=f"id={upgrade_id} sha256={sha256[:16]}…")
    return {"id": upgrade_id, "sha256": sha256, "signature_ok": True, "status": "verified"}


@router.post("/{upgrade_id}/apply")
def apply(upgrade_id: int, user: dict = guard):
    with db.get("system") as conn:
        row = conn.execute("SELECT * FROM upgrades WHERE id = ?", (upgrade_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Upgrade not found")
    if not row["signature_ok"]:
        raise HTTPException(status_code=400, detail="Unsigned bundle cannot be applied")
    bundle_path = config.UPGRADE_DIR / row["filename"]
    if not bundle_path.exists():
        raise HTTPException(status_code=410, detail="Bundle file missing on disk")

    # 1. restore point: DB snapshot before any change
    rp = create_backup("restore-point", user["username"], note=f"auto restore point before upgrade {upgrade_id}")

    # 2. stage the bundle; the entrypoint applies staged upgrades on restart
    staging = config.UPGRADE_DIR / "staged"
    staging.mkdir(parents=True, exist_ok=True)
    try:
        with tarfile.open(bundle_path, "r:gz") as tar:
            tar.extractall(staging / str(upgrade_id), filter="data")
    except tarfile.TarError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid bundle archive: {exc}")

    with db.get("system") as conn:
        conn.execute(
            "UPDATE upgrades SET status = 'staged', restore_point_id = ? WHERE id = ?",
            (rp["id"], upgrade_id),
        )
    audit.record("upgrade.staged", username=user["username"], role=user["role"],
                 detail=f"id={upgrade_id} restore_point={rp['id']}")
    return {
        "ok": True,
        "status": "staged",
        "restore_point_id": rp["id"],
        "message": "Upgrade staged with a restore point. Restart the container to activate it; "
                   "use rollback to revert.",
    }


@router.post("/{upgrade_id}/rollback")
def rollback(upgrade_id: int, user: dict = guard):
    with db.get("system") as conn:
        row = conn.execute("SELECT * FROM upgrades WHERE id = ?", (upgrade_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Upgrade not found")

    staged = config.UPGRADE_DIR / "staged" / str(upgrade_id)
    if staged.exists():
        import shutil

        shutil.rmtree(staged)
    with db.get("system") as conn:
        conn.execute("UPDATE upgrades SET status = 'rolled-back' WHERE id = ?", (upgrade_id,))
    audit.record("upgrade.rolled_back", username=user["username"], role=user["role"],
                 detail=f"id={upgrade_id} restore_point={row['restore_point_id']}")
    return {
        "ok": True,
        "status": "rolled-back",
        "restore_point_id": row["restore_point_id"],
        "message": "Staged upgrade removed. Restore the linked restore point from Backup & DR "
                   "if data changes must also be reverted.",
    }
