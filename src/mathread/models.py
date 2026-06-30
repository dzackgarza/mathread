from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl

type CaptureMode = Literal["capture-url", "capture-bytes"]


class CaptureUrlRequest(BaseModel):
    model_config = ConfigDict(strict=True)

    pdf_url: HttpUrl
    source_url: HttpUrl
    title_hint: str | None = None
    headers: dict[str, str] = Field(default_factory=dict)


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
    existing: bool
