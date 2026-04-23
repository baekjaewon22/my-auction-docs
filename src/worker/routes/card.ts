import { Hono } from 'hono';
import type { AuthEnv } from '../types';
import { authMiddleware, requireRole } from '../middleware/auth';

const card = new Hono<AuthEnv>();
card.use('*', authMiddleware);

// cc_ref 제외 (회계장부 카드내역 열람 제한)
const ACCOUNTING_ROLES = ['master', 'ceo', 'admin', 'accountant', 'accountant_asst'] as const;
const EDIT_ROLES = ['master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst'] as const;
const DELETE_ROLES = ['master', 'ceo', 'cc_ref', 'admin', 'accountant'] as const; // 삭제는 보조 제외

// PUT /api/card/user/:userId — 법인카드 번호 등록/수정
card.put('/user/:userId', requireRole(...EDIT_ROLES), async (c) => {
  const userId = c.req.param('userId');
  const { card_number } = await c.req.json<{ card_number: string }>();
  const db = c.env.DB;
  await db.prepare("UPDATE users SET card_number = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(card_number || '', userId).run();

  // 카드번호 변경 시 전체 card_transactions 재매칭 (last-4 기준)
  const usersResult = await db.prepare(
    "SELECT id, card_number, branch FROM users WHERE card_number != '' AND approved = 1"
  ).all();
  const last4Map: Record<string, { user_id: string; branch: string }> = {};
  for (const u of usersResult.results as any[]) {
    const cards = (u.card_number || '').split(',');
    for (const card of cards) {
      const num = card.trim().replace(/[^0-9]/g, '');
      if (num.length >= 4) last4Map[num.slice(-4)] = { user_id: u.id, branch: u.branch };
      else if (num.length > 0) last4Map[num] = { user_id: u.id, branch: u.branch };
    }
  }

  const allTxns = await db.prepare("SELECT id, card_number, user_id, branch FROM card_transactions").all();
  let rematched = 0;
  for (const t of allTxns.results as any[]) {
    const numOnly = (t.card_number || '').replace(/[^0-9]/g, '');
    const last4 = numOnly.length >= 4 ? numOnly.slice(-4) : numOnly;
    const match = last4 ? last4Map[last4] : null;
    const newUserId = match?.user_id ?? null;
    const newBranch = match?.branch || '';
    const newCategory = newBranch || '기타';
    if ((t.user_id || null) !== newUserId || (t.branch || '') !== newBranch) {
      await db.prepare("UPDATE card_transactions SET user_id = ?, branch = ?, category = ? WHERE id = ?")
        .bind(newUserId, newBranch, newCategory, t.id).run();
      rematched++;
    }
  }

  return c.json({ success: true, rematched });
});

// POST /api/card/upload — 신한은행 엑셀 업로드 (JSON 파싱 후 전달)
// 프론트에서 xlsx 파싱 → JSON rows 전달 (Cloudflare Workers는 FormData 파일 파싱 제한)
card.post('/upload', requireRole(...EDIT_ROLES), async (c) => {
  const db = c.env.DB;
  const { rows } = await c.req.json<{
    rows: { card_number: string; transaction_date: string; merchant_name: string; amount: number; description: string }[];
  }>();

  if (!rows || rows.length === 0) return c.json({ error: '데이터가 없습니다.' }, 400);

  // 등록된 사용자 카드번호 조회 — 뒤 4자리 기준 매칭
  const usersResult = await db.prepare(
    "SELECT id, card_number, branch FROM users WHERE card_number != '' AND approved = 1"
  ).all();
  // 뒤 4자리 → 사용자 매핑 (콤마 구분 복수 카드 지원)
  const last4Map: Record<string, { user_id: string; branch: string }> = {};
  for (const u of usersResult.results as any[]) {
    const cards = (u.card_number || '').split(',');
    const info = { user_id: u.id, branch: u.branch };
    for (const card of cards) {
      const num = card.trim().replace(/[^0-9]/g, '');
      if (num.length >= 4) {
        last4Map[num.slice(-4)] = info;
      } else if (num.length > 0) {
        last4Map[num] = info;
      }
    }
  }

  const batchId = crypto.randomUUID();
  let inserted = 0;

  for (const row of rows) {
    const rawCard = (row.card_number || '').trim();
    const numOnly = rawCard.replace(/[^0-9]/g, '');
    // 뒤 4자리로 매칭 (5525-76**-****-5900 → 5900)
    const last4 = numOnly.length >= 4 ? numOnly.slice(-4) : numOnly;
    const match = last4 ? (last4Map[last4] || null) : null;
    const userId = match?.user_id ?? null;
    const branch = match?.branch || '';
    // 미매칭은 '기타'로 분류
    const category = branch || '기타';

    // 중복 체크 (카드번호+날짜+금액+가맹점)
    const dup = await db.prepare(
      'SELECT id FROM card_transactions WHERE card_number = ? AND transaction_date = ? AND amount = ? AND merchant_name = ? LIMIT 1'
    ).bind(row.card_number || rawCard, row.transaction_date || '', Math.abs(row.amount || 0), row.merchant_name || '').first();
    if (dup) continue;

    const id = crypto.randomUUID();
    await db.prepare(`
      INSERT INTO card_transactions (id, card_number, user_id, branch, category, merchant_name, transaction_date, amount, description, upload_batch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, row.card_number || rawCard, userId, branch, category,
      row.merchant_name || '', row.transaction_date || '',
      row.amount || 0, row.description || '', batchId
    ).run();
    inserted++;
  }

  return c.json({ success: true, inserted, batch_id: batchId });
});

// GET /api/card/transactions — 카드사용내역 조회
card.get('/transactions', requireRole(...ACCOUNTING_ROLES), async (c) => {
  const db = c.env.DB;
  const { month, branch, user_id } = c.req.query();

  let query = `
    SELECT ct.*, u.name as user_name, u.department as user_department
    FROM card_transactions ct
    LEFT JOIN users u ON u.id = ct.user_id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (month) { query += " AND (ct.transaction_date LIKE ? OR ct.transaction_date LIKE ?)"; params.push(month + '%', month.replace('-', '.') + '%'); }
  if (branch) { query += " AND ct.category = ?"; params.push(branch); }
  if (user_id) { query += " AND ct.user_id = ?"; params.push(user_id); }

  query += ' ORDER BY ct.transaction_date DESC, ct.created_at DESC';

  const result = params.length > 0
    ? await db.prepare(query).bind(...params).all()
    : await db.prepare(query).all();

  return c.json({ transactions: result.results });
});

// POST /api/card/rematch — 미매칭 건 재매칭
card.post('/rematch', requireRole(...EDIT_ROLES), async (c) => {
  const db = c.env.DB;
  // 등록된 카드번호 매핑 (콤마 구분 복수 카드 지원)
  const usersResult = await db.prepare(
    "SELECT id, card_number, branch FROM users WHERE card_number != '' AND approved = 1"
  ).all();
  const last4Map: Record<string, { user_id: string; branch: string }> = {};
  for (const u of usersResult.results as any[]) {
    const cards = (u.card_number || '').split(',');
    for (const card of cards) {
      const num = card.trim().replace(/[^0-9]/g, '');
      if (num.length >= 4) last4Map[num.slice(-4)] = { user_id: u.id, branch: u.branch };
      else if (num.length > 0) last4Map[num] = { user_id: u.id, branch: u.branch };
    }
  }

  // 미매칭 건 조회
  const unmatched = await db.prepare("SELECT id, card_number FROM card_transactions WHERE user_id IS NULL OR user_id = ''").all();
  let updated = 0;
  for (const t of unmatched.results as any[]) {
    const numOnly = (t.card_number || '').replace(/[^0-9]/g, '');
    const last4 = numOnly.length >= 4 ? numOnly.slice(-4) : numOnly;
    const match = last4 ? last4Map[last4] : null;
    if (match) {
      await db.prepare("UPDATE card_transactions SET user_id = ?, branch = ?, category = ? WHERE id = ?")
        .bind(match.user_id, match.branch, match.branch || '기타', t.id).run();
      updated++;
    }
  }
  return c.json({ success: true, total: unmatched.results?.length || 0, updated });
});

// GET /api/card/summary — 지사별/담당자별 합산
card.get('/summary', requireRole(...ACCOUNTING_ROLES), async (c) => {
  const db = c.env.DB;
  const { month } = c.req.query();

  let dateFilter = '';
  const params: any[] = [];
  if (month) { dateFilter = " AND (transaction_date LIKE ? OR transaction_date LIKE ?)"; params.push(month + '%', month.replace('-', '.') + '%'); }

  // 지사별 합산
  const branchResult = await db.prepare(`
    SELECT category as branch, SUM(amount) as total, COUNT(*) as count
    FROM card_transactions WHERE 1=1${dateFilter}
    GROUP BY category
  `).bind(...params).all();

  // 담당자별 합산
  const userResult = await db.prepare(`
    SELECT ct.user_id, u.name as user_name, u.branch, u.department,
      SUM(ct.amount) as total, COUNT(*) as count
    FROM card_transactions ct
    LEFT JOIN users u ON u.id = ct.user_id
    WHERE ct.user_id IS NOT NULL${dateFilter ? dateFilter.replaceAll('transaction_date', 'ct.transaction_date') : ''}
    GROUP BY ct.user_id
    ORDER BY total DESC
  `).bind(...params).all();

  return c.json({
    by_branch: branchResult.results,
    by_user: userResult.results,
  });
});

// GET /api/card/user-total — 특정 사용자의 월별 카드사용 합계 (정산용)
card.get('/user-total/:userId', requireRole(...ACCOUNTING_ROLES), async (c) => {
  const userId = c.req.param('userId');
  const month = c.req.query('month') || '';
  const db = c.env.DB;

  let query = "SELECT SUM(amount) as total FROM card_transactions WHERE user_id = ?";
  const params: any[] = [userId];
  if (month) { query += " AND (transaction_date LIKE ? OR transaction_date LIKE ?)"; params.push(month + '%', month.replace('-', '.') + '%'); }

  const result = await db.prepare(query).bind(...params).first<{ total: number }>();
  return c.json({ total: result?.total || 0 });
});

// DELETE /api/card/transaction/:id — 개별 삭제
card.delete('/transaction/:id', requireRole(...DELETE_ROLES), async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  await db.prepare('DELETE FROM card_transactions WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

// DELETE /api/card/batch/:batchId — 배치 삭제
card.delete('/batch/:batchId', requireRole(...DELETE_ROLES), async (c) => {
  const batchId = c.req.param('batchId');
  const db = c.env.DB;
  await db.prepare('DELETE FROM card_transactions WHERE upload_batch = ?').bind(batchId).run();
  return c.json({ success: true });
});

// POST /api/card/bulk-delete — 다중 삭제
card.post('/bulk-delete', requireRole(...DELETE_ROLES), async (c) => {
  const { ids } = await c.req.json<{ ids: string[] }>();
  const db = c.env.DB;
  if (!ids || ids.length === 0) return c.json({ error: '삭제할 항목이 없습니다.' }, 400);
  for (const id of ids) {
    await db.prepare('DELETE FROM card_transactions WHERE id = ?').bind(id).run();
  }
  return c.json({ success: true, count: ids.length });
});

export default card;
