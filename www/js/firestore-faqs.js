/**
 * Firestore real-time sync for FAQ accordion (collection: `faqs`).
 * Deploy rules: firebase deploy --only firestore:rules
 */
import { db } from './firebase-config.js';
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
import { scheduleDeferredFirestoreSync, hydrateListFromLocalStorage } from './firestore-sync-scheduler.js';

var COLLECTION = 'faqs';
var FAQS_STORAGE_KEY = 'ifa_platform_faqs';
var cachedFaqs = [];
var snapshotReady = false;
var listeners = [];
var unsubscribeSnapshot = null;
var seedInFlight = false;
var needsSeed = false;
var writesInFlight = 0;
var seedTimer = null;
var SEED_DELAY_MS = 500;

function normalizeFaq(raw, docId) {
  if (window.PlatformFaqs && typeof window.PlatformFaqs.normalizeFaq === 'function') {
    return window.PlatformFaqs.normalizeFaq(Object.assign({}, raw || {}, { id: docId || raw.id }));
  }
  return Object.assign({}, raw || {}, { id: docId || (raw && raw.id) || '' });
}

function sortFaqs(list) {
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

function nextSortOrder() {
  var active = activeCachedFaqs();
  if (!active.length) return 0;
  var max = 0;
  active.forEach(function (faq) {
    var value = Number(faq.sortOrder);
    if (isFinite(value) && value > max) max = value;
  });
  return max + 1;
}

function normalizeStatusValue(value) {
  return normalizeCmsStatus(value);
}

function activeCachedFaqs() {
  return cachedFaqs.filter(function (faq) {
    return normalizeCmsStatus(faq.status) !== 'trash';
  });
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
  return !seedInFlight && writesInFlight === 0 && cachedFaqs.length === 0;
}

function canCommitSeed(existingDocCount) {
  return cachedFaqs.length === 0 && Number(existingDocCount || 0) === 0;
}

function preparePayload(payload, existing) {
  var base = Object.assign({}, existing || {}, payload || {});
  var normalized = normalizeFaq(base, existing && existing.id);
  if (!normalized.question) throw new Error('نص السؤال مطلوب');
  if (!normalized.answer) throw new Error('نص الإجابة مطلوب');
  var out = {
    question: normalized.question,
    answer: normalized.answer,
    status: normalized.status,
    sortOrder: isFinite(Number(normalized.sortOrder)) ? Number(normalized.sortOrder) : nextSortOrder(),
  };
  if (existing && existing.createdAt) out.createdAt = existing.createdAt;
  if (payload && payload.createdAt && !out.createdAt) out.createdAt = payload.createdAt;
  if (payload && payload.updatedAt) out.updatedAt = payload.updatedAt;
  return stripUndefined(out);
}

function setCachedFaqs(list) {
  cachedFaqs = sortFaqs(list);
}

function persistFaqsToLocalStorage() {
  try {
    localStorage.setItem(FAQS_STORAGE_KEY, JSON.stringify(cachedFaqs));
  } catch (err) {
    /* ignore */
  }
}

function hydrateFaqsFromLocalStorage() {
  return hydrateListFromLocalStorage(
    FAQS_STORAGE_KEY,
    normalizeFaq,
    function (list) {
      setCachedFaqs(list);
    },
    notifyListeners
  );
}

function upsertCachedFaq(faq) {
  var normalized = normalizeFaq(faq, faq && faq.id);
  var key = String(normalized.id || '');
  if (!key) return;
  var next = cachedFaqs.filter(function (item) {
    return String(item.id) !== key;
  });
  next.push(normalized);
  setCachedFaqs(next);
  notifyListeners();
}

function removeCachedFaq(id) {
  var key = String(id || '');
  if (!key) return;
  setCachedFaqs(
    cachedFaqs.filter(function (item) {
      return String(item.id) !== key;
    })
  );
  notifyListeners();
}

function notifyListeners() {
  var faqs = cachedFaqs.slice();
  listeners.forEach(function (fn) {
    try {
      fn(faqs);
    } catch (err) {
      console.error('[PlatformFaqsFirestore] listener failed', err);
    }
  });
  try {
    var detail = { faqs: faqs, count: faqs.length };
    window.dispatchEvent(new CustomEvent('ifa:faqs-firestore-changed', { detail: detail }));
    document.dispatchEvent(new CustomEvent('ifa:faqs-firestore-changed', { detail: detail }));
    window.dispatchEvent(new CustomEvent('ifa:platform-faqs-changed', { detail: detail }));
    document.dispatchEvent(new CustomEvent('ifa:platform-faqs-changed', { detail: detail }));
  } catch (err) {
    /* ignore */
  }
  if (window.PlatformFaqs && typeof window.PlatformFaqs.renderPublic === 'function') {
    window.PlatformFaqs.renderPublic();
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
    seedDefaultFaqs();
  }, SEED_DELAY_MS);
}

