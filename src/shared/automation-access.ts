export const BUSINESS_AUTOMATION_EXTRA_USER_IDS = new Set([
  '2b6b3606-e425-4361-a115-9283cfef842f', // 정민호 지사장
]);

// 업무 자동화 접근 허용 역할 = 팀장 이상: 마스터·대표·총괄이사·관리자·팀장.
// 총무담당/총무보조, CC참조자, 팀원/지원/퇴사자는 제외.
export const BUSINESS_AUTOMATION_ROLES = new Set(['master', 'ceo', 'director', 'admin', 'manager']);

export function canUseBusinessAutomation(user: { id?: string; role?: string } | null | undefined): boolean {
  if (!user) return false;
  return BUSINESS_AUTOMATION_ROLES.has(String(user.role || '').toLowerCase())
    || BUSINESS_AUTOMATION_EXTRA_USER_IDS.has(String(user.id || ''));
}
