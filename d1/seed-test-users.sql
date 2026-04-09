-- 테스트 인원 시드 데이터
-- 비밀번호: test1234 (모든 테스트 계정 동일)
-- 배포 후 D1에서 실행

-- 총무담당 (회계 편집 권한)
INSERT OR IGNORE INTO users (id, email, password_hash, name, phone, role, branch, department, position_title, approved)
VALUES ('test-acc-01', 'chungmu01@test.com', 'f1f6adecb8f27578476e66dfcac5a13148b84dd05dfe0acee60b048fec618faf', '김총무', '010-1111-0001', 'accountant', '의정부', '경매사업부1팀', '과장', 1);

-- 총무보조 (회계 조회만)
INSERT OR IGNORE INTO users (id, email, password_hash, name, phone, role, branch, department, position_title, approved)
VALUES ('test-acc-02', 'chungmu02@test.com', 'f1f6adecb8f27578476e66dfcac5a13148b84dd05dfe0acee60b048fec618faf', '박총무보', '010-1111-0002', 'accountant_asst', '의정부', '경매사업부1팀', '대리', 1);

-- 일반 팀원들 (매출 평가 대상)
INSERT OR IGNORE INTO users (id, email, password_hash, name, phone, role, branch, department, position_title, approved)
VALUES ('test-mem-01', 'member01@test.com', 'f1f6adecb8f27578476e66dfcac5a13148b84dd05dfe0acee60b048fec618faf', '이상담', '010-2222-0001', 'member', '의정부', '경매사업부1팀', '대리', 1);

INSERT OR IGNORE INTO users (id, email, password_hash, name, phone, role, branch, department, position_title, approved)
VALUES ('test-mem-02', 'member02@test.com', 'f1f6adecb8f27578476e66dfcac5a13148b84dd05dfe0acee60b048fec618faf', '최컨설', '010-2222-0002', 'member', '의정부', '경매사업부2팀', '주임', 1);

INSERT OR IGNORE INTO users (id, email, password_hash, name, phone, role, branch, department, position_title, approved)
VALUES ('test-mem-03', 'member03@test.com', 'f1f6adecb8f27578476e66dfcac5a13148b84dd05dfe0acee60b048fec618faf', '정영업', '010-2222-0003', 'member', '서초', '경매사업부1팀', '사원', 1);

INSERT OR IGNORE INTO users (id, email, password_hash, name, phone, role, branch, department, position_title, approved)
VALUES ('test-mem-04', 'member04@test.com', 'f1f6adecb8f27578476e66dfcac5a13148b84dd05dfe0acee60b048fec618faf', '한매출', '010-2222-0004', 'member', '서초', '경매사업부2팀', '대리', 1);

INSERT OR IGNORE INTO users (id, email, password_hash, name, phone, role, branch, department, position_title, approved)
VALUES ('test-mem-05', 'member05@test.com', 'f1f6adecb8f27578476e66dfcac5a13148b84dd05dfe0acee60b048fec618faf', '강입찰', '010-2222-0005', 'member', '의정부', '경매사업부3팀', '주임', 1);

-- 팀장
INSERT OR IGNORE INTO users (id, email, password_hash, name, phone, role, branch, department, position_title, approved)
VALUES ('test-mgr-01', 'manager01@test.com', 'f1f6adecb8f27578476e66dfcac5a13148b84dd05dfe0acee60b048fec618faf', '오팀장', '010-3333-0001', 'manager', '의정부', '경매사업부1팀', '팀장', 1);

INSERT OR IGNORE INTO users (id, email, password_hash, name, phone, role, branch, department, position_title, approved)
VALUES ('test-mgr-02', 'manager02@test.com', 'f1f6adecb8f27578476e66dfcac5a13148b84dd05dfe0acee60b048fec618faf', '윤팀장', '010-3333-0002', 'manager', '서초', '경매사업부1팀', '팀장', 1);

-- 테스트용 회계 데이터 (급여/직급 설정)
INSERT OR IGNORE INTO user_accounting (id, user_id, salary, standard_sales, grade)
VALUES ('acc-data-01', 'test-mem-01', 2500000, 13000000, 'M2');

INSERT OR IGNORE INTO user_accounting (id, user_id, salary, standard_sales, grade)
VALUES ('acc-data-02', 'test-mem-02', 2200000, 11440000, 'M1');

INSERT OR IGNORE INTO user_accounting (id, user_id, salary, standard_sales, grade)
VALUES ('acc-data-03', 'test-mem-03', 2000000, 10400000, 'M1');

INSERT OR IGNORE INTO user_accounting (id, user_id, salary, standard_sales, grade)
VALUES ('acc-data-04', 'test-mem-04', 2800000, 14560000, 'M3');

