export function canUseSalesVatView(role: string | null | undefined): boolean {
  return role === 'master' || role === 'accountant';
}

export function salesDisplayAmount(amount: number, excludeVat: boolean): number {
  const value = Number(amount) || 0;
  return excludeVat ? Math.round(value / 1.1) : value;
}
