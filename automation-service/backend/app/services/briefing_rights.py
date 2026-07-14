# -*- coding: utf-8 -*-
"""브리핑자료 전용 권리분석 데이터 구성.

권리분석 보증서와 원자료 파싱 원리는 유사하지만, 문안과 구성은 브리핑자료
전용으로 분기한다. 이 모듈은 보증서용 template_data를 직접 재사용하지 않는다.
"""

from __future__ import annotations

import logging
import re
import time
from typing import Callable, Optional

from . import rights_certificate as rc
from .special_situations import (
    RISK_ORDER,
    SPECIAL_SITUATION_RULES,
    build_special_issue_lines,
    dedupe_lines,
)

logger = logging.getLogger(__name__)


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
        "keywords": ["유치권", "공사대금"],
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


def extract_context(
    soup,
    driver=None,
    task_id: Optional[str] = None,
    progress_callback: Optional[Callable[[str, float], None]] = None,
    timeout_seconds: int = 180,
) -> dict:
    """브리핑자료에서 사용할 권리분석 원자료를 추출한다."""
    started_at = time.monotonic()
    deadline = started_at + max(30, timeout_seconds)
    warnings: list[str] = []

    def report(message: str, percent: float) -> None:
        if progress_callback:
            try:
                progress_callback(message, percent)
            except Exception:
                pass

    def has_budget(label: str) -> bool:
        if time.monotonic() - started_at < max(30, timeout_seconds):
            return True
        warning = f"권리분석 전체 제한시간({timeout_seconds}초) 초과로 {label}을(를) 생략했습니다."
        warnings.append(warning)
        logger.warning(warning)
        return False

    selector_fields = rc._extract_selector_fields(soup)
    rights_selector_text = _extract_rights_selector_text(soup)
    rights_ocr_context = {}
    if driver and has_budget("등기 권리정보 OCR"):
        report("등기 권리정보 OCR 확인 중...", 18.2)
        try:
            rights_ocr_context = rc.extract_rights_context_by_ocr(driver, task_id=task_id, deadline=deadline)
            if rights_ocr_context.pop("_timed_out", False):
                warnings.append("등기 권리정보 OCR이 전체 제한시간에 도달해 나머지 페이지를 생략했습니다.")
        except Exception as exc:
            warnings.append(f"등기 권리정보 OCR 생략: {exc}")
            logger.warning(warnings[-1])
    rights = rc.merge_rights(rc._extract_rights(soup), rights_ocr_context.get("rights") or [])
    tenant_context = {}
    if driver and has_budget("매각물건명세서·임차인 OCR"):
        report("매각물건명세서·임차인 OCR 확인 중...", 18.7)
        try:
            tenant_context = rc.extract_tenant_context_by_ocr(driver, task_id=task_id, deadline=deadline)
            if tenant_context.pop("_timed_out", False):
                warnings.append("매각물건명세서·임차인 OCR이 전체 제한시간에 도달해 나머지 페이지를 생략했습니다.")
        except Exception as exc:
            warnings.append(f"매각물건명세서·임차인 OCR 생략: {exc}")
            logger.warning(warnings[-1])
    status_survey_context = {}
    if driver and has_budget("현황조사서 확인"):
        report("현황조사서 확인 중...", 19.2)
        try:
            status_survey_context = rc.extract_status_survey_context_by_ocr(driver, task_id=task_id)
        except Exception as exc:
            warnings.append(f"현황조사서 확인 생략: {exc}")
            logger.warning(warnings[-1])
    case_document_text = ""
    if driver and has_budget("사건 관련 문서 확인"):
        report("사건 관련 문서 확인 중...", 19.6)
        try:
            case_document_text = rc.collect_case_document_text(driver)
        except Exception as exc:
            warnings.append(f"사건 관련 문서 확인 생략: {exc}")
            logger.warning(warnings[-1])

    context = {
        "rights": rights,
        "rights_ocr_text": rights_ocr_context.get("rights_ocr_text", ""),
        "rights_ocr_images": rights_ocr_context.get("rights_ocr_images", []),
        "tenants": tenant_context.get("tenants") or rc._extract_tenants(soup),
        "tenant_source": tenant_context.get("tenant_source", ""),
        "tenant_ocr_text": tenant_context.get("tenant_ocr_text", ""),
        "tenant_ocr_images": tenant_context.get("tenant_ocr_images", []),
        "sale_spec_remarks": tenant_context.get("sale_spec_remarks", ""),
        "status_survey_etc": status_survey_context.get("status_survey_etc")
        or rc._extract_status_survey_etc_from_text(soup.get_text("\n", strip=True)),
        "status_survey_text": status_survey_context.get("status_survey_text", ""),
        "case_document_text": case_document_text,
        "dividend_requests": rc._extract_dividend_requests(soup),
        "related_cases": rc._extract_related_cases(soup),
        "auction_applicant_creditors": rc._extract_auction_applicant_creditors(soup, selector_fields.get("case_number") or ""),
        "management_fee": rc._extract_management_fee(soup),
        "market_data": rc._extract_market_data(soup),
        "rights_extraction_warnings": warnings,
    }
    if rights_selector_text:
        context["rights_selector_text"] = rights_selector_text
    context["expected_dividend"] = rc._extract_expected_dividend(
        soup,
        selector_fields.get("case_number") or "",
        context.get("auction_applicant_creditors") or [],
    )
    context.update(selector_fields)
    return context


