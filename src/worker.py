from os import getenv, name
from time import sleep, monotonic

from psutil import virtual_memory
from dotenv import load_dotenv
from utils.storage import (
    complete_ocr,
    complete_translation,
    lease_document_for_ocr,
    lease_documents_for_translation,
    recover_stale_leases,
    requeue_document,
)
from utils.logging_utils import configure_logging, get_logger

load_dotenv()

logger = get_logger(__name__)

IDLE_SLEEP_SECONDS = float(getenv("IDLE_SLEEP_SECONDS", "60"))
TRANSLATION_BATCH_SIZE = int(getenv("TRANSLATION_BATCH_SIZE", "4"))
TRANSLATION_MIN_AVAILABLE_MEMORY_MB = float(
    getenv("TRANSLATION_MIN_AVAILABLE_MEMORY_MB", "8192")
)
LEASE_TIMEOUT_SECONDS = float(getenv("LEASE_TIMEOUT_SECONDS", "900"))
TRANSLATION_IDLE_UNLOAD_SECONDS = float(
    getenv("TRANSLATION_IDLE_UNLOAD_SECONDS", "15")
)
RETRY_BACKOFF_BASE_SECONDS = float(getenv("RETRY_BACKOFF_BASE_SECONDS", "30"))
RETRY_BACKOFF_MAX_SECONDS = float(getenv("RETRY_BACKOFF_MAX_SECONDS", "300"))


def current_available_physical_memory_mb() -> float:
    return float(virtual_memory().available) / (1024 * 1024)


def translation_memory_gate_open() -> bool:
    available_memory_mb = current_available_physical_memory_mb()
    physical_gate_open = available_memory_mb >= TRANSLATION_MIN_AVAILABLE_MEMORY_MB
    logger.info(
        "Translation memory gate %s: available=%.2fMB threshold=%.2fMB",
        "open" if physical_gate_open else "closed",
        available_memory_mb,
        TRANSLATION_MIN_AVAILABLE_MEMORY_MB,
    )
    gate_open = physical_gate_open
    return gate_open


def retry_backoff_seconds(retry_count: int) -> float:
    exponent = max(retry_count - 1, 0)
    delay_seconds = RETRY_BACKOFF_BASE_SECONDS * (2**exponent)
    return min(delay_seconds, RETRY_BACKOFF_MAX_SECONDS)


def start_translation(translation_batch_size: int):
    if not translation_memory_gate_open():
        return False

    leased_items = lease_documents_for_translation(translation_batch_size)
    input_texts = [str(item["input_text"]).strip() for item in leased_items]
    if not input_texts:
        return False

    document_ids = [int(item["id"]) for item in leased_items]
    logger.info(
        "Starting translation for %d document(s): %s",
        len(document_ids),
        document_ids,
    )

    try:
        from utils.translation import translate_batch

        results = translate_batch(input_texts)
        for leased, translated_text in zip(leased_items, results):
            complete_translation(int(leased["id"]), translated_text.strip())
            logger.info("Completed translation for document %s", leased["id"])
    except Exception as exc:
        for leased in leased_items:
            next_retry_count = int(leased.get("retry_count", 0)) + 1
            backoff_seconds = retry_backoff_seconds(next_retry_count)
            requeue_document(int(leased["id"]), str(exc), backoff_seconds)
            logger.warning(
                "Requeued translation document %s after failure; retry_count=%d backoff=%.2fs",
                leased["id"],
                next_retry_count,
                backoff_seconds,
            )
        logger.exception("Translation failed for document(s): %s", document_ids)
        return False
    logger.info("Finished translation batch for %d document(s)", len(document_ids))
    return True


def start_ocr():

    queue_entry = lease_document_for_ocr()
    if queue_entry is None:
        return False

    document_id = int(queue_entry["id"])
    logger.info("Starting OCR for document %s", document_id)

    try:
        from utils.ocr import extract_text_from_image_bytes

        text = extract_text_from_image_bytes(
            bytes(queue_entry["source_bytes"]),
            str(queue_entry["mime_type"]),
        )
        complete_ocr(document_id, text)
    except Exception as exc:
        next_retry_count = int(queue_entry.get("retry_count", 0)) + 1
        backoff_seconds = retry_backoff_seconds(next_retry_count)
        requeue_document(document_id, str(exc), backoff_seconds)
        logger.warning(
            "Requeued OCR document %s after failure; retry_count=%d backoff=%.2fs",
            document_id,
            next_retry_count,
            backoff_seconds,
        )
        logger.exception("OCR failed for document %s", document_id)
        return False
    logger.info("Completed OCR for document %s", document_id)
    return True


def process_once(translation_batch_size: int) -> tuple[bool, bool]:
    recovered_count = recover_stale_leases(LEASE_TIMEOUT_SECONDS)
    if recovered_count:
        logger.info("Recovered %d stale lease(s)", recovered_count)

    processed_ocr = start_ocr()
    processed_translation = start_translation(translation_batch_size)
    return bool(recovered_count) or processed_ocr or processed_translation, processed_translation


if __name__ == "__main__":
    configure_logging()
    logger.info(
        "Worker starting. Press Ctrl+%s to exit",
        "Break" if name == "nt" else "C",
    )
    last_translation_at: float | None = None

    try:
        while True:
            processed_work, processed_translation = process_once(TRANSLATION_BATCH_SIZE)
            if processed_translation:
                last_translation_at = monotonic()
            else:
               if last_translation_at is None:
                    continue
               idle_for_seconds = monotonic() - last_translation_at
               if idle_for_seconds >= TRANSLATION_IDLE_UNLOAD_SECONDS:
                    from utils.translation import unload_model

                    unload_model()
            if processed_work:
                continue
            else:
                sleep(IDLE_SLEEP_SECONDS)
    except (KeyboardInterrupt, SystemExit):
        logger.info("Worker stopped")
    except Exception:
        logger.exception("Worker stopped due to an unrecoverable error")
        raise
