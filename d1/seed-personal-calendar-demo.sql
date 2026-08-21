-- Local development calendar demo data. These accounts intentionally cannot log in.
INSERT INTO users (id, email, password_hash, name, role, branch, department, position_title, approved, login_type)
VALUES
  ('calendar-demo-uijeongbu', 'calendar-uijeongbu@test.invalid', 'TEST_ONLY_DISABLED', '의정부 테스트', 'member', '의정부본사', '컨설팅팀', '컨설턴트', 1, 'freelancer'),
  ('calendar-demo-seocho', 'calendar-seocho@test.invalid', 'TEST_ONLY_DISABLED', '서초 테스트', 'member', '서초지사', '컨설팅팀', '컨설턴트', 1, 'freelancer'),
  ('calendar-demo-busan', 'calendar-busan@test.invalid', 'TEST_ONLY_DISABLED', '부산 테스트', 'member', '부산지사', '컨설팅팀', '컨설턴트', 1, 'freelancer'),
  ('calendar-demo-daejeon', 'calendar-daejeon@test.invalid', 'TEST_ONLY_DISABLED', '대전 테스트', 'member', '대전지사', '컨설팅팀', '컨설턴트', 1, 'freelancer')
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  branch = excluded.branch,
  department = excluded.department,
  position_title = excluded.position_title,
  approved = excluded.approved,
  login_type = excluded.login_type,
  updated_at = datetime('now');

INSERT INTO freelancer_auction_schedules
  (id, user_id, target_date, activity_type, activity_subtype, data, branch, department)
VALUES
  (
    'calendar-demo-bid-uijeongbu', 'calendar-demo-uijeongbu', '2026-08-22', '입찰', '',
    '{"caseNo":"2026타경1001","itemNo":"1","client":"김의정부","court":"의정부지방법원","propertyCategory":"주거시설","propertyType":"아파트"}',
    '의정부본사', '컨설팅팀'
  ),
  (
    'calendar-demo-bid-seocho', 'calendar-demo-seocho', '2026-08-23', '입찰', '',
    '{"caseNo":"2026타경2002","itemNo":"2","client":"이서초","court":"서울중앙지방법원","propertyCategory":"상업·업무시설","propertyType":"오피스텔"}',
    '서초지사', '컨설팅팀'
  ),
  (
    'calendar-demo-bid-busan', 'calendar-demo-busan', '2026-08-24', '입찰', '',
    '{"caseNo":"2026타경3003","itemNo":"1","client":"박부산","court":"부산지방법원 동부지원","propertyCategory":"토지","propertyType":"대지"}',
    '부산지사', '컨설팅팀'
  ),
  (
    'calendar-demo-bid-daejeon', 'calendar-demo-daejeon', '2026-08-25', '입찰', '',
    '{"caseNo":"2026타경4004","itemNo":"3","client":"최대전","court":"대전지방법원","propertyCategory":"산업시설","propertyType":"공장"}',
    '대전지사', '컨설팅팀'
  )
ON CONFLICT(id) DO UPDATE SET
  user_id = excluded.user_id,
  target_date = excluded.target_date,
  activity_type = excluded.activity_type,
  activity_subtype = excluded.activity_subtype,
  data = excluded.data,
  branch = excluded.branch,
  department = excluded.department,
  updated_at = datetime('now', '+9 hours');

-- Auction-story manager demo. 5101 is complete and disappears; briefing-only 5201 is also excluded.
INSERT INTO journal_entries
  (id, user_id, target_date, activity_type, activity_subtype, data, branch, department)
VALUES
  (
    'calendar-demo-briefing-complete', 'calendar-demo-busan', '2026-08-24',
    '브리핑자료제출', '2026타경5101',
    '{"briefingSubmit":true,"briefingCaseNo":"2026타경5101","briefingItemNo":"1","briefingCourt":"부산지방법원 동부지원","client":"테스트고객01","propertyCategory":"주거시설"}',
    '부산지사', '컨설팅팀'
  ),
  (
    'calendar-demo-briefing-only', 'calendar-demo-seocho', '2026-08-27',
    '브리핑자료제출', '2026타경5201',
    '{"briefingSubmit":true,"briefingCourt":"서울중앙지방법원","client":"이상현황고객","propertyCategory":"상업·업무시설"}',
    '서초지사', '컨설팅팀'
  )
