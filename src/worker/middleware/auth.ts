import { Context, Next } from 'hono';
import { jwtVerify, SignJWT } from 'jose';
import type { AuthEnv, JwtPayload, Role } from '../types';

const JWT_SECRET = new TextEncoder().encode('auction-docs-secret-key-2025');
const TOKEN_EXPIRY = '24h';

export async function createToken(payload: JwtPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(TOKEN_EXPIRY)
    .sign(JWT_SECRET);
}

export async function verifyToken(token: string): Promise<JwtPayload> {
  const { payload } = await jwtVerify(token, JWT_SECRET);
  return payload as unknown as JwtPayload;
}

export async function authMiddleware(c: Context<AuthEnv>, next: Next) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: '인증이 필요합니다.' }, 401);
  }

  try {
    const token = authHeader.slice(7);
    const payload = await verifyToken(token);

    // DB에서 최신 사용자 정보 조회 (JWT 캐시 대신 실시간)
    const db = c.env.DB;
    const freshUser = await db.prepare(
      'SELECT id, role, team_id, branch, department FROM users WHERE id = ?'
    ).bind(payload.sub).first<{ id: string; role: Role; team_id: string | null; branch: string; department: string }>();

    if (freshUser) {
      payload.role = freshUser.role;
      payload.team_id = freshUser.team_id;
      payload.branch = freshUser.branch;
      payload.department = freshUser.department;
    }

    c.set('user', payload);
    await next();
  } catch {
    return c.json({ error: '유효하지 않은 토큰입니다.' }, 401);
  }
}

export function requireRole(...roles: Role[]) {
  return async (c: Context<AuthEnv>, next: Next) => {
    const user = c.get('user');
    if (!user) return c.json({ error: '권한이 없습니다.' }, 403);
    // cc_ref는 ceo와 동일 권한
    const effectiveRole = user.role === 'cc_ref' ? 'ceo' : user.role;
    if (!roles.includes(user.role) && !roles.includes(effectiveRole as Role)) {
      return c.json({ error: '권한이 없습니다.' }, 403);
    }
    await next();
  };
}

// Simple password hashing using Web Crypto API (suitable for Cloudflare Workers)
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + 'auction-docs-salt');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const computed = await hashPassword(password);
  return computed === hash;
}
