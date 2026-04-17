import { Hono } from 'hono';
import type { AuthEnv } from '../types';
import { authMiddleware, requireRole } from '../middleware/auth';

// KST (한국 시간) 기준 날짜 — 연도별 공휴일
const HOLIDAYS: Record<string, string[]> = {
  '2026': [
    '2026-01-01','2026-01-28','2026-01-29','2026-01-30','2026-03-01',
    '2026-05-05','2026-05-24','2026-06-06','2026-08-15',
    '2026-09-24','2026-09-25','2026-09-26','2026-10-03','2026-10-09','2026-12-25',
  ],
  '2027': [
    '2027-01-01','2027-02-15','2027-02-16','2027-02-17','2027-03-01',
    '2027-05-05','2027-05-13','2027-06-06','2027-08-15',
    '2027-10-13','2027-10-14','2027-10-15','2027-10-03','2027-10-09','2027-12-25',
  ],
};
const ALL_HOLIDAYS = new Set(Object.values(HOLIDAYS).flat());

function fmtDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function isOffDay(d: Date): boolean {
  const day = d.getUTCDay();
  return day === 0 || day === 6 || ALL_HOLIDAYS.has(fmtDate(d));
}

function prevBizDay(d: Date): Date {
  let r = new Date(d.getTime());
  while (isOffDay(r)) r = new Date(r.getTime() - 86400000);
  return r;
}

function getKSTToday(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return isOffDay(kst) ? fmtDate(prevBizDay(kst)) : fmtDate(kst);
}

interface JournalEntry {
  id: string;
  user_id: string;
  target_date: string;
  activity_type: string;
  activity_subtype: string;
  data: string;
  completed: number;
  fail_reason: string;
  branch: string;
  department: string;
  created_at: string;
  updated_at: string;
}

const journal = new Hono<AuthEnv>();
journal.use('*', authMiddleware);

// GET /api/journal?date=2026-03-30&range=all
journal.get('/', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const date = c.req.query('date');
  const range = c.req.query('range');

  let query = 'SELECT j.*, u.name as user_name, u.role as user_role FROM journal_entries j LEFT JOIN users u ON j.user_id = u.id';
  const conditions: string[] = [];
  const params: string[] = [];

  // Permission filter: member는 같은 지사 전체 일지 열람 가능
  if (user.role === 'member') {
    conditions.push('j.branch = ?');
    params.push(user.branch);
  } else if (user.role === 'manager') {
    conditions.push('j.branch = ?');
    params.push(user.branch);
  } else if (user.role === 'admin' && user.branch === '의정부') {
    // 의정부 관리자: 전체 열람
  } else if (user.role === 'admin') {
    conditions.push('j.branch = ?');
    params.push(user.branch);
  }

  if (date) {
    conditions.push('j.target_date = ?');
    params.push(date);
  } else if (range === 'today') {
    conditions.push("j.target_date = date('now')");
  } else if (range === 'week') {
    conditions.push("j.target_date >= date('now', '-7 days')");
  } else if (range === 'month') {
    conditions.push("j.target_date >= date('now', '-30 days')");
  }

  if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY j.target_date DESC, j.created_at DESC';

  const stmt = db.prepare(query);
  const result = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
  return c.json({ entries: result.results });
});

// GET /api/journal/members - 권한 범위 내 전체 사용자 목록 (팀/지사별)
journal.get('/members', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  let query = "SELECT id, name, role, branch, department, position_title, login_type FROM users WHERE approved = 1 AND role != 'master'";
  const params: string[] = [];

  if (user.role === 'member') {
    query += ' AND branch = ?';
    params.push(user.branch);
  } else if (user.role === 'manager') {
    query += ' AND branch = ?';
    params.push(user.branch);
  } else if (user.role === 'admin' && user.branch === '의정부') {
    // 의정부 관리자: 전체 열람
  } else if (user.role === 'admin') {
    query += ' AND branch = ?';
    params.push(user.branch);
  }

  query += " ORDER BY branch, department, CASE role WHEN 'master' THEN 1 WHEN 'ceo' THEN 2 WHEN 'cc_ref' THEN 2 WHEN 'admin' THEN 3 WHEN 'manager' THEN 4 WHEN 'member' THEN 5 END, name";
  const stmt = db.prepare(query);
  const result = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
  return c.json({ members: result.results });
});

// POST /api/journal
journal.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{
    target_date: string;
    activity_type: string;
    activity_subtype?: string;
    data: Record<string, unknown>;
  }>();

  if (!body.target_date || !body.activity_type) {
    return c.json({ error: '날짜와 활동 유형은 필수입니다.' }, 400);
  }

  const today = getKSTToday();
  // 과거 날짜 등록 불가 (master/ceo/cc_ref 제외)
  if (body.target_date < today && !['master', 'ceo', 'cc_ref'].includes(user.role)) {
    return c.json({ error: '과거 날짜에는 일정을 등록할 수 없습니다.' }, 400);
  }
  // 오늘 일정은 18시 이후 등록 불가 (ceo/cc_ref/master 제외)
  if (body.target_date === today && !['master', 'ceo', 'cc_ref'].includes(user.role)) {
    const hour = new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCHours();
    if (hour >= 18) {
      return c.json({ error: '오늘 일정은 18시 이후 등록할 수 없습니다.' }, 400);
    }
  }

  const db = c.env.DB;
  const id = crypto.randomUUID();

  await db.prepare(
    'INSERT INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, user.sub, body.target_date, body.activity_type, body.activity_subtype || '', JSON.stringify(body.data), user.branch, user.department).run();

  return c.json({ entry: { id, target_date: body.target_date, activity_type: body.activity_type } }, 201);
});

