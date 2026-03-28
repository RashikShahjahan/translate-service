from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlalchemy import (
    LargeBinary,
    String,
    Text,
    case,
    create_engine,
    func,
    inspect,
    select,
    update,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship
from sqlalchemy import ForeignKey, UniqueConstraint


DB_PATH = Path("data/translate_service.sqlite3")
DATABASE_URL = f"sqlite:///{DB_PATH}"

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
    created_at: Mapped[str] = mapped_column(String, nullable=False, default=utc_now_string)
    documents: Mapped[list["Document"]] = relationship(back_populates="project")


class Document(Base):
    __tablename__ = "documents"
    __table_args__ = (UniqueConstraint("project_id", "source_name"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
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
    created_at: Mapped[str] = mapped_column(String, nullable=False, default=utc_now_string)
    updated_at: Mapped[str] = mapped_column(String, nullable=False, default=utc_now_string)
    project: Mapped[Project] = relationship(back_populates="documents")


DB_PATH.parent.mkdir(parents=True, exist_ok=True)
engine = create_engine(DATABASE_URL)


def ensure_db() -> None:
    Base.metadata.create_all(engine)

    inspector = inspect(engine)
    columns = {column["name"] for column in inspector.get_columns("documents")}
    if "source_text" not in columns:
        with engine.begin() as conn:
            conn.exec_driver_sql("ALTER TABLE documents ADD COLUMN source_text TEXT")
    if "leased_at" not in columns:
        with engine.begin() as conn:
            conn.exec_driver_sql("ALTER TABLE documents ADD COLUMN leased_at TEXT")
    if "retry_count" not in columns:
        with engine.begin() as conn:
            conn.exec_driver_sql(
                "ALTER TABLE documents ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0"
            )
    if "next_attempt_at" not in columns:
        with engine.begin() as conn:
            conn.exec_driver_sql("ALTER TABLE documents ADD COLUMN next_attempt_at TEXT")


def get_session() -> Session:
    ensure_db()
    return Session(engine)


def upsert_project(name: str) -> int:
    with get_session() as session:
        project = session.scalar(select(Project).where(Project.name == name))
        if project is None:
            project = Project(name=name)
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
            .order_by(Project.created_at.asc(), Project.id.asc())
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
            .order_by(Document.source_name.asc(), Document.id.asc())
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
            .where(Document.translated_text.is_not(None))
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
    status = STATUS_PENDING_OCR if source_type == "image" else STATUS_PENDING_TRANSLATION
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


def lease_document_for_ocr() -> dict | None:
    with get_session() as session:
        now = utc_now_string()
        document = session.scalar(
            select(Document)
            .where(Document.status == STATUS_PENDING_OCR)
            .where(
                (Document.next_attempt_at.is_(None))
                | (Document.next_attempt_at <= now)
            )
            .order_by(Document.created_at.asc(), Document.id.asc())
            .limit(1)
        )
        if document is None:
            return None

        document.status = STATUS_PROCESSING_OCR
        document.next_attempt_at = None
        document.leased_at = now
        document.updated_at = now
        session.commit()
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
    with get_session() as session:
        now = utc_now_string()
        documents = list(
            session.scalars(
                select(Document)
                .where(Document.status == STATUS_PENDING_TRANSLATION)
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
            document.status = STATUS_PROCESSING_TRANSLATION
            document.next_attempt_at = None
            document.leased_at = now
            document.updated_at = now

        leased = [
            {
                "id": document.id,
                "source_type": document.source_type,
                "source_name": document.source_name,
                "input_text": document.ocr_text or document.source_text,
                "retry_count": document.retry_count,
            }
            for document in documents
        ]
        session.commit()
        return leased


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


def requeue_document(document_id: int, error_message: str, backoff_seconds: float) -> None:
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
            datetime.now(UTC) + timedelta(seconds=backoff_seconds)
        ).replace(microsecond=0).isoformat().replace("+00:00", "Z")
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
