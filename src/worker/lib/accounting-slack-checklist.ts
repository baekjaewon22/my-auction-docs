import { APP_URL } from '../alimtalk';

type SlackEnv = { DB: D1Database } & Record<string, unknown>;

type BranchGroup = {
  label: string;
  branches: string[];
};

type ChecklistItem = {
  id: string;
  title: string;
  count: number;
  amount?: number;
  link: string;
  samples: string[];
};

const MAX_SAMPLES = 5;

async function ensureSlackAccountingLogTable(db: D1Database): Promise<void> {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS slack_accounting_logs (
      id TEXT PRIMARY KEY,
      run_key TEXT NOT NULL,
      run_label TEXT NOT NULL DEFAULT '',
      group_label TEXT NOT NULL DEFAULT '',
      branches_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL,
      total_count INTEGER NOT NULL DEFAULT 0,
      message_index INTEGER NOT NULL DEFAULT 0,
      error_message TEXT NOT NULL DEFAULT '',
      sent_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours'))
    )
  `).run();
  await db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_slack_accounting_logs_run
    ON slack_accounting_logs(run_key, status)
  `).run();
}

async function insertSlackAccountingLog(
  db: D1Database,
  input: {
    runKey: string;
    runLabel: string;
    groupLabel: string;
    branches: string[];
    status: 'success' | 'failed' | 'skipped';
    totalCount?: number;
    messageIndex?: number;
    errorMessage?: string;
  },
): Promise<void> {
  await db.prepare(`
    INSERT INTO slack_accounting_logs
      (id, run_key, run_label, group_label, branches_json, status, total_count, message_index, error_message, sent_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'success' THEN datetime('now', '+9 hours') ELSE NULL END)
  `).bind(
    crypto.randomUUID(),
    input.runKey,
    input.runLabel,
    input.groupLabel,
    JSON.stringify(input.branches),
    input.status,
    input.totalCount || 0,
    input.messageIndex || 0,
    (input.errorMessage || '').slice(0, 500),
    input.status,
  ).run();
}

const BRANCH_GROUPS: BranchGroup[] = [
  { label: '의정부지사/대전지사', branches: ['의정부', '의정부지사', '대전', '대전지사'] },
  { label: '서초지사', branches: ['서초', '서초지사'] },
  { label: '부산지사', branches: ['부산', '부산지사'] },
];

function money(value: unknown): string {
  return `${Number(value || 0).toLocaleString('ko-KR')}원`;
}

function shortName(value: unknown): string {
  const text = String(value || '').trim();
  return text || '미기재';
}

function docLabel(type: string): string {
  if (type === '낙찰') return '물건분석보고서';
  if (type.includes('권리분석')) return '권리분석 보증서';
  return '컨설팅계약서';
}

function paymentMethod(record: any): string {
  return shortName(record.payment_type || record.receipt_type || '결제방식 미기재');
}

function branchSql(group: BranchGroup): string {
  const placeholders = group.branches.map(() => '?').join(',');
  return `COALESCE(NULLIF(sr.attribution_branch, ''), sr.branch) IN (${placeholders})`;
}

function periodStart(month: number): number {
  return month % 2 === 0 ? month - 1 : month;
}

function currentKstPeriod(): { year: number; startMonth: number } {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return { year: now.getUTCFullYear(), startMonth: periodStart(now.getUTCMonth() + 1) };
}

function recoveryAmount(record: any): number {
  if (record.pay_type !== 'commission') return 0;
  const supply = Math.round(Number(record.amount || 0) / 1.1);
  const commission = Math.round(supply * Number(record.commission_rate || 0) / 100);
  return Math.round(commission * (1 - 0.033));
}

async function countAndSum(db: D1Database, whereSql: string, group: BranchGroup): Promise<{ count: number; amount: number }> {
  const row = await db.prepare(`
    SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as amount
    FROM sales_records sr
    WHERE ${whereSql}
      AND ${branchSql(group)}
  `).bind(...group.branches).first<{ count: number; amount: number }>();
  return { count: Number(row?.count || 0), amount: Number(row?.amount || 0) };
}

