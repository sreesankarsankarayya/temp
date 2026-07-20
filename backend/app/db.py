"""SQLite persistence.

Three separate databases live on the mounted DATA_DIR volume:
  <app>.db         application data (feedback, LLM usage)
  <app>-system.db  system data (users, LLM keys, settings, backups, upgrades)
  <app>-audit.log  append-only audit trail (SQLite format, .log name by spec)
"""
from __future__ import annotations

import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path

from . import config

_locks = {"app": threading.Lock(), "system": threading.Lock(), "audit": threading.Lock()}
_paths = {"app": config.APP_DB_PATH, "system": config.SYSTEM_DB_PATH, "audit": config.AUDIT_DB_PATH}
_conns: dict[str, sqlite3.Connection] = {}


def _connect(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


@contextmanager
def get(name: str):
    """Serialized access to one of the three databases."""
    with _locks[name]:
        conn = _conns.get(name)
        if conn is None:
            conn = _conns[name] = _connect(_paths[name])
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise


def close_all() -> None:
    for name, conn in list(_conns.items()):
        try:
            conn.close()
        finally:
            _conns.pop(name, None)


SYSTEM_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user','operator','sysadmin','admin')),
    display_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS llm_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    label TEXT NOT NULL,
    base_url TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    api_key_enc TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS backups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL CHECK (kind IN ('full','incremental','restore-point')),
    path TEXT NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    note TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS upgrades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    version TEXT NOT NULL DEFAULT '',
    sha256 TEXT NOT NULL,
    signature_ok INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'uploaded',
    restore_point_id INTEGER,
    uploaded_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""

APP_SCHEMA = """
CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('bug','feature')),
    priority TEXT NOT NULL CHECK (priority IN ('low','medium','high','critical')),
    details TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS llm_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    day TEXT NOT NULL,
    module TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_usage_day ON llm_usage(day);
"""

AUDIT_SCHEMA = """
CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL DEFAULT (datetime('now')),
    username TEXT NOT NULL DEFAULT 'anonymous',
    role TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL,
    method TEXT NOT NULL DEFAULT '',
    path TEXT NOT NULL DEFAULT '',
    status INTEGER NOT NULL DEFAULT 0,
    ip TEXT NOT NULL DEFAULT '',
    duration_ms REAL NOT NULL DEFAULT 0,
    detail TEXT NOT NULL DEFAULT ''
);
"""


def init_all() -> None:
    config.ensure_dirs()
    with get("system") as conn:
        conn.executescript(SYSTEM_SCHEMA)
    with get("app") as conn:
        conn.executescript(APP_SCHEMA)
    with get("audit") as conn:
        conn.executescript(AUDIT_SCHEMA)
