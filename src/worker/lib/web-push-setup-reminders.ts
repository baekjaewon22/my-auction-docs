import { isNonWorkingDate } from '../../shared/work-calendar.ts';
import { isHeadOfficeBranch, normalizeBranchName, sameBranchName } from './branchAliases.ts';
import { getAdminVisibleBranches } from './branch-approval-overrides.ts';
import { loadSystemHolidayDates } from './system-holidays.ts';
import { sendWebPushToUser } from './web-push-delivery.ts';

export type PushSetupUser = {
  id: string;
  name: string;
  role: string;
  branch: string;
  department: string;
  active_push_count: number;
};

export type PushSetupStatus = {
  scope_label: string;
  missing: PushSetupUser[];
  total_count: number;
};

const RECIPIENT_ROLES = new Set(['manager', 'admin', 'master']);

function kstDateText(now: Date): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export async function ensureWebPushSetupReminderTable(db: D1Database): Promise<void> {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS web_push_setup_reminder_runs (
      id TEXT PRIMARY KEY,
      alert_date TEXT NOT NULL,
      recipient_id TEXT NOT NULL,
      recipient_role TEXT NOT NULL,
      scope_label TEXT NOT NULL DEFAULT '',
      missing_count INTEGER NOT NULL DEFAULT 0,
      missing_users_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'no_subscription')),
      sent_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
      UNIQUE(alert_date, recipient_id),
      FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `).run();
  await db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_web_push_setup_reminder_runs_date
    ON web_push_setup_reminder_runs(alert_date, status)
  `).run();
}

export async function loadPushSetupUsers(db: D1Database): Promise<PushSetupUser[]> {
  const result = await db.prepare(`
    SELECT u.id, u.name, u.role, COALESCE(u.branch, '') AS branch,
      COALESCE(u.department, '') AS department,
      COUNT(CASE WHEN s.active = 1 THEN 1 END) AS active_push_count
    FROM users u
    LEFT JOIN web_push_subscriptions s ON s.user_id = u.id AND s.active = 1
    WHERE u.approved = 1
      AND u.role NOT IN ('resigned', 'support')
      AND COALESCE(u.login_type, 'employee') = 'employee'
    GROUP BY u.id, u.name, u.role, u.branch, u.department
    ORDER BY u.branch, u.department, u.name
  `).all<PushSetupUser>();
  return (result.results || []).map((row) => ({ ...row, active_push_count: Number(row.active_push_count || 0) }));
}

export function managerMissingPushUsers(recipient: PushSetupUser, users: readonly PushSetupUser[]): PushSetupUser[] {
  return managerPushUsers(recipient, users).filter((candidate) => candidate.active_push_count === 0);
}

export function managerPushUsers(recipient: PushSetupUser, users: readonly PushSetupUser[]): PushSetupUser[] {
  return users.filter((candidate) =>
    ['member', 'manager'].includes(candidate.role)
    && sameBranchName(candidate.branch, recipient.branch)
    && candidate.department === recipient.department,
  );
}

export function branchMissingPushUsers(branches: readonly string[], users: readonly PushSetupUser[]): PushSetupUser[] {
  return branchPushUsers(branches, users).filter((candidate) => candidate.active_push_count === 0);
}

export function branchPushUsers(branches: readonly string[], users: readonly PushSetupUser[]): PushSetupUser[] {
  const normalized = new Set(branches.map(normalizeBranchName).filter(Boolean));
  return users.filter((candidate) => normalized.has(normalizeBranchName(candidate.branch)));
}

