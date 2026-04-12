import { Hono } from 'hono';
import type { AuthEnv, User } from '../types';
import { createToken, hashPassword, verifyPassword, authMiddleware } from '../middleware/auth';

const auth = new Hono<AuthEnv>();

// POST /api/auth/register
auth.post('/register', async (c) => {
  const { email, password, name, phone, branch, login_type } = await c.req.json<{
    email: string; password: string; name: string; phone: string; branch?: string; login_type?: string;
  }>();

  if (!email || !password || !name || !phone) {
    return c.json({ error: '이메일, 비밀번호, 이름, 전화번호는 필수입니다.' }, 400);
  }

  const db = c.env.DB;

  const existing = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return c.json({ error: '이미 등록된 이메일입니다.' }, 409);

  const id = crypto.randomUUID();
  const password_hash = await hashPassword(password);

  await db.prepare(
    'INSERT INTO users (id, email, password_hash, name, phone, role, branch, department, login_type, approved, hire_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, email, password_hash, name, phone, 'member', branch || '', '', login_type || 'employee', 0, '2026-03-01').run();

  const typeLabel = login_type === 'freelancer' ? '프리랜서' : '일반';
  return c.json({ message: `${typeLabel} 회원가입이 완료되었습니다. 관리자 승인 후 로그인할 수 있습니다.` }, 201);
});

// POST /api/auth/login
auth.post('/login', async (c) => {
  const { email, password, login_type } = await c.req.json<{ email: string; password: string; login_type?: string }>();
  if (!email || !password) return c.json({ error: '이메일과 비밀번호를 입력하세요.' }, 400);

  const db = c.env.DB;
  const user = await db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<User>();
  if (!user) return c.json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' }, 401);

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) return c.json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' }, 401);

  if (!user.approved) {
    return c.json({ error: '관리자 승인 대기 중입니다. 승인 후 로그인할 수 있습니다.' }, 403);
  }

  // 로그인 타입 검증 (일반 ↔ 프리랜서 분리, master는 양쪽 모두 허용)
  const userLoginType = (user as any).login_type || 'employee';
  const requestType = login_type || 'employee';
  if (user.role !== 'master' && userLoginType !== requestType) {
    return c.json({ error: requestType === 'freelancer' ? '프리랜서 계정이 아닙니다. 일반 로그인을 이용해주세요.' : '일반 계정이 아닙니다. 프리랜서 로그인을 이용해주세요.' }, 403);
  }

  const token = await createToken({
    sub: user.id, email: user.email, name: user.name, phone: user.phone,
    role: user.role, team_id: user.team_id, branch: user.branch, department: user.department,
  });

  return c.json({
    token,
    user: { id: user.id, email: user.email, name: user.name, phone: user.phone,
      role: user.role, team_id: user.team_id, branch: user.branch, department: user.department,
      login_type: userLoginType },
  });
});

// GET /api/auth/me
auth.get('/me', authMiddleware, async (c) => {
  const payload = c.get('user');
  const db = c.env.DB;
  const user = await db.prepare(
    'SELECT id, email, name, phone, role, team_id, branch, department, position_title, saved_signature, login_type, created_at FROM users WHERE id = ?'
  ).bind(payload.sub).first();
  if (!user) return c.json({ error: '사용자를 찾을 수 없습니다.' }, 404);
  return c.json({ user });
});

export default auth;
