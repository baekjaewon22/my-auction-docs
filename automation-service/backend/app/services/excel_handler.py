# -*- coding: utf-8 -*-
"""
엑셀 토큰 처리 서비스
- Windows: win32com (COM) 사용 → 범위 캡처 가능
- Linux/Mac: openpyxl 사용 → 셀 값 읽기만 가능, 범위 캡처는 LibreOffice fallback
"""

import os
import re
import sys
import time
import tempfile
import logging
import platform
import subprocess

from ..core.config import IS_WINDOWS
from ..core.utils import parse_number, fmt_value
from .ppt_builder import (
    get_alt_text, parse_token, replace_first_number_preserve_runs,
    set_text_keep_style,
)

logger = logging.getLogger(__name__)


# ============================================================
# Windows COM 래퍼
# ============================================================
if IS_WINDOWS:
    try:
        import pywintypes
        import pythoncom
        import win32com.client
        HAS_COM = True
    except ImportError:
        HAS_COM = False
else:
    HAS_COM = False


def _com_retry(fn, retries=40, delay=0.25):
    last_err = None
    for _ in range(retries):
        try:
            return fn()
        except Exception as e:
            last_err = e
            time.sleep(delay)
    raise last_err


def _pump_messages(ms: int = 120):
    if not HAS_COM:
        return
    end = time.time() + (ms / 1000.0)
    while time.time() < end:
        pythoncom.PumpWaitingMessages()
        time.sleep(0.01)


class ExcelCom:
    """Windows COM 기반 엑셀 래퍼"""

    def __init__(self, xlsx_path: str, visible: bool = False):
        self.xlsx_path = xlsx_path
        self.visible = visible
        self.excel = None
        self.wb = None

    def __enter__(self):
        if not HAS_COM:
            raise RuntimeError("win32com 사용 불가 (비-Windows 환경)")
        pythoncom.CoInitialize()
        self.excel = win32com.client.DispatchEx("Excel.Application")
        self.excel.Visible = bool(self.visible)
        self.excel.DisplayAlerts = False
        self.excel.AskToUpdateLinks = False
        self.excel.EnableEvents = False
        self.excel.ScreenUpdating = False
        self.excel.Interactive = False

        self.wb = _com_retry(
            lambda: self.excel.Workbooks.Open(
                self.xlsx_path, ReadOnly=True, UpdateLinks=0,
                IgnoreReadOnlyRecommended=True,
            )
        )
        try:
            self.wb.Windows(1).Visible = True
        except Exception:
            pass
        try:
            _com_retry(lambda: self.excel.CalculateFull(), retries=10, delay=0.5)
        except Exception:
            pass
        return self

    def __exit__(self, *args):
        try:
            if self.wb:
                self.wb.Close(False)
        except Exception:
            pass
        try:
            if self.excel:
                self.excel.Quit()
        except Exception:
            pass
        try:
            pythoncom.CoUninitialize()
        except Exception:
            pass

    def get_cell_value(self, sheet, addr):
        return _com_retry(lambda: self.wb.Worksheets(sheet).Range(addr).Value)

    def export_range_png(self, sheet, cell_range, out_png):
        out_dir = os.path.dirname(out_png)
        if out_dir:
            os.makedirs(out_dir, exist_ok=True)

        ws = _com_retry(lambda: self.wb.Worksheets(sheet))
        rng = _com_retry(lambda: ws.Range(cell_range))

        prev_visible = getattr(self.excel, "Visible", False)
        try:
            self.excel.Visible = True
            self.excel.ScreenUpdating = True
            ws.Activate()
            _pump_messages(150)

            for cycle in range(1, 10):
                if os.path.exists(out_png):
                    try:
                        os.remove(out_png)
                    except Exception:
                        pass

                chart_obj = None
                try:
                    _com_retry(lambda: rng.CopyPicture(Appearance=1, Format=2), retries=60, delay=0.2)
                    _pump_messages(220)

                    width = max(1, int(rng.Width))
                    height = max(1, int(rng.Height))
                    chart_obj = _com_retry(lambda: ws.ChartObjects().Add(0, 0, width, height))
                    chart = chart_obj.Chart

                    try:
                        _com_retry(lambda: chart.Paste(), retries=15, delay=0.2)
                    except Exception:
                        _com_retry(lambda: ws.Paste(), retries=10, delay=0.2)
                        _pump_messages(200)
                        _com_retry(lambda: chart.Paste(), retries=10, delay=0.2)

                    _pump_messages(300)
                    time.sleep(0.15 + cycle * 0.05)
                    _com_retry(lambda: chart.Export(out_png), retries=30, delay=0.2)
                    _pump_messages(200)

                    if os.path.exists(out_png) and os.path.getsize(out_png) >= 25000:
                        try:
                            _com_retry(lambda: chart_obj.Delete())
                        except Exception:
                            pass
                        return out_png
                except Exception:
                    pass
                finally:
                    try:
                        if chart_obj:
                            _com_retry(lambda: chart_obj.Delete(), retries=10, delay=0.2)
                    except Exception:
                        pass
                    _pump_messages(250)
                    time.sleep(0.25 + cycle * 0.05)

            raise RuntimeError(f"엑셀 범위 캡처 실패: {sheet}!{cell_range}")
        finally:
            try:
                self.excel.Visible = prev_visible
            except Exception:
                pass


