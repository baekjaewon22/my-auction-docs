import { Hono } from 'hono';
import type { AuthEnv } from '../types';
import { authMiddleware, requireHumanUser } from '../middleware/auth';
import {
  canManageVideoProduction,
  normalizeVideoProductionStatus,
  normalizeVideoProductionType,
  videoProductionDefaultAmount,
  VIDEO_PRODUCTION_STATUS_LABELS,
  VIDEO_PRODUCTION_TYPE_LABELS,
} from '../../shared/video-production.ts';
import {
  ensureVideoProductionRequestTable,
  loadVideoProductionPayrollSummary,
  type VideoProductionRequestRow,
} from '../lib/video-production-requests.ts';

const videoProduction = new Hono<AuthEnv>();
videoProduction.use('*', authMiddleware);
videoProduction.use('*', requireHumanUser());

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_PATTERN = /^\d{4}-\d{2}$/;

function todayKstDate(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function validDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function normalizeOptionalDate(value: unknown): string {
  const text = String(value || '').trim();
  return text && validDate(text) ? text : '';
}

function monthRange(month: string): { start: string; end: string } | null {
  if (!MONTH_PATTERN.test(month)) return null;
  const [year, monthText] = month.split('-').map(Number);
  if (monthText < 1 || monthText > 12) return null;
  return {
    start: `${month}-01`,
    end: `${month}-${String(new Date(year, monthText, 0).getDate()).padStart(2, '0')}`,
  };
}

async function requireVideoProductionAccess(c: any, next: any) {
  const user = c.get('user');
  if (!canManageVideoProduction(user)) {
    return c.json({ error: '영상제작 의뢰 관리 권한이 없습니다.' }, 403);
  }
  return next();
}

async function loadActiveAssignees(db: D1Database) {
  const result = await db.prepare(`
    SELECT id, name, role, branch, department, position_title, login_type
    FROM users
    WHERE approved = 1 AND role != 'resigned'
    ORDER BY branch ASC, department ASC, name ASC
  `).all<{
    id: string;
    name: string;
    role: string;
    branch: string;
    department: string;
    position_title: string;
    login_type: string;
  }>();
  return result.results || [];
}

async function getAssignee(db: D1Database, id: string) {
  return db.prepare(`
    SELECT id, name, role, branch, department, position_title, login_type
    FROM users
    WHERE id = ? AND approved = 1 AND role != 'resigned'
    LIMIT 1
  `).bind(id).first<{
    id: string;
    name: string;
    role: string;
    branch: string;
    department: string;
    position_title: string;
    login_type: string;
  }>();
}

function validatePayload(body: Record<string, unknown>, existing?: VideoProductionRequestRow | null) {
  const assigneeUserId = String(body.assignee_user_id ?? existing?.assignee_user_id ?? '').trim();
  const videoType = normalizeVideoProductionType(body.video_type ?? existing?.video_type);
  const status = normalizeVideoProductionStatus(body.status ?? existing?.status);
  const requestDate = String(body.request_date ?? existing?.request_date ?? todayKstDate()).trim();
  const providedDate = '';
  const submitDueDate = '';
  const resultReceivedDate = normalizeOptionalDate(body.result_received_date ?? existing?.result_received_date);
  const title = String(body.title ?? existing?.title ?? '').trim().slice(0, 120);
  const memo = String(body.memo ?? existing?.memo ?? '').trim().slice(0, 2000);
  const quantityInput = body.quantity ?? existing?.quantity ?? 1;
  const quantity = Math.trunc(Math.max(Number(quantityInput) || 1, 1));
  const existingUnitAmount = Number(existing?.unit_amount) || (
    Number(existing?.quantity) > 0
      ? Math.trunc((Number(existing?.amount) || 0) / Number(existing?.quantity))
      : Number(existing?.amount) || 0
  );
  const unitAmountInput = body.unit_amount ?? (existingUnitAmount > 0 ? existingUnitAmount : (body.amount ?? videoProductionDefaultAmount(videoType)));
  const unitAmount = Math.trunc(Math.max(Number(unitAmountInput) || 0, 0));
  const amount = unitAmount * quantity;

  if (!assigneeUserId) return { error: '담당자를 선택해 주세요.' } as const;
  if (!validDate(requestDate)) return { error: '의뢰일은 YYYY-MM-DD 형식이어야 합니다.' } as const;
  if (resultReceivedDate && !validDate(resultReceivedDate)) return { error: '결과물 수령일은 YYYY-MM-DD 형식이어야 합니다.' } as const;
  if (status === 'confirmed' && !resultReceivedDate) {
    return { error: '확정 상태는 결과물 수령일을 입력해야 급여정산에 반영됩니다.' } as const;
  }
  if (quantity < 1 || quantity > 100) return { error: '건수는 1건 이상 100건 이하로 입력해 주세요.' } as const;
  if (unitAmount <= 0) return { error: '단가는 1원 이상이어야 합니다.' } as const;
  if (amount <= 0) return { error: '금액은 1원 이상이어야 합니다.' } as const;
  if (amount > 100000000) return { error: '금액이 너무 큽니다. 입력값을 확인해 주세요.' } as const;

  return {
    value: {
      assigneeUserId,
      videoType,
      status,
      quantity,
      unitAmount,
      amount,
      requestDate,
      providedDate,
      submitDueDate,
      resultReceivedDate,
      title,
      memo,
    },
  } as const;
}

function rowSelectSql() {
  return `
    SELECT vpr.*,
      u.name AS assignee_name,
      u.branch AS assignee_branch,
      u.department AS assignee_department,
      u.position_title AS assignee_position_title,
      creator.name AS created_by_name,
      updater.name AS updated_by_name
    FROM video_production_requests vpr
    LEFT JOIN users u ON u.id = vpr.assignee_user_id
    LEFT JOIN users creator ON creator.id = vpr.created_by
    LEFT JOIN users updater ON updater.id = vpr.updated_by
  `;
}

videoProduction.use('*', requireVideoProductionAccess);

videoProduction.get('/options', async (c) => {
  const db = c.env.DB;
  const users = await loadActiveAssignees(db);
  return c.json({
    users,
    types: Object.entries(VIDEO_PRODUCTION_TYPE_LABELS).map(([value, label]) => ({
      value,
      label,
      default_amount: videoProductionDefaultAmount(value),
    })),
    statuses: Object.entries(VIDEO_PRODUCTION_STATUS_LABELS).map(([value, label]) => ({ value, label })),
  });
});

videoProduction.get('/', async (c) => {
  const db = c.env.DB;
  await ensureVideoProductionRequestTable(db);
  const month = String(c.req.query('month') || todayKstDate().slice(0, 7)).trim();
  const range = monthRange(month);
  if (!range) return c.json({ error: '조회 월은 YYYY-MM 형식이어야 합니다.' }, 400);
  const assignee = String(c.req.query('assignee_user_id') || '').trim();
  const status = String(c.req.query('status') || '').trim();

  const conditions = [`
    (
      (request_date >= ? AND request_date <= ?)
      OR (result_received_date >= ? AND result_received_date <= ?)
    )
  `];
  const params: string[] = [
    range.start, range.end,
    range.start, range.end,
  ];
  if (assignee) {
    conditions.push('assignee_user_id = ?');
    params.push(assignee);
  }
  if (status === 'requested' || status === 'confirmed') {
    conditions.push('status = ?');
    params.push(status);
  }

  const result = await db.prepare(`
    ${rowSelectSql()}
    WHERE ${conditions.join(' AND ')}
    ORDER BY COALESCE(NULLIF(result_received_date, ''), request_date) DESC,
      updated_at DESC
  `).bind(...params).all<VideoProductionRequestRow>();
  const items = result.results || [];
  const confirmed = items.filter((item) => item.status === 'confirmed' && item.result_received_date?.slice(0, 7) === month);
  const totalAmount = confirmed.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  return c.json({
    month,
    items,
    summary: {
      confirmed_count: confirmed.reduce((sum, item) => sum + Math.max(Number(item.quantity) || 1, 1), 0),
      short_count: confirmed.filter((item) => item.video_type === 'short_form').reduce((sum, item) => sum + Math.max(Number(item.quantity) || 1, 1), 0),
      long_count: confirmed.filter((item) => item.video_type === 'long_form').reduce((sum, item) => sum + Math.max(Number(item.quantity) || 1, 1), 0),
      total_amount: totalAmount,
    },
  });
});

videoProduction.get('/payroll-summary/:userId', async (c) => {
  const month = String(c.req.query('month') || '').trim();
  if (!MONTH_PATTERN.test(month)) return c.json({ error: '조회 월은 YYYY-MM 형식이어야 합니다.' }, 400);
  const summary = await loadVideoProductionPayrollSummary(c.env.DB, c.req.param('userId'), month);
  return c.json({ month, summary });
});

videoProduction.post('/', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  await ensureVideoProductionRequestTable(db);
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const parsed = validatePayload(body);
  if ('error' in parsed) return c.json({ error: parsed.error }, 400);
  const assignee = await getAssignee(db, parsed.value.assigneeUserId);
  if (!assignee) return c.json({ error: '담당자를 찾을 수 없습니다.' }, 404);
  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO video_production_requests (
      id, assignee_user_id, video_type, status, quantity, unit_amount, amount,
      request_date, provided_date, submit_due_date, result_received_date,
      title, memo, created_by, updated_by
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    parsed.value.assigneeUserId,
    parsed.value.videoType,
    parsed.value.status,
    parsed.value.quantity,
    parsed.value.unitAmount,
    parsed.value.amount,
    parsed.value.requestDate,
    parsed.value.providedDate,
    parsed.value.submitDueDate,
    parsed.value.resultReceivedDate,
    parsed.value.title,
    parsed.value.memo,
    user.sub,
    user.sub,
  ).run();
  const item = await db.prepare(`${rowSelectSql()} WHERE vpr.id = ?`).bind(id).first<VideoProductionRequestRow>();
  return c.json({ success: true, item });
});

