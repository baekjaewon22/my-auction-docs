import { Hono } from 'hono';
import type { AuthEnv, User } from '../types.ts';
import { createToken, hashPassword, verifyPassword, authMiddleware } from '../middleware/auth.ts';
import { sendAlimtalkByTemplate, normalizePhone } from '../alimtalk.ts';
import { normalizeBranchName } from '../lib/branchAliases.ts';
import {
  MIN_PASSWORD_LENGTH,
  createSecureToken,
  createSixDigitCode,
  hashResetSecret,
  passwordNeedsRehash,
} from '../../shared/password-security.ts';
import { ensurePasswordSecuritySchema } from '../lib/password-security-schema.ts';

const auth = new Hono<AuthEnv>();

const RESET_CODE_TTL_MS = 3 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 5 * 60 * 1000;
const RESET_RATE_WINDOW_MS = 15 * 60 * 1000;
const RESET_RATE_LIMIT = 3;
const RESET_MAX_ATTEMPTS = 5;
const FORGOT_RESPONSE = '입력한 정보와 일치하는 계정이 있으면 인증번호가 발송됩니다.';

async function ensureUserReportSettingColumns(db: D1Database): Promise<void> {
  const columns = await db.prepare('PRAGMA table_info(users)').all<{ name: string }>();
  const names = new Set((columns.results || []).map((col) => col.name));
  if (!names.has('myauction_id')) {
    await db.prepare("ALTER TABLE users ADD COLUMN myauction_id TEXT NOT NULL DEFAULT ''").run();
  }
  if (!names.has('myauction_pw')) {
    await db.prepare("ALTER TABLE users ADD COLUMN myauction_pw TEXT NOT NULL DEFAULT ''").run();
  }
  if (!names.has('report_permission')) {
    await db.prepare("ALTER TABLE users ADD COLUMN report_permission TEXT NOT NULL DEFAULT 'basic'").run();
  }
}

// POST /api/auth/register
auth.post('/register', async (c) => {
  const { email, password, name, phone, branch, login_type } = await c.req.json<{
    email: string; password: string; name: string; phone: string; branch?: string; login_type?: string;
  }>();

  if (!email || !password || !name || !phone) {
    return c.json({ error: '이메일, 비밀번호, 이름, 전화번호는 필수입니다.' }, 400);
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return c.json({ error: `비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.` }, 400);
  }

  const db = c.env.DB;

  const existing = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return c.json({ error: '이미 등록된 이메일입니다.' }, 409);

  const id = crypto.randomUUID();
  const password_hash = await hashPassword(password);

  await db.prepare(
    'INSERT INTO users (id, email, password_hash, name, phone, role, branch, department, login_type, approved, hire_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, email, password_hash, name, phone, 'member', normalizeBranchName(branch), '', login_type || 'employee', 0, '2026-03-01').run();

  const typeLabel = login_type === 'freelancer' ? '프리랜서' : '일반';
  return c.json({ message: `${typeLabel} 회원가입이 완료되었습니다. 관리자 승인 후 로그인할 수 있습니다.` }, 201);
});

// POST /api/auth/login
auth.post('/login', async (c) => {
  const { email, password, login_type } = await c.req.json<{ email: string; password: string; login_type?: string }>();
  if (!email || !password) return c.json({ error: '이메일과 비밀번호를 입력하세요.' }, 400);

  const db = c.env.DB;
  await ensurePasswordSecuritySchema(db);
  const user = await db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<User>();
  if (!user) return c.json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' }, 401);

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) return c.json({ error: '이메일 또는 비밀번호가 올바르지 않습니다.' }, 401);

  if (!user.approved) {
    return c.json({ error: '관리자 승인 대기 중입니다. 승인 후 로그인할 수 있습니다.' }, 403);
  }

  if (passwordNeedsRehash(user.password_hash)) {
    const upgradedHash = await hashPassword(password);
    await db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ? AND password_hash = ?")
      .bind(upgradedHash, user.id, user.password_hash).run();
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
    position_title: user.position_title,
    login_type: userLoginType,
    auth_version: user.auth_version || 0,
  }, c.env);

  return c.json({
    token,
    user: { id: user.id, email: user.email, name: user.name, phone: user.phone,
      role: user.role, team_id: user.team_id, branch: user.branch, department: user.department,
      position_title: user.position_title,
      login_type: userLoginType,
      myauction_id: (user as any).myauction_id || '',
      has_myauction_credentials: (user as any).myauction_id && (user as any).myauction_pw ? 1 : 0,
      report_permission: (user as any).report_permission || 'basic' },
  });
});

