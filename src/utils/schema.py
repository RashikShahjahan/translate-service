from typing import Annotated, Literal
from uuid import UUID
from pydantic import BaseModel, Field, StringConstraints
from utils.database import File, Folder, get_session, load_file, load_folder
from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session


def require_folder(folder_id: UUID, session: Session = Depends(get_session)) -> Folder:
    folder = load_folder(session, folder_id)
    if folder is None:
        raise HTTPException(status_code=404, detail="Folder not found")
    return folder


def require_file(file_id: UUID, session: Session = Depends(get_session)) -> File:
    file = load_file(session, file_id)
    if file is None:
        raise HTTPException(status_code=404, detail="File not found")
    return file


class FileSource(BaseModel):
    type: Literal["image", "text"]
    source_path: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]

    def to_record(self) -> dict[str, str]:
        return self.model_dump()


class FolderCreate(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    source_paths: Annotated[list[FileSource], Field(min_length=1)]


class FilesCreate(BaseModel):
    source_paths: Annotated[list[FileSource], Field(min_length=1)]


class EditedTranslationCreate(BaseModel):
    edited_translation: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class FileResult(BaseModel):
    source_text: str
    translated_text: str
    edited_translation: str | None = None


class FileResponse(BaseModel):
    id: UUID
    status: str
    error: str | None
    source_paths: FileSource
    result: FileResult | None

    @classmethod
    def from_model(cls, file: File) -> "FileResponse":
        return cls(
            id=file.id,
            status=file.status,
            error=file.error,
            source_paths=FileSource.model_validate(file.source_paths),
            result=FileResult.model_validate(file.result) if file.result is not None else None,
        )


class FolderResponse(BaseModel):
    id: UUID
    name: str
    files: list[UUID]

    @classmethod
    def from_model(cls, folder: Folder) -> "FolderResponse":
        return cls(
            id=folder.id,
            name=folder.name,
            files=[file.id for file in folder.files],
        )

FolderDependency = Annotated[Folder, Depends(require_folder)]
FileDependency = Annotated[File, Depends(require_file)]
