from collections.abc import Iterator
from datetime import datetime
from uuid import UUID
from uuid import uuid4

from sqlalchemy import DateTime
from sqlalchemy import ForeignKey
from sqlalchemy import JSON
from sqlalchemy import Uuid
from sqlalchemy import create_engine
from sqlalchemy import inspect
from sqlalchemy import select
from sqlalchemy import String
from sqlalchemy import text
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.orm import Mapped
from sqlalchemy.orm import Session
from sqlalchemy.orm import mapped_column
from sqlalchemy.orm import relationship
from sqlalchemy.orm import sessionmaker
from sqlalchemy.orm import selectinload

engine = create_engine(
    "sqlite:///translator.db",
    connect_args={"check_same_thread": False},
)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Folder(Base):
    __tablename__ = "folder"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column()
    files: Mapped[list["File"]] = relationship(
        back_populates="folder",
        cascade="all, delete-orphan",
    )


class File(Base):
    __tablename__ = "file"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    source_paths: Mapped[dict[str, str]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    status: Mapped[str] = mapped_column(String, default="queued")
    error: Mapped[str | None] = mapped_column(nullable=True)
    result: Mapped[dict[str, str | None] | None] = mapped_column(JSON, nullable=True)
    folder_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("folder.id"))
    folder: Mapped[Folder] = relationship(back_populates="files")

    @property
    def source_type(self) -> str:
        return self.source_paths["type"]

    @property
    def source_path(self) -> str:
        return self.source_paths["source_path"]

    def mark_queued(self) -> None:
        self.status = "queued"
        self.error = None
        self.result = None

    def mark_running(self) -> None:
        self.status = "running"
        self.error = None
        self.result = None

    def mark_failed(self, error: str) -> None:
        self.status = "failed"
        self.error = error
        self.result = None

    def mark_done(self, source_text: str, translated_text: str) -> None:
        self.status = "done"
        self.error = None
        self.result = {
            "source_text": source_text,
            "translated_text": translated_text,
        }


def initialize_database() -> None:
    Base.metadata.create_all(engine)
    ensure_schema()


def list_folders(session: Session, offset: int = 0, limit: int = 100) -> list[Folder]:
    statement = select(Folder).options(selectinload(Folder.files)).offset(offset).limit(limit)
    return list(session.scalars(statement))


def load_file(session: Session, file_id: UUID) -> File | None:
    return session.get(File, file_id)


def load_queued_files(session: Session, limit: int = 1) -> File | list[File] | None:
    statement = (
        select(File)
        .where(File.status == "queued")
        .order_by(File.created_at.asc(), text("rowid"))
        .limit(limit)
    )
    if limit == 1:
        return session.scalar(statement)
    return list(session.scalars(statement))


def load_folder(session: Session, folder_id: UUID) -> Folder | None:
    statement = select(Folder).options(selectinload(Folder.files)).where(Folder.id == folder_id)
    return session.scalar(statement)


def create_folder(session: Session, name: str, source_paths: list[dict[str, str]]) -> Folder:
    files = [File(source_paths=source_path) for source_path in source_paths]
    folder = Folder(name=name, files=files)
    session.add(folder)
    session.commit()
    return folder


def add_folder_files(session: Session, folder: Folder, source_paths: list[dict[str, str]]) -> list[File]:
    files = [File(source_paths=source_path) for source_path in source_paths]
    folder.files.extend(files)
    session.commit()
    return files


def save_file_edited_translation(session: Session, file: File, edited_translation: str) -> File:
    if file.result is None:
        raise ValueError("File result not available yet")

    file.result = {
        **file.result,
        "edited_translation": edited_translation,
    }
    session.commit()
    return file


def ensure_schema() -> None:
    inspector = inspect(engine)
    if "file" not in inspector.get_table_names():
        return

    columns = {column["name"] for column in inspector.get_columns("file")}
    with engine.begin() as connection:
        if "created_at" not in columns:
            connection.execute(
                text("ALTER TABLE file ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL")
            )

        if "status" not in columns:
            connection.execute(text("ALTER TABLE file ADD COLUMN status VARCHAR DEFAULT 'queued' NOT NULL"))
            connection.execute(text("UPDATE file SET status = CASE WHEN result IS NULL THEN 'queued' ELSE 'done' END"))

        if "error" not in columns:
            connection.execute(text("ALTER TABLE file ADD COLUMN error VARCHAR"))

        if "result" not in columns:
            connection.execute(text("ALTER TABLE file ADD COLUMN result JSON"))

        if "result_url" in columns:
            connection.execute(
                text("UPDATE file SET result = result_url WHERE result IS NULL AND result_url IS NOT NULL")
            )


def get_session() -> Iterator[Session]:
    with SessionLocal() as session:
        yield session
