import { effectiveSalesStatus, recognizedSalesDate, type SalesRecognitionRecord } from './sales-recognition.ts';

export type SalesMonthlyEntryKind = 'sale' | 'refund' | 'net' | 'none';

export interface SalesMonthlyReportingRecord extends SalesRecognitionRecord {
  amount?: number | null;
  refund_amount?: number | null;
  refund_approved_at?: string | null;
}

export interface SalesMonthlyContribution {
  period_sale_amount: number;
  period_refund_amount: number;
  period_net_amount: number;
  period_confirmed_amount: number;
  period_card_pending_amount: number;
  period_pending_amount: number;
  period_sale_status: string;
  period_entry_kind: SalesMonthlyEntryKind;
  period_display_date: string;
}

function dateOnly(value: unknown): string {
  return String(value || '').trim().slice(0, 10);
}

function inPeriod(value: string, fromDate: string, toDate: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= fromDate && value <= toDate;
}

export function monthlySalesContribution(
  record: SalesMonthlyReportingRecord,
  fromDate: string,
  toDate: string,
): SalesMonthlyContribution {
  const amount = Math.trunc(Number(record.amount) || 0);
  const refundAmount = Math.max(0, Math.trunc(Number(record.refund_amount) || 0));
  const originalDate = dateOnly(recognizedSalesDate(record)) || dateOnly(record.contract_date);
  const refundDate = dateOnly(record.refund_approved_at);
  const saleIncluded = inPeriod(originalDate, fromDate, toDate);
  const refundIncluded = refundAmount > 0 && inPeriod(refundDate, fromDate, toDate);
  const persistedStatus = String(record.status || 'pending');
  const saleStatus = effectiveSalesStatus(
    persistedStatus === 'refunded' || persistedStatus === 'refund_requested'
      ? { ...record, status: 'confirmed' }
      : record,
  );
  const saleAmount = saleIncluded ? amount : 0;
  const periodRefundAmount = refundIncluded ? refundAmount : 0;
  const bucketAmount = saleAmount - periodRefundAmount;

  return {
    period_sale_amount: saleAmount,
    period_refund_amount: periodRefundAmount,
    period_net_amount: bucketAmount,
    period_confirmed_amount: saleStatus === 'confirmed' ? bucketAmount : 0,
    period_card_pending_amount: saleStatus === 'card_pending' ? bucketAmount : 0,
    period_pending_amount: saleStatus === 'pending' ? bucketAmount : 0,
    period_sale_status: String(saleStatus),
    period_entry_kind: saleIncluded && refundIncluded ? 'net' : refundIncluded ? 'refund' : saleIncluded ? 'sale' : 'none',
    period_display_date: refundIncluded && !saleIncluded ? refundDate : originalDate,
  };
}
