export const JEONG_MINHO_AUCTION_RESULT_USER_ID = '2b6b3606-e425-4361-a115-9283cfef842f';

export interface AuctionBidResultActor {
  id?: string | null;
  sub?: string | null;
  role?: string | null;
}

/**
 * 입찰 결과/가격 입력 전용 권한이다. 일반 경매 일정의 수정·삭제 권한과
 * 의도적으로 분리해 총무나 지사장이 일정 원문까지 고치지 못하게 한다.
 */
export function canManageAuctionBidResult(
  actor: AuctionBidResultActor | null | undefined,
  ownerId: string | null | undefined,
): boolean {
  if (!actor || !ownerId) return false;
  const actorId = String(actor.sub || actor.id || '').trim();
  if (!actorId) return false;
  return actorId === String(ownerId).trim()
    || actor.role === 'master'
    || actor.role === 'accountant'
    || actorId === JEONG_MINHO_AUCTION_RESULT_USER_ID;
}

export function normalizeAuctionBidIdentity(value: unknown): string {
  return String(value || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

export function canonicalAuctionBidGroupMarker(court: unknown, caseNo: unknown): string {
  return `${normalizeAuctionBidIdentity(court)}|${normalizeAuctionBidIdentity(caseNo)}`;
}

export function canonicalAuctionBidItemMarker(itemNo: unknown): string {
  return normalizeAuctionBidIdentity(itemNo).replace(/[^0-9]/g, '');
}

export function auctionBidItemNumbersCompatible(left: unknown, right: unknown): boolean {
  const normalizedLeft = canonicalAuctionBidItemMarker(left);
  const normalizedRight = canonicalAuctionBidItemMarker(right);
  return normalizedLeft === normalizedRight || !normalizedLeft || !normalizedRight;
}

export function inspectionMaterializedBidId(inspectionId: string): string {
  return `inspection-bid:${String(inspectionId || '').trim()}`;
}
