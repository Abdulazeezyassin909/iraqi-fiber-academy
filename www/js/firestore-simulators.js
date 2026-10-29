/**
 * Firestore real-time sync for simulator CMS (settings/simulators).
 * Deploy rules: firebase deploy --only firestore:rules
 */
import { db } from './firebase-config.js';
import { doc, onSnapshot, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { scheduleDeferredFirestoreSync } from './firestore-sync-scheduler.js';

var SIMULATORS_REF = doc(db, 'settings', 'simulators');
var FTTH_LAB_CONFIG_REF = doc(db, 'settings', 'ftth_lab_config');
var OPM_CONFIG_REF = doc(db, 'settings', 'ifa_opm_config');
var OTDR_CONFIG_REF = doc(db, 'settings', 'ifa_otdr_config');
var SPLICER_CONFIG_REF = doc(db, 'settings', 'ifa_splicer_config');
var META_KEY = 'ifa_simulators_meta';
var SHOWCASE_KEY = 'ifa_simulator_showcase';
var SETTINGS_KEY = 'ifa_platform_settings';

var cachedBundle = null;
var snapshotReady = false;
var listeners = [];
var unsubscribeSnapshot = null;
var seedInFlight = false;
var needsSeed = false;
var hasAttemptedMigration = false;
var migrationPermissionDenied = false;
var migrationErrorLogged = false;

function catalogIds() {
  if (window.PlatformSimulators && Array.isArray(window.PlatformSimulators.CATALOG)) {
    return window.PlatformSimulators.CATALOG.map(function (s) {
      return String(s.id || '');
    }).filter(Boolean);
  }
  return [
    'ftth-simulator',
    'otdr-simulator',
    'power-meter',
    'fusion-splicer',
    'fiber-anatomy',
    'patch-panel-lab',
  ];
}

function defaultShowcaseEntry() {
  if (window.PlatformSimulatorShowcase && typeof window.PlatformSimulatorShowcase.defaultShowcaseEntry === 'function') {
    return window.PlatformSimulatorShowcase.defaultShowcaseEntry();
  }
  return {
    title: '',
    description: '',
    showcaseImage: '',
    visibleInShowcase: true,
  };
}

function normalizeShowcaseEntry(raw) {
  var s = raw && typeof raw === 'object' ? raw : {};
  return {
    title: String(s.title || '').trim().slice(0, 200),
    description: String(s.description || '').trim().slice(0, 800),
    showcaseImage: String(s.showcaseImage || '').trim(),
    visibleInShowcase: s.visibleInShowcase !== false,
  };
}

function defaultSimulatorsMeta() {
  if (window.PlatformSimulators && typeof window.PlatformSimulators.defaultSimulatorMeta === 'function') {
    return window.PlatformSimulators.defaultSimulatorMeta();
  }
  return {};
}

function isIconImageSrc(icon) {
  var s = String(icon || '').trim();
  return (
    /^https?:\/\//i.test(s) ||
    s.indexOf('firebasestorage.googleapis.com') !== -1
  );
}

function normalizeSimulatorsMeta(raw) {
  var stored = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  var defaults = defaultSimulatorsMeta();
  var out = {};
  catalogIds().forEach(function (id) {
    var d = defaults[id] || {};
    var m = stored[id] || {};
    var icon = String(m.icon != null ? m.icon : d.icon || '◆');
    var iconType =
      m.iconType === 'image' || isIconImageSrc(icon) ? 'image' : 'emoji';
    out[id] = {
      title: String(m.title != null ? m.title : d.title || '').trim(),
      description: String(m.description != null ? m.description : d.description || '').trim(),
      icon: icon,
      iconType: iconType,
    };
  });
  return out;
}

function normalizeShowcaseStore(raw) {
  var stored = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  var out = {};
  var interval = Number(stored._intervalSeconds);
  out._intervalSeconds = isFinite(interval) && interval >= 2 ? Math.min(60, Math.round(interval)) : 5;
  catalogIds().forEach(function (id) {
    out[id] = normalizeShowcaseEntry(stored[id]);
  });
  return out;
}

function normalizeFreeTrialDays(value) {
  var days = parseFloat(value);
  if (!isFinite(days) || days <= 0) return 0;
  return Math.min(365, days);
}

function defaultPlatformSettings() {
  return {
    freeSimulatorIds: [],
    comingSoonSimulatorIds: [],
    freeTrialDays: 0,
    trialAnnouncementText: '',
    globalOfferEnabled: false,
    globalOfferText: '',
    globalOfferEndsAt: '',
  };
}

function normalizeBannerOfferEndsAt(value) {
  if (value == null || value === '') return '';
  var ms = typeof value === 'number' ? value : Date.parse(String(value));
  if (!isFinite(ms) || ms <= 0) return '';
  try {
    return new Date(ms).toISOString();
  } catch (err) {
    return '';
  }
}

function normalizeBannerTimerEnabled(src) {
  if (src && src.bannerTimerEnabled != null) return !!src.bannerTimerEnabled;
  if (src && src.bannerTimerMode === 'global_offer' && normalizeBannerOfferEndsAt(src.bannerOfferEndsAt)) {
    return true;
  }
  return false;
}

function normalizeTopBannerFields(src) {
  var raw = src && typeof src === 'object' ? src : {};
  var trialAnnouncementText = String(raw.trialAnnouncementText || '').trim().slice(0, 500);
  var globalOfferText = String(raw.globalOfferText || '').trim().slice(0, 500);
  var globalOfferEndsAt = normalizeBannerOfferEndsAt(raw.globalOfferEndsAt);
  var globalOfferEnabled = raw.globalOfferEnabled;

  if (globalOfferEnabled == null) {
    var legacyEnds = normalizeBannerOfferEndsAt(raw.bannerOfferEndsAt);
    var timerOn = normalizeBannerTimerEnabled(raw);
    globalOfferEnabled = !!raw.announcementEnabled || (timerOn && !!legacyEnds);
    if (!globalOfferText && raw.announcementText) {
      globalOfferText = String(raw.announcementText).trim().slice(0, 500);
    }
    if (!globalOfferEndsAt && legacyEnds) {
      globalOfferEndsAt = legacyEnds;
    }
  }

  return {
    trialAnnouncementText: trialAnnouncementText,
    globalOfferEnabled: !!globalOfferEnabled,
    globalOfferText: globalOfferText,
    globalOfferEndsAt: globalOfferEndsAt,
  };
}

function normalizePlatformSettings(raw) {
  var base = defaultPlatformSettings();
  var src = raw && typeof raw === 'object' ? raw : {};
  var normalizeIds = function (list) {
    if (window.PlatformSimulators && typeof window.PlatformSimulators.normalizeSimulatorIds === 'function') {
      return window.PlatformSimulators.normalizeSimulatorIds(list);
    }
    return Array.isArray(list) ? list.map(String).filter(Boolean) : [];
  };
  var banner = normalizeTopBannerFields(src);
  return {
    freeSimulatorIds: normalizeIds(src.freeSimulatorIds != null ? src.freeSimulatorIds : base.freeSimulatorIds),
    comingSoonSimulatorIds: normalizeIds(
      src.comingSoonSimulatorIds != null ? src.comingSoonSimulatorIds : base.comingSoonSimulatorIds
    ),
    freeTrialDays: normalizeFreeTrialDays(
      src.freeTrialDays != null ? src.freeTrialDays : base.freeTrialDays
    ),
    trialAnnouncementText: banner.trialAnnouncementText,
    globalOfferEnabled: banner.globalOfferEnabled,
    globalOfferText: banner.globalOfferText,
    globalOfferEndsAt: banner.globalOfferEndsAt,
  };
}

function emptyBundle() {
  return {
    simulatorsMeta: normalizeSimulatorsMeta({}),
    showcaseStore: normalizeShowcaseStore({}),
    platformSettings: normalizePlatformSettings(null),
    updatedAt: null,
  };
}

function normalizeBundle(raw) {
  var src = raw && typeof raw === 'object' ? raw : {};
  return {
    simulatorsMeta: normalizeSimulatorsMeta(src.simulatorsMeta || src.meta),
    showcaseStore: normalizeShowcaseStore(src.showcaseStore || src.showcaseMeta || src.showcase),
    platformSettings: normalizePlatformSettings(src.platformSettings),
    updatedAt: src.updatedAt || null,
  };
}

function readLocalBundle() {
  var meta = {};
  var showcase = {};
  var settings = {};
  try {
    meta = JSON.parse(localStorage.getItem(META_KEY) || '{}');
  } catch (err) {
    meta = {};
  }
  try {
    showcase = JSON.parse(localStorage.getItem(SHOWCASE_KEY) || '{}');
  } catch (err) {
    showcase = {};
  }
  try {
    settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
  } catch (err) {
    settings = {};
  }
  return normalizeBundle({
    simulatorsMeta: meta,
    showcaseStore: showcase,
    platformSettings: settings,
  });
}

function writeLocalBundle(bundle) {
  var normalized = normalizeBundle(bundle);
  try {
    localStorage.setItem(META_KEY, JSON.stringify(normalized.simulatorsMeta));
    localStorage.setItem(SHOWCASE_KEY, JSON.stringify(normalized.showcaseStore));
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalized.platformSettings));
  } catch (err) {
    console.error('[PlatformSimulatorsFirestore] localStorage write failed', err);
  }
  return normalized;
}

