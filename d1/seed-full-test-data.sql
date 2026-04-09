-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 전체 테스트 데이터 (회계정보 + 매출 + 평가)
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- ══ 1. 기존 인원 회계정보 추가 (급여/직급/직급수당) ══

-- 박지성 (팀장, 의정부 1팀)
INSERT OR IGNORE INTO user_accounting (id, user_id, salary, standard_sales, grade, position_allowance)
VALUES ('acc-u004', 'user-004', 3200000, 16640000, 'M3', 300000);

-- 최수진 (팀장, 서초 2팀)
INSERT OR IGNORE INTO user_accounting (id, user_id, salary, standard_sales, grade, position_allowance)
VALUES ('acc-u005', 'user-005', 3000000, 15600000, 'M3', 300000);

-- 정우성 (팀원, 의정부 1팀)
INSERT OR IGNORE INTO user_accounting (id, user_id, salary, standard_sales, grade, position_allowance)
VALUES ('acc-u006', 'user-006', 2400000, 12480000, 'M2', 100000);

-- 강민지 (팀원, 의정부 1팀)
INSERT OR IGNORE INTO user_accounting (id, user_id, salary, standard_sales, grade, position_allowance)
VALUES ('acc-u007', 'user-007', 2200000, 11440000, 'M1', 0);

-- 윤서현 (팀원, 서초 2팀)
INSERT OR IGNORE INTO user_accounting (id, user_id, salary, standard_sales, grade, position_allowance)
VALUES ('acc-u008', 'user-008', 2300000, 11960000, 'M2', 100000);

-- 신동엽 (팀원, 의정부 2팀)
INSERT OR IGNORE INTO user_accounting (id, user_id, salary, standard_sales, grade, position_allowance)
VALUES ('acc-u009', 'user-009', 2100000, 10920000, 'M1', 0);

-- 한예슬 (팀원, 서초 3팀)
INSERT OR IGNORE INTO user_accounting (id, user_id, salary, standard_sales, grade, position_allowance)
VALUES ('acc-u010', 'user-010', 2000000, 10400000, 'M1', 0);

-- 기존 테스트 인원에 직급수당 세팅
UPDATE user_accounting SET position_allowance = 200000 WHERE user_id = 'test-mem-01';
UPDATE user_accounting SET position_allowance = 100000 WHERE user_id = 'test-mem-04';
UPDATE user_accounting SET position_allowance = 400000 WHERE user_id = 'test-mgr-01';
UPDATE user_accounting SET position_allowance = 350000 WHERE user_id = 'test-mgr-02';

-- ══ 2. 매출 데이터 (2026년 3월~4월) ══

-- ── 정우성 (의정부 1팀) : 활발한 계약, 기준매출 초과 ──
INSERT OR IGNORE INTO sales_records (id, user_id, type, client_name, depositor_name, depositor_different, amount, contract_date, status, confirmed_at, confirmed_by, deposit_date, branch, department)
VALUES ('sr-001', 'user-006', '계약', '김태호', '', 0, 3300000, '2026-03-05', 'confirmed', '2026-03-07', 'test-acc-01', '2026-03-07', '의정부', '경매사업부1팀');
INSERT OR IGNORE INTO sales_records (id, user_id, type, client_name, depositor_name, depositor_different, amount, contract_date, status, confirmed_at, confirmed_by, deposit_date, branch, department)
VALUES ('sr-002', 'user-006', '계약', '박미선', '', 0, 4400000, '2026-03-12', 'confirmed', '2026-03-14', 'test-acc-01', '2026-03-14', '의정부', '경매사업부1팀');
INSERT OR IGNORE INTO sales_records (id, user_id, type, client_name, depositor_name, depositor_different, amount, contract_date, status, confirmed_at, confirmed_by, deposit_date, branch, department)
VALUES ('sr-003', 'user-006', '낙찰', '이준혁', '', 0, 5500000, '2026-03-18', 'confirmed', '2026-03-22', 'test-acc-01', '2026-03-22', '의정부', '경매사업부1팀');
INSERT OR IGNORE INTO sales_records (id, user_id, type, client_name, depositor_name, depositor_different, amount, contract_date, status, confirmed_at, confirmed_by, deposit_date, branch, department)
VALUES ('sr-004', 'user-006', '계약', '최영호', '최영호 부인', 1, 2200000, '2026-03-25', 'confirmed', '2026-03-27', 'test-acc-01', '2026-03-27', '의정부', '경매사업부1팀');
INSERT OR IGNORE INTO sales_records (id, user_id, type, client_name, amount, contract_date, status, branch, department)
VALUES ('sr-005', 'user-006', '계약', '홍진영', 3800000, '2026-04-02', 'pending', '의정부', '경매사업부1팀');

