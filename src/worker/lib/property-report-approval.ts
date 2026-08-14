export const PROPERTY_REPORT_TEMPLATE_ID = 'tpl-work-008';

type ApprovalUser = {
  id: string;
  role: string;
  approved: number;
  login_type?: string | null;
};

function isActiveEmployeeCeo(user: ApprovalUser | null | undefined, authorId: string): boolean {
  return Boolean(
    user
    && user.id !== authorId
    && user.role === 'ceo'
    && Number(user.approved) === 1
    && user.login_type !== 'freelancer',
  );
}

/**
 * 물건분석보고서는 조직도 중간 결재자를 제외하고 대표이사 한 명만 결재자로 둔다.
 * 기존 조직도 결재선에 대표가 있으면 그 사용자를 우선하고, 없으면 활성 대표 계정을 찾는다.
 */
export async function buildPropertyReportApprovalChain(
  db: D1Database,
  authorId: string,
  organizationChain: string[],
): Promise<string[]> {
  for (const candidateId of organizationChain) {
    const candidate = await db.prepare(
      `SELECT id, role, approved, login_type
       FROM users
       WHERE id = ?
       LIMIT 1`,
    ).bind(candidateId).first<ApprovalUser>();
    if (candidate && isActiveEmployeeCeo(candidate, authorId)) return [candidate.id];
  }

  const fallbackCeo = await db.prepare(
    `SELECT id, role, approved, login_type
     FROM users
     WHERE role = 'ceo'
       AND approved = 1
       AND id != ?
       AND COALESCE(login_type, 'employee') != 'freelancer'
     ORDER BY id ASC
     LIMIT 1`,
  ).bind(authorId).first<ApprovalUser>();

  return fallbackCeo && isActiveEmployeeCeo(fallbackCeo, authorId) ? [fallbackCeo.id] : [];
}
