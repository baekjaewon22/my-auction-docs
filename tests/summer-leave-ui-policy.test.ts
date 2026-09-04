import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  isSummerLeaveRequestPeriod,
  isSummerLeaveUsageDate,
  SUMMER_LEAVE_REQUEST_PERIOD_ERROR,
  SUMMER_LEAVE_USAGE_PERIOD_ERROR,
} from '../src/shared/summer-leave-policy.ts';

const leavePage = readFileSync(new URL('../src/react-app/pages/Leave.tsx', import.meta.url), 'utf8');

test('여름휴가 화면은 공용 기간 정책으로 신청 버튼과 사용일을 제한한다', () => {
  assert.match(
    leavePage,
    /from '\.\.\/\.\.\/shared\/summer-leave-policy';/,
  );
  assert.match(leavePage, /const summerVacationOpen = isSummerLeaveRequestPeriod\(\);/);
  assert.match(leavePage, /const summerBlocked = !summerVacationOpen \|\| summerAlreadyRequested \|\| summerRemaining === 0;/);
  assert.match(leavePage, /disabled=\{submitting \|\| \(holidayRequiredForSubmit && \(holidayLoading \|\| Boolean\(holidayError\) \|\| summerBlocked\)\)\}/);
  assert.match(leavePage, /!isSummerLeaveUsageDate\(formStartDate\)/);
  assert.match(leavePage, /rangeDates\.some\(d => !isSummerLeaveUsageDate\(d\)\)/);
  assert.match(leavePage, /alert\(SUMMER_LEAVE_REQUEST_PERIOD_ERROR\)/);
  assert.match(leavePage, /alert\(SUMMER_LEAVE_USAGE_PERIOD_ERROR\)/);
  assert.doesNotMatch(leavePage, /isJulyOrAugustDate|isSummerVacationWindowOpen/);
});

test('여름휴가 화면 정책은 KST 9월까지 활성이고 10월부터 비활성이다', () => {
  assert.equal(isSummerLeaveRequestPeriod(new Date('2026-09-30T14:59:59.999Z')), true);
  assert.equal(isSummerLeaveRequestPeriod(new Date('2026-09-30T15:00:00.000Z')), false);
  assert.equal(isSummerLeaveUsageDate('2026-09-30'), true);
  assert.equal(isSummerLeaveUsageDate('2026-10-01'), false);
});

test('여름휴가 화면의 안내와 경고는 기존 7~8월 문구를 유지한다', () => {
  assert.match(leavePage, /매년 7~8월에만 신청 및 사용 가능합니다/);
  assert.match(leavePage, /9월부터는 사용이 불가합니다/);
  assert.match(leavePage, /시작일은 7~8월 안에서만 선택할 수 있습니다/);
  assert.match(SUMMER_LEAVE_REQUEST_PERIOD_ERROR, /7~8월/);
  assert.match(SUMMER_LEAVE_REQUEST_PERIOD_ERROR, /9월부터/);
  assert.match(SUMMER_LEAVE_USAGE_PERIOD_ERROR, /연결 연차는 모두 7~8월/);
  assert.doesNotMatch(leavePage, /7~9월|10월부터는 사용이 불가합니다/);
});
