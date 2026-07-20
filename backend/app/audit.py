"""Audit trail: every API request and notable action is written to the
dedicated SQLite audit database (<app-name>-audit.log)."""
from __future__ import annotations

import logging
import time

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from . import db

log = logging.getLogger("app.audit")


def record(
    action: str,
    username: str = "anonymous",
    role: str = "",
    method: str = "",
    path: str = "",
    status: int = 0,
    ip: str = "",
    duration_ms: float = 0.0,
    detail: str = "",
) -> None:
    try:
        with db.get("audit") as conn:
            conn.execute(
                "INSERT INTO audit_log (username, role, action, method, path, status, ip, duration_ms, detail) "
                "VALUES (?,?,?,?,?,?,?,?,?)",
                (username, role, action, method, path, status, ip, round(duration_ms, 2), detail),
            )
    except Exception:  # auditing must never take the app down
        log.exception("failed to write audit record")


class AuditMiddleware(BaseHTTPMiddleware):
    """Logs every /api request with the acting user, outcome and latency."""

    async def dispatch(self, request: Request, call_next):
        start = time.perf_counter()
        response = await call_next(request)
        if request.url.path.startswith("/api"):
            user = getattr(request.state, "user", None) or {}
            record(
                action="http.request",
                username=user.get("username", "anonymous"),
                role=user.get("role", ""),
                method=request.method,
                path=request.url.path,
                status=response.status_code,
                ip=request.client.host if request.client else "",
                duration_ms=(time.perf_counter() - start) * 1000,
            )
        return response
