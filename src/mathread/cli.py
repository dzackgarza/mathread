from __future__ import annotations

from os import environ
from pathlib import Path

import uvicorn
from cyclopts import App

from mathread.server import create_app

app = App(help="MathRead local PDF capture service")


@app.command
def serve(host: str = "127.0.0.1", port: int = 8765, root: Path | None = None) -> None:
    service_root = root_from_cli_or_environment(root)
    service_root.mkdir(parents=True, exist_ok=True)
    uvicorn.run(create_app(service_root), host=host, port=port)


def root_from_cli_or_environment(root: Path | None) -> Path:
    if root is not None:
        return root.expanduser()

    configured_root = environ.get("MATHREAD_ROOT")
    assert configured_root is not None, "MATHREAD_ROOT must be set when --root is not supplied"
    return Path(configured_root).expanduser()
