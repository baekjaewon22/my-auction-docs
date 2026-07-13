import { Hono } from 'hono';
import type { AuthEnv } from '../types';
import { authMiddleware, requireRole } from '../middleware/auth';
import { sendAlimtalkByTemplate, APP_URL } from '../alimtalk';
import { isHeadOfficeBranch } from '../lib/branchAliases';
import { buildOrgApprovalChain } from '../lib/org-approval-chain';

const leave = new Hono<AuthEnv>();
leave.use('*', authMiddleware);

// ───── 헬퍼 ─────
const HOURS_PER_DAY = 8;
const HALF_DAY_PERIODS = new Set(['오전', '오후']);

function normalizeLeaveType(type: string): '연차' | '반차' | '시간차' | '특별휴가' {
  if (type === '월차') return '연차';
  if (type === '반차' || type === '시간차' || type === '특별휴가') return type;
  return '연차';
}

async function ensureLeaveRequestSchema(db: D1Database): Promise<void> {
  const columns = await db.prepare('PRAGMA table_info(leave_requests)').all<{ name: string }>();
  const names = new Set((columns.results || []).map((c) => c.name));
  if (!names.has('half_day_period')) {
    await db.prepare("ALTER TABLE leave_requests ADD COLUMN half_day_period TEXT NOT NULL DEFAULT ''").run();
  }
  if (!names.has('first_approved_by')) {
    await db.prepare("ALTER TABLE leave_requests ADD COLUMN first_approved_by TEXT NOT NULL DEFAULT ''").run();
  }
  if (!names.has('first_approved_at')) {
    await db.prepare("ALTER TABLE leave_requests ADD COLUMN first_approved_at TEXT NOT NULL DEFAULT ''").run();
  }
}

async function ensureAnnualLeaveSchema(db: D1Database): Promise<void> {
  const columns = await db.prepare('PRAGMA table_info(annual_leave)').all<{ name: string }>();
  const names = new Set((columns.results || []).map((c) => c.name));
  if (!names.has('manual_total_adjust_days')) {
    await db.prepare("ALTER TABLE annual_leave ADD COLUMN manual_total_adjust_days REAL NOT NULL DEFAULT 0").run();
  }
  if (!names.has('manual_used_adjust_days')) {
    await db.prepare("ALTER TABLE annual_leave ADD COLUMN manual_used_adjust_days REAL NOT NULL DEFAULT 0").run();
  }
}

function normalizeHalfDayPeriod(leaveType: string, value: unknown): '' | '오전' | '오후' {
  if (leaveType !== '반차') return '';
  const period = String(value || '').trim();
  return HALF_DAY_PERIODS.has(period) ? period as '오전' | '오후' : '';
}

function leaveTypeForMessage(leaveType: string, halfDayPeriod?: string): string {
  return leaveType === '반차' && halfDayPeriod ? `반차(${halfDayPeriod})` : leaveType;
}

