export interface PayrollDeductionItem {
  label: string;
  amount: string;
  isFood?: boolean;
  skipTax?: boolean;
  sourceId?: string;
  [key: string]: unknown;
}

export interface RequiredPayrollDeduction {
  label: string;
  amount: number;
  sourceId: string;
}

export interface PayrollRefundRecovery {
  id: string;
  client_name?: string | null;
  recovery_amount?: number | string | null;
}

export interface PayrollCarryoverDeduction {
  origin_month: string;
  amount: number | string;
}

function positiveMoney(value: unknown): number {
  const parsed = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? Math.max(Math.round(parsed), 0) : 0;
}

function isManagedPayrollDeduction(item: Partial<PayrollDeductionItem>): boolean {
  return !!String(item.sourceId || '');
}

function automaticDeductionKind(label: unknown): 'refund' | 'carryover' | null {
  const normalized = String(label || '').trim();
  if (/^환불\s*회수/.test(normalized)) return 'refund';
  if (/^전월\s*이월\s*공제/.test(normalized)) return 'carryover';
  return null;
}

function legacyRequiredDeduction(
  item: Partial<PayrollDeductionItem>,
  requiredDeductions: RequiredPayrollDeduction[],
): RequiredPayrollDeduction | null {
  if (item.sourceId) return null;
  const kind = automaticDeductionKind(item.label);
  if (!kind) return null;
  const amount = positiveMoney(item.amount);
  const candidates = requiredDeductions.filter(required => (
    (kind === 'carryover' ? required.sourceId === 'carryover' : required.sourceId !== 'carryover')
    && required.amount === amount
  ));
  const exactLabelCandidates = candidates.filter(required => required.label === String(item.label || '').trim());
  return exactLabelCandidates.length === 1 ? exactLabelCandidates[0] : null;
}

export function payrollDeductionTotal(deductions: unknown): number {
  return (Array.isArray(deductions) ? deductions : [])
    .reduce((sum: number, item: any) => sum + positiveMoney(item?.amount), 0);
}

export function buildRequiredPayrollDeductions(input: {
  refundRecoveries?: PayrollRefundRecovery[] | null;
  carryoverDeduction?: PayrollCarryoverDeduction | null;
}): RequiredPayrollDeduction[] {
  const required: RequiredPayrollDeduction[] = [];
  const seen = new Set<string>();

  for (const recovery of input.refundRecoveries || []) {
    const sourceId = String(recovery?.id || '');
    const amount = positiveMoney(recovery?.recovery_amount);
    if (!sourceId || amount <= 0 || seen.has(sourceId)) continue;
    seen.add(sourceId);
    required.push({
      label: `환불 회수 · ${String(recovery.client_name || '').trim() || '고객명 미기재'}`,
      amount,
      sourceId,
    });
  }

  const carryoverAmount = positiveMoney(input.carryoverDeduction?.amount);
  if (input.carryoverDeduction && carryoverAmount > 0) {
    required.push({
      label: `전월 이월 공제 (${input.carryoverDeduction.origin_month})`,
      amount: carryoverAmount,
      sourceId: 'carryover',
    });
  }

  return required;
}

export function isCanonicalRequiredPayrollDeduction(
  deductions: unknown,
  required: RequiredPayrollDeduction,
): boolean {
  if (!Array.isArray(deductions)) return false;
  const matches = deductions.filter((item: any) => String(item?.sourceId || '') === required.sourceId);
  return matches.length === 1
    && positiveMoney(matches[0]?.amount) === required.amount
    && !matches[0]?.isFood
    && !matches[0]?.skipTax;
}

/**
 * 환불 회수와 전월 이월은 사용자가 지우거나 금액/세전 여부를 바꿀 수 없는 자동 세후공제다.
 * 기존 수동 공제는 그대로 두고 자동 공제만 sourceId 기준으로 교체·중복 제거한다.
 */
export function canonicalizePayrollDeductions(
  deductions: unknown,
  requiredDeductions: RequiredPayrollDeduction[],
): PayrollDeductionItem[] {
  const requiredBySource = new Map(requiredDeductions.map(item => [item.sourceId, item]));
  const inserted = new Set<string>();
  const result: PayrollDeductionItem[] = [];

  for (const rawItem of Array.isArray(deductions) ? deductions : []) {
    if (!rawItem || typeof rawItem !== 'object') continue;
    const item = rawItem as PayrollDeductionItem;
    const sourceId = String(item.sourceId || '');
    const required = requiredBySource.get(sourceId)
      || legacyRequiredDeduction(item, requiredDeductions);
    if (required) {
      if (!inserted.has(required.sourceId)) {
        result.push({
          label: required.label,
          amount: String(required.amount),
          sourceId: required.sourceId,
        });
        inserted.add(required.sourceId);
      }
      continue;
    }
    if (isManagedPayrollDeduction(item)) continue;
    result.push({
      ...item,
      label: String(item.label || ''),
      amount: String(item.amount ?? ''),
    });
  }

  for (const required of requiredDeductions) {
    if (inserted.has(required.sourceId)) continue;
    result.push({
      label: required.label,
      amount: String(required.amount),
      sourceId: required.sourceId,
    });
  }

  return result;
}

export function payrollDeductionsAreCanonical(
  deductions: unknown,
  requiredDeductions: RequiredPayrollDeduction[],
): boolean {
  if (!requiredDeductions.every(required => isCanonicalRequiredPayrollDeduction(deductions, required))) {
    return false;
  }
  const requiredSources = new Set(requiredDeductions.map(item => item.sourceId));
  return !(Array.isArray(deductions) ? deductions : []).some((item: any) => {
    const sourceId = String(item?.sourceId || '');
    if (isManagedPayrollDeduction(item)) return !requiredSources.has(sourceId);
    return legacyRequiredDeduction(item, requiredDeductions) !== null;
  });
}
