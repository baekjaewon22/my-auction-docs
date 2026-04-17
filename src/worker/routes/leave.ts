import { Hono } from 'hono';
import type { AuthEnv } from '../types';
import { authMiddleware, requireRole } from '../middleware/auth';
import { sendAlimtalkByTemplate, APP_URL } from '../alimtalk';

const leave = new Hono<AuthEnv>();
leave.use('*', authMiddleware);

// ───── 헬퍼 ─────

// 월차 기산일: 입사일이 이 날짜 이전이면 이 날짜 기준으로 월차 계산
const MONTHLY_BASE_DATE = '2026-03-01';

/** 입사일 기준 근속 개월 수 */
function getMonthsSinceHire(hireDate: string): number {
  if (!hireDate) return 0;
  const hire = new Date(hireDate);
  const now = new Date();
  return (now.getFullYear() - hire.getFullYear()) * 12 + (now.getMonth() - hire.getMonth());
}

/** 입사일 기준 연차 계산 (자동)
 *  - 입사일이 MONTHLY_BASE_DATE 이전 & 1년 미만 → MONTHLY_BASE_DATE 기준 월차
 *  - 입사일이 MONTHLY_BASE_DATE 이후 & 1년 미만 → 입사일 기준 월차
 *  - 1년 이상 → 연차 15일 + 2년마다 1일 추가 (최대 25일)
 */
function calculateLeaveEntitlement(hireDate: string) {
  if (!hireDate) return { type: 'annual' as const, totalAnnual: 15, totalMonthly: 0 };
  const months = getMonthsSinceHire(hireDate);
  const years = Math.floor(months / 12);

  if (years < 1) {
    // 입사 1년 미만: 월차 누적
    // 입사일이 기산일 이전이면 기산일 기준으로 월차 계산
    const effectiveDate = hireDate < MONTHLY_BASE_DATE ? MONTHLY_BASE_DATE : hireDate;
    const effectiveMonths = getMonthsSinceHire(effectiveDate);
    return { type: 'monthly' as const, totalAnnual: 0, totalMonthly: Math.max(effectiveMonths, 0) };
  }
  // 입사 1년 이상: 선불 연차 15개 + 2년마다 1개 추가
  const extraDays = Math.floor((years - 1) / 2);
  const totalAnnual = Math.min(15 + extraDays, 25); // 최대 25일 제한
  return { type: 'annual' as const, totalAnnual, totalMonthly: 0 };
}

/** 환급금 계산: 월급 ÷ 209h × 8 × 잔여일수 */
function calculateRefund(salary: number, remainingDays: number): number {
  if (salary <= 0 || remainingDays <= 0) return 0;
  return Math.round((salary / 209) * 8 * remainingDays);
}

// ───── 연차 목록 (관리자+) ─────
leave.get('/', requireRole('master', 'ceo', 'admin', 'manager', 'accountant', 'accountant_asst', 'director'), async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  let query = `SELECT al.*, u.name as user_name, u.branch, u.department, u.role as user_role,
    u.hire_date, u.created_at as user_created_at
    FROM annual_leave al LEFT JOIN users u ON al.user_id = u.id WHERE u.login_type != 'freelancer' AND u.role != 'freelancer'`;
  const params: string[] = [];

  if (user.role === 'admin' && user.branch !== '의정부') {
    query += ' AND u.branch = ?';
    params.push(user.branch);
  } else if (user.role === 'manager') {
    query += ' AND u.branch = ? AND u.department = ?';
    params.push(user.branch, user.department);
  }

  query += ' ORDER BY u.branch, u.department, u.name';
  const stmt = db.prepare(query);
  const result = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
  return c.json({ leaves: result.results });
});

