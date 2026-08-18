import { Hono } from 'hono';
import type { AuthEnv, User } from '../types';
import { authMiddleware, requireRole, hashPassword } from '../middleware/auth';
import { sendAlimtalkByTemplate } from '../alimtalk';
import { isHeadOfficeBranch, normalizeBranchName, sameBranchName } from '../lib/branchAliases';
import { currentKstMonth, ensurePayTypeHistoryTable, normalizeYearMonth, previousMonth } from '../lib/pay-type-history';
import { MIN_PASSWORD_LENGTH } from '../../shared/password-security';
import {
  canConvertEmployeeRoleToFreelancer,
  freelancerConversionBlockers,
  normalizeCommissionRate,
  restoreEmployeeRoleFromSnapshot,
} from '../../shared/employment-conversion';
import {
  ensureEmploymentTypeHistoryTable,
  getFreelancerConversionImpact,
} from '../lib/employment-conversion';
import { reinitUserLeave } from './leave';
import { requiresEmployeeLogin } from '../../shared/employment-access';

const users = new Hono<AuthEnv>();
users.use('*', authMiddleware);

type EmploymentConversionUser = {
  id: string;
  email: string;
  name: string;
  phone: string;
  role: string;
  team_id: string;
  branch: string;
  department: string;
  position_title: string;
  login_type: string;
  approved: number;
  created_at: string;
  updated_at: string;
};

const EMPLOYMENT_CONVERSION_USER_SELECT = `
  SELECT id, email, name, phone, role, team_id, branch, department,
         position_title, login_type, approved, created_at, updated_at
  FROM users
  WHERE id = ? AND approved = 1
`;

function conversionUserResponse(
  target: EmploymentConversionUser,
  loginType: 'employee' | 'freelancer',
  role = target.role,
) {
  return {
    id: target.id,
    email: target.email,
    name: target.name,
    phone: target.phone,
    role,
    team_id: target.team_id,
    branch: target.branch,
    department: target.department,
    position_title: target.position_title,
    login_type: loginType,
    approved: target.approved,
    created_at: target.created_at,
    updated_at: target.updated_at,
  };
}

async function ensureUsersResignedAtColumn(db: D1Database): Promise<void> {
  const columns = await db.prepare('PRAGMA table_info(users)').all<{ name: string }>();
  const names = new Set((columns.results || []).map((c) => c.name));
  if (!names.has('resigned_at')) {
    await db.prepare('ALTER TABLE users ADD COLUMN resigned_at TEXT').run();
  }
  if (!names.has('myauction_id')) {
    await db.prepare("ALTER TABLE users ADD COLUMN myauction_id TEXT NOT NULL DEFAULT ''").run();
  }
  if (!names.has('myauction_pw')) {
    await db.prepare("ALTER TABLE users ADD COLUMN myauction_pw TEXT NOT NULL DEFAULT ''").run();
  }
  if (!names.has('report_permission')) {
    await db.prepare("ALTER TABLE users ADD COLUMN report_permission TEXT NOT NULL DEFAULT 'basic'").run();
  }
}

// GET /api/users
users.get('/', requireRole('master', 'ceo', 'admin', 'accountant', 'accountant_asst', 'manager'), async (c) => {
  const user = c.get('user');
  if (user.login_type === 'freelancer' && user.role !== 'master') {
    return c.json({ error: '프리랜서 계정은 직원 사용자관리를 조회할 수 없습니다.' }, 403);
  }
  const db = c.env.DB;
  await ensureUsersResignedAtColumn(db);

  let query = `
    SELECT id, email, name, phone, role, team_id, branch, department, position_title,
      card_number, hire_date, login_type, approved, resigned_at, created_at, updated_at,
      COALESCE(myauction_id, '') AS myauction_id,
      CASE WHEN COALESCE(myauction_id, '') != '' AND COALESCE(myauction_pw, '') != '' THEN 1 ELSE 0 END AS has_myauction_credentials,
      COALESCE(report_permission, 'basic') AS report_permission
    FROM users WHERE approved = 1
  `;
  const params: string[] = [];

  if (user.role === 'accountant' || user.role === 'accountant_asst') {
    // 총무: 전체 열람 가능 (회계 관리 목적)
  } else if (user.role === 'admin' && isHeadOfficeBranch(user.branch)) {
    // 의정부 관리자: 전체 열람 가능
  } else if (user.role === 'admin') {
    query += ' AND branch = ?';
    params.push(user.branch);
  } else if (user.role === 'manager') {
    query += ' AND branch = ? AND department = ?';
    params.push(user.branch);
    params.push(user.department);
  }

  query += ' ORDER BY created_at DESC';
  const stmt = db.prepare(query);
  const result = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
  return c.json({ users: result.results });
});

// GET /api/users/pending - 승인 대기 목록 (admin+ 및 총무)
users.get('/pending', requireRole('master', 'ceo', 'admin', 'accountant'), async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  let query = 'SELECT id, email, name, phone, branch, login_type, created_at FROM users WHERE approved = 0';
  const params: string[] = [];

  if (user.role === 'admin') {
    query += ' AND branch = ?';
    params.push(user.branch);
  }

  query += ' ORDER BY created_at ASC';
  const stmt = db.prepare(query);
  const result = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
  return c.json({ users: result.results });
});

// POST /api/users/:id/approve - 가입 승인 (admin+ 및 총무)
users.post('/:id/approve', requireRole('master', 'ceo', 'admin', 'accountant'), async (c) => {
  const id = c.req.param('id');
  const { department } = await c.req.json<{ department?: string }>();
  const db = c.env.DB;

  const existing = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<User>();
  if (!existing) return c.json({ error: '사용자를 찾을 수 없습니다.' }, 404);
  if (existing.approved) return c.json({ error: '이미 승인된 사용자입니다.' }, 400);

  await db.prepare(
    "UPDATE users SET approved = 1, department = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(department || '', id).run();

  // 알림톡: 가입 승인 → 신규회원에게 SIGNUP_APPROVED
  if (existing.phone) {
    c.executionCtx.waitUntil(sendAlimtalkByTemplate(
      c.env as unknown as Record<string, unknown>, 'SIGNUP_APPROVED',
      { user_name: existing.name, branch: existing.branch || '', department: department || existing.department || '', position_title: existing.position_title || '' },
      [existing.phone],
    ).catch(() => {}));
  }

  return c.json({ success: true });
});

// POST /api/users/:id/reject - 가입 거절 (admin+ 및 총무)
users.post('/:id/reject', requireRole('master', 'ceo', 'admin', 'accountant'), async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;

  await db.prepare('DELETE FROM users WHERE id = ? AND approved = 0').bind(id).run();
  return c.json({ success: true });
});

