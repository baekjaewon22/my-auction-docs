// 승인 대기 알림톡 발송 cron 디스패처
// - alert_approval_pending에서 notification_sent=0, status='open', my_status='need_approve' 행 조회
// - 각 행에 대해 알림톡 발송 → notification_sent=1 마킹
// - 실패 시 notification_sent=2 (재시도 안 함, 로그 남김)
// - 한 cron 실행당 최대 N개 처리 (rate limit 방지)

import { sendAlimtalkByTemplate, APP_URL } from '../alimtalk';

const BATCH_SIZE = 30;  // 30분 cron당 최대 30건 발송

interface PendingAlert {
  id: string;
  document_id: string;
  approver_id: string;
  document_title: string;
  document_author_name: string;
  document_department: string;
  document_submitted_at: string;
}

export async function dispatchApprovalAlerts(env: { DB: D1Database } & Record<string, unknown>): Promise<{
  picked: number;
  sent: number;
  failed: number;
  skipped_no_phone: number;
}> {
  const db = env.DB;

  // 1. 미발송 + open + need_approve 행 조회 (오래된 순)
  const res = await db.prepare(`
    SELECT id, document_id, approver_id,
           document_title, document_author_name, document_department, document_submitted_at
    FROM alert_approval_pending
    WHERE notification_sent = 0
      AND status = 'open'
      AND my_status = 'need_approve'
    ORDER BY detected_at ASC
    LIMIT ?
  `).bind(BATCH_SIZE).all<PendingAlert>();
  const alerts = res.results || [];
  if (alerts.length === 0) {
    return { picked: 0, sent: 0, failed: 0, skipped_no_phone: 0 };
  }

  // 2. approver phone 일괄 조회
  const approverIds = Array.from(new Set(alerts.map((a) => a.approver_id)));
  const phPlaceholders = approverIds.map(() => '?').join(',');
  const phRes = await db.prepare(
    `SELECT id, phone FROM users WHERE id IN (${phPlaceholders})`
  ).bind(...approverIds).all<{ id: string; phone: string }>();
  const phoneById: Record<string, string> = {};
  for (const u of phRes.results || []) {
    if (u.phone) phoneById[u.id] = u.phone;
  }

  let sent = 0, failed = 0, skipped_no_phone = 0;

  for (const alert of alerts) {
    const phone = phoneById[alert.approver_id];
    if (!phone) {
      // 전화번호 없음 → notification_sent=2 (재시도 안 함)
      await db.prepare(`
        UPDATE alert_approval_pending
        SET notification_sent = 2, notification_sent_at = datetime('now'),
            notification_error = 'no_phone'
        WHERE id = ?
      `).bind(alert.id).run();
      skipped_no_phone++;
      continue;
    }

    try {
      const submitDate = (alert.document_submitted_at || '').slice(0, 10);
      await sendAlimtalkByTemplate(
        env,
        'DOC_SUBMITTED',
        {
          author_name: alert.document_author_name || '',
          doc_title: alert.document_title || '',
          department: alert.document_department || '',
          submit_date: submitDate,
          link: `${APP_URL}/documents/${alert.document_id}`,
        },
        [phone],
      );
      // 성공 마킹
      await db.prepare(`
        UPDATE alert_approval_pending
        SET notification_sent = 1, notification_sent_at = datetime('now'),
            notification_error = NULL
        WHERE id = ?
      `).bind(alert.id).run();
      sent++;
    } catch (err: any) {
      // 실패 마킹 (재시도 안 함)
      await db.prepare(`
        UPDATE alert_approval_pending
        SET notification_sent = 2, notification_sent_at = datetime('now'),
            notification_error = ?
        WHERE id = ?
      `).bind(String(err?.message || err).slice(0, 200), alert.id).run();
      failed++;
    }
  }

  return { picked: alerts.length, sent, failed, skipped_no_phone };
}
