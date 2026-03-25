from pathlib import Path

from sqlalchemy import LargeBinary, String, Text, create_engine, inspect, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship
from sqlalchemy.sql import func
from sqlalchemy import ForeignKey, UniqueConstraint


DB_PATH = Path("data/translate_service.sqlite3")
DATABASE_URL = f"sqlite:///{DB_PATH}"

STATUS_PENDING_OCR = "pending_ocr"
STATUS_PROCESSING_OCR = "processing_ocr"
STATUS_PENDING_TRANSLATION = "pending_translation"
STATUS_PROCESSING_TRANSLATION = "processing_translation"
STATUS_COMPLETED = "completed"
STATUS_FAILED = "failed"


class Base(DeclarativeBase):
    pass


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    created_at: Mapped[str] = mapped_column(String, nullable=False, server_default=func.current_timestamp())
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
    created_at: Mapped[str] = mapped_column(String, nullable=False, server_default=func.current_timestamp())
    updated_at: Mapped[str] = mapped_column(
        String,
        nullable=False,
        server_default=func.current_timestamp(),
        onupdate=func.current_timestamp(),
    )
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
            document.updated_at = func.current_timestamp()
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
        document = session.scalar(
            select(Document)
            .where(Document.status == STATUS_PENDING_OCR)
            .order_by(Document.created_at.asc(), Document.id.asc())
            .limit(1)
        )
        if document is None:
            return None

        document.status = STATUS_PROCESSING_OCR
        session.commit()
        return {
            "id": document.id,
            "source_bytes": document.source_bytes,
            "mime_type": document.mime_type,
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
        document.updated_at = func.current_timestamp()
        session.commit()


def lease_documents_for_translation(limit: int) -> list[dict]:
    with get_session() as session:
        documents = list(
            session.scalars(
                select(Document)
                .where(Document.status == STATUS_PENDING_TRANSLATION)
                .order_by(Document.created_at.asc(), Document.id.asc())
                .limit(limit)
            )
        )
        if not documents:
            return []

        for document in documents:
            document.status = STATUS_PROCESSING_TRANSLATION

        leased = [
            {
                "id": document.id,
                "source_type": document.source_type,
                "source_name": document.source_name,
                "input_text": document.ocr_text or document.source_text,
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
        document.updated_at = func.current_timestamp()
        session.commit()


def fail_document(document_id: int, error_message: str) -> None:
    with get_session() as session:
        document = session.get(Document, document_id)
        if document is None:
            return
        document.status = STATUS_FAILED
        document.error_message = error_message
        document.updated_at = func.current_timestamp()
        session.commit()
