import type { Document, JwtPayload } from '../types';
import { getAdminVisibleBranches } from './branch-approval-overrides.ts';
import { isHeadOfficeBranch, sameBranchName } from './branchAliases.ts';

type DocumentViewer = Pick<JwtPayload, 'sub' | 'role' | 'branch' | 'department'>;
type DocumentAccessRecord = Pick<Document, 'id' | 'author_id' | 'branch' | 'department' | 'status'>;

const FULL_ACCESS_ROLES = new Set(['master', 'ceo', 'cc_ref', 'accountant', 'accountant_asst']);

export async function getDocumentAccessRecord(
  db: D1Database,
  documentId: string,
): Promise<DocumentAccessRecord | null> {
  return db.prepare(
    'SELECT id, author_id, branch, department, status FROM documents WHERE id = ?'
  ).bind(documentId).first<DocumentAccessRecord>();
}

/** 문서 목록과 상세/서명/결재 부속정보에 동일하게 적용하는 열람 기준. */
export async function canReadDocument(
  db: D1Database,
  user: DocumentViewer,
  doc: DocumentAccessRecord,
  prefetchedAdminBranches?: string[],
): Promise<boolean> {
  if (doc.author_id === user.sub) return true;

  // 초안은 어떤 상위 권한자에게도 노출하지 않는다.
  if (doc.status === 'draft') return false;

  if (FULL_ACCESS_ROLES.has(user.role)) return true;

  const assignedApprover = await db.prepare(
    'SELECT 1 AS allowed FROM approval_steps WHERE document_id = ? AND approver_id = ? LIMIT 1'
  ).bind(doc.id, user.sub).first<{ allowed: number }>();
  if (assignedApprover) return true;

  if (user.role === 'director') {
    return ['대전', '대전지사', '부산', '부산지사'].some((branch) => sameBranchName(doc.branch, branch));
  }

  if (user.role === 'admin') {
    if (isHeadOfficeBranch(user.branch)) return true;
    const visibleBranches = prefetchedAdminBranches ?? await getAdminVisibleBranches(db, user);
    return visibleBranches.some((branch) => sameBranchName(doc.branch, branch));
  }

  if (user.role === 'manager') {
    return sameBranchName(doc.branch, user.branch) && doc.department === user.department;
  }

  // member/support 및 그 밖의 제한 역할은 본인 문서만 볼 수 있다.
  return false;
}
