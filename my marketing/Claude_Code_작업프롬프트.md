# Claude Code 작업 프롬프트 — 마이옥션 브리핑 자동화 전체 이전

> 이 파일은 사람이 읽고 **Claude Code에 붙여 넣는 프롬프트 모음**이다.
> 프로젝트 지침은 저장소 안 `CLAUDE.md`, 분석 규칙은 `docs/BRIEFING_SPEC.md`에 있다(Claude Code가 자동으로 읽음).

## 0. 준비 (사람이 할 일, 10분)
1. 회사 PC에서 저장소를 git으로 받는다(지금 폴더는 contents API로 올린 사본이라 git 이력이 없다).
   ```
   cd C:\Users\260209\Desktop\마케팅점검\마이옥션
   git clone https://github.com/baekjaewon22/myauction-weekly-briefing.git repo
   ```
   그다음 지금 폴더의 `CLAUDE.md`, `docs/`, `.claude/`를 `repo/`로 복사한다(아직 GitHub에 없는 새 파일들).
2. `repo` 폴더에서 `claude` 실행. 첫 메시지로 아래 **1. 시작 프롬프트**를 붙여 넣는다.
3. 인스타 차단은 코드로 못 푼다. Meta 앱 대시보드(https://developers.facebook.com/apps/)에서 앱 상태 확인 → 토큰 재발급 → GitHub Secret `IG_ACCESS_TOKEN` 교체.
4. 비밀값은 **절대 Claude Code 대화창에 붙여 넣지 않는다.** GitHub Secrets 또는 `.secrets/` 파일에 직접 넣고, Claude에게는 "파일에 넣었다"고만 말한다.

---
## 1. 시작 프롬프트 (그대로 붙여 넣기)
```
이 저장소는 마이옥션 주간/월간 마케팅 브리핑 파이프라인이다. CLAUDE.md와 docs/BRIEFING_SPEC.md를 끝까지 읽고,
docs/reference/ 의 프로토타입 스크립트 2개와 sample_report_2026-10-23.json, scripts/collect.py, scripts/publish.py,
_workflows/*.yml(실제 위치 .github/workflows)을 훑어본 뒤 다음을 해 줘.

목표: 지금 Cowork 예약 작업(LLM)이 하던 "분석·CRM 수집·알림"을 코드로 옮겨서, 금요일마다 사람 개입 없이
collect → analyze → publish → notify가 끝나게 만든다. 결과물 품질 기준은 sample_report_2026-10-23.json이다.

먼저 코드를 쓰지 말고 아래를 정리해서 보여 줘:
1) 현재 구조 요약과 목표 구조의 차이(새 파일·바뀌는 파일 목록)
2) 단계별 작업 계획(이 문서의 2~8단계 순서를 기본으로, 바꿀 게 있으면 이유와 함께)
3) 확인이 필요한 질문(최대 5개). 특히 CRM 로그인 방식, 알림 채널, Actions에서 CRM 접근 가능 여부.
4) 위험 요소(비밀값 노출, 개인정보, 스키마 호환, my-docs.kr API 검증 실패)

규칙: 비밀값 출력 금지, CRM은 집계 숫자만, 날짜는 KST, 원자료에 없는 숫자 만들지 않기, main에 바로 push하지 말고 브랜치+PR.
```

---
## 2. 단계별 프롬프트 (한 단계씩, 끝날 때마다 테스트 통과 확인 후 다음)

### 2단계 — 분석 엔진 골격과 회귀 테스트
```
scripts/briefing/ 패키지와 scripts/analyze.py를 만든다.
- analyze.py 인자: --run-date, --data(기본 data/<run_date>.json), --crm(기본 crm/<run_date>.json, 없으면 CRM 없이),
  --prev(기본: reports/에서 run_date 이전 최신), --out(기본 reports/<report_key>.json), --md, --validate <file>, --no-llm
- 모듈: periods.py(BRIEFING_SPEC §1), loaders.py(§2, fallback 포함), baselines.py(§3), kpis.py(§4), schema.py(§8 jsonschema)
- 우선 kpis·channels·devices·landing·audience·crm 객체까지만 만들고, warnings/checks/todos/summary는 빈 값.
- tests/: data/2026-10-23.json + BRIEFING_SPEC §9의 CRM 입력으로 §9 표의 숫자가 전부 일치하는지 검사하는 pytest.
  fixture CRM 파일은 tests/fixtures/crm_2026-10-23.json으로 만든다.
- docs/reference/prototype_*.py는 참고만 하고 import하지 않는다(하드코딩 값이 섞여 있음).
끝나면 pytest 결과와 §9 대비 표를 보여 줘.
```

### 3단계 — 유튜브·인스타·네이버 모듈
```
briefing/youtube.py, instagram.py, naver.py를 BRIEFING_SPEC §5-4, §5-5, §2-1 대로 구현한다.
- 유튜브: 공개일=첫 조회일, 이번 주 공개분/기존 영상 분리, 숏폼 첫날·롱폼 7일, 스냅샷 증분, 중복 제목 탐지, 릴스와 같은 훅 매칭.
- 인스타: 훅 추출(고정 문구 2줄 건너뛰기), formula_ok 정규식, 평일 공백, 5만 이상 후보. 인스타가 errors면 §2-4 fallback.
- 네이버: 캠페인/키워드 합계, CPA 상위·무전환·효율 키워드, 비즈머니 일수, 지난 보고서 대비 입찰가 변경 감지
  (bid_krw_prev_report). campaign_device는 기간 종료 7일 초과면 직전 수집분.
- 테스트: 2026-10-23 기대값(롱폼 WpubrgfHt-I 3846/8455, 숏폼 첫날 평균 1403.1, 비즈머니 3.1일, 인스타 fallback=10/19 파일).
```

### 4단계 — 규칙·체크·정정·todos·서술
```
briefing/rules.py(R01~R18), checks.py(§5-3), corrections.py(§6), todos.py(§7), render_md.py, summary 템플릿(§8)을 구현한다.
- 규칙마다 단위 테스트 1개 이상(경계값 포함: Unassigned 499/500, 변화율 39.9%/40%, 세션 299/300).
- 2026-10-23 실행 결과의 warnings가 sample_report의 warnings와 "같은 사실"을 담는지 비교표로 보여 줘(문구는 달라도 됨).
- corrections: reports/myauction-weekly-2026-10-19.json 대비 유튜브 64,782→90,357, CRM 1,585→1,583이 자동으로 나와야 한다.
- 월간이면 render_html.py로 html 필드 생성(인라인 CSS, 외부 리소스 없음). 2026-11-02 가상 실행으로 월간 경로 테스트.
- --llm 옵션(ANTHROPIC_API_KEY 있을 때만): 서술만 다듬고, 숫자가 새로 생기면 템플릿으로 되돌리는 가드 + 테스트.
```

### 5단계 — CRM 수집기 (회사 PC 전용)
```
scripts/crm_pull.py를 만든다. 회사 PC(Windows)에서 실행되고, 결과를 crm/<run_date>.json으로 GitHub에 올린다.
- 대상: http://crm.my-auction.co.kr/admin/graph.php (POST sdate, edate) → inline script의 data:[…] 배열 4개
  (성별, 연령, 지역, 가입경로), /admin/graph2.php (POST analy_type=day, sdate, edate) → labels + data 2개(일별 가입, 탈퇴).
  반드시 http(https는 오류).
- 인증: 먼저 로그인 페이지 구조를 확인만 하고(제출하지 말고) 방식을 제안해 줘. 후보:
  (a) requests.Session + 로그인 폼(아이디/비번은 .secrets/crm.env, gitignore)
  (b) Playwright persistent context로 이미 로그인된 Chrome 프로필 재사용
  선택은 내가 한다. 어느 쪽이든 쿠키·비번을 로그/파일에 남기지 않는다.
- 기간: 분석 기간, 비교 기간, 이번 주 월~어제(참고). BRIEFING_SPEC §2-2 형식.
- 개인정보 페이지(회원 목록·검색·상세) 요청 금지. 허용 URL 화이트리스트를 코드에 두고 그 외 요청은 예외.
- 업로드: tools/gh_io.py put 재사용. 로그인 화면이 나오면 "CRM 로그인 필요"를 crm/<run_date>.json에 status로 기록하고 종료코드 2.
- Windows 작업 스케줄러 등록용 crm_pull.bat + 등록 명령(schtasks) 예시: 매주 금 05:30, 월 1일 05:30.
```

### 6단계 — 워크플로 재구성
```
.github/workflows를 다음처럼 바꾼다(로컬 사본 _workflows/도 동기화).
- collect.yml: cron을 금 05:00 KST(목 20:00 UTC)로 앞당기고 + 월 1~7일 실행 보장(월간). 인스타 토큰 갱신 단계는
  continue-on-error 유지하되 결과(성공/실패, 만료까지 일수)를 data/ig_token_status.json에 기록하고 실패면 notify.
  네이버 campaign_device는 기간 종료 7일 초과면 호출하지 않게 collect.py 수정.
- analyze.yml(신규): on workflow_run(collect, completed, success) + push(paths: crm/**) + workflow_dispatch(run_date).
  run_date 계산 → analyze.py → --validate → reports/ 커밋(같은 report_key 덮어쓰기). CRM이 나중에 오면 재분석→publish가 updated로 게시.
  CRM 대기 정책: collect 직후 crm 파일이 없으면 CRM 없이 게시하고, CRM 도착 시 재게시.
- publish.yml: 기존 유지. 끝에 notify.py 호출.
- healthcheck.yml(신규): 매일 09:00 KST. 인스타 /me, 유튜브 토큰 교환, GA4 1행 조회, 네이버 비즈머니, my-docs dry-run(작은 샘플).
  실패나 비즈머니 3일 미만이면 notify. 결과는 data/health/<date>.json(비밀값 없이).
- concurrency 그룹으로 collect/analyze/publish 동시 실행 방지.
```

### 7단계 — 알림
```
scripts/notify.py를 만든다. 설정된 채널만 사용: (1) 이메일(SMTP secrets) (2) Slack webhook (3) GitHub Actions job summary(항상).
내용: 첫 줄 = 핵심 결론 1줄(인증 만료 신호가 있으면 "토큰 재발급 필요(원천)"를 맨 앞),
이후 유형·기간 / created·updated·failed(사유) / 게시 URL / 누락 원천 / warn 경고 상위 3개.
publish 실패면 content_md를 첨부(이메일) 또는 Actions artifact로 업로드. 비밀값·개인정보 포함 여부 검사 후 발송.
```

### 8단계 — 전환 리허설과 Cowork 예약 작업 정리
```
1) 2026-10-23 데이터로 analyze → publish를 테스트용 report_key(myauction-weekly-2026-10-23-test가 API에서 허용되는지 dry-run으로 먼저 확인)로
   리허설하거나, dry-run만으로 검증한다. 실제 게시본(myauction-weekly-2026-10-23)은 덮어쓰지 않는다.
2) 다음 금요일 실행 체크리스트를 docs/RUNBOOK.md로 작성: 시간표, 실패 시 수동 절차(/weekly-briefing), 토큰 재발급 절차(인스타·유튜브·네이버),
   Secrets 목록과 만료 주기.
3) README.md를 새 구조로 갱신.
4) 전환이 끝나면 Cowork의 "마이옥션 주간브리핑" 예약 작업을 끌 수 있도록, 무엇이 대체됐는지 표로 정리해 줘.
```

---
## 3. 매주 운영 프롬프트 (자동화 실패 시)
Claude Code에서 `/weekly-briefing` 또는 `/weekly-briefing 2026-10-30` 입력. (`.claude/commands/weekly-briefing.md`)

## 4. 검증 프롬프트 (PR 리뷰용)
```
이 PR을 리뷰해 줘. 기준: CLAUDE.md §4 절대 규칙, BRIEFING_SPEC §9 회귀값, §8 스키마.
특히 (1) 비밀값·쿠키·개인정보가 로그/파일/커밋에 들어갈 경로 (2) UTC/KST 혼동 (3) 비율 지표 합산·평균
(4) 원자료에 없는 숫자 생성 (5) report_key 변경 가능성 (6) 원천 실패 시 예외로 전체가 죽는 경로를 찾아 줘.
```

## 5. 완료 기준 체크리스트
- [ ] `pytest` 전부 통과, §9 회귀값 일치
- [ ] 2026-10-23 재생성본이 sample_report와 같은 사실을 담음(정정·경고·체크·todos)
- [ ] 인스타 실패 시 fallback + 경고 + 알림 동작
- [ ] CRM 없을 때 게시 → CRM 도착 시 updated 재게시
- [ ] 월간 경로(html 포함) 가상 실행 통과
- [ ] collect 지연(cron) 무관하게 analyze가 collect 완료 직후 실행
- [ ] healthcheck가 인스타 차단·비즈머니 부족을 하루 안에 알림
- [ ] 비밀값 스캔(gitleaks 또는 정규식) 통과
- [ ] RUNBOOK.md, README.md 갱신
- [ ] Cowork 예약 작업 끄기 전 1회 병행 실행 결과 비교
