-- 종합분석 캐시 백필 — 데이터가 있는 컨설턴트의 월별 집계 일괄 INSERT
-- 한 번 실행 후엔 cron이 자동 갱신
INSERT OR REPLACE INTO user_monthly_stats (
  user_id, ym,
  sales_confirmed, sales_pending, sales_refunded, sales_count, refund_count,
  activity_jang, activity_brief, activity_bid, activity_other,
  bid_won_count, deviation_count, journal_days, last_updated
)
WITH consultants AS (
  SELECT id FROM users
  WHERE role NOT IN ('master','ceo','cc_ref','accountant','accountant_asst','support','resigned')
    AND branch != '본사 관리'
    AND (department IS NULL OR department NOT IN ('명도팀','지원팀'))
    AND id != '2b6b3606-e425-4361-a115-9283cfef842f'
    AND login_type != 'freelancer-old'
),
months AS (
  SELECT DISTINCT user_id, substr(contract_date,1,7) as ym
  FROM sales_records
  WHERE direction != 'expense' AND COALESCE(exclude_from_count, 0) = 0 AND user_id IN (SELECT id FROM consultants)
  UNION
  SELECT DISTINCT user_id, substr(target_date,1,7)
  FROM journal_entries
  WHERE user_id IN (SELECT id FROM consultants)
)
SELECT
  m.user_id, m.ym,
  COALESCE((SELECT SUM(amount) FROM sales_records WHERE user_id = m.user_id AND substr(contract_date,1,7) = m.ym AND status IN ('confirmed','card_pending') AND direction != 'expense' AND COALESCE(exclude_from_count, 0) = 0), 0),
  COALESCE((SELECT SUM(amount) FROM sales_records WHERE user_id = m.user_id AND substr(contract_date,1,7) = m.ym AND status = 'pending' AND direction != 'expense' AND COALESCE(exclude_from_count, 0) = 0), 0),
  COALESCE((SELECT SUM(amount) FROM sales_records WHERE user_id = m.user_id AND substr(contract_date,1,7) = m.ym AND status = 'refunded' AND direction != 'expense' AND COALESCE(exclude_from_count, 0) = 0), 0),
  COALESCE((SELECT COUNT(*) FROM sales_records WHERE user_id = m.user_id AND substr(contract_date,1,7) = m.ym AND direction != 'expense' AND COALESCE(exclude_from_count, 0) = 0), 0),
  COALESCE((SELECT COUNT(*) FROM sales_records WHERE user_id = m.user_id AND substr(contract_date,1,7) = m.ym AND status = 'refunded' AND direction != 'expense' AND COALESCE(exclude_from_count, 0) = 0), 0),
  COALESCE((SELECT COUNT(*) FROM journal_entries WHERE user_id = m.user_id AND substr(target_date,1,7) = m.ym AND activity_type = '임장'), 0),
  COALESCE((SELECT COUNT(*) FROM journal_entries WHERE user_id = m.user_id AND substr(target_date,1,7) = m.ym AND activity_type = '브리핑'), 0),
  COALESCE((SELECT COUNT(*) FROM journal_entries WHERE user_id = m.user_id AND substr(target_date,1,7) = m.ym AND activity_type = '입찰'), 0),
  COALESCE((SELECT COUNT(*) FROM journal_entries WHERE user_id = m.user_id AND substr(target_date,1,7) = m.ym AND activity_type IN ('미팅','사무','개인')), 0),
  COALESCE((SELECT COUNT(*) FROM journal_entries WHERE user_id = m.user_id AND substr(target_date,1,7) = m.ym AND activity_type = '입찰' AND (data LIKE '%"bidWon":true%' OR data LIKE '%"bidWon":1%')), 0),
  COALESCE((SELECT COUNT(*) FROM journal_entries WHERE user_id = m.user_id AND substr(target_date,1,7) = m.ym AND activity_type = '입찰' AND data LIKE '%deviationReason%'), 0),
  COALESCE((SELECT COUNT(DISTINCT target_date) FROM journal_entries WHERE user_id = m.user_id AND substr(target_date,1,7) = m.ym), 0),
  datetime('now')
FROM months m;
