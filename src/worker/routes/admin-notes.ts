import { Hono } from 'hono';
import type { AuthEnv, Role } from '../types';
import { authMiddleware } from '../middleware/auth';
import { sendCommunityCommentAlimtalk, sendCommunityNoteCreatedAlimtalk } from '../lib/community-alimtalk';
import { recheckAlertsAfterEntryDelete, recheckAlertsForJournalEntry } from '../lib/journal-alerts';
import { articleObjectKey, ensureArticlePdfTable, safePdfFileName, sha256Hex } from '../lib/article-pdfs';
import { ensureBidAnalysisTable, makeBidDedupeKey, normalizeAmount, normalizeBidResult } from '../lib/bid-analysis';
import { normalizeBranchName, sameBranchName } from '../lib/branchAliases';

const ADMIN_ROLES: Role[] = ['master', 'ceo', 'cc_ref', 'admin'];
const NOTE_CATEGORIES = ['community', 'notice', 'article_news', 'briefing_schedule', 'eviction_quote', 'legal_support'] as const;
type NoteCategory = typeof NOTE_CATEGORIES[number];
const LEGAL_SUBCATEGORIES = ['auction', 'lawsuit', 'legal_terms', 'fee_calculation'] as const;
type LegalSubcategory = typeof LEGAL_SUBCATEGORIES[number];
const KST_NOW_SQL = "datetime('now', '+9 hours')";
const MAX_ARTICLE_PDF_BYTES = 20 * 1024 * 1024;

const adminNotes = new Hono<AuthEnv>();

adminNotes.use('*', authMiddleware);

async function ensureAdminNoteExtensions(db: D1Database): Promise<void> {
  const columns = [
    'ALTER TABLE admin_notes ADD COLUMN category TEXT DEFAULT "community"',
    'ALTER TABLE admin_notes ADD COLUMN court TEXT',
    'ALTER TABLE admin_notes ADD COLUMN case_number TEXT',
    'ALTER TABLE admin_notes ADD COLUMN legal_subcategory TEXT DEFAULT "lawsuit"',
    'ALTER TABLE admin_notes ADD COLUMN assignee_id TEXT',
    'ALTER TABLE admin_notes ADD COLUMN target_date TEXT',
    'ALTER TABLE admin_notes ADD COLUMN item_no TEXT',
    'ALTER TABLE admin_notes ADD COLUMN client_name TEXT',
    'ALTER TABLE admin_notes ADD COLUMN journal_entry_id TEXT',
    'ALTER TABLE admin_notes ADD COLUMN lawsuit_cost_requested INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE admin_notes ADD COLUMN source_type TEXT',
    'ALTER TABLE admin_notes ADD COLUMN source_id TEXT',
    'ALTER TABLE admin_notes ADD COLUMN is_anonymous INTEGER DEFAULT 0',
    'ALTER TABLE admin_notes ADD COLUMN visibility TEXT DEFAULT "all"',
    'ALTER TABLE admin_notes ADD COLUMN author_branch TEXT',
    'ALTER TABLE admin_notes ADD COLUMN author_department TEXT',
    'ALTER TABLE admin_notes ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0',
  ];
  for (const sql of columns) {
    try { await db.prepare(sql).run(); } catch { /* already exists */ }
  }
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS admin_note_attachments (
      id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_type TEXT DEFAULT '',
      file_size INTEGER DEFAULT 0,
      file_data TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now', '+9 hours')),
      FOREIGN KEY (note_id) REFERENCES admin_notes(id) ON DELETE CASCADE
    )
  `).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_admin_notes_category ON admin_notes(category)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_admin_notes_legal_subcategory ON admin_notes(legal_subcategory)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_admin_notes_journal_entry ON admin_notes(journal_entry_id)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_admin_note_attachments_note ON admin_note_attachments(note_id)').run();
  await ensureArticlePdfTable(db);
}

function normalizeCategory(category: unknown): NoteCategory {
  return NOTE_CATEGORIES.includes(category as NoteCategory) ? category as NoteCategory : 'community';
}

function normalizeLegalSubcategory(value: unknown): LegalSubcategory {
  if (value === 'consultation') return 'lawsuit';
  if (value === 'law_reference') return 'legal_terms';
  return LEGAL_SUBCATEGORIES.includes(value as LegalSubcategory) ? value as LegalSubcategory : 'lawsuit';
}

function canCreateBriefingSchedule(role: string) {
  return ADMIN_ROLES.includes(role as Role);
}

function canManageBidHistory(role: string) {
  return ADMIN_ROLES.includes(role as Role);
}

function normalizeBidAnalysisPayload(raw: any) {
  const bidResult = normalizeBidResult(raw?.bid_result ?? raw?.is_won);
  return {
    bid_datetime: String(raw?.bid_datetime || raw?.bid_date || '').trim(),
    assignee_name: String(raw?.assignee_name || '').trim(),
    branch_name: String(raw?.branch_name || '').trim(),
    case_number: String(raw?.case_number || '').trim(),
    property_type: String(raw?.property_type || '').trim(),
    suggested_bid_price: normalizeAmount(raw?.suggested_bid_price),
    actual_bid_price: normalizeAmount(raw?.actual_bid_price),
    winning_price: normalizeAmount(raw?.winning_price),
    bid_result: bidResult,
    client_name: String(raw?.client_name || '').trim(),
  };
}

function canCreateNotice(role: string) {
  return ['master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst'].includes(role);
}

function canCreateLegalTerms(role: string, department?: string | null) {
  return ADMIN_ROLES.includes(role as Role) || role === 'support' || String(department || '').includes('법률지원');
}

function canAnswerLegalSubcategory(legalSubcategory?: string | null) {
  return normalizeLegalSubcategory(legalSubcategory) !== 'legal_terms';
}

function shouldTrackLawsuitCost(legalSubcategory?: string | null) {
  const normalized = normalizeLegalSubcategory(legalSubcategory);
  return normalized === 'auction' || normalized === 'lawsuit';
}

const LEGAL_SUBCATEGORY_SQL = `CASE COALESCE(n.legal_subcategory, 'lawsuit')
  WHEN 'consultation' THEN 'lawsuit'
  WHEN 'law_reference' THEN 'legal_terms'
  ELSE COALESCE(n.legal_subcategory, 'lawsuit')
END`;

function canReadNote(note: any, viewer: any, viewerInfo: { branch?: string | null; department?: string | null } | null, role: string): boolean {
  if (role === 'master' || note.author_id === viewer.sub) return true;
  const v = note.visibility || 'all';
  return v === 'all' ||
    (v === 'branch' && sameBranchName(note.author_branch, viewerInfo?.branch)) ||
    (v === 'department' && sameBranchName(note.author_branch, viewerInfo?.branch) && note.author_department === viewerInfo?.department) ||
    (v.startsWith('team:') && v === 'team:' + viewerInfo?.department) ||
    (v.startsWith('user:') && v === 'user:' + viewer.sub);
}

function kstDateString(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function normalizeArticleDate(raw: unknown): string | null {
  const value = String(raw || '').trim() || kstDateString();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : value;
}

function pdfContentDisposition(fileName: string): string {
  return `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

async function resolveArticleApiAuthor(db: D1Database, user: any) {
  if (user.auth_type !== 'service_token') {
    const profile = await db.prepare(
      'SELECT branch, department, position_title, role FROM users WHERE id = ?'
    ).bind(user.sub).first<{ branch: string; department: string; position_title: string; role: string }>();
    return {
      id: user.sub,
      name: user.name,
      branch: profile?.branch || '',
      department: profile?.department || '',
      role: profile?.role || user.role,
    };
  }

  const fallback = await db.prepare(`
    SELECT id, branch, department, role
    FROM users
    WHERE approved = 1 AND role IN ('master', 'ceo', 'admin')
    ORDER BY CASE role WHEN 'master' THEN 1 WHEN 'ceo' THEN 2 ELSE 3 END, created_at ASC
    LIMIT 1
  `).first<{ id: string; branch: string; department: string; role: string }>();
  return {
    id: fallback?.id || user.sub,
    name: '외부 기사 API',
    branch: fallback?.branch || '',
    department: fallback?.department || '',
    role: fallback?.role || user.role,
  };
}

function makeBriefingContent(payload: { targetDate: string; assigneeName: string; court: string; caseNumber: string; itemNo?: string; clientName: string }) {
  return [
    `담당자: ${payload.assigneeName}`,
    `일정일: ${payload.targetDate}`,
    `법원: ${payload.court}`,
    `사건번호: ${payload.caseNumber}${payload.itemNo ? ` / 물건번호: ${payload.itemNo}` : ''}`,
    `계약자명: ${payload.clientName}`,
  ].join('\n');
}

export async function syncBriefingSchedulesFromJournal(db: D1Database): Promise<void> {
  const rows = await db.prepare(`
    SELECT j.id, j.user_id, j.target_date, j.activity_subtype, j.data, j.branch, j.department, j.created_at,
      u.name as user_name, u.branch as user_branch, u.department as user_department
    FROM journal_entries j
    LEFT JOIN users u ON u.id = j.user_id
    WHERE j.activity_type = '브리핑자료제출'
    ORDER BY j.target_date DESC, j.created_at DESC
  `).all<any>();

  for (const row of rows.results || []) {
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(String(row.data || '{}'));
    } catch {
      data = {};
    }

    const targetDate = String(row.target_date || '').trim();
    const assigneeId = String(row.user_id || '').trim();
    const assigneeName = String(row.user_name || '').trim();
    const court = String(data.briefingCourt || data.court || '').trim();
    const caseNumber = String(data.briefingCaseNo || row.activity_subtype || data.caseNo || '').trim();
    const itemNo = String(data.briefingItemNo || data.itemNo || '').trim();
    const clientName = String(data.client || data.clientName || data.bidder || '').trim();
    if (!targetDate || !assigneeId || !caseNumber) continue;

    const title = `${targetDate} ${assigneeName || '담당자'} 브리핑자료 제출`;
    const content = makeBriefingContent({
      targetDate,
      assigneeName: assigneeName || '담당자',
      court,
      caseNumber,
      itemNo,
      clientName,
    });
    const branch = String(row.branch || row.user_branch || '').trim();
    const department = String(row.department || row.user_department || '').trim();

    const existing = await db.prepare(`
      SELECT id
      FROM admin_notes
      WHERE COALESCE(category, 'community') = 'briefing_schedule'
        AND (
          journal_entry_id = ?
          OR (
            target_date = ?
            AND assignee_id = ?
            AND case_number = ?
            AND COALESCE(item_no, '') = ?
          )
        )
      ORDER BY CASE WHEN journal_entry_id = ? THEN 0 ELSE 1 END, created_at DESC
      LIMIT 1
    `).bind(row.id, targetDate, assigneeId, caseNumber, itemNo, row.id).first<{ id: string }>();

    if (existing?.id) {
      await db.prepare(`
        UPDATE admin_notes
        SET title = ?, content = ?, author_id = ?, author_name = ?, visibility = 'all',
          author_branch = ?, author_department = ?, category = 'briefing_schedule',
          court = ?, case_number = ?, assignee_id = ?, target_date = ?, item_no = ?,
          client_name = ?, journal_entry_id = ?, source_type = 'journal', source_id = ?,
          updated_at = ${KST_NOW_SQL}
        WHERE id = ?
      `).bind(
        title, content, assigneeId, assigneeName,
        branch, department, court, caseNumber, assigneeId, targetDate, itemNo,
        clientName, row.id, row.id, existing.id,
      ).run();
      continue;
    }

    await db.prepare(`
      INSERT INTO admin_notes (
        id, title, content, author_id, author_name, pinned, source_type, source_id,
        is_anonymous, visibility, author_branch, author_department, category,
        court, case_number, assignee_id, target_date, item_no, client_name,
        journal_entry_id, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, 0, 'journal', ?, 0, 'all', ?, ?, 'briefing_schedule',
        ?, ?, ?, ?, ?, ?, ?, COALESCE(?, ${KST_NOW_SQL}), ${KST_NOW_SQL})
    `).bind(
      crypto.randomUUID(), title, content, assigneeId, assigneeName, row.id,
      branch, department, court, caseNumber, assigneeId, targetDate, itemNo,
      clientName, row.id, row.created_at,
    ).run();
  }
}

