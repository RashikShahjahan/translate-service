import argparse
from pathlib import Path
from persistqueue import SQLiteAckQueue
from persistqueue.sqlackqueue import AckStatus
from utils.file_types import detect_source_type

def prepare_task(input_path:Path, project_dir:Path):
    if input_path.is_file() and input_path.suffixes:
        folder_name = input_path.name.removesuffix("".join(input_path.suffixes))
    else:
        folder_name = input_path.name
    project_subdir = project_dir / folder_name
    project_subdir.mkdir(parents=True, exist_ok=True)
    target_path = input_path.copy_into(project_subdir)

    input_type = detect_source_type(target_path)
    if input_type == "image":
        q = SQLiteAckQueue("ocr")
    elif input_type == "text":
        q = SQLiteAckQueue("translate")
    else:
        return

    q.put(target_path)


def iter_input_files(input_path: Path):
    if input_path.is_file():
        yield input_path
        return

    if input_path.is_dir():
        for path in sorted(input_path.rglob("*")):
            if path.is_file():
                yield path
        return

    raise FileNotFoundError(f"Input path does not exist: {input_path}")


def upsert_project(project_name:str, input_paths:str | list[str]):
    project_dir = Path(f"data/{project_name}")
    Path.mkdir(project_dir,parents=True,exist_ok=True)

    if isinstance(input_paths, str):
        paths = [input_paths]
    else:
        paths = input_paths

    for raw_input_path in paths:
        input_path = Path(raw_input_path)
        for input_file in iter_input_files(input_path):
            prepare_task(input_file, project_dir)

ACK_STATUS_LABELS = {
    AckStatus.inited: "initialized",
    AckStatus.ready: "queued",
    AckStatus.unack: "in_progress",
    AckStatus.acked: "completed",
    AckStatus.ack_failed: "failed",
}


def get_tasks() -> list[dict]:
    ocr_q = SQLiteAckQueue("ocr")
    translate_q = SQLiteAckQueue("translate")
    tasks: list[dict] = []

    for queue in (ocr_q, translate_q):
        for item in queue.queue():
            if str(item["status"]) == AckStatus.acked:
                continue
            tasks.append(
                {
                    **item,
                    "status_label": ACK_STATUS_LABELS.get(str(item["status"]), "unknown"),
                    "queue": queue.name,
                }
            )

    return tasks


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Manage translation projects and queued tasks.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    upsert_project_parser = subparsers.add_parser(
        "add-tasks",
        help="Add input files to a project queue.",
    )
    upsert_project_parser.add_argument("project_name", help="Project name under data/.")
    upsert_project_parser.add_argument(
        "input",
        nargs="+",
        help="One or more input files or directories to enqueue.",
    )

    subparsers.add_parser(
        "get-tasks",
        help="Print queued OCR and translation tasks.",
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

    parser.error(f"Unknown command: {args.command}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
