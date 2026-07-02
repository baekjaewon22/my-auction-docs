# -*- coding: utf-8 -*-
"""
마이옥션 크롤링 서비스
- Selenium + BeautifulSoup 기반 사이트 정보 파싱
- final.py의 parse_myauction_detail, fetch_land_zoning_from_plan 등 통합
"""

import re
import logging
import requests
from typing import Optional
from urllib.parse import urljoin, urlparse, parse_qs
from bs4 import BeautifulSoup

from ..core.utils import (
    extract_number_before_won, extract_area_pair,
    split_address_old, clean_land_zoning_text, determine_mode,
)

logger = logging.getLogger(__name__)


# ============================================================
# HTML 파싱 유틸
# ============================================================
def fetch_soup(url: str) -> BeautifulSoup:
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        )
    }
    resp = requests.get(url, headers=headers, timeout=20)
    resp.raise_for_status()
    resp.encoding = "utf-8"
    return BeautifulSoup(resp.text, "html.parser")


def fetch_soup_from_driver(driver) -> BeautifulSoup:
    html = driver.page_source or ""
    return BeautifulSoup(html, "html.parser")


# ============================================================
# 감정평가현황 블록
# ============================================================
def find_appraisal_block(soup: BeautifulSoup):
    h3 = soup.find("h3", string=lambda s: s and "감정평가현황" in s)
    if not h3:
        return None
    parent = h3
    while parent and parent.name != "body":
        if parent.get("id") == "dtl_stock":
            return parent
        parent = parent.parent
    return None


def extract_appraisal_status_text(soup: BeautifulSoup) -> str:
    h3 = soup.find("h3", string=lambda s: s and "감정평가현황" in s)
    if not h3:
        return ""

    title_node = h3.find_parent() or h3
    node = title_node.find_next_sibling()
    parts: list[str] = []

    for _ in range(8):
        if node is None:
            break
        if getattr(node, "name", None):
            next_h3 = node.find("h3")
            if next_h3 and "감정평가현황" not in next_h3.get_text(" ", strip=True):
                break
        text = _appraisal_node_text(node)
        if text:
            parts.append(text)
        node = node.find_next_sibling()

    if parts:
        return "\n".join(parts)

    block = find_appraisal_block(soup)
    return block.get_text("\n", strip=True) if block else ""


def _appraisal_node_text(node) -> str:
    table = node.find("table") if hasattr(node, "find") else None
    target = table or node
    rows = []
    if hasattr(target, "find_all"):
        for tr in target.find_all("tr"):
            cells = [
                cell.get_text(" ", strip=True)
                for cell in tr.find_all(["th", "td"], recursive=False)
            ]
            cells = [re.sub(r"\s+", " ", c).strip() for c in cells if c and c.strip()]
            if len(cells) >= 2:
                label, value = cells[0], " ".join(cells[1:])
                if label in {"구분", "내용", "비고"} and value in {"구분", "내용", "비고"}:
                    continue
                rows.append(f"{label} {value}")
            elif len(cells) == 1 and cells[0] not in {"구분", "내용", "비고"}:
                rows.append(cells[0])
    if rows:
        return "\n".join(dict.fromkeys(rows))

    text = target.get_text("\n", strip=True) if hasattr(target, "get_text") else ""
    lines = [re.sub(r"\s+", " ", line).strip() for line in text.splitlines()]
    lines = [line for line in lines if line and line not in {"구분", "내용", "비고"}]
    return "\n".join(dict.fromkeys(lines))


# ============================================================
# 건축물현황 테이블
# ============================================================
def find_building_status_table(soup: BeautifulSoup):
    def _is_building_status_h3(tag):
        if not tag or tag.name != "h3":
            return False
        txt = tag.get_text(" ", strip=True).replace(" ", "")
        return "건축물현황" in txt

    h3 = soup.find(_is_building_status_h3)
    if h3:
        dtl_title = h3.find_parent()
        if dtl_title:
            dtl_table = dtl_title.find_next_sibling()
            if dtl_table:
                tbl = dtl_table.find("table", class_="tbl_detail")
                if tbl:
                    return tbl
        tbl = h3.find_next("table", class_="tbl_detail")
        if tbl:
            return tbl

    dtl_stock = soup.find(id="dtl_stock")
    if dtl_stock:
        tbl = dtl_stock.find("table", class_="tbl_detail")
        if tbl:
            return tbl

    tables = soup.find_all("table", class_="tbl_detail")
    if len(tables) == 1:
        return tables[0]
    return None


