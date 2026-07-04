"""Reading-portal data plane over the capture store.

The capture pipeline (`capture.py`) owns writing PDFs into ``<root>/inbox`` with
provenance embedded in each PDF. This module adds the *reading* side: sidecar markdown
notes and their captured images co-located next to each PDF, plus a read-history index
(the one fact that is neither embedded in the PDF nor derivable from it).

Layout for ``inbox/<name>.pdf``:
    inbox/<name>.md          -- sidecar note
    inbox/<name>.assets/     -- captured region images, referenced relatively from the note

Read-history lives in ``<root>/library.json`` keyed by the stored filename; provenance
stays authoritative inside each PDF and is read live.
"""

from __future__ import annotations

import json
import shutil
from datetime import UTC, datetime
from pathlib import Path
from typing import TypedDict, cast

from mathread.metadata import read_capture_provenance
from mathread.models import LibraryEntry

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


class HistoryRecord(TypedDict):
    first_read: str
    last_read: str
    last_position: float


History = dict[str, HistoryRecord]

FIRST_PAGE = 0.0


class UnknownLibraryKeyError(Exception):
    """Requested key does not resolve to a stored PDF in the inbox."""


class InvalidNoteImageError(Exception):
    """Uploaded note image is not a PNG."""


def inbox_dir(root: Path) -> Path:
    return root / "inbox"


def history_path(root: Path) -> Path:
    return root / "library.json"


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
        provenance = read_capture_provenance(pdf)
        note_path, _ = sidecar_paths(pdf)
        read_state = _read_state(pdf, history)
        entries.append(
            LibraryEntry(
                key=pdf.name,
                stored_path=pdf,
                pdf_url=provenance.pdf_url,
                source_url=provenance.source_url,
                capture=provenance.capture,
                original_sha256=provenance.original_sha256,
                # A blank hint is not a title: direct PDF navigations capture before the
                # browser sets document.title, so hints can arrive empty.
                title=_entry_title(provenance.title_hint, pdf),
                has_note=note_path.is_file(),
                first_read=read_state["first_read"],
                last_read=read_state["last_read"],
                last_position=read_state["last_position"],
            )
        )
    return entries


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


def read_note(root: Path, key: str) -> str:
    note_path, _ = sidecar_paths(resolve_pdf(root, key))
    return note_path.read_text(encoding="utf-8") if note_path.is_file() else ""


def write_note(root: Path, key: str, text: str) -> None:
    note_path, _ = sidecar_paths(resolve_pdf(root, key))
    note_path.write_text(text, encoding="utf-8")


def write_note_image(root: Path, key: str, png_bytes: bytes) -> str:
    """Store a PNG in the note's assets dir; return its note-relative path."""
    if not png_bytes.startswith(PNG_MAGIC):
        raise InvalidNoteImageError(key)

    _, assets_dir = sidecar_paths(resolve_pdf(root, key))
    assets_dir.mkdir(parents=True, exist_ok=True)

    index = _next_clip_index(assets_dir)
    image_path = assets_dir / f"clip-{index:02d}.png"
    image_path.write_bytes(png_bytes)
    return f"{assets_dir.name}/{image_path.name}"


def resolve_note_asset(root: Path, key: str, filename: str) -> Path:
    """Map an uploaded clip filename to its file under the note's assets dir,
    rejecting traversal and missing files."""
    if filename != Path(filename).name or not filename.endswith(".png"):
        raise UnknownLibraryKeyError(key)
    _, assets_dir = sidecar_paths(resolve_pdf(root, key))
    path = assets_dir / filename
    if not path.is_file():
        raise UnknownLibraryKeyError(key)
    return path


def delete_library_entry(root: Path, key: str) -> None:
    """Remove a stored PDF together with its sidecar note, assets dir, and read-history."""
    pdf = resolve_pdf(root, key)
    note_path, assets_dir = sidecar_paths(pdf)
    pdf.unlink()
    note_path.unlink(missing_ok=True)
    if assets_dir.is_dir():
        shutil.rmtree(assets_dir)
    history = _load_history(root)
    if key in history:
        del history[key]
        _save_history(root, history)


def record_read_event(root: Path, key: str, position: float | None) -> None:
    resolve_pdf(root, key)  # validate the key exists before recording history
    history = _load_history(root)
    now = datetime.now(UTC).isoformat()

    if key in history:
        first_read = history[key]["first_read"]
        last_position = history[key]["last_position"] if position is None else position
    else:
        first_read = now
        last_position = FIRST_PAGE if position is None else position

    history[key] = HistoryRecord(first_read=first_read, last_read=now, last_position=last_position)
    _save_history(root, history)


def _next_clip_index(assets_dir: Path) -> int:
    existing = [p.stem for p in assets_dir.glob("clip-*.png")]
    numbers = [int(stem.removeprefix("clip-")) for stem in existing if stem.removeprefix("clip-").isdigit()]
    return max(numbers, default=0) + 1


def _load_history(root: Path) -> History:
    path = history_path(root)
    if not path.is_file():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    assert isinstance(data, dict), f"library history must be a JSON object: {path}"
    return cast(History, data)


def _save_history(root: Path, history: History) -> None:
    history_path(root).write_text(json.dumps(history, indent=2, sort_keys=True), encoding="utf-8")
