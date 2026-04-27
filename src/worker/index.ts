import { Hono } from 'hono';
import { cors } from 'hono/cors';
import auth from './routes/auth';
import teams from './routes/teams';
import templates from './routes/templates';
import documents from './routes/documents';
import signatures from './routes/signatures';
import users from './routes/users';
import journal from './routes/journal';
import leave from './routes/leave';
import departmentsRoute from './routes/departments';
import branchesRoute from './routes/branches';
import org from './routes/org';
import alimtalkRoute from './routes/alimtalk';
import minutes from './routes/minutes';
import commissions from './routes/commissions';
import accounting from './routes/accounting';
import salesRoute from './routes/sales';
import payrollRoute from './routes/payroll';
import cardRoute from './routes/card';
import analyticsRoute from './routes/analytics';
import comprehensiveRoute from './routes/analytics-comprehensive';
import adminNotesRoute from './routes/admin-notes';
import cooperationRoute from './routes/cooperation';
import roomsRoute from './routes/rooms';
import driveRoute, { OAUTH_STATE_SECRET } from './routes/drive';
import { jwtVerify } from 'jose';
import { verifyPrintToken, runBackupBatch } from './drive-backup-runner';
import { encryptToken, exchangeCodeForTokens, fetchUserEmail, resolveRedirectUri } from './drive-oauth';
import { ALIMTALK_TEMPLATES, sendAlimtalkByTemplate } from './alimtalk';

const app = new Hono<{ Bindings: Env }>();

// Google Identity Services 팝업이 window.closed 등을 체크할 수 있도록 COOP 완화
app.use('*', async (c, next) => {
  await next();
  c.header('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
});

app.use('/api/*', cors());

// Global error handler - always return JSON
app.onError((err, c) => {
  console.error('API Error:', err.message, err.stack);
  return c.json({ error: err.message || '서버 오류가 발생했습니다.' }, 500);
});

// API Routes
app.route('/api/auth', auth);
app.route('/api/teams', teams);
app.route('/api/templates', templates);
app.route('/api/documents', documents);
app.route('/api/signatures', signatures);
app.route('/api/users', users);
app.route('/api/journal', journal);
app.route('/api/leave', leave);
app.route('/api/departments', departmentsRoute);
app.route('/api/branches', branchesRoute);
app.route('/api/org', org);
app.route('/api/alimtalk', alimtalkRoute);
app.route('/api/minutes', minutes);
app.route('/api/commissions', commissions);
app.route('/api/accounting', accounting);
app.route('/api/sales', salesRoute);
app.route('/api/payroll', payrollRoute);
app.route('/api/card', cardRoute);
app.route('/api/analytics', analyticsRoute);
app.route('/api/analytics/comprehensive', comprehensiveRoute);
app.route('/api/admin-notes', adminNotesRoute);
app.route('/api/cooperation', cooperationRoute);
app.route('/api/rooms', roomsRoute);
app.route('/api/drive', driveRoute);

// OAuth 콜백 — Google이 /oauth/drive/callback 으로 redirect (최상위 경로)
app.get('/oauth/drive/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const error = c.req.query('error');
  const db = c.env.DB;
  const clientSecret = (c.env as any).GOOGLE_CLIENT_SECRET as string | undefined;

  const renderPage = (title: string, body: string, color = '#d93025') => c.html(`
    <!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${title}</title></head>
    <body style="font-family: sans-serif; padding: 40px; text-align: center;">
      <h2 style="color:${color};">${title}</h2>
      <div style="max-width:600px; margin:0 auto; color:#444; line-height:1.6;">${body}</div>
      <p style="margin-top:24px;"><a href="/archive?drive=1" style="color:#1a73e8;">문서보관함으로 돌아가기</a></p>
    </body></html>
  `);

  if (error) return renderPage('연결 취소됨', `사유: <code>${error}</code>`);
  if (!code) return renderPage('연결 실패', '<code>code</code> 파라미터가 없습니다.', '#d93025');
  if (!clientSecret) return renderPage('서버 설정 오류', 'GOOGLE_CLIENT_SECRET이 Worker에 설정되어 있지 않습니다.', '#d93025');

  // state JWT 서명 검증 (CSRF) — 쿠키 대신 서명 토큰 사용
  if (!state) return renderPage('state 누락', 'OAuth state가 전달되지 않았습니다. 다시 연결을 시도해 주세요.');
  try {
    await jwtVerify(state, OAUTH_STATE_SECRET);
  } catch (err: any) {
    return renderPage('state 검증 실패', `
      OAuth state 서명 검증 실패. 토큰이 만료됐거나 변조됐습니다.<br/>
      <small>${(err?.message || err).toString().slice(0, 200)}</small><br/>
      다시 연결을 시도해 주세요.
    `);
  }

  try {
    const redirectUri = resolveRedirectUri(c.req.raw);
    const tok = await exchangeCodeForTokens(code, clientSecret, redirectUri);
    if (!tok.refresh_token) {
      return renderPage('refresh_token 미발급', `
        Google이 refresh_token을 발급하지 않았습니다. <a href="https://myaccount.google.com/permissions" target="_blank">Google 계정 권한</a>에서 기존 앱 권한을 삭제 후 다시 시도해 주세요.
      `);
    }
    const email = await fetchUserEmail(tok.access_token) || '';
    const { ct, iv } = await encryptToken(tok.refresh_token, clientSecret);

    await db.prepare(`
      UPDATE drive_settings SET
        refresh_token_encrypted = ?, token_iv = ?,
        connected_email = ?, connected_at = datetime('now'),
        auto_enabled = 1, updated_at = datetime('now')
      WHERE id = 'default'
    `).bind(ct, iv, email).run();

    return c.html(`
      <!doctype html><html lang="ko"><head><meta charset="utf-8"><title>연결 완료</title>
      <meta http-equiv="refresh" content="2;url=/archive?drive=1"></head>
      <body style="font-family: sans-serif; padding: 40px; text-align: center;">
        <h2 style="color:#188038;">✓ Google Drive 연결 완료</h2>
        <p>연결 계정: <strong>${email}</strong></p>
        <p>이제 매주 토요일 03:00 KST에 자동으로 문서가 백업됩니다.</p>
        <p><a href="/archive?drive=1" style="color:#1a73e8;">지금 문서보관함으로 이동</a></p>
      </body></html>
    `);
  } catch (err: any) {
    return renderPage('연결 실패', `<pre style="text-align:left;white-space:pre-wrap;">${(err.message || err).toString().slice(0, 800)}</pre>`);
  }
});

