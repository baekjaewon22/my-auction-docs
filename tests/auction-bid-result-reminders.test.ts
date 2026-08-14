import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runAuctionBidResultReminders } from '../src/worker/lib/auction-bid-result-reminders.ts';

test('입찰 결과 웹푸시는 30분 cron에서 실행되고 일정별 한 번만 발송한다', () => {
  const worker = readFileSync(new URL('../src/worker/index.ts', import.meta.url), 'utf8');
  const reminder = readFileSync(new URL('../src/worker/lib/auction-bid-result-reminders.ts', import.meta.url), 'utf8');
  const migration = readFileSync(new URL('../d1/migrate-auction-bid-result-reminders.sql', import.meta.url), 'utf8');
  const delivery = readFileSync(new URL('../src/worker/lib/web-push-delivery.ts', import.meta.url), 'utf8');
  const everyThirtyMinutesBranch = worker
    .split("if (cron === '*/30 * * * *')")[1]
    ?.split('} else if (cron ===')[0] || '';
  assert.match(everyThirtyMinutesBranch, /runAuctionBidResultReminders/);
  assert.match(reminder, /Number\(kst\.slice\(11, 13\)\) < 15/);
  assert.match(reminder, /auctionScheduleBidResultMissingFields/);
  assert.match(reminder, /INSERT OR IGNORE INTO auction_bid_result_reminder_runs/);
  assert.match(reminder, /eventType: 'auction_bid_result_missing'/);
  assert.match(migration, /UNIQUE\(schedule_id\)/);
  assert.match(delivery, /auction_bid_result_missing/);
});

test('입찰 결과 알림은 15시 전에는 중단되고 15시부터 실제 조회를 수행한다', async () => {
  let scheduleQueries = 0;
  const statement = (sql: string) => ({
    bind() { return this; },
    async run() { return { meta: { changes: 0 } }; },
    async all() {
      if (sql.includes('FROM freelancer_auction_schedules')) scheduleQueries += 1;
      return { results: [] };
    },
  });
  const db = {
    prepare: statement,
    async batch(statements: unknown[]) { return statements.map(() => ({ meta: { changes: 0 } })); },
  };
  const env = { DB: db } as any;

  const before = await runAuctionBidResultReminders(env, new Date('2026-08-07T05:59:00.000Z'));
  assert.equal(before.due, false);
  assert.equal(scheduleQueries, 0);

  const atThree = await runAuctionBidResultReminders(env, new Date('2026-08-07T06:00:00.000Z'));
  assert.equal(atThree.due, true);
  assert.equal(scheduleQueries, 1);
});
