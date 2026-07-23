export const MIN_PASSWORD_LENGTH = 8;
// Cloudflare Workers WebCrypto rejects PBKDF2 iteration counts above 100,000.
export const PBKDF2_ITERATIONS = 100_000;
const HASH_PREFIX = 'pbkdf2-sha256';
const LEGACY_SALT = 'auction-docs-salt';

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function derivePassword(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), { name: 'PBKDF2' }, false, ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256,
  );
  return new Uint8Array(bits);
}

async function legacyHashPassword(password: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password + LEGACY_SALT));
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derived = await derivePassword(password, salt, PBKDF2_ITERATIONS);
  return `${HASH_PREFIX}$${PBKDF2_ITERATIONS}$${bytesToBase64Url(salt)}$${bytesToBase64Url(derived)}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (!storedHash.startsWith(`${HASH_PREFIX}$`)) {
    const legacy = await legacyHashPassword(password);
    return constantTimeEqual(new TextEncoder().encode(legacy), new TextEncoder().encode(storedHash));
  }

  const [prefix, iterationText, saltText, hashText] = storedHash.split('$');
  const iterations = Number(iterationText);
  if (prefix !== HASH_PREFIX || iterations !== PBKDF2_ITERATIONS || !saltText || !hashText) {
    return false;
  }
  try {
    const expected = base64UrlToBytes(hashText);
    const actual = await derivePassword(password, base64UrlToBytes(saltText), iterations);
    return constantTimeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function passwordNeedsRehash(storedHash: string): boolean {
  if (!storedHash.startsWith(`${HASH_PREFIX}$`)) return true;
  const iterations = Number(storedHash.split('$')[1]);
  return iterations !== PBKDF2_ITERATIONS;
}

export function createSecureToken(byteLength = 32): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export function createSixDigitCode(): string {
  const values = crypto.getRandomValues(new Uint32Array(1));
  return String(100_000 + (values[0] % 900_000));
}

export async function hashResetSecret(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}