// 익명 처리: 대표/관리자에겐 "익명 (이름 / 직책)", 일반에겐 "익명"
function maskNote(note: any, viewerRole: string) {
  const isAdmin = ADMIN_ROLES.includes(viewerRole as Role);
  if (isAdmin) {
    note.view_count = Math.ceil(Number(note.view_count || 0) * 1.35);
  } else {
    delete note.view_count;
  }
  if (!note.is_anonymous) return note;
  if (isAdmin) {
    note.display_name = `익명 (${note.author_name}${note.author_position ? ' / ' + note.author_position : ''})`;
  } else {
    note.display_name = '익명';
    delete note.author_name;
    delete note.author_position;
    delete note.author_id;
  }
  return note;
}

function maskComment(comment: any, viewerRole: string) {
  if (!comment.is_anonymous) return comment;
  const isAdmin = ADMIN_ROLES.includes(viewerRole as Role);
  if (isAdmin) {
    comment.display_name = `익명 (${comment.author_name}${comment.author_position ? ' / ' + comment.author_position : ''})`;
  } else {
    comment.display_name = '익명';
    delete comment.author_name;
    delete comment.author_position;
    delete comment.author_id;
  }
  return comment;
}

// GET /api/admin-notes - 목록 조회
function myAlertCategoryLabel(category: string | null, legalSubcategory?: string | null): string {
  if (category === 'legal_support') {
    const labels: Record<LegalSubcategory, string> = {
      auction: '경매',
      lawsuit: '소송',
      legal_terms: '법률용어',
      fee_calculation: '보수계산',
    };
    return labels[normalizeLegalSubcategory(legalSubcategory)];
  }
  if (category === 'notice') return '공지사항';
  if (category === 'eviction_quote') return '명도견적';
  if (category === 'briefing_schedule') return '브리핑자료 제출';
  if (category === 'article_news') return '오늘의 뉴스';
  return '커뮤니티';
}

async function loadSystemAlertSummary(db: D1Database, viewer: any) {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  if (['master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst'].includes(viewer.role || '')) {
    const pendingSales = await db.prepare(`
      SELECT COUNT(*) as cnt
      FROM sales_records
      WHERE status = 'pending' AND direction != 'expense'
    `).first<{ cnt: number }>();
    if ((pendingSales?.cnt || 0) > 0) {
      return { type: 'system_summary', priority: 4, label: '시스템', title: '입금 대기 매출', message: `${pendingSales!.cnt}건의 입금 대기 매출이 있습니다.`, link: '/sales', created_at: now };
    }
  }

  const myMissingDocs = await db.prepare(`
    SELECT COUNT(*) as cnt
    FROM sales_records
    WHERE user_id = ?
      AND status != 'refunded'
      AND type IN ('계약', '낙찰')
      AND COALESCE(contract_submitted, 0) = 0
      AND COALESCE(contract_not_submitted, 0) = 0
  `).bind(viewer.sub).first<{ cnt: number }>();
  if ((myMissingDocs?.cnt || 0) > 0) {
    return { type: 'system_summary', priority: 4, label: '시스템', title: '계약 관련 문서 미작성', message: `${myMissingDocs!.cnt}건의 미작성 문서가 있습니다.`, link: '/sales', created_at: now };
  }
  return null;
}

