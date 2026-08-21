import {
  auctionScheduleBidResult,
  auctionScheduleAutoCancellationCutoff,
} from '../../shared/auction-schedule.ts';
import { ensureAuctionScheduleTable } from './auction-schedule-schema.ts';
import { ensureBidAnalysisTable, normalizeAmount, upsertBidAnalysisEntry } from './bid-analysis.ts';

type PendingBidSchedule = {
  id: string;
  user_id: string;
  user_name: string;
  target_date: string;
  branch: string;
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

function kstTimestamp(now: Date): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

/**
 * 입찰일 다음 날부터 5일 전체를 결과 입력 기간으로 두고 그 다음 날 미결 일정만 취소한다.
 * UPDATE의 JSON 상태 조건은 Cron 조회 뒤 사용자가 결과를 입력한 경쟁 상황을 막는다.
 */
export async function runAuctionScheduleAutoCancellation(
  env: Pick<Env, 'DB'>,
  scheduledAt: Date = new Date(),
): Promise<{ cutoff: string; checked: number; cancelled: number }> {
  const db = env.DB;
  const cutoff = auctionScheduleAutoCancellationCutoff(scheduledAt);
  await Promise.all([ensureAuctionScheduleTable(db), ensureBidAnalysisTable(db)]);
  const rows = await db.prepare(`
    SELECT s.id, s.user_id, u.name AS user_name, s.target_date, s.branch, s.data
    FROM freelancer_auction_schedules s
    JOIN users u ON u.id = s.user_id
    WHERE s.activity_type = '입찰'
      AND s.target_date <= ?
      AND COALESCE(json_extract(s.data, '$.bidWon'), 0) = 0
      AND COALESCE(json_extract(s.data, '$.bidFailed'), 0) = 0
      AND COALESCE(json_extract(s.data, '$.bidCancelled'), 0) = 0
      AND COALESCE(json_extract(s.data, '$.bidResultCancelled'), 0) = 0
    ORDER BY s.target_date, s.created_at
  `).bind(cutoff).all<PendingBidSchedule>();

  let cancelled = 0;
  for (const row of rows.results || []) {
    const data = parseData(row.data);
    if (auctionScheduleBidResult(data) !== 'pending') continue;
    const nextData = {
      ...data,
      bidWon: false,
      bidFailed: false,
      bidCancelled: false,
      bidResultCancelled: true,
      bidResultCancelledAutomatically: true,
      bidResultCancelledAt: kstTimestamp(scheduledAt),
      winPrice: '',
    };
    const updated = await db.prepare(`
      UPDATE freelancer_auction_schedules
      SET data = ?, updated_at = datetime('now', '+9 hours')
      WHERE id = ?
        AND COALESCE(json_extract(data, '$.bidWon'), 0) = 0
        AND COALESCE(json_extract(data, '$.bidFailed'), 0) = 0
        AND COALESCE(json_extract(data, '$.bidCancelled'), 0) = 0
        AND COALESCE(json_extract(data, '$.bidResultCancelled'), 0) = 0
    `).bind(JSON.stringify(nextData), row.id).run();
    if (Number(updated.meta?.changes || 0) === 0) continue;

    cancelled += 1;
    await upsertBidAnalysisEntry(db, {
      bid_datetime: row.target_date,
      assignee_user_id: row.user_id,
      assignee_name: row.user_name || '',
      branch_name: row.branch || '',
      case_number: String(data.caseNo || ''),
      property_type: String(data.propertyType || ''),
      suggested_bid_price: normalizeAmount(data.suggestedPrice),
      actual_bid_price: normalizeAmount(data.bidPrice),
      winning_price: null,
      bid_result: '취소',
      client_name: String(data.bidder || data.client || ''),
      source_type: 'freelancer',
      source_id: `auction-schedule:${row.id}`,
      uploaded_by: row.user_id,
    });
  }

  return { cutoff, checked: (rows.results || []).length, cancelled };
}
