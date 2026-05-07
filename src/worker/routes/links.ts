import { Hono } from 'hono';
import type { AuthEnv } from '../types';
import { authMiddleware, requireRole } from '../middleware/auth';

const links = new Hono<AuthEnv>();
links.use('*', authMiddleware);

const REVIEW_ROLES = ['master', 'accountant', 'admin'] as const;

// ─────────────────────────────────────────────────────────
// 외근 판정 (Dashboard.tsx isOutdoorEntry와 동일 룰)
// ─────────────────────────────────────────────────────────
function isOutdoorEntry(activityType: string, dataJson: string): boolean {
  try {
    const d = JSON.parse(dataJson);
    if (activityType === '임장') return true;
    if (activityType === '미팅') return !d.internalMeeting;
    if (activityType === '입찰' && (d.fieldCheckIn || d.fieldCheckOut) && !d.bidProxy) return true;
  } catch { /* */ }
  return false;
}

// 본문에서 "외근 일자: YYYY년 M월 D일" 추출 (Dashboard.tsx extractOutingDate와 동일)
function extractOutingDate(content: string): string | null {
  const text = (content || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
  const m = text.match(/외근\s*일자[\s:：]*(\d{2,4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (m) {
    let y = m[1];
    if (y.length === 2) y = '20' + y;
    return `${y}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  }
  return null;
}

function dayDiff(a: string, b: string): number {
  return Math.round((new Date(a).getTime() - new Date(b).getTime()) / 86400000);
}

// ─────────────────────────────────────────────────────────
// POST /api/links/backfill-outdoor — 외근보고서 ↔ 일지 link backfill
// body: { dryRun: boolean (default true) }
// ─────────────────────────────────────────────────────────
links.post('/backfill-outdoor', requireRole(...REVIEW_ROLES), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const body = await c.req.json<{ dryRun?: boolean }>().catch(() => ({} as { dryRun?: boolean }));
  const dryRun = body.dryRun ?? true;
  const runId = crypto.randomUUID();

  // 1. 대상 외근보고서 조회 (submitted/approved, 취소 안 된 것)
  const docsRes = await db.prepare(`
    SELECT id, author_id, title, content, status, created_at, cancelled
    FROM documents
    WHERE title LIKE '%외근%' AND title LIKE '%보고%'
      AND status IN ('submitted', 'approved')
      AND COALESCE(cancelled, 0) = 0
    ORDER BY created_at ASC
  `).all();
  const docs = (docsRes.results || []) as Array<{ id: string; author_id: string; title: string; content: string; status: string; created_at: string }>;

  // 2. 모든 외근 일지 entries 조회 (그룹: author_id별)
  const entriesRes = await db.prepare(`
    SELECT id, user_id, target_date, activity_type, data
    FROM journal_entries
    WHERE activity_type IN ('입찰', '임장', '미팅')
    ORDER BY target_date ASC
  `).all();
  const allEntries = (entriesRes.results || []) as Array<{ id: string; user_id: string; target_date: string; activity_type: string; data: string }>;

  // 3. 외근 entries만 필터 + 사용자별 그룹
  const entriesByUser: Record<string, Array<{ id: string; target_date: string; activity_type: string }>> = {};
  for (const e of allEntries) {
    if (!isOutdoorEntry(e.activity_type, e.data)) continue;
    if (!entriesByUser[e.user_id]) entriesByUser[e.user_id] = [];
    entriesByUser[e.user_id].push({ id: e.id, target_date: e.target_date, activity_type: e.activity_type });
  }

  // 4. 이미 link된 entry 집합 (UNIQUE 위반 방지)
  const linkedRes = await db.prepare(
    "SELECT journal_entry_id FROM document_journal_links WHERE link_type = 'outdoor'"
  ).all();
  const linkedEntries = new Set((linkedRes.results || []).map((r: any) => r.journal_entry_id as string));

  // 5. Tier별 매칭 시도
  const result = {
    run_id: runId,
    dry_run: dryRun,
    total_docs: docs.length,
    tier1_linked: 0,        // 정확 일치
    tier2_linked: 0,        // ±1일
    tier3_candidates: 0,    // 검수 큐 (regex 성공, ±3일)
    tier4_candidates: 0,    // 검수 큐 (regex 실패, fallback)
    skipped_no_outdoor_entries: 0,  // author의 외근 entry 자체 없음
    skipped_all_linked: 0,          // 후보 모두 이미 link됨
    errors: 0,
    sample_links: [] as any[],
    sample_candidates: [] as any[],
  };

  const linksToInsert: Array<{ doc_id: string; entry_id: string; tier: number }> = [];
  const candidatesToInsert: Array<{
    doc_id: string;
    entry_ids: string[];
    tier: number;
    body_text: string | null;
    body_parsed: string | null;
  }> = [];
  const logs: Array<{ doc_id: string; entry_id?: string; action: string; reason: string; tier?: number }> = [];

  for (const doc of docs) {
    const userEntries = entriesByUser[doc.author_id] || [];
    const availableEntries = userEntries.filter((e) => !linkedEntries.has(e.id));

    if (availableEntries.length === 0) {
      if (userEntries.length === 0) {
        result.skipped_no_outdoor_entries++;
        logs.push({ doc_id: doc.id, action: 'skipped', reason: 'no_outdoor_entries' });
      } else {
        result.skipped_all_linked++;
        logs.push({ doc_id: doc.id, action: 'skipped', reason: 'all_candidates_already_linked' });
      }
      continue;
    }

    const bodyText = (doc.content || '').match(/외근\s*일자[\s:：]*[^<\n]{1,40}/)?.[0] || null;
    const bodyDate = extractOutingDate(doc.content || '');

    if (bodyDate) {
      // Tier 1: 정확 일치
      const sameDay = availableEntries.filter((e) => e.target_date === bodyDate);
      if (sameDay.length > 0) {
        for (const e of sameDay) {
          linksToInsert.push({ doc_id: doc.id, entry_id: e.id, tier: 1 });
          linkedEntries.add(e.id);
          result.tier1_linked++;
          logs.push({ doc_id: doc.id, entry_id: e.id, action: 'linked', reason: `tier1_exact_match (${bodyDate})`, tier: 1 });
          if (result.sample_links.length < 10) {
            result.sample_links.push({ tier: 1, doc_id: doc.id, entry_id: e.id, target_date: e.target_date, activity: e.activity_type });
          }
        }
        continue;
      }

      // Tier 2: ±1일, 후보 적음 (≤3)
      const within1 = availableEntries.filter((e) => Math.abs(dayDiff(e.target_date, bodyDate)) <= 1);
      if (within1.length > 0 && within1.length <= 3) {
        for (const e of within1) {
          linksToInsert.push({ doc_id: doc.id, entry_id: e.id, tier: 2 });
          linkedEntries.add(e.id);
          result.tier2_linked++;
          logs.push({ doc_id: doc.id, entry_id: e.id, action: 'linked', reason: `tier2_within_1day (body=${bodyDate}, entry=${e.target_date})`, tier: 2 });
          if (result.sample_links.length < 20) {
            result.sample_links.push({ tier: 2, doc_id: doc.id, entry_id: e.id, target_date: e.target_date, body_date: bodyDate });
          }
        }
        continue;
      }

      // Tier 3: ±3일, 검수 큐
      const within3 = availableEntries.filter((e) => Math.abs(dayDiff(e.target_date, bodyDate)) <= 3);
      if (within3.length > 0) {
        candidatesToInsert.push({
          doc_id: doc.id,
          entry_ids: within3.map((e) => e.id),
          tier: 3,
          body_text: bodyText,
          body_parsed: bodyDate,
        });
        result.tier3_candidates++;
        logs.push({ doc_id: doc.id, action: 'candidate', reason: `tier3 ±3일 (body=${bodyDate}, candidates=${within3.length})`, tier: 3 });
        if (result.sample_candidates.length < 10) {
          result.sample_candidates.push({ tier: 3, doc_id: doc.id, body_date: bodyDate, candidates: within3.slice(0, 5) });
        }
        continue;
      }

      // bodyDate 있지만 ±3일 내 후보 없음 → fallback Tier 4 시도
    }

    // Tier 4: regex 실패 또는 윈도우 밖 → created_at fallback ±7일
    const docDate = (doc.created_at || '').slice(0, 10);
    const within7Created = availableEntries.filter((e) => {
      const d = dayDiff(e.target_date, docDate);
      return d >= -7 && d <= 1;
    });
    if (within7Created.length > 0) {
      candidatesToInsert.push({
        doc_id: doc.id,
        entry_ids: within7Created.map((e) => e.id),
        tier: 4,
        body_text: bodyText,
        body_parsed: bodyDate,
      });
      result.tier4_candidates++;
      logs.push({ doc_id: doc.id, action: 'candidate', reason: `tier4 fallback created_at±7 (body=${bodyDate || 'parse_fail'}, candidates=${within7Created.length})`, tier: 4 });
      if (result.sample_candidates.length < 20) {
        result.sample_candidates.push({ tier: 4, doc_id: doc.id, body_date: bodyDate, doc_created: docDate, candidates: within7Created.slice(0, 5) });
      }
      continue;
    }

    result.errors++;
    logs.push({ doc_id: doc.id, action: 'skipped', reason: `no_match (body=${bodyDate || 'parse_fail'}, doc_created=${docDate})` });
  }

  // 6. dry-run이 아니면 실제 INSERT
  if (!dryRun) {
    // links INSERT
    for (let i = 0; i < linksToInsert.length; i += 50) {
      const batch = linksToInsert.slice(i, i + 50);
      const stmts = batch.map((l) =>
        db.prepare(`
          INSERT OR IGNORE INTO document_journal_links
            (id, document_id, journal_entry_id, link_type, created_by, source)
          VALUES (?, ?, ?, 'outdoor', ?, ?)
        `).bind(crypto.randomUUID(), l.doc_id, l.entry_id, user.sub, `backfill_auto_t${l.tier}`)
      );
      await db.batch(stmts);
    }

    // candidates INSERT
    for (let i = 0; i < candidatesToInsert.length; i += 50) {
      const batch = candidatesToInsert.slice(i, i + 50);
      const stmts = batch.map((c) =>
        db.prepare(`
          INSERT INTO document_journal_link_candidates
            (id, document_id, candidate_journal_entry_ids, match_tier, document_outing_date_text, document_outing_date_parsed)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind(crypto.randomUUID(), c.doc_id, JSON.stringify(c.entry_ids), c.tier, c.body_text, c.body_parsed)
      );
      await db.batch(stmts);
    }

    // log INSERT (행수 많을 수 있어 sample만 저장)
    const sampleLogs = logs.slice(0, 500);
    for (let i = 0; i < sampleLogs.length; i += 50) {
      const batch = sampleLogs.slice(i, i + 50);
      const stmts = batch.map((lg) =>
        db.prepare(`
          INSERT INTO document_journal_link_backfill_log
            (id, run_id, document_id, journal_entry_id, action, reason, match_tier)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(crypto.randomUUID(), runId, lg.doc_id, lg.entry_id || null, lg.action, lg.reason, lg.tier ?? null)
      );
      await db.batch(stmts);
    }
  }

  return c.json(result);
});

// GET /api/links/backfill-status — 현재 링크 / 검수 큐 / 로그 요약
links.get('/backfill-status', requireRole(...REVIEW_ROLES), async (c) => {
  const db = c.env.DB;
  const linkCount = await db.prepare("SELECT COUNT(*) as c, source FROM document_journal_links GROUP BY source").all();
  const candCount = await db.prepare("SELECT COUNT(*) as c, status FROM document_journal_link_candidates GROUP BY status").all();
  const lastRun = await db.prepare("SELECT run_id, MAX(created_at) as last_at, COUNT(*) as logs FROM document_journal_link_backfill_log GROUP BY run_id ORDER BY last_at DESC LIMIT 5").all();
  return c.json({
    links: linkCount.results,
    candidates: candCount.results,
    recent_runs: lastRun.results,
  });
});

// ─────────────────────────────────────────────────────────
// 일반 link CRUD — 보고서 작성 UI에서 사용
// ─────────────────────────────────────────────────────────

// GET /api/links/my-outdoor-entries
// 본인의 외근 entries (link 안 된 것 + 특정 문서에 이미 link된 것)
// query: ?for_doc_id=<document_id> (현재 편집 중인 문서, 그 문서에 link된 entry는 제외 안 함)
links.get('/my-outdoor-entries', async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const forDocId = c.req.query('for_doc_id') || '';

  // 본인 외근 일지 entries 전체 조회 (최근 60일)
  const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  const entriesRes = await db.prepare(`
    SELECT id, target_date, activity_type, activity_subtype, data
    FROM journal_entries
    WHERE user_id = ?
      AND activity_type IN ('입찰','임장','미팅')
      AND target_date >= ?
    ORDER BY target_date DESC, created_at DESC
  `).bind(user.sub, sixtyDaysAgo).all();
  const entries = (entriesRes.results || []) as Array<{ id: string; target_date: string; activity_type: string; activity_subtype: string; data: string }>;

  // 외근 entries만 필터
  const outdoorEntries = entries.filter((e) => isOutdoorEntry(e.activity_type, e.data));

  // 다른 문서에 이미 link된 entry id 조회
  const linkedRes = await db.prepare(`
    SELECT journal_entry_id, document_id
    FROM document_journal_links
    WHERE link_type = 'outdoor'
  `).all();
  const linkedToOther = new Map<string, string>();      // entry_id → other_doc_id
  const linkedToCurrent = new Set<string>();             // entry_id (현재 문서에 link된)
  for (const r of (linkedRes.results || []) as Array<{ journal_entry_id: string; document_id: string }>) {
    if (r.document_id === forDocId) {
      linkedToCurrent.add(r.journal_entry_id);
    } else {
      linkedToOther.set(r.journal_entry_id, r.document_id);
    }
  }

  // 응답 가공
  const items = outdoorEntries.map((e) => {
    let parsed: any = {};
    try { parsed = JSON.parse(e.data); } catch { /* */ }
    const otherDoc = linkedToOther.get(e.id);
    return {
      id: e.id,
      target_date: e.target_date,
      activity_type: e.activity_type,
      activity_subtype: e.activity_subtype,
      time_from: parsed.timeFrom || '',
      time_to: parsed.timeTo || '',
      place: parsed.place || '',
      case_no: parsed.caseNo || '',
      client: parsed.client || '',
      court: parsed.court || '',
      linked_to_other_doc: otherDoc || null,
      linked_to_current_doc: linkedToCurrent.has(e.id),
    };
  });

  return c.json({ entries: items });
});

// POST /api/links — link 생성 (다건 가능)
// body: { document_id: string, journal_entry_ids: string[], link_type?: 'outdoor' }
links.post('/', async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const body = await c.req.json<{ document_id: string; journal_entry_ids: string[]; link_type?: string }>();
  const linkType = body.link_type || 'outdoor';
  const docId = body.document_id;
  const entryIds = body.journal_entry_ids || [];

  if (!docId || entryIds.length === 0) {
    return c.json({ error: 'document_id와 journal_entry_ids가 필요합니다.' }, 400);
  }

  // 문서 권한 확인 (본인 문서이거나 master/cc_ref/ceo)
  const doc = await db.prepare('SELECT id, author_id FROM documents WHERE id = ?').bind(docId).first<{ id: string; author_id: string }>();
  if (!doc) return c.json({ error: '문서를 찾을 수 없습니다.' }, 404);
  const isPriv = ['master', 'ceo', 'cc_ref'].includes(user.role);
  if (doc.author_id !== user.sub && !isPriv) {
    return c.json({ error: '권한이 없습니다.' }, 403);
  }

  // 일지 entries가 본인 것인지 확인 + 외근 entries인지 확인
  const placeholders = entryIds.map(() => '?').join(',');
  const checkRes = await db.prepare(
    `SELECT id, user_id, activity_type, data FROM journal_entries WHERE id IN (${placeholders})`
  ).bind(...entryIds).all();
  const validEntries = (checkRes.results || []) as Array<{ id: string; user_id: string; activity_type: string; data: string }>;
  if (validEntries.length !== entryIds.length) {
    return c.json({ error: '일부 일지 entry를 찾을 수 없습니다.' }, 400);
  }
  for (const e of validEntries) {
    if (e.user_id !== doc.author_id && !isPriv) {
      return c.json({ error: '본인의 일지 entry만 link할 수 있습니다.' }, 403);
    }
    if (linkType === 'outdoor' && !isOutdoorEntry(e.activity_type, e.data)) {
      return c.json({ error: `outdoor link은 외근 entry만 가능합니다 (${e.activity_type})` }, 400);
    }
  }

  // INSERT (UNIQUE 위반은 무시)
  const stmts = entryIds.map((eid) =>
    db.prepare(`
      INSERT OR IGNORE INTO document_journal_links
        (id, document_id, journal_entry_id, link_type, created_by, source)
      VALUES (?, ?, ?, ?, ?, 'manual')
    `).bind(crypto.randomUUID(), docId, eid, linkType, user.sub)
  );
  await db.batch(stmts);

  // 결과 조회
  const created = await db.prepare(
    `SELECT id, document_id, journal_entry_id FROM document_journal_links WHERE document_id = ? AND link_type = ?`
  ).bind(docId, linkType).all();
  return c.json({ success: true, links: created.results });
});

// DELETE /api/links/:id
links.delete('/:id', async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const id = c.req.param('id');

  const link = await db.prepare(`
    SELECT djl.id, djl.document_id, d.author_id
    FROM document_journal_links djl
    JOIN documents d ON d.id = djl.document_id
    WHERE djl.id = ?
  `).bind(id).first<{ id: string; document_id: string; author_id: string }>();
  if (!link) return c.json({ error: 'link을 찾을 수 없습니다.' }, 404);

  const isPriv = ['master', 'ceo', 'cc_ref'].includes(user.role);
  if (link.author_id !== user.sub && !isPriv) {
    return c.json({ error: '권한이 없습니다.' }, 403);
  }

  await db.prepare('DELETE FROM document_journal_links WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

// ─────────────────────────────────────────────────────────
// 검수 큐 (Backfill Tier 3/4)
// ─────────────────────────────────────────────────────────

// GET /api/links/review-queue — 검수 대기 후보 목록
links.get('/review-queue', requireRole(...REVIEW_ROLES), async (c) => {
  const db = c.env.DB;
  const status = c.req.query('status') || 'pending';

  const candRes = await db.prepare(`
    SELECT djlc.*, d.title as doc_title, d.author_id, d.created_at as doc_created_at,
      d.status as doc_status, u.name as author_name
    FROM document_journal_link_candidates djlc
    JOIN documents d ON d.id = djlc.document_id
    LEFT JOIN users u ON u.id = d.author_id
    WHERE djlc.status = ?
    ORDER BY djlc.match_tier ASC, djlc.created_at ASC
  `).bind(status).all();
  const candidates = (candRes.results || []) as Array<any>;

  // 후보 entry 정보 일괄 조회
  const allEntryIds = new Set<string>();
  for (const cand of candidates) {
    try {
      const ids = JSON.parse(cand.candidate_journal_entry_ids) as string[];
      ids.forEach((id) => allEntryIds.add(id));
    } catch { /* */ }
  }

  const entryMap: Record<string, any> = {};
  if (allEntryIds.size > 0) {
    const ids = Array.from(allEntryIds);
    const placeholders = ids.map(() => '?').join(',');
    const eRes = await db.prepare(`
      SELECT id, target_date, activity_type, activity_subtype, data, user_id
      FROM journal_entries WHERE id IN (${placeholders})
    `).bind(...ids).all();
    for (const e of (eRes.results || []) as any[]) {
      let parsed: any = {};
      try { parsed = JSON.parse(e.data); } catch { /* */ }
      entryMap[e.id] = {
        ...e,
        time_from: parsed.timeFrom || '',
        time_to: parsed.timeTo || '',
        place: parsed.place || '',
        case_no: parsed.caseNo || '',
        client: parsed.client || '',
      };
    }
  }

  const items = candidates.map((cand) => {
    let entryIds: string[] = [];
    try { entryIds = JSON.parse(cand.candidate_journal_entry_ids); } catch { /* */ }
    return {
      id: cand.id,
      document_id: cand.document_id,
      doc_title: cand.doc_title,
      doc_status: cand.doc_status,
      doc_created_at: cand.doc_created_at,
      author_id: cand.author_id,
      author_name: cand.author_name,
      match_tier: cand.match_tier,
      body_outing_text: cand.document_outing_date_text,
      body_outing_parsed: cand.document_outing_date_parsed,
      candidates: entryIds.map((eid) => entryMap[eid]).filter(Boolean),
      created_at: cand.created_at,
    };
  });

  return c.json({ items });
});

// POST /api/links/review/:id/resolve — 검수 후 link 생성 (선택된 entries)
links.post('/review/:id/resolve', requireRole(...REVIEW_ROLES), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const id = c.req.param('id');
  const body = await c.req.json<{ journal_entry_ids: string[] }>();
  const entryIds = body.journal_entry_ids || [];

  const cand = await db.prepare('SELECT * FROM document_journal_link_candidates WHERE id = ?').bind(id).first<any>();
  if (!cand) return c.json({ error: '후보를 찾을 수 없습니다.' }, 404);
  if (cand.status !== 'pending') return c.json({ error: '이미 처리된 후보입니다.' }, 400);

  if (entryIds.length === 0) {
    // 매칭 없음으로 종료
    await db.prepare(`
      UPDATE document_journal_link_candidates
      SET status = 'skipped', reviewed_by = ?, reviewed_at = datetime('now')
      WHERE id = ?
    `).bind(user.sub, id).run();
    return c.json({ success: true, action: 'skipped' });
  }

  // link 생성
  const stmts = entryIds.map((eid) =>
    db.prepare(`
      INSERT OR IGNORE INTO document_journal_links
        (id, document_id, journal_entry_id, link_type, created_by, source)
      VALUES (?, ?, ?, 'outdoor', ?, 'backfill_review')
    `).bind(crypto.randomUUID(), cand.document_id, eid, user.sub)
  );
  await db.batch(stmts);

  await db.prepare(`
    UPDATE document_journal_link_candidates
    SET status = 'resolved', reviewed_by = ?, reviewed_at = datetime('now')
    WHERE id = ?
  `).bind(user.sub, id).run();

  return c.json({ success: true, action: 'resolved', linked_count: entryIds.length });
});

// GET /api/links/effective-entry-ids?since=YYYY-MM-DD&link_type=outdoor
// 활성 link가 걸린 일지 entry IDs 반환 (Dashboard 알림 검사용)
// 활성 = 문서 status IN ('submitted','approved') AND cancelled = 0
links.get('/effective-entry-ids', async (c) => {
  const db = c.env.DB;
  const since = c.req.query('since') || '';
  const linkType = c.req.query('link_type') || 'outdoor';

  let query = `
    SELECT djl.journal_entry_id
    FROM document_journal_links djl
    JOIN documents d ON d.id = djl.document_id
    JOIN journal_entries je ON je.id = djl.journal_entry_id
    WHERE djl.link_type = ?
      AND d.status IN ('submitted','approved')
      AND COALESCE(d.cancelled, 0) = 0
  `;
  const params: any[] = [linkType];
  if (since) {
    query += ' AND je.target_date >= ?';
    params.push(since);
  }

  const result = await db.prepare(query).bind(...params).all();
  const ids = (result.results || []).map((r: any) => r.journal_entry_id as string);
  return c.json({ entry_ids: ids });
});

// GET /api/links/by-document/:doc_id — 특정 문서에 link된 entries
links.get('/by-document/:doc_id', async (c) => {
  const db = c.env.DB;
  const docId = c.req.param('doc_id');
  const result = await db.prepare(`
    SELECT djl.id as link_id, djl.journal_entry_id, djl.link_type, djl.created_at,
      je.target_date, je.activity_type, je.activity_subtype, je.data
    FROM document_journal_links djl
    JOIN journal_entries je ON je.id = djl.journal_entry_id
    WHERE djl.document_id = ?
    ORDER BY je.target_date DESC
  `).bind(docId).all();
  return c.json({ links: result.results });
});

export default links;
