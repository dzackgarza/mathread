from __future__ import annotations

from email.message import Message
from pathlib import Path
from urllib.parse import unquote, urlparse

from pathvalidate import sanitize_filename

from mathread.metadata import read_original_sha256


def filename_from_response(
    pdf_url: str,
    content_disposition: str | None,
) -> str:
    filename = content_disposition_filename(content_disposition)
    if filename is None:
        filename = url_basename(pdf_url)
    return normalized_pdf_filename(filename)


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


def content_disposition_filename(content_disposition: str | None) -> str | None:
    if content_disposition is None:
        return None

    message = Message()
    message["content-disposition"] = content_disposition
    return message.get_filename()


def url_basename(pdf_url: str) -> str:
    parsed = urlparse(pdf_url)
    name = Path(unquote(parsed.path)).name
    return "document.pdf" if name == "" else name


def normalized_pdf_filename(filename: str) -> str:
    name = sanitize_filename(Path(filename).name, replacement_text="-")
    assert name != "", f"filename must not normalize to empty: {filename!r}"

    path = Path(name)
    if path.suffix.lower() == ".pdf":
        return path.name
    return f"{path.name}.pdf"
