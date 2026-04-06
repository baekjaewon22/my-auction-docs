import { Hono } from 'hono';
import type { AuthEnv } from '../types';
import { authMiddleware, requireRole } from '../middleware/auth';

const commissions = new Hono<AuthEnv>();

commissions.use('*', authMiddleware);

// GET /api/commissions - 목록 조회 (관리자급 이상만)
commissions.get('/', requireRole('master', 'ceo', 'cc_ref', 'admin'), async (c) => {
  const db = c.env.DB;
  const result = await db.prepare(
    `SELECT c.*, u.name as user_display_name, u.department, u.branch
     FROM commissions c
     LEFT JOIN users u ON c.user_id = u.id
     ORDER BY c.status ASC, c.created_at DESC`
  ).all();
  return c.json({ commissions: result.results });
});

// GET /api/commissions/pending-count - 미정산 건수 (관리자급 이상만)
commissions.get('/pending-count', requireRole('master', 'ceo', 'cc_ref', 'admin'), async (c) => {
  const db = c.env.DB;
  const result = await db.prepare(
    "SELECT COUNT(*) as count FROM commissions WHERE status = 'pending'"
  ).first<{ count: number }>();
  return c.json({ count: result?.count || 0 });
});

// GET /api/commissions/my-pending - 미정산 목록 (관리자급 이상만, 대시보드 알림용)
commissions.get('/my-pending', requireRole('master', 'ceo', 'cc_ref', 'admin'), async (c) => {
  const db = c.env.DB;
  const result = await db.prepare(
    `SELECT c.*, u.name as user_display_name
     FROM commissions c
     LEFT JOIN users u ON c.user_id = u.id
     WHERE c.status = 'pending'
     ORDER BY c.created_at ASC
     LIMIT 10`
  ).all();
  return c.json({ commissions: result.results });
});

// POST /api/commissions/:id/complete - 입금완료 처리 (cc_ref 이상)
commissions.post('/:id/complete', requireRole('master', 'ceo', 'cc_ref'), async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const db = c.env.DB;

  const row = await db.prepare('SELECT * FROM commissions WHERE id = ?').bind(id).first();
  if (!row) return c.json({ error: '수수료 항목을 찾을 수 없습니다.' }, 404);

  await db.prepare(
    "UPDATE commissions SET status = 'completed', completed_by = ?, completed_at = datetime('now') WHERE id = ?"
  ).bind(user.sub, id).run();

  return c.json({ success: true });
});

// POST /api/commissions - 수동 생성 (낙찰 토글에서 호출)
commissions.post('/', async (c) => {
  const db = c.env.DB;
  const { journal_entry_id, user_id, user_name, client_name, case_no, win_price } = await c.req.json<{
    journal_entry_id: string;
    user_id: string;
    user_name: string;
    client_name: string;
    case_no: string;
    win_price: string;
  }>();

  // 중복 방지
  const existing = await db.prepare(
    'SELECT id FROM commissions WHERE journal_entry_id = ?'
  ).bind(journal_entry_id).first();
  if (existing) return c.json({ success: true, id: existing.id });

  const id = crypto.randomUUID();
  await db.prepare(
    'INSERT INTO commissions (id, journal_entry_id, user_id, user_name, client_name, case_no, win_price) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, journal_entry_id, user_id, user_name, client_name, case_no, win_price).run();

  return c.json({ success: true, id }, 201);
});

// DELETE /api/commissions/by-entry/:entryId - 낙찰 취소 시 삭제
commissions.delete('/by-entry/:entryId', async (c) => {
  const entryId = c.req.param('entryId');
  const db = c.env.DB;
  await db.prepare("DELETE FROM commissions WHERE journal_entry_id = ? AND status = 'pending'").bind(entryId).run();
  return c.json({ success: true });
});

export default commissions;
