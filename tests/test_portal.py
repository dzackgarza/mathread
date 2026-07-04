from __future__ import annotations

from io import BytesIO
from pathlib import Path

import pikepdf
import pytest
from fastapi.testclient import TestClient

from mathread.server import create_app

PNG_PIXEL = bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c636060606000000005000180fdb8d40000000049454e44ae426082")


@pytest.fixture
def sample_pdf_bytes() -> bytes:
    output = BytesIO()
    pdf = pikepdf.Pdf.new()
    pdf.add_blank_page(page_size=(72, 72))
    pdf.save(output)
    return output.getvalue()


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    root = tmp_path / "reading-root"
    root.mkdir()
    return TestClient(create_app(root))


def capture(client: TestClient, sample_pdf_bytes: bytes, filename: str = "notes.pdf") -> str:
    """Populate the library via the real capture path; return the stored key."""
    response = client.post(
        "/capture-bytes",
        data={
            "source_url": "https://example.edu/course/",
            "pdf_url": "https://example.edu/course/notes.pdf",
            "title_hint": "Course page",
        },
        files={"pdf": (filename, sample_pdf_bytes, "application/pdf")},
    )
    assert response.status_code == 200
    return Path(response.json()["stored_path"]).name


def test_library_lists_captured_pdf_with_provenance_and_capture_time_read_baseline(
    client: TestClient,
    sample_pdf_bytes: bytes,
) -> None:
    key = capture(client, sample_pdf_bytes)

    response = client.get("/library")

    assert response.status_code == 200
    entries = response.json()
    assert len(entries) == 1
    entry = entries[0]
    assert entry["key"] == key
    assert entry["pdf_url"] == "https://example.edu/course/notes.pdf"
    assert entry["source_url"] == "https://example.edu/course/"
    assert entry["title"] == "Course page"
    assert entry["capture"] == "capture-bytes"
    assert entry["has_note"] is False
    # Never opened yet: read-state is seeded from the capture moment at the first page.
    assert entry["first_read"] == entry["last_read"]
    assert isinstance(entry["first_read"], str)
    assert entry["last_position"] == 0.0


def test_library_title_falls_back_to_stem_when_title_hint_is_blank(
    client: TestClient,
    sample_pdf_bytes: bytes,
) -> None:
    # A direct PDF navigation captures before the browser sets document.title, so the
    # extension can legitimately send an empty hint; a blank hint is not a title.
    response = client.post(
        "/capture-bytes",
        data={
            "source_url": "https://arxiv.org/pdf/1703.05882",
            "pdf_url": "https://arxiv.org/pdf/1703.05882",
            "title_hint": "  ",
        },
        files={"pdf": ("1703.05882.pdf", sample_pdf_bytes, "application/pdf")},
    )
    assert response.status_code == 200

    entries = client.get("/library").json()
    assert len(entries) == 1
    assert entries[0]["title"] == "1703.05882"


def test_note_round_trip_writes_sidecar_next_to_pdf(
    client: TestClient,
    sample_pdf_bytes: bytes,
    tmp_path: Path,
) -> None:
    key = capture(client, sample_pdf_bytes)

    put = client.put(f"/notes/{key}", json={"key": key, "text": "# Reading notes\n\nlattice stuff"})
    assert put.status_code == 200

    sidecar = tmp_path / "reading-root" / "inbox" / "notes.md"
    assert sidecar.read_text(encoding="utf-8") == "# Reading notes\n\nlattice stuff"

    get = client.get(f"/notes/{key}")
    assert get.status_code == 200
    assert get.json()["text"] == "# Reading notes\n\nlattice stuff"

    listed = client.get("/library").json()
    assert listed[0]["has_note"] is True


def test_get_note_returns_empty_when_no_sidecar_yet(
    client: TestClient,
    sample_pdf_bytes: bytes,
) -> None:
    key = capture(client, sample_pdf_bytes)

    get = client.get(f"/notes/{key}")

    assert get.status_code == 200
    assert get.json()["text"] == ""


