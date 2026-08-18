export type EmploymentAccessUser = {
  role?: string;
  login_type?: string;
  department?: string;
  position_title?: string;
};

export function isFreelancerUser(user: EmploymentAccessUser | null | undefined): boolean {
  return user?.login_type === 'freelancer';
}

/**
 * 마스터는 프리랜서 세션으로 로그인해도 전체 관리 권한을 유지한다.
 * 실제 프리랜서 계정에만 직원 전용 기능 제한을 적용할 때 사용한다.
 */
export function isFreelancerAccessRestricted(user: EmploymentAccessUser | null | undefined): boolean {
  return isFreelancerUser(user) && user?.role !== 'master';
}

export function isFreelancerSupervisor(user: EmploymentAccessUser | null | undefined): boolean {
  return isFreelancerUser(user) && user?.role === 'manager';
}

export function canUseEmployeeLaborFeatures(user: EmploymentAccessUser | null | undefined): boolean {
  return !!user && !isFreelancerAccessRestricted(user);
}

export function requiresEmployeeLogin(user: EmploymentAccessUser): boolean {
  if (['master', 'ceo', 'cc_ref', 'admin', 'director', 'accountant', 'accountant_asst', 'support'].includes(String(user.role || ''))) {
    return true;
  }
  const rawJobText = `${user.department || ''} ${user.position_title || ''}`;
  const jobText = rawJobText.toLowerCase().replace(/\s+/g, '');
  return jobText.includes('명도')
    || jobText.includes('사무장')
    || jobText.includes('피디')
    || /(^|[^a-z])pd([^a-z]|$)/i.test(rawJobText);
}
