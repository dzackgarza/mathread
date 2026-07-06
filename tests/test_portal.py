from __future__ import annotations

import sys
from io import BytesIO
from pathlib import Path

import pikepdf
import pytest
from fastapi.testclient import TestClient

from mathread.server import create_app

PNG_PIXEL = bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c636060606000000005000180fdb8d40000000049454e44ae426082")
CAPTURED_PAPER_KEY = "https___example.edu_course_notes.pdf"


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
    candidates = [root / key, root / "inbox" / key]
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise AssertionError(f"Stored PDF for {key} was not found in the library root or inbox")


def note_sidecar_path(root: Path, key: str) -> Path:
    return stored_pdf_path(root, key).with_suffix(".md")


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
            "version": first.json().get("version", ""),
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
    clips_dir = root / "clips" / CAPTURED_PAPER_KEY

    first = client.post(f"/notes/{key}/image", files={"image": ("clip.png", PNG_PIXEL, "image/png")})
    assert first.status_code == 200
    assert first.json()["relative_path"] == f"../clips/{CAPTURED_PAPER_KEY}/clip-01.png"
    assert (clips_dir / "clip-01.png").read_bytes() == PNG_PIXEL

    second = client.post(f"/notes/{key}/image", files={"image": ("clip.png", PNG_PIXEL, "image/png")})
    assert second.json()["relative_path"] == f"../clips/{CAPTURED_PAPER_KEY}/clip-02.png"

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
    assert first_path.startswith("../clips/")
    assert second_path.startswith("../clips/")
    assert first_path != second_path
    assert (root / first_path.removeprefix("../")).read_bytes() == PNG_PIXEL
    assert (root / second_path.removeprefix("../")).read_bytes() == PNG_PIXEL


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


def test_read_history_uses_sqlite_transactions_for_concurrent_updates(
    client: TestClient,
    sample_pdf_bytes: bytes,
    tmp_path: Path,
) -> None:
    import concurrent.futures
    import sqlite3

    root = tmp_path / "reading-root"
    keys = [capture(client, sample_pdf_bytes, f"paper-{index}.pdf") for index in range(8)]

    def record(index: int) -> None:
        response = client.post("/read-event", json={"key": keys[index], "position": index / 10})
        assert response.status_code == 204

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        futures = [executor.submit(record, index) for index in range(len(keys))]
        for future in concurrent.futures.as_completed(futures):
            future.result()

    db_path = root / "library.db"
    assert db_path.is_file()
    conn = sqlite3.connect(str(db_path))
    rows = dict(conn.execute("SELECT key, last_position FROM read_history").fetchall())
    conn.close()
    assert set(rows) == set(keys)
    for index, key in enumerate(keys):
        assert rows[key] == pytest.approx(index / 10)


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


def test_concurrent_read_events_persist_all_key_updates(
    client: TestClient,
    sample_pdf_bytes: bytes,
    tmp_path: Path,
) -> None:
    import concurrent.futures

    inbox = tmp_path / "reading-root" / "inbox"
    inbox.mkdir(parents=True, exist_ok=True)
    keys = [f"paper-{index}.pdf" for index in range(12)]
    for key in keys:
        (inbox / key).write_bytes(sample_pdf_bytes)

    def record(index: int) -> None:
        response = client.post("/read-event", json={"key": keys[index], "position": index / 10})
        assert response.status_code == 204

    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
        futures = [executor.submit(record, index) for index in range(len(keys))]
        for future in concurrent.futures.as_completed(futures):
            future.result()

    entries = client.get("/library").json()
    positions = {entry["key"]: entry["last_position"] for entry in entries}
    for index, key in enumerate(keys):
        assert positions[key] == pytest.approx(index / 10)


def test_delete_removes_pdf_sidecar_assets_and_history(
    client: TestClient,
    sample_pdf_bytes: bytes,
    tmp_path: Path,
) -> None:
    import sqlite3

    key = capture(client, sample_pdf_bytes)
    inbox = tmp_path / "reading-root" / "inbox"
    root = tmp_path / "reading-root"
    clips_dir = root / "clips" / CAPTURED_PAPER_KEY

    client.put(f"/notes/{key}", json={"key": key, "text": "notes"})
    client.post(f"/notes/{key}/image", files={"image": ("clip.png", PNG_PIXEL, "image/png")})
    client.post("/read-event", json={"key": key, "position": 0.4})
    assert (inbox / "notes.pdf").is_file()
    assert (inbox / "notes.md").is_file()
    assert (clips_dir / "clip-01.png").is_file()

    db_path = tmp_path / "reading-root" / "library.db"
    assert db_path.is_file()
    conn = sqlite3.connect(str(db_path))
    row = conn.execute("SELECT key FROM read_history WHERE key = ?", (key,)).fetchone()
    assert row is not None
    conn.close()

    response = client.delete(f"/library/{key}")

    assert response.status_code == 204
    assert not (inbox / "notes.pdf").exists()
    assert not (inbox / "notes.md").exists()
    assert not clips_dir.exists()

    conn = sqlite3.connect(str(db_path))
    row = conn.execute("SELECT key FROM read_history WHERE key = ?", (key,)).fetchone()
    assert row is None
    conn.close()
    assert client.get("/library").json() == []