ON CONFLICT(id) DO UPDATE SET
  user_id = excluded.user_id,
  target_date = excluded.target_date,
  activity_type = excluded.activity_type,
  activity_subtype = excluded.activity_subtype,
  data = excluded.data,
  branch = excluded.branch,
  department = excluded.department,
  updated_at = datetime('now', '+9 hours');

-- Dashboard demo: always move these four bids to the current KST date when reseeded.
INSERT INTO freelancer_auction_schedules
  (id, user_id, target_date, activity_type, activity_subtype, data, branch, department)
VALUES
  ('calendar-demo-today-uijeongbu', 'calendar-demo-uijeongbu', date('now', '+9 hours'), '입찰', '', json_object('caseNo', '2026타경6101', 'itemNo', '1', 'client', '오늘고객01', 'court', '의정부지방법원', 'propertyCategory', '주거시설', 'propertyType', '아파트'), '의정부본사', '컨설팅팀'),
  ('calendar-demo-today-seocho', 'calendar-demo-seocho', date('now', '+9 hours'), '입찰', '', json_object('caseNo', '2026타경6102', 'itemNo', '2', 'client', '오늘고객02', 'court', '서울중앙지방법원', 'propertyCategory', '상업·업무시설', 'propertyType', '상가', 'bidWon', 1), '서초지사', '컨설팅팀'),
  ('calendar-demo-today-busan', 'calendar-demo-busan', date('now', '+9 hours'), '입찰', '', json_object('caseNo', '2026타경6103', 'itemNo', '1', 'client', '오늘고객03', 'court', '부산지방법원 동부지원', 'propertyCategory', '토지', 'propertyType', '대지', 'bidFailed', 1), '부산지사', '컨설팅팀'),
  ('calendar-demo-today-daejeon', 'calendar-demo-daejeon', date('now', '+9 hours'), '입찰', '', json_object('caseNo', '2026타경6104', 'itemNo', '3', 'client', '오늘고객04', 'court', '대전지방법원', 'propertyCategory', '산업시설', 'propertyType', '공장', 'bidCancelled', 1), '대전지사', '컨설팅팀')
ON CONFLICT(id) DO UPDATE SET
  user_id = excluded.user_id,
  target_date = excluded.target_date,
  activity_type = excluded.activity_type,
  activity_subtype = excluded.activity_subtype,
  data = excluded.data,
  branch = excluded.branch,
  department = excluded.department,
  updated_at = datetime('now', '+9 hours');

-- Inspection dates for the first four same-day bids. Full view shows both inspection and bid dates.
INSERT INTO freelancer_auction_schedules
  (id, user_id, target_date, activity_type, activity_subtype, data, branch, department)
VALUES
  ('calendar-demo-inspection-01', 'calendar-demo-busan', '2026-08-22', '임장', '본인', '{"bidDate":"2026-08-26","caseNo":"2026타경5101","itemNo":"1","client":"테스트고객01","court":"부산지방법원 동부지원","propertyCategory":"주거시설","propertyType":"아파트"}', '부산지사', '컨설팅팀'),
  ('calendar-demo-inspection-02', 'calendar-demo-uijeongbu', '2026-08-23', '임장', '본인', '{"bidDate":"2026-08-26","caseNo":"2026타경5102","itemNo":"1","client":"테스트고객02","court":"의정부지방법원","propertyCategory":"토지","propertyType":"대지"}', '의정부본사', '컨설팅팀'),
  ('calendar-demo-inspection-03', 'calendar-demo-daejeon', '2026-08-24', '임장', '본인', '{"bidDate":"2026-08-26","caseNo":"2026타경5103","itemNo":"2","client":"테스트고객03","court":"대전지방법원","propertyCategory":"산업시설","propertyType":"공장"}', '대전지사', '컨설팅팀'),
  ('calendar-demo-inspection-04', 'calendar-demo-seocho', '2026-08-25', '임장', '본인', '{"bidDate":"2026-08-26","caseNo":"2026타경5104","itemNo":"1","client":"테스트고객04","court":"서울중앙지방법원","propertyCategory":"상업·업무시설","propertyType":"오피스텔"}', '서초지사', '컨설팅팀')
ON CONFLICT(id) DO UPDATE SET
  user_id = excluded.user_id,
  target_date = excluded.target_date,
  activity_type = excluded.activity_type,
  activity_subtype = excluded.activity_subtype,
  data = excluded.data,
  branch = excluded.branch,
  department = excluded.department,
  updated_at = datetime('now', '+9 hours');

