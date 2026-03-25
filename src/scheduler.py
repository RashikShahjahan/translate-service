import os
import time

from apscheduler.schedulers.background import BackgroundScheduler
from dotenv import load_dotenv
from storage import (
    complete_ocr,
    complete_translation,
    fail_document,
    lease_document_for_ocr,
    lease_documents_for_translation,
)
from utils.ocr import extract_text_from_image_bytes
from utils.translation import translate_batch
load_dotenv()

OCR_INTERVAL_SECONDS = 60
TRANSLATION_RUN_AT = os.getenv("TRANSLATION_RUN_AT", "00:00")
TRANSLATION_BATCH_SIZE = os.getenv("TRANSLATION_BATCH_SIZE", "4")


def parse_daily_time(value: str) -> tuple[int, int]:
    hour_text, minute_text = value.split(":", maxsplit=1)
    hour = int(hour_text)
    minute = int(minute_text)
    if hour not in range(24) or minute not in range(60):
        raise ValueError
    return hour, minute


def parse_positive_int(value: str) -> int:
    parsed = int(value)
    if parsed < 1:
        raise ValueError
    return parsed


def start_translation(translation_batch_size: int):
    leased_items = lease_documents_for_translation(translation_batch_size)
    input_texts = [str(item["input_text"]).strip() for item in leased_items]
    if not input_texts:
        return

    try:
        results = translate_batch(input_texts)
        for leased, translated_text in zip(leased_items, results):
            complete_translation(int(leased["id"]), translated_text.strip())
    except Exception as exc:
        for leased in leased_items:
            fail_document(int(leased["id"]), str(exc))
        raise


def start_ocr():
    queue_entry = lease_document_for_ocr()
    if queue_entry is None:
        return

    try:
        text = extract_text_from_image_bytes(
            bytes(queue_entry["source_bytes"]),
            str(queue_entry["mime_type"]),
        )
        complete_ocr(int(queue_entry["id"]), text)
    except Exception as exc:
        fail_document(int(queue_entry["id"]), str(exc))
        raise


if __name__ == "__main__":
    try:
        translation_hour, translation_minute = parse_daily_time(TRANSLATION_RUN_AT)
    except ValueError as exc:
        raise ValueError(
            "TRANSLATION_RUN_AT must use 24-hour HH:MM format, for example 00:00 or 23:30."
        ) from exc

    translation_batch_size = parse_positive_int(TRANSLATION_BATCH_SIZE)
 

    scheduler = BackgroundScheduler()
    scheduler.add_job(start_ocr, "interval", seconds=OCR_INTERVAL_SECONDS)
    scheduler.add_job(
        start_translation,
        "cron",
        hour=translation_hour,
        minute=translation_minute,
        kwargs={"translation_batch_size": translation_batch_size},
    )

    scheduler.start()
    print("Press Ctrl+{} to exit".format("Break" if os.name == "nt" else "C"))

    try:
        while True:
            time.sleep(2)
    except (KeyboardInterrupt, SystemExit):
        scheduler.shutdown()
