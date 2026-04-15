import json
from dataclasses import dataclass
from functools import lru_cache
from os import getenv
from pathlib import Path


DEFAULTS_PATH = Path(__file__).resolve().parents[2] / "shared" / "defaults.json"


@dataclass(frozen=True)
class SharedDefaults:
    source_language: str
    target_language: str
    translation_model: str
    draft_translation_model: str
    translation_batch_size: int
    translation_chunk_size: int
    supported_translation_models: tuple[str, ...]


@lru_cache(maxsize=1)
def load_defaults() -> SharedDefaults:
    data = json.loads(DEFAULTS_PATH.read_text(encoding="utf-8"))
    return SharedDefaults(
        source_language=str(data["source_language"]),
        target_language=str(data["target_language"]),
        translation_model=str(data["translation_model"]),
        draft_translation_model=str(data["draft_translation_model"]),
        translation_batch_size=int(data["translation_batch_size"]),
        translation_chunk_size=int(data["translation_chunk_size"]),
        supported_translation_models=tuple(data["supported_translation_models"]),
    )


DEFAULTS = load_defaults()


def env_text(name: str, fallback: str) -> str:
    value = getenv(name)
    if value is None:
        return fallback
    trimmed = value.strip()
    return trimmed or fallback


def env_language_code(name: str, fallback: str) -> str:
    value = env_text(name, fallback)
    return value.lower() if len(value) == 2 else value


def env_positive_int(name: str, fallback: int) -> int:
    value = getenv(name)
    if value is None:
        return fallback

    try:
        parsed = int(value.strip())
    except ValueError:
        return fallback

    return parsed if parsed > 0 else fallback
