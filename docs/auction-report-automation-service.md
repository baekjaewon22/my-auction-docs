# Auction Report Automation Service Integration

## Purpose

The existing `auction-report-web` Python engine must remain the source of truth for parsing, Selenium automation, OCR, capture processing, PPT/PDF generation, output downloads, and the 20-item download history behavior.

Do not rewrite the automation engine in Java during this phase. The target architecture is:

```text
React
  -> Java Backend
    -> Python Automation Service
      -> Selenium / OCR / PPT / PDF / Output
```

The Java Backend owns login, session, user identity, authorization, and screen-facing APIs. The Python Automation Service owns everything from MyAuction URL processing through final output file generation.

## Service Boundary

### Java Backend Responsibilities

- Use the target site's existing login/session flow.
- Resolve the current user and their document-generation permission.
- Enforce permission before calling Python:
  - `basic`: briefing materials only.
  - `special`: briefing materials and rights analysis certificates.
- Collect MyAuction credentials and author profile values from the target site's storage or form input.
- Call the Python Automation Service through internal HTTP.
- Proxy or relay progress, result, download, and history responses to React.
- Keep Python service URLs and credentials server-side only.

### Python Automation Service Responsibilities

- Normalize and parse MyAuction case URLs.
- Log in to MyAuction using the provided MyAuction credentials.
- Run Selenium browser automation.
- Extract case data.
- Process documents, PDFs, OCR, and captures.
- Fill the existing PPT/PDF templates.
- Generate briefing material outputs.
- Generate rights analysis certificate outputs.
- Run rights-certificate multi-URL batch/scheduled jobs.
- Store and serve output files.
- Keep the latest 20 download history entries.

## Existing Python Service

Use the copied FastAPI app under:

```text
automation-service/backend/app/main.py
```

It already mounts the automation API under `/api`.

Recommended internal base URL:

```text
http://127.0.0.1:8000/api
```

Health check:

```http
GET /api/health
```

## API Contract

Keep these endpoint names and payload shapes so the existing React flow can be ported with minimal behavior changes.

### Start Single Report

```http
POST /api/report/start
Content-Type: application/json
```

For briefing materials, Java Backend must send this JSON shape:

```json
{
  "output_type": "auction_report",
  "url": "https://www.my-auction.co.kr/view/사건번호",
  "myauction_id": "마이옥션아이디",
  "myauction_pw": "마이옥션비밀번호",
  "remember_login": true,
  "author_name": "가입자 성명",
  "author_title": "직책",
  "author_phone": "전화번호",
  "requester_role": "user",
  "requester_permission": "basic"
}
```

Default briefing output file name:

```text
브리핑자료_{사건번호}.pptx
```

The Python service derives `{사건번호}` from the parsed MyAuction detail data. If parsing does not return a case number, it falls back to the task id or current timestamp.

PDF download must use the same case-number stem when conversion is available:

```text
브리핑자료_{사건번호}.pdf
```

Java should request the PDF through:

```http
GET /api/report/download/{taskId}?format=pdf
```

The Python service resolves an existing sibling PDF first. If only PPTX/PPTM exists, it attempts conversion through the existing PowerPoint/PDF conversion path.

For a single rights analysis certificate, Java Backend must send this JSON shape:

```json
{
  "output_type": "rights_certificate",
  "url": "https://www.my-auction.co.kr/view/사건번호",
  "myauction_id": "마이옥션아이디",
  "myauction_pw": "마이옥션비밀번호",
  "remember_login": true,
  "author_name": "가입자 성명",
  "author_title": "직책",
  "author_phone": "전화번호",
  "requester_role": "user",
  "requester_permission": "special"
}
```

Rights analysis certificates can only be generated when `requester_permission` is `special`.

Rights certificate output files:

```text
권리분석_보증서_{사건번호}.pdf
권리분석_보증서_{사건번호}.pptx
```

Response:

```json
{
  "task_id": "abcd1234"
}
```

### Start Rights Certificate Batch

```http
POST /api/report/start-batch
Content-Type: application/json
```

