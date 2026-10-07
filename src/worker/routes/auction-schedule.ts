import { Hono } from 'hono';
import { winningAuctionDetail } from '../../shared/winning-auction.ts';
import type { AuthEnv } from '../types.ts';
import { authMiddleware, requireHumanUser } from '../middleware/auth.ts';
import { getAdminVisibleBranches } from '../lib/branch-approval-overrides.ts';
import { isHeadOfficeBranch, normalizeBranchName, sameBranchName } from '../lib/branchAliases.ts';
import { sendAlimtalkByTemplate, APP_URL } from '../alimtalk.ts';
import {
  auctionScheduleBidResult,
  auctionScheduleBidResultMissingFields,
  auctionScheduleSalesExternalId,
  auctionScheduleSalesExternalIds,
  calculateAuctionScheduleWinningFee,
  canViewResignedAuctionHistory,
  canViewSuggestedBidPrice,
  getAuctionScheduleValidationError,
  isAuctionScheduleBidResultDue,
  isPublicAuctionPriceEditOpen,
  isAuctionScheduleActivityType,
  redactSuggestedBidPrice,
  sanitizeAuctionScheduleData,
} from '../../shared/auction-schedule.ts';
import { normalizeWonSalesInput } from '../../shared/freelancer-bid-sales.ts';
import { canSelectAuctionScheduleBranch, normalizeAuctionScheduleBranchFilter } from '../../shared/auction-schedule-branch.ts';
import { isValidCustomerPhone } from '../../shared/sales-customer-identity.ts';
import { linkSalesCustomerCase, resolveSalesCustomer } from '../lib/sales-customer-master.ts';
import { ensureBidAnalysisTable, normalizeAmount, upsertBidAnalysisEntry } from '../lib/bid-analysis.ts';
import { ensureAuctionScheduleTable } from '../lib/auction-schedule-schema.ts';
import { findCanonicalBidSale, type LinkedBidSale } from '../lib/performance-activity.ts';
import {
  assertLawitgoWinningSaleDeletable,
  LawitgoWinningSaleDeleteBlockedError,
} from '../lib/lawitgo-winning-delivery.ts';
import { DEFAULT_COMPANY_HOLIDAYS } from '../../shared/work-calendar.ts';
import { loadSystemHolidayDates } from '../lib/system-holidays.ts';
import { findAuctionInspectionSuggestions } from '../lib/auction-schedule-inspection-suggestions.ts';
import {
  AmbiguousLegacyAuctionLinkError,
  ensureCalendarAuctionDeletionSchema,
  loadLegacyIdentityState,
  linkedBusinessData,
} from '../lib/calendar-auction-management.ts';
import {
  acquireAuctionScheduleMutationClaim,
  releaseAuctionScheduleMutationClaim,
  type AuctionScheduleMutationSnapshot,
} from '../lib/auction-schedule-mutation-claim.ts';
import {
  canonicalAuctionBidGroupMarker,
  canonicalAuctionBidItemMarker,
  canManageAuctionBidResult,
  inspectionMaterializedBidId,
  normalizeAuctionBidIdentity,
} from '../../shared/auction-bid-result-access.ts';
import {
  canCreateAuctionSchedule,
  canManageAuctionSchedule,
  getRequiredInspectionBidDateError,
  isValidAuctionScheduleDate,
} from '../../shared/auction-schedule-write-access.ts';

const auctionSchedule = new Hono<AuthEnv>();
auctionSchedule.use('*', authMiddleware);
auctionSchedule.use('*', requireHumanUser());
const auctionResultSchemaPromises = new WeakMap<object, Promise<void>>();

const ADMIN_VIEW_ROLES = new Set(['master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst']);

function hasAlimtalkBranch(settings: string | null | undefined, branch: string | null | undefined): boolean {
  const normalizedBranch = normalizeBranchName(branch);
  if (!settings || !normalizedBranch) return false;
  return settings.split(',').some((value) => sameBranchName(value, normalizedBranch));
}

async function ensureAuctionScheduleResultSchema(db: D1Database): Promise<void> {
  const key = db as object;
  const existing = auctionResultSchemaPromises.get(key);
  if (existing) return existing;
  const promise = (async () => {
    const salesColumns = await db.prepare('PRAGMA table_info(sales_records)').all<{ name: string }>();
    const names = new Set((salesColumns.results || []).map(column => column.name));
    if (!names.has('external_id')) await db.prepare('ALTER TABLE sales_records ADD COLUMN external_id TEXT').run();
    if (!names.has('winning_price')) await db.prepare('ALTER TABLE sales_records ADD COLUMN winning_price INTEGER NOT NULL DEFAULT 0').run();
    await db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_records_external_id ON sales_records(external_id) WHERE external_id IS NOT NULL').run();
    await ensureBidAnalysisTable(db);
  })();
  auctionResultSchemaPromises.set(key, promise);
  try {
    await promise;
  } catch (error) {
    auctionResultSchemaPromises.delete(key);
    throw error;
  }
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function sanitizeClientAuctionScheduleData(value: unknown): Record<string, unknown> {
  const {
    inspectionSourceId: _inspectionSourceId,
    materializedBidGroup: _materializedBidGroup,
    materializedBidItem: _materializedBidItem,
    ...data
  } = sanitizeAuctionScheduleData(value);
  return data;
}

function normalizeAuctionKindData(
  activityType: string,
  data: Record<string, unknown>,
): Record<string, unknown> {
  if (!['입찰', '임장'].includes(activityType) || data.auctionKind !== 'public') return data;
  return { ...data, court: '', itemNo: '' };
}

async function auctionScheduleTableExists(db: D1Database, table: string): Promise<boolean> {
  const row = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .bind(table).first<{ name: string }>();
  return !!row;
}

type AuctionBusinessCommissionSnapshot = {
  id: string;
  journal_entry_id: string;
  status: string;
  win_price: string;
};

async function auctionBusinessSnapshotGate(
  db: D1Database,
  input: {
    schedule: AuctionBidResultRow;
    data: Record<string, unknown>;
    externalId: string;
    linkedSale: LinkedBidSale | null;
    linkedCommission: AuctionBusinessCommissionSnapshot | null;
    commissionKeys: string[];
    requireUnlockedLawitgo?: boolean;
  },
): Promise<{ sql: string; params: unknown[] }> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const scheduleExternalIds = auctionScheduleSalesExternalIds(input.schedule.id);
  if (input.linkedSale) {
    conditions.push(`EXISTS (
      SELECT 1 FROM sales_records current_sale
      WHERE current_sale.id = ? AND current_sale.status = ? AND current_sale.amount = ?
        AND current_sale.winning_price = ? AND COALESCE(current_sale.external_id, '') = ?
    ) AND NOT EXISTS (
      SELECT 1 FROM sales_records duplicate_schedule_sale
      WHERE duplicate_schedule_sale.external_id IN (?, ?)
        AND duplicate_schedule_sale.id != ?
    )`);
    params.push(
      input.linkedSale.id,
      input.linkedSale.status,
      input.linkedSale.amount,
      input.linkedSale.winning_price,
      input.linkedSale.external_id || '',
      ...scheduleExternalIds,
      input.linkedSale.id,
    );
  } else {
    conditions.push("NOT EXISTS (SELECT 1 FROM sales_records WHERE external_id IN (?, ?))");
    params.push(...scheduleExternalIds);
    if (await auctionScheduleTableExists(db, 'freelancer_bid_entries')) {
      const item = canonicalAuctionBidItemMarker(input.data.itemNo);
      const client = normalizeAuctionBidIdentity(input.data.client || input.data.bidder);
      const court = normalizeAuctionBidIdentity(input.data.court);
      const caseNumber = normalizeAuctionBidIdentity(input.data.caseNo);
      if (client && court && caseNumber) {
        conditions.push(`NOT EXISTS (
          SELECT 1 FROM freelancer_bid_entries legacy_bid
          JOIN sales_records legacy_sale ON legacy_sale.external_id = 'freelancer-bid:' || legacy_bid.id
          WHERE legacy_bid.user_id = ? AND legacy_bid.bid_date = ?
            AND lower(replace(COALESCE(legacy_bid.case_number, ''), ' ', '')) = ?
            AND lower(replace(COALESCE(legacy_bid.court, ''), ' ', '')) = ?
            AND replace(replace(lower(COALESCE(legacy_bid.item_no, '')), ' ', ''), '번', '') = ?
            AND lower(replace(COALESCE(NULLIF(legacy_bid.client_name, ''), legacy_bid.bidder_name, ''), ' ', '')) = ?
        )`);
        params.push(
          input.schedule.user_id,
          input.schedule.target_date,
          caseNumber,
          court,
          item,
          client,
        );
      }
    }
  }
  if (input.linkedCommission) {
    conditions.push(`EXISTS (
      SELECT 1 FROM commissions current_commission
      WHERE current_commission.id = ? AND current_commission.journal_entry_id = ?
        AND current_commission.status = ? AND COALESCE(current_commission.win_price, '') = ?
    ) AND NOT EXISTS (
      SELECT 1 FROM commissions duplicate_schedule_commission
      WHERE duplicate_schedule_commission.journal_entry_id IN (${input.commissionKeys.map(() => '?').join(', ')})
        AND duplicate_schedule_commission.id != ?
    )`);
    params.push(
      input.linkedCommission.id,
      input.linkedCommission.journal_entry_id,
      input.linkedCommission.status,
      input.linkedCommission.win_price || '',
      ...input.commissionKeys,
      input.linkedCommission.id,
    );
  } else if (input.commissionKeys.length > 0) {
    const placeholders = input.commissionKeys.map(() => '?').join(', ');
    conditions.push(`NOT EXISTS (SELECT 1 FROM commissions WHERE journal_entry_id IN (${placeholders}))`);
    params.push(...input.commissionKeys);
  }
  if (input.requireUnlockedLawitgo && await auctionScheduleTableExists(db, 'lawitgo_winning_outbox')) {
    conditions.push(`NOT EXISTS (
      SELECT 1 FROM lawitgo_winning_outbox
      WHERE sales_record_id IN (
        SELECT alias_sale.id FROM sales_records alias_sale
        WHERE alias_sale.external_id IN (?, ?)
      ) AND status IN ('sending', 'sent')
    )`);
    params.push(...scheduleExternalIds);
  }
  return {
    sql: conditions.length ? ` AND ${conditions.join(' AND ')}` : '',
    params,
  };
}

