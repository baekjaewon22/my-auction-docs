import { Hono } from 'hono';
import type { AuthEnv, Document } from '../types';
import { authMiddleware, requireRole } from '../middleware/auth';

const documents = new Hono<AuthEnv>();
documents.use('*', authMiddleware);

// Permission-based document visibility:
// master/ceo: all documents
// admin: same branch only
// manager: same branch + same department only
// member: own documents only

// GET /api/documents
documents.get('/', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const status = c.req.query('status');

  let query = 'SELECT d.*, u.name as author_name FROM documents d LEFT JOIN users u ON d.author_id = u.id';
  const conditions: string[] = [];
  const params: string[] = [];

  if (user.role === 'master' || user.role === 'ceo') {
    // Full access
  } else if (user.role === 'admin' && user.branch === '의정부') {
    // 의정부 관리자: 전체 열람 가능
  } else if (user.role === 'admin') {
    // 기타 지사 관리자: 본인 지사만
    conditions.push('d.branch = ?');
    params.push(user.branch);
  } else if (user.role === 'manager') {
    conditions.push('d.branch = ?');
    conditions.push('d.department = ?');
    params.push(user.branch);
    params.push(user.department);
  } else {
    conditions.push('d.author_id = ?');
    params.push(user.sub);
  }

  if (status) {
    conditions.push('d.status = ?');
    params.push(status);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  query += ' ORDER BY d.updated_at DESC';

  const stmt = db.prepare(query);
  const result = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all();
  return c.json({ documents: result.results });
});

// GET /api/documents/:id
documents.get('/:id', async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const db = c.env.DB;

  const doc = await db.prepare(
    'SELECT d.*, u.name as author_name FROM documents d LEFT JOIN users u ON d.author_id = u.id WHERE d.id = ?'
  ).bind(id).first<Document & { author_name: string }>();
  if (!doc) return c.json({ error: '문서를 찾을 수 없습니다.' }, 404);

  // Permission check
  if (user.role === 'member' && doc.author_id !== user.sub) {
    return c.json({ error: '권한이 없습니다.' }, 403);
  }
  if (user.role === 'manager' && doc.author_id !== user.sub && (doc.branch !== user.branch || doc.department !== user.department)) {
    return c.json({ error: '권한이 없습니다.' }, 403);
  }
  // 의정부 관리자는 타지사 열람 가능, 기타 관리자는 본인 지사만
  if (user.role === 'admin' && user.branch !== '의정부' && doc.branch !== user.branch && doc.author_id !== user.sub) {
    return c.json({ error: '권한이 없습니다.' }, 403);
  }

  return c.json({ document: doc });
});

