import { Hono } from 'hono';
import type { AuthEnv } from '../types';
import { authMiddleware, requireRole } from '../middleware/auth';

const payroll = new Hono<AuthEnv>();
payroll.use('*', authMiddleware);

const ACCOUNTING_ROLES = ['master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst'] as const;

// GET /api/payroll/:userId?month=YYYY-MM
// month가 속한 2개월 구간을 자동 계산 (3-4월, 5-6월, 7-8월...)
payroll.get('/:userId', requireRole(...ACCOUNTING_ROLES), async (c) => {
  const userId = c.req.param('userId');
  const month = c.req.query('month') || new Date().toISOString().slice(0, 7);
  const db = c.env.DB;

  // 2개월 구간 계산: 홀수월 시작 (1-2, 3-4, 5-6, 7-8, 9-10, 11-12)
  const [yearStr, monthStr] = month.split('-');
  const y = Number(yearStr);
  const m = Number(monthStr);
  const periodStartMonth = m % 2 === 0 ? m - 1 : m;
  const periodEndMonth = periodStartMonth + 1;
  const periodStart = `${y}-${String(periodStartMonth).padStart(2, '0')}-01`;
  const lastDay = new Date(y, periodEndMonth, 0).getDate();
  const periodEnd = `${y}-${String(periodEndMonth).padStart(2, '0')}-${lastDay}`;

  const user = await db.prepare(
    'SELECT id, name, branch, department, position_title, role FROM users WHERE id = ?'
  ).bind(userId).first<any>();
  if (!user) return c.json({ error: '사용자를 찾을 수 없습니다.' }, 404);

  const accounting = await db.prepare(
    'SELECT salary, standard_sales, grade, position_allowance FROM user_accounting WHERE user_id = ?'
  ).bind(userId).first<any>();

  // 2개월 구간의 매출 조회
  const salesResult = await db.prepare(`
    SELECT id, type, type_detail, client_name, depositor_name, depositor_different,
      amount, contract_date, deposit_date, status, confirmed_at, memo
    FROM sales_records
    WHERE user_id = ? AND status IN ('confirmed', 'refunded')
      AND contract_date >= ? AND contract_date <= ?
    ORDER BY contract_date ASC
  `).bind(userId, periodStart, periodEnd).all();

  const records = salesResult.results as any[];
  const contractCount = records.filter((r: any) => r.type === '계약' && r.status === 'confirmed').length;
  const confirmedRecords = records.filter((r: any) => r.status === 'confirmed');
  const totalSales = confirmedRecords.reduce((sum: number, r: any) => sum + (r.amount || 0), 0);
  const refundedRecords = records.filter((r: any) => r.status === 'refunded');
  const totalRefund = refundedRecords.reduce((sum: number, r: any) => sum + (r.amount || 0), 0);

  const salary = accounting?.salary || 0;
  const standardSales = accounting?.standard_sales || 0;
  const positionAllowance = accounting?.position_allowance || 0;

  // 무급휴가 공제 계산: 해당 구간 내 승인된 무급휴가(특별휴가-기타) 조회
  const unpaidLeaveResult = await db.prepare(`
    SELECT COALESCE(SUM(days), 0) as total_days FROM leave_requests
    WHERE user_id = ? AND status = 'approved'
      AND leave_type = '특별휴가' AND instr(reason, '기타') > 0
      AND start_date >= ? AND start_date <= ?
  `).bind(userId, periodStart, periodEnd).first<any>();
  const unpaidLeaveDays = unpaidLeaveResult?.total_days || 0;
  // 무급휴가 공제: 월급 ÷ 209h × 8 × 무급휴가 일수
  const unpaidLeaveDeduction = salary > 0 ? Math.round((salary / 209) * 8 * unpaidLeaveDays) : 0;

  // 상여금 계산 (구간별 누진)
  // 0 ~ 501만원 미만: 20%, 501만원 이상 ~ 1501만원 미만: 25%, 1501만원 이상: 30%
  const excess = Math.max(totalSales - standardSales, 0);
  let bonus = 0;
  if (excess > 0) {
    if (excess < 5010000) {
      bonus = Math.round(excess * 0.20);
    } else if (excess < 15010000) {
      bonus = Math.round(5010000 * 0.20 + (excess - 5010000) * 0.25);
    } else {
      bonus = Math.round(5010000 * 0.20 + 10000000 * 0.25 + (excess - 15010000) * 0.30);
    }
  }

  // 부가세 분리
  const recordsWithVat = confirmedRecords.map((r: any) => {
    const supply = Math.round(r.amount / 1.1);
    const vat = r.amount - supply;
    return { ...r, supply_amount: supply, vat_amount: vat };
  });

  return c.json({
    user,
    accounting: accounting || { salary: 0, standard_sales: 0, grade: '', position_allowance: 0 },
    month,
    period_start: periodStart,
    period_end: periodEnd,
    period_label: `${y}년 ${periodStartMonth}~${periodEndMonth}월`,
    records: recordsWithVat,
    refunded_records: refundedRecords,
    summary: {
      contract_count: contractCount,
      total_sales: totalSales,
      total_supply: Math.round(totalSales / 1.1),
      total_vat: totalSales - Math.round(totalSales / 1.1),
      total_refund: totalRefund,
      net_sales: totalSales - totalRefund,
      standard_sales: standardSales,
      excess,
      bonus,
      salary,
      position_allowance: positionAllowance,
      // 총지급액 = ((기본급+직급수당)-공제합계) + 상여금 + 기타
      // 공제/기타는 프론트에서 입력하므로 여기서는 base만
      base_pay: salary + positionAllowance,
      unpaid_leave_days: unpaidLeaveDays,
      unpaid_leave_deduction: unpaidLeaveDeduction,
      company_profit: totalSales - totalRefund - salary - positionAllowance - bonus + unpaidLeaveDeduction,
    },
  });
});

