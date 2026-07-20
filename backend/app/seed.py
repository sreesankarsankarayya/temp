"""First-boot seeding: initial admin account and demo usage data so the
Tokenomics page has something meaningful to show in the bootstrap."""
from __future__ import annotations

import logging
import math
from datetime import date, timedelta

from . import audit, config, db, security

log = logging.getLogger("app.seed")

USAGE_MODULES = ("chat", "rag-search", "summarize", "agents", "embeddings")


def seed_admin() -> None:
    with db.get("system") as conn:
        count = conn.execute("SELECT COUNT(*) AS c FROM users").fetchone()["c"]
        if count:
            return
        conn.execute(
            "INSERT INTO users (username, password_hash, role, display_name) VALUES (?,?,?,?)",
            (
                config.ADMIN_USERNAME,
                security.hash_password(config.ADMIN_PASSWORD),
                "admin",
                "Administrator",
            ),
        )
    audit.record("user.seeded", username="system", detail=f"initial admin '{config.ADMIN_USERNAME}' created")
    log.warning(
        "Seeded initial admin user '%s' with the configured ADMIN_PASSWORD — change it.",
        config.ADMIN_USERNAME,
    )


def seed_usage(days: int = 60) -> None:
    """Deterministic synthetic LLM usage (last N days) for forecast demos."""
    with db.get("app") as conn:
        count = conn.execute("SELECT COUNT(*) AS c FROM llm_usage").fetchone()["c"]
        if count:
            return
        today = date.today()
        rows = []
        for offset in range(days, 0, -1):
            day = (today - timedelta(days=offset)).isoformat()
            for m_idx, module in enumerate(USAGE_MODULES):
                base = 12_000 + m_idx * 4_000
                growth = (days - offset) * (80 + m_idx * 35)
                weekly = 1 + 0.25 * math.sin((offset + m_idx * 2) * 2 * math.pi / 7)
                jitter = 1 + 0.12 * math.sin(offset * 1.7 + m_idx * 5)
                prompt = int((base + growth) * weekly * jitter)
                completion = int(prompt * (0.35 + 0.05 * m_idx))
                cost = round((prompt * 0.15 + completion * 0.60) / 1_000_000, 4)
                rows.append((day, module, "openai", "gpt-4o-mini", prompt, completion, cost))
        conn.executemany(
            "INSERT INTO llm_usage (day, module, provider, model, prompt_tokens, completion_tokens, cost_usd) "
            "VALUES (?,?,?,?,?,?,?)",
            rows,
        )
    log.info("Seeded %d days of demo LLM usage for tokenomics.", days)


def seed_all() -> None:
    seed_admin()
    seed_usage()
