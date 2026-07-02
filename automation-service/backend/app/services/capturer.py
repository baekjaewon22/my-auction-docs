# -*- coding: utf-8 -*-
"""
스크린샷/캡처 서비스
- 웹 페이지 fullpage 캡처
- 관할법원안내 팝업 캡처
- 카카오맵 전자지도/위성지도 캡처
- 토지이용계획 캡처
- 임차인/등기부현황 테이블 캡처
"""

import os
import re
import time
import base64
import logging
from io import BytesIO
from urllib.parse import urljoin

from PIL import Image, ImageChops
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException

from ..core.config import CAPTURE_DIR, ensure_dirs
from ..core.utils import track_file, ensure_dir_for_file
from .selenium_driver import safe_click, wait_document_ready, switch_to_new_window

logger = logging.getLogger(__name__)

ensure_dirs()


def _dismiss_alert_if_present(driver) -> str:
    try:
        alert = driver.switch_to.alert
        text = alert.text or ""
        alert.accept()
        return text
    except Exception:
        return ""


def _extract_myauction_idx(*values: str) -> str:
    for value in values:
        text = value or ""
        match = re.search(r"[?&]idx=(\d+)", text)
        if match:
            return match.group(1)
        match = re.search(r"/view3?/(\d+)", text)
        if match:
            return match.group(1)
    return ""


# ============================================================
# 공통 캡처 유틸
# ============================================================
def _capture_fullpage_png(driver) -> Image.Image:
    driver.execute_cdp_cmd("Page.enable", {})
    driver.execute_script("window.scrollTo(0, document.documentElement.scrollHeight);")
    time.sleep(0.25)
    driver.execute_script("window.scrollTo(0, 0);")
    time.sleep(0.25)
    shot = driver.execute_cdp_cmd("Page.captureScreenshot", {
        "format": "png",
        "fromSurface": True,
        "captureBeyondViewport": True,
    })
    return Image.open(BytesIO(base64.b64decode(shot["data"]))).convert("RGB")


def _get_doc_size_css(driver):
    return driver.execute_script("""
        const de = document.documentElement;
        const body = document.body;
        const w = Math.max(de.scrollWidth, body ? body.scrollWidth : 0, de.clientWidth);
        const h = Math.max(de.scrollHeight, body ? body.scrollHeight : 0, de.clientHeight);
        return {w, h};
    """)


def _get_abs_rect_css(driver, el):
    return driver.execute_script("""
        const el = arguments[0];
        const r = el.getBoundingClientRect();
        const sx = window.scrollX || document.documentElement.scrollLeft;
        const sy = window.scrollY || document.documentElement.scrollTop;
        return {left: r.left + sx, top: r.top + sy, width: r.width, height: r.height};
    """, el)


def _get_rows_cell_rect_css(driver, rows):
    return driver.execute_script("""
        const rows = arguments[0] || [];
        const sx = window.scrollX || document.documentElement.scrollLeft;
        const sy = window.scrollY || document.documentElement.scrollTop;
        const rects = [];

        rows.forEach(row => {
          row.querySelectorAll('th,td').forEach(cell => {
            const r = cell.getBoundingClientRect();
            if (r.width > 1 && r.height > 1) {
              rects.push(r);
            }
          });
        });

        if (!rects.length) {
          rows.forEach(row => {
            const r = row.getBoundingClientRect();
            if (r.width > 1 && r.height > 1) {
              rects.push(r);
            }
          });
        }

        if (!rects.length) {
          return null;
        }

        const left = Math.min(...rects.map(r => r.left)) + sx;
        const top = Math.min(...rects.map(r => r.top)) + sy;
        const right = Math.max(...rects.map(r => r.right)) + sx;
        const bottom = Math.max(...rects.map(r => r.bottom)) + sy;
        return {left, top, width: right - left, height: bottom - top};
    """, rows)


def _hide_overlays(driver):
    driver.execute_script("""
        ['#mcm_submit_wrap','#dtl_wing','#wing_wrap','#ch-plugin',
         'iframe[src*="channel.io"]'].forEach(sel => {
          document.querySelectorAll(sel).forEach(el => {
            el.dataset.__old_display = el.style.display;
            el.style.display = 'none';
          });
        });
    """)


def _restore_overlays(driver):
    driver.execute_script("""
        document.querySelectorAll('[data-__old_display]').forEach(el => {
          el.style.display = el.dataset.__old_display || '';
          delete el.dataset.__old_display;
        });
    """)


