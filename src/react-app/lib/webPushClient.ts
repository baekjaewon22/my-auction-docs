import { api } from '../api';

export function webPushPostponeKey(userId: string): string {
  return `web-push-consent-postpone-until:${userId}`;
}

export function webPushOptOutKey(userId: string): string {
  return `web-push-consent-opt-out:${userId}`;
}

export function clearWebPushPromptSuppression(userId: string): void {
  localStorage.removeItem(webPushPostponeKey(userId));
  localStorage.removeItem(webPushOptOutKey(userId));
}

export function base64UrlToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

export function webPushDeviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iPhone/iPad';
  if (/Android/i.test(ua)) return 'Android Chrome';
  if (/Windows/i.test(ua)) return 'Windows Chrome';
  if (/Macintosh/i.test(ua)) return 'Mac';
  return '웹 브라우저';
}

export function browserSupportsWebPush(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function sameApplicationServerKey(
  subscription: PushSubscription,
  expected: Uint8Array<ArrayBuffer>,
): boolean {
  const current = subscription.options.applicationServerKey;
  if (!current) return false;
  const bytes = new Uint8Array(current);
  return bytes.length === expected.length && bytes.every((value, index) => value === expected[index]);
}

export async function currentWebPushSubscription(): Promise<PushSubscription | null> {
  if (!browserSupportsWebPush()) return null;
  const registration = await navigator.serviceWorker.getRegistration('/');
  return registration?.pushManager.getSubscription() || null;
}

export async function enableWebPush(publicKey: string): Promise<PushSubscription> {
  const nextPermission = await Notification.requestPermission();
  if (nextPermission !== 'granted') throw new Error('브라우저 알림 권한이 허용되지 않았습니다.');

  const registration = await navigator.serviceWorker.register('/push-sw.js', { scope: '/' });
  const expectedKey = base64UrlToUint8Array(publicKey);
  let subscription = await registration.pushManager.getSubscription();
  if (subscription && !sameApplicationServerKey(subscription, expectedKey)) {
    await api.webPush.unsubscribe(subscription.endpoint).catch(() => undefined);
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription = subscription || await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: expectedKey,
  });
  await api.webPush.subscribe(subscription.toJSON(), webPushDeviceLabel());
  return subscription;
}
