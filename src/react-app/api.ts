const BASE = '/api';

function getToken(): string | null {
  return localStorage.getItem('token');
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
    list: () => request<{ minutes: { id: string; title: string; description: string; file_name: string; file_size: number; created_at: string; uploader_name: string }[] }>('/minutes'),
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
      request('/minutes/' + id + '/share', { method: 'POST', body: JSON.stringify({ user_ids }) }),
    sharedWithMe: () => request<{ minutes: any[] }>('/minutes/shared/me'),
    markRead: (id: string) => request('/minutes/shared/' + id + '/read', { method: 'PUT' }),
  },

  adminNotes: {
    list: () => request<{ notes: any[] }>('/admin-notes'),
    get: (id: string) => request<{ note: any; comments: any[] }>('/admin-notes/' + id),
    create: (data: { title: string; content: string; pinned?: boolean; source_type?: string; source_id?: string; is_anonymous?: boolean; visibility?: string }) =>
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
    create: (data: { type: string; type_detail?: string; client_name: string; depositor_name?: string; depositor_different?: boolean; amount: number; contract_date?: string; journal_entry_id?: string; direction?: string; payment_type?: string; receipt_type?: string; receipt_phone?: string; proxy_cost?: number }) =>
      request<{ success: boolean; id: string }>('/sales', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: { type?: string; type_detail?: string; client_name?: string; depositor_name?: string; depositor_different?: boolean; amount?: number; contract_date?: string; payment_type?: string; receipt_type?: string; receipt_phone?: string; card_deposit_date?: string; tax_invoice_date?: string; tax_invoice_type?: string }) =>
      request('/sales/' + id, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) =>
      request('/sales/' + id, { method: 'DELETE' }),
    deleteByEntry: (entryId: string) =>
      request('/sales/by-entry/' + entryId, { method: 'DELETE' }),
    updatePaymentMethod: (id: string, payment_method: string) =>
      request('/sales/' + id + '/payment-method', { method: 'PUT', body: JSON.stringify({ payment_method }) }),
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
    // 활동 내역 (master, accountant)
    activityLogs: (params?: { month?: string; actor_id?: string; action?: string; limit?: number }) => {
      const q = new URLSearchParams();
      if (params?.month) q.set('month', params.month);
      if (params?.actor_id) q.set('actor_id', params.actor_id);
      if (params?.action) q.set('action', params.action);
      if (params?.limit) q.set('limit', String(params.limit));
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
  },

  accounting: {
    list: () => request<{ accounts: import('./types').UserAccounting[] }>('/accounting'),
    get: (userId: string) => request<{ account: import('./types').UserAccounting | null }>('/accounting/' + userId),
    update: (userId: string, data: { salary?: number; grade?: string; position_allowance?: number; pay_type?: string; commission_rate?: number }) =>
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
