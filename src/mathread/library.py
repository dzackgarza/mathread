"""Reading-portal data plane over the folder-backed library.

PDFs live in ``<root>/inbox``. Extension-captured PDFs carry MathRead provenance in
their docinfo; user-dropped PDFs may have no provenance and are still first-class local
library entries. Markdown sidecar notes live beside the PDF. Captured note images live
under ``<root>/clips/<paper-key>/`` so a paper's clips can be browsed without opening
the note file. Read history and clip allocation state live in ``<root>/library.db``.
"""

from __future__ import annotations

import json
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
_INITIALIZED_DBS: set[Path] = set()


class HistoryRecord(TypedDict):
    first_read: str
    last_read: str
    last_position: float


History = dict[str, HistoryRecord]

FIRST_PAGE = 0.0
type OpenRootCommand = tuple[str, ...]
DEFAULT_OPEN_ROOT_COMMAND: OpenRootCommand = ("xdg-open",)


class UnknownLibraryKeyError(Exception):
    """Requested key does not resolve to a stored PDF in the inbox."""


class InvalidNoteImageError(Exception):
    """Uploaded note image is not a PNG."""


class NoteVersionConflictError(Exception):
    """Note has been modified elsewhere; version mismatch."""


def inbox_dir(root: Path) -> Path:
    return root / "inbox"


def history_path(root: Path) -> Path:
    return root / "library.json"


def open_library_root(root: Path, command: OpenRootCommand = DEFAULT_OPEN_ROOT_COMMAND) -> None:
    """Open the library root in the user's file browser."""
    assert root.is_dir(), f"MathRead library root must exist before it can be opened: {root}"
    assert command, "MathRead library root opener command must not be empty"
    subprocess.run([*command, str(root)], check=True)


def sidecar_paths(pdf_path: Path) -> tuple[Path, Path]:
    """Return (markdown note path, assets directory) co-located with the PDF."""
    return pdf_path.with_suffix(".md"), pdf_path.with_suffix(".assets")


def resolve_pdf(root: Path, key: str) -> Path:
    """Map a library key to its stored PDF, rejecting traversal and missing keys."""
    if key != Path(key).name or key in {"", ".", ".."} or not key.endswith(".pdf"):
        raise UnknownLibraryKeyError(key)
    path = inbox_dir(root) / key
    if not path.is_file():
        raise UnknownLibraryKeyError(key)
    return path


def list_library(root: Path) -> list[LibraryEntry]:
    history = _load_history(root)
    inbox = inbox_dir(root)
    if not inbox.is_dir():
        return []

    entries: list[LibraryEntry] = []
    for pdf in sorted(inbox.glob("*.pdf")):
        note_path, _ = sidecar_paths(pdf)
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
        last_position=read_state["last_position"],
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
        last_position=read_state["last_position"],
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
        last_position=read_state["last_position"],
        invalid=False,
    )


def _entry_title(title_hint: str | None, pdf: Path) -> str:
    if title_hint is not None and title_hint.strip():
        return title_hint.strip()
    return pdf.stem


def _read_state(pdf: Path, history: History) -> HistoryRecord:
    """A PDF always has a read-state: an explicit record once opened, else its capture
    time (the moment it entered the reading library) at the first page."""
    if pdf.name in history:
        return history[pdf.name]
    captured_at = datetime.fromtimestamp(pdf.stat().st_mtime, UTC).isoformat()
    return HistoryRecord(first_read=captured_at, last_read=captured_at, last_position=FIRST_PAGE)


def _calculate_note_version(note_path: Path) -> str:
    """Compute strong opaque version token for a note using mtime_ns + size."""
    stat = note_path.stat()
    return f"{stat.st_mtime_ns}+{stat.st_size}"


def read_note(root: Path, key: str) -> tuple[str, str]:
    note_path, _ = sidecar_paths(resolve_pdf(root, key))
    if note_path.is_file():
        return note_path.read_text(encoding="utf-8"), _calculate_note_version(note_path)
    return "", ""


def write_note(root: Path, key: str, text: str, version: str | None = None) -> str:
    note_path, _ = sidecar_paths(resolve_pdf(root, key))
    if note_path.is_file():
        current_version = _calculate_note_version(note_path)
        if version != current_version:
            raise NoteVersionConflictError(f"Version mismatch: client has {version}, disk has {current_version}")
    note_path.write_text(text, encoding="utf-8")
    return _calculate_note_version(note_path)


def overwrite_note(root: Path, key: str, text: str) -> str:
    note_path, _ = sidecar_paths(resolve_pdf(root, key))
    note_path.write_text(text, encoding="utf-8")
    return _calculate_note_version(note_path)


def _allocate_clip_index(root: Path, paper_key: str) -> int:
    """Allocate a unique, sequential clip index transactionally in the database."""
    with _db_connection(root) as conn:
        while True:
            row = conn.execute("SELECT MAX(clip_index) as max_idx FROM clips WHERE paper_key = ?", (paper_key,)).fetchone()
            next_idx = (row["max_idx"] if row and row["max_idx"] is not None else 0) + 1
            try:
                conn.execute("INSERT INTO clips (paper_key, clip_index) VALUES (?, ?)", (paper_key, next_idx))
                conn.commit()
                return next_idx
            except sqlite3.IntegrityError:
                continue


