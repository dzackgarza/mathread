from __future__ import annotations

from hashlib import sha256
from os import W_OK, access
from pathlib import Path

from pydantic import validate_call

from mathread.metadata import embed_provenance, read_capture_provenance
from mathread.models import (
    CaptureBytesRequest,
    CaptureMode,
    CaptureProvenance,
    CaptureResult,
)
from mathread.naming import (
    destination_for_pdf,
    normalized_pdf_filename,
)


class InvalidPdfCaptureError(Exception):
    pass


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
    assert root.is_dir(), f"MathRead storage root must exist: {root}"
    assert access(root, W_OK), f"MathRead storage root must be writable: {root}"
    if not pdf_bytes.startswith(b"%PDF-"):
        raise InvalidPdfCaptureError from None

    original_sha256 = sha256(pdf_bytes).hexdigest()
    destination, existing = destination_for_pdf(
        root,
        normalized_pdf_filename(filename),
        original_sha256,
    )
    if existing:
        provenance = read_capture_provenance(destination)
        assert provenance.original_sha256 == original_sha256, f"Stored MathRead PDF provenance hash does not match captured PDF: {destination}"
        return CaptureResult(
            stored_path=destination,
            original_sha256=original_sha256,
            stored_sha256=sha256(destination.read_bytes()).hexdigest(),
            pdf_url=provenance.pdf_url,
            source_url=provenance.source_url,
            capture=provenance.capture,
            title_hint=provenance.title_hint,
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
    tmp_path = destination.with_suffix(".tmp")
    tmp_path.write_bytes(stored_bytes)
    tmp_path.replace(destination)

    return CaptureResult(
        stored_path=destination,
        original_sha256=original_sha256,
        stored_sha256=sha256(stored_bytes).hexdigest(),
        pdf_url=request.pdf_url,
        source_url=request.source_url,
        capture=capture,
        title_hint=request.title_hint,
        existing=False,
    )
