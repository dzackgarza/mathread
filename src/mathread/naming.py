from __future__ import annotations

from pathlib import Path

from pathvalidate import sanitize_filename

from mathread.metadata import read_original_sha256


def destination_for_pdf(
    inbox: Path,
    filename: str,
    original_sha256: str,
) -> tuple[Path, bool]:
    direct_path = inbox / filename
    if not direct_path.exists():
        return direct_path, False

    if read_original_sha256(str(direct_path)) == original_sha256:
        return direct_path, True

    stem = direct_path.stem
    suffix = direct_path.suffix
    return inbox / f"{stem}--{original_sha256[:12]}{suffix}", False


def normalized_pdf_filename(filename: str) -> str:
    name = sanitize_filename(Path(filename).name, replacement_text="-")
    assert name != "", f"filename must not normalize to empty: {filename!r}"

    path = Path(name)
    if path.suffix.lower() == ".pdf":
        return path.name
    return f"{path.name}.pdf"
