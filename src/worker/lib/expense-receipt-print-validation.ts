import { EXPENSE_RECEIPT_TEMPLATE_ID } from '../../shared/expense-receipt.ts';

export type ExpenseReceiptPrintState = {
  ready: boolean;
  error: string | null;
  meta: {
    documentId?: string;
    templateId?: string | null;
    attachmentCount?: number;
  } | null;
  receiptImageCount: number;
  loadedReceiptImageCount: number;
};

/** Fail closed before Puppeteer is allowed to serialize a receipt PDF. */
export function validateExpenseReceiptPrintState(
  expectedDocumentId: string,
  expectedAttachmentCount: number,
  state: ExpenseReceiptPrintState,
): void {
  if (!Number.isSafeInteger(expectedAttachmentCount) || expectedAttachmentCount < 1) {
    throw new Error('영수증 원본이 없어 합본 PDF를 생성할 수 없습니다.');
  }
  if (state.error) throw new Error(`인쇄 리소스 로딩 실패: ${state.error}`);
  if (!state.ready) throw new Error('영수증 인쇄 화면 준비 시간이 초과되었습니다.');
  if (!state.meta || state.meta.documentId !== expectedDocumentId) {
    throw new Error('영수증 인쇄 문서 ID가 요청과 일치하지 않습니다.');
  }
  if (state.meta.templateId !== EXPENSE_RECEIPT_TEMPLATE_ID) {
    throw new Error('영수증 인쇄 템플릿이 요청과 일치하지 않습니다.');
  }
  if (Number(state.meta.attachmentCount) !== expectedAttachmentCount) {
    throw new Error('영수증 인쇄 첨부 수가 서버 원본과 일치하지 않습니다.');
  }
  if (state.receiptImageCount !== expectedAttachmentCount
    || state.loadedReceiptImageCount !== expectedAttachmentCount) {
    throw new Error('영수증 이미지가 모두 로드되지 않아 합본 PDF를 생성하지 않았습니다.');
  }
}
