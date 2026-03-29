from logging import basicConfig, getLogger, INFO, FileHandler
from os import getenv
from pathlib import Path


DEFAULT_LOG_LEVEL = "INFO"
LOG_FORMAT = "%(asctime)s %(levelname)s [%(name)s] %(message)s"
LOG_FILE_PATH = Path("logs") / "translate_service.log"


def configure_logging(level: str | None = None) -> None:
    selected_level = (level or getenv("LOG_LEVEL", DEFAULT_LOG_LEVEL)).upper()
    LOG_FILE_PATH.parent.mkdir(parents=True, exist_ok=True)

    basicConfig(
        level=getattr(INFO, selected_level, INFO),
        format=LOG_FORMAT,
        handlers=[
            FileHandler(LOG_FILE_PATH, encoding="utf-8"),
        ],
        force=True,
    )


def get_logger(name: str) -> getLogger.__class__:
    if not getLogger().handlers:
        configure_logging()
    return getLogger(name)