-- Same-day stress data: ten bids mixed across every branch.
INSERT INTO freelancer_auction_schedules
  (id, user_id, target_date, activity_type, activity_subtype, data, branch, department)
VALUES
  ('calendar-demo-load-01', 'calendar-demo-busan', '2026-08-26', '입찰', '', '{"caseNo":"2026타경5101","itemNo":"1","client":"테스트고객01","court":"부산지방법원 동부지원","propertyCategory":"주거시설","propertyType":"아파트","bidWon":true,"winPrice":"315000000"}', '부산지사', '컨설팅팀'),
  ('calendar-demo-load-02', 'calendar-demo-uijeongbu', '2026-08-26', '입찰', '', '{"caseNo":"2026타경5102","itemNo":"1","client":"테스트고객02","court":"의정부지방법원","propertyCategory":"토지","propertyType":"대지","bidFailed":true}', '의정부본사', '컨설팅팀'),
  ('calendar-demo-load-03', 'calendar-demo-daejeon', '2026-08-26', '입찰', '', '{"caseNo":"2026타경5103","itemNo":"2","client":"테스트고객03","court":"대전지방법원","propertyCategory":"산업시설","propertyType":"공장","bidCancelled":true}', '대전지사', '컨설팅팀'),
  ('calendar-demo-load-04', 'calendar-demo-seocho', '2026-08-26', '입찰', '', '{"caseNo":"2026타경5104","itemNo":"1","client":"테스트고객04","court":"서울중앙지방법원","propertyCategory":"상업·업무시설","propertyType":"오피스텔","bidResultCancelled":true,"bidResultCancelledAt":"2026-08-26 14:00:00"}', '서초지사', '컨설팅팀'),
  ('calendar-demo-load-05', 'calendar-demo-busan', '2026-08-26', '입찰', '', '{"caseNo":"2026타경5105","itemNo":"3","client":"테스트고객05","court":"부산지방법원","propertyCategory":"자동차·중기","propertyType":"승용차","bidResultCancelled":true,"bidResultCancelledAutomatically":true,"bidResultCancelledAt":"2026-08-26 00:00:00"}', '부산지사', '컨설팅팀'),
  ('calendar-demo-load-06', 'calendar-demo-seocho', '2026-08-26', '입찰', '', '{"caseNo":"2026타경5106","itemNo":"1","client":"테스트고객06","court":"서울중앙지방법원","propertyCategory":"주거시설","propertyType":"다세대"}', '서초지사', '컨설팅팀'),
  ('calendar-demo-load-07', 'calendar-demo-uijeongbu', '2026-08-26', '입찰', '', '{"caseNo":"2026타경5107","itemNo":"2","client":"테스트고객07","court":"의정부지방법원 고양지원","propertyCategory":"상업·업무시설","propertyType":"상가"}', '의정부본사', '컨설팅팀'),
  ('calendar-demo-load-08', 'calendar-demo-daejeon', '2026-08-26', '입찰', '', '{"caseNo":"2026타경5108","itemNo":"1","client":"테스트고객08","court":"대전지방법원 천안지원","propertyCategory":"토지","propertyType":"임야"}', '대전지사', '컨설팅팀'),
  ('calendar-demo-load-09', 'calendar-demo-seocho', '2026-08-26', '입찰', '', '{"caseNo":"2026타경5109","itemNo":"4","client":"테스트고객09","court":"서울중앙지방법원","propertyCategory":"산업시설","propertyType":"창고"}', '서초지사', '컨설팅팀'),
  ('calendar-demo-load-10', 'calendar-demo-busan', '2026-08-26', '입찰', '', '{"caseNo":"2026타경5110","itemNo":"1","client":"테스트고객10","court":"부산지방법원 서부지원","propertyCategory":"주거시설","propertyType":"단독주택"}', '부산지사', '컨설팅팀')
ON CONFLICT(id) DO UPDATE SET
  user_id = excluded.user_id,
  target_date = excluded.target_date,
  activity_type = excluded.activity_type,
  activity_subtype = excluded.activity_subtype,
  data = excluded.data,
  branch = excluded.branch,
  department = excluded.department,
  updated_at = datetime('now', '+9 hours');
