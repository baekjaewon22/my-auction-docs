import { Hono } from 'hono';
import type { AuthEnv } from '../types';
import { authMiddleware, requireRole } from '../middleware/auth';
import { sendAlimtalkByTemplate, APP_URL } from '../alimtalk';

const sales = new Hono<AuthEnv>();
sales.use('*', authMiddleware);

const ACCOUNTING_ROLES = ['master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst'] as const;
const EDIT_ACCOUNTING_ROLES = ['master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst'] as const;

// admin 권한 확장: 본인 지사 외 추가 지사 열람 가능 (특정 사용자 예외)
// 진성헌(서초·admin·본부장): 서초 + 대전 매출 열람
const ADMIN_EXTRA_BRANCHES: Record<string, string[]> = {
  'c32c3021-b8f6-42f8-b977-7e6e53a7e6f6': ['대전'], // 진성헌
};

// 활동 내역 로그 기록 대상 역할 (총무/총무보조만)
const LOGGED_ROLES = new Set(['accountant', 'accountant_asst']);

type LogUser = { sub: string; name?: string; role: string };
type LogInput = {
  action: 'update' | 'delete' | 'status_change' | 'refund_approve' | 'deposit_claim_approve' | 'deposit_delete' | 'payment_method_change';
  target_type?: string;
  target_id: string;
  target_label: string;
  diff_summary: string;
  before?: any;
  after?: any;
};

