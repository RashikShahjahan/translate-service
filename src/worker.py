import os
import time

from dotenv import load_dotenv
from utils.storage import (
    complete_ocr,
    complete_translation,
    fail_document,
    lease_document_for_ocr,
    lease_documents_for_translation,
)
from utils.ocr import extract_text_from_image_bytes
from utils.translation import translate_batch

load_dotenv()

IDLE_SLEEP_SECONDS = float(os.getenv("IDLE_SLEEP_SECONDS", "2"))
TRANSLATION_BATCH_SIZE = int(os.getenv("TRANSLATION_BATCH_SIZE", "4"))

def start_translation(translation_batch_size: int):
    leased_items = lease_documents_for_translation(translation_batch_size)
    input_texts = [str(item["input_text"]).strip() for item in leased_items]
    if not input_texts:
        return False

    try:
        results = translate_batch(input_texts)
        for leased, translated_text in zip(leased_items, results):
            complete_translation(int(leased["id"]), translated_text.strip())
    except Exception as exc:
        for leased in leased_items:
            fail_document(int(leased["id"]), str(exc))
        raise
    return True


def start_ocr():
    queue_entry = lease_document_for_ocr()
    if queue_entry is None:
        return False

    try:
        text = extract_text_from_image_bytes(
            bytes(queue_entry["source_bytes"]),
            str(queue_entry["mime_type"]),
        )
        complete_ocr(int(queue_entry["id"]), text)
    except Exception as exc:
        fail_document(int(queue_entry["id"]), str(exc))
        raise
    return True


def process_once(translation_batch_size: int) -> bool:
    processed_ocr = start_ocr()
    processed_translation = start_translation(translation_batch_size)
    return processed_ocr or processed_translation


if __name__ == "__main__":
    print("Press Ctrl+{} to exit".format("Break" if os.name == "nt" else "C"))

    try:
        while True:
            if not process_once(TRANSLATION_BATCH_SIZE):
                time.sleep(IDLE_SLEEP_SECONDS)
    except (KeyboardInterrupt, SystemExit):
        pass
