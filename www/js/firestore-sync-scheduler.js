/**
 * Defers Firestore onSnapshot startup so first paint is not competing with WebChannel setup.
 */
export function scheduleDeferredFirestoreSync(startFn) {
  if (typeof startFn !== 'function') return;
  function run() {
    try {
      startFn();
    } catch (err) {
      console.error('[FirestoreSyncScheduler] deferred start failed', err);
    }
  }
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(run, { timeout: 2500 });
  } else {
    setTimeout(run, 1);
  }
}

/**
 * Low-priority listeners (notifications, testimonials, stats): after load + idle, or on first interaction.
 */
export function scheduleLazyFirestoreSync(startFn) {
  if (typeof startFn !== 'function') return;
  var started = false;

  function runOnce() {
    if (started) return;
    started = true;
    window.removeEventListener('pointerdown', runOnce, true);
    window.removeEventListener('keydown', runOnce, true);
    scheduleDeferredFirestoreSync(startFn);
  }

  window.addEventListener('pointerdown', runOnce, { once: true, capture: true });
  window.addEventListener('keydown', runOnce, { once: true, capture: true });

  function afterLoad() {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(runOnce, { timeout: 8000 });
    } else {
      setTimeout(runOnce, 400);
    }
  }

  if (document.readyState === 'complete') {
    afterLoad();
  } else {
    window.addEventListener('load', afterLoad, { once: true });
  }
}

/**
 * Read JSON array from localStorage and notify subscribers (SWR shell).
 */
export function hydrateListFromLocalStorage(storageKey, normalizeItem, applyList, notify) {
  if (!storageKey || typeof applyList !== 'function') return false;
  try {
    var raw = localStorage.getItem(storageKey);
    if (!raw) return false;
    var parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length) return false;
    var list = parsed.map(function (item) {
      return typeof normalizeItem === 'function' ? normalizeItem(item, item && item.id) : item;
    });
    applyList(list);
    if (typeof notify === 'function') notify();
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Read JSON object from localStorage.
 */
export function readJsonFromLocalStorage(storageKey) {
  if (!storageKey) return null;
  try {
    var raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}