# ============================================================
# 구조/규모/지붕 파싱
# ============================================================
def parse_structure_scale_roof(soup: BeautifulSoup, appraisal_text: str):
    def _clean_text(s: str) -> str:
        return (s or "").replace("\xa0", " ").strip()

    def _norm_key(k: str) -> str:
        k = (k or "").replace("\xa0", "").strip()
        k = re.sub(r"\s+", "", k)
        k = re.sub(r"[()（）\[\]【】{}<>]", "", k)
        return k

    def norm_floor(v: str) -> str:
        v = (v or "").replace("\xa0", "").strip()
        if not v or v in ("공란", "-", "없음", "미기재"):
            return ""
        v = v.replace(" ", "")
        v = re.sub(r"^(지상|지하)", "", v)
        v = re.sub(r"층$", "", v)
        m = re.fullmatch(r"\d+", v)
        return f"{m.group(0)}층" if m else ""

    def _floor_to_str(v: str) -> str:
        v = (v or "").strip()
        if not v:
            return ""
        m = re.search(r"(\d+)", v)
        return f"{m.group(1)}층" if m else v

    def _extract_roof(text: str) -> str:
        text = text or ""
        m = re.search(r"([가-힣A-Za-z]+지붕(?:\([^)]+\))?)", text)
        return m.group(1).replace(" ", "").strip() if m else ""

    def _extract_structure_scale_from_text(text: str):
        text = text or ""
        structure = ""
        m_s = re.search(r"([가-힣A-Za-z]+구조)", text)
        if m_s:
            structure = m_s.group(1).replace(" ", "").strip()
        below, above = "", ""
        m_b = re.search(r"지하\s*(\d+)\s*층?", text)
        m_a = re.search(r"지상\s*(\d+)\s*층?", text)
        if m_b:
            below = f"{m_b.group(1)}층"
        if m_a:
            above = f"{m_a.group(1)}층"
        scale = ""
        if above and not below:
            scale = f"지상{_floor_to_str(above)}"
        elif below and not above:
            scale = f"지하{_floor_to_str(below)}"
        else:
            parts = []
            if below:
                parts.append(f"지하{_floor_to_str(below)}")
            if above:
                parts.append(f"지상{_floor_to_str(above)}")
            scale = ", ".join(parts)
        return structure, scale

    def _split_building_blocks_from_appraisal(text: str) -> list:
        text = text or ""
        idx = text.find("[건물]")
        t = text[idx:] if idx != -1 else text
        parts = re.split(r"(?=(?:기호)\s*\d+\s*:)", t)
        blocks = [p.strip() for p in parts if p.strip() and p.strip() != "[건물]"]
        if not blocks:
            t = t.strip()
            return [t] if t else []
        return blocks

    # 1) 건축물현황 테이블 파싱
    tbl = find_building_status_table(soup)
    kv = {}
    if tbl:
        for tr in tbl.find_all("tr"):
            cells = tr.find_all(["th", "td"], recursive=False)
            i = 0
            while i < len(cells) - 1:
                if cells[i].name == "th" and cells[i + 1].name == "td":
                    k = _norm_key(cells[i].get_text(strip=True))
                    v = _clean_text(cells[i + 1].get_text(" ", strip=True))
                    if k:
                        kv[k] = v
                    i += 2
                else:
                    i += 1

    # 2) 대표 구조/규모
    structure = (kv.get("구조") or "").strip()

    def _kv_get_floor_value(target: str) -> str:
        for k, v in kv.items():
            kk = _norm_key(k)
            if kk == target or kk.startswith(target) or target in kk:
                vv = (v or "").replace("\xa0", "").strip()
                if vv and vv not in ("공란", "-", "없음", "미기재"):
                    return vv
        return ""

    above = norm_floor(_kv_get_floor_value("지상층수") or _kv_get_floor_value("지상층") or kv.get("지상층수"))
    below = norm_floor(_kv_get_floor_value("지하층수") or _kv_get_floor_value("지하층") or kv.get("지하층수"))

    scale = ""
    if above and not below:
        scale = f"지상{_floor_to_str(above)}"
    elif below and not above:
        scale = f"지하{_floor_to_str(below)}"
    else:
        parts = []
        if below:
            parts.append(f"지하{_floor_to_str(below)}")
        if above:
            parts.append(f"지상{_floor_to_str(above)}")
        scale = ", ".join(parts)

    # 3) 부속 건축물
    annex_summaries = []
    MAX_ANNEX_SHOW = 3

    if not tbl:
        blocks = _split_building_blocks_from_appraisal(appraisal_text)
        if blocks:
            rep_structure, rep_scale = _extract_structure_scale_from_text(blocks[0])
            if not structure:
                structure = rep_structure
            if not scale:
                scale = rep_scale
            for b in blocks[1:]:
                s2, sc2 = _extract_structure_scale_from_text(b)
                r2 = _extract_roof(b)
                piece = ""
                if s2 and r2:
                    piece = f"{s2}, {r2}" if r2 not in s2 else s2
                elif s2:
                    piece = s2
                elif r2:
                    piece = r2
                if piece and sc2:
                    piece = f"{piece} / {sc2}"
                elif (not piece) and sc2:
                    piece = sc2
                if piece:
                    annex_summaries.append(piece)

    # 4) 지붕
    roof = _extract_roof(appraisal_text) if appraisal_text else ""

    # 5) 최종 조립
    final_structure = structure.strip() if structure else ""
    if roof:
        if final_structure:
            if roof not in final_structure:
                final_structure = f"{final_structure}, {roof}".strip()
        else:
            final_structure = roof

    if annex_summaries:
        shown = annex_summaries[:MAX_ANNEX_SHOW]
        remain = len(annex_summaries) - len(shown)
        annex_text = "; ".join(shown)
        if remain > 0:
            annex_text = f"{annex_text} 외 {remain}동"
        final_structure = (
            f"{final_structure} (부속: {annex_text})".strip()
            if final_structure
            else f"(부속: {annex_text})"
        )

    return final_structure, scale


