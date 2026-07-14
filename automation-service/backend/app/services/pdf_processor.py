# -*- coding: utf-8 -*-
"""
PDF 처리 서비스
- PDF 다운로드 (Selenium 쿠키 활용)
- PDF → 이미지 변환
- PDF 가로 변환
- 등기부 문구 페이지 검색
- 감정평가서 위치도 탐지 (텍스트 + OCR)
- 벡터 프레임 추출 / 렌더링
"""

import os
import re
import sys
import glob
import base64
import logging
from datetime import datetime
from typing import Optional

import requests
import fitz  # PyMuPDF
import numpy as np
from PIL import Image, ImageOps, ImageEnhance
from pdf2image import convert_from_path

from ..core.config import POPPLER_PATH, PDF_DOWNLOAD_DIR, CAPTURE_DIR, TESSERACT_PATH, ensure_dirs
from ..core.utils import track_file, normalize_text_for_match

logger = logging.getLogger(__name__)

# Tesseract 설정
try:
    import pytesseract
    if os.path.exists(TESSERACT_PATH):
        pytesseract.pytesseract.tesseract_cmd = TESSERACT_PATH
except ImportError:
    pytesseract = None

ensure_dirs()


# ============================================================
# PDF 다운로드
# ============================================================
def download_pdf_with_cookies(driver, pdf_url: str, fallback_prefix: str) -> str:
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    pdf_path = os.path.join(str(PDF_DOWNLOAD_DIR), f"{fallback_prefix}_{ts}.pdf")

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": driver.current_url,
    }
    cookies = {c["name"]: c["value"] for c in driver.get_cookies()}

    logger.info(f"PDF 다운로드: {pdf_url}")
    resp = requests.get(pdf_url, headers=headers, cookies=cookies, stream=True, timeout=30)
    resp.raise_for_status()

    with open(pdf_path, "wb") as f:
        for chunk in resp.iter_content(chunk_size=8192):
            if chunk:
                f.write(chunk)

    track_file(pdf_path)
    logger.info(f"PDF 저장 완료: {pdf_path} ({os.path.getsize(pdf_path)} bytes)")
    return pdf_path


def print_current_page_to_pdf(driver, out_prefix: str, landscape: bool = True) -> str:
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    pdf_path = os.path.join(str(PDF_DOWNLOAD_DIR), f"{out_prefix}_{ts}.pdf")

    result = driver.execute_cdp_cmd("Page.printToPDF", {
        "landscape": landscape,
        "printBackground": True,
        "preferCSSPageSize": True,
    })
    with open(pdf_path, "wb") as f:
        f.write(base64.b64decode(result["data"]))

    track_file(pdf_path)
    return pdf_path


def is_valid_pdf(pdf_path: str) -> bool:
    if not pdf_path or not os.path.exists(pdf_path):
        return False
    if os.path.getsize(pdf_path) < 1024:
        return False
    with open(pdf_path, "rb") as f:
        return f.read(4) == b"%PDF"


def extract_pdf_text(pdf_path: str, max_pages: int = 20) -> str:
    """Extract embedded PDF text without OCR."""
    if not is_valid_pdf(pdf_path):
        return ""
    try:
        doc = fitz.open(pdf_path)
        try:
            page_count = min(doc.page_count, max(1, max_pages))
            return "\n".join(doc.load_page(index).get_text("text") or "" for index in range(page_count))
        finally:
            doc.close()
    except Exception as exc:
        logger.warning(f"PDF 텍스트 추출 실패({pdf_path}): {exc}")
        return ""


def ocr_image_paths(image_paths: list[str], max_images: int = 2, timeout_seconds: int = 20) -> str:
    """OCR a small number of document pages with a hard per-page timeout."""
    if not pytesseract:
        return ""
    texts: list[str] = []
    for image_path in image_paths[:max(1, max_images)]:
        if not image_path or not os.path.exists(image_path):
            continue
        try:
            with Image.open(image_path) as source:
                image = ImageOps.autocontrast(ImageOps.grayscale(source.convert("RGB")))
                text = pytesseract.image_to_string(
                    image,
                    lang="kor+eng",
                    config="--psm 6",
                    timeout=max(1, timeout_seconds),
                )
                if text:
                    texts.append(text)
        except Exception as exc:
            logger.warning(f"문서 이미지 OCR 생략({image_path}): {exc}")
    return "\n".join(texts)


