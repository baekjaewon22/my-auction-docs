import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import type { AuthEnv } from '../types';
import { canUseBusinessAutomation } from '../../shared/automation-access';
import { AUTOMATION_AGENT_VERSION } from '../../shared/automation-agent-version';
import { ensureAutomationJobQueueSchema } from '../lib/automation-job-queue';

const report = new Hono<AuthEnv>();
const AGENT_INSTALLER_KEYS = [
  'downloads/마이실행기.exe',
  'downloads/MyAuctionAutomationAgentSetup.exe',
];

// 버전 문자열은 민감정보가 아니며 로그인 만료 상태에서도 업데이트 여부를 판정해야 한다.
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

async function enqueueAutomationJob(c: any, body: any, isBatch: boolean) {
  if (!c.env.ARTICLE_BUCKET) return c.json({ error: '자동화 작업 저장소가 설정되지 않았습니다.' }, 503);
  const { authUser, user } = await currentReportUser(c);
  const credentialError = requireMyAuction(user);
  if (credentialError) return c.json({ error: credentialError }, 400);
  const outputType = String(body.output_type || 'auction_report');
  if (!['auction_report', 'rights_certificate'].includes(outputType)) return c.json({ error: '지원하지 않는 자료 유형입니다.' }, 400);
  if (outputType === 'rights_certificate' && !canUseRightsCertificate(authUser, user)) {
    return c.json({ error: '권리분석 보증서는 master 또는 special 권한만 생성할 수 있습니다.' }, 403);
  }
  const urls = isBatch ? (Array.isArray(body.urls) ? body.urls.map((value: unknown) => String(value || '').trim()).filter(Boolean) : []) : [];
  if (isBatch && urls.length === 0) return c.json({ error: '처리할 경매 물건 URL이 없습니다.' }, 400);
  if (isBatch && urls.length > 50) return c.json({ error: '다건 작업은 한 번에 최대 50건까지 등록할 수 있습니다.' }, 400);
  if (!isBatch && !String(body.url || '').trim()) return c.json({ error: '마이옥션 사건 URL을 입력해 주세요.' }, 400);

  await ensureAutomationJobQueueSchema(c.env.DB);
  const idempotencyKey = String(c.req.header('idempotency-key') || body.idempotency_key || crypto.randomUUID()).trim().slice(0, 100);
  const prior = await c.env.DB.prepare('SELECT id FROM automation_jobs WHERE owner_user_id = ? AND idempotency_key = ?')
    .bind(authUser.sub, idempotencyKey).first() as { id: string } | null;
  if (prior) return c.json({ task_id: prior.id, idempotent: true });

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  let availableAt = createdAt;
  if (isBatch && String(body.start_at || '').trim()) {
    const scheduled = new Date(String(body.start_at));
    if (Number.isNaN(scheduled.getTime())) return c.json({ error: '예약 실행 시각이 올바르지 않습니다.' }, 400);
    availableAt = scheduled.toISOString();
  }
  const objectKey = `automation/jobs/${id}/request.json`;
  const safePayload = {
    ...body,
    idempotency_key: undefined,
    myauction_id: undefined,
    myauction_pw: undefined,
    requester_role: undefined,
    requester_permission: undefined,
    ...(isBatch ? { urls } : { url: String(body.url || '').trim() }),
  };
  await c.env.ARTICLE_BUCKET.put(objectKey, JSON.stringify(safePayload), { httpMetadata: { contentType: 'application/json' } });
  try {
    await c.env.DB.prepare(`INSERT OR IGNORE INTO automation_jobs
      (id, owner_user_id, output_type, is_batch, request_object_key, idempotency_key, available_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, authUser.sub, outputType, isBatch ? 1 : 0, objectKey, idempotencyKey, availableAt, createdAt, createdAt).run();
    const saved = await c.env.DB.prepare('SELECT id FROM automation_jobs WHERE owner_user_id = ? AND idempotency_key = ?')
      .bind(authUser.sub, idempotencyKey).first() as { id: string } | null;
    if (!saved) throw new Error('자동화 작업을 저장하지 못했습니다.');
    if (saved.id !== id) await c.env.ARTICLE_BUCKET.delete(objectKey);
    const ahead = await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM automation_jobs
      WHERE status='queued' AND available_at <= (SELECT available_at FROM automation_jobs WHERE id = ?)
        AND (priority < 100 OR (priority = 100 AND (
          created_at < (SELECT created_at FROM automation_jobs WHERE id = ?)
          OR (created_at = (SELECT created_at FROM automation_jobs WHERE id = ?) AND id < ?)
        )))`)
      .bind(saved.id, saved.id, saved.id, saved.id).first() as { count: number } | null;
    return c.json({ task_id: saved.id, queue_position: Number(ahead?.count || 0) + 1, idempotent: saved.id !== id });
  } catch (error) {
    await c.env.ARTICLE_BUCKET.delete(objectKey);
    throw error;
  }
}

