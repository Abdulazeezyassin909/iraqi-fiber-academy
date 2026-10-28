/**
 * Admin courses management UI for admin.html
 * Catalog presets, drafts soft-delete, academy instructor assignment.
 */
(function () {
  'use strict';

  var searchQuery = '';
  var statusFilter = 'active';
  var instructorFilter = 'all';
  var lessonDrafts = [];
  var uploadTimer = null;
  var toastTimer = null;
  var dragCourseId = null;
  var dragRowEl = null;
  var dragBound = false;
  var coursesLiveBound = false;

  function usesFirestoreCourses() {
    return !!(
      window.PlatformCoursesFirestore &&
      typeof window.PlatformCoursesFirestore.isReady === 'function' &&
      window.PlatformCoursesFirestore.isReady()
    );
  }

  function isCoursesAdminDataLoading() {
    var Firestore = window.PlatformCoursesFirestore;
    if (!Firestore) return true;
    if (typeof Firestore.isReady === 'function' && !Firestore.isReady()) return true;
    if (typeof Firestore.isSeeding === 'function' && Firestore.isSeeding()) return true;
    return false;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function courseThumbHtml(url) {
    if (!url) return '<span class="course-thumb course-thumb--empty" aria-hidden="true"></span>';
    return '<img class="course-thumb" src="' + escapeHtml(url) + '" alt="" />';
  }

  function setCourseImagePreview(url, hiddenId, previewId, fileId) {
    var hidden = document.getElementById(hiddenId);
    var preview = document.getElementById(previewId);
    var file = document.getElementById(fileId);
    if (hidden) hidden.value = url || '';
    if (file) file.value = '';
    if (!preview) return;
    if (url) {
      preview.src = url;
      preview.hidden = false;
    } else {
      preview.removeAttribute('src');
      preview.hidden = true;
    }
  }

  function bindCourseImageInput(fileId, hiddenId, previewId) {
    var input = document.getElementById(fileId);
    if (!input || input.dataset.bound === '1') return;
    input.dataset.bound = '1';
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) return;
      if (file.size > 1200000) {
        input.value = '';
        alert('حجم الصورة كبير. اختر صورة أصغر من 1.2 ميغابايت.');
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        setCourseImagePreview(String(reader.result || ''), hiddenId, previewId, null);
      };
      reader.readAsDataURL(file);
    });
  }

  var YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

  function extractYouTubeVideoId(url) {
    var raw = String(url || '').trim();
    if (!raw) return '';
    if (YOUTUBE_ID_RE.test(raw)) return raw;

    var patterns = [
      /(?:youtube\.com\/watch\?.*v=|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/i,
      /youtu\.be\/([A-Za-z0-9_-]{11})/i,
      /youtube-nocookie\.com\/embed\/([A-Za-z0-9_-]{11})/i,
      /m\.youtube\.com\/watch\?.*v=([A-Za-z0-9_-]{11})/i,
    ];

    for (var i = 0; i < patterns.length; i++) {
      var match = raw.match(patterns[i]);
      if (match && match[1] && YOUTUBE_ID_RE.test(match[1])) return match[1];
    }
    return '';
  }

  function looksLikeYouTubeInput(value) {
    return /youtube|youtu\.be|youtube-nocookie/i.test(String(value || ''));
  }

  /**
   * @returns {{ videoId: string, videoUrl: string, invalid?: boolean }}
   */
  function normalizeLessonVideoFields(rawInput) {
    var trimmed = String(rawInput || '').trim();
    if (!trimmed) {
      return { videoId: '', videoUrl: '' };
    }

    var youtubeId = extractYouTubeVideoId(trimmed);
    if (youtubeId) {
      return { videoId: youtubeId, videoUrl: '' };
    }

    if (looksLikeYouTubeInput(trimmed)) {
      return { videoId: '', videoUrl: '', invalid: true };
    }

    return { videoId: '', videoUrl: trimmed };
  }

  function lessonVideoInputValue(lesson) {
    if (!lesson) return '';
    if (lesson.videoId) return String(lesson.videoId).trim();
    return String(lesson.videoUrl || '').trim();
  }

  function normalize(email) {
    return String(email || '').trim().toLowerCase();
  }

  function academyName() {
    return (window.PlatformCourses && window.PlatformCourses.ACADEMY_NAME) ||
      'مسار المهندس ‎°360';
  }

  function showToast(message, type) {
    var toast = document.getElementById('adminToast');
    if (!toast) {
      window.alert(message);
      return;
    }
    toast.textContent = message;
    toast.className = 'admin-toast admin-toast--' + (type || 'success');
    toast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.hidden = true;
    }, 3200);
  }

  function waitMs(ms) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, ms);
    });
  }

  function setUploadProgress(visible, percent, label, mode) {
    var status = document.getElementById('courseUploadStatus');
    var bar = document.getElementById('courseUploadBar');
    var labelEl = document.getElementById('courseUploadLabel');
    if (!status) return;
    status.hidden = !visible;
    if (labelEl && label) labelEl.textContent = label;
    if (bar) {
      bar.classList.toggle('admin-upload-status__bar--publish', mode === 'publish');
      bar.style.width = Math.max(0, Math.min(100, percent || 0)) + '%';
    }
  }

  async function runWithPublishProgress(label, stepsAsyncFn) {
    setUploadProgress(true, 0, label, 'publish');
    try {
      var result = await stepsAsyncFn(function (pct) {
        setUploadProgress(true, pct, label, 'publish');
      });
      setUploadProgress(true, 100, 'اكتمل الحفظ', 'publish');
      await waitMs(400);
      return result;
    } finally {
      setUploadProgress(false, 0, 'جاري تحميل الفيديو...', 'publish');
    }
  }

  function simulateVideoUpload(fileName, onDone) {
    if (uploadTimer) clearInterval(uploadTimer);
    var pct = 0;
    setUploadProgress(true, 0, 'جاري تحميل الفيديو... ' + (fileName || ''));
    uploadTimer = setInterval(function () {
      pct += 10 + Math.floor(Math.random() * 14);
      if (pct >= 100) {
        pct = 100;
        clearInterval(uploadTimer);
        uploadTimer = null;
        setUploadProgress(true, 100, 'اكتمل التحميل: ' + (fileName || ''));
        setTimeout(function () {
          setUploadProgress(false, 0, 'جاري تحميل الفيديو...');
          if (onDone) onDone();
        }, 450);
      } else {
        setUploadProgress(true, pct, 'جاري تحميل الفيديو... ' + pct + '%');
      }
    }, 140);
  }

  function getInstructorOptions() {
    if (!window.InstructorApps || typeof window.InstructorApps.getActiveInstructors !== 'function') {
      return [];
    }
    return window.InstructorApps.getActiveInstructors();
  }

  function fillInstructorSelect(selectedEmail) {
    var select = document.getElementById('courseEditorInstructor');
    if (!select) return;
    var instructors = getInstructorOptions();
    var selected = normalize(selectedEmail);
    var academySelected = !selected ? ' selected' : '';
    var html =
      '<option value=""' +
      academySelected +
      '>' +
      escapeHtml(academyName()) +
      '</option>';
    instructors.forEach(function (inst) {
      var isSelected = normalize(inst.email) === selected ? ' selected' : '';
      html +=
        '<option value="' +
        escapeHtml(inst.email) +
        '"' +
        isSelected +
        '>' +
        escapeHtml(inst.fullName + ' (' + inst.email + ')') +
        '</option>';
    });
    select.innerHTML = html;
  }

  function normalizeCurrencyCode(value) {
    if (window.PlatformCourses && typeof window.PlatformCourses.normalizeCurrency === 'function') {
      return window.PlatformCourses.normalizeCurrency(value);
    }
    var key = String(value || '').trim().toUpperCase();
    if (key === 'USD' || key === '$') return 'USD';
    return 'IQD';
  }

  function writeCourseCurrency(value) {
    var el = document.getElementById('course-currency');
    if (!el) return;
    el.value = normalizeCurrencyCode(value);
  }

  function readCourseCurrency() {
    var el = document.getElementById('course-currency');
    return normalizeCurrencyCode(el && el.value);
  }

  function parsePriceValue(val) {
    if (window.PlatformCourses && typeof window.PlatformCourses.parsePrice === 'function') {
      return window.PlatformCourses.parsePrice(val);
    }
    if (window.PlatformPlans && typeof window.PlatformPlans.parsePrice === 'function') {
      return window.PlatformPlans.parsePrice(val);
    }
    var clean = String(val == null ? '' : val).replace(/,/g, '').trim();
    var n = Number(clean);
    return isFinite(n) && n >= 0 ? n : 0;
  }

  function formatPriceInputValue(val) {
    var n = parsePriceValue(val);
    if (!n) return '';
    if (window.PlatformCourses && typeof window.PlatformCourses.formatGroupedAmount === 'function') {
      return window.PlatformCourses.formatGroupedAmount(n);
    }
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function bindPriceInput(id) {
    var el = document.getElementById(id);
    if (!el || el.dataset.priceBound === '1') return;
    el.dataset.priceBound = '1';
    el.addEventListener('blur', function () {
      if (!String(el.value || '').trim()) return;
      el.value = formatPriceInputValue(el.value);
    });
  }

  function writeSimulatorChecks(ids) {
    var selected = {};
    (ids || []).forEach(function (id) {
      selected[String(id)] = true;
    });
    document.querySelectorAll('#courseEditorSimulators input[name="courseSimulator"]').forEach(function (input) {
      input.checked = !!selected[input.value];
    });
  }

  function readSimulatorChecks() {
    var ids = [];
    document.querySelectorAll('#courseEditorSimulators input[name="courseSimulator"]:checked').forEach(function (input) {
      if (input.value) ids.push(input.value);
    });
    if (window.PlatformSimulators && typeof window.PlatformSimulators.normalizeSimulatorIds === 'function') {
      return window.PlatformSimulators.normalizeSimulatorIds(ids);
    }
    return ids;
  }

  function readGeneratePlanCheck() {
    var el = document.getElementById('courseEditorGeneratePlan');
    if (!el) return true;
    return el.checked === true;
  }

  function writeGeneratePlanCheck(course) {
    var el = document.getElementById('courseEditorGeneratePlan');
    if (!el) return;
    var enabled = !course || course.autoPricingPlan !== false;
    el.checked = enabled;
  }

  async function syncCoursePricingPlan(course) {
    if (window.CoursePlanSync && typeof window.CoursePlanSync.syncPlanForCourse === 'function') {
      return window.CoursePlanSync.syncPlanForCourse(course);
    }
    if (window.PlatformPlans && typeof window.PlatformPlans.upsertFromCourse === 'function') {
      return window.PlatformPlans.upsertFromCourse(course);
    }
    return course;
  }

  async function saveCourseRecord(id, payload) {
    var Firestore = window.PlatformCoursesFirestore;
    if (usesFirestoreCourses() && Firestore) {
      if (id) return Firestore.updateCourse(id, payload);
      return Firestore.addCourse(payload);
    }
    if (id) return window.PlatformCourses.updateCourse(id, payload);
    return window.PlatformCourses.addCourse(payload);
  }

  async function applyCourseStatus(id, status) {
    var Firestore = window.PlatformCoursesFirestore;
    if (usesFirestoreCourses() && Firestore && Firestore.setCourseStatus) {
      return Firestore.setCourseStatus(id, status);
    }
    return window.PlatformCourses.setCourseStatus(id, status);
  }

  async function applySoftDeleteCourse(id) {
    var Firestore = window.PlatformCoursesFirestore;
    if (usesFirestoreCourses() && Firestore && Firestore.softDeleteCourse) {
      return Firestore.softDeleteCourse(id);
    }
    return window.PlatformCourses.softDeleteCourse(id);
  }

  async function applyRestoreCourse(id) {
    var Firestore = window.PlatformCoursesFirestore;
    if (usesFirestoreCourses() && Firestore && Firestore.restoreCourse) {
      return Firestore.restoreCourse(id);
    }
    return window.PlatformCourses.restoreCourse(id);
  }

  async function applyPurgeCourse(id) {
    if (window.CoursePlanSync && typeof window.CoursePlanSync.deletePlanForCourse === 'function') {
      try {
        await window.CoursePlanSync.deletePlanForCourse(id);
      } catch (err) {
        console.warn('[AdminCourses] pricing plan delete skipped:', err);
      }
    }
    var Firestore = window.PlatformCoursesFirestore;
    if (Firestore && typeof Firestore.purgeCourse === 'function') {
      return Firestore.purgeCourse(id);
    }
    return window.PlatformCourses.deleteCourse(id);
  }

  function shouldNotifySubscribersOnPublish() {
    var el = document.getElementById('courseEditorNotifySubscribers');
    return !!(el && el.checked);
  }

  async function maybeNotifyCoursePublished(course, wasAlreadyPublished) {
    if (!course || course.status !== 'published') return;
    if (wasAlreadyPublished) return;
    if (!shouldNotifySubscribersOnPublish()) return;
    try {
      var mod = await import('./firestore-notifications.js');
      var uid = '';
      if (window.IFAAuth && typeof window.IFAAuth.getCurrentUser === 'function') {
        var user = window.IFAAuth.getCurrentUser();
        uid = user && user.uid ? user.uid : '';
      }
      await mod.createCourseAnnouncement(course, {
        targetAudience: 'subscribers',
        createdBy: uid,
      });
      showToast('تم إرسال إشعار المشتركين', 'success');
    } catch (err) {
      console.error('[AdminCourses] course notification failed', err);
      showToast((err && err.message) || 'تعذّر إرسال إشعار المشتركين', 'error');
    }
  }

  function emptyQuiz() {
    return { questions: [] };
  }

  function cloneLessonDraft(l, index) {
    var quiz = l && l.quiz && typeof l.quiz === 'object' ? l.quiz : emptyQuiz();
    var questions = Array.isArray(quiz.questions)
      ? quiz.questions.map(function (q) {
          var opts = Array.isArray(q.options) ? q.options.slice(0, 4) : [];
          while (opts.length < 4) opts.push('');
          return {
            id: q.id || 'q_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
            text: q.text || '',
            options: opts,
            correctIndex: typeof q.correctIndex === 'number' ? q.correctIndex : 0,
            createdAt: q.createdAt || new Date().toISOString(),
          };
        })
      : [];
    return {
      id: (l && l.id) || 'lesson_' + Date.now().toString(36) + '_' + (index || 0),
      title: (l && l.title) || '',
      description: (l && l.description) || '',
      videoId: (l && l.videoId) || '',
      videoUrl: (l && l.videoUrl) || '',
      videoFileName: (l && l.videoFileName) || '',
      videoTitle: (l && l.videoTitle) || '',
      templateFiles: (l && Array.isArray(l.templateFiles) ? l.templateFiles : []) || [],
      quiz: { questions: questions },
      comments: (l && Array.isArray(l.comments) ? l.comments : []) || [],
      isFreePreview: !!(l && l.isFreePreview),
      order: (l && l.order) || (index || 0) + 1,
      createdAt: (l && l.createdAt) || new Date().toISOString(),
    };
  }

  function renderLessonQuiz(lesson, index) {
    var questions = (lesson.quiz && lesson.quiz.questions) || [];
    var listHtml = questions.length
      ? questions
          .map(function (q, qIdx) {
            var letters = ['أ', 'ب', 'ج', 'د'];
            var opts = (q.options || [])
              .map(function (o, i) {
                return (
                  '<div class="admin-lesson-quiz__option' +
                  (i === q.correctIndex ? ' is-correct' : '') +
                  '">' +
                  (i === q.correctIndex ? '✓ ' : '') +
                  escapeHtml(letters[i] || String(i + 1)) +
                  ') ' +
                  escapeHtml(o) +
                  '</div>'
                );
              })
              .join('');
            return (
              '<div class="admin-lesson-quiz__item" data-quiz-question-id="' +
              escapeHtml(q.id) +
              '">' +
              '<div class="admin-lesson-quiz__item-head">' +
              '<strong>س' +
              (qIdx + 1) +
              ':</strong> ' +
              escapeHtml(q.text) +
              '<button type="button" class="admin-btn admin-btn--danger admin-btn--sm" data-remove-quiz-question="' +
              index +
              '" data-question-id="' +
              escapeHtml(q.id) +
              '">حذف</button>' +
              '</div>' +
              '<div class="admin-lesson-quiz__options">' +
              opts +
              '</div>' +
              '</div>'
            );
          })
          .join('')
      : '<p class="admin-lesson-quiz__empty">لا أسئلة بعد — أضف أول سؤال MCQ أدناه</p>';

    return (
      '<div class="admin-lesson-quiz" data-lesson-quiz="' +
      index +
      '">' +
      '<div class="admin-lesson-quiz__header">' +
      '<h5 class="admin-lesson-quiz__title">امتحان الحلقة / الاختبار</h5>' +
      '<span class="admin-lesson-quiz__count">' +
      questions.length +
      ' سؤال</span>' +
      '</div>' +
      '<div class="admin-lesson-quiz__list">' +
      listHtml +
      '</div>' +
      '<div class="admin-lesson-quiz__builder">' +
      '<label class="admin-field">' +
      '<span class="admin-field__label">نص السؤال</span>' +
      '<input class="admin-field__input" type="text" placeholder="اكتب السؤال هنا..." data-quiz-field="text" data-lesson-index="' +
      index +
      '" />' +
      '</label>' +
      '<div class="admin-lesson-quiz__opts-grid">' +
      '<label class="admin-field"><span class="admin-field__label">خيار أ</span>' +
      '<input class="admin-field__input" type="text" data-quiz-field="opt0" data-lesson-index="' +
      index +
      '" /></label>' +
      '<label class="admin-field"><span class="admin-field__label">خيار ب</span>' +
      '<input class="admin-field__input" type="text" data-quiz-field="opt1" data-lesson-index="' +
      index +
      '" /></label>' +
      '<label class="admin-field"><span class="admin-field__label">خيار ج</span>' +
      '<input class="admin-field__input" type="text" data-quiz-field="opt2" data-lesson-index="' +
      index +
      '" /></label>' +
      '<label class="admin-field"><span class="admin-field__label">خيار د</span>' +
      '<input class="admin-field__input" type="text" data-quiz-field="opt3" data-lesson-index="' +
      index +
      '" /></label>' +
      '</div>' +
      '<div class="admin-lesson-quiz__builder-row">' +
      '<label class="admin-field">' +
      '<span class="admin-field__label">الإجابة الصحيحة</span>' +
      '<select class="admin-field__input" data-quiz-field="correct" data-lesson-index="' +
      index +
      '">' +
      '<option value="0">أ</option><option value="1">ب</option><option value="2">ج</option><option value="3">د</option>' +
      '</select>' +
      '</label>' +
      '<button type="button" class="admin-btn admin-btn--primary admin-btn--sm" data-add-quiz-question="' +
      index +
      '">إضافة السؤال للامتحان</button>' +
      '</div>' +
      '</div>' +
      '</div>'
    );
  }

  function statusBadge(course) {
    if (course.softDeleted) {
      return '<span class="admin-badge admin-badge--pending">مسودة (محذوف)</span>';
    }
    if (course.status === 'published') {
      return '<span class="admin-badge admin-badge--active">منشور</span>';
    }
    if (course.status === 'suspended') {
      return '<span class="admin-badge admin-badge--suspended">معلّق</span>';
    }
    if (course.status === 'pending') {
      return '<span class="admin-badge admin-badge--pending">قيد المراجعة</span>';
    }
    return '<span class="admin-badge admin-badge--pending">مسودة</span>';
  }

  function categoryLabel(category) {
    if (category === 'program') return 'برنامج احترافي';
    if (category === 'master') return 'كورس شامل';
    return 'كورس منفرد';
  }

  function closeCourseModal() {
    var modal = document.getElementById('courseEditorModal');
    if (modal) modal.hidden = true;
  }

  function renderLessonDrafts() {
    var wrap = document.getElementById('courseLessonsList');
    if (!wrap) return;
    if (!lessonDrafts.length) {
      wrap.innerHTML =
        '<p class="admin-lessons-empty">لا توجد دروس بعد. أضف درساً بعنوان وفيديو وامتحان اختياري.</p>';
      return;
    }
    wrap.innerHTML = lessonDrafts
      .map(function (lesson, index) {
        if (!lesson.quiz) lesson.quiz = emptyQuiz();
        var qCount = (lesson.quiz.questions || []).length;
        return (
          '<div class="admin-lesson-card" data-lesson-index="' +
          index +
          '">' +
          '<div class="admin-lesson-card__head">' +
          '<span class="admin-lesson-card__order">درس ' +
          (index + 1) +
          (qCount ? ' · ' + qCount + ' سؤال' : '') +
          '</span>' +
          '<button type="button" class="admin-btn admin-btn--danger admin-btn--sm" data-remove-lesson="' +
          index +
          '">حذف</button>' +
          '</div>' +
          '<label class="admin-field">' +
          '<span class="admin-field__label">عنوان الدرس</span>' +
          '<input class="admin-field__input" type="text" data-lesson-field="title" data-lesson-index="' +
          index +
          '" value="' +
          escapeHtml(lesson.title) +
          '" />' +
          '</label>' +
          '<label class="admin-field">' +
          '<span class="admin-field__label">وصف الدرس</span>' +
          '<textarea class="admin-field__input admin-field__textarea" rows="2" data-lesson-field="description" data-lesson-index="' +
          index +
          '">' +
          escapeHtml(lesson.description) +
          '</textarea>' +
          '</label>' +
          '<div class="admin-lesson-card__media">' +
          '<label class="admin-field">' +
          '<span class="admin-field__label">رابط YouTube أو ملف مباشر</span>' +
          '<input class="admin-field__input" type="text" placeholder="https://youtube.com/... أو معرّف 11 حرفاً" data-lesson-field="videoUrl" data-lesson-index="' +
          index +
          '" value="' +
          escapeHtml(lessonVideoInputValue(lesson)) +
          '" />' +
          '</label>' +
          '<label class="admin-field">' +
          '<span class="admin-field__label">ملف فيديو / مرفق</span>' +
          '<input class="admin-field__input" type="text" placeholder="اسم الملف أو المسار" data-lesson-field="videoFileName" data-lesson-index="' +
          index +
          '" value="' +
          escapeHtml(lesson.videoFileName) +
          '" />' +
          '</label>' +
          '<label class="admin-field">' +
          '<span class="admin-field__label">رفع ملف (اسم فقط)</span>' +
          '<input class="admin-field__input" type="file" accept="video/*,.mp4,.webm,.mov" data-lesson-file="' +
          index +
          '" />' +
          '</label>' +
          '</div>' +
          '<label class="admin-field admin-field--checkbox admin-lesson-preview-toggle">' +
          '<input type="checkbox" data-lesson-field="isFreePreview" data-lesson-index="' +
          index +
          '"' +
          (lesson.isFreePreview ? ' checked' : '') +
          ' />' +
          '<span class="admin-field__label">معاينة مجانية (Free Preview)</span>' +
          '</label>' +
          renderLessonQuiz(lesson, index) +
          '</div>'
        );
      })
      .join('');
  }

  function openCourseModal(course) {
    var modal = document.getElementById('courseEditorModal');
    var titleEl = document.getElementById('courseEditorTitle');
    if (!modal) return;

    document.getElementById('courseEditorId').value = course ? course.id : '';
    document.getElementById('courseEditorName').value = course ? course.title : '';
    document.getElementById('courseEditorDescription').value = course ? course.description : '';
    setCourseImagePreview(
      course ? course.imageUrl || course.thumbnailUrl || '' : '',
      'courseEditorImageUrl',
      'course-image-preview',
      'course-image-input'
    );
    document.getElementById('courseEditorHours').value = course ? course.durationHours || '' : '';
    document.getElementById('courseEditorWeeks').value = course ? course.durationWeeks || '' : '';
    document.getElementById('courseEditorPrice').value =
      course && parsePriceValue(course.price) ? formatPriceInputValue(course.price) : '';
    writeCourseCurrency(course ? course.currency : 'IQD');
    document.getElementById('courseEditorSchedule').value = course ? course.weeklySchedule || '' : '';
    document.getElementById('courseEditorStatus').value = course
      ? course.softDeleted
        ? 'draft'
        : course.status || 'draft'
      : 'draft';
    var notifyEl = document.getElementById('courseEditorNotifySubscribers');
    if (notifyEl) {
      notifyEl.checked = !course || course.status !== 'published';
    }
    document.getElementById('courseEditorCategory').value = course
      ? course.category || 'individual'
      : 'individual';
    writeSimulatorChecks(course ? course.allowedSimulators : []);
    writeGeneratePlanCheck(course);

    fillInstructorSelect(course && !course.isAcademy ? course.instructorEmail : '');
    lessonDrafts =
      course && Array.isArray(course.lessons)
        ? course.lessons.map(function (l, index) {
            return cloneLessonDraft(l, index);
          })
        : [];
    renderLessonDrafts();

    if (titleEl) titleEl.textContent = course ? 'تعديل كورس' : 'إضافة كورس';
    modal.hidden = false;
    var name = document.getElementById('courseEditorName');
    if (name) name.focus();
  }

  function collectLessonDraftsFromDom() {
    lessonDrafts.forEach(function (lesson, index) {
      var title = document.querySelector(
        '[data-lesson-field="title"][data-lesson-index="' + index + '"]'
      );
      var description = document.querySelector(
        '[data-lesson-field="description"][data-lesson-index="' + index + '"]'
      );
      var videoUrl = document.querySelector(
        '[data-lesson-field="videoUrl"][data-lesson-index="' + index + '"]'
      );
      var videoFileName = document.querySelector(
        '[data-lesson-field="videoFileName"][data-lesson-index="' + index + '"]'
      );
      var freePreview = document.querySelector(
        '[data-lesson-field="isFreePreview"][data-lesson-index="' + index + '"]'
      );
      if (title) lesson.title = title.value;
      if (description) lesson.description = description.value;
      if (videoUrl) {
        var normalizedVideo = normalizeLessonVideoFields(videoUrl.value);
        lesson.videoId = normalizedVideo.videoId;
        lesson.videoUrl = normalizedVideo.videoUrl;
        lesson._videoInvalid = !!normalizedVideo.invalid;
      }
      if (videoFileName) lesson.videoFileName = videoFileName.value;
      lesson.isFreePreview = !!(freePreview && freePreview.checked);
      if (!lesson.quiz || typeof lesson.quiz !== 'object') lesson.quiz = emptyQuiz();
      if (!Array.isArray(lesson.quiz.questions)) lesson.quiz.questions = [];
      lesson.order = index + 1;
    });
    return lessonDrafts;
  }

  function validateLessonVideosFromDom() {
    var lessons = collectLessonDraftsFromDom();
    for (var i = 0; i < lessons.length; i++) {
      if (lessons[i]._videoInvalid) {
        return {
          ok: false,
          message:
            'رابط YouTube غير صالح في الدرس «' +
            (lessons[i].title || 'بدون عنوان') +
            '». تأكد من الرابط أو معرّف الفيديو (11 حرفاً).',
        };
      }
    }
    return { ok: true, lessons: lessons };
  }

  function readQuizBuilderFields(index) {
    function val(field) {
      var el = document.querySelector(
        '[data-quiz-field="' + field + '"][data-lesson-index="' + index + '"]'
      );
      return el ? String(el.value || '').trim() : '';
    }
    return {
      text: val('text'),
      options: [val('opt0'), val('opt1'), val('opt2'), val('opt3')],
      correctIndex: Number(val('correct')) || 0,
    };
  }

  function addQuizQuestionToLesson(index) {
    collectLessonDraftsFromDom();
    var lesson = lessonDrafts[index];
    if (!lesson) return;
    var draft = readQuizBuilderFields(index);
    if (!draft.text) {
      alert('نص السؤال مطلوب');
      return;
    }
    if (draft.options.some(function (o) { return !o; })) {
      alert('يجب تعبئة الخيارات الأربعة');
      return;
    }
    if (!lesson.quiz) lesson.quiz = emptyQuiz();
    lesson.quiz.questions.push({
      id: 'q_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
      text: draft.text,
      options: draft.options,
      correctIndex: Math.max(0, Math.min(3, draft.correctIndex)),
      createdAt: new Date().toISOString(),
    });
    renderLessonDrafts();
  }

  function removeQuizQuestionFromLesson(index, questionId) {
    collectLessonDraftsFromDom();
    var lesson = lessonDrafts[index];
    if (!lesson || !lesson.quiz) return;
    lesson.quiz.questions = (lesson.quiz.questions || []).filter(function (q) {
      return q.id !== questionId;
    });
    renderLessonDrafts();
  }

  function syncTabsUi() {
    var tabs = document.querySelectorAll('[data-courses-tab]');
    tabs.forEach(function (tab) {
      var key = tab.getAttribute('data-courses-tab');
      var active = key === statusFilter || (statusFilter === 'draft' && key === 'draft');
      if (statusFilter === 'published' || statusFilter === 'suspended' || statusFilter === 'all') {
        active = key === 'active';
      }
      if (statusFilter === 'draft') active = key === 'draft';
      if (statusFilter === 'active') active = key === 'active';
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    var filter = document.getElementById('coursesStatusFilter');
    if (filter && filter.value !== statusFilter) filter.value = statusFilter;

    var countEl = document.getElementById('coursesDraftCount');
    if (countEl && window.PlatformCourses) {
      countEl.textContent = String(window.PlatformCourses.getDraftCount());
    }

    var pendingBtn = document.getElementById('btnPendingCourses');
    if (pendingBtn) {
      pendingBtn.classList.toggle('is-active', statusFilter === 'pending');
      pendingBtn.setAttribute('aria-selected', statusFilter === 'pending' ? 'true' : 'false');
    }
    var pendingCountEl = document.getElementById('pendingCoursesCount');
    if (pendingCountEl && window.PlatformCourses) {
      var pendingCount = window.PlatformCourses.getCourses().filter(function (c) {
        return c && c.status === 'pending' && !c.softDeleted;
      }).length;
      pendingCountEl.textContent = pendingCount;
      if (pendingCount > 0) {
        pendingCountEl.style.display = 'inline-block';
      } else {
        pendingCountEl.style.display = 'none';
      }
    }
  }

  function setCoursesView(view) {
    statusFilter = view || 'active';
    syncTabsUi();
    renderCoursesTable();
  }

  function collectVisibleCourseIds() {
    var body = document.getElementById('coursesTableBody');
    if (!body) return [];
    return Array.prototype.slice
      .call(body.querySelectorAll('tr[data-course-id]'))
      .map(function (row) {
        return row.getAttribute('data-course-id');
      })
      .filter(Boolean);
  }

  function clearDragState() {
    dragCourseId = null;
    dragRowEl = null;
    var body = document.getElementById('coursesTableBody');
    if (!body) return;
    body.querySelectorAll('tr.is-dragging, tr.is-drag-over').forEach(function (row) {
      row.classList.remove('is-dragging', 'is-drag-over');
    });
  }

  function moveDraggedRowBeforeTarget(body, targetRow, clientY) {
    if (!dragRowEl || !targetRow || dragRowEl === targetRow || !body.contains(targetRow)) return;
    var rect = targetRow.getBoundingClientRect();
    var placeAfter = clientY > rect.top + rect.height / 2;
    if (placeAfter) {
      var next = targetRow.nextElementSibling;
      if (next === dragRowEl) return;
      body.insertBefore(dragRowEl, next);
    } else {
      if (targetRow.previousElementSibling === dragRowEl) return;
      body.insertBefore(dragRowEl, targetRow);
    }
  }

  async function persistDomCourseOrder() {
    if (!window.PlatformCourses || typeof window.PlatformCourses.reorderCourses !== 'function') {
      return false;
    }
    var ids = collectVisibleCourseIds();
    if (ids.length < 1) return false;
    var result = window.PlatformCourses.reorderCourses(ids);
    if (result && typeof result.then === 'function') {
      await result;
    }
    return true;
  }

  function bindCourseDragAndDrop() {
    var body = document.getElementById('coursesTableBody');
    if (!body || dragBound) return;
    dragBound = true;

    body.addEventListener('dragstart', function (e) {
      var row = e.target.closest ? e.target.closest('tr[data-course-id]') : null;
      if (!row || !body.contains(row)) return;
      if (e.target.closest && e.target.closest('button, a, input, select, textarea, label')) {
        e.preventDefault();
        return;
      }
      if (e.target.closest && e.target.closest('.admin-table__actions')) {
        e.preventDefault();
        return;
      }

      dragCourseId = row.getAttribute('data-course-id');
      dragRowEl = row;
      row.classList.add('is-dragging');
      try {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', dragCourseId || '');
      } catch (err) {
        /* ignore */
      }
    });

    body.addEventListener('dragend', function () {
      clearDragState();
    });

    body.addEventListener('dragover', function (e) {
      if (!dragRowEl && !dragCourseId) return;
      e.preventDefault();
      try {
        e.dataTransfer.dropEffect = 'move';
      } catch (err) {
        /* ignore */
      }

      var row = e.target.closest ? e.target.closest('tr[data-course-id]') : null;
      if (!row || row === dragRowEl) return;

      body.querySelectorAll('tr.is-drag-over').forEach(function (r) {
        if (r !== row) r.classList.remove('is-drag-over');
      });
      row.classList.add('is-drag-over');
      moveDraggedRowBeforeTarget(body, row, e.clientY);
    });

    body.addEventListener('dragleave', function (e) {
      var row = e.target.closest ? e.target.closest('tr[data-course-id]') : null;
      if (!row) return;
      if (e.relatedTarget && row.contains(e.relatedTarget)) return;
      row.classList.remove('is-drag-over');
    });

    body.addEventListener('drop', function (e) {
      e.preventDefault();
      e.stopPropagation();

      var targetRow = e.target.closest ? e.target.closest('tr[data-course-id]') : null;
      if (targetRow && dragRowEl && targetRow !== dragRowEl) {
        moveDraggedRowBeforeTarget(body, targetRow, e.clientY);
      }

      (async function () {
        try {
          var saved = await persistDomCourseOrder();
          clearDragState();
          if (saved) {
            renderCoursesTable();
            showToast('تم حفظ ترتيب الكورسات', 'success');
          }
        } catch (err) {
          clearDragState();
          alert((err && err.message) || 'تعذر حفظ الترتيب');
          renderCoursesTable();
        }
      })();
    });
  }

  function renderCoursesTable() {
    var body = document.getElementById('coursesTableBody');
    var meta = document.getElementById('coursesMeta');
    var publishedStat = document.getElementById('statPublishedCourses');
    if (!body || !window.PlatformCourses) return;

    var list = window.PlatformCourses.getCourses().slice();
    if (typeof window.PlatformCourses.sortByDisplayOrder === 'function') {
      list.sort(window.PlatformCourses.sortByDisplayOrder);
    }

    var instructorSelect = document.getElementById('adminCourseInstructorFilter');
    if (instructorSelect) {
      var names = {};
      list.forEach(function (c) {
        var name = String((c && c.instructorName) || '').trim();
        if (name) names[name] = true;
      });
      var selected = instructorFilter || 'all';
      var options = '<option value="all">كل المدربين</option>';
      Object.keys(names).sort().forEach(function (name) {
        options += '<option value="' + name.replace(/"/g, '&quot;') + '">' + name.replace(/</g, '&lt;') + '</option>';
      });
      instructorSelect.innerHTML = options;
      instructorSelect.value = names[selected] || selected === 'all' ? selected : 'all';
      instructorFilter = instructorSelect.value || 'all';
    }

    var filtered = list.filter(function (c) {
      if (statusFilter === 'active') {
        if (c.softDeleted || c.status === 'draft' || c.status === 'pending') return false;
      } else if (statusFilter === 'draft') {
        if (!(c.status === 'draft' || c.softDeleted)) return false;
      } else if (statusFilter === 'pending') {
        if (c.status !== 'pending' || c.softDeleted) return false;
      } else if (statusFilter === 'published') {
        if (c.status !== 'published' || c.softDeleted) return false;
      } else if (statusFilter === 'suspended') {
        if (c.status !== 'suspended' || c.softDeleted) return false;
      }

      if (instructorFilter && instructorFilter !== 'all') {
        if (String(c.instructorName || '') !== instructorFilter) return false;
      }

      if (!searchQuery) return true;
      var hay =
        String(c.title || '').toLowerCase() +
        ' ' +
        String(c.description || '').toLowerCase() +
        ' ' +
        String(c.instructorName || '').toLowerCase() +
        ' ' +
        String(c.instructorEmail || '').toLowerCase() +
        ' ' +
        String(c.category || '').toLowerCase();
      return hay.indexOf(searchQuery) !== -1;
    });

    if (publishedStat) publishedStat.textContent = String(window.PlatformCourses.getPublishedCount());
    if (typeof window.refreshAdminOverviewStats === 'function') {
      window.refreshAdminOverviewStats();
    }
    syncTabsUi();

    if (meta) {
      meta.textContent =
        'عرض ' +
        filtered.length +
        ' · منشور: ' +
        window.PlatformCourses.getPublishedCount() +
        ' · مسودة: ' +
        window.PlatformCourses.getDraftCount() +
        ' · اسحب ⋮⋮ لإعادة الترتيب';
    }

    if (!filtered.length) {
      var emptyMsg =
        statusFilter === 'draft'
          ? 'لا توجد مسودات حالياً.'
          : list.length
            ? 'لا نتائج مطابقة للتصفية أو البحث.'
            : 'لا توجد كورسات. أضف كورساً أو اختر من الكتالوج.';
      if (!list.length && isCoursesAdminDataLoading()) {
        emptyMsg = 'جاري تحميل الكورسات…';
      }
      body.innerHTML =
        '<tr><td colspan="9" class="admin-empty-cell">' + emptyMsg + '</td></tr>';
      return;
    }

    var draftsView = statusFilter === 'draft';

    body.innerHTML = filtered
      .map(function (course) {
        var id = escapeHtml(course.id);
        var lessonsCount = Array.isArray(course.lessons) ? course.lessons.length : 0;
        var instructorLabel =
          course.isAcademy || !course.instructorEmail
            ? academyName()
            : course.instructorName || course.instructorEmail || '—';
        var sourceLabel = course.source === 'instructor' ? 'مدرب' : 'إدارة';
        var actions = '';

        if (draftsView) {
          actions =
            '<button class="admin-btn admin-btn--ghost admin-btn--sm" type="button" data-edit-course="' +
            id +
            '">تعديل</button>' +
            '<button class="admin-btn admin-btn--primary admin-btn--sm" type="button" data-restore-course="' +
            id +
            '">استعادة</button>' +
            '<button class="admin-btn admin-btn--danger admin-btn--sm" type="button" data-purge-course="' +
            id +
            '">حذف نهائي</button>';
        } else {
          var publishLabel = course.status === 'published' ? 'إلغاء النشر' : 'نشر';
          var publishCls =
            course.status === 'published'
              ? 'admin-btn admin-btn--ghost admin-btn--sm'
              : 'admin-btn admin-btn--primary admin-btn--sm';
          var suspendLabel = course.status === 'suspended' ? 'إلغاء التعليق' : 'تعليق';
          actions =
            '<button class="admin-btn admin-btn--ghost admin-btn--sm" type="button" data-edit-course="' +
            id +
            '">تعديل</button>' +
            '<button class="' +
            publishCls +
            '" type="button" data-toggle-course-status="' +
            id +
            '" data-next-status="' +
            (course.status === 'published' ? 'draft' : 'published') +
            '">' +
            publishLabel +
            '</button>' +
            '<button class="admin-btn admin-btn--ghost admin-btn--sm" type="button" data-toggle-course-status="' +
            id +
            '" data-next-status="' +
            (course.status === 'suspended' ? 'published' : 'suspended') +
            '">' +
            suspendLabel +
            '</button>' +
            '<button class="admin-btn admin-btn--danger admin-btn--sm" type="button" data-delete-course="' +
            id +
            '">حذف</button>';
        }

        return (
          '<tr class="admin-course-row" draggable="true" data-course-id="' +
          id +
          '">' +
          '<td class="admin-table__drag-cell">' +
          '<span class="admin-drag-handle" title="اسحب لإعادة الترتيب" aria-hidden="true">⋮⋮</span>' +
          '</td>' +
          '<td>' +
          '<div class="course-title-cell">' +
          courseThumbHtml(course.imageUrl || course.thumbnailUrl) +
          '<div class="admin-user-cell__name">' +
          escapeHtml(course.title) +
          '</div>' +
          '</div>' +
          '<div class="admin-user-cell__email">' +
          lessonsCount +
          ' درس · ' +
          escapeHtml(categoryLabel(course.category)) +
          ' · ' +
          escapeHtml(sourceLabel) +
          '</div>' +
          '</td>' +
          '<td>' +
          escapeHtml(instructorLabel) +
          '</td>' +
          '<td><span class="admin-course-price">' +
          escapeHtml(
            window.PlatformCourses.formatPrice
              ? window.PlatformCourses.formatPrice(course)
              : course.price
                ? course.price + ' د.ع'
                : 'مجاناً'
          ) +
          '</span>' +
          '<div class="admin-user-cell__email">' +
          escapeHtml(
            window.PlatformCourses.formatCourseAccessLabel
              ? window.PlatformCourses.formatCourseAccessLabel(course)
              : course.accessLevel || '—'
          ) +
          '</div></td>' +
          '<td>' +
          escapeHtml(window.PlatformCourses.formatDuration(course)) +
          '</td>' +
          '<td><div class="admin-cell-clamp">' +
          escapeHtml(course.weeklySchedule || '—') +
          '</div></td>' +
          '<td>' +
          statusBadge(course) +
          '</td>' +
          '<td>' +
          escapeHtml(
            window.InstructorApps && window.InstructorApps.formatDate
              ? window.InstructorApps.formatDate(course.updatedAt || course.createdAt)
              : course.updatedAt || '—'
          ) +
          '</td>' +
          '<td>' +
          '<div class="admin-table__actions admin-table__actions--row">' +
          actions +
          '</div>' +
          '</td>' +
          '</tr>'
        );
      })
      .join('');

    bindCourseDragAndDrop();
  }

  function resolveInstructorFromForm() {
    var instructorSelect = document.getElementById('courseEditorInstructor');
    var instructorEmail = instructorSelect ? instructorSelect.value : '';
    var instructorName = academyName();
    if (instructorEmail && instructorSelect && instructorSelect.selectedIndex >= 0) {
      var opt = instructorSelect.options[instructorSelect.selectedIndex];
      instructorName = String(opt.textContent || '').split(' (')[0];
    } else {
      instructorEmail = '';
      instructorName = academyName();
    }
    return { instructorEmail: instructorEmail, instructorName: instructorName };
  }

  function bind() {
    bindPriceInput('courseEditorPrice');
    var search = document.getElementById('courseSearch');
    if (search) {
      search.addEventListener('input', function () {
        searchQuery = search.value.trim().toLowerCase();
        renderCoursesTable();
      });
    }

    var filter = document.getElementById('coursesStatusFilter');
    if (filter) {
      filter.addEventListener('change', function () {
        setCoursesView(filter.value || 'active');
      });
    }

    var instructorSelect = document.getElementById('adminCourseInstructorFilter');
    if (instructorSelect) {
      instructorSelect.addEventListener('change', function () {
        instructorFilter = instructorSelect.value || 'all';
        renderCoursesTable();
      });
    }

    document.querySelectorAll('[data-courses-tab]').forEach(function (tab) {
      tab.addEventListener('click', function () {
        setCoursesView(tab.getAttribute('data-courses-tab') || 'active');
      });
    });

    var addBtn = document.getElementById('addCourseBtn');
    if (addBtn) {
      addBtn.addEventListener('click', function () {
        openCourseModal(null);
      });
    }
    bindCourseImageInput('course-image-input', 'courseEditorImageUrl', 'course-image-preview');

    var refreshBtn = document.getElementById('refreshCoursesBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', renderCoursesTable);
    }

    var addLessonBtn = document.getElementById('addCourseLessonBtn');
    if (addLessonBtn) {
      addLessonBtn.addEventListener('click', function () {
        collectLessonDraftsFromDom();
        lessonDrafts.push(
          cloneLessonDraft(
            {
              id: 'lesson_' + Date.now().toString(36),
              title: '',
              description: '',
              videoId: '',
              videoUrl: '',
              videoFileName: '',
              isFreePreview: false,
              quiz: emptyQuiz(),
              order: lessonDrafts.length + 1,
              createdAt: new Date().toISOString(),
            },
            lessonDrafts.length
          )
        );
        renderLessonDrafts();
      });
    }

    var form = document.getElementById('courseEditorForm');
    if (form) {
      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        if (!window.PlatformCourses) return;
        var id = (document.getElementById('courseEditorId') || {}).value || '';
        var instructor = resolveInstructorFromForm();
        var autoPricingPlan = readGeneratePlanCheck();
        var videoValidation = validateLessonVideosFromDom();
        if (!videoValidation.ok) {
          showToast(videoValidation.message, 'error');
          return;
        }

        var payload = {
          title: (document.getElementById('courseEditorName') || {}).value,
          description: (document.getElementById('courseEditorDescription') || {}).value,
          durationHours: (document.getElementById('courseEditorHours') || {}).value,
          durationWeeks: (document.getElementById('courseEditorWeeks') || {}).value,
          price: parsePriceValue((document.getElementById('courseEditorPrice') || {}).value),
          currency: readCourseCurrency(),
          requiredPlanId: '',
          weeklySchedule: (document.getElementById('courseEditorSchedule') || {}).value,
          status: (document.getElementById('courseEditorStatus') || {}).value,
          category: (document.getElementById('courseEditorCategory') || {}).value || 'individual',
          allowedSimulators: readSimulatorChecks(),
          autoPricingPlan: autoPricingPlan,
          suppressPricingPlan: autoPricingPlan ? false : undefined,
          instructorEmail: instructor.instructorEmail,
          instructorName: instructor.instructorName,
          lessons: (videoValidation.lessons || []).map(function (lesson) {
            var copy = Object.assign({}, lesson);
            delete copy._videoInvalid;
            return copy;
          }),
          softDeleted: false,
          deletedAt: '',
          source: 'admin',
          imageUrl: (document.getElementById('courseEditorImageUrl') || {}).value || '',
          thumbnailUrl: (document.getElementById('courseEditorImageUrl') || {}).value || '',
        };
        try {
          var wasPublish = payload.status === 'published';
          var previousCourse = id && window.PlatformCourses.findCourse(id);
          var wasAlreadyPublished = !!(previousCourse && previousCourse.status === 'published');
          var progressLabel = wasPublish ? 'جاري النشر...' : 'جاري الحفظ...';
          var publishResult = await runWithPublishProgress(progressLabel, async function (setPct) {
            setPct(15);
            var saved = await saveCourseRecord(id, payload);
            setPct(65);
            saved = (await syncCoursePricingPlan(saved)) || saved;
            setPct(95);
            return { saved: saved, wasPublish: wasPublish };
          });
          if (wasPublish && publishResult && publishResult.saved) {
            await maybeNotifyCoursePublished(publishResult.saved, wasAlreadyPublished);
          }
          closeCourseModal();
          renderCoursesTable();
          if (wasPublish) showToast('تم النشر بنجاح!', 'success');
          else showToast(id ? 'تم حفظ التعديلات' : 'تم إنشاء الكورس وحفظه في المنصة', 'success');
        } catch (err) {
          alert((err && err.message) || 'تعذر حفظ الكورس');
        }
      });
    }

    document.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('[data-close-course-modal]')) {
        closeCourseModal();
        return;
      }

      var removeLesson = e.target.closest ? e.target.closest('[data-remove-lesson]') : null;
      if (removeLesson) {
        collectLessonDraftsFromDom();
        var idx = Number(removeLesson.getAttribute('data-remove-lesson'));
        if (!isNaN(idx)) {
          lessonDrafts.splice(idx, 1);
          renderLessonDrafts();
        }
        return;
      }

      var addQuizBtn = e.target.closest ? e.target.closest('[data-add-quiz-question]') : null;
      if (addQuizBtn) {
        e.preventDefault();
        addQuizQuestionToLesson(Number(addQuizBtn.getAttribute('data-add-quiz-question')));
        return;
      }

      var removeQuizBtn = e.target.closest ? e.target.closest('[data-remove-quiz-question]') : null;
      if (removeQuizBtn) {
        e.preventDefault();
        removeQuizQuestionFromLesson(
          Number(removeQuizBtn.getAttribute('data-remove-quiz-question')),
          removeQuizBtn.getAttribute('data-question-id')
        );
        return;
      }

      if (!window.PlatformCourses) return;

      var editBtn = e.target.closest ? e.target.closest('[data-edit-course]') : null;
      var toggleBtn = e.target.closest ? e.target.closest('[data-toggle-course-status]') : null;
      var deleteBtn = e.target.closest ? e.target.closest('[data-delete-course]') : null;
      var restoreBtn = e.target.closest ? e.target.closest('[data-restore-course]') : null;
      var purgeBtn = e.target.closest ? e.target.closest('[data-purge-course]') : null;

      if (editBtn) {
        var course = window.PlatformCourses.findCourse(editBtn.getAttribute('data-edit-course'));
        if (course) openCourseModal(course);
        return;
      }

      if (toggleBtn) {
        (async function () {
          try {
            var target = window.PlatformCourses.findCourse(
              toggleBtn.getAttribute('data-toggle-course-status')
            );
            if (!target) return;
            var next =
              toggleBtn.getAttribute('data-next-status') ||
              (target.status === 'published' ? 'draft' : 'published');
            var toggleLabel =
              next === 'published' ? 'جاري النشر...' : 'جاري تحديث الحالة...';
            await runWithPublishProgress(toggleLabel, async function (setPct) {
              setPct(30);
              await applyCourseStatus(target.id, next);
              setPct(95);
              return { next: next };
            });
            if (next === 'published') {
              setCoursesView('active');
              showToast('تم النشر بنجاح!', 'success');
            } else {
              renderCoursesTable();
              if (next === 'suspended') showToast('تم تعليق الكورس', 'info');
              else showToast('تم نقل الكورس إلى المسودة', 'info');
            }
          } catch (err) {
            alert((err && err.message) || 'تعذر تحديث حالة النشر');
          }
        })();
        return;
      }

      if (restoreBtn) {
        (async function () {
          try {
            await applyRestoreCourse(restoreBtn.getAttribute('data-restore-course'));
            renderCoursesTable();
            showToast('تمت استعادة الكورس', 'success');
          } catch (err) {
            alert((err && err.message) || 'تعذر استعادة الكورس');
          }
        })();
        return;
      }

      if (purgeBtn) {
        if (!window.confirm('هل أنت متأكد من الحذف النهائي لهذا الكورس؟ لا يمكن التراجع عن هذا الإجراء.')) return;
        (async function () {
          try {
            await applyPurgeCourse(purgeBtn.getAttribute('data-purge-course'));
            renderCoursesTable();
            showToast('تم الحذف النهائي من المنصة', 'info');
          } catch (err) {
            alert((err && err.message) || 'تعذر الحذف النهائي');
          }
        })();
        return;
      }

      if (deleteBtn) {
        if (!window.confirm('نقل هذا الكورس إلى المسودات؟ يمكن استعادته لاحقاً.')) return;
        (async function () {
          try {
            await applySoftDeleteCourse(deleteBtn.getAttribute('data-delete-course'));
            renderCoursesTable();
            showToast('تم نقل الكورس إلى المسودة', 'info');
          } catch (err) {
            alert((err && err.message) || 'تعذر نقل الكورس للمسودة');
          }
        })();
      }
    });

    document.addEventListener('change', function (e) {
      if (!e.target || !e.target.getAttribute) return;
      var fileIndex = e.target.getAttribute('data-lesson-file');
      if (fileIndex == null) return;
      var lessonIdx = Number(fileIndex);
      var file = e.target.files && e.target.files[0];
      if (!file || isNaN(lessonIdx) || !lessonDrafts[lessonIdx]) return;
      collectLessonDraftsFromDom();
      simulateVideoUpload(file.name, function () {
        lessonDrafts[lessonIdx].videoFileName = file.name;
        var nameInput = document.querySelector(
          '[data-lesson-field="videoFileName"][data-lesson-index="' + lessonIdx + '"]'
        );
        if (nameInput) nameInput.value = file.name;
        showToast('تم ربط ملف الفيديو: ' + file.name, 'success');
      });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var modal = document.getElementById('courseEditorModal');
      if (modal && !modal.hidden) closeCourseModal();
    });

    window.addEventListener('storage', function (e) {
      if (usesFirestoreCourses()) return;
      if (
        e.key === 'platform_courses' ||
        e.key === 'ifa_platform_courses' ||
        e.key === 'ifa_approved_instructors'
      ) {
        renderCoursesTable();
      }
    });

    document.addEventListener('ifa:platform-courses-changed', renderCoursesTable);
    window.addEventListener('ifa:platform-courses-changed', renderCoursesTable);
    document.addEventListener('ifa:courses-firestore-changed', renderCoursesTable);
    window.addEventListener('ifa:courses-firestore-changed', renderCoursesTable);

    (function attachCoursesFirestoreSubscribe(attempts) {
      if (coursesLiveBound) return;
      var Firestore = window.PlatformCoursesFirestore;
      if (Firestore && typeof Firestore.subscribe === 'function') {
        coursesLiveBound = true;
        Firestore.subscribe(function () {
          renderCoursesTable();
        });
        return;
      }
      if (attempts > 40) return;
      window.setTimeout(function () {
        attachCoursesFirestoreSubscribe(attempts + 1);
      }, 50);
    })(0);

    document.addEventListener('ifa:instructor-status-changed', function () {
      var modal = document.getElementById('courseEditorModal');
      if (modal && !modal.hidden) {
        fillInstructorSelect((document.getElementById('courseEditorInstructor') || {}).value);
      }
    });

    renderCoursesTable();
  }

  window.renderAdminCoursesTable = renderCoursesTable;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
