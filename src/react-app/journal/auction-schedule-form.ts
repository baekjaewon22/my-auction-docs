import type { ActivityType } from './types';

export function auctionScheduleEditBaseData(
  initialActivityType: ActivityType | undefined,
  nextActivityType: ActivityType,
  initialData: Record<string, unknown>,
): Record<string, unknown> {
  return initialActivityType === nextActivityType ? { ...initialData } : {};
}