// PUT /api/users/:id/role - 역할/지사/팀 변경
users.put('/:id/role', requireRole('master', 'ceo', 'admin', 'accountant'), async (c) => {
  const id = c.req.param('id');
  const currentUser = c.get('user');
  const { role, branch, department, resigned_at } = await c.req.json<{ role?: string; branch?: string; department?: string; resigned_at?: string }>();
  const db = c.env.DB;
  await ensureUsersResignedAtColumn(db);

  if (role && !['master', 'ceo', 'cc_ref', 'admin', 'director', 'accountant', 'accountant_asst', 'manager', 'member', 'support', 'resigned'].includes(role)) {
    return c.json({ error: '유효하지 않은 역할입니다.' }, 400);
  }

  const existing = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<User>();
  if (!existing) return c.json({ error: '사용자를 찾을 수 없습니다.' }, 404);

  // 관리자는 본인 지사 사용자만 수정 가능
  if (currentUser.role === 'admin' && !sameBranchName(existing.branch, currentUser.branch)) {
    return c.json({ error: '본인 지사 사용자만 수정할 수 있습니다.' }, 403);
  }

  const newRole = role || existing.role;
  const nextDepartment = department ?? existing.department;
  if ((existing.login_type || 'employee') === 'freelancer' && requiresEmployeeLogin({
    role: newRole,
    login_type: 'freelancer',
    department: nextDepartment,
    position_title: existing.position_title,
  })) {
    return c.json({ error: '일반 로그인 필수 직책·부서는 프리랜서 계정에 지정할 수 없습니다. 먼저 정규직(일반 로그인)으로 전환해 주세요.' }, 400);
  }
  if (currentUser.role === 'accountant') {
    const canSetResigned = newRole === 'resigned' && !['master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst'].includes(existing.role);
    const canEditResignedDate = existing.role === 'resigned' && newRole === 'resigned';
    if (!canSetResigned && !canEditResignedDate) {
      return c.json({ error: '총무담당은 퇴사 처리와 퇴사일 수정만 가능합니다.' }, 403);
    }
    if (branch !== undefined || department !== undefined) {
      return c.json({ error: '총무담당은 지사/팀을 변경할 수 없습니다.' }, 403);
    }
  }
  const nextResignedAt = newRole === 'resigned'
    ? String(resigned_at || (existing as any).resigned_at || '').trim()
    : '';

  if (newRole === 'resigned' && !/^\d{4}-\d{2}-\d{2}$/.test(nextResignedAt)) {
    return c.json({ error: '퇴사일을 YYYY-MM-DD 형식으로 입력해주세요.' }, 400);
  }

  if (newRole === 'master' && currentUser.role !== 'master') {
    return c.json({ error: '마스터 권한은 마스터만 설정할 수 있습니다.' }, 403);
  }
  if (newRole === 'ceo' && currentUser.role !== 'master') {
    return c.json({ error: '대표 권한은 마스터만 설정할 수 있습니다.' }, 403);
  }
  if (newRole === 'cc_ref' && currentUser.role !== 'master' && currentUser.role !== 'ceo' && currentUser.role !== 'cc_ref') {
    return c.json({ error: 'CC참조자 권한은 대표 이상만 설정할 수 있습니다.' }, 403);
  }
  if (newRole === 'admin' && currentUser.role !== 'master' && currentUser.role !== 'ceo' && currentUser.role !== 'cc_ref') {
    return c.json({ error: '관리자 등급 설정은 대표 이상만 가능합니다.' }, 403);
  }
  if (currentUser.role === 'admin' && (newRole !== 'manager' && newRole !== 'member' && newRole !== existing.role)) {
    return c.json({ error: '관리자는 팀장/팀원 직책만 변경할 수 있습니다.' }, 403);
  }

  await db.prepare(
    "UPDATE users SET role = ?, branch = ?, department = ?, resigned_at = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(newRole, branch !== undefined ? normalizeBranchName(branch) : existing.branch, nextDepartment, nextResignedAt, id).run();

  return c.json({ success: true });
});

// DELETE /api/users/:id - 사용자 삭제
// 관리자: 팀장/팀원 삭제 가능
// 대표: 관리자 이하 삭제 가능
// 마스터: 전부 삭제 가능 (본인 제외)
users.get('/:id/freelancer-conversion-impact', requireRole('master', 'ceo', 'accountant'), async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const target = await db.prepare(
    'SELECT id, name, role, department, position_title, login_type FROM users WHERE id = ? AND approved = 1'
  ).bind(id).first<{ id: string; name: string; role: string; department: string; position_title: string; login_type: string }>();
  if (!target) return c.json({ error: '사용자를 찾을 수 없습니다.' }, 404);
  if ((target.login_type || 'employee') !== 'employee') {
    return c.json({ error: '정규직 계정만 프리랜서로 전환할 수 있습니다.' }, 400);
  }
  if (!canConvertEmployeeRoleToFreelancer(target.role)) {
    return c.json({ error: '팀장·팀원 계정만 프리랜서로 전환할 수 있습니다.' }, 400);
  }
  if (requiresEmployeeLogin(target)) {
    return c.json({ error: '명도팀·PD·사무장 및 관리자 이상 계정은 일반 로그인을 유지해야 합니다.' }, 400);
  }

  const impact = await getFreelancerConversionImpact(db, id);
  return c.json({
    impact,
    blockers: freelancerConversionBlockers(impact),
  });
});

