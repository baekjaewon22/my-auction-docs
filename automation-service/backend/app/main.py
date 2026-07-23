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
from .api.routes import public_router, router as api_router


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
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-MyAuction-Agent-Token"],
    expose_headers=["Content-Disposition", "Content-Length"],
)


@app.middleware("http")
async def allow_private_network_preflight(request, call_next):
    """Allow the public HTTPS site to reach this loopback-only agent.

    Chrome may send a Private Network Access preflight before a request from
    my-docs.kr to 127.0.0.1. CORSMiddleware handles the regular CORS headers,
    but Starlette does not add this PNA-specific response header.
    """
    response = await call_next(request)
    origin = request.headers.get("origin", "")
    if (
        origin in settings.cors_origins
        and request.headers.get("access-control-request-private-network", "").lower() == "true"
    ):
        response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response

# 공개 상태/세션 라우트와 인증 필수 기능 라우트를 분리한다.
app.include_router(public_router, prefix="/api")
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
