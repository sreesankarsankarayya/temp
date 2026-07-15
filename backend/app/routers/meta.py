from __future__ import annotations

from fastapi import APIRouter

from .. import config

router = APIRouter(prefix="/api/meta", tags=["meta"])


@router.get("")
def meta():
    return {
        "app_name": config.APP_NAME,
        "version": config.version(),
        "env": config.ENV,
        "is_production": config.is_production(),
        "tunnel_url": f"https://{config.tunnel_subdomain()}.loca.lt",
        "roles": list(config.ROLES),
    }


@router.get("/changelog")
def changelog():
    return {"version": config.version(), "changelog": config.changelog()}
