self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : '' };
  }

  const title = String(payload.title || 'My-Auction Office');
  const options = {
    body: String(payload.body || '새 알림이 도착했습니다.'),
    icon: '/logo2.png',
    badge: '/logo2.png',
    tag: String(payload.tag || 'my-auction-notification'),
    data: { url: String(payload.url || '/dashboard') },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || '/dashboard', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const sameOriginWindow = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (sameOriginWindow && 'focus' in sameOriginWindow) {
      try {
        await sameOriginWindow.navigate(targetUrl);
      } catch {
        // A tab opened before activation can still be uncontrolled; focusing it is safe.
      }
      return sameOriginWindow.focus();
    }
    return self.clients.openWindow(targetUrl);
  })());
});
