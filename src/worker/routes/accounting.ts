import { Hono } from 'hono';
import type { AuthEnv } from '../types';
import { authMiddleware, requireRole } from '../middleware/auth';

const accounting = new Hono<AuthEnv>();
accounting.use('*', authMiddleware);

// 총무 역할 체크 헬퍼
// cc_ref 제외 (회계 열람 제한)
const ACCOUNTING_ROLES = ['master', 'ceo', 'accountant', 'accountant_asst'] as const;
const PROFIT_LOSS_EXTRA_USER_IDS = ['2b6b3606-e425-4361-a115-9283cfef842f'];
const LABOR_COST_EXTRA_USER_IDS = ['2b6b3606-e425-4361-a115-9283cfef842f'];

const CARD_SETTLEMENT_KEYWORDS = [
  '카드', '헥토', '파이낸셜', '나이스', 'nice', '토스', 'toss', '이니시스', 'kg', 'kcp',
  '페이', 'pay', '스마트로', 'ksnet', '다날', '페이먼츠', 'pg',
];

// GET /api/accounting/session2/reports - 확정 저장된 session2 원천/분류/원장 출력 조회
function reportBranchPatterns(branch: string) {
  const compact = branch.replace(/\s+/g, '');
  if (!compact) return [];
  if (compact === '의정부본사' || compact === '의정부') return ['의정부본사', '의정부'];
  return [compact];
}

function pushReportBranchWhere(where: string[], binds: any[], column: string, branch: string) {
  const patterns = reportBranchPatterns(branch);
  if (!patterns.length) return;
  where.push(`(${patterns.map(() => `REPLACE(${column}, ' ', '') LIKE ?`).join(' OR ')})`);
  patterns.forEach((pattern) => binds.push(`%${pattern}%`));
}

function compactBranchName(value: unknown): string {
  return String(value || '').replace(/\s+/g, '').trim();
}

function isRestrictedBranchForAsst(branch: unknown): boolean {
  const compact = compactBranchName(branch);
  return compact === '의정부' || compact === '의정부본사';
}

function getScopedAccountingReportBranch(user: any, requestedBranch: string): string | null {
  if (user?.role === 'accountant_asst') {
    const assignedBranch = String(user?.branch || '').trim();
    if (!assignedBranch || isRestrictedBranchForAsst(assignedBranch)) return null;
    return assignedBranch;
  }
  if (PROFIT_LOSS_EXTRA_USER_IDS.includes(String(user?.sub || ''))) return String(user?.branch || '').trim();
  return requestedBranch;
}

function canAccessProfitLossReport(user: any) {
  if (user?.role === 'accountant_asst') {
    return !!String(user?.branch || '').trim() && !isRestrictedBranchForAsst(user?.branch);
  }
  return user?.role === 'master'
    || user?.role === 'ceo'
    || user?.role === 'accountant'
    || PROFIT_LOSS_EXTRA_USER_IDS.includes(String(user?.sub || ''));
}

function canAccessForecastReport(user: any) {
  return user?.role === 'master'
    || user?.role === 'ceo'
    || user?.role === 'accountant'
    || PROFIT_LOSS_EXTRA_USER_IDS.includes(String(user?.sub || ''));
}

function canEditProfitLossForecast(user: any) {
  return user?.role === 'master' || user?.role === 'accountant';
}

function canAccessLaborCostReport(user: any) {
  return user?.role === 'master'
    || user?.role === 'ceo'
    || user?.role === 'accountant'
    || LABOR_COST_EXTRA_USER_IDS.includes(String(user?.sub || ''));
}

