# CLAUDE.md — 마이옥션 주간/월간 마케팅 브리핑 파이프라인

이 파일은 Claude Code가 이 저장소에서 작업할 때 가장 먼저 읽는 프로젝트 지침이다.
세부 규칙은 `docs/BRIEFING_SPEC.md`(분석·스키마 명세)를 따른다. 두 문서가 다르면 BRIEFING_SPEC이 우선한다.

## 1. 목적
마이옥션(my-auction.co.kr) 마케팅 성과를 매주 금요일(월 1~7일 실행이면 월간) 자동으로 수집·분석해서,
마이오피스(my-docs.kr)의 「마이옥션 주간브리핑」으로 게시하고 담당자에게 알린다.
지금까지는 수집·게시는 GitHub Actions, **분석·CRM 수집·알림은 Cowork 예약 작업(LLM)** 이 했다.
이번 작업의 목표는 **분석·CRM·알림까지 코드로 옮겨, 사람/LLM 없이도 매주 같은 품질의 브리핑이 나오게 하는 것**이다.
LLM은 선택적으로 "서술문 다듬기"에만 쓴다(없어도 템플릿 문장으로 완결된 보고서가 나와야 함).

## 2. 저장소 구조 (현재 → 목표)
```
.github/workflows/        # 실제 위치. 로컬 사본은 _workflows/ (업로드 시 .github/workflows로)
  collect.yml             # [있음] 금 07:30 KST 예약 + 수동. GA4·YouTube·Instagram·Naver 수집 → data/
  publish.yml             # [있음] reports/*.json push 시 my-docs.kr dry-run → 게시 → 확인 → reports/results/
  analyze.yml             # [신규] collect 성공(workflow_run) 또는 crm/ push 시 분석 → reports/ 커밋
  healthcheck.yml         # [신규] 매일 토큰·API 상태 점검(인스타 차단, 토큰 만료, 비즈머니) → 알림
scripts/
  collect.py              # [있음] 원자료 수집 (620줄). data/<run_date>.json, data/latest.json
  publish.py              # [있음] 게시
  refresh_ig_token.py     # [있음] 인스타 60일 토큰 갱신
  analyze.py              # [신규] data + crm + 지난 보고서 → reports/<report_key>.json (+ .md, 월간 .html)
  briefing/               # [신규] analyze.py가 쓰는 모듈 (ga4.py, youtube.py, instagram.py, naver.py, crm.py,
                          #        rules.py(경고·체크), corrections.py, render_md.py, render_html.py, schema.py)
  crm_pull.py             # [신규] 회사 PC에서 실행. CRM 집계값 → crm/<period>.json 업로드
  notify.py               # [신규] 결과 요약 알림(이메일/슬랙/카카오 중 설정된 것)
tools/gh_io.py            # [있음] 로컬 PC에서 GitHub contents API 입출력(get/ls/put/dispatch/runs)
data/                     # 수집 원자료(커밋됨)
crm/                      # [신규] CRM 집계 JSON(개인정보 없음, 집계 숫자만)
reports/                  # 게시용 브리핑 JSON. reports/results/ 게시 결과
docs/BRIEFING_SPEC.md     # 분석 규칙·스키마 상세
docs/reference/           # 프로토타입 스크립트·샘플 보고서(2026-10-23). 구현 참고용, 직접 import 금지
tests/                    # [신규] pytest. fixtures는 data/2026-10-19.json, data/2026-10-23.json 사용
```

## 3. 데이터 흐름 (목표)
1. (목 23:00~금 06:00 KST, 회사 PC) `crm_pull.py` → `crm/<run_date>.json` push. 실패해도 파이프라인은 진행.
2. (금 05:00 KST 예약, 지연 대비 이르게) `collect.yml` → `data/<run_date>.json`, `data/latest.json`.
3. `analyze.yml` (collect 완료 workflow_run, 또는 crm/ push, 또는 수동) → `reports/myauction-<type>-<run_date>.json` 커밋.
4. `publish.yml` (reports push) → my-docs.kr 게시 → `reports/results/*.result.json`.
5. `notify.py` (publish 끝) → 한 줄 결론 + URL + 경고 알림.
같은 run_date로 다시 돌면 **같은 report_key로 덮어쓰기(updated)**. report_key는 절대 바꾸지 않는다.

## 4. 절대 규칙
- **비밀값**: 키·토큰·쿠키·비밀번호는 GitHub Secrets 또는 로컬 `.secrets/`(gitignore)에만. 로그·커밋·보고서·에러 메시지에 원문 금지.
  collect.py의 `scrub()` 패턴을 재사용한다. `print(os.environ[...])`, `cat .secrets/*` 금지.
- **개인정보**: CRM에서는 집계 숫자만 가져온다. 이름·연락처·아이디가 있는 페이지는 요청하지도 저장하지도 않는다.
  CRM의 저장·검색·수정 폼을 제출하지 않는다(읽기 전용 POST: graph.php, graph2.php 조회 파라미터만).