// PUT /api/users/:id/convert-to-employee - freelancer login/accounting conversion
users.put('/:id/convert-to-employee', requireRole('master', 'ceo', 'accountant'), async (c) => {
  const id = c.req.param('id');
  const currentUser = c.get('user');
  const db = c.env.DB;
  const { salary, grade, position_allowance, effective_month } = await c.req.json<{
    salary?: number;
    grade?: string;
    position_allowance?: number;
    effective_month?: string;
  }>();

  const target = await db.prepare(EMPLOYMENT_CONVERSION_USER_SELECT)
    .bind(id)
    .first<EmploymentConversionUser>();
  if (!target) return c.json({ error: '사용자를 찾을 수 없습니다.' }, 404);
  if ((target.login_type || 'employee') !== 'freelancer') {
    return c.json({ error: '프리랜서 계정만 정규직으로 전환할 수 있습니다.' }, 400);
  }
  if (target.role === 'master' && currentUser.role !== 'master') {
    return c.json({ error: '마스터 계정은 마스터만 변경할 수 있습니다.' }, 403);
  }
  if (target.role === 'resigned') {
    return c.json({ error: '퇴사자는 정규직 전환할 수 없습니다.' }, 400);
  }

  const rawSalary = Number(salary);
  const rawAllowance = position_allowance === undefined ? 0 : Number(position_allowance);
  const nextSalary = Math.trunc(rawSalary);
  const nextAllowance = Math.trunc(rawAllowance);
  const nextGrade = String(grade || '').trim();
  if (!Number.isFinite(rawSalary) || nextSalary <= 0) {
    return c.json({ error: '정규직 전환에는 0보다 큰 급여가 필요합니다.' }, 400);
  }
  if (!Number.isFinite(rawAllowance) || nextAllowance < 0) {
    return c.json({ error: '직책수당은 0 이상 숫자로 입력해주세요.' }, 400);
  }
  if (!['', 'M1', 'M2', 'M3', 'M4'].includes(nextGrade)) {
    return c.json({ error: '유효하지 않은 직급입니다.' }, 400);
  }

  const effectiveMonth = normalizeYearMonth(effective_month) || currentKstMonth();
  const beforeMonth = previousMonth(effectiveMonth) || '1900-01';

  await Promise.all([
    ensurePayTypeHistoryTable(db),
    ensureEmploymentTypeHistoryTable(db),
  ]);
  const previousConversion = await db.prepare(`
    SELECT impact_snapshot
    FROM user_employment_type_history
    WHERE user_id = ?
      AND from_login_type = 'employee'
      AND to_login_type = 'freelancer'
    ORDER BY created_at DESC, rowid DESC
    LIMIT 1
  `).bind(id).first<{ impact_snapshot: string }>();
  const restoredRole = restoreEmployeeRoleFromSnapshot(previousConversion?.impact_snapshot, target.role);
  if (currentUser.role === 'accountant' && restoredRole !== target.role) {
    return c.json({ error: '총무담당은 전환 과정에서 직책을 변경할 수 없습니다.' }, 403);
  }
  const existingAccounting = await db.prepare('SELECT * FROM user_accounting WHERE user_id = ?').bind(id).first<any>();
  const preservedSsn = String(existingAccounting?.ssn || '');
  const preservedAddress = String(existingAccounting?.address || '');
  const standardSales = Math.round(nextSalary * 1.3 * 4);
  const conversionClaimId = crypto.randomUUID();
  const statements = [
    db.prepare(`
      INSERT INTO user_employment_conversion_claims (
        id, user_id, from_login_type, to_login_type, effective_month
      )
      SELECT ?, ?, 'freelancer', 'employee', ?
      FROM users
      WHERE id = ? AND login_type = 'freelancer'
    `).bind(conversionClaimId, id, effectiveMonth, id),
    db.prepare(
      `UPDATE users
       SET login_type = 'employee', role = ?,
           auth_version = COALESCE(auth_version, 0) + 1,
           updated_at = datetime('now')
       WHERE id = ?
         AND EXISTS (SELECT 1 FROM user_employment_conversion_claims WHERE id = ?)`
    ).bind(restoredRole, id, conversionClaimId),
  ];

  if (existingAccounting) {
    statements.push(db.prepare(`
      INSERT OR IGNORE INTO user_pay_type_history (
        id, user_id, effective_month, pay_type, commission_rate, salary, standard_sales,
        grade, position_allowance, source, changed_by
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'before_employee_conversion', ?
      WHERE NOT EXISTS (
        SELECT 1 FROM user_pay_type_history WHERE user_id = ?
      )
        AND EXISTS (SELECT 1 FROM user_employment_conversion_claims WHERE id = ?)
    `).bind(
      crypto.randomUUID(),
      id,
      beforeMonth,
      existingAccounting.pay_type || 'commission',
      Number(existingAccounting.commission_rate || 0),
      Number(existingAccounting.salary || 0),
      Number(existingAccounting.standard_sales || 0),
      String(existingAccounting.grade || ''),
      Number(existingAccounting.position_allowance || 0),
      currentUser.sub || '',
      id,
      conversionClaimId,
    ));
    statements.push(db.prepare(`
      UPDATE user_accounting
      SET salary = ?,
          standard_sales = ?,
          grade = ?,
          position_allowance = ?,
          pay_type = 'salary',
          commission_rate = 0,
          ssn = ?,
          address = ?,
          updated_at = datetime('now')
      WHERE user_id = ?
        AND EXISTS (SELECT 1 FROM user_employment_conversion_claims WHERE id = ?)
    `).bind(nextSalary, standardSales, nextGrade, nextAllowance, preservedSsn, preservedAddress, id, conversionClaimId));
  } else {
    statements.push(db.prepare(`
      INSERT OR IGNORE INTO user_pay_type_history (
        id, user_id, effective_month, pay_type, commission_rate, salary, standard_sales,
        grade, position_allowance, source, changed_by
      )
      SELECT ?, ?, ?, 'commission', 50, 0, 0, '', 0, 'before_employee_conversion', ?
      WHERE NOT EXISTS (
        SELECT 1 FROM user_pay_type_history WHERE user_id = ?
      )
        AND EXISTS (SELECT 1 FROM user_employment_conversion_claims WHERE id = ?)
    `).bind(crypto.randomUUID(), id, beforeMonth, currentUser.sub || '', id, conversionClaimId));
    statements.push(db.prepare(`
      INSERT INTO user_accounting (id, user_id, salary, standard_sales, grade, position_allowance, pay_type, commission_rate, ssn, address)
      SELECT ?, ?, ?, ?, ?, ?, 'salary', 0, '', ''
      WHERE EXISTS (SELECT 1 FROM user_employment_conversion_claims WHERE id = ?)
    `).bind(crypto.randomUUID(), id, nextSalary, standardSales, nextGrade, nextAllowance, conversionClaimId));
  }

  statements.push(db.prepare(`
    INSERT OR REPLACE INTO user_pay_type_history (
      id, user_id, effective_month, pay_type, commission_rate, salary, standard_sales,
      grade, position_allowance, source, changed_by
    )
    SELECT
      COALESCE((SELECT id FROM user_pay_type_history WHERE user_id = ? AND effective_month = ? AND source = 'employee_conversion'), ?),
      ?, ?, 'salary', 0, ?, ?, ?, ?, 'employee_conversion', ?
    WHERE EXISTS (SELECT 1 FROM user_employment_conversion_claims WHERE id = ?)
  `).bind(
    id,
    effectiveMonth,
    crypto.randomUUID(),
    id,
    effectiveMonth,
    nextSalary,
    standardSales,
    nextGrade,
    nextAllowance,
    currentUser.sub || '',
    conversionClaimId,
  ));
  statements.push(db.prepare(`
    INSERT INTO user_employment_type_history (
      id, user_id, from_login_type, to_login_type, effective_month, changed_by, impact_snapshot
    )
    SELECT ?, ?, 'freelancer', 'employee', ?, ?, ?
    WHERE EXISTS (SELECT 1 FROM user_employment_conversion_claims WHERE id = ?)
  `).bind(
    crypto.randomUUID(),
    id,
    effectiveMonth,
    currentUser.sub || '',
    JSON.stringify({ previous_role: target.role, restored_role: restoredRole }),
    conversionClaimId,
  ));
  statements.push(
    db.prepare('DELETE FROM user_employment_conversion_claims WHERE id = ?').bind(conversionClaimId),
  );

  const batchResults = await db.batch(statements);
  if (Number(batchResults[0]?.meta?.changes || 0) !== 1) {
    return c.json({ error: '계정 상태가 변경되었습니다. 다시 확인해 주세요.' }, 409);
  }

  return c.json({
    success: true,
    user: conversionUserResponse(target, 'employee', restoredRole),
    account: {
      user_id: id,
      salary: nextSalary,
      standard_sales: standardSales,
      grade: nextGrade,
      position_allowance: nextAllowance,
      pay_type: 'salary',
      commission_rate: 0,
      ssn: preservedSsn,
      address: preservedAddress,
      effective_month: effectiveMonth,
    },
  });
});