type AuctionBidResultRow = {
  id: string;
  user_id: string;
  user_name: string;
  target_date: string;
  activity_type: string;
  activity_subtype: string;
  data: string;
  branch: string;
  department: string;
  created_at: string;
  updated_at: string;
};

const BID_RESULT_EDITOR_DATA_FIELDS = [
  'auctionKind', 'caseNo', 'court', 'itemNo', 'propertyCategory', 'propertyType',
  'client', 'bidder', 'clientPhone',
  'suggestedPrice', 'bidPrice', 'winPrice',
  'bidWon', 'bidFailed', 'bidCancelled', 'bidResultCancelled',
  'bidResultCancelledAutomatically', 'bidResultCancelledAt',
] as const;

const GENERAL_EDIT_PROTECTED_DATA_FIELDS = [
  'suggestedPrice', 'actualBidPrice', 'bidPrice', 'winningPrice', 'winPrice',
  'bidWon', 'bidFailed', 'bidCancelled', 'bidResultCancelled',
  'bidResultCancelledAutomatically', 'bidResultCancelledAt',
  'clientPhone', 'inspectionSourceId', 'materializedBidGroup', 'materializedBidItem',
] as const;

function mergeGeneralScheduleEditData(
  existingData: Record<string, unknown>,
  incomingData: Record<string, unknown>,
): Record<string, unknown> {
  const merged = sanitizeAuctionScheduleData({ ...existingData, ...incomingData });
  for (const field of GENERAL_EDIT_PROTECTED_DATA_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(existingData, field)) merged[field] = existingData[field];
    else delete merged[field];
  }
  return merged;
}

function serializeBidResultEditorData(value: unknown): string {
  const source = parseJsonObject(value);
  return JSON.stringify(Object.fromEntries(
    BID_RESULT_EDITOR_DATA_FIELDS
      .filter((field) => Object.prototype.hasOwnProperty.call(source, field))
      .map((field) => [field, source[field]]),
  ));
}

function bidResultEntryDto(row: AuctionBidResultRow) {
  return {
    id: row.id,
    user_id: row.user_id,
    user_name: row.user_name || '',
    target_date: row.activity_type === '임장'
      ? String(parseJsonObject(row.data).bidDate || '')
      : row.target_date,
    activity_subtype: row.activity_subtype || '',
    data: serializeBidResultEditorData(row.data),
  };
}

function isCompanionInspection(data: Record<string, unknown>): boolean {
  return data.companion === true || data.companion === 1 || String(data.companion || '').toLowerCase() === 'true';
}

function inspectionBidValidationError(data: Record<string, unknown>): string | null {
  if (!isValidAuctionScheduleDate(data.bidDate)) return '입찰기일이 올바른 임장 일정만 결과를 입력할 수 있습니다.';
  if (isCompanionInspection(data)) return '동행 임장 일정에는 입찰 결과를 입력할 수 없습니다.';
  return getAuctionScheduleValidationError('입찰', data);
}

function sameBidIdentity(
  candidate: AuctionBidResultRow,
  ownerId: string,
  bidDate: string,
  sourceData: Record<string, unknown>,
): boolean {
  if (candidate.user_id !== ownerId || candidate.target_date !== bidDate || candidate.activity_type !== '입찰') return false;
  const candidateData = parseJsonObject(candidate.data);
  const candidateClient = normalizeAuctionBidIdentity(candidateData.client || candidateData.bidder);
  const sourceClient = normalizeAuctionBidIdentity(sourceData.client || sourceData.bidder);
  const candidateKind = candidateData.auctionKind === 'public' ? 'public' : 'auction';
  const sourceKind = sourceData.auctionKind === 'public' ? 'public' : 'auction';
  return candidateKind === sourceKind
    && normalizeAuctionBidIdentity(candidateData.court) === normalizeAuctionBidIdentity(sourceData.court)
    && normalizeAuctionBidIdentity(candidateData.caseNo) === normalizeAuctionBidIdentity(sourceData.caseNo)
    && canonicalAuctionBidItemMarker(candidateData.itemNo) === canonicalAuctionBidItemMarker(sourceData.itemNo)
    && !!candidateClient
    && !!sourceClient
    && candidateClient === sourceClient;
}

async function loadAuctionBidResultRow(db: D1Database, id: string): Promise<AuctionBidResultRow | null> {
  return db.prepare(`
    SELECT s.*, u.name AS user_name
    FROM freelancer_auction_schedules s
    JOIN users u ON u.id = s.user_id
    WHERE s.id = ?
  `).bind(id).first<AuctionBidResultRow>();
}

async function findMatchingBidForInspection(
  db: D1Database,
  inspection: AuctionBidResultRow,
  bidDate: string,
  sourceData: Record<string, unknown>,
): Promise<AuctionBidResultRow | null> {
  const rows = await db.prepare(`
    SELECT s.*, u.name AS user_name
    FROM freelancer_auction_schedules s
    JOIN users u ON u.id = s.user_id
    WHERE s.user_id = ? AND s.target_date = ? AND s.activity_type = '입찰'
    ORDER BY s.created_at, s.id
  `).bind(inspection.user_id, bidDate).all<AuctionBidResultRow>();
  const candidates = rows.results || [];
  const deterministicId = inspectionMaterializedBidId(inspection.id);
  const explicit = candidates.filter((row) => row.id === deterministicId);
  if (explicit.length === 1) {
    const explicitData = parseJsonObject(explicit[0].data);
    if (
      String(explicitData.inspectionSourceId || '').trim() !== inspection.id
      || !sameBidIdentity(explicit[0], inspection.user_id, bidDate, sourceData)
    ) {
      throw new Error('임장 원본과 기존 입찰 일정의 사건·물건·고객 정보가 달라 자동 연결할 수 없습니다. 원본을 확인해 주세요.');
    }
    return explicit[0];
  }
  if (explicit.length > 1) throw new Error('임장 일정과 명시적으로 연결된 입찰 일정이 여러 건입니다. 원본을 확인해 주세요.');

  // provenance가 없는 전환 전 direct bid만 고객까지 정확히 같은 경우 재사용한다.
  // 다른 임장에서 materialize된 행을 사건/물건번호만으로 가로채지 않는다.
  const legacy = candidates.filter((row) => {
    const candidateData = parseJsonObject(row.data);
    return !String(candidateData.inspectionSourceId || '').trim()
      && !row.id.startsWith('inspection-bid:')
      && sameBidIdentity(row, inspection.user_id, bidDate, sourceData);
  });
  if (legacy.length === 1) return legacy[0];
  if (legacy.length > 1) throw new Error('같은 고객·사건의 기존 입찰 일정이 여러 건이어서 자동 연결할 수 없습니다. 원본을 확인해 주세요.');
  return null;
}

async function materializeBidFromInspection(
  db: D1Database,
  inspection: AuctionBidResultRow,
): Promise<AuctionBidResultRow> {
  const sourceData = parseJsonObject(inspection.data);
  const bidDate = String(sourceData.bidDate || '').trim();
  const validationError = inspectionBidValidationError(sourceData);
  if (validationError) throw new Error(validationError);

  const matching = await findMatchingBidForInspection(db, inspection, bidDate, sourceData);
  if (matching) return matching;

  const id = inspectionMaterializedBidId(inspection.id);
  const canonicalGroup = canonicalAuctionBidGroupMarker(sourceData.court, sourceData.caseNo);
  const canonicalItem = canonicalAuctionBidItemMarker(sourceData.itemNo);
  const data = JSON.stringify({
    ...sanitizeAuctionScheduleData(sourceData),
    bidDate: undefined,
    companion: undefined,
    inspectionSourceId: inspection.id,
    materializedBidGroup: canonicalGroup,
    materializedBidItem: canonicalItem,
    bidWon: false,
    bidFailed: false,
    bidCancelled: false,
    bidResultCancelled: false,
    bidResultCancelledAutomatically: false,
    bidResultCancelledAt: '',
    winPrice: '',
  });
  await db.prepare(`
    INSERT OR IGNORE INTO freelancer_auction_schedules
      (id, user_id, target_date, activity_type, activity_subtype, data, branch, department)
    SELECT ?, ?, ?, '입찰', ?, ?, ?, ?
    FROM freelancer_auction_schedules source_inspection
    WHERE source_inspection.id = ?
      AND source_inspection.user_id = ?
      AND source_inspection.target_date = ?
      AND source_inspection.activity_type = ?
      AND source_inspection.activity_subtype = ?
      AND source_inspection.data = ?
      AND source_inspection.branch = ?
      AND source_inspection.department = ?
      AND source_inspection.created_at = ?
      AND source_inspection.updated_at = ?
  `).bind(
    id,
    inspection.user_id,
    bidDate,
    inspection.activity_subtype || String(sourceData.caseNo || '').slice(0, 200),
    data,
    inspection.branch || '',
    inspection.department || '',
    inspection.id,
    inspection.user_id,
    inspection.target_date,
    inspection.activity_type,
    inspection.activity_subtype,
    inspection.data,
    inspection.branch,
    inspection.department,
    inspection.created_at,
    inspection.updated_at,
  ).run();
  // INSERT가 경쟁 요청 때문에 생략됐더라도, 원자 조건을 통과해 먼저 생성된
  // 동일 입찰 행을 다시 찾아 두 요청 모두 같은 schedule_id를 사용한다.
  const resolved = await findMatchingBidForInspection(db, inspection, bidDate, sourceData);
  if (!resolved) {
    throw new Error('임장 일정과 연결된 입찰 일정을 생성하지 못했습니다.');
  }
  return resolved;
}

