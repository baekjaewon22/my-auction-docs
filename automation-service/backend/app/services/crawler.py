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
        "item_category": "",
        "land_area_m2": "", "land_area_py": "",
        "building_area_m2": "", "building_area_py": "", "xx평형": "",
        "building_structure": "", "building_scale": "",
        "auction_date": "", "appraised_price": "", "min_price": "",
        "min_rate": "", "deposit": "", "claim_amount": "", "auction_type": "",
        "photo_url": "", "landplan_url": "",
        "property_overview": "", "물건개요": "", "입찰기일": "",
    }

    # 법원/사건번호
    # 전역 첫 h2에는 숨김/관련사건 제목이 먼저 올 수 있다. 현재 사건의
    # 상세 헤더만 사용하여 법원·지원과 사건번호가 섞이지 않게 한다.
    h2 = (
        soup.select_one("#header_detailz h2")
        or soup.select_one("#header_detail2 h2")
        or soup.select_one("#header_detail h2")
    )
    if h2:
        span_case = h2.find("span", class_="blue")
        if span_case:
            data["case_number"] = span_case.get_text(strip=True)
        full_text = h2.get_text(" ", strip=True)
        category_match = re.search(r"\[([^\]]+)\]", full_text)
        if category_match:
            data["item_category"] = category_match.group(1).strip()
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
            ("auction_type", "경매종류", lambda td: td.get_text(" ", strip=True)),
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

    # 입찰/매각기일, 최저가, 보증금은 같은 진행 회차 행에서 우선 확정한다.
    # 서로 다른 위치에서 날짜와 금액을 섞으면 배당요구종기일이나 과거 회차가
    # 표지/입찰 준비 페이지에 들어갈 수 있다.
    current_round = _extract_current_auction_round(soup)
    if current_round:
        data["auction_round"] = current_round
        if current_round.get("date"):
            data["auction_date"] = current_round["date"]
        if current_round.get("min_price"):
            data["min_price"] = current_round["min_price"]
        if current_round.get("min_rate"):
            data["min_rate"] = current_round["min_rate"]
        if current_round.get("deposit"):
            data["deposit"] = current_round["deposit"]

    header_round = _extract_header_round_summary(soup)
    if header_round:
        data["auction_round_header"] = header_round
        # The visible sale_txt header is a good fallback for the current bid
        # date, but its surrounding block can contain summary/polluted amounts.
        # Never let it overwrite the same-round price/deposit already parsed
        # from the 진행 회차 row; otherwise page 3 {min_price} and planner
        # tables drift from the actual current auction row.
        if header_round.get("date") and not current_round.get("date"):
            data["auction_date"] = header_round["date"]
        if header_round.get("min_price") and not current_round.get("min_price"):
            data["min_price"] = header_round["min_price"]
        if header_round.get("min_rate") and not current_round.get("min_rate"):
            data["min_rate"] = header_round["min_rate"]
        if header_round.get("deposit") and not current_round.get("deposit"):
            data["deposit"] = header_round["deposit"]

    # 입찰/매각기일
    if not data["auction_date"]:
        data["auction_date"] = _extract_auction_date(soup, basic_table)

    # 마이옥션 상세정보 표(#dtl_table)의 현재 물건 요약 셀은 최종 표지/입찰가
    # 계산에 쓰이는 authoritative source다. 범용 회차 파서는 과거 회차나
    # 헤더 요약의 다른 금액·날짜를 섞을 수 있으므로, 이 표에서 명시적으로
    # 확인되는 최저가/입찰기일은 마지막에 한 번 더 우선 적용한다.
    detail_round = _extract_detail_table_authoritative_round(soup)
    if detail_round:
        data["auction_round_detail"] = detail_round
        if detail_round.get("date"):
            data["auction_date"] = detail_round["date"]
        if detail_round.get("min_price"):
            data["min_price"] = detail_round["min_price"]
        if detail_round.get("min_rate"):
            data["min_rate"] = detail_round["min_rate"]
        if detail_round.get("deposit"):
            data["deposit"] = detail_round["deposit"]

    # Some MyAuction detail cells are populated/updated by client-side scripts
    # after the initial HTML is loaded.  In those cases Selenium can see the
    # correct live DOM text while driver.page_source/BeautifulSoup can still
    # contain stale round values.  Re-read the exact cells from the live DOM
    # at the very end and let them win.
    live_detail_round = _extract_detail_table_authoritative_round_from_driver(driver)
    if live_detail_round:
        data["auction_round_detail_live"] = live_detail_round
        if live_detail_round.get("date"):
            data["auction_date"] = live_detail_round["date"]
        if live_detail_round.get("min_price"):
            data["min_price"] = live_detail_round["min_price"]
        if live_detail_round.get("min_rate"):
            data["min_rate"] = live_detail_round["min_rate"]
        if live_detail_round.get("deposit"):
            data["deposit"] = live_detail_round["deposit"]

    _normalize_min_price_against_appraisal(data)
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
        "#dtl_title > div:nth-child(3) > ul > li > span.sale_txt > span",
        "#dtl_title .sale_txt span",
        "#dtl_title .sale_txt",
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