async function accessibleJob(c: any, jobId: string) {
  const authUser = c.get('user');
  await ensureAutomationJobQueueSchema(c.env.DB);
  const job = await c.env.DB.prepare('SELECT * FROM automation_jobs WHERE id = ?').bind(jobId).first() as any;
  if (!job || (job.owner_user_id !== authUser.sub && authUser.role !== 'master')) return null;
  return job;
}

report.post('/start', async (c) => {
  const permissionError = requireBusinessAutomationUser(c);
  if (permissionError) return permissionError;

  return enqueueAutomationJob(c, await c.req.json<any>(), false);
});

report.get('/local-profile', async (c) => {
  const permissionError = requireBusinessAutomationUser(c);
  if (permissionError) return permissionError;
  return c.json({ error: '로컬 실행기 직접 연결은 중앙 작업 대기열로 전환되었습니다.' }, 410);
});

report.get('/agent-installer', async (c) => {
  const bucket = (c.env as any).ARTICLE_BUCKET;
  if (!bucket) return c.json({ error: '설치 파일 저장소가 설정되지 않았습니다.' }, 500);

  let object = null;
  for (const key of AGENT_INSTALLER_KEYS) {
    object = await bucket.get(key);
    if (object) break;
  }
  if (!object) return c.json({ error: '자동화 실행기 설치 파일이 아직 업로드되지 않았습니다.' }, 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Content-Type', 'application/vnd.microsoft.portable-executable');
  headers.set(
    'Content-Disposition',
    `attachment; filename="MyAuctionRunnerSetup.exe"; filename*=UTF-8''${encodeURIComponent('마이실행기.exe')}`,
  );
  headers.set('Cache-Control', 'private, max-age=300');
  return new Response(object.body, { headers });
});

report.post('/start-batch', async (c) => {
  const permissionError = requireBusinessAutomationUser(c);
  if (permissionError) return permissionError;

  return enqueueAutomationJob(c, await c.req.json<any>(), true);
});

report.get('/progress/:taskId', async (c) => {
  const permissionError = requireBusinessAutomationUser(c);
  if (permissionError) return permissionError;
  const job = await accessibleJob(c, c.req.param('taskId'));
  if (!job) return c.json({ error: '작업을 찾을 수 없습니다.' }, 404);
  const events = await c.env.DB.prepare(`SELECT step, total_steps, title, message, status, percent
    FROM automation_job_events WHERE job_id = ? ORDER BY id ASC LIMIT 200`).bind(job.id).all<any>();
  const updates = events.results || [];
  const ahead = job.status === 'queued' ? await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM automation_jobs
    WHERE status='queued' AND available_at <= ? AND (priority < ? OR (priority = ? AND (created_at < ? OR (created_at = ? AND id < ?))))`)
    .bind(job.available_at, job.priority, job.priority, job.created_at, job.created_at, job.id).first<{ count: number }>() : null;
  const queuePosition = ahead ? Number(ahead.count || 0) + 1 : 0;
  const currentMessage = job.status === 'queued' && queuePosition > 0
    ? `서버 실행 순서를 기다리고 있습니다. 현재 대기 ${queuePosition}번째입니다.`
    : job.status_message;
  const terminalStatus = job.status === 'failed' || job.status === 'cancelled' ? 'error' : job.status === 'completed' ? 'completed' : 'running';
  const last = updates[updates.length - 1];
  if (!last || last.status !== terminalStatus || last.message !== currentMessage || Number(last.percent) !== Number(job.progress_percent)) {
    updates.push({ step: job.current_step, total_steps: job.total_steps, title: job.status_title,
      message: currentMessage, status: terminalStatus, percent: job.progress_percent });
  }
  let diagnostics: unknown[] = [];
  try { diagnostics = JSON.parse(job.diagnostics_json || '[]'); } catch { diagnostics = []; }
  return c.json({ task_id: job.id, status: job.status, queue_position: queuePosition, updates, diagnostics });
});

report.get('/download/:taskId', async (c) => {
  const permissionError = requireBusinessAutomationUser(c);
  if (permissionError) return permissionError;
  const job = await accessibleJob(c, c.req.param('taskId'));
  if (!job) return c.json({ error: '작업을 찾을 수 없습니다.' }, 404);
  const format = String(c.req.query('format') || '').toLowerCase();
  const artifact = await c.env.DB.prepare(`SELECT * FROM automation_job_artifacts WHERE job_id = ? AND format = ?`)
    .bind(job.id, format).first<any>();
  if (!artifact) return c.json({ error: '요청한 형식의 결과 파일이 없습니다.' }, 404);
  const object = await c.env.ARTICLE_BUCKET.get(artifact.object_key);
  if (!object) return c.json({ error: '결과 파일을 찾을 수 없습니다.' }, 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(artifact.file_name)}`);
  return new Response(object.body, { headers });
});