adminNotes.get('/my-alerts', async (c) => {
  const db = c.env.DB;
  await ensureAdminNoteExtensions(db);
  const viewer = c.get('user');
  const sinceSql = "datetime('now', '+9 hours', '-7 days')";

  const authored = await db.prepare(`
    SELECT n.id as note_id, n.title, n.category, n.legal_subcategory, n.updated_at,
      c.id as comment_id, c.author_name as comment_author_name,
      c.content as comment_content, c.created_at as comment_created_at,
      COUNT(*) OVER (PARTITION BY n.id) as comment_count
    FROM admin_notes n
    JOIN admin_note_comments c ON c.note_id = n.id
    WHERE n.author_id = ? AND c.author_id != ? AND c.created_at >= ${sinceSql}
    ORDER BY c.created_at DESC
    LIMIT 20
  `).bind(viewer.sub, viewer.sub).all<any>();

  const assigned = await db.prepare(`
    SELECT n.id as note_id, n.title, n.category, n.legal_subcategory, n.updated_at,
      c.id as comment_id, c.author_name as comment_author_name,
      c.content as comment_content, c.created_at as comment_created_at,
      COUNT(*) OVER (PARTITION BY n.id) as comment_count
    FROM admin_notes n
    JOIN admin_note_comments c ON c.note_id = n.id
    WHERE n.assignee_id = ? AND n.author_id != ? AND c.author_id != ? AND c.created_at >= ${sinceSql}
    ORDER BY c.created_at DESC
    LIMIT 20
  `).bind(viewer.sub, viewer.sub, viewer.sub).all<any>();

  const participated = await db.prepare(`
    SELECT n.id as note_id, n.title, n.category, n.legal_subcategory, n.updated_at,
      c.id as comment_id, c.author_name as comment_author_name,
      c.content as comment_content, c.created_at as comment_created_at,
      COUNT(*) OVER (PARTITION BY n.id) as comment_count
    FROM admin_notes n
    JOIN admin_note_comments mine ON mine.note_id = n.id AND mine.author_id = ?
    JOIN admin_note_comments c ON c.note_id = n.id
    WHERE n.author_id != ? AND c.author_id != ? AND c.created_at > mine.created_at AND c.created_at >= ${sinceSql}
    GROUP BY n.id, c.id
    ORDER BY c.created_at DESC
    LIMIT 20
  `).bind(viewer.sub, viewer.sub, viewer.sub).all<any>();

  const seen = new Set<string>();
  const makeLink = (category: string | null) => {
    if (category === 'legal_support') return '/admin-notes?tab=legal_support';
    if (category === 'notice') return '/admin-notes?section=notice';
    if (category === 'eviction_quote') return '/admin-notes?tab=eviction_quote';
    if (category === 'briefing_schedule') return '/bid-history';
    if (category === 'article_news') return '/admin-notes?section=article_news';
    return '/admin-notes';
  };
  const toAlert = (row: any, type: string, priority: number, titlePrefix: string) => {
    const key = `${type}:${row.note_id}:${row.comment_id || row.updated_at || ''}`;
    if (seen.has(key)) return null;
    seen.add(key);
    const label = myAlertCategoryLabel(row.category, row.legal_subcategory);
    const content = String(row.comment_content || '').replace(/\s+/g, ' ').trim();
    return {
      type,
      priority,
      label,
      note_id: row.note_id,
      title: `${titlePrefix}: ${row.title}`,
      message: row.comment_author_name ? `${row.comment_author_name}님의 댓글${content ? `: ${content.slice(0, 60)}` : ''}` : `${label} 글에 새 반응이 있습니다.`,
      comment_count: row.comment_count || 1,
      link: makeLink(row.category),
      created_at: row.comment_created_at || row.updated_at,
    };
  };

  const alerts = [
    ...(authored.results || []).map((r: any) => toAlert(r, 'authored_comment', 1, '내 글 답글')),
    ...(assigned.results || []).map((r: any) => toAlert(r, 'assigned_comment', 2, '담당 글 반응')),
    ...(participated.results || []).map((r: any) => toAlert(r, 'participated_comment', 3, '참여 글 새 댓글')),
  ].filter(Boolean) as any[];

  const systemAlert = await loadSystemAlertSummary(db, viewer).catch(() => null);
  if (systemAlert) alerts.push(systemAlert);

  alerts.sort((a, b) => (a.priority - b.priority) || String(b.created_at || '').localeCompare(String(a.created_at || '')));
  return c.json({ alerts: alerts.slice(0, 5) });
});

