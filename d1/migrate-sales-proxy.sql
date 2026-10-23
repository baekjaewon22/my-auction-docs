-- Apply once only. Runtime ensureSalesProxySchema also supports existing databases.
ALTER TABLE sales_records ADD COLUMN proxy_agent TEXT NOT NULL DEFAULT '';
ALTER TABLE sales_records ADD COLUMN proxy_date TEXT NOT NULL DEFAULT '';
ALTER TABLE sales_records ADD COLUMN proxy_undecided INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_sales_proxy_date ON sales_records(proxy_date, proxy_undecided);
CREATE TABLE IF NOT EXISTS sales_proxy_slack_deliveries (
  sales_id TEXT NOT NULL, proxy_date TEXT NOT NULL, status TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(sales_id, proxy_date)
);
