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
  assert.deepEqual(SALES_DOCUMENT_FILTER_OPTIONS.map(option => option.label), ['계약서/물건분석보고서 전체', '미선택', '등록', '미작성', '확인대기']);
  const sales = readFileSync('src/react-app/pages/Sales.tsx', 'utf8');
  assert.match(sales, /placeholder="계약서\/물건분석보고서"/);
  assert.match(sales, /setFilterDocumentStatus/);
  assert.match(sales, /matchesSalesDocumentFilter/);
});

test('미선택은 계약·낙찰 중 등록과 미작성 모두 선택하지 않은 건만 조회한다', () => {
  for (const type of ['계약', '낙찰']) {
    for (const empty of [undefined, null, 0, false]) {
      const record = { type, contract_submitted: empty, contract_not_submitted: empty };
      assert.equal(matchesSalesDocumentFilter(record, 'unselected'), true);
      assert.equal(matchesSalesDocumentFilter(record, 'missing'), false);
    }
    for (const approved of [0, 1]) {
      assert.equal(matchesSalesDocumentFilter({ type, contract_submitted: 1, contract_not_approved: approved }, 'unselected'), false);
      assert.equal(matchesSalesDocumentFilter({ type, contract_not_submitted: 1, contract_not_approved: approved }, 'unselected'), false);
    }
  }
  for (const type of ['중개', '기타', undefined, null]) {
    assert.equal(matchesSalesDocumentFilter({ type }, 'unselected'), false);
    assert.equal(matchesSalesDocumentFilter({ type }, ''), true);
  }
});

test('화면과 엑셀 다운로드 모두 동일한 서류 상태 필터를 적용한다', () => {
  const sales = readFileSync('src/react-app/pages/Sales.tsx', 'utf8');
  assert.match(sales, /branchRecords = branchRecords\.filter\(r => matchesSalesDocumentFilter\(r, filterDocumentStatus\)\)/);
  assert.match(sales, /allRecs = allRecs\.filter\(r => matchesSalesDocumentFilter\(r, filterDocumentStatus\)\)/);
});
