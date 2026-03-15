from collections.abc import Iterator

from sqlalchemy import ForeignKey
from sqlalchemy import JSON
from sqlalchemy import create_engine
from sqlalchemy import inspect
from sqlalchemy import text
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.orm import Mapped
from sqlalchemy.orm import Session
from sqlalchemy.orm import mapped_column
from sqlalchemy.orm import relationship
from sqlalchemy.orm import sessionmaker

engine = create_engine("sqlite:///translator.db")
SessionLocal = sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Project(Base):
    __tablename__ = "project"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column()
    jobs: Mapped[list["Job"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
    )


class Job(Base):
    __tablename__ = "job"

    id: Mapped[int] = mapped_column(primary_key=True)
    source_paths: Mapped[dict[str, str]] = mapped_column(JSON)
    result: Mapped[dict[str, str | None] | None] = mapped_column(JSON, nullable=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("project.id"))
    project: Mapped[Project] = relationship(back_populates="jobs")


def ensure_schema() -> None:
    inspector = inspect(engine)
    if "job" not in inspector.get_table_names():
        return

    columns = {column["name"] for column in inspector.get_columns("job")}
    with engine.begin() as connection:
        if "result" not in columns:
            connection.execute(text("ALTER TABLE job ADD COLUMN result JSON"))

        if "result_url" in columns:
            connection.execute(
                text("UPDATE job SET result = result_url WHERE result IS NULL AND result_url IS NOT NULL")
            )


def get_session() -> Iterator[Session]:
    with SessionLocal() as session:
        yield session
