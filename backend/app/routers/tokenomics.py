"""Tokenomics: module-wise usage metrics, a simple least-squares forecast of
daily token consumption, and cost-reduction suggestions. Sysadmin/admin only."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from .. import db, security

router = APIRouter(prefix="/api/tokenomics", tags=["tokenomics"])

guard = Depends(security.require_role("sysadmin"))


def _linear_forecast(values: list[float], horizon: int) -> list[float]:
    """Ordinary least squares over the daily totals, projected `horizon` days."""
    n = len(values)
    if n == 0:
        return [0.0] * horizon
    if n == 1:
        return [values[0]] * horizon
    xs = range(n)
    mean_x = (n - 1) / 2
    mean_y = sum(values) / n
    denom = sum((x - mean_x) ** 2 for x in xs) or 1.0
    slope = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, values)) / denom
    intercept = mean_y - slope * mean_x
    return [max(0.0, intercept + slope * (n + i)) for i in range(horizon)]


@router.get("/summary")
def summary(user: dict = guard):
    with db.get("app") as conn:
        modules = [
            dict(r)
            for r in conn.execute(
                "SELECT module, SUM(prompt_tokens) AS prompt_tokens, "
                "SUM(completion_tokens) AS completion_tokens, "
                "SUM(prompt_tokens + completion_tokens) AS total_tokens, "
                "ROUND(SUM(cost_usd), 2) AS cost_usd "
                "FROM llm_usage GROUP BY module ORDER BY total_tokens DESC"
            ).fetchall()
        ]
        totals = dict(
            conn.execute(
                "SELECT COALESCE(SUM(prompt_tokens + completion_tokens),0) AS total_tokens, "
                "ROUND(COALESCE(SUM(cost_usd),0), 2) AS cost_usd, "
                "COUNT(DISTINCT day) AS days FROM llm_usage"
            ).fetchone()
        )
    return {"modules": modules, "totals": totals}


@router.get("/series")
def series(horizon: int = 14, user: dict = guard):
    horizon = max(1, min(horizon, 60))
    with db.get("app") as conn:
        rows = conn.execute(
            "SELECT day, SUM(prompt_tokens + completion_tokens) AS tokens "
            "FROM llm_usage GROUP BY day ORDER BY day"
        ).fetchall()
        per_module = conn.execute(
            "SELECT day, module, SUM(prompt_tokens + completion_tokens) AS tokens "
            "FROM llm_usage GROUP BY day, module ORDER BY day"
        ).fetchall()
    history = [{"day": r["day"], "tokens": r["tokens"]} for r in rows]
    forecast = _linear_forecast([r["tokens"] for r in rows], horizon)
    modules: dict[str, list] = {}
    for r in per_module:
        modules.setdefault(r["module"], []).append({"day": r["day"], "tokens": r["tokens"]})
    return {"history": history, "forecast": [round(v) for v in forecast], "per_module": modules}


@router.get("/suggestions")
def suggestions(user: dict = guard):
    with db.get("app") as conn:
        top = conn.execute(
            "SELECT module, SUM(prompt_tokens + completion_tokens) AS t "
            "FROM llm_usage GROUP BY module ORDER BY t DESC LIMIT 1"
        ).fetchone()
        ratio = conn.execute(
            "SELECT CAST(SUM(prompt_tokens) AS REAL) / MAX(SUM(completion_tokens), 1) AS r FROM llm_usage"
        ).fetchone()
    top_module = top["module"] if top else "n/a"
    prompt_ratio = round(ratio["r"], 2) if ratio and ratio["r"] else 0

    operational = [
        {"title": f"Cache frequent responses in '{top_module}'",
         "detail": f"'{top_module}' is the heaviest module. Add response caching / semantic caching for repeated "
                   "queries to cut duplicate completions."},
        {"title": "Route simple traffic to smaller models",
         "detail": "Classify requests and send short/simple ones to a mini/local model (Ollama, vLLM); reserve "
                   "frontier models for complex tasks."},
        {"title": "Enable provider-side prompt caching",
         "detail": "OpenAI/OpenRouter support cached prompt pricing; keep system prompts stable so cache hits "
                   "reduce billed input tokens."},
        {"title": "Set per-module budgets and alerts",
         "detail": "Enforce daily token budgets per module with alerting so anomalies are caught the day they start."},
    ]
    development = [
        {"title": "Trim prompt templates",
         "detail": f"Prompt/completion ratio is {prompt_ratio}:1. Audit system prompts and few-shot examples; "
                   "move static instructions to shorter, cached system prompts."},
        {"title": "Constrain output length",
         "detail": "Use max_tokens, structured outputs (JSON schema) and stop sequences to avoid paying for "
                   "verbose completions."},
        {"title": "Batch embeddings and use retrieval",
         "detail": "Batch embedding calls and retrieve only top-k relevant chunks instead of stuffing whole "
                   "documents into context."},
        {"title": "Add regression tests for token use",
         "detail": "Track tokens per feature in CI so a prompt change that doubles consumption fails the build "
                   "instead of the budget."},
    ]
    return {"operational": operational, "development": development}
