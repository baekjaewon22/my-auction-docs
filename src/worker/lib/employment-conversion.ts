import type { FreelancerConversionImpact } from '../../shared/employment-conversion.ts';
import { ensureTemplateAccessSchema } from './template-access.ts';

export async function ensureEmploymentTypeHistoryTable(db: D1Database): Promise<void> {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS user_employment_type_history (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      from_login_type TEXT NOT NULL CHECK (from_login_type IN ('employee', 'freelancer')),
      to_login_type TEXT NOT NULL CHECK (to_login_type IN ('employee', 'freelancer')),
      effective_month TEXT NOT NULL,
      changed_by TEXT NOT NULL,
      impact_snapshot TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `).run();
  await db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_user_employment_type_history_user
    ON user_employment_type_history(user_id, created_at DESC)
  `).run();
}

async function countFirst(db: D1Database, sql: string, userId: string): Promise<number> {
  const row = await db.prepare(sql).bind(userId).first<{ count: number }>();
  return Number(row?.count || 0);
}

export async function getFreelancerConversionImpact(
  db: D1Database,
  userId: string,
): Promise<FreelancerConversionImpact> {
  // Older D1 databases may not have the document classification column yet.
  await ensureTemplateAccessSchema(db);

  const [
    pendingLeaveRequests,
    pendingApprovalSteps,
    documents,
    nonMyAuctionDocuments,
    activeNonMyAuctionDocuments,
    salesRecords,
    cases,
    orgNodes,
    annualLeave,
  ] = await Promise.all([
    countFirst(
      db,
      "SELECT COUNT(*) AS count FROM leave_requests WHERE user_id = ? AND status IN ('pending', 'cancel_requested')",
      userId,
    ),
    countFirst(
      db,
      `SELECT COUNT(*) AS count
       FROM approval_steps aps
       JOIN documents d ON d.id = aps.document_id
       WHERE aps.approver_id = ? AND aps.status = 'pending' AND d.status = 'submitted'`,
      userId,
    ),
    countFirst(db, 'SELECT COUNT(*) AS count FROM documents WHERE author_id = ?', userId),
    countFirst(
      db,
      'SELECT COUNT(*) AS count FROM documents WHERE author_id = ? AND COALESCE(is_myauction, 0) = 0',
      userId,
    ),
    countFirst(
      db,
      `SELECT COUNT(*) AS count
       FROM documents
       WHERE author_id = ?
         AND COALESCE(is_myauction, 0) = 0
         AND status IN ('draft', 'submitted', 'rejected')`,
      userId,
    ),
    countFirst(db, 'SELECT COUNT(*) AS count FROM sales_records WHERE user_id = ?', userId),
    countFirst(db, 'SELECT COUNT(*) AS count FROM cases WHERE consultant_user_id = ?', userId),
    countFirst(db, 'SELECT COUNT(*) AS count FROM org_nodes WHERE user_id = ?', userId),
    db.prepare(
      'SELECT total_days, used_days FROM annual_leave WHERE user_id = ?'
    ).bind(userId).first<{ total_days: number; used_days: number }>(),
  ]);

  return {
    pending_leave_requests: pendingLeaveRequests,
    pending_approval_steps: pendingApprovalSteps,
    documents,
    non_myauction_documents: nonMyAuctionDocuments,
    active_non_myauction_documents: activeNonMyAuctionDocuments,
    sales_records: salesRecords,
    cases,
    org_nodes: orgNodes,
    annual_leave_total: Number(annualLeave?.total_days || 0),
    annual_leave_used: Number(annualLeave?.used_days || 0),
  };
}
