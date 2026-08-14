# -*- coding: utf-8 -*-
"""Windows installer for MyAuction Automation Agent.

The setup executable embeds MyAuctionAutomationAgent.zip, stops the old local
agent, installs the bundled files into LocalAppData, registers startup, and
starts the latest agent.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
import zipfile
from pathlib import Path


AGENT_NAME = "MyAuctionAutomationAgent"
SETUP_NAME = "마이실행기"
LEGACY_SETUP_NAME = "MyAuctionAutomationAgentSetup"
BUILD_SETUP_NAME = "MyAuctionRunnerSetup"
AGENT_EXE = f"{AGENT_NAME}.exe"
AGENT_ZIP = f"{AGENT_NAME}.zip"
VERSION_FILE = "agent-version.txt"
PORT = "8001"
SLOT_COUNT = 3
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


def powershell(command: str) -> subprocess.CompletedProcess:
    return run_hidden(
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
        f"Stop-ScheduledTask -TaskName '{AGENT_NAME}' -ErrorAction SilentlyContinue; "
        f"Get-Process -Name '{SETUP_NAME}','{LEGACY_SETUP_NAME}','{BUILD_SETUP_NAME}' | "
        f"Where-Object {{ $_.Id -ne {os.getpid()} }} | "
        "Stop-Process -Force; "
        "Get-CimInstance Win32_Process | "
        "Where-Object { ($_.Name -eq 'powershell.exe' -or $_.Name -eq 'pwsh.exe') -and "
        "($_.CommandLine -match 'Start-MyAuctionAutomationAgent\\.ps1' -or "
        "$_.CommandLine -match 'Launch-MyAuctionAutomationAgent\\.ps1') } | "
        "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; "
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
                '$ErrorActionPreference = "Continue"',
                f'$exe = Join-Path $PSScriptRoot "{AGENT_EXE}"',
                f'$basePort = {PORT}',
                f'$slotCount = {SLOT_COUNT}',
                '$configuredSlotCount = 0',
                'if ([int]::TryParse($env:AUCTION_REPORT_SLOT_COUNT, [ref]$configuredSlotCount) -and $configuredSlotCount -ge 1 -and $configuredSlotCount -le 4) { $slotCount = $configuredSlotCount }',
                '$log = Join-Path $PSScriptRoot "watchdog.log"',
                '$createdNew = $false',
                '$mutex = [System.Threading.Mutex]::new($true, "Local\\MyAuctionAutomationAgentWatchdog", [ref]$createdNew)',
                'if (-not $createdNew) { $mutex.Dispose(); exit 0 }',
                '$processes = @{}',
                'while ($true) {',
                '  for ($slot = 1; $slot -le $slotCount; $slot++) {',
                '    $existing = $processes[$slot]',
                '    if ($existing -and -not $existing.HasExited) { continue }',
                '    try {',
                '      $port = $basePort + $slot - 1',
                '      $workRoot = Join-Path $PSScriptRoot ("workspaces\\slot-{0}" -f $slot)',
                '      New-Item -ItemType Directory -Force -Path $workRoot | Out-Null',
                '      $agentId = "office-automation-{0:d2}" -f $slot',
                '      $agentName = "Office automation server #{0}" -f $slot',
                '      $command = "set AUCTION_REPORT_PORT=$port&&set AUCTION_REPORT_QUEUE_AGENT_ID=$agentId&&set AUCTION_REPORT_QUEUE_AGENT_NAME=$agentName&&set AUCTION_REPORT_WORK_ROOT=$workRoot&&`"$exe`" $port"',
                '      $processes[$slot] = Start-Process -FilePath $env:ComSpec -ArgumentList "/d", "/s", "/c", $command -WindowStyle Hidden -PassThru',
                '      Add-Content -LiteralPath $log -Value ("{0:o} slot {1} started on port {2}" -f (Get-Date), $slot, $port)',
                '    } catch {',
                '      Add-Content -LiteralPath $log -Value ("{0:o} slot {1} watchdog error: {2}" -f (Get-Date), $slot, $_.Exception.Message)',
                '    }',
                '  }',
                '  Start-Sleep -Seconds 5',
                '}',
            ]
        ),
        encoding="utf-8",
    )
    return runner


def write_manual_launcher(install_dir: Path) -> Path:
    launcher = install_dir / f"Launch-{AGENT_NAME}.ps1"
    launcher.write_text(
        "\n".join(
            [
                '$ErrorActionPreference = "SilentlyContinue"',
                f'$taskName = "{AGENT_NAME}"',
                f'$runner = Join-Path $PSScriptRoot "Start-{AGENT_NAME}.ps1"',
                f'$healthUrl = "http://127.0.0.1:{PORT}/api/health"',
                '$shell = New-Object -ComObject WScript.Shell',
                'function Test-AgentHealth {',
                '  try {',
                '    $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 2',
                '    return $response.StatusCode -eq 200',
                '  } catch { return $false }',
                '}',
                'if (Test-AgentHealth) {',
                '  $null = $shell.Popup("업무자동화 실행기가 이미 정상 실행 중입니다.", 4, "마이실행기", 64)',
                '  exit 0',
                '}',
                '$runKey = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run"',
                'New-Item -Path $runKey -Force | Out-Null',
                'Set-ItemProperty -Path $runKey -Name $taskName -Value (\'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"\' -f $runner)',
                '$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue',
                'if ($task) { Start-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue }',
                'Start-Sleep -Seconds 2',
                'if (-not (Test-AgentHealth)) {',
                '  Start-Process -FilePath powershell.exe -ArgumentList (\'-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"\' -f $runner) -WindowStyle Hidden',
                '}',
                '1..12 | ForEach-Object { if (-not (Test-AgentHealth)) { Start-Sleep -Milliseconds 500 } }',
                'if (Test-AgentHealth) {',
                '  $null = $shell.Popup("업무자동화 실행기를 시작했습니다.", 4, "마이실행기", 64)',
                '} else {',
                '  $null = $shell.Popup("실행기를 시작하지 못했습니다. 최신 설치관리자를 다시 실행해 주세요.", 8, "마이실행기", 16)',
                '  exit 1',
                '}',
            ]
        ),
        encoding="utf-8",
    )
    return launcher


def create_shortcuts(install_dir: Path, launcher: Path, runner: Path) -> None:
    escaped_dir = str(install_dir).replace("'", "''")
    escaped_launcher = str(launcher).replace("'", "''")
    escaped_runner = str(runner).replace("'", "''")
    escaped_icon = str(install_dir / AGENT_EXE).replace("'", "''")
    command = (
        "$ErrorActionPreference='Stop'; "
        "$desktop=[Environment]::GetFolderPath('Desktop'); "
        "$startup=[Environment]::GetFolderPath('Startup'); "
        "Remove-Item -LiteralPath (Join-Path $desktop '마이옥션 업무자동화 실행기.lnk') -Force -ErrorAction SilentlyContinue; "
        "Remove-Item -LiteralPath (Join-Path $desktop '마이실행기.lnk') -Force -ErrorAction SilentlyContinue; "
        "Remove-Item -LiteralPath (Join-Path $startup '마이옥션 업무자동화 자동시작.lnk') -Force -ErrorAction SilentlyContinue; "
        "Remove-Item -LiteralPath (Join-Path $startup '마이실행기 자동시작.lnk') -Force -ErrorAction SilentlyContinue; "
        "$shell=New-Object -ComObject WScript.Shell; "
        "$shortcut=$shell.CreateShortcut((Join-Path $desktop '마이실행기.lnk')); "
        "$shortcut.TargetPath='powershell.exe'; "
        f"$shortcut.Arguments='-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"{escaped_launcher}\"'; "
        f"$shortcut.WorkingDirectory='{escaped_dir}'; "
        f"$shortcut.IconLocation='{escaped_icon},0'; "
        "$shortcut.Description='마이옥션 업무자동화 실행기를 시작하거나 상태를 확인합니다.'; "
        "$shortcut.WindowStyle=7; $shortcut.Save(); "
        "$startupShortcut=$shell.CreateShortcut((Join-Path $startup '마이실행기 자동시작.lnk')); "
        "$startupShortcut.TargetPath='powershell.exe'; "
        f"$startupShortcut.Arguments='-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"{escaped_runner}\"'; "
        f"$startupShortcut.WorkingDirectory='{escaped_dir}'; "
        f"$startupShortcut.IconLocation='{escaped_icon},0'; "
        "$startupShortcut.Description='Windows 로그인 시 마이옥션 업무자동화를 자동으로 시작합니다.'; "
        "$startupShortcut.WindowStyle=7; $startupShortcut.Save()"
    )
    result = powershell(command)
    if result.returncode != 0:
        raise RuntimeError("Failed to create the desktop shortcut")
    log("Created desktop launcher and Startup-folder shortcuts")


def register_startup(runner: Path) -> str:
    escaped_runner = str(runner).replace("'", "''")
    task_command = (
        "$ErrorActionPreference='Stop'; "
        f"$taskName='{AGENT_NAME}'; "
        f"$runner='{escaped_runner}'; "
        "$action=New-ScheduledTaskAction -Execute 'powershell.exe' "
        "-Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"{0}\"' -f $runner); "
        "$trigger=New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME; "
        "$principal=New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited; "
        "$settings=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable "
        "-ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1); "
        "Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null; "
        "$runKey='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'; "
        "New-Item -Path $runKey -Force | Out-Null; "
        "Set-ItemProperty -Path $runKey -Name $taskName "
        "-Value ('powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"{0}\"' -f $runner)"
    )
    result = powershell(task_command)
    if result.returncode == 0:
        log("Registered scheduled task and Run-key startup with watchdog")
        return "scheduled_task"

    fallback_command = (
        "$ErrorActionPreference='Stop'; "
        "$runKey='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'; "
        "New-Item -Path $runKey -Force | Out-Null; "
        f"Set-ItemProperty -Path $runKey -Name '{AGENT_NAME}' "
        f"-Value 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"{runner}\"'"
    )
    fallback = powershell(fallback_command)
    if fallback.returncode != 0:
        raise RuntimeError("Failed to register both scheduled-task and Run-key startup")
    log("Scheduled task registration failed; registered Run-key watchdog fallback")
    return "run_key"


def start_registered_agent(runner: Path, startup_mode: str) -> None:
    if startup_mode == "scheduled_task":
        result = powershell(f"Start-ScheduledTask -TaskName '{AGENT_NAME}'")
        if result.returncode == 0:
            return
    start_hidden([
        "powershell.exe",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-WindowStyle",
        "Hidden",
        "-File",
        str(runner),
    ])


def wait_for_agent_health(expected_version: str, timeout_seconds: float = 60.0) -> bool:
    deadline = time.time() + timeout_seconds
    url = f"http://127.0.0.1:{PORT}/api/health"
    last_mismatched_version: str | None = None
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if response.status == 200:
                    payload = json.loads(response.read().decode("utf-8"))
                    actual_version = str(payload.get("version") or "").strip()
                    if actual_version == expected_version:
                        log(f"Agent health and version check passed ({actual_version})")
                        return True
                    if actual_version != last_mismatched_version:
                        log(
                            "Agent responded with an unexpected version "
                            f"(expected={expected_version}, actual={actual_version or 'missing'})"
                        )
                        last_mismatched_version = actual_version
                time.sleep(0.5)
        except Exception:
            time.sleep(0.5)
    log("Agent health check did not pass before timeout")
    return False


def downloaded_installer_candidates(home: Path) -> list[Path]:
    directories = [
        home / "Downloads",
        home / "Desktop",
        home / "OneDrive" / "Downloads",
        home / "OneDrive" / "Desktop",
    ]
    candidates: set[Path] = set()
    for directory in directories:
        if not directory.is_dir():
            continue
        for path in directory.iterdir():
            name = path.name
            if (
                name == "MyAuctionAutomationAgentSetup.exe"
                or (name.startswith("MyAuctionAutomationAgentSetup (") and name.endswith(").exe"))
                or name == "MyAuctionRunnerSetup.exe"
                or (name.startswith("MyAuctionRunnerSetup (") and name.endswith(").exe"))
                or name == "마이실행기.exe"
                or (name.startswith("마이실행기 (") and name.endswith(").exe"))
            ):
                candidates.add(path)
    return sorted(candidates)


def cleanup_downloaded_installers() -> None:
    home = Path(os.environ.get("USERPROFILE", str(Path.home())))
    current = Path(sys.executable).resolve()
    for candidate in downloaded_installer_candidates(home):
        try:
            resolved = candidate.resolve()
            if resolved == current:
                continue
            resolved.unlink(missing_ok=True)
            log(f"Removed obsolete installer copy {resolved}")
        except Exception as exc:
            log(f"Could not remove obsolete installer copy {candidate}: {exc}")

    allowed_self_dirs = {
        (home / "Downloads").resolve(),
        (home / "Desktop").resolve(),
        (home / "OneDrive" / "Downloads").resolve(),
        (home / "OneDrive" / "Desktop").resolve(),
    }
    if current.parent.resolve() not in allowed_self_dirs:
        return
    escaped_current = str(current).replace("'", "''")
    start_hidden([
        "powershell.exe",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-WindowStyle",
        "Hidden",
        "-Command",
        f"Start-Sleep -Seconds 3; Remove-Item -LiteralPath '{escaped_current}' -Force -ErrorAction SilentlyContinue",
    ])
    log(f"Scheduled current installer cleanup {current}")


def installation_result_message(healthy: bool) -> str:
    if healthy:
        return (
            "Installation/update completed.\n"
            "A desktop launcher was created.\n"
            "Return to the site and click Recheck."
        )
    return (
        "Installation/update completed, but startup could not be verified.\n"
        "Please click the desktop launcher, then return to the site and click Recheck."
    )


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
        version_path = extract_dir / VERSION_FILE
        if not version_path.is_file():
            raise FileNotFoundError(f"Bundled version marker was not found: {version_path}")
        expected_version = version_path.read_text(encoding="ascii").strip()
        if not expected_version:
            raise RuntimeError("Bundled agent version is empty")

        if install_dir.exists():
            log(f"Removing old install directory {install_dir}")
            for attempt in range(3):
                shutil.rmtree(install_dir, ignore_errors=True)
                if not install_dir.exists():
                    break
                stop_existing_agent()
                time.sleep(attempt + 1)
            if install_dir.exists():
                log(
                    "Old installation directory still contains locked files; "
                    "continuing with an in-place update"
                )
        install_dir.mkdir(parents=True, exist_ok=True)

        for item in extract_dir.iterdir():
            target = install_dir / item.name
            if item.is_dir():
                shutil.copytree(item, target, dirs_exist_ok=True)
            else:
                shutil.copy2(item, target)

    runner = write_startup_runner(install_dir)
    launcher = write_manual_launcher(install_dir)
    create_shortcuts(install_dir, launcher, runner)
    startup_mode = register_startup(runner)

    start_registered_agent(runner, startup_mode)
    healthy = wait_for_agent_health(expected_version)
    if healthy:
        log("Setup completed")
    else:
        log("Setup completed with a startup verification warning")
    show_message(
        "마이실행기",
        installation_result_message(healthy),
    )
    if healthy:
        cleanup_downloaded_installers()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        show_message("마이실행기", f"Setup failed.\n\n{exc}", error=True)
        raise
