"""Application activity log, read from the audit database.

Every authenticated user can see their own activity; sysadmin and admin can
see everyone's and filter by user.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from .. import config, db, security

router = APIRouter(prefix="/api/activity", tags=["activity"])


@router.get("")
def list_activity(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    username: str = "",
    action: str = "",
    q: str = "",
    user: dict = Depends(security.current_user),
):
    privileged = config.ROLE_LEVELS[user["role"]] >= config.ROLE_LEVELS["sysadmin"]
    where = []
    params: list = []
    if privileged:
        if username:
            where.append("username = ?")
            params.append(username)
    else:
        where.append("username = ?")
        params.append(user["username"])
    if action:
        where.append("action = ?")
        params.append(action)
    if q:
        where.append("(path LIKE ? OR detail LIKE ? OR action LIKE ?)")
        like = f"%{q}%"
        params.extend([like, like, like])
    clause = f"WHERE {' AND '.join(where)}" if where else ""

    with db.get("audit") as conn:
        total = conn.execute(f"SELECT COUNT(*) AS c FROM audit_log {clause}", params).fetchone()["c"]
        rows = conn.execute(
            f"SELECT id, ts, username, role, action, method, path, status, ip, duration_ms, detail "
            f"FROM audit_log {clause} ORDER BY id DESC LIMIT ? OFFSET ?",
            [*params, limit, offset],
        ).fetchall()
        actions = [
            r["action"]
            for r in conn.execute("SELECT DISTINCT action FROM audit_log ORDER BY action").fetchall()
        ]
    return {
        "total": total,
        "items": [dict(r) for r in rows],
        "actions": actions,
        "privileged": privileged,
    }