report.get('/download-history', async (c) => {
  const permissionError = requireBusinessAutomationUser(c);
  if (permissionError) return permissionError;
  const authUser = c.get('user');
  await ensureAutomationJobQueueSchema(c.env.DB);
  const jobs = await c.env.DB.prepare(`SELECT * FROM automation_jobs WHERE owner_user_id = ? AND status = 'completed'
    ORDER BY completed_at DESC LIMIT 20`).bind(authUser.sub).all<any>();
  const items = [];
  for (const job of jobs.results || []) {
    const artifacts = await c.env.DB.prepare('SELECT id, format, file_name FROM automation_job_artifacts WHERE job_id = ? ORDER BY format')
      .bind(job.id).all<any>();
    const rows = artifacts.results || [];
    let diagnostics: unknown[] = [];
    try { diagnostics = JSON.parse(job.diagnostics_json || '[]'); } catch { diagnostics = []; }
    items.push({ id: job.id, task_id: job.id, output_type: job.output_type, title: rows[0]?.file_name || '자동화 결과',
      file_name: rows[0]?.file_name || '', created_at: job.completed_at, message: job.status_message,
      diagnostics, exists: rows.length > 0, formats: rows.map((row: any) => row.format) });
  }
  return c.json({ items, limit: 20 });
});

report.get('/download-history/:historyId', async (c) => {
  const permissionError = requireBusinessAutomationUser(c);
  if (permissionError) return permissionError;
  const job = await accessibleJob(c, c.req.param('historyId'));
  if (!job) return c.json({ error: '작업을 찾을 수 없습니다.' }, 404);
  const format = String(c.req.query('format') || '').toLowerCase();
  const artifact = await c.env.DB.prepare('SELECT * FROM automation_job_artifacts WHERE job_id = ? AND format = ?').bind(job.id, format).first<any>();
  if (!artifact) return c.json({ error: '결과 파일이 없습니다.' }, 404);
  const object = await c.env.ARTICLE_BUCKET.get(artifact.object_key);
  if (!object) return c.json({ error: '결과 파일을 찾을 수 없습니다.' }, 404);
  const headers = new Headers(); object.writeHttpMetadata(headers);
  headers.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(artifact.file_name)}`);
  return new Response(object.body, { headers });
});

report.get('/central-agent-status', async (c) => {
  const permissionError = requireBusinessAutomationUser(c);
  if (permissionError) return permissionError;
  await ensureAutomationJobQueueSchema(c.env.DB);
  const agent = await c.env.DB.prepare(`SELECT id, display_name, version, status, current_job_id, last_seen_at,
    CASE WHEN last_seen_at >= datetime('now','-90 seconds') THEN 1 ELSE 0 END AS online
    FROM automation_agents ORDER BY last_seen_at DESC LIMIT 1`).first<any>();
  const counts = await c.env.DB.prepare(`SELECT
    SUM(CASE WHEN status='queued' THEN 1 ELSE 0 END) AS queued,
    SUM(CASE WHEN status IN ('leased','running','uploading') THEN 1 ELSE 0 END) AS running
    FROM automation_jobs`).first<any>();
  const onlineAgents = await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM automation_agents
    WHERE last_seen_at >= datetime('now','-90 seconds') AND version = ?`).bind(AUTOMATION_AGENT_VERSION).first<{ count: number }>();
  return c.json({ agent: agent || null, online: Number(onlineAgents?.count || 0) > 0,
    online_agents: Number(onlineAgents?.count || 0), queued: Number(counts?.queued || 0),
    running: Number(counts?.running || 0), required_version: AUTOMATION_AGENT_VERSION });
});

export default report;