adminNotes.get('/', async (c) => {
  const db = c.env.DB;
  await ensureAdminNoteExtensions(db);
  const viewer = c.get('user');
  const category = normalizeCategory(c.req.query('category') || 'community');
  const search = (c.req.query('search') || '').trim();
  const legalSubcategory = normalizeLegalSubcategory(c.req.query('legal_subcategory') || 'lawsuit');

  // 사용자 정보 조회 (branch, department)
  const viewerInfo = await db.prepare(
    'SELECT branch, department, role FROM users WHERE id = ?'
  ).bind(viewer.sub).first<{ branch: string; department: string; role: string }>();
  if (!viewerInfo) return c.json({ error: '사용자 정보 오류' }, 400);

  const role = viewerInfo.role;
  if (category === 'briefing_schedule' && !canCreateBriefingSchedule(role)) {
    return c.json({ error: '브리핑자료 제출 카테고리 열람 권한이 없습니다.' }, 403);
  }
  // visibility 필터링 — master만 전체 열람, 그 외는 전부 visibility 조건 적용
  let notes;
  if (role === 'master') {
    // master: 전체 보기
    notes = await db.prepare(
      `SELECT n.*, u.position_title as author_position,
         (SELECT COUNT(*) FROM admin_note_comments WHERE note_id = n.id) as comment_count,
         ((SELECT COUNT(*) FROM admin_note_attachments WHERE note_id = n.id) + (SELECT COUNT(*) FROM article_pdf_uploads ap WHERE ap.note_id = n.id AND ap.deleted_at IS NULL)) as attachment_count
       FROM admin_notes n
       LEFT JOIN users u ON n.author_id = u.id
       WHERE COALESCE(n.category, 'community') = ?
         AND (? != 'legal_support' OR ${LEGAL_SUBCATEGORY_SQL} = ?)
         AND (? = '' OR n.title LIKE ? OR n.content LIKE ? OR n.author_name LIKE ? OR COALESCE(n.court, '') LIKE ? OR COALESCE(n.case_number, '') LIKE ? OR COALESCE(n.client_name, '') LIKE ? OR COALESCE(n.target_date, '') LIKE ?)
       ORDER BY n.pinned DESC, n.created_at DESC`
    ).bind(category, category, legalSubcategory, search, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`).all();
  } else {
    // 관리자급 포함 전체: visibility 조건 적용
    notes = await db.prepare(
      `SELECT n.*, u.position_title as author_position,
         (SELECT COUNT(*) FROM admin_note_comments WHERE note_id = n.id) as comment_count,
         ((SELECT COUNT(*) FROM admin_note_attachments WHERE note_id = n.id) + (SELECT COUNT(*) FROM article_pdf_uploads ap WHERE ap.note_id = n.id AND ap.deleted_at IS NULL)) as attachment_count
       FROM admin_notes n
       LEFT JOIN users u ON n.author_id = u.id
       WHERE COALESCE(n.category, 'community') = ?
         AND (? != 'legal_support' OR ${LEGAL_SUBCATEGORY_SQL} = ?)
         AND (? = '' OR n.title LIKE ? OR n.content LIKE ? OR n.author_name LIKE ? OR COALESCE(n.court, '') LIKE ? OR COALESCE(n.case_number, '') LIKE ? OR COALESCE(n.client_name, '') LIKE ? OR COALESCE(n.target_date, '') LIKE ?)
         AND (
           n.visibility = 'all'
           OR (n.visibility = 'branch' AND n.author_branch = ?)
           OR (n.visibility = 'department' AND n.author_branch = ? AND n.author_department = ?)
           OR (n.visibility LIKE 'team:%' AND n.visibility = ?)
           OR (n.visibility LIKE 'user:%' AND n.visibility = ?)
           OR n.author_id = ?
         )
       ORDER BY n.pinned DESC, n.created_at DESC`
    ).bind(category, category, legalSubcategory, search, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, viewerInfo.branch, viewerInfo.branch, viewerInfo.department, 'team:' + viewerInfo.department, 'user:' + viewer.sub, viewer.sub).all();
  }

  const masked = (notes.results || []).map((n: any) => maskNote(n, role));
  return c.json({ notes: masked });
});

// GET /api/admin-notes/briefing-autofill - 브리핑자료 일정 자동채우기 후보
adminNotes.get('/briefing-autofill', async (c) => {
  const db = c.env.DB;
  const viewer = c.get('user');
  const assigneeId = (c.req.query('assignee_id') || '').trim();
  const clientName = (c.req.query('client_name') || '').trim();
  const caseNumber = (c.req.query('case_number') || '').trim();

  const profile = await db.prepare('SELECT role, branch FROM users WHERE id = ?').bind(viewer.sub).first<{ role: string; branch: string }>();
  if (!canCreateBriefingSchedule(profile?.role || viewer.role)) return c.json({ error: '브리핑자료 제출 등록 권한이 없습니다.' }, 403);
  if (!assigneeId) return c.json({ match: null });

  const assignee = await db.prepare('SELECT id, branch FROM users WHERE id = ? AND approved = 1').bind(assigneeId).first<{ id: string; branch: string }>();
  if (!assignee) return c.json({ error: '담당자를 찾을 수 없습니다.' }, 404);
  if ((profile?.role || viewer.role) === 'admin' && !sameBranchName(assignee.branch, profile?.branch)) return c.json({ error: '담당자를 선택할 권한이 없습니다.' }, 403);

  let row: any = null;
  if (caseNumber) {
    row = await db.prepare(`
      SELECT target_date, activity_type, activity_subtype, data
      FROM journal_entries
      WHERE user_id = ?
        AND activity_type IN ('임장', '미팅', '입찰')
        AND (
          activity_subtype = ?
          OR json_extract(data, '$.caseNo') = ?
          OR json_extract(data, '$.briefingCaseNo') = ?
        )
      ORDER BY target_date DESC, created_at DESC
      LIMIT 1
    `).bind(assigneeId, caseNumber, caseNumber, caseNumber).first();
  }

  if (!row && clientName) {
    row = await db.prepare(`
      SELECT target_date, activity_type, activity_subtype, data
      FROM journal_entries
      WHERE user_id = ?
        AND activity_type IN ('임장', '미팅', '입찰')
        AND (
          json_extract(data, '$.client') = ?
          OR json_extract(data, '$.bidder') = ?
        )
      ORDER BY target_date DESC, created_at DESC
      LIMIT 1
    `).bind(assigneeId, clientName, clientName).first();
  }

  if (!row) return c.json({ match: null });
  let data: any = {};
  try { data = JSON.parse(row.data || '{}'); } catch { data = {}; }
  return c.json({
    match: {
      target_date: row.target_date,
      activity_type: row.activity_type,
      case_number: data.caseNo || data.briefingCaseNo || row.activity_subtype || '',
      item_no: data.itemNo || '',
      court: data.court || data.briefingCourt || '',
      client_name: data.client || data.bidder || '',
    },
  });
});

// GET /api/admin-notes/:id - 상세 조회
// POST /api/admin-notes/articles/upload-pdf - external daily article PDF upload
adminNotes.post('/articles/upload-pdf', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  await ensureAdminNoteExtensions(db);
  if (!c.env.ARTICLE_BUCKET) return c.json({ error: 'ARTICLE_BUCKET R2 바인딩이 설정되지 않았습니다.' }, 500);
  const canUploadArticlePdf =
    ADMIN_ROLES.includes(user.role as Role) ||
    (user.auth_type === 'service_token' && (user.service_token_scope === 'write' || user.service_token_scope === 'admin'));
  if (!canUploadArticlePdf) return c.json({ error: '기사 PDF 업로드 권한이 없습니다.' }, 403);

  const contentLength = Number(c.req.header('content-length') || 0);
  if (contentLength > MAX_ARTICLE_PDF_BYTES + 1024 * 1024) {
    return c.json({ error: 'PDF 파일은 최대 20MB까지 업로드할 수 있습니다.' }, 413);
  }

  const contentType = c.req.header('content-type') || '';
  let buffer: ArrayBuffer;
  let fileName = 'article.pdf';
  let title = '';
  let content = '';
  let sourceName = '';
  let articleDateRaw: unknown = '';
  let visibility = 'all';

  if (contentType.includes('multipart/form-data')) {
    const form = await c.req.formData();
    const file = form.get('file') || form.get('pdf');
    if (!(file instanceof File)) return c.json({ error: 'file 또는 pdf 필드에 PDF 파일을 첨부해주세요.' }, 400);
    buffer = await file.arrayBuffer();
    fileName = safePdfFileName(file.name || 'article.pdf');
    title = String(form.get('title') || '').trim();
    content = String(form.get('content') || '').trim();
    sourceName = String(form.get('source_name') || '').trim();
    articleDateRaw = form.get('article_date');
    visibility = String(form.get('visibility') || 'all').trim() || 'all';
  } else if (contentType.includes('application/pdf')) {
    buffer = await c.req.arrayBuffer();
    fileName = safePdfFileName(decodeURIComponent(c.req.header('x-file-name') || 'article.pdf'));
    title = String(c.req.header('x-title') || '').trim();
    content = String(c.req.header('x-content') || '').trim();
    sourceName = String(c.req.header('x-source-name') || '').trim();
    articleDateRaw = c.req.header('x-article-date');
    visibility = String(c.req.header('x-visibility') || 'all').trim() || 'all';
  } else {
    return c.json({ error: 'multipart/form-data 또는 application/pdf 형식으로 업로드해주세요.' }, 415);
  }

  if (buffer.byteLength === 0) return c.json({ error: '빈 PDF 파일은 업로드할 수 없습니다.' }, 400);
  if (buffer.byteLength > MAX_ARTICLE_PDF_BYTES) return c.json({ error: 'PDF 파일은 최대 20MB까지 업로드할 수 있습니다.' }, 413);

  const magic = new TextDecoder().decode(buffer.slice(0, 5));
  if (magic !== '%PDF-') return c.json({ error: 'PDF 파일만 업로드할 수 있습니다.' }, 400);

  const articleDate = normalizeArticleDate(articleDateRaw);
  if (!articleDate) return c.json({ error: 'article_date는 YYYY-MM-DD 형식이어야 합니다.' }, 400);
  const expiresAt = addDays(articleDate, 31);

  const author = await resolveArticleApiAuthor(db, user);
  const articleId = crypto.randomUUID();
  const noteId = crypto.randomUUID();
  const sha256 = await sha256Hex(buffer);
  const duplicate = await db.prepare(
    'SELECT id, note_id, file_name, created_at FROM article_pdf_uploads WHERE sha256 = ? AND deleted_at IS NULL LIMIT 1'
  ).bind(sha256).first<{ id: string; note_id: string; file_name: string; created_at: string }>();
  if (duplicate) return c.json({ error: '이미 업로드된 PDF입니다.', duplicate }, 409);

  const objectKey = articleObjectKey(articleDate, articleId, fileName);
  const finalTitle = title || `${articleDate} 기사 PDF${sourceName ? ` - ${sourceName}` : ''}`;
  const finalContent = content || '외부 API로 업로드된 일일 기사 PDF입니다.';

  await c.env.ARTICLE_BUCKET.put(objectKey, buffer, {
    httpMetadata: {
      contentType: 'application/pdf',
      contentDisposition: pdfContentDisposition(fileName),
    },
    customMetadata: {
      sha256,
      sourceName: sourceName.slice(0, 120),
      articleDate,
      expiresAt,
    },
  });

  try {
    await db.batch([
      db.prepare(
        `INSERT INTO admin_notes (id, title, content, author_id, author_name, pinned, source_type, source_id, is_anonymous, visibility, author_branch, author_department, category, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, 'article_pdf', ?, 0, ?, ?, ?, 'article_news', ${KST_NOW_SQL}, ${KST_NOW_SQL})`
      ).bind(noteId, finalTitle, finalContent, author.id, author.name, articleId, visibility, author.branch, author.department),
      db.prepare(
        `INSERT INTO article_pdf_uploads (id, note_id, object_key, file_name, file_size, sha256, source_name, article_date, expires_at, uploaded_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${KST_NOW_SQL})`
      ).bind(articleId, noteId, objectKey, fileName, buffer.byteLength, sha256, sourceName.slice(0, 120), articleDate, expiresAt, user.sub),
    ]);
  } catch (err) {
    await c.env.ARTICLE_BUCKET.delete(objectKey).catch(() => undefined);
    throw err;
  }

  c.executionCtx.waitUntil(sendCommunityNoteCreatedAlimtalk(
    c.env as unknown as Record<string, unknown>,
    db,
    {
      id: noteId,
      title: finalTitle,
      category: 'article_news',
      visibility,
      author_id: author.id,
      author_name: author.name,
      is_anonymous: 0,
    },
  ).catch((err) => console.error('[community alimtalk] article PDF notification failed', err)));

  return c.json({
    success: true,
    id: articleId,
    note_id: noteId,
    file_name: fileName,
    file_size: buffer.byteLength,
    article_date: articleDate,
    expires_at: expiresAt,
  });
});

// GET /api/admin-notes/articles/:articleId/download - article PDF download
adminNotes.get('/articles/:articleId/download', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  await ensureAdminNoteExtensions(db);
  if (!c.env.ARTICLE_BUCKET) return c.json({ error: 'ARTICLE_BUCKET R2 바인딩이 설정되지 않았습니다.' }, 500);

  const articleId = c.req.param('articleId');
  const row = await db.prepare(`
    SELECT ap.*, n.author_id, n.visibility, n.author_branch, n.author_department, n.category
    FROM article_pdf_uploads ap
    JOIN admin_notes n ON n.id = ap.note_id
    WHERE ap.id = ?
  `).bind(articleId).first<any>();
  if (!row) return c.json({ error: 'PDF를 찾을 수 없습니다.' }, 404);
  if (row.deleted_at) return c.json({ error: '보관 기간이 만료된 PDF입니다.' }, 410);

  const viewerInfo = await db.prepare('SELECT role, branch, department FROM users WHERE id = ?').bind(user.sub).first<{ role: string; branch: string; department: string }>();
  const role = viewerInfo?.role || user.role;
  if (!canReadNote(row, user, viewerInfo, role)) return c.json({ error: '열람 권한이 없습니다.' }, 403);

  const object = await c.env.ARTICLE_BUCKET.get(row.object_key);
  if (!object) return c.json({ error: 'R2 객체를 찾을 수 없습니다.' }, 404);

  return new Response(object.body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(object.size),
      'Content-Disposition': pdfContentDisposition(row.file_name),
      'Cache-Control': 'private, max-age=300',
    },
  });
});

adminNotes.get('/bid-analysis', async (c) => {
  const db = c.env.DB;
  await ensureBidAnalysisTable(db);
  const user = c.get('user');
  if (!canManageBidHistory(user.role)) return c.json({ error: '입찰분석 열람 권한이 없습니다.' }, 403);

  const page = Math.max(1, Number(c.req.query('page') || 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(c.req.query('page_size') || 20) || 20));
  const from = String(c.req.query('from') || '').trim();
  const to = String(c.req.query('to') || '').trim();
  const branch = normalizeBranchName(c.req.query('branch') || '');
  const assignee = String(c.req.query('assignee') || '').trim();
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    conditions.push('substr(bid_datetime, 1, 10) >= ?');
    params.push(from);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    conditions.push('substr(bid_datetime, 1, 10) <= ?');
    params.push(to);
  }
  if (branch) {
    conditions.push('branch_name = ?');
    params.push(branch);
  }
  if (assignee) {
    conditions.push('assignee_name = ?');
    params.push(assignee);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const totalRow = await db.prepare(`SELECT COUNT(*) as total FROM bid_analysis_entries ${where}`).bind(...params).first<{ total: number }>();
  const rows = await db.prepare(`
    SELECT id, bid_datetime, assignee_name, branch_name, case_number, property_type,
           suggested_bid_price, actual_bid_price, winning_price, is_won, bid_result,
           client_name, source_type, manual_override, created_at
    FROM bid_analysis_entries
    ${where}
    ORDER BY bid_datetime DESC, created_at DESC
    LIMIT ? OFFSET ?
  `).bind(...params, pageSize, (page - 1) * pageSize).all();
  const branchRows = await db.prepare("SELECT DISTINCT branch_name FROM bid_analysis_entries WHERE branch_name != '' ORDER BY branch_name").all<{ branch_name: string }>();
  const assigneeRows = await db.prepare("SELECT DISTINCT assignee_name FROM bid_analysis_entries WHERE assignee_name != '' ORDER BY assignee_name").all<{ assignee_name: string }>();

  return c.json({
    rows: rows.results || [],
    total: totalRow?.total || 0,
    page,
    page_size: pageSize,
    filters: {
      branches: (branchRows.results || []).map(r => r.branch_name),
      assignees: (assigneeRows.results || []).map(r => r.assignee_name),
    },
  });
});

adminNotes.get('/bid-analysis/stats', async (c) => {
  const db = c.env.DB;
  await ensureBidAnalysisTable(db);
  const user = c.get('user');
  if (!canManageBidHistory(user.role)) return c.json({ error: '입찰분석 열람 권한이 없습니다.' }, 403);

  const from = String(c.req.query('from') || '').trim();
  const to = String(c.req.query('to') || '').trim();
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    conditions.push('substr(bid_datetime, 1, 10) >= ?');
    params.push(from);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    conditions.push('substr(bid_datetime, 1, 10) <= ?');
    params.push(to);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await db.prepare(`
    SELECT id, bid_datetime, assignee_name, branch_name, case_number, property_type,
           suggested_bid_price, actual_bid_price, winning_price, is_won, bid_result,
           client_name, source_type, manual_override, created_at
    FROM bid_analysis_entries
    ${where}
    ORDER BY bid_datetime DESC, created_at DESC
    LIMIT 10000
  `).bind(...params).all();
  return c.json({ rows: rows.results || [] });
});

adminNotes.post('/bid-analysis', async (c) => {
  const db = c.env.DB;
  await ensureBidAnalysisTable(db);
  const user = c.get('user');
  if (!canManageBidHistory(user.role)) return c.json({ error: '입찰분석 입력 권한이 없습니다.' }, 403);

  const payload = normalizeBidAnalysisPayload(await c.req.json());
  if (!payload.bid_datetime) return c.json({ error: '입찰일을 입력하세요.' }, 400);
  if (!payload.case_number) return c.json({ error: '사건번호를 입력하세요.' }, 400);
  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO bid_analysis_entries (
      id, bid_datetime, assignee_name, branch_name, case_number, property_type,
      suggested_bid_price, actual_bid_price, winning_price, is_won, bid_result,
      client_name, source_type, source_id, dedupe_key, uploaded_by, manual_override,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?, ?, 1, ${KST_NOW_SQL}, ${KST_NOW_SQL})
  `).bind(
    id,
    payload.bid_datetime,
    payload.assignee_name,
    payload.branch_name,
    payload.case_number,
    payload.property_type,
    payload.suggested_bid_price,
    payload.actual_bid_price,
    payload.winning_price,
    payload.bid_result === '낙찰' ? 1 : 0,
    payload.bid_result,
    payload.client_name,
    id,
    `manual|${id}`,
    user.sub,
  ).run();
  return c.json({ success: true, id });
});

adminNotes.put('/bid-analysis/:id', async (c) => {
  const db = c.env.DB;
  await ensureBidAnalysisTable(db);
  const user = c.get('user');
  if (!canManageBidHistory(user.role)) return c.json({ error: '입찰분석 수정 권한이 없습니다.' }, 403);
  const id = c.req.param('id');
  const existing = await db.prepare('SELECT id FROM bid_analysis_entries WHERE id = ?').bind(id).first<{ id: string }>();
  if (!existing) return c.json({ error: '입찰분석 내역을 찾을 수 없습니다.' }, 404);
  const payload = normalizeBidAnalysisPayload(await c.req.json());
  if (!payload.bid_datetime) return c.json({ error: '입찰일을 입력하세요.' }, 400);
  if (!payload.case_number) return c.json({ error: '사건번호를 입력하세요.' }, 400);
  await db.prepare(`
    UPDATE bid_analysis_entries
    SET bid_datetime = ?, assignee_name = ?, branch_name = ?, case_number = ?, property_type = ?,
      suggested_bid_price = ?, actual_bid_price = ?, winning_price = ?, is_won = ?, bid_result = ?,
      client_name = ?, manual_override = 1, uploaded_by = COALESCE(uploaded_by, ?), updated_at = ${KST_NOW_SQL}
    WHERE id = ?
  `).bind(
    payload.bid_datetime,
    payload.assignee_name,
    payload.branch_name,
    payload.case_number,
    payload.property_type,
    payload.suggested_bid_price,
    payload.actual_bid_price,
    payload.winning_price,
    payload.bid_result === '낙찰' ? 1 : 0,
    payload.bid_result,
    payload.client_name,
    user.sub,
    id,
  ).run();
  return c.json({ success: true });
});

adminNotes.post('/bid-analysis/bulk', async (c) => {
  const db = c.env.DB;
  await ensureBidAnalysisTable(db);
  const user = c.get('user');
  if (!canManageBidHistory(user.role)) return c.json({ error: '입찰분석 업로드 권한이 없습니다.' }, 403);

  const { rows, source_file_name } = await c.req.json();
  if (!Array.isArray(rows) || rows.length === 0) return c.json({ error: '업로드할 행이 없습니다.' }, 400);
  if (rows.length > 2000) return c.json({ error: '한 번에 최대 2,000건까지 업로드할 수 있습니다.' }, 400);

  const batchId = crypto.randomUUID();
  let inserted = 0;
  const seen = new Set<string>();
  const users = await db.prepare("SELECT name, branch FROM users WHERE approved = 1 AND name != ''").all<{ name: string; branch: string }>();
  const branchByName = new Map((users.results || []).map(row => [String(row.name).trim(), row.branch || '']));
  const statements: D1PreparedStatement[] = [];
  for (const raw of rows) {
    const bidDatetime = String(raw?.bid_datetime || '').trim();
    if (!bidDatetime) continue;
    const assigneeName = String(raw?.assignee_name || '').trim();
    const input = {
      bid_datetime: bidDatetime,
      assignee_name: assigneeName,
      branch_name: String(raw?.branch_name || '').trim() || branchByName.get(assigneeName) || '',
      case_number: String(raw?.case_number || '').trim(),
      property_type: String(raw?.property_type || '').trim(),
      suggested_bid_price: normalizeAmount(raw?.suggested_bid_price),
      actual_bid_price: normalizeAmount(raw?.actual_bid_price),
      winning_price: normalizeAmount(raw?.winning_price),
      bid_result: normalizeBidResult(raw?.bid_result ?? raw?.is_won),
      client_name: String(raw?.client_name || '').trim(),
      source_type: 'excel',
      source_file_name: String(source_file_name || '').trim() || null,
      upload_batch: batchId,
      uploaded_by: user.sub,
    } as const;
    const dedupeKey = makeBidDedupeKey(input);
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const bidResult = normalizeBidResult(input.bid_result);
    statements.push(db.prepare(`
      INSERT INTO bid_analysis_entries (
        id, bid_datetime, assignee_name, branch_name, case_number, property_type,
        suggested_bid_price, actual_bid_price, winning_price, is_won, bid_result,
        client_name, source_type, source_id, dedupe_key, source_file_name, upload_batch, uploaded_by,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${KST_NOW_SQL}, ${KST_NOW_SQL})
      ON CONFLICT(dedupe_key) DO UPDATE SET
        bid_datetime = CASE WHEN bid_analysis_entries.manual_override = 1 OR bid_analysis_entries.source_type = 'journal' THEN bid_analysis_entries.bid_datetime ELSE excluded.bid_datetime END,
        assignee_name = CASE WHEN bid_analysis_entries.manual_override = 1 OR bid_analysis_entries.source_type = 'journal' THEN bid_analysis_entries.assignee_name ELSE COALESCE(NULLIF(excluded.assignee_name, ''), bid_analysis_entries.assignee_name) END,
        branch_name = CASE WHEN bid_analysis_entries.manual_override = 1 OR bid_analysis_entries.source_type = 'journal' THEN bid_analysis_entries.branch_name ELSE COALESCE(NULLIF(excluded.branch_name, ''), bid_analysis_entries.branch_name) END,
        case_number = CASE WHEN bid_analysis_entries.manual_override = 1 OR bid_analysis_entries.source_type = 'journal' THEN bid_analysis_entries.case_number ELSE COALESCE(NULLIF(excluded.case_number, ''), bid_analysis_entries.case_number) END,
        property_type = CASE WHEN bid_analysis_entries.manual_override = 1 OR bid_analysis_entries.source_type = 'journal' THEN bid_analysis_entries.property_type ELSE COALESCE(NULLIF(excluded.property_type, ''), bid_analysis_entries.property_type) END,
        suggested_bid_price = CASE WHEN bid_analysis_entries.manual_override = 1 OR bid_analysis_entries.source_type = 'journal' THEN bid_analysis_entries.suggested_bid_price ELSE COALESCE(excluded.suggested_bid_price, bid_analysis_entries.suggested_bid_price) END,
        actual_bid_price = CASE WHEN bid_analysis_entries.manual_override = 1 OR bid_analysis_entries.source_type = 'journal' THEN bid_analysis_entries.actual_bid_price ELSE COALESCE(excluded.actual_bid_price, bid_analysis_entries.actual_bid_price) END,
        winning_price = CASE WHEN bid_analysis_entries.manual_override = 1 OR bid_analysis_entries.source_type = 'journal' THEN bid_analysis_entries.winning_price ELSE COALESCE(excluded.winning_price, bid_analysis_entries.winning_price) END,
        is_won = CASE WHEN bid_analysis_entries.manual_override = 1 OR bid_analysis_entries.source_type = 'journal' THEN bid_analysis_entries.is_won ELSE excluded.is_won END,
        bid_result = CASE WHEN bid_analysis_entries.manual_override = 1 OR bid_analysis_entries.source_type = 'journal' THEN bid_analysis_entries.bid_result ELSE excluded.bid_result END,
        client_name = CASE WHEN bid_analysis_entries.manual_override = 1 OR bid_analysis_entries.source_type = 'journal' THEN bid_analysis_entries.client_name ELSE COALESCE(NULLIF(excluded.client_name, ''), bid_analysis_entries.client_name) END,
        source_type = CASE WHEN bid_analysis_entries.source_type IN ('journal', 'freelancer') THEN bid_analysis_entries.source_type ELSE excluded.source_type END,
        source_id = COALESCE(bid_analysis_entries.source_id, excluded.source_id),
        source_file_name = COALESCE(excluded.source_file_name, bid_analysis_entries.source_file_name),
        upload_batch = COALESCE(excluded.upload_batch, bid_analysis_entries.upload_batch),
        uploaded_by = COALESCE(excluded.uploaded_by, bid_analysis_entries.uploaded_by),
        updated_at = ${KST_NOW_SQL}
    `).bind(
      crypto.randomUUID(),
      input.bid_datetime,
      input.assignee_name,
      input.branch_name,
      input.case_number,
      input.property_type,
      input.suggested_bid_price,
      input.actual_bid_price,
      input.winning_price,
      bidResult === normalizeBidResult('1') ? 1 : 0,
      bidResult,
      input.client_name,
      input.source_type,
      null,
      dedupeKey,
      input.source_file_name,
      input.upload_batch,
      input.uploaded_by,
    ));
    inserted++;
  }
  const batchSize = 100;
  for (let i = 0; i < statements.length; i += batchSize) {
    await db.batch(statements.slice(i, i + batchSize));
  }

  return c.json({ success: true, inserted, batch_id: batchId });
});

adminNotes.get('/bid-match-check', async (c) => {
  const db = c.env.DB;
  await ensureAdminNoteExtensions(db);
  await ensureBidAnalysisTable(db);
  const user = c.get('user');
  if (!canManageBidHistory(user.role)) return c.json({ error: '자료.입찰 확인 권한이 없습니다.' }, 403);

  const normalizeCase = (value: unknown) => String(value || '')
    .replace(/\s+/g, '')
    .replace(/[()]/g, '')
    .toLowerCase();
  const briefingKeys = (row: any) => {
    const base = normalizeCase(row.case_number);
    const item = normalizeCase(row.item_no);
    return new Set([base, item ? `${base}${item}` : base].filter(Boolean));
  };
  const analysisKeys = (row: any) => {
    const full = normalizeCase(row.case_number);
    const base = normalizeCase(String(row.case_number || '').replace(/\(\s*\d+\s*\)$/, ''));
    return new Set([full, base].filter(Boolean));
  };

  const briefing = await db.prepare(`
    SELECT id, title, target_date, assignee_id, case_number, item_no, client_name, court, created_at
    FROM admin_notes
    WHERE category = 'briefing_schedule'
    ORDER BY target_date DESC, created_at DESC
  `).all<any>();
  const analysis = await db.prepare(`
    SELECT id, bid_datetime, assignee_name, branch_name, case_number, property_type, bid_result, client_name, source_type, created_at
    FROM bid_analysis_entries
    ORDER BY bid_datetime DESC, created_at DESC
  `).all<any>();

  const analysisKeySet = new Set<string>();
  for (const row of analysis.results || []) for (const key of analysisKeys(row)) analysisKeySet.add(key);

  const briefing_unmatched = (briefing.results || []).filter((row: any) => {
    for (const key of briefingKeys(row)) if (analysisKeySet.has(key)) return false;
    return true;
  });

  return c.json({
    briefing_unmatched,
    analysis_unmatched: [],
    counts: {
      briefing_total: briefing.results?.length || 0,
      analysis_total: analysis.results?.length || 0,
      briefing_unmatched: briefing_unmatched.length,
      analysis_unmatched: 0,
    },
  });
});

adminNotes.get('/:id', async (c) => {
  const db = c.env.DB;
  await ensureAdminNoteExtensions(db);
  const viewer = c.get('user');
  const id = c.req.param('id');
  const shouldTrackView = c.req.query('view') === '1';

  const viewerInfo = await db.prepare('SELECT role, branch, department FROM users WHERE id = ?').bind(viewer.sub).first<{ role: string; branch: string; department: string }>();
  const role = viewerInfo?.role || viewer.role;

  const note = await db.prepare(
    'SELECT n.*, u.position_title as author_position FROM admin_notes n LEFT JOIN users u ON n.author_id = u.id WHERE n.id = ?'
  ).bind(id).first<any>();
  if (!note) return c.json({ error: '노트를 찾을 수 없습니다.' }, 404);

  if (note.category === 'briefing_schedule' && !canCreateBriefingSchedule(role)) {
    return c.json({ error: '브리핑자료 제출 카테고리 열람 권한이 없습니다.' }, 403);
  }

  // visibility 체크 (master는 예외)
  if (!canReadNote(note, viewer, viewerInfo, role)) return c.json({ error: '열람 권한이 없습니다.' }, 403);

  if (shouldTrackView) {
    await db.prepare('UPDATE admin_notes SET view_count = COALESCE(view_count, 0) + 1 WHERE id = ?').bind(id).run();
    note.view_count = Number(note.view_count || 0) + 1;
  }

  const comments = await db.prepare(
    `SELECT c.*, u.position_title as author_position
     FROM admin_note_comments c
     LEFT JOIN users u ON c.author_id = u.id
     WHERE c.note_id = ? ORDER BY c.created_at ASC`
  ).bind(id).all();
  const attachments = await db.prepare(
    `SELECT id, note_id, file_name, file_type, file_size, file_data, created_at
     FROM admin_note_attachments
     WHERE note_id = ? ORDER BY created_at ASC`
  ).bind(id).all();
  const articleAttachments = await db.prepare(
    `SELECT id, note_id, file_name, file_size, source_name, article_date, expires_at, created_at
     FROM article_pdf_uploads
     WHERE note_id = ? AND deleted_at IS NULL
     ORDER BY created_at ASC`
  ).bind(id).all<any>();

  const maskedNote = maskNote({ ...note }, role);
  const maskedComments = (comments.results || []).map((cm: any) => maskComment({ ...cm }, role));

  const r2Attachments = (articleAttachments.results || []).map((file: any) => ({
    id: file.id,
    note_id: file.note_id,
    file_name: file.file_name,
    file_type: 'application/pdf',
    file_size: file.file_size,
    file_data: '',
    download_url: `/api/admin-notes/articles/${file.id}/download`,
    storage: 'r2',
    source_name: file.source_name,
    article_date: file.article_date,
    expires_at: file.expires_at,
    created_at: file.created_at,
  }));

  return c.json({ note: maskedNote, comments: maskedComments, attachments: [...(attachments.results || []), ...r2Attachments] });
});

// POST /api/admin-notes - 생성
adminNotes.post('/', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  await ensureAdminNoteExtensions(db);
  const {
    title, content, pinned, source_type, source_id, is_anonymous, visibility,
    category: rawCategory, court, case_number, legal_subcategory, attachments,
    assignee_id, target_date, item_no, client_name, lawsuit_cost_requested,
  } = await c.req.json();
  const category = normalizeCategory(rawCategory);
  const legalSubcategory = category === 'legal_support' ? normalizeLegalSubcategory(legal_subcategory) : null;
  if (category !== 'briefing_schedule' && (!title?.trim() || !content?.trim())) return c.json({ error: '제목과 내용을 입력하세요.' }, 400);
  if (category === 'eviction_quote' && (!court?.trim() || !case_number?.trim())) {
    return c.json({ error: '법원과 사건번호를 입력하세요.' }, 400);
  }
  if (category === 'legal_support' && legalSubcategory === 'auction' && (!court?.trim() || !case_number?.trim())) {
    return c.json({ error: '경매 상담은 법원과 사건번호를 입력하세요.' }, 400);
  }

  // 사용자 정보
  const profile = await db.prepare(
    'SELECT branch, department, position_title, role FROM users WHERE id = ?'
  ).bind(user.sub).first<{ branch: string; department: string; position_title: string; role: string }>();
  const role = profile?.role || user.role;
  if (category === 'notice' && !canCreateNotice(role)) {
    return c.json({ error: '공지사항 등록 권한이 없습니다.' }, 403);
  }
  if (category === 'legal_support' && legalSubcategory === 'legal_terms' && !canCreateLegalTerms(role, profile?.department)) {
    return c.json({ error: '법률용어는 법률지원팀 및 관리자급 이상만 작성할 수 있습니다.' }, 403);
  }

  let assignee: { id: string; name: string; branch: string; department: string; approved: number } | null = null;
  let journalEntryId: string | null = null;
  let finalTitle = title?.trim() || '';
  let finalContent = content?.trim() || '';

  if (category === 'briefing_schedule') {
    if (!canCreateBriefingSchedule(role)) return c.json({ error: '브리핑자료 제출 등록 권한이 없습니다.' }, 403);
    if (!assignee_id) return c.json({ error: '담당자를 목록에서 선택하세요.' }, 400);
    if (!target_date) return c.json({ error: '일정일을 입력하세요.' }, 400);
    if (!court?.trim() || !case_number?.trim() || !client_name?.trim()) return c.json({ error: '법원, 사건번호, 계약자명은 필수입니다.' }, 400);

    assignee = await db.prepare(
      'SELECT id, name, branch, department, approved FROM users WHERE id = ?'
    ).bind(assignee_id).first<{ id: string; name: string; branch: string; department: string; approved: number }>();
    if (!assignee || assignee.approved !== 1) return c.json({ error: '담당자를 찾을 수 없습니다.' }, 404);
    if (role === 'admin' && !sameBranchName(assignee.branch, profile?.branch)) return c.json({ error: '담당자를 선택할 권한이 없습니다.' }, 403);

    finalTitle = `${target_date} ${assignee.name} 브리핑자료 제출`;
    finalContent = makeBriefingContent({
      targetDate: target_date,
      assigneeName: assignee.name,
      court: court.trim(),
      caseNumber: case_number.trim(),
      itemNo: item_no?.trim(),
      clientName: client_name.trim(),
    });
  }

  // 핀 고정은 master만
  const canPin = role === 'master';

  if (source_type === 'minutes' && source_id) {
    const minute = await db.prepare(
      'SELECT uploaded_by FROM meeting_minutes WHERE id = ?'
    ).bind(source_id).first<{ uploaded_by: string }>();
    if (!minute) return c.json({ error: '회의록을 찾을 수 없습니다.' }, 404);
    if ((profile?.role || user.role) !== 'master' && minute.uploaded_by !== user.sub) {
      return c.json({ error: '회의록 게시 권한이 없습니다.' }, 403);
    }
  }

  const id = crypto.randomUUID();
  if (category === 'briefing_schedule' && assignee) {
    journalEntryId = crypto.randomUUID();
    await db.prepare(
      'INSERT INTO journal_entries (id, user_id, target_date, activity_type, activity_subtype, data, branch, department) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      journalEntryId,
      assignee.id,
      target_date,
      '브리핑자료제출',
      '브리핑자료 제출',
      JSON.stringify({
        briefingSubmit: true,
        briefingCaseNo: case_number.trim(),
        itemNo: item_no?.trim() || '',
        briefingCourt: court.trim(),
        client: client_name.trim(),
        sourceAdminNoteId: id,
        createdBy: user.sub,
        createdByName: user.name,
      }),
      assignee.branch,
      assignee.department,
    ).run();
    await recheckAlertsForJournalEntry(db, journalEntryId).catch((err) => console.error('[recheckAlerts on briefing schedule insert]', err));
  }

  await db.prepare(
    `INSERT INTO admin_notes (id, title, content, author_id, author_name, pinned, source_type, source_id, is_anonymous, visibility, author_branch, author_department, category, court, case_number, legal_subcategory, lawsuit_cost_requested, assignee_id, target_date, item_no, client_name, journal_entry_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${KST_NOW_SQL}, ${KST_NOW_SQL})`
  ).bind(
    id, finalTitle, finalContent, user.sub, user.name,
    canPin && pinned ? 1 : 0,
    source_type || null, source_id || null,
    is_anonymous ? 1 : 0,
    category === 'briefing_schedule' || category === 'notice' ? 'all' : visibility || 'all',
    profile?.branch || '', profile?.department || '',
    category,
    category === 'eviction_quote' || category === 'briefing_schedule' || (category === 'legal_support' && legalSubcategory === 'auction') ? String(court || '').trim() : null,
    category === 'eviction_quote' || category === 'briefing_schedule' || (category === 'legal_support' && legalSubcategory === 'auction') ? String(case_number || '').trim().replace(/\s+/g, '') : null,
    legalSubcategory,
    category === 'legal_support' && shouldTrackLawsuitCost(legalSubcategory) && lawsuit_cost_requested ? 1 : 0,
    category === 'briefing_schedule' ? assignee?.id : null,
    category === 'briefing_schedule' ? target_date : null,
    category === 'briefing_schedule' ? item_no?.trim() || '' : null,
    category === 'briefing_schedule' ? client_name.trim() : null,
    journalEntryId
  ).run();

  const safeAttachments = Array.isArray(attachments) ? attachments.slice(0, 5) : [];
  for (const file of safeAttachments) {
    if (!file?.file_name || !file?.file_data) continue;
    await db.prepare(
      `INSERT INTO admin_note_attachments (id, note_id, file_name, file_type, file_size, file_data, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ${KST_NOW_SQL})`
    ).bind(
      crypto.randomUUID(),
      id,
      String(file.file_name).slice(0, 160),
      String(file.file_type || '').slice(0, 100),
      Number(file.file_size || 0),
      String(file.file_data),
    ).run();
  }

  c.executionCtx.waitUntil(sendCommunityNoteCreatedAlimtalk(
    c.env as unknown as Record<string, unknown>,
    db,
    {
      id,
      title: finalTitle,
      category,
      visibility: category === 'briefing_schedule' || category === 'notice' ? 'all' : visibility || 'all',
      legal_subcategory: legalSubcategory,
      court: category === 'eviction_quote' ? court.trim() : null,
      case_number: category === 'eviction_quote' ? case_number.trim() : null,
      author_id: user.sub,
      author_name: user.name,
      is_anonymous: is_anonymous ? 1 : 0,
    },
  ).catch((err) => console.error('[community alimtalk] create notification failed', err)));

  return c.json({ success: true, id });
});

