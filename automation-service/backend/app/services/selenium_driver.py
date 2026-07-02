# -*- coding: utf-8 -*-
"""
Selenium WebDriver 관리
- Chrome 드라이버 생성/종료
- 마이옥션 로그인
- 공통 헬퍼 (탭 전환, 팝업 처리 등)
"""

import os
import re
import time
import logging
import tempfile
import shutil
from datetime import datetime
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.chrome.service import Service as ChromeService
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import (
    ElementClickInterceptedException,
    ElementNotInteractableException,
    StaleElementReferenceException,
    TimeoutException,
    SessionNotCreatedException,
    WebDriverException,
)

from ..core.config import APP_ROOT, IS_WINDOWS

logger = logging.getLogger(__name__)

WINDOW_WIDTH = 1500
WINDOW_HEIGHT = 900
SELENIUM_PROFILE_DIR = str(APP_ROOT / "selenium_profile")


def _chrome_binary_candidates() -> list[str]:
    candidates = [
        os.environ.get("CHROME_BINARY", ""),
        os.environ.get("GOOGLE_CHROME_BIN", ""),
    ]
    if IS_WINDOWS:
        candidates.extend([
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
            os.path.join(os.environ.get("LOCALAPPDATA", ""), r"Google\Chrome\Application\chrome.exe"),
        ])
    else:
        candidates.extend(["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"])
    return [c for c in candidates if c]


def _find_chrome_binary() -> str:
    for candidate in _chrome_binary_candidates():
        if os.path.isabs(candidate) and os.path.exists(candidate):
            return candidate
        resolved = shutil.which(candidate)
        if resolved:
            return resolved
    return ""


def _extract_chrome_major(binary_path: str) -> str:
    if not binary_path:
        return ""
    try:
        if IS_WINDOWS:
            import subprocess
            output = subprocess.check_output(
                [
                    "powershell",
                    "-NoProfile",
                    "-Command",
                    f"(Get-Item -LiteralPath '{binary_path}').VersionInfo.ProductVersion",
                ],
                text=True,
                stderr=subprocess.DEVNULL,
                timeout=5,
            ).strip()
        else:
            import subprocess
            output = subprocess.check_output([binary_path, "--version"], text=True, stderr=subprocess.DEVNULL, timeout=5)
        match = re.search(r"(\d+)\.", output)
        return match.group(1) if match else ""
    except Exception:
        return ""


def _chromedriver_candidates(chrome_binary: str = "") -> list[str]:
    candidates = [
        os.environ.get("CHROMEDRIVER", ""),
        os.environ.get("CHROME_DRIVER", ""),
        str(APP_ROOT / "bin" / "chromedriver.exe"),
        str(APP_ROOT / "bin" / "chromedriver"),
    ]
    major = _extract_chrome_major(chrome_binary)
    cache_root = Path(os.environ.get("USERPROFILE", "")) / ".cache" / "selenium" / "chromedriver"
    if major and cache_root.exists():
        candidates.extend(str(path) for path in cache_root.glob(f"**/{major}*/chromedriver.exe"))
        candidates.extend(str(path) for path in cache_root.glob(f"**/{major}*/chromedriver"))
    path_driver = shutil.which("chromedriver")
    if path_driver:
        candidates.append(path_driver)
    return [c for c in candidates if c]


def _find_chromedriver(chrome_binary: str = "") -> str:
    for candidate in _chromedriver_candidates(chrome_binary):
        if os.path.exists(candidate):
            return candidate
    return ""


def _build_chrome_options(profile_dir: str = "", headless: bool = False):
    options = webdriver.ChromeOptions()
    chrome_binary = _find_chrome_binary()
    if chrome_binary:
        options.binary_location = chrome_binary
        logger.info(f"Chrome binary: {chrome_binary}")
    options.add_argument(f"--window-size={WINDOW_WIDTH},{WINDOW_HEIGHT}")
    options.add_argument("--lang=ko-KR")
    options.add_argument("--disable-notifications")
    options.add_argument("--disable-popup-blocking")
    options.add_argument("--disable-extensions")
    options.add_argument("--no-proxy-server")
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_argument("--disable-features=RendererCodeIntegrity")
    options.add_experimental_option("excludeSwitches", ["enable-logging", "enable-automation"])
    options.add_experimental_option("useAutomationExtension", False)
    options.page_load_strategy = "eager"

    if headless:
        options.add_argument("--headless=new")
        options.add_argument("--no-sandbox")
        options.add_argument("--disable-dev-shm-usage")
        options.add_argument("--disable-gpu")

    if profile_dir:
        abs_profile = os.path.abspath(profile_dir)
        os.makedirs(abs_profile, exist_ok=True)
        options.add_argument(f"--user-data-dir={abs_profile}")

    return options


