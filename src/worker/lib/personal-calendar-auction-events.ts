import {
  canManageAuctionBidResult,
  canonicalAuctionBidItemMarker,
  inspectionMaterializedBidId,
} from '../../shared/auction-bid-result-access.ts';
import { canManagePersonalCalendar } from '../../shared/personal-calendar-management.ts';
import { auctionPropertyDetailLabel } from '../../shared/auction-property-label.ts';

export interface CalendarAuctionScheduleRow {
  id: string;
  user_id: string;
  user_name: string;
  position_title: string;
  source_kind: 'inspection' | 'bid';
  event_date: string;
  source_target_date?: string;
  activity_subtype?: string;
  branch: string;
  source_branch?: string;
  department?: string;
  data: string;
  created_at: string;
  updated_at: string;
}

export type CalendarAuctionManagementOrigin = 'direct_bid' | 'inspection' | 'inspection_bid_projection';

export interface CalendarAuctionManagement {
  origin_kind: CalendarAuctionManagementOrigin;
  source_id: string;
  source_target_date: string;
  can_edit: 0 | 1;
  can_delete: 0 | 1;
  edit_url: string;
  revision: string;
  block_reason?: string;
  delete_warning?: string;
}

export interface CalendarAuctionSourceSnapshot {
  id: string;
  user_id: string;
  source_kind: CalendarAuctionScheduleRow['source_kind'];
  source_target_date: string;
  event_date: string;
  activity_subtype: string;
  branch: string;
  department: string;
  data: string;
  created_at: string;
  updated_at: string;
}

export interface CalendarAuctionDeletionPlan {
  target_snapshots: CalendarAuctionSourceSnapshot[];
  block_reason?: string;
  preserves_other_sources: boolean;
}

