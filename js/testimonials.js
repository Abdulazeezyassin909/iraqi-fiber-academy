/**
 * Public testimonials — Firestore (testimonials) with localStorage fallback.
 */
(function (global) {
  'use strict';

  var KEY = 'ifa_platform_testimonials';

  function uid() {
    return 'tst-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function isAdminPreview() {
    try {
      if (global.self !== global.top) return true;
    } catch (err) {
      return true;
    }
    try {
      return new URLSearchParams(global.location.search).get('mode') === 'admin-preview';
    } catch (err2) {
      return false;
    }
  }

  function normalizeStatus(value) {
    var s = String(value == null ? '' : value).trim().toLowerCase();
    if (s === 'pending') return 'pending';
    if (global.CmsStatus && typeof global.CmsStatus.normalize === 'function') {
      return global.CmsStatus.normalize(value);
    }
    if (s === 'trash' || s === 'deleted') return 'trash';
    if (s === 'draft' || s === 'hidden') return 'draft';
    return 'published';
  }

  function isActiveStatus(status) {
    if (global.CmsStatus && typeof global.CmsStatus.isActive === 'function') {
      return global.CmsStatus.isActive(status);
    }
    var s = normalizeStatus(status);
    return s === 'published' || s === 'draft';
  }

  function isTrashStatus(status) {
    if (global.CmsStatus && typeof global.CmsStatus.isTrash === 'function') {
      return global.CmsStatus.isTrash(status);
    }
    return normalizeStatus(status) === 'trash';
  }

  function defaultTestimonials() {
    return [
      {
        id: 'tst-1',
        name: 'محمد العتيبي',
        role: 'مدير فني — شركة اتصالات',
        text: 'المحاكي غيّر طريقة تدريبي للفنيين الجدد. أصبح بإمكانهم ارتكاب الأخطاء والتعلم منها دون تكلفة معدات باهظة.',
        rating: 5,
        avatar: '',
        status: 'published',
      },
      {
        id: 'tst-2',
        name: 'سارة الحربي',
        role: 'مهندسة ألياف ضوئية',
        text: 'كمهندسة شبكات، أعجبني مستوى التفاصيل في محاكاة OTDR. المنحنيات واقعية جداً وساعدتني في فهم قراءة الأعطال بسرعة.',
        rating: 5,
        avatar: '',
        status: 'published',
      },
      {
        id: 'tst-3',
        name: 'عبدالله القحطاني',
        role: 'فني FTTH — مستقل',
        text: 'انتقلت من صفر معرفة إلى القدرة على تصميم شبكة FTTH كاملة خلال شهرين. المسار التعليمي منظّم وواضح جداً.',
        rating: 4,
        avatar: '',
        status: 'published',
      },
    ];
  }

  function clampRating(n) {
    var r = Number(n);
    if (!isFinite(r)) r = 5;
    r = Math.round(r);
    if (r < 1) r = 1;
    if (r > 5) r = 5;
    return r;
  }

  function stars(rating) {
    var r = clampRating(rating);
    var out = '';
    var i;
    for (i = 1; i <= 5; i++) out += i <= r ? '★' : '☆';
    return out;
  }

  function initial(name) {
    var s = String(name || '').trim();
    return s ? s.charAt(0) : '؟';
  }

  function normalizeTestimonial(item) {
    var t = item && typeof item === 'object' ? item : {};
    return {
      id: String(t.id || uid()),
      name: String(t.name || '').trim(),
      role: String(t.role || '').trim(),
      text: String(t.text || '').trim(),
      rating: clampRating(t.rating),
      avatar: String(t.avatar || ''),
      uid: String(t.uid || '').trim(),
    status: normalizeStatus(t.status),
      sortOrder: isFinite(Number(t.sortOrder)) ? Number(t.sortOrder) : 0,
    };
  }

  function usesFirestoreTestimonials() {
    return !!(
      global.PlatformTestimonialsFirestore &&
      typeof global.PlatformTestimonialsFirestore.isReady === 'function' &&
      global.PlatformTestimonialsFirestore.isReady()
    );
  }

  function sortTestimonials(list) {
    return (list || []).slice().sort(function (a, b) {
      var orderA = isFinite(Number(a.sortOrder)) ? Number(a.sortOrder) : 0;
      var orderB = isFinite(Number(b.sortOrder)) ? Number(b.sortOrder) : 0;
      if (orderA !== orderB) return orderA - orderB;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });
  }

  function readLocalTestimonials() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return null;
      return sortTestimonials(parsed.map(normalizeTestimonial));
    } catch (err) {
      return null;
    }
  }

  function isPublishedStatus(status) {
    if (normalizeStatus(status) === 'pending') return false;
    if (global.CmsStatus && typeof global.CmsStatus.isPublished === 'function') {
      return global.CmsStatus.isPublished(status);
    }
    return normalizeStatus(status) === 'published';
  }

  function getAllTestimonials() {
    if (usesFirestoreTestimonials()) {
      return sortTestimonials(global.PlatformTestimonialsFirestore.getCachedTestimonials());
    }
    var local = readLocalTestimonials();
    if (local && local.length) return local;
    return defaultTestimonials();
  }

  function getTestimonials() {
    return getAllTestimonials().filter(function (t) {
      return isActiveStatus(t.status);
    });
  }

  function getTrashedTestimonials() {
    return getAllTestimonials().filter(function (t) {
      return isTrashStatus(t.status);
    });
  }

  function getPublishedTestimonials() {
    if (usesFirestoreTestimonials()) {
      return sortTestimonials(global.PlatformTestimonialsFirestore.getCachedTestimonials()).filter(function (t) {
        return isPublishedStatus(t.status);
      });
    }

    var published = getAllTestimonials().filter(function (t) {
      return isPublishedStatus(t.status);
    });
    if (published.length) return published;

    var local = readLocalTestimonials();
    if (local && local.length) return [];

    return defaultTestimonials();
  }

  function saveTestimonials(list) {
    if (usesFirestoreTestimonials()) {
      console.warn(
        '[PlatformTestimonials] saveTestimonials ignored while Firestore sync is active — use PlatformTestimonialsFirestore CRUD'
      );
      return sortTestimonials((Array.isArray(list) ? list : []).map(normalizeTestimonial));
    }
    var next = sortTestimonials((Array.isArray(list) ? list : []).map(normalizeTestimonial));
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch (err) {
      console.error('[PlatformTestimonials] save failed', err);
    }
    renderPublic();
    try {
      global.dispatchEvent(new CustomEvent('ifa:platform-testimonials-changed'));
    } catch (err2) {
      /* ignore */
    }
    return next;
  }

  function cardHtml(item) {
    var avatar = item.avatar
      ? '<img class="testimonial-card__avatar-img" src="' +
        escapeHtml(item.avatar) +
        '" alt="' +
        escapeHtml(item.name) +
        '" />'
      : escapeHtml(initial(item.name));
    return (
      '<article class="testimonial-card fade-in visible" tabindex="0" role="button" data-testimonial-id="' +
      escapeHtml(item.id) +
      '" data-testimonial-name="' +
      escapeHtml(item.name) +
      '" data-testimonial-role="' +
      escapeHtml(item.role) +
      '" data-testimonial-text="' +
      escapeHtml(item.text) +
      '">' +
      '<div class="testimonial-card__avatar">' +
      avatar +
      '</div>' +
      '<div class="testimonial-card__author">' +
      '<div class="testimonial-card__name">' +
      escapeHtml(item.name) +
      '</div>' +
      '<div class="testimonial-card__role">' +
      escapeHtml(item.role) +
      '</div>' +
      '</div>' +
      '<div class="testimonial-card__stars">' +
      stars(item.rating) +
      '</div>' +
      '<p class="testimonial-card__text">' +
      escapeHtml(item.text) +
      '</p></article>'
    );
  }

  function findPublicTestimonialsHost() {
    return (
      document.getElementById('testimonials-grid') ||
      document.querySelector('.testimonials__grid') ||
      document.getElementById('publicTestimonialsGrid')
    );
  }

  function renderPublic() {
    var grid = findPublicTestimonialsHost();
    if (!grid) return;
    var section = document.querySelector('.testimonials-section') || grid.closest('section');
    if (section) section.style.display = 'block';
    var list = getPublishedTestimonials();
    if (isAdminPreview()) {
      var all = getTestimonials();
      if (all.length) list = all;
    }
    if (list.length) {
      grid.innerHTML = list.map(cardHtml).join('');
    } else if (isAdminPreview()) {
      grid.innerHTML = '';
    } else {
      grid.innerHTML =
        '<p class="testimonials__empty" role="status">لا توجد آراء منشورة حالياً.</p>';
    }
    if (typeof global.reobserveAnimations === 'function') {
      global.reobserveAnimations(grid);
    }
    bindTestimonialModal(grid);
    bindReviewComposer();
  }

  function loggedInUser() {
    var Auth = global.IFAAuth;
    if (!Auth || typeof Auth.isLoggedIn !== 'function' || !Auth.isLoggedIn()) return null;
    var firebaseUser = Auth.auth && Auth.auth.currentUser;
    if (firebaseUser && firebaseUser.uid) return firebaseUser;
    return null;
  }

  function bindReviewComposer() {
    var section = document.querySelector('.testimonials-section');
    if (!section || section.dataset.reviewBound === '1') return;
    section.dataset.reviewBound = '1';
    var header = section.querySelector('.section__header');
    if (!header) return;
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'testimonials__write';
    button.textContent = 'اكتب رأيك';
    button.hidden = !loggedInUser();
    header.appendChild(button);
    button.addEventListener('click', openReviewForm);
    function syncButton() {
      button.hidden = !loggedInUser();
    }
    global.addEventListener('ifa:auth-changed', syncButton);
    global.setTimeout(syncButton, 600);
  }

  function openReviewForm() {
    if (!loggedInUser()) return;
    var modal = document.getElementById('reviewSubmitModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'reviewSubmitModal';
      modal.className = 'testimonial-modal';
      modal.innerHTML =
        '<div class="testimonial-modal__backdrop" data-close-review></div>' +
        '<form class="testimonial-modal__panel" role="dialog" aria-modal="true" aria-labelledby="reviewSubmitTitle">' +
        '<button type="button" class="testimonial-modal__close" data-close-review aria-label="إغلاق">×</button>' +
        '<h3 id="reviewSubmitTitle">اكتب رأيك</h3>' +
        '<div class="review-stars" role="radiogroup" aria-label="التقييم">' +
        [1, 2, 3, 4, 5]
          .map(function (n) {
            return (
              '<button type="button" class="review-stars__btn" data-star="' +
              n +
              '" aria-label="' +
              n +
              ' من 5">☆</button>'
            );
          })
          .join('') +
        '</div>' +
        '<label class="review-form__label" for="reviewRoleInput">الصفة / المسمى الوظيفي</label>' +
        '<div class="review-role-chips">' +
        ['طالب', 'مهندس ألياف ضوئية', 'فني FTTH', 'مستقل']
          .map(function (label) {
            return '<button type="button" class="review-role-chip" data-role-chip="' + label + '">' + label + '</button>';
          })
          .join('') +
        '</div>' +
        '<input id="reviewRoleInput" class="review-form__role" type="text" maxlength="80" placeholder="أدخل المسمى الوظيفي أو التخصص مثل: مهندس اتصالات، فني شبكات، طالب" />' +
        '<textarea class="review-form__text" rows="5" maxlength="1000" required placeholder="اكتب تجربتك مع المنصة"></textarea>' +
        '<p class="review-form__status" role="status"></p>' +
        '<button class="review-form__submit" type="submit">إرسال التقييم</button>' +
        '</form>';
      document.body.appendChild(modal);
      var rating = 0;
      modal.addEventListener('click', function (event) {
        if (event.target.closest('[data-close-review]')) modal.hidden = true;
        var star = event.target.closest('[data-star]');
        var chip = event.target.closest('[data-role-chip]');
        if (chip) {
          var roleInput = document.getElementById('reviewRoleInput');
          if (roleInput) roleInput.value = chip.getAttribute('data-role-chip') || '';
          modal.querySelectorAll('[data-role-chip]').forEach(function (btn) {
            btn.classList.toggle('is-on', btn === chip);
          });
        }
        if (star) {
          rating = Number(star.getAttribute('data-star'));
          modal.querySelectorAll('[data-star]').forEach(function (btn) {
            var value = Number(btn.getAttribute('data-star'));
            btn.textContent = value <= rating ? '★' : '☆';
            btn.classList.toggle('is-on', value <= rating);
          });
        }
      });
      modal.querySelector('form').addEventListener('submit', async function (event) {
        event.preventDefault();
        var status = modal.querySelector('.review-form__status');
        var text = modal.querySelector('textarea').value;
        var api = global.PlatformTestimonialsFirestore;
        if (!rating) {
          status.textContent = 'اختر تقييماً من 1 إلى 5';
          return;
        }
        if (!api || typeof api.submitStudentReview !== 'function') {
          status.textContent = 'تعذّر الاتصال بقاعدة البيانات';
          return;
        }
        try {
          var roleInput = document.getElementById('reviewRoleInput');
          await api.submitStudentReview({
            text: text,
            rating: rating,
            role: roleInput ? roleInput.value : '',
          });
          status.textContent = 'تم إرسال التقييم للمراجعة وسيظهر بعد الموافقة عليه';
          modal.querySelector('textarea').value = '';
          if (roleInput) roleInput.value = '';
          modal.querySelectorAll('[data-role-chip]').forEach(function (btn) {
            btn.classList.remove('is-on');
          });
          rating = 0;
          modal.querySelectorAll('[data-star]').forEach(function (btn) {
            btn.textContent = '☆';
            btn.classList.remove('is-on');
          });
        } catch (err) {
          status.textContent = (err && err.message) || 'تعذّر إرسال التقييم';
        }
      });
    }
    var statusNode = modal.querySelector('.review-form__status');
    if (statusNode) statusNode.textContent = '';
    modal.hidden = false;
  }

  function bindTestimonialModal(grid) {
    if (grid.dataset.modalBound === '1') return;
    grid.dataset.modalBound = '1';
    grid.addEventListener('click', function (event) {
      var card = event.target.closest('.testimonial-card');
      if (!card || !grid.contains(card)) return;
      openTestimonialModal(card);
    });
    grid.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      var card = event.target.closest('.testimonial-card');
      if (!card) return;
      event.preventDefault();
      openTestimonialModal(card);
    });
  }

  function openTestimonialModal(card) {
    var modal = document.getElementById('testimonialModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'testimonialModal';
      modal.className = 'testimonial-modal';
      modal.hidden = true;
      modal.innerHTML =
        '<div class="testimonial-modal__backdrop" data-close-testimonial></div>' +
        '<div class="testimonial-modal__panel" role="dialog" aria-modal="true" aria-labelledby="testimonialModalName">' +
        '<button type="button" class="testimonial-modal__close" data-close-testimonial aria-label="إغلاق">×</button>' +
        '<h3 id="testimonialModalName"></h3>' +
        '<p class="testimonial-modal__role" id="testimonialModalRole"></p>' +
        '<p class="testimonial-modal__text" id="testimonialModalText"></p>' +
        '</div>';
      document.body.appendChild(modal);
      modal.addEventListener('click', function (event) {
        if (event.target.closest('[data-close-testimonial]')) modal.hidden = true;
      });
    }
    document.getElementById('testimonialModalName').textContent = card.getAttribute('data-testimonial-name') || '';
    document.getElementById('testimonialModalRole').textContent = card.getAttribute('data-testimonial-role') || '';
    document.getElementById('testimonialModalText').textContent = card.getAttribute('data-testimonial-text') || '';
    modal.hidden = false;
  }

  function loadPublicTestimonials() {
    renderPublic();
  }

  function bindPublic() {
    try {
      renderPublic();
    } catch (err) {
      console.error('[PlatformTestimonials] public render failed', err);
    }
    global.addEventListener('storage', function (e) {
      if (usesFirestoreTestimonials()) return;
      if (!e.key || e.key === KEY) renderPublic();
    });
    global.addEventListener('ifa:platform-testimonials-changed', renderPublic);
    global.addEventListener('ifa:testimonials-firestore-changed', renderPublic);
    document.addEventListener('ifa:testimonials-firestore-changed', renderPublic);
    global.addEventListener('load', renderPublic);

    (function waitForFirestoreTestimonials(attempts) {
      if (
        global.PlatformTestimonialsFirestore &&
        typeof global.PlatformTestimonialsFirestore.subscribe === 'function'
      ) {
        global.PlatformTestimonialsFirestore.subscribe(function () {
          renderPublic();
        });
        return;
      }
      if (attempts > 40) return;
      global.setTimeout(function () {
        waitForFirestoreTestimonials(attempts + 1);
      }, 50);
    })(0);
  }

  global.PlatformTestimonials = {
    KEY: KEY,
    uid: uid,
    normalizeTestimonial: normalizeTestimonial,
    getTestimonials: getTestimonials,
    getAllTestimonials: getAllTestimonials,
    getTrashedTestimonials: getTrashedTestimonials,
    getPublishedTestimonials: getPublishedTestimonials,
    saveTestimonials: saveTestimonials,
    defaultTestimonials: defaultTestimonials,
    renderPublic: renderPublic,
    loadPublicTestimonials: loadPublicTestimonials,
    stars: stars,
    isAdminPreview: isAdminPreview,
    usesFirestore: usesFirestoreTestimonials,
  };
  global.loadPublicTestimonials = loadPublicTestimonials;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindPublic);
  } else {
    bindPublic();
  }
})(typeof window !== 'undefined' ? window : this);
