# -*- coding: utf-8 -*-
"""
API 라우트 + WebSocket
"""

import os
import asyncio
import json
import logging
import threading
import time
import zipfile
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException, Query
from fastapi.responses import FileResponse, Response

from ..models.schemas import ReportRequest, ProgressUpdate, ReportResult, RightsCertificateBatchRequest
from ..services.orchestrator import generate_report
from ..services.rights_certificate import generate_rights_certificate, export_pptx_to_pdf
from ..core.config import settings, OUTPUT_DIR, CAPTURE_DIR, ensure_dirs, load_config, save_config
from ..core.utils import normalize_myauction_detail_url

logger = logging.getLogger(__name__)
router = APIRouter()

# 진행상황 저장소 (간단한 in-memory)
progress_store: dict[str, list[ProgressUpdate]] = {}
active_websockets: dict[str, list[WebSocket]] = {}
report_files: dict[str, str] = {}
DOWNLOAD_HISTORY_KEY = "download_history"
DOWNLOAD_HISTORY_LIMIT = 20


def _clean_error_message(value: object, fallback: str = "자동화 처리 중 응답 대기 시간이 초과되었습니다.") -> str:
    text = str(value or "").strip()
    if not text:
        return fallback
    if "Stacktrace:" in text or text.startswith("Message:"):
        lowered = text.lower()
        if "element click intercepted" in lowered:
            return "마이옥션 화면의 팝업/고정 영역이 버튼 클릭을 가려 자동 클릭에 실패했습니다. 다시 시도하거나 팝업 노출 여부를 확인해 주세요."
        if "timeout" in lowered or "message:" in lowered:
            return fallback
        return fallback
    return text[:500]


def _media_type_for_file(path: str) -> str:
    suffix = Path(path).suffix.lower()
    if suffix == ".pdf":
        return "application/pdf"
    if suffix == ".pptx":
        return "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    if suffix == ".pptm":
        return "application/vnd.ms-powerpoint.presentation.macroEnabled.12"
    if suffix == ".html":
        return "text/html; charset=utf-8"
    if suffix == ".zip":
        return "application/zip"
    return "application/vnd.ms-powerpoint.presentation.macroEnabled.12"


def _download_history_items() -> list[dict]:
    cfg = load_config()
    items = cfg.get(DOWNLOAD_HISTORY_KEY)
    if not isinstance(items, list):
        return []
    return [item for item in items if isinstance(item, dict)]


def _save_download_history_items(items: list[dict]) -> None:
    cfg = load_config()
    cfg[DOWNLOAD_HISTORY_KEY] = items[:DOWNLOAD_HISTORY_LIMIT]
    save_config(cfg)


def _available_download_formats(output_file: str) -> list[str]:
    path = Path(output_file or "")
    suffix = path.suffix.lower()
    formats: list[str] = []
    if suffix == ".zip":
        return ["zip"] if path.exists() else []
    if path.exists():
        if suffix == ".pdf":
            formats.append("pdf")
        if suffix in (".pptx", ".pptm"):
            formats.append("pptx")
    if suffix != ".pdf" and path.with_suffix(".pdf").exists() and "pdf" not in formats:
        formats.append("pdf")
    if suffix not in (".pptx", ".pptm"):
        for companion_suffix in (".pptx", ".pptm"):
            if path.with_suffix(companion_suffix).exists():
                formats.append("pptx")
                break
    return formats


def _download_history_response_item(item: dict) -> dict:
    output_file = str(item.get("output_file") or "")
    path = Path(output_file)
    formats = _available_download_formats(output_file)
    return {
        "id": item.get("id") or "",
        "task_id": item.get("task_id") or "",
        "output_type": item.get("output_type") or "auction_report",
        "title": item.get("title") or path.name or "보고서",
        "file_name": path.name,
        "created_at": item.get("created_at") or "",
        "message": item.get("message") or "",
        "exists": bool(formats),
        "formats": formats,
    }


def _register_download_history(task_id: str, output_file: str, output_type: str, message: str = "") -> None:
    if not output_file:
        return
    path = Path(output_file)
    title = path.name or ("권리분석 보증서" if output_type == "rights_certificate" else "브리핑자료")
    item = {
        "id": uuid4().hex[:12],
        "task_id": task_id,
        "output_type": output_type,
        "title": title,
        "output_file": str(path),
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "message": message,
    }
    existing = [
        old for old in _download_history_items()
        if str(old.get("output_file") or "") != str(path) and str(old.get("task_id") or "") != task_id
    ]
    _save_download_history_items([item] + existing)


