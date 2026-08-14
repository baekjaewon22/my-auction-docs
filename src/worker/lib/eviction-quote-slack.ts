import { APP_URL } from '../alimtalk.ts';

type EvictionQuoteSlackEnv = Record<string, unknown> & { DB?: D1Database };

export type EvictionQuoteSlackInput = {
  noteId: string;
  authorName: string;
  court: string;
  caseNumber: string;
  title: string;
};

type SlackWebhookChoice = { url: string; source: string };

function validSlackWebhookUrl(value: unknown): string {
  const text = String(value || '').trim();
  return text.startsWith('https://hooks.slack.com/services/') ? text : '';
}

function chooseSlackWebhook(env: EvictionQuoteSlackEnv): SlackWebhookChoice {
  const candidates: Array<[string, unknown]> = [
    ['SLACK_EVICTION_QUOTE_WEBHOOK_URL', env.SLACK_EVICTION_QUOTE_WEBHOOK_URL],
    ['SLACK_ACCOUNTING_WEBHOOK_URL', env.SLACK_ACCOUNTING_WEBHOOK_URL],
    ['SLACK_ROOM_RESERVATION_WEBHOOK_URL', env.SLACK_ROOM_RESERVATION_WEBHOOK_URL],
  ];
  for (const [source, value] of candidates) {
    const url = validSlackWebhookUrl(value);
    if (url) return { url, source };
  }
  return { url: '', source: '' };
}

export function evictionQuoteSlackWebhookSource(env: Record<string, unknown>): string {
  return chooseSlackWebhook(env).source;
}

function safeText(value: unknown): string {
  return String(value || '').trim() || '-';
}

export function renderEvictionQuoteSlackMessage(input: EvictionQuoteSlackInput): string {
  return [
    ':house_with_garden: 명도 견적 의뢰',
    '',
    `요청자: ${safeText(input.authorName)}`,
    `법원: ${safeText(input.court)}`,
    `사건번호: ${safeText(input.caseNumber)}`,
    `제목: ${safeText(input.title)}`,
    '',
    `내용 확인 및 답변: ${APP_URL}/admin-notes?tab=eviction_quote&note=${encodeURIComponent(input.noteId)}`,
  ].join('\n');
}

async function ensureSlackLogTable(db?: D1Database): Promise<void> {
  if (!db) return;
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS eviction_quote_slack_logs (
      id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL,
      webhook_source TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      error_message TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours'))
    )
  `).run();
  await db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_eviction_quote_slack_logs_note
    ON eviction_quote_slack_logs(note_id, created_at)
  `).run();
  await db.prepare(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_eviction_quote_slack_success_once
    ON eviction_quote_slack_logs(note_id)
    WHERE status = 'success'
  `).run();
}

async function hasSuccessfulLog(db: D1Database | undefined, noteId: string): Promise<boolean> {
  if (!db) return false;
  await ensureSlackLogTable(db);
  const row = await db.prepare(`
    SELECT 1 FROM eviction_quote_slack_logs
    WHERE note_id = ? AND status = 'success'
    LIMIT 1
  `).bind(noteId).first();
  return !!row;
}

async function writeSlackLog(
  env: EvictionQuoteSlackEnv,
  input: EvictionQuoteSlackInput,
  status: 'success' | 'failed' | 'skipped',
  webhookSource = '',
  errorMessage = '',
): Promise<void> {
  try {
    await ensureSlackLogTable(env.DB);
    if (!env.DB) return;
    const insert = status === 'success' ? 'INSERT OR IGNORE' : 'INSERT';
    await env.DB.prepare(`
      ${insert} INTO eviction_quote_slack_logs
        (id, note_id, webhook_source, status, error_message)
      VALUES (?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      input.noteId,
      webhookSource,
      status,
      errorMessage.slice(0, 500),
    ).run();
  } catch (error) {
    console.error('[eviction quote slack] failed to write log', error);
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

export async function sendEvictionQuoteSlackNotification(
  env: EvictionQuoteSlackEnv,
  input: EvictionQuoteSlackInput,
): Promise<{ sent: boolean; skipped?: boolean; webhookSource?: string }> {
  if (await hasSuccessfulLog(env.DB, input.noteId)) {
    return { sent: false, skipped: true, webhookSource: 'already_sent' };
  }

  const webhook = chooseSlackWebhook(env);
  if (!webhook.url) {
    await writeSlackLog(env, input, 'skipped', '', 'missing valid Slack webhook URL');
    return { sent: false, skipped: true };
  }

  try {
    await postToSlack(webhook.url, renderEvictionQuoteSlackMessage(input));
    await writeSlackLog(env, input, 'success', webhook.source);
    return { sent: true, webhookSource: webhook.source };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await writeSlackLog(env, input, 'failed', webhook.source, message);
    throw error;
  }
}
