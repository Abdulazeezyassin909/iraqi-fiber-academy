/**
 * Web Push (FCM) — opt-in toggle, token registration, Firestore persistence.
 */
import { app, auth, db } from './firebase-config.js';
import { ensureUserDocExistsForUid } from './db-manager.js';
import { getMessaging, getToken, onMessage, isSupported } from
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js';
import { doc, setDoc, getDoc, serverTimestamp } from
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { onAuthStateChanged } from
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

const VAPID_KEY =
  'BPOrMOrbrd1Nf0DygkNi6jpyIrsvIgKKS-TL0K8rBRjCMbEf9n5vdXCrO_X2Nt8z8IvYz5DQDwvo4-WTtnwgdlw';

let messagingInstance = null;
let foregroundHandlerBound = false;
let profileResolver = function () {
  return null;
};

function resolveRole(profile) {
  if (profile && String(profile.role || '') === 'admin') return 'admin';
  return 'user';
}

function translate(key, fallback) {
  if (window.PlatformI18n && typeof window.PlatformI18n.t === 'function') {
    return window.PlatformI18n.t(key);
  }
  return fallback != null ? fallback : key;
}

export function tokenDocId(token) {
  var str = String(token || '');
  var h = 0;
  var i;
  for (i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return 't_' + Math.abs(h).toString(36);
}

async function ensureMessaging() {
  if (!(await isSupported())) return null;
  if (!messagingInstance) {
    messagingInstance = getMessaging(app);
  }
  return messagingInstance;
}

async function registerMessagingServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/firebase-messaging-sw.js');
  } catch (err) {
    console.warn('[FCM] Service worker registration failed', err);
    return null;
  }
}

function bindForegroundHandler(messaging) {
  if (foregroundHandlerBound || !messaging) return;
  foregroundHandlerBound = true;
  onMessage(messaging, function (payload) {
    console.info('[FCM] Foreground message', payload);
    var data = payload && payload.data ? payload.data : {};
    var notif = payload && payload.notification ? payload.notification : {};
    var title = notif.title || data.title || 'إشعار';
    var body = notif.body || data.body || '';
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        new Notification(title, { body: body, icon: '/images/logo.png' });
      } catch (err) {
        /* ignore */
      }
    }
  });
}

export async function getNotificationsEnabledPreference(uid) {
  if (!uid) return false;
  try {
    var snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) return false;
    var data = snap.data() || {};
    return !!(data.settings && data.settings.notificationsEnabled === true);
  } catch (err) {
    console.warn('[FCM] getNotificationsEnabledPreference failed', err);
    return false;
  }
}

export async function setNotificationsEnabledPreference(uid, enabled) {
  if (!uid) return;
  await ensureUserDocExistsForUid(uid);
  await setDoc(
    doc(db, 'users', uid),
    {
      settings: {
        notificationsEnabled: !!enabled,
      },
    },
    { merge: true }
  );
}

export async function saveFcmToken(uid, token, role) {
  if (!uid || !token) return null;
  var id = tokenDocId(token);
  await setDoc(
    doc(db, 'users', uid, 'fcmTokens', id),
    {
      token: String(token),
      role: role === 'admin' ? 'admin' : 'user',
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  return id;
}

/**
 * Browser permission prompt — call only from explicit user action (toggle on).
 */
export async function requestPushPermission() {
  if (typeof Notification === 'undefined') {
    return { ok: false, reason: 'unsupported' };
  }
  if (Notification.permission === 'granted') {
    return { ok: true, reason: 'granted' };
  }
  if (Notification.permission === 'denied') {
    return { ok: false, reason: 'denied' };
  }
  var perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    return { ok: false, reason: perm };
  }
  return { ok: true, reason: 'granted' };
}

/**
 * Obtain FCM token when permission is already granted (no permission prompt).
 */
export async function refreshFcmToken(profile) {
  var user = auth.currentUser;
  if (!user) {
    return { ok: false, reason: 'not_signed_in' };
  }
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
    return { ok: false, reason: 'permission_not_granted' };
  }

  var messaging = await ensureMessaging();
  if (!messaging) {
    return { ok: false, reason: 'messaging_unsupported' };
  }

  await registerMessagingServiceWorker();
  var registration = await navigator.serviceWorker.ready;

  var token;
  try {
    token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });
  } catch (err) {
    console.error('[FCM] getToken failed', err);
    return { ok: false, reason: 'get_token_failed', error: err };
  }

  if (!token) {
    return { ok: false, reason: 'empty_token' };
  }

  var role = resolveRole(profile);
  await saveFcmToken(user.uid, token, role);
  bindForegroundHandler(messaging);

  return { ok: true, token: token, role: role };
}

/** @deprecated Use refreshFcmToken after explicit opt-in */
export async function enablePushNotifications(profile) {
  return refreshFcmToken(profile);
}

