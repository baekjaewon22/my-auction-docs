# Codex + Claude Code 협업 규칙

이 저장소의 기본 AI 작업 흐름은 다음과 같습니다.

1. Codex가 요구사항 분석, 구현, 테스트, 배포 준비와 최종 통합을 담당합니다.
2. Claude Code는 변경사항을 읽기 전용으로 검토하고 오류 가능성, 회귀 위험, 누락된 테스트를 분석합니다.
3. Codex는 Claude Code의 지적을 현재 코드와 실제 테스트 결과로 재검증한 뒤 필요한 사항만 수정합니다.
4. 검증이 끝난 변경만 커밋하고 배포합니다.

## 역할 경계

- Codex만 기본 작업 폴더의 파일을 수정합니다.
- Claude Code 리뷰 프로세스에는 `Read`, `Glob`, `Grep` 도구만 제공합니다.
- Claude Code는 구현을 직접 고치지 않고 파일, 라인, 근거와 수정 권고를 반환합니다.
- Claude의 답변은 참고 결과이며 Codex가 코드와 테스트로 재검증합니다.
- 두 에이전트가 같은 체크아웃을 동시에 수정하지 않습니다.
- 인증값, 세션 토큰, `.env` 내용은 프롬프트와 리뷰 결과에 포함하지 않습니다.

## 실행 명령

Claude 리뷰는 선택한 코드 변경분과 필요한 저장소 문맥을 Anthropic 서비스로 전송합니다. 저장소 소유자가 외부 전송을 명시적으로 승인한 경우에만 일반 로컬 터미널에서 실행합니다.

직전 리뷰 이후의 변경 검토:

```powershell
npm run ai:review:external
```

기본 명령은 이전 리뷰에 기록된 Git 커밋 이후의 변경을 모두 검토합니다. 이전 리뷰 기준이 아직 없으면 최신 커밋과 현재 작업 폴더 변경을 검토합니다.

특정 기준 커밋 이후의 전체 변경 검토:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\invoke-claude-review.ps1 -BaseRef origin/main -AllowExternalDisclosure
```

연결 상태만 확인:

```powershell
npm run ai:review:check
```

리뷰에 성공하면 `.ai/reviews/`에 시각이 포함된 JSON·Markdown 파일을 만들고, 같은 결과를 다음 고정 경로에도 저장합니다.

- `.ai/reviews/latest-claude-review.json`
- `.ai/reviews/latest-claude-review.md`

리뷰 파일은 Git에 포함하지 않습니다. Codex는 다음 작업을 시작할 때 최신 JSON을 자동으로 확인하므로, 사용자가 매번 “최신 Claude 리뷰를 확인해줘”라고 적거나 결과를 복사할 필요가 없습니다. 단, 외부 전송이 발생하는 Claude 리뷰 실행 자체는 자동 실행하지 않으며 매번 소유자의 승인 범위 안에서 수행해야 합니다.

## 리뷰 판정

- `pass`: 즉시 수정해야 할 오류가 발견되지 않음
- `needs_changes`: blocker/high/medium 오류 또는 중요한 테스트 누락이 있음
- `blocker`: 데이터 손실, 보안 사고, 배포 불능 가능성이 매우 높음
- `high`: 주요 기능 오작동 또는 큰 회귀 가능성
- `medium`: 특정 조건에서 발생하는 실제 오류 또는 검증 누락
- `low`: 유지보수성, 명확성, 완성도 개선 사항
