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
