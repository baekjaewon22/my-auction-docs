export type HolidayScope = 'journal' | 'leave' | 'statistics';

export async function loadSystemHolidayDates(
  db: D1Database,
  years: readonly string[],
  scope: HolidayScope | readonly HolidayScope[],
): Promise<Set<string>> {
  const normalizedYears = [...new Set(years.map((year) => String(year).slice(0, 4)).filter((year) => /^\d{4}$/.test(year)))];
  const scopes = [...new Set(Array.isArray(scope) ? scope : [scope])];
  if (!normalizedYears.length || !scopes.length) return new Set();
  try {
    const yearPlaceholders = normalizedYears.map(() => '?').join(',');
    const scopePlaceholders = scopes.map(() => '?').join(',');
    const result = await db.prepare(`
      SELECT holiday_date
      FROM system_holidays
      WHERE enabled = 1
        AND substr(holiday_date, 1, 4) IN (${yearPlaceholders})
        AND (applies_to = 'all' OR applies_to IN (${scopePlaceholders}))
    `).bind(...normalizedYears, ...scopes).all<{ holiday_date: string }>();
    return new Set((result.results || []).map((row) => row.holiday_date).filter(Boolean));
  } catch (error) {
    console.warn('[system holidays] dynamic holiday table unavailable', error);
    return new Set();
  }
}