def _extract_rights_selector_text(soup) -> str:
    """마이옥션 상세의 권리분석 selectbox 선택값을 가능한 범위에서 추출한다."""
    found: list[str] = []
    for select in soup.find_all("select"):
        meta = " ".join(str(select.get(attr) or "") for attr in ("id", "name", "class", "title", "aria-label"))
        parent = select.find_parent(["tr", "li", "div"])
        nearby = " ".join(filter(None, [meta, parent.get_text(" ", strip=True) if parent else ""]))
        if "권리분석" not in nearby:
            continue
        option = select.find("option", selected=True) or select.find("option")
        text = re.sub(r"\s+", " ", option.get_text(" ", strip=True) if option else "").strip()
        if text and text not in {"선택", "선택하세요", "-"}:
            found.append(text)

    for row in soup.find_all(["tr", "li", "div"]):
        text = re.sub(r"\s+", " ", row.get_text(" ", strip=True)).strip()
        if "권리분석" not in text:
            continue
        text = re.sub(r"^.*?권리분석\s*[:：-]?\s*", "", text).strip()
        if text and text not in {"선택", "선택하세요", "-"}:
            found.append(text)

    result: list[str] = []
    for item in found:
        if item not in result:
            result.append(item)
    return "\n".join(result[:5]).strip()


