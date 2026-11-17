export const SALES_EXPORT_ROLES = ['master', 'accountant'] as const;

export function canExportMonthlySales(role: string | null | undefined): boolean {
  return SALES_EXPORT_ROLES.includes(String(role || '') as (typeof SALES_EXPORT_ROLES)[number]);
}

export function salesExportActionLabel(status: string, paymentType = ''): string {
  if (status === 'pending') return '결제 확인 필요';
  if (status === 'card_pending') return '카드 정산 확인 필요';
  if (status === 'refund_requested') return '환불 승인 필요';
  if (status === 'refunded') return '환불 완료';
  if (status === 'confirmed') return paymentType === '카드' ? '카드 정산 완료' : '확정 완료';
  return '-';
}
