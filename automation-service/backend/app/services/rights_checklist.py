"""권리분석 보증서 2페이지 특이사항 종합 체크표 — 완전자동(무인) 판정 코어.

스펙: docs/rights-analysis-guarantee-checklist-spec.md (2026-08-29 완전자동 재매핑).

설계 원칙(대량 생산·수동 입력 없음):
- 결정론 항목(대항력·전입/확정·배당요구·보증금인수·등기 선후판정)은 규칙엔진 로직으로 상태 확정.
- 자동탐지/KB추론 항목은 특이사항 신호가 있으면 보수적으로 위험/확인 표기, 성립·금액은 미확인.
- 데이터 원천이 없으면 사람에게 넘기지 않고 미확인(UNKNOWN) 또는 해당없음(NA)로 자동 처리.
- 확신이 없을 때는 항상 인수·위험 쪽으로 보수 표기한다(false negative가 가장 위험).
- 모든 항목에 판정 근거(sources)를 남겨 사후 분쟁 방어에 사용한다.

이 모듈은 순수 함수다(외부 IO 없음). 파이프라인(rights_certificate.py)이 산출한 값을
ChecklistInputs로 매핑해 build_checklist()에 넘기면 32개 ChecklistItem을 돌려준다.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class State(str, Enum):
    SAFE = "이상없음"
    CHECK = "확인필요"
    RISK = "위험"
    UNKNOWN = "미확인"
    NA = "해당없음"


class Method(str, Enum):
    RULE = "규칙엔진"
    SIGNAL = "자동탐지"
    KB = "지식베이스추론"
    NONE = "불가"


@dataclass
class ChecklistItem:
    category: str
    name: str
    method: Method
    state: State
    basis: str            # 상태 판정 근거(무인 산출 문구)
    sources: str = ""     # 근거 파일/규칙(감사 추적)


@dataclass
class TenantFact:
    name: str = ""
    move_in: Optional[str] = None          # 전입일
    fixed_date: Optional[str] = None        # 확정일자
    has_opposing_power: Optional[bool] = None   # 대항력(규칙엔진 산출). None=미상
    demanded_dividend: Optional[bool] = None    # 배당요구 유효 제출. None=미상
    fully_paid: Optional[bool] = None       # 배당으로 보증금 전액 변제. None=미상


@dataclass
class RightFact:
    type: str = ""                          # 권리종류(전세권/가처분/가등기 등)
    date: Optional[str] = None
    is_before_base: Optional[bool] = None   # 말소기준보다 선순위인가. None=선후 미상


@dataclass
class ChecklistInputs:
    item_type: str = ""                     # 물건종별(지목/용도)
    base_right_date: Optional[str] = None   # 말소기준 성립일. None=말소기준 미확정
    tenants: list[TenantFact] = field(default_factory=list)
    rights: list[RightFact] = field(default_factory=list)
    tags: set[str] = field(default_factory=set)   # special_situations 코드(LND-01, ENC-01 ...)
    surplus_deficit: Optional[bool] = None  # 무잉여(잔여<=0). None=산정 불가
    surplus_small: Optional[bool] = None    # 잔여 소액
    withdrawal_signal: Optional[bool] = None    # 취하 신호(청구액/감정가·취하서 접수)
    unpaid_fee: Optional[int] = None        # 체납관리비 금액(원). None=미확보
    doc_mismatch: Optional[bool] = None     # 문서 간 불일치 탐지(명세서 vs 산출 말소기준 등)
    bid_deposit_rate: Optional[int] = None  # 입찰보증금율(%) . 20~30 = 재매각 신호
    supported_tags: set[str] = field(default_factory=set)  # 탐지가 실제 구현된 코드(빈 set = 전부 지원 가정)


# ── 물건종별 판별(N/A 처리용 휴리스틱) ─────────────────────────────
_FARMLAND = ("전", "답", "과수원", "농지")
_COLLECTIVE = ("아파트", "빌라", "다세대", "연립", "오피스텔", "도시형", "집합", "상가")
_LAND = ("토지", "대지", "임야", "잡종지", "전", "답", "과수원", "농지")


def _is_farmland(item_type: str) -> bool:
    t = (item_type or "").strip()
    return t in _FARMLAND or "농지" in t


def _is_collective(item_type: str) -> bool:
    t = item_type or ""
    return any(k in t for k in _COLLECTIVE)


def _is_land(item_type: str) -> bool:
    t = (item_type or "").strip()
    return any(k in t for k in _LAND)


def _rights_matching(rights: list[RightFact], *keywords: str) -> list[RightFact]:
    return [r for r in rights if any(k in (r.type or "") for k in keywords)]


# ── 결정론 항목(규칙엔진) ─────────────────────────────────────────

def _opposing_power(inp: ChecklistInputs) -> ChecklistItem:
    src = "권리분석_규칙.json 대항력.판정(전입 다음날 0시 vs 말소기준) · review-standard B-1"
    ts = inp.tenants
    if not ts:
        return ChecklistItem("임차·점유", "대항력", Method.RULE, State.SAFE, "조사된 임차인 없음 — 인수되는 임차권리 없음", src)
    if inp.base_right_date is None or any(t.has_opposing_power is None or t.move_in is None for t in ts):
        return ChecklistItem("임차·점유", "대항력", Method.RULE, State.UNKNOWN, "전입일 또는 말소기준일 결측 — 선후 판정 불가", src)
    opposing = [t for t in ts if t.has_opposing_power]
    if not opposing:
        return ChecklistItem("임차·점유", "대항력", Method.RULE, State.SAFE, "임차인 전원 후순위 — 매각으로 소멸", src)
    if any(t.fully_paid is False for t in opposing):
        return ChecklistItem("임차·점유", "대항력", Method.RULE, State.RISK, "선순위 대항력 임차인이 배당 부족 — 미배당 잔액 낙찰자 인수", src)
    if all(t.fully_paid for t in opposing):
        return ChecklistItem("임차·점유", "대항력", Method.RULE, State.SAFE, "선순위 대항력 임차인이나 우선변제로 전액 배당 확보", src)
    return ChecklistItem("임차·점유", "대항력", Method.RULE, State.UNKNOWN, "배당 충족 여부 미확정 — 보수적으로 인수 가능성 잔존", src)


def _move_fixed(inp: ChecklistInputs) -> ChecklistItem:
    src = "권리분석_규칙.json 우선변제권.배당기준일(max(대항력일,확정일자))"
    ts = inp.tenants
    if not ts:
        return ChecklistItem("임차·점유", "전입일·확정일자", Method.RULE, State.SAFE, "조사된 임차인 없음", src)
    opposing = [t for t in ts if t.has_opposing_power]
    scope = opposing or ts
    if any(t.move_in is None for t in scope):
        return ChecklistItem("임차·점유", "전입일·확정일자", Method.RULE, State.UNKNOWN, "전입일 결측 — 우선변제권 판정 불가", src)
    if any(t.has_opposing_power and not t.fixed_date for t in scope):
        return ChecklistItem("임차·점유", "전입일·확정일자", Method.RULE, State.CHECK, "선순위 임차인 확정일자 부재 — 우선변제권 미확보(대항력과 연동)", src)
    return ChecklistItem("임차·점유", "전입일·확정일자", Method.RULE, State.SAFE, "전입·확정일자 확보 — 우선변제권 성립", src)


def _dividend_demand(inp: ChecklistInputs) -> ChecklistItem:
    src = "기준표_소액임차인.json 판정규칙(배당요구일>종기→무효) · 규칙 최우선변제 판정순서"
    opposing = [t for t in inp.tenants if t.has_opposing_power]
    if not opposing:
        return ChecklistItem("임차·점유", "배당요구", Method.RULE, State.SAFE, "대항력 임차인 없음 — 배당요구 여부 무관(소멸)", src)
    if any(t.demanded_dividend is None for t in opposing):
        return ChecklistItem("임차·점유", "배당요구", Method.RULE, State.UNKNOWN, "배당요구 여부·종기 불명", src)
    if any(t.demanded_dividend is False for t in opposing):
        return ChecklistItem("임차·점유", "배당요구", Method.RULE, State.RISK, "대항력 임차인 배당요구 미제출/종기 경과 — 보증금 인수 확대", src)
    return ChecklistItem("임차·점유", "배당요구", Method.RULE, State.SAFE, "적법한 배당요구 제출", src)


def _deposit_takeover(inp: ChecklistInputs) -> ChecklistItem:
    src = "권리분석_규칙.json 임차인_4형태 매트릭스 · review-standard B-1(일부배당→차액 인수)"
    ts = inp.tenants
    if not ts:
        return ChecklistItem("임차·점유", "보증금 인수", Method.RULE, State.SAFE, "조사된 임차인 없음 — 인수 보증금 없음", src)
    opposing = [t for t in ts if t.has_opposing_power]
    if inp.base_right_date is None or any(t.has_opposing_power is None for t in ts):
        return ChecklistItem("임차·점유", "보증금 인수", Method.RULE, State.UNKNOWN, "말소기준·대항력 미확정 — 인수 범주 판정 불가", src)
    if not opposing:
        return ChecklistItem("임차·점유", "보증금 인수", Method.RULE, State.SAFE, "선순위 대항력 임차인 없음 — 보증금 전부 소멸", src)
    if any(t.fully_paid is False or (t.has_opposing_power and not t.fixed_date) for t in opposing):
        return ChecklistItem("임차·점유", "보증금 인수", Method.RULE, State.RISK,
                             "선순위 대항력 임차인 인수 발생 — 인수액=보증금−배당액(금액 미확정, 보수적으로 상한=보증금 전액)", src)
    return ChecklistItem("임차·점유", "보증금 인수", Method.RULE, State.UNKNOWN, "인수 범주는 없음에 가까우나 배당표 미완 — 금액 확정 유보", src)


def _senior_registered(name: str, keywords: tuple[str, ...], code: str, src: str,
                       inp: ChecklistInputs, absent_state: State = State.SAFE,
                       fallback_tag: Optional[str] = None) -> ChecklistItem:
    """전세권·가처분·가등기 공통: 등기 존재 + 말소기준 선후로 인수/소멸 판정.

    등기부 파싱에 해당 권리가 없으면 특이사항 태그(fallback_tag)로 보수 판정한다.
    """
    matched = _rights_matching(inp.rights, *keywords)
    if not matched:
        if fallback_tag and fallback_tag in inp.tags:
            return ChecklistItem("권리관계", name, Method.RULE, State.RISK,
                                 "등기 텍스트에서 탐지 — 말소기준 선후 판독 실패, 보수적 인수 위험", src)
        if fallback_tag and inp.supported_tags and fallback_tag not in inp.supported_tags:
            return ChecklistItem("권리관계", name, Method.RULE, State.UNKNOWN,
                                 "자동 탐지 미구현 — 등기부 확인 권고", src)
        return ChecklistItem("권리관계", name, Method.RULE, absent_state, "등기부에 해당 권리 미발견", src)
    if any(r.is_before_base is None for r in matched):
        return ChecklistItem("권리관계", name, Method.RULE, State.UNKNOWN, "등기 존재하나 말소기준과 선후 판독 실패 — 보수적으로 인수 위험 잔존", src)
    if any(r.is_before_base for r in matched):
        return ChecklistItem("권리관계", name, Method.RULE, State.RISK, "말소기준보다 선순위 — 낙찰자 인수(소멸되지 않음)", src)
    return ChecklistItem("권리관계", name, Method.RULE, State.SAFE, "말소기준보다 후순위 — 매각으로 소멸", src)


# ── 자동탐지(신호/태그) 항목 ──────────────────────────────────────

def _tag_item(category: str, name: str, code: str, present_state: State, present_basis: str,
              absent_state: State, absent_basis: str, src: str, inp: ChecklistInputs) -> ChecklistItem:
    if code in inp.tags:
        return ChecklistItem(category, name, Method.SIGNAL, present_state, present_basis, src)
    if inp.supported_tags and code not in inp.supported_tags:
        # 탐지 로직이 없는 항목을 '이상없음'으로 두면 거짓 음성 → 미확인 처리(부작위 오인 차단).
        return ChecklistItem(category, name, Method.SIGNAL, State.UNKNOWN,
                             "자동 탐지 미구현 — 원본 문서 확인 권고", src)
    return ChecklistItem(category, name, Method.SIGNAL, absent_state, absent_basis, src)


# ── 32개 조립 ─────────────────────────────────────────────────────

def build_checklist(inp: ChecklistInputs) -> list[ChecklistItem]:
    farmland = _is_farmland(inp.item_type)
    collective = _is_collective(inp.item_type)
    land = _is_land(inp.item_type)
    items: list[ChecklistItem] = []

    # 1. 권리관계
    items.append(_senior_registered(
        "선순위 전세권", ("전세권",), "LIM-02",
        "권리분석_규칙.json 인수소멸_판별 · briefing-rights 선순위전세권", inp))
    items.append(_senior_registered(
        "가처분", ("가처분", "처분금지"), "OWN-06",
        "권리분석_규칙.json(선순위 가처분→인수) · 교재 가처분 권리분석", inp, fallback_tag="OWN-06"))
    items.append(_senior_registered(
        "가등기(담보/순위보전)", ("가등기", "소유권이전청구권"), "OWN-04",
        "권리분석_규칙.json 인수소멸_판별 · briefing-rights 가등기", inp, fallback_tag="OWN-04"))
    items.append(_tag_item(
        "권리관계", "법정지상권", "LND-01", State.RISK,
        "토지만 매각+지상 건물 정황 탐지 — 성립 시 토지 사용·지료 부담(성립 여부 미확인)",
        State.SAFE, "토지만 매각 정황 미발견",
        "operation-rules 게이트1 · YAML LND-01 · briefing-rights(대법2022다236749)", inp))
    items.append(_tag_item(
        "권리관계", "유치권", "ENC-01", State.RISK,
        "유치권 신고 문건 탐지 — 인수(점유 수반) 위험(성립 진위 미확인)",
        State.SAFE, "유치권 신고 신호 미발견(미공시 리스크 잔존)",
        "YAML ENC-01 · briefing-rights(대법2011다55214) · 문건접수내역", inp))
    items.append(_tag_item(
        "권리관계", "토지 별도등기", "OWN-02", State.CHECK,
        "토지 별도등기 정황 탐지 — 인수 특별조건 확인 필요(없으면 원칙 소멸)",
        State.SAFE, "토지 별도등기 미발견",
        "briefing-rights(대법2005다15048) · review-standard B-9 · YAML OWN-02", inp))
    dae = ("BLD-03" in inp.tags)
    if not collective:
        items.append(ChecklistItem("권리관계", "대지권 미등기", Method.SIGNAL, State.NA,
                                    "집합건물 아님 — 판정 대상 아님",
                                    "YAML BLD-03 · briefing-rights(대법2010다71578)"))
    else:
        items.append(ChecklistItem("권리관계", "대지권 미등기", Method.SIGNAL,
                                    State.CHECK if dae else State.SAFE,
                                    "대지권 미등기 정황 탐지 — 감정가 대지권 포함 여부 확인(미포함 시 추가 매입 부담)" if dae
                                    else "대지권 미등기 신호 미발견",
                                    "YAML BLD-03 · briefing-rights(대법2010다71578) · review-standard B-15"))
    items.append(_tag_item(
        "권리관계", "공유지분 매각", "OWN-01", State.RISK,
        "지분만 매각 — 공유자 우선매수권·공유물분할 분쟁 위험(우선매수 결과는 예측 불가)",
        State.SAFE, "단독 소유(전부 매각) 정황",
        "YAML OWN-01 · review-standard B-7(민집법 140조)", inp))
    items.append(_tag_item(
        "권리관계", "중복·병합 사건", "DUP-01", State.CHECK,
        "중복·병합 사건 탐지 — 무잉여·배당·취하 영향 검토",
        State.NA, "단일 사건(중복·병합 표기 없음)",
        "교재 중복경매 · 사례 Q063", inp))

    # 2. 임차·점유
    items.append(_opposing_power(inp))
    items.append(_move_fixed(inp))
    items.append(_dividend_demand(inp))
    items.append(_deposit_takeover(inp))
    items.append(_tag_item(
        "임차·점유", "점유자 미상/점유관계", "LIM-05", State.CHECK,
        "점유관계 미상·폐문부재 정황 — 점유자 존재 가정(대항력·명도 불명)",
        State.SAFE, "점유관계 특정됨",
        "현황조사서 점유유형 · 교재 현황조사", inp))
    items.append(_tag_item(
        "임차·점유", "소유자와의 관계", "LIM-06", State.CHECK,
        "가장(위장)임차인 의심 정황 탐지 — 관계 확정 불가(무상거주 단정 금지)",
        State.SAFE, "특수관계 의심 정황 미발견",
        "YAML LIM-06 · 교재 가장임차인 판별 · 용어 T080", inp))
    if inp.doc_mismatch is None:
        items.append(ChecklistItem("임차·점유", "문서 간 불일치", Method.KB, State.UNKNOWN,
                                    "대조 대상 문서 결측 — 교차검증 불가",
                                    "명세서 최선순위 vs 산출 말소기준 교차검증"))
    else:
        items.append(ChecklistItem("임차·점유", "문서 간 불일치", Method.KB,
                                    State.CHECK if inp.doc_mismatch else State.SAFE,
                                    "명세서·현황조사·등기부 내용 상충 탐지" if inp.doc_mismatch else "핵심 필드 교차대조 일치",
                                    "명세서 최선순위 vs 산출 말소기준 교차검증 · property-checklist"))
    _hard_eviction = any(t.has_opposing_power for t in inp.tenants) or ("ENC-01" in inp.tags)
    items.append(ChecklistItem(
        "임차·점유", "명도 난이도", Method.KB,
        State.CHECK if _hard_eviction else State.SAFE,
        "저항 점유(대항력 임차인/유치권) 정황 — 정성 추정(정량 미확인)" if _hard_eviction
        else "공실·자진명도 협조 예상(정성 추정)",
        "교재 명도 실무 · 사례 Q056"))

    # 3. 물건 위험
    items.append(_tag_item(
        "물건 위험", "위반건축물", "BLD-01", State.RISK,
        "건축물대장 위반건축물 표기 탐지 — 이행강제금·원상복구 위험(금액 미확인)",
        State.SAFE, "위반건축물 표기 미발견",
        "operation-rules 게이트1 · YAML BLD-01 · briefing-rights(건축법 79·80조)", inp))
    items.append(_tag_item(
        "물건 위험", "토지·건물 일괄매각", "LND-01", State.CHECK,
        "토지만/건물만 분리매각 정황 — 법정지상권·사용관계 연동 확인",
        State.SAFE, "토지·건물 일괄매각(정상)",
        "교재 명세서 매각 대상 · property-checklist", inp))
    if farmland:
        items.append(ChecklistItem("물건 위험", "농지취득자격증명", Method.SIGNAL, State.CHECK,
                                    "농지(전·답·과수원) — 매각결정기일까지 농취증 제출 필요(미제출 시 보증금 몰수)",
                                    "operation-rules 게이트1 · YAML AGR-01 · briefing-rights"))
    else:
        items.append(ChecklistItem("물건 위험", "농지취득자격증명", Method.SIGNAL, State.NA,
                                    "농지 아님 — 판정 대상 아님",
                                    "operation-rules 게이트1 · YAML AGR-01"))
    items.append(_tag_item(
        "물건 위험", "현황 변경", "CHG-01", State.CHECK,
        "공부와 다른 현황(용도변경·멸실·증축) 정황 탐지 — 위법성·복구비 미확인",
        State.SAFE, "공부와 현황 일치 정황",
        "교재 신·구건물 동일성 · property-checklist", inp))
    items.append(_tag_item(
        "물건 위험", "제시외 건물", "BLD-02", State.RISK,
        "감정서 제시외 건물 표기 탐지 — 인수/철거·법정지상권 분쟁 위험(소유관계 미확인)",
        State.SAFE, "제시외 건물 미발견",
        "YAML BLD-02 · briefing-rights 제시외", inp))
    # 맹지 / 경계 — 데이터 원천 없음(불가)
    items.append(ChecklistItem("물건 위험", "맹지/도로 접함", Method.NONE,
                               State.UNKNOWN if land else State.NA,
                               "지적도/GIS 접도 데이터 부재 — 자동 판정 불가(건축 제한 가능성 보수 고지)" if land
                               else "토지 물건 아님 — 판정 대상 아님",
                               "briefing-rights 맹지(건축법 44조) · 지적도 미연동"))
    items.append(ChecklistItem("물건 위험", "경계 문제", Method.NONE, State.NA,
                               "측량성과도·현황측량 데이터 부재 — 판정 대상 아님",
                               "지적현황측량 미연동"))
    items.append(_tag_item(
        "물건 위험", "재개발·재건축", "RED-01", State.CHECK,
        "정비구역·투기과열지구 정황 탐지 — 조합원 지위 승계/현금청산 확인 필요",
        State.SAFE, "정비사업 구역 정황 미발견",
        "YAML RED-01 · briefing-rights(도정법 39조) · review-standard B-14", inp))

    # 4. 입찰·비용
    if inp.surplus_deficit is None:
        items.append(ChecklistItem("입찰·비용", "무잉여", Method.KB, State.UNKNOWN,
                                    "선순위 채권액·집행비용 산정 불가", "용어 T009 산식 · 사례 Q035"))
    elif inp.surplus_deficit:
        items.append(ChecklistItem("입찰·비용", "무잉여", Method.KB, State.RISK,
                                    "잉여 없음 — 무잉여로 경매 취소·기각 가능", "용어 T009 산식 · 사례 Q035"))
    elif inp.surplus_small:
        items.append(ChecklistItem("입찰·비용", "무잉여", Method.KB, State.CHECK,
                                    "잔여 소액 — 무잉여 경계, 배당 여유 확인 필요", "용어 T009 산식"))
    else:
        items.append(ChecklistItem("입찰·비용", "무잉여", Method.KB, State.SAFE,
                                    "잉여 충분 — 무잉여 위험 낮음", "용어 T009 산식"))
    items.append(ChecklistItem("입찰·비용", "취하 가능성", Method.KB,
                               State.CHECK if inp.withdrawal_signal else State.SAFE,
                               "취하 신호(청구액≪감정가·단독채권자/취하서 접수) — 절차 무산 가능(실제 취하는 예측 불가)"
                               if inp.withdrawal_signal else "취하 신호 미발견(실제 취하는 예측 불가)",
                               "교재 취하 · 사례 Q036/Q069"))
    if inp.unpaid_fee is None:
        items.append(ChecklistItem("입찰·비용", "체납관리비", Method.KB, State.UNKNOWN,
                                    "체납관리비 자료 미확보 — 공용부분만 낙찰자 승계(전유·연체료 제외), 금액 미확인",
                                    "교재 체납관리비 · review-standard C(대법 공용부분 승계)"))
    elif inp.unpaid_fee > 0:
        items.append(ChecklistItem("입찰·비용", "체납관리비", Method.KB, State.CHECK,
                                    f"체납관리비 {inp.unpaid_fee:,}원 — 공용부분만 인수(전유·연체료 원칙 제외). 공용/전유 구분 확인 필요",
                                    "교재 체납관리비 · review-standard C(대법 공용부분 승계)"))
    else:
        items.append(ChecklistItem("입찰·비용", "체납관리비", Method.KB, State.SAFE,
                                    "체납관리비 없음", "교재 체납관리비"))
    items.append(ChecklistItem("입찰·비용", "명도비용", Method.NONE, State.UNKNOWN,
                               "정량 산정 불가 — 이사비는 강제집행 예납비용 이내 관행(확정 금액 아님)",
                               "교재 이사비 · 사례 Q055"))
    items.append(ChecklistItem("입찰·비용", "부대비용(취득세 등)", Method.KB, State.CHECK,
                               "취득세·법무사·설정비 등 반영 필요 — 세율표 기준 개산(확정 아님)",
                               "교재 실질취득원가 · 용어 T095"))
    items.append(ChecklistItem("입찰·비용", "매각불허가 사유", Method.KB,
                               State.CHECK if ("AGR-01" in inp.tags or "OWN-01" in inp.tags) else State.SAFE,
                               "탐지된 불허가 유발 사유(농취증 미제출·공유자 우선매수 등) 확인 필요" if ("AGR-01" in inp.tags or "OWN-01" in inp.tags)
                               else "탐지된 불허가 사유 없음(통합 판정 아님)",
                               "YAML AGR-01 · review-standard B-7 · 사례 Q058/Q060"))
    rate = inp.bid_deposit_rate
    if rate is None:
        items.append(ChecklistItem("입찰·비용", "입찰보증금 특례(재매각)", Method.SIGNAL, State.UNKNOWN,
                                    "공고 입찰보증금율 미확보 — 원칙 10% 가정", "용어 T027/T032 · 사례 Q070"))
    elif rate >= 20:
        items.append(ChecklistItem("입찰·비용", "입찰보증금 특례(재매각)", Method.SIGNAL, State.CHECK,
                                    f"입찰보증금 {rate}% 특별매각조건 — 재매각(앞 낙찰자 미납) 신호, 준비금 상향",
                                    "용어 T027/T032 · 사례 Q070"))
    else:
        items.append(ChecklistItem("입찰·비용", "입찰보증금 특례(재매각)", Method.SIGNAL, State.SAFE,
                                    f"입찰보증금 {rate}%(일반) — 재매각 아님", "용어 T027/T032"))

    return items


# 위험도 정렬(위험 → 확인필요 → 미확인 → 이상없음 → 해당없음)
_SEVERITY = {State.RISK: 0, State.CHECK: 1, State.UNKNOWN: 2, State.SAFE: 3, State.NA: 4}


def summarize(items: list[ChecklistItem]) -> dict[str, int]:
    counts = {s.value: 0 for s in State}
    for it in items:
        counts[it.state.value] += 1
    return counts


def sort_by_severity(items: list[ChecklistItem]) -> list[ChecklistItem]:
    return sorted(items, key=lambda it: _SEVERITY.get(it.state, 9))


# ── 파이프라인 어댑터 ─────────────────────────────────────────────
import re as _re

# special_situations.py에 탐지 로직이 실제 구현된 코드(그 외는 미확인 처리)
_SUPPORTED_CODES = {
    "OWN-01", "OWN-02", "OWN-03", "OWN-04", "OWN-06",
    "ENC-01", "BLD-01", "BLD-03", "LND-01", "LND-03", "LIM-07",
}

_STATE_CLASS = {
    State.RISK: "st-risk", State.CHECK: "st-check", State.SAFE: "st-safe",
    State.UNKNOWN: "st-unknown", State.NA: "st-na",
}


def _parse_ymd(value) -> Optional[tuple[int, int, int]]:
    if not value:
        return None
    nums = _re.findall(r"\d+", str(value))
    if len(nums) < 3:
        return None
    try:
        return (int(nums[0]), int(nums[1]), int(nums[2]))
    except ValueError:
        return None


def _before(a, b) -> Optional[bool]:
    ka, kb = _parse_ymd(a), _parse_ymd(b)
    if ka is None or kb is None:
        return None
    return ka < kb


def detect_situation_codes(text: str) -> set[str]:
    """special_situations.py 규칙으로 텍스트에서 특이사항 코드 집합을 추출(무인 탐지)."""
    try:
        from .special_situations import SPECIAL_SITUATION_RULES, detect_building_violation
    except ImportError:  # 단독 실행(테스트)
        from special_situations import SPECIAL_SITUATION_RULES, detect_building_violation
    compact = _re.sub(r"\s+", "", text or "")
    codes: set[str] = set()
    for rule in SPECIAL_SITUATION_RULES:
        if any(_re.sub(r"\s+", "", kw) in compact for kw in rule["keywords"]):
            codes.add(rule["code"])
    violated, _ = detect_building_violation(text or "")
    if violated:
        codes.add("BLD-01")
    return codes


def build_checklist_from_pipeline(*, data: dict, rights: list, base_right: Optional[dict],
                                  valid_tenants: list, management_fee: Optional[dict],
                                  surplus_description: str = "",
                                  texts: Optional[list] = None) -> list[ChecklistItem]:
    """rights_certificate.py 파이프라인 산출값을 ChecklistInputs로 매핑해 체크표를 만든다."""
    base_date = (base_right or {}).get("date") if base_right else None

    right_facts = [
        RightFact(type=r.get("type") or "", date=r.get("date"),
                  is_before_base=_before(r.get("date"), base_date))
        for r in (rights or [])
    ]

    tenant_facts = []
    for t in (valid_tenants or []):
        mv = t.get("moveInDate") or None
        fx = t.get("fixedDate") or None
        claim = t.get("depositClaimDate") or None
        tenant_facts.append(TenantFact(
            name=t.get("name") or "",
            move_in=mv, fixed_date=fx,
            has_opposing_power=(_before(mv, base_date) if (mv and base_date) else None),
            demanded_dividend=(True if claim else None),
            fully_paid=None,  # 배당 시뮬레이션 미구현 → 인수 여부는 보수적으로 유보
        ))

    joined = " \n ".join(str(x or "") for x in (texts or []))
    tags = detect_situation_codes(joined)

    # analyze_surplus는 서술 텍스트만 반환하므로 무잉여/취하 판정은 미확정으로 둔다
    # (텍스트 키워드 판정은 '무잉여 우려 낮음' 같은 문장에서 거짓 양성 → 무잉여 산식 코드화 전까지 미확인. kbGap)
    surplus_deficit = None
    withdrawal = None

    amt = (management_fee or {}).get("unpaidAmount")
    unpaid = int(amt) if amt not in (None, "") else None

    inp = ChecklistInputs(
        item_type=(data or {}).get("item_type") or "",
        base_right_date=base_date,
        tenants=tenant_facts, rights=right_facts,
        tags=tags, supported_tags=set(_SUPPORTED_CODES),
        surplus_deficit=surplus_deficit, withdrawal_signal=withdrawal,
        unpaid_fee=unpaid,
    )
    return build_checklist(inp)


def checklist_to_context(items: list[ChecklistItem]) -> dict:
    """템플릿 렌더용 컨텍스트(요약 표 rows + 위험/확인 상세 details)로 변환."""
    rows = [
        {"category": it.category, "name": it.name, "state": it.state.value,
         "stateClass": _STATE_CLASS[it.state]}
        for it in items
    ]
    details = [
        {"name": it.name, "state": it.state.value, "stateClass": _STATE_CLASS[it.state],
         "basis": it.basis, "sources": it.sources}
        for it in sort_by_severity(items) if it.state in (State.RISK, State.CHECK)
    ]
    counts = summarize(items)
    summary_text = " · ".join(f"{k} {v}" for k, v in counts.items() if v)
    return {"checklistRows": rows, "checklistDetails": details, "checklistSummaryText": summary_text}
