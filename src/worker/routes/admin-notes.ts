import { Hono } from 'hono';
import type { AuthEnv, Role } from '../types';
import { authMiddleware } from '../middleware/auth';

const ADMIN_ROLES: Role[] = ['master', 'ceo', 'cc_ref', 'admin'];

const adminNotes = new Hono<AuthEnv>();

adminNotes.use('*', authMiddleware);

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
  const viewer = c.get('user');

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
         (SELECT COUNT(*) FROM admin_note_comments WHERE note_id = n.id) as comment_count
       FROM admin_notes n
       LEFT JOIN users u ON n.author_id = u.id
       ORDER BY n.pinned DESC, n.created_at DESC`
    ).all();
  } else {
    // 관리자급 포함 전체: visibility 조건 적용
    notes = await db.prepare(
      `SELECT n.*, u.position_title as author_position,
         (SELECT COUNT(*) FROM admin_note_comments WHERE note_id = n.id) as comment_count
       FROM admin_notes n
       LEFT JOIN users u ON n.author_id = u.id
       WHERE n.visibility = 'all'
          OR (n.visibility = 'branch' AND n.author_branch = ?)
          OR (n.visibility = 'department' AND n.author_branch = ? AND n.author_department = ?)
          OR (n.visibility LIKE 'team:%' AND n.visibility = ?)
          OR n.author_id = ?
       ORDER BY n.pinned DESC, n.created_at DESC`
    ).bind(viewerInfo.branch, viewerInfo.branch, viewerInfo.department, 'team:' + viewerInfo.department, viewer.sub).all();
  }

  const masked = (notes.results || []).map((n: any) => maskNote(n, role));
  return c.json({ notes: masked });
});

// GET /api/admin-notes/:id - 상세 조회
adminNotes.get('/:id', async (c) => {
  const db = c.env.DB;
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

  const maskedNote = maskNote({ ...note }, role);
  const maskedComments = (comments.results || []).map((cm: any) => maskComment({ ...cm }, role));

  return c.json({ note: maskedNote, comments: maskedComments });
});

// POST /api/admin-notes - 생성
adminNotes.post('/', async (c) => {
  const user = c.get('user');
  const { title, content, pinned, source_type, source_id, is_anonymous, visibility } = await c.req.json();
  if (!title?.trim() || !content?.trim()) return c.json({ error: '제목과 내용을 입력하세요.' }, 400);

  // 사용자 정보
  const profile = await c.env.DB.prepare(
    'SELECT branch, department, position_title, role FROM users WHERE id = ?'
  ).bind(user.sub).first<{ branch: string; department: string; position_title: string; role: string }>();

  // 핀 고정은 master만
  const canPin = (profile?.role || user.role) === 'master';

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO admin_notes (id, title, content, author_id, author_name, pinned, source_type, source_id, is_anonymous, visibility, author_branch, author_department)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, title.trim(), content.trim(), user.sub, user.name,
    canPin && pinned ? 1 : 0,
    source_type || null, source_id || null,
    is_anonymous ? 1 : 0,
    visibility || 'all',
    profile?.branch || '', profile?.department || ''
  ).run();

  return c.json({ success: true, id });
});

// PUT /api/admin-notes/:id - 수정
adminNotes.put('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const { title, content, pinned } = await c.req.json();

  const note = await c.env.DB.prepare('SELECT * FROM admin_notes WHERE id = ?').bind(id).first<any>();
  if (!note) return c.json({ error: '노트를 찾을 수 없습니다.' }, 404);

  if (note.author_id !== user.sub && user.role !== 'master') {
    return c.json({ error: '본인 글만 수정할 수 있습니다.' }, 403);
  }

  // pinned 수정은 master만
  const canPin = user.role === 'master';
  const newPinned = pinned !== undefined ? (canPin ? (pinned ? 1 : 0) : note.pinned) : note.pinned;

  await c.env.DB.prepare(
    `UPDATE admin_notes SET title = ?, content = ?, pinned = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(title?.trim() || note.title, content?.trim() || note.content, newPinned, id).run();

  return c.json({ success: true });
});

// DELETE /api/admin-notes/:id - 삭제
adminNotes.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');

  const note = await c.env.DB.prepare('SELECT * FROM admin_notes WHERE id = ?').bind(id).first<any>();
  if (!note) return c.json({ error: '노트를 찾을 수 없습니다.' }, 404);

  if (note.author_id !== user.sub && user.role !== 'master') {
    return c.json({ error: '본인 글만 삭제할 수 있습니다.' }, 403);
  }

  await c.env.DB.prepare('DELETE FROM admin_notes WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

// POST /api/admin-notes/:id/comments - 댓글 작성
adminNotes.post('/:id/comments', async (c) => {
  const user = c.get('user');
  const noteId = c.req.param('id');
  const { content, is_anonymous } = await c.req.json();
  if (!content?.trim()) return c.json({ error: '내용을 입력하세요.' }, 400);

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    'INSERT INTO admin_note_comments (id, note_id, author_id, author_name, content, is_anonymous) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, noteId, user.sub, user.name, content.trim(), is_anonymous ? 1 : 0).run();

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
