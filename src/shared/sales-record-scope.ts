export const JEONG_MINHO_SALES_SCOPE_USER_ID = '2b6b3606-e425-4361-a115-9283cfef842f';

export type SalesRecordScopeKind = 'all' | 'team-and-self' | 'branches-and-self' | 'self';

export type SalesRecordScopeViewer = {
  id?: string | null;
  sub?: string | null;
  name?: string | null;
  role?: string | null;
  branch?: string | null;
};

const COMPANY_WIDE_ROLES = new Set([
  'master',
  'ceo',
  'cc_ref',
  'accountant',
  'accountant_asst',
]);

export function salesRecordScopeKind(viewer: SalesRecordScopeViewer): SalesRecordScopeKind {
  const role = String(viewer.role || '');
  const viewerId = String(viewer.id || viewer.sub || '');

  if (COMPANY_WIDE_ROLES.has(role)) return 'all';
  if (role === 'admin' && viewerId === JEONG_MINHO_SALES_SCOPE_USER_ID) {
    return 'all';
  }
  if (role === 'manager') return 'team-and-self';
  if (role === 'admin' || role === 'director') return 'branches-and-self';
  return 'self';
}

export function salesMissingAlertScopeTitle(viewer: SalesRecordScopeViewer): string {
  switch (salesRecordScopeKind(viewer)) {
    case 'all':
      return '전체 미작성 알림';
    case 'team-and-self':
      return '팀·본인 미작성 알림';
    case 'branches-and-self':
      return '관할지사·본인 미작성 알림';
    default:
      return '본인 미작성 알림';
  }
}

export function salesDirectorManagedBranch(viewer: SalesRecordScopeViewer): string {
  if (String(viewer.name || '').trim() === '서정수') return '부산지사';
  return String(viewer.branch || '').trim();
}
