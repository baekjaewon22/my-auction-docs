-- 종합분석 통계 캐시 — 매일/매월 cron으로 갱신
-- 1) 직원별 월 합계 (원본의 SUM 결과 캐시)
CREATE TABLE IF NOT EXISTS user_monthly_stats (
  user_id TEXT NOT NULL,
  ym TEXT NOT NULL,                          -- 'YYYY-MM'
  sales_confirmed INTEGER NOT NULL DEFAULT 0,
  sales_pending INTEGER NOT NULL DEFAULT 0,
  sales_refunded INTEGER NOT NULL DEFAULT 0,
  sales_count INTEGER NOT NULL DEFAULT 0,
  refund_count INTEGER NOT NULL DEFAULT 0,
  activity_jang INTEGER NOT NULL DEFAULT 0,    -- 임장
  activity_brief INTEGER NOT NULL DEFAULT 0,   -- 브리핑
  activity_bid INTEGER NOT NULL DEFAULT 0,     -- 입찰
  activity_other INTEGER NOT NULL DEFAULT 0,   -- 미팅+사무+개인
  bid_won_count INTEGER NOT NULL DEFAULT 0,    -- 낙찰 (data.bidWon=true)
  deviation_count INTEGER NOT NULL DEFAULT 0,  -- 5% 편차 (data.deviationReason)
  journal_days INTEGER NOT NULL DEFAULT 0,     -- DISTINCT 작성일자 수
  last_updated TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, ym)
);
CREATE INDEX IF NOT EXISTS idx_ums_ym ON user_monthly_stats(ym);
CREATE INDEX IF NOT EXISTS idx_ums_user ON user_monthly_stats(user_id);

-- 2) 조직 단위 집계 키-값 (지사/팀/전사 평균, 비율제 평균 등)
CREATE TABLE IF NOT EXISTS analytics_snapshots (
  scope TEXT NOT NULL,            -- 'org' | 'branch' | 'paytype'
  scope_value TEXT NOT NULL,       -- '' | '의정부' | 'commission'
  ym TEXT NOT NULL,                -- 'YYYY-MM'
  metric TEXT NOT NULL,            -- 'avg_activity' | 'avg_sales' | 'freelancer_avg_sales' | 'member_count'
  value REAL NOT NULL,
  last_updated TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (scope, scope_value, ym, metric)
);
CREATE INDEX IF NOT EXISTS idx_snap_lookup ON analytics_snapshots(ym, metric);
