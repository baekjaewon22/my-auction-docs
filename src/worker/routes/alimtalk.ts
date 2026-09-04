import { Hono } from 'hono';
import type { AuthEnv } from '../types';
import { authMiddleware, requireRole } from '../middleware/auth';
import {
  sendAlimtalkByTemplate,
  isAlimtalkConfigured,
  ALIMTALK_TEMPLATES,
  refreshRecentAlimtalkDeliveryStatuses,
} from '../alimtalk';

const alimtalk = new Hono<AuthEnv>();
alimtalk.use('*', authMiddleware);

// ── 회원가입 인증코드 발송 (인증 불필요 — 별도 라우트에서 처리) ──
// auth.ts에서 직접 호출할 예정

// ── 수신자 관리 (관리자) ──

// GET /api/alimtalk/recipients — 카테고리별 수신자 목록
alimtalk.get('/recipients', requireRole('master', 'ceo', 'admin'), async (c) => {
  const db = c.env.DB;
  const category = c.req.query('category');

  let query = 'SELECT r.*, u.name as user_name, u.phone as user_phone, u.department FROM alimtalk_recipients r JOIN users u ON r.user_id = u.id';
  if (category) {
    query += ' WHERE r.category = ?';
    const result = await db.prepare(query + ' ORDER BY r.category, r.created_at').bind(category).all();
    return c.json({ recipients: result.results });
  }
  const result = await db.prepare(query + ' ORDER BY r.category, r.created_at').all();
  return c.json({ recipients: result.results });
});

// POST /api/alimtalk/recipients — 수신자 추가
alimtalk.post('/recipients', requireRole('master', 'ceo', 'admin'), async (c) => {
  const user = c.get('user');
  const { category, user_id } = await c.req.json<{ category: string; user_id: string }>();
  const db = c.env.DB;

  // 중복 체크
  const exists = await db.prepare(
    'SELECT id FROM alimtalk_recipients WHERE category = ? AND user_id = ?'
  ).bind(category, user_id).first();
  if (exists) return c.json({ error: '이미 등록된 수신자입니다.' }, 400);

  const id = crypto.randomUUID();
  await db.prepare(
    'INSERT INTO alimtalk_recipients (id, category, user_id, created_by) VALUES (?, ?, ?, ?)'
  ).bind(id, category, user_id, user.sub).run();

  return c.json({ success: true, id });
});

// PUT /api/alimtalk/recipients/:id — 수신자 활성/비활성
alimtalk.put('/recipients/:id', requireRole('master', 'ceo', 'admin'), async (c) => {
  const id = c.req.param('id');
  const { is_active } = await c.req.json<{ is_active: boolean }>();
  const db = c.env.DB;

  await db.prepare(
    "UPDATE alimtalk_recipients SET is_active = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(is_active ? 1 : 0, id).run();

  return c.json({ success: true });
});

// DELETE /api/alimtalk/recipients/:id — 수신자 삭제
alimtalk.delete('/recipients/:id', requireRole('master', 'ceo', 'admin'), async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM alimtalk_recipients WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

// ── 발송 이력 ──

// GET /api/alimtalk/logs — 발송 이력 조회
alimtalk.get('/logs', requireRole('master', 'ceo', 'cc_ref', 'admin'), async (c) => {
  const db = c.env.DB;
  const templateCode = c.req.query('template');
  const search = c.req.query('search');
  const limit = parseInt(c.req.query('limit') || '100');

  let query = `SELECT l.*, u.name as recipient_name
    FROM alimtalk_logs l
    LEFT JOIN users u ON l.recipient_user_id = u.id`;
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (templateCode) {
    conditions.push('l.template_code = ?');
    params.push(templateCode);
  }
  if (search) {
    conditions.push("(u.name LIKE ? OR l.recipient_phone LIKE ? OR l.content LIKE ?)");
    const s = '%' + search + '%';
    params.push(s, s, s);
  }
  if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY l.created_at DESC LIMIT ?';
  params.push(limit);

  const result = await db.prepare(query).bind(...params).all();
  return c.json({ logs: result.results });
});

// ── 설정 확인 ──

// GET /api/alimtalk/status — NCP 키 설정 상태 확인
alimtalk.get('/status', requireRole('master', 'ceo', 'admin'), async (c) => {
  const configured = isAlimtalkConfigured(c.env as unknown as Record<string, unknown>);
  const templates = Object.entries(ALIMTALK_TEMPLATES).map(([key, t]) => ({
    key,
    code: t.code,
    variables: t.variables,
  }));

  return c.json({
    configured,
    templates,
    categories: [
      { code: 'signup_verify', label: '회원가입 인증' },
      { code: 'signup_approved', label: '회원가입 승인' },
      { code: 'doc_submitted', label: '문서 제출 알림' },
      { code: 'doc_step_approved', label: '단계 승인 알림' },
      { code: 'doc_final_approved', label: '최종 승인 알림' },
      { code: 'doc_rejected', label: '문서 반려 알림' },
      { code: 'minutes_shared', label: '회의록 공유 알림' },
      { code: 'deposit_claim', label: '입금 매칭 알림' },
      { code: 'community_legal_support', label: '법률지원 질문 알림' },
      { code: 'community_eviction_quote', label: '명도견적 의뢰 알림' },
    ],
  });
});

// POST /api/alimtalk/refresh-status — 최근 알림톡 최종 전달 상태 조회
alimtalk.post('/refresh-status', requireRole('master', 'ceo', 'admin'), async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10) || 50, 200);
  const result = await refreshRecentAlimtalkDeliveryStatuses(
    c.env as unknown as Record<string, unknown>,
    c.env.DB,
    limit,
  );
  return c.json({ success: true, ...result });
});