// GET /api/auth/me
auth.get('/me', authMiddleware, async (c) => {
  const payload = c.get('user');
  if (payload.auth_type === 'service_token') {
    return c.json({
      user: {
        id: payload.sub,
        email: payload.email,
        name: payload.name,
        role: payload.role,
        team_id: payload.team_id,
        branch: payload.branch,
        department: payload.department,
        auth_type: payload.auth_type,
        service_token_id: payload.service_token_id,
        service_token_scope: payload.service_token_scope,
      },
    });
  }

  const db = c.env.DB;
  await ensureUserReportSettingColumns(db);
  const user = await db.prepare(`
    SELECT id, email, name, phone, role, team_id, branch, department, position_title,
      saved_signature, login_type, created_at,
      COALESCE(myauction_id, '') AS myauction_id,
      CASE WHEN COALESCE(myauction_id, '') != '' AND COALESCE(myauction_pw, '') != '' THEN 1 ELSE 0 END AS has_myauction_credentials,
      COALESCE(report_permission, 'basic') AS report_permission
    FROM users WHERE id = ?
  `).bind(payload.sub).first();
  if (!user) return c.json({ error: '사용자를 찾을 수 없습니다.' }, 404);
  return c.json({ user });
});

// ━━━ 비밀번호 찾기 ━━━

// POST /api/auth/forgot-password/send — 인증코드 발송
auth.post('/forgot-password/send', async (c) => {
  const { email, name, phone } = await c.req.json<{ email: string; name: string; phone: string }>();
  if (!email || !name || !phone) return c.json({ error: '이메일, 이름, 전화번호를 모두 입력하세요.' }, 400);

  const db = c.env.DB;
  await ensurePasswordSecuritySchema(db);
  const user = await db.prepare(
    "SELECT id, name, phone FROM users WHERE email = ? AND approved = 1 AND role != 'resigned'"
  ).bind(email.trim()).first<{ id: string; name: string; phone: string }>();

  // 이름과 전화번호 일치 확인
  const normalizedInput = normalizePhone(phone);
  const normalizedDB = normalizePhone(user?.phone || '');
  if (!user || user.name !== name.trim() || normalizedInput !== normalizedDB) {
    return c.json({ success: true, message: FORGOT_RESPONSE, challenge_id: createSecureToken(18) });
  }

  const now = Date.now();
  await db.prepare('DELETE FROM password_reset_challenges WHERE created_at < ?').bind(now - 24 * 60 * 60 * 1000).run();
  const recent = await db.prepare(
    'SELECT COUNT(*) as cnt FROM password_reset_challenges WHERE user_id = ? AND created_at >= ?'
  ).bind(user.id, now - RESET_RATE_WINDOW_MS).first<{ cnt: number }>();
  if ((recent?.cnt || 0) >= RESET_RATE_LIMIT) {
    return c.json({ success: true, message: FORGOT_RESPONSE, challenge_id: createSecureToken(18) });
  }

  const challengeId = crypto.randomUUID();
  const code = createSixDigitCode();
  const codeHash = await hashResetSecret(`${challengeId}:${code}`);
  await db.prepare(
    `INSERT INTO password_reset_challenges
      (id, user_id, code_hash, expires_at, attempts, created_at)
     VALUES (?, ?, ?, ?, 0, ?)`
  ).bind(challengeId, user.id, codeHash, now + RESET_CODE_TTL_MS, now).run();

  // 알림톡 발송 (비밀번호 재설정 전용 템플릿)
  try {
    await sendAlimtalkByTemplate(
      c.env as unknown as Record<string, unknown>, 'PW_RESET',
      { verify_code: code },
      [user.phone],
    );
  } catch {
    await db.prepare('DELETE FROM password_reset_challenges WHERE id = ?').bind(challengeId).run();
    return c.json({ error: '인증번호 발송에 실패했습니다. 잠시 후 다시 시도해주세요.' }, 500);
  }

  return c.json({ success: true, message: FORGOT_RESPONSE, challenge_id: challengeId });
});