// ───── 본인 연차 (잔여일 + 환급 계산 포함) ─────
leave.get('/me', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  const leaveInfo = await db.prepare('SELECT * FROM annual_leave WHERE user_id = ?').bind(user.sub).first<any>();
  const userInfo = await db.prepare('SELECT hire_date, created_at FROM users WHERE id = ?').bind(user.sub).first<any>();
  const accounting = await db.prepare('SELECT salary FROM user_accounting WHERE user_id = ?').bind(user.sub).first<any>();

  const hireDate = userInfo?.hire_date || userInfo?.created_at || '';
  const entitlement = calculateLeaveEntitlement(hireDate);
  const salary = accounting?.salary || 0;

  const data = leaveInfo || {
    total_days: entitlement.totalAnnual,
    used_days: 0,
    monthly_days: entitlement.totalMonthly,
    monthly_used: 0,
    leave_type: entitlement.type,
  };

  // 잔여일 계산
  const annualRemaining = (data.total_days || 0) - (data.used_days || 0);
  const monthlyRemaining = (data.monthly_days || 0) - (data.monthly_used || 0);
  const totalRemaining = annualRemaining + monthlyRemaining;

  // 환급금 계산
  const refundAmount = calculateRefund(salary, totalRemaining);

  // 연차촉진 알림 확인 (입사 6개월)
  const months = getMonthsSinceHire(hireDate);
  const promotionAlert = months >= 6 && months < 12;

  return c.json({
    leave: {
      ...data,
      hire_date: hireDate,
      months_since_hire: months,
      annual_remaining: annualRemaining,
      monthly_remaining: monthlyRemaining,
      total_remaining: totalRemaining,
      salary,
      refund_amount: refundAmount,
      entitlement,
      promotion_alert: promotionAlert,
    },
  });
});

// ───── 특정 유저 연차 조회 (관리자+) ─────
leave.get('/user/:userId', requireRole('master', 'ceo', 'admin', 'accountant', 'accountant_asst'), async (c) => {
  const userId = c.req.param('userId');
  const db = c.env.DB;

  const leaveInfo = await db.prepare('SELECT * FROM annual_leave WHERE user_id = ?').bind(userId).first<any>();
  const userInfo = await db.prepare('SELECT hire_date, created_at, name FROM users WHERE id = ?').bind(userId).first<any>();
  const accounting = await db.prepare('SELECT salary FROM user_accounting WHERE user_id = ?').bind(userId).first<any>();

  if (!userInfo) return c.json({ error: '사용자를 찾을 수 없습니다.' }, 404);

  const hireDate = userInfo?.hire_date || userInfo?.created_at || '';
  const entitlement = calculateLeaveEntitlement(hireDate);
  const salary = accounting?.salary || 0;

  const data = leaveInfo || {
    total_days: entitlement.totalAnnual,
    used_days: 0,
    monthly_days: entitlement.totalMonthly,
    monthly_used: 0,
    leave_type: entitlement.type,
  };

  const annualRemaining = (data.total_days || 0) - (data.used_days || 0);
  const monthlyRemaining = (data.monthly_days || 0) - (data.monthly_used || 0);
  const totalRemaining = annualRemaining + monthlyRemaining;
  const refundAmount = calculateRefund(salary, totalRemaining);
  const months = getMonthsSinceHire(hireDate);
  const promotionAlert = months >= 6 && months < 12;

  return c.json({
    leave: {
      ...data,
      hire_date: hireDate,
      months_since_hire: months,
      annual_remaining: annualRemaining,
      monthly_remaining: monthlyRemaining,
      total_remaining: totalRemaining,
      salary,
      refund_amount: refundAmount,
      entitlement,
      promotion_alert: promotionAlert,
    },
  });
});

// ───── 연차 초기화 (관리자+) ─────
leave.post('/init', requireRole('master', 'ceo', 'admin'), async (c) => {
  const { user_id, total_days } = await c.req.json<{ user_id: string; total_days: number }>();
  const db = c.env.DB;

  const existing = await db.prepare('SELECT id FROM annual_leave WHERE user_id = ?').bind(user_id).first();
  if (existing) {
    await db.prepare("UPDATE annual_leave SET total_days = ?, updated_at = datetime('now') WHERE user_id = ?")
      .bind(total_days, user_id).run();
  } else {
    await db.prepare('INSERT INTO annual_leave (id, user_id, total_days, used_days) VALUES (?, ?, ?, 0)')
      .bind(crypto.randomUUID(), user_id, total_days).run();
  }
  return c.json({ success: true });
});

