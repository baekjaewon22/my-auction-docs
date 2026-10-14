import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { canViewExternalMentions, validateMentionBatch, validateMentionDigest } from '../src/shared/external-mentions.ts';

const mention = {
  external_id: 'naver-cafe-1',
  url: 'https://example.com/post/1?utm_source=test',
  canonical_url: 'https://example.com/post/1',
  source_type: 'cafe',
  source_name: '네이버 카페',
  published_at: '2026-10-14T08:30:00+09:00',
  collected_at: '2026-10-14T09:05:00+09:00',
  title: '마이옥션 상담 문의',
  snippet: '마이옥션 상담과 수수료를 묻는 공개 게시물입니다.',
  matched_keywords: ['마이옥션'],
  content_hash: 'sha256:test',
  relevance: { label: 'relevant', score: 0.98 },
  sentiment: { label: 'neutral', confidence: 0.8 },
  risk: { level: 'watch', score: 40 },
};

test('external mention access is limited to master and representative', () => {
  assert.equal(canViewExternalMentions({ role: 'master' }), true);
  assert.equal(canViewExternalMentions({ role: 'ceo' }), true);
  for (const role of ['cc_ref', 'admin', 'director', 'manager', 'member', 'support', 'resigned']) {
    assert.equal(canViewExternalMentions({ role }), false, `${role} must not see external mentions`);
  }
});

test('external mention batch and daily digest validators accept documented payloads', () => {
  assert.deepEqual(validateMentionBatch({
    run: { run_id: 'crawl_20261014_090000', started_at: '2026-10-14T09:00:00+09:00', finished_at: '2026-10-14T09:07:00+09:00', status: 'success', sources: [] },
    mentions: [mention],
  }), []);
  assert.deepEqual(validateMentionDigest({
    report_key: 'myauction_mentions_daily_2026-10-14', report_date: '2026-10-14',
    period: { start: '2026-10-14T00:00:00+09:00', end: '2026-10-14T23:59:59+09:00' },
    summary: { headline: '새로운 외부 언급이 있습니다.' }, stats: {}, urgent_mentions: [],
  }), []);
});

test('external mention validators reject unsafe or incomplete payloads', () => {
  const fields = validateMentionBatch({ run: {}, mentions: [{ ...mention, url: 'javascript:alert(1)', risk: { level: 'urgent' } }] });
  for (const field of ['run.run_id', 'run.started_at', 'run.status', 'mentions.0.url', 'mentions.0.risk']) assert.ok(fields.includes(field), field);
  const digestFields = validateMentionDigest({ report_date: '14-10-2026', summary: {}, stats: [] });
  for (const field of ['report_key', 'report_date', 'period', 'summary', 'stats']) assert.ok(digestFields.includes(field), field);
});

test('external mention migration stores separate scoped hashed keys and monitoring records', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE users (id TEXT PRIMARY KEY)');
  db.exec(readFileSync('d1/migrate-external-mentions.sql', 'utf8'));
  for (const table of ['mention_api_keys', 'mention_api_rate_limits', 'mention_collection_runs', 'external_mentions', 'mention_digests']) {
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table), `${table} missing`);
  }
  const keyColumns = db.prepare("PRAGMA table_info('mention_api_keys')").all() as Array<{ name: string }>;
  assert.ok(keyColumns.some((column) => column.name === 'token_hash'));
  assert.ok(!keyColumns.some((column) => column.name === 'token'));
  db.prepare("INSERT INTO mention_api_keys (id, name, scope, token_prefix, token_hash) VALUES ('k1', 'collector', 'mentions:write', 'mmn_example', 'hash')").run();
  assert.throws(() => db.prepare("INSERT INTO mention_api_keys (id, name, scope, token_prefix, token_hash) VALUES ('k2', 'bad', 'briefings:write', 'mbr_example', 'hash2')").run(), /CHECK constraint failed/);
  db.close();
});

test('external mention API, protected page and hidden navigation are wired together', () => {
  const worker = readFileSync('src/worker/index.ts', 'utf8');
  const route = readFileSync('src/worker/routes/external-mentions.ts', 'utf8');
  const app = readFileSync('src/react-app/App.tsx', 'utf8');
  const layout = readFileSync('src/react-app/components/Layout.tsx', 'utf8');
  const page = readFileSync('src/react-app/pages/ExternalMentions.tsx', 'utf8');
  const keyScript = readFileSync('scripts/issue-mentions-api-key.ps1', 'utf8');
  assert.match(worker, /app\.route\('\/api\/mentions', mentionsRoute\)/);
  assert.match(worker, /app\.route\('\/api\/mention-digests', mentionDigestsRoute\)/);
  assert.match(route, /scope = 'mentions:write'/);
  assert.match(route, /WHERE token_hash = \?/);
  assert.match(route, /requireHumanMaster\(\)/);
  assert.match(route, /validateMentionBatch/);
  assert.match(app, /path="external-mentions"/);
  assert.match(app, /canViewExternalMentions/);
  assert.match(layout, /canViewExternalMentionsPage/);
  assert.match(layout, /마이옥션 외부 언급/);
  assert.match(page, /BRAND MONITORING CENTER/);
  assert.match(page, /noindex,nofollow/);
  assert.match(keyScript, /MYDOCS_MENTIONS_API_KEY/);
  assert.match(keyScript, /dry_run=1/);
  assert.doesNotMatch(keyScript, /Write-Host\s+\$apiKey/);
});
