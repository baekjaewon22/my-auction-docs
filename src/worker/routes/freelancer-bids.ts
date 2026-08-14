import { Hono } from 'hono';
import type { AuthEnv } from '../types';
import { authMiddleware } from '../middleware/auth';
import { normalizeBranchName } from '../lib/branchAliases';
import { ensureAuctionScheduleTable } from '../lib/auction-schedule-schema';

const freelancerBids = new Hono<AuthEnv>();
freelancerBids.use('*', authMiddleware);
const freelancerBidSchemaPromises = new WeakMap<object, Promise<void>>();

type FreelancerBidRow = {
  id: string;
  user_id: string;
  owner_name?: string;
  owner_branch?: string;
  owner_department?: string;
  owner_position_title?: string;
  can_edit?: number;
  can_delete?: number;
  bid_date: string;
  court: string;
  case_number: string;
  item_no: string;
  client_name: string;
  bidder_name: string;
  property_type: string;
  suggested_price: number | null;
  actual_bid_price: number | null;
  winning_price: number | null;
  bid_result: string;
  deviation_reason: string;
  created_at: string;
  updated_at: string;
  sales_record_id?: string;
  sales_status?: string;
  sales_amount?: number;
  source_type?: 'legacy' | 'auction_schedule';
  source_id?: string;
  schedule_id?: string;
};

function parseScheduleData(value: unknown): Record<string, any> {
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function scheduleAmount(value: unknown): number | null {
  const amount = Number(String(value || '').replace(/[^0-9]/g, ''));
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount) : null;
}

function scheduleBidResult(data: Record<string, any>): string {
  if (data.bidCancelled) return '취소';
  if (data.bidWon) return '낙찰';
  if (data.bidFailed) return '실패';
  return '대기';
}

function bidIdentityKey(userId: unknown, bidDate: unknown, caseNumber: unknown): string {
  const normalizedCase = String(caseNumber || '').trim().replace(/\s+/g, '').toLowerCase();
  if (!normalizedCase) return '';
  return `${String(userId || '')}|${String(bidDate || '').slice(0, 10)}|${normalizedCase}`;
}

