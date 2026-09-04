export type CompanyHolidayType = 'legal' | 'substitute' | 'temporary' | 'company';

export interface CompanyHoliday {
  holiday_date: string;
  name: string;
  holiday_type: CompanyHolidayType;
}

// 기존 회사 기본 휴일 날짜에 표시 이름과 유형을 붙인 구조화 원천이다.
// 런타임 외부 API에 의존하지 않으며 운영 변경분은 system_holidays로 보완한다.
export const DEFAULT_COMPANY_HOLIDAY_DETAILS: readonly CompanyHoliday[] = [
  { holiday_date: '2026-01-01', name: '1월 1일', holiday_type: 'legal' },
  { holiday_date: '2026-02-16', name: '설날 연휴', holiday_type: 'legal' },
  { holiday_date: '2026-02-17', name: '설날', holiday_type: 'legal' },
  { holiday_date: '2026-02-18', name: '설날 연휴', holiday_type: 'legal' },
  { holiday_date: '2026-03-01', name: '3·1절', holiday_type: 'legal' },
  { holiday_date: '2026-03-02', name: '대체공휴일(3·1절)', holiday_type: 'substitute' },
  { holiday_date: '2026-05-01', name: '노동절', holiday_type: 'legal' },
  { holiday_date: '2026-05-05', name: '어린이날', holiday_type: 'legal' },
  { holiday_date: '2026-05-24', name: '부처님 오신 날', holiday_type: 'legal' },
  { holiday_date: '2026-05-25', name: '대체공휴일(부처님 오신 날)', holiday_type: 'substitute' },
  { holiday_date: '2026-06-03', name: '전국동시지방선거', holiday_type: 'legal' },
  { holiday_date: '2026-06-06', name: '현충일', holiday_type: 'legal' },
  { holiday_date: '2026-08-15', name: '광복절', holiday_type: 'legal' },
  { holiday_date: '2026-08-17', name: '대체공휴일(광복절)', holiday_type: 'substitute' },
  { holiday_date: '2026-09-24', name: '추석 연휴', holiday_type: 'legal' },
  { holiday_date: '2026-09-25', name: '추석', holiday_type: 'legal' },
  { holiday_date: '2026-09-26', name: '추석 연휴', holiday_type: 'legal' },
  { holiday_date: '2026-10-03', name: '개천절', holiday_type: 'legal' },
  { holiday_date: '2026-10-05', name: '대체공휴일(개천절)', holiday_type: 'substitute' },
  { holiday_date: '2026-10-09', name: '한글날', holiday_type: 'legal' },
  { holiday_date: '2026-12-25', name: '기독탄신일', holiday_type: 'legal' },
  { holiday_date: '2027-01-01', name: '1월 1일', holiday_type: 'legal' },
  { holiday_date: '2027-02-06', name: '설날 연휴', holiday_type: 'legal' },
  { holiday_date: '2027-02-07', name: '설날', holiday_type: 'legal' },
  { holiday_date: '2027-02-08', name: '설날 연휴', holiday_type: 'legal' },
  { holiday_date: '2027-02-09', name: '대체공휴일(설날 연휴)', holiday_type: 'substitute' },
  { holiday_date: '2027-03-01', name: '3·1절', holiday_type: 'legal' },
  { holiday_date: '2027-05-01', name: '노동절', holiday_type: 'legal' },
  { holiday_date: '2027-05-03', name: '대체공휴일(노동절)', holiday_type: 'substitute' },
  { holiday_date: '2027-05-05', name: '어린이날', holiday_type: 'legal' },
  { holiday_date: '2027-05-13', name: '부처님 오신 날', holiday_type: 'legal' },
  { holiday_date: '2027-06-06', name: '현충일', holiday_type: 'legal' },
  { holiday_date: '2027-07-17', name: '제헌절', holiday_type: 'legal' },
  { holiday_date: '2027-07-19', name: '대체공휴일(제헌절)', holiday_type: 'substitute' },
  { holiday_date: '2027-08-15', name: '광복절', holiday_type: 'legal' },
  { holiday_date: '2027-08-16', name: '대체공휴일(광복절)', holiday_type: 'substitute' },
  { holiday_date: '2027-09-14', name: '추석 연휴', holiday_type: 'legal' },
  { holiday_date: '2027-09-15', name: '추석', holiday_type: 'legal' },
  { holiday_date: '2027-09-16', name: '추석 연휴', holiday_type: 'legal' },
  { holiday_date: '2027-10-03', name: '개천절', holiday_type: 'legal' },
  { holiday_date: '2027-10-04', name: '대체공휴일(개천절)', holiday_type: 'substitute' },
  { holiday_date: '2027-10-09', name: '한글날', holiday_type: 'legal' },
  { holiday_date: '2027-10-11', name: '대체공휴일(한글날)', holiday_type: 'substitute' },
  { holiday_date: '2027-12-25', name: '기독탄신일', holiday_type: 'legal' },
  { holiday_date: '2027-12-27', name: '대체공휴일(기독탄신일)', holiday_type: 'substitute' },
];

export const DEFAULT_COMPANY_HOLIDAYS = new Set(
  DEFAULT_COMPANY_HOLIDAY_DETAILS.map(holiday => holiday.holiday_date),
);

export function defaultCompanyHolidaysBetween(from: string, to: string): CompanyHoliday[] {
  return DEFAULT_COMPANY_HOLIDAY_DETAILS
    .filter(holiday => holiday.holiday_date >= from && holiday.holiday_date <= to)
    .map(holiday => ({ ...holiday }));
}

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
