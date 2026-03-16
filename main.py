from collections.abc import Iterator
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session
from typing import Literal

from database import Base, Job, Project, engine, ensure_schema, get_session
from tasks import extract_text, translate


def lifespan(_: FastAPI) -> Iterator[None]:
    Base.metadata.create_all(engine)
    ensure_schema()
    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ProjectCreate(BaseModel):
    name: str
    source_paths: list["JobSource"]


class JobsCreate(BaseModel):
    source_paths: list["JobSource"]


class EditedTranslationCreate(BaseModel):
    edited_translation: str = Field(min_length=1)


class JobSource(BaseModel):
    type: Literal["image", "text"]
    source_path: str = Field(min_length=1)


def _enqueue_jobs(jobs: list[Job]) -> None:
    for job in jobs:
        source_type = job.source_paths["type"]
        source_path = job.source_paths["source_path"]
        if source_type == "image":
            extract_text.delay(job_id=job.id, source_path=source_path)
            continue

        translate.delay(job_id=job.id, source_path=source_path)


def serialize_project(project: Project) -> dict:
    return {
        "id": project.id,
        "name": project.name,
        "jobs": [
            {
                "id": job.id,
                "source_paths": job.source_paths,
                "result": job.result,
            }
            for job in project.jobs
        ],
    }


@app.post("/projects")
def create_project(payload: ProjectCreate, session: Session = Depends(get_session)):
    jobs = [Job(source_paths=paths.model_dump()) for paths in payload.source_paths]
    project = Project(
        name=payload.name,
        jobs=jobs,
    )
    session.add(project)
    session.commit()
    _enqueue_jobs(jobs)
    session.refresh(project)
    return serialize_project(project)


@app.get("/projects")
def fetch_projects(
    offset: int = 0,
    limit: int = 100,
    session: Session = Depends(get_session),
):
    projects = list(session.scalars(select(Project).offset(offset).limit(limit)))
    return [serialize_project(project) for project in projects]


@app.get("/projects/{project_id}")
def fetch_project_by_id(project_id: UUID, session: Session = Depends(get_session)):
    project = session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")

    return serialize_project(project)


@app.put("/projects/{project_id}")
def add_jobs(
    project_id: UUID,
    payload: JobsCreate,
    session: Session = Depends(get_session),
):
    project = session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")

    jobs = [Job(source_paths=paths.model_dump()) for paths in payload.source_paths]
    project.jobs.extend(jobs)
    session.commit()
    _enqueue_jobs(jobs)
    session.refresh(project)
    return serialize_project(project)


@app.put("/jobs/{job_id}/edited-translation")
def add_user_edited_translation(
    job_id: UUID,
    payload: EditedTranslationCreate,
    session: Session = Depends(get_session),
):
    job = session.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.result is None:
        raise HTTPException(status_code=409, detail="Job result not available yet")

    job.result = {
        **job.result,
        "edited_translation": payload.edited_translation,
    }
    session.commit()
    session.refresh(job)
    return {
        "id": job.id,
        "source_paths": job.source_paths,
        "result": job.result,
    }
