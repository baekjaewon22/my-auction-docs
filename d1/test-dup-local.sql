INSERT INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department) VALUES
('test-dup-L01', 'user-006', '2026-04-10', '임장', '2026타경1234', '{"caseNo":"2026타경1234","itemNo":"1","court":"의정부지방법원","place":"의정부시","client":"테스트고객A","inspClientType":"고객명","timeFrom":"10:00","timeTo":"12:00"}', '의정부', '경매사업부1팀');

INSERT INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department) VALUES
('test-dup-L02', 'user-007', '2026-04-11', '임장', '2026타경1234', '{"caseNo":"2026타경1234","itemNo":"1","court":"의정부지방법원","place":"의정부시","client":"테스트고객B","inspClientType":"고객명","timeFrom":"14:00","timeTo":"16:00"}', '의정부', '경매사업부1팀');

INSERT INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department) VALUES
('test-dup-L03', 'user-008', '2026-04-12', '임장', '2026타경5678', '{"caseNo":"2026타경5678","itemNo":"","court":"수원지방법원","place":"수원시","client":"테스트고객C","inspClientType":"고객명","timeFrom":"09:00","timeTo":"11:00"}', '서초', '경매사업부2팀');

INSERT INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department) VALUES
('test-dup-L04', 'user-009', '2026-04-12', '임장', '2026타경5678', '{"caseNo":"2026타경5678","itemNo":"","court":"수원지방법원","place":"수원시","client":"테스트고객D","inspClientType":"고객명","timeFrom":"13:00","timeTo":"15:00"}', '의정부', '경매사업부2팀');

INSERT INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department) VALUES
('test-dup-L05', 'user-004', '2026-04-13', '임장', '2026타경5678', '{"caseNo":"2026타경5678","itemNo":"","court":"수원지방법원","place":"수원시","client":"테스트고객E","inspClientType":"기타","inspEtcReason":"사전답사","timeFrom":"10:00","timeTo":"12:00"}', '의정부', '경매사업부1팀');
