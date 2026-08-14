import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  findContractByCustomerIdentity,
  isValidCustomerPhone,
  matchingCustomerContracts,
  uniqueContractPhones,
} from '../src/shared/sales-customer-identity.ts';

const rows = [
  { id: 'u1-a', user_id: 'u1', type: '계약', client_name: '홍 길동', client_phone: '010-1111-2222', status: 'confirmed', appraisal_rate: 1, winning_rate: 2 },
  { id: 'u1-b', user_id: 'u1', type: '계약', client_name: '홍길동', client_phone: '010-3333-4444', status: 'confirmed', appraisal_rate: 2, winning_rate: 3 },
  { id: 'u2-a', user_id: 'u2', type: '계약', client_name: '홍길동', client_phone: '010-9999-0000', status: 'confirmed', appraisal_rate: 3, winning_rate: 4 },
  { id: 'u1-refund', user_id: 'u1', type: '계약', client_name: '홍길동', client_phone: '010-5555-6666', status: 'refunded' },
];

test('계약과 낙찰 고객은 담당자 ID·이름·전화번호로 연결한다', () => {
  assert.equal(matchingCustomerContracts(rows, 'u1', ' 홍길동 ').length, 2);
  assert.deepEqual(uniqueContractPhones(rows, 'u1', '홍 길동'), ['010-1111-2222', '010-3333-4444']);
  assert.equal(findContractByCustomerIdentity(rows, 'u1', '홍길동', '01033334444')?.id, 'u1-b');
  assert.equal(findContractByCustomerIdentity(rows, 'u2', '홍길동', '01033334444'), undefined);
});

test('계약·낙찰 고객 전화번호는 10~11자리만 허용한다', () => {
  assert.equal(isValidCustomerPhone('02-1234-5678'), true);
  assert.equal(isValidCustomerPhone('010-1234-5678'), true);
  assert.equal(isValidCustomerPhone('1234'), false);
});

test('업무성과 낙찰은 전화번호를 저장하고 담당자 동명이인을 ID로 분리한다', () => {
  const page = readFileSync(new URL('../src/react-app/pages/Sales.tsx', import.meta.url), 'utf8');
  const dashboard = readFileSync(new URL('../src/react-app/pages/Dashboard.tsx', import.meta.url), 'utf8');
  const route = readFileSync(new URL('../src/worker/routes/sales.ts', import.meta.url), 'utf8');
  const scheduleRoute = readFileSync(new URL('../src/worker/routes/auction-schedule.ts', import.meta.url), 'utf8');
  const resultEditor = readFileSync(new URL('../src/react-app/components/AuctionBidResultEditor.tsx', import.meta.url), 'utf8');
  assert.match(page, /formType === '계약' \|\| formType === '낙찰'/);
  assert.match(page, /client_phone: formPhone/);
  assert.match(page, /findContractByCustomerIdentity\(records, effectiveFormOwnerId/);
  assert.match(route, /body\.type === '낙찰' && !isValidCustomerPhone\(clientPhone\)/);
  assert.match(route, /WHERE user_id = \?/);
  assert.match(route, /sales\.get\('\/customer-contracts'/);
  assert.match(page, /api\.sales\.customerContracts/);
  assert.match(route, /GROUP BY user_id, user_name, eff_branch, position/);
  assert.match(resultEditor, /고객 전화번호.*나중에 입력 가능/);
  assert.doesNotMatch(resultEditor, /result === 'won'.*replace\(\/\\D\/g, ''\)\.length < 10/);
  assert.match(resultEditor, /client_phone: result === 'won'/);
  assert.match(scheduleRoute, /winning_price, client_phone, customer_id, memo, external_id/);
  assert.match(scheduleRoute, /phone_required: !isValidCustomerPhone\(savedSale\.client_phone\)/);
  assert.match(route, /UPDATE sales_records SET client_phone = \?, customer_id = \?/);
  assert.match(dashboard, /고객 전화번호 등록/);
  assert.match(dashboard, /dashboardSalesFocusUrl\(record, 'phone'\)/);
  assert.match(page, /dashboardFocusType === 'phone'/);
  assert.match(page, /autoFocus=\{dashboardFocusType === 'phone'/);
});