def test_note_image_written_relative_to_note_and_png_validated(
    client: TestClient,
    sample_pdf_bytes: bytes,
    tmp_path: Path,
) -> None:
    key = capture(client, sample_pdf_bytes)
    inbox = tmp_path / "reading-root" / "inbox"

    first = client.post(f"/notes/{key}/image", files={"image": ("clip.png", PNG_PIXEL, "image/png")})
    assert first.status_code == 200
    assert first.json()["relative_path"] == "notes.assets/clip-01.png"
    assert (inbox / "notes.assets" / "clip-01.png").read_bytes() == PNG_PIXEL

    second = client.post(f"/notes/{key}/image", files={"image": ("clip.png", PNG_PIXEL, "image/png")})
    assert second.json()["relative_path"] == "notes.assets/clip-02.png"

    not_png = client.post(f"/notes/{key}/image", files={"image": ("x.png", b"not a png", "image/png")})
    assert not_png.status_code == 400


def test_note_asset_served_back_for_preview_and_traversal_rejected(
    client: TestClient,
    sample_pdf_bytes: bytes,
) -> None:
    key = capture(client, sample_pdf_bytes)
    uploaded = client.post(f"/notes/{key}/image", files={"image": ("clip.png", PNG_PIXEL, "image/png")})
    assert uploaded.status_code == 200

    served = client.get(f"/notes/{key}/assets/clip-01.png")
    assert served.status_code == 200
    assert served.content == PNG_PIXEL
    assert served.headers["content-type"] == "image/png"

    assert client.get(f"/notes/{key}/assets/missing.png").status_code == 404
    assert client.get(f"/notes/{key}/assets/..%2Fnotes.pdf").status_code == 404


def test_read_event_sets_first_read_once_and_updates_last_position(
    client: TestClient,
    sample_pdf_bytes: bytes,
) -> None:
    key = capture(client, sample_pdf_bytes)

    first = client.post("/read-event", json={"key": key, "position": 0.25})
    assert first.status_code == 204
    after_first = client.get("/library").json()[0]
    assert after_first["first_read"] is not None
    assert after_first["last_position"] == 0.25

    client.post("/read-event", json={"key": key, "position": 0.9})
    after_second = client.get("/library").json()[0]
    assert after_second["first_read"] == after_first["first_read"]
    assert after_second["last_read"] is not None
    assert after_second["last_position"] == 0.9


def test_delete_removes_pdf_sidecar_assets_and_history(
    client: TestClient,
    sample_pdf_bytes: bytes,
    tmp_path: Path,
) -> None:
    key = capture(client, sample_pdf_bytes)
    inbox = tmp_path / "reading-root" / "inbox"
    client.put(f"/notes/{key}", json={"key": key, "text": "notes"})
    client.post(f"/notes/{key}/image", files={"image": ("clip.png", PNG_PIXEL, "image/png")})
    client.post("/read-event", json={"key": key, "position": 0.4})
    assert (inbox / "notes.pdf").is_file()
    assert (inbox / "notes.md").is_file()
    assert (inbox / "notes.assets" / "clip-01.png").is_file()
    assert key in (tmp_path / "reading-root" / "library.json").read_text(encoding="utf-8")

    response = client.delete(f"/library/{key}")

    assert response.status_code == 204
    assert not (inbox / "notes.pdf").exists()
    assert not (inbox / "notes.md").exists()
    assert not (inbox / "notes.assets").exists()
    assert key not in (tmp_path / "reading-root" / "library.json").read_text(encoding="utf-8")
    assert client.get("/library").json() == []


def test_delete_unknown_key_is_404(client: TestClient) -> None:
    assert client.delete("/library/ghost.pdf").status_code == 404


def test_unknown_key_is_404_across_note_image_and_read_event(client: TestClient) -> None:
    assert client.get("/notes/ghost.pdf").status_code == 404
    assert client.put("/notes/ghost.pdf", json={"key": "ghost.pdf", "text": "x"}).status_code == 404
    assert client.post("/notes/ghost.pdf/image", files={"image": ("c.png", PNG_PIXEL, "image/png")}).status_code == 404
    assert client.post("/read-event", json={"key": "ghost.pdf", "position": 0.1}).status_code == 404


def test_key_path_traversal_is_rejected(client: TestClient) -> None:
    assert client.get("/notes/..%2f..%2fetc%2fpasswd").status_code in (400, 404)
