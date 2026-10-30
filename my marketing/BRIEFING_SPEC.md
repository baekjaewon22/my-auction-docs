# BRIEFING_SPEC — 마이옥션 브리핑 분석·스키마 명세

이 문서는 Cowork 예약 작업 지시문(2026-10-19 개편판)과 실제 게시본(2026-10-19, 2026-10-23)을 코드 명세로 옮긴 것이다.
`scripts/analyze.py`는 이 문서대로 동작해야 한다. 숫자 기준·문구 규칙을 바꾸면 이 문서도 같이 고친다.

---
## 1. 실행일·기간
- run_date = KST 오늘(또는 `--run-date`).
- run_date.day가 1~7 → **monthly**: 기간 = 직전 달 1일~말일, 비교 = 그 이전 달 전체.
- 그 외 → **weekly**: 기간 = 직전 월~일, 비교 = 그 이전 월~일.
- 예: 2026-10-23(금) → 기간 10/12~10/18, 비교 10/05~10/11.
- `data/latest.json`의 run_date·type·period가 계산값과 다르면 분석하지 않고 실패 처리(analyze.yml에서 collect 재실행 1회 후 재시도).
- "확정일" = 기간 내 날짜 중 run_date-1, run_date-2가 아닌 날.

## 2. 입력
### 2-1. data/<run_date>.json (collect.py, schema 1)
공통: run_date, type, period{start,end}, compare_period{start,end}, collected_at(UTC ISO), notes[], errors[{source,step,message}], elapsed_sec
여러 기간 행에는 `dateRange: "cur" | "prev"`. daily_channel은 dateRange 없음(분석 시작일~실행 전날).

**ga4**
| 키 | 열 |
|---|---|
| channel_group | sessionDefaultChannelGroup, sessions, newUsers, signups |
| source_medium | sessionSourceMedium, sessions, signups, signup_rate (세션 상위 400) |
| daily_channel | date(YYYYMMDD), sessionDefaultChannelGroup, sessions, signups |
| events | eventName(회원가입완료/sign_up), eventCount, signups |
| key_events | eventName, signups (회원가입완료 외 값 > 0이면 혼입 경고) |
| campaigns | sessionCampaignName, sessionSourceMedium, sessions, signups |
| devices | deviceCategory, sessions, engagedSessions, engagementRate, newUsers, signups, signup_rate |
| host_landing | hostName, deviceCategory, landingPage(/, /member/login.php, /member/join.php, /main/main.php), sessions, signups |
| landing_top | landingPage, sessions, engagementRate, signups, signup_rate |
| audience | newVsReturning, sessions, engagementRate, averageSessionDuration, signups |
| source_device | sessionSourceMedium, deviceCategory, sessions, signups |

**youtube**: channel_id, authorized_channel_id(다르면 warn),
content_type[creatorContentType(videoOnDemand=롱폼, shorts=숏폼, creatorContentTypeUnspecified), views, engagedViews, averageViewPercentage(%), likes, shares, subscribersGained] (cur만),
totals{cur,prev}[views, estimatedRevenue(USD), monetizedPlaybacks], traffic_sources{cur,prev}[insightTrafficSourceType, views],
videos[video, title, length_sec, format, published_at, views, averageViewPercentage, likes, shares, subscribersGained, estimatedRevenue] (기간 조회 상위 50),
uploads[video_id, title, published_at, length_sec, format, views(누적), likes, comments] (최근 50),
video_daily{video_id: [{day, views}]} (최근 3주 공개분; **공개일 = 조회가 처음 0보다 커진 날**),
recent_uploads[video_id, title, format, views, published_at, hours_since, views_per_hour], snapshot{taken_at, videos[video_id, views]}

**instagram**: account{username, followers_count, media_count, website},
posts[media_id, date, timestamp_kst, product_type, caption, views, reach, saved, shares, total_interactions, profile_visits, follows],
daily_reach[date,value], daily_follower_count[date,value](신규 팔로우), totals_cur/totals_prev{reach, profile_views, accounts_engaged, website_clicks}