```json
{
  "output_type": "rights_certificate",
  "urls": [
    "https://www.my-auction.co.kr/view/1111111",
    "https://www.my-auction.co.kr/view/2222222"
  ],
  "myauction_id": "마이옥션아이디",
  "myauction_pw": "마이옥션비밀번호",
  "remember_login": true,
  "author_name": "가입자 성명",
  "author_title": "직책",
  "author_phone": "전화번호",
  "requester_role": "user",
  "requester_permission": "special",
  "start_at": "",
  "interval_seconds": 5
}
```

Batch behavior:

- Only `rights_certificate` is supported for batch generation.
- `requester_permission` must be `special`.
- URLs are processed sequentially in the order received.
- After one item finishes, the service waits `interval_seconds` seconds before starting the next URL.
- If `start_at` is an empty string, processing starts immediately.
- If multiple outputs are completed, the Python service creates a ZIP file.
- Java should download the ZIP through:

```http
GET /api/report/download/{taskId}?format=zip
```

Response:

```json
{
  "task_id": "abcd1234"
}
```

### Poll Progress

```http
GET /api/report/progress/{taskId}
```

Response:

```json
{
  "task_id": "abcd1234",
  "updates": [
    {
      "step": 1,
      "total_steps": 6,
      "title": "사이트 파싱",
      "message": "데이터 추출 중...",
      "status": "running",
      "percent": 15
    }
  ]
}
```

Status values:

```text
running | completed | error
```

### WebSocket Progress

```text
WS /api/ws/progress/{taskId}
```

React can either poll through Java or let Java expose its own WebSocket/SSE that relays Python updates.

### Download Current Task Output

```http
GET /api/report/download/{taskId}?format=pptx
GET /api/report/download/{taskId}?format=pdf
GET /api/report/download/{taskId}?format=zip
```

### Download History

```http
GET /api/report/download-history
GET /api/report/download-history/{historyId}?format=pptx
GET /api/report/download-history/{historyId}?format=pdf
GET /api/report/download-history/{historyId}?format=zip
```

History is limited to 20 items by the Python service.

## Java Backend Adapter Rule

The Java Backend should not duplicate parsing or document-generation logic. It should validate and enrich requests, then forward them.

Recommended Java-facing endpoints:

```text
POST /api/document-generation/report/start
POST /api/document-generation/report/start-batch
GET  /api/document-generation/report/progress/{taskId}
GET  /api/document-generation/report/download/{taskId}
GET  /api/document-generation/report/download-history
GET  /api/document-generation/report/download-history/{historyId}
```

The Java controller can keep target-site route names, but the forwarded Python payload must preserve:

```text
output_type
url / urls
myauction_id
myauction_pw
remember_login
author_name
author_title
author_phone
requester_role
requester_permission
start_at
interval_seconds
```

## Permission Mapping

Python currently checks:

```text
requester_permission == "special"
```

For the target site, prefer explicit `requester_permission`:

```text
basic   -> briefing materials only
special -> briefing materials + rights analysis certificate
```

If the target site has admin users who should generate rights analysis certificates, Java must still send `requester_permission: "special"` for those users.

## Local Run

Run only the Python Automation Service:

```powershell
.\scripts\start-auction-automation-service.ps1
```

Default service URL:

```text
http://127.0.0.1:8000/api/health
```

Manual equivalent:

```powershell
cd automation-service\backend
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

## Operational Notes

- The Python service must run on a host where Chrome, Selenium, OCR, Poppler, PowerPoint/PPT conversion dependencies, and the existing templates are available.
- Keep generated files on the Python service filesystem unless a shared storage layer is added later.
- Java should stream download responses from Python to React instead of trying to reinterpret files.
- If multiple Python workers are introduced, progress and history storage must move from in-memory/local config to shared storage. Until then, route each task to the same Python instance that started it.
- Preserve `auction-report-web/backend/templates` exactly unless the user explicitly asks for template changes.

## Migration Checklist

- Confirm Java project path.
- Add Java configuration for `automation.base-url`.
- Add Java DTOs matching the Python request/response schema.
- Add Java permission mapping for `basic` and `special`.
- Add Java proxy endpoints for start, progress, download, and history.
- Move React blank pages to the original form/progress/result/history flow.
- Verify briefing output against the original app.
- Verify rights certificate PPT/PDF output against the original app.
- Verify batch ZIP output and 20-item history behavior.
