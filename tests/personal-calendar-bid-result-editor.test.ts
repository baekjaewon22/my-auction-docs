import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const api = readFileSync(new URL('../src/react-app/api.ts', import.meta.url), 'utf8');
const page = readFileSync(new URL('../src/react-app/pages/PersonalCalendar.tsx', import.meta.url), 'utf8');
const editor = readFileSync(new URL('../src/react-app/components/AuctionBidResultEditor.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/react-app/index.css', import.meta.url), 'utf8');

test('캘린더 상세는 서버가 허용한 입찰 일정에만 결과 입력 UI를 노출한다', () => {
  assert.match(api, /can_edit_bid_result\?: 0 \| 1/);
  assert.match(page, /selectedEvent\.can_edit_bid_result === 1 && selectedEvent\.source_id/);
  assert.match(page, /auctionSchedule\.bidResultEntry\(event\.source_id\)/);
  assert.match(page, /'입찰 결과 입력\/수정'/);
  assert.doesNotMatch(page, /user\?\.role[^\n]+입찰 결과 입력/);
});

test('입찰가와 전체 결과 편집은 같은 권한 검증 DTO를 사용한다', () => {
  assert.match(page, /openBidResultEditor\(selectedEvent, 'price'\)/);
  assert.match(page, /openBidResultEditor\(selectedEvent, 'full'\)/);
  assert.match(page, /\['pending', 'failed'\]\.includes\(selectedEvent\.bid_result \|\| 'pending'\)/);
  assert.match(page, /priceOnly=\{bidResultEditorMode === 'price'\}/);
  assert.match(api, /bidResultEntry: \(id: string\)[\s\S]*?encodeURIComponent\(id\)[\s\S]*?bid-result-entry/);
});

test('대기 일정과 blocking 게이트는 결과를 명시적으로 선택해야 하며 priceOnly 저장을 보존한다', () => {
  assert.match(editor, /type ResultChoice = AuctionScheduleBidResult/);
  assert.match(editor, /const currentResult = initialResult \?\? auctionScheduleBidResult\(data\)/);
  assert.match(editor, /blocking \|\| currentResult === 'pending' \? '' : 'pending'/);
  assert.match(editor, /\{\(blocking \|\| currentResult === 'pending'\) && \([\s\S]*?setResult\('won'\)[\s\S]*?setResult\('failed'\)[\s\S]*?setResult\('withdrawn'\)[\s\S]*?setResult\('cancelled'\)/);
  assert.match(editor, /setResult\('won'\)/);
  assert.match(editor, /setResult\('failed'\)/);
  assert.match(editor, /setResult\('withdrawn'\)/);
  assert.match(editor, /setResult\('cancelled'\)/);
  assert.match(editor, /if \(!result\)[\s\S]*?결과를 선택해 주세요/);
  assert.match(editor, /disabled=\{saving \|\| \(!priceOnly && !result\)\}/);
  assert.match(editor, /api\.auctionSchedule\.updateBidPrices/);
  assert.match(editor, /await onSaved\(saved\)/);
  assert.match(editor, /priceOnly \? '입찰가 저장' : '입찰 결과 저장'/);
});

test('확정 결과는 다른 결과로 직접 변경하지 않고 대기 초기화만 허용한다', () => {
  assert.match(editor, /\{!blocking && currentResult !== 'pending' && \([\s\S]*?setResult\('pending'\)[\s\S]*?대기\(결과 초기화\)/);
  assert.equal(editor.match(/setResult\('pending'\)/g)?.length, 1);
  assert.match(editor, /result === 'pending' && !confirm\(/);
});

test('저장 직후 schedule_id로 캘린더를 다시 조회해 갱신된 상세를 유지한다', () => {
  assert.match(api, /interface AuctionBidScheduleSaveResponse[\s\S]*?schedule_id: string/);
  assert.match(page, /api\.personalCalendar\.list\(rangeStart, rangeEnd\)/);
  assert.match(page, /saved\?\.schedule_id/);
  assert.match(page, /event\.source_id === scheduleId/);
  assert.match(page, /event\.id === previous\?\.id/);
  assert.match(page, /setSelectedEvent\(refreshed \|\| null\)/);
  assert.match(page, /events\.find\(event => event\.id === focusEventId\)/);
});

test('중첩 결과 모달은 배경 클릭을 분리하고 320px에서도 입력과 버튼을 한 열로 유지한다', () => {
  assert.match(page, /personal-calendar-bid-result-overlay" onClick=\{closeBidResultEditor\}/);
  assert.match(page, /personal-calendar-bid-result-dialog" onClick=\{event => event\.stopPropagation\(\)\}/);
  assert.match(page, /bidResultLoading[\s\S]*?불러오는 중/);
  assert.match(page, /bidResultError && <p role="alert">/);
  assert.match(css, /\.personal-calendar-bid-result-overlay[\s\S]*?z-index:\s*130/);
  assert.match(css, /@media \(max-width: 360px\)[\s\S]*?\.auction-bid-result-choice[\s\S]*?grid-template-columns:\s*1fr/);
  assert.match(css, /@media \(max-width: 360px\)[\s\S]*?\.auction-bid-result-editor-actions \.btn[\s\S]*?width:\s*100%/);
});
