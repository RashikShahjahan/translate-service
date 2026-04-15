from gc import collect
from os import getenv

from dotenv import load_dotenv
from pysbd import Segmenter
from utils.logging_utils import get_logger


load_dotenv()

logger = get_logger(__name__)
_SENTENCE_SEGMENTER = None

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


def get_sentence_segmenter():
    global _SENTENCE_SEGMENTER
    if _SENTENCE_SEGMENTER is None:
        _SENTENCE_SEGMENTER = Segmenter(language="en", clean=False)
    return _SENTENCE_SEGMENTER


def unload_model():
    global _MODEL, _TOKENIZER, _DRAFT_MODEL, _SENTENCE_SEGMENTER
    from mlx.core import clear_cache

    _MODEL = None
    _TOKENIZER = None
    _DRAFT_MODEL = None
    _SENTENCE_SEGMENTER = None
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


def split_text_into_chunks(text: str, chunk_size: int) -> list[str]:
    normalized_text = text.strip()
    if not normalized_text:
        return []

    _, tokenizer = get_model_and_tokenizer()
    tokens = tokenizer.encode(normalized_text)
    if len(tokens) <= chunk_size:
        return [normalized_text]

    sentences = [
        sentence.strip()
        for sentence in get_sentence_segmenter().segment(normalized_text)
        if sentence.strip()
    ]

    if not sentences:
        sentences = [normalized_text]

    chunks: list[str] = []
    current_chunk_sentences: list[str] = []
    current_chunk_token_count = 0

    for sentence in sentences:
        sentence_token_count = len(tokenizer.encode(sentence))
        if sentence_token_count > chunk_size:
            if current_chunk_sentences:
                chunks.append(" ".join(current_chunk_sentences).strip())
                current_chunk_sentences = []
                current_chunk_token_count = 0

            sentence_tokens = tokenizer.encode(sentence)
            for start in range(0, len(sentence_tokens), chunk_size):
                chunk_text = tokenizer.decode(
                    sentence_tokens[start : start + chunk_size]
                ).strip()
                if chunk_text:
                    chunks.append(chunk_text)
            continue

        next_chunk_token_count = current_chunk_token_count + sentence_token_count
        if current_chunk_sentences and next_chunk_token_count > chunk_size:
            chunks.append(" ".join(current_chunk_sentences).strip())
            current_chunk_sentences = [sentence]
            current_chunk_token_count = sentence_token_count
            continue

        current_chunk_sentences.append(sentence)
        current_chunk_token_count = next_chunk_token_count

    if current_chunk_sentences:
        chunks.append(" ".join(current_chunk_sentences).strip())

    return chunks


def translate_document_text(
    text: str,
    *,
    chunk_size: int,
    source_lang_code: str | None = None,
    target_lang_code: str | None = None,
) -> str:
    chunks = split_text_into_chunks(text, chunk_size)
    if not chunks:
        return ""

    translated_chunks = translate_batch(
        chunks,
        source_lang_code=source_lang_code,
        target_lang_code=target_lang_code,
    )

    return "".join(translated_chunks).strip()


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
