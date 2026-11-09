var VAPID_PUBLIC_KEY = 'BHdeQdsCa1fox1V3qtBCHWmeYVZDlwvxS6n5-qmc9bTWSns0r_ffytTVKLtJLE_hS6YwN0kywrATcmFRZ0hs0qU';

function sameKey(left, right) {
  if (!left || !right) return false;
  var a = new Uint8Array(left);
  var b = new Uint8Array(right);
  if (a.length !== b.length) return false;
  for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function urlBase64ToUint8Array(value) {
  var padding = '='.repeat((4 - (value.length % 4)) % 4);
  var base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  var raw = atob(base64);
  var out = new Uint8Array(raw.length);
  for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function subscribeSitePush(user, role) {
  if (!user || typeof user.getIdToken !== 'function') return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  var registration = await navigator.serviceWorker.register('/sw.js?v=20261108push6');
  var applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
  var subscription = await registration.pushManager.getSubscription();
  var currentKey = subscription && subscription.options ? subscription.options.applicationServerKey : null;
  if (subscription && !sameKey(currentKey, applicationServerKey)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey,
    });
  }
  var token = await user.getIdToken();
  var response = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      subscription: subscription.toJSON(),
      role: role || 'user',
    }),
  });
  if (!response.ok) throw new Error('push subscribe failed');
}
