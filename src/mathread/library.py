"""Reading-portal data plane over the folder-backed library.

The capture pipeline (`capture.py`) owns writing PDFs into the configured library
root with provenance embedded in each PDF. User-dropped PDFs may have no
provenance and are still first-class local library entries. Markdown notes live
beside each PDF. Captured note images live under ``<root>/clips/<paper-key>/``.
Read history and clip allocation state live in ``<root>/library.db``.

Layout for ``<root>/<name>.pdf``:
    <root>/<name>.md          -- note
"""

from __future__ import annotations

import re
import shutil
import sqlite3
import subprocess
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from threading import Lock
from typing import TypedDict

import pikepdf
from pydantic import ValidationError

from mathread.metadata import read_optional_capture_provenance
from mathread.models import CaptureProvenance, LibraryEntry

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
PAPER_KEY_FALLBACK_ERRORS = (AssertionError, ValidationError, pikepdf.PdfError)
_DB_INIT_LOCKS_GUARD = Lock()
_DB_INIT_LOCKS: dict[Path, Lock] = {}


class HistoryRecord(TypedDict):
    first_read: str
    last_read: str


History = dict[str, HistoryRecord]

type OpenRootCommand = tuple[str, ...]
DEFAULT_OPEN_ROOT_COMMAND: OpenRootCommand = ("xdg-open",)


class UnknownLibraryKeyError(Exception):
    """Requested key does not resolve to a stored PDF in the library folder."""


class InvalidNoteImageError(Exception):
    """Uploaded note image is not a PNG."""


class NoteVersionConflictError(Exception):
    """Note has been modified elsewhere; version mismatch."""


def open_library_root(root: Path, command: OpenRootCommand = DEFAULT_OPEN_ROOT_COMMAND) -> None:
    """Open the library root in the user's file browser."""
    assert root.is_dir(), f"MathRead library root must exist before it can be opened: {root}"
    assert command, "MathRead library root opener command must not be empty"
    subprocess.run([*command, str(root)], check=True)


def note_paths(pdf_path: Path) -> tuple[Path, Path]:
    """Return (markdown note path, assets directory) co-located with the PDF."""
    return pdf_path.with_suffix(".md"), pdf_path.with_suffix(".assets")


def resolve_pdf(root: Path, key: str) -> Path:
    """Map a library key to its stored PDF, rejecting traversal and missing keys."""
    if key != Path(key).name or key in {"", ".", ".."} or not key.endswith(".pdf"):
        raise UnknownLibraryKeyError(key)
    path = root / key
    if not path.is_file():
        raise UnknownLibraryKeyError(key)
    return path


def list_library(root: Path) -> list[LibraryEntry]:
    history = _load_history(root)
    if not root.is_dir():
        return []

    entries: list[LibraryEntry] = []
    for pdf in sorted(root.glob("*.pdf")):
        note_path, _ = note_paths(pdf)
        read_state = _read_state(pdf, history)
        try:
            provenance = read_optional_capture_provenance(pdf)
        except (AssertionError, ValidationError, pikepdf.PdfError) as error:
            entries.append(_invalid_entry(pdf, note_path, read_state, error))
            continue

        if provenance is None:
            entries.append(_local_entry(pdf, note_path, read_state))
            continue

        entries.append(_captured_entry(pdf, note_path, read_state, provenance))

    return entries


def _invalid_entry(pdf: Path, note_path: Path, read_state: HistoryRecord, error: Exception) -> LibraryEntry:
    return LibraryEntry(
        key=pdf.name,
        stored_path=pdf,
        pdf_url=None,
        source_url=None,
        capture=None,
        original_sha256=None,
        title=pdf.name,
        has_note=note_path.is_file(),
        first_read=read_state["first_read"],
        last_read=read_state["last_read"],
        invalid=True,
        error_message=str(error),
    )


def _local_entry(pdf: Path, note_path: Path, read_state: HistoryRecord) -> LibraryEntry:
    return LibraryEntry(
        key=pdf.name,
        stored_path=pdf,
        pdf_url=None,
        source_url=None,
        capture=None,
        original_sha256=None,
        title=pdf.stem,
        has_note=note_path.is_file(),
        first_read=read_state["first_read"],
        last_read=read_state["last_read"],
        invalid=False,
    )


