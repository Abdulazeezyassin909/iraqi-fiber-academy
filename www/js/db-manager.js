/**
 * Cloud Firestore user profiles & subscriber flags.
 *
 * FIRST ADMIN SETUP (one-time):
 * 1. Sign up / sign in once so users/{uid} exists.
 * 2. Firebase Console → Firestore Database → users → open your document (doc id = Auth uid).
 * 3. Set field `role` to `admin` (string). Save.
 * 4. Sign out and back in (or refresh) so the client picks up the new role.
 */
import { db } from './firebase-config.js';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  runTransaction,
  serverTimestamp,
  where,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

function normalizeTrialConsumptionDocId(consumptionKey) {
  var id = String(consumptionKey || '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 500);
  return id || '';
}

function profileCreatedAtMs(data) {
  var value = data && data.createdAt;
  if (value == null || value === '') return 0;
  try {
    if (value && typeof value.toDate === 'function') {
      var d = value.toDate();
      return d && !isNaN(d.getTime()) ? d.getTime() : 0;
    }
    if (typeof value === 'number' && isFinite(value)) return value;
    var parsed = Date.parse(String(value));
    return isFinite(parsed) ? parsed : 0;
  } catch (err) {
    return 0;
  }
}

/**
 * Count users sharing an IP whose profile was created within the last N days.
 * @param {string} ipAddress
 * @param {number} withinDays
 * @param {string} [excludeUid] Current user uid to exclude from the count
 * @returns {Promise<number>}
 */
export async function countRecentUsersWithIp(ipAddress, withinDays, excludeUid) {
  var ip = String(ipAddress || '').trim();
  if (!ip || ip === 'unknown') return 0;
  var days = Number(withinDays);
  if (!isFinite(days) || days <= 0) days = 7;
  var cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  var q = query(collection(db, 'users'), where('ipAddress', '==', ip));
  var snap = await getDocs(q);
  var count = 0;
  snap.forEach(function (docSnap) {
    if (excludeUid && docSnap.id === excludeUid) return;
    var createdMs = profileCreatedAtMs(docSnap.data());
    if (createdMs >= cutoff) count++;
  });
  return count;
}

function buildDefaultUserProfile(user) {
  return {
    uid: user.uid,
    name: user.displayName || '',
    email: user.email || '',
    photoURL: user.photoURL || '',
    photo: user.photoURL || '',
    isSubscriber: false,
    planId: '',
    isAdmin: false,
    role: 'user',
    createdAt: new Date().toISOString(),
  };
}

/** Matches auth-manager default when platform settings omit freeTrialDays. */
function effectiveTrialDurationMs(options) {
  var ms = Number(options && options.trialDurationMs);
  if (isFinite(ms) && ms > 0) return ms;
  return 7 * 24 * 60 * 60 * 1000;
}

function stampActiveTrialOnPayload(payload, durationMs) {
  var ms = Number(durationMs);
  if (!isFinite(ms) || ms <= 0) return;
  var startMs = Date.now();
  payload.trialStartDate = new Date(startMs).toISOString();
  payload.trialExpiresAt = startMs + ms;
}

/**
 * Ensure users/{uid} exists (safe for first-time Google / redirect sign-in).
 * Base profile is written first; trial fields are merged afterward so IP/query failures cannot block create.
 * @returns {Promise<{ profile: object, isNew: boolean }|null>}
 */
export async function ensureUserProfileDocument(user, options) {
  if (!user || !user.uid) return null;

  var ref = doc(db, 'users', user.uid);
  var snap = await getDoc(ref);
  if (snap.exists()) {
    return { profile: snap.data(), isNew: false };
  }

  options = options || {};
  var profile = buildDefaultUserProfile(user);
  var signupName = String(options.displayName || options.fullName || '').trim();
  if (signupName) {
    profile.name = signupName;
  }
  var payload = Object.assign({}, profile, { createdAt: serverTimestamp() });

  var deviceUuid = String(options.deviceUuid || '').trim();
  if (deviceUuid) {
    payload.deviceUuid = deviceUuid;
  }

  var ipAddress = String(options.ipAddress || '').trim() || 'unknown';
  payload.ipAddress = ipAddress;

  await setDoc(ref, payload);

  var trialDurationMs = effectiveTrialDurationMs(options);
  var ipBlocksTrial = false;
  if (!options.skipTrialAbuseChecks) {
    try {
      var recentOnIp = await countRecentUsersWithIp(ipAddress, 7, user.uid);
      if (recentOnIp >= 2) {
        ipBlocksTrial = true;
        console.warn('Free trial denied: IP rate limit exceeded for this network.');
      }
    } catch (err) {
      console.warn('[db-manager] IP trial check skipped (query failed):', err);
    }
  }

  var trialPatch = {};
  if (ipBlocksTrial) {
    trialPatch.trialExpiresAt = 0;
  } else if (options.skipTrialAbuseChecks) {
    stampActiveTrialOnPayload(trialPatch, trialDurationMs);
  } else if (deviceUuid) {
    var uuidKey = 'uuid_' + normalizeTrialConsumptionDocId(deviceUuid);
    var allowed = await checkAndRegisterDeviceTrial(uuidKey, user.uid);
    if (allowed) {
      stampActiveTrialOnPayload(trialPatch, trialDurationMs);
    }
  }

  if (Object.keys(trialPatch).length) {
    await setDoc(ref, trialPatch, { merge: true });
  }

  var created = await getDoc(ref);
  var data = created.exists() ? created.data() : Object.assign({}, payload, trialPatch);
  return { profile: data, isNew: true };
}

/**
 * Create users/{uid} immediately after Email/Password sign-up.
 * @param {import('firebase/auth').User} user
 * @param {{ deviceUuid?: string, skipTrialAbuseChecks?: boolean, trialDurationMs?: number }} [options]
 * @returns {Promise<{ profile: object, isNew: boolean }|null>}
 */
export async function createUserProfileOnSignUp(user, options) {
  if (!user || !user.uid) return null;
  return ensureUserProfileDocument(user, options);
}

/**
 * @param {string} uid
 * @returns {Promise<object|null>}
 */
export async function fetchUserProfile(uid) {
  if (!uid) return null;
  var snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? snap.data() : null;
}

/**
 * Ensure users/{uid} exists; create a default non-subscriber profile if missing.
 * @param {import('firebase/auth').User} user
 * @returns {Promise<{ profile: object, isNew: boolean }|null>}
 */
export async function syncUserProfile(user, options) {
  return ensureUserProfileDocument(user, options);
}

/**
 * Minimal users/{uid} stub when only uid is known (entitlements / settings merge).
 * @param {string} uid
 * @returns {Promise<void>}
 */
export async function ensureUserDocExistsForUid(uid) {
  if (!uid) return;
  var ref = doc(db, 'users', uid);
  var snap = await getDoc(ref);
  if (snap.exists()) return;
  await setDoc(ref, {
    uid: uid,
    role: 'user',
    isSubscriber: false,
    createdAt: new Date().toISOString(),
  });
}

/**
 * @param {string} uid
 * @returns {Promise<boolean>}
 */
export async function checkSubscriberStatus(uid) {
  if (!uid) return false;
  var snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) return false;
  var data = snap.data() || {};
  return data.isSubscriber === true;
}

