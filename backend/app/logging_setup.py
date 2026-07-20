"""Application logs for traceability: rotating file in DATA_DIR/logs plus console."""
from __future__ import annotations

import logging
from logging.handlers import RotatingFileHandler

from . import config


def setup_logging() -> None:
    config.ensure_dirs()
    fmt = logging.Formatter(
        "%(asctime)s %(levelname)-7s [%(name)s] %(message)s", datefmt="%Y-%m-%d %H:%M:%S"
    )
    root = logging.getLogger()
    root.setLevel(logging.INFO)

    file_handler = RotatingFileHandler(
        config.LOG_DIR / f"{config.APP_NAME}.log", maxBytes=5_000_000, backupCount=5
    )
    file_handler.setFormatter(fmt)

    console = logging.StreamHandler()
    console.setFormatter(fmt)

    root.handlers = [file_handler, console]
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
