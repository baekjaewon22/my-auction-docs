import { Hono } from 'hono';
import type { AuthEnv } from '../types';
import { authMiddleware, requireRole } from '../middleware/auth';

const analytics = new Hono<AuthEnv>();
analytics.use('*', authMiddleware);

// 회계분석: cc_ref·accountant_asst 제외
const ANALYTICS_ROLES = ['master', 'ceo', 'admin', 'accountant'] as const;

function buildExpenseSourceSql(includeSessionLedger: boolean) {
  const parts = [
    `
      SELECT
        contract_date AS transaction_date,
        COALESCE(NULLIF(type_detail, ''), NULLIF(type, ''), '회계장부 지출') AS category,
        amount AS amount,
        branch,
        '회계장부' AS source
      FROM sales_records
      WHERE status = 'confirmed'
        AND direction = 'expense'
        AND contract_date >= ?
    `,
  ];

  if (includeSessionLedger) {
    parts.push(`
      SELECT
        entry_date AS transaction_date,
        COALESCE(NULLIF(category, ''), '미분류') AS category,
        CASE WHEN ledger_type = 'expense_refund' THEN -ABS(amount) ELSE ABS(amount) END AS amount,
        branch,
        '분류엔진' AS source
      FROM accounting_ledger_entries
      WHERE ledger_type IN ('expense', 'expense_refund')
        AND entry_date >= ?
    `);
  }

  const cardLedgerDuplicateGuard = includeSessionLedger ? `
    AND NOT EXISTS (
      SELECT 1
      FROM accounting_ledger_entries le
      JOIN accounting_source_rows sr ON sr.id = le.source_row_id
      WHERE le.ledger_type IN ('expense', 'expense_refund')
        AND sr.source_type = 'checkCard'
        AND substr(sr.transaction_at, 1, 10) = ct.transaction_date
        AND ABS(sr.amount) = ABS(ct.amount)
        AND (
          COALESCE(sr.card_last4, '') = ''
          OR substr(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(ct.card_number, ''), '-', ''), '*', ''), '_', ''), ' ', ''), '.', ''), -4) = sr.card_last4
        )
        AND (
          COALESCE(sr.merchant_name, '') = ''
          OR COALESCE(ct.merchant_name, '') = ''
          OR sr.merchant_name = ct.merchant_name
          OR instr(sr.merchant_name, ct.merchant_name) > 0
          OR instr(ct.merchant_name, sr.merchant_name) > 0
        )
      LIMIT 1
    )
  ` : '';

  parts.push(`
    SELECT
      ct.transaction_date,
      COALESCE(
        NULLIF(ct.usage_category, ''),
        CASE
          WHEN ct.category IN ('의정부', '의정부본사', '서초', '대전', '부산', '본사', '본사관리', '강남', '강남지사') THEN NULL
          ELSE NULLIF(ct.category, '')
        END,
        '카드사용내역'
      ) AS category,
      ct.amount,
      ct.branch,
      '카드사용내역' AS source
    FROM card_transactions ct
    WHERE ct.transaction_date >= ?
      ${cardLedgerDuplicateGuard}
  `);

  return parts.join('\nUNION ALL\n');
}

function expenseBinds(startDate: string, includeSessionLedger: boolean) {
  return includeSessionLedger ? [startDate, startDate, startDate] : [startDate, startDate];
}

