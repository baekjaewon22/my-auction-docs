import { Hono } from 'hono';
import type { AuthEnv, Document, Signature } from '../types';
import { authMiddleware } from '../middleware/auth';
import { canReadDocument } from '../lib/document-access';
import { canProxyApproval, evaluateSignaturePolicy, type PendingSignatureStep } from '../../shared/signature-policy';

const signatures = new Hono<AuthEnv>();
signatures.use('*', authMiddleware);

// POST /api/signatures - sign a document
signatures.post('/', async (c) => {
  const user = c.get('user');
  const { document_id, signature_data, signature_type, step_id } = await c.req.json<{
    document_id: string;
    signature_data: string;
    signature_type: 'author' | 'approver';
    step_id?: string;
  }>();

  if (!document_id || !signature_data || !['author', 'approver'].includes(signature_type)) {
    return c.json({ error: '문서 ID, 서명 데이터, 서명 종류는 필수입니다.' }, 400);
  }
  const isStamp = signature_data === '/LNCstemp.png';
  const isPngDataUrl = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(signature_data);
  if ((!isStamp && !isPngDataUrl) || signature_data.length > 1_500_000) {
    return c.json({ error: '유효한 PNG 서명 데이터가 아닙니다.' }, 400);
  }

  const db = c.env.DB;

  const doc = await db.prepare('SELECT * FROM documents WHERE id = ?').bind(document_id).first<Document>();
  if (!doc) return c.json({ error: '문서를 찾을 수 없습니다.' }, 404);

  if (!(await canReadDocument(db, user, doc))) return c.json({ error: '권한이 없습니다.' }, 403);

  let pendingSteps: PendingSignatureStep[] = [];
  let totalStepCount = 0;
  if (signature_type === 'approver') {
    const pendingResult = await db.prepare(
      `SELECT s.id, s.approver_id, s.step_order, u.role as approver_role
       FROM approval_steps s
       LEFT JOIN users u ON u.id = s.approver_id
       WHERE s.document_id = ? AND s.status = 'pending'
       ORDER BY s.step_order ASC`
    ).bind(document_id).all<PendingSignatureStep>();
    pendingSteps = pendingResult.results || [];
    if (pendingSteps.length === 0) {
      const stepCount = await db.prepare(
        'SELECT COUNT(*) as cnt FROM approval_steps WHERE document_id = ?'
      ).bind(document_id).first<{ cnt: number }>();
      totalStepCount = stepCount?.cnt || 0;
    }
  }

  const policy = evaluateSignaturePolicy({
    userId: user.sub,
    userRole: user.role,
    documentAuthorId: doc.author_id,
    documentStatus: doc.status,
    signatureType: signature_type,
    isCeoStamp: isStamp,
    stepId: step_id,
    pendingSteps,
    totalStepCount,
  });
  if (!policy.allowed) return c.json({ error: policy.error }, policy.status);

  // 작성자/일반 결재자는 중복 서명을 막고, 권한자의 순차 대리 결재만 여러 번 허용한다.
  const existingCount = await db.prepare(
    'SELECT COUNT(*) as cnt FROM signatures WHERE document_id = ? AND user_id = ?'
  ).bind(document_id, user.sub).first<{ cnt: number }>();

  const maxSigns = signature_type === 'approver' && canProxyApproval(user.role) ? 10 : 1;
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
  const user = c.get('user');
  const db = c.env.DB;
  const doc = await db.prepare('SELECT * FROM documents WHERE id = ?').bind(documentId).first<Document>();
  if (!doc) return c.json({ error: '문서를 찾을 수 없습니다.' }, 404);
  if (!(await canReadDocument(db, user, doc))) return c.json({ error: '권한이 없습니다.' }, 403);

  const result = await db.prepare(
    "SELECT s.*, COALESCE(NULLIF(TRIM(u.name), ''), '탈퇴 사용자') as user_name FROM signatures s LEFT JOIN users u ON s.user_id = u.id WHERE s.document_id = ? ORDER BY s.signed_at ASC"
  ).bind(documentId).all<Signature & { user_name: string }>();

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
