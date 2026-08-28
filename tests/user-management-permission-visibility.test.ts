import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/react-app/pages/UserManagement.tsx', import.meta.url), 'utf8');

test('the auction settings card and report-permission field are hidden without their respective permissions', () => {
  const section = source.slice(
    source.indexOf('{/* 자료 생성 설정 */}'),
    source.indexOf('{/* 회계 정보 카드'),
  );

  assert.match(section, /\{\(canEditAuctionSettings \|\| canGrantReportPermission\) && \(/);
  assert.match(section, /\{canGrantReportPermission && \([\s\S]*?value=\{reportPermissionInput\}/);
  assert.doesNotMatch(section, /disabled=\{!canGrantReportPermission\}/);
});

test('restricted accounting assistants see neither a restriction card nor sales-evaluation cards', () => {
  assert.doesNotMatch(source, /canViewAccounting && isRestrictedForViewer\(selectedUser\) &&/);
  assert.match(source, /canViewAccounting && !isRestrictedForViewer\(selectedUser\) && \([\s\S]*?evaluations\.length/);
  assert.match(source, /canEditAccounting && !isRestrictedForViewer\(selectedUser\) && evaluations\.some/);
});

test('the alimtalk settings card follows the server update policy', () => {
  const helper = source.slice(
    source.indexOf('const canManageAlimtalkSettings'),
    source.indexOf('const load ='),
  );

  assert.match(helper, /\['accountant', 'accountant_asst'\]\.includes\(targetUser\.role\)/);
  assert.match(helper, /currentUser\.id === targetUser\.id/);
  assert.match(helper, /\['master', 'ceo', 'cc_ref', 'admin'\]\.includes\(currentUser\.role\)/);
  assert.match(source, /\{canManageAlimtalkSettings\(selectedUser\) && \(/);
  assert.match(source, /if \(canManageAlimtalkSettings\(u\)\)[\s\S]*?getAlimtalkSettings\(u\.id\)/);
});
