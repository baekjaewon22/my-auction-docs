import { Hono } from 'hono';
import webpush from 'web-push';
import type { AuthEnv } from '../types';
import { authMiddleware, requireHumanMaster, requireHumanUser } from '../middleware/auth';
import {
  isExpiredPushStatus,
  redactPushSecrets,
  validatePushEndpoint,
  validatePushKey,
} from '../../shared/web-push';

type PushSubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth_key: string;
};

const webPush = new Hono<AuthEnv>();
webPush.use('*', authMiddleware);

function pushConfig(env: Env): { supported: boolean; publicKey: string; reason?: string } {
  const publicKey = String(env.VAPID_PUBLIC_KEY || '').trim();
  const privateKey = String(env.VAPID_PRIVATE_KEY || '').trim();
  const subject = String(env.VAPID_SUBJECT || '').trim();
  if (!publicKey || !privateKey || !subject) {
    return { supported: false, publicKey: '', reason: 'not_configured' };
  }
  if (!/^(mailto:|https:\/\/)/i.test(subject)) {
    return { supported: false, publicKey: '', reason: 'invalid_subject' };
  }
  return { supported: true, publicKey };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function cleanLabel(value: unknown): string {
  return Array.from(String(value || ''))
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join('')
    .trim()
    .slice(0, 80);
}

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

webPush.get('/config', requireHumanUser(), (c) => {
  const config = pushConfig(c.env);
  return c.json(config.supported
    ? { supported: true, public_key: config.publicKey }
    : { supported: false, reason: config.reason });
});

webPush.get('/subscriptions', requireHumanUser(), async (c) => {
  const user = c.get('user');
  const result = await c.env.DB.prepare(`
    SELECT id, provider, device_label, active, last_success_at, last_failure_at,
           last_failure_code, created_at, updated_at
    FROM web_push_subscriptions
    WHERE user_id = ?
    ORDER BY active DESC, updated_at DESC
  `).bind(user.sub).all();
  return c.json({ subscriptions: result.results || [] });
});

webPush.post('/subscriptions', requireHumanUser(), async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{
    subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    device_label?: string;
  }>();
  let validated: ReturnType<typeof validatePushEndpoint>;
  let p256dh: string;
  let authKey: string;
  try {
    validated = validatePushEndpoint(body.subscription?.endpoint);
    p256dh = validatePushKey(body.subscription?.keys?.p256dh, 'p256dh');
    authKey = validatePushKey(body.subscription?.keys?.auth, 'auth');
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : '유효하지 않은 푸시 구독 정보입니다.' }, 400);
  }
  const endpointHash = await sha256Hex(validated.endpoint);
  const existing = await c.env.DB.prepare(`
    SELECT id, user_id FROM web_push_subscriptions WHERE endpoint_hash = ? LIMIT 1
  `).bind(endpointHash).first<{ id: string; user_id: string }>();
  const id = existing?.id || crypto.randomUUID();
  const action = !existing ? 'created' : existing.user_id === user.sub ? 'refreshed' : 'transferred';

  await c.env.DB.batch([
    c.env.DB.prepare(`
      INSERT INTO web_push_subscriptions
        (id, user_id, endpoint, endpoint_hash, p256dh, auth_key, provider, device_label, user_agent, active, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))
      ON CONFLICT(endpoint_hash) DO UPDATE SET
        user_id = excluded.user_id,
        endpoint = excluded.endpoint,
        p256dh = excluded.p256dh,
        auth_key = excluded.auth_key,
        provider = excluded.provider,
        device_label = excluded.device_label,
        user_agent = excluded.user_agent,
        active = 1,
        last_failure_code = '',
        updated_at = datetime('now')
    `).bind(
      id, user.sub, validated.endpoint, endpointHash, p256dh, authKey, validated.provider,
      cleanLabel(body.device_label), cleanLabel(c.req.header('User-Agent')),
    ),
    c.env.DB.prepare(`
      INSERT INTO web_push_subscription_audit
        (id, endpoint_hash, previous_user_id, new_user_id, action)
      VALUES (?, ?, ?, ?, ?)
    `).bind(crypto.randomUUID(), endpointHash, existing?.user_id || null, user.sub, action),
  ]);

  return c.json({ success: true, subscription_id: id });
});

webPush.delete('/subscriptions', requireHumanUser(), async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ endpoint?: string }>();
  let validated: ReturnType<typeof validatePushEndpoint>;
  try {
    validated = validatePushEndpoint(body.endpoint);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : '유효하지 않은 푸시 구독 정보입니다.' }, 400);
  }
  const endpointHash = await sha256Hex(validated.endpoint);
  const existing = await c.env.DB.prepare(`
    SELECT id FROM web_push_subscriptions WHERE endpoint_hash = ? AND user_id = ? LIMIT 1
  `).bind(endpointHash, user.sub).first<{ id: string }>();
  if (existing) {
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM web_push_subscriptions WHERE id = ? AND user_id = ?').bind(existing.id, user.sub),
      c.env.DB.prepare(`
        INSERT INTO web_push_subscription_audit (id, endpoint_hash, previous_user_id, new_user_id, action)
        VALUES (?, ?, ?, NULL, 'unsubscribed')
      `).bind(crypto.randomUUID(), endpointHash, user.sub),
    ]);
  }
  return c.json({ success: true });
});

