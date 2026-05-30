const KST_NOW_SQL = "datetime('now', '+9 hours')";

export type BidResult = '실패' | '낙찰' | '취소' | '취하/변경';

export interface BidAnalysisInput {
  bid_datetime: string;
  assignee_name?: string;
  branch_name?: string;
  case_number?: string;
  property_type?: string;
  suggested_bid_price?: number | null;
  actual_bid_price?: number | null;
  winning_price?: number | null;
  bid_result?: BidResult;
  client_name?: string;
  source_type: 'excel' | 'journal' | 'freelancer' | 'manual';
  source_id?: string | null;
  source_file_name?: string | null;
  upload_batch?: string | null;
  uploaded_by?: string | null;
}

export async function ensureBidAnalysisTable(db: D1Database): Promise<void> {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS bid_analysis_entries (
      id TEXT PRIMARY KEY,
      bid_datetime TEXT NOT NULL,
      assignee_name TEXT NOT NULL DEFAULT '',
      branch_name TEXT NOT NULL DEFAULT '',
      case_number TEXT NOT NULL DEFAULT '',
      property_type TEXT NOT NULL DEFAULT '',
      suggested_bid_price INTEGER,
      actual_bid_price INTEGER,
      winning_price INTEGER,
      is_won INTEGER NOT NULL DEFAULT 0,
      bid_result TEXT NOT NULL DEFAULT '실패',
      client_name TEXT NOT NULL DEFAULT '',
      source_type TEXT NOT NULL DEFAULT 'excel',
      source_id TEXT,
      dedupe_key TEXT,
      source_file_name TEXT,
      upload_batch TEXT,
      uploaded_by TEXT,
      manual_override INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', '+9 hours')),
      updated_at TEXT DEFAULT (datetime('now', '+9 hours'))
    )
  `).run();
  const columns = [
    "ALTER TABLE bid_analysis_entries ADD COLUMN bid_result TEXT NOT NULL DEFAULT '실패'",
    "ALTER TABLE bid_analysis_entries ADD COLUMN source_type TEXT NOT NULL DEFAULT 'excel'",
    'ALTER TABLE bid_analysis_entries ADD COLUMN source_id TEXT',
    'ALTER TABLE bid_analysis_entries ADD COLUMN dedupe_key TEXT',
    "ALTER TABLE bid_analysis_entries ADD COLUMN branch_name TEXT NOT NULL DEFAULT ''",
    'ALTER TABLE bid_analysis_entries ADD COLUMN manual_override INTEGER NOT NULL DEFAULT 0',
  ];
  for (const sql of columns) {
    try { await db.prepare(sql).run(); } catch { /* already exists */ }
  }
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_bid_analysis_bid_datetime ON bid_analysis_entries(bid_datetime)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_bid_analysis_case_number ON bid_analysis_entries(case_number)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_bid_analysis_branch ON bid_analysis_entries(branch_name)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_bid_analysis_assignee ON bid_analysis_entries(assignee_name)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_bid_analysis_upload_batch ON bid_analysis_entries(upload_batch)').run();
  await db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_bid_analysis_dedupe_key ON bid_analysis_entries(dedupe_key)').run();
}

export function normalizeAmount(value: unknown): number | null {
  const cleaned = String(value ?? '').replace(/[^\d.-]/g, '');
  const num = Number(cleaned);
  return Number.isFinite(num) ? Math.round(num) : null;
}

export function normalizeBidResult(value: unknown): BidResult {
  const text = String(value ?? '').trim().toLowerCase();
  if (['취하', '변경', '취하/변경'].includes(text)) return '취하/변경';
  if (['취소', 'cancel', 'cancelled'].includes(text)) return '취소';
  if (['낙찰', '성공', 'y', 'yes', 'true', '1', 'o'].includes(text)) return '낙찰';
  return '실패';
}

function compact(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, '').toLowerCase();
}

export function makeBidDedupeKey(input: Pick<BidAnalysisInput, 'bid_datetime' | 'case_number' | 'client_name' | 'assignee_name' | 'source_type' | 'source_id'>): string {
  if (input.source_type === 'freelancer' && input.source_id) return `freelancer|${input.source_id}`;
  const date = String(input.bid_datetime || '').slice(0, 10);
  const caseNo = compact(input.case_number);
  const person = compact(input.client_name) || compact(input.assignee_name);
  if (caseNo && date && person) return `${caseNo}|${date}|${person}`;
  if (caseNo && date) return `${caseNo}|${date}`;
  if (input.source_type === 'journal' && input.source_id) return `journal|${input.source_id}`;
  return `${date}|${person}|${compact(input.assignee_name)}`;
}

export async function upsertBidAnalysisEntry(db: D1Database, input: BidAnalysisInput): Promise<void> {
  await ensureBidAnalysisTable(db);
  const bidResult = normalizeBidResult(input.bid_result);
  const dedupeKey = makeBidDedupeKey(input);
  await db.prepare(`
    INSERT INTO bid_analysis_entries (
      id, bid_datetime, assignee_name, branch_name, case_number, property_type,
      suggested_bid_price, actual_bid_price, winning_price, is_won, bid_result,
      client_name, source_type, source_id, dedupe_key, source_file_name, upload_batch, uploaded_by,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${KST_NOW_SQL}, ${KST_NOW_SQL})
    ON CONFLICT(dedupe_key) DO UPDATE SET
      bid_datetime = CASE WHEN bid_analysis_entries.manual_override = 1 OR (bid_analysis_entries.source_type = 'journal' AND excluded.source_type = 'excel') THEN bid_analysis_entries.bid_datetime ELSE excluded.bid_datetime END,
      assignee_name = CASE WHEN bid_analysis_entries.manual_override = 1 OR (bid_analysis_entries.source_type = 'journal' AND excluded.source_type = 'excel') THEN bid_analysis_entries.assignee_name ELSE COALESCE(NULLIF(excluded.assignee_name, ''), bid_analysis_entries.assignee_name) END,
      branch_name = CASE WHEN bid_analysis_entries.manual_override = 1 OR (bid_analysis_entries.source_type = 'journal' AND excluded.source_type = 'excel') THEN bid_analysis_entries.branch_name ELSE COALESCE(NULLIF(excluded.branch_name, ''), bid_analysis_entries.branch_name) END,
      case_number = CASE WHEN bid_analysis_entries.manual_override = 1 OR (bid_analysis_entries.source_type = 'journal' AND excluded.source_type = 'excel') THEN bid_analysis_entries.case_number ELSE COALESCE(NULLIF(excluded.case_number, ''), bid_analysis_entries.case_number) END,
      property_type = CASE WHEN bid_analysis_entries.manual_override = 1 OR (bid_analysis_entries.source_type = 'journal' AND excluded.source_type = 'excel') THEN bid_analysis_entries.property_type ELSE COALESCE(NULLIF(excluded.property_type, ''), bid_analysis_entries.property_type) END,
      suggested_bid_price = CASE WHEN bid_analysis_entries.manual_override = 1 OR (bid_analysis_entries.source_type = 'journal' AND excluded.source_type = 'excel') THEN bid_analysis_entries.suggested_bid_price ELSE COALESCE(excluded.suggested_bid_price, bid_analysis_entries.suggested_bid_price) END,
      actual_bid_price = CASE WHEN bid_analysis_entries.manual_override = 1 OR (bid_analysis_entries.source_type = 'journal' AND excluded.source_type = 'excel') THEN bid_analysis_entries.actual_bid_price ELSE COALESCE(excluded.actual_bid_price, bid_analysis_entries.actual_bid_price) END,
      winning_price = CASE WHEN bid_analysis_entries.manual_override = 1 OR (bid_analysis_entries.source_type = 'journal' AND excluded.source_type = 'excel') THEN bid_analysis_entries.winning_price ELSE COALESCE(excluded.winning_price, bid_analysis_entries.winning_price) END,
      is_won = CASE WHEN bid_analysis_entries.manual_override = 1 OR (bid_analysis_entries.source_type = 'journal' AND excluded.source_type = 'excel') THEN bid_analysis_entries.is_won ELSE excluded.is_won END,
      bid_result = CASE WHEN bid_analysis_entries.manual_override = 1 OR (bid_analysis_entries.source_type = 'journal' AND excluded.source_type = 'excel') THEN bid_analysis_entries.bid_result ELSE excluded.bid_result END,
      client_name = CASE WHEN bid_analysis_entries.manual_override = 1 OR (bid_analysis_entries.source_type = 'journal' AND excluded.source_type = 'excel') THEN bid_analysis_entries.client_name ELSE COALESCE(NULLIF(excluded.client_name, ''), bid_analysis_entries.client_name) END,
      source_type = CASE WHEN bid_analysis_entries.source_type IN ('journal', 'freelancer') THEN bid_analysis_entries.source_type ELSE excluded.source_type END,
      source_id = COALESCE(bid_analysis_entries.source_id, excluded.source_id),
      source_file_name = COALESCE(excluded.source_file_name, bid_analysis_entries.source_file_name),
      upload_batch = COALESCE(excluded.upload_batch, bid_analysis_entries.upload_batch),
      uploaded_by = COALESCE(excluded.uploaded_by, bid_analysis_entries.uploaded_by),
      updated_at = ${KST_NOW_SQL}
  `).bind(
    crypto.randomUUID(),
    input.bid_datetime,
    input.assignee_name || '',
    input.branch_name || '',
    input.case_number || '',
    input.property_type || '',
    input.suggested_bid_price ?? null,
    input.actual_bid_price ?? null,
    input.winning_price ?? null,
    bidResult === '낙찰' ? 1 : 0,
    bidResult,
    input.client_name || '',
    input.source_type,
    input.source_id || null,
    dedupeKey,
    input.source_file_name || null,
    input.upload_batch || null,
    input.uploaded_by || null,
  ).run();
}

export async function upsertBidAnalysisFromJournal(db: D1Database, entry: {
  id: string; target_date: string; activity_type: string; activity_subtype?: string | null; data: string; user_name?: string | null; branch?: string | null;
}): Promise<void> {
  if (entry.activity_type !== '입찰') return;
  let data: any = {};
  try { data = JSON.parse(entry.data || '{}'); } catch { data = {}; }
  const bidResult = data.bidCancelled ? '취하/변경' : data.bidWon ? '낙찰' : '실패';
  await upsertBidAnalysisEntry(db, {
    bid_datetime: `${entry.target_date}${data.timeFrom ? ` ${data.timeFrom}` : ''}`,
    assignee_name: entry.user_name || '',
    branch_name: entry.branch || '',
    case_number: data.caseNo || entry.activity_subtype || '',
    property_type: data.propertyType || '',
    suggested_bid_price: normalizeAmount(data.suggestedPrice),
    actual_bid_price: normalizeAmount(data.bidPrice),
    winning_price: normalizeAmount(data.winPrice || (data.bidWon ? data.bidPrice : '')),
    bid_result: bidResult,
    client_name: data.client || data.bidder || '',
    source_type: 'journal',
    source_id: entry.id,
  });
}

export async function deleteBidAnalysisForJournal(db: D1Database, journalEntryId: string): Promise<void> {
  await ensureBidAnalysisTable(db);
  await db.prepare("DELETE FROM bid_analysis_entries WHERE source_type = 'journal' AND source_id = ?").bind(journalEntryId).run();
}

export async function syncAllJournalBidAnalysis(db: D1Database): Promise<void> {
  await ensureBidAnalysisTable(db);
  const rows = await db.prepare(`
    SELECT j.*, u.name as user_name
    FROM journal_entries j
    LEFT JOIN users u ON u.id = j.user_id
    WHERE j.activity_type = '입찰'
    ORDER BY j.target_date DESC
  `).all<any>();
  for (const row of rows.results || []) {
    await upsertBidAnalysisFromJournal(db, row);
  }
}