async function ensureAccountingRuleTables(db: D1Database): Promise<void> {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS accounting_card_rules (
      id TEXT PRIMARY KEY,
      card_last4 TEXT NOT NULL,
      branch TEXT NOT NULL DEFAULT '',
      owner_name TEXT NOT NULL DEFAULT '',
      memo TEXT NOT NULL DEFAULT '',
      created_by TEXT,
      updated_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
      UNIQUE(card_last4)
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS accounting_merchant_keyword_rules (
      id TEXT PRIMARY KEY,
      keyword TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      item TEXT NOT NULL DEFAULT '',
      memo TEXT NOT NULL DEFAULT '',
      created_by TEXT,
      updated_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
      UNIQUE(keyword)
    )
  `).run();
}

accounting.get('/session2/reports', requireRole(...ACCOUNTING_ROLES), async (c) => {
  const db = c.env.DB;
  await ensureAccountingSession2Tables(db);

  const user = c.get('user');
  const reportType = String(c.req.query('report_type') || 'expense');
  if (reportType === 'profit-loss' && !canAccessProfitLossReport(user)) {
    return c.json({ error: 'Permission denied.' }, 403);
  }
  const month = String(c.req.query('month') || '').slice(0, 7);
  const branch = getScopedAccountingReportBranch(user, String(c.req.query('branch') || '').trim());
  if ((user?.role === 'accountant_asst' || PROFIT_LOSS_EXTRA_USER_IDS.includes(String(user?.sub || ''))) && !branch) {
    return c.json({ error: 'Assigned branch is required.' }, 403);
  }
  const isReconciliationReport = reportType === 'check-card' || reportType === 'audit';

  const monthWhere = [`COALESCE(le.entry_date, sr.transaction_at) <> ''`];
  const monthBinds: any[] = [];
  if (branch) {
    pushReportBranchWhere(monthWhere, monthBinds, `COALESCE(le.branch, ri.branch, '')`, branch);
  }
  const monthsSql = `
    SELECT DISTINCT substr(COALESCE(le.entry_date, sr.transaction_at), 1, 7) AS month
    FROM accounting_reconciliation_items ri
    JOIN accounting_source_rows sr ON sr.id = ri.source_row_id
    LEFT JOIN accounting_ledger_entries le ON le.reconciliation_id = ri.id
    WHERE ${monthWhere.join(' AND ')}
    ORDER BY month DESC
    LIMIT 36
  `;
  const monthsStatement = db.prepare(monthsSql);
  const months = monthBinds.length
    ? await monthsStatement.bind(...monthBinds).all<{ month: string }>()
    : await monthsStatement.all<{ month: string }>();
  const bookMonthWhere = [
    `status = 'confirmed'`,
    `COALESCE(NULLIF(deposit_date, ''), contract_date) <> ''`,
  ];
  const bookMonthBinds: any[] = [];
  if (branch) {
    pushReportBranchWhere(bookMonthWhere, bookMonthBinds, 'branch', branch);
  }
  const bookMonthsSql = `
    SELECT DISTINCT substr(COALESCE(NULLIF(deposit_date, ''), contract_date), 1, 7) AS month
    FROM sales_records
    WHERE ${bookMonthWhere.join(' AND ')}
    ORDER BY month DESC
    LIMIT 36
  `;
  const bookMonthsStatement = db.prepare(bookMonthsSql);
  const bookMonths = bookMonthBinds.length
    ? await bookMonthsStatement.bind(...bookMonthBinds).all<{ month: string }>()
    : await bookMonthsStatement.all<{ month: string }>();
  const latestImport = await db.prepare(`
    SELECT
      b.id,
      b.file_name,
      b.row_count,
      b.uploaded_at,
      b.confirmed_at,
      b.uploaded_by,
      b.confirmed_by,
      COALESCE(cu.name, uu.name, b.confirmed_by, b.uploaded_by, '') AS user_name,
      COALESCE(cu.email, uu.email, '') AS user_email,
      COALESCE(cu.branch, uu.branch, '') AS user_branch,
      COALESCE(cu.department, uu.department, '') AS user_department
    FROM accounting_import_batches b
    LEFT JOIN users cu ON cu.id = b.confirmed_by
    LEFT JOIN users uu ON uu.id = b.uploaded_by
    WHERE b.source_type = 'session2'
    ORDER BY COALESCE(b.confirmed_at, b.uploaded_at) DESC, b.uploaded_at DESC
    LIMIT 1
  `).first<any>();

  const where: string[] = [];
  const binds: any[] = [];
  if (month) {
    where.push(`substr(${isReconciliationReport ? 'sr.transaction_at' : 'le.entry_date'}, 1, 7) = ?`);
    binds.push(month);
  }
  if (branch) {
    pushReportBranchWhere(where, binds, isReconciliationReport ? 'ri.branch' : 'le.branch', branch);
  }

  let sql = '';
  if (isReconciliationReport) {
    if (reportType === 'check-card') where.push(`sr.source_type = 'checkCard'`);
    if (reportType === 'check-card') where.push(`ri.status = 'reviewed'`);
    sql = `
      SELECT
        ri.id,
        ri.source_row_id,
        COALESCE(le.ledger_type, '') AS ledger_type,
        sr.source_type,
        sr.transaction_at,
        sr.amount,
        sr.direction,
        sr.merchant_name,
        sr.description,
        sr.card_last4,
        ri.branch,
        ri.owner_name,
        ri.category,
        ri.item,
        ri.memo,
        ri.ledger_policy,
        ri.duplicate_status,
        ri.status,
        COALESCE(le.entry_date, sr.transaction_at) AS entry_date
      FROM accounting_reconciliation_items ri
      JOIN accounting_source_rows sr ON sr.id = ri.source_row_id
      LEFT JOIN accounting_ledger_entries le ON le.reconciliation_id = ri.id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY COALESCE(le.entry_date, sr.transaction_at) DESC, ri.created_at DESC
      LIMIT 2000
    `;
  } else {
    if (reportType === 'sales') where.push(`le.ledger_type = 'sales'`);
    if (reportType === 'expense') where.push(`le.ledger_type IN ('expense', 'expense_refund')`);
    if (reportType === 'profit-loss') where.push(`le.ledger_type IN ('sales', 'expense', 'expense_refund')`);
    if (reportType === 'tax') {
      where.push(`(le.category LIKE '%세금%' OR le.category LIKE '%인건비%' OR le.item LIKE '%소득%' OR le.item LIKE '%보험%' OR le.item LIKE '%부가세%')`);
    }
    sql = `
      SELECT
        le.id,
        le.reconciliation_id,
        le.source_row_id,
        le.ledger_type,
        le.entry_date,
        le.branch,
        le.owner_name,
        le.category,
        le.item,
        le.amount,
        le.direction,
        le.memo,
        le.status,
        sr.source_type,
        sr.transaction_at,
        sr.merchant_name,
        sr.description,
        sr.card_last4,
        ri.ledger_policy,
        ri.duplicate_status
      FROM accounting_ledger_entries le
      JOIN accounting_source_rows sr ON sr.id = le.source_row_id
      JOIN accounting_reconciliation_items ri ON ri.id = le.reconciliation_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY le.entry_date DESC, le.created_at DESC
      LIMIT 2000
    `;
  }

  const statement = db.prepare(sql);
  const result = binds.length ? await statement.bind(...binds).all<any>() : await statement.all<any>();
  let rows = result.results || [];
  if (!isReconciliationReport && ['sales', 'expense', 'profit-loss', 'tax'].includes(reportType)) {
    const bookWhere = [`sr.status = 'confirmed'`, `COALESCE(sr.exclude_from_count, 0) = 0`];
    const bookBinds: any[] = [];
    if (reportType === 'sales') bookWhere.push(`COALESCE(sr.direction, 'income') != 'expense'`);
    if (reportType === 'expense' || reportType === 'tax') bookWhere.push(`COALESCE(sr.direction, 'income') = 'expense'`);
    if (reportType === 'tax') {
      bookWhere.push(`(
        sr.type LIKE '%세금%' OR sr.type_detail LIKE '%세금%' OR
        sr.type LIKE '%인건비%' OR sr.type_detail LIKE '%인건비%' OR
        sr.type_detail LIKE '%소득%' OR sr.type_detail LIKE '%보험%' OR sr.type_detail LIKE '%부가세%'
      )`);
    }
    if (month) {
      bookWhere.push(`substr(COALESCE(NULLIF(sr.deposit_date, ''), sr.contract_date), 1, 7) = ?`);
      bookBinds.push(month);
    }
    if (branch) {
      pushReportBranchWhere(bookWhere, bookBinds, 'sr.branch', branch);
    }
    bookWhere.push(`
      NOT EXISTS (
        SELECT 1
        FROM accounting_reconciliation_items ri
        WHERE ri.linked_sales_record_id = sr.id
          AND ri.status = 'reviewed'
      )
    `);

    const bookRowsResult = await db.prepare(`
      SELECT
        'sales:' || sr.id AS id,
        '' AS reconciliation_id,
        '' AS source_row_id,
        CASE WHEN COALESCE(sr.direction, 'income') = 'expense' THEN 'expense' ELSE 'sales' END AS ledger_type,
        COALESCE(NULLIF(sr.deposit_date, ''), sr.contract_date) AS entry_date,
        sr.branch,
        COALESCE(u.name, '') AS owner_name,
        CASE
          WHEN COALESCE(sr.direction, 'income') = 'expense'
            THEN COALESCE(NULLIF(sr.type_detail, ''), NULLIF(sr.type, ''), '회계장부 지출')
          ELSE COALESCE(NULLIF(sr.type, ''), '매출')
        END AS category,
        COALESCE(NULLIF(sr.type_detail, ''), NULLIF(sr.type, ''), '') AS item,
        sr.amount,
        COALESCE(sr.direction, 'income') AS direction,
        COALESCE(sr.memo, '') AS memo,
        sr.status,
        'accountingBook' AS source_type,
        COALESCE(NULLIF(sr.deposit_date, ''), sr.contract_date) AS transaction_at,
        COALESCE(NULLIF(sr.depositor_name, ''), NULLIF(sr.client_name, ''), '') AS merchant_name,
        COALESCE(NULLIF(sr.client_name, ''), NULLIF(sr.type_detail, ''), '') AS description,
        '' AS card_last4,
        '회계장부' AS ledger_policy,
        'unique' AS duplicate_status
      FROM sales_records sr
      LEFT JOIN users u ON u.id = sr.user_id
      WHERE ${bookWhere.join(' AND ')}
      ORDER BY entry_date DESC, sr.created_at DESC
      LIMIT 2000
    `).bind(...bookBinds).all<any>();
    rows = [...rows, ...(bookRowsResult.results || [])]
      .sort((a: any, b: any) => String(b.entry_date || b.transaction_at || '').localeCompare(String(a.entry_date || a.transaction_at || '')))
      .slice(0, 2000);

    if (['expense', 'profit-loss', 'tax'].includes(reportType)) {
      const cardWhere: string[] = [`COALESCE(ct.transaction_date, '') <> ''`];
      const cardBinds: any[] = [];
      if (month) {
        cardWhere.push(`(ct.transaction_date LIKE ? OR ct.transaction_date LIKE ?)`);
        cardBinds.push(`${month}%`, `${month.replace('-', '.')}%`);
      }
      if (branch) {
        pushReportBranchWhere(cardWhere, cardBinds, `COALESCE(NULLIF(ct.branch, ''), ct.category, '')`, branch);
      }
      if (reportType === 'tax') {
        cardWhere.push(`(
          ct.usage_category LIKE '%세금%' OR ct.usage_category LIKE '%인건비%' OR
          ct.usage_item LIKE '%소득%' OR ct.usage_item LIKE '%보험%' OR ct.usage_item LIKE '%부가세%' OR
          ct.usage_item LIKE '%사업소득%' OR ct.usage_item LIKE '%세무%' OR
          ct.description LIKE '%소득%' OR ct.description LIKE '%보험%' OR ct.description LIKE '%부가세%' OR
          ct.merchant_name LIKE '%세무%'
        )`);
      }
      const creditCardRowsResult = await db.prepare(`
        SELECT
          'credit-card:' || ct.id AS id,
          '' AS reconciliation_id,
          '' AS source_row_id,
          CASE WHEN ct.amount < 0 THEN 'expense_refund' ELSE 'expense' END AS ledger_type,
          ct.transaction_date AS entry_date,
          COALESCE(NULLIF(ct.branch, ''), ct.category, '') AS branch,
          COALESCE(u.name, '') AS owner_name,
          COALESCE(NULLIF(ct.usage_category, ''), '신용카드') AS category,
          COALESCE(NULLIF(ct.usage_item, ''), NULLIF(ct.merchant_name, ''), '신용카드 사용') AS item,
          ABS(ct.amount) AS amount,
          CASE WHEN ct.amount < 0 THEN 'income' ELSE 'expense' END AS direction,
          COALESCE(NULLIF(ct.description, ''), NULLIF(ct.merchant_name, ''), '') AS memo,
          'confirmed' AS status,
          'creditCard' AS source_type,
          ct.transaction_date AS transaction_at,
          ct.merchant_name,
          COALESCE(NULLIF(ct.description, ''), NULLIF(ct.usage_item, ''), '') AS description,
          substr(REPLACE(REPLACE(REPLACE(COALESCE(ct.card_number, ''), '-', ''), ' ', ''), '*', ''), -4) AS card_last4,
          '신용카드 사용내역' AS ledger_policy,
          'unique' AS duplicate_status
        FROM card_transactions ct
        LEFT JOIN users u ON u.id = ct.user_id
        WHERE ${cardWhere.join(' AND ')}
        ORDER BY ct.transaction_date DESC, ct.created_at DESC
        LIMIT 2000
      `).bind(...cardBinds).all<any>();
      rows = [...rows, ...(creditCardRowsResult.results || [])]
        .sort((a: any, b: any) => String(b.entry_date || b.transaction_at || '').localeCompare(String(a.entry_date || a.transaction_at || '')))
        .slice(0, 2000);
    }
  }
  const summary = rows.reduce((acc: any, row: any) => {
    const amount = Math.abs(Number(row.amount || 0));
    const isExpenseRefund = row.ledger_type === 'expense_refund';
    const isIncome = !isExpenseRefund && (row.ledger_type === 'sales' || row.direction === 'income');
    if (isExpenseRefund) {
      acc.refund_total += amount;
      acc.expense_total -= amount;
    } else if (isIncome) {
      acc.income_total += amount;
    } else {
      acc.gross_expense_total += amount;
      acc.expense_total += amount;
    }
    acc.row_count += 1;
    acc.net_total = acc.income_total - acc.expense_total;
    return acc;
  }, { row_count: 0, income_total: 0, gross_expense_total: 0, refund_total: 0, expense_total: 0, net_total: 0 });

  return c.json({
    rows,
    summary,
    months: Array.from(new Set([
      ...(months.results || []).map((row) => row.month).filter(Boolean),
      ...(bookMonths.results || []).map((row) => row.month).filter(Boolean),
    ])).sort().reverse(),
    latest_import: latestImport || null,
  });
});

accounting.get('/session2/forecast-adjustments', async (c) => {
  const db = c.env.DB;
  await ensureAccountingSession2Tables(db);
  const user = c.get('user');
  if (!canAccessForecastReport(user)) return c.json({ error: 'Permission denied.' }, 403);
  const month = String(c.req.query('month') || '').slice(0, 7);
  const branch = getScopedAccountingReportBranch(user, String(c.req.query('branch') || '').trim());
  if (!month) return c.json({ error: 'month is required.' }, 400);
  if ((user?.role === 'accountant_asst' || PROFIT_LOSS_EXTRA_USER_IDS.includes(String(user?.sub || ''))) && !branch) return c.json({ error: 'Assigned branch is required.' }, 403);

  const row = await db.prepare(`
    SELECT rows_json, updated_at, updated_by
    FROM accounting_forecast_adjustments
    WHERE period_month = ? AND branch = ?
    LIMIT 1
  `).bind(month, branch || '전체').first<{ rows_json: string; updated_at: string; updated_by: string }>();

  let rows: any[] = [];
  try {
    rows = row?.rows_json ? JSON.parse(row.rows_json) : [];
  } catch {
    rows = [];
  }
  return c.json({ rows: Array.isArray(rows) ? rows : [], updated_at: row?.updated_at || '', updated_by: row?.updated_by || '' });
});

accounting.put('/session2/forecast-adjustments', async (c) => {
  const db = c.env.DB;
  await ensureAccountingSession2Tables(db);
  const user = c.get('user');
  if (!canAccessForecastReport(user)) return c.json({ error: 'Permission denied.' }, 403);
  if (!canEditProfitLossForecast(user)) return c.json({ error: 'Permission denied.' }, 403);
  const body = await c.req.json<{ month?: string; branch?: string; rows?: any[] }>();
  const month = String(body.month || '').slice(0, 7);
  const branch = getScopedAccountingReportBranch(user, String(body.branch || '').trim());
  if (!month) return c.json({ error: 'month is required.' }, 400);
  if ((user?.role === 'accountant_asst' || PROFIT_LOSS_EXTRA_USER_IDS.includes(String(user?.sub || ''))) && !branch) return c.json({ error: 'Assigned branch is required.' }, 403);
  const rows = Array.isArray(body.rows) ? body.rows.slice(0, 100).map((row) => ({
    id: String(row?.id || crypto.randomUUID()),
    label: String(row?.label || '').slice(0, 100),
    amount: String(row?.amount || '').slice(0, 50),
    memo: String(row?.memo || '').slice(0, 300),
  })) : [];
  const id = `${month}:${branch || '전체'}`;

  await db.prepare(`
    INSERT INTO accounting_forecast_adjustments (id, period_month, branch, rows_json, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now', '+9 hours'))
    ON CONFLICT(period_month, branch) DO UPDATE SET
      rows_json = excluded.rows_json,
      updated_by = excluded.updated_by,
      updated_at = datetime('now', '+9 hours')
  `).bind(id, month, branch || '전체', JSON.stringify(rows), user?.sub || '').run();

  return c.json({ success: true, rows });
});

// POST /api/accounting/session2/commit - session1 분류 결과를 원천/분류/원장 테이블에 저장
accounting.post('/session2/commit', requireRole(...ACCOUNTING_ROLES), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  await ensureAccountingSession2Tables(db);
  const body = await c.req.json<{
    batch_hash: string;
    file_name?: string;
    rows: Session2RowInput[];
  }>();

  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) return c.json({ error: '저장할 데이터가 없습니다.' }, 400);
  const batchHash = String(body.batch_hash || '').trim();
  if (!batchHash) return c.json({ error: 'batch_hash가 필요합니다.' }, 400);

  const existingBatch = await db.prepare(
    'SELECT id FROM accounting_import_batches WHERE source_type = ? AND file_hash = ?'
  ).bind('session2', batchHash).first<{ id: string }>();
  const batchId = existingBatch?.id || crypto.randomUUID();
  if (!existingBatch) {
    await db.prepare(`
      INSERT INTO accounting_import_batches (id, source_type, file_name, file_hash, row_count, status, uploaded_by, confirmed_at, confirmed_by)
      VALUES (?, 'session2', ?, ?, ?, 'confirmed', ?, datetime('now', '+9 hours'), ?)
    `).bind(batchId, body.file_name || 'session2', batchHash, rows.length, user?.sub || '', user?.sub || '').run();
  } else {
    await db.prepare(`
      UPDATE accounting_import_batches
      SET file_name = ?, row_count = ?, status = 'confirmed',
          uploaded_by = ?, uploaded_at = datetime('now', '+9 hours'),
          confirmed_by = ?, confirmed_at = datetime('now', '+9 hours')
      WHERE id = ?
    `).bind(body.file_name || 'session2', rows.length, user?.sub || '', user?.sub || '', batchId).run();
  }

  let sourceInserted = 0;
  let sourceSkipped = 0;
  let reconciliationUpserted = 0;
  let ledgerInserted = 0;
  let ledgerSkipped = 0;

  for (const row of rows) {
    const sourceType = row.source_type === 'checkCard' ? 'checkCard' : 'bank';
    const sourceKey = String(row.source_key || '').trim();
    if (!sourceKey) continue;
    const amount = Math.round(Number(row.amount || 0));
    const direction = normalizeAccountingDirection(amount, sourceType);
    const sourceId = crypto.randomUUID();
    const existingSource = await db.prepare(
      'SELECT id FROM accounting_source_rows WHERE source_type = ? AND source_key = ?'
    ).bind(sourceType, sourceKey).first<{ id: string }>();
    const finalSourceId = existingSource?.id || sourceId;
    if (existingSource) {
      sourceSkipped += 1;
    } else {
      await db.prepare(`
        INSERT INTO accounting_source_rows
          (id, batch_id, source_type, row_index, source_key, transaction_at, amount, direction, merchant_name, description, card_last4, balance, raw_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        finalSourceId,
        batchId,
        sourceType,
        Number(row.row_index || 0),
        sourceKey,
        row.transaction_at || '',
        amount,
        direction,
        String(row.merchant_name || '').slice(0, 240),
        String(row.description || '').slice(0, 500),
        String(row.card_last4 || '').slice(-4),
        row.balance ?? null,
        JSON.stringify(row.raw || {}),
      ).run();
      sourceInserted += 1;
    }

    const duplicateStatus = row.duplicate ? 'duplicate' : row.duplicate_status || 'unique';
    const complete = !!row.complete && !row.duplicate;
    const reconciliationStatus = complete ? 'reviewed' : 'draft';
    const ledgerPolicy = String(row.ledger_policy || 'pending');
    const reconciliationId = crypto.randomUUID();
    const existingRecon = await db.prepare(
      'SELECT id FROM accounting_reconciliation_items WHERE source_row_id = ?'
    ).bind(finalSourceId).first<{ id: string }>();
    const finalReconId = existingRecon?.id || reconciliationId;
    if (existingRecon) {
      await db.prepare(`
        UPDATE accounting_reconciliation_items
        SET linked_sales_record_id = ?, branch = ?, owner_name = ?, category = ?, item = ?, memo = ?,
            duplicate_group_key = ?, duplicate_status = ?, ledger_policy = ?, status = ?,
            reviewed_by = ?, reviewed_at = datetime('now', '+9 hours'), updated_at = datetime('now', '+9 hours')
        WHERE id = ?
      `).bind(
        row.linked_sales_record_id || '',
        row.branch || '',
        row.owner_name || '',
        row.category || '',
        row.item || '',
        row.memo || '',
        sourceKey,
        duplicateStatus,
        ledgerPolicy,
        reconciliationStatus,
        user?.sub || '',
        finalReconId,
      ).run();
    } else {
      await db.prepare(`
        INSERT INTO accounting_reconciliation_items
          (id, source_row_id, linked_sales_record_id, branch, owner_name, category, item, memo,
           duplicate_group_key, duplicate_status, ledger_policy, status, reviewed_by, reviewed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+9 hours'))
      `).bind(
        finalReconId,
        finalSourceId,
        row.linked_sales_record_id || '',
        row.branch || '',
        row.owner_name || '',
        row.category || '',
        row.item || '',
        row.memo || '',
        sourceKey,
        duplicateStatus,
        ledgerPolicy,
        reconciliationStatus,
        user?.sub || '',
      ).run();
    }
    reconciliationUpserted += 1;

    if (!complete) {
      await db.prepare('DELETE FROM accounting_ledger_entries WHERE source_row_id = ?').bind(finalSourceId).run();
      ledgerSkipped += 1;
      continue;
    }
    const ledgerType = normalizeLedgerType(ledgerPolicy, row.category || '', direction);
    if (ledgerType === 'evidence') {
      await db.prepare('DELETE FROM accounting_ledger_entries WHERE source_row_id = ?').bind(finalSourceId).run();
      ledgerSkipped += 1;
      continue;
    }
    await db.prepare(
      'DELETE FROM accounting_ledger_entries WHERE source_row_id = ? AND ledger_type <> ?'
    ).bind(finalSourceId, ledgerType).run();
    const existingLedger = await db.prepare(
      'SELECT id FROM accounting_ledger_entries WHERE source_row_id = ? AND ledger_type = ?'
    ).bind(finalSourceId, ledgerType).first<{ id: string }>();
    if (existingLedger) {
      await db.prepare(`
        UPDATE accounting_ledger_entries
        SET reconciliation_id = ?, entry_date = ?, branch = ?, owner_name = ?, category = ?, item = ?,
            amount = ?, direction = ?, memo = ?, status = 'confirmed', created_by = ?,
            updated_at = datetime('now', '+9 hours')
        WHERE id = ?
      `).bind(
        finalReconId,
        String(row.transaction_at || '').slice(0, 10),
        row.branch || '',
        row.owner_name || '',
        row.category || '',
        row.item || '',
        Math.abs(amount),
        direction,
        row.memo || '',
        user?.sub || '',
        existingLedger.id,
      ).run();
      ledgerInserted += 1;
      continue;
    }
    await db.prepare(`
      INSERT INTO accounting_ledger_entries
        (id, reconciliation_id, source_row_id, ledger_type, entry_date, branch, owner_name, category, item, amount, direction, memo, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      finalReconId,
      finalSourceId,
      ledgerType,
      String(row.transaction_at || '').slice(0, 10),
      row.branch || '',
      row.owner_name || '',
      row.category || '',
      row.item || '',
      Math.abs(amount),
      direction,
      row.memo || '',
      user?.sub || '',
    ).run();
    ledgerInserted += 1;
  }

  return c.json({
    success: true,
    batch_id: batchId,
    source_inserted: sourceInserted,
    source_skipped: sourceSkipped,
    reconciliation_upserted: reconciliationUpserted,
    ledger_inserted: ledgerInserted,
    ledger_skipped: ledgerSkipped,
  });
});

async function ensureAccountingSession2Tables(db: D1Database): Promise<void> {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS accounting_import_batches (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      file_name TEXT NOT NULL DEFAULT '',
      file_hash TEXT NOT NULL DEFAULT '',
      row_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft',
      uploaded_by TEXT,
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
      confirmed_at TEXT,
      confirmed_by TEXT,
      notes TEXT NOT NULL DEFAULT '',
      UNIQUE(source_type, file_hash)
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS accounting_source_rows (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      row_index INTEGER NOT NULL,
      source_key TEXT NOT NULL,
      transaction_at TEXT NOT NULL DEFAULT '',
      amount INTEGER NOT NULL DEFAULT 0,
      direction TEXT NOT NULL DEFAULT '',
      merchant_name TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      card_last4 TEXT NOT NULL DEFAULT '',
      balance INTEGER,
      raw_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
      UNIQUE(source_type, source_key)
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS accounting_reconciliation_items (
      id TEXT PRIMARY KEY,
      source_row_id TEXT NOT NULL,
      linked_source_row_id TEXT,
      linked_sales_record_id TEXT,
      branch TEXT NOT NULL DEFAULT '',
      owner_name TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      item TEXT NOT NULL DEFAULT '',
      memo TEXT NOT NULL DEFAULT '',
      duplicate_group_key TEXT NOT NULL DEFAULT '',
      duplicate_status TEXT NOT NULL DEFAULT 'unique',
      ledger_policy TEXT NOT NULL DEFAULT 'pending',
      status TEXT NOT NULL DEFAULT 'draft',
      reviewed_by TEXT,
      reviewed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
      UNIQUE(source_row_id)
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS accounting_ledger_entries (
      id TEXT PRIMARY KEY,
      reconciliation_id TEXT NOT NULL,
      source_row_id TEXT NOT NULL,
      ledger_type TEXT NOT NULL,
      entry_date TEXT NOT NULL DEFAULT '',
      branch TEXT NOT NULL DEFAULT '',
      owner_name TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      item TEXT NOT NULL DEFAULT '',
      amount INTEGER NOT NULL DEFAULT 0,
      direction TEXT NOT NULL DEFAULT '',
      memo TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'confirmed',
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
      UNIQUE(source_row_id, ledger_type)
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS accounting_report_exports (
      id TEXT PRIMARY KEY,
      report_type TEXT NOT NULL,
      period_month TEXT NOT NULL DEFAULT '',
      branch TEXT NOT NULL DEFAULT '',
      file_name TEXT NOT NULL DEFAULT '',
      row_count INTEGER NOT NULL DEFAULT 0,
      source_ledger_hash TEXT NOT NULL DEFAULT '',
      exported_by TEXT,
      exported_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
      notes TEXT NOT NULL DEFAULT ''
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS accounting_forecast_adjustments (
      id TEXT PRIMARY KEY,
      period_month TEXT NOT NULL,
      branch TEXT NOT NULL DEFAULT '전체',
      rows_json TEXT NOT NULL DEFAULT '[]',
      updated_by TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
      UNIQUE(period_month, branch)
    )
  `).run();
}

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

function normalizeLedgerType(policy: string, category: string, direction: string): string {
  if (policy.includes('환불') && direction === 'income') return 'expense_refund';
  if (policy.includes('환불') && direction === 'expense') return 'expense';
  if (policy.includes('대체') || policy.includes('증빙')) return 'evidence';
  if (category === '매출' || direction === 'income') return 'sales';
  return 'expense';
}

function normalizeAccountingDirection(amount: number, sourceType: string): string {
  if (sourceType === 'checkCard') return 'expense';
  if (amount > 0) return 'income';
  if (amount < 0) return 'expense';
  return '';
}

type Session2RowInput = {
  source_type: 'bank' | 'checkCard';
  source_key: string;
  row_index: number;
  transaction_at?: string;
  amount?: number;
  merchant_name?: string;
  description?: string;
  card_last4?: string;
  balance?: number | null;
  raw?: Record<string, unknown>;
  branch?: string;
  owner_name?: string;
  category?: string;
  item?: string;
  memo?: string;
  linked_sales_record_id?: string;
  duplicate_status?: string;
  ledger_policy?: string;
  complete?: boolean;
  duplicate?: boolean;
};

// 총무보조(accountant_asst) 열람·수정 제한 — 팀장·관리자급·이사·대표자는 총무담당만
const RESTRICTED_ROLES_FOR_ASST = ['master', 'ceo', 'cc_ref', 'admin', 'director', 'manager'];
async function canAccessUserAccounting(db: D1Database, viewer: any, targetUserId: string): Promise<boolean> {
  if (viewer.role !== 'accountant_asst') return true;
  if (isRestrictedBranchForAsst(viewer.branch)) return false;
  const target = await db.prepare('SELECT role, branch FROM users WHERE id = ?').bind(targetUserId).first<any>();
  if (!target) return true;
  if (compactBranchName(target.branch) !== compactBranchName(viewer.branch)) return false;
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
    accounts = isRestrictedBranchForAsst(viewer.branch)
      ? []
      : accounts.filter((a: any) => compactBranchName(a.branch) === compactBranchName(viewer.branch) && !RESTRICTED_ROLES_FOR_ASST.includes(a.role));
  }
  return c.json({ accounts });
});

