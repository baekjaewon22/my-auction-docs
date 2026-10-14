import { Hono } from 'hono';
import type { AuthEnv } from '../types';
import { authMiddleware, requireHumanMaster } from '../middleware/auth';
import { canViewExternalMentions, validateMentionBatch, validateMentionDigest } from '../../shared/external-mentions';
import { buildMentionMonthlySummary, isMonth } from '../lib/external-mention-monthly';

type MentionApiKeyRecord = { id: string; revoked_at: string | null };

export const mentionsRoute = new Hono<AuthEnv>();
export const mentionDigestsRoute = new Hono<AuthEnv>();

const MAX_BODY_BYTES = 5 * 1024 * 1024;
const WORKFLOW_STATUSES = ['unreviewed', 'reviewed', 'action_required', 'in_progress', 'resolved', 'excluded'];

function errorJson(c: any, status: number, error: string, message: string, fields: string[] = []) {
  return c.json({ error, message, fields }, status);
}

function safeJson(value: string | null | undefined, fallback: any) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function mapMention(row: any) {
  return {
    ...row,
    matched_keywords: safeJson(row.matched_keywords, []),
    relevance: safeJson(row.relevance, {}),
    sentiment: safeJson(row.sentiment, {}),
    risk: safeJson(row.risk, {}),
    topics: safeJson(row.topics, []),
    entities: safeJson(row.entities, []),
    engagement: safeJson(row.engagement, {}),
    duplicate: safeJson(row.duplicate_info, {}),
    evidence: safeJson(row.evidence, []),
    extra: safeJson(row.extra, {}),
    excluded: !!row.excluded,
  };
}

function mapDigest(row: any) {
  return {
    ...row,
    summary: safeJson(row.summary, {}),
    stats: safeJson(row.stats, {}),
    urgent_mentions: safeJson(row.urgent_mentions, []),
    top_topics: safeJson(row.top_topics, []),
    emerging_issues: safeJson(row.emerging_issues, []),
    repeated_issues: safeJson(row.repeated_issues, []),
    positive_mentions: safeJson(row.positive_mentions, []),
    source_breakdown: safeJson(row.source_breakdown, []),
    keyword_breakdown: safeJson(row.keyword_breakdown, []),
    discovered_keywords: safeJson(row.discovered_keywords, []),
    data_quality: safeJson(row.data_quality, []),
    extra: safeJson(row.extra, {}),
  };
}

function mapMonthly(row: any) {
  return {
    ...row,
    stats: safeJson(row.stats, {}),
    source_breakdown: safeJson(row.source_breakdown, []),
    daily_trend: safeJson(row.daily_trend, []),
    sentiment_breakdown: safeJson(row.sentiment_breakdown, []),
    risk_breakdown: safeJson(row.risk_breakdown, []),
    top_topics: safeJson(row.top_topics, []),
    repeated_issues: safeJson(row.repeated_issues, []),
    discovered_keywords: safeJson(row.discovered_keywords, []),
    workflow_breakdown: safeJson(row.workflow_breakdown, []),
    extra: safeJson(row.extra, {}),
  };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
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
  return `mmn_${base64Url(bytes)}`;
}

async function authenticateApiKey(c: any): Promise<MentionApiKeyRecord | Response> {
  const rawKey = String(c.req.header('X-API-Key') || '').trim();
  if (!rawKey) return errorJson(c, 401, 'missing_api_key', 'X-API-Key 헤더가 필요합니다.');
  const record = await c.env.DB.prepare(`
    SELECT id, revoked_at FROM mention_api_keys
    WHERE token_hash = ? AND scope = 'mentions:write' LIMIT 1
  `).bind(await sha256Hex(rawKey)).first() as MentionApiKeyRecord | null;
  if (!record || record.revoked_at) return errorJson(c, 401, 'invalid_api_key', '유효하지 않거나 폐기된 외부 언급 API 키입니다.');
  return record;
}

async function requireViewer(c: any, next: any) {
  return authMiddleware(c, async () => {
    const user = c.get('user');
    if (!user || user.auth_type !== 'user' || !canViewExternalMentions(user)) {
      return errorJson(c, 403, 'forbidden', '외부 언급 모니터링 열람 권한이 없습니다.');
    }
    return next();
  });
}