async function logActivity(db: D1Database, user: LogUser, input: LogInput) {
  if (!LOGGED_ROLES.has(user.role)) return;
  try {
    await db.prepare(`
      INSERT INTO accounting_activity_logs
        (id, actor_id, actor_name, actor_role, action, target_type, target_id, target_label, diff_summary, before_snapshot, after_snapshot)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(), user.sub, user.name || '', user.role,
      input.action, input.target_type || 'sales_record', input.target_id,
      input.target_label || '', input.diff_summary || '',
      input.before ? JSON.stringify(input.before) : null,
      input.after ? JSON.stringify(input.after) : null,
    ).run();
  } catch (e) {
    console.error('[activity-log] failed:', e);
  }
}

// 매출 레코드를 사람이 읽기 쉬운 라벨로 변환
function recordLabel(r: any): string {
  const name = r.client_name || r.depositor_name || '미기재';
  const amt = Number(r.amount || 0).toLocaleString('ko-KR');
  const date = r.contract_date || '';
  return `${date} ${name} ${amt}원`.trim();
}

// 전후 diff 요약 생성 (변경된 필드만)
function buildDiff(before: any, after: any, fields: { key: string; label: string; fmt?: (v: any) => string }[]): string {
  const parts: string[] = [];
  for (const f of fields) {
    const b = before[f.key];
    const a = after[f.key];
    if ((b ?? '') === (a ?? '')) continue;
    const bv = f.fmt ? f.fmt(b) : String(b ?? '');
    const av = f.fmt ? f.fmt(a) : String(a ?? '');
    parts.push(`${f.label}: ${bv || '(없음)'} → ${av || '(없음)'}`);
  }
  return parts.join(', ');
}

const SALES_DIFF_FIELDS = [
  { key: 'type', label: '유형' },
  { key: 'type_detail', label: '사건내용' },
  { key: 'client_name', label: '고객명' },
  { key: 'depositor_name', label: '입금자명' },
  { key: 'amount', label: '금액', fmt: (v: any) => Number(v || 0).toLocaleString('ko-KR') + '원' },
  { key: 'contract_date', label: '계약일' },
  { key: 'deposit_date', label: '입금일' },
  { key: 'card_deposit_date', label: '카드정산일' },
  { key: 'payment_type', label: '결제방식' },
  { key: 'status', label: '상태' },
  { key: 'memo', label: '메모' },
];

// ━━━ 매출 내역 CRUD ━━━

// GET /api/sales — 매출 목록 (권한별 필터)
sales.get('/', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const { month, month_end, user_id: filterUserId, date_mode } = c.req.query();

  let query = `
    SELECT sr.*, sr.deposit_date, u.name as user_name, u.position_title,
      cu.name as confirmed_by_name, ru.name as refund_approved_by_name
    FROM sales_records sr
    JOIN users u ON u.id = sr.user_id
    LEFT JOIN users cu ON cu.id = sr.confirmed_by
    LEFT JOIN users ru ON ru.id = sr.refund_approved_by
  `;
  const conditions: string[] = [];
  const params: any[] = [];

  const role = user.role;
  const isAccountant = role === 'accountant' || role === 'accountant_asst';
  const isAdmin = ['master', 'ceo', 'cc_ref', 'admin'].includes(role);

  if (role === 'director') {
    // 총괄이사: 본인 건 + 대전/부산 (담당자 지사 또는 매출귀속 지사 기준)
    conditions.push(`(sr.user_id = ? OR sr.branch IN ('대전', '부산') OR sr.attribution_branch IN ('대전', '부산'))`);
    params.push(user.sub);
  } else if (!isAdmin && !isAccountant) {
    if (role === 'manager') {
      // 팀장: 본인 팀 전체
      conditions.push('(sr.user_id = ? OR (sr.branch = ? AND sr.department = ?))');
      params.push(user.sub, user.branch, user.department);
    } else {
      // 팀원: 본인만
      conditions.push('sr.user_id = ?');
      params.push(user.sub);
    }
  } else if (role === 'admin' && user.branch !== '의정부') {
    // 일반 관리자: 본인 지사 (+ 예외 사용자에겐 추가 지사 허용)
    const extra = ADMIN_EXTRA_BRANCHES[user.sub] || [];
    if (extra.length > 0) {
      const allBranches = [user.branch, ...extra];
      const placeholders = allBranches.map(() => '?').join(',');
      conditions.push(`(sr.branch IN (${placeholders}) OR sr.attribution_branch IN (${placeholders}))`);
      params.push(...allBranches, ...allBranches);
    } else {
      conditions.push('sr.branch = ?');
      params.push(user.branch);
    }
  }

  // 담당자 필터
  if (filterUserId) {
    conditions.push('sr.user_id = ?');
    params.push(filterUserId);
  }

  // 월별 필터: month_end 있으면 범위(시작월~종료월), 없으면 단일월
  if (month) {
    const endMonth = month_end || month;
    const mStart = month + '-01';
    const [ey, em] = endMonth.split('-').map(Number);
    const mEnd = `${endMonth}-${new Date(ey, em, 0).getDate()}`;
    if (date_mode === 'settle') {
      conditions.push(`(
        (sr.payment_type = '카드' AND sr.card_deposit_date >= ? AND sr.card_deposit_date <= ?)
        OR (sr.payment_type != '카드' AND sr.payment_type != '' AND sr.deposit_date >= ? AND sr.deposit_date <= ?)
        OR ((sr.payment_type = '' OR sr.payment_type IS NULL) AND sr.contract_date >= ? AND sr.contract_date <= ?)
      )`);
      params.push(mStart, mEnd, mStart, mEnd, mStart, mEnd);
    } else {
      conditions.push("sr.contract_date >= ? AND sr.contract_date <= ?");
      params.push(mStart, mEnd);
    }
  }

  if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY sr.created_at DESC';

  const result = params.length > 0
    ? await db.prepare(query).bind(...params).all()
    : await db.prepare(query).all();

  return c.json({ records: result.results });
});

// GET /api/sales/contract-tracker — 실시간 컨설턴트 계약 현황 (대표·총무·정민호 열람)
// 결제일(deposit_date) 단일 기준 — 카드/이체 무관. 결제일 미입력 건은 카운트 제외. 환불 제외.
const CONTRACT_TRACKER_EXTRA_USERS = ['2b6b3606-e425-4361-a115-9283cfef842f']; // 정민호
sales.get('/contract-tracker', async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const allowedRoles = ['master', 'ceo', 'accountant', 'accountant_asst'];
  if (!allowedRoles.includes(user.role) && !CONTRACT_TRACKER_EXTRA_USERS.includes(user.sub)) {
    return c.json({ error: '열람 권한이 없습니다.' }, 403);
  }
  const period = c.req.query('period') || 'today';
  const monthParam = c.req.query('month') || ''; // 'YYYY-MM' for period=month

  // KST 기준 오늘
  const nowMs = Date.now() + 9 * 3600 * 1000;
  const kstNow = new Date(nowMs);
  const yyyy = kstNow.getUTCFullYear();
  const mm = String(kstNow.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(kstNow.getUTCDate()).padStart(2, '0');
  const today = `${yyyy}-${mm}-${dd}`;
  const addDays = (base: string, delta: number) => {
    const [y, m, d] = base.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d) + delta * 86400000);
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
  };

  let fromDate: string, toDate: string;
  if (period === 'today') { fromDate = today; toDate = today; }
  else if (period === 'yesterday') { fromDate = addDays(today, -1); toDate = addDays(today, -1); }
  else if (period === 'week') { fromDate = addDays(today, -6); toDate = today; } // 최근 7일 (오늘 포함)
  else if (period === 'month') {
    // 'YYYY-MM' 기준 해당 월의 1일 ~ 말일
    const target = /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : `${yyyy}-${mm}`;
    const [y, m] = target.split('-').map(Number);
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    fromDate = `${target}-01`;
    toDate = `${target}-${String(lastDay).padStart(2, '0')}`;
  }
  else return c.json({ error: 'period 오류' }, 400);

  // 대상 사용자: 프리랜서·정규직 컨설턴트 (member/manager) + 영업 참여 admin/director (본부장·이사 등)
  // 제외: 본사 관리, 명도팀, support
  // admin/director는 실제 계약 기록이 있는 경우에만 포함 — 비영업 관리자는 자동 제외
  const usersResult = await db.prepare(`
    SELECT id, name, branch, department, position_title, role, login_type
    FROM users
    WHERE approved = 1
      AND branch != '본사 관리'
      AND department != '명도팀'
      AND (
        role IN ('member', 'manager')
        OR (
          role IN ('admin', 'director')
          AND EXISTS (
            SELECT 1 FROM sales_records sr
            WHERE sr.user_id = users.id
              AND sr.type = '계약'
              AND sr.status != 'refunded'
              AND (sr.exclude_from_count IS NULL OR sr.exclude_from_count = 0)
          )
        )
      )
  `).all<any>();
  const eligibleUsers = (usersResult.results || []);

  // 기간 내 계약 집계 — 결제일(deposit_date) 단일 기준
  const salesResult = await db.prepare(`
    SELECT user_id,
      SUM(CASE WHEN amount >= 2200000 THEN 2 ELSE 1 END) as contract_count,
      SUM(amount) as total_amount,
      COUNT(*) as raw_count
    FROM sales_records
    WHERE type = '계약'
      AND status != 'refunded'
      AND (exclude_from_count IS NULL OR exclude_from_count = 0)
      AND deposit_date IS NOT NULL AND deposit_date != ''
      AND deposit_date >= ? AND deposit_date <= ?
    GROUP BY user_id
  `).bind(fromDate, toDate).all<any>();

  const statsMap: Record<string, { contract_count: number; total_amount: number; raw_count: number }> = {};
  for (const r of (salesResult.results || [])) {
    statsMap[r.user_id] = {
      contract_count: Number(r.contract_count) || 0,
      total_amount: Number(r.total_amount) || 0,
      raw_count: Number(r.raw_count) || 0,
    };
  }

  const users = eligibleUsers.map(u => ({
    user_id: u.id,
    user_name: u.name,
    branch: u.branch || '미지정',
    department: u.department || '',
    position_title: u.position_title || '',
    role: u.role,
    login_type: u.login_type || 'employee',
    contract_count: statsMap[u.id]?.contract_count || 0,
    total_amount: statsMap[u.id]?.total_amount || 0,
    raw_count: statsMap[u.id]?.raw_count || 0,
  }));

  // 전직원 합계
  const totalCount = users.reduce((s, u) => s + u.contract_count, 0);
  const totalAmount = users.reduce((s, u) => s + u.total_amount, 0);

  return c.json({
    period, from: fromDate, to: toDate,
    users, total_count: totalCount, total_amount: totalAmount,
  });
});

// GET /api/sales/ranking — 전사 계약건수 랭킹 (집계만, 전 직원 열람 가능)
sales.get('/ranking', async (c) => {
  const db = c.env.DB;
  const { period_start, period_end } = c.req.query();
  if (!period_start || !period_end) return c.json({ error: 'period_start, period_end 필수' }, 400);
  const [sy, sm] = period_start.split('-').map(Number);
  const [ey, em] = period_end.split('-').map(Number);
  const mStart = `${period_start}-01`;
  const mEnd = `${period_end}-${new Date(ey, em, 0).getDate()}`;
  void sy; void sm;

  const result = await db.prepare(`
    SELECT u.name as user_name,
      COALESCE(NULLIF(sr.attribution_branch, ''), sr.branch) as eff_branch,
      u.position_title as position,
      SUM(CASE WHEN sr.amount >= 2200000 THEN 2 ELSE 1 END) as count,
      SUM(sr.amount) as total_amount
    FROM sales_records sr
    JOIN users u ON u.id = sr.user_id
    WHERE sr.type = '계약' AND sr.status = 'confirmed'
      AND (sr.exclude_from_count IS NULL OR sr.exclude_from_count = 0)
      AND (
        (sr.payment_type = '카드' AND sr.card_deposit_date >= ? AND sr.card_deposit_date <= ?)
        OR (sr.payment_type != '카드' AND sr.payment_type != '' AND sr.deposit_date >= ? AND sr.deposit_date <= ?)
        OR ((sr.payment_type = '' OR sr.payment_type IS NULL) AND sr.contract_date >= ? AND sr.contract_date <= ?)
      )
    GROUP BY u.name, eff_branch
    ORDER BY count DESC, total_amount DESC
  `).bind(mStart, mEnd, mStart, mEnd, mStart, mEnd).all<{ user_name: string; eff_branch: string; position: string; count: number; total_amount: number }>();

  return c.json({ ranking: result.results || [] });
});

// POST /api/sales — 매출 내역 추가
sales.post('/', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const body = await c.req.json<{
    type: string; type_detail?: string;
    client_name: string; depositor_name?: string; depositor_different?: boolean;
    amount: number; contract_date?: string; journal_entry_id?: string;
    direction?: string;
    appraisal_rate?: number; winning_rate?: number;
    client_phone?: string;
    payment_type?: string; receipt_type?: string; receipt_phone?: string;
    proxy_cost?: number;
  }>();

  if (!['계약', '낙찰', '중개', '권리분석보증서', '매수신청대리', '기타'].includes(body.type)) {
    return c.json({ error: '유효하지 않은 매출 유형입니다.' }, 400);
  }

  const direction = body.direction === 'expense' ? 'expense' : 'income';
  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO sales_records (id, user_id, type, type_detail, client_name, depositor_name, depositor_different, amount, contract_date, journal_entry_id, direction, branch, department, payment_type, receipt_type, receipt_phone, proxy_cost)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, user.sub, body.type, body.type_detail || '', body.client_name,
    body.depositor_name || '', body.depositor_different ? 1 : 0,
    body.amount || 0, body.contract_date || new Date().toISOString().slice(0, 10),
    body.journal_entry_id || null, direction, user.branch, user.department,
    body.payment_type || '', body.receipt_type || '', body.receipt_phone || '',
    body.proxy_cost || 0
  ).run();

  // 계약조건 기록 (별도 UPDATE — 컬럼 호환성)
  if (body.appraisal_rate || body.winning_rate || body.client_phone) {
    await db.prepare("UPDATE sales_records SET appraisal_rate = ?, winning_rate = ?, client_phone = ? WHERE id = ?")
      .bind(body.appraisal_rate || 0, body.winning_rate || 0, body.client_phone || '', id).run();
  }

  // 알림톡: 매출 등록(입금대기) → 해당 지사 알림톡 ON한 총무에게 DEPOSIT_CLAIM
  const creatorBranch = user.branch || '';
  if (creatorBranch) {
    const accountants = await db.prepare(
      "SELECT phone, alimtalk_branches FROM users WHERE role IN ('accountant', 'accountant_asst') AND approved = 1 AND phone != ''"
    ).all<{ phone: string; alimtalk_branches: string }>();
    const phones = (accountants.results || [])
      .filter(r => r.alimtalk_branches && r.alimtalk_branches.split(',').includes(creatorBranch))
      .map(r => r.phone)
      .filter(Boolean);
    if (phones.length > 0) {
      c.executionCtx.waitUntil(sendAlimtalkByTemplate(
        c.env as unknown as Record<string, unknown>, 'DEPOSIT_CLAIM',
        { claimer_name: user.name, depositor: body.depositor_name || body.client_name, amount: Number(body.amount || 0).toLocaleString('ko-KR'), deposit_date: body.contract_date || new Date().toISOString().slice(0, 10), branch: creatorBranch, link: `${APP_URL}/sales` },
        phones,
      ).catch(() => {}));
    }
  }

  return c.json({ success: true, id });
});

// PUT /api/sales/:id — 매출 내역 수정 (본인 건, pending 상태만)
sales.put('/:id', async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const db = c.env.DB;
  const body = await c.req.json<{
    type?: string; type_detail?: string;
    client_name?: string; depositor_name?: string; depositor_different?: boolean;
    amount?: number; contract_date?: string;
    payment_type?: string; receipt_type?: string; receipt_phone?: string;
    card_deposit_date?: string;
    tax_invoice_date?: string; tax_invoice_type?: string;
    appraisal_rate?: number; winning_rate?: number; client_phone?: string;
    proxy_cost?: number;
  }>();

  const record = await db.prepare('SELECT * FROM sales_records WHERE id = ?').bind(id).first<any>();
  if (!record) return c.json({ error: '매출 내역을 찾을 수 없습니다.' }, 404);

  const isOwner = record.user_id === user.sub;
  const isAdminPlus = ['master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst'].includes(user.role);
  if (!isOwner && !isAdminPlus) return c.json({ error: '권한이 없습니다.' }, 403);
  if (record.status !== 'pending' && !isAdminPlus) return c.json({ error: '확정된 매출은 수정할 수 없습니다.' }, 400);

  // card_pending 상태에서 card_deposit_date 입력 시 → confirmed 전환
  const newCardDepDate = body.card_deposit_date ?? record.card_deposit_date ?? '';
  let statusUpdate = record.status;
  if (record.status === 'card_pending' && body.card_deposit_date && body.card_deposit_date.trim()) {
    statusUpdate = 'confirmed';
  }
  // card_deposit_date 초기화 시 confirmed → card_pending 복귀
  if (record.status === 'confirmed' && record.payment_type === '카드' && body.card_deposit_date === '') {
    statusUpdate = 'card_pending';
  }

  const nextRecord = {
    ...record,
    type: body.type || record.type,
    type_detail: body.type_detail ?? record.type_detail,
    client_name: body.client_name ?? record.client_name,
    depositor_name: body.depositor_name ?? record.depositor_name,
    amount: body.amount ?? record.amount,
    contract_date: body.contract_date ?? record.contract_date,
    payment_type: body.payment_type ?? record.payment_type ?? '',
    card_deposit_date: newCardDepDate,
    status: statusUpdate,
  };

  await db.prepare(`
    UPDATE sales_records SET type = ?, type_detail = ?, client_name = ?, depositor_name = ?,
      depositor_different = ?, amount = ?, contract_date = ?,
      payment_type = ?, receipt_type = ?, receipt_phone = ?, card_deposit_date = ?,
      tax_invoice_date = ?, tax_invoice_type = ?,
      appraisal_rate = ?, winning_rate = ?, client_phone = ?, proxy_cost = ?,
      status = ?, updated_at = datetime('now')
    WHERE id = ?
  `).bind(
    body.type || record.type, body.type_detail ?? record.type_detail,
    body.client_name ?? record.client_name, body.depositor_name ?? record.depositor_name,
    body.depositor_different !== undefined ? (body.depositor_different ? 1 : 0) : record.depositor_different,
    body.amount ?? record.amount, body.contract_date ?? record.contract_date,
    body.payment_type ?? record.payment_type ?? '', body.receipt_type ?? record.receipt_type ?? '',
    body.receipt_phone ?? record.receipt_phone ?? '', newCardDepDate,
    body.tax_invoice_date ?? record.tax_invoice_date ?? '',
    body.tax_invoice_type ?? record.tax_invoice_type ?? '',
    body.appraisal_rate ?? record.appraisal_rate ?? 0, body.winning_rate ?? record.winning_rate ?? 0,
    body.client_phone ?? record.client_phone ?? '',
    body.proxy_cost ?? record.proxy_cost ?? 0,
    statusUpdate, id
  ).run();

  // 총무/총무보조 수정 시 활동 로그
  const diff = buildDiff(record, nextRecord, SALES_DIFF_FIELDS);
  if (diff) {
    await logActivity(db, user as LogUser, {
      action: record.status !== nextRecord.status ? 'status_change' : 'update',
      target_id: id, target_label: recordLabel(nextRecord),
      diff_summary: diff, before: record, after: nextRecord,
    });
  }

  // 알림톡: 카드 정산일 입력으로 card_pending → confirmed 전환 시 담당자에게 ACCOUNTING_CONFIRMED
  if (record.status === 'card_pending' && statusUpdate === 'confirmed') {
    const consultant = await db.prepare('SELECT name, phone FROM users WHERE id = ?').bind(record.user_id).first<{ name: string; phone: string }>();
    if (consultant?.phone) {
      c.executionCtx.waitUntil(sendAlimtalkByTemplate(
        c.env as unknown as Record<string, unknown>, 'ACCOUNTING_CONFIRMED',
        { consultant_name: consultant.name, depositor: record.depositor_name || record.client_name, amount: Number(record.amount || 0).toLocaleString('ko-KR'), confirm_date: newCardDepDate, link: `${APP_URL}/sales` },
        [consultant.phone],
      ).catch(() => {}));
    }
  }

  return c.json({ success: true });
});

// ━━━ 입금 확인 (회계) ━━━

// POST /api/sales/:id/confirm — 입금 확인 (회계가 입금일자 입력)
sales.post('/:id/confirm', requireRole(...EDIT_ACCOUNTING_ROLES), async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const db = c.env.DB;
  const { deposit_date } = await c.req.json<{ deposit_date?: string }>().catch(() => ({ deposit_date: undefined }));

  const record = await db.prepare('SELECT * FROM sales_records WHERE id = ?').bind(id).first<any>();
  if (!record) return c.json({ error: '매출 내역을 찾을 수 없습니다.' }, 404);
  if (record.status !== 'pending') return c.json({ error: '이미 처리된 건입니다.' }, 400);

  const depDate = deposit_date || new Date().toISOString().slice(0, 10);
  // 카드 결제 → card_pending (카드 정산일 입력 전까지 대기)
  const newStatus = record.payment_type === '카드' ? 'card_pending' : 'confirmed';
  await db.prepare(`
    UPDATE sales_records SET status = ?, confirmed_at = datetime('now'), confirmed_by = ?, deposit_date = ?, updated_at = datetime('now')
    WHERE id = ?
  `).bind(newStatus, user.sub, depDate, id).run();

  await logActivity(db, user as LogUser, {
    action: 'status_change', target_id: id, target_label: recordLabel(record),
    diff_summary: `상태: ${record.status} → ${newStatus}${depDate ? `, 입금일: ${depDate}` : ''}`,
    before: { status: record.status, deposit_date: record.deposit_date },
    after: { status: newStatus, deposit_date: depDate },
  });

  // 알림톡: 담당자에게 결제확인 완료 (이체 → confirmed 일 때만; 카드는 정산일 입력 시점에 발송)
  if (newStatus === 'confirmed') {
    const consultant = await db.prepare('SELECT name, phone FROM users WHERE id = ?').bind(record.user_id).first<{ name: string; phone: string }>();
    if (consultant?.phone) {
      c.executionCtx.waitUntil(sendAlimtalkByTemplate(
        c.env as unknown as Record<string, unknown>, 'ACCOUNTING_CONFIRMED',
        { consultant_name: consultant.name, depositor: record.depositor_name || record.client_name, amount: Number(record.amount || 0).toLocaleString('ko-KR'), confirm_date: depDate, link: `${APP_URL}/sales` },
        [consultant.phone],
      ).catch(() => {}));
    }
  }

  return c.json({ success: true });
});

// POST /api/sales/:id/unconfirm — 입금확인 취소 (총무/총무보조/master)
sales.post('/:id/unconfirm', requireRole('master', 'accountant', 'accountant_asst'), async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const db = c.env.DB;

  const record = await db.prepare('SELECT * FROM sales_records WHERE id = ?').bind(id).first<any>();
  if (!record) return c.json({ error: '매출 내역을 찾을 수 없습니다.' }, 404);
  if (record.status !== 'confirmed' && record.status !== 'card_pending') return c.json({ error: '확정된 매출만 취소할 수 있습니다.' }, 400);

  await db.prepare(`
    UPDATE sales_records SET status = 'pending', confirmed_at = NULL, confirmed_by = NULL, deposit_date = '', card_deposit_date = '', updated_at = datetime('now')
    WHERE id = ?
  `).bind(id).run();

  await logActivity(db, user as LogUser, {
    action: 'status_change', target_id: id, target_label: recordLabel(record),
    diff_summary: `확정취소: ${record.status} → pending`,
    before: { status: record.status, deposit_date: record.deposit_date, card_deposit_date: record.card_deposit_date },
    after: { status: 'pending', deposit_date: '', card_deposit_date: '' },
  });

  return c.json({ success: true });
});

// ━━━ 환불 신청/승인 ━━━

// POST /api/sales/:id/refund-request — 환불 신청 (담당자)
sales.post('/:id/refund-request', async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const db = c.env.DB;

  const record = await db.prepare('SELECT * FROM sales_records WHERE id = ?').bind(id).first<any>();
  if (!record) return c.json({ error: '매출 내역을 찾을 수 없습니다.' }, 404);
  if (record.user_id !== user.sub && !['master', 'ceo', 'cc_ref', 'admin'].includes(user.role)) {
    return c.json({ error: '본인 건만 환불 신청할 수 있습니다.' }, 403);
  }
  if (record.status !== 'confirmed' && record.status !== 'card_pending') return c.json({ error: '확정된 매출만 환불 신청할 수 있습니다.' }, 400);

  await db.prepare(`
    UPDATE sales_records SET status = 'refund_requested', refund_requested_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `).bind(id).run();

  return c.json({ success: true });
});

// POST /api/sales/:id/refund-approve — 환불 승인 (회계)
sales.post('/:id/refund-approve', requireRole(...EDIT_ACCOUNTING_ROLES), async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const db = c.env.DB;

  const record = await db.prepare('SELECT * FROM sales_records WHERE id = ?').bind(id).first<any>();
  if (!record) return c.json({ error: '매출 내역을 찾을 수 없습니다.' }, 404);
  if (record.status !== 'refund_requested') return c.json({ error: '환불 신청된 건만 승인할 수 있습니다.' }, 400);

  await db.prepare(`
    UPDATE sales_records SET status = 'refunded', refund_approved_at = datetime('now'), refund_approved_by = ?, updated_at = datetime('now')
    WHERE id = ?
  `).bind(user.sub, id).run();

  await logActivity(db, user as LogUser, {
    action: 'refund_approve', target_id: id, target_label: recordLabel(record),
    diff_summary: `환불승인: ${record.status} → refunded`,
    before: { status: record.status },
    after: { status: 'refunded' },
  });

  // 알림톡: 환불 승인 → 해당 지사 총무에게 REFUND_NOTICE
  const consultant = await db.prepare('SELECT name FROM users WHERE id = ?').bind(record.user_id).first<{ name: string }>();
  const recordBranch = record.branch || '';
  if (recordBranch) {
    const accountants = await db.prepare(
      "SELECT phone, alimtalk_branches FROM users WHERE role IN ('accountant', 'accountant_asst') AND approved = 1 AND phone != ''"
    ).all<{ phone: string; alimtalk_branches: string }>();
    const phones = (accountants.results || [])
      .filter(r => r.alimtalk_branches && r.alimtalk_branches.split(',').includes(recordBranch))
      .map(r => r.phone)
      .filter(Boolean);
    if (phones.length > 0) {
      c.executionCtx.waitUntil(sendAlimtalkByTemplate(
        c.env as unknown as Record<string, unknown>, 'REFUND_NOTICE',
        { consultant_name: consultant?.name || '', client_name: record.client_name || '', amount: Number(record.amount || 0).toLocaleString('ko-KR'), branch: recordBranch, link: `${APP_URL}/sales` },
        phones,
      ).catch(() => {}));
    }
  }

  return c.json({ success: true });
});

// ━━━ [6-2] 계약서 제출/미제출 ━━━

// PUT /api/sales/:id/contract-check — 계약서 제출 체크
sales.put('/:id/contract-check', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const body = await c.req.json<{
    contract_submitted?: number;
    contract_not_submitted?: number;
    contract_not_reason?: string;
    contract_not_approved?: number;
  }>();

  const sets: string[] = ["updated_at = datetime('now')"];
  const params: any[] = [];
  if (body.contract_submitted !== undefined) { sets.push('contract_submitted = ?'); params.push(body.contract_submitted); }
  if (body.contract_not_submitted !== undefined) { sets.push('contract_not_submitted = ?'); params.push(body.contract_not_submitted); }
  if (body.contract_not_reason !== undefined) { sets.push('contract_not_reason = ?'); params.push(body.contract_not_reason); }
  if (body.contract_not_approved !== undefined) { sets.push('contract_not_approved = ?'); params.push(body.contract_not_approved); }
  params.push(id);

  await db.prepare(`UPDATE sales_records SET ${sets.join(', ')} WHERE id = ?`).bind(...params).run();
  return c.json({ success: true });
});

// PUT /api/sales/:id/contract-not-approve — 계약서 미제출 사유 승인 (회계)
sales.put('/:id/contract-not-approve', requireRole(...EDIT_ACCOUNTING_ROLES), async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const db = c.env.DB;
  await db.prepare("UPDATE sales_records SET contract_not_approved = 1, contract_not_approved_by = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(user.sub, id).run();
  return c.json({ success: true });
});

// ━━━ 회계 메모 ━━━

// PUT /api/sales/:id/memo — 회계 전용 메모
sales.put('/:id/memo', requireRole(...EDIT_ACCOUNTING_ROLES), async (c) => {
  const id = c.req.param('id');
  const { memo } = await c.req.json<{ memo: string }>();
  const db = c.env.DB;

  await db.prepare("UPDATE sales_records SET memo = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(memo || '', id).run();

  return c.json({ success: true });
});

// DELETE /api/sales/by-entry/:entryId — 낙찰 취소 시 매출 삭제
sales.delete('/by-entry/:entryId', async (c) => {
  const entryId = c.req.param('entryId');
  const db = c.env.DB;
  await db.prepare("DELETE FROM sales_records WHERE journal_entry_id = ? AND status = 'pending'").bind(entryId).run();
  return c.json({ success: true });
});

// ━━━ 대시보드용 알림 ━━━

// GET /api/sales/pending — 입금 대기 건 (대시보드)
sales.get('/dashboard/pending', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const isAccountingOrAdmin = [...ACCOUNTING_ROLES].includes(user.role as any);

  if (!isAccountingOrAdmin) return c.json({ records: [] });

  let query = `
    SELECT sr.*, u.name as user_name FROM sales_records sr
    JOIN users u ON u.id = sr.user_id
    WHERE sr.status = 'pending'
  `;
  const params: any[] = [];

  if (user.role === 'admin' && user.branch !== '의정부') {
    const extra = ADMIN_EXTRA_BRANCHES[user.sub] || [];
    if (extra.length > 0) {
      const allBranches = [user.branch, ...extra];
      const placeholders = allBranches.map(() => '?').join(',');
      query += ` AND sr.branch IN (${placeholders})`;
      params.push(...allBranches);
    } else {
      query += ' AND sr.branch = ?';
      params.push(user.branch);
    }
  }

  query += ' ORDER BY sr.created_at DESC LIMIT 20';
  const result = params.length > 0
    ? await db.prepare(query).bind(...params).all()
    : await db.prepare(query).all();

  return c.json({ records: result.results });
});

// GET /api/sales/dashboard/refund-impacts — 환불로 인한 성과금/랭킹 영향 알림 (총무/관리자)
sales.get('/dashboard/refund-impacts', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const isAccountingOrAdmin = ['master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst'].includes(user.role);
  if (!isAccountingOrAdmin) return c.json({ impacts: [] });

  // 최근 60일 이내 환불 승인된 건 조회
  const refunded = await db.prepare(`
    SELECT sr.*, u.name as user_name, u.branch as user_branch, ua.pay_type, ua.commission_rate, ua.standard_sales, ua.salary
    FROM sales_records sr
    JOIN users u ON u.id = sr.user_id
    LEFT JOIN user_accounting ua ON ua.user_id = sr.user_id
    WHERE sr.status = 'refunded'
      AND sr.refund_approved_at >= datetime('now', '-60 days')
    ORDER BY sr.refund_approved_at DESC
  `).all();

  const impacts: any[] = [];
  for (const r of (refunded.results || []) as any[]) {
    // 환불 건이 어느 정산 기간에 속했는지 판단
    const settleDate = r.payment_type === '카드' && r.card_deposit_date ? r.card_deposit_date
      : r.deposit_date ? r.deposit_date : r.contract_date;
    if (!settleDate) continue;
    const [sy, sm] = settleDate.split('-').map(Number);
    const bonusPeriodStart = sm % 2 === 0 ? sm - 1 : sm;
    const bonusPeriodLabel = `${sy}년 ${bonusPeriodStart}~${bonusPeriodStart + 1}월`;

    // 현재 월과 비교 — 이전 기간 환불만 영향 있음
    const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const nowY = now.getFullYear();
    const nowM = now.getMonth() + 1;
    const nowPeriodStart = nowM % 2 === 0 ? nowM - 1 : nowM;
    const isSamePeriod = sy === nowY && bonusPeriodStart === nowPeriodStart;

    const isContract = r.type === '계약';
    const affectsBonus = r.pay_type === 'salary' && !isSamePeriod;
    const affectsCommission = r.pay_type === 'commission';

    // 회수 금액 계산
    let recoveryAmount = 0;
    if (affectsCommission) {
      const supply = Math.round(r.amount / 1.1);
      const commission = Math.round(supply * (r.commission_rate || 0) / 100);
      recoveryAmount = Math.round(commission * (1 - 0.033)); // 원천세 제외 실지급분
    }

    impacts.push({
      id: r.id,
      user_id: r.user_id,
      user_name: r.user_name,
      user_branch: r.user_branch,
      type: r.type,
      client_name: r.client_name,
      amount: r.amount,
      settle_date: settleDate,
      refund_approved_at: r.refund_approved_at,
      bonus_period_label: bonusPeriodLabel,
      pay_type: r.pay_type || 'salary',
      is_contract: isContract,
      affects_bonus: affectsBonus,
      affects_commission: affectsCommission,
      recovery_amount: recoveryAmount,
      is_previous_period: !isSamePeriod,
    });
  }

  // 총무보조는 팀장·관리자급·이사·대표자 제외
  const RESTRICTED_ROLES = ['master', 'ceo', 'cc_ref', 'admin', 'director', 'manager'];
  let finalImpacts = impacts;
  if (user.role === 'accountant_asst') {
    // user_role이 필요하므로 refetch
    const ids = Array.from(new Set(impacts.map(i => i.user_id)));
    if (ids.length > 0) {
      const placeholders = ids.map(() => '?').join(',');
      const userRoles = await db.prepare(`SELECT id, role FROM users WHERE id IN (${placeholders})`).bind(...ids).all();
      const roleMap = new Map((userRoles.results as any[]).map(u => [u.id, u.role]));
      finalImpacts = impacts.filter(i => !RESTRICTED_ROLES.includes(roleMap.get(i.user_id) || ''));
    }
  }

  return c.json({ impacts: finalImpacts });
});

// GET /api/sales/dashboard/refund-requests — 환불 신청 건 (대시보드)
sales.get('/dashboard/refund-requests', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const isAccountingOrAdmin = ['master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst'].includes(user.role);

  if (!isAccountingOrAdmin) return c.json({ records: [] });

  const result = await db.prepare(`
    SELECT sr.*, u.name as user_name FROM sales_records sr
    JOIN users u ON u.id = sr.user_id
    WHERE sr.status = 'refund_requested'
    ORDER BY sr.refund_requested_at DESC
  `).all();

  return c.json({ records: result.results });
});

// GET /api/sales/stats — 매출/환불 통계
sales.get('/stats', requireRole('master', 'ceo', 'cc_ref', 'admin', 'accountant'), async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const { month, month_end, branch, department, user_id: filterUserId } = c.req.query();

  let query = `
    SELECT sr.*, u.name as user_name, u.branch as user_branch, u.department as user_department
    FROM sales_records sr
    JOIN users u ON u.id = sr.user_id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (month) {
    const endMonth = month_end || month;
    const mStart = month + '-01';
    const [ey, em] = endMonth.split('-').map(Number);
    const mEnd = `${endMonth}-${new Date(ey, em, 0).getDate()}`;
    query += " AND sr.contract_date >= ? AND sr.contract_date <= ?";
    params.push(mStart, mEnd);
  }
  if (branch) { query += " AND sr.branch = ?"; params.push(branch); }
  if (department) { query += " AND sr.department = ?"; params.push(department); }
  if (filterUserId) { query += " AND sr.user_id = ?"; params.push(filterUserId); }

  // 관리자 지사 제한
  if (user.role === 'admin' && user.branch !== '의정부') {
    const extra = ADMIN_EXTRA_BRANCHES[user.sub] || [];
    if (extra.length > 0) {
      const allBranches = [user.branch, ...extra];
      const placeholders = allBranches.map(() => '?').join(',');
      query += ` AND sr.branch IN (${placeholders})`;
      params.push(...allBranches);
    } else {
      query += ' AND sr.branch = ?';
      params.push(user.branch);
    }
  }

  query += ' ORDER BY sr.contract_date DESC';
  const result = params.length > 0
    ? await db.prepare(query).bind(...params).all()
    : await db.prepare(query).all();

  return c.json({ records: result.results });
});

// ━━━ 입금 등록 (역방향: 회계 → 담당자) ━━━

// GET /api/sales/deposits — 입금 등록 목록
sales.get('/deposits', async (c) => {
  const db = c.env.DB;
  const result = await db.prepare(`
    SELECT dn.*, cu.name as created_by_name, cl.name as claimed_by_name, au.name as approved_by_name
    FROM deposit_notices dn
    LEFT JOIN users cu ON cu.id = dn.created_by
    LEFT JOIN users cl ON cl.id = dn.claimed_by
    LEFT JOIN users au ON au.id = dn.approved_by
    ORDER BY dn.created_at DESC
  `).all();
  return c.json({ deposits: result.results });
});

// POST /api/sales/deposits — 입금 등록 (회계)
sales.post('/deposits', requireRole(...EDIT_ACCOUNTING_ROLES), async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const { depositor, amount, deposit_date } = await c.req.json<{
    depositor: string; amount: number; deposit_date: string;
  }>();

  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO deposit_notices (id, depositor, amount, deposit_date, d_day_date, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(id, depositor, amount, deposit_date, deposit_date, user.sub).run();

  return c.json({ success: true, id });
});

// POST /api/sales/deposits/:id/claim — 담당자가 본인 건으로 클레임
sales.post('/deposits/:id/claim', async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const db = c.env.DB;
  const { type, type_detail, client_name, contract_date } = await c.req.json<{
    type: string; type_detail?: string; client_name: string; contract_date?: string;
  }>();

  const notice = await db.prepare('SELECT * FROM deposit_notices WHERE id = ?').bind(id).first<any>();
  if (!notice) return c.json({ error: '입금 내역을 찾을 수 없습니다.' }, 404);
  if (notice.status !== 'pending') return c.json({ error: '이미 처리된 건입니다.' }, 400);

  // 매출 내역 생성 (입금등록 클레임 → 기본 이체로 기록)
  const salesId = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO sales_records (id, user_id, type, type_detail, client_name, depositor_name, depositor_different, amount, contract_date, status, confirmed_at, confirmed_by, branch, department, payment_type)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, 'pending', NULL, NULL, ?, ?, '이체')
  `).bind(
    salesId, user.sub, type, type_detail || '', client_name,
    notice.depositor, notice.amount, contract_date || notice.deposit_date,
    user.branch, user.department
  ).run();

  // 입금 등록 업데이트
  await db.prepare(`
    UPDATE deposit_notices SET claimed_by = ?, claimed_at = datetime('now'), sales_record_id = ?, status = 'claimed', updated_at = datetime('now')
    WHERE id = ?
  `).bind(user.sub, salesId, id).run();

  // 알림톡: 입금 매칭 신청 → 해당 지사 알림톡 ON한 총무에게 DEPOSIT_CLAIM
  const claimerBranch = user.branch || '';
  const accountants = await db.prepare(
    "SELECT phone, alimtalk_branches FROM users WHERE role IN ('accountant', 'accountant_asst') AND approved = 1 AND phone != ''"
  ).all<{ phone: string; alimtalk_branches: string }>();
  const phones = (accountants.results || [])
    .filter(r => r.alimtalk_branches && r.alimtalk_branches.split(',').includes(claimerBranch))
    .map(r => r.phone)
    .filter(Boolean);
  if (phones.length > 0) {
    c.executionCtx.waitUntil(sendAlimtalkByTemplate(
      c.env as unknown as Record<string, unknown>, 'DEPOSIT_CLAIM',
      { claimer_name: user.name, depositor: notice.depositor, amount: Number(notice.amount).toLocaleString('ko-KR'), deposit_date: notice.deposit_date || '', branch: claimerBranch, link: `${APP_URL}/sales` },
      phones,
    ).catch(() => {}));
  }

  return c.json({ success: true, sales_record_id: salesId });
});

// POST /api/sales/deposits/:id/approve — 최종 승인 (회계)
sales.post('/deposits/:id/approve', requireRole(...EDIT_ACCOUNTING_ROLES), async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const db = c.env.DB;

  const notice = await db.prepare('SELECT * FROM deposit_notices WHERE id = ?').bind(id).first<any>();
  if (!notice) return c.json({ error: '입금 내역을 찾을 수 없습니다.' }, 404);
  if (notice.status !== 'claimed') return c.json({ error: '담당자가 클레임한 건만 승인할 수 있습니다.' }, 400);

  await db.prepare(`
    UPDATE deposit_notices SET status = 'approved', approved_by = ?, approved_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `).bind(user.sub, id).run();

  // 연결된 매출도 확정
  if (notice.sales_record_id) {
    await db.prepare(`
      UPDATE sales_records SET status = 'confirmed', confirmed_at = datetime('now'), confirmed_by = ?, updated_at = datetime('now')
      WHERE id = ?
    `).bind(user.sub, notice.sales_record_id).run();
  }

  await logActivity(db, user as LogUser, {
    action: 'deposit_claim_approve',
    target_type: 'deposit_notice', target_id: id,
    target_label: `${notice.depositor} ${Number(notice.amount || 0).toLocaleString('ko-KR')}원 (${notice.deposit_date || ''})`,
    diff_summary: `입금신청 최종승인 (담당자 매출 확정 처리)`,
    before: notice, after: { ...notice, status: 'approved' },
  });

  return c.json({ success: true });
});

// DELETE /api/sales/deposits/:id — 입금등록 내역 삭제 (총무/총무보조/master)
sales.delete('/deposits/:id', requireRole('master', 'accountant', 'accountant_asst'), async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const db = c.env.DB;
  const notice = await db.prepare('SELECT * FROM deposit_notices WHERE id = ?').bind(id).first<any>();
  if (!notice) return c.json({ error: '내역을 찾을 수 없습니다.' }, 404);
  if (notice.sales_record_id) {
    await db.prepare('UPDATE deposit_notices SET sales_record_id = NULL WHERE id = ?').bind(id).run();
  }
  await db.prepare('DELETE FROM deposit_notices WHERE id = ?').bind(id).run();

  await logActivity(db, user as LogUser, {
    action: 'deposit_delete',
    target_type: 'deposit_notice', target_id: id,
    target_label: `${notice.depositor} ${Number(notice.amount || 0).toLocaleString('ko-KR')}원 (${notice.deposit_date || ''})`,
    diff_summary: `입금등록 삭제`,
    before: notice,
  });

  return c.json({ success: true });
});

// ━━━ 회계장부용: 매출내역 추가 (회계가 직접) ━━━
sales.post('/accounting-entry', requireRole(...EDIT_ACCOUNTING_ROLES), async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const { amount, content, date, assignee_id, direction } = await c.req.json<{
    amount: number; content: string; date: string; assignee_id: string; direction?: string;
  }>();

  const dir = direction === 'expense' ? 'expense' : 'income';
  const actualAssignee = assignee_id === '__all__' ? user.sub : assignee_id;
  const assignee = await db.prepare('SELECT id, branch, department FROM users WHERE id = ?').bind(actualAssignee).first<any>();
  if (!assignee) return c.json({ error: '담당자를 찾을 수 없습니다.' }, 404);

  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO sales_records (id, user_id, type, type_detail, client_name, amount, contract_date, status, confirmed_at, confirmed_by, direction, branch, department, payment_type)
    VALUES (?, ?, '기타', ?, ?, ?, ?, 'confirmed', datetime('now'), ?, ?, ?, ?, '이체')
  `).bind(id, actualAssignee, content, content, amount, date, user.sub, dir, assignee.branch || '', assignee.department || '').run();

  return c.json({ success: true, id });
});

