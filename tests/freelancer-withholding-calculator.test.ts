import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../src/react-app/assets/freelancer-withholding-calculator.html', import.meta.url), 'utf8');

test('money input caret stays after the typed digit when a thousands comma appears', () => {
  const moneySource = html.match(/function integer\(value\)\{[\s\S]*?\}\n {2}function tax33/)?.[0]
    .replace(/\n {2}function tax33$/, '');
  assert.ok(moneySource, 'money input formatter must remain available');
  const context = vm.createContext({ Math });
  vm.runInContext(`${moneySource}; first=moneyInputState('1234',4); second=moneyInputState('1,2345',6);`, context);
  const values = JSON.parse(JSON.stringify({
    first: (context as { first: unknown }).first,
    second: (context as { second: unknown }).second,
  }));
  assert.deepEqual(values, {
    first: { text: '1,234', caret: 5 },
    second: { text: '12,345', caret: 6 },
  });
});

test('calculator matches the documented sample with integer tax truncation', () => {
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'calculator script must exist');
  assert.doesNotThrow(() => new Function(script), 'calculator script must be valid JavaScript');
  const taxSource = html.match(/function tax33\(x\)\{[\s\S]*?\}\n {2}function calculate/)?.[0]
    .replace(/\n {2}function calculate$/, '');
  const payrollTaxSource = html.match(/function payrollTax33\(x\)\{[\s\S]*?\}\n {2}function calculate/)?.[0]
    .replace(/\n {2}function calculate$/, '');
  const calculateSource = html.match(/function calculate\(v\)\{[\s\S]*?\}\n {2}function won/)?.[0]
    .replace(/\n {2}function won$/, '');
  assert.ok(taxSource && payrollTaxSource && calculateSource, 'pure calculation functions must remain available');
  const context = vm.createContext({ Math });
  vm.runInContext(`const RATE_PERCENT=50; ${taxSource}; ${payrollTaxSource}; ${calculateSource}; result=calculate({useSales:false,revenue:5196810,G:2156880,E:260240,S:517430,SYS_TAX:171490,L:0});`, context);
  const result = JSON.parse(JSON.stringify((context as { result: unknown }).result));
  assert.deepEqual(result, { R:5196810,C:257190,W:1896640,B:2782740,T:91820,income:83480,local:8340,T0:171490,A:79670,F:4587560,P:2690920,S:517430,E:260240,SYS_TAX:171490,L:0,payrollDeduction:517430,payrollTax:154410,payrollExtra:62590,payrollCheck:4587560,check:true });
});

test('payroll exposes the calculator only to master, ceo, and accountant roles', () => {
  const payroll = readFileSync(new URL('../src/react-app/pages/Payroll.tsx', import.meta.url), 'utf8');
  assert.match(payroll, /\['master', 'ceo', 'accountant'\]\.includes\(currentUser\.role\)/);
  assert.match(payroll, /tab === 'payroll' && canUseWithholdingCalculator/);
  assert.match(payroll, /srcDoc=\{withholdingCalculatorHtml\}/);
  assert.match(payroll, /buildWithholdingCalculatorMemo/);
  assert.match(payroll, /api\.payroll\.saveInternalMemo\(\{ user_id: selectedUserId, period: selectedMonth, content \}\)/);
  assert.match(html, /원천징수 면제/);
  assert.match(html, /세전 공제\(비과세 처리\)/);
  assert.match(html, /payroll-withholding-calculator:apply/);
  assert.match(html, /payroll-withholding-calculator:prefill/);
  assert.match(html, /3\.3% 입력 아님/);
  assert.match(payroll, /withholdingCalculatorPrefill\(data, selectedMonth\)/);
  assert.match(payroll, /const revenue = salesIncome\.commissionIncome/);
  assert.match(payroll, /withholdingCalculatorMinimized/);
  assert.match(payroll, /계산기 창 최소화/);
  assert.match(payroll, /계산기 종료/);
});