# ============================================================
# 사진 URL
# ============================================================
def parse_main_photo_url(soup: BeautifulSoup, base_url: str) -> str:
    img = soup.find("img", alt=lambda s: s and "물건사진" in s)
    if not img:
        img = soup.find("img", src=lambda s: s and "thumb_1.php" in s)
    if not img or not img.get("src"):
        return ""
    thumb_src = img["src"]
    full_thumb = urljoin(base_url, thumb_src)
    if "thumb_1.php" in full_thumb:
        parsed = urlparse(full_thumb)
        qs = parse_qs(parsed.query)
        q_string = qs.get("q_string", [""])[0]
        if q_string:
            return urljoin("https://photo.nuriauction.com", q_string)
    return full_thumb


# ============================================================
# 토지이용계획 (지역지구)
# ============================================================
def fetch_land_zoning_from_plan(driver, *args) -> str:
    if len(args) == 1:
        landplan_url = args[0]
    elif len(args) == 2:
        landplan_url = args[1]
    else:
        return ""

    landplan_url = (landplan_url or "").strip()
    if not landplan_url:
        return ""

    s = requests.Session()
    try:
        for c in driver.get_cookies():
            name, value = c.get("name"), c.get("value")
            domain = c.get("domain")
            if name and value is not None and domain:
                s.cookies.set(name, value, domain=domain, path=c.get("path", "/"))
    except Exception:
        pass

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": landplan_url,
    }

    try:
        r = s.get(landplan_url, headers=headers, timeout=20, allow_redirects=True)
        r.raise_for_status()
        html = r.text or ""
    except Exception:
        return ""

    soup = BeautifulSoup(html, "html.parser")

    def _clean_label(txt: str) -> str:
        if not txt:
            return ""
        t = txt.replace("\xa0", " ").strip()
        bad = {"연도별보기", "변경", "도면크게보기", "보기", "닫기", "자세히", "새창으로", "새창으로열기"}
        for b in list(bad):
            t = t.replace(b, " ")
        t = re.sub(r"\([^)]*\)", "", t)
        t = re.sub(r"\<[^>]*\>", "", t)
        t = re.sub(r"\[[^\]]*\]", "", t)
        t = re.sub(r"\{[^}]*\}", "", t)
        t = re.sub(r"\s+", " ", t).strip(" ,")
        return t.strip()

    def _is_inside_layer_pop(tag) -> bool:
        try:
            return tag.find_parent(class_="layer_pop") is not None
        except Exception:
            return False

    results, seen = [], set()
    for td_id in ("present_mark1", "present_mark2"):
        td = soup.find("td", id=td_id)
        if not td:
            continue
        for a in td.find_all("a"):
            if _is_inside_layer_pop(a):
                continue
            cls = " ".join(a.get("class", []) or [])
            if "link" not in cls:
                onclick = a.get("onclick") or ""
                if "openLandLayer" not in onclick:
                    continue
            txt = _clean_label(a.get_text(" ", strip=True) or "")
            if not txt or txt in {"보기", "닫기", "자세히", "연도별보기", "변경", "도면크게보기"}:
                continue
            if txt not in seen:
                seen.add(txt)
                results.append(txt)

    return ", ".join(results).strip()