def trim_white_margin(src_path: str, dst_path: str) -> str:
    im = Image.open(src_path).convert("RGB")
    bg = Image.new("RGB", im.size, (255, 255, 255))
    diff = ImageChops.difference(im, bg)
    bbox = diff.getbbox()
    if bbox:
        im = im.crop(bbox)
    im.save(dst_path)
    return dst_path


def _dismiss_map_guides(driver) -> None:
    """지도 서비스의 첫 방문 가이드/설정 튜토리얼 레이어를 캡처 전에 제거한다."""
    try:
        driver.execute_script("""
            const guideWords = [
              '지도 설정',
              '장소 저장하기',
              '교통정보',
              '지형도',
              '날씨 등',
              '원하는 정보를 사용하세요',
              '즐겨찾는 장소를 저장하고'
            ];

            function hasGuideText(el) {
              const text = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
              if (!text) return false;
              return guideWords.some(word => text.includes(word));
            }

            const clickableWords = ['닫기', '확인', '건너뛰기', '시작하기'];
            Array.from(document.querySelectorAll('button,a,[role="button"]')).forEach(el => {
              const label = [
                el.innerText,
                el.textContent,
                el.getAttribute('aria-label'),
                el.getAttribute('title')
              ].filter(Boolean).join(' ');
              if (clickableWords.some(word => label.includes(word))) {
                try { el.click(); } catch (e) {}
              }
            });

            const candidates = Array.from(document.querySelectorAll('body *'))
              .filter(el => {
                if (!hasGuideText(el)) return false;
                const r = el.getBoundingClientRect();
                return r.width > 80 && r.height > 40;
              })
              .sort((a, b) => {
                const ar = a.getBoundingClientRect();
                const br = b.getBoundingClientRect();
                return (br.width * br.height) - (ar.width * ar.height);
              });

            candidates.slice(0, 8).forEach(el => {
              el.dataset.__map_guide_hidden = '1';
              el.style.setProperty('display', 'none', 'important');
              el.style.setProperty('visibility', 'hidden', 'important');
              el.style.setProperty('opacity', '0', 'important');
              el.style.setProperty('pointer-events', 'none', 'important');
            });
        """)
    except Exception:
        pass
    try:
        from selenium.webdriver.common.keys import Keys
        driver.switch_to.active_element.send_keys(Keys.ESCAPE)
    except Exception:
        pass


# ============================================================
# 관할법원안내 팝업
# ============================================================
def open_court_guide_popup(driver, timeout=15):
    wait = WebDriverWait(driver, timeout)
    base_handle = driver.current_window_handle
    base_handles = set(driver.window_handles)

    btn = wait.until(EC.element_to_be_clickable((
        By.XPATH,
        "//a[contains(normalize-space(.),'관할법원안내') or contains(@onclick,'court_layer')]"
    )))
    safe_click(driver, btn)

    end = time.time() + timeout
    popup_handle = None
    while time.time() < end:
        diff = list(set(driver.window_handles) - base_handles)
        if diff:
            popup_handle = diff[0]
            break
        time.sleep(0.2)

    if not popup_handle:
        raise RuntimeError("관할법원안내 팝업 핸들을 찾지 못했습니다.")

    driver.switch_to.window(popup_handle)
    WebDriverWait(driver, 10).until(
        lambda d: "입찰" in d.page_source or "시간" in d.page_source
    )
    time.sleep(0.8)
    wait_document_ready(driver, timeout=25)

    # 시간 추출
    cst = wait.until(EC.presence_of_element_located((By.ID, "cstdate")))
    value_text = (cst.text or "").strip()

    start_time, end_time = "", ""
    m1 = re.search(r"입찰시작시간\s*([0-2]?\d:[0-5]\d)", value_text)
    m2 = re.search(r"입찰마감시간\s*([0-2]?\d:[0-5]\d)", value_text)
    if m1:
        start_time = m1.group(1)
    if m2:
        end_time = m2.group(1)

    return start_time, end_time, popup_handle


