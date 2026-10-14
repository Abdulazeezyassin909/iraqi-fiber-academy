/**
 * Instructor dashboard UI controller — instructor-only scope.
 */
(function () {
  'use strict';

  var Dash = window.InstructorDash;
  var Apps = window.InstructorApps;
  var email = '';
  var selectedVideoName = '';
  var selectedTemplates = [];

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function showSection(id) {
    document.querySelectorAll('.inst-section').forEach(function (s) {
      s.classList.toggle('active', s.id === 'section-' + id);
    });
    document.querySelectorAll('[data-inst-section]').forEach(function (link) {
      link.classList.toggle('active', link.getAttribute('data-inst-section') === id);
    });
    if (id === 'courses') renderCourses();
    if (id === 'quizzes') {
      fillQuizSelectors();
      renderQuizQuestions();
    }
    if (id === 'qa') renderQA();
    if (id === 'analytics') renderAnalytics();
    if (id === 'overview') renderOverview();
  }

  function renderStatCards(targetId, stats) {
    var el = document.getElementById(targetId);
    if (!el) return;
    var items = [
      { label: 'كورساتي', value: stats.courses, trend: '' },
      { label: 'الطلاب المسجّلون', value: stats.enrolled, trend: '' },
      { label: 'المشاهدات', value: stats.views, trend: '' },
      { label: 'نسبة الإكمال', value: stats.completionRate + '%', trend: '' },
    ];
    el.innerHTML = items
      .map(function (it) {
        return (
          '<article class="admin-stat">' +
          '<div class="admin-stat__header"><div class="admin-stat__icon"></div></div>' +
          '<div class="admin-stat__value">' +
          esc(it.value) +
          '</div>' +
          '<div class="admin-stat__label">' +
          esc(it.label) +
          '</div>' +
          '</article>'
        );
      })
      .join('');
  }

  function renderOverview() {
    renderStatCards('instStats', Dash.getAnalytics(email));
  }

  function renderCourses() {
    var list = document.getElementById('coursesList');
    var courses = Dash.getCourses(email);
    if (!courses.length) {
      list.innerHTML = '<div class="inst-panel"><div class="inst-empty">لا توجد كورسات بعد. أضف أول كورس أعلاه.</div></div>';
      return;
    }

    list.innerHTML = courses
      .map(function (c) {
        var lessonsHtml = (c.lessons || [])
          .map(function (l) {
            var files = (l.templateFiles || [])
              .map(function (f) {
                return '<span class="inst-chip">' + esc(f.name) + '</span>';
              })
              .join('');
            var quizN = l.quiz && l.quiz.questions ? l.quiz.questions.length : 0;
            return (
              '<div class="inst-lesson" data-lesson-id="' +
              esc(l.id) +
              '">' +
              '<div class="inst-lesson__title">' +
              esc(l.title) +
              (quizN ? ' <span class="inst-chip">' + quizN + ' سؤال</span>' : '') +
              '</div>' +
              '<div class="inst-lesson__files">فيديو: ' +
              esc(l.videoTitle || '—') +
              (l.videoFileName ? ' · ' + esc(l.videoFileName) : '') +
              (l.videoUrl
                ? ' · <a href="' + esc(l.videoUrl) + '" target="_blank" rel="noopener noreferrer">رابط</a>'
                : '') +
              '<br>القوالب: ' +
              (files || '—') +
              '</div>' +
              '<div class="inst-actions">' +
              '<button type="button" class="admin-btn admin-btn--ghost admin-btn--sm" data-edit-lesson="' +
              esc(c.id) +
              ':' +
              esc(l.id) +
              '">تعديل</button>' +
              '<button type="button" class="admin-btn admin-btn--danger admin-btn--sm" data-delete-lesson="' +
              esc(c.id) +
              ':' +
              esc(l.id) +
              '">حذف</button>' +
              '</div>' +
              '</div>'
            );
          })
          .join('');

        return (
          '<div class="inst-panel" data-course-id="' +
          esc(c.id) +
          '">' +
          '<div class="inst-panel__body">' +
          '<div class="inst-course__top">' +
          '<div>' +
          '<div class="inst-course__title">' +
          esc(c.title) +
          (c.platformManaged ? ' <span class="inst-chip">من الإدارة</span>' : '') +
          '</div>' +
          '<div class="inst-course__meta">' +
          esc(c.description || 'بدون وصف') +
          ' · مسجّلون: ' +
          esc(c.enrolledCount || 0) +
          (c.durationWeeks || c.durationHours
            ? ' · مدة: ' +
              (c.durationWeeks ? c.durationWeeks + ' أسبوع' : '') +
              (c.durationWeeks && c.durationHours ? ' / ' : '') +
              (c.durationHours ? c.durationHours + ' ساعة' : '')
            : '') +
          '</div>' +
          '</div>' +
          '<div class="inst-actions">' +
          '<button type="button" class="admin-btn admin-btn--primary admin-btn--sm" data-add-lesson="' +
          esc(c.id) +
          '">+ حلقة</button>' +
          (c.platformManaged
            ? ''
            : '<button type="button" class="admin-btn admin-btn--danger admin-btn--sm" data-delete-course="' +
              esc(c.id) +
              '">حذف الكورس</button>') +
          '</div>' +
          '</div>' +
          (lessonsHtml || '<div class="inst-empty" style="padding:0.75rem 0;">لا حلقات بعد</div>') +
          '</div></div>'
        );
      })
      .join('');
  }

  function fillQuizSelectors() {
    var courseSel = document.getElementById('quizCourseSelect');
    var lessonSel = document.getElementById('quizLessonSelect');
    if (!courseSel || !lessonSel) return;
    var courses = Dash.getCourses(email);
    courseSel.innerHTML = courses
      .map(function (c) {
        return '<option value="' + esc(c.id) + '">' + esc(c.title) + '</option>';
      })
      .join('');
    if (!courses.length) {
      courseSel.innerHTML = '<option value="">— لا كورسات —</option>';
      lessonSel.innerHTML = '<option value="">—</option>';
      return;
    }
    fillLessonSelect(courseSel.value);
  }

  function fillLessonSelect(courseId) {
    var lessonSel = document.getElementById('quizLessonSelect');
    if (!lessonSel) return;
    var courses = Dash.getCourses(email);
    var course = null;
    for (var i = 0; i < courses.length; i++) {
      if (courses[i].id === courseId) course = courses[i];
    }
    var lessons = (course && course.lessons) || [];
    lessonSel.innerHTML = lessons.length
      ? lessons
          .map(function (l) {
            return '<option value="' + esc(l.id) + '">' + esc(l.title) + '</option>';
          })
          .join('')
      : '<option value="">— لا حلقات —</option>';
  }

  function renderQuizQuestions() {
    var box = document.getElementById('quizQuestionsList');
    var courseSel = document.getElementById('quizCourseSelect');
    var lessonSel = document.getElementById('quizLessonSelect');
    if (!box || !courseSel || !lessonSel) return;
    var courseId = courseSel.value;
    var lessonId = lessonSel.value;
    var courses = Dash.getCourses(email);
    var course = Dash.findCourse(courses, courseId);
    var lesson = Dash.findLesson(course, lessonId);
    if (!lesson) {
      box.innerHTML = '<div class="inst-empty">اختر كورساً وحلقة لعرض/بناء الامتحان</div>';
      return;
    }
    var qs = (lesson.quiz && lesson.quiz.questions) || [];
    if (!qs.length) {
      box.innerHTML = '<div class="inst-empty">لا أسئلة بعد — أضف أول سؤال MCQ أعلاه</div>';
      return;
    }
    box.innerHTML = qs
      .map(function (q, idx) {
            var opts = (q.options || [])
          .map(function (o, i) {
            var letters = ['أ', 'ب', 'ج', 'د'];
            return (
              '<div class="inst-quiz-option' +
              (i === q.correctIndex ? ' is-correct' : '') +
              '">' +
              (i === q.correctIndex ? '✓ ' : '') +
              esc(letters[i] || String(i + 1)) +
              ') ' +
              esc(o) +
              '</div>'
            );
          })
          .join('');
        return (
          '<div class="inst-quiz-q">' +
          '<strong>س' +
          (idx + 1) +
          ':</strong> ' +
          esc(q.text) +
          '<div class="inst-quiz-q__options">' +
          opts +
          '</div>' +
          '<div class="inst-actions">' +
          '<button type="button" class="admin-btn admin-btn--danger admin-btn--sm" data-delete-question="' +
          esc(q.id) +
          '">حذف السؤال</button>' +
          '</div></div>'
        );
      })
      .join('');
  }

  function renderQA() {
    var box = document.getElementById('qaList');
    var courses = Dash.getCourses(email);
    var rows = [];
    courses.forEach(function (c) {
      (c.lessons || []).forEach(function (l) {
        (l.comments || []).forEach(function (cm) {
          rows.push({ course: c, lesson: l, comment: cm });
        });
      });
    });

    if (!rows.length) {
      box.innerHTML = '<div class="inst-empty">لا توجد تعليقات من الطلاب حالياً</div>';
      return;
    }

    box.innerHTML = rows
      .map(function (r) {
        var cm = r.comment;
        var replyHtml = cm.reply
          ? '<div class="inst-qa__reply"><div class="inst-qa__reply-label">ردك</div>' +
            esc(cm.reply.text) +
            '</div>'
          : '<form class="inst-actions" data-reply-form="' +
            esc(r.course.id) +
            ':' +
            esc(r.lesson.id) +
            ':' +
            esc(cm.id) +
            '">' +
            '<input class="inst-input" name="reply" placeholder="اكتب ردك هنا..." required style="flex:1;min-width:180px;" />' +
            '<button type="submit" class="admin-btn admin-btn--primary admin-btn--sm">رد</button>' +
            '</form>';

        return (
          '<div class="inst-qa">' +
          '<div class="inst-qa__student">' +
          esc(cm.studentName) +
          '</div>' +
          '<div class="inst-qa__meta">' +
          esc(r.course.title) +
          ' · ' +
          esc(r.lesson.title) +
          (cm.reply ? '' : ' · <span class="inst-chip inst-badge-warn">بانتظار الرد</span>') +
          '</div>' +
          '<div class="inst-qa__text">' +
          esc(cm.text) +
          '</div>' +
          replyHtml +
          '</div>'
        );
      })
      .join('');
  }

  function renderAnalytics() {
    var stats = Dash.getAnalytics(email);
    renderStatCards('analyticsStats', stats);
    var courses = Dash.getCourses(email);
    var table = document.getElementById('analyticsTable');
    if (!courses.length) {
      table.innerHTML = '<div class="inst-empty">لا بيانات بعد</div>';
      return;
    }
    table.innerHTML =
      '<div class="admin-table-wrap"><table class="admin-table"><thead><tr>' +
      '<th>الكورس</th><th>المسجّلون</th><th>الحلقات</th><th>المشاهدات</th><th>الإكمالات</th><th>نسبة الإكمال</th>' +
      '</tr></thead><tbody>' +
      courses
        .map(function (c) {
          var views = Number(c.views) || 0;
          var completions = 0;
          (c.lessons || []).forEach(function (l) {
            views += Number(l.views) || 0;
            completions += Number(l.completions) || 0;
          });
          var rate = views ? Math.min(100, Math.round((completions / views) * 100)) : 0;
          return (
            '<tr><td>' +
            esc(c.title) +
            '</td><td>' +
            esc(c.enrolledCount || 0) +
            '</td><td>' +
            esc((c.lessons || []).length) +
            '</td><td>' +
            esc(views) +
            '</td><td>' +
            esc(completions) +
            '</td><td>' +
            rate +
            '%</td></tr>'
          );
        })
        .join('') +
      '</tbody></table></div>';
  }

  function openLessonModal(courseId, lessonId) {
    var modal = document.getElementById('lessonModal');
    document.getElementById('lessonCourseId').value = courseId || '';
    document.getElementById('lessonId').value = lessonId || '';
    selectedVideoName = '';
    selectedTemplates = [];
    document.getElementById('lessonVideoFileName').textContent = 'لم يتم اختيار ملف';
    document.getElementById('lessonTemplatesNames').textContent = 'لا توجد قوالب';
    document.getElementById('lessonForm').reset();
    document.getElementById('lessonCourseId').value = courseId || '';
    document.getElementById('lessonId').value = lessonId || '';

    if (lessonId) {
      var courses = Dash.getCourses(email);
      var course = Dash.findCourse(courses, courseId);
      var lesson = Dash.findLesson(course, lessonId);
      if (lesson) {
        document.getElementById('lessonTitle').value = lesson.title || '';
        document.getElementById('lessonVideoTitle').value = lesson.videoTitle || '';
        selectedVideoName = lesson.videoFileName || '';
        selectedTemplates = lesson.templateFiles || [];
        document.getElementById('lessonVideoFileName').textContent = selectedVideoName || 'لم يتم اختيار ملف';
        document.getElementById('lessonTemplatesNames').textContent = selectedTemplates.length
          ? selectedTemplates
              .map(function (f) {
                return f.name;
              })
              .join('، ')
          : 'لا توجد قوالب';
      }
    }
    modal.hidden = false;
  }

  function closeLessonModal() {
    document.getElementById('lessonModal').hidden = true;
  }

  function init() {
    if (Apps && Apps.absorbApprovalFromUrl) Apps.absorbApprovalFromUrl();

    var access = Dash && typeof Dash.ensureInstructorAccess === 'function'
      ? Dash.ensureInstructorAccess()
      : Promise.resolve(Dash && Dash.isInstructorAllowed ? Dash.isInstructorAllowed() : true);

    access.then(function (allowed) {
      if (!allowed) {
        alert('لوحة المدرب متاحة بعد موافقة الإدارة على طلب الانضمام.');
        window.location.href = 'index.html';
        return;
      }
      startDashboard();
    });
  }

  function startDashboard() {
    if (Apps && Apps.absorbApprovalFromUrl) Apps.absorbApprovalFromUrl();

    var app = document.getElementById('instructorApp');
    if (app) app.hidden = false;

    email =
      (Dash && Dash.currentInstructorEmail && Dash.currentInstructorEmail()) ||
      (Apps && Apps.getSessionEmail && Apps.getSessionEmail()) ||
      'instructor@local';
    email = String(email || 'instructor@local').trim().toLowerCase();

    if (Dash && typeof Dash.seedDemoIfEmpty === 'function') {
      Dash.seedDemoIfEmpty(email);
    }

    var emailChip = document.getElementById('instEmailChip');
    var nameChip = document.getElementById('instNameChip');
    var subtitle = document.getElementById('instSubtitle');
    if (emailChip) emailChip.textContent = email;
    if (nameChip) nameChip.textContent = email.split('@')[0] || 'مدرب';
    if (subtitle) subtitle.textContent = 'إدارة كورساتك وحلقاتك وامتحاناتك — ' + email;

    renderOverview();

    /* Sidebar */
    document.querySelectorAll('[data-inst-section]').forEach(function (link) {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        showSection(link.getAttribute('data-inst-section'));
        if (window.innerWidth <= 900) {
          document.getElementById('instSidebar').classList.remove('open');
          document.getElementById('instOverlay').classList.remove('visible');
        }
      });
    });

    document.querySelectorAll('[data-goto]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        showSection(btn.getAttribute('data-goto'));
      });
    });

    var toggle = document.getElementById('instMenuToggle');
    var sidebar = document.getElementById('instSidebar');
    var overlay = document.getElementById('instOverlay');
    if (toggle) {
      toggle.addEventListener('click', function () {
        sidebar.classList.toggle('open');
        overlay.classList.toggle('visible');
      });
    }
    if (overlay) {
      overlay.addEventListener('click', function () {
        sidebar.classList.remove('open');
        overlay.classList.remove('visible');
      });
    }

    function refreshAll() {
      renderCourses();
      fillQuizSelectors();
      renderOverview();
      renderQA();
      renderAnalytics();
      renderQuizQuestions();
    }

    /* Live sync from admin / other tabs */
    window.addEventListener('storage', function (e) {
      if (e.key === 'platform_courses' || e.key === 'ifa_platform_courses') refreshAll();
    });
    document.addEventListener('ifa:platform-courses-changed', refreshAll);

    /* Course form */
    var modulesList = document.getElementById('instructorModulesList');
    var lessonSeq = 0;
    var instructorQuizzes = {};

    function escapeInstructorHtml(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function instructorQuizBlock() {
      return (
        '<div class="admin-lesson-quiz" data-instructor-quiz>' +
        '<div class="admin-lesson-quiz__header">' +
        '<h5 class="admin-lesson-quiz__title">امتحان الحلقة / الاختبار</h5>' +
        '<span class="admin-lesson-quiz__count" data-instructor-quiz-count>0 سؤال</span>' +
        '</div>' +
        '<div class="admin-lesson-quiz__list" data-instructor-quiz-list>' +
        '<p class="admin-lesson-quiz__empty">لا أسئلة بعد — أضف أول سؤال MCQ أدناه</p>' +
        '</div>' +
        '<div class="admin-lesson-quiz__builder">' +
        '<label class="admin-field"><span class="admin-field__label">نص السؤال</span>' +
        '<input class="admin-field__input" type="text" placeholder="اكتب السؤال هنا..." data-inst-quiz-field="text" /></label>' +
        '<div class="admin-lesson-quiz__opts-grid">' +
        '<label class="admin-field"><span class="admin-field__label">خيار أ</span><input class="admin-field__input" type="text" data-inst-quiz-field="opt0" /></label>' +
        '<label class="admin-field"><span class="admin-field__label">خيار ب</span><input class="admin-field__input" type="text" data-inst-quiz-field="opt1" /></label>' +
        '<label class="admin-field"><span class="admin-field__label">خيار ج</span><input class="admin-field__input" type="text" data-inst-quiz-field="opt2" /></label>' +
        '<label class="admin-field"><span class="admin-field__label">خيار د</span><input class="admin-field__input" type="text" data-inst-quiz-field="opt3" /></label>' +
        '</div>' +
        '<div class="admin-lesson-quiz__builder-row">' +
        '<label class="admin-field"><span class="admin-field__label">الإجابة الصحيحة</span>' +
        '<select class="admin-field__input" data-inst-quiz-field="correct">' +
        '<option value="0">أ</option><option value="1">ب</option><option value="2">ج</option><option value="3">د</option>' +
        '</select></label>' +
        '<button type="button" class="admin-btn admin-btn--primary admin-btn--sm" data-add-instructor-quiz>إضافة السؤال للامتحان</button>' +
        '</div></div></div>'
      );
    }

    function renderInstructorQuizList(card) {
      var key = card.getAttribute('data-instructor-lesson');
      var questions = instructorQuizzes[key] || [];
      var list = card.querySelector('[data-instructor-quiz-list]');
      var count = card.querySelector('[data-instructor-quiz-count]');
      if (count) count.textContent = questions.length + ' سؤال';
      if (!list) return;
      if (!questions.length) {
        list.innerHTML = '<p class="admin-lesson-quiz__empty">لا أسئلة بعد — أضف أول سؤال MCQ أدناه</p>';
        return;
      }
      var letters = ['أ', 'ب', 'ج', 'د'];
      list.innerHTML = questions.map(function (q, qIdx) {
        var opts = (q.options || []).map(function (o, i) {
          return '<div class="admin-lesson-quiz__option' + (i === q.correctIndex ? ' is-correct' : '') + '">' +
            (i === q.correctIndex ? '✓ ' : '') + escapeInstructorHtml(letters[i] || String(i + 1)) + ') ' + escapeInstructorHtml(o) + '</div>';
        }).join('');
        return '<div class="admin-lesson-quiz__item">' +
          '<div class="admin-lesson-quiz__item-head"><strong>س' + (qIdx + 1) + ':</strong> ' + escapeInstructorHtml(q.text) +
          '<button type="button" class="admin-btn admin-btn--danger admin-btn--sm" data-remove-instructor-quiz="' + escapeInstructorHtml(q.id) + '">حذف</button></div>' +
          '<div class="admin-lesson-quiz__options">' + opts + '</div></div>';
      }).join('');
    }

    function addInstructorQuizQuestion(card) {
      var key = card.getAttribute('data-instructor-lesson');
      function val(field) {
        var el = card.querySelector('[data-inst-quiz-field="' + field + '"]');
        return el ? String(el.value || '').trim() : '';
      }
      var text = val('text');
      var options = [val('opt0'), val('opt1'), val('opt2'), val('opt3')];
      var correctIndex = Number(val('correct')) || 0;
      if (!text) {
        alert('نص السؤال مطلوب');
        return;
      }
      if (options.some(function (o) { return !o; })) {
        alert('يجب تعبئة الخيارات الأربعة');
        return;
      }
      if (!instructorQuizzes[key]) instructorQuizzes[key] = [];
      instructorQuizzes[key].push({
        id: 'q_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
        text: text,
        options: options,
        correctIndex: Math.max(0, Math.min(3, correctIndex)),
        createdAt: new Date().toISOString(),
      });
      ['text', 'opt0', 'opt1', 'opt2', 'opt3'].forEach(function (field) {
        var el = card.querySelector('[data-inst-quiz-field="' + field + '"]');
        if (el) el.value = '';
      });
      renderInstructorQuizList(card);
    }

    function addInstructorLessonCard() {
      if (!modulesList) return;
      lessonSeq += 1;
      var key = String(lessonSeq);
      instructorQuizzes[key] = [];
      var card = document.createElement('div');
      card.className = 'admin-lesson-card';
      card.setAttribute('data-instructor-lesson', key);
      card.innerHTML =
        '<div class="admin-lesson-card__head">' +
        '<span class="admin-lesson-card__order">درس</span>' +
        '<button type="button" class="admin-btn admin-btn--danger admin-btn--sm" data-remove-instructor-lesson>حذف</button>' +
        '</div>' +
        '<label class="admin-field"><span class="admin-field__label">عنوان الدرس</span>' +
        '<input class="admin-field__input" type="text" data-lesson-title /></label>' +
        '<label class="admin-field"><span class="admin-field__label">وصف الدرس</span>' +
        '<textarea class="admin-field__input admin-field__textarea" rows="2" data-lesson-description></textarea></label>' +
        '<label class="admin-field"><span class="admin-field__label">رابط YouTube أو ملف مباشر</span>' +
        '<input class="admin-field__input" type="text" data-lesson-video placeholder="https://youtube.com/..." dir="ltr" /></label>' +
        '<div class="form-check" style="text-align: center; margin-top: 15px; margin-bottom: 15px;">' +
        '<input type="checkbox" class="form-check-input instructor-lesson-preview" data-lesson-preview style="float: none; margin-left: 10px;">' +
        '<label class="form-check-label" style="display: inline-block;">معاينة مجانية (Free Preview)</label>' +
        '</div>' +
        instructorQuizBlock();
      modulesList.appendChild(card);
    }

    function collectInstructorLessons() {
      if (!modulesList) return [];
      var cards = modulesList.querySelectorAll('.admin-lesson-card');
      var lessons = [];
      for (var i = 0; i < cards.length; i++) {
        var titleEl = cards[i].querySelector('[data-lesson-title]');
        var descEl = cards[i].querySelector('[data-lesson-description]');
        var videoEl = cards[i].querySelector('[data-lesson-video]');
        var previewEl = cards[i].querySelector('[data-lesson-preview]');
        var title = titleEl ? String(titleEl.value || '').trim() : '';
        if (!title) continue;
        var key = cards[i].getAttribute('data-instructor-lesson');
        var questions = (instructorQuizzes[key] || []).slice();
        lessons.push({
          title: title,
          description: descEl ? String(descEl.value || '').trim() : '',
          videoUrl: videoEl ? String(videoEl.value || '').trim() : '',
          isFreePreview: !!(previewEl && previewEl.checked),
          quiz: { questions: questions },
        });
      }
      return lessons;
    }

    var addLessonBtn = document.getElementById('instructorAddLessonBtn');
    if (addLessonBtn) addLessonBtn.addEventListener('click', addInstructorLessonCard);
    if (modulesList) {
      modulesList.addEventListener('click', function (e) {
        var removeBtn = e.target.closest ? e.target.closest('[data-remove-instructor-lesson]') : null;
        if (removeBtn) {
          var removed = removeBtn.closest('.admin-lesson-card');
          if (removed) {
            delete instructorQuizzes[removed.getAttribute('data-instructor-lesson')];
            removed.remove();
          }
          return;
        }
        var addQuiz = e.target.closest ? e.target.closest('[data-add-instructor-quiz]') : null;
        if (addQuiz) {
          var quizCard = addQuiz.closest('.admin-lesson-card');
          if (quizCard) addInstructorQuizQuestion(quizCard);
          return;
        }
        var removeQuiz = e.target.closest ? e.target.closest('[data-remove-instructor-quiz]') : null;
        if (removeQuiz) {
          var owner = removeQuiz.closest('.admin-lesson-card');
          if (!owner) return;
          var qKey = owner.getAttribute('data-instructor-lesson');
          var qid = removeQuiz.getAttribute('data-remove-instructor-quiz');
          instructorQuizzes[qKey] = (instructorQuizzes[qKey] || []).filter(function (q) {
            return q.id !== qid;
          });
          renderInstructorQuizList(owner);
        }
      });
    }

    document.getElementById('instructorCourseForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var form = e.target;
      var submitBtn = form.querySelector('[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'جاري الحفظ...';
      }
      var authUser = window.IFAAuth && window.IFAAuth.getCurrentUser ? window.IFAAuth.getCurrentUser() : null;
      var localUser = window.IFAAuth && window.IFAAuth.getLocalAuthUser ? window.IFAAuth.getLocalAuthUser() : null;
      Promise.resolve(Dash.addCourse(email, {
        title: document.getElementById('instructorCourseTitle').value,
        description: document.getElementById('instructorCourseDescription').value,
        category: 'individual',
        thumbnailUrl: '',
        price: document.getElementById('instructorCoursePrice').value,
        currency: document.getElementById('instructorCourseCurrency').value,
        durationHours: document.getElementById('instructorCourseHours').value,
        durationWeeks: document.getElementById('instructorCourseWeeks').value,
        weeklySchedule: document.getElementById('instructorCourseSchedule').value,
        lessons: collectInstructorLessons(),
        simulators: Array.prototype.map.call(
          form.querySelectorAll('input[name="instructorCourseSimulator"]:checked'),
          function (input) { return input.value; }
        ),
        instructorId: authUser && authUser.uid ? authUser.uid : '',
        instructorName: (localUser && localUser.name) || '',
      })).then(function () {
        alert('تم رفع الكورس بنجاح. سيتم مراجعته والموافقة عليه من قبل قسم الإدارة خلال 24 ساعة.');
        form.reset();
        if (modulesList) modulesList.innerHTML = '';
        instructorQuizzes = {};
        refreshAll();
      }).catch(function (err) {
        alert((err && err.message) || 'تعذر إضافة الكورس');
      }).then(function () {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'رفع الكورس للمراجعة';
        }
      });
    });

    /* Lesson modal files */
    document.getElementById('lessonVideoFile').addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0] ? e.target.files[0] : null;
      selectedVideoName = file ? file.name : '';
      var nameEl = document.getElementById('lessonVideoFileName');
      if (!file) {
        nameEl.textContent = 'لم يتم اختيار ملف';
        return;
      }
      nameEl.textContent = 'جاري تحميل الفيديو...';
      var pct = 0;
      var timer = setInterval(function () {
        pct += 12 + Math.floor(Math.random() * 18);
        if (pct >= 100) {
          clearInterval(timer);
          nameEl.textContent = selectedVideoName + ' ✓';
        } else {
          nameEl.textContent = 'جاري تحميل الفيديو... ' + Math.min(99, pct) + '%';
        }
      }, 120);
    });
    document.getElementById('lessonTemplates').addEventListener('change', function (e) {
      selectedTemplates = [];
      if (e.target.files) {
        for (var i = 0; i < e.target.files.length; i++) {
          selectedTemplates.push({ name: e.target.files[i].name });
        }
      }
      document.getElementById('lessonTemplatesNames').textContent = selectedTemplates.length
        ? selectedTemplates
            .map(function (f) {
              return f.name;
            })
            .join('، ')
        : 'لا توجد قوالب';
    });

    document.getElementById('lessonForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var courseId = document.getElementById('lessonCourseId').value;
      var lessonId = document.getElementById('lessonId').value;
      var payload = {
        title: document.getElementById('lessonTitle').value,
        videoTitle: document.getElementById('lessonVideoTitle').value,
        videoFileName: selectedVideoName,
        templateFiles: selectedTemplates,
      };
      try {
        if (lessonId) Dash.updateLesson(email, courseId, lessonId, payload);
        else Dash.addLesson(email, courseId, payload);
        closeLessonModal();
        refreshAll();
        window.alert('تم النشر بنجاح!');
      } catch (err) {
        alert(err.message || 'تعذر حفظ الحلقة');
      }
    });

    document.querySelectorAll('[data-close-lesson-modal]').forEach(function (el) {
      el.addEventListener('click', closeLessonModal);
    });

    /* Delegated course/lesson actions */
    document.getElementById('coursesList').addEventListener('click', function (e) {
      var addBtn = e.target.closest('[data-add-lesson]');
      var delCourse = e.target.closest('[data-delete-course]');
      var editLesson = e.target.closest('[data-edit-lesson]');
      var delLesson = e.target.closest('[data-delete-lesson]');

      if (addBtn) {
        openLessonModal(addBtn.getAttribute('data-add-lesson'), '');
        return;
      }
      if (delCourse) {
        if (confirm('حذف هذا الكورس وجميع حلقاته؟')) {
          Dash.deleteCourse(email, delCourse.getAttribute('data-delete-course'));
          renderCourses();
          fillQuizSelectors();
          renderOverview();
        }
        return;
      }
      if (editLesson) {
        var parts = editLesson.getAttribute('data-edit-lesson').split(':');
        openLessonModal(parts[0], parts[1]);
        return;
      }
      if (delLesson) {
        if (confirm('حذف هذه الحلقة؟')) {
          var p = delLesson.getAttribute('data-delete-lesson').split(':');
          Dash.deleteLesson(email, p[0], p[1]);
          renderCourses();
          fillQuizSelectors();
          renderOverview();
        }
      }
    });

    /* Quiz section removed — questions are built inside each lesson. */
    var quizCourseSelect = document.getElementById('quizCourseSelect');
    if (quizCourseSelect) {
    quizCourseSelect.addEventListener('change', function () {
      fillLessonSelect(this.value);
      renderQuizQuestions();
    });
    document.getElementById('quizLessonSelect').addEventListener('change', renderQuizQuestions);

    document.getElementById('quizForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var courseId = document.getElementById('quizCourseSelect').value;
      var lessonId = document.getElementById('quizLessonSelect').value;
      if (!courseId || !lessonId) {
        alert('اختر كورساً وحلقة أولاً');
        return;
      }
      var courses = Dash.getCourses(email);
      var course = Dash.findCourse(courses, courseId);
      var lesson = Dash.findLesson(course, lessonId);
      var questions = (lesson.quiz && lesson.quiz.questions ? lesson.quiz.questions.slice() : []) || [];
      questions.push({
        id: 'q_' + Date.now().toString(36),
        text: document.getElementById('quizQuestion').value.trim(),
        options: [
          document.getElementById('quizOpt0').value.trim(),
          document.getElementById('quizOpt1').value.trim(),
          document.getElementById('quizOpt2').value.trim(),
          document.getElementById('quizOpt3').value.trim(),
        ],
        correctIndex: Number(document.getElementById('quizCorrect').value) || 0,
      });
      try {
        Dash.setLessonQuiz(email, courseId, lessonId, questions);
        e.target.reset();
        renderQuizQuestions();
        renderOverview();
      } catch (err) {
        alert(err.message || 'تعذر حفظ السؤال');
      }
    });

    document.getElementById('quizQuestionsList').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-delete-question]');
      if (!btn) return;
      var qid = btn.getAttribute('data-delete-question');
      var courseId = document.getElementById('quizCourseSelect').value;
      var lessonId = document.getElementById('quizLessonSelect').value;
      var courses = Dash.getCourses(email);
      var course = Dash.findCourse(courses, courseId);
      var lesson = Dash.findLesson(course, lessonId);
      var questions = ((lesson.quiz && lesson.quiz.questions) || []).filter(function (q) {
        return q.id !== qid;
      });
      Dash.setLessonQuiz(email, courseId, lessonId, questions);
      renderQuizQuestions();
    });
    }

    /* Q&A replies */
    document.getElementById('qaList').addEventListener('submit', function (e) {
      var form = e.target.closest('[data-reply-form]');
      if (!form) return;
      e.preventDefault();
      var parts = form.getAttribute('data-reply-form').split(':');
      var reply = form.querySelector('[name="reply"]').value;
      try {
        Dash.replyToComment(email, parts[0], parts[1], parts[2], reply);
        renderQA();
        renderOverview();
      } catch (err) {
        alert(err.message || 'تعذر إرسال الرد');
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
