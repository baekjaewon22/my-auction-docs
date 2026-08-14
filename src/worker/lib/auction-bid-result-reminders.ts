import {
  auctionScheduleBidResultMissingFields,
  isAuctionScheduleBidResultDue,
} from '../../shared/auction-schedule.ts';
import { sendWebPushToUser } from './web-push-delivery.ts';
import { ensureAuctionScheduleTable } from './auction-schedule-schema.ts';

type DueSchedule = {
  id: string;
  user_id: string;
  target_date: string;
  activity_subtype: string;
  data: string;
};

function parseData(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export async function ensureAuctionBidResultReminderTable(db: D1Database): Promise<void> {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS auction_bid_result_reminder_runs (
      id TEXT PRIMARY KEY,
      schedule_id TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL,
      target_date TEXT NOT NULL,
      missing_fields_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'no_subscription')),
      sent_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_auction_bid_result_reminder_target ON auction_bid_result_reminder_runs(target_date, status)`).run();
}

export async function runAuctionBidResultReminders(
  env: Env,
  scheduledAt: Date = new Date(),
): Promise<{ due: boolean; checked: number; reminders: number; sent: number; failed: number }> {
  const kst = new Date(scheduledAt.getTime() + 9 * 60 * 60 * 1000).toISOString();
  if (Number(kst.slice(11, 13)) < 15) return { due: false, checked: 0, reminders: 0, sent: 0, failed: 0 };
  const today = kst.slice(0, 10);
  const db = env.DB;
  await Promise.all([
    ensureAuctionScheduleTable(db),
    ensureAuctionBidResultReminderTable(db),
  ]);
  const result = await db.prepare(`
    SELECT s.id, s.user_id, s.target_date, s.activity_subtype, s.data
    FROM freelancer_auction_schedules s
    JOIN users u ON u.id = s.user_id
    WHERE s.activity_type = '입찰'
      AND s.target_date = ?
      AND u.approved = 1
      AND u.role != 'resigned'
      AND COALESCE(u.login_type, 'employee') = 'freelancer'
  `).bind(today).all<DueSchedule>();
  const schedules = result.results || [];
  let reminders = 0;
  let sent = 0;
  let failed = 0;

  for (const schedule of schedules) {
    if (!isAuctionScheduleBidResultDue(schedule.target_date, scheduledAt)) continue;
    const missing = auctionScheduleBidResultMissingFields(parseData(schedule.data));
    if (!missing.length) continue;
    const runId = crypto.randomUUID();
    const claim = await db.prepare(`
      INSERT OR IGNORE INTO auction_bid_result_reminder_runs
        (id, schedule_id, user_id, target_date, missing_fields_json)
      VALUES (?, ?, ?, ?, ?)
    `).bind(runId, schedule.id, schedule.user_id, schedule.target_date, JSON.stringify(missing)).run();
    if (Number(claim.meta?.changes || 0) === 0) continue;

    reminders += 1;
    const delivery = await sendWebPushToUser(db, env, {
      userId: schedule.user_id,
      eventType: 'auction_bid_result_missing',
      title: '입찰 결과를 입력해 주세요',
      body: `${schedule.activity_subtype || '오늘 입찰'} · ${missing.join(', ')} 입력이 필요합니다.`,
      url: '/auction-schedule?requiredBidResult=1',
      tag: `auction-bid-result-${schedule.id}`,
    });
    sent += delivery.sent;
    failed += delivery.failed;
    const status = delivery.sent > 0 ? 'sent' : delivery.failed > 0 ? 'failed' : 'no_subscription';
    await db.prepare(`
      UPDATE auction_bid_result_reminder_runs
      SET status = ?, sent_count = ?, failed_count = ?, updated_at = datetime('now', '+9 hours')
      WHERE id = ?
    `).bind(status, delivery.sent, delivery.failed, runId).run();
  }

  return { due: true, checked: schedules.length, reminders, sent, failed };
}