auctionSchedule.get('/', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const start = String(c.req.query('start') || '');
  const end = String(c.req.query('end') || '');
  const canSelectBranch = canSelectAuctionScheduleBranch({ id: user.sub, role: user.role });
  const requestedBranch = normalizeAuctionScheduleBranchFilter(c.req.query('branch'));
  if (canSelectBranch && !requestedBranch) return c.json({ error: '조회할 지사를 확인해 주세요.' }, 400);
  // 선택 권한이 없는 사용자는 query 변조 여부와 무관하게 세션의 소속 지사로 강제한다.
  const branchFilter = canSelectBranch ? requestedBranch! : (normalizeBranchName(user.branch) || user.branch || '__unassigned__');
  if (!isValidAuctionScheduleDate(start) || !isValidAuctionScheduleDate(end) || start > end) {
    return c.json({ error: '조회 시작일과 종료일을 YYYY-MM-DD 형식으로 입력해 주세요.' }, 400);
  }
  const days = Math.floor((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
  if (days > 31) return c.json({ error: '경매 스케줄은 한 번에 31일까지만 조회할 수 있습니다.' }, 400);

  await ensureAuctionScheduleTable(db);
  const holidayYears = [...new Set([start.slice(0, 4), end.slice(0, 4)])];
  const dynamicHolidays = await loadSystemHolidayDates(db, holidayYears, 'journal');
  const holidays = [...new Set([...DEFAULT_COMPANY_HOLIDAYS, ...dynamicHolidays])]
    .filter(date => date >= start && date <= end)
    .sort();
  let query = `
    SELECT s.*, u.name AS user_name, u.role AS user_role, u.position_title
    FROM freelancer_auction_schedules s
    JOIN users u ON u.id = s.user_id
    WHERE s.target_date BETWEEN ? AND ?
      AND s.activity_type IN ('입찰', '임장')
  `;
  const params: unknown[] = [start, end];

  if (branchFilter !== 'all') {
    query += ' AND s.branch = ?';
    params.push(branchFilter);
  }
  query += ' ORDER BY s.target_date, u.name, s.created_at';
  const result = await db.prepare(query).bind(...params).all<any>();

  // 전환 전 컨설턴트 일지는 삭제하지 않고, 현재 프리랜서인 사용자의 기록만
  // 경매 스케줄에서 읽기 전용으로 이어서 보여준다.
  let historyQuery = `
    SELECT 'journal:' || j.id AS id, j.id AS source_id, j.user_id,
      u.name AS user_name, u.role AS user_role, u.position_title,
      j.target_date, j.activity_type, j.activity_subtype, j.data,
      j.branch, j.department, j.created_at, j.updated_at,
      'employee_journal' AS source_type, 1 AS read_only
    FROM journal_entries j
    JOIN users u ON u.id = j.user_id
    WHERE j.target_date BETWEEN ? AND ?
      AND j.activity_type IN ('입찰', '임장')
  `;
  const historyParams: unknown[] = [start, end];
  if (canViewResignedAuctionHistory(user.role)) {
    historyQuery += " AND (COALESCE(u.login_type, 'employee') = 'freelancer' OR u.role = 'resigned')";
  } else {
    historyQuery += " AND COALESCE(u.login_type, 'employee') = 'freelancer'";
  }
  if (branchFilter !== 'all') {
    historyQuery += ' AND j.branch = ?';
    historyParams.push(branchFilter);
  }
  const historyResult = await db.prepare(historyQuery).bind(...historyParams).all<any>();
  const historyEntries = (historyResult.results || []).map(entry => ({
    ...entry,
    data: JSON.stringify(redactSuggestedBidPrice(
      entry.activity_type,
      sanitizeAuctionScheduleData(parseJsonObject(entry.data)),
      canViewSuggestedBidPrice(user.role),
    )),
  }));
  const scheduleEntries = (result.results || []).map(entry => ({
    ...entry,
    data: JSON.stringify(redactSuggestedBidPrice(
      entry.activity_type,
      parseJsonObject(entry.data),
      canViewSuggestedBidPrice(user.role) || entry.user_id === user.sub,
    )),
    source_type: 'auction_schedule',
    read_only: 0,
  }));
  const entries = [...scheduleEntries, ...historyEntries].sort((a, b) =>
    String(a.target_date).localeCompare(String(b.target_date))
      || String(a.user_name).localeCompare(String(b.user_name), 'ko')
      || String(a.created_at).localeCompare(String(b.created_at))
  );
  return c.json({ entries, holidays });
});

auctionSchedule.get('/check-case-no', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const caseNo = String(c.req.query('case_no') || '').trim();
  const court = String(c.req.query('court') || '').trim();
  if (!caseNo) return c.json({ exists: false, entries: [] });
  await ensureAuctionScheduleTable(db);
  await ensureAuctionScheduleResultSchema(db);
  let query = `
    SELECT s.id, s.user_id, u.name AS user_name, s.target_date,
      COALESCE(json_extract(s.data, '$.court'), '') AS court
    FROM freelancer_auction_schedules s
    JOIN users u ON u.id = s.user_id
    WHERE s.activity_type = '임장'
      AND COALESCE(json_extract(s.data, '$.caseNo'), '') = ?
  `;
  const params: unknown[] = [caseNo];
  if (court) {
    query += " AND COALESCE(json_extract(s.data, '$.court'), '') = ?";
    params.push(court);
  }
  if (user.role === 'admin' && !isHeadOfficeBranch(user.branch)) {
    const branches = await getAdminVisibleBranches(db, user);
    query += ` AND s.branch IN (${branches.map(() => '?').join(',')})`;
    params.push(...branches);
  } else if (!ADMIN_VIEW_ROLES.has(user.role)) {
    query += ' AND s.branch = ?';
    params.push(user.branch || '');
  }
  query += ' ORDER BY s.target_date DESC LIMIT 20';
  const result = await db.prepare(query).bind(...params).all();
  const entries = result.results || [];
  return c.json({ exists: entries.length > 0, entries });
});

auctionSchedule.get('/my-bid-result-requirements', async (c) => {
  const user = c.get('user');
  if (user.login_type !== 'freelancer') return c.json({ entries: [] });
  const db = c.env.DB;
  await ensureAuctionScheduleTable(db);
  const rows = await db.prepare(`
    SELECT s.*, u.name AS user_name, u.role AS user_role, u.position_title
    FROM freelancer_auction_schedules s
    JOIN users u ON u.id = s.user_id
    WHERE s.user_id = ? AND s.activity_type = '입찰' AND s.target_date <= date('now', '+9 hours')
    ORDER BY s.target_date, s.created_at
  `).bind(user.sub).all<any>();
  const now = new Date();
  const entries = (rows.results || []).filter((entry) => {
    if (!isAuctionScheduleBidResultDue(String(entry.target_date || ''), now)) return false;
    return auctionScheduleBidResultMissingFields(parseJsonObject(entry.data)).length > 0;
  }).map((entry) => ({
    ...entry,
    missing_fields: auctionScheduleBidResultMissingFields(parseJsonObject(entry.data)),
  }));
  return c.json({ entries });
});

auctionSchedule.get('/create-options', async (c) => {
  const user = c.get('user');
  if (user.role !== 'master') return c.json({ error: '대리 등록 담당자를 조회할 권한이 없습니다.' }, 403);
  const rows = await c.env.DB.prepare(`
    SELECT id, name, role, branch, department, position_title
    FROM users
    WHERE approved = 1
      AND role != 'resigned'
      AND COALESCE(login_type, 'employee') = 'freelancer'
    ORDER BY branch, department, name
  `).all<any>();
  return c.json({ assignees: rows.results || [] });
});

auctionSchedule.get('/inspection-suggestions', async (c) => {
  const user = c.get('user');
  if (!canCreateAuctionSchedule(user)) {
    return c.json({ error: '경매 스케줄 자동채우기 권한이 없습니다.' }, 403);
  }
  const query = String(c.req.query('q') || '').slice(0, 100);
  if (!query) return c.json({ suggestions: [] });
  const requestedOwnerId = String(c.req.query('owner_id') || '').trim();
  if (user.role !== 'master' && requestedOwnerId && requestedOwnerId !== user.sub) {
    return c.json({ error: '다른 담당자의 임장 정보를 조회할 수 없습니다.' }, 403);
  }
  const ownerId = user.role === 'master' ? requestedOwnerId : user.sub;
  if (!ownerId) return c.json({ suggestions: [] });

  await ensureAuctionScheduleTable(c.env.DB);
  const suggestions = await findAuctionInspectionSuggestions(c.env.DB, ownerId, query);
  return c.json({ suggestions });
});

