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
import { subscribeSitePush } from './web-push-client.js?v=20261108push6';

const VAPID_KEY =
  'BHdeQdsCa1fox1V3qtBCHWmeYVZDlwvxS6n5-qmc9bTWSns0r_ffytTVKLtJLE_hS6YwN0kywrATcmFRZ0hs0qU';

let messagingInstance = null;
let foregroundHandlerBound = false;
let profileResolver = function () {
  return null;
};

function resolveRole(profile) {
  var role = profile && String(profile.role || '').toLowerCase();
  if (role === 'admin' || role === 'instructor') return role;
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
    return await navigator.serviceWorker.register('/sw.js?v=20261108push6');
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

  var role = resolveRole(profile);
  var registration = null;
  try {
    registration = await registerMessagingServiceWorker();
  } catch (err) {
    console.warn('[WebPush] service worker registration failed', err);
  }

  try {
    await subscribeSitePush(user, role);
  } catch (pushErr) {
    console.warn('[WebPush] subscribe failed', pushErr);
  }

  var messaging = await ensureMessaging();
  if (!messaging || !registration) {
    return { ok: true, reason: 'site_push_only' };
  }

  var token;
  try {
    token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });
  } catch (err) {
    console.error('[FCM] getToken failed', err);
    return { ok: true, reason: 'site_push_only' };
  }

  if (!token) {
    return { ok: true, reason: 'site_push_only' };
  }
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
    maybeOfferPushPermission();
  });

  window.addEventListener('ifa:local-auth-changed', function (e) {
    var type = e && e.detail ? e.detail.type : '';
    if (type === 'profile-sync' || type === 'login') {
      maybeRefreshTokenSilently();
    }
  });
}

async function maybeOfferPushPermission() {
  var user = auth.currentUser;
  if (!user || typeof Notification === 'undefined') return;
  if (Notification.permission !== 'default') return;
  if (document.getElementById('ifaPushPrompt')) return;
  try {
    if (sessionStorage.getItem('ifa_push_prompt_dismissed') === '1') return;
  } catch (err) {
    /* ignore */
  }

  var overlay = document.createElement('div');
  overlay.id = 'ifaPushPrompt';
  overlay.className = 'ifa-push-prompt';
  overlay.innerHTML =
    '<div class="ifa-push-prompt__card" role="dialog" aria-modal="true">' +
    '<h3 class="ifa-push-prompt__title">تفعيل إشعارات المتصفح</h3>' +
    '<p class="ifa-push-prompt__body">اسمح بالإشعارات حتى تصلك التنبيهات خارج الموقع عند نشر كورس جديد.</p>' +
    '<div class="ifa-push-prompt__actions">' +
    '<button type="button" class="ifa-push-prompt__later" data-push-later>لاحقاً</button>' +
    '<button type="button" class="ifa-push-prompt__allow" data-push-allow>السماح</button>' +
    '</div></div>';
  document.body.appendChild(overlay);

  function dismiss() {
    try {
      sessionStorage.setItem('ifa_push_prompt_dismissed', '1');
    } catch (err) {
      /* ignore */
    }
    overlay.remove();
  }

  overlay.querySelector('[data-push-later]').addEventListener('click', dismiss);
  overlay.querySelector('[data-push-allow]').addEventListener('click', async function () {
    var result = await requestPushPermission();
    if (!result.ok) {
      dismiss();
      return;
    }
    await setNotificationsEnabledPreference(user.uid, true);
    await refreshFcmToken(profileResolver());
    document.querySelectorAll('[data-settings-push-toggle]').forEach(function (el) {
      el.checked = true;
    });
    dismiss();
  });
}

function bindPushToggles() {
  setupNotificationToggle('settingsPushNotificationsToggle');
  setupNotificationToggle('settingsPushNotificationsToggleDrawer');
}

function isIosDevice() {
  var ua = navigator.userAgent || '';
  var iPadDesktop = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return /iPad|iPhone|iPod/.test(ua) || iPadDesktop;
}

function isStandalonePwa() {
  return window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
}

function needsIosHomeScreen() {
  return isIosDevice() && !isStandalonePwa();
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

function showIosHint(hintEl) {
  if (!hintEl) return;
  hintEl.textContent = 'لتفعيل الإشعارات على الآيفون، يرجى إضافة الموقع إلى الشاشة الرئيسية (Add to Home Screen) أولاً.';
  hintEl.hidden = false;
}

function hideIosHint(hintEl) {
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
      hideIosHint(hintEl);
      return;
    }

    if (needsIosHomeScreen()) {
      toggleEl.checked = false;
      toggleEl.disabled = true;
      showIosHint(hintEl);
      return;
    }

    hideIosHint(hintEl);
    toggleEl.disabled = false;
    var pref = await getNotificationsEnabledPreference(user.uid);
    var perm = typeof Notification !== 'undefined' ? Notification.permission : 'denied';

    if (perm === 'denied') {
      toggleEl.checked = false;
      return;
    }

    toggleEl.checked = perm === 'granted' && !!pref;

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
      if (needsIosHomeScreen()) {
        toggleEl.checked = false;
        toggleEl.disabled = true;
        showIosHint(hintEl);
        return;
      }
      var perm = typeof Notification !== 'undefined' ? Notification.permission : 'denied';
      if (perm !== 'granted') {
        var permResult = await requestPushPermission();
        perm = typeof Notification !== 'undefined' ? Notification.permission : 'denied';
        if (!permResult.ok || perm !== 'granted') {
          toggleEl.checked = false;
          await setNotificationsEnabledPreference(user.uid, false);
          return;
        }
      }

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

    await setNotificationsEnabledPreference(user.uid, false);
  });

  toggleEl._ifaFcmSyncUi = syncUi;
  syncUi();

  onAuthStateChanged(auth, function (user) {
    if (!user) {
      toggleEl.checked = false;
      toggleEl.disabled = true;
      return;
    }
    syncUi();
  });
}

window.IFAFcm = {
  bindToggles: bindPushToggles,
};
