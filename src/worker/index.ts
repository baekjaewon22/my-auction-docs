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
import adminNotesRoute from './routes/admin-notes';
import cooperationRoute from './routes/cooperation';
import roomsRoute from './routes/rooms';
import driveRoute from './routes/drive';
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
app.route('/api/admin-notes', adminNotesRoute);
app.route('/api/cooperation', cooperationRoute);
app.route('/api/rooms', roomsRoute);
app.route('/api/drive', driveRoute);

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

export default app;
