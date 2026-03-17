import os
from pathlib import Path

from dotenv import load_dotenv
from mlx_lm import generate, load

load_dotenv()

TRANSLATION_MODEL = os.getenv(
    "TRANSLATION_MODEL",
    "mlx-community/translategemma-12b-it-4bit",
)


def load_text(source_path: str) -> str:
    text = Path(source_path).read_text(encoding="utf-8").strip()
    if not text:
        raise ValueError(f"No text found in {source_path}.")
    return text


def translate_text(text: str) -> str:
    source_text = text.strip()
    model, tokenizer = load(TRANSLATION_MODEL)
    messages = [
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "source_lang_code": "bn",
                    "target_lang_code": "en",
                    "text": source_text,
                }
            ],
        },
    ]
    prompt = tokenizer.apply_chat_template(messages)
    return generate(
        model,
        tokenizer,
        prompt=prompt,
        max_tokens=2048,
        verbose=False,
    ).strip()
