-- =============================================
-- 10명 사용자 (비밀번호: test1234)
-- =============================================
INSERT INTO users (id, email, password_hash, name, phone, role, branch, department, approved) VALUES
('user-001', 'hong@gmail.com', 'f1f6adecb8f27578476e66dfcac5a13148b84dd05dfe0acee60b048fec618faf', '홍길동', '010-1111-1001', 'ceo', '', '', 1),
('user-002', 'kim@gmail.com', 'f1f6adecb8f27578476e66dfcac5a13148b84dd05dfe0acee60b048fec618faf', '김영수', '010-1111-1002', 'admin', '의정부', '', 1),
('user-003', 'lee@gmail.com', 'f1f6adecb8f27578476e66dfcac5a13148b84dd05dfe0acee60b048fec618faf', '이민호', '010-1111-1003', 'admin', '서초', '', 1),
('user-004', 'park@gmail.com', 'f1f6adecb8f27578476e66dfcac5a13148b84dd05dfe0acee60b048fec618faf', '박지성', '010-1111-1004', 'manager', '의정부', '경매사업부1팀', 1),
('user-005', 'choi@gmail.com', 'f1f6adecb8f27578476e66dfcac5a13148b84dd05dfe0acee60b048fec618faf', '최수진', '010-1111-1005', 'manager', '서초', '경매사업부2팀', 1),
('user-006', 'jung@gmail.com', 'f1f6adecb8f27578476e66dfcac5a13148b84dd05dfe0acee60b048fec618faf', '정우성', '010-1111-1006', 'member', '의정부', '경매사업부1팀', 1),
('user-007', 'kang@gmail.com', 'f1f6adecb8f27578476e66dfcac5a13148b84dd05dfe0acee60b048fec618faf', '강민지', '010-1111-1007', 'member', '의정부', '경매사업부1팀', 1),
('user-008', 'yoon@gmail.com', 'f1f6adecb8f27578476e66dfcac5a13148b84dd05dfe0acee60b048fec618faf', '윤서현', '010-1111-1008', 'member', '서초', '경매사업부2팀', 1),
('user-009', 'shin@gmail.com', 'f1f6adecb8f27578476e66dfcac5a13148b84dd05dfe0acee60b048fec618faf', '신동엽', '010-1111-1009', 'member', '의정부', '경매사업부2팀', 1),
('user-010', 'han@gmail.com', 'f1f6adecb8f27578476e66dfcac5a13148b84dd05dfe0acee60b048fec618faf', '한예슬', '010-1111-1010', 'member', '서초', '경매사업부3팀', 1);

-- =============================================
-- 오늘 일지 (2026-03-30)
-- =============================================

-- 정우성 (의정부 1팀) - 입찰 + 임장
INSERT INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department) VALUES
('j-001', 'user-006', '2026-03-30', '입찰', '2025타경12345', '{"timeFrom":"09:00","timeTo":"10:30","caseNo":"2025타경12345","bidder":"김OO","court":"의정부지방법원","bidPrice":"320,000,000","winPrice":""}', '의정부', '경매사업부1팀'),
('j-002', 'user-006', '2026-03-30', '임장', '2026타경5678', '{"timeFrom":"14:00","timeTo":"16:00","caseNo":"2026타경5678","place":"경기도 남양주시 진접읍 금곡리 산 123"}', '의정부', '경매사업부1팀');

-- 강민지 (의정부 1팀) - 미팅 + 사무
INSERT INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department) VALUES
('j-003', 'user-007', '2026-03-30', '미팅', '고객상담', '{"timeFrom":"10:00","timeTo":"11:30","meetingType":"고객상담","etcReason":"","place":"의정부 사무실"}', '의정부', '경매사업부1팀'),
('j-004', 'user-007', '2026-03-30', '사무', '고객관리', '{"timeFrom":"13:00","timeTo":"15:00","officeType":"고객관리","etcReason":""}', '의정부', '경매사업부1팀');

-- 윤서현 (서초 2팀) - 입찰
INSERT INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department) VALUES
('j-005', 'user-008', '2026-03-30', '입찰', '2026타경3333', '{"timeFrom":"10:00","timeTo":"11:00","caseNo":"2026타경3333","bidder":"이OO","court":"서울중앙지방법원","bidPrice":"550,000,000","winPrice":"580,000,000"}', '서초', '경매사업부2팀');

-- 박지성 팀장 (의정부 1팀) - 미팅 + 입찰
INSERT INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department) VALUES
('j-006', 'user-004', '2026-03-30', '미팅', '브리핑', '{"timeFrom":"09:00","timeTo":"10:00","meetingType":"브리핑","etcReason":"","place":"본사 회의실"}', '의정부', '경매사업부1팀'),
('j-007', 'user-004', '2026-03-30', '입찰', '2025타경9999', '{"timeFrom":"11:00","timeTo":"12:00","caseNo":"2025타경9999","bidder":"박OO","court":"의정부지방법원 고양지원","bidPrice":"180,000,000","winPrice":""}', '의정부', '경매사업부1팀');

-- 최수진 팀장 (서초 2팀) - 사무
INSERT INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department) VALUES
('j-008', 'user-005', '2026-03-30', '사무', '자료작성', '{"timeFrom":"09:00","timeTo":"12:00","officeType":"자료작성","etcReason":""}', '서초', '경매사업부2팀');

