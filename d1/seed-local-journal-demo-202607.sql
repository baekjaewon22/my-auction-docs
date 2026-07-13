CREATE TABLE IF NOT EXISTS journal_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  target_date TEXT NOT NULL,
  activity_type TEXT NOT NULL,
  activity_subtype TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL DEFAULT '{}',
  completed INTEGER NOT NULL DEFAULT 0,
  fail_reason TEXT DEFAULT '',
  branch TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_journal_user ON journal_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_journal_date ON journal_entries(target_date);
CREATE INDEX IF NOT EXISTS idx_journal_branch ON journal_entries(branch);

INSERT OR IGNORE INTO users (id, email, password_hash, name, phone, role, branch, department, position_title, approved, login_type, hire_date)
VALUES
  ('local-admin-01', 'local.admin@test.com', 'f1f6adecb8f27578476e66dfcac5a13148b84dd05dfe0acee60b048fec618faf', '정민호', '010-9000-0001', 'admin', '의정부본사', '', '지사장', 1, 'employee', '2025-01-01'),
  ('local-mgr-01', 'local.manager1@test.com', 'f1f6adecb8f27578476e66dfcac5a13148b84dd05dfe0acee60b048fec618faf', '정민준', '010-9000-0002', 'manager', '의정부본사', '경매사업부2팀', '팀장', 1, 'employee', '2025-03-01'),
  ('local-mgr-02', 'local.manager2@test.com', 'f1f6adecb8f27578476e66dfcac5a13148b84dd05dfe0acee60b048fec618faf', '박소연', '010-9000-0003', 'manager', '서초지사', '경매사업부1팀', '팀장', 1, 'employee', '2025-03-01'),
  ('local-mem-01', 'local.member1@test.com', 'f1f6adecb8f27578476e66dfcac5a13148b84dd05dfe0acee60b048fec618faf', '윤태강', '010-9000-0101', 'member', '의정부본사', '경매사업부2팀', '컨설턴트', 1, 'employee', '2026-01-02'),
  ('local-mem-02', 'local.member2@test.com', 'f1f6adecb8f27578476e66dfcac5a13148b84dd05dfe0acee60b048fec618faf', '박혜연', '010-9000-0102', 'member', '의정부본사', '경매사업부2팀', '컨설턴트', 1, 'employee', '2026-02-01'),
  ('local-mem-03', 'local.member3@test.com', 'f1f6adecb8f27578476e66dfcac5a13148b84dd05dfe0acee60b048fec618faf', '조육형', '010-9000-0103', 'member', '의정부본사', '경매사업부1팀', '컨설턴트', 1, 'employee', '2025-09-01'),
  ('local-mem-04', 'local.member4@test.com', 'f1f6adecb8f27578476e66dfcac5a13148b84dd05dfe0acee60b048fec618faf', '김영훈', '010-9000-0104', 'member', '의정부본사', '지원팀', 'PD', 1, 'employee', '2026-04-01'),
  ('local-mem-05', 'local.member5@test.com', 'f1f6adecb8f27578476e66dfcac5a13148b84dd05dfe0acee60b048fec618faf', '안중현', '010-9000-0105', 'member', '서초지사', '경매사업부1팀', '컨설턴트', 1, 'employee', '2026-01-15');

DELETE FROM journal_entries WHERE id LIKE 'local-journal-202607-%';

