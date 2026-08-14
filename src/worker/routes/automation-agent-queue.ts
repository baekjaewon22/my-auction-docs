import { Hono } from 'hono';
import {
  automationArtifactContentType,
  ensureAutomationJobQueueSchema,
  safeAutomationFileName,
  secureTextEqual,
} from '../lib/automation-job-queue';
import { AUTOMATION_AGENT_VERSION } from '../../shared/automation-agent-version';

const agentQueue = new Hono<{ Bindings: Env }>();

agentQueue.use('*', async (c, next) => {
  const configured = String(c.env.AUTOMATION_AGENT_API_KEY || '').trim();
  if (!configured) return c.json({ error: 'AUTOMATION_AGENT_API_KEY is not configured' }, 503);
  const supplied = String(c.req.header('x-automation-agent-key') || '').trim();
  if (!(await secureTextEqual(configured, supplied))) return c.json({ error: '자동화 실행기 인증에 실패했습니다.' }, 401);
  await ensureAutomationJobQueueSchema(c.env.DB);
  return next();
});

async function touchAgent(db: D1Database, input: { id: string; name?: string; version?: string; status?: string; jobId?: string }) {
  if (!input.id) return;
  await db.prepare(`INSERT INTO automation_agents (id, display_name, version, status, current_job_id, last_seen_at, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, version = excluded.version,
      status = excluded.status, current_job_id = excluded.current_job_id,
      last_seen_at = datetime('now'), updated_at = datetime('now')`)
    .bind(input.id, input.name || input.id, input.version || '', input.status || 'idle', input.jobId || '').run();
}

agentQueue.post('/heartbeat', async (c) => {
  const body = await c.req.json<any>();
  const agentId = String(body.agent_id || '').trim();
  if (!agentId) return c.json({ error: 'agent_id가 필요합니다.' }, 400);
  await touchAgent(c.env.DB, { id: agentId, name: body.display_name, version: body.version, status: body.status || 'idle', jobId: body.current_job_id });
  if (String(body.version || '') !== AUTOMATION_AGENT_VERSION) {
    return c.json({ error: '자동화 서버 실행기 업데이트가 필요합니다.', required_version: AUTOMATION_AGENT_VERSION }, 426);
  }
  return c.json({ success: true, server_time: new Date().toISOString() });
});

