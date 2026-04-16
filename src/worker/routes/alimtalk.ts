import { Hono } from 'hono';
import type { AuthEnv } from '../types';
import { authMiddleware, requireRole } from '../middleware/auth';
import {
  sendAlimtalkByTemplate,
  isAlimtalkConfigured,
  ALIMTALK_TEMPLATES,
  normalizePhone,
  replaceTemplateVariables,
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
    ],
  });
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
    );

    // 로그 저장
    const db = c.env.DB;
    await db.prepare(
      'INSERT INTO alimtalk_logs (id, template_code, recipient_phone, content, request_id, status, related_type) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      crypto.randomUUID(),
      template.code,
      normalizePhone(phone),
      replaceTemplateVariables(template.content, variables),
      result?.requestId || '',
      result ? 'sent' : 'skipped',
      'test',
    ).run();

    return c.json({ success: true, result, configured: !!result });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

export default alimtalk;
