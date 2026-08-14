"""Single-consumer pull worker for the my-docs durable automation queue."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import socket
import sqlite3
import threading
import time
import zipfile
from pathlib import Path

import requests

from ..core.config import OUTPUT_DIR, get_app_dir, settings
from ..core.execution import AUTOMATION_EXECUTION_LOCK
from ..models.schemas import ReportRequest
from .orchestrator import generate_report
from .rights_certificate import export_pptx_to_pdf, generate_rights_certificate

logger = logging.getLogger(__name__)


class CentralQueueWorker:
    def __init__(self) -> None:
        self.base_url = str(settings.queue_base_url or "").rstrip("/")
        self.api_key = str(settings.queue_agent_key or "").strip()
        self.agent_id = str(settings.queue_agent_id or socket.gethostname()).strip()
        self.display_name = str(settings.queue_agent_name or socket.gethostname()).strip()
        self.version = str(settings.agent_version or "unknown")
        self.poll_seconds = max(2, int(settings.queue_poll_seconds or 3))
        self.stop_event = threading.Event()
        self.thread: threading.Thread | None = None
        safe_agent_id = "".join(ch if ch.isalnum() or ch in "-_." else "_" for ch in self.agent_id)
        self.ledger_path = Path(get_app_dir()) / f"automation-queue-ledger-{safe_agent_id}.sqlite3"
        self._ensure_ledger()

    @property
    def enabled(self) -> bool:
        return bool(self.base_url and self.api_key)

    def _ensure_ledger(self) -> None:
        with sqlite3.connect(self.ledger_path) as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("""CREATE TABLE IF NOT EXISTS executions (
                job_id TEXT PRIMARY KEY, lease_token TEXT NOT NULL, status TEXT NOT NULL,
                output_file TEXT NOT NULL DEFAULT '', message TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""")

    def _record(self, job_id: str, lease_token: str, status: str, output_file: str = "", message: str = "") -> None:
        with sqlite3.connect(self.ledger_path) as db:
            db.execute("""INSERT INTO executions(job_id, lease_token, status, output_file, message, updated_at)
                VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(job_id) DO UPDATE SET lease_token=excluded.lease_token, status=excluded.status,
                output_file=excluded.output_file, message=excluded.message, updated_at=CURRENT_TIMESTAMP""",
                (job_id, lease_token, status, output_file, message))

    def _headers(self) -> dict[str, str]:
        return {"X-Automation-Agent-Key": self.api_key, "User-Agent": "MyAuctionAutomationAgent/CentralQueue"}

    def _post(self, path: str, payload: dict, timeout: int = 20) -> dict:
        response = requests.post(f"{self.base_url}{path}", headers=self._headers(), json=payload, timeout=timeout)
        response.raise_for_status()
        return response.json() if response.content else {}

    def start(self) -> None:
        if not self.enabled or (self.thread is not None and self.thread.is_alive()):
            return
        self.thread = threading.Thread(target=self.run_forever, name="central-automation-queue", daemon=True)
        self.thread.start()

    def stop(self) -> None:
        self.stop_event.set()

    def run_forever(self) -> None:
        logger.info("중앙 자동화 큐 소비자 시작: agent_id=%s", self.agent_id)
        while not self.stop_event.is_set():
            try:
                claimed = self._post("/jobs/claim", {
                    "agent_id": self.agent_id,
                    "display_name": self.display_name,
                    "version": self.version,
                })
                job = claimed.get("job") if isinstance(claimed, dict) else None
                if job:
                    self._execute(job)
                else:
                    self._post("/heartbeat", {
                        "agent_id": self.agent_id, "display_name": self.display_name,
                        "version": self.version, "status": "idle", "current_job_id": "",
                    })
                    self.stop_event.wait(self.poll_seconds)
            except Exception as exc:
                logger.warning("중앙 자동화 큐 연결 실패: %s", exc)
                self.stop_event.wait(min(30, self.poll_seconds * 3))

    def _progress(self, job_id: str, lease_token: str, update) -> None:
        try:
            self._post(f"/jobs/{job_id}/progress", {
                "lease_token": lease_token,
                "step": int(getattr(update, "step", 0) or 0),
                "total_steps": int(getattr(update, "total_steps", 1) or 1),
                "title": str(getattr(update, "title", "") or ""),
                "message": str(getattr(update, "message", "") or ""),
                "status": str(getattr(update, "status", "running") or "running"),
                "percent": float(getattr(update, "percent", 0) or 0),
            })
        except Exception as exc:
            logger.warning("작업 진행상태 전송 실패(%s): %s", job_id, exc)

    def _heartbeat_loop(self, job_id: str, lease_token: str, done: threading.Event) -> None:
        while not done.wait(30):
            try:
                self._post(f"/jobs/{job_id}/heartbeat", {
                    "lease_token": lease_token, "agent_id": self.agent_id,
                    "version": self.version,
                })
            except Exception as exc:
                logger.warning("작업 heartbeat 실패(%s): %s", job_id, exc)

    def _execute(self, job: dict) -> None:
        job_id = str(job.get("id") or "")
        lease_token = str(job.get("lease_token") or "")
        payload = job.get("payload") if isinstance(job.get("payload"), dict) else {}
        done = threading.Event()
        heartbeat = threading.Thread(target=self._heartbeat_loop, args=(job_id, lease_token, done), daemon=True)
        self._record(job_id, lease_token, "running")
        heartbeat.start()
        try:
            with AUTOMATION_EXECUTION_LOCK:
                if bool(job.get("is_batch")):
                    result = self._execute_batch(job_id, lease_token, payload)
                else:
                    request = ReportRequest(**payload)
                    callback = lambda update: self._progress(job_id, lease_token, update)
                    if request.output_type == "rights_certificate":
                        result = asyncio.run(generate_rights_certificate(request, progress_callback=callback, task_id=job_id))
                    else:
                        result = asyncio.run(generate_report(request, progress_callback=callback, task_id=job_id))
            if not result.get("success"):
                raise RuntimeError(str(result.get("message") or "자동화 실행에 실패했습니다."))
            output_file = str(result.get("output_file") or "")
            self._record(job_id, lease_token, "uploading", output_file, str(result.get("message") or ""))
            uploaded = self._upload_available_artifacts(job_id, lease_token, output_file)
            if not uploaded:
                raise RuntimeError("업로드할 결과 파일을 찾을 수 없습니다.")
            self._post(f"/jobs/{job_id}/complete", {
                "lease_token": lease_token, "agent_id": self.agent_id, "version": self.version,
                "message": result.get("message") or "자료 생성이 완료되었습니다.",
                "diagnostics": result.get("diagnostics") or [],
            })
            self._record(job_id, lease_token, "completed", output_file, str(result.get("message") or ""))
        except Exception as exc:
            logger.exception("중앙 자동화 작업 실패: %s", job_id)
            try:
                self._post(f"/jobs/{job_id}/fail", {
                    "lease_token": lease_token, "agent_id": self.agent_id, "version": self.version,
                    "error_code": "EXECUTION_FAILED", "message": str(exc)[:1000],
                })
            except Exception:
                logger.exception("중앙 자동화 실패상태 보고 실패: %s", job_id)
            self._record(job_id, lease_token, "failed", message=str(exc))
        finally:
            done.set()
            heartbeat.join(timeout=2)

    def _execute_batch(self, job_id: str, lease_token: str, payload: dict) -> dict:
        urls = [str(value).strip() for value in payload.get("urls", []) if str(value).strip()]
        outputs: list[str] = []
        for index, url in enumerate(urls, start=1):
            child = ReportRequest(**{**payload, "url": url, "output_type": "rights_certificate"})
            callback = lambda update, idx=index: self._progress(job_id, lease_token, update.model_copy(update={
                "title": f"{idx}/{len(urls)} {update.title}",
                "percent": ((idx - 1) + float(update.percent or 0) / 100) / len(urls) * 100,
            }))
            result = asyncio.run(generate_rights_certificate(child, progress_callback=callback, task_id=f"{job_id}_{index:03d}"))
            if not result.get("success") or not result.get("output_file"):
                return {"success": False, "message": f"{index}번째 권리분석 생성 실패: {result.get('message', '')}"}
            outputs.append(str(result["output_file"]))
            if index < len(urls):
                time.sleep(max(0, int(payload.get("interval_seconds") or 0)))
        zip_path = OUTPUT_DIR / f"권리분석_보증서_배치_{job_id}.zip"
        with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for index, output in enumerate(outputs, start=1):
                path = Path(output)
                archive.write(path, arcname=f"{index:03d}_{path.name}")
                companion = path.with_suffix(".pptx")
                if companion.exists() and companion != path:
                    archive.write(companion, arcname=f"{index:03d}_{companion.name}")
        return {"success": True, "output_file": str(zip_path), "message": f"권리분석 보증서 {len(outputs)}건 생성 완료"}

    def _upload_available_artifacts(self, job_id: str, lease_token: str, output_file: str) -> list[str]:
        primary = Path(output_file)
        candidates: dict[str, Path] = {}
        if primary.suffix.lower() == ".zip":
            candidates["zip"] = primary
        elif primary.suffix.lower() == ".pdf":
            candidates["pdf"] = primary
            if primary.with_suffix(".pptx").exists():
                candidates["pptx"] = primary.with_suffix(".pptx")
        elif primary.suffix.lower() in (".pptx", ".pptm"):
            candidates["pptx"] = primary
            pdf = primary.with_suffix(".pdf")
            if not pdf.exists():
                export_pptx_to_pdf(primary, pdf)
            if pdf.exists():
                candidates["pdf"] = pdf
        uploaded: list[str] = []
        for file_format, path in candidates.items():
            if not path.exists():
                continue
            headers = {**self._headers(), "X-Automation-Lease-Token": lease_token,
                       "X-File-Name": requests.utils.quote(path.name)}
            with path.open("rb") as stream:
                response = requests.post(f"{self.base_url}/jobs/{job_id}/artifacts/{file_format}",
                                         headers=headers, data=stream, timeout=180)
            response.raise_for_status()
            uploaded.append(file_format)
        return uploaded


_worker: CentralQueueWorker | None = None


def start_central_queue_worker() -> CentralQueueWorker | None:
    global _worker
    if _worker is None:
        _worker = CentralQueueWorker()
    if _worker.enabled:
        _worker.start()
        return _worker
    logger.info("중앙 자동화 큐 비활성: AUCTION_REPORT_QUEUE_AGENT_KEY 미설정")
    return None


def stop_central_queue_worker() -> None:
    if _worker is not None:
        _worker.stop()
