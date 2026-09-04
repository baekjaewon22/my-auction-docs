import {
  auctionScheduleSalesExternalIds,
} from '../../shared/auction-schedule.ts';
import { canManagePersonalCalendar } from '../../shared/personal-calendar-management.ts';
import {
  canonicalAuctionBidItemMarker,
  inspectionMaterializedBidId,
  normalizeAuctionBidIdentity,
} from '../../shared/auction-bid-result-access.ts';
import { ensureBidAnalysisTable } from './bid-analysis.ts';
import { ensureAuctionBidResultReminderTable } from './auction-bid-result-reminders.ts';
import {
  ensureAuctionScheduleMutationClaimTable,
  purgeStaleAuctionScheduleMutationClaims,
} from './auction-schedule-mutation-claim.ts';
import { ensureAuctionScheduleTable } from './auction-schedule-schema.ts';
import { findCanonicalBidSale, type LinkedBidSale } from './performance-activity.ts';
import {
  buildPersonalCalendarAuctionEvents,
  calendarAuctionDeletionPlan,
  calendarAuctionRevision,
  loadPersonalCalendarAuctionRows,
  type CalendarAuctionInternalEvent,
  type CalendarAuctionSourceSnapshot,
} from './personal-calendar-auction-events.ts';

export type ManagedCalendarAuctionSourceType = 'auction_bid' | 'auction_inspection';

type CalendarAuctionActor = {
  sub: string;
  name?: string | null;
  role: string;
};

type StoredAuctionSchedule = {
  id: string;
  user_id: string;
  target_date: string;
  activity_type: string;
  activity_subtype: string;
  data: string;
  branch: string;
  department: string;
  created_at: string;
  updated_at: string;
};

export type LegacyIdentityRow = {
  id: string;
  court: string;
  item_no: string;
  client_name: string;
  bidder_name: string;
};

export type LegacyIdentityState = {
  target: CalendarAuctionSourceSnapshot;
  case_number: string;
  rows: LegacyIdentityRow[];
  exact_rows: LegacyIdentityRow[];
};

export class AmbiguousLegacyAuctionLinkError extends Error {
  constructor() {
    super('기존 입찰 내역의 고객·물건 연결을 하나로 확정할 수 없어 원본 일정을 변경할 수 없습니다. 기존 입찰 내역을 먼저 정리해 주세요.');
    this.name = 'AmbiguousLegacyAuctionLinkError';
  }
}

export type ResolvedCalendarAuctionEvent = {
  source_type: ManagedCalendarAuctionSourceType;
  source_id: string;
  revision: string;
  target_snapshots: CalendarAuctionSourceSnapshot[];
  preserved_related_snapshots: CalendarAuctionSourceSnapshot[];
};

