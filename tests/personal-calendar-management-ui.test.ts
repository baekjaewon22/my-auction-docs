import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  canManagePersonalCalendar,
  PERSONAL_CALENDAR_MANAGEMENT_ROLES,
} from '../src/shared/personal-calendar-management.ts';

const api = readFileSync(new URL('../src/react-app/api.ts', import.meta.url), 'utf8');
const page = readFileSync(new URL('../src/react-app/pages/PersonalCalendar.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/react-app/index.css', import.meta.url), 'utf8');

test('캘린더 원본 일정 관리는 마스터와 총무에게만 노출한다', () => {
  assert.deepEqual([...PERSONAL_CALENDAR_MANAGEMENT_ROLES], ['master', 'accountant']);
  assert.equal(canManagePersonalCalendar({ role: 'master' }), true);
  assert.equal(canManagePersonalCalendar({ role: 'accountant' }), true);
  for (const role of ['accountant_asst', 'ceo', 'admin', 'member']) {
    assert.equal(canManagePersonalCalendar({ role }), false, role + '에는 캘린더 관리 예외를 주면 안 된다');
  }

  assert.match(page, /canManagePersonalCalendar\(\{ role: user\?\.role \}\)/);
  assert.match(page, /isCalendarScheduleManager[\s\S]*?selectedManagement\?\.can_edit === 1/);
  assert.match(page, /isCalendarScheduleManager[\s\S]*?selectedManagement\?\.can_delete === 1/);
});

test('캘린더 관리 DTO로 원본 수정 경로와 revision 기반 삭제 API를 사용한다', () => {
  assert.match(api, /management\?: \{[\s\S]*?origin_kind: 'direct_bid' \| 'inspection' \| 'inspection_bid_projection'/);
  assert.match(api, /deleteAuctionEvent:[\s\S]*?personal-calendar\/auction-events[\s\S]*?encodeURIComponent\(sourceId\)/);
  assert.match(api, /method: 'DELETE', body: JSON\.stringify\(data\)/);
  assert.match(page, /selectedManagement\.edit_url \|\| '\/auction-schedule\?'/);
  assert.match(page, /<Link className="btn btn-secondary" to=\{selectedEditUrl\}/);
  assert.match(page, /api\.personalCalendar\.deleteAuctionEvent\(management\.source_id, \{[\s\S]*?source_type: event\.source_type,[\s\S]*?revision: management\.revision/);
  assert.match(page, /if \(scheduleDeleteInFlight\.current\) return/);
  assert.match(page, /api\.personalCalendar\.list\(rangeStart, rangeEnd\)/);
});

test('임장 파생 입찰 삭제 영향을 확인시키고 실패 시 상세 모달에 오류를 유지한다', () => {
  assert.match(page, /management\.origin_kind === 'inspection_bid_projection'/);
  assert.match(page, /원본 임장 일정이 삭제되며, 임장 일정과 여기서 파생된 입찰기일이 함께 사라집니다/);
  assert.match(page, /window\.confirm/);
  assert.match(page, /이 일정을 삭제할까요\? 삭제 후에는 복구할 수 없습니다/);
  assert.match(page, /className="personal-calendar-manage-warning" role="note"/);
  assert.match(page, /scheduleManageError && <p className="personal-calendar-manage-error" role="alert">/);
});

test('관리 버튼은 핀치 캔버스 밖 상세 모달에 있고 모바일 44px·360px 한 열을 유지한다', () => {
  assert.ok(
    page.indexOf('personal-calendar-grid-canvas') < page.indexOf('personal-calendar-manage-actions'),
    '관리 버튼은 확대되는 캘린더 캔버스 바깥에 있어야 한다',
  );
  assert.match(css, /\.personal-calendar-manage-actions \.btn[\s\S]*?min-height:\s*44px/);
  assert.match(css, /@media \(max-width: 360px\)[\s\S]*?\.personal-calendar-manage-actions,[\s\S]*?grid-template-columns:\s*1fr/);
});
