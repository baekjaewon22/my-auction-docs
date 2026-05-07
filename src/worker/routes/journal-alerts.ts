// 일지 기반 검증형 알림 라우트 (Phase 1 — 4종 통합)
// - GET  /api/journal-alerts                     — 본인의 모든 검증형 알림 조회 (대시보드)
// - POST /api/journal-alerts/:type/:id/dismiss   — 알림 dismiss
// - POST /api/journal-alerts/backfill            — 기존 일지 일괄 알림 적재 (master/accountant/admin)

import { Hono } from 'hono';
import type { AuthEnv } from '../types';
import { authMiddleware, requireRole } from '../middleware/auth';
import { recheckAlertsForJournalEntry, refreshScheduleGapForUserDate } from '../lib/journal-alerts';

const journalAlerts = new Hono<AuthEnv>();
journalAlerts.use('*', authMiddleware);

const BACKFILL_ROLES = ['master', 'accountant', 'admin'] as const;

// GET /api/journal-alerts
// 본인 + (manager/admin/master는 부하 작은 범위)의 open 알림 4종 통합 조회
journalAlerts.get('/', async (c) => {
  const db = c.env.DB;
  const user = c.get('user');

  // 권한별 user_id 필터 (Dashboard 미제출 감지 범위와 일치)
  const userFilter = 'user_id = ?';
  const params: any[] = [user.sub];
  // 일반 결재자(canApprove)는 본인 알림만 보여주는 게 일관됨 — 팀 단위 알림은 별도 화면 권장
  // (현재 detectMissing은 manager/admin이면 팀/지사 전체 알림 표시했으나, 영속 알림에서는 본인만 우선)

  const [personal, bid, trip, gap] = await Promise.all([
    db.prepare(
      `SELECT * FROM alert_personal_doc_missing WHERE ${userFilter} AND status='open' ORDER BY target_date DESC`
    ).bind(...params).all(),
    db.prepare(
      `SELECT * FROM alert_bid_field_missing WHERE ${userFilter} AND status='open' ORDER BY target_date DESC`
    ).bind(...params).all(),
    db.prepare(
      `SELECT * FROM alert_business_trip_missing WHERE ${userFilter} AND status='open' ORDER BY target_date DESC`
    ).bind(...params).all(),
    db.prepare(
      `SELECT * FROM alert_schedule_gap WHERE ${userFilter} AND status='open' ORDER BY target_date DESC`
    ).bind(...params).all(),
  ]);

  return c.json({
    personal: personal.results || [],
    bid: bid.results || [],
    trip: trip.results || [],
    gap: gap.results || [],
  });
});

// POST /api/journal-alerts/:type/:id/dismiss
// type: personal | bid | trip | gap
journalAlerts.post('/:type/:id/dismiss', async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const type = c.req.param('type');
  const id = c.req.param('id');

  const tableMap: Record<string, string> = {
    personal: 'alert_personal_doc_missing',
    bid: 'alert_bid_field_missing',
    trip: 'alert_business_trip_missing',
    gap: 'alert_schedule_gap',
  };
  const table = tableMap[type];
  if (!table) return c.json({ error: '잘못된 type' }, 400);

  const row = await db.prepare(`SELECT user_id FROM ${table} WHERE id = ?`).bind(id).first<{ user_id: string }>();
  if (!row) return c.json({ error: 'alert을 찾을 수 없습니다.' }, 404);
  if (row.user_id !== user.sub && !['master', 'ceo', 'cc_ref'].includes(user.role)) {
    return c.json({ error: '권한이 없습니다.' }, 403);
  }

  await db.prepare(`
    UPDATE ${table} SET status='dismissed', dismissed_by=?, dismissed_at=datetime('now')
    WHERE id = ?
  `).bind(user.sub, id).run();
  return c.json({ success: true });
});

// POST /api/journal-alerts/backfill
// body: { dryRun: boolean (default true) }
// - 기존 일지 모두 순회하며 4종 알림 검사·적재
// - dryRun: 카운트만 보고, INSERT 안 함
journalAlerts.post('/backfill', requireRole(...BACKFILL_ROLES), async (c) => {
  const db = c.env.DB;
  const body = await c.req.json<{ dryRun?: boolean }>().catch(() => ({} as { dryRun?: boolean }));
  const dryRun = body.dryRun ?? true;

  // 일지 entries 전부 조회 (최대 5000건 안전 상한)
  const entriesRes = await db.prepare(
    'SELECT id, user_id, target_date FROM journal_entries ORDER BY target_date DESC LIMIT 5000'
  ).all<{ id: string; user_id: string; target_date: string }>();
  const entries = entriesRes.results || [];

  // 사용자×날짜 unique set (일정 공백용)
  const userDateSet = new Set<string>();
  for (const e of entries) userDateSet.add(`${e.user_id}|${e.target_date}`);

  let processed = 0;

  if (!dryRun) {
    // entry-level 알림 (personal/bid/trip)
    for (const e of entries) {
      try {
        await recheckAlertsForJournalEntry(db, e.id);
        processed++;
      } catch (err) {
        console.error('[backfill entry]', e.id, err);
      }
    }
    // day-level 알림 (schedule gap) — 사용자×날짜 한 번씩
    for (const key of userDateSet) {
      const [userId, targetDate] = key.split('|');
      try {
        await refreshScheduleGapForUserDate(db, userId, targetDate);
      } catch (err) {
        console.error('[backfill gap]', userId, targetDate, err);
      }
    }
  }

  // 처리 후 카운트
  const counts = {
    personal: 0, bid: 0, trip: 0, gap: 0,
  };
  if (!dryRun) {
    const c1 = await db.prepare("SELECT COUNT(*) as c FROM alert_personal_doc_missing WHERE status='open'").first<{ c: number }>();
    const c2 = await db.prepare("SELECT COUNT(*) as c FROM alert_bid_field_missing WHERE status='open'").first<{ c: number }>();
    const c3 = await db.prepare("SELECT COUNT(*) as c FROM alert_business_trip_missing WHERE status='open'").first<{ c: number }>();
    const c4 = await db.prepare("SELECT COUNT(*) as c FROM alert_schedule_gap WHERE status='open'").first<{ c: number }>();
    counts.personal = c1?.c || 0;
    counts.bid = c2?.c || 0;
    counts.trip = c3?.c || 0;
    counts.gap = c4?.c || 0;
  }

  return c.json({
    dry_run: dryRun,
    entries_total: entries.length,
    user_date_pairs: userDateSet.size,
    entries_processed: processed,
    open_alerts_after: counts,
  });
});

export default journalAlerts;
