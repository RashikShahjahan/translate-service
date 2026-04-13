from gc import collect
from os import getenv
from dotenv import load_dotenv
from utils.logging_utils import get_logger


load_dotenv()

logger = get_logger(__name__)

TRANSLATION_MODEL = getenv(
    "TRANSLATION_MODEL",
    "mlx-community/translategemma-12b-it-4bit",
)
DRAFT_TRANSLATION_MODEL = getenv(
    "DRAFT_TRANSLATION_MODEL",
    "mlx-community/translategemma-4b-it-4bit",
)
SOURCE_LANG_CODE = getenv("SOURCE_LANG_CODE", "bn").strip() or "bn"
TARGET_LANG_CODE = getenv("TARGET_LANG_CODE", "en").strip() or "en"
_MODEL = None
_TOKENIZER = None
_DRAFT_MODEL = None


def get_model_and_tokenizer():
    global _MODEL, _TOKENIZER
    if _MODEL is None or _TOKENIZER is None:
        from mlx_lm import load

        _MODEL, _TOKENIZER = load(TRANSLATION_MODEL)
        _TOKENIZER.add_eos_token("<end_of_turn>")
    return _MODEL, _TOKENIZER


def get_draft_model():
    global _DRAFT_MODEL
    if _DRAFT_MODEL is None:
        from mlx_lm import load

        _DRAFT_MODEL, _ = load(DRAFT_TRANSLATION_MODEL)
    return _DRAFT_MODEL


def unload_model():
    global _MODEL, _TOKENIZER, _DRAFT_MODEL
    from mlx.core import clear_cache

    _MODEL = None
    _TOKENIZER = None
    _DRAFT_MODEL = None
    collect()
    clear_cache()
    logger.info("Unloaded translation and draft models and cleared MLX cache")


def prepare_prompt(
    text: str,
    source_lang_code: str | None = None,
    target_lang_code: str | None = None,
) -> str | list[int]:
    _, tokenizer = get_model_and_tokenizer()
    source_text = text.strip()
    normalized_source_lang_code = (source_lang_code or SOURCE_LANG_CODE).strip()
    normalized_target_lang_code = (target_lang_code or TARGET_LANG_CODE).strip()
    messages = [
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "source_lang_code": normalized_source_lang_code,
                    "target_lang_code": normalized_target_lang_code,
                    "text": source_text,
                }
            ],
        },
    ]
    return tokenizer.apply_chat_template(messages, add_generation_prompt=True)


def translate_batch(
    batch: list[str],
    *,
    source_lang_code: str | None = None,
    target_lang_code: str | None = None,
) -> list[str]:
    from mlx_lm import batch_generate

    model, tokenizer = get_model_and_tokenizer()
    prompts = [
        prepare_prompt(
            text,
            source_lang_code=source_lang_code,
            target_lang_code=target_lang_code,
        )
        for text in batch
    ]

    response = batch_generate(
        model,
        tokenizer,
        prompts=prompts,
        max_tokens=2048,
    )

    return response.texts


def translate(
    text: str,
    *,
    source_lang_code: str | None = None,
    target_lang_code: str | None = None,
) -> str:
    from mlx_lm import generate

    model, tokenizer = get_model_and_tokenizer()
    prompt = prepare_prompt(
        text,
        source_lang_code=source_lang_code,
        target_lang_code=target_lang_code,
    )
    response = generate(
        model,
        tokenizer,
        prompt=prompt,
        max_tokens=2048,
    )

    return response


def translate_speculative_decoding(
    text: str,
    num_draft_tokens: int = 2,
    *,
    source_lang_code: str | None = None,
    target_lang_code: str | None = None,
) -> str:
    from mlx_lm import generate

    model, tokenizer = get_model_and_tokenizer()
    draft_model = get_draft_model()
    prompt = prepare_prompt(
        text,
        source_lang_code=source_lang_code,
        target_lang_code=target_lang_code,
    )
    response = generate(
        model,
        tokenizer,
        prompt=prompt,
        max_tokens=2048,
        draft_model=draft_model,
        num_draft_tokens=num_draft_tokens,
    )

    return response
