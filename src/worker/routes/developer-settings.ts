import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import type { AuthEnv, JwtPayload } from '../types';
import { authMiddleware } from '../middleware/auth.ts';

type CodexLogRole = 'user' | 'assistant';

interface CodexLogMessage {
  id: string;
  role: CodexLogRole;
  content: string;
  created_at: string;
}

const developerSettings = new Hono<AuthEnv>();

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function ensureDeveloperSettingsSchema(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare(`
      CREATE TABLE IF NOT EXISTS codex_conversations (
        id TEXT PRIMARY KEY,
        source_session_id TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'codex',
        working_directory TEXT NOT NULL DEFAULT '',
        client_version TEXT NOT NULL DEFAULT '',
        transcript_json TEXT NOT NULL DEFAULT '[]',
        message_count INTEGER NOT NULL DEFAULT 0,
        started_at TEXT NOT NULL,
        last_message_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_codex_conversations_updated ON codex_conversations(last_message_at DESC)'),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS codex_sync_tokens (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        last_used_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `),
  ]);
}

export function redactCodexLogText(value: unknown): string {
  return String(value ?? '')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/\b(sk|rk|pk)-[A-Za-z0-9_-]{16,}\b/g, '$1-[REDACTED]')
    .replace(/\b(AIza[0-9A-Za-z_-]{20,})\b/g, '[REDACTED_API_KEY]')
    .replace(/\b(gh[pousr]_[A-Za-z0-9_]{20,})\b/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(/\b([A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,})\b/g, '[REDACTED_JWT]')
    .replace(/((?:password|passwd|pwd|api[_-]?key|secret|token)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .slice(0, 20_000);
}

export function normalizeCodexMessages(value: unknown): CodexLogMessage[] {
  if (!Array.isArray(value)) return [];
  const messages: CodexLogMessage[] = [];
  let transcriptChars = 0;
  for (const raw of value.slice(0, 300)) {
    if (!raw || typeof raw !== 'object') continue;
    const role = (raw as any).role;
    if (role !== 'user' && role !== 'assistant') continue;
    const content = redactCodexLogText((raw as any).content).trim();
    if (!content) continue;
    if (transcriptChars + content.length > 750_000) break;
    transcriptChars += content.length;
    messages.push({
      id: String((raw as any).id || crypto.randomUUID()).slice(0, 160),
      role,
      content,
      created_at: String((raw as any).created_at || '').slice(0, 40),
    });
  }
  return messages;
}

async function authenticateRequest(c: Context<AuthEnv>, next: Next) {
  const syncToken = String(c.req.header('X-Codex-Sync-Token') || '').trim();
  if (c.req.method === 'POST' && syncToken) {
    await ensureDeveloperSettingsSchema(c.env.DB);
    const tokenHash = await sha256Hex(syncToken);
    const configuredSecret = String((c.env as any).CODEX_SYNC_SECRET || '').trim();
    const matchesEnvironmentSecret = configuredSecret
      ? tokenHash === await sha256Hex(configuredSecret)
      : false;
    const token = matchesEnvironmentSecret ? { id: 'worker-secret', name: 'Codex sync' } : await c.env.DB.prepare(`
      SELECT id, name FROM codex_sync_tokens
      WHERE (token_hash = ? OR token_hash = ?) AND active = 1
      LIMIT 1
    `).bind(tokenHash, syncToken).first<{ id: string; name: string }>();
    if (!token) return c.json({ error: 'Not found.' }, 404);
    if (!matchesEnvironmentSecret) {
      await c.env.DB.prepare("UPDATE codex_sync_tokens SET last_used_at = datetime('now') WHERE id = ?")
        .bind(token.id).run();
    }
    c.set('user', {
      sub: `codex-sync:${token.id}`,
      email: '',
      name: token.name,
      phone: '',
      role: 'master',
      team_id: null,
      branch: '',
      department: 'developer-settings',
      auth_type: 'service_token',
    } as JwtPayload);
    await next();
    return;
  }
  return authMiddleware(c, next);
}

async function requireMasterOrNotFound(c: Context<AuthEnv>, next: Next) {
  const user = c.get('user');
  if (!user || user.role !== 'master') return c.json({ error: 'Not found.' }, 404);
  await next();
}

async function requireHumanMasterOrNotFound(c: Context<AuthEnv>, next: Next) {
  const user = c.get('user');
  if (!user || user.role !== 'master' || user.auth_type !== 'user' || user.sub.startsWith('codex-sync:')) {
    return c.json({ error: 'Not found.' }, 404);
  }
  await next();
}

developerSettings.use('*', authenticateRequest);
developerSettings.use('*', requireMasterOrNotFound);

developerSettings.get('/codex-conversations', requireHumanMasterOrNotFound, async (c) => {
  await ensureDeveloperSettingsSchema(c.env.DB);
  const result = await c.env.DB.prepare(`
    SELECT id, source_session_id, title, source, working_directory, client_version,
           message_count, started_at, last_message_at, created_at, updated_at
    FROM codex_conversations
    ORDER BY last_message_at DESC, updated_at DESC
    LIMIT 200
  `).all();
  return c.json({ conversations: result.results || [] });
});

developerSettings.get('/codex-conversations/:id', requireHumanMasterOrNotFound, async (c) => {
  await ensureDeveloperSettingsSchema(c.env.DB);
  const row = await c.env.DB.prepare(`
    SELECT id, source_session_id, title, source, working_directory, client_version,
           transcript_json, message_count, started_at, last_message_at, created_at, updated_at
    FROM codex_conversations
    WHERE id = ?
    LIMIT 1
  `).bind(c.req.param('id')).first<any>();
  if (!row) return c.json({ error: 'Not found.' }, 404);
  let messages: CodexLogMessage[] = [];
  try { messages = JSON.parse(row.transcript_json || '[]'); } catch { /* malformed legacy row */ }
  delete row.transcript_json;
  return c.json({ conversation: { ...row, messages } });
});

developerSettings.post('/codex-conversations', async (c) => {
  await ensureDeveloperSettingsSchema(c.env.DB);
  const body: Record<string, unknown> = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  const sourceSessionId = String(body.source_session_id || '').trim().slice(0, 200);
  const messages = normalizeCodexMessages(body.messages);
  if (!sourceSessionId || messages.length === 0) {
    return c.json({ error: '세션 ID와 대화 메시지가 필요합니다.' }, 400);
  }

  const existing = await c.env.DB.prepare('SELECT id FROM codex_conversations WHERE source_session_id = ?')
    .bind(sourceSessionId).first<{ id: string }>();
  const id = existing?.id || crypto.randomUUID();
  const firstUserMessage = messages.find((message) => message.role === 'user')?.content || 'Codex 대화';
  const title = redactCodexLogText(body.title || firstUserMessage).replace(/\s+/g, ' ').trim().slice(0, 120) || 'Codex 대화';
  const startedAt = String(body.started_at || messages[0].created_at || new Date().toISOString()).slice(0, 40);
  const lastMessageAt = String(messages[messages.length - 1].created_at || startedAt).slice(0, 40);

  await c.env.DB.prepare(`
    INSERT INTO codex_conversations (
      id, source_session_id, title, source, working_directory, client_version,
      transcript_json, message_count, started_at, last_message_at, created_at, updated_at
    ) VALUES (?, ?, ?, 'codex', ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(source_session_id) DO UPDATE SET
      title = excluded.title,
      working_directory = excluded.working_directory,
      client_version = excluded.client_version,
      transcript_json = excluded.transcript_json,
      message_count = excluded.message_count,
      started_at = excluded.started_at,
      last_message_at = excluded.last_message_at,
      updated_at = datetime('now')
  `).bind(
    id,
    sourceSessionId,
    title,
    redactCodexLogText(body.working_directory).slice(0, 500),
    String(body.client_version || '').slice(0, 80),
    JSON.stringify(messages),
    messages.length,
    startedAt,
    lastMessageAt,
  ).run();

  return c.json({ success: true, id, message_count: messages.length, updated: !!existing }, existing ? 200 : 201);
});

export default developerSettings;