// 인쇄 전용 라우트 — Browser Rendering이 PDF 생성 시 navigate
// /print/:docId?token=<printJwt> — 정적 HTML 반환 (SPA가 /print 경로를 렌더링)
// 실제로는 SPA 라우팅으로 처리되므로 여기선 별도 핸들러 불필요
// 토큰 검증은 SPA 측 api.print.render 엔드포인트에서 수행

// /api/print/verify — Browser Rendering이 토큰 유효성 체크용으로 호출 가능
app.get('/api/print/verify', async (c) => {
  const token = c.req.query('token') || '';
  const result = await verifyPrintToken(token);
  if (!result) return c.json({ valid: false }, 401);
  return c.json({ valid: true, docId: result.docId });
});

// /api/print/data/:docId — print 라우트에서 공개적으로 호출 (printToken 검증)
app.get('/api/print/data/:docId', async (c) => {
  const docId = c.req.param('docId');
  const token = c.req.query('token') || '';
  const verified = await verifyPrintToken(token);
  if (!verified || verified.docId !== docId) {
    return c.json({ error: 'invalid token' }, 401);
  }
  const db = c.env.DB;
  const doc = await db.prepare(`
    SELECT d.*, u.name as author_name, u.branch as author_branch, u.department as author_department,
      u.position_title as author_position
    FROM documents d LEFT JOIN users u ON u.id = d.author_id WHERE d.id = ?
  `).bind(docId).first<any>();
  if (!doc) return c.json({ error: 'not found' }, 404);
  const sigs = await db.prepare(`
    SELECT s.*, u.name as user_name FROM signatures s
    LEFT JOIN users u ON u.id = s.user_id WHERE s.document_id = ? ORDER BY s.signed_at ASC
  `).bind(docId).all<any>();
  const steps = await db.prepare(`
    SELECT s.*, u.name as approver_name, u.position_title as approver_title, u.role as approver_role
    FROM approval_steps s LEFT JOIN users u ON u.id = s.approver_id
    WHERE s.document_id = ? ORDER BY s.step_order
  `).bind(docId).all<any>();
  return c.json({
    document: doc,
    signatures: sigs.results || [],
    approval_steps: steps.results || [],
  });
});