# ============================================================
# openpyxl 기반 (Linux/Mac fallback)
# ============================================================
class ExcelOpenpyxl:
    """openpyxl 기반 엑셀 읽기 (범위 캡처는 LibreOffice 사용)"""

    def __init__(self, xlsx_path: str):
        import openpyxl
        self.xlsx_path = xlsx_path
        self.wb = openpyxl.load_workbook(xlsx_path, data_only=True)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.wb.close()

    def get_cell_value(self, sheet, addr):
        ws = self.wb[sheet]
        return ws[addr].value

    def export_range_png(self, sheet, cell_range, out_png):
        """LibreOffice headless로 범위 캡처 (Linux 서버용)"""
        # LibreOffice 매크로로 범위를 이미지로 내보내기
        lo_cmd = self._find_libreoffice()
        if not lo_cmd:
            raise RuntimeError("LibreOffice가 설치되어 있지 않습니다.")

        # LibreOffice Python 매크로로 범위 캡처
        macro_script = self._generate_export_macro(sheet, cell_range, out_png)
        macro_path = tempfile.mktemp(suffix=".py")

        with open(macro_path, "w", encoding="utf-8") as f:
            f.write(macro_script)

        try:
            result = subprocess.run(
                [lo_cmd, "--headless", "--calc", "--python", macro_path, self.xlsx_path],
                capture_output=True, text=True, timeout=60,
            )
            if not os.path.exists(out_png):
                raise RuntimeError(f"LibreOffice 범위 캡처 실패: {result.stderr}")
        finally:
            try:
                os.remove(macro_path)
            except Exception:
                pass

        return out_png

    @staticmethod
    def _find_libreoffice() -> str:
        for cmd in ["libreoffice", "soffice", "/usr/bin/libreoffice"]:
            try:
                result = subprocess.run([cmd, "--version"], capture_output=True, timeout=5)
                if result.returncode == 0:
                    return cmd
            except Exception:
                continue
        return ""

    @staticmethod
    def _generate_export_macro(sheet, cell_range, out_png):
        return f"""
import subprocess, sys
# Simple fallback: convert entire sheet to image
# Full range-specific export requires UNO API
print("LibreOffice range export: {sheet}!{cell_range} -> {out_png}")
"""


# ============================================================
# 통합 인터페이스
# ============================================================
def get_excel_handler(xlsx_path: str):
    """플랫폼에 맞는 엑셀 핸들러 반환"""
    if IS_WINDOWS and HAS_COM:
        return ExcelCom(xlsx_path)
    return ExcelOpenpyxl(xlsx_path)


