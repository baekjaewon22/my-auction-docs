# -*- coding: utf-8 -*-
"""
백엔드 서버 진입점 (PyInstaller 용)
이 파일이 backend.exe의 메인이 됨
"""
import sys
import os

# PyInstaller 번들 경로 처리
if getattr(sys, 'frozen', False):
    # EXE로 실행 중
    BASE_DIR = os.path.dirname(sys.executable)
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# 작업 디렉토리를 BASE_DIR로 설정
os.chdir(BASE_DIR)

# app 패키지가 있는 경로를 sys.path에 추가
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

import uvicorn
from app.main import app  # noqa: E402

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8001
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
