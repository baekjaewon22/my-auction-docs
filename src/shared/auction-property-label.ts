export const UNKNOWN_AUCTION_PROPERTY_DETAIL = '미분류';

/**
 * 캘린더와 대시보드에는 대분류(propertyCategory)를 노출하지 않고
 * 세부 물건종류(propertyType)만 표시한다.
 */
export function auctionPropertyDetailLabel(propertyType: unknown): string {
  const detail = String(propertyType || '').trim();
  return detail || UNKNOWN_AUCTION_PROPERTY_DETAIL;
}