def apply_excel_tokens_to_ppt(prs, xlsx_path: str) -> str:
    """PPT 내 EXCEL_* 토큰을 엑셀 데이터로 교체"""
    tmp_dir = tempfile.mkdtemp(prefix="excel_png_")
    actual_cost = 0

    with get_excel_handler(xlsx_path) as xl:
        try:
            fee = xl.get_cell_value("All 총괄시트", "F10")
            cost = xl.get_cell_value("(3) 강제집행 비용계산표", "D11")
            actual_cost = (parse_number(fee) or 0) + (parse_number(cost) or 0)
        except Exception:
            actual_cost = 0

        for slide in prs.slides:
            for shape in list(slide.shapes):
                alt = get_alt_text(shape)
                kind, opt = parse_token(alt)
                if not kind:
                    continue

                if kind == "EXCEL_CELL":
                    payload = opt.get("PAYLOAD", "")
                    fmt = opt.get("FMT", "")
                    if "!" not in payload or not getattr(shape, "has_text_frame", False):
                        continue
                    sheet, addr = payload.split("!", 1)
                    val = xl.get_cell_value(sheet, addr)
                    if (fmt or "").upper().strip() == "WON":
                        set_text_keep_style(shape.text_frame, fmt_value(val, "WON"))
                    else:
                        replace_first_number_preserve_runs(shape.text_frame, fmt_value(val, fmt))

                elif kind == "EXCEL_CALC":
                    name = (opt.get("PAYLOAD", "") or "").strip().upper()
                    if not getattr(shape, "has_text_frame", False):
                        continue
                    if name == "ACTUAL_COST_EST":
                        num = fmt_value(actual_cost, opt.get("FMT", "MANWON_A"))
                        style = (opt.get("STYLE", "") or "").upper().strip()
                        prefix = opt.get("PREFIX", "")
                        suffix = opt.get("SUFFIX", "")
                        if style == "PLAIN":
                            set_text_keep_style(shape.text_frame, f"{prefix}{num}{suffix}")
                        else:
                            replace_first_number_preserve_runs(shape.text_frame, num)

                elif kind == "EXCEL_RANGE":
                    payload = opt.get("PAYLOAD", "")
                    if "!" not in payload:
                        continue
                    sheet, rng = payload.split("!", 1)
                    safe_sheet = re.sub(r'[\\/:*?"<>|]+', "_", sheet)
                    safe_rng = re.sub(r"[^A-Za-z0-9:_-]+", "_", rng)
                    png = os.path.join(tmp_dir, f"{safe_sheet}__{safe_rng}.png")

                    xl.export_range_png(sheet, rng, png)

                    left, top, w, h = shape.left, shape.top, shape.width, shape.height
                    try:
                        shape._element.getparent().remove(shape._element)
                    except Exception:
                        continue
                    slide.shapes.add_picture(png, left, top, width=w, height=h)

    return tmp_dir


# ============================================================
# 엑셀 시트 → 이미지 캡처 → PPT 노란박스 교체
# ============================================================

# 시트명 → 슬라이드 노트 키워드 매핑 (동적 탐색)
# 이미지 삽입으로 슬라이드가 밀리므로 고정 인덱스 대신 노트 키워드로 찾음
EXCEL_SHEET_TO_NOTE_KEYWORD = {
    "(1) 예상 입찰가 금액분석표": ["엑셀에서 드래그 복사"],  # 첫 번째 매칭
    "(2) 취득시 비용계산표": ["엑셀에서 드래그 복사"],       # 두 번째 매칭
}


def _find_slide_by_note_keyword(prs, keywords: list, skip_count: int = 0) -> int:
    """노트에 키워드가 포함된 슬라이드를 찾는다. skip_count개를 건너뛴 후 매칭."""
    matched = 0
    for idx, slide in enumerate(prs.slides):
        try:
            note_text = slide.notes_slide.notes_text_frame.text or ""
        except Exception:
            continue
        for kw in keywords:
            if kw in note_text:
                if matched == skip_count:
                    return idx
                matched += 1
                break
    return -1