// PUT /api/journal/:id
journal.put('/:id', async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const db = c.env.DB;

  const entry = await db.prepare('SELECT * FROM journal_entries WHERE id = ?').bind(id).first<JournalEntry>();
  if (!entry) return c.json({ error: '일지를 찾을 수 없습니다.' }, 404);
  if (entry.user_id !== user.sub && !['master', 'ceo', 'cc_ref'].includes(user.role)) return c.json({ error: '권한이 없습니다.' }, 403);

  const today = getKSTToday();
  const isTopRole = ['master', 'ceo', 'cc_ref'].includes(user.role);
  const isAdminPlus = ['master', 'ceo', 'cc_ref', 'admin'].includes(user.role);
  const isBidEntry = entry.activity_type === '입찰';

  const body = await c.req.json<{
    activity_subtype?: string; data?: Record<string, unknown>; completed?: number; fail_reason?: string;
    bid_field_only?: boolean; // 낙찰가/입찰가만 수정하는 경우
  }>();

  // 시간 제한 체크 (admin 이상은 모든 날짜 수정 가능)
  if (!isTopRole && !isAdminPlus) {
    if (entry.target_date < today) {
      // 과거 일지: 입찰의 낙찰가/입찰가만 허용
      if (isBidEntry && body.bid_field_only) {
        // 허용: 입찰 필드만 수정
      } else {
        return c.json({ error: '지난 일정은 수정할 수 없습니다.' }, 400);
      }
    } else if (entry.target_date === today) {
      const hour = new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCHours();
      if (hour >= 18) {
        // 오늘 18시 이후: 입찰 낙찰가/입찰가만 허용
        if (isBidEntry && body.bid_field_only) {
          // 허용
        } else {
          return c.json({ error: '오늘 일정은 18시 이후 수정할 수 없습니다.' }, 400);
        }
      }
    }
    // 내일 일지: 언제든 수정 가능 (제한 없음)
  }

  await db.prepare(
    "UPDATE journal_entries SET activity_subtype = ?, data = ?, completed = ?, fail_reason = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(body.activity_subtype ?? entry.activity_subtype, body.data ? JSON.stringify(body.data) : entry.data, body.completed ?? entry.completed, body.fail_reason ?? entry.fail_reason, id).run();

  return c.json({ success: true });
});

// DELETE /api/journal/:id
journal.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const db = c.env.DB;

  const entry = await db.prepare('SELECT * FROM journal_entries WHERE id = ?').bind(id).first<JournalEntry>();
  if (!entry) return c.json({ error: '일지를 찾을 수 없습니다.' }, 404);
  if (entry.user_id !== user.sub && !['master', 'ceo', 'cc_ref'].includes(user.role)) return c.json({ error: '권한이 없습니다.' }, 403);

  const today = getKSTToday();
  if (entry.target_date < today && !['master', 'ceo', 'cc_ref'].includes(user.role)) return c.json({ error: '지난 일정은 삭제할 수 없습니다.' }, 400);

  await db.prepare('DELETE FROM journal_entries WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

// POST /api/journal/dismiss-alert — 알림 삭제 (마스터 전용)
journal.post('/dismiss-alert', requireRole('master'), async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const { alert_type, alert_key } = await c.req.json<{ alert_type: string; alert_key: string }>();
  const id = crypto.randomUUID();
  await db.prepare('INSERT OR IGNORE INTO dismissed_alerts (id, alert_type, alert_key, dismissed_by) VALUES (?, ?, ?, ?)')
    .bind(id, alert_type, alert_key, user.sub).run();
  return c.json({ success: true });
});

// POST /api/journal/dismiss-alerts-bulk — 알림 일괄 삭제
journal.post('/dismiss-alerts-bulk', requireRole('master'), async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const { keys } = await c.req.json<{ keys: { alert_type: string; alert_key: string }[] }>();
  for (const k of keys) {
    const id = crypto.randomUUID();
    await db.prepare('INSERT OR IGNORE INTO dismissed_alerts (id, alert_type, alert_key, dismissed_by) VALUES (?, ?, ?, ?)')
      .bind(id, k.alert_type, k.alert_key, user.sub).run();
  }
  return c.json({ success: true, count: keys.length });
});

// GET /api/journal/dismissed-alerts — 삭제된 알림 목록
journal.get('/dismissed-alerts', async (c) => {
  const db = c.env.DB;
  const result = await db.prepare('SELECT alert_key FROM dismissed_alerts').all();
  return c.json({ keys: (result.results || []).map((r: any) => r.alert_key) });
});

