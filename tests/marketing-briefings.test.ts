import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Database from 'better-sqlite3';
import { validateBriefingPayload } from '../src/shared/marketing-briefing.ts';
import { canViewMarketingBriefings } from '../src/shared/marketing-briefing-access.ts';

const validPayload = {
  report_key: 'myauction-weekly-2026-10-12',
  site: 'myauction',
  type: 'weekly',
  report_date: '2026-10-12',
  period: { start: '2026-10-05', end: '2026-10-11' },
  title: '마이옥션 주간 마케팅 점검 2026-10-12',
  summary: '일평균 가입과 채널 흐름을 점검했습니다.',
  kpis: { signups_per_day: 254, direct_share: 0.832, optional: null },
  content_md: '# 브리핑\n\n안전한 본문',
};

test('marketing briefing payload validation accepts the documented flexible KPI schema', () => {
  assert.deepEqual(validateBriefingPayload(validPayload), []);
  assert.deepEqual(validateBriefingPayload({
    ...validPayload,
    devices: [{ device: 'desktop', sessions: 10 }],
    landing: { desktop_signups: 7, mobile_web_signups: 3 },
    audience: [{ user_type: 'new', users: 5 }],
    corrections: ['10/11 데이터 보정 대기'],
    custom_future_field: { enabled: true },
  }), []);
});

test('marketing briefing payload validation reports bad fields', () => {
  const fields = validateBriefingPayload({ ...validPayload, site: 'MY Auction', type: 'daily', kpis: { bad: '1' }, content_md: '' });
  assert.deepEqual(fields.sort(), ['content_md', 'kpis', 'site', 'type']);
});

test('briefing migration enforces one row per report_key and creates scoped hashed keys', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE users (id TEXT PRIMARY KEY)');
  db.exec(readFileSync('d1/migrate-marketing-briefings.sql', 'utf8'));
  const insert = db.prepare(`
    INSERT INTO briefings (id, report_key, site, type, report_date, period_start, period_end, title, summary, kpis, content_md)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insert.run('one', validPayload.report_key, validPayload.site, validPayload.type, validPayload.report_date,
    validPayload.period.start, validPayload.period.end, validPayload.title, validPayload.summary,
    JSON.stringify(validPayload.kpis), validPayload.content_md);
  assert.throws(() => insert.run('two', validPayload.report_key, validPayload.site, validPayload.type, validPayload.report_date,
    validPayload.period.start, validPayload.period.end, validPayload.title, validPayload.summary,
    JSON.stringify(validPayload.kpis), validPayload.content_md), /UNIQUE constraint failed/);
  const keyColumns = db.prepare("PRAGMA table_info('briefing_api_keys')").all() as Array<{ name: string }>;
  assert.ok(keyColumns.some((column) => column.name === 'token_hash'));
  assert.ok(!keyColumns.some((column) => column.name === 'token'));
  const briefingColumns = db.prepare("PRAGMA table_info('briefings')").all() as Array<{ name: string }>;
  for (const name of ['devices', 'landing', 'audience', 'corrections', 'extra']) {
    assert.ok(briefingColumns.some((column) => column.name === name), `${name} column missing`);
  }
  db.close();
});

test('briefing UI renders markdown as React text and monthly HTML only in a sandboxed iframe', () => {
  const page = readFileSync('src/react-app/pages/MarketingBriefings.tsx', 'utf8');
  assert.doesNotMatch(page, /dangerouslySetInnerHTML/);
  assert.match(page, /<iframe[^>]+sandbox=""[^>]+srcDoc=/);
  assert.match(page, /noindex, nofollow/);
  assert.match(page, /PC·모바일웹·앱웹뷰 가입/);
  assert.match(page, /신규·재방문/);
});

test('briefing API is mounted and navigation is in the management section', () => {
  const worker = readFileSync('src/worker/index.ts', 'utf8');
  const layout = readFileSync('src/react-app/components/Layout.tsx', 'utf8');
  const app = readFileSync('src/react-app/App.tsx', 'utf8');
  const route = readFileSync('src/worker/routes/briefings.ts', 'utf8');
  assert.match(worker, /app\.route\('\/api\/briefings', briefingsRoute\)/);
  assert.match(layout, /nav-label">관리<[\s\S]*?to="\/briefings"/);
  assert.match(layout, /canViewMarketingBriefingsPage\s*&&/);
  assert.equal((app.match(/<MarketingBriefingsRoute><MarketingBriefings \/><\/MarketingBriefingsRoute>/g) || []).length, 3);
  assert.match(route, /user\.auth_type !== 'user'/);
  assert.match(route, /!canViewMarketingBriefings\(user\)/);
});

test('marketing briefing page is limited to representative and internal top administrator roles', () => {
  assert.equal(canViewMarketingBriefings({ role: 'master' }), true);
  assert.equal(canViewMarketingBriefings({ role: 'ceo' }), true);
  for (const role of ['cc_ref', 'admin', 'director', 'manager', 'accountant', 'accountant_asst', 'member', 'support', 'resigned']) {
    assert.equal(canViewMarketingBriefings({ role }), false, `${role} must not view marketing briefings`);
  }
  assert.equal(canViewMarketingBriefings(null), false);
});
