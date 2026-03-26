from pathlib import Path

from docx import Document


def write_project_docx(documents: list[dict], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    doc = Document()

    for document in documents:
        doc.add_paragraph(str(document["translated_text"] or ""))

    doc.save(output_path)
