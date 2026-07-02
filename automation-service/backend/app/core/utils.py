# -*- coding: utf-8 -*-
"""공용 유틸리티"""

import os
import re
import time
import glob
from typing import Optional, Tuple, Dict
from urllib.parse import urlsplit, urlunsplit


# ============================================================
# 숫자 / 포맷
# ============================================================
_NUM_RE = re.compile(r"(\d[\d,]*)")


def parse_number(v) -> Optional[float]:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        try:
            return float(v.replace(",", "").strip())
        except Exception:
            return None
    return None


def fmt_value(val, fmt: str) -> str:
    num = parse_number(val)
    if num is None:
        return ""
    fmt = (fmt or "").upper().strip()
    if fmt == "WON":
        return f"{int(num):,}원"
    if fmt == "MANWON_A":
        return f"{int(num // 10000):,}"
    return str(val)


def extract_number_before_won(text: str) -> str:
    if not text:
        return ""
    m = re.search(r"([\d,]+)\s*원", text.replace("\xa0", " "))
    return m.group(1) if m else ""


def extract_area_pair(text: str):
    if not text:
        return "", ""
    t = text.replace("\xa0", " ")
    m = re.search(r"([\d.,]+)\s*㎡.*?\(\s*([\d.,]+)\s*평", t)
    if not m:
        return "", ""
    return m.group(1), m.group(2)


def split_address_old(addr: str):
    if not addr:
        return "", ""
    if "구)" not in addr:
        return addr.strip(), ""
    idx = addr.index("구)")
    main = addr[:idx].rstrip(" ,")
    old = addr[idx:].strip()
    return main, old


def clean_land_zoning_text(txt: str) -> str:
    if not txt:
        return ""
    txt = re.sub(r"\(.*?\)", "", txt)
    txt = re.sub(r"\<.*?\>", "", txt)
    txt = re.sub(r"\s+", " ", txt)
    txt = txt.replace(" ,", ",").strip(" ,")
    return txt


def normalize_text_for_match(s: str) -> str:
    if not s:
        return ""
    s = s.replace("\u3000", " ")
    s = re.sub(r"\s+", "", s)
    s = re.sub(r"[^\w가-힣]", "", s)
    return s


def normalize_myauction_detail_url(raw_url: str, myauction_id: str) -> str:
    """마이옥션 사건 URL을 자동화 상세 주소(view3/{case}/{id})로 정규화한다."""
    url = (raw_url or "").strip()
    user_id = (myauction_id or "").strip().strip("/")
    if not url:
        return url
    if url.startswith("//"):
        url = "https:" + url
    if not url.startswith("http://") and not url.startswith("https://"):
        url = "https://" + url

    parsed = urlsplit(url)
    path = parsed.path or "/"
    path = re.sub(r"/+", "/", path)
    if "/view/" in path and "/view3/" not in path:
        path = path.replace("/view/", "/view3/", 1)

    marker = "/view3/"
    if marker in path:
        prefix, tail = path.split(marker, 1)
        parts = [part for part in tail.strip("/").split("/") if part]
        if len(parts) == 1 and parts[0].isdigit() and user_id:
            parts.append(user_id)
        path = f"{prefix}{marker}{'/'.join(parts)}"

    return urlunsplit((parsed.scheme, parsed.netloc, path, parsed.query, parsed.fragment))


# ============================================================
# 파일 관리
# ============================================================
GENERATED_FILES: list[str] = []


def track_file(path: str):
    if path and os.path.exists(path):
        GENERATED_FILES.append(path)


def safe_remove(path: str):
    try:
        if path and os.path.exists(path):
            os.remove(path)
    except Exception:
        pass


def cleanup_generated_files():
    uniq = list(dict.fromkeys(GENERATED_FILES))
    for p in sorted(uniq, key=lambda x: len(x), reverse=True):
        safe_remove(p)
    GENERATED_FILES.clear()


def ensure_dir_for_file(path: str):
    d = os.path.dirname(path)
    if d:
        os.makedirs(d, exist_ok=True)


# ============================================================
# 토지/건축물 판별
# ============================================================
LAND_TYPES = {
    "대지", "임야", "전", "답", "과수원", "잡종지", "공장용지", "도로",
    "목장용지", "창고용지", "유지", "하천", "구거", "기타토지",
    "주차장", "묘지", "염전", "양어장"
}


def determine_mode(item_type: str, building_area_m2: str) -> Tuple[bool, bool]:
    """(LAND_MODE, BUILDING_MODE) 반환"""
    obj_type = (item_type or "").strip()
    building_area_val = 0.0
    try:
        m = re.search(r"([0-9]+(?:\.[0-9]+)?)", (building_area_m2 or "").replace(",", ""))
        building_area_val = float(m.group(1)) if m else 0.0
    except Exception:
        building_area_val = 0.0

    is_land_type = obj_type in LAND_TYPES
    is_building_by_area = building_area_val > 0
    land_mode = (not is_building_by_area) and is_land_type
    building_mode = not land_mode
    return land_mode, building_mode
