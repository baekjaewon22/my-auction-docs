-- 조직 평균 활동량 (월별)
INSERT OR REPLACE INTO analytics_snapshots (scope, scope_value, ym, metric, value, last_updated)
SELECT 'org', '', ym,
  'avg_activity',
  AVG(activity_jang + activity_brief + activity_bid + activity_other) as v,
  datetime('now')
FROM user_monthly_stats
GROUP BY ym;

-- 비율제 평균 매출 (월별)
INSERT OR REPLACE INTO analytics_snapshots (scope, scope_value, ym, metric, value, last_updated)
SELECT 'paytype', 'commission', ums.ym,
  'avg_sales',
  AVG(ums.sales_confirmed) as v,
  datetime('now')
FROM user_monthly_stats ums
JOIN user_accounting ua ON ua.user_id = ums.user_id
WHERE ua.pay_type = 'commission' AND ums.sales_confirmed > 0
GROUP BY ums.ym;

-- 컨설턴트 수 (월별 — 백필 시점 기준)
INSERT OR REPLACE INTO analytics_snapshots (scope, scope_value, ym, metric, value, last_updated)
SELECT 'org', '', ym,
  'member_count',
  COUNT(DISTINCT user_id) as v,
  datetime('now')
FROM user_monthly_stats
GROUP BY ym;
