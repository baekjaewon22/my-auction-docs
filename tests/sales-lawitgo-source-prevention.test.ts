import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const routeSource = readFileSync(new URL('../src/worker/routes/sales.ts', import.meta.url), 'utf8');
const pageSource = readFileSync(new URL('../src/react-app/pages/Sales.tsx', import.meta.url), 'utf8');
const cssSource = readFileSync(new URL('../src/react-app/index.css', import.meta.url), 'utf8');

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing source marker: ${start}`);
  assert.notEqual(endIndex, -1, `missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test('수동 낙찰 등록은 연결 일지의 사건 원본을 필드별로 보완하고 별도 스냅샷을 저장한다', () => {
  const builder = sourceBetween(
    routeSource,
    'export function buildSalesWinningOverrideInput',
    'async function cleanupFailedWinningSale',
  );
  assert.match(builder, /request\.court\) \|\| winningSourceText\(source\.court\)/);
  assert.match(builder, /request\.case_number\) \|\| winningSourceText\(source\.caseNo\)/);
  assert.match(builder, /request\.property_type\) \|\| winningSourceText\(source\.propertyType\)/);
  assert.doesNotMatch(builder, /type_detail/);

  const createRoute = sourceBetween(routeSource, "sales.post('/', async (c) =>", '// GET /api/sales/duplicate-check');
  const validationIndex = createRoute.indexOf('await validateLawitgoWinningOverrideInput');
  const insertIndex = createRoute.indexOf('INSERT INTO sales_records');
  const upsertIndex = createRoute.indexOf('await upsertLawitgoWinningOverride');
  assert.ok(validationIndex >= 0 && validationIndex < insertIndex, '낙찰정보는 매출 생성 전에 검증해야 한다');
  assert.ok(upsertIndex > insertIndex, '매출 생성 직후 Lawitgo 스냅샷을 저장해야 한다');
  assert.match(createRoute, /body\.type === '낙찰' && !String\(body\.contract_date/);
  assert.match(createRoute, /linkedWinningSource = parseWinningSourceData\(linkedEntry\.data\)/);
  assert.match(createRoute, /if \(winningOverrideInput && inserted\) await cleanupFailedWinningSale/);
});