async function maybeRefreshTokenSilently() {
  var user = auth.currentUser;
  if (!user) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

  var enabled = await getNotificationsEnabledPreference(user.uid);
  if (!enabled) return;

  var profile = profileResolver();
  try {
    await refreshFcmToken(profile);
  } catch (err) {
    console.warn('[FCM] Silent token refresh failed', err);
  }
}

export function startFcmOnAuth(getProfile) {
  profileResolver = typeof getProfile === 'function' ? getProfile : function () {
    return null;
  };

  onAuthStateChanged(auth, function (user) {
    if (!user) return;
    maybeRefreshTokenSilently();
  });

  window.addEventListener('ifa:local-auth-changed', function (e) {
    var type = e && e.detail ? e.detail.type : '';
    if (type === 'profile-sync' || type === 'login') {
      maybeRefreshTokenSilently();
    }
  });
}

function ensureHintElement(toggleEl, elementId) {
  var hintId = elementId + 'Hint';
  var hint = document.getElementById(hintId);
  if (hint) return hint;

  hint = document.createElement('p');
  hint.id = hintId;
  hint.className = 'ifa-fcm-hint';
  hint.hidden = true;
  hint.setAttribute('role', 'status');
  var host = toggleEl.closest('.settings-dropdown__row, .admin-field, label') || toggleEl.parentElement;
  if (host && host.parentElement) {
    host.parentElement.insertBefore(hint, host.nextSibling);
  } else if (toggleEl.parentElement) {
    toggleEl.parentElement.appendChild(hint);
  }
  return hint;
}

function deniedHintText() {
  return translate(
    'settings.pushDeniedHint',
    'لتفعيل الإشعارات، افتح إعدادات الموقع في المتصفح واسمح بالإشعارات.'
  );
}

function showDeniedHint(hintEl) {
  if (!hintEl) return;
  hintEl.textContent = deniedHintText();
  hintEl.hidden = false;
}

function hideDeniedHint(hintEl) {
  if (!hintEl) return;
  hintEl.hidden = true;
  hintEl.textContent = '';
}

/**
 * Soft-prompt toggle: permission is requested only when the user turns the switch on.
 */
export function setupNotificationToggle(elementId) {
  var toggleEl = document.getElementById(elementId);
  if (!toggleEl) return;
  if (toggleEl.dataset.fcmToggleBound === '1') {
    if (typeof toggleEl._ifaFcmSyncUi === 'function') {
      toggleEl._ifaFcmSyncUi();
    }
    return;
  }
  toggleEl.dataset.fcmToggleBound = '1';

  var hintEl = ensureHintElement(toggleEl, elementId);

  async function syncUi() {
    var user = auth.currentUser;
    if (!user) {
      toggleEl.checked = false;
      toggleEl.disabled = true;
      hideDeniedHint(hintEl);
      return;
    }

    toggleEl.disabled = false;
    var pref = await getNotificationsEnabledPreference(user.uid);
    var perm = typeof Notification !== 'undefined' ? Notification.permission : 'denied';

    if (perm === 'denied') {
      toggleEl.checked = false;
      showDeniedHint(hintEl);
      return;
    }

    hideDeniedHint(hintEl);
    toggleEl.checked = !!pref;

    if (perm === 'granted' && pref) {
      await maybeRefreshTokenSilently();
    }
  }

  toggleEl.addEventListener('change', async function () {
    var user = auth.currentUser;
    if (!user) {
      toggleEl.checked = false;
      return;
    }

    if (toggleEl.checked) {
      var perm = typeof Notification !== 'undefined' ? Notification.permission : 'denied';

      if (perm === 'denied') {
        toggleEl.checked = false;
        showDeniedHint(hintEl);
        return;
      }

      if (perm === 'default') {
        var permResult = await requestPushPermission();
        if (!permResult.ok) {
          toggleEl.checked = false;
          await setNotificationsEnabledPreference(user.uid, false);
          if (permResult.reason === 'denied') {
            showDeniedHint(hintEl);
          }
          return;
        }
      }

      hideDeniedHint(hintEl);
      await setNotificationsEnabledPreference(user.uid, true);
      var profile = profileResolver();
      var result = await refreshFcmToken(profile);
      if (!result.ok) {
        toggleEl.checked = false;
        await setNotificationsEnabledPreference(user.uid, false);
        console.warn('[FCM] refreshFcmToken after opt-in failed', result);
      }
      return;
    }

    hideDeniedHint(hintEl);
    await setNotificationsEnabledPreference(user.uid, false);
  });

  toggleEl._ifaFcmSyncUi = syncUi;
  syncUi();

  onAuthStateChanged(auth, function (user) {
    if (!user) {
      toggleEl.checked = false;
      toggleEl.disabled = true;
      hideDeniedHint(hintEl);
      return;
    }
    syncUi();
  });
}
