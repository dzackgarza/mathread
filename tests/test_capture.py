from __future__ import annotations

from collections.abc import Iterator
from functools import partial
from hashlib import sha256
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from pathlib import Path
from threading import Thread

import pikepdf
import pytest
from fastapi.testclient import TestClient

from mathread.capture import capture_bytes
from mathread.models import CaptureBytesRequest
from mathread.server import create_app


@pytest.fixture
def sample_pdf_bytes() -> bytes:
    output = BytesIO()
    pdf = pikepdf.Pdf.new()
    pdf.add_blank_page(page_size=(72, 72))
    pdf.save(output)
    return output.getvalue()


@pytest.fixture
def pdf_server(
    tmp_path: Path,
    sample_pdf_bytes: bytes,
) -> Iterator[str]:
    webroot = tmp_path / "web"
    webroot.mkdir()
    (webroot / "notes.pdf").write_bytes(sample_pdf_bytes)

    handler = partial(SimpleHTTPRequestHandler, directory=str(webroot))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()

    yield f"http://127.0.0.1:{server.server_port}/notes.pdf"

    server.shutdown()
    thread.join()


def test_capture_url_downloads_pdf_and_embeds_provenance(
    tmp_path: Path,
    pdf_server: str,
) -> None:
    client = TestClient(create_app(tmp_path / "reading-root"))

    response = client.post(
        "/capture-url",
        json={
            "pdf_url": pdf_server,
            "source_url": "https://example.edu/course/",
            "title_hint": "Course page",
            "headers": {"referer": "https://example.edu/course/"},
        },
    )

    assert response.status_code == 200
    result = response.json()
    stored_path = Path(result["stored_path"])
    metadata = pdf_docinfo(stored_path)

    assert result["capture"] == "capture-url"
    assert result["source_url"] == "https://example.edu/course/"
    assert result["pdf_url"] == pdf_server
    assert metadata["/MathReadSourceURL"] == "https://example.edu/course/"
    assert metadata["/MathReadPDFURL"] == pdf_server
    assert metadata["/MathReadCapture"] == "capture-url"
    assert metadata["/MathReadOriginalSHA256"] == result["original_sha256"]


def test_capture_bytes_stores_browser_authenticated_pdf_bytes(
    tmp_path: Path,
    sample_pdf_bytes: bytes,
) -> None:
    client = TestClient(create_app(tmp_path / "reading-root"))

    response = client.post(
        "/capture-bytes",
        data={
            "source_url": "https://example.edu/private/course/",
            "pdf_url": "https://example.edu/private/notes.pdf",
            "title_hint": "Private course page",
        },
        files={"pdf": ("private-notes.pdf", sample_pdf_bytes, "application/pdf")},
    )

    assert response.status_code == 200
    result = response.json()
    metadata = pdf_docinfo(Path(result["stored_path"]))

    assert result["capture"] == "capture-bytes"
    assert Path(result["stored_path"]).name == "private-notes.pdf"
    assert metadata["/MathReadSourceURL"] == "https://example.edu/private/course/"
    assert metadata["/MathReadPDFURL"] == "https://example.edu/private/notes.pdf"
    assert metadata["/MathReadCapture"] == "capture-bytes"


def test_same_filename_reuses_same_pdf_and_splits_different_hashes(
    tmp_path: Path,
    sample_pdf_bytes: bytes,
) -> None:
    request = CaptureBytesRequest.model_validate(
        {
            "source_url": "https://example.edu/course/",
            "pdf_url": "https://example.edu/course/notes.pdf",
            "title_hint": "Course page",
        }
    )

    first = capture_bytes(tmp_path, request, sample_pdf_bytes, "notes.pdf")
    second = capture_bytes(tmp_path, request, sample_pdf_bytes, "notes.pdf")
    different = capture_bytes(tmp_path, request, altered_pdf_bytes(), "notes.pdf")

    assert second.existing is True
    assert second.stored_path == first.stored_path
    assert different.existing is False
    assert different.stored_path.name == f"notes--{different.original_sha256[:12]}.pdf"
    assert different.original_sha256 != first.original_sha256


def pdf_docinfo(path: Path) -> dict[str, str]:
    with pikepdf.open(path) as pdf:
        return {str(key): str(value) for key, value in pdf.docinfo.items()}


def altered_pdf_bytes() -> bytes:
    output = BytesIO()
    pdf = pikepdf.Pdf.new()
    pdf.add_blank_page(page_size=(144, 144))
    pdf.save(output)
    bytes_ = output.getvalue()
    assert sha256(bytes_).hexdigest() != ""
    return bytes_
