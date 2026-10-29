/**
 * Admin users directory + archive (localStorage).
 * Keys: ifa_admin_users, ifa_admin_users_archive
 */
(function (global) {
  'use strict';

  var USERS_KEY = 'ifa_admin_users';
  var ARCHIVE_KEY = 'ifa_admin_users_archive';
  var SEED_VERSION_KEY = 'ifa_admin_users_seed_version';
  /* Bump to force-reset mock data for all browsers with old rows. */
  var SEED_VERSION = '4';

  var ROLE_LABELS = {
    student: 'طالب',
    instructor: 'مدرب',
    admin: 'مسؤول',
  };

  var STATUS_LABELS = {
    active: 'نشط',
    suspended: 'موقوف',
    pending: 'قيد المراجعة',
    expired: 'منتهي',
  };

  var SUBSCRIPTION_LABELS = {
    trial: 'فترة تجريبية',
    subscriber: 'مشترك نشط',
    expired: 'منتهي',
  };

  var DEFAULT_FREE_TRIAL_DAYS = 7;

  var firestoreUsers = [];
  var firestoreReady = false;

  function storageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (err) {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (err) {
      console.error('[AdminUsers] localStorage set failed:', key, err);
    }
  }

  function readJson(key, fallback) {
    try {
      var raw = storageGet(key);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch (err) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    storageSet(key, JSON.stringify(value));
  }

  function uid() {
    return 'usr_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  function timestampToIso(value) {
    if (value == null || value === '') return '';
    try {
      if (value && typeof value.toDate === 'function') {
        return value.toDate().toISOString();
      }
      if (typeof value === 'number' && isFinite(value)) {
        return new Date(value).toISOString();
      }
      var d = new Date(value);
      if (!isNaN(d.getTime())) return d.toISOString();
    } catch (err) {
      /* ignore */
    }
    return String(value);
  }

  function trialExpiryMs(value) {
    if (value == null || value === '') return 0;
    if (typeof value === 'number' && isFinite(value)) return value;
    if (value && typeof value.toDate === 'function') return value.toDate().getTime();
    var parsed = Date.parse(value);
    return isNaN(parsed) ? 0 : parsed;
  }

  function getFreeTrialDays() {
    try {
      var raw = storageGet('ifa_platform_settings');
      if (!raw) return DEFAULT_FREE_TRIAL_DAYS;
      var parsed = JSON.parse(raw);
      var days = Number(parsed && parsed.freeTrialDays);
      if (isFinite(days) && days > 0) return Math.min(365, days);
    } catch (err) {
      /* ignore */
    }
    return DEFAULT_FREE_TRIAL_DAYS;
  }

  function normalizeFirestoreRole(data) {
    data = data || {};
    if (data.isAdmin === true || String(data.role || '').toLowerCase() === 'admin') return 'admin';
    if (String(data.role || '').toLowerCase() === 'instructor') return 'instructor';
    if (String(data.role || '').toLowerCase() === 'student') return 'student';
    return 'student';
  }

  function mapFirestoreRow(row) {
    var data = row || {};
    var id = String(data.id || data.uid || '').trim();
    var role = normalizeFirestoreRole(data);
    var statusRaw = String(data.status || '').toLowerCase();
    var status =
      statusRaw === 'suspended' || statusRaw === 'pending' || statusRaw === 'expired'
        ? statusRaw
        : 'active';
    return {
      id: id,
      uid: String(data.uid || id),
      name: String(data.name || data.displayName || '').trim() || '—',
      email: normalizeEmail(data.email),
      role: role,
      status: status,
      createdAt: timestampToIso(data.createdAt),
      isSubscriber: data.isSubscriber === true,
      trialExpiresAt: trialExpiryMs(data.trialExpiresAt) || data.trialExpiresAt || 0,
      subscriptionEndsAt: timestampToIso(data.subscriptionEndsAt || data.subscriptionEndAt) || null,
      planId: String(data.planId || ''),
      enrolledCourseIds: Array.isArray(data.enrolledCourseIds) ? data.enrolledCourseIds : [],
      source: 'firestore',
    };
  }

  function ingestFirestoreUsers(rows) {
    firestoreReady = true;
    firestoreUsers = (rows || [])
      .map(mapFirestoreRow)
      .filter(function (u) {
        return !!u.id;
      })
      .map(function (u) {
        var access = resolveUserAccess(u);
        if (u.status !== 'suspended' && u.status !== 'pending') {
          u.status = access.status;
        }
        u.subscriptionDisplay = access.subscriptionLabel;
        return u;
      });
  }

  function clearFirestoreUsers() {
    firestoreReady = false;
    firestoreUsers = [];
  }

  function createdAtMs(user) {
    if (!user || !user.createdAt) return 0;
    var ms = Date.parse(user.createdAt);
    return isNaN(ms) ? 0 : ms;
  }

  function getTrialEndMs(user) {
    if (!user) return 0;
    var stored = trialExpiryMs(user.trialExpiresAt);
    if (stored > 0) return stored;
    var start = createdAtMs(user);
    if (!start) return 0;
    return start + getFreeTrialDays() * 24 * 60 * 60 * 1000;
  }

  /**
   * Subscription + account status for admin table (Firestore-aware).
   * @returns {{ status: string, subscriptionKey: string, subscriptionLabel: string }}
   */
  function resolveUserAccess(user) {
    if (!user) {
      return { status: 'active', subscriptionKey: 'expired', subscriptionLabel: '—' };
    }
    if (user.status === 'suspended') {
      return {
        status: 'suspended',
        subscriptionKey: 'expired',
        subscriptionLabel: SUBSCRIPTION_LABELS.expired,
      };
    }
    if (user.role !== 'student' && user.role !== 'instructor') {
      return {
        status: user.status === 'pending' ? 'pending' : 'active',
        subscriptionKey: 'subscriber',
        subscriptionLabel: '—',
      };
    }
    if (user.isSubscriber === true) {
      var subLabel = user.subscriptionEndsAt
        ? formatDate(user.subscriptionEndsAt)
        : SUBSCRIPTION_LABELS.subscriber;
      return {
        status: 'active',
        subscriptionKey: 'subscriber',
        subscriptionLabel: subLabel,
      };
    }
    var trialEnd = getTrialEndMs(user);
    if (trialEnd > Date.now()) {
      return {
        status: 'active',
        subscriptionKey: 'trial',
        subscriptionLabel: SUBSCRIPTION_LABELS.trial,
      };
    }
    return {
      status: 'expired',
      subscriptionKey: 'expired',
      subscriptionLabel: SUBSCRIPTION_LABELS.expired,
    };
  }

  function getDisplayStatus(user) {
    return resolveUserAccess(user).status;
  }

  function getSubscriptionLabel(user) {
    return resolveUserAccess(user).subscriptionLabel;
  }

  function subscriptionLabel(key) {
    return SUBSCRIPTION_LABELS[key] || key || '—';
  }

  function seedUsers() {
    return [];
  }

  function ensureSeeded() {
    var version = storageGet(SEED_VERSION_KEY);
    if (version !== SEED_VERSION) {
      writeJson(USERS_KEY, seedUsers());
      writeJson(ARCHIVE_KEY, []);
      storageSet(SEED_VERSION_KEY, SEED_VERSION);
      return;
    }
    /* Do not re-seed when the list is empty — deletion must persist. */
    if (!Array.isArray(readJson(USERS_KEY, null))) {
      writeJson(USERS_KEY, []);
    }
    if (!Array.isArray(readJson(ARCHIVE_KEY, null))) {
      writeJson(ARCHIVE_KEY, []);
    }
  }

  function getUsers() {
    ensureSeeded();
    var list = readJson(USERS_KEY, []);
    return Array.isArray(list) ? list : [];
  }

  function saveUsers(list) {
    writeJson(USERS_KEY, list);
  }

  function getArchivedUsers() {
    ensureSeeded();
    var list = readJson(ARCHIVE_KEY, []);
    return Array.isArray(list) ? list : [];
  }

  function saveArchivedUsers(list) {
    writeJson(ARCHIVE_KEY, list);
  }

  function findUser(id) {
    var list = getActiveUsers();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  function findUserByEmail(email) {
    var key = normalizeEmail(email);
    if (!key) return null;
    var list = getActiveUsers();
    for (var i = 0; i < list.length; i++) {
      if (normalizeEmail(list[i].email) === key) return list[i];
    }
    return null;
  }

  function refreshExpiredStatuses(list) {
    var now = Date.now();
    var changed = false;
    list.forEach(function (user) {
      if (
        user.role === 'student' &&
        user.status === 'active' &&
        user.subscriptionEndsAt &&
        new Date(user.subscriptionEndsAt).getTime() < now
      ) {
        user.status = 'expired';
        changed = true;
      }
    });
    return changed;
  }

  function getActiveUsers() {
    if (firestoreReady) return firestoreUsers.slice();
    var list = getUsers();
    if (refreshExpiredStatuses(list)) saveUsers(list);
    return list;
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function formatDate(iso) {
    if (!iso) return '—';
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return '—';
      return d.getFullYear() + '/' + pad2(d.getMonth() + 1) + '/' + pad2(d.getDate());
    } catch (err) {
      return String(iso);
    }
  }

  function roleLabel(role) {
    return ROLE_LABELS[role] || role || '—';
  }

  function statusLabel(status) {
    return STATUS_LABELS[status] || status || '—';
  }

  function addUser(payload) {
    var name = String((payload && payload.name) || '').trim();
    var email = normalizeEmail(payload && payload.email);
    var role = (payload && payload.role) || 'student';
    if (!name) throw new Error('الاسم مطلوب');
    if (!email) throw new Error('البريد مطلوب');

    var exists = getUsers().some(function (u) {
      return normalizeEmail(u.email) === email;
    });
    if (exists) throw new Error('البريد مستخدم مسبقاً');

    var user = {
      id: uid(),
      name: name,
      email: email,
      role: role,
      status: (payload && payload.status) || 'active',
      createdAt: new Date().toISOString(),
      subscriptionEndsAt:
        role === 'student'
          ? (payload && payload.subscriptionEndsAt) ||
            new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString()
          : null,
      planId: String((payload && payload.planId) || ''),
      enrolledCourseIds: Array.isArray(payload && payload.enrolledCourseIds)
        ? payload.enrolledCourseIds
        : [],
      trialExpiresAt: (function () {
        if (payload && payload.trialExpiresAt) return Number(payload.trialExpiresAt) || Date.parse(payload.trialExpiresAt) || 0;
        if (role !== 'student') return 0;
        try {
          var raw = localStorage.getItem('ifa_platform_settings');
          var days = raw ? Number(JSON.parse(raw).freeTrialDays) : 0;
          if (isFinite(days) && days > 0) return Date.now() + days * 24 * 60 * 60 * 1000;
        } catch (err) {
          /* ignore */
        }
        return 0;
      })(),
    };
    var list = getUsers();
    list.unshift(user);
    saveUsers(list);
    return user;
  }

  function updateUser(id, patch) {
    var list = getUsers();
    var found = null;
    list = list.map(function (u) {
      if (u.id !== id) return u;
      found = Object.assign({}, u, patch || {}, { id: u.id });
      if (found.email) found.email = normalizeEmail(found.email);
      return found;
    });
    if (!found) throw new Error('المستخدم غير موجود');
    saveUsers(list);
    return found;
  }

  function setUserStatus(id, status) {
    return updateUser(id, { status: status });
  }

  function toggleSuspend(id) {
    var user = findUser(id);
    if (!user) throw new Error('المستخدم غير موجود');
    if (user.status === 'suspended') {
      var next = user.role === 'student' && isSubscriptionEnded(user) ? 'expired' : 'active';
      return setUserStatus(id, next);
    }
    return setUserStatus(id, 'suspended');
  }

  function isSubscriptionEnded(user) {
    if (!user) return false;
    if (user.isSubscriber === true) {
      if (!user.subscriptionEndsAt) return false;
      return new Date(user.subscriptionEndsAt).getTime() < Date.now();
    }
    if (user.status === 'suspended') return false;
    return getTrialEndMs(user) <= Date.now();
  }

  function renewSubscription(id, days) {
    var addDays = typeof days === 'number' && days > 0 ? days : 90;
    var ends = new Date(Date.now() + addDays * 24 * 60 * 60 * 1000).toISOString();
    return updateUser(id, {
      subscriptionEndsAt: ends,
      status: 'active',
    });
  }

  function archiveUsers(ids) {
    var idSet = {};
    (ids || []).forEach(function (id) {
      idSet[id] = true;
    });
    var list = getUsers();
    var archive = getArchivedUsers();
    var kept = [];
    var moved = [];
    list.forEach(function (user) {
      if (idSet[user.id]) {
        var copy = Object.assign({}, user, { archivedAt: new Date().toISOString() });
        archive.unshift(copy);
        moved.push(copy);
      } else {
        kept.push(user);
      }
    });
    saveUsers(kept);
    saveArchivedUsers(archive);
    return moved;
  }

  function archiveUser(id) {
    return archiveUsers([id])[0];
  }

  function restoreUser(id) {
    var archive = getArchivedUsers();
    var found = null;
    var nextArchive = [];
    archive.forEach(function (user) {
      if (user.id === id) found = user;
      else nextArchive.push(user);
    });
    if (!found) throw new Error('العنصر غير موجود في الأرشيف');

    var restored = Object.assign({}, found);
    delete restored.archivedAt;
    if (restored.role === 'student' && isSubscriptionEnded(restored) && restored.status !== 'suspended') {
      restored.status = 'expired';
    } else if (restored.status === 'expired' && !isSubscriptionEnded(restored)) {
      restored.status = 'active';
    }

    var list = getUsers();
    list.unshift(restored);
    saveUsers(list);
    saveArchivedUsers(nextArchive);
    return restored;
  }

  function findUserInDirectory(id) {
    var list = getUsers();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    var archive = getArchivedUsers();
    for (var j = 0; j < archive.length; j++) {
      if (archive[j].id === id) return archive[j];
    }
    return null;
  }

  function permanentDeleteUser(id) {
    var list = getUsers();
    var inActive = null;
    var nextActive = [];
    list.forEach(function (user) {
      if (user.id === id) inActive = user;
      else nextActive.push(user);
    });
    if (inActive) {
      saveUsers(nextActive);
      return inActive;
    }

    var archive = getArchivedUsers();
    var inArchive = null;
    var nextArchive = [];
    archive.forEach(function (user) {
      if (user.id === id) inArchive = user;
      else nextArchive.push(user);
    });
    if (!inArchive) throw new Error('المستخدم غير موجود');
    saveArchivedUsers(nextArchive);
    return inArchive;
  }

  function permanentDeleteUserWithFirestore(id) {
    var directoryUser = findUserInDirectory(id);
    if (!directoryUser) throw new Error('المستخدم غير موجود');
    return import('./admin-user-firestore-purge.js')
      .then(function (mod) {
        return mod.purgeUserPlatformData(directoryUser);
      })
      .then(function () {
        return permanentDeleteUser(id);
      });
  }

  function permanentDeleteUsers(ids) {
    var results = [];
    (ids || []).forEach(function (id) {
      try {
        results.push(permanentDeleteUser(id));
      } catch (err) {
        /* skip */
      }
    });
    return results;
  }

  ensureSeeded();

  function getRegisteredUserCount() {
    return getActiveUsers().length;
  }

  global.AdminUsers = {
    getUsers: getActiveUsers,
    getRegisteredUserCount: getRegisteredUserCount,
    getArchivedUsers: getArchivedUsers,
    findUser: findUser,
    findUserByEmail: findUserByEmail,
    addUser: addUser,
    updateUser: updateUser,
    setUserStatus: setUserStatus,
    toggleSuspend: toggleSuspend,
    renewSubscription: renewSubscription,
    archiveUser: archiveUser,
    archiveUsers: archiveUsers,
    restoreUser: restoreUser,
    permanentDeleteUser: permanentDeleteUser,
    permanentDeleteUserWithFirestore: permanentDeleteUserWithFirestore,
    permanentDeleteUsers: permanentDeleteUsers,
    formatDate: formatDate,
    roleLabel: roleLabel,
    statusLabel: statusLabel,
    isSubscriptionEnded: isSubscriptionEnded,
    ingestFirestoreUsers: ingestFirestoreUsers,
    clearFirestoreUsers: clearFirestoreUsers,
    resolveUserAccess: resolveUserAccess,
    getDisplayStatus: getDisplayStatus,
    getSubscriptionLabel: getSubscriptionLabel,
    subscriptionLabel: subscriptionLabel,
    getFreeTrialDays: getFreeTrialDays,
    isFirestoreLive: function () {
      return firestoreReady;
    },
    ROLE_LABELS: ROLE_LABELS,
    STATUS_LABELS: STATUS_LABELS,
    SUBSCRIPTION_LABELS: SUBSCRIPTION_LABELS,
  };
})(typeof window !== 'undefined' ? window : this);