// PUT /api/users/:id/convert-to-freelancer - employee login/accounting conversion
users.put('/:id/convert-to-freelancer', requireRole('master', 'ceo', 'accountant'), async (c) => {
  const id = c.req.param('id');
  const currentUser = c.get('user');
  const db = c.env.DB;
  const {
    commission_rate,
    position_allowance,
    ssn,
    address,
    effective_month,
    resolve_pending_work,
  } = await c.req.json<{
    commission_rate?: number;
    position_allowance?: number;
    ssn?: string;
    address?: string;
    effective_month?: string;
    resolve_pending_work?: boolean;
  }>();

  const target = await db.prepare(EMPLOYMENT_CONVERSION_USER_SELECT)
    .bind(id)
    .first<EmploymentConversionUser>();
  if (!target) return c.json({ error: '사용자를 찾을 수 없습니다.' }, 404);
  if ((target.login_type || 'employee') !== 'employee') {
    return c.json({ error: '정규직 계정만 프리랜서로 전환할 수 있습니다.' }, 400);
  }
  if (!canConvertEmployeeRoleToFreelancer(target.role)) {
    return c.json({ error: '팀장·팀원 계정만 프리랜서로 전환할 수 있습니다.' }, 400);
  }
  if (requiresEmployeeLogin(target)) {
    return c.json({ error: '명도팀·PD·사무장 및 관리자 이상 계정은 일반 로그인을 유지해야 합니다.' }, 400);
  }
  if (currentUser.role === 'accountant' && target.role !== 'member') {
    return c.json({ error: '총무담당은 전환 과정에서 직책을 변경할 수 없습니다.' }, 403);
  }

  const nextCommissionRate = normalizeCommissionRate(commission_rate ?? 50);
  if (nextCommissionRate === null) {
    return c.json({ error: '비율은 0보다 크고 100 이하인 숫자로 입력해주세요.' }, 400);
  }
  const rawAllowance = position_allowance === undefined ? 0 : Number(position_allowance);
  const nextAllowance = Math.trunc(rawAllowance);
  if (!Number.isFinite(rawAllowance) || nextAllowance < 0) {
    return c.json({ error: '직책수당은 0 이상 숫자로 입력해주세요.' }, 400);
  }

  const effectiveMonth = normalizeYearMonth(effective_month) || currentKstMonth();
  if (effectiveMonth !== currentKstMonth()) {
    return c.json({ error: '계정 전환 적용월은 현재 월만 선택할 수 있습니다.' }, 400);
  }
  const beforeMonth = previousMonth(effectiveMonth) || '1900-01';
  const impact = await getFreelancerConversionImpact(db, id);
  const blockers = freelancerConversionBlockers(impact);
  const shouldResolvePendingWork = resolve_pending_work === true;
  if (blockers.length > 0 && !shouldResolvePendingWork) {
    return c.json({
      error: `전환 전에 다음 업무를 처리해주세요: ${blockers.join(', ')}`,
      impact,
      blockers,
    }, 409);
  }

  const pendingReassignment = await db.prepare(`
    SELECT COUNT(*) AS count
    FROM approval_steps aps
    JOIN documents d ON d.id = aps.document_id
    WHERE aps.approver_id = ?
      AND aps.status = 'pending'
      AND d.status = 'submitted'
      AND d.author_id <> ?
      AND COALESCE(d.cancelled, 0) = 0
      AND COALESCE(d.is_myauction, 0) = 0
  `).bind(id, id).first<{ count: number }>();
  const pendingReassignmentCount = Number(pendingReassignment?.count || 0);
  const fallbackApprover = pendingReassignmentCount > 0
    ? await db.prepare(`
        SELECT id, name
        FROM users
        WHERE approved = 1
          AND id <> ?
          AND COALESCE(login_type, 'employee') = 'employee'
          AND role IN ('master', 'accountant', 'ceo')
        ORDER BY CASE
          WHEN id = ? THEN 0
          WHEN role = 'master' THEN 1
          WHEN role = 'accountant' THEN 2
          ELSE 3
        END, name
        LIMIT 1
      `).bind(id, currentUser.sub).first<{ id: string; name: string }>()
    : null;
  if (shouldResolvePendingWork && pendingReassignmentCount > 0 && !fallbackApprover) {
    return c.json({
      error: '대기 중인 일반 문서 결재를 넘겨받을 일반 로그인 관리자(마스터/총무담당/대표)가 없습니다.',
      impact,
      blockers,
    }, 409);
  }

  await Promise.all([
    ensurePayTypeHistoryTable(db),
    ensureEmploymentTypeHistoryTable(db),
  ]);
  const existingAccounting = await db.prepare(
    'SELECT * FROM user_accounting WHERE user_id = ?'
  ).bind(id).first<any>();
  const nextSsn = String(ssn ?? existingAccounting?.ssn ?? '').trim();
  const nextAddress = String(address ?? existingAccounting?.address ?? '').trim();
  const conversionClaimId = crypto.randomUUID();
  const pendingWorkGuard = shouldResolvePendingWork ? '' : `
        AND NOT EXISTS (
          SELECT 1 FROM leave_requests
          WHERE user_id = ? AND status IN ('pending', 'cancel_requested')
        )
        AND NOT EXISTS (
          SELECT 1
          FROM approval_steps aps
          JOIN documents d ON d.id = aps.document_id
          WHERE aps.approver_id = ?
            AND aps.status = 'pending'
            AND d.status = 'submitted'
            AND COALESCE(d.cancelled, 0) = 0
            AND COALESCE(d.is_myauction, 0) = 0
        )
        AND NOT EXISTS (
          SELECT 1 FROM documents
          WHERE author_id = ?
            AND COALESCE(is_myauction, 0) = 0
            AND COALESCE(cancelled, 0) = 0
            AND status IN ('draft', 'submitted', 'rejected')
        )`;
  const claimBindings = shouldResolvePendingWork
    ? [conversionClaimId, id, effectiveMonth, id]
    : [conversionClaimId, id, effectiveMonth, id, id, id, id];
  const statements = [
    db.prepare(`
      INSERT INTO user_employment_conversion_claims (
        id, user_id, from_login_type, to_login_type, effective_month
      )
      SELECT ?, ?, 'employee', 'freelancer', ?
      FROM users
      WHERE id = ?
        AND COALESCE(login_type, 'employee') = 'employee'
        ${pendingWorkGuard}
    `).bind(...claimBindings),
  ];
  let cancelledDocumentsStatementIndex = -1;
  let cancelledLeavesStatementIndex = -1;
  let reassignedApprovalsStatementIndex = -1;

  if (shouldResolvePendingWork) {
    const conversionReason = '프리랜서 전환에 따라 진행 중인 일반 사내 문서를 자동 취소했습니다.';
    statements.push(db.prepare(`
      INSERT INTO document_logs (id, document_id, user_id, action, details)
      SELECT lower(hex(randomblob(16))), d.id, ?, 'cancelled_for_freelancer_conversion', ?
      FROM documents d
      WHERE d.author_id = ?
        AND COALESCE(d.is_myauction, 0) = 0
        AND COALESCE(d.cancelled, 0) = 0
        AND d.status IN ('draft', 'submitted', 'rejected')
        AND EXISTS (SELECT 1 FROM user_employment_conversion_claims WHERE id = ?)
    `).bind(currentUser.sub, conversionReason, id, conversionClaimId));
    statements.push(db.prepare(`
      UPDATE alert_approval_pending
      SET status = 'cancelled', acted_at = datetime('now'), acted_action = 'cancelled',
          last_checked_at = datetime('now')
      WHERE status = 'open'
        AND document_id IN (
          SELECT id FROM documents
          WHERE author_id = ?
            AND COALESCE(is_myauction, 0) = 0
            AND COALESCE(cancelled, 0) = 0
            AND status IN ('draft', 'submitted', 'rejected')
        )
        AND EXISTS (SELECT 1 FROM user_employment_conversion_claims WHERE id = ?)
    `).bind(id, conversionClaimId));
    statements.push(db.prepare(`
      UPDATE approval_steps
      SET status = 'rejected', comment = ?
      WHERE status = 'pending'
        AND document_id IN (
          SELECT id FROM documents
          WHERE author_id = ?
            AND COALESCE(is_myauction, 0) = 0
            AND COALESCE(cancelled, 0) = 0
            AND status = 'submitted'
        )
        AND EXISTS (SELECT 1 FROM user_employment_conversion_claims WHERE id = ?)
    `).bind(conversionReason, id, conversionClaimId));
    cancelledDocumentsStatementIndex = statements.length;
    statements.push(db.prepare(`
      UPDATE documents
      SET status = CASE WHEN status = 'submitted' THEN 'rejected' ELSE status END,
          reject_reason = CASE WHEN status = 'submitted' THEN ? ELSE reject_reason END,
          cancelled = 1,
          cancel_requested = 0,
          cancel_reason = ?,
          updated_at = datetime('now')
      WHERE author_id = ?
        AND COALESCE(is_myauction, 0) = 0
        AND COALESCE(cancelled, 0) = 0
        AND status IN ('draft', 'submitted', 'rejected')
        AND EXISTS (SELECT 1 FROM user_employment_conversion_claims WHERE id = ?)
    `).bind(conversionReason, conversionReason, id, conversionClaimId));
    cancelledLeavesStatementIndex = statements.length;
    statements.push(db.prepare(`
      UPDATE leave_requests
      SET status = 'cancelled', approved_by = ?, approved_at = datetime('now'),
          reject_reason = '프리랜서 전환에 따른 자동 취소', updated_at = datetime('now')
      WHERE user_id = ?
        AND status IN ('pending', 'cancel_requested')
        AND EXISTS (SELECT 1 FROM user_employment_conversion_claims WHERE id = ?)
    `).bind(currentUser.sub, id, conversionClaimId));

    if (fallbackApprover) {
      statements.push(db.prepare(`
        INSERT INTO alert_approval_pending (
          id, document_id, approver_id, cycle_no, step_order, my_status,
          document_title, document_template_id, document_author_id, document_author_name,
          document_branch, document_department, document_submitted_at,
          status, detected_at, last_checked_at, notification_sent, metadata
        )
        SELECT lower(hex(randomblob(16))), a.document_id, ?, a.cycle_no, a.step_order, a.my_status,
               a.document_title, a.document_template_id, a.document_author_id, a.document_author_name,
               a.document_branch, a.document_department, a.document_submitted_at,
               'open', datetime('now'), datetime('now'), 0, a.metadata
        FROM alert_approval_pending a
        JOIN documents d ON d.id = a.document_id
        WHERE a.approver_id = ?
          AND a.status = 'open'
          AND d.author_id <> ?
          AND d.status = 'submitted'
          AND COALESCE(d.cancelled, 0) = 0
          AND COALESCE(d.is_myauction, 0) = 0
          AND EXISTS (SELECT 1 FROM user_employment_conversion_claims WHERE id = ?)
        ON CONFLICT(document_id, approver_id, cycle_no) DO UPDATE SET
          step_order = excluded.step_order,
          my_status = 'need_approve',
          status = 'open',
          detected_at = datetime('now'),
          last_checked_at = datetime('now'),
          acted_at = NULL,
          acted_action = NULL,
          notification_sent = 0,
          notification_sent_at = NULL,
          notification_error = NULL
      `).bind(fallbackApprover.id, id, id, conversionClaimId));
      statements.push(db.prepare(`
        UPDATE alert_approval_pending
        SET status = 'cancelled', acted_at = datetime('now'), acted_action = 'reassigned',
            last_checked_at = datetime('now')
        WHERE approver_id = ?
          AND status = 'open'
          AND document_id IN (
            SELECT id FROM documents
            WHERE author_id <> ?
              AND status = 'submitted'
              AND COALESCE(cancelled, 0) = 0
              AND COALESCE(is_myauction, 0) = 0
          )
          AND EXISTS (SELECT 1 FROM user_employment_conversion_claims WHERE id = ?)
      `).bind(id, id, conversionClaimId));
      statements.push(db.prepare(`
        INSERT INTO document_logs (id, document_id, user_id, action, details)
        SELECT lower(hex(randomblob(16))), d.id, ?, 'approval_reassigned_for_freelancer_conversion', ?
        FROM documents d
        WHERE d.id IN (
          SELECT DISTINCT document_id FROM approval_steps
          WHERE approver_id = ? AND status = 'pending'
        )
          AND d.author_id <> ?
          AND d.status = 'submitted'
          AND COALESCE(d.cancelled, 0) = 0
          AND COALESCE(d.is_myauction, 0) = 0
          AND EXISTS (SELECT 1 FROM user_employment_conversion_claims WHERE id = ?)
      `).bind(
        currentUser.sub,
        `프리랜서 전환으로 결재 담당자를 ${fallbackApprover.name}님에게 재배정했습니다.`,
        id,
        id,
        conversionClaimId,
      ));
      reassignedApprovalsStatementIndex = statements.length;
      statements.push(db.prepare(`
        UPDATE approval_steps
        SET approver_id = ?
        WHERE approver_id = ?
          AND status = 'pending'
          AND document_id IN (
            SELECT id FROM documents
            WHERE author_id <> ?
              AND status = 'submitted'
              AND COALESCE(cancelled, 0) = 0
              AND COALESCE(is_myauction, 0) = 0
          )
          AND EXISTS (SELECT 1 FROM user_employment_conversion_claims WHERE id = ?)
      `).bind(fallbackApprover.id, id, id, conversionClaimId));
    }
  }

  statements.push(
    db.prepare(
      `UPDATE users
       SET login_type = 'freelancer',
           auth_version = COALESCE(auth_version, 0) + 1,
           updated_at = datetime('now')
       WHERE id = ?
         AND EXISTS (
           SELECT 1 FROM user_employment_conversion_claims WHERE id = ?
         )`
    ).bind(id, conversionClaimId),
  );

  if (existingAccounting) {
    statements.push(db.prepare(`
      INSERT OR IGNORE INTO user_pay_type_history (
        id, user_id, effective_month, pay_type, commission_rate, salary, standard_sales,
        grade, position_allowance, source, changed_by
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'before_freelancer_conversion', ?
      WHERE EXISTS (SELECT 1 FROM user_employment_conversion_claims WHERE id = ?)
        AND NOT EXISTS (SELECT 1 FROM user_pay_type_history WHERE user_id = ?)
    `).bind(
      crypto.randomUUID(),
      id,
      beforeMonth,
      existingAccounting.pay_type || 'salary',
      Number(existingAccounting.commission_rate || 0),
      Number(existingAccounting.salary || 0),
      Number(existingAccounting.standard_sales || 0),
      String(existingAccounting.grade || ''),
      Number(existingAccounting.position_allowance || 0),
      currentUser.sub || '',
      conversionClaimId,
      id,
    ));
    statements.push(db.prepare(`
      UPDATE user_accounting
      SET salary = 0,
          standard_sales = 0,
          grade = '',
          position_allowance = ?,
          pay_type = 'commission',
          commission_rate = ?,
          ssn = ?,
          address = ?,
          updated_at = datetime('now')
      WHERE user_id = ?
        AND EXISTS (SELECT 1 FROM user_employment_conversion_claims WHERE id = ?)
    `).bind(nextAllowance, nextCommissionRate, nextSsn, nextAddress, id, conversionClaimId));
  } else {
    statements.push(db.prepare(`
      INSERT OR IGNORE INTO user_pay_type_history (
        id, user_id, effective_month, pay_type, commission_rate, salary, standard_sales,
        grade, position_allowance, source, changed_by
      )
      SELECT ?, ?, ?, 'salary', 0, 0, 0, '', 0, 'before_freelancer_conversion', ?
      WHERE EXISTS (SELECT 1 FROM user_employment_conversion_claims WHERE id = ?)
        AND NOT EXISTS (SELECT 1 FROM user_pay_type_history WHERE user_id = ?)
    `).bind(crypto.randomUUID(), id, beforeMonth, currentUser.sub || '', conversionClaimId, id));
    statements.push(db.prepare(`
      INSERT INTO user_accounting (
        id, user_id, salary, standard_sales, grade, position_allowance,
        pay_type, commission_rate, ssn, address
      )
      SELECT ?, ?, 0, 0, '', ?, 'commission', ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM user_employment_conversion_claims WHERE id = ?)
    `).bind(
      crypto.randomUUID(),
      id,
      nextAllowance,
      nextCommissionRate,
      nextSsn,
      nextAddress,
      conversionClaimId,
    ));
  }

  statements.push(db.prepare(`
    INSERT OR REPLACE INTO user_pay_type_history (
      id, user_id, effective_month, pay_type, commission_rate, salary, standard_sales,
      grade, position_allowance, source, changed_by
    )
    SELECT
      COALESCE((SELECT id FROM user_pay_type_history WHERE user_id = ? AND effective_month = ? AND source = 'freelancer_conversion'), ?),
      ?, ?, 'commission', ?, 0, 0, '', ?, 'freelancer_conversion', ?
    WHERE EXISTS (SELECT 1 FROM user_employment_conversion_claims WHERE id = ?)
  `).bind(
    id,
    effectiveMonth,
    crypto.randomUUID(),
    id,
    effectiveMonth,
    nextCommissionRate,
    nextAllowance,
    currentUser.sub || '',
    conversionClaimId,
  ));
  statements.push(db.prepare(`
    INSERT INTO user_employment_type_history (
      id, user_id, from_login_type, to_login_type, effective_month, changed_by, impact_snapshot
    )
    SELECT ?, ?, 'employee', 'freelancer', ?, ?, ?
    WHERE EXISTS (SELECT 1 FROM user_employment_conversion_claims WHERE id = ?)
  `).bind(
    crypto.randomUUID(),
    id,
    effectiveMonth,
    currentUser.sub || '',
    JSON.stringify({ ...impact, previous_role: target.role, next_role: target.role }),
    conversionClaimId,
  ));
  statements.push(
    db.prepare('DELETE FROM user_employment_conversion_claims WHERE id = ?').bind(conversionClaimId),
  );

  const batchResults = await db.batch(statements);
  if (Number(batchResults[0]?.meta?.changes || 0) !== 1) {
    const latestImpact = await getFreelancerConversionImpact(db, id);
    return c.json({
      error: '전환 직전에 처리 중인 업무가 생겼거나 계정 상태가 변경되었습니다. 다시 확인해 주세요.',
      impact: latestImpact,
      blockers: freelancerConversionBlockers(latestImpact),
    }, 409);
  }

  const cancelledDocumentCount = cancelledDocumentsStatementIndex >= 0
    ? Number(batchResults[cancelledDocumentsStatementIndex]?.meta?.changes || 0)
    : 0;
  const cancelledLeaveCount = cancelledLeavesStatementIndex >= 0
    ? Number(batchResults[cancelledLeavesStatementIndex]?.meta?.changes || 0)
    : 0;
  const reassignedApprovalCount = reassignedApprovalsStatementIndex >= 0
    ? Number(batchResults[reassignedApprovalsStatementIndex]?.meta?.changes || 0)
    : 0;

  if (shouldResolvePendingWork && cancelledLeaveCount > 0) {
    await reinitUserLeave(db, id).catch((err) => {
      console.error('[employment-conversion] leave balance reinit failed', err);
    });
  }

  return c.json({
    success: true,
    user: conversionUserResponse(target, 'freelancer', target.role),
    account: {
      user_id: id,
      salary: 0,
      standard_sales: 0,
      grade: '',
      position_allowance: nextAllowance,
      pay_type: 'commission',
      commission_rate: nextCommissionRate,
      ssn: nextSsn,
      address: nextAddress,
      effective_month: effectiveMonth,
    },
    impact,
    cleanup: shouldResolvePendingWork ? {
      cancelled_leave_requests: cancelledLeaveCount,
      cancelled_non_myauction_documents: cancelledDocumentCount,
      reassigned_approval_steps: reassignedApprovalCount,
      reassigned_to: fallbackApprover?.name || '',
    } : undefined,
  });
});