def _extract_header_round_summary(soup: BeautifulSoup) -> dict:
    """Extract current round summary from the detail header sale text area.

    MyAuction's visible current-round header is useful as a fallback when the
    same-round schedule row is missing. Parsed schedule-row prices remain the
    canonical source when available.
    """
    selectors = [
        "#dtl_title > div:nth-child(3)",
        "#dtl_title .sale_txt",
        "#header_detailz .sale_txt",
        "#header_detail2 .sale_txt",
        "#header_detail .sale_txt",
    ]
    seen: set[int] = set()
    for selector in selectors:
        for el in soup.select(selector):
            marker = id(el)
            if marker in seen:
                continue
            seen.add(marker)
            contexts = [_clean_inline_text(el.get_text(" ", strip=True))]
            for parent in (el.find_parent("li"), el.find_parent("ul"), el.find_parent("div")):
                if parent is not None:
                    text = _clean_inline_text(parent.get_text(" ", strip=True))
                    if text and text not in contexts:
                        contexts.append(text)
            for text in contexts:
                date_text = _extract_labeled_auction_date_text(text) or _first_date_text(text)
                minimum = _amount_after_label(text, ("최저가", "최저매각가", "최저입찰가", "최저매각가격"))
                deposit = _amount_after_label(text, ("입찰보증금", "매수신청보증금", "보증금"))
                if not date_text and minimum <= 0:
                    continue
                result: dict[str, str] = {}
                if date_text:
                    result["date"] = date_text
                if minimum > 0:
                    result["min_price"] = _format_won(minimum)
                    rate = _extract_min_rate(text)
                    if rate:
                        result["min_rate"] = rate
                if deposit > 0:
                    result["deposit"] = _format_won(deposit)
                return result
    return {}


def _extract_detail_table_authoritative_round(soup: BeautifulSoup) -> dict:
    """Extract current detail values from MyAuction's #dtl_table summary.

    This table is not always shaped like the history/round table, but in the
    live detail page it contains the currently selected item's minimum price
    and sale date in fixed cells such as:

    - #dtl_table > table > tbody > tr:nth-child(2) > td.tdl_right > strong
    - #dtl_table > table > tbody > tr:nth-child(19) > td:nth-child(3)

    Treat these values as stronger than broad text search results, while still
    keeping broad fallbacks for fixture variants and small markup shifts.
    """
    root = soup.select_one("#dtl_table")
    if root is None:
        return {}

    result: dict[str, str] = {}

    min_el = root.select_one("table > tbody > tr:nth-child(2) > td.tdl_right > strong")
    min_amount = _first_amount_from_element(min_el)
    if min_amount <= 0:
        min_amount = _detail_table_amount_by_label(root, ("최저가", "최저매각가", "최저입찰가", "최저매각가격"))
    if min_amount > 0:
        result["min_price"] = _format_won(min_amount)
        min_text = _clean_inline_text(min_el.get_text(" ", strip=True) if min_el else "")
        row_text = _clean_inline_text(min_el.find_parent("tr").get_text(" ", strip=True)) if min_el and min_el.find_parent("tr") else min_text
        rate = _extract_min_rate(" ".join([min_text, row_text]))
        if rate:
            result["min_rate"] = rate

    # Do not rely on a fixed row number first.  MyAuction's #dtl_table row
    # layout differs by page/item; on some cases row 19 is a previous schedule
    # row while the current bid date is shown in the sale_txt header or in a
    # labelled "매각기일/입찰기일" row.  Fixed cells are therefore only a final
    # fallback for legacy fixtures where no label is present.
    date_text = _detail_table_date_by_label(root, ("입찰기일", "매각기일", "입찰일시", "매각일시", "입찰일", "매각일"))
    if not date_text:
        date_el = root.select_one("table > tbody > tr:nth-child(19) > td:nth-child(3)")
        date_text = _date_from_element(date_el)
    if date_text:
        result["date"] = date_text

    deposit_amount = _detail_table_amount_by_label(root, ("입찰보증금", "매수신청보증금", "보증금"))
    if deposit_amount > 0:
        result["deposit"] = _format_won(deposit_amount)

    return result


