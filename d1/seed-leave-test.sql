-- 연차/시간차 테스트 데이터
-- 기존 테스트 인원에 입사일 설정 (다양한 근속 시나리오)

-- 이상담: 입사 3년차 (연차 16일 = 15 + 1), 5일 사용
UPDATE users SET hire_date = '2023-03-01' WHERE id = 'test-mem-01';
-- 최컨설: 입사 8개월 (월차 누적 8개, 연차촉진 대상), 2일 사용
UPDATE users SET hire_date = '2025-08-01' WHERE id = 'test-mem-02';
-- 정영업: 입사 5년차 (연차 17일 = 15 + 2), 10일 사용
UPDATE users SET hire_date = '2021-06-15' WHERE id = 'test-mem-03';
-- 한매출: 입사 1년 2개월 (연차 15일), 3일 사용
UPDATE users SET hire_date = '2025-02-01' WHERE id = 'test-mem-04';
-- 강입찰: 입사 4개월 (월차 누적 4개, 촉진 미대상), 1일 사용
UPDATE users SET hire_date = '2025-12-01' WHERE id = 'test-mem-05';
-- 오팀장: 입사 7년차 (연차 18일 = 15 + 3), 7일 사용
UPDATE users SET hire_date = '2019-04-01' WHERE id = 'test-mgr-01';
-- 윤팀장: 입사 2년차 (연차 15일), 4일 사용
UPDATE users SET hire_date = '2024-01-15' WHERE id = 'test-mgr-02';
-- 김총무: 입사 6년차 (연차 17일)
UPDATE users SET hire_date = '2020-09-01' WHERE id = 'test-acc-01';
-- 박총무보: 입사 1년 6개월
UPDATE users SET hire_date = '2024-10-01' WHERE id = 'test-acc-02';

-- 연차 잔여 데이터 (annual_leave)

-- 이상담: 3년차 → 연차 16일, 5일 사용 = 잔여 11일
INSERT OR REPLACE INTO annual_leave (id, user_id, total_days, used_days, monthly_days, monthly_used, leave_type, year)
VALUES ('leave-01', 'test-mem-01', 16, 5, 0, 0, 'annual', 2026);

-- 최컨설: 8개월 → 월차 8개, 2개 사용 = 잔여 6개 (연차촉진 대상!)
INSERT OR REPLACE INTO annual_leave (id, user_id, total_days, used_days, monthly_days, monthly_used, leave_type, year)
VALUES ('leave-02', 'test-mem-02', 0, 0, 8, 2, 'monthly', 2026);

-- 정영업: 5년차 → 연차 17일, 10일 사용 = 잔여 7일
INSERT OR REPLACE INTO annual_leave (id, user_id, total_days, used_days, monthly_days, monthly_used, leave_type, year)
VALUES ('leave-03', 'test-mem-03', 17, 10, 0, 0, 'annual', 2026);

-- 한매출: 1년 2개월 → 연차 15일, 3일 사용 = 잔여 12일
INSERT OR REPLACE INTO annual_leave (id, user_id, total_days, used_days, monthly_days, monthly_used, leave_type, year)
VALUES ('leave-04', 'test-mem-04', 15, 3, 0, 0, 'annual', 2026);

-- 강입찰: 4개월 → 월차 4개, 1개 사용 = 잔여 3개
INSERT OR REPLACE INTO annual_leave (id, user_id, total_days, used_days, monthly_days, monthly_used, leave_type, year)
VALUES ('leave-05', 'test-mem-05', 0, 0, 4, 1, 'monthly', 2026);

-- 오팀장: 7년차 → 연차 18일, 7일 사용 = 잔여 11일
INSERT OR REPLACE INTO annual_leave (id, user_id, total_days, used_days, monthly_days, monthly_used, leave_type, year)
VALUES ('leave-06', 'test-mgr-01', 18, 7, 0, 0, 'annual', 2026);

