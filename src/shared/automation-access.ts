export const BUSINESS_AUTOMATION_EXTRA_USER_IDS = new Set([
  '2b6b3606-e425-4361-a115-9283cfef842f', // 정민호 지사장
]);

export function canUseBusinessAutomation(user: { id?: string; role?: string } | null | undefined): boolean {
  if (!user) return false;
  return String(user.role || '').toLowerCase() === 'master'
    || BUSINESS_AUTOMATION_EXTRA_USER_IDS.has(String(user.id || ''));
}
