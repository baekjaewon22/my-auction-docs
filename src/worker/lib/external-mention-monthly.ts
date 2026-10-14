type MentionRow = {
  source_type?: string;
  published_at?: string | null;
  collected_at?: string;
  matched_keywords?: string;
  sentiment?: string;
  risk?: string;
  topics?: string;
  workflow_status?: string;
};

export type MentionMonthlySummary = {
  id: string;
  month: string;
  period_start: string;
  period_end: string;
  stats: Record<string, number>;
  source_breakdown: Array<{ key: string; value: number; share: number }>;
  daily_trend: Array<{ date: string; value: number; risk: number }>;
  sentiment_breakdown: Array<{ key: string; value: number; share: number }>;
  risk_breakdown: Array<{ key: string; value: number; share: number }>;
  top_topics: Array<{ key: string; label: string; count: number }>;
  repeated_issues: Array<{ key: string; label: string; count: number }>;
  discovered_keywords: Array<{ key: string; count: number }>;
  workflow_breakdown: Array<{ key: string; value: number; share: number }>;
  extra: Record<string, unknown>;
  generated_at: string;
};

function parseJson(value: string | undefined, fallback: any) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

function monthBounds(month: string) {
  const [year, value] = month.split('-').map(Number);
  const end = new Date(Date.UTC(year, value, 0)).toISOString().slice(0, 10);
  return { start: `${month}-01`, end };
}

export function previousMonth(month: string) {
  const [year, value] = month.split('-').map(Number);
  return new Date(Date.UTC(year, value - 2, 1)).toISOString().slice(0, 7);
}

export function isMonth(value: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function breakdown(values: string[], total: number) {
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(value || 'unknown', (counts.get(value || 'unknown') || 0) + 1));
  return [...counts.entries()].map(([key, value]) => ({ key, value, share: total ? value / total : 0 })).sort((a, b) => b.value - a.value);
}

function extractLabels(value: string | undefined) {
  const parsed = parseJson(value, []);
  return Array.isArray(parsed) ? parsed.map((item) => typeof item === 'string' ? item : String(item?.label || item?.key || '')).filter(Boolean) : [];
}

export function summarizeMentionMonth(rows: MentionRow[], previousRows: MentionRow[], month: string): MentionMonthlySummary {
  const { start, end } = monthBounds(month);
  const total = rows.length;
  const sentiments = rows.map((row) => String(parseJson(row.sentiment, {}).label || 'unknown'));
  const risks = rows.map((row) => String(parseJson(row.risk, {}).level || 'normal'));
  const workflows = rows.map((row) => row.workflow_status || 'unreviewed');
  const topicCounts = new Map<string, number>();
  const keywordCounts = new Map<string, number>();
  const previousKeywords = new Set(previousRows.flatMap((row) => extractLabels(row.matched_keywords)));
  rows.forEach((row) => {
    extractLabels(row.topics).forEach((label) => topicCounts.set(label, (topicCounts.get(label) || 0) + 1));
    extractLabels(row.matched_keywords).forEach((label) => keywordCounts.set(label, (keywordCounts.get(label) || 0) + 1));
  });
  const topicList = [...topicCounts.entries()].map(([key, count]) => ({ key, label: key, count })).sort((a, b) => b.count - a.count);
  const days = new Map<string, { value: number; risk: number }>();
  rows.forEach((row) => {
    const date = String(row.published_at || row.collected_at || '').slice(0, 10);
    if (!date) return;
    const item = days.get(date) || { value: 0, risk: 0 };
    item.value += 1;
    if (['critical', 'high', 'watch'].includes(String(parseJson(row.risk, {}).level || ''))) item.risk += 1;
    days.set(date, item);
  });
  const resolved = workflows.filter((value) => value === 'resolved').length;
  const actionTotal = workflows.filter((value) => ['action_required', 'in_progress', 'resolved'].includes(value)).length;
  const highRisk = risks.filter((value) => ['critical', 'high', 'watch'].includes(value)).length;
  return {
    id: `mentions-${month}`,
    month,
    period_start: start,
    period_end: end,
    stats: {
      unique_mentions: total,
      previous_mentions: previousRows.length,
      month_over_month: previousRows.length ? (total - previousRows.length) / previousRows.length : 0,
      positive: sentiments.filter((value) => value === 'positive').length,
      negative: sentiments.filter((value) => value === 'negative').length,
      risk_mentions: highRisk,
      action_total: actionTotal,
      resolved,
      response_rate: actionTotal ? resolved / actionTotal : 0,
    },
    source_breakdown: breakdown(rows.map((row) => row.source_type || 'other'), total),
    daily_trend: [...days.entries()].map(([date, value]) => ({ date, ...value })).sort((a, b) => a.date.localeCompare(b.date)),
    sentiment_breakdown: breakdown(sentiments, total),
    risk_breakdown: breakdown(risks, total),
    top_topics: topicList.slice(0, 10),
    repeated_issues: topicList.filter((item) => item.count >= 2).slice(0, 10),
    discovered_keywords: [...keywordCounts.entries()]
      .filter(([key]) => key !== '마이옥션' && !previousKeywords.has(key))
      .map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count).slice(0, 20),
    workflow_breakdown: breakdown(workflows, total),
    extra: {},
    generated_at: new Date().toISOString(),
  };
}

