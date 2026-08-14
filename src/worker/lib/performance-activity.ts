export function performanceActivityCountsSql(): string {
  return `
    SELECT user_id, activity_type, COUNT(*) as cnt
    FROM (
      SELECT user_id, target_date, activity_type, data
      FROM journal_entries
      UNION ALL
      SELECT user_id, target_date, activity_type, data
      FROM freelancer_auction_schedules
    ) performance_activity_events
    WHERE target_date BETWEEN ? AND ?
      AND COALESCE(json_extract(data, '$.companion'), 0) != 1
    GROUP BY user_id, activity_type
  `;
}

export function archivedPerformanceMemberPredicateSql(userAlias = 'u'): string {
  return `(
    ${userAlias}.role != 'resigned'
    OR EXISTS (
      SELECT 1 FROM journal_entries historical_journal
      WHERE historical_journal.user_id = ${userAlias}.id
        AND historical_journal.target_date BETWEEN ? AND ?
    )
    OR EXISTS (
      SELECT 1 FROM freelancer_auction_schedules historical_schedule
      WHERE historical_schedule.user_id = ${userAlias}.id
        AND historical_schedule.target_date BETWEEN ? AND ?
    )
  )`;
}

export function isSupplementalBidAnalysisSource(
  sourceType: string | null | undefined,
  sourceId: string | null | undefined,
): boolean {
  if (sourceType === 'journal') return false;
  if (sourceType === 'freelancer' && String(sourceId || '').startsWith('auction-schedule:')) return false;
  return true;
}

export type LinkedBidSale = {
  id: string;
  status: string;
  amount: number;
  winning_price: number;
  external_id: string;
  source: 'schedule' | 'legacy';
};

export async function findCanonicalBidSale(
  db: D1Database,
  scheduleExternalId: string,
  ownerId: string,
  targetDate: string,
  caseNumber: string,
): Promise<LinkedBidSale | null> {
  const direct = await db.prepare(`
    SELECT id, status, amount, winning_price, external_id
    FROM sales_records WHERE external_id = ?
  `).bind(scheduleExternalId).first<Omit<LinkedBidSale, 'source'>>();
  if (direct) return { ...direct, source: 'schedule' };

  const normalizedCase = String(caseNumber || '').trim().replace(/\s+/g, '').toLowerCase();
  if (!normalizedCase) return null;
  const legacyTable = await db.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'freelancer_bid_entries'
  `).first<{ name: string }>();
  if (!legacyTable) return null;

  const legacy = await db.prepare(`
    SELECT sr.id, sr.status, sr.amount, sr.winning_price, sr.external_id
    FROM freelancer_bid_entries f
    JOIN sales_records sr ON sr.external_id = 'freelancer-bid:' || f.id
    WHERE f.user_id = ?
      AND f.bid_date = ?
      AND lower(replace(COALESCE(f.case_number, ''), ' ', '')) = ?
    ORDER BY f.updated_at DESC
    LIMIT 1
  `).bind(ownerId, targetDate, normalizedCase).first<Omit<LinkedBidSale, 'source'>>();
  return legacy ? { ...legacy, source: 'legacy' } : null;
}

export function matchingAuctionScheduleExistsSql(
  userIdExpr: string,
  dateExpr: string,
  caseNumberExpr: string,
): string {
  return `EXISTS (
    SELECT 1
    FROM freelancer_auction_schedules matching_schedule
    WHERE matching_schedule.activity_type = '입찰'
      AND matching_schedule.user_id = ${userIdExpr}
      AND matching_schedule.target_date = substr(${dateExpr}, 1, 10)
      AND COALESCE(json_extract(matching_schedule.data, '$.caseNo'), '') != ''
      AND lower(replace(COALESCE(json_extract(matching_schedule.data, '$.caseNo'), ''), ' ', ''))
        = lower(replace(COALESCE(${caseNumberExpr}, ''), ' ', ''))
  )`;
}
