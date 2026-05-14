import { Hono } from 'hono';
import type { AuthEnv } from '../types';
import { authMiddleware, requireRole } from '../middleware/auth';

const accounting = new Hono<AuthEnv>();
accounting.use('*', authMiddleware);

// 총무 역할 체크 헬퍼
// cc_ref 제외 (회계 열람 제한)
const ACCOUNTING_ROLES = ['master', 'ceo', 'accountant', 'accountant_asst'] as const;

const CARD_SETTLEMENT_KEYWORDS = [
  '카드', '헥토', '파이낸셜', '나이스', 'nice', '토스', 'toss', '이니시스', 'kg', 'kcp',
  '페이', 'pay', '스마트로', 'ksnet', '다날', '페이먼츠', 'pg',
];

async function ensureBankStagingColumns(db: D1Database): Promise<void> {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS bank_staging (
      id TEXT PRIMARY KEY,
      depositor TEXT NOT NULL,
      amount INTEGER NOT NULL DEFAULT 0,
      transaction_date TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      matched_sales_id TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now', '+9 hours')),
      updated_at TEXT DEFAULT (datetime('now', '+9 hours')),
      direction TEXT DEFAULT 'income',
      counterparty TEXT DEFAULT '',
      category TEXT DEFAULT 'unmatched',
      raw_json TEXT DEFAULT ''
    )
  `).run();
  const statements = [
    "ALTER TABLE bank_staging ADD COLUMN direction TEXT DEFAULT 'income'",
    "ALTER TABLE bank_staging ADD COLUMN counterparty TEXT DEFAULT ''",
    "ALTER TABLE bank_staging ADD COLUMN category TEXT DEFAULT 'unmatched'",
    "ALTER TABLE bank_staging ADD COLUMN raw_json TEXT DEFAULT ''",
  ];
  for (const sql of statements) {
    try { await db.prepare(sql).run(); } catch { /* column already exists */ }
  }
}

async function ensureCardSettlementColumns(db: D1Database): Promise<void> {
  const statements = [
    "ALTER TABLE sales_records ADD COLUMN card_settlement_amount INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE sales_records ADD COLUMN card_fee_amount INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE sales_records ADD COLUMN card_settlement_staging_id TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE sales_records ADD COLUMN card_settlement_note TEXT NOT NULL DEFAULT ''",
  ];
  for (const sql of statements) {
    try { await db.prepare(sql).run(); } catch { /* column already exists */ }
  }
}

function normalizeBankText(value: unknown): string {
  return String(value || '').trim();
}

function classifyBankRow(direction: string, counterparty: string, description: string, requested?: string): string {
  if (requested) return requested;
  if (direction === 'expense') return 'expense';
  const text = `${counterparty} ${description}`.toLowerCase();
  if (CARD_SETTLEMENT_KEYWORDS.some((keyword) => text.includes(keyword.toLowerCase()))) return 'card_settlement';
  return 'sales_match';
}

// 총무보조(accountant_asst) 열람·수정 제한 — 팀장·관리자급·이사·대표자는 총무담당만
const RESTRICTED_ROLES_FOR_ASST = ['master', 'ceo', 'cc_ref', 'admin', 'director', 'manager'];
async function canAccessUserAccounting(db: D1Database, viewer: any, targetUserId: string): Promise<boolean> {
  if (viewer.role !== 'accountant_asst') return true;
  const target = await db.prepare('SELECT role FROM users WHERE id = ?').bind(targetUserId).first<any>();
  if (!target) return true;
  return !RESTRICTED_ROLES_FOR_ASST.includes(target.role);
}

// GET /api/accounting - 전체 직원 회계 정보 목록 (총무보조는 제한 대상 제외)
accounting.get('/', requireRole(...ACCOUNTING_ROLES), async (c) => {
  const db = c.env.DB;
  const viewer = c.get('user');
  const result = await db.prepare(`
    SELECT ua.*, u.name as user_name, u.branch, u.department, u.role, u.position_title
    FROM user_accounting ua
    JOIN users u ON u.id = ua.user_id
    WHERE u.approved = 1
    ORDER BY u.name ASC
  `).all();
  let accounts = result.results as any[];
  if (viewer.role === 'accountant_asst') {
    accounts = accounts.filter((a: any) => !RESTRICTED_ROLES_FOR_ASST.includes(a.role));
  }
  return c.json({ accounts });
});

// GET /api/accounting/:userId - 특정 직원 회계 정보
accounting.get('/:userId', requireRole(...ACCOUNTING_ROLES), async (c) => {
  const userId = c.req.param('userId');
  const db = c.env.DB;
  const viewer = c.get('user');
  if (!(await canAccessUserAccounting(db, viewer, userId))) {
    return c.json({ error: '해당 직원의 회계 정보 열람 권한이 없습니다.' }, 403);
  }

  const account = await db.prepare(`
    SELECT ua.*, u.name as user_name, u.branch, u.department, u.role, u.position_title
    FROM user_accounting ua
    JOIN users u ON u.id = ua.user_id
    WHERE ua.user_id = ?
  `).bind(userId).first();

  return c.json({ account: account || null });
});

// PUT /api/accounting/:userId - 직원 회계 정보 생성/수정 (급여, 직급)
accounting.put('/:userId', requireRole(...ACCOUNTING_ROLES), async (c) => {
  const userId = c.req.param('userId');
  const viewer = c.get('user');
  if (!(await canAccessUserAccounting(c.env.DB, viewer, userId))) {
    return c.json({ error: '해당 직원의 회계 정보 수정 권한이 없습니다.' }, 403);
  }
  const { salary, grade, position_allowance, pay_type, commission_rate, ssn, address } = await c.req.json<{ salary?: number; grade?: string; position_allowance?: number; pay_type?: string; commission_rate?: number; ssn?: string; address?: string }>();
  const db = c.env.DB;

  // 사용자 존재 확인
  const user = await db.prepare('SELECT id FROM users WHERE id = ? AND approved = 1').bind(userId).first();
  if (!user) return c.json({ error: '사용자를 찾을 수 없습니다.' }, 404);

  // 직급 유효성 검사
  if (grade !== undefined && !['', 'M1', 'M2', 'M3', 'M4'].includes(grade)) {
    return c.json({ error: '유효하지 않은 직급입니다.' }, 400);
  }

  const existing = await db.prepare('SELECT * FROM user_accounting WHERE user_id = ?').bind(userId).first();

  const newSalary = salary !== undefined ? salary : (existing as any)?.salary || 0;
  const newGrade = grade !== undefined ? grade : (existing as any)?.grade || '';
  const newAllowance = position_allowance !== undefined ? position_allowance : (existing as any)?.position_allowance || 0;
  const newPayType = pay_type !== undefined ? pay_type : (existing as any)?.pay_type || 'salary';
  const newCommRate = commission_rate !== undefined ? commission_rate : (existing as any)?.commission_rate || 0;
  const newSsn = ssn !== undefined ? ssn : (existing as any)?.ssn || '';
  const newAddress = address !== undefined ? address : (existing as any)?.address || '';
  const standardSales = Math.round(newSalary * 1.3 * 4);

  if (existing) {
    await db.prepare(`
      UPDATE user_accounting SET salary = ?, standard_sales = ?, grade = ?, position_allowance = ?, pay_type = ?, commission_rate = ?, ssn = ?, address = ?, updated_at = datetime('now')
      WHERE user_id = ?
    `).bind(newSalary, standardSales, newGrade, newAllowance, newPayType, newCommRate, newSsn, newAddress, userId).run();
  } else {
    const id = crypto.randomUUID();
    await db.prepare(`
      INSERT INTO user_accounting (id, user_id, salary, standard_sales, grade, position_allowance, pay_type, commission_rate, ssn, address)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, userId, newSalary, standardSales, newGrade, newAllowance, newPayType, newCommRate, newSsn, newAddress).run();
  }

  return c.json({ success: true, salary: newSalary, standard_sales: standardSales, grade: newGrade, position_allowance: newAllowance, pay_type: newPayType, commission_rate: newCommRate, ssn: newSsn, address: newAddress });
});

