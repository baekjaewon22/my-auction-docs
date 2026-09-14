# -*- coding: utf-8 -*-
"""Shared special-situation rules for auction rights analysis."""

from __future__ import annotations

from collections.abc import Iterable
import re


RISK_ORDER = {"상": 0, "중": 1, "하": 2}

SPECIAL_SITUATION_RULES = [
    {
        "code": "OWN-04",
        "name": "선순위 가등기 / 담보가등기",
        "risk": "상",
        "keywords": ["가등기", "소유권이전청구권"],
        "fact": "선순위 가등기는 담보가등기인지 순위보전 가등기인지에 따라 인수 여부가 달라집니다. 순위보전 가등기라면 본등기 시 낙찰자가 소유권을 상실할 수 있습니다.",
        "action": "가등기의 성격과 말소기준권리와의 선후, 채권신고·청산 여부를 반드시 확인하여야 합니다.",
    },
    {
        "code": "OWN-06",
        "name": "선순위 가처분",
        "risk": "상",
        "keywords": ["가처분", "처분금지"],
        "fact": "말소기준권리보다 앞선 가처분은 매각으로 말소되지 않고 인수될 수 있으며, 본안소송 결과에 따라 소유권에 영향을 줄 수 있습니다.",
        "action": "가처분의 피보전권리와 본안소송 진행·결과를 확인하여야 합니다.",
    },
    {
        "code": "ENC-01",
        "name": "유치권",
        "risk": "상",
        "keywords": ["유치권", "공사대금", "유치권신고", "유치권 신고"],
        "fact": "유치권은 점유와 피담보채권의 실체가 핵심이며, 허위 또는 압류 후 성립 유치권은 다툼의 여지가 큽니다.",
        "action": "문건처리내역상 유치권 신고·배제신청, 점유 개시 시점, 공사대금 채권의 실체를 확인하여야 합니다.",
    },
    {
        "code": "BLD-01",
        "name": "위반건축물",
        "risk": "상",
        "keywords": ["위반건축물", "무단증축", "불법증축", "무허가", "이행강제금"],
        "fact": "위반건축물은 시정명령과 이행강제금, 대출·인허가 제한 및 원상복구 비용이 발생할 수 있습니다.",
        "action": "관할 건축과를 통해 위반 내용, 양성화 가능성, 이행강제금 부과 이력과 예상 비용을 확인하여야 합니다.",
    },
    {
        "code": "LND-01",
        "name": "법정지상권",
        "risk": "상",
        "keywords": ["법정지상권", "토지만", "건물제외", "지상건물"],
        "fact": "토지만 매각되거나 건물이 매각에서 제외된 경우 법정지상권 성립 여부에 따라 사용·철거·지료 관계가 달라집니다.",
        "action": "토지·건물의 종전 소유관계, 건물 신축시점, 철거특약 유무를 등기와 건축물대장으로 확인하여야 합니다.",
    },
    {
        "code": "OWN-03",
        "name": "신탁등기",
        "risk": "상",
        "keywords": ["신탁", "수탁자", "우선수익자"],
        "fact": "신탁재산은 위탁자의 책임재산과 분리되므로 경매 원인과 신탁원부 내용에 따라 경매 무효·공매 위험이 있습니다.",
        "action": "신탁원부를 발급하여 우선수익자, 처분 권한, 경매 청구권원이 누구의 채권인지 확인하여야 합니다.",
    },
    {
        "code": "LIM-07",
        "name": "대위변제 위험",
        "risk": "상",
        "keywords": ["대위변제"],
        "fact": "말소기준 근저당의 채권액이 후순위 대항요건 임차인의 보증금보다 적으면 임차인이 이를 대위변제하여 말소기준이 변경될 수 있습니다.",
        "action": "선순위 근저당의 실제 잔액과 대위변제 가능성, 후순위 임차인의 대항요건을 확인하여야 합니다.",
    },
    {
        "code": "BLD-03",
        "name": "대지권 미등기",
        "risk": "중",
        "keywords": ["대지권미등기", "대지권 미등기"],
        "fact": "대지권 미등기는 대지사용권이 없다는 의미로 단정할 수는 없으나, 등기 지연·대출 제한·권리분쟁 위험이 있습니다.",
        "action": "감정평가서와 매각물건명세서상 대지권 가격 포함 여부, 미등기 사유와 향후 등기 가능성을 확인하여야 합니다.",
    },
    {
        "code": "OWN-02",
        "name": "토지 별도등기",
        "risk": "중",
        "keywords": ["토지별도등기", "토지 별도등기"],
        "fact": "집합건물 대지권 목적 토지에 별도 권리가 있는 경우로, 인수 특별매각조건이 있는지에 따라 위험이 달라집니다.",
        "action": "매각물건명세서의 토지 별도등기 인수 조건과 공동담보·동시배당 여부를 확인하여야 합니다.",
    },
    {
        "code": "OWN-01",
        "name": "지분 매각",
        "risk": "상",
        "keywords": ["지분매각", "지분 매각", "공유자", "공유지분"],
        "fact": "지분만 매각되는 물건은 공유자 우선매수권과 공유물분할 분쟁이 핵심 위험입니다.",
        "action": "공유자 수, 지분비율, 우선매수 신고 가능성, 점유·사용현황을 확인하여야 합니다.",
    },
    {
        "code": "LND-03",
        "name": "분묘기지권",
        "risk": "중",
        "keywords": ["분묘", "묘지", "분묘기지권"],
        "fact": "분묘가 있거나 가능성이 있는 토지는 분묘기지권, 개장 절차, 지료 및 이장 비용 검토가 필요합니다.",
        "action": "현장·로드뷰와 지자체 확인을 통해 분묘 소재, 설치시기, 연고자 유무와 개장 절차를 확인하여야 합니다.",
    },
]


