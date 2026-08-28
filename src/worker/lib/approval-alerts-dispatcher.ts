// 승인 대기 알림톡 발송 cron 디스패처
// - alert_approval_pending에서 notification_sent=0, status='open', my_status='need_approve' 행 조회
// - 각 행에 대해 알림톡 발송 → notification_sent=1 마킹
// - 실패 시 notification_sent=2 (재시도 안 함, 로그 남김)
// - 한 cron 실행당 최대 N개 처리 (rate limit 방지)

import { sendAlimtalkByTemplate, APP_URL } from '../alimtalk';
import {
  isEligibleExpenseReceiptAlimtalkRecipient,
  isExpenseReceiptTemplate,
} from '../../shared/expense-receipt.ts';
import { countActiveExpenseReceiptAttachments } from './expense-receipts.ts';
import { normalizeBranchName, sameBranchName } from './branchAliases.ts';

const BATCH_SIZE = 30;  // 30분 cron당 최대 30건 발송

// 신청자 지사를 구독한 총무만 알림톡 대상 (users.alimtalk_branches 재사용)
function recipientSubscribesToBranch(
  settings: string | null | undefined,
  branch: string | null | undefined,
): boolean {
  let normalized = normalizeBranchName(branch);
  // 본사관리(기획팀 등 HQ 관리 지사)의 지출결의는 의정부본사 구독 총무가 알림을 받는다.
  if (normalized === '본사관리') normalized = '의정부본사';
  if (!settings || !normalized) return false;
  return settings.split(',').some((value) => sameBranchName(value, normalized));
}

interface PendingAlert {
  id: string;
  document_id: string;
  approver_id: string;
  document_title: string;
  document_template_id: string;
  document_author_name: string;
  document_branch: string;
  document_department: string;
  document_submitted_at: string;
}

interface AlertRecipient {
  id: string;
  phone: string;
  role: string;
  approved: number;
  login_type: string;
  alimtalk_branches: string;
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
           document_title, document_template_id, document_author_name,
           document_branch, document_department, document_submitted_at
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
    `SELECT id, COALESCE(phone, '') AS phone, role, approved,
            COALESCE(login_type, 'employee') AS login_type,
            COALESCE(alimtalk_branches, '') AS alimtalk_branches
     FROM users WHERE id IN (${phPlaceholders})`
  ).bind(...approverIds).all<AlertRecipient>();
  const recipientById: Record<string, AlertRecipient> = {};
  for (const u of phRes.results || []) {
    recipientById[u.id] = u;
  }

  let sent = 0, failed = 0, skipped_no_phone = 0;

  for (const alert of alerts) {
    let recipient: AlertRecipient | undefined = recipientById[alert.approver_id];
    if (isExpenseReceiptTemplate(alert.document_template_id)) {
      // The batch lookup above is only a performance hint. Financial-document
      // recipients are re-read immediately before dispatch so a role change,
      // resignation or account suspension during this cron run cannot leak the
      // request metadata to a stale delegate.
      recipient = await db.prepare(`
        SELECT id, COALESCE(phone, '') AS phone, role, approved,
               COALESCE(login_type, 'employee') AS login_type,
               COALESCE(alimtalk_branches, '') AS alimtalk_branches
        FROM users WHERE id = ?
      `).bind(alert.approver_id).first<AlertRecipient>() || undefined;
    }
    if (isExpenseReceiptTemplate(alert.document_template_id)
      && (!isEligibleExpenseReceiptAlimtalkRecipient(recipient)
        || !recipientSubscribesToBranch(recipient?.alimtalk_branches, alert.document_branch))) {
      await db.prepare(`
        UPDATE alert_approval_pending
        SET notification_sent = 2, notification_sent_at = datetime('now'),
            notification_error = 'recipient_inactive', status = 'acted',
            acted_at = datetime('now'), acted_action = 'recipient_inactive'
        WHERE id = ? AND status = 'open'
      `).bind(alert.id).run();
      skipped_no_phone++;
      continue;
    }
    const phone = recipient?.phone;
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
      if (isExpenseReceiptTemplate(alert.document_template_id)) {
        const receiptCount = await countActiveExpenseReceiptAttachments(db, alert.document_id);
        try {
          const dedicatedResult = await sendAlimtalkByTemplate(
            env,
            'EXPENSE_RECEIPT_SUBMITTED',
            {
              applicant_name: alert.document_author_name || '',
              doc_title: alert.document_title || '영수증 첨부 신청서',
              branch: alert.document_branch || '',
              department: alert.document_department || '',
              receipt_count: String(receiptCount),
              submit_date: submitDate,
              link: `${APP_URL}/expense-receipts/${alert.document_id}`,
            },
            [phone],
          );
          if (!dedicatedResult) {
            throw new Error('NCP 알림톡 설정이 없어 영수증 제출 알림을 발송하지 못했습니다.');
          }
        } catch (templateError) {
          // NCP에서 신규 템플릿 승인 전이어도 제출/알림 흐름을 막지 않는다.
          console.warn('[expense-receipt] dedicated alimtalk failed; falling back to DOC_SUBMITTED', {
            alertId: alert.id,
            error: String(templateError),
          });
          const fallbackResult = await sendAlimtalkByTemplate(
            env,
            'DOC_SUBMITTED',
            {
              author_name: alert.document_author_name || '',
              doc_title: `[영수증 첨부 신청서] ${alert.document_title || ''}`.trim(),
              department: `${alert.document_branch || ''} ${alert.document_department || ''}`.trim(),
              submit_date: submitDate,
              link: `${APP_URL}/expense-receipts/${alert.document_id}`,
            },
            [phone],
          );
          if (!fallbackResult) {
            throw new Error('NCP 알림톡 설정이 없어 영수증 제출 대체 알림을 발송하지 못했습니다.');
          }
        }
      } else {
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
      }
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
