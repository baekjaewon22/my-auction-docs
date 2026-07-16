const HOURS_PER_LEAVE_DAY = 8;

export type LeaveCycle = { start: string; end: string };

function hoursToDays(hours: number): number {
  return Math.round((hours / HOURS_PER_LEAVE_DAY) * 1000) / 1000;
}

export async function sumApprovedLeave(
  db: D1Database,
  userId: string,
  userType: 'monthly' | 'annual',
  cycle?: LeaveCycle | null,
): Promise<{ used_days: number; monthly_used: number; used_hours: number; monthly_used_hours: number }> {
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
  `).bind(HOURS_PER_LEAVE_DAY, userId, cycleStart, cycleStart, cycleEnd, cycleEnd)
    .all<{ leave_type: string; total_hours: number }>();

  let usedHours = 0;
  let monthlyUsedHours = 0;
  for (const row of result.results || []) {
    const rowHours = Number(row.total_hours) || 0;
    if (userType === 'monthly') monthlyUsedHours += rowHours;
    else usedHours += rowHours;
  }
  return {
    used_hours: usedHours,
    monthly_used_hours: monthlyUsedHours,
    used_days: hoursToDays(usedHours),
    monthly_used: hoursToDays(monthlyUsedHours),
  };
}