// DELETE /api/sales/:id — 매출 삭제 (총무/총무보조 포함)
sales.delete('/:id', requireRole('master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst'), async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const db = c.env.DB;
  // 담당자 이름까지 스냅샷에 포함
  const record = await db.prepare(`
    SELECT sr.*, u.name as user_name FROM sales_records sr
    LEFT JOIN users u ON u.id = sr.user_id WHERE sr.id = ?
  `).bind(id).first<any>();
  if (!record) return c.json({ error: '매출 내역을 찾을 수 없습니다.' }, 404);

  // FK 참조 해제: deposit_notices의 sales_record_id를 NULL로, 클레임 상태 pending 복원
  await db.prepare(
    "UPDATE deposit_notices SET sales_record_id = NULL, claimed_by = NULL, claimed_at = NULL, status = 'pending' WHERE sales_record_id = ?"
  ).bind(id).run();

  await db.prepare('DELETE FROM sales_records WHERE id = ?').bind(id).run();

  await logActivity(db, user as LogUser, {
    action: 'delete', target_id: id,
    target_label: `[${record.user_name || '?'}] ${recordLabel(record)}`,
    diff_summary: `매출 삭제 (유형: ${record.type || ''}, 상태: ${record.status || ''})`,
    before: record,
  });

  return c.json({ success: true });
});