function applyBundleToPlatform(bundle) {
  var normalized = writeLocalBundle(bundle);
  cachedBundle = normalized;
  snapshotReady = true;

  if (window.PlatformSimulators && typeof window.PlatformSimulators.applySimulatorMetaToCards === 'function') {
    window.PlatformSimulators.applySimulatorMetaToCards();
  }
  if (window.PlatformSimulatorShowcase && typeof window.PlatformSimulatorShowcase.mountSimulatorShowcase === 'function') {
    window.PlatformSimulatorShowcase.mountSimulatorShowcase();
  }
  if (window.PlatformSimulators && typeof window.PlatformSimulators.applyPublicSimulatorGates === 'function') {
    window.PlatformSimulators.applyPublicSimulatorGates();
  }

  try {
    window.dispatchEvent(
      new CustomEvent('ifa:simulators-meta-changed', { detail: normalized.simulatorsMeta })
    );
    document.dispatchEvent(
      new CustomEvent('ifa:simulators-meta-changed', { detail: normalized.simulatorsMeta })
    );
    window.dispatchEvent(
      new CustomEvent('ifa:simulator-showcase-changed', { detail: normalized.showcaseStore })
    );
    document.dispatchEvent(
      new CustomEvent('ifa:simulator-showcase-changed', { detail: normalized.showcaseStore })
    );
    window.dispatchEvent(
      new CustomEvent('ifa:platform-settings-changed', { detail: normalized.platformSettings })
    );
    document.dispatchEvent(
      new CustomEvent('ifa:platform-settings-changed', { detail: normalized.platformSettings })
    );
    window.dispatchEvent(
      new CustomEvent('ifa:simulators-firestore-changed', { detail: normalized })
    );
    document.dispatchEvent(
      new CustomEvent('ifa:simulators-firestore-changed', { detail: normalized })
    );
  } catch (err) {
    /* ignore */
  }
}

function notifyListeners() {
  var bundle = getCachedSimulatorsBundle();
  listeners.forEach(function (fn) {
    try {
      fn(bundle);
    } catch (err) {
      console.error('[PlatformSimulatorsFirestore] listener failed', err);
    }
  });
}

function mergeSimulatorsMetaPatch(current, patch) {
  var base = normalizeSimulatorsMeta(current);
  var incoming = patch && typeof patch === 'object' ? patch : {};
  Object.keys(incoming).forEach(function (id) {
    if (catalogIds().indexOf(id) === -1) return;
    var m = incoming[id] || {};
    var icon = String(m.icon != null ? m.icon : base[id].icon);
    base[id] = {
      title: String(m.title != null ? m.title : base[id].title).trim() || base[id].title,
      description: String(m.description != null ? m.description : base[id].description),
      icon: icon,
      iconType: m.iconType === 'image' || isIconImageSrc(icon) ? 'image' : 'emoji',
    };
  });
  return base;
}

