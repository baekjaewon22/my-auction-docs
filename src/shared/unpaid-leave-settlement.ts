import { countLeaveBusinessDays } from './leave-calendar.ts';

const LEAVE_HOURS_PER_DAY = 8;
const PAYROLL_TRUNCATE_MONEY_FROM = '2026-06';

const truncMoney = (value: number): number => Math.trunc((Number(value) || 0) / 10) * 10;
const shouldTruncatePayrollMoney = (month: string): boolean => /^\d{4}-\d{2}$/.test(month) && month >= PAYROLL_TRUNCATE_MONEY_FROM;
const payrollMoney = (value: number, month: string): number => (
  shouldTruncatePayrollMoney(month) ? truncMoney(value) : Math.round(Number(value) || 0)
);

function leaveHoursToDays(hours: number): number {
  return Math.round((Number(hours || 0) / LEAVE_HOURS_PER_DAY) * 1000) / 1000;
}

function isIsoDate(value: unknown): value is string {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function maxIsoDate(a: string, b: string): string {
  return a > b ? a : b;
}

function minIsoDate(a: string, b: string): string {
  return a < b ? a : b;
}

function unpaidLeaveIsLeaveOfAbsence(row: any): boolean {
  const reason = String(row?.reason || '');
  return reason.includes('[무급]')
    && (
      reason.includes('휴직')
      || Number(row?.days || 0) >= 20
      || Number(row?.hours || 0) >= 160
    );
}

async function getPayrollHolidayDates(
  db: D1Database,
  startDate: string,
  endDate: string,
): Promise<Set<string>> {
  try {
    const result = await db.prepare(`
      SELECT holiday_date FROM system_holidays
      WHERE holiday_date >= ? AND holiday_date <= ?
    `).bind(startDate, endDate).all<{ holiday_date: string }>();
    return new Set((result.results || []).map((row) => String(row.holiday_date || '').slice(0, 10)).filter(isIsoDate));
  } catch {
    return new Set();
  }
}

function monthRange(month: string): {
  year: number;
  monthNumber: number;
  start: string;
  end: string;
  monthDays: number;
  payrollBaseDays: number;
  payrollLastDay: number;
} {
  const [yearText, monthText] = month.split('-');
  const year = Number(yearText);
  const monthNumber = Number(monthText);
  const monthDays = new Date(year, monthNumber, 0).getDate();
  const payrollBaseDays = 30;
  return {
    year,
    monthNumber,
    start: `${month}-01`,
    end: `${month}-${String(monthDays).padStart(2, '0')}`,
    monthDays,
    payrollBaseDays,
    payrollLastDay: Math.min(monthDays, payrollBaseDays),
  };
}

export type UnpaidLeavePayrollSettlement = {
  unpaid_leave_hours: number;
  unpaid_leave_days: number;
  unpaid_leave_deduction: number;
  hourly_unpaid_leave_hours: number;
  hourly_unpaid_leave_deduction: number;
  leave_of_absence: boolean;
  absence_paid_days: number;
  absence_unpaid_days: number;
  absence_base_deduction: number;
  absence_prorated_base_pay: number;
  payroll_base_days: number;
  periods: Array<{
    id: string;
    start_date: string;
    end_date: string;
    reason: string;
    mode: 'leave_of_absence' | 'hourly';
    hours: number;
    days: number;
  }>;
};

function emptyUnpaidLeaveSettlement(): UnpaidLeavePayrollSettlement {
  return {
    unpaid_leave_hours: 0,
    unpaid_leave_days: 0,
    unpaid_leave_deduction: 0,
    hourly_unpaid_leave_hours: 0,
    hourly_unpaid_leave_deduction: 0,
    leave_of_absence: false,
    absence_paid_days: 0,
    absence_unpaid_days: 0,
    absence_base_deduction: 0,
    absence_prorated_base_pay: 0,
    payroll_base_days: 30,
    periods: [],
  };
}

async function getLeaveRequestColumnNames(db: D1Database): Promise<Set<string> | null> {
  try {
    const info = await db.prepare('PRAGMA table_info(leave_requests)').all<{ name: string }>();
    return new Set((info.results || []).map((row) => String(row.name || '')));
  } catch {
    return null;
  }
}

export async function calculateUnpaidLeavePayrollSettlement(
  db: D1Database,
  userId: string,
  month: string,
  salary: number,
  positionAllowance = 0,
): Promise<UnpaidLeavePayrollSettlement> {
  const range = monthRange(month);
  const leaveColumns = await getLeaveRequestColumnNames(db);
  if (!leaveColumns || !leaveColumns.has('start_date') || !leaveColumns.has('user_id')) {
    return emptyUnpaidLeaveSettlement();
  }
  const statusPredicate = leaveColumns.has('status') ? "AND status = 'approved'" : '';
  const leaveTypePredicate = leaveColumns.has('leave_type') ? "AND leave_type = '특별휴가'" : '';
  const reasonExpr = leaveColumns.has('reason') ? 'reason' : "''";
  const hoursExpr = leaveColumns.has('hours')
    ? (leaveColumns.has('days') ? 'COALESCE(hours, days * 8)' : 'COALESCE(hours, 0)')
    : (leaveColumns.has('days') ? 'days * 8' : '0');
  const daysExpr = leaveColumns.has('days') ? 'days' : `(${hoursExpr}) / 8`;
  const endDateExpr = leaveColumns.has('end_date') ? 'end_date' : 'start_date';
  const result = await db.prepare(`
    SELECT id, start_date, ${endDateExpr} AS end_date, ${hoursExpr} AS hours, ${daysExpr} AS days, ${reasonExpr} AS reason
    FROM leave_requests
    WHERE user_id = ?
      ${statusPredicate}
      ${leaveTypePredicate}
      AND (instr(${reasonExpr}, '[무급]') > 0 OR instr(${reasonExpr}, '[기타]') > 0)
      AND NOT (${endDateExpr} < ? OR start_date > ?)
  `).bind(userId, range.start, range.end).all<any>();
  const rows = (result.results || [])
    .map((row: any) => ({
      ...row,
      start_date: String(row.start_date || '').slice(0, 10),
      end_date: String(row.end_date || '').slice(0, 10),
      hours: Number(row.hours || 0),
      days: Number(row.days || 0),
      reason: String(row.reason || ''),
    }))
    .filter((row: any) => isIsoDate(row.start_date) && isIsoDate(row.end_date));

  const absenceRows = rows.filter(unpaidLeaveIsLeaveOfAbsence);
  const hourlyRows = rows.filter((row: any) => !unpaidLeaveIsLeaveOfAbsence(row));
  const periods: UnpaidLeavePayrollSettlement['periods'] = [];

  const absenceDays = new Set<number>();
  for (const row of absenceRows) {
    let coveredDays = 0;
    for (let day = 1; day <= range.payrollLastDay; day += 1) {
      const date = `${month}-${String(day).padStart(2, '0')}`;
      if (date >= row.start_date && date <= row.end_date) {
        absenceDays.add(day);
        coveredDays += 1;
      }
    }
    periods.push({
      id: String(row.id || ''),
      start_date: row.start_date,
      end_date: row.end_date,
      reason: row.reason,
      mode: 'leave_of_absence',
      hours: coveredDays * LEAVE_HOURS_PER_DAY,
      days: coveredDays,
    });
  }

  const holidayStartCandidates = hourlyRows.map((row: any) => row.start_date);
  const holidayEndCandidates = hourlyRows.map((row: any) => row.end_date);
  const holidayStart = holidayStartCandidates.length ? holidayStartCandidates.reduce(minIsoDate) : range.start;
  const holidayEnd = holidayEndCandidates.length ? holidayEndCandidates.reduce(maxIsoDate) : range.end;
  const holidays = hourlyRows.length ? await getPayrollHolidayDates(db, holidayStart, holidayEnd) : new Set<string>();

  let hourlyUnpaidLeaveHours = 0;
  for (const row of hourlyRows) {
    const overlapStart = maxIsoDate(row.start_date, range.start);
    const overlapEnd = minIsoDate(row.end_date, range.end);
    if (overlapStart > overlapEnd) continue;
    let overlapHours = row.hours;
    if (row.start_date < range.start || row.end_date > range.end) {
      const totalDays = row.days > 0
        ? row.days
        : countLeaveBusinessDays(row.start_date, row.end_date, holidays);
      const overlapDays = countLeaveBusinessDays(overlapStart, overlapEnd, holidays);
      const hoursPerDay = totalDays > 0 ? row.hours / totalDays : LEAVE_HOURS_PER_DAY;
      overlapHours = Math.round(overlapDays * hoursPerDay * 1000) / 1000;
    }
    hourlyUnpaidLeaveHours += overlapHours;
    periods.push({
      id: String(row.id || ''),
      start_date: row.start_date,
      end_date: row.end_date,
      reason: row.reason,
      mode: 'hourly',
      hours: overlapHours,
      days: leaveHoursToDays(overlapHours),
    });
  }

  const basePay = Number(salary || 0) + Number(positionAllowance || 0);
  const absenceUnpaidDays = absenceDays.size;
  const absencePaidDays = Math.max(range.payrollLastDay - absenceUnpaidDays, 0);
  const absenceProratedBasePay = absenceRows.length
    ? payrollMoney(basePay * absencePaidDays / range.payrollBaseDays, month)
    : 0;
  const absenceBaseDeduction = absenceRows.length
    ? Math.max(basePay - absenceProratedBasePay, 0)
    : 0;
  const hourlyUnpaidDeduction = salary > 0 ? truncMoney((salary / 209) * hourlyUnpaidLeaveHours) : 0;

  return {
    unpaid_leave_hours: Math.round((hourlyUnpaidLeaveHours + absenceUnpaidDays * LEAVE_HOURS_PER_DAY) * 1000) / 1000,
    unpaid_leave_days: Math.round((leaveHoursToDays(hourlyUnpaidLeaveHours) + absenceUnpaidDays) * 1000) / 1000,
    unpaid_leave_deduction: hourlyUnpaidDeduction + absenceBaseDeduction,
    hourly_unpaid_leave_hours: Math.round(hourlyUnpaidLeaveHours * 1000) / 1000,
    hourly_unpaid_leave_deduction: hourlyUnpaidDeduction,
    leave_of_absence: absenceRows.length > 0,
    absence_paid_days: absenceRows.length ? absencePaidDays : 0,
    absence_unpaid_days: absenceRows.length ? absenceUnpaidDays : 0,
    absence_base_deduction: absenceBaseDeduction,
    absence_prorated_base_pay: absenceProratedBasePay,
    payroll_base_days: range.payrollBaseDays,
    periods,
  };
}
