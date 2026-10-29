/**
 * Public homepage: load published courses from shared localStorage
 * (`platform_courses`) and render a live-updating cards grid.
 */
(function () {
  'use strict';

  var COURSES_KEY = 'platform_courses';
  var LEGACY_KEY = 'ifa_platform_courses';
  var GRID_ID = 'publicCoursesGrid';
  var lastSignature = '';
  var detailsRenderSeq = 0;
  var coursePlyrPlayer = null;
  var activeLessonContext = null;

  var PLYR_YOUTUBE_CONTROLS = [
    'play-large',
    'play',
    'progress',
    'current-time',
    'duration',
    'mute',
    'volume',
    'settings',
    'fullscreen',
  ];

  var PLYR_YOUTUBE_OPTIONS = {
    noCookie: false,
    rel: 0,
    showinfo: 0,
    iv_load_policy: 3,
    cc_load_policy: 0,
    modestbranding: 1,
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function readRawList(key) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch (err) {
      return null;
    }
  }

  /**
   * Fetch all courses from the shared localStorage database.
   * Prefers PlatformCourses API when available; falls back to direct key read.
   */
  function fetchCoursesFromLocalStorage() {
    if (window.PlatformCourses && typeof window.PlatformCourses.getCourses === 'function') {
      return window.PlatformCourses.getCourses();
    }
    var list = readRawList(COURSES_KEY);
    if (!list) list = readRawList(LEGACY_KEY);
    return list || [];
  }

  function hasCachedCoursesInStorage() {
    var list = readRawList(COURSES_KEY) || readRawList(LEGACY_KEY);
    return !!(list && list.length);
  }

  function getPublishedFromStorageOnly() {
    var list = readRawList(COURSES_KEY);
    if (!list) list = readRawList(LEGACY_KEY);
    if (!list) list = [];
    return list.filter(function (c) {
      return (
        c &&
        String(c.status || '').toLowerCase() === 'published' &&
        !c.softDeleted
      );
    });
  }

  function isCoursesDataLoading() {
    if (hasCachedCoursesInStorage()) return false;

    if (window.PlatformCourses && typeof window.PlatformCourses.isFirestoreBootstrapping === 'function') {
      return window.PlatformCourses.isFirestoreBootstrapping();
    }
    var FS = window.PlatformCoursesFirestore;
    if (!FS) return false;
    if (typeof FS.isReady === 'function' && !FS.isReady()) return true;
    if (typeof FS.isSeeding === 'function' && FS.isSeeding()) return true;
    return false;
  }

  function getPublishedCourses() {
    if (window.PlatformCourses && typeof window.PlatformCourses.getPublished === 'function') {
      var published = window.PlatformCourses.getPublished().slice();
      if (published.length) return published;
    }
    return getPublishedFromStorageOnly();
  }

  function formatDurationLabel(course) {
    if (window.PlatformCourses && typeof window.PlatformCourses.formatDuration === 'function') {
      var label = window.PlatformCourses.formatDuration(course);
      if (label && label !== '—') return label;
    }
    if (course.durationWeeks) return course.durationWeeks + ' أسبوع';
    if (course.durationHours) return course.durationHours + ' ساعة';
    return 'كورس تدريبي';
  }

  function courseSignature(courses) {
    return courses
      .map(function (c) {
        return [
          c.id,
          c.title,
          c.status,
          c.updatedAt || '',
          c.instructorName || '',
          c.durationHours || 0,
          c.durationWeeks || 0,
          c.price || 0,
          c.imageUrl || c.thumbnailUrl || '',
          c.requiredPlanId || '',
          c.accessLevel || '',
          c.sortOrder != null ? c.sortOrder : '',
        ].join(':');
      })
      .join('|');
  }

  function revealCards(grid) {
    var cards = grid.querySelectorAll('.custom-course-card');
    cards.forEach(function (card, index) {
      window.setTimeout(function () {
        card.classList.add('is-visible');
      }, Math.min(index * 60, 360));
    });
  }

  function renderLoadingState(grid) {
    grid.innerHTML =
      '<div class="public-courses-empty" role="status">' +
      '<div class="public-courses-empty__icon" aria-hidden="true">⏳</div>' +
      '<h3 class="public-courses-empty__title">جاري تحميل الكورسات…</h3>' +
      '<p class="public-courses-empty__text">يتم جلب الكورسات من قاعدة البيانات.</p>' +
      '</div>';
  }

  function renderEmptyState(grid) {
    grid.innerHTML =
      '<div class="public-courses-empty" role="status">' +
      '<div class="public-courses-empty__icon" aria-hidden="true">📚</div>' +
      '<h3 class="public-courses-empty__title">لا توجد كورسات منشورة حالياً</h3>' +
      '<p class="public-courses-empty__text">ستظهر الكورسات هنا تلقائياً فور نشرها من لوحة الإدارة أو المدربين.</p>' +
      '</div>';
  }

  function formatCoursePrice(course) {
    if (window.PlatformCourses && typeof window.PlatformCourses.formatPrice === 'function') {
      return window.PlatformCourses.formatPrice(course);
    }
    var amount = Number(course && course.price);
    if (!isFinite(amount) || amount <= 0) return 'مجاناً';
    var label =
      course && (course.currency === 'USD' || course.currency === '$') ? '$' : 'د.ع';
    return amount + ' ' + label;
  }

  function renderCourseCard(course, index) {
    var title = course.title || 'كورس بدون عنوان';
    var description = course.shortDescription || course.description || '';
    var imageUrl = course.imageUrl || course.thumbnailUrl || '';
    var prerequisites = course.prerequisites || 'لا يوجد';
    var duration = course.duration || formatDurationLabel(course) || 'متاح دائماً';
    var priceLabel = formatCoursePrice(course);
    var imageHtml = imageUrl
      ? '<img src="' + escapeHtml(imageUrl) + '" alt="' + escapeHtml(title) + '">'
      : '<div class="custom-course-card__image-fallback" aria-hidden="true"></div>';

    return (
      '<article class="custom-course-card" data-course-id="' +
      escapeHtml(course.id) +
      '" style="--card-index:' +
      index +
      '">' +
      '<div class="custom-course-card__image">' +
      imageHtml +
      '</div>' +
      '<div class="custom-course-card__content">' +
      '<h3 class="custom-course-card__title">' +
      escapeHtml(title) +
      '</h3>' +
      '<p class="custom-course-card__description">' +
      escapeHtml(description) +
      '</p>' +
      '<div class="custom-course-card__meta">' +
      '<div class="meta-row">' +
      '<span class="meta-label">المتطلبات:</span>' +
      '<span class="meta-value meta-value--highlight">' +
      escapeHtml(prerequisites) +
      '</span>' +
      '</div>' +
      '<div class="meta-row">' +
      '<span class="meta-label">تاريخ البدء / المدة:</span>' +
      '<span class="meta-value meta-value--highlight">' +
      escapeHtml(duration) +
      '</span>' +
      '</div>' +
      '<div class="meta-row">' +
      '<span class="meta-label">السعر:</span>' +
      '<span class="meta-value">' +
      escapeHtml(priceLabel) +
      '</span>' +
      '</div>' +
      '</div>' +
      '<a href="course-details.html?id=' +
      encodeURIComponent(course.id) +
      '" class="custom-course-card__btn">تفاصيل الكورس</a>' +
      '</div>' +
      '</article>'
    );
  }

  /** Render published courses into #publicCoursesGrid (or legacy timeline id). */
  function renderPublicCourses() {
    var grid =
      document.getElementById(GRID_ID) || document.getElementById('publicCoursesTimeline');
    if (!grid) return;

    if (isCoursesDataLoading()) {
      lastSignature = '__loading__';
      renderLoadingState(grid);
      return;
    }

    var courses = getPublishedCourses();
    courses.sort(function (a, b) {
      if (window.PlatformCourses && typeof window.PlatformCourses.sortByDisplayOrder === 'function') {
        return window.PlatformCourses.sortByDisplayOrder(a, b);
      }
      var ao = a.sortOrder != null ? Number(a.sortOrder) : Number.MAX_SAFE_INTEGER;
      var bo = b.sortOrder != null ? Number(b.sortOrder) : Number.MAX_SAFE_INTEGER;
      if (ao !== bo) return ao - bo;
      return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    });

    var signature = courseSignature(courses);
    if (signature === lastSignature && grid.childElementCount) return;
    lastSignature = signature;

    if (!courses.length) {
      renderEmptyState(grid);
      return;
    }

    grid.innerHTML = courses.map(renderCourseCard).join('');
    revealCards(grid);
  }

  function bindLiveSync() {
    window.addEventListener('storage', function (e) {
      if (
        !e.key ||
        e.key === COURSES_KEY ||
        e.key === LEGACY_KEY ||
        e.key === 'platform_plans'
      ) {
        renderPublicCourses();
        renderCourseDetailsPage();
      }
    });

    document.addEventListener('ifa:platform-courses-changed', renderPublicCourses);
    window.addEventListener('ifa:platform-courses-changed', renderPublicCourses);
    document.addEventListener('ifa:courses-firestore-changed', renderPublicCourses);
    window.addEventListener('ifa:courses-firestore-changed', renderPublicCourses);
    document.addEventListener('ifa:platform-plans-changed', renderPublicCourses);
    window.addEventListener('ifa:platform-plans-changed', renderPublicCourses);
    document.addEventListener('ifa:pricing-firestore-changed', renderPublicCourses);
    window.addEventListener('ifa:pricing-firestore-changed', renderPublicCourses);

    document.addEventListener('ifa:platform-courses-changed', renderCourseDetailsPage);
    window.addEventListener('ifa:platform-courses-changed', renderCourseDetailsPage);
    document.addEventListener('ifa:courses-firestore-changed', renderCourseDetailsPage);
    window.addEventListener('ifa:courses-firestore-changed', renderCourseDetailsPage);

    (function waitForCoursesFirestoreSubscribe(attempts) {
      if (window.PlatformCoursesFirestore && typeof window.PlatformCoursesFirestore.subscribe === 'function') {
        window.PlatformCoursesFirestore.subscribe(function () {
          renderPublicCourses();
          renderCourseDetailsPage();
        });
        return;
      }
      if (attempts > 40) return;
      window.setTimeout(function () {
        waitForCoursesFirestoreSubscribe(attempts + 1);
      }, 50);
    })(0);

    /* Lightweight same-origin poll so publish from another tab/window
       still updates even if a browser skips the storage event. */
    window.setInterval(function () {
      var next = courseSignature(getPublishedCourses());
      if (next !== lastSignature) renderPublicCourses();
    }, 1500);
  }

  function initPublicCourses() {
    renderPublicCourses();
    bindLiveSync();
    renderCourseDetailsPage();
  }

  function readAuthUser() {
    try {
      var raw = localStorage.getItem('ifa_auth_user');
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && parsed.email ? parsed : null;
    } catch (err) {
      return null;
    }
  }

  function isFreeTierCourse(course) {
    if (!course) return false;

    var parsePrice =
      window.PlatformPlans && typeof window.PlatformPlans.parsePrice === 'function'
        ? window.PlatformPlans.parsePrice
        : Number;
    var coursePrice = parsePrice(course.price);

    if (isFinite(coursePrice) && coursePrice > 0) return false;

    var requiredPlanId = String(course.requiredPlanId || '').trim();
    if (requiredPlanId) {
      if (window.PlatformPlansPublic && typeof window.PlatformPlansPublic.findPlanById === 'function') {
        var linkedPlan = window.PlatformPlansPublic.findPlanById(requiredPlanId);
        if (linkedPlan) {
          var planPrice = parsePrice(linkedPlan.price);
          if (isFinite(planPrice) && planPrice > 0) return false;
        } else {
          return false;
        }
      } else {
        return false;
      }
    }

    return true;
  }

  function isCoursePreviewMode() {
    try {
      var params = new URLSearchParams(window.location.search);
      var isPreviewParam = params.get('preview') === '1' || params.get('mode') === 'admin-preview';

      if (isPreviewParam) {
        var user = typeof readAuthUser === 'function' ? readAuthUser() : null;
        if (user && (user.isAdmin || user.isInstructor || String(user.role || '').toLowerCase() === 'admin')) {
          return true;
        }
      }
    } catch (err) {
      /* ignore */
    }
    return false;
  }

  function isCoursePublished(course) {
    if (!course) return false;
    if (course.softDeleted) return false;
    return String(course.status || '').toLowerCase() === 'published';
  }

  function canViewCourseDetails(course) {
    if (!course) return false;
    if (isCoursePublished(course)) return true;
    return isCoursePreviewMode();
  }

  function viewerHasCourseAccess(course) {
    if (isCoursePreviewMode()) return true;
    var user = readAuthUser();
    if (!user) return false;
    if (user.isAdmin || user.isInstructor || String(user.role || '').toLowerCase() === 'admin') return true;
    if (isFreeTierCourse(course)) return true;

    if (!course) return false;

    var enrolled = Array.isArray(user.enrolledCourseIds)
      ? user.enrolledCourseIds.map(function (id) {
          return String(id);
        })
      : [];
    if (enrolled.indexOf(String(course.id)) !== -1) return true;

    var requiredPlanId = String(course.requiredPlanId || '').trim();
    if (requiredPlanId) {
      if (
        window.PlatformPlansPublic &&
        typeof window.PlatformPlansPublic.userHasPlanAccess === 'function'
      ) {
        var linkedPlan = window.PlatformPlansPublic.findPlanById(requiredPlanId);
        if (linkedPlan && window.PlatformPlansPublic.userHasPlanAccess(linkedPlan, user)) {
          return true;
        }
      } else if (String(user.planId || '') === requiredPlanId) {
        return true;
      }
    }

    return false;
  }

  function extractYouTubeId(url) {
    var raw = String(url || '').trim();
    if (!raw) return '';

    var patterns = [
      /(?:youtube\.com\/watch\?.*v=|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/i,
      /youtu\.be\/([A-Za-z0-9_-]{11})/i,
      /youtube-nocookie\.com\/embed\/([A-Za-z0-9_-]{11})/i,
      /m\.youtube\.com\/watch\?.*v=([A-Za-z0-9_-]{11})/i,
    ];

    for (var i = 0; i < patterns.length; i++) {
      var match = raw.match(patterns[i]);
      if (match && match[1]) return match[1];
    }
    return '';
  }

  function youtubeEmbedUrl(url) {
    var id = extractYouTubeId(url);
    return id ? 'https://www.youtube.com/embed/' + id : '';
  }

  function isDirectVideoUrl(url) {
    var raw = String(url || '').trim().toLowerCase();
    if (!raw || extractYouTubeId(url)) return false;
    return (
      /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(raw) ||
      raw.indexOf('firebasestorage.googleapis.com') !== -1 ||
      raw.indexOf('storage.googleapis.com') !== -1
    );
  }

  function lessonPassedKey(courseId, lessonId) {
    return 'passed_' + courseId + '_' + lessonId;
  }

  function isLessonPassed(course, lesson) {
    if (!course || !lesson) return false;
    try {
      return localStorage.getItem(lessonPassedKey(course.id, lesson.id)) === 'true';
    } catch (err) {
      return false;
    }
  }

  function markLessonPassed(course, lesson) {
    if (!course || !lesson) return;
    try {
      localStorage.setItem(lessonPassedKey(course.id, lesson.id), 'true');
    } catch (err) {
      /* ignore */
    }
  }

  function orderedCourseLessons(course) {
    var lessons = Array.isArray(course && course.lessons) ? course.lessons.slice() : [];
    lessons.sort(function (a, b) {
      return (Number(a.order) || 0) - (Number(b.order) || 0);
    });
    return lessons;
  }

  function lessonCanPlay(lesson, course) {
    var allowed = !!((lesson && lesson.isFreePreview) || viewerHasCourseAccess(course));
    if (!allowed || !lesson || !course) return false;
    var lessons = orderedCourseLessons(course);
    var idx = -1;
    for (var i = 0; i < lessons.length; i++) {
      if (String(lessons[i].id) === String(lesson.id)) {
        idx = i;
        break;
      }
    }
    if (idx <= 0) return true;
    for (var p = 0; p < idx; p++) {
      if (!isLessonPassed(course, lessons[p])) return false;
    }
    return true;
  }

  function nextLessonHref(course, lesson) {
    var lessons = orderedCourseLessons(course);
    var idx = -1;
    for (var i = 0; i < lessons.length; i++) {
      if (String(lessons[i].id) === String(lesson.id)) {
        idx = i;
        break;
      }
    }
    if (idx < 0 || idx >= lessons.length - 1) return '';
    return (
      'course-details.html?id=' +
      encodeURIComponent(course.id) +
      '&lesson=' +
      encodeURIComponent(lessons[idx + 1].id)
    );
  }

  function showNextLessonAction(course, lesson) {
    var box = document.getElementById('course-lesson-next');
    if (!box) return;
    var href = nextLessonHref(course, lesson);
    if (!href) {
      box.innerHTML = '<p class="course-quiz__result">أكملت هذه الحلقة.</p>';
      return;
    }
    box.innerHTML =
      '<p class="course-details__cta"><a class="btn btn--primary" href="' +
      href +
      '">الدرس التالي</a></p>';
  }

  function destroyCoursePlyrPlayer() {
    if (!coursePlyrPlayer) return;
    try {
      coursePlyrPlayer.destroy();
    } catch (err) {
      /* ignore */
    }
    coursePlyrPlayer = null;
  }

  function bindCoursePlayerProtection(container) {
    if (!container) return;
    var wrap = container.querySelector('.course-details__player--youtube');
    if (!wrap || wrap.dataset.shieldBound === '1') return;
    wrap.dataset.shieldBound = '1';
    wrap.addEventListener('contextmenu', function (e) {
      e.preventDefault();
    });
  }

  function initCoursePlyrPlayer(container) {
    destroyCoursePlyrPlayer();
    if (!container || typeof window.Plyr !== 'function') return;

    var el = container.querySelector('#course-video-player');
    if (!el || el.getAttribute('data-plyr-provider') !== 'youtube') return;

    coursePlyrPlayer = new window.Plyr(el, {
      youtube: PLYR_YOUTUBE_OPTIONS,
      controls: PLYR_YOUTUBE_CONTROLS,
      settings: ['speed'],
      speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 2] },
      fullscreen: { iosNative: true },
    });

    coursePlyrPlayer.on('ended', revealLessonQuiz);
    bindCoursePlayerProtection(container);
  }

  function revealLessonQuiz() {
    var ctx = activeLessonContext;
    var questions = ctx && ctx.lesson && ctx.lesson.quiz && ctx.lesson.quiz.questions;
    if (!questions || !questions.length) {
      if (ctx) {
        markLessonPassed(ctx.course, ctx.lesson);
        showNextLessonAction(ctx.course, ctx.lesson);
      }
      return;
    }
    var quiz = document.getElementById('course-lesson-quiz');
    if (!quiz) return;
    quiz.hidden = false;
    quiz.classList.remove('is-hidden');
  }

  function bindQuizSubmit(container) {
    var button = container && container.querySelector('#submit-quiz');
    if (!button || button.dataset.bound === '1') return;
    button.dataset.bound = '1';
    button.addEventListener('click', function () {
      var ctx = activeLessonContext;
      if (!ctx) return;
      var questions = (ctx.lesson.quiz && ctx.lesson.quiz.questions) || [];
      if (!questions.length) return;
      var correct = 0;
      questions.forEach(function (q, qIdx) {
        var selected = container.querySelector(
          'input[name="q-' + String(q.id || qIdx) + '"]:checked'
        );
        if (selected && Number(selected.value) === Number(q.correctIndex)) correct += 1;
      });
      var score = Math.round((correct / questions.length) * 100);
      var result = document.getElementById('quiz-result');
      var bar =
        '<div class="quiz-score" style="margin:16px 0;background:#2d3748;border-radius:999px;overflow:hidden;height:12px;">' +
        '<div style="width:' +
        score +
        '%;height:100%;background:' +
        (score >= 50 ? '#38a169' : '#e53e3e') +
        ';"></div></div>' +
        '<p class="course-quiz__result">' +
        score +
        '%</p>';
      if (score >= 50) {
        markLessonPassed(ctx.course, ctx.lesson);
        if (result) {
          result.innerHTML = bar + '<p class="course-quiz__result">أحسنت، لقد اجتزت الاختبار.</p>';
        }
        showNextLessonAction(ctx.course, ctx.lesson);
      } else {
        var next = document.getElementById('course-lesson-next');
        if (next) next.innerHTML = '';
        if (result) {
          result.innerHTML = bar + '<p class="course-quiz__result">حاول مرة أخرى</p>';
        }
      }
    });
  }

  function bindNativeVideoEnded(container) {
    var video = container && container.querySelector('.course-details__player video');
    if (!video || video.dataset.quizBound === '1') return;
    video.dataset.quizBound = '1';
    video.addEventListener('ended', revealLessonQuiz);
  }

  function resolveLessonYouTubeId(lesson) {
    if (!lesson) return '';
    var storedId = lesson.videoId ? String(lesson.videoId).trim() : '';
    if (storedId && /^[A-Za-z0-9_-]{11}$/.test(storedId)) return storedId;
    var videoUrl = lesson.videoUrl ? String(lesson.videoUrl).trim() : '';
    return extractYouTubeId(videoUrl);
  }

  function renderLessonPlayer(lesson) {
    var videoUrl = lesson && lesson.videoUrl ? String(lesson.videoUrl).trim() : '';
    var youtubeId = resolveLessonYouTubeId(lesson);
    if (youtubeId) {
      return (
        '<div class="course-details__player course-details__player--youtube">' +
        '<div class="course-details__player-shield course-details__player-shield--top" aria-hidden="true"></div>' +
        '<div class="course-details__player-shield course-details__player-shield--bottom" aria-hidden="true"></div>' +
        '<div id="course-video-player" class="course-details__plyr" data-plyr-provider="youtube" data-plyr-embed-id="' +
        escapeHtml(youtubeId) +
        '"></div>' +
        '</div>'
      );
    }
    if (videoUrl && (isDirectVideoUrl(videoUrl) || /^https?:\/\//i.test(videoUrl))) {
      return (
        '<div class="course-details__player">' +
        '<video controls playsinline src="' +
        escapeHtml(videoUrl) +
        '"></video>' +
        '</div>'
      );
    }
    return '<p class="course-details__no-video">لا يوجد فيديو مرفوع لهذه الحلقة بعد.</p>';
  }

  function renderStudentLessonQuiz(lesson) {
    var questions = (lesson.quiz && lesson.quiz.questions) || [];
    if (!questions.length) return '';
    var letters = ['أ', 'ب', 'ج', 'د'];
    var items = questions.map(function (q, qIdx) {
      var opts = (q.options || []).map(function (o, i) {
        return (
          '<label class="quiz-option-item">' +
          '<input type="radio" name="q-' + escapeHtml(q.id || qIdx) + '" value="' + i + '">' +
          '<span>' + escapeHtml((letters[i] || i + 1) + ') ' + o) + '</span>' +
          '</label>'
        );
      }).join('');
      return (
        '<div class="quiz-question-block">' +
        '<h4 class="quiz-question-title">س' + (qIdx + 1) + ': ' + escapeHtml(q.text || '') + '</h4>' +
        '<div class="quiz-options-list">' +
        opts +
        '</div>' +
        '</div>'
      );
    }).join('');
    return (
      '<section class="course-quiz is-hidden" id="course-lesson-quiz" hidden>' +
      '<h3 class="course-quiz__title">امتحان الحلقة / الاختبار</h3>' +
      items +
      '<div id="quiz-result"></div>' +
      '<button type="button" class="btn btn--primary" id="submit-quiz">تسليم الاختبار</button>' +
      '</section>'
    );
  }

  function getCourseIdFromUrl() {
    try {
      return String(new URLSearchParams(window.location.search).get('id') || '').trim();
    } catch (err) {
      return '';
    }
  }

  function findCourseInCache(courseId) {
    if (!courseId) return null;
    if (window.PlatformCourses && typeof window.PlatformCourses.findCourse === 'function') {
      return window.PlatformCourses.findCourse(courseId);
    }
    var courses = fetchCoursesFromLocalStorage();
    for (var i = 0; i < courses.length; i++) {
      if (String(courses[i].id) === courseId) return courses[i];
    }
    return null;
  }

  async function fetchCourseByIdFallback(courseId) {
    var FS = window.PlatformCoursesFirestore;
    if (FS && typeof FS.fetchCourseById === 'function') {
      return FS.fetchCourseById(courseId);
    }
    if (FS && typeof FS.findCourse === 'function') {
      return FS.findCourse(courseId);
    }
    return null;
  }

  function renderCourseDetailsLoading(root) {
    root.innerHTML =
      '<div class="public-courses-empty" role="status">' +
      '<div class="public-courses-empty__icon" aria-hidden="true">⏳</div>' +
      '<h3 class="public-courses-empty__title">جاري تحميل الكورس…</h3>' +
      '<p class="public-courses-empty__text">يتم جلب بيانات الكورس من قاعدة البيانات.</p>' +
      '</div>';
  }

  function renderCourseDetailsNotFound(root) {
    root.innerHTML =
      '<p class="course-details__empty">الكورس غير موجود. <a href="index.html#courses">العودة للكورسات</a></p>';
  }

  function renderCourseDetailsUnpublished(root) {
    root.innerHTML =
      '<p class="course-details__empty">هذا الكورس غير منشور حالياً. <a href="index.html#courses">العودة للكورسات</a></p>';
  }

  async function renderCourseDetailsPage() {
    var root = document.getElementById('courseDetailsRoot');
    if (!root) return;

    destroyCoursePlyrPlayer();

    var seq = ++detailsRenderSeq;
    var courseId = getCourseIdFromUrl();
    if (!courseId) {
      renderCourseDetailsNotFound(root);
      return;
    }

    if (isCoursesDataLoading() && !hasCachedCoursesInStorage()) {
      renderCourseDetailsLoading(root);
      return;
    }

    var course = findCourseInCache(courseId);
    if (!course) {
      if (!hasCachedCoursesInStorage()) {
        renderCourseDetailsLoading(root);
      }
      course = await fetchCourseByIdFallback(courseId);
      if (seq !== detailsRenderSeq) return;
    }

    if (!course) {
      renderCourseDetailsNotFound(root);
      return;
    }

    if (!canViewCourseDetails(course)) {
      renderCourseDetailsUnpublished(root);
      return;
    }

    var lessons = Array.isArray(course.lessons) ? course.lessons.slice() : [];
    lessons.sort(function (a, b) {
      return (Number(a.order) || 0) - (Number(b.order) || 0);
    });
    var subscribed = viewerHasCourseAccess(course);
    var activeId = '';
    try {
      activeId = String(new URLSearchParams(window.location.search).get('lesson') || '');
    } catch (err2) {
      activeId = '';
    }
    var active = null;
    if (activeId) {
      for (var j = 0; j < lessons.length; j++) {
        if (String(lessons[j].id) === activeId) {
          active = lessons[j];
          break;
        }
      }
    }

    var listHtml = lessons.length
      ? lessons
          .map(function (lesson, i) {
            var free = !!lesson.isFreePreview;
            var canPlay = lessonCanPlay(lesson, course);
            var isActive = active && String(active.id) === String(lesson.id);
            var href =
              'course-details.html?id=' +
              encodeURIComponent(course.id) +
              '&lesson=' +
              encodeURIComponent(lesson.id);
            var badge = free
              ? '<span class="course-lesson__badge course-lesson__badge--free">معاينة مجانية</span>'
              : canPlay
                ? ''
                : '<span class="course-lesson__badge course-lesson__badge--lock">🔒 يتطلب الاشتراك بالباقة</span>';
            if (canPlay) {
              return (
                '<a class="course-lesson' +
                (isActive ? ' is-active' : '') +
                '" href="' +
                href +
                '">' +
                '<span class="course-lesson__title">' +
                '<span class="curriculum-number">' + (i + 1) + '- </span>' +
                escapeHtml(lesson.title || 'حلقة') +
                '</span>' +
                badge +
                '</a>'
              );
            }
            return (
              '<div class="course-lesson course-lesson--locked">' +
              '<span class="course-lesson__title">' +
              '<span class="curriculum-number">' + (i + 1) + '- </span>' +
              escapeHtml(lesson.title || 'حلقة') +
              '</span>' +
              badge +
              '<a class="course-lesson__plans" href="index.html#plans">عرض الباقات</a>' +
              '</div>'
            );
          })
          .join('')
      : '<p class="course-details__empty">لا توجد حلقات بعد.</p>';

    var overviewUrl = 'course-details.html?id=' + encodeURIComponent(course.id);
    var pageHtml = '';

    if (!active) {
      var targetLesson = null;
      for (var t = 0; t < lessons.length; t++) {
        if (lessonCanPlay(lessons[t], course)) {
          targetLesson = lessons[t];
          break;
        }
      }
      if (!targetLesson && lessons.length) targetLesson = lessons[0];
      var durationLabel = course.duration || '';
      if (!durationLabel) {
        var formattedDuration = formatDurationLabel(course);
        durationLabel =
          formattedDuration && formattedDuration !== 'كورس تدريبي' ? formattedDuration : 'TBA';
      }
      var priceLabel = formatCoursePrice(course);
      var enrollHref = 'index.html#plans';
      if (targetLesson && (subscribed || lessonCanPlay(targetLesson, course))) {
        enrollHref = overviewUrl + '&lesson=' + encodeURIComponent(targetLesson.id);
      }
      pageHtml =
        '<div class="course-hero-banner" id="courseHeroBanner">' +
        '<div class="course-hero-container">' +
        '<div class="course-floating-card">' +
        '<h1 class="course-floating-title" id="courseTitle">' +
        escapeHtml(course.title || '') +
        '</h1>' +
        '<div class="course-floating-meta">' +
        '<div class="meta-item">' +
        '<span class="meta-label">السعر</span>' +
        '<span class="meta-value" id="coursePrice">' +
        escapeHtml(priceLabel) +
        '</span>' +
        '</div>' +
        '<div class="meta-item">' +
        '<span class="meta-label">المدة</span>' +
        '<span class="meta-value" id="courseDuration">' +
        escapeHtml(durationLabel) +
        '</span>' +
        '</div>' +
        '</div>' +
        '<a class="course-enroll-btn" href="' +
        enrollHref +
        '">اشترك الآن</a>' +
        '</div>' +
        '</div>' +
        '</div>' +
        '<div class="course-main-content">' +
        '<h2 class="section-title">عن الكورس</h2>' +
        '<p id="courseDescription">' +
        escapeHtml(course.description || '') +
        '</p>' +
        (subscribed ? '' : '<p class="course-details__hint">يمكنك مشاهدة الحلقات المحددة كمعاينة مجانية. بقية المحتوى يتطلب الاشتراك.</p>') +
        (!isCoursePublished(course) && isCoursePreviewMode()
          ? '<p class="course-details__hint">معاينة إدارية — الكورس غير منشور للجمهور.</p>'
          : '') +
        '<aside class="course-details__curriculum">' +
        '<h2>المنهج</h2>' +
        listHtml +
        '</aside>' +
        '</div>';
    } else {
      var playerHtml = '';
      if (lessonCanPlay(active, course)) {
        playerHtml =
          '<h2 class="course-details__lesson-title">' +
          escapeHtml(active.title || '') +
          (active.isFreePreview ? ' <span class="course-lesson__badge course-lesson__badge--free">معاينة مجانية</span>' : '') +
          '</h2>' +
          (active.description ? '<p class="course-details__lesson-desc">' + escapeHtml(active.description) + '</p>' : '') +
          renderLessonPlayer(active) +
          renderStudentLessonQuiz(active) +
          '<div id="course-lesson-next"></div>';
      } else {
        playerHtml =
          '<div class="course-details__locked-panel">' +
          '<p>🔒 يتطلب الاشتراك بالباقة</p>' +
          '<a class="btn btn--primary" href="index.html#plans">عرض الباقات</a>' +
          '</div>';
      }
      pageHtml =
        '<div class="container">' +
        '<header class="course-details__header">' +
        '<p class="course-details__back"><a href="' +
        overviewUrl +
        '">← العودة للكورس</a></p>' +
        '<h1 class="course-details__title">' +
        escapeHtml(course.title || '') +
        '</h1>' +
        '</header>' +
        '<section class="course-details__stage">' +
        playerHtml +
        '</section>' +
        '</div>';
    }

    root.innerHTML = pageHtml;

    if (!active) {
      var banner = document.getElementById('courseHeroBanner');
      var coverUrl = course.imageUrl || course.thumbnailUrl || '';
      if (banner && coverUrl) {
        banner.style.backgroundImage = "url('" + String(coverUrl).replace(/'/g, '%27') + "')";
      }
    }

    if (active && lessonCanPlay(active, course)) {
      activeLessonContext = { course: course, lesson: active };
      window.requestAnimationFrame(function () {
        if (seq !== detailsRenderSeq) return;
        initCoursePlyrPlayer(root);
        bindNativeVideoEnded(root);
        bindQuizSubmit(root);
      });
    } else {
      activeLessonContext = null;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPublicCourses);
  } else {
    initPublicCourses();
  }

  window.renderPublicCourses = renderPublicCourses;
  window.fetchCoursesFromLocalStorage = fetchCoursesFromLocalStorage;
  window.renderCourseDetailsPage = renderCourseDetailsPage;
  window.extractYouTubeId = extractYouTubeId;
})();