def capture_court_popup(driver, out_path: str, timeout=15):
    ensure_dir_for_file(out_path)
    wait = WebDriverWait(driver, timeout)
    wait_document_ready(driver, timeout=25)

    right_el = wait.until(EC.presence_of_element_located((By.ID, "clw_right")))
    map_el = wait.until(EC.presence_of_element_located((By.ID, "map")))
    cst_el = wait.until(EC.presence_of_element_located((By.ID, "cstdate")))

    try:
        bottom_row = cst_el.find_element(By.XPATH, "./ancestor::tr[1]")
    except Exception:
        bottom_row = cst_el

    driver.execute_script("arguments[0].scrollIntoView({block:'center'});", bottom_row)
    time.sleep(0.2)

    full_img = _capture_fullpage_png(driver)
    doc = _get_doc_size_css(driver)
    dpr = float(driver.execute_script("return window.devicePixelRatio || 1;"))

    img_w, img_h = full_img.size
    exp_w, exp_h = doc["w"] * dpr, doc["h"] * dpr
    sx = img_w / exp_w if exp_w else 1.0
    sy = img_h / exp_h if exp_h else 1.0

    right_r = _get_abs_rect_css(driver, right_el)
    map_r = _get_abs_rect_css(driver, map_el)
    bot_r = _get_abs_rect_css(driver, bottom_row)

    left_px = max(0, int(round(right_r["left"] * dpr * sx)))
    right_px = min(img_w, int(round((right_r["left"] + right_r["width"]) * dpr * sx)))
    top_px = max(0, int(round(map_r["top"] * dpr * sy)))
    bottom_px = min(img_h, int(round((bot_r["top"] + bot_r["height"]) * dpr * sy)))

    cropped = full_img.crop((left_px, top_px, right_px, bottom_px))
    cropped.save(out_path, "PNG")
    track_file(out_path)
    return out_path


# ============================================================
# 카카오맵 캡처
# ============================================================
def capture_kakaomap(driver, out_path: str):
    ensure_dir_for_file(out_path)
    wait_document_ready(driver, timeout=30)

    # 카카오맵 좌측 패널 닫기 시도
    try:
        driver.execute_script("""
            var panel = document.querySelector('#dimmedLayer, .dimmedLayer, #searchLayout');
            if (panel) panel.style.display = 'none';
            var aside = document.querySelector('aside, .sidebar, #sidebar');
            if (aside) aside.style.display = 'none';
        """)
    except Exception:
        pass
    _dismiss_map_guides(driver)
    time.sleep(2)
    _dismiss_map_guides(driver)

    driver.execute_cdp_cmd("Page.enable", {})
    shot = driver.execute_cdp_cmd("Page.captureScreenshot", {
        "format": "png", "fromSurface": True, "captureBeyondViewport": False,
    })
    full_img = Image.open(BytesIO(base64.b64decode(shot["data"]))).convert("RGB")
    w, h = full_img.size

    logger.info(f"카카오맵 캡처 원본 크기: {w}x{h}")

    # 좌측 패널 영역 제거 (비율 기반) - 주소 팝업 포함
    left_cut = min(680, max(400, int(w * 0.36)))
    # 상하단 여백 제거
    top_cut = max(0, int(h * 0.03))
    bottom_cut = max(0, int(h * 0.03))
    cropped = full_img.crop((left_cut, top_cut, w, h - bottom_cut))
    cropped.save(out_path, "PNG")
    track_file(out_path)
    logger.info(f"카카오맵 캡처 완료: {out_path} ({cropped.size[0]}x{cropped.size[1]})")
    return out_path


def open_kakao_and_capture(driver, popup_handle, link_text: str, out_path: str):
    before_tabs = list(driver.window_handles)

    xpath = (
        f"//a[contains(@href,'map.kakao.com') and "
        f"contains(normalize-space(.), '{link_text}')]"
    )
    end = time.time() + 15
    while time.time() < end:
        try:
            driver.switch_to.default_content()
            el = driver.find_element(By.XPATH, xpath)
            safe_click(driver, el)
            break
        except Exception:
            time.sleep(0.3)

    new_handle = switch_to_new_window(driver, before_tabs, timeout=20)
    # headless에서는 maximize가 안 먹히므로 항상 크기 강제 설정
    try:
        driver.set_window_size(1920, 1080)
    except Exception:
        pass
    time.sleep(2)

    try:
        capture_kakaomap(driver, out_path)
        return out_path
    finally:
        driver.close()
        driver.switch_to.window(popup_handle)


