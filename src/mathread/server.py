from __future__ import annotations

from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, Form, Request, Response, UploadFile
from pydantic import HttpUrl

from mathread.capture import InvalidPdfCaptureError, capture_bytes, capture_url
from mathread.models import CaptureBytesRequest, CaptureResult, CaptureUrlRequest


def create_app(root: Path) -> FastAPI:
    app = FastAPI(title="MathRead")

    @app.exception_handler(InvalidPdfCaptureError)
    def invalid_pdf_capture_error_handler(
        _request: Request,
        _error: InvalidPdfCaptureError,
    ) -> Response:
        return Response(status_code=400)

    @app.post("/capture-url", response_model=CaptureResult)
    def capture_url_endpoint(request: CaptureUrlRequest) -> CaptureResult:
        return capture_url(root, request)

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
