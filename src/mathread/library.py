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
    """Requested key does not resolve to a stored PDF in the library folder."""


class InvalidNoteImageError(Exception):
    """Uploaded note image is not a PNG."""


class NoteVersionConflictError(Exception):
    """Note has been modified elsewhere; version mismatch."""


def _is_markdown_escaped(text: str, index: int) -> bool:
    backslashes = 0
    index -= 1
    while index >= 0 and text[index] == "\\":
        backslashes += 1
        index -= 1
    return backslashes % 2 == 1


def _closing_markdown_delimiter(
    text: str,
    start: int,
    opening: str,
    closing: str,
) -> int | None:
    depth = 1
    index = start
    while index < len(text):
        character = text[index]
        if not _is_markdown_escaped(text, index):
            if character == opening:
                depth += 1
            elif character == closing:
                depth -= 1
                if depth == 0:
                    return index
        index += 1
    return None


def _bare_markdown_destination_end(line: str, start: int) -> int | None:
    depth = 0
    index = start
    while index < len(line):
        character = line[index]
        if _is_markdown_escaped(line, index):
            index += 1
            continue
        if character == "(":
            depth += 1
        elif character == ")":
            if depth == 0:
                return index
            depth -= 1
        elif character.isspace():
            return None
        index += 1
    return None


def _inline_image_destination(line: str, image_start: int) -> tuple[int, int] | None:
    label_end = _closing_markdown_delimiter(line, image_start + 2, "[", "]")
    if label_end is None or label_end + 1 >= len(line) or line[label_end + 1] != "(":
        return None

    destination_start = label_end + 2
    if destination_start >= len(line):
        return None
    destination_end = _bare_markdown_destination_end(line, destination_start)
    return None if destination_end is None else (destination_start, destination_end)


def _markdown_image_destination_spans(markdown: str) -> Iterator[tuple[int, int]]:
    fence: tuple[str, int] | None = None
    offset = 0
    for line in markdown.splitlines(keepends=True):
        content = line.rstrip("\r\n")
        leading_spaces = len(content) - len(content.lstrip(" "))
        stripped = content[leading_spaces:]
        fence_character = stripped[:1]
        fence_length = len(stripped) - len(stripped.lstrip(fence_character)) if fence_character in {"`", "~"} else 0
        if fence is not None:
            closes_fence = fence_character == fence[0] and fence_length >= fence[1] and not stripped[fence_length:].strip()
            if closes_fence:
                fence = None
            offset += len(line)
            continue
        if leading_spaces <= 3 and fence_length >= 3:
            fence = (fence_character, fence_length)
            offset += len(line)
            continue
        if leading_spaces >= 4:
            offset += len(line)
            continue

        index = 0
        while index < len(content):
            if content[index] == "`":
                code_length = len(content[index:]) - len(content[index:].lstrip("`"))
                closing_code = content.find("`" * code_length, index + code_length)
                if closing_code == -1:
                    index += code_length
                else:
                    index = closing_code + code_length
                continue
            if content.startswith("![", index) and not _is_markdown_escaped(content, index):
                destination = _inline_image_destination(content, index)
                if destination is not None:
                    yield offset + destination[0], offset + destination[1]
                    index = destination[1] + 1
                    continue
            index += 1
        offset += len(line)


def _rewrite_migrated_clip_destinations(
    root: Path,
    note_path: Path,
    markdown: str,
) -> str:
    clips_root = (root / "clips").resolve()
    edits: list[tuple[int, int, str]] = []
    for start, end in _markdown_image_destination_spans(markdown):
        old_destination = markdown[start:end]
        clip_path = (note_path.parent / old_destination).resolve()
        if clip_path.is_relative_to(clips_root) and clip_path.suffix.lower() == ".png":
            edits.append((start, end, clip_path.relative_to(root.resolve()).as_posix()))

    migrated = markdown
    for start, end, destination in reversed(edits):
        migrated = f"{migrated[:start]}{destination}{migrated[end:]}"
    return migrated


def migrate_prior_nested_layout(root: Path) -> None:
    """Move the former ``root/inbox`` PDF and note ownership into ``root`` once."""
    inbox = root / "inbox"
    if not inbox.exists():
        return

    assert inbox.is_dir(), f"Prior MathRead library path must be a real directory before migration; path={inbox}"
    sources = sorted(inbox.iterdir())
    invalid_sources = [source for source in sources if not source.is_file() or source.suffix.lower() not in {".pdf", ".md"}]
    assert not invalid_sources, (
        f"Prior MathRead inbox contains ownership outside the PDF/note transition; unexpected={invalid_sources}; move or remove these entries before starting MathRead"
    )

    pdf_names = {source.name for source in sources if source.suffix.lower() == ".pdf"}
    orphan_notes = [source for source in sources if source.suffix.lower() == ".md" and source.with_suffix(".pdf").name not in pdf_names]
    assert not orphan_notes, f"Prior MathRead inbox contains notes without their owned PDFs; orphan_notes={orphan_notes}; restore the matching PDFs before starting MathRead"

    moves = [(source, root / source.name) for source in sources]
    collisions = [(source, destination) for source, destination in moves if destination.exists()]
    if collisions:
        raise FileExistsError(f"Prior MathRead inbox migration would overwrite canonical library artifacts; collisions={collisions}")

    for source, destination in moves:
        if source.suffix.lower() == ".md":
            note = source.read_text(encoding="utf-8", newline="")
            migrated_note = _rewrite_migrated_clip_destinations(root, source, note)
            if migrated_note != note:
                source.write_text(migrated_note, encoding="utf-8", newline="")
        source.rename(destination)
    inbox.rmdir()


def history_path(root: Path) -> Path:
    return root / "library.json"


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


def record_read_event(root: Path, key: str, position: float | None) -> None:
    resolve_pdf(root, key)  # validate the key exists before recording history
    now = datetime.now(UTC).isoformat()
    with _db_connection(root) as conn:
        conn.execute("BEGIN IMMEDIATE")
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
