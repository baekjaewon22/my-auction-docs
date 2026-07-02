# -*- coding: utf-8 -*-
"""
FastAPI 메인 앱
- EXE 모드: PyWebView + 내장 서버
- 웹 모드: uvicorn 직접 실행
"""

import os
import sys
import logging
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .core.config import settings, ensure_dirs, FRONTEND_DIST_DIR
from .core.logging import setup_logging
from .api.routes import router as api_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    ensure_dirs()
    logging.info(f"[BOOT] {settings.app_title} 시작")
    yield
    logging.info("[SHUTDOWN] 서버 종료")


app = FastAPI(
    title=settings.app_title,
    lifespan=lifespan,
)

# CORS (개발용)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API 라우트
app.include_router(api_router, prefix="/api")

# 프론트엔드 정적 파일 서빙 (빌드된 React)
if FRONTEND_DIST_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST_DIR), html=True), name="frontend")


def run_server():
    """uvicorn 서버 실행"""
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
    )


if __name__ == "__main__":
    run_server()
