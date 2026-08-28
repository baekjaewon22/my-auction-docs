export {
  EXPENSE_RECEIPT_PAYMENT_METHODS,
  EXPENSE_RECEIPT_TEMPLATE_ID,
} from '../../shared/expense-receipt.ts';
export const EXPENSE_RECEIPT_MAX_FILES = 10;
export const EXPENSE_RECEIPT_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const EXPENSE_RECEIPT_MAX_TOTAL_BYTES = 40 * 1024 * 1024;
export const EXPENSE_RECEIPT_CLIENT_MAX_IMAGE_DIMENSION = 2400;
export const EXPENSE_RECEIPT_CLIENT_OPTIMIZE_BYTES = 4 * 1024 * 1024;

export type ExpenseReceiptItemDraft = {
  id: string;
  description: string;
  amount: string;
  note: string;
};

export type ExpenseReceiptFormDraft = {
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
  deposit_amount: string;
  bank_name: string;
  account_number: string;
  account_holder: string;
  account_note: string;
  items: ExpenseReceiptItemDraft[];
};

// 서버 canonicalize의 validDate와 동일한 검증 (프런트 직렬화 결과가 서버와 정확히 일치해야 함)
function validExpenseReceiptDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

type UserSnapshot = {
  name?: string;
  department?: string;
  position_title?: string;
};

type FileLike = {
  name: string;
  type: string;
  size: number;
};

export type ExpenseReceiptPendingUploadHash = {
  key: string;
  sha256: string;
  size: number;
};

export type ExpenseReceiptServerAttachmentHash = {
  id: string;
  sha256?: string;
  file_size: number;
};

export type ExpenseReceiptImageTargetSize = {
  width: number;
  height: number;
  resized: boolean;
};

function newItem(index = 0): ExpenseReceiptItemDraft {
  return {
    id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `expense-item-${Date.now()}-${index}`,
    description: '',
    amount: '',
    note: '',
  };
}

