import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync(new URL('../src/worker/routes/expense-receipts.ts', import.meta.url), 'utf8');
const documentsRoute = readFileSync(new URL('../src/worker/routes/documents.ts', import.meta.url), 'utf8');
const api = readFileSync(new URL('../src/react-app/api.ts', import.meta.url), 'utf8');
const application = readFileSync(new URL('../src/react-app/pages/ExpenseReceiptApplication.tsx', import.meta.url), 'utf8');
const archive = readFileSync(new URL('../src/react-app/pages/ExpenseReceiptArchive.tsx', import.meta.url), 'utf8');

test('영수증 전용 상세와 목록 응답은 문서 취소 상태와 사유를 노출한다', () => {
  assert.match(route, /type ReceiptDocument = \{[\s\S]*?cancel_requested: number;[\s\S]*?cancel_reason: string;[\s\S]*?cancelled: number;/);
  assert.match(route, /document_id: documentId,[\s\S]*?status: document\.status,[\s\S]*?cancel_requested:[\s\S]*?cancel_reason:[\s\S]*?cancelled:/);
  assert.match(route, /SELECT d\.id AS document_id, d\.title, d\.status,[\s\S]*?AS cancel_requested,[\s\S]*?AS cancel_reason,[\s\S]*?AS cancelled/);
  assert.match(api, /interface ExpenseReceiptDetail \{[\s\S]*?cancel_requested: number;[\s\S]*?cancel_reason: string;[\s\S]*?cancelled: number;/);
  assert.match(api, /interface ExpenseReceiptArchiveItem \{[\s\S]*?cancel_requested: number;[\s\S]*?cancel_reason: string;[\s\S]*?cancelled: number;/);
});

test('취소 상태 필터는 원래 승인 상태와 상호 배타적으로 조회된다', () => {
  assert.match(route, /status === 'cancelled'[\s\S]*?COALESCE\(d\.cancelled,0\)=1/);
  assert.match(route, /status === 'cancel_requested'[\s\S]*?COALESCE\(d\.cancelled,0\)=0 AND COALESCE\(d\.cancel_requested,0\)=1/);
  assert.match(route, /\['draft', 'submitted', 'approved', 'rejected'\][\s\S]*?COALESCE\(d\.cancelled,0\)=0 AND COALESCE\(d\.cancel_requested,0\)=0/);
  assert.match(archive, /option value="cancel_requested">취소 신청<\/option><option value="cancelled">취소<\/option>/);
});

test('전용 작성 화면은 작성자에게만 기존 문서 취소 API를 열고 처리 상태를 표시한다', () => {
  assert.match(application, /doc\.author_id === user\?\.id[\s\S]*?status === 'submitted'[\s\S]*?status === 'approved'/);
  assert.match(application, /await api\.documents\.cancelRequest\(documentId, reason\)/);
  assert.doesNotMatch(application, /expenseReceipts\.cancelRequest/);
  assert.match(application, /effectiveStatus = isCancelled \? 'cancelled' : isCancelRequested \? 'cancel_requested' : status/);
  assert.match(application, /취소 신청 중입니다\. 사유:/);
  assert.match(application, /이 지출결의서는 취소 처리되었습니다/);
  assert.match(application, /status === 'submitted' && !isCancelled && !isCancelRequested/);
  assert.match(documentsRoute, /doc\.status === 'submitted' && !doc\.cancelled && !doc\.cancel_requested/);
});

test('보관함은 취소·취소신청 건을 승인 집계와 배지에서 분리한다', () => {
  assert.match(archive, /if \(item\.cancelled\) acc\.cancelled \+= 1;[\s\S]*?else if \(item\.cancel_requested\) acc\.cancelRequested \+= 1;[\s\S]*?else if \(item\.status === 'approved'\) acc\.approved \+= 1/);
  assert.match(archive, /effectiveStatus = item\.cancelled \? 'cancelled' : item\.cancel_requested \? 'cancel_requested' : item\.status/);
  assert.match(archive, /<span>취소 처리<\/span><strong>\{summary\.cancelled\}건<\/strong><small>취소 신청 \{summary\.cancelRequested\}건<\/small>/);
  assert.match(archive, /item\.cancelled \? '취소 처리' : item\.cancel_requested \? '취소 승인 대기'/);
});
