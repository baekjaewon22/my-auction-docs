export const REFUND_REQUEST_CANCEL_ROLES = ['master', 'ceo', 'accountant'] as const;
export const REFUND_COMPLETED_REVERT_ROLES = ['master', 'ceo', 'accountant'] as const;

export type RefundRequestCancelRole = typeof REFUND_REQUEST_CANCEL_ROLES[number];
export type RefundCompletedRevertRole = typeof REFUND_COMPLETED_REVERT_ROLES[number];

export function canCancelSalesRefundRequest(role: string | null | undefined): role is RefundRequestCancelRole {
  return (REFUND_REQUEST_CANCEL_ROLES as readonly string[]).includes(String(role || ''));
}

export function canRevertCompletedSalesRefund(role: string | null | undefined): role is RefundCompletedRevertRole {
  return (REFUND_COMPLETED_REVERT_ROLES as readonly string[]).includes(String(role || ''));
}

export function restoredSalesStatusAfterRefundRequestCancel(record: {
  payment_type?: string | null;
  payment_method?: string | null;
  card_deposit_date?: string | null;
}): 'confirmed' | 'card_pending' {
  const paymentType = String(record.payment_type || record.payment_method || '');
  const cardDepositDate = String(record.card_deposit_date || '').trim();
  return paymentType === '카드' && !cardDepositDate ? 'card_pending' : 'confirmed';
}

export const restoredSalesStatusAfterRefundRevert = restoredSalesStatusAfterRefundRequestCancel;