// Approved accounts are never physically deleted. Past schedules, journals,
// payroll snapshots and sales all retain the same user_id, so "delete" means
// deactivating the login and archiving the person as resigned.
users.delete('/:id', requireRole('master', 'ceo', 'admin'), async (c) => {
  const id = c.req.param('id');
  const currentUser = c.get('user');
  const db = c.env.DB;

  if (id === currentUser.sub) return c.json({ error: '본인 계정은 삭제할 수 없습니다.' }, 400);

  const target = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<User>();
  if (!target) return c.json({ error: '사용자를 찾을 수 없습니다.' }, 404);

  // 관리자는 본인 지사 사용자만 삭제 가능
  if (currentUser.role === 'admin' && !sameBranchName(target.branch, currentUser.branch)) {
    return c.json({ error: '본인 지사 사용자만 삭제할 수 있습니다.' }, 403);
  }

  const hierarchy: Record<string, number> = { master: 1, ceo: 2, admin: 3, accountant: 3, accountant_asst: 4, manager: 4, member: 5 };
  const myLevel = hierarchy[currentUser.role] || 99;
  const targetLevel = hierarchy[target.role] || 99;

  if (targetLevel <= myLevel) {
    return c.json({ error: '본인과 같거나 상위 등급은 삭제할 수 없습니다.' }, 403);
  }

  await ensureUsersResignedAtColumn(db);
  await db.prepare(`
    UPDATE users
    SET role = 'resigned',
        resigned_at = COALESCE(NULLIF(resigned_at, ''), date('now', '+9 hours')),
        auth_version = COALESCE(auth_version, 0) + 1,
        updated_at = datetime('now', '+9 hours')
    WHERE id = ?
  `).bind(id).run();

  return c.json({ success: true, archived: true });
});

