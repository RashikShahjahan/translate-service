import argparse
from pathlib import Path

from utils.storage import get_completed_translations
from utils.storage import get_documents as fetch_documents
from utils.storage import get_projects as fetch_projects
from utils.storage import get_tasks as fetch_tasks
from utils.storage import upsert_document, upsert_project as ensure_project
from utils.docx import write_project_docx
from utils.file_types import detect_mime_type, detect_source_type


def prepare_task(input_path: Path, project_id: int, source_name: str):
    input_type = detect_source_type(input_path)
    if input_type not in {"image", "text"}:
        return

    upsert_document(
        project_id=project_id,
        source_name=source_name,
        source_type=input_type,
        source_bytes=input_path.read_bytes(),
        source_text=input_path.read_text(encoding="utf-8") if input_type == "text" else None,
        mime_type=detect_mime_type(input_path),
    )


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


def upsert_project(project_name: str, input_paths: str | list[str]):
    if isinstance(input_paths, str):
        paths = [input_paths]
    else:
        paths = input_paths

    project_id = ensure_project(project_name)

    for raw_input_path in paths:
        input_path = Path(raw_input_path)
        for input_file, source_name in iter_input_files(input_path):
            prepare_task(input_file, project_id, source_name)


def get_tasks() -> list[dict]:
    return fetch_tasks()


def get_projects() -> list[dict]:
    return fetch_projects()


def get_documents(project_name: str) -> list[dict]:
    return fetch_documents(project_name)


def publish_project_docx(project_name: str, output_path: str | None = None) -> Path:
    documents = get_completed_translations(project_name)
    if not documents:
        raise ValueError(f"No completed translated documents found for project: {project_name}")

    output = Path(output_path) if output_path else Path("output") / f"{project_name}.docx"
    write_project_docx(documents, output)
    return output


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Manage translation projects and queued tasks.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    upsert_project_parser = subparsers.add_parser(
        "add-tasks",
        help="Store input files and queue them for processing.",
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
        "publish",
        help="Write completed translated documents for a project to a DOCX file.",
    )
    publish_docx_parser.add_argument(
        "project_name",
        help="Project name whose translated documents should be published.",
    )
    publish_docx_parser.add_argument(
        "output",
        nargs="?",
        help="Optional output .docx path. Defaults to output/<project_name>.docx.",
    )

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    if args.command == "add-tasks":
        upsert_project(args.project_name, args.input)
        return 0

    if args.command == "get-tasks":
        for task in get_tasks():
            print(task)
        return 0

    if args.command == "list-projects":
        for project in get_projects():
            print(project["name"])
        return 0

    if args.command == "list-documents":
        for document in get_documents(args.project_name):
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

    if args.command == "publish":
        output = publish_project_docx(args.project_name, args.output)
        print(output)
        return 0

    parser.error(f"Unknown command: {args.command}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
