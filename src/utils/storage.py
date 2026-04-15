from datetime import UTC, datetime, timedelta
from os import getenv
from pathlib import Path

from sqlalchemy import (
    LargeBinary,
    String,
    Text,
    case,
    create_engine,
    func,
    select,
    text,
    update,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship
from sqlalchemy import ForeignKey, UniqueConstraint


DB_PATH = Path("data/translate_service.sqlite3")
DATABASE_URL = f"sqlite:///{DB_PATH}"
DEFAULT_SOURCE_LANGUAGE = getenv("SOURCE_LANG_CODE", "bn").strip() or "bn"
DEFAULT_TARGET_LANGUAGE = getenv("TARGET_LANG_CODE", "en").strip() or "en"
DEFAULT_TRANSLATION_BATCH_SIZE = max(
    int(getenv("TRANSLATION_BATCH_SIZE", "4") or "4"),
    1,
)

STATUS_PENDING_OCR = "pending_ocr"
STATUS_PROCESSING_OCR = "processing_ocr"
STATUS_PENDING_TRANSLATION = "pending_translation"
STATUS_PROCESSING_TRANSLATION = "processing_translation"
STATUS_COMPLETED = "completed"


class Base(DeclarativeBase):
    pass


def utc_now_string() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    created_at: Mapped[str] = mapped_column(
        String, nullable=False, default=utc_now_string
    )
    source_language: Mapped[str] = mapped_column(
        String, nullable=False, default=DEFAULT_SOURCE_LANGUAGE
    )
    target_language: Mapped[str] = mapped_column(
        String, nullable=False, default=DEFAULT_TARGET_LANGUAGE
    )
    documents: Mapped[list["Document"]] = relationship(back_populates="project")


class Document(Base):
    __tablename__ = "documents"
    __table_args__ = (UniqueConstraint("project_id", "source_name"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE")
    )
    source_name: Mapped[str] = mapped_column(String, nullable=False)
    source_type: Mapped[str] = mapped_column(String, nullable=False)
    source_bytes: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    source_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    mime_type: Mapped[str | None] = mapped_column(String, nullable=True)
    ocr_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    translated_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String, nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    retry_count: Mapped[int] = mapped_column(default=0, nullable=False)
    next_attempt_at: Mapped[str | None] = mapped_column(String, nullable=True)
    leased_at: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[str] = mapped_column(
        String, nullable=False, default=utc_now_string
    )
    updated_at: Mapped[str] = mapped_column(
        String, nullable=False, default=utc_now_string
    )
    project: Mapped[Project] = relationship(back_populates="documents")


class AppSetting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)


DB_PATH.parent.mkdir(parents=True, exist_ok=True)
engine = create_engine(DATABASE_URL)


def ensure_db() -> None:
    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        existing_columns = {
            row[1] for row in connection.execute(text("PRAGMA table_info(projects)"))
        }
        if "source_language" not in existing_columns:
            connection.execute(
                text(
                    "ALTER TABLE projects ADD COLUMN source_language TEXT NOT NULL DEFAULT 'bn'"
                )
            )
        if "target_language" not in existing_columns:
            connection.execute(
                text(
                    "ALTER TABLE projects ADD COLUMN target_language TEXT NOT NULL DEFAULT 'en'"
                )
            )

        connection.execute(
            text(
                """
                UPDATE projects
                SET source_language = :source_language
                WHERE source_language IS NULL OR TRIM(source_language) = ''
                """
            ),
            {"source_language": DEFAULT_SOURCE_LANGUAGE},
        )
        connection.execute(
            text(
                """
                UPDATE projects
                SET target_language = :target_language
                WHERE target_language IS NULL OR TRIM(target_language) = ''
                """
            ),
            {"target_language": DEFAULT_TARGET_LANGUAGE},
        )

    with Session(engine) as session:
        app_setting = session.get(AppSetting, "translation_batch_size")
        if app_setting is None:
            session.add(
                AppSetting(
                    key="translation_batch_size",
                    value=str(DEFAULT_TRANSLATION_BATCH_SIZE),
                )
            )
            session.commit()
        elif not app_setting.value.strip():
            app_setting.value = str(DEFAULT_TRANSLATION_BATCH_SIZE)
            session.commit()


def get_session() -> Session:
    ensure_db()
    return Session(engine)


def get_app_setting(key: str) -> str | None:
    with get_session() as session:
        app_setting = session.get(AppSetting, key)
        return app_setting.value if app_setting is not None else None


def get_translation_batch_size() -> int:
    ensure_db()
    value = get_app_setting("translation_batch_size")
    if value is None:
        return DEFAULT_TRANSLATION_BATCH_SIZE

    try:
        parsed_value = int(str(value).strip())
    except ValueError:
        return DEFAULT_TRANSLATION_BATCH_SIZE

    return parsed_value if parsed_value > 0 else DEFAULT_TRANSLATION_BATCH_SIZE


def upsert_project(name: str) -> int:
    with get_session() as session:
        project = session.scalar(select(Project).where(Project.name == name))
        if project is None:
            project = Project(
                name=name,
                source_language=DEFAULT_SOURCE_LANGUAGE,
                target_language=DEFAULT_TARGET_LANGUAGE,
            )
            session.add(project)
            session.commit()
            session.refresh(project)
        return project.id


def get_projects() -> list[dict]:
    with get_session() as session:
        rows = session.execute(
            select(
                Project.id,
                Project.name,
                Project.created_at,
            )
        ).mappings()
        return [dict(row) for row in rows]


def get_documents(project_name: str) -> list[dict]:
    with get_session() as session:
        rows = session.execute(
            select(
                Document.id,
                Document.source_name,
                Document.source_type,
                Document.status,
                Document.created_at,
                Document.updated_at,
            )
            .join(Project, Project.id == Document.project_id)
            .where(Project.name == project_name)
        ).mappings()
        return [dict(row) for row in rows]


def get_completed_translations(project_name: str) -> list[dict]:
    with get_session() as session:
        rows = session.execute(
            select(
                Document.id,
                Document.source_name,
                Document.translated_text,
            )
            .join(Project, Project.id == Document.project_id)
            .where(Project.name == project_name)
            .where(Document.status == STATUS_COMPLETED)
            .order_by(Document.source_name.asc(), Document.id.asc())
        ).mappings()
        return [dict(row) for row in rows]


def upsert_document(
    *,
    project_id: int,
    source_name: str,
    source_type: str,
    source_bytes: bytes,
    source_text: str | None,
    mime_type: str | None,
) -> None:
    status = (
        STATUS_PENDING_OCR if source_type == "image" else STATUS_PENDING_TRANSLATION
    )
    now = utc_now_string()

    with get_session() as session:
        document = session.scalar(
            select(Document).where(
                Document.project_id == project_id,
                Document.source_name == source_name,
            )
        )
        if document is None:
            document = Document(
                project_id=project_id,
                source_name=source_name,
                source_type=source_type,
                source_bytes=source_bytes,
                source_text=source_text,
                mime_type=mime_type,
                status=status,
                retry_count=0,
                next_attempt_at=None,
                leased_at=None,
                created_at=now,
                updated_at=now,
            )
            session.add(document)
        else:
            document.source_type = source_type
            document.source_bytes = source_bytes
            document.source_text = source_text
            document.mime_type = mime_type
            document.ocr_text = None
            document.translated_text = None
            document.status = status
            document.error_message = None
            document.retry_count = 0
            document.next_attempt_at = None
            document.leased_at = None
            document.created_at = now
            document.updated_at = now
        session.commit()


def get_tasks() -> list[dict]:
    with get_session() as session:
        rows = session.execute(
            select(
                Document.id,
                Project.name.label("project_name"),
                Document.source_name,
                Document.source_type,
                Document.status,
                Document.error_message,
                Document.retry_count,
                Document.next_attempt_at,
                Document.leased_at,
                Document.created_at,
                Document.updated_at,
            )
            .join(Project, Project.id == Document.project_id)
            .where(Document.status != STATUS_COMPLETED)
            .order_by(Document.created_at.asc(), Document.id.asc())
        ).mappings()
        return [dict(row) for row in rows]


def retry_document(document_id: int) -> dict | None:
    with get_session() as session:
        document = session.get(Document, document_id)
        if document is None:
            return None

        if document.status == STATUS_COMPLETED:
            raise ValueError(f"Document {document_id} is already completed")

        if document.status in {STATUS_PROCESSING_OCR, STATUS_PROCESSING_TRANSLATION}:
            raise ValueError(f"Document {document_id} is currently processing")

        if not document.error_message:
            raise ValueError(f"Document {document_id} is not in a failed state")

        if document.status == STATUS_PENDING_OCR:
            next_status = STATUS_PENDING_OCR
        elif document.status == STATUS_PENDING_TRANSLATION:
            next_status = STATUS_PENDING_TRANSLATION
        elif document.source_type == "image" and not document.ocr_text:
            next_status = STATUS_PENDING_OCR
        else:
            next_status = STATUS_PENDING_TRANSLATION

        document.status = next_status
        document.error_message = None
        document.next_attempt_at = None
        document.leased_at = None
        document.updated_at = utc_now_string()
        session.commit()
        return {
            "id": document.id,
            "status": document.status,
            "retry_count": document.retry_count,
            "updated_at": document.updated_at,
        }


def _lease_documents(
    *,
    pending_status: str,
    processing_status: str,
    limit: int,
) -> list[int]:
    with get_session() as session:
        now = utc_now_string()
        documents = list(
            session.scalars(
                select(Document)
                .where(Document.status == pending_status)
                .where(
                    (Document.next_attempt_at.is_(None))
                    | (Document.next_attempt_at <= now)
                )
                .order_by(Document.created_at.asc(), Document.id.asc())
                .limit(limit)
            )
        )
        if not documents:
            return []

        for document in documents:
            document.status = processing_status
            document.next_attempt_at = None
            document.leased_at = now
            document.updated_at = now

        leased_document_ids = [document.id for document in documents]
        session.commit()
        return leased_document_ids


def lease_document_for_ocr() -> dict | None:
    leased_document_ids = _lease_documents(
        pending_status=STATUS_PENDING_OCR,
        processing_status=STATUS_PROCESSING_OCR,
        limit=1,
    )
    if not leased_document_ids:
        return None

    with get_session() as session:
        document = session.get(Document, leased_document_ids[0])
        if document is None:
            return None
        return {
            "id": document.id,
            "source_bytes": document.source_bytes,
            "mime_type": document.mime_type,
            "retry_count": document.retry_count,
        }


def complete_ocr(document_id: int, extracted_text: str) -> None:
    with get_session() as session:
        document = session.get(Document, document_id)
        if document is None:
            return
        document.ocr_text = extracted_text
        document.translated_text = None
        document.status = STATUS_PENDING_TRANSLATION
        document.error_message = None
        document.retry_count = 0
        document.next_attempt_at = None
        document.leased_at = None
        document.updated_at = utc_now_string()
        session.commit()


def lease_documents_for_translation(limit: int) -> list[dict]:
    leased_document_ids = _lease_documents(
        pending_status=STATUS_PENDING_TRANSLATION,
        processing_status=STATUS_PROCESSING_TRANSLATION,
        limit=limit,
    )
    if not leased_document_ids:
        return []

    with get_session() as session:
        rows = session.execute(
            select(Document, Project)
            .join(Project, Project.id == Document.project_id)
            .where(Document.id.in_(leased_document_ids))
            .order_by(Document.created_at.asc(), Document.id.asc())
        )
        return [
            {
                "id": document.id,
                "source_type": document.source_type,
                "source_name": document.source_name,
                "input_text": document.ocr_text or document.source_text,
                "retry_count": document.retry_count,
                "source_language": project.source_language,
                "target_language": project.target_language,
            }
            for document, project in rows
        ]


def complete_translation(document_id: int, translated_text: str) -> None:
    with get_session() as session:
        document = session.get(Document, document_id)
        if document is None:
            return
        document.translated_text = translated_text
        document.status = STATUS_COMPLETED
        document.error_message = None
        document.retry_count = 0
        document.next_attempt_at = None
        document.leased_at = None
        document.updated_at = utc_now_string()
        session.commit()


def requeue_document(
    document_id: int, error_message: str, backoff_seconds: float
) -> None:
    with get_session() as session:
        document = session.get(Document, document_id)
        if document is None:
            return

        if document.status == STATUS_PROCESSING_OCR:
            document.status = STATUS_PENDING_OCR
        elif document.status == STATUS_PROCESSING_TRANSLATION:
            document.status = STATUS_PENDING_TRANSLATION
        document.error_message = error_message
        document.retry_count += 1
        document.next_attempt_at = (
            (datetime.now(UTC) + timedelta(seconds=backoff_seconds))
            .replace(microsecond=0)
            .isoformat()
            .replace("+00:00", "Z")
        )
        document.leased_at = None
        document.updated_at = utc_now_string()
        session.commit()


def recover_stale_leases(max_age_seconds: float) -> int:
    cutoff = (datetime.now(UTC) - timedelta(seconds=max_age_seconds)).replace(
        microsecond=0
    )
    now = utc_now_string()

    with get_session() as session:
        result = session.execute(
            update(Document)
            .where(
                Document.status.in_(
                    [STATUS_PROCESSING_OCR, STATUS_PROCESSING_TRANSLATION]
                ),
                (Document.leased_at.is_(None))
                | (func.julianday(Document.leased_at) <= func.julianday(cutoff)),
            )
            .values(
                status=case(
                    (Document.status == STATUS_PROCESSING_OCR, STATUS_PENDING_OCR),
                    (
                        Document.status == STATUS_PROCESSING_TRANSLATION,
                        STATUS_PENDING_TRANSLATION,
                    ),
                    else_=Document.status,
                ),
                leased_at=None,
                next_attempt_at=None,
                updated_at=now,
            )
        )
        recovered_count = int(result.rowcount or 0)
        if not recovered_count:
            return 0

        session.commit()
        return recovered_count