async function rowsForMonth(db: D1Database, month: string): Promise<MentionRow[]> {
  const result = await db.prepare(`
    SELECT source_type, published_at, collected_at, matched_keywords, sentiment, risk, topics, workflow_status
    FROM external_mentions
    WHERE excluded = 0 AND substr(COALESCE(published_at, collected_at), 1, 7) = ?
  `).bind(month).all<MentionRow>();
  return result.results || [];
}

export async function buildMentionMonthlySummary(db: D1Database, month: string, persist = false) {
  if (!isMonth(month)) throw new Error('invalid_month');
  const summary = summarizeMentionMonth(await rowsForMonth(db, month), await rowsForMonth(db, previousMonth(month)), month);
  if (persist) {
    await db.prepare(`
      INSERT INTO mention_monthly_summaries (
        id, month, period_start, period_end, stats, source_breakdown, daily_trend,
        sentiment_breakdown, risk_breakdown, top_topics, repeated_issues, discovered_keywords,
        workflow_breakdown, extra, generated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(month) DO UPDATE SET
        period_start = excluded.period_start, period_end = excluded.period_end, stats = excluded.stats,
        source_breakdown = excluded.source_breakdown, daily_trend = excluded.daily_trend,
        sentiment_breakdown = excluded.sentiment_breakdown, risk_breakdown = excluded.risk_breakdown,
        top_topics = excluded.top_topics, repeated_issues = excluded.repeated_issues,
        discovered_keywords = excluded.discovered_keywords, workflow_breakdown = excluded.workflow_breakdown,
        extra = excluded.extra, generated_at = excluded.generated_at, updated_at = datetime('now')
    `).bind(
      summary.id, summary.month, summary.period_start, summary.period_end, JSON.stringify(summary.stats),
      JSON.stringify(summary.source_breakdown), JSON.stringify(summary.daily_trend), JSON.stringify(summary.sentiment_breakdown),
      JSON.stringify(summary.risk_breakdown), JSON.stringify(summary.top_topics), JSON.stringify(summary.repeated_issues),
      JSON.stringify(summary.discovered_keywords), JSON.stringify(summary.workflow_breakdown), JSON.stringify(summary.extra), summary.generated_at,
    ).run();
  }
  return summary;
}

export async function runPreviousMonthMentionAggregation(env: { DB: D1Database }, scheduledAt = new Date()) {
  const kst = new Date(scheduledAt.getTime() + 9 * 60 * 60 * 1000);
  const currentMonth = kst.toISOString().slice(0, 7);
  return buildMentionMonthlySummary(env.DB, previousMonth(currentMonth), true);
}