def _find_download_history_item(history_id: str) -> dict:
    for item in _download_history_items():
        if item.get("id") == history_id:
            return item
    raise HTTPException(status_code=404, detail="다운로드 이력을 찾을 수 없습니다.")


def _download_file_for_format(output_file: str, requested_format: str | None) -> str:
    if not output_file or not os.path.exists(output_file):
        raise HTTPException(status_code=404, detail="해당 작업의 보고서 파일이 없습니다.")

    file_format = (requested_format or "").lower().strip(".")
    if not file_format:
        return output_file
    if file_format == "zip":
        path = Path(output_file)
        if path.suffix.lower() == ".zip" and path.exists():
            return str(path)
        raise HTTPException(status_code=404, detail="ZIP 파일이 없습니다.")
    if file_format in ("ppt", "pptx", "pptm"):
        return _resolve_companion_file(output_file, (".pptx", ".pptm"))
    if file_format == "pdf":
        return _resolve_pdf_file(output_file)
    raise HTTPException(status_code=400, detail="지원하지 않는 다운로드 형식입니다.")


def _has_rights_certificate_permission(request: ReportRequest | RightsCertificateBatchRequest) -> bool:
    role = str(getattr(request, "requester_role", "") or "").lower()
    permission = str(getattr(request, "requester_permission", "") or "").lower()
    return role == "master" or permission == "special"


def _resolve_companion_file(output_file: str, suffixes: tuple[str, ...]) -> str:
    path = Path(output_file)
    if path.suffix.lower() in suffixes and path.exists():
        return str(path)
    for suffix in suffixes:
        candidate = path.with_suffix(suffix)
        if candidate.exists():
            return str(candidate)
    raise HTTPException(status_code=404, detail="요청한 형식의 보고서 파일이 없습니다.")


def _resolve_pdf_file(output_file: str) -> str:
    path = Path(output_file)
    if path.suffix.lower() == ".pdf" and path.exists():
        return str(path)

    pdf_path = path.with_suffix(".pdf")
    if pdf_path.exists():
        return str(pdf_path)

    if path.suffix.lower() in (".pptx", ".pptm"):
        if export_pptx_to_pdf(path, pdf_path):
            return str(pdf_path)
        raise HTTPException(status_code=409, detail="PDF 변환에 실패했습니다. PowerPoint 설치 상태를 확인해 주세요.")

    raise HTTPException(status_code=404, detail="PDF로 변환할 수 있는 PPT 파일이 없습니다.")


async def _broadcast_progress(task_id: str, update: ProgressUpdate) -> None:
    stale: list[WebSocket] = []
    for ws in active_websockets.get(task_id, []):
        try:
            await ws.send_json(update.model_dump())
        except Exception:
            stale.append(ws)

    for ws in stale:
        try:
            active_websockets[task_id].remove(ws)
        except ValueError:
            pass


def _append_progress(task_id: str, update: ProgressUpdate) -> None:
    progress_store.setdefault(task_id, []).append(update)
    try:
        loop = getattr(router, "_progress_loop", None)
        if loop and loop.is_running():
            asyncio.run_coroutine_threadsafe(_broadcast_progress(task_id, update), loop)
    except Exception:
        pass


def _seconds_until(start_at: str | None) -> float:
    if not start_at:
        return 0.0
    text = start_at.strip()
    if not text:
        return 0.0
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return 0.0
    now = datetime.now(dt.tzinfo) if dt.tzinfo else datetime.now()
    return max(0.0, (dt - now).total_seconds())


def _batch_zip_path(task_id: str) -> Path:
    return OUTPUT_DIR / f"권리분석_보증서_배치_{task_id}.zip"


def _write_batch_zip(task_id: str, output_files: list[str]) -> str:
    ensure_dirs()
    zip_path = _batch_zip_path(task_id)
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        used_names: set[str] = set()
        for idx, file_path in enumerate(output_files, start=1):
            if not file_path or not os.path.exists(file_path):
                continue
            name = Path(file_path).name
            if name in used_names:
                stem = Path(name).stem
                suffix = Path(name).suffix
                name = f"{stem}_{idx}{suffix}"
            used_names.add(name)
            zf.write(file_path, arcname=name)
    return str(zip_path)