agentQueue.post('/jobs/claim', async (c) => {
  const body = await c.req.json<any>();
  const agentId = String(body.agent_id || '').trim();
  if (!agentId) return c.json({ error: 'agent_id가 필요합니다.' }, 400);
  await touchAgent(c.env.DB, { id: agentId, name: body.display_name, version: body.version, status: 'idle' });
  if (String(body.version || '') !== AUTOMATION_AGENT_VERSION) {
    return c.json({ error: '자동화 서버 실행기 업데이트가 필요합니다.', required_version: AUTOMATION_AGENT_VERSION }, 426);
  }

  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE automation_jobs SET status = 'queued', agent_id = '', lease_token = '',
      lease_expires_at = NULL, status_title = '재실행 대기', status_message = '중단된 작업을 다시 실행합니다.', updated_at = datetime('now')
      WHERE status IN ('leased','running','uploading') AND lease_expires_at < datetime('now')
        AND attempt_count < max_attempts`),
    c.env.DB.prepare(`UPDATE automation_jobs SET status = 'failed', error_code = 'LEASE_EXPIRED',
      error_message = '실행기 연결이 중단되어 재시도 한도를 초과했습니다.', status_title = '실행 실패',
      status_message = '서버 실행기 연결이 중단되었습니다.', completed_at = datetime('now'), updated_at = datetime('now')
      WHERE status IN ('leased','running','uploading') AND lease_expires_at < datetime('now')
        AND attempt_count >= max_attempts`),
  ]);

  const candidate = await c.env.DB.prepare(`SELECT id FROM automation_jobs
    WHERE status = 'queued' AND cancel_requested = 0 AND julianday(available_at) <= julianday('now')
    ORDER BY priority ASC, created_at ASC, id ASC LIMIT 1`).first<{ id: string }>();
  if (!candidate) return c.json({ job: null });

  const leaseToken = crypto.randomUUID();
  const claimed = await c.env.DB.prepare(`UPDATE automation_jobs SET status = 'leased', agent_id = ?, lease_token = ?,
    lease_expires_at = datetime('now', '+3 minutes'), heartbeat_at = datetime('now'), attempt_count = attempt_count + 1,
    started_at = COALESCE(started_at, datetime('now')), status_title = '서버 연결',
    status_message = '서버 실행기가 작업을 준비하고 있습니다.', updated_at = datetime('now')
    WHERE id = ? AND status = 'queued' AND cancel_requested = 0`)
    .bind(agentId, leaseToken, candidate.id).run();
  if (Number(claimed.meta.changes || 0) !== 1) return c.json({ job: null });

  const job = await c.env.DB.prepare(`SELECT j.*, u.name AS author_name, u.position_title AS author_title,
      u.phone AS author_phone, u.role AS requester_role, u.myauction_id, u.myauction_pw,
      COALESCE(u.report_permission, 'basic') AS requester_permission
    FROM automation_jobs j INNER JOIN users u ON u.id = j.owner_user_id WHERE j.id = ?`)
    .bind(candidate.id).first<any>();
  const requestObject = job ? await c.env.ARTICLE_BUCKET.get(job.request_object_key) : null;
  if (!job || !requestObject) {
    await c.env.DB.prepare(`UPDATE automation_jobs SET status='failed', error_code='REQUEST_MISSING',
      error_message='작업 요청 데이터를 찾을 수 없습니다.', completed_at=datetime('now'), updated_at=datetime('now') WHERE id=?`)
      .bind(candidate.id).run();
    return c.json({ job: null });
  }
  const payload = await requestObject.json<any>();
  await touchAgent(c.env.DB, { id: agentId, name: body.display_name, version: body.version, status: 'busy', jobId: job.id });
  return c.json({
    job: {
      id: job.id,
      lease_token: leaseToken,
      output_type: job.output_type,
      is_batch: Boolean(job.is_batch),
      payload: {
        ...payload,
        myauction_id: String(job.myauction_id || ''),
        myauction_pw: String(job.myauction_pw || ''),
        author_name: String(job.author_name || ''),
        author_title: String(job.author_title || ''),
        author_phone: String(job.author_phone || ''),
        requester_role: String(job.requester_role || ''),
        requester_permission: job.requester_role === 'master' ? 'special' : String(job.requester_permission || 'basic'),
      },
    },
  });
});

agentQueue.post('/jobs/:id/progress', async (c) => {
  const body = await c.req.json<any>();
  const jobId = c.req.param('id');
  const leaseToken = String(body.lease_token || '');
  const step = Math.max(0, Number(body.step) || 0);
  const totalSteps = Math.max(1, Number(body.total_steps) || 1);
  const percent = Math.max(0, Math.min(100, Number(body.percent) || 0));
  const title = String(body.title || '').slice(0, 100);
  const message = String(body.message || '').slice(0, 1000);
  const updated = await c.env.DB.prepare(`UPDATE automation_jobs SET status = 'running', current_step = ?, total_steps = ?,
    progress_percent = ?, status_title = ?, status_message = ?, heartbeat_at = datetime('now'),
    lease_expires_at = datetime('now', '+3 minutes'), updated_at = datetime('now')
    WHERE id = ? AND lease_token = ? AND status IN ('leased','running','uploading')`)
    .bind(step, totalSteps, percent, title, message, jobId, leaseToken).run();
  if (Number(updated.meta.changes || 0) !== 1) return c.json({ error: '작업 임대가 만료되었습니다.' }, 409);
  await c.env.DB.prepare(`INSERT INTO automation_job_events (job_id, step, total_steps, title, message, status, percent)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(jobId, step, totalSteps, title, message, String(body.status || 'running'), percent).run();
  const job = await c.env.DB.prepare('SELECT cancel_requested FROM automation_jobs WHERE id = ?').bind(jobId).first<{ cancel_requested: number }>();
  return c.json({ success: true, cancel_requested: Boolean(job?.cancel_requested) });
});

agentQueue.post('/jobs/:id/heartbeat', async (c) => {
  const body = await c.req.json<any>();
  const jobId = c.req.param('id');
  const leaseToken = String(body.lease_token || '');
  const updated = await c.env.DB.prepare(`UPDATE automation_jobs SET heartbeat_at=datetime('now'),
    lease_expires_at=datetime('now','+3 minutes'), updated_at=datetime('now')
    WHERE id=? AND lease_token=? AND status IN ('leased','running','uploading')`)
    .bind(jobId, leaseToken).run();
  if (Number(updated.meta.changes || 0) !== 1) return c.json({ error: '작업 임대가 만료되었습니다.' }, 409);
  await touchAgent(c.env.DB, { id: String(body.agent_id || ''), version: body.version, status: 'busy', jobId });
  const job = await c.env.DB.prepare('SELECT cancel_requested FROM automation_jobs WHERE id=?').bind(jobId).first<{ cancel_requested: number }>();
  return c.json({ success: true, cancel_requested: Boolean(job?.cancel_requested) });
});

