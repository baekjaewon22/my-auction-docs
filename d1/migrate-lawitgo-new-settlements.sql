-- lawitgo 신정산 담당컨설턴트 지급 원장 및 열람용 결산내역서
-- mau/명승 배분액은 저장하지 않고 담당컨설턴트 지급액만 저장한다.
CREATE TABLE IF NOT EXISTS lawitgo_new_settlements (
  id TEXT PRIMARY KEY,
  external_id TEXT NOT NULL UNIQUE,
  case_id TEXT NOT NULL,
  consultant_user_id TEXT NOT NULL,
  client_name TEXT NOT NULL,
  settlement_date TEXT NOT NULL,
  payroll_month TEXT NOT NULL,
  consultant_share INTEGER NOT NULL CHECK(consultant_share >= 0),
  statement_title TEXT,
  statement_format TEXT,
  statement_content TEXT,
  source_registered_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_lawitgo_new_settlements_payroll
ON lawitgo_new_settlements(consultant_user_id, payroll_month);

CREATE INDEX IF NOT EXISTS idx_lawitgo_new_settlements_case
ON lawitgo_new_settlements(case_id);
