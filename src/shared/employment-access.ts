export type EmploymentAccessUser = {
  role?: string;
  login_type?: string;
  department?: string;
  position_title?: string;
};

export function isFreelancerUser(user: EmploymentAccessUser | null | undefined): boolean {
  return user?.login_type === 'freelancer';
}

export function isFreelancerSupervisor(user: EmploymentAccessUser | null | undefined): boolean {
  return isFreelancerUser(user) && user?.role === 'manager';
}

export function canUseEmployeeLaborFeatures(user: EmploymentAccessUser | null | undefined): boolean {
  return !!user && !isFreelancerUser(user);
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
