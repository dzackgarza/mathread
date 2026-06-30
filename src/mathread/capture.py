from __future__ import annotations

from hashlib import sha256
from pathlib import Path

import httpx
from pydantic import validate_call

from mathread.metadata import embed_provenance
from mathread.models import (
    CaptureBytesRequest,
    CaptureMode,
    CaptureProvenance,
    CaptureResult,
    CaptureUrlRequest,
)
from mathread.naming import (
    destination_for_pdf,
    filename_from_response,
    normalized_pdf_filename,
)


@validate_call
def capture_url(root: Path, request: CaptureUrlRequest) -> CaptureResult:
    with httpx.Client(follow_redirects=True) as client:
        response = client.get(str(request.pdf_url), headers=request.headers)
        response.raise_for_status()

    filename = filename_from_response(
        str(response.url),
        response.headers.get("content-disposition"),
    )
    return store_pdf(
        root=root,
        pdf_bytes=response.content,
        request=CaptureBytesRequest(
            pdf_url=request.pdf_url,
            source_url=request.source_url,
            title_hint=request.title_hint,
        ),
        capture="capture-url",
        filename=filename,
    )


@validate_call
def capture_bytes(
    root: Path,
    request: CaptureBytesRequest,
    pdf_bytes: bytes,
    filename: str,
) -> CaptureResult:
    return store_pdf(
        root=root,
        pdf_bytes=pdf_bytes,
        request=request,
        capture="capture-bytes",
        filename=filename,
    )


def store_pdf(
    root: Path,
    pdf_bytes: bytes,
    request: CaptureBytesRequest,
    capture: CaptureMode,
    filename: str,
) -> CaptureResult:
    assert pdf_bytes.startswith(b"%PDF-"), "captured bytes must be a PDF"

    original_sha256 = sha256(pdf_bytes).hexdigest()
    inbox = root / "inbox"
    inbox.mkdir(parents=True, exist_ok=True)

    destination, existing = destination_for_pdf(
        inbox,
        normalized_pdf_filename(filename),
        original_sha256,
    )
    if existing:
        return CaptureResult(
            stored_path=destination,
            original_sha256=original_sha256,
            stored_sha256=sha256(destination.read_bytes()).hexdigest(),
            pdf_url=request.pdf_url,
            source_url=request.source_url,
            capture=capture,
            existing=True,
        )

    stored_bytes = embed_provenance(
        pdf_bytes,
        CaptureProvenance(
            pdf_url=request.pdf_url,
            source_url=request.source_url,
            capture=capture,
            original_sha256=original_sha256,
            title_hint=request.title_hint,
        ),
    )
    destination.write_bytes(stored_bytes)

    return CaptureResult(
        stored_path=destination,
        original_sha256=original_sha256,
        stored_sha256=sha256(stored_bytes).hexdigest(),
        pdf_url=request.pdf_url,
        source_url=request.source_url,
        capture=capture,
        existing=False,
    )
