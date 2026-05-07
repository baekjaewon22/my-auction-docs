// 일지 기반 검증형 알림 영속화 (Phase 1 — 4종)
// - alert_personal_doc_missing
// - alert_bid_field_missing
// - alert_business_trip_missing
// - alert_schedule_gap

type DB = D1Database;

interface JournalEntry {
  id: string;
  user_id: string;
  target_date: string;
  activity_type: string;
  activity_subtype: string | null;
  data: string;
}

// ───────────────────────────────────────────────────────
// 외근 판정 (Dashboard.tsx isOutdoorEntry와 동일)
// ───────────────────────────────────────────────────────
function isOutdoorEntry(activityType: string, dataJson: string): boolean {
  try {
    const d = JSON.parse(dataJson);
    if (activityType === '임장') return true;
    if (activityType === '미팅') return !d.internalMeeting;
    if (activityType === '입찰' && (d.fieldCheckIn || d.fieldCheckOut) && !d.bidProxy) return true;
  } catch { /* */ }
  return false;
}

function timeToMin(t: string): number {
  const [h, m] = (t || '').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

// ───────────────────────────────────────────────────────
// 1. 개인 신청서 미제출 검사
// ───────────────────────────────────────────────────────
function detectPersonalDocTypes(entry: JournalEntry): string[] {
  if (entry.activity_type !== '개인') return [];
  let parsed: any = {};
  try { parsed = JSON.parse(entry.data); } catch { return []; }
  const reason = (parsed.reason || '').toLowerCase();
  const types: string[] = [];
  if (reason.includes('연차') || reason.includes('월차') || reason.includes('휴가')) types.push('연차');
  if (reason.includes('반차')) types.push('반차');
  if (reason.includes('시간차') || reason.includes('지각') || reason.includes('조퇴') || reason.includes('외출')) types.push('시간차');
  if (reason.includes('병가') || reason.includes('결근')) types.push('병가');
  return types;
}

const DOC_TYPE_KEYWORDS: Record<string, string[]> = {
  '연차': ['연차', '휴가'],
  '반차': ['반차'],
  '시간차': ['시간차', '지각', '조퇴', '외출'],
  '병가': ['병가', '결근'],
};

async function findMatchingDoc(db: DB, userId: string, docType: string): Promise<string | null> {
  const keywords = DOC_TYPE_KEYWORDS[docType] || [];
  if (keywords.length === 0) return null;
  const likeClauses = keywords.map(() => 'd.title LIKE ?').join(' OR ');
  const params = keywords.map((k) => `%${k}%`);
  const r = await db.prepare(`
    SELECT id FROM documents d
    WHERE d.author_id = ?
      AND d.status IN ('submitted','approved')
      AND COALESCE(d.cancelled, 0) = 0
      AND (${likeClauses})
    ORDER BY d.created_at DESC LIMIT 1
  `).bind(userId, ...params).first<{ id: string }>();
  return r?.id || null;
}

async function refreshPersonalAlertsForEntry(db: DB, entry: JournalEntry): Promise<void> {
  const types = detectPersonalDocTypes(entry);

  // 기존 row와 비교
  const existing = await db.prepare(
    'SELECT id, doc_type FROM alert_personal_doc_missing WHERE journal_entry_id = ?'
  ).bind(entry.id).all<{ id: string; doc_type: string }>();
  const existingByType = new Map((existing.results || []).map((r) => [r.doc_type, r.id]));

  let parsed: any = {};
  try { parsed = JSON.parse(entry.data); } catch { /* */ }
  const reasonText = parsed.reason || '';

  // 필요한 doc_type 처리
  for (const docType of types) {
    const matchedDocId = await findMatchingDoc(db, entry.user_id, docType);
    const exId = existingByType.get(docType);
    if (matchedDocId) {
      // 매칭됨 — resolved
      if (exId) {
        await db.prepare(`
          UPDATE alert_personal_doc_missing
          SET status = 'resolved', matched_doc_id = ?, resolved_at = datetime('now'),
              last_checked_at = datetime('now')
          WHERE id = ? AND status != 'resolved'
        `).bind(matchedDocId, exId).run();
      }
      // 매칭됐는데 row 없음 — INSERT 안 함 (이미 충족)
    } else {
      // 매칭 안 됨 — open alert 필요
      if (exId) {
        // 기존 row가 resolved였다면 다시 open
        await db.prepare(`
          UPDATE alert_personal_doc_missing
          SET status = 'open', matched_doc_id = NULL, resolved_at = NULL,
              last_checked_at = datetime('now'),
              reason_text = ?
          WHERE id = ? AND status = 'resolved'
        `).bind(reasonText, exId).run();
      } else {
        await db.prepare(`
          INSERT OR IGNORE INTO alert_personal_doc_missing
            (id, user_id, journal_entry_id, target_date, doc_type, reason_text)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind(crypto.randomUUID(), entry.user_id, entry.id, entry.target_date, docType, reasonText).run();
      }
    }
    existingByType.delete(docType);
  }

  // 일지 reason 변경으로 사라진 doc_type → cancelled
  for (const [, exId] of existingByType) {
    await db.prepare(`
      UPDATE alert_personal_doc_missing
      SET status = 'cancelled', last_checked_at = datetime('now')
      WHERE id = ? AND status = 'open'
    `).bind(exId).run();
  }
}

// ───────────────────────────────────────────────────────
// 2. 입찰 필드 미작성 검사
// ───────────────────────────────────────────────────────
function computeBidMissingFields(entry: JournalEntry, todayKst: string): {
  missing: string[]; bidCancelled: boolean; bidWon: boolean; caseNo: string;
} | null {
  if (entry.activity_type !== '입찰') return null;
  let d: any = {};
  try { d = JSON.parse(entry.data); } catch { return null; }
  const missing: string[] = [];
  if (!d.bidPrice && !d.bidCancelled) missing.push('작성입찰가');
  if (!d.suggestedPrice) missing.push('제시입찰가');
  if (!d.winPrice && !d.bidWon && !d.bidCancelled && entry.target_date <= todayKst) missing.push('낙찰가');
  return {
    missing,
    bidCancelled: !!d.bidCancelled,
    bidWon: !!d.bidWon,
    caseNo: d.caseNo || '',
  };
}

async function refreshBidAlertsForEntry(db: DB, entry: JournalEntry): Promise<void> {
  const todayKst = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const result = computeBidMissingFields(entry, todayKst);

  if (!result) {
    // 입찰 entry 아님 → 기존 alert 있으면 cancelled
    await db.prepare(
      "UPDATE alert_bid_field_missing SET status='cancelled', last_checked_at=datetime('now') WHERE journal_entry_id = ? AND status='open'"
    ).bind(entry.id).run();
    return;
  }

  if (result.missing.length === 0) {
    // 모든 필드 채워짐 → resolved
    await db.prepare(`
      UPDATE alert_bid_field_missing
      SET status='resolved', resolved_at=datetime('now'), last_checked_at=datetime('now'),
          missing_fields='[]', bid_cancelled=?, bid_won=?
      WHERE journal_entry_id = ? AND status='open'
    `).bind(result.bidCancelled ? 1 : 0, result.bidWon ? 1 : 0, entry.id).run();
    return;
  }

  // 미작성 필드 있음 → upsert
  const existing = await db.prepare(
    'SELECT id, status FROM alert_bid_field_missing WHERE journal_entry_id = ?'
  ).bind(entry.id).first<{ id: string; status: string }>();
  if (existing) {
    await db.prepare(`
      UPDATE alert_bid_field_missing
      SET missing_fields = ?, bid_cancelled = ?, bid_won = ?, case_no = ?,
          status = CASE WHEN status='resolved' THEN 'open' ELSE status END,
          resolved_at = CASE WHEN status='resolved' THEN NULL ELSE resolved_at END,
          last_checked_at = datetime('now')
      WHERE id = ?
    `).bind(
      JSON.stringify(result.missing), result.bidCancelled ? 1 : 0, result.bidWon ? 1 : 0,
      result.caseNo, existing.id
    ).run();
  } else {
    await db.prepare(`
      INSERT INTO alert_bid_field_missing
        (id, user_id, journal_entry_id, target_date, case_no, missing_fields, bid_cancelled, bid_won)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(), entry.user_id, entry.id, entry.target_date, result.caseNo,
      JSON.stringify(result.missing), result.bidCancelled ? 1 : 0, result.bidWon ? 1 : 0
    ).run();
  }
}

// ───────────────────────────────────────────────────────
// 3. 출장 신청서/보고서 미제출 검사
// ───────────────────────────────────────────────────────
function isBusinessTripEntry(entry: JournalEntry): boolean {
  if (entry.activity_type !== '미팅') return false;
  try {
    const d = JSON.parse(entry.data);
    if (d.meetingType !== '기타') return false;
    return ((d.etcReason || '').includes('출장') || (d.place || '').includes('출장'));
  } catch { return false; }
}

async function findMatchingBusinessTripDoc(db: DB, userId: string, docType: string): Promise<string | null> {
  // docType: '신청서' or '보고서'
  const r = await db.prepare(`
    SELECT id FROM documents d
    WHERE d.author_id = ?
      AND d.status IN ('submitted','approved')
      AND COALESCE(d.cancelled, 0) = 0
      AND d.title LIKE '%출장%'
      AND d.title LIKE ?
    ORDER BY d.created_at DESC LIMIT 1
  `).bind(userId, `%${docType}%`).first<{ id: string }>();
  return r?.id || null;
}

async function refreshTripAlertsForEntry(db: DB, entry: JournalEntry): Promise<void> {
  const isTrip = isBusinessTripEntry(entry);

  if (!isTrip) {
    await db.prepare(
      "UPDATE alert_business_trip_missing SET status='cancelled', last_checked_at=datetime('now') WHERE journal_entry_id = ? AND status='open'"
    ).bind(entry.id).run();
    return;
  }

  for (const docType of ['신청서', '보고서']) {
    const matchedDocId = await findMatchingBusinessTripDoc(db, entry.user_id, docType);
    const existing = await db.prepare(
      'SELECT id, status FROM alert_business_trip_missing WHERE journal_entry_id = ? AND doc_type = ?'
    ).bind(entry.id, docType).first<{ id: string; status: string }>();

    if (matchedDocId) {
      if (existing) {
        await db.prepare(`
          UPDATE alert_business_trip_missing
          SET status='resolved', matched_doc_id=?, resolved_at=datetime('now'), last_checked_at=datetime('now')
          WHERE id = ? AND status != 'resolved'
        `).bind(matchedDocId, existing.id).run();
      }
    } else {
      if (existing) {
        await db.prepare(`
          UPDATE alert_business_trip_missing
          SET status='open', matched_doc_id=NULL, resolved_at=NULL, last_checked_at=datetime('now')
          WHERE id = ? AND status = 'resolved'
        `).bind(existing.id).run();
      } else {
        await db.prepare(`
          INSERT OR IGNORE INTO alert_business_trip_missing
            (id, user_id, journal_entry_id, target_date, doc_type)
          VALUES (?, ?, ?, ?, ?)
        `).bind(crypto.randomUUID(), entry.user_id, entry.id, entry.target_date, docType).run();
      }
    }
  }
}

// ───────────────────────────────────────────────────────
// 4. 일정 공백 검사 (사용자×날짜 기준 — 단일 entry가 아닌 day 단위)
// ───────────────────────────────────────────────────────
const WORK_START_MIN = 9 * 60;        // 09:00
const WORK_END_MIN = 18 * 60;          // 18:00
const LUNCH_START_MIN = 12 * 60;
const LUNCH_END_MIN = 13 * 60;
const MIN_GAP_MINUTES = 30;            // 30분 이상 공백만 알림

export async function refreshScheduleGapForUserDate(db: DB, userId: string, targetDate: string): Promise<void> {
  const entriesRes = await db.prepare(
    'SELECT id, user_id, target_date, activity_type, activity_subtype, data FROM journal_entries WHERE user_id = ? AND target_date = ?'
  ).bind(userId, targetDate).all<JournalEntry>();
  const entries = entriesRes.results || [];

  // 시간 있는 entry만 추출
  const intervals: Array<{ from: number; to: number }> = [];
  for (const e of entries) {
    let d: any = {};
    try { d = JSON.parse(e.data); } catch { continue; }
    if (!d.timeFrom) continue;
    const from = timeToMin(d.timeFrom);
    const to = d.timeTo ? timeToMin(d.timeTo) : from;
    if (to <= from) continue;
    intervals.push({ from, to });
  }

  // 점심시간 (12:00~13:00)을 가상의 점유로 추가 (gap 검출에서 제외)
  intervals.push({ from: LUNCH_START_MIN, to: LUNCH_END_MIN });

  // 정렬 + 병합
  intervals.sort((a, b) => a.from - b.from);
  const merged: Array<{ from: number; to: number }> = [];
  for (const it of intervals) {
    if (merged.length === 0 || merged[merged.length - 1].to < it.from) {
      merged.push({ ...it });
    } else {
      merged[merged.length - 1].to = Math.max(merged[merged.length - 1].to, it.to);
    }
  }

  // 09:00~18:00 사이 공백 검출
  const gaps: Array<{ from: string; to: string; minutes: number }> = [];
  let cursor = WORK_START_MIN;
  for (const m of merged) {
    if (m.from > cursor) {
      const gapStart = Math.max(cursor, WORK_START_MIN);
      const gapEnd = Math.min(m.from, WORK_END_MIN);
      if (gapEnd > gapStart && (gapEnd - gapStart) >= MIN_GAP_MINUTES) {
        gaps.push({
          from: minToTime(gapStart), to: minToTime(gapEnd),
          minutes: gapEnd - gapStart,
        });
      }
    }
    cursor = Math.max(cursor, m.to);
  }
  if (cursor < WORK_END_MIN && (WORK_END_MIN - cursor) >= MIN_GAP_MINUTES) {
    gaps.push({
      from: minToTime(cursor), to: minToTime(WORK_END_MIN),
      minutes: WORK_END_MIN - cursor,
    });
  }

  const totalGapMin = gaps.reduce((s, g) => s + g.minutes, 0);

  if (gaps.length === 0) {
    await db.prepare(
      "UPDATE alert_schedule_gap SET status='resolved', resolved_at=datetime('now'), last_checked_at=datetime('now') WHERE user_id=? AND target_date=? AND status='open'"
    ).bind(userId, targetDate).run();
    return;
  }

  const existing = await db.prepare(
    'SELECT id, status FROM alert_schedule_gap WHERE user_id = ? AND target_date = ?'
  ).bind(userId, targetDate).first<{ id: string; status: string }>();
  if (existing) {
    await db.prepare(`
      UPDATE alert_schedule_gap
      SET gap_count=?, gap_details=?, total_gap_minutes=?,
          status = CASE WHEN status='resolved' THEN 'open' ELSE status END,
          resolved_at = CASE WHEN status='resolved' THEN NULL ELSE resolved_at END,
          last_checked_at=datetime('now')
      WHERE id = ?
    `).bind(gaps.length, JSON.stringify(gaps), totalGapMin, existing.id).run();
  } else {
    await db.prepare(`
      INSERT OR IGNORE INTO alert_schedule_gap
        (id, user_id, target_date, gap_count, gap_details, total_gap_minutes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(crypto.randomUUID(), userId, targetDate, gaps.length, JSON.stringify(gaps), totalGapMin).run();
  }
}

function minToTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ───────────────────────────────────────────────────────
// 메인 진입점 — 일지 entry 변경 시 호출
// ───────────────────────────────────────────────────────
export async function recheckAlertsForJournalEntry(db: DB, entryId: string): Promise<void> {
  const entry = await db.prepare(
    'SELECT id, user_id, target_date, activity_type, activity_subtype, data FROM journal_entries WHERE id = ?'
  ).bind(entryId).first<JournalEntry>();
  if (!entry) return;
  await Promise.all([
    refreshPersonalAlertsForEntry(db, entry),
    refreshBidAlertsForEntry(db, entry),
    refreshTripAlertsForEntry(db, entry),
  ]);
  // schedule gap은 day 단위 → 별도 호출
  await refreshScheduleGapForUserDate(db, entry.user_id, entry.target_date);
}

// 일지 삭제 시 호출 — entry 자체는 cascade로 link 삭제되지만 day 단위 알림은 재계산 필요
export async function recheckAlertsAfterEntryDelete(db: DB, userId: string, targetDate: string): Promise<void> {
  await refreshScheduleGapForUserDate(db, userId, targetDate);
}

// 문서 변경(휴가/출장 신청서 제출/승인) 시 호출 — 해당 사용자의 미매칭 alert 재매칭
export async function recheckAlertsAfterDocumentChange(db: DB, userId: string): Promise<void> {
  // open 상태 personal/trip alert 모두 재매칭 시도
  const personalRes = await db.prepare(
    "SELECT id, journal_entry_id, doc_type FROM alert_personal_doc_missing WHERE user_id = ? AND status = 'open'"
  ).bind(userId).all<{ id: string; journal_entry_id: string; doc_type: string }>();
  for (const a of personalRes.results || []) {
    const entry = await db.prepare(
      'SELECT id, user_id, target_date, activity_type, activity_subtype, data FROM journal_entries WHERE id = ?'
    ).bind(a.journal_entry_id).first<JournalEntry>();
    if (entry) await refreshPersonalAlertsForEntry(db, entry);
  }

  const tripRes = await db.prepare(
    "SELECT DISTINCT journal_entry_id FROM alert_business_trip_missing WHERE user_id = ? AND status = 'open'"
  ).bind(userId).all<{ journal_entry_id: string }>();
  for (const a of tripRes.results || []) {
    const entry = await db.prepare(
      'SELECT id, user_id, target_date, activity_type, activity_subtype, data FROM journal_entries WHERE id = ?'
    ).bind(a.journal_entry_id).first<JournalEntry>();
    if (entry) await refreshTripAlertsForEntry(db, entry);
  }
}

// 외근 entry 판정 export (기타 모듈에서 재사용 가능)
export { isOutdoorEntry, isBusinessTripEntry };
