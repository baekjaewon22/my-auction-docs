import webpush from 'web-push';
import { isExpiredPushStatus } from '../../shared/web-push';

type PushSubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth_key: string;
};

export type WebPushMessage = {
  userId: string;
  eventType: 'community_direct' | 'community_reply' | 'cooperation_direct' | 'cooperation_reply';
  title: string;
  body: string;
  url: string;
  tag: string;
};

function statusCodeOf(error: unknown): number | null {
  const status = Number((error as { statusCode?: unknown })?.statusCode);
  return Number.isFinite(status) && status > 0 ? status : null;
}

function safeDeliveryCode(error: unknown): string {
  const status = statusCodeOf(error);
  if (status) return `push_http_${status}`;
  const name = String((error as { name?: unknown })?.name || 'push_error').replace(/[^a-zA-Z0-9_-]/g, '');
  return name.slice(0, 60) || 'push_error';
}

function isConfigured(env: Env): boolean {
  return Boolean(String(env.VAPID_SUBJECT || '').trim() && String(env.VAPID_PUBLIC_KEY || '').trim() && String(env.VAPID_PRIVATE_KEY || '').trim());
}

export async function sendWebPushToUser(db: D1Database, env: Env, message: WebPushMessage): Promise<{ sent: number; failed: number }> {
  if (!message.userId || !isConfigured(env)) return { sent: 0, failed: 0 };
  const result = await db.prepare(`
    SELECT id, endpoint, p256dh, auth_key
    FROM web_push_subscriptions
    WHERE user_id = ? AND active = 1
    ORDER BY updated_at DESC
    LIMIT 10
  `).bind(message.userId).all<PushSubscriptionRow>();
  const subscriptions = result.results || [];
  if (!subscriptions.length) return { sent: 0, failed: 0 };

  webpush.setVapidDetails(String(env.VAPID_SUBJECT), String(env.VAPID_PUBLIC_KEY), String(env.VAPID_PRIVATE_KEY));
  const payload = JSON.stringify({
    title: message.title.slice(0, 100),
    body: message.body.slice(0, 240),
    url: message.url,
    tag: message.tag.slice(0, 120),
  });
  const attemptId = crypto.randomUUID();
  let sent = 0;
  let failed = 0;

  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth_key },
      }, payload, { TTL: 300 });
      sent += 1;
      await db.batch([
        db.prepare(`UPDATE web_push_subscriptions SET last_success_at = datetime('now'), last_failure_code = '', updated_at = datetime('now') WHERE id = ?`).bind(subscription.id),
        db.prepare(`INSERT INTO web_push_delivery_logs (id, user_id, subscription_id, attempt_id, event_type, status) VALUES (?, ?, ?, ?, ?, 'sent')`).bind(crypto.randomUUID(), message.userId, subscription.id, attemptId, message.eventType),
      ]);
    } catch (error) {
      failed += 1;
      const statusCode = statusCodeOf(error);
      const errorCode = safeDeliveryCode(error);
      const active = isExpiredPushStatus(statusCode) ? 0 : 1;
      console.warn('[web-push] targeted delivery failed', { subscription_id: subscription.id, status_code: statusCode, error_code: errorCode });
      await db.batch([
        db.prepare(`UPDATE web_push_subscriptions SET active = ?, last_failure_at = datetime('now'), last_failure_code = ?, updated_at = datetime('now') WHERE id = ?`).bind(active, errorCode, subscription.id),
        db.prepare(`INSERT INTO web_push_delivery_logs (id, user_id, subscription_id, attempt_id, event_type, status, status_code, error_code) VALUES (?, ?, ?, ?, ?, 'failed', ?, ?)`).bind(crypto.randomUUID(), message.userId, subscription.id, attemptId, message.eventType, statusCode, errorCode),
      ]);
    }
  }
  return { sent, failed };
}
