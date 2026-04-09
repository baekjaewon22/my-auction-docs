-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 테스트 일지 데이터 (현장출퇴근 + 미제출 보고서 검증용)
-- 대상: 이상담(test-mem-01), 최컨설(test-mem-02), 강입찰(test-mem-05), 오팀장(test-mgr-01)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- ══ 이상담 (test-mem-01, 의정부 경매사업부1팀) ══

-- 4/1: 입찰 (현장출근O, 현장퇴근O) → 외근보고서 미제출
INSERT OR IGNORE INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department)
VALUES ('tj-01', 'test-mem-01', '2026-04-01', '입찰', '2026타경1234', '{"timeFrom":"09:00","timeTo":"12:00","fieldCheckIn":true,"fieldCheckOut":false,"caseNo":"2026타경1234","itemNo":"1","bidder":"김고객","client":"김고객","court":"의정부지방법원","suggestedPrice":"50,000,000","bidPrice":"48,000,000","bidWon":false,"bidProxy":false}', '의정부', '경매사업부1팀');

-- 4/1: 임장 (현장출근X, 현장퇴근O) → 외근보고서 미제출
INSERT OR IGNORE INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department)
VALUES ('tj-02', 'test-mem-01', '2026-04-01', '임장', '2026타경5678', '{"timeFrom":"14:00","timeTo":"18:00","fieldCheckIn":false,"fieldCheckOut":true,"caseNo":"2026타경5678","itemNo":"","court":"의정부지방법원","place":"남양주시 화도읍","client":"박계약","inspClientType":"고객명"}', '의정부', '경매사업부1팀');

-- 4/2: 미팅 (현장출근O, 현장퇴근O) → 외근보고서 미제출
INSERT OR IGNORE INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department)
VALUES ('tj-03', 'test-mem-01', '2026-04-02', '미팅', '브리핑', '{"timeFrom":"09:00","timeTo":"12:00","fieldCheckIn":true,"fieldCheckOut":false,"meetingType":"브리핑","client":"이계약","place":"사무실","caseNo":"2026타경9012","itemNo":"2"}', '의정부', '경매사업부1팀');

-- 4/2: 사무 (오후)
INSERT OR IGNORE INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department)
VALUES ('tj-04', 'test-mem-01', '2026-04-02', '사무', '고객관리', '{"timeFrom":"13:00","timeTo":"18:00","fieldCheckIn":false,"fieldCheckOut":false,"officeType":"고객관리"}', '의정부', '경매사업부1팀');

-- 4/3: 개인(연차) → 연차휴가신청서 미제출
INSERT OR IGNORE INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department)
VALUES ('tj-05', 'test-mem-01', '2026-04-03', '개인', '연차', '{"reason":"연차"}', '의정부', '경매사업부1팀');

-- 4/7: 임장 (현장출근O, 현장퇴근X) → 외근보고서 미제출
INSERT OR IGNORE INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department)
VALUES ('tj-06', 'test-mem-01', '2026-04-07', '임장', '2026타경3456', '{"timeFrom":"09:00","timeTo":"13:00","fieldCheckIn":true,"fieldCheckOut":false,"caseNo":"2026타경3456","itemNo":"","court":"수원지방법원","place":"수원시 팔달구","client":"최계약","inspClientType":"고객명"}', '의정부', '경매사업부1팀');

-- 4/7: 사무 (오후)
INSERT OR IGNORE INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department)
VALUES ('tj-07', 'test-mem-01', '2026-04-07', '사무', '서류작성', '{"timeFrom":"14:00","timeTo":"18:00","fieldCheckIn":false,"fieldCheckOut":false,"officeType":"서류작성"}', '의정부', '경매사업부1팀');

-- 4/8: 개인(반차) → 반차신청서 미제출
INSERT OR IGNORE INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department)
VALUES ('tj-08', 'test-mem-01', '2026-04-08', '개인', '반차', '{"reason":"반차"}', '의정부', '경매사업부1팀');

