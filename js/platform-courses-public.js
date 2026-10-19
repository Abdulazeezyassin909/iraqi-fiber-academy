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
          c.requiredPlanId || '',
          c.accessLevel || '',
          c.sortOrder != null ? c.sortOrder : '',
        ].join(':');
      })
      .join('|');
  }

  function revealCards(grid) {
    var cards = grid.querySelectorAll('.public-course-card');
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

  function accessPlanLabel(course) {
    if (window.PlatformCourses && typeof window.PlatformCourses.formatCourseAccessLabel === 'function') {
      return window.PlatformCourses.formatCourseAccessLabel(course);
    }
    return '';
  }

  function renderCourseCard(course, index) {
    var instructor = course.instructorName || course.instructorEmail || '';
    var lessonCount = Array.isArray(course.lessons) ? course.lessons.length : 0;
    var priceLabel = formatCoursePrice(course);
    var planLabel = accessPlanLabel(course);
    var planChip = planLabel
      ? '<span class="public-course-card__plan" title="باقة الوصول">' +
        escapeHtml(planLabel) +
        '</span>'
      : '';

    var footer =
      '<footer class="public-course-card__footer">' +
      '<div class="public-course-card__instructor">' +
      '<span class="public-course-card__footer-label">المدرب</span>' +
      '<span class="public-course-card__footer-value">' +
      escapeHtml(instructor || 'الأكاديمية') +
      '</span>' +
      '</div>' +
      '<div class="public-course-card__meta">' +
      '<span class="public-course-card__price">' +
      escapeHtml(priceLabel) +
      '</span>' +
      '<span class="public-course-card__episodes">' +
      (lessonCount ? lessonCount + ' حلقة' : 'قريباً') +
      '</span>' +
      '</div>' +
      '</footer>';

    return (
      '<a class="public-course-card-link" href="course-details.html?id=' +
      encodeURIComponent(course.id) +
      '">' +
      '<article class="public-course-card" data-course-id="' +
      escapeHtml(course.id) +
      '" data-access-level="' +
      escapeHtml(course.accessLevel || '') +
      '" data-required-plan="' +
      escapeHtml(course.requiredPlanId || '') +
      '" style="--card-index:' +
      index +
      '">' +
      '<div class="public-course-card__header">' +
      '<span class="public-course-card__badge">منشور</span>' +
      planChip +
      '<span class="public-course-card__duration">⏱ ' +
      escapeHtml(formatDurationLabel(course)) +
      '</span>' +
      '</div>' +
      '<div class="public-course-card__body">' +
      '<h3 class="public-course-card__title">' +
      escapeHtml(course.title || 'كورس بدون عنوان') +
      '</h3>' +
      '<p class="public-course-card__desc">' +
      escapeHtml(course.description || 'لا يوجد وصف لهذا الكورس بعد.') +
      '</p>' +
      '</div>' +
      footer +
      '</article>' +
      '</a>'
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

  function lessonCanPlay(lesson, course) {
    if (lesson && lesson.isFreePreview) return true;
    return viewerHasCourseAccess(course);
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
      settings: ['quality', 'speed'],
      quality: {
        default: 1080,
        options: [1080, 720, 480, 360],
      },
      fullscreen: { iosNative: true },
    });

    // YouTube getAvailableQualityLevels() is empty at onReady (before playback).
    // Plyr 3.7.8 reads it once then, so the Quality row is omitted. Speed is local.
    var ytQualityFromLabel = { hd2160: 2160, hd1440: 1440, hd1080: 1080, hd720: 720, large: 480, medium: 360, small: 240, tiny: 144 };
    var ytLabelFromQuality = { 2160: 'hd2160', 1440: 'hd1440', 1080: 'hd1080', 720: 'hd720', 480: 'large', 360: 'medium', 240: 'small', 144: 'tiny' };

    function injectYouTubeQualityMenu(player, sizes) {
      var menu = player.elements.container.querySelector('[data-plyr="settings"] .plyr__menu__container [role="menu"], [data-plyr="settings"] .plyr__menu__container');
      if (!menu || menu.querySelector('[data-plyr="quality"]')) return;
      var speedBtn = menu.querySelector('[data-plyr="speed"]');
      if (!speedBtn || !speedBtn.parentNode) return;

      var home = document.createElement('div');
      var forward = document.createElement('button');
      forward.type = 'button';
      forward.className = speedBtn.className;
      forward.setAttribute('data-plyr', 'quality');
      forward.innerHTML = '<span>Quality</span>';
      home.appendChild(forward);

      var panel = document.createElement('div');
      panel.hidden = true;
      var back = document.createElement('button');
      back.type = 'button';
      back.className = speedBtn.className.replace('plyr__control--forward', 'plyr__control--back');
      back.textContent = 'Quality';
      var list = document.createElement('div');
      list.setAttribute('role', 'menu');
      sizes.forEach(function (size) {
        var item = document.createElement('button');
        item.type = 'button';
        item.className = 'plyr__control';
        item.setAttribute('role', 'menuitemradio');
        item.setAttribute('value', String(size));
        item.innerHTML = '<span>' + size + 'p</span>';
        item.addEventListener('click', function () {
          var embed = player.embed;
          if (embed && typeof embed.setPlaybackQuality === 'function') {
            embed.setPlaybackQuality(ytLabelFromQuality[size] || 'auto');
          }
          var buttons = list.querySelectorAll('button');
          for (var i = 0; i < buttons.length; i++) buttons[i].setAttribute('aria-checked', buttons[i] === item ? 'true' : 'false');
        });
        list.appendChild(item);
      });
      panel.appendChild(back);
      panel.appendChild(list);

      forward.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        home.hidden = true;
        panel.hidden = false;
      });
      back.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        panel.hidden = true;
        home.hidden = false;
      });

      speedBtn.parentNode.parentNode.insertBefore(home, speedBtn.parentNode);
      speedBtn.parentNode.parentNode.insertBefore(panel, speedBtn.parentNode);
    }

    coursePlyrPlayer.on('playing', function () {
      // Prevent running multiple intervals if the user pauses and plays again
      if (coursePlyrPlayer.__qualityPollingStarted) return;
      coursePlyrPlayer.__qualityPollingStarted = true;

      var tries = 0;
      var timer = window.setInterval(function () {
        tries += 1;
        var embed = coursePlyrPlayer && coursePlyrPlayer.embed;
        var labels = embed && typeof embed.getAvailableQualityLevels === 'function' ? embed.getAvailableQualityLevels() : [];

        var sizes = [];
        for (var i = 0; i < labels.length; i++) {
          var size = ytQualityFromLabel[labels[i]];
          if (size) sizes.push(size);
        }

        // Once YouTube returns the sizes, inject and stop polling
        if (sizes.length > 0) {
          window.clearInterval(timer);
          injectYouTubeQualityMenu(coursePlyrPlayer, sizes);
          return;
        }

        // Stop checking after 15 seconds to prevent infinite loops (30 tries * 500ms)
        if (tries > 30) {
          window.clearInterval(timer);
          coursePlyrPlayer.__qualityPollingStarted = false; // Allow retrying later if needed
        }
      }, 500);
    });

    bindCoursePlayerProtection(container);
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
    for (var j = 0; j < lessons.length; j++) {
      if (String(lessons[j].id) === activeId) {
        active = lessons[j];
        break;
      }
    }
    if (!active) {
      for (var k = 0; k < lessons.length; k++) {
        if (lessonCanPlay(lessons[k], course)) {
          active = lessons[k];
          break;
        }
      }
    }
    if (!active && lessons.length) active = lessons[0];

    var listHtml = lessons.length
      ? lessons
          .map(function (lesson) {
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
                escapeHtml(lesson.title || 'حلقة') +
                '</span>' +
                badge +
                '</a>'
              );
            }
            return (
              '<div class="course-lesson course-lesson--locked">' +
              '<span class="course-lesson__title">' +
              escapeHtml(lesson.title || 'حلقة') +
              '</span>' +
              badge +
              '<a class="course-lesson__plans" href="index.html#plans">عرض الباقات</a>' +
              '</div>'
            );
          })
          .join('')
      : '<p class="course-details__empty">لا توجد حلقات بعد.</p>';

    var playerHtml = '';
    if (active && lessonCanPlay(active, course)) {
      playerHtml =
        '<h2 class="course-details__lesson-title">' +
        escapeHtml(active.title || '') +
        (active.isFreePreview ? ' <span class="course-lesson__badge course-lesson__badge--free">معاينة مجانية</span>' : '') +
        '</h2>' +
        (active.description ? '<p class="course-details__lesson-desc">' + escapeHtml(active.description) + '</p>' : '') +
        renderLessonPlayer(active);
    } else if (active) {
      playerHtml =
        '<div class="course-details__locked-panel">' +
        '<p>🔒 يتطلب الاشتراك بالباقة</p>' +
        '<a class="btn btn--primary" href="index.html#plans">عرض الباقات</a>' +
        '</div>';
    }

    root.innerHTML =
      '<header class="course-details__header">' +
      '<p class="course-details__back"><a href="index.html#courses">← العودة للكورسات</a></p>' +
      '<h1 class="course-details__title">' +
      escapeHtml(course.title || '') +
      '</h1>' +
      '<p class="course-details__desc">' +
      escapeHtml(course.description || '') +
      '</p>' +
      (subscribed ? '' : '<p class="course-details__hint">يمكنك مشاهدة الحلقات المحددة كمعاينة مجانية. بقية المحتوى يتطلب الاشتراك.</p>') +
      (!isCoursePublished(course) && isCoursePreviewMode()
        ? '<p class="course-details__hint">معاينة إدارية — الكورس غير منشور للجمهور.</p>'
        : '') +
      '</header>' +
      '<div class="course-details__layout">' +
      '<aside class="course-details__curriculum">' +
      '<h2>المنهج</h2>' +
      listHtml +
      '</aside>' +
      '<section class="course-details__stage">' +
      playerHtml +
      '</section>' +
      '</div>';

    window.requestAnimationFrame(function () {
      if (seq !== detailsRenderSeq) return;
      initCoursePlyrPlayer(root);
    });
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
