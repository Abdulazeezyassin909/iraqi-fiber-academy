/**
 * Firestore real-time sync for platform announcements (collection: notifications).
 */
import { db } from './firebase-config.js';
import {
  collection,
  doc,
  setDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  getDoc,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { scheduleLazyFirestoreSync } from './firestore-sync-scheduler.js';

var COLLECTION = 'notifications';
var cachedNotifications = [];
var snapshotReady = false;
var listeners = [];
var unsubscribeSnapshot = null;

function normalizeNotification(raw, docId) {
  var src = raw && typeof raw === 'object' ? raw : {};
  var createdAt = src.createdAt;
  if (createdAt && typeof createdAt.toMillis === 'function') {
    createdAt = createdAt.toMillis();
  } else if (createdAt && typeof createdAt === 'object' && createdAt.seconds != null) {
    createdAt = createdAt.seconds * 1000;
  } else {
    createdAt = Number(createdAt) || Date.parse(src.createdAt) || Date.now();
  }
  return {
    id: String(docId || src.id || ''),
    title: String(src.title || '').trim(),
    body: String(src.body || '').trim(),
    type: String(src.type || 'announcement'),
    targetAudience: src.targetAudience === 'all' ? 'all' : 'subscribers',
    courseId: String(src.courseId || ''),
    courseTitle: String(src.courseTitle || ''),
    linkUrl: String(src.linkUrl || ''),
    active: src.active !== false,
    createdAt: createdAt,
    createdBy: String(src.createdBy || ''),
    meta: src.meta && typeof src.meta === 'object' ? src.meta : {},
  };
}

function notifyListeners(meta) {
  var list = getCachedNotifications();
  listeners.forEach(function (fn) {
    try {
      fn(list, meta || {});
    } catch (err) {
      console.error('[PlatformNotificationsFirestore] listener failed', err);
    }
  });
  try {
    window.dispatchEvent(new CustomEvent('ifa:notifications-firestore-changed', { detail: { list: list, meta: meta || {} } }));
    document.dispatchEvent(new CustomEvent('ifa:notifications-firestore-changed', { detail: { list: list, meta: meta || {} } }));
  } catch (err) {
    /* ignore */
  }
}

function handleSnapshot(snap) {
  var isInitial = !snapshotReady;
  var changes = [];
  cachedNotifications = snap.docs.map(function (docSnap) {
    return normalizeNotification(docSnap.data(), docSnap.id);
  });
  if (!isInitial) {
    snap.docChanges().forEach(function (change) {
      if (change.type === 'added') {
        changes.push(normalizeNotification(change.doc.data(), change.doc.id));
      }
    });
  }
  snapshotReady = true;
  notifyListeners({ initial: isInitial, added: changes });
}

export function getCachedNotifications() {
  return cachedNotifications.slice();
}

export function isNotificationsSnapshotReady() {
  return snapshotReady;
}

export function subscribeNotifications(callback) {
  if (typeof callback === 'function') {
    listeners.push(callback);
    if (snapshotReady) callback(getCachedNotifications(), { initial: true, added: [] });
  }
  return function () {
    listeners = listeners.filter(function (fn) {
      return fn !== callback;
    });
  };
}

export function notificationAppliesToUser(notification, profile) {
  if (!notification || !notification.active) return false;
  if (notification.targetAudience === 'all') return true;
  if (notification.targetAudience === 'subscribers') {
    return !!(profile && profile.isSubscriber === true);
  }
  return false;
}

export async function getUserNotificationsLastReadAt(uid) {
  if (!uid) return 0;
  try {
    var snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) return 0;
    var data = snap.data() || {};
    var value = data.notificationsLastReadAt;
    if (value && typeof value.toMillis === 'function') return value.toMillis();
    if (value && typeof value === 'object' && value.seconds != null) return value.seconds * 1000;
    return Number(value) || Date.parse(value) || 0;
  } catch (err) {
    console.warn('[PlatformNotificationsFirestore] getUserNotificationsLastReadAt failed', err);
    return 0;
  }
}

export async function markNotificationsRead(uid) {
  if (!uid) return;
  await setDoc(
    doc(db, 'users', uid),
    { notificationsLastReadAt: serverTimestamp() },
    { merge: true }
  );
}

export async function createCourseAnnouncement(course, options) {
  options = options || {};
  var courseId = String((course && course.id) || options.courseId || '').trim();
  var courseTitle = String((course && course.title) || options.courseTitle || 'كورس جديد').trim();
  if (!courseId) throw new Error('معرّف الكورس مطلوب لإرسال الإشعار');

  var notificationId =
    'course_' +
    courseId +
    '_' +
    Date.now().toString(36);
  var linkUrl =
    options.linkUrl ||
    'course-details.html?id=' + encodeURIComponent(courseId);
  var payload = {
    title: String(options.title || 'كورس جديد متاح').trim(),
    body: String(
      options.body || 'تم نشر كورس جديد: ' + courseTitle
    ).trim(),
    type: 'course_announcement',
    targetAudience: options.targetAudience === 'all' ? 'all' : 'subscribers',
    courseId: courseId,
    courseTitle: courseTitle,
    linkUrl: linkUrl,
    active: true,
    createdAt: serverTimestamp(),
    createdBy: String(options.createdBy || ''),
    meta: {
      source: 'admin-courses-ui',
    },
  };

  await setDoc(doc(db, COLLECTION, notificationId), payload);
  return normalizeNotification(
    Object.assign({}, payload, { createdAt: Date.now() }),
    notificationId
  );
}

export function startNotificationsFirestoreSync() {
  if (unsubscribeSnapshot) return unsubscribeSnapshot;
  var q = query(
    collection(db, COLLECTION),
    where('active', '==', true),
    where('targetAudience', 'in', ['all', 'subscribers']),
    orderBy('createdAt', 'desc'),
    limit(50)
  );
  unsubscribeSnapshot = onSnapshot(
    q,
    handleSnapshot,
    function (err) {
      console.error('[PlatformNotificationsFirestore] onSnapshot failed', err);
      snapshotReady = true;
      notifyListeners({ initial: true, added: [], error: err });
    }
  );
  return unsubscribeSnapshot;
}

var api = {
  subscribe: subscribeNotifications,
  getCachedNotifications: getCachedNotifications,
  isReady: isNotificationsSnapshotReady,
  createCourseAnnouncement: createCourseAnnouncement,
  markNotificationsRead: markNotificationsRead,
  getUserNotificationsLastReadAt: getUserNotificationsLastReadAt,
  notificationAppliesToUser: notificationAppliesToUser,
  start: startNotificationsFirestoreSync,
};

window.PlatformNotificationsFirestore = api;
scheduleLazyFirestoreSync(startNotificationsFirestoreSync);

export default api;