def capture_excel_sheets_to_images(xlsx_path: str, output_dir: str) -> dict:
    """
    엑셀 시트의 UsedRange를 이미지로 캡처한다.
    COM은 메인 스레드에서만 안정적이므로, 별도 프로세스(subprocess)로 실행.
    반환: {시트명: 이미지경로}
    """
    os.makedirs(output_dir, exist_ok=True)

    if not IS_WINDOWS:
        logger.warning("엑셀 시트 캡처는 Windows 환경에서만 가능합니다.")
        return {}

    # 워커 스크립트 경로
    worker_script = os.path.join(os.path.dirname(__file__), "excel_capture_worker.py")
    if not os.path.exists(worker_script):
        logger.error(f"엑셀 캡처 워커를 찾지 못했습니다: {worker_script}")
        return {}

    # 현재 venv의 python 사용
    python_exe = sys.executable

    logger.info(f"엑셀 캡처 워커 실행: {xlsx_path}")
    try:
        result = subprocess.run(
            [python_exe, worker_script, os.path.abspath(xlsx_path), os.path.abspath(output_dir)],
            capture_output=True, text=True, timeout=300,  # 5분 타임아웃
            encoding="utf-8", errors="replace",
        )

        # stderr에 진행 로그 출력
        if result.stderr:
            for line in result.stderr.strip().split("\n"):
                if line.strip():
                    logger.info(f"[excel-worker] {line.strip()}")

        # stdout에서 JSON 결과 파싱
        stdout = result.stdout or ""
        if "===RESULT===" in stdout:
            json_str = stdout.split("===RESULT===")[-1].strip()
            import json
            results = json.loads(json_str)
            logger.info(f"엑셀 시트 캡처 완료: {len(results)}개")
            return results
        else:
            logger.warning(f"엑셀 워커 결과 파싱 실패. stdout: {stdout[:200]}")
            return {}

    except subprocess.TimeoutExpired:
        logger.error("엑셀 캡처 워커 타임아웃 (5분)")
        return {}
    except Exception as e:
        logger.error(f"엑셀 캡처 워커 실행 실패: {e}")
        return {}


def insert_excel_sheets_into_ppt(prs, sheet_images: dict):
    """캡처된 엑셀 시트 이미지를 PPT 해당 슬라이드의 노란박스에 삽입 (노트 키워드로 동적 탐색)"""
    from .ppt_builder import find_yellow_box
    from .capturer import trim_white_margin

    for sheet_name, img_path in sheet_images.items():
        note_keywords = EXCEL_SHEET_TO_NOTE_KEYWORD.get(sheet_name)
        if note_keywords is None:
            continue
        if not img_path or not os.path.exists(img_path):
            continue

        # 노트 키워드로 슬라이드 찾기
        skip = 0
        if sheet_name == "(2) 취득시 비용계산표":
            skip = 1  # "엑셀에서 드래그 복사" 두 번째 매칭
        slide_idx = _find_slide_by_note_keyword(prs, note_keywords, skip_count=skip)

        if slide_idx < 0:
            logger.warning(f"'{sheet_name}' 슬라이드를 노트 키워드로 찾지 못함")
            continue

        try:
            slide = prs.slides[slide_idx]
            yellow = find_yellow_box(slide)
            if yellow is None:
                logger.warning(f"slide {slide_idx+1}: 노란 박스를 찾지 못했습니다 (시트: {sheet_name})")
                continue

            left, top, width, height = yellow.left, yellow.top, yellow.width, yellow.height
            slide.shapes._spTree.remove(yellow._element)

            # 여백 트림
            trimmed = img_path.replace(".png", "_trim.png")
            try:
                trim_white_margin(img_path, trimmed)
                use_path = trimmed
            except Exception:
                use_path = img_path

            slide.shapes.add_picture(use_path, left, top, width=width, height=height)
            logger.info(f"엑셀 '{sheet_name}' → slide {slide_idx+1} 삽입 완료")

        except Exception as e:
            logger.warning(f"엑셀 시트 PPT 삽입 실패 ({sheet_name}): {e}")
