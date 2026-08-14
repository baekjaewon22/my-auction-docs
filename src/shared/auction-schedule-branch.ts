export const AUCTION_SCHEDULE_BRANCH_OPTIONS = [
  { value: 'all', label: '전체보기' },
  { value: '의정부본사', label: '의정부' },
  { value: '서초지사', label: '서초' },
  { value: '대전지사', label: '대전' },
  { value: '부산지사', label: '부산' },
] as const;

export const AUCTION_SCHEDULE_ALL_DEFAULT_USER_IDS = new Set([
  '2b6b3606-e425-4361-a115-9283cfef842f', // 정민호 지사장
]);

export function canSelectAuctionScheduleBranch(user: {
  id?: string | null;
  role?: string | null;
} | null | undefined): boolean {
  if (!user) return false;
  return ['master', 'ceo', 'accountant', 'accountant_asst'].includes(String(user.role || ''))
    || AUCTION_SCHEDULE_ALL_DEFAULT_USER_IDS.has(String(user.id || ''));
}

export function defaultAuctionScheduleBranch(user: {
  id?: string | null;
  role?: string | null;
  branch?: string | null;
} | null | undefined): string {
  if (!user) return 'all';
  if (canSelectAuctionScheduleBranch(user)) {
    return 'all';
  }
  const compact = String(user.branch || '').replace(/\s+/g, '');
  if (['의정부', '의정부지사', '의정부본사', '본사'].includes(compact)) return '의정부본사';
  if (['서초', '서초지사', '강남', '강남지사'].includes(compact)) return '서초지사';
  if (['대전', '대전지사'].includes(compact)) return '대전지사';
  if (['부산', '부산지사'].includes(compact)) return '부산지사';
  return 'all';
}

export function normalizeAuctionScheduleBranchFilter(value: unknown): string | null {
  const compact = String(value || '').replace(/\s+/g, '');
  if (!compact || compact === 'all' || compact === '전체' || compact === '전체보기') return 'all';
  if (['의정부', '의정부지사', '의정부본사', '본사'].includes(compact)) return '의정부본사';
  if (['서초', '서초지사', '강남', '강남지사'].includes(compact)) return '서초지사';
  if (['대전', '대전지사'].includes(compact)) return '대전지사';
  if (['부산', '부산지사'].includes(compact)) return '부산지사';
  return null;
}
