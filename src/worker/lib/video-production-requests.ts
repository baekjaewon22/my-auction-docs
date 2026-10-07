import {
  calculateVideoProductionNet,
  calculateVideoProductionWithholding,
  VIDEO_PRODUCTION_STATUS_LABELS,
  VIDEO_PRODUCTION_TYPE_LABELS,
  type VideoProductionStatus,
  type VideoProductionType,
} from '../../shared/video-production.ts';

export type VideoProductionRequestRow = {
  id: string;
  assignee_user_id: string;
  assignee_name?: string;
  assignee_branch?: string;
  assignee_department?: string;
  assignee_position_title?: string;
  video_type: VideoProductionType;
  status: VideoProductionStatus;
  quantity: number;
  unit_amount: number;
  amount: number;
  request_date: string;
  provided_date: string;
  submit_due_date: string;
  result_received_date: string;
  title: string;
  memo: string;
  created_by: string;
  created_by_name?: string;
  updated_by: string;
  updated_by_name?: string;
  created_at: string;
  updated_at: string;
};

export type VideoProductionPayrollSummary = {
  total_count: number;
  short_count: number;
  long_count: number;
  total_amount: number;
  withholding_tax: number;
  net_amount: number;
  items: Array<{
    id: string;
    video_type: VideoProductionType;
    type_label: string;
    title: string;
    quantity: number;
    unit_amount: number;
    amount: number;
    result_received_date: string;
  }>;
};

const preparedVideoProductionDatabases = new WeakSet<object>();

export async function ensureVideoProductionRequestTable(db: D1Database): Promise<void> {
  if (preparedVideoProductionDatabases.has(db as unknown as object)) return;
  await db.batch([
    db.prepare(`
      CREATE TABLE IF NOT EXISTS video_production_requests (
        id TEXT PRIMARY KEY,
        assignee_user_id TEXT NOT NULL,
        video_type TEXT NOT NULL DEFAULT 'short_form',
        status TEXT NOT NULL DEFAULT 'requested',
        quantity INTEGER NOT NULL DEFAULT 1,
        unit_amount INTEGER NOT NULL DEFAULT 30000,
        amount INTEGER NOT NULL DEFAULT 30000,
        request_date TEXT NOT NULL,
        provided_date TEXT NOT NULL DEFAULT '',
        submit_due_date TEXT NOT NULL DEFAULT '',
        result_received_date TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        memo TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL DEFAULT '',
        updated_by TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
        CHECK (video_type IN ('short_form', 'long_form')),
        CHECK (status IN ('requested', 'confirmed')),
        FOREIGN KEY (assignee_user_id) REFERENCES users(id) ON DELETE RESTRICT
      )
    `),
    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_video_production_assignee_result
      ON video_production_requests(assignee_user_id, status, result_received_date)
    `),
    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_video_production_calendar_dates
      ON video_production_requests(request_date, provided_date, submit_due_date, result_received_date)
    `),
  ]);
  const columns = await db.prepare('PRAGMA table_info(video_production_requests)').all<{ name: string }>();
  const columnNames = new Set((columns.results || []).map((column) => column.name));
  const addedColumns: string[] = [];
  if (!columnNames.has('quantity')) {
    await db.prepare('ALTER TABLE video_production_requests ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1').run();
    addedColumns.push('quantity');
  }
  if (!columnNames.has('unit_amount')) {
    await db.prepare('ALTER TABLE video_production_requests ADD COLUMN unit_amount INTEGER NOT NULL DEFAULT 30000').run();
    addedColumns.push('unit_amount');
  }
  if (addedColumns.length) {
    await db.prepare(`
      UPDATE video_production_requests
      SET quantity = CASE WHEN quantity IS NULL OR quantity < 1 THEN 1 ELSE quantity END,
        unit_amount = CASE
          WHEN unit_amount IS NULL OR unit_amount <= 0 THEN COALESCE(NULLIF(amount, 0), 30000)
          ELSE unit_amount
        END,
        amount = CASE
          WHEN amount IS NULL OR amount <= 0 THEN COALESCE(NULLIF(unit_amount, 0), 30000) * CASE WHEN quantity IS NULL OR quantity < 1 THEN 1 ELSE quantity END
          ELSE amount
        END
    `).run();
  }
  preparedVideoProductionDatabases.add(db as unknown as object);
}

export function emptyVideoProductionPayrollSummary(): VideoProductionPayrollSummary {
  return {
    total_count: 0,
    short_count: 0,
    long_count: 0,
    total_amount: 0,
    withholding_tax: 0,
    net_amount: 0,
    items: [],
  };
}

