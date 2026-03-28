import argparse
import logging
from pathlib import Path

from utils.storage import get_completed_translations
from utils.storage import get_documents as fetch_documents
from utils.storage import get_projects as fetch_projects
from utils.storage import get_tasks as fetch_tasks
from utils.storage import upsert_document, upsert_project
from utils.docx import write_document_docx
from utils.file_types import detect_mime_type, detect_source_type
from utils.logging_utils import configure_logging


logger = logging.getLogger(__name__)


def prepare_task(
    input_path: Path, project_id: int, project_name: str, source_name: str
) -> bool:
    input_type = detect_source_type(input_path)
    if input_type not in {"image", "text"}:
        logger.info("Skipping unsupported input file: %s", input_path)
        return False

    upsert_document(
        project_id=project_id,
        source_name=source_name,
        source_type=input_type,
        source_bytes=input_path.read_bytes(),
        source_text=(
            input_path.read_text(encoding="utf-8") if input_type == "text" else None
        ),
        mime_type=detect_mime_type(input_path),
    )
    logger.info(
        "Queued %s document '%s' for project '%s'",
        input_type,
        source_name,
        project_name,
    )
    return True


def iter_input_files(input_path: Path):
    if input_path.is_file():
        yield input_path, input_path.name
        return

    if input_path.is_dir():
        for path in sorted(input_path.rglob("*")):
            if path.is_file():
                yield path, str(Path(input_path.name) / path.relative_to(input_path))
        return

    raise FileNotFoundError(f"Input path does not exist: {input_path}")


def add_tasks(project_name: str, input_paths: str | list[str]) -> int:
    if isinstance(input_paths, str):
        paths = [input_paths]
    else:
        paths = input_paths

    project_id = upsert_project(project_name)
    queued_count = 0
    skipped_count = 0


    for raw_input_path in paths:
        input_path = Path(raw_input_path)
        for input_file, source_name in iter_input_files(input_path):
            if prepare_task(input_file, project_id, project_name, source_name):
                queued_count += 1
            else:
                skipped_count += 1

    logger.info(
        "Prepared %d document(s) for project '%s'%s",
        queued_count,
        project_name,
        f"; skipped {skipped_count} unsupported file(s)" if skipped_count else "",
    )
    return queued_count



def document_output_path(output_dir: Path, source_name: str) -> Path:
    source_path = Path(source_name)
    return output_dir / source_path.with_suffix(".docx")


def publish_project_docx(project_name: str, output_path: str | None = None) -> list[Path]:
    documents = get_completed_translations(project_name)
    if not documents:
        raise ValueError(
            f"No completed translated documents found for project: {project_name}"
        )

    output_dir = Path(output_path) if output_path else Path("output") / project_name
    outputs: list[Path] = []

    for document in documents:
        output = document_output_path(output_dir, str(document["source_name"]))
        write_document_docx(document, output)
        outputs.append(output)

    logger.info(
        "Wrote %d DOCX output file(s) to %s",
        len(outputs),
        output_dir,
    )
    return outputs


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Manage translation projects and queued tasks."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    upsert_project_parser = subparsers.add_parser(
        "add-tasks",
        help="Store input files and queue them for translation.",
    )
    upsert_project_parser.add_argument("project_name", help="Project name")
    upsert_project_parser.add_argument(
        "input",
        nargs="+",
        help="One or more input files or directories to enqueue.",
    )

    subparsers.add_parser(
        "get-tasks",
        help="Print queued OCR and translation tasks.",
    )

    subparsers.add_parser(
        "list-projects",
        help="Print all stored projects.",
    )

    list_documents_parser = subparsers.add_parser(
        "list-documents",
        help="Print all stored documents for a project.",
    )
    list_documents_parser.add_argument(
        "project_name",
        help="Project name whose documents should be listed.",
    )

    publish_docx_parser = subparsers.add_parser(
        "export",
        help="Write one DOCX file per completed translated document.",
    )
    publish_docx_parser.add_argument(
        "project_name",
        help="Project name whose translated documents should be published.",
    )
    publish_docx_parser.add_argument(
        "output",
        nargs="?",
        help="Optional output directory. Defaults to output/<project_name>/.",
    )

    return parser


def main() -> int:
    configure_logging()
    parser = build_parser()
    args = parser.parse_args()

    try:
        if args.command == "add-tasks":
            add_tasks(args.project_name, args.input)
            return 0

        if args.command == "get-tasks":
            tasks = fetch_tasks()
            for task in tasks:
                print(task)
            return 0

        if args.command == "list-projects":
            projects = fetch_projects()
            for project in projects:
                print(project["name"])
            return 0

        if args.command == "list-documents":
            documents = fetch_documents(args.project_name)
            for document in documents:
                print(
                    {
                        "id": document["id"],
                        "source_name": document["source_name"],
                        "source_type": document["source_type"],
                        "status": document["status"],
                        "created_at": document["created_at"],
                        "updated_at": document["updated_at"],
                    }
                )
            return 0

        if args.command == "export":
            outputs = publish_project_docx(args.project_name, args.output)
            for output in outputs:
                print(output)
            return 0
    except Exception:
        logger.exception("Command '%s' failed", args.command)
        return 1

    parser.error(f"Unknown command: {args.command}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
