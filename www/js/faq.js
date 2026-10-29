/**
 * Public FAQ accordion — localStorage CMS (ifa_platform_faqs).
 */
(function (global) {
  'use strict';

  var KEY = 'ifa_platform_faqs';

  function uid() {
    return 'faq-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
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
    if (global.CmsStatus && typeof global.CmsStatus.normalize === 'function') {
      return global.CmsStatus.normalize(value);
    }
    var s = String(value == null ? '' : value).trim().toLowerCase();
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

  function applyFaqRebrandPatches(list) {
    return (list || []).map(function (faq) {
      var next = Object.assign({}, faq);
      if (next.answer) {
        next.answer = next.answer
          .replace(/أكاديمية الفايبر العراقية/g, 'منصة مسار المهندس ‎°360')
          .replace(/أكاديمية الفايبر/g, 'منصة مسار المهندس ‎°360');
      }
      if (next.question) {
        next.question = next.question
          .replace(/أكاديمية الفايبر العراقية/g, 'منصة مسار المهندس ‎°360')
          .replace(/أكاديمية الفايبر/g, 'منصة مسار المهندس ‎°360');
      }
      if (
        next.id === 'faq-3' ||
        (next.question && next.question.indexOf('متى سيكون المحاكي التفاعلي') !== -1)
      ) {
        next.question = 'هل المحاكي التفاعلي متاح الآن؟';
        next.answer =
          'المحاكي التفاعلي متاح الآن بالكامل! يمكنك الوصول إليه والبدء بالتطبيق العملي فور اشتراكك في الكورس.';
      }
      return next;
    });
  }

  function defaultFaqs() {
    return [
      {
        id: 'faq-1',
        question: 'ما هي منصة مسار المهندس ‎°360 وما الذي تقدمها؟',
        answer:
          'منصة مسار المهندس ‎°360 (Engineer Path °360) هي منصة المسار المهني الهندسي — مسارات تعليمية منظمة ومحاكيات تفاعلية لبناء مهاراتك في الاتصالات والبنية التحتية، من الأساسيات حتى الاحتراف.',
        status: 'published',
      },
      {
        id: 'faq-2',
        question: 'هل أحتاج خبرة سابقة للبدء؟',
        answer:
          'لا، المسار التعليمي مصمم للبدء من الصفر. تبدأ بالمفاهيم الأساسية وتتدرج حتى المستوى الاحترافي. الباقة المجانية تتيح لك تجربة المنصة والتأكد من ملاءمتها لك قبل الاشتراك.',
        status: 'published',
      },
      {
        id: 'faq-3',
        question: 'هل المحاكي التفاعلي متاح الآن؟',
        answer:
          'المحاكي التفاعلي متاح الآن بالكامل! يمكنك الوصول إليه والبدء بالتطبيق العملي فور اشتراكك في الكورس.',
        status: 'published',
      },
      {
        id: 'faq-4',
        question: 'هل الشهادات معتمدة؟',
        answer:
          'شهادات الباقة الاحترافية معتمدة من منصة مسار المهندس ‎°360 وتُثبت إتمامك للمسار التدريبي الكامل واجتياز المشاريع العملية.',
        status: 'published',
      },
      {
        id: 'faq-5',
        question: 'هل يمكنني إلغاء اشتراكي في أي وقت؟',
        answer:
          'نعم، يمكنك إلغاء اشتراكك في أي وقت من لوحة التحكم الخاصة بك. سيستمر وصولك حتى نهاية فترة الاشتراك المدفوعة.',
        status: 'published',
      },
      {
        id: 'faq-6',
        question: 'ما الأجهزة والمتصفحات المدعومة؟',
        answer:
          'المنصة تعمل على جميع الأجهزة عبر المتصفحات الحديثة (Chrome, Firefox, Edge, Safari). للمحاكي المتقدم ننصح باستخدام حاسوب مع شاشة لا تقل عن 13 بوصة.',
        status: 'published',
      },
    ];
  }

  function normalizeFaq(item) {
    var f = item && typeof item === 'object' ? item : {};
    return {
      id: String(f.id || uid()),
      question: String(f.question || '').trim(),
      answer: String(f.answer || '').trim(),
      status: normalizeStatus(f.status),
      sortOrder: isFinite(Number(f.sortOrder)) ? Number(f.sortOrder) : 0,
    };
  }

  function usesFirestoreFaqs() {
    return !!(
      global.PlatformFaqsFirestore &&
      typeof global.PlatformFaqsFirestore.isReady === 'function' &&
      global.PlatformFaqsFirestore.isReady()
    );
  }

  function sortFaqs(list) {
    return (list || []).slice().sort(function (a, b) {
      var orderA = isFinite(Number(a.sortOrder)) ? Number(a.sortOrder) : 0;
      var orderB = isFinite(Number(b.sortOrder)) ? Number(b.sortOrder) : 0;
      if (orderA !== orderB) return orderA - orderB;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });
  }

  function readLocalFaqs() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return null;
      return sortFaqs(parsed.map(normalizeFaq));
    } catch (err) {
      return null;
    }
  }

  function isPublishedStatus(status) {
    if (global.CmsStatus && typeof global.CmsStatus.isPublished === 'function') {
      return global.CmsStatus.isPublished(status);
    }
    return normalizeStatus(status) === 'published';
  }

  function getAllFaqs() {
    if (usesFirestoreFaqs()) {
      return sortFaqs(global.PlatformFaqsFirestore.getCachedFaqs());
    }
    var local = readLocalFaqs();
    if (local && local.length) return local;
    return defaultFaqs();
  }

  function getFaqs() {
    return getAllFaqs().filter(function (f) {
      return isActiveStatus(f.status);
    });
  }

  function getTrashedFaqs() {
    return getAllFaqs().filter(function (f) {
      return isTrashStatus(f.status);
    });
  }

  function getPublishedFaqs() {
    if (usesFirestoreFaqs()) {
      return sortFaqs(global.PlatformFaqsFirestore.getCachedFaqs()).filter(function (f) {
        return isPublishedStatus(f.status);
      });
    }

    var published = getAllFaqs().filter(function (f) {
      return isPublishedStatus(f.status);
    });
    if (published.length) return published;

    var local = readLocalFaqs();
    if (local && local.length) return [];

    return defaultFaqs();
  }

  function saveFaqs(list) {
    if (usesFirestoreFaqs()) {
      console.warn('[PlatformFaqs] saveFaqs ignored while Firestore sync is active — use PlatformFaqsFirestore CRUD');
      return sortFaqs((Array.isArray(list) ? list : []).map(normalizeFaq));
    }
    var next = sortFaqs((Array.isArray(list) ? list : []).map(normalizeFaq));
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch (err) {
      console.error('[PlatformFaqs] save failed', err);
    }
    renderPublic();
    try {
      global.dispatchEvent(new CustomEvent('ifa:platform-faqs-changed'));
    } catch (err2) {
      /* ignore */
    }
    return next;
  }

  function itemHtml(faq) {
    return (
      '<div class="faq-item fade-in visible" data-faq-id="' +
      escapeHtml(faq.id) +
      '">' +
      '<button class="faq-item__question" type="button" aria-expanded="false">' +
      '<span>' +
      escapeHtml(faq.question) +
      '</span>' +
      '<span class="faq-item__icon">+</span>' +
      '</button>' +
      '<div class="faq-item__answer"><p>' +
      escapeHtml(faq.answer) +
      '</p></div>' +
      '</div>'
    );
  }

  function findPublicFaqHost() {
    return (
      document.getElementById('faq-accordion') ||
      document.querySelector('.faq__list') ||
      document.getElementById('publicFaqList')
    );
  }

  function renderPublic() {
    var listEl = findPublicFaqHost();
    if (!listEl) return;
    listEl.style.display = 'block';
    var list = applyFaqRebrandPatches(getPublishedFaqs());
    if (isAdminPreview()) {
      var all = getFaqs();
      if (all.length) list = applyFaqRebrandPatches(all);
    }
    if (list.length) {
      listEl.innerHTML = list.map(itemHtml).join('');
    } else if (isAdminPreview()) {
      listEl.innerHTML = '';
    } else {
      listEl.innerHTML =
        '<p class="faq__empty" role="status">لا توجد أسئلة منشورة حالياً.</p>';
    }
    if (typeof global.reobserveAnimations === 'function') {
      global.reobserveAnimations(listEl);
    }
  }

  function loadPublicFAQs() {
    renderPublic();
  }

  function bindPublic() {
    try {
      renderPublic();
    } catch (err) {
      console.error('[PlatformFaqs] public render failed', err);
    }
    global.addEventListener('storage', function (e) {
      if (usesFirestoreFaqs()) return;
      if (!e.key || e.key === KEY) renderPublic();
    });
    global.addEventListener('ifa:platform-faqs-changed', renderPublic);
    global.addEventListener('ifa:faqs-firestore-changed', renderPublic);
    document.addEventListener('ifa:faqs-firestore-changed', renderPublic);
    global.addEventListener('load', renderPublic);

    (function waitForFirestoreFaqs(attempts) {
      if (global.PlatformFaqsFirestore && typeof global.PlatformFaqsFirestore.subscribe === 'function') {
        global.PlatformFaqsFirestore.subscribe(function () {
          renderPublic();
        });
        return;
      }
      if (attempts > 40) return;
      global.setTimeout(function () {
        waitForFirestoreFaqs(attempts + 1);
      }, 50);
    })(0);
  }

  global.PlatformFaqs = {
    KEY: KEY,
    uid: uid,
    normalizeFaq: normalizeFaq,
    getFaqs: getFaqs,
    getAllFaqs: getAllFaqs,
    getTrashedFaqs: getTrashedFaqs,
    getPublishedFaqs: getPublishedFaqs,
    saveFaqs: saveFaqs,
    defaultFaqs: defaultFaqs,
    renderPublic: renderPublic,
    loadPublicFAQs: loadPublicFAQs,
    isAdminPreview: isAdminPreview,
    usesFirestore: usesFirestoreFaqs,
  };
  global.loadPublicFAQs = loadPublicFAQs;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindPublic);
  } else {
    bindPublic();
  }
})(typeof window !== 'undefined' ? window : this);
