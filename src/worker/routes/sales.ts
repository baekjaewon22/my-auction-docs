import { Hono } from 'hono';
import type { AuthEnv } from '../types';
import { authMiddleware, requireRole } from '../middleware/auth';

const sales = new Hono<AuthEnv>();
sales.use('*', authMiddleware);

const ACCOUNTING_ROLES = ['master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst'] as const;
const EDIT_ACCOUNTING_ROLES = ['master', 'ceo', 'cc_ref', 'admin', 'accountant'] as const;

// ━━━ 매출 내역 CRUD ━━━

// GET /api/sales — 매출 목록 (권한별 필터)
sales.get('/', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const { month, user_id: filterUserId } = c.req.query();

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

  if (!isAdmin && !isAccountant) {
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
    // 일반 관리자: 본인 지사
    conditions.push('sr.branch = ?');
    params.push(user.branch);
  }

  // 담당자 필터
  if (filterUserId) {
    conditions.push('sr.user_id = ?');
    params.push(filterUserId);
  }

  // 월별 필터
  if (month) {
    conditions.push("sr.contract_date LIKE ?");
    params.push(month + '%');
  }

  if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY sr.created_at DESC';

  const result = params.length > 0
    ? await db.prepare(query).bind(...params).all()
    : await db.prepare(query).all();

  return c.json({ records: result.results });
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
  }>();

  if (!['계약', '낙찰', '중개', '기타'].includes(body.type)) {
    return c.json({ error: '유효하지 않은 매출 유형입니다.' }, 400);
  }

  const direction = body.direction === 'expense' ? 'expense' : 'income';
  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO sales_records (id, user_id, type, type_detail, client_name, depositor_name, depositor_different, amount, contract_date, journal_entry_id, direction, branch, department)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, user.sub, body.type, body.type_detail || '', body.client_name,
    body.depositor_name || '', body.depositor_different ? 1 : 0,
    body.amount || 0, body.contract_date || new Date().toISOString().slice(0, 10),
    body.journal_entry_id || null, direction, user.branch, user.department
  ).run();

  // 계약조건 기록 (별도 UPDATE — 컬럼 호환성)
  if (body.appraisal_rate || body.winning_rate || body.client_phone) {
    await db.prepare("UPDATE sales_records SET appraisal_rate = ?, winning_rate = ?, client_phone = ? WHERE id = ?")
      .bind(body.appraisal_rate || 0, body.winning_rate || 0, body.client_phone || '', id).run();
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
  }>();

  const record = await db.prepare('SELECT * FROM sales_records WHERE id = ?').bind(id).first<any>();
  if (!record) return c.json({ error: '매출 내역을 찾을 수 없습니다.' }, 404);

  const isOwner = record.user_id === user.sub;
  const isAdminPlus = ['master', 'ceo', 'cc_ref', 'admin', 'accountant'].includes(user.role);
  if (!isOwner && !isAdminPlus) return c.json({ error: '권한이 없습니다.' }, 403);
  if (record.status !== 'pending' && !isAdminPlus) return c.json({ error: '확정된 매출은 수정할 수 없습니다.' }, 400);

  await db.prepare(`
    UPDATE sales_records SET type = ?, type_detail = ?, client_name = ?, depositor_name = ?,
      depositor_different = ?, amount = ?, contract_date = ?, updated_at = datetime('now')
    WHERE id = ?
  `).bind(
    body.type || record.type, body.type_detail ?? record.type_detail,
    body.client_name ?? record.client_name, body.depositor_name ?? record.depositor_name,
    body.depositor_different !== undefined ? (body.depositor_different ? 1 : 0) : record.depositor_different,
    body.amount ?? record.amount, body.contract_date ?? record.contract_date, id
  ).run();

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
  await db.prepare(`
    UPDATE sales_records SET status = 'confirmed', confirmed_at = datetime('now'), confirmed_by = ?, deposit_date = ?, updated_at = datetime('now')
    WHERE id = ?
  `).bind(user.sub, depDate, id).run();

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
  if (record.status !== 'confirmed') return c.json({ error: '확정된 매출만 환불 신청할 수 있습니다.' }, 400);

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
    query += ' AND sr.branch = ?';
    params.push(user.branch);
  }

  query += ' ORDER BY sr.created_at DESC LIMIT 20';
  const result = params.length > 0
    ? await db.prepare(query).bind(...params).all()
    : await db.prepare(query).all();

  return c.json({ records: result.results });
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
  const { month, branch, department, user_id: filterUserId } = c.req.query();

  let query = `
    SELECT sr.*, u.name as user_name, u.branch as user_branch, u.department as user_department
    FROM sales_records sr
    JOIN users u ON u.id = sr.user_id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (month) { query += " AND sr.contract_date LIKE ?"; params.push(month + '%'); }
  if (branch) { query += " AND sr.branch = ?"; params.push(branch); }
  if (department) { query += " AND sr.department = ?"; params.push(department); }
  if (filterUserId) { query += " AND sr.user_id = ?"; params.push(filterUserId); }

  // 관리자 지사 제한
  if (user.role === 'admin' && user.branch !== '의정부') {
    query += ' AND sr.branch = ?'; params.push(user.branch);
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

  // 매출 내역 생성
  const salesId = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO sales_records (id, user_id, type, type_detail, client_name, depositor_name, depositor_different, amount, contract_date, status, confirmed_at, confirmed_by, branch, department)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, 'pending', NULL, NULL, ?, ?)
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
    INSERT INTO sales_records (id, user_id, type, type_detail, client_name, amount, contract_date, status, confirmed_at, confirmed_by, direction, branch, department)
    VALUES (?, ?, '기타', ?, ?, ?, ?, 'confirmed', datetime('now'), ?, ?, ?, ?)
  `).bind(id, actualAssignee, content, content, amount, date, user.sub, dir, assignee.branch || '', assignee.department || '').run();

  return c.json({ success: true, id });
});

