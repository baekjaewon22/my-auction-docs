# -*- coding: utf-8 -*-
"""Automation service entry point for local/PyInstaller execution."""

import os
import pathlib
import sys


if getattr(sys, "frozen", False):
    BASE_DIR = os.path.dirname(sys.executable)
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))

os.chdir(BASE_DIR)


def _ensure_streams() -> None:
    if sys.stdout and sys.stderr:
        return

    log_dir = pathlib.Path(os.environ.get("LOCALAPPDATA", BASE_DIR)) / "MyAuctionAutomationAgent"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = open(log_dir / "agent.log", "a", encoding="utf-8", buffering=1)

    if not sys.stdout:
        sys.stdout = log_file
    if not sys.stderr:
        sys.stderr = log_file


_ensure_streams()

if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

import uvicorn  # noqa: E402
from app.main import app  # noqa: E402


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8001
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
