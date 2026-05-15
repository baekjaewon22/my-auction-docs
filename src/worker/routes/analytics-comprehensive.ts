// 종합분석 — 개인별 360° KPI 대시보드
// - 정직원: standard_sales(1인분) 대비 달성률
// - 프리랜서: 전 지사 비율제 평균 대비 % + 매출 추이
// - 자동 성향 태그 + 강점/약점 진단

import { Hono } from 'hono';
import type { AuthEnv } from '../types';
import { authMiddleware, requireRole } from '../middleware/auth';

const comprehensive = new Hono<AuthEnv>();
comprehensive.use('*', authMiddleware);

// 백필/수동 갱신 엔드포인트 (master·ceo·accountant만)
comprehensive.post('/backfill', requireRole('master', 'ceo', 'accountant'), async (c) => {
  const env = c.env as any;
  const months = Math.min(60, Math.max(1, parseInt(c.req.query('months') || '24', 10)));
  const { backfillHistory } = await import('../analytics-cron');
  const result = await backfillHistory(env, months);
  return c.json({ success: true, ...result });
});

comprehensive.post('/run-daily', requireRole('master', 'ceo', 'accountant'), async (c) => {
  const env = c.env as any;
  const { runDailyAggregation } = await import('../analytics-cron');
  const result = await runDailyAggregation(env);
  return c.json({ success: true, ...result });
});

comprehensive.post('/run-monthly', requireRole('master', 'ceo', 'accountant'), async (c) => {
  const env = c.env as any;
  const { runMonthlyAggregation } = await import('../analytics-cron');
  const result = await runMonthlyAggregation(env);
  return c.json({ success: true, ...result });
});

// ───────────────────────────────────────
// 점수 계산 — 직군별 가중치
// 정직원: 매출35 / 전환20 / 활동15 / 출근15 / 안정10 / 이상-5
// 프리랜서: 매출25 / 전환25 / 활동20 / 출근15 / 성장15
// ───────────────────────────────────────
type ScoreInput = {
  isFreelancer: boolean;
  targetRate: number;        // 정직원: standard 대비 / 프리랜서: 비율제 평균 대비
  bidWinRate: number;        // 입찰→낙찰률 (0~100)
  activityIndex: number;     // 본인 활동수 / 조직 평균 × 100
  journalRate: number;       // 평일 일지 작성률 (0~100)
  refundRate: number;        // 환불률 (0~100)
  anomalyCount: number;      // 30일 미입찰 + 5% 편차 등 합계
  growthRate: number;        // 매출 MoM 변화율 (%) — 프리랜서용
};

function calculateScore(input: ScoreInput) {
  const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
  const targetScore100 = clamp(input.targetRate, 0, 150) / 1.5;       // 150% → 100점

  if (input.isFreelancer) {
    const breakdown = {
      매출: Math.round((targetScore100 / 100) * 25),
      전환: Math.round((clamp(input.bidWinRate) / 100) * 25),
      활동: Math.round((clamp(input.activityIndex, 0, 150) / 150) * 20),
      출근: Math.round((clamp(input.journalRate) / 100) * 15),
      성장: Math.round((clamp(input.growthRate + 50, 0, 100) / 100) * 15),
    };
    const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
    return { total, breakdown, grade: gradeOf(total) };
  } else {
    const stability = clamp(100 - input.refundRate);
    const anomalyPenalty = Math.min(5, input.anomalyCount);
    const breakdown = {
      매출: Math.round((targetScore100 / 100) * 35),
      전환: Math.round((clamp(input.bidWinRate) / 100) * 20),
      활동: Math.round((clamp(input.activityIndex, 0, 150) / 150) * 15),
      출근: Math.round((clamp(input.journalRate) / 100) * 15),
      안정: Math.round((stability / 100) * 10),
      이상: -anomalyPenalty,
    };
    const total = Math.max(0, Object.values(breakdown).reduce((a, b) => a + b, 0));
    return { total, breakdown, grade: gradeOf(total) };
  }
}