def build_opinion_data(data: dict) -> dict:
    """브리핑자료 의견 작성에 필요한 전용 데이터로 변환한다."""
    rights = data.get("rights") or []
    tenants = data.get("tenants") or []
    valid_tenants = [tenant for tenant in tenants if not rc._is_no_tenant_record(tenant)]
    dividend_requests = data.get("dividend_requests") or []
    related_cases = data.get("related_cases") or []
    management_fee = data.get("management_fee") or {}
    market_data = data.get("market_data") or {}

    base_right = _select_base_right(data, rights)
    tenant_texts = rc.analyze_tenants(
        valid_tenants,
        base_right,
        dividend_requests,
        data.get("sale_spec_dividend_deadline") or "",
        data.get("address") or "",
    )
    registered_takeover_texts = rc.analyze_registered_takeover_rights(rights, base_right, dividend_requests)

    tenant_analysis_text = rc.build_tenant_analysis_text(
        tenants,
        tenant_texts,
        data.get("tenant_ocr_text") or "",
        data.get("tenant_source") or "",
    )
    if registered_takeover_texts:
        tenant_analysis_text = rc.combine_tenant_and_registered_takeover_texts(
            tenant_analysis_text,
            registered_takeover_texts,
        )
    tenant_extra_warnings = _tenant_extra_warnings(valid_tenants, rights, data)
    if tenant_extra_warnings:
        tenant_analysis_text = _soften_no_takeover_statement(tenant_analysis_text)
        tenant_analysis_text = "\n\n".join([tenant_analysis_text, *tenant_extra_warnings]).strip()

    sale_spec_remarks_text = rc._polite_optional_note(
        data.get("sale_spec_remarks"),
        "매각물건명세서 비고란에 별도로 기재된 사항은 없습니다.",
    )
    status_survey_etc_text = rc._polite_optional_note(
        data.get("status_survey_etc"),
        "현황조사서 기타란에 별도로 기재된 사항은 없습니다.",
    )
    case_notice_text = rc._clean_document_note(data.get("case_notice"), limit=500)
    no_tenants = tenant_analysis_text == rc.NO_TENANTS_TEXT

    return {
        "baseRightDescription": _build_base_right_description(base_right, registered_takeover_texts, rights, valid_tenants),
        "tenantAnalysisText": tenant_analysis_text,
        "tenantAnalyses": [] if no_tenants else [
            {"description": block.strip()}
            for block in tenant_analysis_text.split("\n\n")
            if block.strip()
        ],
        "noTenants": no_tenants,
        "surplusDescription": _build_surplus_description(data, rights, related_cases, base_right),
        "specialSummaryText": _build_special_summary_text(
            data,
            rights,
            valid_tenants,
            base_right,
            tenant_texts,
            tenant_analysis_text,
            registered_takeover_texts,
            management_fee,
            market_data,
            sale_spec_remarks_text,
            status_survey_etc_text,
            case_notice_text,
            _data_quality_flags(data, rights, valid_tenants, base_right),
        ),
        "caseNoticeText": case_notice_text,
        "주의사항": case_notice_text,
    }


def _select_base_right(data: dict, rights: list[dict]) -> Optional[dict]:
    sale_spec_base_right = data.get("sale_spec_base_right") or {}
    selector_base_right = data.get("selector_base_right") or {}
    if sale_spec_base_right.get("date"):
        base_right = sale_spec_base_right
    elif selector_base_right.get("date"):
        base_right = selector_base_right
    else:
        base_right = rc.find_base_right(rights)
    return rc.enrich_base_right_from_registry(base_right, rights)


def _senior_takeover_rights(rights: list[dict], base_right: Optional[dict]) -> list[dict]:
    base_date = (base_right or {}).get("date") or ""
    if not rc._has_valid_date(base_date):
        return []

    candidates = []
    for right in rights or []:
        right_date = right.get("date") or ""
        if not rc._has_valid_date(right_date) or not rc._date_before(right_date, base_date):
            continue
        text = _right_compact_text(right)
        if any(token in text for token in ("전세권", "가등기", "가처분", "지상권", "지역권", "구분지상권", "환매특약", "환매")):
            candidates.append(right)
    return candidates


def _right_compact_text(right: dict) -> str:
    return re.sub(
        r"\s+",
        "",
        " ".join(
            str(right.get(key) or "")
            for key in ("type", "creditor", "note", "status", "rawText")
        ),
    )


