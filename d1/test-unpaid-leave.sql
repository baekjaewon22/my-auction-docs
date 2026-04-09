-- System Admin (admin-001) 무급휴가 테스트 데이터
-- 2026-04-07에 1일 무급휴가 (특별휴가-기타), 승인 완료
INSERT OR IGNORE INTO leave_requests (id, user_id, leave_type, start_date, end_date, hours, days, reason, status, approved_by, approved_at, branch, department)
VALUES ('test-unpaid-01', 'admin-001', '특별휴가', '2026-04-07', '2026-04-07', 8, 1, '[기타] 무급휴가 테스트', 'approved', 'admin-001', '2026-04-07 10:00:00', '', '');