**naver**: fields, campaigns[id,name,type,status,daily_budget,user_lock], adgroups, keyword_count,
campaign_stats_cur/prev[id, impCnt, clkCnt, salesAmt, ctr(%), cpc, avgRnk, ccnt, crto(%), cpConv, ...],
adgroup_stats_cur/prev, keyword_stats_cur/prev[... keyword, campaign, adgroup, bid] (비용 상위 1000),
campaign_device_cur/prev(가능할 때만), keyword_tool{hints, keywords}, bizmoney{bizmoney, budgetLock, refundLock}

### 2-2. crm/<run_date>.json (crm_pull.py)
```json
{"source":"crm.my-auction.co.kr graph.php/graph2.php","pulled_at":"ISO",
 "period":{"start":"","end":"","sex":[남,여,미집계],"age":[10대..80대,미집계],"region":[18개],"path":[구글app,애플app,모바일web,PC],
           "daily":{"labels":["YYYY-MM-DD"],"signups":[],"withdrawals":[]}},
 "compare":{...same...},
 "this_week_to_date":{"start":"","end":"","daily":{...}}}
```
- 지역 순서: 서울,부산,대구,인천,광주,대전,울산,세종,경기,강원,충북,충남,전북,전남,경북,경남,제주,미집계
- 연령 순서: 10s,20s,30s,40s,50s,60s,70s,80s,unknown
- **가입 합계 = daily.signups 합**(graph2), 성별 합과 다를 수 있음 — 가입 합은 항상 graph2 기준.

### 2-3. 지난 보고서
`reports/` 중 run_date보다 이전인 가장 최근 `myauction-*.json`. corrections·스냅샷 증분·체크 상태 변화에 사용.