agentQueue.post('/jobs/:id/artifacts/:format', async (c) => {
  const jobId = c.req.param('id');
  const format = c.req.param('format').toLowerCase();
  if (!['pptx', 'pdf', 'zip'].includes(format)) return c.json({ error: '지원하지 않는 결과 형식입니다.' }, 400);
  const leaseToken = String(c.req.header('x-automation-lease-token') || '');
  const job = await c.env.DB.prepare(`SELECT id FROM automation_jobs WHERE id = ? AND lease_token = ?
    AND status IN ('leased','running','uploading')`).bind(jobId, leaseToken).first();
  if (!job) return c.json({ error: '작업 임대가 만료되었습니다.' }, 409);
  const contentLength = Number(c.req.header('content-length') || 0);
  if (contentLength > 100 * 1024 * 1024) return c.json({ error: '결과 파일은 100MB 이하여야 합니다.' }, 413);
  const body = await c.req.arrayBuffer();
  if (body.byteLength > 100 * 1024 * 1024) return c.json({ error: '결과 파일은 100MB 이하여야 합니다.' }, 413);
  const fileName = safeAutomationFileName(decodeURIComponent(c.req.header('x-file-name') || `result.${format}`));
  const objectKey = `automation/jobs/${jobId}/${format}/${crypto.randomUUID()}-${fileName}`;
  const contentType = automationArtifactContentType(format);
  await c.env.ARTICLE_BUCKET.put(objectKey, body, { httpMetadata: { contentType } });
  const artifactId = crypto.randomUUID();
  const previous = await c.env.DB.prepare('SELECT object_key FROM automation_job_artifacts WHERE job_id = ? AND format = ?')
    .bind(jobId, format).first<{ object_key: string }>();
  await c.env.DB.prepare(`INSERT INTO automation_job_artifacts (id, job_id, format, object_key, file_name, content_type, file_size)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(job_id, format) DO UPDATE SET object_key=excluded.object_key,
      file_name=excluded.file_name, content_type=excluded.content_type, file_size=excluded.file_size, created_at=datetime('now')`)
    .bind(artifactId, jobId, format, objectKey, fileName, contentType, body.byteLength).run();
  if (previous?.object_key && previous.object_key !== objectKey) await c.env.ARTICLE_BUCKET.delete(previous.object_key);
  await c.env.DB.prepare(`UPDATE automation_jobs SET status='uploading', lease_expires_at=datetime('now','+3 minutes'),
    heartbeat_at=datetime('now'), updated_at=datetime('now') WHERE id=? AND lease_token=?`).bind(jobId, leaseToken).run();
  return c.json({ success: true, artifact_id: artifactId });
});

agentQueue.post('/jobs/:id/complete', async (c) => {
  const body = await c.req.json<any>();
  const jobId = c.req.param('id');
  const updated = await c.env.DB.prepare(`UPDATE automation_jobs SET status='completed', progress_percent=100,
    status_title='완료', status_message=?, diagnostics_json=?, lease_expires_at=NULL, heartbeat_at=datetime('now'),
    completed_at=datetime('now'), updated_at=datetime('now')
    WHERE id=? AND lease_token=? AND status IN ('leased','running','uploading')`)
    .bind(String(body.message || '자료 생성이 완료되었습니다.').slice(0, 1000), JSON.stringify(Array.isArray(body.diagnostics) ? body.diagnostics.slice(0, 100) : []), jobId, String(body.lease_token || '')).run();
  if (Number(updated.meta.changes || 0) !== 1) return c.json({ error: '작업 임대가 만료되었습니다.' }, 409);
  await touchAgent(c.env.DB, { id: String(body.agent_id || ''), version: body.version, status: 'idle' });
  return c.json({ success: true });
});

agentQueue.post('/jobs/:id/fail', async (c) => {
  const body = await c.req.json<any>();
  const jobId = c.req.param('id');
  const updated = await c.env.DB.prepare(`UPDATE automation_jobs SET status='failed', status_title='실행 실패',
    status_message=?, error_code=?, error_message=?, diagnostics_json=?, lease_expires_at=NULL,
    completed_at=datetime('now'), updated_at=datetime('now')
    WHERE id=? AND lease_token=? AND status IN ('leased','running','uploading')`)
    .bind(String(body.message || '자동화 실행에 실패했습니다.').slice(0, 1000), String(body.error_code || 'EXECUTION_FAILED').slice(0, 100),
      String(body.message || '').slice(0, 2000), JSON.stringify(Array.isArray(body.diagnostics) ? body.diagnostics.slice(0, 100) : []), jobId, String(body.lease_token || '')).run();
  if (Number(updated.meta.changes || 0) !== 1) return c.json({ error: '작업 임대가 만료되었습니다.' }, 409);
  await touchAgent(c.env.DB, { id: String(body.agent_id || ''), version: body.version, status: 'idle' });
  return c.json({ success: true });
});

export default agentQueue;