INSERT INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, completed, fail_reason, branch, department, created_at, updated_at)
VALUES
  ('local-journal-202607-001', 'local-mem-01', '2026-07-01', '입찰', '2025타경10421 | 1 | 아파트', '{"timeFrom":"09:00","timeTo":"12:00","fieldCheckIn":true,"fieldCheckOut":false,"caseNo":"2025타경10421","itemNo":"1","court":"의정부지방법원","propertyMain":"주거","propertyType":"아파트","bidder":"최연희","client":"최연희","suggestedPrice":"312,000,000","bidPrice":"305,000,000","winPrice":"","bidWon":false,"bidProxy":false,"memo":"최저가 대비 보수적으로 입찰가 조정"}', 0, '', '의정부본사', '경매사업부2팀', '2026-07-01 09:10:00', '2026-07-01 09:10:00'),
  ('local-journal-202607-002', 'local-mem-01', '2026-07-01', '사무', '브리핑자료 작성', '{"timeFrom":"13:30","timeTo":"18:00","officeType":"브리핑자료 작성","memo":"오전 입찰 건 후속 자료 정리"}', 1, '', '의정부본사', '경매사업부2팀', '2026-07-01 13:35:00', '2026-07-01 17:50:00'),
  ('local-journal-202607-003', 'local-mem-01', '2026-07-02', '임장', '2025타경8821 | 2 | 다세대', '{"timeFrom":"09:00","timeTo":"15:00","fieldCheckIn":true,"fieldCheckOut":true,"caseNo":"2025타경8821","itemNo":"2","court":"고양지원","propertyMain":"주거","propertyType":"다세대","place":"경기 고양시 덕양구 화정동","client":"문기태","inspClientType":"고객명","memo":"도로접면 및 점유 상태 확인"}', 1, '', '의정부본사', '경매사업부2팀', '2026-07-02 09:05:00', '2026-07-02 15:20:00'),
  ('local-journal-202607-004', 'local-mem-01', '2026-07-03', '미팅', '브리핑', '{"timeFrom":"10:00","timeTo":"12:00","fieldCheckIn":false,"fieldCheckOut":false,"meetingType":"브리핑","client":"송인상","place":"의정부본사 상담실","caseNo":"2025타경9012","itemNo":"1","memo":"권리관계와 입찰 한도 설명"}', 1, '', '의정부본사', '경매사업부2팀', '2026-07-03 10:05:00', '2026-07-03 12:10:00'),

  ('local-journal-202607-005', 'local-mem-02', '2026-07-01', '미팅', '관리고객 미팅', '{"timeFrom":"09:30","timeTo":"11:00","meetingType":"관리고객 미팅","client":"박여지","place":"카페 미팅","memo":"낙찰 후 명도 일정 안내"}', 1, '', '의정부본사', '경매사업부2팀', '2026-07-01 09:25:00', '2026-07-01 11:10:00'),
  ('local-journal-202607-006', 'local-mem-02', '2026-07-02', '입찰', '2026타경3310 | 1 | 오피스텔', '{"timeFrom":"09:00","timeTo":"11:30","fieldCheckIn":true,"fieldCheckOut":false,"caseNo":"2026타경3310","itemNo":"1","court":"서울북부지방법원","propertyMain":"주거","propertyType":"오피스텔","bidder":"허경순","client":"허경순","suggestedPrice":"198,000,000","bidPrice":"201,000,000","winPrice":"201,000,000","bidWon":true,"bidProxy":false,"memo":"차순위와 210만원 차이 낙찰"}', 1, '', '의정부본사', '경매사업부2팀', '2026-07-02 09:00:00', '2026-07-02 11:45:00'),
  ('local-journal-202607-007', 'local-mem-02', '2026-07-06', '개인', '연차', '{"reason":"연차","memo":"개인 일정"}', 0, '', '의정부본사', '경매사업부2팀', '2026-07-06 09:00:00', '2026-07-06 09:00:00'),
  ('local-journal-202607-008', 'local-mem-02', '2026-07-07', '사무', '고객관리', '{"timeFrom":"09:00","timeTo":"18:00","officeType":"고객관리","memo":"낙찰 고객 사후 안내 및 서류 체크"}', 0, '', '의정부본사', '경매사업부2팀', '2026-07-07 09:05:00', '2026-07-07 09:05:00'),

  ('local-journal-202607-009', 'local-mem-03', '2026-07-01', '임장', '2025타경7788 | 1 | 근린상가', '{"timeFrom":"09:00","timeTo":"16:00","fieldCheckIn":true,"fieldCheckOut":true,"caseNo":"2025타경7788","itemNo":"1","court":"인천지방법원","propertyMain":"상가","propertyType":"근린상가","place":"인천 남동구 구월동","client":"정민준","inspClientType":"고객명","memo":"상권 동선 및 공실률 확인"}', 1, '', '의정부본사', '경매사업부1팀', '2026-07-01 09:05:00', '2026-07-01 16:15:00'),
  ('local-journal-202607-010', 'local-mem-03', '2026-07-03', '입찰', '2025타경9911 | 3 | 아파트', '{"timeFrom":"09:00","timeTo":"12:00","fieldCheckIn":true,"fieldCheckOut":false,"caseNo":"2025타경9911","itemNo":"3","court":"의정부지방법원","propertyMain":"주거","propertyType":"아파트","bidder":"황현진","client":"황현진","suggestedPrice":"410,000,000","bidPrice":"386,000,000","winPrice":"","bidWon":false,"bidProxy":false,"deviationReason":"관리비 체납 및 내부 보수비를 반영해 하향","memo":"제시가 대비 5% 이상 낮은 입찰"}', 1, '', '의정부본사', '경매사업부1팀', '2026-07-03 09:00:00', '2026-07-03 12:20:00'),
  ('local-journal-202607-011', 'local-mem-03', '2026-07-06', '미팅', '브리핑', '{"timeFrom":"14:00","timeTo":"16:00","meetingType":"브리핑","client":"손예경","place":"의정부본사 상담실","caseNo":"2026타경1205","itemNo":"1","memo":"임차인 현황과 예상 비용 설명"}', 0, '', '의정부본사', '경매사업부1팀', '2026-07-06 14:00:00', '2026-07-06 14:00:00'),

  ('local-journal-202607-012', 'local-mem-04', '2026-07-01', '사무', '영상자료 편집', '{"timeFrom":"09:00","timeTo":"13:00","officeType":"영상자료 편집","memo":"물건 브리핑 영상 컷 편집"}', 1, '', '의정부본사', '지원팀', '2026-07-01 09:10:00', '2026-07-01 13:20:00'),
  ('local-journal-202607-013', 'local-mem-04', '2026-07-02', '브리핑자료제출', '2025타경8821 | 2', '{"timeFrom":"15:30","timeTo":"17:00","briefingCaseNo":"2025타경8821","briefingItemNo":"2","briefingSubmit":true,"memo":"임장 사진 보정 및 권리분석 표 삽입"}', 1, '', '의정부본사', '지원팀', '2026-07-02 15:30:00', '2026-07-02 17:05:00'),
  ('local-journal-202607-014', 'local-mem-04', '2026-07-06', '사무', '자료검수', '{"timeFrom":"10:00","timeTo":"18:00","officeType":"자료검수","memo":"경매사업부2팀 제출 자료 오탈자 검수"}', 0, '고객 제출용 등기부 이미지 누락 확인 필요', '의정부본사', '지원팀', '2026-07-06 10:00:00', '2026-07-06 10:00:00'),

  ('local-journal-202607-015', 'local-mem-05', '2026-07-01', '입찰', '2026타경2033 | 1 | 다가구', '{"timeFrom":"09:00","timeTo":"12:00","fieldCheckIn":true,"fieldCheckOut":false,"caseNo":"2026타경2033","itemNo":"1","court":"서울중앙지방법원","propertyMain":"주거","propertyType":"다가구","bidder":"정민준","client":"정민준","suggestedPrice":"625,000,000","bidPrice":"619,000,000","winPrice":"","bidWon":false,"bidProxy":false,"memo":"임차인 보증금 리스크 반영"}', 1, '', '서초지사', '경매사업부1팀', '2026-07-01 09:00:00', '2026-07-01 12:10:00'),
  ('local-journal-202607-016', 'local-mem-05', '2026-07-02', '임장', '2025타경6102 | 1 | 빌라', '{"timeFrom":"09:00","timeTo":"14:30","fieldCheckIn":true,"fieldCheckOut":true,"caseNo":"2025타경6102","itemNo":"1","court":"서울남부지방법원","propertyMain":"주거","propertyType":"빌라","place":"서울 강서구 화곡동","client":"박소연","inspClientType":"고객명","memo":"골목 폭과 주차 여건 확인"}', 1, '', '서초지사', '경매사업부1팀', '2026-07-02 09:00:00', '2026-07-02 14:40:00'),
  ('local-journal-202607-017', 'local-mgr-01', '2026-07-03', '미팅', '회사 미팅', '{"timeFrom":"09:00","timeTo":"10:30","meetingType":"기타","etcReason":"주간 실적 점검","client":"경매사업부2팀","place":"의정부본사 회의실","internalMeeting":true,"memo":"팀별 입찰 예정 건과 브리핑 자료 일정 조율"}', 1, '', '의정부본사', '경매사업부2팀', '2026-07-03 09:00:00', '2026-07-03 10:35:00'),
  ('local-journal-202607-018', 'local-mgr-02', '2026-07-06', '사무', '팀원 일정 점검', '{"timeFrom":"09:00","timeTo":"12:00","officeType":"팀원 일정 점검","memo":"서초지사 임장/입찰 일정 재배치"}', 0, '', '서초지사', '경매사업부1팀', '2026-07-06 09:00:00', '2026-07-06 09:00:00');
