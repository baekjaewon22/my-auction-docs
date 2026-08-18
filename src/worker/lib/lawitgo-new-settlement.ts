export type LawitgoConsultantStatement = {
  title: string;
  format: 'text';
  content: string;
};

export type LawitgoNewSettlementItem = {
  external_id: string;
  case_id: string;
  client_name: string;
  settlement_date: string;
  payroll_month: string;
  amount: number;
  statement: LawitgoConsultantStatement | null;
  updated_at: string;
};

const schemaReadyByDb = new WeakMap<object, Promise<void>>();

export function ensureLawitgoNewSettlementTable(db: D1Database): Promise<void> {
  const key = db as unknown as object;
  const current = schemaReadyByDb.get(key);
  if (current) return current;

  const pending = (async () => {
    await db.prepare(`
    CREATE TABLE IF NOT EXISTS case_hidden (
      external_id TEXT PRIMARY KEY,
      case_id TEXT,
      hidden_by TEXT NOT NULL,
      hidden_reason TEXT DEFAULT '',
      hidden_at TEXT DEFAULT (datetime('now'))
    )
    `).run();
    await db.prepare(`
    CREATE TABLE IF NOT EXISTS lawitgo_new_settlements (
      id TEXT PRIMARY KEY,
      external_id TEXT NOT NULL UNIQUE,
      progress_id TEXT,
      case_id TEXT NOT NULL,
      consultant_user_id TEXT NOT NULL,
      client_name TEXT NOT NULL,
      settlement_date TEXT NOT NULL,
      payroll_month TEXT NOT NULL,
      consultant_share INTEGER NOT NULL CHECK(consultant_share >= 0),
      statement_title TEXT,
      statement_format TEXT,
      statement_content TEXT,
      source_registered_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
    `).run();
    const columns = await db.prepare('PRAGMA table_info(lawitgo_new_settlements)').all<{ name: string }>();
    if (!(columns.results || []).some((column) => column.name === 'progress_id')) {
      await db.prepare('ALTER TABLE lawitgo_new_settlements ADD COLUMN progress_id TEXT').run();
      await db.prepare("UPDATE lawitgo_new_settlements SET progress_id = external_id WHERE progress_id IS NULL OR progress_id = ''").run();
    }
    const columnNames = new Set((columns.results || []).map((column) => column.name));
    if (!columnNames.has('deleted_at')) await db.prepare('ALTER TABLE lawitgo_new_settlements ADD COLUMN deleted_at TEXT').run();
    if (!columnNames.has('deleted_by')) await db.prepare('ALTER TABLE lawitgo_new_settlements ADD COLUMN deleted_by TEXT').run();
    if (!columnNames.has('delete_reason')) await db.prepare("ALTER TABLE lawitgo_new_settlements ADD COLUMN delete_reason TEXT NOT NULL DEFAULT ''").run();
    if (!columnNames.has('manual_override_at')) await db.prepare('ALTER TABLE lawitgo_new_settlements ADD COLUMN manual_override_at TEXT').run();
    if (!columnNames.has('manual_override_by')) await db.prepare('ALTER TABLE lawitgo_new_settlements ADD COLUMN manual_override_by TEXT').run();
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS lawitgo_new_settlement_audit (
        id TEXT PRIMARY KEY,
        settlement_id TEXT NOT NULL,
        external_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK(action IN ('update', 'delete')),
        before_json TEXT NOT NULL,
        after_json TEXT,
        reason TEXT NOT NULL DEFAULT '',
        changed_by TEXT NOT NULL,
        changed_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_lawitgo_new_settlement_audit_settlement ON lawitgo_new_settlement_audit(settlement_id, changed_at DESC)').run();
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_lawitgo_new_settlements_payroll ON lawitgo_new_settlements(consultant_user_id, payroll_month)').run();
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_lawitgo_new_settlements_case ON lawitgo_new_settlements(case_id)').run();
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_lawitgo_new_settlements_progress ON lawitgo_new_settlements(progress_id)').run();
  })();
  schemaReadyByDb.set(key, pending);
  return pending.catch((error) => {
    if (schemaReadyByDb.get(key) === pending) schemaReadyByDb.delete(key);
    throw error;
  });
}

export async function getLawitgoStatementByProgress(
  db: D1Database,
  progressId: string,
): Promise<LawitgoConsultantStatement | null> {
  await ensureLawitgoNewSettlementTable(db);
  const row = await db.prepare(`
    SELECT statement_title, statement_format, statement_content
    FROM lawitgo_new_settlements
    WHERE (progress_id = ? OR (progress_id IS NULL AND external_id = ?))
      AND deleted_at IS NULL
      AND statement_content IS NOT NULL AND statement_content != ''
      AND NOT EXISTS (
        SELECT 1 FROM case_hidden ch
        WHERE ch.external_id = lawitgo_new_settlements.external_id
      )
    ORDER BY updated_at DESC
    LIMIT 1
  `).bind(progressId, progressId).first<any>();
  if (!row) return null;
  return {
    title: row.statement_title || '결산내역서',
    format: 'text',
    content: row.statement_content,
  };
}

export async function getLawitgoNewSettlements(
  db: D1Database,
  consultantUserId: string,
  payrollMonth: string,
): Promise<LawitgoNewSettlementItem[]> {
  await ensureLawitgoNewSettlementTable(db);
  const result = await db.prepare(`
    SELECT l.external_id, l.case_id, l.client_name, l.settlement_date, l.payroll_month,
      l.consultant_share as amount, l.statement_title, l.statement_format,
      l.statement_content, l.updated_at
    FROM lawitgo_new_settlements l
    WHERE l.consultant_user_id = ? AND l.payroll_month = ?
      AND l.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM case_hidden ch WHERE ch.external_id = l.external_id)
    ORDER BY l.settlement_date, l.created_at
  `).bind(consultantUserId, payrollMonth).all<any>();

  return (result.results || []).map((row: any) => ({
    external_id: row.external_id,
    case_id: row.case_id,
    client_name: row.client_name,
    settlement_date: row.settlement_date,
    payroll_month: row.payroll_month,
    amount: Number(row.amount) || 0,
    statement: row.statement_content ? {
      title: row.statement_title || '담당컨설턴트 열람용 결산내역서',
      format: 'text',
      content: row.statement_content,
    } : null,
    updated_at: row.updated_at,
  }));
}
