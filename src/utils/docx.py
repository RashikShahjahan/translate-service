from pathlib import Path

from docx import Document


def write_document_docx(document: dict, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    doc = Document()
    doc.add_paragraph(str(document["translated_text"] or ""))
    doc.save(output_path)
