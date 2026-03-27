import logging
import os


DEFAULT_LOG_LEVEL = "INFO"
LOG_FORMAT = "%(asctime)s %(levelname)s [%(name)s] %(message)s"


def configure_logging(level: str | None = None) -> None:
    selected_level = (level or os.getenv("LOG_LEVEL", DEFAULT_LOG_LEVEL)).upper()

    logging.basicConfig(
        level=getattr(logging, selected_level, logging.INFO),
        format=LOG_FORMAT,
        force=True,
    )
