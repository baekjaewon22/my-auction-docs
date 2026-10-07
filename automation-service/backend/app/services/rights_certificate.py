# -*- coding: utf-8 -*-
"""
권리분석 보증서 생성 서비스
- 마이옥션 상세 페이지를 기존 입력값으로 파싱
- HTML 템플릿을 렌더링
- Selenium/Chrome CDP printToPDF로 PDF 저장
"""

import base64
import html
import logging
import os
import re
import time
import asyncio
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from typing import Callable, Optional
from urllib.parse import urljoin

import fitz
from PIL import Image, ImageEnhance, ImageOps
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, MSO_AUTO_SIZE, PP_ALIGN
from pptx.util import Inches, Pt
from pptx.oxml.ns import qn
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

from ..core.config import (
    CAPTURE_DIR,
    OUTPUT_DIR,
    SELENIUM_PROFILE_DIR,
    TESSERACT_PATH,
    ensure_dirs,
    load_config,
    settings,
)
from ..core.utils import normalize_myauction_detail_url
from ..models.schemas import ProgressUpdate, ReportRequest
from . import capturer, crawler, pdf_processor
from .special_situations import SPECIAL_SITUATION_RULES
from .selenium_driver import (
    account_profile_dir,
    click_tab_safe,
    create_driver,
    keep_browser_hidden,
    log_detail_page_diagnostics,
    login_myauction,
    navigate_with_retry,
    safe_click,
    wait_document_ready,
    myauction_document_url,
)

try:
    import pytesseract
    if os.path.exists(TESSERACT_PATH):
        pytesseract.pytesseract.tesseract_cmd = TESSERACT_PATH
except ImportError:
    pytesseract = None

logger = logging.getLogger(__name__)

TOTAL_STEPS = 6
BODY_PLACEHOLDER_TOKENS = (
    "{{baseRightDescription}}",
    "{{tenantAnalysisText}}",
    "{{surplusDescription}}",
    "{{miscText}}",
    "{{reviewText}}",
    "{{unpaidManagementFeeText}}",
    "{{saleSpecRemarksText}}",
    "{{statusSurveyEtcText}}",
    "{{미납관리비}}",
    "{{매각물건명세서비고}}",
    "{{현황조사서기타}}",
)
CASE_INFO_PLACEHOLDER_TOKENS = ("{{caseNumber}}", "{{caceNumber}}")
BODY_FONT_SIZE = Pt(11)
PRIORITY_REPAYMENT_FONT_SIZE = Pt(10)
CASE_INFO_FONT_SIZE = Pt(12)
REPORT_MIN_SLIDE_WIDTH = Inches(7.5)
REPORT_MIN_SLIDE_HEIGHT = Inches(10.8)
NARRATIVE_WRAP_WIDTH = 43
NARRATIVE_PAGE_MAX_WEIGHT = 49
NARRATIVE_MAX_BLOCKS_PER_PAGE = 4
NARRATIVE_PANEL_GAP_INCHES = 0.10
NARRATIVE_CONTENT_HEIGHT_INCHES = 4.90
NARRATIVE_BODY_FONT_SIZE = Pt(10)
NO_TENANTS_TEXT = "조사된 임차인이 없으므로, 매수인에게 인수되는 임차권리는 없습니다."
PARTIAL_NO_TENANTS_TEXT = (
    "법원 현황조사서와 매각물건명세서 상 조사된 임차인은 없으므로, 낙찰자에게 인수되는 임차권리는 없습니다."
)

BASE_RIGHT_TYPES = ("근저당권", "근저당", "저당권", "저당", "가압류", "압류", "강제경매", "임의경매")
AUCTION_PROCEDURE_TYPES = ("강제경매", "임의경매", "경매개시결정")
RIGHT_TYPES = (
    "근저당권",
    "근저당",
    "저당권",
    "저당",
    "가압류",
    "압류",
    "강제경매",
    "임의경매",
    "임차권등기",
    "전세권",
    "지상권",
    "지역권",
    "가처분",
    "가등기",
    "소유권이전청구권가등기",
)

# 마이옥션 사건 헤더는 지원명만 표시하는 경우가 있다. 같은 지원명이
# 둘 이상의 본원에 속하는 경우에는 추측하지 않고 원문을 보존한다.
COURT_BRANCH_PARENTS = {
    "고양지원": "의정부지방법원",
    "남양주지원": "의정부지방법원",
    "부천지원": "인천지방법원",
    "성남지원": "수원지방법원",
    "여주지원": "수원지방법원",
    "평택지원": "수원지방법원",
    "안산지원": "수원지방법원",
    "안양지원": "수원지방법원",
    "강릉지원": "춘천지방법원",
    "원주지원": "춘천지방법원",
    "속초지원": "춘천지방법원",
    "영월지원": "춘천지방법원",
    "홍성지원": "대전지방법원",
    "논산지원": "대전지방법원",
    "천안지원": "대전지방법원",
    "서산지원": "대전지방법원",
    "충주지원": "청주지방법원",
    "제천지원": "청주지방법원",
    "영동지원": "청주지방법원",
    "안동지원": "대구지방법원",
    "경주지원": "대구지방법원",
    "김천지원": "대구지방법원",
    "상주지원": "대구지방법원",
    "의성지원": "대구지방법원",
    "영덕지원": "대구지방법원",
    "포항지원": "대구지방법원",
    "대구서부지원": "대구지방법원",
    "부산동부지원": "부산지방법원",
    "부산서부지원": "부산지방법원",
    "마산지원": "창원지방법원",
    "진주지원": "창원지방법원",
    "통영지원": "창원지방법원",
    "밀양지원": "창원지방법원",
    "거창지원": "창원지방법원",
    "목포지원": "광주지방법원",
    "장흥지원": "광주지방법원",
    "순천지원": "광주지방법원",
    "해남지원": "광주지방법원",
    "군산지원": "전주지방법원",
    "정읍지원": "전주지방법원",
    "남원지원": "전주지방법원",
}

SOURCE_TAG_COVERAGE = {
    "registry": {"OWN-02", "OWN-03", "OWN-04", "OWN-06", "OWN-01", "BLD-03"},
    "sale_spec": {"LND-01", "ENC-01", "OWN-02", "BLD-03", "OWN-01", "LIM-05", "LIM-06", "BLD-01", "AGR-01", "CHG-01", "BLD-02", "RED-01", "LND-03"},
    "status_survey": {"LND-01", "ENC-01", "LIM-05", "LIM-06", "BLD-01", "CHG-01", "BLD-02", "LND-03"},
    "case_documents": {"ENC-01", "OWN-03", "OWN-04", "OWN-06", "LIM-07", "DUP-01"},
    "appraisal": {"LND-01", "BLD-01", "BLD-03", "OWN-01", "CHG-01", "BLD-02", "RED-01", "LND-03"},
    "building_register": {"BLD-01", "CHG-01", "BLD-02"},
}

SOURCE_KEYS = (
    "registry", "sale_spec", "status_survey", "case_documents",
    "appraisal", "building_register", "dividend_requests",
)

SOURCE_DISPLAY_NAMES = {
    "registry": "등기 권리내역",
    "sale_spec": "매각물건명세서",
    "status_survey": "현황조사서",
    "case_documents": "문건접수내역",
    "appraisal": "감정평가 기재",
    "building_register": "건축물대장",
    "dividend_requests": "배당요구내역",
}

NARRATIVE_SECTION_TITLES = {
    "권리관계": "권리관계 상세 검토",
    "임차·점유": "임차·점유 및 보증금 인수 검토",
    "물건 위험": "물건·절차상 특이사항",
    "입찰·비용": "비용 부담 및 입찰 전 확인사항",
}
NARRATIVE_IMPACTS = {
    "선순위 전세권": "배당 결과에 따라 전세권 또는 미회수 금액이 인수부담으로 남을 수 있습니다",
    "가처분": "본안 결과와 말소 여부에 따라 취득한 소유권의 안정성에 영향을 줄 수 있습니다",
    "가등기(담보/순위보전)": "가등기의 성격과 순위에 따라 소유권 취득 또는 추가 부담이 달라질 수 있습니다",
    "법정지상권": "토지 사용, 건물 철거 및 지료 부담 가능성이 달라질 수 있습니다",
    "유치권": "점유가 계속되면 인도 시기와 비용에 영향을 줄 수 있습니다",
    "토지 별도등기": "특별매각조건에 따라 별도 권리를 인수하거나 추가 비용이 발생할 수 있습니다",
    "대지권 미등기": "대지사용권, 향후 등기와 담보대출 가능성에 영향을 줄 수 있습니다",
    "공유지분 매각": "우선매수와 공유물분할 절차로 사용·처분 시기와 비용이 달라질 수 있습니다",
    "중복·병합 사건": "매각범위, 배당 및 사건 진행 일정이 달라질 수 있습니다",
    "대항력": "임차보증금의 전부 또는 일부가 낙찰자 인수부담이 될 수 있습니다",
    "전입일·확정일자": "우선변제 순위와 예상 배당액이 달라질 수 있습니다",
    "배당요구": "배당으로 회수되지 않은 보증금이 인수부담으로 남을 수 있습니다",
    "보증금 인수": "입찰가격에서 별도로 공제해야 할 최대 인수금액에 직접 영향을 줍니다",
    "점유자 미상/점유관계": "대항력 판정과 명도 일정·비용을 확정하기 어렵습니다",
    "소유자와의 관계": "임대차의 실체와 배당·인수 판단이 달라질 수 있습니다",
    "문서 간 불일치": "말소기준과 임차·배당 판단 전체의 신뢰도에 영향을 줍니다",
    "명도 난이도": "인도 완료 시기와 협의·집행 비용이 달라질 수 있습니다",
    "위반건축물": "시정명령, 이행강제금 또는 원상복구 비용이 발생할 수 있습니다",
    "토지·건물 일괄매각": "매각에서 제외된 토지·건물의 사용관계와 추가 부담이 달라질 수 있습니다",
    "농지취득자격증명": "증명 발급·제출 여부가 매각허가와 입찰보증금에 영향을 줄 수 있습니다",
    "현황 변경": "공부와 다른 부분의 사용 가능성과 복구비가 달라질 수 있습니다",
    "제시외 건물": "소유관계에 따라 철거·인수·사용 분쟁이 발생할 수 있습니다",
    "맹지/도로 접함": "진입과 건축 가능성, 토지 활용가치에 영향을 줄 수 있습니다",
    "경계 문제": "침범·월경 여부에 따라 사용면적과 분쟁비용이 달라질 수 있습니다",
    "재개발·재건축": "조합원 지위, 현금청산 및 추가분담금 가능성이 달라질 수 있습니다",
    "무잉여": "경매 절차가 취소·기각되어 입찰 일정이 무산될 수 있습니다",
    "취하 가능성": "매각기일 전 사건이 종료되어 입찰이 진행되지 않을 수 있습니다",
    "체납관리비": "실제 승계 범위가 총 취득원가와 명도 협의에 영향을 줍니다",
    "명도비용": "낙찰 후 자금계획과 인도 완료 시기에 영향을 줍니다",
    "부대비용(취득세 등)": "취득세·등기비용 등을 포함한 총투입금액이 달라집니다",
    "매각불허가 사유": "매각허가 여부와 입찰보증금 반환·몰수 위험에 영향을 줄 수 있습니다",
    "입찰보증금 특례(재매각)": "입찰 당일 준비해야 할 보증금 규모가 달라집니다",
    "신탁등기": "처분 권한과 집행 근거에 따라 소유권 취득의 유효성 및 절차가 달라질 수 있습니다",
    "대위변제 위험": "말소기준이 바뀌면 임차인의 선후순위와 보증금 인수 범위가 달라질 수 있습니다",
    "분묘기지권": "토지 사용 범위와 개장 절차, 지료 및 이장 비용에 영향을 줄 수 있습니다",
}
NARRATIVE_ACTIONS = {
    "선순위 전세권": "전세권 설정계약, 배당요구 여부와 예상배당액을 원본으로 대조하십시오",
    "가처분": "피보전권리, 본안사건 진행상태와 매각 후 말소 여부를 확인하십시오",
    "가등기(담보/순위보전)": "등기원인, 청산절차와 본등기 가능성을 확인하십시오",
    "법정지상권": "토지·건물의 종전 소유관계, 신축시점과 철거특약을 확인하십시오",
    "유치권": "신고·배제신청, 점유 개시시점과 공사대금 채권 증빙을 확인하십시오",
    "토지 별도등기": "토지 등기와 매각물건명세서의 인수 특별조건을 함께 확인하십시오",
    "대지권 미등기": "대지지분, 감정가 포함 여부와 향후 등기 가능성을 확인하십시오",
    "공유지분 매각": "지분비율, 공유자 우선매수 신고와 실제 점유·사용관계를 확인하십시오",
    "중복·병합 사건": "관련 사건 기록과 최신 매각범위·배당관계를 확인하십시오",
    "대항력": "전입일뿐 아니라 실제 점유 지속 여부와 말소기준 순위를 원본으로 확인하십시오",
    "전입일·확정일자": "전입세대자료와 확정일자 부여내역을 원본으로 대조하십시오",
    "배당요구": "배당요구 접수일, 종기 준수와 예상배당액을 확인하십시오",
    "보증금 인수": "예상배당표를 작성하고 확인 전에는 보증금 전액을 최대 노출액으로 반영하십시오",
    "점유자 미상/점유관계": "현장 방문과 전입세대·사업자등록 열람으로 실제 점유자를 확인하십시오",
    "소유자와의 관계": "임대차계약, 보증금 지급자료와 가족·고용 등 관계를 확인하십시오",
    "문서 간 불일치": "최신 등기, 매각물건명세서와 현황조사서를 항목별로 다시 대조하십시오",
    "명도 난이도": "점유자 수와 협의 가능성, 인도명령·강제집행 예상범위를 확인하십시오",
    "위반건축물": "건축물대장과 관할 건축과에서 위반 내용·시정 및 비용을 확인하십시오",
    "토지·건물 일괄매각": "매각목록과 감정평가서에서 포함·제외 대상을 확인하십시오",
    "농지취득자격증명": "관할 행정기관에 발급 가능성과 제출기한을 확인하십시오",
    "현황 변경": "건축물대장·도면과 현장을 대조하고 복구 가능성을 확인하십시오",
    "제시외 건물": "소유자, 매각 포함 여부와 철거·사용 조건을 확인하십시오",
    "맹지/도로 접함": "지적도·현황도로와 건축허가상 접도요건을 확인하십시오",
    "경계 문제": "필요하면 지적현황측량으로 실제 경계를 확인하십시오",
    "재개발·재건축": "정비사업 단계, 조합원 지위와 추가분담금을 확인하십시오",
    "무잉여": "선순위채권 잔액과 집행비용을 반영해 잉여액을 다시 계산하십시오",
    "취하 가능성": "입찰 직전 법원 사건 진행상태와 취하서 접수 여부를 확인하십시오",
    "체납관리비": "관리사무소 최신 내역에서 공용·전유·연체료와 기준일을 구분하십시오",
    "명도비용": "현장 점유를 확인한 뒤 협의비와 강제집행 예납비용을 별도로 산정하십시오",
    "부대비용(취득세 등)": "취득 목적과 보유현황에 맞춘 세율로 총투입금액을 다시 계산하십시오",
    "매각불허가 사유": "특별매각조건과 제출서류·보증금 조건을 입찰 전에 확인하십시오",
    "입찰보증금 특례(재매각)": "매각공고의 보증금률과 준비금액을 확인하십시오",
}
NARRATIVE_JUDGMENTS = {
    "선순위 전세권": "말소기준보다 앞선 전세권은 배당요구와 배당 결과에 따라 인수 여부가 달라집니다",
    "가처분": "동일일 또는 선순위 가처분은 접수순위와 본안 결과 확인 전까지 소멸 여부를 확정할 수 없습니다",
    "가등기(담보/순위보전)": "가등기의 성격과 순위가 확인되기 전에는 본등기 또는 인수 가능성을 배제할 수 없습니다",
    "유치권": "신고 사실만으로 유치권 성립이 확정되지는 않으며 점유와 피담보채권을 따로 검증해야 합니다",
    "대항력": "전입일과 실제 점유가 말소기준보다 앞서는지에 따라 대항력 및 인수 여부가 달라집니다",
    "전입일·확정일자": "우선변제권의 성립과 순위는 전입·점유·확정일자의 요건을 함께 확인해야 합니다",
    "배당요구": "배당요구의 제출 및 종기 준수 여부를 확인하기 전에는 배당 효과를 확정할 수 없습니다",
    "보증금 인수": "선순위 대항력과 실제 배당액이 확정되기 전에는 인수액을 확정할 수 없습니다",
    "체납관리비": "기재된 총액과 낙찰자가 실제 부담할 범위는 동일하지 않을 수 있어 항목별 구분이 필요합니다",
}
EXTRA_NARRATIVE_SPECIAL_CODES = {"OWN-03", "LIM-07", "LND-03"}
BASELINE_NARRATIVE_CHECKS = {"부대비용(취득세 등)"}


async def generate_rights_certificate(
    request: ReportRequest,
    progress_callback: Optional[Callable] = None,
    task_id: Optional[str] = None,
) -> dict:
    ensure_dirs()

    def emit(step: int, title: str, message: str, status: str = "running", percent: float = 0.0):
        if progress_callback:
            try:
                update = ProgressUpdate(
                    step=step,
                    total_steps=TOTAL_STEPS,
                    title=title,
                    message=message,
                    status=status,
                    percent=percent,
                )
                if asyncio.iscoroutinefunction(progress_callback):
                    try:
                        loop = asyncio.get_event_loop()
                        if loop.is_running():
                            loop.create_task(progress_callback(update))
                        else:
                            asyncio.run(progress_callback(update))
                    except RuntimeError:
                        pass
                else:
                    progress_callback(update)
            except Exception:
                pass
        logger.info(f"[권리분석 보증서 {step}/{TOTAL_STEPS}] {title}: {message}")

    input_url = (request.url or "").strip()
    url = normalize_myauction_detail_url(input_url, request.myauction_id)
    logger.info(f"[권리분석 보증서] 입력 URL: {input_url}")
    logger.info(f"[권리분석 보증서] URL 정규화 결과: {url}")
    logger.info(
        "[권리분석 보증서] URL 정규화 상세: "
        f"view_to_view3={'/view/' in input_url and '/view3/' not in input_url}, "
        f"myauction_id_appended={bool(request.myauction_id and request.myauction_id.strip() and request.myauction_id.strip() in url)}, "
        f"final_url={url}"
    )

    profile_dir = account_profile_dir(request.myauction_id) if request.remember_login else ""
    logger.info(
        f"[권리분석 보증서] Chrome profile 선택: remember_login={request.remember_login}, "
        f"profile_dir={profile_dir or '(임시/비저장 프로필)'}"
    )

    driver = None
    try:
        emit(0, "브라우저 준비", "Chrome 시작 중...", percent=5)
        driver = create_driver(profile_dir=profile_dir, headless=True)

        emit(1, "물건정보 확인", "마이옥션 로그인 중...", percent=15)
        login_myauction(driver, request.myauction_id, request.myauction_pw)

        emit(1, "물건정보 확인", "상세 페이지 접속 및 기본정보 확인 중...", percent=28)
        navigate_with_retry(driver, url, retries=3)
        wait_document_ready(driver, timeout=30)
        time.sleep(3)
        logger.info(
            f"[권리분석 보증서] 상세 페이지 로드: current_url={driver.current_url}, "
            f"title={driver.title or ''}, html_length={len(driver.page_source or '')}"
        )
        log_detail_page_diagnostics(driver, prefix="권리분석 보증서 상세 진입 직후")

        soup = crawler.fetch_soup_from_driver(driver)
        base_data = crawler.parse_myauction_detail(soup, url, driver=driver)
        emit(2, "매각물건명세서 확인", "등기부현황 및 매각물건명세서 확인 중...", percent=42)
        analysis_context = extract_rights_context(soup, driver=driver, task_id=task_id)
        data = {**base_data, **analysis_context}
        data["author_name"] = str(getattr(request, "author_name", "") or "").strip()
        data["author_title"] = str(getattr(request, "author_title", "") or "").strip()
        data["author_phone"] = str(getattr(request, "author_phone", "") or "").strip()

        emit(3, "권리분석 문구", "말소기준권리/임차인/특이사항 문구 구성 중...", percent=55)
        template_data = build_template_data(data)

        safe_task_id = re.sub(r"[^0-9A-Za-z._-]", "_", task_id or datetime.now().strftime("%Y%m%d_%H%M%S"))
        certificate_stem = _rights_certificate_filename_stem(
            template_data.get("caseNumber") or data.get("case_number") or safe_task_id
        )
        pptx_template = Path(getattr(settings, "rights_certificate_pptx_template", ""))

        if pptx_template.exists():
            emit(4, "보증서 템플릿", "PPT 보증서 템플릿에 변수 입력 중...", percent=70)
            pdf_output_path = OUTPUT_DIR / f"{certificate_stem}.pdf"
            pptx_output_path = pdf_output_path.with_suffix(".pptx")
            render_certificate_pptx_template(pptx_template, pptx_output_path, template_data)

            emit(5, "PDF/PPTX 변환", "보증서 PDF 저장 중...", percent=85)
            if export_pptx_to_pdf(pptx_output_path, pdf_output_path):
                output_path = pdf_output_path
            else:
                output_path = pptx_output_path
                emit(5, "PDF/PPTX 변환", "PDF 변환을 사용할 수 없어 PPTX로 저장했습니다.", percent=90)
        else:
            emit(4, "보증서 템플릿", "HTML 보증서 생성 중...", percent=70)
            html_text = render_certificate_template(settings.rights_certificate_template, template_data)

            html_path = OUTPUT_DIR / f"{certificate_stem}.html"
            output_path = OUTPUT_DIR / f"{certificate_stem}.pdf"

            with open(html_path, "w", encoding="utf-8") as f:
                f.write(html_text)

            emit(5, "PDF/PPTX 변환", "보증서 PDF 저장 중...", percent=85)
            render_html_to_pdf(driver, html_path, output_path)

        emit(6, "저장 완료", "권리분석 보증서 생성 완료", status="completed", percent=100)
        return {
            "success": True,
            "output_file": str(output_path),
            "message": "권리분석 보증서 생성이 완료되었습니다.",
            "data": data,
        }
    except Exception as e:
        logger.exception("권리분석 보증서 생성 실패")
        emit(0, "오류", str(e), status="error", percent=0)
        return {"success": False, "message": str(e)}
    finally:
        if driver:
            try:
                driver.quit()
            except Exception:
                pass


def _task_output_path(base_path: str, task_id: str) -> Path:
    root, ext = os.path.splitext(base_path)
    return Path(f"{root}_{task_id}{ext or '.pdf'}")


def _rights_certificate_filename_stem(case_number: str) -> str:
    safe_case_number = _safe_filename_part(case_number) or datetime.now().strftime("%Y%m%d_%H%M%S")
    return f"권리분석_보증서_{safe_case_number}"


def _safe_filename_part(value: str) -> str:
    text = re.sub(r"\s+", "", str(value or "")).strip()
    text = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', "_", text)
    text = text.strip(" ._-")
    if text in ("", "담당자확인필요", "사건번호미확인"):
        return ""
    return text[:80]


def extract_rights_context(soup, driver=None, task_id: Optional[str] = None) -> dict:
    selector_fields = _extract_selector_fields(soup)
    rights_ocr_context = extract_rights_context_by_ocr(driver, task_id=task_id) if driver else {}
    html_rights = _extract_rights(soup)
    rights = merge_rights(html_rights, rights_ocr_context.get("rights") or [])
    registry_summary_complete = _structured_registry_summary_complete(soup, html_rights)
    ocr_context = extract_tenant_context_by_ocr(driver, task_id=task_id) if driver else {}
    status_survey_context = extract_status_survey_context_by_ocr(driver, task_id=task_id) if driver else {}
    case_document_text = collect_case_document_text(driver) if driver else ""
    html_tenants = _extract_tenants(soup)
    tenants = ocr_context.get("tenants") or html_tenants
    dividend_requests = _extract_dividend_requests(soup)
    related_cases = _extract_related_cases(soup)
    auction_applicant_creditors = _extract_auction_applicant_creditors(soup, selector_fields.get("case_number") or "")
    expected_dividend = _extract_expected_dividend(
        soup,
        selector_fields.get("case_number") or "",
        auction_applicant_creditors,
    )
    management_fee = _extract_management_fee(soup)
    market_data = _extract_market_data(soup)
    myungseung_analysis = _extract_myungseung_rights_analysis(soup)
    sale_spec_incomplete = ocr_context.get("_sale_spec_incomplete")
    if sale_spec_incomplete is None:
        sale_spec_incomplete = bool(ocr_context.get("_incomplete") or ocr_context.get("_timed_out"))
    source_incomplete = {
        "registry": bool(
            not registry_summary_complete
            and (rights_ocr_context.get("_incomplete") or rights_ocr_context.get("_timed_out"))
        ),
        "sale_spec": bool(sale_spec_incomplete),
        "status_survey": bool(status_survey_context.get("_incomplete")),
        "case_documents": False,
        "dividend_requests": False,
        "appraisal": False,
        "building_register": False,
    }
    source_completeness = {
        "registry": registry_summary_complete or rights_ocr_context.get("_source_complete") is True,
        "sale_spec": ocr_context.get("_sale_spec_complete") is True,
        "status_survey": status_survey_context.get("_source_complete") is True,
        "case_documents": False,
        "dividend_requests": False,
        "appraisal": False,
        "building_register": False,
    }
    source_collected = {
        "registry": bool(
            html_rights
            or rights_ocr_context.get("rights_ocr_text")
            or rights_ocr_context.get("rights_ocr_images")
        ),
        "sale_spec": bool(
            _document_text_is_available(ocr_context.get("sale_spec_ocr_text") or "")
            or ocr_context.get("sale_spec_ocr_images")
            or ocr_context.get("sale_spec_base_right")
            or ocr_context.get("sale_spec_dividend_deadline")
            or ocr_context.get("sale_spec_remarks")
        ),
        "status_survey": bool(status_survey_context.get("status_survey_text")),
        "case_documents": bool(case_document_text),
        "dividend_requests": bool(dividend_requests) or _has_table_containing(soup, "배당"),
        "appraisal": False,
        "building_register": False,
    }
    source_status = {
        source: {
            "collected": source_collected[source],
            "complete": source_completeness[source],
            "failed": source_incomplete[source],
        }
        for source in SOURCE_KEYS
    }
    context = {
        "rights": rights,
        "rights_ocr_text": rights_ocr_context.get("rights_ocr_text", ""),
        "rights_ocr_images": rights_ocr_context.get("rights_ocr_images", []),
        "tenants": tenants,
        "tenant_source": ocr_context.get("tenant_source", ""),
        "tenant_ocr_text": ocr_context.get("tenant_ocr_text", ""),
        "tenant_ocr_images": ocr_context.get("tenant_ocr_images", []),
        "sale_spec_ocr_text": ocr_context.get("sale_spec_ocr_text", ""),
        "sale_spec_ocr_images": ocr_context.get("sale_spec_ocr_images", []),
        "tenant_status_text": ocr_context.get("tenant_status_text", ""),
        "sale_spec_base_right": ocr_context.get("sale_spec_base_right") or {},
        "sale_spec_dividend_deadline": ocr_context.get("sale_spec_dividend_deadline") or "",
        "sale_spec_remarks": ocr_context.get("sale_spec_remarks", ""),
        "status_survey_etc": status_survey_context.get("status_survey_etc") or _extract_status_survey_etc_from_text(soup.get_text("\n", strip=True)),
        "status_survey_text": status_survey_context.get("status_survey_text", ""),
        "case_document_text": case_document_text,
        "dividend_requests": dividend_requests,
        "related_cases": related_cases,
        "auction_applicant_creditors": auction_applicant_creditors,
        "expected_dividend": expected_dividend,
        "management_fee": management_fee,
        "market_data": market_data,
        "myungseung_analysis": myungseung_analysis,
        "source_completeness": source_completeness,
        "source_collected": source_collected,
        "source_status": source_status,
        "source_incomplete": source_incomplete,
        "source_collection_incomplete": bool(
            any(source_incomplete.values())
        ),
    }
    context.update(selector_fields)
    return context


def _extract_selector_fields(soup) -> dict:
    case_number = _css_text(
        soup,
        "#header_detailz > h2 > strong > span",
        "#header_detail2 > h2 > strong > span",
        "#header_detail > h2 > strong > span",
    )
    court = _clean_court_label(_css_text(soup, "#dtl_table > table > tbody > tr:nth-child(2) > td > ul > li:nth-child(1)"))
    case_notice = _extract_case_notice(soup)
    selector_base_right = _extract_selector_base_right(soup)

    fields = {}
    if case_number:
        fields["case_number"] = case_number
    if court:
        fields["court"] = court
    if case_notice:
        fields["case_notice"] = case_notice
    if selector_base_right:
        fields["selector_base_right"] = selector_base_right
    return fields


def _extract_myungseung_rights_analysis(soup) -> list[dict]:
    """Read only the dedicated 법무법인 명승 analysis section.

    The page repeats ``id=dtl_stock``.  Scoping from the exact section heading
    prevents unrelated tables (including related cases and expected dividends)
    from being reported as the law firm's analysis.
    """
    results: list[dict] = []
    for stock in soup.find_all("div", id="dtl_stock"):
        heading = stock.select_one("div#dtl_title > h3") or stock.find("h3")
        heading_text = re.sub(r"\s+", " ", heading.get_text(" ", strip=True) if heading else "").strip()
        if heading_text != "법무법인 명승 권리분석":
            continue
        for row in stock.select(".excmt table.tbl_excmt tr"):
            label_node = row.find("th")
            value_node = row.find("td")
            label = re.sub(r"\s+", " ", label_node.get_text(" ", strip=True) if label_node else "").strip()
            value = re.sub(r"\s+", " ", value_node.get_text(" ", strip=True) if value_node else "").strip()
            if not value:
                continue
            results.append({
                "label": label or "검토의견",
                "text": value,
                "source": "마이옥션 상세페이지 내 법무법인 명승 권리분석",
            })
    return _dedupe_by(results, ("label", "text", "source"))


