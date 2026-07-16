export const TARGETED_COMMUNITY_CATEGORIES = ['community', 'eviction_quote', 'legal_support'] as const;

export function directRecipientId(visibility: unknown): string | null {
  const value = String(visibility || '').trim();
  if (!value.startsWith('user:')) return null;
  const userId = value.slice(5).trim();
  return userId || null;
}

export function communityReplyRecipientIds(input: {
  category: string | null | undefined;
  authorId: string | null | undefined;
  visibility?: string | null;
  actorId: string;
}): string[] {
  if (!TARGETED_COMMUNITY_CATEGORIES.includes(String(input.category || 'community') as typeof TARGETED_COMMUNITY_CATEGORIES[number])) {
    return [];
  }
  const recipients = new Set<string>();
  if (input.authorId) recipients.add(input.authorId);
  const directRecipient = directRecipientId(input.visibility);
  if (directRecipient) recipients.add(directRecipient);
  recipients.delete(input.actorId);
  return [...recipients];
}

export function communityNotificationUrl(category: string | null | undefined): string {
  if (category === 'legal_support') return '/admin-notes?tab=legal_support';
  if (category === 'eviction_quote') return '/admin-notes?tab=eviction_quote';
  return '/admin-notes';
}

export function communityCategoryLabel(category: string | null | undefined): string {
  if (category === 'legal_support') return '법률지원';
  if (category === 'eviction_quote') return '명도견적의뢰';
  return '커뮤니티 게시글';
}
