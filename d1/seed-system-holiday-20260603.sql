INSERT OR IGNORE INTO system_holidays (
  id, holiday_date, name, holiday_type, applies_to, enabled, memo, created_by, created_at, updated_at
) VALUES (
  'holiday-20260603-election',
  '2026-06-03',
  '제8회 전국동시지방선거',
  'legal',
  'all',
  1,
  '사용자 요청으로 법정공휴일 등록',
  'system',
  datetime('now', '+9 hours'),
  datetime('now', '+9 hours')
);
