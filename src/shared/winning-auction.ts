export type WinningAuctionKind = 'court' | 'public';

export function winningAuctionKind(kind: unknown, detail: unknown = ''): WinningAuctionKind {
  return kind === 'public' || String(detail || '').startsWith('[공매]') ? 'public' : 'court';
}

export function winningAuctionDetail(input: {
  auctionKind?: unknown; court?: unknown; caseNumber?: unknown; propertyType?: unknown;
}, note: unknown = ''): string {
  const publicAuction = winningAuctionKind(input.auctionKind) === 'public';
  return [
    publicAuction ? '[공매]' : '[경매]',
    publicAuction ? '' : String(input.court || '').trim(),
    `${publicAuction ? '물건번호' : '사건번호'}: ${String(input.caseNumber || '').trim()}`,
    input.propertyType ? `물건종류: ${String(input.propertyType).trim()}` : '',
    String(note || '').trim(),
  ].filter(Boolean).join(' · ');
}