def _extract_selector_base_right(soup) -> dict:
    row = None
    try:
        row = soup.select_one("#dtl_table > table > tbody > tr:nth-child(3)")
    except Exception:
        row = None
    if not row:
        return {}

    cells = [
        re.sub(r"\s+", " ", cell.get_text(" ", strip=True)).strip()
        for cell in row.find_all(["th", "td"], recursive=False)
    ]
    row_text = re.sub(r"\s+", " ", row.get_text(" ", strip=True)).strip()
    compact = re.sub(r"\s+", "", row_text)
    if not row_text or not any(token in compact for token in ("최선순위", "말소기준", "소멸기준", "근저당", "가압류", "압류", "강제경매", "임의경매")):
        return {}

    date = normalize_date(_first_any_date(row_text) or "")
    right_type = _first_match(row_text, RIGHT_TYPES) or _guess_right_type_after_date(row_text, date)
    creditor = ""

    for cell in cells:
        if not date and _first_any_date(cell):
            date = normalize_date(_first_any_date(cell))
        if not right_type and _first_match(cell, RIGHT_TYPES):
            right_type = _first_match(cell, RIGHT_TYPES)

    red_text = _css_text(soup, "#dtl_table > table > tbody > tr:nth-child(3) > td.dtn_red")
    if red_text:
        if not date and _first_any_date(red_text):
            date = normalize_date(_first_any_date(red_text))
        red_type = _first_match(red_text, RIGHT_TYPES) or _guess_right_type_after_date(red_text, date)
        if red_type:
            right_type = red_type

    for idx in (3, 2, 1):
        if idx < len(cells):
            candidate = _clean_creditor_candidate(cells[idx])
            if candidate and not _first_any_date(candidate) and not _first_match(candidate, RIGHT_TYPES):
                creditor = candidate
                break

    if not date:
        return {}
    return {
        "date": date,
        "type": right_type or "권리종류 확인 필요",
        "creditor": creditor,
        "isBaseRight": True,
        "rawText": row_text,
        "source": "dtl_table_selector",
    }


def _extract_case_notice(soup) -> str:
    text = _css_text(soup, "#dtl_table > table > tbody > tr:nth-child(1) > td")
    if not text:
        return ""
    text = re.sub(r"^(?:주의사항|특이사항|비고)\s*[:：\-]?\s*", "", text).strip()
    return _clean_document_note(text, limit=500)


def _clean_court_label(value: str) -> str:
    text = re.sub(r"\s+", " ", value or "").strip()
    if not text:
        return ""

    # 상세 헤더 뒤의 경매계·사건번호·연락처만 제거하고 본원/지원명은
    # 유지한다. 기존처럼 첫 '법원'에서 자르면 '수원지방법원 안양지원'이
    # '수원지방법원'으로 축약된다.
    text = re.split(
        r"\s+경매\s*\d+\s*계\b|\s+\d{4}\s*타경\s*\d+\b|\s*\[[^\]]+\]\s*$",
        text,
        maxsplit=1,
    )[0].strip()

    full_match = re.match(
        r"^(.+?지방법원(?:\s+(?:본원|[가-힣A-Za-z0-9·]+지원))?)\b",
        text,
    )
    if full_match:
        return full_match.group(1).strip()

    branch_match = re.match(r"^([가-힣A-Za-z0-9·]+지원)\b", text)
    if branch_match:
        branch = branch_match.group(1)
        parent = COURT_BRANCH_PARENTS.get(branch)
        if parent:
            return f"{parent} {branch}"
        return branch

    text = re.split(
        r"\s*/\s*|\(\s*\d{2,4}-\d{2,4}\s*\)|\b\d{2,4}-\d{2,4}\b|"
        r"서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시|"
        r"경기도|강원특별자치도|충청북도|충청남도|전북특별자치도|전라남도|경상북도|경상남도|제주특별자치도",
        text,
        maxsplit=1,
    )[0]
    return text.strip(" /,")


def _has_table_containing(soup, keyword: str) -> bool:
    if soup is None:
        return False
    return any(keyword in table.get_text(" ", strip=True) for table in soup.find_all("table"))


def _document_text_is_available(value: str) -> bool:
    compact = re.sub(r"\s+", "", str(value or ""))
    if not compact:
        return False
    return not any(token in compact for token in ("준비중입니다", "자료준비중", "서비스준비중"))


def _source_completeness(data: dict) -> dict[str, bool]:
    """Return explicit per-document completeness; content presence alone is partial."""
    declared = data.get("source_completeness") or {}
    declared_status = data.get("source_status") or {}
    result = {}
    for source in SOURCE_KEYS:
        if isinstance(declared, dict) and source in declared:
            result[source] = declared.get(source) is True
        else:
            status = declared_status.get(source) if isinstance(declared_status, dict) else None
            status_complete = (
                status == "complete"
                or (isinstance(status, dict) and status.get("complete") is True)
            )
            result[source] = status_complete or data.get(f"{source}_source_complete") is True
    incomplete = data.get("source_incomplete") or {}
    if isinstance(incomplete, dict):
        for source, failed in incomplete.items():
            if failed and source in result:
                result[source] = False
    if isinstance(declared_status, dict):
        for source, status in declared_status.items():
            status_failed = status == "failed" or (
                isinstance(status, dict) and status.get("failed") is True
            )
            if status_failed and source in result:
                result[source] = False
    if data.get("source_collection_incomplete") and not incomplete:
        # Legacy/global failure flags cannot identify the affected source.
        result = {source: False for source in result}
    return result


def _source_states(data: dict) -> dict[str, dict[str, bool | str]]:
    """Separate source presence from verified completeness and collection failure.

    A document can be collected and useful as positive evidence while still being
    incomplete for absence-based conclusions.  Only ``complete`` enables those
    conclusions; ``partial`` material remains available for factual narration.
    """
    completeness = _source_completeness(data)
    declared_status = data.get("source_status") or {}
    declared_collected = data.get("source_collected") or {}
    incomplete = data.get("source_incomplete") or {}
    global_failed = bool(data.get("source_collection_incomplete") and not incomplete)
    result: dict[str, dict[str, bool | str]] = {}
    for source in SOURCE_KEYS:
        status = declared_status.get(source) if isinstance(declared_status, dict) else None
        if isinstance(status, dict):
            status_collected = status.get("collected") is True
            status_failed = status.get("failed") is True
        else:
            status_collected = status in {"complete", "partial", "collected"}
            status_failed = status == "failed"
        explicit_collected = (
            isinstance(declared_collected, dict)
            and declared_collected.get(source) is True
        ) or data.get(f"{source}_source_collected") is True
        failed = global_failed or status_failed or (
            isinstance(incomplete, dict) and incomplete.get(source) is True
        )
        collected = (
            completeness[source]
            or status_collected
            or explicit_collected
            or _infer_source_collected(data, source)
        )
        complete = bool(completeness[source] and not failed)
        state = "complete" if complete else "partial" if collected else "failed" if failed else "missing"
        result[source] = {
            "state": state,
            "collected": bool(collected),
            "complete": complete,
            "failed": bool(failed),
        }
    return result


def _infer_source_collected(data: dict, source: str) -> bool:
    if source == "registry":
        return bool(
            data.get("rights")
            or str(data.get("rights_ocr_text") or "").strip()
            or data.get("rights_ocr_images")
            or (data.get("selector_base_right") or {}).get("date")
        )
    if source == "sale_spec":
        return bool(
            str(data.get("sale_spec_text") or "").strip()
            or str(data.get("sale_spec_remarks") or "").strip()
            or (data.get("sale_spec_base_right") or {}).get("date")
            or data.get("sale_spec_dividend_deadline")
        )
    if source == "status_survey":
        return bool(
            str(data.get("status_survey_text") or "").strip()
            or str(data.get("status_survey_etc") or "").strip()
        )
    if source == "case_documents":
        return bool(str(data.get("case_document_text") or "").strip())
    if source == "appraisal":
        return bool(str(data.get("appraisal_raw") or data.get("appraisal_text") or "").strip())
    if source == "building_register":
        return bool(
            str(data.get("building_register_text") or "").strip()
            or data.get("building_register_images")
        )
    if source == "dividend_requests":
        return bool(data.get("dividend_requests"))
    return False


def _special_signal_source_codes(completeness: dict[str, bool]) -> set[str]:
    codes: set[str] = set()
    for source, source_codes in SOURCE_TAG_COVERAGE.items():
        if completeness.get(source):
            codes.update(source_codes)
    return codes


def build_template_data(data: dict) -> dict:
    try:
        cfg = load_config()
    except Exception:
        cfg = {}
    rights = data.get("rights") or []
    tenants = data.get("tenants") or []
    valid_tenants = [tenant for tenant in tenants if not _is_no_tenant_record(tenant)]
    dividend_requests = data.get("dividend_requests") or []
    related_cases = data.get("related_cases") or []
    management_fee = data.get("management_fee") or {}
    market_data = data.get("market_data") or {}
    source_completeness = _source_completeness(data)
    tenant_source_complete = bool(
        source_completeness["sale_spec"] or source_completeness["status_survey"]
    )
    explicit_survey_no_tenant = _tenant_ocr_text_confirms_no_surveyed_tenants(
        data.get("tenant_ocr_text") or ""
    )
    tenant_conclusion_complete = tenant_source_complete or (
        explicit_survey_no_tenant and not valid_tenants
    )

    registry_base_right = find_base_right(rights)
    sale_spec_base_right = data.get("sale_spec_base_right") or {}
    selector_base_right = data.get("selector_base_right") or {}
    if sale_spec_base_right.get("date"):
        base_right = sale_spec_base_right
    elif selector_base_right.get("date"):
        base_right = selector_base_right
    else:
        base_right = registry_base_right
    base_right = enrich_base_right_from_registry(base_right, rights)
    dividend_deadline = data.get("sale_spec_dividend_deadline") or ""
    tenant_texts = analyze_tenants(
        valid_tenants,
        base_right,
        dividend_requests,
        dividend_deadline,
        data.get("address") or "",
        tenant_source_complete=tenant_conclusion_complete,
    )
    registered_takeover_texts = analyze_registered_takeover_rights(
        rights,
        base_right,
        dividend_requests,
        dividend_request_source_complete=source_completeness["dividend_requests"],
    )
    misc_items = build_misc_items(valid_tenants, management_fee, market_data)
    review_items = build_review_items(rights, valid_tenants, management_fee)
    unpaid_management_fee_text = build_unpaid_management_fee_text(management_fee)
    sale_spec_remarks_text = _polite_optional_note(
        data.get("sale_spec_remarks"),
        "매각물건명세서 비고란에 별도로 기재된 사항은 없습니다.",
    )
    status_survey_etc_text = _polite_optional_note(
        data.get("status_survey_etc"),
        "현황조사서 기타란에 별도로 기재된 사항은 없습니다.",
    )
    case_notice_text = _clean_document_note(data.get("case_notice"), limit=500)
    created_date = format_korean_date(datetime.now())
    case_number = data.get("case_number") or "담당자 확인 필요"
    base_right_date = base_right.get("date") if base_right else "담당자 확인 필요"
    base_right_type = base_right.get("type") if base_right else "등기부 원본 확인"
    base_right_description = data.get("base_right_description") or build_base_right_description(
        base_right,
        rights,
        registered_takeover_texts,
        registry_source_complete=source_completeness["registry"],
    )
    tenant_analysis_text = build_tenant_analysis_text(
        tenants,
        tenant_texts,
        data.get("tenant_ocr_text") or "",
        data.get("tenant_source") or "",
        tenant_source_complete=tenant_conclusion_complete,
    )
    if registered_takeover_texts:
        tenant_analysis_text = combine_tenant_and_registered_takeover_texts(
            tenant_analysis_text,
            registered_takeover_texts,
        )
    surplus_description = analyze_surplus(
        data,
        rights,
        base_right,
        related_cases,
        rights_source_complete=source_completeness["registry"],
    )
    no_tenants = tenant_analysis_text == NO_TENANTS_TEXT
    tenant_analyses = [] if no_tenants else [
        {"description": block.strip()}
        for block in tenant_analysis_text.split("\n\n")
        if block.strip()
    ]

    try:
        from .rights_checklist import build_checklist_from_pipeline
    except ImportError:  # 단독 실행 대비
        from rights_checklist import build_checklist_from_pipeline
    raw_signal_texts = [
        data.get("rights_ocr_text") or "",
        data.get("tenant_ocr_text") or "",
        data.get("sale_spec_remarks") or "",
        data.get("status_survey_text") or "",
        data.get("status_survey_etc") or "",
        data.get("case_notice") or "",
        data.get("case_document_text") or "",
        data.get("appraisal_raw") or "",
        data.get("property_overview") or "",
        *[
            str(item.get("text") or "")
            for item in (data.get("myungseung_analysis") or [])
            if isinstance(item, dict)
        ],
    ]
    explicit_no_tenant = (
        (bool(tenants) and all(_is_no_tenant_record(tenant) for tenant in tenants))
        or _tenant_ocr_text_indicates_no_tenants(data.get("tenant_ocr_text") or "")
    )
    tenant_source_confirmed = tenant_conclusion_complete and bool(
        explicit_no_tenant or valid_tenants
    )
    signal_source_codes = _special_signal_source_codes(source_completeness)
    signal_source_confirmed = bool(signal_source_codes)
    checklist_tenants = []
    for tenant in valid_tenants:
        enriched_tenant = dict(tenant)
        matched_request = _find_dividend_request(tenant.get("name") or "", dividend_requests)
        if matched_request and not enriched_tenant.get("depositClaimDate"):
            enriched_tenant["depositClaimDate"] = matched_request.get("requestDate") or ""
        if not enriched_tenant.get("depositDeadline"):
            enriched_tenant["depositDeadline"] = (
                dividend_deadline or (matched_request or {}).get("deadline") or ""
            )
        checklist_tenants.append(enriched_tenant)
    checklist_items = build_checklist_from_pipeline(
        data=data, rights=rights, base_right=base_right, valid_tenants=checklist_tenants,
        management_fee=management_fee, surplus_description=surplus_description,
        texts=raw_signal_texts,
        tenant_source_confirmed=tenant_source_confirmed,
        signal_source_confirmed=signal_source_confirmed,
        rights_source_confirmed=source_completeness["registry"],
        signal_source_codes=signal_source_codes,
    )
    narrative_report = build_narrative_report(
        checklist_items,
        data=data,
        rights=rights,
        base_right=base_right,
        tenants=valid_tenants,
        management_fee=management_fee,
        raw_signal_texts=raw_signal_texts,
        created_date=created_date,
    )

    return {
        "caseNumber": case_number,
        "caceNumber": case_number,
        "court": _clean_court_label(data.get("court")) or "담당자 확인 필요",
        "propertyType": data.get("item_type") or "담당자 확인 필요",
        "propertyOverview": data.get("property_overview") or "",
        "물건개요": data.get("property_overview") or "",
        "appraisalValue": data.get("appraised_price") or "담당자 확인 필요",
        "minBidPrice": data.get("min_price") or "담당자 확인 필요",
        "bidDate": data.get("auction_date") or "담당자 확인 필요",
        "입찰기일": data.get("auction_date") or "담당자 확인 필요",
        "authorName": data.get("author_name") or cfg.get("author_name") or "담당자",
        "authorTitle": data.get("author_title") or cfg.get("author_title") or "",
        "authorPhone": data.get("author_phone") or cfg.get("author_phone") or "",
        "createdDate": created_date,
        "createDate": created_date,
        "baseRightDate": base_right_date,
        "baseRightType": base_right_type,
        "baseRightCreditor": base_right.get("creditor") if base_right else "",
        "baseRightDescription": base_right_description,
        "registeredRightCount": len(substantive_registered_rights(rights)),
        "registeredRightAmountTotal": registered_right_amount_total(rights),
        "auctionProcedureCount": len(auction_procedure_entries(rights)),
        "tenantAnalysisText": tenant_analysis_text,
        "tenantOcrText": data.get("tenant_ocr_text") or "",
        "tenantAnalyses": tenant_analyses,
        "noTenants": no_tenants,
        "surplusDescription": surplus_description,
        "miscText": "\n".join(misc_items),
        "miscItems": misc_items,
        "unpaidManagementFeeText": unpaid_management_fee_text,
        "saleSpecRemarksText": sale_spec_remarks_text,
        "statusSurveyEtcText": status_survey_etc_text,
        "caseNoticeText": case_notice_text,
        "caseDocumentText": data.get("case_document_text") or "",
        "미납관리비": unpaid_management_fee_text,
        "매각물건명세서비고": sale_spec_remarks_text,
        "현황조사서기타": status_survey_etc_text,
        "주의사항": case_notice_text,
        "hasUnpaidFee": int(management_fee.get("unpaidAmount") or 0) > 0,
        "reviewText": "\n".join(review_items),
        "reviewItems": review_items,
        "narrativePages": narrative_report["pages"],
        "narrativeIssueCount": narrative_report["issueCount"],
        "narrativeReportHtml": narrative_report["html"],
    }


def build_narrative_report(
    items: list,
    *,
    data: dict,
    rights: list[dict],
    base_right: Optional[dict],
    tenants: list[dict],
    management_fee: dict,
    raw_signal_texts: list,
    created_date: str,
) -> dict:
    """Build customer-facing prose while keeping the 32-item engine internal."""
    try:
        from .rights_checklist import State, detect_situation_codes, management_fee_amount_status
    except ImportError:  # 단독 실행 대비
        from rights_checklist import State, detect_situation_codes, management_fee_amount_status

    raw_text = "\n".join(str(value or "") for value in raw_signal_texts if str(value or "").strip())
    detected_codes = detect_situation_codes(raw_text)
    extra_rules = [
        rule for rule in SPECIAL_SITUATION_RULES
        if rule.get("code") in EXTRA_NARRATIVE_SPECIAL_CODES and rule.get("code") in detected_codes
    ]
    visible_checks = [
        item for item in items
        if item.state == State.CHECK and item.name not in BASELINE_NARRATIVE_CHECKS
    ]
    risks = [item for item in items if item.state == State.RISK]

    source_completeness = _source_completeness(data)
    source_states = _source_states(data)
    rights_available = source_completeness["registry"]
    rights_collected = bool(source_states["registry"]["collected"])
    explicit_no_tenant = (
        _tenant_ocr_text_indicates_no_tenants(data.get("tenant_ocr_text") or "")
        or (
            bool(data.get("tenants"))
            and all(_is_no_tenant_record(tenant) for tenant in (data.get("tenants") or []))
        )
    )
    tenant_source_complete = bool(
        source_completeness["sale_spec"] or source_completeness["status_survey"]
    )
    explicit_survey_no_tenant = _tenant_ocr_text_confirms_no_surveyed_tenants(
        data.get("tenant_ocr_text") or ""
    )
    tenant_source_confirmed = bool(
        (tenant_source_complete and (explicit_no_tenant or tenants))
        or (explicit_survey_no_tenant and not tenants)
    )
    tenant_source_collected = bool(
        explicit_no_tenant
        or tenants
        or source_states["sale_spec"]["collected"]
        or source_states["status_survey"]["collected"]
    )
    signal_source_confirmed = bool(_special_signal_source_codes(source_completeness))
    fee_status = management_fee_amount_status(management_fee)
    myungseung_blocks = [
        _myungseung_analysis_block(item)
        for item in (data.get("myungseung_analysis") or [])
        if isinstance(item, dict) and str(item.get("text") or "").strip()
    ]

    summary_blocks = [
        {
            "heading": "종합 판단",
            "body": _narrative_overview_text(
                risks,
                visible_checks,
                extra_rules,
                rights_available=rights_available,
                rights_collected=rights_collected,
                tenant_source_confirmed=tenant_source_confirmed,
                tenant_source_collected=tenant_source_collected,
            ),
            "kind": "risk" if risks or any(rule.get("risk") == "상" for rule in extra_rules) else "neutral",
            "label": "핵심 판단",
        },
        {
            "heading": "권리관계 검토",
            "body": _rights_clean_narrative(
                items,
                rights,
                base_right,
                rights_available,
                signal_source_confirmed,
                rights_collected=rights_collected,
            ),
            "kind": "neutral",
            "label": "검토 결과",
        },
        {
            "heading": "임차·점유 검토",
            "body": _tenant_clean_narrative(
                items,
                tenants,
                base_right,
                tenant_source_confirmed,
                tenant_source_collected=tenant_source_collected,
                explicit_no_tenant=explicit_no_tenant,
            ),
            "kind": "neutral" if tenant_source_confirmed else "residual",
            "label": "검토 결과" if tenant_source_confirmed else "자료 확인",
        },
    ]
    sections = [{"title": "특이사항", "blocks": summary_blocks}]

    if myungseung_blocks:
        sections.append({"title": "법무법인 명승 권리분석", "blocks": myungseung_blocks})

    for category in NARRATIVE_SECTION_TITLES:
        category_items = [
            item for item in [*risks, *visible_checks]
            if item.category == category
        ]
        category_extra = [
            rule for rule in extra_rules
            if _extra_rule_category(str(rule.get("code") or "")) == category
        ]
        if not category_items and not category_extra:
            continue
        blocks = [_narrative_issue_block(item) for item in category_items]
        blocks.extend(_extra_special_block(rule) for rule in category_extra)
        sections.append({"title": NARRATIVE_SECTION_TITLES[category], "blocks": blocks})

    final_blocks = [{
        "heading": "비용 부담 검토",
        "body": _cost_narrative(management_fee, fee_status),
        "kind": "check" if fee_status == "confirmed" else "neutral",
        "label": "비용 검토",
    }]
    status_survey_block = _status_survey_review_block(data)
    if status_survey_block:
        final_blocks.insert(1, status_survey_block)
    final_action = _final_action_narrative(risks, visible_checks, extra_rules)
    if final_action:
        final_blocks.append({
            "heading": "입찰 전 확인사항",
            "body": final_action,
            "kind": "scope",
            "label": "최종 확인",
        })
    sections.append({"title": "입찰 전 검토", "blocks": final_blocks})

    pages = _paginate_narrative_sections(sections)
    case_number = data.get("case_number") or "담당자 확인 필요"
    report_html = _render_narrative_report_html(pages, case_number, created_date)
    return {
        "pages": pages,
        "issueCount": len(risks) + len(visible_checks) + len(extra_rules) + len(myungseung_blocks),
        "html": report_html,
    }


def _myungseung_analysis_block(item: dict) -> dict:
    label = re.sub(r"\s+", " ", str(item.get("label") or "검토의견")).strip()
    source = re.sub(r"\s+", " ", str(item.get("source") or "법무법인 명승 권리분석")).strip()
    analysis_text = _finish_sentence(str(item.get("text") or ""))
    if label == "재진행":
        body = (
            f"{source}에서는 이 사건을 ‘재진행’ 물건으로 분류하고 있습니다. "
            f"{analysis_text}"
        )
        kind = "check"
    else:
        body = f"{source}의 {label} 의견입니다. {analysis_text}"
        kind = "neutral"
    return {
        "heading": label,
        "body": _finish_sentence(body),
        "kind": kind,
        "label": "전문 검토",
    }


def _narrative_issue_block(item) -> dict:
    kind = "risk" if str(item.state.value) == "위험" else "check"
    label = "핵심 위험" if kind == "risk" else "추가 확인"
    fact = _customer_fact_from_basis(item.name, str(item.basis or ""))
    judgment = NARRATIVE_JUDGMENTS.get(
        item.name,
        "확인된 기재만으로 최종 법률효과를 확정할 수 없어 관련 요건을 추가로 검토해야 합니다",
    )
    impact = NARRATIVE_IMPACTS.get(item.name, "낙찰 후 부담이나 절차 진행에 영향을 줄 수 있습니다")
    action = NARRATIVE_ACTIONS.get(item.name, "관련 원본 문서와 최신 현황을 입찰 전에 확인하십시오")
    body = (
        f"{_without_sentence_end(fact)}. "
        f"{_without_sentence_end(judgment)}. "
        f"{_without_sentence_end(impact)}. "
        f"입찰 전 {_without_sentence_end(action)}."
    )
    return {"heading": item.name, "body": _finish_sentence(body), "kind": kind, "label": label}


def _extra_special_block(rule: dict) -> dict:
    kind = "risk" if rule.get("risk") == "상" else "check"
    name = str(rule.get("name") or "추가 특이사항")
    fact = str(rule.get("fact") or "관련 법률관계의 성립 요건과 현재 상태를 원문으로 확정해야 합니다")
    action = str(rule.get("action") or "관련 원본과 최신 현황을 입찰 전에 확인하여야 합니다")
    body = (
        f"{name} 관련 기재가 있습니다. "
        f"{_without_sentence_end(fact)}. "
        f"{_without_sentence_end(NARRATIVE_IMPACTS.get(name, '권리관계나 물건 이용 및 추가 비용에 영향을 줄 수 있습니다'))}. "
        f"입찰 전 {_without_sentence_end(action)}."
    )
    return {
        "heading": name,
        "body": _finish_sentence(body),
        "kind": kind,
        "label": "핵심 위험" if kind == "risk" else "추가 확인",
    }


def _extra_rule_category(code: str) -> str:
    return "물건 위험" if code == "LND-03" else "권리관계"


def _narrative_overview_text(
    risks: list,
    checks: list,
    extra_rules: list[dict],
    *,
    rights_available: bool,
    rights_collected: bool,
    tenant_source_confirmed: bool,
    tenant_source_collected: bool,
) -> str:
    extra_names = [str(rule.get("name") or "") for rule in extra_rules]
    risk_names = [item.name for item in risks]
    high_extra_names = [str(rule.get("name") or "") for rule in extra_rules if rule.get("risk") == "상"]
    if risk_names or high_extra_names:
        names = _join_korean_names([*risk_names, *high_extra_names])
        return (
            f"이 사건에서 입찰가와 낙찰 후 부담에 직접 영향을 줄 수 있는 핵심 쟁점은 {names}입니다. "
            "각 쟁점은 권리효과와 실제 부담 가능성을 기준으로 정리했으며, 금액이나 성립요건이 남아 있는 부분은 "
            "입찰가 산정 전에 확인해야 합니다."
        )
    if not rights_available or not tenant_source_confirmed:
        if rights_collected and tenant_source_collected:
            return (
                "등기부현황과 임차·점유 자료의 주요 기재를 기준으로 권리관계와 인수 부담을 검토했습니다. "
                "권리관계는 말소기준권리를 중심으로, 임차관계는 법원 조사내용을 중심으로 판단했습니다."
            )
        return (
            "현재 사건자료의 핵심 기재를 기준으로 말소기준권리, 임차관계와 비용 부담을 검토했습니다. "
            "추가 확인이 필요한 부분은 아래 특이사항에 따로 정리했습니다."
        )
    if checks or extra_names:
        names = _join_korean_names([*[item.name for item in checks], *extra_names])
        return (
            "매수인에게 인수되는 중대한 권리는 확인되지 않습니다. "
            f"다만 {names}은 입찰가와 명도 계획에 영향을 줄 수 있어 별도 확인 대상으로 정리했습니다."
        )
    return (
        "매수인에게 인수되는 중대한 권리사항은 확인되지 않습니다. "
        "말소기준권리 이후의 등기상 권리는 매각으로 말소되는 구조이며, 임차관계도 아래와 같이 정리됩니다."
    )


def _rights_clean_narrative(
    items: list,
    rights: list[dict],
    base_right: Optional[dict],
    rights_available: bool,
    signal_source_confirmed: bool,
    *,
    rights_collected: bool,
) -> str:
    registered = substantive_registered_rights(rights)
    procedures = auction_procedure_entries(rights)
    registered_total = registered_right_amount_total(rights)
    if not rights_available:
        if rights_collected and registered:
            right_types = _join_korean_names([str(right.get("type") or "") for right in registered])
            base_text = _base_right_summary(base_right)
            return (
                f"등기부현황상 실체 권리는 {len(registered)}건({right_types})이고, "
                f"등기상 기재금액 합계는 {fmt_money(registered_total)}입니다. "
                f"{base_text}를 기준으로 선후를 검토한 결과, 매수인에게 인수되는 등기상 권리는 확인되지 않습니다."
            )
        if rights_collected:
            return (
                "등기부현황의 접수일과 권리종류를 기준으로 말소기준권리와의 선후를 검토했습니다. "
                "매수인에게 인수되는 등기상 권리가 있는 경우 아래 특이사항에 별도로 기재합니다."
            )
        return (
            "등기부현황 확인이 필요한 사건입니다. 말소기준권리와 그보다 앞선 권리 여부를 최신 등기사항전부증명서로 대조해야 합니다."
        )
    base_label = _base_right_summary(base_right)
    rule_safe = [
        item.name for item in items
        if item.category == "권리관계" and item.state.value == "이상없음" and item.method.value == "규칙엔진"
    ]
    signal_safe = [
        item.name for item in items
        if item.category == "권리관계" and item.state.value == "이상없음" and item.method.value != "규칙엔진"
    ]
    parts = [
        f"말소기준과 선후 비교 기준은 {base_label}입니다.",
    ]
    if registered:
        parts.insert(
            0,
            f"건물 등기부현황에서 확인되는 실체 권리는 {len(registered)}건이며, "
            f"등기상 기재금액 합계는 {fmt_money(registered_total)}입니다.",
        )
    else:
        parts.insert(
            0,
            "건물 등기부현황에서 말소기준권리보다 앞선 실체 권리는 확인되지 않습니다. "
            "따라서 등기상 선순위 인수 권리는 없습니다.",
        )
    if rule_safe:
        parts.append(
            f"{_join_korean_names(rule_safe)} 항목에서도 매수인 인수 위험은 확인되지 않습니다."
        )
    if signal_safe and signal_source_confirmed:
        parts.append(f"{_join_korean_names(signal_safe)} 관련 특이 기재도 발견되지 않습니다.")
    absent_sensitive_types = [
        right_type for right_type in ("전세권", "가처분", "가등기")
        if not any(right_type in str(right.get("type") or "") for right in registered)
    ]
    if absent_sensitive_types:
        parts.append(f"등기부현황에는 {_join_korean_names(absent_sensitive_types)}가 없습니다.")
    if procedures:
        claims = [parse_money(entry.get("amount")) for entry in procedures if parse_money(entry.get("amount")) > 0]
        claim_text = f" 청구금액은 {fmt_money(max(claims))}입니다." if claims else ""
        parts.append(
            f"경매기입등기 {len(procedures)}건은 매각절차를 알리는 절차등기로 분리했습니다.{claim_text} "
            "이 청구금액은 근저당권 기재금액과 중복 합산하지 않았습니다."
        )
    registered_dates = [
        normalize_date(right.get("date") or "")
        for right in registered
        if _has_valid_date(right.get("date") or "")
    ]
    if len(registered_dates) != len(set(registered_dates)):
        parts.append("같은 날짜에 설정된 권리는 접수번호와 순위를 확인해 선후를 정리해야 합니다.")
    return " ".join(parts)