export async function getPushSetupStatusForViewer(
  db: D1Database,
  viewer: Pick<PushSetupUser, 'id' | 'role' | 'branch' | 'department'>,
  usersInput?: PushSetupUser[],
): Promise<PushSetupStatus> {
  const users = usersInput || await loadPushSetupUsers(db);
  const recipient = users.find((item) => item.id === viewer.id) || {
    ...viewer,
    name: '',
    active_push_count: 0,
  };
  if (viewer.role === 'manager') {
    const scopedUsers = managerPushUsers(recipient, users);
    return { scope_label: `${viewer.branch} ${viewer.department}`.trim(), missing: scopedUsers.filter((item) => item.active_push_count === 0), total_count: scopedUsers.length };
  }
  if (viewer.role === 'master' || (viewer.role === 'admin' && isHeadOfficeBranch(viewer.branch))) {
    return { scope_label: '전사', missing: users.filter((item) => item.active_push_count === 0), total_count: users.length };
  }
  if (viewer.role === 'admin') {
    const branches = await getAdminVisibleBranches(db, { sub: viewer.id, branch: viewer.branch });
    const scopedUsers = branchPushUsers(branches, users);
    return { scope_label: normalizeBranchName(viewer.branch) || viewer.branch, missing: scopedUsers.filter((item) => item.active_push_count === 0), total_count: scopedUsers.length };
  }
  return { scope_label: '', missing: [], total_count: users.length };
}

function reminderBody(status: PushSetupStatus): string {
  const names = status.missing.slice(0, 5).map((item) => item.name).join(', ');
  const remainder = status.missing.length > 5 ? ` 외 ${status.missing.length - 5}명` : '';
  return `${status.scope_label}: ${names}${remainder} · 업무 알림 설정 여부를 확인해주세요.`;
}

export async function runWebPushSetupReminders(
  env: Env,
  scheduledAt: Date = new Date(),
): Promise<{ due: boolean; date: string; recipients: number; sent: number; failed: number; missing: number; reason?: string }> {
  const db = env.DB;
  const alertDate = kstDateText(scheduledAt);
  const holidays = await loadSystemHolidayDates(db, [alertDate.slice(0, 4)], 'journal');
  if (isNonWorkingDate(alertDate, holidays)) {
    return { due: false, date: alertDate, recipients: 0, sent: 0, failed: 0, missing: 0, reason: 'non_working_day' };
  }

  await ensureWebPushSetupReminderTable(db);
  const users = await loadPushSetupUsers(db);
  const recipients = users.filter((item) => RECIPIENT_ROLES.has(item.role));
  let recipientCount = 0;
  let sent = 0;
  let failed = 0;
  let missing = 0;

  for (const recipient of recipients) {
    const status = await getPushSetupStatusForViewer(db, recipient, users);
    if (!status.missing.length) continue;
    const runId = crypto.randomUUID();
    const claim = await db.prepare(`
      INSERT OR IGNORE INTO web_push_setup_reminder_runs
        (id, alert_date, recipient_id, recipient_role, scope_label, missing_count, missing_users_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      runId,
      alertDate,
      recipient.id,
      recipient.role,
      status.scope_label,
      status.missing.length,
      JSON.stringify(status.missing.map((item) => ({ id: item.id, name: item.name, branch: item.branch, department: item.department }))),
    ).run();
    if (Number(claim.meta?.changes || 0) === 0) continue;

    recipientCount += 1;
    missing += status.missing.length;
    const result = await sendWebPushToUser(db, env, {
      userId: recipient.id,
      eventType: 'push_setup_missing',
      title: `🔔 알림 미설정 인원 ${status.missing.length}명`,
      body: reminderBody(status),
      url: '/dashboard?focus=web-push-setup',
      tag: `push-setup-missing-${alertDate}-${recipient.id}`,
    });
    sent += result.sent;
    failed += result.failed;
    const runStatus = result.sent > 0 ? 'sent' : result.failed > 0 ? 'failed' : 'no_subscription';
    await db.prepare(`
      UPDATE web_push_setup_reminder_runs
      SET status = ?, sent_count = ?, failed_count = ?, updated_at = datetime('now', '+9 hours')
      WHERE id = ?
    `).bind(runStatus, result.sent, result.failed, runId).run();
  }

  return { due: true, date: alertDate, recipients: recipientCount, sent, failed, missing };
}