-- ── 강민지 (의정부 1팀) : 신입, 소수 계약 ──
INSERT OR IGNORE INTO sales_records (id, user_id, type, client_name, amount, contract_date, status, confirmed_at, confirmed_by, deposit_date, branch, department)
VALUES ('sr-006', 'user-007', '계약', '장서연', 2200000, '2026-03-10', 'confirmed', '2026-03-12', 'test-acc-01', '2026-03-12', '의정부', '경매사업부1팀');
INSERT OR IGNORE INTO sales_records (id, user_id, type, client_name, amount, contract_date, status, confirmed_at, confirmed_by, deposit_date, branch, department)
VALUES ('sr-007', 'user-007', '중개', '문재현', 1800000, '2026-03-20', 'confirmed', '2026-03-23', 'test-acc-01', '2026-03-23', '의정부', '경매사업부1팀');

-- ── 이상담 (의정부 1팀) : 낙찰 위주, 환불 1건 ──
INSERT OR IGNORE INTO sales_records (id, user_id, type, client_name, amount, contract_date, status, confirmed_at, confirmed_by, deposit_date, branch, department)
VALUES ('sr-008', 'test-mem-01', '낙찰', '송강호', 6600000, '2026-03-03', 'confirmed', '2026-03-06', 'test-acc-01', '2026-03-06', '의정부', '경매사업부1팀');
INSERT OR IGNORE INTO sales_records (id, user_id, type, client_name, amount, contract_date, status, confirmed_at, confirmed_by, deposit_date, branch, department)
VALUES ('sr-009', 'test-mem-01', '계약', '유재석', 3300000, '2026-03-14', 'confirmed', '2026-03-16', 'test-acc-01', '2026-03-16', '의정부', '경매사업부1팀');
INSERT OR IGNORE INTO sales_records (id, user_id, type, client_name, amount, contract_date, status, confirmed_at, confirmed_by, deposit_date, refund_requested_at, refund_approved_at, refund_approved_by, branch, department)
VALUES ('sr-010', 'test-mem-01', '계약', '하정우', 2800000, '2026-03-20', 'refunded', '2026-03-22', 'test-acc-01', '2026-03-22', '2026-03-25', '2026-03-26', 'test-acc-01', '의정부', '경매사업부1팀');
INSERT OR IGNORE INTO sales_records (id, user_id, type, client_name, amount, contract_date, status, confirmed_at, confirmed_by, deposit_date, branch, department)
VALUES ('sr-011', 'test-mem-01', '낙찰', '마동석', 8800000, '2026-04-01', 'confirmed', '2026-04-03', 'test-acc-01', '2026-04-03', '의정부', '경매사업부1팀');

-- ── 최컨설 (의정부 2팀) : 중개 다수 ──
INSERT OR IGNORE INTO sales_records (id, user_id, type, client_name, amount, contract_date, status, confirmed_at, confirmed_by, deposit_date, branch, department)
VALUES ('sr-012', 'test-mem-02', '중개', '김소연', 1500000, '2026-03-08', 'confirmed', '2026-03-10', 'test-acc-01', '2026-03-10', '의정부', '경매사업부2팀');
INSERT OR IGNORE INTO sales_records (id, user_id, type, client_name, amount, contract_date, status, confirmed_at, confirmed_by, deposit_date, branch, department)
VALUES ('sr-013', 'test-mem-02', '중개', '이수근', 2000000, '2026-03-15', 'confirmed', '2026-03-17', 'test-acc-01', '2026-03-17', '의정부', '경매사업부2팀');
INSERT OR IGNORE INTO sales_records (id, user_id, type, client_name, amount, contract_date, status, confirmed_at, confirmed_by, deposit_date, branch, department)
VALUES ('sr-014', 'test-mem-02', '계약', '박나래', 4400000, '2026-03-22', 'confirmed', '2026-03-24', 'test-acc-01', '2026-03-24', '의정부', '경매사업부2팀');
INSERT OR IGNORE INTO sales_records (id, user_id, type, client_name, amount, contract_date, status, branch, department)
VALUES ('sr-015', 'test-mem-02', '계약', '전현무', 3300000, '2026-04-05', 'pending', '의정부', '경매사업부2팀');

