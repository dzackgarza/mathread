"""Reading-portal HTTP surface: library listing, sidecar notes, region images, reads.

Mounted onto the capture app in `server.py`. The capture endpoints own writing PDFs;
these own the reading side over the same `<root>/inbox` store.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Response, UploadFile

from mathread import library
from mathread.models import (
    LibraryEntry,
    NoteContent,
    NoteImageResult,
    ReadEventRequest,
)


def create_portal_router(root: Path) -> APIRouter:
    router = APIRouter()

    @router.get("/library", response_model=list[LibraryEntry])
    def list_library() -> list[LibraryEntry]:
        return library.list_library(root)

    @router.get("/notes/{key}", response_model=NoteContent)
    def get_note(key: str) -> NoteContent:
        return NoteContent(key=key, text=library.read_note(root, key))

    @router.put("/notes/{key}", response_model=NoteContent)
    def put_note(key: str, note: NoteContent) -> NoteContent:
        library.write_note(root, key, note.text)
        return NoteContent(key=key, text=note.text)

    @router.post("/notes/{key}/image", response_model=NoteImageResult)
    async def post_note_image(key: str, image: UploadFile) -> NoteImageResult:
        relative_path = library.write_note_image(root, key, await image.read())
        return NoteImageResult(relative_path=relative_path)

    @router.get("/notes/{key}/assets/{filename}")
    def get_note_asset(key: str, filename: str) -> Response:
        asset_path = library.resolve_note_asset(root, key, filename)
        return Response(content=asset_path.read_bytes(), media_type="image/png")

    @router.get("/pdf/{key}")
    def get_pdf(key: str) -> Response:
        pdf_path = library.resolve_pdf(root, key)
        return Response(content=pdf_path.read_bytes(), media_type="application/pdf")

    @router.post("/read-event")
    def post_read_event(event: ReadEventRequest) -> Response:
        library.record_read_event(root, event.key, event.position)
        return Response(status_code=204)

    @router.delete("/library/{key}")
    def delete_entry(key: str) -> Response:
        library.delete_library_entry(root, key)
        return Response(status_code=204)

    return router
