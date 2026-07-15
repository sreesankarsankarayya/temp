"""Skill.md editor: the shipped default lives in the app bundle, the active
copy on the data volume. Any change (inline edit or upload) is applied only
through a diff + explicit confirmation, and the default can be restored."""
from __future__ import annotations

import difflib
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field

from .. import audit, config, security

router = APIRouter(prefix="/api/skill", tags=["skill"])

DEFAULT_PATH = Path(__file__).resolve().parents[1] / "resources" / "skill.md"
MAX_BYTES = 512 * 1024


class ContentBody(BaseModel):
    content: str = Field(max_length=MAX_BYTES)


def _active_path() -> Path:
    return config.DATA_DIR / "skill.md"


def _default_content() -> str:
    return DEFAULT_PATH.read_text()


def _active_content() -> str:
    path = _active_path()
    if not path.exists():
        config.ensure_dirs()
        path.write_text(_default_content())
    return path.read_text()


def _state(content: str) -> dict:
    path = _active_path()
    return {
        "content": content,
        "is_default": content == _default_content(),
        "updated_at": datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
        .strftime("%Y-%m-%d %H:%M:%S UTC")
        if path.exists()
        else None,
    }


@router.get("")
def get_skill(user: dict = Depends(security.current_user)):
    return _state(_active_content())


@router.get("/default", response_class=PlainTextResponse)
def download_default(user: dict = Depends(security.current_user)):
    return PlainTextResponse(
        _default_content(),
        media_type="text/markdown",
        headers={"Content-Disposition": 'attachment; filename="skill-default.md"'},
    )


@router.post("/diff")
def diff(body: ContentBody, user: dict = Depends(security.require_role("operator"))):
    current = _active_content()
    if body.content == current:
        return {"identical": True, "diff": [], "added": 0, "removed": 0}
    lines = list(
        difflib.unified_diff(
            current.splitlines(),
            body.content.splitlines(),
            fromfile="skill.md (current)",
            tofile="skill.md (proposed)",
            lineterm="",
        )
    )
    added = sum(1 for l in lines if l.startswith("+") and not l.startswith("+++"))
    removed = sum(1 for l in lines if l.startswith("-") and not l.startswith("---"))
    return {"identical": False, "diff": lines, "added": added, "removed": removed}


@router.put("")
def apply_skill(body: ContentBody, user: dict = Depends(security.require_role("operator"))):
    if not body.content.strip():
        raise HTTPException(status_code=400, detail="skill.md cannot be empty")
    config.ensure_dirs()
    _active_path().write_text(body.content)
    audit.record("skill.updated", username=user["username"], role=user["role"],
                 detail=f"{len(body.content)} bytes")
    return _state(body.content)


@router.post("/restore")
def restore_default(user: dict = Depends(security.require_role("operator"))):
    config.ensure_dirs()
    content = _default_content()
    _active_path().write_text(content)
    audit.record("skill.restored", username=user["username"], role=user["role"],
                 detail="restored to shipped default")
    return _state(content)
