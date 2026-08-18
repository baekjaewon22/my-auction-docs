export const JEONG_MINHO_USER_ID = '2b6b3606-e425-4361-a115-9283cfef842f';

export function canDismissDashboardAlertItems(user: {
  id?: string | null;
  sub?: string | null;
  role?: string | null;
} | null | undefined): boolean {
  const userId = String(user?.id || user?.sub || '');
  return user?.role === 'master'
    || user?.role === 'accountant'
    || userId === JEONG_MINHO_USER_ID;
}
