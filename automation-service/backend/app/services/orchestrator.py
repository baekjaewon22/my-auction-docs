# -*- coding: utf-8 -*-
"""
오케스트레이터: 전체 보고서 생성 파이프라인
- final.py의 main() 함수를 모듈화한 것
- WebSocket으로 진행상황 전송
"""

import os
import re
import time
import logging
from urllib.parse import urljoin
from typing import Optional, Callable

from pptx import Presentation
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

from ..core.config import (
    settings, CAPTURE_DIR, OUTPUT_DIR, SELENIUM_PROFILE_DIR,
    ensure_dirs, load_config, save_config,
)
from ..core.utils import normalize_myauction_detail_url, track_file, cleanup_generated_files
from ..models.schemas import ReportRequest, ProgressUpdate

from . import crawler
from . import capturer
from . import pdf_processor
from . import ppt_builder
from . import forced_execution_estimator
from . import briefing_opinion
from . import briefing_rights
from .selenium_driver import (
    create_driver, login_myauction, click_tab_safe,
    switch_to_new_window, wait_document_ready, safe_click, navigate_with_retry,
    account_profile_dir, log_detail_page_diagnostics, _dismiss_alert,
)

logger = logging.getLogger(__name__)
logger.info(f"Orchestrator module loaded: {__file__}")

# 이미지 패턴
IMG_PATTERN = str(CAPTURE_DIR / "building_register_{page}.png")
SALE_IMG_PATTERN = str(CAPTURE_DIR / "sale_spec_{page}.png")
STATUS_IMG_PATTERN = str(CAPTURE_DIR / "status_report_{page}.png")
REGISTRY_IMG_PATTERN = str(CAPTURE_DIR / "registry_summary_{page}.png")

# 캡처 파일 경로
COURT_GUIDE_PNG = str(CAPTURE_DIR / "court_guide_capture.png")
KAKAO_MAP_PNG = str(CAPTURE_DIR / "kakao_map.png")
KAKAO_SAT_PNG = str(CAPTURE_DIR / "kakao_satellite.png")
LAND_USE_PLAN_PNG = str(CAPTURE_DIR / "land_use_plan.png")
APPRAISAL_PREFIX = str(CAPTURE_DIR / "appraisal_location_part")
EVICTION_COST_BASIS_PNG = str(CAPTURE_DIR / "eviction_cost_basis.png")

REGISTRY_NEEDLE = "주요 등기사항 요약"
BUILDING_OVERVIEW_PNG = str(CAPTURE_DIR / "building_overview.png")

# 전체 단계 수
TOTAL_STEPS = 6


def _short_selenium_message(exc: Exception, fallback: str) -> str:
    text = str(exc or "").strip()
    compact = re.sub(r"\s+", " ", text)
    if not text or compact.startswith("Message: Stacktrace:") or text.startswith("Message: \nStacktrace:"):
        return fallback
    compact = re.sub(r"Stacktrace:.*$", "", compact).strip()
    return compact[:500] or fallback


