import { Hono } from 'hono';
import type { AuthEnv, Role } from '../types';
import { authMiddleware } from '../middleware/auth';
import { APP_URL, sendAlimtalkByTemplate } from '../alimtalk';

const ADMIN_ROLES: Role[] = ['master', 'ceo', 'cc_ref', 'admin'];
const NOTE_CATEGORIES = ['community', 'eviction_quote', 'legal_support'] as const;
type NoteCategory = typeof NOTE_CATEGORIES[number];
const KST_NOW_SQL = "datetime('now', '+9 hours')";

const adminNotes = new Hono<AuthEnv>();

adminNotes.use('*', authMiddleware);

async function ensureAdminNoteExtensions(db: D1Database): Promise<void> {
  const columns = [
    'ALTER TABLE admin_notes ADD COLUMN category TEXT DEFAULT "community"',
    'ALTER TABLE admin_notes ADD COLUMN court TEXT',
    'ALTER TABLE admin_notes ADD COLUMN case_number TEXT',
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
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_admin_note_attachments_note ON admin_note_attachments(note_id)').run();
}

function normalizeCategory(category: unknown): NoteCategory {
  return NOTE_CATEGORIES.includes(category as NoteCategory) ? category as NoteCategory : 'community';
}

async function teamPhones(db: D1Database, teamName: string): Promise<string[]> {
  const rows = await db.prepare(`
    SELECT DISTINCT u.phone
    FROM users u
    LEFT JOIN teams t ON t.id = u.team_id
    WHERE u.approved = 1
      AND u.phone IS NOT NULL AND u.phone != ''
      AND (u.department = ? OR t.name = ?)
  `).bind(teamName, teamName).all<{ phone: string }>();
  return (rows.results || []).map(r => r.phone).filter(Boolean);
}

// 익명 처리: 대표/관리자에겐 "익명 (이름 / 직책)", 일반에겐 "익명"
function maskNote(note: any, viewerRole: string) {
  if (!note.is_anonymous) return note;
  const isAdmin = ADMIN_ROLES.includes(viewerRole as Role);
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
adminNotes.get('/', async (c) => {
  const db = c.env.DB;
  await ensureAdminNoteExtensions(db);
  const viewer = c.get('user');
  const category = normalizeCategory(c.req.query('category') || 'community');
  const search = (c.req.query('search') || '').trim();

  // 사용자 정보 조회 (branch, department)
  const viewerInfo = await db.prepare(
    'SELECT branch, department, role FROM users WHERE id = ?'
  ).bind(viewer.sub).first<{ branch: string; department: string; role: string }>();
  if (!viewerInfo) return c.json({ error: '사용자 정보 오류' }, 400);

  const role = viewerInfo.role;

  // visibility 필터링 — master만 전체 열람, 그 외는 전부 visibility 조건 적용
  let notes;
  if (role === 'master') {
    // master: 전체 보기
    notes = await db.prepare(
      `SELECT n.*, u.position_title as author_position,
         (SELECT COUNT(*) FROM admin_note_comments WHERE note_id = n.id) as comment_count,
         (SELECT COUNT(*) FROM admin_note_attachments WHERE note_id = n.id) as attachment_count
       FROM admin_notes n
       LEFT JOIN users u ON n.author_id = u.id
       WHERE COALESCE(n.category, 'community') = ?
         AND (? = '' OR n.title LIKE ? OR n.content LIKE ? OR n.author_name LIKE ? OR COALESCE(n.court, '') LIKE ? OR COALESCE(n.case_number, '') LIKE ?)
       ORDER BY n.pinned DESC, n.created_at DESC`
    ).bind(category, search, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`).all();
  } else {
    // 관리자급 포함 전체: visibility 조건 적용
    notes = await db.prepare(
      `SELECT n.*, u.position_title as author_position,
         (SELECT COUNT(*) FROM admin_note_comments WHERE note_id = n.id) as comment_count,
         (SELECT COUNT(*) FROM admin_note_attachments WHERE note_id = n.id) as attachment_count
       FROM admin_notes n
       LEFT JOIN users u ON n.author_id = u.id
       WHERE COALESCE(n.category, 'community') = ?
         AND (? = '' OR n.title LIKE ? OR n.content LIKE ? OR n.author_name LIKE ? OR COALESCE(n.court, '') LIKE ? OR COALESCE(n.case_number, '') LIKE ?)
         AND (
           n.visibility = 'all'
           OR (n.visibility = 'branch' AND n.author_branch = ?)
           OR (n.visibility = 'department' AND n.author_branch = ? AND n.author_department = ?)
           OR (n.visibility LIKE 'team:%' AND n.visibility = ?)
           OR n.author_id = ?
         )
       ORDER BY n.pinned DESC, n.created_at DESC`
    ).bind(category, search, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, viewerInfo.branch, viewerInfo.branch, viewerInfo.department, 'team:' + viewerInfo.department, viewer.sub).all();
  }

  const masked = (notes.results || []).map((n: any) => maskNote(n, role));
  return c.json({ notes: masked });
});

// GET /api/admin-notes/:id - 상세 조회
adminNotes.get('/:id', async (c) => {
  const db = c.env.DB;
  await ensureAdminNoteExtensions(db);
  const viewer = c.get('user');
  const id = c.req.param('id');

  const viewerInfo = await db.prepare('SELECT role, branch, department FROM users WHERE id = ?').bind(viewer.sub).first<{ role: string; branch: string; department: string }>();
  const role = viewerInfo?.role || viewer.role;

  const note = await db.prepare(
    'SELECT n.*, u.position_title as author_position FROM admin_notes n LEFT JOIN users u ON n.author_id = u.id WHERE n.id = ?'
  ).bind(id).first<any>();
  if (!note) return c.json({ error: '노트를 찾을 수 없습니다.' }, 404);

  // visibility 체크 (master는 예외)
  if (role !== 'master' && note.author_id !== viewer.sub) {
    const v = note.visibility || 'all';
    const allowed =
      v === 'all' ||
      (v === 'branch' && note.author_branch === viewerInfo?.branch) ||
      (v === 'department' && note.author_branch === viewerInfo?.branch && note.author_department === viewerInfo?.department) ||
      (v.startsWith('team:') && v === 'team:' + viewerInfo?.department);
    if (!allowed) return c.json({ error: '열람 권한이 없습니다.' }, 403);
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

  const maskedNote = maskNote({ ...note }, role);
  const maskedComments = (comments.results || []).map((cm: any) => maskComment({ ...cm }, role));

  return c.json({ note: maskedNote, comments: maskedComments, attachments: attachments.results || [] });
});

// POST /api/admin-notes - 생성
adminNotes.post('/', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  await ensureAdminNoteExtensions(db);
  const { title, content, pinned, source_type, source_id, is_anonymous, visibility, category: rawCategory, court, case_number, attachments } = await c.req.json();
  const category = normalizeCategory(rawCategory);
  if (!title?.trim() || !content?.trim()) return c.json({ error: '제목과 내용을 입력하세요.' }, 400);
  if (category === 'eviction_quote' && (!court?.trim() || !case_number?.trim())) {
    return c.json({ error: '법원과 사건번호를 입력하세요.' }, 400);
  }

  // 사용자 정보
  const profile = await db.prepare(
    'SELECT branch, department, position_title, role FROM users WHERE id = ?'
  ).bind(user.sub).first<{ branch: string; department: string; position_title: string; role: string }>();

  // 핀 고정은 master만
  const canPin = (profile?.role || user.role) === 'master';

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
  await db.prepare(
    `INSERT INTO admin_notes (id, title, content, author_id, author_name, pinned, source_type, source_id, is_anonymous, visibility, author_branch, author_department, category, court, case_number, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${KST_NOW_SQL}, ${KST_NOW_SQL})`
  ).bind(
    id, title.trim(), content.trim(), user.sub, user.name,
    canPin && pinned ? 1 : 0,
    source_type || null, source_id || null,
    is_anonymous ? 1 : 0,
    visibility || 'all',
    profile?.branch || '', profile?.department || '',
    category,
    category === 'eviction_quote' ? court.trim() : null,
    category === 'eviction_quote' ? case_number.trim() : null
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

  if (category === 'eviction_quote') {
    const phones = await teamPhones(db, '명도팀');
    if (phones.length > 0) {
      c.executionCtx.waitUntil(sendAlimtalkByTemplate(
        c.env as unknown as Record<string, unknown>,
        'COMMUNITY_EVICTION_QUOTE',
        { author_name: user.name, court: court.trim(), case_number: case_number.trim(), title: title.trim(), link: `${APP_URL}/admin-notes` },
        phones,
        { db, relatedType: 'admin_note', relatedId: id },
      ).catch(() => {}));
    }
  } else if (category === 'legal_support') {
    const phones = await teamPhones(db, '법률지원팀');
    if (phones.length > 0) {
      const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
      c.executionCtx.waitUntil(sendAlimtalkByTemplate(
        c.env as unknown as Record<string, unknown>,
        'COMMUNITY_LEGAL_SUPPORT',
        { author_name: is_anonymous ? '익명' : user.name, title: title.trim(), date: today, link: `${APP_URL}/admin-notes` },
        phones,
        { db, relatedType: 'admin_note', relatedId: id },
      ).catch(() => {}));
    }
  }

  return c.json({ success: true, id });
});

// PUT /api/admin-notes/:id - 수정
adminNotes.put('/:id', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  await ensureAdminNoteExtensions(db);
  const id = c.req.param('id');
  const { title, content, pinned } = await c.req.json();

  const note = await db.prepare('SELECT * FROM admin_notes WHERE id = ?').bind(id).first<any>();
  if (!note) return c.json({ error: '노트를 찾을 수 없습니다.' }, 404);

  if (note.author_id !== user.sub && user.role !== 'master') {
    return c.json({ error: '본인 글만 수정할 수 있습니다.' }, 403);
  }

  // pinned 수정은 master만
  const canPin = user.role === 'master';
  const newPinned = pinned !== undefined ? (canPin ? (pinned ? 1 : 0) : note.pinned) : note.pinned;

  await db.prepare(
    `UPDATE admin_notes SET title = ?, content = ?, pinned = ?, updated_at = ${KST_NOW_SQL} WHERE id = ?`
  ).bind(title?.trim() || note.title, content?.trim() || note.content, newPinned, id).run();

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
    SELECT n.id, n.title, n.category, n.court, n.case_number, n.author_id,
      u.name as receiver_name, u.phone as receiver_phone
    FROM admin_notes n
    LEFT JOIN users u ON u.id = n.author_id
    WHERE n.id = ?
  `).bind(noteId).first<{
    id: string;
    title: string;
    category: string | null;
    court: string | null;
    case_number: string | null;
    author_id: string;
    receiver_name: string | null;
    receiver_phone: string | null;
  }>();
  if (!note) return c.json({ error: '게시글을 찾을 수 없습니다.' }, 404);

  const id = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO admin_note_comments (id, note_id, author_id, author_name, content, is_anonymous, created_at) VALUES (?, ?, ?, ?, ?, ?, ${KST_NOW_SQL})`
  ).bind(id, noteId, user.sub, user.name, content.trim(), is_anonymous ? 1 : 0).run();

  const category = note.category || 'community';
  if (note.receiver_phone && note.author_id !== user.sub && category === 'eviction_quote') {
    c.executionCtx.waitUntil(sendAlimtalkByTemplate(
      c.env as unknown as Record<string, unknown>,
      'COMMUNITY_EVICTION_QUOTE_ANSWERED',
      {
        receiver_name: note.receiver_name || '담당자',
        court: note.court || '-',
        case_number: note.case_number || '-',
        responder_name: is_anonymous ? '익명' : user.name,
        link: `${APP_URL}/admin-notes`,
      },
      [note.receiver_phone],
      { db, relatedType: 'admin_note_comment', relatedId: id },
    ).catch(() => {}));
  } else if (note.receiver_phone && note.author_id !== user.sub && category === 'legal_support') {
    c.executionCtx.waitUntil(sendAlimtalkByTemplate(
      c.env as unknown as Record<string, unknown>,
      'COMMUNITY_LEGAL_SUPPORT_ANSWERED',
      {
        receiver_name: note.receiver_name || '담당자',
        title: note.title,
        responder_name: is_anonymous ? '익명' : user.name,
        link: `${APP_URL}/admin-notes`,
      },
      [note.receiver_phone],
      { db, relatedType: 'admin_note_comment', relatedId: id },
    ).catch(() => {}));
  }

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