def _extract_detail_table_authoritative_round_from_driver(driver) -> dict:
    if driver is None:
        return {}

    def text_for(selector: str) -> str:
        try:
            return str(
                driver.execute_script(
                    "const el = document.querySelector(arguments[0]);"
                    "return el ? (el.innerText || el.textContent || '') : '';",
                    selector,
                )
                or ""
            ).strip()
        except Exception:
            return ""

    def html_for(selector: str) -> str:
        try:
            return str(
                driver.execute_script(
                    "const el = document.querySelector(arguments[0]);"
                    "return el ? (el.outerHTML || '') : '';",
                    selector,
                )
                or ""
            ).strip()
        except Exception:
            return ""

    result: dict[str, str] = {}

    min_text = text_for("#dtl_table > table > tbody > tr:nth-child(2) > td.tdl_right > strong")
    min_amounts = _extract_won_amounts(_clean_inline_text(min_text))
    if min_amounts:
        result["min_price"] = _format_won(max(min_amounts))
        rate = _extract_min_rate(min_text)
        if rate:
            result["min_rate"] = rate

    date_text = ""
    for selector in (
        "#dtl_title > div:nth-child(3) > ul > li > span.sale_txt > span",
        "#dtl_title .sale_txt span",
        "#dtl_title .sale_txt",
        "#header_detailz .sale_txt span",
        "#header_detailz .sale_txt",
        "#header_detail2 .sale_txt span",
        "#header_detail2 .sale_txt",
        "#header_detail .sale_txt span",
        "#header_detail .sale_txt",
    ):
        date_text = _date_from_text(text_for(selector))
        if date_text:
            break
    if not date_text:
        detail_html = html_for("#dtl_table")
        if detail_html:
            detail_soup = BeautifulSoup(detail_html, "html.parser")
            root = detail_soup.select_one("#dtl_table") or detail_soup
            date_text = _detail_table_date_by_label(root, ("입찰기일", "매각기일", "입찰일시", "매각일시", "입찰일", "매각일"))
    if not date_text:
        date_text = _date_from_text(text_for("#dtl_table > table > tbody > tr:nth-child(19) > td:nth-child(3)"))
    if date_text:
        result["date"] = date_text

    deposit_text = text_for("#dtl_table > table > tbody > tr:nth-child(3) > td.tdl_right")
    deposit_amounts = _extract_won_amounts(_clean_inline_text(deposit_text))
    if deposit_amounts:
        result["deposit"] = _format_won(max(deposit_amounts))

    return result


def _first_amount_from_element(el) -> int:
    if el is None:
        return 0
    amounts = _extract_won_amounts(_clean_inline_text(el.get_text(" ", strip=True)))
    return max(amounts) if amounts else 0


def _date_from_element(el) -> str:
    if el is None:
        return ""
    return _date_from_text(el.get_text(" ", strip=True))


def _date_from_text(text: str) -> str:
    text = _clean_inline_text(text)
    return _extract_labeled_auction_date_text(text) or _first_date_text(text)


def _detail_table_amount_by_label(root, labels: tuple[str, ...]) -> int:
    for row in root.find_all("tr"):
        cells = row.find_all(["th", "td"], recursive=False)
        if not cells:
            continue
        cell_texts = [_clean_inline_text(cell.get_text(" ", strip=True)) for cell in cells]
        compact = re.sub(r"\s+", "", " ".join(cell_texts))
        if "배당요구" in compact:
            continue
        for idx, text in enumerate(cell_texts):
            if not any(label in text for label in labels):
                continue
            candidates = []
            candidates.extend(cell_texts[idx + 1:idx + 4])
            candidates.append(text)
            for candidate in candidates:
                amounts = _extract_won_amounts(candidate)
                if amounts:
                    return max(amounts)
    return 0


