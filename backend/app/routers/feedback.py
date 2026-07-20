"""Report a bug / request a feature. Any authenticated user can submit;
only admins can browse and triage the full list (via Settings)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import audit, db, security

router = APIRouter(prefix="/api/feedback", tags=["feedback"])

STATUSES = ("open", "triaged", "in-progress", "done", "rejected")


class FeedbackBody(BaseModel):
    kind: str  # bug | feature
    priority: str  # low | medium | high | critical
    details: str = Field(min_length=5, max_length=8000)


class StatusBody(BaseModel):
    status: str


@router.post("", status_code=201)
def submit(body: FeedbackBody, user: dict = Depends(security.current_user)):
    if body.kind not in ("bug", "feature"):
        raise HTTPException(status_code=400, detail="kind must be 'bug' or 'feature'")
    if body.priority not in ("low", "medium", "high", "critical"):
        raise HTTPException(status_code=400, detail="priority must be low|medium|high|critical")
    with db.get("app") as conn:
        cur = conn.execute(
            "INSERT INTO feedback (username, kind, priority, details) VALUES (?,?,?,?)",
            (user["username"], body.kind, body.priority, body.details),
        )
        fid = cur.lastrowid
    audit.record("feedback.submitted", username=user["username"], role=user["role"],
                 detail=f"id={fid} kind={body.kind} priority={body.priority}")
    return {"ok": True, "id": fid}


@router.get("/mine")
def mine(user: dict = Depends(security.current_user)):
    with db.get("app") as conn:
        rows = conn.execute(
            "SELECT * FROM feedback WHERE username = ? ORDER BY id DESC", (user["username"],)
        ).fetchall()
    return [dict(r) for r in rows]


@router.get("")
def list_all(user: dict = Depends(security.require_role("admin"))):
    with db.get("app") as conn:
        rows = conn.execute("SELECT * FROM feedback ORDER BY id DESC").fetchall()
    return [dict(r) for r in rows]


@router.patch("/{feedback_id}/status")
def set_status(feedback_id: int, body: StatusBody, user: dict = Depends(security.require_role("admin"))):
    if body.status not in STATUSES:
        raise HTTPException(status_code=400, detail=f"status must be one of {STATUSES}")
    with db.get("app") as conn:
        cur = conn.execute("UPDATE feedback SET status = ? WHERE id = ?", (body.status, feedback_id))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Feedback not found")
    audit.record("feedback.status", username=user["username"], role=user["role"],
                 detail=f"id={feedback_id} status={body.status}")
    return {"ok": True}