- **날짜는 KST**: 실행일 = `datetime.now(ZoneInfo("Asia/Seoul")).date()`. UTC 날짜 사용 금지(08:22 KST는 UTC 전날).
- **수치**: 원자료 값만 쓴다. 확인 못 한 값은 0이 아니라 `null`. 비율은 소수(83.2% → 0.832).
  유튜브 averageViewPercentage(예 30.34)는 /100. 숫자 필드에 문자열 금지.
- **비교 해석**: 기간 비교는 상관관계로만 서술, 원인은 "추정"으로 표기.
- **비율 지표 합산 금지**: engagementRate, averageSessionDuration은 행끼리 더하거나 평균 내지 않는다.
- **표본**: 세션 300 미만 세그먼트는 "표본 부족"으로 결론 보류.
- **기존 동작 보존**: collect.py 출력 스키마(`schema: 1`)를 깨지 않는다. 바꾸면 `schema` 숫자를 올리고 analyze가 둘 다 읽게.
- 커밋 메시지는 한국어 한 줄 + 필요 시 본문. main 직접 push 전 `pytest` 통과.

## 5. 외부 시스템 요약
| 시스템 | 식별자 | 인증(Secret 이름) | 비고 |
|---|---|---|---|
| GA4 Data API | 속성 269592284 | GA4_SA_JSON | 가입 = keyEvents(회원가입완료) |
| YouTube Data/Analytics | 채널 UCsB4-8k5DBRkzC1lk02-aoQ (마이옥션TV) | YT_API_KEY, YT_CLIENT_ID/SECRET, YT_REFRESH_TOKEN | 날짜 = 미국 태평양 기준. 2~3일 집계 지연 |
| Instagram API (Instagram 로그인) | myauction_official, graph.instagram.com | IG_ACCESS_TOKEN (60일, 매주 갱신) | 2026-10-23부터 "API access blocked (code 200)" — Meta 앱/계정 조치 필요 |
| 네이버 검색광고 API | api.searchad.naver.com | NAVER_AD_API_KEY, NAVER_AD_SECRET, NAVER_AD_CUSTOMER_ID | 상세(기기별) 통계는 최근 7일 이내만 |
| 마이오피스 브리핑 API | https://my-docs.kr/api/briefings | MYDOCS_BRIEFING_API_KEY | X-API-Key, ?dry_run=1, 5MB 미만 |
| CRM | http://crm.my-auction.co.kr/admin/graph.php, graph2.php | 로컬 .secrets (회사 PC) | **http만** 동작(https 오류). 사내/IP 제한 가능 → GitHub Actions에서 접근 불가 가정 |
| GitHub | baekjaewon22/myauction-weekly-briefing (비공개) | GH_PAT(Actions), 로컬 .secrets/GITHUB_BRIEFING_PAT.txt | |
| Search Console, Google Ads | 미연결 | — | 보고서에 null + "연결 필요" |

## 6. 개발 명령
```bash
pip install -r requirements.txt -r requirements-dev.txt   # requirements-dev: pytest, jsonschema
python scripts/analyze.py --data data/2026-10-23.json --crm crm/2026-10-23.json --prev reports/myauction-weekly-2026-10-19.json --out /tmp/out.json
python scripts/analyze.py --validate reports/myauction-weekly-2026-10-23.json   # 스키마 검증만
pytest -q
python tools/gh_io.py runs 5            # 로컬 PC에서 Actions 상태
```
회귀 기준: `data/2026-10-23.json` + docs/reference의 CRM 값으로 돌렸을 때 핵심 수치가
`docs/reference/sample_report_2026-10-23.json`과 일치해야 한다(BRIEFING_SPEC §9 목록).

## 7. 알려진 이슈 (2026-10-27 기준)
1. 인스타 API 차단(code 200 "API access blocked") — 코드 문제 아님. Meta 앱 대시보드/계정 확인 후 토큰 재발급 필요.
   → 코드 쪽 할 일: 인스타 실패 시 직전 성공 수집분으로 대체하고 notes·경고에 명시, healthcheck로 매일 감지.
2. GitHub cron 지연: 07:30 예약이 09:47에 실행됨 → 예약을 더 이르게, 분석은 시각이 아닌 collect 완료 이벤트로 시작.
3. `Refresh Instagram token` 단계가 `continue-on-error`라 실패해도 success 표시 → 결과를 파일/요약으로 남기고 실패면 알림.
4. 네이버 campaign_device는 최근 7일 이내만 가능 → 분석 기간 종료 후 7일이 지나면 요청하지 말고 직전 수집분 사용.
5. 유튜브는 월요일 수집 시 직전 주말 데이터가 미집계 → 금요일 확정치와 다르면 corrections에 정정 문구 자동 생성.
6. CRM 가입 수는 "현재 회원 기준"이라 지난 회차보다 1~2건 줄 수 있음 → 정정 문구 자동 생성(±0.5% 이내면 info).
