export type VideoProductionType = 'short_form' | 'long_form';
export type VideoProductionStatus = 'requested' | 'confirmed';

export const VIDEO_PRODUCTION_ALLOWED_ROLES = ['master', 'ceo', 'accountant'] as const;

export const VIDEO_PRODUCTION_DEFAULT_AMOUNTS: Record<VideoProductionType, number> = {
  short_form: 30000,
  long_form: 200000,
};

export const VIDEO_PRODUCTION_TYPE_LABELS: Record<VideoProductionType, string> = {
  short_form: '숏폼',
  long_form: '롱폼',
};

export const VIDEO_PRODUCTION_STATUS_LABELS: Record<VideoProductionStatus, string> = {
  requested: '의뢰',
  confirmed: '확정',
};

export type VideoProductionAccessUser = {
  role?: string | null;
  login_type?: string | null;
  auth_type?: string | null;
} | null | undefined;

export type VideoProductionSettlementUser = {
  department?: string | null;
  team_name?: string | null;
} | null | undefined;

export function canManageVideoProduction(user: VideoProductionAccessUser): boolean {
  if (!user) return false;
  if (user.auth_type && user.auth_type !== 'user') return false;
  if (user.login_type === 'freelancer' && user.role !== 'master') return false;
  return VIDEO_PRODUCTION_ALLOWED_ROLES.includes(user.role as typeof VIDEO_PRODUCTION_ALLOWED_ROLES[number]);
}

function normalizeAffiliation(value: unknown): string {
  return String(value || '').replace(/\s+/g, '').trim();
}

export function isExternalVideoProductionAssignee(user: VideoProductionSettlementUser): boolean {
  if (!user) return false;
  return normalizeAffiliation(user.department) === '외부'
    || normalizeAffiliation(user.team_name) === '외부';
}

export function normalizeVideoProductionType(value: unknown): VideoProductionType {
  return value === 'long_form' ? 'long_form' : 'short_form';
}

export function normalizeVideoProductionStatus(value: unknown): VideoProductionStatus {
  return value === 'confirmed' ? 'confirmed' : 'requested';
}

export function videoProductionDefaultAmount(type: unknown): number {
  return VIDEO_PRODUCTION_DEFAULT_AMOUNTS[normalizeVideoProductionType(type)];
}

export function calculateVideoProductionWithholding(amount: unknown): number {
  const gross = Math.max(Number(amount) || 0, 0);
  return Math.trunc((gross * 0.033) / 10) * 10;
}

export function calculateVideoProductionNet(amount: unknown): number {
  const gross = Math.max(Number(amount) || 0, 0);
  return gross - calculateVideoProductionWithholding(gross);
}
