/**
 * Firestore real-time sync for technical articles (collection: `articles`).
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
import { scheduleDeferredFirestoreSync, hydrateListFromLocalStorage } from './firestore-sync-scheduler.js';

var COLLECTION = 'articles';
var ARTICLES_STORAGE_KEY = 'ifa_platform_articles';
var cachedArticles = [];
var snapshotReady = false;
var listeners = [];
var unsubscribeSnapshot = null;
var seedInFlight = false;
var needsSeed = false;
var writesInFlight = 0;
var seedTimer = null;
var SEED_DELAY_MS = 500;

function normalizeArticle(raw, docId) {
  if (window.PlatformArticles && typeof window.PlatformArticles.normalizeArticle === 'function') {
    return window.PlatformArticles.normalizeArticle(Object.assign({}, raw || {}, { id: docId || raw.id }));
  }
  return Object.assign({}, raw || {}, { id: docId || (raw && raw.id) || '' });
}

function sortArticles(list) {
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

function activeCachedArticles() {
  return cachedArticles.filter(function (item) {
    return normalizeCmsStatus(item.status) !== 'trash';
  });
}

function nextSortOrder() {
  var active = activeCachedArticles();
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
  return !seedInFlight && writesInFlight === 0 && cachedArticles.length === 0;
}

function canCommitSeed(existingDocCount) {
  return cachedArticles.length === 0 && Number(existingDocCount || 0) === 0;
}

function sanitizeImage(value) {
  var image = String(value == null ? '' : value).trim();
  if (image && rejectDataUrl(image)) {
    throw new Error('صورة المقال يجب رفعها إلى التخزين — لا يُسمح بحفظ base64 في Firestore.');
  }
  return image;
}

function preparePayload(payload, existing) {
  var base = Object.assign({}, existing || {}, payload || {});
  var normalized = normalizeArticle(base, existing && existing.id);
  if (!normalized.title) throw new Error('عنوان المقال مطلوب');
  var out = {
    title: normalized.title,
    category: normalized.category,
    tags: normalized.tags,
    image: sanitizeImage(normalized.image),
    excerpt: normalized.excerpt,
    body: normalized.body,
    fontFamily: normalized.fontFamily,
    fontSize: normalized.fontSize,
    textColor: normalized.textColor,
    meta: normalized.meta,
    status: normalized.status,
    sortOrder: isFinite(Number(normalized.sortOrder)) ? Number(normalized.sortOrder) : nextSortOrder(),
  };
  if (existing && existing.createdAt) out.createdAt = existing.createdAt;
  if (payload && payload.createdAt && !out.createdAt) out.createdAt = payload.createdAt;
  if (payload && payload.updatedAt) out.updatedAt = payload.updatedAt;
  return stripUndefined(out);
}

function setCachedArticles(list) {
  cachedArticles = sortArticles(list);
}

function persistArticlesToLocalStorage() {
  try {
    localStorage.setItem(ARTICLES_STORAGE_KEY, JSON.stringify(cachedArticles));
  } catch (err) {
    /* ignore */
  }
}

function hydrateArticlesFromLocalStorage() {
  return hydrateListFromLocalStorage(
    ARTICLES_STORAGE_KEY,
    normalizeArticle,
    function (list) {
      setCachedArticles(list);
    },
    notifyListeners
  );
}

function upsertCachedArticle(item) {
  var normalized = normalizeArticle(item, item && item.id);
  var key = String(normalized.id || '');
  if (!key) return;
  var next = cachedArticles.filter(function (entry) {
    return String(entry.id) !== key;
  });
  next.push(normalized);
  setCachedArticles(next);
  notifyListeners();
}

function removeCachedArticle(id) {
  var key = String(id || '');
  if (!key) return;
  setCachedArticles(
    cachedArticles.filter(function (entry) {
      return String(entry.id) !== key;
    })
  );
  notifyListeners();
}

function notifyListeners() {
  var articles = cachedArticles.slice();
  listeners.forEach(function (fn) {
    try {
      fn(articles);
    } catch (err) {
      console.error('[PlatformArticlesFirestore] listener failed', err);
    }
  });
  try {
    var detail = { articles: articles, count: articles.length };
    window.dispatchEvent(new CustomEvent('ifa:articles-firestore-changed', { detail: detail }));
    document.dispatchEvent(new CustomEvent('ifa:articles-firestore-changed', { detail: detail }));
    window.dispatchEvent(new CustomEvent('ifa:platform-articles-changed', { detail: detail }));
    document.dispatchEvent(new CustomEvent('ifa:platform-articles-changed', { detail: detail }));
  } catch (err) {
    /* ignore */
  }
  if (window.PlatformArticles && typeof window.PlatformArticles.renderPublic === 'function') {
    window.PlatformArticles.renderPublic();
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
      seedDefaultArticles();
      return;
    }
    scheduleSeedIfNeeded();
  }, SEED_DELAY_MS);
}

function getDefaultArticleItems() {
  if (!window.PlatformArticles || typeof window.PlatformArticles.defaultArticles !== 'function') {
    return [];
  }
  return window.PlatformArticles.defaultArticles();
}