// GET /api/accounting/reports/labor-cost - 고정급 인건비 통합 출력
accounting.get('/reports/labor-cost', requireRole(...ACCOUNTING_ROLES), async (c) => {
  const user = c.get('user');
  if (!canAccessLaborCostReport(user)) return c.json({ error: 'Permission denied.' }, 403);
  const db = c.env.DB;
  const result = await db.prepare(`
    SELECT
      ua.user_id,
      ua.salary,
      ua.position_allowance,
      ua.grade,
      ua.pay_type,
      u.name AS user_name,
      u.branch,
      u.department,
      u.position_title,
      u.role
    FROM user_accounting ua
    JOIN users u ON u.id = ua.user_id
    WHERE u.approved = 1
      AND u.role != 'resigned'
      AND COALESCE(ua.pay_type, 'salary') = 'salary'
      AND (COALESCE(ua.salary, 0) > 0 OR COALESCE(ua.position_allowance, 0) > 0)
    ORDER BY u.branch ASC, u.department ASC, u.position_title ASC, u.name ASC
  `).all<any>();
  const rows = (result.results || []).map((row: any) => ({
    user_id: row.user_id,
    name: row.user_name || '',
    branch: row.branch || '',
    department: row.department || '',
    position_title: row.position_title || '',
    grade: row.grade || '',
    role: row.role || '',
    salary: Number(row.salary || 0),
    position_allowance: Number(row.position_allowance || 0),
    total: Number(row.salary || 0) + Number(row.position_allowance || 0),
  }));
  const summary = rows.reduce((acc: any, row: any) => {
    acc.total_salary += row.salary;
    acc.total_allowance += row.position_allowance;
    acc.total_labor_cost += row.total;
    acc.staff_count += 1;
    return acc;
  }, { total_salary: 0, total_allowance: 0, total_labor_cost: 0, staff_count: 0 });
  return c.json({ rows, summary });
});

