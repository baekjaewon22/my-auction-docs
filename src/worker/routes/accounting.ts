import { Hono } from 'hono';
import type { AuthEnv } from '../types';
import { authMiddleware, requireRole } from '../middleware/auth';

const accounting = new Hono<AuthEnv>();
accounting.use('*', authMiddleware);

// 총무 역할 체크 헬퍼
const ACCOUNTING_ROLES = ['master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst'] as const;

// GET /api/accounting - 전체 직원 회계 정보 목록
accounting.get('/', requireRole(...ACCOUNTING_ROLES), async (c) => {
  const db = c.env.DB;
  const result = await db.prepare(`
    SELECT ua.*, u.name as user_name, u.branch, u.department, u.role, u.position_title
    FROM user_accounting ua
    JOIN users u ON u.id = ua.user_id
    WHERE u.approved = 1
    ORDER BY u.name ASC
  `).all();
  return c.json({ accounts: result.results });
});

// GET /api/accounting/:userId - 특정 직원 회계 정보
accounting.get('/:userId', requireRole(...ACCOUNTING_ROLES), async (c) => {
  const userId = c.req.param('userId');
  const db = c.env.DB;

  const account = await db.prepare(`
    SELECT ua.*, u.name as user_name, u.branch, u.department, u.role, u.position_title
    FROM user_accounting ua
    JOIN users u ON u.id = ua.user_id
    WHERE ua.user_id = ?
  `).bind(userId).first();

  return c.json({ account: account || null });
});

// PUT /api/accounting/:userId - 직원 회계 정보 생성/수정 (급여, 직급)
accounting.put('/:userId', requireRole('master', 'ceo', 'cc_ref', 'admin', 'accountant'), async (c) => {
  const userId = c.req.param('userId');
  const { salary, grade, position_allowance } = await c.req.json<{ salary?: number; grade?: string; position_allowance?: number }>();
  const db = c.env.DB;

  // 사용자 존재 확인
  const user = await db.prepare('SELECT id FROM users WHERE id = ? AND approved = 1').bind(userId).first();
  if (!user) return c.json({ error: '사용자를 찾을 수 없습니다.' }, 404);

  // 직급 유효성 검사
  if (grade !== undefined && !['', 'M1', 'M2', 'M3', 'M4'].includes(grade)) {
    return c.json({ error: '유효하지 않은 직급입니다.' }, 400);
  }

  const existing = await db.prepare('SELECT * FROM user_accounting WHERE user_id = ?').bind(userId).first();

  const newSalary = salary !== undefined ? salary : (existing as any)?.salary || 0;
  const newGrade = grade !== undefined ? grade : (existing as any)?.grade || '';
  const newAllowance = position_allowance !== undefined ? position_allowance : (existing as any)?.position_allowance || 0;
  const standardSales = Math.round(newSalary * 1.3 * 4);

  if (existing) {
    await db.prepare(`
      UPDATE user_accounting SET salary = ?, standard_sales = ?, grade = ?, position_allowance = ?, updated_at = datetime('now')
      WHERE user_id = ?
    `).bind(newSalary, standardSales, newGrade, newAllowance, userId).run();
  } else {
    const id = crypto.randomUUID();
    await db.prepare(`
      INSERT INTO user_accounting (id, user_id, salary, standard_sales, grade, position_allowance)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(id, userId, newSalary, standardSales, newGrade, newAllowance).run();
  }

  return c.json({ success: true, salary: newSalary, standard_sales: standardSales, grade: newGrade, position_allowance: newAllowance });
});

// PUT /api/accounting/:userId/grade - 직급 강등 (관리자급 이상만)
accounting.put('/:userId/grade', requireRole('master', 'ceo', 'cc_ref', 'admin', 'accountant'), async (c) => {
  const userId = c.req.param('userId');
  const { grade } = await c.req.json<{ grade: string }>();
  const db = c.env.DB;

  if (!['M1', 'M2', 'M3', 'M4'].includes(grade)) {
    return c.json({ error: '유효하지 않은 직급입니다.' }, 400);
  }

  const existing = await db.prepare('SELECT * FROM user_accounting WHERE user_id = ?').bind(userId).first();
  if (!existing) return c.json({ error: '회계 정보가 없습니다.' }, 404);

  await db.prepare(`
    UPDATE user_accounting SET grade = ?, updated_at = datetime('now') WHERE user_id = ?
  `).bind(grade, userId).run();

  return c.json({ success: true });
});

// GET /api/accounting/evaluations/:userId - 특정 직원의 매출 평가 이력
accounting.get('/evaluations/:userId', requireRole(...ACCOUNTING_ROLES), async (c) => {
  const userId = c.req.param('userId');
  const db = c.env.DB;

  const result = await db.prepare(`
    SELECT * FROM sales_evaluations WHERE user_id = ? ORDER BY period_start DESC
  `).bind(userId).all();

  return c.json({ evaluations: result.results });
});

// POST /api/accounting/evaluate - 2개월 단위 매출 평가 실행
// 현재 기간의 commissions 합산 → 기준매출 비교 → 결과 저장
accounting.post('/evaluate', requireRole('master', 'ceo', 'cc_ref', 'admin', 'accountant'), async (c) => {
  const { period_start, period_end } = await c.req.json<{ period_start: string; period_end: string }>();
  const db = c.env.DB;

  if (!period_start || !period_end) {
    return c.json({ error: '평가 기간을 지정해주세요.' }, 400);
  }

  // 회계 정보가 있는 모든 직원 조회
  const accounts = await db.prepare('SELECT * FROM user_accounting WHERE salary > 0').all();
  const results: any[] = [];

  for (const acc of accounts.results as any[]) {
    // 해당 기간의 완료된 수수료(매출) 합산
    const salesResult = await db.prepare(`
      SELECT COALESCE(SUM(CAST(REPLACE(REPLACE(win_price, ',', ''), '원', '') AS INTEGER)), 0) as total
      FROM commissions
      WHERE user_id = ? AND status = 'completed'
        AND created_at >= ? AND created_at <= ?
    `).bind(acc.user_id, period_start, period_end + ' 23:59:59').first<{ total: number }>();

    const totalSales = salesResult?.total || 0;
    const metTarget = totalSales >= acc.standard_sales ? 1 : 0;

    // 이전 평가에서 연속 미달 횟수 조회
    const prevEval = await db.prepare(`
      SELECT consecutive_misses FROM sales_evaluations
      WHERE user_id = ? AND period_start < ?
      ORDER BY period_start DESC LIMIT 1
    `).bind(acc.user_id, period_start).first<{ consecutive_misses: number }>();

    const prevMisses = prevEval?.consecutive_misses || 0;
    const consecutiveMisses = metTarget ? 0 : prevMisses + 1;

    // 기존 평가가 있으면 업데이트, 없으면 삽입
    const existing = await db.prepare(
      'SELECT id FROM sales_evaluations WHERE user_id = ? AND period_start = ?'
    ).bind(acc.user_id, period_start).first();

    if (existing) {
      await db.prepare(`
        UPDATE sales_evaluations SET total_sales = ?, met_target = ?, consecutive_misses = ?, updated_at = datetime('now')
        WHERE user_id = ? AND period_start = ?
      `).bind(totalSales, metTarget, consecutiveMisses, acc.user_id, period_start).run();
    } else {
      const id = crypto.randomUUID();
      await db.prepare(`
        INSERT INTO sales_evaluations (id, user_id, period_start, period_end, standard_sales, total_sales, met_target, consecutive_misses)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(id, acc.user_id, period_start, period_end, acc.standard_sales, totalSales, metTarget, consecutiveMisses).run();
    }

    results.push({
      user_id: acc.user_id,
      standard_sales: acc.standard_sales,
      total_sales: totalSales,
      met_target: metTarget,
      consecutive_misses: consecutiveMisses,
    });
  }

  return c.json({ success: true, results });
});

