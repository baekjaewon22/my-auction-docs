const SALES_ATTRIBUTION_BRANCH_BY_NAME: Readonly<Record<string, string>> = {
  '서정수': '의정부본사',
};

export function resolveSalesAttributionBranch(
  ownerName: string | null | undefined,
  fallbackBranch = '',
): string {
  const normalizedName = String(ownerName || '').trim();
  return SALES_ATTRIBUTION_BRANCH_BY_NAME[normalizedName] || fallbackBranch;
}
