const COMMUNITY_ALL_SHARE_ROLES = ['master', 'ceo', 'cc_ref', 'admin', 'manager'] as const;

export type CommunityVisibilityViewer = {
  role?: string | null;
  loginType?: string | null;
};

export function canShareCommunityWithAll(
  viewer: CommunityVisibilityViewer,
  category: string,
): boolean {
  if (category === 'eviction_quote') return false;
  return viewer.loginType === 'freelancer'
    || COMMUNITY_ALL_SHARE_ROLES.includes(String(viewer.role || '') as typeof COMMUNITY_ALL_SHARE_ROLES[number])
    || category === 'resource_library';
}

export function defaultCommunityVisibility(
  viewer: CommunityVisibilityViewer,
  category: string,
  evictionVisibility: string,
): string {
  if (category === 'eviction_quote') return evictionVisibility;
  return canShareCommunityWithAll(viewer, category) ? 'all' : 'branch';
}
