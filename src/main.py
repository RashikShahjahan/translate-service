from contextlib import asynccontextmanager
from collections.abc import AsyncIterator
from typing import Annotated
from typing import Literal
from uuid import UUID
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy.orm import Session
from utils.database import Job, Project, get_session, initialize_database, list_projects, load_project
from worker import enqueue_job


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    initialize_database()
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
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    source_paths: Annotated[list["JobSource"], Field(min_length=1)]


class JobsCreate(BaseModel):
    source_paths: Annotated[list["JobSource"], Field(min_length=1)]


class EditedTranslationCreate(BaseModel):
    edited_translation: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class JobSource(BaseModel):
    type: Literal["image", "text"]
    source_path: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


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


@app.post("/projects")
def create_project(payload: ProjectCreate, session: Session = Depends(get_session)):
    jobs = [Job(source_paths=paths.model_dump()) for paths in payload.source_paths]
    project = Project(
        name=payload.name,
        jobs=jobs,
    )
    session.add(project)
    session.commit()
    for job in jobs:
        enqueue_job(job.id)
    return project.to_dict()


@app.get("/projects")
def fetch_projects(
    offset: int = 0,
    limit: int = 100,
    session: Session = Depends(get_session),
):
    return [project.to_dict() for project in list_projects(session, offset=offset, limit=limit)]


@app.get("/projects/{project_id}")
def fetch_project_by_id(project: ProjectDependency):
    return project.to_dict()


@app.get("/jobs/{job_id}")
def fetch_job_by_id(job: JobDependency):
    return job.to_dict()


@app.put("/projects/{project_id}")
def add_jobs(
    project: ProjectDependency,
    payload: JobsCreate,
    session: Session = Depends(get_session),
):
    jobs = [Job(source_paths=paths.model_dump()) for paths in payload.source_paths]
    project.jobs.extend(jobs)
    session.commit()
    for job in jobs:
        enqueue_job(job.id)
    return project.to_dict()


@app.put("/jobs/{job_id}/edited-translation")
def add_user_edited_translation(
    job: JobDependency,
    payload: EditedTranslationCreate,
    session: Session = Depends(get_session),
):
    if job.result is None:
        raise HTTPException(status_code=409, detail="Job result not available yet")

    job.result = {
        **job.result,
        "edited_translation": payload.edited_translation,
    }
    session.commit()
    return job.to_dict()
