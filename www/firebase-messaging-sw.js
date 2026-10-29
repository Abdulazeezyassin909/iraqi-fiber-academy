/* eslint-disable no-undef */
/**
 * FCM background handler — must live at site root (Firebase Hosting scope).
 * Firebase Compat SDK v10.12.2
 */
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyCA_FPwBFwbuQrwBgiT88Uu5HzxZA_7UDY',
  authDomain: 'iraqi-fiber-academy.firebaseapp.com',
  projectId: 'iraqi-fiber-academy',
  storageBucket: 'iraqi-fiber-academy.firebasestorage.app',
  messagingSenderId: '679037485945',
  appId: '1:679037485945:web:ae91390e54e2fcbc6ae5a8',
});

var messaging = firebase.messaging();

messaging.onBackgroundMessage(function (payload) {
  var data = payload && payload.data ? payload.data : {};
  var notif = payload && payload.notification ? payload.notification : {};
  var title = notif.title || data.title || 'إشعار';
  var body = notif.body || data.body || '';
  var linkUrl = data.linkUrl || data.url || '/';
  var options = {
    body: body,
    icon: '/images/logo.png',
    data: { url: linkUrl },
  };
  return self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var raw = event.notification.data && event.notification.data.url;
  var targetUrl = raw || '/';
  if (targetUrl.indexOf('http') !== 0) {
    targetUrl = self.location.origin + (targetUrl.indexOf('/') === 0 ? targetUrl : '/' + targetUrl);
  }
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      var i;
      for (i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        if (client.url.indexOf(self.location.origin) === 0 && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