videoProduction.put('/:id', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  await ensureVideoProductionRequestTable(db);
  const id = c.req.param('id');
  const existing = await db.prepare(`${rowSelectSql()} WHERE vpr.id = ?`).bind(id).first<VideoProductionRequestRow>();
  if (!existing) return c.json({ error: '영상제작 의뢰를 찾을 수 없습니다.' }, 404);
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const parsed = validatePayload(body, existing);
  if ('error' in parsed) return c.json({ error: parsed.error }, 400);
  const assignee = await getAssignee(db, parsed.value.assigneeUserId);
  if (!assignee) return c.json({ error: '담당자를 찾을 수 없습니다.' }, 404);
  await db.prepare(`
    UPDATE video_production_requests
    SET assignee_user_id = ?, video_type = ?, status = ?, quantity = ?, unit_amount = ?, amount = ?,
      request_date = ?, provided_date = ?, submit_due_date = ?, result_received_date = ?,
      title = ?, memo = ?, updated_by = ?, updated_at = datetime('now', '+9 hours')
    WHERE id = ?
  `).bind(
    parsed.value.assigneeUserId,
    parsed.value.videoType,
    parsed.value.status,
    parsed.value.quantity,
    parsed.value.unitAmount,
    parsed.value.amount,
    parsed.value.requestDate,
    parsed.value.providedDate,
    parsed.value.submitDueDate,
    parsed.value.resultReceivedDate,
    parsed.value.title,
    parsed.value.memo,
    user.sub,
    id,
  ).run();
  const item = await db.prepare(`${rowSelectSql()} WHERE vpr.id = ?`).bind(id).first<VideoProductionRequestRow>();
  return c.json({ success: true, item });
});

