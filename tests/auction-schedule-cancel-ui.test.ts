import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../src/react-app/pages/AuctionSchedule.tsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('../src/react-app/api.ts', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/react-app/index.css', import.meta.url), 'utf8');

test('auction schedule API accepts the separate cancelled result', () => {
  assert.match(api, /result:\s*'won'\s*\|\s*'failed'\s*\|\s*'withdrawn'\s*\|\s*'cancelled'\s*\|\s*'pending'/);
});

test('manual cancellation is separate from withdrawal in cards and details', () => {
  assert.match(page, /bidResult === 'cancelled'[\s\S]*?>취소<\/em>/);
  assert.match(page, /selectedBidResult === 'cancelled'[\s\S]*?5일 경과 자동 처리/);
  assert.match(page, /selectedBidResult === 'withdrawn'[\s\S]*?>취하\/변경<\/strong>/);
});

test('cancel can be applied and reset without conflicting with another terminal result', () => {
  assert.match(page, /applySimpleBidResult[\s\S]*?'withdrawn'\s*\|\s*'cancelled'\s*\|\s*'pending'/);
  assert.match(page, /selectedBidResult === 'cancelled'\s*\?\s*'pending'\s*:\s*'cancelled'/);
  assert.match(page, /disabled=\{processingResult \|\| !\['pending', 'cancelled'\]\.includes\(selectedBidResult\)\}/);
  assert.match(page, /auctionScheduleBidResult\(selectedData\)/);
});

test('bid result buttons retain responsive wrapping', () => {
  assert.match(css, /\.auction-schedule-bid-actions\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;/s);
});