function kstToday(): Date {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

function isSummerVacationReason(reason: unknown): boolean {
  return String(reason || '').includes('[여름휴가]');
}

function isRewardVacationReason(reason: unknown): boolean {
  return String(reason || '').includes('[특별유급]') && String(reason || '').includes('포상휴가');
}

function isSummerVacationWindowOpen(): boolean {
  const month = kstToday().getUTCMonth() + 1;
  return month >= 7 && month <= 8;
}

function isJulyOrAugustDate(value: string): boolean {
  const month = Number(String(value || '').slice(5, 7));
  return month === 7 || month === 8;
}

function parseDateString(value: string): Date | null {
  const [year, month, day] = String(value || '').slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isWeekendDate(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

async function getLeaveHolidayDates(db: D1Database, startDate: string, endDate: string): Promise<Set<string>> {
  const startYear = Number(String(startDate || '').slice(0, 4));
  const endYear = Number(String(endDate || startDate || '').slice(0, 4));
  if (!startYear || !endYear) return new Set();
  const fromYear = Math.min(startYear, endYear);
  const toYear = Math.max(startYear, endYear);
  try {
    const result = await db.prepare(`
      SELECT holiday_date
      FROM system_holidays
      WHERE enabled = 1
        AND applies_to IN ('all', 'leave')
        AND substr(holiday_date, 1, 4) >= ?
        AND substr(holiday_date, 1, 4) <= ?
    `).bind(String(fromYear), String(toYear)).all<{ holiday_date: string }>();
    return new Set((result.results || []).map((row) => row.holiday_date).filter(Boolean));
  } catch {
    return new Set();
  }
}

function countLeaveBusinessDays(startDate: string, endDate: string, holidays = new Set<string>()): number {
  const start = parseDateString(startDate);
  const end = parseDateString(endDate);
  if (!start || !end || end < start) return 1;
  const cursor = new Date(start);
  let count = 0;
  while (cursor <= end) {
    const dateText = formatDateString(cursor);
    if (!isWeekendDate(cursor) && !holidays.has(dateText)) count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return Math.max(1, count);
}

async function hasActiveSummerVacationRequest(db: D1Database, userId: string, year: string): Promise<boolean> {
  const row = await db.prepare(`
    SELECT id FROM leave_requests
    WHERE user_id = ?
      AND leave_type = '특별휴가'
      AND reason LIKE '%[여름휴가]%'
      AND start_date >= ? AND start_date <= ?
      AND status IN ('pending', 'approved', 'cancel_requested')
    LIMIT 1
  `).bind(userId, `${year}-01-01`, `${year}-12-31`).first();
  return Boolean(row);
}

const LEAVE_APPROVER_ROLES = new Set(['admin', 'manager', 'accountant', 'cc_ref']);

type LeaveApprovalUser = {
  id: string;
  name: string;
  role: string;
  phone: string;
};

type LeaveApprovalFlow = {
  firstApprover: LeaveApprovalUser | null;
  finalApprover: LeaveApprovalUser | null;
  currentApprover: LeaveApprovalUser | null;
  isFinalStep: boolean;
};

type LeaveApprovalDecision = LeaveApprovalFlow & {
  canApprove: boolean;
};

async function getLeaveApprovalChainUsers(db: D1Database, requesterId: string): Promise<LeaveApprovalUser[]> {
  const chain = await buildOrgApprovalChain(db, requesterId);
  const users: LeaveApprovalUser[] = [];
  for (const approverId of chain) {
    const approver = await db.prepare(`
      SELECT id, name, role, phone
      FROM users
      WHERE id = ?
        AND approved = 1
      LIMIT 1
    `).bind(approverId).first<LeaveApprovalUser>();
    if (approver && LEAVE_APPROVER_ROLES.has(approver.role)) {
      users.push({ ...approver, phone: approver.phone || '' });
    }
  }
  return users;
}

function pickLeaveFinalApprover(chainUsers: LeaveApprovalUser[]): LeaveApprovalUser | null {
  return chainUsers.find((approver) => approver.role === 'admin')
    || chainUsers.find((approver) => approver.role === 'ceo')
    || chainUsers[chainUsers.length - 1]
    || null;
}

async function getLeaveApprovalFlow(db: D1Database, req: any): Promise<LeaveApprovalFlow> {
  const chainUsers = await getLeaveApprovalChainUsers(db, req.user_id);
  const finalApprover = pickLeaveFinalApprover(chainUsers);
  const finalApproverIndex = finalApprover
    ? chainUsers.findIndex((approver) => approver.id === finalApprover.id)
    : -1;
  const beforeFinalApprovers = finalApproverIndex > 0
    ? chainUsers.slice(0, finalApproverIndex)
    : [];
  const firstApprover = finalApprover
    ? beforeFinalApprovers[0] || finalApprover
    : null;
  const hasFirstApproval = Boolean(String(req.first_approved_by || '').trim());
  const currentApprover = hasFirstApproval || !firstApprover || firstApprover.id === finalApprover?.id
    ? finalApprover
    : firstApprover;

  return {
    firstApprover,
    finalApprover,
    currentApprover,
    isFinalStep: Boolean(currentApprover && finalApprover && currentApprover.id === finalApprover.id),
  };
}

async function getLeaveApprovalDecision(
  db: D1Database,
  user: { sub: string; role: string; branch?: string; department?: string },
  req: any,
  options: { finalOnly?: boolean } = {},
): Promise<LeaveApprovalDecision> {
  const flow = await getLeaveApprovalFlow(db, req);
  if (['master', 'ceo'].includes(user.role)) return { ...flow, canApprove: true, isFinalStep: true };
  if (!LEAVE_APPROVER_ROLES.has(user.role)) return { ...flow, canApprove: false };
  if (!flow.currentApprover) return { ...flow, canApprove: false };
  if (options.finalOnly && flow.currentApprover.id !== flow.finalApprover?.id) {
    return { ...flow, canApprove: false };
  }
  return { ...flow, canApprove: flow.currentApprover.id === user.sub };
}

async function getLeaveApprovalNotifyPhones(db: D1Database, requesterId: string, req: any = {}): Promise<string[]> {
  const flow = await getLeaveApprovalFlow(db, { ...req, user_id: requesterId });
  if (flow.currentApprover?.phone) return [flow.currentApprover.phone];

  const fallback = await db.prepare(
    "SELECT phone FROM users WHERE role IN ('master', 'ceo') AND approved = 1 AND phone != ''"
  ).all<{ phone: string }>();
  return Array.from(new Set((fallback.results || []).map(r => r.phone).filter(Boolean)));
}

async function filterLeaveRequestsByApprovalLine(
  db: D1Database,
  user: { sub: string; role: string },
  requests: any[],
): Promise<any[]> {
  if (['master', 'ceo'].includes(user.role)) return requests;
  if (!LEAVE_APPROVER_ROLES.has(user.role)) return [];

  const visible: any[] = [];
  for (const request of requests) {
    const decision = await getLeaveApprovalDecision(db, user, request, {
      finalOnly: request.status === 'cancel_requested',
    });
    if (decision.canApprove) visible.push(request);
  }
  return visible;
}

function halfDayTimeRange(period?: string): string {
  if (period === '오전') return '09:00~13:00';
  if (period === '오후') return '14:00~18:00';
  return '';
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatLeavePeriodForDoc(req: any): string {
  const dateText = req.start_date === req.end_date ? req.start_date : `${req.start_date} ~ ${req.end_date}`;
  if (req.leave_type !== '반차' || !req.half_day_period) return dateText;
  const timeRange = halfDayTimeRange(req.half_day_period);
  return `${dateText} ${req.half_day_period}${timeRange ? ` (${timeRange})` : ''}`;
}

function buildLeaveArchiveContent(req: any, reqUser: any, approverName: string): string {
  const leaveType = leaveTypeForMessage(req.leave_type, req.half_day_period);
  const period = formatLeavePeriodForDoc(req);
  const hours = Number(req.hours || req.days * HOURS_PER_DAY || 0);
  return `
    <section data-source="leave_request" data-leave-request-id="${req.id}">
      <!-- leave_request_id:${req.id} -->
      <h1 style="text-align:center;">휴가 신청서</h1>
      <table style="width:100%; border-collapse:collapse; margin-top:16px;">
        <tbody>
          <tr><th style="border:1px solid #ddd; padding:8px; width:120px;">성명</th><td style="border:1px solid #ddd; padding:8px;">${escapeHtml(reqUser?.name || req.user_name || '')}</td></tr>
          <tr><th style="border:1px solid #ddd; padding:8px;">지사/부서</th><td style="border:1px solid #ddd; padding:8px;">${escapeHtml(`${req.branch || ''}${req.department ? ' / ' + req.department : ''}`)}</td></tr>
          <tr><th style="border:1px solid #ddd; padding:8px;">휴가 유형</th><td style="border:1px solid #ddd; padding:8px;">${escapeHtml(leaveType)}</td></tr>
          <tr><th style="border:1px solid #ddd; padding:8px;">휴가 기간</th><td style="border:1px solid #ddd; padding:8px;">${escapeHtml(period)}</td></tr>
          <tr><th style="border:1px solid #ddd; padding:8px;">차감 시간</th><td style="border:1px solid #ddd; padding:8px;">${hours}시간</td></tr>
          <tr><th style="border:1px solid #ddd; padding:8px;">신청 사유</th><td style="border:1px solid #ddd; padding:8px;">${escapeHtml(req.reason || '-')}</td></tr>
          <tr><th style="border:1px solid #ddd; padding:8px;">승인자</th><td style="border:1px solid #ddd; padding:8px;">${escapeHtml(approverName || '-')}</td></tr>
          <tr><th style="border:1px solid #ddd; padding:8px;">승인일</th><td style="border:1px solid #ddd; padding:8px;">${new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)}</td></tr>
        </tbody>
      </table>
    </section>
  `;
}

async function createLeaveArchiveDocument(db: D1Database, req: any, approver: any): Promise<string | null> {
  const existing = await db.prepare(
    "SELECT id FROM documents WHERE instr(content, ?) > 0 LIMIT 1"
  ).bind(`leave_request_id:${req.id}`).first<{ id: string }>();
  if (existing?.id) return existing.id;

  const reqUser = await db.prepare('SELECT name, team_id FROM users WHERE id = ?').bind(req.user_id).first<any>();
  const leaveType = leaveTypeForMessage(req.leave_type, req.half_day_period);
  const title = `${leaveType} 신청서 - ${reqUser?.name || req.user_name || ''} (${formatLeavePeriodForDoc(req)})`;
  const docId = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO documents (id, title, content, template_id, author_id, team_id, branch, department, status, created_at, updated_at)
    VALUES (?, ?, ?, NULL, ?, ?, ?, ?, 'approved', datetime('now'), datetime('now'))
  `).bind(
    docId, title, buildLeaveArchiveContent(req, reqUser, approver?.name || ''), req.user_id,
    reqUser?.team_id || null, req.branch || '', req.department || '',
  ).run();
  await db.prepare(
    'INSERT INTO document_logs (id, document_id, user_id, action, details) VALUES (?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), docId, approver?.sub || approver?.id || req.approved_by || req.user_id, 'approved', '연차관리 승인으로 문서보관함에 자동 보관되었습니다.').run();
  return docId;
}

async function cancelLeaveArchiveDocument(db: D1Database, req: any, actor: any, reason: string): Promise<void> {
  const existing = await db.prepare(
    "SELECT id FROM documents WHERE instr(content, ?) > 0 AND cancelled = 0 LIMIT 1"
  ).bind(`leave_request_id:${req.id}`).first<{ id: string }>();
  if (!existing?.id) return;
  await db.prepare(
    "UPDATE documents SET cancelled = 1, cancel_requested = 0, cancel_reason = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(reason, existing.id).run();
  await db.prepare(
    'INSERT INTO document_logs (id, document_id, user_id, action, details) VALUES (?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), existing.id, actor?.sub || actor?.id || req.user_id, 'cancelled', reason).run();
}

function hoursToDays(hours: number): number {
  return Math.round((hours / HOURS_PER_DAY) * 1000) / 1000;
}

function daysToHours(days: number): number {
  return Math.round((Number(days || 0) * HOURS_PER_DAY) * 1000) / 1000;
}

function leaveDisplayFields(data: any) {
  const manualTotalAdjustDays = Number(data.manual_total_adjust_days || 0);
  const manualUsedAdjustDays = Number(data.manual_used_adjust_days || 0);
  const annualTotalHours = daysToHours((data.total_days || 0) + manualTotalAdjustDays);
  const annualUsedHours = daysToHours((data.used_days || 0) + manualUsedAdjustDays);
  const monthlyTotalHours = daysToHours(data.monthly_days || 0);
  const monthlyUsedHours = daysToHours(data.monthly_used || 0);
  const annualRemainingHours = annualTotalHours - annualUsedHours;
  const monthlyRemainingHours = monthlyTotalHours - monthlyUsedHours;
  const totalRemainingHours = annualRemainingHours + monthlyRemainingHours;
  return {
    total_hours: annualTotalHours + monthlyTotalHours,
    used_hours: annualUsedHours + monthlyUsedHours,
    annual_total_hours: annualTotalHours,
    annual_used_hours: annualUsedHours,
    annual_remaining_hours: annualRemainingHours,
    monthly_total_hours: monthlyTotalHours,
    monthly_used_hours: monthlyUsedHours,
    monthly_remaining_hours: monthlyRemainingHours,
    total_remaining_hours: totalRemainingHours,
    annual_remaining: hoursToDays(annualRemainingHours),
    monthly_remaining: hoursToDays(monthlyRemainingHours),
    total_remaining: hoursToDays(totalRemainingHours),
  };
}

/**
 * leave_requests 이력 기반으로 사용 시간 합계 산출 (사용자 타입 인자 받음)
 */
type LeaveCycle = { start: string; end: string };

function todayKstDateOnly(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function dateStringFromParts(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toISOString().slice(0, 10);
}

function addYearsDateString(dateStr: string, years: number): string {
  const [year, month, day] = dateStr.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return '';
  return dateStringFromParts(year + years, month, day);
}

function addDaysDateString(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return '';
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function getCurrentLeaveCycle(hireDate: string, userType: 'monthly' | 'annual'): LeaveCycle | null {
  const normalizedHireDate = (hireDate || '').slice(0, 10);
  if (!normalizedHireDate) return null;

  if (userType === 'monthly') {
    const start = normalizedHireDate < MONTHLY_BASE_DATE ? MONTHLY_BASE_DATE : normalizedHireDate;
    const firstAnniversary = addYearsDateString(normalizedHireDate, 1);
    return {
      start,
      end: firstAnniversary ? addDaysDateString(firstAnniversary, -1) : todayKstDateOnly(),
    };
  }

  const today = todayKstDateOnly();
  const [todayYearText] = today.split('-');
  const [, hireMonthText, hireDayText] = normalizedHireDate.split('-');
  const todayYear = Number(todayYearText);
  if (!todayYear || !hireMonthText || !hireDayText) return null;

  let start = `${todayYear}-${hireMonthText}-${hireDayText}`;
  if (start > today) start = `${todayYear - 1}-${hireMonthText}-${hireDayText}`;
  const nextStart = addYearsDateString(start, 1);
  return {
    start,
    end: nextStart ? addDaysDateString(nextStart, -1) : today,
  };
}

async function sumApprovedLeave(db: D1Database, userId: string, userType: 'monthly' | 'annual', cycle?: LeaveCycle | null): Promise<{ used_days: number; monthly_used: number; used_hours: number; monthly_used_hours: number }> {
  const cycleStart = cycle?.start || null;
  const cycleEnd = cycle?.end || null;

  const result = await db.prepare(`
    SELECT leave_type,
      COALESCE(SUM(CASE WHEN leave_type = '시간차' THEN hours ELSE days * ? END), 0) as total_hours
    FROM leave_requests
    WHERE user_id = ? AND status = 'approved' AND leave_type != '특별휴가'
      AND (? IS NULL OR start_date >= ?)
      AND (? IS NULL OR start_date <= ?)
    GROUP BY leave_type
  `).bind(HOURS_PER_DAY, userId, cycleStart, cycleStart, cycleEnd, cycleEnd).all<{ leave_type: string; total_hours: number }>();

  let usedHours = 0;
  let monthlyUsedHours = 0;
  for (const row of (result.results || [])) {
    const rowHours = Number(row.total_hours) || 0;
    if (userType === 'monthly') {
      monthlyUsedHours += rowHours;
    } else {
      usedHours += rowHours;
    }
  }
  return {
    used_hours: usedHours,
    monthly_used_hours: monthlyUsedHours,
    used_days: hoursToDays(usedHours),
    monthly_used: hoursToDays(monthlyUsedHours),
  };
}

/**
 * leave_requests 이력 기반으로 annual_leave.used_days / monthly_used 재계산 (entitlement는 그대로)
 */
async function recalcUserLeave(db: D1Database, userId: string): Promise<{ used_days: number; monthly_used: number } | null> {
  await ensureAnnualLeaveSchema(db);
  const al = await db.prepare('SELECT leave_type FROM annual_leave WHERE user_id = ?').bind(userId).first<{ leave_type: string }>();
  if (!al) return null;
  const userType = (al.leave_type as 'monthly' | 'annual') || 'annual';
  const userInfo = await db.prepare('SELECT hire_date, created_at FROM users WHERE id = ?').bind(userId).first<{ hire_date: string; created_at: string }>();
  const hireDate = userInfo?.hire_date || (userInfo?.created_at || '').slice(0, 10);
  const cycle = getCurrentLeaveCycle(hireDate, userType);

  const sum = await sumApprovedLeave(db, userId, userType, cycle);
  await db.prepare("UPDATE annual_leave SET used_days = ?, monthly_used = ?, updated_at = datetime('now') WHERE user_id = ?")
    .bind(sum.used_days, sum.monthly_used, userId).run();

  return sum;
}

/**
 * 입사일 기반 entitlement 재초기화 + leave_requests 이력 기반 사용량 재계산
 * - 입사일이 변경됐거나 leave_type이 잘못 잡혔을 때 한 번에 정정
 * - calculateLeaveEntitlement 결과 + sumApprovedLeave 합쳐서 전체 SET
 */
export async function reinitUserLeave(db: D1Database, userId: string): Promise<{ before: any; after: any } | null> {
  await ensureAnnualLeaveSchema(db);
  const userInfo = await db.prepare('SELECT hire_date, created_at FROM users WHERE id = ?').bind(userId).first<{ hire_date: string; created_at: string }>();
  if (!userInfo) return null;
  const hireDate = userInfo.hire_date || (userInfo.created_at || '').slice(0, 10);
  const ent = calculateLeaveEntitlement(hireDate);
  const cycle = getCurrentLeaveCycle(hireDate, ent.type);

  const before = await db.prepare('SELECT total_days, used_days, monthly_days, monthly_used, leave_type, manual_total_adjust_days, manual_used_adjust_days FROM annual_leave WHERE user_id = ?').bind(userId).first<any>();
  const sum = await sumApprovedLeave(db, userId, ent.type, cycle);
  const manualTotalAdjustDays = Number(before?.manual_total_adjust_days || 0);
  const manualUsedAdjustDays = Number(before?.manual_used_adjust_days || 0);

  if (before) {
    await db.prepare(`UPDATE annual_leave SET
      total_days = ?, used_days = ?, monthly_days = ?, monthly_used = ?, leave_type = ?,
      updated_at = datetime('now')
      WHERE user_id = ?`)
      .bind(ent.totalAnnual, sum.used_days, ent.totalMonthly, sum.monthly_used, ent.type, userId).run();
  } else {
    await db.prepare(`INSERT INTO annual_leave
      (id, user_id, total_days, used_days, monthly_days, monthly_used, leave_type)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), userId, ent.totalAnnual, sum.used_days, ent.totalMonthly, sum.monthly_used, ent.type).run();
  }

  const after = {
    total_days: ent.totalAnnual,
    used_days: sum.used_days,
    monthly_days: ent.totalMonthly,
    monthly_used: sum.monthly_used,
    manual_total_adjust_days: manualTotalAdjustDays,
    manual_used_adjust_days: manualUsedAdjustDays,
    effective_total_days: ent.totalAnnual + manualTotalAdjustDays,
    effective_used_days: sum.used_days + manualUsedAdjustDays,
    leave_type: ent.type,
    hire_date: hireDate,
    leave_cycle_start: cycle?.start || '',
    leave_cycle_end: cycle?.end || '',
  };
  return { before, after };
}

// 월차 기산일: 입사일이 이 날짜 이전이면 이 날짜 기준으로 월차 계산
const MONTHLY_BASE_DATE = '2026-03-01';

/** 입사일 기준 근속 개월 수 */
function getMonthsSinceHire(hireDate: string): number {
  if (!hireDate) return 0;
  const hire = new Date(hireDate);
  const now = new Date();
  return (now.getFullYear() - hire.getFullYear()) * 12 + (now.getMonth() - hire.getMonth());
}

/** 입사일 기준 연차 계산 (자동)
 *  - 입사일이 MONTHLY_BASE_DATE 이전 & 1년 미만 → MONTHLY_BASE_DATE 기준 월차
 *  - 입사일이 MONTHLY_BASE_DATE 이후 & 1년 미만 → 입사일 기준 월차
 *  - 1년 이상 → 연차 15일 + 2년마다 1일 추가 (최대 25일)
 */
export function calculateLeaveEntitlement(hireDate: string) {
  if (!hireDate) return { type: 'annual' as const, totalAnnual: 15, totalMonthly: 0 };
  const months = getMonthsSinceHire(hireDate);
  const years = Math.floor(months / 12);

  if (years < 1) {
    // 입사 1년 미만: 월차 누적
    // 입사일이 기산일 이전이면 기산일 기준으로 월차 계산
    const effectiveDate = hireDate < MONTHLY_BASE_DATE ? MONTHLY_BASE_DATE : hireDate;
    const effectiveMonths = getMonthsSinceHire(effectiveDate);
    return { type: 'monthly' as const, totalAnnual: 0, totalMonthly: Math.max(effectiveMonths, 0) };
  }
  // 입사 1년 이상: 선불 연차 15개 + 2년마다 1개 추가
  const extraDays = Math.floor((years - 1) / 2);
  const totalAnnual = Math.min(15 + extraDays, 25); // 최대 25일 제한
  return { type: 'annual' as const, totalAnnual, totalMonthly: 0 };
}

/** 환급금 계산: 월급 ÷ 209h × 잔여시간 */
function calculateRefund(salary: number, remainingHours: number): number {
  if (salary <= 0 || remainingHours <= 0) return 0;
  return Math.round((salary / 209) * remainingHours);
}

// ───── 연차 목록 (관리자+) ─────
leave.get('/', requireRole('master', 'ceo', 'admin', 'manager', 'accountant', 'accountant_asst', 'director'), async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  let visibleUsersQuery = "SELECT id FROM users WHERE approved = 1 AND role != 'resigned' AND login_type != 'freelancer' AND role != 'freelancer'";
  const visibleUserParams: string[] = [];

  if (user.role === 'admin' && !isHeadOfficeBranch(user.branch)) {
    visibleUsersQuery += ' AND branch = ?';
    visibleUserParams.push(user.branch);
  } else if (user.role === 'manager') {
    visibleUsersQuery += ' AND branch = ? AND department = ?';
    visibleUserParams.push(user.branch, user.department);
  }

  const visibleUsersStmt = db.prepare(visibleUsersQuery);
  const visibleUsersResult = visibleUserParams.length > 0
    ? await visibleUsersStmt.bind(...visibleUserParams).all<{ id: string }>()
    : await visibleUsersStmt.all<{ id: string }>();
  for (const row of (visibleUsersResult.results || [])) {
    await reinitUserLeave(db, row.id);
  }

  let query = `SELECT al.*, u.name as user_name, u.branch, u.department, u.role as user_role,
    u.hire_date, u.created_at as user_created_at
    FROM annual_leave al LEFT JOIN users u ON al.user_id = u.id WHERE u.login_type != 'freelancer' AND u.role != 'freelancer'`;
  const params: string[] = [];

  if (user.role === 'admin' && !isHeadOfficeBranch(user.branch)) {
    query += ' AND u.branch = ?';
    params.push(user.branch);
  } else if (user.role === 'manager') {
    query += ' AND u.branch = ? AND u.department = ?';
    params.push(user.branch, user.department);
  }

  query += ' ORDER BY u.branch, u.department, u.name';
  const stmt = db.prepare(query);
  const result = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
  return c.json({ leaves: result.results });
});

// ───── 본인 연차 (잔여일 + 환급 계산 포함) ─────
leave.get('/me', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  await reinitUserLeave(db, user.sub);
  const leaveInfo = await db.prepare('SELECT * FROM annual_leave WHERE user_id = ?').bind(user.sub).first<any>();
  const userInfo = await db.prepare('SELECT hire_date, created_at FROM users WHERE id = ?').bind(user.sub).first<any>();
  const accounting = await db.prepare('SELECT salary FROM user_accounting WHERE user_id = ?').bind(user.sub).first<any>();

  const hireDate = userInfo?.hire_date || userInfo?.created_at || '';
  const entitlement = calculateLeaveEntitlement(hireDate);
  const salary = accounting?.salary || 0;

  const data = leaveInfo || {
    total_days: entitlement.totalAnnual,
    used_days: 0,
    monthly_days: entitlement.totalMonthly,
    monthly_used: 0,
    leave_type: entitlement.type,
  };

  // 잔여시간 계산. 기존 days 컬럼은 호환용으로 두고 시간 단위로 환산한다.
  const display = leaveDisplayFields(data);

  // 환급금 계산
  const refundAmount = calculateRefund(salary, display.total_remaining_hours);

  // 연차촉진 알림 확인 (입사 6개월)
  const months = getMonthsSinceHire(hireDate);
  const promotionAlert = months >= 6 && months < 12;

  return c.json({
    leave: {
      ...data,
      ...display,
      hire_date: hireDate,
      months_since_hire: months,
      salary,
      refund_amount: refundAmount,
      entitlement,
      promotion_alert: promotionAlert,
    },
  });
});