_BUILDING_VIOLATION_KEYWORDS = (
    "위반건축물", "위반 건축물", "무단증축", "무단 증축", "불법증축", "불법 증축",
    "무허가", "이행강제금", "시정명령",
)


_CLAUSE_BREAK_RE = re.compile(r"[\r\n.!?。！？;；,，|/]+")
_CONTRAST_BREAK_RE = re.compile(
    r"(없으나|없지만|없고|아니나|아니지만|아니고|않으나|않지만|않고|"
    r"미해당이나|미해당이지만|부존재이나|부존재이지만|"
    r"말소되었으나|말소됐으나|취하되었으나|취하됐으나|"
    r"해제되었으나|해제됐으나|소멸되었으나|소멸됐으나)"
)
_DISCOURSE_BREAK_RE = re.compile(r"\s*(?:다만|그러나|하지만|반면)\s*")

# A source line often has the shape "유치권 신고 여부: 없음".  Only words
# that can grammatically sit between the matched keyword and its value belong
# here.  Keeping this list narrow prevents an unrelated "없음" later in the
# same line (for example "유치권 신고 있음, 배제신청 없음") from suppressing
# an affirmative signal.
_SIGNAL_QUALIFIER = (
    r"(?:등기|신고|표시|표기|성립|존재|소재|발견|확인|해당|등록|기재|"
    r"주장|가능성|사실|내용|여부|정황|이력|사항|처리|분류|판단|"
    r"매각|채권|청구|권리|상태|현재|은|는|이|가|을|를|도|에|에는|"
    r"으로|으로는|로|로는|의|및|[:：=\-–—()\[\]{}])*"
)
_NEGATIVE_VALUE = (
    r"(?:"
    r"해당(?:사항)?없(?:음|다|는|으며|고|었(?:음|다)?|어)|"
    r"없(?:음|다|는|으며|고|었(?:음|다)?|어)|"
    r"아님|아니(?:다|오|며|고|었(?:음|다)?)|미해당|부존재|정상|"
    r"해당하지않(?:음|는다|았(?:음|다)?|는|고)|"
    r"(?:존재|발견|확인|성립|신고|기재|등록|표시|표기|분류|판단)"
    r"되지않(?:음|는다|았(?:음|다)?|는|고)|"
    r"(?:말소|취하|해제|소멸)(?:완료|됨|되었(?:음|다)?|되어|됐(?:음|다)?|"
    r"처리(?:됨|완료)?|등기|된(?:상태)?|$)"
    r")"
)
_NEGATIVE_SUFFIX_RE = re.compile(rf"^{_SIGNAL_QUALIFIER}{_NEGATIVE_VALUE}")
_NEGATIVE_PREFIX_RE = re.compile(
    r"(?:해당없(?:는|음)?|없(?:는|음)|미해당(?:인)?|부존재(?:인)?|"
    r"아닌|아님|(?:말소|취하|해제|소멸)(?:완료)?(?:된|처리된))"
    r"(?:선순위|후순위|등기|신고|권리|표시|사항|[:：=\-–—()\[\]{}])*$"
)
_AFFIRMATIVE_DOUBLE_NEGATIVE_RE = re.compile(
    rf"^{_SIGNAL_QUALIFIER}(?:"
    r"없(?:음)?(?:이|은)?아니|해당없지않|미해당(?:이|은)?아니|"
    r"부존재(?:가|는|이)?아니|(?:말소|취하|해제|소멸)되지않"
    r")"
)
_LABEL_ONLY_RE = re.compile(rf"^{_SIGNAL_QUALIFIER}$")
_BARE_NEGATIVE_RE = re.compile(rf"^(?:[□☐☑✓✔○●]|\[[vVxX○● ]*\])*{_NEGATIVE_VALUE}$")
_UNKNOWN_VALUE = (
    r"(?:확인필요|확인요망|검토필요|조사필요|미상|불명|미확인|"
    r"확인불가|판단불가|판단보류|확인중|조사중|알수없(?:음|다))"
)
_UNKNOWN_SUFFIX_RE = re.compile(
    rf"^{_SIGNAL_QUALIFIER}"
    rf"(?:(?:말소|취하|해제|소멸)(?:등기|처리)?(?:여부|유무)?)?"
    rf"{_UNKNOWN_VALUE}(?:함|임|상태)?$"
)
_QUESTION_LABEL_RE = re.compile(
    rf"^{_SIGNAL_QUALIFIER}"
    r"(?:(?:말소|취하|해제|소멸)(?:등기|처리)?)?"
    r"(?:여부|유무)[:：=?\-–—()\[\]{}]*$"
)
_BARE_UNKNOWN_RE = re.compile(
    rf"^(?:[□☐☑✓✔○●]|\[[vVxX○● ]*\])*{_UNKNOWN_VALUE}(?:함|임|상태)?$"
)
_BARE_AFFIRMATIVE_RE = re.compile(
    r"^(?:[□☐☑✓✔○●]|\[[vVxX○● ]*\])*"
    r"(?:있음|있다|존재|존속|설정|접수|등록|기재|확인됨|발견됨|성립|"
    r"신고됨|표시됨|표기됨|해당|예|[yY])$"
)