function mergeShowcasePatch(currentStore, patch, intervalSeconds) {
  var base = normalizeShowcaseStore(currentStore);
  if (intervalSeconds != null) {
    var sec = Number(intervalSeconds);
    if (isFinite(sec)) base._intervalSeconds = Math.max(2, Math.min(60, Math.round(sec)));
  }
  var incoming = patch && typeof patch === 'object' ? patch : {};
  Object.keys(incoming).forEach(function (id) {
    if (id.charAt(0) === '_') return;
    if (catalogIds().indexOf(id) === -1) return;
    base[id] = normalizeShowcaseEntry(Object.assign({}, base[id], incoming[id]));
  });
  return base;
}

function isDocumentEmpty(data) {
  if (!data || typeof data !== 'object') return true;
  var hasMeta =
    data.simulatorsMeta &&
    typeof data.simulatorsMeta === 'object' &&
    Object.keys(data.simulatorsMeta).some(function (key) {
      var entry = data.simulatorsMeta[key];
      return entry && (entry.title || entry.description || entry.icon);
    });
  var showcase = data.showcaseStore || data.showcaseMeta || data.showcase;
  var hasShowcase =
    showcase &&
    typeof showcase === 'object' &&
    Object.keys(showcase).some(function (key) {
      if (key.charAt(0) === '_') return false;
      var entry = showcase[key];
      return entry && (entry.title || entry.description || entry.showcaseImage);
    });
  return !hasMeta && !hasShowcase;
}

function localBundleHasRichContent(bundle) {
  var b = normalizeBundle(bundle || readLocalBundle());
  var meta = b.simulatorsMeta || {};
  var hasCustomMeta = catalogIds().some(function (id) {
    var entry = meta[id];
    if (!entry) return false;
    if (entry.iconType === 'image') return true;
    if (entry.icon && String(entry.icon).indexOf('data:') === 0) return true;
    return false;
  });
  if (hasCustomMeta) return true;

  var showcase = b.showcaseStore || {};
  return Object.keys(showcase).some(function (key) {
    if (key.charAt(0) === '_') return false;
    var entry = showcase[key];
    return !!(entry && (entry.showcaseImage || entry.title || entry.description));
  });
}

function canAutoSeedFirestore() {
  var Auth = window.IFAAuth;
  if (!Auth || typeof Auth.isLoggedIn !== 'function' || !Auth.isLoggedIn()) return false;
  if (typeof Auth.isAdminUser !== 'function') return false;
  var state = Auth.getAuthState();
  if (!state || !state.profileSynced) return false;
  return Auth.isAdminUser(state.profile);
}

function isPermissionDeniedError(err) {
  var code = err && err.code ? String(err.code) : '';
  if (code === 'permission-denied') return true;
  var message = err && err.message ? String(err.message) : '';
  return message.indexOf('Missing or insufficient permissions') !== -1;
}

function shouldAttemptAutoMigration() {
  if (migrationPermissionDenied) return false;
  if (hasAttemptedMigration) return false;
  if (!canAutoSeedFirestore()) return false;
  return true;
}

function markMigrationPermissionDenied(err) {
  migrationPermissionDenied = true;
  needsSeed = false;
  if (!migrationErrorLogged) {
    migrationErrorLogged = true;
    console.error(
      '[PlatformSimulatorsFirestore] migration blocked: permission-denied (no further auto-retries)',
      err
    );
  }
}

function formatFirestoreWriteError(err) {
  var code = err && err.code ? String(err.code) : '';
  if (code === 'permission-denied') {
    return 'رفض Firestore: حسابك لا يملك صلاحية المسؤول (admin) لكتابة settings/simulators';
  }
  if (code === 'unavailable') {
    return 'Firestore غير متاح حالياً — تحقق من الاتصال بالإنترنت';
  }
  if (code === 'invalid-argument' || code === 'failed-precondition') {
    return 'بيانات المحاكيات غير صالحة أو كبيرة جداً لـ Firestore — استخدم صوراً أصغر أو أعد رفع الأيقونات';
  }
  if (err && err.message && String(err.message).indexOf('base64') !== -1) {
    return String(err.message);
  }
  var message = err && err.message ? String(err.message) : 'خطأ غير معروف';
  return 'فشل نشر المحاكيات إلى Firestore: ' + message;
}

function buildFirestorePayload(bundle) {
  var normalized = normalizeBundle(bundle);
  return {
    simulatorsMeta: normalized.simulatorsMeta,
    showcaseStore: normalized.showcaseStore,
    platformSettings: normalized.platformSettings,
    updatedAt: serverTimestamp(),
  };
}

async function writeBundleToFirestore(bundle) {
  var normalized = normalizeBundle(bundle);
  await setDoc(SIMULATORS_REF, buildFirestorePayload(normalized), { merge: true });
  cachedBundle = normalized;
  snapshotReady = true;
  needsSeed = false;
  return normalized;
}

/**
 * One-time / auto migration: publish admin browser cache (localStorage) to Firestore.
 * Callable from console: PlatformSimulatorsFirestore.migrateLocalCacheToFirestore({ force: true })
 */
