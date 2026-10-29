/**
 * Firestore real-time sync for landing page statistics (settings/stats).
 */
import { db } from './firebase-config.js';
import { doc, onSnapshot, setDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { scheduleLazyFirestoreSync } from './firestore-sync-scheduler.js';

var DOC_PATH = ['settings', 'stats'];
var STORAGE_KEY = 'ifa_platform_stats';
var cachedStats = null;
var snapshotReady = false;
var hydrated = false;
var listeners = [];
var unsubscribeSnapshot = null;

var DEFAULTS = {
  enrolledStudents: 2500,
  simulatedKilometers: 15000,
  trainingProjects: 48,
  satisfactionRate: 98,
};

function clampInt(value, fallback, min, max) {
  var n = parseInt(value, 10);
  if (!isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function normalizeStats(raw) {
  var src = raw && typeof raw === 'object' ? raw : {};
  return {
    enrolledStudents: clampInt(src.enrolledStudents, DEFAULTS.enrolledStudents, 0, 99999999),
    simulatedKilometers: clampInt(src.simulatedKilometers, DEFAULTS.simulatedKilometers, 0, 999999999),
    trainingProjects: clampInt(src.trainingProjects, DEFAULTS.trainingProjects, 0, 9999999),
    satisfactionRate: clampInt(src.satisfactionRate, DEFAULTS.satisfactionRate, 0, 100),
  };
}

function readLocalStats() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normalizeStats(JSON.parse(raw));
  } catch (err) {
    return null;
  }
}

function writeLocalStats(stats) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeStats(stats)));
  } catch (err) {
    /* ignore quota / private mode */
  }
}

function dispatchHydrated(stats) {
  try {
    window.dispatchEvent(
      new CustomEvent('ifa:platform-stats-hydrated', { detail: stats })
    );
  } catch (err) {
    /* ignore */
  }
}

function markHydrated(stats) {
  if (hydrated) return;
  hydrated = true;
  dispatchHydrated(stats);
}

cachedStats = readLocalStats();

function notifyListeners() {
  var stats = getCachedPlatformStats();
  listeners.forEach(function (fn) {
    try {
      fn(stats);
    } catch (err) {
      console.error('[PlatformStatsFirestore] listener failed', err);
    }
  });
  try {
    window.dispatchEvent(new CustomEvent('ifa:platform-stats-changed', { detail: stats }));
    document.dispatchEvent(new CustomEvent('ifa:platform-stats-changed', { detail: stats }));
  } catch (err) {
    /* ignore */
  }
}

function handleSnapshot(snap) {
  if (!snap.exists()) {
    cachedStats = normalizeStats(DEFAULTS);
  } else {
    cachedStats = normalizeStats(snap.data());
  }
  writeLocalStats(cachedStats);
  snapshotReady = true;
  markHydrated(cachedStats);
  notifyListeners();
}

export function getCachedPlatformStats() {
  return normalizeStats(cachedStats || readLocalStats() || DEFAULTS);
}

export function isStatsSnapshotReady() {
  return snapshotReady;
}

export function isStatsHydrated() {
  return hydrated || snapshotReady || !!readLocalStats();
}

export function subscribePlatformStats(callback) {
  if (typeof callback === 'function') {
    listeners.push(callback);
    if (snapshotReady) callback(getCachedPlatformStats());
  }
  return function () {
    listeners = listeners.filter(function (fn) {
      return fn !== callback;
    });
  };
}

export async function savePlatformStats(patch) {
  var next = normalizeStats(Object.assign({}, getCachedPlatformStats(), patch || {}));
  next.updatedAt = new Date().toISOString();
  await setDoc(doc(db, DOC_PATH[0], DOC_PATH[1]), next, { merge: true });
  cachedStats = next;
  writeLocalStats(cachedStats);
  snapshotReady = true;
  markHydrated(cachedStats);
  notifyListeners();
  return next;
}

export function startPlatformStatsSync() {
  if (unsubscribeSnapshot) return unsubscribeSnapshot;
  unsubscribeSnapshot = onSnapshot(
    doc(db, DOC_PATH[0], DOC_PATH[1]),
    handleSnapshot,
    function (err) {
      console.error('[PlatformStatsFirestore] onSnapshot failed', err);
      cachedStats = normalizeStats(readLocalStats() || DEFAULTS);
      snapshotReady = true;
      markHydrated(cachedStats);
      notifyListeners();
    }
  );
  return unsubscribeSnapshot;
}

if (cachedStats) {
  markHydrated(cachedStats);
}

var api = {
  DEFAULTS: DEFAULTS,
  normalizeStats: normalizeStats,
  subscribe: subscribePlatformStats,
  getCachedStats: getCachedPlatformStats,
  isReady: isStatsSnapshotReady,
  isHydrated: isStatsHydrated,
  saveStats: savePlatformStats,
  start: startPlatformStatsSync,
};

window.PlatformStatsFirestore = api;
if (cachedStats) {
  markHydrated(cachedStats);
  notifyListeners();
}
scheduleLazyFirestoreSync(startPlatformStatsSync);

export default api;
