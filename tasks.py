import os
from uuid import UUID

from celery import Celery
from dotenv import load_dotenv

from database import Job, SessionLocal
from ocr import extract_text_from_image
from translation import load_text, translate_text

load_dotenv()

DEFAULT_CELERY_BROKER_URL = "sqla+sqlite:///celery-broker.db"
DEFAULT_CELERY_RESULT_BACKEND = "db+sqlite:///celery-results.db"
CELERY_BROKER_URL = os.getenv("CELERY_BROKER_URL", DEFAULT_CELERY_BROKER_URL)
CELERY_RESULT_BACKEND = os.getenv("CELERY_RESULT_BACKEND", DEFAULT_CELERY_RESULT_BACKEND)

app = Celery(
    broker=CELERY_BROKER_URL,
    backend=CELERY_RESULT_BACKEND,
    include=["tasks"],
)


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
    source_text = text.strip() if text else load_text(source_path or "")
    translated_text = translate_text(source_text)
    _store_job_result(job_id, source_text, translated_text)
    return {"job_id": job_id, "source_text": source_text, "translated_text": translated_text}


@app.task
def extract_text(job_id: UUID, source_path: str):
    source_text = extract_text_from_image(source_path)
    _store_job_result(job_id, source_text, None)
    translate.delay(job_id=job_id, text=source_text)
    return {"job_id": job_id, "source_text": source_text}
