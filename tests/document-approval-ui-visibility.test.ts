import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const approvalBar = readFileSync(new URL('../src/react-app/components/ApprovalBar.tsx', import.meta.url), 'utf8');
const documentEdit = readFileSync(new URL('../src/react-app/pages/DocumentEdit.tsx', import.meta.url), 'utf8');
const propertyReport = readFileSync(new URL('../src/react-app/pages/PropertyReport.tsx', import.meta.url), 'utf8');

test('작성자 서명 UI는 현재 사용자와 실제 문서 작성자가 일치할 때만 표시한다', () => {
  assert.match(approvalBar, /authorId\?: string/);
  assert.match(
    approvalBar,
    /const isAuthor = Boolean\(currentUserId\) && currentUserId === authorId &&[\s\S]*?docStatus === 'rejected'/,
  );
  assert.match(approvalBar, /canSign: isAuthor && !authorSigned/);
  assert.match(documentEdit, /authorId=\{doc\.author_id\}/);
  assert.match(propertyReport, /authorId=\{documentAuthorId\}/);
});

test('물건분석보고서 저장과 제출 UI는 서버의 작성자·마스터 정책을 따른다', () => {
  assert.match(propertyReport, /const isDocumentAuthor = !docId \|\| documentAuthorId === user\?\.id/);
  assert.match(
    propertyReport,
    /const isEditable = \(status === 'draft' \|\| status === 'rejected'\) &&[\s\S]*?\(isDocumentAuthor \|\| user\?\.role === 'master'\)/,
  );
  assert.match(
    propertyReport,
    /const canSubmit = \(status === 'draft' \|\| status === 'rejected'\) && isDocumentAuthor/,
  );
  assert.match(propertyReport, /\{isEditable && <button[^>]+onClick=\{handleSave\}/);
  assert.match(propertyReport, /\{canSubmit && \([\s\S]*?onClick=\{handleSubmit\}/);
});

test('물건분석보고서는 역할 기반 대리 결재 UI를 끄고 실제 pending 결재자만 표시한다', () => {
  assert.match(approvalBar, /allowProxyApproval = true/);
  assert.match(approvalBar, /const isSuperApprover = allowProxyApproval &&/);
  assert.match(propertyReport, /allowProxyApproval=\{false\}/);

  const rejectionPolicy = propertyReport.slice(
    propertyReport.indexOf('const myPendingStep'),
    propertyReport.indexOf('// A4 미리보기'),
  );
  assert.match(
    rejectionPolicy,
    /const canReject = status === 'submitted' && Boolean\(myPendingStep && prevAllApproved\)/,
  );
  assert.doesNotMatch(rejectionPolicy, /\['master', 'ceo'/);
});
