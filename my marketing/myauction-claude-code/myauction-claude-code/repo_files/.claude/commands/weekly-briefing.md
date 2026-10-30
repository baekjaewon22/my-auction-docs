---
description: 마이옥션 주간/월간 브리핑을 수동으로 점검·재생성·게시한다 (자동 파이프라인이 실패했을 때)
---
마이옥션 브리핑을 수동으로 처리한다. CLAUDE.md와 docs/BRIEFING_SPEC.md를 먼저 읽는다. 인자: $ARGUMENTS (비우면 오늘 KST 실행일)

1. 실행일·유형·기간을 BRIEFING_SPEC §1로 계산해 한 줄로 보여 준다.
2. `python tools/gh_io.py runs 5`로 collect/analyze/publish 최근 상태를 확인한다.
3. `data/<실행일>.json`이 없거나 period가 다르면 `python tools/gh_io.py dispatch collect.yml '{}'` 후 60초 간격으로 최대 8분 대기.
4. errors를 원천별로 요약한다. 인증 신호(token/oauth/Session has expired/API access blocked)가 있으면 맨 위에 "토큰 재발급 필요(원천)".
5. `crm/<실행일>.json`이 없으면 회사 PC에서 `python scripts/crm_pull.py --run-date <실행일>` 실행을 안내하거나(로컬이면 직접 실행), CRM 없이 진행한다.
6. `python scripts/analyze.py --run-date <실행일>`로 payload를 만들고 `--validate`로 검증한다. 회귀 기준(BRIEFING_SPEC §9)과 다른 숫자가 있으면 이유를 설명한다.
7. 내가 승인하면 `python tools/gh_io.py put reports/<report_key>.json <파일>`로 올리고, 90초 뒤부터 60초 간격 최대 6분 `reports/results/<report_key>.result.json`을 확인한다.
8. 결과를 5줄 이내로: 유형·기간 / 핵심 결론 1~3줄 / created·updated·failed(사유) / URL / 누락 원천·경고.
키·토큰·쿠키·개인정보는 출력하지 않는다.
