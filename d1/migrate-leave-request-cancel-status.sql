-- Rebuild the legacy production leave_requests table so approved leave can enter
-- cancel_requested before the final approver confirms cancellation.
--
-- Safety requirements before applying remotely:
-- 1. Record a D1 Time Travel bookmark.
-- 2. Export leave_requests to a protected local backup.
-- 3. Run d1/preflight-leave-request-cancel-status.sql and confirm:
--    - exactly 21 columns with the expected names
--    - no orphan users and no active duplicate rows
-- 4. Run tests/leave-cancel-migration.test.ts against this exact file.
--
-- Apply this WHOLE FILE in one Wrangler command. Do not paste or run individual
-- statements. `wrangler d1 execute --file` applies the file transactionally;
-- adding BEGIN/COMMIT here would create a nested-transaction error in D1.
-- Example:
-- npx.cmd wrangler d1 execute auction-docs-db --remote --file .\d1\migrate-leave-request-cancel-status.sql

PRAGMA defer_foreign_keys = true;

CREATE TABLE leave_requests_rebuild_20260716 (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  leave_type TEXT NOT NULL CHECK (leave_type IN ('연차', '월차', '반차', '시간차', '특별휴가')),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  hours REAL NOT NULL DEFAULT 8,
  days REAL NOT NULL DEFAULT 1,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'cancel_requested')),
  approved_by TEXT,
  approved_at TEXT,
  reject_reason TEXT,
  branch TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  half_day_period TEXT NOT NULL DEFAULT '',
  first_approved_by TEXT NOT NULL DEFAULT '',
  first_approved_at TEXT NOT NULL DEFAULT '',
  request_group_id TEXT,
  summer_request_year TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (approved_by) REFERENCES users(id)
);

INSERT INTO leave_requests_rebuild_20260716 (
  id, user_id, leave_type, start_date, end_date, hours, days, reason, status,
  approved_by, approved_at, reject_reason, branch, department, created_at,
  updated_at, half_day_period, first_approved_by, first_approved_at,
  request_group_id, summer_request_year
)
SELECT
  id, user_id, leave_type, start_date, end_date, hours, days, reason, status,
  approved_by, approved_at, reject_reason, branch, department, created_at,
  updated_at, half_day_period, first_approved_by, first_approved_at,
  request_group_id, summer_request_year
FROM leave_requests;

DROP TABLE leave_requests;
ALTER TABLE leave_requests_rebuild_20260716 RENAME TO leave_requests;

CREATE INDEX idx_leave_requests_user ON leave_requests(user_id);
CREATE INDEX idx_leave_requests_status ON leave_requests(status);
CREATE INDEX idx_leave_requests_date ON leave_requests(start_date);

CREATE UNIQUE INDEX uq_leave_requests_active_exact
ON leave_requests (
  user_id,
  leave_type,
  start_date,
  end_date,
  COALESCE(half_day_period, '')
)
WHERE status IN ('pending', 'approved', 'cancel_requested');

CREATE UNIQUE INDEX uq_leave_requests_active_summer_year
ON leave_requests (user_id, summer_request_year)
WHERE summer_request_year IS NOT NULL
  AND status IN ('pending', 'approved', 'cancel_requested');

PRAGMA defer_foreign_keys = false;
