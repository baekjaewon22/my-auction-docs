import { Hono } from 'hono';
import type { AuthEnv } from '../types';
import { authMiddleware } from '../middleware/auth';

// KST (한국 시간) 기준 날짜
function getKSTToday(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().split('T')[0];
}

function getKSTTomorrow(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000 + 86400000);
  return kst.toISOString().split('T')[0];
}

interface JournalEntry {
  id: string;
  user_id: string;
  target_date: string;
  activity_type: string;
  activity_subtype: string;
  data: string;
  completed: number;
  fail_reason: string;
  branch: string;
  department: string;
  created_at: string;
  updated_at: string;
}

const journal = new Hono<AuthEnv>();
journal.use('*', authMiddleware);

// GET /api/journal?date=2026-03-30&range=all
journal.get('/', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const date = c.req.query('date');
  const range = c.req.query('range');

  let query = 'SELECT j.*, u.name as user_name, u.role as user_role FROM journal_entries j LEFT JOIN users u ON j.user_id = u.id';
  const conditions: string[] = [];
  const params: string[] = [];

  // Permission filter
  if (user.role === 'member') {
    conditions.push('j.user_id = ?');
    params.push(user.sub);
  } else if (user.role === 'manager') {
    conditions.push('j.branch = ?');
    conditions.push('j.department = ?');
    params.push(user.branch);
    params.push(user.department);
  } else if (user.role === 'admin' && user.branch === '의정부') {
    // 의정부 관리자: 전체 열람
  } else if (user.role === 'admin') {
    conditions.push('j.branch = ?');
    params.push(user.branch);
  }

  if (date) {
    conditions.push('j.target_date = ?');
    params.push(date);
  } else if (range === 'today') {
    conditions.push("j.target_date = date('now')");
  } else if (range === 'week') {
    conditions.push("j.target_date >= date('now', '-7 days')");
  } else if (range === 'month') {
    conditions.push("j.target_date >= date('now', '-30 days')");
  }

  if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY j.target_date DESC, j.created_at DESC';

  const stmt = db.prepare(query);
  const result = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
  return c.json({ entries: result.results });
});

// GET /api/journal/members - 권한 범위 내 전체 사용자 목록 (팀/지사별)
journal.get('/members', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  let query = 'SELECT id, name, role, branch, department, position_title FROM users WHERE approved = 1';
  const params: string[] = [];

  if (user.role === 'member') {
    query += ' AND id = ?';
    params.push(user.sub);
  } else if (user.role === 'manager') {
    query += ' AND branch = ? AND department = ?';
    params.push(user.branch);
    params.push(user.department);
  } else if (user.role === 'admin' && user.branch === '의정부') {
    // 의정부 관리자: 전체 열람
  } else if (user.role === 'admin') {
    query += ' AND branch = ?';
    params.push(user.branch);
  }

  query += " ORDER BY branch, department, CASE role WHEN 'master' THEN 1 WHEN 'ceo' THEN 2 WHEN 'admin' THEN 3 WHEN 'manager' THEN 4 WHEN 'member' THEN 5 END, name";
  const stmt = db.prepare(query);
  const result = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
  return c.json({ members: result.results });
});

// POST /api/journal
journal.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{
    target_date: string;
    activity_type: string;
    activity_subtype?: string;
    data: Record<string, unknown>;
  }>();

  if (!body.target_date || !body.activity_type) {
    return c.json({ error: '날짜와 활동 유형은 필수입니다.' }, 400);
  }

  const today = getKSTToday();
  const tomorrow = getKSTTomorrow();
  if (body.target_date !== today && body.target_date !== tomorrow) {
    return c.json({ error: '오늘 또는 내일 일정만 등록할 수 있습니다.' }, 400);
  }

  const db = c.env.DB;
  const id = crypto.randomUUID();

  await db.prepare(
    'INSERT INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, user.sub, body.target_date, body.activity_type, body.activity_subtype || '', JSON.stringify(body.data), user.branch, user.department).run();

  return c.json({ entry: { id, target_date: body.target_date, activity_type: body.activity_type } }, 201);
});

// PUT /api/journal/:id
journal.put('/:id', async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const db = c.env.DB;

  const entry = await db.prepare('SELECT * FROM journal_entries WHERE id = ?').bind(id).first<JournalEntry>();
  if (!entry) return c.json({ error: '일지를 찾을 수 없습니다.' }, 404);
  if (entry.user_id !== user.sub && user.role !== 'master') return c.json({ error: '권한이 없습니다.' }, 403);

  const today = getKSTToday();
  if (entry.target_date < today) return c.json({ error: '지난 일정은 수정할 수 없습니다.' }, 400);

  const body = await c.req.json<{
    activity_subtype?: string; data?: Record<string, unknown>; completed?: number; fail_reason?: string;
  }>();

  await db.prepare(
    "UPDATE journal_entries SET activity_subtype = ?, data = ?, completed = ?, fail_reason = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(body.activity_subtype ?? entry.activity_subtype, body.data ? JSON.stringify(body.data) : entry.data, body.completed ?? entry.completed, body.fail_reason ?? entry.fail_reason, id).run();

  return c.json({ success: true });
});

// DELETE /api/journal/:id
journal.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const db = c.env.DB;

  const entry = await db.prepare('SELECT * FROM journal_entries WHERE id = ?').bind(id).first<JournalEntry>();
  if (!entry) return c.json({ error: '일지를 찾을 수 없습니다.' }, 404);
  if (entry.user_id !== user.sub && user.role !== 'master') return c.json({ error: '권한이 없습니다.' }, 403);

  const today = getKSTToday();
  if (entry.target_date < today) return c.json({ error: '지난 일정은 삭제할 수 없습니다.' }, 400);

  await db.prepare('DELETE FROM journal_entries WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

export default journal;
