from __future__ import annotations

import subprocess
from collections.abc import Iterator
from dataclasses import dataclass
from functools import partial
from hashlib import sha256
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from os import environ
from pathlib import Path
from threading import Thread
from typing import TextIO

import httpx
import pikepdf
import pytest
from fastapi.testclient import TestClient

from mathread.server import create_app

REPO_ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class RunningMathReadService:
    base_url: str
    root: Path


@dataclass
class PdfServerRequest:
    path: str
    referer: str | None
    cookie: str | None


@dataclass
class RunningPdfServer:
    pdf_url: str
    requests: list[PdfServerRequest]


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


@pytest.fixture
def authenticated_pdf_server(
    sample_pdf_bytes: bytes,
) -> Iterator[RunningPdfServer]:
    requests: list[PdfServerRequest] = []

    class AuthenticatedPdfHandler(SimpleHTTPRequestHandler):
        def do_GET(self) -> None:
            requests.append(
                PdfServerRequest(
                    path=self.path,
                    referer=self.headers.get("referer"),
                    cookie=self.headers.get("cookie"),
                )
            )
            if self.path != "/notes.pdf":
                self.send_response(404)
                self.end_headers()
                return

            if self.headers.get("referer") != "https://example.edu/course/" or self.headers.get("cookie") != "mathread_session=service-test":
                self.send_response(403)
                self.end_headers()
                return

            self.send_response(200)
            self.send_header("content-type", "application/pdf")
            self.send_header("content-disposition", 'attachment; filename="notes.pdf"')
            self.end_headers()
            self.wfile.write(sample_pdf_bytes)

        def log_message(self, format: str, *args: object) -> None:
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), AuthenticatedPdfHandler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()

    yield RunningPdfServer(
        pdf_url=f"http://127.0.0.1:{server.server_port}/notes.pdf",
        requests=requests,
    )

    server.shutdown()
    thread.join()


@pytest.fixture
def mathread_service(
    tmp_path: Path,
    free_tcp_port: int,
    request: pytest.FixtureRequest,
) -> RunningMathReadService:
    root = tmp_path / "service-root"
    log = (tmp_path / "mathread-service.log").open("w")
    uv = Path.home() / ".local/bin/uv"
    assert uv.exists(), f"uv executable must exist at {uv}"

    process = subprocess.Popen(
        [
            str(uv),
            "run",
            "--project",
            str(REPO_ROOT),
            "mathread",
            "serve",
            "--host",
            "127.0.0.1",
            "--port",
            str(free_tcp_port),
        ],
        env={**environ, "MATHREAD_ROOT": str(root)},
        stdout=log,
        stderr=subprocess.STDOUT,
        text=True,
    )
    request.addfinalizer(partial(stop_service_process, process, log))

    base_url = f"http://127.0.0.1:{free_tcp_port}"
    wait_for_http_service(f"{base_url}/openapi.json", log)
    return RunningMathReadService(base_url=base_url, root=root)


def test_capture_url_downloads_pdf_and_embeds_provenance(
    tmp_path: Path,
    pdf_server: str,
) -> None:
    reading_root = tmp_path / "reading-root"
    reading_root.mkdir()
    client = TestClient(create_app(reading_root))

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


def test_status_reports_ready_storage_contract_for_existing_root(tmp_path: Path) -> None:
    reading_root = tmp_path / "reading-root"
    reading_root.mkdir()
    client = TestClient(create_app(reading_root), base_url="http://127.0.0.1:8765")

    response = client.get("/status")

    assert response.status_code == 200
    assert response.json() == {
        "backend_url": "http://127.0.0.1:8765",
        "portal_url": "http://markdown-editor.localhost",
        "root": str(reading_root),
        "inbox": str(reading_root / "inbox"),
        "service": {
            "name": "mathread",
            "version": "1.0.0",
        },
        "storage": {
            "root_exists": True,
            "root_writable": True,
            "inbox_exists": False,
            "inbox_writable": False,
        },
        "capabilities": {
            "capture": True,
            "open_file": True,
            "reveal_file": False,
            "open_root": False,
        },
        "ready": True,
    }
    assert not (reading_root / "inbox").exists()