// ───── 특정 유저 연차 조회 (관리자+) ─────
leave.get('/user/:userId', requireRole('master', 'ceo', 'admin', 'accountant', 'accountant_asst'), async (c) => {
  const userId = c.req.param('userId');
  const db = c.env.DB;
  const viewer = c.get('user');

  const RESTRICTED_ROLES = ['master', 'ceo', 'cc_ref', 'admin', 'director', 'manager'];
  const userInfoEarly = await db.prepare('SELECT role FROM users WHERE id = ?').bind(userId).first<any>();
  if (viewer.role === 'accountant_asst' && userInfoEarly && RESTRICTED_ROLES.includes(userInfoEarly.role)) {
    return c.json({ error: '해당 직원의 연차·급여 정보 열람 권한이 없습니다.' }, 403);
  }

  await reinitUserLeave(db, userId);
  const leaveInfo = await db.prepare('SELECT * FROM annual_leave WHERE user_id = ?').bind(userId).first<any>();
  const userInfo = await db.prepare('SELECT hire_date, created_at, name FROM users WHERE id = ?').bind(userId).first<any>();
  const accounting = await db.prepare('SELECT salary FROM user_accounting WHERE user_id = ?').bind(userId).first<any>();

  if (!userInfo) return c.json({ error: '사용자를 찾을 수 없습니다.' }, 404);

  const hireDate = userInfo?.hire_date || userInfo?.created_at || '';
  const entitlement = calculateLeaveEntitlement(hireDate);
  const salary = accounting?.salary || 0;

  const data = leaveInfo || {
    total_days: entitlement.totalAnnual,
    used_days: 0,
    monthly_days: entitlement.totalMonthly,
    monthly_used: 0,
    leave_type: entitlement.type,
  };

  const display = leaveDisplayFields(data);
  const refundAmount = calculateRefund(salary, display.total_remaining_hours);
  const months = getMonthsSinceHire(hireDate);
  const promotionAlert = months >= 6 && months < 12;

  return c.json({
    leave: {
      ...data,
      ...display,
      hire_date: hireDate,
      months_since_hire: months,
      salary,
      refund_amount: refundAmount,
      entitlement,
      promotion_alert: promotionAlert,
    },
  });
});

