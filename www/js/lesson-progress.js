/**
 * Lesson exam passes: local copy first, then the signed-in account.
 * Token format: courseId::lessonId
 */
import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  arrayUnion,
  doc,
  getDoc,
  setDoc,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

var LIST_KEY = 'ifa_passed_lessons';

function readList() {
  try {
    var raw = localStorage.getItem(LIST_KEY);
    var parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch (err) {
    return [];
  }
}

function writeList(list) {
  try {
    localStorage.setItem(LIST_KEY, JSON.stringify(list));
  } catch (err) {
    /* ignore quota */
  }
}

function legacyKey(courseId, lessonId) {
  return 'passed_' + courseId + '_' + lessonId;
}

function rememberLocal(courseId, lessonId) {
  var token = String(courseId) + '::' + String(lessonId);
  try {
    localStorage.setItem(legacyKey(courseId, lessonId), 'true');
  } catch (err) {
    /* ignore */
  }
  var list = readList();
  if (list.indexOf(token) === -1) {
    list.push(token);
    writeList(list);
  }
  return token;
}

function applyRemote(tokens) {
  (tokens || []).forEach(function (token) {
    var raw = String(token || '');
    var cut = raw.indexOf('::');
    if (cut <= 0) return;
    rememberLocal(raw.slice(0, cut), raw.slice(cut + 2));
  });
}

function notify() {
  try {
    window.dispatchEvent(new CustomEvent('ifa:lesson-progress-changed'));
  } catch (err) {
    /* ignore */
  }
}

async function pullAndMerge(uid) {
  var ref = doc(db, 'users', uid);
  var snap = await getDoc(ref);
  var remote = [];
  if (snap.exists() && Array.isArray(snap.data().passedLessons)) {
    remote = snap.data().passedLessons.map(String);
  }
  var before = readList().join('|');
  applyRemote(remote);
  var local = readList();
  var missing = local.filter(function (token) {
    return remote.indexOf(token) === -1;
  });
  if (missing.length) {
    var patch = { passedLessons: arrayUnion.apply(null, missing) };
    await setDoc(ref, patch, { merge: true });
  }
  if (readList().join('|') !== before) notify();
}

function save(courseId, lessonId) {
  if (!courseId || !lessonId) return;
  var token = rememberLocal(courseId, lessonId);
  var user = auth.currentUser;
  if (!user) return;
  setDoc(doc(db, 'users', user.uid), { passedLessons: arrayUnion(token) }, { merge: true }).catch(function (err) {
    console.warn('[LessonProgress] save failed', err);
  });
}

onAuthStateChanged(auth, function (user) {
  if (!user) return;
  pullAndMerge(user.uid).catch(function (err) {
    console.warn('[LessonProgress] pull failed', err);
  });
});

window.IFALessonProgress = { save: save };
