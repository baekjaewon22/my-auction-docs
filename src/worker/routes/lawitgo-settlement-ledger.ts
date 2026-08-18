import { Hono } from 'hono';
import type { AuthEnv } from '../types';
import { authMiddleware, requireRole } from '../middleware/auth';
import { ensureLawitgoNewSettlementTable } from '../lib/lawitgo-new-settlement';

const ledger = new Hono<AuthEnv>();
const LEDGER_ROLES = ['master', 'ceo', 'accountant', 'accountant_asst'] as const;

ledger.use('*', authMiddleware);

function isValidDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function payrollPeriodLabel(month: string): string {
  const [year, monthText] = month.split('-');
  return `${Number(year)}년 ${Number(monthText)}월`;
}

async function hasLockedPayroll(db: D1Database, userId: string, month: string): Promise<boolean> {
  const row = await db.prepare(`
    SELECT 1 FROM payroll_saves
    WHERE user_id = ? AND locked = 1 AND period IN (?, ?)
    LIMIT 1
  `).bind(userId, month, payrollPeriodLabel(month)).first();
  return Boolean(row);
}

function auditJson(row: Record<string, unknown>): string {
  return JSON.stringify({
    id: row.id,
    external_id: row.external_id,
    progress_id: row.progress_id,
    case_id: row.case_id,
    consultant_user_id: row.consultant_user_id,
    client_name: row.client_name,
    settlement_date: row.settlement_date,
    payroll_month: row.payroll_month,
    consultant_share: row.consultant_share,
    statement_title: row.statement_title,
    statement_format: row.statement_format,
    statement_content: row.statement_content,
    source_registered_at: row.source_registered_at,
    deleted_at: row.deleted_at,
    deleted_by: row.deleted_by,
    delete_reason: row.delete_reason,
    manual_override_at: row.manual_override_at,
    manual_override_by: row.manual_override_by,
  });
}

