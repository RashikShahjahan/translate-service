from contextlib import asynccontextmanager
from collections.abc import AsyncIterator
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from utils.database import add_folder_files
from utils.database import create_folder as create_folder_record
from utils.database import get_session
from utils.database import initialize_database
from utils.database import list_folders
from utils.database import save_file_edited_translation
from utils.schema import FolderCreate
from utils.schema import EditedTranslationCreate
from utils.schema import FileDependency
from utils.schema import FolderDependency
from utils.schema import FolderResponse
from utils.schema import FilesCreate
from utils.schema import FileResponse


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


@app.post("/folders", response_model=FolderResponse)
def create_folder(payload: FolderCreate, session: Session = Depends(get_session)) -> FolderResponse:
    folder = create_folder_record(
        session,
        name=payload.name,
        source_paths=[source.to_record() for source in payload.source_paths],
    )
    return FolderResponse.from_model(folder)


@app.get("/folders", response_model=list[FolderResponse])
def fetch_folders(
    offset: int = 0,
    limit: int = 100,
    session: Session = Depends(get_session),
) -> list[FolderResponse]:
    return [FolderResponse.from_model(folder) for folder in list_folders(session, offset=offset, limit=limit)]


@app.get("/folders/{folder_id}", response_model=FolderResponse)
def fetch_folder_by_id(folder: FolderDependency) -> FolderResponse:
    return FolderResponse.from_model(folder)


@app.get("/files/{file_id}", response_model=FileResponse)
def fetch_file_by_id(file: FileDependency) -> FileResponse:
    return FileResponse.from_model(file)


@app.put("/folders/{folder_id}", response_model=FolderResponse)
def add_files(
    folder: FolderDependency,
    payload: FilesCreate,
    session: Session = Depends(get_session),
) -> FolderResponse:
    add_folder_files(session, folder, [source.to_record() for source in payload.source_paths])
    return FolderResponse.from_model(folder)


@app.put("/files/{file_id}/edited-translation", response_model=FileResponse)
def add_user_edited_translation(
    file: FileDependency,
    payload: EditedTranslationCreate,
    session: Session = Depends(get_session),
) -> FileResponse:
    try:
        updated_file = save_file_edited_translation(session, file, payload.edited_translation)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    return FileResponse.from_model(updated_file)