def _find_public_data_link(driver, timeout: int = 20):
    end = time.time() + timeout
    xpath_candidates = [
        "//div[@id='dtlw_link']//a[normalize-space(.)='부동산표시']",
        "//div[@id='dtlw_link']//a[contains(normalize-space(.), '부동산표시')]",
        "//div[@id='dtlw_link']//a[contains(normalize-space(.), '공시자료')]",
        "//a[contains(normalize-space(.), '부동산표시')]",
        "//a[contains(normalize-space(.), '공시자료')]",
        "//a[contains(@href, 'aceeair') or contains(@onclick, 'aceeair')]",
        "//*[self::a or self::button][.//img[contains(@alt, '공시') or contains(@alt, '부동산')]]",
    ]
    reject_words = ("매각물건명세서", "물건명세서", "현황조사서", "등기부", "감정평가서", "물건사진")
    accept_words = ("부동산표시", "공시자료")
    last_err = None
    while time.time() < end:
        for xpath in xpath_candidates:
            try:
                elements = driver.find_elements(By.XPATH, xpath)
                if elements:
                    logger.info(f"공시자료 링크 후보 발견: xpath={xpath}, count={len(elements)}")
                for el in elements:
                    try:
                        text = (el.text or el.get_attribute("title") or el.get_attribute("href") or el.get_attribute("onclick") or "").strip()
                        text_clean = re.sub(r"\s+", " ", text)[:160]
                        logger.info(
                            f"공시자료 링크 후보 상태: displayed={el.is_displayed()}, enabled={el.is_enabled()}, "
                            f"text={text_clean}"
                        )
                    except Exception:
                        pass
                    try:
                        probe_text = driver.execute_script("""
                            const el = arguments[0];
                            return [
                              el.innerText,
                              el.textContent,
                              el.getAttribute('title'),
                              el.getAttribute('alt'),
                              el.getAttribute('href'),
                              el.getAttribute('onclick')
                            ].filter(Boolean).join(' ');
                        """, el) or ""
                    except Exception:
                        probe_text = ""
                    if any(word in probe_text for word in reject_words) and not any(word in probe_text for word in accept_words):
                        probe_preview = re.sub(r"\s+", " ", probe_text)[:160]
                        logger.info(f"공시자료 후보 제외: text={probe_preview}")
                        continue
                    if el.is_displayed() and el.is_enabled():
                        return el
            except Exception as e:
                last_err = e
        try:
            el = driver.execute_script("""
                const needles = ['부동산표시', '공시자료'];
                const rejects = ['매각물건명세서', '물건명세서', '현황조사서', '등기부', '감정평가서', '물건사진'];
                const nodes = Array.from(document.querySelectorAll('a, button, area, input[type=button], input[type=image], img'));
                for (const node of nodes) {
                  const holder = node.closest('a, button') || node;
                  const text = [
                    node.innerText,
                    node.textContent,
                    node.getAttribute('title'),
                    node.getAttribute('alt'),
                    node.getAttribute('value'),
                    node.getAttribute('href'),
                    node.getAttribute('onclick'),
                    holder.getAttribute('title'),
                    holder.getAttribute('href'),
                    holder.getAttribute('onclick')
                  ].filter(Boolean).join(' ');
                  if (!needles.some((needle) => text.includes(needle))) continue;
                  if (rejects.some((word) => text.includes(word)) && !needles.some((needle) => text.includes(needle))) continue;
                  const rect = holder.getBoundingClientRect();
                  const style = window.getComputedStyle(holder);
                  if (rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none') {
                    return holder;
                  }
                }
                return null;
            """)
            if el:
                return el
        except Exception as e:
            last_err = e
        time.sleep(0.4)
    raise RuntimeError("공시자료 팝업 링크를 찾지 못했습니다. 마이옥션 화면 구조가 변경되었거나 해당 사건에 공시자료 버튼이 없습니다.") from last_err


def _open_public_data_page(driver, link_el, timeout: int = 15) -> str:
    info = driver.execute_script("""
        const el = arguments[0];
        return {
          text: `${el.innerText || el.textContent || ''}`.trim(),
          href: el.getAttribute('href') || '',
          onclick: el.getAttribute('onclick') || ''
        };
    """, link_el) or {}
    logger.info(
        "공시자료 선택 링크: "
        f"text={info.get('text', '')}, href={info.get('href', '')}, onclick={info.get('onclick', '')}"
    )

    href = (info.get("href") or "").strip()
    onclick = (info.get("onclick") or "").strip()
    popup_path = driver.execute_script("""
        const href = arguments[0] || '';
        const onclick = arguments[1] || '';
        const text = `${onclick} ${href}`;
        const match = text.match(/windowOpen\\(['"]([^'"]+)['"]/) ||
                      text.match(/open\\(['"]([^'"]+)['"]/) ||
                      text.match(/location\\.href\\s*=\\s*['"]([^'"]+)['"]/);
        return match ? match[1] : '';
    """, href, onclick)

    direct_url = popup_path or href
    if direct_url and not direct_url.lower().startswith("javascript:") and direct_url != "#none":
        if direct_url.startswith("../"):
            direct_url = "/" + direct_url[3:]
        direct_url = urljoin(driver.current_url, direct_url)
        logger.info(f"공시자료 URL 직접 이동: {direct_url}")
        driver.get(direct_url)
        wait_document_ready(driver, timeout=timeout)
        return driver.current_window_handle

    before_handles = list(driver.window_handles)
    safe_click(driver, link_el)
    before_set = set(before_handles)
    end = time.time() + min(4, timeout)
    while time.time() < end:
        new_handles = list(set(driver.window_handles) - before_set)
        if new_handles:
            driver.switch_to.window(new_handles[0])
            wait_document_ready(driver, timeout=timeout)
            logger.info(f"공시자료 새 창 열림: {driver.current_url}")
            return new_handles[0]
        time.sleep(0.2)

    wait_document_ready(driver, timeout=timeout)
    logger.info(f"공시자료 현재 창 열림: {driver.current_url}")
    return driver.current_window_handle


