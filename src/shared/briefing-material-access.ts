import {
  isEvictionTeamMember,
  JEONG_MINHO_USER_ID,
} from './eviction-quote-access.ts';

export interface BriefingMaterialAccessUser {
  role?: string | null;
  id?: string | null;
  department?: string | null;
  team_name?: string | null;
  login_type?: string | null;
}

const BRIEFING_MATERIAL_MANAGEMENT_ROLES = ['master', 'ceo', 'cc_ref'] as const;

function isBriefingMaterialManager(user: BriefingMaterialAccessUser): boolean {
  return (BRIEFING_MATERIAL_MANAGEMENT_ROLES as readonly string[]).includes(String(user.role || ''))
    || String(user.id || '') === JEONG_MINHO_USER_ID;
}

export function canViewBriefingMaterial(
  user: BriefingMaterialAccessUser | null | undefined,
): boolean {
  if (!user) return false;
  return isBriefingMaterialManager(user) || isEvictionTeamMember({
    department: user.department,
    teamName: user.team_name,
  });
}

export function canUploadBriefingMaterial(
  user: BriefingMaterialAccessUser | null | undefined,
): boolean {
  return !!user && isBriefingMaterialManager(user);
}
