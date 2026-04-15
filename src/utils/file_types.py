from mimetypes import guess_type


DOCX_MIME_TYPE = (
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
)


def detect_source_type(source_path: str) -> str:
    mime_type, _ = guess_type(source_path)

    if mime_type is not None:
        if mime_type.startswith("image/"):
            return "image"

        if mime_type.startswith("text/"):
            return "text"

        if mime_type == DOCX_MIME_TYPE:
            return "text"


def detect_mime_type(source_path: str) -> str | None:
    mime_type, _ = guess_type(source_path)
    return mime_type


def detect_image_mime_type(source_path: str) -> str:
    mime_type, _ = guess_type(source_path)
    if mime_type is None or not mime_type.startswith("image/"):
        raise ValueError(f"Could not determine image MIME type for {source_path}.")
    return mime_type