// GET /api/accounting/alerts - 대시보드용 경고 목록 (미달 + 강등 대상)
accounting.get('/alerts/dashboard', requireRole(...ACCOUNTING_ROLES), async (c) => {
  const db = c.env.DB;

  // 현재 기준 평가 기간 계산 (2개월 단위: 1-2월, 3-4월, 5-6월 ...)
  const now = new Date();
  const month = now.getMonth() + 1; // 1-12
  const year = now.getFullYear();
  // 현재 속한 2개월 구간
  const periodMonth = month % 2 === 0 ? month - 1 : month;
  const periodStart = `${year}-${String(periodMonth).padStart(2, '0')}-01`;
  const periodEndMonth = periodMonth + 1;
  const periodEndYear = periodEndMonth > 12 ? year + 1 : year;
  const actualEndMonth = periodEndMonth > 12 ? 1 : periodEndMonth;
  // 해당 월의 마지막 날
  const lastDay = new Date(periodEndYear, actualEndMonth, 0).getDate();
  const periodEnd = `${periodEndYear}-${String(actualEndMonth).padStart(2, '0')}-${lastDay}`;

  // 최근 평가에서 미달인 직원들
  const alerts = await db.prepare(`
    SELECT se.*, ua.salary, ua.grade, u.name as user_name, u.branch, u.department
    FROM sales_evaluations se
    JOIN user_accounting ua ON ua.user_id = se.user_id
    JOIN users u ON u.id = se.user_id
    WHERE se.met_target = 0
    ORDER BY se.consecutive_misses DESC, se.period_start DESC
  `).all();

  // 강등 대상 (3회 연속 미달)
  const demotionCandidates = (alerts.results as any[]).filter((a: any) => a.consecutive_misses >= 3);

  // 현재 기간 미달 경고
  const currentPeriodAlerts = (alerts.results as any[]).filter((a: any) =>
    a.period_start >= periodStart && a.period_end <= periodEnd
  );

  return c.json({
    alerts: alerts.results,
    demotion_candidates: demotionCandidates,
    current_period_alerts: currentPeriodAlerts,
    current_period: { start: periodStart, end: periodEnd },
  });
});

export default accounting;
