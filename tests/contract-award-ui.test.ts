import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  contractRankingPeriodIndex,
  contractRankingPeriods,
  isContractAwardMonth,
  payrollContractAwardAmount,
  payrollContractAwardPeriodLabel,
} from '../src/react-app/lib/contractAwardUi.ts';

const payrollPage = readFileSync(new URL('../src/react-app/pages/Payroll.tsx', import.meta.url), 'utf8');
const payrollList = readFileSync(new URL('../src/react-app/components/EmployeePayrollListTab.tsx', import.meta.url), 'utf8');
const employeeBonus = readFileSync(new URL('../src/react-app/components/EmployeeBonusTab.tsx', import.meta.url), 'utf8');
const salesPage = readFileSync(new URL('../src/react-app/pages/Sales.tsx', import.meta.url), 'utf8');

test('계약포상 지급월은 새 전용 필드를 우선하고 과거 스냅샷은 기존 지급월 필드로 호환한다', () => {
  const september = {
    is_contract_award_month: true,
    is_payout_month: false,
    contract_award_period_label: '2026년 9월',
    bonus_period_label: null,
    contract_award: { rank: 1, award: 500_000 },
  };
  assert.equal(isContractAwardMonth(september), true);
  assert.equal(payrollContractAwardAmount(september), 500_000);
  assert.equal(payrollContractAwardPeriodLabel(september), '2026년 9월');

  const legacySnapshot = {
    is_payout_month: true,
    bonus_period_label: '2026년 7~8월',
    contract_award: { rank: 2, award: 200_000 },
  };
  assert.equal(isContractAwardMonth(legacySnapshot), true);
  assert.equal(payrollContractAwardAmount(legacySnapshot), 200_000);
  assert.equal(payrollContractAwardPeriodLabel(legacySnapshot), '2026년 7~8월');

  assert.equal(payrollContractAwardAmount({
    is_contract_award_month: false,
    is_payout_month: true,
    contract_award: { rank: 1, award: 500_000 },
  }), 0);
});

test('2026년 계약 랭킹은 8월까지 2개월, 9월부터 월별 구간을 사용한다', () => {
  const periods = contractRankingPeriods(2026);
  assert.deepEqual(
    periods.map(period => [period.startMonth, period.endMonth, period.label]),
    [
      ['2026-01', '2026-02', '2026년 1~2월'],
      ['2026-03', '2026-04', '2026년 3~4월'],
      ['2026-05', '2026-06', '2026년 5~6월'],
      ['2026-07', '2026-08', '2026년 7~8월'],
      ['2026-09', '2026-09', '2026년 9월'],
      ['2026-10', '2026-10', '2026년 10월'],
      ['2026-11', '2026-11', '2026년 11월'],
      ['2026-12', '2026-12', '2026년 12월'],
    ],
  );
  assert.equal(contractRankingPeriodIndex(periods, 2026, 8), 3);
  assert.equal(contractRankingPeriodIndex(periods, 2026, 9), 4);
  assert.equal(contractRankingPeriodIndex(periods, 2026, 12), 7);
});

test('과거 연도는 2개월 구간, 이후 연도는 월별 구간을 유지한다', () => {
  const legacy = contractRankingPeriods(2025);
  assert.equal(legacy.length, 6);
  assert.ok(legacy.every(period => period.modeLabel === '2달'));

  const future = contractRankingPeriods(2027);
  assert.equal(future.length, 12);
  assert.ok(future.every(period => period.startMonth === period.endMonth));
  assert.ok(future.every(period => period.modeLabel === '월별'));
});

test('급여 화면들은 일반 성과금 지급월과 계약포상 지급월을 분리한다', () => {
  assert.match(payrollPage, /const contractAwardAmount = payrollContractAwardAmount\(data\)/);
  assert.match(payrollPage, /const contractAwardPeriodLabel = payrollContractAwardPeriodLabel\(data\)/);
  assert.match(payrollPage, /isContractAwardMonth\(data\).*?data\.contract_award\?\.rank/);
  assert.match(payrollList, /const contractAward = payrollContractAwardAmount\(payroll\)/);
  assert.match(employeeBonus, /const contractAward = payrollContractAwardAmount\(payroll\)/);
  for (const source of [payrollPage, payrollList, employeeBonus]) {
    assert.doesNotMatch(source, /is_payout_month\s*&&\s*(?:data\.|payroll\.)?contract_award/);
  }
  assert.match(payrollPage, /data\.is_payout_month && s\.bonus > 0/);
  assert.match(payrollPage, /data\.is_payout_month && caseAllowanceValue > 0/);
});

test('계약 랭킹은 선택된 정책 구간으로 조회하면서 기존 상위 3개 카드 정보를 유지한다', () => {
  assert.match(salesPage, /const selectedRankingPeriod = rankingPeriods\[rankingPeriodIdx\]/);
  assert.match(salesPage, /api\.sales\.ranking\(startMonth, endMonth\)/);
  assert.match(salesPage, /rank: u\.backendRank \?\? fallbackRank/);
  assert.match(salesPage, /ranking\.filter\(u => u\.rank <= 3\)\.map/);
  assert.match(salesPage, /u\.totalAmount\.toLocaleString\(\)\}원/);
  assert.doesNotMatch(salesPage, /50만원|30만원|최소\s*10|포상\s*조건/);
});