# ============================================================
# PDF → 이미지 변환
# ============================================================
def pdf_to_images(pdf_path: str, img_pattern: str, dpi: int = 300, timeout_seconds: int = 90) -> int:
    if not pdf_path or not os.path.exists(pdf_path) or os.path.getsize(pdf_path) == 0:
        logger.error("PDF 파일이 없거나 비어있습니다.")
        return 0

    for old in glob.glob(img_pattern.format(page="*")):
        try:
            os.remove(old)
        except OSError:
            pass

    pages = convert_from_path(pdf_path, dpi=dpi, poppler_path=POPPLER_PATH, timeout=timeout_seconds)
    total = 0
    for idx, page in enumerate(pages, start=1):
        filename = img_pattern.format(page=idx)
        page.save(filename, "PNG")
        track_file(filename)
        total += 1

    logger.info(f"PDF → 이미지 변환 완료 ({total}페이지)")
    return total


# ============================================================
# PDF 가로 변환
# ============================================================
def _to_landscape_canvas(img: Image.Image, dpi: int = 200) -> Image.Image:
    if img.mode != "RGB":
        img = img.convert("RGB")
    w, h = img.size
    canvas_w = int(3508 * (dpi / 300))
    canvas_h = int(2480 * (dpi / 300))
    scale = min(canvas_w / w, canvas_h / h)
    new_w, new_h = max(1, int(w * scale)), max(1, int(h * scale))
    resized = img.resize((new_w, new_h))
    canvas = Image.new("RGB", (canvas_w, canvas_h), (255, 255, 255))
    canvas.paste(resized, ((canvas_w - new_w) // 2, (canvas_h - new_h) // 2))
    return canvas


def pdf_to_landscape_pdf(src_pdf: str, out_pdf: str, dpi: int = 200) -> str:
    pages = convert_from_path(src_pdf, dpi=dpi, poppler_path=POPPLER_PATH, timeout=90)
    rgb_pages = [_to_landscape_canvas(p, dpi) for p in pages]
    first, rest = rgb_pages[0], rgb_pages[1:]
    first.save(out_pdf, save_all=True, append_images=rest)
    return out_pdf


def pdf_last_page_to_landscape(src_pdf: str, out_pdf: str, dpi: int = 200) -> str:
    """마지막 페이지만 가로 캔버스로 변환"""
    pages = convert_from_path(src_pdf, dpi=dpi, poppler_path=POPPLER_PATH, timeout=90)
    if not pages:
        raise RuntimeError("PDF 페이지를 읽지 못했습니다(0 pages).")
    canvas = _to_landscape_canvas(pages[-1], dpi)
    canvas.save(out_pdf)
    return out_pdf


def pdf_pages_from_to_landscape(src_pdf: str, out_pdf: str, start_0base: int, dpi: int = 220) -> str:
    if start_0base < 0:
        start_0base = 0
    pages = convert_from_path(
        src_pdf, dpi=dpi, poppler_path=POPPLER_PATH,
        first_page=start_0base + 1,
        timeout=90,
    )
    if not pages:
        raise RuntimeError("지정 범위 페이지 변환 실패")
    rgb_pages = [_to_landscape_canvas(p, dpi) for p in pages]
    first, rest = rgb_pages[0], rgb_pages[1:]
    first.save(out_pdf, save_all=True, append_images=rest)
    return out_pdf


# ============================================================
# 등기부: 문구 페이지 찾기
# ============================================================
def find_first_page_contains_text(pdf_path: str, needle: str) -> int:
    doc = fitz.open(pdf_path)
    try:
        for i in range(doc.page_count):
            txt = doc.load_page(i).get_text("text") or ""
            if needle in txt:
                return i
    finally:
        doc.close()
    return -1


# ============================================================
# 감정평가서: 위치도 탐지 (텍스트 → OCR)
# ============================================================
def find_appraisal_map_pages(pdf_path: str, ocr_zoom: float = 4.0):
    targets = ["광역위치도", "상세위치도", "위치도"]
    found = {}

    doc = fitz.open(pdf_path)
    total_pages = doc.page_count
    logger.info(f"(감정평가서) 총 {total_pages}페이지")

    # 1) 텍스트 탐색
    for i in range(total_pages):
        text = doc.load_page(i).get_text("text") or ""
        norm = normalize_text_for_match(text)
        used_pages = set(found.values())

        for t in targets:
            if t in found:
                continue
            if t not in norm:
                continue
            if t == "위치도":
                if ("광역위치도" in norm) or ("상세위치도" in norm):
                    continue
                if i in used_pages:
                    continue
            found[t] = i
            used_pages.add(i)

    if found:
        for t in ["광역위치도", "위치도", "상세위치도"]:
            if t in found:
                logger.info(f"텍스트로 '{t}' 발견 (page {found[t] + 1})")
        doc.close()
        return found

    # 2) OCR 탐색
    if not pytesseract:
        logger.warning("pytesseract 미설치 → OCR 스킵")
        doc.close()
        return found

    # OCR 전처리 3단계 ROI 생성기 (final.py 원본 그대로)
    def _title_rois_for_ocr(img: Image.Image):
        """
        제목은 보통 페이지 상단에 있음.
        ROI: 상단 28%
        전처리 3단계 '다중 시도' (문서 편차 흡수)
          1) 그레이 + 약한 대비(이진화 없음)
          2) 오토콘트라스트 + 약한 이진화
          3) 동적 threshold(평균 밝기 기반) 이진화
        """
        w, h = img.size
        top_h = int(h * 0.28)
        roi0 = img.crop((0, 0, w, top_h))

        # 1) 그레이 + 약한 대비 (이진화 X)
        roi1 = ImageOps.grayscale(roi0)
        roi1 = ImageEnhance.Contrast(roi1).enhance(1.6)
        yield roi1

        # 2) 오토콘트라스트 + 약한 threshold
        roi2 = ImageOps.grayscale(roi0)
        roi2 = ImageOps.autocontrast(roi2)
        roi2 = ImageEnhance.Contrast(roi2).enhance(1.8)
        roi2 = roi2.point(lambda x: 255 if x > 190 else 0)
        yield roi2

        # 3) 동적 threshold(평균 밝기 기반)
        roi3 = ImageOps.grayscale(roi0)
        roi3 = ImageEnhance.Contrast(roi3).enhance(2.0)
        try:
            hist = roi3.histogram()
            total = sum(hist)
            mean = sum(i * hist[i] for i in range(256)) / total if total > 0 else 200.0
        except Exception:
            mean = 200.0
        thr = int(max(150, min(220, mean - 10)))
        roi3 = roi3.point(lambda x: 255 if x > thr else 0)
        yield roi3

    for i in range(total_pages):
        page = doc.load_page(i)
        pix = page.get_pixmap(matrix=fitz.Matrix(ocr_zoom, ocr_zoom), alpha=False)
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)

        # 3단계 전처리 ROI를 순회하며 OCR 재시도
        ocr_text = ""
        for roi in _title_rois_for_ocr(img):
            try:
                ocr_text = pytesseract.image_to_string(
                    roi, lang="kor+eng", config="--oem 3 --psm 6", timeout=30
                ) or ""
            except Exception:
                ocr_text = ""
                continue
            # 전처리별 OCR 결과 중 하나라도 유의미하면 사용
            if normalize_text_for_match(ocr_text):
                break

        norm = normalize_text_for_match(ocr_text)
        used_pages = set(found.values())

        for t in targets:
            if t in found:
                continue
            if t not in norm:
                continue
            if t == "위치도":
                if ("광역위치도" in norm) or ("상세위치도" in norm):
                    continue
                if i in used_pages:
                    continue
            found[t] = i
            logger.info(f"OCR로 '{t}' 발견 (page {i + 1})")

        if len(found) >= 3:
            break

    doc.close()
    return found


def choose_location_types(found_pages: dict):
    order = ["광역위치도", "위치도", "상세위치도"]
    available = [k for k in order if k in found_pages]
    if len(available) >= 3:
        return ["광역위치도", "상세위치도"]
    return available


# ============================================================
# 감정평가서: 내부구조도 / 건물개황도 탐지 (텍스트 → OCR)
# ============================================================
def _page_has_significant_image(page: fitz.Page, min_area_ratio: float = 0.05) -> bool:
    """페이지에 의미 있는 크기의 이미지(도면)가 있는지 확인"""
    page_area = page.rect.width * page.rect.height
    if page_area <= 0:
        return False
    try:
        imgs = page.get_images(full=True)
        for info in imgs:
            try:
                xref = info[0]
                rects = page.get_image_rects(xref)
                for r in rects:
                    r = fitz.Rect(r)
                    img_area = max(0, r.width) * max(0, r.height)
                    if img_area >= page_area * min_area_ratio:
                        return True
            except Exception:
                continue
    except Exception:
        pass

    # 이미지가 없어도 벡터 드로잉(도면)이 많으면 도면 페이지일 수 있음
    try:
        drawings = page.get_drawings()
        if len(drawings) >= 10:  # 선이 많으면 도면
            return True
    except Exception:
        pass

    return False


def find_building_overview_page(pdf_path: str, ocr_zoom: float = 4.0) -> int:
    """
    감정평가서 PDF에서 물건현황 도면용 페이지를 찾는다.
    위치도 전용 페이지(광역위치도/상세위치도/위치도)는 위치도 추출용으로 분리하고,
    내부구조도/호별배치도/건물개황도/전유부분/도면/개황도 후보만 우선순위로 선택한다.
    반환: 0-base 페이지 인덱스. 못 찾으면 -1.
    """
    priority_keywords = ["내부구조도", "호별배치도", "건물개황도", "전유부분", "도면", "개황도"]
    alias_keywords = {
        "내부구조도": ["내부구조도", "내부구조"],
        "호별배치도": ["호별배치도", "호별배치"],
        "건물개황도": ["건물개황도", "건물개황"],
        "전유부분": ["전유부분"],
        "도면": ["도면"],
        "개황도": ["개황도"],
    }
    location_only_keywords = ["광역위치도", "상세위치도", "위치도"]

    def _matched_overview_keyword(norm: str) -> str:
        for canonical in priority_keywords:
            for alias in alias_keywords[canonical]:
                if alias in norm:
                    return canonical
        return ""

    def _is_location_only(norm: str) -> bool:
        has_location = any(keyword in norm for keyword in location_only_keywords)
        return has_location and not _matched_overview_keyword(norm)

    def _matched_overview_keyword_on_page(page) -> str:
        """본문의 '내부구조도 참조' 같은 안내문이 아니라 제목/도면 블록의 키워드만 후보로 삼는다."""
        page_height = float(page.rect.height or 0)
        try:
            blocks = page.get_text("blocks") or []
        except Exception:
            blocks = []
        for block in blocks:
            if len(block) < 5:
                continue
            y0 = float(block[1] or 0)
            text = str(block[4] or "")
            norm = normalize_text_for_match(text)
            keyword = _matched_overview_keyword(norm)
            if not keyword:
                continue
            is_title_area = page_height <= 0 or y0 <= page_height * 0.45
            is_short_heading = len(norm) <= 80
            is_reference_only = "참조" in norm and len(norm) > 20
            if (is_title_area or is_short_heading) and not is_reference_only:
                return keyword
        return ""

    def _rank(candidate: tuple[int, str, bool]) -> tuple[int, int, int]:
        page_idx, keyword, has_image = candidate
        image_rank = 0 if has_image else 1
        return (image_rank, priority_keywords.index(keyword), page_idx)

    def _collect_candidates_from_text(doc: fitz.Document) -> tuple[list[tuple[int, str, bool]], list[int]]:
        candidates = []
        location_pages = []
        for i in range(doc.page_count):
            page = doc.load_page(i)
            text = page.get_text("text") or ""
            norm = normalize_text_for_match(text)
            if _is_location_only(norm):
                location_pages.append(i)
                continue
            keyword = _matched_overview_keyword_on_page(page)
            if keyword:
                candidates.append((i, keyword, _page_has_significant_image(page)))
        return candidates, location_pages

    def _title_rois_for_ocr(img: Image.Image):
        w, h = img.size
        top_h = int(h * 0.35)
        roi0 = img.crop((0, 0, w, top_h))

        roi1 = ImageOps.grayscale(roi0)
        roi1 = ImageEnhance.Contrast(roi1).enhance(1.6)
        yield roi1

        roi2 = ImageOps.grayscale(roi0)
        roi2 = ImageOps.autocontrast(roi2)
        roi2 = ImageEnhance.Contrast(roi2).enhance(1.8)
        roi2 = roi2.point(lambda x: 255 if x > 190 else 0)
        yield roi2

        roi3 = ImageOps.grayscale(roi0)
        roi3 = ImageEnhance.Contrast(roi3).enhance(2.0)
        try:
            hist = roi3.histogram()
            total = sum(hist)
            mean = sum(idx * hist[idx] for idx in range(256)) / total if total > 0 else 200.0
        except Exception:
            mean = 200.0
        thr = int(max(150, min(220, mean - 10)))
        roi3 = roi3.point(lambda x: 255 if x > thr else 0)
        yield roi3

        whole = ImageOps.grayscale(img)
        whole = ImageOps.autocontrast(whole)
        whole = ImageEnhance.Contrast(whole).enhance(1.4)
        yield whole

    def _collect_candidates_from_ocr(doc: fitz.Document) -> tuple[list[tuple[int, str, bool]], list[int]]:
        candidates = []
        location_pages = []
        for i in range(doc.page_count):
            page = doc.load_page(i)
            pix = page.get_pixmap(matrix=fitz.Matrix(ocr_zoom, ocr_zoom), alpha=False)
            img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)

            page_norm = ""
            for roi in _title_rois_for_ocr(img):
                try:
                    ocr_text = pytesseract.image_to_string(
                        roi, lang="kor+eng", config="--oem 3 --psm 6", timeout=30
                    ) or ""
                except Exception:
                    continue
                roi_norm = normalize_text_for_match(ocr_text)
                if roi_norm:
                    page_norm = f"{page_norm} {roi_norm}".strip()
                if _is_location_only(page_norm) or _matched_overview_keyword(page_norm):
                    break

            if _is_location_only(page_norm):
                location_pages.append(i)
                continue
            keyword = _matched_overview_keyword(page_norm)
            if keyword:
                has_image = _page_has_significant_image(page)
                candidates.append((i, keyword, has_image))
                if keyword == "내부구조도" and has_image:
                    logger.info(f"OCR 기준 1순위 도면 후보 조기 선택: page {i + 1}")
                    return candidates, location_pages
        return candidates, location_pages

    doc = fitz.open(pdf_path)
    try:
        total_pages = doc.page_count
        logger.info(f"감정평가서 도면 탐색: 총 {total_pages}페이지")

        text_candidates, text_location_pages = _collect_candidates_from_text(doc)
        logger.info(
            "텍스트 기준 도면 후보 페이지: "
            f"{[(p + 1, kw, 'image' if has_img else 'no-image') for p, kw, has_img in text_candidates]}"
        )
        if text_location_pages:
            logger.info(f"텍스트 기준 위치도 전용 후보 페이지: {[p + 1 for p in text_location_pages]}")

        if text_candidates:
            image_candidates = [candidate for candidate in text_candidates if candidate[2]]
            ranked_candidates = image_candidates or text_candidates
            if image_candidates:
                logger.info("텍스트 기준 도면 후보 중 이미지가 있는 페이지를 우선 선택합니다.")
            best_idx, best_kw, has_image = sorted(ranked_candidates, key=_rank)[0]
            logger.info(
                f"최종 선택된 도면 페이지 번호: {best_idx + 1} "
                f"(텍스트, keyword={best_kw}, has_image={has_image})"
            )
            return best_idx

        if not pytesseract:
            logger.warning("pytesseract 미설치 → 도면 OCR fallback 스킵")
            logger.info("도면/내부구조도 후보 없음")
            return -1

        ocr_candidates, ocr_location_pages = _collect_candidates_from_ocr(doc)
        logger.info(
            "OCR 기준 도면 후보 페이지: "
            f"{[(p + 1, kw, 'image' if has_img else 'no-image') for p, kw, has_img in ocr_candidates]}"
        )
        if ocr_location_pages:
            logger.info(f"OCR 기준 위치도 전용 후보 페이지: {[p + 1 for p in ocr_location_pages]}")

        if ocr_candidates:
            image_candidates = [candidate for candidate in ocr_candidates if candidate[2]]
            ranked_candidates = image_candidates or ocr_candidates
            if image_candidates:
                logger.info("OCR 기준 도면 후보 중 이미지가 있는 페이지를 우선 선택합니다.")
            best_idx, best_kw, has_image = sorted(ranked_candidates, key=_rank)[0]
            logger.info(
                f"최종 선택된 도면 페이지 번호: {best_idx + 1} "
                f"(OCR, keyword={best_kw}, has_image={has_image})"
            )
            return best_idx

        logger.info("도면/내부구조도 후보 없음")
        return -1
    finally:
        doc.close()