def test_status_reports_missing_root_as_not_ready_without_creating_storage(tmp_path: Path) -> None:
    reading_root = tmp_path / "missing-reading-root"
    client = TestClient(create_app(reading_root), base_url="http://127.0.0.1:8765")

    response = client.get("/status")

    assert response.status_code == 200
    assert response.json() == {
        "backend_url": "http://127.0.0.1:8765",
        "portal_url": "http://markdown-editor.localhost",
        "root": str(reading_root),
        "inbox": str(reading_root / "inbox"),
        "service": {
            "name": "mathread",
            "version": "1.0.0",
        },
        "storage": {
            "root_exists": False,
            "root_writable": False,
            "inbox_exists": False,
            "inbox_writable": False,
        },
        "capabilities": {
            "capture": False,
            "open_file": True,
            "reveal_file": False,
            "open_root": False,
        },
        "ready": False,
    }
    assert not reading_root.exists()


def test_capture_bytes_stores_browser_authenticated_pdf_bytes(
    tmp_path: Path,
    sample_pdf_bytes: bytes,
) -> None:
    reading_root = tmp_path / "reading-root"
    reading_root.mkdir()
    client = TestClient(create_app(reading_root))

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


def test_cli_capture_url_forwards_headers_and_stores_pdf_with_provenance(
    mathread_service: RunningMathReadService,
    authenticated_pdf_server: RunningPdfServer,
    sample_pdf_bytes: bytes,
) -> None:
    response = httpx.post(
        f"{mathread_service.base_url}/capture-url",
        json={
            "pdf_url": authenticated_pdf_server.pdf_url,
            "source_url": "https://example.edu/course/",
            "title_hint": "Course page",
            "headers": {
                "referer": "https://example.edu/course/",
                "cookie": "mathread_session=service-test",
            },
        },
    )

    assert response.status_code == 200
    result = response.json()
    stored_path = Path(result["stored_path"])
    metadata = pdf_docinfo(stored_path)

    assert authenticated_pdf_server.requests == [
        PdfServerRequest(
            path="/notes.pdf",
            referer="https://example.edu/course/",
            cookie="mathread_session=service-test",
        )
    ]
    assert stored_path == mathread_service.root / "inbox" / "notes.pdf"
    assert result["original_sha256"] == sha256(sample_pdf_bytes).hexdigest()
    assert result["stored_sha256"] == sha256(stored_path.read_bytes()).hexdigest()
    assert result["capture"] == "capture-url"
    assert result["source_url"] == "https://example.edu/course/"
    assert result["pdf_url"] == authenticated_pdf_server.pdf_url
    assert result["title_hint"] == "Course page"
    assert metadata["/MathReadSourceURL"] == "https://example.edu/course/"
    assert metadata["/MathReadPDFURL"] == authenticated_pdf_server.pdf_url
    assert metadata["/MathReadCapture"] == "capture-url"
    assert metadata["/MathReadOriginalSHA256"] == result["original_sha256"]
    assert metadata["/MathReadTitleHint"] == result["title_hint"]


def test_cli_service_uses_mathread_root_and_accepts_real_http_capture(
    mathread_service: RunningMathReadService,
    sample_pdf_bytes: bytes,
) -> None:
    response = httpx.post(
        f"{mathread_service.base_url}/capture-bytes",
        data={
            "source_url": "https://example.edu/service/course/",
            "pdf_url": "https://example.edu/service/notes.pdf",
            "title_hint": "Service course page",
        },
        files={"pdf": ("service-notes.pdf", sample_pdf_bytes, "application/pdf")},
    )

    assert response.status_code == 200
    result = response.json()
    stored_path = Path(result["stored_path"])
    metadata = pdf_docinfo(stored_path)

    assert stored_path == mathread_service.root / "inbox" / "service-notes.pdf"
    assert result["original_sha256"] == sha256(sample_pdf_bytes).hexdigest()
    assert result["stored_sha256"] == sha256(stored_path.read_bytes()).hexdigest()
    assert result["capture"] == "capture-bytes"
    assert metadata["/MathReadSourceURL"] == "https://example.edu/service/course/"
    assert metadata["/MathReadPDFURL"] == "https://example.edu/service/notes.pdf"
    assert metadata["/MathReadCapture"] == "capture-bytes"
    assert metadata["/MathReadOriginalSHA256"] == result["original_sha256"]


