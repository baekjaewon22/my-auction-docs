import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const notifyMode = args.includes('--notify');
const dryRun = args.includes('--dry-run');
const allSessions = args.includes('--all');
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : '';
};
const payloadFile = valueAfter('--payload-file');
const notificationPayload = (() => {
  const raw = [...args].reverse().find((arg) => String(arg).trim().startsWith('{'));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
})();
const notifiedSessionId = String(
  notificationPayload?.['thread-id']
  || notificationPayload?.thread_id
  || notificationPayload?.session_id
  || notificationPayload?.sessionId
  || '',
).trim();

const endpoint = valueAfter('--endpoint') || process.env.MY_DOCS_CODEX_ENDPOINT || 'https://my-docs.kr/api/developer-settings/codex-conversations';
const workspaceRoot = path.resolve(valueAfter('--workspace') || process.env.MY_DOCS_CODEX_WORKSPACE || process.cwd());
const sessionsRoot = process.env.CODEX_HOME
  ? path.join(process.env.CODEX_HOME, 'sessions')
  : path.join(homedir(), '.codex', 'sessions');
const tokenPath = process.env.MY_DOCS_CODEX_TOKEN_FILE || path.join(
  process.env.LOCALAPPDATA || path.join(homedir(), 'AppData', 'Local'),
  'my-auction-docs',
  'codex-sync-token',
);
const syncStateRoot = process.env.MY_DOCS_CODEX_STATE_DIR || path.join(
  process.env.LOCALAPPDATA || path.join(homedir(), 'AppData', 'Local'),
  'my-auction-docs',
);
const syncLogPath = path.join(syncStateRoot, 'codex-sync.log');
const syncStatusPath = path.join(syncStateRoot, 'codex-sync-status.json');

function comparablePath(value) {
  const normalized = path.resolve(String(value || '')).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized;
}

async function recordSyncStatus(status, detail = {}) {
  await mkdir(syncStateRoot, { recursive: true });
  const entry = { timestamp: new Date().toISOString(), status, workspace: workspaceRoot, ...detail };
  await writeFile(syncStatusPath, JSON.stringify(entry, null, 2), 'utf8');
  await appendFile(syncLogPath, `${JSON.stringify(entry)}\n`, 'utf8');
}

async function walk(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(fullPath));
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(fullPath);
  }
  return files;
}

function redactText(value) {
  return String(value || '')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/\b(sk|rk|pk)-[A-Za-z0-9_-]{16,}\b/g, '$1-[REDACTED]')
    .replace(/\b(AIza[0-9A-Za-z_-]{20,})\b/g, '[REDACTED_API_KEY]')
    .replace(/\b(gh[pousr]_[A-Za-z0-9_]{20,})\b/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(/\b([A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,})\b/g, '[REDACTED_JWT]')
    .replace(/((?:password|passwd|pwd|api[_-]?key|secret|token)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]');
}

function visibleText(item) {
  if (item?.type !== 'response_item' || item?.payload?.type !== 'message') return null;
  const role = item.payload.role;
  if (role !== 'user' && role !== 'assistant') return null;
  const text = (item.payload.content || [])
    .filter((part) => part?.type === 'input_text' || part?.type === 'output_text')
    .map((part) => String(part.text || ''))
    .join('\n')
    .trim();
  if (!text || (role === 'user' && /^<(?:environment_context|permissions instructions)>/i.test(text))) return null;
  return { role, text: redactText(text) };
}

function parseSession(raw, filePath) {
  const rows = raw.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
  const meta = rows.find((row) => row.type === 'session_meta')?.payload || {};
  const messages = [];
  const seen = new Set();
  for (const row of rows) {
    const visible = visibleText(row);
    if (!visible) continue;
    const fingerprint = createHash('sha256')
      .update(`${row.timestamp || ''}\0${visible.role}\0${visible.text}`)
      .digest('hex').slice(0, 24);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    messages.push({ id: fingerprint, role: visible.role, content: visible.text, created_at: row.timestamp || '' });
  }
  const firstUser = messages.find((message) => message.role === 'user')?.content || 'Codex 대화';
  return {
    source_session_id: String(meta.id || meta.session_id || path.basename(filePath, '.jsonl')),
    title: firstUser.replace(/\s+/g, ' ').slice(0, 120),
    working_directory: String(meta.cwd || ''),
    client_version: String(meta.cli_version || ''),
    started_at: String(meta.timestamp || rows[0]?.timestamp || ''),
    messages,
  };
}

async function main() {
  const explicitSession = valueAfter('--session');
  let files = explicitSession ? [path.resolve(explicitSession)] : await walk(sessionsRoot);
  const sessions = await Promise.all(files.map(async (file) => {
    const [raw, fileStat] = await Promise.all([readFile(file, 'utf8'), stat(file)]);
    return { file, fileStat, session: parseSession(raw, file) };
  }));
  let candidates = explicitSession
    ? sessions
    : sessions.filter((entry) => comparablePath(entry.session.working_directory) === comparablePath(workspaceRoot));
  if (!explicitSession && notifiedSessionId) {
    const matching = candidates.filter((entry) => entry.session.source_session_id === notifiedSessionId
      || path.basename(entry.file).includes(notifiedSessionId));
    if (!matching.length) {
      throw new Error(`알림 세션을 현재 작업 폴더에서 찾을 수 없습니다: ${notifiedSessionId}`);
    }
    candidates = matching;
  }
  candidates.sort((a, b) => b.fileStat.mtimeMs - a.fileStat.mtimeMs);
  candidates = allSessions ? candidates : candidates.slice(0, 1);
  if (!candidates.length) throw new Error(`현재 작업 폴더의 Codex 세션 로그를 찾을 수 없습니다: ${workspaceRoot}`);

  let token = String(process.env.MY_DOCS_CODEX_SYNC_TOKEN || '').trim();
  if (!token && !dryRun && !payloadFile) token = String(await readFile(tokenPath, 'utf8').catch(() => '')).trim();
  if (!token && !dryRun && !payloadFile) throw new Error(`동기화 토큰이 없습니다: ${tokenPath}`);

  let synced = 0;
  for (const { file, session } of candidates) {
    if (!session.messages.length) continue;
    if (payloadFile) {
      await writeFile(path.resolve(payloadFile), JSON.stringify(session), 'utf8');
      if (!notifyMode) console.log(`동기화 payload 생성: ${session.messages.length}개 메시지`);
      continue;
    }
    if (dryRun) {
      console.log(JSON.stringify({ file, ...session, messages: `${session.messages.length} visible messages` }, null, 2));
      continue;
    }
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Codex-Sync-Token': token },
      body: JSON.stringify(session),
    });
    if (!response.ok) throw new Error(`동기화 실패 (${response.status}): ${await response.text()}`);
    const result = await response.json();
    synced += 1;
    if (!notifyMode) console.log(`동기화 완료: ${session.title} (${result.message_count}개 메시지)`);
  }
  if (!dryRun && !payloadFile) {
    await recordSyncStatus('success', { synced_sessions: synced, source_session_id: candidates[0]?.session.source_session_id || '' });
  }
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  await recordSyncStatus('failed', { error: message }).catch(() => {});
  if (!notifyMode) {
    console.error(message);
    process.exitCode = 1;
  }
});
