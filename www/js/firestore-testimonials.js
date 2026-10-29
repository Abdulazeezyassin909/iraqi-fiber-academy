/**
 * Firestore real-time sync for testimonials (collection: `testimonials`).
 * Deploy rules: firebase deploy --only firestore:rules
 */
import { db } from './firebase-config.js';
import { rejectDataUrl } from './cms-storage.js';
import { normalizeCmsStatus } from './cms-status.js';
import {
  collection,
  onSnapshot,
  setDoc,
  updateDoc,
  deleteDoc,
  doc,
  writeBatch,
  getDocs,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { scheduleLazyFirestoreSync, hydrateListFromLocalStorage } from './firestore-sync-scheduler.js';

var COLLECTION = 'testimonials';
var TESTIMONIALS_STORAGE_KEY = 'ifa_platform_testimonials';
var cachedTestimonials = [];
var snapshotReady = false;
var listeners = [];
var unsubscribeSnapshot = null;
var seedInFlight = false;
var needsSeed = false;
var writesInFlight = 0;
var seedTimer = null;
var SEED_DELAY_MS = 500;

function normalizeTestimonial(raw, docId) {
  if (
    window.PlatformTestimonials &&
    typeof window.PlatformTestimonials.normalizeTestimonial === 'function'
  ) {
    return window.PlatformTestimonials.normalizeTestimonial(
      Object.assign({}, raw || {}, { id: docId || raw.id })
    );
  }
  return Object.assign({}, raw || {}, { id: docId || (raw && raw.id) || '' });
}

function sortTestimonials(list) {
  return (list || []).slice().sort(function (a, b) {
    var orderA = isFinite(Number(a.sortOrder)) ? Number(a.sortOrder) : 0;
    var orderB = isFinite(Number(b.sortOrder)) ? Number(b.sortOrder) : 0;
    if (orderA !== orderB) return orderA - orderB;
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

function activeCachedTestimonials() {
  return cachedTestimonials.filter(function (item) {
    return normalizeCmsStatus(item.status) !== 'trash';
  });
}

function nextSortOrder() {
  var active = activeCachedTestimonials();
  if (!active.length) return 0;
  var max = 0;
  active.forEach(function (item) {
    var value = Number(item.sortOrder);
    if (isFinite(value) && value > max) max = value;
  });
  return max + 1;
}

function normalizeStatusValue(value) {
  return normalizeCmsStatus(value);
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
  return !seedInFlight && writesInFlight === 0 && cachedTestimonials.length === 0;
}

function canCommitSeed(existingDocCount) {
  return cachedTestimonials.length === 0 && Number(existingDocCount || 0) === 0;
}

function sanitizeAvatar(value) {
  var avatar = String(value == null ? '' : value).trim();
  if (avatar && rejectDataUrl(avatar)) {
    throw new Error('صورة الرأي يجب رفعها إلى التخزين — لا يُسمح بحفظ base64 في Firestore.');
  }
  return avatar;
}

function preparePayload(payload, existing) {
  var base = Object.assign({}, existing || {}, payload || {});
  var normalized = normalizeTestimonial(base, existing && existing.id);
  if (!normalized.name) throw new Error('اسم صاحب الرأي مطلوب');
  if (!normalized.text) throw new Error('نص الرأي مطلوب');
  var out = {
    name: normalized.name,
    role: normalized.role,
    text: normalized.text,
    rating: normalized.rating,
    avatar: sanitizeAvatar(normalized.avatar),
    status: normalized.status,
    sortOrder: isFinite(Number(normalized.sortOrder)) ? Number(normalized.sortOrder) : nextSortOrder(),
  };
  if (existing && existing.createdAt) out.createdAt = existing.createdAt;
  if (payload && payload.createdAt && !out.createdAt) out.createdAt = payload.createdAt;
  if (payload && payload.updatedAt) out.updatedAt = payload.updatedAt;
  return stripUndefined(out);
}

function setCachedTestimonials(list) {
  cachedTestimonials = sortTestimonials(list);
}

function persistTestimonialsToLocalStorage() {
  try {
    localStorage.setItem(TESTIMONIALS_STORAGE_KEY, JSON.stringify(cachedTestimonials));
  } catch (err) {
    /* ignore */
  }
}

function hydrateTestimonialsFromLocalStorage() {
  return hydrateListFromLocalStorage(
    TESTIMONIALS_STORAGE_KEY,
    normalizeTestimonial,
    function (list) {
      setCachedTestimonials(list);
    },
    notifyListeners
  );
}

function upsertCachedTestimonial(item) {
  var normalized = normalizeTestimonial(item, item && item.id);
  var key = String(normalized.id || '');
  if (!key) return;
  var next = cachedTestimonials.filter(function (entry) {
    return String(entry.id) !== key;
  });
  next.push(normalized);
  setCachedTestimonials(next);
  notifyListeners();
}

function removeCachedTestimonial(id) {
  var key = String(id || '');
  if (!key) return;
  setCachedTestimonials(
    cachedTestimonials.filter(function (entry) {
      return String(entry.id) !== key;
    })
  );
  notifyListeners();
}

function notifyListeners() {
  var testimonials = cachedTestimonials.slice();
  listeners.forEach(function (fn) {
    try {
      fn(testimonials);
    } catch (err) {
      console.error('[PlatformTestimonialsFirestore] listener failed', err);
    }
  });
  try {
    var detail = { testimonials: testimonials, count: testimonials.length };
    window.dispatchEvent(new CustomEvent('ifa:testimonials-firestore-changed', { detail: detail }));
    document.dispatchEvent(new CustomEvent('ifa:testimonials-firestore-changed', { detail: detail }));
    window.dispatchEvent(new CustomEvent('ifa:platform-testimonials-changed', { detail: detail }));
    document.dispatchEvent(new CustomEvent('ifa:platform-testimonials-changed', { detail: detail }));
  } catch (err) {
    /* ignore */
  }
  if (window.PlatformTestimonials && typeof window.PlatformTestimonials.renderPublic === 'function') {
    window.PlatformTestimonials.renderPublic();
  }
}

function canAutoSeedFirestore() {
  var Auth = window.IFAAuth;
  if (!Auth || typeof Auth.isLoggedIn !== 'function' || !Auth.isLoggedIn()) return false;
  if (typeof Auth.isAdminUser !== 'function') return false;
  return Auth.isAdminUser(Auth.getAuthState().profile);
}

function scheduleSeedIfNeeded() {
  if (!needsSeed || !canAutoSeedFirestore()) return;
  cancelScheduledSeed();
  seedTimer = setTimeout(function () {
    seedTimer = null;
    seedDefaultTestimonials();
  }, SEED_DELAY_MS);
}

function getDefaultTestimonialItems() {
  if (!window.PlatformTestimonials || typeof window.PlatformTestimonials.defaultTestimonials !== 'function') {
    return [];
  }
  return window.PlatformTestimonials.defaultTestimonials();
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

async function writeDefaultTestimonials(items) {
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
    upsertCachedTestimonial(Object.assign({ id: entry.id }, entry.prepared));
  });

  needsSeed = false;
  cancelScheduledSeed();
  return preparedItems.length;
}

async function seedDefaultTestimonials() {
  if (seedInFlight) return;
  if (!needsSeed || !canAutoSeedFirestore()) return;
  if (!canStartSeed()) {
    scheduleSeedIfNeeded();
    return;
  }

  var defaults = getDefaultTestimonialItems();
  if (!defaults.length) return;

  seedInFlight = true;
  beginWrite();
  try {
    var existingSnap = await getDocs(collection(db, COLLECTION));
    if (!canCommitSeed(existingSnap.docs.length)) {
      needsSeed = false;
      return;
    }
    await writeDefaultTestimonials(defaults);
    needsSeed = false;
  } catch (err) {
    console.warn('[PlatformTestimonialsFirestore] auto-seed failed:', err);
  } finally {
    seedInFlight = false;
    endWrite();
  }
}

export async function restoreDefaultTestimonials() {
  var defaults = getDefaultTestimonialItems();
  if (!defaults.length) throw new Error('لا توجد آراء افتراضية لاستعادتها.');

  beginWrite();
  try {
    var existingSnap = await getDocs(collection(db, COLLECTION));
    var existingIds = {};
    existingSnap.docs.forEach(function (docSnap) {
      existingIds[docSnap.id] = true;
    });

    var missing = defaults.filter(function (item) {
      return !existingIds[String(item.id)];
    });
    if (!missing.length) {
      return { restored: 0, message: 'الآراء الافتراضية موجودة بالفعل.' };
    }

    var restored = await writeDefaultTestimonials(missing);
    return { restored: restored, message: 'تمت استعادة ' + restored + ' آراء افتراضية.' };
  } finally {
    endWrite();
  }
}

function handleSnapshot(snap) {
  if (!snap.docs.length) {
    if (cachedTestimonials.length > 0 || writesInFlight > 0) {
      needsSeed = false;
      snapshotReady = true;
      return;
    }
    needsSeed = true;
    cachedTestimonials = [];
    snapshotReady = true;
    notifyListeners();
    scheduleSeedIfNeeded();
    return;
  }

  needsSeed = false;
  cancelScheduledSeed();
  setCachedTestimonials(
    snap.docs.map(function (docSnap) {
      return normalizeTestimonial(docSnap.data(), docSnap.id);
    })
  );
  persistTestimonialsToLocalStorage();
  snapshotReady = true;
  notifyListeners();
}

export function subscribeTestimonials(callback) {
  if (typeof callback === 'function') {
    listeners.push(callback);
    if (snapshotReady) callback(cachedTestimonials.slice());
  }
  return function () {
    listeners = listeners.filter(function (fn) {
      return fn !== callback;
    });
  };
}

export function getCachedTestimonials() {
  return cachedTestimonials.slice();
}

export function isTestimonialsSnapshotReady() {
  return snapshotReady;
}

export function findCachedTestimonial(id) {
  var key = String(id || '');
  if (!key) return null;
  for (var i = 0; i < cachedTestimonials.length; i++) {
    if (String(cachedTestimonials[i].id) === key) return cachedTestimonials[i];
  }
  return null;
}

export async function addTestimonial(payload) {
  var key = String((payload && payload.id) || '').trim();
  if (!key) {
    if (window.PlatformTestimonials && typeof window.PlatformTestimonials.uid === 'function') {
      key = window.PlatformTestimonials.uid();
    }
  }
  if (!key) throw new Error('معرّف الرأي غير صالح');
  if (findCachedTestimonial(key)) throw new Error('الرأي موجود مسبقاً');

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
    upsertCachedTestimonial(Object.assign({ id: key }, prepared));
    return key;
  } finally {
    endWrite();
  }
}

export async function updateTestimonial(id, payload) {
  var key = String(id || '').trim();
  if (!key) throw new Error('معرّف الرأي غير صالح');
  var existing = findCachedTestimonial(key);
  if (!existing) throw new Error('الرأي غير موجود');

  var now = new Date().toISOString();
  var prepared = preparePayload(Object.assign({}, payload, { updatedAt: now }), existing);
  prepared.updatedAt = now;
  if (existing.createdAt) prepared.createdAt = existing.createdAt;

  beginWrite();
  try {
    await updateDoc(doc(db, COLLECTION, key), prepared);
    needsSeed = false;
    cancelScheduledSeed();
    upsertCachedTestimonial(Object.assign({}, existing, prepared, { id: key }));
    return key;
  } finally {
    endWrite();
  }
}

export async function setTestimonialStatus(id, status) {
  var key = String(id || '').trim();
  if (!key) throw new Error('معرّف الرأي غير صالح');
  var existing = findCachedTestimonial(key);
  if (!existing) throw new Error('الرأي غير موجود');

  var nextStatus = normalizeStatusValue(status);
  var now = new Date().toISOString();
  var patch = { status: nextStatus, updatedAt: now };

  beginWrite();
  try {
    await updateDoc(doc(db, COLLECTION, key), patch);
    upsertCachedTestimonial(Object.assign({}, existing, patch, { id: key }));
    return key;
  } finally {
    endWrite();
  }
}

export async function deleteTestimonial(id) {
  return setTestimonialStatus(id, 'trash');
}

export async function restoreTestimonial(id) {
  return setTestimonialStatus(id, 'draft');
}

export async function purgeTestimonial(id) {
  var key = String(id || '').trim();
  if (!key) throw new Error('معرّف الرأي غير صالح');

  beginWrite();
  try {
    await deleteDoc(doc(db, COLLECTION, key));
    removeCachedTestimonial(key);
    return true;
  } finally {
    endWrite();
  }
}

export function startTestimonialsFirestoreSync() {
  if (unsubscribeSnapshot) return unsubscribeSnapshot;
  unsubscribeSnapshot = onSnapshot(
    collection(db, COLLECTION),
    handleSnapshot,
    function (err) {
      console.error('[PlatformTestimonialsFirestore] onSnapshot failed', err);
      if (!writesInFlight) {
        cachedTestimonials = [];
      }
      snapshotReady = true;
      notifyListeners();
    }
  );
  return unsubscribeSnapshot;
}

window.addEventListener('ifa:auth-changed', function (e) {
  var detail = (e && e.detail) || {};
  if (detail.profileSynced && needsSeed) scheduleSeedIfNeeded();
});

var api = {
  subscribe: subscribeTestimonials,
  getCachedTestimonials: getCachedTestimonials,
  isReady: isTestimonialsSnapshotReady,
  findTestimonial: findCachedTestimonial,
  addTestimonial: addTestimonial,
  updateTestimonial: updateTestimonial,
  setTestimonialStatus: setTestimonialStatus,
  deleteTestimonial: deleteTestimonial,
  restoreTestimonial: restoreTestimonial,
  purgeTestimonial: purgeTestimonial,
  restoreDefaultTestimonials: restoreDefaultTestimonials,
  start: startTestimonialsFirestoreSync,
};

window.PlatformTestimonialsFirestore = api;
hydrateTestimonialsFromLocalStorage();
scheduleLazyFirestoreSync(startTestimonialsFirestoreSync);

export default api;
