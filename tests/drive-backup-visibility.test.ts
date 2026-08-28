import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const archive = readFileSync(new URL('../src/react-app/pages/Archive.tsx', import.meta.url), 'utf8');
const modal = readFileSync(new URL('../src/react-app/components/DriveBackupModal.tsx', import.meta.url), 'utf8');

test('Drive management capability excludes accounting assistants and is passed explicitly', () => {
  const managementRoles = archive.match(
    /const canManageDrive = \[([^\]]+)\]\.includes\(user\?\.role \|\| ''\)/,
  )?.[1] || '';

  for (const role of ['master', 'ceo', 'cc_ref', 'admin', 'accountant']) {
    assert.match(managementRoles, new RegExp(`'${role}'`));
  }
  assert.doesNotMatch(managementRoles, /'accountant_asst'/);
  assert.match(archive, /<DriveBackupModal\s+canManage=\{canManageDrive\}/);
  assert.match(modal, /canManage: boolean/);
});

test('read-only Drive viewers do not request management-only modal data', () => {
  assert.match(
    modal,
    /canManage \? api\.drive\.pending\(\)[^\n]+: Promise\.resolve\(\{ documents: \[\] \}\)/,
  );
  assert.match(
    modal,
    /canManage \? api\.drive\.errorSummary\(\)[^\n]+: Promise\.resolve\(\{ summary: \[\] \}\)/,
  );
  assert.match(
    modal,
    /canManage \? api\.drive\.documentRetention\(\)[^\n]+: Promise\.resolve\(null\)/,
  );
});

test('Drive mutation controls are hidden while status and logs remain visible', () => {
  assert.match(modal, /\{canManage && \(\s*connected \? \(/);

  const managementStart = modal.indexOf('Drive 관리자 전용 관리 동작');
  const logStart = modal.indexOf('모든 Drive 열람 역할에 공개: 최근 로그');
  assert.ok(managementStart >= 0 && logStart > managementStart);

  const managementUi = modal.slice(managementStart, logStart);
  assert.match(managementUi, /\{canManage && \(/);
  for (const label of [
    '자동 백업 (30분마다 5건씩)',
    '지금 실행',
    '실패 로그 초기화 + 재시도 허용',
    '지금 정리',
    '테스트 발송',
    '설정 저장',
  ]) {
    assert.match(managementUi, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  const readOnlyUi = modal.slice(logStart);
  assert.match(readOnlyUi, /최근 백업 로그/);
});
