from __future__ import annotations

from os import W_OK, access
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, Form, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import HttpUrl

from mathread import __version__
from mathread.capture import InvalidPdfCaptureError, capture_bytes
from mathread.library import (
    DEFAULT_OPEN_ROOT_COMMAND,
    InvalidNoteImageError,
    OpenRootCommand,
    UnknownLibraryKeyError,
)
from mathread.models import (
    BackendCapabilities,
    BackendServiceStatus,
    BackendStatus,
    BackendStorageStatus,
    CaptureBytesRequest,
    CaptureResult,
)
from mathread.portal import create_portal_router

DEFAULT_PORTAL_URL = "http://markdown-editor.localhost"


def create_app(
    root: Path,
    portal_url: str = DEFAULT_PORTAL_URL,
    open_root_command: OpenRootCommand = DEFAULT_OPEN_ROOT_COMMAND,
) -> FastAPI:
    app = FastAPI(title="MathRead")

    # Local reading portal (vite dev + <slug>.localhost) reaches the backend cross-origin.
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"^http://(localhost|127\.0\.0\.1|[a-z0-9-]+\.localhost)(:\d+)?$",
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(InvalidPdfCaptureError)
    def invalid_pdf_capture_error_handler(
        _request: Request,
        _error: InvalidPdfCaptureError,
    ) -> Response:
        return Response(status_code=400)

    @app.exception_handler(UnknownLibraryKeyError)
    def unknown_library_key_error_handler(
        _request: Request,
        _error: UnknownLibraryKeyError,
    ) -> Response:
        return Response(status_code=404)

    @app.exception_handler(InvalidNoteImageError)
    def invalid_note_image_error_handler(
        _request: Request,
        _error: InvalidNoteImageError,
    ) -> Response:
        return Response(status_code=400)

    @app.exception_handler(Exception)
    def unhandled_exception_handler(
        _request: Request,
        error: Exception,
    ) -> JSONResponse:
        return JSONResponse(
            status_code=500,
            content={
                "error": type(error).__name__,
                "message": str(error),
            },
        )

    app.include_router(create_portal_router(root, open_root_command))

    @app.get("/status", response_model=BackendStatus)
    def status_endpoint(request: Request) -> BackendStatus:
        root_writable = root.is_dir() and access(root, W_OK)
        return BackendStatus(
            backend_url=str(request.base_url).rstrip("/"),
            portal_url=portal_url,
            root=root,
            service=BackendServiceStatus(name="mathread", version=__version__),
            storage=BackendStorageStatus(
                root_exists=root.exists(),
                root_writable=root_writable,
            ),
            capabilities=BackendCapabilities(
                capture=root_writable,
                open_file=True,
                reveal_file=False,
                open_root=root.is_dir(),
            ),
            ready=root_writable,
        )

    @app.post("/capture-bytes", response_model=CaptureResult)
    async def capture_bytes_endpoint(
        pdf: UploadFile,
        source_url: Annotated[HttpUrl, Form()],
        pdf_url: Annotated[HttpUrl, Form()],
        title_hint: Annotated[str | None, Form()] = None,
    ) -> CaptureResult:
        filename = "document.pdf" if pdf.filename is None else pdf.filename
        return capture_bytes(
            root=root,
            request=CaptureBytesRequest(
                pdf_url=pdf_url,
                source_url=source_url,
                title_hint=title_hint,
            ),
            pdf_bytes=await pdf.read(),
            filename=filename,
        )

    return app
