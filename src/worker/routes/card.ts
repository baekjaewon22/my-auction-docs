import { Hono } from 'hono';
import type { AuthEnv } from '../types';
import { authMiddleware, requireRole } from '../middleware/auth';

const card = new Hono<AuthEnv>();
card.use('*', authMiddleware);

// cc_ref 제외 (회계장부 카드내역 열람 제한)
const ACCOUNTING_ROLES = ['master', 'ceo', 'accountant', 'accountant_asst'] as const;
const EDIT_ROLES = ['master', 'ceo', 'accountant', 'accountant_asst'] as const;
const DELETE_ROLES = ['master', 'ceo', 'accountant'] as const; // 삭제는 보조 제외
const PAYROLL_EXTRA_USER_IDS = ['2b6b3606-e425-4361-a115-9283cfef842f'];
const CARD_CANCEL_PATTERN = /(취소|승인취소|매출취소|사용취소|부분취소|환불|반품)/;
const CARD_USAGE_ITEMS: Record<string, string[]> = {
  세금: ['부가세', '소득세', '주민세', '지방세', '4대보험', '법인세', '세무수수료'],
  인건비: ['직원급여', '컨설턴트 실적급여', '사업소득', '성과금', '퇴직정산'],
  사무실관련: ['임대료', '관리비', '전기요금', '수도요금', '가스요금', '청소비', '보안비'],
  통신요금: ['LGU+유선전화', 'LGU+인터넷', '인터넷전화', '대표번호', '휴대폰요금', '문자통지료', '문자발송충전'],
  홈페이지: ['네이버', '다음', '구글', '카카오', '키워드광고(네이버)', '키워드광고(다음)', '키워드광고(구글)', '블로그', '서버/도메인'],
  영업비: ['식비', '식대', '유류비', '주차비', '출장비', '숙소비', '현장식대', '법원식대', '접대비'],
  고정비: ['복사기/프린터 렌탈', '정수기 렌탈', '공기청정기 렌탈', '카드단말기', '렌탈료', '구독료', '프로그램 사용료'],
  기타: ['기타', '수수료', '송금수수료', '잡비', '환불', '오입금정리'],
  명도: ['명도비용', '강제집행비', '노무비', '열쇠/철거', '운반비', '폐기물처리'],
  비품: ['비품', '문구류', '사무용품(온라인구매)', '커피녹차', '직원간식', '명함인쇄', '소모품'],
  사무기기: ['복사기', '프린터', '토너', '잉크', '수리비', '주변기기', '사무기기 렌탈'],
  우편료: ['우편료', '등기우편', 'DM우편', '송달료', '내용증명', '택배비'],
  화환: ['화환', '화분', '근조화환', '축하화환'],
};
const CARD_USAGE_CATEGORIES = Object.keys(CARD_USAGE_ITEMS);

async function ensureCardTransactionColumns(db: D1Database) {
  const statements = [
    "ALTER TABLE card_transactions ADD COLUMN usage_category TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE card_transactions ADD COLUMN usage_item TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE card_transactions ADD COLUMN updated_at TEXT",
  ];
  for (const sql of statements) {
    try { await db.prepare(sql).run(); } catch { /* already exists */ }
  }
}

function normalizeCardAmount(amount: unknown, isCancellationFlag: boolean, ...texts: unknown[]): number {
  const raw = Number(String(amount ?? '0').replace(/[^0-9.-]/g, '')) || 0;
  if (raw === 0) return 0;
  const isCancellation = isCancellationFlag || CARD_CANCEL_PATTERN.test(texts.map((text) => String(text || '')).join(' '));
  return isCancellation ? -Math.abs(raw) : Math.abs(raw);
}