export function kstDateKey(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export interface CalendarAuctionEvent {
  id: string;
  event_date: string;
  end_date: string;
  title: string;
  content: string;
  color: string;
  all_day: number;
  created_at: string;
  updated_at: string;
  source_type: 'auction_bid';
  source_id: string;
  branch: string;
  assignee_name: string;
  position_title: string;
  activity_type: '입찰';
  client_name: string;
  court: string;
  case_no: string;
  item_no: string;
  property_category: string;
  property_type: string;
  bid_result: 'pending' | 'won' | 'failed' | 'cancelled' | 'withdrawn';
  automatic_cancel: number;
  can_edit_bid_result: 0 | 1;
  bid_result_block_reason?: string;
  management?: CalendarAuctionManagement;
}

export type CalendarAuctionInternalEvent = Omit<CalendarAuctionEvent, 'can_edit_bid_result' | 'bid_result_block_reason' | 'management'> & {
  owner_id: string;
  source_kind: CalendarAuctionScheduleRow['source_kind'];
  inspection_bid_materialization_ready: boolean;
  source_snapshots: CalendarAuctionSourceSnapshot[];
};

export interface CalendarAuctionViewer {
  id: string;
  role: string;
}

export interface CalendarInspectionEvent {
  id: string;
  event_date: string;
  end_date: string;
  title: string;
  content: string;
  color: string;
  all_day: number;
  created_at: string;
  updated_at: string;
  source_type: 'auction_inspection';
  source_id: string;
  branch: string;
  assignee_name: string;
  position_title: string;
  activity_type: '임장';
  client_name: string;
  court: string;
  case_no: string;
  item_no: string;
  property_category: string;
  property_type: string;
  management?: CalendarAuctionManagement;
}

export type CalendarInspectionInternalEvent = Omit<CalendarInspectionEvent, 'management'> & {
  owner_id: string;
  source_target_date: string;
  source_revision: string;
  source_data: string;
};

function parseData(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function explicitlyRelatedAuctionSources(
  left: CalendarAuctionSourceSnapshot,
  right: CalendarAuctionSourceSnapshot,
): boolean {
  if (left.id === right.id) return true;
  if (left.source_kind === right.source_kind || left.user_id !== right.user_id) return false;
  const bid = left.source_kind === 'bid' ? left : right;
  const inspection = left.source_kind === 'inspection' ? left : right;
  const bidData = parseData(bid.data);
  const inspectionSourceId = String(bidData.inspectionSourceId || '').trim();
  // 과거 클라이언트도 data 필드를 보낼 수 있었으므로 JSON source-id만으로는
  // destructive provenance를 인정하지 않는다. 서버 materializer의 deterministic
  // ID가 정확하고, source-id가 있다면 그 값도 일치할 때만 cascade한다.
  return bid.id === inspectionMaterializedBidId(inspection.id)
    && (!inspectionSourceId || inspectionSourceId === inspection.id);
}

/**
 * 표시용 병합은 빈 물건번호를 호환값으로 취급하지만, 삭제는 그 느슨한 규칙을
 * 절대 사용하지 않는다. inspectionSourceId 또는 materialize marker처럼 실제로
 * 저장된 provenance 관계만 따라가고, 같은 물건번호라는 이유만으로 함께 지우지 않는다.
 */
export function calendarAuctionDeletionPlan(
  event: CalendarAuctionInternalEvent,
  selectedSourceId: string = event.source_id,
): CalendarAuctionDeletionPlan {
  const explicitItems = new Set(event.source_snapshots
    .map(source => canonicalAuctionBidItemMarker(parseData(source.data).itemNo))
    .filter(Boolean));
  const hasBlankItem = event.source_snapshots.some(
    source => !canonicalAuctionBidItemMarker(parseData(source.data).itemNo),
  );
  if (hasBlankItem && explicitItems.size > 1) {
    return {
      target_snapshots: [],
      preserves_other_sources: true,
      block_reason: '물건번호가 비어 있는 일정이 서로 다른 여러 물건번호와 함께 표시되어 캘린더에서 안전하게 삭제할 수 없습니다. 경매 스케줄에서 원본 일정을 각각 확인해 주세요.',
    };
  }

  const selected = event.source_snapshots.find(source => source.id === selectedSourceId);
  if (!selected) {
    return {
      target_snapshots: [],
      preserves_other_sources: true,
      block_reason: '삭제할 원본 일정을 현재 캘린더 표시에서 확인할 수 없습니다.',
    };
  }
  if (selected.source_kind === 'bid') {
    const inspectionSourceId = String(parseData(selected.data).inspectionSourceId || '').trim();
    if (selected.id.startsWith('inspection-bid:')) {
      const deterministicInspectionId = selected.id.slice('inspection-bid:'.length);
      if (inspectionSourceId && inspectionSourceId !== deterministicInspectionId) {
        return {
          target_snapshots: [],
          preserves_other_sources: true,
          block_reason: '입찰 일정의 연결 원본 정보가 서로 일치하지 않아 캘린더에서 안전하게 삭제할 수 없습니다.',
        };
      }
      const referencedInspection = event.source_snapshots.find(source => (
        source.id === deterministicInspectionId
        && source.source_kind === 'inspection'
        && source.user_id === selected.user_id
      ));
      if (!referencedInspection) {
        return {
          target_snapshots: [],
          preserves_other_sources: true,
          block_reason: '연결된 원본 임장 일정이 현재 표시 묶음에 없어 캘린더에서 안전하게 삭제할 수 없습니다. 경매 스케줄에서 원본을 확인해 주세요.',
        };
      }
    }
  }
  const targets = [selected];
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of event.source_snapshots) {
      if (targets.some(target => target.id === candidate.id)) continue;
      if (targets.some(target => explicitlyRelatedAuctionSources(target, candidate))) {
        targets.push(candidate);
        changed = true;
      }
    }
  }
  return {
    target_snapshots: targets,
    preserves_other_sources: targets.length < event.source_snapshots.length,
  };
}

