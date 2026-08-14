import assert from 'node:assert/strict';
import test from 'node:test';
import {
  actualTransferAmount,
  normalizeWithholdingSettlements,
  withholdingSettlementAccountTag,
  withholdingSettlementAdjustment,
} from '../src/shared/withholding-settlement.ts';

test('빈 원천세 정산은 급여 실지급액을 변경하지 않는다', () => {
  assert.equal(withholdingSettlementAdjustment([]), 0);
  assert.equal(actualTransferAmount(5_883_550, []), 5_883_550);
});

test('요청 사례의 소득세·지방소득세 환급을 8,146,300원으로 계산한다', () => {
  const items = normalizeWithholdingSettlements([
    { type: '소득세', category: '중도정산', amount: -2_057_070 },
    { type: '지방소득세', category: '중도정산', amount: -205_680 },
  ]);
  assert.equal(withholdingSettlementAdjustment(items), 2_262_750);
  assert.equal(actualTransferAmount(6_320_000 - 436_450, items), 8_146_300);
  assert.equal(withholdingSettlementAccountTag(items[0].amount), '미수금(국세청 환급)');
});

test('추징은 실제 이체액을 감소시킨다', () => {
  const items = [{ type: '소득세', category: '연말정산' as const, amount: 350_000 }];
  assert.equal(withholdingSettlementAdjustment(items), -350_000);
  assert.equal(actualTransferAmount(200_000, items), -150_000);
  assert.equal(withholdingSettlementAccountTag(items[0].amount), '예수금(원천세)');
});

test('환급과 추징이 섞인 경우 원 단위 값을 그대로 합산한다', () => {
  const items = [
    { type: '소득세', category: '중도정산' as const, amount: -100_001 },
    { type: '지방소득세', category: '중도정산' as const, amount: 10_002 },
  ];
  assert.equal(withholdingSettlementAdjustment(items), 89_999);
  assert.equal(actualTransferAmount(1_000_000, items), 1_089_999);
});

test('과거 레코드와 잘못된 항목을 안전하게 빈 배열로 처리한다', () => {
  assert.deepEqual(normalizeWithholdingSettlements(undefined), []);
  assert.deepEqual(normalizeWithholdingSettlements([{ amount: 'invalid' }]), []);
});
