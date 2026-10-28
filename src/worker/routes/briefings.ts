import { Hono } from 'hono';
import type { AuthEnv } from '../types';
import { authMiddleware, requireHumanMaster } from '../middleware/auth';
import { isBriefingSite, validateBriefingPayload } from '../../shared/marketing-briefing';
import { canViewMarketingBriefings } from '../../shared/marketing-briefing-access';

type BriefingType = 'weekly' | 'monthly';
type ApiKeyRecord = { id: string; site: string | null; revoked_at: string | null };

const briefings = new Hono<AuthEnv>();
const MAX_BODY_BYTES = 5 * 1024 * 1024;

briefings.onError((error, c) => {
  console.error('[briefings]', error.message);
  return c.json({ error: 'server_error', message: '브리핑 요청을 처리하지 못했습니다.', fields: [] }, 500);
});

function errorJson(c: any, status: number, error: string, message: string, fields: string[] = []) {
  return c.json({ error, message, fields }, status);
}

function logPost(site: unknown, reportKey: unknown, bodyBytes: number, status: number) {
  console.log(JSON.stringify({
    event: 'briefing_post',
    site: String(site || ''),
    report_key: String(reportKey || ''),
    body_bytes: bodyBytes,
    response_status: status,
  }));
}

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function generateApiKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `mbr_${base64Url(bytes)}`;
}

async function authenticateApiKey(c: any, requestedSite = ''): Promise<ApiKeyRecord | Response> {
  const rawKey = String(c.req.header('X-API-Key') || '').trim();
  if (!rawKey) return errorJson(c, 401, 'missing_api_key', 'X-API-Key 헤더가 필요합니다.');
  const tokenHash = await sha256Hex(rawKey);
  const record = await c.env.DB.prepare(`
    SELECT id, site, revoked_at
    FROM briefing_api_keys
    WHERE token_hash = ? AND scope = 'briefings:write'
    LIMIT 1
  `).bind(tokenHash).first() as ApiKeyRecord | null;
  if (!record || record.revoked_at) return errorJson(c, 401, 'invalid_api_key', '유효하지 않거나 폐기된 API 키입니다.');
  if (record.site && requestedSite && record.site !== requestedSite) {
    return errorJson(c, 403, 'site_not_allowed', '이 API 키는 요청한 사이트에 사용할 수 없습니다.', ['site']);
  }
  return record;
}

async function readerAuth(c: any, next: any) {
  if (c.req.header('X-API-Key')) {
    const authenticated = await authenticateApiKey(c, String(c.req.query('site') || c.req.param('site') || ''));
    if (authenticated instanceof Response) return authenticated;
    c.set('briefingApiKey', authenticated);
    return next();
  }
  return authMiddleware(c, async () => {
    const user = c.get('user');
    if (!user || user.auth_type !== 'user' || !canViewMarketingBriefings(user)) {
      return errorJson(c, 403, 'forbidden', '브리핑 열람 권한이 없습니다.');
    }
    return next();
  });
}

function safeJson(value: string | null, fallback: any) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function mapRow(row: any) {
  return {
    ...row,
    kpis: safeJson(row.kpis, {}),
    highlights: safeJson(row.highlights, []),
    warnings: safeJson(row.warnings, []),
    checks: safeJson(row.checks, []),
    todos: safeJson(row.todos, []),
    reels: safeJson(row.reels, []),
    channels: safeJson(row.channels, []),
    devices: safeJson(row.devices, []),
    landing: safeJson(row.landing, {}),
    audience: safeJson(row.audience, []),
    corrections: safeJson(row.corrections, []),
    notes: safeJson(row.notes, []),
    compare_period: safeJson(row.compare_period, null),
    generator: safeJson(row.generator, null),
    extra: safeJson(row.extra, {}),
  };
}

briefings.get('/health', (c) => c.json({ ok: true }));