export class CalendarAuctionManagementError extends Error {
  readonly status: 400 | 403 | 404 | 409;
  readonly code: 'invalid_request' | 'permission_denied' | 'not_found' | 'revision_conflict' | 'linked_business_data' | 'ambiguous_source' | 'mutation_in_progress';
  readonly details?: Record<string, unknown>;
  constructor(
    message: string,
    status: 400 | 403 | 404 | 409,
    code: 'invalid_request' | 'permission_denied' | 'not_found' | 'revision_conflict' | 'linked_business_data' | 'ambiguous_source' | 'mutation_in_progress',
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'CalendarAuctionManagementError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const preparedDatabases = new WeakMap<object, Promise<void>>();

async function tableExists(db: D1Database, table: string): Promise<boolean> {
  const row = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .bind(table).first<{ name: string }>();
  return !!row;
}

export async function ensureCalendarAuctionDeletionSchema(db: D1Database): Promise<void> {
  const key = db as unknown as object;
  const existing = preparedDatabases.get(key);
  if (existing) return existing;
  const promise = (async () => {
    await ensureAuctionScheduleTable(db);
    await ensureBidAnalysisTable(db);
    await ensureAuctionBidResultReminderTable(db);
    await ensureAuctionScheduleMutationClaimTable(db);
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS accounting_activity_logs (
        id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        actor_name TEXT NOT NULL DEFAULT '',
        actor_role TEXT NOT NULL DEFAULT '',
        action TEXT NOT NULL,
        target_type TEXT NOT NULL DEFAULT 'sales_record',
        target_id TEXT NOT NULL,
        target_label TEXT NOT NULL DEFAULT '',
        diff_summary TEXT NOT NULL DEFAULT '',
        before_snapshot TEXT,
        after_snapshot TEXT,
        source_page TEXT NOT NULL DEFAULT 'sales',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (actor_id) REFERENCES users(id)
      )
    `).run();
    const auditColumns = await db.prepare('PRAGMA table_info(accounting_activity_logs)').all<{ name: string }>();
    if (!(auditColumns.results || []).some(column => column.name === 'source_page')) {
      await db.prepare("ALTER TABLE accounting_activity_logs ADD COLUMN source_page TEXT NOT NULL DEFAULT 'sales'").run();
    }
    if (await tableExists(db, 'sales_records')) {
      const salesColumns = await db.prepare('PRAGMA table_info(sales_records)').all<{ name: string }>();
      const names = new Set((salesColumns.results || []).map(column => column.name));
      if (!names.has('external_id')) await db.prepare('ALTER TABLE sales_records ADD COLUMN external_id TEXT').run();
      if (!names.has('winning_price')) {
        await db.prepare('ALTER TABLE sales_records ADD COLUMN winning_price INTEGER NOT NULL DEFAULT 0').run();
      }
    }
  })();
  preparedDatabases.set(key, promise);
  try {
    await promise;
  } catch (error) {
    preparedDatabases.delete(key);
    throw error;
  }
}

function parseData(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isCompanionInspection(data: Record<string, unknown>): boolean {
  const value = data.companion;
  return value === true || value === 1 || String(value || '').toLowerCase() === 'true';
}

async function loadStoredSchedule(db: D1Database, id: string): Promise<StoredAuctionSchedule | null> {
  return db.prepare(`
    SELECT id, user_id, target_date, activity_type, activity_subtype, data,
      branch, department, created_at, updated_at
    FROM freelancer_auction_schedules
    WHERE id = ?
  `).bind(id).first<StoredAuctionSchedule>();
}

export async function loadLegacyIdentityState(
  db: D1Database,
  target: CalendarAuctionSourceSnapshot,
): Promise<LegacyIdentityState | null> {
  if (target.source_kind !== 'bid' || !await tableExists(db, 'freelancer_bid_entries')) return null;
  const data = parseData(target.data);
  const caseNumber = normalizeAuctionBidIdentity(data.caseNo);
  const targetCourt = normalizeAuctionBidIdentity(data.court);
  const targetClient = normalizeAuctionBidIdentity(data.client || data.bidder);
  const targetItem = canonicalAuctionBidItemMarker(data.itemNo);
  if (!caseNumber) return null;
  const result = await db.prepare(`
    SELECT id, COALESCE(court, '') AS court, COALESCE(item_no, '') AS item_no, COALESCE(client_name, '') AS client_name,
      COALESCE(bidder_name, '') AS bidder_name
    FROM freelancer_bid_entries
    WHERE user_id = ? AND bid_date = ?
      AND lower(replace(COALESCE(case_number, ''), ' ', '')) = ?
    ORDER BY id
  `).bind(target.user_id, target.source_target_date, caseNumber).all<LegacyIdentityRow>();
  const rows = result.results || [];
  if (!rows.length) return { target, case_number: caseNumber, rows, exact_rows: [] };
  const ambiguousRow = rows.some((row) => {
    const rowCourt = normalizeAuctionBidIdentity(row.court);
    const rowClient = normalizeAuctionBidIdentity(row.client_name || row.bidder_name);
    if (!rowCourt) return true;
    if (rowCourt !== targetCourt) return false;
    if (!rowClient) return true;
    if (rowClient !== targetClient) return false;
    const rowItem = canonicalAuctionBidItemMarker(row.item_no);
    return rowItem !== targetItem && (!rowItem || !targetItem);
  });
  if (!targetCourt || !targetClient || ambiguousRow) {
    throw new AmbiguousLegacyAuctionLinkError();
  }
  const exactRows = rows.filter(row => (
    normalizeAuctionBidIdentity(row.court) === targetCourt
    && canonicalAuctionBidItemMarker(row.item_no) === targetItem
    && normalizeAuctionBidIdentity(row.client_name || row.bidder_name) === targetClient
  ));
  if (exactRows.length > 1) throw new AmbiguousLegacyAuctionLinkError();
  return { target, case_number: caseNumber, rows, exact_rows: exactRows };
}

async function loadInspectionRelatedBidSchedules(
  db: D1Database,
  inspectionId: string,
): Promise<StoredAuctionSchedule[]> {
  const result = await db.prepare(`
    SELECT id, user_id, target_date, activity_type, activity_subtype, data,
      branch, department, created_at, updated_at
    FROM freelancer_auction_schedules
    WHERE activity_type = '입찰'
      AND id = ?
    ORDER BY id
  `).bind(inspectionMaterializedBidId(inspectionId)).all<StoredAuctionSchedule>();
  return result.results || [];
}

function storedScheduleSnapshot(row: StoredAuctionSchedule, eventDate: string): CalendarAuctionSourceSnapshot {
  return {
    id: row.id,
    user_id: row.user_id,
    source_kind: row.activity_type === '입찰' ? 'bid' : 'inspection',
    source_target_date: row.target_date,
    event_date: eventDate,
    activity_subtype: row.activity_subtype,
    branch: row.branch,
    department: row.department,
    data: row.data,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function findMergedEventBySource(
  events: CalendarAuctionInternalEvent[],
  sourceId: string,
): CalendarAuctionInternalEvent | null {
  return events.find(event => event.source_snapshots.some(source => source.id === sourceId)) || null;
}

/** 서버의 현재 원본 집합으로 삭제 단위를 다시 계산한다. 클라이언트가 target id 목록을 정할 수 없다. */
export async function resolveCalendarAuctionEvent(
  db: D1Database,
  sourceType: ManagedCalendarAuctionSourceType,
  sourceId: string,
): Promise<ResolvedCalendarAuctionEvent> {
  if (sourceType !== 'auction_bid' && sourceType !== 'auction_inspection') {
    throw new CalendarAuctionManagementError('삭제할 캘린더 일정 종류를 확인해 주세요.', 400, 'invalid_request');
  }
  if (!String(sourceId || '').trim()) {
    throw new CalendarAuctionManagementError('삭제할 원본 일정 ID를 확인해 주세요.', 400, 'invalid_request');
  }
  await ensureAuctionScheduleTable(db);
  const source = await loadStoredSchedule(db, sourceId);
  if (!source) {
    throw new CalendarAuctionManagementError('경매 스케줄을 찾을 수 없습니다.', 404, 'not_found');
  }

  if (sourceType === 'auction_inspection') {
    const data = parseData(source.data);
    if (source.activity_type !== '임장' || isCompanionInspection(data)) {
      throw new CalendarAuctionManagementError('캘린더에 표시된 임장 일정이 아닙니다.', 404, 'not_found');
    }
    const snapshot = storedScheduleSnapshot(source, source.target_date);
    const related = await loadInspectionRelatedBidSchedules(db, source.id);
    return {
      source_type: sourceType,
      source_id: sourceId,
      revision: calendarAuctionRevision([snapshot]),
      target_snapshots: [snapshot],
      preserved_related_snapshots: related.map(row => storedScheduleSnapshot(row, row.target_date)),
    };
  }

  const sourceData = parseData(source.data);
  const eventDate = source.activity_type === '입찰'
    ? source.target_date
    : source.activity_type === '임장' && !isCompanionInspection(sourceData)
      ? String(sourceData.bidDate || '').trim()
      : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
    throw new CalendarAuctionManagementError('캘린더에 표시된 입찰 일정이 아닙니다.', 404, 'not_found');
  }
  const rows = await loadPersonalCalendarAuctionRows(db, eventDate, eventDate, { mode: 'self', value: source.user_id });
  const event = findMergedEventBySource(buildPersonalCalendarAuctionEvents(rows), sourceId);
  if (!event) {
    throw new CalendarAuctionManagementError('캘린더에 표시된 입찰 일정을 찾을 수 없습니다.', 404, 'not_found');
  }
  const deletionPlan = calendarAuctionDeletionPlan(event, sourceId);
  if (deletionPlan.block_reason || deletionPlan.target_snapshots.length === 0) {
    throw new CalendarAuctionManagementError(
      deletionPlan.block_reason || '삭제할 원본 일정을 안전하게 확인할 수 없습니다.',
      409,
      'ambiguous_source',
    );
  }
  const relatedRows = (await Promise.all(
    deletionPlan.target_snapshots
      .filter(snapshot => snapshot.source_kind === 'inspection')
      .map(snapshot => loadInspectionRelatedBidSchedules(db, snapshot.id)),
  )).flat();
  const relatedById = new Map(relatedRows.map(row => [row.id, storedScheduleSnapshot(row, row.target_date)]));
  return {
    source_type: sourceType,
    source_id: sourceId,
    revision: calendarAuctionRevision(deletionPlan.target_snapshots),
    target_snapshots: deletionPlan.target_snapshots,
    preserved_related_snapshots: [...relatedById.values()]
      .filter(snapshot => !deletionPlan.target_snapshots.some(target => target.id === snapshot.id)),
  };
}

export async function linkedBusinessData(
  db: D1Database,
  targets: CalendarAuctionSourceSnapshot[],
): Promise<{ sales: LinkedBidSale[]; commissions: Array<{ id: string; status: string }>; lawitgo: Array<{ sales_record_id: string; status: string }> }> {
  const sales: LinkedBidSale[] = [];
  if (await tableExists(db, 'sales_records')) {
    for (const target of targets.filter(item => item.source_kind === 'bid')) {
      const data = parseData(target.data);
      const scheduleAliases = auctionScheduleSalesExternalIds(target.id);
      const directRows = await db.prepare(`
        SELECT id, status, amount, winning_price, external_id
        FROM sales_records WHERE external_id IN (?, ?)
        ORDER BY CASE WHEN external_id = ? THEN 0 ELSE 1 END, id
      `).bind(...scheduleAliases, scheduleAliases[0]).all<Omit<LinkedBidSale, 'source'>>();
      if ((directRows.results || []).length > 0) {
        for (const sale of directRows.results || []) {
          if (!sales.some(item => item.id === sale.id)) sales.push({ ...sale, source: 'schedule' });
        }
        continue;
      }
      const legacy = await findCanonicalBidSale(
        db,
        scheduleAliases[0],
        target.user_id,
        target.source_target_date,
        String(data.caseNo || ''),
        String(data.itemNo || ''),
        String(data.client || data.bidder || ''),
        String(data.court || ''),
      );
      if (legacy && !sales.some(item => item.id === legacy.id)) sales.push(legacy);
    }
  }

  const commissionKeys = Array.from(new Set([
    ...targets.flatMap(target => auctionScheduleSalesExternalIds(target.id)),
    ...sales.map(sale => sale.external_id).filter(Boolean),
  ]));
  let commissions: Array<{ id: string; status: string }> = [];
  if (commissionKeys.length > 0 && await tableExists(db, 'commissions')) {
    const placeholders = commissionKeys.map(() => '?').join(', ');
    const rows = await db.prepare(`SELECT id, status FROM commissions WHERE journal_entry_id IN (${placeholders})`)
      .bind(...commissionKeys).all<{ id: string; status: string }>();
    commissions = rows.results || [];
  }
  for (const target of targets.filter(item => item.source_kind === 'bid')) {
    const state = await loadLegacyIdentityState(db, target);
    for (const row of state?.exact_rows || []) {
      const legacyExternalId = `freelancer-bid:${row.id}`;
      if (await tableExists(db, 'sales_records')) {
        const sale = await db.prepare(`
          SELECT id, status, amount, winning_price, external_id
          FROM sales_records WHERE external_id = ?
        `).bind(legacyExternalId).first<Omit<LinkedBidSale, 'source'>>();
        if (sale && !sales.some(item => item.id === sale.id)) sales.push({ ...sale, source: 'legacy' });
      }
      if (await tableExists(db, 'commissions')) {
        const rows = await db.prepare('SELECT id, status FROM commissions WHERE journal_entry_id = ?')
          .bind(legacyExternalId).all<{ id: string; status: string }>();
        for (const commission of rows.results || []) {
          if (!commissions.some(item => item.id === commission.id)) commissions.push(commission);
        }
      }
    }
  }

  let lawitgo: Array<{ sales_record_id: string; status: string }> = [];
  if (sales.length > 0 && await tableExists(db, 'lawitgo_winning_outbox')) {
    const placeholders = sales.map(() => '?').join(', ');
    const rows = await db.prepare(`
      SELECT sales_record_id, status FROM lawitgo_winning_outbox
      WHERE sales_record_id IN (${placeholders})
    `).bind(...sales.map(sale => sale.id)).all<{ sales_record_id: string; status: string }>();
    lawitgo = rows.results || [];
  }
  return { sales, commissions, lawitgo };
}

export async function deleteCalendarAuctionEvent(
  db: D1Database,
  actor: CalendarAuctionActor,
  request: {
    source_type: ManagedCalendarAuctionSourceType;
    source_id: string;
    revision: string;
    reason?: string;
  },
): Promise<{ deleted_source_ids: string[]; audit_id: string }> {
  if (!canManagePersonalCalendar(actor)) {
    throw new CalendarAuctionManagementError('캘린더 일정 삭제 권한이 없습니다.', 403, 'permission_denied');
  }
  const expectedRevision = String(request.revision || '').trim();
  if (!expectedRevision) {
    throw new CalendarAuctionManagementError('삭제할 일정의 revision을 확인해 주세요.', 400, 'invalid_request');
  }
  await ensureCalendarAuctionDeletionSchema(db);
  await purgeStaleAuctionScheduleMutationClaims(db);
  const resolved = await resolveCalendarAuctionEvent(db, request.source_type, request.source_id);
  if (resolved.revision !== expectedRevision) {
    throw new CalendarAuctionManagementError(
      '일정이 다른 사용자 또는 처리 과정에서 변경되었습니다. 캘린더를 새로고침한 뒤 다시 시도해 주세요.',
      409,
      'revision_conflict',
      { current_revision: resolved.revision },
    );
  }

  const protectedSnapshots = [...new Map([
    ...resolved.target_snapshots,
    ...resolved.preserved_related_snapshots,
  ].map(snapshot => [snapshot.id, snapshot])).values()];
  let legacyStates: LegacyIdentityState[] = [];
  try {
    legacyStates = (await Promise.all(protectedSnapshots.map(snapshot => loadLegacyIdentityState(db, snapshot))))
      .filter((state): state is LegacyIdentityState => !!state);
  } catch (error) {
    if (error instanceof AmbiguousLegacyAuctionLinkError) {
      throw new CalendarAuctionManagementError(error.message, 409, 'ambiguous_source');
    }
    throw error;
  }
  let dependencies;
  try {
    dependencies = await linkedBusinessData(db, protectedSnapshots);
  } catch (error) {
    if (error instanceof AmbiguousLegacyAuctionLinkError) {
      throw new CalendarAuctionManagementError(error.message, 409, 'ambiguous_source');
    }
    throw error;
  }
  if (dependencies.sales.length > 0 || dependencies.commissions.length > 0 || dependencies.lawitgo.length > 0) {
    throw new CalendarAuctionManagementError(
      '입금신청·수수료 또는 Lawitgo 전송 내역이 연결된 일정은 캘린더에서 삭제할 수 없습니다. 업무성과의 취소·환불 절차를 먼저 처리해 주세요.',
      409,
      'linked_business_data',
      {
        sales_record_count: dependencies.sales.length,
        commission_count: dependencies.commissions.length,
        lawitgo_statuses: dependencies.lawitgo.map(item => item.status),
      },
    );
  }

  const targets = resolved.target_snapshots;
  const auditId = crypto.randomUUID();
  const reason = String(request.reason || '').trim().slice(0, 500)
    || '캘린더 상세에서 원본 일정 삭제를 확인함';
  const snapshotCondition = targets.map(() => `(
    id = ? AND user_id = ? AND target_date = ? AND activity_type = ?
    AND activity_subtype = ? AND branch = ? AND department = ?
    AND created_at = ? AND updated_at = ? AND data = ?
  )`).join(' OR ');
  const snapshotParams = targets.flatMap(target => [
    target.id,
    target.user_id,
    target.source_target_date,
    target.source_kind === 'bid' ? '입찰' : '임장',
    target.activity_subtype,
    target.branch,
    target.department,
    target.created_at,
    target.updated_at,
    target.data,
  ]);
  const targetIds = targets.map(target => target.id);
  const externalIds = targetIds.flatMap(auctionScheduleSalesExternalIds);
  const idPlaceholders = targetIds.map(() => '?').join(', ');
  const externalIdPlaceholders = externalIds.map(() => '?').join(', ');
  const deterministicRelatedIds = targets
    .filter(target => target.source_kind === 'inspection')
    .map(target => inspectionMaterializedBidId(target.id));
  const protectedExternalIds = Array.from(new Set([
    ...protectedSnapshots.flatMap(snapshot => auctionScheduleSalesExternalIds(snapshot.id)),
    ...deterministicRelatedIds.flatMap(auctionScheduleSalesExternalIds),
    ...legacyStates.flatMap(state => state.exact_rows.map(row => `freelancer-bid:${row.id}`)),
  ]));
  const protectedExternalIdPlaceholders = protectedExternalIds.map(() => '?').join(', ');
  const protectedClaimScheduleIds = Array.from(new Set([
    ...protectedSnapshots.map(snapshot => snapshot.id),
    ...deterministicRelatedIds,
  ]));
  const protectedClaimIdPlaceholders = protectedClaimScheduleIds.map(() => '?').join(', ');
  const hasSalesTable = await tableExists(db, 'sales_records');
  const hasCommissionsTable = await tableExists(db, 'commissions');
  const atomicDependencyGuards = [
    ...(hasSalesTable
      ? [`NOT EXISTS (SELECT 1 FROM sales_records WHERE external_id IN (${protectedExternalIdPlaceholders}))`]
      : []),
    ...(hasCommissionsTable
      ? [`NOT EXISTS (SELECT 1 FROM commissions WHERE journal_entry_id IN (${protectedExternalIdPlaceholders}))`]
      : []),
    `NOT EXISTS (
      SELECT 1 FROM auction_schedule_mutation_claims
      WHERE schedule_id IN (${protectedClaimIdPlaceholders})
    )`,
    ...legacyStates.map((state) => state.rows.length === 0
      ? `NOT EXISTS (
          SELECT 1 FROM freelancer_bid_entries legacy_bid
          WHERE legacy_bid.user_id = ? AND legacy_bid.bid_date = ?
            AND lower(replace(COALESCE(legacy_bid.case_number, ''), ' ', '')) = ?
        )`
      : `(
          SELECT COUNT(*) FROM freelancer_bid_entries legacy_bid
          WHERE legacy_bid.user_id = ? AND legacy_bid.bid_date = ?
            AND lower(replace(COALESCE(legacy_bid.case_number, ''), ' ', '')) = ?
            AND (${state.rows.map(() => `(
              legacy_bid.id = ? AND COALESCE(legacy_bid.court, '') = ?
              AND COALESCE(legacy_bid.item_no, '') = ?
              AND COALESCE(legacy_bid.client_name, '') = ? AND COALESCE(legacy_bid.bidder_name, '') = ?
            )`).join(' OR ')})
        ) = ? AND NOT EXISTS (
          SELECT 1 FROM freelancer_bid_entries legacy_bid
          WHERE legacy_bid.user_id = ? AND legacy_bid.bid_date = ?
            AND lower(replace(COALESCE(legacy_bid.case_number, ''), ' ', '')) = ?
            AND legacy_bid.id NOT IN (${state.rows.map(() => '?').join(', ')})
        )`),
  ];
  const atomicDependencyParams = [
    ...(hasSalesTable ? protectedExternalIds : []),
    ...(hasCommissionsTable ? protectedExternalIds : []),
    ...protectedClaimScheduleIds,
    ...legacyStates.flatMap(state => state.rows.length === 0
      ? [state.target.user_id, state.target.source_target_date, state.case_number]
      : [
        state.target.user_id, state.target.source_target_date, state.case_number,
        ...state.rows.flatMap(row => [row.id, row.court, row.item_no, row.client_name, row.bidder_name]),
        state.rows.length,
        state.target.user_id, state.target.source_target_date, state.case_number,
        ...state.rows.map(row => row.id),
      ]),
  ];
  for (const inspection of targets.filter(target => target.source_kind === 'inspection')) {
    const deterministicId = inspectionMaterializedBidId(inspection.id);
    const baselineIds = protectedSnapshots
      .filter(snapshot => snapshot.source_kind === 'bid')
      .filter(snapshot => snapshot.id === deterministicId)
      .map(snapshot => snapshot.id);
    if (baselineIds.length === 0) {
      atomicDependencyGuards.push(`NOT EXISTS (
        SELECT 1 FROM freelancer_auction_schedules related_bid
        WHERE related_bid.activity_type = '입찰'
          AND related_bid.id = ?
      )`);
      atomicDependencyParams.push(deterministicId);
      continue;
    }
    const baselinePlaceholders = baselineIds.map(() => '?').join(', ');
    atomicDependencyGuards.push(`(
      SELECT COUNT(*) FROM freelancer_auction_schedules related_bid
      WHERE related_bid.activity_type = '입찰'
        AND related_bid.id = ?
        AND related_bid.id IN (${baselinePlaceholders})
    ) = ? AND NOT EXISTS (
      SELECT 1 FROM freelancer_auction_schedules related_bid
      WHERE related_bid.activity_type = '입찰'
        AND related_bid.id = ?
        AND related_bid.id NOT IN (${baselinePlaceholders})
    )`);
    atomicDependencyParams.push(
      deterministicId, ...baselineIds, baselineIds.length,
      deterministicId, ...baselineIds,
    );
  }
  const atomicDependencySql = atomicDependencyGuards.length > 0
    ? ` AND ${atomicDependencyGuards.join(' AND ')}`
    : '';
  const beforeSnapshot = JSON.stringify({
    source_type: request.source_type,
    revision: resolved.revision,
    schedules: targets,
    preserved_related_schedules: resolved.preserved_related_snapshots,
  });

  // 첫 INSERT가 현재 스냅샷 전체와 일치할 때만 audit row를 만든다. 뒤의 삭제들은
  // 같은 batch 안에서 audit row 존재를 guard로 삼으므로 병합 원본이 일부만 지워지지 않는다.
  const results = await db.batch([
    db.prepare(`
      INSERT INTO accounting_activity_logs (
        id, actor_id, actor_name, actor_role, action, target_type, target_id,
        target_label, diff_summary, before_snapshot, source_page, created_at
      )
      SELECT ?, ?, ?, ?, 'delete', 'auction_schedule', ?, ?, ?, ?, 'personal_calendar', datetime('now', '+9 hours')
      WHERE (SELECT COUNT(*) FROM freelancer_auction_schedules WHERE ${snapshotCondition}) = ?
        ${atomicDependencySql}
        AND EXISTS (
          SELECT 1 FROM users current_actor
          WHERE current_actor.id = ?
            AND current_actor.approved = 1
            AND current_actor.role IN ('master', 'accountant')
        )
    `).bind(
      auditId,
      actor.sub,
      actor.name || '',
      actor.role,
      request.source_id,
      `${request.source_type}:${request.source_id}`,
      `${reason} (원본 ${targets.length}건)`,
      beforeSnapshot,
      ...snapshotParams,
      targets.length,
      ...atomicDependencyParams,
      actor.sub,
    ),
    db.prepare(`
      DELETE FROM bid_analysis_entries
      WHERE source_type = 'freelancer' AND source_id IN (${externalIdPlaceholders})
        AND EXISTS (SELECT 1 FROM accounting_activity_logs WHERE id = ?)
    `).bind(...externalIds, auditId),
    db.prepare(`
      DELETE FROM auction_bid_result_reminder_runs
      WHERE schedule_id IN (${idPlaceholders})
        AND EXISTS (SELECT 1 FROM accounting_activity_logs WHERE id = ?)
    `).bind(...targetIds, auditId),
    db.prepare(`
      DELETE FROM freelancer_auction_schedules
      WHERE id IN (${idPlaceholders})
        AND EXISTS (SELECT 1 FROM accounting_activity_logs WHERE id = ?)
    `).bind(...targetIds, auditId),
  ]);
  const auditChanges = Number((results[0] as { meta?: { changes?: number } })?.meta?.changes || 0);
  const deletedChanges = Number((results[3] as { meta?: { changes?: number } })?.meta?.changes || 0);
  if (auditChanges !== 1 || deletedChanges !== targets.length) {
    const currentActor = await db.prepare(`
      SELECT role, approved FROM users WHERE id = ?
    `).bind(actor.sub).first<{ role: string; approved: number }>();
    if (!currentActor || currentActor.approved !== 1 || !canManagePersonalCalendar(currentActor)) {
      throw new CalendarAuctionManagementError(
        '삭제 처리 중 계정 권한이 변경되어 작업이 중단되었습니다.',
        403,
        'permission_denied',
      );
    }
    const activeClaim = await db.prepare(`
      SELECT schedule_id FROM auction_schedule_mutation_claims
      WHERE schedule_id IN (${protectedClaimIdPlaceholders})
      LIMIT 1
    `).bind(...protectedClaimScheduleIds).first<{ schedule_id: string }>();
    if (activeClaim) {
      throw new CalendarAuctionManagementError(
        '입찰 결과 또는 입찰가 처리가 진행 중이어서 삭제할 수 없습니다. 처리가 끝난 뒤 다시 시도해 주세요.',
        409,
        'mutation_in_progress',
      );
    }
    const currentRelatedRows = (await Promise.all(
      targets
        .filter(target => target.source_kind === 'inspection')
        .map(target => loadInspectionRelatedBidSchedules(db, target.id)),
    )).flat();
    const currentProtectedSnapshots = [...new Map([
      ...targets,
      ...currentRelatedRows.map(row => storedScheduleSnapshot(row, row.target_date)),
    ].map(snapshot => [snapshot.id, snapshot])).values()];
    let currentDependencies;
    try {
      currentDependencies = await linkedBusinessData(db, currentProtectedSnapshots);
    } catch (error) {
      if (error instanceof AmbiguousLegacyAuctionLinkError) {
        throw new CalendarAuctionManagementError(error.message, 409, 'ambiguous_source');
      }
      throw error;
    }
    if (
      currentDependencies.sales.length > 0
      || currentDependencies.commissions.length > 0
      || currentDependencies.lawitgo.length > 0
    ) {
      throw new CalendarAuctionManagementError(
        '입금신청·수수료 또는 Lawitgo 전송 내역이 연결되어 삭제가 중단되었습니다.',
        409,
        'linked_business_data',
      );
    }
    throw new CalendarAuctionManagementError(
      '일정이 삭제 직전에 변경되었습니다. 캘린더를 새로고침한 뒤 다시 시도해 주세요.',
      409,
      'revision_conflict',
    );
  }
  return { deleted_source_ids: targetIds, audit_id: auditId };
}
