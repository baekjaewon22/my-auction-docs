const AUTOMATION_API_BASE = (import.meta.env.VITE_AUTOMATION_API_BASE || '/api').replace(/\/$/, '');
const LOCAL_AUTOMATION_API_BASE = (import.meta.env.VITE_LOCAL_AUTOMATION_API_BASE || 'http://127.0.0.1:8001/api').replace(/\/$/, '');
const AUTOMATION_WS_BASE = (import.meta.env.VITE_AUTOMATION_WS_BASE || '').replace(/\/$/, '');
const AUTOMATION_AGENT_INSTALLER_URL = import.meta.env.VITE_AUTOMATION_AGENT_INSTALLER_URL || '/api/report/agent-installer';
export const REQUIRED_AUTOMATION_AGENT_VERSION = import.meta.env.VITE_REQUIRED_AUTOMATION_AGENT_VERSION || '2026.07.16.1';

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
  checkedAt?: string;
  title?: string;
  dependencyReady?: boolean;
  dependencyMessage?: string;
  connectionIssue?: 'permission_denied' | 'browser_blocked' | 'not_connected';
  error?: string;
}

async function getLoopbackPermissionState(): Promise<PermissionState | 'unsupported'> {
  if (typeof navigator === 'undefined' || !navigator.permissions?.query) return 'unsupported';
  try {
    const permission = await navigator.permissions.query(
      { name: 'local-network-access' } as unknown as PermissionDescriptor,
    );
    return permission.state;
  } catch {
    return 'unsupported';
  }
}

function compareVersions(left: string, right: string) {
  const leftParts = String(left || '').match(/\d+/g)?.map(Number) || [];
  const rightParts = String(right || '').match(/\d+/g)?.map(Number) || [];
  const length = Math.max(leftParts.length, rightParts.length);
  for (let i = 0; i < length; i += 1) {
    const a = leftParts[i] || 0;
    const b = rightParts[i] || 0;
    if (a !== b) return a > b ? 1 : -1;
  }
  return 0;
}

export async function checkAutomationAgent(): Promise<AutomationAgentStatus> {
  let requiredVersion = REQUIRED_AUTOMATION_AGENT_VERSION;
  let latestVersionVerified = false;
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
      }
    }
  } catch {
    // 서버 조회 실패 시 현재 웹에 포함된 기준 버전으로 계속 확인한다.
  }

  const loopbackPermission = await getLoopbackPermissionState();
  if (loopbackPermission === 'denied') {
    return {
      ok: false,
      requiredVersion,
      latestVersionVerified,
      checkedAt,
      connectionIssue: 'permission_denied',
      error: 'local_network_access_denied',
    };
  }

  try {
    const res = await fetch(`${LOCAL_AUTOMATION_API_BASE}/health`, {
      method: 'GET',
      mode: 'cors',
      cache: 'no-store',
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json().catch(() => ({}));
    const version = String(data?.version || '').trim();
    const popplerReady = data?.dependencies?.poppler?.ready !== false;
    const updateRequired = !version || compareVersions(version, requiredVersion) < 0 || !popplerReady;
    return {
      ok: true,
      updateRequired,
      version,
      requiredVersion,
      latestVersionVerified,
      checkedAt,
      title: data?.title || 'MyAuction Automation',
      dependencyReady: popplerReady,
      dependencyMessage: popplerReady ? undefined : 'PDF 변환 구성요소가 없거나 손상되었습니다.',
    };
  } catch (err: any) {
    return {
      ok: false,
      requiredVersion,
      latestVersionVerified,
      checkedAt,
      connectionIssue: loopbackPermission === 'unsupported' ? 'not_connected' : 'browser_blocked',
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
  const method = String(options.method || 'GET').toUpperCase();
  const canUseLocalFallback = method === 'GET' && !AUTOMATION_API_BASE.startsWith('http');
  const canUseLocalStartFallback = method === 'POST'
    && !AUTOMATION_API_BASE.startsWith('http')
    && (path === '/report/start' || path === '/report/start-batch');

  let res: Response;
  try {
    res = await fetch(`${AUTOMATION_API_BASE}${path}`, init);
  } catch (err) {
    if (canUseLocalStartFallback) {
      res = await localStartRequest(path, options);
    } else {
      if (!canUseLocalFallback) throw err;
      res = await fetch(`${LOCAL_AUTOMATION_API_BASE}${path}`, init);
    }
  }

  if (canUseLocalFallback && !res.ok) {
    res = await fetch(`${LOCAL_AUTOMATION_API_BASE}${path}`, init);
  }
  if (canUseLocalStartFallback && !res.ok) {
    res = await localStartRequest(path, options);
  }

  let data: any = null;
  try {
    data = await res.json();
  } catch {
    if (!res.ok) throw new Error('자동화 서비스 응답을 처리하지 못했습니다.');
  }
  if (!res.ok) throw new Error(data?.detail || data?.error || '자동화 서비스 요청에 실패했습니다.');
  return data as T;
}

async function localStartRequest(path: string, options: RequestInit = {}) {
  const profileRes = await fetch(`${AUTOMATION_API_BASE}/report/local-profile`, {
    headers: authHeaders(),
  });
  let profile: any = null;
  try {
    profile = await profileRes.json();
  } catch {
    throw new Error('자동화 사용자 정보를 가져오지 못했습니다.');
  }
  if (!profileRes.ok) {
    throw new Error(profile?.detail || profile?.error || '자동화 사용자 정보를 가져오지 못했습니다.');
  }

  let body: any = {};
  try {
    body = JSON.parse(String(options.body || '{}'));
  } catch {
    body = {};
  }

  return fetch(`${LOCAL_AUTOMATION_API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, ...profile }),
  });
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
  let res: Response;
  try {
    res = await fetch(`${AUTOMATION_API_BASE}${path}`, init);
  } catch {
    res = await fetch(`${LOCAL_AUTOMATION_API_BASE}${path}`, init);
  }

  if (!res.ok) {
    res = await fetch(`${LOCAL_AUTOMATION_API_BASE}${path}`, init);
  }

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
  let filename = fallbackFilename;
  try {
    filename = decodeURIComponent(match?.[1] || match?.[2] || fallbackFilename);
  } catch {
    filename = match?.[1] || match?.[2] || fallbackFilename;
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
        suggestedName: 'MyAuctionAutomationAgentSetup.exe',
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
  const match = disposition.match(/filename\*=UTF-8''([^;]+)|filename="?([^"]+)"?/i);
  const filename = decodeURIComponent(match?.[1] || match?.[2] || 'MyAuctionAutomationAgentSetup.exe');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.exe') ? filename : 'MyAuctionAutomationAgentSetup.exe';
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
    automationRequest<{ task_id: string }>('/report/start', { method: 'POST', body: JSON.stringify(body) }),
  startBatch: (body: RightsBatchRequest) =>
    automationRequest<{ task_id: string }>('/report/start-batch', { method: 'POST', body: JSON.stringify(body) }),
  progress: (taskId: string) =>
    automationRequest<{ task_id: string; updates: ProgressUpdate[]; diagnostics?: AutomationDiagnostic[] }>(`/report/progress/${taskId}`),
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
    downloadFile(`/report/download/${taskId}?format=${format}`, defaultReportFilename(format)),
  downloadHistoryFile: (historyId: string, format: DownloadFormat, fileName?: string) =>
    downloadFile(`/report/download-history/${historyId}?format=${format}`, reportFilenameForFormat(fileName, format)),
};
