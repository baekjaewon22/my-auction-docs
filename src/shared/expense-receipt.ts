export const EXPENSE_RECEIPT_TEMPLATE_ID = 'tpl-exp-receipt-001' as const;
export const EXPENSE_RECEIPT_REPRESENTATIVE_STAMP = '/LNCstemp.png' as const;
export const EXPENSE_RECEIPT_PAYMENT_METHODS = ['계좌이체', '법인카드', '현금'] as const;

export function isEligibleExpenseReceiptAlimtalkRecipient(recipient: {
  role: string;
  approved: number;
  login_type?: string;
} | undefined): boolean {
  return !!recipient
    && Number(recipient.approved) === 1
    && (recipient.role === 'accountant' || recipient.role === 'accountant_asst')
    && String(recipient.login_type || 'employee') !== 'freelancer';
}

export const EXPENSE_RECEIPT_DELEGATE_ROLES = [
  'accountant',
  'accountant_asst',
] as const;

const EXPENSE_RECEIPT_ACTION_ROLE_SET = new Set<string>([
  'master',
  'ceo',
  ...EXPENSE_RECEIPT_DELEGATE_ROLES,
]);

export function isExpenseReceiptTemplate(templateId: string | null | undefined): boolean {
  return templateId === EXPENSE_RECEIPT_TEMPLATE_ID;
}

/**
 * Accounting roles act from the submission-time delegate snapshot. The CEO may
 * act only when they own the current representative step, while master remains
 * an emergency proxy. Submission Alimtalk still targets the accountant only.
 */
export function canActOnExpenseReceipt(role: string | null | undefined): boolean {
  return !!role && EXPENSE_RECEIPT_ACTION_ROLE_SET.has(role);
}

export function shouldSendExpenseReceiptAlimtalk(role: string | null | undefined): boolean {
  return role === 'accountant';
}

export function expenseReceiptApprovalAlertTemplateScope(
  role: string | null | undefined,
  requestedTemplateId?: string,
): string {
  // The accounting assistant is an approval delegate only for receipt-backed
  // expense requests. Keep the web inbox constrained even if another workflow
  // accidentally creates a generic approval alert for that account.
  if (role === 'accountant_asst') return EXPENSE_RECEIPT_TEMPLATE_ID;
  return String(requestedTemplateId || '').trim();
}

export function canReceiveExpenseReceiptApprovalAlert(user: {
  role?: string;
  login_type?: string;
  auth_type?: string;
  sub?: string;
}): boolean {
  if (user.auth_type !== 'user' || String(user.sub || '').startsWith('service-token:')) return false;
  if (user.login_type === 'freelancer') return false;
  return user.role === 'master' || user.role === 'ceo' || EXPENSE_RECEIPT_DELEGATE_ROLES.includes(
    user.role as (typeof EXPENSE_RECEIPT_DELEGATE_ROLES)[number],
  );
}

export type ExpenseReceiptEditDecision =
  | { allowed: true }
  | { allowed: false; status: 400 | 403; error: string };

export function evaluateExpenseReceiptEditPolicy(input: {
  authType?: string;
  actorId: string;
  actorRole: string;
  authorId: string;
  documentStatus: string;
}): ExpenseReceiptEditDecision {
  if (input.authType !== 'user') {
    return { allowed: false, status: 403, error: '영수증 첨부 신청서는 사용자 로그인으로만 수정할 수 있습니다.' };
  }
  if (!['draft', 'rejected'].includes(input.documentStatus)) {
    return { allowed: false, status: 400, error: '제출된 영수증 첨부 신청서의 내용은 수정할 수 없습니다.' };
  }
  if (input.actorId !== input.authorId && input.actorRole !== 'master') {
    return { allowed: false, status: 403, error: '영수증 첨부 신청서를 수정할 권한이 없습니다.' };
  }
  return { allowed: true };
}

export function hasExpenseReceiptDraftChanged(
  current: { title: string; content: string },
  next: { title: string; content: string },
): boolean {
  return current.title !== next.title || current.content !== next.content;
}

export interface ExpenseReceiptItem {
  id: string;
  description: string;
  amount: number;
  note: string;
}

export interface ExpenseReceiptContent {
  version: 1;
  draft_date: string;
  author_name: string;
  department: string;
  position_title: string;
  purpose: string;
  expense_date: string;
  payment_method: string;
  case_number: string;
  client_name: string;
  deposit_date: string;
  deposit_amount: number;
  bank_name: string;
  account_number: string;
  account_holder: string;
  account_note: string;
  items: ExpenseReceiptItem[];
  total_amount: number;
}

export interface ExpenseReceiptAuthorSnapshot {
  name: string;
  department: string;
  position_title: string;
}