def _senior_takeover_right_text(right: dict) -> str:
    date = right.get("date") or "일자 확인 필요"
    right_type = right.get("type") or "권리종류 확인 필요"
    creditor = right.get("creditor") or "권리자 확인 필요"
    text = _right_compact_text(right)
    if "가등기" in text:
        return (
            f"다만 말소기준권리보다 앞선 {date} 자 {creditor} {right_type}{_subject_particle(right_type)} 있어, "
            "담보가등기가 아닌 순위보전 가등기라면 본등기 시 낙찰자가 소유권을 상실할 수 있습니다. "
            "{가등기의 성격과 청산 여부를 반드시 확인하여야 합니다.}"
        )
    if "가처분" in text:
        return (
            f"다만 말소기준권리보다 앞선 {date} 자 {creditor} {right_type}{_subject_particle(right_type)} 있어 매각으로 말소되지 않고 인수될 수 있으며, "
            "본안소송 결과에 따라 소유권에 영향을 줄 수 있습니다. {가처분의 피보전권리와 본안 진행을 확인하여야 합니다.}"
        )
    if any(token in text for token in ("지상권", "지역권", "구분지상권")):
        return (
            f"다만 말소기준권리보다 앞선 {date} 자 {creditor} {right_type}{_subject_particle(right_type)} 있어 매각 후에도 사용 제한 또는 부담으로 남을 수 있습니다. "
            "{존속기간, 사용 범위, 지료 및 말소 가능성을 확인하여야 합니다.}"
        )
    if "환매" in text:
        return (
            f"다만 말소기준권리보다 앞선 {date} 자 {creditor} {right_type}{_subject_particle(right_type)} 있어 환매권 행사 시 소유권에 영향을 줄 수 있습니다. "
            "{환매기간, 환매금액, 말소기준권리와의 선후를 확인하여야 합니다.}"
        )
    return (
        f"다만 말소기준권리보다 앞선 {date} 자 {creditor} {right_type}{_subject_particle(right_type)} 있어 매각으로 소멸하지 않고 낙찰자에게 인수될 수 있습니다. "
        "{그 내용과 부담을 반드시 확인하여야 합니다.}"
    )


def _subrogation_warning(base_right: Optional[dict], tenants: list[dict]) -> str:
    base_type = (base_right or {}).get("type") or ""
    base_amount = rc.parse_money((base_right or {}).get("amount"))
    base_date = (base_right or {}).get("date") or ""
    if base_amount <= 0 or not rc._has_valid_date(base_date) or not any(token in base_type for token in ("근저당", "저당")):
        return ""

    for tenant in tenants or []:
        deposit = rc.parse_money(tenant.get("deposit"))
        move_in = tenant.get("moveInDate") or ""
        if deposit <= base_amount or not rc._has_valid_date(move_in):
            continue
        if rc._date_after(move_in, base_date):
            return (
                f"말소기준권리인 {base_type}의 채권액({rc.fmt_money(base_amount)})이 후순위 임차인의 보증금({rc.fmt_money(deposit)})보다 적어, "
                "임차인 등이 이를 대위변제하면 말소기준이 변경되어 임차권이 낙찰자에게 인수될 수 있습니다. "
                "{선순위 근저당의 실제 잔액과 대위변제 가능성을 확인하여야 합니다.}"
            )
    return ""


def _build_base_right_description(
    base_right: Optional[dict],
    registered_takeover_texts: list[str],
    rights: list[dict],
    tenants: list[dict],
) -> str:
    if not base_right:
        return (
            "등기부현황과 매각물건명세서에서 말소기준권리 확인이 필요합니다. "
            "원본 문서를 기준으로 담당자 최종 확인이 필요합니다."
        )

    date = base_right.get("date") or "일자 확인 필요"
    right_type = base_right.get("type") or "권리종류 확인 필요"
    creditor = base_right.get("creditor") or "권리자 확인 필요"
    senior_takeover_rights = _senior_takeover_rights(rights, base_right)
    sub_lines = []
    if senior_takeover_rights:
        for right in senior_takeover_rights[:3]:
            sub_lines.append(_senior_takeover_right_text(right))
    elif registered_takeover_texts:
        sub_lines.append("다만 최선순위 설정일보다 앞선 전세권은 배당요구 여부에 따라 임차권리 인수사항에서 별도 검토가 필요합니다.")
    else:
        sub_lines.append("그 이후의 권리는 모두 말소되어 등기부상 낙찰자가 인수하는 권리는 없는 구조로 판단됩니다.")

    subrogation_warning = _subrogation_warning(base_right, tenants)
    if subrogation_warning:
        sub_lines.append(subrogation_warning)

    return (
        f"최선순위 {date} 자 {creditor} {right_type}이 '말소기준권리'입니다.\n"
        + "\n".join(sub_lines)
    )