// ───── 연차 초기화 (관리자+) ─────
leave.post('/init', requireRole('master', 'ceo', 'admin'), async (c) => {
  const { user_id, total_days } = await c.req.json<{ user_id: string; total_days: number }>();
  const db = c.env.DB;

  const existing = await db.prepare('SELECT id FROM annual_leave WHERE user_id = ?').bind(user_id).first();
  if (existing) {
    await db.prepare("UPDATE annual_leave SET total_days = ?, updated_at = datetime('now') WHERE user_id = ?")
      .bind(total_days, user_id).run();
  } else {
    await db.prepare('INSERT INTO annual_leave (id, user_id, total_days, used_days) VALUES (?, ?, ?, 0)')
      .bind(crypto.randomUUID(), user_id, total_days).run();
  }
  return c.json({ success: true });
});

// ───── 연차 수정 (관리자+) ─────
leave.put('/:userId', requireRole('master', 'ceo', 'admin'), async (c) => {
  const userId = c.req.param('userId');
  const body = await c.req.json<any>();
  const db = c.env.DB;
  await ensureAnnualLeaveSchema(db);

  const existing = await db.prepare('SELECT * FROM annual_leave WHERE user_id = ?').bind(userId).first<any>();
  if (!existing) return c.json({ error: '연차 정보가 없습니다.' }, 404);

  await db.prepare(`UPDATE annual_leave SET
    total_days = ?, used_days = ?, monthly_days = ?, monthly_used = ?,
    leave_type = ?, updated_at = datetime('now') WHERE user_id = ?`)
    .bind(
      body.total_days ?? existing.total_days,
      body.used_days ?? existing.used_days,
      body.monthly_days ?? existing.monthly_days ?? 0,
      body.monthly_used ?? existing.monthly_used ?? 0,
      body.leave_type ?? existing.leave_type ?? 'annual',
      userId
    ).run();
  return c.json({ success: true });
});