// ───── 연차 수정 (관리자+) ─────
leave.put('/:userId', requireRole('master', 'ceo', 'admin'), async (c) => {
  const userId = c.req.param('userId');
  const body = await c.req.json<any>();
  const db = c.env.DB;

  const existing = await db.prepare('SELECT * FROM annual_leave WHERE user_id = ?').bind(userId).first<any>();
  if (!existing) return c.json({ error: '연차 정보가 없습니다.' }, 404);

  await db.prepare(`UPDATE annual_leave SET
    total_days = ?, used_days = ?, monthly_days = ?, monthly_used = ?,
    leave_type = ?, updated_at = datetime('now') WHERE user_id = ?`)
    .bind(
      body.total_days ?? existing.total_days,
      body.used_days ?? existing.used_days,
      body.monthly_days ?? existing.monthly_days ?? 0,
      body.monthly_used ?? existing.monthly_used ?? 0,
      body.leave_type ?? existing.leave_type ?? 'annual',
      userId
    ).run();
  return c.json({ success: true });
});

// ───── 연차 차감 (문서 승인 시 호출) ─────
leave.post('/deduct', requireRole('master', 'ceo', 'admin', 'manager'), async (c) => {
  const { user_id, days } = await c.req.json<{ user_id: string; days: number }>();
  const db = c.env.DB;

  const reqUser = await db.prepare('SELECT hire_date, created_at FROM users WHERE id = ?').bind(user_id).first<any>();
  const hireDate = reqUser?.hire_date || reqUser?.created_at || '';
  const entitlement = calculateLeaveEntitlement(hireDate);

  let existing = await db.prepare('SELECT * FROM annual_leave WHERE user_id = ?').bind(user_id).first<any>();
  if (!existing) {
    await db.prepare(`INSERT INTO annual_leave (id, user_id, total_days, used_days, leave_type, monthly_days, monthly_used) VALUES (?, ?, ?, 0, ?, ?, 0)`)
      .bind(crypto.randomUUID(), user_id, entitlement.totalAnnual, entitlement.type, entitlement.totalMonthly).run();
    existing = { total_days: entitlement.totalAnnual, used_days: 0, monthly_days: entitlement.totalMonthly, monthly_used: 0, leave_type: entitlement.type };
  }

  const leaveType = existing.leave_type || entitlement.type;
  if (leaveType === 'monthly') {
    await db.prepare("UPDATE annual_leave SET monthly_used = monthly_used + ?, updated_at = datetime('now') WHERE user_id = ?")
      .bind(days, user_id).run();
    return c.json({ success: true, used_days: existing.monthly_used + days, remaining: existing.monthly_days - existing.monthly_used - days });
  } else {
    const newUsed = existing.used_days + days;
    await db.prepare("UPDATE annual_leave SET used_days = ?, updated_at = datetime('now') WHERE user_id = ?")
      .bind(newUsed, user_id).run();
    return c.json({ success: true, used_days: newUsed, remaining: existing.total_days - newUsed });
  }
});

// ───── 휴가 신청 ─────
leave.post('/request', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const body = await c.req.json<{
    leave_type: '연차' | '월차' | '반차' | '시간차' | '특별휴가';
    start_date: string;
    end_date: string;
    hours?: number;
    reason: string;
  }>();

  // 차감일수 계산
  let days = 1;
  if (body.leave_type === '반차') {
    days = 0.5;
  } else if (body.leave_type === '시간차') {
    const hours = body.hours || 1;
    days = Math.round((hours / 8) * 1000) / 1000; // 1/8 단위
  } else if (body.leave_type === '특별휴가') {
    // 특별휴가: 시작~종료일 기준
    const start = new Date(body.start_date);
    const end = new Date(body.end_date);
    days = Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
  } else if (body.leave_type === '연차' || body.leave_type === '월차') {
    const start = new Date(body.start_date);
    const end = new Date(body.end_date);
    days = Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
  }

  // 특별휴가는 연차 차감 안 함 → 잔여 확인 불필요
  if (body.leave_type === '특별휴가') {
    const id = crypto.randomUUID();
    await db.prepare(`INSERT INTO leave_requests
      (id, user_id, leave_type, start_date, end_date, hours, days, reason, branch, department)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, user.sub, body.leave_type, body.start_date, body.end_date,
        body.hours || 8, days, body.reason || '', user.branch, user.department).run();
    return c.json({ success: true, id });
  }

  // 잔여 연차 확인
  const leaveInfo = await db.prepare('SELECT * FROM annual_leave WHERE user_id = ?').bind(user.sub).first<any>();
  if (leaveInfo) {
    const isMonthly = body.leave_type === '월차';
    if (isMonthly) {
      const remaining = (leaveInfo.monthly_days || 0) - (leaveInfo.monthly_used || 0);
      if (remaining < days) return c.json({ error: `월차 잔여일이 부족합니다. (잔여: ${remaining}일)` }, 400);
    } else {
      const remaining = leaveInfo.total_days - leaveInfo.used_days;
      if (remaining < days) return c.json({ error: `연차 잔여일이 부족합니다. (잔여: ${remaining}일)` }, 400);
    }
  }

  const id = crypto.randomUUID();
  await db.prepare(`INSERT INTO leave_requests
    (id, user_id, leave_type, start_date, end_date, hours, days, reason, branch, department)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, user.sub, body.leave_type, body.start_date, body.end_date,
      body.hours || 8, days, body.reason, user.branch, user.department).run();

  // 알림톡: 관리자/총무에게 LEAVE_REQUEST
  const admins = await db.prepare(
    "SELECT phone FROM users WHERE role IN ('master', 'ceo', 'admin', 'accountant') AND approved = 1 AND phone != ''"
  ).all<{ phone: string }>();
  const phones = (admins.results || []).map(r => r.phone).filter(Boolean);
  if (phones.length > 0) {
    c.executionCtx.waitUntil(sendAlimtalkByTemplate(
      c.env as unknown as Record<string, unknown>, 'LEAVE_REQUEST',
      { user_name: user.name, leave_type: body.leave_type, start_date: body.start_date, end_date: body.end_date, branch: user.branch || '', link: `${APP_URL}/leave` },
      phones,
    ).catch(() => {}));
  }

  return c.json({ success: true, id });
});

