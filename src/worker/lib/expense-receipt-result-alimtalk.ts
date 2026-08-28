import {
  AlimtalkHttpError,
  APP_URL,
  normalizePhone,
  sendAlimtalkByTemplate,
  type AlimtalkSendResponse,
} from '../alimtalk.ts';

export type ExpenseReceiptResultAction = 'approved' | 'rejected';

export const EXPENSE_RECEIPT_RESULT_RELATED_TYPES = {
  approved: 'expense_receipt_result_approved',
  rejected: 'expense_receipt_result_rejected',
} as const;

type ExpenseReceiptResultEnv = Record<string, unknown> & { DB: D1Database };
type SendTemplate = typeof sendAlimtalkByTemplate;

export interface ExpenseReceiptResultAlimtalkInput {
  action: ExpenseReceiptResultAction;
  documentId: string;
  approvalStepId: string;
  decisionDate: string;
  phone: string;
}

export type ExpenseReceiptResultAlimtalkOutcome =
  | { status: 'dedicated' }
  | { status: 'fallback' }
  | { status: 'skipped'; reason: 'invalid_phone' | 'already_sent_or_not_configured' };

const TEMPLATE_NOT_FOUND_CODE = '3015';
const CONFIRMED_TEMPLATE_UNAVAILABLE_PATTERN = /(?:TemplateNotFoundException|template\s+(?:not\s+found|not\s+registered|not\s+approved|inactive)|템플릿.{0,24}(?:찾을\s*수\s*없|미등록|미승인|승인되지|비활성))/i;

function isConfirmedUnavailableDescriptor(value: unknown): boolean {
  const text = String(value || '');
  return new RegExp(`(?:^|[^0-9])${TEMPLATE_NOT_FOUND_CODE}(?:[^0-9]|$)`).test(text)
    || CONFIRMED_TEMPLATE_UNAVAILABLE_PATTERN.test(text);
}

export function isConfirmedAlimtalkTemplateUnavailableError(error: unknown): boolean {
  if (!(error instanceof AlimtalkHttpError)) return false;
  if (error.httpStatus === 408 || error.httpStatus === 429 || error.httpStatus >= 500) return false;
  if (error.httpStatus < 400 || error.httpStatus >= 500) return false;
  return isConfirmedUnavailableDescriptor(error.responseBody);
}

export function isConfirmedAlimtalkTemplateUnavailableResponse(
  response: AlimtalkSendResponse,
): boolean {
  const descriptors: unknown[] = [response.statusCode, response.statusName, response.statusDesc];
  for (const message of response.messages || []) {
    descriptors.push(
      message.requestStatusCode,
      message.requestStatusName,
      message.requestStatusDesc,
    );
  }
  return descriptors.some(isConfirmedUnavailableDescriptor);
}

function immediateFailureDescription(response: AlimtalkSendResponse): string | null {
  if (String(response.statusCode || '') !== '202' || /(?:fail|error|실패)/i.test(response.statusName || '')) {
    return [response.statusCode, response.statusName, response.statusDesc]
      .filter(Boolean)
      .join(' ')
      .slice(0, 300);
  }
  const requestFailed = (response.messages || []).find(
    (message) => message.requestStatusCode && message.requestStatusCode !== 'A000',
  );
  if (requestFailed) {
    return [
      requestFailed.requestStatusCode,
      requestFailed.requestStatusName,
      requestFailed.requestStatusDesc,
    ].filter(Boolean).join(' ').slice(0, 300);
  }
  const failed = (response.messages || []).find(
    (message) => message.messageStatusCode && message.messageStatusCode !== '0000',
  );
  if (!failed) return null;
  return [failed.messageStatusCode, failed.messageStatusName, failed.messageStatusDesc]
    .filter(Boolean)
    .join(' ')
    .slice(0, 300);
}

