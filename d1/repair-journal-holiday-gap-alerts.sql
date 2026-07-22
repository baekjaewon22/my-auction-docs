-- Run only after the holiday-aware schedule-gap code has been deployed.
-- This resolves legacy open alerts for enabled journal/company holidays.
UPDATE alert_schedule_gap
SET status = 'resolved',
    resolved_at = COALESCE(resolved_at, datetime('now')),
    last_checked_at = datetime('now')
WHERE status = 'open'
  AND target_date IN (
    SELECT holiday_date
    FROM system_holidays
    WHERE enabled = 1
      AND (applies_to = 'all' OR applies_to = 'journal')
  );
