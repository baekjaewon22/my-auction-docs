// 외부 사건 수신 + 관리자 조회 — 법률사무소 명승(landing-law) 연동
// - POST /api/cases: 외부 ingest (X-API-Key 인증, UPSERT)
// - GET /api/cases: 관리자 조회 (JWT 인증)
// - GET /api/cases/:id: 단건 상세
// - GET /api/cases/bonus/summary: 2개월 단위 명도성과금 집계 (급여정산용)

import { Hono } from 'hono';
import type { AuthEnv } from '../types';
import { authMiddleware, requireRole } from '../middleware/auth';

const cases = new Hono<AuthEnv>();

async function ensureCaseHiddenTable(db: D1Database): Promise<void> {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS case_hidden (
      external_id TEXT PRIMARY KEY,
      case_id TEXT,
      hidden_by TEXT NOT NULL,
      hidden_reason TEXT DEFAULT '',
      hidden_at TEXT DEFAULT (datetime('now'))
    )
  `).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_case_hidden_case_id ON case_hidden(case_id)').run();
}

// ───── 성과금 등급 (총 조정금액 기준 단계 산정, 구간별 X) ─────
//   ≤ 200만 → 10만
//   200만 ~ 500만 → 20만
//   500만 ~ 700만 → 30만
//   700만 ~ 1000만 → 40만
//   1000만 ~ 2000만 → 60만
//   > 2000만 → 80만 (일괄)
export function calculateMyungdoBonus(totalAmount: number): number {
  if (totalAmount <= 0) return 0;
  if (totalAmount <= 2_000_000) return 100_000;
  if (totalAmount <= 5_000_000) return 200_000;
  if (totalAmount <= 7_000_000) return 300_000;
  if (totalAmount <= 10_000_000) return 400_000;
  if (totalAmount <= 20_000_000) return 600_000;
  return 800_000;
}

// 성과금 산정 기준 매출 계산 (수임료 → 조정 후 금액)
//   정액제(fixed): fee - 150,000원 (필수 경비)
//   실비제(actual): fee / 1.1 (부가세 제외, 공급가액)
export function adjustedFeeFor(amount: number, type: 'fixed' | 'actual'): number {
  if (type === 'fixed') return Math.max(0, amount - 150_000);
  return Math.round(amount / 1.1);
}

// 2개월 구간 식별: 1~2월 → '2026-01_02', 3~4월 → '2026-03_04', ...
// KST(한국 시간) 기준으로 월 추출 — 한국 자정 넘으면 다음 달로 분류
function getBimonthlyPeriod(isoDate: string): string {
  const utcMs = new Date(isoDate).getTime();
  const kst = new Date(utcMs + 9 * 60 * 60 * 1000); // KST wall-clock = UTC+9
  const y = kst.getUTCFullYear();
  const m = kst.getUTCMonth() + 1; // 1-12 (KST 기준)
  // 홀수 월이면 (m, m+1), 짝수 월이면 (m-1, m)
  const groupStart = m % 2 === 1 ? m : m - 1;
  return `${y}-${String(groupStart).padStart(2, '0')}_${String(groupStart + 1).padStart(2, '0')}`;
}

async function resolveCaseUser(
  db: D1Database,
  identity: { username?: string | null; name?: string | null; position?: string | null },
): Promise<{ user_id: string | null; branch: string | null; department: string | null }> {
  const username = identity.username?.trim();
  const name = identity.name?.trim();
  const position = identity.position?.trim();

  const orderClause = `
    ORDER BY
      CASE WHEN id NOT LIKE 'unreg-%' THEN 0 ELSE 1 END,
      CASE WHEN role != 'resigned' THEN 0 ELSE 1 END,
      created_at DESC
  `;

  if (username) {
    const matched = await db.prepare(`
      SELECT id, branch, department FROM users WHERE (email = ? OR id = ?) ${orderClause} LIMIT 1
    `).bind(username, username).first<any>();
    if (matched) {
      return { user_id: matched.id, branch: matched.branch || null, department: matched.department || null };
    }
  }

  if (name && position) {
    const byNamePos = await db.prepare(`
      SELECT id, branch, department FROM users WHERE name = ? AND position_title = ? ${orderClause} LIMIT 1
    `).bind(name, position).first<any>();
    if (byNamePos) {
      return { user_id: byNamePos.id, branch: byNamePos.branch || null, department: byNamePos.department || null };
    }
  }

  if (name) {
    const byName = await db.prepare(`
      SELECT id, branch, department FROM users WHERE name = ? ${orderClause} LIMIT 1
    `).bind(name).first<any>();
    if (byName) {
      return { user_id: byName.id, branch: byName.branch || null, department: byName.department || null };
    }
  }

  return { user_id: null, branch: null, department: null };
}

// 라벨용: '2026-03_04' → '2026년 3~4월'
function labelOfPeriod(period: string): string {
  const m = period.match(/^(\d{4})-(\d{2})_(\d{2})$/);
  if (!m) return period;
  return `${m[1]}년 ${parseInt(m[2], 10)}~${parseInt(m[3], 10)}월`;
}

// ───── 미들웨어 분기 ─────
// - POST /             : X-API-Key (외부 ingest)
// - GET /consultants   : X-API-Key (외부 동기화 — 컨설턴트 목록)
// - 그 외 GET          : JWT (내부 조회)
cases.use('*', async (c, next) => {
  const path = c.req.path;
  const isExternal = c.req.method === 'POST' || path.endsWith('/consultants');

  if (isExternal) {
    const apiKey = c.req.header('X-API-Key');
    const expected = (c.env as any).MY_DOCS_API_KEY as string | undefined;
    if (!expected) {
      return c.json({ ok: false, error: 'MY_DOCS_API_KEY not configured' }, 500);
    }
    if (apiKey !== expected) {
      return c.json({ ok: false, error: 'Unauthorized' }, 401);
    }
    return next();
  }
  return authMiddleware(c, next);
});

// ───── 외부 동기화: GET /api/cases/consultants ─────
// 명승이 컨설턴트 목록 가져갈 때 호출. POST 와 동일 키로 인증.
//
// Query params:
//   - updatedAfter=ISO8601  : 증분 동기화 (해당 시각 이후 변경된 컨설턴트만)
//   - include_inactive=true : 비활성(퇴사) 컨설턴트도 포함 (isActive=false)
cases.get('/consultants', async (c) => {
  const db = c.env.DB;
  const JEONG_MINHO_ID = '2b6b3606-e425-4361-a115-9283cfef842f';
  const updatedAfter = c.req.query('updatedAfter') || '';
  const includeInactive = c.req.query('include_inactive') === 'true';

  // 비활성 포함 옵션: resigned 도 포함 (그 외 제외 정책은 동일)
  const roleFilter = includeInactive
    ? `u.role NOT IN ('master','ceo','cc_ref','accountant','accountant_asst','support')`
    : `u.role NOT IN ('master','ceo','cc_ref','accountant','accountant_asst','support','resigned')`;

  let query = `
    SELECT u.id, u.name, u.position_title as position, u.branch, u.department,
      u.email as username, u.role,
      COALESCE(ua.pay_type, 'salary') as pay_type,
      CASE WHEN u.role = 'resigned' THEN 0 ELSE 1 END as is_active,
      u.updated_at as updated_at
    FROM users u
    LEFT JOIN user_accounting ua ON ua.user_id = u.id
    WHERE ${roleFilter}
      AND u.branch != '본사 관리'
      AND (u.department IS NULL OR u.department NOT IN ('명도팀','지원팀'))
      AND u.id != ?
      AND u.login_type != 'freelancer-old'
  `;
  const params: any[] = [JEONG_MINHO_ID];

  if (updatedAfter) {
    query += ` AND u.updated_at >= ?`;
    params.push(updatedAfter);
  }

  query += ` ORDER BY u.branch, u.department, u.position_title, u.name`;

  const result = await db.prepare(query).bind(...params).all<any>();
  const consultants = (result.results || []).map((r: any) => ({
    id: r.id,
    name: r.name,
    position: r.position || null,
    branch: r.branch || null,
    department: r.department || null,
    username: r.username || null,
    role: r.role,
    pay_type: r.pay_type,
    isActive: r.is_active === 1,
    updatedAt: r.updated_at,
  }));

  return c.json({
    ok: true,
    count: consultants.length,
    fetched_at: new Date().toISOString(),
    consultants,
  });
});

// ───── 외부 ingest: POST /api/cases ─────
cases.post('/', async (c) => {
  const db = c.env.DB;
  await ensureCaseHiddenTable(db);
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  // 필수 필드 검증
  if (!body.externalId || typeof body.externalId !== 'string') {
    return c.json({ ok: false, error: 'externalId is required' }, 400);
  }
  if (!body.registeredAt || typeof body.registeredAt !== 'string') {
    return c.json({ ok: false, error: 'registeredAt is required' }, 400);
  }
  if (!body.manager?.username || !body.manager?.name) {
    return c.json({ ok: false, error: 'manager.username and manager.name are required' }, 400);
  }
  if (!body.client?.name) {
    return c.json({ ok: false, error: 'client.name is required' }, 400);
  }
  if (!body.fee?.type || !['fixed', 'actual'].includes(body.fee.type)) {
    return c.json({ ok: false, error: 'fee.type must be fixed or actual' }, 400);
  }
  if (typeof body.fee.amount !== 'number' || body.fee.amount < 0 || !Number.isInteger(body.fee.amount)) {
    return c.json({ ok: false, error: 'fee.amount must be a non-negative integer' }, 400);
  }

  const externalId = body.externalId;
  const registeredAt = body.registeredAt;
  const consultantName = body.consultant?.name || null;
  const consultantPosition = body.consultant?.position || null;
  const managerUsername = body.manager.username;
  const managerName = body.manager.name;
  const clientName = body.client.name;
  const feeType = body.fee.type;
  const feeAmount = body.fee.amount;
  const bimonthlyPeriod = getBimonthlyPeriod(registeredAt);

  // username → user_id 매핑 (활성 사용자 우선, 동명이인·퇴사자 후순위)
  // 매칭 ORDER:
  //   1. 정식 등록(unreg- 아님) + 활성(role != resigned)
  //   2. 정식 등록 + 퇴사자
  //   3. unreg- + 활성
  //   4. unreg- + 퇴사자
  const ORDER_CLAUSE = `
    ORDER BY
      CASE WHEN id NOT LIKE 'unreg-%' THEN 0 ELSE 1 END,
      CASE WHEN role != 'resigned' THEN 0 ELSE 1 END,
      created_at DESC
  `;

  let managerUserId: string | null = null;
  let managerBranch: string | null = null;
  let managerDepartment: string | null = null;
  // 1순위: email 또는 id 정확 매칭 + 활성 사용자
  const matched = await db.prepare(`
    SELECT id, branch, department FROM users WHERE (email = ? OR id = ?) ${ORDER_CLAUSE} LIMIT 1
  `).bind(managerUsername, managerUsername).first<any>();
  if (matched) {
    managerUserId = matched.id;
    managerBranch = matched.branch || null;
    managerDepartment = matched.department || null;
  } else {
    // 2순위: name fallback 매칭 — 활성 사용자 우선
    const byName = await db.prepare(
      `SELECT id, branch, department FROM users WHERE name = ? ${ORDER_CLAUSE} LIMIT 1`,
    ).bind(managerName).first<any>();
    if (byName) {
      managerUserId = byName.id;
      managerBranch = byName.branch || null;
      managerDepartment = byName.department || null;
    }
  }

  // 컨설턴트(consultant) 매칭 — 명도성과금 귀속자
  // 우선 name + position_title 조합으로 매칭, 그 다음 name 단독, 활성 우선
  let consultantUserId: string | null = null;
  let consultantBranch: string | null = null;
  let consultantDepartment: string | null = null;
  if (consultantName) {
    if (consultantPosition) {
      const byNamePos = await db.prepare(
        `SELECT id, branch, department FROM users WHERE name = ? AND position_title = ? ${ORDER_CLAUSE} LIMIT 1`,
      ).bind(consultantName, consultantPosition).first<any>();
      if (byNamePos) {
        consultantUserId = byNamePos.id;
        consultantBranch = byNamePos.branch || null;
        consultantDepartment = byNamePos.department || null;
      }
    }
    if (!consultantUserId) {
      const byName = await db.prepare(
        `SELECT id, branch, department FROM users WHERE name = ? ${ORDER_CLAUSE} LIMIT 1`,
      ).bind(consultantName).first<any>();
      if (byName) {
        consultantUserId = byName.id;
        consultantBranch = byName.branch || null;
        consultantDepartment = byName.department || null;
      }
    }
  }

  const rawPayload = JSON.stringify(body).slice(0, 4000);
  const existing = await db.prepare(`SELECT id, created_at FROM cases WHERE external_id = ?`).bind(externalId).first<any>();

  let id: string;
  if (existing) {
    id = existing.id;
    await db.prepare(`
      UPDATE cases SET
        registered_at = ?, consultant_name = ?, consultant_position = ?,
        consultant_user_id = ?, consultant_branch = ?, consultant_department = ?,
        manager_username = ?, manager_name = ?, manager_user_id = ?,
        manager_branch = ?, manager_department = ?,
        client_name = ?, fee_type = ?, fee_amount = ?,
        bimonthly_period = ?, raw_payload = ?, updated_at = datetime('now')
      WHERE external_id = ?
    `).bind(
      registeredAt, consultantName, consultantPosition,
      consultantUserId, consultantBranch, consultantDepartment,
      managerUsername, managerName, managerUserId,
      managerBranch, managerDepartment,
      clientName, feeType, feeAmount,
      bimonthlyPeriod, rawPayload, externalId,
    ).run();
  } else {
    id = `case-${crypto.randomUUID().slice(0, 8)}`;
    await db.prepare(`
      INSERT INTO cases (id, external_id, registered_at, consultant_name, consultant_position,
        consultant_user_id, consultant_branch, consultant_department,
        manager_username, manager_name, manager_user_id, manager_branch, manager_department,
        client_name, fee_type, fee_amount, bimonthly_period, raw_payload)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, externalId, registeredAt, consultantName, consultantPosition,
      consultantUserId, consultantBranch, consultantDepartment,
      managerUsername, managerName, managerUserId, managerBranch, managerDepartment,
      clientName, feeType, feeAmount, bimonthlyPeriod, rawPayload,
    ).run();
  }

  return c.json({
    ok: true,
    documentId: id,
    url: `https://my-docs.kr/cases/${id}`,
  });
});

