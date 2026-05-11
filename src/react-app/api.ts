const BASE = '/api';

function getToken(): string | null {
  return localStorage.getItem('token');
}

// 활동 로그 페이지 식별: 'sales' | 'accounting' (각 페이지가 mount 시 setSourcePage 호출)
let currentSourcePage: string = 'sales';
export function setSourcePage(page: 'sales' | 'accounting'): void {
  currentSourcePage = page;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Source-Page': currentSourcePage,
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE}${path}`, { ...options, headers });

  if (res.status === 401) {
    localStorage.removeItem('token');
    // /auth/me는 loadUser에서 처리하므로 리다이렉트하지 않음
    if (!path.includes('/auth/me')) {
      window.location.href = '/login';
    }
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
    login: (email: string, password: string, login_type?: string) =>
      request<{ token: string; user: import('./types').User }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password, login_type }),
      }),
    register: (email: string, password: string, name: string, phone: string, branch?: string, login_type?: string) =>
      request<{ message: string }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, name, phone, branch, login_type }),
      }),
    forgotSend: (email: string, name: string, phone: string) =>
      request<{ success: boolean; message: string }>('/auth/forgot-password/send', {
        method: 'POST', body: JSON.stringify({ email, name, phone }),
      }),
    forgotVerify: (phone: string, code: string) =>
      request<{ success: boolean; reset_token: string }>('/auth/forgot-password/verify', {
        method: 'POST', body: JSON.stringify({ phone, code }),
      }),
    forgotReset: (reset_token: string, new_password: string) =>
      request<{ success: boolean; message: string }>('/auth/forgot-password/reset', {
        method: 'POST', body: JSON.stringify({ reset_token, new_password }),
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
    getAlimtalkSettings: (id: string) =>
      request<{ branches: string }>('/users/' + id + '/alimtalk-settings'),
    updateAlimtalkSettings: (id: string, branches: string) =>
      request('/users/' + id + '/alimtalk-settings', { method: 'PUT', body: JSON.stringify({ branches }) }),
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
    list: (statusOrOpts?: string | { status?: string; author_id?: string; since?: string; exclude_drafts?: boolean; fields?: string; limit?: number }) => {
      // 하위 호환: 문자열로 status만 받던 이전 시그니처 유지
      let qs = '';
      if (typeof statusOrOpts === 'string') {
        qs = statusOrOpts ? '?status=' + encodeURIComponent(statusOrOpts) : '';
      } else if (statusOrOpts) {
        const params = new URLSearchParams();
        if (statusOrOpts.status) params.set('status', statusOrOpts.status);
        if (statusOrOpts.author_id) params.set('author_id', statusOrOpts.author_id);
        if (statusOrOpts.since) params.set('since', statusOrOpts.since);
        if (statusOrOpts.exclude_drafts) params.set('exclude_drafts', 'true');
        if (statusOrOpts.fields) params.set('fields', statusOrOpts.fields);
        if (statusOrOpts.limit) params.set('limit', String(statusOrOpts.limit));
        const s = params.toString();
        qs = s ? '?' + s : '';
      }
      return request<{ documents: import('./types').Document[] }>('/documents' + qs);
    },
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
    stepsBatch: (ids: string[]) =>
      request<{ steps: Record<string, import('./types').ApprovalStep[]> }>('/documents/steps-batch', {
        method: 'POST', body: JSON.stringify({ ids }),
      }),
    cancelRequest: (id: string, reason: string) =>
      request('/documents/' + id + '/cancel-request', { method: 'POST', body: JSON.stringify({ reason }) }),
    cancelApprove: (id: string) =>
      request('/documents/' + id + '/cancel-approve', { method: 'POST' }),
    cancelRequests: () =>
      request<{ documents: import('./types').Document[] }>('/documents/cancel-requests'),
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

  branches: {
    list: () => request<{ branches: { id: string; name: string; sort_order: number }[] }>('/branches'),
    create: (name: string) => request('/branches', { method: 'POST', body: JSON.stringify({ name }) }),
    delete: (id: string) => request('/branches/' + id, { method: 'DELETE' }),
  },

  leave: {
    list: () => request<{ leaves: any[] }>('/leave'),
    me: () => request<{ leave: any }>('/leave/me'),
    userLeave: (userId: string) => request<{ leave: any }>('/leave/user/' + userId),
    init: (userId: string, totalDays: number) =>
      request('/leave/init', { method: 'POST', body: JSON.stringify({ user_id: userId, total_days: totalDays }) }),
    update: (userId: string, data: { total_days?: number; used_days?: number; monthly_days?: number; monthly_used?: number; leave_type?: string }) =>
      request('/leave/' + userId, { method: 'PUT', body: JSON.stringify(data) }),
    // 휴가 신청
    createRequest: (data: { leave_type: string; start_date: string; end_date: string; hours?: number; reason: string }) =>
      request('/leave/request', { method: 'POST', body: JSON.stringify(data) }),
    listRequests: (params?: { status?: string; month?: string }) =>
      request<{ requests: any[] }>('/leave/requests' + (params ? '?' + new URLSearchParams(params as any).toString() : '')),
    approveRequest: (id: string) =>
      request('/leave/requests/' + id + '/approve', { method: 'POST' }),
    rejectRequest: (id: string, reason: string) =>
      request('/leave/requests/' + id + '/reject', { method: 'POST', body: JSON.stringify({ reason }) }),
    cancelRequest: (id: string) =>
      request('/leave/requests/' + id + '/cancel', { method: 'POST' }),
    cancelApprove: (id: string) =>
      request('/leave/requests/' + id + '/cancel-approve', { method: 'POST' }),
    deleteRequest: (id: string) =>
      request('/leave/requests/' + id, { method: 'DELETE' }),
    // 연차 사용량 재계산 (이력 기반 정합성)
    recalculate: (userId: string) =>
      request<{ success: boolean; before: { used_days: number; monthly_used: number }; after: { used_days: number; monthly_used: number } }>(
        '/leave/recalculate/' + userId, { method: 'POST' }
      ),
    recalculateAll: () =>
      request<{ success: boolean; total: number; updated: number; changes: Array<{ user_id: string; name: string; before: any; after: any }> }>(
        '/leave/recalculate-all', { method: 'POST' }
      ),
    reinit: (userId: string) =>
      request<{ success: boolean; before: any; after: any }>(
        '/leave/reinit/' + userId, { method: 'POST' }
      ),
    reinitAll: () =>
      request<{ success: boolean; total: number; updated: number; changes: Array<{ user_id: string; name: string; before: any; after: any }> }>(
        '/leave/reinit-all', { method: 'POST' }
      ),
    // 환급
    refund: (userId: string) => request<any>('/leave/refund/' + userId),
    // 알림
    alerts: () => request<{ alerts: any[] }>('/leave/alerts'),
    // 입사일
    setHireDate: (userId: string, hireDate: string) =>
      request('/leave/hire-date/' + userId, { method: 'PUT', body: JSON.stringify({ hire_date: hireDate }) }),
    accountantLeaves: () =>
      request<{ leaves: any[] }>('/leave/accountant-leaves'),
  },

  minutes: {
    list: () => request<{ minutes: { id: string; title: string; description: string; file_name: string; file_size: number; created_at: string; uploaded_by: string; uploader_name: string }[] }>('/minutes'),
    upload: async (title: string, description: string, file: File) => {
      const token = getToken();
      const fd = new FormData();
      fd.append('title', title);
      fd.append('description', description);
      fd.append('file', file);
      const res = await fetch('/api/minutes', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      const data = await res.json() as any;
      if (!res.ok) throw new Error(data?.error || '업로드 실패');
      return data as { success: boolean; id: string };
    },
    downloadUrl: (id: string) => `/api/minutes/${id}/download`,
    delete: (id: string) => request('/minutes/' + id, { method: 'DELETE' }),
    get: (id: string) => request<{ minute: any; shares: any[] }>('/minutes/' + id),
    convertTxt: (data: { title: string; raw_text: string; share_with?: string[] }) =>
      request<{ success: boolean; id: string; converted: string }>('/minutes/convert-txt', { method: 'POST', body: JSON.stringify(data) }),
    share: (id: string, user_ids: string[]) =>
      request('/minutes/' + id + '/share', { method: 'PUT', body: JSON.stringify({ user_ids }) }),
    shareTargets: () =>
      request<{ members: { id: string; name: string; role: string; branch: string; department: string }[] }>('/minutes/share-targets'),
    sharedWithMe: () => request<{ minutes: any[] }>('/minutes/shared/me'),
    markRead: (id: string) => request('/minutes/shared/' + id + '/read', { method: 'PUT' }),
  },

  adminNotes: {
    list: (params: { category?: string; search?: string } = {}) => {
      const q = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') q.set(k, String(v)); });
      return request<{ notes: any[] }>('/admin-notes' + (q.toString() ? '?' + q.toString() : ''));
    },
    get: (id: string) => request<{ note: any; comments: any[]; attachments: any[] }>('/admin-notes/' + id),
    create: (data: { title: string; content: string; pinned?: boolean; source_type?: string; source_id?: string; is_anonymous?: boolean; visibility?: string; category?: string; court?: string; case_number?: string; attachments?: any[] }) =>
      request<{ success: boolean; id: string }>('/admin-notes', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: { title?: string; content?: string; pinned?: boolean }) =>
      request('/admin-notes/' + id, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) => request('/admin-notes/' + id, { method: 'DELETE' }),
    addComment: (noteId: string, content: string, is_anonymous?: boolean) =>
      request('/admin-notes/' + noteId + '/comments', { method: 'POST', body: JSON.stringify({ content, is_anonymous }) }),
    deleteComment: (commentId: string) =>
      request('/admin-notes/comments/' + commentId, { method: 'DELETE' }),
  },

  commissions: {
    list: () => request<{ commissions: any[] }>('/commissions'),
    pendingCount: () => request<{ count: number }>('/commissions/pending-count'),
    myPending: () => request<{ commissions: any[] }>('/commissions/my-pending'),
    complete: (id: string) => request('/commissions/' + id + '/complete', { method: 'POST' }),
    create: (data: { journal_entry_id: string; user_id: string; user_name: string; client_name: string; case_no: string; win_price: string }) =>
      request('/commissions', { method: 'POST', body: JSON.stringify(data) }),
    deleteByEntry: (entryId: string) => request('/commissions/by-entry/' + entryId, { method: 'DELETE' }),
  },

  analytics: {
    summary: (months?: number) => request<any>('/analytics/summary' + (months ? '?months=' + months : '')),
    comprehensive: (params: { branch?: string; department?: string; user_id?: string; month?: string; month_end?: string }) => {
      const q = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => { if (v) q.set(k, v); });
      return request<{
        members: Array<any>;
        benchmarks: { org_activity_avg: number; freelancer_avg_sales: number; member_count: number; full_time_count: number; freelancer_count: number };
        metadata: { period_start: string; period_end: string };
      }>(`/analytics/comprehensive${q.toString() ? '?' + q.toString() : ''}`);
    },
  },

  sales: {
    list: (params?: { month?: string; month_end?: string; user_id?: string; date_mode?: string }) => {
      const q = new URLSearchParams();
      if (params?.month) q.set('month', params.month);
      if (params?.month_end) q.set('month_end', params.month_end);
      if (params?.user_id) q.set('user_id', params.user_id);
      if (params?.date_mode) q.set('date_mode', params.date_mode);
      const qs = q.toString();
      return request<{ records: import('./types').SalesRecord[] }>('/sales' + (qs ? '?' + qs : ''));
    },
    ranking: (period_start: string, period_end: string) =>
      request<{ ranking: Array<{ user_name: string; eff_branch: string; position: string; count: number; total_amount: number }> }>(
        '/sales/ranking?period_start=' + encodeURIComponent(period_start) + '&period_end=' + encodeURIComponent(period_end)
      ),
    contractTracker: (
      params: { month_from?: string; month_to?: string; period?: 'today' | 'yesterday' | 'week' | 'month'; month?: string } = {}
    ) => {
      const q = new URLSearchParams();
      if (params.month_from) q.set('month_from', params.month_from);
      if (params.month_to) q.set('month_to', params.month_to);
      if (!params.month_from && !params.month_to) {
        q.set('period', params.period || 'month');
        if (params.month) q.set('month', params.month);
      }
      return request<{
        period: string; from: string; to: string;
        users: Array<{ user_id: string; user_name: string; branch: string; department: string; position_title: string; role: string; login_type: string; contract_count: number; total_amount: number; raw_count: number }>;
        total_count: number; total_amount: number;
      }>('/sales/contract-tracker?' + q.toString());
    },
    create: (data: { type: string; type_detail?: string; client_name: string; depositor_name?: string; depositor_different?: boolean; amount: number; contract_date?: string; journal_entry_id?: string; direction?: string; payment_type?: string; receipt_type?: string; receipt_phone?: string; proxy_cost?: number }) =>
      request<{ success: boolean; id: string }>('/sales', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: { type?: string; type_detail?: string; client_name?: string; depositor_name?: string; depositor_different?: boolean; amount?: number; contract_date?: string; deposit_date?: string; payment_type?: string; receipt_type?: string; receipt_phone?: string; card_deposit_date?: string; tax_invoice_date?: string; tax_invoice_type?: string }) =>
      request('/sales/' + id, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) =>
      request('/sales/' + id, { method: 'DELETE' }),
    deleteByEntry: (entryId: string) =>
      request('/sales/by-entry/' + entryId, { method: 'DELETE' }),
    updatePaymentMethod: (id: string, payment_method: string) =>
      request('/sales/' + id + '/payment-method', { method: 'PUT', body: JSON.stringify({ payment_method }) }),
    updatePhone: (id: string, client_phone: string) =>
      request('/sales/' + id + '/phone', { method: 'PUT', body: JSON.stringify({ client_phone }) }),
    updateExcludeCount: (id: string, exclude: boolean) =>
      request('/sales/' + id + '/exclude-count', { method: 'PUT', body: JSON.stringify({ exclude }) }),
    confirm: (id: string, deposit_date?: string) =>
      request('/sales/' + id + '/confirm', { method: 'POST', body: JSON.stringify({ deposit_date }) }),
    unconfirm: (id: string) =>
      request('/sales/' + id + '/unconfirm', { method: 'POST' }),
    refundRequest: (id: string) =>
      request('/sales/' + id + '/refund-request', { method: 'POST' }),
    refundApprove: (id: string) =>
      request('/sales/' + id + '/refund-approve', { method: 'POST' }),
    updateMemo: (id: string, memo: string) =>
      request('/sales/' + id + '/memo', { method: 'PUT', body: JSON.stringify({ memo }) }),
    dashboardPending: () =>
      request<{ records: import('./types').SalesRecord[] }>('/sales/dashboard/pending'),
    dashboardRefundRequests: () =>
      request<{ records: import('./types').SalesRecord[] }>('/sales/dashboard/refund-requests'),
    dashboardRefundImpacts: () =>
      request<{ impacts: any[] }>('/sales/dashboard/refund-impacts'),
    stats: (params?: { month?: string; month_end?: string; branch?: string; department?: string; user_id?: string }) => {
      const q = new URLSearchParams();
      if (params?.month) q.set('month', params.month);
      if (params?.month_end) q.set('month_end', params.month_end);
      if (params?.branch) q.set('branch', params.branch);
      if (params?.department) q.set('department', params.department);
      if (params?.user_id) q.set('user_id', params.user_id);
      const qs = q.toString();
      return request<{ records: import('./types').SalesRecord[] }>('/sales/stats' + (qs ? '?' + qs : ''));
    },
    deposits: () => request<{ deposits: import('./types').DepositNotice[] }>('/sales/deposits'),
    createDeposit: (data: { depositor: string; amount: number; deposit_date: string }) =>
      request<{ success: boolean; id: string }>('/sales/deposits', { method: 'POST', body: JSON.stringify(data) }),
    claimDeposit: (id: string, data: { type: string; type_detail?: string; client_name: string; contract_date?: string }) =>
      request('/sales/deposits/' + id + '/claim', { method: 'POST', body: JSON.stringify(data) }),
    approveDeposit: (id: string) =>
      request('/sales/deposits/' + id + '/approve', { method: 'POST' }),
    deleteDeposit: (id: string) =>
      request('/sales/deposits/' + id, { method: 'DELETE' }),
    createAccountingEntry: (data: { amount: number; content: string; date: string; assignee_id: string; direction?: string }) =>
      request<{ success: boolean; id: string }>('/sales/accounting-entry', { method: 'POST', body: JSON.stringify(data) }),
    contractCheck: (id: string, data: { contract_submitted?: number; contract_not_submitted?: number; contract_not_reason?: string; contract_not_approved?: number }) =>
      request('/sales/' + id + '/contract-check', { method: 'PUT', body: JSON.stringify(data) }),
    contractNotApprove: (id: string) =>
      request('/sales/' + id + '/contract-not-approve', { method: 'PUT' }),
    bulkImport: (records: any[]) =>
      request<{ success: boolean; count: number }>('/sales/bulk-import', { method: 'POST', body: JSON.stringify({ records }) }),
    // 활동 내역 (master, accountant) — source_page='sales'|'accounting' 으로 페이지별 필터
    activityLogs: (params?: { month?: string; actor_id?: string; action?: string; limit?: number; source_page?: 'sales' | 'accounting' }) => {
      const q = new URLSearchParams();
      if (params?.month) q.set('month', params.month);
      if (params?.actor_id) q.set('actor_id', params.actor_id);
      if (params?.action) q.set('action', params.action);
      if (params?.limit) q.set('limit', String(params.limit));
      if (params?.source_page) q.set('source_page', params.source_page);
      const qs = q.toString();
      return request<{ logs: any[] }>('/sales/activity-logs' + (qs ? '?' + qs : ''));
    },
    // 총무 메모
    memos: (params?: { related_type?: string; related_id?: string }) => {
      const q = new URLSearchParams();
      if (params?.related_type) q.set('related_type', params.related_type);
      if (params?.related_id) q.set('related_id', params.related_id);
      return request<{ memos: any[] }>('/sales/memos?' + q.toString());
    },
    createAdminMemo: (data: { related_type: string; related_id: string; content: string }) =>
      request<{ success: boolean; id: string }>('/sales/memos', { method: 'POST', body: JSON.stringify(data) }),
    updateAdminMemo: (id: string, content: string) =>
      request<{ success: boolean }>('/sales/memos/' + id, { method: 'PUT', body: JSON.stringify({ content }) }),
    deleteAdminMemo: (id: string) =>
      request<{ success: boolean }>('/sales/memos/' + id, { method: 'DELETE' }),
  },

  card: {
    updateUserCard: (userId: string, card_number: string) =>
      request('/card/user/' + userId, { method: 'PUT', body: JSON.stringify({ card_number }) }),
    upload: (rows: { card_number: string; transaction_date: string; merchant_name: string; amount: number; description: string }[]) =>
      request<{ success: boolean; inserted: number; batch_id: string }>('/card/upload', { method: 'POST', body: JSON.stringify({ rows }) }),
    transactions: (params?: { month?: string; branch?: string; user_id?: string }) => {
      const q = new URLSearchParams();
      if (params?.month) q.set('month', params.month);
      if (params?.branch) q.set('branch', params.branch);
      if (params?.user_id) q.set('user_id', params.user_id);
      const qs = q.toString();
      return request<{ transactions: any[] }>('/card/transactions' + (qs ? '?' + qs : ''));
    },
    summary: (month?: string) => {
      const q = month ? '?month=' + month : '';
      return request<{ by_branch: any[]; by_user: any[] }>('/card/summary' + q);
    },
    userTotal: (userId: string, month?: string) => {
      const q = month ? '?month=' + month : '';
      return request<{ total: number }>('/card/user-total/' + userId + q);
    },
    deleteTransaction: (id: string) =>
      request('/card/transaction/' + id, { method: 'DELETE' }),
    deleteBatch: (batchId: string) =>
      request('/card/batch/' + batchId, { method: 'DELETE' }),
    bulkDelete: (ids: string[]) =>
      request<{ success: boolean; count: number }>('/card/bulk-delete', { method: 'POST', body: JSON.stringify({ ids }) }),
    rematch: () =>
      request<{ success: boolean; total: number; updated: number }>('/card/rematch', { method: 'POST' }),
    lastUpload: () =>
      request<{ last_upload: string | null; count: number; batch_id: string | null }>('/card/last-upload'),
  },

  links: {
    myOutdoorEntries: (forDocId?: string) => {
      const q = forDocId ? '?for_doc_id=' + encodeURIComponent(forDocId) : '';
      return request<{ entries: Array<{
        id: string; target_date: string; activity_type: string; activity_subtype: string;
        time_from: string; time_to: string; place: string; case_no: string; client: string; court: string;
        linked_to_other_doc: string | null; linked_to_current_doc: boolean;
      }> }>('/links/my-outdoor-entries' + q);
    },
    create: (data: { document_id: string; journal_entry_ids: string[]; link_type?: string }) =>
      request<{ success: boolean; links: any[] }>('/links', { method: 'POST', body: JSON.stringify(data) }),
    delete: (id: string) =>
      request<{ success: boolean }>('/links/' + id, { method: 'DELETE' }),
    byDocument: (docId: string) =>
      request<{ links: Array<{ link_id: string; journal_entry_id: string; link_type: string; created_at: string;
        target_date: string; activity_type: string; activity_subtype: string; data: string }> }>('/links/by-document/' + docId),
    effectiveEntryIds: (since?: string, linkType: string = 'outdoor') => {
      const q = new URLSearchParams();
      if (since) q.set('since', since);
      q.set('link_type', linkType);
      return request<{ entry_ids: string[] }>('/links/effective-entry-ids?' + q.toString());
    },
    reviewQueue: (status: 'pending' | 'resolved' | 'skipped' = 'pending') =>
      request<{ items: Array<{
        id: string; document_id: string; doc_title: string; doc_status: string; doc_created_at: string;
        author_id: string; author_name: string; match_tier: number;
        body_outing_text: string | null; body_outing_parsed: string | null;
        candidates: Array<{ id: string; target_date: string; activity_type: string; activity_subtype: string;
          time_from: string; time_to: string; place: string; case_no: string; client: string }>;
        created_at: string;
      }> }>('/links/review-queue?status=' + status),
    resolveReview: (id: string, journalEntryIds: string[]) =>
      request<{ success: boolean; action: string; linked_count?: number }>('/links/review/' + id + '/resolve', {
        method: 'POST', body: JSON.stringify({ journal_entry_ids: journalEntryIds })
      }),
  },

  approvalAlerts: {
    list: () =>
      request<{ alerts: Array<{
        id: string; document_id: string; approver_id: string; cycle_no: number; step_order: number;
        my_status: 'need_approve' | 'waiting_final';
        document_title: string; document_template_id: string; document_author_id: string; document_author_name: string;
        document_branch: string; document_department: string; document_submitted_at: string;
        status: string; detected_at: string;
      }> }>('/approval-alerts'),
    dismiss: (id: string) =>
      request<{ success: boolean }>('/approval-alerts/' + id + '/dismiss', { method: 'POST' }),
    backfill: (dryRun: boolean) =>
      request<{ dry_run: boolean; docs_processed: number; alerts_created: number; skipped: number; samples: any[] }>(
        '/approval-alerts/backfill',
        { method: 'POST', body: JSON.stringify({ dryRun }) }
      ),
  },

  payroll: {
    get: (userId: string, month?: string) => {
      const q = month ? '?month=' + month : '';
      return request<any>('/payroll/' + userId + q);
    },
    branchSummary: (month?: string, branch?: string) => {
      const q = new URLSearchParams();
      if (month) q.set('month', month);
      if (branch) q.set('branch', branch);
      const qs = q.toString();
      return request<any>('/payroll/branch/summary' + (qs ? '?' + qs : ''));
    },
    getSave: (userId: string, period: string) =>
      request<{ save: any }>('/payroll/save/' + userId + '?period=' + encodeURIComponent(period)),
    save: (data: { user_id: string; period: string; pay_type: string; data: Record<string, unknown> }) =>
      request('/payroll/save', { method: 'POST', body: JSON.stringify(data) }),
    lock: () => request('/payroll/lock', { method: 'POST' }),
    businessIncome: (month: string) =>
      request<{
        month: string;
        entries: Array<{ id: string; user_id: string | null; name: string; ssn: string; address: string; amount: number; tax: number; net_amount: number; branch: string; department: string; is_ad_hoc: boolean; is_overridden: boolean; note: string }>;
        total_amount: number; total_tax: number; total_net: number;
      }>('/payroll/reports/business-income?month=' + encodeURIComponent(month)),
    saveBusinessIncome: (data: { month: string; id?: string; user_id?: string | null; name: string; ssn?: string; address?: string; amount: number; tax: number; net_amount: number; is_ad_hoc?: boolean; note?: string }) =>
      request<{ success: boolean; id: string }>('/payroll/reports/business-income/save', { method: 'PUT', body: JSON.stringify(data) }),
    deleteBusinessIncome: (id: string) =>
      request('/payroll/reports/business-income/' + id, { method: 'DELETE' }),
    businessIncomePool: () =>
      request<{ pool: Array<{ id: string; name: string; ssn: string; address: string; note: string }> }>('/payroll/reports/business-income-pool'),
    addBusinessIncomePool: (data: { name: string; ssn?: string; address?: string; note?: string }) =>
      request<{ success: boolean; id: string }>('/payroll/reports/business-income-pool', { method: 'POST', body: JSON.stringify(data) }),
    updateBusinessIncomePool: (id: string, data: { name: string; ssn?: string; address?: string; note?: string }) =>
      request('/payroll/reports/business-income-pool/' + id, { method: 'PUT', body: JSON.stringify(data) }),
    deleteBusinessIncomePool: (id: string) =>
      request('/payroll/reports/business-income-pool/' + id, { method: 'DELETE' }),
  },

  accounting: {
    list: () => request<{ accounts: import('./types').UserAccounting[] }>('/accounting'),
    get: (userId: string) => request<{ account: import('./types').UserAccounting | null }>('/accounting/' + userId),
    update: (userId: string, data: { salary?: number; grade?: string; position_allowance?: number; pay_type?: string; commission_rate?: number; ssn?: string; address?: string }) =>
      request<{ success: boolean; salary: number; standard_sales: number; grade: string }>('/accounting/' + userId, { method: 'PUT', body: JSON.stringify(data) }),
    updateGrade: (userId: string, grade: string) =>
      request('/accounting/' + userId + '/grade', { method: 'PUT', body: JSON.stringify({ grade }) }),
    evaluations: (userId: string) =>
      request<{ evaluations: import('./types').SalesEvaluation[] }>('/accounting/evaluations/' + userId),
    evaluate: (periodStart: string, periodEnd: string) =>
      request<{ success: boolean; results: any[] }>('/accounting/evaluate', { method: 'POST', body: JSON.stringify({ period_start: periodStart, period_end: periodEnd }) }),
    alerts: () =>
      request<{ alerts: import('./types').SalesEvaluation[]; demotion_candidates: import('./types').SalesEvaluation[]; current_period_alerts: import('./types').SalesEvaluation[]; current_period: { start: string; end: string } }>('/accounting/alerts/dashboard'),
    uploadBank: (rows: any[]) =>
      request<{ success: boolean; total: number; inserted: number; dupSales: number; dupStaging: number; skipped: string[] }>('/accounting/upload-bank', { method: 'POST', body: JSON.stringify({ rows }) }),
    staging: (month?: string) =>
      request<{ items: any[] }>('/accounting/staging' + (month ? '?month=' + month : '')),
    stagingToSales: (id: string, data: { type: string; user_id?: string; type_detail?: string }) =>
      request<{ success: boolean; sales_id: string }>('/accounting/staging/' + id + '/to-sales', { method: 'POST', body: JSON.stringify(data) }),
    stagingDelete: (id: string) =>
      request('/accounting/staging/' + id, { method: 'DELETE' }),
  },

  cooperation: {
    list: (filter?: string) =>
      request<{ requests: any[] }>('/cooperation' + (filter ? '?filter=' + filter : '')),
    dashboard: () =>
      request<{ alerts: any[] }>('/cooperation/dashboard'),
    get: (id: string) =>
      request<{ request: any; replies: any[]; photos: any[] }>('/cooperation/' + id),
    create: (data: { receiver_id: string; court?: string; case_year?: string; case_type?: string; case_number?: string; content?: string }) =>
      request<{ success: boolean; id: string }>('/cooperation', { method: 'POST', body: JSON.stringify(data) }),
    accept: (id: string) =>
      request('/cooperation/' + id + '/accept', { method: 'POST' }),
    complete: (id: string) =>
      request('/cooperation/' + id + '/complete', { method: 'POST' }),
    reply: (id: string, data: { content?: string; photos?: { file_name: string; file_data: string; file_size: number }[] }) =>
      request<{ success: boolean; reply_id: string }>('/cooperation/' + id + '/reply', { method: 'POST', body: JSON.stringify(data) }),
    getPhoto: (photoId: string) =>
      request<{ photo: { id: string; file_name: string; file_data: string; file_size: number } }>('/cooperation/photos/' + photoId),
    delete: (id: string) =>
      request('/cooperation/' + id, { method: 'DELETE' }),
  },

  drive: {
    settings: () =>
      request<{ settings: any; last_backup_at: string | null; pending_count: number; failed_last_7d: number }>('/drive/settings'),
    saveSettings: (data: Partial<{ root_folder_name: string; folder_pattern: string; filename_pattern: string; auto_enabled: boolean }>) =>
      request<{ success: boolean }>('/drive/settings', { method: 'PUT', body: JSON.stringify(data) }),
    disconnect: () =>
      request<{ success: boolean }>('/drive/disconnect', { method: 'POST' }),
    oauthStart: () =>
      request<{ url: string; state: string }>('/drive/oauth/start'),
    pending: () =>
      request<{ documents: Array<{ id: string; title: string; template_id: string | null; template_name: string | null; branch: string; department: string; author_name: string; author_branch: string; author_department: string; author_position: string | null; approved_at: string; created_at: string; updated_at: string }> }>('/drive/pending'),
    logs: (limit = 30) =>
      request<{ logs: any[] }>('/drive/logs?limit=' + limit),
    runNow: (limit?: number) =>
      request<{ processed: number; success: number; failed: number; skipped: number; error?: string; details?: Array<{ id: string; title: string; status: 'success' | 'failed'; folder?: string; file_id?: string; error?: string }> }>(
        `/drive/run-now${limit ? `?limit=${limit}` : ''}`,
        { method: 'POST' },
      ),
    testSend: (document_ids: string[]) =>
      request<{ processed: number; success: number; failed: number; error?: string; details?: Array<{ id: string; title: string; status: 'success' | 'failed'; folder?: string; file_id?: string; error?: string }> }>('/drive/test-send', {
        method: 'POST',
        body: JSON.stringify({ document_ids }),
      }),
    testToken: () =>
      request<{ success: boolean; expires_in?: number; error?: string }>('/drive/test-access-token'),
    retryFailed: (params: { document_ids?: string[]; all?: boolean }) =>
      request<{ success: boolean; deleted?: number; error?: string }>('/drive/retry-failed', {
        method: 'POST',
        body: JSON.stringify(params),
      }),
    errorSummary: () =>
      request<{ summary: Array<{ category: string; cnt: number; sample_message: string }> }>('/drive/error-summary'),
  },

  cases: {
    list: (params: { search?: string; period?: string; manager_id?: string; limit?: number } = {}) => {
      const q = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') q.set(k, String(v)); });
      return request<{ cases: any[] }>(`/cases${q.toString() ? '?' + q.toString() : ''}`);
    },
    detail: (id: string) => request<{ case: any }>(`/cases/${id}`),
    update: (id: string, data: { registered_at?: string; consultant_name?: string | null; consultant_position?: string | null; manager_username?: string; manager_name?: string; client_name?: string; fee_type?: 'fixed' | 'actual'; fee_amount?: number }) =>
      request<{ success: boolean; case: any }>(`/cases/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    bonusSummary: (period: string) => request<{ period: string; period_label: string; summary: Array<{ consultant_user_id: string | null; consultant_name: string; consultant_position: string | null; consultant_branch: string | null; consultant_department: string | null; cnt: number; total_fee: number; total_fee_raw: number; total_fee_adjusted: number; bonus: number }> }>(`/cases/bonus/summary?period=${period}`),
    bonusMe: (period: string) => request<{ period: string; period_label: string; total_fee: number; total_fee_raw: number; total_fee_adjusted: number; case_count: number; bonus: number }>(`/cases/bonus/me?period=${period}`),
    delete: (id: string, reason?: string) =>
      request<{ success: boolean }>(`/cases/${id}${reason ? '?reason=' + encodeURIComponent(reason) : ''}`, { method: 'DELETE' }),
    finalizeBonus: (period: string) =>
      request<{ success: boolean; period: string; period_label: string; inserted: number; skipped: number; ineligible: number; details: Array<{ user_id: string; user_name: string; bonus: number; status: string; reason?: string }> }>(`/cases/finalize-bonus`, { method: 'POST', body: JSON.stringify({ period }) }),
  },

  rooms: {
    config: () =>
      request<{ config: Record<string, string[]> }>('/rooms/config'),
    list: (params: { branch: string; room?: string; date?: string; from?: string; to?: string; include_cancelled?: boolean }) => {
      const q = new URLSearchParams();
      q.set('branch', params.branch);
      if (params.room) q.set('room', params.room);
      if (params.date) q.set('date', params.date);
      if (params.from) q.set('from', params.from);
      if (params.to) q.set('to', params.to);
      if (params.include_cancelled) q.set('include_cancelled', '1');
      return request<{ reservations: Array<{ id: string; user_id: string; branch: string; room_name: string; reservation_date: string; start_time: string; end_time: string; title: string; note: string; status: string; user_name?: string; user_department?: string; user_position?: string; user_branch?: string; created_at: string }> }>('/rooms/reservations?' + q.toString());
    },
    create: (data: { branch: string; room_name: string; reservation_date: string; start_time: string; end_time: string; title?: string; note?: string }) =>
      request<{ success: boolean; id: string }>('/rooms/reservations', { method: 'POST', body: JSON.stringify(data) }),
    cancel: (id: string) =>
      request('/rooms/reservations/' + id, { method: 'DELETE' }),
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
    update: (id: string, data: { activity_subtype?: string; data?: Record<string, unknown>; completed?: number; fail_reason?: string; bid_field_only?: boolean }) =>
      request('/journal/' + id, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) =>
      request('/journal/' + id, { method: 'DELETE' }),
    dismissAlert: (alert_type: string, alert_key: string) =>
      request('/journal/dismiss-alert', { method: 'POST', body: JSON.stringify({ alert_type, alert_key }) }),
    dismissAlertsBulk: (keys: { alert_type: string; alert_key: string }[]) =>
      request('/journal/dismiss-alerts-bulk', { method: 'POST', body: JSON.stringify({ keys }) }),
    dismissedAlerts: () =>
      request<{ keys: string[] }>('/journal/dismissed-alerts'),
    checkCaseNo: (caseNo: string, court?: string) => {
      const q = new URLSearchParams({ case_no: caseNo });
      if (court) q.set('court', court);
      return request<{ exists: boolean; entries: { id: string; user_id: string; user_name: string; target_date: string; court: string }[] }>('/journal/check-case-no?' + q.toString());
    },
    duplicateInspections: (all?: boolean) =>
      request<{ duplicates: { case_no: string; court: string; branch: string; user_names: string; user_count: number; first_date: string; last_date: string }[] }>('/journal/duplicate-inspections' + (all ? '?all=true' : '')),
  },

  alimtalk: {
    logs: (params?: { template?: string; search?: string; limit?: number }) => {
      const q = new URLSearchParams();
      if (params?.template) q.set('template', params.template);
      if (params?.search) q.set('search', params.search);
      if (params?.limit) q.set('limit', String(params.limit));
      return request<{ logs: any[] }>('/alimtalk/logs' + (q.toString() ? '?' + q.toString() : ''));
    },
    status: () => request<{ configured: boolean; templates: any[]; categories: any[] }>('/alimtalk/status'),
  },
};