INSERT OR IGNORE INTO user_accounting (id, user_id, salary, standard_sales, grade)
VALUES ('acc-data-05', 'test-mem-05', 2100000, 10920000, 'M2');

INSERT OR IGNORE INTO user_accounting (id, user_id, salary, standard_sales, grade)
VALUES ('acc-data-06', 'test-mgr-01', 3500000, 18200000, 'M4');

INSERT OR IGNORE INTO user_accounting (id, user_id, salary, standard_sales, grade)
VALUES ('acc-data-07', 'test-mgr-02', 3200000, 16640000, 'M3');

-- 테스트용 매출 평가 데이터 (2026년 1-2월, 3-4월 기간)
-- 이상담: 1-2월 미달, 3-4월 미달 (연속 2회)
INSERT OR IGNORE INTO sales_evaluations (id, user_id, period_start, period_end, standard_sales, total_sales, met_target, consecutive_misses)
VALUES ('eval-01', 'test-mem-01', '2026-01-01', '2026-02-28', 13000000, 9800000, 0, 1);
INSERT OR IGNORE INTO sales_evaluations (id, user_id, period_start, period_end, standard_sales, total_sales, met_target, consecutive_misses)
VALUES ('eval-02', 'test-mem-01', '2026-03-01', '2026-04-30', 13000000, 11500000, 0, 2);

-- 최컨설: 1-2월 달성, 3-4월 달성
INSERT OR IGNORE INTO sales_evaluations (id, user_id, period_start, period_end, standard_sales, total_sales, met_target, consecutive_misses)
VALUES ('eval-03', 'test-mem-02', '2026-01-01', '2026-02-28', 11440000, 12500000, 1, 0);
INSERT OR IGNORE INTO sales_evaluations (id, user_id, period_start, period_end, standard_sales, total_sales, met_target, consecutive_misses)
VALUES ('eval-04', 'test-mem-02', '2026-03-01', '2026-04-30', 11440000, 14200000, 1, 0);

-- 정영업: 3회 연속 미달 (강등 대상!)
INSERT OR IGNORE INTO sales_evaluations (id, user_id, period_start, period_end, standard_sales, total_sales, met_target, consecutive_misses)
VALUES ('eval-05', 'test-mem-03', '2025-11-01', '2025-12-31', 10400000, 7200000, 0, 1);
INSERT OR IGNORE INTO sales_evaluations (id, user_id, period_start, period_end, standard_sales, total_sales, met_target, consecutive_misses)
VALUES ('eval-06', 'test-mem-03', '2026-01-01', '2026-02-28', 10400000, 6800000, 0, 2);
INSERT OR IGNORE INTO sales_evaluations (id, user_id, period_start, period_end, standard_sales, total_sales, met_target, consecutive_misses)
VALUES ('eval-07', 'test-mem-03', '2026-03-01', '2026-04-30', 10400000, 5500000, 0, 3);

-- 한매출: 1-2월 미달, 3-4월 달성 (리셋)
INSERT OR IGNORE INTO sales_evaluations (id, user_id, period_start, period_end, standard_sales, total_sales, met_target, consecutive_misses)
VALUES ('eval-08', 'test-mem-04', '2026-01-01', '2026-02-28', 14560000, 10200000, 0, 1);
INSERT OR IGNORE INTO sales_evaluations (id, user_id, period_start, period_end, standard_sales, total_sales, met_target, consecutive_misses)
VALUES ('eval-09', 'test-mem-04', '2026-03-01', '2026-04-30', 14560000, 15800000, 1, 0);

-- 강입찰: 4회 연속 미달 (강등 대상!)
INSERT OR IGNORE INTO sales_evaluations (id, user_id, period_start, period_end, standard_sales, total_sales, met_target, consecutive_misses)
VALUES ('eval-10', 'test-mem-05', '2025-09-01', '2025-10-31', 10920000, 6100000, 0, 1);
INSERT OR IGNORE INTO sales_evaluations (id, user_id, period_start, period_end, standard_sales, total_sales, met_target, consecutive_misses)
VALUES ('eval-11', 'test-mem-05', '2025-11-01', '2025-12-31', 10920000, 7300000, 0, 2);
INSERT OR IGNORE INTO sales_evaluations (id, user_id, period_start, period_end, standard_sales, total_sales, met_target, consecutive_misses)
VALUES ('eval-12', 'test-mem-05', '2026-01-01', '2026-02-28', 10920000, 5900000, 0, 3);
INSERT OR IGNORE INTO sales_evaluations (id, user_id, period_start, period_end, standard_sales, total_sales, met_target, consecutive_misses)
VALUES ('eval-13', 'test-mem-05', '2026-03-01', '2026-04-30', 10920000, 4800000, 0, 4);