// ── 테스트 발송 (관리자) ──

// POST /api/alimtalk/test — 테스트 발송
alimtalk.post('/test', requireRole('master', 'ceo'), async (c) => {
  const { template_key, phone, variables } = await c.req.json<{
    template_key: string;
    phone: string;
    variables: Record<string, string>;
  }>();

  const template = ALIMTALK_TEMPLATES[template_key as keyof typeof ALIMTALK_TEMPLATES];
  if (!template) return c.json({ error: '존재하지 않는 템플릿입니다.' }, 400);

  try {
    const result = await sendAlimtalkByTemplate(
      c.env as unknown as Record<string, unknown>,
      template_key as keyof typeof ALIMTALK_TEMPLATES,
      variables,
      [phone],
      { db: c.env.DB, relatedType: 'test', relatedId: crypto.randomUUID(), force: true },
    );

    return c.json({ success: true, result, configured: !!result });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// POST /api/alimtalk/resend-failed — 도착실패한 '승인대기' 알림톡 즉시 재발송
// 아직 미결(open+need_approve)인 알림 중 최근 도착실패/실패 로그가 있는 건만 notification_sent=0으로 리셋한 뒤
// 디스패처를 즉시 실행한다. 내용은 현재(최신) 템플릿으로 재생성되며, 이미 도착완료된 건은 대상에서 제외된다.
alimtalk.post('/resend-failed', requireRole('master', 'ceo', 'cc_ref', 'admin', 'accountant'), async (c) => {
  const db = c.env.DB;
  const env = c.env as unknown as { DB: D1Database } & Record<string, unknown>;

  // 1) 미결 상태로 남아있는 알림(이미 발송 시도됨) 조회
  const pending = await db.prepare(`
    SELECT a.id, a.document_id, COALESCE(u.phone, '') AS phone
    FROM alert_approval_pending a
    LEFT JOIN users u ON u.id = a.approver_id
    WHERE a.status = 'open' AND a.my_status = 'need_approve' AND a.notification_sent != 0
  `).all<{ id: string; document_id: string; phone: string }>();

  // 2) 최근 30일 도착실패/실패 로그
  const failed = await db.prepare(`
    SELECT recipient_phone, content
    FROM alimtalk_logs
    WHERE status IN ('delivery_failed', 'failed')
      AND created_at >= datetime('now', '-30 days')
  `).all<{ recipient_phone: string; content: string }>();
  const failedRows = failed.results || [];

  // 3) 수신자(phone) + 문서id(content 링크에 포함)로 실제 실패한 건만 매칭 → 리셋
  const toReset = (pending.results || []).filter((a) =>
    !!a.phone && !!a.document_id
    && failedRows.some((l) => l.recipient_phone === a.phone && String(l.content || '').includes(a.document_id)),
  );
  for (const row of toReset) {
    await db.prepare(
      "UPDATE alert_approval_pending SET notification_sent = 0, notification_error = NULL WHERE id = ?"
    ).bind(row.id).run();
  }

  // 4) 즉시 디스패치 (현재 템플릿으로 내용 재생성하여 발송; 이미 도착완료 건은 dedupe로 스킵)
  let dispatch = { picked: 0, sent: 0, failed: 0, skipped_no_phone: 0 };
  try {
    const { reconcileSubmittedDocs } = await import('../lib/approval-alerts-reconciler');
    await reconcileSubmittedDocs(env).catch(() => {});
    const { dispatchApprovalAlerts } = await import('../lib/approval-alerts-dispatcher');
    dispatch = await dispatchApprovalAlerts(env);
  } catch (err: any) {
    return c.json({ error: err?.message || '재발송 처리 중 오류가 발생했습니다.' }, 500);
  }

  return c.json({ success: true, reset: toReset.length, dispatch });
});

export default alimtalk;