# ============================================================
# 메인 파서
# ============================================================
def parse_myauction_detail(soup: BeautifulSoup, base_url: str, driver=None) -> dict:
    data = {
        "court": "", "case_number": "", "address": "", "address_old": "",
        "land_zoning": "", "appraisal_raw": "", "item_type": "",
        "land_area_m2": "", "land_area_py": "",
        "building_area_m2": "", "building_area_py": "", "xx평형": "",
        "building_structure": "", "building_scale": "",
        "auction_date": "", "appraised_price": "", "min_price": "",
        "min_rate": "", "deposit": "", "claim_amount": "",
        "photo_url": "", "landplan_url": "",
        "property_overview": "", "물건개요": "", "입찰기일": "",
    }

    # 법원/사건번호
    h2 = soup.find("h2")
    if h2:
        span_case = h2.find("span", class_="blue")
        if span_case:
            data["case_number"] = span_case.get_text(strip=True)
        full_text = h2.get_text(" ", strip=True)
        if data["case_number"]:
            full_text = full_text.replace(data["case_number"], "")
        full_text = re.sub(r"\[.*?\]", "", full_text)
        data["court"] = full_text.strip()

    # 소재지
    dtl_stock = soup.find("div", id="detail_left") or soup
    tables = dtl_stock.find_all("table", class_="tbl_detail")

    if tables:
        th = tables[0].find("th", string=lambda s: s and "소재지" in s)
        if th:
            td = th.find_next("td")
            if td:
                raw_addr = td.get_text(" ", strip=True)
                main_addr, old_addr = split_address_old(raw_addr)
                data["address"] = main_addr
                data["address_old"] = old_addr

    # 기본 정보 테이블
    basic_table = None
    for tbl in tables:
        th = tbl.find("th", string=lambda s: s and "경매종류" in s)
        if th:
            basic_table = tbl
            break

    if basic_table:
        for field, th_text, extractor in [
            ("item_type", "물건종류", lambda td: td.get_text(" ", strip=True)),
            ("appraised_price", "감정가", lambda td: extract_number_before_won(td.get_text(" ", strip=True)) + "원"),
            ("deposit", "입찰보증금", lambda td: extract_number_before_won(td.get_text(" ", strip=True)) + "원"),
            ("claim_amount", "청구금액", lambda td: extract_number_before_won(td.get_text(" ", strip=True)) + "원"),
        ]:
            th = basic_table.find("th", string=lambda s, t=th_text: s and t in s)
            if th:
                td = th.find_next("td")
                if td:
                    data[field] = extractor(td)

        # 토지/건물면적
        th = basic_table.find("th", string=lambda s: s and "토지면적" in s)
        if th:
            td = th.find_next("td")
            if td:
                m2, py = extract_area_pair(td.get_text(" ", strip=True))
                data["land_area_m2"] = m2
                data["land_area_py"] = py

        th = basic_table.find("th", string=lambda s: s and "건물면적" in s)
        if th:
            td = th.find_next("td")
            if td:
                cell_text = td.get_text(" ", strip=True)
                m2, py = extract_area_pair(cell_text)
                data["building_area_m2"] = m2
                data["building_area_py"] = py
                m_type = re.search(r"\[?\s*([0-9.,]+평형)\s*\]?", cell_text)
                data["xx평형"] = f"[{m_type.group(1)}]" if m_type else ""

        # 최저가
        th = basic_table.find("th", string=lambda s: s and "최저가" in s)
        if th:
            td = th.find_next("td")
            if td:
                data["min_price"] = extract_number_before_won(td.get_text(" ", strip=True)) + "원"
                span = td.find("span", class_="down_p")
                if span:
                    m = re.search(r"(\d+)\s*%", span.get_text())
                    if m:
                        data["min_rate"] = m.group(1) + "%"

    _fill_basic_info_fallbacks(soup, data)

    # 입찰/매각기일
    data["auction_date"] = _extract_auction_date(soup, basic_table)
    data["입찰기일"] = data["auction_date"]

    # 감정평가현황
    appraisal_text = extract_appraisal_status_text(soup)
    jraw_td = soup.find("td", id="jraw")
    jraw_text = ""
    if jraw_td:
        jraw_text = jraw_td.get_text(" ", strip=True)

    if appraisal_text:
        data["appraisal_raw"] = appraisal_text
        if jraw_text and jraw_text not in appraisal_text:
            data["appraisal_raw"] = f"{appraisal_text}\n{jraw_text}"
    elif jraw_text:
        data["appraisal_raw"] = jraw_text

    final_structure, scale = parse_structure_scale_roof(soup, appraisal_text)
    if final_structure:
        data["building_structure"] = final_structure
    if scale:
        data["building_scale"] = scale

    data["property_overview"] = build_property_overview(data)
    data["물건개요"] = data["property_overview"]

    # 토지이용계획 URL
    a_landplan = soup.find("a", string=lambda s: s and "토지이용계획" in s)
    if a_landplan and a_landplan.get("href"):
        href = a_landplan["href"]
        data["landplan_url"] = href if href.startswith("http") else urljoin(base_url, href)

    # 대표사진
    data["photo_url"] = parse_main_photo_url(soup, base_url)

    # MODE 판별
    land_mode, building_mode = determine_mode(data.get("item_type", ""), data.get("building_area_m2", ""))
    data["LAND_MODE"] = land_mode
    data["BUILDING_MODE"] = building_mode

    logger.info(f"MODE: {'토지' if land_mode else '건축물'} | {data.get('item_type')}")
    return data


