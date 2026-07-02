# -*- coding: utf-8 -*-
"""
앱 설정 / 경로 관리
- EXE(PyInstaller) / 일반 Python 실행 모두 대응
- .env 파일 지원
"""

import os
import sys
import json
import platform
from pathlib import Path
from typing import Optional
from pydantic_settings import BaseSettings, SettingsConfigDict


# ============================================================
# 실행 환경 감지
# ============================================================
IS_FROZEN = getattr(sys, "frozen", False)
IS_WINDOWS = platform.system() == "Windows"


def get_app_root() -> Path:
    if IS_FROZEN:
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass:
            return Path(meipass).resolve()
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent.parent.parent  # backend/


APP_ROOT = get_app_root()


# ============================================================
# 디렉토리 경로
# ============================================================
TEMPLATES_DIR = APP_ROOT / "templates"
RIGHTS_CERTIFICATE_TEMPLATE_DIR = TEMPLATES_DIR / "rights_certificate"
RIGHTS_CERTIFICATE_TEMPLATE_PATH = RIGHTS_CERTIFICATE_TEMPLATE_DIR / "certificate.html"
RIGHTS_CERTIFICATE_PPTX_TEMPLATE_PATH = RIGHTS_CERTIFICATE_TEMPLATE_DIR / "certificate.pptx"
BIN_DIR = APP_ROOT / "bin"
OUTPUT_DIR = APP_ROOT / "output"
CAPTURE_DIR = APP_ROOT / "capture"
PDF_DOWNLOAD_DIR = APP_ROOT / "download_pdf"
LOGS_DIR = APP_ROOT / "logs"
# 프론트엔드 빌드 파일 (여러 경로 시도)
_frontend_candidates = [
    APP_ROOT.parent / "frontend" / "dist",     # 개발 모드
    APP_ROOT / "frontend_dist",                 # 빌드 번들 (backend 안에 복사)
]
FRONTEND_DIST_DIR = next((p for p in _frontend_candidates if p.exists()), _frontend_candidates[0])

# Poppler (PDF → 이미지)
POPPLER_BIN_DIR = BIN_DIR / "poppler" / "Library" / "bin"
POPPLER_FALLBACKS = [
    r"C:\poppler-25.12.0\Library\bin",
    r"C:\poppler\Library\bin",
    "/usr/bin",  # Linux
]

# Tesseract (OCR)
TESSERACT_FALLBACKS = [
    str(BIN_DIR / "tesseract" / "tesseract.exe"),
    r"C:\Program Files\Tesseract-OCR\tesseract.exe",
    "/usr/bin/tesseract",  # Linux
]


def find_poppler_path() -> str:
    if POPPLER_BIN_DIR.exists():
        return str(POPPLER_BIN_DIR)
    for p in POPPLER_FALLBACKS:
        if os.path.exists(p):
            return p
    return ""


def find_tesseract_path() -> str:
    for p in TESSERACT_FALLBACKS:
        if os.path.exists(p):
            return p
    return "tesseract"  # PATH에 있길 바라며


POPPLER_PATH = find_poppler_path()
TESSERACT_PATH = find_tesseract_path()

# Selenium 프로필
SELENIUM_PROFILE_DIR = str(APP_ROOT / "selenium_profile")


def ensure_dirs() -> None:
    for d in [OUTPUT_DIR, CAPTURE_DIR, PDF_DOWNLOAD_DIR, LOGS_DIR, RIGHTS_CERTIFICATE_TEMPLATE_DIR]:
        d.mkdir(parents=True, exist_ok=True)


# ============================================================
# 사용자 설정 (JSON)
# ============================================================
APP_NAME = "MyAuctionPPT"
CONFIG_FILENAME = "config.json"


def get_app_dir() -> str:
    if IS_WINDOWS:
        local = os.environ.get("LOCALAPPDATA")
        if local and os.path.isdir(local):
            base = os.path.join(local, APP_NAME)
        else:
            base = os.path.join(os.path.expanduser("~"), f".{APP_NAME.lower()}")
    else:
        base = os.path.join(os.path.expanduser("~"), f".{APP_NAME.lower()}")
    os.makedirs(base, exist_ok=True)
    return base


def get_config_path() -> str:
    return os.path.join(get_app_dir(), CONFIG_FILENAME)


def load_config() -> dict:
    path = get_config_path()
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f) or {}
    except Exception:
        return {}


def save_config(cfg: dict) -> None:
    path = get_config_path()
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


# ============================================================
# FastAPI Settings
# ============================================================
class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_prefix="AUCTION_REPORT_",
        extra="ignore",
    )

    app_title: str = "경매 보고서 자동화"
    debug: bool = False
    host: str = "127.0.0.1"
    port: int = 8000
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]

    # 템플릿
    pptm_template: str = str(TEMPLATES_DIR / "sample2_configured.pptx")
    output_file: str = str(OUTPUT_DIR / "브리핑자료_적용본.pptx")
    rights_certificate_template: str = str(RIGHTS_CERTIFICATE_TEMPLATE_PATH)
    rights_certificate_pptx_template: str = str(RIGHTS_CERTIFICATE_PPTX_TEMPLATE_PATH)
    rights_certificate_output_file: str = str(OUTPUT_DIR / "권리분석_보증서.pdf")


settings = Settings()
