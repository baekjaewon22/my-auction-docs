# -*- coding: utf-8 -*-
"""Shared special-situation rules for auction rights analysis."""

from __future__ import annotations

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
_BUILDING_VIOLATION_NEGATIVE = (
    "해당없음", "해당 없음", "아님", "아니오", "없음", "미해당", "정상", "부존재",
)


def detect_building_violation(text: str) -> tuple[bool, str]:
    """Return an affirmative violation marker while excluding negative checkbox/label text."""
    normalized_lines = [re.sub(r"\s+", " ", line).strip() for line in str(text or "").splitlines()]
    normalized_lines = [line for line in normalized_lines if line]
    for index, line in enumerate(normalized_lines):
        compact = re.sub(r"\s+", "", line)
        matched = next((keyword for keyword in _BUILDING_VIOLATION_KEYWORDS if re.sub(r"\s+", "", keyword) in compact), "")
        if not matched:
            continue
        nearby = " ".join(normalized_lines[max(0, index - 1):index + 2])
        nearby_compact = re.sub(r"\s+", "", nearby)
        if any(re.sub(r"\s+", "", negative) in nearby_compact for negative in _BUILDING_VIOLATION_NEGATIVE):
            continue
        evidence = re.sub(r"\s+", " ", line).strip()[:180]
        return True, evidence or matched
    return False, ""


def build_special_issue_lines(source_text: str, max_items: int = 8, verbose: bool = True) -> list[str]:
    compact = re.sub(r"\s+", "", source_text or "")
    matched = []
    for rule in SPECIAL_SITUATION_RULES:
        if any(re.sub(r"\s+", "", keyword) in compact for keyword in rule["keywords"]):
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
