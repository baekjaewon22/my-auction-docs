import { Hono } from 'hono';
import type { AuthEnv } from '../types';
import { authMiddleware, requireHumanUser } from '../middleware/auth';
import { canViewAllMyStatistics, canViewMyStatistics } from '../../shared/my-statistics-access';
import {
  buildMyStatistics,
  dedupeMyStatisticsBids,
  type MyStatisticsBid,
} from '../lib/my-statistics';
import { confirmedSalesSql, recognizedSalesDateSql } from '../lib/sales-recognition';

const route = new Hono<AuthEnv>();
route.use('*', authMiddleware, requireHumanUser());

type StatisticsUser = {
  id: string;
  name: string;
  role: string;
  branch: string;
  department: string;
  position_title: string;
  login_type: string;
  team_name?: string;
};

type ActivityRow = {
  id: string;
  user_id: string;
  target_date: string;
  data: string;
  activity_type?: string;
  activity_subtype?: string;
};

const historySchemaPromises = new WeakMap<object, Promise<void>>();

async function ensureHistorySchema(db: D1Database): Promise<void> {
  const key = db as object;
  const existing = historySchemaPromises.get(key);
  if (existing) return existing;
  const promise = db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS historical_bid_statistics (
      id TEXT PRIMARY KEY, source_file TEXT NOT NULL, source_row INTEGER NOT NULL,
      assignee_name TEXT NOT NULL, property_type TEXT NOT NULL DEFAULT '', bid_result TEXT NOT NULL DEFAULT '',
      bid_date TEXT NOT NULL, registered_at TEXT NOT NULL DEFAULT '', case_number TEXT NOT NULL DEFAULT '',
      item_number TEXT NOT NULL DEFAULT '', court TEXT NOT NULL DEFAULT '',
      imported_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')), UNIQUE(source_file, source_row)
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_historical_bid_statistics_assignee_date ON historical_bid_statistics(assignee_name, bid_date)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_historical_bid_statistics_identity ON historical_bid_statistics(assignee_name, bid_date, court, case_number, item_number)'),
  ]).then(() => undefined);
  historySchemaPromises.set(key, promise);
  try { await promise; } catch (error) { historySchemaPromises.delete(key); throw error; }
}

