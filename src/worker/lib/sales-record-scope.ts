import type { JwtPayload } from '../types.ts';
import {
  salesDirectorManagedBranch,
  salesRecordScopeKind,
  type SalesRecordScopeKind,
} from '../../shared/sales-record-scope.ts';
import { branchAliases } from './branchAliases.ts';
import { getAdminVisibleBranches } from './branch-approval-overrides.ts';

type SalesScopeViewer = Pick<JwtPayload, 'sub' | 'name' | 'role' | 'branch' | 'department'>;

export type SalesRecordSqlScope = {
  kind: SalesRecordScopeKind;
  sql: string;
  params: unknown[];
  visibleBranches: string[];
};

function uniqueBranchAliases(branches: unknown[]): string[] {
  return Array.from(new Set(
    branches.flatMap((branch) => branchAliases(branch)).filter(Boolean),
  ));
}

export function buildSalesRecordSqlScope(
  viewer: SalesScopeViewer,
  visibleBranches: string[] = [],
  recordAlias = 'sr',
  ownerAlias = 'u',
): SalesRecordSqlScope {
  const kind = salesRecordScopeKind(viewer);
  if (kind === 'all') return { kind, sql: '', params: [], visibleBranches: [] };

  if (kind === 'self') {
    return {
      kind,
      sql: `${recordAlias}.user_id = ?`,
      params: [viewer.sub],
      visibleBranches: [],
    };
  }

  if (kind === 'team-and-self') {
    return {
      kind,
      sql: `(${recordAlias}.user_id = ? OR (${ownerAlias}.branch = ? AND ${ownerAlias}.department = ?))`,
      params: [viewer.sub, viewer.branch || '', viewer.department || ''],
      visibleBranches: [],
    };
  }

  const branches = uniqueBranchAliases(visibleBranches.length > 0 ? visibleBranches : [viewer.branch]);
  if (branches.length === 0) {
    return {
      kind,
      sql: `${recordAlias}.user_id = ?`,
      params: [viewer.sub],
      visibleBranches: [],
    };
  }

  const placeholders = branches.map(() => '?').join(',');
  return {
    kind,
    sql: `(${recordAlias}.user_id = ? OR ${recordAlias}.branch IN (${placeholders}) OR ${recordAlias}.attribution_branch IN (${placeholders}))`,
    params: [viewer.sub, ...branches, ...branches],
    visibleBranches: branches,
  };
}

export async function resolveSalesRecordSqlScope(
  db: D1Database,
  viewer: SalesScopeViewer,
): Promise<SalesRecordSqlScope> {
  if (salesRecordScopeKind(viewer) !== 'branches-and-self') {
    return buildSalesRecordSqlScope(viewer);
  }

  // director는 결재선 override가 아니라 현재 소속 지사와 본인 매출만 본다.
  // admin은 별도로 부여된 관할 지사(예: 진성헌의 서초·대전)를 함께 본다.
  const visibleBranches = viewer.role === 'director'
    ? branchAliases(salesDirectorManagedBranch(viewer))
    : await getAdminVisibleBranches(db, viewer);

  return buildSalesRecordSqlScope(viewer, visibleBranches);
}
