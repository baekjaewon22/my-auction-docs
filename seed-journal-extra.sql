-- =============================================
-- 추가 일지 20건 (과거 날짜 포함 - 통계용)
-- =============================================

-- 정우성 - 3/28 입찰 (제시가 > 실제 5% 이상 차이)
INSERT INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department) VALUES
('j-201', 'user-006', '2026-03-28', '입찰', '2025타경11111', '{"timeFrom":"10:00","timeTo":"11:30","caseNo":"2025타경11111","bidder":"박OO","court":"의정부지방법원","suggestedPrice":"400,000,000","bidPrice":"370,000,000","winPrice":"385,000,000","deviationReason":"현장 하자 발견으로 감액 판단"}', '의정부', '경매사업부1팀');

-- 정우성 - 3/28 임장 (입찰 없는 케이스 - 이상감지용)
INSERT INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department) VALUES
('j-202', 'user-006', '2026-03-28', '임장', '2026타경9990', '{"timeFrom":"14:00","timeTo":"16:00","caseNo":"2026타경9990","place":"남양주시 별내동 123-4","fieldCheckIn":true,"fieldCheckOut":true}', '의정부', '경매사업부1팀');

-- 강민지 - 3/27 입찰 (제시가 대비 8% 낮음)
INSERT INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department) VALUES
('j-203', 'user-007', '2026-03-27', '입찰', '2025타경22222', '{"timeFrom":"10:00","timeTo":"11:00","caseNo":"2025타경22222","bidder":"이OO","court":"의정부지방법원 고양지원","suggestedPrice":"250,000,000","bidPrice":"225,000,000","winPrice":"","deviationReason":"인근 시세 하락 반영"}', '의정부', '경매사업부1팀');

-- 강민지 - 3/27 미팅 + 사무
INSERT INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department) VALUES
('j-204', 'user-007', '2026-03-27', '미팅', '브리핑', '{"timeFrom":"14:00","timeTo":"15:30","meetingType":"브리핑","etcReason":"","place":"고양 사무실","fieldCheckIn":true}', '의정부', '경매사업부1팀'),
('j-205', 'user-007', '2026-03-27', '사무', '자료작성', '{"timeFrom":"16:00","timeTo":"18:00","officeType":"자료작성","etcReason":""}', '의정부', '경매사업부1팀');

-- 윤서현 - 3/26 입찰 (정상 범위)
INSERT INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department) VALUES
('j-206', 'user-008', '2026-03-26', '입찰', '2026타경4440', '{"timeFrom":"10:00","timeTo":"11:00","caseNo":"2026타경4440","bidder":"정OO","court":"서울중앙지방법원","suggestedPrice":"600,000,000","bidPrice":"590,000,000","winPrice":"620,000,000","deviationReason":""}', '서초', '경매사업부2팀');

-- 윤서현 - 3/26 임장 (입찰 없는 케이스)
INSERT INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department) VALUES
('j-207', 'user-008', '2026-03-26', '임장', '2026타경7770', '{"timeFrom":"14:00","timeTo":"16:00","caseNo":"2026타경7770","place":"서초구 방배동 55-2","fieldCheckIn":true,"fieldCheckOut":true}', '서초', '경매사업부2팀');

-- 박지성 팀장 - 3/25 입찰 (5% 초과 차이, 사유 미작성)
INSERT INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department) VALUES
('j-208', 'user-004', '2026-03-25', '입찰', '2025타경33333', '{"timeFrom":"10:00","timeTo":"11:30","caseNo":"2025타경33333","bidder":"김OO","court":"의정부지방법원","suggestedPrice":"500,000,000","bidPrice":"460,000,000","winPrice":"480,000,000","deviationReason":""}', '의정부', '경매사업부1팀');