def test_library_json_migration(tmp_path: Path) -> None:
    import json

    from mathread.library import _get_db

    root = tmp_path / "migration-root"
    root.mkdir()

    # Pre-populate library.json
    legacy_data = {
        "paper.pdf": {
            "first_read": "2026-07-06T00:00:00Z",
            "last_read": "2026-07-06T01:00:00Z",
            "last_position": 0.5,
        }
    }
    json_path = root / "library.json"
    json_path.write_text(json.dumps(legacy_data), encoding="utf-8")

    # Initializing db should trigger migration and delete library.json
    conn = _get_db(root)

    # Verify database contents
    row = conn.execute("SELECT key, first_read, last_read, last_position FROM read_history").fetchone()
    assert row is not None
    assert row[0] == "paper.pdf"
    assert row[1] == "2026-07-06T00:00:00Z"
    assert row[2] == "2026-07-06T01:00:00Z"
    assert row[3] == 0.5
    conn.close()

    # library.json should have been deleted
    assert not json_path.exists()


def test_library_json_migration_rejects_malformed_legacy_history(tmp_path: Path) -> None:
    import json

    from mathread.library import _get_db

    root = tmp_path / "migration-root"
    root.mkdir()
    json_path = root / "library.json"
    json_path.write_text(json.dumps({"paper.pdf": {"first_read": "2026-07-06T00:00:00Z"}}), encoding="utf-8")

    with pytest.raises(AssertionError):
        _get_db(root)

    assert json_path.is_file()


def test_delete_unknown_key_is_404(client: TestClient) -> None:
    assert client.delete("/library/ghost.pdf").status_code == 404


def test_open_root_endpoint_runs_file_browser_command_against_library_root(tmp_path: Path) -> None:
    reading_root = tmp_path / "reading-root"
    reading_root.mkdir()
    script = "import pathlib, sys; pathlib.Path(sys.argv[1], 'opened-by-mathread.txt').write_text('opened', encoding='utf-8')"
    client = TestClient(create_app(reading_root, open_root_command=(sys.executable, "-c", script)))

    response = client.post("/library/open-root")

    assert response.status_code == 204
    assert (reading_root / "opened-by-mathread.txt").read_text(encoding="utf-8") == "opened"


def test_unknown_key_is_404_across_note_image_and_read_event(client: TestClient) -> None:
    assert client.get("/notes/ghost.pdf").status_code == 404
    assert client.put("/notes/ghost.pdf", json={"key": "ghost.pdf", "text": "x"}).status_code == 404
    assert client.post("/notes/ghost.pdf/image", files={"image": ("c.png", PNG_PIXEL, "image/png")}).status_code == 404
    assert client.post("/read-event", json={"key": "ghost.pdf", "position": 0.1}).status_code == 404


def test_key_path_traversal_is_rejected(client: TestClient) -> None:
    assert client.get("/notes/..%2f..%2fetc%2fpasswd").status_code in (400, 404)


def test_list_library_handles_provenance_less_pdf(
    client: TestClient,
    sample_pdf_bytes: bytes,
    tmp_path: Path,
) -> None:
    inbox = tmp_path / "reading-root" / "inbox"
    inbox.mkdir(parents=True, exist_ok=True)

    # Save a PDF directly to inbox without any provenance metadata
    (inbox / "local.pdf").write_bytes(sample_pdf_bytes)

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
    assert entry["invalid"] is False
    assert entry["error_message"] is None


def test_list_library_handles_corrupted_pdf(
    client: TestClient,
    tmp_path: Path,
) -> None:
    inbox = tmp_path / "reading-root" / "inbox"
    inbox.mkdir(parents=True, exist_ok=True)

    # Save a corrupted file with .pdf extension
    (inbox / "corrupted.pdf").write_bytes(b"not a valid PDF content")

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
    inbox = tmp_path / "reading-root" / "inbox"

    # Verify the target PDF is written and no .tmp files exist
    assert (inbox / "notes.pdf").is_file()
    tmp_files = list(inbox.glob("*.tmp"))
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
    inbox = root / "inbox"
    inbox.mkdir(parents=True, exist_ok=True)
    (inbox / "local.pdf").write_bytes(sample_pdf_bytes)

    response = client.post("/notes/local.pdf/image", files={"image": ("clip.png", PNG_PIXEL, "image/png")})

    assert response.status_code == 200
    assert response.json()["relative_path"] == "../clips/local/clip-01.png"
    assert (root / "clips" / "local" / "clip-01.png").read_bytes() == PNG_PIXEL


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
    assert response.json()["relative_path"] == f"../clips/{CAPTURED_PAPER_KEY}/clip-02.png"
    assert (clips_dir / "clip-01.png").read_bytes() == existing
    assert (clips_dir / "clip-02.png").read_bytes() == PNG_PIXEL


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
