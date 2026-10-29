/**
 * Authoritative entitlements derived from approved checkout orders.
 */
import { db } from './firebase-config.js';
import { ensureUserDocExistsForUid } from './db-manager.js';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

var ENTITLEMENTS_CACHE_KEY = 'ifa_entitlements_cache_v1';

/**
 * @param {string} uid
 * @returns {object|null}
 */
export function readCachedEntitlements(uid) {
  var id = String(uid || '').trim();
  if (!id) return null;
  try {
    var raw = localStorage.getItem(ENTITLEMENTS_CACHE_KEY);
    if (!raw) return null;
    var parsed = JSON.parse(raw);
    if (!parsed || String(parsed.uid || '') !== id) return null;
    var data = parsed.data;
    if (!data || typeof data !== 'object') return null;
    return {
      enrolledCourseIds: Array.isArray(data.enrolledCourseIds) ? data.enrolledCourseIds.slice() : [],
      allowedSimulators: Array.isArray(data.allowedSimulators) ? data.allowedSimulators.slice() : [],
      isSubscriber: !!data.isSubscriber,
      planId: data.planId != null ? String(data.planId) : '',
      trialExpiresAt: data.trialExpiresAt,
      trialStartDate: data.trialStartDate,
      trialExpiresAtMs: typeof data.trialExpiresAtMs === 'number' ? data.trialExpiresAtMs : 0,
    };
  } catch (err) {
    return null;
  }
}

/**
 * @param {string} uid
 * @param {object} entitlements
 */
export function writeCachedEntitlements(uid, entitlements) {
  var id = String(uid || '').trim();
  if (!id || !entitlements) return;
  try {
    localStorage.setItem(
      ENTITLEMENTS_CACHE_KEY,
      JSON.stringify({
        uid: id,
        updatedAt: Date.now(),
        data: {
          enrolledCourseIds: Array.isArray(entitlements.enrolledCourseIds)
            ? entitlements.enrolledCourseIds.slice()
            : [],
          allowedSimulators: Array.isArray(entitlements.allowedSimulators)
            ? entitlements.allowedSimulators.slice()
            : [],
          isSubscriber: !!entitlements.isSubscriber,
          planId: entitlements.planId != null ? String(entitlements.planId) : '',
          trialExpiresAt: entitlements.trialExpiresAt,
          trialStartDate: entitlements.trialStartDate,
          trialExpiresAtMs:
            typeof entitlements.trialExpiresAtMs === 'number' ? entitlements.trialExpiresAtMs : 0,
        },
      })
    );
  } catch (err) {
    /* ignore quota */
  }
}

function uniqueIds(list) {
  var seen = {};
  var out = [];
  (list || []).forEach(function (id) {
    var key = String(id || '').trim();
    if (!key || seen[key]) return;
    seen[key] = true;
    out.push(key);
  });
  return out;
}

function mergeSimulatorIds(existing, additions) {
  var seen = {};
  var out = [];
  (existing || []).concat(additions || []).forEach(function (id) {
    var key = String(id || '').trim();
    if (!key || seen[key]) return;
    seen[key] = true;
    out.push(key);
  });
  return out;
}

function sortOrdersByNewest(list) {
  return (list || []).slice().sort(function (a, b) {
    var ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : Date.parse(a.createdAt) || 0;
    var tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : Date.parse(b.createdAt) || 0;
    return tb - ta;
  });
}

async function fetchPublishedCourses() {
  if (typeof window !== 'undefined' && window.PlatformCourses && typeof window.PlatformCourses.getPublished === 'function') {
    return window.PlatformCourses.getPublished();
  }
  try {
    var snap = await getDocs(collection(db, 'courses'));
    return snap.docs
      .map(function (d) {
        return Object.assign({ id: d.id }, d.data());
      })
      .filter(function (c) {
        return String(c.status || '').toLowerCase() === 'published';
      });
  } catch (err) {
    return [];
  }
}

async function computeAllowedSimulatorsFromCourses(enrolledCourseIds) {
  var courses = await fetchPublishedCourses();
  var ids = [];
  (enrolledCourseIds || []).forEach(function (courseId) {
    var course = courses.find(function (c) {
      return String(c.id) === String(courseId);
    });
    if (course && Array.isArray(course.allowedSimulators)) {
      ids = mergeSimulatorIds(ids, course.allowedSimulators);
    }
  });
  return ids;
}

