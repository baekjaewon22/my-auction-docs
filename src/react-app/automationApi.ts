const AUTOMATION_API_BASE = (import.meta.env.VITE_AUTOMATION_API_BASE || '/api').replace(/\/$/, '');
const AUTOMATION_WS_BASE = (import.meta.env.VITE_AUTOMATION_WS_BASE || '').replace(/\/$/, '');

function getToken(): string | null {
  return localStorage.getItem('token');
}

function authHeaders(extra: HeadersInit = {}): Record<string, string> {
  const headers: Record<string, string> = { ...(extra as Record<string, string>) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export type OutputType = 'auction_report' | 'rights_certificate';
export type DownloadFormat = 'pptx' | 'pdf' | 'zip';

export interface ReportStartRequest {
  output_type: OutputType;
  url: string;
  remember_login: boolean;
  requester_permission?: 'basic' | 'special';
}

export interface RightsBatchRequest {
  output_type: 'rights_certificate';
  urls: string[];
  remember_login: boolean;
  requester_permission?: 'basic' | 'special';
  start_at?: string;
  interval_seconds: number;
}

export interface ProgressUpdate {
  step: number;
  total_steps: number;
  title: string;
  message: string;
  status: 'running' | 'completed' | 'error';
  percent: number;
}

export interface DownloadHistoryItem {
  id: string;
  task_id: string;
  output_type: OutputType;
  title: string;
  file_name: string;
  created_at: string;
  message: string;
  exists: boolean;
  formats: DownloadFormat[];
}

async function automationRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${AUTOMATION_API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(options.headers || {}),
    },
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    if (!res.ok) throw new Error('자동화 서비스 응답을 처리하지 못했습니다.');
  }
  if (!res.ok) throw new Error(data?.detail || data?.error || '자동화 서비스 요청에 실패했습니다.');
  return data as T;
}

async function downloadFile(path: string) {
  const res = await fetch(`${AUTOMATION_API_BASE}${path}`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    let message = '다운로드에 실패했습니다.';
    try {
      const data = await res.json();
      message = data?.detail || data?.error || message;
    } catch { /* ignore */ }
    throw new Error(message);
  }
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename\*=UTF-8''([^;]+)|filename="?([^"]+)"?/i);
  const filename = decodeURIComponent(match?.[1] || match?.[2] || 'download');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const automationApi = {
  startReport: (body: ReportStartRequest) =>
    automationRequest<{ task_id: string }>('/report/start', { method: 'POST', body: JSON.stringify(body) }),
  startBatch: (body: RightsBatchRequest) =>
    automationRequest<{ task_id: string }>('/report/start-batch', { method: 'POST', body: JSON.stringify(body) }),
  progress: (taskId: string) =>
    automationRequest<{ task_id: string; updates: ProgressUpdate[] }>(`/report/progress/${taskId}`),
  progressWsUrl: (taskId: string) => {
    if (AUTOMATION_WS_BASE) return `${AUTOMATION_WS_BASE}/ws/progress/${taskId}`;
    if (AUTOMATION_API_BASE.startsWith('http')) {
      return `${AUTOMATION_API_BASE.replace(/^http/i, 'ws')}/ws/progress/${taskId}`;
    }
    if (window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost') {
      return `ws://127.0.0.1:8001/api/ws/progress/${taskId}`;
    }
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${scheme}://${window.location.host}${AUTOMATION_API_BASE}/ws/progress/${taskId}`;
  },
  history: () =>
    automationRequest<{ items: DownloadHistoryItem[]; limit: number }>('/report/download-history'),
  downloadUrl: (taskId: string, format: DownloadFormat) =>
    `${AUTOMATION_API_BASE}/report/download/${taskId}?format=${format}`,
  historyDownloadUrl: (historyId: string, format: DownloadFormat) =>
    `${AUTOMATION_API_BASE}/report/download-history/${historyId}?format=${format}`,
  downloadFile: (taskId: string, format: DownloadFormat) =>
    downloadFile(`/report/download/${taskId}?format=${format}`),
  downloadHistoryFile: (historyId: string, format: DownloadFormat) =>
    downloadFile(`/report/download-history/${historyId}?format=${format}`),
};
