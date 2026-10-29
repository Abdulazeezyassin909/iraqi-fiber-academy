/**
 * Firestore real-time sync for public pricing plans (collection: `pricing`).
 * Deploy rules: firebase deploy --only firestore:rules
 */
import { db } from './firebase-config.js';
import { scheduleDeferredFirestoreSync } from './firestore-sync-scheduler.js';
import {
  collection,
  onSnapshot,
  setDoc,
  updateDoc,
  deleteDoc,
  doc,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

var COLLECTION = 'pricing';
var LEGACY_PLAN_IDS = { plan_free: true, plan_standard: true, plan_pro: true };
var LEGACY_PLAN_NAMES = {
  المجانية: true,
  القياسية: true,
  الاحترافية: true,
  Free: true,
  Standard: true,
  Pro: true,
};

function isLegacyPricingPlan(plan) {
  if (!plan) return false;
  if (window.PlatformPlans && typeof window.PlatformPlans.isLegacyTierPlan === 'function') {
    return window.PlatformPlans.isLegacyTierPlan(plan);
  }
  if (LEGACY_PLAN_IDS[String(plan.id || '')]) return true;
  if (LEGACY_PLAN_NAMES[String(plan.name || '').trim()]) return true;
  return false;
}

function stripLegacyPricingPlans(list) {
  return (list || []).filter(function (plan) {
    return plan && !isLegacyPricingPlan(plan);
  });
}
var PLANS_STORAGE_KEY = 'platform_plans';
var PLANS_LEGACY_KEY = 'ifa_pricing_plans';
var cachedPlans = [];
var snapshotReady = false;
var lastPersistedSignature = '';
var listeners = [];
var unsubscribeSnapshot = null;
var writesInFlight = 0;

function normalizePlan(raw, docId) {
  if (window.PlatformPlans && typeof window.PlatformPlans.normalizePlan === 'function') {
    return window.PlatformPlans.normalizePlan(Object.assign({}, raw, { id: docId || raw.id }));
  }
  return Object.assign({}, raw, { id: docId || raw.id || '' });
}

function sortPlans(list) {
  return (list || []).slice().sort(function (a, b) {
    return (a.sortOrder || 0) - (b.sortOrder || 0);
  });
}

function stripUndefined(obj) {
  var out = {};
  Object.keys(obj || {}).forEach(function (key) {
    if (obj[key] !== undefined) out[key] = obj[key];
  });
  return out;
}

function beginWrite() {
  writesInFlight += 1;
}

function endWrite() {
  writesInFlight = Math.max(0, writesInFlight - 1);
}

function preparePayload(payload, existing) {
  var base = Object.assign({}, existing || {}, payload || {});
  var normalized = normalizePlan(base, existing && existing.id);
  if (!normalized) throw new Error('بيانات الباقة غير صالحة');
  if (!normalized.name) throw new Error('اسم الباقة مطلوب');
  delete normalized.id;
  return stripUndefined(normalized);
}

function readStoredPlans() {
  try {
    var raw = localStorage.getItem(PLANS_STORAGE_KEY) || localStorage.getItem(PLANS_LEGACY_KEY);
    if (!raw) return [];
    var parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

function plansSignature(list) {
  return (list || [])
    .map(function (p) {
      return [p.id, p.updatedAt || '', p.name || '', p.price || 0, p.sortOrder || 0].join(':');
    })
    .join('|');
}

function persistPlansToLocalStorage(list) {
  try {
    var json = JSON.stringify(list);
    localStorage.setItem(PLANS_STORAGE_KEY, json);
    localStorage.setItem(PLANS_LEGACY_KEY, json);
    lastPersistedSignature = plansSignature(list);
  } catch (err) {
    console.warn('[PricingFirestore] localStorage persist failed', err);
  }
}

function maybePersistPlansFromCache() {
  var nextSig = plansSignature(cachedPlans);
  if (nextSig === lastPersistedSignature) return;
  persistPlansToLocalStorage(cachedPlans);
}

function hydratePlansFromLocalStorage() {
  var stored = readStoredPlans();
  if (!stored.length) return false;
  setCachedPlans(
    stored
      .map(function (item) {
        return normalizePlan(item, item.id);
      })
      .filter(function (plan) {
        return plan && !isLegacyPricingPlan(plan);
      })
  );
  lastPersistedSignature = plansSignature(cachedPlans);
  return true;
}

function setCachedPlans(list) {
  cachedPlans = sortPlans(list);
}

function upsertCachedPlan(item) {
  var normalized = normalizePlan(item, item && item.id);
  var key = String(normalized.id || '');
  if (!key) return;
  var next = cachedPlans.filter(function (entry) {
    return String(entry.id) !== key;
  });
  next.push(normalized);
  setCachedPlans(next);
  notifyListeners();
}

function removeCachedPlan(id) {
  var key = String(id || '');
  if (!key) return;
  setCachedPlans(
    cachedPlans.filter(function (entry) {
      return String(entry.id) !== key;
    })
  );
  notifyListeners();
}

function notifyListeners() {
  var plans = cachedPlans.slice();
  listeners.forEach(function (fn) {
    try {
      fn(plans);
    } catch (err) {
      console.error('[PricingFirestore] listener failed', err);
    }
  });
  try {
    var detail = { plans: plans, count: plans.length };
    window.dispatchEvent(new CustomEvent('ifa:pricing-firestore-changed', { detail: detail }));
    document.dispatchEvent(new CustomEvent('ifa:pricing-firestore-changed', { detail: detail }));
    window.dispatchEvent(new CustomEvent('ifa:platform-plans-changed', { detail: detail }));
    document.dispatchEvent(new CustomEvent('ifa:platform-plans-changed', { detail: detail }));
  } catch (err) {
    /* ignore */
  }
  if (typeof window.renderPublicPlans === 'function') {
    window.renderPublicPlans();
  }
}

function handleSnapshot(snap) {
  var plans = snap.docs.map(function (docSnap) {
    return normalizePlan(docSnap.data(), docSnap.id);
  });
  setCachedPlans(stripLegacyPricingPlans(plans));
  maybePersistPlansFromCache();
  snapshotReady = true;
  notifyListeners();
}

export function subscribePricingPlans(callback) {
  if (typeof callback === 'function') {
    listeners.push(callback);
    if (snapshotReady) callback(cachedPlans.slice());
  }
  return function () {
    listeners = listeners.filter(function (fn) {
      return fn !== callback;
    });
  };
}

export function getCachedPricingPlans() {
  return cachedPlans.slice();
}

export function isPricingSnapshotReady() {
  return snapshotReady;
}

export function isPricingSeeding() {
  return false;
}

export function findCachedPricingPlan(id) {
  var key = String(id || '');
  if (!key) return null;
  for (var i = 0; i < cachedPlans.length; i++) {
    if (String(cachedPlans[i].id) === key) return cachedPlans[i];
  }
  return null;
}

function newPlanId() {
  return 'plan_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
}

export async function upsertPricingPlan(id, payload) {
  var key = String(id || '').trim();
  if (!key) throw new Error('معرّف الباقة غير صالح');

  var existing = findCachedPricingPlan(key);
  var now = new Date().toISOString();
  var prepared = preparePayload(Object.assign({}, payload, { updatedAt: now }), existing);
  prepared.updatedAt = now;
  if (existing && existing.createdAt) {
    prepared.createdAt = existing.createdAt;
  } else {
    prepared.createdAt = now;
  }
  if (prepared.sortOrder == null && !isFinite(Number(prepared.sortOrder))) {
    prepared.sortOrder = existing ? existing.sortOrder : cachedPlans.length;
  }

  beginWrite();
  try {
    await setDoc(doc(db, COLLECTION, key), prepared, { merge: true });
    upsertCachedPlan(Object.assign({ id: key }, prepared));
    return key;
  } finally {
    endWrite();
  }
}

export async function addPricingPlan(payload) {
  var key = String((payload && payload.id) || '').trim();
  if (!key) key = newPlanId();
  if (findCachedPricingPlan(key)) throw new Error('الباقة موجودة مسبقاً');

  var now = new Date().toISOString();
  var prepared = preparePayload(
    Object.assign({}, payload, {
      planType: (payload && payload.planType) || 'bundle',
      sortOrder: isFinite(Number(payload && payload.sortOrder))
        ? Number(payload.sortOrder)
        : cachedPlans.length,
      createdAt: now,
      updatedAt: now,
    })
  );
  prepared.createdAt = now;
  prepared.updatedAt = now;

  beginWrite();
  try {
    await setDoc(doc(db, COLLECTION, key), prepared);
    upsertCachedPlan(Object.assign({ id: key }, prepared));
    return key;
  } finally {
    endWrite();
  }
}

export async function updatePricingPlan(id, payload) {
  var key = String(id || '').trim();
  if (!key) throw new Error('معرّف الباقة غير صالح');
  var existing = findCachedPricingPlan(key);
  if (!existing) throw new Error('الباقة غير موجودة');

  var now = new Date().toISOString();
  var prepared = preparePayload(
    Object.assign({}, payload, { updatedAt: now }),
    existing
  );
  prepared.updatedAt = now;
  if (existing.createdAt) prepared.createdAt = existing.createdAt;

  beginWrite();
  try {
    await updateDoc(doc(db, COLLECTION, key), prepared);
    upsertCachedPlan(Object.assign({}, existing, prepared, { id: key }));
    return key;
  } finally {
    endWrite();
  }
}

export async function deletePricingPlan(id) {
  var key = String(id || '').trim();
  if (!key) throw new Error('معرّف الباقة غير صالح');

  beginWrite();
  try {
    await deleteDoc(doc(db, COLLECTION, key));
    removeCachedPlan(key);
    return true;
  } finally {
    endWrite();
  }
}

export function startPricingFirestoreSync() {
  if (unsubscribeSnapshot) return unsubscribeSnapshot;
  unsubscribeSnapshot = onSnapshot(
    collection(db, COLLECTION),
    handleSnapshot,
    function (err) {
      console.error('[PricingFirestore] onSnapshot failed', err);
      if (!writesInFlight) {
        cachedPlans = [];
      }
      snapshotReady = true;
      notifyListeners();
    }
  );
  return unsubscribeSnapshot;
}

var api = {
  subscribe: subscribePricingPlans,
  getCachedPlans: getCachedPricingPlans,
  isReady: isPricingSnapshotReady,
  isSeeding: isPricingSeeding,
  findPlan: findCachedPricingPlan,
  upsertPlan: upsertPricingPlan,
  addPlan: addPricingPlan,
  updatePlan: updatePricingPlan,
  deletePlan: deletePricingPlan,
  start: startPricingFirestoreSync,
};

window.PlatformPricingFirestore = api;
if (hydratePlansFromLocalStorage() && cachedPlans.length) {
  notifyListeners();
}
scheduleDeferredFirestoreSync(startPricingFirestoreSync);

export default api;