export class ExpenseReceiptContentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpenseReceiptContentError';
  }
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function requiredText(value: unknown, label: string, maxLength: number): string {
  const text = String(value ?? '').trim();
  if (!text) throw new ExpenseReceiptContentError(`${label}을(를) 입력해주세요.`);
  if (text.length > maxLength) throw new ExpenseReceiptContentError(`${label}이(가) 너무 깁니다.`);
  return text;
}

export function canonicalizeExpenseReceiptContent(
  rawContent: string,
  author: ExpenseReceiptAuthorSnapshot,
  today: string,
): ExpenseReceiptContent {
  let raw: Record<string, unknown>;
  try {
    const parsed = JSON.parse(rawContent || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    raw = parsed as Record<string, unknown>;
  } catch {
    throw new ExpenseReceiptContentError('영수증 첨부 신청서 내용을 확인할 수 없습니다. 다시 저장해주세요.');
  }

  const purpose = requiredText(raw.purpose, '지출 목적', 500);
  // 지출 예정일은 선택 입력(입력란 제거됨). 유효한 날짜가 아니면 빈 값으로 정규화한다.
  const expenseDateRaw = String(raw.expense_date ?? '').trim();
  const expenseDate = validDate(expenseDateRaw) ? expenseDateRaw : '';
  const paymentMethod = requiredText(raw.payment_method, '결제 수단', 50);
  if (!(EXPENSE_RECEIPT_PAYMENT_METHODS as readonly string[]).includes(paymentMethod)) {
    throw new ExpenseReceiptContentError('결제 수단은 계좌이체, 법인카드, 현금 중에서 선택해주세요.');
  }
  // 선택 입력 필드 (사건번호·고객명·입금일·입금액). 프런트 직렬화와 동일하게 정규화한다.
  const caseNumber = String(raw.case_number ?? '').trim().slice(0, 50);
  const clientName = String(raw.client_name ?? '').trim().slice(0, 100);
  const depositDateRaw = String(raw.deposit_date ?? '').trim();
  const depositDate = validDate(depositDateRaw) ? depositDateRaw : '';
  const depositAmount = Math.max(0, Number(String(raw.deposit_amount ?? '').replace(/[^\d]/g, '')) || 0);
  const bankName = String(raw.bank_name ?? '').trim().slice(0, 50);
  const accountNumber = String(raw.account_number ?? '').trim().slice(0, 50);
  const accountHolder = String(raw.account_holder ?? '').trim().slice(0, 50);
  const accountNote = String(raw.account_note ?? '').trim().slice(0, 500);
  const rawItems = (Array.isArray(raw.items) ? raw.items : []).filter((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return true;
    const item = candidate as Record<string, unknown>;
    const description = String(item.description ?? '').trim();
    const note = String(item.note ?? '').trim();
    const rawAmount = item.amount;
    const amountIsBlank = rawAmount === null
      || rawAmount === undefined
      || String(rawAmount).trim() === ''
      || Number(rawAmount) === 0;
    return !!description || !!note || !amountIsBlank;
  });
  if (rawItems.length < 1) throw new ExpenseReceiptContentError('지출 내역을 1건 이상 입력해주세요.');
  if (rawItems.length > 100) throw new ExpenseReceiptContentError('지출 내역은 최대 100건까지 입력할 수 있습니다.');

  const items = rawItems.map((candidate, index): ExpenseReceiptItem => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new ExpenseReceiptContentError(`${index + 1}번째 지출 내역을 확인해주세요.`);
    }
    const item = candidate as Record<string, unknown>;
    const description = requiredText(item.description, `${index + 1}번째 사용 내용`, 300);
    const amount = Number(item.amount);
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new ExpenseReceiptContentError(`${index + 1}번째 금액을 1원 이상의 정수로 입력해주세요.`);
    }
    return {
      id: String(item.id || `item-${index + 1}`).slice(0, 100),
      description,
      amount,
      note: String(item.note ?? '').trim().slice(0, 500),
    };
  });
  const totalAmount = items.reduce((sum, item) => sum + item.amount, 0);
  if (!Number.isSafeInteger(totalAmount)) {
    throw new ExpenseReceiptContentError('합계 금액이 허용 범위를 초과했습니다.');
  }

  const requestedDraftDate = String(raw.draft_date || '').trim();
  return {
    version: 1,
    draft_date: validDate(requestedDraftDate) ? requestedDraftDate : today,
    author_name: String(author.name || '').trim(),
    department: String(author.department || '').trim(),
    position_title: String(author.position_title || '').trim(),
    purpose,
    expense_date: expenseDate,
    payment_method: paymentMethod,
    case_number: caseNumber,
    client_name: clientName,
    deposit_date: depositDate,
    deposit_amount: depositAmount,
    bank_name: bankName,
    account_number: accountNumber,
    account_holder: accountHolder,
    account_note: accountNote,
    items,
    total_amount: totalAmount,
  };
}
