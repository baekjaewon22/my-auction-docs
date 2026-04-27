---
description: 현재 요청을 planner 에이전트로 실행 계획화
---

# /plan — 작업 계획 수립

`planner` 에이전트를 호출해 사용자의 최근 요청을 실행 계획으로 분해합니다.

## 실행 절차

### 1. 컨텍스트 확인
- `BACKLOG.md` 읽기 (중복·충돌)
- `ROLES.md` 읽기 (권한 영향)
- `DECISIONS.md` 읽기 (과거 결정과 충돌 여부)

### 2. planner 에이전트 호출
- 사용자의 최근 메시지를 질문으로 전달
- planner 가 계획을 반환

### 3. 결과 출력
planner 출력을 그대로 보여주고 **"진행할까요?"** 로 끝낸다.

### 4. 금지
- 사용자 확인 **전**에 구현 시작 금지
- 계획 없이 50줄 이상 변경 시작 금지

## 옵션

- `/plan quick` — 5분 내 끝나는 소규모 작업 계획 (간략 버전)
- `/plan full` — 설계까지 포함 (architect 위임 제안)

## 예시

**사용자**: `/plan 매출 삭제 시 승인 게이트`

**출력**:
```
## 계획: 매출 삭제 시 승인 게이트 추가

### 한 줄 정의
accountant 역할의 매출 삭제 요청을 pending_approvals 로 라우팅

### 영향 파일
- src/routes/sales.ts
- src/types/roles.ts (검증만)
- migrations/NNNN_add-pending-approvals.sql

### 단계
1. pending_approvals 테이블 마이그레이션 (30분)
2. DELETE /sales/:id 라우트 분기 (45분)
3. 승인·거부 API 추가 (1시간)
4. 테스트 (30분)

### 권한 영향
- ROLES.md #5 "매출 삭제 admin/accountant" 에서 accountant 는 승인 필요로 변경
- ADR 0004 작성 필요

### 필요한 결정
- 승인자 지정 규칙? (모든 admin 에게 알림 vs 특정 1명)

### 완료 기준
- [ ] 테이블 생성, 마이그레이션 통과
- [ ] 3개 테스트 모두 pass
- [ ] UI 에 승인 대기 뱃지 노출 (별도 작업)

진행할까요?
```