### 2-4. 원천 실패 시 대체(fallback)
- 원천이 비었거나 errors에 있으면: 같은 기간을 덮는 **이전 data/*.json 중 그 원천이 성공한 가장 최근 파일**에서 가져온다.
  가져왔으면 notes에 "인스타 수치는 data/2026-10-19.json(10/19 수집) 값" 식으로 명시하고 warn 1건.
- 대체 불가면 해당 kpis는 null, 표·섹션에 "미수집(사유)".

## 3. 장기 기준선(상수, `briefing/baselines.py`)
| 이름 | 값 |
|---|---|
| 일평균 가입 평시 | 209 |
| 인스타 바이럴기(8/19~9/15) | 385 |
| 바이럴 이후 | 296 |
| 가입 중 직접 비중 | 0.83 |
| 인스타 일 도달 정상 범위 | 7,000~14,000 |
| 터진 릴스 / 평시 릴스 조회 | 150,000~690,000 / 2,000~8,000 |
| 2026-10-05~11 주간 | 가입 1,778, desktop 650(0.0106), mobile 1,094(0.0235), google/organic 가입 20(PC 6), CRM 1,674 |

## 4. KPI 정의 (kpis 객체, 키 고정)
| 키 | 정의 |
|---|---|
| signups | Σ channel_group[cur].signups |
| signups_per_day | signups / 기간 일수 (소수 1자리) |
| signups_prev | Σ channel_group[prev].signups |
| direct_share | Direct 가입 / signups (4자리) |
| naver_search_cvr | source_medium "m.search.naver.com / referral" cur signup_rate |
| google_organic_signups | "google / organic" cur signups |
| youtube_sessions | "youtube / video" cur sessions (youtube.com/referral은 notes에 별도) |
| ig_followers | instagram.account.followers_count |
| ig_reach_avg | mean(daily_reach[기간 내].value) |
| reels_views_avg | mean(기간 내 게시 릴스 views) |
| desktop_cvr / mobile_cvr | devices[cur] signup_rate |
| app_webview_signups | host_landing appstore.my-auction.co.kr, landingPage "/" cur signups |
| new_user_signups | audience new cur signups |
| pc_main_landing_sessions | host_landing www.my-auction.co.kr /main/main.php cur sessions (행 없으면 0) |
| yt_longform_views / yt_shorts_views | content_type videoOnDemand / shorts views |
| yt_revenue_usd | totals.cur[0].estimatedRevenue |
| yt_shorts_day1_avg | 기간 내 공개 숏폼의 첫날 조회 평균(소수 1자리) |
| yt_views_total, yt_views_total_prev | totals cur/prev views |
| naver_ad_cost_krw, naver_ad_clicks, naver_ad_conversions, naver_ad_cpa_krw | 캠페인 합계 salesAmt, clkCnt, ccnt, round(cost/conv) |
| naver_bizmoney_krw | round(bizmoney.bizmoney) |
| crm_signups, crm_signups_prev, crm_withdrawals, crm_pc_signups, crm_app_signups | CRM (app = 구글+애플) |

## 5. 분석 규칙 → warnings / highlights / checks
### 5-1. 경고 규칙 (rules.py, 각 규칙은 함수 1개 + 테스트 1개)
| ID | 조건 | level | 문구 요소 |
|---|---|---|---|
| R01 측정-혼입 | key_events에 회원가입완료 외 signups>0 | warn | 이벤트명·수 |
| R02 Unassigned 확정일 | 확정일 중 Unassigned 세션 ≥ 500인 날 | warn | 날짜·세션·가입 |
| R03 Unassigned 미확정 | run_date-1/-2(분석기간 밖 포함, daily_channel 범위)에서 ≥500 | info | "미확정, 다음 수집에서 재확인" |
| R04 소스 급변 | 가입 max(cur,prev) ≥ 10이고 변화율 ≥ ±40% | warn(세션≥300)/info(표본 부족) | source_device로 기기 분해 |
| R05 기기 전환 하락 | 기기별 가입 변화율 ≤ -10% 그리고 세션 변화 ±5% 이내 | warn | 세션·전환율·관련 랜딩/소스 상위 2 |
| R06 가입 총량 | 일평균 가입이 기준선 비교(평시/이후) | highlight note | |
| R07 인스타 도달 | ig_reach_avg < 7,000 | warn | 전주 대비, 릴스 평균, 웹클릭, 신규팔로우 |
| R08 릴스 공백 | 평일(월~금) 업로드 공백 ≥ 2일 | warn | 날짜 |
| R09 릴스 부스팅 후보 | 조회 ≥ 50,000 | highlight/todo | |
| R10 유튜브 채널 불일치 | authorized_channel_id ≠ channel_id | warn | |
| R11 유튜브 광고-유입 | ADVERTISING 조회 비중 ≥ 30% 그리고 youtube 유입 가입 0 | warn | 비중·세션 |
| R12 네이버 광고-GA4 괴리 | 네이버 광고 전환 ≥ 100인데 m.ad.search.naver.com 가입 < 전환의 5% | warn | UTM 미부착 추정 |
| R13 비즈머니 | bizmoney / (기간 광고비/일수) < 5일 | warn | 잔액·일수 |
| R14 GA4-CRM 차이 | abs(GA4/CRM-1) > 0.10 → warn, 이하 info | | 기기 추세 교차(desktop↔PC, mobile↔앱+모바일웹) |
| R15 원천 실패 | errors 존재 | warn(인스타·유튜브·GA4 전체 실패) / info(부분) | 인증 신호면 "토큰 재발급 필요" |
| R16 인증 만료 신호 | message에 token, oauth, Session has expired, Error validating access token, API access blocked | warn + 알림 첫 줄 | |
| R17 중복 업로드 | 유튜브 uploads에서 같은 제목 2개 이상(기간 내) | info | |
| R18 이번 주 추이 | CRM this_week_to_date, GA4 daily_channel 기간 이후 날짜 | info | 미확정일 표기 |

- warnings 정렬: warn 먼저, 그다음 info. 각 문구는 "현상 → 수치(전→후) → 추정 원인(있으면 '추정')" 순서.
- 이상치 점검 순서: 측정 문제 → 시점 → 채널 → 기기 → 랜딩.

### 5-2. highlights (최대 3)
우선순위: ① 가입 총량(항상) ② 가장 큰 |변화| 세그먼트(기기 or 소스) ③ 유튜브 조회(또는 정정이 있으면 정정 항목) / 릴스 5만 이상이면 그것.
형식: `{label, value, previous, baseline, note}`.

### 5-3. checks (key 고정, status: done/pending/partial)
| key | item | 판정 |
|---|---|---|
| task0_pc_gtag | 작업0 PC 메인 GA4 태그 | www /main/main.php 세션 > 0 → done, 0 → pending |
| task1_4_signup | 작업1~4 첫 유입 쿠키·가입경로·sign_up | events에 sign_up(eventCount>0) 있고 direct_share < 0.83 → done, 하나만 → partial, 없음 → pending |
| utm_guide | UTM 가이드 | campaigns/source_medium에 bio·pinned·desc·reels_·boost_·lecture_ad 패턴: 6종 중 0 → pending, 일부 → partial, 전부 → done |
| yt_ad_goal | 유튜브 광고 목표 변경 | utm_medium=paid 또는 campaign lecture_ad 유입 세션 > 0 → done, 아니면 pending |
evidence에는 판정에 쓴 숫자를 넣는다.

### 5-4. 인스타 릴스 (reels[])
- 대상: posts 중 date가 기간 내.
- 훅: 캡션에서 고정 문구 2줄("이런 물건, 매일 하나씩 파헤칩니다…", "매일/평일 오후 5시 45분 · 팔로우하고 받아보세요!")을 건너뛴 **첫 내용 줄들(빈 줄 전까지)**.
- formula_ok = 훅에 금액 표현 2개 이상(정규식: `\d[\d,\.]*\s*(억|천만|만)\s*(원)?` 등) **그리고** 캡션에 지역/단지명 + 평형(`\d+\s*평`) → true.
- 공식 준수 vs 비준수 평균 조회 비교는 각 3편 이상일 때만.

### 5-5. 유튜브
- 롱폼 상위 3·숏폼 상위 3을 "이번 주 공개분"(첫 조회일이 기간 내) / "기존 영상(누적형)"으로 분리.
- 숏폼 지표 = 첫날 조회, 롱폼 = 공개 후 7일 조회(video_daily 합).
- 인스타 릴스와 같은 훅(제목 정규화 후 유사도 ≥ 0.8)이면 두 플랫폼 조회 나란히.
- 스냅샷 증분 = 이번 snapshot 누적 − 지난 보고서 youtube.snapshot 누적(공통 video_id만). 지난 snapshot 없으면 생략.

### 5-6. 월간 추가
지난 달 채널별 표, 기기/호스트별 가입, 랜딩 상위 25 전월 대비, 유튜브 ADVERTISING 비중,
다음 달 권고 3가지(예산·콘텐츠·개발)를 todos에 포함, 독립 HTML 보고서를 `html` 필드에(render_html.py, 인라인 CSS, 외부 리소스 없음).

## 6. corrections (자동 정정)
지난 보고서와 **기간이 겹치는** 수치를 이번 원자료로 다시 계산해 비교:
- GA4 signups·기기별 가입, YouTube views(롱/숏/전체)·revenue·ADVERTISING·shorts_day1_avg, CRM signups(cur/compare)·경로별.
- 차이가 있으면 `"<원천> <기간>(지난 보고 <report_key>): <항목> <이전> → <현재>"` 문장. 원인 추정(미집계, 현재 회원 기준 등) 덧붙임.
- 2026-10-23 예: 유튜브 10/12~18 조회 64,782 → 90,357, 수익 $34.53 → $45.06 (10/19 수집 시 10/17~18 미집계).

## 7. todos 생성
담당자가 바로 실행할 수 있는 구체 문장 2~4개(월간은 권고 3 포함). 규칙 → 템플릿 매핑:
R05 → 개발(배포 이력 확인 + 대상 화면·수치), R07/R08 → 인스타 콘텐츠(훅 공식 예시 포함), R11 → 유튜브 광고 목표+UTM 문자열,
R12/R13 → 네이버(충전·CPA 상위 키워드 입찰 인하: CPA 상위 4개와 현재 입찰가), R15/R16 → 토큰/Meta 앱 확인 링크.
우선순위: 인증/수집 실패 > 가입 하락 원인 > 광고 낭비 > 콘텐츠.

## 8. 출력 스키마 (reports/<report_key>.json)
- weekly: report_key `myauction-weekly-<run_date>`, title `마이옥션 주간 마케팅 점검 <run_date>`
- monthly: report_key `myauction-monthly-<run_date>`, title `마이옥션 월간 마케팅 정밀 분석 YYYY-MM`
```json
{
 "report_key":"", "site":"myauction", "type":"weekly|monthly", "report_date":"YYYY-MM-DD",
 "period":{"start":"","end":""}, "compare_period":{"start":"","end":""}, "title":"",
 "summary":"≤500자",
 "kpis":{ ...§4 키 전부, 값 없으면 null },
 "highlights":[{"label":"","value":0,"previous":0,"baseline":null,"note":""}],
 "warnings":[{"level":"warn|info","text":""}],
 "checks":[{"key":"","item":"","status":"done|pending|partial","evidence":""}],
 "todos":[""],
 "reels":[{"date":"","hook":"","views":0,"reach":0,"saved":0,"shares":0,"formula_ok":false}],
 "channels":[{"source_medium":"","sessions":0,"conversions":0,"cvr":0,"prev_sessions":0,"prev_conversions":0}],   // 상위 20
 "devices":[{"device":"","sessions":0,"engagement_rate":0,"new_users":0,"conversions":0,"cvr":0,"prev_conversions":0}],
 "landing":[{"host":"","device":"","landing_page":"","sessions":0,"conversions":0}],                               // 상위 15
 "audience":[{"segment":"new","sessions":0,"engagement_rate":0,"avg_duration_sec":0,"conversions":0,"prev_conversions":0}],
 "youtube":{"totals":{"longform":{"views":0,"avg_view_pct":0,"subs":0},"shorts":{...},"revenue_usd":null,"revenue_usd_prev":null},
            "new_uploads":[{"video_id":"","title":"","format":"long|short","released":"","day1_views":null,"week_views":null,"avg_view_pct":null,"revenue_usd":null}],
            "evergreen":[{"video_id":"","title":"","week_views":0,"revenue_usd":null}],
            "recent_uploads":[...], "snapshot":{"taken_at":"","videos":[{"video_id":"","views":0}]},
            "views_total":0,"views_total_prev":0,"advertising_views":0,"advertising_views_prev":0,
            "snapshot_increase_since_prev":{"from":"","to":"","total":0,"top":[]}},
 "search_console":null, "ads":{ 네이버: source, period, compare, campaigns, devices, device_by_campaign, keywords_top_spend,
            keywords_efficient, keywords_no_conversion, keywords_high_cpa, keyword_volume, bizmoney_krw, bizmoney_days_left, keyword_count, notes },
 "corrections":[""], "content_md":"", "html":null, "crm":{ source, period{signups,withdrawals,by_path,by_sex,by_age,by_region}, compare{...}, daily_signups{}, this_week_to_date{} },
 "notes":[""], "generator":{"name":"marketing-briefing-analyzer","version":"","run_id":""}
}
```
- 원자료가 없어 채울 수 없는 객체·배열 항목은 null 대신 **키 생략 또는 빈 배열**.
- `schema.py`에 jsonschema로 정의하고 analyze 마지막 단계와 publish 직전에 검증: 필수 키, 날짜 `^\d{4}-\d{2}-\d{2}$`, 숫자 타입, summary ≤ 500자, 전체 < 5MB, 비밀값 패턴(token|key=|Bearer|password) 미포함.

### content_md 섹션 순서 (render_md.py)
1 요약 → 2 정정(있을 때) → 3 가입·기기(표) → 4 유입 채널 상위 12(표) → 5 일별 추이 → 6 CRM 회원 지표(표: 가입·탈퇴·경로·성별, 연령·지역 상위) →
7 유튜브 → 8 인스타그램(릴스 표) → 9 네이버 검색광고 → 10 진행 체크(표) → 11 경고 → 12 실행 과제 → 끝줄 "기간 비교는 상관관계로만 해석. 원인은 모두 추정."
샘플: docs/reference/sample_report_2026-10-23.json의 content_md.

### summary 템플릿 (LLM 없을 때)
`{기간} GA4 가입 {n}건(일 {d}), 전주 {p} 대비 {±%}(CRM {cp}→{c}, {±%}). {가장 큰 변화 세그먼트 1문장}. {유튜브 1문장(정정 있으면 정정 표기)}. {이번 주 추이 1문장}. {원천 실패/대체 1문장}. {광고 잔액 1문장}.` → 500자 넘으면 뒤 문장부터 제거.

### 선택: LLM 서술 다듬기
`ANTHROPIC_API_KEY`가 있으면 summary·warnings 문구·todos·content_md 서술만 Claude API로 다듬는다.
입력은 계산 끝난 payload(JSON)만, 출력은 같은 키만 교체. **숫자는 바꾸지 못하게** 후처리에서 원본 숫자 집합과 대조해 새 숫자가 생기면 템플릿 문장으로 되돌린다.

## 9. 회귀 기준값 (data/2026-10-23.json + 아래 CRM 입력 → 일치해야 함)
CRM 입력(2026-10-23 수집): cur sex[941,642,0], age[0,117,442,345,342,192,36,3,106], path[739,160,65,619],
daily 10/12~18 signups[266,251,280,217,189,187,193] withdrawals[3,0,2,3,5,3,1];
prev path[846,181,83,563], daily signups[286,263,223,250,193,236,222] withdrawals[3,8,0,5,4,1,2];
this week 10/19~22 signups[314,262,234,235] withdrawals[6,2,4,5].

| 항목 | 기대값 |
|---|---|
| signups / prev / per_day | 1680 / 1778 / 240.0 |
| direct_share | 0.8476 |
| desktop_cvr / mobile_cvr | 0.0102 / 0.0201 |
| 기기 가입 cur(prev) | desktop 701(650), mobile 928(1094), tablet 51(34) |
| app_webview_signups / new_user_signups / pc_main | 150 / 1412 / 0 |
| google_organic_signups / youtube_sessions / naver_search_cvr | 22 / 41 / 0.0246 |
| yt views total cur/prev | 90357 / 81074 |
| yt longform / shorts / revenue | 71043 / 19242 / 45.064 |
| yt ADVERTISING cur/prev | 44202 / 42013 |
| yt_shorts_day1_avg | 1403.1 (7편) |
| 롱폼 신규 WpubrgfHt-I | 첫날 3846, 7일 8455 |
| naver cost/clicks/conv/cpa | 1266547 / 5357 / 438 / 2892 |
| bizmoney / days_left | 564697 / 3.1 |
| crm signups / prev / withdrawals | 1583 / 1673 / 17 |
| GA4-CRM 차이 | +6.1% → info |
| Unassigned 10/22 | 7879 → R03 info (확정일 최대 358 → R02 없음) |
| corrections | 유튜브 64,782→90,357 등 (지난 보고 = reports/myauction-weekly-2026-10-19.json) |
