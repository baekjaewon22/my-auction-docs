import { Hono } from 'hono';
import type { AuthEnv, User } from '../types';
import { createToken, hashPassword, verifyPassword, authMiddleware } from '../middleware/auth';

const auth = new Hono<AuthEnv>();

// POST /api/auth/send-code — 이메일 인증 코드 발송
auth.post('/send-code', async (c) => {
  const { email } = await c.req.json<{ email: string }>();
  if (!email) return c.json({ error: '이메일을 입력하세요.' }, 400);

  const db = c.env.DB;

  // 이미 가입된 이메일 체크
  const existing = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return c.json({ error: '이미 등록된 이메일입니다.' }, 409);

  // 6자리 인증코드 생성
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10분

  // 기존 코드 삭제 후 새 코드 저장
  await db.prepare('DELETE FROM email_verifications WHERE email = ?').bind(email).run();
  await db.prepare(
    'INSERT INTO email_verifications (id, email, code, expires_at) VALUES (?, ?, ?, ?)'
  ).bind(id, email, code, expiresAt).run();

  // Resend API로 이메일 발송
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${c.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: '마이옥션 오피스 <onboarding@resend.dev>',
      to: [email],
      subject: '[마이옥션] 이메일 인증 코드',
      html: `
        <div style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:20px">
          <h2 style="color:#1a73e8;margin-bottom:8px">마이옥션 오피스</h2>
          <p style="color:#333">회원가입 이메일 인증 코드입니다.</p>
          <div style="background:#f4f6f8;border-radius:8px;padding:20px;text-align:center;margin:16px 0">
            <span style="font-size:32px;font-weight:800;letter-spacing:6px;color:#1a1a2e">${code}</span>
          </div>
          <p style="color:#888;font-size:13px">10분 이내에 입력해주세요. 본인이 요청하지 않았다면 무시하세요.</p>
        </div>
      `,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    console.error('Resend error:', res.status, errBody);
    return c.json({ error: `이메일 발송 실패: ${errBody || res.statusText}` }, 500);
  }

  return c.json({ message: '인증 코드가 발송되었습니다.' });
});

// POST /api/auth/verify-code — 인증 코드 확인
auth.post('/verify-code', async (c) => {
  const { email, code } = await c.req.json<{ email: string; code: string }>();
  if (!email || !code) return c.json({ error: '이메일과 인증 코드를 입력하세요.' }, 400);

  const db = c.env.DB;
  const record = await db.prepare(
    'SELECT * FROM email_verifications WHERE email = ? AND code = ? AND verified = 0'
  ).bind(email, code).first<{ id: string; expires_at: string }>();

  if (!record) return c.json({ error: '인증 코드가 올바르지 않습니다.' }, 400);
  if (new Date(record.expires_at) < new Date()) return c.json({ error: '인증 코드가 만료되었습니다. 다시 발송해주세요.' }, 400);

  await db.prepare('UPDATE email_verifications SET verified = 1 WHERE id = ?').bind(record.id).run();
  return c.json({ verified: true });
});

// POST /api/auth/register (이메일 인증 완료 후)
auth.post('/register', async (c) => {
  const { email, password, name, phone, branch } = await c.req.json<{
    email: string; password: string; name: string; phone: string; branch?: string;
  }>();

  if (!email || !password || !name || !phone) {
    return c.json({ error: '이메일, 비밀번호, 이름, 전화번호는 필수입니다.' }, 400);
  }

  const db = c.env.DB;

  // 이메일 인증 확인 (도메인 등록 후 활성화 예정)
  // const verified = await db.prepare(
  //   'SELECT id FROM email_verifications WHERE email = ? AND verified = 1'
  // ).bind(email).first();
  // if (!verified) return c.json({ error: '이메일 인증을 먼저 완료해주세요.' }, 400);

  const existing = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return c.json({ error: '이미 등록된 이메일입니다.' }, 409);

  const id = crypto.randomUUID();
  const password_hash = await hashPassword(password);

  await db.prepare(
    'INSERT INTO users (id, email, password_hash, name, phone, role, branch, department, approved) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, email, password_hash, name, phone, 'member', branch || '', '', 0).run();

  // 인증 기록 정리
  await db.prepare('DELETE FROM email_verifications WHERE email = ?').bind(email).run();

  return c.json({ message: '회원가입이 완료되었습니다. 관리자 승인 후 로그인할 수 있습니다.' }, 201);
});

// POST /api/auth/login
auth.post('/login', async (c) => {
  const { email, password } = await c.req.json<{ email: string; password: string }>();
  if (!email || !password) return c.json({ error: '이메일과 비밀번호를 입력하세요.' }, 400);

  const db = c.env.DB;
  const user = await db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<User>();
  if (!user) return c.json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' }, 401);

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) return c.json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' }, 401);

  if (!user.approved) {
    return c.json({ error: '관리자 승인 대기 중입니다. 승인 후 로그인할 수 있습니다.' }, 403);
  }

  const token = await createToken({
    sub: user.id, email: user.email, name: user.name, phone: user.phone,
    role: user.role, team_id: user.team_id, branch: user.branch, department: user.department,
  });

  return c.json({
    token,
    user: { id: user.id, email: user.email, name: user.name, phone: user.phone,
      role: user.role, team_id: user.team_id, branch: user.branch, department: user.department },
  });
});

// GET /api/auth/me
auth.get('/me', authMiddleware, async (c) => {
  const payload = c.get('user');
  const db = c.env.DB;
  const user = await db.prepare(
    'SELECT id, email, name, phone, role, team_id, branch, department, position_title, created_at FROM users WHERE id = ?'
  ).bind(payload.sub).first();
  if (!user) return c.json({ error: '사용자를 찾을 수 없습니다.' }, 404);
  return c.json({ user });
});

export default auth;
