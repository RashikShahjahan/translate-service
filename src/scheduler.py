import os
import time
from pathlib import Path

from apscheduler.schedulers.background import BackgroundScheduler
from persistqueue import SQLiteAckQueue
from persistqueue.exceptions import Empty

from utils.ocr import extract_text_from_image
from utils.translation import translate_batch

TRANSLATION_BATCH_SIZE = 16

def start_translation():
    translate_q = SQLiteAckQueue("translate")

    leased_items = []
    input_texts = []

    for _ in range(TRANSLATION_BATCH_SIZE):
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
        output_path = text_path.with_name(f"{text_path.stem}_en.txt")
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
    scheduler = BackgroundScheduler()
    scheduler.add_job(start_ocr, "interval", seconds=60)
    scheduler.add_job(start_translation, "interval", seconds=60)

    scheduler.start()
    print("Press Ctrl+{} to exit".format("Break" if os.name == "nt" else "C"))

    try:
        while True:
            time.sleep(2)
    except (KeyboardInterrupt, SystemExit):
        scheduler.shutdown()
