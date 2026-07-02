# -*- coding: utf-8 -*-
"""브리핑자료 담당자 종합의견 문안 생성."""

from __future__ import annotations

import re


SECTION_PATTERNS = [
    ("location", r"위치\s*및\s*주위환경"),
    ("traffic", r"(?:교통\s*상황|교통\s*사정)"),
    ("land_use", r"(?:형태\s*및\s*)?이용\s*(?:상황|상태)"),
    ("road", r"(?:(?:인접\s*)?도로\s*(?:상태|조건|접면)|도로\s*상황|접면\s*도로)"),
    ("plan", r"토지\s*이용\s*계획\s*(?:및\s*제한\s*상태)?"),
    ("structure", r"(?:건물의\s*)?구조"),
    ("building_use", r"(?:건물의\s*)?이용\s*(?:상태|상황)"),
    ("facility", r"설비\s*(?:내역|상태|상황)"),
    ("etc", r"제시\s*외\s*물건"),
    ("note", r"감정평가액\s*산출\s*근거\s*및\s*결정\s*의견"),
]

SKIP_KEYS = {"note", "etc"}


def build_property_status_opinion(data: dict) -> str:
    """감정평가현황을 담당자 종합의견 (1) 물건현황 서술형 문안으로 변환한다."""
    raw = _clean_source(data.get("appraisal_raw") or data.get("appraisal_text") or "")
    if not raw:
        return ""

    sections = _extract_sections(raw)
    lines: list[str] = []

    location = sections.get("location", "")
    if location:
        for sentence in _location_sentences(location):
            _append_line(lines, sentence)

    for key in ("traffic", "building_use", "facility", "road", "land_use", "plan", "structure"):
        text = sections.get(key, "")
        if not text:
            continue
        _append_line(lines, _sentence_from_section(key, text))

    if not lines:
        for sentence in _fallback_sentences(raw):
            _append_line(lines, sentence)

    return _join_opinion_lines(lines[:8])


def build_rights_analysis_opinion(template_data: dict) -> str:
    """브리핑자료 전용 권리분석 문안을 구성한다."""
    sections = [
        ("1) 말소기준 및 등기부상 소멸사항", template_data.get("baseRightDescription") or ""),
        ("2) 임차권리 인수사항", _tenant_text_from_template_data(template_data)),
        ("3) 경매취하 / 무잉여 가능성", template_data.get("surplusDescription") or ""),
    ]
    lines: list[str] = []
    for title, body in sections:
        body = _clean_body_text(body)
        if not body:
            continue
        lines.append(title)
        for line in body.splitlines():
            line = _ensure_sentence(line)
            if line:
                lines.append(f"- {line}")
        lines.append("")
    return "\n".join(lines).strip()


def build_special_opinion(template_data: dict) -> str:
    """브리핑자료 전용 특이사항 문안을 구성한다."""
    special_section = _extract_special_section(template_data.get("specialSummaryText") or "")
    if special_section:
        return special_section

    notice = _clean_body_text(template_data.get("caseNoticeText") or template_data.get("주의사항") or "")
    if notice:
        return "\n".join(["1) 주의사항", f"- {_ensure_sentence(notice)}"])
    return ""


def _extract_special_section(text: str) -> str:
    lines = [re.sub(r"\s+", " ", line).strip() for line in str(text or "").splitlines()]
    result: list[str] = []
    collecting = False
    for line in lines:
        if not line:
            if collecting and result:
                result.append("")
            continue
        if re.match(r"^4\)\s*", line):
            collecting = True
            result.append(line)
            continue
        if collecting and re.match(r"^\d+\)\s*", line):
            break
        if collecting:
            if line.startswith("-"):
                line = f"- {_ensure_sentence(line.lstrip('- ').strip())}"
            result.append(line)
    while result and not result[-1]:
        result.pop()
    return "\n".join(result).strip()