def _build_surplus_description(data: dict, rights: list[dict], related_cases: list[dict], base_right: Optional[dict] = None) -> str:
    appraised = rc.parse_money(data.get("appraised_price"))
    total_debt = sum(int(r.get("amount") or 0) for r in rights if r.get("amount"))

    lines: list[str] = []
    if not appraised or not rights:
        lines.append("감정가 또는 등기부상 채권 총액 확인이 필요하여 취하 가능성을 확정하지 못했습니다.")
    else:
        debt_rate = total_debt / appraised
        debt_rate_text = _format_percent(debt_rate * 100)
        if debt_rate < 0.7:
            lines.append(
                f"확인된 채권 총액은 {rc.fmt_money(total_debt)}으로 감정가 {rc.fmt_money(appraised)} 대비 "
                f"{debt_rate_text}이며, 70% 미만이므로 취하 가능성이 있습니다."
            )
        else:
            lines.append(
                f"확인된 채권 총액은 {rc.fmt_money(total_debt)}으로 감정가 {rc.fmt_money(appraised)} 대비 "
                f"{debt_rate_text}이며, 70% 이상이므로 취하 가능성은 낮습니다."
            )

    expected_dividend = data.get("expected_dividend") or {}
    expected_amount = int(expected_dividend.get("auctionApplicantDividendAmount") or 0)
    applicant_creditors = data.get("auction_applicant_creditors") or []
    if _has_duplicate_auction_case(related_cases):
        lines.append("중복경매 신청 사건이 확인되므로, 단순 무잉여를 이유로 한 절차 기각 가능성은 낮습니다.")
    elif expected_dividend.get("auctionApplicantDividendFound") and expected_amount > 0:
        lines.append("경매신청채권자는 배당을 받을 수 있으므로 무잉여 가능성은 없습니다.")
    elif rc._base_right_creditor_is_auction_applicant(base_right, applicant_creditors):
        lines.append("최선순위 설정권자와 경매신청채권자가 동일하여 우선 배당 가능성이 높으므로 무잉여 가능성은 없습니다.")
    else:
        lines.append(rc.build_no_surplus_judgment_text(data, rights, base_right))

    case_text = ", ".join(
        f"{c.get('type', '관련사건')} {c.get('caseNumber', '')}".strip()
        for c in related_cases
    )
    if case_text:
        lines.append(f"관련 사건은 {case_text}입니다.")
    return "\n".join(lines)


def _format_percent(value: float) -> str:
    if abs(value - round(value)) < 0.05:
        return f"{round(value)}%"
    return f"{value:.1f}%"


def _has_duplicate_auction_case(related_cases: list[dict]) -> bool:
    for case in related_cases or []:
        if "중복" in str(case.get("type") or ""):
            return True
    return False


def _build_special_summary_text(
    data: dict,
    rights: list[dict],
    tenants: list[dict],
    base_right: Optional[dict],
    tenant_texts: list[str],
    tenant_analysis_text: str,
    registered_takeover_texts: list[str],
    management_fee: dict,
    market_data: dict,
    sale_spec_remarks_text: str,
    status_survey_etc_text: str,
    case_notice_text: str,
    data_quality_flags: list[str],
) -> str:
    lines = ["4) 물건별 특이사항"]
    # 크롤링 누락/모듈 상태 문구는 고객용 브리핑에 노출하지 않는다.
    # 누락 여부는 내부 체크 로직에서만 활용하고, 실제 위험 점검 결과만 아래에 표시한다.
    master_issues = _master_special_issue_lines(
        data,
        rights,
        tenant_analysis_text,
        sale_spec_remarks_text,
        status_survey_etc_text,
        case_notice_text,
    )
    lines.extend(master_issues)
    lines.extend(_property_special_issue_lines(
        data,
        rights,
        tenant_texts,
        tenant_analysis_text,
        registered_takeover_texts,
        sale_spec_remarks_text,
        status_survey_etc_text,
        case_notice_text,
    ))
    lines.extend(rc._bid_check_lines(data, tenants, management_fee))
    return "\n".join(lines)


