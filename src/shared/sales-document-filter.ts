export type SalesDocumentFilter = '' | 'registered' | 'missing' | 'waiting';

type SalesDocumentRecord = {
  type?: string | null;
  contract_submitted?: number | boolean | null;
  contract_not_submitted?: number | boolean | null;
  contract_not_approved?: number | boolean | null;
};

export const SALES_DOCUMENT_FILTER_OPTIONS: Array<{ value: SalesDocumentFilter; label: string }> = [
  { value: '', label: '계약서/물건분석보고서 전체' },
  { value: 'registered', label: '등록' },
  { value: 'missing', label: '미작성' },
  { value: 'waiting', label: '확인대기' },
];

export function matchesSalesDocumentFilter(record: SalesDocumentRecord, filter: SalesDocumentFilter): boolean {
  if (!filter) return true;
  if (record.type !== '계약' && record.type !== '낙찰') return false;

  const submitted = !!record.contract_submitted;
  const notSubmitted = !!record.contract_not_submitted;
  const approved = !!record.contract_not_approved;

  if (filter === 'registered') return submitted && approved;
  if (filter === 'waiting') return submitted && !approved;
  if (filter === 'missing') return notSubmitted && !approved;
  return true;
}
