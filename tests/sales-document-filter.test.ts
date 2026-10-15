import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { matchesSalesDocumentFilter, SALES_DOCUMENT_FILTER_OPTIONS } from '../src/shared/sales-document-filter.ts';

test('계약서/물건분석보고서 필터는 화면 표시 상태와 같은 기준을 사용한다', () => {
  const registered = { type: '계약', contract_submitted: 1, contract_not_approved: 1 };
  const waiting = { type: '낙찰', contract_submitted: 1, contract_not_approved: 0 };
  const missing = { type: '계약', contract_not_submitted: 1, contract_not_approved: 0 };
  const approvedMissing = { type: '계약', contract_not_submitted: 1, contract_not_approved: 1 };

  assert.equal(matchesSalesDocumentFilter(registered, 'registered'), true);
  assert.equal(matchesSalesDocumentFilter(waiting, 'waiting'), true);
  assert.equal(matchesSalesDocumentFilter(missing, 'missing'), true);
  assert.equal(matchesSalesDocumentFilter(approvedMissing, 'missing'), false);
  assert.equal(matchesSalesDocumentFilter({ type: '중개' }, 'registered'), false);
});

test('업무성과 상단에 요청한 서류 상태 드롭다운을 제공한다', () => {
  assert.deepEqual(SALES_DOCUMENT_FILTER_OPTIONS.map(option => option.label), ['계약서/물건분석보고서 전체', '등록', '미작성', '확인대기']);
  const sales = readFileSync('src/react-app/pages/Sales.tsx', 'utf8');
  assert.match(sales, /placeholder="계약서\/물건분석보고서"/);
  assert.match(sales, /setFilterDocumentStatus/);
  assert.match(sales, /matchesSalesDocumentFilter/);
});
