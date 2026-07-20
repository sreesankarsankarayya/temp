from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from .. import audit, config, db, security

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginBody(BaseModel):
    username: str
    password: str


class CreateUserBody(BaseModel):
    username: str = Field(min_length=2, max_length=64, pattern=r"^[a-zA-Z0-9_.-]+$")
    password: str = Field(min_length=4, max_length=128)
    role: str
    display_name: str = ""


@router.post("/login")
def login(body: LoginBody, request: Request):
    with db.get("system") as conn:
        row = conn.execute(
            "SELECT username, password_hash, role, display_name, active FROM users WHERE username = ?",
            (body.username,),
        ).fetchone()
    ip = request.client.host if request.client else ""
    if row is None or not row["active"] or not security.verify_password(body.password, row["password_hash"]):
        audit.record("auth.login.failed", username=body.username, ip=ip, status=401)
        raise HTTPException(status_code=401, detail="Invalid username or password")
    token = security.create_token(row["username"], row["role"])
    audit.record("auth.login", username=row["username"], role=row["role"], ip=ip, status=200)
    return {
        "token": token,
        "user": {
            "username": row["username"],
            "role": row["role"],
            "display_name": row["display_name"],
        },
    }


@router.get("/me")
def me(user: dict = Depends(security.current_user)):
    return {"username": user["username"], "role": user["role"], "display_name": user["display_name"]}


@router.post("/logout")
def logout(user: dict = Depends(security.current_user)):
    # JWTs are stateless; the client drops the token. Recorded for the audit trail.
    audit.record("auth.logout", username=user["username"], role=user["role"])
    return {"ok": True}


@router.get("/users")
def list_users(user: dict = Depends(security.require_role("admin"))):
    with db.get("system") as conn:
        rows = conn.execute(
            "SELECT id, username, role, display_name, active, created_at FROM users ORDER BY id"
        ).fetchall()
    return [dict(r) for r in rows]


@router.post("/users", status_code=201)
def create_user(body: CreateUserBody, user: dict = Depends(security.require_role("admin"))):
    if body.role not in config.ROLES:
        raise HTTPException(status_code=400, detail=f"Role must be one of {config.ROLES}")
    with db.get("system") as conn:
        exists = conn.execute("SELECT 1 FROM users WHERE username = ?", (body.username,)).fetchone()
        if exists:
            raise HTTPException(status_code=409, detail="Username already exists")
        conn.execute(
            "INSERT INTO users (username, password_hash, role, display_name) VALUES (?,?,?,?)",
            (body.username, security.hash_password(body.password), body.role, body.display_name or body.username),
        )
    audit.record("user.created", username=user["username"], role=user["role"],
                 detail=f"created '{body.username}' with role {body.role}")
    return {"ok": True}


@router.patch("/users/{username}/active")
def toggle_user(username: str, active: bool, user: dict = Depends(security.require_role("admin"))):
    if username == user["username"]:
        raise HTTPException(status_code=400, detail="You cannot deactivate your own account")
    with db.get("system") as conn:
        cur = conn.execute("UPDATE users SET active = ? WHERE username = ?", (1 if active else 0, username))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="User not found")
    audit.record("user.toggled", username=user["username"], role=user["role"],
                 detail=f"set '{username}' active={active}")
    return {"ok": True}
