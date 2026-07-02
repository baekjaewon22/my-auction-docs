import { Hono } from 'hono';
import type { AuthEnv } from '../types';
import { authMiddleware, requireRole } from '../middleware/auth';
import { CANONICAL_BRANCHES, normalizeBranchName } from '../lib/branchAliases';

const branches = new Hono<AuthEnv>();

// GET /api/branches (인증 불필요 — 로그인 페이지에서도 사용)
branches.get('/', async (c) => {
  const db = c.env.DB;
  const result = await db.prepare('SELECT * FROM branches ORDER BY sort_order, name').all();
  const rows = result.results || [];
  const seen = new Set<string>();
  const normalizedRows = rows
    .map((row: any) => ({ ...row, name: normalizeBranchName(row.name) || row.name }))
    .filter((row: any) => {
      if (seen.has(row.name)) return false;
      seen.add(row.name);
      return true;
    })
    .sort((a: any, b: any) => {
      const ai = CANONICAL_BRANCHES.indexOf(a.name as any);
      const bi = CANONICAL_BRANCHES.indexOf(b.name as any);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi) || String(a.name).localeCompare(String(b.name), 'ko');
    });
  return c.json({ branches: normalizedRows });
});

// POST /api/branches (인증 필요)
branches.post('/', authMiddleware, requireRole('master', 'ceo', 'admin'), async (c) => {
  const { name } = await c.req.json<{ name: string }>();
  const normalizedName = normalizeBranchName(name) || String(name || '').trim();
  const db = c.env.DB;
  const existing = await db.prepare("SELECT id FROM branches WHERE REPLACE(name, ' ', '') = ?").bind(normalizedName.replace(/\s+/g, '')).first();
  if (existing) return c.json({ error: '이미 존재하는 지사입니다.' }, 409);
  const max = await db.prepare('SELECT MAX(sort_order) as m FROM branches').first<any>();
  const id = crypto.randomUUID();
  await db.prepare('INSERT INTO branches (id, name, sort_order) VALUES (?, ?, ?)').bind(id, normalizedName, (max?.m || 0) + 1).run();
  return c.json({ success: true, id });
});

// DELETE /api/branches/:id (인증 필요)
branches.delete('/:id', authMiddleware, requireRole('master', 'ceo', 'admin'), async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  await db.prepare('DELETE FROM branches WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

export default branches;