# ============================================================
# 토지이용계획 캡처
# ============================================================
def capture_land_use_plan(driver, out_path: str, timeout=20):
    ensure_dir_for_file(out_path)
    wait = WebDriverWait(driver, timeout)
    base_handle = driver.current_window_handle
    base_url = driver.current_url
    before_handles = set(driver.window_handles)

    btn = wait.until(EC.element_to_be_clickable((
        By.XPATH, "//a[contains(normalize-space(.),'토지이용계획')]"
    )))
    safe_click(driver, btn)

    new_handle = None
    opened_in_current_tab = False
    end = time.time() + timeout
    while time.time() < end:
        diff = set(driver.window_handles) - before_handles
        if diff:
            new_handle = diff.pop()
            break
        if driver.current_url != base_url and "my-auction.co.kr" not in driver.current_url:
            opened_in_current_tab = True
            break
        time.sleep(0.2)

    if not new_handle and not opened_in_current_tab:
        raise RuntimeError("토지이용계획 탭 또는 현재 탭 이동을 찾지 못했습니다.")

    try:
        if new_handle:
            driver.switch_to.window(new_handle)
        wait_document_ready(driver, timeout=30)
        time.sleep(1)

        driver.execute_script("""
            document.querySelectorAll('.ui-dialog, .ui-widget-overlay, .layer_pop')
                .forEach(el => el.remove());
        """)
        time.sleep(0.3)

        land_wait = WebDriverWait(driver, timeout)
        top_el = land_wait.until(EC.presence_of_element_located((
            By.XPATH, "//th[normalize-space()='소재지']/ancestor::div[contains(@class,'tbl01')][1]"
        )))
        bottom_el = land_wait.until(EC.presence_of_element_located((
            By.XPATH,
            "//caption[contains(normalize-space(.),'토지이용계획 - 확인도면')]"
            "/ancestor::div[contains(@class,'tbl01')][1]"
        )))

        driver.execute_script("arguments[0].scrollIntoView({block:'end'});", bottom_el)
        time.sleep(0.8)

        full_img = _capture_fullpage_png(driver)
        doc = _get_doc_size_css(driver)
        dpr = float(driver.execute_script("return window.devicePixelRatio || 1;"))

        img_w, img_h = full_img.size
        sx = img_w / (doc["w"] * dpr) if doc["w"] else 1.0
        sy = img_h / (doc["h"] * dpr) if doc["h"] else 1.0

        top_r = _get_abs_rect_css(driver, top_el)
        bot_r = _get_abs_rect_css(driver, bottom_el)

        pad = 10
        left_px = max(0, int((top_r["left"] - pad) * dpr * sx))
        right_px = min(img_w, int((top_r["left"] + top_r["width"] + pad) * dpr * sx))
        top_px = max(0, int((top_r["top"] - pad) * dpr * sy))
        bottom_px = min(img_h, int((bot_r["top"] + bot_r["height"] + pad) * dpr * sy))

        cropped = full_img.crop((left_px, top_px, right_px, bottom_px))
        cropped.save(out_path, "PNG")
        track_file(out_path)
        return out_path
    finally:
        try:
            if new_handle and new_handle in driver.window_handles:
                driver.close()
                driver.switch_to.window(base_handle)
            elif opened_in_current_tab:
                driver.switch_to.window(base_handle)
                driver.get(base_url)
                wait_document_ready(driver, timeout=30)
                time.sleep(0.5)
        except Exception as e:
            logger.warning(f"토지이용계획 캡처 후 상세 페이지 복귀 실패: {e}")


