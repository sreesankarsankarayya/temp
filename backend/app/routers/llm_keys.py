"""Secure LLM provider key vault. Keys are Fernet-encrypted at rest and only
ever returned masked. All roles can view configured providers; operator and
above can add or remove keys."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import audit, db, security

router = APIRouter(prefix="/api/llm-keys", tags=["llm-keys"])

PROVIDERS = {
    "openai": {"label": "OpenAI", "base_url": "https://api.openai.com/v1",
               "models": ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "o3", "o4-mini"]},
    "nvidia": {"label": "NVIDIA NIM", "base_url": "https://integrate.api.nvidia.com/v1",
               "models": ["meta/llama-3.3-70b-instruct", "nvidia/nemotron-4-340b-instruct"]},
    "grok": {"label": "Grok (xAI)", "base_url": "https://api.x.ai/v1",
             "models": ["grok-3", "grok-3-mini", "grok-2-vision"]},
    "openrouter": {"label": "OpenRouter", "base_url": "https://openrouter.ai/api/v1",
                   "models": ["anthropic/claude-sonnet-4", "openai/gpt-4o", "google/gemini-2.5-pro"]},
    "vllm": {"label": "vLLM (self-hosted)", "base_url": "http://localhost:8001/v1", "models": []},
    "ollama": {"label": "Ollama", "base_url": "http://localhost:11434/v1",
               "models": ["llama3.3", "qwen2.5", "mistral"]},
    "local": {"label": "Local deployment (e.g. LongCat)", "base_url": "http://localhost:9000/v1",
              "models": ["longcat-chat"]},
}


class KeyBody(BaseModel):
    provider: str
    label: str = Field(min_length=1, max_length=100)
    base_url: str = ""
    model: str = ""
    api_key: str = Field(min_length=1, max_length=4096)


def _mask(secret: str) -> str:
    if len(secret) <= 8:
        return "•" * len(secret)
    return f"{secret[:4]}{'•' * 8}{secret[-4:]}"


@router.get("/providers")
def providers(user: dict = Depends(security.current_user)):
    return PROVIDERS


@router.get("")
def list_keys(user: dict = Depends(security.current_user)):
    with db.get("system") as conn:
        rows = conn.execute(
            "SELECT id, provider, label, base_url, model, api_key_enc, created_by, created_at "
            "FROM llm_keys ORDER BY id"
        ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["api_key_masked"] = _mask(security.decrypt_secret(d.pop("api_key_enc")))
        out.append(d)
    return out


@router.post("", status_code=201)
def add_key(body: KeyBody, user: dict = Depends(security.require_role("operator"))):
    if body.provider not in PROVIDERS:
        raise HTTPException(status_code=400, detail=f"Unknown provider. Use one of {list(PROVIDERS)}")
    base_url = body.base_url or PROVIDERS[body.provider]["base_url"]
    with db.get("system") as conn:
        conn.execute(
            "INSERT INTO llm_keys (provider, label, base_url, model, api_key_enc, created_by) "
            "VALUES (?,?,?,?,?,?)",
            (body.provider, body.label, base_url, body.model,
             security.encrypt_secret(body.api_key), user["username"]),
        )
    audit.record("llm_key.added", username=user["username"], role=user["role"],
                 detail=f"provider={body.provider} label={body.label}")
    return {"ok": True}


@router.delete("/{key_id}")
def delete_key(key_id: int, user: dict = Depends(security.require_role("operator"))):
    with db.get("system") as conn:
        cur = conn.execute("DELETE FROM llm_keys WHERE id = ?", (key_id,))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Key not found")
    audit.record("llm_key.deleted", username=user["username"], role=user["role"], detail=f"id={key_id}")
    return {"ok": True}
