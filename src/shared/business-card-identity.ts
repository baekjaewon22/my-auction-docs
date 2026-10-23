import { normalizeCard, registrationCard, syncCardProfile, type BusinessCard, type CardProfile } from './business-card.ts';

export const editableCardIdentity = ['name', 'title', 'department', 'branch', 'phone'] as const;
type Overrides = Partial<Pick<BusinessCard, typeof editableCardIdentity[number]>>;
type StoredCard = BusinessCard & { identityOverrides: Overrides };

// Only call with a document read from storage, never with client-provided metadata.
export function resolveStoredCard(stored: unknown, profile: CardProfile): BusinessCard {
  const card = syncCardProfile(stored, profile);
  const overrides = (stored as Partial<StoredCard>).identityOverrides;
  if (overrides && typeof overrides === 'object') {
    for (const key of editableCardIdentity) {
      if (typeof overrides[key] === 'string') card[key] = overrides[key]!;
    }
  }
  return card;
}

export function prepareCardIdentity(input: unknown, profile: CardProfile, stored: unknown, role: string): StoredCard {
  const trusted = resolveStoredCard(stored, profile);
  const card = syncCardProfile(input, profile);
  for (const key of editableCardIdentity) {
    card[key] = role === 'master' ? (input as BusinessCard)[key] : trusted[key];
  }
  const normalized = normalizeCard(card);
  const defaults = registrationCard(profile);
  const identityOverrides: Overrides = {};
  for (const key of editableCardIdentity) {
    if (normalized[key] !== defaults[key]) identityOverrides[key] = normalized[key];
  }
  return { ...normalized, identityOverrides };
}
