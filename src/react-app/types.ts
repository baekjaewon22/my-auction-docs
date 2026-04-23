export type Role = 'master' | 'ceo' | 'cc_ref' | 'admin' | 'director' | 'accountant' | 'accountant_asst' | 'manager' | 'member' | 'support' | 'resigned';
export type DocStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

export const BRANCHES = ['의정부', '서초'] as const;
export const DEPARTMENTS = ['경매사업부1팀', '경매사업부2팀', '경매사업부3팀'] as const;

export const ROLE_LABELS: Record<Role, string> = {
  master: '마스터',
  ceo: '대표',
  cc_ref: 'CC참조자',
  admin: '관리자',
  director: '총괄이사',
  accountant: '총무담당',
  accountant_asst: '총무보조',
  manager: '팀장',
  member: '팀원',
  support: '지원',
  resigned: '퇴사자',
};

// UI에서 표시할 역할 (master 제외)
export const VISIBLE_ROLES: Role[] = ['ceo', 'cc_ref', 'admin', 'director', 'accountant', 'accountant_asst', 'manager', 'member', 'support'];

export interface User {
  id: string;
  email: string;
  name: string;
  phone: string;
  role: Role;
  team_id: string | null;
  team_name?: string;
  branch: string;
  department: string;
  position_title: string;
  card_number?: string;
  hire_date?: string;
  login_type?: 'employee' | 'freelancer';
  created_at?: string;
  updated_at?: string;
}

export interface Team {
  id: string;
  name: string;
  description: string;
  created_at?: string;
}

export interface Template {
  id: string;
  title: string;
  description: string;
  content: string;
  category: string;
  created_by: string;
  is_active: number;
  created_at?: string;
}

export interface Document {
  id: string;
  title: string;
  content: string;
  template_id: string | null;
  author_id: string;
  author_name?: string;
  team_id: string | null;
  team_name?: string;
  branch: string;
  department: string;
  status: DocStatus;
  reject_reason: string | null;
  cancel_requested: number;
  cancel_reason: string;
  cancelled: number;
  created_at: string;
  updated_at: string;
}

export interface Signature {
  id: string;
  document_id: string;
  user_id: string;
  user_name?: string;
  user_email?: string;
  signature_data: string;
  ip_address: string;
  user_agent: string;
  signed_at: string;
}

export interface DocumentLog {
  id: string;
  document_id: string;
  user_id: string;
  user_name?: string;
  action: string;
  details: string;
  created_at: string;
}

export interface OrgNodeDB {
  id: string;
  label: string;
  user_id: string | null;
  parent_id: string | null;
  tier: number;
  sort_order: number;
}

export interface ApprovalStep {
  id: string;
  document_id: string;
  step_order: number;
  approver_id: string;
  approver_name?: string;
  status: 'pending' | 'approved' | 'rejected';
  comment: string | null;
  signed_at: string | null;
}

export interface ApprovalCC {
  id: string;
  cc_user_id: string;
  cc_user_name?: string;
  created_at: string;
}

export interface UserAccounting {
  id: string;
  user_id: string;
  user_name?: string;
  branch?: string;
  department?: string;
  role?: string;
  position_title?: string;
  salary: number;
  standard_sales: number;
  grade: '' | 'M1' | 'M2' | 'M3' | 'M4';
  position_allowance: number;
  pay_type?: 'salary' | 'commission';
  commission_rate?: number;
  ssn?: string;
  address?: string;
  created_at?: string;
  updated_at?: string;
}

export type SalesStatus = 'pending' | 'card_pending' | 'confirmed' | 'refund_requested' | 'refunded';

export interface SalesRecord {
  id: string;
  user_id: string;
  user_name?: string;
  position_title?: string;
  type: '계약' | '낙찰' | '중개' | '기타';
  type_detail: string;
  client_name: string;
  depositor_name: string;
  depositor_different: number;
  amount: number;
  contract_date: string;
  status: SalesStatus;
  journal_entry_id: string | null;
  deposit_date: string;
  confirmed_at: string | null;
  confirmed_by: string | null;
  confirmed_by_name?: string;
  refund_requested_at: string | null;
  refund_approved_at: string | null;
  refund_approved_by: string | null;
  refund_approved_by_name?: string;
  direction: 'income' | 'expense';
  payment_method: string;
  memo: string;
  branch: string;
  department: string;
  // 매출 귀속 지사 (비워두면 branch 사용) — 집계 전용
  attribution_branch?: string;
  // 계약 미포함 (중복 계약 시 갯수 카운트에서 제외, 매출/실적은 유지)
  exclude_from_count?: number;
  // [6-1] 수수료 계산
  appraisal_price: number;
  winning_price: number;
  appraisal_rate: number;
  winning_rate: number;
  commission_amount: number;
  // [6-2] 계약서 제출
  contract_submitted: number;
  contract_not_submitted: number;
  contract_not_reason: string;
  contract_not_approved: number;
  contract_not_approved_by: string | null;
  // 매수신청대리비용
  proxy_cost: number;
  // 결제정보
  payment_type: string;
  receipt_type: string;
  receipt_phone: string;
  card_deposit_date: string;
  client_phone: string;
  // 세금계산서/현금영수증 발행 기록 (총무 메모용)
  tax_invoice_date?: string;
  tax_invoice_type?: string; // '영수' | '계산'
  created_at: string;
  updated_at: string;
}

export interface DepositNotice {
  id: string;
  depositor: string;
  amount: number;
  deposit_date: string;
  d_day_date: string;
  created_by: string;
  created_by_name?: string;
  claimed_by: string | null;
  claimed_by_name?: string;
  claimed_at: string | null;
  sales_record_id: string | null;
  status: 'pending' | 'claimed' | 'approved';
  approved_by: string | null;
  approved_by_name?: string;
  approved_at: string | null;
  created_at: string;
}

export type LeaveRequestType = '연차' | '월차' | '반차' | '시간차' | '특별휴가';
export type LeaveRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'cancel_requested';

export interface LeaveRequest {
  id: string;
  user_id: string;
  user_name?: string;
  leave_type: LeaveRequestType;
  start_date: string;
  end_date: string;
  hours: number;
  days: number;
  reason: string;
  status: LeaveRequestStatus;
  approved_by: string | null;
  approved_at: string | null;
  reject_reason: string | null;
  branch: string;
  department: string;
  created_at: string;
  updated_at: string;
}

export interface LeaveBalance {
  total_days: number;
  used_days: number;
  monthly_days: number;
  monthly_used: number;
  leave_type: 'monthly' | 'annual';
  hire_date: string;
  months_since_hire: number;
  annual_remaining: number;
  monthly_remaining: number;
  total_remaining: number;
  salary: number;
  refund_amount: number;
  entitlement: {
    type: 'monthly' | 'annual';
    totalAnnual: number;
    totalMonthly: number;
  };
  promotion_alert: boolean;
}

export interface SalesEvaluation {
  id: string;
  user_id: string;
  user_name?: string;
  branch?: string;
  department?: string;
  period_start: string;
  period_end: string;
  standard_sales: number;
  total_sales: number;
  met_target: number;
  consecutive_misses: number;
  salary?: number;
  grade?: string;
  created_at?: string;
}
