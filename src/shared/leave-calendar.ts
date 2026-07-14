export function parseLeaveDate(value: string): Date | null {
  const [year, month, day] = String(value || '').slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null;
  return date;
}

export function formatLeaveDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function isLeaveDateRange(startDate: string, endDate: string): boolean {
  const start = parseLeaveDate(startDate);
  const end = parseLeaveDate(endDate);
  return Boolean(start && end && start <= end);
}

export function leaveYearsForRange(startDate: string, endDate: string): string[] {
  return Array.from(new Set([startDate, endDate]
    .map((date) => String(date || '').slice(0, 4))
    .filter((year) => /^\d{4}$/.test(year)))).sort();
}

export function isWeekendLeaveDate(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

export function isLeaveBusinessDate(date: Date, holidays: ReadonlySet<string>): boolean {
  return !isWeekendLeaveDate(date) && !holidays.has(formatLeaveDate(date));
}

export function addLeaveBusinessDays(startDate: string, days: number, holidays: ReadonlySet<string>): string {
  const start = parseLeaveDate(startDate);
  if (!start) throw new Error('유효하지 않은 시작일입니다.');
  const targetDays = Math.floor(days);
  if (!Number.isFinite(targetDays) || targetDays < 1) throw new Error('근무일 수는 1일 이상이어야 합니다.');
  const cursor = new Date(start);
  let counted = 0;
  while (counted < targetDays) {
    if (isLeaveBusinessDate(cursor, holidays)) counted += 1;
    if (counted < targetDays) cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return formatLeaveDate(cursor);
}

export function nextLeaveBusinessDay(dateText: string, holidays: ReadonlySet<string>): string {
  const date = parseLeaveDate(dateText);
  if (!date) throw new Error('유효하지 않은 기준일입니다.');
  do {
    date.setUTCDate(date.getUTCDate() + 1);
  } while (!isLeaveBusinessDate(date, holidays));
  return formatLeaveDate(date);
}

export function previousLeaveBusinessDay(dateText: string, holidays: ReadonlySet<string>): string {
  const date = parseLeaveDate(dateText);
  if (!date) throw new Error('유효하지 않은 기준일입니다.');
  do {
    date.setUTCDate(date.getUTCDate() - 1);
  } while (!isLeaveBusinessDate(date, holidays));
  return formatLeaveDate(date);
}

export function subtractLeaveBusinessDays(endDate: string, days: number, holidays: ReadonlySet<string>): string {
  const end = parseLeaveDate(endDate);
  if (!end) throw new Error('유효하지 않은 종료일입니다.');
  const targetDays = Math.floor(days);
  if (!Number.isFinite(targetDays) || targetDays < 1) throw new Error('근무일 수는 1일 이상이어야 합니다.');
  const cursor = new Date(end);
  let counted = 0;
  while (counted < targetDays) {
    if (isLeaveBusinessDate(cursor, holidays)) counted += 1;
    if (counted < targetDays) cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return formatLeaveDate(cursor);
}

export function countLeaveBusinessDays(
  startDate: string,
  endDate: string,
  holidays: ReadonlySet<string>,
): number {
  const start = parseLeaveDate(startDate);
  const end = parseLeaveDate(endDate);
  if (!start || !end || end < start) return 0;
  const cursor = new Date(start);
  let count = 0;
  while (cursor <= end) {
    if (isLeaveBusinessDate(cursor, holidays)) count += 1;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return count;
}

export type SummerChainPosition = 'before' | 'after';

export type SummerLeavePlan = {
  specialStartDate: string;
  specialEndDate: string;
  annualStartDate: string | null;
  annualEndDate: string | null;
};

export function planSummerLeave(input: {
  startDate: string;
  summerDays: number;
  chainDays: number;
  chainPosition: SummerChainPosition;
  holidays: ReadonlySet<string>;
}): SummerLeavePlan {
  const start = parseLeaveDate(input.startDate);
  if (!start) throw new Error('유효하지 않은 여름휴가 시작일입니다.');
  if (!isLeaveBusinessDate(start, input.holidays)) {
    throw new Error('여름휴가 시작일은 근무일이어야 합니다.');
  }
  if (!Number.isInteger(input.summerDays) || input.summerDays < 1 || input.summerDays > 3) {
    throw new Error('여름 특별휴가는 1~3일만 신청할 수 있습니다.');
  }
  if (!Number.isInteger(input.chainDays) || input.chainDays < 0 || input.chainDays > 2) {
    throw new Error('연결 연차는 0~2일만 신청할 수 있습니다.');
  }

  if (input.chainDays === 0) {
    return {
      specialStartDate: input.startDate,
      specialEndDate: addLeaveBusinessDays(input.startDate, input.summerDays, input.holidays),
      annualStartDate: null,
      annualEndDate: null,
    };
  }

  if (input.chainPosition === 'after') {
    const specialEndDate = addLeaveBusinessDays(input.startDate, input.summerDays, input.holidays);
    const annualStartDate = nextLeaveBusinessDay(specialEndDate, input.holidays);
    return {
      specialStartDate: input.startDate,
      specialEndDate,
      annualStartDate,
      annualEndDate: addLeaveBusinessDays(annualStartDate, input.chainDays, input.holidays),
    };
  }

  const annualEndDate = addLeaveBusinessDays(input.startDate, input.chainDays, input.holidays);
  const specialStartDate = nextLeaveBusinessDay(annualEndDate, input.holidays);
  return {
    specialStartDate,
    specialEndDate: addLeaveBusinessDays(specialStartDate, input.summerDays, input.holidays),
    annualStartDate: input.startDate,
    annualEndDate,
  };
}