// PUT /api/users/:id - 프로필 수정 (본인: phone/branch/dept/password, 상위: 모든 필드)
users.put('/:id', async (c) => {
  const id = c.req.param('id');
  const currentUser = c.get('user');
  const db = c.env.DB;

  if (currentUser.sub !== id && currentUser.role !== 'master' && currentUser.role !== 'ceo' && currentUser.role !== 'cc_ref' && currentUser.role !== 'admin' && currentUser.role !== 'accountant') {
    return c.json({ error: '권한이 없습니다.' }, 403);
  }

  await ensureUsersResignedAtColumn(db);

  const { name, phone, branch, department, position_title, password, api_key, myauction_id, myauction_pw, report_permission } = await c.req.json<{
    name?: string;
    phone?: string;
    branch?: string;
    department?: string;
    position_title?: string;
    password?: string;
    api_key?: string;
    myauction_id?: string;
    myauction_pw?: string;
    report_permission?: 'basic' | 'special';
  }>();
  const existing = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<User>();
  if (!existing) return c.json({ error: '사용자를 찾을 수 없습니다.' }, 404);

  // admin의 지사/부서/보직 변경은 대표(ceo/master)만 가능
  if (currentUser.role === 'accountant' && currentUser.sub !== id) {
    if (name !== undefined || phone !== undefined || branch !== undefined || department !== undefined || password !== undefined || api_key !== undefined || myauction_id !== undefined || myauction_pw !== undefined || report_permission !== undefined) {
      return c.json({ error: '총무담당은 보직만 변경할 수 있습니다.' }, 403);
    }
    if (position_title === undefined) {
      return c.json({ error: '변경할 보직을 입력해주세요.' }, 400);
    }
    if (['master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst'].includes(existing.role)) {
      return c.json({ error: '총무담당은 관리자/총무 계정의 보직을 변경할 수 없습니다.' }, 403);
    }
  }

  if (existing.role === 'admin') {
    const changingProfile = (branch !== undefined && !sameBranchName(branch, existing.branch)) ||
      (department !== undefined && department !== existing.department) ||
      (position_title !== undefined && position_title !== existing.position_title);
    if (changingProfile && currentUser.role !== 'master' && currentUser.role !== 'ceo') {
      return c.json({ error: '관리자의 소속 정보는 대표만 변경할 수 있습니다.' }, 403);
    }
  }

  const touchesAuctionSettings = myauction_id !== undefined || myauction_pw !== undefined;
  if (touchesAuctionSettings) {
    const canEditAuctionSettings = currentUser.sub === id || ['master', 'ceo', 'cc_ref', 'admin'].includes(currentUser.role);
    if (!canEditAuctionSettings) return c.json({ error: '마이옥션 계정 수정 권한이 없습니다.' }, 403);
    if (currentUser.role === 'admin' && currentUser.sub !== id && !sameBranchName(existing.branch, currentUser.branch)) {
      return c.json({ error: '본인 지사 사용자만 수정할 수 있습니다.' }, 403);
    }
  }

  if (report_permission !== undefined) {
    if (currentUser.role !== 'master') {
      return c.json({ error: '자료 생성 권한 부여는 마스터만 가능합니다.' }, 403);
    }
    if (!['basic', 'special'].includes(report_permission)) {
      return c.json({ error: '유효하지 않은 자료 생성 권한입니다.' }, 400);
    }
  }

  if (password && password.length < MIN_PASSWORD_LENGTH) {
    return c.json({ error: `비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.` }, 400);
  }
  const newHash = password ? await hashPassword(password) : existing.password_hash;
  const nextName = name !== undefined ? String(name || '').trim() : existing.name;
  if (!nextName) return c.json({ error: '이름을 입력하세요.' }, 400);
  const nextMyauctionId = myauction_id !== undefined ? String(myauction_id || '').trim() : String((existing as any).myauction_id || '');
  const nextMyauctionPw = myauction_pw !== undefined ? String(myauction_pw || '') : String((existing as any).myauction_pw || '');
  const nextReportPermission = report_permission !== undefined ? report_permission : String((existing as any).report_permission || 'basic');
  const nextDepartment = department ?? existing.department;
  const nextPositionTitle = position_title ?? existing.position_title;
  if ((existing.login_type || 'employee') === 'freelancer' && requiresEmployeeLogin({
    role: existing.role,
    login_type: 'freelancer',
    department: nextDepartment,
    position_title: nextPositionTitle,
  })) {
    return c.json({ error: '일반 로그인 필수 직책·부서는 프리랜서 계정에 지정할 수 없습니다. 먼저 정규직(일반 로그인)으로 전환해 주세요.' }, 400);
  }

  await db.prepare(
    `UPDATE users
     SET name = ?, phone = ?, branch = ?, department = ?, position_title = ?, password_hash = ?, api_key = ?,
         myauction_id = ?, myauction_pw = ?, report_permission = ?,
         auth_version = auth_version + ?, updated_at = datetime('now')
     WHERE id = ?`
  ).bind(
    nextName,
    phone ?? existing.phone,
    branch !== undefined ? normalizeBranchName(branch) : existing.branch,
    nextDepartment,
    nextPositionTitle,
    newHash,
    api_key ?? (existing as any).api_key ?? '',
    nextMyauctionId,
    nextMyauctionPw,
    nextReportPermission,
    password ? 1 : 0,
    id,
  ).run();

  return c.json({ success: true });
});