// ───── 마스터 수동 보정: 이력/사유 없이 총 부여일수 또는 사용일수 보정 ─────
leave.post('/:userId/adjust', requireRole('master'), async (c) => {
  const userId = c.req.param('userId');
  const body = await c.req.json<{ field?: string; delta_days?: number }>();
  const db = c.env.DB;
  await ensureAnnualLeaveSchema(db);
  await reinitUserLeave(db, userId);

  const field = body.field === 'used' ? 'used' : body.field === 'total' ? 'total' : '';
  const deltaDays = Math.round(Number(body.delta_days || 0) * 1000) / 1000;
  if (!field) return c.json({ error: '조정 항목이 올바르지 않습니다.' }, 400);
  if (!Number.isFinite(deltaDays) || deltaDays === 0) return c.json({ error: '조정 일수가 올바르지 않습니다.' }, 400);

  const column = field === 'total' ? 'manual_total_adjust_days' : 'manual_used_adjust_days';
  await db.prepare(`UPDATE annual_leave SET ${column} = ${column} + ?, updated_at = datetime('now') WHERE user_id = ?`)
    .bind(deltaDays, userId).run();

  const leaveInfo = await db.prepare('SELECT * FROM annual_leave WHERE user_id = ?').bind(userId).first<any>();
  return c.json({ success: true, leave: leaveInfo ? { ...leaveInfo, ...leaveDisplayFields(leaveInfo) } : null });
});

// ───── 연차 차감 (문서 승인 시 호출) ─────
leave.post('/deduct', requireRole('master', 'ceo', 'admin', 'manager'), async (c) => {
  const { user_id, days, hours } = await c.req.json<{ user_id: string; days?: number; hours?: number }>();
  const db = c.env.DB;
  const deductHours = Number(hours ?? daysToHours(days || 0));
  const deductDays = hoursToDays(deductHours);

  const reqUser = await db.prepare('SELECT hire_date, created_at FROM users WHERE id = ?').bind(user_id).first<any>();
  const hireDate = reqUser?.hire_date || reqUser?.created_at || '';
  const entitlement = calculateLeaveEntitlement(hireDate);

  await reinitUserLeave(db, user_id);
  let existing = await db.prepare('SELECT * FROM annual_leave WHERE user_id = ?').bind(user_id).first<any>();
  if (!existing) {
    await db.prepare(`INSERT INTO annual_leave (id, user_id, total_days, used_days, leave_type, monthly_days, monthly_used) VALUES (?, ?, ?, 0, ?, ?, 0)`)
      .bind(crypto.randomUUID(), user_id, entitlement.totalAnnual, entitlement.type, entitlement.totalMonthly).run();
    existing = { total_days: entitlement.totalAnnual, used_days: 0, monthly_days: entitlement.totalMonthly, monthly_used: 0, leave_type: entitlement.type };
  }

  const leaveType = existing.leave_type || entitlement.type;
  if (leaveType === 'monthly') {
    await db.prepare("UPDATE annual_leave SET monthly_used = monthly_used + ?, updated_at = datetime('now') WHERE user_id = ?")
      .bind(deductDays, user_id).run();
    return c.json({
      success: true,
      used_hours: daysToHours(existing.monthly_used || 0) + deductHours,
      remaining_hours: daysToHours((existing.monthly_days || 0) - (existing.monthly_used || 0)) - deductHours,
    });
  } else {
    const newUsed = existing.used_days + deductDays;
    await db.prepare("UPDATE annual_leave SET used_days = ?, updated_at = datetime('now') WHERE user_id = ?")
      .bind(newUsed, user_id).run();
    return c.json({
      success: true,
      used_hours: daysToHours(newUsed),
      remaining_hours: daysToHours(existing.total_days - newUsed),
    });
  }
});

// ───── 연차 사용량 재계산 (단일 사용자) ─────
// leave_requests 이력 기반으로 used_days/monthly_used 자동 정합성 맞춤
// 관리자가 데이터 어긋난 사용자 발견 시 한 번 호출하면 즉시 정정
leave.post('/recalculate/:userId', requireRole('master', 'ceo', 'admin', 'accountant'), async (c) => {
  const userId = c.req.param('userId');
  const db = c.env.DB;
  const before = await db.prepare('SELECT used_days, monthly_used FROM annual_leave WHERE user_id = ?').bind(userId).first<any>();
  if (!before) return c.json({ error: '연차 정보가 없습니다.' }, 404);
  const after = await recalcUserLeave(db, userId);
  return c.json({ success: true, before, after });
});

// ───── 연차 사용량 재계산 (전체) — 마스터 전용 ─────
// 모든 사용자에 대해 leave_requests 기반 재계산. 변동 있는 사용자만 결과 반환.
leave.post('/recalculate-all', requireRole('master'), async (c) => {
  const db = c.env.DB;
  const usersResult = await db.prepare('SELECT al.user_id, u.name, al.used_days, al.monthly_used FROM annual_leave al JOIN users u ON u.id = al.user_id').all<any>();
  const changes: any[] = [];
  for (const u of (usersResult.results || [])) {
    const after = await recalcUserLeave(db, u.user_id);
    if (!after) continue;
    if (Math.abs((u.used_days || 0) - after.used_days) > 0.0001 || Math.abs((u.monthly_used || 0) - after.monthly_used) > 0.0001) {
      changes.push({
        user_id: u.user_id,
        name: u.name,
        before: { used_days: u.used_days, monthly_used: u.monthly_used },
        after,
      });
    }
  }
  return c.json({ success: true, total: usersResult.results?.length || 0, updated: changes.length, changes });
});

// ───── 입사일 기반 재초기화 (단일 사용자) ─────
// entitlement(부여일/타입) + 사용량까지 모두 재계산
// leave_type 잘못 잡혔거나 부여일이 입사일과 안 맞을 때 사용
leave.post('/reinit/:userId', requireRole('master', 'ceo', 'admin', 'accountant'), async (c) => {
  const userId = c.req.param('userId');
  const db = c.env.DB;
  const result = await reinitUserLeave(db, userId);
  if (!result) return c.json({ error: '사용자를 찾을 수 없습니다.' }, 404);
  return c.json({ success: true, ...result });
});

// ───── 입사일 기반 재초기화 (전체) — 마스터 전용 ─────
leave.post('/reinit-all', requireRole('master'), async (c) => {
  const db = c.env.DB;
  // annual_leave가 없는 사용자도 신규 생성하므로 users 전체 조회 (승인된 직원만)
  const usersResult = await db.prepare("SELECT id, name FROM users WHERE approved = 1 AND role != 'resigned'").all<{ id: string; name: string }>();
  const changes: any[] = [];
  for (const u of (usersResult.results || [])) {
    const r = await reinitUserLeave(db, u.id);
    if (!r) continue;
    const b = r.before, a = r.after;
    const changed = !b
      || (b.leave_type || '') !== a.leave_type
      || Math.abs((b.total_days || 0) - a.total_days) > 0.0001
      || Math.abs((b.monthly_days || 0) - a.monthly_days) > 0.0001
      || Math.abs((b.used_days || 0) - a.used_days) > 0.0001
      || Math.abs((b.monthly_used || 0) - a.monthly_used) > 0.0001;
    if (changed) {
      changes.push({ user_id: u.id, name: u.name, before: b, after: a });
    }
  }
  return c.json({ success: true, total: usersResult.results?.length || 0, updated: changes.length, changes });
});

