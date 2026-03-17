import os
import sys
from uuid import UUID

from huey import SqliteHuey
from sqlalchemy import select

from utils.database import Job
from utils.database import SessionLocal
from utils.database import initialize_database
from utils.ocr import extract_text_from_image
from utils.translation import load_text
from utils.translation import translate_text

QUEUE_NAME = os.getenv("JOB_QUEUE_NAME", "translate-service")

huey = SqliteHuey(
    QUEUE_NAME,
    filename=os.getenv("JOB_QUEUE_SQLITE_FILENAME", "huey.db"),
)


def enqueue_job(job_id: UUID) -> None:
    process_job(str(job_id))


@huey.task()
def process_job(job_id: str) -> None:
    parsed_job_id = UUID(job_id)

    with SessionLocal.begin() as session:
        job = session.get(Job, parsed_job_id)
        if job is None or job.status == "done":
            return

        job.mark_running()
        source_type = job.source_type
        source_path = job.source_path

    try:
        source_text = (
            extract_text_from_image(source_path)
            if source_type == "image"
            else load_text(source_path)
        )
        translated_text = translate_text(source_text)
    except Exception as exc:
        with SessionLocal.begin() as session:
            job = session.get(Job, parsed_job_id)
            if job is not None:
                job.mark_failed(str(exc))
        raise

    with SessionLocal.begin() as session:
        job = session.get(Job, parsed_job_id)
        if job is not None:
            job.mark_done(source_text, translated_text)


def requeue_running_jobs() -> None:
    with SessionLocal.begin() as session:
        running_jobs = list(session.scalars(select(Job).where(Job.status == "running")))
        if not running_jobs:
            return

        running_job_ids = [job.id for job in running_jobs]
        for job in running_jobs:
            job.mark_queued()

    for job_id in running_job_ids:
        enqueue_job(job_id)


def main() -> None:
    initialize_database()
    requeue_running_jobs()
    os.execvp(
        sys.executable,
        [
            sys.executable,
            "-m",
            "huey.bin.huey_consumer",
            "worker.huey",
            "-k",
            "thread",
            "-w",
            os.getenv("HUEY_WORKERS", "1"),
        ],
    )


if __name__ == "__main__":
    main()
