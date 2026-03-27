import logging
import os
from pathlib import Path


DEFAULT_LOG_LEVEL = "INFO"
LOG_FORMAT = "%(asctime)s %(levelname)s [%(name)s] %(message)s"
LOG_FILE_PATH = Path("logs") / "translate_service.log"


def configure_logging(level: str | None = None) -> None:
    selected_level = (level or os.getenv("LOG_LEVEL", DEFAULT_LOG_LEVEL)).upper()
    LOG_FILE_PATH.parent.mkdir(parents=True, exist_ok=True)

    logging.basicConfig(
        level=getattr(logging, selected_level, logging.INFO),
        format=LOG_FORMAT,
        handlers=[
            logging.FileHandler(LOG_FILE_PATH, encoding="utf-8"),
        ],
        force=True,
    )
