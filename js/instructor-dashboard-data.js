/**
 * Instructor dashboard data.
 * Courses are centralized in PlatformCourses (`platform_courses` localStorage key).
 */
(function (global) {
  'use strict';

  var APPS = global.InstructorApps;

  function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }

  function localAuthProfile() {
    try {
      var raw = localStorage.getItem('ifa_auth_user');
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function currentInstructorEmail() {
    var local = localAuthProfile();
    if (APPS) {
      return normalizeEmail(
        APPS.getApprovedInstructorEmail() ||
          APPS.getSessionEmail() ||
          (local && local.email) ||
          ''
      );
    }
    return normalizeEmail((local && local.email) || '');
  }

  function isInstructorAllowed() {
    var local = localAuthProfile();
    if (local && (local.isInstructor === true || String(local.role || '').toLowerCase() === 'instructor' || String(local.role || '').toLowerCase() === 'admin')) {
      return true;
    }
    if (global.IFAAuth && typeof global.IFAAuth.isInstructorUser === 'function') {
      var state = typeof global.IFAAuth.getAuthState === 'function' ? global.IFAAuth.getAuthState() : null;
      var profile = (state && state.profile) || local;
      var email = (state && state.user && state.user.email) || (local && local.email) || '';
      if (global.IFAAuth.isInstructorUser(profile, email)) return true;
    }
    try {
      if (localStorage.getItem('isInstructorApproved') === 'true') return true;
    } catch (e) {
      /* ignore */
    }
    if (APPS && typeof APPS.getInstructorApprovedFlag === 'function') {
      return !!APPS.getInstructorApprovedFlag();
    }
    return false;
  }

  function ensureInstructorAccess() {
    if (isInstructorAllowed()) return Promise.resolve(true);
    return Promise.all([
      import('./firebase-config.js'),
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js'),
      import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'),
    ]).then(function (mods) {
      var auth = mods[0].auth;
      var db = mods[0].db;
      var onAuthStateChanged = mods[1].onAuthStateChanged;
      var fs = mods[2];
      return new Promise(function (resolve) {
        var unsub = onAuthStateChanged(auth, function (user) {
          unsub();
          if (!user) {
            resolve(false);
            return;
          }
          fs.getDoc(fs.doc(db, 'users', user.uid)).then(function (snap) {
            var data = snap.exists() ? snap.data() || {} : {};
            var allowed = data.isInstructor === true || String(data.role || '') === 'instructor' || String(data.role || '') === 'admin';
            if (allowed) {
              try {
                var prev = localAuthProfile() || {};
                localStorage.setItem('ifa_auth_user', JSON.stringify(Object.assign({}, prev, {
                  email: data.email || user.email || prev.email || '',
                  name: data.name || prev.name || user.displayName || '',
                  isInstructor: true,
                  role: data.role === 'admin' ? 'admin' : 'instructor',
                })));
                localStorage.setItem('isInstructorApproved', 'true');
              } catch (err) {
                /* ignore */
              }
            }
            resolve(allowed);
          }).catch(function (err) {
            console.error('[InstructorDash] access check failed:', err);
            resolve(false);
          });
        });
      });
    }).catch(function (err) {
      console.error('[InstructorDash] access check failed:', err);
      return false;
    });
  }

  function pc() {
    return global.PlatformCourses;
  }

  function requirePlatform() {
    if (!pc()) throw new Error('منصة الكورسات غير متاحة');
    return pc();
  }

  function assertOwns(course, email) {
    var key = normalizeEmail(email);
    if (!course || normalizeEmail(course.instructorEmail) !== key) {
      throw new Error('غير مصرح');
    }
    if (course.status === 'suspended') {
      throw new Error('هذا الكورس معلّق من الإدارة');
    }
  }

  function getCourses(email) {
    var key = normalizeEmail(email || currentInstructorEmail());
    if (!pc()) return [];
    return pc()
      .getByInstructor(key)
      .filter(function (c) {
        return c.status !== 'suspended';
      })
      .map(function (c) {
        return pc().toInstructorShape(c);
      });
  }

  function findCourse(courses, courseId) {
    for (var i = 0; i < courses.length; i++) {
      if (courses[i].id === courseId) return courses[i];
    }
    return null;
  }

  function findLesson(course, lessonId) {
    if (!course || !Array.isArray(course.lessons)) return null;
    for (var i = 0; i < course.lessons.length; i++) {
      if (course.lessons[i].id === lessonId) return course.lessons[i];
    }
    return null;
  }

  function addCourse(email, payload) {
    var key = normalizeEmail(email || currentInstructorEmail());
    var name = '';
    if (APPS && typeof APPS.findActiveInstructor === 'function') {
      var inst = APPS.findActiveInstructor(key);
      if (inst && inst.fullName) name = inst.fullName;
    }
    var authUser = (typeof IFAAuth !== 'undefined' && IFAAuth.getCurrentUser) ? IFAAuth.getCurrentUser() : null;
    return requirePlatform().addCourse({
      title: payload.title,
      description: payload.description,
      enrolledCount: payload.enrolledCount,
      views: payload.views,
      instructorEmail: key,
      instructorName: payload.instructorName || name,
      instructorId: payload.instructorId || (authUser && authUser.uid) || '',
      thumbnailUrl: '',
      category: 'individual',
      price: payload.price,
      currency: payload.currency || 'IQD',
      status: 'pending',
      source: 'instructor',
      durationHours: payload.durationHours,
      durationWeeks: payload.durationWeeks,
      weeklySchedule: payload.weeklySchedule,
      lessons: payload.lessons || [],
      allowedSimulators: payload.simulators || payload.allowedSimulators || [],
      simulators: payload.simulators || payload.allowedSimulators || [],
    });
  }

  function updateCourse(email, courseId, patch) {
    var key = normalizeEmail(email || currentInstructorEmail());
    var course = requirePlatform().findCourse(courseId);
    assertOwns(course, key);
    return requirePlatform().updateCourse(courseId, {
      title: patch.title,
      description: patch.description,
      enrolledCount: patch.enrolledCount,
      durationHours: patch.durationHours,
      durationWeeks: patch.durationWeeks,
      weeklySchedule: patch.weeklySchedule,
    });
  }

  function deleteCourse(email, courseId) {
    var key = normalizeEmail(email || currentInstructorEmail());
    var course = requirePlatform().findCourse(courseId);
    assertOwns(course, key);
    requirePlatform().deleteCourse(courseId);
  }

  function addLesson(email, courseId, payload) {
    var key = normalizeEmail(email || currentInstructorEmail());
    var course = requirePlatform().findCourse(courseId);
    assertOwns(course, key);
    var lessons = (course.lessons || []).slice();
    var lesson = {
      id: uid('lesson'),
      title: String(payload.title || '').trim(),
      description: String(payload.description || '').trim(),
      videoTitle: String(payload.videoTitle || '').trim(),
      videoFileName: String(payload.videoFileName || '').trim(),
      videoUrl: String(payload.videoUrl || '').trim(),
      templateFiles: Array.isArray(payload.templateFiles) ? payload.templateFiles : [],
      quiz: { questions: [] },
      comments: [],
      views: Number(payload.views) || 0,
      completions: Number(payload.completions) || 0,
      createdAt: new Date().toISOString(),
    };
    if (!lesson.title) throw new Error('عنوان الحلقة مطلوب');
    lessons.push(lesson);
    requirePlatform().updateCourse(courseId, { lessons: lessons });
    return lesson;
  }

  function updateLesson(email, courseId, lessonId, patch) {
    var key = normalizeEmail(email || currentInstructorEmail());
    var course = requirePlatform().findCourse(courseId);
    assertOwns(course, key);
    var lessons = (course.lessons || []).map(function (l) {
      if (l.id !== lessonId) return l;
      var next = Object.assign({}, l);
      ['title', 'videoTitle', 'videoFileName', 'videoUrl', 'description'].forEach(function (f) {
        if (patch[f] != null) next[f] = String(patch[f]).trim();
      });
      if (patch.templateFiles) next.templateFiles = patch.templateFiles;
      return next;
    });
    var updated = findLesson({ lessons: lessons }, lessonId);
    if (!updated) throw new Error('الحلقة غير موجودة');
    requirePlatform().updateCourse(courseId, { lessons: lessons });
    return updated;
  }

  function deleteLesson(email, courseId, lessonId) {
    var key = normalizeEmail(email || currentInstructorEmail());
    var course = requirePlatform().findCourse(courseId);
    assertOwns(course, key);
    var lessons = (course.lessons || []).filter(function (l) {
      return l.id !== lessonId;
    });
    requirePlatform().updateCourse(courseId, { lessons: lessons });
  }

  function setLessonQuiz(email, courseId, lessonId, questions) {
    var key = normalizeEmail(email || currentInstructorEmail());
    var course = requirePlatform().findCourse(courseId);
    assertOwns(course, key);
    var found = null;
    var lessons = (course.lessons || []).map(function (l) {
      if (l.id !== lessonId) return l;
      found = Object.assign({}, l, {
        quiz: { questions: Array.isArray(questions) ? questions : [] },
      });
      return found;
    });
    if (!found) throw new Error('الحلقة غير موجودة');
    requirePlatform().updateCourse(courseId, { lessons: lessons });
    return found.quiz;
  }

  function addComment(email, courseId, lessonId, payload) {
    var key = normalizeEmail(email || currentInstructorEmail());
    var course = requirePlatform().findCourse(courseId);
    assertOwns(course, key);
    var comment = {
      id: uid('cmt'),
      studentName: String(payload.studentName || 'طالب').trim(),
      text: String(payload.text || '').trim(),
      createdAt: new Date().toISOString(),
      reply: null,
    };
    var lessons = (course.lessons || []).map(function (l) {
      if (l.id !== lessonId) return l;
      var comments = Array.isArray(l.comments) ? l.comments.slice() : [];
      comments.unshift(comment);
      return Object.assign({}, l, { comments: comments });
    });
    requirePlatform().updateCourse(courseId, { lessons: lessons });
    return comment;
  }

  function replyToComment(email, courseId, lessonId, commentId, replyText) {
    var key = normalizeEmail(email || currentInstructorEmail());
    var course = requirePlatform().findCourse(courseId);
    assertOwns(course, key);
    var hit = null;
    var lessons = (course.lessons || []).map(function (l) {
      if (l.id !== lessonId) return l;
      var comments = (l.comments || []).map(function (cm) {
        if (cm.id !== commentId) return cm;
        hit = Object.assign({}, cm, {
          reply: { text: String(replyText || '').trim(), at: new Date().toISOString() },
        });
        return hit;
      });
      return Object.assign({}, l, { comments: comments });
    });
    if (!hit) throw new Error('التعليق غير موجود');
    requirePlatform().updateCourse(courseId, { lessons: lessons });
    return hit;
  }

  function getAnalytics(email) {
    var courses = getCourses(email);
    var lessons = 0;
    var views = 0;
    var completions = 0;
    var enrolled = 0;
    var unanswered = 0;
    var quizCount = 0;

    courses.forEach(function (c) {
      enrolled += Number(c.enrolledCount) || 0;
      views += Number(c.views) || 0;
      (c.lessons || []).forEach(function (l) {
        lessons += 1;
        views += Number(l.views) || 0;
        completions += Number(l.completions) || 0;
        if (l.quiz && l.quiz.questions && l.quiz.questions.length) quizCount += 1;
        (l.comments || []).forEach(function (cm) {
          if (!cm.reply) unanswered += 1;
        });
      });
    });

    var completionRate = views > 0 ? Math.round((completions / views) * 100) : 0;
    return {
      courses: courses.length,
      lessons: lessons,
      enrolled: enrolled,
      views: views,
      completions: completions,
      completionRate: Math.min(100, completionRate),
      unanswered: unanswered,
      quizCount: quizCount,
    };
  }

  function seedDemoIfEmpty(email) {
    var key = normalizeEmail(email || currentInstructorEmail());
    if (!key || !pc()) return;
    if (getCourses(key).length) return;
    if (pc().getCourses().length) return;

    var course = addCourse(key, {
      title: 'أساسيات شبكات FTTH',
      description: 'كورس تعريفي للمدرب — يمكنك تعديله أو حذفه.',
      enrolledCount: 24,
      views: 180,
    });
    var lesson = addLesson(key, course.id, {
      title: 'الحلقة 1: مقدمة إلى الألياف الضوئية',
      videoTitle: 'مقدمة FTTH',
      videoFileName: 'ftth-intro.mp4',
      templateFiles: [{ name: 'worksheet-01.pdf' }],
      views: 120,
      completions: 86,
    });
    setLessonQuiz(key, course.id, lesson.id, [
      {
        id: uid('q'),
        text: 'ما معنى FTTH؟',
        options: ['Fiber To The Home', 'File To The Host', 'Fast Transfer Protocol', 'Field Test Tool'],
        correctIndex: 0,
      },
    ]);
    addComment(key, course.id, lesson.id, {
      studentName: 'سارة العلي',
      text: 'هل يمكن توضيح الفرق بين splitter و OLT؟',
    });
  }

  global.InstructorDash = {
    currentInstructorEmail: currentInstructorEmail,
    ensureInstructorAccess: ensureInstructorAccess,
    isInstructorAllowed: isInstructorAllowed,
    getCourses: getCourses,
    addCourse: addCourse,
    updateCourse: updateCourse,
    deleteCourse: deleteCourse,
    addLesson: addLesson,
    updateLesson: updateLesson,
    deleteLesson: deleteLesson,
    setLessonQuiz: setLessonQuiz,
    addComment: addComment,
    replyToComment: replyToComment,
    getAnalytics: getAnalytics,
    seedDemoIfEmpty: seedDemoIfEmpty,
    findCourse: findCourse,
    findLesson: findLesson,
  };
})(typeof window !== 'undefined' ? window : globalThis);