def test_cli_service_reuses_matching_pdf_and_splits_same_filename_different_hash(
    mathread_service: RunningMathReadService,
    sample_pdf_bytes: bytes,
) -> None:
    first_response = post_capture_bytes(
        mathread_service,
        sample_pdf_bytes,
        "notes.pdf",
    )
    second_response = post_capture_bytes(
        mathread_service,
        sample_pdf_bytes,
        "notes.pdf",
        source_url="https://example.edu/other-course/",
        pdf_url="https://example.edu/other-course/notes.pdf",
        title_hint="Other course page",
    )
    different_pdf_bytes = altered_pdf_bytes()
    different_response = post_capture_bytes(
        mathread_service,
        different_pdf_bytes,
        "notes.pdf",
    )

    assert first_response.status_code == 200
    assert second_response.status_code == 200
    assert different_response.status_code == 200

    first = first_response.json()
    second = second_response.json()
    different = different_response.json()
    first_path = Path(first["stored_path"])
    different_path = Path(different["stored_path"])

    assert first["existing"] is False
    assert first["original_sha256"] == sha256(sample_pdf_bytes).hexdigest()
    assert first["stored_sha256"] == sha256(first_path.read_bytes()).hexdigest()
    assert second["existing"] is True
    assert Path(second["stored_path"]) == first_path
    assert second["original_sha256"] == first["original_sha256"]
    assert second["source_url"] == first["source_url"]
    assert second["pdf_url"] == first["pdf_url"]
    assert second["capture"] == first["capture"]
    assert second["title_hint"] == first["title_hint"]
    assert different["existing"] is False
    assert different["original_sha256"] == sha256(different_pdf_bytes).hexdigest()
    assert different["original_sha256"] != first["original_sha256"]
    assert different_path == (mathread_service.root / "inbox" / f"notes--{different['original_sha256'][:12]}.pdf")
    assert different["stored_sha256"] == sha256(different_path.read_bytes()).hexdigest()


def test_cli_service_rejects_invalid_pdf_input_without_storing_success_artifact(
    mathread_service: RunningMathReadService,
) -> None:
    response = post_capture_bytes(mathread_service, b"<html><body>not a pdf</body></html>", "not-a-pdf.pdf")

    assert list((mathread_service.root / "inbox").glob("*.pdf")) == []
    assert 400 <= response.status_code < 500


def wait_for_http_service(url: str, log: TextIO) -> None:
    completed = subprocess.run(
        [
            "curl",
            "--fail",
            "--silent",
            "--show-error",
            "--output",
            "/dev/null",
            "--retry",
            "50",
            "--retry-connrefused",
            "--retry-delay",
            "0",
            "--retry-max-time",
            "10",
            url,
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    log.flush()
    assert completed.returncode == 0, completed.stderr


def stop_service_process(process: subprocess.Popen[str], log: TextIO) -> None:
    if process.poll() is None:
        process.terminate()
        process.wait(timeout=10)
    log.close()


def pdf_docinfo(path: Path) -> dict[str, str]:
    with pikepdf.open(path) as pdf:
        return {str(key): str(value) for key, value in pdf.docinfo.items()}


def post_capture_bytes(
    mathread_service: RunningMathReadService,
    pdf_bytes: bytes,
    filename: str,
    *,
    source_url: str = "https://example.edu/course/",
    pdf_url: str = "https://example.edu/course/notes.pdf",
    title_hint: str = "Course page",
) -> httpx.Response:
    return httpx.post(
        f"{mathread_service.base_url}/capture-bytes",
        data={
            "source_url": source_url,
            "pdf_url": pdf_url,
            "title_hint": title_hint,
        },
        files={"pdf": (filename, pdf_bytes, "application/pdf")},
    )


def altered_pdf_bytes() -> bytes:
    output = BytesIO()
    pdf = pikepdf.Pdf.new()
    pdf.add_blank_page(page_size=(144, 144))
    pdf.save(output)
    return output.getvalue()
