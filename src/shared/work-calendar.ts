export const DEFAULT_COMPANY_HOLIDAYS = new Set([
  '2026-01-01', '2026-01-28', '2026-01-29', '2026-01-30', '2026-03-01',
  '2026-05-01', '2026-05-05', '2026-05-24', '2026-05-25', '2026-06-03',
  '2026-06-06', '2026-08-15', '2026-09-24', '2026-09-25', '2026-09-26',
  '2026-10-03', '2026-10-09', '2026-12-25',
  '2027-01-01', '2027-02-15', '2027-02-16', '2027-02-17', '2027-03-01',
  '2027-05-05', '2027-05-13', '2027-06-06', '2027-08-15', '2027-10-03',
  '2027-10-09', '2027-10-13', '2027-10-14', '2027-10-15', '2027-12-25',
]);

function utcDate(dateText: string): Date {
  return new Date(`${dateText}T00:00:00Z`);
}

export function formatWorkDate(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function isNonWorkingDate(dateText: string, extraHolidays: ReadonlySet<string> = new Set()): boolean {
  const date = utcDate(dateText);
  const day = date.getUTCDay();
  return day === 0 || day === 6 || DEFAULT_COMPANY_HOLIDAYS.has(dateText) || extraHolidays.has(dateText);
}

export function previousWorkDate(dateText: string, extraHolidays: ReadonlySet<string> = new Set()): string {
  let date = utcDate(dateText);
  while (isNonWorkingDate(formatWorkDate(date), extraHolidays)) {
    date = new Date(date.getTime() - 86400000);
  }
  return formatWorkDate(date);
}

export function nextWorkDate(dateText: string, extraHolidays: ReadonlySet<string> = new Set()): string {
  let date = utcDate(dateText);
  while (isNonWorkingDate(formatWorkDate(date), extraHolidays)) {
    date = new Date(date.getTime() + 86400000);
  }
  return formatWorkDate(date);
}

export function businessDaysInMonth(year: number, month: number, extraHolidays: ReadonlySet<string> = new Set()): number[] {
  const result: number[] = [];
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateText = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (!isNonWorkingDate(dateText, extraHolidays)) result.push(day);
  }
  return result;
}

export function countBusinessDates(startDate: string, endDate: string, extraHolidays: ReadonlySet<string> = new Set()): number {
  let count = 0;
  let cursor = utcDate(startDate);
  const end = utcDate(endDate);
  while (cursor <= end) {
    if (!isNonWorkingDate(formatWorkDate(cursor), extraHolidays)) count += 1;
    cursor = new Date(cursor.getTime() + 86400000);
  }
  return count;
}