// ───── 내부 조회: GET /api/cases ─────
// member/support: 본인이 컨설턴트 또는 담당자(manager_user_id)로 매칭된 사건만 조회
const CASES_VIEW_ROLES = ['master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst', 'manager', 'director', 'member', 'support'] as const;

cases.get('/', requireRole(...CASES_VIEW_ROLES), async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  await ensureCaseHiddenTable(db);
  const search = c.req.query('search') || '';
  const period = c.req.query('period') || '';
  const consultantId = c.req.query('consultant_id') || c.req.query('manager_id') || '';
  const limit = Math.min(500, parseInt(c.req.query('limit') || '200', 10));

  let query = `SELECT * FROM cases WHERE NOT EXISTS (
    SELECT 1 FROM case_hidden ch WHERE ch.external_id = cases.external_id
  )`;
  const params: any[] = [];

  // 권한별 범위 제한 — 컨설턴트(consultant) 기준 (성과금 귀속자)
  if (user.role === 'manager') {
    query += ` AND (consultant_user_id = ? OR (consultant_branch = ? AND consultant_department = ?))`;
    params.push(user.sub, user.branch, user.department);
  } else if (user.role === 'admin' && user.branch !== '의정부') {
    query += ` AND consultant_branch = ?`;
    params.push(user.branch);
  } else if (user.role === 'director') {
    query += ` AND (consultant_branch IN ('대전','부산') OR consultant_user_id = ?)`;
    params.push(user.sub);
  } else if (user.role === 'member' || user.role === 'support') {
    // 일반 컨설턴트: 본인이 컨설턴트로 매칭됐거나 담당자(manager_user_id)인 사건만
    query += ` AND (consultant_user_id = ? OR manager_user_id = ?)`;
    params.push(user.sub, user.sub);
  }
  // master/ceo/cc_ref/accountant/accountant_asst/admin(의정부): 전체

  if (search) {
    query += ` AND (consultant_name LIKE ? OR client_name LIKE ? OR manager_name LIKE ? OR external_id LIKE ?)`;
    const s = `%${search}%`;
    params.push(s, s, s, s);
  }
  if (period) {
    query += ` AND bimonthly_period = ?`;
    params.push(period);
  }
  if (consultantId) {
    query += ` AND consultant_user_id = ?`;
    params.push(consultantId);
  }

  query += ` ORDER BY registered_at DESC LIMIT ?`;
  params.push(limit);

  const result = await db.prepare(query).bind(...params).all();
  return c.json({ cases: result.results || [] });
});