def _safe_filename_part(value: str) -> str:
    text = re.sub(r"\s+", "", str(value or "")).strip()
    text = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', "_", text)
    text = text.strip(" ._-")
    return text[:80]


def _briefing_output_file(data: dict, task_id: Optional[str] = None) -> str:
    case_number = _safe_filename_part(data.get("case_number") or "")
    if not case_number:
        case_number = _safe_filename_part(task_id or "") or time.strftime("%Y%m%d_%H%M%S")

    output_dir = os.path.dirname(settings.output_file) or str(OUTPUT_DIR)
    output_ext = os.path.splitext(settings.output_file)[1] or ".pptm"
    return os.path.join(output_dir, f"브리핑자료_{case_number}{output_ext}")


def _apply_author_fields(data: dict, request: ReportRequest) -> None:
    author_name = str(getattr(request, "author_name", "") or "").strip()
    author_title = str(getattr(request, "author_title", "") or "").strip()
    author_phone = str(getattr(request, "author_phone", "") or "").strip()
    author_name_title = " ".join(part for part in (author_name, author_title) if part).strip()

    data["authorName"] = author_name
    data["authorTitle"] = author_title
    data["authorPhone"] = author_phone
    data["가입자 성명"] = author_name
    data["가입자 직책"] = author_title
    data["가입자 성명 직책"] = author_name_title
    data["가입자 전화번호"] = author_phone


