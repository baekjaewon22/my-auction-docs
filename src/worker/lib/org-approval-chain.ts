import type { OrgNode } from '../types';
import { applyBranchApprovalOverride } from './branch-approval-overrides';

type OrgApproverUser = {
  id: string;
  login_type?: string;
  role?: string;
  approved?: number;
};

export function orgApprovalMaxSteps(role: string): number {
  return role === 'admin' ? 1 : role === 'manager' ? 2 : 3;
}

function canUseOrgApprover(user: OrgApproverUser | null | undefined): boolean {
  if (!user) return false;
  if (user.approved !== undefined && Number(user.approved) !== 1) return false;
  if (user.login_type === 'freelancer') return false;
  if (user.role === 'freelancer') return false;
  if (user.role === 'support') return false;
  if (user.role === 'resigned') return false;
  return true;
}

export async function buildOrgApprovalChain(
  db: D1Database,
  authorId: string,
  options: {
    maxSteps?: number;
    applyBranchOverride?: boolean;
    includeCcFallbackForTopNode?: boolean;
  } = {},
): Promise<string[]> {
  const userNode = await db.prepare(
    'SELECT * FROM org_nodes WHERE user_id = ?'
  ).bind(authorId).first<OrgNode>();
  if (!userNode) return [];

  const author = await db.prepare(
    'SELECT role, branch FROM users WHERE id = ?'
  ).bind(authorId).first<{ role: string; branch: string }>();
  if (!author) return [];

  const chain: string[] = [];
  const maxSteps = options.maxSteps ?? orgApprovalMaxSteps(author.role || '');
  let currentParentId = userNode.parent_id;
  let guard = 0;

  while (currentParentId && chain.length < maxSteps && guard < 50) {
    guard += 1;
    const parentNode = await db.prepare(
      'SELECT * FROM org_nodes WHERE id = ?'
    ).bind(currentParentId).first<OrgNode>();
    if (!parentNode) break;

    if (parentNode.user_id && parentNode.user_id !== authorId) {
      const approver = await db.prepare(
        'SELECT id, login_type, role, approved FROM users WHERE id = ?'
      ).bind(parentNode.user_id).first<OrgApproverUser>();
      if (canUseOrgApprover(approver)) {
        chain.push(parentNode.user_id);
      }
    }

    currentParentId = parentNode.parent_id;
  }

  if (options.applyBranchOverride !== false) {
    const overrideResult = await applyBranchApprovalOverride(db, chain, authorId, author.branch);
    chain.splice(0, chain.length, ...overrideResult.chain);
  }

  if (options.includeCcFallbackForTopNode !== false && chain.length === 0 && userNode.tier <= 2) {
    const ccList = await db.prepare(
      'SELECT cc_user_id FROM approval_cc'
    ).all<{ cc_user_id: string }>();
    if (ccList.results) {
      for (const cc of ccList.results) {
        if (cc.cc_user_id && cc.cc_user_id !== authorId && !chain.includes(cc.cc_user_id)) {
          chain.push(cc.cc_user_id);
        }
      }
    }
  }

  return chain;
}