async function parseLimitedJson(c: any): Promise<{ body?: any; bodyBytes: number; response?: Response }> {
  const contentLength = Number(c.req.header('Content-Length') || 0);
  if (contentLength > MAX_BODY_BYTES) return { bodyBytes: contentLength, response: errorJson(c, 413, 'payload_too_large', '요청 본문은 5MB 이하여야 합니다.') };
  const text = await c.req.text();
  const bodyBytes = new TextEncoder().encode(text).byteLength;
  if (bodyBytes > MAX_BODY_BYTES) return { bodyBytes, response: errorJson(c, 413, 'payload_too_large', '요청 본문은 5MB 이하여야 합니다.') };
  try { return { body: JSON.parse(text), bodyBytes }; }
  catch { return { bodyBytes, response: errorJson(c, 400, 'invalid_json', '올바른 JSON 본문이 아닙니다.', ['body']) }; }
}

async function enforceRateLimit(c: any, keyId: string): Promise<Response | null> {
  const minuteBucket = new Date().toISOString().slice(0, 16);
  const rate = await c.env.DB.prepare(`
    INSERT INTO mention_api_rate_limits (api_key_id, minute_bucket, request_count)
    VALUES (?, ?, 1)
    ON CONFLICT(api_key_id, minute_bucket) DO UPDATE SET request_count = request_count + 1
    RETURNING request_count
  `).bind(keyId, minuteBucket).first() as { request_count?: number } | null;
  return (rate?.request_count || 0) > 10
    ? errorJson(c, 429, 'rate_limited', '외부 언급 API는 키당 분당 10회까지 호출할 수 있습니다.')
    : null;
}

async function touchKey(c: any, keyId: string) {
  await c.env.DB.prepare("UPDATE mention_api_keys SET last_used_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").bind(keyId).run();
}

mentionsRoute.onError((error, c) => {
  console.error('[mentions]', error.message);
  return errorJson(c, 500, 'server_error', '외부 언급 요청을 처리하지 못했습니다.');
});

mentionsRoute.get('/health', (c) => c.json({ ok: true, service: 'external-mentions' }));