async function ensureFreelancerBidTable(db: D1Database): Promise<void> {
  const key = db as object;
  const existing = freelancerBidSchemaPromises.get(key);
  if (existing) return existing;
  const promise = (async () => {
    await db.prepare(`
    CREATE TABLE IF NOT EXISTS freelancer_bid_entries (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      bid_date TEXT NOT NULL,
      court TEXT NOT NULL DEFAULT '',
      case_number TEXT NOT NULL DEFAULT '',
      item_no TEXT NOT NULL DEFAULT '',
      client_name TEXT NOT NULL DEFAULT '',
      bidder_name TEXT NOT NULL DEFAULT '',
      property_type TEXT NOT NULL DEFAULT '',
      suggested_price INTEGER,
      actual_bid_price INTEGER,
      winning_price INTEGER,
      bid_result TEXT NOT NULL DEFAULT '실패',
      deviation_reason TEXT NOT NULL DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', '+9 hours')),
      updated_at TEXT DEFAULT (datetime('now', '+9 hours')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_freelancer_bid_user ON freelancer_bid_entries(user_id)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_freelancer_bid_date ON freelancer_bid_entries(bid_date)').run();
  const salesColumns = await db.prepare('PRAGMA table_info(sales_records)').all<{ name: string }>();
  const salesColumnNames = new Set((salesColumns.results || []).map((column) => column.name));
  if (!salesColumnNames.has('external_id')) {
    await db.prepare('ALTER TABLE sales_records ADD COLUMN external_id TEXT').run();
  }
  if (!salesColumnNames.has('winning_price')) {
    await db.prepare('ALTER TABLE sales_records ADD COLUMN winning_price INTEGER NOT NULL DEFAULT 0').run();
  }
    await db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_records_external_id ON sales_records(external_id) WHERE external_id IS NOT NULL').run();
  })();
  freelancerBidSchemaPromises.set(key, promise);
  try {
    await promise;
  } catch (error) {
    freelancerBidSchemaPromises.delete(key);
    throw error;
  }
}

const BID_ADMIN_ROLES = ['master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst'];

function requireFreelancer(user: any) {
  return user?.login_type === 'freelancer' || user?.role === 'freelancer';
}

function canViewFreelancerBids(user: any) {
  return user?.role === 'master' || (!requireFreelancer(user) && BID_ADMIN_ROLES.includes(user?.role));
}

function canManageFreelancerBids(user: any) {
  return user?.role === 'master' || (!requireFreelancer(user) && BID_ADMIN_ROLES.includes(user?.role));
}

freelancerBids.get('/', async (c) => {
  const user = c.get('user');
  if (!canViewFreelancerBids(user)) return c.json({ error: '입찰 내역 열람 권한이 없습니다.' }, 403);
  const db = c.env.DB;
  await ensureFreelancerBidTable(db);
  await ensureAuctionScheduleTable(db);

  const branch = normalizeBranchName(c.req.query('branch') || '');
  const assignee = String(c.req.query('assignee') || '').trim();

  const legacyWhere: string[] = [];
  const legacyParams: unknown[] = [];
  const scheduleWhere: string[] = ["s.activity_type = '입찰'"];
  const scheduleParams: unknown[] = [];
  if (branch) {
    legacyWhere.push("COALESCE(u.branch, '') = ?");
    legacyParams.push(branch);
    scheduleWhere.push("COALESCE(u.branch, '') = ?");
    scheduleParams.push(branch);
  }
  if (assignee) {
    legacyWhere.push('f.user_id = ?');
    legacyParams.push(assignee);
    scheduleWhere.push('s.user_id = ?');
    scheduleParams.push(assignee);
  }

  const legacyRows = await db.prepare(`
    SELECT f.*, u.name AS owner_name, u.branch AS owner_branch, u.department AS owner_department,
      u.position_title AS owner_position_title,
      sr.id AS sales_record_id, sr.status AS sales_status, sr.amount AS sales_amount,
      0 AS can_edit, 0 AS can_delete
    FROM freelancer_bid_entries f
    LEFT JOIN users u ON u.id = f.user_id
    LEFT JOIN sales_records sr ON sr.external_id = 'freelancer-bid:' || f.id
    ${legacyWhere.length ? `WHERE ${legacyWhere.join(' AND ')}` : ''}
  `).bind(...legacyParams).all<FreelancerBidRow>();

  const scheduleRows = await db.prepare(`
    SELECT s.*, u.name AS owner_name, u.branch AS owner_branch, u.department AS owner_department,
      u.position_title AS owner_position_title,
      sr.id AS sales_record_id, sr.status AS sales_status, sr.amount AS sales_amount
    FROM freelancer_auction_schedules s
    LEFT JOIN users u ON u.id = s.user_id
    LEFT JOIN sales_records sr ON sr.external_id = 'auction-schedule:' || s.id
    WHERE ${scheduleWhere.join(' AND ')}
  `).bind(...scheduleParams).all<any>();

  const rawLegacyRows = legacyRows.results || [];
  const rawScheduleRows = scheduleRows.results || [];
  const scheduleKeys = new Set(rawScheduleRows.map((row) => {
    const data = parseScheduleData(row.data);
    return bidIdentityKey(row.user_id, row.target_date, data.caseNo || row.activity_subtype);
  }).filter(Boolean));
  const legacySaleByKey = new Map<string, FreelancerBidRow>();
  rawLegacyRows.forEach((row) => {
    const key = bidIdentityKey(row.user_id, row.bid_date, row.case_number);
    if (key && row.sales_record_id && !legacySaleByKey.has(key)) legacySaleByKey.set(key, row);
  });

  const rows: FreelancerBidRow[] = [
    ...rawLegacyRows.filter((row) => {
      const key = bidIdentityKey(row.user_id, row.bid_date, row.case_number);
      return !key || !scheduleKeys.has(key);
    }).map((row) => ({
      ...row,
      source_type: 'legacy' as const,
      source_id: row.id,
    })),
    ...rawScheduleRows.map((row) => {
      const data = parseScheduleData(row.data);
      const legacySale = legacySaleByKey.get(bidIdentityKey(
        row.user_id,
        row.target_date,
        data.caseNo || row.activity_subtype,
      ));
      return {
        id: `auction-schedule:${row.id}`,
        user_id: row.user_id,
        owner_name: row.owner_name,
        owner_branch: row.owner_branch,
        owner_department: row.owner_department,
        owner_position_title: row.owner_position_title,
        can_edit: 0,
        can_delete: 0,
        bid_date: row.target_date,
        court: String(data.court || ''),
        case_number: String(data.caseNo || row.activity_subtype || ''),
        item_no: String(data.itemNo || data.item_no || ''),
        client_name: String(data.client || data.bidder || ''),
        bidder_name: String(data.bidder || data.client || ''),
        property_type: String(data.propertyType || ''),
        suggested_price: scheduleAmount(data.suggestedPrice),
        actual_bid_price: scheduleAmount(data.bidPrice),
        winning_price: scheduleAmount(data.winPrice),
        bid_result: scheduleBidResult(data),
        deviation_reason: '',
        created_at: row.created_at,
        updated_at: row.updated_at,
        sales_record_id: row.sales_record_id || legacySale?.sales_record_id,
        sales_status: row.sales_status || legacySale?.sales_status,
        sales_amount: row.sales_amount ?? legacySale?.sales_amount,
        source_type: 'auction_schedule' as const,
        source_id: row.id,
        schedule_id: row.id,
      };
    }),
  ].sort((left, right) =>
    String(right.bid_date).localeCompare(String(left.bid_date))
      || String(right.updated_at || '').localeCompare(String(left.updated_at || ''))
  );

  const branches = (await db.prepare(`
        SELECT DISTINCT branch FROM (
          SELECT COALESCE(u.branch, '') AS branch
          FROM freelancer_bid_entries f LEFT JOIN users u ON u.id = f.user_id
          UNION ALL
          SELECT COALESCE(u.branch, '') AS branch
          FROM freelancer_auction_schedules s LEFT JOIN users u ON u.id = s.user_id
          WHERE s.activity_type = '입찰'
        ) WHERE branch <> ''
        ORDER BY branch
      `).all<{ branch: string }>()).results || [];
  const assignees = (await db.prepare(`
        SELECT DISTINCT id, name, branch FROM (
          SELECT f.user_id AS id, COALESCE(u.name, f.bidder_name, '') AS name,
            COALESCE(u.branch, '') AS branch, COALESCE(u.department, '') AS department
          FROM freelancer_bid_entries f LEFT JOIN users u ON u.id = f.user_id
          UNION ALL
          SELECT s.user_id AS id, COALESCE(u.name, '') AS name,
            COALESCE(u.branch, '') AS branch, COALESCE(u.department, '') AS department
          FROM freelancer_auction_schedules s LEFT JOIN users u ON u.id = s.user_id
          WHERE s.activity_type = '입찰'
        )
        ORDER BY name
      `).all<{ id: string; name: string; branch: string }>()).results || [];

  return c.json({ rows, filters: { branches, assignees } });
});

freelancerBids.post('/', async (c) => {
  const user = c.get('user');
  if (!requireFreelancer(user)) return c.json({ error: '프리랜서 전용 메뉴입니다.' }, 403);
  return c.json({
    error: '신규 입찰은 경매 스케줄에서 등록해 주세요. 입찰 내역은 조회 전용입니다.',
    redirect_to: '/auction-schedule',
  }, 409);
});

freelancerBids.put('/:id', async (c) => {
  const user = c.get('user');
  if (!canViewFreelancerBids(user)) return c.json({ error: '입찰 내역 수정 권한이 없습니다.' }, 403);
  return c.json({
    error: '입찰 내역은 과거 기록 보존을 위한 조회 전용입니다. 경매 스케줄에서 처리해 주세요.',
    redirect_to: '/auction-schedule',
  }, 409);
  /* legacy mutation path retained temporarily for migration reference
  const db = c.env.DB;
  await ensureFreelancerBidTable(db);
  await ensureBidAnalysisTable(db);
  const id = c.req.param('id');
  const current = await findBidRow(db, id);
  if (!current) return c.json({ error: '입찰 내역을 찾을 수 없습니다.' }, 404);
  const adminEdit = canManageFreelancerBids(user);
  const ownerEdit = current.user_id === user.sub && isOwnerWithinEditWindow(current);
  if (!adminEdit && !ownerEdit) {
    return c.json({ error: '담당자는 최종작성일 이후 7일까지만 수정할 수 있습니다.' }, 403);
  }

  const payload = normalizePayload(await c.req.json());
  if (!payload.bid_date) return c.json({ error: '입찰일을 입력하세요.' }, 400);
  if (!payload.case_number) return c.json({ error: '사건번호를 입력하세요.' }, 400);
  if (!payload.client_name) return c.json({ error: '고객명을 입력하세요.' }, 400);
  if (!payload.property_type) return c.json({ error: '물건종류를 선택하세요.' }, 400);
  if (payload.bid_result === '낙찰' && current.bid_result !== '낙찰') {
    return c.json({ error: '최초 낙찰 처리는 낙찰 수수료 매출액과 함께 등록해야 합니다.' }, 409);
  }
  if (current.sales_record_id && payload.bid_result !== '낙찰') {
    return c.json({ error: '입금신청이 연결된 낙찰 건은 결과를 직접 변경할 수 없습니다. 매출 환불·취소 절차를 이용하세요.' }, 409);
  }

  await db.prepare(`
    UPDATE freelancer_bid_entries
    SET bid_date = ?, court = ?, case_number = ?, item_no = ?, client_name = ?,
      bidder_name = ?, property_type = ?, suggested_price = ?, actual_bid_price = ?,
      winning_price = ?, bid_result = ?, deviation_reason = ?, updated_at = ${KST_NOW_SQL}
    WHERE id = ? AND user_id = ?
  `).bind(
    payload.bid_date, payload.court, payload.case_number, payload.item_no, payload.client_name,
    payload.bidder_name, payload.property_type, payload.suggested_price, payload.actual_bid_price,
    payload.winning_price, payload.bid_result, payload.deviation_reason, id, current.user_id,
  ).run();

  const row = await findBidRow(db, id);
  if (row) await syncToBidAnalysis(db, row, user);
  return c.json({ success: true });
  */
});

// POST /api/freelancer-bids/:id/mark-won - 낙찰과 회사 수수료 매출 입금신청을 원자적으로 등록
freelancerBids.post('/:id/mark-won', async (c) => {
  const user = c.get('user');
  if (!requireFreelancer(user)) return c.json({ error: '프리랜서 전용 기능입니다.' }, 403);
  return c.json({
    error: '낙찰 처리는 경매 스케줄에서만 가능합니다. 입찰 내역은 조회 전용입니다.',
    redirect_to: '/auction-schedule',
  }, 409);
  /* legacy mutation path retained temporarily for migration reference
  const db = c.env.DB;
  await ensureFreelancerBidTable(db);
  await ensureBidAnalysisTable(db);
  const id = c.req.param('id');
  const current = await findBidRow(db, id);
  if (!current) return c.json({ error: '입찰 내역을 찾을 수 없습니다.' }, 404);
  if (current.user_id !== user.sub) return c.json({ error: '본인 입찰 건만 낙찰 처리할 수 있습니다.' }, 403);
  if (!isOwnerWithinEditWindow(current)) return c.json({ error: '최종 작성 후 7일이 지난 입찰 건은 수정할 수 없습니다.' }, 403);

  const body = await c.req.json<{
    actual_bid_price?: number;
    sales_amount?: number;
    depositor_name?: string;
    payment_type?: string;
  }>();
  const normalized = normalizeWonSalesInput({
    ...body,
    depositor_name: body.depositor_name || current.client_name,
  });
  if (!normalized) return c.json({ error: '부동산 낙찰가·회사 수수료 매출액·입금자명을 정확히 입력하세요.' }, 400);
  const winningPrice = normalized.winning_price;
  const salesAmount = normalized.sales_amount;
  const depositorName = normalized.depositor_name;
  const paymentType = normalized.payment_type;

  const externalId = freelancerBidSalesExternalId(id);
  const existingSale = await db.prepare(`
    SELECT id, status, amount, winning_price
    FROM sales_records
    WHERE external_id = ?
  `).bind(externalId).first<{ id: string; status: string; amount: number; winning_price: number }>();
  if (existingSale) {
    if (Number(existingSale.amount) !== salesAmount || Number(existingSale.winning_price) !== winningPrice) {
      return c.json({ error: '이미 연결된 입금신청이 있습니다. 금액 변경은 업무성과에서 확인하세요.', sales_record_id: existingSale.id }, 409);
    }
    return c.json({ success: true, sales_record_id: existingSale.id, sales_status: existingSale.status, idempotent: true });
  }

  const salesId = crypto.randomUUID();
  const detail = [current.court, current.case_number, current.item_no ? `${current.item_no}번` : ''].filter(Boolean).join(' · ');
  const batchResults = await db.batch([
    db.prepare(`
      UPDATE freelancer_bid_entries
      SET actual_bid_price = ?, winning_price = ?, bid_result = '낙찰', deviation_reason = '', updated_at = ${KST_NOW_SQL}
      WHERE id = ? AND user_id = ? AND bid_result <> '낙찰'
        AND datetime(updated_at, '+7 days') >= ${KST_NOW_SQL}
    `).bind(winningPrice, winningPrice, id, user.sub),
    db.prepare(`
      INSERT OR IGNORE INTO sales_records (
        id, user_id, type, type_detail, client_name, depositor_name, depositor_different,
        amount, contract_date, status, direction, branch, department, payment_type,
        winning_price, memo, external_id
      )
      SELECT ?, f.user_id, '낙찰', ?, f.client_name, ?,
             CASE WHEN ? <> f.client_name THEN 1 ELSE 0 END,
             ?, f.bid_date, 'pending', 'income', COALESCE(u.branch, ''), COALESCE(u.department, ''),
             ?, ?, '프리랜서 입찰 낙찰 자동 입금신청', ?
      FROM freelancer_bid_entries f
      LEFT JOIN users u ON u.id = f.user_id
      WHERE f.id = ? AND f.user_id = ? AND f.bid_result = '낙찰'
    `).bind(
      salesId, detail, depositorName, depositorName, salesAmount,
      paymentType, winningPrice, externalId, id, user.sub,
    ),
  ]);

  const sale = await db.prepare(`
    SELECT id, status FROM sales_records WHERE external_id = ?
  `).bind(externalId).first<{ id: string; status: string }>();
  if (!sale) return c.json({ error: '낙찰 입금신청을 생성하지 못했습니다. 다시 시도해주세요.' }, 409);

  const updated = await findBidRow(db, id);
  if (updated) await syncToBidAnalysis(db, updated, user);

  if (Number(batchResults[1]?.meta?.changes || 0) === 1 && current.owner_branch) {
    const accountants = await db.prepare(
      "SELECT phone, alimtalk_branches FROM users WHERE role IN ('accountant', 'accountant_asst') AND approved = 1 AND phone != ''"
    ).all<{ phone: string; alimtalk_branches: string }>();
    const phones = (accountants.results || [])
      .filter((row) => hasAlimtalkBranch(row.alimtalk_branches, current.owner_branch))
      .map((row) => row.phone)
      .filter(Boolean);
    if (phones.length > 0) {
      c.executionCtx.waitUntil(sendAlimtalkByTemplate(
        c.env as unknown as Record<string, unknown>,
        'DEPOSIT_CLAIM',
        {
          claimer_name: current.owner_name || user.name,
          depositor: depositorName,
          amount: salesAmount.toLocaleString('ko-KR'),
          deposit_date: current.bid_date,
          branch: current.owner_branch,
          link: `${APP_URL}/sales?focus=sales&id=${sale.id}`,
        },
        phones,
      ).catch(() => {}));
    }
  }

  return c.json({ success: true, sales_record_id: sale.id, sales_status: sale.status, idempotent: false });
  */
});

freelancerBids.delete('/:id', async (c) => {
  const user = c.get('user');
  if (!canManageFreelancerBids(user)) return c.json({ error: '입찰 내역 삭제 권한이 없습니다.' }, 403);
  return c.json({ error: '과거 입찰 기록은 삭제하지 않습니다. 경매 스케줄에서 현재 기록을 관리해 주세요.' }, 409);
  /* legacy deletion path retained temporarily for migration reference
  const db = c.env.DB;
  await ensureFreelancerBidTable(db);
  await ensureBidAnalysisTable(db);
  const id = c.req.param('id');
  const current = await db.prepare('SELECT id FROM freelancer_bid_entries WHERE id = ?').bind(id).first<{ id: string }>();
  if (!current) return c.json({ error: '입찰 내역을 찾을 수 없습니다.' }, 404);
  await db.prepare('DELETE FROM freelancer_bid_entries WHERE id = ?').bind(id).run();
  await db.prepare("DELETE FROM bid_analysis_entries WHERE source_type = 'freelancer' AND source_id = ?").bind(id).run();
  return c.json({ success: true });
  */
});

export default freelancerBids;
