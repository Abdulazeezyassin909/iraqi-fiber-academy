/**
 * Firestore real-time sync for site footer (settings/footer).
 */
import { db } from './firebase-config.js';
import { doc, onSnapshot, setDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { scheduleDeferredFirestoreSync, readJsonFromLocalStorage } from './firestore-sync-scheduler.js';

var FOOTER_REF = doc(db, 'settings', 'footer');
var FOOTER_STORAGE_KEY = 'ifa_platform_footer';
var cachedSettings = null;
var snapshotReady = false;
var listeners = [];
var unsubscribeSnapshot = null;
var seedInFlight = false;
var needsSeed = false;

var SOCIAL_IDS = ['youtube', 'linkedin', 'email', 'phone', 'facebook', 'instagram', 'telegram', 'whatsapp'];

var DEFAULT_DESCRIPTION =
  'منصة تدريبية رائدة في مجال الألياف الضوئية وشبكات FTTH. نُعدّ الجيل القادم من فنيي ومهندسي الاتصالات.';

function normalizeSettings(raw) {
  if (window.PlatformFooter && typeof window.PlatformFooter.normalizeSettings === 'function') {
    return window.PlatformFooter.normalizeSettings(raw);
  }
  var src = raw && typeof raw === 'object' ? raw : {};
  var social = {};
  SOCIAL_IDS.forEach(function (id) {
    social[id] = src.social && src.social[id] ? String(src.social[id]) : '';
  });
  var text = DEFAULT_DESCRIPTION;
  var fontSize = 0.9;
  var color = '#94a3b8';
  if (typeof src.description === 'string') {
    text = String(src.description).trim() || DEFAULT_DESCRIPTION;
    fontSize = src.fontSize != null ? Number(src.fontSize) : fontSize;
  } else if (src.description && typeof src.description === 'object') {
    text = String(src.description.text || '').trim() || DEFAULT_DESCRIPTION;
    fontSize = src.description.fontSize != null ? Number(src.description.fontSize) : fontSize;
    color = String(src.description.color || color);
  }
  if (src.fontSize != null && typeof src.description !== 'object') {
    fontSize = Number(src.fontSize) || fontSize;
  }
  return {
    description: { text: text, fontSize: fontSize, color: color },
    social: social,
  };
}

function defaultSettings() {
  return normalizeSettings(null);
}

function isFooterDocumentEmpty(data) {
  if (!data || typeof data !== 'object') return true;
  var hasDescription =
    (typeof data.description === 'string' && data.description.trim()) ||
    (data.description &&
      typeof data.description === 'object' &&
      String(data.description.text || '').trim());
  var hasSocial =
    data.social &&
    typeof data.social === 'object' &&
    Object.keys(data.social).some(function (key) {
      return String(data.social[key] || '').trim();
    });
  return !hasDescription && !hasSocial && data.fontSize == null;
}

function mergeFooterPatch(current, patch) {
  var incoming = patch && typeof patch === 'object' ? patch : {};
  var merged = {
    description: Object.assign({}, current.description, incoming.description || {}),
    logoSubtitle: Object.assign({}, current.logoSubtitle, incoming.logoSubtitle || {}),
    social: Object.assign({}, current.social),
  };
  if (typeof incoming.description === 'string') {
    merged.description.text = incoming.description;
    if (incoming.fontSize != null) merged.description.fontSize = incoming.fontSize;
  }
  if (incoming.fontSize != null && incoming.description == null) {
    merged.description.fontSize = incoming.fontSize;
  }
  if (incoming.social) {
    SOCIAL_IDS.forEach(function (id) {
      if (incoming.social[id] != null) {
        var value = incoming.social[id];
        if (window.PlatformFooter && typeof window.PlatformFooter.normalizeSocialUrl === 'function') {
          merged.social[id] = window.PlatformFooter.normalizeSocialUrl(id, value);
        } else {
          merged.social[id] = String(value || '').trim();
        }
      }
    });
  }
  return normalizeSettings(merged);
}

function notifyListeners() {
  var settings = getCachedFooterSettings();
  listeners.forEach(function (fn) {
    try {
      fn(settings);
    } catch (err) {
      console.error('[PlatformFooterFirestore] listener failed', err);
    }
  });
  try {
    window.dispatchEvent(new CustomEvent('ifa:platform-footer-changed', { detail: settings }));
    document.dispatchEvent(new CustomEvent('ifa:platform-footer-changed', { detail: settings }));
  } catch (err) {
    /* ignore */
  }
  if (window.PlatformFooter && typeof window.PlatformFooter.applyFooter === 'function') {
    window.PlatformFooter.applyFooter(document);
  }
}

function canAutoSeedFirestore() {
  var Auth = window.IFAAuth;
  if (!Auth || typeof Auth.isLoggedIn !== 'function' || !Auth.isLoggedIn()) return false;
  if (typeof Auth.isAdminUser !== 'function') return false;
  return Auth.isAdminUser(Auth.getAuthState().profile);
}

async function seedDefaultFooterDocument() {
  if (seedInFlight) return;
  if (!canAutoSeedFirestore()) return;
  seedInFlight = true;
  try {
    var payload = defaultSettings();
    payload.updatedAt = new Date().toISOString();
    await setDoc(FOOTER_REF, payload, { merge: true });
  } catch (err) {
    console.warn('[PlatformFooterFirestore] auto-seed failed:', err);
  } finally {
    seedInFlight = false;
  }
}

function persistFooterToLocalStorage(settings) {
  try {
    localStorage.setItem(FOOTER_STORAGE_KEY, JSON.stringify(normalizeSettings(settings)));
  } catch (err) {
    /* ignore */
  }
}

function hydrateFooterFromLocalStorage() {
  var raw = readJsonFromLocalStorage(FOOTER_STORAGE_KEY);
  if (!raw) return false;
  cachedSettings = normalizeSettings(raw);
  snapshotReady = false;
  notifyListeners();
  return true;
}

function handleSnapshot(snap) {
  if (!snap.exists() || isFooterDocumentEmpty(snap.data())) {
    needsSeed = true;
    cachedSettings = defaultSettings();
    snapshotReady = true;
    notifyListeners();
    seedDefaultFooterDocument();
    return;
  }
  needsSeed = false;
  cachedSettings = normalizeSettings(snap.data());
  persistFooterToLocalStorage(cachedSettings);
  snapshotReady = true;
  notifyListeners();
}

export function getCachedFooterSettings() {
  return normalizeSettings(cachedSettings || defaultSettings());
}

export function isFooterSnapshotReady() {
  return snapshotReady;
}

export function subscribeFooterSettings(callback) {
  if (typeof callback === 'function') {
    listeners.push(callback);
    if (snapshotReady) callback(getCachedFooterSettings());
  }
  return function () {
    listeners = listeners.filter(function (fn) {
      return fn !== callback;
    });
  };
}

export async function saveFooterSettings(patch) {
  var next = mergeFooterPatch(getCachedFooterSettings(), patch);
  next.updatedAt = new Date().toISOString();
  await setDoc(FOOTER_REF, next, { merge: true });
  cachedSettings = next;
  snapshotReady = true;
  needsSeed = false;
  notifyListeners();
  return next;
}

export function startFooterFirestoreSync() {
  if (unsubscribeSnapshot) return unsubscribeSnapshot;
  unsubscribeSnapshot = onSnapshot(
    FOOTER_REF,
    handleSnapshot,
    function (err) {
      console.error('[PlatformFooterFirestore] onSnapshot failed', err);
      cachedSettings = defaultSettings();
      snapshotReady = true;
      notifyListeners();
    }
  );
  return unsubscribeSnapshot;
}

window.addEventListener('ifa:auth-changed', function (e) {
  var detail = (e && e.detail) || {};
  if (detail.profileSynced) {
    if (needsSeed) seedDefaultFooterDocument();
  }
});

var api = {
  subscribe: subscribeFooterSettings,
  getCachedSettings: getCachedFooterSettings,
  isReady: isFooterSnapshotReady,
  saveSettings: saveFooterSettings,
  start: startFooterFirestoreSync,
};

window.PlatformFooterFirestore = api;
hydrateFooterFromLocalStorage();
scheduleDeferredFirestoreSync(startFooterFirestoreSync);

export default api;
