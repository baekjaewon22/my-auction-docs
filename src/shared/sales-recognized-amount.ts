import { salesDisplayAmount } from './sales-vat-view.ts';

export interface RecognizedSalesAmountRecord {
  type?: string | null;
  amount?: number | null;
  proxy_cost?: number | null;
}

/**
 * 업무성과 합계용 금액.
 * 매수신청대리는 고객 결제액 전체가 아니라 공급가액에서 실제 대리비용을 뺀 회사 몫만 매출로 본다.
 * 환불 기여액은 같은 회사 몫 비율로 환불 승인월에 차감한다.
 */
export function recognizedSalesContribution(
  record: RecognizedSalesAmountRecord,
  rawContribution: number,
  excludeVatView: boolean,
): number {
  const contribution = Number(rawContribution) || 0;
  if (record.type !== '매수신청대리') return salesDisplayAmount(contribution, excludeVatView);

  const grossAmount = Math.max(0, Number(record.amount) || 0);
  if (grossAmount <= 0 || contribution === 0) return 0;
  const companyRevenue = Math.max(0, Math.round(grossAmount / 1.1) - Math.max(0, Number(record.proxy_cost) || 0));
  if (contribution === grossAmount) return companyRevenue;
  if (contribution === -grossAmount) return -companyRevenue;
  return Math.round(companyRevenue * contribution / grossAmount);
}