async function seedDefaultFaqs() {
  if (seedInFlight) return;
  if (!needsSeed || !canAutoSeedFirestore()) return;
  if (!canStartSeed()) {
    scheduleSeedIfNeeded();
    return;
  }
  if (!window.PlatformFaqs || typeof window.PlatformFaqs.defaultFaqs !== 'function') return;

  seedInFlight = true;
  beginWrite();
  try {
    var existingSnap = await getDocs(collection(db, COLLECTION));
    if (!canCommitSeed(existingSnap.docs.length)) {
      needsSeed = false;
      return;
    }

    var defaults = window.PlatformFaqs.defaultFaqs();
    if (!defaults.length) return;

    var now = new Date().toISOString();
    var batch = writeBatch(db);
    defaults.forEach(function (faq, index) {
      var prepared = preparePayload(
        Object.assign({}, faq, {
          sortOrder: index,
          createdAt: now,
          updatedAt: now,
        }),
        null
      );
      prepared.createdAt = now;
      prepared.updatedAt = now;
      batch.set(doc(db, COLLECTION, String(faq.id)), prepared);
    });
    await batch.commit();
    needsSeed = false;
  } catch (err) {
    console.warn('[PlatformFaqsFirestore] auto-seed failed:', err);
  } finally {
    seedInFlight = false;
    endWrite();
  }
}

function handleSnapshot(snap) {
  if (!snap.docs.length) {
    if (cachedFaqs.length > 0 || writesInFlight > 0) {
      needsSeed = false;
      snapshotReady = true;
      return;
    }
    needsSeed = true;
    cachedFaqs = [];
    snapshotReady = true;
    notifyListeners();
    scheduleSeedIfNeeded();
    return;
  }

  needsSeed = false;
  cancelScheduledSeed();
  setCachedFaqs(
    snap.docs.map(function (docSnap) {
      return normalizeFaq(docSnap.data(), docSnap.id);
    })
  );
  persistFaqsToLocalStorage();
  snapshotReady = true;
  notifyListeners();
}

export function subscribeFaqs(callback) {
  if (typeof callback === 'function') {
    listeners.push(callback);
    if (snapshotReady) callback(cachedFaqs.slice());
  }
  return function () {
    listeners = listeners.filter(function (fn) {
      return fn !== callback;
    });
  };
}

export function getCachedFaqs() {
  return cachedFaqs.slice();
}

export function isFaqsSnapshotReady() {
  return snapshotReady;
}

export function findCachedFaq(id) {
  var key = String(id || '');
  if (!key) return null;
  for (var i = 0; i < cachedFaqs.length; i++) {
    if (String(cachedFaqs[i].id) === key) return cachedFaqs[i];
  }
  return null;
}

export async function addFaq(payload) {
  var key = String((payload && payload.id) || '').trim();
  if (!key) {
    if (window.PlatformFaqs && typeof window.PlatformFaqs.uid === 'function') {
      key = window.PlatformFaqs.uid();
    }
  }
  if (!key) throw new Error('معرّف السؤال غير صالح');
  if (findCachedFaq(key)) throw new Error('السؤال موجود مسبقاً');

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
    upsertCachedFaq(Object.assign({ id: key }, prepared));
    return key;
  } finally {
    endWrite();
  }
}

