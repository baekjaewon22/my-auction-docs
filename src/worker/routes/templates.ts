import { Hono } from 'hono';
import type { AuthEnv, Template } from '../types';
import { authMiddleware, requireRole } from '../middleware/auth';

const templates = new Hono<AuthEnv>();
templates.use('*', authMiddleware);

// GET /api/templates
templates.get('/', async (c) => {
  const db = c.env.DB;
  const result = await db.prepare(
    'SELECT * FROM templates WHERE is_active = 1 ORDER BY created_at DESC'
  ).all<Template>();

  return c.json({ templates: result.results });
});

// GET /api/templates/:id
templates.get('/:id', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const template = await db.prepare('SELECT * FROM templates WHERE id = ?').bind(id).first<Template>();

  if (!template) return c.json({ error: '템플릿을 찾을 수 없습니다.' }, 404);
  return c.json({ template });
});

// POST /api/templates (admin+)
templates.post('/', requireRole('master', 'ceo', 'cc_ref', 'admin'), async (c) => {
  const user = c.get('user');
  const { title, description, content, category } = await c.req.json<{
    title: string;
    description?: string;
    content: string;
    category?: string;
  }>();

  if (!title) return c.json({ error: '템플릿 제목은 필수입니다.' }, 400);

  const db = c.env.DB;
  const id = crypto.randomUUID();

  await db.prepare(
    'INSERT INTO templates (id, title, description, content, category, created_by) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, title, description || '', content || '{}', category || '', user.sub).run();

  return c.json({ template: { id, title, description, content, category } }, 201);
});

// PUT /api/templates/:id (admin+)
templates.put('/:id', requireRole('master', 'ceo', 'cc_ref', 'admin'), async (c) => {
  const id = c.req.param('id');
  const { title, description, content, category, is_active } = await c.req.json<{
    title?: string;
    description?: string;
    category?: string;
    content?: string;
    is_active?: number;
  }>();

  const db = c.env.DB;
  const existing = await db.prepare('SELECT * FROM templates WHERE id = ?').bind(id).first<Template>();
  if (!existing) return c.json({ error: '템플릿을 찾을 수 없습니다.' }, 404);

  await db.prepare(
    "UPDATE templates SET title = ?, description = ?, content = ?, category = ?, is_active = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(
    title || existing.title,
    description ?? existing.description,
    content || existing.content,
    category ?? existing.category,
    is_active ?? existing.is_active,
    id
  ).run();

  return c.json({ success: true });
});

// DELETE /api/templates/:id (admin+ - soft delete)
templates.delete('/:id', requireRole('master', 'ceo', 'cc_ref', 'admin'), async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;

  await db.prepare(
    "UPDATE templates SET is_active = 0, updated_at = datetime('now') WHERE id = ?"
  ).bind(id).run();

  return c.json({ success: true });
});

export default templates;
