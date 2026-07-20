"""Central configuration for the application.

Everything is driven by environment variables with sane bootstrap defaults.
APP_NAME defaults to the name of the project folder, which also drives the
SQLite file names and the localtunnel subdomain.
"""
from __future__ import annotations

import os
from pathlib import Path

# repo root = two levels above this file (backend/app/config.py)
PROJECT_ROOT = Path(__file__).resolve().parents[2]

APP_NAME = os.environ.get("APP_NAME") or PROJECT_ROOT.name
ENV = os.environ.get("ENV", "None")

DATA_DIR = Path(os.environ.get("DATA_DIR", str(PROJECT_ROOT / "data")))
LOG_DIR = DATA_DIR / "logs"
BACKUP_DIR = DATA_DIR / "backups"
UPGRADE_DIR = DATA_DIR / "upgrades"
RESTORE_POINT_DIR = DATA_DIR / "restore-points"

APP_DB_PATH = DATA_DIR / f"{APP_NAME}.db"
SYSTEM_DB_PATH = DATA_DIR / f"{APP_NAME}-system.db"
AUDIT_DB_PATH = DATA_DIR / f"{APP_NAME}-audit.log"  # SQLite file, .log by spec

SECRET_KEY = os.environ.get("SECRET_KEY", "change-me-please-32-chars-minimum")
UPGRADE_SIGNING_KEY = os.environ.get("UPGRADE_SIGNING_KEY", "change-me-upgrade-signing-key")
TOKEN_TTL_MINUTES = int(os.environ.get("TOKEN_TTL_MINUTES", "480"))

ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin")

ROLES = ("user", "operator", "sysadmin", "admin")
ROLE_LEVELS = {role: i + 1 for i, role in enumerate(ROLES)}

def version() -> str:
    try:
        return (PROJECT_ROOT / "VERSION").read_text().strip()
    except OSError:
        return "0.0.0"

def changelog() -> str:
    try:
        return (PROJECT_ROOT / "CHANGELOG.md").read_text()
    except OSError:
        return "# Changelog\n\n_No changelog available._"

def is_production() -> bool:
    return ENV.upper() in ("PRD", "NONE", "")

def tunnel_subdomain() -> str:
    env_part = "" if is_production() else f"-{ENV.lower()}"
    return f"{APP_NAME}{env_part}".lower().replace("_", "-").replace(" ", "-")

def ensure_dirs() -> None:
    for d in (DATA_DIR, LOG_DIR, BACKUP_DIR, UPGRADE_DIR, RESTORE_POINT_DIR):
        d.mkdir(parents=True, exist_ok=True)