def _run_rights_certificate_batch(request: RightsCertificateBatchRequest, task_id: str) -> None:
    import asyncio as _aio

    urls = [normalize_myauction_detail_url(u, request.myauction_id) for u in request.urls if u and u.strip()]
    total = len(urls)
    if total == 0:
        _append_progress(
            task_id,
            ProgressUpdate(step=0, total_steps=1, title="오류", message="처리할 경매 물건 URL이 없습니다.", status="error", percent=0),
        )
        return

    delay = _seconds_until(request.start_at)
    if delay > 0:
        scheduled_time = request.start_at or ""
        _append_progress(
            task_id,
            ProgressUpdate(
                step=0,
                total_steps=total,
                title="예약 대기",
                message=f"{scheduled_time} 예약 실행 대기 중...",
                status="running",
                percent=0,
            ),
        )
        time.sleep(delay)

    output_files: list[str] = []
    failed: list[str] = []
    interval = max(0, int(request.interval_seconds or 0))

    for idx, url in enumerate(urls, start=1):
        _append_progress(
            task_id,
            ProgressUpdate(
                step=idx - 1,
                total_steps=total,
                title=f"{idx}/{total} 물건 시작",
                message=url,
                status="running",
                percent=((idx - 1) / total) * 100,
            ),
        )

        child_request = ReportRequest(
            output_type="rights_certificate",
            url=url,
            myauction_id=request.myauction_id,
            myauction_pw=request.myauction_pw,
            remember_login=request.remember_login,
            author_name=request.author_name,
            author_title=request.author_title,
            author_phone=request.author_phone,
            requester_role=request.requester_role,
            requester_permission=request.requester_permission,
        )

        def _child_progress(update: ProgressUpdate):
            child_percent = max(0.0, min(100.0, float(update.percent or 0)))
            batch_percent = ((idx - 1) + child_percent / 100.0) / total * 100.0
            _append_progress(
                task_id,
                ProgressUpdate(
                    step=update.step,
                    total_steps=update.total_steps,
                    title=f"{idx}/{total} {update.title}",
                    message=update.message,
                    status="running",
                    percent=batch_percent,
                ),
            )

        try:
            result = _aio.run(generate_rights_certificate(child_request, progress_callback=_child_progress, task_id=f"{task_id}_{idx:03d}"))
            if result.get("success") and result.get("output_file"):
                output_files.append(result["output_file"])
            else:
                failed.append(f"{idx}번: {result.get('message', '생성 실패')}")
        except Exception as e:
            logger.exception("권리분석 보증서 배치 작업 실패")
            failed.append(f"{idx}번: {e}")

        if idx < total and interval > 0:
            _append_progress(
                task_id,
                ProgressUpdate(
                    step=idx,
                    total_steps=total,
                    title="다음 물건 대기",
                    message=f"{interval}초 후 다음 물건을 처리합니다.",
                    status="running",
                    percent=(idx / total) * 100,
                ),
            )
            time.sleep(interval)

    if output_files:
        report_files[task_id] = _write_batch_zip(task_id, output_files)
        _register_download_history(task_id, report_files[task_id], "rights_certificate", f"권리분석 보증서 {len(output_files)}건 묶음")

    if failed:
        message = f"{len(output_files)}건 완료, {len(failed)}건 실패. " + " / ".join(failed[:3])
        status = "completed" if output_files else "error"
    else:
        message = f"권리분석 보증서 {len(output_files)}건 생성 완료"
        status = "completed"

    _append_progress(
        task_id,
        ProgressUpdate(
            step=total,
            total_steps=total,
            title="완료" if status == "completed" else "실패",
            message=message,
            status=status,
            percent=100.0,
        ),
    )


@router.get("/health")
async def health_check():
    content = json.dumps({"status": "ok", "title": settings.app_title}, ensure_ascii=False)
    return Response(content=content, media_type="application/json; charset=utf-8")