export async function migrateLocalCacheToFirestore(options) {
  var opts = options && typeof options === 'object' ? options : {};
  var isAutoMigration = !opts.force;

  if (isAutoMigration && migrationPermissionDenied) {
    return { ok: false, reason: 'permission-denied' };
  }
  if (isAutoMigration && hasAttemptedMigration) {
    return { ok: false, reason: 'already-attempted' };
  }
  if (seedInFlight) {
    return { ok: false, reason: 'in-flight' };
  }
  if (!canAutoSeedFirestore()) {
    return { ok: false, reason: 'not-admin' };
  }

  var local = readLocalBundle();
  var hasRichLocal = localBundleHasRichContent(local);
  if (!opts.force && !hasRichLocal && !needsSeed) {
    return { ok: false, reason: 'no-local-data' };
  }

  if (isAutoMigration) {
    hasAttemptedMigration = true;
  }

  seedInFlight = true;
  try {
    var payload = hasRichLocal || localBundleHasRichContent(local) ? local : emptyBundle();
    payload = await maybeUploadSimulatorMedia(normalizeBundle(payload), { uploadMedia: true });
    var saved = await writeBundleToFirestore(payload);
    applyBundleToPlatform(saved);
    notifyListeners();
    migrationPermissionDenied = false;
    if (!opts.silent) {
      console.info('[PlatformSimulatorsFirestore] migrated local cache to Firestore', saved);
    }
    return { ok: true, bundle: saved, migratedRichContent: hasRichLocal };
  } catch (err) {
    if (isPermissionDeniedError(err)) {
      markMigrationPermissionDenied(err);
      return {
        ok: false,
        reason: 'permission-denied',
        error: err,
        message: formatFirestoreWriteError(err),
      };
    }
    if (!migrationErrorLogged) {
      migrationErrorLogged = true;
      console.error('[PlatformSimulatorsFirestore] migration failed', err);
    }
    return { ok: false, reason: 'write-failed', error: err, message: formatFirestoreWriteError(err) };
  } finally {
    seedInFlight = false;
  }
}

async function seedFromLocalOrDefaults() {
  if (!shouldAttemptAutoMigration()) return { ok: false, reason: 'skipped' };
  return migrateLocalCacheToFirestore({ silent: true, auto: true });
}

function handleSnapshot(snap) {
  if (!snap.exists() || isDocumentEmpty(snap.data())) {
    if (!migrationPermissionDenied) {
      needsSeed = true;
    }
    var local = readLocalBundle();
    cachedBundle = local;
    snapshotReady = true;
    applyBundleToPlatform(local);
    notifyListeners();
    if (shouldAttemptAutoMigration()) {
      seedFromLocalOrDefaults();
    }
    return;
  }
  needsSeed = false;
  cachedBundle = normalizeBundle(snap.data());
  snapshotReady = true;
  applyBundleToPlatform(cachedBundle);
  notifyListeners();
}

export function getCachedSimulatorsBundle() {
  return normalizeBundle(cachedBundle || readLocalBundle());
}

export function isSimulatorsSnapshotReady() {
  return snapshotReady;
}

export function subscribeSimulators(callback) {
  if (typeof callback === 'function') {
    listeners.push(callback);
    if (snapshotReady) callback(getCachedSimulatorsBundle());
  }
  return function () {
    listeners = listeners.filter(function (fn) {
      return fn !== callback;
    });
  };
}

export function listenToSimulatorsMeta(callback) {
  return subscribeSimulators(callback);
}

export function whenSimulatorsFirestoreReady() {
  if (window.PlatformSimulatorsFirestore && typeof window.PlatformSimulatorsFirestore.saveSimulatorsBundle === 'function') {
    return Promise.resolve(window.PlatformSimulatorsFirestore);
  }
  if (window.__ifaSimulatorsFirestoreReady) {
    return window.__ifaSimulatorsFirestoreReady;
  }
  return Promise.resolve(window.PlatformSimulatorsFirestore || null);
}

export async function saveSimulatorMetaToFirestore(patch) {
  var current = getCachedSimulatorsBundle();
  var next = normalizeBundle({
    simulatorsMeta: mergeSimulatorsMetaPatch(current.simulatorsMeta, patch),
    showcaseStore: current.showcaseStore,
    platformSettings: current.platformSettings,
  });
  try {
    await writeBundleToFirestore(next);
  } catch (err) {
    var wrapped = new Error(formatFirestoreWriteError(err));
    wrapped.code = err && err.code;
    wrapped.cause = err;
    throw wrapped;
  }
  applyBundleToPlatform(next);
  notifyListeners();
  return next.simulatorsMeta;
}

export async function saveShowcaseMetaToFirestore(patch, intervalSeconds) {
  var current = getCachedSimulatorsBundle();
  var next = normalizeBundle({
    simulatorsMeta: current.simulatorsMeta,
    showcaseStore: mergeShowcasePatch(current.showcaseStore, patch, intervalSeconds),
    platformSettings: current.platformSettings,
  });
  try {
    await writeBundleToFirestore(next);
  } catch (err) {
    var wrapped = new Error(formatFirestoreWriteError(err));
    wrapped.code = err && err.code;
    wrapped.cause = err;
    throw wrapped;
  }
  applyBundleToPlatform(next);
  notifyListeners();
  return next.showcaseStore;
}

async function maybeUploadSimulatorMedia(bundle, options) {
  var opts = options && typeof options === 'object' ? options : {};
  var pendingIcons = opts.pendingIcons || {};
  var pendingShowcase = opts.pendingShowcase || {};

  var mod = await import('./simulator-media-upload.js?v=' + Date.now());
  if (typeof mod.prepareSimulatorsPayloadForFirestore !== 'function') {
    return bundle;
  }

  var prepared = await mod.prepareSimulatorsPayloadForFirestore(
    {
      simulatorsMeta: bundle.simulatorsMeta,
      showcaseMeta: bundle.showcaseStore,
      platformSettings: bundle.platformSettings,
    },
    pendingIcons,
    pendingShowcase,
    opts.onProgress
  );

  return normalizeBundle({
    simulatorsMeta: prepared.simulatorsMeta,
    showcaseStore: prepared.showcaseMeta,
    platformSettings: bundle.platformSettings,
  });
}

