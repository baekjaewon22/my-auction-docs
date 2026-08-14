import { AUTOMATION_AGENT_VERSION } from '../shared/automation-agent-version';

const AUTOMATION_API_BASE = (import.meta.env.VITE_AUTOMATION_API_BASE || '/api').replace(/\/$/, '');
const AUTOMATION_WS_BASE = (import.meta.env.VITE_AUTOMATION_WS_BASE || '').replace(/\/$/, '');
const AUTOMATION_AGENT_INSTALLER_URL = import.meta.env.VITE_AUTOMATION_AGENT_INSTALLER_URL || '/api/report/agent-installer';
export const REQUIRED_AUTOMATION_AGENT_VERSION = import.meta.env.VITE_REQUIRED_AUTOMATION_AGENT_VERSION || AUTOMATION_AGENT_VERSION;

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
  planner_snapshots?: Array<{
    id: string;
    calculator: string;
    label: string;
    captured_at: string;
    message: unknown;
    image_data_url?: string;
    include?: boolean;
  }>;
  auction_references?: {
    checklist?: Array<{
      id: string;
      type: 'checklist';
      category?: string;
      title: string;
      content: string;
      source?: 'default' | 'custom';
    }>;
  };
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

export interface AutomationDiagnostic {
  key: string;
  label: string;
  status: 'ok' | 'warning' | 'error' | 'skipped';
  message: string;
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
  diagnostics?: AutomationDiagnostic[];
}

export interface AutomationAgentStatus {
  ok: boolean;
  updateRequired?: boolean;
  version?: string;
  requiredVersion?: string;
  latestVersionVerified?: boolean;
  versionCheckIssue?: 'authentication_required' | 'server_unavailable' | 'invalid_response';
  checkedAt?: string;
  title?: string;
  dependencyReady?: boolean;
  dependencyMessage?: string;
  onlineSlots?: number;
  connectionIssue?: 'permission_denied' | 'browser_blocked' | 'not_connected';
  error?: string;
}

export async function checkAutomationAgent(): Promise<AutomationAgentStatus> {
  let requiredVersion = REQUIRED_AUTOMATION_AGENT_VERSION;
  let latestVersionVerified = false;
  let versionCheckIssue: AutomationAgentStatus['versionCheckIssue'];
  const checkedAt = new Date().toISOString();

  try {
    const latestRes = await fetch(`/api/report/agent-version?_=${Date.now()}`, {
      method: 'GET',
      cache: 'no-store',
      headers: authHeaders({
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      }),
    });
    if (latestRes.ok) {
      const latestData = await latestRes.json().catch(() => ({}));
      const serverVersion = String(latestData?.version || '').trim();
      if (serverVersion) {
        requiredVersion = serverVersion;
        latestVersionVerified = true;
      } else {
        versionCheckIssue = 'invalid_response';
      }
    } else if (latestRes.status === 401 || latestRes.status === 403) {
      versionCheckIssue = 'authentication_required';
    } else {
      versionCheckIssue = 'server_unavailable';
    }
  } catch {
    // 서버 조회 실패 시 현재 웹에 포함된 기준 버전으로 계속 확인한다.
    versionCheckIssue = 'server_unavailable';
  }

  try {
    const res = await fetch(`${AUTOMATION_API_BASE}/report/central-agent-status`, {
      method: 'GET',
      cache: 'no-store',
      headers: authHeaders(),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json().catch(() => ({}));
    const version = String(data?.agent?.version || '');
    const online = Boolean(data?.online);
    const updateRequired = online && version !== requiredVersion;
    return {
      ok: online,
      updateRequired,
      version,
      requiredVersion,
      latestVersionVerified,
      versionCheckIssue,
      checkedAt,
      title: `회사 자동화 서버 (${Math.max(1, Number(data?.online_agents || 0))}개 슬롯)`,
      onlineSlots: Number(data?.online_agents || 0),
      dependencyReady: online,
      dependencyMessage: online ? undefined : '회사 자동화 서버가 오프라인입니다.',
    };
  } catch (err: any) {
    return {
      ok: false,
      requiredVersion,
      latestVersionVerified,
      versionCheckIssue,
      checkedAt,
      connectionIssue: 'not_connected',
      error: err?.message || 'not_connected',
    };
  }
}

async function automationRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const init = {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(options.headers || {}),
    },
  };
  const res = await fetch(`${AUTOMATION_API_BASE}${path}`, init);

  let data: any = null;
  try {
    data = await res.json();
  } catch {
    if (!res.ok) throw new Error('자동화 서비스 응답을 처리하지 못했습니다.');
  }
  if (!res.ok) throw new Error(data?.detail || data?.error || '자동화 서비스 요청에 실패했습니다.');
  return data as T;
}

