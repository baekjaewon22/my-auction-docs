import { Hono } from 'hono';
import type { AuthEnv } from '../types';
import { authMiddleware, requireHumanMaster } from '../middleware/auth';
import {
  ensureLawitgoWinningSchema,
  LawitgoWinningOverrideError,
  runLawitgoWinningManualDelivery,
  stageLawitgoWinningOutbox,
  upsertLawitgoWinningOverride,
  type LawitgoWinningItem,
} from '../lib/lawitgo-winning-delivery';
import { listActiveLawitgoConsultantMappings } from '../lib/lawitgo-consultant-mapping';

const route = new Hono<AuthEnv>();
route.use('*', authMiddleware);
route.use('*', requireHumanMaster());

function parseItem(value: string): LawitgoWinningItem | null {
  try { return JSON.parse(value) as LawitgoWinningItem; } catch { return null; }
}

function maskPhone(value: string): string {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length < 7) return '';
  return `${digits.slice(0, 3)}-${'*'.repeat(Math.max(3, digits.length - 7))}-${digits.slice(-4)}`;
}

async function adminPayload(db: D1Database) {
  const [outbox, scheduledRuns, manualRuns] = await Promise.all([
    db.prepare(`SELECT id, sales_record_id, payload_json, missing_fields, status, attempt_count,
      last_attempt_at, sent_at, response_status, remote_request_id, last_error, created_at, updated_at
      FROM lawitgo_winning_outbox ORDER BY created_at DESC LIMIT 300`).all<any>(),
    db.prepare(`SELECT id, scheduled_slot, status, staged_count, blocked_count, claimed_count,
      sent_count, failed_count, error, started_at, finished_at
      FROM lawitgo_winning_delivery_runs ORDER BY started_at DESC LIMIT 50`).all<any>(),
    db.prepare(`SELECT mr.id, mr.actor_user_id, COALESCE(u.name, '') actor_name, mr.status,
      mr.requested_count, mr.claimed_count, mr.sent_count, mr.failed_count,
      mr.remote_request_id, mr.error, mr.started_at, mr.finished_at
      FROM lawitgo_winning_manual_runs mr LEFT JOIN users u ON u.id=mr.actor_user_id
      ORDER BY mr.started_at DESC LIMIT 50`).all<any>(),
  ]);
  const items = (outbox.results || []).map((row) => {
    const item = parseItem(row.payload_json || '{}');
    return {
      id: row.id,
      sales_record_id: row.sales_record_id,
      status: row.status,
      missing_fields: (() => { try { return JSON.parse(row.missing_fields || '[]'); } catch { return []; } })(),
      attempt_count: row.attempt_count,
      last_attempt_at: row.last_attempt_at,
      sent_at: row.sent_at,
      response_status: row.response_status,
      remote_request_id: row.remote_request_id,
      last_error: row.last_error,
      created_at: row.created_at,
      updated_at: row.updated_at,
      customer_name: item?.customerName || '',
      customer_phone_masked: maskPhone(item?.customerPhone || ''),
      court: item?.court || '',
      case_number: item?.caseNumber || '',
      property_type: item?.propertyType || '',
      winning_date: item?.winningDate || '',
      assignee_name: item?.assignee?.name || '',
      assignee_branch: item?.assignee?.branch || '',
    };
  });
  const summary = items.reduce((acc, item) => {
    acc.total += 1;
    if (item.status === 'sent') acc.sent += 1;
    else if (item.status === 'blocked') acc.blocked += 1;
    else if (item.status === 'failed') acc.failed += 1;
    else if (item.status === 'sending') acc.sending += 1;
    else acc.pending += 1;
    return acc;
  }, { total: 0, pending: 0, blocked: 0, sending: 0, sent: 0, failed: 0 });
  return { items, summary, scheduled_runs: scheduledRuns.results || [], manual_runs: manualRuns.results || [] };
}

