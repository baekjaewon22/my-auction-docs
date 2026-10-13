const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SITE_RE = /^[a-z][a-z0-9-]{1,49}$/;

export function isBriefingSite(value: unknown): boolean {
  return SITE_RE.test(String(value || ''));
}

export function validateBriefingPayload(body: any): string[] {
  const fields: string[] = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) return ['body'];
  if (!String(body.report_key || '').trim() || String(body.report_key).length > 200) fields.push('report_key');
  if (!isBriefingSite(body.site)) fields.push('site');
  if (!['weekly', 'monthly'].includes(body.type)) fields.push('type');
  if (!DATE_RE.test(String(body.report_date || ''))) fields.push('report_date');
  if (!body.period || !DATE_RE.test(String(body.period.start || '')) || !DATE_RE.test(String(body.period.end || ''))) fields.push('period');
  if (body.compare_period && (!DATE_RE.test(String(body.compare_period.start || '')) || !DATE_RE.test(String(body.compare_period.end || '')))) fields.push('compare_period');
  if (!String(body.title || '').trim() || String(body.title).length > 200) fields.push('title');
  if (!String(body.summary || '').trim() || String(body.summary).length > 500) fields.push('summary');
  if (!body.kpis || typeof body.kpis !== 'object' || Array.isArray(body.kpis)
    || Object.values(body.kpis).some((value) => value !== null && typeof value !== 'number')) fields.push('kpis');
  if (!String(body.content_md || '').trim()) fields.push('content_md');
  for (const key of ['highlights', 'warnings', 'checks', 'todos', 'reels', 'channels', 'devices', 'audience', 'corrections', 'notes']) {
    if (body[key] !== undefined && !Array.isArray(body[key])) fields.push(key);
  }
  if (body.landing !== undefined && (body.landing === null || typeof body.landing !== 'object')) fields.push('landing');
  if (body.html !== undefined && body.html !== null && typeof body.html !== 'string') fields.push('html');
  return [...new Set(fields)];
}
