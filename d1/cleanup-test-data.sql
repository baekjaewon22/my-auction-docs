-- 테스트 데이터 정리
DELETE FROM leave_requests WHERE id LIKE 'test-%';
DELETE FROM journal_entries WHERE id LIKE 'tj-%';
DELETE FROM users WHERE id LIKE 'test-%';