def _short_webdriver_error(exc: Exception) -> str:
    text = str(exc or "").strip()
    text = re.sub(r"\s+", " ", text)
    return text[:500]


def account_profile_dir(user_id: str) -> str:
    safe_id = re.sub(r"[^0-9A-Za-z._-]+", "_", str(user_id or "").strip()) or "default"
    return os.path.join(SELENIUM_PROFILE_DIR, safe_id)


def _chrome_start_error(exc: Exception) -> str:
    message = _short_webdriver_error(exc)
    lowered = message.lower()
    if "user data directory is already in use" in lowered or "already in use" in lowered:
        return "Chrome 브라우저 실행 실패: 저장 로그인 프로필이 이미 사용 중입니다. 잠시 후 다시 시도하거나 실행 중인 자동화 Chrome을 종료해 주세요."
    if "only supports chrome version" in lowered or ("session not created" in lowered and "chrome version" in lowered):
        return f"Chrome 브라우저 실행 실패: 크롬 버전과 ChromeDriver 환경이 맞지 않습니다. ({message})"
    if "unable to obtain driver for chrome" in lowered:
        return "Chrome 브라우저 실행 실패: ChromeDriver를 찾지 못했습니다. Chrome 설치 경로와 chromedriver.exe/Selenium Manager 캐시를 확인해 주세요."
    return f"Chrome 브라우저 실행 실패: {message or '원인을 확인하지 못했습니다.'}"


def _is_navigation_network_error(exc: Exception) -> bool:
    text = str(exc or "").lower()
    return any(token in text for token in (
        "err_network_access_denied",
        "err_internet_disconnected",
        "err_connection_closed",
        "err_connection_reset",
        "err_tunnel_connection_failed",
        "err_proxy_connection_failed",
    ))


def navigate_with_retry(driver: webdriver.Chrome, url: str, *, retries: int = 2, fallback_urls: list[str] | None = None) -> None:
    urls = [url, *(fallback_urls or [])]
    last_error: Exception | None = None
    for attempt in range(max(1, retries)):
        for target_url in urls:
            try:
                if attempt > 0:
                    try:
                        driver.execute_cdp_cmd("Network.enable", {})
                        driver.execute_cdp_cmd("Network.clearBrowserCache", {})
                        driver.execute_cdp_cmd("Network.setCacheDisabled", {"cacheDisabled": True})
                    except Exception:
                        pass
                    time.sleep(0.8)
                driver.get(target_url)
                return
            except WebDriverException as e:
                last_error = e
                if not _is_navigation_network_error(e):
                    raise
                logger.warning(f"Chrome 네트워크 접근 실패, 재시도 예정: {target_url} ({attempt + 1}/{retries})")
    if last_error:
        raise last_error
    driver.get(url)


def _chrome_service() -> ChromeService:
    chrome_binary = _find_chrome_binary()
    driver_path = _find_chromedriver(chrome_binary)
    if driver_path:
        logger.info(f"ChromeDriver: {driver_path}")
        return ChromeService(executable_path=driver_path)
    return ChromeService()


def _create_driver_legacy(profile_dir: str = "", headless: bool = False) -> webdriver.Chrome:
    try:
        options = _build_chrome_options(profile_dir=profile_dir, headless=headless)
        driver = webdriver.Chrome(service=_chrome_service(), options=options)
    except SessionNotCreatedException as e:
        raise RuntimeError(
            "Chrome 브라우저 실행 실패: 크롬 버전과 Selenium 환경이 맞지 않습니다."
        ) from e
    except WebDriverException as e:
        if profile_dir:
            logger.warning("저장 프로필 실패 → 임시 프로필로 재시도")
            temp_profile = os.path.join(
                tempfile.gettempdir(),
                f"myauction_chrome_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
            )
            try:
                options = _build_chrome_options(profile_dir=temp_profile, headless=headless)
                driver = webdriver.Chrome(service=_chrome_service(), options=options)
            except Exception as e2:
                raise RuntimeError("Chrome 실행 실패. 크롬 설치 및 기존 창 종료를 확인하세요.") from e2
        else:
            raise RuntimeError("Chrome 실행 실패. 크롬 설치를 확인하세요.") from e

    driver.set_page_load_timeout(60)
    driver.set_script_timeout(60)
    driver.implicitly_wait(1)
    return driver


