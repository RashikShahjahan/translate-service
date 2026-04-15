from os import getenv, name
from time import sleep, monotonic
from collections import defaultdict

from dotenv import load_dotenv
from utils.storage import (
    complete_ocr,
    complete_translation,
    get_translation_batch_size,
    get_translation_chunk_size,
    lease_document_for_ocr,
    lease_documents_for_translation,
    recover_stale_leases,
    requeue_document,
)
from utils.logging_utils import configure_logging, get_logger

load_dotenv()

logger = get_logger(__name__)

IDLE_SLEEP_SECONDS = float(getenv("IDLE_SLEEP_SECONDS", "60"))
LEASE_TIMEOUT_SECONDS = float(getenv("LEASE_TIMEOUT_SECONDS", "900"))
TRANSLATION_IDLE_UNLOAD_SECONDS = float(getenv("TRANSLATION_IDLE_UNLOAD_SECONDS", "15"))
RETRY_BACKOFF_BASE_SECONDS = float(getenv("RETRY_BACKOFF_BASE_SECONDS", "30"))
RETRY_BACKOFF_MAX_SECONDS = float(getenv("RETRY_BACKOFF_MAX_SECONDS", "300"))


def retry_backoff_seconds(retry_count: int) -> float:
    exponent = max(retry_count - 1, 0)
    delay_seconds = RETRY_BACKOFF_BASE_SECONDS * (2**exponent)
    return min(delay_seconds, RETRY_BACKOFF_MAX_SECONDS)


def start_translation(translation_batch_size: int, translation_chunk_size: int):
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
        from utils.translation import translate_document_text

        groups: dict[tuple[str, str], list[dict]] = defaultdict(list)
        completed_translations: list[tuple[int, str]] = []
        for leased in leased_items:
            groups[
                (
                    str(leased["source_language"]).strip(),
                    str(leased["target_language"]).strip(),
                )
            ].append(leased)

        for (source_language, target_language), group_items in groups.items():
            for leased in group_items:
                completed_translations.append(
                    (
                        int(leased["id"]),
                        translate_document_text(
                            str(leased["input_text"]).strip(),
                            chunk_size=translation_chunk_size,
                            source_lang_code=source_language,
                            target_lang_code=target_language,
                        ).strip(),
                    )
                )

        for document_id, translated_text in completed_translations:
            complete_translation(document_id, translated_text)
            logger.info("Completed translation for document %s", document_id)
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


def process_once(
    translation_batch_size: int, translation_chunk_size: int
) -> tuple[bool, bool]:
    recovered_count = recover_stale_leases(LEASE_TIMEOUT_SECONDS)
    if recovered_count:
        logger.info("Recovered %d stale lease(s)", recovered_count)

    processed_ocr = start_ocr()
    processed_translation = start_translation(
        translation_batch_size, translation_chunk_size
    )
    return bool(
        recovered_count
    ) or processed_ocr or processed_translation, processed_translation


if __name__ == "__main__":
    configure_logging()
    logger.info(
        "Worker starting. Press Ctrl+%s to exit",
        "Break" if name == "nt" else "C",
    )
    last_translation_at: float | None = None

    try:
        while True:
            processed_work, processed_translation = process_once(
                get_translation_batch_size(),
                get_translation_chunk_size(),
            )
            if processed_translation:
                last_translation_at = monotonic()
            else:
                if last_translation_at is None:
                    continue
                idle_for_seconds = monotonic() - last_translation_at
                if idle_for_seconds >= TRANSLATION_IDLE_UNLOAD_SECONDS:
                    from utils.translation import unload_model

                    unload_model()
                    last_translation_at = None
            if processed_work:
                continue
            else:
                sleep(IDLE_SLEEP_SECONDS)
    except (KeyboardInterrupt, SystemExit):
        logger.info("Worker stopped")
    except Exception:
        logger.exception("Worker stopped due to an unrecoverable error")
        raise
