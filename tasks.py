import os
from pathlib import Path
from uuid import UUID

from celery import Celery
from dotenv import load_dotenv
from google import genai
from google.genai import types
from database import Job, SessionLocal
from mlx_lm import generate, load


load_dotenv()

DEFAULT_CELERY_BROKER_URL = "sqla+sqlite:///celery-broker.db"
DEFAULT_CELERY_RESULT_BACKEND = "db+sqlite:///celery-results.db"
CELERY_BROKER_URL = os.getenv("CELERY_BROKER_URL", DEFAULT_CELERY_BROKER_URL)
CELERY_RESULT_BACKEND = os.getenv("CELERY_RESULT_BACKEND", DEFAULT_CELERY_RESULT_BACKEND)
OCR_MODEL =  os.getenv("OCR_MODEL",  "gemini-3.1-flash-lite-preview")
TRANSLATION_MODEL = os.getenv("TRANSLATION_MODEL", "mlx-community/translategemma-12b-it-4bit")


app = Celery(
    broker=CELERY_BROKER_URL,
    backend=CELERY_RESULT_BACKEND,
    include=["tasks"],
)


def _load_text(source_path: str) -> str:
    text = Path(source_path).read_text(encoding="utf-8").strip()
    if not text:
        raise ValueError(f"No text found in {source_path}.")
    return text


def _extract_text_from_image(source_path: str) -> str:
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not set.")

    image_path = Path(source_path)
    image_bytes = image_path.read_bytes()
    mime_type = f"image/{image_path.suffix.lower().lstrip('.') or 'jpeg'}"
    prompt = (
        "Extract the Bengali text from this image. "
        "Respond with only the extracted text with no additional commentary."
    )

    client = genai.Client(api_key=api_key)
    response = client.models.generate_content(
        model=OCR_MODEL,
        contents=[
            types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
            prompt,
        ],
    )

    text = (response.text or "").strip()
    if not text:
        raise ValueError(f"No text extracted from {source_path}.")
    return text


def _translate_text(text: str) -> str:
    source_text = text.strip()
    model, tokenizer = load(TRANSLATION_MODEL)
    messages = [
        {"role": "user", "content":           [{
              "type": "text",
              "source_lang_code": "bn",
              "target_lang_code": "en",
              "text": source_text
          }]},
    ]
    prompt = tokenizer.apply_chat_template(messages)
    return generate(
        model,
        tokenizer,
        prompt=prompt,
        max_tokens=2048,
        verbose=False,
    ).strip()


def _store_job_result(job_id: UUID, source_text: str, translated_text: str | None) -> None:
    with SessionLocal() as session:
        job = session.get(Job, job_id)

        job.result = {
            "source_text": source_text,
            "translated_text": translated_text,
        }
        session.commit()


@app.task
def translate(job_id: UUID, source_path: str | None = None, text: str | None = None):
    source_text = text.strip() if text else _load_text(source_path or "")
    translated_text = _translate_text(source_text)
    _store_job_result(job_id, source_text, translated_text)
    return {"job_id": job_id, "source_text": source_text, "translated_text": translated_text}


@app.task
def extract_text(job_id: UUID, source_path: str):
    source_text = _extract_text_from_image(source_path)
    _store_job_result(job_id, source_text, None)
    translate.delay(job_id=job_id, text=source_text)
    return {"job_id": job_id, "source_text": source_text}