// ───── 단건 상세: GET /api/cases/:id ─────
cases.get('/:id', requireRole(...CASES_VIEW_ROLES), async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  await ensureCaseHiddenTable(db);
  const id = c.req.param('id');
  const r = await db.prepare(`
    SELECT * FROM cases
    WHERE id = ?
      AND NOT EXISTS (SELECT 1 FROM case_hidden ch WHERE ch.external_id = cases.external_id)
  `).bind(id).first<any>();
  if (!r) return c.json({ error: '사건을 찾을 수 없습니다.' }, 404);

  // 권한 체크 — 컨설턴트 기준
  if (user.role === 'manager') {
    if (r.consultant_user_id !== user.sub && !(r.consultant_branch === user.branch && r.consultant_department === user.department)) {
      return c.json({ error: '권한 없음' }, 403);
    }
  } else if (user.role === 'admin' && user.branch !== '의정부') {
    if (r.consultant_branch !== user.branch) return c.json({ error: '권한 없음' }, 403);
  } else if (user.role === 'director') {
    if (!['대전', '부산'].includes(r.consultant_branch) && r.consultant_user_id !== user.sub) {
      return c.json({ error: '권한 없음' }, 403);
    }
  } else if (user.role === 'member' || user.role === 'support') {
    if (r.consultant_user_id !== user.sub && r.manager_user_id !== user.sub) {
      return c.json({ error: '권한 없음' }, 403);
    }
  }

  return c.json({ case: r });
});