def _extract_auction_date(soup: BeautifulSoup, basic_table=None) -> str:
    selectors = [
        "p.plan_day span.pink",
        ".plan_day .pink",
        ".plan_day",
        "#dtl_table",
    ]
    for selector in selectors:
        for el in soup.select(selector):
            text = _clean_inline_text(el.get_text(" ", strip=True))
            if not text:
                continue
            if selector == "#dtl_table" and not _has_auction_date_label(text):
                continue
            date_text = _extract_labeled_auction_date_text(text)
            if date_text:
                return date_text

    search_roots = [basic_table] if basic_table else []
    search_roots.append(soup)
    for root in search_roots:
        if root is None:
            continue
        label_cell = root.find(["th", "td", "li", "span", "p"], string=lambda s: s and _has_auction_date_label(s))
        if label_cell:
            row = label_cell.find_parent("tr")
            candidates = []
            if row:
                candidates.append(row.get_text(" ", strip=True))
                cells = row.find_all(["th", "td"], recursive=False)
                for idx, cell in enumerate(cells):
                    if cell is label_cell or _has_auction_date_label(cell.get_text(" ", strip=True)):
                        candidates.extend(c.get_text(" ", strip=True) for c in cells[idx + 1:])
            candidates.append(label_cell.find_next("td").get_text(" ", strip=True) if label_cell.find_next("td") else "")
            candidates.append(label_cell.parent.get_text(" ", strip=True) if label_cell.parent else "")
            for candidate in candidates:
                date_text = _extract_labeled_auction_date_text(candidate)
                if date_text:
                    return date_text

    for text in _candidate_texts_for_auction_date(soup):
        date_text = _extract_labeled_auction_date_text(text)
        if date_text:
            return date_text
    return ""


def _candidate_texts_for_auction_date(soup: BeautifulSoup) -> list[str]:
    candidates = []
    for table in soup.find_all("table"):
        text = _clean_inline_text(table.get_text(" ", strip=True))
        if _has_auction_date_label(text):
            candidates.append(text)
    for el in soup.find_all(["li", "p", "div", "span"]):
        text = _clean_inline_text(el.get_text(" ", strip=True))
        if text and _has_auction_date_label(text) and len(text) <= 500:
            candidates.append(text)
    return candidates


def _has_auction_date_label(text: str) -> bool:
    compact = re.sub(r"\s+", "", text or "")
    return any(label in compact for label in ("입찰기일", "매각기일", "입찰일시", "매각일시", "기일"))


def _extract_labeled_auction_date_text(text: str) -> str:
    text = _clean_inline_text(text)
    if not text:
        return ""
    if _has_auction_date_label(text):
        text = re.sub(r"^.*?(?:입찰기일|매각기일|입찰일시|매각일시|기일)\s*[:：]?\s*", "", text)
    patterns = [
        r"\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}(?:\s*\([^)]*\))?(?:\s*\d{1,2}:\d{2})?",
        r"\d{4}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일(?:\s*\([^)]*\))?(?:\s*\d{1,2}:\d{2})?",
    ]
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            return _clean_inline_text(match.group(0))
    return ""


