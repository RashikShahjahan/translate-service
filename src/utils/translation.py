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
SOURCE_LANG_CODE = getenv("SOURCE_LANG_CODE", "bn").strip() or "bn"
TARGET_LANG_CODE = getenv("TARGET_LANG_CODE", "en").strip() or "en"
_MODEL = None
_TOKENIZER = None


def get_model_and_tokenizer():
    global _MODEL, _TOKENIZER
    if _MODEL is None or _TOKENIZER is None:
        from mlx_lm import load

        _MODEL, _TOKENIZER = load(
            TRANSLATION_MODEL        )
        _TOKENIZER.add_eos_token("<end_of_turn>")
    return _MODEL, _TOKENIZER



def unload_model():
    global _MODEL, _TOKENIZER
    from mlx.core import clear_cache

    _MODEL = None
    _TOKENIZER = None
    collect()
    clear_cache()
    logger.info("Unloaded translation model and cleared MLX cache")


def prepare_prompt(text: str) -> str:
    _, tokenizer = get_model_and_tokenizer()
    source_text = text.strip()
    messages = [
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "source_lang_code": SOURCE_LANG_CODE,
                    "target_lang_code": TARGET_LANG_CODE,
                    "text": source_text,
                }
            ],
        },
    ]
    return tokenizer.apply_chat_template(messages, add_generation_prompt=True)



def translate_batch(batch: list[str]) -> list[str]:
    from mlx_lm import batch_generate

    model, tokenizer = get_model_and_tokenizer()
    prompts = [prepare_prompt(text) for text in batch]

    response = batch_generate(
        model,
        tokenizer,
        prompts=prompts,
        max_tokens=2048,
    )


    return response.texts