async function pendingDepositItem(db: D1Database, group: BranchGroup): Promise<ChecklistItem> {
  const whereSql = "sr.status = 'pending' AND COALESCE(sr.direction, 'income') != 'expense'";
  const summary = await countAndSum(db, whereSql, group);
  const rows = await db.prepare(`
    SELECT sr.*, u.name as user_name
    FROM sales_records sr
    JOIN users u ON u.id = sr.user_id
    WHERE ${whereSql}
      AND ${branchSql(group)}
    ORDER BY sr.created_at DESC
    LIMIT ?
  `).bind(...group.branches, MAX_SAMPLES).all<any>();

  return {
    id: 'pending-sales',
    title: '입금대기매출',
    count: summary.count,
    amount: summary.amount,
    link: `${APP_URL}/sales`,
    samples: (rows.results || []).map((r) =>
      `${r.contract_date || '-'} ${shortName(r.user_name)} / ${shortName(r.client_name)} / ${money(r.amount)} / ${paymentMethod(r)}`,
    ),
  };
}

async function refundRequestItem(db: D1Database, group: BranchGroup): Promise<ChecklistItem> {
  const whereSql = "sr.status = 'refund_requested'";
  const summary = await countAndSum(db, whereSql, group);
  const rows = await db.prepare(`
    SELECT sr.*, u.name as user_name
    FROM sales_records sr
    JOIN users u ON u.id = sr.user_id
    WHERE ${whereSql}
      AND ${branchSql(group)}
    ORDER BY sr.refund_requested_at DESC
    LIMIT ?
  `).bind(...group.branches, MAX_SAMPLES).all<any>();

  return {
    id: 'refund-requests',
    title: '환불 승인 대기',
    count: summary.count,
    amount: summary.amount,
    link: `${APP_URL}/sales`,
    samples: (rows.results || []).map((r) =>
      `${(r.refund_requested_at || '').slice(0, 10) || '-'} ${shortName(r.user_name)} / ${shortName(r.client_name)} / ${money(r.amount)}`,
    ),
  };
}

async function refundRecoveryItem(db: D1Database, group: BranchGroup): Promise<ChecklistItem> {
  const rows = await db.prepare(`
    SELECT sr.*, u.name as user_name, ua.pay_type, ua.commission_rate
    FROM sales_records sr
    JOIN users u ON u.id = sr.user_id
    LEFT JOIN user_accounting ua ON ua.user_id = sr.user_id
    WHERE sr.status = 'refunded'
      AND sr.refund_approved_at >= datetime('now', '-60 days')
      AND ${branchSql(group)}
    ORDER BY sr.refund_approved_at DESC
    LIMIT 100
  `).bind(...group.branches).all<any>();

  const current = currentKstPeriod();
  const candidates = (rows.results || []).filter((r) => {
    const settleDate = r.payment_type === '카드' && r.card_deposit_date ? r.card_deposit_date : (r.deposit_date || r.contract_date);
    if (!settleDate) return false;
    const [year, month] = String(settleDate).split('-').map(Number);
    const isSamePeriod = year === current.year && periodStart(month) === current.startMonth;
    return r.pay_type === 'commission' || (r.pay_type === 'salary' && !isSamePeriod);
  });

  const totalRecovery = candidates.reduce((sum, r) => sum + recoveryAmount(r), 0);

  return {
    id: 'refund-recovery',
    title: '환불 회수/정산 검토',
    count: candidates.length,
    amount: totalRecovery,
    link: `${APP_URL}/sales`,
    samples: candidates.slice(0, MAX_SAMPLES).map((r) => {
      const settleDate = r.payment_type === '카드' && r.card_deposit_date ? r.card_deposit_date : (r.deposit_date || r.contract_date || '-');
      const recover = recoveryAmount(r);
      return `${settleDate} ${shortName(r.user_name)} / ${shortName(r.client_name)} / 환불 ${money(r.amount)}${recover ? ` / 회수예상 ${money(recover)}` : ' / 이전기간 급여정산 검토'}`;
    }),
  };
}