def write_note_image(root: Path, key: str, png_bytes: bytes) -> str:
    """Store a PNG in the note's clips dir; return its note-relative path."""
    if not png_bytes.startswith(PNG_MAGIC):
        raise InvalidNoteImageError(key)

    pdf = resolve_pdf(root, key)
    paper_key = paper_key_for_pdf(pdf)
    clips_dir = root / "clips" / paper_key
    clips_dir.mkdir(parents=True, exist_ok=True)

    while True:
        index = _allocate_clip_index(root, paper_key)
        image_path = clips_dir / f"clip-{index:02d}.png"
        try:
            with image_path.open("xb") as output:
                output.write(png_bytes)
            return f"../clips/{paper_key}/{image_path.name}"
        except FileExistsError:
            continue


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
    """Remove a stored PDF together with its sidecar note, assets/clips dir, and read-history."""
    pdf = resolve_pdf(root, key)
    paper_key = paper_key_for_cleanup(pdf)
    note_path, assets_dir = sidecar_paths(pdf)
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


def record_read_event(root: Path, key: str, position: float | None) -> None:
    resolve_pdf(root, key)  # validate the key exists before recording history
    now = datetime.now(UTC).isoformat()
    with _db_connection(root) as conn:
        row = conn.execute("SELECT first_read, last_position FROM read_history WHERE key = ?", (key,)).fetchone()
        if row:
            first_read = row["first_read"]
            last_position = row["last_position"] if position is None else position
        else:
            first_read = now
            last_position = FIRST_PAGE if position is None else position

        conn.execute(
            """
            INSERT OR REPLACE INTO read_history (key, first_read, last_read, last_position)
            VALUES (?, ?, ?, ?)
            """,
            (key, first_read, now, last_position),
        )
        conn.commit()


def _db_init_lock(db_path: Path) -> Lock:
    with _DB_INIT_LOCKS_GUARD:
        lock = _DB_INIT_LOCKS.get(db_path)
        if lock is None:
            lock = Lock()
            _DB_INIT_LOCKS[db_path] = lock
        return lock


def _db_is_initialized(db_path: Path) -> bool:
    with _DB_INIT_LOCKS_GUARD:
        return db_path in _INITIALIZED_DBS


def _mark_db_initialized(db_path: Path) -> None:
    with _DB_INIT_LOCKS_GUARD:
        _INITIALIZED_DBS.add(db_path)


def _initialize_db(root: Path, conn: sqlite3.Connection) -> None:
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS read_history (
            key TEXT PRIMARY KEY,
            first_read TEXT NOT NULL,
            last_read TEXT NOT NULL,
            last_position REAL NOT NULL
        );
        """
    )
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

    # Migration from legacy library.json
    json_path = history_path(root)
    if json_path.is_file():
        with open(json_path, encoding="utf-8") as f:
            data = json.load(f)
        assert isinstance(data, dict), f"Legacy library.json must be an object keyed by PDF filename; found={type(data).__name__}; fix or delete {json_path}"
        with conn:
            for key, value in data.items():
                assert isinstance(key, str), f"Legacy history key must be a string; key={key}; fix or delete {json_path}"
                assert isinstance(value, dict), f"History record '{key}' must be a dictionary; data={value}; fix or delete {json_path}"
                assert "first_read" in value, (
                    f"History record '{key}' is missing required key 'first_read'; "
                    f"data={value}; fix the legacy library.json file at the root or "
                    "delete it to reconstruct history."
                )
                assert "last_read" in value, (
                    f"History record '{key}' is missing required key 'last_read'; "
                    f"data={value}; fix the legacy library.json file at the root or "
                    "delete it to reconstruct history."
                )
                assert "last_position" in value, (
                    f"History record '{key}' is missing required key 'last_position'; "
                    f"data={value}; fix the legacy library.json file at the root or "
                    "delete it to reconstruct history."
                )
                assert isinstance(value["first_read"], str), f"History record '{key}' first_read must be a string; data={value}"
                assert isinstance(value["last_read"], str), f"History record '{key}' last_read must be a string; data={value}"
                assert isinstance(value["last_position"], int | float), f"History record '{key}' last_position must be numeric; data={value}"
                conn.execute(
                    """
                    INSERT OR REPLACE INTO read_history (key, first_read, last_read, last_position)
                    VALUES (?, ?, ?, ?)
                    """,
                    (
                        key,
                        value["first_read"],
                        value["last_read"],
                        value["last_position"],
                    ),
                )
        json_path.unlink(missing_ok=True)


def _get_db(root: Path) -> sqlite3.Connection:
    db_path = root / "library.db"
    db_identity = db_path.resolve()
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    if not _db_is_initialized(db_identity):
        with _db_init_lock(db_identity):
            if not _db_is_initialized(db_identity):
                _initialize_db(root, conn)
                _mark_db_initialized(db_identity)
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
        cursor = conn.execute("SELECT key, first_read, last_read, last_position FROM read_history")
        for row in cursor:
            history[row["key"]] = HistoryRecord(
                first_read=row["first_read"],
                last_read=row["last_read"],
                last_position=row["last_position"],
            )
    return history
