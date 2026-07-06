from __future__ import annotations

from io import BytesIO
from pathlib import Path
from typing import cast

import pikepdf
from pydantic import HttpUrl

from mathread.models import CaptureMode, CaptureProvenance

MATHREAD_XMP_NS = "https://mathread.local/ns/provenance/1.0/"
MATHREAD_DOCINFO_KEYS = {
    "/MathReadCapture",
    "/MathReadPDFURL",
    "/MathReadSourceURL",
    "/MathReadOriginalSHA256",
    "/MathReadTitleHint",
}


def embed_provenance(pdf_bytes: bytes, provenance: CaptureProvenance) -> bytes:
    output = BytesIO()
    with pikepdf.open(BytesIO(pdf_bytes)) as pdf:
        with pdf.open_metadata() as metadata:
            metadata[f"{{{MATHREAD_XMP_NS}}}source-url"] = str(provenance.source_url)
            metadata[f"{{{MATHREAD_XMP_NS}}}pdf-url"] = str(provenance.pdf_url)
            metadata[f"{{{MATHREAD_XMP_NS}}}capture"] = provenance.capture
            metadata[f"{{{MATHREAD_XMP_NS}}}original-sha256"] = provenance.original_sha256
            if provenance.title_hint is not None:
                metadata[f"{{{MATHREAD_XMP_NS}}}title-hint"] = provenance.title_hint

        pdf.docinfo["/MathReadSourceURL"] = str(provenance.source_url)
        pdf.docinfo["/MathReadPDFURL"] = str(provenance.pdf_url)
        pdf.docinfo["/MathReadCapture"] = provenance.capture
        pdf.docinfo["/MathReadOriginalSHA256"] = provenance.original_sha256
        if provenance.title_hint is not None:
            pdf.docinfo["/MathReadTitleHint"] = provenance.title_hint

        pdf.save(output)

    return output.getvalue()


def read_original_sha256(path: str) -> str | None:
    with pikepdf.open(path) as pdf:
        value = pdf.docinfo.get("/MathReadOriginalSHA256")
    return None if value is None else str(value)


def read_capture_provenance(path: Path) -> CaptureProvenance:
    provenance = read_optional_capture_provenance(path)
    assert provenance is not None, f"Stored PDF has no MathRead provenance: {path}"
    return provenance


def read_optional_capture_provenance(path: Path) -> CaptureProvenance | None:
    with pikepdf.open(path) as pdf:
        docinfo = {str(key): str(value) for key, value in pdf.docinfo.items()}
    if not any(key in docinfo for key in MATHREAD_DOCINFO_KEYS):
        return None

    capture = required_docinfo(docinfo, path, "/MathReadCapture")
    assert capture in {"capture-url", "capture-bytes"}, f"Stored MathRead PDF has invalid capture mode: {path}"

    return CaptureProvenance(
        pdf_url=cast(HttpUrl, required_docinfo(docinfo, path, "/MathReadPDFURL")),
        source_url=cast(HttpUrl, required_docinfo(docinfo, path, "/MathReadSourceURL")),
        capture=cast(CaptureMode, capture),
        original_sha256=required_docinfo(docinfo, path, "/MathReadOriginalSHA256"),
        title_hint=docinfo.get("/MathReadTitleHint"),
    )


def required_docinfo(docinfo: dict[str, str], path: Path, key: str) -> str:
    value = docinfo.get(key)
    assert value is not None, f"Stored MathRead PDF is missing {key}: {path}"
    return value