-- ── 신동엽 (의정부 2팀) : 기타 매출 포함 ──
INSERT OR IGNORE INTO sales_records (id, user_id, type, type_detail, client_name, amount, contract_date, status, confirmed_at, confirmed_by, deposit_date, branch, department)
VALUES ('sr-016', 'user-009', '기타', '컨설팅수수료', '(주)대한건설', 5500000, '2026-03-11', 'confirmed', '2026-03-13', 'test-acc-01', '2026-03-13', '의정부', '경매사업부2팀');
INSERT OR IGNORE INTO sales_records (id, user_id, type, client_name, amount, contract_date, status, confirmed_at, confirmed_by, deposit_date, branch, department)
VALUES ('sr-017', 'user-009', '계약', '임창정', 2750000, '2026-03-19', 'confirmed', '2026-03-21', 'test-acc-01', '2026-03-21', '의정부', '경매사업부2팀');

-- ── 윤팀장 (서초 1팀) : 팀장 매출 ──
INSERT OR IGNORE INTO sales_records (id, user_id, type, client_name, amount, contract_date, status, confirmed_at, confirmed_by, deposit_date, branch, department)
VALUES ('sr-018', 'test-mgr-02', '낙찰', '조인성', 7700000, '2026-03-07', 'confirmed', '2026-03-10', 'test-acc-01', '2026-03-10', '서초', '경매사업부1팀');
INSERT OR IGNORE INTO sales_records (id, user_id, type, client_name, amount, contract_date, status, confirmed_at, confirmed_by, deposit_date, branch, department)
VALUES ('sr-019', 'test-mgr-02', '계약', '현빈', 5500000, '2026-03-17', 'confirmed', '2026-03-19', 'test-acc-01', '2026-03-19', '서초', '경매사업부1팀');
INSERT OR IGNORE INTO sales_records (id, user_id, type, client_name, amount, contract_date, status, confirmed_at, confirmed_by, deposit_date, branch, department)
VALUES ('sr-020', 'test-mgr-02', '계약', '손예진', 3300000, '2026-03-28', 'confirmed', '2026-03-30', 'test-acc-01', '2026-03-30', '서초', '경매사업부1팀');

-- ── 정영업 (서초 1팀) : 미달 실적, 환불신청 중 ──
INSERT OR IGNORE INTO sales_records (id, user_id, type, client_name, amount, contract_date, status, confirmed_at, confirmed_by, deposit_date, branch, department)
VALUES ('sr-021', 'test-mem-03', '계약', '이병헌', 3300000, '2026-03-09', 'confirmed', '2026-03-11', 'test-acc-01', '2026-03-11', '서초', '경매사업부1팀');
INSERT OR IGNORE INTO sales_records (id, user_id, type, client_name, amount, contract_date, status, confirmed_at, confirmed_by, deposit_date, refund_requested_at, branch, department)
VALUES ('sr-022', 'test-mem-03', '계약', '정해인', 2200000, '2026-03-21', 'refund_requested', '2026-03-23', 'test-acc-01', '2026-03-23', '2026-04-01', '서초', '경매사업부1팀');

-- ── 한매출 (서초 2팀) : 대형 낙찰 ──
INSERT OR IGNORE INTO sales_records (id, user_id, type, client_name, depositor_name, depositor_different, amount, contract_date, status, confirmed_at, confirmed_by, deposit_date, branch, department)
VALUES ('sr-023', 'test-mem-04', '낙찰', '공유', '공지철', 1, 12100000, '2026-03-06', 'confirmed', '2026-03-10', 'test-acc-01', '2026-03-10', '서초', '경매사업부2팀');
INSERT OR IGNORE INTO sales_records (id, user_id, type, client_name, amount, contract_date, status, confirmed_at, confirmed_by, deposit_date, branch, department)
VALUES ('sr-024', 'test-mem-04', '계약', '이정재', 4400000, '2026-03-16', 'confirmed', '2026-03-18', 'test-acc-01', '2026-03-18', '서초', '경매사업부2팀');
INSERT OR IGNORE INTO sales_records (id, user_id, type, client_name, amount, contract_date, status, confirmed_at, confirmed_by, deposit_date, branch, department)
VALUES ('sr-025', 'test-mem-04', '계약', '황정민', 3850000, '2026-03-26', 'confirmed', '2026-03-28', 'test-acc-01', '2026-03-28', '서초', '경매사업부2팀');