const CASES_EDIT_ROLES = ['master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst'] as const;

cases.put('/:id', requireRole(...CASES_EDIT_ROLES), async (c) => {
  const db = c.env.DB;
  await ensureCaseHiddenTable(db);
  const id = c.req.param('id');

  const existing = await db.prepare(`
    SELECT * FROM cases
    WHERE id = ?
      AND NOT EXISTS (SELECT 1 FROM case_hidden ch WHERE ch.external_id = cases.external_id)
  `).bind(id).first<any>();
  if (!existing) return c.json({ error: '사건을 찾을 수 없습니다.' }, 404);

  let body: {
    registered_at?: string;
    consultant_name?: string | null;
    consultant_position?: string | null;
    manager_username?: string;
    manager_name?: string;
    client_name?: string;
    fee_type?: 'fixed' | 'actual';
    fee_amount?: number;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const registeredAt = (body.registered_at ?? existing.registered_at)?.trim();
  const consultantName = body.consultant_name !== undefined ? (body.consultant_name || '').trim() || null : existing.consultant_name;
  const consultantPosition = body.consultant_position !== undefined ? (body.consultant_position || '').trim() || null : existing.consultant_position;
  const managerUsername = (body.manager_username ?? existing.manager_username)?.trim();
  const managerName = (body.manager_name ?? existing.manager_name)?.trim();
  const clientName = (body.client_name ?? existing.client_name)?.trim();
  const feeType = body.fee_type ?? existing.fee_type;
  const feeAmount = body.fee_amount ?? existing.fee_amount;

  if (!registeredAt || Number.isNaN(new Date(registeredAt).getTime())) {
    return c.json({ error: 'registered_at must be a valid date string' }, 400);
  }
  if (!managerUsername || !managerName) {
    return c.json({ error: 'manager_username and manager_name are required' }, 400);
  }
  if (!clientName) return c.json({ error: 'client_name is required' }, 400);
  if (!['fixed', 'actual'].includes(feeType)) {
    return c.json({ error: 'fee_type must be fixed or actual' }, 400);
  }
  if (!Number.isInteger(feeAmount) || feeAmount < 0) {
    return c.json({ error: 'fee_amount must be a non-negative integer' }, 400);
  }

  const manager = await resolveCaseUser(db, { username: managerUsername, name: managerName });
  const consultant = await resolveCaseUser(db, { name: consultantName, position: consultantPosition });
  const bimonthlyPeriod = getBimonthlyPeriod(registeredAt);

  await db.prepare(`
    UPDATE cases SET
      registered_at = ?, consultant_name = ?, consultant_position = ?,
      consultant_user_id = ?, consultant_branch = ?, consultant_department = ?,
      manager_username = ?, manager_name = ?, manager_user_id = ?,
      manager_branch = ?, manager_department = ?,
      client_name = ?, fee_type = ?, fee_amount = ?,
      bimonthly_period = ?, updated_at = datetime('now')
    WHERE id = ?
  `).bind(
    registeredAt, consultantName, consultantPosition,
    consultant.user_id, consultant.branch, consultant.department,
    managerUsername, managerName, manager.user_id,
    manager.branch, manager.department,
    clientName, feeType, feeAmount,
    bimonthlyPeriod, id,
  ).run();

  const updated = await db.prepare('SELECT * FROM cases WHERE id = ?').bind(id).first<any>();
  return c.json({ success: true, case: updated });
});

const CASES_DELETE_ROLES = ['master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst'] as const;

// 내부 삭제 처리: 외부 원본은 건드리지 않고 my-docs 목록/성과금에서 제외
cases.delete('/:id', requireRole(...CASES_DELETE_ROLES), async (c) => {
  const db = c.env.DB;
  await ensureCaseHiddenTable(db);
  const user = c.get('user');
  const id = c.req.param('id');
  const reason = c.req.query('reason') || '';

  if (user.role === 'admin' && user.branch !== '의정부') {
    return c.json({ error: '삭제 권한이 없습니다.' }, 403);
  }

  const row = await db.prepare('SELECT id, external_id FROM cases WHERE id = ?').bind(id).first<{ id: string; external_id: string }>();
  if (!row) return c.json({ error: '사건을 찾을 수 없습니다.' }, 404);

  await db.prepare(`
    INSERT INTO case_hidden (external_id, case_id, hidden_by, hidden_reason, hidden_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(external_id) DO UPDATE SET
      case_id = excluded.case_id,
      hidden_by = excluded.hidden_by,
      hidden_reason = excluded.hidden_reason,
      hidden_at = datetime('now')
  `).bind(row.external_id, row.id, user.sub, reason).run();

  return c.json({ success: true });
});

// ───── 명도성과금 요약: GET /api/cases/bonus/summary?period=2026-03_04 ─────
// 2개월 구간 + 사용자별 합계 + 등급 계산 (급여정산 통합용)
cases.get('/bonus/summary', requireRole(...CASES_VIEW_ROLES), async (c) => {
  const db = c.env.DB;
  await ensureCaseHiddenTable(db);
  const period = c.req.query('period') || '';
  if (!period) return c.json({ error: 'period is required (e.g. 2026-03_04)' }, 400);

  // 명도성과금은 컨설턴트(consultant) 귀속
  // 조정 금액: 정액제 -150,000원 / 실비제 ÷1.1 (부가세 제외)
  const result = await db.prepare(`
    SELECT consultant_user_id, consultant_name, consultant_position,
      consultant_branch, consultant_department,
      COUNT(*) as cnt,
      COALESCE(SUM(fee_amount), 0) as total_fee_raw,
      COALESCE(SUM(
        CASE
          WHEN fee_type = 'fixed' THEN MAX(0, fee_amount - 150000)
          ELSE CAST(ROUND(fee_amount * 1.0 / 1.1) AS INTEGER)
        END
      ), 0) as total_fee_adjusted
    FROM cases
    WHERE bimonthly_period = ? AND consultant_name IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM case_hidden ch WHERE ch.external_id = cases.external_id)
    GROUP BY consultant_user_id, consultant_name
    ORDER BY total_fee_adjusted DESC
  `).bind(period).all<any>();

  const summary = (result.results || []).map((r: any) => ({
    ...r,
    total_fee: r.total_fee_adjusted, // 호환: 기존 클라이언트가 total_fee 사용
    bonus: calculateMyungdoBonus(r.total_fee_adjusted),
  }));

  return c.json({
    period,
    period_label: labelOfPeriod(period),
    summary,
  });
});

// ───── 사용자 본인의 명도성과금 (내 마이페이지 등) ─────
cases.get('/bonus/me', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  await ensureCaseHiddenTable(db);
  const period = c.req.query('period') || '';
  if (!period) return c.json({ error: 'period is required' }, 400);

  const result = await db.prepare(`
    SELECT
      COALESCE(SUM(fee_amount), 0) as total_fee_raw,
      COALESCE(SUM(
        CASE
          WHEN fee_type = 'fixed' THEN MAX(0, fee_amount - 150000)
          ELSE CAST(ROUND(fee_amount * 1.0 / 1.1) AS INTEGER)
        END
      ), 0) as total_fee_adjusted,
      COUNT(*) as cnt
    FROM cases
    WHERE bimonthly_period = ? AND consultant_user_id = ?
      AND NOT EXISTS (SELECT 1 FROM case_hidden ch WHERE ch.external_id = cases.external_id)
  `).bind(period, user.sub).first<any>();

  const adjusted = result?.total_fee_adjusted || 0;
  return c.json({
    period,
    period_label: labelOfPeriod(period),
    total_fee_raw: result?.total_fee_raw || 0,
    total_fee_adjusted: adjusted,
    total_fee: adjusted, // 호환
    case_count: result?.cnt || 0,
    bonus: calculateMyungdoBonus(adjusted),
  });
});