function todayKst(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function createExpenseReceiptDraft(user: UserSnapshot = {}): ExpenseReceiptFormDraft {
  return {
    version: 1,
    draft_date: todayKst(),
    author_name: String(user.name || ''),
    department: String(user.department || ''),
    position_title: String(user.position_title || ''),
    purpose: '',
    expense_date: '',
    payment_method: '',
    case_number: '',
    client_name: '',
    deposit_date: '',
    deposit_amount: '',
    bank_name: '',
    account_number: '',
    account_holder: '',
    account_note: '',
    items: [newItem(1), newItem(2), newItem(3)],
  };
}

export function parseExpenseReceiptContent(content: string, user: UserSnapshot = {}): ExpenseReceiptFormDraft {
  const fallback = createExpenseReceiptDraft(user);
  try {
    const parsed = JSON.parse(content || '{}') as Partial<ExpenseReceiptFormDraft> & {
      items?: Array<Partial<ExpenseReceiptItemDraft> & { amount?: string | number }>;
      deposit_amount?: string | number;
    };
    const items = Array.isArray(parsed.items)
      ? parsed.items.map((item, index) => ({
          id: String(item.id || newItem(index).id),
          description: String(item.description || ''),
          amount: item.amount === null || item.amount === undefined ? '' : String(item.amount),
          note: String(item.note || ''),
        }))
      : [];
    while (items.length < 3) items.push(newItem(items.length));
    return {
      version: 1,
      draft_date: String(parsed.draft_date || fallback.draft_date),
      author_name: String(parsed.author_name || fallback.author_name),
      department: String(parsed.department || fallback.department),
      position_title: String(parsed.position_title || fallback.position_title),
      purpose: String(parsed.purpose || ''),
      expense_date: String(parsed.expense_date || ''),
      payment_method: String(parsed.payment_method || ''),
      case_number: String(parsed.case_number || ''),
      client_name: String(parsed.client_name || ''),
      deposit_date: String(parsed.deposit_date || ''),
      deposit_amount: parsed.deposit_amount === null || parsed.deposit_amount === undefined ? '' : String(parsed.deposit_amount),
      bank_name: String(parsed.bank_name || ''),
      account_number: String(parsed.account_number || ''),
      account_holder: String(parsed.account_holder || ''),
      account_note: String(parsed.account_note || ''),
      items,
    };
  } catch {
    return fallback;
  }
}

export function expenseReceiptTotal(items: ExpenseReceiptItemDraft[]): number {
  return items.reduce((sum, item) => sum + Math.max(0, Number(String(item.amount).replace(/[^\d]/g, '')) || 0), 0);
}

export function serializeExpenseReceiptContent(form: ExpenseReceiptFormDraft): string {
  const populatedItems = form.items.filter((item) => (
    item.description.trim()
    || String(item.amount).replace(/[^\d]/g, '')
    || item.note.trim()
  ));
  const depositDate = form.deposit_date.trim();
  return JSON.stringify({
    ...form,
    expense_date: validExpenseReceiptDate(form.expense_date.trim()) ? form.expense_date.trim() : '',
    case_number: form.case_number.trim().slice(0, 50),
    client_name: form.client_name.trim().slice(0, 100),
    deposit_date: validExpenseReceiptDate(depositDate) ? depositDate : '',
    deposit_amount: Math.max(0, Number(String(form.deposit_amount).replace(/[^\d]/g, '')) || 0),
    bank_name: form.bank_name.trim().slice(0, 50),
    account_number: form.account_number.trim().slice(0, 50),
    account_holder: form.account_holder.trim().slice(0, 50),
    account_note: form.account_note.trim().slice(0, 500),
    items: populatedItems.map((item) => ({
      id: item.id,
      description: item.description.trim(),
      amount: Math.max(0, Number(String(item.amount).replace(/[^\d]/g, '')) || 0),
      note: item.note.trim(),
    })),
    total_amount: expenseReceiptTotal(form.items),
  });
}

export function validateExpenseReceiptForSubmit(form: ExpenseReceiptFormDraft, receiptCount: number): string[] {
  const errors: string[] = [];
  if (!form.draft_date) errors.push('기안일을 입력하세요.');
  if (!form.author_name.trim()) errors.push('기안자 정보가 없습니다.');
  if (!form.purpose.trim()) errors.push('지출 목적을 입력하세요.');
  if (!form.payment_method) errors.push('지급 방법을 선택하세요.');

  const touchedItems = form.items.filter((item) => item.description.trim() || item.amount || item.note.trim());
  if (touchedItems.length === 0) errors.push('지출 항목을 1개 이상 입력하세요.');
  touchedItems.forEach((item, index) => {
    if (!item.description.trim()) errors.push(`지출 항목 ${index + 1}의 항목명을 입력하세요.`);
    const amount = Number(String(item.amount).replace(/[^\d]/g, ''));
    if (!Number.isSafeInteger(amount) || amount <= 0) errors.push(`지출 항목 ${index + 1}의 금액을 1원 이상의 정수로 입력하세요.`);
  });
  if (receiptCount < 1) errors.push('영수증 이미지를 1장 이상 첨부하세요.');
  return errors;
}

export function validateExpenseReceiptFiles<T extends FileLike>(
  files: T[],
  existingCount: number,
  existingBytes: number,
): { accepted: T[]; errors: string[] } {
  const accepted: T[] = [];
  const errors: string[] = [];
  let count = existingCount;
  let totalBytes = existingBytes;

  for (const file of files) {
    const lowerName = file.name.toLowerCase();
    const isHeic = /\.(heic|heif)$/.test(lowerName) || /image\/(heic|heif)/i.test(file.type);
    if (isHeic) {
      errors.push(`${file.name}: HEIC/HEIF는 지원하지 않습니다. JPG·PNG·WEBP로 변환해 주세요.`);
      continue;
    }
    const supported = /image\/(jpeg|png|webp)/i.test(file.type) || /\.(jpe?g|png|webp)$/.test(lowerName);
    if (!supported) {
      errors.push(`${file.name}: JPG·PNG·WEBP 이미지만 첨부할 수 있습니다.`);
      continue;
    }
    if (file.size > EXPENSE_RECEIPT_MAX_FILE_BYTES) {
      errors.push(`${file.name}: 파일 1개는 10MB 이하여야 합니다.`);
      continue;
    }
    if (count + 1 > EXPENSE_RECEIPT_MAX_FILES) {
      errors.push('영수증은 최대 10장까지 첨부할 수 있습니다.');
      break;
    }
    if (totalBytes + file.size > EXPENSE_RECEIPT_MAX_TOTAL_BYTES) {
      errors.push('영수증 전체 용량은 40MB 이하여야 합니다.');
      break;
    }
    accepted.push(file);
    count += 1;
    totalBytes += file.size;
  }
  return { accepted, errors };
}

export async function expenseReceiptFileSha256(
  file: { arrayBuffer(): Promise<ArrayBuffer> },
): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Decide whether a browser-selected receipt should be re-encoded. Very large
 * dimensions are capped so ten modern phone photos stay below the server's
 * aggregate pixel budget. A smaller but unusually heavy image is re-encoded
 * at its original dimensions, while already compact images remain byte-for-byte
 * unchanged.
 */
export function expenseReceiptImageTargetSize(
  width: number,
  height: number,
  fileSize: number,
  forceConvert = false,
): ExpenseReceiptImageTargetSize | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return null;
  const longestSide = Math.max(width, height);
  const resized = longestSide > EXPENSE_RECEIPT_CLIENT_MAX_IMAGE_DIMENSION;
  if (!forceConvert && !resized && fileSize <= EXPENSE_RECEIPT_CLIENT_OPTIMIZE_BYTES) return null;
  const scale = resized ? EXPENSE_RECEIPT_CLIENT_MAX_IMAGE_DIMENSION / longestSide : 1;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    resized,
  };
}

