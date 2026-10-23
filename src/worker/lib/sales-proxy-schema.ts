const pending = new WeakMap<D1Database, Promise<void>>();
export function ensureSalesProxySchema(db: D1Database): Promise<void> {
  const existing = pending.get(db);
  if (existing) return existing;
  const task = (async () => {
    const fields = { proxy_agent: "TEXT NOT NULL DEFAULT ''", proxy_date: "TEXT NOT NULL DEFAULT ''", proxy_undecided: 'INTEGER NOT NULL DEFAULT 1' };
    const columns = await db.prepare('PRAGMA table_info(sales_records)').all<{ name: string }>();
    for (const [name, definition] of Object.entries(fields)) {
      if (columns.results.some(c => c.name === name)) continue;
      try { await db.prepare(`ALTER TABLE sales_records ADD COLUMN ${name} ${definition}`).run(); }
      catch (error) {
        const current = await db.prepare('PRAGMA table_info(sales_records)').all<{ name: string }>();
        if (!current.results.some(c => c.name === name)) throw error;
      }
    }
    await db.prepare(`CREATE TABLE IF NOT EXISTS sales_proxy_slack_deliveries (
      sales_id TEXT NOT NULL, proxy_date TEXT NOT NULL, status TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(sales_id, proxy_date)
    )`).run();
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_sales_proxy_date ON sales_records(proxy_date, proxy_undecided)').run();
  })().catch(error => { pending.delete(db); throw error; });
  pending.set(db, task);
  return task;
}