def _get_eviction_cost_basis_rect(driver):
    return driver.execute_script("""
        const visible = (el) => {
          if (!el) return false;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
          const r = el.getBoundingClientRect();
          return r.width > 20 && r.height > 20;
        };
        const textOf = (el) => `${el.innerText || el.textContent || el.value || ''}`.trim();
        const sx = window.scrollX || document.documentElement.scrollLeft;
        const sy = window.scrollY || document.documentElement.scrollTop;

        const closeEls = Array.from(document.querySelectorAll('a,button,input')).filter(el => {
          const text = textOf(el).replace(/\s+/g, '');
          return visible(el) && (text === '닫기' || text.includes('닫기') || /close/i.test(text));
        });

        const allText = textOf(document.body);
        if (location.pathname.includes('/auction/execution_pop.php') || allText.includes('총 명도비용') || allText.includes('노무비')) {
          const contentNodes = Array.from(document.body.querySelectorAll('table, p, div, section, article, ul, ol')).filter(el => {
            if (!visible(el)) return false;
            const text = textOf(el);
            if (!text) return false;
            const compact = text.replace(/\s+/g, '');
            if (compact === '닫기' || compact === 'close') return false;
            if (closeEls.some(close => el === close || close.contains(el))) return false;
            return (
              text.includes('총 명도비용') ||
              text.includes('접수비') ||
              text.includes('운반 및 보관료') ||
              text.includes('노무비') ||
              text.includes('열쇠 개문') ||
              text.includes('사다리차') ||
              text.includes('입회자 동행') ||
              text.includes('명도접수건수') ||
              text.includes('본 비용은') ||
              text.includes('면적을 기준')
            );
          });

          if (contentNodes.length) {
            let left = Infinity;
            let top = Infinity;
            let right = 0;
            let bottom = 0;
            for (const el of contentNodes) {
              const r = el.getBoundingClientRect();
              left = Math.min(left, r.left + sx);
              top = Math.min(top, r.top + sy);
              right = Math.max(right, r.right + sx);
              bottom = Math.max(bottom, r.bottom + sy);
            }
            for (const close of closeEls) {
              const r = close.getBoundingClientRect();
              if (r.top + sy > top) bottom = Math.min(bottom, r.top + sy - 8);
            }
            if (Number.isFinite(left) && Number.isFinite(top) && right > left && bottom > top) {
              return {
                left,
                top,
                width: Math.max(1, right - left),
                height: Math.max(1, bottom - top),
              };
            }
          }
        }

        const costWords = ['예상명도비용', '산출근거', '강제집행', '집행비용', '노무비', '제비용'];
        const candidates = Array.from(document.querySelectorAll('div,section,article,table,tbody')).filter(el => {
          if (!visible(el)) return false;
          const text = textOf(el);
          return costWords.some(word => text.includes(word));
        }).map(el => {
          const r = el.getBoundingClientRect();
          const area = r.width * r.height;
          const hasClose = closeEls.some(close => el.contains(close));
          return {el, r, area, hasClose, text: textOf(el)};
        }).filter(item => item.area > 10000);

        candidates.sort((a, b) => {
          if (a.hasClose !== b.hasClose) return a.hasClose ? -1 : 1;
          return a.area - b.area;
        });

        const picked = candidates[0];
        if (!picked) {
          const trigger = Array.from(document.querySelectorAll('#dtt_more, #dtt_more > a, a')).find(el => {
            const text = textOf(el);
            return el.matches('#dtt_more') || text.includes('산출근거');
          });
          if (!trigger || !visible(trigger)) return null;
          let el = trigger;
          for (let i = 0; i < 6 && el; i += 1) {
            const r = el.getBoundingClientRect();
            const text = textOf(el);
            if (r.width > 300 && r.height > 80 && (text.includes('산출근거') || text.includes('예상명도비용'))) {
              const close = closeEls
                .filter(closeEl => el.contains(closeEl))
                .map(closeEl => closeEl.getBoundingClientRect())
                .sort((a, b) => a.top - b.top)[0];
              let bottom = r.bottom + sy;
              if (close) bottom = Math.min(bottom, close.top + sy - 8);
              return {
                left: r.left + sx,
                top: r.top + sy,
                width: Math.max(1, r.width),
                height: Math.max(1, bottom - (r.top + sy)),
              };
            }
            el = el.parentElement;
          }
          return null;
        }

        let left = picked.r.left + sx;
        let top = picked.r.top + sy;
        let right = picked.r.right + sx;
        let bottom = picked.r.bottom + sy;

        const innerClose = closeEls
          .filter(close => picked.el.contains(close))
          .map(close => close.getBoundingClientRect())
          .sort((a, b) => a.top - b.top)[0];
        if (innerClose) {
          bottom = Math.min(bottom, innerClose.top + sy - 8);
        }

        return {
          left,
          top,
          width: Math.max(1, right - left),
          height: Math.max(1, bottom - top),
        };
    """)


def _close_eviction_cost_basis_layer(driver):
    try:
        driver.execute_script("""
            const visible = (el) => {
              const style = window.getComputedStyle(el);
              const r = el.getBoundingClientRect();
              return style.display !== 'none' && style.visibility !== 'hidden' && r.width > 1 && r.height > 1;
            };
            const close = Array.from(document.querySelectorAll('a,button,input')).find(el => {
              const text = `${el.innerText || el.textContent || el.value || ''}`.replace(/\\s+/g, '');
              return visible(el) && (text === '닫기' || text.includes('닫기') || /close/i.test(text));
            });
            if (close) close.click();
        """)
        time.sleep(0.2)
    except Exception:
        pass