def _tenant_extra_warnings(tenants: list[dict], rights: list[dict], data: dict) -> list[str]:
    warnings: list[str] = []
    if any("임차권등기" in _right_compact_text(right) for right in rights or []):
        warnings.append(
            "등기부상 임차권등기명령에 의한 임차권등기가 있어, 배당요구를 하지 않아도 우선변제권이 유지될 수 있고 "
            "미배당 보증금은 낙찰자에게 인수될 수 있습니다. {등기상 보증금과 배당 여부를 확인하여야 합니다.}"
        )

    for tenant in tenants or []:
        name = tenant.get("name") or "임차인"
        deposit = rc.parse_money(tenant.get("deposit"))
        if deposit > 0 and _looks_small_tenant(data, tenant):
            warnings.append(
            f"{_topic_particle(name)} 보증금 {rc.fmt_money(deposit)} 기준 소액임차인 최우선변제 가능성이 있으므로, "
                "후순위 채권자의 배당재원과 경매신청채권자 배당 여부에 영향을 줄 수 있습니다. "
                "{지역·담보물권 설정시점별 소액보증금 한도와 최우선변제액을 확인하여야 합니다.}"
            )
        if _tenant_data_incomplete(tenant):
            warnings.append(
                f"{name}의 전입일·확정일자·배당요구일 또는 보증금 중 일부가 확인되지 않아 임차권리 인수 여부를 단정할 수 없습니다. "
                "{원본 매각물건명세서, 현황조사서, 전입세대 열람자료로 재확인하여야 합니다.}"
            )
    return _dedupe_lines(warnings)


def _soften_no_takeover_statement(text: str) -> str:
    if "낙찰자에게 인수되는 임차권리는 없습니다" not in str(text or ""):
        return text
    return str(text).replace(
        "낙찰자에게 인수되는 임차권리는 없습니다.",
        "현재 확인된 자료상 낙찰자에게 인수되는 임차권리는 없는 것으로 보이나, 아래 확인사항 반영 후 최종 판단이 필요합니다.",
    ).replace(
        "없으므로,현재",
        "없으므로, 현재",
    )


def _topic_particle(name: str) -> str:
    name = str(name or "임차인")
    last = name[-1]
    if not ("가" <= last <= "힣"):
        return f"{name}는"
    try:
        has_jong = (ord(last) - 0xAC00) % 28 > 0
    except Exception:
        has_jong = False
    return f"{name}{'은' if has_jong else '는'}"


def _subject_particle(word: str) -> str:
    word = str(word or "")
    if not word:
        return "이"
    last = word[-1]
    try:
        has_jong = (ord(last) - 0xAC00) % 28 > 0
    except Exception:
        has_jong = False
    return "이" if has_jong else "가"


def _looks_small_tenant(data: dict, tenant: dict) -> bool:
    deposit = rc.parse_money(tenant.get("deposit"))
    if deposit <= 0:
        return False
    item_text = f"{data.get('item_type') or ''} {data.get('address') or ''}"
    if any(token in item_text for token in ("상가", "점포", "근린생활")):
        return deposit <= 100_000_000
    return deposit <= 165_000_000


def _tenant_data_incomplete(tenant: dict) -> bool:
    if rc._is_no_tenant_record(tenant):
        return False
    return (
        not rc._has_valid_date(tenant.get("moveInDate") or "")
        or not rc._has_valid_date(tenant.get("fixedDate") or "")
        or not rc._has_valid_date(tenant.get("depositClaimDate") or "")
        or rc.parse_money(tenant.get("deposit")) <= 0
    )


