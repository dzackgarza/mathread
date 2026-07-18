from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, HttpUrl

# Captures are always the extension uploading the PDF bytes; the backend never
# fetches a PDF from a URL itself (the retired "capture-url" mode).
type CaptureMode = Literal["capture-bytes"]


class CaptureBytesRequest(BaseModel):
    model_config = ConfigDict(strict=True)

    pdf_url: HttpUrl
    source_url: HttpUrl
    title_hint: str | None = None


class CaptureProvenance(BaseModel):
    model_config = ConfigDict(strict=True)

    pdf_url: HttpUrl
    source_url: HttpUrl
    capture: CaptureMode
    original_sha256: str
    title_hint: str | None = None


class CaptureResult(BaseModel):
    model_config = ConfigDict(strict=True)

    stored_path: Path
    original_sha256: str
    stored_sha256: str
    pdf_url: HttpUrl
    source_url: HttpUrl
    capture: CaptureMode
    title_hint: str | None = None
    existing: bool


class BackendServiceStatus(BaseModel):
    model_config = ConfigDict(strict=True)

    name: str
    version: str


class BackendStorageStatus(BaseModel):
    model_config = ConfigDict(strict=True)

    root_exists: bool
    root_writable: bool


class BackendCapabilities(BaseModel):
    model_config = ConfigDict(strict=True)

    capture: bool
    open_file: bool
    reveal_file: bool
    open_root: bool


class BackendStatus(BaseModel):
    model_config = ConfigDict(strict=True)

    backend_url: str
    portal_url: str
    root: Path
    service: BackendServiceStatus
    storage: BackendStorageStatus
    capabilities: BackendCapabilities
    ready: bool


class LibraryEntry(BaseModel):
    model_config = ConfigDict(strict=True)

    key: str
    stored_path: Path
    pdf_url: HttpUrl | None = None
    source_url: HttpUrl | None = None
    capture: CaptureMode | None = None
    original_sha256: str | None = None
    title: str
    has_note: bool
    first_read: str
    last_read: str
    invalid: bool = False
    error_message: str | None = None


class NoteContent(BaseModel):
    model_config = ConfigDict(strict=True)

    key: str
    text: str
    version: str | None = None


class NoteImageResult(BaseModel):
    model_config = ConfigDict(strict=True)

    relative_path: str


class ReadEventRequest(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")

    key: str