auctionSchedule.post('/', async (c) => {
  const user = c.get('user');
  if (!canCreateAuctionSchedule(user)) {
    return c.json({ error: '경매 스케줄 작성 권한이 없습니다.' }, 403);
  }
  const body = await c.req.json<{
    user_id?: string;
    target_date?: string;
    activity_type?: string;
    activity_subtype?: string;
    data?: Record<string, unknown>;
  }>();
  const targetDate = String(body.target_date || '');
  const activityType = String(body.activity_type || '');
  if (!isValidAuctionScheduleDate(targetDate) || !isAuctionScheduleActivityType(activityType)) {
    return c.json({ error: '날짜와 활동유형(입찰·임장)을 확인해 주세요.' }, 400);
  }
  const rawData = normalizeAuctionKindData(activityType, sanitizeClientAuctionScheduleData(body.data));
  const data = activityType === '입찰'
    ? { ...rawData, bidWon: false, bidFailed: false, bidCancelled: false, bidResultCancelled: false, winPrice: '' }
    : rawData;
  const validationError = getRequiredInspectionBidDateError(activityType, data)
    || getAuctionScheduleValidationError(activityType, data);
  if (validationError) return c.json({ error: validationError }, 400);
  const encodedData = JSON.stringify(data);
  if (encodedData.length > 20_000) return c.json({ error: '일정 내용이 너무 깁니다.' }, 400);

  const db = c.env.DB;
  await ensureAuctionScheduleTable(db);
  const requestedOwnerId = String(body.user_id || '').trim();
  if (user.role !== 'master' && requestedOwnerId && requestedOwnerId !== user.sub) {
    return c.json({ error: '다른 담당자의 경매 일정을 등록할 수 없습니다.' }, 403);
  }
  const ownerId = user.role === 'master' ? requestedOwnerId : user.sub;
  if (!ownerId) return c.json({ error: '일정을 등록할 담당자를 선택해 주세요.' }, 400);
  const owner = await db.prepare(`
    SELECT id, branch, department
    FROM users
    WHERE id = ? AND approved = 1 AND role != 'resigned'
    LIMIT 1
  `).bind(ownerId).first<{ id: string; branch: string; department: string }>();
  if (!owner) return c.json({ error: '활성 담당자를 찾을 수 없습니다.' }, 400);
  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO freelancer_auction_schedules
      (id, user_id, target_date, activity_type, activity_subtype, data, branch, department)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    owner.id,
    targetDate,
    activityType,
    String(body.activity_subtype || '').slice(0, 200),
    encodedData,
    owner.branch || '',
    owner.department || '',
  ).run();
  return c.json({ entry: { id, user_id: owner.id, target_date: targetDate, activity_type: activityType } }, 201);
});

auctionSchedule.get('/:id/bid-result-entry', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  await ensureAuctionScheduleTable(db);
  const existing = await loadAuctionBidResultRow(db, c.req.param('id'));
  if (!existing) return c.json({ error: '경매 스케줄을 찾을 수 없습니다.' }, 404);
  if (!canManageAuctionBidResult(user, existing.user_id)) {
    return c.json({ error: '이 입찰 결과를 입력할 권한이 없습니다.' }, 403);
  }
  if (existing.activity_type === '임장') {
    const validationError = inspectionBidValidationError(parseJsonObject(existing.data));
    if (validationError) return c.json({ error: validationError }, 400);
  } else if (existing.activity_type !== '입찰') {
    return c.json({ error: '입찰 또는 입찰기일이 등록된 임장 일정만 결과를 입력할 수 있습니다.' }, 400);
  }
  return c.json({ entry: bidResultEntryDto(existing) });
});

auctionSchedule.put('/:id', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  await ensureAuctionScheduleTable(db);
  await ensureAuctionScheduleResultSchema(db);
  const id = c.req.param('id');
  const existing = await db.prepare('SELECT * FROM freelancer_auction_schedules WHERE id = ?').bind(id).first<any>();
  if (!existing) return c.json({ error: '경매 스케줄을 찾을 수 없습니다.' }, 404);
  if (!canManageAuctionSchedule(user)) {
    return c.json({ error: '경매 스케줄 수정 권한이 없습니다. (마스터·총무·총무보조·대표만 가능)' }, 403);
  }
  const existingData = parseJsonObject(existing.data);
  if (existing.activity_type === '입찰' && auctionScheduleBidResult(existingData) !== 'pending') {
    return c.json({ error: '입찰 결과가 처리된 일정은 일반 정보를 수정할 수 없습니다. 입찰 결과 전용 기능을 이용해 주세요.' }, 409);
  }
  const existingExternalId = auctionScheduleSalesExternalId(id);
  const linkedSale = existing.activity_type === '입찰'
    ? await findCanonicalBidSale(
      db, existingExternalId, existing.user_id, existing.target_date,
      String(existingData.caseNo || ''), String(existingData.itemNo || ''),
      String(existingData.client || existingData.bidder || ''),
      String(existingData.court || ''),
    )
    : null;
  if (linkedSale) {
    return c.json({ error: '입금신청이 연결된 낙찰 일정은 수정할 수 없습니다. 먼저 업무성과에서 입금신청 상태를 확인해 주세요.' }, 409);
  }

  const body = await c.req.json<{
    target_date?: string;
    activity_type?: string;
    activity_subtype?: string;
    data?: Record<string, unknown>;
  }>();
  const targetDate = body.target_date === undefined ? existing.target_date : String(body.target_date);
  const activityType = body.activity_type === undefined ? existing.activity_type : String(body.activity_type);
  if (!isValidAuctionScheduleDate(targetDate) || !isAuctionScheduleActivityType(activityType)) {
    return c.json({ error: '날짜와 활동유형(입찰·임장)을 확인해 주세요.' }, 400);
  }
  if (activityType !== existing.activity_type) {
    return c.json({ error: '기존 일정의 활동유형은 변경할 수 없습니다. 필요한 활동유형으로 새 일정을 추가해 주세요.' }, 409);
  }
  const incomingData = body.data === undefined
    ? existingData
    : mergeGeneralScheduleEditData(existingData, sanitizeClientAuctionScheduleData(body.data));
  const parsedData = normalizeAuctionKindData(activityType, incomingData);
  const data = JSON.stringify(parsedData);
  const validationError = getRequiredInspectionBidDateError(activityType, parsedData)
    || getAuctionScheduleValidationError(activityType, parsedData);
  if (validationError) return c.json({ error: validationError }, 400);
  const generalEditBusinessGate = existing.activity_type === '입찰'
    ? await auctionBusinessSnapshotGate(db, {
      schedule: existing as AuctionBidResultRow,
      data: existingData,
      externalId: existingExternalId,
      linkedSale: null,
      linkedCommission: null,
      commissionKeys: auctionScheduleSalesExternalIds(id),
    })
    : { sql: '', params: [] as unknown[] };
  const claim = await acquireAuctionScheduleMutationClaim(db, existing as AuctionScheduleMutationSnapshot, 'general_edit', user.sub);
  if (!claim) return c.json({ error: '일정이 변경되었거나 다른 처리가 진행 중입니다. 새로고침 후 다시 시도해 주세요.' }, 409);
  try {
    const updated = await db.prepare(`
      UPDATE freelancer_auction_schedules
      SET target_date = ?, activity_type = ?, activity_subtype = ?, data = ?, updated_at = datetime('now', '+9 hours')
      WHERE id = ?
        AND EXISTS (SELECT 1 FROM auction_schedule_mutation_claims WHERE schedule_id = ? AND claim_token = ?)
        ${generalEditBusinessGate.sql}
    `).bind(
      targetDate,
      activityType,
      body.activity_subtype === undefined ? existing.activity_subtype : String(body.activity_subtype).slice(0, 200),
      data,
      id,
      id,
      claim,
      ...generalEditBusinessGate.params,
    ).run();
    if (Number(updated.meta?.changes || 0) !== 1) {
      return c.json({ error: '일정이 변경되어 수정하지 못했습니다. 새로고침 후 다시 시도해 주세요.' }, 409);
    }
    return c.json({ success: true });
  } finally {
    await releaseAuctionScheduleMutationClaim(db, claim);
  }
});

