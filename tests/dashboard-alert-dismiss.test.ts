import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  canDismissDashboardAlertItems,
  JEONG_MINHO_USER_ID,
} from '../src/shared/dashboard-alert-dismiss.ts';

test('대시보드 개별 알림은 마스터·정민호 지사장·총무담당이 삭제한다', () => {
  assert.equal(canDismissDashboardAlertItems({ id: 'master', role: 'master' }), true);
  assert.equal(canDismissDashboardAlertItems({ id: JEONG_MINHO_USER_ID, role: 'admin' }), true);
  assert.equal(canDismissDashboardAlertItems({ id: 'accountant', role: 'accountant' }), true);
});

test('그 외 역할은 일반 대시보드 알림을 삭제하지 않는다', () => {
  assert.equal(canDismissDashboardAlertItems({ id: 'other-admin', role: 'admin' }), false);
  assert.equal(canDismissDashboardAlertItems({ id: 'assistant', role: 'accountant_asst' }), false);
  assert.equal(canDismissDashboardAlertItems({ id: 'manager', role: 'manager' }), false);
  assert.equal(canDismissDashboardAlertItems(null), false);
});

test('프런트 X 표시와 백엔드 삭제 API가 공용 권한 정책을 사용한다', () => {
  const dashboard = readFileSync(new URL('../src/react-app/pages/Dashboard.tsx', import.meta.url), 'utf8');
  const journalRoute = readFileSync(new URL('../src/worker/routes/journal.ts', import.meta.url), 'utf8');

  assert.match(dashboard, /canDismissDashboardAlertItems\(user\)/);
  assert.match(dashboard, /AlertItemCloseBtn/);
  assert.match(journalRoute, /canDismissDashboardAlertItems\(user\)/);
  assert.match(journalRoute, /user\.role === 'admin' && alert_type === 'schedule_gap'/);
});
