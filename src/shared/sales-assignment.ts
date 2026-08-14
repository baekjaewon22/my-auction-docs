const SALES_DELEGATE_ROLES = new Set(['master', 'accountant']);
const SALES_DELEGATE_USER_IDS = new Set([
  '2b6b3606-e425-4361-a115-9283cfef842f', // 정민호 지사장
]);

export function canAssignSalesToAnotherUser(
  role: string | null | undefined,
  userId?: string | null,
): boolean {
  return SALES_DELEGATE_ROLES.has(String(role || ''))
    || SALES_DELEGATE_USER_IDS.has(String(userId || ''));
}

export function canUseRequestedSalesOwner(
  role: string | null | undefined,
  requesterId: string,
  requestedOwnerId: string | null | undefined,
): boolean {
  const targetId = String(requestedOwnerId || '').trim();
  return !targetId || targetId === requesterId || canAssignSalesToAnotherUser(role, requesterId);
}