briefings.get('/keys', authMiddleware, requireHumanMaster(), async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT id, name, site, scope, token_prefix, last_used_at, revoked_at, created_at
    FROM briefing_api_keys
    ORDER BY created_at DESC
  `).all();
  return c.json({ api_keys: result.results });
});

briefings.post('/keys', authMiddleware, requireHumanMaster(), async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({})) as { name?: string; site?: string };
  const name = String(body.name || '').trim();
  const site = String(body.site || '').trim();
  if (!name || (site && !isBriefingSite(site))) {
    return errorJson(c, 400, 'validation_failed', '키 이름과 사이트 값을 확인해 주세요.', [!name ? 'name' : 'site']);
  }
  const token = generateApiKey();
  const id = crypto.randomUUID();
  await c.env.DB.prepare(`
    INSERT INTO briefing_api_keys (id, name, site, scope, token_prefix, token_hash, created_by)
    VALUES (?, ?, ?, 'briefings:write', ?, ?, ?)
  `).bind(id, name, site || null, token.slice(0, 12), await sha256Hex(token), user.sub).run();
  return c.json({ api_key: { id, name, site: site || null, scope: 'briefings:write', token_prefix: token.slice(0, 12) }, token }, 201);
});

briefings.delete('/keys/:id', authMiddleware, requireHumanMaster(), async (c) => {
  const result = await c.env.DB.prepare(`
    UPDATE briefing_api_keys SET revoked_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ? AND revoked_at IS NULL
  `).bind(c.req.param('id')).run();
  if (!result.meta.changes) return errorJson(c, 404, 'not_found', '활성 API 키를 찾을 수 없습니다.');
  return c.json({ success: true });
});

briefings.post('/', async (c) => {
  const contentLength = Number(c.req.header('Content-Length') || 0);
  if (contentLength > MAX_BODY_BYTES) {
    logPost('', '', contentLength, 413);
    return errorJson(c, 413, 'payload_too_large', '요청 본문은 5MB 이하여야 합니다.');
  }

  const text = await c.req.text();
  const bodyBytes = new TextEncoder().encode(text).byteLength;
  if (bodyBytes > MAX_BODY_BYTES) {
    logPost('', '', bodyBytes, 413);
    return errorJson(c, 413, 'payload_too_large', '요청 본문은 5MB 이하여야 합니다.');
  }

  let body: any;
  try { body = JSON.parse(text); } catch {
    logPost('', '', bodyBytes, 400);
    return errorJson(c, 400, 'invalid_json', '올바른 JSON 본문이 아닙니다.', ['body']);
  }
  const authenticated = await authenticateApiKey(c, String(body?.site || ''));
  if (authenticated instanceof Response) {
    logPost(body?.site, body?.report_key, bodyBytes, authenticated.status);
    return authenticated;
  }

  const fields = validateBriefingPayload(body);
  if (fields.length) {
    logPost(body?.site, body?.report_key, bodyBytes, 400);
    return errorJson(c, 400, 'validation_failed', '필수값 또는 형식이 올바르지 않습니다.', fields);
  }

  const minuteBucket = new Date().toISOString().slice(0, 16);
  const rate = await c.env.DB.prepare(`
    INSERT INTO briefing_api_rate_limits (api_key_id, minute_bucket, request_count)
    VALUES (?, ?, 1)
    ON CONFLICT(api_key_id, minute_bucket) DO UPDATE SET request_count = request_count + 1
    RETURNING request_count
  `).bind(authenticated.id, minuteBucket).first<{ request_count: number }>();
  if ((rate?.request_count || 0) > 10) {
    logPost(body.site, body.report_key, bodyBytes, 429);
    return errorJson(c, 429, 'rate_limited', 'API 키당 분당 10회까지 게시할 수 있습니다.');
  }

  if (c.req.query('dry_run') === '1') {
    logPost(body.site, body.report_key, bodyBytes, 200);
    return c.json({ valid: true });
  }

  const known = new Set(['report_key', 'site', 'type', 'report_date', 'period', 'compare_period', 'title', 'summary', 'kpis', 'highlights', 'warnings', 'checks', 'todos', 'reels', 'channels', 'devices', 'landing', 'audience', 'corrections', 'content_md', 'html', 'notes', 'generator']);
  const extra = Object.fromEntries(Object.entries(body).filter(([key]) => !known.has(key)));
  const existing = await c.env.DB.prepare('SELECT * FROM briefings WHERE report_key = ?').bind(body.report_key).first<any>();
  if (existing && (existing.site !== body.site || existing.type !== body.type || existing.report_date !== body.report_date)) {
    return errorJson(c, 409, 'report_key_conflict', '다른 회차에 사용된 report_key입니다. 새 회차는 새로운 report_key로 등록해 주세요.', ['report_key']);
  }
  const id = existing?.id || crypto.randomUUID();
  const params = [
    id, body.report_key, body.site, body.type as BriefingType, body.report_date, body.period.start, body.period.end,
    body.title, body.summary, JSON.stringify(body.kpis), JSON.stringify(body.highlights || []), JSON.stringify(body.warnings || []),
    JSON.stringify(body.checks || []), JSON.stringify(body.todos || []), JSON.stringify(body.reels || []), JSON.stringify(body.channels || []),
    JSON.stringify(body.devices || []), JSON.stringify(body.landing || {}), JSON.stringify(body.audience || []), JSON.stringify(body.corrections || []),
    JSON.stringify(body.notes || []), JSON.stringify(body.compare_period || null), JSON.stringify(body.generator || null), JSON.stringify(extra),
    body.content_md, body.html || null,
  ];
  if (existing) {
    await c.env.DB.prepare(`
      INSERT OR IGNORE INTO briefing_revisions (id, briefing_id, report_key, revision, snapshot)
      VALUES (?, ?, ?, ?, ?)
    `).bind(crypto.randomUUID(), id, existing.report_key, existing.revision, JSON.stringify(existing)).run();
  }
  const saved = await c.env.DB.prepare(`
    INSERT INTO briefings (
      id, report_key, site, type, report_date, period_start, period_end, title, summary, kpis,
      highlights, warnings, checks, todos, reels, channels, devices, landing, audience, corrections,
      notes, compare_period, generator, extra, content_md, html
    ) VALUES (${params.map(() => '?').join(', ')})
    ON CONFLICT(report_key) DO UPDATE SET
      site = excluded.site, type = excluded.type, report_date = excluded.report_date,
      period_start = excluded.period_start, period_end = excluded.period_end, title = excluded.title,
      summary = excluded.summary, kpis = excluded.kpis, highlights = excluded.highlights,
      warnings = excluded.warnings, checks = excluded.checks, todos = excluded.todos,
      reels = excluded.reels, channels = excluded.channels, devices = excluded.devices,
      landing = excluded.landing, audience = excluded.audience, corrections = excluded.corrections,
      notes = excluded.notes,
      compare_period = excluded.compare_period, generator = excluded.generator, extra = excluded.extra,
      content_md = excluded.content_md, html = excluded.html, revision = briefings.revision + 1,
      updated_at = datetime('now')
    WHERE briefings.site = excluded.site AND briefings.type = excluded.type
      AND briefings.report_date = excluded.report_date
  `).bind(...params).run();
  if (!saved.meta.changes) return errorJson(c, 409, 'report_key_conflict', '다른 회차에 사용된 report_key입니다. 새 회차는 새로운 report_key로 등록해 주세요.', ['report_key']);
  await c.env.DB.prepare("UPDATE briefing_api_keys SET last_used_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
    .bind(authenticated.id).run();

  const url = `${new URL(c.req.url).origin}/briefings/${body.site}/${body.report_date}?type=${body.type}`;
  logPost(body.site, body.report_key, bodyBytes, existing ? 200 : 201);
  return c.json({ id, url, created: !existing }, existing ? 200 : 201);
});

briefings.get('/', readerAuth, async (c) => {
  const site = String(c.req.query('site') || '').trim();
  const type = String(c.req.query('type') || '').trim();
  const month = String(c.req.query('month') || '').trim();
  const dateFrom = String(c.req.query('date_from') || '').trim();
  const dateTo = String(c.req.query('date_to') || '').trim();
  const limit = Math.min(Math.max(Number(c.req.query('limit') || 20), 1), 100);
  const rawOffset = Number(c.req.query('offset') || 0);
  const offset = Number.isSafeInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
  const where: string[] = [];
  const binds: any[] = [];
  if (site) { where.push('site = ?'); binds.push(site); }
  if (type === 'weekly' || type === 'monthly') { where.push('type = ?'); binds.push(type); }
  if (month) { where.push('substr(report_date, 1, 7) = ?'); binds.push(month); }
  if (dateFrom) { where.push('report_date >= ?'); binds.push(dateFrom); }
  if (dateTo) { where.push('report_date <= ?'); binds.push(dateTo); }
  const result = await c.env.DB.prepare(`
    SELECT id, report_key, site, type, report_date, period_start, period_end, title, summary,
           kpis, warnings, revision, created_at, updated_at
    FROM briefings ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY report_date DESC, updated_at DESC, id DESC LIMIT ? OFFSET ?
  `).bind(...binds, limit + 1, offset).all();
  return c.json({ briefings: result.results.slice(0, limit).map(mapRow), has_more: result.results.length > limit });
});

briefings.get('/by-date/:site/:reportDate', readerAuth, async (c) => {
  const type = String(c.req.query('type') || '').trim();
  const typed = type === 'weekly' || type === 'monthly';
  const typeClause = typed ? ' AND type = ?' : '';
  const binds = typed
    ? [c.req.param('site'), c.req.param('reportDate'), type]
    : [c.req.param('site'), c.req.param('reportDate')];
  const row = await c.env.DB.prepare(`
    SELECT * FROM briefings WHERE site = ? AND report_date = ?${typeClause} ORDER BY updated_at DESC LIMIT 1
  `).bind(...binds).first();
  if (!row) return errorJson(c, 404, 'not_found', '브리핑을 찾을 수 없습니다.');
  const previous = await c.env.DB.prepare(`SELECT id, report_date, title, type FROM briefings WHERE site = ? AND report_date < ?${typeClause} ORDER BY report_date DESC LIMIT 1`)
    .bind(...binds).first();
  const next = await c.env.DB.prepare(`SELECT id, report_date, title, type FROM briefings WHERE site = ? AND report_date > ?${typeClause} ORDER BY report_date ASC LIMIT 1`)
    .bind(...binds).first();
  const priorChecks = await c.env.DB.prepare(`SELECT checks FROM briefings WHERE site = ? AND report_date < ?${typeClause} ORDER BY report_date DESC LIMIT 1`)
    .bind(...binds).first<{ checks: string }>();
  return c.json({ briefing: mapRow(row), previous, next, previous_checks: safeJson(priorChecks?.checks || null, []) });
});

briefings.get('/:id/revisions', readerAuth, async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT revision, snapshot, archived_at FROM briefing_revisions
    WHERE briefing_id = ? ORDER BY revision DESC
  `).bind(c.req.param('id')).all();
  return c.json({ revisions: result.results.map((row: any) => ({
    revision: row.revision,
    archived_at: row.archived_at,
    briefing: mapRow(safeJson(row.snapshot, {})),
  })) });
});

briefings.get('/:id', readerAuth, async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM briefings WHERE id = ?').bind(c.req.param('id')).first();
  if (!row) return errorJson(c, 404, 'not_found', '브리핑을 찾을 수 없습니다.');
  return c.json({ briefing: mapRow(row) });
});

export default briefings;