def _clean_inline_text(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "").replace("\xa0", " ")).strip(" /,|")


def build_property_overview(data: dict) -> str:
    rows: list[str] = []
    overview_values = [
        ("물건종류", data.get("item_type")),
        ("소재지", data.get("address")),
        ("토지면적", _format_area_overview(data.get("land_area_m2"), data.get("land_area_py"))),
        ("건물면적", _format_area_overview(data.get("building_area_m2"), data.get("building_area_py"))),
        ("감정가", data.get("appraised_price")),
        ("최저가", data.get("min_price")),
        ("입찰기일", data.get("auction_date")),
    ]
    for label, raw_value in overview_values:
        value = _clean_inline_text(raw_value or "")
        if value:
            rows.append(f"{label}: {value}")
    return "\n".join(rows)


def _format_area_overview(area_m2: str, area_py: str) -> str:
    m2 = _clean_inline_text(area_m2 or "")
    py = _clean_inline_text(area_py or "")
    if m2 and "㎡" not in m2:
        m2 = f"{m2}㎡"
    if py and "평" not in py:
        py = f"{py}평"
    return " / ".join(part for part in (m2, py) if part)


def _fill_basic_info_fallbacks(soup: BeautifulSoup, data: dict) -> None:
    if not data.get("item_type"):
        data["item_type"] = _find_labeled_value(soup, ("물건종류", "용도", "종별"))
    if not data.get("appraised_price"):
        amount = extract_number_before_won(_find_labeled_value(soup, ("감정가", "감정평가액")))
        data["appraised_price"] = f"{amount}원" if amount else ""
    if not data.get("min_price"):
        amount = extract_number_before_won(_find_labeled_value(soup, ("최저가", "최저매각가", "최저입찰가")))
        data["min_price"] = f"{amount}원" if amount else ""
    if not data.get("deposit"):
        amount = extract_number_before_won(_find_labeled_value(soup, ("입찰보증금", "보증금")))
        data["deposit"] = f"{amount}원" if amount else ""
    if not data.get("claim_amount"):
        amount = extract_number_before_won(_find_labeled_value(soup, ("청구금액", "청구액")))
        data["claim_amount"] = f"{amount}원" if amount else ""
    if not data.get("land_area_m2"):
        m2, py = extract_area_pair(_find_labeled_value(soup, ("토지면적", "대지권면적", "대지면적")))
        data["land_area_m2"] = m2
        data["land_area_py"] = py
    if not data.get("building_area_m2"):
        value = _find_labeled_value(soup, ("건물면적", "전용면적", "전유면적"))
        m2, py = extract_area_pair(value)
        data["building_area_m2"] = m2
        data["building_area_py"] = py
        if not data.get("xx평형"):
            m_type = re.search(r"\[?\s*([0-9.,]+평형)\s*\]?", value)
            data["xx평형"] = f"[{m_type.group(1)}]" if m_type else ""


def _find_labeled_value(soup: BeautifulSoup, labels: tuple[str, ...]) -> str:
    for table in soup.find_all("table"):
        for row in table.find_all("tr"):
            cells = row.find_all(["th", "td"], recursive=False)
            if not cells:
                continue
            for idx, cell in enumerate(cells):
                label_text = _clean_inline_text(cell.get_text(" ", strip=True))
                if not any(label in label_text for label in labels):
                    continue
                for value_cell in cells[idx + 1:]:
                    value = _clean_inline_text(value_cell.get_text(" ", strip=True))
                    if value and not any(label in value for label in labels):
                        return value
                value = re.sub("|".join(map(re.escape, labels)), " ", label_text)
                value = _clean_inline_text(value.strip(" :：-"))
                if value:
                    return value
    for label in labels:
        node = soup.find(string=lambda s, target=label: s and target in s)
        if not node:
            continue
        parent = getattr(node, "parent", None)
        if not parent:
            continue
        row = parent.find_parent("tr")
        if row:
            text = _clean_inline_text(row.get_text(" ", strip=True))
            text = re.sub(rf"^.*?{re.escape(label)}\s*[:：]?\s*", "", text)
            if text and label not in text:
                return text
        text = _clean_inline_text(parent.get_text(" ", strip=True))
        text = re.sub(rf"^.*?{re.escape(label)}\s*[:：]?\s*", "", text)
        if text and label not in text:
            return text
    return ""