async function documentCheckItem(db: D1Database, group: BranchGroup): Promise<ChecklistItem> {
  const rows = await db.prepare(`
    SELECT sr.*, u.name as user_name
    FROM sales_records sr
    JOIN users u ON u.id = sr.user_id
    WHERE COALESCE(sr.direction, 'income') != 'expense'
      AND sr.status != 'refunded'
      AND (sr.type IN ('계약', '낙찰') OR sr.type LIKE '%권리분석%')
      AND COALESCE(sr.contract_not_approved, 0) = 0
      AND (COALESCE(sr.contract_submitted, 0) = 1 OR COALESCE(sr.contract_not_submitted, 0) = 1)
      AND ${branchSql(group)}
    ORDER BY sr.updated_at DESC, sr.created_at DESC
    LIMIT 50
  `).bind(...group.branches).all<any>();

  const records = rows.results || [];

  return {
    id: 'document-check',
    title: '계약서/물건분석보고서 최종 확인',
    count: records.length,
    link: `${APP_URL}/sales`,
    samples: records.slice(0, MAX_SAMPLES).map((r) => {
      const state = Number(r.contract_submitted || 0) === 1 ? '업로드 확인 필요' : '미제출 사유 승인 필요';
      return `${r.contract_date || '-'} ${shortName(r.user_name)} / ${shortName(r.client_name)} / ${docLabel(String(r.type || ''))} / ${state}`;
    }),
  };
}

function renderItem(item: ChecklistItem): string {
  const total = item.amount !== undefined ? ` / ${money(item.amount)}` : '';
  const header = `☐ ${item.title}: ${item.count.toLocaleString('ko-KR')}건${total}`;
  if (item.count === 0) return `${header}\n  - 처리할 항목 없음`;

  const samples = item.samples.length > 0
    ? item.samples.map((sample) => `  - ${sample}`).join('\n')
    : '  - 상세 항목은 화면에서 확인';
  return `${header}\n${samples}\n  - 바로가기: ${item.link}`;
}

function renderMessage(group: BranchGroup, items: ChecklistItem[], runLabel: string): string {
  const date = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const totalCount = items.reduce((sum, item) => sum + item.count, 0);
  return [
    `총무 체크리스트 (${runLabel}) - ${group.label} - ${date}`,
    `담당자 확인 후 총무 최종 확인 대기: ${totalCount.toLocaleString('ko-KR')}건`,
    '',
    ...items.map(renderItem),
    '',
    '권장 처리 순서: 환불/회수 검토 → 입금대기매출 → 문서 최종 확인',
  ].join('\n\n');
}

async function postToSlack(webhookUrl: string, text: string): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Slack webhook failed: ${res.status} ${body.slice(0, 200)}`);
  }
}

async function buildGroupMessage(db: D1Database, group: BranchGroup, runLabel: string): Promise<{ text: string; totalCount: number }> {
  const items = await Promise.all([
    pendingDepositItem(db, group),
    refundRequestItem(db, group),
    refundRecoveryItem(db, group),
    documentCheckItem(db, group),
  ]);
  return {
    text: renderMessage(group, items, runLabel),
    totalCount: items.reduce((sum, item) => sum + item.count, 0),
  };
}

export async function sendAccountingSlackChecklist(env: SlackEnv, runLabel: string): Promise<{ sent: boolean; totalCount: number; messages: number; failed: number }> {
  await ensureSlackAccountingLogTable(env.DB);
  const runKey = `${new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 16)}-${runLabel}`;
  const webhookUrl = String(env.SLACK_ACCOUNTING_WEBHOOK_URL || env.SLACK_WEBHOOK_URL || '').trim();
  if (!webhookUrl) {
    console.warn('[slack accounting checklist] skipped: missing SLACK_ACCOUNTING_WEBHOOK_URL');
    await insertSlackAccountingLog(env.DB, {
      runKey,
      runLabel,
      groupLabel: 'all',
      branches: [],
      status: 'skipped',
      errorMessage: 'missing SLACK_ACCOUNTING_WEBHOOK_URL',
    });
    return { sent: false, totalCount: 0, messages: 0, failed: 0 };
  }

  let totalCount = 0;
  let messages = 0;
  let failed = 0;
  for (const [index, group] of BRANCH_GROUPS.entries()) {
    try {
      const result = await buildGroupMessage(env.DB, group, runLabel);
      totalCount += result.totalCount;
      await postToSlack(webhookUrl, result.text);
      messages += 1;
      await insertSlackAccountingLog(env.DB, {
        runKey,
        runLabel,
        groupLabel: group.label,
        branches: group.branches,
        status: 'success',
        totalCount: result.totalCount,
        messageIndex: index + 1,
      });
    } catch (err: any) {
      failed += 1;
      await insertSlackAccountingLog(env.DB, {
        runKey,
        runLabel,
        groupLabel: group.label,
        branches: group.branches,
        status: 'failed',
        messageIndex: index + 1,
        errorMessage: err?.message || String(err),
      });
    }
  }

  return { sent: failed === 0 && messages > 0, totalCount, messages, failed };
}
