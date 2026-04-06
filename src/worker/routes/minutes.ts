import { Hono } from 'hono';
import type { AuthEnv, Role } from '../types';
import { authMiddleware, requireRole, verifyToken } from '../middleware/auth';

const minutes = new Hono<AuthEnv>();

// 일반 엔드포인트: 표준 인증
minutes.use('*', async (c, next) => {
  // 다운로드 엔드포인트는 쿼리 토큰 허용 (새 탭에서 열기)
  if (c.req.path.endsWith('/download')) {
    const tokenParam = c.req.query('token');
    const authHeader = c.req.header('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : tokenParam;

    if (!token) return c.json({ error: '인증이 필요합니다.' }, 401);

    try {
      const payload = await verifyToken(token);
      // DB에서 최신 역할 확인
      const db = c.env.DB;
      const user = await db.prepare('SELECT role FROM users WHERE id = ?').bind(payload.sub).first<{ role: Role }>();
      if (!user || !['master', 'ceo', 'cc_ref'].includes(user.role)) {
        return c.json({ error: '권한이 없습니다.' }, 403);
      }
      payload.role = user.role;
      c.set('user', payload);
      return next();
    } catch {
      return c.json({ error: '유효하지 않은 토큰입니다.' }, 401);
    }
  }

  // 그 외: 표준 미들웨어
  return authMiddleware(c, next);
});

// 다운로드 외 엔드포인트에 역할 제한
minutes.use('*', async (c, next) => {
  if (c.req.path.endsWith('/download')) return next(); // 이미 위에서 처리
  return requireRole('master', 'ceo', 'cc_ref')(c, next);
});

// GET /api/minutes - 목록 조회
minutes.get('/', async (c) => {
  const db = c.env.DB;
  const rows = await db.prepare(
    `SELECT m.id, m.title, m.description, m.file_name, m.file_size, m.created_at, u.name as uploader_name
     FROM meeting_minutes m
     LEFT JOIN users u ON m.uploaded_by = u.id
     ORDER BY m.created_at DESC`
  ).all();
  return c.json({ minutes: rows.results });
});

// GET /api/minutes/:id/download - PDF 다운로드
minutes.get('/:id/download', async (c) => {
  const db = c.env.DB;
  const row = await db.prepare(
    'SELECT file_name, file_data FROM meeting_minutes WHERE id = ?'
  ).bind(c.req.param('id')).first<{ file_name: string; file_data: string }>();

  if (!row) return c.json({ error: '파일을 찾을 수 없습니다.' }, 404);

  const binary = Uint8Array.from(atob(row.file_data), ch => ch.charCodeAt(0));
  return new Response(binary, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${encodeURIComponent(row.file_name)}"`,
    },
  });
});

// POST /api/minutes - 업로드
minutes.post('/', async (c) => {
  const user = c.get('user');
  const formData = await c.req.formData();
  const title = formData.get('title') as string;
  const description = (formData.get('description') as string) || '';
  const file = formData.get('file') as File | null;

  if (!title || !file) {
    return c.json({ error: '제목과 파일은 필수입니다.' }, 400);
  }

  if (!file.name.toLowerCase().endsWith('.pdf')) {
    return c.json({ error: 'PDF 파일만 업로드 가능합니다.' }, 400);
  }

  // 5MB 제한
  if (file.size > 5 * 1024 * 1024) {
    return c.json({ error: '파일 크기는 5MB 이하만 가능합니다.' }, 400);
  }

  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binaryStr = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binaryStr += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  const base64 = btoa(binaryStr);

  const id = crypto.randomUUID();
  const db = c.env.DB;

  await db.prepare(
    'INSERT INTO meeting_minutes (id, title, description, file_name, file_data, file_size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, title, description, file.name, base64, file.size, user.sub).run();

  return c.json({ success: true, id }, 201);
});

// DELETE /api/minutes/:id
minutes.delete('/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  await db.prepare('DELETE FROM meeting_minutes WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

export default minutes;