function normalized(value: unknown): string {
  return String(value || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

function propertyClassification(typeValue: unknown): string {
  return `[${auctionPropertyDetailLabel(typeValue)}]`;
}

const CALENDAR_CATEGORY_DETAIL_FALLBACKS = new Set(['숙박시설']);

function calendarPropertyType(data: Record<string, unknown>): string {
  const rawPropertyType = String(data.propertyType || '');
  const propertyType = rawPropertyType.trim();
  const propertyCategory = String(data.propertyCategory || '').trim();
  if (propertyType && propertyType !== '기타') return rawPropertyType;
  if (CALENDAR_CATEGORY_DETAIL_FALLBACKS.has(propertyCategory)) return propertyCategory;
  return rawPropertyType;
}

function hashRevisionPart(value: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * 수정 시각만으로는 같은 초에 두 번 바뀐 일정을 구별하지 못한다. 삭제 전
 * 동시성 확인용 토큰에는 병합된 모든 원본의 식별자·날짜·종류·본문을 넣는다.
 * 이 값은 인증 수단이 아니라 낡은 화면에서의 삭제를 막는 opaque revision이다.
 */
export function calendarAuctionRevision(snapshots: CalendarAuctionSourceSnapshot[]): string {
  const canonical = [...snapshots]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((source) => [
      source.id,
      source.user_id,
      source.source_kind,
      source.source_target_date,
      source.event_date,
      source.activity_subtype,
      source.branch,
      source.department,
      source.updated_at,
      source.created_at,
      source.data,
    ].map(value => String(value || '')).join('\u001f'))
    .join('\u001e');
  const first = hashRevisionPart(canonical, 0x811c9dc5);
  const second = hashRevisionPart(canonical, 0x9e3779b9);
  return `calendar-${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`;
}

function managementEditUrl(sourceTargetDate: string, sourceId: string): string {
  return `/auction-schedule?date=${encodeURIComponent(sourceTargetDate)}&schedule=${encodeURIComponent(sourceId)}`;
}

function auctionEventManagement(
  event: CalendarAuctionInternalEvent,
  viewer: CalendarAuctionViewer,
): CalendarAuctionManagement | undefined {
  if (!canManagePersonalCalendar(viewer)) return undefined;
  const primary = event.source_snapshots.find(source => source.id === event.source_id)
    || event.source_snapshots[0];
  if (!primary) return undefined;
  const resultLocked = event.bid_result !== 'pending';
  const deletionPlan = calendarAuctionDeletionPlan(event, event.source_id);
  const originKind: CalendarAuctionManagementOrigin = event.source_kind === 'bid'
    ? 'direct_bid'
    : 'inspection_bid_projection';
  return {
    origin_kind: originKind,
    source_id: event.source_id,
    source_target_date: primary.source_target_date,
    can_edit: resultLocked ? 0 : 1,
    can_delete: deletionPlan.block_reason ? 0 : 1,
    edit_url: managementEditUrl(primary.source_target_date, event.source_id),
    revision: calendarAuctionRevision(
      deletionPlan.target_snapshots.length > 0 ? deletionPlan.target_snapshots : event.source_snapshots,
    ),
    ...(deletionPlan.block_reason
      ? { block_reason: deletionPlan.block_reason }
      : resultLocked
        ? { block_reason: '입찰 결과가 처리된 일정은 일반정보를 수정할 수 없습니다. 입찰 결과 전용 기능을 이용해 주세요.' }
        : {}),
    ...(deletionPlan.preserves_other_sources && !deletionPlan.block_reason
      ? { delete_warning: '표시상 함께 합쳐진 다른 원본 일정은 명시적인 연결 관계가 없어 보존됩니다. 삭제 후 같은 일정 칩이 계속 표시될 수 있습니다.' }
      : deletionPlan.target_snapshots.length > 1
        ? { delete_warning: `명시적으로 연결된 원본 일정 ${deletionPlan.target_snapshots.length}건이 함께 삭제됩니다. 연결된 임장 표시도 사라질 수 있습니다.` }
      : originKind === 'inspection_bid_projection'
        ? { delete_warning: '임장 일정에서 파생된 입찰기일입니다. 삭제하면 원본 임장 일정도 함께 삭제됩니다.' }
        : {}),
  };
}

function inspectionEventManagement(
  event: CalendarInspectionInternalEvent,
  viewer: CalendarAuctionViewer,
): CalendarAuctionManagement | undefined {
  if (!canManagePersonalCalendar(viewer)) return undefined;
  return {
    origin_kind: 'inspection',
    source_id: event.source_id,
    source_target_date: event.source_target_date,
    can_edit: 1,
    can_delete: 1,
    edit_url: managementEditUrl(event.source_target_date, event.source_id),
    revision: event.source_revision,
    delete_warning: '원본 임장 일정만 삭제됩니다. 임장에서 단순 파생된 입찰기일 표시는 함께 사라지지만, 이미 별도 입찰 일정으로 생성되었거나 결과 처리된 입찰은 유지될 수 있습니다.',
  };
}

function resultOf(data: Record<string, unknown>): CalendarAuctionEvent['bid_result'] {
  if (data.bidResultCancelled) return 'cancelled';
  if (data.bidCancelled) return 'withdrawn';
  if (data.bidWon) return 'won';
  if (data.bidFailed) return 'failed';
  return 'pending';
}

function compatibleKey(row: CalendarAuctionScheduleRow, data: Record<string, unknown>): string {
  const court = normalized(data.court);
  const caseNo = normalized(data.caseNo);
  if (data.auctionKind === 'public' && caseNo) return [row.user_id, row.event_date, 'public', caseNo].join('|');
  if (!court || !caseNo) return `source:${row.source_kind}:${row.id}`;
  return [row.user_id, row.event_date, court, caseNo].join('|');
}

const INSPECTION_BID_RESULT_BLOCK_REASON = '경매 스케줄에서 고객명 등 입찰 필수정보를 먼저 보완해 주세요.';

function isValidDateKey(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function inspectionBidMaterializationReady(
  row: CalendarAuctionScheduleRow,
  data: Record<string, unknown>,
): boolean {
  if (row.source_kind === 'bid') return true;
  const companion = data.companion;
  if (companion === true || companion === 1 || String(companion || '').toLowerCase() === 'true') return false;
  const text = (key: string) => String(data[key] || '').trim();
  const bidDate = text('bidDate');
  return isValidDateKey(bidDate)
    && row.event_date === bidDate
    && !!text('caseNo')
    && (data.auctionKind === 'public' || !!text('court'))
    && !!(text('client') || text('bidder'))
    && !!text('propertyType');
}

function branchColor(branch: string): string {
  const normalizedBranch = normalized(branch);
  if (normalizedBranch.includes('서초')) return '#f57c00';
  if (normalizedBranch.includes('부산')) return '#173b6c';
  if (normalizedBranch.includes('대전')) return '#0398d1';
  return '#1a73e8';
}

export function buildPersonalCalendarAuctionEvents(rows: CalendarAuctionScheduleRow[]): CalendarAuctionInternalEvent[] {
  const sorted = [...rows].sort((left, right) => {
    if (left.source_kind !== right.source_kind) return left.source_kind === 'bid' ? -1 : 1;
    const updatedOrder = String(right.updated_at).localeCompare(String(left.updated_at));
    if (updatedOrder !== 0) return updatedOrder;
    return left.id.localeCompare(right.id);
  });
  type GroupedSource = { row: CalendarAuctionScheduleRow; data: Record<string, unknown> };
  type GroupedEvent = GroupedSource & { sources: GroupedSource[]; explicitItem: string };
  const groups = new Map<string, GroupedEvent[]>();

  for (const row of sorted) {
    const data = parseData(row.data);
    const baseKey = compatibleKey(row, data);
    const itemNo = normalized(data.itemNo);
    const candidates = groups.get(baseKey) || [];
    // A blank item number may supplement one explicit item, but it must never act as
    // a transitive bridge between different explicit items (for example 1 <- blank -> 2).
    // Keep the explicit marker separately because the preferred source's blank data can
    // legitimately win the display merge. Candidate order is deterministic from `sorted`.
    const existing = itemNo
      ? candidates.find(candidate => candidate.explicitItem === itemNo)
        || candidates.find(candidate => !candidate.explicitItem)
      : candidates[0];
    if (!existing) {
      candidates.push({ row, data, sources: [{ row, data }], explicitItem: itemNo });
      groups.set(baseKey, candidates);
      continue;
    }
    const preferred = existing.row.source_kind === 'bid' ? existing : { row, data };
    const fallback = preferred === existing ? { row, data } : existing;
    preferred.data = { ...fallback.data, ...preferred.data };
    existing.sources.push({ row, data });
    existing.row = preferred.row;
    existing.data = preferred.data;
    if (!existing.explicitItem && itemNo) existing.explicitItem = itemNo;
  }

  return [...groups.values()].flat().map(({ row, data, sources }) => {
    const propertyCategory = String(data.propertyCategory || '');
    const propertyType = calendarPropertyType(data);
    const sourceSnapshots = sources.map(({ row: source }) => ({
      id: source.id,
      user_id: source.user_id,
      source_kind: source.source_kind,
      source_target_date: source.source_target_date || source.event_date,
      event_date: source.event_date,
      activity_subtype: source.activity_subtype || '',
      branch: source.source_branch || source.branch || '',
      department: source.department || '',
      data: source.data,
      created_at: source.created_at,
      updated_at: source.updated_at,
    }));
    return {
      id: `auction-bid:${row.id}`,
      event_date: row.event_date,
      end_date: '',
      title: `[${row.user_name}] ${propertyClassification(propertyType)}`,
      content: '',
      color: branchColor(row.branch),
      all_day: 1,
      created_at: row.created_at,
      updated_at: row.updated_at,
      source_type: 'auction_bid' as const,
      source_id: row.id,
      owner_id: row.user_id,
      source_kind: row.source_kind,
      inspection_bid_materialization_ready: inspectionBidMaterializationReady(row, data),
      source_snapshots: sourceSnapshots,
      branch: row.branch,
      assignee_name: row.user_name,
      position_title: row.position_title,
      activity_type: '입찰' as const,
      client_name: String(data.client || data.bidder || ''),
      court: String(data.court || ''),
      case_no: String(data.caseNo || ''),
      item_no: String(data.itemNo || ''),
      property_category: propertyCategory,
      property_type: propertyType,
      bid_result: resultOf(data),
      automatic_cancel: data.bidResultCancelledAutomatically ? 1 : 0,
    };
  }).sort((left, right) => left.event_date.localeCompare(right.event_date) || left.title.localeCompare(right.title, 'ko'));
}

export function toPublicPersonalCalendarAuctionEvent(
  event: CalendarAuctionInternalEvent,
  viewer: CalendarAuctionViewer,
): CalendarAuctionEvent {
  const {
    owner_id: ownerId,
    source_kind: sourceKind,
    inspection_bid_materialization_ready: inspectionReady,
    source_snapshots: _sourceSnapshots,
    ...publicEvent
  } = event;
  const hasResultPermission = canManageAuctionBidResult(viewer, ownerId);
  const inspectionBlocked = sourceKind === 'inspection' && !inspectionReady;
  const management = auctionEventManagement(event, viewer);
  return {
    ...publicEvent,
    can_edit_bid_result: hasResultPermission && !inspectionBlocked ? 1 : 0,
    ...(management ? { management } : {}),
    ...(hasResultPermission && inspectionBlocked
      ? { bid_result_block_reason: INSPECTION_BID_RESULT_BLOCK_REASON }
      : {}),
  };
}

export function buildPersonalCalendarInspectionEvents(rows: CalendarAuctionScheduleRow[]): CalendarInspectionInternalEvent[] {
  return rows.map((row) => {
    const data = parseData(row.data);
    const propertyCategory = String(data.propertyCategory || '');
    const propertyType = calendarPropertyType(data);
    return {
      id: `auction-inspection:${row.id}`,
      event_date: row.event_date,
      end_date: '',
      title: `[${row.user_name}] 임장 · ${propertyClassification(propertyType)}`,
      content: '',
      color: branchColor(row.branch),
      all_day: 1,
      created_at: row.created_at,
      updated_at: row.updated_at,
      source_type: 'auction_inspection' as const,
      source_id: row.id,
      owner_id: row.user_id,
      source_target_date: row.source_target_date || row.event_date,
      source_revision: calendarAuctionRevision([{
        id: row.id,
        user_id: row.user_id,
        source_kind: 'inspection',
        source_target_date: row.source_target_date || row.event_date,
        event_date: row.event_date,
        activity_subtype: row.activity_subtype || '',
        branch: row.source_branch || row.branch || '',
        department: row.department || '',
        data: row.data,
        created_at: row.created_at,
        updated_at: row.updated_at,
      }]),
      source_data: row.data,
      branch: row.branch,
      assignee_name: row.user_name,
      position_title: row.position_title,
      activity_type: '임장' as const,
      client_name: String(data.client || data.bidder || ''),
      court: String(data.court || ''),
      case_no: String(data.caseNo || ''),
      item_no: String(data.itemNo || ''),
      property_category: propertyCategory,
      property_type: propertyType,
    };
  }).sort((left, right) => left.event_date.localeCompare(right.event_date) || left.title.localeCompare(right.title, 'ko'));
}

export function toPublicPersonalCalendarInspectionEvent(
  event: CalendarInspectionInternalEvent,
  viewer: CalendarAuctionViewer,
): CalendarInspectionEvent {
  const {
    owner_id: _ownerId,
    source_target_date: _sourceTargetDate,
    source_revision: _sourceRevision,
    source_data: _sourceData,
    ...publicEvent
  } = event;
  const management = inspectionEventManagement(event, viewer);
  return {
    ...publicEvent,
    ...(management ? { management } : {}),
  };
}

export async function loadPersonalCalendarInspectionRows(
  db: D1Database,
  from: string,
  to: string,
): Promise<CalendarAuctionScheduleRow[]> {
  const result = await db.prepare(`
    SELECT s.id, s.user_id, u.name AS user_name, u.position_title, 'inspection' AS source_kind,
      s.target_date AS event_date, s.target_date AS source_target_date,
      s.activity_subtype, u.branch, s.branch AS source_branch,
      s.department, s.data, s.created_at, s.updated_at
    FROM freelancer_auction_schedules s
    JOIN users u ON u.id = s.user_id
    WHERE s.activity_type = '임장'
      AND COALESCE(json_extract(s.data, '$.companion'), 0) != 1
      AND s.target_date BETWEEN ? AND ?
  `).bind(from, to).all<CalendarAuctionScheduleRow>();
  return result.results || [];
}

export async function loadPersonalCalendarAuctionRows(
  db: D1Database,
  from: string,
  to: string,
  scope: { mode: 'all' | 'branch' | 'self' | 'none'; value?: string },
): Promise<CalendarAuctionScheduleRow[]> {
  if (scope.mode === 'none') return [];
  const scopeSql = scope.mode === 'branch' ? ' AND s.branch = ?' : scope.mode === 'self' ? ' AND s.user_id = ?' : '';
  const scopeParams = scope.mode === 'all' ? [] : [scope.value || '__unassigned__'];
  const result = await db.prepare(`
    SELECT s.id, s.user_id, u.name AS user_name, u.position_title, 'inspection' AS source_kind,
      json_extract(s.data, '$.bidDate') AS event_date, s.target_date AS source_target_date,
      s.activity_subtype, u.branch, s.branch AS source_branch,
      s.department, s.data, s.created_at, s.updated_at
    FROM freelancer_auction_schedules s
    JOIN users u ON u.id = s.user_id
    WHERE s.activity_type = '임장'
      AND COALESCE(json_extract(s.data, '$.companion'), 0) != 1
      AND json_extract(s.data, '$.bidDate') BETWEEN ? AND ?${scopeSql}
    UNION ALL
    SELECT s.id, s.user_id, u.name AS user_name, u.position_title, 'bid' AS source_kind,
      s.target_date AS event_date, s.target_date AS source_target_date,
      s.activity_subtype, u.branch, s.branch AS source_branch,
      s.department, s.data, s.created_at, s.updated_at
    FROM freelancer_auction_schedules s
    JOIN users u ON u.id = s.user_id
    WHERE s.activity_type = '입찰'
      AND s.target_date BETWEEN ? AND ?${scopeSql}
  `).bind(from, to, ...scopeParams, from, to, ...scopeParams).all<CalendarAuctionScheduleRow>();
  return result.results || [];
}
