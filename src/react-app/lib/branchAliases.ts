export const CANONICAL_BRANCHES = ['의정부본사', '서초지사', '대전지사', '부산지사', '본사관리'] as const;

export function compactBranchName(value: unknown): string {
  return String(value || '').replace(/\s+/g, '').trim();
}

export function normalizeBranchName(value: unknown): string {
  const compact = compactBranchName(value);
  if (!compact || compact === '전체') return '';
  if (compact === '본사관리') return '본사관리';
  if (compact === '의정부' || compact === '의정부지사' || compact === '의정부본사' || compact === '본사') return '의정부본사';
  if (compact === '서초' || compact === '서초지사' || compact === '강남' || compact === '강남지사') return '서초지사';
  if (compact === '대전' || compact === '대전지사') return '대전지사';
  if (compact === '부산' || compact === '부산지사') return '부산지사';
  return String(value || '').trim();
}

export function sameBranchName(left: unknown, right: unknown): boolean {
  const normalizedLeft = normalizeBranchName(left);
  const normalizedRight = normalizeBranchName(right);
  return !!normalizedLeft && !!normalizedRight && normalizedLeft === normalizedRight;
}

export function isHeadOfficeBranch(value: unknown): boolean {
  return normalizeBranchName(value) === '의정부본사';
}

export function isRestrictedAccountingBranch(value: unknown): boolean {
  const normalized = normalizeBranchName(value);
  return normalized === '의정부본사' || normalized === '본사관리';
}
