export const DASHBOARD_NOTICE_LIMIT = 3;

export function dashboardNoticeItems<T>(notices: readonly T[]): T[] {
  return notices.slice(0, DASHBOARD_NOTICE_LIMIT);
}
