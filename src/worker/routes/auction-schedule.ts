import { Hono } from 'hono';
import type { AuthEnv } from '../types';
import { authMiddleware, requireHumanUser } from '../middleware/auth';
import { getAdminVisibleBranches } from '../lib/branch-approval-overrides';
import { isHeadOfficeBranch, normalizeBranchName, sameBranchName } from '../lib/branchAliases';
import { sendAlimtalkByTemplate, APP_URL } from '../alimtalk';
import {
  auctionScheduleBidResultMissingFields,
  auctionScheduleSalesExternalId,
  calculateAuctionScheduleWinningFee,
  canViewResignedAuctionHistory,
  canViewSuggestedBidPrice,
  getAuctionScheduleValidationError,
  isAuctionScheduleBidResultDue,
  isAuctionScheduleActivityType,
  redactSuggestedBidPrice,
  sanitizeAuctionScheduleData,
} from '../../shared/auction-schedule';
import { normalizeWonSalesInput } from '../../shared/freelancer-bid-sales';
import { canSelectAuctionScheduleBranch, normalizeAuctionScheduleBranchFilter } from '../../shared/auction-schedule-branch';
import { isValidCustomerPhone } from '../../shared/sales-customer-identity';
import { linkSalesCustomerCase, resolveSalesCustomer } from '../lib/sales-customer-master';
import { ensureBidAnalysisTable, normalizeAmount, upsertBidAnalysisEntry } from '../lib/bid-analysis';
import { ensureAuctionScheduleTable } from '../lib/auction-schedule-schema';
import { findCanonicalBidSale, type LinkedBidSale } from '../lib/performance-activity';
import { DEFAULT_COMPANY_HOLIDAYS } from '../../shared/work-calendar';
import { loadSystemHolidayDates } from '../lib/system-holidays';
import { findAuctionInspectionSuggestions } from '../lib/auction-schedule-inspection-suggestions';

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

function isDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function canWrite(user: AuthEnv['Variables']['user'], ownerId: string): boolean {
  return user.role === 'master' || (user.login_type === 'freelancer' && user.sub === ownerId);
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
  if (!isDate(start) || !isDate(end) || start > end) {
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
  if (user.role !== 'master') return c.json({ error: '마스터만 대리 등록 담당자를 조회할 수 있습니다.' }, 403);
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
  if (user.role !== 'master' && user.login_type !== 'freelancer') {
    return c.json({ error: '경매 스케줄 자동채우기는 마스터 또는 프리랜서만 사용할 수 있습니다.' }, 403);
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
  if (user.role !== 'master' && user.login_type !== 'freelancer') {
    return c.json({ error: '경매 스케줄 작성은 마스터 또는 프리랜서만 가능합니다.' }, 403);
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
  if (!isDate(targetDate) || !isAuctionScheduleActivityType(activityType)) {
    return c.json({ error: '날짜와 활동유형(입찰·임장)을 확인해 주세요.' }, 400);
  }
  const rawData = sanitizeAuctionScheduleData(body.data);
  const data = activityType === '입찰'
    ? { ...rawData, bidWon: false, bidFailed: false, bidCancelled: false, bidResultCancelled: false, winPrice: '' }
    : rawData;
  const validationError = getAuctionScheduleValidationError(activityType, data);
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
      AND COALESCE(login_type, 'employee') = 'freelancer'
    LIMIT 1
  `).bind(ownerId).first<{ id: string; branch: string; department: string }>();
  if (!owner) return c.json({ error: '활성 프리랜서 담당자를 찾을 수 없습니다.' }, 400);
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

auctionSchedule.put('/:id', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  await ensureAuctionScheduleTable(db);
  await ensureAuctionScheduleResultSchema(db);
  const id = c.req.param('id');
  const existing = await db.prepare('SELECT * FROM freelancer_auction_schedules WHERE id = ?').bind(id).first<any>();
  if (!existing) return c.json({ error: '경매 스케줄을 찾을 수 없습니다.' }, 404);
  if (!canWrite(user, existing.user_id)) return c.json({ error: '본인의 경매 스케줄만 수정할 수 있습니다.' }, 403);
  const linkedSale = await db.prepare('SELECT id FROM sales_records WHERE external_id = ?')
    .bind(auctionScheduleSalesExternalId(id))
    .first<{ id: string }>();
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
  if (!isDate(targetDate) || !isAuctionScheduleActivityType(activityType)) {
    return c.json({ error: '날짜와 활동유형(입찰·임장)을 확인해 주세요.' }, 400);
  }
  const existingData = parseJsonObject(existing.data);
  const incomingData = body.data === undefined
    ? parseJsonObject(existing.data)
    : sanitizeAuctionScheduleData(body.data);
  const parsedData = activityType === '입찰'
    ? {
      ...incomingData,
      bidWon: existing.activity_type === '입찰' ? !!existingData.bidWon : false,
      bidFailed: existing.activity_type === '입찰' ? !!existingData.bidFailed : false,
      bidCancelled: existing.activity_type === '입찰' ? !!existingData.bidCancelled : false,
      bidResultCancelled: existing.activity_type === '입찰' ? !!existingData.bidResultCancelled : false,
      bidResultCancelledAutomatically: existing.activity_type === '입찰' ? !!existingData.bidResultCancelledAutomatically : false,
      bidResultCancelledAt: existing.activity_type === '입찰' ? String(existingData.bidResultCancelledAt || '') : '',
      winPrice: existing.activity_type === '입찰' ? String(existingData.winPrice || '') : '',
    }
    : incomingData;
  const data = JSON.stringify(parsedData);
  const validationError = getAuctionScheduleValidationError(activityType, parsedData);
  if (validationError) return c.json({ error: validationError }, 400);
  await db.prepare(`
    UPDATE freelancer_auction_schedules
    SET target_date = ?, activity_type = ?, activity_subtype = ?, data = ?, updated_at = datetime('now', '+9 hours')
    WHERE id = ?
  `).bind(
    targetDate,
    activityType,
    body.activity_subtype === undefined ? existing.activity_subtype : String(body.activity_subtype).slice(0, 200),
    data,
    id,
  ).run();
  return c.json({ success: true });
});

auctionSchedule.put('/:id/bid-prices', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  await ensureAuctionScheduleTable(db);
  await ensureAuctionScheduleResultSchema(db);
  const id = c.req.param('id');
  const existing = await db.prepare(`
    SELECT s.*, u.name AS user_name
    FROM freelancer_auction_schedules s
    JOIN users u ON u.id = s.user_id
    WHERE s.id = ?
  `).bind(id).first<any>();
  if (!existing) return c.json({ error: '경매 스케줄을 찾을 수 없습니다.' }, 404);
  if (!canWrite(user, existing.user_id)) return c.json({ error: '본인의 입찰가만 작성할 수 있습니다.' }, 403);
  if (existing.activity_type !== '입찰') return c.json({ error: '입찰 일정만 입찰가를 작성할 수 있습니다.' }, 400);
  const linkedSale = await db.prepare('SELECT id FROM sales_records WHERE external_id = ?')
    .bind(auctionScheduleSalesExternalId(id)).first<{ id: string }>();
  if (linkedSale) return c.json({ error: '입금신청이 연결된 낙찰 건의 입찰가는 변경할 수 없습니다.' }, 409);

  const body = await c.req.json<{ suggested_price?: number; actual_bid_price?: number; winning_price?: number }>();
  const suggestedPrice = normalizeAmount(body.suggested_price);
  const actualBidPrice = normalizeAmount(body.actual_bid_price);
  const winningPrice = normalizeAmount(body.winning_price);
  if (!suggestedPrice && !actualBidPrice && !winningPrice) {
    return c.json({ error: '제안입찰가·작성입찰가·최종 낙찰가 중 하나 이상 입력해 주세요.' }, 400);
  }
  const data = parseJsonObject(existing.data);
  const nextData = {
    ...data,
    suggestedPrice: suggestedPrice ? String(suggestedPrice) : '',
    bidPrice: actualBidPrice ? String(actualBidPrice) : '',
    winPrice: winningPrice ? String(winningPrice) : '',
  };
  await db.prepare(`UPDATE freelancer_auction_schedules SET data = ?, updated_at = datetime('now', '+9 hours') WHERE id = ?`)
    .bind(JSON.stringify(nextData), id).run();

  if (data.bidFailed) {
    const externalId = auctionScheduleSalesExternalId(id);
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
      client_name: String(data.bidder || data.client || ''),
      source_type: 'freelancer',
      source_id: externalId,
      uploaded_by: existing.user_id,
    });
  }
  return c.json({ success: true, missing_fields: auctionScheduleBidResultMissingFields(nextData) });
});

auctionSchedule.post('/:id/bid-result', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  await ensureAuctionScheduleTable(db);
  await ensureAuctionScheduleResultSchema(db);
  const id = c.req.param('id');
  const existing = await db.prepare(`
    SELECT s.*, u.name AS user_name
    FROM freelancer_auction_schedules s
    JOIN users u ON u.id = s.user_id
    WHERE s.id = ?
  `).bind(id).first<any>();
  if (!existing) return c.json({ error: '경매 스케줄을 찾을 수 없습니다.' }, 404);
  if (!canWrite(user, existing.user_id)) return c.json({ error: '본인의 입찰 결과만 처리할 수 있습니다.' }, 403);
  if (existing.activity_type !== '입찰') return c.json({ error: '입찰 일정만 결과를 처리할 수 있습니다.' }, 400);

  const body = await c.req.json<{
    result?: 'won' | 'failed' | 'withdrawn' | 'cancelled' | 'pending';
    suggested_price?: number;
    actual_bid_price?: number;
    winning_price?: number;
    client_phone?: string;
  }>();
  const result = String(body.result || '');
  if (!['won', 'failed', 'withdrawn', 'cancelled', 'pending'].includes(result)) return c.json({ error: '입찰 결과를 확인해 주세요.' }, 400);

  const data = parseJsonObject(existing.data);
  const externalId = auctionScheduleSalesExternalId(id);
  const linkedSale = await findCanonicalBidSale(
    db,
    externalId,
    existing.user_id,
    existing.target_date,
    String(data.caseNo || ''),
  );
  const linkedCommissionKeys = linkedSale?.source === 'legacy'
    ? [externalId, linkedSale.external_id]
    : [externalId, externalId];
  const linkedCommission = await db.prepare(`
    SELECT id, status, win_price FROM commissions WHERE journal_entry_id = ?
       OR journal_entry_id = ?
    ORDER BY CASE WHEN journal_entry_id = ? THEN 0 ELSE 1 END
    LIMIT 1
  `).bind(linkedCommissionKeys[0], linkedCommissionKeys[1], externalId)
    .first<{ id: string; status: string; win_price: string }>();

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
      await db.prepare(`UPDATE freelancer_auction_schedules SET data = ?, updated_at = datetime('now', '+9 hours') WHERE id = ?`)
        .bind(nextData, id).run();
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
        client_name: String(data.bidder || data.client || ''),
        source_type: 'freelancer',
        source_id: externalId,
        uploaded_by: existing.user_id,
      });
      return c.json({ success: true, sales_record_id: null, sales_status: null });
    }
    const normalized = normalizeWonSalesInput({
      actual_bid_price: winningPrice,
      sales_amount: calculateAuctionScheduleWinningFee(winningPrice),
      depositor_name: String(data.bidder || data.client || ''),
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
          name: String(data.bidder || data.client || ''),
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
    const statements = [
      db.prepare(`UPDATE freelancer_auction_schedules SET data = ?, updated_at = datetime('now', '+9 hours') WHERE id = ?`)
        .bind(nextData, id),
    ];
    if (!linkedSale) {
      statements.push(db.prepare(`
        INSERT OR IGNORE INTO sales_records (
          id, user_id, type, type_detail, client_name, depositor_name, depositor_different,
          amount, contract_date, status, direction, branch, department, payment_type,
          winning_price, client_phone, customer_id, memo, external_id
        ) VALUES (?, ?, '낙찰', ?, ?, ?, ?, ?, ?, 'pending', 'income', ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        salesId,
        existing.user_id,
        [data.court, data.caseNo, data.itemNo ? `${data.itemNo}번` : ''].filter(Boolean).join(' · '),
        String(data.bidder || data.client || ''),
        normalized.depositor_name,
        normalized.depositor_name !== String(data.bidder || data.client || '') ? 1 : 0,
        normalized.sales_amount,
        existing.target_date,
        existing.branch || '',
        existing.department || '',
        normalized.payment_type,
        normalized.winning_price,
        clientPhone,
        customer?.id || null,
        '경매 스케줄 낙찰 자동 입금신청',
        externalId,
      ));
    } else if (customer) {
      statements.push(db.prepare("UPDATE sales_records SET client_phone = ?, customer_id = ? WHERE id = ?")
        .bind(clientPhone, customer.id, linkedSale.id));
    }
    if (!linkedCommission) {
      statements.push(db.prepare(`
        INSERT INTO commissions (id, journal_entry_id, user_id, user_name, client_name, case_no, win_price)
        SELECT ?, ?, ?, ?, ?, ?, ?
        WHERE NOT EXISTS (SELECT 1 FROM commissions WHERE journal_entry_id = ?)
      `).bind(
        crypto.randomUUID(), externalId, existing.user_id, existing.user_name || '',
        String(data.bidder || data.client || ''), String(data.caseNo || ''),
        String(normalized.sales_amount), externalId,
      ));
    }
    await db.batch(statements);
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
      client_name: String(data.bidder || data.client || ''),
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
  const statements = [
    db.prepare(`UPDATE freelancer_auction_schedules SET data = ?, updated_at = datetime('now', '+9 hours') WHERE id = ?`).bind(nextData, id),
    db.prepare("DELETE FROM commissions WHERE journal_entry_id = ? AND status = 'pending'").bind(externalId),
  ];
  if (result === 'pending' && linkedSale?.source === 'schedule') {
    statements.push(db.prepare("DELETE FROM sales_records WHERE id = ? AND status = 'pending'").bind(linkedSale.id));
    statements.push(db.prepare(`
      INSERT INTO accounting_activity_logs (
        id, actor_id, actor_name, actor_role, action, target_type, target_id,
        target_label, diff_summary, before_snapshot, source_page, created_at
      ) VALUES (?, ?, ?, ?, 'delete', 'sales_record', ?, ?, ?, ?, 'auction_schedule', datetime('now', '+9 hours'))
    `).bind(
      crypto.randomUUID(), user.sub, user.name || '', user.role, linkedSale.id,
      `[${existing.user_name || ''}] 경매 스케줄 낙찰 입금신청`,
      '경매 스케줄 낙찰 취소로 대기 중 입금신청 삭제',
      JSON.stringify(linkedSale),
    ));
  }
  await db.batch(statements);
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
      client_name: String(data.bidder || data.client || ''),
      source_type: 'freelancer',
      source_id: externalId,
      uploaded_by: existing.user_id,
    });
  }
  return c.json({ success: true, sales_record_id: null, sales_status: null });
});

