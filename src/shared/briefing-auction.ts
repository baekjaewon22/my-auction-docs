import { winningAuctionKind, type WinningAuctionKind } from './winning-auction.ts';

export function briefingCaseNumber(kind: WinningAuctionKind, year: string, number: string): string {
  const value = number.trim().replace(/\s+/g, '');
  return kind === 'public' ? value : value ? `${year}타경${value}` : '';
}

export function normalizeBriefingAuction(input: { auction_kind?: unknown; court?: unknown; case_number?: unknown; item_no?: unknown }) {
  const auctionKind = winningAuctionKind(input.auction_kind);
  return {
    auctionKind,
    court: auctionKind === 'public' ? '' : String(input.court || '').trim(),
    caseNumber: String(input.case_number || '').trim().replace(/\s+/g, ''),
    itemNo: auctionKind === 'public' ? '' : String(input.item_no || '').trim(),
  };
}

export function briefingAuctionError(input: ReturnType<typeof normalizeBriefingAuction>): string {
  if (!input.caseNumber) return input.auctionKind === 'public' ? '공매 물건번호를 입력하세요.' : '사건번호를 입력하세요.';
  if (input.caseNumber.length > 100) return '번호는 100자 이내로 입력하세요.';
  if (input.auctionKind !== 'public' && !input.court) return '법원을 입력하세요.';
  return '';
}
