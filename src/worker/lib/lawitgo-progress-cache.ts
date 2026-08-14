import { listActiveLawitgoConsultantMappings } from './lawitgo-consultant-mapping';
import {
  lawitgoProgressUrl,
  lawitgoRequestHeaders,
  normalizeLawitgoProgressDetail,
  normalizeLawitgoProgressList,
  type LawitgoProgressListItem,
} from './lawitgo-progress';

const schemaReady = new WeakMap<object, Promise<void>>();
const REQUEST_TIMEOUT_MS = 15_000;
const CONSULTANT_CONCURRENCY = 3;
const DETAIL_CONCURRENCY = 5;

export async function ensureLawitgoProgressCacheSchema(db: D1Database): Promise<void> {
  const key = db as unknown as object;
  const existing = schemaReady.get(key);
  if (existing) return existing;
  const setup = db.batch([
    db.prepare(`
      CREATE TABLE IF NOT EXISTS lawitgo_progress_cache (
        consultant_id TEXT NOT NULL,
        progress_id TEXT NOT NULL,
        item_json TEXT NOT NULL,
        ui_html TEXT NOT NULL DEFAULT '',
        ui_css TEXT NOT NULL DEFAULT '',
        active INTEGER NOT NULL DEFAULT 1,
        fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (consultant_id, progress_id)
      )
    `),
    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_lawitgo_progress_cache_active
      ON lawitgo_progress_cache(active, progress_id)
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS lawitgo_progress_cache_runs (
        consultant_id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'pending',
        item_count INTEGER NOT NULL DEFAULT 0,
        last_success_at TEXT,
        last_attempt_at TEXT NOT NULL DEFAULT (datetime('now')),
        error_message TEXT NOT NULL DEFAULT ''
      )
    `),
  ]).then(() => undefined);
  schemaReady.set(key, setup);
  try {
    await setup;
  } catch (error) {
    schemaReady.delete(key);
    throw error;
  }
}

async function mapWithConcurrency<T, R>(values: T[], limit: number, task: (value: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await task(values[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function fetchJson(apiKey: string, consultantId: string, url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: lawitgoRequestHeaders(apiKey, consultantId),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`upstream status ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

type CachedDetail = {
  item: LawitgoProgressListItem;
  ui: { html: string; css: string };
};

async function pullConsultant(
  db: D1Database,
  apiKey: string,
  consultantId: string,
): Promise<{ success: boolean; items: number }> {
  try {
    const listPayload = await fetchJson(apiKey, consultantId, lawitgoProgressUrl());
    const list = normalizeLawitgoProgressList(listPayload).items;
    const details = await mapWithConcurrency(list, DETAIL_CONCURRENCY, async (listItem): Promise<CachedDetail> => {
      const detailPayload = await fetchJson(apiKey, consultantId, lawitgoProgressUrl(listItem.id));
      const detail = normalizeLawitgoProgressDetail(detailPayload);
      if (!detail) throw new Error(`invalid detail payload: ${listItem.id}`);
      return detail;
    });

    const statements = [
      db.prepare('UPDATE lawitgo_progress_cache SET active = 0 WHERE consultant_id = ?').bind(consultantId),
      ...details.map((detail) => db.prepare(`
        INSERT INTO lawitgo_progress_cache (
          consultant_id, progress_id, item_json, ui_html, ui_css, active, fetched_at
        ) VALUES (?, ?, ?, ?, ?, 1, datetime('now'))
        ON CONFLICT(consultant_id, progress_id) DO UPDATE SET
          item_json = excluded.item_json,
          ui_html = excluded.ui_html,
          ui_css = excluded.ui_css,
          active = 1,
          fetched_at = datetime('now')
      `).bind(
        consultantId,
        detail.item.id,
        JSON.stringify(detail.item),
        detail.ui.html,
        detail.ui.css,
      )),
      db.prepare(`
        INSERT INTO lawitgo_progress_cache_runs (
          consultant_id, status, item_count, last_success_at, last_attempt_at, error_message
        ) VALUES (?, 'success', ?, datetime('now'), datetime('now'), '')
        ON CONFLICT(consultant_id) DO UPDATE SET
          status = 'success', item_count = excluded.item_count,
          last_success_at = datetime('now'), last_attempt_at = datetime('now'), error_message = ''
      `).bind(consultantId, details.length),
    ];
    await db.batch(statements);
    return { success: true, items: details.length };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : 'unknown error';
    await db.prepare(`
      INSERT INTO lawitgo_progress_cache_runs (
        consultant_id, status, item_count, last_attempt_at, error_message
      ) VALUES (?, 'failed', 0, datetime('now'), ?)
      ON CONFLICT(consultant_id) DO UPDATE SET
        status = 'failed', last_attempt_at = datetime('now'), error_message = excluded.error_message
    `).bind(consultantId, message).run();
    console.error('[lawitgo cache] consultant pull failed', consultantId, message);
    return { success: false, items: 0 };
  }
}

export async function pullLawitgoProgressCache(env: Env): Promise<{
  consultants: number;
  succeeded: number;
  failed: number;
  items: number;
}> {
  const apiKey = String(env.LAWITGO_API_KEY || '').trim();
  if (!apiKey) throw new Error('LAWITGO_API_KEY is not configured');
  await ensureLawitgoProgressCacheSchema(env.DB);
  const mappings = await listActiveLawitgoConsultantMappings(env.DB);
  const results = await mapWithConcurrency(mappings, CONSULTANT_CONCURRENCY, (mapping) =>
    pullConsultant(env.DB, apiKey, mapping.consultantId)
  );
  return {
    consultants: mappings.length,
    succeeded: results.filter((result) => result.success).length,
    failed: results.filter((result) => !result.success).length,
    items: results.reduce((sum, result) => sum + result.items, 0),
  };
}

export async function cachedLawitgoList(db: D1Database, consultantId?: string): Promise<{
  items: LawitgoProgressListItem[];
  refreshedAt: string;
}> {
  await ensureLawitgoProgressCacheSchema(db);
  const condition = consultantId ? 'AND c.consultant_id = ?' : '';
  const statement = db.prepare(`
    SELECT c.item_json, c.fetched_at, COALESCE(u.name, '') AS consultant_name
    FROM lawitgo_progress_cache c
    INNER JOIN lawitgo_consultant_mappings m ON m.consultant_id = c.consultant_id
    INNER JOIN users u ON u.id = m.user_id AND u.approved = 1 AND u.role != 'resigned'
    WHERE c.active = 1 ${condition}
    ORDER BY c.fetched_at DESC, c.progress_id
  `);
  const result = consultantId
    ? await statement.bind(consultantId).all<{ item_json: string; fetched_at: string; consultant_name: string }>()
    : await statement.all<{ item_json: string; fetched_at: string; consultant_name: string }>();
  let refreshedAt = '';
  const items = (result.results || []).flatMap((row) => {
    try {
      const normalized = normalizeLawitgoProgressList([JSON.parse(row.item_json)]).items[0];
      if (!normalized) return [];
      // 전체 열람에서는 가장 오래된 항목의 기준시각을 보여줘 일부 담당자 갱신 실패를 최신처럼 보이지 않게 한다.
      if (!refreshedAt || row.fetched_at < refreshedAt) refreshedAt = row.fetched_at;
      return [{ ...normalized, consultantName: row.consultant_name }];
    } catch {
      return [];
    }
  });
  return { items, refreshedAt };
}

export async function cachedLawitgoDetail(
  db: D1Database,
  progressId: string,
  consultantId?: string,
): Promise<{ item: LawitgoProgressListItem; ui: { html: string; css: string }; refreshedAt: string } | null> {
  await ensureLawitgoProgressCacheSchema(db);
  const condition = consultantId ? 'AND c.consultant_id = ?' : '';
  const statement = db.prepare(`
    SELECT c.item_json, c.ui_html, c.ui_css, c.fetched_at, COALESCE(u.name, '') AS consultant_name
    FROM lawitgo_progress_cache c
    INNER JOIN lawitgo_consultant_mappings m ON m.consultant_id = c.consultant_id
    INNER JOIN users u ON u.id = m.user_id AND u.approved = 1 AND u.role != 'resigned'
    WHERE c.progress_id = ? AND c.active = 1 ${condition}
    ORDER BY c.fetched_at DESC
    LIMIT 1
  `);
  const row = consultantId
    ? await statement.bind(progressId, consultantId).first<{
        item_json: string; ui_html: string; ui_css: string; fetched_at: string; consultant_name: string;
      }>()
    : await statement.bind(progressId).first<{
        item_json: string; ui_html: string; ui_css: string; fetched_at: string; consultant_name: string;
      }>();
  if (!row) return null;
  try {
    const item = normalizeLawitgoProgressList([JSON.parse(row.item_json)]).items[0];
    if (!item) return null;
    return {
      item: { ...item, consultantName: row.consultant_name },
      ui: { html: row.ui_html, css: row.ui_css },
      refreshedAt: row.fetched_at,
    };
  } catch {
    return null;
  }
}