def _captured_entry(pdf: Path, note_path: Path, read_state: HistoryRecord, provenance: CaptureProvenance) -> LibraryEntry:
    return LibraryEntry(
        key=pdf.name,
        stored_path=pdf,
        pdf_url=provenance.pdf_url,
        source_url=provenance.source_url,
        capture=provenance.capture,
        original_sha256=provenance.original_sha256,
        title=_entry_title(provenance.title_hint, pdf),
        has_note=note_path.is_file(),
        first_read=read_state["first_read"],
        last_read=read_state["last_read"],
        invalid=False,
    )


def _entry_title(title_hint: str | None, pdf: Path) -> str:
    if title_hint is not None and title_hint.strip():
        return title_hint.strip()
    return pdf.stem


def _read_state(pdf: Path, history: History) -> HistoryRecord:
    """A library entry always has read timestamps.

    Explicit read-event history preserves the first navigation time and advances
    recency. A PDF with no explicit event is still a library entry: use the file
    modification time as the externally supplied entry/read time.
    """
    if pdf.name in history:
        return history[pdf.name]
    first_read = _file_read_timestamp(pdf)
    return HistoryRecord(first_read=first_read, last_read=first_read)


def _file_read_timestamp(pdf: Path) -> str:
    return datetime.fromtimestamp(pdf.stat().st_mtime, UTC).isoformat()


def _calculate_note_version(note_path: Path) -> str:
    """Compute strong opaque version token for a note using mtime_ns + size."""
    stat = note_path.stat()
    return f"{stat.st_mtime_ns}+{stat.st_size}"


def read_note(root: Path, key: str) -> tuple[str, str]:
    note_path, _ = note_paths(resolve_pdf(root, key))
    if note_path.is_file():
        return note_path.read_text(encoding="utf-8"), _calculate_note_version(note_path)
    return "", ""


def write_note(root: Path, key: str, text: str, version: str | None = None) -> str:
    note_path, _ = note_paths(resolve_pdf(root, key))
    if note_path.is_file():
        current_version = _calculate_note_version(note_path)
        if version != current_version:
            raise NoteVersionConflictError(f"Version mismatch: client has {version}, disk has {current_version}")
    note_path.write_text(text, encoding="utf-8")
    return _calculate_note_version(note_path)


def overwrite_note(root: Path, key: str, text: str) -> str:
    note_path, _ = note_paths(resolve_pdf(root, key))
    note_path.write_text(text, encoding="utf-8")
    return _calculate_note_version(note_path)


def _allocate_clip_index(root: Path, paper_key: str, clips_dir: Path) -> int:
    """Allocate a unique, sequential clip index transactionally in the database."""
    with _db_connection(root) as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT MAX(clip_index) as max_idx FROM clips WHERE paper_key = ?", (paper_key,)).fetchone()
        database_max = row["max_idx"] if row and row["max_idx"] is not None else 0
        file_indices = [int(path.stem.removeprefix("clip-")) for path in clips_dir.glob("clip-*.png") if path.stem.removeprefix("clip-").isdigit()]
        next_idx = max([database_max, *file_indices]) + 1
        conn.execute("INSERT INTO clips (paper_key, clip_index) VALUES (?, ?)", (paper_key, next_idx))
        conn.commit()
        return next_idx


def write_note_image(root: Path, key: str, png_bytes: bytes) -> str:
    """Store a PNG in the note's clips dir; return its note-relative path."""
    if not png_bytes.startswith(PNG_MAGIC):
        raise InvalidNoteImageError(key)

    pdf = resolve_pdf(root, key)
    paper_key = paper_key_for_pdf(pdf)
    clips_dir = root / "clips" / paper_key
    clips_dir.mkdir(parents=True, exist_ok=True)

    index = _allocate_clip_index(root, paper_key, clips_dir)
    image_path = clips_dir / f"clip-{index:02d}.png"
    with image_path.open("xb") as output:
        output.write(png_bytes)
    return f"clips/{paper_key}/{image_path.name}"


def sanitize_paper_key(key: str) -> str:
    """Sanitize a library key into a path-safe paper directory name, rejecting traversal."""
    sanitized = re.sub(r"[^a-zA-Z0-9.\-_]", "_", key)
    if not sanitized or sanitized in {".", ".."} or "/" in sanitized or "\\" in sanitized:
        raise UnknownLibraryKeyError(key)
    return sanitized


def paper_key_for_pdf(pdf_path: Path) -> str:
    provenance = read_optional_capture_provenance(pdf_path)
    return sanitize_paper_key(str(provenance.pdf_url) if provenance is not None else pdf_path.stem)