export async function saveSimulatorsBundle(payload, options) {
  var current = getCachedSimulatorsBundle();
  var incoming = payload && typeof payload === 'object' ? payload : {};
  var next = normalizeBundle({
    simulatorsMeta: incoming.simulatorsMeta
      ? mergeSimulatorsMetaPatch(current.simulatorsMeta, incoming.simulatorsMeta)
      : current.simulatorsMeta,
    showcaseStore: mergeShowcasePatch(
      current.showcaseStore,
      incoming.showcaseMeta || incoming.showcasePatch || incoming.showcaseStore,
      incoming.showcaseIntervalSeconds != null
        ? incoming.showcaseIntervalSeconds
        : incoming.intervalSeconds
    ),
    platformSettings: incoming.platformSettings
      ? normalizePlatformSettings(Object.assign({}, current.platformSettings, incoming.platformSettings))
      : current.platformSettings,
  });
  try {
    if (options && typeof options.onProgress === 'function') {
      options.onProgress(28);
    }
    console.log('[PlatformSimulatorsFirestore] saveSimulatorsBundle: compressing media…');
    next = await maybeUploadSimulatorMedia(next, options);
    if (options && typeof options.onProgress === 'function') {
      options.onProgress(82);
    }
    console.log('[PlatformSimulatorsFirestore] saveSimulatorsBundle: writing Firestore…');
    await writeBundleToFirestore(next);
  } catch (err) {
    var message =
      err && err.message && String(err.message).indexOf('base64') !== -1
        ? String(err.message)
        : formatFirestoreWriteError(err);
    var wrapped = new Error(message);
    wrapped.code = err && err.code;
    wrapped.cause = err;
    throw wrapped;
  }
  applyBundleToPlatform(next);
  notifyListeners();
  return next;
}

export function startSimulatorsFirestoreSync() {
  if (unsubscribeSnapshot) return unsubscribeSnapshot;
  unsubscribeSnapshot = onSnapshot(
    SIMULATORS_REF,
    handleSnapshot,
    function (err) {
      console.error('[PlatformSimulatorsFirestore] onSnapshot failed', err);
      cachedBundle = readLocalBundle();
      snapshotReady = true;
      applyBundleToPlatform(cachedBundle);
      notifyListeners();
    }
  );
  return unsubscribeSnapshot;
}

var ftthLabConfigUnsubscribe = null;
var ftthLabConfigReady = false;
var lastPublishedFtthLabConfigJson = '';
var lastPublishedClientUpdatedAt = 0;
var lastPublishedServerUpdatedAtMs = 0;
var ftthLabConfigWriteInFlight = 0;

function firestoreTimestampToMs(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  var sec = Number(value.seconds != null ? value.seconds : value._seconds);
  if (isFinite(sec) && sec > 0) return Math.round(sec * 1000);
  var n = Number(value);
  return isFinite(n) && n > 0 ? n : 0;
}

function shouldRejectStaleRemoteLabConfig(storageKey, remoteData) {
  if (!storageKey) return false;
  if (typeof window.isRemoteLabConfigOlderThanLocal === 'function') {
    return window.isRemoteLabConfigOlderThanLocal(storageKey, remoteData);
  }
  try {
    var raw = window.localStorage.getItem(storageKey + '_meta');
    if (!raw) return false;
    var meta = JSON.parse(raw);
    var localAt = Number(meta && meta.clientUpdatedAt);
    if (!isFinite(localAt) || localAt <= 0) return false;
    if (!remoteData || typeof remoteData !== 'object') return true;
    var remoteAt = Number(remoteData.clientUpdatedAt);
    if (!isFinite(remoteAt) || remoteAt <= 0) return true;
    return remoteAt < localAt;
  } catch (err) {
    return false;
  }
}

function resolveLabConfigStorageKey(settingsGlobal, fallbackKey) {
  if (settingsGlobal && window[settingsGlobal] && window[settingsGlobal].STORAGE_KEY) {
    return window[settingsGlobal].STORAGE_KEY;
  }
  return fallbackKey || '';
}

function isStaleFtthLabConfigSnapshot(data) {
  if (!data || typeof data !== 'object') return false;
  var remoteClientAt = Number(data.clientUpdatedAt);
  if (lastPublishedClientUpdatedAt > 0) {
    if (!isFinite(remoteClientAt) || remoteClientAt <= 0) {
      if (Date.now() - lastPublishedClientUpdatedAt < 3000) return true;
    } else if (remoteClientAt < lastPublishedClientUpdatedAt) {
      return true;
    }
  }
  var remoteServerAt = firestoreTimestampToMs(data.updatedAt);
  if (
    remoteServerAt > 0 &&
    lastPublishedServerUpdatedAtMs > 0 &&
    remoteServerAt < lastPublishedServerUpdatedAtMs
  ) {
    return true;
  }
  return false;
}

function preserveFtthLabVisibilityFields(config) {
  if (!config || typeof config !== 'object' || !Array.isArray(config.items)) return config;
  var out = Object.assign({}, config);
  out.items = config.items.map(function (item) {
    if (!item || typeof item !== 'object') return item;
    var nextItem = Object.assign({}, item);
    if (Object.prototype.hasOwnProperty.call(item, 'visible')) {
      nextItem.visible = typeof item.visible === 'boolean' ? item.visible : item.visible !== false;
    }
    return nextItem;
  });
  return out;
}

function normalizeFtthLabConfigPayload(data) {
  if (!data || typeof data !== 'object') return null;
  var config = data.config != null ? data.config : data;
  if (!config || typeof config !== 'object') return null;
  var withVisibility = preserveFtthLabVisibilityFields(config);
  if (
    window.FtthLabSettings &&
    typeof window.FtthLabSettings.getActiveConfig === 'function' &&
    typeof window.FtthLabSettings.normalizeConfig === 'function'
  ) {
    var local = window.FtthLabSettings.getActiveConfig();
    if (local && Array.isArray(local.items)) {
      var localVis = {};
      local.items.forEach(function (it) {
        if (it && it.toolKey && it.visible === false) localVis[it.toolKey] = false;
      });
      withVisibility.items = (withVisibility.items || []).map(function (it) {
        if (!it || !it.toolKey) return it;
        if (Object.prototype.hasOwnProperty.call(it, 'visible')) return it;
        if (localVis[it.toolKey] === false) return Object.assign({}, it, { visible: false });
        return it;
      });
    }
  }
  if (window.FtthLabSettings && typeof window.FtthLabSettings.normalizeConfig === 'function') {
    return window.FtthLabSettings.normalizeConfig(withVisibility);
  }
  return withVisibility;
}