def _tenant_clean_narrative(
    items: list,
    tenants: list[dict],
    base_right: Optional[dict],
    tenant_source_confirmed: bool,
    *,
    tenant_source_collected: bool,
    explicit_no_tenant: bool,
) -> str:
    if not tenant_source_confirmed:
        if tenant_source_collected and tenants:
            move_count = sum(bool(tenant.get("moveInDate")) for tenant in tenants)
            fixed_count = sum(bool(tenant.get("fixedDate")) for tenant in tenants)
            demand_count = sum(bool(tenant.get("depositClaimDate")) for tenant in tenants)
            return (
                f"임차 관련 기재 {len(tenants)}건을 확인했습니다. 전입일 {move_count}건, "
                f"확정일자 {fixed_count}건, 배당요구일 {demand_count}건을 말소기준권리와 각각 비교해 인수 여부를 판단했습니다."
            )
        if explicit_no_tenant:
            return PARTIAL_NO_TENANTS_TEXT
        if tenant_source_collected:
            return (
                "임차·점유 관련 기재를 기준으로 인수되는 임차권리 여부를 검토했습니다. "
                "인수 가능성이 있는 임차관계가 확인되면 아래 특이사항에 별도로 표시합니다."
            )
        return (
            "임차·점유 확인이 필요한 사건입니다. 매각물건명세서, 현황조사서와 전입세대 확인자료를 기준으로 실제 점유와 전입일을 확인해야 합니다."
        )
    if not tenants:
        return (
            "법원 현황조사서와 매각물건명세서 상 조사된 임차인은 없으므로, 낙찰자에게 인수되는 임차권리는 없습니다."
        )
    safe_names = [
        item.name for item in items
        if item.category == "임차·점유" and item.state.value == "이상없음"
    ]
    base_text = _base_right_summary(base_right)
    result = f"임차내역 {len(tenants)}건의 전입일·확정일자·배당요구 기재를 {base_text}와 비교했습니다. "
    if safe_names:
        result += f"현재 자료에서 별도 위험 신호로 분류되지 않은 항목은 {_join_korean_names(safe_names)}입니다. "
    return result + "실제 점유 지속과 배당액은 입찰 전 현장 및 예상배당표로 확인하면 됩니다."


def _property_clean_narrative(
    items: list,
    signal_source_confirmed: bool,
    *,
    signal_sources_collected: list[str],
) -> str:
    if not signal_source_confirmed:
        if signal_sources_collected:
            names = _join_korean_names([
                SOURCE_DISPLAY_NAMES.get(source, source)
                for source in signal_sources_collected
            ])
            return (
                f"{names}의 기재를 기준으로 물건·절차상 특이사항을 검토했습니다. "
                "입찰가나 명도에 영향을 줄 수 있는 내용은 별도 항목으로 정리했습니다."
            )
        return (
            "물건·절차상 특이사항은 매각물건명세서, 현황조사, 문건접수내역과 감정평가 기재를 기준으로 확인해야 합니다."
        )
    safe_names = [
        item.name for item in items
        if item.category == "물건 위험" and item.state.value == "이상없음"
    ]
    if not safe_names:
        return (
            "물건 자체의 위험으로 별도 표시할 내용은 제한적입니다. 현장 확인이 필요한 사항은 아래 항목에 따로 정리했습니다."
        )
    return (
        f"{_join_korean_names(safe_names)} 관련 특이 기재는 발견되지 않습니다. "
        "현장 확인이 필요한 사항은 입찰 전 최종 점검 항목으로 보면 됩니다."
    )


def _cost_narrative(management_fee: dict, fee_status: str) -> str:
    if fee_status == "confirmed":
        amount = int(management_fee.get("unpaidAmount") or 0)
        return (
            f"체납관리비는 약 {fmt_money(amount)}으로 기재되어 있습니다. "
            "관리사무소에서 최신 미납 내역과 공용부분·전유부분·연체료 구분을 확인한 뒤 취득원가에 반영해야 합니다. "
            "취득세·등기비용과 명도비용도 별도로 산정해야 합니다."
        )
    if fee_status == "none":
        return (
            "미납관리비는 확인되지 않습니다. 다만 입찰 전 관리사무소에서 최신 미납 내역을 확인하고, "
            "공용부분 관리비와 전유부분 사용료·연체료를 구분해 취득원가에 반영해야 합니다."
        )
    return (
        "미납관리비는 확인되지 않습니다. 입찰 전 관리사무소에 최신 미납 내역을 확인하십시오. "
        "집합건물의 전 소유자 체납액 중 성질상 공용부분 관리비는 특별승계인인 매수인에게 청구될 수 있으나, 전유부분 사용료와 "
        "기존 연체료는 같은 범위로 보지 않습니다. 항목 명칭이 아니라 실제 사용 성격별 내역을 확인해 취득원가에 반영해야 합니다."
    )


def _status_survey_review_block(data: dict) -> Optional[dict]:
    text = re.sub(
        r"\s+", " ",
        str(data.get("status_survey_etc") or data.get("tenant_status_text") or ""),
    ).strip()
    if not text:
        return None
    compact = re.sub(r"\s+", "", text)
    if "폐문" not in compact and "소유자" not in compact and "점유" not in compact:
        return None
    facts = []
    if "폐문" in compact:
        facts.append("현황조사 당시 현장 방문은 폐문으로 내부 점유상태를 직접 확인하지 못했습니다")
    if "소유자" in compact and "전입" in compact:
        facts.append("전입세대 열람 및 주민등록표에는 채무자(소유자) 세대 전입이 기재되어 있습니다")
    if not facts:
        facts.append(_clip_text(text, 360))
    return {
        "heading": "현황조사 및 실제 점유 확인",
        "body": (
            f"{' '.join(_finish_sentence(fact) for fact in facts)} "
            "이는 조사된 임차인이 존재한다는 의미가 아니며, 임차인현황의 ‘조사된 임차내역 없음’ 판단과 구분됩니다. "
            "입찰 전 현재 소유자 점유 여부와 현장 인도 가능 상태를 다시 확인하면 됩니다."
        ),
        "kind": "check",
        "label": "현황 확인",
    }


def _unknown_narrative_blocks(unknowns: list) -> list[dict]:
    category_sentences = []
    for category, title in NARRATIVE_SECTION_TITLES.items():
        category_unknowns = [item for item in unknowns if item.category == category]
        if not category_unknowns:
            continue
        names = _join_korean_names([item.name for item in category_unknowns])
        category_sentences.append(f"{title}: {names}")
    if not category_sentences:
        return []
    body = (
        "입찰 전 별도 확인이 필요한 항목은 다음과 같습니다: " + "; ".join(category_sentences)
        + ". 각 항목은 최신 원본과 필요한 현장·관청 자료로 확인해야 합니다."
    )
    return [{
        "heading": "입찰 전 추가 확인사항",
        "body": _finish_sentence(body),
        "kind": "residual",
        "label": "잔여 확인",
    }]


def _final_action_narrative(risks: list, checks: list, extra_rules: list[dict]) -> str:
    priority_names = [item.name for item in risks]
    priority_names.extend(str(rule.get("name") or "") for rule in extra_rules if rule.get("risk") == "상")
    check_names = [item.name for item in checks]
    if priority_names:
        return (
            f"{_join_korean_names(priority_names)}은 입찰가 산정 전에 우선 확인해야 할 사항입니다. "
            "인수 가능 금액이나 절차 영향을 보수적으로 반영한 뒤 입찰가를 정하는 것이 좋습니다."
        )
    if check_names:
        return (
            f"{_join_korean_names(check_names)}은 입찰 전 확인하면 충분한 항목입니다. "
            "확인 결과에 따라 총투입금액이나 명도 일정이 달라질 수 있습니다."
        )
    return ""


def _narrative_source_scope(data: dict, fee_status: str, created_date: str) -> str:
    states = _source_states(data)
    complete_sources = [
        SOURCE_DISPLAY_NAMES[source]
        for source in SOURCE_KEYS
        if states[source]["complete"]
    ]
    partial_sources = [
        SOURCE_DISPLAY_NAMES[source]
        for source in SOURCE_KEYS
        if states[source]["collected"] and not states[source]["complete"]
    ]
    if fee_status in {"confirmed", "none"}:
        complete_sources.append("관리비 확인 기재")
    if complete_sources or partial_sources:
        parts = [f"본 분석은 {created_date} 작성 시점에 마이옥션 상세페이지에서 확인된 사건자료를 기준으로 작성했습니다."]
        if complete_sources:
            parts.append(
                f"판정에 직접 반영한 자료는 {_join_korean_names(complete_sources)}입니다."
            )
        if partial_sources:
            parts.append(
                f"{_join_korean_names(partial_sources)}는 실제 확인된 기재만 사건 판단에 반영했습니다."
            )
        result = " ".join(parts)
        return result
    return (
        f"{created_date} 작성 시점에 분석 원문의 확보 상태를 확인할 수 없습니다. 입력자료가 확보되기 전에는 이 문서를 "
        "권리부담 부존재의 근거로 사용할 수 없으며, 아래 확인자료를 보완해야 합니다."
    )


def _customer_fact_from_basis(name: str, value: str) -> str:
    raw = re.sub(r"\s+", " ", str(value or "")).strip()
    fact = raw.split(" — ", 1)[0].strip(" .")
    replacements = {
        "유치권 신고 문건 탐지": "확보된 문건에 유치권 신고 관련 기재가 있습니다",
        "선순위 대항력 임차인 인수 발생": "말소기준보다 앞선 전입일의 임차인이 확인되었습니다",
        "저항 점유(대항력 임차인/유치권) 정황": "대항력 임차인 또는 유치권 관련 점유 정황이 확인되었습니다",
        "취하 신호(청구액≪감정가·단독채권자/취하서 접수)": "취하 가능성과 관련된 사건 기재가 확인되었습니다",
        "등기 텍스트에서 탐지": f"등기부현황에 {name} 관련 기재가 있습니다",
        "등기 텍스트에서 확인": f"등기부현황에 {name} 관련 기재가 있습니다",
    }
    fact = replacements.get(fact, fact)
    fact = fact.replace("탐지", "확인").replace("정황", "관련 기재")
    if not fact:
        return f"{name} 관련 원문 기재가 확인되었습니다"
    return fact


def _join_korean_names(values: list[str]) -> str:
    names = []
    for value in values:
        name = str(value or "").strip()
        if name and name not in names:
            names.append(name)
    if not names:
        return "관련 항목"
    if len(names) == 1:
        return names[0]
    return "·".join(names)


def _finish_sentence(value: str) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if text and not text.endswith((".", "!", "?", "다.")):
        text += "."
    return text


def _without_sentence_end(value: str) -> str:
    """Return prose ready for use inside a labelled narrative sentence."""
    return re.sub(r"[.!?。！？]+$", "", re.sub(r"\s+", " ", str(value or "")).strip())


def _paginate_narrative_sections(sections: list[dict]) -> list[dict]:
    prepared = []
    for section in sections:
        title = str(section.get("title") or "특이사항 상세 검토")
        blocks = []
        for original in section.get("blocks") or []:
            if not str(original.get("body") or "").strip():
                continue
            block = dict(original)
            block["sectionTitle"] = title
            blocks.append(block)
        if blocks:
            prepared.append((title, blocks))

    # Section boundaries are semantic headings, not hard page breaks.  Keeping
    # separate streams produced almost-empty one-panel pages whenever a short
    # section followed a summary page.  Pack all blocks in reading order so the
    # original template can naturally use two, three, or four panels per page.
    # Mixed-section panels retain their section name in the block heading.
    all_blocks = [block for _, blocks in prepared for block in blocks]
    pages = _paginate_narrative_block_stream(
        all_blocks,
        preferred_title="사건별 상세 검토 및 결론",
    )
    if pages and prepared:
        pages[0]["title"] = prepared[0][0]

    for index, page in enumerate(pages, start=1):
        page["pageIndex"] = index
        page["pageCount"] = len(pages)
    number = 1
    for page in pages:
        for block in page.get("blocks") or []:
            block["number"] = number
            number += 1
    return pages


def _paginate_narrative_block_stream(blocks: list[dict], *, preferred_title: str) -> list[dict]:
    pages = []
    current = []
    current_height = 0.0
    for block in blocks:
        block_height = _narrative_block_required_height(block, font_points=10.0)
        next_height = current_height + block_height
        if current:
            next_height += NARRATIVE_PANEL_GAP_INCHES
        if current and (
            len(current) >= NARRATIVE_MAX_BLOCKS_PER_PAGE
            or next_height > NARRATIVE_CONTENT_HEIGHT_INCHES
        ):
            pages.append({"title": _narrative_page_title(current, preferred_title), "blocks": current})
            current = []
            current_height = 0.0
            next_height = block_height
        current.append(block)
        current_height = next_height
    if current:
        pages.append({"title": _narrative_page_title(current, preferred_title), "blocks": current})

    # Avoid a sparse final page containing only one short panel.  Move the
    # preceding panel only when both panels fit at the supported minimum font
    # size, so the visual rebalance never trades whitespace for overflow.
    if len(pages) >= 2 and len(pages[-1]["blocks"]) == 1 and len(pages[-2]["blocks"]) >= 3:
        candidate = pages[-2]["blocks"][-1]
        balanced_tail = [candidate, *pages[-1]["blocks"]]
        required = sum(
            _narrative_block_required_height(block, font_points=10.0)
            for block in balanced_tail
        ) + NARRATIVE_PANEL_GAP_INCHES * (len(balanced_tail) - 1)
        if required <= NARRATIVE_CONTENT_HEIGHT_INCHES:
            pages[-2]["blocks"].pop()
            pages[-1]["blocks"].insert(0, candidate)
            pages[-2]["title"] = _narrative_page_title(pages[-2]["blocks"], preferred_title)
            pages[-1]["title"] = _narrative_page_title(pages[-1]["blocks"], preferred_title)
    return pages


def _narrative_page_title(blocks: list[dict], preferred_title: str) -> str:
    titles = list(dict.fromkeys(str(block.get("sectionTitle") or "") for block in blocks))
    return titles[0] if len(titles) == 1 and titles[0] else preferred_title


def _narrative_display_heading(block: dict, page_title: str) -> str:
    heading = str(block.get("heading") or "")
    return heading


