import { Hono } from 'hono';
import type { AuthEnv } from '../types';
import { authMiddleware } from '../middleware/auth';
import { ensureBidAnalysisTable, normalizeAmount, normalizeBidResult, upsertBidAnalysisEntry } from '../lib/bid-analysis';

const KST_NOW_SQL = "datetime('now', '+9 hours')";

const freelancerBids = new Hono<AuthEnv>();
freelancerBids.use('*', authMiddleware);

type FreelancerBidRow = {
  id: string;
  user_id: string;
  owner_name?: string;
  owner_branch?: string;
  owner_department?: string;
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
};

async function ensureFreelancerBidTable(db: D1Database): Promise<void> {
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
}

const BID_ADMIN_ROLES = ['master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst'];

function requireFreelancer(user: any) {
  return user?.login_type === 'freelancer' || user?.role === 'freelancer';
}

function canViewFreelancerBids(user: any) {
  return requireFreelancer(user) || BID_ADMIN_ROLES.includes(user?.role);
}

function canManageFreelancerBids(user: any) {
  return !requireFreelancer(user) && BID_ADMIN_ROLES.includes(user?.role);
}

function isOwnerWithinEditWindow(row: FreelancerBidRow) {
  return Number(row.can_edit || 0) === 1;
}

function compactCaseNumber(value: unknown) {
  return String(value || '').trim().replace(/\s+/g, '');
}

function normalizeBidDate(value: unknown) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function normalizePayload(raw: any) {
  const bidResult = normalizeBidResult(raw?.bid_result);
  const actual = normalizeAmount(raw?.actual_bid_price);
  const winning = normalizeAmount(raw?.winning_price);
  return {
    bid_date: normalizeBidDate(raw?.bid_date),
    court: String(raw?.court || '').trim(),
    case_number: compactCaseNumber(raw?.case_number),
    item_no: String(raw?.item_no || '').trim(),
    client_name: String(raw?.client_name || '').trim(),
    bidder_name: String(raw?.bidder_name || '').trim(),
    property_type: String(raw?.property_type || '').trim(),
    suggested_price: normalizeAmount(raw?.suggested_price),
    actual_bid_price: actual,
    winning_price: winning,
    bid_result: bidResult,
    deviation_reason: String(raw?.deviation_reason || '').trim(),
  };
}

async function syncToBidAnalysis(db: D1Database, row: FreelancerBidRow, user: any): Promise<void> {
  await ensureBidAnalysisTable(db);
  await db.prepare("DELETE FROM bid_analysis_entries WHERE source_type = 'freelancer' AND source_id = ?").bind(row.id).run();
  await upsertBidAnalysisEntry(db, {
    bid_datetime: row.bid_date,
    assignee_name: row.owner_name || user.name || row.bidder_name || '',
    branch_name: row.owner_branch || user.branch || '',
    case_number: row.case_number,
    property_type: row.property_type,
    suggested_bid_price: row.suggested_price,
    actual_bid_price: row.actual_bid_price,
    winning_price: row.winning_price,
    bid_result: row.bid_result as any,
    client_name: row.client_name,
    source_type: 'freelancer',
    source_id: row.id,
    uploaded_by: row.user_id,
  });
}

async function findBidRow(db: D1Database, id: string): Promise<FreelancerBidRow | null> {
  return await db.prepare(`
    SELECT f.*, u.name AS owner_name, u.branch AS owner_branch, u.department AS owner_department,
      CASE WHEN datetime(f.updated_at, '+7 days') >= ${KST_NOW_SQL} THEN 1 ELSE 0 END AS can_edit
    FROM freelancer_bid_entries f
    LEFT JOIN users u ON u.id = f.user_id
    WHERE f.id = ?
  `).bind(id).first<FreelancerBidRow>();
}

