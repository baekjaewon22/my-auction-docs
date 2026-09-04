export interface PayrollInternalMemoAccessUser {
  role?: string | null;
}

export const PAYROLL_INTERNAL_MEMO_ROLES = [
  'master',
  'ceo',
  'accountant',
  'accountant_asst',
] as const;

export const PAYROLL_INTERNAL_MEMO_EDIT_ROLES = [
  'master',
  'accountant',
  'accountant_asst',
] as const;

export function canViewPayrollInternalMemo(
  user: PayrollInternalMemoAccessUser | null | undefined,
): boolean {
  return !!user && (PAYROLL_INTERNAL_MEMO_ROLES as readonly string[]).includes(String(user.role || ''));
}

export function canEditPayrollInternalMemo(
  user: PayrollInternalMemoAccessUser | null | undefined,
): boolean {
  return !!user && (PAYROLL_INTERNAL_MEMO_EDIT_ROLES as readonly string[]).includes(String(user.role || ''));
}
