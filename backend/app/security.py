"""Password hashing, JWT sessions, role checks and at-rest encryption."""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import time

import jwt
from cryptography.fernet import Fernet, InvalidToken
from fastapi import Depends, HTTPException, Request

from . import config, db

_PBKDF2_ITERATIONS = 240_000


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _PBKDF2_ITERATIONS)
    return f"pbkdf2${_PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, iterations, salt_hex, digest_hex = stored.split("$")
        digest = hashlib.pbkdf2_hmac(
            "sha256", password.encode(), bytes.fromhex(salt_hex), int(iterations)
        )
        return hmac.compare_digest(digest.hex(), digest_hex)
    except (ValueError, TypeError):
        return False


def _fernet() -> Fernet:
    key = base64.urlsafe_b64encode(hashlib.sha256(config.SECRET_KEY.encode()).digest())
    return Fernet(key)


def encrypt_secret(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode()


def decrypt_secret(value: str) -> str:
    try:
        return _fernet().decrypt(value.encode()).decode()
    except InvalidToken:
        return ""


def create_token(username: str, role: str) -> str:
    now = int(time.time())
    payload = {
        "sub": username,
        "role": role,
        "iat": now,
        "exp": now + config.TOKEN_TTL_MINUTES * 60,
    }
    return jwt.encode(payload, config.SECRET_KEY, algorithm="HS256")


def decode_token(token: str) -> dict:
    return jwt.decode(token, config.SECRET_KEY, algorithms=["HS256"])


def current_user(request: Request) -> dict:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = decode_token(auth.removeprefix("Bearer "))
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    with db.get("system") as conn:
        row = conn.execute(
            "SELECT username, role, display_name, active FROM users WHERE username = ?",
            (payload["sub"],),
        ).fetchone()
    if row is None or not row["active"]:
        raise HTTPException(status_code=401, detail="Account disabled or removed")
    user = dict(row)
    request.state.user = user
    return user


def require_role(minimum: str):
    """Dependency enforcing the role hierarchy user < operator < sysadmin < admin."""

    def checker(user: dict = Depends(current_user)) -> dict:
        if config.ROLE_LEVELS[user["role"]] < config.ROLE_LEVELS[minimum]:
            raise HTTPException(status_code=403, detail=f"Requires {minimum} role or higher")
        return user

    return checker


def require_exact_role(*roles: str):
    def checker(user: dict = Depends(current_user)) -> dict:
        if user["role"] not in roles:
            raise HTTPException(status_code=403, detail=f"Requires one of: {', '.join(roles)}")
        return user

    return checker
