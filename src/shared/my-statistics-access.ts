export type MyStatisticsAccessUser = {
  id?: string;
  role?: string;
  department?: string;
  team_name?: string;
  position_title?: string;
};

const BLOCKED_ROLES = new Set(['accountant_asst', 'support', 'resigned']);
const MY_STATISTICS_ALL_VIEWER_ROLES = new Set(['master', 'ceo', 'accountant']);
const MY_STATISTICS_ALL_VIEWER_IDS = new Set([
  '2b6b3606-e425-4361-a115-9283cfef842f', // 정민호 지사장
]);

function normalizedOrganizationText(user: MyStatisticsAccessUser | null | undefined): string {
  return `${user?.department || ''} ${user?.team_name || ''} ${user?.position_title || ''}`
    .toLowerCase()
    .replace(/\s+/g, '');
}

export function canViewMyStatistics(user: MyStatisticsAccessUser | null | undefined): boolean {
  if (!user || String(user.role || '') === 'resigned') return false;
  if (MY_STATISTICS_ALL_VIEWER_IDS.has(String(user.id || ''))) return true;
  if (MY_STATISTICS_ALL_VIEWER_ROLES.has(String(user.role || ''))) return true;
  if (BLOCKED_ROLES.has(String(user.role || ''))) return false;
  const organization = normalizedOrganizationText(user);
  return !organization.includes('명도')
    && !organization.includes('피디')
    && !organization.includes('pd');
}

export function canViewAllMyStatistics(user: MyStatisticsAccessUser | null | undefined): boolean {
  return canViewMyStatistics(user)
    && (MY_STATISTICS_ALL_VIEWER_ROLES.has(String(user?.role || ''))
      || MY_STATISTICS_ALL_VIEWER_IDS.has(String(user?.id || '')));
}