export async function loadVideoProductionPayrollSummary(
  db: D1Database,
  userId: string,
  month: string,
): Promise<VideoProductionPayrollSummary> {
  if (!/^\d{4}-\d{2}$/.test(month)) return emptyVideoProductionPayrollSummary();
  await ensureVideoProductionRequestTable(db);
  const [year, monthText] = month.split('-').map(Number);
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-${String(new Date(year, monthText, 0).getDate()).padStart(2, '0')}`;
  const result = await db.prepare(`
    SELECT id, video_type, title, quantity, unit_amount, amount, result_received_date
    FROM video_production_requests
    WHERE assignee_user_id = ?
      AND status = 'confirmed'
      AND result_received_date >= ?
      AND result_received_date <= ?
    ORDER BY result_received_date ASC, created_at ASC
  `).bind(userId, monthStart, monthEnd).all<{
    id: string;
    video_type: VideoProductionType;
    title: string;
    quantity: number;
    unit_amount: number;
    amount: number;
    result_received_date: string;
  }>();

  const items = (result.results || []).map((row) => {
    const quantity = Math.max(Number(row.quantity) || 1, 1);
    const unitAmount = Number(row.unit_amount) || Math.trunc((Number(row.amount) || 0) / quantity);
    return {
      id: row.id,
      video_type: row.video_type,
      type_label: VIDEO_PRODUCTION_TYPE_LABELS[row.video_type] || row.video_type,
      title: row.title || VIDEO_PRODUCTION_TYPE_LABELS[row.video_type] || '영상제작',
      quantity,
      unit_amount: unitAmount,
      amount: Number(row.amount) || unitAmount * quantity,
      result_received_date: row.result_received_date,
    };
  });
  const totalAmount = items.reduce((sum, item) => sum + item.amount, 0);
  const withholdingTax = calculateVideoProductionWithholding(totalAmount);
  return {
    total_count: items.reduce((sum, item) => sum + item.quantity, 0),
    short_count: items.filter((item) => item.video_type === 'short_form').reduce((sum, item) => sum + item.quantity, 0),
    long_count: items.filter((item) => item.video_type === 'long_form').reduce((sum, item) => sum + item.quantity, 0),
    total_amount: totalAmount,
    withholding_tax: withholdingTax,
    net_amount: calculateVideoProductionNet(totalAmount),
    items,
  };
}

function videoEventContent(
  row: VideoProductionRequestRow,
  phaseLabel: string,
): string {
  const typeLabel = VIDEO_PRODUCTION_TYPE_LABELS[row.video_type] || row.video_type;
  const statusLabel = VIDEO_PRODUCTION_STATUS_LABELS[row.status] || row.status;
  const quantity = Math.max(Number(row.quantity) || 1, 1);
  const unitAmount = Number(row.unit_amount) || Math.trunc((Number(row.amount) || 0) / quantity);
  const amount = Number(row.amount) || unitAmount * quantity;
  const lines = [
    `단계: ${phaseLabel}`,
    `담당자: ${row.assignee_name || '-'}`,
    `유형: ${typeLabel}`,
    `건수: ${quantity.toLocaleString('ko-KR')}건`,
    `상태: ${statusLabel}`,
    `금액: ${unitAmount.toLocaleString('ko-KR')}원 × ${quantity.toLocaleString('ko-KR')}건 = ${amount.toLocaleString('ko-KR')}원`,
  ];
  if (row.title) lines.push(`제목: ${row.title}`);
  if (row.memo) lines.push(`메모: ${row.memo}`);
  return lines.join('\n');
}

export function buildVideoProductionCalendarEvents(rows: VideoProductionRequestRow[]) {
  const events: Array<Record<string, unknown>> = [];
  const phaseConfig: Array<{
    field: 'request_date' | 'result_received_date';
    phase: 'request' | 'result';
    label: string;
    color: string;
  }> = [
    { field: 'request_date', phase: 'request', label: '의뢰', color: '#2563eb' },
    { field: 'result_received_date', phase: 'result', label: '결과물', color: '#16a34a' },
  ];
  for (const row of rows) {
    const typeLabel = VIDEO_PRODUCTION_TYPE_LABELS[row.video_type] || row.video_type;
    const statusLabel = VIDEO_PRODUCTION_STATUS_LABELS[row.status] || row.status;
    const quantity = Math.max(Number(row.quantity) || 1, 1);
    const unitAmount = Number(row.unit_amount) || Math.trunc((Number(row.amount) || 0) / quantity);
    const amount = Number(row.amount) || unitAmount * quantity;
    for (const config of phaseConfig) {
      const date = String(row[config.field] || '');
      if (!date) continue;
      events.push({
        id: `video-production:${row.id}:${config.phase}`,
        source_id: row.id,
        source_type: 'video_production',
        video_production_phase: config.phase,
        event_date: date,
        end_date: date,
        title: `[영상] ${config.label} · ${row.assignee_name || '담당자'} · ${typeLabel}`,
        content: videoEventContent(row, config.label),
        color: config.color,
        all_day: 1,
        created_at: row.created_at,
        updated_at: row.updated_at,
        assignee_name: row.assignee_name,
        branch: row.assignee_branch,
        position_title: row.assignee_position_title,
        video_type: row.video_type,
        video_type_label: typeLabel,
        video_quantity: quantity,
        video_unit_amount: unitAmount,
        video_amount: amount,
        video_status: row.status,
        video_status_label: statusLabel,
      });
    }
  }
  return events;
}
