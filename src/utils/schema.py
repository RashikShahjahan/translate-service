from typing import Annotated, Literal
from uuid import UUID
from pydantic import BaseModel, Field, StringConstraints
from utils.database import Job, Project, get_session, load_job, load_project
from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session


def require_project(project_id: UUID, session: Session = Depends(get_session)) -> Project:
    project = load_project(session, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def require_job(job_id: UUID, session: Session = Depends(get_session)) -> Job:
    job = load_job(session, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


class JobSource(BaseModel):
    type: Literal["image", "text"]
    source_path: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]

    def to_record(self) -> dict[str, str]:
        return self.model_dump()


class ProjectCreate(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    source_paths: Annotated[list[JobSource], Field(min_length=1)]


class JobsCreate(BaseModel):
    source_paths: Annotated[list[JobSource], Field(min_length=1)]


class EditedTranslationCreate(BaseModel):
    edited_translation: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class JobResult(BaseModel):
    source_text: str
    translated_text: str
    edited_translation: str | None = None


class JobResponse(BaseModel):
    id: UUID
    status: str
    error: str | None
    source_paths: JobSource
    result: JobResult | None

    @classmethod
    def from_model(cls, job: Job) -> "JobResponse":
        return cls(
            id=job.id,
            status=job.status,
            error=job.error,
            source_paths=JobSource.model_validate(job.source_paths),
            result=JobResult.model_validate(job.result) if job.result is not None else None,
        )


class ProjectResponse(BaseModel):
    id: UUID
    name: str
    jobs: list[UUID]

    @classmethod
    def from_model(cls, project: Project) -> "ProjectResponse":
        return cls(
            id=project.id,
            name=project.name,
            jobs=[job.id for job in project.jobs],
        )

ProjectDependency = Annotated[Project, Depends(require_project)]
JobDependency = Annotated[Job, Depends(require_job)]
