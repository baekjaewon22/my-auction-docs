import { Hono } from 'hono';
import type { AuthEnv, User } from '../types';
import { authMiddleware, requireRole, hashPassword } from '../middleware/auth';

const users = new Hono<AuthEnv>();
users.use('*', authMiddleware);

// GET /api/users
users.get('/', requireRole('master', 'ceo', 'admin', 'manager'), async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  let query = 'SELECT id, email, name, phone, role, team_id, branch, department, approved, created_at FROM users WHERE approved = 1';
  const params: string[] = [];

  if (user.role === 'admin' && user.branch === '의정부') {
    // 의정부 관리자: 전체 열람 가능
  } else if (user.role === 'admin') {
    query += ' AND branch = ?';
    params.push(user.branch);
  } else if (user.role === 'manager') {
    query += ' AND branch = ? AND department = ?';
    params.push(user.branch);
    params.push(user.department);
  }

  query += ' ORDER BY created_at DESC';
  const stmt = db.prepare(query);
  const result = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
  return c.json({ users: result.results });
});

// GET /api/users/pending - 승인 대기 목록 (admin+)
users.get('/pending', requireRole('master', 'ceo', 'admin'), async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  let query = 'SELECT id, email, name, phone, branch, created_at FROM users WHERE approved = 0';
  const params: string[] = [];

  if (user.role === 'admin') {
    query += ' AND branch = ?';
    params.push(user.branch);
  }

  query += ' ORDER BY created_at ASC';
  const stmt = db.prepare(query);
  const result = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
  return c.json({ users: result.results });
});

// POST /api/users/:id/approve - 가입 승인 (admin+)
users.post('/:id/approve', requireRole('master', 'ceo', 'admin'), async (c) => {
  const id = c.req.param('id');
  const { department } = await c.req.json<{ department?: string }>();
  const db = c.env.DB;

  const existing = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<User>();
  if (!existing) return c.json({ error: '사용자를 찾을 수 없습니다.' }, 404);
  if (existing.approved) return c.json({ error: '이미 승인된 사용자입니다.' }, 400);

  await db.prepare(
    "UPDATE users SET approved = 1, department = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(department || '', id).run();

  return c.json({ success: true });
});

// POST /api/users/:id/reject - 가입 거절 (admin+)
users.post('/:id/reject', requireRole('master', 'ceo', 'admin'), async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;

  await db.prepare('DELETE FROM users WHERE id = ? AND approved = 0').bind(id).run();
  return c.json({ success: true });
});

// PUT /api/users/:id/role - 역할/지사/팀 변경
users.put('/:id/role', requireRole('master', 'ceo', 'admin'), async (c) => {
  const id = c.req.param('id');
  const currentUser = c.get('user');
  const { role, branch, department } = await c.req.json<{ role?: string; branch?: string; department?: string }>();
  const db = c.env.DB;

  if (role && !['master', 'ceo', 'admin', 'manager', 'member'].includes(role)) {
    return c.json({ error: '유효하지 않은 역할입니다.' }, 400);
  }

  const existing = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<User>();
  if (!existing) return c.json({ error: '사용자를 찾을 수 없습니다.' }, 404);

  // 관리자는 본인 지사 사용자만 수정 가능
  if (currentUser.role === 'admin' && existing.branch !== currentUser.branch) {
    return c.json({ error: '본인 지사 사용자만 수정할 수 있습니다.' }, 403);
  }

  const newRole = role || existing.role;

  if (newRole === 'master' && currentUser.role !== 'master') {
    return c.json({ error: '마스터 권한은 마스터만 설정할 수 있습니다.' }, 403);
  }
  if (newRole === 'ceo' && currentUser.role !== 'master') {
    return c.json({ error: '대표 권한은 마스터만 설정할 수 있습니다.' }, 403);
  }
  if (newRole === 'admin' && currentUser.role !== 'master' && currentUser.role !== 'ceo') {
    return c.json({ error: '관리자 등급 설정은 대표 이상만 가능합니다.' }, 403);
  }
  if (currentUser.role === 'admin' && (newRole !== 'manager' && newRole !== 'member' && newRole !== existing.role)) {
    return c.json({ error: '관리자는 팀장/팀원 직책만 변경할 수 있습니다.' }, 403);
  }

  await db.prepare(
    "UPDATE users SET role = ?, branch = ?, department = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(newRole, branch ?? existing.branch, department ?? existing.department, id).run();

  return c.json({ success: true });
});

// DELETE /api/users/:id - 사용자 삭제
// 관리자: 팀장/팀원 삭제 가능
// 대표: 관리자 이하 삭제 가능
// 마스터: 전부 삭제 가능 (본인 제외)
users.delete('/:id', requireRole('master', 'ceo', 'admin'), async (c) => {
  const id = c.req.param('id');
  const currentUser = c.get('user');
  const db = c.env.DB;

  if (id === currentUser.sub) return c.json({ error: '본인 계정은 삭제할 수 없습니다.' }, 400);

  const target = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<User>();
  if (!target) return c.json({ error: '사용자를 찾을 수 없습니다.' }, 404);

  // 관리자는 본인 지사 사용자만 삭제 가능
  if (currentUser.role === 'admin' && target.branch !== currentUser.branch) {
    return c.json({ error: '본인 지사 사용자만 삭제할 수 있습니다.' }, 403);
  }

  const hierarchy: Record<string, number> = { master: 1, ceo: 2, admin: 3, manager: 4, member: 5 };
  const myLevel = hierarchy[currentUser.role] || 99;
  const targetLevel = hierarchy[target.role] || 99;

  if (targetLevel <= myLevel) {
    return c.json({ error: '본인과 같거나 상위 등급은 삭제할 수 없습니다.' }, 403);
  }

  // Delete related data
  await db.prepare('DELETE FROM journal_entries WHERE user_id = ?').bind(id).run();
  await db.prepare('DELETE FROM signatures WHERE user_id = ?').bind(id).run();
  await db.prepare('DELETE FROM document_logs WHERE user_id = ?').bind(id).run();
  await db.prepare('DELETE FROM documents WHERE author_id = ?').bind(id).run();
  await db.prepare('DELETE FROM users WHERE id = ?').bind(id).run();

  return c.json({ success: true });
});

// PUT /api/users/:id - 프로필 수정 (본인: phone/branch/dept/password, 상위: 모든 필드)
users.put('/:id', async (c) => {
  const id = c.req.param('id');
  const currentUser = c.get('user');
  const db = c.env.DB;

  if (currentUser.sub !== id && currentUser.role !== 'master' && currentUser.role !== 'ceo' && currentUser.role !== 'admin') {
    return c.json({ error: '권한이 없습니다.' }, 403);
  }

  const { phone, branch, department, password } = await c.req.json<{
    phone?: string; branch?: string; department?: string; password?: string;
  }>();
  const existing = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<User>();
  if (!existing) return c.json({ error: '사용자를 찾을 수 없습니다.' }, 404);

  const newHash = password ? await hashPassword(password) : existing.password_hash;

  await db.prepare(
    "UPDATE users SET phone = ?, branch = ?, department = ?, password_hash = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(phone ?? existing.phone, branch ?? existing.branch, department ?? existing.department, newHash, id).run();

  return c.json({ success: true });
});

export default users;
