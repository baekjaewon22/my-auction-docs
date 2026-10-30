import { ensureSalesProxySchema } from './sales-proxy-schema.ts';

type ProxyRow = { id: string; user_name: string; branch: string; department: string; proxy_agent: string; proxy_date: string; amount?: number; proxy_cost: number; focus_date: string };
type ProxyEnv = { DB: D1Database; SLACK_EXPENSE_RECEIPT_WEBHOOK_URL?: string; SLACK_ACCOUNTING_WEBHOOK_URL?: string };

// Same channel precedence as expense-receipt-slack, explicitly requested by owner.
export function proxySlackWebhook(env: Omit<ProxyEnv, 'DB'>): string {
  for (const value of [env.SLACK_EXPENSE_RECEIPT_WEBHOOK_URL, env.SLACK_ACCOUNTING_WEBHOOK_URL]) {
    try {
      if (!value) continue;
      const url = new URL(value.trim());
      if (url.protocol === 'https:' && url.hostname === 'hooks.slack.com' && !url.username && !url.password && !url.port && url.pathname.startsWith('/services/')) return url.href;
    } catch { /* Try the same accounting fallback as expense receipts. */ }
  }
  return '';
}
const safe = (value: unknown) => String(value || '-').replace(/[\r\n]/g, ' ').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function renderSalesProxySlack(row: ProxyRow): string {
  const query = new URLSearchParams({ focus: 'sales', id: row.id });
  if (/^\d{4}-\d{2}/.test(row.focus_date || '')) query.set('month', row.focus_date.slice(0, 7));
  return [':calendar: 매수신청 대리일 안내', `신청자: ${safe(row.user_name)}`, `지사/부서: ${safe(row.branch)} / ${safe(row.department)}`,
    `대리인: ${safe(row.proxy_agent)}`, `대리일: ${safe(row.proxy_date)}`, `금액: ${Number(row.amount || row.proxy_cost || 0).toLocaleString('ko-KR')}원`,
    `결재/확인: https://my-docs.kr/sales?${query}`].join('\n');
}
export function salesProxyDueDate(now: Date): string | null {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.getUTCHours() >= 14 ? kst.toISOString().slice(0, 10) : null;
}

// Explicit operator test only; no sales rows or scheduled delivery claims are changed.
export async function sendSalesProxySlackTest(env: ProxyEnv, requestId: string, now = new Date()) {
  const webhook = proxySlackWebhook(env);
  if (!webhook) return { sent: false, reason: 'missing_webhook' };
  await ensureSalesProxySchema(env.DB);
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS sales_proxy_slack_tests (
    request_id TEXT PRIMARY KEY, status TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
  const claim = await env.DB.prepare("INSERT OR IGNORE INTO sales_proxy_slack_tests(request_id,status) VALUES(?,'sending')").bind(requestId).run();
  if (!claim.meta.changes) return { sent: false, reason: 'already_attempted' };
  const date = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const text = '[테스트 발송 · 실제 지급/결재 대상 아님]\n' + renderSalesProxySlack({
    id: 'test', user_name: '시스템 테스트', branch: '테스트 지사', department: '테스트 부서',
    proxy_agent: '테스트 대리인', proxy_date: date, proxy_cost: 100000, focus_date: date,
  }).replace(/https:\/\/my-docs\.kr\/sales\?[^\s]+/, 'https://my-docs.kr/sales') + '\n실제 알림은 대리일 오후 2시에 발송됩니다.';
  try {
    const response = await fetch(webhook, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, unfurl_links: false, unfurl_media: false }), signal: AbortSignal.timeout(10000) });
    const accepted = response.ok && (await response.text()).trim() === 'ok';
    await env.DB.prepare('UPDATE sales_proxy_slack_tests SET status=? WHERE request_id=?').bind(accepted ? 'sent' : 'rejected',requestId).run();
    return { sent: accepted, slack_status: response.status, schema_ready: true };
  } catch {
    await env.DB.prepare("UPDATE sales_proxy_slack_tests SET status='uncertain' WHERE request_id=?").bind(requestId).run();
    return { sent: false, reason: 'uncertain_do_not_retry', schema_ready: true };
  }
}
export const DUE_SALES_PROXY_SQL = `SELECT sr.id,u.name AS user_name,sr.branch,sr.department,sr.proxy_agent,sr.proxy_date,sr.amount,sr.proxy_cost,
  CASE WHEN sr.status IN ('confirmed','card_pending') THEN
    CASE WHEN sr.payment_type='카드' THEN COALESCE(NULLIF(sr.card_deposit_date,''),sr.contract_date)
    ELSE COALESCE(NULLIF(sr.deposit_date,''),sr.contract_date) END ELSE sr.contract_date END AS focus_date
  FROM sales_records sr JOIN users u ON u.id=sr.user_id
  WHERE sr.type='매수신청대리' AND sr.proxy_undecided=0 AND sr.proxy_date=? AND trim(sr.proxy_agent)!=''
    AND sr.status IN ('pending','confirmed','card_pending') AND sr.direction='income'
    AND NOT EXISTS (SELECT 1 FROM sales_proxy_slack_deliveries l WHERE l.sales_id=sr.id AND l.proxy_date=sr.proxy_date)
  ORDER BY sr.id`;

