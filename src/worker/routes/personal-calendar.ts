import { Hono } from 'hono';
import type { AuthEnv } from '../types';
import { authMiddleware } from '../middleware/auth';
import { ensureAuctionScheduleTable } from '../lib/auction-schedule-schema';
import {
  buildPersonalCalendarAuctionEvents,
  buildPersonalCalendarInspectionEvents,
  kstDateKey,
  loadPersonalCalendarAuctionRows,
  loadPersonalCalendarInspectionRows,
} from '../lib/personal-calendar-auction-events';
import { branchAliases, normalizeBranchName } from '../lib/branchAliases';
import { auctionStoryAnomalyBranches, AUCTION_STORY_BRANCHES } from '../../shared/auction-story-anomaly-access';
import { buildAuctionStoryAnomalies, loadAuctionStoryStageRows } from '../lib/auction-story-anomalies';

const personalCalendar = new Hono<AuthEnv>();
personalCalendar.use('*', authMiddleware);

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const preparedDatabases = new WeakSet<object>();

async function ensurePersonalCalendarTable(db: D1Database): Promise<void> {
  if (preparedDatabases.has(db as unknown as object)) return;
  await db.batch([
    db.prepare(`
      CREATE TABLE IF NOT EXISTS personal_calendar_events (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        event_date TEXT NOT NULL,
        end_date TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        color TEXT NOT NULL DEFAULT '#4f6bed',
        all_day INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `),
    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_personal_calendar_events_user_date
      ON personal_calendar_events(user_id, event_date)
    `),
    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_personal_calendar_events_user_end_date
      ON personal_calendar_events(user_id, end_date)
    `),
  ]);
  preparedDatabases.add(db as unknown as object);
}

function parseDate(value: string): number | null {
  if (!DATE_PATTERN.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const time = Date.UTC(year, month - 1, day);
  const parsed = new Date(time);
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) return null;
  return time;
}

// GET /api/personal-calendar/events?from=YYYY-MM-DD&to=YYYY-MM-DD
// 모든 인증 사용자가 동일한 회사 공용 일정을 조회한다.
personalCalendar.get('/events', async (c) => {
  const from = String(c.req.query('from') || '').trim();
  const to = String(c.req.query('to') || '').trim();
  const fromTime = parseDate(from);
  const toTime = parseDate(to);

  if (fromTime === null || toTime === null || fromTime > toTime) {
    return c.json({ error: '조회 기간을 YYYY-MM-DD 형식으로 입력해 주세요.' }, 400);
  }
  if (toTime - fromTime > 366 * 24 * 60 * 60 * 1000) {
    return c.json({ error: '캘린더는 한 번에 1년 이내로 조회할 수 있습니다.' }, 400);
  }

  const db = c.env.DB;
  await ensurePersonalCalendarTable(db);
  const result = await db.prepare(`
    SELECT id, event_date, end_date, title, content, color, all_day, created_at, updated_at
    FROM personal_calendar_events
    WHERE event_date <= ?
      AND (CASE WHEN COALESCE(end_date, '') = '' THEN event_date ELSE end_date END) >= ?
    ORDER BY event_date ASC, created_at ASC
  `).bind(to, from).all<{
    id: string;
    event_date: string;
    end_date: string;
    title: string;
    content: string;
    color: string;
    all_day: number;
    created_at: string;
    updated_at: string;
  }>();

  await ensureAuctionScheduleTable(db);
  const [auctionRows, inspectionRows] = await Promise.all([
    loadPersonalCalendarAuctionRows(db, from, to, { mode: 'all' }),
    loadPersonalCalendarInspectionRows(db, from, to),
  ]);
  const auctionEvents = buildPersonalCalendarAuctionEvents(auctionRows);
  const inspectionEvents = buildPersonalCalendarInspectionEvents(inspectionRows);
  const personalEvents = (result.results || []).map(event => ({ ...event, source_type: 'personal' }));

  return c.json({
    events: [...personalEvents, ...auctionEvents, ...inspectionEvents].sort((left, right) =>
      String(left.event_date).localeCompare(String(right.event_date))
        || String(left.title).localeCompare(String(right.title), 'ko')
    ),
  });
});

personalCalendar.get('/today-bids', async (c) => {
  const db = c.env.DB;
  const today = kstDateKey();
  await ensureAuctionScheduleTable(db);
  const rows = await loadPersonalCalendarAuctionRows(db, today, today, { mode: 'all' });
  const bids = buildPersonalCalendarAuctionEvents(rows).map(event => ({
    id: event.id,
    branch: event.branch,
    assignee_name: event.assignee_name,
    position_title: event.position_title,
    property_category: event.property_category || event.property_type || '미분류',
    court: event.court,
    case_no: event.case_no,
    item_no: event.item_no,
    bid_result: event.bid_result,
  }));
  return c.json({ date: today, bids });
});

personalCalendar.get('/story-anomalies', async (c) => {
  const user = c.get('user');
  const allowedBranches = auctionStoryAnomalyBranches({ id: user.sub, name: user.name, role: user.role });
  if (allowedBranches.length === 0) return c.json({ error: '입찰 스토리 관리자 페이지 열람 권한이 없습니다.' }, 403);

  const month = String(c.req.query('month') || kstDateKey().slice(0, 7)).trim();
  if (!/^\d{4}-\d{2}$/.test(month)) return c.json({ error: '조회 월은 YYYY-MM 형식이어야 합니다.' }, 400);
  const [year, monthNumber] = month.split('-').map(Number);
  if (monthNumber < 1 || monthNumber > 12) return c.json({ error: '유효하지 않은 조회 월입니다.' }, 400);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const from = `${month}-01`;
  const to = `${month}-${String(lastDay).padStart(2, '0')}`;

  const requested = String(c.req.query('branch') || '').trim();
  const normalizedRequested = requested && requested !== 'all' ? normalizeBranchName(requested) : requested;
  let selectedBranch = normalizedRequested;
  if (!selectedBranch) {
    const ownBranch = normalizeBranchName(user.branch);
    selectedBranch = allowedBranches.length === AUCTION_STORY_BRANCHES.length
      ? 'all'
      : allowedBranches.includes(ownBranch as typeof allowedBranches[number]) ? ownBranch : allowedBranches[0];
  }
  if (selectedBranch === 'all' && allowedBranches.length !== AUCTION_STORY_BRANCHES.length) {
    return c.json({ error: '전체 지사 열람 권한이 없습니다.' }, 403);
  }
  if (selectedBranch !== 'all' && !allowedBranches.includes(selectedBranch as typeof allowedBranches[number])) {
    return c.json({ error: '선택한 지사의 관리자 페이지 열람 권한이 없습니다.' }, 403);
  }

  const canonicalBranches = selectedBranch === 'all' ? allowedBranches : [selectedBranch];
  const queryBranches = Array.from(new Set(canonicalBranches.flatMap(branch => branchAliases(branch))));
  const db = c.env.DB;
  await ensureAuctionScheduleTable(db);
  const rows = await loadAuctionStoryStageRows(db, from, to, queryBranches);
  const anomalies = buildAuctionStoryAnomalies(rows, from, to);
  const counts = {
    total: anomalies.length,
    missing_inspection: anomalies.filter(item => item.missing_stages.includes('inspection')).length,
    missing_briefing: anomalies.filter(item => item.missing_stages.includes('briefing')).length,
  };
  return c.json({ month, from, to, selected_branch: selectedBranch, available_branches: allowedBranches, counts, anomalies });
});

export default personalCalendar;
