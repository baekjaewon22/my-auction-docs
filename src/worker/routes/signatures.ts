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

  // Check if already signed by this user (권한자는 대리 승인용 2회 서명 허용)
  const existingCount = await db.prepare(
    'SELECT COUNT(*) as cnt FROM signatures WHERE document_id = ? AND user_id = ?'
  ).bind(document_id, user.sub).first<{ cnt: number }>();

  const isSuperApprover = ['master', 'ceo', 'cc_ref', 'admin', 'accountant'].includes(user.role);
  const maxSigns = isSuperApprover ? 10 : 1;
  if (existingCount && existingCount.cnt >= maxSigns) {
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
    'SELECT s.*, u.name as user_name, u.email as user_email FROM signatures s LEFT JOIN users u ON s.user_id = u.id WHERE s.document_id = ? ORDER BY s.signed_at ASC'
  ).bind(documentId).all<Signature & { user_name: string; user_email: string }>();

  return c.json({ signatures: result.results });
});

// POST /api/signatures/backfill - 승인 완료했지만 서명 없는 건에 서명 강제 삽입 (master only)
signatures.post('/backfill', async (c) => {
  const user = c.get('user');
  if (user.role !== 'master') return c.json({ error: '마스터만 가능합니다.' }, 403);

  const db = c.env.DB;

  // 승인된 step 중 서명이 없는 건 찾기
  const missing = await db.prepare(
    `SELECT DISTINCT s.approver_id, s.document_id
     FROM approval_steps s
     WHERE s.status = 'approved'
       AND NOT EXISTS (
         SELECT 1 FROM signatures sig
         WHERE sig.document_id = s.document_id AND sig.user_id = s.approver_id
       )`
  ).all<{ approver_id: string; document_id: string }>();

  let count = 0;
  for (const row of missing.results) {
    // 해당 사용자의 저장된 서명 가져오기
    const userRow = await db.prepare(
      'SELECT saved_signature FROM users WHERE id = ?'
    ).bind(row.approver_id).first<{ saved_signature: string }>();

    if (!userRow || !userRow.saved_signature) continue;

    const id = crypto.randomUUID();
    await db.prepare(
      "INSERT INTO signatures (id, document_id, user_id, signature_data, ip_address, user_agent) VALUES (?, ?, ?, ?, 'backfill', 'backfill')"
    ).bind(id, row.document_id, row.approver_id, userRow.saved_signature).run();
    count++;
  }

  return c.json({ success: true, backfilled: count, total_missing: missing.results.length });
});

export default signatures;
