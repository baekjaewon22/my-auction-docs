import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import type { AuthEnv } from '../types';
import { canUseBusinessAutomation } from '../../shared/automation-access';

const report = new Hono<AuthEnv>();
const AGENT_INSTALLER_KEY = 'downloads/MyAuctionAutomationAgentSetup.exe';
const AUTOMATION_AGENT_VERSION = '2026.07.16.1';

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

async function ensureAutomationDiagnosticTable(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS automation_generation_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      output_type TEXT NOT NULL DEFAULT 'auction_report',
      file_name TEXT NOT NULL DEFAULT '',
      success INTEGER NOT NULL DEFAULT 0,
      message TEXT NOT NULL DEFAULT '',
      agent_version TEXT NOT NULL DEFAULT '',
      diagnostics_json TEXT NOT NULL DEFAULT '[]',
      issue_count INTEGER NOT NULL DEFAULT 0,
      review_status TEXT NOT NULL DEFAULT 'open',
      review_note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, task_id)
    )
  `).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_automation_logs_user_created ON automation_generation_logs(user_id, created_at DESC)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_automation_logs_review_created ON automation_generation_logs(review_status, created_at DESC)').run();
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

function requireBusinessAutomationUser(c: any) {
  const authUser = c.get('user');
  if (!canUseBusinessAutomation({ id: authUser?.sub, role: authUser?.role })) {
    return c.json({ error: '업무 자동화 기능을 사용할 권한이 없습니다.' }, 403);
  }
  return null;
}

report.post('/diagnostics', async (c) => {
  const authUser = c.get('user');
  const body = await c.req.json<any>();
  const taskId = String(body.task_id || '').trim();
  const diagnostics = Array.isArray(body.diagnostics) ? body.diagnostics.slice(0, 100) : [];
  if (!taskId) return c.json({ error: '작업 식별값이 필요합니다.' }, 400);
  await ensureAutomationDiagnosticTable(c.env.DB);
  const issueCount = diagnostics.filter((item: any) => item?.status === 'warning' || item?.status === 'error').length;
  const existing = await c.env.DB.prepare('SELECT id FROM automation_generation_logs WHERE user_id = ? AND task_id = ?')
    .bind(authUser.sub, taskId).first<{ id: string }>();
  const id = existing?.id || crypto.randomUUID();
  await c.env.DB.prepare(`
    INSERT INTO automation_generation_logs
      (id, user_id, task_id, output_type, file_name, success, message, agent_version, diagnostics_json, issue_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, task_id) DO UPDATE SET
      output_type = excluded.output_type, file_name = excluded.file_name, success = excluded.success,
      message = excluded.message, agent_version = excluded.agent_version,
      diagnostics_json = excluded.diagnostics_json, issue_count = excluded.issue_count,
      updated_at = datetime('now')
  `).bind(
    id, authUser.sub, taskId, String(body.output_type || 'auction_report'), String(body.file_name || ''),
    body.success ? 1 : 0, String(body.message || ''), String(body.agent_version || ''),
    JSON.stringify(diagnostics), issueCount,
  ).run();
  return c.json({ success: true, id, issue_count: issueCount });
});

report.get('/diagnostics', async (c) => {
  const masterError = requireMaster(c);
  if (masterError) return masterError;
  await ensureAutomationDiagnosticTable(c.env.DB);
  const userId = String(c.req.query('user_id') || '').trim();
  const reviewStatus = String(c.req.query('review_status') || '').trim();
  const limit = Math.min(500, Math.max(1, Number(c.req.query('limit')) || 200));
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (userId) { conditions.push('l.user_id = ?'); values.push(userId); }
  if (reviewStatus) { conditions.push('l.review_status = ?'); values.push(reviewStatus); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await c.env.DB.prepare(`
    SELECT l.*, u.name AS consultant_name, u.branch, u.department, u.position_title
    FROM automation_generation_logs l
    LEFT JOIN users u ON u.id = l.user_id
    ${where}
    ORDER BY l.created_at DESC LIMIT ?
  `).bind(...values, limit).all<any>();
  const consultants = await c.env.DB.prepare(`
    SELECT id, name, branch, department, position_title
    FROM users WHERE approved = 1 AND role != 'resigned'
    ORDER BY branch, name
  `).all<any>();
  return c.json({
    items: (rows.results || []).map((row: any) => ({
      ...row,
      success: Boolean(row.success),
      diagnostics: (() => { try { return JSON.parse(row.diagnostics_json || '[]'); } catch { return []; } })(),
      diagnostics_json: undefined,
    })),
    consultants: consultants.results || [],
  });
});

report.patch('/diagnostics/:id', async (c) => {
  const masterError = requireMaster(c);
  if (masterError) return masterError;
  await ensureAutomationDiagnosticTable(c.env.DB);
  const body = await c.req.json<any>();
  const status = String(body.review_status || 'open');
  if (!['open', 'reviewed', 'resolved'].includes(status)) return c.json({ error: '유효하지 않은 처리 상태입니다.' }, 400);
  await c.env.DB.prepare(`
    UPDATE automation_generation_logs
    SET review_status = ?, review_note = ?, updated_at = datetime('now')
    WHERE id = ?
  `).bind(status, String(body.review_note || ''), c.req.param('id')).run();
  return c.json({ success: true });
});

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
  const permissionError = requireBusinessAutomationUser(c);
  if (permissionError) return permissionError;

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

report.get('/local-profile', async (c) => {
  const permissionError = requireBusinessAutomationUser(c);
  if (permissionError) return permissionError;

  const { authUser, user } = await currentReportUser(c);
  const credentialError = requireMyAuction(user);
  if (credentialError) return c.json({ error: credentialError }, 400);

  const profile = withSavedProfile({}, authUser, user);
  return c.json({
    myauction_id: profile.myauction_id,
    myauction_pw: profile.myauction_pw,
    author_name: profile.author_name,
    author_title: profile.author_title,
    author_phone: profile.author_phone,
    requester_role: profile.requester_role,
    requester_permission: profile.requester_permission,
  });
});

report.get('/agent-installer', async (c) => {
  const bucket = (c.env as any).ARTICLE_BUCKET;
  if (!bucket) return c.json({ error: '설치 파일 저장소가 설정되지 않았습니다.' }, 500);

  const object = await bucket.get(AGENT_INSTALLER_KEY);
  if (!object) return c.json({ error: '자동화 실행기 설치 파일이 아직 업로드되지 않았습니다.' }, 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Content-Type', 'application/vnd.microsoft.portable-executable');
  headers.set('Content-Disposition', 'attachment; filename="MyAuctionAutomationAgentSetup.exe"');
  headers.set('Cache-Control', 'private, max-age=300');
  return new Response(object.body, { headers });
});

report.get('/agent-version', (c) => {
  return c.json(
    { version: AUTOMATION_AGENT_VERSION },
    200,
    {
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      Pragma: 'no-cache',
      Expires: '0',
    },
  );
});

report.post('/start-batch', async (c) => {
  const permissionError = requireBusinessAutomationUser(c);
  if (permissionError) return permissionError;

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
  const permissionError = requireBusinessAutomationUser(c);
  if (permissionError) return permissionError;
  return proxyJson(c, `/report/progress/${c.req.param('taskId')}`);
});

report.get('/download/:taskId', (c) => {
  const permissionError = requireBusinessAutomationUser(c);
  if (permissionError) return permissionError;

  const query = c.req.url.split('?')[1];
  return proxyFile(c, `/report/download/${c.req.param('taskId')}${query ? `?${query}` : ''}`);
});

report.get('/download-history', (c) => {
  const permissionError = requireBusinessAutomationUser(c);
  if (permissionError) return permissionError;
  return proxyJson(c, '/report/download-history');
});

report.get('/download-history/:historyId', (c) => {
  const permissionError = requireBusinessAutomationUser(c);
  if (permissionError) return permissionError;

  const query = c.req.url.split('?')[1];
  return proxyFile(c, `/report/download-history/${c.req.param('historyId')}${query ? `?${query}` : ''}`);
});

export default report;
