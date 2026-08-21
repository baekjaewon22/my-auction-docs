import { normalizeAuctionCaseSearch } from '../../shared/auction-schedule.ts';

export interface AuctionInspectionSuggestion {
  id: string;
  target_date: string;
  bid_date: string;
  case_no: string;
  item_no: string;
  client: string;
  court: string;
  place: string;
  property_category: string;
  property_type: string;
}

function parseData(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export async function findAuctionInspectionSuggestions(
  db: D1Database,
  ownerId: string,
  rawQuery: unknown,
): Promise<AuctionInspectionSuggestion[]> {
  const query = normalizeAuctionCaseSearch(rawQuery).slice(0, 100);
  if (!ownerId || !query) return [];
  const rows = await db.prepare(`
    SELECT id, target_date, data
    FROM freelancer_auction_schedules
    WHERE user_id = ?
      AND activity_type = '임장'
      AND COALESCE(json_extract(data, '$.companion'), 0) != 1
      AND json_extract(data, '$.bidDate') GLOB '????-??-??'
      AND (
        instr(REPLACE(COALESCE(json_extract(data, '$.caseNo'), ''), ' ', ''), ?) > 0
        OR instr(lower(REPLACE(COALESCE(json_extract(data, '$.client'), ''), ' ', '')), lower(?)) > 0
      )
    ORDER BY json_extract(data, '$.bidDate') DESC, target_date DESC, created_at DESC
    LIMIT 12
  `).bind(ownerId, query, query).all<{ id: string; target_date: string; data: string }>();

  return (rows.results || []).map((row) => {
    const data = parseData(row.data);
    return {
      id: row.id,
      target_date: row.target_date,
      bid_date: String(data.bidDate || ''),
      case_no: String(data.caseNo || ''),
      item_no: String(data.itemNo || ''),
      client: String(data.client || ''),
      court: String(data.court || ''),
      place: String(data.place || ''),
      property_category: String(data.propertyCategory || ''),
      property_type: String(data.propertyType || ''),
    };
  });
}