// ───── 휴가 신청 ─────
leave.post('/request', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  await ensureLeaveRequestSchema(db);
  const body = await c.req.json<{
    leave_type: '연차' | '월차' | '반차' | '시간차' | '특별휴가';
    start_date: string;
    end_date: string;
    hours?: number;
    reason: string;
    user_id?: string;
    half_day_period?: string;
  }>();
  const requestedLeaveType = normalizeLeaveType(body.leave_type);
  const halfDayPeriod = normalizeHalfDayPeriod(requestedLeaveType, body.half_day_period);
  if (requestedLeaveType === '반차' && !halfDayPeriod) {
    return c.json({ error: '반차는 오전/오후를 선택해야 합니다.' }, 400);
  }
  const targetUserId = user.role === 'master' && body.user_id ? body.user_id : user.sub;
  if (body.user_id && body.user_id !== user.sub && user.role !== 'master') {
    return c.json({ error: '다른 직원의 휴가는 마스터만 대신 신청할 수 있습니다.' }, 403);
  }
  const targetUser = await db.prepare('SELECT id, name, branch, department, hire_date, created_at FROM users WHERE id = ? AND approved = 1')
    .bind(targetUserId).first<any>();
  if (!targetUser) return c.json({ error: '휴가를 신청할 직원을 찾을 수 없습니다.' }, 404);

  const isSummerVacation = requestedLeaveType === '특별휴가' && isSummerVacationReason(body.reason);
  if (isSummerVacation) {
    if (!isSummerVacationWindowOpen()) {
      return c.json({ error: '여름 특별휴가는 매년 7~8월에만 신청할 수 있습니다. 9월부터는 사용이 불가합니다.' }, 400);
    }
    if (!isJulyOrAugustDate(body.start_date) || !isJulyOrAugustDate(body.end_date)) {
      return c.json({ error: '여름 특별휴가는 사용 기간도 7~8월 안으로만 지정할 수 있습니다.' }, 400);
    }
    const year = String(body.start_date || '').slice(0, 4);
    if (await hasActiveSummerVacationRequest(db, targetUserId, year)) {
      return c.json({ error: '여름 특별휴가는 인당 연 1회만 신청할 수 있습니다.' }, 400);
    }
  }
  if (requestedLeaveType === '연차' && String(body.reason || '').includes('[여름휴가 연결]')) {
    if (!isSummerVacationWindowOpen()) {
      return c.json({ error: '여름 특별휴가 연결 연차는 매년 7~8월에만 신청할 수 있습니다.' }, 400);
    }
    if (!isJulyOrAugustDate(body.start_date) || !isJulyOrAugustDate(body.end_date)) {
      return c.json({ error: '여름 특별휴가 연결 연차는 7~8월 안으로만 지정할 수 있습니다.' }, 400);
    }
  }

  // 차감시간 계산. days는 기존 이력 호환용으로만 함께 저장한다.
  let deductHours = HOURS_PER_DAY;
  if (requestedLeaveType === '반차') {
    deductHours = 4;
  } else if (requestedLeaveType === '시간차') {
    const hours = body.hours || 1;
    deductHours = Math.round(hours * 1000) / 1000;
  } else if (requestedLeaveType === '특별휴가') {
    // 특별휴가: 주말 및 휴가 적용 공휴일 제외한 근무일 기준
    const holidays = await getLeaveHolidayDates(db, body.start_date, body.end_date);
    deductHours = countLeaveBusinessDays(body.start_date, body.end_date, holidays) * HOURS_PER_DAY;
    if (isRewardVacationReason(body.reason) && deductHours !== HOURS_PER_DAY) {
      return c.json({ error: '포상휴가는 1일만 신청할 수 있습니다.' }, 400);
    }
  } else if (requestedLeaveType === '연차') {
    const holidays = await getLeaveHolidayDates(db, body.start_date, body.end_date);
    deductHours = countLeaveBusinessDays(body.start_date, body.end_date, holidays) * HOURS_PER_DAY;
  }
  const days = hoursToDays(deductHours);

  // [중복 방지] 같은 user + 같은 날짜 + 같은 타입의 미취소 신청이 이미 있으면 차단
  const existingDup = requestedLeaveType === '반차'
    ? await db.prepare(
      "SELECT id, status FROM leave_requests WHERE user_id = ? AND leave_type = ? AND start_date = ? AND end_date = ? AND half_day_period = ? AND status IN ('pending', 'approved', 'cancel_requested') LIMIT 1"
    ).bind(targetUserId, requestedLeaveType, body.start_date, body.end_date, halfDayPeriod).first<any>()
    : await db.prepare(
      "SELECT id, status FROM leave_requests WHERE user_id = ? AND leave_type = ? AND start_date = ? AND end_date = ? AND status IN ('pending', 'approved', 'cancel_requested') LIMIT 1"
    ).bind(targetUserId, requestedLeaveType, body.start_date, body.end_date).first<any>();
  if (existingDup) {
    const statusLabel = existingDup.status === 'approved' ? '승인됨' : existingDup.status === 'pending' ? '대기 중' : '취소 요청 중';
    return c.json({ error: `동일 날짜·유형의 휴가가 이미 ${statusLabel}입니다. 중복 신청은 불가합니다.` }, 400);
  }

  // 특별휴가는 연차 차감 안 함 → 잔여 확인 불필요
  if (requestedLeaveType === '특별휴가') {
    const id = crypto.randomUUID();
    await db.prepare(`INSERT INTO leave_requests
      (id, user_id, leave_type, start_date, end_date, hours, days, reason, branch, department, half_day_period)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, targetUserId, requestedLeaveType, body.start_date, body.end_date,
        deductHours, days, body.reason || '', targetUser.branch || '', targetUser.department || '', halfDayPeriod).run();

    const phones = await getLeaveApprovalNotifyPhones(db, targetUserId);
    if (phones.length > 0) {
      c.executionCtx.waitUntil(sendAlimtalkByTemplate(
        c.env as unknown as Record<string, unknown>, 'LEAVE_REQUEST',
        { user_name: targetUser.name, leave_type: leaveTypeForMessage(requestedLeaveType, halfDayPeriod), start_date: body.start_date, end_date: body.end_date, branch: targetUser.branch || '', link: `${APP_URL}/leave` },
        phones,
      ).catch(() => {}));
    }

    return c.json({ success: true, id });
  }

  // 잔여 연차는 안내용으로만 관리한다. 부족해도 신청/승인은 가능하며 잔여가 음수로 표시될 수 있다.
  await reinitUserLeave(db, targetUserId);

  const id = crypto.randomUUID();
  await db.prepare(`INSERT INTO leave_requests
    (id, user_id, leave_type, start_date, end_date, hours, days, reason, branch, department, half_day_period)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, targetUserId, requestedLeaveType, body.start_date, body.end_date,
      deductHours, days, body.reason, targetUser.branch || '', targetUser.department || '', halfDayPeriod).run();

  // 알림톡: 조직도 직접 부모에게 LEAVE_REQUEST. 직접 부모가 없을 때만 대표/마스터로 fallback.
  const phones = await getLeaveApprovalNotifyPhones(db, targetUserId);
  if (phones.length > 0) {
    c.executionCtx.waitUntil(sendAlimtalkByTemplate(
      c.env as unknown as Record<string, unknown>, 'LEAVE_REQUEST',
      { user_name: targetUser.name, leave_type: leaveTypeForMessage(requestedLeaveType, halfDayPeriod), start_date: body.start_date, end_date: body.end_date, branch: targetUser.branch || '', link: `${APP_URL}/leave` },
      phones,
    ).catch(() => {}));
  }

  return c.json({ success: true, id });
});

