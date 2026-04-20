import { Hono } from 'hono';
import type { AuthEnv } from '../types';
import { authMiddleware, requireRole } from '../middleware/auth';

const payroll = new Hono<AuthEnv>();
payroll.use('*', authMiddleware);

const ACCOUNTING_ROLES = ['master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst'] as const;

// 총무보조(accountant_asst) 열람 제한 — 팀장·관리자급·이사·대표자 정산은 총무담당만 접근 가능
const RESTRICTED_ROLES_FOR_ASST = ['master', 'ceo', 'cc_ref', 'admin', 'director', 'manager'];
async function canAccessUserPayroll(db: D1Database, viewer: any, targetUserId: string): Promise<boolean> {
  if (viewer.role !== 'accountant_asst') return true;
  const target = await db.prepare('SELECT role FROM users WHERE id = ?').bind(targetUserId).first<any>();
  if (!target) return true;
  return !RESTRICTED_ROLES_FOR_ASST.includes(target.role);
}

// GET /api/payroll/:userId?month=YYYY-MM
// 급여제: 1개월 정산 + 성과금은 2개월 기준
// 비율제: 1개월 정산
// 매출 기준: 카드→card_deposit_date, 이체→deposit_date, 미지정→contract_date
payroll.get('/:userId', requireRole(...ACCOUNTING_ROLES), async (c) => {
  const userId = c.req.param('userId');
  const month = c.req.query('month') || new Date().toISOString().slice(0, 7);
  const db = c.env.DB;
  const viewer = c.get('user');
  if (!(await canAccessUserPayroll(db, viewer, userId))) {
    return c.json({ error: '해당 직원의 정산 정보 열람 권한이 없습니다.' }, 403);
  }

  const [yearStr, monthStr] = month.split('-');
  const y = Number(yearStr);
  const m = Number(monthStr);

  // 1개월 구간 (급여/비율 공통)
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-${new Date(y, m, 0).getDate()}`;

  // 2개월 구간 (성과금 계산용 — 급여제만)
  const bonusPeriodStartMonth = m % 2 === 0 ? m - 1 : m;
  const bonusPeriodEndMonth = bonusPeriodStartMonth + 1;
  const bonusPeriodStart = `${y}-${String(bonusPeriodStartMonth).padStart(2, '0')}-01`;
  const bonusPeriodEnd = `${y}-${String(bonusPeriodEndMonth).padStart(2, '0')}-${new Date(y, bonusPeriodEndMonth, 0).getDate()}`;

  const user = await db.prepare(
    'SELECT id, name, branch, department, position_title, role FROM users WHERE id = ?'
  ).bind(userId).first<any>();
  if (!user) return c.json({ error: '사용자를 찾을 수 없습니다.' }, 404);

  const accounting = await db.prepare(
    'SELECT salary, standard_sales, grade, position_allowance, pay_type, commission_rate FROM user_accounting WHERE user_id = ?'
  ).bind(userId).first<any>();

  // 2026년 1~2월은 전원 프리랜서(비율 50%) — 강제 적용
  // 예외: commission_rate_overrides 테이블에 유저별 월별 예외 비율 저장 가능
  const isJanFeb2026 = y === 2026 && m <= 2;
  const isCommission = isJanFeb2026 ? true : (accounting?.pay_type === 'commission');
  const override = await db.prepare(
    'SELECT commission_rate FROM commission_rate_overrides WHERE user_id = ? AND year_month = ?'
  ).bind(userId, month).first<any>().catch(() => null);
  const effectiveRate = override?.commission_rate !== undefined
    ? override.commission_rate
    : (isJanFeb2026 ? 50 : (accounting?.commission_rate || 0));

  // 매출 조회: 1개월 기준 (카드→card_deposit_date, 이체→deposit_date, 미지정→contract_date)
  const salesQuery = `
    SELECT id, type, type_detail, client_name, depositor_name, depositor_different,
      amount, contract_date, deposit_date, status, confirmed_at, memo,
      payment_type, card_deposit_date, proxy_cost
    FROM sales_records
    WHERE user_id = ? AND status IN ('confirmed', 'refunded')
      AND (
        (payment_type = '카드' AND card_deposit_date >= ? AND card_deposit_date <= ?)
        OR (payment_type != '카드' AND payment_type != '' AND deposit_date >= ? AND deposit_date <= ?)
        OR ((payment_type = '' OR payment_type IS NULL) AND contract_date >= ? AND contract_date <= ?)
      )
    ORDER BY contract_date ASC
  `;
  const salesResult = await db.prepare(salesQuery)
    .bind(userId, monthStart, monthEnd, monthStart, monthEnd, monthStart, monthEnd).all();

  const records = salesResult.results as any[];
  // 계약건수: 급여제는 2개월 기준, 비율제는 1개월 기준
  let contractCount: number;
  if (!isCommission) {
    // 2개월 기준 계약건수 별도 조회
    const ccResult = await db.prepare(`
      SELECT COUNT(*) as cnt FROM sales_records
      WHERE user_id = ? AND type = '계약' AND status = 'confirmed'
        AND (
          (payment_type = '카드' AND card_deposit_date >= ? AND card_deposit_date <= ?)
          OR (payment_type != '카드' AND payment_type != '' AND deposit_date >= ? AND deposit_date <= ?)
          OR ((payment_type = '' OR payment_type IS NULL) AND contract_date >= ? AND contract_date <= ?)
        )
    `).bind(userId, bonusPeriodStart, bonusPeriodEnd, bonusPeriodStart, bonusPeriodEnd, bonusPeriodStart, bonusPeriodEnd).first<any>();
    contractCount = ccResult?.cnt || 0;
  } else {
    contractCount = records.filter((r: any) => r.type === '계약' && r.status === 'confirmed').length;
  }
  const confirmedRecords = records.filter((r: any) => r.status === 'confirmed');
  const totalSales = confirmedRecords.reduce((sum: number, r: any) => sum + (r.amount || 0), 0);
  const refundedRecords = records.filter((r: any) => r.status === 'refunded');
  const totalRefund = refundedRecords.reduce((sum: number, r: any) => sum + (r.amount || 0), 0);

  const salary = accounting?.salary || 0;
  const standardSales = accounting?.standard_sales || 0;
  const positionAllowance = accounting?.position_allowance || 0;

  // 무급휴가 공제 계산: 해당 월 내 승인된 무급휴가(특별휴가-기타) 조회
  const unpaidLeaveResult = await db.prepare(`
    SELECT COALESCE(SUM(days), 0) as total_days FROM leave_requests
    WHERE user_id = ? AND status = 'approved'
      AND leave_type = '특별휴가' AND instr(reason, '기타') > 0
      AND start_date >= ? AND start_date <= ?
  `).bind(userId, monthStart, monthEnd).first<any>();
  const unpaidLeaveDays = unpaidLeaveResult?.total_days || 0;
  const unpaidLeaveDeduction = salary > 0 ? Math.round((salary / 209) * 8 * unpaidLeaveDays) : 0;

  // 본사관리 인원은 실적 기반 성과금 없음
  const isHQ = user.branch === '본사 관리' || ['ceo', 'cc_ref', 'accountant', 'accountant_asst'].includes(user.role);

  // 성과금: 2개월 매출 기준 (급여제만, 비율제는 성과금 없음)
  let bonus = 0;
  let bonusTotalSales = totalSales;
  let bonusExcess = 0;
  const isPayoutMonth = m % 2 === 0; // 짝수월 = 성과금 지급월

  if (!isCommission && !isHQ && isPayoutMonth) {
    // 2개월 매출 조회 (성과금 계산용)
    const bonusSalesResult = await db.prepare(salesQuery)
      .bind(userId, bonusPeriodStart, bonusPeriodEnd, bonusPeriodStart, bonusPeriodEnd, bonusPeriodStart, bonusPeriodEnd).all();
    const bonusConfirmed = (bonusSalesResult.results as any[]).filter((r: any) => r.status === 'confirmed');
    bonusTotalSales = bonusConfirmed.reduce((sum: number, r: any) => sum + (r.amount || 0), 0);
    bonusExcess = Math.max(bonusTotalSales - standardSales, 0);

    if (bonusExcess > 0) {
      if (bonusExcess < 5010000) {
        bonus = Math.round(bonusExcess * 0.20);
      } else if (bonusExcess < 15010000) {
        bonus = Math.round(5010000 * 0.20 + (bonusExcess - 5010000) * 0.25);
      } else {
        bonus = Math.round(5010000 * 0.20 + 10000000 * 0.25 + (bonusExcess - 15010000) * 0.30);
      }
    }
  }

  // 부가세 분리
  const recordsWithVat = confirmedRecords.map((r: any) => {
    const supply = Math.round(r.amount / 1.1);
    const vat = r.amount - supply;
    return { ...r, supply_amount: supply, vat_amount: vat };
  });

  // 이전 기간 환불 건 조회: 현재 정산월에 환불 승인된 + 이전 기간 매출 건
  const prevRefunds = await db.prepare(`
    SELECT id, type, client_name, amount, contract_date, deposit_date, card_deposit_date, payment_type, refund_approved_at
    FROM sales_records
    WHERE user_id = ? AND status = 'refunded'
      AND refund_approved_at >= ? AND refund_approved_at <= ?
  `).bind(userId, monthStart, monthEnd + ' 23:59:59').all();
  const refundRecoveries = (prevRefunds.results as any[]).filter((r: any) => {
    // 원래 매출이 이전 기간인지 확인
    const sd = r.payment_type === '카드' && r.card_deposit_date ? r.card_deposit_date
      : r.deposit_date ? r.deposit_date : r.contract_date;
    return sd && sd < monthStart;
  }).map((r: any) => {
    const supply = Math.round(r.amount / 1.1);
    let recovery = 0;
    if (isCommission) {
      const comm = Math.round(supply * effectiveRate / 100);
      recovery = Math.round(comm * (1 - 0.033));
    }
    return { ...r, supply_amount: supply, recovery_amount: recovery };
  });

  return c.json({
    user,
    accounting: isJanFeb2026
      ? { ...(accounting || { salary: 0, standard_sales: 0, grade: '', position_allowance: 0 }), pay_type: 'commission', commission_rate: effectiveRate }
      : (accounting || { salary: 0, standard_sales: 0, grade: '', position_allowance: 0, pay_type: 'salary', commission_rate: 0 }),
    is_hq: isHQ,
    is_commission: isCommission,
    month,
    period_start: monthStart,
    period_end: monthEnd,
    period_label: `${y}년 ${m}월`,
    bonus_period_label: isPayoutMonth ? `${y}년 ${bonusPeriodStartMonth}~${bonusPeriodEndMonth}월` : null,
    is_payout_month: isPayoutMonth,
    records: recordsWithVat,
    refunded_records: refundedRecords,
    refund_recoveries: refundRecoveries,
    summary: {
      contract_count: contractCount,
      total_sales: totalSales,
      total_supply: Math.round(totalSales / 1.1),
      total_vat: totalSales - Math.round(totalSales / 1.1),
      total_refund: totalRefund,
      net_sales: totalSales - totalRefund,
      standard_sales: standardSales,
      bonus_total_sales: bonusTotalSales,
      bonus_excess: bonusExcess,
      excess: bonusExcess,
      bonus,
      salary,
      position_allowance: positionAllowance,
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

// ━━━ 급여정산 저장/조회 ━━━

// GET /api/payroll/save/:userId?period=xxx
payroll.get('/save/:userId', requireRole(...ACCOUNTING_ROLES), async (c) => {
  const userId = c.req.param('userId');
  const period = c.req.query('period') || '';
  const db = c.env.DB;
  const viewer = c.get('user');
  if (!(await canAccessUserPayroll(db, viewer, userId))) {
    return c.json({ error: '해당 직원의 정산 정보 열람 권한이 없습니다.' }, 403);
  }
  const row = await db.prepare('SELECT * FROM payroll_saves WHERE user_id = ? AND period = ?').bind(userId, period).first();
  return c.json({ save: row || null });
});

// POST /api/payroll/save — 저장
payroll.post('/save', requireRole(...ACCOUNTING_ROLES), async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const { user_id, period, pay_type, data: saveData } = await c.req.json<{
    user_id: string; period: string; pay_type: string; data: Record<string, unknown>;
  }>();
  if (!(await canAccessUserPayroll(db, user, user_id))) {
    return c.json({ error: '해당 직원의 정산 정보 저장 권한이 없습니다.' }, 403);
  }

  // 잠금 체크: 익달 5일 이후면 수정 불가
  const existing = await db.prepare('SELECT locked FROM payroll_saves WHERE user_id = ? AND period = ?').bind(user_id, period).first<any>();
  if (existing?.locked) return c.json({ error: '해당 기간 정산은 잠금 상태입니다. (익달 5일 이후 수정 불가)' }, 400);

  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO payroll_saves (id, user_id, period, pay_type, data, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, period) DO UPDATE SET
      data = excluded.data, pay_type = excluded.pay_type, updated_at = datetime('now')
  `).bind(id, user_id, period, pay_type, JSON.stringify(saveData), user.sub).run();

  return c.json({ success: true });
});

// POST /api/payroll/lock — 자동 잠금 (cron 또는 수동)
payroll.post('/lock', requireRole('master', 'accountant'), async (c) => {
  const db = c.env.DB;
  // 현재 달 기준: 전달 정산을 잠금 (5일 이후)
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000); // KST
  if (now.getUTCDate() < 5) return c.json({ message: '아직 5일 전입니다.' });

  const prevMonth = new Date(now.getUTCFullYear(), now.getUTCMonth() - 1, 1);
  const periodPattern = `${prevMonth.getUTCFullYear()}-${String(prevMonth.getUTCMonth() + 1).padStart(2, '0')}%`;

  const result = await db.prepare(
    "UPDATE payroll_saves SET locked = 1 WHERE period LIKE ? AND locked = 0"
  ).bind(periodPattern).run();

  return c.json({ success: true, locked: result.meta?.changes || 0 });
});

export default payroll;
