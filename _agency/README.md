# _agency — Claude Code 부트스트랩 키트

새 프로젝트를 시작할 때 이 폴더를 복사해 즉시 가동 가능한 "에피타이저" 기반으로 사용합니다.
에이전트 팀, 슬래시 커맨드, 근간이 되는 MD 파일들이 미리 세팅되어 있어
프로젝트마다 반복되는 초기 설정 비용을 제거합니다.

## 언제 쓰나

- 새로운 코드베이스를 시작할 때 (웹사이트, 자동화, API 등 종류 무관)
- 기존 프로젝트를 정돈할 때 (MD 파일만 가져다 씀)
- 팀/에이전트 협업 규칙을 한 번에 주입할 때

## 쓰는 방법

### A안: 통째로 복사 (권장)

```bash
cp -r C:/Users/pdragon/git/_agency C:/Users/pdragon/git/<새-프로젝트명>
cd C:/Users/pdragon/git/<새-프로젝트명>
rm -rf .git 2>/dev/null; git init
claude
```

Claude Code 진입 후:

```
/kickoff
```

PROJECT.md, STACK.md, ROLES.md, GLOSSARY.md 를 대화형으로 채웁니다.

### B안: MD만 가져오기

기존 프로젝트에 이 MD 파일들만 추가:

```bash
cp C:/Users/pdragon/git/_agency/*.md .
cp -r C:/Users/pdragon/git/_agency/.claude .
cp -r C:/Users/pdragon/git/_agency/docs/templates ./docs/
```

## 폴더 구조

```
_agency/
├── README.md                    ← 이 파일 (사용법)
├── CLAUDE.md                    ← Claude Code 자동 로드: 공통 규칙/체크리스트
├── PROJECT.md                   ← 프로젝트 목표·범위·이해관계자 (비어있음)
├── STACK.md                     ← 기술 스택 (대표님 기본 스택 프리셋)
├── ROLES.md                     ← 권한 매트릭스 (accountant/asst 예시)
├── PRINCIPLES.md                ← 언어·스택 중립 근간 원칙 (항상 적용)
├── CONVENTIONS.template.md      ← TypeScript + CF Workers 스택용 관례 템플릿
├── BACKLOG.md                   ← 업무요구사항 누적 백로그
├── MEETING-LOG.md               ← 회의·통화 기록 인덱스
├── DECISIONS.md                 ← ADR(의사결정) 인덱스
├── GLOSSARY.md                  ← 도메인 용어집
├── DO-NOT.md                    ← 금지사항
├── docs/
│   ├── meetings/                ← 회의록 원본 저장 (YYYY-MM-DD-주제.md)
│   ├── decisions/               ← ADR 원본 저장 (NNNN-슬러그.md)
│   └── templates/
│       ├── meeting-note.md      ← 회의록 템플릿
│       ├── adr.md               ← ADR 템플릿
│       └── feature-spec.md      ← 기능 명세 템플릿
└── .claude/
    ├── agents/                  ← 에이전트 팀 정의 (8개)
    │   ├── planner.md
    │   ├── researcher.md
    │   ├── architect.md
    │   ├── implementer.md
    │   ├── reviewer.md
    │   ├── tester.md
    │   ├── scribe.md
    │   └── meeting-digester.md
    └── commands/                ← 슬래시 커맨드 (6개)
        ├── kickoff.md
        ├── plan.md
        ├── digest-meeting.md
        ├── review.md
        ├── status.md
        └── sync-context.md
```

## 에이전트 팀 개요

| 에이전트 | 역할 | 언제 호출 |
|---|---|---|
| **planner** | 작업 분해·계획 수립 | 새 기능 착수 직전, 범위 불명확 |
| **researcher** | 탐색·조사 (수정 X) | 코드/외부 정보 파악 필요 |
| **architect** | 설계·트레이드오프·ADR | 데이터 모델/구조 결정 |
| **implementer** | 실제 코드 작성 | 계획 승인 후 구현 |
| **reviewer** | 품질·보안·권한 리뷰 | 변경 직후 |
| **tester** | 테스트 설계·실행 | 변경 후 검증 |
| **scribe** | 문서·커밋·PR 초안 | 마무리 단계 |
| **meeting-digester** | 회의록→백로그 액션 | 통화/회의 직후 |

## 슬래시 커맨드

| 명령 | 설명 |
|---|---|
| `/kickoff` | 새 프로젝트 기본 파일(PROJECT·STACK·ROLES·GLOSSARY)을 대화형으로 채움 |
| `/plan` | 최근 요청을 planner 에이전트로 계획화 |
| `/digest-meeting` | 회의록 파일을 읽어 BACKLOG 항목 제안 |
| `/review` | 현재 변경(git diff)을 reviewer로 점검 |
| `/status` | 목표·백로그·회의·ADR·git을 한눈에 |
| `/sync-context` | ROLES.md ↔ types/roles.ts 등 문서·코드 일관성 점검 |

## 표준 작업 흐름 (권장)

```
1. /kickoff             ← 프로젝트 세팅
2. /digest-meeting      ← 통화 요약 반영 (필요 시)
3. /plan                ← 오늘 할 일 계획
4. (implementer 또는 직접 구현)
5. /review              ← 리뷰 통과
6. tester → scribe      ← 테스트·커밋
7. /status              ← 진행 상황 점검
```

## 주의

- 이 키트는 **개인용 부트스트랩**입니다. 다른 사람에게 공유할 때 대표님 프로필·회사 정보가 남은 CLAUDE.md 는 삭제하세요.
- 프로젝트마다 독립 copy 가 원칙. 공유 원본을 직접 수정하지 말 것.
- 키트 업데이트 시: `_agency` 원본을 수정 → 새 프로젝트부터 반영. 기존 프로젝트는 선택적 동기화.

## 라이선스
개인 사용. 관련자 외 공유 금지.