/**
 * Match only files proven to exist on the server after a lost upload/reorder
 * response. A file name or byte size alone is not strong enough because two
 * different mobile photos can share both, so reconciliation uses the server's
 * content hash and keeps every uncertain local file available for retry.
 */
export function matchCommittedExpenseReceiptUploads(
  pending: ExpenseReceiptPendingUploadHash[],
  serverAttachments: ExpenseReceiptServerAttachmentHash[],
): Record<string, string> {
  const candidates = new Map<string, ExpenseReceiptServerAttachmentHash[]>();
  for (const attachment of serverAttachments) {
    const sha256 = String(attachment.sha256 || '').toLowerCase();
    if (!sha256) continue;
    const bucket = candidates.get(sha256) || [];
    bucket.push(attachment);
    candidates.set(sha256, bucket);
  }

  const committed: Record<string, string> = {};
  for (const file of pending) {
    const sha256 = String(file.sha256 || '').toLowerCase();
    const bucket = candidates.get(sha256);
    if (!bucket?.length) continue;
    const candidateIndex = bucket.findIndex((candidate) => Number(candidate.file_size) === Number(file.size));
    if (candidateIndex < 0) continue;
    const [attachment] = bucket.splice(candidateIndex, 1);
    committed[file.key] = attachment.id;
  }
  return committed;
}

export function moveExpenseReceiptItem<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length || to < 0 || to >= items.length || from === to) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function formatExpenseReceiptBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${Math.max(0, bytes)}B`;
}

export function formatExpenseReceiptDateTime(value: string | null | undefined): string {
  if (!value) return '-';
  const sqlUtc = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(value);
  const parsed = new Date(sqlUtc ? `${value.replace(' ', 'T')}Z` : value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
}
