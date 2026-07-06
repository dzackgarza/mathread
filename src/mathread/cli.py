from __future__ import annotations

import json
import socket
from os import environ
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

import uvicorn
from cyclopts import App

from mathread.server import create_app

app = App(help="MathRead local PDF capture service")
PORT_PROBE_TIMEOUT_SECONDS = 0.5


@app.command
def serve(host: str = "127.0.0.1", port: int = 8765, root: Path | None = None) -> None:
    service_root = root_from_cli_or_environment(root)
    existing_status = existing_mathread_service_status(host, port)
    if existing_status is not None:
        existing_root = status_root(existing_status)
        requested_root = normalized_root(service_root)
        if existing_root == requested_root:
            print(f"MathRead service already running at {backend_url(host, port)} for {requested_root}")
            return

        raise SystemExit(
            f"Port {host}:{port} is already serving MathRead for {existing_root}; requested root is {requested_root}. Stop the existing service or use its configured root."
        )

    if tcp_port_accepts_connections(host, port):
        raise SystemExit(f"Port {host}:{port} is already in use and is not a MathRead service.")

    service_root.mkdir(parents=True, exist_ok=True)
    uvicorn.run(create_app(service_root), host=host, port=port)


def root_from_cli_or_environment(root: Path | None) -> Path:
    if root is not None:
        return root.expanduser()

    configured_root = environ.get("MATHREAD_ROOT")
    assert configured_root is not None, "MATHREAD_ROOT must be set when --root is not supplied"
    return Path(configured_root).expanduser()


def existing_mathread_service_status(host: str, port: int) -> dict[str, Any] | None:
    try:
        with urlopen(f"{backend_url(host, port)}/status", timeout=PORT_PROBE_TIMEOUT_SECONDS) as response:
            status = json.loads(response.read())
    except (HTTPError, URLError, TimeoutError, OSError, ValueError):  # fmt: skip
        return None

    if not isinstance(status, dict):
        return None

    service = status.get("service")
    if not isinstance(service, dict) or service.get("name") != "mathread":
        return None

    if not isinstance(status.get("root"), str):
        return None

    return status


def tcp_port_accepts_connections(host: str, port: int) -> bool:
    try:
        with socket.create_connection((connection_host(host), port), timeout=PORT_PROBE_TIMEOUT_SECONDS):
            return True
    except OSError:
        return False


def backend_url(host: str, port: int) -> str:
    return f"http://{connection_host(host)}:{port}"


def connection_host(host: str) -> str:
    if host in {"0.0.0.0", "::"}:
        return "127.0.0.1"
    return host


def status_root(status: dict[str, Any]) -> Path:
    root = status["root"]
    assert isinstance(root, str)
    return normalized_root(Path(root))


def normalized_root(root: Path) -> Path:
    return root.expanduser().resolve()
