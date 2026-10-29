/**
 * Public total registered users (mirrored from Firestore `users` by admin sync).
 * Doc: settings/user_metrics — world-readable; admin-only writes.
 */
import { db } from './firebase-config.js';
import {
  doc,
  onSnapshot,
  setDoc,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { scheduleLazyFirestoreSync } from './firestore-sync-scheduler.js';

var DOC_ID = 'user_metrics';
var cachedTotal = 0;
var metricsReady = false;
var unsubscribeSnapshot = null;

function clampCount(value) {
  var n = parseInt(value, 10);
  if (!isFinite(n) || n < 0) return 0;
  if (n > 99999999) return 99999999;
  return n;
}

function notifyListeners() {
  try {
    window.dispatchEvent(
      new CustomEvent('ifa:platform-user-metrics-changed', {
        detail: { totalUsers: cachedTotal },
      })
    );
    document.dispatchEvent(
      new CustomEvent('ifa:platform-user-metrics-changed', {
        detail: { totalUsers: cachedTotal },
      })
    );
  } catch (err) {
    /* ignore */
  }
}

function handleSnapshot(snap) {
  if (!snap.exists()) {
    cachedTotal = 0;
    metricsReady = false;
    notifyListeners();
    return;
  }
  var data = snap.data() || {};
  cachedTotal = clampCount(data.totalUsers);
  metricsReady = true;
  notifyListeners();
}

export function getRegisteredUserCount() {
  return cachedTotal;
}

export function isRegisteredUserCountReady() {
  return metricsReady;
}

export async function publishRegisteredUserCount(count) {
  var total = clampCount(count);
  await setDoc(
    doc(db, 'settings', DOC_ID),
    {
      totalUsers: total,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  cachedTotal = total;
  metricsReady = true;
  notifyListeners();
  return total;
}

export function startUserMetricsSync() {
  if (unsubscribeSnapshot) return unsubscribeSnapshot;
  unsubscribeSnapshot = onSnapshot(
    doc(db, 'settings', DOC_ID),
    handleSnapshot,
    function (err) {
      console.error('[PlatformUserMetrics] onSnapshot failed', err);
      metricsReady = false;
      notifyListeners();
    }
  );
  return unsubscribeSnapshot;
}

var api = {
  getTotalUsers: getRegisteredUserCount,
  isReady: isRegisteredUserCountReady,
  publishTotalUsers: publishRegisteredUserCount,
  start: startUserMetricsSync,
};

window.PlatformUserMetrics = api;
scheduleLazyFirestoreSync(startUserMetricsSync);

export default api;