def _detail_table_date_by_label(root, labels: tuple[str, ...]) -> str:
    for row in root.find_all("tr"):
        cells = row.find_all(["th", "td"], recursive=False)
        if not cells:
            continue
        cell_texts = [_clean_inline_text(cell.get_text(" ", strip=True)) for cell in cells]
        compact = re.sub(r"\s+", "", " ".join(cell_texts))
        if "배당요구" in compact or "매각결정기일" in compact:
            continue
        for idx, text in enumerate(cell_texts):
            if not any(label in text for label in labels):
                continue
            candidates = []
            candidates.extend(cell_texts[idx + 1:idx + 4])
            candidates.append(text)
            for candidate in candidates:
                date_text = _extract_labeled_auction_date_text(candidate) or _first_date_text(candidate)
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
    return any(label in compact for label in ("입찰기일", "매각기일", "입찰일시", "매각일시", "입찰일", "매각일"))


def _extract_labeled_auction_date_text(text: str) -> str:
    text = _clean_inline_text(text)
    if not text:
        return ""
    if _has_auction_date_label(text):
        text = re.sub(r"^.*?(?:입찰기일|매각기일|입찰일시|매각일시|입찰일|매각일)\s*[:：]?\s*", "", text)
        text = re.split(r"(?:배당요구종기일?|배당요구기일|종기일)\s*[:：]?", text, maxsplit=1)[0]
    patterns = [
        r"\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}(?:\s*\([^)]*\))?(?:\s*\d{1,2}:\d{2})?",
        r"\d{4}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일(?:\s*\([^)]*\))?(?:\s*\d{1,2}:\d{2})?",
    ]
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            return _clean_inline_text(match.group(0))
    return ""


def _extract_current_auction_round(soup: BeautifulSoup) -> dict:
    """Extract bid date, minimum price and bid deposit from one active round row."""
    candidates: list[dict] = []
    for table in soup.find_all("table"):
        table_text = _clean_inline_text(table.get_text(" ", strip=True))
        if not _looks_like_auction_round_table(table_text):
            continue
        table_compact = re.sub(r"\s+", "", table_text)
        table_has_round_label = any(label in table_compact for label in ("매각기일", "입찰기일", "입찰일", "매각일"))
        for row_index, row in enumerate(table.find_all("tr")):
            cells = [
                _clean_inline_text(cell.get_text(" ", strip=True))
                for cell in row.find_all(["th", "td"], recursive=False)
            ]
            cells = [cell for cell in cells if cell]
            if not cells:
                continue
            row_text = _clean_inline_text(" ".join(cells))
            compact = re.sub(r"\s+", "", row_text)
            if "배당요구" in compact or "배당기일" in compact or "매각결정기일" in compact:
                continue
            if not table_has_round_label and not any(label in compact for label in ("매각기일", "입찰기일", "입찰일", "매각일")):
                continue
            date_text = _extract_labeled_auction_date_text(row_text) or _first_date_text(row_text)
            if not date_text:
                continue
            if not _is_current_auction_round_row(compact):
                continue
            amounts = _extract_won_amounts(row_text)
            min_amount = _amount_near_round_label(cells, ("최저가", "최저매각가", "최저입찰가", "최저매각가격"))
            deposit_amount = _amount_near_round_label(cells, ("입찰보증금", "매수신청보증금", "보증금"))
            if min_amount <= 0 and amounts:
                # In schedule rows the minimum price is normally the largest won
                # amount; deposit is 10%/20% and must not replace it.
                min_amount = max(amounts)
            if deposit_amount <= 0 and min_amount > 0:
                for amount in sorted(set(amounts)):
                    if amount == min_amount:
                        continue
                    ratio = amount / min_amount
                    if 0.08 <= ratio <= 0.22:
                        deposit_amount = amount
                        break
            if deposit_amount <= 0 and min_amount > 0:
                deposit_amount = int(round(min_amount * 0.1))
            min_rate = _extract_min_rate(row_text)
            candidates.append({
                "date": date_text,
                "min_price": _format_won(min_amount),
                "min_rate": min_rate,
                "deposit": _format_won(deposit_amount),
                "rowText": row_text,
                "_score": _round_row_score(compact, row_index),
            })
    if not candidates:
        return {}
    candidates.sort(key=lambda item: (item["_score"], _date_sort_key(item["date"])))
    selected = dict(candidates[0])
    selected.pop("_score", None)
    return selected


def _looks_like_auction_round_table(text: str) -> bool:
    compact = re.sub(r"\s+", "", text or "")
    if "배당요구종기" in compact and not any(label in compact for label in ("매각기일", "입찰기일")):
        return False
    return (
        any(label in compact for label in ("기일내역", "매각기일", "입찰기일", "입찰일", "매각일"))
        and any(label in compact for label in ("최저", "보증금", "저가", "결과", "진행"))
    )


