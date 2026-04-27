---
description: 현재 변경(git diff)을 reviewer 에이전트로 품질·보안 리뷰
---

# /review — 변경 사항 리뷰

`reviewer` 에이전트를 호출해 현재 변경을 점검합니다.

## 실행 절차

### 1. 변경 범위 결정

```bash
git status --short
git diff --stat
git diff              # 전체 diff
```

옵션:
- 기본: 스테이징·언스테이징 전부
- `/review staged` — 스테이징된 것만
- `/review HEAD~1` — 최근 커밋
- `/review <파일경로>` — 특정 파일만

### 2. 사전 자동 검사

```bash
pnpm typecheck
pnpm lint    # 있으면
pnpm test    # 빠른 경우만
```

결과를 reviewer 에이전트에 입력으로 같이 전달.

### 3. reviewer 호출
reviewer 가 다음을 검사:
- 품질 (타입·네이밍·구조)
- 보안·권한 (ROLES.md 위반)
- 금지사항 (DO-NOT.md)
- 도메인 일관성
- 테스트 커버리지

### 4. 결과 보고

`BLOCKED` / `REVISE` / `PASS` 중 하나.

### 5. 후속 액션 제안

| 결과 | 다음 |
|---|---|
| PASS | scribe 로 커밋 메시지 작성 위임 |
| REVISE | 사용자 확인 후 implementer 로 수정 |
| BLOCKED | 필수 수정 우선 처리, 수정 후 다시 /review |

## 원칙

- 리뷰 결과는 **직접 고치지 말 것** (지적만)
- 대표님에게 수정 주도권 전달
- 자동 검사 결과(typecheck/lint)는 reviewer 의견보다 우선 표시
