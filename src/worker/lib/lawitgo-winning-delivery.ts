const WINNING_CUTOVER_KST = '2026-08-14 00:00:00';
const DELIVERY_HOURS_UTC = new Set([0, 3, 6, 9]); // 09, 12, 15, 18 KST
const BATCH_LIMIT = 50;
const LAWITGO_WINNING_API_URL = 'https://www.lawitgo.com/api/integrations/mydocs/winning-cases/batch';

type WinningSourceRow = {
  sales_record_id: string;
  assignee_user_id: string;
  assignee_name: string;
  consultant_id: string | null;
  branch: string;
  customer_name: string;
  customer_phone: string;
  winning_date: string;
  type_detail: string;
  journal_data: string | null;
  schedule_data: string | null;
  analysis_case_number: string | null;
  analysis_property_type: string | null;
  analysis_bid_datetime: string | null;
};

export type LawitgoWinningItem = {
  externalId: string;
  customerName: string;
  customerPhone: string;
  court: string;
  caseNumber: string;
  propertyType: string;
  winningDate: string;
  assignee: {
    myDocsUserId: string;
    consultantId: string;
    name: string;
    branch: string;
  };
};

function parseObject(value: string | null): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function text(value: unknown): string {
  return String(value || '').trim();
}

function normalizedPhone(value: unknown): string {
  const digits = text(value).replace(/\D/g, '');
  return /^0\d{9,10}$/.test(digits) ? digits : '';
}

function detailsCourt(value: string): string {
  const first = value.split(/\s*[·|]\s*/)[0]?.trim() || '';
  return /(법원|지원)$/.test(first) ? first : '';
}

function detailsCaseNumber(value: string): string {
  return value.match(/\d{4}\s*(?:타경|타인|본|하단|경매)\s*\d+(?:\(\d+\))?/u)?.[0]?.replace(/\s+/g, '') || '';
}

export function buildLawitgoWinningItem(row: WinningSourceRow): {
  item: LawitgoWinningItem;
  missingFields: string[];
} {
  const journal = parseObject(row.journal_data);
  const schedule = parseObject(row.schedule_data);
  const source = Object.keys(schedule).length > 0 ? schedule : journal;
  const item: LawitgoWinningItem = {
    externalId: row.sales_record_id,
    customerName: text(row.customer_name),
    customerPhone: normalizedPhone(row.customer_phone),
    court: text(source.court) || detailsCourt(row.type_detail),
    caseNumber: text(source.caseNo) || text(row.analysis_case_number) || detailsCaseNumber(row.type_detail),
    propertyType: text(source.propertyType) || text(row.analysis_property_type),
    winningDate: text(row.analysis_bid_datetime).slice(0, 10) || text(row.winning_date).slice(0, 10),
    assignee: {
      myDocsUserId: text(row.assignee_user_id),
      consultantId: text(row.consultant_id),
      name: text(row.assignee_name),
      branch: text(row.branch),
    },
  };

  const missingFields: string[] = [];
  if (!item.customerName) missingFields.push('customerName');
  if (!item.customerPhone) missingFields.push('customerPhone');
  if (!item.court) missingFields.push('court');
  if (!item.caseNumber) missingFields.push('caseNumber');
  if (!item.propertyType) missingFields.push('propertyType');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(item.winningDate)) missingFields.push('winningDate');
  if (!item.assignee.myDocsUserId) missingFields.push('assignee.myDocsUserId');
  if (!item.assignee.consultantId) missingFields.push('assignee.consultantId');
  if (!item.assignee.name) missingFields.push('assignee.name');
  return { item, missingFields };
}

export function isLawitgoWinningDeliverySlot(date: Date): boolean {
  return date.getUTCMinutes() === 0 && DELIVERY_HOURS_UTC.has(date.getUTCHours());
}

export function lawitgoWinningSlot(date: Date): string {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 13).replace('T', ' ');
}

