from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import audit, config, db, seed
from .logging_setup import setup_logging
from .routers import activity, auth, backup, feedback, help as help_router, llm_keys, meta, tokenomics, upgrade

log = logging.getLogger("app")

FRONTEND_DIST = config.PROJECT_ROOT / "frontend" / "dist"


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    db.init_all()
    seed.seed_all()
    backup.start_scheduler()
    audit.record("system.startup", username="system",
                 detail=f"{config.APP_NAME} v{config.version()} env={config.ENV}")
    log.info("%s v%s started (env=%s, data=%s)",
             config.APP_NAME, config.version(), config.ENV, config.DATA_DIR)
    yield
    backup.stop_scheduler()
    audit.record("system.shutdown", username="system")
    db.close_all()


app = FastAPI(title=config.APP_NAME, version=config.version(), lifespan=lifespan)
app.add_middleware(audit.AuditMiddleware)

for router in (auth.router, meta.router, llm_keys.router, feedback.router,
               tokenomics.router, backup.router, upgrade.router, activity.router,
               help_router.router):
    app.include_router(router)


@app.get("/api/health")
def health():
    return {"ok": True, "app": config.APP_NAME, "version": config.version()}


if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        candidate = (FRONTEND_DIST / full_path).resolve()
        if full_path and candidate.is_relative_to(FRONTEND_DIST.resolve()) and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST / "index.html")
else:

    @app.get("/", include_in_schema=False)
    def no_frontend():
        return JSONResponse({"detail": "Frontend not built. Run `npm run build` in frontend/."})
