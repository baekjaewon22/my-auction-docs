# -*- coding: utf-8 -*-
"""
엑셀 시트 캡처 워커 (별도 프로세스로 실행)
방식: Excel COM → 시트별 PDF 내보내기 → PDF를 이미지로 변환
CopyPicture가 불안정하므로 ExportAsFixedFormat(PDF) 방식 사용
"""

import os
import re
import sys
import time
import json


def pump(ms=200):
    import pythoncom
    end = time.time() + ms / 1000
    while time.time() < end:
        pythoncom.PumpWaitingMessages()
        time.sleep(0.01)


def capture_sheets(xlsx_path: str, output_dir: str) -> dict:
    import pythoncom
    import win32com.client

    pythoncom.CoInitialize()
    os.makedirs(output_dir, exist_ok=True)
    results = {}

    excel = None
    wb = None

    target_sheets = [
        "(1) 예상 입찰가 금액분석표",
        "(2) 취득시 비용계산표",
    ]

    try:
        excel = win32com.client.Dispatch("Excel.Application")
        excel.Visible = True
        excel.DisplayAlerts = False
        excel.AskToUpdateLinks = False
        pump(1000)
        time.sleep(2)

        wb = excel.Workbooks.Open(
            os.path.abspath(xlsx_path),
            ReadOnly=True, UpdateLinks=0,
            IgnoreReadOnlyRecommended=True,
        )
        pump(500)
        time.sleep(1)

        # 계산 강제
        try:
            excel.CalculateFull()
        except Exception:
            pass
        pump(500)

        # 시트명 목록
        sheet_names = [wb.Worksheets(i).Name for i in range(1, wb.Worksheets.Count + 1)]
        print(f"[INFO] 시트 목록: {sheet_names}", file=sys.stderr)

        for sheet_name in target_sheets:
            if sheet_name not in sheet_names:
                print(f"[SKIP] 시트 없음: {sheet_name}", file=sys.stderr)
                continue

            safe_name = re.sub(r'[\\/:*?"<>|()]+', '_', sheet_name).strip('_ ')
            out_pdf = os.path.join(output_dir, f"excel_{safe_name}.pdf")
            out_png = os.path.join(output_dir, f"excel_{safe_name}.png")

            try:
                ws = wb.Worksheets(sheet_name)
                ws.Activate()
                pump(500)
                time.sleep(0.5)

                # PDF로 내보내기 (xlTypePDF=0)
                if os.path.exists(out_pdf):
                    os.remove(out_pdf)

                ws.ExportAsFixedFormat(
                    Type=0,  # xlTypePDF
                    Filename=os.path.abspath(out_pdf),
                    Quality=0,  # xlQualityStandard
                    IncludeDocProperties=False,
                    IgnorePrintAreas=False,
                    OpenAfterPublish=False,
                )
                pump(300)

                if not os.path.exists(out_pdf) or os.path.getsize(out_pdf) < 1000:
                    print(f"[FAIL] PDF 생성 실패: {sheet_name}", file=sys.stderr)
                    continue

                print(f"[OK] PDF 생성: {sheet_name} → {out_pdf} ({os.path.getsize(out_pdf)} bytes)", file=sys.stderr)

                # PDF → PNG 변환 (PyMuPDF 사용)
                import fitz
                doc = fitz.open(out_pdf)
                if doc.page_count > 0:
                    page = doc.load_page(0)
                    # 고해상도 렌더링
                    scale = 300 / 72  # 300 DPI
                    mat = fitz.Matrix(scale, scale)
                    pix = page.get_pixmap(matrix=mat, alpha=False)
                    pix.save(out_png)
                    print(f"[OK] PNG 변환: {sheet_name} → {out_png}", file=sys.stderr)
                    results[sheet_name] = out_png
                doc.close()

                # PDF 정리
                try:
                    os.remove(out_pdf)
                except Exception:
                    pass

            except Exception as e:
                print(f"[ERROR] {sheet_name}: {e}", file=sys.stderr)

    except Exception as e:
        print(f"[FATAL] {e}", file=sys.stderr)
    finally:
        try:
            if wb:
                wb.Close(False)
        except Exception:
            pass
        try:
            if excel:
                excel.Quit()
        except Exception:
            pass
        pump(300)
        try:
            pythoncom.CoUninitialize()
        except Exception:
            pass

    return results


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python excel_capture_worker.py <xlsx_path> <output_dir>", file=sys.stderr)
        sys.exit(1)

    results = capture_sheets(sys.argv[1], sys.argv[2])
    print("===RESULT===")
    print(json.dumps(results, ensure_ascii=False))
