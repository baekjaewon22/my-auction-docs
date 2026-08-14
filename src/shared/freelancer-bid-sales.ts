export type WonSalesInput = {
  winning_price: number;
  sales_amount: number;
  depositor_name: string;
  payment_type: '이체' | '카드';
};

function positiveInteger(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.trunc(numeric);
}

export function freelancerBidSalesExternalId(bidId: string): string {
  return `freelancer-bid:${String(bidId || '').trim()}`;
}

export function normalizeWonSalesInput(input: {
  actual_bid_price?: unknown;
  sales_amount?: unknown;
  depositor_name?: unknown;
  payment_type?: unknown;
}): WonSalesInput | null {
  const winningPrice = positiveInteger(input.actual_bid_price);
  const salesAmount = positiveInteger(input.sales_amount);
  const depositorName = String(input.depositor_name || '').trim();
  if (!winningPrice || !salesAmount || !depositorName) return null;
  return {
    winning_price: winningPrice,
    sales_amount: salesAmount,
    depositor_name: depositorName,
    payment_type: input.payment_type === '카드' ? '카드' : '이체',
  };
}