function parseData(value: unknown): Record<string, any> {
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function truthy(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true';
}

function amount(value: unknown): number | null {
  const normalized = Number(String(value || '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(normalized) && normalized > 0 ? normalized : null;
}

function todayKst(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function activityResult(source: 'journal' | 'schedule', data: Record<string, any>): MyStatisticsBid['result'] {
  if (truthy(data.bidCancelled) || truthy(data.bidResultCancelled)) return 'cancelled';
  if (truthy(data.bidWon)) return 'won';
  if (truthy(data.bidFailed)) return 'lost';
  if (source === 'journal' && Object.prototype.hasOwnProperty.call(data, 'bidWon') && !truthy(data.bidWon)) return 'lost';
  return 'pending';
}

function validDate(value: string | undefined): string {
  const date = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
}

function activityBid(source: 'journal' | 'schedule', row: ActivityRow): MyStatisticsBid {
  const data = parseData(row.data);
  return {
    source,
    sourceId: row.id,
    userId: row.user_id,
    bidDate: String(row.target_date || '').slice(0, 10),
    court: String(data.court || data.courtName || '').trim(),
    caseNumber: String(data.caseNo || data.case_number || '').trim(),
    itemNumber: String(data.itemNo || data.item_no || '').trim(),
    propertyType: String(data.propertyType || data.propertyCategory || '').trim() || '미분류',
    result: activityResult(source, data),
    suggestedPrice: amount(data.suggestedPrice),
    actualBidPrice: amount(data.bidPrice || data.actualBidPrice),
    winningPrice: amount(data.winPrice || data.winningPrice),
  };
}

async function loadUser(db: D1Database, id: string): Promise<StatisticsUser | null> {
  return db.prepare(`
    SELECT u.id, u.name, u.role, COALESCE(u.branch, '') AS branch,
      COALESCE(u.department, '') AS department, COALESCE(u.position_title, '') AS position_title,
      COALESCE(u.login_type, 'employee') AS login_type, COALESCE(t.name, '') AS team_name
    FROM users u LEFT JOIN teams t ON t.id = u.team_id
    WHERE u.id = ? AND u.approved = 1 AND u.role != 'resigned'
    LIMIT 1
  `).bind(id).first<StatisticsUser>();
}

async function loadEligibleUsers(db: D1Database): Promise<StatisticsUser[]> {
  const rows = await db.prepare(`
    SELECT u.id, u.name, u.role, COALESCE(u.branch, '') AS branch,
      COALESCE(u.department, '') AS department, COALESCE(u.position_title, '') AS position_title,
      COALESCE(u.login_type, 'employee') AS login_type, COALESCE(t.name, '') AS team_name
    FROM users u LEFT JOIN teams t ON t.id = u.team_id
    WHERE u.approved = 1 AND u.role != 'resigned'
    ORDER BY u.name
  `).all<StatisticsUser>();
  return (rows.results || []).filter(canViewMyStatistics);
}

route.get('/', async (c) => {
  const viewerPayload = c.get('user');
  const viewer = await loadUser(c.env.DB, viewerPayload.sub);
  if (!viewer || !canViewMyStatistics(viewer)) return c.json({ error: '마이통계 열람 권한이 없습니다.' }, 403);

  const canViewAll = canViewAllMyStatistics(viewer);
  const requestedUserId = String(c.req.query('user_id') || '').trim();
  const targetUserId = canViewAll && requestedUserId ? requestedUserId : viewer.id;
  const target = targetUserId === viewer.id ? viewer : await loadUser(c.env.DB, targetUserId);
  if (!target || !canViewMyStatistics(target)) return c.json({ error: '조회할 수 없는 사용자입니다.' }, 404);

  const from = validDate(c.req.query('from'));
  const to = validDate(c.req.query('to'));
  const latestBidDate = todayKst();
  const effectiveTo = to && to < latestBidDate ? to : latestBidDate;
  if (from && to && from > to) return c.json({ error: '조회 시작일은 종료일보다 늦을 수 없습니다.' }, 400);

  await ensureHistorySchema(c.env.DB);

  const dateConditions: string[] = [];
  const dateParams: unknown[] = [];
  if (from) { dateConditions.push('target_date >= ?'); dateParams.push(from); }
  dateConditions.push('target_date <= ?'); dateParams.push(effectiveTo);
  const dateSql = dateConditions.length ? ` AND ${dateConditions.join(' AND ')}` : '';

  const journalRows = await c.env.DB.prepare(`
    SELECT id, user_id, target_date, data
    FROM journal_entries
    WHERE user_id = ? AND activity_type = '입찰'${dateSql}
  `).bind(target.id, ...dateParams).all<ActivityRow>();
  const scheduleRows = await c.env.DB.prepare(`
    SELECT id, user_id, target_date, data
    FROM freelancer_auction_schedules
    WHERE user_id = ? AND activity_type = '입찰'${dateSql}
  `).bind(target.id, ...dateParams).all<ActivityRow>();

  const bids: MyStatisticsBid[] = [
    ...(journalRows.results || []).map((row) => activityBid('journal', row)),
    ...(scheduleRows.results || []).map((row) => activityBid('schedule', row)),
  ];

  const historyConditions: string[] = ['assignee_name = ?', 'bid_date <= ?'];
  const historyParams: unknown[] = [target.name, effectiveTo];
  if (from) { historyConditions.push('bid_date >= ?'); historyParams.push(from); }
  const historyRows = await c.env.DB.prepare(`
    SELECT id, assignee_name, property_type, bid_result, bid_date, case_number, item_number, court
    FROM historical_bid_statistics
    WHERE ${historyConditions.join(' AND ')}
  `).bind(...historyParams).all<any>();
  (historyRows.results || []).forEach((row) => {
    const resultText = String(row.bid_result || '').trim();
    const result: MyStatisticsBid['result'] = /낙찰|성공/.test(resultText)
      ? 'won'
      : /취소|취하|변경/.test(resultText)
        ? 'cancelled'
        : /실패|패찰/.test(resultText)
          ? 'lost'
          : 'pending';
    bids.push({
      source: 'historical', sourceId: row.id, userId: target.id, bidDate: row.bid_date,
      court: row.court, caseNumber: row.case_number, itemNumber: row.item_number,
      propertyType: row.property_type || '미분류', result,
    });
  });

  const legacyTable = await c.env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'freelancer_bid_entries'").first();
  if (legacyTable) {
    const legacyConditions: string[] = [];
    const legacyParams: unknown[] = [];
    if (from) { legacyConditions.push('bid_date >= ?'); legacyParams.push(from); }
    legacyConditions.push('bid_date <= ?'); legacyParams.push(effectiveTo);
    const legacyDateSql = legacyConditions.length ? ` AND ${legacyConditions.join(' AND ')}` : '';
    const legacyRows = await c.env.DB.prepare(`
      SELECT id, user_id, bid_date, court, case_number, item_no, property_type, bid_result
      FROM freelancer_bid_entries
      WHERE user_id = ?${legacyDateSql}
    `).bind(target.id, ...legacyParams).all<any>();
    (legacyRows.results || []).forEach((row) => {
      const resultText = String(row.bid_result || '').trim();
      const result: MyStatisticsBid['result'] = /낙찰|성공/.test(resultText)
        ? 'won'
        : /취소|취하|변경/.test(resultText)
          ? 'cancelled'
          : /실패|패찰/.test(resultText)
            ? 'lost'
            : 'pending';
      bids.push({
        source: 'legacy', sourceId: row.id, userId: row.user_id,
        bidDate: String(row.bid_date || '').slice(0, 10), court: String(row.court || ''),
        caseNumber: String(row.case_number || ''), itemNumber: String(row.item_no || ''),
        propertyType: String(row.property_type || '').trim() || '미분류', result,
      });
    });
  }

  const salesRows = await c.env.DB.prepare(`
    SELECT external_id, journal_entry_id, amount, status, contract_date,
      COALESCE(${recognizedSalesDateSql('sales_records')}, contract_date) AS revenue_date,
      CASE
        WHEN ${confirmedSalesSql('sales_records')} THEN 'confirmed'
        WHEN status = 'refunded' THEN 'refunded'
        ELSE 'pending'
      END AS revenue_state
    FROM sales_records
    WHERE user_id = ? AND type = '낙찰'
      AND COALESCE(direction, 'income') != 'expense'
      AND COALESCE(exclude_from_count, 0) = 0
      AND (TRIM(COALESCE(external_id, '')) != '' OR TRIM(COALESCE(journal_entry_id, '')) != '')
  `).bind(target.id).all<{
    external_id: string | null;
    journal_entry_id: string | null;
    amount: number;
    status: string;
    contract_date: string;
    revenue_date: string;
    revenue_state: 'confirmed' | 'pending' | 'refunded';
  }>();
  const saleByExternalId = new Map<string, (typeof salesRows.results)[number]>();
  const saleByJournalId = new Map<string, (typeof salesRows.results)[number]>();
  (salesRows.results || []).forEach((sale) => {
    if (sale.external_id) saleByExternalId.set(sale.external_id, sale);
    if (sale.journal_entry_id) saleByJournalId.set(sale.journal_entry_id, sale);
  });
  bids.forEach((bid) => {
    const sale = bid.source === 'schedule'
      ? saleByExternalId.get(`auction-schedule:${bid.sourceId}`) || saleByExternalId.get(`auction_schedule:${bid.sourceId}`)
      : bid.source === 'legacy'
        ? saleByExternalId.get(`freelancer-bid:${bid.sourceId}`)
        : bid.source === 'journal'
          ? saleByJournalId.get(bid.sourceId)
          : undefined;
    if (!sale) {
      if (bid.result === 'won') bid.revenueState = 'missing';
      return;
    }
    bid.revenueAmount = Number(sale.amount) || 0;
    bid.revenueDate = String(sale.revenue_date || sale.contract_date || '').slice(0, 10);
    bid.revenueState = sale.revenue_state;
  });

  const canonicalBids = dedupeMyStatisticsBids(bids);
  const statistics = buildMyStatistics(canonicalBids, effectiveTo);
  const dated = canonicalBids.map((bid) => bid.bidDate).filter(Boolean).sort();
  return c.json({
    ...statistics,
    coverage: {
      historical_bid_file: (historyRows.results || []).length > 0,
      historical_bid_count: statistics.source_counts.historical,
      price_from_myoffice_only: true,
      revenue_from_myoffice_only: true,
      linked_revenue_record_count: (salesRows.results || []).length,
    },
    viewer_can_select_user: canViewAll,
    selected_user: target,
    users: canViewAll ? await loadEligibleUsers(c.env.DB) : [],
    period: { from: from || dated[0] || '', to: effectiveTo },
  });
});

export default route;