function applyFtthLabConfigFromFirestore(data) {
  if (ftthLabConfigWriteInFlight > 0) return false;
  if (!data || typeof data !== 'object') return false;
  if (isStaleFtthLabConfigSnapshot(data)) return false;
  if (shouldRejectStaleRemoteLabConfig(
    resolveLabConfigStorageKey('FtthLabSettings', 'ifa_ftth_lab_config'),
    data
  )) {
    return false;
  }
  if (!window.FtthLabSettings || typeof window.FtthLabSettings.importRemoteConfig !== 'function') {
    return false;
  }
  var normalized = normalizeFtthLabConfigPayload(data);
  if (!normalized) return false;
  var nextJson = JSON.stringify(normalized);
  if (nextJson === lastPublishedFtthLabConfigJson) return false;
  var applied = window.FtthLabSettings.importRemoteConfig(normalized, {
    clientUpdatedAt: Number(data.clientUpdatedAt),
  });
  if (applied) {
    lastPublishedFtthLabConfigJson = nextJson;
    var remoteClientAt = Number(data.clientUpdatedAt);
    if (isFinite(remoteClientAt) && remoteClientAt > 0) {
      lastPublishedClientUpdatedAt = Math.max(lastPublishedClientUpdatedAt, remoteClientAt);
    }
    var remoteServerAt = firestoreTimestampToMs(data.updatedAt);
    if (remoteServerAt > 0) {
      lastPublishedServerUpdatedAtMs = Math.max(lastPublishedServerUpdatedAtMs, remoteServerAt);
    }
  }
  return applied;
}

function handleFtthLabConfigSnapshot(snap) {
  ftthLabConfigReady = true;
  if (ftthLabConfigWriteInFlight > 0) return;
  if (!snap.exists()) return;
  applyFtthLabConfigFromFirestore(snap.data());
}

export function startFtthLabConfigFirestoreSync() {
  if (ftthLabConfigUnsubscribe) return ftthLabConfigUnsubscribe;
  ftthLabConfigUnsubscribe = onSnapshot(
    FTTH_LAB_CONFIG_REF,
    handleFtthLabConfigSnapshot,
    function (err) {
      console.error('[PlatformFtthLabConfigFirestore] onSnapshot failed', err);
      ftthLabConfigReady = true;
    }
  );
  return ftthLabConfigUnsubscribe;
}

export async function saveFtthLabConfigToFirestore(config) {
  var source =
    window.FtthLabSettings && typeof window.FtthLabSettings.normalizeConfig === 'function'
      ? window.FtthLabSettings.normalizeConfig(config)
      : config;
  var normalized = preserveFtthLabVisibilityFields(source);
  if (window.FtthLabSettings && typeof window.FtthLabSettings.normalizeConfig === 'function') {
    normalized = window.FtthLabSettings.normalizeConfig(normalized);
  }
  var clientUpdatedAt = Date.now();
  ftthLabConfigWriteInFlight += 1;
  try {
    await setDoc(
      FTTH_LAB_CONFIG_REF,
      {
        config: normalized,
        updatedAt: serverTimestamp(),
        clientUpdatedAt: clientUpdatedAt,
      },
      { merge: true }
    );
    lastPublishedFtthLabConfigJson = JSON.stringify(normalized);
    lastPublishedClientUpdatedAt = clientUpdatedAt;
    return normalized;
  } finally {
    ftthLabConfigWriteInFlight -= 1;
  }
}

window.addEventListener('ifa:auth-changed', function (e) {
  var detail = (e && e.detail) || {};
  if (detail.profileSynced && needsSeed && shouldAttemptAutoMigration()) {
    seedFromLocalOrDefaults();
  }
});

var api = {
  subscribe: subscribeSimulators,
  listenToSimulatorsMeta: listenToSimulatorsMeta,
  whenReady: whenSimulatorsFirestoreReady,
  getCachedSimulatorsBundle: getCachedSimulatorsBundle,
  isReady: isSimulatorsSnapshotReady,
  saveSimulatorMetaToFirestore: saveSimulatorMetaToFirestore,
  saveShowcaseMetaToFirestore: saveShowcaseMetaToFirestore,
  saveSimulatorsBundle: saveSimulatorsBundle,
  migrateLocalCacheToFirestore: migrateLocalCacheToFirestore,
  formatFirestoreWriteError: formatFirestoreWriteError,
  start: startSimulatorsFirestoreSync,
};

window.PlatformSimulatorsFirestore = api;

var ftthLabConfigApi = {
  start: startFtthLabConfigFirestoreSync,
  saveConfig: saveFtthLabConfigToFirestore,
  isReady: function () {
    return ftthLabConfigReady;
  },
};

window.PlatformFtthLabConfigFirestore = ftthLabConfigApi;

var opmConfigUnsubscribe = null;
var opmConfigReady = false;
var lastPublishedOpmConfigJson = '';
var lastPublishedOpmClientUpdatedAt = 0;
var lastPublishedOpmServerUpdatedAtMs = 0;
var opmConfigWriteInFlight = 0;

function isStaleOpmConfigSnapshot(data) {
  if (!data || typeof data !== 'object') return false;
  var remoteClientAt = Number(data.clientUpdatedAt);
  if (lastPublishedOpmClientUpdatedAt > 0) {
    if (!isFinite(remoteClientAt) || remoteClientAt <= 0) {
      if (Date.now() - lastPublishedOpmClientUpdatedAt < 3000) return true;
    } else if (remoteClientAt < lastPublishedOpmClientUpdatedAt) {
      return true;
    }
  }
  var remoteServerAt = firestoreTimestampToMs(data.updatedAt);
  if (
    remoteServerAt > 0 &&
    lastPublishedOpmServerUpdatedAtMs > 0 &&
    remoteServerAt < lastPublishedOpmServerUpdatedAtMs
  ) {
    return true;
  }
  return false;
}

