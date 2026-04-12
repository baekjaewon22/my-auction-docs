-- 기존 낙찰 건 매출내역 일괄 등록 (금액/입금자명은 추후 직접 입력)
-- 조육형: 임정아 (2024타경50525)
INSERT OR IGNORE INTO sales_records (id, user_id, type, client_name, amount, contract_date, journal_entry_id, status, direction, branch, department)
VALUES ('backfill-won-01', 'b926614d-b98d-44e0-b30c-ebf4685f7096', '낙찰', '임정아', 0, '2026-04-06', 'cc28a938-8fca-4f56-9a24-2c73aff61623', 'pending', 'income', '의정부', '경매사업부2팀');

-- 신유진: 한정희 (2024타경5962)
INSERT OR IGNORE INTO sales_records (id, user_id, type, client_name, amount, contract_date, journal_entry_id, status, direction, branch, department)
VALUES ('backfill-won-02', '0ccaee57-e9f4-4c90-847a-d04965b8d390', '낙찰', '한정희', 0, '2026-04-07', 'd9d00431-c543-417c-a41c-be3ead850acb', 'pending', 'income', '의정부', '경매사업부1팀');

-- 윤태강: 성순명 (2025타경12362)
INSERT OR IGNORE INTO sales_records (id, user_id, type, client_name, amount, contract_date, journal_entry_id, status, direction, branch, department)
VALUES ('backfill-won-03', '082a851c-2979-48c8-a202-d5028723a39d', '낙찰', '성순명', 0, '2026-04-08', '98ce12f2-63af-4e25-9a1e-5034da97ab3f', 'pending', 'income', '의정부', '경매사업부2팀');
