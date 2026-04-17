import { Hono } from 'hono';
import type { AuthEnv } from '../types';
import { authMiddleware } from '../middleware/auth';

const cooperation = new Hono<AuthEnv>();
cooperation.use('*', authMiddleware);

// 프리랜서 차단 미들웨어
cooperation.use('*', async (c, next) => {
  const user = c.get('user');
  if ((user as any).login_type === 'freelancer') return c.json({ error: '접근 권한이 없습니다.' }, 403);
  await next();
});

// POST /api/cooperation - 업무협조요청 생성
cooperation.post('/', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const { receiver_id, court, case_year, case_type, case_number, content } = await c.req.json<{
    receiver_id: string; court?: string; case_year?: string; case_type?: string; case_number?: string; content?: string;
  }>();

  if (!receiver_id) return c.json({ error: '수신자를 선택하세요.' }, 400);

  const id = crypto.randomUUID();
  // 1개월 후 만료
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000 + 9 * 60 * 60 * 1000);
  const expiresAt = expires.toISOString().slice(0, 19).replace('T', ' ');

  await db.prepare(`
    INSERT INTO cooperation_requests (id, sender_id, receiver_id, court, case_year, case_type, case_number, content, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, user.sub, receiver_id, court || '', case_year || '', case_type || '타경', case_number || '', content || '', expiresAt).run();

  return c.json({ success: true, id });
});

// GET /api/cooperation - 목록 (본인 발신/수신)
cooperation.get('/', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;
  const filter = c.req.query('filter') || 'all'; // all, sent, received

  // 만료 건 자동 삭제
  await db.prepare("DELETE FROM cooperation_photos WHERE request_id IN (SELECT id FROM cooperation_requests WHERE expires_at < datetime('now'))").run();
  await db.prepare("DELETE FROM cooperation_replies WHERE request_id IN (SELECT id FROM cooperation_requests WHERE expires_at < datetime('now'))").run();
  await db.prepare("DELETE FROM cooperation_requests WHERE expires_at < datetime('now')").run();

  let query = `
    SELECT cr.*,
      su.name as sender_name, su.branch as sender_branch, su.position_title as sender_position,
      ru.name as receiver_name, ru.branch as receiver_branch, ru.position_title as receiver_position,
      (SELECT COUNT(*) FROM cooperation_replies WHERE request_id = cr.id) as reply_count,
      (SELECT COUNT(*) FROM cooperation_photos WHERE request_id = cr.id) as photo_count
    FROM cooperation_requests cr
    LEFT JOIN users su ON su.id = cr.sender_id
    LEFT JOIN users ru ON ru.id = cr.receiver_id
    WHERE (cr.sender_id = ? OR cr.receiver_id = ?)
  `;
  const params: any[] = [user.sub, user.sub];

  if (filter === 'sent') { query += ' AND cr.sender_id = ?'; params.push(user.sub); }
  else if (filter === 'received') { query += ' AND cr.receiver_id = ?'; params.push(user.sub); }

  query += ' ORDER BY cr.created_at DESC';
  const result = await db.prepare(query).bind(...params).all();
  return c.json({ requests: result.results });
});

// GET /api/cooperation/dashboard - 대시보드 알림 (수신 pending 건)
cooperation.get('/dashboard', async (c) => {
  const user = c.get('user');
  const db = c.env.DB;

  const result = await db.prepare(`
    SELECT cr.id, cr.court, cr.case_year, cr.case_type, cr.case_number, cr.content, cr.created_at,
      su.name as sender_name, su.branch as sender_branch, su.position_title as sender_position
    FROM cooperation_requests cr
    LEFT JOIN users su ON su.id = cr.sender_id
    WHERE cr.receiver_id = ? AND cr.status = 'pending'
    ORDER BY cr.created_at DESC
  `).bind(user.sub).all();

  return c.json({ alerts: result.results });
});

// GET /api/cooperation/:id - 상세 (답변 + 사진)
cooperation.get('/:id', async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const db = c.env.DB;

  const request = await db.prepare(`
    SELECT cr.*,
      su.name as sender_name, su.branch as sender_branch, su.position_title as sender_position,
      ru.name as receiver_name, ru.branch as receiver_branch, ru.position_title as receiver_position
    FROM cooperation_requests cr
    LEFT JOIN users su ON su.id = cr.sender_id
    LEFT JOIN users ru ON ru.id = cr.receiver_id
    WHERE cr.id = ?
  `).bind(id).first();
  if (!request) return c.json({ error: '요청을 찾을 수 없습니다.' }, 404);

  // 본인 관련 건만
  if ((request as any).sender_id !== user.sub && (request as any).receiver_id !== user.sub) {
    return c.json({ error: '접근 권한이 없습니다.' }, 403);
  }

  const replies = await db.prepare(`
    SELECT r.*, u.name as author_name, u.position_title as author_position
    FROM cooperation_replies r
    LEFT JOIN users u ON u.id = r.author_id
    WHERE r.request_id = ? ORDER BY r.created_at ASC
  `).bind(id).all();

  // 사진: file_data 제외 (목록에서는 메타만)
  const photos = await db.prepare(`
    SELECT id, reply_id, request_id, file_name, file_size, created_at
    FROM cooperation_photos WHERE request_id = ? ORDER BY created_at ASC
  `).bind(id).all();

  return c.json({ request, replies: replies.results, photos: photos.results });
});

// POST /api/cooperation/:id/accept - 수락
cooperation.post('/:id/accept', async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const db = c.env.DB;

  const req = await db.prepare('SELECT * FROM cooperation_requests WHERE id = ?').bind(id).first<any>();
  if (!req) return c.json({ error: '요청을 찾을 수 없습니다.' }, 404);
  if (req.receiver_id !== user.sub) return c.json({ error: '수신자만 수락할 수 있습니다.' }, 403);

  await db.prepare("UPDATE cooperation_requests SET status = 'accepted', accepted_at = datetime('now') WHERE id = ?").bind(id).run();
  return c.json({ success: true });
});

// POST /api/cooperation/:id/complete - 완료 처리
cooperation.post('/:id/complete', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  await db.prepare("UPDATE cooperation_requests SET status = 'completed', completed_at = datetime('now') WHERE id = ?").bind(id).run();
  return c.json({ success: true });
});

// POST /api/cooperation/:id/reply - 답변 (텍스트 + 사진)
cooperation.post('/:id/reply', async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const db = c.env.DB;
  const { content, photos } = await c.req.json<{
    content?: string;
    photos?: { file_name: string; file_data: string; file_size: number }[];
  }>();

  if (!content?.trim() && (!photos || photos.length === 0)) {
    return c.json({ error: '내용 또는 사진을 입력하세요.' }, 400);
  }

  const replyId = crypto.randomUUID();
  await db.prepare(
    'INSERT INTO cooperation_replies (id, request_id, author_id, content) VALUES (?, ?, ?, ?)'
  ).bind(replyId, id, user.sub, content?.trim() || '').run();

  // 사진 저장
  if (photos && photos.length > 0) {
    for (const photo of photos) {
      if (photo.file_data.length > 2 * 1024 * 1024) continue; // 압축 후 2MB 제한
      const photoId = crypto.randomUUID();
      await db.prepare(
        'INSERT INTO cooperation_photos (id, reply_id, request_id, file_name, file_data, file_size) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(photoId, replyId, id, photo.file_name, photo.file_data, photo.file_size).run();
    }
  }

  return c.json({ success: true, reply_id: replyId });
});

// GET /api/cooperation/photos/:photoId - 사진 다운로드
cooperation.get('/photos/:photoId', async (c) => {
  const photoId = c.req.param('photoId');
  const db = c.env.DB;

  const photo = await db.prepare('SELECT * FROM cooperation_photos WHERE id = ?').bind(photoId).first<any>();
  if (!photo) return c.json({ error: '사진을 찾을 수 없습니다.' }, 404);

  return c.json({ photo: { id: photo.id, file_name: photo.file_name, file_data: photo.file_data, file_size: photo.file_size } });
});

// DELETE /api/cooperation/:id - 삭제
cooperation.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const db = c.env.DB;

  const req = await db.prepare('SELECT * FROM cooperation_requests WHERE id = ?').bind(id).first<any>();
  if (!req) return c.json({ error: '요청을 찾을 수 없습니다.' }, 404);
  if (req.sender_id !== user.sub && user.role !== 'master') return c.json({ error: '발신자만 삭제할 수 있습니다.' }, 403);

  await db.prepare('DELETE FROM cooperation_photos WHERE request_id = ?').bind(id).run();
  await db.prepare('DELETE FROM cooperation_replies WHERE request_id = ?').bind(id).run();
  await db.prepare('DELETE FROM cooperation_requests WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

export default cooperation;
