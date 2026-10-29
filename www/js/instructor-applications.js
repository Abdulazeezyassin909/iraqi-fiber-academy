/**
 * Instructor applications + approval flags (localStorage).
 * Simple global keys for reliable index/admin sync:
 *   - isInstructorApproved = "true" | "false"
 *   - approvedInstructorEmail = "user@email.com"
 */
(function (global) {
  'use strict';

  var APPS_KEY = 'ifa_instructor_applications';
  var ARCHIVE_KEY = 'ifa_instructor_archive';
  var APPROVED_KEY = 'ifa_approved_instructors';
  var SESSION_EMAIL_KEY = 'ifa_session_email';
  var FLAG_APPROVED = 'isInstructorApproved';
  var FLAG_EMAIL = 'approvedInstructorEmail';

  function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  function storageSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (err) {
      console.error('[InstructorApps] localStorage set failed:', key, err);
    }
    try {
      sessionStorage.setItem(key, value);
    } catch (err2) {
      /* ignore */
    }
  }

  function storageGet(key) {
    try {
      var v = localStorage.getItem(key);
      if (v != null && v !== '') return v;
    } catch (err) {
      /* ignore */
    }
    try {
      return sessionStorage.getItem(key);
    } catch (err2) {
      return null;
    }
  }

  function readJson(key, fallback) {
    try {
      var raw = storageGet(key);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch (err) {
      console.warn('[InstructorApps] read failed:', err);
      return fallback;
    }
  }

  function writeJson(key, value) {
    storageSet(key, JSON.stringify(value));
  }

  function uid() {
    return 'app_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function getApplications() {
    if (remotePending) return remotePending.slice();
    var list = readJson(APPS_KEY, []);
    return Array.isArray(list) ? list : [];
  }

  function saveApplications(list) {
    writeJson(APPS_KEY, list);
  }

  function getApprovedMap() {
    var map = readJson(APPROVED_KEY, {});
    return map && typeof map === 'object' ? map : {};
  }

  function saveApprovedMap(map) {
    writeJson(APPROVED_KEY, map);
  }

  function setInstructorApprovedFlag(email, approved) {
    var key = normalizeEmail(email);
    storageSet(FLAG_APPROVED, approved ? 'true' : 'false');
    if (approved && key) {
      storageSet(FLAG_EMAIL, key);
      storageSet(SESSION_EMAIL_KEY, key);
    } else if (!approved) {
      storageSet(FLAG_APPROVED, 'false');
    }
  }

  function getInstructorApprovedFlag() {
    return storageGet(FLAG_APPROVED) === 'true';
  }

  function getApprovedInstructorEmail() {
    return normalizeEmail(storageGet(FLAG_EMAIL) || '');
  }

  function findByEmail(email) {
    var target = normalizeEmail(email);
    if (!target) return null;
    var list = getApplications();
    for (var i = list.length - 1; i >= 0; i--) {
      if (normalizeEmail(list[i].email) === target) return list[i];
    }
    return null;
  }

  function isApprovedInstructor(email) {
    /* Global flag — primary signal for Profile menu unlock */
    if (getInstructorApprovedFlag()) {
      var approvedEmail = getApprovedInstructorEmail();
      var check = normalizeEmail(email);
      if (!check || !approvedEmail) return true;
      return check === approvedEmail;
    }

    var key = normalizeEmail(email);
    if (!key) return false;

    var map = getApprovedMap();
    if (map[key] && (map[key].isInstructor === true || map[key].status === 'approved')) {
      if (map[key].accountStatus === 'suspended') return false;
      return true;
    }

    var app = findByEmail(key);
    return !!(app && app.status === 'approved');
  }

  function hasPendingApplication(email) {
    var app = findByEmail(email);
    return !!(app && app.status === 'pending');
  }

  var remotePending = null;
  var pendingUnsub = null;

  function loadFirestore() {
    return Promise.all([
      import('./firebase-config.js'),
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'),
    ]).then(function (mods) {
      return { db: mods[0].db, auth: mods[0].auth, fs: mods[1] };
    });
  }

  function stampToIso(value) {
    if (!value) return null;
    if (typeof value.toDate === 'function') {
      try {
        return value.toDate().toISOString();
      } catch (err) {
        return null;
      }
    }
    if (typeof value === 'string') return value;
    return null;
  }

  function mapApplicationDoc(id, data) {
    data = data || {};
    return {
      id: id,
      uid: data.uid || id,
      fullName: data.fullName || '',
      email: data.email || '',
      bio: data.bio || '',
      specialization: data.specialization || data.courses || '',
      courses: data.specialization || data.courses || '',
      cvLink: data.cvUrl || data.cvLink || '',
      cvFileName: '',
      status: data.status || 'pending',
      createdAt: stampToIso(data.createdAt),
      reviewedAt: stampToIso(data.reviewedAt),
      reviewedBy: data.reviewedBy || null,
    };
  }

  function submitApplication(payload) {
    var authApi = global.IFAAuth;
    var user = authApi && typeof authApi.getCurrentUser === 'function' ? authApi.getCurrentUser() : null;
    if (!user || !user.uid) {
      return Promise.reject(new Error('سجّل الدخول أولاً لتقديم طلب الانضمام كمدرب.'));
    }
    var email = normalizeEmail(user.email || payload.email);
    var fullName = String(payload.fullName || user.displayName || '').trim();
    var bio = String(payload.bio || '').trim();
    var specialization = String(payload.specialization || payload.courses || '').trim();
    var cvLink = String(payload.cvLink || '').trim();
    if (!cvLink) {
      return Promise.reject(new Error('يرجى إرفاق رابط السيرة الذاتية قبل إرسال الطلب.'));
    }
    if (!fullName) return Promise.reject(new Error('الاسم الكامل مطلوب'));
    if (!bio) return Promise.reject(new Error('نبذة تعريفية مطلوبة'));
    if (!specialization) return Promise.reject(new Error('التخصص مطلوب'));

    return loadFirestore().then(function (api) {
      var ref = api.fs.doc(api.db, 'instructor_applications', user.uid);
      return api.fs.getDoc(ref).then(function (snap) {
        if (snap.exists() && snap.data() && snap.data().status === 'pending') {
          throw new Error('لديك طلب قيد المراجعة بالفعل.');
        }
        if (snap.exists() && snap.data() && snap.data().status === 'approved') {
          throw new Error('هذا الحساب معتمد بالفعل كمدرب.');
        }
        var payloadDoc = {
          uid: user.uid,
          email: email,
          fullName: fullName,
          bio: bio,
          specialization: specialization,
          cvLink: cvLink,
          status: 'pending',
          createdAt: api.fs.serverTimestamp(),
          reviewedAt: null,
          reviewedBy: null,
        };
        if (snap.exists()) return api.fs.setDoc(ref, payloadDoc, { merge: true });
        return api.fs.setDoc(ref, payloadDoc);
      }).then(function () {
        return mapApplicationDoc(user.uid, {
          uid: user.uid,
          email: email,
          fullName: fullName,
          bio: bio,
          specialization: specialization,
          cvLink: cvLink,
          status: 'pending',
          createdAt: new Date().toISOString(),
        });
      });
    }).catch(function (err) {
      console.error('[InstructorApps] submitApplication failed:', err);
      throw err;
    });
  }

  function updateStatus(id, status) {
    var list = getApplications();
    var found = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        list[i].status = status;
        list[i].reviewedAt = new Date().toISOString();
        found = list[i];
        break;
      }
    }
    if (!found) throw new Error('الطلب غير موجود');

    saveApplications(list);

    var map = getApprovedMap();
    var key = normalizeEmail(found.email);
    if (status === 'approved') {
      map[key] = {
        fullName: found.fullName,
        email: key,
        applicationId: found.id,
        approvedAt: found.reviewedAt,
        isInstructor: true,
        status: 'approved',
        accountStatus: 'active',
        bio: found.bio || '',
        courses: found.courses || '',
        cvLink: found.cvLink || '',
        cvFileName: found.cvFileName || '',
      };
      setInstructorApprovedFlag(key, true);
    } else if (status === 'rejected' || status === 'on_hold') {
      delete map[key];
      if (getApprovedInstructorEmail() === key) {
        setInstructorApprovedFlag(key, false);
      }
    }
    saveApprovedMap(map);
    if (status === 'approved') {
      syncInstructorUserAccount(found);
    }
    return found;
  }

  function syncInstructorUserAccount(app) {
    if (!app || !app.email) return;
    var email = normalizeEmail(app.email);
    if (global.AdminUsers && typeof global.AdminUsers.findUserByEmail === 'function') {
      var user = global.AdminUsers.findUserByEmail(email);
      if (user && typeof global.AdminUsers.updateUser === 'function') {
        global.AdminUsers.updateUser(user.id, {
          role: 'instructor',
          name: app.fullName || user.name,
        });
      } else if (typeof global.AdminUsers.addUser === 'function') {
        try {
          global.AdminUsers.addUser({
            name: app.fullName || email.split('@')[0],
            email: email,
            role: 'instructor',
          });
        } catch (err) {
          /* user may already exist */
        }
      }
    }
    try {
      var raw = localStorage.getItem('ifa_auth_user');
      if (raw) {
        var auth = JSON.parse(raw);
        if (auth && normalizeEmail(auth.email) === email && global.IFAAuth && typeof global.IFAAuth.setLocalAuthUser === 'function') {
          global.IFAAuth.setLocalAuthUser({
            email: email,
            name: app.fullName || auth.name,
            isInstructor: true,
            role: 'instructor',
          });
        }
      }
    } catch (err2) {
      /* ignore */
    }
    try {
      global.dispatchEvent(new CustomEvent('ifa:instructor-status-changed', { detail: app }));
    } catch (err3) {
      /* ignore */
    }
  }

  function currentAdminUid(api) {
    var user = api.auth && api.auth.currentUser;
    if (user && user.uid) return user.uid;
    var fallback = global.IFAAuth && global.IFAAuth.getCurrentUser ? global.IFAAuth.getCurrentUser() : null;
    if (fallback && fallback.uid) return fallback.uid;
    throw new Error('تعذر تحديد حساب المشرف.');
  }

  function approveApplication(uid) {
    if (!uid) return Promise.reject(new Error('معرّف الطلب مطلوب'));
    return loadFirestore().then(function (api) {
      var adminUid = currentAdminUid(api);
      var appRef = api.fs.doc(api.db, 'instructor_applications', uid);
      var userRef = api.fs.doc(api.db, 'users', uid);
      return api.fs.getDoc(userRef).then(function (userSnap) {
        var existing = userSnap.exists() ? userSnap.data() || {} : {};
        var nextRole = existing.role === 'admin' ? 'admin' : 'instructor';
        return api.fs.updateDoc(appRef, {
          status: 'approved',
          reviewedAt: api.fs.serverTimestamp(),
          reviewedBy: adminUid,
        }).then(function () {
          return api.fs.setDoc(userRef, {
            isInstructor: true,
            role: nextRole,
            updatedAt: api.fs.serverTimestamp(),
          }, { merge: true });
        }).then(function () {
          return { id: uid, uid: uid, email: existing.email || '', status: 'approved' };
        });
      });
    });
  }

  function revokeInstructor(uid) {
    if (!uid) return Promise.resolve();
    if (!confirm('هل أنت متأكد من سحب صلاحية المدرب؟')) return Promise.resolve();
    return loadFirestore().then(function (api) {
      var db = api.db;
      var userRef = api.fs.doc(db, 'users', uid);
      var appRef = api.fs.doc(db, 'instructor_applications', uid);

      return api.fs.setDoc(userRef, {
        isInstructor: false,
        role: 'user',
        updatedAt: api.fs.serverTimestamp(),
      }, { merge: true }).then(function () {
        return api.fs.getDoc(appRef).then(function (docSnap) {
          if (docSnap.exists()) {
            return api.fs.updateDoc(appRef, { status: 'revoked' });
          }
        });
      });
    }).catch(function (err) {
      console.error('[InstructorApps] Revoke error:', err);
      throw err;
    });
  }

  function rejectApplication(uid) {
    if (!uid) return Promise.reject(new Error('معرّف الطلب مطلوب'));
    return loadFirestore().then(function (api) {
      var adminUid = currentAdminUid(api);
      var appRef = api.fs.doc(api.db, 'instructor_applications', uid);
      return api.fs.updateDoc(appRef, {
        status: 'rejected',
        reviewedAt: api.fs.serverTimestamp(),
        reviewedBy: adminUid,
      }).then(function () {
        return { id: uid, uid: uid, status: 'rejected' };
      });
    });
  }

  function watchPendingApplications(onChange) {
    if (pendingUnsub) {
      pendingUnsub();
      pendingUnsub = null;
    }
    return loadFirestore().then(function (api) {
      var q = api.fs.query(
        api.fs.collection(api.db, 'instructor_applications'),
        api.fs.where('status', '==', 'pending')
      );
      pendingUnsub = api.fs.onSnapshot(q, function (snap) {
        remotePending = [];
        snap.forEach(function (docSnap) {
          remotePending.push(mapApplicationDoc(docSnap.id, docSnap.data()));
        });
        remotePending.sort(function (a, b) {
          return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
        });
        if (typeof onChange === 'function') onChange(remotePending.slice());
      }, function (err) {
        console.error('[InstructorApps] pending snapshot failed:', err);
      });
      return pendingUnsub;
    });
  }

  function getPendingApplications() {
    if (remotePending) {
      return remotePending.filter(function (a) {
        return a && a.status === 'pending';
      });
    }
    return getApplications().filter(function (a) {
      return a && a.status === 'pending';
    });
  }

  /** Pause/hold a request without archiving it. */
  function holdApplication(id) {
    return updateStatus(id, 'on_hold');
  }

  /** Reset status back to pending and clear instructor approval for that email. */
  function resetApplication(id) {
    var list = getApplications();
    var found = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        list[i].status = 'pending';
        list[i].reviewedAt = null;
        found = list[i];
        break;
      }
    }
    if (!found) throw new Error('الطلب غير موجود');

    saveApplications(list);

    var key = normalizeEmail(found.email);
    var map = getApprovedMap();
    delete map[key];
    saveApprovedMap(map);

    if (getApprovedInstructorEmail() === key || getInstructorApprovedFlag()) {
      if (getApprovedInstructorEmail() === key) {
        setInstructorApprovedFlag(key, false);
      }
    }

    return found;
  }

  function deleteApplication(id) {
    return permanentDeleteApplication(id);
  }

  function deleteAllApplications() {
    var ids = getApplications().map(function (a) { return a.id; });
    return permanentDeleteApplications(ids).length;
  }

  function getArchivedApplications() {
    var list = readJson(ARCHIVE_KEY, []);
    return Array.isArray(list) ? list : [];
  }

  function saveArchivedApplications(list) {
    writeJson(ARCHIVE_KEY, list);
  }

  function clearApprovalForEmail(email) {
    var key = normalizeEmail(email);
    if (!key) return;
    var map = getApprovedMap();
    delete map[key];
    saveApprovedMap(map);
    if (getApprovedInstructorEmail() === key) {
      setInstructorApprovedFlag(key, false);
    }
  }

  /** Move active request(s) into archive. */
  function archiveApplications(ids) {
    var idSet = {};
    (ids || []).forEach(function (id) {
      idSet[id] = true;
    });
    var list = getApplications();
    var archive = getArchivedApplications();
    var kept = [];
    var moved = [];

    list.forEach(function (app) {
      if (idSet[app.id]) {
        var copy = Object.assign({}, app, {
          archivedAt: new Date().toISOString(),
        });
        archive.unshift(copy);
        moved.push(copy);
        if (app.status === 'approved') clearApprovalForEmail(app.email);
      } else {
        kept.push(app);
      }
    });

    if (!moved.length) throw new Error('لم يتم العثور على الطلبات المحددة');
    saveApplications(kept);
    saveArchivedApplications(archive);
    return moved;
  }

  function archiveApplication(id) {
    return archiveApplications([id])[0];
  }

  /** Restore from archive back to active list as pending. */
  function restoreApplication(id) {
    var archive = getArchivedApplications();
    var found = null;
    var nextArchive = [];
    archive.forEach(function (app) {
      if (app.id === id) found = app;
      else nextArchive.push(app);
    });
    if (!found) throw new Error('العنصر غير موجود في الأرشيف');

    var restored = Object.assign({}, found, {
      status: 'pending',
      reviewedAt: null,
      archivedAt: null,
    });
    delete restored.archivedAt;

    var list = getApplications();
    list.unshift(restored);
    saveApplications(list);
    saveArchivedApplications(nextArchive);
    return restored;
  }

  /** Permanent delete from active list OR archive. */
  function permanentDeleteApplication(id) {
    var list = getApplications();
    var inActive = null;
    var nextActive = [];
    list.forEach(function (app) {
      if (app.id === id) inActive = app;
      else nextActive.push(app);
    });
    if (inActive) {
      saveApplications(nextActive);
      clearApprovalForEmail(inActive.email);
      return inActive;
    }

    var archive = getArchivedApplications();
    var inArchive = null;
    var nextArchive = [];
    archive.forEach(function (app) {
      if (app.id === id) inArchive = app;
      else nextArchive.push(app);
    });
    if (!inArchive) throw new Error('الطلب غير موجود');
    saveArchivedApplications(nextArchive);
    clearApprovalForEmail(inArchive.email);
    return inArchive;
  }

  function permanentDeleteApplications(ids) {
    var results = [];
    (ids || []).forEach(function (id) {
      try {
        results.push(permanentDeleteApplication(id));
      } catch (err) {
        /* skip missing */
      }
    });
    return results;
  }

  function setSessionEmail(email) {
    var key = normalizeEmail(email);
    if (key) storageSet(SESSION_EMAIL_KEY, key);
  }

  function getSessionEmail() {
    return normalizeEmail(storageGet(SESSION_EMAIL_KEY) || '');
  }

  /**
   * Pull approval from URL (?isInstructorApproved=true&email=...) then write local flags.
   * Needed for file:// where each HTML file may have isolated localStorage.
   */
  function absorbApprovalFromUrl() {
    try {
      var params = new URLSearchParams(window.location.search || '');
      var flag =
        params.get('isInstructorApproved') === 'true' ||
        params.get('instructorApproved') === '1' ||
        params.get('instructorApproved') === 'true';
      if (!flag) return false;

      var email = normalizeEmail(params.get('email') || getSessionEmail() || '');
      setInstructorApprovedFlag(email, true);

      if (window.history && window.history.replaceState) {
        var clean = window.location.pathname + (window.location.hash || '');
        window.history.replaceState({}, document.title, clean || 'index.html');
      }
      return true;
    } catch (err) {
      console.warn('[InstructorApps] absorbApprovalFromUrl failed:', err);
      return false;
    }
  }

  function buildIndexUnlockUrl(email) {
    var e = encodeURIComponent(normalizeEmail(email) || '');
    return 'index.html?isInstructorApproved=true&email=' + e;
  }

  function findApplicationById(id) {
    var list = getApplications();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  var remoteInstructors = null;
  var instructorsUnsub = null;
  var instructorsLoadError = '';

  function watchActiveInstructors(onChange) {
    if (instructorsUnsub) {
      instructorsUnsub();
      instructorsUnsub = null;
    }
    return loadFirestore().then(function (api) {
      var q = api.fs.query(
        api.fs.collection(api.db, 'users'),
        api.fs.where('isInstructor', '==', true)
      );
      instructorsUnsub = api.fs.onSnapshot(q, function (snap) {
        instructorsLoadError = '';
        remoteInstructors = [];
        snap.forEach(function (docSnap) {
          var data = docSnap.data() || {};
          remoteInstructors.push({
            id: docSnap.id,
            email: data.email || '',
            fullName: data.name || data.fullName || data.email || docSnap.id,
            bio: data.bio || '',
            courses: data.specialization || '',
            approvedAt: stampToIso(data.updatedAt) || stampToIso(data.createdAt),
            accountStatus: data.instructorStatus === 'suspended' ? 'suspended' : 'active',
            isInstructor: true,
          });
        });
        if (typeof onChange === 'function') onChange(remoteInstructors.slice());
      }, function (err) {
        instructorsLoadError = (err && err.message) || 'تعذر تحميل قائمة المدربين';
        console.error('[InstructorApps] instructors snapshot failed:', err);
        if (typeof onChange === 'function') onChange([]);
      });
      return instructorsUnsub;
    });
  }

  /** Active instructors derived from the approved map (+ linked application data). */
  function getActiveInstructors() {
    if (remoteInstructors) return remoteInstructors.slice();
    var map = getApprovedMap();
    var apps = getApplications();
    var list = [];

    Object.keys(map).forEach(function (email) {
      var entry = map[email];
      if (!entry) return;
      if (entry.isInstructor !== true && entry.status !== 'approved') return;

      var app = null;
      if (entry.applicationId) {
        app = findApplicationById(entry.applicationId);
      }
      if (!app) {
        for (var i = 0; i < apps.length; i++) {
          if (normalizeEmail(apps[i].email) === email && apps[i].status === 'approved') {
            app = apps[i];
            break;
          }
        }
      }

      list.push({
        id: entry.applicationId || (app && app.id) || 'inst_' + email,
        email: email,
        fullName: entry.fullName || (app && app.fullName) || email,
        bio: entry.bio != null && entry.bio !== '' ? entry.bio : (app && app.bio) || '',
        courses:
          entry.courses != null && entry.courses !== ''
            ? entry.courses
            : (app && app.courses) || '',
        cvLink: entry.cvLink || (app && app.cvLink) || '',
        cvFileName: entry.cvFileName || (app && app.cvFileName) || '',
        approvedAt: entry.approvedAt || (app && app.reviewedAt) || null,
        accountStatus: entry.accountStatus === 'suspended' ? 'suspended' : 'active',
        applicationId: entry.applicationId || (app && app.id) || null,
        isInstructor: true,
      });
    });

    list.sort(function (a, b) {
      return String(b.approvedAt || '').localeCompare(String(a.approvedAt || ''));
    });
    return list;
  }

  function findActiveInstructor(idOrEmail) {
    var key = normalizeEmail(idOrEmail);
    var list = getActiveInstructors();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === idOrEmail || list[i].email === key || list[i].applicationId === idOrEmail) {
        return list[i];
      }
    }
    return null;
  }

  function updateInstructor(idOrEmail, patch) {
    var instructor = findActiveInstructor(idOrEmail);
    if (!instructor) throw new Error('المدرب غير موجود');

    var map = getApprovedMap();
    var key = instructor.email;
    var next = Object.assign({}, map[key] || {}, patch || {}, {
      email: key,
      isInstructor: true,
      status: 'approved',
    });
    if (patch && patch.fullName != null) next.fullName = String(patch.fullName).trim();
    if (patch && patch.bio != null) next.bio = String(patch.bio).trim();
    if (patch && patch.courses != null) next.courses = String(patch.courses).trim();
    if (patch && patch.accountStatus != null) {
      next.accountStatus = patch.accountStatus === 'suspended' ? 'suspended' : 'active';
    }
    map[key] = next;
    saveApprovedMap(map);

    if (instructor.applicationId) {
      var list = getApplications();
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === instructor.applicationId) {
          if (patch && patch.fullName != null) list[i].fullName = next.fullName;
          if (patch && patch.bio != null) list[i].bio = next.bio;
          if (patch && patch.courses != null) list[i].courses = next.courses;
          break;
        }
      }
      saveApplications(list);
    }

    return findActiveInstructor(key);
  }

  function toggleInstructorSuspend(idOrEmail) {
    var instructor = findActiveInstructor(idOrEmail);
    if (!instructor) throw new Error('المدرب غير موجود');
    var nextStatus = instructor.accountStatus === 'suspended' ? 'active' : 'suspended';
    var updated = updateInstructor(instructor.email, { accountStatus: nextStatus });
    if (nextStatus === 'suspended') {
      if (getApprovedInstructorEmail() === instructor.email) {
        setInstructorApprovedFlag(instructor.email, false);
      }
    } else {
      setInstructorApprovedFlag(instructor.email, true);
    }
    return updated;
  }

  function removeInstructor(idOrEmail) {
    var instructor = findActiveInstructor(idOrEmail);
    if (!instructor) throw new Error('المدرب غير موجود');

    if (instructor.applicationId) {
      try {
        archiveApplication(instructor.applicationId);
      } catch (err) {
        clearApprovalForEmail(instructor.email);
      }
    } else {
      clearApprovalForEmail(instructor.email);
    }
    return instructor;
  }

  function removeInstructors(ids) {
    var results = [];
    (ids || []).forEach(function (id) {
      try {
        results.push(removeInstructor(id));
      } catch (err) {
        /* skip */
      }
    });
    return results;
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
    } catch (e) {
      return iso;
    }
  }

  global.InstructorApps = {
    getApplications: getApplications,
    getPendingApplications: getPendingApplications,
    watchPendingApplications: watchPendingApplications,
    watchActiveInstructors: watchActiveInstructors,
    getInstructorsLoadError: function () {
      return instructorsLoadError;
    },
    submitApplication: submitApplication,
    approveApplication: approveApplication,
    revokeInstructor: revokeInstructor,
    rejectApplication: rejectApplication,
    holdApplication: holdApplication,
    resetApplication: resetApplication,
    deleteApplication: deleteApplication,
    deleteAllApplications: deleteAllApplications,
    archiveApplication: archiveApplication,
    archiveApplications: archiveApplications,
    restoreApplication: restoreApplication,
    permanentDeleteApplication: permanentDeleteApplication,
    permanentDeleteApplications: permanentDeleteApplications,
    getArchivedApplications: getArchivedApplications,
    getActiveInstructors: getActiveInstructors,
    findActiveInstructor: findActiveInstructor,
    updateInstructor: updateInstructor,
    toggleInstructorSuspend: toggleInstructorSuspend,
    removeInstructor: removeInstructor,
    removeInstructors: removeInstructors,
    isApprovedInstructor: isApprovedInstructor,
    hasPendingApplication: hasPendingApplication,
    setSessionEmail: setSessionEmail,
    getSessionEmail: getSessionEmail,
    findByEmail: findByEmail,
    formatDate: formatDate,
    normalizeEmail: normalizeEmail,
    setInstructorApprovedFlag: setInstructorApprovedFlag,
    getInstructorApprovedFlag: getInstructorApprovedFlag,
    getApprovedInstructorEmail: getApprovedInstructorEmail,
    absorbApprovalFromUrl: absorbApprovalFromUrl,
    buildIndexUnlockUrl: buildIndexUnlockUrl,
    FLAG_APPROVED: FLAG_APPROVED,
    FLAG_EMAIL: FLAG_EMAIL,
  };
})(typeof window !== 'undefined' ? window : globalThis);
