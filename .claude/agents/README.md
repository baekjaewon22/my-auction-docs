# my-auction-docs 도메인 에이전트

`_agency/.claude/agents/` 의 **generic 에이전트(architect/implementer/...)** 와 짝을 이루는 **이 프로젝트 전용 도메인 에이전트** 입니다.
세션 시작 시 Claude Code가 자동 로드하며, 작업 종류에 따라 적절한 에이전트로 위임합니다.

## 에이전트 목록

| 에이전트 | 책임 | 호출 케이스 |
|---|---|---|
| **drive-backup** | Google Drive 자동 백업 (OAuth/Puppeteer/Cron/Print) | 백업 cron 변경, 새 문서 유형 백업, OAuth 디버깅, 인쇄 레이아웃 |
| **approval-flow** | 결재선·서명·직인·proxy 승인 | 결재선 라우팅, 서명 누락 백필, CEO 직인 매칭, 다단계 승인 버그 |
| **business-domain** | 매출/카드/회계/급여/휴가/사업소득 | 도메인 비즈니스 규칙(반차 0.5, 비율제, 환급금) 변경 |
| **journal-analytics** | 일지·통계·이상감지·계약관리 | 일지 활동 집계, 30일 이상감지, 통계 차트 추가 |
| **frontend-mobile** | React + 모바일 반응형 UX | 모바일 레이아웃 깨짐, 클릭 무반응, 더블서브밋 가드 |
| **permission-roles** | role 매트릭스 3계층 일관성 | 권한 추가/변경, 직책 신설, 사용자 ID 예외 |
| **infra-deploy** | Cloudflare Workers + D1 + Cron + 알림톡 | wrangler 설정, 마이그레이션, 시크릿, 배포 검증 |

## generic vs 도메인 에이전트

| 상황 | generic 우선 | 도메인 우선 |
|---|---|---|
| "결재선 어떻게 되어 있어?" | researcher | approval-flow |
| "drive 백업 cron 시간 바꿔줘" | implementer | drive-backup |
| "총무보조 권한 정리해줘" | researcher | permission-roles |
| "전체 설계 검토" | architect | (보조로 도메인 에이전트) |
| "신규 결재 라우팅 ADR" | architect → implementer | approval-flow + permission-roles |

**총괄 assistant(메인)** 가 작업 성격을 보고:
- 코드베이스 **탐색·이해** 가 핵심이면 → generic researcher
- **이 프로젝트 도메인 지식**이 필요하면 → 해당 도메인 에이전트
- **설계·결정** 이 핵심이면 → architect (도메인 에이전트가 컨텍스트 제공)
- **구현** 이면 → implementer (도메인 에이전트의 산출물 참고)

## 호출 예시

```
"결재선에 새로운 부서장을 추가하려는데 어떻게 해야 해?"
→ approval-flow 에이전트 (buildApprovalChain · org_nodes · role 분석)

"매출 모바일 카드뷰에서 환불 표시가 빠져 있어"
→ frontend-mobile + business-domain (둘 다 필요할 수 있음)

"Drive 백업 PDF에 회사 로고 워터마크 넣고 싶어"
→ drive-backup (Print.tsx 수정)

"accountant_asst가 카드내역 수정도 못 하게 해줘"
→ permission-roles (3계층 일관성 점검)
```

## 갱신 정책

- **새 도메인 등장** → 새 에이전트 추가 (예: 채팅 모듈, 외부 API 통합 등)
- **기존 에이전트 영역 확장** → 해당 .md 의 "핵심 파일·도메인 지식" 섹션 업데이트
- **함정·교훈** 이 새로 발견되면 즉시 "자주 만나는 함정" 섹션에 추가 (다음 세션이 같은 실수 안 하도록)
- 분기마다 1회 리뷰: 사용된 적 없는 에이전트는 제거 검토