function gradeOf(score: number): string {
  if (score >= 90) return 'S';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  if (score >= 60) return 'C';
  return 'D';
}

// ───────────────────────────────────────
// 자동 성향 태그 — enum 키로 반환 (프론트에서 lucide 아이콘 매핑)
// ───────────────────────────────────────
type TagKey =
  | 'champion' | 'stable' | 'underperform'
  | 'active' | 'efficient' | 'inactive'
  | 'precise' | 'deviated'
  | 'safe' | 'refunded'
  | 'punctual' | 'absent'
  | 'new' | 'growing';

function generateTags(m: any, isFreelancer: boolean, hireMonths: number): TagKey[] {
  const tags: TagKey[] = [];
  const targetRate = m.targetRate || 0;
  if (targetRate >= 120) tags.push('champion');
  else if (targetRate >= 90) tags.push('stable');
  else if (targetRate < 90 && hireMonths >= 3) tags.push('underperform');

  if (m.activityIndex >= 130) tags.push('active');
  else if (m.activityIndex < 70) tags.push('inactive');
  else if (m.bidWinRate >= 70) tags.push('efficient');

  if (m.deviationCount === 0 && m.bidCount > 0) tags.push('precise');
  else if (m.deviationCount >= 3) tags.push('deviated');

  if (m.refundCount === 0 && m.salesCount > 0 && !isFreelancer) tags.push('safe');
  else if (m.refundCount > 0) tags.push('refunded');

  // 출근 태그 — 프리랜서 제외 (일지 작성 의무 없음)
  if (!isFreelancer) {
    if (m.journalRate >= 95) tags.push('punctual');
    else if (m.journalRate < 70) tags.push('absent');
  }

  if (hireMonths < 3) tags.push('new');
  if (isFreelancer && m.growthRate >= 20) tags.push('growing');
  return tags;
}

// ───────────────────────────────────────
// 강점/약점 자동 진단
// ───────────────────────────────────────
function generateDiagnosis(m: any, breakdown: any, maxByKey: Record<string, number>, isFreelancer: boolean): { strengths: string[]; weaknesses: string[] } {
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  if (m.targetRate >= 110) strengths.push(`매출 ${m.targetRate.toFixed(0)}% 달성 — 우수`);
  if (m.bidWinRate >= 70) strengths.push(`입찰→낙찰 전환율 ${m.bidWinRate.toFixed(0)}%로 우수`);
  if (m.deviationCount === 0 && m.bidCount > 0) strengths.push('5% 편차 없음 — 입찰 정확도 우수');
  if (m.refundCount === 0 && m.salesCount > 0) strengths.push('환불 0건 — 사후관리 우수');
  if (!isFreelancer && m.journalRate >= 95) strengths.push('일지 작성률 95% 이상 — 성실');

  if (m.targetRate < 80) weaknesses.push(`매출 ${m.targetRate.toFixed(0)}% — 1인분 미달`);
  if (m.bidWinRate < 30 && m.bidCount > 0) weaknesses.push(`입찰→낙찰 ${m.bidWinRate.toFixed(0)}% — 낮음`);
  if (m.activityIndex < 70) weaknesses.push('활동량 평균 이하 — 임장/입찰 늘리기 권장');
  if (m.refundCount > 0) weaknesses.push(`환불 ${m.refundCount}건 — 사후관리 강화 필요`);
  if (!isFreelancer && m.journalRate < 70) weaknesses.push('일지 작성률 70% 미만 — 활동 기록 점검');
  if (m.deviationCount >= 3) weaknesses.push(`5% 편차 ${m.deviationCount}건 — 정확도 개선`);

  // breakdown 상대값 기반 fallback
  if (strengths.length === 0) {
    const best = Object.entries(breakdown).filter(([k]) => k !== '이상').sort((a, b) => (b[1] as number) / (maxByKey[b[0]] || 1) - (a[1] as number) / (maxByKey[a[0]] || 1))[0];
    if (best) strengths.push(`${best[0]} 영역이 상대적으로 양호`);
  }
  if (weaknesses.length === 0) strengths.push('전반적으로 균형 잡힌 성과');
  return { strengths: strengths.slice(0, 3), weaknesses: weaknesses.slice(0, 3) };
}

