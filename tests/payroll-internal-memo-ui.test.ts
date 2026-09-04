import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  canEditPayrollInternalMemo,
  canViewPayrollInternalMemo,
} from '../src/shared/payroll-internal-memo-access.ts';

const payrollPage = readFileSync(new URL('../src/react-app/pages/Payroll.tsx', import.meta.url), 'utf8');
const apiSource = readFileSync(new URL('../src/react-app/api.ts', import.meta.url), 'utf8');
const cssSource = readFileSync(new URL('../src/react-app/index.css', import.meta.url), 'utf8');

test('내부 정산 메모 UI는 총무 계열·마스터·대표에게만 열린다', () => {
  for (const role of ['master', 'ceo', 'accountant', 'accountant_asst']) {
    assert.equal(canViewPayrollInternalMemo({ role }), true, `${role} 열람 허용`);
  }
  for (const role of ['master', 'accountant', 'accountant_asst']) {
    assert.equal(canEditPayrollInternalMemo({ role }), true, `${role} 작성 허용`);
  }
  assert.equal(canEditPayrollInternalMemo({ role: 'ceo' }), false, '대표는 읽기 전용');
  for (const role of ['admin', 'cc_ref', 'director', 'manager', 'member', 'support', 'resigned']) {
    assert.equal(canViewPayrollInternalMemo({ role }), false, `${role} 열람 차단`);
    assert.equal(canEditPayrollInternalMemo({ role }), false, `${role} 작성 차단`);
  }

  assert.match(payrollPage, /const canViewInternalMemo = canViewPayrollInternalMemo\(currentUser\)/);
  assert.match(payrollPage, /const canEditInternalMemo = canEditPayrollInternalMemo\(currentUser\)/);
  assert.match(payrollPage, /\{canViewInternalMemo && loadedPayrollMatchesSelection && \(\s*<section/);
  assert.match(payrollPage, /\) : canEditInternalMemo \? \(/);
  assert.match(payrollPage, /\) : \(\s*<div className="payroll-internal-memo-readonly">/);
});

test('메모는 전용 API로 조회·저장하며 급여 저장 스냅샷에는 섞이지 않는다', () => {
  assert.match(apiSource, /getInternalMemo:[\s\S]*?\/payroll\/internal-memo\/['"] \+ userId/);
  assert.match(apiSource, /saveInternalMemo:[\s\S]*?'\/payroll\/internal-memo'[\s\S]*?method: 'PUT'/);
  assert.match(payrollPage, /api\.payroll\.getInternalMemo\(selectedUserId, selectedMonth\)/);
  assert.match(payrollPage, /api\.payroll\.saveInternalMemo\(\{[\s\S]*?user_id: selectedUserId,[\s\S]*?period: selectedMonth,[\s\S]*?content: internalMemo/);

  const payrollSavePayload = payrollPage.slice(
    payrollPage.indexOf('const manualData ='),
    payrollPage.indexOf("alert('저장되었습니다.')"),
  );
  assert.doesNotMatch(payrollSavePayload, /internalMemo|internal_memo/);
});

test('빠르게 담당자·월을 바꿔도 메모는 현재 로드된 정산표에만 연결된다', () => {
  assert.match(payrollPage, /const loadedPayrollMatchesSelection = !!data[\s\S]*?data\.user\?\.id[\s\S]*?=== selectedUserId[\s\S]*?data\.month[\s\S]*?=== selectedMonth/);

  const memoLoadEffect = payrollPage.slice(
    payrollPage.indexOf('const requestId = ++internalMemoRequestRef.current;'),
    payrollPage.indexOf('}, [canViewInternalMemo, internalMemoReloadKey'),
  );
  assert.match(memoLoadEffect, /!loadedPayrollMatchesSelection/);

  const memoSaveHandler = payrollPage.slice(
    payrollPage.indexOf('const handleSaveInternalMemo'),
    payrollPage.indexOf('const handleLockPayroll'),
  );
  assert.match(memoSaveHandler, /!loadedPayrollMatchesSelection/);
  assert.match(payrollPage, /\{canViewInternalMemo && loadedPayrollMatchesSelection && \(/);
});

test('내부 메모는 선택 입력이고 급여 복사·출력 대상에서 제외된다', () => {
  const copyTargetIndex = payrollPage.indexOf('ref={printRef}');
  const memoIndex = payrollPage.indexOf('data-payroll-copy-excluded="true"');
  const outsideCopyMarkerIndex = payrollPage.indexOf('수동 입력 (PNG 영역 밖)');
  assert.ok(copyTargetIndex >= 0 && outsideCopyMarkerIndex > copyTargetIndex && memoIndex > outsideCopyMarkerIndex);

  assert.match(payrollPage, /className="card payroll-internal-memo no-print"/);
  assert.match(payrollPage, /내부 정산 메모 <span>선택<\/span>/);
  assert.match(payrollPage, /급여 정산서 PNG 복사·출력·직원 화면에는 포함되지 않습니다\./);
  assert.match(payrollPage, /작성하지 않아도 됩니다\. 내용을 비워 저장하면 기존 메모가 삭제됩니다\./);
  assert.match(payrollPage, /maxLength=\{2000\}/);
  assert.match(cssSource, /@media print \{[\s\S]*?\.payroll-internal-memo[\s\S]*?display: none !important;/);
});

test('모바일에서는 메모 하단 정보와 저장 동작을 세로로 재배치한다', () => {
  const mobileBlock = cssSource.slice(
    cssSource.lastIndexOf('@media (max-width: 768px)', cssSource.indexOf('.payroll-internal-memo-footer { align-items: stretch')),
    cssSource.indexOf('@media print', cssSource.indexOf('.payroll-internal-memo-footer { align-items: stretch')),
  );
  assert.match(mobileBlock, /\.payroll-internal-memo-header \{ flex-direction: column/);
  assert.match(mobileBlock, /\.payroll-internal-memo-footer \{ align-items: stretch; flex-direction: column/);
  assert.match(mobileBlock, /\.payroll-internal-memo-actions \.btn \{ min-height: 44px/);
});
