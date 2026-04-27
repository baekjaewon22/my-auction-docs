---
description: 문서·코드 일관성 점검 (ROLES ↔ types/roles.ts 등)
---

# /sync-context — 컨텍스트 일관성 점검

MD 문서와 실제 코드가 어긋나는 지점을 찾습니다.
**수정은 하지 않고 불일치만 리포트**합니다.

## 점검 항목

### 1. 권한 매트릭스
- `ROLES.md` 의 역할 키 목록 ↔ `src/types/roles.ts` 유니언
- `ROLES.md` 의 허용 액션 ↔ 라우트의 `requireRole(...)` 호출
- 누락된 가드 탐지

```bash
grep -rn "requireRole" src/
```

### 2. 기술 스택
- `STACK.md` 명시 라이브러리 ↔ `package.json` dependencies
- `wrangler.toml` 의 바인딩 ↔ `Env` 인터페이스 정의
- 언급되지 않은 신규 의존성 감지

### 3. 백로그 ↔ 커밋
- `BACKLOG.md` 의 `done` 항목 번호 ↔ 커밋 메시지 `Refs: #N`
- 커밋은 있지만 백로그에 없는 건 (역방향)
- 백로그 `done` 이지만 커밋 없는 건

```bash
git log --all --oneline | grep -oE "#[0-9]+"
```

### 4. 의사결정
- `DECISIONS.md` 인덱스 ↔ `docs/decisions/` 실제 파일
- 인덱스에 있는데 파일 없는 것, 또는 그 반대
- `superseded-by-NNNN` 참조가 실제 존재하는지

### 5. 알림톡 템플릿
- `templates/알림톡_목록.md` 승인 템플릿 ID ↔ `src/notifications/` 에서 호출되는 ID
- 목록에 없는 템플릿 호출 (위반)
- 변수명 오탈자 (`#{user_name}` vs `#{userName}`)

### 6. 회의 액션 ↔ 백로그
- `MEETING-LOG.md` 인덱스의 "액션 반영" 상태 확인
- 반영 안 된 회의가 1주일 이상 방치되어 있으면 경고

## 출력 형식

```
## /sync-context 결과

### ✅ 일치 (OK)
- ROLES.md ↔ types/roles.ts: 4개 역할 모두 일치
- STACK.md ↔ package.json: 주요 의존성 일치

### ⚠️ 불일치 (REVIEW)
- **라우트 가드 누락**
  - `src/routes/reports.ts:45` — DELETE /reports/:id 에 `requireRole` 없음
  - `ROLES.md` 상 admin 만 가능한 액션
- **백로그 미반영 커밋**
  - `a1b2c3d feat: 세금계산서 내보내기` — BACKLOG 번호 참조 없음

### 🔥 위반 (FIX)
- **미승인 템플릿 호출**
  - `src/notifications/order-confirm.ts:22` 가 `TPL_ORD_003` 호출
  - `templates/알림톡_목록.md` 에 없음 (승인 안 됨 또는 오탈자)

### 권장 조치
1. reports.ts:45 권한 가드 추가 → /plan 또는 직접 수정
2. 미승인 템플릿 호출 즉시 중단 → templates/알림톡_목록.md 확인
3. 최근 커밋 2건을 BACKLOG 소급 등록 → scribe 위임
```

## 원칙

- **리포트 전용** — 자동 수정 금지
- 우선순위: 위반(FIX) > 불일치(REVIEW) > 정보(OK)
- 발견 건이 20개 넘으면 상위 10개만 표시 + "전체 보려면 /sync-context full"
- 정기 실행 권장 (매주 금요일 오후 또는 큰 마일스톤 전)
