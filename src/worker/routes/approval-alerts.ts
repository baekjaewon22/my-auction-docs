// 승인 대기 영속 알림 (alert_approval_pending) 전용 라우트
// - 외근보고서 link(document_journal_links)와 무관 → links.ts에서 분리
// - 향후 다른 영속 알림(매출/환불 등) 추가 시 같은 패턴으로 별도 파일 권장

import { Hono } from 'hono';
import type { AuthEnv } from '../types';
import { authMiddleware, requireRole } from '../middleware/auth';

const approvalAlerts = new Hono<AuthEnv>();
approvalAlerts.use('*', authMiddleware);

// GET /api/approval-alerts — 본인의 결재 대기 알림 (대시보드 read path)
approvalAlerts.get('/', async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const result = await db.prepare(`
    SELECT * FROM alert_approval_pending
    WHERE approver_id = ? AND status = 'open'
    ORDER BY my_status DESC, document_submitted_at ASC
  `).bind(user.sub).all();
  return c.json({ alerts: result.results || [] });
});

// POST /api/approval-alerts/:id/dismiss — 알림 dismiss (본인 alert만, 또는 master/ceo/cc_ref)
approvalAlerts.post('/:id/dismiss', async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const id = c.req.param('id');
  const alert = await db.prepare(
    'SELECT approver_id FROM alert_approval_pending WHERE id = ?'
  ).bind(id).first<{ approver_id: string }>();
  if (!alert) return c.json({ error: 'alert을 찾을 수 없습니다.' }, 404);
  if (alert.approver_id !== user.sub && !['master', 'ceo', 'cc_ref'].includes(user.role)) {
    return c.json({ error: '권한이 없습니다.' }, 403);
  }
  await db.prepare(`
    UPDATE alert_approval_pending
    SET status = 'cancelled', acted_at = datetime('now'), acted_action = 'dismissed'
    WHERE id = ?
  `).bind(id).run();
  return c.json({ success: true });
});

// POST /api/approval-alerts/backfill — 기존 submitted 문서 일괄 알림 적재 (master 전용)
// dryRun: true (기본) — 실제 INSERT 안 함
// notification_sent=1 로 생성하여 알림 발송 X (조용한 backfill)
approvalAlerts.post('/backfill', requireRole('master'), async (c) => {
  const db = c.env.DB;
  const body = await c.req.json<{ dryRun?: boolean }>().catch(() => ({} as { dryRun?: boolean }));
  const dryRun = body.dryRun ?? true;

  const docsRes = await db.prepare(`
    SELECT d.id, d.title, d.template_id, d.author_id, d.branch, d.department,
           u.name as author_name, d.created_at
    FROM documents d
    LEFT JOIN users u ON u.id = d.author_id
    WHERE d.status = 'submitted' AND COALESCE(d.cancelled, 0) = 0
    ORDER BY d.created_at ASC
  `).all<any>();
  const docs = docsRes.results || [];

  let docsProcessed = 0;
  let alertsCreated = 0;
  let skipped = 0;
  const samples: any[] = [];

  for (const doc of docs) {
    const stepsRes = await db.prepare(
      'SELECT step_order, approver_id, status FROM approval_steps WHERE document_id = ? ORDER BY step_order ASC'
    ).bind(doc.id).all<{ step_order: number; approver_id: string; status: string }>();
    const steps = stepsRes.results || [];
    if (steps.length === 0) { skipped++; continue; }

    const firstPending = steps.find((s) => s.status === 'pending');
    const prevAllApproved = firstPending
      ? steps.filter((s) => s.step_order < firstPending.step_order).every((s) => s.status === 'approved')
      : false;

    const stmts: any[] = [];

    if (firstPending && prevAllApproved) {
      stmts.push(
        db.prepare(`
          INSERT OR IGNORE INTO alert_approval_pending
            (id, document_id, approver_id, cycle_no, step_order, my_status,
             document_title, document_template_id, document_author_id, document_author_name,
             document_branch, document_department, document_submitted_at, notification_sent)
          VALUES (?, ?, ?, 1, ?, 'need_approve', ?, ?, ?, ?, ?, ?, ?, 1)
        `).bind(
          crypto.randomUUID(), doc.id, firstPending.approver_id, firstPending.step_order,
          doc.title || '', doc.template_id || '', doc.author_id || '', doc.author_name || '',
          doc.branch || '', doc.department || '', doc.created_at || '',
        )
      );
      alertsCreated++;
      if (samples.length < 10) {
        samples.push({ doc_id: doc.id, doc_title: doc.title, approver_id: firstPending.approver_id, my_status: 'need_approve' });
      }
    }

    for (const s of steps) {
      if (s.status !== 'approved') continue;
      const hasLater = steps.some((t) => t.step_order > s.step_order);
      if (!hasLater) continue;
      stmts.push(
        db.prepare(`
          INSERT OR IGNORE INTO alert_approval_pending
            (id, document_id, approver_id, cycle_no, step_order, my_status,
             document_title, document_template_id, document_author_id, document_author_name,
             document_branch, document_department, document_submitted_at, notification_sent)
          VALUES (?, ?, ?, 1, ?, 'waiting_final', ?, ?, ?, ?, ?, ?, ?, 1)
        `).bind(
          crypto.randomUUID(), doc.id, s.approver_id, s.step_order,
          doc.title || '', doc.template_id || '', doc.author_id || '', doc.author_name || '',
          doc.branch || '', doc.department || '', doc.created_at || '',
        )
      );
      alertsCreated++;
    }

    if (!dryRun && stmts.length > 0) {
      await db.batch(stmts);
    }
    docsProcessed++;
  }

  return c.json({
    dry_run: dryRun,
    docs_processed: docsProcessed,
    alerts_created: alertsCreated,
    skipped,
    samples,
  });
});

export default approvalAlerts;