function normalizeOpmConfigPayload(data) {
  if (!data || typeof data !== 'object') return null;
  var config = data.config != null ? data.config : data;
  if (!config || typeof config !== 'object') return null;
  var withVisibility = preserveFtthLabVisibilityFields(config);
  if (
    window.OpmSettings &&
    typeof window.OpmSettings.getActiveConfig === 'function' &&
    typeof window.OpmSettings.normalizeConfig === 'function'
  ) {
    var local = window.OpmSettings.getActiveConfig();
    if (local && Array.isArray(local.items)) {
      var localVis = {};
      local.items.forEach(function (it) {
        if (it && it.toolKey && it.visible === false) localVis[it.toolKey] = false;
      });
      withVisibility.items = (withVisibility.items || []).map(function (it) {
        if (!it || !it.toolKey) return it;
        if (Object.prototype.hasOwnProperty.call(it, 'visible')) return it;
        if (localVis[it.toolKey] === false) return Object.assign({}, it, { visible: false });
        return it;
      });
    }
    return window.OpmSettings.normalizeConfig(withVisibility);
  }
  return withVisibility;
}

function applyOpmConfigFromFirestore(data) {
  if (opmConfigWriteInFlight > 0) return false;
  if (!data || typeof data !== 'object') return false;
  if (isStaleOpmConfigSnapshot(data)) return false;
  if (shouldRejectStaleRemoteLabConfig(
    resolveLabConfigStorageKey('OpmSettings', 'ifa_opm_config'),
    data
  )) {
    return false;
  }
  if (!window.OpmSettings || typeof window.OpmSettings.importRemoteConfig !== 'function') {
    return false;
  }
  var normalized = normalizeOpmConfigPayload(data);
  if (!normalized) return false;
  var nextJson = JSON.stringify(normalized);
  if (nextJson === lastPublishedOpmConfigJson) return false;
  var applied = window.OpmSettings.importRemoteConfig(normalized, {
    clientUpdatedAt: Number(data.clientUpdatedAt),
  });
  if (applied) {
    lastPublishedOpmConfigJson = nextJson;
    var remoteClientAt = Number(data.clientUpdatedAt);
    if (isFinite(remoteClientAt) && remoteClientAt > 0) {
      lastPublishedOpmClientUpdatedAt = Math.max(lastPublishedOpmClientUpdatedAt, remoteClientAt);
    }
    var remoteServerAt = firestoreTimestampToMs(data.updatedAt);
    if (remoteServerAt > 0) {
      lastPublishedOpmServerUpdatedAtMs = Math.max(lastPublishedOpmServerUpdatedAtMs, remoteServerAt);
    }
    if (window.FtthLab && typeof window.FtthLab.applyLabConfigPayload === 'function') {
      window.FtthLab.applyLabConfigPayload({
        type: 'ifa:lab-config-apply',
        store: 'OpmSettings',
        config: normalized,
        preview: false,
      });
    }
  }
  return applied;
}

function handleOpmConfigSnapshot(snap) {
  opmConfigReady = true;
  if (opmConfigWriteInFlight > 0) return;
  if (!snap.exists()) return;
  applyOpmConfigFromFirestore(snap.data());
}

export function startOpmConfigFirestoreSync() {
  if (opmConfigUnsubscribe) return opmConfigUnsubscribe;
  opmConfigUnsubscribe = onSnapshot(
    OPM_CONFIG_REF,
    handleOpmConfigSnapshot,
    function (err) {
      console.error('[PlatformOpmConfigFirestore] onSnapshot failed', err);
      opmConfigReady = true;
    }
  );
  return opmConfigUnsubscribe;
}

export async function saveOpmConfigToFirestore(config) {
  var source =
    window.OpmSettings && typeof window.OpmSettings.normalizeConfig === 'function'
      ? window.OpmSettings.normalizeConfig(config)
      : config;
  var normalized = preserveFtthLabVisibilityFields(source);
  if (window.OpmSettings && typeof window.OpmSettings.normalizeConfig === 'function') {
    normalized = window.OpmSettings.normalizeConfig(normalized);
  }
  var clientUpdatedAt = Date.now();
  opmConfigWriteInFlight += 1;
  try {
    await setDoc(
      OPM_CONFIG_REF,
      {
        config: normalized,
        updatedAt: serverTimestamp(),
        clientUpdatedAt: clientUpdatedAt,
      },
      { merge: true }
    );
    lastPublishedOpmConfigJson = JSON.stringify(normalized);
    lastPublishedOpmClientUpdatedAt = clientUpdatedAt;
    return normalized;
  } finally {
    opmConfigWriteInFlight -= 1;
  }
}

var opmConfigApi = {
  start: startOpmConfigFirestoreSync,
  saveConfig: saveOpmConfigToFirestore,
  isReady: function () {
    return opmConfigReady;
  },
};

window.PlatformOpmConfigFirestore = opmConfigApi;