// ───── 휴가 신청 목록 (본인 or 관리자) ─────
leave.get('/requests', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const status = c.req.query('status') || '';
  const month = c.req.query('month') || '';
  const filterUserId = c.req.query('user_id') || '';

  const isAdmin = ['master', 'ceo', 'cc_ref', 'admin', 'manager', 'accountant'].includes(user.role);

  let query = `SELECT lr.*, u.name as user_name FROM leave_requests lr
    LEFT JOIN users u ON lr.user_id = u.id WHERE 1=1`;
  const params: any[] = [];

  // 특정 유저 필터 (관리자+ 전용)
  if (filterUserId && isAdmin) {
    query += ' AND lr.user_id = ?';
    params.push(filterUserId);
  } else if (!isAdmin) {
    query += ' AND lr.user_id = ?';
    params.push(user.sub);
  } else if (user.role === 'manager') {
    query += ' AND lr.branch = ? AND lr.department = ?';
    params.push(user.branch, user.department);
  } else if (user.role === 'admin' && user.branch !== '의정부') {
    query += ' AND lr.branch = ?';
    params.push(user.branch);
  }

  if (status) {
    query += ' AND lr.status = ?';
    params.push(status);
  }
  if (month) {
    query += ' AND lr.start_date LIKE ?';
    params.push(month + '%');
  }

  query += ' ORDER BY lr.created_at DESC';
  const stmt = db.prepare(query);
  const result = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
  return c.json({ requests: result.results });
});