function defaultReportFilename(format: DownloadFormat): string {
  if (format === 'pdf') return '브리핑자료.pdf';
  if (format === 'zip') return '권리분석_보증서.zip';
  return '브리핑자료.pptx';
}

function reportFilenameForFormat(fileName: string | undefined, format: DownloadFormat): string {
  if (!fileName) return defaultReportFilename(format);
  const extension = format === 'zip' ? '.zip' : format === 'pdf' ? '.pdf' : '.pptx';
  return `${fileName.replace(/\.(pptx|pptm|pdf|zip)$/i, '')}${extension}`;
}

async function downloadFile(path: string, fallbackFilename: string) {
  const init = { headers: authHeaders() };
  const res = await fetch(`${AUTOMATION_API_BASE}${path}`, init);

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
  const extendedMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const fallbackMatch = disposition.match(/filename="?([^";]+)"?/i);
  let filename = fallbackFilename;
  try {
    filename = decodeURIComponent(extendedMatch?.[1] || fallbackMatch?.[1] || fallbackFilename);
  } catch {
    filename = extendedMatch?.[1] || fallbackMatch?.[1] || fallbackFilename;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function downloadAgentInstaller() {
  let fileHandle: any = null;
  const showSaveFilePicker = (window as any).showSaveFilePicker;
  if (typeof showSaveFilePicker === 'function') {
    try {
      fileHandle = await showSaveFilePicker({
        suggestedName: '마이실행기.exe',
        types: [{
          description: 'Windows 설치 프로그램',
          accept: { 'application/vnd.microsoft.portable-executable': ['.exe'] },
        }],
      });
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      throw err;
    }
  }

  const res = await fetch(AUTOMATION_AGENT_INSTALLER_URL, {
    headers: authHeaders(),
    cache: 'no-store',
  });

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error('로그인이 만료되었습니다. 다시 로그인한 뒤 설치관리자를 다운로드해 주세요.');
    }
    let message = '자동화 실행기 설치 파일 다운로드에 실패했습니다.';
    try {
      const data = await res.json();
      message = data?.detail || data?.error || message;
    } catch { /* ignore */ }
    throw new Error(message);
  }

  if (fileHandle) {
    const writable = await fileHandle.createWritable();
    if (res.body) {
      await res.body.pipeTo(writable);
    } else {
      await writable.write(await res.blob());
      await writable.close();
    }
    return;
  }

  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') || '';
  const extendedMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const fallbackMatch = disposition.match(/filename="?([^";]+)"?/i);
  const filename = decodeURIComponent(extendedMatch?.[1] || fallbackMatch?.[1] || '마이실행기.exe');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.exe') ? filename : '마이실행기.exe';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const automationApi = {
  installerUrl: AUTOMATION_AGENT_INSTALLER_URL,
  checkAgent: checkAutomationAgent,
  downloadAgentInstaller,
  startReport: (body: ReportStartRequest) =>
    automationRequest<{ task_id: string; queue_position?: number }>('/report/start', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(body) }),
  startBatch: (body: RightsBatchRequest) =>
    automationRequest<{ task_id: string; queue_position?: number }>('/report/start-batch', { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(body) }),
  progress: (taskId: string) =>
    automationRequest<{ task_id: string; status?: string; queue_position?: number; updates: ProgressUpdate[]; diagnostics?: AutomationDiagnostic[] }>(`/report/progress/${taskId}`),
  progressWsUrl: async (taskId: string) => {
    if (!taskId) return '';
    if (AUTOMATION_WS_BASE) return `${AUTOMATION_WS_BASE}/ws/progress/${taskId}`;
    return '';
  },
  history: () =>
    automationRequest<{ items: DownloadHistoryItem[]; limit: number }>('/report/download-history'),
  downloadUrl: (taskId: string, format: DownloadFormat) =>
    `${AUTOMATION_API_BASE}/report/download/${taskId}?format=${format}`,
  historyDownloadUrl: (historyId: string, format: DownloadFormat) =>
    `${AUTOMATION_API_BASE}/report/download-history/${historyId}?format=${format}`,
  downloadFile: (taskId: string, format: DownloadFormat) =>
    downloadFile(`/report/download/${taskId}?format=${format}`, defaultReportFilename(format)),
  downloadHistoryFile: (historyId: string, format: DownloadFormat, fileName?: string) =>
    downloadFile(`/report/download-history/${historyId}?format=${format}`, reportFilenameForFormat(fileName, format)),
};
