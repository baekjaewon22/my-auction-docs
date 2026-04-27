---
description: 새 프로젝트 기본 파일(PROJECT·STACK·ROLES·GLOSSARY)을 대화형으로 채움
---

# /kickoff — 새 프로젝트 시작

이 명령은 `_agency` 부트스트랩을 새 프로젝트에 맞게 초기화합니다.

## 실행 절차

### 1. 환경 확인
```bash
ls -la
```
현재 디렉토리가 `_agency` 복사본인지 확인. 아니면 경고.

### 2. 파일 순서대로 채우기

아래 순서로 각 파일을 열고, `<!-- ... -->` 주석이 붙은 빈 필드만 사용자에게 물어서 채운다.
사용자가 "기본으로", "스킵", "나중에" 라고 하면 해당 섹션을 건드리지 말고 넘어간다.

1. **`PROJECT.md`** (필수)
   - 프로젝트 이름
   - 한 줄 정의
   - 소속 사업체 (마이옥션 / 파티핏 / 세븐스타즈 / 신규)
   - 목표 3개 이하
   - 이해관계자

2. **`STACK.md`** (선택, 기본 스택이 맞으면 스킵)
   - "이 프로젝트에서 달라지는 점" 섹션만 질문
   - 안 다르면 그대로 유지

3. **`ROLES.md`** (권한 모델이 필요한 프로젝트만)
   - 이 프로젝트에 적용되는 역할 목록
   - 기본 4단계(admin/accountant/asst/viewer)가 맞는지 확인
   - 다르면 매트릭스 수정

4. **`GLOSSARY.md`** (도메인 용어가 있으면)
   - "이 프로젝트 고유 용어" 섹션에 3~5개만 먼저

### 3. CONVENTIONS 처리 (중요)

`STACK.md` 가 확정된 뒤:

- **TypeScript + Cloudflare Workers** 스택이면 템플릿 복사:
  ```bash
  cp CONVENTIONS.template.md CONVENTIONS.md
  ```
  그 후 `CONVENTIONS.md` 상단 경고·적용 조건 섹션을 삭제하고 프로젝트 고유 관례만 남깁니다.

- **다른 스택**(Python, Go, Next.js, Astro, 자동화, 정적 사이트 등) 이면 삭제:
  ```bash
  rm CONVENTIONS.template.md
  ```
  해당 스택용 `CONVENTIONS.md` 를 직접 작성할지 사용자에게 질문.

- **관례가 필요 없는 소규모 프로젝트**(스크립트·1회성 자동화) 면 `CONVENTIONS.md` 없이 `PRINCIPLES.md` 만으로 운영.

### 4. 부수 작업

- `BACKLOG.md`, `MEETING-LOG.md`, `DECISIONS.md` 는 빈 상태 그대로 유지
- 예시 행이 있으면 삭제 제안
- `PRINCIPLES.md`, `DO-NOT.md` 는 기본 그대로 유지 (근간·금지사항은 프로젝트 무관)

### 5. 완료 보고

```
## /kickoff 완료

### 채운 파일
- PROJECT.md ✅ 
- STACK.md — 변경 없음 (기본 스택 그대로)
- ROLES.md ✅ 
- GLOSSARY.md ✅ 3개 용어 추가

### 비워둔 필드 (나중에 채울 것)
- PROJECT.md: 핵심 지표, 마일스톤

### 추천 다음 단계
1. /plan — 첫 기능 계획 세우기
2. git init && git add . && git commit -m "chore: 초기 셋업"
```

## 원칙

- 한 번에 모든 질문을 쏟아내지 말 것 (섹션 단위로 하나씩)
- 사용자가 대답한 값은 즉시 파일에 반영 (대화 끝에 한꺼번에 쓰지 말 것)
- 기본값이 명확한 필드는 기본값을 먼저 제시 → "이대로 쓸까요?"
- 5분 이내 완료되도록 최소 필수 질문만