// ───── 휴가 승인/반려 (관리자+) ─────
leave.post('/requests/:id/approve', requireRole('master', 'ceo', 'admin', 'manager'), async (c) => {
  const requestId = c.req.param('id');
  const user = c.get('user');
  const db = c.env.DB;

  const req = await db.prepare('SELECT * FROM leave_requests WHERE id = ?').bind(requestId).first<any>();
  if (!req) return c.json({ error: '신청을 찾을 수 없습니다.' }, 404);
  if (req.status !== 'pending') return c.json({ error: '이미 처리된 신청입니다.' }, 400);

  // 승인 처리
  await db.prepare(`UPDATE leave_requests SET status = 'approved', approved_by = ?,
    approved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
    .bind(user.sub, requestId).run();

  // 특별휴가는 연차 차감 없음
  if (req.leave_type !== '특별휴가') {
    // 입사일 기반 월차/연차 판별
    const reqUser = await db.prepare('SELECT hire_date, created_at FROM users WHERE id = ?').bind(req.user_id).first<any>();
    const hireDate = reqUser?.hire_date || reqUser?.created_at || '';
    const entitlement = calculateLeaveEntitlement(hireDate);

    let existing = await db.prepare('SELECT * FROM annual_leave WHERE user_id = ?').bind(req.user_id).first<any>();
    if (!existing) {
      await db.prepare(`INSERT INTO annual_leave (id, user_id, total_days, used_days, leave_type, monthly_days, monthly_used) VALUES (?, ?, ?, 0, ?, ?, 0)`)
        .bind(crypto.randomUUID(), req.user_id, entitlement.totalAnnual, entitlement.type, entitlement.totalMonthly).run();
      existing = { total_days: entitlement.totalAnnual, used_days: 0, monthly_days: entitlement.totalMonthly, monthly_used: 0, leave_type: entitlement.type };
    }

    const leaveType = existing.leave_type || entitlement.type;
    if (leaveType === 'monthly') {
      // 월차 타입 → monthly_used에서 차감 (연차, 반차, 시간차, 월차 모두)
      await db.prepare("UPDATE annual_leave SET monthly_used = monthly_used + ?, updated_at = datetime('now') WHERE user_id = ?")
        .bind(req.days, req.user_id).run();
    } else {
      // 연차 타입
      if (req.leave_type === '월차') {
        await db.prepare("UPDATE annual_leave SET monthly_used = monthly_used + ?, updated_at = datetime('now') WHERE user_id = ?")
          .bind(req.days, req.user_id).run();
      } else {
        await db.prepare("UPDATE annual_leave SET used_days = used_days + ?, updated_at = datetime('now') WHERE user_id = ?")
          .bind(req.days, req.user_id).run();
      }
    }
  }

  // 알림톡: 신청자에게 LEAVE_APPROVED
  const reqUser2 = await db.prepare('SELECT name, phone FROM users WHERE id = ?').bind(req.user_id).first<{ name: string; phone: string }>();
  if (reqUser2?.phone) {
    c.executionCtx.waitUntil(sendAlimtalkByTemplate(
      c.env as unknown as Record<string, unknown>, 'LEAVE_APPROVED',
      { user_name: reqUser2.name, status: '승인', leave_type: req.leave_type, start_date: req.start_date, end_date: req.end_date, approver_name: user.name, link: `${APP_URL}/leave` },
      [reqUser2.phone],
    ).catch(() => {}));
  }

  return c.json({ success: true });
});

leave.post('/requests/:id/reject', requireRole('master', 'ceo', 'admin', 'manager'), async (c) => {
  const requestId = c.req.param('id');
  const user = c.get('user');
  const db = c.env.DB;
  const { reason } = await c.req.json<{ reason: string }>();

  const req = await db.prepare('SELECT * FROM leave_requests WHERE id = ?').bind(requestId).first<any>();
  if (!req) return c.json({ error: '신청을 찾을 수 없습니다.' }, 404);
  if (req.status !== 'pending') return c.json({ error: '이미 처리된 신청입니다.' }, 400);

  await db.prepare(`UPDATE leave_requests SET status = 'rejected', approved_by = ?,
    reject_reason = ?, approved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
    .bind(user.sub, reason || '', requestId).run();

  // 알림톡: 신청자에게 LEAVE_APPROVED (반려)
  const reqUser = await db.prepare('SELECT name, phone FROM users WHERE id = ?').bind(req.user_id).first<{ name: string; phone: string }>();
  if (reqUser?.phone) {
    c.executionCtx.waitUntil(sendAlimtalkByTemplate(
      c.env as unknown as Record<string, unknown>, 'LEAVE_APPROVED',
      { user_name: reqUser.name, status: '반려', leave_type: req.leave_type, start_date: req.start_date, end_date: req.end_date, approver_name: user.name, link: `${APP_URL}/leave` },
      [reqUser.phone],
    ).catch(() => {}));
  }

  return c.json({ success: true });
});

// ───── 휴가 취소 (본인) ─────
leave.post('/requests/:id/cancel', async (c) => {
  const requestId = c.req.param('id');
  const user = c.get('user');
  const db = c.env.DB;

  const req = await db.prepare('SELECT * FROM leave_requests WHERE id = ?').bind(requestId).first<any>();
  if (!req) return c.json({ error: '신청을 찾을 수 없습니다.' }, 404);
  if (req.user_id !== user.sub && !['master', 'ceo', 'cc_ref', 'admin', 'manager'].includes(user.role)) {
    return c.json({ error: '본인 신청만 취소할 수 있습니다.' }, 403);
  }
  if (req.status !== 'pending' && req.status !== 'approved') {
    return c.json({ error: '취소할 수 없는 상태입니다.' }, 400);
  }

  if (req.status === 'approved') {
    // 승인된 건 → 관리자만 직접 취소 가능, 일반 유저는 cancel_requested
    if (['master', 'ceo', 'cc_ref', 'admin', 'manager'].includes(user.role)) {
      // 관리자: 즉시 취소 + 연차 복원
      await db.prepare("UPDATE leave_requests SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?")
        .bind(requestId).run();
      // 차감된 연차 복원 (특별휴가 제외)
      if (req.leave_type !== '특별휴가') {
        if (req.leave_type === '월차') {
          await db.prepare("UPDATE annual_leave SET monthly_used = MAX(0, monthly_used - ?), updated_at = datetime('now') WHERE user_id = ?")
            .bind(req.days, req.user_id).run();
        } else {
          await db.prepare("UPDATE annual_leave SET used_days = MAX(0, used_days - ?), updated_at = datetime('now') WHERE user_id = ?")
            .bind(req.days, req.user_id).run();
        }
      }
    } else {
      // 일반 유저: 취소요청 상태로 변경 (관리자 확인 필요)
      await db.prepare("UPDATE leave_requests SET status = 'cancel_requested', updated_at = datetime('now') WHERE id = ?")
        .bind(requestId).run();
    }
  } else {
    // pending → 바로 취소
    await db.prepare("UPDATE leave_requests SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?")
      .bind(requestId).run();
  }

  return c.json({ success: true });
});

// ───── 취소요청 승인 (관리자) ─────
leave.post('/requests/:id/cancel-approve', requireRole('master', 'ceo', 'admin', 'manager'), async (c) => {
  const requestId = c.req.param('id');
  const db = c.env.DB;

  const req = await db.prepare('SELECT * FROM leave_requests WHERE id = ?').bind(requestId).first<any>();
  if (!req) return c.json({ error: '신청을 찾을 수 없습니다.' }, 404);
  if (req.status !== 'cancel_requested') return c.json({ error: '취소요청 상태가 아닙니다.' }, 400);

  await db.prepare("UPDATE leave_requests SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?")
    .bind(requestId).run();

  // 차감된 연차 복원
  if (req.leave_type !== '특별휴가') {
    if (req.leave_type === '월차') {
      await db.prepare("UPDATE annual_leave SET monthly_used = MAX(0, monthly_used - ?), updated_at = datetime('now') WHERE user_id = ?")
        .bind(req.days, req.user_id).run();
    } else {
      await db.prepare("UPDATE annual_leave SET used_days = MAX(0, used_days - ?), updated_at = datetime('now') WHERE user_id = ?")
        .bind(req.days, req.user_id).run();
    }
  }

  return c.json({ success: true });
});

// ───── 환급 계산 (관리자+) ─────
leave.get('/refund/:userId', requireRole('master', 'ceo', 'admin', 'accountant', 'accountant_asst'), async (c) => {
  const userId = c.req.param('userId');
  const db = c.env.DB;

  const leaveInfo = await db.prepare('SELECT * FROM annual_leave WHERE user_id = ?').bind(userId).first<any>();
  const accounting = await db.prepare('SELECT salary FROM user_accounting WHERE user_id = ?').bind(userId).first<any>();
  const userInfo = await db.prepare('SELECT name, hire_date, created_at FROM users WHERE id = ?').bind(userId).first<any>();

  if (!leaveInfo || !accounting) return c.json({ error: '정보가 부족합니다.' }, 404);

  const totalRemaining = (leaveInfo.total_days - leaveInfo.used_days) +
    ((leaveInfo.monthly_days || 0) - (leaveInfo.monthly_used || 0));
  const refund = calculateRefund(accounting.salary, totalRemaining);

  return c.json({
    user_name: userInfo?.name,
    salary: accounting.salary,
    remaining_days: totalRemaining,
    refund_per_day: Math.round((accounting.salary / 209) * 8),
    refund_total: refund,
  });
});

// ───── 연차촉진 알림 목록 (대시보드용) ─────
leave.get('/alerts', requireRole('master', 'ceo', 'admin', 'manager'), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');

  // 입사 6개월 도래 직원 찾기
  let query = `SELECT u.id, u.name, u.branch, u.department, u.hire_date, u.created_at,
    al.total_days, al.used_days, al.monthly_days, al.monthly_used
    FROM users u LEFT JOIN annual_leave al ON u.id = al.user_id
    WHERE u.approved = 1 AND u.hire_date != ''`;
  const params: string[] = [];

  if (user.role === 'manager') {
    query += ' AND u.branch = ? AND u.department = ?';
    params.push(user.branch, user.department);
  } else if (user.role === 'admin' && user.branch !== '의정부') {
    query += ' AND u.branch = ?';
    params.push(user.branch);
  }

  const stmt = db.prepare(query);
  const result = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();

  const alerts = (result.results as any[]).filter(u => {
    const months = getMonthsSinceHire(u.hire_date || u.created_at);
    return months >= 5 && months <= 7; // 5~7개월 (촉진 대상 기간)
  }).map(u => ({
    ...u,
    months_since_hire: getMonthsSinceHire(u.hire_date || u.created_at),
  }));

  return c.json({ alerts });
});

