import { Hono } from 'hono';
import type { AuthEnv } from '../types';
import { authMiddleware, requireRole } from '../middleware/auth';
import { calculateCaseAllowance, isCaseAllowanceExcludedName } from './cases';
import { reinitUserLeave } from './leave';
import { normalizeBranchName } from '../lib/branchAliases';
import { ensurePayTypeHistoryTable, getPayTypeHistoryRows, getPayTypeSnapshotForMonth, payTypeAtMonthSql, resolvePayTypeFromHistory } from '../lib/pay-type-history';
import { calculateRefundRecoveryAmount, payrollPeriodLabelFromMonth } from '../../shared/refund-recovery';
import { nextPayrollMonth } from '../../shared/payroll-carryover';
import { calculateUnpaidLeavePayrollSettlement } from '../../shared/unpaid-leave-settlement';
import { confirmedSalesSql, payrollRecognizedOrRefundedSql, recognizedSalesDateSql, salesPeriodSql } from '../lib/sales-recognition';
import { buildBranchSummaryQueryScope } from '../../shared/payroll-branch-summary';
import { normalizeSalesRecognition } from '../../shared/sales-recognition';
import { normalizeWithholdingSettlements } from '../../shared/withholding-settlement';
import {
  applyFreelancerSettlementToSaveData,
  calculateFreelancerSavedSettlement,
  calculateFreelancerSettlement,
} from '../../shared/freelancer-settlement';
import {
  canEditPayrollInternalMemo,
  canViewPayrollInternalMemo,
} from '../../shared/payroll-internal-memo-access';
import {
  calculateContractCountFromRows,
  getContractAwardPeriod,
} from '../../shared/contract-award';
import { calculateContractAwardForUser } from '../lib/contract-award-ranking';
import { getLawitgoNewSettlements } from '../lib/lawitgo-new-settlement';

const LEAVE_HOURS_PER_DAY = 8;
const CASE_ALLOWANCE_EXCLUDED_FROM_BONUS_BASIS_FROM = '2026-06';
const PAYROLL_TRUNCATE_MONEY_FROM = '2026-06';
const truncMoney = (value: number): number => Math.trunc((Number(value) || 0) / 10) * 10;
const shouldTruncatePayrollMoney = (month: string): boolean => /^\d{4}-\d{2}$/.test(month) && month >= PAYROLL_TRUNCATE_MONEY_FROM;
const payrollMoney = (value: number, month: string): number => (
  shouldTruncatePayrollMoney(month) ? truncMoney(value) : Math.round(Number(value) || 0)
);
const vatSupplyAmount = (amount: number, month: string): number => payrollMoney((Number(amount) || 0) * 10 / 11, month);

function leaveDaysToHours(days: number): number {
  return Math.round((Number(days || 0) * LEAVE_HOURS_PER_DAY) * 1000) / 1000;
}

function leaveHoursToDays(hours: number): number {
  return Math.round((Number(hours || 0) / LEAVE_HOURS_PER_DAY) * 1000) / 1000;
}

async function ensureUsersResignedAtColumn(db: D1Database): Promise<void> {
  const columns = await db.prepare('PRAGMA table_info(users)').all<{ name: string }>();
  const names = new Set((columns.results || []).map((c) => c.name));
  if (!names.has('resigned_at')) {
    await db.prepare('ALTER TABLE users ADD COLUMN resigned_at TEXT').run();
  }
}

async function buildTerminationSettlement(
  db: D1Database,
  userId: string,
  user: any,
  month: string,
  salary: number,
  positionAllowance: number,
): Promise<Record<string, any> | null> {
  if (String(user?.role || '') !== 'resigned') return null;

  const resignedDate = String(user?.resigned_at || user?.updated_at || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(resignedDate) || resignedDate.slice(0, 7) !== month) return null;

  const [yearText, monthText] = month.split('-');
  const year = Number(yearText);
  const monthNumber = Number(monthText);
  const monthDays = new Date(year, monthNumber, 0).getDate();
  const resignedDay = Math.min(Math.max(Number(resignedDate.slice(8, 10)) || 1, 1), monthDays);
  const basePay = Number(salary || 0) + Number(positionAllowance || 0);
  const proratedBasePay = payrollMoney(basePay * resignedDay / monthDays, month);
  const baseDeduction = Math.max(basePay - proratedBasePay, 0);

  try {
    await reinitUserLeave(db, userId);
  } catch {
    // Leave settlement should not block payroll if leave data needs manual repair.
  }

  const leaveInfo = await db.prepare('SELECT * FROM annual_leave WHERE user_id = ?').bind(userId).first<any>();
  const annualRemainingHours = leaveInfo
    ? leaveDaysToHours(leaveInfo.total_days || 0) - leaveDaysToHours(leaveInfo.used_days || 0)
    : 0;
  const monthlyRemainingHours = leaveInfo
    ? leaveDaysToHours(leaveInfo.monthly_days || 0) - leaveDaysToHours(leaveInfo.monthly_used || 0)
    : 0;
  const leaveRemainingHours = Math.round((annualRemainingHours + monthlyRemainingHours) * 1000) / 1000;
  const leaveAdjustmentAmount = salary > 0 ? payrollMoney((salary / 209) * leaveRemainingHours, month) : 0;
  const leavePayout = Math.max(leaveAdjustmentAmount, 0);
  const leaveDeduction = Math.max(-leaveAdjustmentAmount, 0);

  return {
    is_termination: true,
    resigned_date: resignedDate,
    month,
    worked_days: resignedDay,
    month_days: monthDays,
    base_pay: basePay,
    prorated_base_pay: proratedBasePay,
    base_deduction: baseDeduction,
    leave_remaining_hours: leaveRemainingHours,
    leave_remaining_days: leaveHoursToDays(leaveRemainingHours),
    leave_adjustment_amount: leaveAdjustmentAmount,
    leave_payout: leavePayout,
    leave_deduction: leaveDeduction,
    leave_adjustment_label: leaveRemainingHours >= 0 ? 'unused_leave_payout' : 'excess_leave_deduction',
    net_adjustment: leavePayout - leaveDeduction - baseDeduction,
  };
}

function buildJoiningSettlement(
  user: any,
  month: string,
  salary: number,
  positionAllowance: number,
): Record<string, any> | null {
  const hireDate = String(user?.hire_date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(hireDate) || hireDate.slice(0, 7) !== month) return null;

  const [, monthText] = month.split('-');
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(monthText);
  const monthDays = new Date(year, monthNumber, 0).getDate();
  const hireDay = Math.min(Math.max(Number(hireDate.slice(8, 10)) || 1, 1), monthDays);
  if (hireDay <= 1) return null;

  const payrollBaseDays = 30;
  const workedDays = Math.min(Math.max(monthDays - hireDay + 1, 0), payrollBaseDays);
  const basePay = Number(salary || 0) + Number(positionAllowance || 0);
  const proratedBasePay = payrollMoney(basePay * workedDays / payrollBaseDays, month);
  const baseDeduction = Math.max(basePay - proratedBasePay, 0);

  return {
    is_joining: true,
    hire_date: hireDate,
    month,
    worked_days: workedDays,
    month_days: monthDays,
    payroll_base_days: payrollBaseDays,
    base_pay: basePay,
    prorated_base_pay: proratedBasePay,
    base_deduction: baseDeduction,
  };
}

function parsePayrollPeriodMonth(value: string): string {
  const text = String(value || '').trim();
  const iso = text.match(/^(\d{4})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}`;
  const ko = text.match(/^(\d{4})년\s*(\d{1,2})월$/);
  if (ko) return `${ko[1]}-${String(Number(ko[2])).padStart(2, '0')}`;
  return '';
}

function payrollPeriodLabel(month: string): string {
  const [year, monthText] = month.split('-');
  return `${Number(year)}년 ${Number(monthText)}월`;
}

function normalizePayrollInternalMemoPeriod(value: string): string {
  const month = parsePayrollPeriodMonth(value);
  const monthNumber = Number(month.slice(5, 7));
  return month && monthNumber >= 1 && monthNumber <= 12 ? payrollPeriodLabel(month) : '';
}

async function ensurePayrollInternalMemosTable(db: D1Database): Promise<void> {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS payroll_internal_memos (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      period TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, period)
    )
  `).run();
}

function isPayrollPaidMonth(month: string): boolean {
  const parsed = parsePayrollPeriodMonth(month);
  if (!parsed) return false;
  const [yearText, monthText] = parsed.split('-');
  let year = Number(yearText);
  let paymentMonth = Number(monthText) + 1;
  if (paymentMonth === 13) {
    year += 1;
    paymentMonth = 1;
  }

  const nowKst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const nowKey = nowKst.getUTCFullYear() * 10000 + (nowKst.getUTCMonth() + 1) * 100 + nowKst.getUTCDate();
  const paidKey = year * 10000 + paymentMonth * 100 + 5;
  return nowKey >= paidKey;
}

function defaultPayrollMonth(): string {
  const nowKst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  let year = nowKst.getUTCFullYear();
  let monthIndex = nowKst.getUTCMonth();
  const day = nowKst.getUTCDate();
  if (day <= 15) {
    monthIndex -= 1;
    if (monthIndex < 0) {
      monthIndex = 11;
      year -= 1;
    }
  }
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
}

function excludesCaseAllowanceFromBonusBasis(month: string): boolean {
  return /^\d{4}-\d{2}$/.test(month) && month >= CASE_ALLOWANCE_EXCLUDED_FROM_BONUS_BASIS_FROM;
}