def _narrative_block_weight(block: dict) -> int:
    heading = " · ".join(filter(None, (str(block.get("sectionTitle") or ""), str(block.get("heading") or ""))))
    body = str(block.get("body") or "")
    body_lines = max(1, (len(body) + NARRATIVE_WRAP_WIDTH - 1) // NARRATIVE_WRAP_WIDTH)
    heading_lines = max(1, (len(heading) + 24) // 25)
    return 2 + body_lines + heading_lines


def _narrative_wrapped_line_count(value: str, width: int) -> int:
    lines = 0
    for raw_line in str(value or "").splitlines() or [""]:
        text = raw_line.strip()
        lines += max(1, (len(text) + width - 1) // width)
    return lines


def _narrative_block_required_height(block: dict, *, font_points: float) -> float:
    # The original certificate content area is 5.48in wide.  These conservative
    # line estimates keep 10~11pt BatangChe text inside the panel without
    # shrinking individual boxes to unreadable sizes.
    chars_per_line = 35 if font_points >= 11 else 37 if font_points >= 10.5 else 40
    heading = _narrative_display_heading(block, str(block.get("sectionTitle") or ""))
    heading_lines = _narrative_wrapped_line_count(heading, 26)
    body_lines = _narrative_wrapped_line_count(str(block.get("body") or ""), chars_per_line)
    line_height = 0.19 if font_points >= 11 else 0.18 if font_points >= 10.5 else 0.17
    required = 0.42 + max(0, heading_lines - 1) * 0.16 + body_lines * line_height + 0.20
    return max(1.05, required)


def _narrative_page_font_points(blocks: list[dict]) -> float:
    gaps = NARRATIVE_PANEL_GAP_INCHES * max(0, len(blocks) - 1)
    for font_points in (11.0, 10.5, 10.0):
        required = sum(
            _narrative_block_required_height(block, font_points=font_points)
            for block in blocks
        ) + gaps
        if required <= NARRATIVE_CONTENT_HEIGHT_INCHES:
            return font_points
    return 10.0


def _render_narrative_report_html(pages: list[dict], case_number: str, created_date: str) -> str:
    rendered_pages = []
    for page in pages:
        item_html = []
        for block in page.get("blocks") or []:
            heading = _narrative_display_heading(block, str(page.get("title") or ""))
            item_html.append(
                '<li><strong>' + html.escape(heading) + '</strong> '
                + html.escape(str(block.get("body") or "")) + '</li>'
            )
        rendered_pages.append(
            '<div class="page"><div class="gold-border narrative-page">'
            '<h1 class="narrative-title">4. 특이사항</h1>'
            '<div class="subtitle">사건번호 ' + html.escape(case_number)
            + ' · ' + str(page.get("pageIndex") or "") + ' / ' + str(page.get("pageCount") or "") + '</div>'
            + '<ol class="special-list">' + ''.join(item_html) + '</ol>'
            + '<div class="narrative-footnote">본 내용은 ' + html.escape(created_date)
            + ' 기준 사건자료와 권리분석 결과를 정리한 것입니다. 입찰 직전 사건진행내역과 현장상태는 다시 확인하십시오.</div>'
            '<div class="narrative-page-number">특이사항 보고 '
            + str(page.get("pageIndex") or "") + ' / ' + str(page.get("pageCount") or "") + '</div>'
            '</div></div>'
        )
    return "\n".join(rendered_pages)


def find_base_right(rights: list[dict]) -> Optional[dict]:
    marked = [
        r for r in rights
        if r.get("date") and r.get("isBaseRight")
    ]
    marked.sort(key=lambda r: _date_sort_key(r.get("date")))
    if marked:
        return marked[0]

    candidates = [
        r for r in rights
        if r.get("date") and any(t in (r.get("type") or "") for t in BASE_RIGHT_TYPES)
    ]
    candidates.sort(key=lambda r: _date_sort_key(r.get("date")))
    return candidates[0] if candidates else None


def enrich_base_right_from_registry(base_right: Optional[dict], rights: list[dict]) -> Optional[dict]:
    if not base_right:
        return None
    enriched = dict(base_right)
    base_date = enriched.get("date") or ""
    base_type = enriched.get("type") or ""
    for right in rights:
        if not _same_date(right.get("date") or "", base_date):
            continue
        right_type = right.get("type") or ""
        if (
            base_type
            and right_type
            and base_type != "권리종류 확인 필요"
            and base_type not in right_type
            and right_type not in base_type
        ):
            continue
        for key in ("type", "creditor", "amount", "status", "note", "isBaseRight", "rawText"):
            if not enriched.get(key) and right.get(key):
                enriched[key] = right.get(key)
        break
    return enriched


def build_base_right_description(
    base_right: Optional[dict],
    rights: list[dict],
    registered_takeover_texts: Optional[list[str]] = None,
    *,
    registry_source_complete: bool = False,
) -> str:
    if not base_right:
        return (
            "등기부현황에서 말소기준권리 확인이 필요합니다. "
            "등기부등본 원본과 매각물건명세서를 기준으로 담당자 최종 확인이 필요합니다."
        )
    creditor = base_right.get("creditor") or ""
    same_date_sensitive_rights = [
        right for right in rights
        if _same_date(right.get("date") or "", base_right.get("date") or "")
        and any(
            token in (right.get("type") or "")
            for token in ("전세권", "가처분", "가등기", "지상권", "지역권", "임차권등기")
        )
    ]
    extinguish_text = "말소기준권리 이후의 권리는 매각으로 말소됩니다."
    if same_date_sensitive_rights:
        names = _join_korean_names([right.get("type") or "동일일 권리" for right in same_date_sensitive_rights])
        extinguish_text += (
            f" 다만 말소기준권리와 같은 날짜에 설정된 권리({names})는 접수번호·순위 확인 전까지 "
            "후순위 또는 인수 없음으로 단정할 수 없습니다."
        )
    if registered_takeover_texts:
        extinguish_text += " 다만 최선순위 설정일보다 앞선 전세권은 임차권리 인수사항에서 별도 검토합니다."
    if not registered_takeover_texts and not same_date_sensitive_rights:
        extinguish_text += " 매수인에게 인수되는 등기상 권리는 없습니다."
    right_type = str(base_right.get("type") or "").strip()
    if _is_auction_procedure_right(base_right) and "기입등기" not in right_type:
        right_type = f"{right_type} 기입등기".strip()
    right_label = f"{base_right.get('date')} 일자 {right_type}"
    if creditor:
        right_label += f" [{creditor}]"
    return f"말소기준권리는 {right_label}입니다.\n{extinguish_text}"


def analyze_registered_takeover_rights(
    rights: list[dict],
    base_right: Optional[dict],
    dividend_requests: list[dict],
    *,
    dividend_request_source_complete: bool = False,
) -> list[str]:
    base_date = (base_right or {}).get("date") or ""
    if not _has_valid_date(base_date):
        return []

    descriptions = []
    for right in rights:
        right_type = right.get("type") or ""
        if "전세권" not in right_type:
            continue
        right_date = right.get("date") or ""
        if not _date_before(right_date, base_date):
            continue
        creditor = right.get("creditor") or "전세권자"
        amount_text = fmt_money(right.get("amount")) if right.get("amount") else "담당자 확인 필요"
        right_label = f"{right_date} {right_type} [{creditor}]"
        if right.get("amount"):
            right_label += f" {amount_text}"

        dividend_assessment = _right_dividend_request_assessment(
            right,
            dividend_requests,
            source_complete=dividend_request_source_complete,
        )
        if dividend_assessment == "timely":
            text = (
                f"최선순위 설정보다 앞선 전세권({right_label})이 확인됩니다. "
                "전세권자의 배당요구가 확인되므로 배당 후 소멸 여부를 원본 문서와 대조해 확인해 주시기 바랍니다."
            )
        elif dividend_assessment == "late":
            text = (
                f"최선순위 설정보다 앞선 전세권({right_label})이 확인됩니다. "
                "배당요구 접수는 확인되지만 접수일이 배당요구종기보다 늦어 적법한 배당요구의 효과를 확정할 수 없습니다. "
                "배당으로 소멸한다고 전제하지 말고 낙찰자 인수 가능성을 반영해 원본 사건기록을 확인해야 합니다."
            )
        elif dividend_assessment == "absent":
            text = (
                f"최선순위 설정보다 앞선 전세권({right_label})이 확인됩니다. "
                "전세권자의 배당요구가 없는 것으로 확인되어 낙찰자 인수 가능성을 반영해야 합니다."
            )
        else:
            text = (
                f"최선순위 설정보다 앞선 전세권({right_label})이 확인됩니다. "
                "배당요구 자료가 충분히 확보되지 않아 신청 여부는 미확인 상태이며, 확인 전에는 낙찰자 인수 가능성을 "
                "배제할 수 없습니다."
            )
        # Keep one analysis string per tenant.  Even when multiple occupants
        # share the same legal conclusion, build_tenant_analysis_text() pairs
        # this list by index with the original tenant rows; de-duplicating here
        # collapses many-tenant sale specs into one or shifts later occupants to
        # the wrong conclusion.
        descriptions.append(text)
    return descriptions


def combine_tenant_and_registered_takeover_texts(tenant_text: str, registered_takeover_texts: list[str]) -> str:
    registered_text = "\n\n".join(registered_takeover_texts)
    if not registered_text:
        return tenant_text
    if not tenant_text or tenant_text == NO_TENANTS_TEXT:
        return registered_text
    return f"{tenant_text}\n\n{registered_text}"


def _base_right_summary(base_right: Optional[dict]) -> str:
    if not base_right:
        return "등기부현황과 매각물건명세서 원본 확인이 필요합니다."
    date = base_right.get("date") or "일자 확인 필요"
    right_type = str(base_right.get("type") or "권리종류 확인 필요").strip()
    if _is_auction_procedure_right(base_right) and "기입등기" not in right_type:
        right_type = f"{right_type} 기입등기".strip()
    creditor = base_right.get("creditor") or ""
    return f"{date} 설정된 {right_type} [{creditor}]" if creditor else f"{date} 설정된 {right_type}"


def build_tenant_analysis_text(
    tenants: list[dict],
    tenant_texts: list[str],
    tenant_ocr_text: str,
    tenant_source: str = "",
    *,
    tenant_source_complete: bool = False,
) -> str:
    valid_tenants = [tenant for tenant in tenants if not _is_no_tenant_record(tenant)]
    if valid_tenants:
        blocks = []
        for idx, tenant in enumerate(valid_tenants):
            detail = format_tenant_detail(tenant)
            takeover = tenant_texts[idx] if idx < len(tenant_texts) else "인수여부 확인이 필요합니다."
            blocks.append(f"{detail}\n인수여부: {takeover}")
        return "\n\n".join(blocks)
    # A source label by itself does not prove that the source was actually
    # collected or that it affirmatively states there are no tenants.
    if tenants or _tenant_ocr_text_indicates_no_tenants(tenant_ocr_text):
        return NO_TENANTS_TEXT if tenant_source_complete else PARTIAL_NO_TENANTS_TEXT
    if tenant_texts:
        return "\n".join(f"인수여부: {text}" for text in tenant_texts)
    if tenant_ocr_text:
        clipped = _clip_text(tenant_ocr_text, 1500)
        return (
            "임차인현황 확인 내용입니다.\n"
            f"{clipped}\n\n"
            "전입일, 확정일자, 배당요구일 및 보증금은 원본 문서와 대조해 담당자 최종 확인이 필요합니다."
        )
    return "임차인 현황은 현황조사서, 매각물건명세서, 전입세대 열람자료를 기준으로 담당자 확인이 필요합니다."


def format_tenant_detail(tenant: dict) -> str:
    return " / ".join(
        [
            f"점유자 성명: {tenant.get('name') or '미확인'}",
            f"점유구분: {tenant.get('occupancyType') or tenant.get('type') or '미확인'}",
            f"보증금: {fmt_money(tenant.get('deposit'))}",
            f"차임: {fmt_money_or_unknown(tenant.get('rent'))}",
            f"전입일: {tenant.get('moveInDate') or '미확인'}",
            f"확정일: {tenant.get('fixedDate') or '미확인'}",
            f"배당요구일: {tenant.get('depositClaimDate') or '미확인'}",
        ]
    )


def format_sale_spec_tenants(tenants: list[dict]) -> str:
    lines = []
    valid_tenants = [tenant for tenant in tenants if not _is_no_tenant_record(tenant)]
    if not valid_tenants:
        return NO_TENANTS_TEXT
    for tenant in valid_tenants:
        lines.append(format_tenant_detail(tenant))
    return "\n".join(lines)


def _is_no_tenant_record(tenant: dict) -> bool:
    name = re.sub(r"\s+", "", str(tenant.get("name") or ""))
    occupancy = re.sub(r"\s+", "", str(tenant.get("occupancyType") or tenant.get("type") or ""))
    has_dates = any(
        _has_valid_date(tenant.get(key) or "")
        for key in ("moveInDate", "fixedDate", "depositClaimDate")
    )
    has_money = parse_money(tenant.get("deposit")) > 0 or parse_money(tenant.get("rent")) > 0
    # 이름이 명시적 '없음'이거나, 공란/‘미확인’ 플레이스홀더인 경우 모두 '이름 없음'으로 본다.
    # (다가구 명세서에서 이름을 못 읽은 행이 '미확인 점유자' 레코드로 생성되어, 임차인이 없는데도
    #  가짜 임차인 여러 줄로 나열되던 회귀 방지. 보증금·차임·전입/확정/배당요구일이 전혀 없을 때만
    #  적용하므로, 이름만 미확인인 실제 임차인(보증금/일자 있음)은 그대로 보존된다.)
    no_name = _tenant_name_indicates_no_tenants(name) or name == "" or "미확인" in name
    no_occupancy = occupancy in ("", "없음", "해당없음", "해당사항없음", "공실", "미상", "미확인")
    return no_name and not has_dates and not has_money and (no_occupancy or "임차인" in occupancy or "점유자" in occupancy)


def _no_tenant_record(deadline: str = "") -> dict:
    return {
        "name": "조사된 임차내역 없음",
        "occupancyType": "없음",
        "type": "없음",
        "moveInDate": "",
        "fixedDate": "",
        "depositClaimDate": "",
        "depositDeadline": deadline,
        "deposit": 0,
        "rent": 0,
        "isHUG": False,
        "isVacant": False,
    }


def _tenant_name_indicates_no_tenants(name: str) -> bool:
    compact = re.sub(r"\s+", "", str(name or ""))
    if compact in ("없음", "해당없음", "해당사항없음", "무", "없습니다"):
        return True
    if "없" not in compact:
        return False
    return any(keyword in compact for keyword in ("조사", "임차", "임대차", "점유", "내역", "관계"))


def _tenant_ocr_text_indicates_no_tenants(text: str) -> bool:
    label_pattern = (
        r"(?:조사된)?(?:임차인|임차내역|임대차관계|점유자(?:성명)?|점유관계)"
    )
    absent_pattern = r"(?:없음|없습니다|해당없음|해당사항없음|무)"
    clauses: list[str] = []
    for raw_line in (text or "").splitlines():
        clauses.extend(
            compact for compact in (
                re.sub(r"^[※*#·ㆍ\-–—]+", "", re.sub(r"\s+", "", part))
                for part in re.split(r"[|,，;/]+", raw_line)
            ) if compact
        )

    for index, clause in enumerate(clauses):
        # The absence value must belong to the tenant/occupancy label itself.
        # A broad substring check would misread e.g. "임차인 홍길동, 확정일자
        # 해당없음" as proof that no tenant exists.
        if re.fullmatch(
            rf"{label_pattern}(?:은|는|이|가)?[:：=\-]?{absent_pattern}[.!。]?",
            clause,
        ):
            return True
        if re.fullmatch(rf"{label_pattern}[:：=\-]?", clause) and index + 1 < len(clauses):
            if re.fullmatch(rf"{absent_pattern}[.!。]?", clauses[index + 1]):
                return True
    return False


def _tenant_ocr_text_confirms_no_surveyed_tenants(text: str) -> bool:
    """Recognize the site's explicit surveyed-result sentence.

    This is stronger than a generic OCR fragment such as ``임차인 없음``:
    it supports the scoped conclusion that the site's 조사 결과 contains no
    tenant rows even when another document (for example a 준비중 sale spec)
    was unavailable.
    """
    compact = re.sub(r"\s+", "", str(text or ""))
    return bool(re.search(r"(?:※|\*)?조사된임차(?:인)?내역(?:이|은|는)?없(?:습니다|음)", compact))


def _collect_registry_pdf_text(driver, safe_task_id: str, deadline: Optional[float]) -> tuple[str, bool]:
    """Use the actual registry PDF when the HTML table is incomplete."""
    base_url = driver.current_url
    target = myauction_document_url(base_url, "aceeaea1")
    if not target or (deadline and time.monotonic() >= deadline):
        return "", False
    try:
        driver.get(target)
        wait_document_ready(driver, timeout=15)
        frame = WebDriverWait(driver, 15).until(EC.presence_of_element_located((By.ID, "detail_target")))
        source = frame.get_attribute("src") or ""
        if not source:
            return "", False
        pdf_path = pdf_processor.download_pdf_with_cookies(driver, source, f"rights_registry_{safe_task_id}")
        with fitz.open(pdf_path) as doc:
            if doc.page_count > 20:
                return "\n".join(page.get_text() for page in list(doc)[:20]), False
            page_texts = [page.get_text() for page in doc]
        if page_texts and all(len(text.strip()) >= 30 for text in page_texts):
            return "\n".join(page_texts), True
        remaining = deadline - time.monotonic() if deadline else 90
        if remaining <= 0:
            return "\n".join(page_texts), False
        pattern = str(CAPTURE_DIR / f"rights_registry_pdf_{safe_task_id}_{{page}}.png")
        count = pdf_processor.pdf_to_images(pdf_path, pattern, dpi=220, timeout_seconds=min(90, max(1, int(remaining))))
        complete = bool(count) and count == len(page_texts)
        for index in range(count):
            if index < len(page_texts) and len(page_texts[index].strip()) >= 30:
                continue
            remaining = deadline - time.monotonic() if deadline else 30
            if remaining <= 0:
                complete = False
                break
            text = ocr_image_to_text(pattern.format(page=index + 1), timeout_seconds=min(30, max(1, int(remaining))))
            if index < len(page_texts):
                page_texts[index] = text
            else:
                page_texts.append(text)
            complete = complete and len(text.strip()) >= 30
        return "\n".join(page_texts), complete
    finally:
        driver.get(base_url)
        wait_document_ready(driver, timeout=15)


def extract_rights_context_by_ocr(driver, task_id: Optional[str] = None, deadline: Optional[float] = None) -> dict:
    if not driver or not pytesseract:
        return {}

    safe_task_id = re.sub(r"[^0-9A-Za-z._-]", "_", task_id or datetime.now().strftime("%Y%m%d_%H%M%S"))
    image_paths = []
    texts = []
    timed_out = False
    capture_failed = False
    for h3_text, suffix in (
        ("건물 등기부현황", "building_registry"),
        ("토지 등기부현황", "land_registry"),
        ("등기부현황", "registry"),
    ):
        prefix = os.path.join(str(CAPTURE_DIR), f"rights_{suffix}_ocr_{safe_task_id}")
        try:
            captured = capturer.capture_table_split_by_rows(driver, h3_text, prefix, rows_per_page=8, timeout=5)
        except Exception as e:
            logger.info(f"{h3_text} 문서 확인 생략: {e}")
            capture_failed = True
            continue
        image_paths.extend(captured)
        for image_path in captured:
            remaining = (deadline - time.monotonic()) if deadline else 30
            if remaining <= 0:
                timed_out = True
                break
            text = ocr_image_to_text(image_path, timeout_seconds=min(30, max(1, int(remaining))))
            if text:
                texts.append(text)
        if timed_out:
            break

    registry_pdf_complete = False
    if capture_failed and not timed_out:
        try:
            pdf_text, registry_pdf_complete = _collect_registry_pdf_text(driver, safe_task_id, deadline)
            if pdf_text:
                texts.append(pdf_text)
            if registry_pdf_complete:
                capture_failed = False
        except Exception as exc:
            logger.warning(f"등기부 PDF 재수집 실패: {exc}")
    raw_text = normalize_ocr_text("\n".join(texts))
    if not raw_text:
        return {
            "rights_ocr_images": image_paths,
            "_timed_out": timed_out,
            "_incomplete": timed_out or capture_failed or bool(image_paths),
            "_source_complete": False,
        }

    return {
        "rights": parse_rights_from_ocr(raw_text),
        "rights_ocr_text": raw_text,
        "rights_ocr_images": image_paths,
        "_timed_out": timed_out,
        # Partial HTML tables alone cannot establish completeness. Only the
        # actual PDF with text from every page enables complete-source review.
        "_incomplete": timed_out or capture_failed,
        "_source_complete": registry_pdf_complete,
    }


def parse_rights_from_ocr(text: str) -> list[dict]:
    rights = []
    for raw_line in (text or "").splitlines():
        line = _strip_registry_sequence_text(raw_line.strip())
        if not line:
            continue
        right_type = _first_match(line, RIGHT_TYPES)
        date = normalize_date(_first_date(line) or "")
        if not right_type or not date:
            continue
        rights.append(
            {
                "seq": len(rights) + 1,
                "date": date,
                "type": right_type,
                "creditor": _guess_right_creditor_from_text(line, right_type),
                "amount": parse_money(line),
                "status": _extract_right_status(line),
                "note": _extract_right_note([], line),
                "isBaseRight": _is_base_right_row(line),
                "rawText": line,
                "source": "registry_ocr",
                "isAuctionProcedure": _is_auction_procedure_type(right_type),
                "amountKind": "application_claim" if _is_auction_procedure_type(right_type) else "registered_right",
            }
        )
    return _dedupe_by(rights, ("date", "type", "creditor", "amount"))


def _guess_right_creditor_from_text(line: str, right_type: str) -> str:
    cleaned = re.sub(r"\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}", " ", line)
    cleaned = cleaned.replace(right_type, " ")
    cleaned = re.sub(r"\d{1,3}(?:,\d{3})+|\d{4,}\s*원?", " ", cleaned)
    cleaned = re.sub(r"(순위|권리자|권리종류|접수|등기|채권최고액|청구금액|말소기준|소유권|이전|설정)", " ", cleaned)
    cleaned = re.sub(r"[:|()\[\],.]", " ", cleaned)
    tokens = [t.strip() for t in cleaned.split() if t.strip()]
    for token in tokens:
        if 1 < len(token) <= 40 and re.search(r"[가-힣A-Za-z]", token):
            return token
    return ""


def extract_tenant_context_by_ocr(driver, task_id: Optional[str] = None, deadline: Optional[float] = None) -> dict:
    if not driver or not pytesseract:
        return {}

    sale_spec_context = extract_sale_spec_tenant_context_by_ocr(driver, task_id=task_id, deadline=deadline)
    if sale_spec_context.get("tenants") or _ocr_text_has_tenant_signals(sale_spec_context.get("tenant_ocr_text", "")):
        return sale_spec_context

    safe_task_id = re.sub(r"[^0-9A-Za-z._-]", "_", task_id or datetime.now().strftime("%Y%m%d_%H%M%S"))
    prefix = os.path.join(str(CAPTURE_DIR), f"rights_tenant_ocr_{safe_task_id}")
    try:
        image_paths = capturer.capture_table_split_by_rows(driver, "임차인현황", prefix, rows_per_page=8, timeout=8)
    except Exception as e:
        logger.warning(f"임차인현황 문서 확인 실패: {e}")
        result = dict(sale_spec_context)
        result["_incomplete"] = True
        return result

    texts = []
    timed_out = False
    for image_path in image_paths:
        remaining = (deadline - time.monotonic()) if deadline else 30
        if remaining <= 0:
            timed_out = True
            break
        text = ocr_image_to_text(image_path, timeout_seconds=min(30, max(1, int(remaining))))
        if text:
            texts.append(text)

    raw_text = normalize_ocr_text("\n".join(texts))
    if not raw_text:
        result = dict(sale_spec_context)
        result["tenant_ocr_images"] = list(dict.fromkeys([
            *(sale_spec_context.get("tenant_ocr_images") or []),
            *image_paths,
        ]))
        result["_timed_out"] = bool(sale_spec_context.get("_timed_out")) or timed_out
        result["_incomplete"] = True
        return result

    result = dict(sale_spec_context)
    result.update({
        "tenants": parse_tenants_from_ocr(raw_text),
        "tenant_source": "tenant_status_ocr",
        "tenant_ocr_text": "\n".join(filter(None, [sale_spec_context.get("tenant_ocr_text", ""), raw_text])),
        "tenant_status_text": raw_text,
        "tenant_ocr_images": list(dict.fromkeys([
            *(sale_spec_context.get("tenant_ocr_images") or []),
            *image_paths,
        ])),
        "_timed_out": bool(sale_spec_context.get("_timed_out")) or timed_out,
        "_incomplete": bool(sale_spec_context.get("_incomplete")) or timed_out,
    })
    return result


def extract_sale_spec_tenant_context_by_ocr(driver, task_id: Optional[str] = None, deadline: Optional[float] = None) -> dict:
    safe_task_id = re.sub(r"[^0-9A-Za-z._-]", "_", task_id or datetime.now().strftime("%Y%m%d_%H%M%S"))
    pdf_text, image_paths = collect_sale_spec_text_and_images(driver, safe_task_id, deadline=deadline)
    if not image_paths and not pdf_text:
        return {
            "_incomplete": True,
            "_sale_spec_incomplete": True,
            "_sale_spec_complete": False,
        }

    pdf_text = normalize_ocr_text(pdf_text)
    texts = []
    page_text_checks = []
    timed_out = False
    for image_path in image_paths:
        remaining = (deadline - time.monotonic()) if deadline else 30
        if remaining <= 0:
            timed_out = True
            break
        text = ocr_image_to_text(image_path, timeout_seconds=min(30, max(1, int(remaining))))
        page_text_checks.append(_sale_spec_page_text_is_substantive(text))
        if text:
            texts.append(text)

    raw_text = normalize_ocr_text("\n".join([pdf_text, *texts]))
    if not raw_text:
        return {
            "tenant_source": "sale_spec_ocr",
            "tenant_ocr_images": image_paths,
            "_timed_out": timed_out,
            "_incomplete": True,
            "_sale_spec_incomplete": True,
            "_sale_spec_complete": False,
        }

    pdf_tenants = parse_sale_spec_tenants_from_pdf_text(pdf_text)
    combined_table_tenants = parse_sale_spec_tenants_from_pdf_text(raw_text)
    ocr_tenants = parse_sale_spec_tenants_from_ocr(raw_text)
    tenants = _select_best_sale_spec_tenants(pdf_tenants, combined_table_tenants, ocr_tenants)
    # Embedded PDF text can be incomplete even when non-empty. Use the combined
    # embedded-text + OCR result so remarks and special-right signals are not lost.
    sale_spec_context = parse_sale_spec_document_context(raw_text)
    dividend_deadline = sale_spec_context.get("dividendDeadline") or ""
    # 명세서가 '조사된 임차내역없음'을 명시하면, 보증금/차임 증거가 없는 추측성 임차인은
    # (상단 메타데이터 오인 등) 신뢰할 수 없으므로 '임차인 없음'으로 확정한다.
    if _tenant_ocr_text_confirms_no_surveyed_tenants(raw_text):
        monetary = [
            t for t in tenants
            if not _is_no_tenant_record(t)
            and (parse_money(t.get("deposit")) > 0 or parse_money(t.get("rent")) > 0)
        ]
        if not monetary:
            tenants = [_no_tenant_record(dividend_deadline)]
    for tenant in tenants:
        if dividend_deadline and not tenant.get("depositDeadline"):
            tenant["depositDeadline"] = dividend_deadline

    page_text_complete = bool(image_paths) and len(page_text_checks) == len(image_paths) and all(page_text_checks)
    source_complete = bool(
        not timed_out
        and page_text_complete
        and _sale_spec_required_sections_present(raw_text)
    )
    page_collection_failed = bool(image_paths) and not page_text_complete

    return {
        "tenants": tenants,
        "tenant_source": "sale_spec_ocr",
        "tenant_ocr_text": raw_text,
        "tenant_ocr_images": image_paths,
        "sale_spec_ocr_text": raw_text,
        "sale_spec_ocr_images": image_paths,
        "sale_spec_base_right": sale_spec_context.get("baseRight") or {},
        "sale_spec_dividend_deadline": dividend_deadline,
        "sale_spec_remarks": sale_spec_context.get("remarks") or "",
        "_timed_out": timed_out,
        "_incomplete": timed_out or page_collection_failed,
        "_sale_spec_incomplete": timed_out or page_collection_failed,
        # Complete means every rendered page produced text and the core sections
        # needed for absence review are present. A non-empty title/text layer is
        # only partial evidence because scanned or mixed PDFs can hide pages.
        "_sale_spec_complete": source_complete,
    }


def _sale_spec_required_sections_present(text: str) -> bool:
    compact = re.sub(r"\s+", "", str(text or ""))
    if not compact:
        return False
    required_groups = (
        ("점유", "임차"),
        ("비고", "특별매각조건", "매각에서제외"),
        ("최선순위", "말소기준"),
    )
    return all(any(keyword in compact for keyword in group) for group in required_groups)


def _sale_spec_page_text_is_substantive(text: str) -> bool:
    compact = re.sub(r"\s+", "", str(text or ""))
    if len(compact) < 20:
        return False
    # Property-description appendices contain no occupancy/priority sections.
    # Require the appendix heading and its actual structure, not merely a title.
    if "부동산의표시" in compact and any(keyword in compact for keyword in (
        "전유부분", "대지권", "1동의건물", "토지의표시",
    )):
        return True
    return any(keyword in compact for keyword in (
        "점유", "임차", "비고", "최선순위", "말소기준", "배당요구", "소재지", "사건",
    ))


def extract_status_survey_context_by_ocr(driver, task_id: Optional[str] = None) -> dict:
    if not driver:
        return {}

    safe_task_id = re.sub(r"[^0-9A-Za-z._-]", "_", task_id or datetime.now().strftime("%Y%m%d_%H%M%S"))
    text = collect_status_survey_text(driver, safe_task_id)
    raw_text = normalize_ocr_text(text)
    if not raw_text:
        return {"_incomplete": True, "_source_complete": False}
    return {
        "status_survey_text": raw_text,
        "status_survey_etc": _extract_status_survey_etc_from_text(raw_text),
        "_incomplete": False,
        "_source_complete": False,
    }


def collect_status_survey_text(driver, safe_task_id: str) -> str:
    base_handle = driver.current_window_handle
    base_url = driver.current_url
    before_handles = set(driver.window_handles)
    opened_handle = ""

    try:
        _open_status_survey_document(driver)
        end = time.time() + 8
        while time.time() < end:
            new_handles = list(set(driver.window_handles) - before_handles)
            if new_handles:
                opened_handle = new_handles[0]
                driver.switch_to.window(opened_handle)
                keep_browser_hidden(driver)
                wait_document_ready(driver, timeout=15)
                break
            time.sleep(0.2)

        pdf_url = _find_current_pdf_url(driver)
        if pdf_url:
            pdf_path = pdf_processor.download_pdf_with_cookies(driver, pdf_url, f"rights_status_survey_{safe_task_id}")
            if pdf_processor.is_valid_pdf(pdf_path):
                return extract_pdf_text(pdf_path)
        try:
            return driver.find_element(By.TAG_NAME, "body").text
        except Exception:
            return ""
    except Exception as e:
        logger.info(f"현황조사서 기타 확인 생략: {e}")
        return ""
    finally:
        try:
            driver.switch_to.default_content()
        except Exception:
            pass
        try:
            if opened_handle and opened_handle in driver.window_handles:
                driver.close()
                driver.switch_to.window(base_handle)
            elif base_handle in driver.window_handles:
                driver.switch_to.window(base_handle)
                if driver.current_url != base_url:
                    driver.get(base_url)
                    wait_document_ready(driver, timeout=15)
        except Exception:
            pass


def _open_status_survey_document(driver) -> None:
    direct_url = myauction_document_url(driver.current_url, "status")
    if direct_url:
        driver.get(direct_url)
        wait_document_ready(driver)
        return
    wait = WebDriverWait(driver, 8)
    candidates = [
        (By.PARTIAL_LINK_TEXT, "현황조사서"),
        (By.XPATH, "//div[@id='dtlw_link']//a[contains(normalize-space(.), '현황조사서')]"),
        (By.XPATH, "//a[contains(normalize-space(.), '현황조사서')]"),
    ]
    last_error = None
    for by, value in candidates:
        try:
            el = wait.until(EC.element_to_be_clickable((by, value)))
            safe_click(driver, el)
            time.sleep(1)
            return
        except Exception as e:
            last_error = e
    raise last_error if last_error else RuntimeError("현황조사서 링크를 찾지 못했습니다.")


def _extract_status_survey_etc_from_text(text: str) -> str:
    lines = [
        re.sub(r"\s+", " ", line).strip()
        for line in (text or "").splitlines()
        if re.sub(r"\s+", " ", line).strip()
    ]
    for idx, line in enumerate(lines):
        compact = line.replace(" ", "")
        if compact in ("기타", "기타사항") or "그밖의사항" in compact or "기타사항" in compact:
            same_line = re.sub(r"^\s*(?:기타사항|기타|그 밖의 사항|그밖의사항)\s*[:：]?\s*", "", line)
            collected = [same_line] if same_line and same_line != line else []
            for next_line in lines[idx + 1: idx + 8]:
                if any(next_line.startswith(word) for word in ("첨부", "작성", "사건", "부동산의 표시", "점유관계", "임대차관계")):
                    break
                collected.append(next_line)
            note = _clean_document_note(" ".join(collected))
            if note:
                return note
    return ""


def collect_case_document_text(driver) -> str:
    if not driver:
        return ""

    base_handle = driver.current_window_handle
    base_url = driver.current_url
    before_handles = set(driver.window_handles)
    opened_handle = ""

    try:
        _open_case_document_list(driver)
        end = time.time() + 8
        while time.time() < end:
            new_handles = list(set(driver.window_handles) - before_handles)
            if new_handles:
                opened_handle = new_handles[0]
                driver.switch_to.window(opened_handle)
                keep_browser_hidden(driver)
                wait_document_ready(driver, timeout=15)
                break
            time.sleep(0.2)

        try:
            body_text = driver.find_element(By.TAG_NAME, "body").text
        except Exception:
            body_text = ""
        return _extract_case_document_signal_text(body_text)
    except Exception as e:
        logger.info(f"문건접수 내역 확인 생략: {e}")
        return ""
    finally:
        try:
            driver.switch_to.default_content()
        except Exception:
            pass
        try:
            if opened_handle and opened_handle in driver.window_handles:
                driver.close()
                driver.switch_to.window(base_handle)
            elif base_handle in driver.window_handles:
                driver.switch_to.window(base_handle)
                if driver.current_url != base_url:
                    driver.get(base_url)
                    wait_document_ready(driver, timeout=15)
        except Exception:
            pass


def _open_case_document_list(driver) -> None:
    wait = WebDriverWait(driver, 8)
    candidates = [
        (By.PARTIAL_LINK_TEXT, "문건접수"),
        (By.PARTIAL_LINK_TEXT, "문건"),
        (By.XPATH, "//div[@id='dtlw_link']//a[contains(normalize-space(.), '문건접수') or contains(normalize-space(.), '문건')]"),
        (By.XPATH, "//a[contains(normalize-space(.), '문건접수') or contains(normalize-space(.), '문건')]"),
    ]
    last_error = None
    for by, value in candidates:
        try:
            el = wait.until(EC.element_to_be_clickable((by, value)))
            safe_click(driver, el)
            time.sleep(1)
            return
        except Exception as e:
            last_error = e
    raise last_error if last_error else RuntimeError("문건접수 링크를 찾지 못했습니다.")


def _extract_case_document_signal_text(text: str) -> str:
    lines = [
        re.sub(r"\s+", " ", line).strip()
        for line in (text or "").splitlines()
        if re.sub(r"\s+", " ", line).strip()
    ]
    signal_keywords = (
        "유치권",
        "공사대금",
        "배제신청",
        "유치권배제",
        "유치권 배제",
        "권리신고",
        "권리 신고",
    )
    selected = []
    for idx, line in enumerate(lines):
        compact = re.sub(r"\s+", "", line)
        if not any(re.sub(r"\s+", "", keyword) in compact for keyword in signal_keywords):
            continue
        start = max(0, idx - 1)
        end = min(len(lines), idx + 2)
        selected.extend(lines[start:end])

    if selected:
        return _clean_document_note(" ".join(_dedupe_text_lines(selected)), limit=1200)
    return ""


def _dedupe_text_lines(lines: list[str]) -> list[str]:
    result = []
    seen = set()
    for line in lines:
        key = re.sub(r"\s+", "", line or "")
        if not key or key in seen:
            continue
        seen.add(key)
        result.append(line)
    return result


def collect_sale_spec_text_and_images(driver, safe_task_id: str, deadline: Optional[float] = None) -> tuple[str, list[str]]:
    base_handle = driver.current_window_handle
    base_url = driver.current_url
    before_handles = set(driver.window_handles)
    opened_handle = ""
    image_pattern = str(CAPTURE_DIR / f"rights_sale_spec_{safe_task_id}_{{page}}.png")
    pdf_text = ""

    try:
        _open_sale_spec_document(driver)
        end = time.time() + 8
        while time.time() < end:
            new_handles = list(set(driver.window_handles) - before_handles)
            if new_handles:
                opened_handle = new_handles[0]
                driver.switch_to.window(opened_handle)
                keep_browser_hidden(driver)
                wait_document_ready(driver, timeout=15)
                break
            time.sleep(0.2)

        pdf_url = _find_current_pdf_url(driver)
        if not pdf_url:
            try:
                wait = WebDriverWait(driver, 8)
                click_tab_safe(wait, driver, ["매각물건명세서", "물건명세서"])
                time.sleep(1)
                pdf_url = _find_current_pdf_url(driver)
            except Exception:
                pass

        if pdf_url:
            pdf_path = pdf_processor.download_pdf_with_cookies(driver, pdf_url, f"rights_sale_spec_{safe_task_id}")
        else:
            pdf_path = pdf_processor.print_current_page_to_pdf(driver, f"rights_sale_spec_{safe_task_id}", landscape=True)

        if not pdf_processor.is_valid_pdf(pdf_path):
            return "", _capture_current_page_as_image(driver, safe_task_id)

        pdf_text = extract_pdf_text(pdf_path)
        remaining = (deadline - time.monotonic()) if deadline else 90
        if remaining <= 0:
            return pdf_text, []
        total = pdf_processor.pdf_to_images(
            pdf_path,
            image_pattern,
            dpi=300,
            timeout_seconds=min(90, max(1, int(remaining))),
        )
        return pdf_text, [image_pattern.format(page=i) for i in range(1, total + 1) if os.path.exists(image_pattern.format(page=i))]
    except Exception as e:
        logger.warning(f"매각물건명세서 이미지 생성 실패: {e}")
        return "", []
    finally:
        try:
            driver.switch_to.default_content()
        except Exception:
            pass
        try:
            if opened_handle and opened_handle in driver.window_handles:
                driver.close()
                driver.switch_to.window(base_handle)
            elif base_handle in driver.window_handles:
                driver.switch_to.window(base_handle)
                if driver.current_url != base_url:
                    driver.get(base_url)
                    wait_document_ready(driver, timeout=15)
        except Exception:
            pass


def capture_sale_spec_images(driver, safe_task_id: str) -> list[str]:
    _, image_paths = collect_sale_spec_text_and_images(driver, safe_task_id)
    return image_paths


def _open_sale_spec_document(driver) -> None:
    direct_url = myauction_document_url(driver.current_url, "mul")
    if direct_url:
        driver.get(direct_url)
        wait_document_ready(driver)
        return
    wait = WebDriverWait(driver, 8)
    candidates = [
        (By.PARTIAL_LINK_TEXT, "매각물건명세서"),
        (By.PARTIAL_LINK_TEXT, "물건명세서"),
        (By.XPATH, "//div[@id='dtlw_link']//a[contains(normalize-space(.), '매각물건명세서') or contains(normalize-space(.), '물건명세서')]"),
        (By.CSS_SELECTOR, "#dtlw_link > ul > li:nth-child(5) > a"),
    ]
    last_error = None
    for by, value in candidates:
        try:
            el = wait.until(EC.element_to_be_clickable((by, value)))
            safe_click(driver, el)
            time.sleep(1)
            return
        except Exception as e:
            last_error = e
    raise last_error if last_error else RuntimeError("매각물건명세서 링크를 찾지 못했습니다.")


def _find_current_pdf_url(driver) -> str:
    try:
        driver.switch_to.default_content()
    except Exception:
        pass

    current_url = driver.current_url or ""
    if ".pdf" in current_url.lower():
        return current_url

    selectors = [
        "iframe#detail_target",
        "iframe[src]",
        "embed[src]",
        "object[data]",
    ]
    for selector in selectors:
        try:
            for el in driver.find_elements(By.CSS_SELECTOR, selector):
                src = el.get_attribute("src") or el.get_attribute("data") or ""
                if src and (".pdf" in src.lower() or "pdf" in src.lower()):
                    return urljoin(current_url, src)
        except Exception:
            continue
    return ""


def _capture_current_page_as_image(driver, safe_task_id: str) -> list[str]:
    out_path = str(CAPTURE_DIR / f"rights_sale_spec_{safe_task_id}_page.png")
    try:
        image = capturer._capture_fullpage_png(driver)
        image.save(out_path, "PNG")
        return [out_path]
    except Exception as e:
        logger.warning(f"매각물건명세서 화면 캡처 실패: {e}")
        return []


def extract_pdf_text(pdf_path: str) -> str:
    try:
        doc = fitz.open(pdf_path)
        try:
            return "\n".join(doc.load_page(i).get_text("text") or "" for i in range(doc.page_count))
        finally:
            doc.close()
    except Exception as e:
        logger.warning(f"PDF 텍스트 추출 실패({pdf_path}): {e}")
        return ""


def ocr_image_to_text(image_path: str, timeout_seconds: int = 30) -> str:
    if not pytesseract:
        return ""
    try:
        img = Image.open(image_path).convert("RGB")
        img = ImageOps.grayscale(img)
        img = ImageEnhance.Contrast(img).enhance(1.8)
        img = ImageOps.autocontrast(img)
        try:
            return pytesseract.image_to_string(img, lang="kor+eng", config="--psm 6", timeout=timeout_seconds)
        except RuntimeError as exc:
            if "timeout" in str(exc).lower():
                logger.warning(f"이미지 OCR {timeout_seconds}초 제한시간 초과({image_path})")
                return ""
            return pytesseract.image_to_string(img, config="--psm 6", timeout=timeout_seconds)
    except Exception as e:
        logger.warning(f"이미지 텍스트 확인 실패({image_path}): {e}")
        return ""


def normalize_ocr_text(text: str) -> str:
    lines = []
    for line in (text or "").splitlines():
        cleaned = re.sub(r"[ \t]+", " ", line).strip()
        if cleaned:
            lines.append(cleaned)
    return "\n".join(lines)


def parse_sale_spec_tenants_from_pdf_text(text: str) -> list[dict]:
    lines = _sale_spec_occupancy_lines(text)
    if not lines:
        return []

    table_tenants = _parse_sale_spec_tenant_table_lines(lines)
    if table_tenants:
        return table_tenants
    # 셀이 세로로 쪼개진 점유자 표(다가구·상가 다수임차인)는 블록 파서로 임차인별 재구성.
    block_tenants = _parse_sale_spec_occupancy_blocks(lines)
    if len(block_tenants) >= 2:
        return block_tenants
    if _tenant_ocr_text_confirms_no_surveyed_tenants(text) or _tenant_ocr_text_indicates_no_tenants(text):
        return [_no_tenant_record()]
    if block_tenants:
        return block_tenants

    name = _guess_sale_spec_name_from_lines(lines)
    occupancy_type = _guess_sale_spec_occupancy_type_from_lines(lines)
    money_entries = [
        (idx, parse_money(line))
        for idx, line in enumerate(lines)
        if parse_money(line) > 0
    ]
    deposit_idx = -1
    deposit = 0
    rent = 0
    if money_entries:
        deposit_idx, deposit = money_entries[0]
        if len(money_entries) > 1:
            rent = money_entries[1][1]

    date_entries = [
        (idx, normalize_date(match.group(0)))
        for idx, line in enumerate(lines)
        for match in re.finditer(r"\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}", line)
    ]
    if deposit_idx >= 0:
        dates = [date for idx, date in date_entries if idx > deposit_idx]
    else:
        dates = [date for _, date in date_entries]

    tenant = {
        "name": name,
        "occupancyType": occupancy_type,
        "type": occupancy_type,
        "deposit": deposit,
        "rent": rent,
        "moveInDate": dates[0] if len(dates) > 0 else "",
        "fixedDate": dates[1] if len(dates) > 1 else "",
        "depositClaimDate": dates[2] if len(dates) > 2 else "",
        "depositDeadline": "",
        "isHUG": "주택도시보증공사" in text or "HUG" in text.upper(),
        "isVacant": "공실" in text,
        "_parse_method": "summary_fallback",
    }
    tenant.update(_extract_increase_context(text))

    if tenant["name"] and not _looks_like_person_name(tenant["name"]):
        tenant["name"] = ""
    if not tenant["name"] and not tenant["deposit"] and not tenant["moveInDate"]:
        return []
    if not tenant["name"] and not tenant["deposit"]:
        return []
    tenant["name"] = tenant["name"] or "미확인 점유자"
    tenant["occupancyType"] = tenant["occupancyType"] or "미확인"
    tenant["type"] = tenant["occupancyType"]
    return [tenant]


def _parse_sale_spec_tenant_table_lines(lines: list[str]) -> list[dict]:
    """Parse sale-spec occupancy rows without collapsing the whole table to one tenant.

    매각물건명세서의 점유자 표는 PDF text/OCR에서 한 줄에 한 행으로 나오기도
    하고, 성명 셀이 rowspan 처리되어 다음 행(권리신고/등기사항전부증명서)에
    이름이 빠져 나오기도 한다.  기존 단일 요약 파서는 이 표 전체에서 첫 이름과
    첫 금액만 뽑아 한 명으로 압축했기 때문에 다수 임차인 사건의 권리분석이
    첫 임차인만 표시되었다.  이 함수는 행 단위로 이름·출처·일자·금액을 읽고,
    이름이 생략된 후속 행은 직전 이름에 병합한다.
    """

    tenants_by_name: dict[str, dict] = {}
    order: list[str] = []
    last_name = ""

    for raw_line in lines:
        line = _clean_inline_for_sale_spec_row(raw_line)
        if not line or _is_tenant_header_line(line):
            continue
        if _line_is_sale_spec_notice(line):
            break

        parsed = _parse_sale_spec_tenant_table_line(line, last_name)
        if not parsed:
            continue

        name = parsed.get("name") or ""
        if not name:
            continue
        last_name = name

        if name not in tenants_by_name:
            tenants_by_name[name] = parsed
            order.append(name)
            continue

        tenants_by_name[name] = _merge_sale_spec_tenant_rows(tenants_by_name[name], parsed)

    tenants = [tenants_by_name[name] for name in order]
    return _dedupe_by(tenants, ("name", "occupancyType", "moveInDate", "deposit", "rent"))


# ── 세로로 쪼개진 점유자 표(열 구조) 전용 블록 파서 ───────────────────────────
# 매각물건명세서 PDF/OCR이 점유자 표의 '셀'을 한 줄에 하나씩 세로로 뱉어, 한 줄에
# 이름+정보출처+날짜가 함께 오지 않는 경우(다가구·상가 다수임차인)를 처리한다.
# 정보출처(현황조사/권리신고/등기사항전부증명서)를 '행 앵커'로 삼고, 이름은 마커 앞
# 토큰에서, 보증금·차임·전입·확정·배당요구는 마커 뒤에서 읽어 임차인별로 재구성한다.
_OCC_SRC_MARKERS = ("현황조사", "권리신고", "등기사항전부증명서", "등기사항전")
_OCC_TENURE = ("점포", "주거", "임차인", "임차권자", "임차권", "전차인")
_OCC_LEGAL_PREFIX = ("주식회사", "유한회사", "사단법인", "재단법인", "협동조합", "농업회사법인", "합자회사", "합명회사", "유한책임회사")
# 열 제목·정보출처 꼬리 등 '이름이 아닌' 고정 토큰 (가짜 임차인화 방지)
_OCC_NOISE = {
    "부증명서", "증명서", "점유개시일자", "점유개시", "개시일자", "점유개시일",
    "전입신고일자", "확정일자", "배당요구일자", "배당요구", "사업자등록", "신청일자",
    "점유부분", "정보출처", "점유자", "성명", "권원", "보증금", "임대차기간", "점유기간",
}
_OCC_DATE_RE = re.compile(r"^\d{4}[.\-/]\s?\d{1,2}[.\-/]\s?\d{1,2}")
_OCC_MONEY_RE = re.compile(r"^\d{1,3}(?:,\d{3})+$|^\d{4,}$")


def _occ_is_part(tok: str) -> bool:
    """점유부분/부가정보(점유자 이름이 아님) 토큰 판별."""
    t = str(tok).strip()
    if not t:
        return True
    if re.match(r"^\d+\s*층", t) or re.match(r"^\d+\s*호", t):
        return True
    if t in ("전부", "지하", "지하실", "별지", "표시", "건물", "중", "면", "도면", "일부", "-", "~", "호", "층", "동"):
        return True
    if re.search(r"㎡|별지|도면|기타란|기재상|사보고|현황조$|^서$|항$|호\(|민등록|등본상|㉠|㉡", t):
        return True
    if re.fullmatch(r"[ㄱ-ㅎ,.·]+", t):
        return True
    return False


def _occ_is_name_token(tok: str) -> bool:
    t = str(tok).strip()
    if not t or t in _OCC_TENURE or t in ("미상", "부터", "까지", "없음", "-", "소유자", "채무자"):
        return False
    if t in _OCC_SRC_MARKERS or t in _OCC_NOISE:
        return False
    if _OCC_DATE_RE.match(t) or _OCC_MONEY_RE.match(t):
        return False
    if _occ_is_part(t):
        return False
    if re.fullmatch(r"[가-힣]{1,}", t):
        return True
    if re.fullmatch(r"[A-Za-z]{2,}", t):  # 외국인 영문명(SUN YUN HAO 등)
        return True
    return False


def _occ_join_name(toks: list[str]) -> str:
    if not toks:
        return ""
    if all(re.fullmatch(r"[가-힣]+", x) for x in toks):
        s = "".join(toks)
    else:
        s = " ".join(toks)
    for p in _OCC_LEGAL_PREFIX:
        if s.startswith(p) and len(s) > len(p):
            return p + " " + s[len(p):]
    return s


def _parse_sale_spec_occupancy_blocks(lines: list[str]) -> list[dict]:
    tokens: list[str] = []
    for ln in lines:
        tokens.extend(str(ln).split())

    tenants: list[dict] = []
    cur: Optional[dict] = None
    name_buf: list[str] = []
    name_locked = False

    def _new(name: str) -> dict:
        return {
            "name": name, "occupancyType": "", "type": "", "deposit": 0, "rent": 0,
            "moveInDate": "", "fixedDate": "", "depositClaimDate": "", "depositDeadline": "",
            "isHUG": False, "isVacant": False,
            "_after_money_dates": [], "_before_dates": [], "_parse_method": "table_row",
        }

    for i, tok in enumerate(tokens):
        prev = tokens[i - 1] if i > 0 else ""
        nxt = tokens[i + 1] if i + 1 < len(tokens) else ""

        if tok in _OCC_SRC_MARKERS:
            name = _occ_join_name(name_buf)
            name_buf = []
            name_locked = False
            if name:
                cur = _new(name)
                tenants.append(cur)
            elif cur is None:
                cur = _new("")
                tenants.append(cur)
            continue

        if cur is not None:
            if tok in ("부터", "까지"):
                continue
            if _OCC_MONEY_RE.match(tok):
                value = int(tok.replace(",", ""))
                if cur["deposit"] == 0:
                    cur["deposit"] = value
                elif cur["rent"] == 0:
                    cur["rent"] = value
                continue
            if _OCC_DATE_RE.match(tok):
                is_lease = nxt in ("부터", "까지") or prev in ("부터", "까지") or tok.endswith("~") or prev.endswith("~")
                if not is_lease:
                    norm = normalize_date(tok)
                    (cur["_after_money_dates"] if cur["deposit"] > 0 else cur["_before_dates"]).append(norm)
                continue
            if any(keyword in tok for keyword in _OCC_TENURE):
                cur["occupancyType"] = (cur["occupancyType"] + " " + tok).strip()
                continue
            if "주택도시보증공사" in tok or tok.upper() == "HUG":
                cur["isHUG"] = True
            if tok == "공실":
                cur["isVacant"] = True
            if tok == "미상":
                continue

        if _occ_is_part(tok):
            if name_buf:
                name_locked = True
            continue
        if (not name_locked) and _occ_is_name_token(tok):
            name_buf.append(tok)

    for tenant in tenants:
        dates = tenant["_after_money_dates"] or tenant["_before_dates"]
        tenant["moveInDate"] = dates[0] if len(dates) > 0 else ""
        tenant["fixedDate"] = dates[1] if len(dates) > 1 else ""
        tenant["depositClaimDate"] = dates[2] if len(dates) > 2 else ""
        occ = tenant["occupancyType"]
        if "점포" in occ or "상가" in occ:
            tenant["occupancyType"] = "상가 임차인"
        elif "주거" in occ:
            tenant["occupancyType"] = "주거 임차인"
        elif "임차" in occ:
            tenant["occupancyType"] = "임차인"
        else:
            tenant["occupancyType"] = "미확인"
        tenant["type"] = tenant["occupancyType"]
        tenant["name"] = tenant["name"] or "미확인 점유자"
        for key in ("_after_money_dates", "_before_dates"):
            tenant.pop(key, None)

    # 이름(사람 또는 법인) 또는 보증금·차임·전입/확정 중 아무 것도 없는 블록은 버린다.
    # (법인명은 5자를 넘어 _looks_like_person_name을 통과하지 못하므로 이름 공백 여부로 판정)
    def _has_signal(t: dict) -> bool:
        name = str(t.get("name") or "").strip()
        has_name = bool(name) and name != "미확인 점유자"
        return (
            has_name
            or parse_money(t.get("deposit")) > 0
            or parse_money(t.get("rent")) > 0
            or any(_has_valid_date(t.get(k) or "") for k in ("moveInDate", "fixedDate", "depositClaimDate"))
        )

    tenants = [t for t in tenants if _has_signal(t)]
    return _dedupe_by(tenants, ("name", "occupancyType", "moveInDate", "deposit", "rent"))


def _select_best_sale_spec_tenants(*tenant_sets: list[dict]) -> list[dict]:
    """Choose the richest sale-spec tenant parse instead of trusting first hit.

    Some court PDFs expose an embedded text layer that collapses a multi-row
    tenant table into one pseudo row.  In that case the old ``pdf or ocr``
    selection returned the single fallback tenant and discarded the OCR result,
    even when OCR had read all 현황조사 rows.  Prefer the parse with more real
    occupant names; use the single summary fallback only when no richer table
    parse exists.
    """

    candidates: list[list[dict]] = []
    for tenants in tenant_sets:
        cleaned = [
            dict(tenant)
            for tenant in (tenants or [])
            if tenant and not _is_no_tenant_record(tenant)
        ]
        if cleaned:
            candidates.append(_dedupe_by(cleaned, ("name", "occupancyType", "moveInDate", "deposit", "rent")))

    if not candidates:
        return []

    structured_candidates = [
        tenants
        for tenants in candidates
        if sum(1 for tenant in tenants if tenant.get("_parse_method") == "table_row") >= 2
    ]
    if structured_candidates:
        candidates = structured_candidates

    best = max(candidates, key=_sale_spec_tenant_parse_score)
    # If OCR/table parsing found multiple occupants, do not merge values from a
    # one-row summary fallback.  Such fallbacks commonly pair the first visible
    # name with a later tenant's deposit and caused the production "one tenant"
    # regression.
    if len(best) > 1:
        return best

    return best


def _sale_spec_tenant_parse_score(tenants: list[dict]) -> tuple[int, int, int, int, int]:
    valid = [tenant for tenant in (tenants or []) if tenant and not _is_no_tenant_record(tenant)]
    named = sum(1 for tenant in valid if _looks_like_person_name(tenant.get("name") or ""))
    unknown = len(valid) - named
    dated = sum(
        1
        for tenant in valid
        if any(_has_valid_date(tenant.get(key) or "") for key in ("moveInDate", "fixedDate", "depositClaimDate"))
    )
    money = sum(
        1
        for tenant in valid
        if parse_money(tenant.get("deposit")) > 0 or parse_money(tenant.get("rent")) > 0
    )
    table_rows = sum(1 for tenant in valid if tenant.get("_parse_method") == "table_row")
    # 매각물건명세서 '점유자 영역'에서 읽은 결과(_parse_method 가 table_row 또는 summary_fallback)는
    # 전문서 OCR(비고란·등기 문장까지 훑어 '가압류'·'전액'·'있는'·'변제' 같은 조각을 이름으로
    # 만드는)보다 신뢰한다. 셀이 한 줄씩 쪼개져 table_row 가 안 잡혀도 summary_fallback 으로
    # 점유자 영역만 읽은 결과가 전문서 OCR보다 정확하다. (서울서부 2024타경 사례 회귀 방지)
    occupancy_region = sum(
        1 for tenant in valid if tenant.get("_parse_method") in ("table_row", "summary_fallback")
    )
    if table_rows:
        return (3, table_rows, named, dated + money, -unknown)
    if occupancy_region:
        return (2, occupancy_region, named, dated + money, -unknown)
    if named:
        return (1, named, dated + money, -unknown, 0)
    return (0, len(valid), dated + money, 0, 0)


def _looks_like_person_name(value: str) -> bool:
    text = re.sub(r"\s+", "", str(value or ""))
    if not re.fullmatch(r"[가-힣]{2,5}", text):
        return False
    blocked = {
        "미확인",
        "점유자",
        "임차인",
        "소유자",
        "채무자",
        "근저당권",
        "최선순위",
        "부증명서",
        "차권등기",
        "록신청일자",
        "신고일자",
        "전입일자",
        "확정일자",
        "배당일자",
        "배당요구",
        "사업자등",
        "권원",
        "기간",
        "작성일자",
        "담당법관",
        "담당자확인",
        "미확인점유자",
        "조사된",
        "가압류",
        "압류",
        "전액",
        "대항력",
        "우선변제",
    }
    return text not in blocked


# 조사/연결어미로 끝나는 토큰은 사람 이름이 아니라 문장 조각이다.
# (예: "대항요건을", "있고", "갖추고", "하였음", "하였습니다") — 산문에서 이름을 잘못 추출하는 회귀 방지.
_NON_NAME_SUFFIX_CHARS = set("을를과와며고음함됨로다요할")
_NON_NAME_SUFFIXES_MULTI = (
    "으로", "에서", "에게", "까지", "부터", "보다", "처럼",
    "라도", "든지", "이나", "거나", "지만", "는데", "면서",
)

# 문장(산문) 신호. 매각물건명세서 비고란·현황조사서 서술문에서 이름을 추측하지 않도록
# 이 신호가 있으면 추측을 중단한다. (표 형태의 임차인 행에는 이런 종결/연결어미가 없다.)
_PROSE_SIGNAL_RE = re.compile(
    r"(습니다|합니다|됩니다|입니다|있고|없고|하였|되었|으며|하여|되어|때문|경우|바랍니다|않습|있으며|없으며|그리고|또한)"
)


def _is_name_like_token(value: str) -> bool:
    """산문 토큰에서 임차인 이름 후보를 고를 때 쓰는 더 엄격한 판정.

    라벨('성명')로 명시 추출된 이름을 검증하는 ``_looks_like_person_name`` 보다
    보수적으로, 조사/연결어미로 끝나는 문장 조각을 배제한다. (라벨 추출 경로에는
    적용하지 않으므로 '고/로' 등으로 끝나는 실제 이름이 손상되지 않는다.)
    """
    text = re.sub(r"\s+", "", str(value or ""))
    if not _looks_like_person_name(text):
        return False
    if any(text.endswith(suffix) for suffix in _NON_NAME_SUFFIXES_MULTI):
        return False
    if len(text) >= 2 and text[-1] in _NON_NAME_SUFFIX_CHARS:
        return False
    return True


def _clean_inline_for_sale_spec_row(value: str) -> str:
    text = re.sub(r"\s+", " ", str(value or "").replace("\xa0", " ")).strip()
    text = text.replace("ㆍ", ".")
    return text


def _line_is_sale_spec_notice(line: str) -> bool:
    compact = re.sub(r"\s+", "", line or "")
    return any(token in compact for token in (
        "최선순위설정일자보다",
        "등기된부동산에관한권리",
        "매각으로그효력",
        "비고",
    ))


def _parse_sale_spec_tenant_table_line(line: str, previous_name: str = "") -> dict:
    compact = re.sub(r"\s+", "", line or "")
    if not compact:
        return {}
    # 서술형(산문) 문장은 매각물건명세서 점유자 '표의 행'이 아니다. 비고란·각주 문장
    # ("...임차인은 대항요건을 갖추고 있고...")을 행으로 오인해 조각을 임차인으로
    # 만들던 회귀 방지. (실제 표 행에는 종결/연결어미가 없다.)
    if _PROSE_SIGNAL_RE.search(line or ""):
        return {}
    if not any(token in compact for token in ("현황조사", "권리신고", "등기사항전부증명서", "등기사항전", "임차인")):
        return {}
    if not any(token in compact for token in ("임차인", "전입", "현황조사", "권리신고", "등기사항전")):
        return {}

    source_match = re.search(r"(현황조사|권리신고|등기사항전부증명서|등기사항전\s*부증명서|등기사항전)", line)
    if not source_match:
        return {}
    source_start = source_match.start()
    before_source = line[:source_start].strip(" /,|")
    name = _sale_spec_name_before_source(before_source) or previous_name

    dates = [normalize_date(d) for d in re.findall(r"\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}", line)]
    amounts = _sale_spec_money_amounts(line)
    occupancy_type = _guess_occupancy_type(line) or _guess_sale_spec_occupancy_type_from_lines([line])
    if "주거" in compact and "임차인" in compact:
        occupancy_type = "주거 임차인"
    elif "상가" in compact and "임차인" in compact:
        occupancy_type = "상가 임차인"
    elif "임차인" in compact and not occupancy_type:
        occupancy_type = "임차인"

    deposit = 0
    rent = 0
    if amounts:
        # The largest/first large amount is normally the deposit.  Monthly rent
        # follows it and is much smaller; keep order for table rows.
        deposit = amounts[0]
        if len(amounts) >= 2:
            rent = amounts[1]

    move_in = ""
    fixed = ""
    claim = ""
    if deposit > 0 and len(dates) >= 3:
        # In sale-spec rows with 보증금/차임 the first date is often 임대차기간
        # start; the following dates are 전입, 확정, 배당요구일.
        move_in = dates[1]
        fixed = dates[2]
        claim = dates[3] if len(dates) >= 4 else ""
    elif dates:
        move_in = dates[0]
        fixed = dates[1] if len(dates) >= 2 else ""
        claim = dates[2] if len(dates) >= 3 else ""

    if not name and not move_in and deposit <= 0:
        return {}

    tenant = {
        "name": name or "미확인 점유자",
        "occupancyType": occupancy_type or "미확인",
        "type": occupancy_type or "미확인",
        "deposit": deposit,
        "rent": rent,
        "moveInDate": move_in,
        "fixedDate": fixed,
        "depositClaimDate": claim,
        "depositDeadline": "",
        "isHUG": "주택도시보증공사" in line or "HUG" in line.upper(),
        "isVacant": "공실" in line,
        "source": source_match.group(1).replace(" ", ""),
        "_parse_method": "table_row",
    }
    tenant.update(_extract_increase_context(line))
    return tenant


def _sale_spec_name_before_source(value: str) -> str:
    text = re.sub(r"\d+층|\d+호|\d+\s*층|\d+\s*호", " ", value or "")
    text = re.sub(r"[0-9.,/|()]+", " ", text)
    tokens = [token.strip() for token in text.split() if token.strip()]
    blocked = {"주거", "상가", "임차인", "점유자", "성명", "점유", "부분", "권원", "전부", "일부"}
    for token in reversed(tokens):
        # 키워드에 조사가 붙은 토큰('임차인은', '점유자가' 등)도 제외한다.
        if any(token.startswith(word) for word in blocked):
            continue
        # 조사/어미로 끝나는 문장 조각('대항요건을', '있고' 등)을 이름으로 뽑지 않는다.
        if _is_name_like_token(token):
            return token
    return ""


def _sale_spec_money_amounts(line: str) -> list[int]:
    amounts: list[int] = []
    for raw in re.findall(r"\d{1,3}(?:,\d{3})+|\d{4,}", line or ""):
        # Dates can be fragmented as 2025 or 2020 when OCR drops separators.
        if re.fullmatch(r"\d{4}", raw):
            continue
        try:
            amount = int(raw.replace(",", ""))
        except ValueError:
            continue
        if amount >= 10_000:
            amounts.append(amount)
    return amounts


def _merge_sale_spec_tenant_rows(base: dict, incoming: dict) -> dict:
    merged = dict(base)
    for key in ("occupancyType", "type", "moveInDate", "fixedDate", "depositClaimDate", "depositDeadline", "source"):
        if not merged.get(key) and incoming.get(key):
            merged[key] = incoming[key]
    for key in ("deposit", "rent"):
        if parse_money(merged.get(key)) <= 0 and parse_money(incoming.get(key)) > 0:
            merged[key] = incoming[key]
    for key in ("isHUG", "isVacant", "hasIncrease"):
        merged[key] = bool(merged.get(key) or incoming.get(key))
    if not merged.get("increaseFixedDate") and incoming.get("increaseFixedDate"):
        merged["increaseFixedDate"] = incoming["increaseFixedDate"]
    return merged


def parse_sale_spec_document_context(text: str) -> dict:
    lines = [
        re.sub(r"\s+", " ", line).strip()
        for line in (text or "").splitlines()
        if re.sub(r"\s+", " ", line).strip()
    ]
    context = {}
    base_right = {}
    dividend_deadline = ""

    for idx, line in enumerate(lines):
        compact = line.replace(" ", "")
        if "최선순위" in compact or (compact == "설정" and idx > 0 and "최선순위" in lines[idx - 1].replace(" ", "")):
            window = "\n".join(lines[idx: idx + 6])
            date = _first_any_date(window)
            if date:
                base_right = {
                    "date": date,
                    "type": _first_match(window, RIGHT_TYPES) or _guess_right_type_after_date(window, date),
                    "creditor": "",
                }
                break

    for idx, line in enumerate(lines):
        compact = line.replace(" ", "")
        if "배당요구종기" in compact:
            window = "\n".join(lines[idx: idx + 4])
            dividend_deadline = _first_any_date(window)
            if dividend_deadline:
                break

    if base_right:
        context["baseRight"] = base_right
    if dividend_deadline:
        context["dividendDeadline"] = dividend_deadline
    remarks = _extract_sale_spec_remarks_from_lines(lines)
    if remarks:
        context["remarks"] = remarks
    return context


def _extract_sale_spec_remarks_from_lines(lines: list[str]) -> str:
    start_idx = -1
    for idx, line in enumerate(lines):
        compact = line.replace(" ", "")
        if "비고란" in compact or compact in ("비고", "비고사항"):
            start_idx = idx
            break
        if compact.startswith("비고") and len(compact) > 2:
            return _clean_document_note(re.sub(r"^\s*비고\s*[:：]?\s*", "", line))

    if start_idx < 0:
        return ""

    stop_words = ("사건", "작성", "담임법관", "부동산의 표시", "최선순위", "배당요구종기")
    collected = []
    for line in lines[start_idx + 1: start_idx + 51]:
        if any(line.startswith(word) for word in stop_words):
            break
        if line in ("없음", "해당없음", "해당 사항 없음"):
            return ""
        if line and not line.startswith("※"):
            collected.append(line)
    return _clean_document_note(" ".join(collected), limit=1200)


def _clean_document_note(value: str, limit: int = 260) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip(" /,|")
    if text in ("", "없음", "해당없음", "해당 사항 없음", "미상"):
        return ""
    return _clip_text(text, limit)


def _guess_right_type_after_date(text: str, date: str) -> str:
    after = text
    if date:
        numbers = re.findall(r"\d+", date)
        if len(numbers) >= 3:
            pattern = r"\s*[.\-/년월일]*\s*".join(map(re.escape, numbers[:3]))
            after = re.split(pattern, text, maxsplit=1)[-1]
    match = re.search(r"[가-힣A-Za-z]+", after)
    return match.group(0) if match else ""


def _extract_increase_context(text: str) -> dict:
    if not re.search(r"증액|증가|추가", text or ""):
        return {}
    lines = [
        re.sub(r"\s+", " ", line).strip()
        for line in (text or "").splitlines()
        if re.sub(r"\s+", " ", line).strip()
    ]
    for idx, line in enumerate(lines):
        if not re.search(r"증액|증가|추가", line):
            continue
        window = "\n".join(lines[max(0, idx - 2): idx + 4])
        fixed_date = _extract_date_after_keywords(window, ("확정일자", "확정일", "확정")) or _first_any_date(window)
        return {
            "hasIncrease": True,
            "increaseFixedDate": fixed_date,
        }
    return {"hasIncrease": True, "increaseFixedDate": ""}


def _sale_spec_occupancy_lines(text: str) -> list[str]:
    lines = [
        re.sub(r"\s+", " ", line).strip()
        for line in (text or "").splitlines()
        if re.sub(r"\s+", " ", line).strip()
    ]
    if not lines:
        return []

    header_idx = -1
    for idx, line in enumerate(lines):
        if "배당요구일자" in line or "(배당요구일자)" in line:
            header_idx = idx
    if header_idx < 0:
        return []

    stop_words = (
        "등기된 부동산",
        "매각에 따라",
        "부동산의 표시",
        "※1:",
        "비고란",
        "사건",
        "작성",
        "담임법관",
    )
    result = []
    for line in lines[header_idx + 1:]:
        if any(line.startswith(word) for word in stop_words):
            break
        result.append(line)
    return result


def _guess_sale_spec_name_from_lines(lines: list[str]) -> str:
    excluded = {
        "현황조사",
        "권리신고",
        "주거",
        "상가",
        "임차인",
        "전부",
        "일부",
        "미상",
        "없음",
        "권원",
    }
    for line in lines:
        if line in excluded:
            continue
        if _first_date(line) or parse_money(line):
            continue
        if any(word in line for word in ("점유", "보증금", "차임", "전입", "확정", "배당")):
            continue
        if _is_name_like_token(line):
            return line
    return ""


def _guess_sale_spec_occupancy_type_from_lines(lines: list[str]) -> str:
    for idx, line in enumerate(lines):
        compact = line.replace(" ", "")
        if "주거임차인" in compact:
            return "주거 임차인"
        if "상가임차인" in compact:
            return "상가 임차인"
        if line in ("주거", "상가") and idx + 1 < len(lines) and "임차인" in lines[idx + 1]:
            return f"{line} 임차인"
    for line in lines:
        if "임차인" in line:
            return "임차인"
    return ""


def parse_sale_spec_tenants_from_ocr(text: str) -> list[dict]:
    tenants = []
    current_deadline = ""
    explicit_survey_none = _tenant_ocr_text_confirms_no_surveyed_tenants(text)
    for raw_line in (text or "").splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if "배당요구종기" in line or "종기" in line:
            current_deadline = normalize_date(_first_date(line) or "")
        # 명세서 상단/하단 메타데이터(최선순위 설정·배당요구종기·근저당권·작성/법관 등)는
        # 점유자 표의 행이 아니다. '설정 2018.6.11 근저당권 배당요구종기 …' 줄에서
        # '설정'·'종기'를 임차인명으로 뽑던 회귀 방지.
        if _is_sale_spec_metadata_line(line):
            continue
        if not _looks_like_sale_spec_tenant_line(line):
            continue
        if _is_tenant_header_line(line):
            continue
        if _tenant_ocr_text_indicates_no_tenants(line):
            continue

        dates = [normalize_date(d) for d in re.findall(r"\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}", line)]
        labeled_name = _extract_labeled_value(line, ("점유자 성명", "점유자", "성명"))
        raw_name = labeled_name or _guess_sale_spec_tenant_name(line)
        name = raw_name if _looks_like_person_name(raw_name) else ""
        tenant = {
            "name": name,
            "occupancyType": _extract_labeled_value(line, ("점유구분", "점유관계", "점유 부분", "점유")) or _guess_occupancy_type(line),
            "type": _guess_occupancy_type(line),
            "deposit": _extract_money_after_keywords(line, ("보증금", "임대차보증금", "전세금")),
            "rent": _extract_money_after_keywords(line, ("차임", "월차임", "월세")),
            "moveInDate": _extract_date_after_keywords(line, ("전입일", "전입일자", "전입")) or (dates[0] if len(dates) > 0 else ""),
            "fixedDate": _extract_date_after_keywords(line, ("확정일", "확정일자", "확정")) or (dates[1] if len(dates) > 1 else ""),
            "depositClaimDate": _extract_date_after_keywords(line, ("배당요구일", "배당요구일자", "배당요구")) or (dates[2] if len(dates) > 2 else ""),
            "depositDeadline": "",
            "isHUG": "주택도시보증공사" in line or "HUG" in line.upper(),
            "isVacant": "공실" in line,
        }
        tenant.update(_extract_increase_context(line))

        if not _is_confident_sale_spec_ocr_tenant(
            tenant,
            line,
            explicit_survey_none,
            labeled_name=bool(labeled_name and _looks_like_person_name(labeled_name)),
        ):
            continue
        tenant["name"] = tenant["name"] or "미확인 점유자"
        tenant["occupancyType"] = tenant["occupancyType"] or "미확인"
        tenants.append(tenant)

    deduped = _dedupe_by(tenants, ("name", "occupancyType", "moveInDate", "deposit", "rent"))
    if not deduped and explicit_survey_none:
        return [_no_tenant_record(current_deadline)]
    return deduped


def _looks_like_sale_spec_tenant_line(line: str) -> bool:
    keywords = ("점유", "임차", "보증금", "차임", "월세", "전입", "확정", "배당요구")
    return any(k in line for k in keywords) or bool(re.search(r"\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}", line))


def _is_sale_spec_metadata_line(line: str) -> bool:
    """매각물건명세서의 점유자 표가 아닌 '메타데이터' 줄인지 판정한다.

    최선순위 설정일·배당요구종기·작성일자/담임법관·감정평가액 같은 머리말/꼬리말 줄은
    점유자 행이 아니다.  이런 줄에서 '설정'·'종기' 같은 단어나 설정일자를 임차인
    이름·전입일로 뽑아 '조사된 임차내역없음'인데도 가짜 임차인을 만들던 회귀를 막는다.
    """
    compact = re.sub(r"\s+", "", line or "")
    if not compact:
        return False
    if any(token in compact for token in (
        "최선순위", "배당요구종기", "담임법관", "사법보좌관", "작성일자",
        "감정평가액", "최저매각가격", "매각물건명세서", "부동산의표시", "전자서명",
    )):
        return True
    # '설정 … 근저당권/전세권/지상권/가등기/(가)압류' 형태의 말소기준 설정 줄
    if "설정" in compact and any(
        token in compact for token in ("근저당권", "저당권", "전세권", "지상권", "가등기", "압류", "가압류")
    ):
        return True
    return False


def _is_confident_sale_spec_ocr_tenant(
    tenant: dict,
    line: str,
    explicit_survey_none: bool = False,
    labeled_name: bool = False,
) -> bool:
    name = str(tenant.get("name") or "").strip()
    has_person_name = _looks_like_person_name(name)
    has_money = parse_money(tenant.get("deposit")) > 0 or parse_money(tenant.get("rent")) > 0
    has_dates = any(
        _has_valid_date(tenant.get(key) or "")
        for key in ("moveInDate", "fixedDate", "depositClaimDate")
    )
    compact = re.sub(r"\s+", "", line or "")
    has_structured_source = any(
        token in compact
        for token in ("현황조사", "권리신고", "등기사항전부증명서", "등기사항전")
    )
    has_tenant_context = any(token in compact for token in ("임차인", "주거임차", "상가임차", "점유자"))

    if explicit_survey_none and not (has_person_name or has_money):
        return False
    # 라벨('성명')로 명시 추출된 이름은 신뢰: 임차 맥락·구조적 출처만 있어도 임차인으로 인정한다.
    if labeled_name and (has_tenant_context or has_structured_source or has_money or has_dates):
        return True
    # 산문에서 추측한 이름만 있는 경우, 보증금·차임 또는 전입/확정/배당요구일 같은 '구조적 증거'가
    # 반드시 있어야 임차인으로 인정한다. (비고란·각주 문장에서 조각을 이름으로 뽑아 가짜 임차인을
    # 만드는 회귀 방지 — md §6 D04: 트리거는 데이터 필드에만, 양식 고정문·각주 제외)
    if has_person_name and (has_money or has_dates):
        return True
    if has_money and (has_structured_source or has_tenant_context):
        return True
    # A date by itself is often a deadline/header value; it is not enough to
    # create an unidentified tenant row.
    return False


def _ocr_text_has_tenant_signals(text: str) -> bool:
    if not text:
        return False
    keywords = ("매각물건명세서", "점유자", "점유구분", "보증금", "차임", "전입일", "확정일", "배당요구")
    return sum(1 for keyword in keywords if keyword in text) >= 2


def _is_tenant_header_line(line: str) -> bool:
    header_keywords = ("점유자 성명", "점유구분", "보증금", "차임", "전입일", "확정일", "배당요구일")
    return sum(1 for keyword in header_keywords if keyword in line) >= 4 and not re.search(r"\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}", line)


def _extract_labeled_value(line: str, labels: tuple[str, ...]) -> str:
    for label in labels:
        pattern = re.compile(
            re.escape(label) + r"\s*[:：]?\s*([^\n/|,]+)",
        )
        match = pattern.search(line)
        if not match:
            continue
        value = match.group(1).strip()
        value = re.split(r"\s+(?:점유구분|보증금|차임|월세|전입|확정|배당요구)", value)[0].strip()
        value = re.sub(r"[:：|,]+$", "", value).strip()
        if value and value not in labels:
            return value
    return ""


def _extract_date_after_keywords(line: str, labels: tuple[str, ...]) -> str:
    date_pattern = r"(\d{4}\s*(?:[.\-/년])\s*\d{1,2}\s*(?:[.\-/월])\s*\d{1,2}\s*\.?\s*일?)"
    for label in labels:
        match = re.search(re.escape(label) + r"\s*[:：]?\s*" + date_pattern, line)
        if match:
            return normalize_date(match.group(1))
    return ""


def _extract_money_after_keywords(line: str, labels: tuple[str, ...]) -> int:
    for label in labels:
        match = re.search(
            re.escape(label) + r"\s*[:：]?\s*((?:\d{1,3}(?:,\d{3})+|\d{4,})(?:\s*원)?)",
            line,
        )
        if match:
            return parse_money(match.group(1))
    return 0


def _guess_occupancy_type(line: str) -> str:
    for keyword in ("주거임차인", "상가임차인", "임차인", "소유자", "채무자", "점유자", "공실", "미상"):
        if keyword in line:
            return keyword
    return ""


def _guess_sale_spec_tenant_name(line: str) -> str:
    # 서술형(산문) 라인에서는 이름을 추측하지 않는다. (비고란/각주 문장에서 '대항요건을',
    #  '있고' 같은 문장 조각을 임차인명으로 뽑던 회귀 방지)
    if _PROSE_SIGNAL_RE.search(line or ""):
        return ""
    cleaned = re.sub(r"\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}", " ", line)
    cleaned = re.sub(r"\d{1,3}(?:,\d{3})+|\d{4,}\s*원?", " ", cleaned)
    cleaned = re.sub(
        r"(점유자\s*성명|점유자|성명|점유구분|점유관계|점유|보증금|임대차보증금|전세금|차임|월차임|월세|전입일자?|전입|확정일자?|확정|배당요구일자?|배당요구|임차인|소유자|채무자|공실|없음|미상)",
        " ",
        cleaned,
    )
    cleaned = re.sub(r"[:：|()\[\],./]", " ", cleaned)
    tokens = [t.strip() for t in cleaned.split() if t.strip()]
    for token in tokens:
        if _is_name_like_token(token):
            return token
    return ""


def parse_tenants_from_ocr(text: str) -> list[dict]:
    tenants = []
    current_deadline = ""
    explicit_survey_none = _tenant_ocr_text_confirms_no_surveyed_tenants(text)

    for raw_line in (text or "").splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if _tenant_ocr_text_indicates_no_tenants(line):
            continue
        compact_line = re.sub(r"\s+", "", line)
        if (
            any(token in compact_line for token in ("채무자(소유자)세대전입", "소유자세대전입"))
            and not any(token in compact_line for token in ("임차인", "보증금", "임대차"))
        ):
            continue
        if "배당요구종기" in line or "종기" in line:
            current_deadline = normalize_date(_first_date(line) or "")
        if not ("임차" in line or "전입" in line or "확정" in line or "보증" in line or _first_date(line)):
            continue
        if any(header in line for header in ("성명", "점유", "전입", "확정")) and not re.search(r"\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}", line):
            continue

        dates = [normalize_date(d) for d in re.findall(r"\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}", line)]
        deposit = parse_money(line)
        name = _guess_ocr_tenant_name(line)

        if explicit_survey_none and not (_looks_like_person_name(name) or deposit > 0):
            continue
        if not _looks_like_person_name(name):
            name = ""
        if not name and deposit <= 0:
            continue
        if not dates and not deposit and not name:
            continue
        tenants.append(
            {
                "name": name or "미확인 임차인",
                "type": "주택도시보증공사" if "주택도시보증공사" in line or "HUG" in line.upper() else "",
                "moveInDate": dates[0] if len(dates) > 0 else "",
                "fixedDate": dates[1] if len(dates) > 1 else "",
                "depositClaimDate": dates[2] if len(dates) > 2 else "",
                "depositDeadline": current_deadline,
                "deposit": deposit,
                "rent": 0,
                "isHUG": "주택도시보증공사" in line or "HUG" in line.upper(),
                "isVacant": "공실" in line,
            }
        )

    deduped = _dedupe_by(tenants, ("name", "moveInDate", "deposit"))
    if not deduped and explicit_survey_none:
        return [_no_tenant_record(current_deadline)]
    return deduped


def _guess_ocr_tenant_name(line: str) -> str:
    if _PROSE_SIGNAL_RE.search(line or ""):
        return ""
    cleaned = re.sub(r"\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}", " ", line)
    cleaned = re.sub(r"\d{1,3}(?:,\d{3})+|\d{4,}\s*원?", " ", cleaned)
    cleaned = re.sub(r"(임차인|전입일자?|전입|확정일자?|확정|배당요구일자?|배당요구|보증금|점유|월세|차임|없음|미상)", " ", cleaned)
    cleaned = re.sub(r"[:|()\[\],.]", " ", cleaned)
    tokens = [t.strip() for t in cleaned.split() if t.strip()]
    for token in tokens:
        if _is_name_like_token(token):
            return token
    return ""


def analyze_tenants(
    tenants: list[dict],
    base_right: Optional[dict],
    dividend_requests: list[dict],
    dividend_deadline: str = "",
    property_address: str = "",
    *,
    tenant_source_complete: bool = False,
) -> list[str]:
    descriptions = []
    for tenant in tenants:
        move_in = tenant.get("moveInDate") or ""
        fixed_date = tenant.get("fixedDate") or ""
        request_date = tenant.get("depositClaimDate") or ""
        deadline = dividend_deadline or tenant.get("depositDeadline") or ""
        if not request_date:
            req = _find_dividend_request(tenant.get("name") or "", dividend_requests)
            request_date = (req or {}).get("requestDate") or ""
            deadline = deadline or (req or {}).get("deadline") or ""

        base_date = (base_right or {}).get("date") or ""
        case = _tenant_takeover_case(
            move_in,
            fixed_date,
            request_date,
            base_date,
            deadline,
            tenant_source_complete=tenant_source_complete,
        )
        text = case["text"]
        priority_text = _tenant_priority_repayment_text(
            tenant,
            base_date,
            property_address,
            case.get("takeover"),
            deadline,
            request_date,
        )
        if priority_text:
            text = f"{text}\n{priority_text}"
        increase_text = _tenant_increase_takeover_text(tenant, base_date)
        if increase_text:
            text = f"{text}\n{increase_text}"
        # 다가구·상가 다수임차인은 임차인마다 전입일이 달라 대항력 판정이 제각각이므로,
        # 중복 제거하지 않고 임차인 순서대로 1:1로 인수여부를 매칭한다.
        descriptions.append(text)
    return descriptions


def _tenant_takeover_case_text(
    move_in: str,
    fixed_date: str,
    request_date: str,
    base_date: str,
    deadline: str,
    *,
    tenant_source_complete: bool = False,
) -> str:
    return _tenant_takeover_case(
        move_in,
        fixed_date,
        request_date,
        base_date,
        deadline,
        tenant_source_complete=tenant_source_complete,
    )["text"]


def _tenant_takeover_case(
    move_in: str,
    fixed_date: str,
    request_date: str,
    base_date: str,
    deadline: str,
    *,
    tenant_source_complete: bool = False,
) -> dict:
    if not _has_valid_date(base_date):
        return {
            "text": "말소기준권리 일자가 확인되지 않아 임차인의 대항력과 보증금 인수 여부를 확정할 수 없습니다.",
            "takeover": None,
        }
    if not _has_valid_date(move_in):
        return {
            "text": "임차인의 전입일이 확인되지 않아 말소기준권리와의 선후 및 보증금 인수 여부를 확정할 수 없습니다.",
            "takeover": None,
        }
    if not _date_before(move_in, base_date):
        text = (
            f"전입일·사업자등록일({move_in})이 말소기준권리 설정일({base_date})보다 늦어 "
            "대항력이 없으므로(대항력 X), 낙찰자에게 인수되는 임차권리는 없습니다."
        )
        return {"text": text, "takeover": False}

    fixed_before_base = _date_before(fixed_date, base_date)
    request_on_time = _date_on_or_before(request_date, deadline)

    if fixed_before_base and request_on_time:
        return {
            "text": "최선순위 설정 보다 앞선 대항력을 갖춘(대항력 O) 임차인이 있으므로,순위 배당 시 배당 받지 못하는 잔액이 있다면, 잔액은 낙찰자에게 인수됩니다.",
            "takeover": True,
        }

    if fixed_before_base and _date_after(request_date, deadline):
        return {
            "text": (
                "최선순위 설정보다 앞선 대항력을 갖춘(대항력 O) 임차인이 있습니다. 배당요구일이 종기보다 늦은 것으로 확인되어, "
                "적법한 배당요구의 효과가 인정되지 않을 경우 미회수 보증금 잔액이 낙찰자에게 인수될 가능성이 있습니다."
            ),
            "takeover": True,
        }

    if not _has_valid_date(fixed_date) and request_on_time:
        return {
            "text": "최선순위 설정 보다 앞선 대항력을 갖춘(대항력 O) 임차인이 있으므로,순위 배당 시 배당 받지 못하는 잔액이 있다면, 잔액은 낙찰자에게 인수됩니다.",
            "takeover": True,
        }

    return {
        "text": (
            "최선순위 설정보다 앞선 대항력을 갖춘(대항력 O) 임차인이 있으나 확정일자·배당요구 효과가 충분히 확인되지 않아, "
            "미회수 보증금의 낙찰자 인수 가능성을 배제할 수 없습니다."
        ),
        "takeover": True,
    }


def _tenant_priority_repayment_text(
    tenant: dict,
    base_date: str,
    property_address: str,
    residual_takeover: Optional[bool],
    dividend_deadline: str = "",
    dividend_request_date: str = "",
) -> str:
    occupancy = f"{tenant.get('occupancyType') or ''} {tenant.get('type') or ''}"
    if "상가" in occupancy or "사업자" in occupancy:
        return ""
    deposit = parse_money(tenant.get("deposit"))
    if deposit <= 0:
        return ""

    missing = []
    if not occupancy.strip():
        missing.append("점유관계")
    if not str(property_address or "").strip():
        missing.append("소재지")
    if not _has_valid_date(base_date):
        missing.append("말소기준일")
    if not _has_valid_date(tenant.get("moveInDate") or ""):
        missing.append("전입일")
    if not _has_valid_date(tenant.get("fixedDate") or ""):
        missing.append("확정일자")
    request_date = dividend_request_date or tenant.get("depositClaimDate") or ""
    if not _has_valid_date(request_date):
        missing.append("배당요구일")
    deadline = dividend_deadline or tenant.get("depositDeadline") or ""
    if not _has_valid_date(deadline):
        missing.append("배당요구종기")
    if residual_takeover is None:
        missing.append("보증금 인수 판단")
    if missing:
        return (
            f"소액임차인 최우선변제 여부는 다음 정보가 확인되지 않아 판단을 유보합니다: {_join_korean_names(missing)}. "
            "요건을 원본으로 확인하기 전에는 최우선변제금과 잔존 보증금을 산정하지 않습니다."
        )
    if _date_after(request_date, deadline):
        return (
            "확인된 배당요구일이 배당요구종기보다 늦어 적법한 배당요구 요건을 충족한 것으로 볼 수 없습니다. "
            "종기 준수 여부와 별도 구제사유를 원본으로 확인하기 전에는 최우선변제금과 잔존 보증금을 산정하지 않습니다."
        )

    priority = _housing_lease_priority_repayment(base_date, property_address, deposit)
    if not priority:
        return ""

    priority_amount = min(deposit, priority["priority_amount"])
    remaining = max(deposit - priority_amount, 0)
    text = (
        "확인된 입력값을 기준으로 소액임차인 금액 범위에 해당합니다. "
        f"점유·전입·배당요구 등 법정 요건이 모두 충족될 경우 {fmt_money(priority_amount)} 한도에서 "
        "우선변제 가능성이 있습니다."
    )
    if remaining <= 0:
        return f"{text} 금액 기준 잔존 보증금은 0원으로 계산되며 최종 배당 결과를 다시 확인해야 합니다."
    if residual_takeover:
        return f"{text} 잔존 금액 {fmt_money(remaining)}은 낙찰자 인수 가능성을 반영해야 합니다."
    return (
        f"{text} 현재 입력값의 선후 비교에서는 잔존 금액 {fmt_money(remaining)}이 인수되지 않는 방향으로 검토되나, "
        "최신 원본과 배당 결과로 확정해야 합니다."
    )


HOUSING_LEASE_PRIORITY_RULES = [
    ("1984.06.14", {
        "special": (3_000_000, 3_000_000),
        "other": (2_000_000, 2_000_000),
    }),
    ("1987.12.01", {
        "special": (5_000_000, 5_000_000),
        "other": (4_000_000, 4_000_000),
    }),
    ("1990.02.19", {
        "special": (20_000_000, 7_000_000),
        "other": (15_000_000, 5_000_000),
    }),
    ("1995.10.19", {
        "metropolitan": (30_000_000, 12_000_000),
        "other": (20_000_000, 8_000_000),
    }),
    ("2001.09.15", {
        "overcrowding": (40_000_000, 16_000_000),
        "metro_except": (35_000_000, 14_000_000),
        "other": (30_000_000, 12_000_000),
    }),
    ("2008.08.21", {
        "overcrowding": (60_000_000, 20_000_000),
        "metro_except": (50_000_000, 17_000_000),
        "other": (40_000_000, 14_000_000),
    }),
    ("2010.07.26", {
        "seoul": (75_000_000, 25_000_000),
        "overcrowding": (65_000_000, 22_000_000),
        "metro_plus": (55_000_000, 19_000_000),
        "other": (40_000_000, 14_000_000),
    }),
    ("2014.01.01", {
        "seoul": (95_000_000, 32_000_000),
        "overcrowding": (80_000_000, 27_000_000),
        "metro_plus": (60_000_000, 20_000_000),
        "other": (45_000_000, 15_000_000),
    }),
    ("2016.03.31", {
        "seoul": (100_000_000, 34_000_000),
        "overcrowding": (80_000_000, 27_000_000),
        "metro_plus": (60_000_000, 20_000_000),
        "other": (50_000_000, 17_000_000),
    }),
    ("2018.09.18", {
        "seoul": (110_000_000, 37_000_000),
        "overcrowding": (100_000_000, 34_000_000),
        "metro_plus": (60_000_000, 20_000_000),
        "other": (50_000_000, 17_000_000),
    }),
    ("2021.05.11", {
        "seoul": (150_000_000, 50_000_000),
        "overcrowding_plus": (130_000_000, 43_000_000),
        "metro_plus": (70_000_000, 23_000_000),
        "other": (60_000_000, 20_000_000),
    }),
    ("2023.02.21", {
        "seoul": (165_000_000, 55_000_000),
        "overcrowding_plus": (145_000_000, 48_000_000),
        "metro_plus": (85_000_000, 28_000_000),
        "other": (75_000_000, 25_000_000),
    }),
]


def _housing_lease_priority_repayment(base_date: str, address: str, deposit: int) -> dict:
    rule = _housing_lease_priority_rule(base_date)
    if not rule:
        return {}
    category = _housing_lease_region_category(address, rule["start"])
    deposit_limit, priority_amount = rule["limits"].get(category) or rule["limits"]["other"]
    if deposit > deposit_limit:
        return {}
    return {
        "category": category,
        "deposit_limit": deposit_limit,
        "priority_amount": priority_amount,
    }


def _housing_lease_priority_rule(base_date: str) -> dict:
    if not _has_valid_date(base_date):
        return {}
    selected = None
    for start, limits in HOUSING_LEASE_PRIORITY_RULES:
        if _date_sort_key(start) <= _date_sort_key(base_date):
            selected = {"start": start, "limits": limits}
        else:
            break
    return selected or {}


def _housing_lease_region_category(address: str, rule_start: str) -> str:
    text = re.sub(r"\s+", "", address or "")
    if _date_sort_key(rule_start) < _date_sort_key("1995.10.19"):
        return "special" if ("특별시" in text or "광역시" in text or "직할시" in text) else "other"
    if _date_sort_key(rule_start) < _date_sort_key("2001.09.15"):
        return "metropolitan" if _is_special_or_metropolitan_non_county(text) else "other"
    if _date_sort_key(rule_start) < _date_sort_key("2010.07.26"):
        if _is_overcrowding_area(text, include_seoul=True):
            return "overcrowding"
        if _is_metropolitan_except_incheon_and_county(text):
            return "metro_except"
        return "other"
    if _date_sort_key(rule_start) < _date_sort_key("2021.05.11"):
        if "서울특별시" in text or text.startswith("서울"):
            return "seoul"
        if _is_overcrowding_area(text, include_seoul=False):
            return "overcrowding"
        if _is_metropolitan_plus_city(text, include_sejong=_date_sort_key(rule_start) >= _date_sort_key("2016.03.31")):
            return "metro_plus"
        return "other"
    if "서울특별시" in text or text.startswith("서울"):
        return "seoul"
    if _is_overcrowding_area(text, include_seoul=False) or _contains_any(text, ("세종", "용인", "화성", "김포")):
        return "overcrowding_plus"
    if _is_metropolitan_city_non_county(text) or _contains_any(text, ("안산", "광주", "파주", "이천", "평택")):
        return "metro_plus"
    return "other"


def _is_special_or_metropolitan_non_county(address: str) -> bool:
    if "군" in address:
        return False
    return "특별시" in address or "광역시" in address or "직할시" in address


def _is_metropolitan_city_non_county(address: str) -> bool:
    return "광역시" in address and "군" not in address


def _is_metropolitan_except_incheon_and_county(address: str) -> bool:
    return _is_metropolitan_city_non_county(address) and "인천광역시" not in address


def _is_metropolitan_plus_city(address: str, include_sejong: bool = False) -> bool:
    if _is_metropolitan_city_non_county(address) and not _is_overcrowding_area(address, include_seoul=True):
        return True
    cities = ("안산", "용인", "김포", "광주")
    if _contains_any(address, cities):
        return True
    return include_sejong and "세종" in address


def _is_overcrowding_area(address: str, include_seoul: bool) -> bool:
    if include_seoul and ("서울특별시" in address or address.startswith("서울")):
        return True
    return _contains_any(
        address,
        (
            "인천광역시",
            "의정부",
            "구리",
            "남양주",
            "하남",
            "고양",
            "수원",
            "성남",
            "안양",
            "부천",
            "광명",
            "과천",
            "의왕",
            "군포",
            "시흥",
        ),
    )


def _contains_any(text: str, needles: tuple[str, ...]) -> bool:
    return any(needle in text for needle in needles)


def _tenant_increase_takeover_text(tenant: dict, base_date: str) -> str:
    if not tenant.get("hasIncrease"):
        return ""
    increase_fixed_date = tenant.get("increaseFixedDate") or ""
    if not _has_valid_date(base_date) or not _has_valid_date(increase_fixed_date):
        return ""
    if _date_before(increase_fixed_date, base_date):
        return "증액분도 인수됩니다."
    return "증액분은 인수 되지 않습니다."


def calculate_senior_debt_total(rights: list[dict], base_right: Optional[dict]) -> tuple[int, bool]:
    base_date = (base_right or {}).get("date") or ""
    if not _has_valid_date(base_date):
        return 0, False

    total = 0
    for right in substantive_registered_rights(rights):
        right_date = right.get("date") or ""
        if not _has_valid_date(right_date):
            # 날짜가 없는 실체 권리는 신청담보권보다 선순위인지 판별할 수 없다.
            return 0, False
        if _same_date(right_date, base_date):
            same_as_base = (
                str(right.get("type") or "") == str((base_right or {}).get("type") or "")
                and _normalize_creditor_name(right.get("creditor") or "")
                == _normalize_creditor_name((base_right or {}).get("creditor") or "")
            )
            if not same_as_base:
                # 같은 날짜의 다른 권리는 접수번호 없이는 선후를 확정할 수 없다.
                return 0, False
            continue
        amount = parse_money(right.get("amount"))
        if not _date_before(right_date, base_date):
            continue
        if amount <= 0:
            return 0, False
        total += amount
    return total, True


def calculate_surplus_basis(data: dict, rights: list[dict], base_right: Optional[dict]) -> dict:
    base_date = (base_right or {}).get("date") or ""
    min_bid = parse_money(data.get("min_price"))
    court_cost_fields = (
        ("court_auction_cost", "court_auction_cost_source_complete"),
        ("court_auction_procedure_cost", "court_auction_procedure_cost_source_complete"),
        ("auction_procedure_cost", "auction_procedure_cost_source_complete"),
    )
    court_auction_cost = 0
    court_cost_available = False
    for value_key, complete_key in court_cost_fields:
        amount = parse_money(data.get(value_key))
        if amount > 0 and data.get(complete_key) is True:
            court_auction_cost = amount
            court_cost_available = True
            break

    senior_debt_total, senior_debt_available = calculate_senior_debt_total(rights, base_right)
    applicant_is_base_creditor = _base_right_creditor_is_auction_applicant(
        base_right,
        data.get("auction_applicant_creditors") or [],
    )
    remainder = min_bid - court_auction_cost - senior_debt_total
    can_calculate = bool(
        min_bid > 0
        and court_cost_available
        and senior_debt_available
        and applicant_is_base_creditor
    )
    return {
        "min_bid": min_bid,
        "court_auction_cost": court_auction_cost,
        "court_cost_available": court_cost_available,
        "senior_debt_total": senior_debt_total,
        "remainder": remainder,
        "can_calculate": can_calculate,
        "base_date": base_date,
        "applicant_is_base_creditor": applicant_is_base_creditor,
    }


def fmt_formula_money(value) -> str:
    try:
        amount = int(value)
    except (TypeError, ValueError):
        amount = parse_money(value)
    return f"{amount:,}원"


def fmt_signed_money(value) -> str:
    try:
        amount = int(value)
    except (TypeError, ValueError):
        amount = parse_money(value)
    return f"{amount:,}원"


def build_no_surplus_judgment_text(data: dict, rights: list[dict], base_right: Optional[dict]) -> str:
    basis = calculate_surplus_basis(data, rights, base_right)
    if not basis.get("can_calculate"):
        return (
            "최저매각가격, 신청채권자의 담보권 순위, 법원 경매절차비용 또는 선순위 채권총액 확인이 필요하여 "
            "무잉여 가능성을 확정하지 못했습니다."
        )

    if basis["remainder"] <= 0:
        return (
            "확보된 선순위 채권액과 법원 경매절차비용을 반영한 산식상 경매신청채권자의 배당재원이 남지 않아 "
            "무잉여 가능성이 있습니다. 실제 채권잔액과 조세 등 법정 우선채권은 법원 기록으로 최종 확인해야 합니다."
        )
    return (
        "확보된 선순위 채권액과 법원 경매절차비용을 반영한 산식상 경매신청채권자의 배당재원이 남아 "
        "무잉여 가능성은 낮습니다. 실제 채권잔액과 조세 등 법정 우선채권은 법원 기록으로 최종 확인해야 합니다."
    )


def analyze_surplus(
    data: dict,
    rights: list[dict],
    base_right: Optional[dict],
    related_cases: list[dict],
    *,
    rights_source_complete: bool = False,
) -> str:
    min_bid = parse_money(data.get("min_price"))
    total_debt = registered_right_amount_total(rights)
    case_text = ", ".join(
        f"{c.get('type', '관련사건')} {c.get('caseNumber', '')}".strip()
        for c in related_cases
    )

    disclosed_voluntary_basis = (
        _disclosed_voluntary_auction_surplus_basis(data, rights)
        if rights_source_complete
        else None
    )
    expected_dividend_amount = _expected_dividend_amount(data)
    if expected_dividend_amount > 0:
        no_surplus_text = (
            f"예상배당표상 말소기준권리 또는 경매신청채권자에게 채권배당금 {fmt_money(expected_dividend_amount)}이 기재되어 있습니다. "
            "경매신청채권자에게 1원 이상 배당이 예정된 구조이므로 현재 예상배당표 기준 무잉여 가능성은 없습니다. "
            "입찰 직전 예상배당표와 법원 사건진행내역의 변동 여부만 다시 확인하면 됩니다."
        )
    elif disclosed_voluntary_basis and disclosed_voluntary_basis["remainder_before_court_cost"] > 0:
        claim_amount = disclosed_voluntary_basis["claim_amount"]
        prior_total = disclosed_voluntary_basis["prior_registered_total"]
        remainder = disclosed_voluntary_basis["remainder_before_court_cost"]
        no_surplus_text = (
            f"임의경매 청구금액 {fmt_money(claim_amount)}은 경매개시 절차의 청구액이므로 등기상 담보권 "
            "기재금액에 중복 합산하지 않았습니다. 청구액과 근접한 담보권이 확인되며, 공개된 담보권 중 가장 "
            "후순위 담보권을 신청담보권으로 보는 보수적 기준에서도 그보다 선순위인 기재금액은 "
            f"{fmt_formula_money(prior_total)}이고 최저매각가격 "
            f"{fmt_money(min_bid)}에서 법원 경매절차비용을 차감하기 전 배당재원은 {fmt_money(remainder)}입니다. "
            f"따라서 법원 경매절차비용이 이 금액보다 적다면 신청담보권에도 1원 이상 배당될 수 있어 무잉여 가능성은 사실상 없습니다. "
            "다만 실제 채권잔액, "
            "조세 등 법정 우선채권과 법원 경매절차비용은 법원 기록으로 최종 확인해야 합니다."
        )
    else:
        calculated_basis = calculate_surplus_basis(data, rights, base_right)
        if calculated_basis.get("can_calculate"):
            no_surplus_text = build_no_surplus_judgment_text(data, rights, base_right)
        else:
            application_context = _auction_application_context(data, rights, base_right)
            if application_context and min_bid > 0:
                creditor_text = application_context["creditor"]
                claim_text = (
                    f"(청구금액 {fmt_money(application_context['claim_amount'])})"
                    if application_context["claim_amount"] > 0
                    else ""
                )
                auction_kind = application_context["auction_kind"]
                no_surplus_text = (
                    f"본 경매는 {creditor_text}{claim_text}이 {auction_kind}를 신청한 사건입니다. "
                    f"현재 최저매각가격은 {fmt_money(min_bid)}이고, 등기상 권리 기재금액 합계는 {fmt_money(total_debt)}입니다. "
                    "현재 가격 구조상 신청채권자에게 배당될 가능성이 있어 무잉여 가능성은 낮게 판단됩니다. "
                    "입찰 직전 예상배당표와 법원 사건진행내역의 변동 여부만 다시 확인하면 됩니다."
                )
            else:
                no_surplus_text = (
                    "신청채권자와 청구금액을 특정할 자료가 부족해 무잉여 여부를 결론내리지 않았습니다. "
                    "입찰 직전 예상배당표, 법원 경매절차비용과 법원 사건진행내역을 확인해야 합니다."
                )

    # 채권액/감정가 비율은 채권자의 취하 의사를 예측하는 근거가 아니다.
    # 실제 취하서나 절차종료 기재만 사건 상태로 판단한다.
    myungseung_labels = {
        str(item.get("label") or "")
        for item in (data.get("myungseung_analysis") or [])
        if isinstance(item, dict)
    }
    application_context = _auction_application_context(data, rights, base_right)
    if "재진행" in myungseung_labels:
        withdrawal_text = (
            "마이옥션 상세페이지의 법무법인 명승 권리분석에서 이 사건은 중단되었던 매각절차가 재개된 ‘재진행’ "
            "물건으로 확인됩니다. 공개된 담보권 기재금액 합계가 최저매각가격보다 큰 사건이므로 경제적 회수 가능성이 있어 취하 가능성은 낮은 편으로 판단됩니다. "
            "다만 실제 채권잔액과 채권자의 의사는 별개이므로, 입찰 직전 법원 "
            "사건진행내역에서 취하서 또는 집행정지 접수 여부를 확인해야 합니다."
        )
    elif application_context and min_bid > 0:
        withdrawal_text = (
            "현재 최저매각가격과 신청채권 구조를 기준으로 보면 신청채권자가 배당을 받을 가능성이 있어 "
            "경매 취하 가능성은 낮은 편으로 판단됩니다. 다만 취하는 채권자와 소유자의 대응에 따라 달라질 수 있으므로 "
            "입찰 직전 법원 사건진행내역에서 취하서 또는 집행정지 접수 여부를 확인해야 합니다."
        )
    else:
        withdrawal_text = (
            "채권액과 감정가의 단순 비율로 채권자의 향후 취하 여부를 예측하지 않습니다. 입찰 직전 법원 "
            "사건진행내역에서 취하서·집행정지 또는 절차종료 접수 여부를 확인해야 합니다."
        )

    parts = [
        f"무잉여 가능성: {no_surplus_text}",
        f"취하 가능성: {withdrawal_text}",
    ]
    if case_text:
        parts.append(f"관련 사건: {case_text}.")
    return "\n".join(parts)


def _auction_application_context(data: dict, rights: list[dict], base_right: Optional[dict]) -> Optional[dict]:
    auction_type = re.sub(r"\s+", "", str(data.get("auction_type") or ""))
    procedures = auction_procedure_entries(rights)
    if "임의경매" in auction_type or any("임의경매" in str(item.get("type") or "") for item in procedures):
        auction_kind = "임의경매"
    elif "강제경매" in auction_type or any("강제경매" in str(item.get("type") or "") for item in procedures):
        auction_kind = "강제경매"
    else:
        return None

    claim_amount = parse_money(data.get("claim_amount"))
    if claim_amount <= 0:
        procedure_amounts = [parse_money(item.get("amount")) for item in procedures if parse_money(item.get("amount")) > 0]
        claim_amount = max(procedure_amounts) if procedure_amounts else 0

    applicant_names = [
        str(name or "").strip()
        for name in (data.get("auction_applicant_creditors") or [])
        if str(name or "").strip()
    ]
    creditor = applicant_names[0] if applicant_names else ""
    if not creditor:
        creditor = str((base_right or {}).get("creditor") or "").strip()
    if not creditor:
        for item in procedures:
            creditor = str(item.get("creditor") or "").strip()
            if creditor:
                break

    base_type = str((base_right or {}).get("type") or "").strip()
    if creditor and "저당" in base_type:
        creditor_label = f"{base_type}자인 {creditor}"
    elif creditor:
        creditor_label = creditor
    elif auction_kind == "강제경매":
        creditor_label = "경매신청채권자"
    else:
        creditor_label = "신청채권자"
    return {
        "auction_kind": auction_kind,
        "claim_amount": claim_amount,
        "creditor": creditor_label,
    }


def _expected_dividend_amount(data: dict) -> int:
    expected = data.get("expected_dividend") or {}
    if not isinstance(expected, dict) or expected.get("auctionApplicantDividendFound") is not True:
        return 0
    return parse_money(expected.get("auctionApplicantDividendAmount"))


def _disclosed_voluntary_auction_surplus_basis(data: dict, rights: list[dict]) -> Optional[dict]:
    """Build the site's disclosed-rights surplus basis for voluntary auction.

    A procedural 청구금액 is never a third registered burden.  When that
    amount closely identifies one disclosed mortgage, calculate a conservative
    upper bound by treating the most junior disclosed pre-application mortgage
    as the applicant's security and totaling every earlier disclosed burden.
    The conclusion is explicitly scoped to the captured registry summary.
    """
    auction_type = re.sub(r"\s+", "", str(data.get("auction_type") or ""))
    procedures = [
        item for item in auction_procedure_entries(rights)
        if "임의경매" in str(item.get("type") or "")
    ]
    if "임의경매" not in auction_type or not procedures:
        return None

    detail_claim_amount = parse_money(data.get("claim_amount"))
    procedure_claim_amounts = {
        parse_money(item.get("amount"))
        for item in procedures
        if parse_money(item.get("amount")) > 0
    }
    if detail_claim_amount <= 0 or len(procedure_claim_amounts) != 1:
        return None
    procedure_claim_amount = next(iter(procedure_claim_amounts))
    if abs(detail_claim_amount - procedure_claim_amount) / max(detail_claim_amount, 1) > 0.01:
        return None
    claim_amount = detail_claim_amount

    procedure_dates = [
        item.get("date") or ""
        for item in procedures
        if _has_valid_date(item.get("date") or "")
    ]
    if len(procedure_dates) != len(procedures):
        return None
    application_date = min(procedure_dates, key=_date_sort_key)

    mortgages = [
        right for right in substantive_registered_rights(rights)
        if (
            "저당" in str(right.get("type") or "")
            and parse_money(right.get("amount")) > 0
            and _has_valid_date(right.get("date") or "")
            and _date_before(right.get("date") or "", application_date)
        )
    ]
    if not mortgages:
        return None
    matched_candidates = [
        right for right in mortgages
        if abs(parse_money(right.get("amount")) - claim_amount) / max(claim_amount, 1) <= 0.05
    ]
    if len(matched_candidates) != 1:
        return None
    claim_matched_right = matched_candidates[0]
    worst_case_applicant_right = max(mortgages, key=lambda right: _date_sort_key(right.get("date") or ""))
    worst_case_date = worst_case_applicant_right.get("date") or ""
    if sum(_same_date(right.get("date") or "", worst_case_date) for right in mortgages) != 1:
        return None

    prior_total = 0
    for right in substantive_registered_rights(rights):
        if right is worst_case_applicant_right:
            continue
        right_date = right.get("date") or ""
        if not _has_valid_date(right_date):
            return None
        if _same_date(right_date, worst_case_date):
            # 동일일자 접수순위가 없으면 신청담보권보다 앞서는지 알 수 없다.
            return None
        if _date_before(right_date, worst_case_date):
            amount = parse_money(right.get("amount"))
            if amount <= 0:
                return None
            prior_total += amount
    min_bid = parse_money(data.get("min_price"))
    if min_bid <= 0:
        return None
    return {
        "claim_amount": claim_amount,
        "claim_matched_right": claim_matched_right,
        "worst_case_applicant_right": worst_case_applicant_right,
        "prior_registered_total": prior_total,
        "remainder_before_court_cost": min_bid - prior_total,
    }


def _base_right_creditor_is_auction_applicant(base_right: Optional[dict], applicant_creditors: list[str]) -> bool:
    creditor = (base_right or {}).get("creditor") or ""
    normalized_applicants = [
        _normalize_creditor_name(name)
        for name in applicant_creditors or []
        if _normalize_creditor_name(name)
    ]
    return _creditor_matches_any(creditor, normalized_applicants)


def build_misc_items(tenants: list[dict], management_fee: dict, market_data: dict) -> list[str]:
    items = []
    fee_status = _management_fee_status(management_fee)
    unpaid = int(management_fee.get("unpaidAmount") or 0)
    if fee_status == "confirmed" and unpaid > 0:
        items.append(build_unpaid_management_fee_text(management_fee))
    elif fee_status == "none":
        note = management_fee.get("note") or "확인자료상 체납관리비 없음"
        items.append(f"관리비 현황은 {_polite_confirmation(note)}")
    else:
        items.append("미납관리비는 확인되지 않습니다. 입찰 전 관리사무소에 최신 미납 내역을 확인하시기 바랍니다.")

    if any(t.get("isVacant") for t in tenants):
        items.append("임차권등기 또는 현황자료상 공실 가능성이 있으므로 점유 현황을 현장에서 확인해 주시기 바랍니다.")

    if market_data.get("recentDealPrice"):
        items.append(
            f"최근 실거래가 {fmt_money(market_data.get('recentDealPrice'))}이(가) 확인됩니다. "
            "층수·면적·거래시점 차이를 고려해 비교해 주시기 바랍니다."
        )

    items.append("본 보증서 발급 전 등기부등본, 매각물건명세서, 현황조사서 최신본을 반드시 재확인해 주시기 바랍니다.")
    return items


def build_unpaid_management_fee_text(management_fee: dict) -> str:
    fee_status = _management_fee_status(management_fee)
    unpaid = int(management_fee.get("unpaidAmount") or 0)
    if fee_status == "confirmed" and unpaid > 0:
        due_text = management_fee.get("dueThroughText") or _extract_management_fee_due_text(management_fee.get("note") or "")
        amount_text = f"{due_text} 약 {fmt_money(unpaid)}" if due_text else f"약 {fmt_money(unpaid)}"
        return (
            f"체납관리비 총액은 {amount_text}으로 기재되어 있습니다. "
            "해당 총액 전부를 낙찰자 부담으로 단정하지 않고 공용부분·전유부분·연체료와 기준일을 구분해 확인해야 합니다."
        )
    if fee_status == "none":
        note = management_fee.get("note") or "확인자료상 체납관리비 없음"
        return f"{_polite_confirmation(note)} 입찰 직전 관리사무소에서 변동 여부를 재확인해 주시기 바랍니다."
    return "미납관리비는 확인되지 않습니다. 입찰 전 관리사무소에 최신 미납 내역을 확인하시기 바랍니다."


def _management_fee_status(management_fee: dict) -> str:
    try:
        from .rights_checklist import management_fee_amount_status
    except ImportError:  # 단독 실행 대비
        from rights_checklist import management_fee_amount_status
    return management_fee_amount_status(management_fee)


def _polite_optional_note(value: str, fallback: str) -> str:
    return _polite_confirmation(value) or fallback


def _polite_confirmation(value: str) -> str:
    note = _clean_document_note(value)
    if not note:
        return ""
    if note.endswith(("습니다.", "입니다.", "바랍니다.", "됩니다.", "합니다.", "없습니다.")):
        return note
    note = note.rstrip(".。")
    return f"{note}{_euro_josa(note)} 확인됩니다."


def _euro_josa(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return "로"
    last = text[-1]
    code = ord(last) - 0xAC00
    if 0 <= code <= 11171 and code % 28:
        return "으로"
    return "로"


def build_review_items(rights: list[dict], tenants: list[dict], management_fee: dict) -> list[str]:
    items = []
    if not rights:
        items.append("등기부현황 또는 권리분석 테이블에서 권리 목록을 확인해 주시기 바랍니다.")
    if not tenants:
        items.append("임차인현황 테이블에서 임차인 목록을 확인해 주시기 바랍니다.")
    if not management_fee:
        items.append("관리비 현황은 관리사무소 또는 현장에서 확인해 주시기 바랍니다.")
    if not items:
        items.append("원본 문서와 대조해 최종 검토해 주시기 바랍니다.")
    return items


def render_certificate_template(template_path: str, data: dict) -> str:
    path = Path(template_path)
    if not path.exists():
        raise FileNotFoundError(f"권리분석 보증서 템플릿을 찾을 수 없습니다: {path}")

    template = path.read_text(encoding="utf-8")
    rendered = template

    rendered = _replace_each(rendered, "tenantAnalyses", data.get("tenantAnalyses") or [])
    rendered = _replace_each(rendered, "miscItems", data.get("miscItems") or [])
    rendered = _replace_each(rendered, "reviewItems", data.get("reviewItems") or [])
    rendered = rendered.replace("{{narrativeReportHtml}}", str(data.get("narrativeReportHtml") or ""))

    rendered = _replace_if(rendered, "noTenants", bool(data.get("noTenants")))
    rendered = _replace_if(rendered, "hasUnpaidFee", bool(data.get("hasUnpaidFee")))

    for key, value in data.items():
        if isinstance(value, (list, dict)):
            continue
        rendered = rendered.replace("{{" + key + "}}", html.escape("" if value is None else str(value)))
    rendered = rendered.replace("{{address}}", "").replace("{{adress}}", "")
    rendered = re.sub(r"[ \t]*(?:/|,|\|)[ \t]*(?=(?:<br>|</p>|\n|$))", "", rendered)
    return rendered


def render_certificate_pptx_template(template_path: Path, output_path: Path, data: dict) -> None:
    if not template_path.exists():
        raise FileNotFoundError(f"권리분석 보증서 PPT 템플릿을 찾을 수 없습니다: {template_path}")

    prs = Presentation(str(template_path))
    mapping = {
        "{{" + key + "}}": _ppt_value(value)
        for key, value in data.items()
        if not isinstance(value, (list, dict))
    }
    mapping["{{address}}"] = ""
    mapping["{{adress}}"] = ""

    # The paid certificate's established first page stays in place.  All legacy
    # slides after it are replaced with the case-specific narrative report.
    if len(prs.slides):
        _replace_placeholders_in_shapes(prs.slides[0].shapes, mapping)

    _render_narrative_slides(prs, data)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    prs.save(str(output_path))


def _render_narrative_slides(prs: Presentation, data: dict) -> None:
    pages = [page for page in (data.get("narrativePages") or []) if isinstance(page, dict)]
    if not pages:
        return
    _validate_narrative_slide_size(prs)
    if len(prs.slides) < 3:
        raise ValueError("권리분석 PPT 템플릿에는 첫 장, 특이사항 원본 장, 마지막 안내 장이 필요합니다.")

    original_slides = list(prs.slides)
    prototype = original_slides[1]
    closing_slide = original_slides[-1]
    original_canvases = original_slides[1:-1]
    prototype_background = deepcopy(prototype.element.cSld.bg) if prototype.element.cSld.bg is not None else None
    prototype_background_rels = _slide_background_relationships(prototype)
    prototype_chrome = [deepcopy(shape._element) for shape in prototype.shapes]

    narrative_slides = list(original_canvases[: len(pages)])
    while len(narrative_slides) < len(pages):
        slide = prs.slides.add_slide(prototype.slide_layout)
        _copy_slide_background(
            slide,
            prototype_background,
            prototype_background_rels,
        )
        _move_slide_before(prs, slide, closing_slide)
        narrative_slides.append(slide)

    for slide in original_canvases[len(pages):]:
        _remove_slide_object(prs, slide)

    for slide in narrative_slides:
        _clear_slide_shapes(slide)
        for element in prototype_chrome:
            slide.shapes._spTree.insert_element_before(deepcopy(element), "p:extLst")

    _move_slide_to_end(prs, closing_slide)
    for page_index, page in enumerate(pages):
        slide = narrative_slides[page_index]
        _render_narrative_page(prs, slide, page, data)


def _slide_id_element(prs: Presentation, slide):
    for slide_id in prs.slides._sldIdLst:
        if prs.part.related_part(slide_id.rId) is slide.part:
            return slide_id
    raise ValueError("PPT 슬라이드 관계를 찾을 수 없습니다.")


def _remove_slide_object(prs: Presentation, slide) -> None:
    slide_id = _slide_id_element(prs, slide)
    relationship_id = slide_id.rId
    prs.part.drop_rel(relationship_id)
    prs.slides._sldIdLst.remove(slide_id)


def _move_slide_before(prs: Presentation, slide, before_slide) -> None:
    slide_id = _slide_id_element(prs, slide)
    before_id = _slide_id_element(prs, before_slide)
    slide_ids = prs.slides._sldIdLst
    slide_ids.remove(slide_id)
    slide_ids.insert(list(slide_ids).index(before_id), slide_id)


def _move_slide_to_end(prs: Presentation, slide) -> None:
    slide_id = _slide_id_element(prs, slide)
    slide_ids = prs.slides._sldIdLst
    slide_ids.remove(slide_id)
    slide_ids.append(slide_id)


def _slide_background_relationships(slide) -> dict[str, object]:
    relationships = {}
    background = slide.element.cSld.bg
    if background is None:
        return relationships
    for element in background.iter():
        for attr in (qn("r:embed"), qn("r:link")):
            relationship_id = element.get(attr)
            if relationship_id and relationship_id in slide.part.rels:
                relationships[relationship_id] = slide.part.rels[relationship_id]
    return relationships


def _copy_slide_background(slide, background, relationships: dict[str, object]) -> None:
    if background is None:
        return
    copied = deepcopy(background)
    for element in copied.iter():
        for attr in (qn("r:embed"), qn("r:link")):
            old_id = element.get(attr)
            relation = relationships.get(old_id or "")
            if relation is None:
                continue
            new_id = slide.part.relate_to(
                relation.target_ref if relation.is_external else relation.target_part,
                relation.reltype,
                relation.is_external,
            )
            element.set(attr, new_id)
    existing = slide.element.cSld.bg
    if existing is not None:
        slide.element.cSld.remove(existing)
    slide.element.cSld.insert(0, copied)


def _clear_slide_shapes(slide) -> None:
    shape_tree = slide.shapes._spTree
    for shape in list(slide.shapes):
        shape_tree.remove(shape._element)


def _validate_narrative_slide_size(prs: Presentation) -> None:
    if prs.slide_width >= REPORT_MIN_SLIDE_WIDTH and prs.slide_height >= REPORT_MIN_SLIDE_HEIGHT:
        return
    width_inches = prs.slide_width / Inches(1)
    height_inches = prs.slide_height / Inches(1)
    raise ValueError(
        "권리분석 서술 보고서는 슬라이드 크기가 최소 7.5 x 10.8인치여야 합니다"
        f"(현재 {width_inches:.2f} x {height_inches:.2f}인치). 글자 축소 없이 페이지를 나누기 위해 "
        "가로형 또는 작은 템플릿은 지원하지 않습니다. "
        "Narrative report requires slides at least 7.5 x 10.8 inches."
    )


def _render_narrative_page(prs: Presentation, slide, page: dict, data: dict) -> None:
    blocks = [block for block in (page.get("blocks") or []) if isinstance(block, dict)]
    _set_original_narrative_header(slide, page, data)

    font_points = _narrative_page_font_points(blocks)
    text_box = slide.shapes.add_textbox(Inches(1.08), Inches(3.58), Inches(5.34), Inches(4.98))
    frame = text_box.text_frame
    frame.clear()
    frame.word_wrap = True
    frame.auto_size = MSO_AUTO_SIZE.TEXT_TO_FIT_SHAPE
    frame.vertical_anchor = MSO_ANCHOR.TOP
    frame.margin_left = Inches(0.02)
    frame.margin_right = Inches(0.02)
    frame.margin_top = Inches(0.02)
    frame.margin_bottom = Inches(0.02)
    for index, block in enumerate(blocks):
        paragraph = frame.paragraphs[0] if index == 0 else frame.add_paragraph()
        paragraph.alignment = PP_ALIGN.LEFT
        paragraph.level = 0
        paragraph.space_after = Pt(8 if index < len(blocks) - 1 else 0)
        paragraph.line_spacing = 1.12
        heading = _narrative_display_heading(block, str(page.get("title") or ""))
        number = block.get("number") or index + 1
        run = paragraph.add_run()
        run.text = f"{number}) {heading}. "
        run.font.name = "바탕체"
        run.font.size = Pt(font_points)
        run.font.bold = True
        run.font.color.rgb = RGBColor(43, 37, 29)
        body_run = paragraph.add_run()
        body_run.text = str(block.get("body") or "")
        body_run.font.name = "바탕체"
        body_run.font.size = Pt(font_points)
        body_run.font.bold = False
        body_run.font.color.rgb = RGBColor(43, 37, 29)


def _set_original_narrative_header(slide, page: dict, data: dict) -> None:
    tables = sorted(
        (shape for shape in slide.shapes if getattr(shape, "has_table", False)),
        key=lambda shape: shape.top,
    )
    header = next((shape for shape in tables if shape.top < Inches(5)), None)
    if header is None or len(header.table.rows) < 2:
        raise ValueError("원본 특이사항 페이지의 제목 표를 찾을 수 없습니다.")
    _set_table_cell_text(header.table.cell(0, 0), "4. 특이사항", size=12, bold=True)
    _set_table_cell_text(
        header.table.cell(1, 0),
        f"사건번호 {data.get('caseNumber') or '담당자 확인 필요'}  ·  "
        f"{page.get('pageIndex') or ''}/{page.get('pageCount') or ''}",
        size=9.5,
        bold=False,
    )


def _set_table_cell_text(cell, value: str, *, size: float, bold: bool) -> None:
    frame = cell.text_frame
    frame.clear()
    frame.word_wrap = True
    frame.vertical_anchor = MSO_ANCHOR.MIDDLE
    paragraph = frame.paragraphs[0]
    paragraph.alignment = PP_ALIGN.LEFT
    paragraph.space_after = Pt(0)
    run = paragraph.add_run()
    run.text = str(value or "")
    run.font.name = "바탕체"
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.color.rgb = RGBColor(43, 37, 29)


def _blank_slide_layout(prs: Presentation):
    for layout in prs.slide_layouts:
        name = str(getattr(layout, "name", "") or "").strip().lower()
        if name == "blank" or "빈 화면" in name:
            return layout
    if len(prs.slide_layouts) > 6:
        return prs.slide_layouts[6]
    return min(prs.slide_layouts, key=lambda layout: len(layout.placeholders))


def _add_report_page_frame(prs: Presentation, slide) -> None:
    background = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, prs.slide_width, prs.slide_height)
    background.fill.solid()
    background.fill.fore_color.rgb = RGBColor(255, 255, 255)
    background.line.color.rgb = RGBColor(255, 255, 255)

    for inset, width, color in (
        (Inches(0.2), Pt(3), RGBColor(200, 168, 75)),
        (Inches(0.27), Pt(1), RGBColor(232, 201, 106)),
    ):
        border = slide.shapes.add_shape(
            MSO_SHAPE.RECTANGLE,
            inset,
            inset,
            prs.slide_width - inset * 2,
            prs.slide_height - inset * 2,
        )
        border.fill.background()
        border.line.color.rgb = color
        border.line.width = width


def _add_ppt_textbox(
    slide,
    left,
    top,
    width,
    height,
    text: str,
    *,
    font_size,
    bold: bool = False,
    color: RGBColor = RGBColor(40, 47, 55),
    alignment=PP_ALIGN.LEFT,
    font_name: str = "맑은 고딕",
    vertical_anchor=MSO_ANCHOR.MIDDLE,
):
    shape = slide.shapes.add_textbox(left, top, width, height)
    _set_shape_text(
        shape,
        text,
        font_size=font_size,
        bold=bold,
        color=color,
        alignment=alignment,
        font_name=font_name,
        vertical_anchor=vertical_anchor,
    )
    return shape


def _set_shape_text(
    shape,
    text: str,
    *,
    font_size,
    bold: bool,
    color: RGBColor,
    alignment,
    font_name: str = "맑은 고딕",
    vertical_anchor=MSO_ANCHOR.MIDDLE,
) -> None:
    text_frame = shape.text_frame
    text_frame.clear()
    text_frame.word_wrap = True
    text_frame.vertical_anchor = vertical_anchor
    text_frame.margin_left = Inches(0.03)
    text_frame.margin_right = Inches(0.03)
    text_frame.margin_top = Inches(0.02)
    text_frame.margin_bottom = Inches(0.02)
    paragraph = text_frame.paragraphs[0]
    paragraph.alignment = alignment
    paragraph.space_after = Pt(0)
    run = paragraph.add_run()
    run.text = str(text or "")
    run.font.name = font_name
    run.font.size = font_size
    run.font.bold = bold
    run.font.color.rgb = color


def export_pptx_to_pdf(pptx_path: Path, pdf_path: Path) -> bool:
    try:
        import pythoncom
        import win32com.client
    except Exception as e:
        logger.warning(f"PowerPoint PDF 변환 모듈을 사용할 수 없습니다: {e}")
        return False

    app = None
    presentation = None
    com_initialized = False
    try:
        # FastAPI jobs run in worker threads. Each thread that touches a COM
        # object must initialize COM itself before creating PowerPoint.
        pythoncom.CoInitialize()
        com_initialized = True
        pdf_path.parent.mkdir(parents=True, exist_ok=True)
        app = win32com.client.DispatchEx("PowerPoint.Application")
        try:
            app.DisplayAlerts = 0
        except Exception:
            pass
        presentation = app.Presentations.Open(str(pptx_path.resolve()), WithWindow=False)
        presentation.SaveAs(str(pdf_path.resolve()), 32)
        return pdf_path.exists() and pdf_path.stat().st_size > 0
    except Exception as e:
        logger.warning(f"PowerPoint PDF 변환 실패: {e}")
        return False
    finally:
        if presentation is not None:
            try:
                presentation.Close()
            except Exception:
                pass
        if app is not None:
            try:
                app.Quit()
            except Exception:
                pass
        if com_initialized:
            try:
                pythoncom.CoUninitialize()
            except Exception:
                pass


def _replace_placeholders_in_shapes(shapes, mapping: dict[str, str]) -> None:
    for shape in shapes:
        if hasattr(shape, "shapes"):
            _replace_placeholders_in_shapes(shape.shapes, mapping)

        if getattr(shape, "has_table", False):
            for row in shape.table.rows:
                for cell in row.cells:
                    _replace_text_frame_placeholders(cell.text_frame, mapping)

        if getattr(shape, "has_text_frame", False):
            _replace_text_frame_placeholders(shape.text_frame, mapping)


def _replace_text_frame_placeholders(text_frame, mapping: dict[str, str]) -> None:
    old_text = "\n".join(p.text for p in text_frame.paragraphs)
    new_text = old_text
    body_font_size = BODY_FONT_SIZE if any(token in old_text for token in BODY_PLACEHOLDER_TOKENS) else None
    case_info_font_size = CASE_INFO_FONT_SIZE if any(token in old_text for token in CASE_INFO_PLACEHOLDER_TOKENS) else None
    for token, value in mapping.items():
        new_text = new_text.replace(token, value)
    new_text = re.sub(r"[ \t]*(?:/|,|\|)[ \t]*(?=\n|$)", "", new_text)

    if new_text == old_text:
        return

    if case_info_font_size is not None:
        # Keep the established first-page case-information box in its original
        # geometry.  Growing the shape to fit a long real case number made
        # LibreOffice expand it over the first section heading.  Two explicit
        # lines plus shrink-to-fit stay inside the fixed box in both PowerPoint
        # and LibreOffice.
        text_frame.word_wrap = False
        text_frame.auto_size = MSO_AUTO_SIZE.TEXT_TO_FIT_SHAPE

    font_template = _first_run_font(text_frame)
    text_frame.clear()
    for index, line in enumerate(new_text.split("\n")):
        paragraph = text_frame.paragraphs[0] if index == 0 else text_frame.add_paragraph()
        paragraph.clear()
        run = paragraph.add_run()
        run.text = line
        _copy_font(font_template, run.font)
        if case_info_font_size is not None:
            run.font.size = case_info_font_size
        elif body_font_size is not None:
            run.font.size = _font_size_for_body_line(line)


def _font_size_for_body_line(line: str):
    if "최우선변제" in line or "잔존 금액" in line:
        return PRIORITY_REPAYMENT_FONT_SIZE
    return BODY_FONT_SIZE


def _first_run_font(text_frame):
    for paragraph in text_frame.paragraphs:
        for run in paragraph.runs:
            return run.font
    return None


def _copy_font(src, dst) -> None:
    if src is None:
        return
    try:
        dst.name = src.name
        dst.size = src.size
        dst.bold = src.bold
        dst.italic = src.italic
        dst.underline = src.underline
    except Exception:
        pass
    try:
        dst.color.rgb = src.color.rgb
    except Exception:
        pass


def _ppt_value(value) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "예" if value else "아니오"
    return str(value)


def render_html_to_pdf(driver, html_path: Path, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    driver.get(html_path.resolve().as_uri())
    wait_document_ready(driver, timeout=20)
    result = driver.execute_cdp_cmd(
        "Page.printToPDF",
        {
            "landscape": False,
            "printBackground": True,
            "preferCSSPageSize": True,
            "marginTop": 0,
            "marginRight": 0,
            "marginBottom": 0,
            "marginLeft": 0,
        },
    )
    output_path.write_bytes(base64.b64decode(result["data"]))


def _replace_each(template: str, key: str, items: list) -> str:
    pattern = re.compile(r"{{#each " + re.escape(key) + r"}}([\s\S]*?){{/each}}")

    def repl(match):
        block = match.group(1)
        parts = []
        for item in items:
            piece = block
            if isinstance(item, dict):
                for item_key, value in item.items():
                    piece = piece.replace("{{this." + item_key + "}}", html.escape(str(value or "")))
            else:
                piece = piece.replace("{{this}}", html.escape(str(item or "")))
            parts.append(piece)
        return "\n".join(parts)

    return pattern.sub(repl, template)


def _replace_if(template: str, key: str, enabled: bool) -> str:
    pattern = re.compile(r"{{#if " + re.escape(key) + r"}}([\s\S]*?){{/if}}")
    return pattern.sub(lambda m: m.group(1) if enabled else "", template)


def _extract_rights(soup) -> list[dict]:
    rights = []
    for table in _registry_tables(soup):
        table_text = table.get_text(" ", strip=True)
        if not any(t in table_text for t in RIGHT_TYPES):
            continue
        if not re.search(r"\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}", table_text):
            continue
        for row in _iter_table_rows(table):
            row = _strip_registry_sequence_cells(row)
            row_text = " ".join(row)
            right_type = _first_match(row_text, RIGHT_TYPES)
            date = _first_date(row_text)
            if not right_type or not date:
                continue
            rights.append(
                {
                    "seq": len(rights) + 1,
                    "date": normalize_date(date),
                    "type": right_type,
                    "creditor": _guess_creditor(row, right_type),
                    "amount": parse_money(row_text),
                    "status": _extract_right_status(row_text),
                    "note": _extract_right_note(row, row_text),
                    "isBaseRight": _is_base_right_row(row_text),
                    "rawText": row_text,
                    "source": "registry_html",
                    "isAuctionProcedure": _is_auction_procedure_type(right_type),
                    "amountKind": "application_claim" if _is_auction_procedure_type(right_type) else "registered_right",
                }
            )
    return _dedupe_by(rights, ("date", "type", "creditor", "amount"))


def _registry_tables(soup) -> list:
    tables = []
    seen = set()
    for stock in soup.find_all("div", id="dtl_stock"):
        heading = stock.select_one("div#dtl_title > h3") or stock.find("h3")
        heading_text = re.sub(r"\s+", "", heading.get_text(" ", strip=True) if heading else "")
        if "등기부현황" not in heading_text:
            continue
        for table in stock.find_all("table"):
            marker = id(table)
            if marker not in seen:
                seen.add(marker)
                tables.append(table)

    # Older page variants do not wrap the registry table in dtl_stock. A
    # strict header signature still excludes the basic-information table that
    # merely contains 경매종류/매각기일/청구금액.
    for table in soup.find_all("table"):
        compact = re.sub(r"\s+", "", table.get_text(" ", strip=True))
        header_match = (
            "권리종류" in compact
            and any(token in compact for token in ("권리자", "채권자"))
            and any(token in compact for token in ("순위", "접수", "등기일", "말소기준"))
        )
        if not header_match or id(table) in seen:
            continue
        seen.add(id(table))
        tables.append(table)
    return tables


def _structured_registry_summary_complete(soup, rights: list[dict]) -> bool:
    if not rights:
        return False
    registry_tables = _registry_tables(soup)
    registry_source_rows = [
        right for right in rights
        if str(right.get("source") or "") == "registry_html"
        and _has_valid_date(right.get("date") or "")
        and str(right.get("type") or "").strip()
    ]
    if registry_tables and registry_source_rows:
        return True
    for table in registry_tables:
        compact = re.sub(r"\s+", "", table.get_text(" ", strip=True))
        if (
            "권리종류" in compact
            and any(token in compact for token in ("권리자", "채권자"))
            and any(token in compact for token in ("순위", "접수", "등기일", "설정일"))
        ):
            # The registry table is the site's complete structured source for
            # this section.  Requiring a literal '말소기준/소멸/인수' badge
            # incorrectly downgraded otherwise fully parseable tables to
            # partial and produced repeated "전체 원본 미확보" caveats.
            parsed_rows = [
                right for right in rights
                if _has_valid_date(right.get("date") or "")
                and str(right.get("type") or "").strip()
                and (
                    str(right.get("creditor") or "").strip()
                    or _is_auction_procedure_right(right)
                )
            ]
            if parsed_rows:
                return True
    return False


def _is_auction_procedure_type(value: str) -> bool:
    compact = re.sub(r"\s+", "", str(value or ""))
    return any(token in compact for token in AUCTION_PROCEDURE_TYPES)


def _is_auction_procedure_right(right: dict) -> bool:
    return bool(right.get("isAuctionProcedure")) or _is_auction_procedure_type(right.get("type") or "")


def substantive_registered_rights(rights: list[dict]) -> list[dict]:
    """Return rights that create a substantive registered burden.

    Auction commencement entries remain in the evidence model but are excluded
    from right counts and money totals because their 청구금액 repeats the
    enforcement claim rather than creating another secured right.
    """
    return [right for right in (rights or []) if not _is_auction_procedure_right(right)]


def auction_procedure_entries(rights: list[dict]) -> list[dict]:
    return [right for right in (rights or []) if _is_auction_procedure_right(right)]


def registered_right_amount_total(rights: list[dict]) -> int:
    return sum(parse_money(right.get("amount")) for right in substantive_registered_rights(rights))


def _strip_registry_sequence_text(text: str) -> str:
    return re.sub(r"^\s*\d{1,3}\s+(?=\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2})", "", text or "").strip()


def _strip_registry_sequence_cells(cells: list[str]) -> list[str]:
    if len(cells) >= 2 and re.fullmatch(r"\d{1,3}", cells[0] or "") and _first_date(cells[1]):
        return cells[1:]
    return cells


def merge_rights(*groups: list[dict]) -> list[dict]:
    merged: list[dict] = []
    for group in groups:
        for right in group or []:
            match = _find_matching_right(merged, right)
            if not match:
                item = dict(right)
                item["seq"] = len(merged) + 1
                merged.append(item)
                continue
            for key, value in right.items():
                if key == "isBaseRight":
                    match[key] = bool(match.get(key)) or bool(value)
                elif key == "amount" and not match.get(key) and value:
                    match[key] = value
                elif key not in ("seq",) and not match.get(key) and value:
                    match[key] = value
    return merged


def _find_matching_right(rights: list[dict], target: dict) -> Optional[dict]:
    target_date = target.get("date") or ""
    target_type = target.get("type") or ""
    target_creditor = target.get("creditor") or ""
    for right in rights:
        if not _same_date(right.get("date") or "", target_date):
            continue
        right_type = right.get("type") or ""
        if target_type and right_type and target_type not in right_type and right_type not in target_type:
            continue
        right_creditor = right.get("creditor") or ""
        if target_creditor and right_creditor and not _creditor_names_match(target_creditor, right_creditor):
            same_amount = parse_money(target.get("amount")) == parse_money(right.get("amount")) > 0
            cross_source_ocr = {
                str(target.get("source") or ""), str(right.get("source") or "")
            } == {"registry_html", "registry_ocr"}
            if not (same_amount and cross_source_ocr):
                continue
        return right
    return None


def _is_base_right_row(text: str) -> bool:
    compact = re.sub(r"\s+", "", text or "")
    return any(token in compact for token in ("말소기준권리", "말소기준", "소멸기준"))


def _extract_right_status(text: str) -> str:
    compact = re.sub(r"\s+", "", text or "")
    if "소멸기준" in compact:
        return "소멸기준"
    if "인수" in compact:
        return "인수"
    if "소멸" in compact:
        return "소멸"
    return ""


def _extract_right_note(cells: list[str], row_text: str) -> str:
    if cells:
        for cell in reversed(cells):
            compact = re.sub(r"\s+", "", cell or "")
            if any(token in compact for token in ("말소기준", "존속기간", "배당요구", "카단", "타경")):
                return cell[:200]
    if _is_base_right_row(row_text) or "배당요구" in (row_text or ""):
        return (row_text or "")[:200]
    return ""


def _right_dividend_request_assessment(
    right: dict,
    dividend_requests: list[dict],
    *,
    source_complete: bool = False,
) -> str:
    raw_text = f"{right.get('rawText') or ''} {right.get('note') or ''}"
    compact = re.sub(r"\s+", "", raw_text)
    if any(token in compact for token in (
        "배당요구없", "배당요구하지않", "배당요구안", "배당요구미제출", "배당요구미신청",
    )):
        return "absent"
    if "배당요구" in compact:
        if any(token in compact for token in (
            "배당요구여부", "배당요구확인필요", "배당요구미확인",
            "배당요구예정", "배당요구신청예정", "배당요구제출예정",
        )):
            return "unknown"
        if any(token in compact for token in (
            "배당요구접수", "배당요구신청완료", "배당요구제출완료", "배당요구제출",
            "배당요구있음", "배당요구완료",
        )):
            request_date = right.get("dividendRequestDate") or right.get("depositClaimDate") or ""
            deadline = right.get("dividendDeadline") or right.get("depositDeadline") or ""
            if not _has_valid_date(request_date) or not _has_valid_date(deadline):
                return "unknown"
            return "timely" if _date_on_or_before(request_date, deadline) else "late"
        if re.search(r"배당요구(?:일자|일)?[:：]?\d{4}[.\-/년]\d{1,2}[.\-/월]\d{1,2}", compact):
            return "unknown"
        return "unknown"
    matched_request = _find_dividend_request(right.get("creditor") or "", dividend_requests)
    if matched_request is not None:
        request_date = matched_request.get("requestDate") or ""
        deadline = matched_request.get("deadline") or ""
        if not _has_valid_date(request_date) or not _has_valid_date(deadline):
            return "unknown"
        return "timely" if _date_on_or_before(request_date, deadline) else "late"
    return "absent" if source_complete else "unknown"


def _right_dividend_request_status(
    right: dict,
    dividend_requests: list[dict],
    *,
    source_complete: bool = False,
) -> Optional[bool]:
    assessment = _right_dividend_request_assessment(
        right,
        dividend_requests,
        source_complete=source_complete,
    )
    if assessment == "timely":
        return True
    if assessment in {"late", "absent"}:
        return False
    return None


def _extract_tenants(soup) -> list[dict]:
    tenants = []
    for table in soup.find_all("table"):
        table_text = table.get_text(" ", strip=True)
        if "임차" not in table_text and "보증금" not in table_text:
            continue
        for row in _iter_table_rows(table):
            row_text = " ".join(row)
            if "보증금" not in row_text and not re.search(r"\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}", row_text):
                continue
            dates = [normalize_date(d) for d in re.findall(r"\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}", row_text)]
            name = row[0] if row else ""
            if not name or any(word in name for word in ("임차", "점유", "성명")):
                name = _guess_name(row)
            tenants.append(
                {
                    "name": name or "임차인",
                    "type": "주택도시보증공사" if "주택도시보증공사" in row_text or "HUG" in row_text.upper() else "",
                    "moveInDate": dates[0] if len(dates) > 0 else "",
                    "fixedDate": dates[1] if len(dates) > 1 else "",
                    "depositClaimDate": dates[2] if len(dates) > 2 else "",
                    "depositDeadline": "",
                    "deposit": parse_money(row_text),
                    "rent": 0,
                    "isHUG": "주택도시보증공사" in row_text or "HUG" in row_text.upper(),
                    "isVacant": "공실" in row_text,
                }
            )
    return _dedupe_by(tenants, ("name", "moveInDate", "deposit"))


def _extract_dividend_requests(soup) -> list[dict]:
    requests = []
    for table in soup.find_all("table"):
        table_text = table.get_text(" ", strip=True)
        if "배당" not in table_text:
            continue
        for row in _iter_table_rows(table):
            row_text = " ".join(row)
            if not _row_has_affirmative_dividend_request(row_text):
                continue
            dates = [normalize_date(d) for d in re.findall(r"\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}", row_text)]
            if not dates:
                continue
            requests.append(
                {
                    "creditor": _guess_name(row) or (row[0] if row else ""),
                    "requestDate": dates[0],
                    "deadline": dates[1] if len(dates) > 1 else "",
                    "amount": parse_money(row_text),
                }
            )
    return _dedupe_by(requests, ("creditor", "requestDate", "deadline", "amount"))


def _row_has_affirmative_dividend_request(text: str) -> bool:
    compact = re.sub(r"\s+", "", str(text or ""))
    if "배당요구" not in compact:
        return False
    if any(token in compact for token in (
        "배당요구종기", "배당요구예정", "배당요구신청예정", "배당요구제출예정",
        "배당요구미제출", "배당요구미신청", "배당요구없", "배당요구미확인",
        "배당요구여부", "배당예정", "예상배당", "배당표",
    )):
        return False
    return any(token in compact for token in (
        "배당요구접수", "배당요구서접수", "배당요구신청완료", "배당요구제출완료",
        "배당요구서제출", "배당요구완료",
    ))


def _extract_expected_dividend(soup, case_number: str = "", applicant_creditors: Optional[list[str]] = None) -> dict:
    applicant_creditors = applicant_creditors if applicant_creditors is not None else _extract_auction_applicant_creditors(soup, case_number)
    table_result = _extract_expected_dividend_from_tables(soup, applicant_creditors, case_number)
    if table_result:
        return table_result

    direct = _parse_money_cell(
        _css_text(soup, "#dtl_table > table > tbody > tr:nth-child(8) > td:nth-child(4)")
    )
    if direct.get("found"):
        return {
            "auctionApplicantDividendAmount": direct["amount"],
            "auctionApplicantDividendFound": True,
            "source": "dtl_table_selector",
        }

    return {}


def _extract_expected_dividend_from_tables(soup, applicant_creditors: list[str], case_number: str = "") -> dict:
    applicant_names = [_normalize_creditor_name(name) for name in applicant_creditors]
    applicant_names = [name for name in applicant_names if name]
    normalized_case_number = _normalize_case_number(case_number)

    stock = soup.select_one("#dtl_stock") or soup
    for table in stock.find_all("table"):
        table_text = table.get_text(" ", strip=True)
        if not _is_expected_dividend_table_text(table_text):
            continue
        rows = _iter_table_rows(table)
        if not rows:
            continue

        header_idx = _find_header_row_index(rows, ("채권배당금", "배당금", "배당액", "순위배당"))
        header = rows[header_idx] if header_idx is not None else rows[0]
        data_rows = rows[header_idx + 1:] if header_idx is not None else rows[1:]
        creditor_idx = _find_header_index(header, ("권리자", "채권자", "성명"))
        amount_idx = _find_header_index(header, ("채권배당금", "배당금", "배당액", "순위배당"))
        for row in data_rows:
            row_text = " ".join(row)
            creditor = _expected_dividend_row_creditor(row, creditor_idx)
            is_applicant_row = (
                _is_auction_applicant_row(row_text)
                or _row_has_case_number(row_text, normalized_case_number)
                or _creditor_matches_any(creditor, applicant_names)
            )
            if not is_applicant_row:
                continue

            candidates = []
            if amount_idx is not None and amount_idx < len(row):
                candidates.append(row[amount_idx])
            if len(row) >= 4:
                candidates.append(row[3])
            candidates.append(row_text)

            for candidate in candidates:
                parsed = _parse_money_cell(candidate)
                if parsed.get("found"):
                    return {
                        "auctionApplicantDividendAmount": parsed["amount"],
                        "auctionApplicantDividendFound": True,
                        "source": "expected_dividend_table",
                        "auctionApplicantCreditor": creditor,
                        "rowText": row_text,
                    }
    return {}


def _is_expected_dividend_table_text(table_text: str) -> bool:
    compact = re.sub(r"\s+", "", table_text or "")
    return (
        "예상배당표" in compact
        or "채권배당금" in compact
        or "입찰예상가" in compact
        or "최저경매가기준" in compact
    )


def _extract_auction_applicant_creditors(soup, case_number: str = "") -> list[str]:
    creditors = []
    case_matched_creditors = []
    normalized_case_number = _normalize_case_number(case_number)
    for table in soup.find_all("table"):
        table_text = table.get_text(" ", strip=True)
        if "임의경매" not in table_text and "강제경매" not in table_text:
            continue
        for row in _iter_table_rows(table):
            row_text = " ".join(row)
            if "임의경매" not in row_text and "강제경매" not in row_text:
                continue
            creditor = _guess_auction_applicant_creditor(row)
            if creditor:
                creditors.append(creditor)
                if _row_has_case_number(row_text, normalized_case_number):
                    case_matched_creditors.append(creditor)
    return _dedupe_strings(case_matched_creditors or creditors)


def _guess_auction_applicant_creditor(row: list[str]) -> str:
    for idx, cell in enumerate(row):
        if "임의경매" not in cell and "강제경매" not in cell:
            continue
        for candidate in row[idx + 1:]:
            creditor = _clean_creditor_candidate(candidate)
            if creditor:
                return creditor
        row_text = " ".join(row)
        tail = re.split(r"임의경매|강제경매", row_text, maxsplit=1)[-1]
        return _clean_creditor_candidate(tail)
    return ""


def _clean_creditor_candidate(value: str) -> str:
    text = re.sub(r"\[[^\]]*\]", " ", str(value or ""))
    text = re.sub(r"\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}", " ", text)
    text = re.sub(r"\d{4}\s*타경\s*\d+", " ", text)
    text = re.sub(r"\d{1,3}(?:,\d{3})+|\d{4,}\s*원?", " ", text)
    text = re.sub(r"\b\d+\b", " ", text)
    text = re.sub(r"(소멸|인수|청구금액|채권액|채권최고액|비고|권리자|권리|임의경매|강제경매)", " ", text)
    text = re.sub(r"\s+", " ", text).strip(" /,|")
    if not re.search(r"[가-힣A-Za-z]", text):
        return ""
    return text


def _expected_dividend_row_creditor(row: list[str], creditor_idx: Optional[int]) -> str:
    if creditor_idx is not None and creditor_idx < len(row):
        creditor = _clean_creditor_candidate(row[creditor_idx])
        if creditor:
            return creditor
    if len(row) > 1:
        creditor = _clean_creditor_candidate(row[1])
        if creditor:
            return creditor
    return _clean_creditor_candidate(" ".join(row))


def _creditor_matches_any(creditor: str, applicant_names: list[str]) -> bool:
    normalized = _normalize_creditor_name(creditor)
    if not normalized:
        return False
    return any(_creditor_names_match(normalized, applicant) for applicant in applicant_names)


def _normalize_case_number(value: str) -> str:
    text = re.sub(r"\s+", "", str(value or ""))
    m = re.search(r"(\d{4})타경(\d+)", text)
    return f"{m.group(1)}타경{m.group(2)}" if m else text


def _row_has_case_number(row_text: str, normalized_case_number: str) -> bool:
    compact = re.sub(r"\s+", "", str(row_text or ""))
    return bool(normalized_case_number and normalized_case_number in compact)


def _normalize_creditor_name(value: str) -> str:
    text = str(value or "")
    for token in ("주식회사", "(주)", "㈜", "유한회사", "합자회사", "합명회사", "재단법인", "사단법인"):
        text = text.replace(token, "")
    return re.sub(r"[^0-9A-Za-z가-힣]+", "", text)


def _creditor_names_match(left: str, right: str) -> bool:
    left = _normalize_creditor_name(left)
    right = _normalize_creditor_name(right)
    if not left or not right:
        return False
    if left == right:
        return True
    return min(len(left), len(right)) >= 3 and (left in right or right in left)


def _dedupe_strings(values: list[str]) -> list[str]:
    result = []
    seen = set()
    for value in values:
        key = _normalize_creditor_name(value)
        if key and key not in seen:
            seen.add(key)
            result.append(value)
    return result


def _is_auction_applicant_row(text: str) -> bool:
    compact = re.sub(r"\s+", "", text or "")
    return (
        "경매신청채권자" in compact
        or ("경매" in compact and "신청" in compact and "채권자" in compact)
        or "임의경매" in compact
        or "강제경매" in compact
    )


def _find_header_row_index(rows: list[list[str]], keywords: tuple[str, ...]) -> Optional[int]:
    for idx, row in enumerate(rows):
        if _find_header_index(row, keywords) is not None:
            return idx
    return None


def _find_header_index(row: list[str], keywords: tuple[str, ...]) -> Optional[int]:
    for idx, cell in enumerate(row):
        compact = re.sub(r"\s+", "", cell or "")
        if any(keyword in compact for keyword in keywords):
            return idx
    return None


def _parse_money_cell(value) -> dict:
    text = re.sub(r"\s+", "", str(value or ""))
    if not text:
        return {"found": False, "amount": 0}
    if re.search(r"(?:^|[^\d])0원", text) or text in ("0", "0원", "-0원"):
        return {"found": True, "amount": 0}
    amount = parse_money(text)
    return {"found": amount > 0, "amount": amount}


def _extract_related_cases(soup) -> list[dict]:
    cases = []
    text = soup.get_text(" ", strip=True)
    case_pattern = r"(?:\d{4})\s*타경\s*\d+"
    for m in re.finditer(r"중복경매|병합경매|중복|병합", text):
        case_type = m.group(0)
        if case_type in ("중복", "병합"):
            case_type = f"{case_type}경매"

        after = text[m.end(): m.end() + 35]
        after_match = re.search(case_pattern, after)
        if after_match:
            case_number = _normalize_case_number(after_match.group(0))
            cases.append({"caseNumber": case_number, "creditor": "", "type": case_type, "filingDate": ""})
            continue

        before = text[max(0, m.start() - 35): m.start()]
        before_matches = list(re.finditer(case_pattern, before))
        if before_matches:
            case_number = _normalize_case_number(before_matches[-1].group(0))
            cases.append({"caseNumber": case_number, "creditor": "", "type": case_type, "filingDate": ""})
    return _dedupe_by(cases, ("caseNumber", "type"))


def _extract_management_fee(soup) -> dict:
    candidates: list[tuple[int, int, str]] = []
    for source_text in _management_fee_source_texts(soup):
        text = re.sub(r"\s+", " ", source_text)
        if "관리비" not in text:
            continue
        if _looks_contaminated_management_fee_text(text):
            continue
        for match in re.finditer(r"(?:미납\s*)?관리비|체납\s*관리비", text):
            nearby = text[max(0, match.start() - 80): min(len(text), match.end() + 180)]
            if "관리비" not in nearby or _looks_contaminated_management_fee_text(nearby):
                continue
            unpaid_hint = any(word in nearby for word in ("미납", "체납"))
            amount = _extract_management_fee_amount(nearby) if unpaid_hint else 0
            keyword_score = 2 if re.search(r"미납\s*관리비|체납\s*관리비", match.group(0)) else 1
            amount_score = 10 if amount > 0 else 0
            clear_score = 3 if _management_fee_note_explicitly_clear(nearby) else 0
            candidates.append((amount_score + clear_score + keyword_score, amount, nearby))

    if not candidates:
        return {}

    _, amount, nearby = max(candidates, key=lambda item: item[0])
    amount_status = "confirmed" if amount > 0 else "none" if _management_fee_note_explicitly_clear(nearby) else "unknown"
    return {
        "unpaidAmount": amount,
        "amountStatus": amount_status,
        "unpaidMonths": 0,
        "dueThroughText": _extract_management_fee_due_text(nearby),
        "checkDate": normalize_date(_first_date(nearby) or ""),
        "note": _clip_text(nearby, 160),
    }


def _management_fee_source_texts(soup) -> list[str]:
    sources: list[str] = []
    seen: set[str] = set()

    def add(text: str) -> None:
        cleaned = re.sub(r"\s+", " ", str(text or "")).strip()
        if not cleaned or "관리비" not in cleaned:
            return
        key = re.sub(r"\s+", "", cleaned)
        if key in seen:
            return
        seen.add(key)
        sources.append(cleaned)

    for stock in soup.find_all("div", id="dtl_stock"):
        heading = stock.select_one("div#dtl_title > h3") or stock.find("h3")
        heading_text = heading.get_text(" ", strip=True) if heading else ""
        stock_text = stock.get_text(" ", strip=True)
        compact = re.sub(r"\s+", "", f"{heading_text} {stock_text}")
        if "관리비" in heading_text or re.search(r"(미납|체납)관리비", compact):
            add(stock_text)

    for row in soup.find_all("tr"):
        row_text = row.get_text(" ", strip=True)
        compact = re.sub(r"\s+", "", row_text)
        if re.search(r"(미납|체납)관리비|관리비(미납|체납|없음|0원)", compact):
            add(row_text)

    for text_node in soup.find_all(string=lambda s: s and re.search(r"(미납|체납)\s*관리비|관리비\s*(?:미납|체납|없음|0\s*원)", s)):
        parent = getattr(text_node, "parent", None)
        if parent:
            add(parent.get_text(" ", strip=True))

    return sources


def _looks_contaminated_management_fee_text(text: str) -> bool:
    compact = re.sub(r"\s+", "", str(text or ""))
    if not compact:
        return True
    contamination_tokens = ("기일내역", "감정평가현황", "저가비율", "유찰", "매각기일", "입찰기일")
    if not any(token in compact for token in contamination_tokens):
        return False
    has_explicit_amount = _extract_management_fee_amount(text) > 0
    has_clear_value = _management_fee_note_explicitly_clear(text)
    return not (has_explicit_amount or has_clear_value)


def _management_fee_note_explicitly_clear(text: str) -> bool:
    compact = re.sub(r"\s+", "", str(text or ""))
    if not compact or "미확인" in compact or "확인필요" in compact:
        return False
    return any(
        phrase in compact
        for phrase in (
            "미납관리비없음",
            "미납관리비없습니다",
            "체납관리비없음",
            "체납관리비없습니다",
            "관리비미납없음",
            "관리비체납없음",
            "미납관리비0원",
            "체납관리비0원",
        )
    )


def _extract_management_fee_due_text(text: str) -> str:
    text = re.sub(r"\s+", " ", text or "")
    match = re.search(r"(?<!\d)(\d{2,4})\s*(?:년|[.\-/])\s*(\d{1,2})\s*월?\s*까지", text)
    if match:
        year = int(match.group(1))
        month = int(match.group(2))
        return f"{year % 100:02d}년 {month}월까지"
    match = re.search(r"(?<!\d)(\d{1,2})\s*월\s*까지", text)
    if match:
        return f"{int(match.group(1))}월까지"
    return ""


def _extract_management_fee_amount(text: str) -> int:
    normalized = re.sub(r"\s+", " ", text or "")
    keyword_pattern = r"(?:미납|체납)\s*관리비|관리비\s*(?:미납|체납)(?:액|금액)?"
    amount_pattern = re.compile(r"(\d+(?:,\d{3})*(?:\.\d+)?)\s*(억원|억|만원|만\s*원|원)")
    unrelated_price_labels = re.compile(r"감정가|최저가|매각가|시세|보증금|채권")

    for keyword in re.finditer(keyword_pattern, normalized):
        nearby = normalized[keyword.end(): keyword.end() + 80]
        for amount_match in amount_pattern.finditer(nearby):
            prefix = nearby[:amount_match.start()]
            if unrelated_price_labels.search(prefix):
                break

            number = float(amount_match.group(1).replace(",", ""))
            unit = re.sub(r"\s+", "", amount_match.group(2))
            multiplier = 100_000_000 if unit.startswith("억") else 10_000 if unit.startswith("만") else 1
            amount = int(number * multiplier)
            if amount > 0:
                return amount
    return 0


def _extract_market_data(soup) -> dict:
    text = soup.get_text(" ", strip=True)
    if "실거래" not in text and "매각사례" not in text:
        return {}
    idx = max(text.find("실거래"), text.find("매각사례"))
    nearby = text[max(0, idx - 80): idx + 240]
    return {
        "recentDealPrice": parse_money(nearby),
        "recentDealDate": normalize_date(_first_date(nearby) or ""),
        "trend": "",
    }


def _iter_table_rows(table) -> list[list[str]]:
    rows = []
    for tr in table.find_all("tr"):
        cells = [c.get_text(" ", strip=True) for c in tr.find_all(["th", "td"])]
        cells = [re.sub(r"\s+", " ", c).strip() for c in cells if c and c.strip()]
        if cells:
            rows.append(cells)
    return rows


def _css_text(soup, *selectors: str) -> str:
    for selector in selectors:
        try:
            el = soup.select_one(selector)
        except Exception:
            el = None
        if not el:
            continue
        text = re.sub(r"\s+", " ", el.get_text(" ", strip=True)).strip()
        if text:
            return text
    return ""


def _first_match(text: str, candidates: tuple[str, ...]) -> str:
    for candidate in candidates:
        if candidate in text:
            return candidate
    return ""


def _first_date(text: str) -> str:
    m = re.search(r"\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}", text or "")
    return m.group(0) if m else ""


def _first_any_date(text: str) -> str:
    pattern = r"\d{4}\s*(?:[.\-/년])\s*\d{1,2}\s*(?:[.\-/월])\s*\d{1,2}\s*\.?\s*일?"
    match = re.search(pattern, text or "")
    return normalize_date(match.group(0)) if match else ""


def normalize_date(date_str: str) -> str:
    if not date_str:
        return ""
    nums = re.findall(r"\d+", date_str)
    if len(nums) < 3:
        return date_str
    return f"{int(nums[0]):04d}.{int(nums[1]):02d}.{int(nums[2]):02d}"


def _date_sort_key(date_str: Optional[str]) -> tuple[int, int, int]:
    nums = re.findall(r"\d+", date_str or "")
    if len(nums) < 3:
        return (9999, 99, 99)
    return (int(nums[0]), int(nums[1]), int(nums[2]))


def _has_valid_date(date_str: str) -> bool:
    return _date_sort_key(date_str) != (9999, 99, 99)


def _date_before(left: str, right: str) -> bool:
    return _has_valid_date(left) and _has_valid_date(right) and _date_sort_key(left) < _date_sort_key(right)


def _same_date(left: str, right: str) -> bool:
    return _has_valid_date(left) and _has_valid_date(right) and _date_sort_key(left) == _date_sort_key(right)


def _date_on_or_before(left: str, right: str) -> bool:
    return _has_valid_date(left) and _has_valid_date(right) and _date_sort_key(left) <= _date_sort_key(right)


def _date_after(left: str, right: str) -> bool:
    return _has_valid_date(left) and _has_valid_date(right) and _date_sort_key(left) > _date_sort_key(right)


def parse_money(value) -> int:
    if value is None:
        return 0
    if isinstance(value, (int, float)):
        return int(value)
    text = str(value)
    comma_nums = re.findall(r"\d{1,3}(?:,\d{3})+", text)
    if comma_nums:
        return max(int(n.replace(",", "")) for n in comma_nums)
    won_nums = re.findall(r"(\d{4,})\s*원", text)
    if won_nums:
        return max(int(n) for n in won_nums)
    if re.fullmatch(r"\d{4,}", text.strip()):
        return int(text.strip())
    return 0


def fmt_money(value) -> str:
    amount = parse_money(value)
    if amount <= 0:
        return "담당자 확인 필요"
    return f"{amount:,}원"


def fmt_money_or_unknown(value) -> str:
    amount = parse_money(value)
    if amount <= 0:
        return "없음 또는 미확인"
    return f"{amount:,}원"


def format_korean_date(date: datetime) -> str:
    return f"{date.year}년 {date.month}월 {date.day}일"


def _clip_text(text: str, limit: int) -> str:
    text = (text or "").strip()
    if len(text) <= limit:
        return text
    return text[:limit].rstrip() + "..."


def _guess_creditor(cells: list[str], right_type: str) -> str:
    for cell in cells:
        if right_type in cell or _first_date(cell) or parse_money(cell):
            continue
        compact = re.sub(r"\s+", "", cell or "")
        if any(token in compact for token in ("말소기준", "소멸기준", "소멸", "인수", "비고")):
            continue
        if len(cell) <= 2:
            continue
        return cell[:80]
    return ""


def _guess_name(cells: list[str]) -> str:
    for cell in cells:
        if _first_date(cell) or parse_money(cell):
            continue
        if any(word in cell for word in ("임차", "배당", "보증금", "전입", "확정")):
            continue
        if 1 < len(cell) <= 40:
            return cell
    return ""


def _find_dividend_request(name: str, requests: list[dict]) -> Optional[dict]:
    if not name:
        return None
    for request in requests:
        creditor = request.get("creditor") or ""
        if _creditor_names_match(name, creditor):
            return request
    return None


def _dedupe_by(items: list[dict], keys: tuple[str, ...]) -> list[dict]:
    seen = set()
    unique = []
    for item in items:
        marker = tuple(item.get(k) for k in keys)
        if marker in seen:
            continue
        seen.add(marker)
        unique.append(item)
    return unique