-- ── 윤서현 (서초 2팀) : 보통 실적 ──
INSERT OR IGNORE INTO sales_records (id, user_id, type, client_name, amount, contract_date, status, confirmed_at, confirmed_by, deposit_date, branch, department)
VALUES ('sr-026', 'user-008', '계약', '김혜수', 3300000, '2026-03-04', 'confirmed', '2026-03-06', 'test-acc-01', '2026-03-06', '서초', '경매사업부2팀');
INSERT OR IGNORE INTO sales_records (id, user_id, type, client_name, amount, contract_date, status, confirmed_at, confirmed_by, deposit_date, branch, department)
VALUES ('sr-027', 'user-008', '중개', '전지현', 2200000, '2026-03-13', 'confirmed', '2026-03-15', 'test-acc-01', '2026-03-15', '서초', '경매사업부2팀');
INSERT OR IGNORE INTO sales_records (id, user_id, type, client_name, amount, contract_date, status, confirmed_at, confirmed_by, deposit_date, branch, department)
VALUES ('sr-028', 'user-008', '낙찰', '배두나', 5500000, '2026-03-24', 'confirmed', '2026-03-26', 'test-acc-01', '2026-03-26', '서초', '경매사업부2팀');

-- ── 한예슬 (서초 3팀) : 입금대기 건 다수 ──
INSERT OR IGNORE INTO sales_records (id, user_id, type, client_name, amount, contract_date, status, branch, department)
VALUES ('sr-029', 'user-010', '계약', '수지', 2750000, '2026-03-15', 'pending', '서초', '경매사업부3팀');
INSERT OR IGNORE INTO sales_records (id, user_id, type, client_name, amount, contract_date, status, branch, department)
VALUES ('sr-030', 'user-010', '계약', '아이유', 3300000, '2026-04-01', 'pending', '서초', '경매사업부3팀');

-- ── 강입찰 (의정부 3팀) : 낙찰 위주 ──
INSERT OR IGNORE INTO sales_records (id, user_id, type, client_name, amount, contract_date, status, confirmed_at, confirmed_by, deposit_date, branch, department)
VALUES ('sr-031', 'test-mem-05', '낙찰', '이도현', 4400000, '2026-03-08', 'confirmed', '2026-03-10', 'test-acc-01', '2026-03-10', '의정부', '경매사업부3팀');
INSERT OR IGNORE INTO sales_records (id, user_id, type, client_name, amount, contract_date, status, confirmed_at, confirmed_by, deposit_date, branch, department)
VALUES ('sr-032', 'test-mem-05', '계약', '안보현', 2200000, '2026-03-19', 'confirmed', '2026-03-21', 'test-acc-01', '2026-03-21', '의정부', '경매사업부3팀');

-- ── 오팀장 (의정부 1팀) : 대형 계약 ──
INSERT OR IGNORE INTO sales_records (id, user_id, type, client_name, amount, contract_date, status, confirmed_at, confirmed_by, deposit_date, branch, department)
VALUES ('sr-033', 'test-mgr-01', '계약', '장동건', 8800000, '2026-03-05', 'confirmed', '2026-03-08', 'test-acc-01', '2026-03-08', '의정부', '경매사업부1팀');
INSERT OR IGNORE INTO sales_records (id, user_id, type, client_name, amount, contract_date, status, confirmed_at, confirmed_by, deposit_date, branch, department)
VALUES ('sr-034', 'test-mgr-01', '낙찰', '원빈', 11000000, '2026-03-15', 'confirmed', '2026-03-18', 'test-acc-01', '2026-03-18', '의정부', '경매사업부1팀');
INSERT OR IGNORE INTO sales_records (id, user_id, type, client_name, amount, contract_date, status, confirmed_at, confirmed_by, deposit_date, branch, department)
VALUES ('sr-035', 'test-mgr-01', '계약', '김우빈', 4400000, '2026-03-27', 'confirmed', '2026-03-29', 'test-acc-01', '2026-03-29', '의정부', '경매사업부1팀');

-- ── 박지성 (팀장, 의정부 1팀) : 팀장 직접 매출 ──
INSERT OR IGNORE INTO sales_records (id, user_id, type, client_name, amount, contract_date, status, confirmed_at, confirmed_by, deposit_date, branch, department)
VALUES ('sr-036', 'user-004', '계약', '손흥민', 6600000, '2026-03-10', 'confirmed', '2026-03-12', 'test-acc-01', '2026-03-12', '의정부', '경매사업부1팀');
INSERT OR IGNORE INTO sales_records (id, user_id, type, client_name, amount, contract_date, status, confirmed_at, confirmed_by, deposit_date, branch, department)
VALUES ('sr-037', 'user-004', '낙찰', '김민재', 9900000, '2026-03-20', 'confirmed', '2026-03-23', 'test-acc-01', '2026-03-23', '의정부', '경매사업부1팀');

