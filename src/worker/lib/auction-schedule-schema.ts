const ensurePromises = new WeakMap<object, Promise<void>>();

export async function ensureAuctionScheduleTable(db: D1Database): Promise<void> {
  const key = db as object;
  const existing = ensurePromises.get(key);
  if (existing) return existing;
  const promise = db.batch([
      db.prepare(`
        CREATE TABLE IF NOT EXISTS freelancer_auction_schedules (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          target_date TEXT NOT NULL,
          activity_type TEXT NOT NULL CHECK (activity_type IN ('입찰', '임장', '미팅')),
          activity_subtype TEXT NOT NULL DEFAULT '',
          data TEXT NOT NULL DEFAULT '{}',
          branch TEXT NOT NULL DEFAULT '',
          department TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
          FOREIGN KEY (user_id) REFERENCES users(id)
        )
      `),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_freelancer_schedule_user_date ON freelancer_auction_schedules(user_id, target_date)'),
      db.prepare('CREATE INDEX IF NOT EXISTS idx_freelancer_schedule_scope_date ON freelancer_auction_schedules(branch, department, target_date)'),
    ]).then(() => undefined);
  ensurePromises.set(key, promise);
  try {
    await promise;
  } catch (error) {
    ensurePromises.delete(key);
    throw error;
  }
}
