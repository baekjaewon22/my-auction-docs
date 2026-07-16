export const PUSH_ENDPOINT_MAX_LENGTH = 2048;

const ALLOWED_PUSH_HOSTS = new Set([
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'push.services.mozilla.com',
  'web.push.apple.com',
]);

function isIpLiteral(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '');
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

export function isAllowedPushHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return ALLOWED_PUSH_HOSTS.has(host) || host.endsWith('.notify.windows.com');
}

export function validatePushEndpoint(value: unknown): { endpoint: string; provider: string } {
  const raw = String(value || '').trim();
  if (!raw || raw.length > PUSH_ENDPOINT_MAX_LENGTH) throw new Error('유효하지 않은 푸시 구독 주소입니다.');

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('유효하지 않은 푸시 구독 주소입니다.');
  }

  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    isIpLiteral(url.hostname) ||
    !isAllowedPushHost(url.hostname)
  ) {
    throw new Error('허용되지 않은 푸시 서비스 주소입니다.');
  }

  return { endpoint: url.toString(), provider: url.hostname.toLowerCase() };
}

export function validatePushKey(value: unknown, field: 'p256dh' | 'auth'): string {
  const raw = String(value || '').trim();
  const min = field === 'p256dh' ? 40 : 8;
  const max = field === 'p256dh' ? 256 : 128;
  if (raw.length < min || raw.length > max || !/^[A-Za-z0-9_-]+$/.test(raw)) {
    throw new Error('유효하지 않은 푸시 암호화 키입니다.');
  }
  return raw;
}

export function isExpiredPushStatus(statusCode: unknown): boolean {
  return Number(statusCode) === 404 || Number(statusCode) === 410;
}

export function redactPushSecrets(value: unknown): string {
  return String(value || '')
    .replace(/https:\/\/[^\s"']+/gi, '[push-endpoint-redacted]')
    .replace(/("?(?:p256dh|auth|endpoint)"?\s*[:=]\s*)[^,}\s]+/gi, '$1[redacted]')
    .slice(0, 500);
}