videoProduction.post('/:id/result-date', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  await ensureVideoProductionRequestTable(db);
  const id = c.req.param('id');
  const existing = await db.prepare('SELECT id FROM video_production_requests WHERE id = ?').bind(id).first<{ id: string }>();
  if (!existing) return c.json({ error: '영상제작 의뢰를 찾을 수 없습니다.' }, 404);
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const rawDate = String(body.result_received_date || '').trim();
  if (rawDate && !validDate(rawDate)) return c.json({ error: '결과물 받은 일자는 YYYY-MM-DD 형식이어야 합니다.' }, 400);
  await db.prepare(`
    UPDATE video_production_requests
    SET result_received_date = ?,
      status = ?,
      provided_date = '',
      submit_due_date = '',
      updated_by = ?,
      updated_at = datetime('now', '+9 hours')
    WHERE id = ?
  `).bind(
    rawDate,
    rawDate ? 'confirmed' : 'requested',
    user.sub,
    id,
  ).run();
  const item = await db.prepare(`${rowSelectSql()} WHERE vpr.id = ?`).bind(id).first<VideoProductionRequestRow>();
  return c.json({ success: true, item });
});

videoProduction.post('/:id/reopen', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  await ensureVideoProductionRequestTable(db);
  const id = c.req.param('id');
  const existing = await db.prepare('SELECT id, status FROM video_production_requests WHERE id = ?').bind(id).first<{ id: string; status: string }>();
  if (!existing) return c.json({ error: '영상제작 의뢰를 찾을 수 없습니다.' }, 404);
  await db.prepare(`
    UPDATE video_production_requests
    SET status = 'requested',
      result_received_date = '',
      updated_by = ?,
      updated_at = datetime('now', '+9 hours')
    WHERE id = ?
  `).bind(user.sub, id).run();
  const item = await db.prepare(`${rowSelectSql()} WHERE vpr.id = ?`).bind(id).first<VideoProductionRequestRow>();
  return c.json({ success: true, item });
});

videoProduction.delete('/:id', async (c) => {
  const db = c.env.DB;
  await ensureVideoProductionRequestTable(db);
  const id = c.req.param('id');
  const existing = await db.prepare('SELECT id FROM video_production_requests WHERE id = ?').bind(id).first<{ id: string }>();
  if (!existing) return c.json({ error: '영상제작 의뢰를 찾을 수 없습니다.' }, 404);
  await db.prepare('DELETE FROM video_production_requests WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

export default videoProduction;
