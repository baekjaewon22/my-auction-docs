import { Hono } from 'hono';
import type { AuthEnv } from '../types';
import { authMiddleware, requireRole } from '../middleware/auth';
import { refreshScheduleGapForUserDate } from '../lib/journal-alerts';

type HolidayType = 'legal' | 'substitute' | 'temporary' | 'company';
type HolidayAppliesTo = 'all' | 'journal' | 'leave' | 'statistics';

interface SystemHoliday {
  id: string;
  holiday_date: string;
  name: string;
  holiday_type: HolidayType;
  applies_to: HolidayAppliesTo;
  enabled: number;
  memo: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const systemSettings = new Hono<AuthEnv>();
systemSettings.use('*', authMiddleware);

const READ_ROLES = ['master', 'ceo', 'admin', 'accountant'] as const;
const WRITE_ROLES = ['master', 'ceo', 'admin'] as const;
const TYPES = new Set<HolidayType>(['legal', 'substitute', 'temporary', 'company']);
const APPLIES_TO = new Set<HolidayAppliesTo>(['all', 'journal', 'leave', 'statistics']);

async function recheckJournalAlertsForDate(db: D1Database, holidayDate: string): Promise<void> {
  if (!holidayDate) return;
  const users = await db.prepare(
    'SELECT DISTINCT user_id FROM journal_entries WHERE target_date = ?'
  ).bind(holidayDate).all<{ user_id: string }>();
  for (const row of users.results || []) {
    await refreshScheduleGapForUserDate(db, row.user_id, holidayDate);
  }
}

function normalizeDate(value: unknown): string {
  const date = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  return date;
}

function normalizeType(value: unknown): HolidayType {
  const type = String(value || 'legal') as HolidayType;
  return TYPES.has(type) ? type : 'legal';
}

function normalizeAppliesTo(value: unknown): HolidayAppliesTo {
  const appliesTo = String(value || 'all') as HolidayAppliesTo;
  return APPLIES_TO.has(appliesTo) ? appliesTo : 'all';
}

systemSettings.get('/holidays', requireRole(...READ_ROLES), async (c) => {
  const db = c.env.DB;
  const year = String(c.req.query('year') || new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCFullYear()).slice(0, 4);
  const result = await db.prepare(`
    SELECT id, holiday_date, name, holiday_type, applies_to, enabled, memo, created_by, created_at, updated_at
    FROM system_holidays
    WHERE substr(holiday_date, 1, 4) = ?
    ORDER BY holiday_date ASC
  `).bind(year).all<SystemHoliday>();
  return c.json({ holidays: result.results || [] });
});

systemSettings.post('/holidays', requireRole(...WRITE_ROLES), async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const body = await c.req.json<Record<string, unknown>>();
  const holidayDate = normalizeDate(body.holiday_date);
  const name = String(body.name || '').trim();

  if (!holidayDate) return c.json({ error: '공휴일 날짜를 YYYY-MM-DD 형식으로 입력해주세요.' }, 400);
  if (!name) return c.json({ error: '공휴일 이름을 입력해주세요.' }, 400);

  const existing = await db.prepare('SELECT id FROM system_holidays WHERE holiday_date = ?')
    .bind(holidayDate)
    .first<{ id: string }>();
  const id = existing?.id || crypto.randomUUID();

  await db.prepare(`
    INSERT INTO system_holidays (
      id, holiday_date, name, holiday_type, applies_to, enabled, memo, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+9 hours'), datetime('now', '+9 hours'))
    ON CONFLICT(holiday_date) DO UPDATE SET
      name = excluded.name,
      holiday_type = excluded.holiday_type,
      applies_to = excluded.applies_to,
      enabled = excluded.enabled,
      memo = excluded.memo,
      updated_at = datetime('now', '+9 hours')
  `).bind(
    id,
    holidayDate,
    name,
    normalizeType(body.holiday_type),
    normalizeAppliesTo(body.applies_to),
    body.enabled === false || body.enabled === 0 ? 0 : 1,
    String(body.memo || '').trim(),
    user.sub
  ).run();

  const holiday = await db.prepare('SELECT * FROM system_holidays WHERE id = ?')
    .bind(id)
    .first<SystemHoliday>();
  await recheckJournalAlertsForDate(db, holidayDate)
    .catch((error) => console.error('[system holidays] journal alert refresh failed', error));
  return c.json({ holiday }, existing ? 200 : 201);
});

systemSettings.put('/holidays/:id', requireRole(...WRITE_ROLES), async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const body = await c.req.json<Record<string, unknown>>();
  const holidayDate = normalizeDate(body.holiday_date);
  const name = String(body.name || '').trim();

  if (!holidayDate) return c.json({ error: '공휴일 날짜를 YYYY-MM-DD 형식으로 입력해주세요.' }, 400);
  if (!name) return c.json({ error: '공휴일 이름을 입력해주세요.' }, 400);

  const existing = await db.prepare('SELECT id, holiday_date FROM system_holidays WHERE id = ?')
    .bind(id)
    .first<{ id: string; holiday_date: string }>();
  if (!existing) return c.json({ error: '공휴일 설정을 찾을 수 없습니다.' }, 404);

  await db.prepare(`
    UPDATE system_holidays
    SET holiday_date = ?, name = ?, holiday_type = ?, applies_to = ?, enabled = ?, memo = ?, updated_at = datetime('now', '+9 hours')
    WHERE id = ?
  `).bind(
    holidayDate,
    name,
    normalizeType(body.holiday_type),
    normalizeAppliesTo(body.applies_to),
    body.enabled === false || body.enabled === 0 ? 0 : 1,
    String(body.memo || '').trim(),
    id
  ).run();

  const holiday = await db.prepare('SELECT * FROM system_holidays WHERE id = ?')
    .bind(id)
    .first<SystemHoliday>();
  for (const date of new Set([existing.holiday_date, holidayDate])) {
    await recheckJournalAlertsForDate(db, date)
      .catch((error) => console.error('[system holidays] journal alert refresh failed', error));
  }
  return c.json({ holiday });
});

systemSettings.delete('/holidays/:id', requireRole(...WRITE_ROLES), async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const existing = await db.prepare('SELECT holiday_date FROM system_holidays WHERE id = ?')
    .bind(id)
    .first<{ holiday_date: string }>();
  await db.prepare('DELETE FROM system_holidays WHERE id = ?').bind(id).run();
  if (existing?.holiday_date) {
    await recheckJournalAlertsForDate(db, existing.holiday_date)
      .catch((error) => console.error('[system holidays] journal alert refresh failed', error));
  }
  return c.json({ success: true });
});

export default systemSettings;