// PUT /api/sales/:id/phone — 전화번호만 수정 (확정된 매출도 가능)
// 권한: master, accountant, accountant_asst, 본인(매출 등록자)
sales.put('/:id/phone', async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const { client_phone } = await c.req.json<{ client_phone: string }>();
  const db = c.env.DB;

  const record = await db.prepare('SELECT * FROM sales_records WHERE id = ?').bind(id).first<any>();
  if (!record) return c.json({ error: '매출 내역을 찾을 수 없습니다.' }, 404);

  const isOwner = record.user_id === user.sub;
  const allowed = isOwner || ['master', 'accountant', 'accountant_asst'].includes(user.role);
  if (!allowed) return c.json({ error: '권한이 없습니다.' }, 403);

  const newPhone = (client_phone || '').trim();
  await db.prepare("UPDATE sales_records SET client_phone = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(newPhone, id).run();

  if ((record.client_phone || '') !== newPhone) {
    await logActivity(db, user as LogUser, {
      action: 'update', target_id: id, target_label: recordLabel(record),
      diff_summary: `전화번호: ${record.client_phone || '(없음)'} → ${newPhone || '(없음)'}`,
      before: { client_phone: record.client_phone || '' },
      after: { client_phone: newPhone },
    });
  }
  return c.json({ success: true });
});

