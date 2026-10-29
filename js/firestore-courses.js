/**
 * Firestore real-time sync for platform courses (collection: `courses`).
 * Deploy rules: firebase deploy --only firestore:rules
 */
import { db } from './firebase-config.js';
import { isTrashCmsStatus } from './cms-status.js';
import { scheduleDeferredFirestoreSync } from './firestore-sync-scheduler.js';
import {
  collection,
  onSnapshot,
  setDoc,
  updateDoc,
  deleteDoc,
  doc,
  writeBatch,
  getDocs,
  getDoc,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

var COLLECTION = 'courses';
var COURSES_STORAGE_KEY = 'platform_courses';
var COURSES_LEGACY_KEY = 'ifa_platform_courses';
var cachedCourses = [];
var snapshotReady = false;
var lastPersistedSignature = '';
var listeners = [];
var unsubscribeSnapshot = null;
var seedInFlight = false;
var needsSeed = false;
var writesInFlight = 0;
var seedTimer = null;
var SEED_DELAY_MS = 500;

function normalizeCourse(raw, docId) {
  if (window.PlatformCourses && typeof window.PlatformCourses.normalizeCourse === 'function') {
    return window.PlatformCourses.normalizeCourse(
      Object.assign({}, raw || {}, { id: docId || (raw && raw.id) })
    );
  }
  return Object.assign({}, raw || {}, { id: docId || (raw && raw.id) || '' });
}

function sortCourses(list) {
  if (window.PlatformCourses && typeof window.PlatformCourses.sortByDisplayOrder === 'function') {
    return (list || []).slice().sort(window.PlatformCourses.sortByDisplayOrder);
  }
  return (list || []).slice().sort(function (a, b) {
    var ao = isFinite(Number(a.sortOrder)) ? Number(a.sortOrder) : Number.MAX_SAFE_INTEGER;
    var bo = isFinite(Number(b.sortOrder)) ? Number(b.sortOrder) : Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
}

function stripUndefined(obj) {
  var out = {};
  Object.keys(obj || {}).forEach(function (key) {
    if (obj[key] !== undefined) out[key] = obj[key];
  });
  return out;
}

function activeCachedCourses() {
  return cachedCourses.filter(function (item) {
    return !isTrashCmsStatus(item.status) && !item.softDeleted;
  });
}

function nextSortOrder() {
  var active = activeCachedCourses();
  if (!active.length) return 0;
  var max = 0;
  active.forEach(function (item) {
    var value = Number(item.sortOrder);
    if (isFinite(value) && value > max) max = value;
  });
  return max + 1;
}

function beginWrite() {
  writesInFlight += 1;
  cancelScheduledSeed();
}

function endWrite() {
  writesInFlight = Math.max(0, writesInFlight - 1);
}

function cancelScheduledSeed() {
  if (seedTimer) {
    clearTimeout(seedTimer);
    seedTimer = null;
  }
}

function canStartSeed() {
  return !seedInFlight && writesInFlight === 0 && cachedCourses.length === 0;
}

function canCommitSeed(existingDocCount) {
  return cachedCourses.length === 0 && Number(existingDocCount || 0) === 0;
}

function resolveFirestoreStatus(normalized, payload) {
  if (payload && isTrashCmsStatus(payload.status)) return 'trash';
  if (payload && payload.softDeleted) return 'trash';
  if (normalized && normalized.softDeleted && (!payload || payload.status == null)) return 'trash';
  return normalized.status || 'draft';
}

function preparePayload(payload, existing) {
  var base = Object.assign({}, existing || {}, payload || {});
  var normalized = normalizeCourse(base, existing && existing.id);
  if (!normalized || !normalized.title) throw new Error('عنوان الكورس مطلوب');

  var status = resolveFirestoreStatus(normalized, payload);
  var out = {
    title: normalized.title,
    description: normalized.description,
    status: status,
    category: normalized.category,
    instructorEmail: normalized.instructorEmail,
    instructorName: normalized.instructorName,
    instructorId: normalized.instructorId || '',
    thumbnailUrl: normalized.thumbnailUrl || normalized.imageUrl || '',
    imageUrl: normalized.imageUrl || normalized.thumbnailUrl || '',
    isAcademy: normalized.isAcademy,
    durationHours: normalized.durationHours,
    durationWeeks: normalized.durationWeeks,
    startDate: normalized.startDate || '',
    price: normalized.price,
    currency: normalized.currency,
    requiredPlanId: normalized.requiredPlanId,
    accessLevel: normalized.accessLevel,
    weeklySchedule: normalized.weeklySchedule,
    allowedSimulators: normalized.allowedSimulators,
    autoPricingPlan: normalized.autoPricingPlan,
    suppressPricingPlan: normalized.suppressPricingPlan === true,
    lessons: normalized.lessons,
    enrolledCount: normalized.enrolledCount,
    views: normalized.views,
    source: normalized.source,
    softDeleted: status === 'trash' ? true : !!normalized.softDeleted,
    previousStatus: normalized.previousStatus || '',
    deletedAt: normalized.deletedAt || '',
    sortOrder: isFinite(Number(normalized.sortOrder)) ? Number(normalized.sortOrder) : nextSortOrder(),
  };

  if (existing && existing.createdAt) out.createdAt = existing.createdAt;
  if (payload && payload.createdAt && !out.createdAt) out.createdAt = payload.createdAt;
  if (payload && payload.updatedAt) out.updatedAt = payload.updatedAt;
  return stripUndefined(out);
}

function readStoredCourses() {
  try {
    var raw = localStorage.getItem(COURSES_STORAGE_KEY) || localStorage.getItem(COURSES_LEGACY_KEY);
    if (!raw) return [];
    var parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

function coursesSignature(list) {
  return (list || [])
    .map(function (c) {
      return [c.id, c.updatedAt || '', c.status || ''].join(':');
    })
    .join('|');
}

function persistCoursesToLocalStorage(list) {
  try {
    var json = JSON.stringify(list);
    localStorage.setItem(COURSES_STORAGE_KEY, json);
    localStorage.setItem(COURSES_LEGACY_KEY, json);
    lastPersistedSignature = coursesSignature(list);
  } catch (err) {
    console.warn('[PlatformCoursesFirestore] localStorage persist failed', err);
  }
}

function maybePersistCoursesFromCache() {
  var nextSig = coursesSignature(cachedCourses);
  if (nextSig === lastPersistedSignature) return;
  persistCoursesToLocalStorage(cachedCourses);
}

function hydrateCoursesFromLocalStorage() {
  var stored = readStoredCourses();
  if (!stored.length) return false;
  setCachedCourses(
    stored.map(function (item) {
      return normalizeCourse(item, item.id);
    })
  );
  lastPersistedSignature = coursesSignature(cachedCourses);
  return true;
}

function setCachedCourses(list) {
  cachedCourses = sortCourses(list);
}

function upsertCachedCourse(item) {
  var normalized = normalizeCourse(item, item && item.id);
  var key = String(normalized.id || '');
  if (!key) return;
  var next = cachedCourses.filter(function (entry) {
    return String(entry.id) !== key;
  });
  next.push(normalized);
  setCachedCourses(next);
  notifyListeners();
}

function removeCachedCourse(id) {
  var key = String(id || '');
  if (!key) return;
  setCachedCourses(
    cachedCourses.filter(function (entry) {
      return String(entry.id) !== key;
    })
  );
  notifyListeners();
}

function notifyListeners() {
  var courses = cachedCourses.slice();
  listeners.forEach(function (fn) {
    try {
      fn(courses);
    } catch (err) {
      console.error('[PlatformCoursesFirestore] listener failed', err);
    }
  });
  try {
    var detail = { courses: courses, count: courses.length };
    window.dispatchEvent(new CustomEvent('ifa:courses-firestore-changed', { detail: detail }));
    document.dispatchEvent(new CustomEvent('ifa:courses-firestore-changed', { detail: detail }));
    window.dispatchEvent(new CustomEvent('ifa:platform-courses-changed', { detail: detail }));
    document.dispatchEvent(new CustomEvent('ifa:platform-courses-changed', { detail: detail }));
  } catch (err) {
    /* ignore */
  }
}

function canAutoSeedFirestore() {
  var Auth = window.IFAAuth;
  if (!Auth || typeof Auth.isLoggedIn !== 'function' || !Auth.isLoggedIn()) return false;
  if (typeof Auth.isAdminUser !== 'function') return false;
  return Auth.isAdminUser(Auth.getAuthState().profile);
}

function scheduleSeedIfNeeded() {
  if (!needsSeed) return;
  cancelScheduledSeed();
  seedTimer = setTimeout(function () {
    seedTimer = null;
    if (!needsSeed) return;
    if (canAutoSeedFirestore()) {
      seedDefaultCourses();
      return;
    }
    scheduleSeedIfNeeded();
  }, SEED_DELAY_MS);
}

function getDefaultCourseItems() {
  if (!window.PlatformCourses || typeof window.PlatformCourses.defaultSeedCourses !== 'function') {
    return [];
  }
  return window.PlatformCourses.defaultSeedCourses();
}

function waitForDefaultCoursesSource(callback, attempts) {
  var tries = attempts || 0;
  if (window.PlatformCourses && typeof window.PlatformCourses.defaultSeedCourses === 'function') {
    callback();
    return;
  }
  if (tries > 40) return;
  setTimeout(function () {
    waitForDefaultCoursesSource(callback, tries + 1);
  }, 50);
}

function buildDefaultPrepared(item, index, now) {
  var prepared = preparePayload(
    Object.assign({}, item, {
      sortOrder: index,
      createdAt: now,
      updatedAt: now,
    }),
    null
  );
  prepared.createdAt = now;
  prepared.updatedAt = now;
  return prepared;
}

async function writeDefaultCourses(items) {
  if (!items.length) return 0;

  var now = new Date().toISOString();
  var batch = writeBatch(db);
  var preparedItems = items.map(function (item, index) {
    return {
      id: String(item.id),
      prepared: buildDefaultPrepared(item, index, now),
    };
  });

  preparedItems.forEach(function (entry) {
    batch.set(doc(db, COLLECTION, entry.id), entry.prepared);
  });
  await batch.commit();

  preparedItems.forEach(function (entry) {
    upsertCachedCourse(Object.assign({ id: entry.id }, entry.prepared));
  });

  needsSeed = false;
  cancelScheduledSeed();
  return preparedItems.length;
}

async function seedDefaultCourses() {
  if (seedInFlight) return;
  if (!needsSeed) return;
  if (!canAutoSeedFirestore()) {
    scheduleSeedIfNeeded();
    return;
  }
  if (!canStartSeed()) {
    scheduleSeedIfNeeded();
    return;
  }

  if (!window.PlatformCourses || typeof window.PlatformCourses.defaultSeedCourses !== 'function') {
    waitForDefaultCoursesSource(function () {
      if (needsSeed) scheduleSeedIfNeeded();
    });
    return;
  }

  var defaults = getDefaultCourseItems();
  if (!defaults.length) {
    scheduleSeedIfNeeded();
    return;
  }

  seedInFlight = true;
  beginWrite();
  try {
    var existingSnap = await getDocs(collection(db, COLLECTION));
    if (!canCommitSeed(existingSnap.docs.length)) {
      needsSeed = false;
      return;
    }
    await writeDefaultCourses(defaults);
    needsSeed = false;
  } catch (err) {
    console.warn('[PlatformCoursesFirestore] auto-seed failed:', err);
    needsSeed = true;
    scheduleSeedIfNeeded();
  } finally {
    seedInFlight = false;
    endWrite();
  }
}

function handleSnapshot(snap) {
  if (!snap.docs.length) {
    if (cachedCourses.length > 0) {
      needsSeed = false;
      snapshotReady = true;
      return;
    }
    if (writesInFlight > 0 && !seedInFlight) {
      snapshotReady = true;
      return;
    }
    if (seedInFlight) {
      snapshotReady = true;
      return;
    }
    needsSeed = true;
    cachedCourses = [];
    snapshotReady = true;
    notifyListeners();
    scheduleSeedIfNeeded();
    return;
  }

  needsSeed = false;
  cancelScheduledSeed();
  setCachedCourses(
    snap.docs.map(function (docSnap) {
      return normalizeCourse(docSnap.data(), docSnap.id);
    })
  );
  maybePersistCoursesFromCache();
  snapshotReady = true;
  notifyListeners();
}

export function subscribeCourses(callback) {
  if (typeof callback === 'function') {
    listeners.push(callback);
    if (snapshotReady) callback(cachedCourses.slice());
  }
  return function () {
    listeners = listeners.filter(function (fn) {
      return fn !== callback;
    });
  };
}

export function getCachedCourses() {
  return cachedCourses.slice();
}

export function isCoursesSnapshotReady() {
  return snapshotReady;
}

export function isCoursesSeeding() {
  return needsSeed || seedInFlight;
}

export function findCachedCourse(id) {
  var key = String(id || '');
  if (!key) return null;
  for (var i = 0; i < cachedCourses.length; i++) {
    if (String(cachedCourses[i].id) === key) return cachedCourses[i];
  }
  return null;
}

export async function fetchCourseById(id) {
  var key = String(id || '').trim();
  if (!key) return null;

  var cached = findCachedCourse(key);
  if (cached) return cached;

  try {
    var snap = await getDoc(doc(db, COLLECTION, key));
    if (!snap.exists()) return null;
    var course = normalizeCourse(snap.data(), snap.id);
    if (course) upsertCachedCourse(course);
    return course;
  } catch (err) {
    console.error('[PlatformCoursesFirestore] fetchCourseById failed', err);
    return null;
  }
}

function newCourseId() {
  if (window.PlatformCourses && typeof window.PlatformCourses.uid === 'function') {
    return window.PlatformCourses.uid('course');
  }
  return 'course_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

export async function addCourse(payload) {
  var key = String((payload && payload.id) || '').trim();
  if (!key) key = newCourseId();
  if (findCachedCourse(key)) throw new Error('الكورس موجود مسبقاً');

  var now = new Date().toISOString();
  var prepared = preparePayload(
    Object.assign({}, payload, {
      sortOrder: isFinite(Number(payload && payload.sortOrder)) ? Number(payload.sortOrder) : nextSortOrder(),
      createdAt: now,
      updatedAt: now,
    }),
    null
  );
  prepared.createdAt = now;
  prepared.updatedAt = now;

  beginWrite();
  try {
    await setDoc(doc(db, COLLECTION, key), prepared);
    needsSeed = false;
    cancelScheduledSeed();
    upsertCachedCourse(Object.assign({ id: key }, prepared));
    return normalizeCourse(Object.assign({ id: key }, prepared), key);
  } finally {
    endWrite();
  }
}

export async function updateCourse(id, payload) {
  var key = String(id || '').trim();
  if (!key) throw new Error('معرّف الكورس غير صالح');
  var existing = findCachedCourse(key);
  if (!existing) throw new Error('الكورس غير موجود');

  var now = new Date().toISOString();
  var prepared = preparePayload(Object.assign({}, payload, { updatedAt: now }), existing);
  prepared.updatedAt = now;
  if (existing.createdAt) prepared.createdAt = existing.createdAt;

  beginWrite();
  try {
    await updateDoc(doc(db, COLLECTION, key), prepared);
    needsSeed = false;
    cancelScheduledSeed();
    upsertCachedCourse(Object.assign({}, existing, prepared, { id: key }));
    return findCachedCourse(key);
  } finally {
    endWrite();
  }
}

export async function setCourseStatus(id, status) {
  var key = String(id || '').trim();
  if (!key) throw new Error('معرّف الكورس غير صالح');
  var existing = findCachedCourse(key);
  if (!existing) throw new Error('الكورس غير موجود');

  var nextStatus = String(status || 'draft').toLowerCase();
  if (isTrashCmsStatus(nextStatus)) {
    return softDeleteCourse(key);
  }

  var now = new Date().toISOString();
  var patch = {
    status: nextStatus,
    softDeleted: false,
    deletedAt: '',
    previousStatus: '',
    updatedAt: now,
  };

  beginWrite();
  try {
    await updateDoc(doc(db, COLLECTION, key), patch);
    upsertCachedCourse(Object.assign({}, existing, patch, { id: key }));
    return findCachedCourse(key);
  } finally {
    endWrite();
  }
}

export async function softDeleteCourse(id) {
  var key = String(id || '').trim();
  if (!key) throw new Error('معرّف الكورس غير صالح');
  var existing = findCachedCourse(key);
  if (!existing) throw new Error('الكورس غير موجود');

  var now = new Date().toISOString();
  var patch = {
    status: 'trash',
    softDeleted: true,
    previousStatus:
      existing.status === 'draft' ? existing.previousStatus || 'published' : existing.status,
    deletedAt: now,
    updatedAt: now,
  };

  beginWrite();
  try {
    await updateDoc(doc(db, COLLECTION, key), patch);
    upsertCachedCourse(Object.assign({}, existing, patch, { id: key }));
    return findCachedCourse(key);
  } finally {
    endWrite();
  }
}

export async function restoreCourse(id) {
  var key = String(id || '').trim();
  if (!key) throw new Error('معرّف الكورس غير صالح');
  var existing = findCachedCourse(key);
  if (!existing) throw new Error('الكورس غير موجود');

  var nextStatus = existing.previousStatus || 'published';
  if (nextStatus === 'draft' || nextStatus === 'trash') nextStatus = 'published';

  var now = new Date().toISOString();
  var patch = {
    status: nextStatus,
    softDeleted: false,
    deletedAt: '',
    previousStatus: '',
    updatedAt: now,
  };

  beginWrite();
  try {
    await updateDoc(doc(db, COLLECTION, key), patch);
    upsertCachedCourse(Object.assign({}, existing, patch, { id: key }));
    return findCachedCourse(key);
  } finally {
    endWrite();
  }
}

export async function purgeCourse(id) {
  var key = String(id || '').trim();
  if (!key) throw new Error('معرّف الكورس غير صالح');

  beginWrite();
  try {
    await deleteDoc(doc(db, COLLECTION, key));
    removeCachedCourse(key);
    return true;
  } finally {
    endWrite();
  }
}

export async function reorderCourses(orderedIds) {
  var ids = (orderedIds || []).map(function (id) {
    return String(id || '');
  }).filter(Boolean);
  if (!ids.length) return cachedCourses.slice();

  var now = new Date().toISOString();
  var batch = writeBatch(db);
  var localUpdates = cachedCourses.slice();
  ids.forEach(function (id, index) {
    var existing = findCachedCourse(id);
    if (!existing) return;
    batch.update(doc(db, COLLECTION, id), { sortOrder: index, updatedAt: now });
    localUpdates = localUpdates.map(function (entry) {
      if (String(entry.id) !== id) return entry;
      return Object.assign({}, entry, { sortOrder: index, updatedAt: now });
    });
  });

  beginWrite();
  try {
    await batch.commit();
    needsSeed = false;
    cancelScheduledSeed();
    setCachedCourses(localUpdates);
    notifyListeners();
    return cachedCourses.slice();
  } finally {
    endWrite();
  }
}

export function startCoursesFirestoreSync() {
  if (unsubscribeSnapshot) return unsubscribeSnapshot;
  unsubscribeSnapshot = onSnapshot(
    collection(db, COLLECTION),
    handleSnapshot,
    function (err) {
      console.error('[PlatformCoursesFirestore] onSnapshot failed', err);
      if (!writesInFlight) {
        cachedCourses = [];
      }
      snapshotReady = true;
      notifyListeners();
    }
  );
  return unsubscribeSnapshot;
}

function bootstrapCoursesAutoSeed() {
  if (!needsSeed) return;
  scheduleSeedIfNeeded();
}

window.addEventListener('ifa:auth-changed', function () {
  if (needsSeed) scheduleSeedIfNeeded();
});
document.addEventListener('ifa:auth-changed', function () {
  if (needsSeed) scheduleSeedIfNeeded();
});

var api = {
  subscribe: subscribeCourses,
  getCachedCourses: getCachedCourses,
  isReady: isCoursesSnapshotReady,
  isSeeding: isCoursesSeeding,
  findCourse: findCachedCourse,
  fetchCourseById: fetchCourseById,
  addCourse: addCourse,
  updateCourse: updateCourse,
  setCourseStatus: setCourseStatus,
  softDeleteCourse: softDeleteCourse,
  restoreCourse: restoreCourse,
  purgeCourse: purgeCourse,
  deleteCourse: softDeleteCourse,
  reorderCourses: reorderCourses,
  start: startCoursesFirestoreSync,
};

window.PlatformCoursesFirestore = api;
if (hydrateCoursesFromLocalStorage() && cachedCourses.length) {
  notifyListeners();
}
scheduleDeferredFirestoreSync(function () {
  startCoursesFirestoreSync();
  bootstrapCoursesAutoSeed();
});

export default api;
