from __future__ import annotations

import sys
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path

import pikepdf
import pytest
from fastapi.testclient import TestClient

from mathread.server import create_app

PNG_PIXEL = bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c636060606000000005000180fdb8d40000000049454e44ae426082")
CAPTURED_PAPER_KEY = "https___example.edu_course_notes.pdf"


def iso_mtime(path: Path) -> str:
    return datetime.fromtimestamp(path.stat().st_mtime, UTC).isoformat()


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


def stored_pdf_path(root: Path, key: str) -> Path:
    path = root / key
    assert path.is_file(), f"Stored PDF for {key} was not found in the library root"
    return path


def note_sidecar_path(root: Path, key: str) -> Path:
    return stored_pdf_path(root, key).with_suffix(".md")


def test_library_lists_captured_pdf_with_provenance_and_entry_read_time(
    client: TestClient,
    sample_pdf_bytes: bytes,
    tmp_path: Path,
) -> None:
    key = capture(client, sample_pdf_bytes)
    expected_read_time = iso_mtime(tmp_path / "reading-root" / key)

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
    assert entry["first_read"] == expected_read_time
    assert entry["last_read"] == expected_read_time


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


def test_note_round_trip_writes_markdown_file_next_to_pdf(
    client: TestClient,
    sample_pdf_bytes: bytes,
    tmp_path: Path,
) -> None:
    key = capture(client, sample_pdf_bytes)

    put = client.put(f"/notes/{key}", json={"key": key, "text": "# Reading notes\n\nlattice stuff"})
    assert put.status_code == 200

    note_path = tmp_path / "reading-root" / "notes.md"
    assert note_path.read_text(encoding="utf-8") == "# Reading notes\n\nlattice stuff"

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


def test_note_put_rejects_stale_sidecar_write(
    client: TestClient,
    sample_pdf_bytes: bytes,
    tmp_path: Path,
) -> None:
    key = capture(client, sample_pdf_bytes)
    root = tmp_path / "reading-root"

    first = client.put(f"/notes/{key}", json={"key": key, "text": "original tab buffer", "version": ""})
    assert first.status_code == 200
    sidecar = note_sidecar_path(root, key)
    sidecar.write_text("disk edit from another tab\n", encoding="utf-8")

    stale = client.put(
        f"/notes/{key}",
        json={
            "key": key,
            "text": "stale tab overwrite",
            "version": first.json()["version"],
        },
    )

    assert stale.status_code == 409
    assert sidecar.read_text(encoding="utf-8") == "disk edit from another tab\n"


def test_note_image_written_relative_to_note_and_png_validated(
    client: TestClient,
    sample_pdf_bytes: bytes,
    tmp_path: Path,
) -> None:
    key = capture(client, sample_pdf_bytes)
    root = tmp_path / "reading-root"
    note_path = root / "notes.md"
    clips_dir = root / "clips" / CAPTURED_PAPER_KEY
    note_text = "# Durable reading note\n"
    saved_note = client.put(
        f"/notes/{key}",
        json={"key": key, "text": note_text},
    )
    assert saved_note.status_code == 200
    assert note_path.read_text(encoding="utf-8") == note_text

    first = client.post(f"/notes/{key}/image", files={"image": ("clip.png", PNG_PIXEL, "image/png")})
    assert first.status_code == 200
    first_relative_path = first.json()["relative_path"]
    first_image = clips_dir / "clip-01.png"
    assert (note_path.parent / first_relative_path).resolve() == first_image.resolve()
    assert first_image.read_bytes() == PNG_PIXEL

    second = client.post(f"/notes/{key}/image", files={"image": ("clip.png", PNG_PIXEL, "image/png")})
    second_relative_path = second.json()["relative_path"]
    second_image = clips_dir / "clip-02.png"
    assert (note_path.parent / second_relative_path).resolve() == second_image.resolve()
    assert second_image.read_bytes() == PNG_PIXEL

    not_png = client.post(f"/notes/{key}/image", files={"image": ("x.png", b"not a png", "image/png")})
    assert not_png.status_code == 400


def test_note_image_uses_paper_keyed_tree_and_never_overwrites_existing_clips(
    client: TestClient,
    sample_pdf_bytes: bytes,
    tmp_path: Path,
) -> None:
    key = capture(client, sample_pdf_bytes)
    root = tmp_path / "reading-root"

    first = client.post(f"/notes/{key}/image", files={"image": ("clip.png", PNG_PIXEL, "image/png")})
    second = client.post(f"/notes/{key}/image", files={"image": ("clip.png", PNG_PIXEL, "image/png")})

    assert first.status_code == 200
    assert second.status_code == 200
    first_path = first.json()["relative_path"]
    second_path = second.json()["relative_path"]
    assert first_path != second_path
    note_parent = (root / key).with_suffix(".md").parent
    assert (note_parent / first_path).resolve().read_bytes() == PNG_PIXEL
    assert (note_parent / second_path).resolve().read_bytes() == PNG_PIXEL


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