-- 윤팀장: 2년차 → 연차 15일, 4일 사용 = 잔여 11일
INSERT OR REPLACE INTO annual_leave (id, user_id, total_days, used_days, monthly_days, monthly_used, leave_type, year)
VALUES ('leave-07', 'test-mgr-02', 15, 4, 0, 0, 'annual', 2026);

-- 김총무: 6년차 → 연차 17일, 0일 사용
INSERT OR REPLACE INTO annual_leave (id, user_id, total_days, used_days, monthly_days, monthly_used, leave_type, year)
VALUES ('leave-08', 'test-acc-01', 17, 0, 0, 0, 'annual', 2026);

-- 박총무보: 1년 6개월 → 연차 15일, 2일 사용
INSERT OR REPLACE INTO annual_leave (id, user_id, total_days, used_days, monthly_days, monthly_used, leave_type, year)
VALUES ('leave-09', 'test-acc-02', 15, 2, 0, 0, 'annual', 2026);

-- 테스트 휴가 신청 내역 (다양한 상태)

-- 이상담: 연차 승인됨
INSERT OR IGNORE INTO leave_requests (id, user_id, leave_type, start_date, end_date, hours, days, reason, status, approved_by, approved_at, branch, department)
VALUES ('lreq-01', 'test-mem-01', '연차', '2026-03-20', '2026-03-21', 8, 2, '가족행사', 'approved', 'test-mgr-01', '2026-03-18', '의정부', '경매사업부1팀');

-- 이상담: 반차 승인됨
INSERT OR IGNORE INTO leave_requests (id, user_id, leave_type, start_date, end_date, hours, days, reason, status, approved_by, approved_at, branch, department)
VALUES ('lreq-02', 'test-mem-01', '반차', '2026-04-02', '2026-04-02', 8, 0.5, '병원 예약', 'approved', 'test-mgr-01', '2026-04-01', '의정부', '경매사업부1팀');

-- 이상담: 시간차 승인됨 (3시간)
INSERT OR IGNORE INTO leave_requests (id, user_id, leave_type, start_date, end_date, hours, days, reason, status, approved_by, approved_at, branch, department)
VALUES ('lreq-03', 'test-mem-01', '시간차', '2026-04-07', '2026-04-07', 3, 0.375, '개인 용무', 'approved', 'test-mgr-01', '2026-04-06', '의정부', '경매사업부1팀');

-- 최컨설: 월차 승인 대기 중
INSERT OR IGNORE INTO leave_requests (id, user_id, leave_type, start_date, end_date, hours, days, reason, status, branch, department)
VALUES ('lreq-04', 'test-mem-02', '월차', '2026-04-15', '2026-04-15', 8, 1, '이사 준비', 'pending', '의정부', '경매사업부2팀');

-- 정영업: 연차 반려됨
INSERT OR IGNORE INTO leave_requests (id, user_id, leave_type, start_date, end_date, hours, days, reason, status, approved_by, approved_at, reject_reason, branch, department)
VALUES ('lreq-05', 'test-mem-03', '연차', '2026-04-10', '2026-04-12', 8, 3, '해외여행', 'rejected', 'test-mgr-02', '2026-04-08', '업무 일정과 겹칩니다.', '서초', '경매사업부1팀');

-- 한매출: 시간차 승인 대기 중 (2시간)
INSERT OR IGNORE INTO leave_requests (id, user_id, leave_type, start_date, end_date, hours, days, reason, status, branch, department)
VALUES ('lreq-06', 'test-mem-04', '시간차', '2026-04-11', '2026-04-11', 2, 0.25, '관공서 방문', 'pending', '서초', '경매사업부2팀');

-- 강입찰: 월차 승인 대기 중
INSERT OR IGNORE INTO leave_requests (id, user_id, leave_type, start_date, end_date, hours, days, reason, status, branch, department)
VALUES ('lreq-07', 'test-mem-05', '월차', '2026-04-14', '2026-04-14', 8, 1, '건강검진', 'pending', '의정부', '경매사업부3팀');
