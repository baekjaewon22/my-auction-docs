# -*- coding: utf-8 -*-
"""Pydantic 모델 (API 요청/응답 스키마)"""

from typing import Literal, Optional
from pydantic import BaseModel


OutputType = Literal["auction_report", "rights_certificate"]


class ReportRequest(BaseModel):
    """보고서 생성 요청"""
    output_type: OutputType = "auction_report"  # 결과물 종류
    url: str                          # 마이옥션 상세 URL
    myauction_id: str                 # 마이옥션 아이디
    myauction_pw: str                 # 마이옥션 비밀번호
    remember_login: bool = True       # 자동로그인 세션 유지
    author_name: str = ""             # 가입자 성명
    author_title: str = ""            # 가입자 직책
    author_phone: str = ""            # 가입자 전화번호
    requester_role: str = "user"
    requester_permission: str = "basic"


class RightsCertificateBatchRequest(BaseModel):
    """권리분석 보증서 다건 생성 요청"""
    output_type: Literal["rights_certificate"] = "rights_certificate"
    urls: list[str]
    myauction_id: str
    myauction_pw: str
    remember_login: bool = True
    author_name: str = ""
    author_title: str = ""
    author_phone: str = ""
    requester_role: str = "user"
    requester_permission: str = "basic"
    start_at: Optional[str] = None
    interval_seconds: int = 5


class PropertyData(BaseModel):
    """파싱된 부동산 데이터"""
    court: str = ""
    case_number: str = ""
    address: str = ""
    address_old: str = ""
    land_zoning: str = ""
    appraisal_raw: str = ""
    item_type: str = ""
    land_area_m2: str = ""
    land_area_py: str = ""
    building_area_m2: str = ""
    building_area_py: str = ""
    xx평형: str = ""
    building_structure: str = ""
    building_scale: str = ""
    auction_date: str = ""
    appraised_price: str = ""
    min_price: str = ""
    min_rate: str = ""
    deposit: str = ""
    claim_amount: str = ""
    photo_url: str = ""
    landplan_url: str = ""
    LAND_MODE: bool = False
    BUILDING_MODE: bool = True


class ProgressUpdate(BaseModel):
    """WebSocket 진행상황 메시지"""
    step: int                # 현재 단계 (0~)
    total_steps: int         # 전체 단계 수
    title: str               # 단계 제목
    message: str             # 상세 메시지
    status: str = "running"  # running | completed | error
    percent: float = 0.0     # 0.0 ~ 100.0


class ReportResult(BaseModel):
    """보고서 생성 결과"""
    success: bool
    output_file: Optional[str] = None
    message: str = ""
    data: Optional[PropertyData] = None
