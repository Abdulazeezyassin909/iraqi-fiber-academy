/**
 * Restrict simulator pages to authenticated users with tier-scoped simulator access.
 * Overlay only — never removes canvas / workspace DOM.
 * Local file:// / localhost: full bypass (no gate).
 */
import { auth } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { syncUserProfile, fetchUserProfile } from './db-manager.js';
import { loginWithGoogle } from './auth-manager.js';

var OWNER_ACCOUNT_EMAIL = 'abdulazizyassin909@gmail.com';
var FIRESTORE_ACCESS_TIMEOUT_MS = 8000;

function shouldBypassAccessControl() {
  if (typeof window !== 'undefined' && window.IFA_ENV && typeof window.IFA_ENV.shouldBypassAccessControl === 'function') {
    return window.IFA_ENV.shouldBypassAccessControl();
  }
  try {
    if (!window || !window.location) return false;
    if (window.location.protocol === 'file:') return true;
    var host = String(window.location.hostname || '').toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  } catch (err) {
    return false;
  }
}

function getGate() {
  return document.getElementById('subscriber-gate');
}

function setGateVisible(visible, reason) {
  var gate = getGate();
  if (!gate) return;

  if (visible) {
    gate.hidden = false;
    gate.setAttribute('aria-hidden', 'false');
    gate.classList.add('subscriber-gate--visible');
    document.body.classList.add('subscriber-gate-active');
  } else {
    gate.hidden = true;
    gate.setAttribute('aria-hidden', 'true');
    gate.classList.remove('subscriber-gate--visible');
    document.body.classList.remove('subscriber-gate-active');
  }

  var statusEl = gate.querySelector('[data-subscriber-gate-status]');
  if (statusEl) {
    if (!visible) {
      statusEl.textContent = '';
    } else if (reason === 'loading') {
      statusEl.textContent = 'جاري التحقق من حالة الاشتراك…';
    } else if (reason === 'logged-out') {
      statusEl.textContent = 'يرجى تسجيل الدخول بحساب Google للمتابعة.';
    } else if (reason === 'not-subscriber') {
      statusEl.textContent = 'حسابك مسجّل لكن الاشتراك غير مفعّل بعد.';
    } else if (reason === 'simulator-locked') {
      statusEl.textContent = 'هذا المحاكي غير مشمول في باقتك الحالية. راجع الباقات للترقية.';
    } else {
      statusEl.textContent = '';
    }
  }
}

function normalizeSimulatorPageSlug(pageName) {
  var slug = String(pageName || '')
    .split('?')[0]
    .split('#')[0]
    .toLowerCase()
    .trim();
  if (slug.endsWith('.html')) slug = slug.slice(0, -5);
  return slug;
}

