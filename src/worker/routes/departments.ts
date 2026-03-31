import { Hono } from 'hono';
import type { AuthEnv } from '../types';
import { authMiddleware, requireRole } from '../middleware/auth';

const departments = new Hono<AuthEnv>();

// GET /api/departments - 전체 목록 (인증 불필요 - 가입 시에도 필요)
departments.get('/', async (c) => {
  const db = c.env.DB;
  const result = await db.prepare('SELECT * FROM departments ORDER BY sort_order, name').all();
  return c.json({ departments: result.results });
});

// POST /api/departments (관리자+)
departments.post('/', authMiddleware, requireRole('master', 'ceo', 'admin'), async (c) => {
  const { name, branch } = await c.req.json<{ name: string; branch?: string }>();
  if (!name) return c.json({ error: '팀 이름은 필수입니다.' }, 400);

  const db = c.env.DB;
  const existing = await db.prepare('SELECT id FROM departments WHERE name = ?').bind(name).first();
  if (existing) return c.json({ error: '이미 존재하는 팀 이름입니다.' }, 409);

  const id = crypto.randomUUID();
  const maxOrder = await db.prepare('SELECT MAX(sort_order) as m FROM departments').first<{ m: number }>();
  const order = (maxOrder?.m || 0) + 1;

  await db.prepare('INSERT INTO departments (id, name, branch, sort_order) VALUES (?, ?, ?, ?)')
    .bind(id, name, branch || '', order).run();

  return c.json({ department: { id, name } }, 201);
});

// PUT /api/departments/:id (관리자+)
departments.put('/:id', authMiddleware, requireRole('master', 'ceo', 'admin'), async (c) => {
  const id = c.req.param('id');
  const { name, branch, sort_order } = await c.req.json<{ name?: string; branch?: string; sort_order?: number }>();
  const db = c.env.DB;

  const existing = await db.prepare('SELECT * FROM departments WHERE id = ?').bind(id).first<any>();
  if (!existing) return c.json({ error: '팀을 찾을 수 없습니다.' }, 404);

  await db.prepare('UPDATE departments SET name = ?, branch = ?, sort_order = ? WHERE id = ?')
    .bind(name || existing.name, branch ?? existing.branch, sort_order ?? existing.sort_order, id).run();

  return c.json({ success: true });
});

// DELETE /api/departments/:id (관리자+)
departments.delete('/:id', authMiddleware, requireRole('master', 'ceo', 'admin'), async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  await db.prepare('DELETE FROM departments WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

export default departments;