def _tenant_text_from_template_data(template_data: dict) -> str:
    if template_data.get("noTenants"):
        return "조사된 임차인이 없으므로, 낙찰자에게 인수되는 임차권리는 없습니다."
    tenant_analyses = template_data.get("tenantAnalyses") or []
    descriptions = [
        str(item.get("description") or "").strip()
        for item in tenant_analyses
        if isinstance(item, dict) and str(item.get("description") or "").strip()
    ]
    if descriptions:
        return "\n".join(descriptions)
    return str(template_data.get("tenantAnalysisText") or "").strip()


def _clean_body_text(text: str) -> str:
    text = str(text or "").replace("\r", "\n")
    text = re.sub(r"\n{3,}", "\n\n", text)
    lines = [re.sub(r"\s+", " ", line).strip(" -") for line in text.splitlines()]
    return "\n".join(line for line in lines if line)


def _clean_source(text: str) -> str:
    text = str(text or "").replace("\xa0", " ").replace("\u3000", " ")
    text = re.sub(r"[\r\n\t]+", " ", text)
    text = re.sub(r"\s+", " ", text)
    marker = text.find("감정평가현황")
    if marker >= 0:
        text = text[marker + len("감정평가현황"):]
    text = re.sub(r"^\s*감정평가현황\s*", "", text)
    narrative_marker = re.search(r"(본건은|대상물건은|본\s*물건은)", text)
    if narrative_marker:
        text = text[narrative_marker.start():]
    return text.strip(" :;")


def _extract_sections(text: str) -> dict[str, str]:
    label_re = "|".join(f"(?<![가-힣A-Za-z])(?P<{key}>{pattern})" for key, pattern in SECTION_PATTERNS)
    matches = list(re.finditer(label_re, text, flags=re.IGNORECASE))
    sections: dict[str, str] = {}

    for idx, match in enumerate(matches):
        key = next((name for name, value in match.groupdict().items() if value), "")
        if not key or key in SKIP_KEYS:
            continue
        start = match.end()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(text)
        value = _clean_section_text(text[start:end])
        if value and key not in sections:
            sections[key] = value

    return sections


def _clean_section_text(text: str) -> str:
    text = re.sub(r"^\s*[:：\-–—]*\s*", "", text or "")
    text = re.sub(r"\[(?:토지|건물|집합건물|구분건물)\]", " ", text)
    text = re.sub(r"\b(?:구분|내용|비고)\b", " ", text)
    text = re.sub(r"\s+", " ", text).strip(" ,;:/")
    return text


def _location_sentences(text: str) -> list[str]:
    pieces = _split_sentences(text)
    if not pieces:
        return []
    selected: list[str] = []
    for piece in pieces:
        compact = piece.replace(" ", "")
        if any(token in compact for token in ("위치", "소재", "인근")):
            selected.append(_ensure_sentence(piece))
        elif any(token in compact for token in ("주위", "주변", "환경", "형성")):
            selected.append(_ensure_sentence(piece))
    return selected[:2] or [_ensure_sentence(pieces[0])]


def _sentence_from_section(key: str, text: str) -> str:
    sentence = _first_meaningful_sentence(text)
    if not sentence:
        return ""

    if key == "traffic":
        return _ensure_sentence(sentence)
    if key == "land_use":
        return _ensure_sentence(sentence)
    if key == "road":
        return _ensure_sentence(sentence)
    if key == "plan":
        return _ensure_sentence(sentence)
    if key == "structure":
        return _ensure_sentence(sentence)
    if key == "building_use":
        return _ensure_sentence(sentence)
    if key == "facility":
        return _ensure_sentence(sentence)
    return _ensure_sentence(sentence)


def _split_sentences(text: str) -> list[str]:
    text = _clean_section_text(text)
    if not text:
        return []

    protected = re.sub(r"(?<=\d)\.(?=\d)", "·", text)
    protected = re.sub(
        r"\s+(?=(?:본건은|대상물건은|본\s*물건은|주위는|주변은|차량|제반교통|토지거래|교육환경|생활편의성))",
        "<SPLIT>",
        protected,
    )
    protected = re.sub(r"(다\.|음\.|임\.|함\.|[.!?。])\s+", r"\1<SPLIT>", protected)
    chunks = protected.split("<SPLIT>")
    results: list[str] = []
    for chunk in chunks:
        chunk = chunk.replace("·", ".").strip(" -ㆍ")
        if len(chunk) < 3:
            continue
        results.append(chunk)
    return results


