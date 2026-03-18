from pydantic import BaseModel, Field, StringConstraints
from typing import Annotated
from typing import Literal
from uuid import UUID
from utils.database import Job, Project, get_session, load_project
from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session


class ProjectCreate(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    source_paths: Annotated[list["JobSource"], Field(min_length=1)]


class JobsCreate(BaseModel):
    source_paths: Annotated[list["JobSource"], Field(min_length=1)]


class EditedTranslationCreate(BaseModel):
    edited_translation: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class JobSource(BaseModel):
    type: Literal["image", "text"]
    source_path: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


def project_with_job_ids(project: Project) -> dict[str, object]:
    return {
        "id": project.id,
        "name": project.name,
        "jobs": [job.id for job in project.jobs],
    }


def require_project(project_id: UUID, session: Session = Depends(get_session)) -> Project:
    project = load_project(session, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def require_job(job_id: UUID, session: Session = Depends(get_session)) -> Job:
    job = session.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


ProjectDependency = Annotated[Project, Depends(require_project)]
JobDependency = Annotated[Job, Depends(require_job)]
