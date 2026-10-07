import {
  ensureLawitgoConsultantMappingSchema,
  listActiveLawitgoConsultantMappings,
  resolveLawitgoConsultantId,
} from './lawitgo-consultant-mapping.ts';
import { winningAuctionKind, type WinningAuctionKind } from '../../shared/winning-auction.ts';

const WINNING_CUTOVER_KST = '2026-08-14 00:00:00';
const DELIVERY_HOURS_UTC = new Set([0, 3, 6, 9]); // 09, 12, 15, 18 KST
const BATCH_LIMIT = 50;
const LAWITGO_WINNING_API_URL = 'https://www.lawitgo.com/api/integrations/mydocs/winning-cases/batch';

export type WinningSourceRow = {
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
  analysis_client_name?: string | null;
  analysis_assignee_user_id?: string | null;
  analysis_assignee_name?: string | null;
  analysis_branch?: string | null;
  journal_target_date?: string | null;
  journal_user_id?: string | null;
  journal_branch?: string | null;
  schedule_target_date?: string | null;
  schedule_user_id?: string | null;
  schedule_branch?: string | null;
  legacy_bid_date?: string | null;
  legacy_user_id?: string | null;
  legacy_court?: string | null;
  legacy_case_number?: string | null;
  legacy_item_no?: string | null;
  legacy_client_name?: string | null;
  legacy_property_type?: string | null;
  override_customer_name?: string | null;
  override_auction_kind?: string | null;
  override_customer_phone?: string | null;
  override_court?: string | null;
  override_case_number?: string | null;
  override_property_type?: string | null;
  override_winning_date?: string | null;
  override_assignee_user_id?: string | null;
  override_assignee_name?: string | null;
  override_assignee_branch?: string | null;
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

export type LawitgoWinningOverrideInput = {
  auctionKind?: WinningAuctionKind;
  customerName: string;
  customerPhone: string;
  court: string;
  caseNumber: string;
  propertyType: string;
  winningDate: string;
  assigneeUserId: string;
};

export class LawitgoWinningOverrideError extends Error {
  readonly status: 400 | 404 | 409;

  constructor(message: string, status: 400 | 404 | 409 = 400) {
    super(message);
    this.name = 'LawitgoWinningOverrideError';
    this.status = status;
  }
}

export class LawitgoWinningSaleDeleteBlockedError extends Error {
  readonly status = 409 as const;

  constructor() {
    super('Lawitgo 낙찰정보가 발송 중이거나 발송 완료되어 해당 매출을 삭제할 수 없습니다.');
    this.name = 'LawitgoWinningSaleDeleteBlockedError';
  }
}

function parseObject(value: string | null): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function isPublicAuctionWinningSource(row: WinningSourceRow): boolean {
  return row.override_auction_kind === 'public'
    || winningAuctionKind(parseObject(row.schedule_data).auctionKind, row.type_detail) === 'public'
    || winningAuctionKind(parseObject(row.journal_data).auctionKind) === 'public';
}

function text(value: unknown): string {
  return String(value || '').trim();
}

function normalizedPhone(value: unknown): string {
  const digits = text(value).replace(/\D/g, '');
  return /^0\d{9,10}$/.test(digits) ? digits : '';
}

function isValidDateKey(value: unknown): boolean {
  const date = text(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function firstValidDate(values: unknown[]): string {
  for (const value of values) {
    const candidate = text(value).slice(0, 10);
    if (isValidDateKey(candidate)) return candidate;
  }
  return '';
}

function firstValidPhone(values: unknown[]): string {
  for (const value of values) {
    const candidate = normalizedPhone(value);
    if (candidate) return candidate;
  }
  return '';
}

function detailsCourt(value: string): string {
  const first = value.split(/\s*[·|]\s*/)[0]?.trim() || '';
  return /(법원|지원)$/.test(first) ? first : '';
}

function detailsCaseNumber(value: string): string {
  return value.match(/\d{4}\s*(?:타경|타인|본|하단|경매)\s*\d+(?:\(\d+\))?/u)?.[0]?.replace(/\s+/g, '') || '';
}

function detailsPropertyType(value: string): string {
  return value.match(/(?:물건\s*종류|물건\s*유형|종류)\s*[:：]\s*([^·|,\n]+)/u)?.[1]?.trim() || '';
}

function detailsDate(value: string): string {
  const match = value.match(/(20\d{2})\s*(?:[-/.]|년\s*)(\d{1,2})\s*(?:[-/.]|월\s*)(\d{1,2})(?:일)?/u);
  if (!match) return '';
  const candidate = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  return isValidDateKey(candidate) ? candidate : '';
}

function caseNumberWithItem(caseNumber: unknown, itemNo: unknown): string {
  const base = text(caseNumber);
  const item = text(itemNo).replace(/\D/g, '');
  if (!base || !item || /\(\d+\)$/.test(base)) return base;
  return `${base}(${item})`;
}

export function lawitgoWinningMissingFields(item: LawitgoWinningItem): string[] {
  const missingFields: string[] = [];
  if (!item.customerName) missingFields.push('customerName');
  if (!normalizedPhone(item.customerPhone)) missingFields.push('customerPhone');
  if (!item.court) missingFields.push('court');
  if (!item.caseNumber) missingFields.push('caseNumber');
  if (!item.propertyType) missingFields.push('propertyType');
  if (!isValidDateKey(item.winningDate)) missingFields.push('winningDate');
  if (!item.assignee.myDocsUserId) missingFields.push('assignee.myDocsUserId');
  if (!item.assignee.consultantId) missingFields.push('assignee.consultantId');
  if (!item.assignee.name) missingFields.push('assignee.name');
  return missingFields;
}

export function buildLawitgoWinningItem(row: WinningSourceRow): {
  item: LawitgoWinningItem;
  missingFields: string[];
} {
  const journal = parseObject(row.journal_data);
  const schedule = parseObject(row.schedule_data);
  const scheduleCaseNumber = caseNumberWithItem(schedule.caseNo, schedule.itemNo || schedule.item_no)
    || caseNumberWithItem(row.legacy_case_number, row.legacy_item_no);
  const item: LawitgoWinningItem = {
    externalId: row.sales_record_id,
    customerName: text(row.override_customer_name)
      || text(row.customer_name)
      || text(schedule.client) || text(schedule.bidder) || text(row.legacy_client_name)
      || text(journal.client) || text(journal.bidder) || text(row.analysis_client_name),
    customerPhone: firstValidPhone([
      row.override_customer_phone, row.customer_phone,
      schedule.clientPhone, schedule.customerPhone, schedule.phone,
      journal.clientPhone, journal.customerPhone, journal.phone,
    ]),
    // Each field falls through independently. A partially populated schedule
    // must not suppress richer journal or analysis data.
    court: text(row.override_court)
      || text(schedule.court) || text(row.legacy_court)
      || text(journal.court) || detailsCourt(row.type_detail),
    caseNumber: text(row.override_case_number)
      || scheduleCaseNumber
      || caseNumberWithItem(journal.caseNo, journal.itemNo || journal.item_no)
      || text(row.analysis_case_number) || detailsCaseNumber(row.type_detail),
    propertyType: text(row.override_property_type)
      || text(schedule.propertyType) || text(row.legacy_property_type)
      || text(journal.propertyType) || text(row.analysis_property_type)
      || detailsPropertyType(row.type_detail),
    winningDate: firstValidDate([
      row.override_winning_date, row.schedule_target_date, row.legacy_bid_date,
      row.journal_target_date, row.analysis_bid_datetime, row.winning_date,
      detailsDate(row.type_detail),
    ]),
    assignee: {
      myDocsUserId: text(row.override_assignee_user_id)
        || text(row.assignee_user_id) || text(row.schedule_user_id)
        || text(row.legacy_user_id) || text(row.journal_user_id)
        || text(row.analysis_assignee_user_id),
      consultantId: text(row.consultant_id),
      name: text(row.override_assignee_name) || text(row.assignee_name) || text(row.analysis_assignee_name),
      branch: text(row.override_assignee_branch) || text(row.branch)
        || text(row.schedule_branch) || text(row.journal_branch) || text(row.analysis_branch),
    },
  };
  return { item, missingFields: lawitgoWinningMissingFields(item) };
}

export function isLawitgoWinningDeliverySlot(date: Date): boolean {
  return date.getUTCMinutes() === 0 && DELIVERY_HOURS_UTC.has(date.getUTCHours());
}

export function lawitgoWinningSlot(date: Date): string {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 13).replace('T', ' ');
}

export async function ensureLawitgoWinningSchema(db: D1Database): Promise<void> {
  await db.batch([
    // The legacy bid source was deployed before the unified schedule. Some
    // databases never received that migration, so keep the optional fallback
    // join harmless by creating an empty compatible table when necessary.
    db.prepare(`CREATE TABLE IF NOT EXISTS freelancer_bid_entries (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, bid_date TEXT NOT NULL,
      court TEXT NOT NULL DEFAULT '', case_number TEXT NOT NULL DEFAULT '',
      item_no TEXT NOT NULL DEFAULT '', client_name TEXT NOT NULL DEFAULT '',
      bidder_name TEXT NOT NULL DEFAULT '', property_type TEXT NOT NULL DEFAULT '',
      suggested_price INTEGER, actual_bid_price INTEGER, winning_price INTEGER,
      bid_result TEXT NOT NULL DEFAULT '실패', deviation_reason TEXT NOT NULL DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', '+9 hours')),
      updated_at TEXT DEFAULT (datetime('now', '+9 hours'))
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS lawitgo_winning_overrides (
      sales_record_id TEXT PRIMARY KEY, customer_name TEXT NOT NULL, customer_phone TEXT NOT NULL,
      auction_kind TEXT NOT NULL DEFAULT 'court',
      court TEXT NOT NULL, case_number TEXT NOT NULL, property_type TEXT NOT NULL,
      winning_date TEXT NOT NULL, assignee_user_id TEXT NOT NULL, updated_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
      FOREIGN KEY (sales_record_id) REFERENCES sales_records(id) ON DELETE CASCADE,
      FOREIGN KEY (assignee_user_id) REFERENCES users(id),
      FOREIGN KEY (updated_by) REFERENCES users(id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS lawitgo_winning_outbox (
      id TEXT PRIMARY KEY, sales_record_id TEXT NOT NULL UNIQUE, payload_json TEXT NOT NULL DEFAULT '{}',
      missing_fields TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'pending',
      attempt_count INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT, claim_token TEXT,
      last_attempt_at TEXT, sent_at TEXT, response_status INTEGER, remote_request_id TEXT,
      last_error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours'))
    )`),
    db.prepare(`CREATE TRIGGER IF NOT EXISTS trg_sales_records_preserve_lawitgo_audit
      BEFORE DELETE ON sales_records
      WHEN EXISTS (
        SELECT 1 FROM lawitgo_winning_outbox
        WHERE sales_record_id = OLD.id AND status IN ('sending', 'sent')
      )
      BEGIN
        SELECT RAISE(ABORT, 'LAWITGO_WINNING_AUDIT_LOCKED');
      END`),
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
  const overrideColumns = await db.prepare('PRAGMA table_info(lawitgo_winning_overrides)').all<{ name: string }>();
  if (!(overrideColumns.results || []).some(column => column.name === 'auction_kind')) {
    try {
      await db.prepare("ALTER TABLE lawitgo_winning_overrides ADD COLUMN auction_kind TEXT NOT NULL DEFAULT 'court'").run();
    } catch (error) {
      if (!/duplicate column/i.test(String(error))) throw error;
    }
  }
}

/**
 * Protects the immutable Lawitgo delivery audit trail before an application
 * path deletes a sales record (which can cascade-delete its outbox row).
 * Unsent rows intentionally remain deletable so pending/blocked/failed data
 * can still follow the existing correction and cancellation workflows.
 */
export async function assertLawitgoWinningSaleDeletable(
  db: D1Database,
  salesRecordId: string,
): Promise<void> {
  const normalizedSalesRecordId = text(salesRecordId);
  if (!normalizedSalesRecordId) return;
  await ensureLawitgoWinningSchema(db);
  const locked = await db.prepare(`
    SELECT status
    FROM lawitgo_winning_outbox
    WHERE sales_record_id = ? AND status IN ('sending', 'sent')
    LIMIT 1
  `).bind(normalizedSalesRecordId).first<{ status: 'sending' | 'sent' }>();
  if (locked) throw new LawitgoWinningSaleDeleteBlockedError();
}

export type ValidatedLawitgoWinningOverride = LawitgoWinningOverrideInput & {
  assigneeName: string;
  assigneeBranch: string;
  consultantId: string;
};

export type LawitgoWinningOverrideContext = {
  readonly activeAssignees: ReadonlyMap<string, {
    name: string;
    branch: string;
    consultantId: string;
  }>;
};

export async function prepareLawitgoWinningOverrideContext(
  db: D1Database,
): Promise<LawitgoWinningOverrideContext> {
  await ensureLawitgoWinningSchema(db);
  const mappings = await listActiveLawitgoConsultantMappings(db);
  return {
    activeAssignees: new Map(mappings.map((mapping) => [mapping.userId, {
      name: mapping.userName,
      branch: mapping.userBranch,
      consultantId: mapping.consultantId,
    }])),
  };
}

export async function validateLawitgoWinningOverrideInput(
  db: D1Database,
  input: LawitgoWinningOverrideInput,
  context?: LawitgoWinningOverrideContext,
): Promise<ValidatedLawitgoWinningOverride> {
  const normalized: LawitgoWinningOverrideInput = {
    auctionKind: winningAuctionKind(input?.auctionKind),
    customerName: text(input?.customerName).slice(0, 200),
    customerPhone: normalizedPhone(input?.customerPhone),
    court: text(input?.court).slice(0, 200),
    caseNumber: text(input?.caseNumber).replace(/\s+/g, '').slice(0, 100),
    propertyType: text(input?.propertyType).slice(0, 100),
    winningDate: text(input?.winningDate).slice(0, 10),
    assigneeUserId: text(input?.assigneeUserId).slice(0, 200),
  };
  if (!normalized.customerName) throw new LawitgoWinningOverrideError('고객명을 입력하세요.');
  if (!normalized.customerPhone) throw new LawitgoWinningOverrideError('유효한 고객 전화번호를 입력하세요.');
  if (normalized.auctionKind === 'public') normalized.court = '';
  if (normalized.auctionKind !== 'public' && !normalized.court) throw new LawitgoWinningOverrideError('법원을 입력하세요.');
  if (!normalized.caseNumber) throw new LawitgoWinningOverrideError(normalized.auctionKind === 'public' ? '공매 물건번호를 입력하세요.' : '사건번호를 입력하세요.');
  if (!normalized.propertyType) throw new LawitgoWinningOverrideError('물건종류를 입력하세요.');
  if (!isValidDateKey(normalized.winningDate)) throw new LawitgoWinningOverrideError('유효한 낙찰일을 입력하세요.');
  if (!normalized.assigneeUserId) throw new LawitgoWinningOverrideError('담당자를 선택하세요.');

  let assignee = context?.activeAssignees.get(normalized.assigneeUserId);
  if (!context) {
    const user = await db.prepare(`
      SELECT id, name, branch FROM users
      WHERE id = ? AND approved = 1 AND role != 'resigned'
      LIMIT 1
    `).bind(normalized.assigneeUserId).first<{ id: string; name: string; branch: string }>();
    if (user && normalized.auctionKind === 'public') {
      assignee = { name: user.name, branch: user.branch, consultantId: '' };
    } else if (user) {
      const consultantId = await resolveLawitgoConsultantId(db, user.id);
      if (consultantId) assignee = { name: user.name, branch: user.branch, consultantId };
    }
  }
  if (!assignee) throw new LawitgoWinningOverrideError('활성 상태이며 Lawitgo에 연결된 담당자 계정을 선택하세요.');
  return {
    ...normalized,
    assigneeName: text(assignee.name),
    assigneeBranch: text(assignee.branch),
    consultantId: assignee.consultantId,
  };
}

async function assertLawitgoWinningOverrideTarget(db: D1Database, salesRecordId: string): Promise<void> {
  const sale = await db.prepare(`SELECT id FROM sales_records
    WHERE id = ? AND type = '낙찰' AND COALESCE(amount, 0) > 0
      AND COALESCE(direction, 'income') != 'expense' AND COALESCE(status, '') != 'refunded'
    LIMIT 1`)
    .bind(salesRecordId).first<{ id: string }>();
  if (!sale) throw new LawitgoWinningOverrideError('낙찰 매출을 찾을 수 없습니다.', 404);
  const queued = await db.prepare(`SELECT status, missing_fields FROM lawitgo_winning_outbox
    WHERE sales_record_id = ? LIMIT 1`)
    .bind(salesRecordId).first<{ status: string; missing_fields: string }>();
  if (queued?.status === 'sent') throw new LawitgoWinningOverrideError('이미 발송 완료된 내역은 변경할 수 없습니다.', 409);
  if (queued?.status === 'sending') throw new LawitgoWinningOverrideError('현재 발송 중인 내역은 변경할 수 없습니다.', 409);
  if (queued?.missing_fields === '[]') {
    throw new LawitgoWinningOverrideError('필수 정보가 이미 완성된 전송 내역은 보완할 수 없습니다.', 409);
  }
}

async function persistValidatedLawitgoWinningOverride(
  db: D1Database,
  salesRecordId: string,
  validated: ValidatedLawitgoWinningOverride,
  updatedBy: string,
): Promise<{ item: LawitgoWinningItem; missingFields: string[] }> {
  const normalizedSalesRecordId = text(salesRecordId);
  await assertLawitgoWinningOverrideTarget(db, normalizedSalesRecordId);
  await db.prepare(`
    INSERT INTO lawitgo_winning_overrides (
      sales_record_id, customer_name, customer_phone, court, case_number,
      property_type, winning_date, assignee_user_id, updated_by, auction_kind
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(sales_record_id) DO UPDATE SET
      customer_name = excluded.customer_name,
      customer_phone = excluded.customer_phone,
      court = excluded.court,
      case_number = excluded.case_number,
      property_type = excluded.property_type,
      winning_date = excluded.winning_date,
      assignee_user_id = excluded.assignee_user_id,
      updated_by = excluded.updated_by,
      auction_kind = excluded.auction_kind,
      updated_at = datetime('now', '+9 hours')
  `).bind(
    normalizedSalesRecordId,
    validated.customerName,
    validated.customerPhone,
    validated.court,
    validated.caseNumber,
    validated.propertyType,
    validated.winningDate,
    validated.assigneeUserId,
    text(updatedBy),
    validated.auctionKind || 'court',
  ).run();

  const item: LawitgoWinningItem = {
    externalId: normalizedSalesRecordId,
    customerName: validated.customerName,
    customerPhone: validated.customerPhone,
    court: validated.court,
    caseNumber: validated.caseNumber,
    propertyType: validated.propertyType,
    winningDate: validated.winningDate,
    assignee: {
      myDocsUserId: validated.assigneeUserId,
      consultantId: validated.consultantId,
      name: validated.assigneeName,
      branch: validated.assigneeBranch,
    },
  };
  return { item, missingFields: lawitgoWinningMissingFields(item) };
}

export async function upsertLawitgoWinningOverride(
  db: D1Database,
  salesRecordId: string,
  input: LawitgoWinningOverrideInput,
  updatedBy: string,
): Promise<{ item: LawitgoWinningItem; missingFields: string[] }> {
  await ensureLawitgoWinningSchema(db);
  const validated = await validateLawitgoWinningOverrideInput(db, input);
  return persistValidatedLawitgoWinningOverride(db, salesRecordId, validated, updatedBy);
}

// Bulk imports prepare one context, validate every row before inserting its
// sale, then call this function. The context removes repeated schema/backfill
// and active-assignee lookups while the target/outbox guards still run per row.
export async function upsertValidatedLawitgoWinningOverride(
  db: D1Database,
  salesRecordId: string,
  validated: ValidatedLawitgoWinningOverride,
  updatedBy: string,
  context: LawitgoWinningOverrideContext,
): Promise<{ item: LawitgoWinningItem; missingFields: string[] }> {
  const assignee = context.activeAssignees.get(validated.assigneeUserId);
  if (!assignee) throw new LawitgoWinningOverrideError('활성 상태이며 Lawitgo에 연결된 담당자 계정을 선택하세요.');
  return persistValidatedLawitgoWinningOverride(db, salesRecordId, {
    ...validated,
    assigneeName: assignee.name,
    assigneeBranch: assignee.branch,
    consultantId: assignee.consultantId,
  }, updatedBy);
}

async function sourceRows(db: D1Database): Promise<WinningSourceRow[]> {
  const result = await db.prepare(`
    SELECT sr.id AS sales_record_id, sr.user_id AS assignee_user_id,
           COALESCE(u.name, '') AS assignee_name, m.consultant_id,
           COALESCE(sr.branch, '') AS branch, COALESCE(sr.client_name, '') AS customer_name,
           COALESCE(sr.client_phone, '') AS customer_phone, COALESCE(sr.contract_date, '') AS winning_date,
           COALESCE(sr.type_detail, '') AS type_detail, j.data AS journal_data, fs.data AS schedule_data,
           ba.case_number AS analysis_case_number, ba.property_type AS analysis_property_type,
           ba.bid_datetime AS analysis_bid_datetime, ba.client_name AS analysis_client_name,
           ba.assignee_user_id AS analysis_assignee_user_id, ba.assignee_name AS analysis_assignee_name,
           ba.branch_name AS analysis_branch,
           j.target_date AS journal_target_date, j.user_id AS journal_user_id, j.branch AS journal_branch,
           fs.target_date AS schedule_target_date, fs.user_id AS schedule_user_id, fs.branch AS schedule_branch,
           fb.bid_date AS legacy_bid_date, fb.user_id AS legacy_user_id, fb.court AS legacy_court,
           fb.case_number AS legacy_case_number, fb.item_no AS legacy_item_no,
           fb.client_name AS legacy_client_name, fb.property_type AS legacy_property_type,
           o.customer_name AS override_customer_name, o.customer_phone AS override_customer_phone,
           o.auction_kind AS override_auction_kind,
           o.court AS override_court, o.case_number AS override_case_number,
           o.property_type AS override_property_type, o.winning_date AS override_winning_date,
           o.assignee_user_id AS override_assignee_user_id,
           ou.name AS override_assignee_name, ou.branch AS override_assignee_branch
    FROM sales_records sr
    LEFT JOIN users u ON u.id = sr.user_id
    LEFT JOIN lawitgo_winning_overrides o ON o.sales_record_id = sr.id
    LEFT JOIN users ou ON ou.id = o.assignee_user_id
    LEFT JOIN journal_entries j ON j.id = sr.journal_entry_id
    LEFT JOIN freelancer_auction_schedules fs
      ON fs.id = CASE
        WHEN sr.external_id LIKE 'auction-schedule:%'
          THEN substr(sr.external_id, length('auction-schedule:') + 1)
        WHEN sr.external_id LIKE 'auction_schedule:%'
          THEN substr(sr.external_id, length('auction_schedule:') + 1)
        ELSE NULL END
    LEFT JOIN freelancer_bid_entries fb
      ON fb.id = CASE WHEN sr.external_id LIKE 'freelancer-bid:%'
        THEN substr(sr.external_id, length('freelancer-bid:') + 1) ELSE NULL END
    LEFT JOIN bid_analysis_entries ba ON ba.id = COALESCE((
      SELECT b.id FROM bid_analysis_entries b
      WHERE b.bid_result = '낙찰'
        AND (
          b.assignee_user_id = sr.user_id OR (
            NULLIF(TRIM(b.assignee_user_id), '') IS NULL
            AND b.source_type IN ('manual', 'excel')
            AND REPLACE(LOWER(TRIM(COALESCE(b.assignee_name, ''))), ' ', '') = REPLACE(LOWER(TRIM(COALESCE(u.name, ''))), ' ', '')
            AND REPLACE(TRIM(COALESCE(u.name, '')), ' ', '') != ''
            AND (
              TRIM(COALESCE(b.branch_name, '')) = '' OR TRIM(COALESCE(sr.branch, '')) = ''
              OR REPLACE(TRIM(b.branch_name), ' ', '') = REPLACE(TRIM(sr.branch), ' ', '')
            )
          )
        )
        AND (
          b.source_id = sr.journal_entry_id OR b.source_id = sr.external_id OR
          b.source_id = CASE
            WHEN sr.external_id LIKE 'auction-schedule:%'
              THEN substr(sr.external_id, length('auction-schedule:') + 1)
            WHEN sr.external_id LIKE 'auction_schedule:%'
              THEN substr(sr.external_id, length('auction_schedule:') + 1)
            WHEN sr.external_id LIKE 'freelancer-bid:%'
              THEN substr(sr.external_id, length('freelancer-bid:') + 1)
            ELSE NULL END
        )
      ORDER BY b.updated_at DESC
      LIMIT 1
    ), (
      SELECT b.id FROM bid_analysis_entries b
      WHERE b.bid_result = '낙찰'
        AND (
          b.assignee_user_id = sr.user_id OR (
            NULLIF(TRIM(b.assignee_user_id), '') IS NULL
            AND b.source_type IN ('manual', 'excel')
            AND REPLACE(LOWER(TRIM(COALESCE(b.assignee_name, ''))), ' ', '') = REPLACE(LOWER(TRIM(COALESCE(u.name, ''))), ' ', '')
            AND REPLACE(TRIM(COALESCE(u.name, '')), ' ', '') != ''
            AND (
              TRIM(COALESCE(b.branch_name, '')) = '' OR TRIM(COALESCE(sr.branch, '')) = ''
              OR REPLACE(TRIM(b.branch_name), ' ', '') = REPLACE(TRIM(sr.branch), ' ', '')
            )
          )
        )
        AND substr(b.bid_datetime, 1, 10) = substr(sr.contract_date, 1, 10)
        AND REPLACE(LOWER(TRIM(b.client_name)), ' ', '') = REPLACE(LOWER(TRIM(sr.client_name)), ' ', '')
        AND REPLACE(TRIM(COALESCE(sr.client_name, '')), ' ', '') != ''
        AND (SELECT COUNT(*) FROM bid_analysis_entries bx
             WHERE bx.bid_result = '낙찰'
               AND (
                 bx.assignee_user_id = sr.user_id OR (
                   NULLIF(TRIM(bx.assignee_user_id), '') IS NULL
                   AND bx.source_type IN ('manual', 'excel')
                   AND REPLACE(LOWER(TRIM(COALESCE(bx.assignee_name, ''))), ' ', '') = REPLACE(LOWER(TRIM(COALESCE(u.name, ''))), ' ', '')
                   AND REPLACE(TRIM(COALESCE(u.name, '')), ' ', '') != ''
                   AND (
                     TRIM(COALESCE(bx.branch_name, '')) = '' OR TRIM(COALESCE(sr.branch, '')) = ''
                     OR REPLACE(TRIM(bx.branch_name), ' ', '') = REPLACE(TRIM(sr.branch), ' ', '')
                   )
                 )
               )
               AND substr(bx.bid_datetime, 1, 10) = substr(sr.contract_date, 1, 10)
               AND REPLACE(LOWER(TRIM(bx.client_name)), ' ', '') = REPLACE(LOWER(TRIM(sr.client_name)), ' ', '')) = 1
      ORDER BY b.updated_at DESC
      LIMIT 1
    ))
    LEFT JOIN lawitgo_consultant_mappings m
      ON m.user_id = COALESCE(NULLIF(o.assignee_user_id, ''), sr.user_id)
    WHERE sr.type = '낙찰' AND COALESCE(sr.amount, 0) > 0
      AND COALESCE(sr.direction, 'income') != 'expense' AND COALESCE(sr.status, '') != 'refunded'
      AND sr.created_at >= ?
    ORDER BY sr.created_at ASC
  `).bind(WINNING_CUTOVER_KST).all<WinningSourceRow>();
  return result.results || [];
}

export async function stageLawitgoWinningOutbox(db: D1Database): Promise<{ staged: number; blocked: number }> {
  await ensureLawitgoWinningSchema(db);
  await ensureLawitgoConsultantMappingSchema(db);
  // A refund, deletion, zeroing, or type correction can make a previously
  // queued sale ineligible. Remove only unclaimed rows; sent audit snapshots
  // and active sending claims are immutable.
  await db.prepare(`DELETE FROM lawitgo_winning_outbox
    WHERE status NOT IN ('sent', 'sending')
      AND NOT EXISTS (
        SELECT 1 FROM sales_records sr
        WHERE sr.id = lawitgo_winning_outbox.sales_record_id
          AND sr.type = '낙찰' AND COALESCE(sr.amount, 0) > 0
          AND COALESCE(sr.direction, 'income') != 'expense'
          AND COALESCE(sr.status, '') != 'refunded'
          AND sr.created_at >= ?
      )`).bind(WINNING_CUTOVER_KST).run();
  const source = await sourceRows(db);
  const publicRows = source.filter(isPublicAuctionWinningSource);
  if (publicRows.length > 0) {
    await db.batch(publicRows.map(row => db.prepare(`
      DELETE FROM lawitgo_winning_outbox
      WHERE sales_record_id = ? AND status NOT IN ('sent', 'sending')
    `).bind(row.sales_record_id)));
  }
  const rows = source.filter(row => !isPublicAuctionWinningSource(row));
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
        payload_json = CASE WHEN lawitgo_winning_outbox.status IN ('sent', 'sending')
                            THEN lawitgo_winning_outbox.payload_json ELSE excluded.payload_json END,
        missing_fields = CASE WHEN lawitgo_winning_outbox.status IN ('sent', 'sending')
                              THEN lawitgo_winning_outbox.missing_fields ELSE excluded.missing_fields END,
        status = CASE
          WHEN lawitgo_winning_outbox.status IN ('sent', 'sending') THEN lawitgo_winning_outbox.status
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
