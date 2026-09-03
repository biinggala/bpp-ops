/**
 * ── The service worker ───────────────────────────────────────────────────────
 *
 * It exists for one reason: a push notification has to be shown when the app is
 * not running, and only a service worker can be woken to do that. It caches
 * nothing on purpose — the app is deployed continuously and a stale cache here
 * would serve yesterday's build to everyone, which is a worse problem than the
 * one an offline cache solves for a tool that is useless offline anyway.
 *
 * On iOS this only runs at all when the app has been added to the home screen.
 */

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))

self.addEventListener('push', event => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { /* not ours */ }

  const title = data.title || 'bpp-ops'
  const options = {
    body: data.body || '',
    // Same tag replaces the previous one rather than stacking: the morning
    // brief arriving twice should read as one notification, not two.
    tag: data.tag || 'bpp-ops',
    renotify: !!data.renotify,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: data.url || '/' },
  }

  event.waitUntil((async () => {
    await self.registration.showNotification(title, options)
    // Keep the app-icon count in step with what the server just said is unread.
    if (typeof data.unread === 'number' && self.navigator.setAppBadge) {
      try { await self.navigator.setAppBadge(data.unread) } catch { /* unsupported */ }
    }
  })())
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const raw = (event.notification.data && event.notification.data.url) || '/'
  // 이 앱 안의 길만 엽니다. 서버도 거르지만, 여기서 한 번 더.
  const url = typeof raw === 'string' && /^\/(?!\/)/.test(raw) ? raw : '/'

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    // Re-use the window that is already open — launching a second copy of the
    // app from a notification is how you end up with two of everything.
    for (const client of windows) {
      if (client.url.includes(self.location.origin)) {
        await client.focus()
        if ('navigate' in client && url !== '/') { try { await client.navigate(url) } catch { /* ignore */ } }
        return
      }
    }
    await self.clients.openWindow(url)
  })())
})
