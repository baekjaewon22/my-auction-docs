import { APP_URL } from '../alimtalk.ts';

type ExpenseReceiptSlackEnv = Record<string, unknown> & { DB?: D1Database };

export type ExpenseReceiptSlackInput = {
  documentId: string;
  authorName: string;
  branch: string;
  department: string;
  purpose: string;
  totalAmount: number;
  receiptCount: number;
  isResubmit?: boolean;
};

type SlackWebhookChoice = { url: string; source: string };

function validSlackWebhookUrl(value: unknown): string {
  const text = String(value || '').trim();
  return text.startsWith('https://hooks.slack.com/services/') ? text : '';
}

// 전용 웹훅(SLACK_EXPENSE_RECEIPT_WEBHOOK_URL)이 없으면 기존 회계/총무 채널로 폴백한다.
function chooseSlackWebhook(env: ExpenseReceiptSlackEnv): SlackWebhookChoice {
  const candidates: Array<[string, unknown]> = [
    ['SLACK_EXPENSE_RECEIPT_WEBHOOK_URL', env.SLACK_EXPENSE_RECEIPT_WEBHOOK_URL],
    ['SLACK_ACCOUNTING_WEBHOOK_URL', env.SLACK_ACCOUNTING_WEBHOOK_URL],
  ];
  for (const [source, value] of candidates) {
    const url = validSlackWebhookUrl(value);
    if (url) return { url, source };
  }
  return { url: '', source: '' };
}

export function expenseReceiptSlackWebhookSource(env: Record<string, unknown>): string {
  return chooseSlackWebhook(env).source;
}

function safeText(value: unknown): string {
  return String(value || '').trim() || '-';
}

export function renderExpenseReceiptSlackMessage(input: ExpenseReceiptSlackInput): string {
  const scope = [input.branch, input.department].map((part) => String(part || '').trim()).filter(Boolean).join(' · ') || '-';
  return [
    input.isResubmit ? ':arrows_counterclockwise: 영수증 지출결의서 재제출' : ':page_facing_up: 영수증 지출결의서 제출',
    '',
    `신청자: ${safeText(input.authorName)}`,
    `지사/부서: ${scope}`,
    `지출 목적: ${safeText(input.purpose)}`,
    `금액: ${Math.max(0, Number(input.totalAmount) || 0).toLocaleString('ko-KR')}원`,
    `영수증: ${Math.max(0, Number(input.receiptCount) || 0)}장`,
    '',
    `결재/확인: ${APP_URL}/expense-receipts/${encodeURIComponent(input.documentId)}`,
  ].join('\n');
}

async function ensureSlackLogTable(db?: D1Database): Promise<void> {
  if (!db) return;
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS expense_receipt_slack_logs (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      webhook_source TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      error_message TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours'))
    )
  `).run();
  await db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_expense_receipt_slack_logs_document
    ON expense_receipt_slack_logs(document_id, created_at)
  `).run();
}

async function writeSlackLog(
  env: ExpenseReceiptSlackEnv,
  input: ExpenseReceiptSlackInput,
  status: 'success' | 'failed' | 'skipped',
  webhookSource = '',
  errorMessage = '',
): Promise<void> {
  try {
    await ensureSlackLogTable(env.DB);
    if (!env.DB) return;
    await env.DB.prepare(`
      INSERT INTO expense_receipt_slack_logs
        (id, document_id, webhook_source, status, error_message)
      VALUES (?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      input.documentId,
      webhookSource,
      status,
      errorMessage.slice(0, 500),
    ).run();
  } catch (error) {
    console.error('[expense receipt slack] failed to write log', error);
  }
}

async function postToSlack(webhookUrl: string, text: string): Promise<void> {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Slack webhook failed: ${response.status} ${body.slice(0, 200)}`);
  }
}

// 제출 흐름의 서버측 idempotency(submit claim)가 중복 제출을 막으므로 발송 자체의
// 별도 dedup은 두지 않고, 진단용 로그만 남긴다. 발송 실패는 best-effort로 삼켜 제출을 막지 않는다.
export async function sendExpenseReceiptSlackNotification(
  env: ExpenseReceiptSlackEnv,
  input: ExpenseReceiptSlackInput,
): Promise<{ sent: boolean; skipped?: boolean; webhookSource?: string }> {
  const webhook = chooseSlackWebhook(env);
  if (!webhook.url) {
    await writeSlackLog(env, input, 'skipped', '', 'missing valid Slack webhook URL');
    return { sent: false, skipped: true };
  }
  try {
    await postToSlack(webhook.url, renderExpenseReceiptSlackMessage(input));
    await writeSlackLog(env, input, 'success', webhook.source);
    return { sent: true, webhookSource: webhook.source };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await writeSlackLog(env, input, 'failed', webhook.source, message);
    return { sent: false, webhookSource: webhook.source };
  }
}
