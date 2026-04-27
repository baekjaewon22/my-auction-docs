# CONVENTIONS — TypeScript · Cloudflare Workers 프로젝트 템플릿

> ⚠️ **이 파일은 근간이 아니라 특정 스택용 템플릿입니다.**
>
> 언어·스택 중립 원칙은 [PRINCIPLES.md](PRINCIPLES.md).
> 이 파일은 아래 스택의 프로젝트에서만 **그대로 사용 가능**합니다.

## 적용 대상

이 템플릿을 그대로 쓰려면 `STACK.md` 가 다음을 포함해야 합니다:

- [ ] TypeScript 5.x (`strict: true`)
- [ ] Cloudflare Workers / Wrangler
- [ ] Cloudflare D1 (SQLite)
- [ ] Hono 또는 itty-router
- [ ] pnpm
- [ ] Vitest
- (선택) NCP Biz Message, Tiptap

## 적용 대상이 **아닌** 경우

아래 중 하나라도 해당되면 **이 파일을 쓰지 말고 해당 스택용 CONVENTIONS 를 직접 작성**하세요:

- Python / Go / Rust / Ruby / Java / C# 프로젝트
- Next.js / Astro / Remix / SvelteKit 같은 풀스택 프레임워크 프로젝트
- React SPA (Vite·CRA)
- 모바일 앱 (React Native / Flutter / Swift / Kotlin)
- AWS Lambda / Vercel Functions / Supabase Edge Functions
- CLI 도구 / 데스크톱 앱 / 게임
- n8n · Zapier · Make 같은 no-code 자동화 워크플로우
- 정적 사이트 / 블로그 (Hugo, Jekyll 등)

## 사용법

```bash
# 적용 대상이면 복사해서 사용
cp CONVENTIONS.template.md CONVENTIONS.md
# 그 후 CONVENTIONS.md 를 이 프로젝트 세부에 맞게 편집·다이어트

# 적용 대상이 아니면 삭제
rm CONVENTIONS.template.md
```

어떤 경우에도 [PRINCIPLES.md](PRINCIPLES.md) 는 유지합니다.

---

## 네이밍 (TypeScript · JS 생태계 관용)

| 대상 | 규칙 | 예시 |
|---|---|---|
| 파일 | kebab-case | `user-service.ts` |
| 디렉토리 | kebab-case | `src/notifications/` |
| 타입·인터페이스·클래스 | PascalCase | `UserProfile`, `OrderStatus` |
| 함수·변수 | camelCase | `sendBizMessage`, `userId` |
| 상수 | UPPER_SNAKE_CASE | `MAX_RETRY_COUNT` |
| DB 테이블·컬럼 | snake_case | `user_profiles`, `created_at` |
| 환경변수 | UPPER_SNAKE_CASE | `NCP_API_KEY` |
| React 컴포넌트 | PascalCase.tsx | `BillingTable.tsx` |

> Python·Go·Rust 프로젝트는 각 언어 관용을 따르세요. (원칙 #1)

## TypeScript

- `strict: true` 고정
- `any` 금지. 불가피하면 주석으로 사유 명시
- `as any`, `// @ts-ignore`, `// @ts-expect-error` 남용 금지
- 공통 타입은 `src/types/` 에 모음
- DB 스키마 → 타입 방향이 원칙 (역방향 금지)
- `import type { ... }` 로 타입 전용 import 구분

## Cloudflare Workers

- 환경변수: `wrangler.toml` 의 `[vars]`
- 비밀: `wrangler secret put <키>` (소스에 절대 쓰지 않음)
- 바인딩 타입: `Env` 인터페이스에 집결 (`src/types/env.ts`)
- `fetch(request, env, ctx)` 시그니처 유지

## D1

- 마이그레이션: `migrations/NNNN_동사-목적.sql`
  - 예: `migrations/0003_add-refund-flag.sql`
- 외래키: `REFERENCES ... ON DELETE <정책>` 명시
- 인덱스: 마이그레이션 파일 내 `CREATE INDEX` 로 동시 생성
- 제약조건: 컬럼 옆에 인라인 (`CHECK`, `NOT NULL`, `UNIQUE`)

## 커밋 메시지 (Conventional Commits 변형)

```
<type>: <50자 이내 요약>

- 무엇을: 
- 왜: 

Refs: #<BACKLOG 번호>
```

**type** 값:

| type | 언제 |
|---|---|
| feat | 새 기능 |
| fix | 버그 수정 |
| refactor | 동작 변화 없는 구조 개선 |
| chore | 설정·의존성·잡일 |
| docs | 문서만 |
| test | 테스트만 |
| perf | 성능 개선 |
| style | 포맷·들여쓰기 |

> 팀이 다른 커밋 규칙(Gitmoji, 자유 문장 등)을 쓰면 이 섹션을 교체하세요.

## Pull Request

- **제목**: `[<사업체>] <한 줄 요약>`
- **본문**:
  ```
  ## 요약
  
  ## 변경 사항
  - 
  
  ## 테스트 방법
  - [ ] 
  
  ## 위험·주의
  - 
  
  ## 스크린샷 (UI 변경 시)
  ```

## 테스트

- 파일명: `<대상>.test.ts`
- 테스트 이름: `<대상>가 <조건>일 때 <결과>`
- 외부 API (NCP, Cloudflare) 는 기본 mock
- 실제 호출 테스트는 파일명에 `.integration.test.ts`

## 파일 조직 (Workers + Hono 기본)

```
src/
├── routes/          ← Hono/Workers 라우트 핸들러
├── services/        ← 비즈니스 로직
├── db/              ← D1 쿼리 함수
├── notifications/   ← 알림톡·이메일
├── types/           ← 공통 타입
├── utils/           ← 순수 유틸리티
└── index.ts         ← Worker 엔트리
```

> UI 가 포함된 프로젝트면 `ui/` 또는 `web/` 디렉토리를 별도로.

## 팀 가이드라인 (권고, 절대 금지는 아님)

- 단일 함수가 100줄을 넘으면 쪼갤 이유를 검토
- 3단계 이상 중첩 try/catch 는 평탄화·Result 패턴 검토
- 전역 변수는 `Env` 바인딩 외 지양

---

> **이 템플릿을 복사한 뒤:** 이 섹션 상단의 경고·적용 조건·사용법 섹션을 삭제하고
> 프로젝트 고유 관례를 추가하세요.
