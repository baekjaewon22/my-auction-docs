export interface AuctionScheduleMutationActor {
  role?: string | null;
  sub?: string | null;
  id?: string | null;
}

// 경매스케줄 일반정보를 '과거 포함 언제든' 수정·삭제할 수 있는 관리자급 역할.
// 마스터 · 총무(accountant) · 총무보조(accountant_asst) · 대표(ceo).
export const AUCTION_SCHEDULE_MUTATION_ROLES = ['master', 'accountant', 'accountant_asst', 'ceo'] as const;

// 경매스케줄을 직접 입력(작성)할 수 있는 역할.
// 프리랜서는 login_type로 별도 허용하고, 정직원은 아래 역할(현장 업무 포함)에 한해 본인 일정 입력 가능.
// support/resigned는 제외.
export const AUCTION_SCHEDULE_CREATE_ROLES = [
  'master', 'ceo', 'cc_ref', 'admin', 'director', 'manager', 'member', 'accountant', 'accountant_asst',
] as const;

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function canManageAuctionSchedule(
  actor: AuctionScheduleMutationActor | null | undefined,
): boolean {
  return !!actor && (AUCTION_SCHEDULE_MUTATION_ROLES as readonly string[]).includes(String(actor.role || ''));
}

export function canCreateAuctionSchedule(
  actor: (AuctionScheduleMutationActor & { login_type?: string | null }) | null | undefined,
): boolean {
  if (!actor) return false;
  if (String(actor.login_type || '') === 'freelancer') return true;
  return (AUCTION_SCHEDULE_CREATE_ROLES as readonly string[]).includes(String(actor.role || ''));
}

export function isValidAuctionScheduleDate(value: unknown): boolean {
  const normalized = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return false;
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === normalized;
}

export function auctionScheduleKstDateKey(now: Date = new Date()): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

export function isPastAuctionScheduleDate(targetDate: unknown, now: Date = new Date()): boolean {
  const normalized = String(targetDate || '').trim();
  return isValidAuctionScheduleDate(normalized) && normalized < auctionScheduleKstDateKey(now);
}

// 일정 '수정' 권한은 날짜·소유자와 관계없이 관리자급에만 허용한다.
// 입찰가·낙찰결과 전용 권한은 별도 정책을 사용한다.
export function canEditAuctionScheduleEntry(
  actor: AuctionScheduleMutationActor | null | undefined,
  _entry: { user_id?: string | null; target_date?: unknown } | null | undefined,
  _now: Date = new Date(),
): boolean {
  return !!_entry && canManageAuctionSchedule(actor);
}

export function getRequiredInspectionBidDateError(
  activityType: unknown,
  data: Record<string, unknown> | null | undefined,
): string | null {
  if (activityType !== '임장') return null;
  const bidDate = String(data?.bidDate || '').trim();
  if (!bidDate) return '임장 일정에는 입찰기일을 반드시 입력해 주세요.';
  if (!isValidAuctionScheduleDate(bidDate)) {
    return '입찰기일을 YYYY-MM-DD 형식의 올바른 날짜로 입력해 주세요.';
  }
  return null;
}