def capture_eviction_cost_basis(driver, out_path: str, timeout=15, detail_url: str = ""):
    ensure_dir_for_file(out_path)
    wait = WebDriverWait(driver, timeout)
    base_url = driver.current_url
    case_idx = _extract_myauction_idx(detail_url, base_url)

    if case_idx:
        popup_path = f"/auction/execution_pop.php?idx={case_idx}"
        popup_url = f"https://www.my-auction.co.kr{popup_path}"
        logger.info(f"예상명도비용 산출근거 URL 직접 이동: {popup_url}")
        driver.get(popup_url)
        alert_text = _dismiss_alert_if_present(driver)
        if alert_text:
            raise RuntimeError(f"예상명도비용 산출근거 열람 실패: {alert_text}")
        wait_document_ready(driver, timeout=20)
        time.sleep(0.5)
        try:
            wait.until(lambda d: (_get_eviction_cost_basis_rect(d) or {}).get("height", 0) > 40)
            time.sleep(0.3)
            full_img = _capture_fullpage_png(driver)
            rect = _get_eviction_cost_basis_rect(driver)
            if not rect:
                raise RuntimeError("예상명도비용 산출근거 영역을 찾지 못했습니다.")

            doc = _get_doc_size_css(driver)
            dpr = float(driver.execute_script("return window.devicePixelRatio || 1;"))
            img_w, img_h = full_img.size
            sx = img_w / (doc["w"] * dpr) if doc["w"] else 1.0
            sy = img_h / (doc["h"] * dpr) if doc["h"] else 1.0

            pad = 8
            left_px = max(0, int((rect["left"] - pad) * dpr * sx))
            right_px = min(img_w, int((rect["left"] + rect["width"] + pad) * dpr * sx))
            top_px = max(0, int((rect["top"] - pad) * dpr * sy))
            bottom_px = min(img_h, int((rect["top"] + rect["height"] + pad) * dpr * sy))
            if right_px <= left_px or bottom_px <= top_px:
                raise RuntimeError("예상명도비용 산출근거 캡처 영역이 올바르지 않습니다.")

            cropped = full_img.crop((left_px, top_px, right_px, bottom_px))
            cropped.save(out_path, "PNG")
            track_file(out_path)
            logger.info(f"예상명도비용 산출근거 캡처 완료: {out_path} ({cropped.size[0]}x{cropped.size[1]})")
            return out_path
        finally:
            try:
                _dismiss_alert_if_present(driver)
                driver.get(base_url)
                wait_document_ready(driver, timeout=20)
                time.sleep(0.3)
            except Exception as e:
                logger.warning(f"예상명도비용 산출근거 캡처 후 상세 페이지 복귀 실패: {e}")
    if not case_idx:
        raise RuntimeError("예상명도비용 산출근거 사건번호를 URL에서 찾지 못했습니다.")

    logger.info(
        "예상명도비용 산출근거 버튼 상태: "
        + str(driver.execute_script("""
            return Array.from(document.querySelectorAll('#dtt_more > a, a')).filter(a => {
              const text = `${a.innerText || a.textContent || ''}`.trim();
              return a.matches('#dtt_more > a') || text.includes('산출근거');
            }).slice(0, 5).map(a => ({
              text: `${a.innerText || a.textContent || ''}`.trim(),
              href: a.getAttribute('href') || '',
              onclick: a.getAttribute('onclick') || '',
              id: a.id || '',
              visible: !!(a.offsetWidth || a.offsetHeight || a.getClientRects().length)
            }));
        """))
    )
    btn = driver.execute_script("""
        const anchors = Array.from(document.querySelectorAll('#dtt_more > a, a')).filter(a => {
          const text = `${a.innerText || a.textContent || ''}`.trim();
          const visible = !!(a.offsetWidth || a.offsetHeight || a.getClientRects().length);
          return visible && (a.matches('#dtt_more > a') || text.includes('산출근거'));
        });
        return anchors.reverse().find(a => `${a.innerText || a.textContent || ''}`.includes('산출근거')) || anchors[0] || null;
    """)
    if not btn:
        raise RuntimeError("예상명도비용 산출근거 버튼을 찾지 못했습니다.")
    popup_path = driver.execute_script("""
        const onclick = arguments[0].getAttribute('onclick') || '';
        const match = onclick.match(/windowOpen\\(['"]([^'"]+)['"]/);
        return match ? match[1] : '';
    """, btn)
    if popup_path:
        if popup_path.startswith("../"):
            popup_path = "/" + popup_path[3:]
        popup_url = urljoin(base_url, popup_path)
        logger.info(f"예상명도비용 산출근거 URL 직접 이동: {popup_url}")
        driver.get(popup_url)
        wait_document_ready(driver, timeout=20)
    else:
        driver.execute_script("""
            arguments[0].scrollIntoView({block:'center', inline:'center'});
            arguments[0].click();
            arguments[0].dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true, view:window}));
        """, btn)
    time.sleep(0.5)

    try:
        wait.until(lambda d: (_get_eviction_cost_basis_rect(d) or {}).get("height", 0) > 40)
        time.sleep(0.3)
        full_img = _capture_fullpage_png(driver)
        rect = _get_eviction_cost_basis_rect(driver)
        if not rect:
            raise RuntimeError("예상명도비용 산출근거 영역을 찾지 못했습니다.")

        doc = _get_doc_size_css(driver)
        dpr = float(driver.execute_script("return window.devicePixelRatio || 1;"))
        img_w, img_h = full_img.size
        sx = img_w / (doc["w"] * dpr) if doc["w"] else 1.0
        sy = img_h / (doc["h"] * dpr) if doc["h"] else 1.0

        pad = 8
        left_px = max(0, int((rect["left"] - pad) * dpr * sx))
        right_px = min(img_w, int((rect["left"] + rect["width"] + pad) * dpr * sx))
        top_px = max(0, int((rect["top"] - pad) * dpr * sy))
        bottom_px = min(img_h, int((rect["top"] + rect["height"] + pad) * dpr * sy))
        if right_px <= left_px or bottom_px <= top_px:
            raise RuntimeError("예상명도비용 산출근거 캡처 영역이 올바르지 않습니다.")

        cropped = full_img.crop((left_px, top_px, right_px, bottom_px))
        cropped.save(out_path, "PNG")
        track_file(out_path)
        logger.info(f"예상명도비용 산출근거 캡처 완료: {out_path} ({cropped.size[0]}x{cropped.size[1]})")
        return out_path
    finally:
        if popup_path:
            try:
                driver.get(base_url)
                wait_document_ready(driver, timeout=20)
                time.sleep(0.3)
            except Exception as e:
                logger.warning(f"예상명도비용 산출근거 캡처 후 상세 페이지 복귀 실패: {e}")
        else:
            _close_eviction_cost_basis_layer(driver)