export function normalizeExpenseReceiptResultPhone(phone: string): string | null {
  const normalized = normalizePhone(String(phone || ''));
  return /^010[0-9]{8}$/.test(normalized) ? normalized : null;
}

function assertResultEvent(input: ExpenseReceiptResultAlimtalkInput): void {
  if (!input.documentId.trim() || !input.approvalStepId.trim()) {
    throw new Error('영수증 지출결의 결과 알림 event id가 없습니다.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.decisionDate)) {
    throw new Error('영수증 지출결의 결과 알림 처리일 형식이 올바르지 않습니다.');
  }
}

export async function sendExpenseReceiptResultAlimtalk(
  env: ExpenseReceiptResultEnv,
  input: ExpenseReceiptResultAlimtalkInput,
  dependencies: { send?: SendTemplate } = {},
): Promise<ExpenseReceiptResultAlimtalkOutcome> {
  assertResultEvent(input);
  const phone = normalizeExpenseReceiptResultPhone(input.phone);
  if (!phone) return { status: 'skipped', reason: 'invalid_phone' };

  const send = dependencies.send || sendAlimtalkByTemplate;
  const relatedType = EXPENSE_RECEIPT_RESULT_RELATED_TYPES[input.action];
  const relatedId = `${input.documentId}:${input.approvalStepId}`;
  const link = `${APP_URL}/expense-receipts/${encodeURIComponent(input.documentId)}`;
  const sendOptions = {
    db: env.DB,
    relatedType,
    relatedId,
    dedupeAcrossTemplates: true,
  } as const;

  const dedicatedKey = input.action === 'approved'
    ? 'EXPENSE_RECEIPT_APPROVED'
    : 'EXPENSE_RECEIPT_REJECTED';
  const dedicatedVariables: Record<string, string> = input.action === 'approved'
    ? { approve_date: input.decisionDate, link }
    : { reject_date: input.decisionDate, link };

  let dedicatedResult: AlimtalkSendResponse | null;
  let confirmedUnavailable = false;
  try {
    dedicatedResult = await send(env, dedicatedKey, dedicatedVariables, [phone], sendOptions);
  } catch (error) {
    if (!isConfirmedAlimtalkTemplateUnavailableError(error)) throw error;
    confirmedUnavailable = true;
    dedicatedResult = null;
  }

  if (dedicatedResult && isConfirmedAlimtalkTemplateUnavailableResponse(dedicatedResult)) {
    confirmedUnavailable = true;
  } else if (dedicatedResult) {
    const failure = immediateFailureDescription(dedicatedResult);
    if (failure) throw new Error(`영수증 지출결의 전용 알림톡 발송 실패: ${failure}`);
    return { status: 'dedicated' };
  }
  if (!confirmedUnavailable) {
    return { status: 'skipped', reason: 'already_sent_or_not_configured' };
  }

  // Only an explicit template-not-found/unapproved response may use a generic
  // template. Timeouts, rate limits, server failures and ambiguous null results
  // return or throw above without risking an immediate duplicate message.
  const fallbackKey = input.action === 'approved' ? 'DOC_FINAL_APPROVED' : 'DOC_REJECTED';
  const fallbackVariables: Record<string, string> = input.action === 'approved'
    ? {
        doc_title: '영수증 첨부 지출결의서',
        approver_name: '결재담당자',
        approve_date: input.decisionDate,
      }
    : {
        doc_title: '영수증 첨부 지출결의서',
        rejector_name: '결재담당자',
        reject_reason: '반려 사유는 문서에서 확인해주세요.',
        link,
      };
  const fallbackResult = await send(env, fallbackKey, fallbackVariables, [phone], sendOptions);
  if (!fallbackResult) return { status: 'skipped', reason: 'already_sent_or_not_configured' };
  const failure = immediateFailureDescription(fallbackResult);
  if (failure) throw new Error(`영수증 지출결의 대체 알림톡 발송 실패: ${failure}`);
  return { status: 'fallback' };
}