@router.post("/report/generate", response_model=ReportResult)
async def api_generate_report(request: ReportRequest):
    """보고서 생성 (동기적 실행, 결과 반환)"""
    import uuid
    task_id = str(uuid.uuid4())[:8]
    progress_store[task_id] = []

    async def _progress(update: ProgressUpdate):
        # WebSocket으로 전송
        await _broadcast_progress(task_id, update)
        # 메모리 저장
        if task_id not in progress_store:
            progress_store[task_id] = []
        progress_store[task_id].append(update)

    if request.output_type == "rights_certificate":
        if not _has_rights_certificate_permission(request):
            raise HTTPException(status_code=403, detail="권리분석 보증서는 특별 권한이 있는 사원만 생성할 수 있습니다.")
        result = await asyncio.to_thread(
            lambda: asyncio.run(generate_rights_certificate(request, progress_callback=_progress, task_id=task_id))
        )
        if result.get("output_file"):
            report_files[task_id] = result["output_file"]
            _register_download_history(task_id, result["output_file"], "rights_certificate", result.get("message", ""))
        return ReportResult(
            success=result.get("success", False),
            output_file=result.get("output_file"),
            message=_clean_error_message(result.get("message", "")) if not result.get("success") else result.get("message", ""),
        )

    result = await asyncio.to_thread(
        lambda: asyncio.run(generate_report(request, progress_callback=_progress, task_id=task_id))
    )
    if result.get("output_file"):
        report_files[task_id] = result["output_file"]
        _register_download_history(task_id, result["output_file"], "auction_report", result.get("message", ""))

    return ReportResult(
        success=result.get("success", False),
        output_file=result.get("output_file"),
        message=_clean_error_message(result.get("message", "")) if not result.get("success") else result.get("message", ""),
    )


@router.post("/report/start")
async def api_start_report(request: ReportRequest):
    """보고서 생성 시작 (비동기, task_id 반환)"""
    import uuid
    task_id = str(uuid.uuid4())[:8]
    progress_store[task_id] = []

    if request.output_type == "rights_certificate":
        if not _has_rights_certificate_permission(request):
            raise HTTPException(status_code=403, detail="권리분석 보증서는 특별 권한이 있는 사원만 생성할 수 있습니다.")
        def _sync_progress(update: ProgressUpdate):
            progress_store.setdefault(task_id, []).append(update)
            try:
                loop = getattr(router, "_progress_loop", None)
                if loop and loop.is_running():
                    asyncio.run_coroutine_threadsafe(_broadcast_progress(task_id, update), loop)
            except Exception:
                pass

        def _run_sync():
            try:
                import asyncio as _aio
                result = _aio.run(generate_rights_certificate(request, progress_callback=_sync_progress, task_id=task_id))
                if result.get("output_file"):
                    report_files[task_id] = result["output_file"]
                    _register_download_history(task_id, result["output_file"], "rights_certificate", result.get("message", ""))
                progress_store.setdefault(task_id, []).append(
                    ProgressUpdate(
                        step=5,
                        total_steps=5,
                        title="완료" if result.get("success") else "실패",
                        message=_clean_error_message(result.get("message", "")) if not result.get("success") else result.get("message", ""),
                        status="completed" if result.get("success") else "error",
                        percent=100.0,
                    )
                )
            except Exception as e:
                progress_store.setdefault(task_id, []).append(
                    ProgressUpdate(
                        step=0,
                        total_steps=5,
                        title="오류",
                        message=_clean_error_message(e),
                        status="error",
                        percent=0,
                    )
                )

        import threading
        threading.Thread(target=_run_sync, daemon=True).start()
        return {"task_id": task_id}

    def _sync_progress(update: ProgressUpdate):
        """동기 콜백: progress 저장 (스레드 안전)"""
        progress_store.setdefault(task_id, []).append(update)
        try:
            loop = getattr(router, "_progress_loop", None)
            if loop and loop.is_running():
                asyncio.run_coroutine_threadsafe(_broadcast_progress(task_id, update), loop)
        except Exception:
            pass

    def _run_sync():
        """별도 스레드에서 동기 실행"""
        try:
            # generate_report는 내부에서 블로킹 작업(Selenium 등)을 하므로 스레드에서 실행
            import asyncio as _aio
            result = _aio.run(generate_report(request, progress_callback=_sync_progress, task_id=task_id))
            if result.get("output_file"):
                report_files[task_id] = result["output_file"]
                _register_download_history(task_id, result["output_file"], "auction_report", result.get("message", ""))
            progress_store.setdefault(task_id, []).append(
                ProgressUpdate(
                    step=6, total_steps=6,
                    title="완료" if result.get("success") else "실패",
                    message=_clean_error_message(result.get("message", "")) if not result.get("success") else result.get("message", ""),
                    status="completed" if result.get("success") else "error",
                    percent=100.0,
                )
            )
        except Exception as e:
            progress_store.setdefault(task_id, []).append(
                ProgressUpdate(
                    step=0, total_steps=6,
                    title="오류", message=_clean_error_message(e),
                    status="error", percent=0,
                )
            )

    # 별도 스레드에서 실행 → task_id 즉시 반환
    import threading
    t = threading.Thread(target=_run_sync, daemon=True)
    t.start()

    return {"task_id": task_id}