auctionSchedule.put('/:id/bid-prices', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  await ensureAuctionScheduleTable(db);
  await ensureAuctionScheduleResultSchema(db);
  const requested = await loadAuctionBidResultRow(db, c.req.param('id'));
  if (!requested) return c.json({ error: '경매 스케줄을 찾을 수 없습니다.' }, 404);
  if (!canManageAuctionBidResult(user, requested.user_id)) return c.json({ error: '이 입찰가를 작성할 권한이 없습니다.' }, 403);
  const body = await c.req.json<{ suggested_price?: number; actual_bid_price?: number; winning_price?: number }>();
  const suggestedPrice = normalizeAmount(body.suggested_price);
  const actualBidPrice = normalizeAmount(body.actual_bid_price);
  const winningPrice = normalizeAmount(body.winning_price);
  if (!suggestedPrice && !actualBidPrice && !winningPrice) {
    return c.json({ error: '제안입찰가·작성입찰가·최종 낙찰가 중 하나 이상 입력해 주세요.' }, 400);
  }
  const claimTokens: string[] = [];
  const requestedClaim = await acquireAuctionScheduleMutationClaim(db, requested, 'bid_prices_source', user.sub);
  if (!requestedClaim) return c.json({ error: '일정이 변경되었거나 다른 처리가 진행 중입니다. 새로고침 후 다시 시도해 주세요.' }, 409);
  claimTokens.push(requestedClaim);
  try {
  let existing = requested;
  if (requested.activity_type === '임장') {
    try {
      existing = await materializeBidFromInspection(db, requested);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : '임장 일정을 확인해 주세요.' }, 400);
    }
  } else if (requested.activity_type !== '입찰') {
    return c.json({ error: '입찰 또는 입찰기일이 등록된 임장 일정만 입찰가를 작성할 수 있습니다.' }, 400);
  }
  const id = existing.id;
  let mutationClaim = requestedClaim;
  if (id !== requested.id) {
    const materializedClaim = await acquireAuctionScheduleMutationClaim(db, existing, 'bid_prices_target', user.sub);
    if (!materializedClaim) return c.json({ error: '연결된 입찰 일정이 변경되었거나 다른 처리가 진행 중입니다.' }, 409);
    claimTokens.push(materializedClaim);
    mutationClaim = materializedClaim;
  }
  const data = parseJsonObject(existing.data);
  const externalId = auctionScheduleSalesExternalId(id);
  const linkedSale = await findCanonicalBidSale(
    db, externalId, existing.user_id, existing.target_date,
    String(data.caseNo || ''), String(data.itemNo || ''),
    String(data.client || data.bidder || ''),
    String(data.court || ''),
  );
  const isPublicAuction = data.auctionKind === 'public';
  if (isPublicAuction && !isPublicAuctionPriceEditOpen(data, existing.target_date)) {
    return c.json({ error: '공매 입찰가와 낙찰가는 입찰기일부터 7일 이내에만 수정할 수 있습니다.' }, 409);
  }
  if (linkedSale && (!isPublicAuction || linkedSale.source !== 'schedule')) {
    return c.json({ error: '입금신청이 연결된 낙찰 건의 입찰가는 변경할 수 없습니다.' }, 409);
  }
  if (linkedSale && !winningPrice) {
    return c.json({ error: '낙찰 처리된 공매 일정은 최종 낙찰가를 입력해 주세요.' }, 400);
  }
  const commissionKeys = Array.from(new Set([
    ...auctionScheduleSalesExternalIds(id),
    linkedSale?.external_id,
  ].filter((value): value is string => !!value)));
  const commissionRows = linkedSale && commissionKeys.length > 0
    ? await db.prepare(`
      SELECT id, journal_entry_id, status, win_price FROM commissions
      WHERE journal_entry_id IN (${commissionKeys.map(() => '?').join(', ')})
    `).bind(...commissionKeys).all<AuctionBusinessCommissionSnapshot>()
    : { results: [] as AuctionBusinessCommissionSnapshot[] };
  if ((commissionRows.results || []).length > 1) {
    return c.json({ error: '연결된 수수료 항목이 여러 건이어서 입찰가를 수정할 수 없습니다.' }, 409);
  }
  const linkedCommission = (commissionRows.results || [])[0] || null;

  const bidPriceBusinessGate = await auctionBusinessSnapshotGate(db, {
    schedule: existing,
    data,
    externalId,
    linkedSale,
    linkedCommission,
    commissionKeys,
    requireUnlockedLawitgo: !!linkedSale,
  });
  const nextData = {
    ...data,
    suggestedPrice: suggestedPrice ? String(suggestedPrice) : '',
    bidPrice: actualBidPrice ? String(actualBidPrice) : '',
    winPrice: winningPrice ? String(winningPrice) : '',
  };
  const encodedNextData = JSON.stringify(nextData);
  const statements = [db.prepare(`
      UPDATE freelancer_auction_schedules SET data = ?, updated_at = datetime('now', '+9 hours')
      WHERE id = ?
        AND EXISTS (SELECT 1 FROM auction_schedule_mutation_claims WHERE schedule_id = ? AND claim_token = ?)
        ${bidPriceBusinessGate.sql}
    `).bind(encodedNextData, id, id, mutationClaim, ...bidPriceBusinessGate.params)];
  if (linkedSale) {
    const updatedFee = calculateAuctionScheduleWinningFee(winningPrice);
    const auditId = crypto.randomUUID();
    statements.push(db.prepare(`
      INSERT INTO accounting_activity_logs (
        id, actor_id, actor_name, actor_role, action, target_type, target_id,
        target_label, diff_summary, before_snapshot, after_snapshot, source_page, created_at
      )
      SELECT ?, ?, ?, ?, 'update', 'sales_record', ?, ?, ?, ?, ?, 'auction_schedule', datetime('now', '+9 hours')
      WHERE EXISTS (
        SELECT 1 FROM freelancer_auction_schedules current_schedule
        WHERE current_schedule.id = ? AND current_schedule.data = ?
          AND EXISTS (SELECT 1 FROM auction_schedule_mutation_claims WHERE schedule_id = ? AND claim_token = ?)
      )
    `).bind(
      auditId, user.sub, user.name || '', user.role, linkedSale.id,
      `[${existing.user_name || ''}] 공매 낙찰 금액 수정`,
      `최종 낙찰가 ${linkedSale.winning_price} → ${winningPrice}, 수수료 ${linkedSale.amount} → ${updatedFee}`,
      JSON.stringify(linkedSale),
      JSON.stringify({ ...linkedSale, winning_price: winningPrice, amount: updatedFee }),
      id, encodedNextData, id, mutationClaim,
    ));
    statements.push(db.prepare(`
      UPDATE sales_records SET winning_price = ?, amount = ?
      WHERE id = ? AND EXISTS (SELECT 1 FROM accounting_activity_logs WHERE id = ?)
    `).bind(winningPrice, updatedFee, linkedSale.id, auditId));
    if (linkedCommission) {
      statements.push(db.prepare(`
        UPDATE commissions SET win_price = ?
        WHERE id = ? AND EXISTS (SELECT 1 FROM accounting_activity_logs WHERE id = ?)
      `).bind(String(updatedFee), linkedCommission.id, auditId));
    }
  }
  const batchResults = await db.batch(statements);
  if (Number((batchResults[0] as { meta?: { changes?: number } })?.meta?.changes || 0) !== 1) {
    return c.json({ error: '일정이 변경되어 입찰가를 저장하지 못했습니다.' }, 409);
  }
  if (linkedSale && batchResults.slice(1).some(result => Number((result as { meta?: { changes?: number } })?.meta?.changes || 0) !== 1)) {
    return c.json({ error: '연결된 입금신청 또는 수수료 정보가 변경되어 입찰가 수정을 중단했습니다.' }, 409);
  }

  if (data.bidFailed || data.bidWon) {
    await db.prepare("DELETE FROM bid_analysis_entries WHERE source_type = 'freelancer' AND source_id = ?").bind(externalId).run();
    await upsertBidAnalysisEntry(db, {
      bid_datetime: existing.target_date,
      assignee_user_id: existing.user_id,
      assignee_name: existing.user_name || '',
      branch_name: existing.branch || '',
      case_number: String(data.caseNo || ''),
      property_type: String(data.propertyType || ''),
      suggested_bid_price: suggestedPrice,
      actual_bid_price: actualBidPrice,
      winning_price: winningPrice,
      bid_result: data.bidWon ? '낙찰' : '실패',
      client_name: String(data.client || data.bidder || ''),
      source_type: 'freelancer',
      source_id: externalId,
      uploaded_by: existing.user_id,
    });
  }
  return c.json({ success: true, schedule_id: id, missing_fields: auctionScheduleBidResultMissingFields(nextData) });
  } finally {
    await Promise.all(claimTokens.map(token => releaseAuctionScheduleMutationClaim(db, token)));
  }
});

