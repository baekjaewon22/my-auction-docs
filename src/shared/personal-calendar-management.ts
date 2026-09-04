export interface PersonalCalendarManagementActor {
  role?: string | null;
}

// 캘린더는 경매 스케줄을 모아 보는 열람 화면이다. 원본 일정으로 진입해
// 수정하거나 캘린더에서 삭제하는 예외 권한은 마스터와 총무에게만 둔다.
export const PERSONAL_CALENDAR_MANAGEMENT_ROLES = ['master', 'accountant'] as const;

export function canManagePersonalCalendar(
  actor: PersonalCalendarManagementActor | null | undefined,
): boolean {
  return !!actor
    && (PERSONAL_CALENDAR_MANAGEMENT_ROLES as readonly string[]).includes(String(actor.role || ''));
}
