const BASE = '/api';

function getToken(): string | null {
  return sessionStorage.getItem('token');
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE}${path}`, { ...options, headers });

  if (res.status === 401) {
    sessionStorage.removeItem('token');
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }

  let data: any;
  try {
    data = await res.json();
  } catch {
    throw new Error(res.ok ? '응답 처리 중 오류가 발생했습니다.' : '서버 오류가 발생했습니다.');
  }
  if (!res.ok) {
    throw new Error(data?.error || '요청 처리에 실패했습니다.');
  }
  return data as T;
}

// Auth
export const api = {
  auth: {
    login: (email: string, password: string) =>
      request<{ token: string; user: import('./types').User }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),
    register: (email: string, password: string, name: string, phone: string, branch?: string) =>
      request<{ message: string }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, name, phone, branch }),
      }),
    me: () => request<{ user: import('./types').User }>('/auth/me'),
  },

  users: {
    list: () => request<{ users: import('./types').User[] }>('/users'),
    pending: () => request<{ users: import('./types').User[] }>('/users/pending'),
    approve: (id: string, department?: string) =>
      request('/users/' + id + '/approve', { method: 'POST', body: JSON.stringify({ department }) }),
    reject: (id: string) =>
      request('/users/' + id + '/reject', { method: 'POST' }),
    updateRole: (id: string, role: string, branch?: string, department?: string) =>
      request('/users/' + id + '/role', { method: 'PUT', body: JSON.stringify({ role, branch, department }) }),
    delete: (id: string) =>
      request('/users/' + id, { method: 'DELETE' }),
    update: (id: string, data: { name?: string; password?: string; phone?: string; branch?: string; department?: string; position_title?: string }) =>
      request('/users/' + id, { method: 'PUT', body: JSON.stringify(data) }),
    saveSignature: (id: string, signature_data: string) =>
      request('/users/' + id + '/signature', { method: 'PUT', body: JSON.stringify({ signature_data }) }),
    deleteSignature: (id: string) =>
      request('/users/' + id + '/signature', { method: 'DELETE' }),
  },

  teams: {
    list: () => request<{ teams: import('./types').Team[] }>('/teams'),
    create: (name: string, description?: string) =>
      request<{ team: import('./types').Team }>('/teams', {
        method: 'POST',
        body: JSON.stringify({ name, description }),
      }),
    update: (id: string, data: { name?: string; description?: string }) =>
      request('/teams/' + id, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => request('/teams/' + id, { method: 'DELETE' }),
    members: (id: string) => request<{ members: import('./types').User[] }>('/teams/' + id + '/members'),
    addMember: (teamId: string, userId: string) =>
      request('/teams/' + teamId + '/members', {
        method: 'POST',
        body: JSON.stringify({ user_id: userId }),
      }),
    removeMember: (teamId: string, userId: string) =>
      request('/teams/' + teamId + '/members/' + userId, { method: 'DELETE' }),
  },

  templates: {
    list: () => request<{ templates: import('./types').Template[] }>('/templates'),
    get: (id: string) => request<{ template: import('./types').Template }>('/templates/' + id),
    create: (data: { title: string; description?: string; content: string; category?: string }) =>
      request<{ template: import('./types').Template }>('/templates', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: Partial<import('./types').Template>) =>
      request('/templates/' + id, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => request('/templates/' + id, { method: 'DELETE' }),
  },

  documents: {
    list: (status?: string) =>
      request<{ documents: import('./types').Document[] }>('/documents' + (status ? '?status=' + status : '')),
    get: (id: string) => request<{ document: import('./types').Document }>('/documents/' + id),
    create: (data: { title: string; content?: string; template_id?: string }) =>
      request<{ document: import('./types').Document }>('/documents', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: { title?: string; content?: string }) =>
      request('/documents/' + id, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => request('/documents/' + id, { method: 'DELETE' }),
    submit: (id: string) => request('/documents/' + id + '/submit', { method: 'POST' }),
    approve: (id: string) => request('/documents/' + id + '/approve', { method: 'POST' }),
    reject: (id: string, reason?: string) =>
      request('/documents/' + id + '/reject', {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),
    logs: (id: string) => request<{ logs: import('./types').DocumentLog[] }>('/documents/' + id + '/logs'),
    steps: (id: string) => request<{ steps: import('./types').ApprovalStep[] }>('/documents/' + id + '/steps'),
  },

  signatures: {
    sign: (documentId: string, signatureData: string) =>
      request<{ signature: import('./types').Signature }>('/signatures', {
        method: 'POST',
        body: JSON.stringify({ document_id: documentId, signature_data: signatureData }),
      }),
    getByDocument: (documentId: string) =>
      request<{ signatures: import('./types').Signature[] }>('/signatures/document/' + documentId),
  },

  org: {
    list: () => request<{ nodes: import('./types').OrgNodeDB[] }>('/org'),
    sync: (nodes: { id: string; label: string; user_id?: string; parent_id?: string; tier: number; sort_order: number }[]) =>
      request<{ success: boolean; count: number }>('/org/sync', { method: 'PUT', body: JSON.stringify({ nodes }) }),
    chain: (userId: string) =>
      request<{ chain: { user_id: string; name: string; tier: number; label: string }[]; type: string }>('/org/chain/' + userId),
    ccList: () => request<{ ccList: (import('./types').ApprovalCC & { cc_user_name: string; cc_user_email: string })[] }>('/org/cc'),
    ccAdd: (cc_user_id: string) =>
      request<{ success: boolean; id: string }>('/org/cc', { method: 'POST', body: JSON.stringify({ cc_user_id }) }),
    ccDelete: (id: string) => request('/org/cc/' + id, { method: 'DELETE' }),
  },

  departments: {
    list: () => request<{ departments: { id: string; name: string; branch: string; sort_order: number }[] }>('/departments'),
    create: (name: string, branch?: string) =>
      request('/departments', { method: 'POST', body: JSON.stringify({ name, branch }) }),
    update: (id: string, data: { name?: string; branch?: string; sort_order?: number }) =>
      request('/departments/' + id, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => request('/departments/' + id, { method: 'DELETE' }),
  },

  leave: {
    list: () => request<{ leaves: any[] }>('/leave'),
    me: () => request<{ leave: any }>('/leave/me'),
    init: (userId: string, totalDays: number) =>
      request('/leave/init', { method: 'POST', body: JSON.stringify({ user_id: userId, total_days: totalDays }) }),
    update: (userId: string, data: { total_days?: number; used_days?: number }) =>
      request('/leave/' + userId, { method: 'PUT', body: JSON.stringify(data) }),
  },

  journal: {
    members: () =>
      request<{ members: { id: string; name: string; role: string; branch: string; department: string }[] }>('/journal/members'),
    list: (params?: { date?: string; range?: string }) => {
      const q = new URLSearchParams();
      if (params?.date) q.set('date', params.date);
      if (params?.range) q.set('range', params.range);
      const qs = q.toString();
      return request<{ entries: import('./journal/types').JournalEntry[] }>('/journal' + (qs ? '?' + qs : ''));
    },
    create: (data: { target_date: string; activity_type: string; activity_subtype?: string; data: Record<string, unknown> }) =>
      request<{ entry: { id: string } }>('/journal', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: { activity_subtype?: string; data?: Record<string, unknown>; completed?: number; fail_reason?: string }) =>
      request('/journal/' + id, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) =>
      request('/journal/' + id, { method: 'DELETE' }),
  },
};