// ───── 휴가 신청 목록 (본인 or 관리자) ─────
leave.get('/requests', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  await ensureLeaveRequestSchema(db);
  const status = c.req.query('status') || '';
  const month = c.req.query('month') || '';
  const filterUserId = c.req.query('user_id') || '';

  const isAdmin = ['master', 'ceo', 'cc_ref', 'admin', 'manager', 'accountant', 'accountant_asst'].includes(user.role);
  const needsApprovalLineFilter = LEAVE_APPROVER_ROLES.has(user.role) && (status === 'pending' || status === 'cancel_requested');

  let query = `SELECT lr.*, u.name as user_name, u.role as user_role FROM leave_requests lr
    LEFT JOIN users u ON lr.user_id = u.id WHERE 1=1`;
  const params: any[] = [];

  // 특정 유저 필터 (관리자+ 전용)
  if (filterUserId && isAdmin) {
    query += ' AND lr.user_id = ?';
    params.push(filterUserId);
  } else if (!isAdmin) {
    query += ' AND lr.user_id = ?';
    params.push(user.sub);
  } else if (!needsApprovalLineFilter && user.role === 'manager') {
    query += ' AND lr.branch = ? AND lr.department = ?';
    params.push(user.branch, user.department);
  } else if (!needsApprovalLineFilter && user.role === 'admin' && !isHeadOfficeBranch(user.branch)) {
    query += ' AND lr.branch = ?';
    params.push(user.branch);
  }

  if (status) {
    query += ' AND lr.status = ?';
    params.push(status);
  }
  if (month) {
    query += ' AND lr.start_date LIKE ?';
    params.push(month + '%');
  }

  query += ' ORDER BY lr.created_at DESC';
  const stmt = db.prepare(query);
  const result = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
  const requests = result.results || [];
  return c.json({
    requests: needsApprovalLineFilter
      ? await filterLeaveRequestsByApprovalLine(db, user, requests)
      : requests,
  });
});