// PUT /api/admin-notes/:id - 수정
adminNotes.put('/:id', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  await ensureAdminNoteExtensions(db);
  const id = c.req.param('id');
  const { title, content, pinned, legal_subcategory, lawsuit_cost_requested, court, case_number } = await c.req.json();

  const note = await db.prepare('SELECT * FROM admin_notes WHERE id = ?').bind(id).first<any>();
  if (!note) return c.json({ error: '노트를 찾을 수 없습니다.' }, 404);

  if (note.author_id !== user.sub && user.role !== 'master') {
    return c.json({ error: '본인 글만 수정할 수 있습니다.' }, 403);
  }

  const profile = await db.prepare(
    'SELECT role, department FROM users WHERE id = ?'
  ).bind(user.sub).first<{ role: string; department: string | null }>();
  const role = profile?.role || user.role;
  const nextLegalSubcategory = note.category === 'legal_support'
    ? normalizeLegalSubcategory(legal_subcategory ?? note.legal_subcategory)
    : note.legal_subcategory || null;
  if (note.category === 'legal_support' && nextLegalSubcategory === 'legal_terms' && !canCreateLegalTerms(role, profile?.department)) {
    return c.json({ error: '법률용어는 법률지원팀 및 관리자급 이상만 작성할 수 있습니다.' }, 403);
  }
  if (note.category === 'legal_support' && nextLegalSubcategory === 'auction' && (!String(court || note.court || '').trim() || !String(case_number || note.case_number || '').trim())) {
    return c.json({ error: '경매 상담은 법원과 사건번호를 입력하세요.' }, 400);
  }

  // pinned 수정은 master만
  const canPin = role === 'master';
  const newPinned = pinned !== undefined ? (canPin ? (pinned ? 1 : 0) : note.pinned) : note.pinned;
  const nextCostRequested = note.category === 'legal_support' && shouldTrackLawsuitCost(nextLegalSubcategory)
    ? (lawsuit_cost_requested === undefined ? (note.lawsuit_cost_requested ? 1 : 0) : lawsuit_cost_requested ? 1 : 0)
    : 0;
  const nextCourt = note.category === 'legal_support' && nextLegalSubcategory === 'auction'
    ? String(court || note.court || '').trim()
    : note.category === 'legal_support' ? null : note.court;
  const nextCaseNumber = note.category === 'legal_support' && nextLegalSubcategory === 'auction'
    ? String(case_number || note.case_number || '').trim().replace(/\s+/g, '')
    : note.category === 'legal_support' ? null : note.case_number;

  await db.prepare(
    `UPDATE admin_notes SET title = ?, content = ?, pinned = ?, legal_subcategory = ?, lawsuit_cost_requested = ?, court = ?, case_number = ?, updated_at = ${KST_NOW_SQL} WHERE id = ?`
  ).bind(title?.trim() || note.title, content?.trim() || note.content, newPinned, nextLegalSubcategory, nextCostRequested, nextCourt, nextCaseNumber, id).run();

  return c.json({ success: true });
});

