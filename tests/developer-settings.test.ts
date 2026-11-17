import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { normalizeCodexMessages, redactCodexLogText } from '../src/worker/routes/developer-settings.ts';

test('Codex transcript redacts common secret formats', () => {
  const redacted = redactCodexLogText('password=hunter2 Bearer abc.def.ghi sk-abcdefghijklmnopqrstuvwxyz');
  assert.doesNotMatch(redacted, /hunter2|abc\.def\.ghi|abcdefghijklmnopqrstuvwxyz/);
  assert.match(redacted, /\[REDACTED\]/);
});

test('Codex transcript keeps only visible user and assistant messages', () => {
  const messages = normalizeCodexMessages([
    { id: '1', role: 'developer', content: 'hidden instructions' },
    { id: '2', role: 'user', content: '질문' },
    { id: '3', role: 'assistant', content: '답변' },
    { id: '4', role: 'tool', content: 'tool output' },
  ]);
  assert.deepEqual(messages.map((message) => message.role), ['user', 'assistant']);
  assert.deepEqual(messages.map((message) => message.content), ['질문', '답변']);
});

test('developer settings is hidden behind master-only UI gates', () => {
  const layout = readFileSync(new URL('../src/react-app/components/Layout.tsx', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../src/react-app/App.tsx', import.meta.url), 'utf8');
  assert.match(layout, /role === 'master'[\s\S]*?to="\/developer-settings"/);
  assert.match(app, /path="developer-settings"[\s\S]*?<MasterRoute>[\s\S]*?<DeveloperSettings \/>/);
});

test('developer settings API hides unauthorized access with 404', () => {
  const route = readFileSync(new URL('../src/worker/routes/developer-settings.ts', import.meta.url), 'utf8');
  assert.match(route, /requireHumanMasterOrNotFound/);
  assert.match(route, /return c\.json\(\{ error: 'Not found\.' \}, 404\)/);
});

test('Codex conversation management exposes status, retention, and delete routes', () => {
  const route = readFileSync(new URL('../src/worker/routes/developer-settings.ts', import.meta.url), 'utf8');
  assert.match(route, /developerSettings\.get\('\/codex-sync-status'/);
  assert.match(route, /developerSettings\.put\('\/codex-sync-settings'/);
  assert.match(route, /developerSettings\.delete\('\/codex-conversations\/:id'/);
  assert.match(route, /retentionDays < 30 \|\| retentionDays > 3650/);
  assert.match(route, /cleanupExpiredCodexConversations/);
});

test('Codex sync is scoped to the current workspace and records failures locally', () => {
  const script = readFileSync(new URL('../scripts/sync-codex-conversations.mjs', import.meta.url), 'utf8');
  assert.match(script, /MY_DOCS_CODEX_WORKSPACE \|\| process\.cwd\(\)/);
  assert.match(script, /comparablePath\(entry\.session\.working_directory\) === comparablePath\(workspaceRoot\)/);
  assert.match(script, /codex-sync-status\.json/);
  assert.match(script, /recordSyncStatus\('failed'/);
  assert.match(script, /알림 세션을 현재 작업 폴더에서 찾을 수 없습니다/);
});

test('developer settings UI supports sync status, retention, and deletion', () => {
  const page = readFileSync(new URL('../src/react-app/pages/DeveloperSettings.tsx', import.meta.url), 'utf8');
  assert.match(page, /codexSyncStatus\(\)/);
  assert.match(page, /updateCodexSyncSettings\(days\)/);
  assert.match(page, /deleteCodexConversation\(detail\.id\)/);
  assert.match(page, /npm run codex:sync/);
});