accounting.get('/rules/check-card', requireRole(...ACCOUNTING_ROLES), async (c) => {
  const db = c.env.DB;
  await ensureAccountingRuleTables(db);
  const cardRules = await db.prepare(`
    SELECT id, card_last4, branch, owner_name, memo, created_at, updated_at
    FROM accounting_card_rules
    ORDER BY branch ASC, owner_name ASC, card_last4 ASC
  `).all();
  const keywordRules = await db.prepare(`
    SELECT id, keyword, category, item, memo, created_at, updated_at
    FROM accounting_merchant_keyword_rules
    ORDER BY category ASC, item ASC, keyword ASC
  `).all();
  return c.json({
    card_rules: cardRules.results || [],
    keyword_rules: keywordRules.results || [],
  });
});

accounting.post('/rules/check-card/card', requireRole(...ACCOUNTING_ROLES), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  await ensureAccountingRuleTables(db);
  const body: any = await c.req.json().catch(() => ({}));
  const cardLast4 = String(body.card_last4 || body.last4 || '').replace(/\D/g, '').slice(-4);
  if (cardLast4.length !== 4) return c.json({ error: '카드 뒷자리 4자리가 필요합니다.' }, 400);
  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO accounting_card_rules (id, card_last4, branch, owner_name, memo, created_by, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(card_last4) DO UPDATE SET
      branch = excluded.branch,
      owner_name = excluded.owner_name,
      memo = excluded.memo,
      updated_by = excluded.updated_by,
      updated_at = datetime('now', '+9 hours')
  `).bind(id, cardLast4, String(body.branch || ''), String(body.owner_name || body.owner || ''), String(body.memo || ''), user?.sub || '', user?.sub || '').run();
  const row = await db.prepare('SELECT id, card_last4, branch, owner_name, memo, created_at, updated_at FROM accounting_card_rules WHERE card_last4 = ?')
    .bind(cardLast4)
    .first();
  return c.json({ rule: row });
});

accounting.put('/rules/check-card/card/:id', requireRole(...ACCOUNTING_ROLES), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  await ensureAccountingRuleTables(db);
  const id = c.req.param('id');
  const body: any = await c.req.json().catch(() => ({}));
  const cardLast4 = String(body.card_last4 || body.last4 || '').replace(/\D/g, '').slice(-4);
  if (cardLast4.length !== 4) return c.json({ error: '카드 뒷자리 4자리가 필요합니다.' }, 400);
  await db.prepare(`
    UPDATE accounting_card_rules
    SET card_last4 = ?, branch = ?, owner_name = ?, memo = ?, updated_by = ?, updated_at = datetime('now', '+9 hours')
    WHERE id = ?
  `).bind(cardLast4, String(body.branch || ''), String(body.owner_name || body.owner || ''), String(body.memo || ''), user?.sub || '', id).run();
  const row = await db.prepare('SELECT id, card_last4, branch, owner_name, memo, created_at, updated_at FROM accounting_card_rules WHERE id = ?')
    .bind(id)
    .first();
  return c.json({ rule: row });
});

accounting.delete('/rules/check-card/card/:id', requireRole(...ACCOUNTING_ROLES), async (c) => {
  const db = c.env.DB;
  await ensureAccountingRuleTables(db);
  await db.prepare('DELETE FROM accounting_card_rules WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ success: true });
});

accounting.post('/rules/check-card/keyword', requireRole(...ACCOUNTING_ROLES), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  await ensureAccountingRuleTables(db);
  const body: any = await c.req.json().catch(() => ({}));
  const keyword = String(body.keyword || '').trim();
  if (!keyword) return c.json({ error: '가맹점 키워드가 필요합니다.' }, 400);
  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO accounting_merchant_keyword_rules (id, keyword, category, item, memo, created_by, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(keyword) DO UPDATE SET
      category = excluded.category,
      item = excluded.item,
      memo = excluded.memo,
      updated_by = excluded.updated_by,
      updated_at = datetime('now', '+9 hours')
  `).bind(id, keyword, String(body.category || ''), String(body.item || ''), String(body.memo || ''), user?.sub || '', user?.sub || '').run();
  const row = await db.prepare('SELECT id, keyword, category, item, memo, created_at, updated_at FROM accounting_merchant_keyword_rules WHERE keyword = ?')
    .bind(keyword)
    .first();
  return c.json({ rule: row });
});

accounting.put('/rules/check-card/keyword/:id', requireRole(...ACCOUNTING_ROLES), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  await ensureAccountingRuleTables(db);
  const id = c.req.param('id');
  const body: any = await c.req.json().catch(() => ({}));
  const keyword = String(body.keyword || '').trim();
  if (!keyword) return c.json({ error: '가맹점 키워드가 필요합니다.' }, 400);
  await db.prepare(`
    UPDATE accounting_merchant_keyword_rules
    SET keyword = ?, category = ?, item = ?, memo = ?, updated_by = ?, updated_at = datetime('now', '+9 hours')
    WHERE id = ?
  `).bind(keyword, String(body.category || ''), String(body.item || ''), String(body.memo || ''), user?.sub || '', id).run();
  const row = await db.prepare('SELECT id, keyword, category, item, memo, created_at, updated_at FROM accounting_merchant_keyword_rules WHERE id = ?')
    .bind(id)
    .first();
  return c.json({ rule: row });
});

accounting.delete('/rules/check-card/keyword/:id', requireRole(...ACCOUNTING_ROLES), async (c) => {
  const db = c.env.DB;
  await ensureAccountingRuleTables(db);
  await db.prepare('DELETE FROM accounting_merchant_keyword_rules WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ success: true });
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
