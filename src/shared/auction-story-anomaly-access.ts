export const AUCTION_STORY_BRANCHES = ['의정부본사', '서초지사', '대전지사', '부산지사'] as const;
export type AuctionStoryBranch = typeof AUCTION_STORY_BRANCHES[number];

const MINHO_ID = '2b6b3606-e425-4361-a115-9283cfef842f';
const SEONGHEON_ID = 'c32c3021-b8f6-42f8-b977-7e6e53a7e6f6';

type StoryAnomalyViewer = {
  id?: string | null;
  name?: string | null;
  role?: string | null;
};

export function auctionStoryAnomalyBranches(viewer: StoryAnomalyViewer): AuctionStoryBranch[] {
  const id = String(viewer.id || '');
  const name = String(viewer.name || '').trim();
  if (viewer.role === 'master' || id === MINHO_ID || name === '정민호') return [...AUCTION_STORY_BRANCHES];
  if (id === SEONGHEON_ID || name === '진성헌') return ['서초지사', '대전지사'];
  if (name === '서정수') return ['부산지사'];
  return [];
}

export function canViewAuctionStoryAnomalies(viewer: StoryAnomalyViewer): boolean {
  return auctionStoryAnomalyBranches(viewer).length > 0;
}