def _compact(value: str) -> str:
    return re.sub(r"\s+", "", str(value or ""))


def _split_signal_clauses(line: str) -> list[str]:
    prepared = _CONTRAST_BREAK_RE.sub(r"\1\n", str(line or ""))
    prepared = _DISCOURSE_BREAK_RE.sub("\n", prepared)
    return [part.strip() for part in _CLAUSE_BREAK_RE.split(prepared) if part.strip()]


def _adjacent_value_state(next_line: str, previous_line: str) -> str:
    # A field value normally follows its label.  Fall back to the previous line
    # only for OCR that reversed the label/value order.
    for value in (next_line, previous_line):
        if not value or len(value) > 24:
            continue
        if _BARE_AFFIRMATIVE_RE.fullmatch(value):
            return "affirmative"
        if _BARE_NEGATIVE_RE.fullmatch(value) or _BARE_UNKNOWN_RE.fullmatch(value):
            return "non_affirmative"
    return ""


def _keyword_occurrences(compact_clause: str, keywords: tuple[str, ...]) -> list[tuple[int, int]]:
    candidates: list[tuple[int, int]] = []
    for keyword in keywords:
        start = 0
        while True:
            index = compact_clause.find(keyword, start)
            if index < 0:
                break
            candidates.append((index, index + len(keyword)))
            start = index + 1

    # Prefer the longest keyword when aliases overlap ("유치권" and
    # "유치권신고"), otherwise a shorter match would leave "신고" outside the
    # occurrence and make the scope calculation unnecessarily ambiguous.
    candidates.sort(key=lambda item: (item[0], -(item[1] - item[0])))
    occurrences: list[tuple[int, int]] = []
    for start, end in candidates:
        if occurrences and start < occurrences[-1][1]:
            continue
        occurrences.append((start, end))
    return occurrences


