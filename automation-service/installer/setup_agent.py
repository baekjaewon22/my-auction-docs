# -*- coding: utf-8 -*-
"""Windows installer for MyAuction Automation Agent.

The setup executable embeds MyAuctionAutomationAgent.zip, stops the old local
agent, installs the bundled files into LocalAppData, registers startup, and
starts the latest agent.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path


AGENT_NAME = "MyAuctionAutomationAgent"
SETUP_NAME = "MyAuctionAutomationAgentSetup"
AGENT_EXE = f"{AGENT_NAME}.exe"
AGENT_ZIP = f"{AGENT_NAME}.zip"
PORT = "8001"
LOG_PATH = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / f"{AGENT_NAME}Setup" / "setup.log"
QUIET = "--quiet" in sys.argv


def log(message: str) -> None:
    try:
        LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with LOG_PATH.open("a", encoding="utf-8") as file:
            file.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {message}\n")
    except Exception:
        pass


def resource_path(name: str) -> Path:
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    return base / name


def run_hidden(args: list[str], check: bool = False) -> subprocess.CompletedProcess:
    startupinfo = None
    creationflags = 0
    if os.name == "nt":
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        creationflags = subprocess.CREATE_NO_WINDOW
    log(f"RUN {' '.join(args)}")
    result = subprocess.run(
        args,
        check=check,
        startupinfo=startupinfo,
        creationflags=creationflags,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if result.stdout:
        log(f"STDOUT {result.stdout.strip()}")
    if result.stderr:
        log(f"STDERR {result.stderr.strip()}")
    log(f"EXIT {result.returncode}")
    return result


def start_hidden(args: list[str]) -> None:
    startupinfo = None
    creationflags = 0
    if os.name == "nt":
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        creationflags = subprocess.CREATE_NO_WINDOW | subprocess.DETACHED_PROCESS
    log(f"START {' '.join(args)}")
    subprocess.Popen(
        args,
        startupinfo=startupinfo,
        creationflags=creationflags,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        stdin=subprocess.DEVNULL,
        close_fds=True,
    )


def powershell(command: str) -> None:
    run_hidden(
        [
            "powershell.exe",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            command,
        ],
        check=False,
    )


def stop_existing_agent() -> None:
    log("Stopping existing agent and port owners")
    powershell(
        "$ErrorActionPreference='SilentlyContinue'; "
        f"Get-Process -Name '{SETUP_NAME}' | "
        f"Where-Object {{ $_.Id -ne {os.getpid()} }} | "
        "Stop-Process -Force; "
        f"Get-Process -Name '{AGENT_NAME}' | Stop-Process -Force; "
        f"$ownedProcessIds = Get-NetTCPConnection -LocalPort {PORT} | "
        "Select-Object -ExpandProperty OwningProcess -Unique; "
        "foreach ($processId in $ownedProcessIds) { "
        "if ($processId -and $processId -ne $PID) { Stop-Process -Id $processId -Force } "
        "}"
    )
    time.sleep(1)


def write_startup_runner(install_dir: Path) -> Path:
    runner = install_dir / f"Start-{AGENT_NAME}.ps1"
    runner.write_text(
        "\n".join(
            [
                '$ErrorActionPreference = "Stop"',
                f'$exe = Join-Path $PSScriptRoot "{AGENT_EXE}"',
                f'Start-Process -FilePath $exe -ArgumentList "{PORT}" -WindowStyle Hidden',
            ]
        ),
        encoding="utf-8",
    )
    return runner


def register_startup(runner: Path) -> None:
    command = (
        "$runKey = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'; "
        "New-Item -Path $runKey -Force | Out-Null; "
        f"Set-ItemProperty -Path $runKey -Name '{AGENT_NAME}' "
        f"-Value 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"{runner}\"'"
    )
    powershell(command)


def show_message(title: str, message: str, error: bool = False) -> None:
    if QUIET:
        return
    try:
        import tkinter as tk
        from tkinter import messagebox

        root = tk.Tk()
        root.withdraw()
        if error:
            messagebox.showerror(title, message)
        else:
            messagebox.showinfo(title, message)
        root.destroy()
    except Exception:
        pass


def main() -> int:
    log("Setup started")
    install_dir = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / AGENT_NAME
    bundled_zip = resource_path(AGENT_ZIP)
    if not bundled_zip.exists():
        raise FileNotFoundError(f"Bundled agent archive was not found: {bundled_zip}")

    stop_existing_agent()

    with tempfile.TemporaryDirectory(prefix="myauction_agent_setup_") as tmp:
        extract_dir = Path(tmp) / "agent"
        log(f"Extracting {bundled_zip} to {extract_dir}")
        with zipfile.ZipFile(bundled_zip, "r") as archive:
            archive.extractall(extract_dir)

        if install_dir.exists():
            log(f"Removing old install directory {install_dir}")
            shutil.rmtree(install_dir, ignore_errors=True)
            if install_dir.exists():
                stop_existing_agent()
                shutil.rmtree(install_dir, ignore_errors=True)
        install_dir.mkdir(parents=True, exist_ok=True)

        for item in extract_dir.iterdir():
            target = install_dir / item.name
            if item.is_dir():
                shutil.copytree(item, target, dirs_exist_ok=True)
            else:
                shutil.copy2(item, target)

    runner = write_startup_runner(install_dir)
    register_startup(runner)

    agent_exe = install_dir / AGENT_EXE
    start_hidden([str(agent_exe), PORT])
    log("Setup completed")
    show_message(
        "MyAuction Automation Agent",
        "Installation/update completed.\nReturn to the site and click Recheck.",
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        show_message("MyAuction Automation Agent", f"Setup failed.\n\n{exc}", error=True)
        raise
