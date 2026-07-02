import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import type { AuthEnv } from '../types';

const auctionReference = new Hono<AuthEnv>();

auctionReference.use('*', authMiddleware);

async function ensureReferenceTable(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS auction_reference_items (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  await db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_auction_reference_items_type
    ON auction_reference_items(type)
  `).run();
  const columns = await db.prepare('PRAGMA table_info(auction_reference_items)').all<{ name: string }>();
  const names = new Set((columns.results || []).map((col) => col.name));
  if (!names.has('category')) {
    await db.prepare("ALTER TABLE auction_reference_items ADD COLUMN category TEXT NOT NULL DEFAULT ''").run();
  }
}

function requireMaster(c: any) {
  const user = c.get('user');
  if (String(user?.role || '').toLowerCase() !== 'master') {
    return c.json({ error: '경매 참조 문구 관리는 마스터 권한만 사용할 수 있습니다.' }, 403);
  }
  return null;
}

function normalizeType(type: string) {
  if (!['rights', 'legal', 'checklist'].includes(type)) return '';
  return type;
}

auctionReference.get('/items', async (c) => {
  const masterError = requireMaster(c);
  if (masterError) return masterError;

  const type = normalizeType(c.req.query('type') || '');
  await ensureReferenceTable(c.env.DB);
  const query = type
    ? c.env.DB.prepare('SELECT id, type, category, title, content, created_at, updated_at FROM auction_reference_items WHERE type = ? ORDER BY updated_at DESC').bind(type)
    : c.env.DB.prepare('SELECT id, type, category, title, content, created_at, updated_at FROM auction_reference_items ORDER BY type, updated_at DESC');
  const rows = await query.all();
  return c.json({ items: rows.results || [] });
});

auctionReference.post('/items', async (c) => {
  const masterError = requireMaster(c);
  if (masterError) return masterError;

  const user = c.get('user');
  const body = await c.req.json<any>();
  const type = normalizeType(String(body.type || ''));
  const category = String(body.category || '').trim();
  const title = String(body.title || '').trim();
  const content = String(body.content || '').trim();
  if (!type || !title || !content) {
    return c.json({ error: '종류, 제목, 내용을 모두 입력해 주세요.' }, 400);
  }
  const id = String(body.id || `${type}:custom:${crypto.randomUUID()}`).trim();

  await ensureReferenceTable(c.env.DB);
  await c.env.DB.prepare(`
    INSERT INTO auction_reference_items (id, type, category, title, content, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      type = excluded.type,
      category = excluded.category,
      title = excluded.title,
      content = excluded.content,
      updated_at = CURRENT_TIMESTAMP
  `).bind(id, type, category, title, content, user?.sub || null).run();

  return c.json({ success: true, item: { id, type, category, title, content } });
});

auctionReference.delete('/items/:id', async (c) => {
  const masterError = requireMaster(c);
  if (masterError) return masterError;

  await ensureReferenceTable(c.env.DB);
  await c.env.DB.prepare('DELETE FROM auction_reference_items WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ success: true });
});

export default auctionReference;
