export const DASHBOARD_PHONE_ALERT_FROM = '2026-08-01';

export function isDashboardPhoneAlertDate(contractDate: unknown): boolean {
  return String(contractDate || '').slice(0, 10) >= DASHBOARD_PHONE_ALERT_FROM;
}

export function isCurrentEmployeeDashboardEntry(entry: { user_login_type?: string | null }): boolean {
  return entry.user_login_type !== 'freelancer';
}