auctionSchedule.post('/:id/bid-result', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  await ensureAuctionScheduleTable(db);
  await ensureAuctionScheduleResultSchema(db);
  await ensureCalendarAuctionDeletionSchema(db);
  const requested = await loadAuctionBidResultRow(db, c.req.param('id'));
  if (!requested) return c.json({ error: '경매 스케줄을 찾을 수 없습니다.' }, 404);
  if (!canManageAuctionBidResult(user, requested.user_id)) {
    return c.json({ error: '이 입찰 결과를 처리할 권한이 없습니다.' }, 403);
  }
  const body = await c.req.json<{
    result?: 'won' | 'failed' | 'withdrawn' | 'cancelled' | 'pending';
    suggested_price?: number;
    actual_bid_price?: number;
    winning_price?: number;
    client_phone?: string;
  }>();
  const result = String(body.result || '');
  if (!['won', 'failed', 'withdrawn', 'cancelled', 'pending'].includes(result)) return c.json({ error: '입찰 결과를 확인해 주세요.' }, 400);
  if (result === 'won' || result === 'failed') {
    const suggestedPrice = normalizeAmount(body.suggested_price);
    const actualBidPrice = normalizeAmount(body.actual_bid_price);
    const winningPrice = normalizeAmount(body.winning_price);
    if (!suggestedPrice || !actualBidPrice || !winningPrice) {
      return c.json({ error: '제안입찰가·작성입찰가·최종 낙찰가를 모두 입력해 주세요.' }, 400);
    }
  }

  const claimTokens: string[] = [];
  const requestedClaim = await acquireAuctionScheduleMutationClaim(db, requested, 'bid_result_source', user.sub);
  if (!requestedClaim) {
    return c.json({ error: '일정이 변경되었거나 다른 처리가 진행 중입니다. 새로고침 후 다시 시도해 주세요.' }, 409);
  }
  claimTokens.push(requestedClaim);
  try {
  let existing = requested;
  if (requested.activity_type === '임장') {
    try {
      existing = await materializeBidFromInspection(db, requested);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : '임장 일정을 확인해 주세요.' }, 400);
    }
  } else if (requested.activity_type !== '입찰') {
    return c.json({ error: '입찰 또는 입찰기일이 등록된 임장 일정만 결과를 처리할 수 있습니다.' }, 400);
  }
  const id = existing.id;
  let mutationClaim = requestedClaim;
  if (id !== requested.id) {
    const materializedClaim = await acquireAuctionScheduleMutationClaim(db, existing, 'bid_result_target', user.sub);
    if (!materializedClaim) {
      return c.json({ error: '연결된 입찰 일정이 변경되었거나 다른 처리가 진행 중입니다.' }, 409);
    }
    claimTokens.push(materializedClaim);
    mutationClaim = materializedClaim;
  }

  const data = parseJsonObject(existing.data);
  const clientName = String(data.client || data.bidder || '');
  const depositorName = String(data.bidder || data.client || '');
  const externalId = auctionScheduleSalesExternalId(id);
  const linkedSale = await findCanonicalBidSale(
    db,
    externalId,
    existing.user_id,
    existing.target_date,
    String(data.caseNo || ''),
    String(data.itemNo || ''),
    String(data.client || data.bidder || ''),
    String(data.court || ''),
  );
  const linkedCommissionKeys = Array.from(new Set([
    ...auctionScheduleSalesExternalIds(id),
    linkedSale?.external_id,
  ].filter((value): value is string => !!value)));
  const linkedCommissionPlaceholders = linkedCommissionKeys.map(() => '?').join(', ');
  const linkedCommissionRows = await db.prepare(`
    SELECT id, journal_entry_id, status, win_price FROM commissions
    WHERE journal_entry_id IN (${linkedCommissionPlaceholders})
    ORDER BY CASE WHEN journal_entry_id = ? THEN 0 ELSE 1 END
  `).bind(...linkedCommissionKeys, externalId)
    .all<AuctionBusinessCommissionSnapshot>();
  const linkedCommissions = linkedCommissionRows.results || [];
  if (linkedCommissions.length > 1) {
    return c.json({ error: '동일 일정에 수수료 항목이 여러 건 연결되어 있어 결과를 변경할 수 없습니다. 총무에게 기존 연결 정리를 요청해 주세요.' }, 409);
  }
  const linkedCommission = linkedCommissions[0] || null;
  const businessGate = await auctionBusinessSnapshotGate(db, {
    schedule: existing,
    data,
    externalId,
    linkedSale,
    linkedCommission,
    commissionKeys: linkedCommissionKeys,
    requireUnlockedLawitgo: result === 'pending',
  });

  if (result === 'won' || result === 'failed') {
    const suggestedPrice = normalizeAmount(body.suggested_price);
    const actualBidPrice = normalizeAmount(body.actual_bid_price);
    const winningPrice = normalizeAmount(body.winning_price);
    if (!suggestedPrice || !actualBidPrice || !winningPrice) {
      return c.json({ error: '제안입찰가·작성입찰가·최종 낙찰가를 모두 입력해 주세요.' }, 400);
    }
    if (result === 'failed') {
      if (linkedSale) return c.json({ error: '입금신청이 연결된 낙찰 건은 실패로 변경할 수 없습니다.' }, 409);
      if (linkedCommission?.status === 'completed') return c.json({ error: '이미 완료된 수수료가 연결되어 있어 실패로 변경할 수 없습니다.' }, 409);
      const nextData = JSON.stringify({
        ...data,
        suggestedPrice: String(suggestedPrice),
        bidPrice: String(actualBidPrice),
        winPrice: String(winningPrice),
        bidWon: false,
        bidFailed: true,
        bidCancelled: false,
        bidResultCancelled: false,
        bidResultCancelledAutomatically: false,
        bidResultCancelledAt: '',
      });
      const updated = await db.prepare(`
        UPDATE freelancer_auction_schedules SET data = ?, updated_at = datetime('now', '+9 hours')
        WHERE id = ?
          AND EXISTS (SELECT 1 FROM auction_schedule_mutation_claims WHERE schedule_id = ? AND claim_token = ?)
          ${businessGate.sql}
      `).bind(nextData, id, id, mutationClaim, ...businessGate.params).run();
      if (Number(updated.meta?.changes || 0) !== 1) {
        return c.json({ error: '일정이 변경되어 입찰 결과를 저장하지 못했습니다.' }, 409);
      }
      await db.prepare("DELETE FROM bid_analysis_entries WHERE source_type = 'freelancer' AND source_id = ?").bind(externalId).run();
      await upsertBidAnalysisEntry(db, {
        bid_datetime: existing.target_date,
        assignee_user_id: existing.user_id,
        assignee_name: existing.user_name || '',
        branch_name: existing.branch || '',
        case_number: String(data.caseNo || ''),
        property_type: String(data.propertyType || ''),
        suggested_bid_price: suggestedPrice,
        actual_bid_price: actualBidPrice,
        winning_price: winningPrice,
        bid_result: '실패',
        client_name: clientName,
        source_type: 'freelancer',
        source_id: externalId,
        uploaded_by: existing.user_id,
      });
      return c.json({ success: true, schedule_id: id, sales_record_id: null, sales_status: null });
    }
    const normalized = normalizeWonSalesInput({
      actual_bid_price: winningPrice,
      sales_amount: calculateAuctionScheduleWinningFee(winningPrice),
      depositor_name: depositorName,
      payment_type: '이체',
    });
    if (!normalized) return c.json({ error: '고객명과 최종 낙찰가를 확인해 주세요.' }, 400);
    const submittedPhone = String(body.client_phone || data.clientPhone || '').trim();
    const clientPhone = isValidCustomerPhone(submittedPhone) ? submittedPhone : '';
    let customer: { id: string; name: string; phone: string } | null = null;
    if (clientPhone) {
      try {
        customer = await resolveSalesCustomer(db, {
          ownerId: existing.user_id,
          name: clientName,
          phone: clientPhone,
        });
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : '고객 정보를 확인해 주세요.' }, 400);
      }
    }
    if (linkedSale && (
      Number(linkedSale.amount) !== normalized.sales_amount
      || Number(linkedSale.winning_price) !== normalized.winning_price
    )) return c.json({ error: '이미 다른 금액의 입금신청이 연결되어 있습니다.' }, 409);
    if (linkedCommission && Number(String(linkedCommission.win_price || '').replace(/[^0-9]/g, '')) !== normalized.sales_amount) {
      return c.json({ error: '이미 다른 금액의 수수료 항목이 연결되어 있습니다.' }, 409);
    }

    const nextData = JSON.stringify({
      ...data,
      suggestedPrice: String(suggestedPrice),
      bidWon: true,
      bidFailed: false,
      bidCancelled: false,
      bidResultCancelled: false,
      bidResultCancelledAutomatically: false,
      bidResultCancelledAt: '',
      bidPrice: String(actualBidPrice),
      winPrice: String(winningPrice),
      clientPhone,
    });
    const salesId = linkedSale?.id || crypto.randomUUID();
    const operationAuditId = crypto.randomUUID();
    const statements = [
      db.prepare(`
        UPDATE freelancer_auction_schedules SET data = ?, updated_at = datetime('now', '+9 hours')
        WHERE id = ?
          AND EXISTS (SELECT 1 FROM auction_schedule_mutation_claims WHERE schedule_id = ? AND claim_token = ?)
          ${businessGate.sql}
      `).bind(nextData, id, id, mutationClaim, ...businessGate.params),
      db.prepare(`
        INSERT INTO accounting_activity_logs (
          id, actor_id, actor_name, actor_role, action, target_type, target_id,
          target_label, diff_summary, before_snapshot, after_snapshot, source_page, created_at
        )
        SELECT ?, ?, ?, ?, 'update', 'auction_schedule', ?, ?, ?, ?, ?, 'auction_schedule', datetime('now', '+9 hours')
        WHERE EXISTS (
          SELECT 1 FROM freelancer_auction_schedules current_schedule
          WHERE current_schedule.id = ? AND current_schedule.data = ?
            AND EXISTS (SELECT 1 FROM auction_schedule_mutation_claims WHERE schedule_id = ? AND claim_token = ?)
        )
          ${businessGate.sql}
      `).bind(
        operationAuditId, user.sub, user.name || '', user.role, id,
        `auction_schedule:${id}`, '입찰 결과 낙찰 처리', existing.data, nextData,
        id, nextData, id, mutationClaim, ...businessGate.params,
      ),
    ];
    if (!linkedSale) {
      statements.push(db.prepare(`
        INSERT OR IGNORE INTO sales_records (
          id, user_id, type, type_detail, client_name, depositor_name, depositor_different,
          amount, contract_date, status, direction, branch, department, payment_type,
          winning_price, client_phone, customer_id, memo, external_id
        )
        SELECT ?, ?, '낙찰', ?, ?, ?, ?, ?, ?, 'pending', 'income', ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM accounting_activity_logs WHERE id = ?)
      `).bind(
        salesId,
        existing.user_id,
        winningAuctionDetail({ auctionKind: data.auctionKind, court: data.court,
          caseNumber: data.caseNo, propertyType: data.propertyType }, data.itemNo ? `${data.itemNo}번` : ''),
        clientName,
        normalized.depositor_name,
        normalized.depositor_name !== clientName ? 1 : 0,
        normalized.sales_amount,
        existing.target_date,
        existing.branch || '',
        existing.department || '',
        normalized.payment_type,
        normalized.winning_price,
        clientPhone,
        customer?.id || null,
        `${data.auctionKind === 'public' ? '공매' : '경매'} 스케줄 낙찰 자동 입금신청`,
        externalId,
        operationAuditId,
      ));
    } else if (customer) {
      statements.push(db.prepare(`
        UPDATE sales_records SET client_phone = ?, customer_id = ? WHERE id = ?
          AND EXISTS (SELECT 1 FROM accounting_activity_logs WHERE id = ?)
      `).bind(clientPhone, customer.id, linkedSale.id, operationAuditId));
    }
    if (!linkedCommission) {
      statements.push(db.prepare(`
        INSERT INTO commissions (id, journal_entry_id, user_id, user_name, client_name, case_no, win_price)
        SELECT ?, ?, ?, ?, ?, ?, ?
        WHERE NOT EXISTS (SELECT 1 FROM commissions WHERE journal_entry_id = ?)
          AND EXISTS (SELECT 1 FROM accounting_activity_logs WHERE id = ?)
      `).bind(
        crypto.randomUUID(), externalId, existing.user_id, existing.user_name || '',
        clientName, String(data.caseNo || ''),
        String(normalized.sales_amount), externalId, operationAuditId,
      ));
    }
    const batchResults = await db.batch(statements);
    if (Number((batchResults[0] as { meta?: { changes?: number } })?.meta?.changes || 0) !== 1) {
      return c.json({ error: '일정이 변경되어 낙찰 결과를 저장하지 못했습니다.' }, 409);
    }
    if (Number((batchResults[1] as { meta?: { changes?: number } })?.meta?.changes || 0) !== 1) {
      return c.json({ error: '연결된 입금신청 또는 수수료 정보가 변경되어 낙찰 결과를 저장하지 못했습니다.' }, 409);
    }
    if (customer) {
      await linkSalesCustomerCase(db, customer.id, {
        court: String(data.court || ''),
        caseNumber: String(data.caseNo || ''),
        itemNumber: String(data.itemNo || ''),
        status: '낙찰',
      });
    }
    const savedSale = await db.prepare(`
      SELECT id, status, amount, winning_price, external_id, client_phone
      FROM sales_records WHERE id = ?
    `).bind(salesId).first<Omit<LinkedBidSale, 'source'> & { client_phone?: string }>();
    if (!savedSale) return c.json({ error: '낙찰 입금신청을 생성하지 못했습니다. 다시 시도해 주세요.' }, 409);
    await upsertBidAnalysisEntry(db, {
      bid_datetime: existing.target_date,
      assignee_user_id: existing.user_id,
      assignee_name: existing.user_name || '',
      branch_name: existing.branch || '',
      case_number: String(data.caseNo || ''),
      property_type: String(data.propertyType || ''),
      suggested_bid_price: suggestedPrice,
      actual_bid_price: actualBidPrice,
      winning_price: winningPrice,
      bid_result: '낙찰',
      client_name: clientName,
      source_type: 'freelancer',
      source_id: externalId,
      uploaded_by: existing.user_id,
    });
    if (!linkedSale && existing.branch) {
      const accountants = await db.prepare(
        "SELECT phone, alimtalk_branches FROM users WHERE role IN ('accountant', 'accountant_asst') AND approved = 1 AND phone != ''"
      ).all<{ phone: string; alimtalk_branches: string }>();
      const phones = (accountants.results || [])
        .filter((row) => hasAlimtalkBranch(row.alimtalk_branches, existing.branch))
        .map((row) => row.phone)
        .filter(Boolean);
      if (phones.length > 0) {
        c.executionCtx.waitUntil(sendAlimtalkByTemplate(
          c.env as unknown as Record<string, unknown>, 'DEPOSIT_CLAIM',
          {
            claimer_name: existing.user_name || '',
            depositor: normalized.depositor_name,
            amount: normalized.sales_amount.toLocaleString('ko-KR'),
            deposit_date: existing.target_date,
            branch: existing.branch,
            link: `${APP_URL}/sales`,
          },
          phones,
        ).catch(() => {}));
      }
    }
    return c.json({
      success: true,
      schedule_id: id,
      sales_record_id: savedSale.id,
      sales_status: savedSale.status,
      phone_required: !isValidCustomerPhone(savedSale.client_phone),
    });
  }

  if ((result === 'withdrawn' || result === 'cancelled') && linkedSale) {
    return c.json({ error: '입금신청이 연결된 낙찰 건은 취소 또는 취하/변경으로 바꿀 수 없습니다. 업무성과의 환불·취소 절차를 이용하세요.' }, 409);
  }
  if (result !== 'won' && linkedCommission?.status === 'completed') {
    return c.json({ error: '이미 완료된 수수료가 연결되어 있어 입찰 결과를 취소할 수 없습니다.' }, 409);
  }
  if (result === 'pending' && linkedSale && linkedSale.status !== 'pending') {
    return c.json({ error: '이미 확정 처리된 입금 건은 낙찰을 취소할 수 없습니다.' }, 409);
  }
  if (result === 'pending' && linkedSale?.source === 'legacy') {
    return c.json({ error: '기존 입찰 내역에 연결된 입금신청은 경매 스케줄에서 취소할 수 없습니다. 업무성과에서 확인해 주세요.' }, 409);
  }
  if (result === 'pending' && linkedSale?.source === 'schedule') {
    try {
      await assertLawitgoWinningSaleDeletable(db, linkedSale.id);
    } catch (error) {
      if (error instanceof LawitgoWinningSaleDeleteBlockedError) {
        return c.json({ error: error.message }, error.status);
      }
      throw error;
    }
  }

  const nextData = JSON.stringify({
    ...data,
    bidWon: false,
    bidFailed: false,
    bidCancelled: result === 'withdrawn',
    bidResultCancelled: result === 'cancelled',
    bidResultCancelledAutomatically: false,
    bidResultCancelledAt: result === 'cancelled' ? new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19) : '',
    ...(result === 'pending' ? { winPrice: '' } : {}),
  });
  const pendingRollback = result === 'pending' && linkedSale?.source === 'schedule';
  const rollbackAuditId = pendingRollback ? crypto.randomUUID() : '';
  const statements = [
    db.prepare(`
      UPDATE freelancer_auction_schedules SET data = ?, updated_at = datetime('now', '+9 hours')
      WHERE id = ?
        AND EXISTS (SELECT 1 FROM auction_schedule_mutation_claims WHERE schedule_id = ? AND claim_token = ?)
        ${businessGate.sql}
    `).bind(nextData, id, id, mutationClaim, ...businessGate.params),
  ];
  if (pendingRollback && linkedSale) {
    statements.push(db.prepare(`
      INSERT INTO accounting_activity_logs (
        id, actor_id, actor_name, actor_role, action, target_type, target_id,
        target_label, diff_summary, before_snapshot, source_page, created_at
      )
      SELECT ?, ?, ?, ?, 'delete', 'sales_record', ?, ?, ?, ?, 'auction_schedule', datetime('now', '+9 hours')
      WHERE EXISTS (
        SELECT 1 FROM freelancer_auction_schedules current_schedule
        WHERE current_schedule.id = ? AND current_schedule.data = ?
          AND EXISTS (SELECT 1 FROM auction_schedule_mutation_claims WHERE schedule_id = ? AND claim_token = ?)
      )
        ${businessGate.sql}
    `).bind(
      rollbackAuditId, user.sub, user.name || '', user.role, linkedSale.id,
      `[${existing.user_name || ''}] 경매 스케줄 낙찰 입금신청`,
      '경매 스케줄 낙찰 취소로 대기 중 입금신청 삭제',
      JSON.stringify(linkedSale),
      id, nextData, id, mutationClaim, ...businessGate.params,
    ));
    statements.push(db.prepare(`
      DELETE FROM commissions WHERE journal_entry_id = ? AND status = 'pending'
        AND EXISTS (SELECT 1 FROM accounting_activity_logs WHERE id = ?)
    `).bind(linkedSale.external_id, rollbackAuditId));
    statements.push(db.prepare(`
      DELETE FROM sales_records WHERE id = ? AND status = 'pending'
        AND EXISTS (SELECT 1 FROM accounting_activity_logs WHERE id = ?)
    `).bind(linkedSale.id, rollbackAuditId));
  } else {
    statements.push(db.prepare(`
      DELETE FROM commissions WHERE journal_entry_id = ? AND status = 'pending'
        AND EXISTS (
          SELECT 1 FROM freelancer_auction_schedules current_schedule
          WHERE current_schedule.id = ? AND current_schedule.data = ?
            AND EXISTS (SELECT 1 FROM auction_schedule_mutation_claims WHERE schedule_id = ? AND claim_token = ?)
        )
        ${businessGate.sql}
    `).bind(linkedCommission?.journal_entry_id || externalId, id, nextData, id, mutationClaim, ...businessGate.params));
  }
  const batchResults = await db.batch(statements);
  if (Number((batchResults[0] as { meta?: { changes?: number } })?.meta?.changes || 0) !== 1) {
    return c.json({ error: '일정이 변경되어 입찰 결과를 저장하지 못했습니다.' }, 409);
  }
  if (pendingRollback && (
    Number((batchResults[1] as { meta?: { changes?: number } })?.meta?.changes || 0) !== 1
    || Number((batchResults[3] as { meta?: { changes?: number } })?.meta?.changes || 0) !== 1
  )) {
    return c.json({ error: '입금신청·수수료 또는 Lawitgo 상태가 변경되어 낙찰 취소를 중단했습니다.' }, 409);
  }
  await db.prepare("DELETE FROM bid_analysis_entries WHERE source_type = 'freelancer' AND source_id = ?").bind(externalId).run();
  if (result === 'withdrawn' || result === 'cancelled') {
    await upsertBidAnalysisEntry(db, {
      bid_datetime: existing.target_date,
      assignee_user_id: existing.user_id,
      assignee_name: existing.user_name || '',
      branch_name: existing.branch || '',
      case_number: String(data.caseNo || ''),
      property_type: String(data.propertyType || ''),
      suggested_bid_price: normalizeAmount(data.suggestedPrice),
      actual_bid_price: null,
      winning_price: null,
      bid_result: result === 'withdrawn' ? '취하/변경' : '취소',
      client_name: clientName,
      source_type: 'freelancer',
      source_id: externalId,
      uploaded_by: existing.user_id,
    });
  }
  return c.json({ success: true, schedule_id: id, sales_record_id: null, sales_status: null });
  } finally {
    await Promise.all(claimTokens.map(token => releaseAuctionScheduleMutationClaim(db, token)));
  }
});