// GET /api/analytics/summary?months=6
analytics.get('/summary', requireRole(...ANALYTICS_ROLES), async (c) => {
  const db = c.env.DB;
  const monthsBack = Number(c.req.query('months') || '6');

  // 최근 N개월 월 목록 생성
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const monthList: string[] = [];
  for (let i = 0; i < monthsBack; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthList.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  monthList.reverse();
  const startDate = monthList[0] + '-01';
  const hasSessionLedger = !!(await db.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'accounting_ledger_entries'
  `).first<{ name: string }>());
  const expenseSourceSql = buildExpenseSourceSql(hasSessionLedger);
  const expenseStartBinds = expenseBinds(startDate, hasSessionLedger);

  // 1. 월별 매출 (confirmed) — 공급가액 기준 (÷1.1)
  const salesByMonth = await db.prepare(`
    SELECT substr(contract_date, 1, 7) as month,
      SUM(CASE WHEN status = 'confirmed' THEN ROUND(amount / 1.1) ELSE 0 END) as revenue,
      SUM(CASE WHEN status = 'refunded' THEN ROUND(amount / 1.1) ELSE 0 END) as refunded,
      COUNT(CASE WHEN status = 'confirmed' THEN 1 END) as confirmed_count
    FROM sales_records
    WHERE contract_date >= ?
      AND direction != 'expense'
      AND COALESCE(exclude_from_count, 0) = 0
    GROUP BY month ORDER BY month
  `).bind(startDate).all();

  // 2. 월별 통합 지출: 회계장부 직접 지출 + 분류엔진 확정 원장 + 기존 카드사용내역
  const expenseByMonth = await db.prepare(`
    WITH expense_source AS (${expenseSourceSql})
    SELECT substr(transaction_date, 1, 7) as month,
      SUM(amount) as total,
      category,
      COUNT(*) as count
    FROM expense_source
    GROUP BY month, category ORDER BY month
  `).bind(...expenseStartBinds).all();

  // 3. 월별 급여 총액 (user_accounting 기반 — 현재 시점 급여 × 인원수)
  const salaryTotal = await db.prepare(`
    SELECT SUM(salary + position_allowance) as total_salary,
      COUNT(*) as headcount
    FROM user_accounting
    WHERE salary > 0
  `).first<{ total_salary: number; headcount: number }>();

  // 4. 매출 유형별 비중 — 공급가액 기준
  const salesByType = await db.prepare(`
    SELECT type, SUM(ROUND(amount / 1.1)) as total, COUNT(*) as count
    FROM sales_records
    WHERE status = 'confirmed' AND contract_date >= ?
      AND direction != 'expense'
      AND COALESCE(exclude_from_count, 0) = 0
    GROUP BY type ORDER BY total DESC
  `).bind(startDate).all();

  // 5. 담당자별 매출 순위 — 공급가액 기준
  const salesByUser = await db.prepare(`
    SELECT sr.user_id, u.name, u.branch, u.department,
      SUM(ROUND(sr.amount / 1.1)) as total, COUNT(*) as count
    FROM sales_records sr
    JOIN users u ON sr.user_id = u.id
    WHERE sr.status = 'confirmed' AND sr.contract_date >= ?
      AND sr.direction != 'expense'
      AND COALESCE(sr.exclude_from_count, 0) = 0
    GROUP BY sr.user_id ORDER BY total DESC LIMIT 15
  `).bind(startDate).all();

  // 6. 지사별 매출 — 공급가액 기준
  const salesByBranch = await db.prepare(`
    SELECT branch, SUM(ROUND(amount / 1.1)) as total, COUNT(*) as count
    FROM sales_records
    WHERE status = 'confirmed' AND contract_date >= ?
      AND direction != 'expense'
      AND COALESCE(exclude_from_count, 0) = 0
    GROUP BY branch ORDER BY total DESC
  `).bind(startDate).all();

  // 7. 미수금 현황 (pending)
  const receivables = await db.prepare(`
    SELECT COUNT(*) as count, SUM(amount) as total,
      MIN(contract_date) as oldest_date
    FROM sales_records
    WHERE status = 'pending'
      AND direction != 'expense'
      AND COALESCE(exclude_from_count, 0) = 0
  `).first<{ count: number; total: number; oldest_date: string }>();

  // 30일 이상 미수금
  const thirtyDaysAgo = new Date(Date.now() + 9 * 60 * 60 * 1000 - 30 * 86400000).toISOString().slice(0, 10);
  const oldReceivables = await db.prepare(`
    SELECT COUNT(*) as count, SUM(amount) as total
    FROM sales_records
    WHERE status = 'pending' AND contract_date < ?
      AND direction != 'expense'
      AND COALESCE(exclude_from_count, 0) = 0
  `).bind(thirtyDaysAgo).first<{ count: number; total: number }>();

  // 8. 통합 지출 카테고리별 총액 (파이차트용)
  const expenseByCategory = await db.prepare(`
    WITH expense_source AS (${expenseSourceSql})
    SELECT category, SUM(amount) as total, COUNT(*) as count
    FROM expense_source
    GROUP BY category ORDER BY total DESC
  `).bind(...expenseStartBinds).all();

  // 9. 지출 점검: 전월 대비 카테고리별 증감
  const currentMonth = monthList[monthList.length - 1];
  const prevMonth = monthList.length >= 2 ? monthList[monthList.length - 2] : '';

  let spendingAlerts: any[] = [];
  if (prevMonth) {
    const curSpend = await db.prepare(`
      WITH expense_source AS (${expenseSourceSql})
      SELECT category, SUM(amount) as total FROM expense_source
      WHERE substr(transaction_date, 1, 7) = ? GROUP BY category
    `).bind(...expenseStartBinds, currentMonth).all();

    const prevSpend = await db.prepare(`
      WITH expense_source AS (${expenseSourceSql})
      SELECT category, SUM(amount) as total FROM expense_source
      WHERE substr(transaction_date, 1, 7) = ? GROUP BY category
    `).bind(...expenseStartBinds, prevMonth).all();

    const prevMap: Record<string, number> = {};
    (prevSpend.results as any[]).forEach(r => { prevMap[r.category] = r.total; });

    spendingAlerts = (curSpend.results as any[])
      .map(r => {
        const prev = prevMap[r.category] || 0;
        const change = prev > 0 ? Math.round(((r.total - prev) / prev) * 100) : 0;
        return { category: r.category, current: r.total, previous: prev, change };
      })
      .filter(r => r.change > 30 || r.current > 1000000)
      .sort((a, b) => b.change - a.change);
  }

  // 10. 주요 비율 지표
  const totalRevenue = (salesByMonth.results as any[]).reduce((s, r) => s + (r.revenue || 0), 0);
  const totalExpenseSpend = (expenseByCategory.results as any[]).reduce((s, r) => s + (r.total || 0), 0);
  const monthlySalary = salaryTotal?.total_salary || 0;
  const laborRatio = totalRevenue > 0 ? Math.round((monthlySalary * monthsBack / totalRevenue) * 100) : 0;
  const profitRatio = totalRevenue > 0 ? Math.round(((totalRevenue - totalExpenseSpend - monthlySalary * monthsBack) / totalRevenue) * 100) : 0;

  return c.json({
    months: monthList,
    salesByMonth: salesByMonth.results,
    cardByMonth: expenseByMonth.results,
    expenseByMonth: expenseByMonth.results,
    salaryTotal,
    salesByType: salesByType.results,
    salesByUser: salesByUser.results,
    salesByBranch: salesByBranch.results,
    receivables: {
      pending: receivables || { count: 0, total: 0, oldest_date: '' },
      overdue: oldReceivables || { count: 0, total: 0 },
    },
    cardByCategory: expenseByCategory.results,
    expenseByCategory: expenseByCategory.results,
    spendingAlerts,
    ratios: {
      laborRatio,
      profitRatio,
      cardRatio: totalRevenue > 0 ? Math.round((totalExpenseSpend / totalRevenue) * 100) : 0,
      expenseRatio: totalRevenue > 0 ? Math.round((totalExpenseSpend / totalRevenue) * 100) : 0,
      totalRevenue,
      totalCardSpend: totalExpenseSpend,
      totalExpenseSpend,
      monthlySalary,
    },
    basis: {
      revenue: '회계장부 업무성과',
      expense: hasSessionLedger ? '회계장부 직접 지출 + 분류엔진 확정 원장 우선 + 미이관 카드사용내역' : '회계장부 직접 지출 + 카드사용내역',
    },
  });
});

export default analytics;
