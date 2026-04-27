# 의사결정 기록 (ADR Index)

> 각 결정은 `docs/decisions/NNNN-<슬러그>.md` 파일로 저장.
> 이 파일은 인덱스만. 상세는 원본 파일에.
> 템플릿: [`docs/templates/adr.md`](docs/templates/adr.md)

## 결정 목록

| # | 날짜 | 제목 | 상태 | 영향 범위 |
|---|---|---|---|---|

## 상태 값

- `proposed` — 제안됨, 결정 대기
- `accepted` — 승인·적용됨
- `deprecated` — 더 이상 유효하지 않음
- `superseded-by-NNNN` — NNNN 번에 의해 대체됨

---

## 언제 ADR을 써야 하는가

다음과 같이 **되돌리기 어렵거나 광범위한 영향**이 있는 결정에만 작성:

### 필수

- DB 스키마 변경 (테이블 추가·컬럼 타입 변경·제약 변경)
- 인증·권한 모델 변경 (ROLES.md 매트릭스 수정)
- 외부 서비스 추가·교체 (NCP → 다른 서비스, D1 → 다른 DB 등)
- 런타임 플랫폼 변경 (Workers → Pages, CF → AWS 등)
- 중요 라이브러리 도입·교체 (Hono → Express 등)

### 권장

- 새로운 아키텍처 패턴 도입 (이벤트 소싱, CQRS 등)
- 공개 API 변경 (호환성 깨짐)
- 빌드·배포 파이프라인 변경
- 보안 정책 변경 (세션 수명, 토큰 타입 등)

### 불필요

- 일반적인 리팩토링
- 버그 수정
- UI 스타일 변경
- 단일 함수·파일 범위 변경

## ADR 작성 절차

1. 번호 부여: `(현재 최대 번호 + 1)` 을 4자리로 (예: `0005`)
2. 파일 생성: `docs/decisions/NNNN-<슬러그>.md`
3. 템플릿 복사 후 작성
4. 이 인덱스에 한 줄 추가
5. `proposed` 상태로 시작 → 대표님 승인 시 `accepted`
6. 나중에 뒤집히면 `deprecated` 또는 `superseded-by-NNNN`

## 예시 (초기 세팅 시 삭제)

```
| 0001 | 2026-04-18 | Cloudflare Workers + D1 채택 | accepted | 전체 스택 |
| 0002 | 2026-04-18 | 역할 4단계(admin/accountant/asst/viewer) 확정 | accepted | 권한 |
| 0003 | 2026-04-20 | 알림톡 발송 전 템플릿 검증 린터 도입 | proposed | 알림 |
```
