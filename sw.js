const CACHE_NAME = 'masar-almuhandis-v4';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
      .then((clients) => Promise.all(clients.map((client) => {
        if (client.url && typeof client.navigate === 'function') {
          return client.navigate(client.url);
        }
        return undefined;
      })))
  );
});

self.addEventListener('push', function (event) {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (err) {
    data = { title: 'إشعار', message: event.data ? event.data.text() : '' };
  }
  var icon = data.icon || '/images/logo.png';
  var badge = data.badge || '/images/badge.png';
  event.waitUntil(
    self.registration.showNotification(data.title || 'إشعار', {
      body: data.message || '',
      icon: icon,
      badge: badge,
      dir: 'rtl',
      tag: data.tag || data.type || 'general-notification',
      renotify: false,
      data: { url: data.linkUrl || '/', type: data.type || '' },
    })
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var data = event.notification.data || {};
  var type = String(data.type || '');
  var raw = data.url || '/';
  if (type === 'new_order' || type === 'order_approved' || type === 'order_rejected') {
    raw = raw.indexOf('admin.html') !== -1 ? '/admin.html#orders' : '/instructor.html#orders';
  }
  var absolute = new URL(raw, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      var existing = clientList.find(function (client) {
        return client.url.indexOf(self.location.origin) === 0;
      });
      if (existing && typeof existing.navigate === 'function') {
        return existing.navigate(absolute).then(function () {
          return existing.focus();
        });
      }
      return self.clients.openWindow(absolute);
    })
  );
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request, { cache: 'reload' }));
    return;
  }
  event.respondWith(fetch(request));
});