-- ── 최수진 (팀장, 서초 2팀) ──
INSERT OR IGNORE INTO sales_records (id, user_id, type, client_name, amount, contract_date, status, confirmed_at, confirmed_by, deposit_date, branch, department)
VALUES ('sr-038', 'user-005', '계약', '이강인', 4400000, '2026-03-08', 'confirmed', '2026-03-10', 'test-acc-01', '2026-03-10', '서초', '경매사업부2팀');
INSERT OR IGNORE INTO sales_records (id, user_id, type, client_name, amount, contract_date, status, confirmed_at, confirmed_by, deposit_date, branch, department)
VALUES ('sr-039', 'user-005', '중개', '황희찬', 3300000, '2026-03-18', 'confirmed', '2026-03-20', 'test-acc-01', '2026-03-20', '서초', '경매사업부2팀');

-- ══ 3. 입금 등록 (회계 → 담당자, 미처리) ══

INSERT OR IGNORE INTO deposit_notices (id, depositor, amount, deposit_date, d_day_date, created_by, status)
VALUES ('dep-001', '김철수', 3300000, '2026-04-03', '2026-04-03', 'test-acc-01', 'pending');
INSERT OR IGNORE INTO deposit_notices (id, depositor, amount, deposit_date, d_day_date, created_by, status)
VALUES ('dep-002', '박영희', 5500000, '2026-04-05', '2026-04-05', 'test-acc-01', 'pending');
INSERT OR IGNORE INTO deposit_notices (id, depositor, amount, deposit_date, d_day_date, created_by, claimed_by, claimed_at, status)
VALUES ('dep-003', '이재용', 8800000, '2026-04-01', '2026-04-01', 'test-acc-01', 'user-006', '2026-04-02', 'claimed');

-- ══ 4. 매출 평가 (기존 인원 외 추가) ══

-- 정우성: 3-4월 달성
INSERT OR IGNORE INTO sales_evaluations (id, user_id, period_start, period_end, standard_sales, total_sales, met_target, consecutive_misses)
VALUES ('eval-u006', 'user-006', '2026-03-01', '2026-04-30', 12480000, 15400000, 1, 0);

-- 강민지: 3-4월 미달
INSERT OR IGNORE INTO sales_evaluations (id, user_id, period_start, period_end, standard_sales, total_sales, met_target, consecutive_misses)
VALUES ('eval-u007', 'user-007', '2026-03-01', '2026-04-30', 11440000, 4000000, 0, 1);

-- 윤서현: 3-4월 달성
INSERT OR IGNORE INTO sales_evaluations (id, user_id, period_start, period_end, standard_sales, total_sales, met_target, consecutive_misses)
VALUES ('eval-u008', 'user-008', '2026-03-01', '2026-04-30', 11960000, 11000000, 0, 1);

-- 신동엽: 3-4월 달성
INSERT OR IGNORE INTO sales_evaluations (id, user_id, period_start, period_end, standard_sales, total_sales, met_target, consecutive_misses)
VALUES ('eval-u009', 'user-009', '2026-03-01', '2026-04-30', 10920000, 8250000, 0, 1);

-- 박지성 팀장: 달성
INSERT OR IGNORE INTO sales_evaluations (id, user_id, period_start, period_end, standard_sales, total_sales, met_target, consecutive_misses)
VALUES ('eval-u004', 'user-004', '2026-03-01', '2026-04-30', 16640000, 16500000, 0, 1);

-- 최수진 팀장: 미달
INSERT OR IGNORE INTO sales_evaluations (id, user_id, period_start, period_end, standard_sales, total_sales, met_target, consecutive_misses)
VALUES ('eval-u005', 'user-005', '2026-03-01', '2026-04-30', 15600000, 7700000, 0, 1);

-- 회계 메모 예시
UPDATE sales_records SET memo = '계약금 분할납부 예정' WHERE id = 'sr-001';
UPDATE sales_records SET memo = '세금계산서 발행 완료' WHERE id = 'sr-023';
UPDATE sales_records SET memo = '잔금 4월 중 입금 예정' WHERE id = 'sr-034';
