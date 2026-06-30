from __future__ import annotations

from io import BytesIO

import pikepdf

from mathread.models import CaptureProvenance

MATHREAD_XMP_NS = "https://mathread.local/ns/provenance/1.0/"


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
