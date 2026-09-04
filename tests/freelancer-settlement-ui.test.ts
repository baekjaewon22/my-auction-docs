import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const payrollPage = readFileSync(new URL('../src/react-app/pages/Payroll.tsx', import.meta.url), 'utf8');
const payrollList = readFileSync(new URL('../src/react-app/components/EmployeePayrollListTab.tsx', import.meta.url), 'utf8');

test('개인 정산서와 전직원 내역은 프리랜서 공용 합산식을 사용한다', () => {
  for (const source of [payrollPage, payrollList]) {
    assert.match(source, /import \{ calculateFreelancerSettlement \} from '\.\.\/\.\.\/shared\/freelancer-settlement';/);
    assert.match(source, /const settlement = calculateFreelancerSettlement\(\{/);
    assert.doesNotMatch(source, /contractAwardTax|performanceIncome/);
  }

  const detailCalculation = payrollPage.slice(
    payrollPage.indexOf('const settlement = calculateFreelancerSettlement({'),
    payrollPage.indexOf('commissionNetRef.current = finalPay;'),
  );
  assert.match(detailCalculation, /settlementIncome: commissionAmount \+ proxyIncome \+ positionAllowance \+ lawitgoNewSettlementTotal/);
  assert.match(detailCalculation, /contractAward: contractAwardAmount/);

  const listCalculationStart = payrollList.indexOf('const settlement = calculateFreelancerSettlement({');
  const listCalculation = payrollList.slice(
    listCalculationStart,
    payrollList.indexOf('const lockedSavedNetPay', listCalculationStart),
  );
  assert.match(listCalculation, /settlementIncome: commissionAmount \+ proxyIncome \+ positionAllowanceIncome \+ lawitgoNewSettlement/);
  assert.match(listCalculation, /contractAward,/);
});

test('프리랜서 합계에는 계약포상을 표시하고 저장 net_pay에도 같은 최종액을 사용한다', () => {
  assert.match(payrollPage, /성과금[\s\S]*?\(계약포상\)/);
  assert.doesNotMatch(payrollPage, /contract_award\.award \* 0\.033/);
  assert.match(payrollPage, /담당자 정산 합계에서 3\.3% 일괄 계산/);
  assert.match(payrollPage, /최종 실지급액 = 기존 정산수익 \+ 계약포상 - 전체 원천징수\/공제/);
  assert.match(payrollPage, /commissionNetRef\.current = finalPay/);
  assert.match(payrollPage, /const netPayForSettle = isCommissionPay \? commissionNetRef\.current : salaryNetPay/);
});

test('잠긴 과거 정산은 저장된 net_pay를 우선하고 안건수당 지급 정책은 유지한다', () => {
  assert.match(payrollPage, /const finalPay = isLocked[\s\S]*?lockedNetPay \?\? legacyLockedNetPay \?\? settlement\.netPay/);
  assert.match(payrollList, /userLocked[\s\S]*?lockedSavedNetPay \?\? legacyLockedNetPay \?\? settlement\.netPay/);
  assert.match(payrollList, /const displayedTotalPay = isCommission \? Math\.max\(totalPay, 0\) : totalPay/);
  assert.match(payrollList, /const carryoverAmount = isCommission \? Math\.max\(-totalPay, 0\) : 0/);
  assert.match(payrollList, /\(이월 \{fmt\(row\.carryover_amount\)\}원\)/);
  assert.match(payrollPage, /const legacyLockedNetPay = isLocked && lockedNetPay === null[\s\S]*?calculateFreelancerSettlement\(\{[\s\S]*?settlementIncome:[\s\S]*?\}\)\.netPay/);
  assert.match(payrollPage, /const caseAllowanceValue = isLocked \? \(caseAllowance\?\.bonus \|\| 0\) : 0/);
  assert.match(payrollList, /const caseAllowance = \(isCommission \|\| !userLocked\) \? 0 : \(savedCaseAllowance \|\| liveCaseAllowance\)/);
  assert.match(payrollPage, /const lawitgoNewSettlements: any\[\] = \(isLocked && Array\.isArray\(data\?\.lawitgo_new_settlements\)\)/);
});
