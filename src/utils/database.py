from collections.abc import Iterator
from uuid import UUID
from uuid import uuid4

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


class Project(Base):
    __tablename__ = "project"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column()
    jobs: Mapped[list["Job"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
    )


class Job(Base):
    __tablename__ = "job"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    source_paths: Mapped[dict[str, str]] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String, default="queued")
    error: Mapped[str | None] = mapped_column(nullable=True)
    result: Mapped[dict[str, str | None] | None] = mapped_column(JSON, nullable=True)
    project_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("project.id"))
    project: Mapped[Project] = relationship(back_populates="jobs")

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


def list_projects(session: Session, offset: int = 0, limit: int = 100) -> list[Project]:
    statement = select(Project).options(selectinload(Project.jobs)).offset(offset).limit(limit)
    return list(session.scalars(statement))


def load_project(session: Session, project_id: UUID) -> Project | None:
    statement = select(Project).options(selectinload(Project.jobs)).where(Project.id == project_id)
    return session.scalar(statement)


def ensure_schema() -> None:
    inspector = inspect(engine)
    if "job" not in inspector.get_table_names():
        return

    columns = {column["name"] for column in inspector.get_columns("job")}
    with engine.begin() as connection:
        if "status" not in columns:
            connection.execute(text("ALTER TABLE job ADD COLUMN status VARCHAR DEFAULT 'queued' NOT NULL"))
            connection.execute(text("UPDATE job SET status = CASE WHEN result IS NULL THEN 'queued' ELSE 'done' END"))

        if "error" not in columns:
            connection.execute(text("ALTER TABLE job ADD COLUMN error VARCHAR"))

        if "result" not in columns:
            connection.execute(text("ALTER TABLE job ADD COLUMN result JSON"))

        if "result_url" in columns:
            connection.execute(
                text("UPDATE job SET result = result_url WHERE result IS NULL AND result_url IS NOT NULL")
            )


def get_session() -> Iterator[Session]:
    with SessionLocal() as session:
        yield session