async function repairPayload(db: D1Database, salesRecordId: string) {
  const [outbox, mappings] = await Promise.all([
    db.prepare(`SELECT sales_record_id, payload_json, missing_fields, status
      FROM lawitgo_winning_outbox WHERE sales_record_id = ? LIMIT 1`)
      .bind(salesRecordId).first<{
        sales_record_id: string;
        payload_json: string;
        missing_fields: string;
        status: string;
      }>(),
    listActiveLawitgoConsultantMappings(db),
  ]);
  if (!outbox) return null;
  const item = parseItem(outbox.payload_json || '{}');
  if (!item) return null;
  let missingFields: string[] = [];
  try {
    const parsed = JSON.parse(outbox.missing_fields || '[]');
    if (Array.isArray(parsed)) missingFields = parsed.map(String);
  } catch { /* keep an empty, non-sensitive fallback */ }
  return {
    item: {
      sales_record_id: outbox.sales_record_id,
      status: outbox.status,
      customer_name: item.customerName || '',
      customer_phone: item.customerPhone || '',
      court: item.court || '',
      case_number: item.caseNumber || '',
      property_type: item.propertyType || '',
      winning_date: item.winningDate || '',
      assignee_user_id: item.assignee?.myDocsUserId || '',
      assignee_name: item.assignee?.name || '',
      assignee_branch: item.assignee?.branch || '',
      lawitgo_consultant_id: item.assignee?.consultantId || '',
      missing_fields: missingFields,
    },
    assignees: mappings.map((mapping) => ({
      id: mapping.userId,
      name: mapping.userName,
      branch: mapping.userBranch,
      consultant_id: mapping.consultantId,
    })),
  };
}

route.get('/', async (c) => {
  await ensureLawitgoWinningSchema(c.env.DB);
  await stageLawitgoWinningOutbox(c.env.DB);
  return c.json(await adminPayload(c.env.DB));
});

route.post('/refresh', async (c) => {
  const staged = await stageLawitgoWinningOutbox(c.env.DB);
  return c.json({ success: true, ...staged, ...(await adminPayload(c.env.DB)) });
});

route.post('/send', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ ids?: unknown; confirmation?: unknown }>();
  if (body.confirmation !== 'SEND_TO_LAWITGO') return c.json({ error: '실제 발송 확인값이 올바르지 않습니다.' }, 400);
  const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
  if (ids.length > 50) return c.json({ error: '한 번에 최대 50건까지 발송할 수 있습니다.' }, 400);
  const result = await runLawitgoWinningManualDelivery(c.env, user.sub, ids);
  return c.json({ success: result.failed === 0, result, ...(await adminPayload(c.env.DB)) });
});

route.get('/:salesRecordId/repair', async (c) => {
  const salesRecordId = String(c.req.param('salesRecordId') || '').trim();
  if (!salesRecordId) return c.json({ error: '낙찰 매출 식별값이 필요합니다.' }, 400);
  await stageLawitgoWinningOutbox(c.env.DB);
  const payload = await repairPayload(c.env.DB, salesRecordId);
  if (!payload) return c.json({ error: '보완할 낙찰 전송 내역을 찾을 수 없습니다.' }, 404);
  return c.json(payload);
});

route.put('/:salesRecordId/repair', async (c) => {
  const user = c.get('user');
  const salesRecordId = String(c.req.param('salesRecordId') || '').trim();
  if (!salesRecordId) return c.json({ error: '낙찰 매출 식별값이 필요합니다.' }, 400);
  const body = await c.req.json<Record<string, unknown>>();
  try {
    await upsertLawitgoWinningOverride(c.env.DB, salesRecordId, {
      customerName: String(body.customer_name || ''),
      customerPhone: String(body.customer_phone || ''),
      court: String(body.court || ''),
      caseNumber: String(body.case_number || ''),
      propertyType: String(body.property_type || ''),
      winningDate: String(body.winning_date || ''),
      assigneeUserId: String(body.assignee_user_id || ''),
    }, user.sub);
    await stageLawitgoWinningOutbox(c.env.DB);
    await c.env.DB.prepare(`UPDATE lawitgo_winning_outbox
      SET status='pending', next_attempt_at=datetime('now', '+9 hours'), last_error=NULL,
          claim_token=NULL, updated_at=datetime('now', '+9 hours')
      WHERE sales_record_id = ? AND status IN ('blocked', 'failed', 'pending')
        AND missing_fields = '[]'`).bind(salesRecordId).run();
    const payload = await repairPayload(c.env.DB, salesRecordId);
    if (!payload) return c.json({ error: '보완된 전송 내역을 다시 불러오지 못했습니다.' }, 500);
    return c.json({
      success: true,
      status: payload.item.status,
      missing_fields: payload.item.missing_fields,
      ...payload,
    });
  } catch (error) {
    if (error instanceof LawitgoWinningOverrideError) {
      return c.json({ error: error.message }, error.status);
    }
    throw error;
  }
});

export default route;
