// 종합분석 통계 캐시 갱신 — daily/monthly cron + 백필 공통
// - user_monthly_stats: 직원별 월 집계
// - analytics_snapshots: 조직 단위 집계 (조직 평균, 비율제 평균 등)

const KST_OFFSET = 9 * 60 * 60 * 1000;

function nowKST() {
  return new Date(Date.now() + KST_OFFSET);
}

function ymOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function shiftMonths(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return ymOf(d);
}

function monthRange(ym: string): { start: string; end: string } {
  const [y, m] = ym.split('-').map(Number);
  const start = `${ym}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${ym}-${String(lastDay).padStart(2, '0')}`;
  return { start, end };
}

// 직원 컨설턴트 필터링 — 종합분석에 표시되는 동일 조건
const JEONG_MINHO_ID = '2b6b3606-e425-4361-a115-9283cfef842f';
const CONSULTANT_FILTER = `
  u.role NOT IN ('master', 'ceo', 'cc_ref', 'accountant', 'accountant_asst', 'support', 'resigned')
  AND u.branch != '본사 관리'
  AND (u.department IS NULL OR u.department NOT IN ('명도팀', '지원팀'))
  AND u.id != ?
  AND u.login_type != 'freelancer-old'
`;

// ─────────────────────────────────────────────
// 단일 월 집계 — 모든 컨설턴트의 user_monthly_stats 갱신
// ─────────────────────────────────────────────
export async function aggregateMonth(env: any, ym: string): Promise<{ users: number }> {
  const db = env.DB as D1Database;
  const { start, end } = monthRange(ym);

  // 1) 컨설턴트 목록
  const usersRes = await db.prepare(`
    SELECT u.id FROM users u WHERE ${CONSULTANT_FILTER}
  `).bind(JEONG_MINHO_ID).all<{ id: string }>();
  const userIds = (usersRes.results || []).map((u) => u.id);
  if (userIds.length === 0) return { users: 0 };

  // 2) 매출 집계 (지정 기간 내, 본인 user_id 기준)
  const salesRes = await db.prepare(`
    SELECT user_id, status, COUNT(*) as cnt, COALESCE(SUM(amount), 0) as total
    FROM sales_records
    WHERE contract_date BETWEEN ? AND ?
      AND direction != 'expense'
    GROUP BY user_id, status
  `).bind(start, end).all<any>();
  const salesMap: Record<string, { confirmed: number; pending: number; refunded: number; sales_count: number; refund_count: number }> = {};
  (salesRes.results || []).forEach((r: any) => {
    const uid = r.user_id;
    if (!salesMap[uid]) salesMap[uid] = { confirmed: 0, pending: 0, refunded: 0, sales_count: 0, refund_count: 0 };
    salesMap[uid].sales_count += r.cnt;
    if (r.status === 'confirmed' || r.status === 'card_pending') salesMap[uid].confirmed += r.total || 0;
    else if (r.status === 'pending') salesMap[uid].pending += r.total || 0;
    else if (r.status === 'refunded') {
      salesMap[uid].refunded += r.total || 0;
      salesMap[uid].refund_count += r.cnt;
    }
  });

  // 3) 활동 집계
  const actRes = await db.prepare(`
    SELECT user_id, activity_type, COUNT(*) as cnt
    FROM journal_entries
    WHERE target_date BETWEEN ? AND ?
    GROUP BY user_id, activity_type
  `).bind(start, end).all<any>();
  const actMap: Record<string, Record<string, number>> = {};
  (actRes.results || []).forEach((r: any) => {
    if (!actMap[r.user_id]) actMap[r.user_id] = {};
    actMap[r.user_id][r.activity_type] = r.cnt;
  });

  // 4) 낙찰 (bidWon=true)
  const winRes = await db.prepare(`
    SELECT user_id, COUNT(*) as cnt
    FROM journal_entries
    WHERE activity_type = '입찰' AND target_date BETWEEN ? AND ?
      AND (data LIKE '%"bidWon":true%' OR data LIKE '%"bidWon":1%')
    GROUP BY user_id
  `).bind(start, end).all<any>();
  const winMap: Record<string, number> = {};
  (winRes.results || []).forEach((r: any) => { winMap[r.user_id] = r.cnt; });

  // 5) 5% 편차
  const devRes = await db.prepare(`
    SELECT user_id, COUNT(*) as cnt
    FROM journal_entries
    WHERE activity_type = '입찰' AND target_date BETWEEN ? AND ?
      AND data LIKE '%deviationReason%'
    GROUP BY user_id
  `).bind(start, end).all<any>();
  const devMap: Record<string, number> = {};
  (devRes.results || []).forEach((r: any) => { devMap[r.user_id] = r.cnt; });

  // 6) DISTINCT 작성 일자 (journal_days)
  const jdRes = await db.prepare(`
    SELECT user_id, COUNT(DISTINCT target_date) as cnt
    FROM journal_entries
    WHERE target_date BETWEEN ? AND ?
    GROUP BY user_id
  `).bind(start, end).all<any>();
  const jdMap: Record<string, number> = {};
  (jdRes.results || []).forEach((r: any) => { jdMap[r.user_id] = r.cnt; });

  // 7) UPSERT (INSERT OR REPLACE)
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO user_monthly_stats
      (user_id, ym, sales_confirmed, sales_pending, sales_refunded, sales_count, refund_count,
       activity_jang, activity_brief, activity_bid, activity_other,
       bid_won_count, deviation_count, journal_days, last_updated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  const batch = userIds.map((uid) => {
    const s = salesMap[uid] || { confirmed: 0, pending: 0, refunded: 0, sales_count: 0, refund_count: 0 };
    const a = actMap[uid] || {};
    const other = (a['미팅'] || 0) + (a['사무'] || 0) + (a['개인'] || 0);
    return stmt.bind(
      uid, ym,
      s.confirmed, s.pending, s.refunded, s.sales_count, s.refund_count,
      a['임장'] || 0, a['브리핑'] || 0, a['입찰'] || 0, other,
      winMap[uid] || 0, devMap[uid] || 0, jdMap[uid] || 0,
    );
  });
  await db.batch(batch);

  // 8) 조직 단위 스냅샷 — 평균 활동량, 비율제 평균 매출
  await aggregateOrgSnapshot(env, ym);

  return { users: userIds.length };
}

// ─────────────────────────────────────────────
// 조직 단위 스냅샷 (analytics_snapshots) 갱신
// ─────────────────────────────────────────────
export async function aggregateOrgSnapshot(env: any, ym: string): Promise<void> {
  const db = env.DB as D1Database;
  const { start, end } = monthRange(ym);

  // 평균 활동량 (모든 컨설턴트 — 조직 평균)
  const orgActRes = await db.prepare(`
    SELECT AVG(cnt) as avg_cnt FROM (
      SELECT u.id, COALESCE(SUM(
        CASE WHEN je.target_date BETWEEN ? AND ? THEN 1 ELSE 0 END
      ), 0) as cnt
      FROM users u
      LEFT JOIN journal_entries je ON je.user_id = u.id
      WHERE ${CONSULTANT_FILTER}
      GROUP BY u.id
    )
  `).bind(start, end, JEONG_MINHO_ID).first<{ avg_cnt: number }>();
  const orgActAvg = orgActRes?.avg_cnt || 0;

  // 비율제 평균 매출 (전 지사)
  const flAvgRes = await db.prepare(`
    SELECT AVG(total) as avg_sales FROM (
      SELECT sr.user_id, SUM(sr.amount) as total
      FROM sales_records sr
      JOIN user_accounting ua ON ua.user_id = sr.user_id
      WHERE sr.contract_date BETWEEN ? AND ?
        AND sr.status IN ('confirmed', 'card_pending')
        AND sr.direction != 'expense'
        AND ua.pay_type = 'commission'
      GROUP BY sr.user_id
    )
  `).bind(start, end).first<{ avg_sales: number }>();
  const flAvg = flAvgRes?.avg_sales || 0;

  // 컨설턴트 수
  const cntRes = await db.prepare(`
    SELECT COUNT(*) as cnt FROM users u WHERE ${CONSULTANT_FILTER}
  `).bind(JEONG_MINHO_ID).first<{ cnt: number }>();
  const memberCount = cntRes?.cnt || 0;

  await db.batch([
    db.prepare(`INSERT OR REPLACE INTO analytics_snapshots (scope, scope_value, ym, metric, value, last_updated) VALUES ('org', '', ?, 'avg_activity', ?, datetime('now'))`).bind(ym, orgActAvg),
    db.prepare(`INSERT OR REPLACE INTO analytics_snapshots (scope, scope_value, ym, metric, value, last_updated) VALUES ('paytype', 'commission', ?, 'avg_sales', ?, datetime('now'))`).bind(ym, flAvg),
    db.prepare(`INSERT OR REPLACE INTO analytics_snapshots (scope, scope_value, ym, metric, value, last_updated) VALUES ('org', '', ?, 'member_count', ?, datetime('now'))`).bind(ym, memberCount),
  ]);
}

// ─────────────────────────────────────────────
// 일일 cron — 진행 중 달 + 직전 7일 영향 받는 달 갱신
// ─────────────────────────────────────────────
export async function runDailyAggregation(env: any): Promise<{ months: string[]; users: number }> {
  const today = nowKST();
  const curYM = ymOf(today);
  const months = new Set<string>([curYM]);

  // 직전 7일 동안 다른 달이 포함되면 그 달도 갱신 (예: 5/2일이면 4월도 갱신)
  for (let i = 1; i <= 7; i++) {
    const d = new Date(today.getTime() - i * 86400000);
    months.add(ymOf(d));
  }

  let totalUsers = 0;
  for (const ym of Array.from(months).sort()) {
    const r = await aggregateMonth(env, ym);
    totalUsers = r.users;
  }
  console.log(`[analytics-daily] aggregated ${months.size} months: ${Array.from(months).sort().join(', ')}`);
  return { months: Array.from(months).sort(), users: totalUsers };
}

// ─────────────────────────────────────────────
// 월간 cron — 직전 달 최종 확정 + sales_evaluations 자동 생성
// ─────────────────────────────────────────────
export async function runMonthlyAggregation(env: any): Promise<{ prevMonth: string; users: number; evaluations: number }> {
  const db = env.DB as D1Database;
  const today = nowKST();
  const curYM = ymOf(today);
  const prevYM = shiftMonths(curYM, -1);
  const prevPrevYM = shiftMonths(curYM, -2);

  // 1) 직전 달 user_monthly_stats 최종 확정
  const r = await aggregateMonth(env, prevYM);
  // 2) 직전 두 달도 한번 더 (back-dated 흡수)
  await aggregateMonth(env, prevPrevYM);

  // 3) sales_evaluations 자동 생성 — 직전 2개월 단위 평가 (예: 5/1 cron이면 3-4월 평가)
  // 평가 구간: prevPrevYM ~ prevYM (2개월)
  const period_start = `${prevPrevYM}-01`;
  const { end: period_end } = monthRange(prevYM);

  const usersRes = await db.prepare(`
    SELECT u.id, COALESCE(ua.standard_sales, 0) as standard_sales
    FROM users u
    LEFT JOIN user_accounting ua ON ua.user_id = u.id
    WHERE ${CONSULTANT_FILTER}
      AND COALESCE(ua.pay_type, 'salary') = 'salary'
      AND COALESCE(ua.standard_sales, 0) > 0
  `).bind(JEONG_MINHO_ID).all<{ id: string; standard_sales: number }>();
  const fullTimers = usersRes.results || [];

  let evalCount = 0;
  for (const u of fullTimers) {
    // 직전 평가의 consecutive_misses 조회
    const prevEval = await db.prepare(
      `SELECT consecutive_misses FROM sales_evaluations WHERE user_id = ? AND period_end < ? ORDER BY period_start DESC LIMIT 1`
    ).bind(u.id, period_start).first<{ consecutive_misses: number }>();

    // 직전 2개월 매출 합계 (확정만)
    const totRes = await db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM sales_records
      WHERE user_id = ? AND contract_date BETWEEN ? AND ?
        AND status IN ('confirmed', 'card_pending')
        AND direction != 'expense'
    `).bind(u.id, period_start, period_end).first<{ total: number }>();
    const totalSales = totRes?.total || 0;

    const metTarget = totalSales >= u.standard_sales ? 1 : 0;
    const consecutive = metTarget ? 0 : (prevEval?.consecutive_misses || 0) + 1;

    await db.prepare(`
      INSERT OR REPLACE INTO sales_evaluations
        (id, user_id, period_start, period_end, standard_sales, total_sales, met_target, consecutive_misses, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).bind(
      `eval-${u.id}-${period_start}`,
      u.id, period_start, period_end,
      u.standard_sales, totalSales, metTarget, consecutive,
    ).run();
    evalCount++;
  }

  console.log(`[analytics-monthly] prev month ${prevYM} aggregated, ${evalCount} evaluations created`);
  return { prevMonth: prevYM, users: r.users, evaluations: evalCount };
}

// ─────────────────────────────────────────────
// 백필 — 과거 N개월 한 번에 집계 (수동 실행)
// ─────────────────────────────────────────────
export async function backfillHistory(env: any, months: number = 24): Promise<{ months: string[]; users: number }> {
  const today = nowKST();
  const list: string[] = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1));
    list.push(ymOf(d));
  }
  list.sort();
  let totalUsers = 0;
  for (const ym of list) {
    const r = await aggregateMonth(env, ym);
    totalUsers = r.users;
  }
  return { months: list, users: totalUsers };
}
