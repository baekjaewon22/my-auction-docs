import webpush from 'web-push';

function randomBase64Url(bytes: number): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export default {
  async fetch(): Promise<Response> {
    const vapid = webpush.generateVAPIDKeys();
    const receiver = webpush.generateVAPIDKeys();
    webpush.setVapidDetails('mailto:workerd-smoke@example.invalid', vapid.publicKey, vapid.privateKey);

    try {
      await webpush.sendNotification({
        endpoint: 'https://fcm.googleapis.com/fcm/send/my-auction-workerd-smoke-invalid',
        keys: { p256dh: receiver.publicKey, auth: randomBase64Url(16) },
      }, JSON.stringify({ title: 'workerd-smoke' }), { TTL: 1 });
      return Response.json({ runtime_compatible: true, upstream_status: 201 });
    } catch (error) {
      const status = Number((error as { statusCode?: unknown })?.statusCode || 0);
      if (status > 0) {
        return Response.json({ runtime_compatible: true, upstream_status: status });
      }
      return Response.json({
        runtime_compatible: false,
        error_name: error instanceof Error ? error.name : 'UnknownError',
        error_message: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
      }, { status: 500 });
    }
  },
};
