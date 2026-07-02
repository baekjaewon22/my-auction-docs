import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import type { AuthEnv } from '../types';

const report = new Hono<AuthEnv>();

report.use('*', authMiddleware);

async function ensureReportColumns(db: D1Database) {
  const columns = await db.prepare('PRAGMA table_info(users)').all<{ name: string }>();
  const names = new Set((columns.results || []).map((col) => col.name));
  if (!names.has('myauction_id')) {
    await db.prepare("ALTER TABLE users ADD COLUMN myauction_id TEXT NOT NULL DEFAULT ''").run();
  }
  if (!names.has('myauction_pw')) {
    await db.prepare("ALTER TABLE users ADD COLUMN myauction_pw TEXT NOT NULL DEFAULT ''").run();
  }
  if (!names.has('report_permission')) {
    await db.prepare("ALTER TABLE users ADD COLUMN report_permission TEXT NOT NULL DEFAULT 'basic'").run();
  }
}

function automationBase(env: Env): string {
  return String((env as any).AUCTION_AUTOMATION_BASE_URL || 'http://127.0.0.1:8001/api').replace(/\/$/, '');
}

async function currentReportUser(c: any) {
  const authUser = c.get('user');
  await ensureReportColumns(c.env.DB);
  const user = await c.env.DB.prepare(`
    SELECT id, name, phone, role, position_title, myauction_id, myauction_pw,
      COALESCE(report_permission, 'basic') AS report_permission
    FROM users
    WHERE id = ?
  `).bind(authUser.sub).first();
  if (!user) throw new Error('사용자 정보를 찾을 수 없습니다.');
  return { authUser, user };
}

function requireMyAuction(user: any) {
  if (!String(user.myauction_id || '').trim() || !String(user.myauction_pw || '').trim()) {
    return '내 정보 수정에서 마이옥션 아이디와 비밀번호를 먼저 저장해 주세요.';
  }
  return '';
}

function withSavedProfile(body: any, authUser: any, user: any) {
  const role = String(authUser.role || user.role || 'user');
  const permission = role === 'master' ? 'special' : String(user.report_permission || 'basic');
  return {
    ...body,
    myauction_id: String(user.myauction_id || '').trim(),
    myauction_pw: String(user.myauction_pw || ''),
    author_name: String(user.name || '').trim(),
    author_title: String(user.position_title || '').trim(),
    author_phone: String(user.phone || '').trim(),
    requester_role: role,
    requester_permission: permission,
  };
}

function canUseRightsCertificate(authUser: any, user: any) {
  return String(authUser.role || user.role || '').toLowerCase() === 'master'
    || String(user.report_permission || '').toLowerCase() === 'special';
}

function requireMaster(c: any) {
  const authUser = c.get('user');
  if (String(authUser?.role || '').toLowerCase() !== 'master') {
    return c.json({ error: '자료 생성 기능은 마스터 권한만 사용할 수 있습니다.' }, 403);
  }
  return null;
}

function automationUnavailable(c: any, err: unknown) {
  const base = automationBase(c.env);
  console.error('[report automation proxy failed]', base, err);
  return c.json({
    error: `Python 자동화 서비스에 연결할 수 없습니다. 자동화 서비스를 실행한 뒤 다시 시도해 주세요. (${base})`,
  }, 502);
}

async function proxyJson(c: any, path: string, init?: RequestInit) {
  let res: Response;
  try {
    res = await fetch(`${automationBase(c.env)}${path}`, init);
  } catch (err) {
    return automationUnavailable(c, err);
  }
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: {
      'Content-Type': res.headers.get('Content-Type') || 'application/json; charset=utf-8',
    },
  });
}

async function proxyFile(c: any, path: string) {
  let res: Response;
  try {
    res = await fetch(`${automationBase(c.env)}${path}`);
  } catch (err) {
    return automationUnavailable(c, err);
  }
  const headers = new Headers();
  const contentType = res.headers.get('Content-Type');
  const disposition = res.headers.get('Content-Disposition');
  if (contentType) headers.set('Content-Type', contentType);
  if (disposition) headers.set('Content-Disposition', disposition);
  return new Response(res.body, { status: res.status, headers });
}

report.post('/start', async (c) => {
  const masterError = requireMaster(c);
  if (masterError) return masterError;

  const body = await c.req.json<any>();
  const { authUser, user } = await currentReportUser(c);
  const credentialError = requireMyAuction(user);
  if (credentialError) return c.json({ error: credentialError }, 400);

  if (body.output_type === 'rights_certificate' && !canUseRightsCertificate(authUser, user)) {
    return c.json({ error: '권리분석 보증서는 master 또는 special 권한만 생성할 수 있습니다.' }, 403);
  }

  const payload = withSavedProfile(body, authUser, user);
  return proxyJson(c, '/report/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
});

report.post('/start-batch', async (c) => {
  const masterError = requireMaster(c);
  if (masterError) return masterError;

  const body = await c.req.json<any>();
  const { authUser, user } = await currentReportUser(c);
  const credentialError = requireMyAuction(user);
  if (credentialError) return c.json({ error: credentialError }, 400);
  if (!canUseRightsCertificate(authUser, user)) {
    return c.json({ error: '권리분석 보증서는 master 또는 special 권한만 생성할 수 있습니다.' }, 403);
  }

  const payload = withSavedProfile(body, authUser, user);
  return proxyJson(c, '/report/start-batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
});

report.get('/progress/:taskId', (c) => {
  const masterError = requireMaster(c);
  if (masterError) return masterError;
  return proxyJson(c, `/report/progress/${c.req.param('taskId')}`);
});

report.get('/download/:taskId', (c) => {
  const masterError = requireMaster(c);
  if (masterError) return masterError;

  const query = c.req.url.split('?')[1];
  return proxyFile(c, `/report/download/${c.req.param('taskId')}${query ? `?${query}` : ''}`);
});

report.get('/download-history', (c) => {
  const masterError = requireMaster(c);
  if (masterError) return masterError;
  return proxyJson(c, '/report/download-history');
});

report.get('/download-history/:historyId', (c) => {
  const masterError = requireMaster(c);
  if (masterError) return masterError;

  const query = c.req.url.split('?')[1];
  return proxyFile(c, `/report/download-history/${c.req.param('historyId')}${query ? `?${query}` : ''}`);
});

export default report;