test('입금신청 낙찰 전환은 필수정보를 검증하고 스냅샷 실패 시 생성 매출을 제거한다', () => {
  const claimRoute = sourceBetween(
    routeSource,
    "sales.post('/deposits/:id/claim', async (c) =>",
    '// POST /api/sales/deposits/:id/approve',
  );
  assert.match(claimRoute, /client_phone\?: string; court\?: string; case_number\?: string; property_type\?: string/);
  assert.match(claimRoute, /type === '낙찰' && !String\(contract_date/);
  assert.match(claimRoute, /type === '낙찰' \? String\(contract_date\)\.trim\(\) : \(contract_date \|\| notice\.deposit_date\)/);
  assert.ok(
    claimRoute.indexOf('await validateLawitgoWinningOverrideInput') < claimRoute.indexOf('INSERT INTO sales_records'),
    '입금신청 낙찰도 매출 생성 전에 검증해야 한다',
  );
  assert.match(claimRoute, /depositor_different, client_phone, amount/);
  assert.match(claimRoute, /await upsertLawitgoWinningOverride\(db, salesId, winningOverrideInput, user\.sub\)/);
  assert.match(claimRoute, /WHERE id = \? AND status = 'pending'/);
  assert.match(claimRoute, /if \(inserted\) await cleanupFailedWinningSale\(db, salesId\)/);
});

test('엑셀 낙찰은 T~V 원본과 실제 담당자가 모두 있을 때만 등록한다', () => {
  const bulkRoute = sourceBetween(
    routeSource,
    "sales.post('/bulk-import', requireRole(...EDIT_ACCOUNTING_ROLES), async (c) =>",
    '// ━━━ 활동 내역 조회',
  );
  assert.match(bulkRoute, /court\?: string;\s+\/\/ T열 관할법원/);
  assert.match(bulkRoute, /case_number\?: string;\s+\/\/ U열 사건번호/);
  assert.match(bulkRoute, /property_type\?: string;\s+\/\/ V열 물건종류/);
  assert.match(bulkRoute, /lawitgo_repair_required: 0/);
  assert.match(bulkRoute, /winningUserCandidates\.length !== 1/);
  assert.match(bulkRoute, /type === '낙찰' && !explicitContractDate/);
  assert.match(bulkRoute, /H열 낙찰일을 입력하세요/);
  assert.match(bulkRoute, /동명이인 담당자가/);
  assert.match(bulkRoute, /if \(!resolvedUser\) \{[\s\S]*?낙찰정보 보완 필요/);
  assert.match(bulkRoute, /court: r\.court,[\s\S]*?case_number: r\.case_number,[\s\S]*?property_type: r\.property_type/);
  assert.match(bulkRoute, /winningOverrideContext = await prepareLawitgoWinningOverrideContext\(db\)/);
  assert.match(bulkRoute, /validateLawitgoWinningOverrideInput\([\s\S]*?winningOverrideContext/);
  assert.match(bulkRoute, /await upsertValidatedLawitgoWinningOverride\(/);
  assert.match(bulkRoute, /if \(inserted\) await cleanupFailedWinningSale\(db, id\)/);
});

test('업무성과 UI는 낙찰 원본을 별도 필드로 받고 전송정보 정정 위치를 안내한다', () => {
  assert.match(pageSource, /type === '낙찰'\) return '낙찰일'/);
  assert.match(pageSource, /nextType === '낙찰'\) setFormContractDate\(''\)/);
  assert.match(pageSource, /claimWinningDate[\s\S]*?contract_date: claimWinningDate/);
  assert.match(pageSource, /formWinningCourt\.trim\(\)/);
  assert.match(pageSource, /court: formAuctionKind === 'public' \? '' : formWinningCourt\.trim\(\)/);
  assert.match(pageSource, /case_number: formWinningCaseNumber\.trim\(\)/);
  assert.match(pageSource, /property_type: formWinningPropertyType\.trim\(\)/);
  assert.match(pageSource, /T<\/td><td>관할법원/);
  assert.match(pageSource, /U<\/td><td>사건번호/);
  assert.match(pageSource, /V<\/td><td>물건종류/);
  assert.match(pageSource, /H열 실제 낙찰일과 T~V열/);
  assert.match(pageSource, /className="sales-claim-form"/);
  assert.match(cssSource, /@media \(max-width: 600px\)[\s\S]*?\.sales-claim-form > div,[\s\S]*?flex: 1 1 100%/);
});

test('일반 수정 API는 낙찰 유형의 양방향 변경을 모두 막는다', () => {
  const updateRoute = sourceBetween(routeSource, "sales.put('/:id', async (c) =>", '// ━━━ 입금 확인');
  assert.match(updateRoute, /body\.type !== record\.type && \(body\.type === '낙찰' \|\| record\.type === '낙찰'\)/);
  assert.match(updateRoute, /낙찰 매출의 유형은 일반 수정에서 변경할 수 없습니다/);
});

test('Lawitgo 발송 중·완료 매출은 모든 업무성과 삭제 경로에서 보호한다', () => {
  const cleanup = sourceBetween(
    routeSource,
    'async function cleanupFailedWinningSale',
    'const SALES_DIFF_FIELDS',
  );
  const byEntryDelete = sourceBetween(
    routeSource,
    "sales.delete('/by-entry/:entryId', async (c) =>",
    '// ━━━ 대시보드용 알림 ━━━',
  );
  const directDelete = sourceBetween(
    routeSource,
    "sales.delete('/:id', requireRole",
    '// PUT /api/sales/:id/phone',
  );
  assert.match(cleanup, /assertLawitgoWinningSaleDeletable/);
  assert.match(cleanup, /status NOT IN \('sending', 'sent'\)/);
  assert.match(byEntryDelete, /assertLawitgoWinningSaleDeletable/);
  assert.match(directDelete, /assertLawitgoWinningSaleDeletable/);
});