// POST /api/auth/forgot-password/verify — 인증코드 확인
auth.post('/forgot-password/verify', async (c) => {
  const { challenge_id, code } = await c.req.json<{ challenge_id: string; code: string }>();
  if (!challenge_id || !code) return c.json({ error: '인증 요청과 인증코드를 입력하세요.' }, 400);

  const now = Date.now();
  await ensurePasswordSecuritySchema(c.env.DB);
  const challenge = await c.env.DB.prepare(
    `SELECT id, code_hash, expires_at, attempts, verified_at
     FROM password_reset_challenges WHERE id = ?`
  ).bind(challenge_id).first<{
    id: string; code_hash: string; expires_at: number; attempts: number; verified_at: number | null;
  }>();
  if (!challenge || challenge.expires_at < now || challenge.attempts >= RESET_MAX_ATTEMPTS || challenge.verified_at) {
    return c.json({ error: '유효하지 않거나 만료된 인증 요청입니다. 다시 시도해주세요.' }, 400);
  }

  const submittedHash = await hashResetSecret(`${challenge_id}:${code.trim()}`);
  if (submittedHash !== challenge.code_hash) {
    await c.env.DB.prepare(
      'UPDATE password_reset_challenges SET attempts = attempts + 1 WHERE id = ? AND verified_at IS NULL'
    ).bind(challenge_id).run();
    return c.json({ error: '인증번호가 일치하지 않습니다.' }, 400);
  }

  const resetToken = createSecureToken();
  const resetTokenHash = await hashResetSecret(resetToken);
  const verified = await c.env.DB.prepare(
    `UPDATE password_reset_challenges
     SET verified_at = ?, reset_token_hash = ?, reset_expires_at = ?
     WHERE id = ? AND verified_at IS NULL AND attempts < ? AND expires_at >= ?`
  ).bind(now, resetTokenHash, now + RESET_TOKEN_TTL_MS, challenge_id, RESET_MAX_ATTEMPTS, now).run();
  if ((verified.meta?.changes || 0) !== 1) {
    return c.json({ error: '이미 사용되었거나 만료된 인증 요청입니다.' }, 409);
  }

  return c.json({ success: true, reset_token: resetToken });
});

// POST /api/auth/forgot-password/reset — 비밀번호 재설정
auth.post('/forgot-password/reset', async (c) => {
  const { reset_token, new_password } = await c.req.json<{ reset_token: string; new_password: string }>();
  if (!reset_token || !new_password) return c.json({ error: '토큰과 새 비밀번호를 입력하세요.' }, 400);
  if (new_password.length < MIN_PASSWORD_LENGTH) return c.json({ error: `비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.` }, 400);

  const db = c.env.DB;
  await ensurePasswordSecuritySchema(db);
  const now = Date.now();
  const tokenHash = await hashResetSecret(reset_token);
  const stored = await db.prepare(
    `SELECT id, user_id FROM password_reset_challenges
     WHERE reset_token_hash = ? AND verified_at IS NOT NULL AND consumed_at IS NULL AND reset_expires_at >= ?`
  ).bind(tokenHash, now).first<{ id: string; user_id: string }>();
  if (!stored) return c.json({ error: '유효하지 않거나 만료된 재설정 요청입니다.' }, 400);

  const newHash = await hashPassword(new_password);
  const claimed = await db.prepare(
    'UPDATE password_reset_challenges SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL AND reset_token_hash = ?'
  ).bind(now, stored.id, tokenHash).run();
  if ((claimed.meta?.changes || 0) !== 1) return c.json({ error: '이미 사용된 재설정 요청입니다.' }, 409);

  await db.prepare(
    "UPDATE users SET password_hash = ?, auth_version = auth_version + 1, updated_at = datetime('now') WHERE id = ?"
  ).bind(newHash, stored.user_id).run();

  return c.json({ success: true, message: '비밀번호가 변경되었습니다.' });
});

export default auth;
