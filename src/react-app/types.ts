export type Role = 'master' | 'ceo' | 'cc_ref' | 'admin' | 'manager' | 'member';
export type DocStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

export const BRANCHES = ['의정부', '서초'] as const;
export const DEPARTMENTS = ['경매사업부1팀', '경매사업부2팀', '경매사업부3팀'] as const;

export const ROLE_LABELS: Record<Role, string> = {
  master: '마스터',
  ceo: '대표',
  cc_ref: 'CC참조자',
  admin: '관리자',
  manager: '팀장',
  member: '팀원',
};

// UI에서 표시할 역할 (master 제외)
export const VISIBLE_ROLES: Role[] = ['ceo', 'cc_ref', 'admin', 'manager', 'member'];

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
  created_at?: string;
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