// Health check
app.get('/api/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// 임시: 모든 알림톡 템플릿 테스트 발송 (인증 없이, 토큰 보호)
app.post('/api/_test-alimtalk-all', async (c) => {
  const token = c.req.query('token');
  if (token !== 'alimtalk-test-2026') return c.json({ error: '권한 없음' }, 403);
  const targetPhone = c.req.query('phone') || '01029440141';

  const LINK = 'https://my-docs.kr/dashboard';
  const sampleVars: Record<string, Record<string, string>> = {
    SIGNUP_VERIFY: { verify_code: '123456' },
    DOC_SUBMITTED: { author_name: '홍길동', doc_title: '외근 보고서', department: '경매사업부1팀', submit_date: '2026-04-17', link: LINK },
    DOC_STEP_APPROVED: { approver_name: '팀장', doc_title: '외근 보고서', author_name: '홍길동', department: '경매사업부1팀', link: LINK },
    DOC_FINAL_APPROVED: { doc_title: '외근 보고서', approver_name: '대표이사', approve_date: '2026-04-17' },
    DOC_REJECTED: { doc_title: '외근 보고서', rejector_name: '팀장', reject_reason: '재제출 요망', link: LINK },
    SIGNUP_APPROVED: { user_name: '홍길동', branch: '의정부', department: '경매사업부1팀', position_title: '사원' },
    MINUTES_SHARED: { author_name: '홍길동', title: '월간 정기 회의록', date: '2026-04-17', link: LINK },
    DEPOSIT_CLAIM: { claimer_name: '홍길동', depositor: '김철수', amount: '1,100,000', deposit_date: '2026-04-17', branch: '의정부', link: LINK },
    LEAVE_REQUEST: { user_name: '홍길동', leave_type: '연차', start_date: '2026-04-20', end_date: '2026-04-20', branch: '의정부', link: LINK },
    LEAVE_APPROVED: { user_name: '홍길동', status: '승인', leave_type: '연차', start_date: '2026-04-20', end_date: '2026-04-20', approver_name: '팀장', link: LINK },
    REFUND_NOTICE: { consultant_name: '홍길동', client_name: '김철수', amount: '1,100,000', branch: '의정부', link: LINK },
    PW_RESET: { verify_code: '654321' },
    SALARY: { user_name: '홍길동', period: '2026년 3월', final_pay: '3,500,000', pay_type: '급여제', link: LINK },
    ACCOUNTING_CONFIRMED: { consultant_name: '홍길동', depositor: '김철수', amount: '1,100,000', confirm_date: '2026-04-17', link: LINK },
  };

  const results: { key: string; code: string; ok: boolean; error?: string }[] = [];
  for (const key of Object.keys(ALIMTALK_TEMPLATES) as (keyof typeof ALIMTALK_TEMPLATES)[]) {
    try {
      const r = await sendAlimtalkByTemplate(
        c.env as unknown as Record<string, unknown>,
        key,
        sampleVars[key] || {},
        [targetPhone],
      );
      results.push({ key, code: ALIMTALK_TEMPLATES[key].code, ok: !!r });
    } catch (err: any) {
      results.push({ key, code: ALIMTALK_TEMPLATES[key].code, ok: false, error: err.message });
    }
  }
  return c.json({ phone: targetPhone, total: results.length, sent: results.filter(r => r.ok).length, results });
});

// Cron 분기:
//   */30 * * * *  → Drive 백업 (5건씩, browser 재사용)
//   0 15 * * *    → 매일 자정 KST: 종합분석 통계 일일 갱신
//   30 15 1 * *   → 매월 1일 00:30 KST: 종합분석 통계 월간 확정 + sales_evaluations 자동 생성
async function scheduled(event: ScheduledEvent, env: any, ctx: ExecutionContext) {
  const cron = event.cron;
  if (cron === '*/30 * * * *') {
    ctx.waitUntil(runBackupBatch(env, { triggered_by: 'cron', limit: 5 }).then(
      (r) => console.log('[cron drive] done', r),
      (err) => console.error('[cron drive] error', err),
    ));
  } else if (cron === '0 15 * * *') {
    ctx.waitUntil(import('./analytics-cron').then(({ runDailyAggregation }) =>
      runDailyAggregation(env).then(
        (r) => console.log('[cron analytics-daily] done', r),
        (err) => console.error('[cron analytics-daily] error', err),
      ),
    ));
  } else if (cron === '30 15 1 * *') {
    ctx.waitUntil(import('./analytics-cron').then(({ runMonthlyAggregation }) =>
      runMonthlyAggregation(env).then(
        (r) => console.log('[cron analytics-monthly] done', r),
        (err) => console.error('[cron analytics-monthly] error', err),
      ),
    ));
  } else {
    console.warn('[scheduled] unknown cron pattern', cron);
  }
}

export default {
  fetch: app.fetch,
  scheduled,
};
