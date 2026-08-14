export const EVICTION_QUOTE_VISIBILITY = 'eviction_team';
export const JEONG_MINHO_USER_ID = '2b6b3606-e425-4361-a115-9283cfef842f';

export function isEvictionTeamMember(input: { department?: string | null; teamName?: string | null }): boolean {
  return String(input.department || '').trim() === '명도팀' || String(input.teamName || '').trim() === '명도팀';
}

export function canViewAllEvictionProgress(input: {
  userId?: string | null;
  role?: string | null;
  department?: string | null;
  teamName?: string | null;
}): boolean {
  return input.role === 'master'
    || input.role === 'ceo'
    || input.userId === JEONG_MINHO_USER_ID
    || isEvictionTeamMember(input);
}

export function canAccessEvictionQuote(input: {
  userId?: string | null;
  role?: string | null;
  department?: string | null;
  teamName?: string | null;
  authorId?: string | null;
}): boolean {
  return input.role === 'master'
    || Boolean(input.userId && input.userId === input.authorId)
    || input.userId === JEONG_MINHO_USER_ID
    || isEvictionTeamMember(input);
}
