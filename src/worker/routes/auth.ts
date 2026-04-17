import { Hono } from 'hono';
import type { AuthEnv, User } from '../types';
import { createToken, hashPassword, verifyPassword, authMiddleware } from '../middleware/auth';
import { sendAlimtalkByTemplate, normalizePhone } from '../alimtalk';

const auth = new Hono<AuthEnv>();

// 인증코드 저장소 (메모리 — Worker 인스턴스 수명 동안 유지)
const verifyStore = new Map<string, { code: string; expires: number; userId: string }>();

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

// ━━━ 비밀번호 찾기 ━━━

// POST /api/auth/forgot-password/send — 인증코드 발송
auth.post('/forgot-password/send', async (c) => {
  const { email, name, phone } = await c.req.json<{ email: string; name: string; phone: string }>();
  if (!email || !name || !phone) return c.json({ error: '이메일, 이름, 전화번호를 모두 입력하세요.' }, 400);

  const db = c.env.DB;
  const user = await db.prepare('SELECT id, name, phone FROM users WHERE email = ?').bind(email).first<any>();
  if (!user) return c.json({ error: '등록되지 않은 이메일입니다.' }, 404);

  // 이름과 전화번호 일치 확인
  const normalizedInput = normalizePhone(phone);
  const normalizedDB = normalizePhone(user.phone || '');
  if (user.name !== name.trim() || normalizedInput !== normalizedDB) {
    return c.json({ error: '이름 또는 전화번호가 일치하지 않습니다.' }, 400);
  }

  // 인증코드 생성 (6자리)
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expires = Date.now() + 3 * 60 * 1000; // 3분
  const key = normalizedInput;
  verifyStore.set(key, { code, expires, userId: user.id });

  // 알림톡 발송 (비밀번호 재설정 전용 템플릿)
  try {
    await sendAlimtalkByTemplate(
      c.env as unknown as Record<string, unknown>, 'PW_RESET',
      { verify_code: code },
      [user.phone],
    );
  } catch {
    return c.json({ error: '인증번호 발송에 실패했습니다. 잠시 후 다시 시도해주세요.' }, 500);
  }

  return c.json({ success: true, message: '인증번호가 발송되었습니다.' });
});

// POST /api/auth/forgot-password/verify — 인증코드 확인
auth.post('/forgot-password/verify', async (c) => {
  const { phone, code } = await c.req.json<{ phone: string; code: string }>();
  if (!phone || !code) return c.json({ error: '전화번호와 인증코드를 입력하세요.' }, 400);

  const key = normalizePhone(phone);
  const stored = verifyStore.get(key);
  if (!stored) return c.json({ error: '인증 요청 기록이 없습니다. 다시 시도해주세요.' }, 400);
  if (Date.now() > stored.expires) {
    verifyStore.delete(key);
    return c.json({ error: '인증번호가 만료되었습니다. 다시 발송해주세요.' }, 400);
  }
  if (stored.code !== code.trim()) return c.json({ error: '인증번호가 일치하지 않습니다.' }, 400);

  // 인증 성공 → 토큰 발급 (1회용, 5분)
  const resetToken = crypto.randomUUID();
  verifyStore.set('reset_' + resetToken, { code: 'verified', expires: Date.now() + 5 * 60 * 1000, userId: stored.userId });
  verifyStore.delete(key);

  return c.json({ success: true, reset_token: resetToken });
});

// POST /api/auth/forgot-password/reset — 비밀번호 재설정
auth.post('/forgot-password/reset', async (c) => {
  const { reset_token, new_password } = await c.req.json<{ reset_token: string; new_password: string }>();
  if (!reset_token || !new_password) return c.json({ error: '토큰과 새 비밀번호를 입력하세요.' }, 400);
  if (new_password.length < 4) return c.json({ error: '비밀번호는 4자 이상이어야 합니다.' }, 400);

  const stored = verifyStore.get('reset_' + reset_token);
  if (!stored || stored.code !== 'verified') return c.json({ error: '유효하지 않은 요청입니다. 다시 시도해주세요.' }, 400);
  if (Date.now() > stored.expires) {
    verifyStore.delete('reset_' + reset_token);
    return c.json({ error: '재설정 시간이 만료되었습니다. 다시 시도해주세요.' }, 400);
  }

  const db = c.env.DB;
  const newHash = await hashPassword(new_password);
  await db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(newHash, stored.userId).run();

  verifyStore.delete('reset_' + reset_token);
  return c.json({ success: true, message: '비밀번호가 변경되었습니다.' });
});

export default auth;