async function computeEnrolledCourseIdsForOrder(order) {
  var ids = [];
  if (order.courseId) ids.push(String(order.courseId));
  if (order.planId) {
    var planSnap = await getDoc(doc(db, 'pricing', String(order.planId)));
    if (planSnap.exists()) {
      var plan = planSnap.data() || {};
      if (plan.sourceCourseId) ids.push(String(plan.sourceCourseId));
      if (Array.isArray(plan.includedCourseIds)) {
        plan.includedCourseIds.forEach(function (id) {
          ids.push(String(id));
        });
      }
      var courses = await fetchPublishedCourses();
      courses.forEach(function (course) {
        if (course && String(course.requiredPlanId || '') === String(order.planId)) {
          ids.push(String(course.id));
        }
      });
    }
  }
  return uniqueIds(ids);
}

function orderGrantsGlobalPlatformSubscription(order) {
  if (!order || typeof order !== 'object') return false;
  if (order.courseId) return false;
  return !!String(order.planId || '').trim();
}

function trialExpiresAtMs(profile) {
  if (!profile || profile.trialExpiresAt == null || profile.trialExpiresAt === '') return 0;
  var value = profile.trialExpiresAt;
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
 * Rebuild users/{uid} entitlements from all approved orders for that user.
 * @param {string} uid
 * @returns {Promise<{ enrolledCourseIds: string[], allowedSimulators: string[], isSubscriber: boolean, planId: string }>}
 */
export async function syncEntitlementsFromApprovedOrders(uid) {
  var empty = {
    enrolledCourseIds: [],
    allowedSimulators: [],
    isSubscriber: false,
    planId: '',
  };
  if (!uid) return empty;

  var snap = await getDocs(
    query(collection(db, 'orders'), where('userId', '==', uid), where('status', '==', 'approved'))
  );
  var approvedOrders = sortOrdersByNewest(
    snap.docs.map(function (d) {
      return Object.assign({ id: d.id }, d.data());
    })
  );

  var enrolled = [];
  for (var i = 0; i < approvedOrders.length; i++) {
    var courseIds = await computeEnrolledCourseIdsForOrder(approvedOrders[i]);
    enrolled = uniqueIds(enrolled.concat(courseIds));
  }

  var allowedSimulators = await computeAllowedSimulatorsFromCourses(enrolled);
  var planId = '';
  var isSubscriber = false;
  for (var j = 0; j < approvedOrders.length; j++) {
    if (!orderGrantsGlobalPlatformSubscription(approvedOrders[j])) continue;
    isSubscriber = true;
    planId = String(approvedOrders[j].planId || planId || '');
    break;
  }

  var entitlements = {
    enrolledCourseIds: enrolled,
    allowedSimulators: allowedSimulators,
    isSubscriber: isSubscriber,
    planId: planId,
  };

  await ensureUserDocExistsForUid(uid);
  var userRef = doc(db, 'users', uid);
  var existingSnap = await getDoc(userRef);
  var existing = existingSnap.exists() ? existingSnap.data() || {} : {};

  /** Order-derived fields only — never touch trialStartDate / trialExpiresAt / createdAt. */
  var patch = {
    enrolledCourseIds: enrolled,
    allowedSimulators: allowedSimulators,
    updatedAt: serverTimestamp(),
  };

  if (isSubscriber) {
    patch.isSubscriber = true;
    patch.planId = planId;
  } else if (existing.isSubscriber !== true) {
    patch.isSubscriber = false;
    if (!String(existing.planId || '').trim()) {
      patch.planId = '';
    }
  }

  await setDoc(userRef, patch, { merge: true });

  var trialExpiresAt = existing.trialExpiresAt;
  var trialStartDate = existing.trialStartDate;
  var result = Object.assign({}, entitlements, {
    trialExpiresAt: trialExpiresAt,
    trialStartDate: trialStartDate,
    trialExpiresAtMs: trialExpiresAtMs(existing),
  });
  writeCachedEntitlements(uid, result);
  return result;
}
