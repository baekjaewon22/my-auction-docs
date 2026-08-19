import { normalizeBranchName } from './branchAliases.ts';

export const PROPERTY_REPORT_TEMPLATE_ID = 'tpl-work-008';

type PropertyReportApproverRule = {
  name: string;
  role: 'admin' | 'director';
};

export const PROPERTY_REPORT_APPROVERS: Record<string, PropertyReportApproverRule> = {
  '의정부본사': { name: '정민호', role: 'admin' },
  '대전지사': { name: '진성헌', role: 'admin' },
  '서초지사': { name: '진성헌', role: 'admin' },
  '부산지사': { name: '서정수', role: 'director' },
};

type ApprovalUser = {
  id: string;
  name: string;
  role: string;
  approved: number;
  login_type?: string | null;
};

/**
 * 물건분석보고서는 지사별 지정 관리자가 실제 결재하고 대표 직인을 사용한다.
 * 지정된 네 지사 외에는 제출할 수 없으며, 대표는 결재선과 알림 수신자에서 제외한다.
 */
export async function buildPropertyReportApprovalChain(
  db: D1Database,
  documentBranch: string,
): Promise<string[]> {
  const rule = PROPERTY_REPORT_APPROVERS[normalizeBranchName(documentBranch)];
  if (!rule) return [];

  const approver = await db.prepare(
    `SELECT id, name, role, approved, login_type
     FROM users
     WHERE name = ?
       AND role = ?
       AND approved = 1
       AND COALESCE(login_type, 'employee') != 'freelancer'
     ORDER BY id ASC
     LIMIT 1`,
  ).bind(rule.name, rule.role).first<ApprovalUser>();

  return approver ? [approver.id] : [];
}