auctionSchedule.delete('/:id', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  await ensureAuctionScheduleTable(db);
  await ensureAuctionScheduleResultSchema(db);
  const id = c.req.param('id');
  const existing = await db.prepare('SELECT user_id FROM freelancer_auction_schedules WHERE id = ?').bind(id).first<{ user_id: string }>();
  if (!existing) return c.json({ error: '경매 스케줄을 찾을 수 없습니다.' }, 404);
  if (!canWrite(user, existing.user_id)) return c.json({ error: '본인의 경매 스케줄만 삭제할 수 있습니다.' }, 403);
  const externalId = auctionScheduleSalesExternalId(id);
  const linkedSale = await db.prepare('SELECT id FROM sales_records WHERE external_id = ?').bind(externalId).first<{ id: string }>();
  if (linkedSale) return c.json({ error: '입금신청이 연결된 일정은 삭제할 수 없습니다. 업무성과의 환불·취소 절차를 먼저 처리하세요.' }, 409);
  await db.prepare('DELETE FROM freelancer_auction_schedules WHERE id = ?').bind(id).run();
  await db.prepare("DELETE FROM bid_analysis_entries WHERE source_type = 'freelancer' AND source_id = ?").bind(externalId).run();
  return c.json({ success: true });
});

export default auctionSchedule;
