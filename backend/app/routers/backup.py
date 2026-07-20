"""Backup & DR (sysadmin+): on-demand and scheduled full/incremental backups
of the three SQLite databases, plus restore. Backups are consistent snapshots
taken with SQLite's online backup API."""
from __future__ import annotations

import json
import logging
import shutil
import sqlite3
import tarfile
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import audit, config, db, security

router = APIRouter(prefix="/api/backup", tags=["backup"])
log = logging.getLogger("app.backup")

guard = Depends(security.require_role("sysadmin"))

_DBS = {"app": config.APP_DB_PATH, "system": config.SYSTEM_DB_PATH, "audit": config.AUDIT_DB_PATH}
_DEFAULT_SCHEDULE = {"enabled": False, "full_every_hours": 24, "incremental_every_hours": 4}


class ScheduleBody(BaseModel):
    enabled: bool
    full_every_hours: int = 24
    incremental_every_hours: int = 4


def _snapshot_db(src: Path, dest: Path) -> None:
    """Consistent online copy of a live SQLite database."""
    source = sqlite3.connect(str(src))
    target = sqlite3.connect(str(dest))
    try:
        source.backup(target)
    finally:
        target.close()
        source.close()


def _last_backup_time(conn) -> str | None:
    row = conn.execute("SELECT MAX(created_at) AS t FROM backups WHERE kind IN ('full','incremental')").fetchone()
    return row["t"]


def create_backup(kind: str, created_by: str, note: str = "") -> dict:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    workdir = config.BACKUP_DIR / f"{stamp}-{kind}"
    workdir.mkdir(parents=True, exist_ok=True)

    with db.get("system") as conn:
        since = _last_backup_time(conn) if kind == "incremental" else None

    copied = []
    for name, path in _DBS.items():
        if not path.exists():
            continue
        if since is not None:
            # incremental: only snapshot DBs modified since the last backup
            mtime = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
            if mtime <= since:
                continue
        _snapshot_db(path, workdir / path.name)
        copied.append(name)

    archive = config.BACKUP_DIR / f"{stamp}-{kind}.tar.gz"
    with tarfile.open(archive, "w:gz") as tar:
        for f in workdir.iterdir():
            tar.add(f, arcname=f.name)
    shutil.rmtree(workdir)

    size = archive.stat().st_size
    with db.get("system") as conn:
        cur = conn.execute(
            "INSERT INTO backups (kind, path, size_bytes, note, created_by) VALUES (?,?,?,?,?)",
            (kind, str(archive), size, note or f"contains: {', '.join(copied) or 'nothing new'}", created_by),
        )
        backup_id = cur.lastrowid
    audit.record("backup.created", username=created_by, detail=f"id={backup_id} kind={kind} size={size}")
    return {"id": backup_id, "kind": kind, "path": str(archive), "size_bytes": size, "contains": copied}


@router.get("")
def list_backups(user: dict = guard):
    with db.get("system") as conn:
        rows = conn.execute("SELECT * FROM backups ORDER BY id DESC").fetchall()
    return [dict(r) for r in rows]


@router.post("/full", status_code=201)
def full_backup(user: dict = guard):
    return create_backup("full", user["username"])


@router.post("/incremental", status_code=201)
def incremental_backup(user: dict = guard):
    return create_backup("incremental", user["username"])


@router.post("/{backup_id}/restore")
def restore(backup_id: int, user: dict = guard):
    with db.get("system") as conn:
        row = conn.execute("SELECT * FROM backups WHERE id = ?", (backup_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Backup not found")
    archive = Path(row["path"])
    if not archive.exists():
        raise HTTPException(status_code=410, detail="Backup archive is missing on disk")

    # safety net: snapshot current state before restoring over it
    create_backup("restore-point", user["username"], note=f"auto snapshot before restoring backup {backup_id}")

    staging = config.BACKUP_DIR / f".restore-{backup_id}"
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)
    with tarfile.open(archive, "r:gz") as tar:
        tar.extractall(staging, filter="data")

    db.close_all()
    restored = []
    try:
        for path in _DBS.values():
            candidate = staging / path.name
            if candidate.exists():
                for suffix in ("", "-wal", "-shm"):
                    stale = Path(str(path) + suffix)
                    if suffix and stale.exists():
                        stale.unlink()
                shutil.copy2(candidate, path)
                restored.append(path.name)
    finally:
        shutil.rmtree(staging, ignore_errors=True)

    audit.record("backup.restored", username=user["username"], role=user["role"],
                 detail=f"id={backup_id} restored={restored}")
    return {"ok": True, "restored": restored}


@router.get("/schedule")
def get_schedule(user: dict = guard):
    with db.get("system") as conn:
        row = conn.execute("SELECT value FROM app_settings WHERE key = 'backup_schedule'").fetchone()
    return json.loads(row["value"]) if row else dict(_DEFAULT_SCHEDULE)


@router.put("/schedule")
def set_schedule(body: ScheduleBody, user: dict = guard):
    value = body.model_dump()
    value["full_every_hours"] = max(1, value["full_every_hours"])
    value["incremental_every_hours"] = max(1, value["incremental_every_hours"])
    with db.get("system") as conn:
        conn.execute(
            "INSERT INTO app_settings (key, value) VALUES ('backup_schedule', ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (json.dumps(value),),
        )
    audit.record("backup.schedule", username=user["username"], role=user["role"], detail=json.dumps(value))
    return value


def _scheduler_loop(stop: threading.Event) -> None:
    last_full = 0.0
    last_incr = 0.0
    while not stop.wait(60):
        try:
            with db.get("system") as conn:
                row = conn.execute("SELECT value FROM app_settings WHERE key = 'backup_schedule'").fetchone()
            sched = json.loads(row["value"]) if row else _DEFAULT_SCHEDULE
            if not sched.get("enabled"):
                continue
            now = time.monotonic()
            if now - last_full >= sched["full_every_hours"] * 3600:
                create_backup("full", "scheduler")
                last_full = now
                last_incr = now
            elif now - last_incr >= sched["incremental_every_hours"] * 3600:
                create_backup("incremental", "scheduler")
                last_incr = now
        except Exception:
            log.exception("scheduled backup failed")


_stop_event: threading.Event | None = None


def start_scheduler() -> None:
    global _stop_event
    _stop_event = threading.Event()
    threading.Thread(target=_scheduler_loop, args=(_stop_event,), daemon=True, name="backup-scheduler").start()


def stop_scheduler() -> None:
    if _stop_event is not None:
        _stop_event.set()
