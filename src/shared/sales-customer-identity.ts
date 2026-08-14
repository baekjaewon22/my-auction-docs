export type SalesCustomerIdentityRecord = {
  id: string;
  user_id: string;
  type: string;
  client_name?: string | null;
  client_phone?: string | null;
  status?: string | null;
};

export function normalizeCustomerName(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, '').toLowerCase();
}

export function normalizeCustomerPhone(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

export function isValidCustomerPhone(value: unknown): boolean {
  const digits = normalizeCustomerPhone(value);
  return digits.length >= 10 && digits.length <= 11;
}

export function matchingCustomerContracts<T extends SalesCustomerIdentityRecord>(
  records: T[],
  ownerId: string,
  customerName: string,
): T[] {
  const normalizedName = normalizeCustomerName(customerName);
  if (!ownerId || !normalizedName) return [];
  return records.filter((record) =>
    record.user_id === ownerId
    && record.type === '계약'
    && record.status !== 'refunded'
    && normalizeCustomerName(record.client_name) === normalizedName
    && isValidCustomerPhone(record.client_phone)
  );
}

export function uniqueContractPhones<T extends SalesCustomerIdentityRecord>(
  records: T[],
  ownerId: string,
  customerName: string,
): string[] {
  const phones = new Map<string, string>();
  for (const record of matchingCustomerContracts(records, ownerId, customerName)) {
    const digits = normalizeCustomerPhone(record.client_phone);
    if (!phones.has(digits)) phones.set(digits, String(record.client_phone || '').trim());
  }
  return [...phones.values()];
}

export function findContractByCustomerIdentity<T extends SalesCustomerIdentityRecord>(
  records: T[],
  ownerId: string,
  customerName: string,
  customerPhone: string,
): T | undefined {
  const phone = normalizeCustomerPhone(customerPhone);
  if (!isValidCustomerPhone(phone)) return undefined;
  return matchingCustomerContracts(records, ownerId, customerName)
    .find((record) => normalizeCustomerPhone(record.client_phone) === phone);
}
