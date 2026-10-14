# 마이옥션 주간 브리핑: CRM 회원 데이터 추가 명세 (Codex 전달용)

`briefing_dashboard_spec.md`에 이어지는 내용입니다. 보고서에는 `extra.dashboard.crm`이 새로 들어옵니다. DB를 바꿀 필요는 없습니다.

## 1. 화면
- 탭을 하나 추가합니다: **종합 | 구글 애널리틱스 | 유튜브 | 인스타 | 네이버센터 | 회원(CRM)**
- 종합 탭 맨 앞 카드는 `overview.scorecards[0]`(key=`crm_signups`, "실제 가입 (CRM)")입니다. GA4 가입 카드는 이름이 "가입 (GA4 기록)"으로 바뀝니다.
- `crm.status`가 `"missing"`이면 탭 안에 `crm.note`만 회색 안내로 보여 줍니다.

## 2. `extra.dashboard.crm` 스키마

값은 2026-10-13 회차의 실제 값입니다.
```jsonc
{
  "status": "ok",                        // ok | missing
  "totals": {
    "signups": 1655, "prev_signups": 1926,   // 실제 가입(회원 DB)
    "withdrawals": 23, "prev_withdrawals": 29,
    "net": 1632,                          // 가입 - 탈퇴
    "app_share": 0.606,                   // 앱(안드로이드+아이폰) 가입 비중
    "ga4_ratio": 1.0628                   // GA4 가입 기록 ÷ 실제 가입. 1에 가까울수록 측정이 정확
  },
  "daily":  [{ "date": "2026-10-06", "signups": 264, "withdrawals": 8, "ga4_signups": 280 }],
  "inflow": [{ "key": "구글app접속", "label": "안드로이드 앱", "value": 833, "prev": 916, "share": 0.5033 }],
  "age":    [{ "key": "30대", "label": "30대", "value": 473, "prev": 508, "share": 0.2858 }],
  "sex":    [{ "key": "남자", "label": "남자", "value": 970, "prev": 1168, "share": 0.5861 }],
  "region": [{ "key": "서울", "label": "서울", "value": 506, "prev": 581, "share": 0.3057 }],  // 많은 순
  "data_quality": ["지역 '전남' 가입이 2주 연속 0명 — CRM 지역 분류 확인 필요"],
  "explain": "회원 DB에 실제로 저장된 가입·탈퇴 수. GA4 가입 기록과 비교해 측정이 맞는지도 확인"
}
```

## 3. 회원(CRM) 탭 구성
1. 카드 4개
   - 실제 가입: `signups`와 `prev_signups`, 증감률 표시
   - 탈퇴: `withdrawals`
   - 순증: `net`
   - 앱 가입 비중: `app_share`
2. 일별 막대그래프
   - 가입 막대와 탈퇴 막대
   - `ga4_signups`를 점선으로 겹쳐 그립니다. "통계 기록과 실제 비교"라는 설명을 붙입니다.
3. 가입 경로 100% 막대: 안드로이드 앱 / 아이폰 앱 / 모바일웹 / PC. 각 항목 옆에 `prev`와 비교한 화살표를 표시합니다.
4. 연령대 막대: 이번 주와 직전 주를 나란히 표시합니다. 성별은 작은 도넛으로 보여 줍니다.
5. 지역 상위 10개 표
6. `data_quality`가 있으면 주황색 안내 박스로 보여 줍니다.
7. 측정 정확도 게이지: `ga4_ratio`
   - 0.95~1.05: 초록
   - 0.85~1.15: 주황
   - 그 밖: 빨강

## 4. 주간 추이 (my-docs.kr 브리핑 목록의 `kpis` 값)
※ CRM에서 제공하는 API가 아닙니다. CRM 숫자는 매주 Claude가 CRM 화면에서 크롤링해 보고서에 담아 보내며, my-docs.kr은 이미 받고 있는 보고서(`POST /api/briefings`)의 `kpis` 안에서 아래 값을 읽기만 하면 됩니다. CRM 쪽 개발은 필요 없습니다.

보고서 `kpis`에 새로 들어오는 키:
- `crm_signups`
- `crm_signups_prev`
- `crm_withdrawals`
- `crm_app_share`
- `ga4_crm_ratio`

종합 탭의 주간 추이 그래프에서 가입 선은 `crm_signups`를 우선 씁니다. 값이 없는 과거 회차는 `signups`로 대신합니다.