-- 4/8: 사무 (오후)
INSERT OR IGNORE INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department)
VALUES ('tj-09', 'test-mem-01', '2026-04-08', '사무', '고객관리', '{"timeFrom":"14:00","timeTo":"18:00","fieldCheckIn":false,"fieldCheckOut":false,"officeType":"고객관리"}', '의정부', '경매사업부1팀');


-- ══ 최컨설 (test-mem-02, 의정부 경매사업부2팀) ══

-- 4/1: 임장 (현장출근O, 현장퇴근O)
INSERT OR IGNORE INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department)
VALUES ('tj-10', 'test-mem-02', '2026-04-01', '임장', '2026타경2222', '{"timeFrom":"09:00","timeTo":"13:00","fieldCheckIn":true,"fieldCheckOut":false,"caseNo":"2026타경2222","itemNo":"1","court":"서울중앙지방법원","place":"강남구 역삼동","client":"정계약","inspClientType":"고객명"}', '의정부', '경매사업부2팀');

-- 4/1: 미팅 (현장퇴근O)
INSERT OR IGNORE INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department)
VALUES ('tj-11', 'test-mem-02', '2026-04-01', '미팅', '상담', '{"timeFrom":"14:00","timeTo":"18:00","fieldCheckIn":false,"fieldCheckOut":true,"meetingType":"상담","client":"한계약","place":"의정부 카페"}', '의정부', '경매사업부2팀');

-- 4/3: 미팅 (현장출근O, 현장퇴근O) → 외근보고서 미제출
INSERT OR IGNORE INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department)
VALUES ('tj-12', 'test-mem-02', '2026-04-03', '미팅', '브리핑', '{"timeFrom":"09:00","timeTo":"18:00","fieldCheckIn":true,"fieldCheckOut":true,"meetingType":"브리핑","client":"나계약","place":"고객사무실","caseNo":"2026타경3333","itemNo":""}', '의정부', '경매사업부2팀');

-- 4/4: 개인(시간차) → 지각/조퇴/외출 사유서 미제출
INSERT OR IGNORE INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department)
VALUES ('tj-13', 'test-mem-02', '2026-04-04', '개인', '시간차', '{"reason":"시간차"}', '의정부', '경매사업부2팀');

-- 4/4: 사무
INSERT OR IGNORE INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department)
VALUES ('tj-14', 'test-mem-02', '2026-04-04', '사무', '고객관리', '{"timeFrom":"11:00","timeTo":"18:00","fieldCheckIn":false,"fieldCheckOut":false,"officeType":"고객관리"}', '의정부', '경매사업부2팀');

-- 4/7: 임장 (현장출근X, 현장퇴근X) → 미체크 사례
INSERT OR IGNORE INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department)
VALUES ('tj-15', 'test-mem-02', '2026-04-07', '임장', '2026타경4444', '{"timeFrom":"10:00","timeTo":"15:00","fieldCheckIn":false,"fieldCheckOut":false,"caseNo":"2026타경4444","itemNo":"3","court":"인천지방법원","place":"인천 남동구","client":"임계약","inspClientType":"고객명"}', '의정부', '경매사업부2팀');

-- 4/7: 사무
INSERT OR IGNORE INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department)
VALUES ('tj-16', 'test-mem-02', '2026-04-07', '사무', '서류작성', '{"timeFrom":"15:30","timeTo":"18:00","fieldCheckIn":false,"fieldCheckOut":false,"officeType":"서류작성"}', '의정부', '경매사업부2팀');


-- ══ 강입찰 (test-mem-05, 의정부 경매사업부3팀) ══

-- 4/2: 입찰 (대리입찰 → 현장출퇴근 비활성)
INSERT OR IGNORE INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department)
VALUES ('tj-17', 'test-mem-05', '2026-04-02', '입찰', '2026타경7777', '{"timeFrom":"09:00","timeTo":"12:00","fieldCheckIn":false,"fieldCheckOut":false,"caseNo":"2026타경7777","itemNo":"","bidder":"대리인","client":"송계약","court":"의정부지방법원","suggestedPrice":"30,000,000","bidPrice":"29,000,000","bidWon":false,"bidProxy":true}', '의정부', '경매사업부3팀');

