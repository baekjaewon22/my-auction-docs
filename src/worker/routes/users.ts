import { Hono } from 'hono';
import type { AuthEnv, User } from '../types';
import { authMiddleware, requireRole, hashPassword } from '../middleware/auth';
import { sendAlimtalkByTemplate } from '../alimtalk';
import { isHeadOfficeBranch, normalizeBranchName, sameBranchName } from '../lib/branchAliases';
import { currentKstMonth, ensurePayTypeHistoryTable, normalizeYearMonth, previousMonth } from '../lib/pay-type-history';
import { MIN_PASSWORD_LENGTH } from '../../shared/password-security';

const users = new Hono<AuthEnv>();
users.use('*', authMiddleware);

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
  ).bind(newRole, branch !== undefined ? normalizeBranchName(branch) : existing.branch, department ?? existing.department, nextResignedAt, id).run();

  return c.json({ success: true });
});

// DELETE /api/users/:id - 사용자 삭제
// 관리자: 팀장/팀원 삭제 가능
// 대표: 관리자 이하 삭제 가능
// 마스터: 전부 삭제 가능 (본인 제외)
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

  const target = await db.prepare('SELECT * FROM users WHERE id = ? AND approved = 1').bind(id).first<any>();
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

  await ensurePayTypeHistoryTable(db);
  const existingAccounting = await db.prepare('SELECT * FROM user_accounting WHERE user_id = ?').bind(id).first<any>();
  const standardSales = Math.round(nextSalary * 1.3 * 4);
  const statements = [
    db.prepare("UPDATE users SET login_type = 'employee', updated_at = datetime('now') WHERE id = ?").bind(id),
  ];

  if (existingAccounting) {
    statements.push(db.prepare(`
      INSERT OR IGNORE INTO user_pay_type_history (
        id, user_id, effective_month, pay_type, commission_rate, salary, standard_sales,
        grade, position_allowance, source, changed_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'before_employee_conversion', ?)
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
    ));
    statements.push(db.prepare(`
      UPDATE user_accounting
      SET salary = ?,
          standard_sales = ?,
          grade = ?,
          position_allowance = ?,
          pay_type = 'salary',
          commission_rate = 0,
          ssn = '',
          address = '',
          updated_at = datetime('now')
      WHERE user_id = ?
    `).bind(nextSalary, standardSales, nextGrade, nextAllowance, id));
  } else {
    statements.push(db.prepare(`
      INSERT OR IGNORE INTO user_pay_type_history (
        id, user_id, effective_month, pay_type, commission_rate, salary, standard_sales,
        grade, position_allowance, source, changed_by
      ) VALUES (?, ?, ?, 'commission', 50, 0, 0, '', 0, 'before_employee_conversion', ?)
    `).bind(crypto.randomUUID(), id, beforeMonth, currentUser.sub || ''));
    statements.push(db.prepare(`
      INSERT INTO user_accounting (id, user_id, salary, standard_sales, grade, position_allowance, pay_type, commission_rate, ssn, address)
      VALUES (?, ?, ?, ?, ?, ?, 'salary', 0, '', '')
    `).bind(crypto.randomUUID(), id, nextSalary, standardSales, nextGrade, nextAllowance));
  }

  statements.push(db.prepare(`
    INSERT OR REPLACE INTO user_pay_type_history (
      id, user_id, effective_month, pay_type, commission_rate, salary, standard_sales,
      grade, position_allowance, source, changed_by
    ) VALUES (
      COALESCE((SELECT id FROM user_pay_type_history WHERE user_id = ? AND effective_month = ? AND source = 'employee_conversion'), ?),
      ?, ?, 'salary', 0, ?, ?, ?, ?, 'employee_conversion', ?
    )
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
  ));

  await db.batch(statements);

  return c.json({
    success: true,
    user: { ...target, login_type: 'employee' },
    account: {
      user_id: id,
      salary: nextSalary,
      standard_sales: standardSales,
      grade: nextGrade,
      position_allowance: nextAllowance,
      pay_type: 'salary',
      commission_rate: 0,
      ssn: '',
      address: '',
      effective_month: effectiveMonth,
    },
  });
});

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

  // Delete related data
  await db.prepare('DELETE FROM journal_entries WHERE user_id = ?').bind(id).run();
  await db.prepare('DELETE FROM signatures WHERE user_id = ?').bind(id).run();
  await db.prepare('DELETE FROM document_logs WHERE user_id = ?').bind(id).run();
  await db.prepare('DELETE FROM documents WHERE author_id = ?').bind(id).run();
  await db.prepare('DELETE FROM users WHERE id = ?').bind(id).run();

  return c.json({ success: true });
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
    department ?? existing.department,
    position_title ?? existing.position_title,
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