function waitForDefaultArticlesSource(callback, attempts) {
  var tries = attempts || 0;
  if (window.PlatformArticles && typeof window.PlatformArticles.defaultArticles === 'function') {
    callback();
    return;
  }
  if (tries > 40) return;
  setTimeout(function () {
    waitForDefaultArticlesSource(callback, tries + 1);
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

async function writeDefaultArticles(items) {
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
    upsertCachedArticle(Object.assign({ id: entry.id }, entry.prepared));
  });

  needsSeed = false;
  cancelScheduledSeed();
  return preparedItems.length;
}

async function seedDefaultArticles() {
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

  if (!window.PlatformArticles || typeof window.PlatformArticles.defaultArticles !== 'function') {
    waitForDefaultArticlesSource(function () {
      if (needsSeed) scheduleSeedIfNeeded();
    });
    return;
  }

  var defaults = getDefaultArticleItems();
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
    await writeDefaultArticles(defaults);
    needsSeed = false;
  } catch (err) {
    console.warn('[PlatformArticlesFirestore] auto-seed failed:', err);
    needsSeed = true;
    scheduleSeedIfNeeded();
  } finally {
    seedInFlight = false;
    endWrite();
  }
}

function handleSnapshot(snap) {
  if (!snap.docs.length) {
    if (cachedArticles.length > 0) {
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
    cachedArticles = [];
    snapshotReady = true;
    notifyListeners();
    scheduleSeedIfNeeded();
    return;
  }

  needsSeed = false;
  cancelScheduledSeed();
  setCachedArticles(
    snap.docs.map(function (docSnap) {
      return normalizeArticle(docSnap.data(), docSnap.id);
    })
  );
  persistArticlesToLocalStorage();
  snapshotReady = true;
  notifyListeners();
}

export function subscribeArticles(callback) {
  if (typeof callback === 'function') {
    listeners.push(callback);
    if (snapshotReady) callback(cachedArticles.slice());
  }
  return function () {
    listeners = listeners.filter(function (fn) {
      return fn !== callback;
    });
  };
}

export function getCachedArticles() {
  return cachedArticles.slice();
}

export function isArticlesSnapshotReady() {
  return snapshotReady;
}

export function isArticlesSeeding() {
  return needsSeed || seedInFlight;
}

export function findCachedArticle(id) {
  var key = String(id || '');
  if (!key) return null;
  for (var i = 0; i < cachedArticles.length; i++) {
    if (String(cachedArticles[i].id) === key) return cachedArticles[i];
  }
  return null;
}

export async function addArticle(payload) {
  var key = String((payload && payload.id) || '').trim();
  if (!key) {
    if (window.PlatformArticles && typeof window.PlatformArticles.uid === 'function') {
      key = window.PlatformArticles.uid();
    }
  }
  if (!key) throw new Error('معرّف المقال غير صالح');
  if (findCachedArticle(key)) throw new Error('المقال موجود مسبقاً');

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
    upsertCachedArticle(Object.assign({ id: key }, prepared));
    return key;
  } finally {
    endWrite();
  }
}

export async function updateArticle(id, payload) {
  var key = String(id || '').trim();
  if (!key) throw new Error('معرّف المقال غير صالح');
  var existing = findCachedArticle(key);
  if (!existing) throw new Error('المقال غير موجود');

  var now = new Date().toISOString();
  var prepared = preparePayload(Object.assign({}, payload, { updatedAt: now }), existing);
  prepared.updatedAt = now;
  if (existing.createdAt) prepared.createdAt = existing.createdAt;

  beginWrite();
  try {
    await updateDoc(doc(db, COLLECTION, key), prepared);
    needsSeed = false;
    cancelScheduledSeed();
    upsertCachedArticle(Object.assign({}, existing, prepared, { id: key }));
    return key;
  } finally {
    endWrite();
  }
}

export async function setArticleStatus(id, status) {
  var key = String(id || '').trim();
  if (!key) throw new Error('معرّف المقال غير صالح');
  var existing = findCachedArticle(key);
  if (!existing) throw new Error('المقال غير موجود');

  var nextStatus = normalizeStatusValue(status);
  var now = new Date().toISOString();
  var patch = { status: nextStatus, updatedAt: now };

  beginWrite();
  try {
    await updateDoc(doc(db, COLLECTION, key), patch);
    upsertCachedArticle(Object.assign({}, existing, patch, { id: key }));
    return key;
  } finally {
    endWrite();
  }
}

export async function deleteArticle(id) {
  return setArticleStatus(id, 'trash');
}

export async function restoreArticle(id) {
  return setArticleStatus(id, 'draft');
}

export async function purgeArticle(id) {
  var key = String(id || '').trim();
  if (!key) throw new Error('معرّف المقال غير صالح');

  beginWrite();
  try {
    await deleteDoc(doc(db, COLLECTION, key));
    removeCachedArticle(key);
    return true;
  } finally {
    endWrite();
  }
}

export function startArticlesFirestoreSync() {
  if (unsubscribeSnapshot) return unsubscribeSnapshot;
  unsubscribeSnapshot = onSnapshot(
    collection(db, COLLECTION),
    handleSnapshot,
    function (err) {
      console.error('[PlatformArticlesFirestore] onSnapshot failed', err);
      if (!writesInFlight) {
        cachedArticles = [];
      }
      snapshotReady = true;
      notifyListeners();
    }
  );
  return unsubscribeSnapshot;
}

function bootstrapArticlesAutoSeed() {
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
  subscribe: subscribeArticles,
  getCachedArticles: getCachedArticles,
  isReady: isArticlesSnapshotReady,
  isSeeding: isArticlesSeeding,
  findArticle: findCachedArticle,
  addArticle: addArticle,
  updateArticle: updateArticle,
  setArticleStatus: setArticleStatus,
  deleteArticle: deleteArticle,
  restoreArticle: restoreArticle,
  purgeArticle: purgeArticle,
  start: startArticlesFirestoreSync,
};

window.PlatformArticlesFirestore = api;
hydrateArticlesFromLocalStorage();
scheduleDeferredFirestoreSync(function () {
  startArticlesFirestoreSync();
  bootstrapArticlesAutoSeed();
});

export default api;
