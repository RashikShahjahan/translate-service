import os
from pathlib import Path

from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()

OCR_MODEL = os.getenv("OCR_MODEL", "gemini-3.1-flash-lite-preview")


def extract_text_from_image(source_path: str) -> str:
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not set.")

    image_path = Path(source_path)
    image_bytes = image_path.read_bytes()
    mime_type = f"image/{image_path.suffix.lower().lstrip('.') or 'jpeg'}"
    prompt = (
        "Extract the Bengali text from this image. "
        "Respond with only the extracted text with no additional commentary."
    )

    client = genai.Client(api_key=api_key)
    response = client.models.generate_content(
        model=OCR_MODEL,
        contents=[
            types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
            prompt,
        ],
    )

    text = (response.text or "").strip()
    if not text:
        raise ValueError(f"No text extracted from {source_path}.")
    return text
