import { branchAliases, normalizeBranchName } from './branchAliases';
import type { JwtPayload } from '../types';

const ADMIN_EXTRA_BRANCHES: Record<string, string[]> = {
  // 진성헌(서초·admin·본부장): 서초 + 대전 열람
  'c32c3021-b8f6-42f8-b977-7e6e53a7e6f6': ['대전지사'],
};

export async function ensureBranchApprovalOverridesTable(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS branch_approval_overrides (
      id TEXT PRIMARY KEY,
      branch TEXT NOT NULL UNIQUE,
      approver_id TEXT NOT NULL,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
      FOREIGN KEY (approver_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_branch_approval_overrides_branch ON branch_approval_overrides(branch)').run();
}

export async function applyBranchApprovalOverride(
  db: D1Database,
  chain: string[],
  authorId: string,
  authorBranch: unknown,
): Promise<{ chain: string[]; addedApproverId: string | null }> {
  const branch = normalizeBranchName(authorBranch);
  if (!branch) return { chain, addedApproverId: null };

  await ensureBranchApprovalOverridesTable(db);
  const override = await db.prepare(`
    SELECT bao.approver_id
    FROM branch_approval_overrides bao
    JOIN users u ON u.id = bao.approver_id
    WHERE bao.branch = ?
      AND u.approved = 1
      AND u.role != 'resigned'
    LIMIT 1
  `).bind(branch).first<{ approver_id: string }>();

  const approverId = override?.approver_id || '';
  if (!approverId || approverId === authorId || chain.includes(approverId)) {
    return { chain, addedApproverId: null };
  }

  let insertAt = chain.length;
  if (chain.length > 0) {
    const placeholders = chain.map(() => '?').join(',');
    const users = await db.prepare(`
      SELECT id, role
      FROM users
      WHERE id IN (${placeholders})
    `).bind(...chain).all<{ id: string; role: string }>();
    const roleById = new Map((users.results || []).map((user) => [user.id, user.role]));
    const topRoleIndex = chain.findIndex((id) => ['master', 'ceo', 'cc_ref'].includes(roleById.get(id) || ''));
    if (topRoleIndex >= 0) insertAt = topRoleIndex;
  }

  return {
    chain: [...chain.slice(0, insertAt), approverId, ...chain.slice(insertAt)],
    addedApproverId: approverId,
  };
}

export async function getBranchApprovalBranchesForUser(
  db: D1Database,
  userId: string,
): Promise<string[]> {
  await ensureBranchApprovalOverridesTable(db);
  const result = await db.prepare(`
    SELECT branch
    FROM branch_approval_overrides
    WHERE approver_id = ?
  `).bind(userId).all<{ branch: string }>();

  return Array.from(new Set(
    (result.results || [])
      .map((row) => normalizeBranchName(row.branch))
      .filter(Boolean),
  ));
}

export async function getAdminVisibleBranches(
  db: D1Database,
  user: Pick<JwtPayload, 'sub' | 'branch'>,
  fallbackExtraBranches: string[] = [],
): Promise<string[]> {
  const canonicalBranches = [
    normalizeBranchName(user.branch),
    ...(ADMIN_EXTRA_BRANCHES[user.sub] || []).map((branch) => normalizeBranchName(branch)),
    ...fallbackExtraBranches.map((branch) => normalizeBranchName(branch)),
    ...(await getBranchApprovalBranchesForUser(db, user.sub)),
  ].filter(Boolean);

  return Array.from(new Set(
    canonicalBranches.flatMap((branch) => branchAliases(branch)),
  ));
}