// PUT /api/accounting/:userId/grade - 직급 강등 (관리자급 이상만)
accounting.put('/:userId/grade', requireRole(...ACCOUNTING_ROLES), async (c) => {
  const userId = c.req.param('userId');
  const { grade } = await c.req.json<{ grade: string }>();
  const db = c.env.DB;
  const viewer = c.get('user');
  if (!(await canAccessUserAccounting(db, viewer, userId))) {
    return c.json({ error: '해당 직원의 직급 수정 권한이 없습니다.' }, 403);
  }

  if (!['M1', 'M2', 'M3', 'M4'].includes(grade)) {
    return c.json({ error: '유효하지 않은 직급입니다.' }, 400);
  }

  const existing = await db.prepare('SELECT * FROM user_accounting WHERE user_id = ?').bind(userId).first();
  if (!existing) return c.json({ error: '회계 정보가 없습니다.' }, 404);

  await db.prepare(`
    UPDATE user_accounting SET grade = ?, updated_at = datetime('now') WHERE user_id = ?
  `).bind(grade, userId).run();

  return c.json({ success: true });
});

// GET /api/accounting/evaluations/:userId - 특정 직원의 매출 평가 이력
accounting.get('/evaluations/:userId', requireRole(...ACCOUNTING_ROLES), async (c) => {
  const userId = c.req.param('userId');
  const db = c.env.DB;
  const viewer = c.get('user');
  if (!(await canAccessUserAccounting(db, viewer, userId))) {
    return c.json({ error: '해당 직원의 평가 이력 열람 권한이 없습니다.' }, 403);
  }

  const result = await db.prepare(`
    SELECT * FROM sales_evaluations WHERE user_id = ? ORDER BY period_start DESC
  `).bind(userId).all();

  return c.json({ evaluations: result.results });
});

