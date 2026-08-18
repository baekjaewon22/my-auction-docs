ALTER TABLE lawitgo_new_settlements ADD COLUMN deleted_at TEXT;
ALTER TABLE lawitgo_new_settlements ADD COLUMN deleted_by TEXT;
ALTER TABLE lawitgo_new_settlements ADD COLUMN delete_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE lawitgo_new_settlements ADD COLUMN manual_override_at TEXT;
ALTER TABLE lawitgo_new_settlements ADD COLUMN manual_override_by TEXT;

CREATE TABLE IF NOT EXISTS lawitgo_new_settlement_audit (
  id TEXT PRIMARY KEY,
  settlement_id TEXT NOT NULL,
  external_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('update', 'delete')),
  before_json TEXT NOT NULL,
  after_json TEXT,
  reason TEXT NOT NULL DEFAULT '',
  changed_by TEXT NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_lawitgo_new_settlement_audit_settlement
ON lawitgo_new_settlement_audit(settlement_id, changed_at DESC);