ledger.get('/', requireRole(...LEDGER_ROLES), async (c) => {
  const db = c.env.DB;
  await ensureLawitgoNewSettlementTable(db);
  const month = String(c.req.query('month') || '').trim();
  const status = String(c.req.query('status') || 'active').trim();
  const search = String(c.req.query('search') || '').trim();
  const limit = Math.min(500, Math.max(1, Number(c.req.query('limit')) || 200));
  const conditions: string[] = [];
  const binds: unknown[] = [];

  if (month) {
    if (!/^\d{4}-\d{2}$/.test(month)) return c.json({ error: 'month는 YYYY-MM 형식이어야 합니다.' }, 400);
    conditions.push('l.payroll_month = ?');
    binds.push(month);
  }
  if (status === 'active') conditions.push('l.deleted_at IS NULL');
  else if (status === 'deleted') conditions.push('l.deleted_at IS NOT NULL');
  else if (status !== 'all') return c.json({ error: 'status는 active, deleted, all 중 하나여야 합니다.' }, 400);
  if (search) {
    conditions.push('(l.external_id LIKE ? OR l.progress_id LIKE ? OR l.client_name LIKE ? OR COALESCE(u.name, \'\') LIKE ?)');
    const pattern = `%${search}%`;
    binds.push(pattern, pattern, pattern, pattern);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await db.prepare(`
    SELECT l.*, COALESCE(u.name, '') AS consultant_name,
      COALESCE(u.branch, '') AS consultant_branch,
      COALESCE(u.department, '') AS consultant_department,
      COALESCE(editor.name, '') AS manual_override_name,
      COALESCE(deleter.name, '') AS deleted_by_name
    FROM lawitgo_new_settlements l
    LEFT JOIN users u ON u.id = l.consultant_user_id
    LEFT JOIN users editor ON editor.id = l.manual_override_by
    LEFT JOIN users deleter ON deleter.id = l.deleted_by
    ${where}
    ORDER BY l.settlement_date DESC, l.updated_at DESC
    LIMIT ?
  `).bind(...binds, limit).all();
  return c.json({ items: result.results || [] });
});

ledger.get('/:id/history', requireRole(...LEDGER_ROLES), async (c) => {
  const db = c.env.DB;
  await ensureLawitgoNewSettlementTable(db);
  const result = await db.prepare(`
    SELECT a.*, COALESCE(u.name, '') AS changed_by_name
    FROM lawitgo_new_settlement_audit a
    LEFT JOIN users u ON u.id = a.changed_by
    WHERE a.settlement_id = ?
    ORDER BY a.changed_at DESC
    LIMIT 100
  `).bind(c.req.param('id')).all();
  return c.json({ history: result.results || [] });
});

ledger.put('/:id', requireRole(...LEDGER_ROLES), async (c) => {
  const db = c.env.DB;
  const viewer = c.get('user');
  await ensureLawitgoNewSettlementTable(db);
  const existing = await db.prepare('SELECT * FROM lawitgo_new_settlements WHERE id = ? AND deleted_at IS NULL')
    .bind(c.req.param('id')).first<Record<string, unknown>>();
  if (!existing) return c.json({ error: '활성 상태의 신정산 원장을 찾을 수 없습니다.' }, 404);

  const body = await c.req.json<{
    consultant_user_id?: string;
    client_name?: string;
    settlement_date?: string;
    amount?: number;
    statement_title?: string;
    statement_content?: string | null;
    reason?: string;
  }>().catch(() => null);
  if (!body) return c.json({ error: '요청 본문이 올바르지 않습니다.' }, 400);

  const consultantUserId = String(body.consultant_user_id ?? existing.consultant_user_id).trim();
  const clientName = String(body.client_name ?? existing.client_name).trim();
  const settlementDate = String(body.settlement_date ?? existing.settlement_date).trim();
  const amount = body.amount ?? Number(existing.consultant_share);
  const statementTitle = String(body.statement_title ?? existing.statement_title ?? '결산내역서').trim().slice(0, 200);
  const statementContent = body.statement_content === undefined
    ? (existing.statement_content as string | null)
    : (body.statement_content === null ? null : String(body.statement_content).trim() || null);
  const reason = String(body.reason || '').trim().slice(0, 500);

  if (!consultantUserId || !clientName) return c.json({ error: '컨설턴트와 의뢰인명은 필수입니다.' }, 400);
  if (!isValidDate(settlementDate)) return c.json({ error: '최종 정산일은 YYYY-MM-DD 형식이어야 합니다.' }, 400);
  if (!Number.isInteger(amount) || amount < 0) return c.json({ error: '지급액은 0 이상의 정수여야 합니다.' }, 400);
  if (statementContent && statementContent.length > 100_000) return c.json({ error: '결산내역서는 100000자 이하여야 합니다.' }, 413);

  const consultant = await db.prepare(`
    SELECT id, name, position_title, branch, department
    FROM users WHERE id = ? AND approved = 1 AND role != 'resigned'
  `).bind(consultantUserId).first<any>();
  if (!consultant) return c.json({ error: '재직 중인 컨설턴트 계정을 선택해 주세요.' }, 400);

  const payrollMonth = settlementDate.slice(0, 7);
  const lockPairs = new Set([
    `${existing.consultant_user_id}|${existing.payroll_month}`,
    `${consultantUserId}|${payrollMonth}`,
  ]);
  for (const pair of lockPairs) {
    const [userId, month] = pair.split('|');
    if (await hasLockedPayroll(db, userId, month)) {
      return c.json({ error: `${month} 급여가 확정되어 있습니다. 급여 확정을 해제한 뒤 수정해 주세요.` }, 409);
    }
  }

  const updated = {
    ...existing,
    consultant_user_id: consultantUserId,
    client_name: clientName,
    settlement_date: settlementDate,
    payroll_month: payrollMonth,
    consultant_share: amount,
    statement_title: statementContent ? statementTitle : null,
    statement_format: statementContent ? 'text' : null,
    statement_content: statementContent,
    manual_override_by: viewer.sub,
  };
  await db.batch([
    db.prepare(`
      UPDATE lawitgo_new_settlements SET
        consultant_user_id = ?, client_name = ?, settlement_date = ?, payroll_month = ?,
        consultant_share = ?, statement_title = ?, statement_format = ?, statement_content = ?,
        manual_override_at = datetime('now'), manual_override_by = ?, updated_at = datetime('now')
      WHERE id = ? AND deleted_at IS NULL
    `).bind(
      consultantUserId, clientName, settlementDate, payrollMonth, amount,
      statementContent ? statementTitle : null, statementContent ? 'text' : null, statementContent,
      viewer.sub, existing.id,
    ),
    db.prepare(`
      UPDATE cases SET consultant_user_id = ?, consultant_name = ?, consultant_position = ?,
        consultant_branch = ?, consultant_department = ?, client_name = ?, fee_amount = ?, updated_at = datetime('now')
      WHERE id = ?
    `).bind(
      consultant.id, consultant.name, consultant.position_title || null,
      consultant.branch || null, consultant.department || null, clientName, amount, existing.case_id,
    ),
    db.prepare(`
      INSERT INTO lawitgo_new_settlement_audit
        (id, settlement_id, external_id, action, before_json, after_json, reason, changed_by)
      VALUES (?, ?, ?, 'update', ?, ?, ?, ?)
    `).bind(crypto.randomUUID(), existing.id, existing.external_id, auditJson(existing), auditJson(updated), reason, viewer.sub),
  ]);
  return c.json({ success: true });
});

ledger.delete('/:id', requireRole(...LEDGER_ROLES), async (c) => {
  const db = c.env.DB;
  const viewer = c.get('user');
  await ensureLawitgoNewSettlementTable(db);
  const body = await c.req.json<{ reason?: string }>().catch(() => ({} as { reason?: string }));
  const reason = String(body.reason || '').trim().slice(0, 500);
  if (!reason) return c.json({ error: '삭제 사유를 입력해 주세요.' }, 400);
  const existing = await db.prepare('SELECT * FROM lawitgo_new_settlements WHERE id = ? AND deleted_at IS NULL')
    .bind(c.req.param('id')).first<Record<string, unknown>>();
  if (!existing) return c.json({ error: '활성 상태의 신정산 원장을 찾을 수 없습니다.' }, 404);
  if (await hasLockedPayroll(db, String(existing.consultant_user_id), String(existing.payroll_month))) {
    return c.json({ error: `${existing.payroll_month} 급여가 확정되어 있습니다. 급여 확정을 해제한 뒤 삭제해 주세요.` }, 409);
  }
  const after = { ...existing, deleted_by: viewer.sub, delete_reason: reason };
  await db.batch([
    db.prepare(`
      UPDATE lawitgo_new_settlements SET deleted_at = datetime('now'), deleted_by = ?, delete_reason = ?, updated_at = datetime('now')
      WHERE id = ? AND deleted_at IS NULL
    `).bind(viewer.sub, reason, existing.id),
    db.prepare(`
      INSERT INTO case_hidden (external_id, case_id, hidden_by, hidden_reason, hidden_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(external_id) DO UPDATE SET case_id = excluded.case_id, hidden_by = excluded.hidden_by,
        hidden_reason = excluded.hidden_reason, hidden_at = datetime('now')
    `).bind(existing.external_id, existing.case_id, viewer.sub, `신정산 원장 삭제: ${reason}`),
    db.prepare(`
      INSERT INTO lawitgo_new_settlement_audit
        (id, settlement_id, external_id, action, before_json, after_json, reason, changed_by)
      VALUES (?, ?, ?, 'delete', ?, ?, ?, ?)
    `).bind(crypto.randomUUID(), existing.id, existing.external_id, auditJson(existing), auditJson(after), reason, viewer.sub),
  ]);
  return c.json({ success: true });
});

export default ledger;