export async function updateFaq(id, payload) {
  var key = String(id || '').trim();
  if (!key) throw new Error('معرّف السؤال غير صالح');
  var existing = findCachedFaq(key);
  if (!existing) throw new Error('السؤال غير موجود');

  var now = new Date().toISOString();
  var prepared = preparePayload(Object.assign({}, payload, { updatedAt: now }), existing);
  prepared.updatedAt = now;
  if (existing.createdAt) prepared.createdAt = existing.createdAt;

  beginWrite();
  try {
    await updateDoc(doc(db, COLLECTION, key), prepared);
    needsSeed = false;
    cancelScheduledSeed();
    upsertCachedFaq(Object.assign({}, existing, prepared, { id: key }));
    return key;
  } finally {
    endWrite();
  }
}

export async function setFaqStatus(id, status) {
  var key = String(id || '').trim();
  if (!key) throw new Error('معرّف السؤال غير صالح');
  var existing = findCachedFaq(key);
  if (!existing) throw new Error('السؤال غير موجود');

  var nextStatus = normalizeStatusValue(status);
  var now = new Date().toISOString();
  var patch = { status: nextStatus, updatedAt: now };

  beginWrite();
  try {
    await updateDoc(doc(db, COLLECTION, key), patch);
    upsertCachedFaq(Object.assign({}, existing, patch, { id: key }));
    return key;
  } finally {
    endWrite();
  }
}

export async function deleteFaq(id) {
  return setFaqStatus(id, 'trash');
}

export async function restoreFaq(id) {
  return setFaqStatus(id, 'draft');
}

export async function purgeFaq(id) {
  var key = String(id || '').trim();
  if (!key) throw new Error('معرّف السؤال غير صالح');

  beginWrite();
  try {
    await deleteDoc(doc(db, COLLECTION, key));
    removeCachedFaq(key);
    return true;
  } finally {
    endWrite();
  }
}

export async function moveFaq(index, direction) {
  var list = activeCachedFaqs().slice();
  var from = Number(index);
  var dir = Number(direction);
  if (!isFinite(from) || !isFinite(dir)) throw new Error('ترتيب غير صالح');
  var to = from + dir;
  if (to < 0 || to >= list.length) return false;

  var a = list[from];
  var b = list[to];
  if (!a || !b) throw new Error('السؤال غير موجود');

  var sortA = isFinite(Number(a.sortOrder)) ? Number(a.sortOrder) : from;
  var sortB = isFinite(Number(b.sortOrder)) ? Number(b.sortOrder) : to;
  var now = new Date().toISOString();

  beginWrite();
  try {
    await Promise.all([
      updateDoc(doc(db, COLLECTION, String(a.id)), { sortOrder: sortB, updatedAt: now }),
      updateDoc(doc(db, COLLECTION, String(b.id)), { sortOrder: sortA, updatedAt: now }),
    ]);
    upsertCachedFaq(Object.assign({}, a, { sortOrder: sortB, updatedAt: now }));
    upsertCachedFaq(Object.assign({}, b, { sortOrder: sortA, updatedAt: now }));
    return true;
  } finally {
    endWrite();
  }
}

export function startFaqsFirestoreSync() {
  if (unsubscribeSnapshot) return unsubscribeSnapshot;
  unsubscribeSnapshot = onSnapshot(
    collection(db, COLLECTION),
    handleSnapshot,
    function (err) {
      console.error('[PlatformFaqsFirestore] onSnapshot failed', err);
      if (!writesInFlight) {
        cachedFaqs = [];
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
  subscribe: subscribeFaqs,
  getCachedFaqs: getCachedFaqs,
  isReady: isFaqsSnapshotReady,
  findFaq: findCachedFaq,
  addFaq: addFaq,
  updateFaq: updateFaq,
  setFaqStatus: setFaqStatus,
  deleteFaq: deleteFaq,
  restoreFaq: restoreFaq,
  purgeFaq: purgeFaq,
  moveFaq: moveFaq,
  start: startFaqsFirestoreSync,
};

window.PlatformFaqsFirestore = api;
hydrateFaqsFromLocalStorage();
scheduleDeferredFirestoreSync(startFaqsFirestoreSync);

export default api;