// PUT /api/sales/:id/exclude-count — 계약 미포함 토글 (중복 계약용)
sales.put('/:id/exclude-count', requireRole(...EDIT_ACCOUNTING_ROLES), async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const { exclude } = await c.req.json<{ exclude: boolean }>();
  const db = c.env.DB;
  const record = await db.prepare('SELECT * FROM sales_records WHERE id = ?').bind(id).first<any>();
  if (!record) return c.json({ error: '매출 내역을 찾을 수 없습니다.' }, 404);
  const newVal = exclude ? 1 : 0;
  await db.prepare("UPDATE sales_records SET exclude_from_count = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(newVal, id).run();
  if ((record.exclude_from_count || 0) !== newVal) {
    await logActivity(db, user as LogUser, {
      action: 'update', target_id: id, target_label: recordLabel(record),
      diff_summary: `계약미포함: ${record.exclude_from_count ? 'ON' : 'OFF'} → ${newVal ? 'ON' : 'OFF'}`,
      before: { exclude_from_count: record.exclude_from_count || 0 },
      after: { exclude_from_count: newVal },
    });
  }
  return c.json({ success: true });
});

// PUT /api/sales/:id/payment-method — 결제방법 표시 (카드/이체)
sales.put('/:id/payment-method', requireRole(...EDIT_ACCOUNTING_ROLES), async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const { payment_method } = await c.req.json<{ payment_method: string }>();
  const db = c.env.DB;
  const record = await db.prepare('SELECT * FROM sales_records WHERE id = ?').bind(id).first<any>();
  if (!record) return c.json({ error: '매출 내역을 찾을 수 없습니다.' }, 404);
  await db.prepare("UPDATE sales_records SET payment_method = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(payment_method || '', id).run();

  if ((record.payment_method || '') !== (payment_method || '')) {
    await logActivity(db, user as LogUser, {
      action: 'payment_method_change', target_id: id, target_label: recordLabel(record),
      diff_summary: `결제방법: ${record.payment_method || '(없음)'} → ${payment_method || '(없음)'}`,
      before: { payment_method: record.payment_method },
      after: { payment_method: payment_method || '' },
    });
  }

  return c.json({ success: true });
});