// DELETE /api/sales/:id — 매출 삭제 (회계담당만)
sales.delete('/:id', requireRole(...EDIT_ACCOUNTING_ROLES), async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const record = await db.prepare('SELECT id FROM sales_records WHERE id = ?').bind(id).first();
  if (!record) return c.json({ error: '매출 내역을 찾을 수 없습니다.' }, 404);
  await db.prepare('DELETE FROM sales_records WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

// PUT /api/sales/:id/payment-method — 결제방법 표시 (카드/이체)
sales.put('/:id/payment-method', requireRole(...EDIT_ACCOUNTING_ROLES), async (c) => {
  const id = c.req.param('id');
  const { payment_method } = await c.req.json<{ payment_method: string }>();
  const db = c.env.DB;
  await db.prepare("UPDATE sales_records SET payment_method = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(payment_method || '', id).run();
  return c.json({ success: true });
});

// [6-4] 엑셀 일괄 업로드 (회계 전용)
sales.post('/bulk-import', requireRole(...EDIT_ACCOUNTING_ROLES), async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const { records } = await c.req.json<{ records: {
    user_name: string; type: string; type_detail?: string;
    client_name: string; depositor_name?: string;
    amount: number; contract_date: string; deposit_date?: string;
  }[] }>();

  if (!records || records.length === 0) return c.json({ error: '데이터가 없습니다.' }, 400);

  const VALID_TYPES = ['계약', '낙찰', '중개', '기타'];
  let count = 0;
  const skipped: string[] = [];

  for (const r of records) {
    // 이름으로 user_id 찾기
    const u = await db.prepare('SELECT id, branch, department FROM users WHERE name = ? LIMIT 1')
      .bind(r.user_name?.trim()).first<any>();
    if (!u) { skipped.push(`${r.user_name}: 사용자 없음`); continue; }

    // 타입 정규화
    const type = VALID_TYPES.includes(r.type) ? r.type : '계약';

    // 날짜 정규화 (엑셀 숫자 날짜 변환)
    let contractDate = r.contract_date || '';
    if (typeof contractDate === 'number') {
      const d = new Date((contractDate - 25569) * 86400000);
      contractDate = d.toISOString().slice(0, 10);
    }
    contractDate = String(contractDate).trim();

    let depositDate = r.deposit_date || contractDate; // 기존 데이터이므로 입금일 = 계약일
    if (typeof depositDate === 'number') {
      const d = new Date((depositDate - 25569) * 86400000);
      depositDate = d.toISOString().slice(0, 10);
    }
    depositDate = String(depositDate).trim();

    const amount = Number(String(r.amount || 0).replace(/[^0-9]/g, '')) || 0;
    if (amount <= 0) { skipped.push(`${r.client_name}: 금액 0`); continue; }

    const id = crypto.randomUUID();
    await db.prepare(`
      INSERT INTO sales_records (id, user_id, type, type_detail, client_name, depositor_name, amount, contract_date, deposit_date, status, confirmed_at, confirmed_by, branch, department)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', datetime('now'), ?, ?, ?)
    `).bind(
      id, u.id, type, r.type_detail || '', (r.client_name || '').trim(),
      r.depositor_name || '', amount, contractDate,
      depositDate, user.sub, u.branch || '', u.department || ''
    ).run();
    count++;
  }

  return c.json({ success: true, count, skipped });
});

export default sales;
