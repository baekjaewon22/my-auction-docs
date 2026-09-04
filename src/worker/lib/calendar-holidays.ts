import {
  defaultCompanyHolidaysBetween,
  type CompanyHoliday,
  type CompanyHolidayType,
} from '../../shared/work-calendar.ts';

export type CalendarHoliday = CompanyHoliday;

const HOLIDAY_TYPES = new Set<CompanyHolidayType>(['legal', 'substitute', 'temporary', 'company']);

function holidayType(value: unknown): CompanyHolidayType {
  const type = String(value || '') as CompanyHolidayType;
  return HOLIDAY_TYPES.has(type) ? type : 'legal';
}

/**
 * 배포에 포함된 공식 기본일과 운영자가 관리하는 all/journal 휴일을 합친다.
 * 기본일은 네트워크 없이 항상 반환하고, 같은 날짜의 활성 운영 행은 이름과 유형을 덮어쓴다.
 */
export async function loadCalendarHolidays(
  db: D1Database,
  from: string,
  to: string,
): Promise<CalendarHoliday[]> {
  const byDate = new Map(
    defaultCompanyHolidaysBetween(from, to).map(holiday => [holiday.holiday_date, holiday]),
  );
  try {
    const result = await db.prepare(`
      SELECT holiday_date, name, holiday_type
      FROM system_holidays
      WHERE enabled = 1
        AND (applies_to = 'all' OR applies_to = 'journal')
        AND holiday_date BETWEEN ? AND ?
      ORDER BY holiday_date ASC
    `).bind(from, to).all<{
      holiday_date: string;
      name: string;
      holiday_type: string;
    }>();
    for (const row of result.results || []) {
      const date = String(row.holiday_date || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      byDate.set(date, {
        holiday_date: date,
        name: String(row.name || '').trim() || byDate.get(date)?.name || '공휴일',
        holiday_type: holidayType(row.holiday_type),
      });
    }
  } catch (error) {
    console.warn('[calendar holidays] dynamic holiday table unavailable', error);
  }
  return [...byDate.values()].sort((left, right) => left.holiday_date.localeCompare(right.holiday_date));
}
