export type AuctionStoryStage = 'inspection' | 'briefing' | 'bid';

export interface AuctionStoryStageRow {
  id: string;
  user_id: string;
  user_name: string;
  position_title: string;
  branch: string;
  activity_type: '임장' | '브리핑자료제출' | '입찰';
  activity_subtype: string;
  target_date: string;
  data: string;
  source_kind: 'freelancer' | 'journal';
  updated_at: string;
}

export interface AuctionStoryAnomaly {
  id: string;
  reference_date: string;
  branch: string;
  assignee_id: string;
  assignee_name: string;
  position_title: string;
  property_category: string;
  property_type: string;
  court: string;
  case_no: string;
  item_no: string;
  client_name: string;
  inspection_date: string;
  briefing_date: string;
  bid_date: string;
  missing_stages: AuctionStoryStage[];
}

function parseData(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalize(value: unknown): string {
  return String(value || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

function stageOf(activityType: AuctionStoryStageRow['activity_type']): AuctionStoryStage {
  if (activityType === '임장') return 'inspection';
  if (activityType === '브리핑자료제출') return 'briefing';
  return 'bid';
}

function fieldsOf(row: AuctionStoryStageRow) {
  const data = parseData(row.data);
  return {
    data,
    stage: stageOf(row.activity_type),
    court: String(data.briefingCourt || data.court || ''),
    caseNo: String(
      data.briefingCaseNo
      || data.caseNo
      || (row.activity_type === '브리핑자료제출' ? row.activity_subtype : ''),
    ),
    itemNo: String(data.briefingItemNo || data.itemNo || ''),
    clientName: String(data.client || data.clientName || data.bidder || ''),
    propertyCategory: String(data.propertyCategory || ''),
    propertyType: String(data.propertyType || ''),
    inspectionBidDate: row.activity_type === '임장' ? String(data.bidDate || '') : '',
  };
}

function compatibleItem(left: string, right: string): boolean {
  return left === right || !left || !right;
}

export function buildAuctionStoryAnomalies(
  rows: AuctionStoryStageRow[],
  from: string,
  to: string,
): AuctionStoryAnomaly[] {
  type StoryGroup = {
    rows: Array<{ row: AuctionStoryStageRow; fields: ReturnType<typeof fieldsOf> }>;
    itemNo: string;
  };
  const groups = new Map<string, StoryGroup[]>();

  for (const row of rows) {
    const fields = fieldsOf(row);
    const court = normalize(fields.court);
    const caseNo = normalize(fields.caseNo);
    const baseKey = court && caseNo
      ? `${row.user_id}|${court}|${caseNo}`
      : `unmatched:${row.source_kind}:${row.id}`;
    const itemNo = normalize(fields.itemNo);
    const candidates = groups.get(baseKey) || [];
    let group = candidates.find(candidate => compatibleItem(candidate.itemNo, itemNo));
    if (!group) {
      group = { rows: [], itemNo };
      candidates.push(group);
      groups.set(baseKey, candidates);
    } else if (!group.itemNo && itemNo) {
      group.itemNo = itemNo;
    }
    group.rows.push({ row, fields });
  }

  const anomalies: AuctionStoryAnomaly[] = [];
  for (const candidates of groups.values()) {
    for (const group of candidates) {
      const ordered = group.rows.slice().sort((left, right) => String(right.row.updated_at).localeCompare(String(left.row.updated_at)));
      const stages = new Map<AuctionStoryStage, typeof ordered[number]>();
      for (const entry of ordered) if (!stages.has(entry.fields.stage)) stages.set(entry.fields.stage, entry);
      const inspection = stages.get('inspection');
      const briefing = stages.get('briefing');
      const bid = stages.get('bid');
      // 결과 중심 검사: 실제 입찰 일정이 없는 임장·브리핑 기록은 이상행위로 보지 않는다.
      if (!bid) continue;
      const referenceDate = bid.row.target_date;
      if (!referenceDate || referenceDate < from || referenceDate > to) continue;

      const missingStages = (['inspection', 'briefing'] as AuctionStoryStage[]).filter(stage => !stages.has(stage));
      if (missingStages.length === 0) continue;
      const preferred = bid;
      const merged = [...ordered].reverse().reduce((acc, entry) => ({
        court: entry.fields.court || acc.court,
        caseNo: entry.fields.caseNo || acc.caseNo,
        itemNo: entry.fields.itemNo || acc.itemNo,
        clientName: entry.fields.clientName || acc.clientName,
        propertyCategory: entry.fields.propertyCategory || acc.propertyCategory,
        propertyType: entry.fields.propertyType || acc.propertyType,
      }), { court: '', caseNo: '', itemNo: '', clientName: '', propertyCategory: '', propertyType: '' });

      anomalies.push({
        id: `${preferred.row.user_id}|${normalize(merged.court)}|${normalize(merged.caseNo)}|${normalize(merged.itemNo) || '0'}`,
        reference_date: referenceDate,
        branch: preferred.row.branch,
        assignee_id: preferred.row.user_id,
        assignee_name: preferred.row.user_name,
        position_title: preferred.row.position_title,
        property_category: merged.propertyCategory || merged.propertyType || '미분류',
        property_type: merged.propertyType,
        court: merged.court,
        case_no: merged.caseNo,
        item_no: merged.itemNo,
        client_name: merged.clientName,
        inspection_date: inspection?.row.target_date || '',
        briefing_date: briefing?.row.target_date || '',
        bid_date: bid.row.target_date,
        missing_stages: missingStages,
      });
    }
  }

  return anomalies.sort((left, right) =>
    right.reference_date.localeCompare(left.reference_date)
      || left.branch.localeCompare(right.branch, 'ko')
      || left.assignee_name.localeCompare(right.assignee_name, 'ko')
  );
}

function shiftDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export async function loadAuctionStoryStageRows(
  db: D1Database,
  from: string,
  to: string,
  branches: string[],
): Promise<AuctionStoryStageRow[]> {
  if (branches.length === 0) return [];
  const placeholders = branches.map(() => '?').join(',');
  const expandedFrom = shiftDate(from, -180);
  const expandedTo = shiftDate(to, 60);
  const result = await db.prepare(`
    SELECT s.id, s.user_id, u.name AS user_name, u.position_title, u.branch,
      s.activity_type, COALESCE(s.activity_subtype, '') AS activity_subtype,
      s.target_date, s.data, 'freelancer' AS source_kind, s.updated_at
    FROM freelancer_auction_schedules s
    JOIN users u ON u.id = s.user_id
    WHERE s.activity_type IN ('임장', '입찰')
      AND (s.activity_type != '임장' OR COALESCE(json_extract(s.data, '$.companion'), 0) != 1)
      AND u.approved = 1 AND u.role != 'resigned'
      AND u.branch IN (${placeholders})
      AND (
        s.target_date BETWEEN ? AND ?
        OR json_extract(s.data, '$.bidDate') BETWEEN ? AND ?
      )
    UNION ALL
    SELECT j.id, j.user_id, u.name AS user_name, u.position_title, u.branch,
      j.activity_type, COALESCE(j.activity_subtype, '') AS activity_subtype,
      j.target_date, j.data, 'journal' AS source_kind, j.updated_at
    FROM journal_entries j
    JOIN users u ON u.id = j.user_id
    WHERE j.activity_type IN ('임장', '브리핑자료제출', '입찰')
      AND (j.activity_type != '임장' OR COALESCE(json_extract(j.data, '$.companion'), 0) != 1)
      AND u.approved = 1 AND u.role != 'resigned'
      AND u.branch IN (${placeholders})
      AND (
        j.target_date BETWEEN ? AND ?
        OR json_extract(j.data, '$.bidDate') BETWEEN ? AND ?
      )
  `).bind(
    ...branches, expandedFrom, expandedTo, expandedFrom, expandedTo,
    ...branches, expandedFrom, expandedTo, expandedFrom, expandedTo,
  ).all<AuctionStoryStageRow>();
  return result.results || [];
}