def create_driver(profile_dir: str = "", headless: bool = False) -> webdriver.Chrome:
    first_error = None
    attempts = [profile_dir or ""]

    if profile_dir:
        temp_profile = os.path.join(
            tempfile.gettempdir(),
            f"myauction_chrome_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        )
        attempts.append(temp_profile)
    logger.info(f"Chrome driver 생성 시도: headless={headless}, profile_attempts={attempts}")

    for idx, candidate_profile in enumerate(attempts):
        try:
            if idx > 0:
                logger.warning(
                    f"저장 Chrome 프로필 실행 실패, 임시 프로필로 재시도: {_short_webdriver_error(first_error)}"
                )
            options = _build_chrome_options(profile_dir=candidate_profile, headless=headless)
            driver = webdriver.Chrome(service=_chrome_service(), options=options)
            driver.set_page_load_timeout(60)
            driver.set_script_timeout(60)
            driver.implicitly_wait(1)
            logger.info(
                f"Chrome driver 생성 성공: profile_dir={candidate_profile or '(비저장/기본)'}, "
                f"fallback_used={idx > 0}"
            )
            return driver
        except (SessionNotCreatedException, WebDriverException) as e:
            if first_error is None:
                first_error = e
            if idx == len(attempts) - 1:
                raise RuntimeError(_chrome_start_error(e)) from e

    raise RuntimeError(_chrome_start_error(first_error))


def _dismiss_alert(driver) -> str:
    """alert가 있으면 텍스트를 반환하고 닫음. 없으면 빈 문자열."""
    try:
        from selenium.webdriver.common.alert import Alert
        alert = Alert(driver)
        text = alert.text or ""
        alert.accept()
        return text
    except Exception:
        return ""


def _log_selector_presence(driver: webdriver.Chrome, label: str, by: str, selector: str) -> int:
    try:
        elements = driver.find_elements(by, selector)
        visible = 0
        enabled = 0
        samples: list[str] = []
        for el in elements[:5]:
            try:
                if el.is_displayed():
                    visible += 1
                if el.is_enabled():
                    enabled += 1
                text = (el.text or el.get_attribute("title") or el.get_attribute("alt") or el.get_attribute("href") or el.get_attribute("onclick") or "").strip()
                if text:
                    samples.append(re.sub(r"\s+", " ", text)[:120])
            except Exception:
                pass
        logger.info(
            f"[상세DOM] {label}: count={len(elements)}, visible={visible}, enabled={enabled}, selector={selector}, sample={samples[:2]}"
        )
        return len(elements)
    except Exception as e:
        logger.warning(f"[상세DOM] {label}: selector 확인 실패 selector={selector}, error={_short_webdriver_error(e)}")
        return 0


def log_detail_page_diagnostics(driver: webdriver.Chrome, prefix: str = "마이옥션 상세") -> None:
    try:
        logger.info(f"[{prefix}] current_url={driver.current_url}, title={driver.title}")
    except Exception:
        pass
    _log_selector_presence(driver, "#header_detailz", By.CSS_SELECTOR, "#header_detailz")
    _log_selector_presence(driver, "#dtl_table", By.CSS_SELECTOR, "#dtl_table")
    _log_selector_presence(driver, "#dtlw_link", By.CSS_SELECTOR, "#dtlw_link")
    _log_selector_presence(driver, "#dtlw_link > ul > li:nth-child(5) > a", By.CSS_SELECTOR, "#dtlw_link > ul > li:nth-child(5) > a")
    _log_selector_presence(driver, "예상배당표 영역", By.XPATH, "//*[contains(normalize-space(.), '예상배당표')]")
    _log_selector_presence(driver, "매각물건명세서 링크", By.XPATH, "//a[contains(normalize-space(.), '매각물건명세서') or contains(normalize-space(.), '물건명세서') or contains(@href, 'Mulgun') or contains(@onclick, 'Mulgun')]")
    _log_selector_presence(driver, "현황조사서 링크", By.XPATH, "//a[contains(normalize-space(.), '현황조사서') or contains(@href, 'Status') or contains(@onclick, 'Status') or contains(@href, 'Hyun') or contains(@onclick, 'Hyun')]")
    _log_selector_presence(driver, "등기부 링크", By.XPATH, "//a[contains(normalize-space(.), '등기부') or contains(@href, 'Registry') or contains(@onclick, 'Registry') or contains(@href, 'Deng') or contains(@onclick, 'Deng')]")
    _log_selector_presence(driver, "공시자료/부동산표시 링크", By.XPATH, "//a[contains(normalize-space(.), '공시자료') or contains(normalize-space(.), '부동산표시') or contains(@href, 'popup') or contains(@onclick, 'popup')]")


def _dismiss_click_interceptors(driver) -> None:
    alert_text = _dismiss_alert(driver)
    if alert_text:
        logger.info(f"safe_click 전 alert 닫음: {alert_text[:200]}")
    try:
        closed = driver.execute_script("""
            const selectors = [
              '.ui-dialog-titlebar-close',
              '.btn_close',
              '.popup_close',
              '.layer_close',
              '.close',
              '[aria-label="Close"]',
              '[aria-label="닫기"]',
              '[title="닫기"]',
              'button[onclick*="close"]',
              'a[onclick*="close"]'
            ];
            for (const selector of selectors) {
              for (const el of document.querySelectorAll(selector)) {
                const style = window.getComputedStyle(el);
                const rect = el.getBoundingClientRect();
                if (
                  style.display !== 'none' &&
                  style.visibility !== 'hidden' &&
                  rect.width > 0 &&
                  rect.height > 0
                ) {
                  el.click();
                  return true;
                }
              }
            }
            const event = new KeyboardEvent('keydown', {
              key: 'Escape',
              code: 'Escape',
              keyCode: 27,
              which: 27,
              bubbles: true
            });
            document.dispatchEvent(event);
            window.dispatchEvent(event);
            return false;
        """)
        if closed:
            logger.info("safe_click 전 popup/layer close 처리")
    except Exception:
        pass


def safe_click(driver, element, *, settle: float = 0.2) -> bool:
    last_err = None
    for attempt in range(3):
        try:
            driver.execute_script(
                "arguments[0].scrollIntoView({block:'center', inline:'center'});",
                element,
            )
            logger.info(f"safe_click scrollIntoView 완료 ({attempt + 1}/3)")
            time.sleep(settle)
        except Exception as e:
            last_err = e

        try:
            element.click()
            alert_text = _dismiss_alert(driver)
            if alert_text:
                logger.info(f"safe_click 후 alert 닫음: {alert_text[:200]}")
            return True
        except (ElementClickInterceptedException, ElementNotInteractableException, StaleElementReferenceException) as e:
            last_err = e
            logger.warning(f"Selenium click retry ({attempt + 1}/3): {_short_webdriver_error(e)}")
            _dismiss_click_interceptors(driver)
            time.sleep(0.25)
        except Exception as e:
            last_err = e
            break

    try:
        logger.info("safe_click JS click fallback 시도")
        driver.execute_script("arguments[0].click();", element)
        alert_text = _dismiss_alert(driver)
        if alert_text:
            logger.info(f"safe_click JS click 후 alert 닫음: {alert_text[:200]}")
        return True
    except Exception as e:
        last_err = e

    if last_err:
        raise last_err
    return False


def login_myauction(driver: webdriver.Chrome, user_id: str, user_pw: str):
    logger.info("마이옥션 로그인 페이지 진입 시작: https://www.my-auction.co.kr/member/login.php")
    navigate_with_retry(
        driver,
        "https://www.my-auction.co.kr/member/login.php",
        retries=3,
        fallback_urls=[
            "http://www.my-auction.co.kr/member/login.php",
            "https://my-auction.co.kr/member/login.php",
        ],
    )
    logger.info("마이옥션 로그인 페이지 접속")
    time.sleep(1)

    # 페이지 로드 중 alert 있으면 먼저 닫기
    initial_alert = _dismiss_alert(driver)
    logger.info(f"로그인 페이지 초기 alert 여부: {'있음 - ' + initial_alert[:200] if initial_alert else '없음'}")

    wait = WebDriverWait(driver, 15)

    # 이미 로그인 상태면 스킵
    try:
        page_source = driver.page_source or ""
        has_logout = "logout" in page_source.lower() or "로그아웃" in page_source
        logger.info(f"로그인 페이지 page_source 로그아웃 문구 여부: {has_logout}, current_url={driver.current_url}")
        if has_logout:
            logger.info("이미 로그인 상태 → 스킵")
            return
    except Exception:
        pass

    # 로그인 시도 (최대 2회)
    for attempt in range(1, 3):
        try:
            # alert가 남아있으면 닫기
            alert_before_input = _dismiss_alert(driver)
            if alert_before_input:
                logger.info(f"로그인 입력 전 alert 닫음: {alert_before_input[:200]}")

            id_box = wait.until(EC.presence_of_element_located((By.ID, "id")))
            pw_box = driver.find_element(By.ID, "passwd")
            logger.info(f"로그인 입력 요소 확인: id_exists=True, passwd_exists=True, user_id={user_id}")

            # 기존 값 완전 제거 후 입력
            id_box.clear()
            time.sleep(0.2)
            driver.execute_script("arguments[0].value = '';", id_box)
            id_box.send_keys(user_id)

            pw_box.clear()
            time.sleep(0.2)
            driver.execute_script("arguments[0].value = '';", pw_box)
            pw_box.send_keys(user_pw)
            time.sleep(0.3)
            logger.info("로그인 id/passwd 입력 완료")

            # Enter 대신 로그인 버튼 클릭 시도
            try:
                login_btn = driver.find_element(By.CSS_SELECTOR, "input[type='submit'], button[type='submit'], .btn_login, #login_btn")
                safe_click(driver, login_btn)
            except Exception:
                # 버튼 못 찾으면 Enter
                pw_box.send_keys(Keys.RETURN)

            logger.info(f"로그인 시도 ({attempt}회)")
            time.sleep(2)

            # alert 확인 (로그인 실패 시 "회원정보가 일치하지 않습니다" 등)
            alert_text = _dismiss_alert(driver)
            logger.info(f"로그인 후 alert 여부: {'있음 - ' + alert_text[:200] if alert_text else '없음'}")
            if alert_text:
                logger.warning(f"로그인 alert: {alert_text}")
                if attempt < 2:
                    logger.info("재시도합니다...")
                    navigate_with_retry(
                        driver,
                        "https://www.my-auction.co.kr/member/login.php",
                        retries=2,
                        fallback_urls=["http://www.my-auction.co.kr/member/login.php"],
                    )
                    time.sleep(1)
                    _dismiss_alert(driver)
                    continue
                else:
                    raise RuntimeError(f"로그인 실패: {alert_text}")

            # 로그인 성공 확인
            try:
                page_src = driver.page_source or ""
                has_logout = "logout" in page_src.lower() or "로그아웃" in page_src
                on_login_url = "member/login.php" in (driver.current_url or "")
                logger.info(f"로그인 후 상태: current_url={driver.current_url}, on_login_url={on_login_url}, logout_text={has_logout}, html_length={len(page_src)}")
                if has_logout and not on_login_url:
                    logger.info("로그인 성공 확인")
                    return
            except Exception:
                pass

            # 명시적 확인 못해도 alert 없으면 성공으로 간주
            logger.info("로그인 완료 (가정)")
            return

        except RuntimeError:
            raise
        except Exception as e:
            logger.warning(f"로그인 시도 {attempt} 실패: {e}")
            _dismiss_alert(driver)
            if attempt >= 2:
                raise RuntimeError(f"로그인 실패: {e}")


def click_tab_safe(wait: WebDriverWait, driver: webdriver.Chrome, candidates: list):
    last_err = None
    for text in candidates:
        try:
            el = wait.until(EC.element_to_be_clickable((By.PARTIAL_LINK_TEXT, text)))
            safe_click(driver, el)
            return text
        except Exception as e:
            last_err = e
    raise last_err if last_err else RuntimeError("탭 클릭 실패")


def switch_to_new_window(driver, before_handles, timeout=15):
    end = time.time() + timeout
    before = set(before_handles)
    while time.time() < end:
        after = set(driver.window_handles)
        new_handles = list(after - before)
        if new_handles:
            driver.switch_to.window(new_handles[0])
            return new_handles[0]
        time.sleep(0.2)
    raise RuntimeError("새 탭(창) 핸들을 찾지 못했습니다.")


def wait_document_ready(driver, timeout=25):
    WebDriverWait(driver, timeout).until(
        lambda d: d.execute_script("return document.readyState") == "complete"
    )
