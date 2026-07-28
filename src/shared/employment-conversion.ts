export const FREELANCER_CONVERTIBLE_ROLES = new Set([
  'director',
  'manager',
  'member',
]);

export type FreelancerConversionImpact = {
  pending_leave_requests: number;
  pending_approval_steps: number;
  documents: number;
  non_myauction_documents: number;
  active_non_myauction_documents: number;
  sales_records: number;
  cases: number;
  org_nodes: number;
  annual_leave_total: number;
  annual_leave_used: number;
};

export function canConvertEmployeeRoleToFreelancer(role: string): boolean {
  return FREELANCER_CONVERTIBLE_ROLES.has(role);
}

export function normalizeCommissionRate(value: unknown): number | null {
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate <= 0 || rate > 100) return null;
  return Math.round(rate * 100) / 100;
}

export function freelancerConversionBlockers(
  impact: Pick<
    FreelancerConversionImpact,
    'pending_leave_requests' | 'pending_approval_steps' | 'active_non_myauction_documents'
  >,
): string[] {
  const blockers: string[] = [];
  if (impact.pending_leave_requests > 0) {
    blockers.push(`처리 중인 휴가 요청 ${impact.pending_leave_requests}건`);
  }
  if (impact.pending_approval_steps > 0) {
    blockers.push(`승인 대기 결재 ${impact.pending_approval_steps}건`);
  }
  if (impact.active_non_myauction_documents > 0) {
    blockers.push(`처리 중인 사내 문서 ${impact.active_non_myauction_documents}건`);
  }
  return blockers;
}