mentionsRoute.get('/keys', authMiddleware, requireHumanMaster(), async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT id, name, scope, token_prefix, last_used_at, revoked_at, created_at
    FROM mention_api_keys ORDER BY created_at DESC
  `).all();
  return c.json({ api_keys: result.results });
});

mentionsRoute.post('/keys', authMiddleware, requireHumanMaster(), async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({})) as { name?: string };
  const name = String(body.name || '').trim();
  if (!name) return errorJson(c, 400, 'validation_failed', '키 이름이 필요합니다.', ['name']);
  const token = generateApiKey();
  const id = crypto.randomUUID();
  await c.env.DB.prepare(`
    INSERT INTO mention_api_keys (id, name, scope, token_prefix, token_hash, created_by)
    VALUES (?, ?, 'mentions:write', ?, ?, ?)
  `).bind(id, name, token.slice(0, 12), await sha256Hex(token), user.sub).run();
  return c.json({ api_key: { id, name, scope: 'mentions:write', token_prefix: token.slice(0, 12) }, token }, 201);
});

mentionsRoute.delete('/keys/:id', authMiddleware, requireHumanMaster(), async (c) => {
  const result = await c.env.DB.prepare(`
    UPDATE mention_api_keys SET revoked_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ? AND revoked_at IS NULL
  `).bind(c.req.param('id')).run();
  if (!result.meta.changes) return errorJson(c, 404, 'not_found', '활성 외부 언급 API 키를 찾을 수 없습니다.');
  return c.json({ success: true });
});

mentionsRoute.post('/batch', async (c) => {
  const parsed = await parseLimitedJson(c);
  if (parsed.response) return parsed.response;
  const authenticated = await authenticateApiKey(c);
  if (authenticated instanceof Response) return authenticated;
  const rateResponse = await enforceRateLimit(c, authenticated.id);
  if (rateResponse) return rateResponse;
  const fields = validateMentionBatch(parsed.body);
  if (fields.length) return errorJson(c, 400, 'validation_failed', '필수 값 또는 데이터 형식이 올바르지 않습니다.', fields);
  if (c.req.query('dry_run') === '1') return c.json({ valid: true });

  const rawMentions = parsed.body.mentions as any[];
  const uniqueMentions = [...new Map(rawMentions.map((mention) => [mention.external_id, mention])).values()];
  const ids = uniqueMentions.map((mention) => mention.external_id);
  const existing = ids.length ? await c.env.DB.prepare(`SELECT external_id FROM external_mentions WHERE external_id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all() : { results: [] };
  const existingIds = new Set((existing.results || []).map((row: any) => row.external_id));
  const known = new Set(['external_id', 'url', 'canonical_url', 'source_type', 'source_name', 'author', 'published_at', 'collected_at', 'title', 'snippet', 'thumbnail_url', 'language', 'matched_keywords', 'content_hash', 'relevance', 'sentiment', 'risk', 'topics', 'entities', 'engagement', 'duplicate', 'evidence', 'extra']);
  const statements = uniqueMentions.map((mention) => {
    const unknown = Object.fromEntries(Object.entries(mention).filter(([key]) => !known.has(key)));
    const extra = { ...(mention.extra || {}), ...unknown };
    return c.env.DB.prepare(`
      INSERT INTO external_mentions (
        id, external_id, url, canonical_url, source_type, source_name, author, published_at, collected_at,
        title, snippet, thumbnail_url, language, matched_keywords, content_hash, relevance, sentiment, risk,
        topics, entities, engagement, duplicate_info, evidence, extra
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(external_id) DO UPDATE SET
        url = excluded.url, canonical_url = excluded.canonical_url, source_type = excluded.source_type,
        source_name = excluded.source_name, author = excluded.author, published_at = excluded.published_at,
        collected_at = excluded.collected_at, title = excluded.title, snippet = excluded.snippet,
        thumbnail_url = excluded.thumbnail_url, language = excluded.language,
        matched_keywords = excluded.matched_keywords, content_hash = excluded.content_hash,
        relevance = excluded.relevance, sentiment = excluded.sentiment, risk = excluded.risk,
        topics = excluded.topics, entities = excluded.entities, engagement = excluded.engagement,
        duplicate_info = excluded.duplicate_info, evidence = excluded.evidence, extra = excluded.extra,
        updated_at = datetime('now')
    `).bind(
      crypto.randomUUID(), mention.external_id, mention.url, mention.canonical_url, mention.source_type,
      mention.source_name, mention.author || null, mention.published_at || null, mention.collected_at,
      mention.title, mention.snippet, mention.thumbnail_url || null, mention.language || 'ko',
      JSON.stringify(mention.matched_keywords || []), mention.content_hash, JSON.stringify(mention.relevance || {}),
      JSON.stringify(mention.sentiment || {}), JSON.stringify(mention.risk || {}), JSON.stringify(mention.topics || []),
      JSON.stringify(mention.entities || []), JSON.stringify(mention.engagement || {}), JSON.stringify(mention.duplicate || {}),
      JSON.stringify(mention.evidence || []), JSON.stringify(extra),
    );
  });
  statements.push(c.env.DB.prepare(`
    INSERT INTO mention_collection_runs (run_id, started_at, finished_at, status, sources, received_count, accepted_count)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id) DO UPDATE SET
      started_at = excluded.started_at, finished_at = excluded.finished_at, status = excluded.status,
      sources = excluded.sources, received_count = excluded.received_count, accepted_count = excluded.accepted_count,
      updated_at = datetime('now')
  `).bind(parsed.body.run.run_id, parsed.body.run.started_at, parsed.body.run.finished_at || null, parsed.body.run.status,
    JSON.stringify(parsed.body.run.sources || []), rawMentions.length, uniqueMentions.length));
  await c.env.DB.batch(statements);
  await touchKey(c, authenticated.id);
  const created = uniqueMentions.filter((mention) => !existingIds.has(mention.external_id)).length;
  const updated = uniqueMentions.length - created;
  console.log(JSON.stringify({ event: 'mention_batch_post', run_id: parsed.body.run.run_id, body_bytes: parsed.bodyBytes, received: rawMentions.length, created, updated }));
  return c.json({ run_id: parsed.body.run.run_id, received: rawMentions.length, accepted: uniqueMentions.length, created, updated, duplicates_in_batch: rawMentions.length - uniqueMentions.length }, created ? 201 : 200);
});

mentionsRoute.get('/', requireViewer, async (c) => {
  const limit = Math.min(Math.max(Number(c.req.query('limit') || 50), 1), 200);
  const where: string[] = ['excluded = 0'];
  const binds: any[] = [];
  const date = String(c.req.query('date') || '').trim();
  const dateFrom = String(c.req.query('date_from') || '').trim();
  const dateTo = String(c.req.query('date_to') || '').trim();
  const sourceType = String(c.req.query('source_type') || '').trim();
  const sentiment = String(c.req.query('sentiment') || '').trim();
  const risk = String(c.req.query('risk') || '').trim();
  const workflow = String(c.req.query('workflow_status') || '').trim();
  if (date) { where.push("substr(COALESCE(published_at, collected_at), 1, 10) = ?"); binds.push(date); }
  if (dateFrom) { where.push("substr(COALESCE(published_at, collected_at), 1, 10) >= ?"); binds.push(dateFrom); }
  if (dateTo) { where.push("substr(COALESCE(published_at, collected_at), 1, 10) <= ?"); binds.push(dateTo); }
  if (sourceType) { where.push('source_type = ?'); binds.push(sourceType); }
  if (sentiment) { where.push("json_extract(sentiment, '$.label') = ?"); binds.push(sentiment); }
  if (risk) { where.push("json_extract(risk, '$.level') = ?"); binds.push(risk); }
  if (workflow) { where.push('workflow_status = ?'); binds.push(workflow); }
  const result = await c.env.DB.prepare(`
    SELECT * FROM external_mentions WHERE ${where.join(' AND ')}
    ORDER BY COALESCE(published_at, collected_at) DESC LIMIT ?
  `).bind(...binds, limit).all();
  return c.json({ mentions: result.results.map(mapMention) });
});

