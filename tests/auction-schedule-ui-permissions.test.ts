import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { auctionScheduleEditBaseData } from '../src/react-app/journal/auction-schedule-form.ts';
import {
  canEditAuctionScheduleEntry,
  canManageAuctionSchedule,
} from '../src/shared/auction-schedule-write-access.ts';

const page = readFileSync(new URL('../src/react-app/pages/AuctionSchedule.tsx', import.meta.url), 'utf8');
const form = readFileSync(new URL('../src/react-app/journal/JournalForm.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/react-app/index.css', import.meta.url), 'utf8');

test('일반 일정 수정·삭제는 날짜와 소유자에 관계없이 관리자급만 할 수 있다', () => {
  const resultAccess = page.match(/const canWriteSelected =[\s\S]*?\n {2}\)\);/)?.[0] || '';
  const managerAccess = page.match(/const canManageSelected =[\s\S]*?\n {2}\);/)?.[0] || '';
  const editAccess = page.match(/const canEditBase =[\s\S]*?\n {2}\);/)?.[0] || '';

  assert.match(resultAccess, /canManageAuctionBidResult/);
  assert.doesNotMatch(resultAccess, /selectedIsPast|todayKey|canManageAuctionSchedule/);
  assert.match(managerAccess, /canManageAuctionSchedule\(\{ role: user\?\.role \}\)/);
  assert.doesNotMatch(managerAccess, /!selectedIsPast|todayKey/);
  assert.match(editAccess, /canEditAuctionScheduleEntry/);
  assert.match(editAccess, /canManageSelected/);
  assert.match(editAccess, /\{ role: user\?\.role, id: user\?\.id \}/);
  assert.match(editAccess, /\{ user_id: selected\.user_id, target_date: selected\.target_date \}/);
  assert.match(page, /selected\?\.activity_type === '입찰' && selectedBidResult !== 'pending'/);
  assert.match(page, /const canEditSelected = canEditBase && !editLockedByBidResult/);
  assert.match(page, /const canDeleteSelected = canManageSelected/);
  assert.match(page, /\{canEditSelected && \([\s\S]*?일정 수정/);
  assert.match(page, /\{canDeleteSelected && <button[\s\S]*?일정 삭제/);
  assert.match(page, /일정 기본정보 수정·삭제는 마스터·총무·총무보조·대표만 가능/);

  const past = { user_id: 'owner', target_date: '2026-08-31' };
  const future = { user_id: 'owner', target_date: '2099-12-31' };
  const now = new Date('2026-09-02T00:00:00+09:00');
  for (const role of ['master', 'accountant', 'accountant_asst', 'ceo']) {
    assert.equal(canManageAuctionSchedule({ role }), true, role + '은 관리자급이어야 한다');
    assert.equal(canEditAuctionScheduleEntry({ role, id: 'admin' }, past, now), true, role + '은 과거 일정도 수정해야 한다');
    assert.equal(canEditAuctionScheduleEntry({ role, id: 'admin' }, future, now), true, role + '은 미래 일정도 수정해야 한다');
  }
  assert.equal(canEditAuctionScheduleEntry({ role: 'member', id: 'owner' }, past, now), false);
  assert.equal(canEditAuctionScheduleEntry(
    { role: 'member', id: 'owner' },
    future,
    now,
  ), false, '담당자 본인은 미래의 자기 일정도 수정할 수 없다');
  assert.equal(canManageAuctionSchedule({ role: 'member' }), false, '담당자는 일정을 삭제할 수 없다');
});

test('KST 기준일을 갱신하고 권한 없는 사용자의 열린 편집창을 닫는다', () => {
  assert.match(page, /useState\(\(\) => auctionScheduleKstDateKey\(\)\)/);
  assert.match(page, /millisecondsUntilNextKstDate/);
  assert.match(page, /window\.setTimeout\(refreshKstDate/);
  assert.match(page, /document\.addEventListener\('visibilitychange'/);
  assert.match(page, /!canEditAuctionScheduleEntry\([\s\S]*?editingEntry\.user_id[\s\S]*?editingEntry\.target_date[\s\S]*?setEditingEntry\(null\)[\s\S]*?setSelected\(editingEntry\)/);
});

test('경매스케줄 편집은 기존 필드를 채우고 일반 update API 흐름을 사용한다', () => {
  assert.match(page, /initialEntry=\{\{/);
  assert.match(page, /updateEntry=\{payload => api\.auctionSchedule\.update\(editingEntry\.id, payload\)\}/);
  assert.match(form, /const editingSchedule = mode === 'auction-schedule'/);
  assert.match(form, /await updateEntry\(\{/);
  assert.match(form, /editingSchedule \? '일정 수정' : '일정 등록'/);
  assert.match(form, /auctionScheduleEditBaseData\(initialEntry\?\.activity_type, activityType, initialData\)/);
  assert.match(form, /disabled=\{editingSchedule\}[\s\S]*?onClick=\{\(\) => setActivityType\(t\)\}/);
  assert.match(form, /\{!editingSchedule && \([\s\S]*?제시입찰가[\s\S]*?작성입찰가/);
  assert.match(form, /입찰가와 낙찰·실패·취소·취하\/변경 결과는 일정 상세의 전용 버튼/);
  assert.match(css, /\.activity-tab:disabled[\s\S]*?cursor:\s*not-allowed/);
});

test('동일 유형 편집은 화면에 없는 연동 메타데이터를 보존하고 유형 변경 때만 제거한다', () => {
  const initial = {
    client: '김고객',
    clientPhone: '010-0000-0000',
    inspectionSourceId: 'inspection-1',
    materializedBidGroup: 'group-1',
    memo: '숨은 메모',
  };
  const sameType = auctionScheduleEditBaseData('입찰', '입찰', initial);
  assert.deepEqual(sameType, initial);
  assert.notEqual(sameType, initial);
  assert.deepEqual(auctionScheduleEditBaseData('임장', '입찰', initial), {});
});

test('임장 입찰기일은 필수이며 모바일에서도 인라인 오류를 표시한다', () => {
  assert.doesNotMatch(form, /입찰기일[^\n]*선택사항/);
  assert.match(form, /입찰기일 \* <span>필수 입력/);
  assert.match(form, /getRequiredInspectionBidDateError\(activityType, \{ bidDate: inspectionBidDate \}\)/);
  assert.match(form, /aria-label="입찰기일 일자"[\s\S]*?aria-invalid=\{!!inspBidDateError\}[\s\S]*?required/);
  assert.match(form, /onInvalid=\{\(\) => setInspBidDateError/);
  assert.match(form, /className="auction-inspection-bid-date-error" role="alert"/);
  assert.match(form, /일반 일정 수정·삭제는 관리자급\(마스터·총무·총무보조·대표\)만 가능/);
  assert.match(form, /담당자는 등록 후 기본정보를 변경할 수 없으니 저장 전에 내용을 다시 확인/);
  assert.match(form, /mode === 'auction-schedule' && !editingSchedule && \(/);
  assert.doesNotMatch(form, /!editingSchedule && isPastAuctionScheduleDate/);
  assert.match(css, /\.auction-inspection-bid-date-selects select\[aria-invalid="true"\]/);
  assert.match(css, /@media \(max-width: 768px\)[\s\S]*?\.auction-inspection-bid-date-selects select[\s\S]*?min-height:\s*44px/);
  assert.match(css, /@media \(max-width: 360px\)[\s\S]*?\.auction-schedule-manage-actions[\s\S]*?grid-template-columns:\s*1fr/);
});
