import { normalizeBranchName } from './branchAliases';

export type UserSelectUser = {
  id: string;
  name: string;
  role?: string;
  branch?: string;
  department?: string;
  position_title?: string;
};

export type UserSelectOption = {
  value: string;
  label: string;
  user: UserSelectUser;
};

export type UserSelectGroup = {
  label: string;
  options: UserSelectOption[];
};

const BRANCH_ORDER = ['의정부본사', '서초지사', '대전지사', '부산지사'];
const BRANCH_LABELS: Record<string, string> = {
  의정부본사: '의정부',
  서초지사: '서초지사',
  대전지사: '대전지사',
  부산지사: '부산지사',
  본사관리: '본사관리',
};

function branchRank(user: UserSelectUser): number {
  if ((user.role as string) === 'resigned') return Number.MAX_SAFE_INTEGER;
  const branch = normalizeBranchName(user.branch);
  const idx = BRANCH_ORDER.indexOf(branch);
  return idx >= 0 ? idx : BRANCH_ORDER.length;
}

function branchGroupLabel(user: UserSelectUser): string {
  if ((user.role as string) === 'resigned') return '퇴사자';
  const branch = normalizeBranchName(user.branch) || user.branch || '미지정';
  return BRANCH_LABELS[branch] || branch;
}

function userNameSort(left: UserSelectUser, right: UserSelectUser): number {
  return String(left.name || '').localeCompare(String(right.name || ''), 'ko');
}

export function sortUsersForSelect<T extends UserSelectUser>(users: T[]): T[] {
  return [...users].sort((a, b) => (
    branchRank(a) - branchRank(b)
    || userNameSort(a, b)
    || String(a.department || '').localeCompare(String(b.department || ''), 'ko')
  ));
}

export function buildUserOption<T extends UserSelectUser>(user: T, detail?: (user: T) => string): UserSelectOption {
  const suffix = detail?.(user) || '';
  const resigned = (user.role as string) === 'resigned' ? ' [퇴사]' : '';
  return {
    value: user.id,
    label: `${user.name || '이름 없음'}${suffix}${resigned}`,
    user,
  };
}

export function groupUserOptions(
  users: UserSelectUser[],
  detail?: (user: UserSelectUser) => string,
): UserSelectGroup[] {
  const groups = new Map<string, UserSelectOption[]>();
  for (const user of sortUsersForSelect(users)) {
    const label = branchGroupLabel(user);
    const options = groups.get(label) || [];
    options.push(buildUserOption(user, detail));
    groups.set(label, options);
  }
  return Array.from(groups.entries()).map(([label, options]) => ({ label, options }));
}

export function flattenUserOptions(groups: UserSelectGroup[]): UserSelectOption[] {
  return groups.flatMap((group) => group.options);
}

export function findUserOption(
  groups: UserSelectGroup[],
  value: string,
): UserSelectOption | null {
  return flattenUserOptions(groups).find((option) => option.value === value) || null;
}
