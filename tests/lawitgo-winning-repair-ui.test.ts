import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../src/react-app/pages/LawitgoWinningAdmin.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('../src/react-app/api.ts', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/react-app/index.css', import.meta.url), 'utf8');

test('정보누락 행에서만 보완 상세를 열고 목록 전화번호는 계속 마스킹한다', () => {
  assert.match(page, /item\.missing_fields\.length > 0[\s\S]*?정보 보완/);
  assert.match(page, /customer_phone_masked/);
  assert.doesNotMatch(page, /<td[^>]*>[\s\S]{0,200}item\.customer_phone(?:\W|$)/);
  assert.match(page, /api\.lawitgoWinningAdmin\.getRepair\(item\.sales_record_id\)/);
  assert.match(page, /전화번호 원문은 이 마스터 전용 보완 창에서만 확인할 수 있습니다/);
});

test('보완 API는 sales record id를 인코딩하고 PUT으로 필수 스냅샷을 저장한다', () => {
  assert.match(api, /getRepair:[\s\S]*?encodeURIComponent\(salesRecordId\)[\s\S]*?\/repair/);
  assert.match(api, /updateRepair:[\s\S]*?encodeURIComponent\(salesRecordId\)[\s\S]*?\/repair[\s\S]*?method: 'PUT'/);
  for (const field of [
    'customer_name',
    'customer_phone',
    'court',
    'case_number',
    'property_type',
    'winning_date',
    'assignee_user_id',
  ]) {
    assert.match(api, new RegExp(`LawitgoWinningRepairItem,[\\s\\S]*?'[^']*${field}`));
    assert.match(page, new RegExp(`updateRepairField\\('${field}'`));
  }
  assert.match(page, /updateRepair\(repairTarget\.salesRecordId/);
  assert.match(page, /await load\(true\)/);
  assert.match(page, /저장하고 발송대기로 전환/);
});

test('보완 모달은 누락 필드와 담당자 연결 상태를 표시하고 모바일 한 열로 축소된다', () => {
  assert.match(page, /role="dialog"/);
  assert.match(page, /aria-modal="true"/);
  assert.match(page, /현재 누락 항목/);
  assert.match(page, /field\.startsWith\('assignee\.'\)/);
  assert.match(page, /assignee\.consultant_id \|\| '연결 없음'/);
  assert.match(page, /\^0\\d\{9,10\}\$/);
  assert.match(css, /\.lawitgo-winning-repair-grid\s*\{[^}]*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*?\.lawitgo-winning-repair-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(css, /@media \(max-width: 390px\)[\s\S]*?\.lawitgo-winning-repair-actions\s*\{[^}]*grid-template-columns:\s*1fr/);
});
