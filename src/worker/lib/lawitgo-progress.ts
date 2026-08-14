const LAWITGO_BASE_URL = 'https://www.lawitgo.com/api/integrations/mydocs/progress';
const MAX_UI_HTML_LENGTH = 1_000_000;
const MAX_UI_CSS_LENGTH = 300_000;

export type LawitgoProgressListItem = {
  id: string;
  title: string;
  caseNumber: string;
  court: string;
  status: string;
  statusLabel: string;
  stage: string;
  stageLabel: string;
  progressSummary: string;
  updatedAt: string;
  consultantName: string;
  clientName: string;
  receivedAt: string;
  caseType: string;
};

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function text(value: unknown, maxLength = 300): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).trim().slice(0, maxLength)
    : '';
}

function first(source: JsonRecord, keys: string[], maxLength = 300): string {
  for (const key of keys) {
    const value = text(source[key], maxLength);
    if (value) return value;
  }
  return '';
}

export function normalizeLawitgoProgressItem(value: unknown): LawitgoProgressListItem | null {
  const source = record(value);
  const id = first(source, ['id', 'progress_id', 'progressId'], 120);
  if (!id) return null;
  const caseNumber = first(source, ['case_number', 'caseNumber'], 100);
  return {
    id,
    title: first(source, ['title', 'case_title', 'caseTitle', 'property_name', 'propertyName'], 200) || caseNumber || '사건 진행사항',
    caseNumber,
    court: first(source, ['court', 'court_name', 'courtName'], 100),
    status: first(source, ['status'], 50),
    statusLabel: first(source, ['status_label', 'statusLabel'], 80),
    stage: first(source, ['stage', 'progress_stage', 'progressStage'], 80),
    stageLabel: first(source, ['stage_label', 'stageLabel', 'progress_stage_label', 'progressStageLabel'], 100),
    progressSummary: first(source, ['progress_summary', 'progressSummary', 'summary', 'latest_progress', 'latestProgress'], 500),
    updatedAt: first(source, ['updated_at', 'updatedAt', 'last_progress_at', 'lastProgressAt'], 50),
    consultantName: '',
    clientName: first(source, ['client_name', 'clientName', 'customer_name', 'customerName', 'applicant_name', 'applicantName'], 100),
    receivedAt: first(source, ['received_at', 'receivedAt', 'received_date', 'receivedDate', 'created_at', 'createdAt'], 50),
    caseType: first(source, ['case_type', 'caseType', 'service_type', 'serviceType', 'category'], 80),
  };
}

export function normalizeLawitgoProgressList(payload: unknown): { items: LawitgoProgressListItem[] } {
  const root = record(payload);
  const candidates = Array.isArray(payload)
    ? payload
    : Array.isArray(root.items)
      ? root.items
      : Array.isArray(root.data)
        ? root.data
        : Array.isArray(record(root.data).items)
          ? record(root.data).items as unknown[]
          : [];
  return { items: candidates.map(normalizeLawitgoProgressItem).filter((item): item is LawitgoProgressListItem => Boolean(item)) };
}

export function normalizeLawitgoProgressDetail(payload: unknown): {
  item: LawitgoProgressListItem;
  ui: { html: string; css: string };
} | null {
  const root = record(payload);
  const itemSource = Object.keys(record(root.item)).length > 0 ? record(root.item) : Object.keys(record(root.data)).length > 0 ? record(root.data) : root;
  const item = normalizeLawitgoProgressItem(itemSource);
  if (!item) return null;
  const ui = record(itemSource.ui);
  const html = text(ui.html, MAX_UI_HTML_LENGTH);
  const css = text(ui.css, MAX_UI_CSS_LENGTH);
  if (!html) return null;
  return { item, ui: { html, css } };
}

export function lawitgoProgressUrl(id?: string): string {
  if (!id) return `${LAWITGO_BASE_URL}?status=active&limit=50`;
  return `${LAWITGO_BASE_URL}/${encodeURIComponent(id)}?includeUi=true`;
}

export function lawitgoProgressRenderUrl(id: string): string {
  return `${LAWITGO_BASE_URL}/${encodeURIComponent(id)}/render`;
}

export function lawitgoRequestHeaders(apiKey: string, consultantId: string, accept = 'application/json'): Headers {
  const headers = new Headers();
  headers.set('Accept', accept);
  headers.set('X-API-Key', apiKey);
  headers.set('X-MyDocs-Consultant-Id', consultantId);
  return headers;
}

export function isSafeLawitgoProgressId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,120}$/.test(id);
}
