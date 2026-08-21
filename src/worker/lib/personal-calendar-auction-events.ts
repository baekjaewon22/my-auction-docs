export interface CalendarAuctionScheduleRow {
  id: string;
  user_id: string;
  user_name: string;
  position_title: string;
  source_kind: 'inspection' | 'bid';
  event_date: string;
  branch: string;
  data: string;
  created_at: string;
  updated_at: string;
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
}

function parseData(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalized(value: unknown): string {
  return String(value || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
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
  if (!court || !caseNo) return `source:${row.source_kind}:${row.id}`;
  return [row.user_id, row.event_date, court, caseNo].join('|');
}

function compatibleItem(left: string, right: string): boolean {
  return left === right || !left || !right;
}

function branchColor(branch: string): string {
  const normalizedBranch = normalized(branch);
  if (normalizedBranch.includes('서초')) return '#f57c00';
  if (normalizedBranch.includes('부산')) return '#173b6c';
  if (normalizedBranch.includes('대전')) return '#0398d1';
  return '#1a73e8';
}

export function buildPersonalCalendarAuctionEvents(rows: CalendarAuctionScheduleRow[]): CalendarAuctionEvent[] {
  const sorted = [...rows].sort((left, right) => {
    if (left.source_kind !== right.source_kind) return left.source_kind === 'bid' ? -1 : 1;
    return String(right.updated_at).localeCompare(String(left.updated_at));
  });
  const groups = new Map<string, Array<{ row: CalendarAuctionScheduleRow; data: Record<string, unknown> }>>();

  for (const row of sorted) {
    const data = parseData(row.data);
    const baseKey = compatibleKey(row, data);
    const itemNo = normalized(data.itemNo);
    const candidates = groups.get(baseKey) || [];
    const existing = candidates.find(candidate => compatibleItem(normalized(candidate.data.itemNo), itemNo));
    if (!existing) {
      candidates.push({ row, data });
      groups.set(baseKey, candidates);
      continue;
    }
    const preferred = existing.row.source_kind === 'bid' ? existing : { row, data };
    const fallback = preferred === existing ? { row, data } : existing;
    preferred.data = { ...fallback.data, ...preferred.data };
    existing.row = preferred.row;
    existing.data = preferred.data;
  }

  return [...groups.values()].flat().map(({ row, data }) => {
    const propertyCategory = String(data.propertyCategory || '');
    const propertyType = String(data.propertyType || '');
    return {
      id: `auction-bid:${row.id}`,
      event_date: row.event_date,
      end_date: '',
      title: `[${row.user_name}] ${propertyCategory || propertyType || '입찰'}`,
      content: '',
      color: branchColor(row.branch),
      all_day: 1,
      created_at: row.created_at,
      updated_at: row.updated_at,
      source_type: 'auction_bid' as const,
      source_id: row.id,
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

export function buildPersonalCalendarInspectionEvents(rows: CalendarAuctionScheduleRow[]): CalendarInspectionEvent[] {
  return rows.map((row) => {
    const data = parseData(row.data);
    const propertyCategory = String(data.propertyCategory || '');
    const propertyType = String(data.propertyType || '');
    return {
      id: `auction-inspection:${row.id}`,
      event_date: row.event_date,
      end_date: '',
      title: `[${row.user_name}] 임장 · ${propertyCategory || propertyType || '미분류'}`,
      content: '',
      color: branchColor(row.branch),
      all_day: 1,
      created_at: row.created_at,
      updated_at: row.updated_at,
      source_type: 'auction_inspection' as const,
      source_id: row.id,
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

export async function loadPersonalCalendarInspectionRows(
  db: D1Database,
  from: string,
  to: string,
): Promise<CalendarAuctionScheduleRow[]> {
  const result = await db.prepare(`
    SELECT s.id, s.user_id, u.name AS user_name, u.position_title, 'inspection' AS source_kind,
      s.target_date AS event_date, u.branch, s.data, s.created_at, s.updated_at
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
      json_extract(s.data, '$.bidDate') AS event_date, u.branch, s.data, s.created_at, s.updated_at
    FROM freelancer_auction_schedules s
    JOIN users u ON u.id = s.user_id
    WHERE s.activity_type = '임장'
      AND COALESCE(json_extract(s.data, '$.companion'), 0) != 1
      AND json_extract(s.data, '$.bidDate') BETWEEN ? AND ?${scopeSql}
    UNION ALL
    SELECT s.id, s.user_id, u.name AS user_name, u.position_title, 'bid' AS source_kind,
      s.target_date AS event_date, u.branch, s.data, s.created_at, s.updated_at
    FROM freelancer_auction_schedules s
    JOIN users u ON u.id = s.user_id
    WHERE s.activity_type = '입찰'
      AND s.target_date BETWEEN ? AND ?${scopeSql}
  `).bind(from, to, ...scopeParams, from, to, ...scopeParams).all<CalendarAuctionScheduleRow>();
  return result.results || [];
}
