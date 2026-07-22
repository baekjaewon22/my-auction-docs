export type SalesRecognitionStatus =
  | 'pending'
  | 'card_pending'
  | 'confirmed'
  | 'refund_requested'
  | 'refunded'
  | string;

export interface SalesRecognitionRecord {
  status?: SalesRecognitionStatus | null;
  payment_type?: string | null;
  card_deposit_date?: string | null;
  deposit_date?: string | null;
  contract_date?: string | null;
}

export function isCardPayment(record: Pick<SalesRecognitionRecord, 'payment_type'>): boolean {
  return String(record.payment_type || '').trim() === '카드';
}

export function hasCardSettlementDate(
  record: Pick<SalesRecognitionRecord, 'card_deposit_date'>,
): boolean {
  return String(record.card_deposit_date || '').trim().length > 0;
}

/**
 * Refund and pre-confirmation states are preserved. Once a card payment enters
 * the confirmed/card-pending stage, its settlement date is the sole source of
 * truth, regardless of product type or a stale persisted status value.
 */
export function effectiveSalesStatus(record: SalesRecognitionRecord): SalesRecognitionStatus {
  const status = String(record.status || 'pending');
  if (status === 'card_pending' && !isCardPayment(record)) return 'confirmed';
  if (!isCardPayment(record) || !['confirmed', 'card_pending'].includes(status)) return status;
  return hasCardSettlementDate(record) ? 'confirmed' : 'card_pending';
}

export function isConfirmedSale(record: SalesRecognitionRecord): boolean {
  return effectiveSalesStatus(record) === 'confirmed';
}

export function recognizedSalesDate(record: SalesRecognitionRecord): string {
  if (isCardPayment(record)) return String(record.card_deposit_date || '').trim();
  return String(record.deposit_date || record.contract_date || '').trim();
}

export function normalizeSalesRecognition<T extends SalesRecognitionRecord>(record: T): T {
  return { ...record, status: effectiveSalesStatus(record) } as T;
}
