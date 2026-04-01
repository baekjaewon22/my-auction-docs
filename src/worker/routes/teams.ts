import { Hono } from 'hono';
import type { AuthEnv, Team } from '../types';
import { authMiddleware, requireRole } from '../middleware/auth';

const teams = new Hono<AuthEnv>();
teams.use('*', authMiddleware);

// GET /api/teams - list teams
teams.get('/', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  let result;
  if (user.role === 'master' || user.role === 'ceo' || user.role === 'admin') {
    result = await db.prepare('SELECT * FROM teams ORDER BY created_at DESC').all<Team>();
  } else {
    result = await db.prepare('SELECT * FROM teams WHERE id = ?').bind(user.team_id).all<Team>();
  }

  return c.json({ teams: result.results });
});

// POST /api/teams - create team (admin only)
teams.post('/', requireRole('master', 'ceo'), async (c) => {
  const { name, description } = await c.req.json<{ name: string; description?: string }>();
  if (!name) return c.json({ error: '팀 이름은 필수입니다.' }, 400);

  const db = c.env.DB;
  const id = crypto.randomUUID();

  await db.prepare(
    'INSERT INTO teams (id, name, description) VALUES (?, ?, ?)'
  ).bind(id, name, description || '').run();

  return c.json({ team: { id, name, description: description || '' } }, 201);
});

// PUT /api/teams/:id - update team
teams.put('/:id', requireRole('master', 'ceo'), async (c) => {
  const id = c.req.param('id');
  const { name, description } = await c.req.json<{ name?: string; description?: string }>();
  const db = c.env.DB;

  const team = await db.prepare('SELECT * FROM teams WHERE id = ?').bind(id).first<Team>();
  if (!team) return c.json({ error: '팀을 찾을 수 없습니다.' }, 404);

  await db.prepare(
    "UPDATE teams SET name = ?, description = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(name || team.name, description ?? team.description, id).run();

  return c.json({ success: true });
});

// DELETE /api/teams/:id
teams.delete('/:id', requireRole('master', 'ceo'), async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;

  await db.prepare('UPDATE users SET team_id = NULL WHERE team_id = ?').bind(id).run();
  await db.prepare('DELETE FROM teams WHERE id = ?').bind(id).run();

  return c.json({ success: true });
});

// GET /api/teams/:id/members
teams.get('/:id/members', async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const db = c.env.DB;

  if (user.role === 'member' && user.team_id !== id) {
    return c.json({ error: '권한이 없습니다.' }, 403);
  }

  const result = await db.prepare(
    'SELECT id, email, name, role, created_at FROM users WHERE team_id = ?'
  ).bind(id).all();

  return c.json({ members: result.results });
});

// POST /api/teams/:id/members - add member to team
teams.post('/:id/members', requireRole('master', 'ceo', 'admin', 'manager'), async (c) => {
  const teamId = c.req.param('id');
  const { user_id } = await c.req.json<{ user_id: string }>();
  const db = c.env.DB;

  await db.prepare(
    "UPDATE users SET team_id = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(teamId, user_id).run();

  return c.json({ success: true });
});

// DELETE /api/teams/:id/members/:userId - remove member from team
teams.delete('/:id/members/:userId', requireRole('master', 'ceo', 'admin', 'manager'), async (c) => {
  const userId = c.req.param('userId');
  const db = c.env.DB;

  await db.prepare(
    "UPDATE users SET team_id = NULL, updated_at = datetime('now') WHERE id = ?"
  ).bind(userId).run();

  return c.json({ success: true });
});

export default teams;
