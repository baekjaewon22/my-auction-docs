import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/react-app/pages/Payroll.tsx', import.meta.url), 'utf8');

function functionSection(name: string, nextName: string): string {
  return source.slice(source.indexOf(`const ${name}`), source.indexOf(`const ${nextName}`));
}

test('the payroll exception user remains read-only while accounting roles can edit', () => {
  const editDeclaration = source.match(/const canEditPayroll = ([^;]+);/)?.[1] || '';
  const lockDeclaration = source.match(/const canLockPayroll = ([^;]+);/)?.[1] || '';
  const allPayrollDeclaration = source.match(/const canViewAllEmployeePayroll = ([\s\S]*?);/)?.[1] || '';

  assert.match(editDeclaration, /\['master', 'ceo', 'accountant', 'accountant_asst'\]/);
  assert.doesNotMatch(editDeclaration, /PAYROLL_EXTRA_IDS/);
  assert.match(lockDeclaration, /\['master', 'accountant'\]/);
  assert.match(allPayrollDeclaration, /PAYROLL_EXTRA_IDS\.includes\(currentUser\.id\)/);
});

test('manual payroll mutation controls are not rendered for read-only viewers', () => {
  const manualSection = source.slice(
    source.indexOf('{/* 수동 입력 (PNG 영역 밖) */}'),
    source.indexOf('{/* ━━━ 회사이익 및 매출정리 탭'),
  );

  assert.match(manualSection, /\{canEditPayroll && \(/);
  assert.match(manualSection, /onClick=\{handleSavePayroll\}/);
  assert.match(manualSection, /\{canLockPayroll && <button[\s\S]*?onClick=\{handleLockPayroll\}/);
  assert.match(manualSection, /isLocked && canUnlockPayroll/);
});

test('payroll mutation handlers stop before calling APIs when edit permission is absent', () => {
  const saveHandler = functionSection('handleSavePayroll', 'handleLockPayroll');
  const lockHandler = functionSection('handleLockPayroll', 'handleUnlockPayroll');
  const unlockHandler = functionSection('handleUnlockPayroll', 'handleCompleteRefundRecovery');
  const recoveryHandler = functionSection('handleCompleteRefundRecovery', 'loadBranch');

  assert.match(saveHandler, /if \(!canEditPayroll \|\| !data \|\| !selectedUserId\) return;[\s\S]*?api\.payroll\.save/);
  assert.match(lockHandler, /if \(!canLockPayroll \|\| !data \|\| !selectedUserId\) return;[\s\S]*?api\.payroll\.lock/);
  assert.match(unlockHandler, /if \(!canUnlockPayroll \|\| !data \|\| !selectedUserId\) return;[\s\S]*?api\.payroll\.unlock/);
  assert.match(recoveryHandler, /if \(!canResolveRefundRecovery \|\| !refundRecoveryId \|\| !refundRecoveryMonth\) return;[\s\S]*?api\.sales\.resolveRefundRecovery/);
});
