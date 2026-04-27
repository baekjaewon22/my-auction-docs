# 기술 스택

> 대표님의 기본 스택이 프리셋되어 있습니다.
> 이 프로젝트에서 달라지는 부분만 표시하세요.

## 런타임·배포

- **Cloudflare Workers** — 서버리스 실행 환경
- **Cloudflare D1** — SQLite 기반 DB
- **Cloudflare R2** — 오브젝트 스토리지 (선택)
- **Cloudflare Pages** — 정적 사이트 (선택)
- **Wrangler CLI** — `wrangler.toml` 기반 설정·배포

## 언어·프레임워크

- **TypeScript 5.x** (strict: true)
- **Hono** 또는 itty-router — Workers용 라우팅
- **React 18+** — 프론트엔드 필요 시
- **Tiptap** — 리치 에디터 필요 시 (예: 물건분석보고서 A4 HTML)

## 데이터 계층

- **schema.sql** — D1 DDL 원본
- **schema.ts** — 타입 정의 미러 (schema.sql 기준으로 파생)
- **Drizzle ORM** — 선택 (타입 세이프 쿼리 필요 시)
- **마이그레이션** — `migrations/NNNN_설명.sql` 순차 번호

## 인증·권한

- 세션 기반 (쿠키) 또는 JWT
- `src/types/roles.ts` — 역할 타입 유니언
- 라우트 가드: `requireRole('accountant')` 형태 미들웨어

## 알림·메시징

- **NCP Biz Message** (`ncp_bizmessage.config.ts`)
- **카카오채널 알림톡** (승인 템플릿만 발송)
- **템플릿 관리**: `templates/알림톡_목록.md` (승인된 템플릿 ID·변수명)
- **대체 발송**: 알림톡 실패 시 SMS 폴백

## 개발 도구

- **pnpm** — 패키지 매니저 (`pnpm-lock.yaml`)
- **Vitest** — 단위·통합 테스트
- **Playwright** — E2E (선택)
- **Biome** 또는 Prettier — 포맷
- **TypeScript Language Server** — 에디터 자동완성

## 이 프로젝트에서 달라지는 점

<!-- 기본 스택과 다른 부분을 여기에 -->

## 쓰지 않는 것 (의도적 배제)

<!-- 예: "Next.js는 Workers에서 제약이 많아 사용 안 함" -->