function normalizeCardDate(value: unknown): string {
  if (typeof value === 'number') {
    const d = new Date((value - 25569) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const raw = String(value || '').trim();
  const match = raw.match(/(\d{2,4})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})/);
  if (!match) return raw.slice(0, 10);
  const year = match[1].length === 2 ? `20${match[1]}` : match[1];
  return `${year}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

const requirePayrollCardTotalAccess = async (c: any, next: any) => {
  const user = c.get('user');
  if (ACCOUNTING_ROLES.includes(user?.role) || PAYROLL_EXTRA_USER_IDS.includes(user?.sub)) {
    return next();
  }
  return c.json({ error: '권한이 없습니다.' }, 403);
};

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
  await ensureCardTransactionColumns(db);
  const { rows } = await c.req.json<{
    rows: { card_number: string; transaction_date: string; merchant_name: string; amount: number; description: string; usage_category?: string; usage_item?: string; is_cancellation?: boolean; raw_text?: string }[];
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

    const merchantName = row.merchant_name || '';
    const description = row.description || '';
    const usageCategory = CARD_USAGE_CATEGORIES.includes(row.usage_category as any) ? row.usage_category : '';
    const usageItem = String(row.usage_item || '').trim().slice(0, 120);
    const transactionDate = normalizeCardDate(row.transaction_date || '');
    const amount = normalizeCardAmount(row.amount, !!row.is_cancellation, merchantName, description, row.raw_text);
    const isCancellation = amount < 0;
    const sourceText = String(row.raw_text || '').slice(0, 1000);

    // 중복 체크 (카드번호+날짜+금액+가맹점+비고)
    // 일반 사용액은 부호가 뒤집힌 과거 업로드도 같은 거래로 보고 중복 차단한다.
    // 취소/환불 행은 동일 금액의 기존 사용액과 공존해야 하므로 음수 금액 기준으로만 중복 차단한다.
    // Some exports truncate merchant names, so prefix matches are treated as the same merchant.
    // Use substr comparisons instead of LIKE so long or symbol-heavy merchant names cannot trip D1's pattern limit.
    const dup = await db.prepare(
      `SELECT id FROM card_transactions
       WHERE card_number = ? AND transaction_date = ?
         AND IFNULL(description,'') = ?
         AND (
           merchant_name = ?
           OR ? = ''
           OR merchant_name = ''
           OR substr(merchant_name, 1, length(?)) = ?
           OR substr(?, 1, length(merchant_name)) = merchant_name
         )
         AND (
           (? = 1 AND amount = ?)
           OR (? = 0 AND ABS(amount) = ?)
         )
       LIMIT 1`
    ).bind(
      row.card_number || rawCard,
      transactionDate,
      description,
      merchantName,
      merchantName,
      merchantName,
      merchantName,
      merchantName,
      isCancellation ? 1 : 0,
      amount,
      isCancellation ? 1 : 0,
      Math.abs(amount),
    ).first();
    if (dup) continue;

    const id = crypto.randomUUID();
    await db.prepare(`
      INSERT INTO card_transactions (id, card_number, user_id, branch, category, merchant_name, transaction_date, amount, description, usage_category, usage_item, is_cancellation, source_text, upload_batch, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+9 hours'))
    `).bind(
      id, row.card_number || rawCard, userId, branch, category,
      merchantName, transactionDate,
      amount, description, usageCategory || '', usageItem, isCancellation ? 1 : 0, sourceText, batchId
    ).run();
    inserted++;
  }

  return c.json({ success: true, inserted, batch_id: batchId });
});

// GET /api/card/last-upload — 가장 최근 업로드 정보 (날짜 + 건수)
card.get('/last-upload', requireRole(...ACCOUNTING_ROLES), async (c) => {
  const db = c.env.DB;
  const latest = await db.prepare(
    "SELECT created_at, upload_batch FROM card_transactions WHERE upload_batch IS NOT NULL AND upload_batch != '' ORDER BY created_at DESC LIMIT 1"
  ).first<{ created_at: string; upload_batch: string }>();
  if (!latest) return c.json({ last_upload: null, count: 0, batch_id: null });
  const cnt = await db.prepare(
    'SELECT COUNT(*) as c FROM card_transactions WHERE upload_batch = ?'
  ).bind(latest.upload_batch).first<{ c: number }>();
  return c.json({ last_upload: latest.created_at, count: cnt?.c || 0, batch_id: latest.upload_batch });
});

// GET /api/card/transactions — 카드사용내역 조회
card.get('/transactions', requireRole(...ACCOUNTING_ROLES), async (c) => {
  const db = c.env.DB;
  await ensureCardTransactionColumns(db);
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

// PUT /api/card/transaction/:id — 본사 관리 카드내역의 수기 분류/내용/비고 수정
card.put('/transaction/:id', requireRole(...EDIT_ROLES), async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  await ensureCardTransactionColumns(db);
  const body = await c.req.json<{ merchant_name?: string; description?: string; usage_category?: string; usage_item?: string }>();
  const existing = await db.prepare('SELECT id, category FROM card_transactions WHERE id = ?').bind(id).first<{ id: string; category: string }>();
  if (!existing) return c.json({ error: '카드내역을 찾을 수 없습니다.' }, 404);
  if ((existing.category || '') !== '본사 관리') return c.json({ error: '본사 관리 카드내역만 수정할 수 있습니다.' }, 403);

  const usageCategory = CARD_USAGE_CATEGORIES.includes(body.usage_category as any) ? body.usage_category : '';
  const usageItem = String(body.usage_item || '').trim().slice(0, 120);
  await db.prepare(`
    UPDATE card_transactions
    SET merchant_name = ?, description = ?, usage_category = ?, usage_item = ?, updated_at = datetime('now', '+9 hours')
    WHERE id = ?
  `).bind(
    String(body.merchant_name || '').trim().slice(0, 200),
    String(body.description || '').trim().slice(0, 500),
    usageCategory || '',
    usageItem,
    id,
  ).run();

  return c.json({ success: true });
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
card.get('/user-total/:userId', requirePayrollCardTotalAccess, async (c) => {
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