// PUT /api/users/:id/signature — 서명 저장
users.put('/:id/signature', async (c) => {
  const id = c.req.param('id');
  const currentUser = c.get('user');
  if (currentUser.sub !== id) return c.json({ error: '본인 서명만 저장할 수 있습니다.' }, 403);

  const { signature_data } = await c.req.json<{ signature_data: string }>();
  const db = c.env.DB;
  await db.prepare("UPDATE users SET saved_signature = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(signature_data || '', id).run();
  return c.json({ success: true });
});

// DELETE /api/users/:id/signature — 서명 삭제
users.delete('/:id/signature', async (c) => {
  const id = c.req.param('id');
  const currentUser = c.get('user');
  if (currentUser.sub !== id) return c.json({ error: '본인 서명만 삭제할 수 있습니다.' }, 403);

  const db = c.env.DB;
  await db.prepare("UPDATE users SET saved_signature = '', updated_at = datetime('now') WHERE id = ?")
    .bind(id).run();
  return c.json({ success: true });
});

// GET /api/users/:id/alimtalk-settings — 알림톡 수신 설정 조회
users.get('/:id/alimtalk-settings', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const row = await db.prepare('SELECT alimtalk_branches FROM users WHERE id = ?').bind(id).first<{ alimtalk_branches: string }>();
  return c.json({ branches: row?.alimtalk_branches || '' });
});

// PUT /api/users/:id/alimtalk-settings — 알림톡 수신 설정 저장
users.put('/:id/alimtalk-settings', async (c) => {
  const id = c.req.param('id');
  const currentUser = c.get('user');
  // 본인 또는 관리자만
  if (currentUser.sub !== id && !['master', 'ceo', 'cc_ref', 'admin'].includes(currentUser.role)) {
    return c.json({ error: '권한이 없습니다.' }, 403);
  }
  const { branches } = await c.req.json<{ branches: string }>();
  const normalizedBranches = (branches || '').split(',').map(normalizeBranchName).filter(Boolean).join(',');
  await c.env.DB.prepare("UPDATE users SET alimtalk_branches = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(normalizedBranches, id).run();
  return c.json({ success: true });
});

export default users;