def test_read_event_rejects_extra_payload_without_mutating_recency(
    client: TestClient,
    sample_pdf_bytes: bytes,
) -> None:
    key = capture(client, sample_pdf_bytes)
    before = client.get("/library").json()[0]

    response = client.post("/read-event", json={"key": key, "extra": "not accepted"})

    assert response.status_code == 422
    after = client.get("/library").json()[0]
    assert after["first_read"] == before["first_read"]
    assert after["last_read"] == before["last_read"]


def test_read_event_preserves_entry_first_read_and_updates_last_read(
    client: TestClient,
    sample_pdf_bytes: bytes,
) -> None:
    import time

    key = capture(client, sample_pdf_bytes)
    before = client.get("/library").json()[0]

    time.sleep(0.001)
    first = client.post("/read-event", json={"key": key})
    assert first.status_code == 204
    after_first = client.get("/library").json()[0]
    assert after_first["first_read"] == before["first_read"]
    assert after_first["last_read"] > before["last_read"]

    time.sleep(0.001)
    second = client.post("/read-event", json={"key": key})
    assert second.status_code == 204
    after_second = client.get("/library").json()[0]
    assert after_second["first_read"] == after_first["first_read"]
    assert after_second["last_read"] > after_first["last_read"]


def test_read_history_uses_sqlite_transactions_for_parallel_open_events(
    client: TestClient,
    sample_pdf_bytes: bytes,
    tmp_path: Path,
) -> None:
    import concurrent.futures
    import sqlite3

    root = tmp_path / "reading-root"
    keys = [capture(client, sample_pdf_bytes, f"paper-{index}.pdf") for index in range(8)]

    def record(index: int) -> None:
        response = client.post("/read-event", json={"key": keys[index]})
        assert response.status_code == 204

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        futures = [executor.submit(record, index) for index in range(len(keys))]
        for future in concurrent.futures.as_completed(futures):
            future.result()

    db_path = root / "library.db"
    assert db_path.is_file()
    conn = sqlite3.connect(str(db_path))
    columns = [row[1] for row in conn.execute("PRAGMA table_info(read_history)").fetchall()]
    rows = {key: {"first_read": first_read, "last_read": last_read} for key, first_read, last_read in conn.execute("SELECT key, first_read, last_read FROM read_history")}
    conn.close()
    assert columns == ["key", "first_read", "last_read"]
    assert set(rows) == set(keys)
    for key in keys:
        assert isinstance(rows[key]["first_read"], str)
        assert isinstance(rows[key]["last_read"], str)


def test_folder_scan_surfaces_local_and_invalid_pdfs_without_crashing(
    sample_pdf_bytes: bytes,
    tmp_path: Path,
) -> None:
    root = tmp_path / "reading-root"
    root.mkdir()
    client = TestClient(create_app(root), raise_server_exceptions=False)
    key = capture(client, sample_pdf_bytes)
    storage_dir = stored_pdf_path(root, key).parent
    (storage_dir / "local.pdf").write_bytes(sample_pdf_bytes)
    (storage_dir / "broken.pdf").write_bytes(b"not a valid pdf")

    response = client.get("/library")

    assert response.status_code == 200
    entries = {entry["key"]: entry for entry in response.json()}
    assert entries["local.pdf"]["pdf_url"] is None
    assert entries["local.pdf"]["source_url"] is None
    assert entries["local.pdf"]["invalid"] is False
    assert entries["broken.pdf"]["invalid"] is True
    assert entries["broken.pdf"]["error_message"]


def test_parallel_open_events_update_each_entry_recency(
    client: TestClient,
    sample_pdf_bytes: bytes,
) -> None:
    import concurrent.futures

    keys = [f"paper-{index}.pdf" for index in range(12)]
    for key in keys:
        client.post(
            "/capture-bytes",
            data={
                "source_url": f"https://example.edu/course/{key}",
                "pdf_url": f"https://example.edu/course/{key}",
                "title_hint": key,
            },
            files={"pdf": (key, sample_pdf_bytes, "application/pdf")},
        )

    def record(index: int) -> None:
        response = client.post("/read-event", json={"key": keys[index]})
        assert response.status_code == 204

    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
        futures = [executor.submit(record, index) for index in range(len(keys))]
        for future in concurrent.futures.as_completed(futures):
            future.result()

    entries = {entry["key"]: entry for entry in client.get("/library").json()}
    assert set(entries) == set(keys)
    for key in keys:
        assert isinstance(entries[key]["first_read"], str)
        assert isinstance(entries[key]["last_read"], str)


