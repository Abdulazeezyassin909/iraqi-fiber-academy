/**
 * Boots Firestore simulator CMS sync on public and admin pages.
 * Exposes window.__ifaSimulatorsFirestoreReady so classic scripts can await init.
 */
(function initSimulatorsFirestoreReadyPromise() {
  if (window.__ifaSimulatorsFirestoreReady) return;
  var readyResolve;
  var readyReject;
  window.__ifaSimulatorsFirestoreReady = new Promise(function (resolve, reject) {
    readyResolve = resolve;
    readyReject = reject;
  });
  window.__ifaSimulatorsFirestoreReadyResolve = readyResolve;
  window.__ifaSimulatorsFirestoreReadyReject = readyReject;
})();

import('./firestore-simulators.js')
  .then(function () {
    var api = window.PlatformSimulatorsFirestore;
    if (!api) {
      throw new Error('firestore-simulators.js loaded but PlatformSimulatorsFirestore is missing');
    }
    if (typeof window.__ifaSimulatorsFirestoreReadyResolve === 'function') {
      window.__ifaSimulatorsFirestoreReadyResolve(api);
    }
    try {
      window.dispatchEvent(
        new CustomEvent('ifa:simulators-firestore-ready', { detail: { api: api } })
      );
      document.dispatchEvent(
        new CustomEvent('ifa:simulators-firestore-ready', { detail: { api: api } })
      );
    } catch (err) {
      /* ignore */
    }
  })
  .catch(function (err) {
    console.error('[platform-simulators-firestore-sync] failed to load firestore-simulators.js', err);
    window.__ifaSimulatorsFirestoreLoadError = err;
    if (typeof window.__ifaSimulatorsFirestoreReadyReject === 'function') {
      window.__ifaSimulatorsFirestoreReadyReject(err);
    }
    try {
      window.dispatchEvent(
        new CustomEvent('ifa:simulators-firestore-load-error', { detail: err })
      );
      document.dispatchEvent(
        new CustomEvent('ifa:simulators-firestore-load-error', { detail: err })
      );
    } catch (err2) {
      /* ignore */
    }
  });