// ───── 입사일 설정 (관리자+) ─────
leave.put('/hire-date/:userId', requireRole('master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst'), async (c) => {
  const userId = c.req.param('userId');
  const { hire_date } = await c.req.json<{ hire_date: string }>();
  const db = c.env.DB;

  await db.prepare("UPDATE users SET hire_date = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(hire_date, userId).run();

  // 입사일 기준으로 연차 자동 재계산
  const entitlement = calculateLeaveEntitlement(hire_date);
  const existing = await db.prepare('SELECT id FROM annual_leave WHERE user_id = ?').bind(userId).first();

  if (existing) {
    await db.prepare(`UPDATE annual_leave SET total_days = ?, monthly_days = ?,
      leave_type = ?, updated_at = datetime('now') WHERE user_id = ?`)
      .bind(entitlement.totalAnnual, entitlement.totalMonthly, entitlement.type, userId).run();
  } else {
    await db.prepare(`INSERT INTO annual_leave
      (id, user_id, total_days, used_days, monthly_days, monthly_used, leave_type)
      VALUES (?, ?, ?, 0, ?, 0, ?)`)
      .bind(crypto.randomUUID(), userId, entitlement.totalAnnual, entitlement.totalMonthly, entitlement.type).run();
  }

  return c.json({ success: true, entitlement });
});

// ───── 휴가 신청 삭제 (마스터 전용) ─────
leave.delete('/requests/:id', requireRole('master'), async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;

  const req = await db.prepare('SELECT * FROM leave_requests WHERE id = ?').bind(id).first<any>();
  if (!req) return c.json({ error: '신청을 찾을 수 없습니다.' }, 404);

  // 승인된 건이면 차감된 연차 복원
  if (req.status === 'approved' && req.leave_type !== '특별휴가') {
    if (req.leave_type === '월차') {
      await db.prepare("UPDATE annual_leave SET monthly_used = MAX(0, monthly_used - ?), updated_at = datetime('now') WHERE user_id = ?")
        .bind(req.days, req.user_id).run();
    } else {
      await db.prepare("UPDATE annual_leave SET used_days = MAX(0, used_days - ?), updated_at = datetime('now') WHERE user_id = ?")
        .bind(req.days, req.user_id).run();
    }
  }

  await db.prepare('DELETE FROM leave_requests WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

// ───── 총무 휴가 알림 (대시보드) ─────
// GET /api/leave/accountant-leaves — 현재~향후 7일 내 총무 휴가 조회
leave.get('/accountant-leaves', async (c) => {
  const db = c.env.DB;
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000); // KST
  // 하루 전부터 공지
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  // 7일 후
  const future = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const result = await db.prepare(`
    SELECT lr.id, lr.user_id, lr.leave_type, lr.start_date, lr.end_date, lr.days, lr.reason,
      u.name, u.branch, u.department, u.position_title
    FROM leave_requests lr
    JOIN users u ON u.id = lr.user_id
    WHERE u.role IN ('accountant', 'accountant_asst')
      AND lr.status = 'approved'
      AND lr.end_date >= ?
      AND lr.start_date <= ?
    ORDER BY lr.start_date ASC
  `).bind(yesterday, future).all();

  return c.json({ leaves: result.results || [] });
});

export default leave;
