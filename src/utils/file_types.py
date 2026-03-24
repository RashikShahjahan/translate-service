from mimetypes import guess_type


def detect_source_type(source_path: str) -> str:
    mime_type, _ = guess_type(source_path)
    if mime_type is None:
        raise ValueError(f"Could not determine file type for {source_path}.")

    if mime_type.startswith("image/"):
        return "image"

    if mime_type.startswith("text/"):
        return "text"

    raise ValueError(f"Unsupported file type {mime_type} for {source_path}.")


def detect_image_mime_type(source_path: str) -> str:
    mime_type, _ = guess_type(source_path)
    if mime_type is None or not mime_type.startswith("image/"):
        raise ValueError(f"Could not determine image MIME type for {source_path}.")
    return mime_type