function createLabDeviceConfigFirestoreSync(options) {
  var ref = options.ref;
  var settingsGlobal = options.settingsGlobal;
  var storeName = options.storeName;
  var storageKey = options.storageKey || '';
  var logTag = options.logTag || storeName;

  var configUnsubscribe = null;
  var configReady = false;
  var lastPublishedConfigJson = '';
  var lastPublishedClientUpdatedAt = 0;
  var lastPublishedServerUpdatedAtMs = 0;
  var configWriteInFlight = 0;

  function getSettingsStore() {
    return window[settingsGlobal];
  }

  function isStaleConfigSnapshot(data) {
    if (!data || typeof data !== 'object') return false;
    var remoteClientAt = Number(data.clientUpdatedAt);
    if (lastPublishedClientUpdatedAt > 0) {
      if (!isFinite(remoteClientAt) || remoteClientAt <= 0) {
        if (Date.now() - lastPublishedClientUpdatedAt < 3000) return true;
      } else if (remoteClientAt < lastPublishedClientUpdatedAt) {
        return true;
      }
    }
    var remoteServerAt = firestoreTimestampToMs(data.updatedAt);
    if (
      remoteServerAt > 0 &&
      lastPublishedServerUpdatedAtMs > 0 &&
      remoteServerAt < lastPublishedServerUpdatedAtMs
    ) {
      return true;
    }
    return false;
  }

  function normalizeConfigPayload(data) {
    if (!data || typeof data !== 'object') return null;
    var config = data.config != null ? data.config : data;
    if (!config || typeof config !== 'object') return null;
    var withVisibility = preserveFtthLabVisibilityFields(config);
    var settingsStore = getSettingsStore();
    if (
      settingsStore &&
      typeof settingsStore.getActiveConfig === 'function' &&
      typeof settingsStore.normalizeConfig === 'function'
    ) {
      var local = settingsStore.getActiveConfig();
      if (local && Array.isArray(local.items)) {
        var localVis = {};
        local.items.forEach(function (it) {
          if (it && it.toolKey && it.visible === false) localVis[it.toolKey] = false;
        });
        withVisibility.items = (withVisibility.items || []).map(function (it) {
          if (!it || !it.toolKey) return it;
          if (Object.prototype.hasOwnProperty.call(it, 'visible')) return it;
          if (localVis[it.toolKey] === false) return Object.assign({}, it, { visible: false });
          return it;
        });
      }
      return settingsStore.normalizeConfig(withVisibility);
    }
    return withVisibility;
  }

  function applyConfigFromFirestore(data) {
    if (configWriteInFlight > 0) return false;
    if (!data || typeof data !== 'object') return false;
    if (isStaleConfigSnapshot(data)) return false;
    var settingsStore = getSettingsStore();
    var resolvedStorageKey = resolveLabConfigStorageKey(settingsGlobal, storageKey);
    if (shouldRejectStaleRemoteLabConfig(resolvedStorageKey, data)) {
      return false;
    }
    if (!settingsStore || typeof settingsStore.importRemoteConfig !== 'function') {
      return false;
    }
    var normalized = normalizeConfigPayload(data);
    if (!normalized) return false;
    var nextJson = JSON.stringify(normalized);
    if (nextJson === lastPublishedConfigJson) return false;
    var applied = settingsStore.importRemoteConfig(normalized, {
      clientUpdatedAt: Number(data.clientUpdatedAt),
    });
    if (applied) {
      lastPublishedConfigJson = nextJson;
      var remoteClientAt = Number(data.clientUpdatedAt);
      if (isFinite(remoteClientAt) && remoteClientAt > 0) {
        lastPublishedClientUpdatedAt = Math.max(lastPublishedClientUpdatedAt, remoteClientAt);
      }
      var remoteServerAt = firestoreTimestampToMs(data.updatedAt);
      if (remoteServerAt > 0) {
        lastPublishedServerUpdatedAtMs = Math.max(lastPublishedServerUpdatedAtMs, remoteServerAt);
      }
      if (window.FtthLab && typeof window.FtthLab.applyLabConfigPayload === 'function') {
        window.FtthLab.applyLabConfigPayload({
          type: 'ifa:lab-config-apply',
          store: storeName,
          config: normalized,
          preview: false,
        });
      }
    }
    return applied;
  }

  function handleConfigSnapshot(snap) {
    configReady = true;
    if (configWriteInFlight > 0) return;
    if (!snap.exists()) return;
    applyConfigFromFirestore(snap.data());
  }

  function start() {
    if (configUnsubscribe) return configUnsubscribe;
    configUnsubscribe = onSnapshot(
      ref,
      handleConfigSnapshot,
      function (err) {
        console.error('[' + logTag + '] onSnapshot failed', err);
        configReady = true;
      }
    );
    return configUnsubscribe;
  }

  async function saveConfig(config) {
    var settingsStore = getSettingsStore();
    var source =
      settingsStore && typeof settingsStore.normalizeConfig === 'function'
        ? settingsStore.normalizeConfig(config)
        : config;
    var normalized = preserveFtthLabVisibilityFields(source);
    if (settingsStore && typeof settingsStore.normalizeConfig === 'function') {
      normalized = settingsStore.normalizeConfig(normalized);
    }
    var clientUpdatedAt = Date.now();
    configWriteInFlight += 1;
    try {
      await setDoc(
        ref,
        {
          config: normalized,
          updatedAt: serverTimestamp(),
          clientUpdatedAt: clientUpdatedAt,
        },
        { merge: true }
      );
      lastPublishedConfigJson = JSON.stringify(normalized);
      lastPublishedClientUpdatedAt = clientUpdatedAt;
      return normalized;
    } finally {
      configWriteInFlight -= 1;
    }
  }

  return {
    start: start,
    saveConfig: saveConfig,
    isReady: function () {
      return configReady;
    },
  };
}

var otdrConfigApi = createLabDeviceConfigFirestoreSync({
  ref: OTDR_CONFIG_REF,
  settingsGlobal: 'OtdrSettings',
  storeName: 'OtdrSettings',
  storageKey: 'ifa_otdr_config',
  logTag: 'PlatformOtdrConfigFirestore',
});

export function startOtdrConfigFirestoreSync() {
  return otdrConfigApi.start();
}

export async function saveOtdrConfigToFirestore(config) {
  return otdrConfigApi.saveConfig(config);
}

window.PlatformOtdrConfigFirestore = otdrConfigApi;

var splicerConfigApi = createLabDeviceConfigFirestoreSync({
  ref: SPLICER_CONFIG_REF,
  settingsGlobal: 'FusionSplicerSettings',
  storeName: 'FusionSplicerSettings',
  storageKey: 'ifa_splicer_config',
  logTag: 'PlatformSplicerConfigFirestore',
});

export function startSplicerConfigFirestoreSync() {
  return splicerConfigApi.start();
}

export async function saveSplicerConfigToFirestore(config) {
  return splicerConfigApi.saveConfig(config);
}

window.PlatformSplicerConfigFirestore = splicerConfigApi;

(function bootstrapSimulatorsSwrShell() {
  var localBundle = readLocalBundle();
  applyBundleToPlatform(localBundle);
  notifyListeners();
})();

scheduleDeferredFirestoreSync(startSimulatorsFirestoreSync);

if (typeof window.__ifaSimulatorsFirestoreReadyResolve === 'function') {
  window.__ifaSimulatorsFirestoreReadyResolve(api);
}

export default api;
