import os
import time

from apscheduler.schedulers.background import BackgroundScheduler
from utils.database import load_queued_files
from utils.database import get_session
from utils.ocr import extract_text_from_image
from utils.translation import load_text
from utils.translation import translate_text


def extract_text(source_type: str, source_path: str) -> str:
    if source_type == "image":
        return extract_text_from_image(source_path)

    if source_type == "text":
        return load_text(source_path)

    raise ValueError(f"Unsupported source type: {source_type} ({source_path})")


def start_translation():
    session_iter = get_session()
    session = next(session_iter)
    try:
        file = load_queued_files(session, limit=1)
        if file is None:
            return

        try:
            file.mark_running()
            session.commit()
            print("extracting text from image")
            source_text = extract_text(file.source_type, file.source_path)
            print("Translating ...")
            translated_text = translate_text(source_text)
            file.mark_done(source_text, translated_text)
            print("Translated Successfully")
        except Exception as exc:
            file.mark_failed(str(exc))
            print(str(exc))

        session.commit()
    finally:
        session_iter.close()



if __name__ == "__main__":
    scheduler = BackgroundScheduler()
    scheduler.add_job(start_translation, "interval", seconds=60)
    scheduler.start()
    print("Press Ctrl+{} to exit".format("Break" if os.name == "nt" else "C"))

    try:
        while True:
            time.sleep(2)
    except (KeyboardInterrupt, SystemExit):
        # Not strictly necessary if daemonic mode is enabled but should be done if possible
        scheduler.shutdown()