function isCaseAllowanceSalesRecord(row: any): boolean {
  return String(row?.type_detail || '').startsWith('명도성과금')
    || String(row?.external_id || '').startsWith('myungdo-bonus-');
}

function excludeCaseAllowanceSalesRecordFromPayroll(row: any, month: string): boolean {
  return excludesCaseAllowanceFromBonusBasis(month) && isCaseAllowanceSalesRecord(row);
}

function parsePayrollSaveData(raw: unknown): Record<string, any> {
  try {
    const parsed = JSON.parse(String(raw || '{}'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

type AuthoritativePayrollSave = {
  payType: 'salary' | 'commission';
  settlement: ReturnType<typeof calculateFreelancerSettlement> | null;
  businessIncome: { amount: number; tax: number; net: number; contractAward: number } | null;
  response: Record<string, any> | null;
};

async function buildAuthoritativePayrollSave(
  db: D1Database,
  userId: string,
  month: string,
  saveData: Record<string, any>,
  submittedResponse: Record<string, any> | null,
): Promise<AuthoritativePayrollSave | null> {
  const targetUser = await db.prepare(
    'SELECT id, name, branch, role FROM users WHERE id = ?'
  ).bind(userId).first<any>();
  if (!targetUser) return null;

  const currentAccounting = await db.prepare(
    'SELECT pay_type, commission_rate, position_allowance FROM user_accounting WHERE user_id = ?'
  ).bind(userId).first<any>();
  const monthAccounting = await getPayTypeSnapshotForMonth(db, userId, month, currentAccounting || {});
  const isJanFeb2026 = month === '2026-01' || month === '2026-02';
  const payType: 'salary' | 'commission' = isJanFeb2026 ? 'commission' : monthAccounting.pay_type;
  const [yearText, monthText] = month.split('-');
  const year = Number(yearText);
  const monthNumber = Number(monthText);
  const isPayoutMonth = monthNumber % 2 === 0;
  const contractAwardPeriod = getContractAwardPeriod(month);
  const isHQ = normalizeBranchName(targetUser.branch) === '본사관리'
    || ['ceo', 'cc_ref', 'accountant', 'accountant_asst'].includes(String(targetUser.role || ''));
  const contractAward = contractAwardPeriod.isAwardMonth && !isHQ
    ? await calculateContractAwardForUser(db, userId, month)
    : { rank: null, count: 0, award: 0, total_amount: 0 };
  const responseWithAuthoritativeAward: Record<string, any> | null = submittedResponse ? {
    ...submittedResponse,
    month,
    is_payout_month: isPayoutMonth,
    is_contract_award_month: contractAwardPeriod.isAwardMonth,
    contract_award_period_label: contractAwardPeriod.label,
    contract_award: contractAward,
  } : null;
  if (payType !== 'commission') {
    return {
      payType,
      settlement: null,
      businessIncome: null,
      response: responseWithAuthoritativeAward,
    };
  }

  const override = await db.prepare(
    'SELECT commission_rate FROM commission_rate_overrides WHERE user_id = ? AND year_month = ?'
  ).bind(userId, month).first<any>().catch(() => null);
  const rate = override?.commission_rate !== undefined
    ? Number(override.commission_rate)
    : (isJanFeb2026 ? 50 : Number(monthAccounting.commission_rate) || 0);
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-${String(new Date(year, monthNumber, 0).getDate()).padStart(2, '0')}`;
  const salesResult = await db.prepare(`
    SELECT id, type, type_detail, client_name, client_phone, depositor_name, depositor_different,
      amount, refund_amount, contract_date, deposit_date, status, confirmed_at, memo, exclude_from_count,
      payment_type, card_deposit_date, proxy_cost, direction, external_id
    FROM sales_records
    WHERE user_id = ? AND ${payrollRecognizedOrRefundedSql('sales_records')}
      AND (
        (payment_type = '카드' AND card_deposit_date >= ? AND card_deposit_date <= ?)
        OR (payment_type != '카드' AND payment_type != '' AND deposit_date >= ? AND deposit_date <= ?)
        OR ((payment_type = '' OR payment_type IS NULL) AND contract_date >= ? AND contract_date <= ?)
      )
    ORDER BY contract_date ASC
  `).bind(userId, monthStart, monthEnd, monthStart, monthEnd, monthStart, monthEnd).all<any>();
  const records = (salesResult.results || [])
    .map((record: any) => normalizeSalesRecognition(record))
    .filter((record: any) => record.status === 'confirmed' && !excludeCaseAllowanceSalesRecordFromPayroll(record, month))
    .map((record: any) => {
      const grossSupply = vatSupplyAmount(record.amount, month);
      const proxyCost = record.type === '매수신청대리' ? Number(record.proxy_cost || 0) : 0;
      return {
        ...record,
        supply_amount: record.type === '매수신청대리'
          ? Math.max(grossSupply - proxyCost, 0)
          : grossSupply,
        vat_amount: (Number(record.amount) || 0) - grossSupply,
        gross_supply_amount: grossSupply,
        proxy_payroll_amount: record.type === '매수신청대리'
          ? Math.max(grossSupply - proxyCost, 0)
          : grossSupply,
      };
    });
  const response = responseWithAuthoritativeAward ? {
    ...responseWithAuthoritativeAward,
    month,
    accounting: {
      ...(responseWithAuthoritativeAward.accounting || {}),
      pay_type: 'commission',
      commission_rate: rate,
      position_allowance: monthAccounting.position_allowance,
    },
    summary: {
      ...(responseWithAuthoritativeAward.summary || {}),
      position_allowance: monthAccounting.position_allowance,
    },
    records,
    is_payout_month: isPayoutMonth,
    is_contract_award_month: contractAwardPeriod.isAwardMonth,
    contract_award_period_label: contractAwardPeriod.label,
    contract_award: contractAward,
  } : {
    month,
    accounting: {
      pay_type: 'commission',
      commission_rate: rate,
      position_allowance: monthAccounting.position_allowance,
    },
    summary: { position_allowance: monthAccounting.position_allowance },
    records,
    is_payout_month: isPayoutMonth,
    is_contract_award_month: contractAwardPeriod.isAwardMonth,
    contract_award_period_label: contractAwardPeriod.label,
    contract_award: contractAward,
  };
  const lawitgoIncome = (await getLawitgoNewSettlements(db, userId, month))
    .reduce((sum, item) => sum + item.amount, 0);
  let caseAllowanceIncome = 0;
  if (isPayoutMonth && !isCaseAllowanceExcludedName(targetUser.name)) {
    const periodKey = `${year}-${String(monthNumber - 1).padStart(2, '0')}_${String(monthNumber).padStart(2, '0')}`;
    const caseAllowanceCases = await db.prepare(`
      SELECT COALESCE(SUM(
        CASE WHEN fee_type = 'fixed' THEN MAX(0, fee_amount - 150000)
             ELSE CAST(fee_amount * 1.0 / 1.1 AS INTEGER) END
      ), 0) as total_fee_adjusted
      FROM cases
      WHERE consultant_user_id = ? AND bimonthly_period = ?
        AND NOT EXISTS (SELECT 1 FROM lawitgo_new_settlements lns WHERE lns.case_id = cases.id)
    `).bind(userId, periodKey).first<any>();
    caseAllowanceIncome = calculateCaseAllowance(caseAllowanceCases?.total_fee_adjusted || 0);
  }
  let normalSupply = 0;
  let proxyIncome = 0;
  for (const record of records) {
    if (String(record.type_detail || '').startsWith('명도성과금')) continue;
    if (record.type === '매수신청대리') proxyIncome += Number(record.supply_amount) || 0;
    else normalSupply += Number(record.supply_amount) || 0;
  }
  const businessIncomeSettlement = calculateFreelancerSettlement({
    settlementIncome: truncMoney(normalSupply * rate / 100) + proxyIncome + caseAllowanceIncome + lawitgoIncome,
    contractAward: Number(contractAward.award) || 0,
  });

  return {
    payType,
    settlement: calculateFreelancerSavedSettlement(response, saveData, month),
    businessIncome: {
      amount: businessIncomeSettlement.grossIncome,
      tax: businessIncomeSettlement.withholdingTax,
      net: businessIncomeSettlement.netPay,
      contractAward: businessIncomeSettlement.contractAward,
    },
    response,
  };
}

const payroll = new Hono<AuthEnv>();
payroll.use('*', authMiddleware);

// 회계/급여 열람 제한: 관리자(admin)는 제외
const ACCOUNTING_ROLES = ['master', 'ceo', 'accountant', 'accountant_asst'] as const;
const PAYROLL_EXTRA_USER_IDS = ['2b6b3606-e425-4361-a115-9283cfef842f'];
const requirePayrollAccess = async (c: any, next: any) => {
  const user = c.get('user');
  if (ACCOUNTING_ROLES.includes(user?.role) || PAYROLL_EXTRA_USER_IDS.includes(user?.sub)) {
    return next();
  }
  return c.json({ error: '권한이 없습니다.' }, 403);
};

// Payroll internal memos are deliberately separate from payroll snapshots and exports.
// Keep this an exact-role check: requireRole maps cc_ref to ceo, but cc_ref is not allowed here.
const requirePayrollInternalMemoView = async (c: any, next: any) => {
  c.header('Cache-Control', 'private, no-store');
  const user = c.get('user');
  if (user?.auth_type !== 'user' || !canViewPayrollInternalMemo(user)) {
    return c.json({ error: '권한이 없습니다.' }, 403);
  }
  return next();
};

const requirePayrollInternalMemoEdit = async (c: any, next: any) => {
  c.header('Cache-Control', 'private, no-store');
  const user = c.get('user');
  if (user?.auth_type !== 'user' || !canEditPayrollInternalMemo(user)) {
    return c.json({ error: '권한이 없습니다.' }, 403);
  }
  return next();
};

// 총무보조(accountant_asst) 열람 제한 — 팀장·관리자급·이사·대표자 정산은 총무담당만 접근 가능
function getAsstScopedBranch(viewer: any): string | null {
  void viewer;
  return '';
}

async function canAccessUserPayroll(db: D1Database, viewer: any, targetUserId: string): Promise<boolean> {
  void db;
  void viewer;
  void targetUserId;
  return true;
}

export async function lockPaidPayrollSaves(db: D1Database): Promise<{ scanned: number; locked: number }> {
  const rows = await db.prepare('SELECT user_id, period FROM payroll_saves WHERE locked = 0').all<any>();
  return { scanned: rows.results?.length || 0, locked: 0 };
}

// GET /api/payroll/internal-memo/:userId?period=YYYY-MM|YYYY년 M월
payroll.get('/internal-memo/:userId', requirePayrollInternalMemoView, async (c) => {
  const period = normalizePayrollInternalMemoPeriod(c.req.query('period') || '');
  if (!period) {
    return c.json({ error: 'period는 YYYY-MM 또는 YYYY년 M월 형식이어야 합니다.' }, 400);
  }

  const db = c.env.DB;
  await ensurePayrollInternalMemosTable(db);
  const memo = await db.prepare(`
    SELECT pim.content, pim.updated_at, COALESCE(u.name, '') AS updated_by_name
    FROM payroll_internal_memos pim
    LEFT JOIN users u ON u.id = pim.updated_by
    WHERE pim.user_id = ? AND pim.period = ?
    LIMIT 1
  `).bind(c.req.param('userId'), period).first<{
    content: string;
    updated_at: string;
    updated_by_name: string;
  }>();

  return c.json({ memo: memo || null });
});

// PUT /api/payroll/internal-memo
// Empty content clears the memo. It never enters payroll_saves or a payroll snapshot.
payroll.put('/internal-memo', requirePayrollInternalMemoEdit, async (c) => {
  const body = await c.req.json<{
    user_id?: string;
    period?: string;
    content?: string;
  }>().catch(() => ({} as {
    user_id?: string;
    period?: string;
    content?: string;
  }));
  const userId = String(body.user_id || '').trim();
  const period = normalizePayrollInternalMemoPeriod(String(body.period || ''));
  const content = String(body.content || '').trim();

  if (!userId) return c.json({ error: 'user_id가 필요합니다.' }, 400);
  if (!period) return c.json({ error: 'period는 YYYY-MM 또는 YYYY년 M월 형식이어야 합니다.' }, 400);
  if (content.length > 2000) return c.json({ error: '메모는 2,000자 이내로 작성해 주세요.' }, 400);

  const db = c.env.DB;
  await ensurePayrollInternalMemosTable(db);
  if (!content) {
    await db.prepare('DELETE FROM payroll_internal_memos WHERE user_id = ? AND period = ?')
      .bind(userId, period).run();
    return c.json({ success: true, memo: null });
  }

  const targetUser = await db.prepare('SELECT id FROM users WHERE id = ? LIMIT 1').bind(userId).first<{ id: string }>();
  if (!targetUser) return c.json({ error: '사용자를 찾을 수 없습니다.' }, 404);

  const editor = c.get('user');
  await db.prepare(`
    INSERT INTO payroll_internal_memos (
      id, user_id, period, content, created_by, updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(user_id, period) DO UPDATE SET
      content = excluded.content,
      updated_by = excluded.updated_by,
      updated_at = datetime('now')
  `).bind(crypto.randomUUID(), userId, period, content, editor.sub, editor.sub).run();

  const memo = await db.prepare(`
    SELECT pim.content, pim.updated_at, COALESCE(u.name, '') AS updated_by_name
    FROM payroll_internal_memos pim
    LEFT JOIN users u ON u.id = pim.updated_by
    WHERE pim.user_id = ? AND pim.period = ?
    LIMIT 1
  `).bind(userId, period).first<{
    content: string;
    updated_at: string;
    updated_by_name: string;
  }>();

  return c.json({ success: true, memo: memo || null });
});

// GET /api/payroll/:userId?month=YYYY-MM
// 급여제: 1개월 정산 + 성과금은 2개월 기준
// 비율제: 1개월 정산
// 매출 기준: 카드→card_deposit_date, 이체→deposit_date, 미지정→contract_date
payroll.get('/:userId', requirePayrollAccess, async (c) => {
  const userId = c.req.param('userId');
  const month = c.req.query('month') || defaultPayrollMonth();
  const db = c.env.DB;
  const viewer = c.get('user');
  if (!(await canAccessUserPayroll(db, viewer, userId))) {
    return c.json({ error: '해당 직원의 정산 정보 열람 권한이 없습니다.' }, 403);
  }

  const [yearStr, monthStr] = month.split('-');
  const y = Number(yearStr);
  const m = Number(monthStr);
  if (!/^\d{4}-\d{2}$/.test(month) || !Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
    return c.json({ error: 'month는 YYYY-MM 형식이어야 합니다.' }, 400);
  }
  const periodLabel = payrollPeriodLabel(month);
  const isPaidPeriod = isPayrollPaidMonth(month);
  await ensureUsersResignedAtColumn(db);

  // 1개월 구간 (급여/비율 공통)
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-${new Date(y, m, 0).getDate()}`;

  // 2개월 구간 (성과금 계산용 — 급여제만)
  const bonusPeriodStartMonth = m % 2 === 0 ? m - 1 : m;
  const bonusPeriodEndMonth = bonusPeriodStartMonth + 1;
  const bonusPeriodStart = `${y}-${String(bonusPeriodStartMonth).padStart(2, '0')}-01`;
  const bonusPeriodEnd = `${y}-${String(bonusPeriodEndMonth).padStart(2, '0')}-${new Date(y, bonusPeriodEndMonth, 0).getDate()}`;
  const isPayoutMonth = m % 2 === 0;
  const contractAwardPeriod = getContractAwardPeriod(month);

  const user = await db.prepare(
    'SELECT id, name, branch, department, position_title, role, hire_date, resigned_at, updated_at FROM users WHERE id = ?'
  ).bind(userId).first<any>();
  if (!user) return c.json({ error: '사용자를 찾을 수 없습니다.' }, 404);

  const savedPayroll = await db.prepare('SELECT * FROM payroll_saves WHERE user_id = ? AND period = ?').bind(userId, periodLabel).first<any>();
  const savedPayrollData = parsePayrollSaveData(savedPayroll?.data);
  const excludeCaseAllowanceFromBonusBasis = excludesCaseAllowanceFromBonusBasis(month);
  const shouldUseSavedSnapshot = !!savedPayroll && !!savedPayroll.locked;
  const savedSnapshot = savedPayrollData.payroll_snapshot;
  if (shouldUseSavedSnapshot && savedSnapshot?.response) {
    return c.json({
      ...savedSnapshot.response,
      is_paid_period: isPaidPeriod,
      is_snapshot: true,
      payroll_snapshot: {
        caseAllowance: savedSnapshot.caseAllowance || null,
        manual: savedSnapshot.manual || null,
        saved_at: savedSnapshot.saved_at || savedPayroll.updated_at || savedPayroll.created_at,
      },
      payroll_save: {
        locked: !!savedPayroll.locked,
        pay_type: savedPayroll.pay_type,
        saved_at: savedSnapshot.saved_at || savedPayroll.updated_at || savedPayroll.created_at,
      },
    });
  }
  const lawitgoNewSettlements = await getLawitgoNewSettlements(db, userId, month);

  let accounting = await db.prepare(
    'SELECT salary, standard_sales, grade, position_allowance, pay_type, commission_rate FROM user_accounting WHERE user_id = ?'
  ).bind(userId).first<any>();
  accounting = {
    salary: 0,
    standard_sales: 0,
    grade: '',
    position_allowance: 0,
    pay_type: 'salary',
    commission_rate: 0,
    ...(accounting || {}),
  };

  await ensurePayTypeHistoryTable(db);
  const payTypeHistoryRows = await getPayTypeHistoryRows(db, userId);
  if (!shouldUseSavedSnapshot) {
    const monthSnapshot = await getPayTypeSnapshotForMonth(db, userId, month, accounting);
    accounting = { ...accounting, ...monthSnapshot };
  }

  if (shouldUseSavedSnapshot && savedPayroll?.pay_type) {
    accounting.pay_type = savedPayroll.pay_type;
  }

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
  const payTypeForMonth = (ym: string) => (
    isJanFeb2026 ? 'commission' : resolvePayTypeFromHistory(payTypeHistoryRows, ym, accounting?.pay_type || 'salary')
  );

  // 매출 조회: 1개월 기준 (카드→card_deposit_date, 이체→deposit_date, 미지정→contract_date)
  const salesQuery = `
    SELECT id, type, type_detail, client_name, client_phone, depositor_name, depositor_different,
      amount, refund_amount, contract_date, deposit_date, status, confirmed_at, memo, exclude_from_count,
      payment_type, card_deposit_date, proxy_cost, direction, external_id
    FROM sales_records
    WHERE user_id = ? AND ${payrollRecognizedOrRefundedSql('sales_records')}
      AND (
        (payment_type = '카드' AND card_deposit_date >= ? AND card_deposit_date <= ?)
        OR (payment_type != '카드' AND payment_type != '' AND deposit_date >= ? AND deposit_date <= ?)
        OR ((payment_type = '' OR payment_type IS NULL) AND contract_date >= ? AND contract_date <= ?)
      )
    ORDER BY contract_date ASC
  `;
  const salesResult = await db.prepare(salesQuery)
    .bind(userId, monthStart, monthEnd, monthStart, monthEnd, monthStart, monthEnd).all();

  const records = (salesResult.results as any[])
    .map((record: any) => normalizeSalesRecognition(record))
    .filter((r: any) => !excludeCaseAllowanceSalesRecordFromPayroll(r, month));
  // 계약건수: 급여제는 2개월 기준, 비율제는 1개월 기준
  let contractCount: number;
  if (!isCommission) {
    // 2개월 기준 계약건수 별도 조회 (220만원 이상은 2건, exclude_from_count=1 제외)
    const ccResult = await db.prepare(`
      SELECT SUM(CASE WHEN customer_amount >= 2200000 THEN 2 ELSE 1 END) as cnt
      FROM (
        SELECT
          CASE
            WHEN COALESCE(client_name, '') = '' OR COALESCE(client_phone, '') = '' THEN id
            ELSE LOWER(TRIM(client_name)) || '|' || REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(client_phone, ''), '-', ''), ' ', ''), '(', ''), ')', '')
          END as customer_key,
          SUM(amount) as customer_amount
        FROM sales_records
        WHERE user_id = ? AND type = '계약' AND ${confirmedSalesSql('sales_records')}
          AND (exclude_from_count IS NULL OR exclude_from_count = 0)
          AND (
            (payment_type = '카드' AND card_deposit_date >= ? AND card_deposit_date <= ?)
            OR (payment_type != '카드' AND payment_type != '' AND deposit_date >= ? AND deposit_date <= ?)
            OR ((payment_type = '' OR payment_type IS NULL) AND contract_date >= ? AND contract_date <= ?)
          )
        GROUP BY customer_key
      )
    `).bind(userId, bonusPeriodStart, bonusPeriodEnd, bonusPeriodStart, bonusPeriodEnd, bonusPeriodStart, bonusPeriodEnd).first<any>();
    contractCount = ccResult?.cnt || 0;
  } else {
    contractCount = calculateContractCountFromRows(records);
  }
  const confirmedRecords = records.filter((r: any) => r.status === 'confirmed');
  const totalSales = confirmedRecords.reduce((sum: number, r: any) => sum + (r.amount || 0), 0);
  const refundedRecords = records.filter((r: any) => r.status === 'refunded');
  // 당월 전액환불(status='refunded')은 확정매출에서 이미 제외되므로 정산에서 다시 차감하지 않는다
  // (공제대상 아님 — 표시는 아래 refunded_records(환불내역)에서 유지).
  // 정산 차감 대상은 당월 '부분환불'(status='confirmed' 유지 + refund_amount 기록)의 환불액뿐이다.
  const totalRefund = confirmedRecords.reduce((sum: number, r: any) => sum + (Number(r.refund_amount) || 0), 0);

  const salary = accounting?.salary || 0;
  const standardSales = accounting?.standard_sales || 0;
  const bonusMonths = [
    `${y}-${String(bonusPeriodStartMonth).padStart(2, '0')}`,
    `${y}-${String(bonusPeriodEndMonth).padStart(2, '0')}`,
  ];
  const salaryBonusMonths = bonusMonths.filter((ym) => payTypeForMonth(ym) === 'salary');
  const bonusStandardSales = isPayoutMonth ? payrollMoney(standardSales * (salaryBonusMonths.length / 2), month) : standardSales;
  const positionAllowance = accounting?.position_allowance || 0;

  // 무급휴가 공제 계산:
  // - 일반 단기 무급휴가는 해당 월과 겹치는 영업일만 시간제로 공제한다.
  // - 육아휴직처럼 장기 무급휴직은 급여 기준 30일 중 실제 근무한 일수만 일할 지급한다.
  const unpaidLeaveSettlement = await calculateUnpaidLeavePayrollSettlement(
    db,
    userId,
    month,
    salary,
    positionAllowance,
  );
  const unpaidLeaveHours = unpaidLeaveSettlement.unpaid_leave_hours;
  const unpaidLeaveDays = unpaidLeaveSettlement.unpaid_leave_days;
  const unpaidLeaveDeduction = unpaidLeaveSettlement.unpaid_leave_deduction;

  // 본사관리 인원은 실적 기반 성과금 없음
  const isHQ = normalizeBranchName(user.branch) === '본사관리' || ['ceo', 'cc_ref', 'accountant', 'accountant_asst'].includes(user.role);
  const isCaseAllowanceExcluded = isCaseAllowanceExcludedName(user.name);

  // 성과금: 2개월 일반매출(공급가액) + 안건 수당(amount 그대로) 합산 (급여제만)
  // 매수신청대리는 대리비용을 제3자에게 지급하므로 업무성과 산정에서 차감
  // effective_raw = amount - proxy_cost*1.1 (VAT 포함 기준 환산)
  // → effective_supply = effective_raw / 1.1 = amount/1.1 - proxy_cost
  const proxyEffectiveRaw = (r: any) => {
    if (r.type === '매수신청대리') {
      return Math.max((r.amount || 0) - truncMoney((r.proxy_cost || 0) * 1.1), 0);
    }
    return r.amount || 0;
  };
  const totalSalesEffective = confirmedRecords.reduce((sum: number, r: any) => sum + proxyEffectiveRaw(r), 0);

  let bonus = 0;
  // 일반매출 (부가세 분리 대상) — 매수신청대리는 대리비용 차감 후 환산
  let bonusRegularRaw = totalSalesEffective;                          // 일반 원본 (effective)
  let bonusRegularSupply = vatSupplyAmount(totalSalesEffective, month);      // 일반 공급가액
  let bonusRegularVat = totalSalesEffective - bonusRegularSupply;     // 일반 부가세
  // 안건 수당 (부가세 X) — cases 테이블 등급별 산정
  let bonusCaseAllowance = 0;
  // 합계 (2026-06 급여명세부터 성과금 산정 기준에서 안건 수당 제외)
  let bonusTotalSalesRaw = bonusRegularRaw;
  let bonusTotalSales = bonusRegularSupply;
  let bonusTotalVat = bonusRegularVat;                       // 호환: 부가세
  let bonusExcess = 0;
  if (!isCommission && !isHQ && isPayoutMonth) {
    // 2개월 매출 조회 (성과금 계산용)
    const bonusSalesResult = await db.prepare(salesQuery)
      .bind(userId, bonusPeriodStart, bonusPeriodEnd, bonusPeriodStart, bonusPeriodEnd, bonusPeriodStart, bonusPeriodEnd).all();
    const bonusConfirmed = (bonusSalesResult.results as any[])
      .map((record: any) => normalizeSalesRecognition(record))
      .filter((r: any) => {
      if (r.status !== 'confirmed') return false;
      const ym = String(r.card_deposit_date || r.deposit_date || r.contract_date || '').slice(0, 7);
      return ym && payTypeForMonth(ym) === 'salary';
      });
    // sales_records의 안건 수당 자동 INSERT 건(type_detail '명도성과금' prefix — DB 레거시)은 일반매출 합산에서 제외
    // cases 직접 조회로 중복 방지. 매수신청대리는 대리비용 차감 후 effective amount로 합산.
    bonusRegularRaw = bonusConfirmed
      .filter((r: any) => !isCaseAllowanceSalesRecord(r))
      .reduce((sum: number, r: any) => sum + proxyEffectiveRaw(r), 0);
    bonusRegularSupply = vatSupplyAmount(bonusRegularRaw, month);
    bonusRegularVat = bonusRegularRaw - bonusRegularSupply;

    // 안건 수당: cases 테이블에서 직접 등급 성과금 계산 (트리거 INSERT 여부 무관)
    const periodKey = `${y}-${String(bonusPeriodStartMonth).padStart(2, '0')}_${String(bonusPeriodEndMonth).padStart(2, '0')}`;
    if (!isCaseAllowanceExcluded) {
      const salaryMonthPlaceholders = salaryBonusMonths.map(() => '?').join(', ');
      const salaryMonthFilter = salaryMonthPlaceholders ? `AND substr(registered_at, 1, 7) IN (${salaryMonthPlaceholders})` : 'AND 1 = 0';
      const caseAllowanceCases = await db.prepare(`
        SELECT COALESCE(SUM(
          CASE WHEN fee_type = 'fixed' THEN MAX(0, fee_amount - 150000)
               ELSE CAST(fee_amount * 1.0 / 1.1 AS INTEGER) END
        ), 0) as total_fee_adjusted
        FROM cases
        WHERE consultant_user_id = ? AND bimonthly_period = ?
          AND NOT EXISTS (SELECT 1 FROM lawitgo_new_settlements lns WHERE lns.case_id = cases.id)
          ${salaryMonthFilter}
      `).bind(userId, periodKey, ...salaryBonusMonths).first<any>();
      bonusCaseAllowance = calculateCaseAllowance(caseAllowanceCases?.total_fee_adjusted || 0);
    }

    bonusTotalSalesRaw = excludeCaseAllowanceFromBonusBasis
      ? bonusRegularRaw
      : bonusRegularRaw + bonusCaseAllowance;
    bonusTotalSales = excludeCaseAllowanceFromBonusBasis
      ? bonusRegularSupply
      : bonusRegularSupply + bonusCaseAllowance;
    bonusTotalVat = bonusRegularVat;
    bonusExcess = Math.max(bonusTotalSales - bonusStandardSales, 0);

    if (bonusExcess > 0) {
      if (bonusExcess < 5010000) {
        bonus = truncMoney(bonusExcess * 0.20);
      } else if (bonusExcess < 15010000) {
        bonus = truncMoney(5010000 * 0.20 + (bonusExcess - 5010000) * 0.25);
      } else {
        bonus = truncMoney(5010000 * 0.20 + 10000000 * 0.25 + (bonusExcess - 15010000) * 0.30);
      }
    }
  }

  // 부가세 분리
  // 매수신청대리는 담당자에게 지급되는 대리비용을 제외한 금액이 급여/성과 반영액이다.
  // amount는 VAT 포함 입금액이므로 급여반영액 = amount / 1.1 - proxy_cost.
  const recordsWithVat = confirmedRecords.map((r: any) => {
    const grossSupply = vatSupplyAmount(r.amount, month);
    const vat = r.amount - grossSupply;
    const proxyCost = r.type === '매수신청대리' ? Number(r.proxy_cost || 0) : 0;
    const supply = r.type === '매수신청대리'
      ? Math.max(grossSupply - proxyCost, 0)
      : grossSupply;
    return {
      ...r,
      supply_amount: supply,
      vat_amount: vat,
      gross_supply_amount: grossSupply,
      proxy_payroll_amount: supply,
    };
  });
  const totalPayrollSupply = recordsWithVat.reduce((sum: number, r: any) => sum + (Number(r.supply_amount) || 0), 0);
  const totalPayrollVat = recordsWithVat.reduce((sum: number, r: any) => sum + (Number(r.vat_amount) || 0), 0);

  // 이전 기간 환불 건 조회: 현재 정산월에 환불 승인된 + 이전 기간 매출 건
  const prevRefunds = await db.prepare(`
    SELECT id, type, client_name, amount, refund_amount, contract_date, deposit_date, card_deposit_date, payment_type, refund_approved_at
    FROM sales_records
    WHERE user_id = ? AND COALESCE(refund_amount, 0) > 0
      AND refund_approved_at >= ? AND refund_approved_at <= ?
  `).bind(userId, monthStart, monthEnd + ' 23:59:59').all();
  // '회수'는 이미 지급확정(잠금)된 이전 월의 커미션을 환수하는 것.
  // 원매출월이 아직 미확정이거나, 잠금 전에 환불된 경우엔 그 달에서 매출 제외(공제)로 이미 반영되므로 회수(중복차감) 대상이 아니다.
  const lockedSavesForRecovery = await db.prepare(
    "SELECT period, updated_at FROM payroll_saves WHERE user_id = ? AND locked = 1"
  ).bind(userId).all();
  const lockedPeriodAt = new Map<string, string>();
  for (const row of (lockedSavesForRecovery.results as any[])) {
    lockedPeriodAt.set(String(row.period || ''), String(row.updated_at || ''));
  }
  const refundRecoveries = (prevRefunds.results as any[]).filter((r: any) => {
    // 원래 매출이 이전 기간인지 확인
    const sd = r.payment_type === '카드' && r.card_deposit_date ? r.card_deposit_date
      : r.deposit_date ? r.deposit_date : r.contract_date;
    if (!sd || sd >= monthStart) return false;
    // 원매출월이 '환불 승인 시점 이전에' 잠긴 경우만 회수(= 실제 지급된 커미션 환수).
    const originLockedAt = lockedPeriodAt.get(payrollPeriodLabelFromMonth(String(sd).slice(0, 7)));
    return !!originLockedAt && originLockedAt < String(r.refund_approved_at || '');
  }).map((r: any) => {
    const supply = vatSupplyAmount(r.refund_amount, month);
    const recovery = calculateRefundRecoveryAmount({
      amount: r.refund_amount,
      payType: isCommission ? 'commission' : 'salary',
      commissionRate: effectiveRate,
      payrollMonth: month,
    });
    return { ...r, supply_amount: supply, recovery_amount: recovery };
  });

  // 전월 이월 공제(carryover): 이번 정산월(month)을 청구월로 하는 미해소 이월분을 세후공제로 반영한다.
  await db.prepare(`CREATE TABLE IF NOT EXISTS payroll_carryovers (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, origin_month TEXT NOT NULL, target_month TEXT NOT NULL,
    amount INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')), updated_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
    UNIQUE(user_id, origin_month)
  )`).run();
  const pendingCarryover = await db.prepare(
    "SELECT origin_month, amount FROM payroll_carryovers WHERE user_id = ? AND target_month = ? AND status = 'pending' LIMIT 1"
  ).bind(userId, month).first<{ origin_month: string; amount: number }>();
  const carryoverDeduction = pendingCarryover
    ? { origin_month: pendingCarryover.origin_month, amount: Number(pendingCarryover.amount) || 0 }
    : null;

  // 계약포상은 2026-08까지 기존 짝수월 2개월제, 2026-09부터 당월 전사 순위로 산정한다.
  const contractAward = (contractAwardPeriod.isAwardMonth && !isHQ)
    ? await calculateContractAwardForUser(db, userId, month)
    : { rank: null, count: 0, award: 0, total_amount: 0 };
  const joiningSettlement = buildJoiningSettlement(user, month, salary, positionAllowance);
  const terminationSettlement = await buildTerminationSettlement(db, userId, user, month, salary, positionAllowance);

  const payrollResponse = {
    user,
    accounting: isJanFeb2026
      ? { ...(accounting || { salary: 0, standard_sales: 0, grade: '', position_allowance: 0 }), pay_type: 'commission', commission_rate: effectiveRate }
      : (accounting || { salary: 0, standard_sales: 0, grade: '', position_allowance: 0, pay_type: 'salary', commission_rate: 0 }),
    is_hq: isHQ,
    is_commission: isCommission,
    month,
    period_start: monthStart,
    period_end: monthEnd,
    period_label: periodLabel,
    bonus_period_label: isPayoutMonth ? `${y}년 ${bonusPeriodStartMonth}~${bonusPeriodEndMonth}월` : null,
    is_payout_month: isPayoutMonth,
    is_contract_award_month: contractAwardPeriod.isAwardMonth,
    contract_award_period_label: contractAwardPeriod.label,
    is_paid_period: isPaidPeriod,
    is_snapshot: false,
    payroll_save: savedPayroll ? {
      locked: !!savedPayroll.locked,
      pay_type: savedPayroll.pay_type,
      saved_at: savedPayroll.updated_at || savedPayroll.created_at,
    } : null,
    records: recordsWithVat,
    lawitgo_new_settlements: lawitgoNewSettlements,
    refunded_records: refundedRecords,
    refund_recoveries: refundRecoveries,
    carryover_deduction: carryoverDeduction,
    contract_award: contractAward, // { rank, count, award, total_amount } — rank null이면 자격 미달
    joining_settlement: joiningSettlement,
    termination_settlement: terminationSettlement,
    summary: {
      contract_count: contractCount,
      total_sales: totalSales,
      total_supply: totalPayrollSupply,
      total_vat: totalPayrollVat,
      total_refund: totalRefund,
      net_sales: totalSales - totalRefund,
      standard_sales: bonusStandardSales,
      standard_sales_full_period: standardSales,
      bonus_salary_months: salaryBonusMonths,
      bonus_regular_raw: bonusRegularRaw,            // 일반매출 원본(부가세 포함)
      bonus_regular_vat: bonusRegularVat,            // 일반매출 부가세
      bonus_regular_supply: bonusRegularSupply,      // 일반매출 공급가액
      bonus_case_allowance: bonusCaseAllowance,      // 안건 수당 합계 (부가세 X)
      bonus_case_allowance_included_in_bonus_basis: !excludeCaseAllowanceFromBonusBasis,
      bonus_total_sales_raw: bonusTotalSalesRaw,
      bonus_total_vat: bonusTotalVat,                // 호환
      bonus_total_sales: bonusTotalSales,
      bonus_excess: bonusExcess,
      excess: bonusExcess,
      bonus,
      salary,
      position_allowance: positionAllowance,
      base_pay: salary + positionAllowance,
      unpaid_leave_hours: unpaidLeaveHours,
      unpaid_leave_days: unpaidLeaveDays,
      unpaid_leave_deduction: unpaidLeaveDeduction,
      unpaid_leave_settlement: unpaidLeaveSettlement,
      unpaid_leave_absence_settlement: unpaidLeaveSettlement.leave_of_absence ? {
        paid_days: unpaidLeaveSettlement.absence_paid_days,
        unpaid_days: unpaidLeaveSettlement.absence_unpaid_days,
        payroll_base_days: unpaidLeaveSettlement.payroll_base_days,
        prorated_base_pay: unpaidLeaveSettlement.absence_prorated_base_pay,
        base_deduction: unpaidLeaveSettlement.absence_base_deduction,
        periods: unpaidLeaveSettlement.periods.filter((period) => period.mode === 'leave_of_absence'),
      } : null,
      hourly_unpaid_leave_hours: unpaidLeaveSettlement.hourly_unpaid_leave_hours,
      hourly_unpaid_leave_deduction: unpaidLeaveSettlement.hourly_unpaid_leave_deduction,
      company_profit: totalSales - totalRefund - salary - positionAllowance - bonus + unpaidLeaveDeduction,
    },
  };

  return c.json(payrollResponse);
});

// GET /api/payroll/branch-summary?month=YYYY-MM&branch=xxx — 지사별 합산
payroll.get('/branch/summary', requirePayrollAccess, async (c) => {
  const month = c.req.query('month') || defaultPayrollMonth();
  const viewer = c.get('user');
  const scopedBranch = getAsstScopedBranch(viewer);
  if (scopedBranch === null) {
    return c.json({ error: '총무보조는 의정부 본사 및 종합 지표를 열람할 수 없습니다.' }, 403);
  }
  const filterBranch = normalizeBranchName(c.req.query('branch') || '');
  const db = c.env.DB;

  // 조건
  let queryScope;
  try {
    queryScope = buildBranchSummaryQueryScope(month, filterBranch);
  } catch {
    return c.json({ error: '급여월은 YYYY-MM 형식으로 입력해주세요.' }, 400);
  }
  const { branchWhere } = queryScope;

  // 매출 합산
  const salesResult = await db.prepare(`
    SELECT base.branch,
      base.total_count,
      base.confirmed_total,
      base.refunded_total,
      base.pending_total,
      COALESCE(cnt.contract_count, 0) as contract_count
    FROM (
      SELECT sr.branch,
        COUNT(*) as total_count,
        SUM(CASE WHEN ${confirmedSalesSql('sr')} THEN sr.amount ELSE 0 END) as confirmed_total,
        -- 정산 차감 환불액: 당월 '부분환불'(확정 유지)의 환불액만. 당월 전액환불은 confirmed_total에서 이미 제외되어 이중차감 방지.
        SUM(CASE WHEN ${confirmedSalesSql('sr')} THEN COALESCE(sr.refund_amount, 0) ELSE 0 END) as refunded_total,
        SUM(CASE WHEN NOT ${confirmedSalesSql('sr')} AND sr.status IN ('pending', 'card_pending') THEN sr.amount ELSE 0 END) as pending_total
      FROM sales_records sr
      WHERE ${salesPeriodSql('sr')}${branchWhere}
      GROUP BY sr.branch
    ) base
    LEFT JOIN (
      SELECT branch,
        SUM(CASE WHEN customer_amount >= 2200000 THEN 2 ELSE 1 END) as contract_count
      FROM (
        SELECT sr.branch,
          CASE
            WHEN COALESCE(sr.client_name, '') = '' OR COALESCE(sr.client_phone, '') = '' THEN sr.id
            ELSE LOWER(TRIM(sr.client_name)) || '|' || REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(sr.client_phone, ''), '-', ''), ' ', ''), '(', ''), ')', '')
          END as customer_key,
          SUM(sr.amount) as customer_amount
        FROM sales_records sr
        WHERE ${recognizedSalesDateSql('sr')} BETWEEN ? AND ?${branchWhere}
          AND sr.type = '계약' AND ${confirmedSalesSql('sr')}
          AND (sr.exclude_from_count IS NULL OR sr.exclude_from_count = 0)
        GROUP BY sr.branch, customer_key
      )
      GROUP BY branch
    ) cnt ON cnt.branch = base.branch
  `).bind(...queryScope.bindings).all();

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
payroll.get('/save/:userId', requirePayrollAccess, async (c) => {
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
  const { user_id, period, pay_type: requestedPayType, data: saveData } = await c.req.json<{
    user_id: string; period: string; pay_type: string; data: Record<string, unknown>;
  }>();
  if (!(await canAccessUserPayroll(db, user, user_id))) {
    return c.json({ error: '해당 직원의 정산 정보 저장 권한이 없습니다.' }, 403);
  }
  if (false && isPayrollPaidMonth(period)) {
    return c.json({ error: '지급일(익월 5일)이 지난 급여정산은 수정할 수 없습니다.' }, 400);
  }

  // 잠금 체크: 익달 5일 이후면 수정 불가
  const existing = await db.prepare('SELECT locked FROM payroll_saves WHERE user_id = ? AND period = ?').bind(user_id, period).first<any>();
  if (existing?.locked) return c.json({ error: '해당 기간 정산은 잠금 상태입니다. (익달 5일 이후 수정 불가)' }, 400);

  const submittedSnapshot = (saveData as any).payroll_snapshot;
  const saveMonth = parsePayrollPeriodMonth(period);
  if (!saveMonth) return c.json({ error: 'period는 YYYY-MM 또는 YYYY년 M월 형식이어야 합니다.' }, 400);
  const authoritative = await buildAuthoritativePayrollSave(
    db,
    user_id,
    saveMonth,
    saveData as Record<string, any>,
    submittedSnapshot?.response || null,
  );
  if (!authoritative) return c.json({ error: '사용자를 찾을 수 없습니다.' }, 404);
  if (requestedPayType !== authoritative.payType) {
    return c.json({ error: '현재 급여형과 저장 요청의 급여형이 일치하지 않습니다. 화면을 새로고침해주세요.' }, 409);
  }
  const submittedPayType = String(submittedSnapshot?.response?.accounting?.pay_type || '');
  if (submittedPayType && submittedPayType !== authoritative.payType) {
    return c.json({ error: '정산 스냅샷의 급여형이 현재 급여형과 일치하지 않습니다. 화면을 새로고침해주세요.' }, 409);
  }
  if (submittedSnapshot?.response) {
    const submittedAward = Number(submittedSnapshot.response.contract_award?.award) || 0;
    const authoritativeAward = Number(authoritative.response?.contract_award?.award) || 0;
    const submittedRank = Number(submittedSnapshot.response.contract_award?.rank) || 0;
    const authoritativeRank = Number(authoritative.response?.contract_award?.rank) || 0;
    if (submittedAward !== authoritativeAward || submittedRank !== authoritativeRank) {
      return c.json({ error: '계약포상 산정 결과가 최신 데이터와 일치하지 않습니다. 화면을 새로고침해주세요.' }, 409);
    }
  }

  const id = crypto.randomUUID();
  const withholdingSettlements = normalizeWithholdingSettlements((saveData as any).withholdingSettlements);
  const normalizedSnapshot = submittedSnapshot ? {
    ...submittedSnapshot,
    month: saveMonth,
    period,
    response: authoritative.response,
  } : null;
  const normalizedBaseData = {
    ...saveData,
    settle_month: saveMonth,
    withholdingSettlements,
    ...(authoritative.businessIncome ? { business_income_settlement: authoritative.businessIncome } : {}),
    payroll_snapshot: normalizedSnapshot ? {
      ...normalizedSnapshot,
      manual: {
        ...(normalizedSnapshot.manual || {}),
        withholdingSettlements,
      },
    } : null,
  };
  const normalizedData = authoritative.settlement
    ? applyFreelancerSettlementToSaveData(normalizedBaseData, authoritative.settlement)
    : normalizedBaseData;
  await db.prepare(`
    INSERT INTO payroll_saves (id, user_id, period, pay_type, data, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, period) DO UPDATE SET
      data = excluded.data, pay_type = excluded.pay_type, updated_at = datetime('now')
  `).bind(id, user_id, period, authoritative.payType, JSON.stringify(normalizedData), user.sub).run();

  return c.json({ success: true });
});

// POST /api/payroll/lock — 자동 잠금 (cron 또는 수동)
payroll.post('/lock', requireRole(...ACCOUNTING_ROLES), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const body = await c.req.json<{ user_id?: string; period?: string }>().catch(() => ({} as { user_id?: string; period?: string }));
  if (body.user_id && body.period) {
    if (!(await canAccessUserPayroll(db, user, body.user_id))) {
      return c.json({ error: '해당 직원의 급여정산 확정 권한이 없습니다.' }, 403);
    }
    const existing = await db.prepare('SELECT id, data, pay_type, locked FROM payroll_saves WHERE user_id = ? AND period = ?').bind(body.user_id, body.period).first<any>();
    if (!existing) return c.json({ error: '저장된 급여정산이 없습니다. 먼저 정산 저장 후 확정해주세요.' }, 400);
    if (existing.locked) return c.json({ success: true, locked: 1 });
    const existingData = parsePayrollSaveData(existing.data);
    if (!existingData.payroll_snapshot?.response) {
      return c.json({ error: '확정 시점 스냅샷이 없습니다. 정산을 다시 저장한 뒤 확정해주세요.' }, 400);
    }
    const lockMonth = parsePayrollPeriodMonth(body.period);
    const authoritative = lockMonth
      ? await buildAuthoritativePayrollSave(
        db,
        body.user_id,
        lockMonth,
        existingData,
        existingData.payroll_snapshot.response,
      )
      : null;
    if (!authoritative || authoritative.payType !== existing.pay_type) {
      return c.json({ error: '현재 급여형 또는 계약포상 기준과 저장된 정산이 다릅니다. 정산을 다시 저장한 뒤 확정해주세요.' }, 409);
    }
    const savedAward = existingData.payroll_snapshot.response.contract_award || {};
    const currentAward = authoritative.response?.contract_award || {};
    if (
      (Number(savedAward.rank) || 0) !== (Number(currentAward.rank) || 0)
      || (Number(savedAward.award) || 0) !== (Number(currentAward.award) || 0)
    ) {
      return c.json({ error: '계약포상 순위가 저장 후 변경되었습니다. 정산을 다시 저장한 뒤 확정해주세요.' }, 409);
    }
    await db.prepare("UPDATE payroll_saves SET locked = 1, updated_at = datetime('now') WHERE user_id = ? AND period = ? AND locked = 0")
      .bind(body.user_id, body.period).run();

    // 이월(carryover): 실지급(net_pay)이 음수면 미회수분을 익월로 이월하고, 이번 달로 청구되던 이월분은 해소한다.
    const settleMonth = String((existingData as unknown as { settle_month?: string }).settle_month || '');
    const netPay = Math.round(Number((existingData as unknown as { net_pay?: number }).net_pay));
    if (/^\d{4}-\d{2}$/.test(settleMonth) && Number.isFinite(netPay)) {
      await db.prepare(`CREATE TABLE IF NOT EXISTS payroll_carryovers (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, origin_month TEXT NOT NULL, target_month TEXT NOT NULL,
        amount INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_by TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')), updated_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
        UNIQUE(user_id, origin_month)
      )`).run();
      await db.prepare("UPDATE payroll_carryovers SET status = 'resolved', updated_at = datetime('now', '+9 hours') WHERE user_id = ? AND target_month = ? AND status = 'pending'")
        .bind(body.user_id, settleMonth).run();
      const nextMonth = nextPayrollMonth(settleMonth);
      if (netPay < 0 && nextMonth) {
        await db.prepare(`INSERT INTO payroll_carryovers (id, user_id, origin_month, target_month, amount, status, created_by)
          VALUES (?, ?, ?, ?, ?, 'pending', ?)
          ON CONFLICT(user_id, origin_month) DO UPDATE SET
            target_month = excluded.target_month, amount = excluded.amount, status = 'pending',
            created_by = excluded.created_by, updated_at = datetime('now', '+9 hours')`)
          .bind(crypto.randomUUID(), body.user_id, settleMonth, nextMonth, -netPay, user.sub).run();
      } else {
        await db.prepare("DELETE FROM payroll_carryovers WHERE user_id = ? AND origin_month = ? AND status = 'pending'")
          .bind(body.user_id, settleMonth).run();
      }
    }

    return c.json({ success: true, locked: 1 });
  }
  const result = await lockPaidPayrollSaves(db);
  return c.json({ success: true, ...result });
});

payroll.post('/unlock', requireRole('master', 'accountant'), async (c) => {
  const db = c.env.DB;
  const body = await c.req.json<{ user_id?: string; period?: string }>().catch(() => ({} as { user_id?: string; period?: string }));
  if (!body.user_id || !body.period) return c.json({ error: 'user_id와 period가 필요합니다.' }, 400);
  const result = await db.prepare("UPDATE payroll_saves SET locked = 0, updated_at = datetime('now') WHERE user_id = ? AND period = ?")
    .bind(body.user_id, body.period).run();
  return c.json({ success: true, unlocked: result.meta?.changes || 0 });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 사업소득신고 (비율제 대상)
// — /:userId 와 경로 충돌 방지 위해 /reports/business-income 으로 변경
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// GET /api/payroll/reports/business-income?month=YYYY-MM
payroll.get('/reports/business-income', requirePayrollAccess, async (c) => {
  const db = c.env.DB;
  const viewer = c.get('user');
  if (false && viewer?.role === 'accountant_asst') {
    return c.json({ error: '총무보조는 세무자료를 열람할 수 없습니다.' }, 403);
  }
  const scopedBranch = getAsstScopedBranch(viewer);
  if (scopedBranch === null) {
    return c.json({ error: '총무보조는 의정부 본사 및 종합 지표를 열람할 수 없습니다.' }, 403);
  }
  const month = c.req.query('month') || defaultPayrollMonth();
  const [y, m] = month.split('-').map(Number);
  const periodLabel = payrollPeriodLabel(month);
  const monthStart = `${month}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const monthEnd = `${month}-${String(lastDay).padStart(2, '0')}`;
  const contractAwardPeriod = getContractAwardPeriod(month);
  await ensurePayTypeHistoryTable(db);

  // 2026-01·02 특별 규칙: 전원 비율제(기본 50%) 처리 (payroll 로직과 동일)
  const isJanFeb2026 = month === '2026-01' || month === '2026-02';

  // 비율제 대상 사용자 목록
  let usersResult;
  const branchFilterSql = scopedBranch ? ' AND u.branch = ?' : '';
  const branchFilterBinds = scopedBranch ? [scopedBranch] : [];
  if (isJanFeb2026) {
    // 전체 활성 컨설턴트 (본사관리/명도팀/support 제외, 퇴사자 포함 → 과거 회차 보고 위해)
    usersResult = await db.prepare(`
      SELECT u.id, u.name, u.branch, u.department, u.role,
        COALESCE(ua.commission_rate, 0) as commission_rate,
        COALESCE(ua.ssn, '') as ssn,
        COALESCE(ua.address, '') as address,
        ps.data as payroll_save_data, COALESCE(ps.locked, 0) as payroll_locked
      FROM users u
      LEFT JOIN user_accounting ua ON ua.user_id = u.id
      LEFT JOIN payroll_saves ps ON ps.user_id = u.id AND ps.period = ?
      WHERE u.approved = 1
        AND u.role IN ('member', 'manager', 'resigned')
        AND REPLACE(u.branch, ' ', '') != '본사관리'
        AND u.department != '명도팀'
        ${branchFilterSql}
      ORDER BY u.branch, u.department, u.name
    `).bind(periodLabel, ...branchFilterBinds).all<any>();
  } else {
    const historyPayTypeSql = payTypeAtMonthSql('u.id', '?', 'ua.pay_type');
    usersResult = await db.prepare(`
      SELECT u.id, u.name, u.branch, u.department, u.role, ua.commission_rate, ua.ssn, ua.address,
        ps.data as payroll_save_data, COALESCE(ps.locked, 0) as payroll_locked
      FROM user_accounting ua
      JOIN users u ON u.id = ua.user_id
      LEFT JOIN payroll_saves ps ON ps.user_id = u.id AND ps.period = ?
      WHERE (${historyPayTypeSql} = 'commission' OR ps.pay_type = 'commission') AND u.approved = 1 AND u.role != 'resigned'
        ${branchFilterSql}
      ORDER BY u.branch, u.department, u.name
    `).bind(periodLabel, month, ...branchFilterBinds).all<any>();
  }

  // commission_rate_overrides 일괄 조회 (해당 월)
  const overridesResult = await db.prepare(
    'SELECT user_id, commission_rate FROM commission_rate_overrides WHERE year_month = ?'
  ).bind(month).all<any>().catch(() => ({ results: [] }));
  const rateOverrides: Record<string, number> = {};
  for (const r of (overridesResult.results || [])) {
    rateOverrides[r.user_id] = Number(r.commission_rate);
  }

  // 각 사용자별 해당월 확정 매출 (정산일 기준) 집계
  const eligibleUsers = usersResult.results || [];
  const autoMap: Record<string, { amount: number; tax: number; net: number }> = {};
  for (const u of eligibleUsers) {
    const savedData = parsePayrollSaveData(u.payroll_save_data);
    const frozenBusinessIncome = savedData.business_income_settlement;
    if (Number(u.payroll_locked) && frozenBusinessIncome) {
      const frozenAmount = Number(frozenBusinessIncome.amount);
      const frozenTax = Number(frozenBusinessIncome.tax);
      const frozenNet = Number(frozenBusinessIncome.net);
      if ([frozenAmount, frozenTax, frozenNet].every(Number.isFinite)) {
        autoMap[u.id] = { amount: frozenAmount, tax: frozenTax, net: frozenNet };
        continue;
      }
    }
    // 적용 rate: 1) override > 2) user_accounting.commission_rate > 3) Jan/Feb 2026 기본 50%
    const rate = rateOverrides[u.id] !== undefined
      ? rateOverrides[u.id]
      : (Number(u.commission_rate) || (isJanFeb2026 ? 50 : 0));
    const salesRes = await db.prepare(`
      SELECT type, type_detail, amount, proxy_cost, direction, payment_type, card_deposit_date, deposit_date, contract_date
      FROM sales_records
      WHERE user_id = ? AND ${confirmedSalesSql('sales_records')}
        AND (
          (payment_type = '카드' AND card_deposit_date >= ? AND card_deposit_date <= ?)
          OR (payment_type != '카드' AND payment_type != '' AND deposit_date >= ? AND deposit_date <= ?)
          OR ((payment_type = '' OR payment_type IS NULL) AND contract_date >= ? AND contract_date <= ?)
        )
    `).bind(u.id, monthStart, monthEnd, monthStart, monthEnd, monthStart, monthEnd).all<any>();

    let normalSupply = 0;
    let proxyIncome = 0;
    for (const r of (salesRes.results || [])) {
      if ((r.type_detail || '').startsWith('명도성과금')) {
        // sales_records의 명도성과금 INSERT 건은 제외 (cases 직접 조회로 중복 방지)
        continue;
      } else if (r.type === '매수신청대리') {
        // amount = 매출 gross (VAT 포함), proxy_cost = 대리비용
        // 담당자 지급 = (매출 - 부가세) - 대리비용 = amount/1.1 - cost
        const payrollAmount = vatSupplyAmount(r.amount || 0, month) - (r.proxy_cost || 0);
        proxyIncome += Math.max(payrollAmount, 0);
      } else {
        normalSupply += vatSupplyAmount(r.amount || 0, month);
      }
    }

    // 안건 수당: 짝수월 정산 시 cases 직접 조회로 등급 성과금 자동 합산
    // (commission rate 미적용, 부가세 없음, 33% 세금만 차감)
    let caseAllowanceIncome = 0;
    if (m % 2 === 0 && !isCaseAllowanceExcludedName(u.name)) {
      const m1 = m - 1;
      const m2 = m;
      const periodKey = `${y}-${String(m1).padStart(2, '0')}_${String(m2).padStart(2, '0')}`;
      const caseAllowanceCases = await db.prepare(`
        SELECT COALESCE(SUM(
          CASE WHEN fee_type = 'fixed' THEN MAX(0, fee_amount - 150000)
               ELSE CAST(fee_amount * 1.0 / 1.1 AS INTEGER) END
        ), 0) as total_fee_adjusted
        FROM cases
        WHERE consultant_user_id = ? AND bimonthly_period = ?
          AND NOT EXISTS (SELECT 1 FROM lawitgo_new_settlements lns WHERE lns.case_id = cases.id)
      `).bind(u.id, periodKey).first<any>();
      caseAllowanceIncome = calculateCaseAllowance(caseAllowanceCases?.total_fee_adjusted || 0);
    }

    const lawitgoNewSettlementIncome = (await getLawitgoNewSettlements(db, u.id, month))
      .reduce((sum, item) => sum + item.amount, 0);
    const commissionAmount = truncMoney(normalSupply * rate / 100);
    const existingBusinessIncome = commissionAmount + proxyIncome + caseAllowanceIncome + lawitgoNewSettlementIncome;
    const isContractAwardEligible = contractAwardPeriod.isAwardMonth
      && normalizeBranchName(u.branch) !== '본사관리'
      && !['ceo', 'cc_ref', 'accountant', 'accountant_asst'].includes(String(u.role || ''));
    const frozenContractAward = Number(
      savedData.freelancer_settlement?.contractAward
      ?? savedData.payroll_snapshot?.response?.contract_award?.award,
    ) || 0;
    const contractAwardAmount = Number(u.payroll_locked)
      ? frozenContractAward
      : (isContractAwardEligible
        ? (await calculateContractAwardForUser(db, u.id, month)).award
        : 0);
    const settlement = calculateFreelancerSettlement({
      // 기존 신고 소득 구성은 그대로 두고 계약포상만 과세소득에 추가한다.
      settlementIncome: existingBusinessIncome,
      contractAward: contractAwardAmount,
    });
    autoMap[u.id] = {
      amount: settlement.grossIncome,
      tax: settlement.withholdingTax,
      net: settlement.netPay,
    };
  }

  // 저장된 오버라이드/ad-hoc 항목
  const overrideResult = await db.prepare(
    'SELECT * FROM business_income_entries WHERE month = ? ORDER BY is_ad_hoc, created_at'
  ).bind(month).all<any>();
  const overrideByUser: Record<string, any> = {};
  const adHocList: any[] = [];
  for (const row of (overrideResult.results || [])) {
    if (row.is_ad_hoc) adHocList.push(row);
    else if (row.user_id) overrideByUser[row.user_id] = row;
  }

  // 병합
  const entries = eligibleUsers.map((u: any) => {
    const auto = autoMap[u.id] || { amount: 0, tax: 0, net: 0 };
    const ov = overrideByUser[u.id];
    if (ov) {
      return {
        id: ov.id, user_id: u.id, name: ov.name || u.name,
        ssn: ov.ssn || u.ssn || '', address: ov.address || u.address || '',
        amount: Number(ov.amount), tax: Number(ov.tax), net_amount: Number(ov.net_amount),
        branch: u.branch, department: u.department,
        is_ad_hoc: false, is_overridden: true, note: ov.note || '',
      };
    }
    return {
      id: `auto:${u.id}`, user_id: u.id, name: u.name,
      ssn: u.ssn || '', address: u.address || '',
      amount: auto.amount, tax: auto.tax, net_amount: auto.net,
      branch: u.branch, department: u.department,
      is_ad_hoc: false, is_overridden: false, note: '',
    };
  }).concat(adHocList.map((ov: any) => ({
    id: ov.id, user_id: null, name: ov.name,
    ssn: ov.ssn || '', address: ov.address || '',
    amount: Number(ov.amount), tax: Number(ov.tax), net_amount: Number(ov.net_amount),
    branch: '', department: '',
    is_ad_hoc: true, is_overridden: false, note: ov.note || '',
  })));

  const total_amount = entries.reduce((s, e) => s + (e.amount || 0), 0);
  const total_tax = entries.reduce((s, e) => s + (e.tax || 0), 0);
  const total_net = entries.reduce((s, e) => s + (e.net_amount || 0), 0);

  return c.json({ month, entries, total_amount, total_tax, total_net });
});

// PUT /api/payroll/reports/business-income/save — 항목 저장 (오버라이드 또는 ad-hoc)
payroll.put('/reports/business-income/save', requireRole(...ACCOUNTING_ROLES), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const body = await c.req.json<{
    month: string;
    id?: string;        // 'auto:{user_id}' | 기존 override id | ad-hoc id
    user_id?: string | null;
    name: string;
    ssn?: string; address?: string;
    amount: number; tax: number; net_amount: number;
    is_ad_hoc?: boolean;
    note?: string;
  }>();

  if (!body.month || !/^\d{4}-\d{2}$/.test(body.month)) return c.json({ error: 'month 형식 오류' }, 400);
  if (false && isPayrollPaidMonth(body.month)) {
    return c.json({ error: '지급일(익월 5일)이 지난 사업소득 정산은 수정할 수 없습니다.' }, 400);
  }
  const isAdHoc = body.is_ad_hoc || !body.user_id;
  if (false && user?.role === 'accountant_asst') {
    return c.json({ error: '총무보조는 세무자료를 수정할 수 없습니다.' }, 403);
  }

  // 기존 entry 찾기
  let existingId: string | null = null;
  if (body.id && !body.id.startsWith('auto:')) existingId = body.id;
  else if (body.user_id) {
    const r = await db.prepare('SELECT id FROM business_income_entries WHERE user_id = ? AND month = ? AND is_ad_hoc = 0').bind(body.user_id, body.month).first<any>();
    if (r) existingId = r.id;
  }

  if (existingId) {
    await db.prepare(`
      UPDATE business_income_entries SET name = ?, ssn = ?, address = ?, amount = ?, tax = ?, net_amount = ?, note = ?, updated_by = ?, updated_at = datetime('now')
      WHERE id = ?
    `).bind(body.name, body.ssn || '', body.address || '', body.amount, body.tax, body.net_amount, body.note || '', user.sub, existingId).run();
    return c.json({ success: true, id: existingId });
  } else {
    const newId = crypto.randomUUID();
    await db.prepare(`
      INSERT INTO business_income_entries (id, month, user_id, name, ssn, address, amount, tax, net_amount, is_ad_hoc, note, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(newId, body.month, isAdHoc ? null : body.user_id, body.name, body.ssn || '', body.address || '', body.amount, body.tax, body.net_amount, isAdHoc ? 1 : 0, body.note || '', user.sub).run();
    return c.json({ success: true, id: newId });
  }
});

// DELETE /api/payroll/reports/business-income/:id — 오버라이드/ad-hoc 삭제
payroll.delete('/reports/business-income/:id', requireRole(...ACCOUNTING_ROLES), async (c) => {
  const user = c.get('user');
  if (false && user?.role === 'accountant_asst') {
    return c.json({ error: '총무보조는 사업소득 항목을 삭제할 수 없습니다.' }, 403);
  }
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT month FROM business_income_entries WHERE id = ?').bind(id).first<any>();
  if (false && existing?.month && isPayrollPaidMonth(existing.month)) {
    return c.json({ error: '지급일(익월 5일)이 지난 사업소득 정산은 삭제할 수 없습니다.' }, 400);
  }
  await c.env.DB.prepare('DELETE FROM business_income_entries WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

// ━━ 사업소득신고 추가리스트 (풀) CRUD ━━
payroll.get('/reports/business-income-pool', requirePayrollAccess, async (c) => {
  const user = c.get('user');
  if (false && user?.role === 'accountant_asst') {
    return c.json({ pool: [] });
  }
  const result = await c.env.DB.prepare('SELECT * FROM business_income_pool ORDER BY name').all();
  return c.json({ pool: result.results || [] });
});

payroll.post('/reports/business-income-pool', requireRole(...ACCOUNTING_ROLES), async (c) => {
  const user = c.get('user');
  if (false && user?.role === 'accountant_asst') return c.json({ error: 'Permission denied.' }, 403);
  const { name, ssn, address, note } = await c.req.json<{ name: string; ssn?: string; address?: string; note?: string }>();
  if (!name?.trim()) return c.json({ error: '이름을 입력하세요.' }, 400);
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    'INSERT INTO business_income_pool (id, name, ssn, address, note, created_by) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, name.trim(), ssn || '', address || '', note || '', user.sub).run();
  return c.json({ success: true, id });
});

payroll.put('/reports/business-income-pool/:id', requireRole(...ACCOUNTING_ROLES), async (c) => {
  const user = c.get('user');
  if (false && user?.role === 'accountant_asst') return c.json({ error: 'Permission denied.' }, 403);
  const id = c.req.param('id');
  const { name, ssn, address, note } = await c.req.json<{ name: string; ssn?: string; address?: string; note?: string }>();
  if (!name?.trim()) return c.json({ error: '이름을 입력하세요.' }, 400);
  await c.env.DB.prepare(
    "UPDATE business_income_pool SET name = ?, ssn = ?, address = ?, note = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(name.trim(), ssn || '', address || '', note || '', id).run();
  return c.json({ success: true });
});

payroll.delete('/reports/business-income-pool/:id', requireRole(...ACCOUNTING_ROLES), async (c) => {
  const user = c.get('user');
  if (false && user?.role === 'accountant_asst') return c.json({ error: 'Permission denied.' }, 403);
  await c.env.DB.prepare('DELETE FROM business_income_pool WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ success: true });
});

export default payroll;