def _data_quality_flags(data: dict, rights: list[dict], tenants: list[dict], base_right: Optional[dict]) -> list[str]:
    missing = []
    if not (base_right or {}).get("date"):
        missing.append("말소기준권리")
    if not rights:
        missing.append("등기부 권리내역")
    if tenants and any(_tenant_data_incomplete(tenant) for tenant in tenants):
        missing.append("임차인 전입일·확정일자·배당요구일·보증금")
    if not data.get("sale_spec_dividend_deadline"):
        missing.append("배당요구종기")
    if not missing:
        return []
    return [
        "자료확인: 자동분석 시 "
        + ", ".join(_dedupe_strings(missing))
        + " 항목의 일부를 확인하지 못했습니다. 해당 부분은 원본 서류로 직접 확인하여야 하며, 본 분석은 참고용입니다."
    ]


def _master_special_issue_lines(
    data: dict,
    rights: list[dict],
    tenant_analysis_text: str,
    sale_spec_remarks_text: str,
    status_survey_etc_text: str,
    case_notice_text: str,
) -> list[str]:
    source_text = _source_text_for_special(data, rights, tenant_analysis_text, sale_spec_remarks_text, status_survey_etc_text, case_notice_text)
    return build_special_issue_lines(source_text, verbose=False)


def _source_text_for_special(
    data: dict,
    rights: list[dict],
    tenant_analysis_text: str,
    sale_spec_remarks_text: str,
    status_survey_etc_text: str,
    case_notice_text: str,
) -> str:
    rights_text = " ".join(
        " ".join(str(right.get(key) or "") for key in ("type", "creditor", "note", "status", "rawText"))
        for right in rights or []
    )
    return " ".join(
        str(value or "")
        for value in (
            data.get("item_type"),
            data.get("address"),
            data.get("appraisal_raw"),
            data.get("sale_spec_remarks"),
            data.get("status_survey_etc"),
            data.get("case_notice"),
            data.get("case_document_text"),
            data.get("rights_selector_text"),
            data.get("rights_ocr_text"),
            data.get("tenant_ocr_text"),
            data.get("status_survey_text"),
            tenant_analysis_text,
            sale_spec_remarks_text,
            status_survey_etc_text,
            case_notice_text,
            rights_text,
        )
    )


def _dedupe_lines(lines: list[str]) -> list[str]:
    return dedupe_lines(lines)


def _dedupe_strings(values: list[str]) -> list[str]:
    result = []
    seen = set()
    for value in values:
        key = re.sub(r"\s+", "", value or "")
        if not key or key in seen:
            continue
        seen.add(key)
        result.append(value)
    return result


def _property_special_issue_lines(
    data: dict,
    rights: list[dict],
    tenant_texts: list[str],
    tenant_analysis_text: str,
    registered_takeover_texts: list[str],
    sale_spec_remarks_text: str,
    status_survey_etc_text: str,
    case_notice_text: str,
) -> list[str]:
    issues: list[str] = []
    source_text = " ".join(
        str(value or "")
        for value in (
            data.get("item_type"),
            data.get("address"),
            data.get("appraisal_raw"),
            data.get("sale_spec_remarks"),
            data.get("status_survey_etc"),
            data.get("case_notice"),
            data.get("rights_selector_text"),
            data.get("rights_ocr_text"),
            data.get("tenant_ocr_text"),
            data.get("status_survey_text"),
            sale_spec_remarks_text,
            status_survey_etc_text,
            case_notice_text,
            tenant_analysis_text,
        )
    )
    if any("임차권등기" in (right.get("type") or "") or "임차권등기" in (right.get("rawText") or "") for right in rights):
        issues.append("- 임차권등기: 실제 점유관계와 배당·인수 여부를 원본 문서로 확인해 주시기 바랍니다.")
    if rc._text_has_takeover_tenant("\n".join(tenant_texts + [tenant_analysis_text])):
        issues.append("- 대항력 임차인: 보증금 잔액 인수 가능성을 입찰가 산정에 반영해 주시기 바랍니다.")
    if registered_takeover_texts:
        issues.append("- 선순위 전세권: 배당요구 여부에 따라 낙찰자 인수 가능성이 있으므로 별도 확인이 필요합니다.")
    return issues


__all__ = ["extract_context", "build_opinion_data"]
