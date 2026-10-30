import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
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
const sessionsRoot = process.env.CODEX_HOME
  ? path.join(process.env.CODEX_HOME, 'sessions')
  : path.join(homedir(), '.codex', 'sessions');
const tokenPath = process.env.MY_DOCS_CODEX_TOKEN_FILE || path.join(
  process.env.LOCALAPPDATA || path.join(homedir(), 'AppData', 'Local'),
  'my-auction-docs',
  'codex-sync-token',
);

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
  if (!explicitSession && notifiedSessionId) {
    const matchingFile = files.find((file) => path.basename(file).includes(notifiedSessionId));
    if (matchingFile) files = [matchingFile];
  }
  const stats = await Promise.all(files.map(async (file) => ({ file, stat: await import('node:fs/promises').then((fs) => fs.stat(file)) })));
  stats.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
  files = (allSessions ? stats : stats.slice(0, 1)).map((entry) => entry.file);
  if (!files.length) throw new Error(`Codex 세션 로그를 찾을 수 없습니다: ${sessionsRoot}`);

  let token = String(process.env.MY_DOCS_CODEX_SYNC_TOKEN || '').trim();
  if (!token && !dryRun && !payloadFile) token = String(await readFile(tokenPath, 'utf8').catch(() => '')).trim();
  if (!token && !dryRun && !payloadFile) throw new Error(`동기화 토큰이 없습니다: ${tokenPath}`);

  for (const file of files) {
    const session = parseSession(await readFile(file, 'utf8'), file);
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
    if (!notifyMode) console.log(`동기화 완료: ${session.title} (${result.message_count}개 메시지)`);
  }
}

main().catch((error) => {
  if (!notifyMode) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
});
