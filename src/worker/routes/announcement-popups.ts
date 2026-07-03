import { Hono } from 'hono';
import type { AuthEnv } from '../types';
import { authMiddleware, requireRole } from '../middleware/auth';

const announcementPopups = new Hono<AuthEnv>();
announcementPopups.use('*', authMiddleware);

const WRITE_ROLES = ['master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst'] as const;

async function ensurePopupSchema(db: D1Database): Promise<void> {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS announcement_popups (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      start_at TEXT,
      end_at TEXT,
      dismiss_days INTEGER NOT NULL DEFAULT 7,
      created_by TEXT,
      updated_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours'))
    )
  `).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_announcement_popups_active ON announcement_popups(enabled, start_at, end_at)').run();

  await db.prepare(`
    INSERT OR IGNORE INTO announcement_popups (
      id, title, content, enabled, start_at, end_at, dismiss_days, created_by, updated_by
    ) VALUES (?, ?, ?, 1, date('now', '+9 hours'), NULL, 7, 'system', 'system')
  `).bind(
    'template-change-myungseung-20260703',
    '브리핑 자료 및 권리분석보증서 템플릿 변경 안내',
    `법무법인 명승으로 변경됨에 따라 브리핑 자료 및 권리분석보증서 템플릿이 변경되었습니다.

현재 작성 중인 자료가 있는 경우에는 기존 템플릿을 그대로 사용해 주시고,
다음 주부터 제출되는 자료는 변경된 템플릿을 사용해 주시기 바랍니다.

변경된 자료는
마이옥션 오피스 > 사내 커뮤니티 > 자료실에서 다운로드하실 수 있습니다.

또한 계약서 등 관련 서류는 이폼사인에 변경 사항 반영이 완료되었습니다.`,
  ).run();
}

function normalizeDateTime(value: unknown): string {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) return text.slice(0, 16).replace('T', ' ');
  return '';
}

announcementPopups.get('/active', async (c) => {
  const db = c.env.DB;
  await ensurePopupSchema(db);
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ');
  const popup = await db.prepare(`
    SELECT *
    FROM announcement_popups
    WHERE enabled = 1
      AND (start_at IS NULL OR start_at = '' OR start_at <= ?)
      AND (end_at IS NULL OR end_at = '' OR end_at >= ?)
    ORDER BY updated_at DESC
    LIMIT 1
  `).bind(now, now).first<any>();
  return c.json({ popup: popup || null });
});

announcementPopups.get('/', requireRole(...WRITE_ROLES), async (c) => {
  const db = c.env.DB;
  await ensurePopupSchema(db);
  const result = await db.prepare('SELECT * FROM announcement_popups ORDER BY enabled DESC, updated_at DESC').all();
  return c.json({ popups: result.results || [] });
});

announcementPopups.post('/', requireRole(...WRITE_ROLES), async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  await ensurePopupSchema(db);
  const body = await c.req.json<Record<string, unknown>>();
  const title = String(body.title || '').trim();
  const content = String(body.content || '').trim();
  if (!title) return c.json({ error: '팝업 제목을 입력해주세요.' }, 400);
  if (!content) return c.json({ error: '팝업 내용을 입력해주세요.' }, 400);
  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO announcement_popups (
      id, title, content, enabled, start_at, end_at, dismiss_days, created_by, updated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    title,
    content,
    body.enabled === false || body.enabled === 0 ? 0 : 1,
    normalizeDateTime(body.start_at),
    normalizeDateTime(body.end_at),
    Math.max(1, Math.min(30, Number(body.dismiss_days || 7))),
    user.sub,
    user.sub,
  ).run();
  return c.json({ success: true, id });
});

announcementPopups.put('/:id', requireRole(...WRITE_ROLES), async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  await ensurePopupSchema(db);
  const id = c.req.param('id');
  const body = await c.req.json<Record<string, unknown>>();
  const title = String(body.title || '').trim();
  const content = String(body.content || '').trim();
  if (!title) return c.json({ error: '팝업 제목을 입력해주세요.' }, 400);
  if (!content) return c.json({ error: '팝업 내용을 입력해주세요.' }, 400);
  await db.prepare(`
    UPDATE announcement_popups
    SET title = ?, content = ?, enabled = ?, start_at = ?, end_at = ?, dismiss_days = ?,
        updated_by = ?, updated_at = datetime('now', '+9 hours')
    WHERE id = ?
  `).bind(
    title,
    content,
    body.enabled === false || body.enabled === 0 ? 0 : 1,
    normalizeDateTime(body.start_at),
    normalizeDateTime(body.end_at),
    Math.max(1, Math.min(30, Number(body.dismiss_days || 7))),
    user.sub,
    id,
  ).run();
  return c.json({ success: true });
});

announcementPopups.post('/:id/end', requireRole(...WRITE_ROLES), async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  await ensurePopupSchema(db);
  await db.prepare(`
    UPDATE announcement_popups
    SET enabled = 0, end_at = datetime('now', '+9 hours'), updated_by = ?, updated_at = datetime('now', '+9 hours')
    WHERE id = ?
  `).bind(user.sub, c.req.param('id')).run();
  return c.json({ success: true });
});

announcementPopups.delete('/:id', requireRole('master', 'ceo', 'admin'), async (c) => {
  const db = c.env.DB;
  await ensurePopupSchema(db);
  await db.prepare('DELETE FROM announcement_popups WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ success: true });
});

export default announcementPopups;
