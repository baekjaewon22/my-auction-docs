export type WithholdingSettlementCategory = '연말정산' | '중도정산';

export type WithholdingSettlementItem = {
  type: string;
  category: WithholdingSettlementCategory;
  /** 세무사 급여대장 부호: 환급은 음수, 추징은 양수 */
  amount: number;
  memo?: string;
};

export function normalizeWithholdingSettlements(value: unknown): WithholdingSettlementItem[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((raw): WithholdingSettlementItem[] => {
    if (!raw || typeof raw !== 'object') return [];
    const source = raw as Record<string, unknown>;
    const amount = Number(source.amount);
    if (!Number.isFinite(amount)) return [];

    const category: WithholdingSettlementCategory = source.category === '연말정산'
      ? '연말정산'
      : '중도정산';
    const type = String(source.type || '소득세').trim() || '소득세';
    const memo = String(source.memo || '').trim();

    return [{
      type,
      category,
      amount: Math.trunc(amount),
      ...(memo ? { memo } : {}),
    }];
  });
}

/** B = Σ(-amount): 환급은 이체액 증가, 추징은 이체액 감소 */
export function withholdingSettlementAdjustment(items: readonly WithholdingSettlementItem[]): number {
  return items.reduce((sum, item) => sum - Math.trunc(Number(item.amount) || 0), 0);
}

export function actualTransferAmount(payrollNetPay: number, items: readonly WithholdingSettlementItem[]): number {
  return Math.trunc(Number(payrollNetPay) || 0) + withholdingSettlementAdjustment(items);
}

export function withholdingSettlementAccountTag(amount: number): '미수금(국세청 환급)' | '예수금(원천세)' | '' {
  if (amount < 0) return '미수금(국세청 환급)';
  if (amount > 0) return '예수금(원천세)';
  return '';
}