// ───── 명도성과금 매출 자동 INSERT (2개월 마감 일괄) ─────
// 정책:
//   - 대상: 본사관리 아닌 모든 컨설턴트 (급여제 + 비율제)
//     · 급여제: 매출 합계에 부가세 분리 없이 합산되어 일반 성과금에도 반영
//     · 비율제: commission rate 미적용, 3.3%만 차감되어 명도성과금만 별도 수령
//       (payroll.ts business-income 처리에서 type_detail='명도성과금'으로 분리)
//   - INSERT OR IGNORE (external_id UNIQUE) — 한 번 들어가면 변동 없음
//   - contract_date / deposit_date = 마감월 말일 (예: 2026-04-30)
//   - amount = 등급 성과금 (10/20/30/40/60/80만), 부가세 없음
export async function finalizeMyungdoBonus(env: any, period: string): Promise<{
  period: string;
  period_label: string;
  inserted: number;
  skipped: number;
  ineligible: number;
  details: Array<{ user_id: string; user_name: string; bonus: number; status: 'inserted' | 'skipped' | 'ineligible'; reason?: string }>;
}> {
  const db = env.DB as D1Database;
  await ensureCaseHiddenTable(db);

  // period 파싱: '2026-03_04' → year=2026, m1=3, m2=4
  const m = period.match(/^(\d{4})-(\d{2})_(\d{2})$/);
  if (!m) throw new Error(`invalid period: ${period}`);
  const year = parseInt(m[1], 10);
  const m1 = parseInt(m[2], 10);
  const m2 = parseInt(m[3], 10);

  void m1;
  // 마감월(짝수월) 말일
  const lastDay = new Date(year, m2, 0).getDate();
  const closingDate = `${year}-${String(m2).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  const periodLabel = labelOfPeriod(period);

  // 컨설턴트별 합계 (조정 금액 기준)
  const summaryRes = await db.prepare(`
    SELECT consultant_user_id, consultant_name,
      consultant_branch, consultant_department,
      COUNT(*) as cnt,
      COALESCE(SUM(
        CASE
          WHEN fee_type = 'fixed' THEN MAX(0, fee_amount - 150000)
          ELSE CAST(ROUND(fee_amount * 1.0 / 1.1) AS INTEGER)
        END
      ), 0) as total_fee_adjusted
    FROM cases
    WHERE bimonthly_period = ?
      AND consultant_user_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM case_hidden ch WHERE ch.external_id = cases.external_id)
    GROUP BY consultant_user_id
  `).bind(period).all<any>();

  let inserted = 0, skipped = 0, ineligible = 0;
  const details: any[] = [];

  for (const r of (summaryRes.results || [])) {
    const userId = r.consultant_user_id;
    const userName = r.consultant_name || '';
    const bonus = calculateMyungdoBonus(r.total_fee_adjusted);
    if (bonus <= 0) {
      details.push({ user_id: userId, user_name: userName, bonus: 0, status: 'ineligible', reason: '등급 미달' });
      ineligible++;
      continue;
    }

    // 자격 체크: 본사관리만 제외 (급여제·비율제 모두 대상)
    const u = await db.prepare(`
      SELECT u.id, u.name, u.branch, u.role,
        COALESCE(ua.pay_type, 'salary') as pay_type
      FROM users u
      LEFT JOIN user_accounting ua ON ua.user_id = u.id
      WHERE u.id = ?
    `).bind(userId).first<any>();
    if (!u) {
      details.push({ user_id: userId, user_name: userName, bonus, status: 'ineligible', reason: '사용자 없음' });
      ineligible++;
      continue;
    }
    const isHQ = u.branch === '본사 관리' || ['ceo', 'cc_ref', 'accountant', 'accountant_asst'].includes(u.role);
    if (isHQ) {
      details.push({ user_id: userId, user_name: userName, bonus, status: 'ineligible', reason: '본사관리' });
      ineligible++;
      continue;
    }

    // INSERT OR IGNORE — external_id 중복이면 무시
    const externalId = `myungdo-bonus-${userId}-${period}`;
    const id = `mb-${crypto.randomUUID().slice(0, 12)}`;
    const result = await db.prepare(`
      INSERT OR IGNORE INTO sales_records (
        id, user_id, type, type_detail, client_name, depositor_name, depositor_different,
        amount, contract_date, status, deposit_date, payment_type, payment_method,
        memo, branch, department, direction, external_id,
        confirmed_at
      ) VALUES (
        ?, ?, '기타', ?, ?, ?, 0,
        ?, ?, 'confirmed', ?, '이체', '',
        ?, ?, ?, 'income', ?,
        datetime('now')
      )
    `).bind(
      id, userId, `명도성과금 (${periodLabel})`,
      userName, userName,
      bonus, closingDate, closingDate,
      `명승 명도사건 ${r.cnt}건 / 조정매출 ${r.total_fee_adjusted}원 → ${periodLabel} 등급 성과금`,
      u.branch || '', '', externalId,
    ).run();

    if ((result.meta?.changes || 0) > 0) {
      inserted++;
      details.push({ user_id: userId, user_name: userName, bonus, status: 'inserted' });
    } else {
      skipped++;
      details.push({ user_id: userId, user_name: userName, bonus, status: 'skipped', reason: '이미 처리됨' });
    }
  }

  return { period, period_label: periodLabel, inserted, skipped, ineligible, details };
}

// POST /api/cases/finalize-bonus — 수동 트리거 (마스터/총무담당)
cases.post('/finalize-bonus', requireRole('master', 'accountant'), async (c) => {
  const { period } = await c.req.json<{ period: string }>();
  if (!period) return c.json({ error: 'period is required' }, 400);
  try {
    const result = await finalizeMyungdoBonus(c.env, period);
    return c.json({ success: true, ...result });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

export default cases;