-- 신동엽 (의정부 2팀) - 임장 + 미팅
INSERT INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department) VALUES
('j-009', 'user-009', '2026-03-30', '임장', '2026타경1111', '{"timeFrom":"10:00","timeTo":"12:00","caseNo":"2026타경1111","place":"의정부시 호원동 123-45"}', '의정부', '경매사업부2팀'),
('j-010', 'user-009', '2026-03-30', '미팅', '계약서작성', '{"timeFrom":"14:00","timeTo":"15:30","meetingType":"계약서작성","etcReason":"","place":"고객 사무실"}', '의정부', '경매사업부2팀');

-- 한예슬 (서초 3팀) - 개인
INSERT INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department) VALUES
('j-011', 'user-010', '2026-03-30', '개인', '연차', '{"reason":"연차"}', '서초', '경매사업부3팀');

-- 김영수 관리자 (의정부) - 사무 + 미팅
INSERT INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department) VALUES
('j-012', 'user-002', '2026-03-30', '사무', '고객관리', '{"timeFrom":"09:00","timeTo":"11:00","officeType":"고객관리","etcReason":""}', '의정부', ''),
('j-013', 'user-002', '2026-03-30', '미팅', '기타', '{"timeFrom":"14:00","timeTo":"16:00","meetingType":"기타","etcReason":"지사 운영 회의","place":"의정부 본관"}', '의정부', '');

-- =============================================
-- 내일 일지 (2026-03-31)
-- =============================================

-- 정우성 - 입찰
INSERT INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department) VALUES
('j-101', 'user-006', '2026-03-31', '입찰', '2026타경7777', '{"timeFrom":"10:00","timeTo":"11:30","caseNo":"2026타경7777","bidder":"최OO","court":"의정부지방법원 남양주지원","bidPrice":"210,000,000","winPrice":""}', '의정부', '경매사업부1팀');

-- 강민지 - 임장 + 미팅
INSERT INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department) VALUES
('j-102', 'user-007', '2026-03-31', '임장', '2025타경4444', '{"timeFrom":"09:00","timeTo":"11:00","caseNo":"2025타경4444","place":"양주시 남면 상수리 200"}', '의정부', '경매사업부1팀'),
('j-103', 'user-007', '2026-03-31', '미팅', '고객상담', '{"timeFrom":"14:00","timeTo":"15:00","meetingType":"고객상담","etcReason":"","place":"카페 미팅"}', '의정부', '경매사업부1팀');

-- 윤서현 - 입찰 + 사무
INSERT INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department) VALUES
('j-104', 'user-008', '2026-03-31', '입찰', '2026타경8888', '{"timeFrom":"10:00","timeTo":"11:00","caseNo":"2026타경8888","bidder":"정OO","court":"서울남부지방법원","bidPrice":"420,000,000","winPrice":""}', '서초', '경매사업부2팀'),
('j-105', 'user-008', '2026-03-31', '사무', '자료작성', '{"timeFrom":"14:00","timeTo":"17:00","officeType":"자료작성","etcReason":""}', '서초', '경매사업부2팀');

-- 박지성 팀장 - 미팅
INSERT INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department) VALUES
('j-106', 'user-004', '2026-03-31', '미팅', '브리핑', '{"timeFrom":"09:30","timeTo":"11:00","meetingType":"브리핑","etcReason":"","place":"본사 대회의실"}', '의정부', '경매사업부1팀');

-- 신동엽 - 입찰 + 임장
INSERT INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department) VALUES
('j-107', 'user-009', '2026-03-31', '입찰', '2026타경2222', '{"timeFrom":"10:00","timeTo":"11:00","caseNo":"2026타경2222","bidder":"신OO","court":"의정부지방법원","bidPrice":"155,000,000","winPrice":""}', '의정부', '경매사업부2팀'),
('j-108', 'user-009', '2026-03-31', '임장', '2025타경6666', '{"timeFrom":"14:00","timeTo":"16:00","caseNo":"2025타경6666","place":"포천시 소흘읍 직동리 55-3"}', '의정부', '경매사업부2팀');

-- 최수진 팀장 - 미팅 + 사무
INSERT INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department) VALUES
('j-109', 'user-005', '2026-03-31', '미팅', '계약서작성', '{"timeFrom":"10:00","timeTo":"11:30","meetingType":"계약서작성","etcReason":"","place":"서초 사무실"}', '서초', '경매사업부2팀'),
('j-110', 'user-005', '2026-03-31', '사무', '고객관리', '{"timeFrom":"14:00","timeTo":"16:00","officeType":"고객관리","etcReason":""}', '서초', '경매사업부2팀');

-- 한예슬 - 입찰
INSERT INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department) VALUES
('j-111', 'user-010', '2026-03-31', '입찰', '2026타경5555', '{"timeFrom":"10:00","timeTo":"11:30","caseNo":"2026타경5555","bidder":"한OO","court":"서울서부지방법원","bidPrice":"280,000,000","winPrice":""}', '서초', '경매사업부3팀');

-- 홍길동 대표 - 미팅
INSERT INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department) VALUES
('j-112', 'user-001', '2026-03-31', '미팅', '기타', '{"timeFrom":"15:00","timeTo":"17:00","meetingType":"기타","etcReason":"투자자 미팅","place":"강남 오피스"}', '', '');
