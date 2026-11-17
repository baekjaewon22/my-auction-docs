import assert from 'node:assert/strict';
import test from 'node:test';
import { recognizedSalesContribution } from '../src/shared/sales-recognized-amount.ts';

test('매수신청대리는 공급가액에서 대리비용을 뺀 회사 몫만 확정매출로 잡는다', () => {
  const record = { type: '매수신청대리', amount: 120_000, proxy_cost: 90_000 };
  assert.equal(recognizedSalesContribution(record, 120_000, false), 19_091);
  assert.equal(recognizedSalesContribution(record, 120_000, true), 19_091);
});

test('매수신청대리 환불은 회사 인식매출 비율만 환불 승인월에 차감한다', () => {
  const record = { type: '매수신청대리', amount: 120_000, proxy_cost: 90_000 };
  assert.equal(recognizedSalesContribution(record, -120_000, false), -19_091);
  assert.equal(recognizedSalesContribution(record, -60_000, false), -9_545);
});

test('일반 매출은 기본 원금, VAT 제외 열람에서는 공급가액을 사용한다', () => {
  const record = { type: '계약', amount: 120_000, proxy_cost: 0 };
  assert.equal(recognizedSalesContribution(record, 120_000, false), 120_000);
  assert.equal(recognizedSalesContribution(record, 120_000, true), 109_091);
});
