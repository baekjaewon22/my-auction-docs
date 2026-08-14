const schemaReady = new WeakMap<object, Promise<void>>();

export function normalizeLawitgoConsultantId(value: unknown): string {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!id || id.length > 200 || /[\u0000-\u001f\u007f]/.test(id)) return '';
  return id;
}

export async function ensureLawitgoConsultantMappingSchema(db: D1Database): Promise<void> {
  const key = db as unknown as object;
  const pending = schemaReady.get(key);
  if (pending) return pending;

  const setup = (async () => {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS lawitgo_consultant_mappings (
        user_id TEXT PRIMARY KEY,
        consultant_id TEXT NOT NULL UNIQUE,
        updated_by TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `).run();
    // 기존 연동은 my-docs users.id를 consultantId로 사용했으므로 안전하게 동일 값으로 이관한다.
    await db.prepare(`
      INSERT OR IGNORE INTO lawitgo_consultant_mappings (user_id, consultant_id, updated_by)
      SELECT id, id, 'system-migration'
      FROM users
      WHERE approved = 1 AND role != 'resigned'
    `).run();
  })();

  schemaReady.set(key, setup);
  try {
    await setup;
  } catch (error) {
    schemaReady.delete(key);
    throw error;
  }
}

export async function resolveLawitgoConsultantId(db: D1Database, userId: string): Promise<string | null> {
  await ensureLawitgoConsultantMappingSchema(db);
  let mapping = await db.prepare(`
    SELECT m.consultant_id
    FROM lawitgo_consultant_mappings m
    INNER JOIN users u ON u.id = m.user_id
    WHERE m.user_id = ? AND u.approved = 1 AND u.role != 'resigned'
    LIMIT 1
  `).bind(userId).first<{ consultant_id: string }>();
  if (!mapping) {
    const active = await db.prepare(`
      SELECT id FROM users WHERE id = ? AND approved = 1 AND role != 'resigned' LIMIT 1
    `).bind(userId).first<{ id: string }>();
    if (!active) return null;
    await db.prepare(`
      INSERT OR IGNORE INTO lawitgo_consultant_mappings (user_id, consultant_id, updated_by)
      VALUES (?, ?, 'system-auto-map')
    `).bind(active.id, active.id).run();
    mapping = { consultant_id: active.id };
  }
  return normalizeLawitgoConsultantId(mapping?.consultant_id) || null;
}

export type ActiveLawitgoConsultantMapping = {
  userId: string;
  consultantId: string;
  userName: string;
};

export async function listActiveLawitgoConsultantMappings(db: D1Database): Promise<ActiveLawitgoConsultantMapping[]> {
  await ensureLawitgoConsultantMappingSchema(db);
  const result = await db.prepare(`
    SELECT m.user_id, m.consultant_id, u.name AS user_name
    FROM lawitgo_consultant_mappings m
    INNER JOIN users u ON u.id = m.user_id
    WHERE u.approved = 1 AND u.role != 'resigned'
    ORDER BY u.name, m.user_id
  `).all<{ user_id: string; consultant_id: string; user_name: string }>();
  return (result.results || []).flatMap((row) => {
    const consultantId = normalizeLawitgoConsultantId(row.consultant_id);
    return consultantId ? [{ userId: row.user_id, consultantId, userName: row.user_name || '' }] : [];
  });
}

export async function saveLawitgoConsultantId(
  db: D1Database,
  userId: string,
  consultantId: string,
  updatedBy: string,
): Promise<void> {
  await ensureLawitgoConsultantMappingSchema(db);
  await db.prepare(`
    INSERT INTO lawitgo_consultant_mappings (user_id, consultant_id, updated_by, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      consultant_id = excluded.consultant_id,
      updated_by = excluded.updated_by,
      updated_at = datetime('now')
  `).bind(userId, consultantId, updatedBy).run();
}
