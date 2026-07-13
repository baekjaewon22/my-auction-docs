ALTER TABLE leave_requests ADD COLUMN first_approved_by TEXT NOT NULL DEFAULT '';
ALTER TABLE leave_requests ADD COLUMN first_approved_at TEXT NOT NULL DEFAULT '';