-- 박지성 - 3/25 임장 + 미팅
INSERT INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department) VALUES
('j-209', 'user-004', '2026-03-25', '임장', '2025타경33333', '{"timeFrom":"08:00","timeTo":"09:30","caseNo":"2025타경33333","place":"의정부시 금오동 22-1","fieldCheckIn":true}', '의정부', '경매사업부1팀'),
('j-210', 'user-004', '2026-03-25', '미팅', '고객상담', '{"timeFrom":"14:00","timeTo":"15:00","meetingType":"고객상담","etcReason":"","place":"의정부 카페"}', '의정부', '경매사업부1팀');

-- 신동엽 - 3/24 입찰 (낙찰 성공)
INSERT INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department) VALUES
('j-211', 'user-009', '2026-03-24', '입찰', '2026타경5550', '{"timeFrom":"10:00","timeTo":"11:00","caseNo":"2026타경5550","bidder":"신OO","court":"의정부지방법원 남양주지원","suggestedPrice":"180,000,000","bidPrice":"175,000,000","winPrice":"175,000,000","deviationReason":""}', '의정부', '경매사업부2팀');

-- 신동엽 - 3/24 사무
INSERT INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department) VALUES
('j-212', 'user-009', '2026-03-24', '사무', '고객관리', '{"timeFrom":"14:00","timeTo":"17:00","officeType":"고객관리","etcReason":"","fieldCheckOut":true}', '의정부', '경매사업부2팀');

-- 한예슬 - 3/26 입찰 (10% 초과 차이)
INSERT INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department) VALUES
('j-213', 'user-010', '2026-03-26', '입찰', '2026타경6660', '{"timeFrom":"10:00","timeTo":"11:30","caseNo":"2026타경6660","bidder":"한OO","court":"서울서부지방법원","suggestedPrice":"350,000,000","bidPrice":"310,000,000","winPrice":"","deviationReason":"유치권 신고 건으로 리스크 반영"}', '서초', '경매사업부3팀');

-- 한예슬 - 3/25 미팅 + 개인
INSERT INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department) VALUES
('j-214', 'user-010', '2026-03-25', '미팅', '계약서작성', '{"timeFrom":"10:00","timeTo":"12:00","meetingType":"계약서작성","etcReason":"","place":"서초 본점"}', '서초', '경매사업부3팀'),
('j-215', 'user-010', '2026-03-25', '개인', '반차', '{"reason":"오후 반차","fieldCheckOut":true}', '서초', '경매사업부3팀');

-- 최수진 팀장 - 3/28 입찰 (정상)
INSERT INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department) VALUES
('j-216', 'user-005', '2026-03-28', '입찰', '2026타경8880', '{"timeFrom":"10:00","timeTo":"11:00","caseNo":"2026타경8880","bidder":"최OO","court":"서울남부지방법원","suggestedPrice":"420,000,000","bidPrice":"415,000,000","winPrice":"430,000,000","deviationReason":""}', '서초', '경매사업부2팀');

-- 최수진 - 3/27 임장 (입찰 있음 - 정상)
INSERT INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department) VALUES
('j-217', 'user-005', '2026-03-27', '임장', '2026타경8880', '{"timeFrom":"09:00","timeTo":"11:00","caseNo":"2026타경8880","place":"영등포구 당산동 100-5","fieldCheckIn":true,"fieldCheckOut":true}', '서초', '경매사업부2팀');

-- 김영수 관리자 - 3/26 미팅
INSERT INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department) VALUES
('j-218', 'user-002', '2026-03-26', '미팅', '기타', '{"timeFrom":"10:00","timeTo":"12:00","meetingType":"기타","etcReason":"지사 분기 실적 회의","place":"의정부 본관 3층"}', '의정부', '');

-- 홍길동 대표 - 3/27 미팅
INSERT INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department) VALUES
('j-219', 'user-001', '2026-03-27', '미팅', '기타', '{"timeFrom":"14:00","timeTo":"17:00","meetingType":"기타","etcReason":"신규 지사 검토 회의","place":"강남 본사"}', '', '');

-- 홍길동 대표 - 3/28 사무
INSERT INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department) VALUES
('j-220', 'user-001', '2026-03-28', '사무', '자료작성', '{"timeFrom":"09:00","timeTo":"12:00","officeType":"자료작성","etcReason":""}', '', '');
