from contextlib import asynccontextmanager
from collections.abc import AsyncIterator
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from utils.database import Job, Project, get_session, initialize_database, list_projects
from utils.schema import ProjectCreate
from utils.schema import EditedTranslationCreate
from utils.schema import JobDependency
from utils.schema import ProjectDependency
from utils.schema import ProjectResponse
from utils.schema import JobsCreate
from utils.schema import JobResponse
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


@app.post("/projects", response_model=ProjectResponse)
def create_project(payload: ProjectCreate, session: Session = Depends(get_session)) -> ProjectResponse:
    jobs = [Job(source_paths=source.to_record()) for source in payload.source_paths]
    project = Project(
        name=payload.name,
        jobs=jobs,
    )
    session.add(project)
    session.commit()
    for job in jobs:
        enqueue_job(job.id)
    return ProjectResponse.from_model(project)


@app.get("/projects", response_model=list[ProjectResponse])
def fetch_projects(
    offset: int = 0,
    limit: int = 100,
    session: Session = Depends(get_session),
) -> list[ProjectResponse]:
    return [ProjectResponse.from_model(project) for project in list_projects(session, offset=offset, limit=limit)]


@app.get("/projects/{project_id}", response_model=ProjectResponse)
def fetch_project_by_id(project: ProjectDependency) -> ProjectResponse:
    return ProjectResponse.from_model(project)


@app.get("/jobs/{job_id}", response_model=JobResponse)
def fetch_job_by_id(job: JobDependency) -> JobResponse:
    return JobResponse.from_model(job)


@app.put("/projects/{project_id}", response_model=ProjectResponse)
def add_jobs(
    project: ProjectDependency,
    payload: JobsCreate,
    session: Session = Depends(get_session),
) -> ProjectResponse:
    jobs = [Job(source_paths=source.to_record()) for source in payload.source_paths]
    project.jobs.extend(jobs)
    session.commit()
    for job in jobs:
        enqueue_job(job.id)
    return ProjectResponse.from_model(project)


@app.put("/jobs/{job_id}/edited-translation", response_model=JobResponse)
def add_user_edited_translation(
    job: JobDependency,
    payload: EditedTranslationCreate,
    session: Session = Depends(get_session),
) -> JobResponse:
    if job.result is None:
        raise HTTPException(status_code=409, detail="Job result not available yet")

    job.result = {
        **job.result,
        "edited_translation": payload.edited_translation,
    }
    session.commit()
    return JobResponse.from_model(job)