mentionsRoute.get('/runs', requireViewer, async (c) => {
  const limit = Math.min(Math.max(Number(c.req.query('limit') || 20), 1), 100);
  const result = await c.env.DB.prepare('SELECT * FROM mention_collection_runs ORDER BY started_at DESC LIMIT ?').bind(limit).all();
  return c.json({ runs: result.results.map((row: any) => ({ ...row, sources: safeJson(row.sources, []) })) });
});

mentionsRoute.patch('/:id/status', requireViewer, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({})) as { workflow_status?: string; internal_note?: string; exclusion_reason?: string };
  const status = String(body.workflow_status || '');
  if (!WORKFLOW_STATUSES.includes(status)) return errorJson(c, 400, 'validation_failed', '처리 상태가 올바르지 않습니다.', ['workflow_status']);
  const excluded = status === 'excluded' ? 1 : 0;
  const result = await c.env.DB.prepare(`
    UPDATE external_mentions SET workflow_status = ?, internal_note = COALESCE(?, internal_note),
      excluded = ?, exclusion_reason = COALESCE(?, exclusion_reason), reviewed_at = datetime('now'),
      reviewed_by = ?, updated_at = datetime('now') WHERE id = ?
  `).bind(status, body.internal_note === undefined ? null : String(body.internal_note), excluded,
    body.exclusion_reason === undefined ? null : String(body.exclusion_reason), user.sub, c.req.param('id')).run();
  if (!result.meta.changes) return errorJson(c, 404, 'not_found', '외부 언급을 찾을 수 없습니다.');
  return c.json({ success: true });
});

mentionDigestsRoute.onError((error, c) => {
  console.error('[mention-digests]', error.message);
  return errorJson(c, 500, 'server_error', '외부 언급 일일 보고를 처리하지 못했습니다.');
});

mentionDigestsRoute.get('/', requireViewer, async (c) => {
  const limit = Math.min(Math.max(Number(c.req.query('limit') || 30), 1), 366);
  const date = String(c.req.query('date') || '').trim();
  const dateFrom = String(c.req.query('date_from') || '').trim();
  const dateTo = String(c.req.query('date_to') || '').trim();
  const where: string[] = [];
  const binds: any[] = [];
  if (date) { where.push('report_date = ?'); binds.push(date); }
  if (dateFrom) { where.push('report_date >= ?'); binds.push(dateFrom); }
  if (dateTo) { where.push('report_date <= ?'); binds.push(dateTo); }
  const result = await c.env.DB.prepare(`SELECT * FROM mention_digests ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY report_date DESC LIMIT ?`)
    .bind(...binds, limit).all();
  return c.json({ digests: result.results.map(mapDigest) });
});

mentionDigestsRoute.get('/monthly', requireViewer, async (c) => {
  const month = String(c.req.query('month') || '').trim();
  const limit = Math.min(Math.max(Number(c.req.query('limit') || 24), 1), 120);
  if (month) {
    if (!isMonth(month)) return errorJson(c, 400, 'validation_failed', '연도와 월 형식을 확인해 주세요.', ['month']);
    return c.json({ monthly_summaries: [await buildMentionMonthlySummary(c.env.DB, month, false)] });
  }
  const result = await c.env.DB.prepare('SELECT * FROM mention_monthly_summaries ORDER BY month DESC LIMIT ?').bind(limit).all();
  const currentMonth = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 7);
  const current = await buildMentionMonthlySummary(c.env.DB, currentMonth, false);
  const stored = result.results.map(mapMonthly).filter((item: any) => item.month !== currentMonth);
  return c.json({ monthly_summaries: [current, ...stored].slice(0, limit) });
});

