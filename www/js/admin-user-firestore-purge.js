/**
 * Revoke Firestore entitlements and delete related orders when admin purges a directory user.
 */
import { db } from './firebase-config.js';
import {
  collection,
  doc,
  getDocs,
  query,
  setDoc,
  deleteDoc,
  where,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isLikelyAuthUid(id) {
  var s = String(id || '').trim();
  if (!s) return false;
  if (s.indexOf('usr_') === 0) return false;
  return true;
}

function collectEmailVariants(user) {
  var variants = [];
  var raw = String((user && user.email) || '').trim();
  var lower = normalizeEmail(raw);
  if (lower) variants.push(lower);
  if (raw && variants.indexOf(raw) === -1) variants.push(raw);
  return variants;
}

function collectCandidateUids(user) {
  var ids = [];
  if (user && isLikelyAuthUid(user.id)) ids.push(String(user.id));
  if (user && isLikelyAuthUid(user.uid)) ids.push(String(user.uid));
  if (user && user.firebaseUid) ids.push(String(user.firebaseUid));
  return ids;
}

async function findFirestoreUserIdsByEmail(emailVariants) {
  var found = [];
  var seen = {};
  for (var i = 0; i < emailVariants.length; i++) {
    var em = emailVariants[i];
    if (!em) continue;
    var snap = await getDocs(query(collection(db, 'users'), where('email', '==', em)));
    snap.docs.forEach(function (d) {
      if (!seen[d.id]) {
        seen[d.id] = true;
        found.push(d.id);
      }
    });
  }
  return found;
}

async function revokeUserEntitlements(uid) {
  await setDoc(
    doc(db, 'users', uid),
    {
      enrolledCourseIds: [],
      allowedSimulators: [],
      isSubscriber: false,
      planId: '',
      lastOrderId: '',
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

async function deleteOrdersForIdentifiers(uids, emailVariants) {
  var orderIds = {};
  var uidList = uids || [];
  for (var u = 0; u < uidList.length; u++) {
    var uid = uidList[u];
    if (!uid) continue;
    var byUid = await getDocs(query(collection(db, 'orders'), where('userId', '==', uid)));
    byUid.docs.forEach(function (d) {
      orderIds[d.id] = true;
    });
  }
  for (var e = 0; e < emailVariants.length; e++) {
    var em = emailVariants[e];
    if (!em) continue;
    var byEmail = await getDocs(query(collection(db, 'orders'), where('userEmail', '==', em)));
    byEmail.docs.forEach(function (d) {
      orderIds[d.id] = true;
    });
  }
  var keys = Object.keys(orderIds);
  for (var i = 0; i < keys.length; i++) {
    await deleteDoc(doc(db, 'orders', keys[i]));
  }
  return keys.length;
}

/**
 * @param {{ id?: string, email?: string, uid?: string, firebaseUid?: string }} directoryUser
 */
export async function purgeUserPlatformData(directoryUser) {
  if (!directoryUser) return { revokedUids: [], ordersDeleted: 0 };

  var emailVariants = collectEmailVariants(directoryUser);
  var uids = collectCandidateUids(directoryUser);
  var fromEmail = await findFirestoreUserIdsByEmail(emailVariants);
  fromEmail.forEach(function (id) {
    if (uids.indexOf(id) === -1) uids.push(id);
  });

  for (var i = 0; i < uids.length; i++) {
    await revokeUserEntitlements(uids[i]);
  }

  var ordersDeleted = await deleteOrdersForIdentifiers(uids, emailVariants);
  return { revokedUids: uids, ordersDeleted: ordersDeleted };
}
