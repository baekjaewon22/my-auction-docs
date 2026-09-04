# 경매 일정 공개 API (외부 연동용)

my-docs 경매 입찰 일정을 외부 사이트에 read-only로 제공하는 API입니다. 직접 등록한
입찰 일정뿐 아니라 비동행 임장 일정의 `bidDate`(입찰기일)에서 파생된 입찰 일정도 포함합니다.

## 엔드포인트

```
GET https://my-docs.kr/api/public/calendar
```

## 인증

모든 요청에 발급받은 API 키를 헤더로 실어 보냅니다.

```
X-API-Key: <발급받은 키>
```

- 키는 **서버 사이드(PHP)에서만** 사용하세요. 브라우저(프런트 JS)에 넣으면 누구나 데이터를 조회할 수 있습니다.
- 키가 없거나 틀리면 `401 { "ok": false, "error": "Unauthorized" }`.

## 요청 파라미터 (선택)

| 파라미터 | 형식 | 설명 |
| --- | --- | --- |
| `from` | `YYYY-MM-DD` | 조회 시작일. 미지정 시 당월 1일 |
| `to` | `YYYY-MM-DD` | 조회 종료일. 미지정 시 `from`+31일 |

- 조회 범위는 **최대 92일**로 제한됩니다(초과 시 자동으로 92일까지만).
- 날짜 형식이 틀리면 `400`.

## 응답 (200)

```json
{
  "ok": true,
  "count": 2,
  "fetched_at": "2026-09-01T04:00:29.246Z",
  "from": "2026-08-01",
  "to": "2026-08-31",
  "events": [
    {
      "eventId": "auction-bid:0f12d9d0-0000-4000-8000-111111111111",
      "updatedAt": "2026-08-10 14:22:31",
      "date": "2026-08-10",
      "assignee": "최병철",
      "activity_type": "입찰",
      "result": "won",
      "caseNo": "2025타경5108",
      "court": "부산지방법원 동부지원",
      "place": "",
      "clientName": "최순호",
      "propertyType": "아파트"
    }
  ]
}
```

### 필드

| 필드 | 의미 |
| --- | --- |
| `eventId` | 외부 동기화용 안정 식별자. 파생 입찰은 보통 `auction-bid:inspection-bid:<임장 원본 ID>`, 일반 직접 입찰은 `auction-bid:<입찰 원본 ID>` 형식입니다. |
| `updatedAt` | 병합된 모든 원본 일정 중 가장 최근 변경 시각 |
| `date` | 입찰기일 (YYYY-MM-DD) |
| `assignee` | 담당자 |
| `activity_type` | 활동 유형 (현재 `입찰`) |
| `result` | 입찰결과 — `pending`(예정) / `won`(낙찰) / `failed`(패찰) / `cancelled`(취소) / `withdrawn`(취하) |
| `caseNo` | 사건번호 |
| `court` | 법원 |
| `place` | 장소 (값이 없을 수 있음) |
| `clientName` | 계약자명 |
| `propertyType` | 세부 물건종류(예: `아파트`, `다세대`). 세부분류가 없으면 `미분류`이며 `주거시설` 같은 대분류는 제공하지 않습니다. |

> 전화번호·입찰가·메모 등 그 외 정보는 응답에 포함되지 않습니다.

## 오류 응답

| 상태 | 본문 | 원인 |
| --- | --- | --- |
| 400 | `{ "ok": false, "error": "from must be YYYY-MM-DD" }` | 날짜 형식 오류 |
| 401 | `{ "ok": false, "error": "Unauthorized" }` | API 키 없음/불일치 |
| 500 | `{ "ok": false, "error": "CALENDAR_API_KEY not configured" }` | 서버 키 미설정 |

## PHP 예제 (서버 사이드)

```php
<?php
$KEY  = getenv('CALENDAR_API_KEY'); // 키는 코드에 하드코딩하지 말고 환경변수/설정에 보관
$from = '2026-08-01';
$to   = '2026-08-31';
$url  = 'https://my-docs.kr/api/public/calendar?from=' . urlencode($from) . '&to=' . urlencode($to);

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER     => ['X-API-Key: ' . $KEY],
    CURLOPT_TIMEOUT        => 15,
]);
$body = curl_exec($ch);
$code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($code !== 200) {
    // 401/400/500 처리
    error_log("calendar api error: $code $body");
    $events = [];
} else {
    $data   = json_decode($body, true);
    $events = $data['events'] ?? [];
}

foreach ($events as $e) {
    // $e['date'], $e['assignee'], $e['result'], $e['caseNo'],
    // $e['court'], $e['place'], $e['clientName'], $e['propertyType']
    echo htmlspecialchars($e['date'] . ' ' . $e['court'] . ' ' . $e['caseNo']) . "\n";
}
```

## 참고

- API 키로 조회한 계약자명이 공유 캐시에 남지 않도록 `Cache-Control: private, no-store`로 응답합니다.
- `from`~`to` 응답은 해당 범위의 **전체 스냅샷**입니다. 외부 시스템은 `events`를
  기존 데이터에 단순 추가하지 말고, 같은 조회 범위의 목록을 통째로 교체하세요.
  이전 응답에 있던 `eventId`가 새 응답에서 사라졌다면 삭제된 일정으로 처리합니다.
- 직접 입찰과 비동행 임장의 입찰기일이 담당자·입찰일·법원·사건번호 기준으로 같고
  물건번호도 호환되면 내부 캘린더와 동일하게 한 건으로 병합합니다. 이때 직접 입찰의 값과
  일반 직접 입찰의 `eventId`가 우선합니다. 직접 입찰에 비어 있는 허용 필드는 임장 원본
  값으로 보완될 수 있고, `updatedAt`은 어느 병합 원본이든 바뀌면 갱신됩니다.
- 파생 입찰만 있는 동안부터 실제 입찰 행의 결정적 ID 형식인
  `auction-bid:inspection-bid:<임장 원본 ID>`를 사용합니다. 이후 서버가 실제 입찰 행을
  자동 생성하여 같은 이벤트로 병합하거나 원본 임장이 제거되어도 `eventId`는 유지됩니다.
- 드물게 실제 입찰 행이 남은 상태에서 원본 임장의 사건번호나 입찰기일이 변경되어 두
  일정이 서로 다른 이벤트로 분리되면 실제 입찰의 기존 ID를 보존합니다. 새 파생 이벤트는
  조회 범위 밖에 실제 입찰이 있더라도 충돌하지 않도록
  `auction-bid-projection:<임장 원본 ID>`를 사용합니다. 따라서 한 응답의 `eventId`는 항상
  고유하고, 같은 DB 상태에서는 조회 순서와 관계없이 결정적입니다.
- 동행 임장과 입찰기일이 조회 범위 밖인 임장은 제공하지 않습니다. API의 모든 이벤트는
  `activity_type: "입찰"`로 반환됩니다.
- 키 회전이 필요하면 my-docs 운영자에게 요청하세요(새 키로 교체 후 전달).