// ───── 휴가 승인/반려 (관리자+) ─────
leave.post('/requests/:id/approve', requireRole('master', 'ceo', 'cc_ref', 'admin', 'manager', 'accountant'), async (c) => {
  const requestId = c.req.param('id');
  const user = c.get('user');
  const db = c.env.DB;
  await ensureLeaveRequestSchema(db);

  const req = await db.prepare('SELECT * FROM leave_requests WHERE id = ?').bind(requestId).first<any>();
  if (!req) return c.json({ error: '신청을 찾을 수 없습니다.' }, 404);
  if (req.status !== 'pending') return c.json({ error: '이미 처리된 신청입니다.' }, 400);
  const approvalDecision = await getLeaveApprovalDecision(db, user, req);
  if (!approvalDecision.canApprove) return c.json({ error: '승인 권한이 없습니다.' }, 403);

  if (!approvalDecision.isFinalStep) {
    await db.prepare(`UPDATE leave_requests SET first_approved_by = ?,
      first_approved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
      .bind(user.sub, requestId).run();

    const reqUserForNotify = await db.prepare('SELECT name, branch FROM users WHERE id = ?')
      .bind(req.user_id).first<{ name: string; branch: string }>();
    if (approvalDecision.finalApprover?.phone) {
      c.executionCtx.waitUntil(sendAlimtalkByTemplate(
        c.env as unknown as Record<string, unknown>, 'LEAVE_REQUEST',
        {
          user_name: reqUserForNotify?.name || req.user_name || '',
          leave_type: leaveTypeForMessage(req.leave_type, req.half_day_period),
          start_date: req.start_date,
          end_date: req.end_date,
          branch: reqUserForNotify?.branch || req.branch || '',
          link: `${APP_URL}/leave`,
        },
        [approvalDecision.finalApprover.phone],
      ).catch(() => {}));
    }

    return c.json({ success: true, pending_final_approval: true });
  }

  await reinitUserLeave(db, req.user_id);

  // 승인 처리
  await db.prepare(`UPDATE leave_requests SET status = 'approved', approved_by = ?,
    approved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
    .bind(user.sub, requestId).run();

  // 특별휴가는 연차 차감 없음
  if (req.leave_type !== '특별휴가') {
    // 입사일 기반 월차/연차 판별
    const reqUser = await db.prepare('SELECT hire_date, created_at FROM users WHERE id = ?').bind(req.user_id).first<any>();
    const hireDate = reqUser?.hire_date || reqUser?.created_at || '';
    const entitlement = calculateLeaveEntitlement(hireDate);

    let existing = await db.prepare('SELECT * FROM annual_leave WHERE user_id = ?').bind(req.user_id).first<any>();
    if (!existing) {
      await db.prepare(`INSERT INTO annual_leave (id, user_id, total_days, used_days, leave_type, monthly_days, monthly_used) VALUES (?, ?, ?, 0, ?, ?, 0)`)
        .bind(crypto.randomUUID(), req.user_id, entitlement.totalAnnual, entitlement.type, entitlement.totalMonthly).run();
      existing = { total_days: entitlement.totalAnnual, used_days: 0, monthly_days: entitlement.totalMonthly, monthly_used: 0, leave_type: entitlement.type };
    }

    const leaveType = existing.leave_type || entitlement.type;
    const deductHours = req.leave_type === '시간차'
      ? Number(req.hours || 0)
      : daysToHours(req.days || 0);
    const deductDays = hoursToDays(deductHours);
    if (leaveType === 'monthly') {
      // 1년 미만 발생 방식 → monthly_used에 시간 기준 환산값 누적
      await db.prepare("UPDATE annual_leave SET monthly_used = monthly_used + ?, updated_at = datetime('now') WHERE user_id = ?")
        .bind(deductDays, req.user_id).run();
    } else {
      // 1년 이상 발생 방식 → used_days에 시간 기준 환산값 누적
      await db.prepare("UPDATE annual_leave SET used_days = used_days + ?, updated_at = datetime('now') WHERE user_id = ?")
        .bind(deductDays, req.user_id).run();
    }
  }

  await createLeaveArchiveDocument(db, { ...req, status: 'approved', approved_by: user.sub }, user)
    .catch((err) => console.error('[leave archive auto-create]', err));

  // 알림톡: 신청자에게 LEAVE_APPROVED
  const reqUser2 = await db.prepare('SELECT name, phone FROM users WHERE id = ?').bind(req.user_id).first<{ name: string; phone: string }>();
  if (reqUser2?.phone) {
    c.executionCtx.waitUntil(sendAlimtalkByTemplate(
      c.env as unknown as Record<string, unknown>, 'LEAVE_APPROVED',
      { user_name: reqUser2.name, status: '승인', leave_type: leaveTypeForMessage(req.leave_type, req.half_day_period), start_date: req.start_date, end_date: req.end_date, approver_name: user.name, link: `${APP_URL}/leave` },
      [reqUser2.phone],
    ).catch(() => {}));
  }

  return c.json({ success: true });
});

leave.post('/requests/:id/reject', requireRole('master', 'ceo', 'cc_ref', 'admin', 'manager', 'accountant'), async (c) => {
  const requestId = c.req.param('id');
  const user = c.get('user');
  const db = c.env.DB;
  await ensureLeaveRequestSchema(db);
  const { reason } = await c.req.json<{ reason: string }>();

  const req = await db.prepare('SELECT * FROM leave_requests WHERE id = ?').bind(requestId).first<any>();
  if (!req) return c.json({ error: '신청을 찾을 수 없습니다.' }, 404);
  if (req.status !== 'pending') return c.json({ error: '이미 처리된 신청입니다.' }, 400);

  const rejectDecision = await getLeaveApprovalDecision(db, user, req);
  if (!rejectDecision.canApprove) return c.json({ error: '반려 권한이 없습니다.' }, 403);

  await db.prepare(`UPDATE leave_requests SET status = 'rejected', approved_by = ?,
    reject_reason = ?, approved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
    .bind(user.sub, reason || '', requestId).run();

  // 알림톡: 신청자에게 LEAVE_APPROVED (반려)
  const reqUser = await db.prepare('SELECT name, phone FROM users WHERE id = ?').bind(req.user_id).first<{ name: string; phone: string }>();
  if (reqUser?.phone) {
    c.executionCtx.waitUntil(sendAlimtalkByTemplate(
      c.env as unknown as Record<string, unknown>, 'LEAVE_APPROVED',
      { user_name: reqUser.name, status: '반려', leave_type: leaveTypeForMessage(req.leave_type, req.half_day_period), start_date: req.start_date, end_date: req.end_date, approver_name: user.name, link: `${APP_URL}/leave` },
      [reqUser.phone],
    ).catch(() => {}));
  }

  return c.json({ success: true });
});

// ───── 휴가 취소 (본인) ─────
leave.post('/requests/:id/cancel', async (c) => {
  const requestId = c.req.param('id');
  const user = c.get('user');
  const db = c.env.DB;

  const req = await db.prepare('SELECT * FROM leave_requests WHERE id = ?').bind(requestId).first<any>();
  if (!req) return c.json({ error: '신청을 찾을 수 없습니다.' }, 404);
  if (req.user_id !== user.sub && !['master', 'ceo', 'cc_ref', 'admin', 'manager'].includes(user.role)) {
    return c.json({ error: '본인 신청만 취소할 수 있습니다.' }, 403);
  }
  if (req.status !== 'pending' && req.status !== 'approved') {
    return c.json({ error: '취소할 수 없는 상태입니다.' }, 400);
  }

  if (req.status === 'approved') {
    // 승인된 건 → 관리자만 직접 취소 가능, 일반 유저는 cancel_requested
    if (['master', 'ceo', 'cc_ref', 'admin', 'manager'].includes(user.role)) {
      // 관리자: 즉시 취소 + 연차 복원
      await db.prepare("UPDATE leave_requests SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?")
        .bind(requestId).run();
      await reinitUserLeave(db, req.user_id);
      await cancelLeaveArchiveDocument(db, req, user, '연차관리에서 휴가 신청이 취소되었습니다.')
        .catch((err) => console.error('[leave archive auto-cancel]', err));
    } else {
      // 일반 유저: 취소요청 상태로 변경 (관리자 확인 필요)
      await db.prepare("UPDATE leave_requests SET status = 'cancel_requested', updated_at = datetime('now') WHERE id = ?")
        .bind(requestId).run();
    }
  } else {
    // pending → 바로 취소
    await db.prepare("UPDATE leave_requests SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?")
      .bind(requestId).run();
  }

  return c.json({ success: true });
});

// ───── 취소요청 승인 (관리자) ─────
leave.post('/requests/:id/cancel-approve', requireRole('master', 'ceo', 'cc_ref', 'admin', 'manager', 'accountant'), async (c) => {
  const requestId = c.req.param('id');
  const db = c.env.DB;
  const user = c.get('user');
  await ensureLeaveRequestSchema(db);

  const req = await db.prepare('SELECT * FROM leave_requests WHERE id = ?').bind(requestId).first<any>();
  if (!req) return c.json({ error: '신청을 찾을 수 없습니다.' }, 404);
  if (req.status !== 'cancel_requested') return c.json({ error: '취소요청 상태가 아닙니다.' }, 400);

  const cancelDecision = await getLeaveApprovalDecision(db, user, req, { finalOnly: true });
  if (!cancelDecision.canApprove) return c.json({ error: '취소 승인 권한이 없습니다.' }, 403);

  await db.prepare("UPDATE leave_requests SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?")
    .bind(requestId).run();

  await reinitUserLeave(db, req.user_id);
  await cancelLeaveArchiveDocument(db, req, c.get('user'), '연차관리에서 휴가 취소 요청이 승인되었습니다.')
    .catch((err) => console.error('[leave archive auto-cancel-approve]', err));

  return c.json({ success: true });
});

// ───── 환급 계산 (관리자+) ─────
leave.get('/refund/:userId', requireRole('master', 'ceo', 'admin', 'accountant', 'accountant_asst'), async (c) => {
  const userId = c.req.param('userId');
  const db = c.env.DB;
  const viewer = c.get('user');

  // 총무보조는 팀장·관리자급·이사·대표자 환급 차단
  const RESTRICTED_ROLES_REFUND = ['master', 'ceo', 'cc_ref', 'admin', 'director', 'manager'];
  if (viewer.role === 'accountant_asst') {
    const t = await db.prepare('SELECT role FROM users WHERE id = ?').bind(userId).first<any>();
    if (t && RESTRICTED_ROLES_REFUND.includes(t.role)) {
      return c.json({ error: '해당 직원의 환급 정보 열람 권한이 없습니다.' }, 403);
    }
  }

  await reinitUserLeave(db, userId);
  const leaveInfo = await db.prepare('SELECT * FROM annual_leave WHERE user_id = ?').bind(userId).first<any>();
  const accounting = await db.prepare('SELECT salary FROM user_accounting WHERE user_id = ?').bind(userId).first<any>();
  const userInfo = await db.prepare('SELECT name, hire_date, created_at FROM users WHERE id = ?').bind(userId).first<any>();

  if (!leaveInfo || !accounting) return c.json({ error: '정보가 부족합니다.' }, 404);

  const display = leaveDisplayFields(leaveInfo);
  const refund = calculateRefund(accounting.salary, display.total_remaining_hours);

  return c.json({
    user_name: userInfo?.name,
    salary: accounting.salary,
    remaining_days: display.total_remaining,
    remaining_hours: display.total_remaining_hours,
    refund_per_day: Math.round((accounting.salary / 209) * 8),
    refund_per_hour: Math.round(accounting.salary / 209),
    refund_total: refund,
  });
});

// ───── 연차촉진 알림 목록 (대시보드용) ─────
leave.get('/alerts', requireRole('master', 'ceo', 'admin', 'manager'), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');

  // 입사 6개월 도래 직원 찾기
  let query = `SELECT u.id, u.name, u.branch, u.department, u.hire_date, u.created_at,
    al.total_days, al.used_days, al.monthly_days, al.monthly_used
    FROM users u LEFT JOIN annual_leave al ON u.id = al.user_id
    WHERE u.approved = 1 AND u.hire_date != ''`;
  const params: string[] = [];

  if (user.role === 'manager') {
    query += ' AND u.branch = ? AND u.department = ?';
    params.push(user.branch, user.department);
  } else if (user.role === 'admin' && !isHeadOfficeBranch(user.branch)) {
    query += ' AND u.branch = ?';
    params.push(user.branch);
  }

  const stmt = db.prepare(query);
  const result = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();

  const alerts = (result.results as any[]).filter(u => {
    const months = getMonthsSinceHire(u.hire_date || u.created_at);
    return months >= 5 && months <= 7; // 5~7개월 (촉진 대상 기간)
  }).map(u => ({
    ...u,
    months_since_hire: getMonthsSinceHire(u.hire_date || u.created_at),
  }));

  return c.json({ alerts });
});

// ───── 입사일 설정 (관리자+) ─────
leave.put('/hire-date/:userId', requireRole('master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst'), async (c) => {
  const userId = c.req.param('userId');
  const { hire_date } = await c.req.json<{ hire_date: string }>();
  const db = c.env.DB;

  await db.prepare("UPDATE users SET hire_date = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(hire_date, userId).run();

  const entitlement = calculateLeaveEntitlement(hire_date);
  const reinitialized = await reinitUserLeave(db, userId);
  return c.json({ success: true, entitlement, leave: reinitialized?.after || null });
});

// ───── 휴가 신청 삭제 (관리자/회계) ─────
leave.delete('/requests/:id', requireRole('master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst'), async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;

  const req = await db.prepare('SELECT * FROM leave_requests WHERE id = ?').bind(id).first<any>();
  if (!req) return c.json({ error: '신청을 찾을 수 없습니다.' }, 404);

  await db.prepare('DELETE FROM leave_requests WHERE id = ?').bind(id).run();
  await reinitUserLeave(db, req.user_id);
  await cancelLeaveArchiveDocument(db, req, c.get('user'), '연차관리에서 휴가 신청이 삭제되었습니다.')
    .catch((err) => console.error('[leave archive auto-cancel-delete]', err));
  return c.json({ success: true });
});

// ───── 총무 휴가 알림 (대시보드) ─────
// GET /api/leave/accountant-leaves — 현재~향후 7일 내 총무 휴가 조회
leave.get('/accountant-leaves', async (c) => {
  const db = c.env.DB;
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000); // KST
  // 오늘부터 7일 후까지 공지
  const today = now.toISOString().slice(0, 10);
  const future = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const result = await db.prepare(`
    SELECT lr.id, lr.user_id, lr.leave_type, lr.start_date, lr.end_date, lr.hours, lr.days, lr.reason,
      u.name, u.branch, u.department, u.position_title
    FROM leave_requests lr
    JOIN users u ON u.id = lr.user_id
    WHERE u.role IN ('accountant', 'accountant_asst')
      AND lr.status = 'approved'
      AND lr.end_date >= ?
      AND lr.start_date <= ?
    ORDER BY lr.start_date ASC
  `).bind(today, future).all();

  return c.json({ leaves: result.results || [] });
});

export default leave;