// GET /api/payroll/branch-summary?month=YYYY-MM&branch=xxx — 지사별 합산
payroll.get('/branch/summary', requireRole(...ACCOUNTING_ROLES), async (c) => {
  const month = c.req.query('month') || new Date().toISOString().slice(0, 7);
  const filterBranch = c.req.query('branch') || '';
  const db = c.env.DB;

  // 조건
  let branchWhere = '';
  const params: any[] = [month + '%'];
  if (filterBranch) { branchWhere = ' AND sr.branch = ?'; params.push(filterBranch); }

  // 매출 합산
  const salesResult = await db.prepare(`
    SELECT sr.branch,
      COUNT(*) as total_count,
      SUM(CASE WHEN sr.status = 'confirmed' THEN sr.amount ELSE 0 END) as confirmed_total,
      SUM(CASE WHEN sr.status = 'refunded' THEN sr.amount ELSE 0 END) as refunded_total,
      SUM(CASE WHEN sr.status = 'pending' THEN sr.amount ELSE 0 END) as pending_total,
      SUM(CASE WHEN sr.type = '계약' AND sr.status = 'confirmed' THEN 1 ELSE 0 END) as contract_count
    FROM sales_records sr
    WHERE sr.contract_date LIKE ?${branchWhere}
    GROUP BY sr.branch
  `).bind(...params).all();

  // 인건비 합산 (급여 + 직급수당)
  const laborResult = await db.prepare(`
    SELECT u.branch,
      SUM(ua.salary) as total_salary,
      SUM(ua.position_allowance) as total_allowance,
      COUNT(*) as staff_count
    FROM user_accounting ua
    JOIN users u ON u.id = ua.user_id
    WHERE u.approved = 1${filterBranch ? ' AND u.branch = ?' : ''}
    GROUP BY u.branch
  `).bind(...(filterBranch ? [filterBranch] : [])).all();

  // 합치기
  const branches: Record<string, any> = {};
  for (const row of salesResult.results as any[]) {
    branches[row.branch || '미지정'] = {
      branch: row.branch || '미지정',
      total_count: row.total_count,
      confirmed_total: row.confirmed_total || 0,
      refunded_total: row.refunded_total || 0,
      pending_total: row.pending_total || 0,
      contract_count: row.contract_count || 0,
      total_salary: 0, total_allowance: 0, staff_count: 0,
    };
  }
  for (const row of laborResult.results as any[]) {
    const key = row.branch || '미지정';
    if (!branches[key]) branches[key] = { branch: key, total_count: 0, confirmed_total: 0, refunded_total: 0, pending_total: 0, contract_count: 0 };
    branches[key].total_salary = row.total_salary || 0;
    branches[key].total_allowance = row.total_allowance || 0;
    branches[key].staff_count = row.staff_count || 0;
  }

  return c.json({ month, branches: Object.values(branches) });
});

export default payroll;