def paper_key_for_cleanup(pdf_path: Path) -> str:
    try:
        return paper_key_for_pdf(pdf_path)
    except PAPER_KEY_FALLBACK_ERRORS:
        return sanitize_paper_key(pdf_path.stem)


def resolve_note_asset(root: Path, key: str, filename: str) -> Path:
    """Map an uploaded clip filename to its file under the note's clips dir,
    rejecting traversal and missing files."""
    if filename != Path(filename).name or not filename.endswith(".png"):
        raise UnknownLibraryKeyError(key)
    paper_key = paper_key_for_pdf(resolve_pdf(root, key))
    clips_dir = root / "clips" / paper_key
    path = clips_dir / filename
    if not path.is_file():
        raise UnknownLibraryKeyError(key)
    return path


def delete_library_entry(root: Path, key: str) -> None:
    """Remove a stored PDF together with its note, clips, and read history."""
    pdf = resolve_pdf(root, key)
    paper_key = paper_key_for_cleanup(pdf)
    note_path, assets_dir = note_paths(pdf)
    pdf.unlink()
    note_path.unlink(missing_ok=True)
    if assets_dir.is_dir():
        shutil.rmtree(assets_dir)

    clips_dir = root / "clips" / paper_key
    if clips_dir.is_dir():
        shutil.rmtree(clips_dir)

    with _db_connection(root) as conn:
        conn.execute("DELETE FROM read_history WHERE key = ?", (key,))
        conn.execute("DELETE FROM clips WHERE paper_key = ?", (paper_key,))
        conn.commit()


def record_read_event(root: Path, key: str) -> None:
    pdf = resolve_pdf(root, key)
    now = datetime.now(UTC).isoformat()
    with _db_connection(root) as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT first_read FROM read_history WHERE key = ?", (key,)).fetchone()
        first_read = row["first_read"] if row else _file_read_timestamp(pdf)

        conn.execute(
            """
            INSERT OR REPLACE INTO read_history (key, first_read, last_read)
            VALUES (?, ?, ?)
            """,
            (key, first_read, now),
        )
        conn.commit()


def _db_init_lock(db_path: Path) -> Lock:
    with _DB_INIT_LOCKS_GUARD:
        lock = _DB_INIT_LOCKS.get(db_path)
        if lock is None:
            lock = Lock()
            _DB_INIT_LOCKS[db_path] = lock
        return lock


def _initialize_db(root: Path, conn: sqlite3.Connection) -> None:
    conn.execute("PRAGMA journal_mode=WAL;")
    _ensure_read_history_schema(conn)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS clips (
            paper_key TEXT NOT NULL,
            clip_index INTEGER NOT NULL,
            PRIMARY KEY (paper_key, clip_index)
        );
        """
    )
    conn.commit()


def _ensure_read_history_schema(conn: sqlite3.Connection) -> None:
    columns = [row["name"] for row in conn.execute("PRAGMA table_info(read_history)").fetchall()]
    current_columns = ["key", "first_read", "last_read"]
    if columns == current_columns:
        return
    if not columns:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS read_history (
                key TEXT PRIMARY KEY,
                first_read TEXT NOT NULL,
                last_read TEXT NOT NULL
            );
            """
        )
        return

    assert columns == current_columns, f"read_history schema must be exactly {current_columns}; columns={columns}"


def _get_db(root: Path) -> sqlite3.Connection:
    db_path = root / "library.db"
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    # Ensure the schema on every connection rather than memoizing "initialized"
    # per path: the memo could not detect the db file being removed or replaced
    # (a wiped reading root left the connection pointing at a schemaless db).
    # _initialize_db is idempotent; the per-path lock guards concurrent creates.
    with _db_init_lock(db_path.resolve()):
        _initialize_db(root, conn)
    return conn


@contextmanager
def _db_connection(root: Path) -> Iterator[sqlite3.Connection]:
    conn = _get_db(root)
    try:
        yield conn
    finally:
        conn.close()


def _load_history(root: Path) -> History:
    history: History = {}
    with _db_connection(root) as conn:
        cursor = conn.execute("SELECT key, first_read, last_read FROM read_history")
        for row in cursor:
            history[row["key"]] = HistoryRecord(
                first_read=row["first_read"],
                last_read=row["last_read"],
            )
    return history