-- 4/2: 사무 (오후)
INSERT OR IGNORE INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department)
VALUES ('tj-18', 'test-mem-05', '2026-04-02', '사무', '고객관리', '{"timeFrom":"13:00","timeTo":"18:00","fieldCheckIn":false,"fieldCheckOut":false,"officeType":"고객관리"}', '의정부', '경매사업부3팀');

-- 4/3: 입찰 (현장출근O, 현장퇴근X) → 외근보고서 미제출
INSERT OR IGNORE INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department)
VALUES ('tj-19', 'test-mem-05', '2026-04-03', '입찰', '2026타경8888', '{"timeFrom":"09:00","timeTo":"12:00","fieldCheckIn":true,"fieldCheckOut":false,"caseNo":"2026타경8888","itemNo":"1","bidder":"강입찰","client":"강입찰","court":"수원지방법원","suggestedPrice":"80,000,000","bidPrice":"78,000,000","bidWon":true,"bidProxy":false}', '의정부', '경매사업부3팀');

-- 4/3: 사무 (오후)
INSERT OR IGNORE INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department)
VALUES ('tj-20', 'test-mem-05', '2026-04-03', '사무', '서류작성', '{"timeFrom":"13:00","timeTo":"18:00","fieldCheckIn":false,"fieldCheckOut":false,"officeType":"서류작성"}', '의정부', '경매사업부3팀');

-- 4/7: 임장 (현장출근O, 현장퇴근O) → 외근보고서 미제출
INSERT OR IGNORE INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department)
VALUES ('tj-21', 'test-mem-05', '2026-04-07', '임장', '2026타경9999', '{"timeFrom":"09:00","timeTo":"18:00","fieldCheckIn":true,"fieldCheckOut":true,"caseNo":"2026타경9999","itemNo":"","court":"의정부지방법원","place":"남양주시 별내동","client":"윤계약","inspClientType":"고객명"}', '의정부', '경매사업부3팀');

-- 4/8: 개인(병가) → 결근사유서 미제출
INSERT OR IGNORE INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department)
VALUES ('tj-22', 'test-mem-05', '2026-04-08', '개인', '병가', '{"reason":"병가"}', '의정부', '경매사업부3팀');


-- ══ 오팀장 (test-mgr-01, 의정부 경매사업부1팀) ══

-- 4/1: 미팅 (현장출근O, 현장퇴근O)
INSERT OR IGNORE INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department)
VALUES ('tj-23', 'test-mgr-01', '2026-04-01', '미팅', '브리핑', '{"timeFrom":"09:00","timeTo":"12:00","fieldCheckIn":true,"fieldCheckOut":false,"meetingType":"브리핑","client":"VIP고객","place":"고객사무실","caseNo":"2026타경1111","itemNo":""}', '의정부', '경매사업부1팀');

-- 4/1: 사무
INSERT OR IGNORE INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department)
VALUES ('tj-24', 'test-mgr-01', '2026-04-01', '사무', '고객관리', '{"timeFrom":"13:00","timeTo":"18:00","fieldCheckIn":false,"fieldCheckOut":true,"officeType":"고객관리"}', '의정부', '경매사업부1팀');

-- 4/3: 임장 (현장출근O, 현장퇴근O)
INSERT OR IGNORE INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department)
VALUES ('tj-25', 'test-mgr-01', '2026-04-03', '임장', '2026타경5555', '{"timeFrom":"09:00","timeTo":"18:00","fieldCheckIn":true,"fieldCheckOut":true,"caseNo":"2026타경5555","itemNo":"","court":"의정부지방법원","place":"구리시 수택동","client":"백계약","inspClientType":"고객명"}', '의정부', '경매사업부1팀');

-- 4/7: 사무 (종일) — 일정 공백 없음
INSERT OR IGNORE INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department)
VALUES ('tj-26', 'test-mgr-01', '2026-04-07', '사무', '고객관리', '{"timeFrom":"09:00","timeTo":"18:00","fieldCheckIn":false,"fieldCheckOut":false,"officeType":"고객관리"}', '의정부', '경매사업부1팀');
