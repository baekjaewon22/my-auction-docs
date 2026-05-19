# All For One API Integration

Base URL: `https://my-docs.kr/api`

Authentication:

```http
Authorization: Bearer <MY_DOCS_SERVICE_TOKEN_READ>
```

Alternative:

```http
X-Service-Token: <MY_DOCS_SERVICE_TOKEN_READ>
```

Service token scopes:

- `read`: `GET`, `HEAD`, `OPTIONS`
- `write`: `GET`, `HEAD`, `OPTIONS`, `POST`, `PUT`, `PATCH`
- `admin`: all common HTTP methods including `DELETE`

Service tokens are for API calls only. They must not be used to bypass user login for HTML admin pages.

## Embed

```http
GET /embed/config
```

Returns:

```json
{
  "allowed": true,
  "frame_ancestors": ["'self'", "http://127.0.0.1:5173", "http://127.0.0.1:5174"],
  "pages": ["/users", "/accounting", "/payroll", "/alimtalk-logs", "/org"],
  "auth": {
    "html_pages": "user_jwt_required",
    "service_token": "api_only",
    "cookie_required": false
  }
}
```

## Users

```http
GET /users
GET /users/pending
GET /auth/me
```

Typical use:

- list approved users
- identify current token/user
- show pending users for admin workflows

## Sales

```http
GET /sales
GET /sales/stats
GET /sales/pending
GET /sales/dashboard/refund-impacts
GET /sales/dashboard/refund-requests
GET /sales/deposits
GET /sales/contract-tracker
GET /sales/ranking
```

Common query parameters vary by endpoint and include month, branch, user, status, and date filters where supported.

## Accounting

```http
GET /accounting
GET /accounting/:userId
GET /accounting/alerts
GET /accounting/evaluations/:userId
GET /accounting/staging
GET /accounting/card-settlements/list?month=YYYY-MM
```

Write endpoints exist for accounting staff workflows but should be wired only with `write` or `admin` service tokens after explicit confirmation.

## Payroll

```http
GET /payroll/:userId?month=YYYY-MM
GET /payroll/branch-summary?month=YYYY-MM&branch=BRANCH
GET /payroll/save/:userId?period=YYYY-MM
GET /payroll/reports/business-income?month=YYYY-MM
```

## Card Transactions

```http
GET /card/transactions?month=YYYY-MM
GET /card/transactions?month=YYYY-MM&branch=BRANCH
GET /card/transactions?month=YYYY-MM&user_id=USER_ID
GET /card/summary?month=YYYY-MM
GET /card/user-total/:userId?month=YYYY-MM
GET /card/last-upload
```

## Admin HTML Pages

Embeddable pages:

- `/users`
- `/accounting`
- `/payroll`
- `/alimtalk-logs`
- `/org`

These pages still require the normal my-docs.kr user login inside the iframe. Service tokens do not authenticate browser HTML pages.