def _is_current_auction_round_row(compact_row_text: str) -> bool:
    if "진행" in compact_row_text:
        return True
    status_area = re.sub(r"(매각기일|입찰기일|입찰일|매각일|최저매각가격|최저매각가|최저입찰가|최저가|매수신청보증금|입찰보증금|보증금)", "", compact_row_text)
    closed_tokens = (
        "유찰", "변경", "연기", "낙찰", "불허가", "허가", "취소", "취하",
        "정지", "종결", "기각", "대금지급", "절차종료", "매각불허",
    )
    return not any(token in status_area for token in closed_tokens)


def _round_row_score(compact_row_text: str, row_index: int) -> tuple[int, int]:
    if "진행" in compact_row_text:
        return (0, row_index)
    return (1, row_index)


def _amount_near_round_label(cells: list[str], labels: tuple[str, ...]) -> int:
    for idx, cell in enumerate(cells):
        if not any(label in cell for label in labels):
            continue
        for candidate in (cell, *(cells[idx + 1:idx + 3])):
            amounts = _extract_won_amounts(candidate)
            if amounts:
                return max(amounts)
    return 0


def _amount_after_label(text: str, labels: tuple[str, ...]) -> int:
    source = _clean_inline_text(text)
    if not source:
        return 0
    for label in labels:
        pattern = rf"{re.escape(label)}\s*[:：]?\s*([0-9][0-9,]*(?:\.\d+)?)\s*(억|만원|만|원)?"
        match = re.search(pattern, source)
        if not match:
            continue
        try:
            number = float(match.group(1).replace(",", ""))
        except ValueError:
            continue
        unit = match.group(2) or "원"
        if unit == "억":
            return int(round(number * 100_000_000))
        if unit in {"만원", "만"}:
            return int(round(number * 10_000))
        return int(round(number))
    return 0


def _extract_won_amounts(text: str) -> list[int]:
    normalized = str(text or "").replace("\xa0", " ")
    amounts: list[int] = []
    for match in re.finditer(r"(\d{1,3}(?:,\d{3})+|\d{5,})\s*(?:원)?", normalized):
        raw = match.group(1)
        # Avoid treating compact dates such as 20260908 as money.
        prefix = normalized[max(0, match.start() - 12):match.start()]
        suffix = normalized[match.end():match.end() + 12]
        if re.search(r"(년|[.\-/])\s*$", prefix) or re.match(r"\s*(월|일|[.\-/])", suffix):
            continue
        try:
            amount = int(raw.replace(",", ""))
        except ValueError:
            continue
        if amount >= 10_000:
            amounts.append(amount)
    return amounts


def _extract_min_rate(text: str) -> str:
    match = re.search(r"(\d{1,3})\s*%", text or "")
    return f"{int(match.group(1))}%" if match else ""


def _format_won(amount: int) -> str:
    return f"{int(amount):,}원" if amount and amount > 0 else ""


def _normalize_min_price_against_appraisal(data: dict) -> None:
    appraised = _won_text_to_int(data.get("appraised_price") or "")
    minimum = _won_text_to_int(data.get("min_price") or "")
    if appraised <= 0 or minimum <= 0 or minimum <= appraised:
        return
    logger.warning(
        "최저가가 감정가보다 크게 추출되어 감정가로 보정합니다: appraised=%s min=%s",
        data.get("appraised_price"),
        data.get("min_price"),
    )
    data["min_price"] = _format_won(appraised)
    data["min_rate"] = "100%"
    deposit = _won_text_to_int(data.get("deposit") or "")
    if deposit > appraised:
        data["deposit"] = _format_won(int(round(appraised * 0.1)))


def _won_text_to_int(value: str) -> int:
    raw = extract_number_before_won(value or "")
    try:
        return int(str(raw).replace(",", ""))
    except Exception:
        return 0


def _first_date_text(text: str) -> str:
    match = re.search(r"\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}(?:\s*\([^)]*\))?(?:\s*\d{1,2}:\d{2})?", text or "")
    return _clean_inline_text(match.group(0)) if match else ""


def _date_sort_key(date_text: str) -> tuple[int, int, int]:
    nums = re.findall(r"\d+", date_text or "")
    if len(nums) < 3:
        return (9999, 99, 99)
    return (int(nums[0]), int(nums[1]), int(nums[2]))


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
    if not data.get("auction_type"):
        data["auction_type"] = _find_labeled_value(soup, ("경매종류", "사건종류"))
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