def test_delete_removes_pdf_note_clips_and_history(
    client: TestClient,
    sample_pdf_bytes: bytes,
    tmp_path: Path,
) -> None:
    import sqlite3

    key = capture(client, sample_pdf_bytes)
    root = tmp_path / "reading-root"
    clips_dir = root / "clips" / CAPTURED_PAPER_KEY

    client.put(f"/notes/{key}", json={"key": key, "text": "notes"})
    client.post(f"/notes/{key}/image", files={"image": ("clip.png", PNG_PIXEL, "image/png")})
    client.post("/read-event", json={"key": key})
    assert (root / "notes.pdf").is_file()
    assert (root / "notes.md").is_file()
    assert (clips_dir / "clip-01.png").is_file()

    db_path = tmp_path / "reading-root" / "library.db"
    assert db_path.is_file()
    conn = sqlite3.connect(str(db_path))
    row = conn.execute("SELECT key FROM read_history WHERE key = ?", (key,)).fetchone()
    assert row is not None
    conn.close()

    response = client.delete(f"/library/{key}")

    assert response.status_code == 204
    assert not (root / "notes.pdf").exists()
    assert not (root / "notes.md").exists()
    assert not clips_dir.exists()

    conn = sqlite3.connect(str(db_path))
    row = conn.execute("SELECT key FROM read_history WHERE key = ?", (key,)).fetchone()
    assert row is None
    conn.close()
    assert client.get("/library").json() == []


def test_open_root_endpoint_runs_file_browser_command_against_library_root(tmp_path: Path) -> None:
    reading_root = tmp_path / "reading-root"
    reading_root.mkdir()
    script = "import pathlib, sys; pathlib.Path(sys.argv[1], 'opened-by-mathread.txt').write_text('opened', encoding='utf-8')"
    client = TestClient(create_app(reading_root, open_root_command=(sys.executable, "-c", script)))

    response = client.post("/library/open-root")

    assert response.status_code == 204
    assert (reading_root / "opened-by-mathread.txt").read_text(encoding="utf-8") == "opened"


def test_list_library_handles_provenance_less_pdf(
    client: TestClient,
    sample_pdf_bytes: bytes,
    tmp_path: Path,
) -> None:
    root = tmp_path / "reading-root"

    # Save a PDF directly to the library root without provenance metadata.
    (root / "local.pdf").write_bytes(sample_pdf_bytes)

    response = client.get("/library")
    assert response.status_code == 200
    entries = response.json()
    assert len(entries) == 1
    entry = entries[0]
    assert entry["key"] == "local.pdf"
    assert entry["pdf_url"] is None
    assert entry["source_url"] is None
    assert entry["capture"] is None
    assert entry["original_sha256"] is None
    assert entry["title"] == "local"
    expected_read_time = iso_mtime(root / "local.pdf")
    assert entry["first_read"] == expected_read_time
    assert entry["last_read"] == expected_read_time
    assert entry["invalid"] is False
    assert entry["error_message"] is None


def test_list_library_handles_corrupted_pdf(
    client: TestClient,
    tmp_path: Path,
) -> None:
    root = tmp_path / "reading-root"

    # Save a corrupted file with .pdf extension
    (root / "corrupted.pdf").write_bytes(b"not a valid PDF content")

    response = client.get("/library")
    assert response.status_code == 200
    entries = response.json()
    assert len(entries) == 1
    entry = entries[0]
    assert entry["key"] == "corrupted.pdf"
    assert entry["invalid"] is True
    assert entry["error_message"] is not None


def test_atomic_pdf_write_leaves_no_tmp_files(
    client: TestClient,
    sample_pdf_bytes: bytes,
    tmp_path: Path,
) -> None:
    capture(client, sample_pdf_bytes, "notes.pdf")
    root = tmp_path / "reading-root"

    # Verify the target PDF is written and no .tmp files exist
    assert (root / "notes.pdf").is_file()
    tmp_files = list(root.glob("*.tmp"))
    assert len(tmp_files) == 0