function currentSimulatorIdFromPage() {
  if (window.PlatformSimulators && typeof window.PlatformSimulators.currentSimulatorIdFromLocation === 'function') {
    return window.PlatformSimulators.currentSimulatorIdFromLocation();
  }
  var slug = '';
  try {
    slug = normalizeSimulatorPageSlug(
      decodeURIComponent(String(window.location.pathname || '').split('/').pop() || '')
    );
  } catch (err) {
    slug = '';
  }
  if (slug === 'simulator') {
    return 'ftth-simulator';
  }
  var catalog =
    window.PlatformSimulators && typeof window.PlatformSimulators.getCatalog === 'function'
      ? window.PlatformSimulators.getCatalog()
      : [];
  for (var i = 0; i < catalog.length; i++) {
    var hrefSlug = normalizeSimulatorPageSlug(String(catalog[i].href || '').split('/').pop());
    if (hrefSlug && hrefSlug === slug) return String(catalog[i].id || '');
  }
  return '';
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function readRawLocalAuthUser() {
  try {
    var raw = localStorage.getItem('ifa_auth_user');
    if (!raw) return null;
    var parsed = JSON.parse(raw);
    return parsed && parsed.email ? parsed : null;
  } catch (err) {
    return null;
  }
}

function parseTrialExpiresAtMs(value) {
  if (value == null || value === '') return 0;
  if (typeof value === 'number' && isFinite(value)) return value;
  if (typeof value === 'string') {
    var trimmed = String(value).trim();
    if (!trimmed) return 0;
    var asNum = Number(trimmed);
    if (isFinite(asNum) && /^\d+(\.\d+)?$/.test(trimmed)) return asNum;
    var parsed = Date.parse(trimmed);
    if (isFinite(parsed)) return parsed;
    var fromDate = new Date(trimmed).getTime();
    return isFinite(fromDate) ? fromDate : 0;
  }
  return 0;
}

function getLocalAuthSnapshot() {
  var raw = readRawLocalAuthUser();
  if (window.IFAAuth && typeof window.IFAAuth.getLocalAuthUser === 'function') {
    var fromApi = window.IFAAuth.getLocalAuthUser();
    if (!fromApi) return raw;
    if (!raw || normalizeEmail(raw.email) !== normalizeEmail(fromApi.email)) return fromApi;
    var trialMs = parseTrialExpiresAtMs(raw.trialExpiresAt);
    if (trialMs > 0) {
      return Object.assign({}, fromApi, { trialExpiresAt: trialMs });
    }
    return fromApi;
  }
  return raw;
}

function localTrialExpiryMs(localAuth) {
  if (!localAuth) return 0;
  var raw = readRawLocalAuthUser();
  var trialSource =
    raw && normalizeEmail(raw.email) === normalizeEmail(localAuth.email) ? raw : localAuth;
  var directMs = parseTrialExpiresAtMs(trialSource.trialExpiresAt);
  if (directMs > 0) return directMs;
  var settings = null;
  if (
    window.PlatformSimulators &&
    typeof window.PlatformSimulators.getPlatformSettings === 'function'
  ) {
    settings = window.PlatformSimulators.getPlatformSettings();
  }
  if (window.IFAAuth && typeof window.IFAAuth.getTrialExpiryMs === 'function') {
    var fromAuth = window.IFAAuth.getTrialExpiryMs(
      Object.assign({}, localAuth, { trialExpiresAt: trialSource.trialExpiresAt }),
      settings
    );
    if (fromAuth > 0) return fromAuth;
  }
  return parseTrialExpiresAtMs(localAuth.trialExpiresAt);
}

function withTimeout(promise, ms, label) {
  var errLabel = label || 'operation timed out';
  return Promise.race([
    promise,
    new Promise(function (_resolve, reject) {
      setTimeout(function () {
        reject(new Error(errLabel));
      }, ms);
    }),
  ]);
}

function grantSimulatorAccess(simulatorId) {
  setGateVisible(false);
  if (
    window.PlatformSimulators &&
    typeof window.PlatformSimulators.armTrialExpiryWatch === 'function'
  ) {
    window.PlatformSimulators.armTrialExpiryWatch();
  }
}

function applyProfileToLocalSession(user, profile) {
  if (!user || !profile || !window.IFAAuth) return;
  var email = normalizeEmail(user.email || (profile && profile.email) || '');
  if (!email) return;
  var previous = getLocalAuthSnapshot();
  var payload = {
    name: (previous && previous.name) || user.displayName || profile.name || '',
    email: email,
    photoURL: user.photoURL || (previous && previous.photoURL) || profile.photo || '',
    isSubscriber: profile.isSubscriber === true || !!(previous && previous.isSubscriber),
    planId:
      profile.planId != null
        ? String(profile.planId)
        : previous && previous.planId
          ? String(previous.planId)
          : '',
    enrolledCourseIds: Array.isArray(profile.enrolledCourseIds) && profile.enrolledCourseIds.length
      ? profile.enrolledCourseIds.slice()
      : previous && Array.isArray(previous.enrolledCourseIds)
        ? previous.enrolledCourseIds.slice()
        : [],
    allowedSimulators:
      Array.isArray(profile.allowedSimulators) && profile.allowedSimulators.length
        ? profile.allowedSimulators.slice()
        : previous && Array.isArray(previous.allowedSimulators)
          ? previous.allowedSimulators.slice()
          : [],
    role: profile.role || (previous && previous.role) || 'user',
    isAdmin: profile.role === 'admin' || !!(previous && previous.isAdmin),
    isInstructor: profile.isInstructor === true || !!(previous && previous.isInstructor),
    trialExpiresAt:
      profile.trialExpiresAt != null && profile.trialExpiresAt !== ''
        ? profile.trialExpiresAt
        : previous && previous.trialExpiresAt != null && previous.trialExpiresAt !== ''
          ? previous.trialExpiresAt
          : 0,
  };
  if (typeof window.IFAAuth.setLocalAuthUser === 'function') {
    window.IFAAuth.setLocalAuthUser(payload, profile);
  } else if (typeof window.IFAAuth.applyEntitlements === 'function') {
    window.IFAAuth.applyEntitlements(
      {
        isSubscriber: payload.isSubscriber,
        planId: payload.planId,
        enrolledCourseIds: payload.enrolledCourseIds,
        allowedSimulators: payload.allowedSimulators,
      },
      email
    );
  }
}

function runBackgroundProfileSync(user) {
  if (!user || !user.uid) return;
  withTimeout(
    (async function () {
      await syncUserProfile(user);
      var profile = await fetchUserProfile(user.uid);
      applyProfileToLocalSession(user, profile);
      var localUser = getLocalAuthSnapshot();
      if (
        window.PlatformSimulators &&
        typeof window.PlatformSimulators.warmEntitlementCaches === 'function'
      ) {
        await window.PlatformSimulators.warmEntitlementCaches(localUser, null);
      }
    })(),
    FIRESTORE_ACCESS_TIMEOUT_MS,
    'background-profile-sync-timeout'
  ).catch(function (err) {
    console.warn('[SimulatorAccess] background profile sync failed:', err);
  });
}

function isOwnerFirebaseUser(user) {
  return !!(user && normalizeEmail(user.email) === normalizeEmail(OWNER_ACCOUNT_EMAIL));
}

function repairOwnerLocalCache(user) {
  if (!user || !window.IFAAuth || typeof window.IFAAuth.setLocalAuthUser !== 'function') return;
  var email = normalizeEmail(user.email);
  window.IFAAuth.setLocalAuthUser(
    {
      name: user.displayName || '',
      email: email,
      photoURL: user.photoURL || '',
      role: 'admin',
      isAdmin: true,
      isSubscriber: true,
      isInstructor: false,
    },
    { role: 'admin', email: email }
  );
}

function profileHasActiveTrial(profile) {
  if (!profile) return false;
  var expMs = parseTrialExpiresAtMs(profile.trialExpiresAt);
  return expMs > Date.now();
}

function profileIsFirestoreAdmin(profile) {
  return !!(profile && String(profile.role || '').toLowerCase() === 'admin');
}

function resolveGateAfterAccessError(user, simulatorId) {
  if (isOwnerFirebaseUser(user)) {
    repairOwnerLocalCache(user);
    grantSimulatorAccess(simulatorId);
    return;
  }
  if (!user) {
    setGateVisible(true, 'logged-out');
    return;
  }
  setGateVisible(true, 'simulator-locked');
}

function tryKickOutExpiredTrial(simulatorId, localUser) {
  if (!window.PlatformSimulators) return false;
  if (
    typeof window.PlatformSimulators.isTrialTierSimulator !== 'function' ||
    !window.PlatformSimulators.isTrialTierSimulator(simulatorId)
  ) {
    return false;
  }
  var expMs = localTrialExpiryMs(localUser);
  if (!(expMs > 0 && Date.now() >= expMs)) return false;
  if (typeof window.PlatformSimulators.kickOutTrialExpiredUser === 'function') {
    window.PlatformSimulators.kickOutTrialExpiredUser(simulatorId);
    return true;
  }
  return false;
}

async function evaluateAccess(user) {
  if (shouldBypassAccessControl()) {
    setGateVisible(false);
    return;
  }

  if (isOwnerFirebaseUser(user)) {
    setGateVisible(false);
    repairOwnerLocalCache(user);
    runBackgroundProfileSync(user);
    return;
  }

  if (!user) {
    setGateVisible(true, 'logged-out');
    return;
  }

  var simulatorId = currentSimulatorIdFromPage();
  if (!simulatorId) {
    console.error('[SimulatorAccess] Could not resolve simulator id for page:', window.location.pathname);
    setGateVisible(true, 'simulator-locked');
    return;
  }

  var accessSettled = false;

  try {
    if (
      window.PlatformSimulators &&
      typeof window.PlatformSimulators.viewerCanAccess === 'function' &&
      window.PlatformSimulators.viewerCanAccess(simulatorId)
    ) {
      grantSimulatorAccess(simulatorId);
      runBackgroundProfileSync(user);
      accessSettled = true;
      return;
    }

    setGateVisible(true, 'loading');

    var profile = null;
    try {
      await withTimeout(
        (async function () {
          await syncUserProfile(user);
          profile = await fetchUserProfile(user.uid);
        })(),
        FIRESTORE_ACCESS_TIMEOUT_MS,
        'profile-access-check-timeout'
      );
    } catch (err) {
      console.warn('[SimulatorAccess] profile sync skipped or timed out:', err);
      runBackgroundProfileSync(user);
    }

    if (profile && (profileIsFirestoreAdmin(profile) || profileHasActiveTrial(profile))) {
      applyProfileToLocalSession(user, profile);
      grantSimulatorAccess(simulatorId);
      accessSettled = true;
      return;
    }

    if (profile) {
      applyProfileToLocalSession(user, profile);
    }

    var localUser = getLocalAuthSnapshot();
    try {
      if (
        window.PlatformSimulators &&
        typeof window.PlatformSimulators.warmEntitlementCaches === 'function'
      ) {
        await withTimeout(
          window.PlatformSimulators.warmEntitlementCaches(localUser, null),
          FIRESTORE_ACCESS_TIMEOUT_MS,
          'warm-entitlements-timeout'
        );
      }
    } catch (warmErr) {
      console.warn('[SimulatorAccess] warmEntitlementCaches skipped:', warmErr);
    }

    if (
      window.PlatformSimulators &&
      typeof window.PlatformSimulators.viewerCanAccess === 'function' &&
      window.PlatformSimulators.viewerCanAccess(simulatorId)
    ) {
      grantSimulatorAccess(simulatorId);
      accessSettled = true;
      return;
    }

    var enrolled =
      profile && Array.isArray(profile.enrolledCourseIds)
        ? profile.enrolledCourseIds.slice()
        : localUser && Array.isArray(localUser.enrolledCourseIds)
          ? localUser.enrolledCourseIds.slice()
          : [];
    var courseAllowed =
      window.PlatformSimulators &&
      typeof window.PlatformSimulators.simulatorsFromEnrolledCourseIds === 'function'
        ? window.PlatformSimulators.simulatorsFromEnrolledCourseIds(enrolled)
        : [];
    if (courseAllowed.indexOf(simulatorId) !== -1) {
      grantSimulatorAccess(simulatorId);
      accessSettled = true;
      return;
    }
    if (tryKickOutExpiredTrial(simulatorId, localUser)) {
      setGateVisible(true, 'simulator-locked');
      accessSettled = true;
      return;
    }
    console.error(
      '[SimulatorAccess] Access denied — simulator "' +
        simulatorId +
        '" not permitted for enrolled courses:',
      enrolled
    );
    setGateVisible(true, 'simulator-locked');
    accessSettled = true;
  } catch (err) {
    console.error('[SimulatorAccess] evaluateAccess failed:', err);
  } finally {
    if (!accessSettled) {
      resolveGateAfterAccessError(user, simulatorId);
    }
  }
}

function forceRemoveSubscriberGate() {
  var gate = document.getElementById('subscriber-gate');
  if (gate) gate.remove();
  document.body.classList.remove('subscriber-gate-active');
}

function localAuthTrialExpiresMs(localAuth) {
  if (!localAuth) return 0;
  var raw = readRawLocalAuthUser();
  if (raw && normalizeEmail(raw.email) === normalizeEmail(localAuth.email)) {
    var fromRaw = parseTrialExpiresAtMs(raw.trialExpiresAt);
    if (fromRaw > 0) return fromRaw;
  }
  return parseTrialExpiresAtMs(localAuth.trialExpiresAt);
}

function tryBruteForceGateBypassFromLocalAuth() {
  var localAuth = window.IFAAuth ? window.IFAAuth.getLocalAuthUser() : null;
  if (!localAuth) {
    localAuth = readRawLocalAuthUser();
  }
  if (!localAuth) return false;

  var simulatorId = currentSimulatorIdFromPage();

  if (normalizeEmail(localAuth.email) === normalizeEmail(OWNER_ACCOUNT_EMAIL)) {
    forceRemoveSubscriberGate();
    grantSimulatorAccess(simulatorId);
    document.documentElement.setAttribute('data-ifa-access', 'brute-force-owner-grant');
    return true;
  }

  if (localAuthTrialExpiresMs(localAuth) > Date.now()) {
    forceRemoveSubscriberGate();
    grantSimulatorAccess(simulatorId);
    document.documentElement.setAttribute('data-ifa-access', 'brute-force-trial-grant');
    return true;
  }

  return false;
}

function bindGateActions() {
  var gate = getGate();
  if (!gate || gate.dataset.bound === '1') return;
  gate.dataset.bound = '1';

  gate.addEventListener('click', function (e) {
    var loginBtn = e.target.closest('[data-subscriber-login]');
    if (loginBtn) {
      e.preventDefault();
      loginWithGoogle();
      return;
    }
    var homeBtn = e.target.closest('[data-subscriber-home]');
    if (homeBtn) {
      e.preventDefault();
      window.location.href = 'index.html';
    }
  });
}

function initSimulatorAccess() {
  bindGateActions();

  if (shouldBypassAccessControl()) {
    setGateVisible(false);
    document.documentElement.setAttribute('data-ifa-access', 'local-bypass');
    return;
  }

  if (tryBruteForceGateBypassFromLocalAuth()) {
    return;
  }

  document.documentElement.setAttribute('data-ifa-access', 'enforced');
  setGateVisible(true, 'loading');

  onAuthStateChanged(auth, function (user) {
    evaluateAccess(user);
  });
}

initSimulatorAccess();