// DELETE /api/admin-notes/:id - 삭제
adminNotes.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');

  const db = c.env.DB;
  await ensureAdminNoteExtensions(db);
  const note = await db.prepare('SELECT * FROM admin_notes WHERE id = ?').bind(id).first<any>();
  if (!note) return c.json({ error: '노트를 찾을 수 없습니다.' }, 404);

  if (note.author_id !== user.sub && user.role !== 'master') {
    return c.json({ error: '본인 글만 삭제할 수 있습니다.' }, 403);
  }

  if (note.category === 'briefing_schedule' && note.journal_entry_id) {
    const entry = await db.prepare('SELECT user_id, target_date FROM journal_entries WHERE id = ?')
      .bind(note.journal_entry_id)
      .first<{ user_id: string; target_date: string }>();
    await db.prepare('DELETE FROM journal_entries WHERE id = ?').bind(note.journal_entry_id).run();
    if (entry) {
      await recheckAlertsAfterEntryDelete(db, entry.user_id, entry.target_date)
        .catch((err) => console.error('[recheckAlerts on briefing schedule delete]', err));
    }
  }
  await db.prepare('DELETE FROM admin_notes WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

// POST /api/admin-notes/:id/comments - 댓글 작성
adminNotes.post('/:id/comments', async (c) => {
  const user = c.get('user');
  const noteId = c.req.param('id');
  const { content, is_anonymous } = await c.req.json();
  if (!content?.trim()) return c.json({ error: '내용을 입력하세요.' }, 400);

  const db = c.env.DB;
  await ensureAdminNoteExtensions(db);
  const note = await db.prepare(`
    SELECT n.id, n.title, n.category, n.legal_subcategory, n.court, n.case_number, n.author_id, n.author_name,
      u.name as receiver_name, u.phone as receiver_phone
    FROM admin_notes n
    LEFT JOIN users u ON u.id = n.author_id
    WHERE n.id = ?
  `).bind(noteId).first<{
    id: string;
    title: string;
    category: string | null;
    legal_subcategory: string | null;
    court: string | null;
    case_number: string | null;
    author_id: string;
    author_name: string;
    receiver_name: string | null;
    receiver_phone: string | null;
  }>();
  if (!note) return c.json({ error: '게시글을 찾을 수 없습니다.' }, 404);
  if (note.category === 'legal_support' && !canAnswerLegalSubcategory(note.legal_subcategory)) {
    return c.json({ error: '법률용어 게시글은 답변을 받지 않습니다.' }, 400);
  }

  const id = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO admin_note_comments (id, note_id, author_id, author_name, content, is_anonymous, created_at) VALUES (?, ?, ?, ?, ?, ?, ${KST_NOW_SQL})`
  ).bind(id, noteId, user.sub, user.name, content.trim(), is_anonymous ? 1 : 0).run();

  c.executionCtx.waitUntil(sendCommunityCommentAlimtalk(
    c.env as unknown as Record<string, unknown>,
    db,
    note,
    { id, authorId: user.sub, authorName: user.name, isAnonymous: !!is_anonymous },
  ).catch((err) => console.error('[community alimtalk] comment notification failed', err)));

  return c.json({ success: true, id });
});

// DELETE /api/admin-notes/comments/:id - 댓글 삭제
adminNotes.delete('/comments/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');

  const comment = await c.env.DB.prepare('SELECT * FROM admin_note_comments WHERE id = ?').bind(id).first<any>();
  if (!comment) return c.json({ error: '댓글을 찾을 수 없습니다.' }, 404);

  if (comment.author_id !== user.sub && user.role !== 'master') {
    return c.json({ error: '본인 댓글만 삭제할 수 있습니다.' }, 403);
  }

  await c.env.DB.prepare('DELETE FROM admin_note_comments WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

export default adminNotes;