// GET /api/journal/duplicate-inspections — 중복 임장 사건번호+법원 조회
// 열람 권한:
//   - master/ceo/cc_ref/admin/director: 전체 열람 가능
//   - manager (팀장): 본인 팀에 관련된 중복건만
//   - member 등 일반 팀원: 본인이 관련된 중복건만
//   - accountant/총무 계열: 열람 없음
journal.get('/duplicate-inspections', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  // 사용자 지사 확인
  const profile = await db.prepare('SELECT branch, department FROM users WHERE id = ?').bind(user.sub).first<{ branch: string; department: string }>();
  const branch = profile?.branch || '';
  const department = profile?.department || '';

  const isTopRole = ['master', 'ceo', 'cc_ref', 'admin', 'director'].includes(user.role);
  const isManager = user.role === 'manager';
  const isMember = user.role === 'member';

  // 알림 종료 조건:
  //   1) 같은 사건번호+법원+지사로 '입찰' 일지가 등록됨 → 알림 제외
  //   2) 첫 임장 등록일 기준 1개월(30일) 경과 → 알림 제외
  let query = `
    SELECT j.activity_subtype as case_no,
           json_extract(j.data, '$.court') as court,
           j.branch,
           GROUP_CONCAT(DISTINCT u.name) as user_names,
           GROUP_CONCAT(DISTINCT j.user_id) as user_ids,
           GROUP_CONCAT(DISTINCT u.department) as user_departments,
           COUNT(DISTINCT j.user_id) as user_count,
           MIN(j.target_date) as first_date,
           MAX(j.target_date) as last_date
    FROM journal_entries j
    LEFT JOIN users u ON j.user_id = u.id
    WHERE j.activity_type = '임장'
      AND j.activity_subtype != ''
      AND NOT EXISTS (
        SELECT 1 FROM journal_entries jb
        WHERE jb.activity_type = '입찰'
          AND jb.activity_subtype = j.activity_subtype
          AND json_extract(jb.data, '$.court') = json_extract(j.data, '$.court')
          AND jb.branch = j.branch
      )
  `;
  const params: string[] = [];

  // 권한별 지사/팀 필터
  // - 상위자(master/ceo/cc_ref/admin/director): 기본 전체 지사 (항상 전부 노출)
  // - 일반 사용자: 본인 지사 고정
  if (!isTopRole) {
    query += ' AND j.branch = ?';
    params.push(branch);
  }
  // 상위자는 별도 지사 필터 없음 (전체 노출)

  // 팀원/팀장은 관련 건만 볼 수 있게 후처리 필터링용 변수 (GROUP BY 결과 이후 필터)
  const memberOnlyMine = isMember;
  const managerOnlyMyTeam = isManager;

  query += `
    GROUP BY j.activity_subtype, json_extract(j.data, '$.court'), j.branch
    HAVING COUNT(DISTINCT j.user_id) > 1
       AND MIN(j.target_date) >= date('now', '-30 days')
    ORDER BY MAX(j.target_date) DESC
  `;

  const rows = params.length > 0
    ? await db.prepare(query).bind(...params).all()
    : await db.prepare(query).all();

  let results = rows.results || [];

  // 팀원: 본인이 관련된 중복건만
  if (memberOnlyMine) {
    results = results.filter((r: any) => {
      const ids = (r.user_ids || '').split(',');
      return ids.includes(user.sub);
    });
  }

  // 팀장: 본인 지사+부서에 속한 팀원이 관련된 중복건만
  if (managerOnlyMyTeam) {
    results = results.filter((r: any) => {
      // 해당 중복건 관련자의 department 중 본인 부서가 있는지
      const depts = (r.user_departments || '').split(',').map((d: string) => d.trim());
      return r.branch === branch && depts.includes(department);
    });
  }

  return c.json({ duplicates: results });
});

// GET /api/journal/check-case-no?case_no=xxx&court=yyy — 특정 사건번호+법원 중복 체크 (같은 지사)
journal.get('/check-case-no', async (c) => {
  const caseNo = c.req.query('case_no');
  const court = c.req.query('court');
  if (!caseNo) return c.json({ exists: false, entries: [] });

  const user = c.get('user');
  const db = c.env.DB;

  let query = `
    SELECT j.id, j.user_id, u.name as user_name, j.target_date, json_extract(j.data, '$.court') as court
    FROM journal_entries j
    LEFT JOIN users u ON j.user_id = u.id
    WHERE j.activity_type = '임장'
      AND j.activity_subtype = ?
      AND j.user_id != ?
      AND j.branch = ?
  `;
  const params: string[] = [caseNo, user.sub, user.branch];

  if (court) {
    query += ' AND json_extract(j.data, \'$.court\') = ?';
    params.push(court);
  }
  query += ' ORDER BY j.target_date DESC';

  const rows = await db.prepare(query).bind(...params).all();
  return c.json({ exists: (rows.results || []).length > 0, entries: rows.results || [] });
});

export default journal;
