import os
import time
from pathlib import Path

from apscheduler.schedulers.background import BackgroundScheduler
from persistqueue import SQLiteAckQueue
from persistqueue.exceptions import Empty

from utils.ocr import extract_text_from_image
from utils.translation import TARGET_LANG_CODE, translate_batch

OCR_INTERVAL_SECONDS = 60
TRANSLATION_RUN_AT = os.getenv("TRANSLATION_RUN_AT", "00:00")


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
    translate_q = SQLiteAckQueue("translate")

    leased_items = []
    input_texts = []

    for _ in range(translation_batch_size):
        try:
            item = translate_q.get(block=False, raw=True)
        except Empty:
            break

        leased_items.append(item)
        text_path = Path(item["data"])
        input_texts.append(text_path.read_text(encoding="utf-8"))

    if not input_texts:
        return

    results = translate_batch(input_texts)

    for leased, translated_text in zip(leased_items, results):
        text_path = Path(leased["data"])
        output_path = text_path.with_name(f"{text_path.stem}_{TARGET_LANG_CODE}.txt")
        output_path.write_text(translated_text.strip(), encoding="utf-8")
        translate_q.ack(leased)

    translate_q.clear_acked_data()


def start_ocr():
    ocr_q = SQLiteAckQueue("ocr")
    try:
        queue_entry = ocr_q.get(block=False, raw=True)
    except Empty:
        return

    image_path = Path(queue_entry["data"])
    text = extract_text_from_image(str(image_path))
    text_path = image_path.with_suffix(".txt")
    text_path.write_text(text, encoding="utf-8")
    ocr_q.ack(queue_entry)

    translate_q = SQLiteAckQueue("translate")
    translate_q.put(text_path)


if __name__ == "__main__":
    try:
        translation_hour, translation_minute = parse_daily_time(TRANSLATION_RUN_AT)
    except ValueError as exc:
        raise ValueError(
            "TRANSLATION_RUN_AT must use 24-hour HH:MM format, for example 00:00 or 23:30."
        ) from exc

    try:
        translation_batch_size = parse_positive_int(os.getenv("TRANSLATION_BATCH_SIZE", "16"))
    except ValueError as exc:
        raise ValueError("TRANSLATION_BATCH_SIZE must be a positive integer.") from exc

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
