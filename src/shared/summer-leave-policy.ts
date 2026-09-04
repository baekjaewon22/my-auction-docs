const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export const SUMMER_LEAVE_REQUEST_PERIOD_ERROR =
  '여름 특별휴가는 매년 7~8월에만 신청할 수 있습니다. 9월부터는 사용이 불가합니다.';

export const SUMMER_LEAVE_USAGE_PERIOD_ERROR =
  '여름 특별휴가와 연결 연차는 모두 7~8월 안에서만 사용할 수 있습니다.';

export const SUMMER_LEAVE_SPECIAL_USAGE_PERIOD_ERROR =
  '여름 특별휴가는 사용 기간도 7~8월 안으로만 지정할 수 있습니다.';

/**
 * 여름휴가 신청 가능 여부를 한국 표준시 기준으로 판단한다.
 * `now`는 실제 시각(UTC timestamp)을 받으며, 테스트에서 경계 시각을 주입할 수 있다.
 */
export function isSummerLeaveRequestPeriod(now: Date = new Date()): boolean {
  if (Number.isNaN(now.getTime())) return false;
  const kstMonth = new Date(now.getTime() + KST_OFFSET_MS).getUTCMonth() + 1;
  return kstMonth >= 7 && kstMonth <= 9;
}

/** 여름휴가와 연결 연차의 사용일이 7~9월에 속하는지 판단한다. */
export function isSummerLeaveUsageDate(value: unknown): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').slice(0, 10));
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return false;

  return month >= 7 && month <= 9;
}