def _first_meaningful_sentence(text: str) -> str:
    sentences = _split_sentences(text)
    if sentences:
        return sentences[0]
    text = _clean_section_text(text)
    return text[:220].rstrip(" ,;") if text else ""


def _fallback_sentences(text: str) -> list[str]:
    return [_ensure_sentence(s) for s in _split_sentences(text)[:6]]


def _append_line(lines: list[str], sentence: str) -> None:
    sentence = _ensure_sentence(sentence)
    if not sentence:
        return
    line = f"- {sentence}"
    compact = re.sub(r"\s+", "", line)
    if any(re.sub(r"\s+", "", existing) == compact for existing in lines):
        return
    lines.append(line)


def _join_opinion_lines(lines: list[str]) -> str:
    cleaned = [line for line in lines if str(line or "").strip()]
    return "\n\n".join(cleaned)


def _ensure_sentence(text: str) -> str:
    text = _clean_section_text(text)
    if not text:
        return ""
    text = re.sub(r"\s+", " ", text).strip(" -ㆍ")
    text = text.rstrip(".!?,; ")
    text = _make_polite_ending(text)
    text = _polish_sentence_text(text)
    if not text.endswith("."):
        text = f"{text}."
    return text


def _polish_sentence_text(text: str) -> str:
    text = re.sub(r"제반\s*교통\s*사정\s*보통입니다$", "제반 교통사정은 보통입니다", text)
    text = re.sub(r"설비\s+등\s+되어 있습니다$", "설비 등이 되어 있습니다", text)
    return text


def _make_polite_ending(text: str) -> str:
    if not text:
        return ""

    replacements = [
        (r"되어\s*있음$", "되어 있습니다"),
        (r"되어\s*있슴$", "되어 있습니다"),
        (r"되어\s*있다$", "되어 있습니다"),
        (r"되어\s*있습니다$", "되어 있습니다"),
        (r"형성되어\s*있음$", "형성되어 있습니다"),
        (r"위치하며$", "위치합니다"),
        (r"위치함$", "위치합니다"),
        (r"소재하며$", "소재합니다"),
        (r"소재함$", "소재합니다"),
        (r"혼재함$", "혼재합니다"),
        (r"가능하며$", "가능합니다"),
        (r"접함$", "접하고 있습니다"),
        (r"가능함$", "가능합니다"),
        (r"양호함$", "양호합니다"),
        (r"편리함$", "편리합니다"),
        (r"우수함$", "우수합니다"),
        (r"보통시됨$", "보통입니다"),
        (r"보통임$", "보통입니다"),
        (r"판단됨$", "판단됩니다"),
        (r"해당됨$", "해당됩니다"),
        (r"해당함$", "해당합니다"),
        (r"확인됨$", "확인됩니다"),
        (r"확인되지 않음$", "확인되지 않습니다"),
        (r"확인\s*필요$", "확인이 필요합니다"),
        (r"필요$", "필요합니다"),
        (r"없음$", "없습니다"),
        (r"있음$", "있습니다"),
        (r"아님$", "아닙니다"),
        (r"임$", "입니다"),
        (r"이며$", "입니다"),
        (r"하며$", "합니다"),
        (r"됨$", "됩니다"),
        (r"함$", "합니다"),
        (r"된다$", "됩니다"),
        (r"한다$", "합니다"),
        (r"있다$", "있습니다"),
        (r"없다$", "없습니다"),
    ]
    for pattern, replacement in replacements:
        if re.search(pattern, text):
            return re.sub(pattern, replacement, text)

    if re.search(r"(습니다|입니다|합니다|됩니다|드립니다|바랍니다)$", text):
        return text
    if text.endswith("다"):
        return text
    return f"{text}입니다"
