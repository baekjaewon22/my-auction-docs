export const SALES_EVALUATION_EXCLUDED_USER_ID = '2b6b3606-e425-4361-a115-9283cfef842f';

/** 영업 컨설턴트 기준매출 평가 대상. SQL에서 users 별칭은 u를 사용한다. */
export const SALES_EVALUATION_EMPLOYEE_FILTER = `
  u.role NOT IN ('master', 'ceo', 'cc_ref', 'accountant', 'accountant_asst', 'support', 'resigned')
  AND REPLACE(COALESCE(u.branch, ''), ' ', '') != '본사관리'
  AND (u.department IS NULL OR u.department NOT IN ('명도팀', '지원팀'))
  AND u.id != ?
  AND COALESCE(u.login_type, 'employee') = 'employee'
`;
