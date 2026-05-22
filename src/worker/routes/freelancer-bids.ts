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

function requireFreelancer(user: any) {
  return user?.login_type === 'freelancer' || user?.role === 'freelancer';
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
    assignee_name: user.name || row.bidder_name || '',
    branch_name: user.branch || '',
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

freelancerBids.get('/', async (c) => {
  const user = c.get('user');
  if (!requireFreelancer(user)) return c.json({ error: '프리랜서 전용 메뉴입니다.' }, 403);
  const db = c.env.DB;
  await ensureFreelancerBidTable(db);
  const rows = await db.prepare(`
    SELECT *
    FROM freelancer_bid_entries
    WHERE user_id = ?
    ORDER BY bid_date DESC, created_at DESC
  `).bind(user.sub).all<FreelancerBidRow>();
  return c.json({ rows: rows.results || [] });
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
  if (!requireFreelancer(user)) return c.json({ error: '프리랜서 전용 메뉴입니다.' }, 403);
  const db = c.env.DB;
  await ensureFreelancerBidTable(db);
  await ensureBidAnalysisTable(db);
  const id = c.req.param('id');
  const current = await db.prepare('SELECT * FROM freelancer_bid_entries WHERE id = ? AND user_id = ?').bind(id, user.sub).first<FreelancerBidRow>();
  if (!current) return c.json({ error: '입찰 내역을 찾을 수 없습니다.' }, 404);

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
    payload.winning_price, payload.bid_result, payload.deviation_reason, id, user.sub,
  ).run();

  const row = await db.prepare('SELECT * FROM freelancer_bid_entries WHERE id = ?').bind(id).first<FreelancerBidRow>();
  if (row) await syncToBidAnalysis(db, row, user);
  return c.json({ success: true });
});

freelancerBids.delete('/:id', async (c) => {
  const user = c.get('user');
  if (!requireFreelancer(user)) return c.json({ error: '프리랜서 전용 메뉴입니다.' }, 403);
  const db = c.env.DB;
  await ensureFreelancerBidTable(db);
  await ensureBidAnalysisTable(db);
  const id = c.req.param('id');
  const current = await db.prepare('SELECT id FROM freelancer_bid_entries WHERE id = ? AND user_id = ?').bind(id, user.sub).first<{ id: string }>();
  if (!current) return c.json({ error: '입찰 내역을 찾을 수 없습니다.' }, 404);
  await db.prepare('DELETE FROM freelancer_bid_entries WHERE id = ? AND user_id = ?').bind(id, user.sub).run();
  await db.prepare("DELETE FROM bid_analysis_entries WHERE source_type = 'freelancer' AND source_id = ?").bind(id).run();
  return c.json({ success: true });
});

export default freelancerBids;