def _is_negated_occurrence(
    compact_clause: str,
    start: int,
    end: int,
    previous_end: int,
    next_start: int,
    previous_line: str,
    next_line: str,
) -> bool:
    before = compact_clause[max(previous_end, start - 24):start]
    after = compact_clause[end:min(next_start, end + 36)]

    # "말소되지 않음", "없음이 아님" and similar double negatives mean the
    # right/situation remains present, so they must win over generic negation.
    if _AFFIRMATIVE_DOUBLE_NEGATIVE_RE.match(after):
        return False
    if _NEGATIVE_SUFFIX_RE.match(after) or _NEGATIVE_PREFIX_RE.search(before):
        return True
    if _UNKNOWN_SUFFIX_RE.fullmatch(after):
        return True

    adjacent_state = _adjacent_value_state(next_line, previous_line)
    if _QUESTION_LABEL_RE.fullmatch(after):
        return adjacent_state != "affirmative"

    # OCR/table extraction may place a label and its value on adjacent lines.
    # Consult the next line only when nothing except label grammar follows the
    # keyword; this avoids borrowing an unrelated negative value.
    if _LABEL_ONLY_RE.fullmatch(after):
        if adjacent_state == "non_affirmative":
            return True
    return False


def detect_affirmative_signal(text: str, keywords: Iterable[str]) -> tuple[bool, str]:
    """Find a genuinely affirmative keyword occurrence in auction source text.

    Matching is occurrence-based rather than a whole-document substring check.
    Negative values close to a keyword (``없음``, ``해당없음``, ``아님``,
    ``미해당``, ``부존재`` or a completed ``말소/취하/해제/소멸``) are
    excluded.  A later affirmative clause still wins, which prevents false
    negatives in mixed source text.

    Returns ``(True, evidence_clause)`` for the first affirmative occurrence or
    ``(False, "")`` when every occurrence is absent/negated.
    """
    keyword_values = (keywords,) if isinstance(keywords, str) else keywords
    normalized_keywords = tuple(dict.fromkeys(
        compact_keyword
        for keyword in keyword_values
        if (compact_keyword := _compact(keyword))
    ))
    if not normalized_keywords:
        return False, ""

    lines = [re.sub(r"\s+", " ", line).strip() for line in str(text or "").splitlines()]
    lines = [line for line in lines if line]
    for line_index, line in enumerate(lines):
        previous_line = _compact(lines[line_index - 1]) if line_index else ""
        next_line = _compact(lines[line_index + 1]) if line_index + 1 < len(lines) else ""
        clauses = _split_signal_clauses(line)
        for clause_index, clause in enumerate(clauses):
            compact_clause = _compact(clause)
            occurrences = _keyword_occurrences(compact_clause, normalized_keywords)
            for occurrence_index, (start, end) in enumerate(occurrences):
                previous_end = occurrences[occurrence_index - 1][1] if occurrence_index else 0
                next_start = (
                    occurrences[occurrence_index + 1][0]
                    if occurrence_index + 1 < len(occurrences)
                    else len(compact_clause)
                )
                adjacent_line = next_line if clause_index == len(clauses) - 1 else ""
                if not _is_negated_occurrence(
                    compact_clause,
                    start,
                    end,
                    previous_end,
                    next_start,
                    previous_line,
                    adjacent_line,
                ):
                    return True, re.sub(r"\s+", " ", clause).strip()[:180]
    return False, ""


def detect_building_violation(text: str) -> tuple[bool, str]:
    """Return an affirmative violation marker while excluding negative checkbox/label text."""
    return detect_affirmative_signal(text, _BUILDING_VIOLATION_KEYWORDS)


def build_special_issue_lines(source_text: str, max_items: int = 8, verbose: bool = True) -> list[str]:
    matched = []
    for rule in SPECIAL_SITUATION_RULES:
        detected, _ = detect_affirmative_signal(source_text, rule["keywords"])
        if detected:
            matched.append(rule)

    matched.sort(key=lambda item: (RISK_ORDER.get(item["risk"], 9), item["code"]))
    if not matched:
        return []

    lines = []
    if sum(1 for item in matched if item["risk"] == "상") >= 2:
        lines.append("종합경고: 본건은 인수·비용 위험이 중첩되어 있어 입찰가 산정 전 정밀 검토가 필요합니다.")
    for rule in matched[:max_items]:
        if verbose:
            lines.append(f"{rule['name']}: {rule['fact']} {{{rule['action']}}}")
        else:
            lines.append(f"{rule['name']}: {{{rule['action']}}}")
    return dedupe_lines(lines)


def dedupe_lines(lines: list[str]) -> list[str]:
    result = []
    seen = set()
    for line in lines:
        key = re.sub(r"\s+", "", line or "")
        if not key or key in seen:
            continue
        seen.add(key)
        result.append(line)
    return result
