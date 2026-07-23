export function dashboardFocusKey(type: string, id: string): string {
  return type && id ? `${type}-${id}` : '';
}

export function shouldPrepareDashboardFocus(preparedKey: string, nextKey: string): boolean {
  return Boolean(nextKey) && preparedKey !== nextKey;
}
