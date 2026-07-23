const SALES_DELEGATE_ROLES = new Set(['master', 'accountant']);

export function canAssignSalesToAnotherUser(role: string | null | undefined): boolean {
  return SALES_DELEGATE_ROLES.has(String(role || ''));
}

export function canUseRequestedSalesOwner(
  role: string | null | undefined,
  requesterId: string,
  requestedOwnerId: string | null | undefined,
): boolean {
  const targetId = String(requestedOwnerId || '').trim();
  return !targetId || targetId === requesterId || canAssignSalesToAnotherUser(role);
}
