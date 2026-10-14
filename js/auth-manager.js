/**
 * Firebase Auth (Email/Password + Google) + header UI (ES module).
 * Mount points: elements with [data-auth-slot] in index.html / simulator pages.
 *
 * Guest: "تسجيل الدخول" button → auth modal (login / sign-up).
 * Authenticated: profile dropdown with email + "تسجيل خروج".
 * Local session mirror in localStorage (`ifa_auth_user`) for profile fields / route guards.
 */
import { auth, db, provider } from './firebase-config.js';
import {
  signInWithPopup,
  getRedirectResult,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { doc, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import {
  syncUserProfile,
  createUserProfileOnSignUp,
  checkAndRegisterDeviceTrial,
  setUserTrialExpiresAt,
  countRecentUsersWithIp,
} from './db-manager.js';
import {
  syncEntitlementsFromApprovedOrders,
  readCachedEntitlements,
  writeCachedEntitlements,
} from './entitlements-sync.js';
import { startFcmOnAuth, setupNotificationToggle } from './fcm-push.js';

/**
 * RBAC: admin access is granted only when Firestore users/{uid}.role === 'admin'.
 * See js/db-manager.js for first-time admin promotion steps in Firebase Console.
 */
console.info(
  '[IFA Auth] RBAC: promote your account in Firestore → users/{uid} → set role field to "admin"'
);
var LOCAL_AUTH_KEY = 'ifa_auth_user';
var LOCAL_DEV_EMAIL = 'abdulazizyassin909@gmail.com';
var OWNER_ACCOUNT_EMAIL = LOCAL_DEV_EMAIL;

function isOwnerAccountEmail(email) {
  return normalizeEmail(email) === normalizeEmail(OWNER_ACCOUNT_EMAIL);
}

function applyOwnerAdminSessionRole(email, role) {
  if (isOwnerAccountEmail(email)) return 'admin';
  return role;
}
var DEVICE_TRIAL_CONSUMED_KEY = 'ifa_device_trial_consumed';
var DEVICE_UUID_STORAGE_KEY = 'ifa_device_uuid';
var DEVICE_UUID_COOKIE = 'ifa_device_uuid';
var ADMIN_DEVICE_BYPASS_KEY = 'ifa_admin_bypass_device_check';
var DEVICE_TRIAL_COOKIE_MAX_AGE_SEC = 365 * 24 * 60 * 60;
var TRIAL_GRANT_ATTEMPTED_PREFIX = 'ifa_trial_grant_attempted:';
var DISPOSABLE_EMAIL_DOMAINS = [
  'mohmal.com',
  'mohmal.in',
  'mohmal.tech',
  'temp-mail.org',
  '10minutemail.com',
  '10minutemail.net',
  'guerrillamail.com',
  'mailinator.com',
  'yopmail.com',
  'throwaway.email',
  'tempmail.com',
  'fakeinbox.com',
  'getnada.com',
  'maildrop.cc',
  'sharklasers.com',
];

var slots = [];
var lastUser = null;
var lastProfile = null;
var refreshSlots = function () {};
var authChangeListeners = [];
var authModalMode = 'login';
var authModalBound = false;
var profileSynced = true;
var authInitialized = false;

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeEmail(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function getLocalAuthUser() {
  try {
    var raw = localStorage.getItem(LOCAL_AUTH_KEY);
    if (!raw) return null;
    var parsed = JSON.parse(raw);
    if (!parsed || !normalizeEmail(parsed.email)) return null;
    return {
      name: String(parsed.name || '').trim() || String(parsed.email).split('@')[0],
      email: normalizeEmail(parsed.email),
      photoURL: String(parsed.photoURL || ''),
      isSubscriber: !!parsed.isSubscriber,
      isAdmin: !!parsed.isAdmin,
      isInstructor: !!parsed.isInstructor,
      role: String(parsed.role || ''),
      planId: String(parsed.planId || ''),
      enrolledCourseIds: Array.isArray(parsed.enrolledCourseIds) ? parsed.enrolledCourseIds.slice() : [],
      allowedSimulators: Array.isArray(parsed.allowedSimulators) ? parsed.allowedSimulators.slice() : [],
      trialExpiresAt: Number(parsed.trialExpiresAt) || 0,
      createdAt: String(parsed.createdAt || ''),
      loggedInAt: String(parsed.loggedInAt || ''),
    };
  } catch (err) {
    return null;
  }
}

function resolveTrialPlatformSettings(settings) {
  if (settings && typeof settings === 'object') return settings;
  if (typeof window !== 'undefined' && window.PlatformSimulators && typeof window.PlatformSimulators.getPlatformSettings === 'function') {
    return window.PlatformSimulators.getPlatformSettings();
  }
  return readPlatformSettings();
}

function getTrialAccountCreatedAt(authUser) {
  if (!authUser) return null;
  var createdAt =
    authUser.metadata && authUser.metadata.creationTime
      ? new Date(authUser.metadata.creationTime)
      : authUser.createdAt
        ? new Date(authUser.createdAt)
        : authUser.loggedInAt
          ? new Date(authUser.loggedInAt)
          : new Date();
  if (isNaN(createdAt.getTime())) return null;
  return createdAt;
}

function getTrialExpiryMs(authUser, settings) {
  if (!authUser) return 0;
  var storedExp = trialMsFromFirestoreValue(authUser.trialExpiresAt);
  if (storedExp > 0) return storedExp;
  if (lastProfile) {
    return getTrialExpiryFromProfile(lastProfile, settings);
  }
  return 0;
}

function getRemainingTrialDays(authUser, settings) {
  if (!authUser) return 0;
  var expMs = getTrialExpiryMs(authUser, settings);
  if (expMs <= Date.now()) return 0;
  return Math.max(1, Math.ceil((expMs - Date.now()) / (1000 * 60 * 60 * 24)));
}

function resolveAuthUserForTrial() {
  var local = getLocalAuthUser();
  var firebaseUser = lastUser;
  if (!firebaseUser && !local) return null;
  if (!firebaseUser) return local;
  return Object.assign({}, local || {}, {
    email: firebaseUser.email || (local && local.email),
    metadata: firebaseUser.metadata,
    trialExpiresAt: local && local.trialExpiresAt ? local.trialExpiresAt : 0,
    createdAt: local && local.createdAt ? local.createdAt : '',
    loggedInAt: local && local.loggedInAt ? local.loggedInAt : '',
  });
}

function readPlatformSettings() {
  try {
    var raw = localStorage.getItem('ifa_platform_settings');
    if (!raw) return { freeSimulatorIds: [], freeTrialDays: 0 };
    var parsed = JSON.parse(raw);
    var days = parseFloat(parsed && parsed.freeTrialDays);
    return {
      freeSimulatorIds: Array.isArray(parsed && parsed.freeSimulatorIds) ? parsed.freeSimulatorIds : [],
      freeTrialDays: isFinite(days) && days > 0 ? Math.min(365, days) : 0,
    };
  } catch (err) {
    return { freeSimulatorIds: [], freeTrialDays: 0 };
  }
}

function trialExpiryMs(value) {
  return trialMsFromFirestoreValue(value);
}

function trialMsFromFirestoreValue(value) {
  if (value == null || value === '') return 0;
  try {
    if (value && typeof value.toDate === 'function') {
      var d = value.toDate();
      return d && !isNaN(d.getTime()) ? d.getTime() : 0;
    }
    if (typeof value === 'number' && isFinite(value)) return value;
    if (typeof value === 'string') {
      var parsed = Date.parse(value);
      return isFinite(parsed) ? parsed : 0;
    }
  } catch (err) {
    /* ignore */
  }
  return 0;
}

function getFreeTrialDaysFromSettings(settings) {
  settings = settings || readPlatformSettings();
  var days = Number(settings && settings.freeTrialDays);
  if (isFinite(days) && days > 0) return Math.min(365, days);
  return 7;
}

/** Active trial end (ms) from Firestore profile: trialExpiresAt, else createdAt + freeTrialDays. */
function getTrialExpiryFromProfile(profile, settings) {
  if (!profile) return 0;
  if (Object.prototype.hasOwnProperty.call(profile, 'trialExpiresAt')) {
    var rawTrial = profile.trialExpiresAt;
    if (rawTrial != null && rawTrial !== '') {
      var explicitMs = trialMsFromFirestoreValue(rawTrial);
      if (explicitMs > 0) return explicitMs;
      return 0;
    }
  }
  var created = trialMsFromFirestoreValue(profile.createdAt);
  if (!created) return 0;
  var days = getFreeTrialDaysFromSettings(settings);
  return created + days * 24 * 60 * 60 * 1000;
}

/** Prefer Firestore profile trial; fall back to entitlements sync snapshot (never clears trial). */
function resolveSessionTrialExpiresAt(profile, orderEntitlements) {
  var fromProfile = getTrialExpiryFromProfile(profile);
  if (fromProfile > 0) return fromProfile;
  if (
    orderEntitlements &&
    typeof orderEntitlements.trialExpiresAtMs === 'number' &&
    orderEntitlements.trialExpiresAtMs > 0
  ) {
    return orderEntitlements.trialExpiresAtMs;
  }
  if (orderEntitlements && orderEntitlements.trialExpiresAt != null) {
    var fromEntitlements = trialMsFromFirestoreValue(orderEntitlements.trialExpiresAt);
    if (fromEntitlements > 0) return fromEntitlements;
  }
  return trialMsFromFirestoreValue(profile && profile.trialExpiresAt);
}

function firestoreCreatedAtToIso(value) {
  var ms = trialMsFromFirestoreValue(value);
  if (ms > 0) return new Date(ms).toISOString();
  if (value == null || value === '') return '';
  return String(value);
}

function unwrapProfileSyncResult(syncResult) {
  if (!syncResult) return { profile: null, isNew: false };
  if (syncResult.profile != null && typeof syncResult.isNew === 'boolean') {
    return { profile: syncResult.profile, isNew: syncResult.isNew };
  }
  return { profile: syncResult, isNew: false };
}

function readDocumentCookie(name) {
  if (typeof document === 'undefined' || !name) return '';
  try {
    var escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var match = document.cookie.match(new RegExp('(?:^|;\\s*)' + escaped + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : '';
  } catch (err) {
    return '';
  }
}

function isLocalDevEnvironment() {
  if (typeof window !== 'undefined' && window.IFA_ENV && typeof window.IFA_ENV.isLocalDevEnvironment === 'function') {
    return window.IFA_ENV.isLocalDevEnvironment();
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

function shouldBypassAccessControl() {
  if (typeof window !== 'undefined' && window.IFA_ENV && typeof window.IFA_ENV.shouldBypassAccessControl === 'function') {
    return window.IFA_ENV.shouldBypassAccessControl();
  }
  return isLocalDevEnvironment();
}

function shouldSkipTrialAbuseChecks() {
  if (shouldBypassAccessControl()) return true;
  try {
    return localStorage.getItem(ADMIN_DEVICE_BYPASS_KEY) === '1';
  } catch (err) {
    return false;
  }
}

var ALLOWED_SIGNUP_EMAIL_DOMAINS = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com'];

function emailDomain(email) {
  var normalized = normalizeEmail(email);
  var at = normalized.lastIndexOf('@');
  return at === -1 ? '' : normalized.slice(at + 1);
}

function isWhitelistedSignupEmailDomain(email) {
  var domain = emailDomain(email);
  if (!domain) return false;
  return ALLOWED_SIGNUP_EMAIL_DOMAINS.indexOf(domain) !== -1;
}

async function fetchCurrentClientIp() {
  try {
    var response = await fetch('https://api.ipify.org?format=json');
    if (!response.ok) return 'unknown';
    var data = await response.json();
    return data && data.ip ? String(data.ip) : 'unknown';
  } catch (err) {
    return 'unknown';
  }
}

function resolveIpForTrialCheck(profile, fetchedIp) {
  var fromProfile = profile && profile.ipAddress ? String(profile.ipAddress).trim() : '';
  if (fromProfile && fromProfile !== 'unknown') return fromProfile;
  return fetchedIp || 'unknown';
}

function isIpTrialRateLimited(recentCount) {
  return recentCount >= 2;
}

function isDisposableEmail(email) {
  var domain = emailDomain(email);
  if (!domain) return false;
  return DISPOSABLE_EMAIL_DOMAINS.indexOf(domain) !== -1;
}

function simpleFingerprintHash(str) {
  var h = 0;
  var s = String(str || '');
  for (var i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return 'fp_' + (h >>> 0).toString(16);
}

function generateDeviceUuid() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
  } catch (err) {
    /* ignore */
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = (Math.random() * 16) | 0;
    var v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function persistDeviceUuid(uuid) {
  if (!uuid) return;
  try {
    localStorage.setItem(DEVICE_UUID_STORAGE_KEY, uuid);
  } catch (err) {
    /* ignore */
  }
  try {
    localStorage.setItem('device_uuid', uuid);
  } catch (err2) {
    /* ignore */
  }
  if (typeof document === 'undefined') return;
  try {
    var secure = typeof location !== 'undefined' && location.protocol === 'https:';
    var cookie =
      DEVICE_UUID_COOKIE +
      '=' +
      encodeURIComponent(uuid) +
      '; path=/; max-age=' +
      DEVICE_TRIAL_COOKIE_MAX_AGE_SEC +
      '; SameSite=Lax';
    if (secure) cookie += '; Secure';
    document.cookie = cookie;
    document.cookie =
      'device_uuid=' +
      encodeURIComponent(uuid) +
      '; path=/; max-age=' +
      DEVICE_TRIAL_COOKIE_MAX_AGE_SEC +
      '; SameSite=Lax' +
      (secure ? '; Secure' : '');
  } catch (err3) {
    /* ignore */
  }
}

/** Primary anti-abuse key: stable per-browser UUID in localStorage + cookie. */
function getOrCreateDeviceUuid() {
  var fromCookie = readDocumentCookie(DEVICE_UUID_COOKIE) || readDocumentCookie('device_uuid');
  var fromStorage = '';
  try {
    fromStorage = localStorage.getItem(DEVICE_UUID_STORAGE_KEY) || localStorage.getItem('device_uuid') || '';
  } catch (err) {
    /* ignore */
  }
  var uuid = String(fromCookie || fromStorage || '').trim();
  if (uuid) {
    persistDeviceUuid(uuid);
    return uuid;
  }
  uuid = generateDeviceUuid();
  persistDeviceUuid(uuid);
  return uuid;
}

function getCanvasFingerprintComponent() {
  if (typeof document === 'undefined') return '';
  try {
    var canvas = document.createElement('canvas');
    canvas.width = 280;
    canvas.height = 60;
    var ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.textBaseline = 'top';
    ctx.font = '16px Arial';
    ctx.fillStyle = '#f60';
    ctx.fillRect(0, 0, 280, 60);
    ctx.fillStyle = '#069';
    ctx.fillText('IFA trial fingerprint', 2, 15);
    ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
    ctx.fillText('IFA trial fingerprint', 4, 17);
    return simpleFingerprintHash(canvas.toDataURL());
  } catch (err) {
    return '';
  }
}

/** Secondary fallback: canvas + UA + screen + timezone (reduces mobile false positives vs canvas alone). */
function getCompositeDeviceFingerprint() {
  var tz = '';
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch (err) {
    /* ignore */
  }
  var ua = typeof navigator !== 'undefined' ? String(navigator.userAgent || '') : '';
  var screenPx =
    typeof screen !== 'undefined'
      ? String(screen.width) + 'x' + String(screen.height) + 'x' + String(screen.colorDepth || 0)
      : '';
  return simpleFingerprintHash(
    [getCanvasFingerprintComponent(), ua, screenPx, tz].join('\u0001')
  );
}

function buildTrialProfileOptionsSync(ipAddress) {
  var days = readPlatformSettings().freeTrialDays;
  var durationMs = days > 0 ? days * 24 * 60 * 60 * 1000 : 0;
  return {
    deviceUuid: getOrCreateDeviceUuid(),
    skipTrialAbuseChecks: shouldSkipTrialAbuseChecks(),
    trialDurationMs: durationMs,
    ipAddress: ipAddress || 'unknown',
  };
}

async function buildTrialProfileOptionsForSignUp() {
  var ip = await fetchCurrentClientIp();
  return buildTrialProfileOptionsSync(ip);
}

function registerTrialForDevice(user) {
  if (!user || !user.uid) return Promise.resolve(false);
  if (shouldSkipTrialAbuseChecks()) return Promise.resolve(true);

  var uuid = getOrCreateDeviceUuid();
  var uuidKey = 'uuid_' + uuid;

  return checkAndRegisterDeviceTrial(uuidKey, user.uid)
    .then(function (allowedByUuid) {
      if (allowedByUuid) return true;
      return false;
    })
    .catch(function (err) {
      console.warn('[Auth] UUID trial registration failed, trying composite fallback:', err);
      var composite = getCompositeDeviceFingerprint();
      if (!composite) return false;
      return checkAndRegisterDeviceTrial('fp2_' + composite, user.uid);
    });
}

function emailHadPriorTrialSnapshot(email) {
  try {
    var usersRaw = localStorage.getItem('ifa_admin_users');
    var users = usersRaw ? JSON.parse(usersRaw) : [];
    if (!Array.isArray(users)) return false;
    for (var i = 0; i < users.length; i++) {
      if (normalizeEmail(users[i] && users[i].email) !== normalizeEmail(email)) continue;
      if (trialExpiryMs(users[i].trialExpiresAt) > 0) return true;
    }
  } catch (err) {
    /* ignore */
  }
  return false;
}

function hasAttemptedAsyncTrialGrant(uid) {
  if (!uid) return false;
  try {
    return sessionStorage.getItem(TRIAL_GRANT_ATTEMPTED_PREFIX + uid) === '1';
  } catch (err) {
    return false;
  }
}

function markAsyncTrialGrantAttempted(uid) {
  if (!uid) return;
  try {
    sessionStorage.setItem(TRIAL_GRANT_ATTEMPTED_PREFIX + uid, '1');
  } catch (err) {
    /* ignore */
  }
}

function computeNewTrialExpiresAt() {
  var days = readPlatformSettings().freeTrialDays;
  if (!(days > 0)) return 0;
  return Date.now() + days * 24 * 60 * 60 * 1000;
}

function applyGrantedTrialToSession(email, expiresAt, options) {
  if (!expiresAt) return;
  options = options || {};
  var current = getLocalAuthUser();
  if (!current || normalizeEmail(current.email) !== normalizeEmail(email)) return;
  setLocalAuthUser(
    Object.assign({}, current, {
      trialExpiresAt: expiresAt,
    }),
    lastProfile
  );
  if (options.markDeviceConsumed !== false) {
    markDeviceTrialConsumed();
  }
  try {
    notifyLocalAuthChanged({ type: 'profile-sync', email: normalizeEmail(email) });
  } catch (err) {
    /* ignore */
  }
  if (typeof refreshGlobalTopBanner === 'function') {
    refreshGlobalTopBanner();
  }
}

function maybeGrantTrialForUser(user, profile, options) {
  if (!user || !user.uid) return Promise.resolve();
  options = options || {};
  var isNewProfile = options.isNewProfile === true;

  var email = normalizeEmail(user.email || '');
  if (!email) return Promise.resolve();

  if (!isNewProfile) {
    var existingProfileTrialMs = getTrialExpiryFromProfile(profile);
    if (existingProfileTrialMs > 0) {
      applyGrantedTrialToSession(email, existingProfileTrialMs, { markDeviceConsumed: false });
    }
    markAsyncTrialGrantAttempted(user.uid);
    return Promise.resolve();
  }

  if (shouldSkipTrialAbuseChecks()) return Promise.resolve();

  if (isDisposableEmail(email)) return Promise.resolve();
  if (emailHadPriorTrialSnapshot(email)) return Promise.resolve();

  var days = readPlatformSettings().freeTrialDays;
  if (!(days > 0)) return Promise.resolve();

  var profileTrialMs = getTrialExpiryFromProfile(profile);
  if (profileTrialMs > Date.now()) {
    console.log('Auth: Existing user detected, fetching Firestore data...');
    if (trialMsFromFirestoreValue(profile && profile.trialExpiresAt) > 0) {
      console.log('Auth: Trial Active based on Firestore trialExpiresAt.');
    } else {
      console.log('Auth: Trial Active based on Firestore createdAt.');
    }
    console.log('Auth: Bypassing device fingerprint for existing valid account.');
    applyGrantedTrialToSession(email, profileTrialMs, { markDeviceConsumed: false });
    markAsyncTrialGrantAttempted(user.uid);
    return Promise.resolve();
  }

  var local = getLocalAuthUser();
  if (getTrialExpiryMs(local) > Date.now()) return Promise.resolve();

  return fetchCurrentClientIp()
    .then(function (fetchedIp) {
      var ipToCheck = resolveIpForTrialCheck(profile, fetchedIp);
      return countRecentUsersWithIp(ipToCheck, 7, user.uid).then(function (recentOnIp) {
        if (isIpTrialRateLimited(recentOnIp)) {
          console.warn('Free trial denied: IP rate limit exceeded for this network.');
          markAsyncTrialGrantAttempted(user.uid);
          return setUserTrialExpiresAt(user.uid, 0);
        }
        return registerTrialForDevice(user).then(function (allowed) {
          markAsyncTrialGrantAttempted(user.uid);
          if (!allowed) return;
          var expiresAt = computeNewTrialExpiresAt();
          if (!expiresAt) return;
          applyGrantedTrialToSession(email, expiresAt);
          return setUserTrialExpiresAt(user.uid, expiresAt);
        });
      });
    })
    .catch(function (err) {
      console.error('[Auth] maybeGrantTrialForUser failed:', err);
      markAsyncTrialGrantAttempted(user.uid);
    });
}

function markDeviceTrialConsumed() {
  try {
    localStorage.setItem(DEVICE_TRIAL_CONSUMED_KEY, '1');
  } catch (err) {
    /* ignore */
  }
  if (typeof document === 'undefined') return;
  try {
    var secure = typeof location !== 'undefined' && location.protocol === 'https:';
    var cookie =
      DEVICE_TRIAL_CONSUMED_KEY +
      '=1; path=/; max-age=' +
      DEVICE_TRIAL_COOKIE_MAX_AGE_SEC +
      '; SameSite=Lax';
    if (secure) cookie += '; Secure';
    document.cookie = cookie;
  } catch (err2) {
    /* ignore */
  }
}

function hasActiveTrial(user, settings) {
  return getTrialExpiryMs(user, settings) > Date.now();
}

function resolveTrialExpiresAt(email, incoming, firestoreProfile) {
  var previous = getLocalAuthUser();
  var sameEmail = previous && normalizeEmail(previous.email) === normalizeEmail(email);

  if (firestoreProfile) {
    return getTrialExpiryFromProfile(firestoreProfile);
  }

  var incomingMs = trialMsFromFirestoreValue(incoming);
  if (incomingMs > 0) return incomingMs;

  if (sameEmail && trialMsFromFirestoreValue(previous.trialExpiresAt) > Date.now()) {
    return trialMsFromFirestoreValue(previous.trialExpiresAt);
  }

  try {
    var usersRaw = localStorage.getItem('ifa_admin_users');
    var users = usersRaw ? JSON.parse(usersRaw) : [];
    if (Array.isArray(users)) {
      for (var i = 0; i < users.length; i++) {
        if (normalizeEmail(users[i] && users[i].email) === normalizeEmail(email)) {
          var fromDir = trialMsFromFirestoreValue(users[i].trialExpiresAt);
          if (fromDir) return fromDir;
          break;
        }
      }
    }
  } catch (err) {
    /* ignore */
  }

  var days = readPlatformSettings().freeTrialDays;
  if (days <= 0) return 0;
  if (!shouldSkipTrialAbuseChecks() && isDisposableEmail(email)) return 0;
  if (shouldSkipTrialAbuseChecks()) {
    var bypassExpiresAt = Date.now() + days * 24 * 60 * 60 * 1000;
    markDeviceTrialConsumed();
    return bypassExpiresAt;
  }
  return 0;
}

function persistDirectoryTrial(email, trialExpiresAt) {
  var key = normalizeEmail(email);
  if (!key || !trialExpiresAt) return;
  try {
    var raw = localStorage.getItem('ifa_admin_users');
    var list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return;
    var changed = false;
    list = list.map(function (u) {
      if (normalizeEmail(u && u.email) !== key) return u;
      if (trialExpiryMs(u.trialExpiresAt)) return u;
      changed = true;
      return Object.assign({}, u, { trialExpiresAt: trialExpiresAt });
    });
    if (changed) localStorage.setItem('ifa_admin_users', JSON.stringify(list));
  } catch (err) {
    /* ignore */
  }
}

function setLocalAuthUser(user, firestoreProfile) {
  if (!user || !normalizeEmail(user.email)) return;
  var previous = getLocalAuthUser();
  var sameEmail = previous && normalizeEmail(previous.email) === normalizeEmail(user.email);
  var trialFromProfile = firestoreProfile ? getTrialExpiryFromProfile(firestoreProfile) : 0;
  var incomingTrial =
    user.trialExpiresAt != null && user.trialExpiresAt !== ''
      ? user.trialExpiresAt
      : trialFromProfile > 0
        ? trialFromProfile
        : undefined;
  var trialExpiresAt = resolveTrialExpiresAt(user.email, incomingTrial, firestoreProfile);
  var profileCreatedIso = firestoreProfile
    ? firestoreCreatedAtToIso(firestoreProfile.createdAt)
    : '';
  var sessionRole = applyOwnerAdminSessionRole(user.email, String(user.role || ''));
  var sessionIsAdmin = sessionRole === 'admin' ? true : !!user.isAdmin;
  var payload = {
    name: String(user.name || user.displayName || '').trim() || normalizeEmail(user.email).split('@')[0],
    email: normalizeEmail(user.email),
    photoURL: String(user.photoURL || ''),
    isSubscriber: !!user.isSubscriber,
    isAdmin: sessionIsAdmin,
    isInstructor: !!user.isInstructor,
    role: sessionRole,
    planId: user.planId != null ? String(user.planId) : sameEmail ? String(previous.planId || '') : '',
    enrolledCourseIds:
      Array.isArray(user.enrolledCourseIds)
        ? user.enrolledCourseIds.slice()
        : sameEmail && Array.isArray(previous.enrolledCourseIds)
          ? previous.enrolledCourseIds.slice()
          : [],
    allowedSimulators:
      Array.isArray(user.allowedSimulators)
        ? normalizeAllowedSimulators(user.allowedSimulators)
        : sameEmail && Array.isArray(previous.allowedSimulators)
          ? normalizeAllowedSimulators(previous.allowedSimulators)
          : [],
    trialExpiresAt: trialExpiresAt,
    createdAt:
      profileCreatedIso ||
      (sameEmail && previous && previous.createdAt ? previous.createdAt : '') ||
      String(
        user.createdAt || (user.metadata && user.metadata.creationTime) || ''
      ),
    loggedInAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(LOCAL_AUTH_KEY, JSON.stringify(payload));
  } catch (err) {
    console.error('[Auth] local auth save failed', err);
  }
  persistDirectoryTrial(payload.email, payload.trialExpiresAt);
  if (window.InstructorApps && typeof window.InstructorApps.setSessionEmail === 'function') {
    window.InstructorApps.setSessionEmail(payload.email);
  }
  try {
    localStorage.setItem('ifa_session_email', payload.email);
  } catch (err2) {
    /* ignore */
  }
  return payload;
}

function normalizeEnrolledCourseIds(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(function (id) {
      return String(id || '').trim();
    })
    .filter(Boolean);
}

function normalizeAllowedSimulators(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(function (id) {
      return String(id || '').trim();
    })
    .filter(Boolean);
}

function profileToEntitlements(profile, user, previous) {
  var sameEmail =
    previous && normalizeEmail(previous.email) === normalizeEmail((profile && profile.email) || (user && user.email));
  return {
    isSubscriber: !!(profile && profile.isSubscriber),
    planId: profile && profile.planId != null
      ? String(profile.planId || '')
      : sameEmail && previous
        ? String(previous.planId || '')
        : '',
    enrolledCourseIds:
      profile && Array.isArray(profile.enrolledCourseIds)
        ? normalizeEnrolledCourseIds(profile.enrolledCourseIds)
        : sameEmail && previous
          ? normalizeEnrolledCourseIds(previous.enrolledCourseIds)
          : [],
    allowedSimulators:
      profile && Array.isArray(profile.allowedSimulators)
        ? normalizeAllowedSimulators(profile.allowedSimulators)
        : sameEmail && previous
          ? normalizeAllowedSimulators(previous.allowedSimulators)
          : [],
  };
}

/** Apply Firestore entitlements to ifa_auth_user and refresh simulator gates. */
function applyEntitlements(entitlements, email) {
  var current = getLocalAuthUser();
  var key = normalizeEmail(email || (current && current.email));
  if (!key) return null;
  var payload = Object.assign({}, current || {}, entitlements || {}, { email: key });
  setLocalAuthUser(payload);
  refreshSlots();
  try {
    var evt = new CustomEvent('ifa:subscription-changed', {
      detail: {
        planId: payload.planId,
        enrolledCourseIds: payload.enrolledCourseIds,
        allowedSimulators: payload.allowedSimulators,
        isSubscriber: payload.isSubscriber,
        email: key,
      },
    });
    window.dispatchEvent(evt);
    document.dispatchEvent(evt);
  } catch (err) {
    /* ignore */
  }
  return payload;
}

function clearTrialGrantAttemptedFlags() {
  try {
    var toRemove = [];
    for (var i = 0; i < sessionStorage.length; i++) {
      var key = sessionStorage.key(i);
      if (key && key.indexOf(TRIAL_GRANT_ATTEMPTED_PREFIX) === 0) {
        toRemove.push(key);
      }
    }
    toRemove.forEach(function (key) {
      sessionStorage.removeItem(key);
    });
  } catch (err) {
    /* ignore */
  }
}

function clearLocalAuthUser() {
  try {
    localStorage.removeItem(LOCAL_AUTH_KEY);
  } catch (err) {
    /* ignore */
  }
  try {
    localStorage.removeItem('ifa_session_email');
  } catch (err2) {
    /* ignore */
  }
  clearTrialGrantAttemptedFlags();
}

function notifyLocalAuthChanged(detail) {
  try {
    window.dispatchEvent(new CustomEvent('ifa:local-auth-changed', { detail: detail || {} }));
  } catch (err) {
    /* ignore */
  }
  refreshGlobalTopBanner();
}

function startPlatformNotifications(user, profile) {
  if (!user || !user.uid) return;
  if (window.PlatformNotifications && typeof window.PlatformNotifications.start === 'function') {
    window.PlatformNotifications.start(user.uid, profile || lastProfile);
  }
}

function stopPlatformNotifications() {
  if (window.PlatformNotifications && typeof window.PlatformNotifications.stop === 'function') {
    window.PlatformNotifications.stop();
  }
}

function notifyAuthChange(user, meta) {
  meta = meta || {};
  var identity = resolveActiveIdentity();
  var payload = {
    user: user || identity.user || null,
    profile: identity.profile || null,
    isLoggedIn: !!(user || identity.user),
    email: user && user.email ? normalizeEmail(user.email) : identity.user && identity.user.email,
    profileSynced: meta.profileSynced !== undefined ? meta.profileSynced : profileSynced,
  };
  authChangeListeners.forEach(function (fn) {
    try {
      fn(payload);
    } catch (err) {
      console.error('[Auth] onAuthChange listener failed', err);
    }
  });
  try {
    window.dispatchEvent(new CustomEvent('ifa:auth-changed', { detail: payload }));
  } catch (err2) {
    /* ignore */
  }
}

function formatAuthError(err) {
  var code = err && err.code ? String(err.code) : '';
  if (code === 'auth/invalid-email') return 'البريد الإلكتروني غير صالح.';
  if (code === 'auth/user-disabled') return 'تم تعطيل هذا الحساب.';
  if (code === 'auth/user-not-found') return 'لا يوجد حساب بهذا البريد.';
  if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
    return 'البريد أو كلمة المرور غير صحيحة.';
  }
  if (code === 'auth/email-already-in-use') return 'هذا البريد مسجّل مسبقاً. جرّب تسجيل الدخول.';
  if (code === 'auth/weak-password') return 'كلمة المرور ضعيفة (6 أحرف على الأقل).';
  if (code === 'auth/too-many-requests') return 'محاولات كثيرة. انتظر قليلاً ثم أعد المحاولة.';
  if (code === 'auth/network-request-failed') return 'تعذّر الاتصال. تحقق من الشبكة.';
  if (code === 'auth/popup-blocked') {
    return 'تم حظر النافذة المنبثقة. اسمح بالنوافذ المنبثقة لهذا الموقع ثم أعد المحاولة.';
  }
  if (code === 'auth/missing-initial-state') {
    return 'تعذّر إكمال تسجيل الدخول. أعد المحاولة من نفس المتصفح (بدون وضع التصفح الخاص إن أمكن).';
  }
  if (code === 'auth/operation-not-allowed') return 'طريقة تسجيل الدخول غير مفعلة';
  if (code === 'auth/unauthorized-domain') return 'النطاق غير مصرح به في إعدادات فايبربيس';
  return (err && err.message) || 'حدث خطأ. حاول مرة أخرى.';
}

function setAuthModalError(message) {
  var el = document.getElementById('authModalError');
  if (!el) return;
  if (!message) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.hidden = false;
  el.textContent = message;
}

function authText(key, fallback) {
  if (window.PlatformI18n && typeof window.PlatformI18n.t === 'function') {
    return window.PlatformI18n.t(key);
  }
  return fallback;
}

function setAuthModalMode(mode) {
  authModalMode = mode === 'signup' ? 'signup' : 'login';
  var modal = document.getElementById('authModal');
  if (!modal) return;
  modal.setAttribute('data-auth-mode', authModalMode);
  var title = modal.querySelector('[data-auth-modal-title]');
  var submit = modal.querySelector('[data-auth-submit]');
  var switchLogin = modal.querySelector('[data-auth-switch-login]');
  var switchSignup = modal.querySelector('[data-auth-switch-signup]');
  var label = authModalMode === 'signup' ? authText('auth.signup', 'إنشاء حساب') : authText('auth.login', 'تسجيل الدخول');
  if (title) title.textContent = label;
  if (submit) submit.textContent = label;
  if (switchLogin) {
    switchLogin.hidden = authModalMode === 'login';
    switchLogin.textContent = authText('auth.switchLogin', 'لديك حساب؟ تسجيل الدخول');
  }
  if (switchSignup) {
    switchSignup.hidden = authModalMode === 'signup';
    switchSignup.textContent = authText('auth.switchSignup', 'ليس لديك حساب؟ إنشاء حساب');
  }
  var nameContainer = document.getElementById('authNameContainer');
  var nameInput = document.getElementById('authNameInput');
  if (nameContainer && nameInput) {
    if (authModalMode === 'signup') {
      nameContainer.style.display = '';
      nameInput.setAttribute('required', 'required');
      nameInput.setAttribute('autocomplete', 'name');
    } else {
      nameContainer.style.display = 'none';
      nameInput.removeAttribute('required');
      nameInput.value = '';
    }
  }
  setAuthModalError('');
}

function ensureAuthModal() {
  if (document.getElementById('authModal')) return;
  var wrap = document.createElement('div');
  wrap.className = 'auth-modal';
  wrap.id = 'authModal';
  wrap.hidden = true;
  wrap.setAttribute('data-auth-mode', 'login');
  wrap.innerHTML =
    '<div class="auth-modal__backdrop" data-auth-modal-close tabindex="-1" aria-hidden="true"></div>' +
    '<div class="auth-modal__panel" role="dialog" aria-modal="true" aria-labelledby="authModalTitle">' +
      '<button type="button" class="auth-modal__close" data-auth-modal-close aria-label="إغلاق">&times;</button>' +
      '<h2 class="auth-modal__title" id="authModalTitle" data-auth-modal-title>تسجيل الدخول</h2>' +
      '<p class="auth-modal__hint">استخدم بريدك وكلمة المرور للوصول إلى المحاكيات واللوحات.</p>' +
      '<p class="auth-modal__error" id="authModalError" role="alert" hidden></p>' +
      '<form class="auth-modal__form" id="authModalForm" novalidate>' +
        '<div id="authNameContainer" style="display:none">' +
        '<label class="auth-modal__field">' +
          '<span>الاسم الكامل</span>' +
          '<input type="text" id="authNameInput" name="name" data-auth-name autocomplete="name" />' +
        '</label>' +
        '</div>' +
        '<label class="auth-modal__field">' +
          '<span>البريد الإلكتروني</span>' +
          '<input type="email" name="email" data-auth-email autocomplete="email" dir="ltr" required />' +
        '</label>' +
        '<label class="auth-modal__field">' +
          '<span>كلمة المرور</span>' +
          '<input type="password" name="password" data-auth-password autocomplete="current-password" minlength="6" required />' +
        '</label>' +
        '<button type="submit" class="auth-modal__submit" data-auth-submit>تسجيل الدخول</button>' +
      '</form>' +
      '<div class="auth-modal__switch">' +
        '<button type="button" class="auth-modal__switch-btn" data-auth-switch-signup>ليس لديك حساب؟ إنشاء حساب</button>' +
        '<button type="button" class="auth-modal__switch-btn" data-auth-switch-login hidden>لديك حساب؟ تسجيل الدخول</button>' +
      '</div>' +
      '<div class="auth-modal__divider" role="separator"><span>أو</span></div>' +
      '<button type="button" class="auth-modal__google" data-auth-google>متابعة بحساب Google</button>' +
    '</div>';
  document.body.appendChild(wrap);

  if (!authModalBound) {
    authModalBound = true;
    wrap.addEventListener('click', function (e) {
      if (e.target && e.target.closest && e.target.closest('[data-auth-modal-close]')) {
        closeAuthModal();
      }
    });
    wrap.querySelector('[data-auth-switch-signup]').addEventListener('click', function () {
      setAuthModalMode('signup');
      var pwd = wrap.querySelector('[data-auth-password]');
      if (pwd) pwd.setAttribute('autocomplete', 'new-password');
    });
    wrap.querySelector('[data-auth-switch-login]').addEventListener('click', function () {
      setAuthModalMode('login');
      var pwd = wrap.querySelector('[data-auth-password]');
      if (pwd) pwd.setAttribute('autocomplete', 'current-password');
    });
    wrap.querySelector('[data-auth-google]').addEventListener('click', function () {
      loginWithGoogle();
    });
    wrap.querySelector('#authModalForm').addEventListener('submit', function (e) {
      e.preventDefault();
      handleAuthModalSubmit();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && wrap && !wrap.hidden) closeAuthModal();
    });
  }
}

function openAuthModal(mode) {
  ensureAuthModal();
  setAuthModalMode(mode || 'login');
  var modal = document.getElementById('authModal');
  var emailInput = modal && modal.querySelector('[data-auth-email]');
  if (modal) {
    modal.hidden = false;
    document.body.classList.add('auth-modal-open');
  }
  if (emailInput) {
    window.setTimeout(function () {
      emailInput.focus();
    }, 0);
  }
}

function closeAuthModal() {
  var modal = document.getElementById('authModal');
  if (!modal) return;
  modal.hidden = true;
  document.body.classList.remove('auth-modal-open');
  setAuthModalError('');
}

function closeUserMenuDropdown() {
  var menu = document.getElementById('userMenu');
  if (!menu) return;
  menu.classList.remove('open');
  var toggle = menu.querySelector('.user-menu__toggle');
  var drop = menu.querySelector('.user-menu__dropdown');
  if (toggle) toggle.setAttribute('aria-expanded', 'false');
  if (drop) drop.hidden = true;
}

function getFirstName(user) {
  var full = (user && (user.displayName || user.name || user.email)) || 'User';
  return String(full).trim().split(/\s+/)[0] || 'User';
}

function getFullName(user, profile) {
  if (profile && profile.name) return String(profile.name).trim();
  if (user && user.displayName) return String(user.displayName).trim();
  if (user && user.name) return String(user.name).trim();
  if (user && user.email) return String(user.email).trim();
  return 'مستخدم';
}

function getSubscriptionLabel(profile) {
  if (profile && profile.isSubscriber === true) return 'مشترك نشط';
  return 'غير مشترك';
}

function readLocalSessionEmail() {
  try {
    var local = getLocalAuthUser();
    if (local && local.email) return local.email;
    var Apps = typeof window !== 'undefined' ? window.InstructorApps : null;
    if (Apps && typeof Apps.getSessionEmail === 'function') {
      var fromApps = normalizeEmail(Apps.getSessionEmail());
      if (fromApps) return fromApps;
    }
    var keys = ['ifa_session_email', 'approvedInstructorEmail', 'ifa_user_email', 'currentUserEmail'];
    for (var i = 0; i < keys.length; i++) {
      var v = normalizeEmail(localStorage.getItem(keys[i]));
      if (v) return v;
    }
  } catch (err) {
    /* ignore */
  }
  return '';
}

function isProductionEnvironment() {
  if (typeof window !== 'undefined' && window.IFA_ENV && typeof window.IFA_ENV.isProductionEnvironment === 'function') {
    return window.IFA_ENV.isProductionEnvironment();
  }
  try {
    var host = String((window && window.location && window.location.hostname) || '').toLowerCase();
    return host === 'iraqi-fiber-academy.web.app' || host === 'iraqi-fiber-academy.firebaseapp.com';
  } catch (err) {
    return false;
  }
}

/** Local → always show Admin + Instructor; production → admin email allow-list only */
function shouldShowDashboardLinks(_email, profile) {
  if (shouldBypassAccessControl()) return true;
  return isAdminUser(profile);
}

/** Seed / upgrade a full-privilege local session for free local development. */
function ensureLocalDevSession() {
  if (!shouldBypassAccessControl()) return null;
  var existing = getLocalAuthUser();
  if (existing && String(existing.role || '').toLowerCase() === 'student') {
    return existing;
  }
  var email = (existing && existing.email) || LOCAL_DEV_EMAIL;
  return setLocalAuthUser({
    name: (existing && existing.name) || 'Local Dev',
    email: email,
    photoURL: (existing && existing.photoURL) || '',
    isSubscriber: true,
    isAdmin: true,
    isInstructor: true,
    role: 'admin',
    planId: existing && existing.planId,
    enrolledCourseIds: existing && existing.enrolledCourseIds,
    trialExpiresAt: existing && existing.trialExpiresAt,
  });
}

function isAdminUser(profile) {
  if (profile && isOwnerAccountEmail(profile.email)) return true;
  if (lastUser && isOwnerAccountEmail(lastUser.email)) return true;
  var local = getLocalAuthUser();
  if (local && isOwnerAccountEmail(local.email)) return true;
  return !!(profile && String(profile.role || '') === 'admin');
}

/** Show in-simulator CMS settings UI (الإعدادات) — admins only; does not gate read/sync listeners. */
function canShowSimulatorAdminSettingsUI() {
  var identity = resolveActiveIdentity();
  if (isAdminUser(identity.profile)) return true;
  if (shouldBypassAccessControl()) {
    var local = getLocalAuthUser();
    if (local && String(local.role || '').toLowerCase() === 'admin') return true;
  }
  return false;
}

function isInstructorUser(profile, email) {
  if (shouldBypassAccessControl()) return true;
  var Apps = typeof window !== 'undefined' ? window.InstructorApps : null;
  var checkEmail = normalizeEmail(
    email ||
      (profile && profile.email) ||
      (Apps && Apps.getSessionEmail ? Apps.getSessionEmail() : '') ||
      readLocalSessionEmail()
  );

  if (isAdminUser(profile)) return true;

  if (profile && (profile.isInstructor === true || String(profile.role || '').toLowerCase() === 'instructor')) {
    return true;
  }

  if (!Apps || !checkEmail) return false;

  if (typeof Apps.isApprovedInstructor === 'function' && Apps.isApprovedInstructor(checkEmail)) {
    return true;
  }

  if (
    typeof Apps.getInstructorApprovedFlag === 'function' &&
    Apps.getInstructorApprovedFlag() &&
    typeof Apps.getApprovedInstructorEmail === 'function'
  ) {
    return normalizeEmail(Apps.getApprovedInstructorEmail()) === checkEmail;
  }

  return false;
}

function resolveMenuEmail(user, profile) {
  if (user && user.email) return user.email;
  if (profile && profile.email) return profile.email;
  return readLocalSessionEmail();
}

function slotVariant(slot) {
  return (slot && slot.getAttribute('data-auth-variant')) || 'landing';
}

function avatarHtml(user, firstName) {
  var photo = user && user.photoURL ? escapeHtml(user.photoURL) : '';
  if (photo) {
    return (
      '<img class="user-menu__avatar" src="' +
      photo +
      '" alt="" width="28" height="28" referrerpolicy="no-referrer" />'
    );
  }
  return (
    '<span class="user-menu__avatar" aria-hidden="true">' +
    escapeHtml(firstName.charAt(0)) +
    '</span>'
  );
}

function simAvatarHtml(user, firstName) {
  var photo = user && user.photoURL ? escapeHtml(user.photoURL) : '';
  if (photo) {
    return (
      '<img class="auth-user__avatar" src="' +
      photo +
      '" alt="" width="28" height="28" referrerpolicy="no-referrer" />'
    );
  }
  return (
    '<span class="auth-user__avatar auth-user__avatar--fallback" aria-hidden="true">' +
    escapeHtml(firstName.charAt(0)) +
    '</span>'
  );
}

function accountToggleHtml(avatarInner) {
  return (
    '<button type="button" class="user-menu__toggle" id="userMenuToggle" ' +
      'aria-expanded="false" aria-haspopup="true" aria-controls="userMenuDropdown">' +
      avatarInner +
      '<span class="user-menu__label">الحساب</span>' +
      '<svg class="user-menu__chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" ' +
        'stroke="currentColor" stroke-width="2.5" aria-hidden="true">' +
        '<path d="M6 9l6 6 6-6"/>' +
      '</svg>' +
    '</button>'
  );
}

function guestMenuHtml() {
  return (
    '<div class="user-menu" id="userMenu" data-auth-guest="1">' +
      accountToggleHtml('<span class="user-menu__avatar" aria-hidden="true">?</span>') +
      '<div class="user-menu__dropdown" id="userMenuDropdown" role="menu" hidden>' +
        '<button type="button" class="user-menu__item user-menu__item--login" role="menuitem" data-auth-login>' +
          'تسجيل الدخول' +
        '</button>' +
      '</div>' +
    '</div>'
  );
}

function userMenuHtml(options) {
  var fullName = escapeHtml(options.fullName || 'مستخدم');
  var email = escapeHtml(options.email || '');
  var showDashboards = options.showDashboards === true;
  var avatar =
    options.avatarHtml ||
    '<span class="user-menu__avatar" aria-hidden="true">' +
      escapeHtml((options.fullName || 'م').charAt(0)) +
      '</span>';

  var instructor = isInstructorUser(options.profile, options.email);

  var menuClasses = 'user-menu';
  if (instructor) menuClasses += ' is-instructor';
  if (showDashboards) menuClasses += ' is-admin';
  if (shouldBypassAccessControl()) menuClasses += ' is-file-local is-local-dev';

  var instructorItem = instructor
    ? '<a href="instructor.html" id="instructor-dashboard" class="user-menu__item" role="menuitem" style="display: flex !important;">لوحة المدرب</a>'
    : '';

  var adminItem = showDashboards
    ? '<a href="admin.html" id="admin-dashboard" class="user-menu__item user-menu__item--admin" role="menuitem" data-admin-only>لوحة الإدارة</a>'
    : '';

  var joinItem = instructor
    ? ''
    : '<a href="#" class="user-menu__item user-menu__item--join" role="menuitem" data-join-instructor>' +
      'انضم إلينا كمدرب' +
      '</a>';

  var midItems = instructorItem + adminItem + joinItem;

  return (
    '<div class="' +
    menuClasses +
    '" id="userMenu">' +
    accountToggleHtml(avatar) +
    '<div class="user-menu__dropdown" id="userMenuDropdown" role="menu" hidden>' +
    '<div class="user-menu__info" role="none">' +
    '<span class="user-menu__info-name">' +
    fullName +
    '</span>' +
    (email ? '<span class="user-menu__info-email" dir="ltr">' + email + '</span>' : '') +
    '</div>' +
    '<div class="user-menu__divider" role="separator"></div>' +
    midItems +
    '<div class="user-menu__divider" role="separator"></div>' +
    '<a href="#" class="user-menu__item user-menu__item--logout" role="menuitem" data-auth-logout data-i18n="auth.logout">' +
    authText('auth.logout', 'تسجيل خروج') +
    '</a>' +
    '</div>' +
    '</div>'
  );
}

function loggedOutHtml(variant) {
  var btnClass = variant === 'simulator' ? 'auth-login-btn auth-login-btn--sim' : 'auth-login-btn';
  return (
    '<button type="button" class="' +
    btnClass +
    '" data-auth-login data-i18n="auth.login">' +
    authText('auth.login', 'تسجيل الدخول') +
    '</button>'
  );
}

function loggedInHtml(user, variant, profile) {
  var firstName = getFirstName(user);

  if (variant === 'simulator') {
    return (
      '<div class="auth-user auth-user--sim" role="group" aria-label="Account">' +
      simAvatarHtml(user, firstName) +
      '<span class="auth-user__name">' +
      escapeHtml(firstName) +
      '</span>' +
      '<button type="button" class="auth-logout-btn auth-logout-btn--sim" data-auth-logout data-i18n="auth.logoutSim">' +
      authText('auth.logoutSim', 'تسجيل الخروج') +
      '</button>' +
      '</div>'
    );
  }

  var email = resolveMenuEmail(user, profile);
  return userMenuHtml({
    fullName: getFullName(user, profile),
    email: email,
    profile: profile,
    avatarHtml: avatarHtml(user, firstName),
    showDashboards: shouldShowDashboardLinks(email, profile),
  });
}

function resolveActiveIdentity() {
  if (lastUser) {
    return { user: lastUser, profile: lastProfile || null, source: 'firebase' };
  }
  var local = getLocalAuthUser();
  if (local) {
    return {
      user: {
        displayName: local.name,
        name: local.name,
        email: local.email,
        photoURL: local.photoURL,
      },
      profile: {
        name: local.name,
        email: local.email,
        isSubscriber: local.isSubscriber,
        isAdmin: local.isAdmin,
        isInstructor: local.isInstructor,
        role: local.role,
        planId: local.planId || '',
        enrolledCourseIds: local.enrolledCourseIds || [],
      },
      source: 'local',
    };
  }
  return { user: null, profile: null, source: 'none' };
}

function renderAuthSlot(slot) {
  if (!slot) return;
  var variant = slotVariant(slot);
  var identity = resolveActiveIdentity();
  slot.innerHTML = identity.user
    ? loggedInHtml(identity.user, variant, identity.profile)
    : loggedOutHtml(variant);
  if (typeof window.applyRoleMenuVisibility === 'function') {
    try {
      window.applyRoleMenuVisibility();
    } catch (err) {
      /* ignore */
    }
  }
}

function openUserMenuDropdown() {
  var menu = document.getElementById('userMenu');
  if (!menu) return;
  var toggle = menu.querySelector('.user-menu__toggle');
  var drop = menu.querySelector('.user-menu__dropdown');
  menu.classList.add('open');
  if (toggle) toggle.setAttribute('aria-expanded', 'true');
  if (drop) drop.hidden = false;
}

function nameFromEmail(email) {
  var namePart = String(email || '')
    .split('@')[0]
    .replace(/[._]/g, ' ');
  return namePart
    .split(/\s+/)
    .filter(Boolean)
    .map(function (w) {
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}

/** Instant localStorage login used by the landing account menu. */
function loginLocalSession(options) {
  options = options || {};
  var localBypass = shouldBypassAccessControl();
  var defaultEmail = localBypass ? LOCAL_DEV_EMAIL : 'user@fiberacademy.iq';
  var email = normalizeEmail(options.email || readLocalSessionEmail() || defaultEmail);
  if (!email || email.indexOf('@') === -1) {
    email = defaultEmail;
  }
  var name = String(options.name || '').trim() || nameFromEmail(email) || (localBypass ? 'Local Dev' : 'مستخدم');
  var directoryUser = null;
  try {
    var usersRaw = localStorage.getItem('ifa_admin_users');
    var users = usersRaw ? JSON.parse(usersRaw) : [];
    if (Array.isArray(users)) {
      for (var i = 0; i < users.length; i++) {
        if (normalizeEmail(users[i] && users[i].email) === email) {
          directoryUser = users[i];
          break;
        }
      }
    }
  } catch (err) {
    directoryUser = null;
  }
  var directoryRole = String((directoryUser && directoryUser.role) || '').toLowerCase();
  var treatAsStudent = directoryRole === 'student';
  setLocalAuthUser({
    name: (directoryUser && directoryUser.name) || name,
    email: email,
    photoURL: options.photoURL || '',
    isSubscriber: treatAsStudent
      ? directoryUser.status !== 'expired' && directoryUser.status !== 'suspended'
      : localBypass
        ? true
        : !!options.isSubscriber,
    isAdmin: treatAsStudent ? false : localBypass ? true : options.isAdmin === true,
    isInstructor: treatAsStudent ? false : localBypass ? true : !!options.isInstructor,
    role: treatAsStudent ? 'student' : localBypass ? 'admin' : options.role || 'user',
    planId: (directoryUser && directoryUser.planId) || options.planId || '',
    enrolledCourseIds: (directoryUser && directoryUser.enrolledCourseIds) || options.enrolledCourseIds || [],
    trialExpiresAt: trialExpiryMs(directoryUser && directoryUser.trialExpiresAt) || options.trialExpiresAt,
  });
  refreshSlots();
  notifyLocalAuthChanged({ type: 'login', email: email });
  openUserMenuDropdown();
  return email;
}

function simulateLocalLogin() {
  var preset = readLocalSessionEmail() || 'user@fiberacademy.iq';
  var email = window.prompt('أدخل بريدك الإلكتروني لتسجيل الدخول:', preset);
  if (email == null) return;
  email = normalizeEmail(email);
  if (!email || email.indexOf('@') === -1) {
    alert('يرجى إدخال بريد إلكتروني صالح.');
    return;
  }
  loginLocalSession({ email: email });
}

export async function loginWithEmailPassword(email, password) {
  var key = normalizeEmail(email);
  if (!key || key.indexOf('@') === -1) {
    throw new Error('البريد الإلكتروني غير صالح.');
  }
  if (!password || String(password).length < 6) {
    throw new Error('كلمة المرور يجب أن تكون 6 أحرف على الأقل.');
  }
  var result = await signInWithEmailAndPassword(auth, key, String(password));
  closeAuthModal();
  return result.user;
}

export async function signUpWithEmailPassword(email, password, fullName) {
  var key = normalizeEmail(email);
  if (!key || key.indexOf('@') === -1) {
    throw new Error('البريد الإلكتروني غير صالح.');
  }
  if (!password || String(password).length < 6) {
    throw new Error('كلمة المرور يجب أن تكون 6 أحرف على الأقل.');
  }
  var name = String(fullName || '').trim();
  if (!name) {
    throw new Error('الاسم الكامل مطلوب.');
  }
  if (!isWhitelistedSignupEmailDomain(key)) {
    alert(
      'عذراً، لحماية المنصة يرجى التسجيل باستخدام بريد إلكتروني حقيقي من (Gmail, Yahoo, Outlook, Hotmail).'
    );
    return null;
  }
  var result = await createUserWithEmailAndPassword(auth, key, String(password));
  var profileOptions = await buildTrialProfileOptionsForSignUp();
  profileOptions.displayName = name;
  await createUserProfileOnSignUp(result.user, profileOptions);
  closeAuthModal();
  return result.user;
}

async function handleAuthModalSubmit() {
  var modal = document.getElementById('authModal');
  if (!modal) return;
  var emailInput = modal.querySelector('[data-auth-email]');
  var passwordInput = modal.querySelector('[data-auth-password]');
  var nameInput = modal.querySelector('[data-auth-name]');
  var submitBtn = modal.querySelector('[data-auth-submit]');
  var email = emailInput ? emailInput.value : '';
  var password = passwordInput ? passwordInput.value : '';
  var fullName = nameInput ? nameInput.value : '';
  setAuthModalError('');
  if (submitBtn) submitBtn.disabled = true;
  try {
    if (authModalMode === 'signup') {
      var signedUpUser = await signUpWithEmailPassword(email, password, fullName);
      if (!signedUpUser) return;
    } else {
      await loginWithEmailPassword(email, password);
    }
  } catch (err) {
    setAuthModalError(formatAuthError(err));
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

function isPopupCancellationError(err) {
  var code = err && err.code ? String(err.code) : '';
  return (
    code === 'auth/popup-closed-by-user' ||
    code === 'auth/cancelled-popup-request' ||
    code === 'auth/user-cancelled'
  );
}

export async function loginWithGoogle() {
  setAuthModalError('');
  try {
    await signInWithPopup(auth, provider);
    closeAuthModal();
  } catch (err) {
    if (isPopupCancellationError(err)) {
      return;
    }
    console.error('[Auth] Google login error:', err);
    setAuthModalError(formatAuthError(err));
  }
}

var userDocUnsub = null;

function stopUserDocListener() {
  if (typeof userDocUnsub === 'function') {
    userDocUnsub();
    userDocUnsub = null;
  }
}

function startUserDocListener(uid) {
  stopUserDocListener();
  if (!uid) return;
  userDocUnsub = onSnapshot(doc(db, 'users', uid), function (snap) {
    if (!snap.exists()) return;
    var data = snap.data() || {};
    if (data.isInstructor !== true) return;
    var local = getLocalAuthUser() || {};
    var nextRole = data.role === 'admin' ? 'admin' : 'instructor';
    if (!lastProfile || typeof lastProfile !== 'object') lastProfile = {};
    lastProfile.isInstructor = true;
    lastProfile.role = nextRole;
    setLocalAuthUser(
      Object.assign({}, local, {
        isInstructor: true,
        role: nextRole,
        email: local.email || data.email || '',
        name: local.name || data.name || '',
      })
    );
    refreshSlots();
  }, function (err) {
    console.warn('[Auth] user profile listener failed:', err);
  });
}

export async function logoutUser() {
  closeUserMenuDropdown();
  closeAuthModal();
  stopUserDocListener();
  stopPlatformNotifications();
  try {
    if (auth.currentUser) {
      await signOut(auth);
    }
  } catch (err) {
    console.error('[Auth] Sign-out failed:', err);
  }
  clearLocalAuthUser();
  lastUser = null;
  lastProfile = null;
  refreshSlots();
  notifyLocalAuthChanged({ type: 'logout' });
  notifyAuthChange(null, { profileSynced: true });
}

function bindAuthClicks() {
  document.addEventListener('click', function (e) {
    var loginEl = e.target && e.target.closest ? e.target.closest('[data-auth-login]') : null;
    if (loginEl) {
      e.preventDefault();
      e.stopPropagation();
      if (lastUser || getLocalAuthUser()) {
        refreshSlots();
        openUserMenuDropdown();
        return;
      }
      openAuthModal('login');
      return;
    }
    var logoutEl = e.target && e.target.closest ? e.target.closest('[data-auth-logout]') : null;
    if (logoutEl) {
      e.preventDefault();
      e.stopPropagation();
      logoutUser();
    }
  });
}

function isSimulatorAccessManagedPage() {
  return !!document.getElementById('subscriber-gate');
}

function scheduleEnforceSimulatorPageFromAuth() {
  if (shouldBypassAccessControl()) return;
  if (isSimulatorAccessManagedPage()) return;

  var runCheck = function () {
    enforceSimulatorPageFromAuth();
  };

  if (
    window.PlatformSimulators &&
    typeof window.PlatformSimulators.warmEntitlementCaches === 'function'
  ) {
    var localUser = getLocalAuthUser();
    window.PlatformSimulators.warmEntitlementCaches(localUser, null).then(runCheck).catch(runCheck);
    return;
  }
  runCheck();
}

function enforceSimulatorPageFromAuth() {
  if (shouldBypassAccessControl()) return;
  if (isSimulatorAccessManagedPage()) return;
  try {
    if (new URLSearchParams(window.location.search).get('mode') === 'admin-preview') return;
  } catch (err) {
    /* ignore */
  }
  if (window.PlatformSimulators && typeof window.PlatformSimulators.viewerCanAccess === 'function') {
    var match = null;
    if (typeof window.PlatformSimulators.currentSimulatorIdFromLocation === 'function') {
      match = window.PlatformSimulators.currentSimulatorIdFromLocation();
    }
    if (!match) return;
    if (window.PlatformSimulators.viewerCanAccess(match)) return;
    window.location.replace('index.html#plans');
  }
}

function dispatchSubscriptionChanged(user, orderEntitlements, email) {
  try {
    var subDetail = {
      userId: user.uid,
      planId: orderEntitlements.planId != null ? String(orderEntitlements.planId) : '',
      enrolledCourseIds: Array.isArray(orderEntitlements.enrolledCourseIds)
        ? normalizeEnrolledCourseIds(orderEntitlements.enrolledCourseIds)
        : [],
      allowedSimulators: Array.isArray(orderEntitlements.allowedSimulators)
        ? normalizeAllowedSimulators(orderEntitlements.allowedSimulators)
        : [],
      isSubscriber: !!orderEntitlements.isSubscriber,
      email: email,
    };
    window.dispatchEvent(new CustomEvent('ifa:subscription-changed', { detail: subDetail }));
    document.dispatchEvent(new CustomEvent('ifa:subscription-changed', { detail: subDetail }));
  } catch (evtErr) {
    /* ignore */
  }
}

function resolveSessionRoleFromProfileAndLocal(profile, user, email) {
  var firestoreRole = String((profile && profile.role) || 'user');
  var sessionEmail = normalizeEmail(email || (user && user.email) || '');
  var local = getLocalAuthUser();
  if (
    local &&
    sessionEmail &&
    normalizeEmail(local.email) === sessionEmail &&
    (isAdminUser({ role: local.role }) || local.isAdmin === true) &&
    !isAdminUser(profile)
  ) {
    return applyOwnerAdminSessionRole(sessionEmail, 'admin');
  }
  return applyOwnerAdminSessionRole(sessionEmail, firestoreRole);
}

function applySessionFromProfileAndEntitlements(user, profile, orderEntitlements, email, isNewProfile) {
  var sessionEmail = normalizeEmail(email || (user && user.email) || '');
  var role = applyOwnerAdminSessionRole(
    sessionEmail,
    resolveSessionRoleFromProfileAndLocal(profile, user, email)
  );
  var profileForSession =
    profile && typeof profile === 'object'
      ? Object.assign({}, profile, { role: role, email: sessionEmail || profile.email })
      : { role: role, email: sessionEmail };

  lastProfile = profileForSession;

  setLocalAuthUser(
    {
      name: (profile && profile.name) || user.displayName || '',
      email: (profile && profile.email) || user.email || '',
      photoURL: user.photoURL || (profile && profile.photo) || '',
      isSubscriber: !!orderEntitlements.isSubscriber,
      isAdmin: role === 'admin',
      isInstructor: !!(profile && profile.isInstructor),
      role: role,
      planId: orderEntitlements.planId != null ? String(orderEntitlements.planId) : '',
      enrolledCourseIds: Array.isArray(orderEntitlements.enrolledCourseIds)
        ? normalizeEnrolledCourseIds(orderEntitlements.enrolledCourseIds)
        : [],
      allowedSimulators: Array.isArray(orderEntitlements.allowedSimulators)
        ? normalizeAllowedSimulators(orderEntitlements.allowedSimulators)
        : [],
      trialExpiresAt: resolveSessionTrialExpiresAt(profile, orderEntitlements),
    },
    profileForSession
  );
  dispatchSubscriptionChanged(user, orderEntitlements, email);
  profileSynced = true;
  if (user && user.uid) startUserDocListener(user.uid);
  refreshSlots();
  startPlatformNotifications(user, profileForSession);
  notifyLocalAuthChanged({ type: 'profile-sync', email: email });
  notifyAuthChange(user, { profileSynced: true });
  return maybeGrantTrialForUser(user, profileForSession, { isNewProfile: isNewProfile });
}

function applyCachedEntitlementsToSession(user, cachedEntitlements, email) {
  if (!user || !cachedEntitlements) return false;
  var previous = getLocalAuthUser();
  var role = applyOwnerAdminSessionRole(
    email,
    previous && previous.role ? String(previous.role) : 'user'
  );
  setLocalAuthUser(
    {
      name: (previous && previous.name) || user.displayName || '',
      email: email,
      photoURL: user.photoURL || (previous && previous.photoURL) || '',
      isSubscriber: !!cachedEntitlements.isSubscriber,
      isAdmin: role === 'admin',
      isInstructor: !!(previous && previous.isInstructor),
      role: role,
      planId: cachedEntitlements.planId != null ? String(cachedEntitlements.planId) : '',
      enrolledCourseIds: Array.isArray(cachedEntitlements.enrolledCourseIds)
        ? normalizeEnrolledCourseIds(cachedEntitlements.enrolledCourseIds)
        : [],
      allowedSimulators: Array.isArray(cachedEntitlements.allowedSimulators)
        ? normalizeAllowedSimulators(cachedEntitlements.allowedSimulators)
        : [],
      trialExpiresAt:
        cachedEntitlements.trialExpiresAtMs > 0
          ? cachedEntitlements.trialExpiresAtMs
          : previous && previous.trialExpiresAt
            ? previous.trialExpiresAt
            : 0,
    },
    lastProfile
  );
  dispatchSubscriptionChanged(user, cachedEntitlements, email);
  profileSynced = true;
  refreshSlots();
  notifyLocalAuthChanged({ type: 'profile-sync', email: email });
  notifyAuthChange(user, { profileSynced: true });
  return true;
}

function runBackgroundProfileAndEntitlementsSync(user) {
  var email = normalizeEmail(user.email || '');
  var trialOptions = buildTrialProfileOptionsSync();

  syncUserProfile(user, trialOptions)
    .then(function (syncResult) {
      var unwrapped = unwrapProfileSyncResult(syncResult);
      var profile = unwrapped.profile;
      var isNewProfile = unwrapped.isNew;

      return syncEntitlementsFromApprovedOrders(user.uid)
        .then(function (orderEntitlements) {
          writeCachedEntitlements(user.uid, orderEntitlements);
          return applySessionFromProfileAndEntitlements(
            user,
            profile,
            orderEntitlements,
            email,
            isNewProfile
          );
        })
        .catch(function (syncErr) {
          console.error('[Auth] syncEntitlementsFromApprovedOrders failed:', syncErr);
          var previous = getLocalAuthUser();
          var entitlements = profileToEntitlements(profile, user, previous);
          applySessionFromProfileAndEntitlements(
            user,
            profile,
            {
              isSubscriber: entitlements.isSubscriber,
              planId: entitlements.planId,
              enrolledCourseIds: entitlements.enrolledCourseIds,
              allowedSimulators: entitlements.allowedSimulators,
              trialExpiresAtMs: resolveSessionTrialExpiresAt(profile, null),
            },
            email,
            isNewProfile
          );
        });
    })
    .catch(function (err) {
      profileSynced = true;
      console.error('[Auth] syncUserProfile failed:', err);
      var local = getLocalAuthUser();
      var localMatchesSession =
        local && normalizeEmail(local.email) === normalizeEmail(user.email || email);
      var fallbackRole = 'user';
      if (isOwnerAccountEmail(user.email || email)) {
        fallbackRole = 'admin';
      } else if (localMatchesSession) {
        if (isAdminUser({ role: local.role }) || local.isAdmin === true) {
          fallbackRole = 'admin';
        } else if (local.role) {
          fallbackRole = String(local.role);
        }
      }
      fallbackRole = applyOwnerAdminSessionRole(user.email || email, fallbackRole);
      lastProfile = {
        uid: user.uid,
        email: user.email || email,
        name: (localMatchesSession && local.name) || user.displayName || '',
        photo: user.photoURL || (localMatchesSession && local.photoURL) || '',
        photoURL: user.photoURL || (localMatchesSession && local.photoURL) || '',
        role: fallbackRole,
        isSubscriber: !!(localMatchesSession && local.isSubscriber),
      };
      refreshSlots();
      startPlatformNotifications(user, lastProfile);
      notifyLocalAuthChanged({ type: 'profile-sync', email: email });
      notifyAuthChange(user, { profileSynced: true });
    });
}

function completeGoogleRedirectSignIn() {
  getRedirectResult(auth)
    .then(function (result) {
      if (result && result.user) {
        closeAuthModal();
      }
    })
    .catch(function (err) {
      if (!err || !err.code) return;
      if (isPopupCancellationError(err)) return;
      setAuthModalError(formatAuthError(err));
      console.warn('[Auth] Google redirect result failed', err);
    });
}

function initAuthUI() {
  getOrCreateDeviceUuid();
  ensureAuthModal();
  completeGoogleRedirectSignIn();
  bindAuthClicks();
  slots = Array.prototype.slice.call(document.querySelectorAll('[data-auth-slot]'));

  refreshSlots = function () {
    if (window.InstructorApps && window.InstructorApps.absorbApprovalFromUrl) {
      window.InstructorApps.absorbApprovalFromUrl();
    }
    if (shouldBypassAccessControl()) {
      ensureLocalDevSession();
    }
    slots.forEach(function (slot) {
      renderAuthSlot(slot);
    });

    var footerLink = document.getElementById('footerInstructorLink');
    if (footerLink) {
      var profile = getLocalAuthUser();
      if (profile && isInstructorUser(profile)) {
        footerLink.textContent = 'لوحة المدرب';
        footerLink.href = 'instructor.html';
        footerLink.removeAttribute('data-join-instructor');
        footerLink.removeAttribute('data-i18n');
      } else {
        footerLink.textContent = 'انضم إلينا كمدرب';
        footerLink.href = '#';
        footerLink.setAttribute('data-join-instructor', '');
        footerLink.setAttribute('data-i18n', 'footer.joinInstructor');
      }
    }
  };

  if (shouldBypassAccessControl()) {
    ensureLocalDevSession();
  }

  refreshSlots();

  window.addEventListener('ifa:settings-lang-changed', function () {
    refreshSlots();
    setAuthModalMode(authModalMode);
    if (window.PlatformI18n && typeof window.PlatformI18n.apply === 'function') {
      window.PlatformI18n.apply();
    }
  });

  window.addEventListener('ifa:local-auth-changed', function (e) {
    var type = e && e.detail ? e.detail.type : '';
    if (type === 'profile-sync' || type === 'login') {
      scheduleEnforceSimulatorPageFromAuth();
    }
  });
  document.addEventListener('ifa:local-auth-changed', function (e) {
    var type = e && e.detail ? e.detail.type : '';
    if (type === 'profile-sync' || type === 'login') {
      scheduleEnforceSimulatorPageFromAuth();
    }
  });
  window.addEventListener('ifa:subscription-changed', scheduleEnforceSimulatorPageFromAuth);

  startFcmOnAuth(function () {
    return lastProfile;
  });

  function wireStudentPushToggle() {
    setupNotificationToggle('settingsPushNotificationsToggle');
    setupNotificationToggle('settingsPushNotificationsToggleDrawer');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireStudentPushToggle);
  } else {
    wireStudentPushToggle();
  }

  window.addEventListener('ifa:local-auth-changed', function (e) {
    var type = e && e.detail ? e.detail.type : '';
    if (type === 'profile-sync' || type === 'login') {
      wireStudentPushToggle();
    }
  });
  window.addEventListener('ifa:settings-menu-mounted', wireStudentPushToggle);

  onAuthStateChanged(auth, function (user) {
    authInitialized = true;
    lastUser = user || null;
    if (!user) {
      lastProfile = null;
      profileSynced = true;
      stopPlatformNotifications();
      if (shouldBypassAccessControl()) {
        ensureLocalDevSession();
      } else {
        clearLocalAuthUser();
      }
      refreshSlots();
      notifyLocalAuthChanged({ type: getLocalAuthUser() ? 'local-session' : 'logout' });
      notifyAuthChange(null, { profileSynced: true });
      return;
    }

    var email = normalizeEmail(user.email || '');
    var cachedEntitlements = readCachedEntitlements(user.uid);
    var hasCachedEntitlements = applyCachedEntitlementsToSession(user, cachedEntitlements, email);
    profileSynced = hasCachedEntitlements;

    if (!hasCachedEntitlements) {
      var bootstrapRole = applyOwnerAdminSessionRole(email, 'user');
      setLocalAuthUser({
        name: user.displayName || '',
        email: email,
        photoURL: user.photoURL || '',
        isSubscriber: false,
        isAdmin: bootstrapRole === 'admin',
        isInstructor: false,
        role: bootstrapRole,
      });
    }

    refreshSlots();
    notifyLocalAuthChanged({ type: 'login', email: email });
    notifyAuthChange(user, { profileSynced: hasCachedEntitlements });

    runBackgroundProfileAndEntitlementsSync(user);
  });

  document.addEventListener('ifa:instructor-application-submitted', refreshSlots);
  document.addEventListener('ifa:instructor-status-changed', refreshSlots);
  window.addEventListener('storage', function (e) {
    if (
      !e.key ||
      e.key === LOCAL_AUTH_KEY ||
      e.key === 'ifa_instructor_applications' ||
      e.key === 'ifa_approved_instructors' ||
      e.key === 'ifa_session_email' ||
      e.key === 'isInstructorApproved' ||
      e.key === 'approvedInstructorEmail' ||
      e.key === 'ifa_instructor_last_action' ||
      e.key.indexOf('ifa_instructor_status_') === 0
    ) {
      refreshSlots();
    }
  });
  window.addEventListener('focus', refreshSlots);
  window.addEventListener('pageshow', refreshSlots);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') refreshSlots();
  });
}

initAuthUI();

function refreshGlobalTopBanner() {
  if (typeof window.applyGlobalAnnouncementBar === 'function') {
    window.applyGlobalAnnouncementBar();
  }
}

window.IFAAuth = {
  auth: auth,
  getCurrentUser: function () {
    return lastUser;
  },
  getLocalAuthUser: getLocalAuthUser,
  getAuthState: function () {
    return resolveActiveIdentity();
  },
  isAuthInitialized: function () {
    return authInitialized;
  },
  isLoggedIn: function () {
    if (lastUser) return true;
    if (shouldBypassAccessControl() && getLocalAuthUser()) return true;
    return !!getLocalAuthUser();
  },
  onAuthChange: function (callback) {
    if (typeof callback !== 'function') return function () {};
    authChangeListeners.push(callback);
    try {
      var identity = resolveActiveIdentity();
      callback({
        user: lastUser || identity.user,
        profile: lastProfile || identity.profile,
        isLoggedIn: !!(lastUser || getLocalAuthUser()),
        email: lastUser && lastUser.email ? normalizeEmail(lastUser.email) : readLocalSessionEmail(),
        profileSynced: profileSynced,
      });
    } catch (err) {
      console.error('[Auth] onAuthChange initial callback failed', err);
    }
    return function () {
      authChangeListeners = authChangeListeners.filter(function (fn) {
        return fn !== callback;
      });
    };
  },
  loginWithEmailPassword: loginWithEmailPassword,
  signUpWithEmailPassword: signUpWithEmailPassword,
  loginWithGoogle: loginWithGoogle,
  logout: logoutUser,
  openAuthModal: openAuthModal,
  setLocalAuthUser: setLocalAuthUser,
  clearLocalAuthUser: clearLocalAuthUser,
  loginLocalSession: loginLocalSession,
  hasActiveTrial: hasActiveTrial,
  getTrialExpiryMs: getTrialExpiryMs,
  getRemainingTrialDays: getRemainingTrialDays,
  resolveAuthUserForTrial: resolveAuthUserForTrial,
  isAdminUser: isAdminUser,
  canShowSimulatorAdminSettingsUI: canShowSimulatorAdminSettingsUI,
  isInstructorUser: isInstructorUser,
  applyEntitlements: applyEntitlements,
  profileToEntitlements: profileToEntitlements,
};

refreshGlobalTopBanner();

document.addEventListener('ifa:subscription-changed', function (e) {
  var detail = (e && e.detail) || {};
  var current = getLocalAuthUser();
  if (!current || !lastUser) return;
  if (detail.userId && detail.userId !== lastUser.uid) return;
  setLocalAuthUser(
    Object.assign({}, current, {
      isSubscriber: detail.isSubscriber !== undefined ? !!detail.isSubscriber : current.isSubscriber,
      planId: detail.planId != null ? String(detail.planId) : current.planId,
      enrolledCourseIds: Array.isArray(detail.enrolledCourseIds)
        ? normalizeEnrolledCourseIds(detail.enrolledCourseIds)
        : current.enrolledCourseIds,
      allowedSimulators: Array.isArray(detail.allowedSimulators)
        ? normalizeAllowedSimulators(detail.allowedSimulators)
        : current.allowedSimulators,
    })
  );
  refreshSlots();
});
