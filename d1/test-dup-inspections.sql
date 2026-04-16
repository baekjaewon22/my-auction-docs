-- 테스트: 중복 임장 사건번호 데이터
-- 사건번호 2026타경1234: 조육형 + 지경현 (같은 사건에 두 명이 임장)
INSERT INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department)
VALUES (
  'test-dup-001',
  'b926614d-b98d-44e0-b30c-ebf4685f7096',
  '2026-04-10',
  '임장',
  '2026타경1234',
  '{"caseNo":"2026타경1234","itemNo":"1","court":"의정부지방법원","place":"의정부시","client":"테스트고객A","inspClientType":"고객명","timeFrom":"10:00","timeTo":"12:00"}',
  '의정부',
  '경매사업부2팀'
);

INSERT INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department)
VALUES (
  'test-dup-002',
  '4105286c-665d-40c1-8c3e-be5e93a5ccb5',
  '2026-04-11',
  '임장',
  '2026타경1234',
  '{"caseNo":"2026타경1234","itemNo":"1","court":"의정부지방법원","place":"의정부시","client":"테스트고객B","inspClientType":"고객명","timeFrom":"14:00","timeTo":"16:00"}',
  '의정부',
  '경매사업부2팀'
);

-- 사건번호 2026타경5678: 정수환 + 신유진 + 윤태강 (3명이 같은 사건 임장)
INSERT INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department)
VALUES (
  'test-dup-003',
  'bcd344dc-db4e-4cf7-982a-15abd99bfb23',
  '2026-04-12',
  '임장',
  '2026타경5678',
  '{"caseNo":"2026타경5678","itemNo":"","court":"수원지방법원","place":"수원시","client":"테스트고객C","inspClientType":"고객명","timeFrom":"09:00","timeTo":"11:00"}',
  '의정부',
  '경매사업부1팀'
);

INSERT INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department)
VALUES (
  'test-dup-004',
  '0ccaee57-e9f4-4c90-847a-d04965b8d390',
  '2026-04-12',
  '임장',
  '2026타경5678',
  '{"caseNo":"2026타경5678","itemNo":"","court":"수원지방법원","place":"수원시","client":"테스트고객D","inspClientType":"고객명","timeFrom":"13:00","timeTo":"15:00"}',
  '의정부',
  '경매사업부1팀'
);

INSERT INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department)
VALUES (
  'test-dup-005',
  '082a851c-2979-48c8-a202-d5028723a39d',
  '2026-04-13',
  '임장',
  '2026타경5678',
  '{"caseNo":"2026타경5678","itemNo":"","court":"수원지방법원","place":"수원시","client":"테스트고객E","inspClientType":"기타","inspEtcReason":"사전답사","timeFrom":"10:00","timeTo":"12:00"}',
  '의정부',
  '경매사업부2팀'
);