// [6-4] 엑셀 일괄 업로드 (회계 전용) — 새 양식 (A~S열 포지셔널)
sales.post('/bulk-import', requireRole(...EDIT_ACCOUNTING_ROLES), async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const body = await c.req.json<{ records: {
    row_no: number;                // 엑셀 원본 행 번호 (경고용)
    date_a?: string;               // A열 날짜 (환불일자)
    branch_raw?: string;           // B열 지사
    user_name?: string;            // C열 담당자
    client_name?: string;          // D열 고객명
    client_phone?: string;         // E열 전화번호
    type_raw?: string;             // G열 계약유형
    contract_date?: string;        // H열 계약일
    amount: number;                // I열 매출액 (부가세 포함, 음수 가능)
    pay_date?: string;             // K열 결제일
    card_approve_date?: string;    // L열 카드승인일 (카드건만)
    evidence_raw?: string;         // M열 증빙
    payment_raw?: string;          // N열 결제방식
    memo_s?: string;               // S열 비고
    // 환불 감지 플래그
    refund_mark?: 'refund' | 'card_cancel' | '';  // L/M열 텍스트에서 추출
    has_red_color?: boolean;       // 셀 빨간색 표시
  }[] }>();

  if (!body.records || body.records.length === 0) return c.json({ error: '데이터가 없습니다.' }, 400);

  // 공백 정규화 (다중 공백 → 제거)
  const normalize = (raw: string): string => (raw || '').replace(/\s+/g, '').trim();

  // B열 지사 매핑: 본사→의정부, 강남→서초, 대전→대전, 부산→부산
  const mapBranch = (raw: string): string => {
    const v = normalize(raw);
    if (!v) return '';
    if (v.includes('의정부') || v.includes('본사')) return '의정부';
    if (v.includes('강남') || v.includes('서초')) return '서초';
    if (v.includes('대전')) return '대전';
    if (v.includes('부산')) return '부산';
    return v;
  };

  // G열 계약유형 매핑 (괄호·공백 허용, 포함 매칭)
  const mapType = (raw: string): { type: string; type_detail: string } => {
    const original = (raw || '').trim();
    // 괄호·공백 제거 후 비교
    const clean = normalize(raw).replace(/[()[\]{}]/g, '');
    if (!clean) return { type: '기타', type_detail: '' };
    if (clean.includes('컨설팅계약') || clean === '계약') return { type: '계약', type_detail: '' };
    if (clean.includes('낙찰수수료') || clean === '낙찰') return { type: '낙찰', type_detail: '' };
    if (clean.includes('권리분석')) return { type: '권리분석보증서', type_detail: '' };
    if (clean.includes('매수신청대리')) return { type: '매수신청대리', type_detail: '' };
    if (clean.includes('중개수수료') || clean === '중개') return { type: '중개', type_detail: '' };
    return { type: '기타', type_detail: original };
  };

  // 결제방식 정규화
  const mapPayment = (raw: string): string => {
    const v = String(raw || '').trim();
    if (!v) return '';
    if (v.includes('카드')) return '카드';
    if (v.includes('이체') || v.includes('계좌') || v.includes('현금')) return '이체';
    return '';
  };

  // S열 비고에서 휴대폰 번호 추출 (현금영수증 번호)
  const extractPhone = (raw: string): string => {
    if (!raw) return '';
    const m = String(raw).match(/010-?\d{3,4}-?\d{4}/);
    return m ? m[0].replace(/(\d{3})-?(\d{3,4})-?(\d{4})/, '$1-$2-$3') : '';
  };

  // 날짜 정규화 (엑셀 숫자 날짜 또는 문자열)
  const normDate = (raw: any): string => {
    if (raw === null || raw === undefined || raw === '') return '';
    if (typeof raw === 'number') {
      const d = new Date((raw - 25569) * 86400000);
      return d.toISOString().slice(0, 10);
    }
    return String(raw).trim().slice(0, 10);
  };

  let count = 0;
  let refundCount = 0;
  const skipped: string[] = [];
  const skipCounts = { no_client: 0, zero_amount: 0, duplicate: 0, no_origin: 0, multi_match: 0 };

  // 사전 로드 1: 모든 사용자 (이름으로 조회)
  const allUsers = await db.prepare('SELECT id, name, branch, department FROM users WHERE name != ""').all();
  const usersByName = new Map<string, any>();
  (allUsers.results as any[]).forEach(u => {
    if (u.name) usersByName.set(u.name.trim(), u);
  });

  // 사전 로드 2: 기존 매출 (client+amount 인덱스 — 중복 체크 및 환불 매칭용)
  const existing = await db.prepare(`
    SELECT id, user_id, client_name, depositor_name, amount, contract_date, payment_type, status, branch
    FROM sales_records WHERE status IN ('confirmed', 'card_pending', 'pending')
  `).all();
  const existingList = existing.results as any[];
  // 중복 체크용 맵: client+amount+contractDate → id
  const dupKey = (name: string, amt: number, date: string) => `${name}|${amt}|${date}`;
  const dupMap = new Map<string, string>();
  existingList.forEach(e => dupMap.set(dupKey(e.client_name, e.amount, e.contract_date), e.id));
  // 환불 매칭용: client or depositor + amount + (payment_type)
  const refundMatches = (client: string, amt: number, payment: string): any[] => {
    return existingList.filter(e =>
      (e.client_name === client || e.depositor_name === client) &&
      e.amount === amt &&
      (!payment || e.payment_type === payment)
    );
  };

  // 이번 업로드 내에서 이미 쓴 키 (중복 방지)
  const localDupSet = new Set<string>();
  // 배치 처리용
  const batchStatements: any[] = [];

  for (const r of body.records) {
    const rowNo = r.row_no || 0;
    const clientName = (r.client_name || '').trim();
    const rawAmount = Number(String(r.amount ?? 0).replace(/[^0-9.\-]/g, '')) || 0;
    const amount = Math.abs(rawAmount);
    const isNegative = rawAmount < 0;

    if (!clientName) { skipCounts.no_client++; continue; }  // 합계/빈 행 조용히 스킵
    if (amount <= 0) { skipCounts.zero_amount++; continue; }

    // 환불 판별: (1) L/M열 텍스트 (2) 빨간색 (3) I열 음수
    const refundMark = r.refund_mark || '';
    const isRefundByText = refundMark === 'refund' || refundMark === 'card_cancel';
    const isRefundByColor = !!r.has_red_color;
    const isRefundByNegative = isNegative;
    const isRefund = isRefundByText || isRefundByColor || isRefundByNegative;

    // 결제방식 결정 — 카드취소는 카드, 환불은 이체, 외엔 N열
    let paymentType = mapPayment(r.payment_raw || '');
    if (refundMark === 'card_cancel') paymentType = '카드';
    else if (refundMark === 'refund' && !paymentType) paymentType = '이체';

    if (isRefund) {
      // 환불 모드: 메모리 내 매칭 (기존 DB + 이번 업로드 둘 다)
      const refundDate = normDate(r.date_a) || new Date().toISOString().slice(0, 10);
      const matches = refundMatches(clientName, amount, paymentType);

      if (matches.length === 0) {
        skipCounts.no_origin++;
        skipped.push(`행${rowNo}: ${clientName} ${amount.toLocaleString()}원 — 원본 매출 없음`);
        continue;
      }
      if (matches.length > 1) {
        skipCounts.multi_match++;
        skipped.push(`행${rowNo}: ${clientName} ${amount.toLocaleString()}원 — 다건 매칭(${matches.length}건)`);
        continue;
      }

      const orig = matches[0];
      // DB 업데이트 및 in-memory 상태 반영(같은 원본에 중복 환불 방지)
      batchStatements.push(
        db.prepare(`
          UPDATE sales_records
          SET status = 'refunded', refund_approved_at = ?, refund_approved_by = ?,
              memo = CASE WHEN memo = '' OR memo IS NULL THEN ? ELSE memo || CHAR(10) || ? END,
              updated_at = datetime('now')
          WHERE id = ?
        `).bind(
          refundDate + 'T00:00:00', user.sub,
          `엑셀 일괄환불 (${refundDate})`, `엑셀 일괄환불 (${refundDate})`,
          orig.id,
        )
      );
      orig.status = 'refunded';  // 이후 매칭에서 제외
      refundCount++;
      continue;
    }

    // 일반 매출 등록
    const userName = (r.user_name || '').trim();
    const u = userName ? usersByName.get(userName) : null;

    const { type, type_detail } = mapType(r.type_raw || '');
    const depL = normDate(r.card_approve_date);  // L열 입금일
    const contractDate = normDate(r.contract_date) || depL || normDate(r.pay_date) || normDate(r.date_a);

    // 중복 체크 (메모리)
    const dkey = dupKey(clientName, amount, contractDate);
    if (dupMap.has(dkey) || localDupSet.has(dkey)) {
      skipCounts.duplicate++;
      skipped.push(`행${rowNo}: ${clientName} ${amount.toLocaleString()}원 — 중복 (${contractDate})`);
      continue;
    }
    localDupSet.add(dkey);

    const userId = u?.id || user.sub;
    const branchFromExcel = mapBranch(r.branch_raw || '');
    const branch = branchFromExcel || u?.branch || user.branch || '';
    const department = u?.department || user.department || '';
    const finalTypeDetail = !u && userName
      ? `[담당: ${userName}] ${type_detail}`.trim()
      : type_detail;

    const depositDate = paymentType === '카드' ? '' : depL;
    const cardDepDate = paymentType === '카드' ? depL : '';

    const evidence = (r.evidence_raw || '').trim();
    const receiptType = evidence.includes('현금영수증') ? '현금영수증' : '';
    const receiptPhone = receiptType ? extractPhone(r.memo_s || '') : '';

    const memoParts: string[] = [];
    if (!u && userName) memoParts.push(`미가입 담당자: ${userName}`);
    if (r.memo_s && !receiptPhone) memoParts.push(String(r.memo_s).slice(0, 200));

    const id = crypto.randomUUID();
    batchStatements.push(
      db.prepare(`
        INSERT INTO sales_records
          (id, user_id, type, type_detail, client_name, depositor_name, client_phone,
           amount, contract_date, deposit_date, card_deposit_date, status,
           confirmed_at, confirmed_by, branch, department, memo,
           payment_type, receipt_type, receipt_phone)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', datetime('now'), ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        id, userId, type, finalTypeDetail, clientName, clientName, r.client_phone || '',
        amount, contractDate, depositDate, cardDepDate, user.sub,
        branch, department, memoParts.join(' | '),
        paymentType, receiptType, receiptPhone,
      )
    );
    // in-memory 매칭 캐시에 추가 (같은 업로드 내 환불과 매칭 가능하게)
    existingList.push({
      id, user_id: userId, client_name: clientName, depositor_name: clientName,
      amount, contract_date: contractDate, payment_type: paymentType, status: 'confirmed', branch
    });
    count++;
    if (!u && userName) skipped.push(`행${rowNo}: ${userName} 미가입 (총무 명의로 등록됨)`);
  }

  // D1 batch 실행 (subrequest 1번으로 다건 처리)
  const BATCH_SIZE = 50;
  for (let i = 0; i < batchStatements.length; i += BATCH_SIZE) {
    await db.batch(batchStatements.slice(i, i + BATCH_SIZE));
  }

  return c.json({ success: true, count, refund_count: refundCount, skipped, skip_counts: skipCounts });
});

// ━━━ 활동 내역 조회 (master, accountant만) ━━━
sales.get('/activity-logs', requireRole('master', 'accountant'), async (c) => {
  const db = c.env.DB;
  const { month, actor_id, action, limit } = c.req.query();
  const limitNum = Math.min(Number(limit) || 200, 500);

  const conditions: string[] = [];
  const params: any[] = [];

  if (month) {
    const [y, m] = month.split('-').map(Number);
    const mStart = `${month}-01`;
    const mEnd = `${month}-${new Date(y, m, 0).getDate()}`;
    conditions.push('date(l.created_at) >= ? AND date(l.created_at) <= ?');
    params.push(mStart, mEnd);
  }
  if (actor_id) { conditions.push('l.actor_id = ?'); params.push(actor_id); }
  if (action) { conditions.push('l.action = ?'); params.push(action); }

  let query = `
    SELECT l.*, u.name as actor_display_name, u.branch as actor_branch
    FROM accounting_activity_logs l
    LEFT JOIN users u ON u.id = l.actor_id
  `;
  if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
  query += ` ORDER BY l.created_at DESC LIMIT ${limitNum}`;

  const result = params.length > 0
    ? await db.prepare(query).bind(...params).all()
    : await db.prepare(query).all();
  return c.json({ logs: result.results });
});

// ━━━ 총무 메모 (admin_memos) ━━━

// GET /api/sales/memos?related_type=sales&related_id=xxx (총무/관리자만)
sales.get('/memos', requireRole('master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst'), async (c) => {
  const db = c.env.DB;
  const type = c.req.query('related_type');
  const id = c.req.query('related_id');

  let query = 'SELECT m.*, u.name as author_name FROM admin_memos m LEFT JOIN users u ON m.created_by = u.id';
  if (type && id) {
    query += ' WHERE m.related_type = ? AND m.related_id = ?';
    const result = await db.prepare(query + ' ORDER BY m.created_at DESC').bind(type, id).all();
    return c.json({ memos: result.results });
  } else if (type) {
    query += ' WHERE m.related_type = ?';
    const result = await db.prepare(query + ' ORDER BY m.created_at DESC LIMIT 200').bind(type).all();
    return c.json({ memos: result.results });
  }
  const result = await db.prepare(query + ' ORDER BY m.created_at DESC LIMIT 200').all();
  return c.json({ memos: result.results });
});

// POST /api/sales/memos (총무만 작성)
sales.post('/memos', requireRole('master', 'accountant', 'accountant_asst'), async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const { related_type, related_id, content } = await c.req.json<{ related_type: string; related_id: string; content: string }>();
  if (!content?.trim()) return c.json({ error: '내용을 입력하세요.' }, 400);

  const id = crypto.randomUUID();
  await db.prepare(
    'INSERT INTO admin_memos (id, related_type, related_id, content, created_by) VALUES (?, ?, ?, ?, ?)'
  ).bind(id, related_type, related_id, content.trim(), user.sub).run();

  return c.json({ success: true, id });
});

// PUT /api/sales/memos/:id (총무만 수정)
sales.put('/memos/:id', requireRole('master', 'accountant', 'accountant_asst'), async (c) => {
  const id = c.req.param('id');
  const { content } = await c.req.json<{ content: string }>();
  await c.env.DB.prepare("UPDATE admin_memos SET content = ?, updated_at = datetime('now') WHERE id = ?").bind(content.trim(), id).run();
  return c.json({ success: true });
});

// DELETE /api/sales/memos/:id (총무만 삭제)
sales.delete('/memos/:id', requireRole('master', 'accountant', 'accountant_asst'), async (c) => {
  await c.env.DB.prepare('DELETE FROM admin_memos WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ success: true });
});

export default sales;
