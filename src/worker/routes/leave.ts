import { Hono } from 'hono';
import type { AuthEnv } from '../types';
import { authMiddleware, requireRole } from '../middleware/auth';

const leave = new Hono<AuthEnv>();
leave.use('*', authMiddleware);

// GET /api/leave - 연차 목록 (관리자+)
leave.get('/', requireRole('master', 'ceo', 'admin', 'manager'), async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  let query = `SELECT al.*, u.name as user_name, u.branch, u.department, u.role as user_role
    FROM annual_leave al LEFT JOIN users u ON al.user_id = u.id WHERE 1=1`;
  const params: string[] = [];

  if (user.role === 'admin') {
    query += ' AND u.branch = ?';
    params.push(user.branch);
  } else if (user.role === 'manager') {
    query += ' AND u.branch = ? AND u.department = ?';
    params.push(user.branch);
    params.push(user.department);
  }

  query += ' ORDER BY u.branch, u.department, u.name';
  const stmt = db.prepare(query);
  const result = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
  return c.json({ leaves: result.results });
});

// GET /api/leave/me - 본인 연차
leave.get('/me', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const leave = await db.prepare('SELECT * FROM annual_leave WHERE user_id = ?').bind(user.sub).first();
  return c.json({ leave: leave || { total_days: 15, used_days: 0 } });
});

// POST /api/leave/init - 사용자 연차 초기화 (관리자+)
leave.post('/init', requireRole('master', 'ceo', 'admin'), async (c) => {
  const { user_id, total_days } = await c.req.json<{ user_id: string; total_days: number }>();
  const db = c.env.DB;

  const existing = await db.prepare('SELECT id FROM annual_leave WHERE user_id = ?').bind(user_id).first();
  if (existing) {
    await db.prepare("UPDATE annual_leave SET total_days = ?, updated_at = datetime('now') WHERE user_id = ?")
      .bind(total_days, user_id).run();
  } else {
    await db.prepare('INSERT INTO annual_leave (id, user_id, total_days, used_days) VALUES (?, ?, ?, 0)')
      .bind(crypto.randomUUID(), user_id, total_days).run();
  }
  return c.json({ success: true });
});

// PUT /api/leave/:userId - 연차 수정 (관리자+)
leave.put('/:userId', requireRole('master', 'ceo', 'admin'), async (c) => {
  const userId = c.req.param('userId');
  const { total_days, used_days } = await c.req.json<{ total_days?: number; used_days?: number }>();
  const db = c.env.DB;

  const existing = await db.prepare('SELECT * FROM annual_leave WHERE user_id = ?').bind(userId).first<any>();
  if (!existing) return c.json({ error: '연차 정보가 없습니다.' }, 404);

  await db.prepare("UPDATE annual_leave SET total_days = ?, used_days = ?, updated_at = datetime('now') WHERE user_id = ?")
    .bind(total_days ?? existing.total_days, used_days ?? existing.used_days, userId).run();
  return c.json({ success: true });
});

// POST /api/leave/deduct - 연차 차감 (문서 승인 시 호출)
leave.post('/deduct', requireRole('master', 'ceo', 'admin', 'manager'), async (c) => {
  const { user_id, days } = await c.req.json<{ user_id: string; days: number }>();
  const db = c.env.DB;

  // 연차 레코드 없으면 기본값으로 생성
  let existing = await db.prepare('SELECT * FROM annual_leave WHERE user_id = ?').bind(user_id).first<any>();
  if (!existing) {
    await db.prepare('INSERT INTO annual_leave (id, user_id, total_days, used_days) VALUES (?, ?, 15, 0)')
      .bind(crypto.randomUUID(), user_id).run();
    existing = { total_days: 15, used_days: 0 };
  }

  const newUsed = existing.used_days + days;
  await db.prepare("UPDATE annual_leave SET used_days = ?, updated_at = datetime('now') WHERE user_id = ?")
    .bind(newUsed, user_id).run();

  return c.json({ success: true, used_days: newUsed, remaining: existing.total_days - newUsed });
});

export default leave;
