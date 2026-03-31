export type Role = 'master' | 'ceo' | 'admin' | 'manager' | 'member';
export type DocStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

export const BRANCHES = ['의정부', '서초'] as const;
export const DEPARTMENTS = ['경매사업부1팀', '경매사업부2팀', '경매사업부3팀'] as const;

export const ROLE_LABELS: Record<Role, string> = {
  master: '마스터',
  ceo: '대표',
  admin: '관리자',
  manager: '팀장',
  member: '팀원',
};

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
