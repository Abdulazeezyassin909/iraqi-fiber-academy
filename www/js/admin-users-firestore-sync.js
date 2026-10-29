/**
 * Live Admin Users directory from Firestore `users` collection.
 */
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { publishRegisteredUserCount } from './firestore-user-metrics.js';

var usersUnsubscribe = null;

function notifyUsersChanged() {
  try {
    window.dispatchEvent(new CustomEvent('ifa:admin-users-changed'));
    document.dispatchEvent(new CustomEvent('ifa:admin-users-changed'));
  } catch (err) {
    /* ignore */
  }
}

function startUsersListener() {
  if (usersUnsubscribe) return;
  usersUnsubscribe = onSnapshot(
    collection(db, 'users'),
    function (snapshot) {
      var rows = snapshot.docs.map(function (docSnap) {
        return Object.assign({ id: docSnap.id }, docSnap.data() || {});
      });
      if (window.AdminUsers && typeof window.AdminUsers.ingestFirestoreUsers === 'function') {
        window.AdminUsers.ingestFirestoreUsers(rows);
      }
      publishRegisteredUserCount(rows.length).catch(function (err) {
        console.error('[AdminUsersFirestore] user metrics publish failed:', err);
      });
      notifyUsersChanged();
    },
    function (err) {
      console.error('[AdminUsersFirestore] onSnapshot failed:', err);
    }
  );
}

function stopUsersListener() {
  if (usersUnsubscribe) {
    usersUnsubscribe();
    usersUnsubscribe = null;
  }
}

onAuthStateChanged(auth, function (user) {
  if (!user) {
    stopUsersListener();
    if (window.AdminUsers && typeof window.AdminUsers.clearFirestoreUsers === 'function') {
      window.AdminUsers.clearFirestoreUsers();
      notifyUsersChanged();
    }
    return;
  }
  startUsersListener();
});

/**
 * Delete users/{uid} so the next sign-in runs ensureUserProfileDocument() and
 * creates a brand-new profile (fresh createdAt → new free trial window).
 * @param {string} userId Firestore document id (Firebase Auth uid)
 */
export async function deleteUser(userId) {
  var uid = String(userId || '').trim();
  if (!uid) throw new Error('معرف المستخدم مطلوب');
  await deleteDoc(doc(db, 'users', uid));
}

function attachDeleteToAdminUsers() {
  if (!window.AdminUsers) return;
  window.AdminUsers.deleteUser = deleteUser;
}

attachDeleteToAdminUsers();
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', attachDeleteToAdminUsers);
}