// POST /api/accounting/evaluate - 2개월 단위 매출 평가 실행
// 현재 기간의 commissions 합산 → 기준매출 비교 → 결과 저장
accounting.post('/evaluate', requireRole(...ACCOUNTING_ROLES), async (c) => {
  const { period_start, period_end } = await c.req.json<{ period_start: string; period_end: string }>();
  const db = c.env.DB;

  if (!period_start || !period_end) {
    return c.json({ error: '평가 기간을 지정해주세요.' }, 400);
  }

  // 회계 정보가 있는 모든 직원 조회
  const accounts = await db.prepare('SELECT * FROM user_accounting WHERE salary > 0').all();
  const results: any[] = [];

  for (const acc of accounts.results as any[]) {
    // 해당 기간의 완료된 수수료(매출) 합산
    const salesResult = await db.prepare(`
      SELECT COALESCE(SUM(CAST(REPLACE(REPLACE(win_price, ',', ''), '원', '') AS INTEGER)), 0) as total
      FROM commissions
      WHERE user_id = ? AND status = 'completed'
        AND created_at >= ? AND created_at <= ?
    `).bind(acc.user_id, period_start, period_end + ' 23:59:59').first<{ total: number }>();

    const totalSales = salesResult?.total || 0;
    const metTarget = totalSales >= acc.standard_sales ? 1 : 0;

    // 이전 평가에서 연속 미달 횟수 조회
    const prevEval = await db.prepare(`
      SELECT consecutive_misses FROM sales_evaluations
      WHERE user_id = ? AND period_start < ?
      ORDER BY period_start DESC LIMIT 1
    `).bind(acc.user_id, period_start).first<{ consecutive_misses: number }>();

    const prevMisses = prevEval?.consecutive_misses || 0;
    const consecutiveMisses = metTarget ? 0 : prevMisses + 1;

    // 기존 평가가 있으면 업데이트, 없으면 삽입
    const existing = await db.prepare(
      'SELECT id FROM sales_evaluations WHERE user_id = ? AND period_start = ?'
    ).bind(acc.user_id, period_start).first();

    if (existing) {
      await db.prepare(`
        UPDATE sales_evaluations SET total_sales = ?, met_target = ?, consecutive_misses = ?, updated_at = datetime('now')
        WHERE user_id = ? AND period_start = ?
      `).bind(totalSales, metTarget, consecutiveMisses, acc.user_id, period_start).run();
    } else {
      const id = crypto.randomUUID();
      await db.prepare(`
        INSERT INTO sales_evaluations (id, user_id, period_start, period_end, standard_sales, total_sales, met_target, consecutive_misses)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(id, acc.user_id, period_start, period_end, acc.standard_sales, totalSales, metTarget, consecutiveMisses).run();
    }

    results.push({
      user_id: acc.user_id,
      standard_sales: acc.standard_sales,
      total_sales: totalSales,
      met_target: metTarget,
      consecutive_misses: consecutiveMisses,
    });
  }

  return c.json({ success: true, results });
});

// GET /api/accounting/alerts - 대시보드용 경고 목록 (미달 + 강등 대상)
accounting.get('/alerts/dashboard', requireRole(...ACCOUNTING_ROLES), async (c) => {
  const db = c.env.DB;
  const viewer = c.get('user');

  // 현재 기준 평가 기간 계산 (2개월 단위: 1-2월, 3-4월, 5-6월 ...)
  const now = new Date();
  const month = now.getMonth() + 1; // 1-12
  const year = now.getFullYear();
  // 현재 속한 2개월 구간
  const periodMonth = month % 2 === 0 ? month - 1 : month;
  const periodStart = `${year}-${String(periodMonth).padStart(2, '0')}-01`;
  const periodEndMonth = periodMonth + 1;
  const periodEndYear = periodEndMonth > 12 ? year + 1 : year;
  const actualEndMonth = periodEndMonth > 12 ? 1 : periodEndMonth;
  // 해당 월의 마지막 날
  const lastDay = new Date(periodEndYear, actualEndMonth, 0).getDate();
  const periodEnd = `${periodEndYear}-${String(actualEndMonth).padStart(2, '0')}-${lastDay}`;

  // 최근 평가에서 미달인 직원들
  const alerts = await db.prepare(`
    SELECT se.*, ua.salary, ua.grade, u.name as user_name, u.branch, u.department, u.role
    FROM sales_evaluations se
    JOIN user_accounting ua ON ua.user_id = se.user_id
    JOIN users u ON u.id = se.user_id
    WHERE se.met_target = 0
    ORDER BY se.consecutive_misses DESC, se.period_start DESC
  `).all();

  // 강등 대상 (3회 연속 미달)
  const demotionCandidates = (alerts.results as any[]).filter((a: any) => a.consecutive_misses >= 3);

  // 현재 기간 미달 경고
  const currentPeriodAlerts = (alerts.results as any[]).filter((a: any) =>
    a.period_start >= periodStart && a.period_end <= periodEnd
  );

  // 총무보조 제한 대상 필터
  const isAsst = viewer.role === 'accountant_asst';
  const filterFn = (r: any) => !isAsst || !RESTRICTED_ROLES_FOR_ASST.includes(r.role);
  return c.json({
    alerts: (alerts.results as any[]).filter(filterFn),
    demotion_candidates: demotionCandidates.filter(filterFn),
    current_period_alerts: currentPeriodAlerts.filter(filterFn),
    current_period: { start: periodStart, end: periodEnd },
  });
});

// ━━━ 거래내역 첨부 (Bank Staging) ━━━

// POST /api/accounting/upload-bank — 은행 엑셀 업로드 → 업무성과 중복 체크 → 스테이징
// GET /api/accounting/card-settlements/list - 카드대기 매출과 카드/PG 정산 입금 대기 목록
accounting.get('/card-settlements/list', requireRole(...ACCOUNTING_ROLES), async (c) => {
  const db = c.env.DB;
  await ensureBankStagingColumns(db);
  await ensureCardSettlementColumns(db);
  const month = c.req.query('month') || '';

  let salesQuery = `
    SELECT sr.*, u.name as user_name, u.department as user_department
    FROM sales_records sr
    JOIN users u ON u.id = sr.user_id
    WHERE sr.status = 'card_pending' AND sr.payment_type = '카드'
  `;
  const salesParams: any[] = [];
  if (month) {
    salesQuery += ' AND (sr.deposit_date LIKE ? OR sr.contract_date LIKE ?)';
    salesParams.push(month + '%', month + '%');
  }
  salesQuery += ' ORDER BY sr.deposit_date ASC, sr.contract_date ASC, sr.created_at ASC';

  let settlementQuery = `
    SELECT * FROM bank_staging
    WHERE status = 'pending' AND category = 'card_settlement'
  `;
  const settlementParams: any[] = [];
  if (month) {
    settlementQuery += ' AND transaction_date LIKE ?';
    settlementParams.push(month + '%');
  }
  settlementQuery += ' ORDER BY transaction_date ASC, created_at ASC';

  const pendingSales = salesParams.length
    ? await db.prepare(salesQuery).bind(...salesParams).all()
    : await db.prepare(salesQuery).all();
  const settlements = settlementParams.length
    ? await db.prepare(settlementQuery).bind(...settlementParams).all()
    : await db.prepare(settlementQuery).all();

  return c.json({
    pending_sales: pendingSales.results || [],
    settlement_deposits: settlements.results || [],
  });
});

// POST /api/accounting/card-settlements/:id/confirm - 카드대기 매출을 실제 정산 입금 기준으로 확정
accounting.post('/card-settlements/:id/confirm', requireRole(...ACCOUNTING_ROLES), async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  await ensureBankStagingColumns(db);
  await ensureCardSettlementColumns(db);
  const id = c.req.param('id');
  const { settlement_date, settlement_amount, staging_id, note } = await c.req.json<{
    settlement_date?: string;
    settlement_amount?: number;
    staging_id?: string;
    note?: string;
  }>();

  const record = await db.prepare('SELECT * FROM sales_records WHERE id = ?').bind(id).first<any>();
  if (!record) return c.json({ error: '매출 내역을 찾을 수 없습니다.' }, 404);
  if (record.status !== 'card_pending' || record.payment_type !== '카드') {
    return c.json({ error: '카드대기 상태의 매출만 정산 확정할 수 있습니다.' }, 400);
  }

  let settlement = null as any;
  if (staging_id) {
    settlement = await db.prepare("SELECT * FROM bank_staging WHERE id = ? AND status = 'pending'").bind(staging_id).first<any>();
    if (!settlement) return c.json({ error: '선택한 카드 정산 입금 대기건을 찾을 수 없습니다.' }, 404);
  }

  const settleDate = (settlement_date || settlement?.transaction_date || new Date().toISOString().slice(0, 10)).trim();
  const netAmount = Math.abs(Number(settlement_amount || settlement?.amount || 0) || 0);
  const grossAmount = Math.abs(Number(record.amount || 0) || 0);
  const feeAmount = netAmount > 0 ? Math.max(grossAmount - netAmount, 0) : 0;
  const memo = (note || '').trim();

  await db.prepare(`
    UPDATE sales_records
    SET status = 'confirmed',
        card_deposit_date = ?,
        card_settlement_amount = ?,
        card_fee_amount = ?,
        card_settlement_staging_id = ?,
        card_settlement_note = ?,
        updated_at = datetime('now', '+9 hours')
    WHERE id = ?
  `).bind(settleDate, netAmount, feeAmount, staging_id || '', memo, id).run();

  if (staging_id) {
    await db.prepare("UPDATE bank_staging SET status = 'approved', matched_sales_id = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(id, staging_id).run();
  }

  return c.json({ success: true, sales_id: id, settlement_amount: netAmount, fee_amount: feeAmount, settlement_date: settleDate, confirmed_by: user.sub });
});

accounting.post('/upload-bank', requireRole(...ACCOUNTING_ROLES), async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  await ensureBankStagingColumns(db);
  const { rows } = await c.req.json<{ rows: { depositor?: string; counterparty?: string; amount: number; transaction_date: string; description?: string; direction?: string; category?: string; purpose?: string; raw_json?: string }[] }>();

  if (!rows || rows.length === 0) return c.json({ error: '데이터가 없습니다.' }, 400);

  let inserted = 0;
  let autoExpenses = 0;
  let dupSales = 0;
  let dupStaging = 0;
  const skipped: string[] = [];

  for (const row of rows) {
    const direction = row.direction === 'expense' ? 'expense' : 'income';
    const depositor = normalizeBankText(row.depositor || row.counterparty);
    const counterparty = normalizeBankText(row.counterparty || row.depositor);
    const amount = Math.abs(Number(String(row.amount || 0).replace(/[^0-9.-]/g, '')) || 0);
    const description = normalizeBankText(row.description);
    const purpose = normalizeBankText(row.purpose) || '은행 지출 자동이관';
    const category = classifyBankRow(direction, counterparty || depositor, description, row.category);
    let txDate = row.transaction_date || '';
    if (typeof txDate === 'number') {
      const d = new Date((txDate - 25569) * 86400000);
      txDate = d.toISOString().slice(0, 10);
    }
    txDate = String(txDate).trim();

    if (!depositor || amount <= 0 || !txDate) {
      skipped.push(`${depositor || '?'}: 정보 부족`);
      continue;
    }

    if (direction === 'expense') {
      const autoKey = `bank:auto:${txDate}:${direction}:${depositor}:${amount}:${description}`;
      const existingExpense = await db.prepare(`
        SELECT id FROM sales_records
        WHERE journal_entry_id = ?
           OR (client_name = ? AND amount = ? AND contract_date = ? AND direction = 'expense')
        LIMIT 1
      `).bind(autoKey, depositor, amount, txDate).first();
      if (existingExpense) { dupSales++; continue; }

      const id = crypto.randomUUID();
      await db.prepare(`
        INSERT INTO sales_records (id, user_id, type, type_detail, client_name, depositor_name, amount, contract_date, deposit_date, status, confirmed_at, confirmed_by, branch, department, memo, payment_type, direction, journal_entry_id, exclude_from_count)
        VALUES (?, ?, '기타', ?, ?, ?, ?, ?, ?, 'confirmed', datetime('now', '+9 hours'), ?, ?, ?, ?, '이체', 'expense', ?, 1)
      `).bind(
        id, user.sub, purpose, depositor, depositor, amount, txDate, txDate,
        user.sub, user.branch || '', user.department || '', description, autoKey
      ).run();
      autoExpenses++;
      continue;
    }

    // 1. 업무성과 중복 체크 (입금자명/고객명 + 금액 + 입금일)
    if (direction === 'income' && category === 'sales_match') {
      const salesDup = await db.prepare(`
        SELECT id FROM sales_records
        WHERE direction = 'income'
          AND (depositor_name = ? OR client_name = ?)
          AND amount = ?
          AND (deposit_date = ? OR contract_date = ?)
        LIMIT 1
      `).bind(depositor, depositor, amount, txDate, txDate).first();
      if (salesDup) { dupSales++; continue; }
    }

    // 2. 스테이징 내 중복 체크
    const stagingDup = await db.prepare(
      "SELECT id FROM bank_staging WHERE depositor = ? AND amount = ? AND transaction_date = ? AND COALESCE(direction, 'income') = ? LIMIT 1"
    ).bind(depositor, amount, txDate, direction).first();
    if (stagingDup) { dupStaging++; continue; }

    const id = crypto.randomUUID();
    await db.prepare(
      'INSERT INTO bank_staging (id, depositor, amount, transaction_date, description, created_by, direction, counterparty, category, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(id, depositor, amount, txDate, description, user.sub, direction, counterparty || depositor, category, row.raw_json || '').run();
    inserted++;
  }

  return c.json({ success: true, total: rows.length, inserted, autoExpenses, dupSales, dupStaging, skipped });
});

// GET /api/accounting/staging — 스테이징 목록 조회
accounting.get('/staging', requireRole(...ACCOUNTING_ROLES), async (c) => {
  const db = c.env.DB;
  await ensureBankStagingColumns(db);
  const month = c.req.query('month') || '';

  let query = "SELECT * FROM bank_staging WHERE status = 'pending'";
  const params: any[] = [];
  if (month) {
    query += ' AND transaction_date LIKE ?';
    params.push(month + '%');
  }
  query += ' ORDER BY transaction_date DESC, created_at DESC';

  const result = params.length > 0
    ? await db.prepare(query).bind(...params).all()
    : await db.prepare(query).all();

  return c.json({ items: result.results });
});

// POST /api/accounting/staging/:id/to-sales — 스테이징 → 매출전체로 이동 (새 매출 생성)
accounting.post('/staging/:id/to-sales', requireRole(...ACCOUNTING_ROLES), async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  await ensureBankStagingColumns(db);
  const stagingId = c.req.param('id');
  const { type, user_id, type_detail, direction } = await c.req.json<{ type: string; user_id?: string; type_detail?: string; direction?: string }>();

  const item = await db.prepare('SELECT * FROM bank_staging WHERE id = ?').bind(stagingId).first<any>();
  const entryDirection = direction === 'expense' || item?.direction === 'expense' ? 'expense' : 'income';
  const entryType = type || (entryDirection === 'expense' ? '지출' : '기타수입');
  if (!item) return c.json({ error: '항목을 찾을 수 없습니다.' }, 404);

  // 담당자 정보
  const assignee = user_id
    ? await db.prepare('SELECT id, branch, department FROM users WHERE id = ?').bind(user_id).first<any>()
    : null;

  const salesId = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO sales_records (id, user_id, type, type_detail, client_name, depositor_name, amount, contract_date, deposit_date, status, confirmed_at, confirmed_by, branch, department, memo, payment_type, direction)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', datetime('now', '+9 hours'), ?, ?, ?, ?, '이체', ?)
  `).bind(
    salesId, assignee?.id || user.sub, entryType, type_detail || '',
    item.depositor, item.depositor, item.amount,
    item.transaction_date, item.transaction_date,
    user.sub, assignee?.branch || user.branch || '', assignee?.department || user.department || '',
    item.description || '거래내역 첨부에서 이동', entryDirection
  ).run();

  // 스테이징 상태 업데이트
  await db.prepare("UPDATE bank_staging SET status = 'approved', matched_sales_id = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(salesId, stagingId).run();

  return c.json({ success: true, sales_id: salesId });
});

// DELETE /api/accounting/staging/:id — 스테이징 항목 삭제 (무시)
accounting.delete('/staging/:id', requireRole(...ACCOUNTING_ROLES), async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare("UPDATE bank_staging SET status = 'dismissed', updated_at = datetime('now') WHERE id = ?").bind(id).run();
  return c.json({ success: true });
});

export default accounting;