# ============================================================
# 임차인/등기부현황 테이블 분할 캡처
# ============================================================
def _find_table_under_h3(driver, h3_text: str, timeout=20):
    wait = WebDriverWait(driver, timeout)
    h3 = wait.until(
        EC.presence_of_element_located((By.XPATH, f"//h3[normalize-space()='{h3_text}']"))
    )
    try:
        table = h3.find_element(
            By.XPATH,
            "./ancestor::*[contains(@class,'dtl_title') or contains(@class,'dtl_tit')][1]"
            "/following-sibling::*[.//table][1]//table[contains(@class,'tbl_detail')]"
        )
    except Exception:
        table = h3.find_element(
            By.XPATH,
            "following::table[contains(@class,'tbl_detail')][1]"
        )
    driver.execute_script("arguments[0].scrollIntoView({block:'start'});", h3)
    time.sleep(0.2)
    return table


def capture_table_split_by_rows(driver, h3_text: str, out_prefix: str, rows_per_page=8, timeout=20):
    ensure_dir_for_file(out_prefix)
    table = _find_table_under_h3(driver, h3_text, timeout=timeout)
    rows = table.find_elements(By.XPATH, ".//tr")
    if not rows:
        raise RuntimeError(f"{h3_text}: 테이블 행이 없습니다.")

    results = []
    for i in range(0, len(rows), rows_per_page):
        chunk = rows[i:i + rows_per_page]
        _hide_overlays(driver)
        try:
            full_img = _capture_fullpage_png(driver)
            cell_r = _get_rows_cell_rect_css(driver, chunk)
            top_r = cell_r or _get_abs_rect_css(driver, chunk[0])
            bot_r = cell_r or _get_abs_rect_css(driver, chunk[-1])
            doc = _get_doc_size_css(driver)
            dpr = float(driver.execute_script("return window.devicePixelRatio || 1;"))

            img_w, img_h = full_img.size
            sx = img_w / (doc["w"] * dpr)
            sy = img_h / (doc["h"] * dpr)

            left_px = int(max(0, top_r["left"] * dpr * sx))
            right_px = int(min(img_w, (top_r["left"] + top_r["width"]) * dpr * sx))
            top_px = int(max(0, top_r["top"] * dpr * sy))
            bottom_px = int(min(img_h, (bot_r["top"] + bot_r["height"]) * dpr * sy))
            if right_px <= left_px or bottom_px <= top_px:
                left_px, right_px = 0, img_w
                top_px = int(max(0, _get_abs_rect_css(driver, chunk[0])["top"] * dpr * sy))
                bottom_fallback = _get_abs_rect_css(driver, chunk[-1])
                bottom_px = int(min(img_h, (bottom_fallback["top"] + bottom_fallback["height"]) * dpr * sy))
            cropped = full_img.crop((left_px, top_px, right_px, bottom_px))

            out_path = f"{out_prefix}_{len(results) + 1}.png"
            cropped.save(out_path, "PNG")
            track_file(out_path)
            results.append(out_path)
        finally:
            _restore_overlays(driver)

    return results


