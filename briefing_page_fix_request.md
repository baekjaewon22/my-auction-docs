# my-docs.kr 주간 브리핑 화면 수정 요청 (2026-10-13 점검 결과)

점검 대상: https://my-docs.kr/briefings (2026-10-13 회차)
기준 데이터: `GET /api/briefings/by-date/myauction/2026-10-13` 응답의 `briefing`

## A. 숫자가 틀리게 보이는 문제 (우선 수정)

1. **"직전 대비" 비교 기준이 잘못됨**
   - 지금: 바로 앞 회차(2026-10-12, 기간 10/05~10/11)와 비교 → 기간이 6일 겹쳐서 "전체 가입 -1.1%, 비슷한 수준"으로 표시
   - 실제: 같은 보고서 안의 비교 기간(10/06~12 vs 09/29~10/05) 기준 **-13.2%** (1,759 vs 2,027)
   - 수정: 증감률은 **보고서 자신의 직전 값**으로 계산
     - `extra.dashboard.overview.scorecards[].prev` 가 있으면 그것을 사용
     - 없으면 `kpis.signups_prev` 처럼 `*_prev` 키, 또는 `highlights[].previous` 사용
     - 앞 회차와의 비교는 **두 회차의 period가 겹치지 않을 때만** 사용
   - 같은 원인으로 틀린 곳: 구글 자연검색 가입 -5.3%(실제 55→18, -67%), 유튜브 유입 +28.6% "좋아졌습니다"(가입 0인데 긍정 문구)

2. **GA4 탭 카드 값 불일치**
   | 카드 | 화면 | 실제 데이터 |
   |---|---|---|
   | 신규 사용자 가입 | 1,431 | 1,462 (`audience[type=new].conversions`) |
   | PC 가입 전환율 | 3.1% | 1.03% (`devices[desktop].cvr` 또는 671 ÷ 64,972) |
   | 모바일 가입 전환율 | 2.4% | 2.21% (`devices[mobile]`) |
   계산식을 데이터의 `cvr`(소수) 그대로 쓰도록 수정. 화면에서 다시 계산하지 말 것.

3. **네이버 탭 "네이버 검색 가입률 2.9%" 설명 오류**
   - 지금 설명: "네이버 검색광고 방문자 중 가입한 비율"
   - 실제: `kpis.naver_search_cvr` = 네이버 **모바일 검색 전체**(자연검색 + 광고 클릭 혼합) 유입의 가입률
   - 광고 성과는 `kpis.naver_ad_signups`, `kpis.naver_ad_cpa`, `extra.dashboard.naver.ga4_match` 를 사용

## B. 텍스트를 쪼개서 만든 화면 → 구조화 데이터로 교체

현재 유튜브 쇼츠·네이버 키워드 목록을 `content_md` 문장에서 잘라 쓰고 있어 중복·깨짐이 생김
- 유튜브 쇼츠 4번이 1번과 중복, 3번 끝에 "- )" 깨짐
- 모든 카드에 같은 일반 문구 반복("첫 장면과 제목의 반전 요소를 유지하며…")

다음 회차부터 POST 본문에 `dashboard` 객체가 포함되고, 서버는 이를 `extra.dashboard` 로 저장한다(명세: `briefing_dashboard_spec.md`).
- **`extra.dashboard` 가 있으면 각 탭은 그것만 사용**, 없을 때만 지금 방식(과거 회차 호환)
- 유튜브: `dashboard.youtube.top_videos[]`(type=shorts/long, views, avg_view_pct, url, why), `traffic_sources[]`
- 인스타: `dashboard.instagram.posts[]`(permalink 있음 → 카드 클릭 시 게시물 열기, why), `daily[]` 도달 그래프
- GA4: `dashboard.ga4.utm[]`(UTM 표), `daily[]`(14일 일별 가입·채널 막대), `tracking_health[]`(측정 점검표), `channels[].label`(쉬운 이름)
- 네이버: `dashboard.naver.keyword_audit`(등록·운영·일시중지·노출 0·품질지수 낮음·효율 좋음·점검 필요·돈만 쓰는 키워드), `ga4_match.coverage`(측정 도달률 게이지), `daily[]`
- 종합: `overview.findings[]`, `cross_channel[]`, `actions[]`, `plain_summary[]`, `glossary[]`
- 카드 아래 설명 문구는 각 항목의 `explain` / `why` / `what_to_do` 를 우선 표시. 일반 문구는 값이 없을 때만

## C. 문구 다듬기
- 인스타 카드의 "원인과 광고 설정을 확인할 필요가 있습니다" → 인스타는 광고 집행 중이 아니므로 "게시 소재와 업로드 시간을 확인하세요" 등 채널에 맞게
- 상태 문구는 `good_direction` 을 반영(광고비·가입 1건 비용은 내려가면 좋음)
- 채널 이름은 `(direct) / (none)` 대신 `label`("직접 방문") 사용

## D. 데이터 정리
- 2026-10-12 회차(`myauction-weekly-2026-10-12`)는 형식이 다른 시험 회차이고 기간이 10/13 회차와 겹침 → 목록에서 숨기거나 삭제 권장
