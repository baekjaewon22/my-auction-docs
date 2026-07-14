# Codex + Claude Code 협업 규칙

이 저장소의 기본 AI 협업 흐름은 다음과 같다.

1. Codex가 요구사항 분석, 구현, 테스트, 배포 준비를 담당한다.
2. Claude Code는 변경사항을 읽기 전용으로 검토하고 오류 가능성, 회귀 위험, 누락된 테스트를 분석한다.
3. Codex가 Claude Code의 지적을 코드와 실제 실행 결과로 검증한 뒤 필요한 사항을 수정한다.
4. 검증이 끝난 변경만 커밋·배포한다.

## 역할 경계

- Codex만 기본 작업 폴더의 파일을 수정한다.
- Claude Code 리뷰 프로세스에는 `Read`, `Glob`, `Grep` 도구만 제공한다.
- Claude Code는 구현을 직접 고치지 않고 파일·라인·근거·수정 권고를 반환한다.
- Claude Code의 의견은 참고 결과이며, Codex가 코드와 테스트로 재검증한다.
- 두 에이전트가 같은 파일을 동시에 수정하지 않는다.
- 인증키, 세션 토큰, `.env` 내용은 프롬프트나 리뷰 결과에 포함하지 않는다.

## 실행 명령

Claude 리뷰는 선택한 코드 변경분을 Anthropic 서비스로 전송한다. 저장소 소유자가 외부 전송을 명시적으로 승인한 뒤에만 다음 명령을 사용한다.

현재 커밋 이후의 미커밋 변경 검토:

```powershell
npm run ai:review:external
```

특정 기준 커밋 이후의 전체 변경 검토:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\invoke-claude-review.ps1 -BaseRef origin/main -AllowExternalDisclosure
```

연결 상태만 확인:

```powershell
npm run ai:review:check
```

리뷰 결과는 `.ai/reviews/`에 JSON과 Markdown으로 저장되며 Git에는 포함하지 않는다.

## 리뷰 판정

- `pass`: 즉시 수정해야 할 오류가 발견되지 않음
- `needs_changes`: blocker/high/medium 오류 또는 중요한 테스트 누락이 있음
- `blocker`: 데이터 손실, 보안 사고, 배포 불능 가능성이 매우 높음
- `high`: 주요 기능 오작동 또는 큰 회귀 가능성
- `medium`: 특정 조건에서 발생하는 실제 오류 또는 검증 누락
- `low`: 유지보수성·명확성 개선 사항
