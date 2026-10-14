export const MENTION_SOURCE_TYPES = ['news', 'blog', 'cafe', 'community', 'youtube', 'instagram', 'x', 'facebook', 'other'] as const;
export const MENTION_RELEVANCE_LABELS = ['relevant', 'uncertain', 'irrelevant'] as const;
export const MENTION_SENTIMENT_LABELS = ['positive', 'neutral', 'negative', 'mixed', 'unknown'] as const;
export const MENTION_RISK_LEVELS = ['critical', 'high', 'watch', 'normal', 'unknown'] as const;
export const MENTION_RUN_STATUSES = ['running', 'success', 'partial', 'failed'] as const;

type MentionViewer = { role?: string | null };

export function canViewExternalMentions(user: MentionViewer | null | undefined): boolean {
  return user?.role === 'master' || user?.role === 'ceo';
}

function isObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validDateTime(value: unknown, nullable = false): boolean {
  if (nullable && (value === null || value === '')) return true;
  return typeof value === 'string' && value.length >= 10 && Number.isFinite(Date.parse(value));
}

function validHttpUrl(value: unknown): boolean {
  if (typeof value !== 'string' || value.length > 4000) return false;
  try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
}

export function validateMentionBatch(payload: unknown): string[] {
  const fields: string[] = [];
  if (!isObject(payload)) return ['body'];
  if (!isObject(payload.run)) fields.push('run');
  else {
    if (!String(payload.run.run_id || '').trim()) fields.push('run.run_id');
    if (!validDateTime(payload.run.started_at)) fields.push('run.started_at');
    if (!validDateTime(payload.run.finished_at, true)) fields.push('run.finished_at');
    if (!MENTION_RUN_STATUSES.includes(payload.run.status)) fields.push('run.status');
    if (!Array.isArray(payload.run.sources)) fields.push('run.sources');
  }
  if (!Array.isArray(payload.mentions) || payload.mentions.length > 100) {
    fields.push('mentions');
    return [...new Set(fields)];
  }
  payload.mentions.forEach((mention: unknown, index: number) => {
    const base = `mentions.${index}`;
    if (!isObject(mention)) { fields.push(base); return; }
    for (const key of ['external_id', 'source_name', 'title', 'snippet', 'content_hash']) {
      if (!String(mention[key] || '').trim()) fields.push(`${base}.${key}`);
    }
    if (!validHttpUrl(mention.url)) fields.push(`${base}.url`);
    if (!validHttpUrl(mention.canonical_url)) fields.push(`${base}.canonical_url`);
    if (!MENTION_SOURCE_TYPES.includes(mention.source_type)) fields.push(`${base}.source_type`);
    if (!validDateTime(mention.published_at, true)) fields.push(`${base}.published_at`);
    if (!validDateTime(mention.collected_at)) fields.push(`${base}.collected_at`);
    if (!Array.isArray(mention.matched_keywords)) fields.push(`${base}.matched_keywords`);
    if (!isObject(mention.relevance) || !MENTION_RELEVANCE_LABELS.includes(mention.relevance.label)) fields.push(`${base}.relevance`);
    if (!isObject(mention.sentiment) || !MENTION_SENTIMENT_LABELS.includes(mention.sentiment.label)) fields.push(`${base}.sentiment`);
    if (!isObject(mention.risk) || !MENTION_RISK_LEVELS.includes(mention.risk.level)) fields.push(`${base}.risk`);
  });
  return [...new Set(fields)];
}

export function validateMentionDigest(payload: unknown): string[] {
  const fields: string[] = [];
  if (!isObject(payload)) return ['body'];
  for (const key of ['report_key', 'report_date']) {
    if (!String(payload[key] || '').trim()) fields.push(key);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(payload.report_date || ''))) fields.push('report_date');
  if (!isObject(payload.period) || !validDateTime(payload.period.start) || !validDateTime(payload.period.end)) fields.push('period');
  if (!isObject(payload.summary) || !String(payload.summary.headline || '').trim()) fields.push('summary');
  if (!isObject(payload.stats)) fields.push('stats');
  for (const key of ['urgent_mentions', 'top_topics', 'emerging_issues', 'repeated_issues', 'positive_mentions', 'source_breakdown', 'keyword_breakdown', 'discovered_keywords', 'data_quality']) {
    if (payload[key] !== undefined && !Array.isArray(payload[key])) fields.push(key);
  }
  return [...new Set(fields)];
}