freelancerBids.get('/', async (c) => {
  const user = c.get('user');
  if (!canViewFreelancerBids(user)) return c.json({ error: '입찰 내역 열람 권한이 없습니다.' }, 403);
  const db = c.env.DB;
  await ensureFreelancerBidTable(db);

  const branch = String(c.req.query('branch') || '').trim();
  const assignee = String(c.req.query('assignee') || '').trim();
  const params: unknown[] = [];
  const where: string[] = [];
  const adminView = canManageFreelancerBids(user);
  if (!adminView) {
    where.push('f.user_id = ?');
    params.push(user.sub);
  } else {
    if (branch) {
      where.push('COALESCE(u.branch, \'\') = ?');
      params.push(branch);
    }
    if (assignee) {
      where.push('f.user_id = ?');
      params.push(assignee);
    }
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = await db.prepare(`
    SELECT f.*, u.name AS owner_name, u.branch AS owner_branch, u.department AS owner_department,
      ${adminView ? 1 : `CASE WHEN datetime(f.updated_at, '+7 days') >= ${KST_NOW_SQL} THEN 1 ELSE 0 END`} AS can_edit,
      ${adminView ? 1 : 0} AS can_delete
    FROM freelancer_bid_entries f
    LEFT JOIN users u ON u.id = f.user_id
    ${whereSql}
    ORDER BY bid_date DESC, created_at DESC
  `).bind(...params).all<FreelancerBidRow>();

  const branches = adminView
    ? (await db.prepare(`
        SELECT DISTINCT COALESCE(u.branch, '') AS branch
        FROM freelancer_bid_entries f
        LEFT JOIN users u ON u.id = f.user_id
        WHERE COALESCE(u.branch, '') <> ''
        ORDER BY branch
      `).all<{ branch: string }>()).results || []
    : [];
  const assignees = adminView
    ? (await db.prepare(`
        SELECT DISTINCT f.user_id AS id, COALESCE(u.name, f.bidder_name, '') AS name, COALESCE(u.branch, '') AS branch
        FROM freelancer_bid_entries f
        LEFT JOIN users u ON u.id = f.user_id
        ORDER BY name
      `).all<{ id: string; name: string; branch: string }>()).results || []
    : [];

  return c.json({ rows: rows.results || [], filters: { branches, assignees } });
});

freelancerBids.post('/', async (c) => {
  const user = c.get('user');
  if (!requireFreelancer(user)) return c.json({ error: '프리랜서 전용 메뉴입니다.' }, 403);
  const db = c.env.DB;
  await ensureFreelancerBidTable(db);
  await ensureBidAnalysisTable(db);

  const body = await c.req.json();
  const payload = normalizePayload(body);
  if (!payload.bid_date) return c.json({ error: '입찰일을 입력하세요.' }, 400);
  if (!payload.case_number) return c.json({ error: '사건번호를 입력하세요.' }, 400);
  if (!payload.client_name) return c.json({ error: '고객명을 입력하세요.' }, 400);
  if (!payload.property_type) return c.json({ error: '물건종류를 선택하세요.' }, 400);

  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO freelancer_bid_entries (
      id, user_id, bid_date, court, case_number, item_no, client_name, bidder_name,
      property_type, suggested_price, actual_bid_price, winning_price, bid_result,
      deviation_reason, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${KST_NOW_SQL}, ${KST_NOW_SQL})
  `).bind(
    id, user.sub, payload.bid_date, payload.court, payload.case_number, payload.item_no,
    payload.client_name, payload.bidder_name, payload.property_type, payload.suggested_price,
    payload.actual_bid_price, payload.winning_price, payload.bid_result, payload.deviation_reason,
  ).run();

  const row = await db.prepare('SELECT * FROM freelancer_bid_entries WHERE id = ?').bind(id).first<FreelancerBidRow>();
  if (row) await syncToBidAnalysis(db, row, user);
  return c.json({ success: true, id });
});

freelancerBids.put('/:id', async (c) => {
  const user = c.get('user');
  if (!canViewFreelancerBids(user)) return c.json({ error: '입찰 내역 수정 권한이 없습니다.' }, 403);
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
});

freelancerBids.delete('/:id', async (c) => {
  const user = c.get('user');
  if (!canManageFreelancerBids(user)) return c.json({ error: '입찰 내역 삭제 권한이 없습니다.' }, 403);
  const db = c.env.DB;
  await ensureFreelancerBidTable(db);
  await ensureBidAnalysisTable(db);
  const id = c.req.param('id');
  const current = await db.prepare('SELECT id FROM freelancer_bid_entries WHERE id = ?').bind(id).first<{ id: string }>();
  if (!current) return c.json({ error: '입찰 내역을 찾을 수 없습니다.' }, 404);
  await db.prepare('DELETE FROM freelancer_bid_entries WHERE id = ?').bind(id).run();
  await db.prepare("DELETE FROM bid_analysis_entries WHERE source_type = 'freelancer' AND source_id = ?").bind(id).run();
  return c.json({ success: true });
});

export default freelancerBids;
