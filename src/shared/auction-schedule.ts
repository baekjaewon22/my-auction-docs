export const AUCTION_SCHEDULE_ACTIVITY_TYPES = ['입찰', '임장', '미팅'] as const;
export type AuctionScheduleActivityType = typeof AUCTION_SCHEDULE_ACTIVITY_TYPES[number];
export type AuctionScheduleBidResult = 'won' | 'failed' | 'withdrawn' | 'pending';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function positiveWon(value: unknown): boolean {
  return Number(String(value || '').replace(/[^0-9]/g, '')) > 0;
}

export function auctionScheduleBidResult(data: Record<string, unknown>): AuctionScheduleBidResult {
  if (data.bidCancelled) return 'withdrawn';
  if (data.bidWon) return 'won';
  if (data.bidFailed) return 'failed';
  return 'pending';
}

export function auctionScheduleBidResultMissingFields(data: Record<string, unknown>): string[] {
  if (auctionScheduleBidResult(data) === 'withdrawn') return [];
  const missing: string[] = [];
  if (!positiveWon(data.suggestedPrice)) missing.push('제안입찰가');
  if (!positiveWon(data.bidPrice)) missing.push('작성입찰가');
  if (auctionScheduleBidResult(data) === 'pending') missing.push('낙찰여부');
  if (!positiveWon(data.winPrice)) missing.push('최종 낙찰가');
  return missing;
}

export function isAuctionScheduleBidResultDue(targetDate: string, now: Date = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) return false;
  const kst = new Date(now.getTime() + KST_OFFSET_MS).toISOString();
  const today = kst.slice(0, 10);
  if (targetDate < today) return true;
  return targetDate === today && Number(kst.slice(11, 13)) >= 15;
}

export function auctionScheduleSalesExternalId(scheduleId: string): string {
  return `auction-schedule:${String(scheduleId || '').trim()}`;
}

export function calculateAuctionScheduleWinningFee(winningPrice: unknown): number {
  const amount = Number(String(winningPrice || '').replace(/[^0-9]/g, ''));
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.max(Math.round(amount * 0.01), 2_200_000);
}

export function isAuctionScheduleActivityType(value: string): value is AuctionScheduleActivityType {
  return (AUCTION_SCHEDULE_ACTIVITY_TYPES as readonly string[]).includes(value);
}

export function sanitizeAuctionScheduleData(value: unknown): Record<string, unknown> {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const {
    timeFrom: _timeFrom,
    timeTo: _timeTo,
    fieldCheckIn: _fieldCheckIn,
    fieldCheckOut: _fieldCheckOut,
    ...scheduleData
  } = source;
  return scheduleData;
}

export function canViewSuggestedBidPrice(role: string): boolean {
  return ['master', 'ceo', 'cc_ref', 'admin'].includes(String(role || ''));
}

export function canViewResignedAuctionHistory(role: string): boolean {
  return ['master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst']
    .includes(String(role || ''));
}

export function redactSuggestedBidPrice(
  activityType: string,
  data: Record<string, unknown>,
  canView: boolean,
): Record<string, unknown> {
  if (canView || activityType !== '입찰' || !Object.prototype.hasOwnProperty.call(data, 'suggestedPrice')) {
    return data;
  }
  const { suggestedPrice: _suggestedPrice, ...rest } = data;
  return rest;
}

export function getAuctionScheduleValidationError(
  activityType: string,
  data: Record<string, unknown>,
): string | null {
  const text = (key: string) => String(data[key] || '').trim();
  if (activityType === '입찰' && (
    !text('caseNo') || !text('court') || !(text('client') || text('bidder')) || !text('propertyType')
  )) return '입찰은 사건번호·법원·계약자명·물건종류를 입력해 주세요.';
  if (activityType === '임장' && (
    !text('caseNo') || !text('court') || !text('propertyType') || !(text('client') || text('inspEtcReason'))
  )) return '임장은 사건번호·법원·대상·물건종류를 입력해 주세요.';
  if (activityType === '미팅' && (!text('client') || (!data.internalMeeting && !text('place')))) {
    return '미팅은 계약자명과 장소를 입력해 주세요.';
  }
  return null;
}

export function getCalendarRowWeekNumber(date: Date): number {
  return Math.ceil((date.getDate() + new Date(date.getFullYear(), date.getMonth(), 1).getDay()) / 7);
}

export function getKoreanWeekLabel(date: Date): string {
  const names = ['첫째', '둘째', '셋째', '넷째', '다섯째', '여섯째'];
  const week = getCalendarRowWeekNumber(date);
  return `${date.getMonth() + 1}월 ${names[week - 1] || `${week}째`} 주`;
}
