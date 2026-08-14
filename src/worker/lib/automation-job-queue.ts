export const AUTOMATION_JOB_ACTIVE_STATUSES = ['leased', 'running', 'uploading'] as const;

const schemaPromises = new WeakMap<object, Promise<void>>();

export async function ensureAutomationJobQueueSchema(db: D1Database): Promise<void> {
  const key = db as object;
  const existing = schemaPromises.get(key);
  if (existing) return existing;
  const promise = (async () => {
    await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS automation_jobs (
      id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, output_type TEXT NOT NULL,
      is_batch INTEGER NOT NULL DEFAULT 0, request_object_key TEXT NOT NULL,
      idempotency_key TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
      priority INTEGER NOT NULL DEFAULT 100, agent_id TEXT NOT NULL DEFAULT '',
      lease_token TEXT NOT NULL DEFAULT '', lease_expires_at TEXT, heartbeat_at TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 2,
      progress_percent REAL NOT NULL DEFAULT 0, current_step INTEGER NOT NULL DEFAULT 0,
      total_steps INTEGER NOT NULL DEFAULT 1, status_title TEXT NOT NULL DEFAULT '접수 완료',
      status_message TEXT NOT NULL DEFAULT '서버 실행 순서를 기다리고 있습니다.',
      cancel_requested INTEGER NOT NULL DEFAULT 0, error_code TEXT NOT NULL DEFAULT '',
      error_message TEXT NOT NULL DEFAULT '', diagnostics_json TEXT NOT NULL DEFAULT '[]',
      available_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')), started_at TEXT, completed_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (owner_user_id, idempotency_key)
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_automation_jobs_queue ON automation_jobs(status, available_at, priority, created_at, id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_automation_jobs_owner ON automation_jobs(owner_user_id, created_at DESC)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_automation_jobs_lease ON automation_jobs(status, lease_expires_at)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS automation_job_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL,
      step INTEGER NOT NULL DEFAULT 0, total_steps INTEGER NOT NULL DEFAULT 1,
      title TEXT NOT NULL DEFAULT '', message TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'running', percent REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_automation_job_events_job ON automation_job_events(job_id, id)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS automation_job_artifacts (
      id TEXT PRIMARY KEY, job_id TEXT NOT NULL, format TEXT NOT NULL,
      object_key TEXT NOT NULL UNIQUE, file_name TEXT NOT NULL,
      content_type TEXT NOT NULL DEFAULT 'application/octet-stream', file_size INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (job_id, format)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS automation_agents (
      id TEXT PRIMARY KEY, display_name TEXT NOT NULL DEFAULT '', version TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'offline', current_job_id TEXT NOT NULL DEFAULT '',
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')), created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
    ]);
    const columns = await db.prepare('PRAGMA table_info(automation_jobs)').all<{ name: string }>();
    if (!(columns.results || []).some((column) => column.name === 'available_at')) {
      await db.prepare("ALTER TABLE automation_jobs ADD COLUMN available_at TEXT NOT NULL DEFAULT '1970-01-01 00:00:00'").run();
      await db.prepare("UPDATE automation_jobs SET available_at = created_at WHERE available_at = '1970-01-01 00:00:00'").run();
    }
  })();
  schemaPromises.set(key, promise);
  try { await promise; } catch (error) { schemaPromises.delete(key); throw error; }
}

export function safeAutomationFileName(value: string): string {
  return String(value || 'result.bin').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 180) || 'result.bin';
}

export function automationArtifactContentType(format: string): string {
  if (format === 'pdf') return 'application/pdf';
  if (format === 'zip') return 'application/zip';
  return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
}

export async function secureTextEqual(left: string, right: string): Promise<boolean> {
  if (!left || !right) return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right)),
  ]);
  const aa = new Uint8Array(a);
  const bb = new Uint8Array(b);
  let diff = 0;
  for (let index = 0; index < aa.length; index += 1) diff |= aa[index] ^ bb[index];
  return diff === 0;
}
