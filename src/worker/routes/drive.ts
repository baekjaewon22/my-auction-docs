import { Hono } from 'hono';
import type { AuthEnv } from '../types';
import { authMiddleware, requireRole } from '../middleware/auth';

const drive = new Hono<AuthEnv>();
drive.use('*', authMiddleware);

const DRIVE_ROLES = ['master', 'ceo', 'cc_ref', 'admin', 'accountant', 'accountant_asst'] as const;

// GET /api/drive/settings — 현재 설정 + 통계 반환
drive.get('/settings', requireRole(...DRIVE_ROLES), async (c) => {
  const db = c.env.DB;
  const s = await db.prepare("SELECT * FROM drive_settings WHERE id = 'default'").first<any>();
  const lastLog = await db.prepare(
    "SELECT run_at, status FROM drive_backup_logs WHERE status = 'success' ORDER BY run_at DESC LIMIT 1"
  ).first<any>();
  const pending = await db.prepare(`
    SELECT COUNT(*) as cnt FROM documents d
    WHERE d.status = 'approved' AND d.cancelled = 0
      AND NOT EXISTS (
        SELECT 1 FROM approval_steps s WHERE s.document_id = d.id AND s.status != 'approved'
      )
      AND NOT EXISTS (
        SELECT 1 FROM drive_backup_logs b WHERE b.document_id = d.id AND b.status = 'success'
      )
  `).first<{ cnt: number }>();
  return c.json({
    settings: s || {},
    last_backup_at: lastLog?.run_at || null,
    pending_count: pending?.cnt || 0,
  });
});

// PUT /api/drive/settings — 설정 저장
drive.put('/settings', requireRole(...DRIVE_ROLES), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const body = await c.req.json<{
    root_folder_id?: string;
    root_folder_name?: string;
    folder_pattern?: string;
    filename_pattern?: string;
    connected_email?: string;
  }>();

  await db.prepare(`
    UPDATE drive_settings SET
      root_folder_id = COALESCE(?, root_folder_id),
      root_folder_name = COALESCE(?, root_folder_name),
      folder_pattern = COALESCE(?, folder_pattern),
      filename_pattern = COALESCE(?, filename_pattern),
      connected_email = COALESCE(?, connected_email),
      connected_by = CASE WHEN ? IS NOT NULL THEN ? ELSE connected_by END,
      connected_at = CASE WHEN ? IS NOT NULL THEN datetime('now') ELSE connected_at END,
      updated_at = datetime('now')
    WHERE id = 'default'
  `).bind(
    body.root_folder_id ?? null,
    body.root_folder_name ?? null,
    body.folder_pattern ?? null,
    body.filename_pattern ?? null,
    body.connected_email ?? null,
    body.connected_email ?? null, user.sub,
    body.connected_email ?? null,
  ).run();
  return c.json({ success: true });
});

// GET /api/drive/pending — 백업 대상 문서 목록
drive.get('/pending', requireRole(...DRIVE_ROLES), async (c) => {
  const db = c.env.DB;
  const result = await db.prepare(`
    SELECT d.id, d.title, d.template_id, d.branch, d.department, d.created_at, d.updated_at,
      u.name as author_name, u.branch as author_branch, u.department as author_department,
      u.position_title as author_position,
      t.title as template_name,
      (SELECT MAX(s.signed_at) FROM approval_steps s WHERE s.document_id = d.id AND s.status = 'approved') as approved_at
    FROM documents d
    LEFT JOIN users u ON u.id = d.author_id
    LEFT JOIN templates t ON t.id = d.template_id
    WHERE d.status = 'approved' AND d.cancelled = 0
      AND NOT EXISTS (
        SELECT 1 FROM approval_steps s WHERE s.document_id = d.id AND s.status != 'approved'
      )
      AND NOT EXISTS (
        SELECT 1 FROM drive_backup_logs b WHERE b.document_id = d.id AND b.status = 'success'
      )
    ORDER BY approved_at ASC
    LIMIT 500
  `).all();
  return c.json({ documents: result.results || [] });
});

// POST /api/drive/log — 백업 결과 기록
drive.post('/log', requireRole(...DRIVE_ROLES), async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const body = await c.req.json<{
    document_id: string;
    status: 'success' | 'failed';
    drive_file_id?: string;
    drive_folder_path?: string;
    file_size?: number;
    error_message?: string;
  }>();

  await db.prepare(`
    INSERT INTO drive_backup_logs
      (id, document_id, run_at, status, drive_file_id, drive_folder_path, file_size, triggered_by, error_message)
    VALUES (?, ?, datetime('now'), ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(), body.document_id, body.status,
    body.drive_file_id || null, body.drive_folder_path || null,
    body.file_size || 0, user.sub, body.error_message || null,
  ).run();
  return c.json({ success: true });
});

// GET /api/drive/logs — 최근 백업 로그
drive.get('/logs', requireRole(...DRIVE_ROLES), async (c) => {
  const db = c.env.DB;
  const limit = Math.min(100, Number(c.req.query('limit') || 20));
  const result = await db.prepare(`
    SELECT b.*, d.title as document_title, u.name as triggered_by_name
    FROM drive_backup_logs b
    LEFT JOIN documents d ON d.id = b.document_id
    LEFT JOIN users u ON u.id = b.triggered_by
    ORDER BY b.run_at DESC
    LIMIT ?
  `).bind(limit).all();
  return c.json({ logs: result.results || [] });
});

export default drive;
