import { Hono } from 'hono';
import type { AuthEnv } from '../types.ts';
import { isValidAuctionScheduleDate } from '../../shared/auction-schedule-write-access.ts';
import { auctionPropertyDetailLabel } from '../../shared/auction-property-label.ts';
import {
  buildPersonalCalendarAuctionEvents,
  loadPersonalCalendarAuctionRows,
  type CalendarAuctionInternalEvent,
} from '../lib/personal-calendar-auction-events.ts';

// 외부 사이트(PHP 등) 제공용 read-only 경매 일정 API.
// 전용 정적 키 CALENDAR_API_KEY(X-API-Key)로만 인증하며, 다른 내부 라우트와 완전히 분리된다.
// ⚠️ 원본 data JSON에는 고객 전화번호·입찰가·메모 등 민감정보가 들어있으므로,
//    절대 raw data를 그대로 내보내지 말 것. 아래 allowlist 필드만 재구성해 응답한다.
const publicCalendar = new Hono<AuthEnv>();

// 상수시간 비교(타이밍 공격 방지)
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

publicCalendar.use('*', async (c, next) => {
  const expected = String((c.env as any).CALENDAR_API_KEY || '');
  if (!expected) return c.json({ ok: false, error: 'CALENDAR_API_KEY not configured' }, 500);
  const provided = c.req.header('X-API-Key') || '';
  if (!safeEqual(provided, expected)) return c.json({ ok: false, error: 'Unauthorized' }, 401);
  await next();
});

function parseData(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isDateKey(v: string): boolean {
  return isValidAuctionScheduleDate(v);
}
function kstToday(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
function addDays(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function mergedSourceData(event: CalendarAuctionInternalEvent): Record<string, unknown> {
  const sources = event.source_kind === 'bid'
    ? [...event.source_snapshots].reverse()
    : event.source_snapshots;
  return sources.reduce<Record<string, unknown>>(
    (merged, source) => ({ ...merged, ...parseData(source.data) }),
    {},
  );
}

function stablePublicEventId(
  event: CalendarAuctionInternalEvent,
  existingMaterializedBidIds: ReadonlySet<string>,
): string {
  if (event.source_kind !== 'inspection') return event.id;
  const materializedBidId = `inspection-bid:${event.source_id}`;
  return existingMaterializedBidIds.has(materializedBidId)
    ? `auction-bid-projection:${event.source_id}`
    : `auction-bid:${materializedBidId}`;
}

async function findExistingMaterializedBidIds(
  db: D1Database,
  events: CalendarAuctionInternalEvent[],
): Promise<Set<string>> {
  const candidates = [...new Set(events
    .filter(event => event.source_kind === 'inspection')
    .map(event => `inspection-bid:${event.source_id}`))];
  const existing = new Set<string>();
  const chunkSize = 80;
  for (let offset = 0; offset < candidates.length; offset += chunkSize) {
    const chunk = candidates.slice(offset, offset + chunkSize);
    const placeholders = chunk.map(() => '?').join(', ');
    const rows = await db.prepare(`
      SELECT id
      FROM freelancer_auction_schedules
      WHERE activity_type = '입찰' AND id IN (${placeholders})
    `).bind(...chunk).all<{ id: string }>();
    for (const row of rows.results || []) existing.add(row.id);
  }
  return existing;
}

function latestUpdatedAt(event: CalendarAuctionInternalEvent): string {
  return event.source_snapshots.reduce((latest, source) => {
    const candidate = String(source.updated_at || '');
    return candidate.replace(' ', 'T') > latest.replace(' ', 'T') ? candidate : latest;
  }, event.updated_at || '');
}

// GET /api/public/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD
// 미지정 시 기본 = 당월 1일 ~ +31일. 범위 최대 92일 클램프.
publicCalendar.get('/', async (c) => {
  const today = kstToday();
  let from = c.req.query('from') || '';
  let to = c.req.query('to') || '';
  if (from && !isDateKey(from)) return c.json({ ok: false, error: 'from must be YYYY-MM-DD' }, 400);
  if (to && !isDateKey(to)) return c.json({ ok: false, error: 'to must be YYYY-MM-DD' }, 400);
  if (!from) from = `${today.slice(0, 8)}01`;
  if (!to) to = addDays(from, 31);
  if (from > to) return c.json({ ok: false, error: 'from must be earlier than or equal to to' }, 400);
  const maxTo = addDays(from, 92);
  if (to > maxTo) to = maxTo;

  const rows = await loadPersonalCalendarAuctionRows(c.env.DB, from, to, { mode: 'all' });
  const calendarEvents = buildPersonalCalendarAuctionEvents(rows);
  const existingMaterializedBidIds = await findExistingMaterializedBidIds(c.env.DB, calendarEvents);
  const events = calendarEvents.map((event) => {
    const d = mergedSourceData(event);
    // allowlist만 노출. 제외(외부 금지): clientPhone, bidPrice, winPrice, suggestedPrice,
    //   bidProxy, deviationReason, memo, branch, department, user_id 등.
    return {
      eventId: stablePublicEventId(event, existingMaterializedBidIds), // projection/direct ID 충돌 방지
      updatedAt: latestUpdatedAt(event),               // 병합된 원본 중 마지막 변경 시각
      date: event.event_date,                          // 입찰기일
      assignee: event.assignee_name || '',             // 담당자
      activity_type: event.activity_type,              // 입찰
      result: event.bid_result,                        // 입찰결과 (pending/won/failed/cancelled/withdrawn)
      caseNo: event.case_no,                           // 사건번호
      court: event.court,                              // 법원
      place: String(d.place || ''),                    // 장소
      clientName: event.client_name,                   // 계약자명 (실명)
      propertyType: auctionPropertyDetailLabel(event.property_type), // 세부 물건종류만 제공
    };
  });

  // API 키로 조회하는 고객 실명 데이터이므로 공유 캐시에 저장하지 않는다.
  c.header('Cache-Control', 'private, no-store');
  return c.json({ ok: true, count: events.length, fetched_at: new Date().toISOString(), from, to, events });
});

export default publicCalendar;
