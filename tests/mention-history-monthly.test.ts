import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { previousMonth, summarizeMentionMonth } from '../src/worker/lib/external-mention-monthly.ts';

test('monthly mention summary calculates totals, changes, risks and new keywords', () => {
  const rows = [
    { source_type: 'news', published_at: '2026-10-02T10:00:00+09:00', matched_keywords: '["마이옥션","수수료"]', sentiment: '{"label":"negative"}', risk: '{"level":"high"}', topics: '["수수료"]', workflow_status: 'resolved' },
    { source_type: 'blog', published_at: '2026-10-03T10:00:00+09:00', matched_keywords: '["마이옥션","신규"]', sentiment: '{"label":"positive"}', risk: '{"level":"normal"}', topics: '["수수료"]', workflow_status: 'action_required' },
  ];
  const previous = [{ source_type: 'news', published_at: '2026-09-01', matched_keywords: '["마이옥션","기존"]', sentiment: '{"label":"neutral"}', risk: '{"level":"normal"}', topics: '[]', workflow_status: 'unreviewed' }];
  const result = summarizeMentionMonth(rows, previous, '2026-10');
  assert.equal(result.stats.unique_mentions, 2);
  assert.equal(result.stats.month_over_month, 1);
  assert.equal(result.stats.risk_mentions, 1);
  assert.equal(result.stats.response_rate, 0.5);
  assert.deepEqual(result.discovered_keywords.map((item) => item.key).sort(), ['수수료', '신규']);
  assert.equal(result.repeated_issues[0].label, '수수료');
  assert.equal(result.daily_trend.length, 2);
});

test('previous month handles January boundaries', () => {
  assert.equal(previousMonth('2026-01'), '2025-12');
  assert.equal(previousMonth('2026-10'), '2026-09');
});

test('history migration and route wiring are present', () => {
  const migration = readFileSync('d1/migrate-briefing-history-monthly-mentions.sql', 'utf8');
  const briefings = readFileSync('src/worker/routes/briefings.ts', 'utf8');
  const mentions = readFileSync('src/worker/routes/external-mentions.ts', 'utf8');
  const worker = readFileSync('src/worker/index.ts', 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS briefing_revisions/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS mention_digest_revisions/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS mention_monthly_summaries/);
  assert.match(briefings, /briefings\.get\('\/:id\/revisions'/);
  assert.match(briefings, /typeClause/);
  assert.match(mentions, /mentionDigestsRoute\.get\('\/monthly'/);
  assert.match(mentions, /mention_digest_revisions/);
  assert.match(worker, /runPreviousMonthMentionAggregation/);
});
