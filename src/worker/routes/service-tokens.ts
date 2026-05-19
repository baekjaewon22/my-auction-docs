import { Hono } from 'hono';
import type { AuthEnv } from '../types';
import { authMiddleware, requireRole } from '../middleware/auth';

type ServiceTokenScope = 'read' | 'write' | 'admin';

const serviceTokens = new Hono<AuthEnv>();
serviceTokens.use('*', authMiddleware);
serviceTokens.use('*', requireRole('master', 'ceo'));

function assertHumanAdmin(c: any): Response | null {
  const user = c.get('user');
  if (user?.auth_type === 'service_token') {
    return c.json({ error: 'Service tokens cannot manage service tokens.' }, 403);
  }
  return null;
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function generateServiceToken(scope: ServiceTokenScope): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `afo_${scope}_${base64Url(bytes)}`;
}

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function normalizeScope(scope: unknown): ServiceTokenScope | null {
  if (scope === 'read' || scope === 'write' || scope === 'admin') return scope;
  return null;
}

function normalizeExpiresAt(value: unknown): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString();
}

serviceTokens.get('/', async (c) => {
  const denied = assertHumanAdmin(c);
  if (denied) return denied;

  const result = await c.env.DB.prepare(`
    SELECT st.id, st.name, st.scope, st.token_prefix, st.expires_at, st.revoked_at,
           st.last_used_at, st.last_used_ip, st.created_at, st.updated_at, st.notes,
           u.name AS created_by_name
    FROM service_tokens st
    LEFT JOIN users u ON u.id = st.created_by
    ORDER BY st.created_at DESC
  `).all();

  return c.json({ service_tokens: result.results });
});

serviceTokens.post('/', async (c) => {
  const denied = assertHumanAdmin(c);
  if (denied) return denied;

  const user = c.get('user');
  const body = await c.req.json<{
    name?: string;
    scope?: ServiceTokenScope;
    expires_at?: string;
    notes?: string;
  }>();

  const name = String(body.name || '').trim();
  const scope = normalizeScope(body.scope);
  const expiresAt = normalizeExpiresAt(body.expires_at);
  const notes = String(body.notes || '').trim();

  if (!name) return c.json({ error: 'Token name is required.' }, 400);
  if (!scope) return c.json({ error: 'scope must be read, write, or admin.' }, 400);
  if (expiresAt === '') return c.json({ error: 'expires_at must be a valid date.' }, 400);

  const token = generateServiceToken(scope);
  const tokenHash = await sha256Hex(token);
  const tokenPrefix = token.slice(0, 18);
  const id = crypto.randomUUID();

  await c.env.DB.prepare(`
    INSERT INTO service_tokens (
      id, name, scope, token_prefix, token_hash, expires_at, notes, created_by,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).bind(
    id,
    name,
    scope,
    tokenPrefix,
    tokenHash,
    expiresAt,
    notes,
    user.sub,
  ).run();

  return c.json({
    service_token: {
      id,
      name,
      scope,
      token_prefix: tokenPrefix,
      expires_at: expiresAt,
      notes,
      created_by: user.sub,
      created_at: new Date().toISOString(),
    },
    token,
    token_notice: 'This token is shown only once. Store it in All For One and never paste it into chat/logs.',
  }, 201);
});

async function revokeToken(c: any): Promise<Response> {
  const denied = assertHumanAdmin(c);
  if (denied) return denied;

  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT id, revoked_at FROM service_tokens WHERE id = ?')
    .bind(id).first() as { id: string; revoked_at: string | null } | null;
  if (!existing) return c.json({ error: 'Service token not found.' }, 404);
  if (existing.revoked_at) return c.json({ success: true, already_revoked: true });

  await c.env.DB.prepare(`
    UPDATE service_tokens
    SET revoked_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `).bind(id).run();

  return c.json({ success: true });
}

serviceTokens.post('/:id/revoke', revokeToken);
serviceTokens.delete('/:id', revokeToken);

export default serviceTokens;