# ============================================================
# 벡터 프레임 추출 + 렌더링
# ============================================================
def _rect_area(r: fitz.Rect) -> float:
    return max(0.0, (r.x1 - r.x0)) * max(0.0, (r.y1 - r.y0))


def _rect_close(a: fitz.Rect, b: fitz.Rect, tol: float = 2.0) -> bool:
    return (abs(a.x0 - b.x0) <= tol and abs(a.y0 - b.y0) <= tol and
            abs(a.x1 - b.x1) <= tol and abs(a.y1 - b.y1) <= tol)


def _pick_inner_frame_rect(page: fitz.Page, verbose=False) -> fitz.Rect:
    page_rect = page.rect
    page_area = _rect_area(page_rect)

    drawings = page.get_drawings()
    candidates = []
    for d in drawings:
        r = fitz.Rect(d["rect"])
        if r.width >= 120 and r.height >= 120:
            area = _rect_area(r)
            if 0 < area < page_area * 0.985 and area >= page_area * 0.3025:
                if not any(_rect_close(r, u) for u in candidates):
                    candidates.append(r)

    if candidates:
        best = max(candidates, key=_rect_area)
        return best

    # 고정 비율 fallback
    pr = page_rect
    w, h = pr.width, pr.height
    return fitz.Rect(
        pr.x0 + w * 0.02, pr.y0 + h * 0.18,
        pr.x0 + w * 0.98, pr.y0 + h * 0.95,
    )


def render_pages_vector(pdf_path: str, page_indices: list, out_prefix: str, dpi: int = 260):
    doc = fitz.open(pdf_path)
    out_paths = []
    scale = dpi / 72.0
    matrix = fitz.Matrix(scale, scale)

    for n, p0 in enumerate(page_indices, start=1):
        page = doc.load_page(int(p0))
        frame = _pick_inner_frame_rect(page)
        clip = fitz.Rect(
            max(page.rect.x0, frame.x0),
            max(page.rect.y0, frame.y0),
            min(page.rect.x1, frame.x1),
            min(page.rect.y1, frame.y1),
        )
        if clip.width <= 5 or clip.height <= 5:
            raise RuntimeError("clip rect too small")

        pix = page.get_pixmap(matrix=matrix, clip=clip, alpha=False)
        out_path = f"{out_prefix}_{n}.png"
        os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
        pix.save(out_path)
        out_paths.append(out_path)

    doc.close()
    return out_paths
