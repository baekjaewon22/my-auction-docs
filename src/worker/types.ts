export type Role = 'master' | 'ceo' | 'cc_ref' | 'admin' | 'accountant' | 'accountant_asst' | 'manager' | 'member';
export type DocStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

export const BRANCHES = ['의정부', '서초'] as const;
export const DEPARTMENTS = ['경매사업부1팀', '경매사업부2팀', '경매사업부3팀'] as const;

export interface User {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  phone: string;
  role: Role;
  team_id: string | null;
  branch: string;
  department: string;
  position_title: string;
  hire_date: string;
  approved: number;
  created_at: string;
  updated_at: string;
}

export interface Team {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface Template {
  id: string;
  title: string;
  description: string;
  content: string;
  category: string;
  created_by: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface Document {
  id: string;
  title: string;
  content: string;
  template_id: string | null;
  author_id: string;
  team_id: string | null;
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
  signature_data: string;
  ip_address: string | null;
  user_agent: string | null;
  signed_at: string;
}

export interface DocumentLog {
  id: string;
  document_id: string;
  user_id: string;
  action: string;
  details: string;
  created_at: string;
}

export interface OrgNode {
  id: string;
  label: string;
  user_id: string | null;
  parent_id: string | null;
  tier: number;
  sort_order: number;
  created_at: string;
}

export interface ApprovalStep {
  id: string;
  document_id: string;
  step_order: number;
  approver_id: string;
  status: 'pending' | 'approved' | 'rejected';
  comment: string | null;
  signed_at: string | null;
}

export interface ApprovalCC {
  id: string;
  cc_user_id: string;
  created_by: string;
  created_at: string;
}

export interface JwtPayload {
  sub: string;
  email: string;
  name: string;
  phone: string;
  role: Role;
  team_id: string | null;
  branch: string;
  department: string;
}

export interface AuthEnv {
  Bindings: Env;
  Variables: {
    user: JwtPayload;
  };
}