@router.post("/report/start-batch")
async def api_start_rights_certificate_batch(request: RightsCertificateBatchRequest):
    """권리분석 보증서 다건 생성 시작 (예약/순차 실행, task_id 반환)"""
    import uuid

    task_id = str(uuid.uuid4())[:8]
    progress_store[task_id] = []

    urls = [u.strip() for u in request.urls if u and u.strip()]
    if not urls:
        raise HTTPException(status_code=400, detail="처리할 경매 물건 URL이 없습니다.")
    if not request.myauction_id or not request.myauction_pw:
        raise HTTPException(status_code=400, detail="마이옥션 계정 정보가 없습니다.")
    if not _has_rights_certificate_permission(request):
        raise HTTPException(status_code=403, detail="권리분석 보증서는 특별 권한이 있는 사원만 생성할 수 있습니다.")

    normalized_request = RightsCertificateBatchRequest(
        output_type="rights_certificate",
        urls=urls,
        myauction_id=request.myauction_id,
        myauction_pw=request.myauction_pw,
        remember_login=request.remember_login,
        author_name=request.author_name,
        author_title=request.author_title,
        author_phone=request.author_phone,
        requester_role=request.requester_role,
        requester_permission=request.requester_permission,
        start_at=request.start_at,
        interval_seconds=max(0, int(request.interval_seconds or 0)),
    )

    t = threading.Thread(target=_run_rights_certificate_batch, args=(normalized_request, task_id), daemon=True)
    t.start()

    return {"task_id": task_id}


@router.get("/report/progress/{task_id}")
async def api_get_progress(task_id: str):
    """진행상황 폴링 조회"""
    updates = progress_store.get(task_id, [])
    return {"task_id": task_id, "updates": [u.model_dump() for u in updates]}


@router.get("/report/download-history")
async def api_get_download_history():
    """최근 다운로드/생성 이력 조회 (최대 20개)"""
    items = [_download_history_response_item(item) for item in _download_history_items()]
    return {"items": items[:DOWNLOAD_HISTORY_LIMIT], "limit": DOWNLOAD_HISTORY_LIMIT}


@router.get("/report/download-history/{history_id}")
async def api_download_history_file(history_id: str, format: str | None = Query(default=None)):
    """다운로드 이력 항목 재다운로드"""
    item = _find_download_history_item(history_id)
    output_file = _download_file_for_format(str(item.get("output_file") or ""), format)
    return FileResponse(
        output_file,
        media_type=_media_type_for_file(output_file),
        filename=os.path.basename(output_file),
    )


@router.get("/report/download/{task_id}")
async def api_download_report_by_task(task_id: str, format: str | None = Query(default=None)):
    """작업별 생성 보고서 다운로드"""
    output_file = _download_file_for_format(report_files.get(task_id) or "", format)
    return FileResponse(
        output_file,
        media_type=_media_type_for_file(output_file),
        filename=os.path.basename(output_file),
    )


@router.get("/report/download")
async def api_download_report():
    """생성된 보고서 다운로드"""
    output_file = settings.output_file
    if not os.path.exists(output_file):
        raise HTTPException(status_code=404, detail="보고서 파일이 없습니다.")
    return FileResponse(
        output_file,
        media_type="application/vnd.ms-powerpoint.presentation.macroEnabled.12",
        filename=os.path.basename(output_file),
    )


@router.websocket("/ws/progress/{task_id}")
async def ws_progress(websocket: WebSocket, task_id: str):
    """WebSocket으로 실시간 진행상황 수신"""
    router._progress_loop = asyncio.get_running_loop()
    await websocket.accept()

    if task_id not in active_websockets:
        active_websockets[task_id] = []
    active_websockets[task_id].append(websocket)

    try:
        # 기존 진행상황 전송
        for update in progress_store.get(task_id, []):
            await websocket.send_json(update.model_dump())

        # 연결 유지
        while True:
            try:
                await asyncio.wait_for(websocket.receive_text(), timeout=60)
            except asyncio.TimeoutError:
                await websocket.send_json({"type": "ping"})
    except WebSocketDisconnect:
        pass
    finally:
        if task_id in active_websockets:
            active_websockets[task_id].remove(websocket)
