export type DocumentRetentionResult = {
  retention_months: number;
  cutoff: string;
  dry_run: boolean;
  documents: number;
  approval_steps: number;
  signatures: number;
  document_logs: number;
  drive_backup_logs: number;
  alert_approval_pending: number;
  document_journal_links: number;
  document_journal_link_candidates: number;
  document_journal_link_backfill_log: number;
  orphan_drive_backup_logs: number;
};

type CountRow = { cnt: number };
type RunResult = { meta?: { changes?: number } };

const RETENTION_MONTHS = 2;
const CUTOFF_SQL = "datetime('now', '-2 months')";

const TARGET_DOCS_SQL = `SELECT id FROM documents WHERE updated_at < ${CUTOFF_SQL}`;

async function count(db: D1Database, sql: string): Promise<number> {
  const row = await db.prepare(sql).first<CountRow>();
  return Number(row?.cnt || 0);
}

async function runDelete(db: D1Database, sql: string): Promise<number> {
  const result = await db.prepare(sql).run() as RunResult;
  return Number(result?.meta?.changes || 0);
}

export async function cleanupOldDocuments(db: D1Database, opts: { dryRun?: boolean } = {}): Promise<DocumentRetentionResult> {
  const dryRun = opts.dryRun !== false;
  const cutoffRow = await db.prepare(`SELECT ${CUTOFF_SQL} AS cutoff`).first<{ cutoff: string }>();
  const result: DocumentRetentionResult = {
    retention_months: RETENTION_MONTHS,
    cutoff: cutoffRow?.cutoff || '',
    dry_run: dryRun,
    documents: await count(db, `SELECT COUNT(*) AS cnt FROM documents WHERE updated_at < ${CUTOFF_SQL}`),
    approval_steps: await count(db, `SELECT COUNT(*) AS cnt FROM approval_steps WHERE document_id IN (${TARGET_DOCS_SQL})`),
    signatures: await count(db, `SELECT COUNT(*) AS cnt FROM signatures WHERE document_id IN (${TARGET_DOCS_SQL})`),
    document_logs: await count(db, `SELECT COUNT(*) AS cnt FROM document_logs WHERE document_id IN (${TARGET_DOCS_SQL})`),
    drive_backup_logs: await count(db, `SELECT COUNT(*) AS cnt FROM drive_backup_logs WHERE document_id IN (${TARGET_DOCS_SQL})`),
    alert_approval_pending: await count(db, `SELECT COUNT(*) AS cnt FROM alert_approval_pending WHERE document_id IN (${TARGET_DOCS_SQL})`),
    document_journal_links: await count(db, `SELECT COUNT(*) AS cnt FROM document_journal_links WHERE document_id IN (${TARGET_DOCS_SQL})`),
    document_journal_link_candidates: await count(db, `SELECT COUNT(*) AS cnt FROM document_journal_link_candidates WHERE document_id IN (${TARGET_DOCS_SQL})`),
    document_journal_link_backfill_log: await count(db, `SELECT COUNT(*) AS cnt FROM document_journal_link_backfill_log WHERE document_id IN (${TARGET_DOCS_SQL})`),
    orphan_drive_backup_logs: await count(db, `SELECT COUNT(*) AS cnt FROM drive_backup_logs WHERE document_id NOT IN (SELECT id FROM documents)`),
  };

  if (dryRun || (result.documents === 0 && result.orphan_drive_backup_logs === 0)) return result;

  result.document_journal_link_backfill_log = await runDelete(db, `DELETE FROM document_journal_link_backfill_log WHERE document_id IN (${TARGET_DOCS_SQL})`);
  result.document_journal_link_candidates = await runDelete(db, `DELETE FROM document_journal_link_candidates WHERE document_id IN (${TARGET_DOCS_SQL})`);
  result.document_journal_links = await runDelete(db, `DELETE FROM document_journal_links WHERE document_id IN (${TARGET_DOCS_SQL})`);
  result.alert_approval_pending = await runDelete(db, `DELETE FROM alert_approval_pending WHERE document_id IN (${TARGET_DOCS_SQL})`);
  result.drive_backup_logs = await runDelete(db, `DELETE FROM drive_backup_logs WHERE document_id IN (${TARGET_DOCS_SQL})`);
  result.approval_steps = await runDelete(db, `DELETE FROM approval_steps WHERE document_id IN (${TARGET_DOCS_SQL})`);
  result.signatures = await runDelete(db, `DELETE FROM signatures WHERE document_id IN (${TARGET_DOCS_SQL})`);
  result.document_logs = await runDelete(db, `DELETE FROM document_logs WHERE document_id IN (${TARGET_DOCS_SQL})`);
  result.documents = await runDelete(db, `DELETE FROM documents WHERE updated_at < ${CUTOFF_SQL}`);
  result.orphan_drive_backup_logs = await runDelete(db, `DELETE FROM drive_backup_logs WHERE document_id NOT IN (SELECT id FROM documents)`);
  result.dry_run = false;
  return result;
}

interface D1Database {
  prepare(query: string): {
    bind(...values: unknown[]): {
      run(): Promise<unknown>;
      all<T = unknown>(): Promise<{ results: T[] }>;
      first<T = unknown>(): Promise<T | null>;
    };
    run(): Promise<unknown>;
    all<T = unknown>(): Promise<{ results: T[] }>;
    first<T = unknown>(): Promise<T | null>;
  };
}