/**
 * @param {string} uid
 * @returns {Promise<string[]>}
 */
export async function getUserAllowedSimulators(uid) {
  if (!uid) return [];
  var snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) return [];
  var data = snap.data() || {};
  if (!Array.isArray(data.allowedSimulators)) return [];
  return data.allowedSimulators
    .map(function (id) {
      return String(id || '').trim();
    })
    .filter(Boolean);
}

/**
 * @param {string} uid
 * @param {string} simulatorId
 * @returns {Promise<boolean>}
 */
export async function checkSimulatorAccess(uid, simulatorId) {
  if (!uid || !simulatorId) return false;
  var allowed = await getUserAllowedSimulators(uid);
  return allowed.indexOf(String(simulatorId)) !== -1;
}

/**
 * @param {string} uid
 * @returns {Promise<boolean>}
 */
export async function checkAdminStatus(uid) {
  if (!uid) return false;
  var snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) return false;
  var data = snap.data() || {};
  return String(data.role || '') === 'admin';
}

/**
 * Device trial lock in trialConsumptions/{key}. Keys: uuid_{deviceUuid} (primary) or fp2_{composite} (fallback).
 * @param {string} consumptionKey
 * @param {string} uid
 * @returns {Promise<boolean>} true if registered and trial may be granted; false if already consumed
 */
export async function checkAndRegisterDeviceTrial(consumptionKey, uid) {
  var hashId = normalizeTrialConsumptionDocId(consumptionKey);
  if (!hashId || !uid) return false;

  var ref = doc(db, 'trialConsumptions', hashId);
  try {
    return await runTransaction(db, async function (transaction) {
      var snap = await transaction.get(ref);
      if (snap.exists()) return false;
      transaction.set(ref, {
        uid: String(uid),
        key: hashId,
        createdAt: serverTimestamp(),
      });
      return true;
    });
  } catch (err) {
    console.error('[db-manager] checkAndRegisterDeviceTrial failed:', err);
    return false;
  }
}

/**
 * @param {string} uid
 * @param {number} expiresAtMs
 */
export async function setUserTrialExpiresAt(uid, expiresAtMs) {
  if (!uid || expiresAtMs == null || expiresAtMs === '') return;
  var patch = {
    trialExpiresAt: expiresAtMs,
    updatedAt: serverTimestamp(),
  };
  if (Number(expiresAtMs) > 0) {
    patch.trialStartDate = new Date().toISOString();
  }
  await setDoc(doc(db, 'users', uid), patch, { merge: true });
}
