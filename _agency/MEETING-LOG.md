# 회의·통화 기록 인덱스

> 원본 회의록은 `docs/meetings/YYYY-MM-DD-<주제>.md` 에 저장.
> 이 파일은 인덱스·요약·후속 조치 여부만.

## 최근 기록

| 날짜 | 상대 | 주제 | 원본 | 액션 반영 |
|---|---|---|---|---|

## 후속 미반영 (액션 추출이 남은 회의)

| 날짜 | 원본 | 사유 |
|---|---|---|

---

## 표준 워크플로우

### 1. 통화 직후
1. 녹음을 텍스트로 (수동 또는 AI 요약)
2. `docs/meetings/YYYY-MM-DD-<주제>.md` 생성 (템플릿: `docs/templates/meeting-note.md`)
3. 원문·요약·액션 아이템 기록

### 2. 액션 추출
```
/digest-meeting
```
- meeting-digester 에이전트가 회의록을 읽고 `BACKLOG.md` 에 추가할 항목을 제안
- 대표님 확인 후 반영

### 3. 인덱스 갱신
이 파일 `최근 기록` 표에 한 줄 추가:
```
| 2026-04-18 | 정민호 지사장 | 보고서 차감 정책 | docs/meetings/2026-04-18-report-deduction.md | ✅ 5건 |
```

## 주제 태깅 규칙

파일명 주제 슬러그는 다음 중 하나를 우선:
- `sales` — 매출·정산
- `auth` — 권한·인증
- `messaging` — 알림톡·SMS
- `report` — 보고서·출력물
- `infra` — 배포·인프라
- `feature-<이름>` — 특정 기능 논의
- `strategy` — 전략·로드맵

## 참고

회의록 템플릿: [`docs/templates/meeting-note.md`](docs/templates/meeting-note.md)
