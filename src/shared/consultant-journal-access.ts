export const JEONG_MINHO_USER_ID = '2b6b3606-e425-4361-a115-9283cfef842f';

export function canViewConsultantJournal(
  user: { id?: string | null; role?: string | null } | null | undefined,
): boolean {
  return !!user && (
    user.role === 'master'
    || user.role === 'ceo'
    || user.id === JEONG_MINHO_USER_ID
  );
}
