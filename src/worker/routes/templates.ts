import { Hono, type MiddlewareHandler } from 'hono';
import type { AuthEnv, Template } from '../types';
import { authMiddleware } from '../middleware/auth';
import {
  ensureTemplateAccessSchema,
  isEmployeeTemplateAdmin,
  isFreelancerViewer,
} from '../lib/template-access';

const templates = new Hono<AuthEnv>();
templates.use('*', authMiddleware);
const HIDDEN_TEMPLATE_IDS = ['tpl-att-001', 'tpl-att-002', 'tpl-att-011'];
const requireTemplateAdmin: MiddlewareHandler<AuthEnv> = async (c, next) => {
  if (!isEmployeeTemplateAdmin(c.get('user'))) {
    return c.json({ error: '권한이 없습니다.' }, 403);
  }
  await next();
};

// GET /api/templates
templates.get('/', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  await ensureTemplateAccessSchema(db);
  const freelancerFilter = isFreelancerViewer(user) ? ' AND is_myauction = 1' : '';
  const result = await db.prepare(
    `SELECT * FROM templates
     WHERE is_active = 1
       AND id NOT IN (${HIDDEN_TEMPLATE_IDS.map(() => '?').join(',')})
       ${freelancerFilter}
     ORDER BY created_at DESC`
  ).bind(...HIDDEN_TEMPLATE_IDS).all<Template>();

  return c.json({ templates: result.results });
});

// GET /api/templates/:id
templates.get('/:id', async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const db = c.env.DB;
  await ensureTemplateAccessSchema(db);
  const isAdmin = isEmployeeTemplateAdmin(user);
  const conditions = isAdmin
    ? ''
    : `AND is_active = 1
       AND id NOT IN (${HIDDEN_TEMPLATE_IDS.map(() => '?').join(',')})
       ${isFreelancerViewer(user) ? 'AND is_myauction = 1' : ''}`;
  const bindings = isAdmin ? [id] : [id, ...HIDDEN_TEMPLATE_IDS];
  const template = await db.prepare(
    `SELECT * FROM templates WHERE id = ? ${conditions}`
  ).bind(...bindings).first<Template>();

  if (!template) return c.json({ error: '템플릿을 찾을 수 없습니다.' }, 404);
  return c.json({ template });
});

// POST /api/templates (admin+)
templates.post('/', requireTemplateAdmin, async (c) => {
  const user = c.get('user');
  const { title, description, content, category, is_myauction } = await c.req.json<{
    title: string;
    description?: string;
    content: string;
    category?: string;
    is_myauction?: number;
  }>();

  if (!title) return c.json({ error: '템플릿 제목은 필수입니다.' }, 400);

  const db = c.env.DB;
  await ensureTemplateAccessSchema(db);
  const id = crypto.randomUUID();

  await db.prepare(
    'INSERT INTO templates (id, title, description, content, category, is_myauction, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, title, description || '', content || '{}', category || '', is_myauction === 1 ? 1 : 0, user.sub).run();

  return c.json({ template: { id, title, description, content, category, is_myauction: is_myauction === 1 ? 1 : 0 } }, 201);
});

// PUT /api/templates/:id (admin+)
templates.put('/:id', requireTemplateAdmin, async (c) => {
  const id = c.req.param('id');
  const { title, description, content, category, is_active, is_myauction } = await c.req.json<{
    title?: string;
    description?: string;
    category?: string;
    content?: string;
    is_active?: number;
    is_myauction?: number;
  }>();

  const db = c.env.DB;
  await ensureTemplateAccessSchema(db);
  const existing = await db.prepare('SELECT * FROM templates WHERE id = ?').bind(id).first<Template>();
  if (!existing) return c.json({ error: '템플릿을 찾을 수 없습니다.' }, 404);

  const nextMyAuction = is_myauction === undefined
    ? existing.is_myauction
    : (is_myauction === 1 ? 1 : 0);
  const updateTemplate = db.prepare(
    "UPDATE templates SET title = ?, description = ?, content = ?, category = ?, is_active = ?, is_myauction = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(
    title || existing.title,
    description ?? existing.description,
    content || existing.content,
    category ?? existing.category,
    is_active ?? existing.is_active,
    nextMyAuction,
    id
  );
  if (nextMyAuction === 1) {
    await db.batch([
      updateTemplate,
      db.prepare('UPDATE documents SET is_myauction = 1 WHERE template_id = ?').bind(id),
    ]);
  } else {
    // Intentional: documents keep the access classification captured when they
    // were created. Unmarking a template affects future documents only.
    await updateTemplate.run();
  }

  return c.json({ success: true });
});

// DELETE /api/templates/:id (admin+ - soft delete)
templates.delete('/:id', requireTemplateAdmin, async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  await ensureTemplateAccessSchema(db);

  await db.prepare(
    "UPDATE templates SET is_active = 0, updated_at = datetime('now') WHERE id = ?"
  ).bind(id).run();

  return c.json({ success: true });
});

export default templates;