def capture_tenant_and_registry(driver):
    wait_document_ready(driver, timeout=30)
    time.sleep(1.0)

    tenant_imgs, building_imgs, land_imgs = [], [], []
    cap_dir = str(CAPTURE_DIR)

    try:
        tenant_imgs = capture_table_split_by_rows(
            driver, "임차인현황",
            os.path.join(cap_dir, "tenant_status"), rows_per_page=8
        )
        logger.info(f"임차인현황 캡처 완료 ({len(tenant_imgs)}장)")
    except Exception as e:
        logger.warning(f"임차인현황 캡처 실패: {e}")

    try:
        building_imgs = capture_table_split_by_rows(
            driver, "건물 등기부현황",
            os.path.join(cap_dir, "building_registry_status"), rows_per_page=8
        )
        logger.info(f"건물 등기부현황 캡처 완료 ({len(building_imgs)}장)")
    except TimeoutException:
        logger.info("건물 등기부현황 없음 → 스킵")
    except Exception as e:
        logger.warning(f"건물 등기부현황 캡처 실패: {e}")

    try:
        land_imgs = capture_table_split_by_rows(
            driver, "토지 등기부현황",
            os.path.join(cap_dir, "land_registry_status"), rows_per_page=8, timeout=5
        )
        logger.info(f"토지 등기부현황 캡처 완료 ({len(land_imgs)}장)")
    except TimeoutException:
        logger.info("토지 등기부현황 없음 → 스킵")
    except Exception as e:
        logger.warning(f"토지 등기부현황 캡처 실패: {e}")

    return tenant_imgs, building_imgs, land_imgs


# ============================================================
# 건물개황도 (내부구조도 / 호별배치도) 캡처
# ============================================================
def capture_building_overview(driver, out_path: str, timeout=15):
    """
    마이옥션 상세 페이지 사이드바에서 건물개황도 이미지 캡처.
    - 셀렉터: #dtlw_link > ul > li:nth-child(5) > a
    - 링크 텍스트: "내부구조도" 또는 "호별배치도" 또는 "건물개황도"
    - 클릭 → 새 탭 → 이미지 캡처 → 탭 닫기
    """
    ensure_dir_for_file(out_path)
    base_handle = driver.current_window_handle
    before_handles = set(driver.window_handles)

    # 1) 사이드바 링크 찾기 (텍스트 우선, 없으면 기존 메뉴 순서로 fallback)
    link = None
    keywords = ["내부구조도", "호별배치도", "건물개황도"]
    for kw in keywords:
        try:
            link = driver.find_element(
                By.XPATH,
                f"//div[@id='dtlw_link']//a[contains(normalize-space(.), '{kw}')]"
            )
            if link:
                break
        except Exception:
            continue

    if not link:
        try:
            link = driver.find_element(By.CSS_SELECTOR, "#dtlw_link > ul > li:nth-child(5) > a")
        except Exception:
            pass

    if not link:
        raise RuntimeError("건물개황도/내부구조도/호별배치도 링크를 찾지 못했습니다.")

    link_text = (link.text or "").strip()
    logger.info(f"건물개황도 링크 발견: '{link_text}'")

    # 2) 클릭 → 새 탭 열기
    safe_click(driver, link)

    # 3) 새 탭 대기
    new_handle = None
    end = time.time() + timeout
    while time.time() < end:
        diff = list(set(driver.window_handles) - before_handles)
        if diff:
            new_handle = diff[0]
            break
        time.sleep(0.3)

    if not new_handle:
        raise RuntimeError("건물개황도 새 탭이 열리지 않았습니다.")

    driver.switch_to.window(new_handle)
    wait_document_ready(driver, timeout=20)
    time.sleep(1.5)

    try:
        # 4) 이미지 캡처 (전체 페이지)
        driver.execute_cdp_cmd("Page.enable", {})
        shot = driver.execute_cdp_cmd("Page.captureScreenshot", {
            "format": "png",
            "fromSurface": True,
            "captureBeyondViewport": True,
        })
        full_img = Image.open(BytesIO(base64.b64decode(shot["data"]))).convert("RGB")

        # 5) 이미지에서 실제 내용 영역만 크롭 (흰 여백 제거)
        #    페이지에 이미지만 있는 경우가 많으므로 non-white bbox로 트림
        bg = Image.new("RGB", full_img.size, (255, 255, 255))
        diff = ImageChops.difference(full_img, bg)
        bbox = diff.getbbox()
        if bbox:
            # 약간의 패딩 추가
            pad = 10
            x0 = max(0, bbox[0] - pad)
            y0 = max(0, bbox[1] - pad)
            x1 = min(full_img.width, bbox[2] + pad)
            y1 = min(full_img.height, bbox[3] + pad)
            full_img = full_img.crop((x0, y0, x1, y1))

        full_img.save(out_path, "PNG")
        track_file(out_path)
        logger.info(f"건물개황도 캡처 완료: {out_path}")
        return out_path

    finally:
        # 6) 새 탭 닫고 원래 탭으로 복귀
        try:
            driver.close()
        except Exception:
            pass
        driver.switch_to.window(base_handle)