webPush.post('/self-test', requireHumanUser(), async (c) => {
  const user = c.get('user');
  const config = pushConfig(c.env);
  if (!config.supported) return c.json({ supported: false, reason: config.reason });

  const recent = await c.env.DB.prepare(`
    SELECT COUNT(DISTINCT attempt_id) AS count FROM web_push_delivery_logs
    WHERE user_id = ? AND event_type = 'self_test' AND created_at >= datetime('now', '-1 minute')
      AND attempt_id != ''
  `).bind(user.sub).first<{ count: number }>();
  if (Number(recent?.count || 0) >= 3) {
    return c.json({ error: '시험 알림은 1분에 3회까지 보낼 수 있습니다.' }, 429);
  }

  const result = await c.env.DB.prepare(`
    SELECT id, endpoint, p256dh, auth_key
    FROM web_push_subscriptions
    WHERE user_id = ? AND active = 1
    ORDER BY updated_at DESC
    LIMIT 10
  `).bind(user.sub).all<PushSubscriptionRow>();
  const subscriptions = result.results || [];
  if (!subscriptions.length) return c.json({ error: '활성화된 알림 기기가 없습니다.' }, 400);

  webpush.setVapidDetails(
    String(c.env.VAPID_SUBJECT),
    String(c.env.VAPID_PUBLIC_KEY),
    String(c.env.VAPID_PRIVATE_KEY),
  );
  const payload = JSON.stringify({
    title: '웹푸시 연결 확인',
    body: `${user.name || '사용자'}님의 알림 연결이 정상입니다.`,
    tag: `self-test-${Date.now()}`,
    url: '/profile',
  });
  let sent = 0;
  let failed = 0;
  const attemptId = crypto.randomUUID();

  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth_key },
      }, payload, { TTL: 60 });
      sent += 1;
      await c.env.DB.batch([
        c.env.DB.prepare(`UPDATE web_push_subscriptions SET last_success_at = datetime('now'), last_failure_code = '', updated_at = datetime('now') WHERE id = ?`).bind(subscription.id),
        c.env.DB.prepare(`INSERT INTO web_push_delivery_logs (id, user_id, subscription_id, attempt_id, event_type, status) VALUES (?, ?, ?, ?, 'self_test', 'sent')`).bind(crypto.randomUUID(), user.sub, subscription.id, attemptId),
      ]);
    } catch (error) {
      failed += 1;
      const statusCode = statusCodeOf(error);
      const errorCode = safeDeliveryCode(error);
      const active = isExpiredPushStatus(statusCode) ? 0 : 1;
      console.warn('[web-push] delivery failed', { subscription_id: subscription.id, status_code: statusCode, error_code: errorCode });
      await c.env.DB.batch([
        c.env.DB.prepare(`UPDATE web_push_subscriptions SET active = ?, last_failure_at = datetime('now'), last_failure_code = ?, updated_at = datetime('now') WHERE id = ?`).bind(active, errorCode, subscription.id),
        c.env.DB.prepare(`INSERT INTO web_push_delivery_logs (id, user_id, subscription_id, attempt_id, event_type, status, status_code, error_code) VALUES (?, ?, ?, ?, 'self_test', 'failed', ?, ?)`).bind(crypto.randomUUID(), user.sub, subscription.id, attemptId, statusCode, errorCode),
      ]);
    }
  }

  return c.json({ supported: true, sent, failed });
});

webPush.get('/diagnostics', requireHumanMaster(), async (c) => {
  const summary = await c.env.DB.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) AS active,
      COUNT(DISTINCT CASE WHEN active = 1 THEN user_id END) AS active_users
    FROM web_push_subscriptions
  `).first();
  const recent = await c.env.DB.prepare(`
    SELECT l.id, l.event_type, l.status, l.status_code, l.error_code, l.created_at,
           u.name AS user_name, s.provider, s.device_label
    FROM web_push_delivery_logs l
    LEFT JOIN users u ON u.id = l.user_id
    LEFT JOIN web_push_subscriptions s ON s.id = l.subscription_id
    ORDER BY l.created_at DESC
    LIMIT 50
  `).all();
  return c.json({
    configured: pushConfig(c.env).supported,
    summary: summary || { total: 0, active: 0, active_users: 0 },
    recent: recent.results || [],
  });
});

webPush.onError((error, c) => {
  console.error('[web-push] request failed', redactPushSecrets(error instanceof Error ? error.message : error));
  return c.json({ error: '웹푸시 요청을 처리하지 못했습니다.' }, 500);
});

export default webPush;