// POST /api/documents
documents.post('/', async (c) => {
  const user = c.get('user');
  const { title, content, template_id } = await c.req.json<{
    title: string; content?: string; template_id?: string;
  }>();
  if (!title) return c.json({ error: '문서 제목은 필수입니다.' }, 400);

  const db = c.env.DB;
  const id = crypto.randomUUID();

  let initialContent = content || '{}';
  if (template_id && !content) {
    const template = await db.prepare('SELECT content FROM templates WHERE id = ?').bind(template_id).first<{ content: string }>();
    if (template) initialContent = template.content;
  }

  await db.prepare(
    'INSERT INTO documents (id, title, content, template_id, author_id, team_id, branch, department, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, title, initialContent, template_id || null, user.sub, user.team_id || null, user.branch, user.department, 'draft').run();

  await db.prepare(
    'INSERT INTO document_logs (id, document_id, user_id, action, details) VALUES (?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), id, user.sub, 'created', '문서가 생성되었습니다.').run();

  return c.json({ document: { id, title, status: 'draft' } }, 201);
});

// PUT /api/documents/:id
documents.put('/:id', async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const db = c.env.DB;

  const doc = await db.prepare('SELECT * FROM documents WHERE id = ?').bind(id).first<Document>();
  if (!doc) return c.json({ error: '문서를 찾을 수 없습니다.' }, 404);
  if (doc.author_id !== user.sub && user.role !== 'master') return c.json({ error: '권한이 없습니다.' }, 403);
  if (doc.status !== 'draft' && doc.status !== 'rejected') return c.json({ error: '작성중 또는 반려된 문서만 수정할 수 있습니다.' }, 400);

  const { title, content } = await c.req.json<{ title?: string; content?: string }>();
  await db.prepare("UPDATE documents SET title = ?, content = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(title || doc.title, content || doc.content, id).run();
  return c.json({ success: true });
});

// POST /api/documents/:id/submit
documents.post('/:id/submit', async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const db = c.env.DB;

  const doc = await db.prepare('SELECT * FROM documents WHERE id = ?').bind(id).first<Document>();
  if (!doc) return c.json({ error: '문서를 찾을 수 없습니다.' }, 404);
  if (doc.author_id !== user.sub) return c.json({ error: '본인 문서만 제출할 수 있습니다.' }, 403);
  if (doc.status !== 'draft' && doc.status !== 'rejected') return c.json({ error: '작성중 또는 반려된 문서만 제출할 수 있습니다.' }, 400);

  await db.prepare("UPDATE documents SET status = 'submitted', updated_at = datetime('now') WHERE id = ?").bind(id).run();
  await db.prepare('INSERT INTO document_logs (id, document_id, user_id, action, details) VALUES (?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), id, user.sub, 'submitted', '문서가 제출되었습니다.').run();
  return c.json({ success: true });
});

// POST /api/documents/:id/approve (manager+)
documents.post('/:id/approve', requireRole('master', 'ceo', 'admin', 'manager'), async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const db = c.env.DB;

  const doc = await db.prepare('SELECT * FROM documents WHERE id = ?').bind(id).first<Document>();
  if (!doc) return c.json({ error: '문서를 찾을 수 없습니다.' }, 404);
  if (doc.status !== 'submitted') return c.json({ error: '제출된 문서만 승인할 수 있습니다.' }, 400);

  // Branch permission check for admin/manager
  if (user.role === 'manager' && (doc.branch !== user.branch || doc.department !== user.department)) {
    return c.json({ error: '본인 팀 문서만 승인할 수 있습니다.' }, 403);
  }
  if (user.role === 'admin' && doc.branch !== user.branch) {
    return c.json({ error: '본인 지사 문서만 처리할 수 있습니다. (타지사 열람만 가능)' }, 403);
  }

  await db.prepare("UPDATE documents SET status = 'approved', updated_at = datetime('now') WHERE id = ?").bind(id).run();
  await db.prepare('INSERT INTO document_logs (id, document_id, user_id, action, details) VALUES (?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), id, user.sub, 'approved', '문서가 승인되었습니다.').run();
  return c.json({ success: true });
});

// POST /api/documents/:id/reject
documents.post('/:id/reject', requireRole('master', 'ceo', 'admin', 'manager'), async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const { reason } = await c.req.json<{ reason?: string }>();
  const db = c.env.DB;

  const doc = await db.prepare('SELECT * FROM documents WHERE id = ?').bind(id).first<Document>();
  if (!doc) return c.json({ error: '문서를 찾을 수 없습니다.' }, 404);
  if (doc.status !== 'submitted') return c.json({ error: '제출된 문서만 반려할 수 있습니다.' }, 400);

  if (user.role === 'manager' && (doc.branch !== user.branch || doc.department !== user.department)) {
    return c.json({ error: '본인 팀 문서만 반려할 수 있습니다.' }, 403);
  }
  if (user.role === 'admin' && doc.branch !== user.branch) {
    return c.json({ error: '본인 지사 문서만 반려할 수 있습니다.' }, 403);
  }

  await db.prepare("UPDATE documents SET status = 'rejected', reject_reason = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(reason || '', id).run();
  await db.prepare('INSERT INTO document_logs (id, document_id, user_id, action, details) VALUES (?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), id, user.sub, 'rejected', `문서가 반려되었습니다. 사유: ${reason || '없음'}`).run();
  return c.json({ success: true });
});

// DELETE /api/documents/:id
documents.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const db = c.env.DB;

  const doc = await db.prepare('SELECT * FROM documents WHERE id = ?').bind(id).first<Document>();
  if (!doc) return c.json({ error: '문서를 찾을 수 없습니다.' }, 404);
  if (doc.author_id !== user.sub && user.role !== 'master') return c.json({ error: '권한이 없습니다.' }, 403);

  await db.prepare('DELETE FROM documents WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

// GET /api/documents/:id/logs
documents.get('/:id/logs', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const result = await db.prepare(
    'SELECT dl.*, u.name as user_name FROM document_logs dl LEFT JOIN users u ON dl.user_id = u.id WHERE dl.document_id = ? ORDER BY dl.created_at DESC'
  ).bind(id).all();
  return c.json({ logs: result.results });
});

export default documents;