mentionDigestsRoute.post('/monthly/rebuild', authMiddleware, requireHumanMaster(), async (c) => {
  const body = await c.req.json().catch(() => ({})) as { month?: string };
  const month = String(body.month || '').trim();
  if (!isMonth(month)) return errorJson(c, 400, 'validation_failed', '연도와 월 형식을 확인해 주세요.', ['month']);
  return c.json({ monthly_summary: await buildMentionMonthlySummary(c.env.DB, month, true) });
});

mentionDigestsRoute.get('/:id/revisions', requireViewer, async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT revision, snapshot, archived_at FROM mention_digest_revisions
    WHERE digest_id = ? ORDER BY revision DESC
  `).bind(c.req.param('id')).all();
  return c.json({ revisions: result.results.map((row: any) => ({
    revision: row.revision,
    archived_at: row.archived_at,
    digest: mapDigest(safeJson(row.snapshot, {})),
  })) });
});

mentionDigestsRoute.post('/', async (c) => {
  const parsed = await parseLimitedJson(c);
  if (parsed.response) return parsed.response;
  const authenticated = await authenticateApiKey(c);
  if (authenticated instanceof Response) return authenticated;
  const rateResponse = await enforceRateLimit(c, authenticated.id);
  if (rateResponse) return rateResponse;
  const fields = validateMentionDigest(parsed.body);
  if (fields.length) return errorJson(c, 400, 'validation_failed', '일일 보고의 필수 값 또는 형식이 올바르지 않습니다.', fields);
  if (c.req.query('dry_run') === '1') return c.json({ valid: true });
  const existing = await c.env.DB.prepare('SELECT * FROM mention_digests WHERE report_key = ? OR report_date = ? LIMIT 1')
    .bind(parsed.body.report_key, parsed.body.report_date).first<any>();
  const id = existing?.id || crypto.randomUUID();
  const known = new Set(['report_key', 'report_date', 'period', 'summary', 'stats', 'urgent_mentions', 'top_topics', 'emerging_issues', 'repeated_issues', 'positive_mentions', 'source_breakdown', 'keyword_breakdown', 'discovered_keywords', 'data_quality', 'extra']);
  const unknown = Object.fromEntries(Object.entries(parsed.body).filter(([key]) => !known.has(key)));
  const extra = { ...(parsed.body.extra || {}), ...unknown };
  const digestValues = [
    parsed.body.report_key, parsed.body.report_date, parsed.body.period.start, parsed.body.period.end,
    JSON.stringify(parsed.body.summary), JSON.stringify(parsed.body.stats), JSON.stringify(parsed.body.urgent_mentions || []),
    JSON.stringify(parsed.body.top_topics || []), JSON.stringify(parsed.body.emerging_issues || []),
    JSON.stringify(parsed.body.repeated_issues || []), JSON.stringify(parsed.body.positive_mentions || []),
    JSON.stringify(parsed.body.source_breakdown || []), JSON.stringify(parsed.body.keyword_breakdown || []),
    JSON.stringify(parsed.body.discovered_keywords || []), JSON.stringify(parsed.body.data_quality || []), JSON.stringify(extra),
  ];
  if (existing) {
    await c.env.DB.prepare(`
      INSERT OR IGNORE INTO mention_digest_revisions (id, digest_id, report_key, revision, snapshot)
      VALUES (?, ?, ?, ?, ?)
    `).bind(crypto.randomUUID(), id, existing.report_key, existing.revision, JSON.stringify(existing)).run();
    await c.env.DB.prepare(`
      UPDATE mention_digests SET report_key = ?, report_date = ?, period_start = ?, period_end = ?,
        summary = ?, stats = ?, urgent_mentions = ?, top_topics = ?, emerging_issues = ?, repeated_issues = ?,
        positive_mentions = ?, source_breakdown = ?, keyword_breakdown = ?, discovered_keywords = ?,
        data_quality = ?, extra = ?, revision = revision + 1, updated_at = datetime('now') WHERE id = ?
    `).bind(...digestValues, id).run();
  } else {
    await c.env.DB.prepare(`
      INSERT INTO mention_digests (
        id, report_key, report_date, period_start, period_end, summary, stats, urgent_mentions,
        top_topics, emerging_issues, repeated_issues, positive_mentions, source_breakdown,
        keyword_breakdown, discovered_keywords, data_quality, extra
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, ...digestValues).run();
  }
  await touchKey(c, authenticated.id);
  console.log(JSON.stringify({ event: 'mention_digest_post', report_key: parsed.body.report_key, body_bytes: parsed.bodyBytes, created: !existing }));
  return c.json({ id, url: `${new URL(c.req.url).origin}/external-mentions?date=${parsed.body.report_date}`, created: !existing }, existing ? 200 : 201);
});

