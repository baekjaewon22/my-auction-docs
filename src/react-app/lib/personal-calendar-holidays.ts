export interface PersonalCalendarHolidayRow {
  holiday_date: string;
  name: string;
}

export function buildPersonalCalendarHolidayNames(
  rows: readonly PersonalCalendarHolidayRow[],
): Map<string, string> {
  const names = new Map<string, string>();
  for (const row of rows) {
    const date = String(row.holiday_date || '').trim();
    const name = String(row.name || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) names.set(date, name || '공휴일');
  }
  return names;
}

export function personalCalendarHolidayName(
  date: string,
  namedHolidays: ReadonlyMap<string, string>,
): string {
  return namedHolidays.get(date) || '';
}