auctionSchedule.delete('/:id', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  await ensureAuctionScheduleTable(db);
  await ensureAuctionScheduleResultSchema(db);
  const id = c.req.param('id');
  const existing = await db.prepare('SELECT * FROM freelancer_auction_schedules WHERE id = ?')
    .bind(id).first<AuctionScheduleMutationSnapshot>();
  if (!existing) return c.json({ error: '경매 스케줄을 찾을 수 없습니다.' }, 404);
  if (!canManageAuctionSchedule(user)) {
    return c.json({ error: '경매 스케줄 삭제 권한이 없습니다. (마스터·총무·총무보조·대표만 가능)' }, 403);
  }
  await ensureCalendarAuctionDeletionSchema(db);
  const claim = await acquireAuctionScheduleMutationClaim(db, existing, 'source_delete', user.sub);
  if (!claim) {
    return c.json({ error: '일정이 변경되었거나 입찰 결과 처리가 진행 중입니다. 새로고침 후 다시 시도해 주세요.' }, 409);
  }
  try {
    const sourceSnapshot = {
      id: existing.id,
      user_id: existing.user_id,
      source_kind: existing.activity_type === '입찰' ? 'bid' as const : 'inspection' as const,
      source_target_date: existing.target_date,
      event_date: existing.target_date,
      activity_subtype: existing.activity_subtype,
      branch: existing.branch,
      department: existing.department,
      data: existing.data,
      created_at: existing.created_at,
      updated_at: existing.updated_at,
    };
    let dependencies;
    try {
      dependencies = await linkedBusinessData(db, [sourceSnapshot]);
    } catch (error) {
      if (error instanceof AmbiguousLegacyAuctionLinkError) {
        return c.json({ error: error.message }, 409);
      }
      throw error;
    }
    if (dependencies.sales.length || dependencies.commissions.length || dependencies.lawitgo.length) {
      return c.json({ error: '입금신청이 연결된 일정은 삭제할 수 없습니다. 수수료 또는 Lawitgo 전송 내역도 업무성과의 환불·취소 절차를 먼저 처리하세요.' }, 409);
    }
    let legacyState;
    try {
      legacyState = await loadLegacyIdentityState(db, sourceSnapshot);
    } catch (error) {
      if (error instanceof AmbiguousLegacyAuctionLinkError) return c.json({ error: error.message }, 409);
      throw error;
    }
    const protectedBusinessExternalIds = Array.from(new Set([
      ...auctionScheduleSalesExternalIds(id),
      ...(legacyState?.exact_rows || []).map(row => `freelancer-bid:${row.id}`),
    ]));
    const protectedBusinessPlaceholders = protectedBusinessExternalIds.map(() => '?').join(', ');
    const legacySnapshotGuard = !legacyState ? '' : legacyState.rows.length === 0
      ? ` AND NOT EXISTS (
          SELECT 1 FROM freelancer_bid_entries legacy_bid
          WHERE legacy_bid.user_id = ? AND legacy_bid.bid_date = ?
            AND lower(replace(COALESCE(legacy_bid.case_number, ''), ' ', '')) = ?
        )`
      : ` AND (
          SELECT COUNT(*) FROM freelancer_bid_entries legacy_bid
          WHERE legacy_bid.user_id = ? AND legacy_bid.bid_date = ?
            AND lower(replace(COALESCE(legacy_bid.case_number, ''), ' ', '')) = ?
            AND (${legacyState.rows.map(() => `(
              legacy_bid.id = ? AND COALESCE(legacy_bid.court, '') = ?
              AND COALESCE(legacy_bid.item_no, '') = ?
              AND COALESCE(legacy_bid.client_name, '') = ? AND COALESCE(legacy_bid.bidder_name, '') = ?
            )`).join(' OR ')})
        ) = ? AND NOT EXISTS (
          SELECT 1 FROM freelancer_bid_entries legacy_bid
          WHERE legacy_bid.user_id = ? AND legacy_bid.bid_date = ?
            AND lower(replace(COALESCE(legacy_bid.case_number, ''), ' ', '')) = ?
            AND legacy_bid.id NOT IN (${legacyState.rows.map(() => '?').join(', ')})
        )`;
    const legacySnapshotParams = !legacyState ? [] : legacyState.rows.length === 0
      ? [legacyState.target.user_id, legacyState.target.source_target_date, legacyState.case_number]
      : [
        legacyState.target.user_id, legacyState.target.source_target_date, legacyState.case_number,
        ...legacyState.rows.flatMap(row => [row.id, row.court, row.item_no, row.client_name, row.bidder_name]),
        legacyState.rows.length,
        legacyState.target.user_id, legacyState.target.source_target_date, legacyState.case_number,
        ...legacyState.rows.map(row => row.id),
      ];
    const auditId = crypto.randomUUID();
    const beforeSnapshot = JSON.stringify(existing);
    const results = await db.batch([
      db.prepare(`
        INSERT INTO accounting_activity_logs (
          id, actor_id, actor_name, actor_role, action, target_type, target_id,
          target_label, diff_summary, before_snapshot, source_page, created_at
        )
        SELECT ?, ?, ?, ?, 'delete', 'auction_schedule', ?, ?, ?, ?, 'auction_schedule', datetime('now', '+9 hours')
        WHERE EXISTS (
          SELECT 1 FROM auction_schedule_mutation_claims WHERE schedule_id = ? AND claim_token = ?
        )
          AND EXISTS (
            SELECT 1 FROM users current_actor
            WHERE current_actor.id = ? AND current_actor.approved = 1
              AND current_actor.role IN ('master', 'accountant', 'accountant_asst', 'ceo')
          )
          AND NOT EXISTS (SELECT 1 FROM sales_records WHERE external_id IN (${protectedBusinessPlaceholders}))
          AND NOT EXISTS (SELECT 1 FROM commissions WHERE journal_entry_id IN (${protectedBusinessPlaceholders}))
          ${legacySnapshotGuard}
      `).bind(
        auditId, user.sub, user.name || '', user.role, id,
        `auction_schedule:${id}`, '경매 스케줄 원본 화면에서 삭제', beforeSnapshot,
        id, claim, user.sub,
        ...protectedBusinessExternalIds,
        ...protectedBusinessExternalIds,
        ...legacySnapshotParams,
      ),
      db.prepare(`
        DELETE FROM bid_analysis_entries
        WHERE source_type = 'freelancer' AND source_id IN (?, ?)
          AND EXISTS (SELECT 1 FROM accounting_activity_logs WHERE id = ?)
      `).bind(...auctionScheduleSalesExternalIds(id), auditId),
      db.prepare(`
        DELETE FROM auction_bid_result_reminder_runs
        WHERE schedule_id = ?
          AND EXISTS (SELECT 1 FROM accounting_activity_logs WHERE id = ?)
      `).bind(id, auditId),
      db.prepare(`
        DELETE FROM freelancer_auction_schedules
        WHERE id = ?
          AND EXISTS (SELECT 1 FROM accounting_activity_logs WHERE id = ?)
      `).bind(id, auditId),
    ]);
    const auditChanges = Number((results[0] as { meta?: { changes?: number } })?.meta?.changes || 0);
    const deleteChanges = Number((results[3] as { meta?: { changes?: number } })?.meta?.changes || 0);
    if (auditChanges !== 1 || deleteChanges !== 1) {
      const currentActor = await db.prepare('SELECT role, approved FROM users WHERE id = ?')
        .bind(user.sub).first<{ role: string; approved: number }>();
      if (!currentActor || currentActor.approved !== 1 || !canManageAuctionSchedule(currentActor)) {
        return c.json({ error: '삭제 처리 중 계정 권한이 변경되어 작업이 중단되었습니다.' }, 403);
      }
      let currentDependencies;
      try {
        currentDependencies = await linkedBusinessData(db, [sourceSnapshot]);
      } catch (error) {
        if (error instanceof AmbiguousLegacyAuctionLinkError) {
          return c.json({ error: error.message }, 409);
        }
        throw error;
      }
      if (currentDependencies.sales.length || currentDependencies.commissions.length || currentDependencies.lawitgo.length) {
        return c.json({ error: '입금신청이 연결되어 삭제가 중단되었습니다. 수수료 또는 Lawitgo 내역도 확인해 주세요.' }, 409);
      }
      return c.json({ error: '삭제 직전에 일정 또는 계정 권한이 변경되었습니다. 새로고침 후 다시 시도해 주세요.' }, 409);
    }
    return c.json({ success: true });
  } finally {
    await releaseAuctionScheduleMutationClaim(db, claim);
  }
});

export default auctionSchedule;
