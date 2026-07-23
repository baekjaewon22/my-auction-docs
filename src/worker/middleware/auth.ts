import type { Context, Next } from 'hono';
import { jwtVerify, SignJWT } from 'jose';
import type { AuthEnv, JwtPayload, Role } from '../types';
import { ensurePasswordSecuritySchema } from '../lib/password-security-schema.ts';
export { hashPassword, verifyPassword } from '../../shared/password-security.ts';

const TOKEN_EXPIRY = '24h';

export class JwtConfigurationError extends Error {
  constructor() {
    super('JWT signing secret is not configured.');
    this.name = 'JwtConfigurationError';
  }
}

function jwtSecret(env: Env): Uint8Array {
  const configured = String(env.JWT_SIGNING_SECRET || '').trim();
  if (!configured || configured.length < 32) {
    throw new JwtConfigurationError();
  }
  return new TextEncoder().encode(configured);
}

type ServiceTokenScope = 'read' | 'write' | 'admin';

const SERVICE_TOKEN_METHODS: Record<ServiceTokenScope, string[]> = {
  read: ['GET', 'HEAD', 'OPTIONS'],
  write: ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH'],
  admin: ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'],
};

const SERVICE_TOKEN_ROLE: Record<ServiceTokenScope, Role> = {
  read: 'ceo',
  write: 'accountant',
  admin: 'master',
};

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function createToken(payload: JwtPayload, env: Env): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(TOKEN_EXPIRY)
    .sign(jwtSecret(env));
}

export async function verifyToken(token: string, env: Env): Promise<JwtPayload> {
  const { payload } = await jwtVerify(token, jwtSecret(env));
  return payload as unknown as JwtPayload;
}

async function authenticateServiceToken(c: Context<AuthEnv>, token: string): Promise<Response | null> {
  const db = c.env.DB;
  const tokenHash = await sha256Hex(token);
  const serviceToken = await db.prepare(`
    SELECT id, name, scope, expires_at, revoked_at
    FROM service_tokens
    WHERE token_hash = ?
    LIMIT 1
  `).bind(tokenHash).first<{
    id: string;
    name: string;
    scope: ServiceTokenScope;
    expires_at: string | null;
    revoked_at: string | null;
  }>();

  if (!serviceToken || serviceToken.revoked_at) {
    return c.json({ error: 'Invalid token.' }, 401);
  }

  if (serviceToken.expires_at && new Date(serviceToken.expires_at).getTime() <= Date.now()) {
    return c.json({ error: 'Token expired.' }, 401);
  }

  const scope = serviceToken.scope;
  if (!SERVICE_TOKEN_METHODS[scope]?.includes(c.req.method)) {
    return c.json({ error: 'Service token scope does not allow this method.' }, 403);
  }

  await db.prepare(`
    UPDATE service_tokens
    SET last_used_at = datetime('now'), last_used_ip = ?, updated_at = datetime('now')
    WHERE id = ?
  `).bind(c.req.header('CF-Connecting-IP') || '', serviceToken.id).run();

  c.set('user', {
    sub: `service-token:${serviceToken.id}`,
    email: `${serviceToken.id}@service-token.local`,
    name: serviceToken.name,
    phone: '',
    role: SERVICE_TOKEN_ROLE[scope],
    team_id: null,
    branch: '',
    department: 'service-token',
    auth_type: 'service_token',
    service_token_id: serviceToken.id,
    service_token_scope: scope,
  });

  return null;
}

export async function authMiddleware(c: Context<AuthEnv>, next: Next) {
  const authHeader = c.req.header('Authorization');
  const serviceHeader = c.req.header('X-Service-Token');
  const deviceKeyHeader = c.req.header('X-AFO-Device-Key');
  if (!authHeader?.startsWith('Bearer ') && !serviceHeader && !deviceKeyHeader) {
    return c.json({ error: 'Authentication required.' }, 401);
  }

  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : String(serviceHeader || deviceKeyHeader || '');

  try {
    const payload = await verifyToken(token, c.env);
    const db = c.env.DB;
    await ensurePasswordSecuritySchema(db);
    const freshUser = await db.prepare(
      'SELECT id, role, team_id, branch, department, login_type, approved, auth_version FROM users WHERE id = ?'
    ).bind(payload.sub).first<{ id: string; role: Role; team_id: string | null; branch: string; department: string; login_type?: string; approved: number; auth_version: number }>();

    if (!freshUser) {
      return c.json({ error: 'This account no longer exists.' }, 401);
    }
    if (freshUser.approved !== 1) {
      return c.json({ error: 'This account is not approved.' }, 403);
    }
    if (freshUser.role === 'resigned') {
      return c.json({ error: 'This account is resigned.' }, 403);
    }
    if ((payload.auth_version || 0) !== (freshUser.auth_version || 0)) {
      return c.json({ error: 'This session is no longer valid.' }, 401);
    }
    payload.role = freshUser.role;
    payload.team_id = freshUser.team_id;
    payload.branch = freshUser.branch;
    payload.department = freshUser.department;
    payload.login_type = freshUser.login_type || 'employee';
    payload.auth_version = freshUser.auth_version || 0;

    payload.auth_type = 'user';
    c.set('user', payload);
    await next();
  } catch (error) {
    if (error instanceof JwtConfigurationError) {
      console.error('[auth] JWT_SIGNING_SECRET is missing or shorter than 32 characters.');
      return c.json({ error: '서버 인증 설정을 확인하고 있습니다. 잠시 후 다시 시도해 주세요.' }, 503);
    }
    const serviceError = await authenticateServiceToken(c, token);
    if (serviceError) return serviceError;
    await next();
  }
}

export function requireRole(...roles: Role[]) {
  return async (c: Context<AuthEnv>, next: Next) => {
    const user = c.get('user');
    if (!user) return c.json({ error: 'Permission denied.' }, 403);
    const effectiveRole = user.role === 'cc_ref' ? 'ceo' : user.role;
    if (!roles.includes(user.role) && !roles.includes(effectiveRole as Role)) {
      return c.json({ error: 'Permission denied.' }, 403);
    }
    await next();
  };
}

export function requireHumanUser() {
  return async (c: Context<AuthEnv>, next: Next) => {
    const user = c.get('user');
    const machineCredentialHeader = c.req.header('X-Service-Token') || c.req.header('X-AFO-Device-Key');
    if (machineCredentialHeader || !user || user.auth_type !== 'user' || user.sub.startsWith('service-token:')) {
      return c.json({ error: '사용자 계정으로 로그인해야 합니다.' }, 403);
    }
    const exists = await c.env.DB.prepare("SELECT id FROM users WHERE id = ? AND approved = 1 AND role != 'resigned' LIMIT 1").bind(user.sub).first();
    if (!exists) return c.json({ error: '사용자 계정을 확인할 수 없습니다.' }, 403);
    await next();
  };
}

export function requireHumanMaster() {
  return async (c: Context<AuthEnv>, next: Next) => {
    const user = c.get('user');
    const machineCredentialHeader = c.req.header('X-Service-Token') || c.req.header('X-AFO-Device-Key');
    if (machineCredentialHeader || !user || user.auth_type !== 'user' || user.role !== 'master' || user.sub.startsWith('service-token:')) {
      return c.json({ error: '마스터 사용자 계정만 접근할 수 있습니다.' }, 403);
    }
    const exists = await c.env.DB.prepare("SELECT id FROM users WHERE id = ? AND approved = 1 AND role = 'master' LIMIT 1").bind(user.sub).first();
    if (!exists) return c.json({ error: '마스터 사용자 계정을 확인할 수 없습니다.' }, 403);
    await next();
  };
}
