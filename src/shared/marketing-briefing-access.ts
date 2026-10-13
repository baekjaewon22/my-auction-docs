type MarketingBriefingViewer = {
  role?: string | null;
};

export function canViewMarketingBriefings(user: MarketingBriefingViewer | null | undefined): boolean {
  return user?.role === 'master' || user?.role === 'ceo';
}