async def generate_report(
    request: ReportRequest,
    progress_callback: Optional[Callable] = None,
    task_id: Optional[str] = None,
) -> dict:
    logger.info(f"generate_report using orchestrator: {__file__}")
    """
    전체 보고서 생성 파이프라인
    progress_callback(ProgressUpdate) 로 진행상황 전달
    """
    ensure_dirs()

    def emit(step, title, message, status="running", percent=0.0):
        if progress_callback:
            try:
                update = ProgressUpdate(
                    step=step, total_steps=TOTAL_STEPS,
                    title=title, message=message,
                    status=status, percent=percent,
                )
                # 동기/비동기 콜백 모두 지원
                import asyncio
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
        logger.info(f"[{step}/{TOTAL_STEPS}] {title}: {message}")

    input_url = (request.url or "").strip()
    url = normalize_myauction_detail_url(input_url, request.myauction_id)
    logger.info(f"입력 URL: {input_url}")
    logger.info(f"URL 정규화 결과: {url}")
    logger.info(
        "URL 정규화 상세: "
        f"view_to_view3={'/view/' in input_url and '/view3/' not in input_url}, "
        f"myauction_id_appended={bool(request.myauction_id and request.myauction_id.strip() and request.myauction_id.strip() in url)}, "
        f"final_url={url}"
    )

    # 초기화
    data = {}
    prs = None
    LAND_MODE = False
    total_building = total_sale = total_registry = total_status = 0
    tenant_imgs = building_registry_imgs = land_registry_imgs = []
    land_use_plan_img = kakao_map_img = kakao_sat_img = ""
    loc_left_img = loc_right_img = ""
    court_start_time = court_end_time = court_capture_png = ""
    building_overview_img = ""
    eviction_cost_basis_img = ""

    # ===== STEP 0: Selenium 준비 =====
    emit(0, "브라우저 준비", "Chrome 시작 중...")

    profile_dir = account_profile_dir(request.myauction_id) if request.remember_login else ""
    logger.info(
        f"Chrome profile 선택: remember_login={request.remember_login}, "
        f"profile_dir={profile_dir or '(임시/비저장 프로필)'}"
    )

    driver = create_driver(profile_dir=profile_dir, headless=True)

    try:
        # ===== STEP 1: 로그인 + 파싱 =====
        emit(1, "사이트 파싱", "마이옥션 로그인 중...", percent=5)
        login_myauction(driver, request.myauction_id, request.myauction_pw)

        emit(1, "사이트 파싱", "상세 페이지 접속 중...", percent=10)
        navigate_with_retry(driver, url, retries=3)
        wait_document_ready(driver, timeout=30)
        time.sleep(5)
        current_url = driver.current_url or ""
        page_source = driver.page_source or ""
        logger.info(f"MyAuction detail loaded: url={current_url}, title={driver.title or ''}, html_length={len(page_source)}")
        log_detail_page_diagnostics(driver, prefix="브리핑자료 상세 진입 직후")
        if "member/login.php" in current_url or ("id=\"id\"" in page_source and "passwd" in page_source):
            raise RuntimeError("마이옥션 로그인이 유지되지 않아 사건 상세 페이지 대신 로그인 화면이 열렸습니다. 저장된 마이옥션 ID/PW를 다시 확인해 주세요.")

        emit(1, "사이트 파싱", "데이터 추출 중...", percent=15)
        soup = crawler.fetch_soup_from_driver(driver)
        data = crawler.parse_myauction_detail(soup, url, driver=driver)
        _apply_author_fields(data, request)
        LAND_MODE = bool(data.get("LAND_MODE", False))

        # 토지이용계획 텍스트
        try:
            landplan_url = (data.get("landplan_url") or "").strip()
            if landplan_url:
                refined = crawler.fetch_land_zoning_from_plan(driver, landplan_url)
                if refined:
                    data["land_zoning"] = refined
        except Exception as e:
            logger.warning(f"토지이용계획 추출 실패: {e}")

        rights_analysis_opinion = ""
        special_opinion = ""
        try:
            emit(1, "사이트 파싱", "권리분석 정보 확인 중...", percent=18)
            rights_context = briefing_rights.extract_context(soup, driver=driver, task_id=task_id)
            if rights_context:
                data.update(rights_context)
            briefing_rights_data = briefing_rights.build_opinion_data(data)
            rights_analysis_opinion = briefing_opinion.build_rights_analysis_opinion(briefing_rights_data)
            special_opinion = briefing_opinion.build_special_opinion(briefing_rights_data)
            data["rights_analysis_opinion"] = rights_analysis_opinion
            data["special_opinion"] = special_opinion
        except Exception as e:
            logger.warning(f"담당자 종합의견 (2) 권리분석 문안 구성 실패: {e}")

        try:
            data["property_status_opinion"] = briefing_opinion.build_property_status_opinion(data)
        except Exception as e:
            logger.warning(f"담당자 종합의견 (1) 물건현황 문안 구성 실패: {e}")

        try:
            eviction_values = forced_execution_estimator.build_eviction_cost_values(data)
            for key, value in eviction_values.items():
                if key != "cost":
                    data[key] = value
        except Exception as e:
            logger.warning(f"명도비 템플릿 변수 구성 실패: {e}")

        emit(1, "사이트 파싱", "파싱 완료", percent=20)

        # ===== STEP 2: PPT 기본 채우기 =====
        emit(2, "PPT 기본값", "템플릿 로드 중...", percent=20)
        prs = Presentation(settings.pptm_template)
        logger.info(f"PPT template loaded, continue_on_capture_error=True, prs_ready={prs is not None}")
        ppt_builder.fill_slide_with_data(prs, data)
        try:
            property_status_opinion = data.get("property_status_opinion") or briefing_opinion.build_property_status_opinion(data)
            data["property_status_opinion"] = property_status_opinion
            if ppt_builder.apply_property_status_opinion(prs, property_status_opinion):
                logger.info("담당자 종합의견 (1) 물건현황 자동 작성 완료")
        except Exception as e:
            logger.warning(f"담당자 종합의견 (1) 물건현황 작성 실패: {e}")
        try:
            if ppt_builder.apply_rights_analysis_opinion(prs, rights_analysis_opinion):
                logger.info("담당자 종합의견 (2) 권리분석 자동 작성 완료")
        except Exception as e:
            logger.warning(f"담당자 종합의견 (2) 권리분석 작성 실패: {e}")
        try:
            special_opinion = data.get("special_opinion") or special_opinion
            if ppt_builder.apply_special_opinion(prs, special_opinion):
                logger.info("담당자 종합의견 (3) 특이사항 자동 작성 완료")
        except Exception as e:
            logger.warning(f"담당자 종합의견 (3) 특이사항 작성 실패: {e}")
        ppt_builder.insert_main_photo(prs, data.get("photo_url", ""))
        emit(2, "PPT 기본값", "기본값 채우기 완료", percent=25)

        # ===== STEP 3: 캡처 =====
        emit(3, "문서 캡처", "관할법원안내 처리 중...", percent=25)
        base_handle = driver.current_window_handle

        # 관할법원안내
        try:
            court_start_time, court_end_time, court_popup = capturer.open_court_guide_popup(driver)
            court_capture_png = capturer.capture_court_popup(driver, COURT_GUIDE_PNG)
            driver.close()
            driver.switch_to.window(base_handle)
            wait_document_ready(driver)
        except Exception as e:
            logger.warning(f"관할법원안내 실패: {e}")
            try:
                if driver.current_window_handle != base_handle:
                    driver.switch_to.window(base_handle)
            except Exception:
                pass

        # 토지이용계획 캡처
        emit(3, "문서 캡처", "토지이용계획 캡처 중...", percent=30)
        try:
            land_use_plan_img = capturer.capture_land_use_plan(driver, LAND_USE_PLAN_PNG)
        except Exception as e:
            logger.warning(f"토지이용계획 캡처 실패: {e}")

        # 임차인/등기부 캡처
        emit(3, "문서 캡처", "임차인/등기부현황 캡처 중...", percent=35)
        try:
            tenant_imgs, building_registry_imgs, land_registry_imgs = capturer.capture_tenant_and_registry(driver)
            logger.info(
                "임차인/등기부현황 캡처 파일 확인: "
                f"tenant={[(p, os.path.exists(p), os.path.getsize(p) if os.path.exists(p) else 0) for p in tenant_imgs]}, "
                f"building={[(p, os.path.exists(p), os.path.getsize(p) if os.path.exists(p) else 0) for p in building_registry_imgs]}, "
                f"land={[(p, os.path.exists(p), os.path.getsize(p) if os.path.exists(p) else 0) for p in land_registry_imgs]}"
            )
        except Exception as e:
            logger.warning(f"캡처 실패: {e}")

        # 예상명도비용은 캡처 이미지를 삽입하지 않고 템플릿 변수로 자동 입력한다.
        emit(3, "문서 캡처", "예상명도비용 계산값 준비 중...", percent=38)

        # 공시자료 팝업
        emit(3, "문서 캡처", "공시자료 팝업 열기...", percent=40)
        wait = WebDriverWait(driver, 20)
        try:
            bu_link = _find_public_data_link(driver, timeout=25)
            popup_handle = _open_public_data_page(driver, bu_link, timeout=20)
        except Exception as e:
            raise RuntimeError(_short_selenium_message(
                e,
                "공시자료 팝업 링크를 찾거나 클릭하지 못했습니다. 마이옥션 사건 상세 화면에서 공시자료/부동산표시 버튼 노출 여부를 확인해 주세요.",
            )) from e
        time.sleep(1)

        popup_handle = popup_handle or driver.current_window_handle
        wait = WebDriverWait(driver, 15)

        # 카카오맵
        emit(3, "문서 캡처", "전자지도/위성지도 캡처 중...", percent=45)
        try:
            kakao_map_img = capturer.open_kakao_and_capture(driver, popup_handle, "전자지도", KAKAO_MAP_PNG)
        except Exception as e:
            logger.warning(f"전자지도 캡처 실패: {e}")
        try:
            kakao_sat_img = capturer.open_kakao_and_capture(driver, popup_handle, "위성지도", KAKAO_SAT_PNG)
        except Exception as e:
            logger.warning(f"위성지도 캡처 실패: {e}")

        # [MODE] 건축물대장 탭 존재시 건축물 버전 강제 전환
        if LAND_MODE:
            try:
                _tab = click_tab_safe(wait, driver, ["건축물대장", "건축물"])
                if _tab:
                    logger.info("토지로 판별됐지만 '건축물대장' 탭 존재 → 건축물버전으로 전환")
                    LAND_MODE = False
                    data["LAND_MODE"] = False
                    data["BUILDING_MODE"] = True
            except Exception:
                pass

        # 건축물대장
        emit(3, "문서 캡처", "건축물대장 처리 중...", percent=50)
        if not LAND_MODE:
            try:
                clicked = click_tab_safe(wait, driver, ["건축물대장", "건축물"])
                if not clicked:
                    raise RuntimeError("건축물대장 탭을 찾지 못했습니다.")
                logger.info(f"팝업 내 '{clicked}' 탭 클릭 완료")
                time.sleep(1)
                iframe = wait.until(EC.presence_of_element_located((By.ID, "detail_target")))
                pdf_url = iframe.get_attribute("src")
                if not pdf_url:
                    raise RuntimeError("건축물대장 iframe src 없음")
                pdf_path = pdf_processor.download_pdf_with_cookies(driver, pdf_url, "building_register")
                total_building = pdf_processor.pdf_to_images(pdf_path, IMG_PATTERN, dpi=250)
            except Exception as e:
                logger.warning(f"건축물대장 실패 → 생략(계속 진행): {e}")
        else:
            logger.info("토지버전 → 건축물대장 생략")

        # 매각물건명세서
        emit(3, "문서 캡처", "매각물건명세서 처리 중...", percent=55)
        try:
            clicked = click_tab_safe(wait, driver, ["매각물건명세서", "물건명세서"])
            time.sleep(1)
            iframe = wait.until(EC.presence_of_element_located((By.ID, "detail_target")))
            pdf_url = iframe.get_attribute("src")
            if pdf_url:
                pdf_path = pdf_processor.download_pdf_with_cookies(driver, pdf_url, "sale_spec")
                total_sale = pdf_processor.pdf_to_images(pdf_path, SALE_IMG_PATTERN, dpi=250)
        except Exception as e:
            logger.warning(f"매각물건명세서 실패: {e}")

        # 등기부(건물)
        emit(3, "문서 캡처", "등기부 처리 중...", percent=60)
        if not LAND_MODE:
            try:
                clicked = click_tab_safe(wait, driver, ["등기부(건물)", "등기부", "건물"])
                if not clicked:
                    raise RuntimeError("등기부(건물) 탭을 찾지 못했습니다.")
                logger.info(f"팝업 내 '{clicked}' 탭 클릭 완료")
                time.sleep(1)
                iframe = wait.until(EC.presence_of_element_located((By.ID, "detail_target")))
                pdf_url = iframe.get_attribute("src")
                if not pdf_url:
                    raise RuntimeError("등기부(건물) iframe src 없음")

                reg_pdf = pdf_processor.download_pdf_with_cookies(driver, pdf_url, "registry_building")

                # "주요 등기사항 요약" 문구 페이지 찾기 → 가로 변환
                start_idx = pdf_processor.find_first_page_contains_text(reg_pdf, REGISTRY_NEEDLE)
                if start_idx == -1:
                    # 문구 못 찾음 → 마지막 페이지만 가로 변환
                    logger.warning(f"'{REGISTRY_NEEDLE}' 문구를 못 찾음 → 마지막 페이지만 사용")
                    reg_land_pdf = reg_pdf.replace(".pdf", "_last_landscape.pdf")
                    reg_pdf = pdf_processor.pdf_last_page_to_landscape(reg_pdf, reg_land_pdf, dpi=220)
                    track_file(reg_pdf)
                else:
                    # 문구 발견 → 해당 페이지부터 끝까지 가로 변환
                    logger.info(f"'{REGISTRY_NEEDLE}' 발견: {start_idx+1}페이지부터 가로 변환")
                    reg_land_pdf = reg_pdf.replace(".pdf", f"_from_{start_idx+1}_landscape.pdf")
                    reg_pdf = pdf_processor.pdf_pages_from_to_landscape(reg_pdf, reg_land_pdf, start_idx, dpi=220)
                    track_file(reg_pdf)

                total_registry = pdf_processor.pdf_to_images(reg_pdf, REGISTRY_IMG_PATTERN, dpi=250)
            except Exception as e:
                logger.warning(f"등기부(건물) 실패 → 생략(계속 진행): {e}")
        else:
            logger.info("토지버전 → 등기부(건물) 생략")

        # 등기부(토지) - 토지 모드일 때만
        total_registry_land = 0
        if LAND_MODE:
            try:
                emit(3, "문서 캡처", "등기부(토지) 처리 중...", percent=62)
                clicked = click_tab_safe(wait, driver, ["등기부(토지)", "등기부", "토지"])
                if not clicked:
                    raise RuntimeError("등기부(토지) 탭을 찾지 못했습니다.")
                logger.info(f"팝업 내 '{clicked}' 탭 클릭 완료")
                time.sleep(1)
                iframe = wait.until(EC.presence_of_element_located((By.ID, "detail_target")))
                pdf_url = iframe.get_attribute("src")
                if not pdf_url:
                    raise RuntimeError("등기부(토지) iframe src 없음")
                reg_land_pdf = pdf_processor.download_pdf_with_cookies(driver, pdf_url, "registry_land")
                reg_land_img_pattern = str(CAPTURE_DIR / "registry_land_{page}.png")
                total_registry_land = pdf_processor.pdf_to_images(reg_land_pdf, reg_land_img_pattern, dpi=250)
            except Exception as e:
                logger.warning(f"등기부(토지) 실패 → 생략(계속 진행): {e}")

        # 감정평가서
        emit(3, "문서 캡처", "감정평가서 위치도 처리 중...", percent=65)
        try:
            clicked = click_tab_safe(wait, driver, ["감정평가서", "감정평가", "감정"])
            time.sleep(1)
            iframe = wait.until(EC.presence_of_element_located((By.ID, "detail_target")))
            pdf_url = iframe.get_attribute("src")
            if pdf_url:
                appr_pdf = pdf_processor.download_pdf_with_cookies(driver, pdf_url, "appraisal_report")

                # (A) 위치도 탐색 + 렌더링
                found = pdf_processor.find_appraisal_map_pages(appr_pdf)
                chosen = pdf_processor.choose_location_types(found)
                if chosen:
                    page_indices = [found[t] for t in chosen]
                    imgs = pdf_processor.render_pages_vector(appr_pdf, page_indices, APPRAISAL_PREFIX)
                    if len(imgs) >= 1:
                        loc_left_img = imgs[0]
                    if len(imgs) >= 2:
                        loc_right_img = imgs[1]

                # (B) 내부구조도 / 건물개황도 탐색 + 렌더링
                emit(3, "문서 캡처", "내부구조도 탐색 중...", percent=68)
                try:
                    overview_page = pdf_processor.find_building_overview_page(appr_pdf)
                    if overview_page >= 0:
                        overview_imgs = pdf_processor.render_pages_vector(
                            appr_pdf, [overview_page],
                            str(CAPTURE_DIR / "building_overview"),
                            dpi=260,
                        )
                        if overview_imgs:
                            building_overview_img = overview_imgs[0]
                            logger.info(f"도면/내부구조도 이미지 저장 경로: {building_overview_img}")
                except Exception as e2:
                    logger.warning(f"내부구조도 탐색 실패(계속 진행): {e2}")

        except Exception as e:
            logger.warning(f"감정평가서 실패: {e}")

        # 현황조사서
        emit(3, "문서 캡처", "현황조사서 처리 중...", percent=70)
        try:
            clicked = click_tab_safe(wait, driver, ["현황조사서"])
            time.sleep(1)
            status_pdf = pdf_processor.print_current_page_to_pdf(driver, "status_report", landscape=True)
            if pdf_processor.is_valid_pdf(status_pdf):
                total_status = pdf_processor.pdf_to_images(status_pdf, STATUS_IMG_PATTERN, dpi=300)
        except Exception as e:
            logger.warning(f"현황조사서 실패: {e}")

        emit(3, "문서 캡처", "캡처 완료", percent=75)

    except Exception as e:
        message = _short_selenium_message(e, "문서 캡처 일부 단계에서 응답 대기 시간이 초과되었습니다.")
        logger.warning(f"generate_report capture exception caught, prs_ready={prs is not None}, raw_type={type(e).__name__}, safe_message={message}")
        if prs is not None:
            logger.warning(f"문서 캡처 일부 실패 후 저장 계속: {message}")
            emit(3, "문서 캡처", f"일부 문서 캡처 생략: {message}", percent=75)
        else:
            logger.error(f"파이프라인 실패: {message}")
            emit(0, "오류", message, status="error")
            return {"success": False, "message": message}
    finally:
        try:
            driver.quit()
        except Exception:
            pass

    # ===== STEP 4: PPT 이미지 삽입 =====
    emit(4, "PPT 이미지 삽입", "슬라이드에 이미지 삽입 중...", percent=75)

    if prs is None:
        return {"success": False, "message": "PPT 로드 실패"}

    # 관할법원 텍스트 치환
    try:
        slide40 = ppt_builder.find_slide_by_note_key(prs, "SLIDE_KEY=CALC_COST")
        if slide40:
            deposit_num = re.sub(r"[^0-9,]", "", data.get("deposit", "") or "")
            mapping = {
                "{deposit}": deposit_num,
                "{auction_date}": data.get("auction_date", "") or "",
                "{auction_start_time}": court_start_time or "",
                "Auction_start_time": court_start_time or "",
                "{auction_end_time}": court_end_time or "",
                "Auction_end_time": court_end_time or "",
            }
            ppt_builder.replace_placeholders_in_slide(slide40, mapping)
            ppt_builder.remove_won_unit_in_slide(slide40)
    except Exception as e:
        logger.warning(f"40번 슬라이드 실패: {e}")

    # 관할법원 캡처 삽입
    if court_capture_png and os.path.exists(court_capture_png):
        ppt_builder.insert_single_image(prs, "SLIDE_KEY=COURT_GUIDE", court_capture_png, use_note_key=True)

    # 문서 이미지 삽입
    cap_dir = str(CAPTURE_DIR)
    ppt_builder.insert_images_into_ppt(prs, total_building, "건축물대장", IMG_PATTERN, clone_from_next=True, forced_num="(5)")
    ppt_builder.insert_images_into_ppt(prs, total_sale, "매각물건명세서", SALE_IMG_PATTERN, clone_from_next=True)
    ppt_builder.insert_images_into_ppt(prs, total_registry, "등기사항 요약", REGISTRY_IMG_PATTERN, clone_from_next=True)
    ppt_builder.insert_images_into_ppt(prs, total_status, "현황조사서", STATUS_IMG_PATTERN, clone_from_next=True)

    # 임차인/등기부현황
    if tenant_imgs:
        ppt_builder.insert_images_into_ppt(
            prs, len(tenant_imgs), "임차인 현황",
            os.path.join(cap_dir, "tenant_status_{page}.png"),
            clone_from_next=True, base_as_last=True,
        )

    if building_registry_imgs:
        ppt_builder.insert_images_into_ppt(
            prs, len(building_registry_imgs), "등기부 현황",
            os.path.join(cap_dir, "building_registry_status_{page}.png"),
            clone_from_next=True, base_as_last=True,
        )

    # 단일 이미지 삽입
    ppt_builder.insert_single_image(prs, "전자지도", KAKAO_MAP_PNG)
    ppt_builder.insert_single_image(prs, "위성지도", KAKAO_SAT_PNG)
    ppt_builder.insert_single_image(prs, "토지이용계획", land_use_plan_img)

    # 물건현황 (1): 좌측 위치도, 우측 내부구조도/호별배치도
    location_img = loc_left_img or loc_right_img
    if location_img or building_overview_img:
        inserted = ppt_builder.insert_location_and_structure_images(prs, location_img, building_overview_img)
        if inserted:
            logger.info("물건현황 (1) 위치도/내부구조도 좌우 삽입 완료")
        else:
            logger.warning("물건현황 (1) 위치도/내부구조도 좌우 삽입 실패")

    logger.info("예상명도비용 산출근거 캡처 이미지 삽입 생략: 템플릿 변수 자동입력 방식 사용")

    emit(4, "PPT 이미지 삽입", "삽입 완료", percent=85)

    # 명도 정액제/실비제 비용: 엑셀 토큰 적용 후에도 파싱 면적 기반 산식이 최종값이 되도록 저장 직전 반영
    try:
        eviction_values = forced_execution_estimator.build_eviction_cost_values(data)
        updated = ppt_builder.apply_eviction_cost_estimates(prs, eviction_values)
        if updated:
            logger.info(f"명도 정액제/실비제 비용 반영 완료: {updated}개 텍스트")
        else:
            logger.warning("명도 정액제/실비제 비용 반영 대상 텍스트를 찾지 못했습니다.")
    except Exception as e:
        logger.warning(f"명도 정액제/실비제 비용 반영 실패: {e}")

    # ===== STEP 5: 저장 =====
    emit(5, "저장", "PPT 저장 중...", percent=90)
    output_file = _briefing_output_file(data, task_id)
    os.makedirs(os.path.dirname(output_file), exist_ok=True)
    ppt_builder.save_pptm_preserve_vba(settings.pptm_template, prs, output_file)

    cleanup_generated_files()

    emit(5, "저장", "완료!", status="completed", percent=100)
    logger.info(f"보고서 생성 완료: {output_file}")

    return {
        "success": True,
        "output_file": output_file,
        "message": "보고서 생성이 완료되었습니다.",
        "data": data,
    }