export async function sendDueSalesProxySlack(env: ProxyEnv, now = new Date()) {
  const date = salesProxyDueDate(now);
  if (!date) return { sent: 0, skipped: 0 };
  await ensureSalesProxySchema(env.DB);
  const rows = await env.DB.prepare(DUE_SALES_PROXY_SQL).bind(date).all<ProxyRow>();
  let sent = 0, skipped = 0, attempts = 0;
  for (const row of rows.results) {
    const webhook = proxySlackWebhook(env);
    if (!webhook) { skipped++; continue; }
    if (attempts >= 50) break;
    attempts++;
    // Claim before sending. An ambiguous timeout is held for manual reconciliation,
    // never automatically resent (Slack webhooks do not offer an idempotency key).
    const claim = await env.DB.prepare(`INSERT OR IGNORE INTO sales_proxy_slack_deliveries(sales_id,proxy_date,status)
      SELECT id,proxy_date,'sending' FROM sales_records WHERE id=? AND proxy_date=? AND proxy_agent=? AND branch=? AND proxy_cost=?
      AND type='매수신청대리' AND proxy_undecided=0 AND status IN ('pending','confirmed','card_pending') AND direction='income'`
    ).bind(row.id,date,row.proxy_agent,row.branch,row.proxy_cost).run();
    if (!claim.meta.changes) continue;
    let response: Response;
    try {
      response = await fetch(webhook, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: renderSalesProxySlack(row), unfurl_links: false, unfurl_media: false }), signal: AbortSignal.timeout(10000) });
    } catch {
      await env.DB.prepare("UPDATE sales_proxy_slack_deliveries SET status='uncertain',updated_at=CURRENT_TIMESTAMP WHERE sales_id=? AND proxy_date=?").bind(row.id,date).run();
      continue;
    }
    if (!response.ok) {
      // Explicit rejection is safe to retry on a later cron run.
      await env.DB.prepare("DELETE FROM sales_proxy_slack_deliveries WHERE sales_id=? AND proxy_date=? AND status='sending'").bind(row.id,date).run();
      console.warn('[sales proxy slack] rejected', response.status);
      continue;
    }
    await env.DB.prepare("UPDATE sales_proxy_slack_deliveries SET status='sent',updated_at=CURRENT_TIMESTAMP WHERE sales_id=? AND proxy_date=?").bind(row.id,date).run();
    sent++;
  }
  if (skipped) console.warn('[sales proxy slack] missing expense/accounting webhook:', skipped);
  return { sent, skipped };
}