// ───────────────────────────────────────
// 메인 엔드포인트
// ───────────────────────────────────────
comprehensive.get('/', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const branch = c.req.query('branch') || '';
  const department = c.req.query('department') || '';
  const userIdParam = c.req.query('user_id') || '';
  const month = c.req.query('month') || ''; // YYYY-MM
  const monthEnd = c.req.query('month_end') || month;

  // 권한 정책
  const role = user.role;
  const isViewer = ['master', 'ceo', 'cc_ref', 'accountant', 'accountant_asst'].includes(role);
  const isHQAdmin = role === 'admin' && user.branch === '의정부';
  const isDirector = role === 'director';
  const canSeeAll = isViewer || isHQAdmin;
  const canSeeBranch = canSeeAll || (role === 'admin');
  const canSeeTeam = canSeeBranch || role === 'manager';

  // 본인 외 조회 차단 처리
  let scopedUserId = userIdParam;
  if (!canSeeTeam && !scopedUserId) scopedUserId = user.sub; // 일반 직원은 본인만
  if (!canSeeAll && scopedUserId && scopedUserId !== user.sub) {
    // 일반 직원이 다른 사람 조회 시도
    const target = await db.prepare('SELECT branch, department FROM users WHERE id = ?').bind(scopedUserId).first<any>();
    if (!target) return c.json({ error: '대상을 찾을 수 없습니다.' }, 404);
    if (role === 'admin' && target.branch !== user.branch) return c.json({ error: '권한 없음' }, 403);
    if (role === 'manager' && (target.branch !== user.branch || target.department !== user.department)) return c.json({ error: '권한 없음' }, 403);
    if (role === 'director' && !['대전', '부산'].includes(target.branch) && target.id !== user.sub) return c.json({ error: '권한 없음' }, 403);
  }

  // 기간 결정 — month 미지정 시 현재 달
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const periodStart = (month || curMonth) + '-01';
  const periodEndMonth = monthEnd || month || curMonth;
  const [py, pm] = periodEndMonth.split('-').map(Number);
  const lastDayOfEnd = new Date(py, pm, 0).getDate();
  const periodEnd = `${periodEndMonth}-${String(lastDayOfEnd).padStart(2, '0')}`;

  // standard_sales 는 2개월 기준 — 조회 기간(개월)에 맞게 안분
  // 1개월 → /2, 2개월 → ×1, 3개월 → ×1.5 ...
  const [sy, sm] = (month || curMonth).split('-').map(Number);
  const periodMonths = (py - sy) * 12 + (pm - sm) + 1;
  const standardProrationFactor = periodMonths / 2;

  // 1. 멤버 + accounting + org branch 조회
  // 컨설턴트만: 본사관리/명도팀/지원팀/대표/총무/정민호 제외
  const JEONG_MINHO_ID = '2b6b3606-e425-4361-a115-9283cfef842f';
  let memberQuery = `
    SELECT u.id, u.name, u.role, u.branch, u.department, u.position_title,
      u.hire_date, u.created_at, u.login_type,
      COALESCE(ua.salary, 0) as salary,
      COALESCE(ua.standard_sales, 0) as standard_sales,
      COALESCE(ua.grade, '') as grade,
      COALESCE(ua.pay_type, 'salary') as pay_type
    FROM users u
    LEFT JOIN user_accounting ua ON ua.user_id = u.id
    WHERE u.role NOT IN ('master', 'ceo', 'cc_ref', 'accountant', 'accountant_asst', 'support', 'resigned')
      AND u.branch != '본사 관리'
      AND (u.department IS NULL OR u.department NOT IN ('명도팀', '지원팀'))
      AND u.id != ?
      AND u.login_type != 'freelancer-old'
  `;
  const params: any[] = [JEONG_MINHO_ID];
  if (scopedUserId) {
    memberQuery += ' AND u.id = ?';
    params.push(scopedUserId);
  } else {
    if (branch) { memberQuery += ' AND u.branch = ?'; params.push(branch); }
    if (department) { memberQuery += ' AND u.department = ?'; params.push(department); }
    if (isDirector) { memberQuery += " AND (u.branch IN ('대전','부산') OR u.id = ?)"; params.push(user.sub); }
    else if (role === 'admin' && user.branch !== '의정부') { memberQuery += ' AND u.branch = ?'; params.push(user.branch); }
    else if (role === 'manager') { memberQuery += ' AND u.branch = ? AND u.department = ?'; params.push(user.branch, user.department); }
  }
  const membersRes = await db.prepare(memberQuery).bind(...params).all<any>();
  const members = membersRes.results || [];

  if (members.length === 0) {
    return c.json({ members: [], benchmarks: {}, metadata: { period_start: periodStart, period_end: periodEnd, member_count: 0 } });
  }

  // 2. 활동 카운트 (기간 내)
  const activityRes = await db.prepare(`
    SELECT user_id, activity_type, COUNT(*) as cnt
    FROM journal_entries
    WHERE target_date BETWEEN ? AND ?
      AND COALESCE(json_extract(data, '$.companion'), 0) != 1
    GROUP BY user_id, activity_type
  `).bind(periodStart, periodEnd).all<any>();
  const activityMap: Record<string, Record<string, number>> = {};
  (activityRes.results || []).forEach((r: any) => {
    if (!activityMap[r.user_id]) activityMap[r.user_id] = {};
    activityMap[r.user_id][r.activity_type] = r.cnt;
  });

  // 3. 매출 (기간 내)
  const salesRes = await db.prepare(`
    SELECT user_id, status,
      COUNT(*) as cnt,
      SUM(amount) as total
    FROM sales_records
    WHERE contract_date BETWEEN ? AND ?
      AND direction != 'expense'
      AND COALESCE(exclude_from_count, 0) = 0
    GROUP BY user_id, status
  `).bind(periodStart, periodEnd).all<any>();
  const salesMap: Record<string, { confirmed: number; pending: number; refunded: number; confirmed_count: number; refunded_count: number; sales_count: number }> = {};
  (salesRes.results || []).forEach((r: any) => {
    if (!salesMap[r.user_id]) salesMap[r.user_id] = { confirmed: 0, pending: 0, refunded: 0, confirmed_count: 0, refunded_count: 0, sales_count: 0 };
    salesMap[r.user_id].sales_count += r.cnt;
    if (r.status === 'confirmed' || r.status === 'card_pending') {
      salesMap[r.user_id].confirmed += r.total || 0;
      salesMap[r.user_id].confirmed_count += r.cnt;
    } else if (r.status === 'pending') {
      salesMap[r.user_id].pending += r.total || 0;
    } else if (r.status === 'refunded') {
      salesMap[r.user_id].refunded += r.total || 0;
      salesMap[r.user_id].refunded_count += r.cnt;
    }
  });

  // 4. 월별 매출 추이 — user_monthly_stats 캐시에서 12개월 일괄 조회 (cron이 갱신)
  // 진행 중 달은 어제까지 누적 + 오늘 실시간 합산 (cache-and-delta 패턴)
  const trendStart = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const trendStartYM = `${trendStart.getFullYear()}-${String(trendStart.getMonth() + 1).padStart(2, '0')}`;
  const curYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const trendRes = await db.prepare(`
    SELECT user_id, ym, sales_confirmed
    FROM user_monthly_stats
    WHERE ym >= ?
  `).bind(trendStartYM).all<any>();
  const trendMap: Record<string, Record<string, number>> = {};
  (trendRes.results || []).forEach((r: any) => {
    if (!trendMap[r.user_id]) trendMap[r.user_id] = {};
    trendMap[r.user_id][r.ym] = r.sales_confirmed || 0;
  });

  // 캐시가 비어있으면(첫 실행, 백필 전) 원본에서 fallback 집계
  if ((trendRes.results || []).length === 0) {
    const fallback = await db.prepare(`
      SELECT user_id, substr(contract_date, 1, 7) as ym, SUM(amount) as total
      FROM sales_records
      WHERE contract_date >= ?
        AND status IN ('confirmed', 'card_pending')
        AND direction != 'expense'
        AND COALESCE(exclude_from_count, 0) = 0
      GROUP BY user_id, ym
    `).bind(`${trendStartYM}-01`).all<any>();
    (fallback.results || []).forEach((r: any) => {
      if (!trendMap[r.user_id]) trendMap[r.user_id] = {};
      trendMap[r.user_id][r.ym] = r.total || 0;
    });
  } else {
    // 진행 중 달은 오늘분 실시간 delta 합산 — 어제까지는 캐시값, 오늘분은 추가
    const todayKST = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const todayDelta = await db.prepare(`
      SELECT user_id, SUM(amount) as total
      FROM sales_records
      WHERE contract_date = ?
        AND status IN ('confirmed', 'card_pending')
        AND direction != 'expense'
        AND COALESCE(exclude_from_count, 0) = 0
      GROUP BY user_id
    `).bind(todayKST).all<any>();
    (todayDelta.results || []).forEach((r: any) => {
      if (!trendMap[r.user_id]) trendMap[r.user_id] = {};
      // 캐시값(어제까지)에 오늘분 더하기 — 단, cron이 같은 날에 갱신했다면 중복 방지를 위해 max 사용은 위험
      // 안전하게 캐시 기준 그대로 두고 오늘분만 별도 합산 (cron이 보통 자정 직후만 갱신하므로 다른 날 데이터)
      trendMap[r.user_id][curYM] = (trendMap[r.user_id][curYM] || 0) + (r.total || 0);
    });
  }

  // 5. 평가 이력 (sales_evaluations 최근 1건)
  const evalRes = await db.prepare(`
    SELECT user_id, period_start, period_end, standard_sales, total_sales, met_target, consecutive_misses
    FROM sales_evaluations
    ORDER BY period_start DESC
  `).all<any>();
  const evalMap: Record<string, any> = {};
  (evalRes.results || []).forEach((r: any) => {
    if (!evalMap[r.user_id]) evalMap[r.user_id] = r; // 최신만
  });

  // 6. 5% 편차 입찰 수 (이상지표) + 낙찰 수 (입찰→낙찰 전환율 계산)
  const deviationRes = await db.prepare(`
    SELECT user_id, COUNT(*) as cnt
    FROM journal_entries
    WHERE activity_type = '입찰' AND target_date BETWEEN ? AND ?
      AND data LIKE '%deviationReason%'
    GROUP BY user_id
  `).bind(periodStart, periodEnd).all<any>();
  const deviationMap: Record<string, number> = {};
  (deviationRes.results || []).forEach((r: any) => { deviationMap[r.user_id] = r.cnt; });

  // 낙찰(bidWon=true) 카운트
  const winRes = await db.prepare(`
    SELECT user_id, COUNT(*) as cnt
    FROM journal_entries
    WHERE activity_type = '입찰' AND target_date BETWEEN ? AND ?
      AND (data LIKE '%"bidWon":true%' OR data LIKE '%"bidWon":1%')
    GROUP BY user_id
  `).bind(periodStart, periodEnd).all<any>();
  const winMap: Record<string, number> = {};
  (winRes.results || []).forEach((r: any) => { winMap[r.user_id] = r.cnt; });

  // 7. 전 지사 비율제(commission) 평균 매출 — analytics_snapshots 캐시 lookup, 없으면 실시간 fallback
  const queryYM = month || curYM;
  const snapshotRes = await db.prepare(`
    SELECT value FROM analytics_snapshots
    WHERE scope = 'paytype' AND scope_value = 'commission' AND ym = ? AND metric = 'avg_sales'
  `).bind(queryYM).first<{ value: number }>();
  let freelancerAvgSales = snapshotRes?.value || 0;
  if (!snapshotRes) {
    // 캐시 미스 → 실시간 계산
    const freelancerAvgRes = await db.prepare(`
      SELECT AVG(total) as avg_sales FROM (
        SELECT sr.user_id, SUM(sr.amount) as total
        FROM sales_records sr
        JOIN user_accounting ua ON ua.user_id = sr.user_id
        WHERE sr.contract_date BETWEEN ? AND ?
          AND sr.status IN ('confirmed', 'card_pending')
          AND sr.direction != 'expense'
          AND COALESCE(sr.exclude_from_count, 0) = 0
          AND ua.pay_type = 'commission'
        GROUP BY sr.user_id
      )
    `).bind(periodStart, periodEnd).first<{ avg_sales: number }>();
    freelancerAvgSales = freelancerAvgRes?.avg_sales || 0;
  }

  // 8. 조직 평균 활동 (활동량 비교용)
  const orgActivityAvg = members.reduce((sum, m) => sum + Object.values(activityMap[m.id] || {}).reduce((a, b) => a + b, 0), 0) / members.length;

  // 9. 평일 수 (작성률 계산용) — 매우 단순화: 기간 내 평일 수
  const weekdays = countWeekdays(periodStart, periodEnd);

  // ─── 멤버별 데이터 합성 ───
  const result = members.map((m: any) => {
    const isFreelancer = m.pay_type === 'commission' || m.role === 'freelancer';
    const myActivity = activityMap[m.id] || {};
    const activityCount = Object.values(myActivity).reduce((a, b) => a + b, 0);
    const bidCount = myActivity['입찰'] || 0;
    const winCount = winMap[m.id] || 0;

    const sales = salesMap[m.id] || { confirmed: 0, pending: 0, refunded: 0, confirmed_count: 0, refunded_count: 0, sales_count: 0 };
    const totalSales = sales.confirmed; // 공급가액(/1.1)은 차후

    // 1인분 기준매출 — 조회 기간에 맞게 안분 (DB는 2개월치)
    const proratedStandard = m.standard_sales * standardProrationFactor;

    // 매출 점수 계산용 비율
    const targetRate = isFreelancer
      ? (freelancerAvgSales > 0 ? (totalSales / freelancerAvgSales) * 100 : 0)
      : (proratedStandard > 0 ? (totalSales / proratedStandard) * 100 : 0);

    const bidWinRate = bidCount > 0 ? (winCount / bidCount) * 100 : 0;
    const activityIndex = orgActivityAvg > 0 ? (activityCount / orgActivityAvg) * 100 : 100;
    // 프리랜서는 일지 작성 의무가 없으므로 결근율 평가 제외 (만점 처리)
    const journalDays = Object.values(myActivity).reduce((a, b) => a + b, 0);
    const journalRate = isFreelancer
      ? 100
      : (weekdays > 0 ? Math.min(100, (journalDays / weekdays) * 100) : 0);

    const refundRate = sales.sales_count > 0 ? (sales.refunded_count / sales.sales_count) * 100 : 0;
    const deviationCount = deviationMap[m.id] || 0;
    const anomalyCount = deviationCount + (sales.refunded_count || 0);

    // 매출 트렌드 (12개월)
    const trend = trendMap[m.id] || {};
    const trendArr: { ym: string; amount: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      trendArr.push({ ym, amount: trend[ym] || 0 });
    }
    // 성장률 (전월 대비)
    const lastTwo = trendArr.slice(-2);
    const growthRate = lastTwo[0]?.amount > 0
      ? ((lastTwo[1].amount - lastTwo[0].amount) / lastTwo[0].amount) * 100
      : 0;

    // 근속 개월
    const hireMonths = m.hire_date
      ? Math.max(0, (now.getFullYear() - new Date(m.hire_date).getFullYear()) * 12 + (now.getMonth() - new Date(m.hire_date).getMonth()))
      : 0;

    const score = calculateScore({
      isFreelancer, targetRate, bidWinRate, activityIndex, journalRate, refundRate, anomalyCount, growthRate,
    });

    const tagsCtx = { targetRate, activityIndex, bidWinRate, deviationCount, refundCount: sales.refunded_count, salesCount: sales.sales_count, journalRate, growthRate, bidCount };
    const tags = generateTags(tagsCtx, isFreelancer, hireMonths);

    const maxByKey: Record<string, number> = isFreelancer
      ? { 매출: 25, 전환: 25, 활동: 20, 출근: 15, 성장: 15 }
      : { 매출: 35, 전환: 20, 활동: 15, 출근: 15, 안정: 10 };
    const diag = generateDiagnosis({ ...tagsCtx, targetRate }, score.breakdown, maxByKey, isFreelancer);

    const evaluation = evalMap[m.id] || null;

    return {
      id: m.id, name: m.name, role: m.role, branch: m.branch, department: m.department,
      position_title: m.position_title, grade: m.grade, hire_date: m.hire_date, hire_months: hireMonths,
      is_freelancer: isFreelancer,
      pay_type: m.pay_type,
      salary: m.salary,
      standard_sales: m.standard_sales,
      activity: { 임장: myActivity['임장'] || 0, 브리핑: myActivity['브리핑'] || 0, 입찰: bidCount, 미팅: myActivity['미팅'] || 0, 사무: myActivity['사무'] || 0, 총합: activityCount },
      sales: {
        total: totalSales,
        confirmed: sales.confirmed,
        pending: sales.pending,
        refunded: sales.refunded,
        confirmed_count: sales.confirmed_count,
        refunded_count: sales.refunded_count,
        sales_count: sales.sales_count,
        target_rate: Math.round(targetRate * 10) / 10,
        target_amount: isFreelancer ? freelancerAvgSales : proratedStandard,
        target_base: isFreelancer ? 0 : m.standard_sales, // 2개월 원본
        period_months: periodMonths,
        monthly_trend: trendArr,
        growth_rate: Math.round(growthRate * 10) / 10,
      },
      conversion: { bid_to_win: Math.round(bidWinRate * 10) / 10 },
      anomalies: { deviation: deviationCount, refund: sales.refunded_count, total: anomalyCount },
      score,
      tags,
      strengths: diag.strengths,
      weaknesses: diag.weaknesses,
      evaluation, // sales_evaluations 최신 1건
    };
  });

  return c.json({
    members: result,
    benchmarks: {
      org_activity_avg: Math.round(orgActivityAvg * 10) / 10,
      freelancer_avg_sales: Math.round(freelancerAvgSales),
      member_count: members.length,
      full_time_count: members.filter((m) => m.pay_type !== 'commission' && m.role !== 'freelancer').length,
      freelancer_count: members.filter((m) => m.pay_type === 'commission' || m.role === 'freelancer').length,
    },
    metadata: { period_start: periodStart, period_end: periodEnd },
  });
});

function countWeekdays(start: string, end: string): number {
  let count = 0;
  const s = new Date(start);
  const e = new Date(end);
  const cur = new Date(s);
  while (cur <= e) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

export default comprehensive;
