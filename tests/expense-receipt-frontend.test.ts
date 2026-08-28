import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  EXPENSE_RECEIPT_MAX_FILE_BYTES,
  EXPENSE_RECEIPT_CLIENT_MAX_IMAGE_DIMENSION,
  createExpenseReceiptDraft,
  expenseReceiptImageTargetSize,
  matchCommittedExpenseReceiptUploads,
  expenseReceiptTotal,
  formatExpenseReceiptDateTime,
  moveExpenseReceiptItem,
  parseExpenseReceiptContent,
  serializeExpenseReceiptContent,
  validateExpenseReceiptFiles,
  validateExpenseReceiptForSubmit,
} from '../src/react-app/lib/expense-receipt.ts';
import { EXPENSE_RECEIPT_PAYMENT_METHODS, EXPENSE_RECEIPT_TEMPLATE_ID } from '../src/shared/expense-receipt.ts';

const application = readFileSync(new URL('../src/react-app/pages/ExpenseReceiptApplication.tsx', import.meta.url), 'utf8');
const receiptArchive = readFileSync(new URL('../src/react-app/pages/ExpenseReceiptArchive.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/react-app/App.tsx', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../src/react-app/components/Layout.tsx', import.meta.url), 'utf8');
const templates = readFileSync(new URL('../src/react-app/pages/TemplateList.tsx', import.meta.url), 'utf8');
const documentEdit = readFileSync(new URL('../src/react-app/pages/DocumentEdit.tsx', import.meta.url), 'utf8');
const archive = readFileSync(new URL('../src/react-app/pages/Archive.tsx', import.meta.url), 'utf8');
const briefingArchive = readFileSync(new URL('../src/react-app/components/BriefingMaterialArchive.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('../src/react-app/api.ts', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/react-app/index.css', import.meta.url), 'utf8');
const mobileFixture = readFileSync(new URL('./fixtures/mobile-layout-audit.html', import.meta.url), 'utf8');
const mobileAudit = readFileSync(new URL('../scripts/audit-mobile-layout.mjs', import.meta.url), 'utf8');

test('영수증 지출결의 초안은 세 행을 제공하고 완전히 빈 행은 서버 전송에서 제외한다', () => {
  assert.equal(EXPENSE_RECEIPT_TEMPLATE_ID, 'tpl-exp-receipt-001');
  const draft = createExpenseReceiptDraft({ name: '홍길동', department: '총무', position_title: '대리' });
  assert.equal(draft.items.length, 3);
  draft.purpose = '현장 비용';
  draft.expense_date = '2026-08-25';
  draft.payment_method = '법인카드';
  draft.items[0].description = '주차비';
  draft.items[0].amount = '12,300';

  const serialized = JSON.parse(serializeExpenseReceiptContent(draft));
  assert.equal(serialized.items.length, 1);
  assert.equal(serialized.items[0].amount, 12_300);
  assert.equal(serialized.total_amount, 12_300);
  assert.equal(parseExpenseReceiptContent(JSON.stringify(serialized)).items.length, 3);
  assert.equal(expenseReceiptTotal(draft.items), 12_300);
});

test('D1 SQL UTC와 ISO Z/offset 시간은 같은 한국 시간으로 표시한다', () => {
  const sqlUtc = formatExpenseReceiptDateTime('2026-08-25 00:00:00');
  assert.equal(sqlUtc, formatExpenseReceiptDateTime('2026-08-25T00:00:00Z'));
  assert.equal(sqlUtc, formatExpenseReceiptDateTime('2026-08-25T09:00:00+09:00'));
  assert.notEqual(sqlUtc, '-');
  assert.equal(formatExpenseReceiptDateTime(null), '-');
  assert.equal(formatExpenseReceiptDateTime('invalid-date'), 'invalid-date');
});

test('제출 검증은 필수값·부분 입력 행·최소 한 장을 확인한다', () => {
  assert.deepEqual([...EXPENSE_RECEIPT_PAYMENT_METHODS], ['계좌이체', '법인카드', '현금']);
  assert.match(application, /EXPENSE_RECEIPT_PAYMENT_METHODS\.map/);
  const draft = createExpenseReceiptDraft({ name: '홍길동' });
  assert.ok(validateExpenseReceiptForSubmit(draft, 0).includes('영수증 이미지를 1장 이상 첨부하세요.'));

  draft.purpose = '현장 비용';
  draft.expense_date = '2026-08-25';
  draft.payment_method = '계좌이체';
  draft.items[0].note = '메모만 작성';
  const errors = validateExpenseReceiptForSubmit(draft, 1);
  assert.ok(errors.some((message) => message.includes('항목명')));
  assert.ok(errors.some((message) => message.includes('금액')));

  draft.items[0].description = '교통비';
  draft.items[0].amount = '50000';
  assert.deepEqual(validateExpenseReceiptForSubmit(draft, 1), []);
  draft.items[0].amount = '999999999999999999999';
  assert.ok(validateExpenseReceiptForSubmit(draft, 1).some((message) => message.includes('1원 이상의 정수')));
});

test('이미지 선택은 형식·HEIC·개별/전체 크기·개수를 제한하고 순서 변경을 보존한다', () => {
  const heic = validateExpenseReceiptFiles([{ name: 'IMG_1.HEIC', type: 'image/heic', size: 100 }], 0, 0);
  assert.equal(heic.accepted.length, 0);
  assert.match(heic.errors[0], /JPG·PNG·WEBP/);

  const tooLarge = validateExpenseReceiptFiles([{ name: 'large.jpg', type: 'image/jpeg', size: EXPENSE_RECEIPT_MAX_FILE_BYTES + 1 }], 0, 0);
  assert.equal(tooLarge.accepted.length, 0);
  assert.match(tooLarge.errors[0], /10MB/);

  const tooMany = validateExpenseReceiptFiles([{ name: 'ok.png', type: 'image/png', size: 100 }], 10, 1000);
  assert.equal(tooMany.accepted.length, 0);
  assert.match(tooMany.errors[0], /최대 10장/);
  assert.deepEqual(moveExpenseReceiptItem(['a', 'b', 'c'], 0, 2), ['b', 'c', 'a']);
});

test('모바일 고해상도 사진은 긴 변 2400px 이내로 줄이고 최적 사진은 원본을 유지한다', () => {
  assert.equal(EXPENSE_RECEIPT_CLIENT_MAX_IMAGE_DIMENSION, 2400);
  assert.deepEqual(expenseReceiptImageTargetSize(4032, 3024, 3_000_000), {
    width: 2400,
    height: 1800,
    resized: true,
  });
  assert.deepEqual(expenseReceiptImageTargetSize(1200, 1600, 6_000_000), {
    width: 1200,
    height: 1600,
    resized: false,
  });
  assert.equal(expenseReceiptImageTargetSize(1200, 1600, 2_000_000), null);
  assert.deepEqual(expenseReceiptImageTargetSize(1000, 800, 100, true), {
    width: 1000,
    height: 800,
    resized: false,
  });
});

test('응답 유실 재조정은 서버 SHA와 크기가 일치한 신규 첨부만 커밋으로 본다', () => {
  assert.deepEqual(matchCommittedExpenseReceiptUploads([
    { key: 'committed', sha256: 'ABC', size: 100 },
    { key: 'pending', sha256: 'def', size: 200 },
    { key: 'same-hash-second-local', sha256: 'ABC', size: 100 },
  ], [
    { id: 'server-new', sha256: 'abc', file_size: 100 },
    { id: 'wrong-size', sha256: 'def', file_size: 201 },
  ]), { committed: 'server-new' });
  assert.match(application, /newlyCommitted = latest\.attachments\.filter[\s\S]*?matchCommittedExpenseReceiptUploads\(pendingUploads, newlyCommitted\)/);
  assert.match(application, /setLocalReceipts\(localReceipts\.filter\(\(receipt\) => !committedKeys\.has\(receipt\.key\)\)\)/);
});

test('작성·상세·전용 보관함은 모든 로그인 유형에 열고 기존 전체 보관함은 직원 전용으로 유지한다', () => {
  assert.match(app, /path="archive" element={<EmployeeOnlyRoute><ArchivePage \/><\/EmployeeOnlyRoute>}/);
  assert.match(app, /path="expense-receipts" element={<ExpenseReceiptArchive \/>}/);
  assert.match(app, /path="expense-receipts\/new" element={<ExpenseReceiptApplication \/>}/);
  assert.match(app, /path="expense-receipts\/:id" element={<ExpenseReceiptApplication \/>}/);
  assert.doesNotMatch(app, /path="expense-receipts(?:\/new|\/:id)?"[^\n]*EmployeeOnlyRoute/);

  assert.match(layout, /to="\/expense-receipts\/new"[\s\S]*?영수증 지출결의/);
  assert.match(layout, /to="\/expense-receipts"[\s\S]*?영수증 보관함/);
  assert.match(layout, /{!isFreelancer && \([\s\S]*?to="\/archive"/);
  assert.match(receiptArchive, /isFreelancer[\s\S]*?!isFreelancer && <button[^\n]*navigate\('\/archive'/);
});

test('템플릿·일반 문서 편집·기존 보관함 탭이 전용 화면으로 연결된다', () => {
  assert.match(templates, /templateId === EXPENSE_RECEIPT_TEMPLATE_ID[\s\S]*?navigate\('\/expense-receipts\/new'\)/);
  assert.match(documentEdit, /d\.template_id === EXPENSE_RECEIPT_TEMPLATE_ID[\s\S]*?navigate\(`\/expense-receipts\/\$\{d\.id}`/);
  assert.match(archive, /category'\) === 'expense-receipts'[\s\S]*?<ExpenseReceiptArchive \/>/);
  assert.match(briefingArchive, /category: 'expense-receipts'[\s\S]*?영수증 지출결의/);
});

test('첨부 API는 인증 blob을 사용하고 서버 계약과 같은 files/order 필드를 보낸다', () => {
  assert.match(api, /expenseReceipts:\s*{[\s\S]*?get:[\s\S]*?\/expense-receipts\/\$\{encodeURIComponent\(documentId\)}/);
  assert.match(api, /files\.forEach\(\(file\) => form\.append\('files', file\)\)/);
  assert.match(api, /attachments\/order[\s\S]*?method: 'PUT'[\s\S]*?attachment_ids: attachmentIds/);
  assert.match(api, /attachmentPreview:[\s\S]*?authenticatedBlobUrl/);
  assert.match(api, /downloadPdf:[\s\S]*?authenticatedDownload/);
  assert.match(receiptArchive, /drive\.google\.com\/file\/d\/\$\{encodeURIComponent\(item\.drive_file_id\)\}\/view[\s\S]*?rel="noopener noreferrer"/);
});

test('승인은 대표 직인 API를 한 번만 호출하고 작성자 서명과 분리한다', () => {
  const approveBlock = application.slice(application.indexOf('const handleApprove'), application.indexOf('const handleReject'));
  assert.equal((approveBlock.match(/api\.documents\.approve/g) || []).length, 1);
  assert.doesNotMatch(approveBlock, /quickSign|api\.signatures\.sign|SignaturePanel/);
  assert.match(application, /signatureType="author"/);
  assert.match(application, /expenseReceiptRevision={signatureRevision}/);
  assert.match(application, /api\.documents\.get\(savedDocumentId\)[\s\S]*?expense_receipt_revision/);
  assert.match(api, /expense_receipt_revision:\s*expenseReceiptRevision/);
  assert.match(application, /실제 .*approvalAction\.actor_name/);
  assert.match(application, /api\.documents\.reject\(documentId, \{ step_id: representativeStep\?\.id, reason: rejectReason\.trim\(\) \}\)/);
});

test('모바일 사진앨범 선택과 320px 한 열 레이아웃을 제공한다', () => {
  assert.match(application, /type="file" accept="image\/\*" multiple/);
  assert.doesNotMatch(application, /\bcapture=/);
  assert.match(application, /onDrop={handleDrop}/);
  assert.match(application, /draggable={editable && !uiBusy}/);
  assert.match(application, /for \(const selectedFile of selectedFiles\)[\s\S]*?convertExpenseReceiptHeicToJpegBestEffort/);
  assert.match(application, /HEIC\/HEIF도 브라우저에서 열 수 있으면 JPG로 자동 변환합니다/);
  assert.match(application, /canvas\.toBlob\(resolve, 'image\/jpeg', 0\.9\)/);
  assert.match(css, /@media \(max-width: 540px\)[\s\S]*?\.expense-receipt-preview-grid\s*{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(css, /@media \(max-width: 540px\)[\s\S]*?\.expense-receipt-basic-grid\s*{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(css, /\.expense-receipt-archive-item\s*{[^}]*min-width:\s*0/);
  assert.match(mobileFixture, /class="expense-receipt-approval-card" data-fit/);
  assert.match(mobileFixture, /class="expense-receipt-basic-grid" data-fit/);
  assert.match(mobileFixture, /class="expense-receipt-preview-grid" data-fit/);
  assert.match(mobileFixture, /class="expense-receipt-archive-item" data-fit/);
  assert.match(css, /@media \(max-width: 768px\)[\s\S]*?\.expense-receipt-item-actions \.btn-icon-sm\s*{[^}]*width:\s*44px;[^}]*height:\s*44px/);
  assert.match(css, /\.expense-receipt-preview-actions button\s*{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px/);
  assert.match(css, /\.expense-receipt-reject-head \.modal-close,[\s\S]*?min-width:\s*44px;\s*min-height:\s*44px/);
  assert.match(mobileAudit, /const widths = \[320,[^\]]*1280, 1440, 1920, 2560\]/);
  assert.match(mobileAudit, /fitFailureDetails/);
});
