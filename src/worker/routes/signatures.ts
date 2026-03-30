import { Hono } from 'hono';
import type { AuthEnv, Document, Signature } from '../types';
import { authMiddleware } from '../middleware/auth';

const signatures = new Hono<AuthEnv>();
signatures.use('*', authMiddleware);

// POST /api/signatures - sign a document
signatures.post('/', async (c) => {
  const user = c.get('user');
  const { document_id, signature_data } = await c.req.json<{
    document_id: string;
    signature_data: string;
  }>();

  if (!document_id || !signature_data) {
    return c.json({ error: '문서 ID와 서명 데이터는 필수입니다.' }, 400);
  }

  const db = c.env.DB;

  // Verify document exists and is submitted or approved
  const doc = await db.prepare('SELECT * FROM documents WHERE id = ?').bind(document_id).first<Document>();
  if (!doc) return c.json({ error: '문서를 찾을 수 없습니다.' }, 404);

  if (doc.status === 'rejected') {
    return c.json({ error: '반려된 문서는 서명할 수 없습니다. 내용 수정 후 다시 서명해주세요.' }, 400);
  }

  // Check if already signed by this user
  const existing = await db.prepare(
    'SELECT id FROM signatures WHERE document_id = ? AND user_id = ?'
  ).bind(document_id, user.sub).first();

  if (existing) {
    return c.json({ error: '이미 서명한 문서입니다.' }, 409);
  }

  const id = crypto.randomUUID();
  const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';
  const userAgent = c.req.header('User-Agent') || 'unknown';

  await db.prepare(
    'INSERT INTO signatures (id, document_id, user_id, signature_data, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, document_id, user.sub, signature_data, ip, userAgent).run();

  // Log the signature
  await db.prepare(
    'INSERT INTO document_logs (id, document_id, user_id, action, details) VALUES (?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), document_id, user.sub, 'signed', `전자서명이 완료되었습니다. IP: ${ip}`).run();

  return c.json({
    signature: { id, document_id, user_id: user.sub, signed_at: new Date().toISOString() }
  }, 201);
});

// GET /api/signatures/document/:documentId
signatures.get('/document/:documentId', async (c) => {
  const documentId = c.req.param('documentId');
  const db = c.env.DB;

  const result = await db.prepare(
    'SELECT s.*, u.name as user_name, u.email as user_email FROM signatures s LEFT JOIN users u ON s.user_id = u.id WHERE s.document_id = ? ORDER BY s.signed_at DESC'
  ).bind(documentId).all<Signature & { user_name: string; user_email: string }>();

  return c.json({ signatures: result.results });
});

export default signatures;