def test_note_optimistic_concurrency_conflict_and_overwrite(
    client: TestClient,
    sample_pdf_bytes: bytes,
) -> None:
    key = capture(client, sample_pdf_bytes)

    # 1. Initially no note exists: get returns empty text and empty version
    get_res = client.get(f"/notes/{key}")
    assert get_res.status_code == 200
    assert get_res.json()["text"] == ""
    assert get_res.json()["version"] == ""

    # 2. Write note for the first time: version is empty or None
    put_res1 = client.put(f"/notes/{key}", json={"key": key, "text": "initial text", "version": ""})
    assert put_res1.status_code == 200
    version1 = put_res1.json()["version"]
    assert version1 != ""

    # 3. Read it back: should have version1
    get_res2 = client.get(f"/notes/{key}")
    assert get_res2.status_code == 200
    assert get_res2.json()["text"] == "initial text"
    assert get_res2.json()["version"] == version1

    # 4. Attempt stale write: write using an empty version on an existing file
    put_res2 = client.put(f"/notes/{key}", json={"key": key, "text": "stale overwrite text", "version": ""})
    assert put_res2.status_code == 409
    assert "Version mismatch" in put_res2.json()["detail"]

    # 5. Write using a wrong version
    put_res3 = client.put(f"/notes/{key}", json={"key": key, "text": "wrong version text", "version": "123+456"})
    assert put_res3.status_code == 409

    # 6. Explicit overwrite action ignores conflict checks.
    put_res_overwrite = client.put(f"/notes/{key}/overwrite", json={"key": key, "text": "overwritten text", "version": "123+456"})
    assert put_res_overwrite.status_code == 200
    version_overwritten = put_res_overwrite.json()["version"]
    assert version_overwritten != version1
    assert version_overwritten != ""

    # 7. Write with correct version: should succeed and return new version
    put_res_correct = client.put(f"/notes/{key}", json={"key": key, "text": "final correct text", "version": version_overwritten})
    assert put_res_correct.status_code == 200
    version_final = put_res_correct.json()["version"]
    assert version_final != version_overwritten


def test_note_asset_traversal_rejection_at_boundary(client: TestClient, sample_pdf_bytes: bytes) -> None:
    # Prove that the HTTP boundary rejects traversal patterns
    key = capture(client, sample_pdf_bytes)
    assert client.get(f"/notes/{key}/assets/..%2fetc%2fpasswd").status_code == 404
    assert client.get(f"/notes/{key}/assets/..%2fnotes.pdf").status_code == 404


def test_note_image_for_provenance_less_pdf_uses_file_stem_clip_tree(
    client: TestClient,
    sample_pdf_bytes: bytes,
    tmp_path: Path,
) -> None:
    root = tmp_path / "reading-root"
    (root / "local.pdf").write_bytes(sample_pdf_bytes)

    response = client.post("/notes/local.pdf/image", files={"image": ("clip.png", PNG_PIXEL, "image/png")})

    assert response.status_code == 200
    image_path = root / "clips" / "local" / "clip-01.png"
    note_path = root / "local.md"
    assert (note_path.parent / response.json()["relative_path"]).resolve() == image_path.resolve()
    assert image_path.read_bytes() == PNG_PIXEL


def test_note_image_existing_clip_filename_increments_without_overwrite(
    client: TestClient,
    sample_pdf_bytes: bytes,
    tmp_path: Path,
) -> None:
    key = capture(client, sample_pdf_bytes)
    root = tmp_path / "reading-root"
    clips_dir = root / "clips" / CAPTURED_PAPER_KEY
    clips_dir.mkdir(parents=True)
    existing = b"existing clip bytes"
    (clips_dir / "clip-01.png").write_bytes(existing)

    response = client.post(f"/notes/{key}/image", files={"image": ("clip.png", PNG_PIXEL, "image/png")})

    assert response.status_code == 200
    note_path = root / "notes.md"
    second_image = clips_dir / "clip-02.png"
    assert (note_path.parent / response.json()["relative_path"]).resolve() == second_image.resolve()
    assert (clips_dir / "clip-01.png").read_bytes() == existing
    assert second_image.read_bytes() == PNG_PIXEL


def test_concurrent_http_clip_uploads(
    client: TestClient,
    sample_pdf_bytes: bytes,
    tmp_path: Path,
) -> None:
    # Prove that the HTTP API boundary handles concurrent writes safely and retries exclusive creation
    import concurrent.futures

    key = capture(client, sample_pdf_bytes)
    root = tmp_path / "reading-root"
    clips_dir = root / "clips" / CAPTURED_PAPER_KEY

    num_threads = 10
    clips_per_thread = 5

    def upload_one_clip() -> str:
        response = client.post(f"/notes/{key}/image", files={"image": ("clip.png", PNG_PIXEL, "image/png")})
        assert response.status_code == 200
        path = response.json()["relative_path"]
        assert isinstance(path, str)
        return path

    with concurrent.futures.ThreadPoolExecutor(max_workers=num_threads) as executor:
        futures = [executor.submit(upload_one_clip) for _ in range(num_threads * clips_per_thread)]
        results = [f.result() for f in concurrent.futures.as_completed(futures)]

    assert len(results) == 50
    assert len(set(results)) == 50
    for path_str in results:
        filename = Path(path_str).name
        assert (clips_dir / filename).is_file()
