/**
 * Public landing page statistics — Firestore settings/stats (real-time) with local fallback.
 */
(function (global) {
  'use strict';

  var KEY = 'ifa_platform_stats';
  var hydrated = false;

  var DEFAULTS = {
    enrolledStudents: 2500,
    simulatedKilometers: 15000,
    trainingProjects: 48,
    satisfactionRate: 98,
  };

  function readJson() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (err) {
      return null;
    }
  }

  function clampInt(value, fallback, min, max) {
    var n = parseInt(value, 10);
    if (!isFinite(n)) return fallback;
    if (n < min) return min;
    if (n > max) return max;
    return n;
  }

  function resolveEnrolledStudentsCount(storedValue) {
    if (global.AdminUsers && typeof global.AdminUsers.getRegisteredUserCount === 'function') {
      if (typeof global.AdminUsers.isFirestoreLive === 'function' && global.AdminUsers.isFirestoreLive()) {
        return clampInt(global.AdminUsers.getRegisteredUserCount(), storedValue, 0, 99999999);
      }
    }
    if (
      global.PlatformUserMetrics &&
      typeof global.PlatformUserMetrics.getTotalUsers === 'function' &&
      typeof global.PlatformUserMetrics.isReady === 'function' &&
      global.PlatformUserMetrics.isReady()
    ) {
      return clampInt(global.PlatformUserMetrics.getTotalUsers(), storedValue, 0, 99999999);
    }
    return clampInt(storedValue, DEFAULTS.enrolledStudents, 0, 99999999);
  }

  function normalizeStats(raw) {
    if (global.PlatformStatsFirestore && typeof global.PlatformStatsFirestore.normalizeStats === 'function') {
      var fromFirestore = global.PlatformStatsFirestore.normalizeStats(raw);
      fromFirestore.enrolledStudents = resolveEnrolledStudentsCount(fromFirestore.enrolledStudents);
      return fromFirestore;
    }
    var src = raw && typeof raw === 'object' ? raw : {};
    var storedEnrolled = clampInt(src.enrolledStudents, DEFAULTS.enrolledStudents, 0, 99999999);
    return {
      enrolledStudents: resolveEnrolledStudentsCount(storedEnrolled),
      simulatedKilometers: clampInt(src.simulatedKilometers, DEFAULTS.simulatedKilometers, 0, 999999999),
      trainingProjects: clampInt(src.trainingProjects, DEFAULTS.trainingProjects, 0, 9999999),
      satisfactionRate: clampInt(src.satisfactionRate, DEFAULTS.satisfactionRate, 0, 100),
    };
  }

  /** Always Latin digits 0-9 — never Arabic-Indic numerals. */
  function formatStatNumber(value) {
    var n = Number(value);
    if (!isFinite(n)) return '0';
    return Math.round(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
  }

  function getStats() {
    var local = readJson();
    if (local) return normalizeStats(local);
    if (global.PlatformStatsFirestore && typeof global.PlatformStatsFirestore.getCachedStats === 'function') {
      return normalizeStats(global.PlatformStatsFirestore.getCachedStats());
    }
    return normalizeStats(DEFAULTS);
  }

  function isHydrated() {
    if (hydrated) return true;
    if (readJson()) return true;
    if (
      global.PlatformStatsFirestore &&
      typeof global.PlatformStatsFirestore.isHydrated === 'function' &&
      global.PlatformStatsFirestore.isHydrated()
    ) {
      return true;
    }
    return false;
  }

  function setStatsLoading(loading) {
    var section = document.getElementById('stats');
    if (!section) return;
    section.classList.toggle('stats--loading', !!loading);
  }

  function dispatchHydrated(stats) {
    if (hydrated) return;
    hydrated = true;
    setStatsLoading(false);
    try {
      global.dispatchEvent(new CustomEvent('ifa:platform-stats-hydrated', { detail: stats }));
    } catch (err) {
      /* ignore */
    }
  }

  function saveStats(patch) {
    var merged = Object.assign({}, getStats(), patch || {});
    delete merged.enrolledStudents;
    var next = normalizeStats(merged);
    var toPersist = Object.assign({}, next);
    delete toPersist.enrolledStudents;
    if (global.PlatformStatsFirestore && typeof global.PlatformStatsFirestore.saveStats === 'function') {
      return global.PlatformStatsFirestore.saveStats(toPersist).then(function (saved) {
        saved.enrolledStudents = next.enrolledStudents;
        return saved;
      });
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(toPersist));
    } catch (err) {
      console.error('[PlatformStats] save failed', err);
    }
    try {
      global.dispatchEvent(new CustomEvent('ifa:platform-stats-changed', { detail: next }));
    } catch (err2) {
      /* ignore */
    }
    dispatchHydrated(next);
    return Promise.resolve(next);
  }

  function applyLandingStats(root) {
    var scope = root && root.querySelectorAll ? root : document;
    var stats = getStats();
    scope.querySelectorAll('[data-stat-key]').forEach(function (el) {
      var key = el.getAttribute('data-stat-key');
      if (!stats.hasOwnProperty(key)) return;
      el.setAttribute('data-target', String(stats[key]));
    });
  }

  function loadPublicStats() {
    applyLandingStats(document);
    if (isHydrated()) {
      dispatchHydrated(getStats());
    } else {
      setStatsLoading(true);
    }
  }

  function bindFirestoreSubscription() {
    (function waitForFirestore(attempts) {
      if (global.PlatformStatsFirestore && typeof global.PlatformStatsFirestore.subscribe === 'function') {
        global.PlatformStatsFirestore.subscribe(function () {
          loadPublicStats();
        });
        if (global.PlatformStatsFirestore.isHydrated && global.PlatformStatsFirestore.isHydrated()) {
          loadPublicStats();
        }
        return;
      }
      if (attempts > 40) return;
      global.setTimeout(function () {
        waitForFirestore(attempts + 1);
      }, 50);
    })(0);
  }

  global.PlatformStats = {
    KEY: KEY,
    DEFAULTS: DEFAULTS,
    getStats: getStats,
    saveStats: saveStats,
    normalizeStats: normalizeStats,
    formatStatNumber: formatStatNumber,
    applyLandingStats: applyLandingStats,
    loadPublicStats: loadPublicStats,
    isHydrated: isHydrated,
    usesFirestore: function () {
      return !!(
        global.PlatformStatsFirestore &&
        typeof global.PlatformStatsFirestore.isReady === 'function' &&
        global.PlatformStatsFirestore.isReady()
      );
    },
  };

  if (readJson()) {
    if (document.body) {
      applyLandingStats(document);
      dispatchHydrated(getStats());
    }
  } else {
    if (document.body) setStatsLoading(true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      loadPublicStats();
      bindFirestoreSubscription();
    });
  } else {
    loadPublicStats();
    bindFirestoreSubscription();
  }

  global.addEventListener('ifa:platform-stats-hydrated', function () {
    hydrated = true;
    setStatsLoading(false);
  });

  global.addEventListener('ifa:platform-stats-changed', function () {
    loadPublicStats();
  });

  global.addEventListener('ifa:platform-user-metrics-changed', function () {
    loadPublicStats();
  });

  global.addEventListener('ifa:admin-users-changed', function () {
    loadPublicStats();
  });

  global.addEventListener('storage', function (e) {
    if (e.key !== KEY) return;
    loadPublicStats();
    dispatchHydrated(getStats());
  });
})(typeof window !== 'undefined' ? window : this);