export async function ensureLawitgoWinningSchema(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS lawitgo_winning_outbox (
      id TEXT PRIMARY KEY, sales_record_id TEXT NOT NULL UNIQUE, payload_json TEXT NOT NULL DEFAULT '{}',
      missing_fields TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'pending',
      attempt_count INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT, claim_token TEXT,
      last_attempt_at TEXT, sent_at TEXT, response_status INTEGER, remote_request_id TEXT,
      last_error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours'))
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_lawitgo_winning_outbox_due ON lawitgo_winning_outbox(status, next_attempt_at, created_at)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS lawitgo_winning_delivery_runs (
      id TEXT PRIMARY KEY, scheduled_slot TEXT NOT NULL, status TEXT NOT NULL,
      staged_count INTEGER NOT NULL DEFAULT 0, blocked_count INTEGER NOT NULL DEFAULT 0,
      claimed_count INTEGER NOT NULL DEFAULT 0, sent_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0, error TEXT,
      started_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')), finished_at TEXT
    )`),
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_lawitgo_winning_runs_slot ON lawitgo_winning_delivery_runs(scheduled_slot)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS lawitgo_winning_manual_runs (
      id TEXT PRIMARY KEY, actor_user_id TEXT NOT NULL, status TEXT NOT NULL,
      requested_count INTEGER NOT NULL DEFAULT 0, claimed_count INTEGER NOT NULL DEFAULT 0,
      sent_count INTEGER NOT NULL DEFAULT 0, failed_count INTEGER NOT NULL DEFAULT 0,
      remote_request_id TEXT, error TEXT,
      started_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')), finished_at TEXT
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_lawitgo_winning_manual_runs_started ON lawitgo_winning_manual_runs(started_at DESC)'),
  ]);
}

async function sourceRows(db: D1Database): Promise<WinningSourceRow[]> {
  const result = await db.prepare(`
    SELECT sr.id AS sales_record_id, sr.user_id AS assignee_user_id,
           COALESCE(u.name, '') AS assignee_name, m.consultant_id,
           COALESCE(sr.branch, '') AS branch, COALESCE(sr.client_name, '') AS customer_name,
           COALESCE(sr.client_phone, '') AS customer_phone, COALESCE(sr.contract_date, '') AS winning_date,
           COALESCE(sr.type_detail, '') AS type_detail, j.data AS journal_data, fs.data AS schedule_data,
           ba.case_number AS analysis_case_number, ba.property_type AS analysis_property_type,
           ba.bid_datetime AS analysis_bid_datetime
    FROM sales_records sr
    LEFT JOIN users u ON u.id = sr.user_id
    LEFT JOIN lawitgo_consultant_mappings m ON m.user_id = sr.user_id
    LEFT JOIN journal_entries j ON j.id = sr.journal_entry_id
    LEFT JOIN freelancer_auction_schedules fs
      ON fs.id = CASE
        WHEN sr.external_id LIKE 'auction-schedule:%'
          THEN substr(sr.external_id, length('auction-schedule:') + 1)
        WHEN sr.external_id LIKE 'auction_schedule:%'
          THEN substr(sr.external_id, length('auction_schedule:') + 1)
        ELSE NULL END
    LEFT JOIN bid_analysis_entries ba ON ba.id = COALESCE((
      SELECT b.id FROM bid_analysis_entries b
      WHERE b.bid_result = '낙찰'
        AND b.assignee_user_id = sr.user_id
        AND (
          b.source_id = sr.journal_entry_id OR b.source_id = sr.external_id OR
          b.source_id = CASE
            WHEN sr.external_id LIKE 'auction-schedule:%'
              THEN substr(sr.external_id, length('auction-schedule:') + 1)
            WHEN sr.external_id LIKE 'auction_schedule:%'
              THEN substr(sr.external_id, length('auction_schedule:') + 1)
            ELSE NULL END
        )
      ORDER BY b.updated_at DESC
      LIMIT 1
    ), (
      SELECT b.id FROM bid_analysis_entries b
      WHERE b.bid_result = '낙찰'
        AND b.assignee_user_id = sr.user_id
        AND substr(b.bid_datetime, 1, 10) = substr(sr.contract_date, 1, 10)
        AND REPLACE(LOWER(TRIM(b.client_name)), ' ', '') = REPLACE(LOWER(TRIM(sr.client_name)), ' ', '')
        AND (SELECT COUNT(*) FROM bid_analysis_entries bx
             WHERE bx.bid_result = '낙찰' AND bx.assignee_user_id = sr.user_id
               AND substr(bx.bid_datetime, 1, 10) = substr(sr.contract_date, 1, 10)
               AND REPLACE(LOWER(TRIM(bx.client_name)), ' ', '') = REPLACE(LOWER(TRIM(sr.client_name)), ' ', '')) = 1
      ORDER BY b.updated_at DESC
      LIMIT 1
    ))
    WHERE sr.type = '낙찰' AND COALESCE(sr.amount, 0) > 0
      AND COALESCE(sr.direction, 'income') != 'expense' AND COALESCE(sr.status, '') != 'refunded'
      AND sr.created_at >= ?
    ORDER BY sr.created_at ASC
  `).bind(WINNING_CUTOVER_KST).all<WinningSourceRow>();
  return result.results || [];
}

export async function stageLawitgoWinningOutbox(db: D1Database): Promise<{ staged: number; blocked: number }> {
  await ensureLawitgoWinningSchema(db);
  const rows = await sourceRows(db);
  let blocked = 0;
  const statements = rows.map((row) => {
    const built = buildLawitgoWinningItem(row);
    if (built.missingFields.length > 0) blocked += 1;
    const nextStatus = built.missingFields.length > 0 ? 'blocked' : 'pending';
    return db.prepare(`
      INSERT INTO lawitgo_winning_outbox
        (id, sales_record_id, payload_json, missing_fields, status, next_attempt_at)
      VALUES (?, ?, ?, ?, ?, datetime('now', '+9 hours'))
      ON CONFLICT(sales_record_id) DO UPDATE SET
        payload_json = excluded.payload_json,
        missing_fields = excluded.missing_fields,
        status = CASE
          WHEN lawitgo_winning_outbox.status = 'sent' THEN 'sent'
          WHEN excluded.status = 'blocked' THEN 'blocked'
          WHEN lawitgo_winning_outbox.status = 'blocked' THEN 'pending'
          ELSE lawitgo_winning_outbox.status END,
        next_attempt_at = CASE WHEN lawitgo_winning_outbox.status = 'blocked' AND excluded.status = 'pending'
                               THEN datetime('now', '+9 hours') ELSE lawitgo_winning_outbox.next_attempt_at END,
        updated_at = datetime('now', '+9 hours')
    `).bind(crypto.randomUUID(), row.sales_record_id, JSON.stringify(built.item), JSON.stringify(built.missingFields), nextStatus);
  });
  if (statements.length > 0) await db.batch(statements);
  return { staged: rows.length, blocked };
}

export async function runLawitgoWinningDelivery(
  env: { DB: D1Database; LAWITGO_WINNING_API_KEY?: string } & Record<string, unknown>,
  scheduledAt = new Date(),
): Promise<{ due: boolean; configured: boolean; staged: number; blocked: number; claimed: number; sent: number; failed: number }> {
  if (!isLawitgoWinningDeliverySlot(scheduledAt)) {
    return { due: false, configured: false, staged: 0, blocked: 0, claimed: 0, sent: 0, failed: 0 };
  }
  const db = env.DB;
  const slot = lawitgoWinningSlot(scheduledAt);
  await ensureLawitgoWinningSchema(db);
  await db.prepare(`UPDATE lawitgo_winning_delivery_runs
    SET status='failed', error=COALESCE(error, 'stale delivery run recovered'),
        finished_at=COALESCE(finished_at, datetime('now', '+9 hours'))
    WHERE status='running' AND started_at < datetime('now', '+9 hours', '-30 minutes')`).run();
  await db.prepare(`UPDATE lawitgo_winning_outbox
    SET status='failed', claim_token=NULL, next_attempt_at=datetime('now', '+9 hours'),
        last_error='stale delivery claim recovered', updated_at=datetime('now', '+9 hours')
    WHERE status='sending'
      AND last_attempt_at < datetime('now', '+9 hours', '-30 minutes')`).run();
  const runId = crypto.randomUUID();
  const claim = await db.prepare(`INSERT OR IGNORE INTO lawitgo_winning_delivery_runs (id, scheduled_slot, status) VALUES (?, ?, 'running')`)
    .bind(runId, slot).run();
  if (!claim.meta.changes) return { due: true, configured: Boolean(env.LAWITGO_WINNING_API_KEY), staged: 0, blocked: 0, claimed: 0, sent: 0, failed: 0 };

  let staged: { staged: number; blocked: number };
  try {
    staged = await stageLawitgoWinningOutbox(db);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'lawitgo staging failed';
    await db.prepare(`UPDATE lawitgo_winning_delivery_runs SET status='failed', error=?,
      finished_at=datetime('now', '+9 hours') WHERE id=?`).bind(message, runId).run();
    return { due: true, configured: Boolean(env.LAWITGO_WINNING_API_KEY), staged: 0, blocked: 0, claimed: 0, sent: 0, failed: 0 };
  }
  const apiKey = String(env.LAWITGO_WINNING_API_KEY || '').trim();
  if (!apiKey) {
    await db.prepare(`UPDATE lawitgo_winning_delivery_runs SET status='not_configured', staged_count=?, blocked_count=?,
      error=?, finished_at=datetime('now', '+9 hours') WHERE id=?`)
      .bind(staged.staged, staged.blocked, 'LAWITGO_WINNING_API_KEY is not configured', runId).run();
    return { due: true, configured: false, staged: staged.staged, blocked: staged.blocked, claimed: 0, sent: 0, failed: 0 };
  }

  const dueRows = await db.prepare(`SELECT id, sales_record_id, payload_json FROM lawitgo_winning_outbox
    WHERE status IN ('pending','failed') AND missing_fields='[]'
      AND (next_attempt_at IS NULL OR next_attempt_at <= datetime('now', '+9 hours'))
    ORDER BY created_at ASC LIMIT ?`).bind(BATCH_LIMIT).all<{ id: string; sales_record_id: string; payload_json: string }>();
  const claimToken = crypto.randomUUID();
  const claimed: typeof dueRows.results = [];
  for (const row of dueRows.results || []) {
    const result = await db.prepare(`UPDATE lawitgo_winning_outbox SET status='sending', claim_token=?,
      attempt_count=attempt_count+1, last_attempt_at=datetime('now', '+9 hours'), updated_at=datetime('now', '+9 hours')
      WHERE id=? AND status IN ('pending','failed')`).bind(claimToken, row.id).run();
    if (result.meta.changes) claimed.push(row);
  }
  if (claimed.length === 0) {
    await db.prepare(`UPDATE lawitgo_winning_delivery_runs SET status='completed', staged_count=?, blocked_count=?,
      finished_at=datetime('now', '+9 hours') WHERE id=?`).bind(staged.staged, staged.blocked, runId).run();
    return { due: true, configured: true, staged: staged.staged, blocked: staged.blocked, claimed: 0, sent: 0, failed: 0 };
  }

  try {
    const items = claimed.map((row) => JSON.parse(row.payload_json) as LawitgoWinningItem);
    const response = await fetch(LAWITGO_WINNING_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify({ source: 'my-docs', sentAt: new Date().toISOString(), items }),
    });
    if (!response.ok) throw new Error(`lawitgo winning batch failed (${response.status})`);
    const requestId = response.headers.get('X-Request-Id') || '';
    await db.batch(claimed.map((row) => db.prepare(`UPDATE lawitgo_winning_outbox SET status='sent', sent_at=datetime('now', '+9 hours'),
      response_status=?, remote_request_id=?, last_error=NULL, claim_token=NULL, updated_at=datetime('now', '+9 hours')
      WHERE id=? AND claim_token=?`).bind(response.status, requestId, row.id, claimToken)));
    await db.prepare(`UPDATE lawitgo_winning_delivery_runs SET status='completed', staged_count=?, blocked_count=?, claimed_count=?, sent_count=?,
      finished_at=datetime('now', '+9 hours') WHERE id=?`).bind(staged.staged, staged.blocked, claimed.length, claimed.length, runId).run();
    return { due: true, configured: true, staged: staged.staged, blocked: staged.blocked, claimed: claimed.length, sent: claimed.length, failed: 0 };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'lawitgo delivery failed';
    await db.batch(claimed.map((row) => db.prepare(`UPDATE lawitgo_winning_outbox SET status='failed',
      next_attempt_at=datetime('now', '+12 hours'), last_error=?, claim_token=NULL, updated_at=datetime('now', '+9 hours')
      WHERE id=? AND claim_token=?`).bind(message, row.id, claimToken)));
    await db.prepare(`UPDATE lawitgo_winning_delivery_runs SET status='failed', staged_count=?, blocked_count=?, claimed_count=?, failed_count=?, error=?,
      finished_at=datetime('now', '+9 hours') WHERE id=?`).bind(staged.staged, staged.blocked, claimed.length, claimed.length, message, runId).run();
    return { due: true, configured: true, staged: staged.staged, blocked: staged.blocked, claimed: claimed.length, sent: 0, failed: claimed.length };
  }
}

export async function runLawitgoWinningManualDelivery(
  env: { DB: D1Database; LAWITGO_WINNING_API_KEY?: string },
  actorUserId: string,
  requestedOutboxIds: string[] = [],
): Promise<{ configured: boolean; requested: number; staged: number; blocked: number; claimed: number; sent: number; failed: number; requestId: string }> {
  const db = env.DB;
  await ensureLawitgoWinningSchema(db);
  const staged = await stageLawitgoWinningOutbox(db);
  const uniqueIds = [...new Set(requestedOutboxIds.map((value) => String(value || '').trim()).filter(Boolean))].slice(0, BATCH_LIMIT);
  const runId = crypto.randomUUID();
  await db.prepare(`INSERT INTO lawitgo_winning_manual_runs (id, actor_user_id, status, requested_count)
    VALUES (?, ?, 'running', ?)`).bind(runId, actorUserId, uniqueIds.length).run();

  const apiKey = String(env.LAWITGO_WINNING_API_KEY || '').trim();
  if (!apiKey) {
    await db.prepare(`UPDATE lawitgo_winning_manual_runs SET status='not_configured', error=?,
      finished_at=datetime('now', '+9 hours') WHERE id=?`)
      .bind('LAWITGO_WINNING_API_KEY is not configured', runId).run();
    return { configured: false, requested: uniqueIds.length, ...staged, claimed: 0, sent: 0, failed: 0, requestId: '' };
  }

  await db.prepare(`UPDATE lawitgo_winning_outbox
    SET status='failed', claim_token=NULL, last_error='stale manual delivery claim recovered',
        updated_at=datetime('now', '+9 hours')
    WHERE status='sending' AND last_attempt_at < datetime('now', '+9 hours', '-30 minutes')`).run();

  let selectSql = `SELECT id, sales_record_id, payload_json FROM lawitgo_winning_outbox
    WHERE status IN ('pending','failed') AND missing_fields='[]'`;
  const bindings: unknown[] = [];
  if (uniqueIds.length > 0) {
    selectSql += ` AND id IN (${uniqueIds.map(() => '?').join(',')})`;
    bindings.push(...uniqueIds);
  }
  selectSql += ' ORDER BY created_at ASC LIMIT ?';
  bindings.push(BATCH_LIMIT);
  const dueRows = await db.prepare(selectSql).bind(...bindings)
    .all<{ id: string; sales_record_id: string; payload_json: string }>();
  const claimToken = crypto.randomUUID();
  const claimed: typeof dueRows.results = [];
  for (const row of dueRows.results || []) {
    const result = await db.prepare(`UPDATE lawitgo_winning_outbox SET status='sending', claim_token=?,
      attempt_count=attempt_count+1, last_attempt_at=datetime('now', '+9 hours'), updated_at=datetime('now', '+9 hours')
      WHERE id=? AND status IN ('pending','failed')`).bind(claimToken, row.id).run();
    if (result.meta.changes) claimed.push(row);
  }

  if (claimed.length === 0) {
    await db.prepare(`UPDATE lawitgo_winning_manual_runs SET status='completed', claimed_count=0,
      finished_at=datetime('now', '+9 hours') WHERE id=?`).bind(runId).run();
    return { configured: true, requested: uniqueIds.length, ...staged, claimed: 0, sent: 0, failed: 0, requestId: '' };
  }

  try {
    const items = claimed.map((row) => JSON.parse(row.payload_json) as LawitgoWinningItem);
    const response = await fetch(LAWITGO_WINNING_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify({ source: 'my-docs', sentAt: new Date().toISOString(), items }),
    });
    if (!response.ok) throw new Error(`lawitgo winning batch failed (${response.status})`);
    const requestId = response.headers.get('X-Request-Id') || '';
    await db.batch(claimed.map((row) => db.prepare(`UPDATE lawitgo_winning_outbox SET status='sent', sent_at=datetime('now', '+9 hours'),
      response_status=?, remote_request_id=?, last_error=NULL, claim_token=NULL, updated_at=datetime('now', '+9 hours')
      WHERE id=? AND claim_token=?`).bind(response.status, requestId, row.id, claimToken)));
    await db.prepare(`UPDATE lawitgo_winning_manual_runs SET status='completed', claimed_count=?, sent_count=?,
      remote_request_id=?, finished_at=datetime('now', '+9 hours') WHERE id=?`)
      .bind(claimed.length, claimed.length, requestId, runId).run();
    return { configured: true, requested: uniqueIds.length, ...staged, claimed: claimed.length, sent: claimed.length, failed: 0, requestId };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'lawitgo manual delivery failed';
    await db.batch(claimed.map((row) => db.prepare(`UPDATE lawitgo_winning_outbox SET status='failed',
      next_attempt_at=datetime('now', '+12 hours'), last_error=?, claim_token=NULL, updated_at=datetime('now', '+9 hours')
      WHERE id=? AND claim_token=?`).bind(message, row.id, claimToken)));
    await db.prepare(`UPDATE lawitgo_winning_manual_runs SET status='failed', claimed_count=?, failed_count=?, error=?,
      finished_at=datetime('now', '+9 hours') WHERE id=?`).bind(claimed.length, claimed.length, message, runId).run();
    return { configured: true, requested: uniqueIds.length, ...staged, claimed: claimed.length, sent: 0, failed: claimed.length, requestId: '' };
  }
}
