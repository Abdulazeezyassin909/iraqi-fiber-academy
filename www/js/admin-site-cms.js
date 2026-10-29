/**
 * Admin CMS — إدارة موقعي (simulators, articles, FAQs, testimonials).
 */
(function () {
  'use strict';

  var editingArticleId = null;
  var articleToggleInFlight = false;
  var pendingArticleCoverFile = null;
  var articlesBinView = false;
  var articlesLiveBound = false;
  var faqBinView = false;
  var tstBinView = false;
  var editingFaqId = null;
  var faqToggleInFlight = false;
  var editingTestimonialId = null;
  var tstToggleInFlight = false;
  var pendingTestimonialAvatarFile = null;
  var selectedEditorImage = null;
  var resizeState = null;
  var dragState = null;

  var IMAGE_LAYOUTS = {
    inline: {
      display: 'inline-block',
      verticalAlign: 'middle',
      float: '',
      margin: '',
      shapeOutside: '',
      clear: '',
      zIndex: '',
      opacity: '',
    },
    'square-right': {
      float: 'right',
      margin: '12px',
      display: '',
      verticalAlign: '',
      shapeOutside: '',
      clear: '',
      zIndex: '',
      opacity: '',
    },
    'square-left': {
      float: 'left',
      margin: '12px',
      display: '',
      verticalAlign: '',
      shapeOutside: '',
      clear: '',
      zIndex: '',
      opacity: '',
    },
    tight: {
      float: 'right',
      margin: '8px',
      shapeOutside: 'margin-box',
      display: '',
      verticalAlign: '',
      clear: '',
      zIndex: '',
      opacity: '',
    },
    'top-bottom': {
      display: 'block',
      margin: '16px auto',
      clear: 'both',
      float: '',
      verticalAlign: '',
      shapeOutside: '',
      zIndex: '',
      opacity: '',
    },
    behind: {
      position: 'absolute',
      zIndex: '1',
      opacity: '0.6',
      pointerEvents: 'auto',
      cursor: 'move',
      float: '',
      margin: '',
      display: '',
      verticalAlign: '',
      shapeOutside: '',
      clear: '',
    },
    front: {
      position: 'absolute',
      zIndex: '10',
      pointerEvents: 'auto',
      float: '',
      margin: '',
      display: '',
      verticalAlign: '',
      shapeOutside: '',
      clear: '',
      opacity: '',
    },
  };

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function statusBadge(status) {
    if (status === 'trash') {
      return '<span class="cms-status cms-status--trash">مهمل</span>';
    }
    return status === 'draft'
      ? '<span class="cms-status cms-status--draft">مسودة</span>'
      : '<span class="cms-status cms-status--published">منشور</span>';
  }

  function updateArticlesBinToolbar() {
    var toggle = document.querySelector('[data-article-bin-toggle]');
    var addBtn = document.querySelector('[data-article-add]');
    var count =
      window.PlatformArticles && typeof window.PlatformArticles.getTrashedArticles === 'function'
        ? window.PlatformArticles.getTrashedArticles().length
        : 0;
    if (toggle) {
      toggle.textContent = articlesBinView
        ? 'العودة للقائمة'
        : count > 0
          ? 'سلة المهملات (' + count + ')'
          : 'سلة المهملات';
      toggle.setAttribute('aria-pressed', articlesBinView ? 'true' : 'false');
    }
    if (addBtn) addBtn.hidden = articlesBinView;
  }

  function updateFaqBinToolbar() {
    var toggle = document.querySelector('[data-faq-bin-toggle]');
    var addBtn = document.querySelector('[data-faq-add]');
    var count =
      window.PlatformFaqs && typeof window.PlatformFaqs.getTrashedFaqs === 'function'
        ? window.PlatformFaqs.getTrashedFaqs().length
        : 0;
    if (toggle) {
      toggle.textContent = faqBinView
        ? 'العودة للقائمة'
        : count > 0
          ? 'سلة المهملات (' + count + ')'
          : 'سلة المهملات';
      toggle.setAttribute('aria-pressed', faqBinView ? 'true' : 'false');
    }
    if (addBtn) addBtn.hidden = faqBinView;
  }

  function updateTestimonialsBinToolbar() {
    var toggle = document.querySelector('[data-tst-bin-toggle]');
    var addBtn = document.querySelector('[data-tst-add]');
    var restoreBtn = document.querySelector('[data-tst-restore-defaults]');
    var count =
      window.PlatformTestimonials &&
      typeof window.PlatformTestimonials.getTrashedTestimonials === 'function'
        ? window.PlatformTestimonials.getTrashedTestimonials().length
        : 0;
    if (toggle) {
      toggle.textContent = tstBinView
        ? 'العودة للقائمة'
        : count > 0
          ? 'سلة المهملات (' + count + ')'
          : 'سلة المهملات';
      toggle.setAttribute('aria-pressed', tstBinView ? 'true' : 'false');
    }
    if (addBtn) addBtn.hidden = tstBinView;
    if (restoreBtn) restoreBtn.hidden = tstBinView;
  }

  function toast(message, isError) {
    var el = $('adminToast');
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
    el.classList.toggle('admin-toast--error', !!isError);
    el.classList.toggle('admin-toast--success', !isError);
    window.clearTimeout(toast._t);
    toast._t = window.setTimeout(function () {
      el.hidden = true;
    }, 2800);
  }

  var PUBLISH_SUCCESS_TOAST = 'تم النشر بنجاح!';

  function waitMs(ms) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, ms);
    });
  }

  function setCmsSaveProgress(visible, percent, label) {
    var status = $('cmsSaveProgress');
    var bar = $('cmsSaveBar');
    var labelEl = $('cmsSaveLabel');
    if (!status) return;
    status.hidden = !visible;
    if (labelEl && label) labelEl.textContent = label;
    if (bar) bar.style.width = Math.max(0, Math.min(100, percent || 0)) + '%';
  }

  async function runWithCmsPublishProgress(label, stepsAsyncFn) {
    setCmsSaveProgress(true, 0, label);
    try {
      var result = await stepsAsyncFn(function (pct) {
        setCmsSaveProgress(true, pct, label);
      });
      setCmsSaveProgress(true, 100, 'اكتمل الحفظ');
      await waitMs(400);
      return result;
    } finally {
      setCmsSaveProgress(false, 0, 'جاري الحفظ…');
    }
  }

  function readFileAsDataUrl(file, done) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      done(String(reader.result || ''));
    };
    reader.readAsDataURL(file);
  }

  function reloadSitePreview() {
    var frame = $('site-preview-frame');
    if (!frame) return;
    try {
      frame.contentWindow.location.reload();
    } catch (err) {
      var src = frame.getAttribute('src') || 'index.html?mode=admin-preview';
      frame.src = src.split('#')[0] + '&_=' + Date.now();
    }
  }

  var MAX_SIM_ICON_BYTES = 512000;
  var pendingSimulatorIconFiles = {};
  var pendingShowcaseImageFiles = {};

  function clearPendingSimulatorMedia(simId) {
    if (!simId) return;
    delete pendingSimulatorIconFiles[simId];
    delete pendingShowcaseImageFiles[simId];
  }

  function clearAllPendingSimulatorMedia() {
    pendingSimulatorIconFiles = {};
    pendingShowcaseImageFiles = {};
  }

  function getShowcaseCardSimId(card) {
    return card ? card.getAttribute('data-showcase-editor') || '' : '';
  }

  function simIconPreviewHtml(meta) {
    if (meta && meta.iconType === 'image' && meta.icon) {
      return (
        '<img src="' +
        String(meta.icon).replace(/"/g, '&quot;') +
        '" alt="" />'
      );
    }
    return escapeHtml((meta && meta.icon) || '◆');
  }

  /* ---------- Simulators ---------- */
  function updateSimIconPreview(card) {
    if (!card) return;
    var preview = card.querySelector('[data-sim-icon-preview]');
    var iconValue = card.querySelector('[data-sim-icon-value]');
    var iconType = card.querySelector('[data-sim-icon-type]');
    if (!preview || !iconValue || !iconType) return;
    var meta = {
      icon: iconValue.value,
      iconType: iconType.value === 'image' ? 'image' : 'emoji',
    };
    preview.innerHTML = simIconPreviewHtml(meta);
  }

  function applyCompressedSimulatorIcon(card, file) {
    if (!card || !file) return;
    var simId = getShowcaseCardSimId(card);
    import('./simulator-media-upload.js?v=' + Date.now())
      .then(function (mod) {
        var compressFn = mod.compressIconForFirestore || mod.compressImageFile;
        if (typeof compressFn !== 'function') {
          throw new Error('Compression function missing in simulator-media-upload.js');
        }
        if (compressFn === mod.compressIconForFirestore) {
          return compressFn(file);
        }
        return compressFn(file, 256, 256, 0.88);
      })
      .then(function (dataUri) {
        if (simId) delete pendingSimulatorIconFiles[simId];
        var iconValue = card.querySelector('[data-sim-icon-value]');
        var iconType = card.querySelector('[data-sim-icon-type]');
        if (iconValue) iconValue.value = dataUri;
        if (iconType) iconType.value = 'image';
        updateSimIconPreview(card);
      })
      .catch(function (err) {
        console.error('[CMS] icon compression failed', err);
        toast(err && err.message ? err.message : 'فشل ضغط الأيقونة', true);
      });
  }

  function applyCompressedShowcaseImage(card, simId, file) {
    if (!card || !file) return;
    import('./simulator-media-upload.js?v=' + Date.now())
      .then(function (mod) {
        var compressFn = mod.compressShowcaseForFirestore || mod.compressImageFile;
        if (typeof compressFn !== 'function') {
          throw new Error('Compression function missing in simulator-media-upload.js');
        }
        if (compressFn === mod.compressShowcaseForFirestore) {
          return compressFn(file);
        }
        return compressFn(file, 400, 1200, 0.5);
      })
      .then(function (dataUri) {
        if (simId) delete pendingShowcaseImageFiles[simId];
        var hidden = card.querySelector('[data-showcase-image]');
        if (hidden) hidden.value = dataUri;
        var previewBox = card.querySelector('.cms-showcase-card__preview');
        if (previewBox) {
          previewBox.innerHTML =
            '<img class="cms-showcase-card__preview-img" src="' +
            String(dataUri).replace(/"/g, '&quot;') +
            '" alt="" />';
        }
      })
      .catch(function (err) {
        console.error('[CMS] showcase compression failed', err);
        toast(err && err.message ? err.message : 'فشل ضغط صورة العرض', true);
      });
  }

  function resetSimIcon(card) {
    if (!card) return;
    clearPendingSimulatorMedia(getShowcaseCardSimId(card));
    var iconValue = card.querySelector('[data-sim-icon-value]');
    var iconType = card.querySelector('[data-sim-icon-type]');
    var iconDefault = card.querySelector('[data-sim-icon-default]');
    if (!iconValue || !iconType) return;
    iconValue.value = iconDefault ? iconDefault.value : '◆';
    iconType.value = 'emoji';
    var fileInput = card.querySelector('[data-sim-icon-file]');
    if (fileInput) fileInput.value = '';
    updateSimIconPreview(card);
  }

  var MAX_SHOWCASE_IMAGE_BYTES = 900000;

  function getSimulatorsFirestoreApi() {
    return window.PlatformSimulatorsFirestore || null;
  }

  function isSimulatorsFirestoreModuleReady() {
    var Firestore = getSimulatorsFirestoreApi();
    return !!(Firestore && typeof Firestore.saveSimulatorsBundle === 'function');
  }

  function formatSimulatorsFirestoreLoadError(err) {
    var message = err && err.message ? String(err.message) : '';
    if (message.indexOf('Failed to fetch') !== -1 || message.indexOf('fetch') !== -1) {
      return 'تعذّر تحميل js/firestore-simulators.js — تحقق من النشر أو أعد تحميل الصفحة';
    }
    return 'تعذّر تحميل Firestore للمحاكيات: ' + (message || 'خطأ غير معروف');
  }

  async function waitForSimulatorsFirestoreApi(maxMs) {
    var timeoutMs = maxMs == null ? 12000 : maxMs;
    if (isSimulatorsFirestoreModuleReady()) {
      return getSimulatorsFirestoreApi();
    }

    if (window.__ifaSimulatorsFirestoreReady) {
      try {
        await Promise.race([
          window.__ifaSimulatorsFirestoreReady,
          new Promise(function (_, reject) {
            window.setTimeout(function () {
              reject(new Error('simulators-firestore-ready-timeout'));
            }, timeoutMs);
          }),
        ]);
      } catch (err) {
        if (!isSimulatorsFirestoreModuleReady()) {
          console.warn('[CMS simulators] ready promise settled without API', err);
        }
      }
    }

    if (isSimulatorsFirestoreModuleReady()) {
      return getSimulatorsFirestoreApi();
    }

    try {
      await import('./firestore-simulators.js');
    } catch (err) {
      console.error('[CMS simulators] dynamic import fallback failed', err);
      throw window.__ifaSimulatorsFirestoreLoadError || err;
    }

    if (!isSimulatorsFirestoreModuleReady()) {
      throw new Error('PlatformSimulatorsFirestore missing after import');
    }
    return getSimulatorsFirestoreApi();
  }

  function updateSimulatorsSaveButtonState() {
    var btn = $('cmsSimulatorsSaveAll');
    var status = $('cmsSimulatorsSaveAllStatus');
    if (!btn) return;

    if (isSimulatorsFirestoreModuleReady()) {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      if (
        status &&
        (status.textContent === 'جاري تحميل Firestore للمحاكيات...' ||
          status.textContent === 'تعذّر تحميل Firestore للمحاكيات — أعد تحميل الصفحة')
      ) {
        status.textContent = '';
      }
      return;
    }

    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    if (status && !status.textContent) {
      status.textContent = 'جاري تحميل Firestore للمحاكيات...';
    }
  }

  function formatSimulatorsPublishError(err) {
    var Firestore = getSimulatorsFirestoreApi();
    if (Firestore && typeof Firestore.formatFirestoreWriteError === 'function') {
      return Firestore.formatFirestoreWriteError(err);
    }
    if (err && err.code === 'permission-denied') {
      return 'رفض Firestore: حسابك لا يملك صلاحية المسؤول (admin) لكتابة settings/simulators';
    }
    var message = err && err.message ? String(err.message) : 'خطأ غير معروف';
    return 'فشل نشر إعدادات المحاكيات: ' + message;
  }

  function isSimUnderDevelopment(simId) {
    if (!window.PlatformSimulators) return false;
    return window.PlatformSimulators.isSimulatorUnderDevelopment(simId);
  }

  function renderSimulatorShowcaseManager() {
    var host = $('cmsSimulatorShowcaseList');
    if (!host || !window.PlatformSimulators || !window.PlatformSimulatorShowcase) return;

    var catalog = window.PlatformSimulators.getCatalog();
    var showcaseMeta = window.PlatformSimulatorShowcase.getShowcaseMeta();
    var cardMeta = window.PlatformSimulators.getSimulatorMeta();
    var defaults = window.PlatformSimulators.defaultSimulatorMeta();

    host.innerHTML = catalog
      .map(function (sim) {
        var sm = showcaseMeta[sim.id] || window.PlatformSimulatorShowcase.defaultShowcaseEntry();
        var cm = cardMeta[sim.id] || {};
        var d = defaults[sim.id] || {};
        var underDev = isSimUnderDevelopment(sim.id);
        var displayTitle = sm.title || cm.title || sim.label;
        var displayDesc = sm.description || cm.description || sim.description || '';
        var preview = sm.showcaseImage
          ? '<img class="cms-showcase-card__preview-img" src="' +
            String(sm.showcaseImage).replace(/"/g, '&quot;') +
            '" alt="" />'
          : '<div class="cms-showcase-card__preview-empty">معاينة افتراضية — ' +
            escapeHtml(sim.label) +
            '</div>';

        return (
          '<article class="cms-showcase-card" data-showcase-editor="' +
          escapeHtml(sim.id) +
          '">' +
          '<header class="cms-showcase-card__head">' +
          '<div><strong>' +
          escapeHtml(displayTitle) +
          '</strong><code>' +
          escapeHtml(sim.id) +
          '</code></div>' +
          (underDev
            ? '<span class="cms-showcase-card__badge cms-showcase-card__badge--soon">قيد التطوير</span>'
            : sm.visibleInShowcase !== false
              ? '<span class="cms-showcase-card__badge cms-showcase-card__badge--live">في العرض</span>'
              : '<span class="cms-showcase-card__badge">مخفي</span>') +
          '</header>' +
          '<div class="cms-showcase-card__body">' +
          '<div class="cms-showcase-card__preview-wrap">' +
          '<span class="cms-showcase-card__preview-label">صورة العرض (Showcase)</span>' +
          '<div class="cms-showcase-card__preview">' +
          preview +
          '</div>' +
          '<label class="cms-file-btn cms-file-btn--block">رفع صورة العرض<input type="file" data-showcase-image-file="' +
          escapeHtml(sim.id) +
          '" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden /></label>' +
          '<input type="hidden" data-showcase-image value="" />' +
          '<button type="button" class="admin-btn admin-btn--ghost" data-showcase-image-clear>إزالة الصورة</button>' +
          '</div>' +
          '<div class="cms-showcase-card__fields">' +
          '<div class="cms-showcase-card__icon-block">' +
          '<span class="admin-field__label">أيقونة بطاقة الشبكة</span>' +
          '<div class="cms-sim-card__icon cms-showcase-card__icon-preview" data-sim-icon-preview aria-hidden="true">' +
          simIconPreviewHtml(cm) +
          '</div>' +
          '<input type="hidden" data-sim-icon-value />' +
          '<input type="hidden" data-sim-icon-type />' +
          '<input type="hidden" data-sim-icon-default value="' +
          escapeHtml(d.icon || '◆') +
          '" />' +
          '<div class="cms-sim-icon-actions">' +
          '<label class="cms-file-btn">رفع أيقونة مخصصة (PNG / SVG / WebP)' +
          '<input type="file" data-sim-icon-file accept="image/png,image/svg+xml,image/webp,image/jpeg" hidden /></label>' +
          '<button class="admin-btn admin-btn--ghost" type="button" data-sim-icon-reset>استعادة الافتراضي</button>' +
          '</div>' +
          '<span class="admin-field__hint">تُعرض على بطاقة المحاكي في شبكة «المحاكيات» بالصفحة الرئيسية.</span>' +
          '</div>' +
          '<label class="admin-field"><span class="admin-field__label">العنوان (بطاقة + عرض الدوران)</span>' +
          '<input class="admin-field__input" data-showcase-title value="' +
          escapeHtml(sm.title || cm.title || '') +
          '" placeholder="' +
          escapeHtml(sim.label) +
          '" /></label>' +
          '<label class="admin-field"><span class="admin-field__label">الوصف (بطاقة + عرض الدوران)</span>' +
          '<textarea class="admin-field__input admin-field__textarea" data-showcase-desc rows="4" placeholder="وصف يظهر في البطاقة ومعاينة الدوران">' +
          escapeHtml(sm.description || cm.description || '') +
          '</textarea></label>' +
          '<label class="admin-field admin-field--inline">' +
          '<input type="checkbox" data-showcase-under-dev ' +
          (underDev ? 'checked' : '') +
          ' />' +
          '<span class="admin-field__label">قيد التطوير (Under Development)</span></label>' +
          '<label class="admin-field admin-field--inline">' +
          '<input type="checkbox" data-showcase-visible ' +
          (sm.visibleInShowcase !== false ? 'checked' : '') +
          ' />' +
          '<span class="admin-field__label">إظهار في دوران العرض (Showcase Rotation)</span></label>' +
          '</div></div></article>'
        );
      })
      .join('');

    host.querySelectorAll('[data-showcase-editor]').forEach(function (card) {
      var simId = card.getAttribute('data-showcase-editor');
      var sm = showcaseMeta[simId] || {};
      var cm = cardMeta[simId] || {};
      var imageInput = card.querySelector('[data-showcase-image]');
      if (imageInput) imageInput.value = sm.showcaseImage || '';
      var iconValue = card.querySelector('[data-sim-icon-value]');
      var iconType = card.querySelector('[data-sim-icon-type]');
      if (iconValue) iconValue.value = cm.icon || '';
      if (iconType) iconType.value = cm.iconType === 'image' ? 'image' : 'emoji';
    });
  }

  function collectShowcaseFromCard(card) {
    var simId = card.getAttribute('data-showcase-editor');
    var titleEl = card.querySelector('[data-showcase-title]');
    var descEl = card.querySelector('[data-showcase-desc]');
    var imageEl = card.querySelector('[data-showcase-image]');
    var visibleEl = card.querySelector('[data-showcase-visible]');
    var underDevEl = card.querySelector('[data-showcase-under-dev]');
    return {
      id: simId,
      title: titleEl ? titleEl.value : '',
      description: descEl ? descEl.value : '',
      showcaseImage: imageEl ? imageEl.value : '',
      visibleInShowcase: !!(visibleEl && visibleEl.checked),
      underDevelopment: !!(underDevEl && underDevEl.checked),
    };
  }

  function collectShowcaseIconFromCard(card, simId, current) {
    var iconValue = card.querySelector('[data-sim-icon-value]');
    var iconType = card.querySelector('[data-sim-icon-type]');
    var icon = iconValue ? iconValue.value : (current && current.icon) || '';
    var type = iconType && iconType.value === 'image' ? 'image' : 'emoji';
    if (!icon) {
      var defaults = window.PlatformSimulators.defaultSimulatorMeta();
      icon = (defaults[simId] && defaults[simId].icon) || '◆';
      type = 'emoji';
    } else if (type === 'image' && icon.indexOf('data:') !== 0 && current && current.iconType === 'image') {
      icon = current.icon || icon;
    }
    if (
      type !== 'image' &&
      (/^https?:\/\//i.test(icon) || icon.indexOf('firebasestorage.googleapis.com') !== -1)
    ) {
      type = 'image';
    }
    return { icon: icon, iconType: type };
  }

  function collectAllSimulatorShowcasePayload() {
    var host = $('cmsSimulatorShowcaseList');
    if (!host || !window.PlatformSimulatorShowcase || !window.PlatformSimulators) return null;

    var cards = host.querySelectorAll('[data-showcase-editor]');
    if (!cards.length) return null;

    var showcasePatch = {};
    var metaPatch = {};
    var comingSoonIds = [];
    var cardMeta = window.PlatformSimulators.getSimulatorMeta();

    cards.forEach(function (card) {
      var data = collectShowcaseFromCard(card);
      var simId = data.id;
      if (!simId) return;

      showcasePatch[simId] = {
        title: data.title,
        description: data.description,
        showcaseImage: data.showcaseImage,
        visibleInShowcase: data.visibleInShowcase,
      };

      var iconData = collectShowcaseIconFromCard(card, simId, cardMeta[simId] || {});
      metaPatch[simId] = {
        title: data.title,
        description: data.description,
        icon: iconData.icon,
        iconType: iconData.iconType,
      };

      if (data.underDevelopment) comingSoonIds.push(simId);
    });

    var intervalInput = $('cmsShowcaseInterval');
    var intervalSeconds =
      intervalInput && intervalInput.value
        ? intervalInput.value
        : window.PlatformSimulatorShowcase.getIntervalSeconds();

    return {
      cardsCount: cards.length,
      comingSoonIds: comingSoonIds,
      payload: {
        simulatorsMeta: metaPatch,
        showcaseMeta: showcasePatch,
        showcaseIntervalSeconds: intervalSeconds,
        platformSettings: { comingSoonSimulatorIds: comingSoonIds },
      },
    };
  }

  var isSimulatorsSaveInFlight = false;

  function withTimeout(promise, ms, errorMessage) {
    var timeoutId;
    var timeoutPromise = new Promise(function (_, reject) {
      timeoutId = setTimeout(function () {
        reject(new Error(errorMessage));
      }, ms);
    });
    return Promise.race([promise, timeoutPromise]).finally(function () {
      clearTimeout(timeoutId);
    });
  }

  async function saveAllSimulatorShowcaseCards() {
    if (isSimulatorsSaveInFlight) {
      console.warn('[CMS] Save already in progress.');
      return false;
    }

    var collected = collectAllSimulatorShowcasePayload();
    if (!collected) {
      toast('لا توجد بطاقات محاكيات للنشر — أعد تحميل الصفحة', true);
      return false;
    }

    var status = $('cmsSimulatorsSaveAllStatus');
    var Firestore;
    try {
      Firestore = await waitForSimulatorsFirestoreApi(12000);
    } catch (err) {
      console.error('[CMS simulators] Firestore module unavailable', err);
      var loadMessage = formatSimulatorsFirestoreLoadError(err);
      if (status) status.textContent = loadMessage;
      toast(loadMessage, true);
      return false;
    }

    if (!Firestore || typeof Firestore.saveSimulatorsBundle !== 'function') {
      var missingMessage =
        'تعذّر الاتصال بـ Firestore للمحاكيات — تأكد من تحميل platform-simulators-firestore-sync.js';
      if (status) status.textContent = missingMessage;
      toast(missingMessage, true);
      return false;
    }

    isSimulatorsSaveInFlight = true;
    try {
      await runWithCmsPublishProgress('جاري نشر المحاكيات...', async function (setPct) {
        setPct(10);
        await withTimeout(
          Firestore.saveSimulatorsBundle(collected.payload, {
            pendingIcons: pendingSimulatorIconFiles,
            pendingShowcase: pendingShowcaseImageFiles,
            onProgress: setPct,
          }),
          120000,
          'انتهى وقت الحفظ (Timeout). تحقق من اتصالك بالإنترنت.'
        );
        setPct(90);
      });

      clearAllPendingSimulatorMedia();

      if (status) {
        status.textContent =
          'تم النشر — ' +
          collected.cardsCount +
          ' محاكيات · قيد التطوير: ' +
          collected.comingSoonIds.length;
      }
      toast('تم حفظ ونشر المحاكيات بنجاح!', false);
      renderSimulatorShowcaseManager();
      return true;
    } catch (error) {
      console.error('[CMS] Publish failed:', error);
      var errorMessage =
        error && error.message ? String(error.message) : formatSimulatorsPublishError(error);
      if (status) {
        status.textContent = errorMessage;
      }
      toast('فشل الحفظ: ' + errorMessage, true);
      return false;
    } finally {
      isSimulatorsSaveInFlight = false;
      setCmsSaveProgress(false, 0, '');
    }
  }

  function adminLocalHasCustomSimulatorContent() {
    if (!window.PlatformSimulators) return false;
    var meta = window.PlatformSimulators.getSimulatorMeta() || {};
    var hasCustomIcons = Object.keys(meta).some(function (id) {
      var m = meta[id];
      return m && (m.iconType === 'image' || (m.icon && String(m.icon).indexOf('data:') === 0));
    });
    if (hasCustomIcons) return true;
    if (!window.PlatformSimulatorShowcase) return false;
    var showcase = window.PlatformSimulatorShowcase.getShowcaseMeta() || {};
    return Object.keys(showcase).some(function (key) {
      if (key.charAt(0) === '_') return false;
      var entry = showcase[key];
      return !!(entry && (entry.showcaseImage || entry.title || entry.description));
    });
  }

  function runSimulatorsLocalToFirestoreMigration(silent) {
    var Firestore = getSimulatorsFirestoreApi();
    if (!Firestore || typeof Firestore.migrateLocalCacheToFirestore !== 'function') return;
    if (window.__ifaSimulatorsMigrationAttempted) return;
    if (!adminLocalHasCustomSimulatorContent()) return;
    window.__ifaSimulatorsMigrationAttempted = true;

    Firestore.migrateLocalCacheToFirestore({ silent: !!silent, force: true })
      .then(function (result) {
        if (!result || !result.ok) {
          if (result && result.reason === 'write-failed' && result.message) {
            toast(result.message, true);
          }
          return;
        }
        if (result.migratedRichContent) {
          toast('تم نقل أيقونات المحاكيات من المتصفح إلى Firestore بنجاح');
          renderSimulatorShowcaseManager();
        }
      })
      .catch(function (err) {
        console.error('[CMS simulators] auto-migration failed', err);
        toast(formatSimulatorsPublishError(err), true);
      });
  }

  function bindSimulatorShowcaseManager() {
    var host = $('cmsSimulatorShowcaseList');
    var intervalForm = $('cmsShowcaseSettingsForm');
    var intervalInput = $('cmsShowcaseInterval');
    if (!host) return;

    if (window.PlatformSimulatorShowcase && intervalInput) {
      intervalInput.value = String(window.PlatformSimulatorShowcase.getIntervalSeconds());
    }

    if (intervalForm && window.PlatformSimulatorShowcase) {
      intervalForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        var Firestore;
        try {
          Firestore = await waitForSimulatorsFirestoreApi(12000);
        } catch (err) {
          toast(formatSimulatorsFirestoreLoadError(err), true);
          return;
        }
        if (!Firestore || typeof Firestore.saveShowcaseMetaToFirestore !== 'function') {
          toast('تعذّر الاتصال بـ Firestore للمحاكيات', true);
          return;
        }
        try {
          var saved = await runWithCmsPublishProgress('جاري نشر سرعة العرض...', async function (setPct) {
            setPct(30);
            var result = await Firestore.saveShowcaseMetaToFirestore({}, intervalInput && intervalInput.value);
            setPct(90);
            return result;
          });
          var sec =
            saved && saved._intervalSeconds != null
              ? saved._intervalSeconds
              : window.PlatformSimulatorShowcase.getIntervalSeconds();
          if (intervalInput) intervalInput.value = String(sec);
          var status = $('cmsShowcaseIntervalStatus');
          if (status) {
            status.textContent = 'تم النشر — دوران كل ' + sec + ' ثانية';
          }
          toast('تم حفظ ونشر المحاكيات بنجاح!');
        } catch (err) {
          console.error('[CMS simulators] interval publish failed', err);
          toast(formatSimulatorsPublishError(err), true);
        }
      });
    }

    renderSimulatorShowcaseManager();
    updateSimulatorsSaveButtonState();

    function onSimulatorsFirestoreReady() {
      updateSimulatorsSaveButtonState();

      var Firestore = getSimulatorsFirestoreApi();
      if (Firestore && typeof Firestore.subscribe === 'function' && !window.__ifaSimulatorsCmsSubscribed) {
        window.__ifaSimulatorsCmsSubscribed = true;
        Firestore.subscribe(function () {
          renderSimulatorShowcaseManager();
          var intervalInputEl = $('cmsShowcaseInterval');
          if (intervalInputEl && window.PlatformSimulatorShowcase) {
            intervalInputEl.value = String(window.PlatformSimulatorShowcase.getIntervalSeconds());
          }
        });
      }
    }

    window.addEventListener('ifa:simulators-firestore-ready', onSimulatorsFirestoreReady);
    document.addEventListener('ifa:simulators-firestore-ready', onSimulatorsFirestoreReady);

    window.addEventListener('ifa:simulators-firestore-load-error', function (e) {
      var status = $('cmsSimulatorsSaveAllStatus');
      var err = e && e.detail;
      var message = formatSimulatorsFirestoreLoadError(err);
      if (status) status.textContent = message;
      updateSimulatorsSaveButtonState();
    });

    (function waitForSimulatorsModuleReady(attempts) {
      if (isSimulatorsFirestoreModuleReady()) {
        onSimulatorsFirestoreReady();
        return;
      }
      updateSimulatorsSaveButtonState();
      if (attempts > 240) {
        var status = $('cmsSimulatorsSaveAllStatus');
        if (status) {
          status.textContent = 'تعذّر تحميل Firestore للمحاكيات — أعد تحميل الصفحة';
        }
        return;
      }
      window.setTimeout(function () {
        waitForSimulatorsModuleReady(attempts + 1);
      }, 50);
    })(0);

    var saveAllBtn = $('cmsSimulatorsSaveAll');
    if (saveAllBtn && !saveAllBtn.dataset.bound) {
      saveAllBtn.dataset.bound = '1';
      saveAllBtn.addEventListener('click', function () {
        if (saveAllBtn.disabled) return;
        saveAllSimulatorShowcaseCards();
      });
    }

    host.addEventListener('click', function (e) {
      var clearBtn = e.target.closest ? e.target.closest('[data-showcase-image-clear]') : null;
      if (clearBtn) {
        var clearCard = clearBtn.closest('[data-showcase-editor]');
        if (!clearCard) return;
        clearPendingSimulatorMedia(getShowcaseCardSimId(clearCard));
        var hidden = clearCard.querySelector('[data-showcase-image]');
        if (hidden) hidden.value = '';
        var fileInput = clearCard.querySelector('[data-showcase-image-file]');
        if (fileInput) fileInput.value = '';
        var previewBox = clearCard.querySelector('.cms-showcase-card__preview');
        if (previewBox) {
          previewBox.innerHTML =
            '<div class="cms-showcase-card__preview-empty">معاينة افتراضية</div>';
        }
      }
    });

    host.addEventListener('change', function (e) {
      var fileInput = e.target.closest ? e.target.closest('[data-showcase-image-file]') : null;
      if (!fileInput || !fileInput.files || !fileInput.files[0]) return;
      var file = fileInput.files[0];
      if (file.size > MAX_SHOWCASE_IMAGE_BYTES) {
        toast('حجم صورة العرض كبير جداً', true);
        fileInput.value = '';
        return;
      }
      var simId = fileInput.getAttribute('data-showcase-image-file');
      var card = host.querySelector('[data-showcase-editor="' + simId + '"]');
      if (!card) return;
      pendingShowcaseImageFiles[simId] = file;
      applyCompressedShowcaseImage(card, simId, file);
      fileInput.value = '';
    });
  }

  /* ---------- Footer settings ---------- */
  var FOOTER_SOCIAL_LABELS = {
    youtube: 'YouTube',
    linkedin: 'LinkedIn',
    email: 'البريد الإلكتروني (Email)',
    phone: 'رقم الهاتف (Phone)',
    facebook: 'Facebook',
    instagram: 'Instagram',
    telegram: 'Telegram',
    whatsapp: 'WhatsApp',
  };

  function collectFooterDraftFromForm() {
    var social = {};
    if (window.PlatformFooter && window.PlatformFooter.SOCIAL_ORDER) {
      window.PlatformFooter.SOCIAL_ORDER.forEach(function (item) {
        var input = $('cmsFooterSocial_' + item.id);
        social[item.id] = input ? input.value : '';
      });
    }
    return {
      logoSubtitle: {
        text: $('cmsFooterLogoSubText') ? $('cmsFooterLogoSubText').value : '',
        fontSize: $('cmsFooterLogoSubSize') ? $('cmsFooterLogoSubSize').value : 0.85,
      },
      description: {
        text: $('cmsFooterDescText') ? $('cmsFooterDescText').value : '',
        fontSize: $('cmsFooterDescSize') ? $('cmsFooterDescSize').value : 0.9,
        color: $('cmsFooterDescColor') ? $('cmsFooterDescColor').value : '#94a3b8',
      },
      social: social,
    };
  }

  function syncFooterLivePreview() {
    if (!window.PlatformFooter) return;
    var incoming = collectFooterDraftFromForm();
    var base = window.PlatformFooter.getFooterSettings();
    var previewSettings = {
      logoSubtitle: Object.assign({}, base.logoSubtitle, incoming.logoSubtitle),
      description: Object.assign({}, base.description, incoming.description),
      social: Object.assign({}, base.social),
    };
    previewSettings.logoSubtitle.fontSize =
      parseFloat(incoming.logoSubtitle.fontSize) || base.logoSubtitle.fontSize;
    previewSettings.description.fontSize = parseFloat(incoming.description.fontSize) || base.description.fontSize;
    window.PlatformFooter.SOCIAL_ORDER.forEach(function (item) {
      previewSettings.social[item.id] = window.PlatformFooter.normalizeSocialUrl(
        item.id,
        incoming.social[item.id] || ''
      );
    });

    var logoSubPreview = $('cmsFooterLogoSubPreview');
    if (logoSubPreview) {
      logoSubPreview.textContent =
        String(previewSettings.logoSubtitle.text || '').trim() ||
        window.PlatformFooter.DEFAULT_LOGO_SUBTITLE;
      logoSubPreview.style.setProperty(
        'font-size',
        String(previewSettings.logoSubtitle.fontSize || 0.85) + 'rem',
        'important'
      );
    }
    var descPreview = $('cmsFooterDescPreview');
    if (descPreview) {
      descPreview.textContent =
        String(previewSettings.description.text || '').trim() || window.PlatformFooter.DEFAULT_DESCRIPTION;
      descPreview.style.fontSize = String(previewSettings.description.fontSize || 0.9) + 'rem';
      descPreview.style.color = previewSettings.description.color || '#94a3b8';
    }
    var socialPreview = $('cmsFooterSocialPreview');
    if (socialPreview && typeof window.PlatformFooter.buildSocialHtml === 'function') {
      socialPreview.innerHTML = window.PlatformFooter.buildSocialHtml(previewSettings);
    }
  }

  function renderFooterSocialFields(settings) {
    var host = $('cmsFooterSocialFields');
    if (!host || !window.PlatformFooter) return;
    var social = (settings && settings.social) || {};
    host.innerHTML = window.PlatformFooter.SOCIAL_ORDER.map(function (item) {
      return (
        '<label class="admin-field cms-footer-social-field">' +
        '<span class="admin-field__label">' +
        escapeHtml(FOOTER_SOCIAL_LABELS[item.id] || item.label) +
        '</span>' +
        '<input class="admin-field__input" id="cmsFooterSocial_' +
        escapeHtml(item.id) +
        '" type="text" dir="ltr" placeholder="https://..." value="' +
        escapeHtml(social[item.id] || '') +
        '" />' +
        '</label>'
      );
    }).join('');
  }

  function loadFooterEditorForm() {
    if (!window.PlatformFooter) return;
    var settings = window.PlatformFooter.getFooterSettings();
    if ($('cmsFooterLogoSubText')) {
      $('cmsFooterLogoSubText').value = settings.logoSubtitle ? settings.logoSubtitle.text : '';
    }
    if ($('cmsFooterLogoSubSize')) {
      $('cmsFooterLogoSubSize').value = String(
        settings.logoSubtitle ? settings.logoSubtitle.fontSize : 0.85
      );
    }
    if ($('cmsFooterDescText')) $('cmsFooterDescText').value = settings.description.text;
    if ($('cmsFooterDescSize')) $('cmsFooterDescSize').value = String(settings.description.fontSize);
    if ($('cmsFooterDescColor')) $('cmsFooterDescColor').value = settings.description.color;
    renderFooterSocialFields(settings);
    syncFooterLivePreview();
  }

  async function saveFooterFromForm() {
    if (!window.PlatformFooter) return;
    var draft = collectFooterDraftFromForm();
    var status = $('cmsFooterSaveStatus');
    try {
      if (window.PlatformFooterFirestore && typeof window.PlatformFooterFirestore.saveSettings === 'function') {
        await window.PlatformFooterFirestore.saveSettings(draft);
      } else {
        await window.PlatformFooter.saveFooterSettings(draft);
      }
      loadFooterEditorForm();
      if (status) status.textContent = 'تم حفظ إعدادات التذييل في Firestore';
      toast('تم حفظ إعدادات التذييل');
      reloadSitePreview();
    } catch (err) {
      if (status) status.textContent = (err && err.message) || 'تعذّر الحفظ';
      toast((err && err.message) || 'تعذّر حفظ إعدادات التذييل', true);
    }
  }

  function bindFooterEditor() {
    var form = $('cmsFooterForm');
    if (!form || !window.PlatformFooter) return;

    loadFooterEditorForm();
    document.addEventListener('ifa:platform-footer-changed', loadFooterEditorForm);
    window.addEventListener('ifa:platform-footer-changed', loadFooterEditorForm);

    (function waitForFirestoreFooter(attempts) {
      if (window.PlatformFooterFirestore && typeof window.PlatformFooterFirestore.subscribe === 'function') {
        window.PlatformFooterFirestore.subscribe(function () {
          loadFooterEditorForm();
        });
        return;
      }
      if (attempts > 40) return;
      window.setTimeout(function () {
        waitForFirestoreFooter(attempts + 1);
      }, 50);
    })(0);

    if (!form.dataset.bound) {
      form.dataset.bound = '1';

      form.addEventListener('input', function (e) {
        if (
          e.target.id === 'cmsFooterLogoSubText' ||
          e.target.id === 'cmsFooterLogoSubSize' ||
          e.target.id === 'cmsFooterDescText' ||
          e.target.id === 'cmsFooterDescSize' ||
          e.target.id === 'cmsFooterDescColor' ||
          (e.target.id && e.target.id.indexOf('cmsFooterSocial_') === 0)
        ) {
          syncFooterLivePreview();
        }
      });

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        saveFooterFromForm();
      });

      var resetBtn = $('cmsFooterReset');
      if (resetBtn) {
        resetBtn.addEventListener('click', async function () {
          if (!window.confirm('استعادة إعدادات التذييل الافتراضية؟')) return;
          var emptySocial = {};
          window.PlatformFooter.SOCIAL_ORDER.forEach(function (item) {
            emptySocial[item.id] = '';
          });
          try {
            var defaults = {
              logoSubtitle: {
                text: window.PlatformFooter.DEFAULT_LOGO_SUBTITLE,
                fontSize: 0.85,
              },
              description: {
                text: window.PlatformFooter.DEFAULT_DESCRIPTION,
                fontSize: 0.9,
                color: '#94a3b8',
              },
              social: emptySocial,
            };
            if (window.PlatformFooterFirestore && typeof window.PlatformFooterFirestore.saveSettings === 'function') {
              await window.PlatformFooterFirestore.saveSettings(defaults);
            } else {
              await window.PlatformFooter.saveFooterSettings(defaults);
            }
            loadFooterEditorForm();
            toast('تمت استعادة الإعدادات الافتراضية');
            reloadSitePreview();
          } catch (err) {
            toast((err && err.message) || 'تعذّر استعادة الإعدادات', true);
          }
        });
      }
    }
  }

  /* ---------- Landing page statistics ---------- */
  function resolveLiveEnrolledStudentsCount(stats) {
    if (window.AdminUsers && typeof window.AdminUsers.getRegisteredUserCount === 'function') {
      return window.AdminUsers.getRegisteredUserCount();
    }
    if (
      window.PlatformUserMetrics &&
      typeof window.PlatformUserMetrics.getTotalUsers === 'function' &&
      window.PlatformUserMetrics.isReady &&
      window.PlatformUserMetrics.isReady()
    ) {
      return window.PlatformUserMetrics.getTotalUsers();
    }
    return stats && stats.enrolledStudents != null ? stats.enrolledStudents : 0;
  }

  function renderStatsEditor() {
    if (!window.PlatformStats) return;
    var stats = window.PlatformStats.getStats();
    var enrolled = $('cmsStatEnrolledStudents');
    var km = $('cmsStatSimulatedKm');
    var projects = $('cmsStatTrainingProjects');
    var satisfaction = $('cmsStatSatisfaction');
    if (enrolled) enrolled.value = String(resolveLiveEnrolledStudentsCount(stats));
    if (km) km.value = String(stats.simulatedKilometers);
    if (projects) projects.value = String(stats.trainingProjects);
    if (satisfaction) satisfaction.value = String(stats.satisfactionRate);
    renderStatsPreview(stats);
  }

  function renderStatsPreview(stats) {
    var host = $('cmsStatsPreview');
    if (!host || !window.PlatformStats) return;
    var s = stats || window.PlatformStats.getStats();
    var fmt = window.PlatformStats.formatStatNumber;
    var enrolledCount = resolveLiveEnrolledStudentsCount(s);
    host.innerHTML =
      '<div class="cms-stats-preview__item"><span class="cms-stats-preview__value">' +
      escapeHtml(fmt(enrolledCount)) +
      '</span><span class="cms-stats-preview__label">طالب مسجّل</span></div>' +
      '<div class="cms-stats-preview__item"><span class="cms-stats-preview__value">' +
      escapeHtml(fmt(s.simulatedKilometers)) +
      '</span><span class="cms-stats-preview__label">كيلومتر محاكى</span></div>' +
      '<div class="cms-stats-preview__item"><span class="cms-stats-preview__value">' +
      escapeHtml(fmt(s.trainingProjects)) +
      '</span><span class="cms-stats-preview__label">مشروع تدريبي</span></div>' +
      '<div class="cms-stats-preview__item"><span class="cms-stats-preview__value">' +
      escapeHtml(fmt(s.satisfactionRate)) +
      '%</span><span class="cms-stats-preview__label">رضا الطلاب</span></div>';
  }

  async function saveStatsFromForm() {
    if (!window.PlatformStats) return;
    var status = $('cmsStatsSaveStatus');
    var payload = {
      simulatedKilometers: $('cmsStatSimulatedKm') && $('cmsStatSimulatedKm').value,
      trainingProjects: $('cmsStatTrainingProjects') && $('cmsStatTrainingProjects').value,
      satisfactionRate: $('cmsStatSatisfaction') && $('cmsStatSatisfaction').value,
    };
    try {
      var saved = await window.PlatformStats.saveStats(payload);
      renderStatsPreview(saved);
      if (status) {
        status.textContent =
          'تم الحفظ في Firestore — طلاب (تلقائي): ' +
          window.PlatformStats.formatStatNumber(resolveLiveEnrolledStudentsCount(saved)) +
          ' · كم: ' +
          window.PlatformStats.formatStatNumber(saved.simulatedKilometers);
      }
      toast('تم حفظ إحصائيات الموقع');
      reloadSitePreview();
    } catch (err) {
      if (status) status.textContent = (err && err.message) || 'تعذّر الحفظ';
      toast((err && err.message) || 'تعذّر حفظ الإحصائيات', true);
    }
  }

  async function resetStatsToDefaults() {
    if (!window.PlatformStats) return;
    if (!window.confirm('استعادة الإحصائيات الافتراضية؟')) return;
    var defaults = window.PlatformStats.DEFAULTS;
    try {
      await window.PlatformStats.saveStats(defaults);
      renderStatsEditor();
      toast('تمت استعادة الإحصائيات الافتراضية');
      reloadSitePreview();
    } catch (err) {
      toast((err && err.message) || 'تعذّر استعادة الإحصائيات', true);
    }
  }

  function bindStatsEditor() {
    var form = $('cmsStatsForm');
    if (!form || !window.PlatformStats) return;
    renderStatsEditor();
    document.addEventListener('ifa:platform-stats-changed', renderStatsEditor);
    window.addEventListener('ifa:platform-stats-changed', renderStatsEditor);
    document.addEventListener('ifa:admin-users-changed', renderStatsEditor);
    window.addEventListener('ifa:admin-users-changed', renderStatsEditor);
    document.addEventListener('ifa:platform-user-metrics-changed', renderStatsEditor);
    window.addEventListener('ifa:platform-user-metrics-changed', renderStatsEditor);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      saveStatsFromForm();
    });
    var resetBtn = $('cmsStatsReset');
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        resetStatsToDefaults();
      });
    }
    ['cmsStatSimulatedKm', 'cmsStatTrainingProjects', 'cmsStatSatisfaction'].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.addEventListener('input', function () {
        renderStatsPreview(
          window.PlatformStats.normalizeStats({
            simulatedKilometers: $('cmsStatSimulatedKm') && $('cmsStatSimulatedKm').value,
            trainingProjects: $('cmsStatTrainingProjects') && $('cmsStatTrainingProjects').value,
            satisfactionRate: $('cmsStatSatisfaction') && $('cmsStatSatisfaction').value,
          })
        );
      });
    });
  }

  /* ---------- Hero content slider ---------- */
  var heroSlidesDraft = [];

  function loadHeroSlidesDraft() {
    if (!window.PlatformHeroSlideshow) {
      heroSlidesDraft = [];
      return;
    }
    var config = window.PlatformHeroSlideshow.getConfig();
    heroSlidesDraft = config.slides.length
      ? config.slides.slice()
      : window.PlatformHeroSlideshow.defaultSlides().slice();
  }

  function collectHeroSlideFromCard(card) {
    var id = card.getAttribute('data-hero-slide-id');
    var existing = null;
    heroSlidesDraft.forEach(function (s) {
      if (s.id === id) existing = s;
    });
    var imageInput = card.querySelector('[data-hero-field="image"]');
    var visualTypeSelect = card.querySelector('[data-hero-field="visualType"]');
    return window.PlatformHeroSlideshow.normalizeSlide({
      id: id,
      visualType: visualTypeSelect ? visualTypeSelect.value : 'image',
      image: imageInput ? imageInput.value : existing && existing.image,
      title: card.querySelector('[data-hero-field="title"]') && card.querySelector('[data-hero-field="title"]').value,
      description:
        card.querySelector('[data-hero-field="description"]') &&
        card.querySelector('[data-hero-field="description"]').value,
      buttonText:
        card.querySelector('[data-hero-field="buttonText"]') &&
        card.querySelector('[data-hero-field="buttonText"]').value,
      buttonHref:
        card.querySelector('[data-hero-field="buttonHref"]') &&
        card.querySelector('[data-hero-field="buttonHref"]').value,
      secondaryButtonText:
        card.querySelector('[data-hero-field="secondaryButtonText"]') &&
        card.querySelector('[data-hero-field="secondaryButtonText"]').value,
      secondaryButtonHref:
        card.querySelector('[data-hero-field="secondaryButtonHref"]') &&
        card.querySelector('[data-hero-field="secondaryButtonHref"]').value,
      textColor:
        card.querySelector('[data-hero-field="textColor"]') &&
        card.querySelector('[data-hero-field="textColor"]').value,
      bgTint:
        card.querySelector('[data-hero-field="bgTint"]') && card.querySelector('[data-hero-field="bgTint"]').value,
      badge: card.querySelector('[data-hero-field="badge"]') && card.querySelector('[data-hero-field="badge"]').value,
      showTrust: !!(card.querySelector('[data-hero-field="showTrust"]') && card.querySelector('[data-hero-field="showTrust"]').checked),
    });
  }

  function syncHeroSlidesDraftFromDom() {
    var list = $('cmsHeroSlidesList');
    if (!list) return;
    heroSlidesDraft = [];
    list.querySelectorAll('[data-hero-slide-id]').forEach(function (card) {
      heroSlidesDraft.push(collectHeroSlideFromCard(card));
    });
  }

  function renderHeroSlideshowEditor() {
    if (!window.PlatformHeroSlideshow) return;
    var config = window.PlatformHeroSlideshow.getConfig();
    var interval = $('cmsHeroInterval');
    if (interval) interval.value = String(config.intervalSeconds);
    if (!heroSlidesDraft.length) loadHeroSlidesDraft();
    renderHeroSlidesList();
  }

  function renderHeroSlideCard(slide, index, total) {
    var preview = slide.image
      ? '<img class="cms-hero-editor__preview" src="' + String(slide.image).replace(/"/g, '&quot;') + '" alt="" />'
      : '<div class="cms-hero-editor__preview cms-hero-editor__preview--empty">بدون صورة — مخطط الشبكة</div>';
    return (
      '<article class="cms-hero-editor-card" data-hero-slide-id="' +
      escapeHtml(slide.id) +
      '">' +
      '<header class="cms-hero-editor-card__head">' +
      '<strong>شريحة #' +
      (index + 1) +
      '</strong>' +
      '<div class="cms-hero-editor-card__order">' +
      '<button type="button" class="admin-btn admin-btn--ghost" data-hero-slide-up="' +
      escapeHtml(slide.id) +
      '" ' +
      (index === 0 ? 'disabled' : '') +
      '>↑</button>' +
      '<button type="button" class="admin-btn admin-btn--ghost" data-hero-slide-down="' +
      escapeHtml(slide.id) +
      '" ' +
      (index === total - 1 ? 'disabled' : '') +
      '>↓</button>' +
      '<button type="button" class="admin-btn admin-btn--danger" data-hero-slide-remove="' +
      escapeHtml(slide.id) +
      '">حذف</button>' +
      '</div></header>' +
      '<div class="cms-hero-editor-card__body">' +
      '<div class="cms-hero-editor-card__media">' +
      preview +
      '<label class="cms-file-btn">رفع صورة<input type="file" data-hero-slide-file="' +
      escapeHtml(slide.id) +
      '" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden /></label>' +
      '<input type="hidden" data-hero-field="image" value="" />' +
      '</div>' +
      '<div class="cms-hero-editor-card__fields">' +
      '<label class="admin-field"><span class="admin-field__label">نوع المرئي</span>' +
      '<select class="admin-field__input" data-hero-field="visualType">' +
      '<option value="image"' +
      (slide.visualType === 'image' ? ' selected' : '') +
      '>صورة مرفوعة</option>' +
      '<option value="network"' +
      (slide.visualType === 'network' ? ' selected' : '') +
      '>مخطط شبكة FTTH</option>' +
      '</select></label>' +
      '<label class="admin-field"><span class="admin-field__label">شارة علوية (Badge)</span>' +
      '<input class="admin-field__input" data-hero-field="badge" value="' +
      escapeHtml(slide.badge || '') +
      '" /></label>' +
      '<label class="admin-field"><span class="admin-field__label">العنوان (Title)</span>' +
      '<input class="admin-field__input" data-hero-field="title" value="' +
      escapeHtml(slide.title || '') +
      '" /></label>' +
      '<label class="admin-field"><span class="admin-field__label">الوصف (Description)</span>' +
      '<textarea class="admin-field__input admin-field__textarea" data-hero-field="description" rows="3">' +
      escapeHtml(slide.description || '') +
      '</textarea></label>' +
      '<div class="admin-form-grid">' +
      '<label class="admin-field"><span class="admin-field__label">نص الزر الرئيسي</span>' +
      '<input class="admin-field__input" data-hero-field="buttonText" value="' +
      escapeHtml(slide.buttonText || '') +
      '" /></label>' +
      '<label class="admin-field"><span class="admin-field__label">رابط الزر الرئيسي</span>' +
      '<input class="admin-field__input" data-hero-field="buttonHref" value="' +
      escapeHtml(slide.buttonHref || '') +
      '" /></label>' +
      '<label class="admin-field"><span class="admin-field__label">نص الزر الثانوي</span>' +
      '<input class="admin-field__input" data-hero-field="secondaryButtonText" value="' +
      escapeHtml(slide.secondaryButtonText || '') +
      '" /></label>' +
      '<label class="admin-field"><span class="admin-field__label">رابط الزر الثانوي</span>' +
      '<input class="admin-field__input" data-hero-field="secondaryButtonHref" value="' +
      escapeHtml(slide.secondaryButtonHref || '') +
      '" /></label>' +
      '</div>' +
      '<div class="admin-form-grid">' +
      '<label class="admin-field"><span class="admin-field__label">لون النص</span>' +
      '<input class="admin-field__input" type="color" data-hero-field="textColor" value="' +
      escapeHtml(slide.textColor || '#ffffff') +
      '" /></label>' +
      '<label class="admin-field"><span class="admin-field__label">لون الخلفية (Tint)</span>' +
      '<input class="admin-field__input" type="color" data-hero-field="bgTint" value="' +
      escapeHtml(slide.bgTint || '#0b1220') +
      '" /></label>' +
      '</div>' +
      '<label class="admin-field admin-field--inline">' +
      '<input type="checkbox" data-hero-field="showTrust" ' +
      (slide.showTrust ? 'checked' : '') +
      ' />' +
      '<span class="admin-field__label">إظهار نقاط الثقة (Trust badges)</span></label>' +
      '</div></div></article>'
    );
  }

  function renderHeroSlidesList() {
    var list = $('cmsHeroSlidesList');
    if (!list) return;
    if (!heroSlidesDraft.length) {
      list.innerHTML = '<p class="admin-empty-cell">لا توجد شرائح — أضف شريحة جديدة أو استعد الافتراضي.</p>';
      return;
    }
    list.innerHTML = heroSlidesDraft
      .map(function (slide, index) {
        return renderHeroSlideCard(slide, index, heroSlidesDraft.length);
      })
      .join('');
    list.querySelectorAll('[data-hero-slide-id]').forEach(function (card) {
      var id = card.getAttribute('data-hero-slide-id');
      var slide = null;
      heroSlidesDraft.forEach(function (s) {
        if (s.id === id) slide = s;
      });
      var imageInput = card.querySelector('[data-hero-field="image"]');
      if (imageInput && slide) imageInput.value = slide.image || '';
    });
  }

  function moveHeroSlide(id, dir) {
    syncHeroSlidesDraftFromDom();
    var idx = -1;
    heroSlidesDraft.forEach(function (s, i) {
      if (s.id === id) idx = i;
    });
    var next = idx + dir;
    if (idx < 0 || next < 0 || next >= heroSlidesDraft.length) return;
    var tmp = heroSlidesDraft[idx];
    heroSlidesDraft[idx] = heroSlidesDraft[next];
    heroSlidesDraft[next] = tmp;
    renderHeroSlidesList();
  }

  function saveHeroSlideshowFromForm() {
    if (!window.PlatformHeroSlideshow) return;
    syncHeroSlidesDraftFromDom();
    var saved = window.PlatformHeroSlideshow.saveConfig({
      intervalSeconds: $('cmsHeroInterval') && $('cmsHeroInterval').value,
      slides: heroSlidesDraft,
    });
    heroSlidesDraft = saved.slides.slice();
    renderHeroSlidesList();
    var status = $('cmsHeroSlideshowSaveStatus');
    if (status) {
      status.textContent = 'تم الحفظ — ' + saved.slides.length + ' شريحة · كل ' + saved.intervalSeconds + ' ثانية';
    }
    toast('تم حفظ الصفحة الرئيسية');
    reloadSitePreview();
  }

  function resetHeroSlideshow() {
    if (!window.confirm('استعادة الشرائح الافتراضية؟ سيتم استبدال جميع الشرائح الحالية.')) return;
    heroSlidesDraft = window.PlatformHeroSlideshow.defaultSlides().slice();
    renderHeroSlidesList();
    toast('تمت استعادة الشرائح الافتراضية — اضغط حفظ لتطبيقها');
  }

  function bindHeroSlideshowEditor() {
    var form = $('cmsHeroSlideshowForm');
    if (!form || !window.PlatformHeroSlideshow) return;
    renderHeroSlideshowEditor();
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      saveHeroSlideshowFromForm();
    });
    var resetBtn = $('cmsHeroSlideshowReset');
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        resetHeroSlideshow();
      });
    }
    var addBtn = $('cmsHeroAddSlide');
    if (addBtn) {
      addBtn.addEventListener('click', function () {
        syncHeroSlidesDraftFromDom();
        if (heroSlidesDraft.length >= window.PlatformHeroSlideshow.MAX_SLIDES) {
          toast('الحد الأقصى ' + window.PlatformHeroSlideshow.MAX_SLIDES + ' شرائح', true);
          return;
        }
        heroSlidesDraft.push(window.PlatformHeroSlideshow.blankSlide());
        renderHeroSlidesList();
      });
    }

    form.addEventListener('click', function (e) {
      var up = e.target.closest ? e.target.closest('[data-hero-slide-up]') : null;
      if (up) {
        moveHeroSlide(up.getAttribute('data-hero-slide-up'), -1);
        return;
      }
      var down = e.target.closest ? e.target.closest('[data-hero-slide-down]') : null;
      if (down) {
        moveHeroSlide(down.getAttribute('data-hero-slide-down'), 1);
        return;
      }
      var removeBtn = e.target.closest ? e.target.closest('[data-hero-slide-remove]') : null;
      if (removeBtn) {
        syncHeroSlidesDraftFromDom();
        var removeId = removeBtn.getAttribute('data-hero-slide-remove');
        heroSlidesDraft = heroSlidesDraft.filter(function (s) {
          return s.id !== removeId;
        });
        renderHeroSlidesList();
      }
    });

    form.addEventListener('change', function (e) {
      var fileInput = e.target.closest ? e.target.closest('[data-hero-slide-file]') : null;
      if (!fileInput || !fileInput.files || !fileInput.files[0]) return;
      var file = fileInput.files[0];
      if (file.size > window.PlatformHeroSlideshow.MAX_IMAGE_BYTES) {
        toast('حجم الصورة كبير جداً', true);
        fileInput.value = '';
        return;
      }
      var slideId = fileInput.getAttribute('data-hero-slide-file');
      readFileAsDataUrl(file, function (url) {
        var card = form.querySelector('[data-hero-slide-id="' + slideId + '"]');
        if (!card) return;
        var hidden = card.querySelector('[data-hero-field="image"]');
        var visual = card.querySelector('[data-hero-field="visualType"]');
        if (hidden) hidden.value = url;
        if (visual) visual.value = 'image';
        heroSlidesDraft.forEach(function (s) {
          if (s.id === slideId) {
            s.image = url;
            s.visualType = 'image';
          }
        });
        renderHeroSlidesList();
        fileInput.value = '';
      });
    });
  }

  /* ---------- Rich editor / image engine ---------- */
  function clearImageSelection() {
    if (selectedEditorImage) {
      selectedEditorImage.classList.remove('cms-img-selected', 'is-selected');
      selectedEditorImage = null;
    }
    var handles = $('articleImgHandles');
    var menu = $('articleImgContextMenu');
    var trigger = $('articleImgLayoutTrigger');
    if (handles) handles.hidden = true;
    if (menu) menu.hidden = true;
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
  }

  function hideImageLayoutMenu() {
    var menu = $('articleImgContextMenu');
    var trigger = $('articleImgLayoutTrigger');
    if (menu) menu.hidden = true;
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
  }

  function positionImageLayoutMenu() {
    var menu = $('articleImgContextMenu');
    var wrap = $('articleEditorBodyWrap');
    var handles = $('articleImgHandles');
    if (!menu || !wrap || !handles || menu.hidden || handles.hidden) return;
    var wrapRect = wrap.getBoundingClientRect();
    var handleRect = handles.getBoundingClientRect();
    var left = handleRect.right - wrapRect.left + wrap.scrollLeft - 8;
    var top = handleRect.top - wrapRect.top + wrap.scrollTop + 34;
    var maxLeft = wrap.clientWidth - menu.offsetWidth - 8;
    if (left > maxLeft) left = Math.max(8, maxLeft);
    if (left < 8) left = 8;
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
  }

  function syncImageLayoutMenuActive() {
    var menu = $('articleImgContextMenu');
    if (!menu || !selectedEditorImage) return;
    var layout = selectedEditorImage.getAttribute('data-cms-layout') || '';
    var position = selectedEditorImage.getAttribute('data-cms-position') || 'flow';
    menu.querySelectorAll('[data-img-layout]').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-img-layout') === layout);
    });
    menu.querySelectorAll('[data-img-position]').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-img-position') === position);
    });
  }

  function showImageLayoutMenu() {
    var menu = $('articleImgContextMenu');
    var trigger = $('articleImgLayoutTrigger');
    if (!menu || !selectedEditorImage) return;
    menu.hidden = false;
    if (trigger) trigger.setAttribute('aria-expanded', 'true');
    syncImageLayoutMenuActive();
    positionImageLayoutMenu();
  }

  function toggleImageLayoutMenu() {
    var menu = $('articleImgContextMenu');
    if (!menu) return;
    if (menu.hidden) showImageLayoutMenu();
    else hideImageLayoutMenu();
  }

  function resetImageStyles(img) {
    var props = [
      'display',
      'verticalAlign',
      'float',
      'margin',
      'shapeOutside',
      'clear',
      'zIndex',
      'opacity',
      'position',
      'top',
      'left',
      'right',
      'pointerEvents',
      'cursor',
      'userSelect',
    ];
    props.forEach(function (p) {
      img.style[p] = '';
    });
  }

  function applyImageLayout(img, layoutKey) {
    if (!img) return;
    resetImageStyles(img);
    img.classList.remove('img-behind-text', 'img-front-text', 'is-selected');
    var layout = IMAGE_LAYOUTS[layoutKey];
    if (!layout) return;
    Object.keys(layout).forEach(function (key) {
      if (layout[key] !== '') img.style[key] = layout[key];
    });
    img.setAttribute('data-cms-layout', layoutKey);
    if (layoutKey === 'behind') {
      img.classList.add('img-behind-text');
      img.style.userSelect = 'none';
      if (!img.style.left) img.style.left = '12px';
      if (!img.style.top) img.style.top = '12px';
      ensureArticleTextLayer(img.parentElement);
    }
    if (layoutKey === 'front') img.classList.add('img-front-text');
    var pos = img.getAttribute('data-cms-position');
    if (pos === 'fixed') applyImagePosition(img, 'fixed');
  }

  function ensureArticleTextLayer(editor) {
    if (!editor) return;
    var kids = [].slice.call(editor.childNodes);
    var hasLooseText = false;
    kids.forEach(function (n) {
      if (n.nodeType === 1 && (n.tagName === 'IMG' || n.classList.contains('article-text-layer'))) return;
      hasLooseText = true;
    });
    if (!hasLooseText) return;
    var layer = editor.querySelector(':scope > .article-text-layer');
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'article-text-layer';
      editor.appendChild(layer);
    }
    kids.forEach(function (n) {
      if (n.nodeType === 1 && n.tagName === 'IMG') return;
      if (n === layer) return;
      layer.appendChild(n);
    });
  }

  function applyImagePosition(img, mode) {
    if (!img) return;
    img.setAttribute('data-cms-position', mode);
    if (mode === 'fixed') {
      if (img.getAttribute('data-cms-layout') !== 'behind' && img.getAttribute('data-cms-layout') !== 'front') {
        img.style.position = 'sticky';
      }
      img.style.top = '20px';
    } else {
      var layout = img.getAttribute('data-cms-layout');
      if (layout === 'behind' || layout === 'front') return;
      img.style.position = 'relative';
      img.style.top = '';
    }
  }

  function positionImageHandles() {
    var wrap = $('articleEditorBodyWrap');
    var handles = $('articleImgHandles');
    if (!wrap || !handles || !selectedEditorImage || handles.hidden) return;
    var wrapRect = wrap.getBoundingClientRect();
    var imgRect = selectedEditorImage.getBoundingClientRect();
    handles.style.left = imgRect.left - wrapRect.left + wrap.scrollLeft + 'px';
    handles.style.top = imgRect.top - wrapRect.top + wrap.scrollTop + 'px';
    handles.style.width = imgRect.width + 'px';
    handles.style.height = imgRect.height + 'px';
    positionImageLayoutMenu();
  }

  function selectEditorImage(img) {
    if (!img || img.tagName !== 'IMG') return;
    clearImageSelection();
    selectedEditorImage = img;
    img.classList.add('cms-img-selected', 'is-selected');
    var handles = $('articleImgHandles');
    if (handles) {
      handles.hidden = false;
      positionImageHandles();
    }
    hideImageLayoutMenu();
  }

  function showImageContextMenu() {
    /* Kept for compatibility — layout menu opens only via floating trigger. */
    showImageLayoutMenu();
  }

  function insertImageIntoBody(src) {
    var body = $('articleEditorBody');
    if (!body || !src) return;
    var img = document.createElement('img');
    img.src = src;
    img.alt = '';
    img.style.maxWidth = '100%';
    img.style.height = 'auto';
    img.setAttribute('data-cms-layout', 'inline');
    img.setAttribute('data-cms-position', 'flow');
    applyImageLayout(img, 'inline');
    body.appendChild(img);
    body.appendChild(document.createElement('p'));
    selectEditorImage(img);
  }

  function execAlign(align) {
    var body = $('articleEditorBody');
    if (!body) return;
    body.focus();
    var cmdMap = { right: 'justifyRight', center: 'justifyCenter', left: 'justifyLeft', justify: 'justifyFull' };
    var cmd = cmdMap[align];
    try {
      if (cmd) document.execCommand(cmd, false, null);
    } catch (err) {
      var sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;
      var node = sel.anchorNode;
      var block = node && node.nodeType === 3 ? node.parentElement : node;
      while (block && block !== body && !/^(P|DIV|H[1-6]|LI|BLOCKQUOTE)$/i.test(block.tagName)) {
        block = block.parentElement;
      }
      if (block && block !== body) block.style.textAlign = align;
    }
  }

  function execDir(dir) {
    var body = $('articleEditorBody');
    if (!body) return;
    body.setAttribute('dir', dir);
    body.focus();
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    var node = sel.anchorNode;
    var block = node && node.nodeType === 3 ? node.parentElement : node;
    while (block && block !== body && !/^(P|DIV|H[1-6]|LI|BLOCKQUOTE)$/i.test(block.tagName)) {
      block = block.parentElement;
    }
    if (block && block !== body) block.setAttribute('dir', dir);
  }

  function onResizePointerDown(e) {
    var handle = e.target.closest ? e.target.closest('.cms-img-handle') : null;
    if (!handle || !selectedEditorImage) return;
    e.preventDefault();
    e.stopPropagation();
    var dir = handle.getAttribute('data-handle');
    resizeState = {
      handle: dir,
      startX: e.clientX,
      startY: e.clientY,
      startW: selectedEditorImage.offsetWidth,
      startH: selectedEditorImage.offsetHeight,
    };
    document.addEventListener('pointermove', onResizePointerMove);
    document.addEventListener('pointerup', onResizePointerUp);
  }

  function onResizePointerMove(e) {
    if (!resizeState || !selectedEditorImage) return;
    var dx = e.clientX - resizeState.startX;
    var dy = e.clientY - resizeState.startY;
    var w = resizeState.startW;
    var h = resizeState.startH;
    var handle = resizeState.handle;
    if (handle.indexOf('e') !== -1) w = Math.max(40, resizeState.startW + dx);
    if (handle.indexOf('w') !== -1) w = Math.max(40, resizeState.startW - dx);
    if (handle.indexOf('s') !== -1) h = Math.max(30, resizeState.startH + dy);
    if (handle.indexOf('n') !== -1) h = Math.max(30, resizeState.startH - dy);
    if (handle.length === 2) {
      selectedEditorImage.style.width = w + 'px';
      selectedEditorImage.style.height = h + 'px';
    } else if (handle === 'e' || handle === 'w') {
      selectedEditorImage.style.width = w + 'px';
      selectedEditorImage.style.height = 'auto';
    } else {
      selectedEditorImage.style.height = h + 'px';
      selectedEditorImage.style.width = 'auto';
    }
    positionImageHandles();
  }

  function onResizePointerUp() {
    resizeState = null;
    document.removeEventListener('pointermove', onResizePointerMove);
    document.removeEventListener('pointerup', onResizePointerUp);
  }

  function isBehindImage(img) {
    return !!(
      img &&
      (img.classList.contains('img-behind-text') || img.getAttribute('data-cms-layout') === 'behind')
    );
  }

  function findBehindImageAtPoint(body, clientX, clientY) {
    if (!body || !document.elementsFromPoint) return null;
    var stack = document.elementsFromPoint(clientX, clientY);
    var i;
    for (i = 0; i < stack.length; i++) {
      var el = stack[i];
      if (el && el.tagName === 'IMG' && body.contains(el) && isBehindImage(el)) return el;
    }
    return null;
  }

  function onBehindDragMove(e) {
    if (!dragState || !dragState.img) return;
    e.preventDefault();
    dragState.moved = true;
    var body = dragState.body;
    var rect = body.getBoundingClientRect();
    var left = e.clientX - rect.left + body.scrollLeft - dragState.offsetX;
    var top = e.clientY - rect.top + body.scrollTop - dragState.offsetY;
    var maxLeft = Math.max(0, body.clientWidth - dragState.img.offsetWidth);
    var maxTop = Math.max(0, body.scrollHeight - dragState.img.offsetHeight);
    if (left < 0) left = 0;
    if (top < 0) top = 0;
    if (left > maxLeft) left = maxLeft;
    if (top > maxTop) top = maxTop;
    dragState.img.style.left = left + 'px';
    dragState.img.style.top = top + 'px';
    dragState.img.style.right = 'auto';
    positionImageHandles();
  }

  function onBehindDragEnd() {
    if (dragState && dragState.img) {
      dragState.img.style.zIndex = '1';
      dragState.img.classList.add('is-selected', 'cms-img-selected');
    }
    dragState = null;
    document.removeEventListener('mousemove', onBehindDragMove);
    document.removeEventListener('mouseup', onBehindDragEnd);
  }

  function startBehindDrag(e, img, body) {
    if (!isBehindImage(img)) return false;
    if (e.button != null && e.button !== 0) return false;
    e.preventDefault();
    e.stopPropagation();
    selectEditorImage(img);
    var imgRect = img.getBoundingClientRect();
    dragState = {
      img: img,
      body: body,
      offsetX: e.clientX - imgRect.left,
      offsetY: e.clientY - imgRect.top,
      moved: false,
    };
    img.style.position = 'absolute';
    img.style.zIndex = '5';
    img.classList.add('is-selected', 'cms-img-selected');
    document.addEventListener('mousemove', onBehindDragMove);
    document.addEventListener('mouseup', onBehindDragEnd);
    return true;
  }

  function initRichEditor() {
    var body = $('articleEditorBody');
    var wrap = $('articleEditorBodyWrap');
    var handles = $('articleImgHandles');
    var menu = $('articleImgContextMenu');
    if (!body || !wrap) return;

    body.addEventListener('mousedown', function (e) {
      if (e.target.closest && e.target.closest('.cms-img-handle')) return;
      var img = e.target.closest ? e.target.closest('img') : null;
      if (!img || !body.contains(img) || !isBehindImage(img)) {
        img = findBehindImageAtPoint(body, e.clientX, e.clientY);
      }
      if (img) startBehindDrag(e, img, body);
    });

    body.addEventListener('mouseleave', function () {
      if (dragState) onBehindDragEnd();
    });

    body.addEventListener('click', function (e) {
      if (dragState) return;
      if (e.target.closest && e.target.closest('#articleImgLayoutTrigger')) return;
      if (e.target.closest && e.target.closest('#articleImgContextMenu')) return;
      var img = e.target.closest ? e.target.closest('img') : null;
      if (!img) img = findBehindImageAtPoint(body, e.clientX, e.clientY);
      if (img && body.contains(img)) {
        e.preventDefault();
        selectEditorImage(img);
        return;
      }
      clearImageSelection();
    });

    body.addEventListener('scroll', positionImageHandles);
    wrap.addEventListener('scroll', positionImageHandles);

    if (handles) {
      handles.addEventListener('pointerdown', onResizePointerDown);
    }

    var layoutTrigger = $('articleImgLayoutTrigger');
    if (layoutTrigger) {
      layoutTrigger.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (!selectedEditorImage) return;
        toggleImageLayoutMenu();
      });
      layoutTrigger.addEventListener('mousedown', function (e) {
        e.preventDefault();
        e.stopPropagation();
      });
    }

    if (menu) {
      menu.addEventListener('click', function (e) {
        var layoutBtn = e.target.closest ? e.target.closest('[data-img-layout]') : null;
        if (layoutBtn && selectedEditorImage) {
          applyImageLayout(selectedEditorImage, layoutBtn.getAttribute('data-img-layout'));
          selectedEditorImage.classList.add('cms-img-selected', 'is-selected');
          positionImageHandles();
          hideImageLayoutMenu();
          return;
        }
        var posBtn = e.target.closest ? e.target.closest('[data-img-position]') : null;
        if (posBtn && selectedEditorImage) {
          applyImagePosition(selectedEditorImage, posBtn.getAttribute('data-img-position'));
          positionImageHandles();
          hideImageLayoutMenu();
        }
      });
      menu.addEventListener('mousedown', function (e) {
        e.stopPropagation();
      });
    }

    document.addEventListener('click', function (e) {
      if (!wrap.contains(e.target)) {
        clearImageSelection();
        return;
      }
      if (
        selectedEditorImage &&
        !e.target.closest('#articleImgContextMenu') &&
        !e.target.closest('#articleImgLayoutTrigger') &&
        !e.target.closest('#articleImgHandles') &&
        !(e.target.closest && e.target.closest('img') === selectedEditorImage)
      ) {
        hideImageLayoutMenu();
      }
    });

    var insertBtn = $('articleEditorInsertImage');
    var bodyFile = $('articleEditorBodyImageFile');
    if (insertBtn && bodyFile) {
      insertBtn.addEventListener('click', function () {
        bodyFile.click();
      });
      bodyFile.addEventListener('change', function () {
        if (!bodyFile.files || !bodyFile.files[0]) return;
        readFileAsDataUrl(bodyFile.files[0], function (url) {
          insertImageIntoBody(url);
          bodyFile.value = '';
        });
      });
    }

    document.querySelectorAll('[data-cms-align]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        execAlign(btn.getAttribute('data-cms-align'));
      });
    });

    document.querySelectorAll('[data-cms-dir]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        execDir(btn.getAttribute('data-cms-dir'));
      });
    });

    var fullscreenBtn = document.querySelector('.ql-fullscreen');
    if (fullscreenBtn) {
      fullscreenBtn.addEventListener('click', function () {
        var modal = document.getElementById('articleEditorModal');
        var inner =
          document.getElementById('article-modal') ||
          document.querySelector('.ql-container') ||
          wrap;
        var container = modal || inner;
        if (!container) return;
        var on = !container.classList.contains('quill-fullscreen-mode');
        container.classList.toggle('quill-fullscreen-mode', on);
        if (inner && inner !== container) inner.classList.toggle('quill-fullscreen-mode', on);
        fullscreenBtn.classList.toggle('is-active', container.classList.contains('quill-fullscreen-mode'));
        fullscreenBtn.setAttribute(
          'title',
          container.classList.contains('quill-fullscreen-mode') ? 'خروج من ملء الشاشة' : 'ملء الشاشة'
        );
      });
    }
  }

  function sanitizeEditorHtml(html) {
    if (window.PlatformArticles && typeof window.PlatformArticles.sanitizeArticleHtml === 'function') {
      return window.PlatformArticles.sanitizeArticleHtml(html);
    }
    return html;
  }

  /* ---------- Articles ---------- */
  function usesFirestoreArticles() {
    return !!(
      window.PlatformArticlesFirestore &&
      typeof window.PlatformArticlesFirestore.isReady === 'function' &&
      window.PlatformArticlesFirestore.isReady()
    );
  }

  function articleCoverExtension(file) {
    var name = String((file && file.name) || 'cover.jpg');
    var ext = name.indexOf('.') > -1 ? name.split('.').pop() : 'jpg';
    ext = String(ext).replace(/[^a-z0-9]/gi, '').toLowerCase();
    return ext || 'jpg';
  }

  async function uploadArticleCoverFile(articleId, file) {
    var mod = await import('./cms-storage.js');
    var path =
      'cms/articles/' + String(articleId) + '/cover.' + articleCoverExtension(file);
    return mod.uploadCmsFile(path, file);
  }

  async function resolveArticleImageForSave(articleId) {
    var image = String(
      ($('articleEditorImageData') && $('articleEditorImageData').value) ||
        ($('articleEditorImageUrl') && $('articleEditorImageUrl').value) ||
        ''
    ).trim();
    if (pendingArticleCoverFile) {
      image = await uploadArticleCoverFile(articleId, pendingArticleCoverFile);
      pendingArticleCoverFile = null;
      if ($('articleEditorImageData')) $('articleEditorImageData').value = image;
      if ($('articleEditorImageUrl')) $('articleEditorImageUrl').value = image;
      var preview = $('articleEditorImagePreview');
      if (preview) {
        preview.src = image;
        preview.hidden = !image;
      }
      var fileInput = $('articleEditorImageFile');
      if (fileInput) fileInput.value = '';
      return image;
    }
    if (usesFirestoreArticles()) {
      var mod = await import('./cms-storage.js');
      if (image && mod.rejectDataUrl(image)) {
        throw new Error('صورة المقال يجب رفعها إلى التخزين — لا يُسمح بحفظ base64 في Firestore.');
      }
    }
    return image;
  }

  function isArticlesFirestoreModuleReady() {
    return !!(
      window.PlatformArticlesFirestore &&
      typeof window.PlatformArticlesFirestore.isReady === 'function' &&
      window.PlatformArticlesFirestore.isReady()
    );
  }

  function isArticlesAdminDataLoading() {
    var Firestore = window.PlatformArticlesFirestore;
    if (!Firestore) return true;
    if (typeof Firestore.isReady === 'function' && !Firestore.isReady()) return true;
    if (typeof Firestore.isSeeding === 'function' && Firestore.isSeeding()) return true;
    return false;
  }

  function renderArticlesTable() {
    var body = $('cmsArticlesBody');
    if (!body || !window.PlatformArticles) return;
    updateArticlesBinToolbar();
    var list = articlesBinView
      ? window.PlatformArticles.getTrashedArticles()
      : window.PlatformArticles.getArticles();
    if (!list.length) {
      var emptyMessage = articlesBinView ? 'سلة المهملات فارغة.' : 'لا توجد مقالات.';
      if (!articlesBinView && isArticlesAdminDataLoading()) {
        emptyMessage = 'جاري تحميل المقالات…';
      }
      body.innerHTML =
        '<tr><td colspan="5" class="admin-empty-cell">' + emptyMessage + '</td></tr>';
      return;
    }
    if (articlesBinView) {
      body.innerHTML = list
        .map(function (a) {
          return (
            '<tr><td>' +
            escapeHtml(a.title) +
            '</td><td>' +
            escapeHtml(a.category) +
            '</td><td>' +
            statusBadge(a.status) +
            '</td><td>' +
            escapeHtml(a.tags) +
            '</td><td class="admin-table__actions">' +
            '<button class="admin-btn admin-btn--ghost" type="button" data-article-restore="' +
            escapeHtml(a.id) +
            '">استعادة</button>' +
            '<button class="admin-btn admin-btn--danger" type="button" data-article-purge="' +
            escapeHtml(a.id) +
            '">حذف نهائي</button>' +
            '</td></tr>'
          );
        })
        .join('');
      return;
    }
    body.innerHTML = list
      .map(function (a) {
        return (
          '<tr><td>' +
          escapeHtml(a.title) +
          '</td><td>' +
          escapeHtml(a.category) +
          '</td><td>' +
          statusBadge(a.status) +
          '</td><td>' +
          escapeHtml(a.tags) +
          '</td><td class="admin-table__actions">' +
          '<button class="admin-btn admin-btn--ghost" type="button" data-article-toggle="' +
          escapeHtml(a.id) +
          '">' +
          (a.status === 'published' ? 'مسودة' : 'نشر') +
          '</button>' +
          '<button class="admin-btn admin-btn--ghost" type="button" data-article-edit="' +
          escapeHtml(a.id) +
          '">تعديل</button>' +
          '<button class="admin-btn admin-btn--danger" type="button" data-article-delete="' +
          escapeHtml(a.id) +
          '">حذف</button>' +
          '</td></tr>'
        );
      })
      .join('');
  }

  function openArticleModal(article) {
    editingArticleId = article && article.id ? article.id : null;
    pendingArticleCoverFile = null;
    var coverFileInput = $('articleEditorImageFile');
    if (coverFileInput) coverFileInput.value = '';
    clearImageSelection();
    $('articleEditorId').value = editingArticleId || '';
    $('articleEditorTitle').value = article ? article.title : '';
    $('articleEditorCategory').value = article ? article.category : '';
    $('articleEditorTags').value = article ? article.tags : '';
    $('articleEditorExcerpt').value = article ? article.excerpt : '';
    $('articleEditorMeta').value = article ? article.meta : '';
    $('articleEditorStatus').value = article ? article.status || 'draft' : 'draft';
    $('articleEditorImageUrl').value =
      article && article.image && article.image.indexOf('data:') !== 0 ? article.image : '';
    $('articleEditorImageData').value = article && article.image ? article.image : '';
    var preview = $('articleEditorImagePreview');
    if (preview) {
      preview.hidden = !article || !article.image;
      preview.src = article && article.image ? article.image : '';
    }
    var body = $('articleEditorBody');
    if (body) {
      body.innerHTML = article ? article.body || '' : '';
      body.style.fontFamily = article && article.fontFamily ? article.fontFamily : '';
      body.style.fontSize = article && article.fontSize ? article.fontSize : '';
      body.style.color = article && article.textColor ? article.textColor : '';
    }
    $('articleEditorFontFamily').value = article && article.fontFamily ? article.fontFamily : '';
    $('articleEditorFontSize').value = article && article.fontSize ? article.fontSize : '1rem';
    $('articleEditorTextColor').value = article && article.textColor ? article.textColor : '#e2e8f0';
    $('articleEditorTitleLabel').textContent = editingArticleId ? 'تعديل مقال' : 'مقال جديد';
    $('articleEditorModal').hidden = false;
  }

  function closeArticleModal() {
    var modal = $('articleEditorModal') || $('article-modal');
    if (modal) {
      modal.hidden = true;
      modal.classList.remove('quill-fullscreen-mode');
    }
    editingArticleId = null;
    pendingArticleCoverFile = null;
    var coverFileInput = $('articleEditorImageFile');
    if (coverFileInput) coverFileInput.value = '';
    clearImageSelection();
  }

  async function saveArticleFromForm() {
    if (!window.PlatformArticles) return;
    var body = $('articleEditorBody');
    clearImageSelection();
    var existingId = String($('articleEditorId').value || editingArticleId || '').trim();
    var articleId = existingId || window.PlatformArticles.uid();
    var rawBody = body ? body.innerHTML : '';
    var isDraft = String($('articleEditorStatus').value || '').trim() === 'draft';
    var isPublish = !isDraft;
    var Firestore = window.PlatformArticlesFirestore;

    try {
      await runWithCmsPublishProgress(isPublish ? 'جاري النشر...' : 'جاري الحفظ...', async function (setPct) {
        setPct(10);
        var image = await resolveArticleImageForSave(articleId);
        var payload = {
          title: $('articleEditorTitle').value,
          category: $('articleEditorCategory').value,
          tags: $('articleEditorTags').value,
          excerpt: $('articleEditorExcerpt').value,
          meta: $('articleEditorMeta').value,
          image: image,
          body: sanitizeEditorHtml(rawBody),
          fontFamily: $('articleEditorFontFamily').value,
          fontSize: $('articleEditorFontSize').value,
          textColor: $('articleEditorTextColor').value,
          status: $('articleEditorStatus').value,
        };
        setPct(45);

        if (usesFirestoreArticles() && Firestore) {
          var known =
            existingId && typeof Firestore.findArticle === 'function'
              ? Firestore.findArticle(existingId)
              : null;
          if (known) {
            await Firestore.updateArticle(existingId, payload);
          } else {
            await Firestore.addArticle(Object.assign({}, payload, { id: articleId }));
          }
        } else {
          window.PlatformArticles.upsertArticle(Object.assign({}, payload, { id: articleId }));
        }
        setPct(95);
        return { isPublish: isPublish };
      });
      closeArticleModal();
      renderArticlesTable();
      reloadSitePreview();
      if (isPublish) toast(PUBLISH_SUCCESS_TOAST);
      else toast('تم حفظ المقال');
    } catch (err) {
      toast((err && err.message) || 'تعذّر حفظ المقال', true);
    }
  }

  async function toggleArticleStatus(id) {
    if (!window.PlatformArticles || articleToggleInFlight) return;
    var key = String(id || '').trim();
    if (!key) return;

    var item = null;
    window.PlatformArticles.getArticles().forEach(function (a) {
      if (String(a.id) === key) item = a;
    });
    if (!item) {
      toast('تعذّر العثور على المقال', true);
      return;
    }

    var nextStatus = item.status === 'published' ? 'draft' : 'published';
    var Firestore = window.PlatformArticlesFirestore;

    articleToggleInFlight = true;
    try {
      await runWithCmsPublishProgress(
        nextStatus === 'published' ? 'جاري النشر...' : 'جاري تحديث الحالة...',
        async function (setPct) {
          setPct(30);
          if (usesFirestoreArticles() && Firestore && typeof Firestore.setArticleStatus === 'function') {
            await Firestore.setArticleStatus(key, nextStatus);
          } else if (usesFirestoreArticles() && Firestore) {
            await Firestore.updateArticle(key, { status: nextStatus });
          } else {
            var list = window.PlatformArticles.getAllArticles();
            list.forEach(function (a) {
              if (String(a.id) === key) a.status = nextStatus;
            });
            window.PlatformArticles.saveArticles(list);
          }
          setPct(95);
        }
      );
      renderArticlesTable();
      reloadSitePreview();
      toast(nextStatus === 'published' ? PUBLISH_SUCCESS_TOAST : 'تم تحويل المقال إلى مسودة');
    } catch (err) {
      toast((err && err.message) || 'تعذّر تحديث حالة المقال', true);
    } finally {
      articleToggleInFlight = false;
    }
  }

  async function deleteArticleById(id) {
    if (!window.PlatformArticles) return;
    var key = String(id || '').trim();
    if (!key) return;
    if (!window.confirm('نقل هذا المقال إلى سلة المهملات؟')) return;

    var Firestore = window.PlatformArticlesFirestore;

    try {
      if (usesFirestoreArticles() && Firestore) {
        await Firestore.deleteArticle(key);
      } else {
        window.PlatformArticles.deleteArticle(key);
      }
      renderArticlesTable();
      reloadSitePreview();
      toast('تم نقل المقال إلى سلة المهملات');
    } catch (err) {
      toast((err && err.message) || 'تعذّر نقل المقال إلى سلة المهملات', true);
    }
  }

  async function restoreArticleFromTrash(id) {
    if (!window.PlatformArticles) return;
    var key = String(id || '').trim();
    if (!key) return;
    var Firestore = window.PlatformArticlesFirestore;

    try {
      if (usesFirestoreArticles() && Firestore && typeof Firestore.restoreArticle === 'function') {
        await Firestore.restoreArticle(key);
      } else {
        var list = window.PlatformArticles.getAllArticles();
        list.forEach(function (a) {
          if (String(a.id) === key) a.status = 'draft';
        });
        window.PlatformArticles.saveArticles(list);
      }
      renderArticlesTable();
      reloadSitePreview();
      toast('تمت استعادة المقال كمسودة');
    } catch (err) {
      toast((err && err.message) || 'تعذّر استعادة المقال', true);
    }
  }

  async function purgeArticleById(id) {
    if (!window.PlatformArticles) return;
    var key = String(id || '').trim();
    if (!key) return;
    if (!window.confirm('حذف هذا المقال نهائياً؟ لا يمكن التراجع عن هذا الإجراء.')) return;
    var Firestore = window.PlatformArticlesFirestore;

    try {
      if (usesFirestoreArticles() && Firestore && typeof Firestore.purgeArticle === 'function') {
        await Firestore.purgeArticle(key);
      } else {
        window.PlatformArticles.saveArticles(
          window.PlatformArticles.getAllArticles().filter(function (a) {
            return String(a.id) !== key;
          })
        );
      }
      renderArticlesTable();
      reloadSitePreview();
      toast('تم الحذف النهائي للمقال');
    } catch (err) {
      toast((err && err.message) || 'تعذّر الحذف النهائي للمقال', true);
    }
  }

  /* ---------- FAQ ---------- */
  function usesFirestoreFaqs() {
    return !!(
      window.PlatformFaqsFirestore &&
      typeof window.PlatformFaqsFirestore.isReady === 'function' &&
      window.PlatformFaqsFirestore.isReady()
    );
  }

  function renderFaqTable() {
    var body = $('cmsFaqBody');
    if (!body || !window.PlatformFaqs) return;
    updateFaqBinToolbar();
    var list = faqBinView ? window.PlatformFaqs.getTrashedFaqs() : window.PlatformFaqs.getFaqs();
    if (!list.length) {
      body.innerHTML =
        '<tr><td colspan="4" class="admin-empty-cell">' +
        (faqBinView ? 'سلة المهملات فارغة.' : 'لا توجد أسئلة.') +
        '</td></tr>';
      return;
    }
    if (faqBinView) {
      body.innerHTML = list
        .map(function (f) {
          return (
            '<tr data-faq-row="' +
            escapeHtml(f.id) +
            '"><td>' +
            escapeHtml(f.question) +
            '</td><td>' +
            escapeHtml(f.answer).slice(0, 80) +
            (f.answer.length > 80 ? '…' : '') +
            '</td><td>' +
            statusBadge(f.status) +
            '</td><td class="admin-table__actions">' +
            '<button class="admin-btn admin-btn--ghost" type="button" data-faq-restore="' +
            escapeHtml(f.id) +
            '">استعادة</button>' +
            '<button class="admin-btn admin-btn--danger" type="button" data-faq-purge="' +
            escapeHtml(f.id) +
            '">حذف نهائي</button>' +
            '</td></tr>'
          );
        })
        .join('');
      return;
    }
    body.innerHTML = list
      .map(function (f, index) {
        return (
          '<tr data-faq-row="' +
          escapeHtml(f.id) +
          '"><td>' +
          escapeHtml(f.question) +
          '</td><td>' +
          escapeHtml(f.answer).slice(0, 80) +
          (f.answer.length > 80 ? '…' : '') +
          '</td><td>' +
          statusBadge(f.status) +
          '</td><td class="admin-table__actions">' +
          '<button class="admin-btn admin-btn--ghost" type="button" data-faq-toggle="' +
          escapeHtml(f.id) +
          '">' +
          (f.status === 'published' ? 'مسودة' : 'نشر') +
          '</button>' +
          '<button class="admin-btn admin-btn--ghost" type="button" data-faq-up="' +
          index +
          '" ' +
          (index === 0 ? 'disabled' : '') +
          '>↑</button>' +
          '<button class="admin-btn admin-btn--ghost" type="button" data-faq-down="' +
          index +
          '" ' +
          (index === list.length - 1 ? 'disabled' : '') +
          '>↓</button>' +
          '<button class="admin-btn admin-btn--ghost" type="button" data-faq-edit="' +
          escapeHtml(f.id) +
          '">تعديل</button>' +
          '<button class="admin-btn admin-btn--danger" type="button" data-faq-delete="' +
          escapeHtml(f.id) +
          '">حذف</button>' +
          '</td></tr>'
        );
      })
      .join('');
  }

  function openFaqModal(faq) {
    editingFaqId = faq && faq.id ? faq.id : null;
    $('faqEditorId').value = editingFaqId || '';
    $('faqEditorQuestion').value = faq ? faq.question : '';
    $('faqEditorAnswer').value = faq ? faq.answer : '';
    $('faqEditorStatus').value = faq ? faq.status || 'draft' : 'draft';
    $('faqEditorTitleLabel').textContent = editingFaqId ? 'تعديل سؤال' : 'سؤال جديد';
    $('faqEditorModal').hidden = false;
  }

  function closeFaqModal() {
    $('faqEditorModal').hidden = true;
    editingFaqId = null;
  }

  async function saveFaqFromForm() {
    if (!window.PlatformFaqs) return;
    var existingId = String($('faqEditorId').value || editingFaqId || '').trim();
    var payload = {
      question: $('faqEditorQuestion').value,
      answer: $('faqEditorAnswer').value,
      status: $('faqEditorStatus').value,
    };
    var Firestore = window.PlatformFaqsFirestore;
    var isDraft = String(payload.status || '').trim() === 'draft';
    var isPublish = !isDraft;

    try {
      await runWithCmsPublishProgress(isPublish ? 'جاري النشر...' : 'جاري الحفظ...', async function (setPct) {
        setPct(20);
        if (usesFirestoreFaqs() && Firestore) {
          var known =
            existingId && typeof Firestore.findFaq === 'function' ? Firestore.findFaq(existingId) : null;
          if (known) {
            await Firestore.updateFaq(existingId, payload);
          } else {
            await Firestore.addFaq(
              Object.assign({}, payload, {
                id: existingId || window.PlatformFaqs.uid(),
              })
            );
          }
        } else {
          var list = window.PlatformFaqs.getAllFaqs();
          var item = Object.assign({}, payload, {
            id: existingId || window.PlatformFaqs.uid(),
          });
          var idx = -1;
          list.forEach(function (f, i) {
            if (f.id === item.id) idx = i;
          });
          if (idx === -1) list.push(item);
          else list[idx] = item;
          window.PlatformFaqs.saveFaqs(list);
        }
        setPct(95);
      });
      closeFaqModal();
      renderFaqTable();
      reloadSitePreview();
      if (isPublish) toast(PUBLISH_SUCCESS_TOAST);
      else toast('تم حفظ السؤال');
    } catch (err) {
      toast((err && err.message) || 'تعذّر حفظ السؤال', true);
    }
  }

  async function toggleFaqStatus(id) {
    if (!window.PlatformFaqs || faqToggleInFlight) return;
    var key = String(id || '').trim();
    if (!key) return;

    var faq = null;
    window.PlatformFaqs.getFaqs().forEach(function (f) {
      if (String(f.id) === key) faq = f;
    });
    if (!faq) {
      toast('تعذّر العثور على السؤال', true);
      return;
    }

    var nextStatus = faq.status === 'published' ? 'draft' : 'published';
    var Firestore = window.PlatformFaqsFirestore;

    faqToggleInFlight = true;
    try {
      await runWithCmsPublishProgress(
        nextStatus === 'published' ? 'جاري النشر...' : 'جاري تحديث الحالة...',
        async function (setPct) {
          setPct(30);
          if (usesFirestoreFaqs() && Firestore && typeof Firestore.setFaqStatus === 'function') {
            await Firestore.setFaqStatus(key, nextStatus);
          } else if (usesFirestoreFaqs() && Firestore) {
            await Firestore.updateFaq(key, { status: nextStatus });
          } else {
            var list = window.PlatformFaqs.getAllFaqs();
            list.forEach(function (f) {
              if (String(f.id) === key) f.status = nextStatus;
            });
            window.PlatformFaqs.saveFaqs(list);
          }
          setPct(95);
        }
      );
      renderFaqTable();
      reloadSitePreview();
      toast(nextStatus === 'published' ? PUBLISH_SUCCESS_TOAST : 'تم تحويل السؤال إلى مسودة');
    } catch (err) {
      toast((err && err.message) || 'تعذّر تحديث حالة السؤال', true);
    } finally {
      faqToggleInFlight = false;
    }
  }

  async function moveFaq(index, dir) {
    if (!window.PlatformFaqs) return;
    var Firestore = window.PlatformFaqsFirestore;

    try {
      if (usesFirestoreFaqs() && Firestore && typeof Firestore.moveFaq === 'function') {
        await Firestore.moveFaq(index, dir);
        renderFaqTable();
        reloadSitePreview();
      } else {
        var active = window.PlatformFaqs.getFaqs().slice();
        var next = index + dir;
        if (next < 0 || next >= active.length) return;
        var tmp = active[index];
        active[index] = active[next];
        active[next] = tmp;
        var byId = {};
        active.forEach(function (f, i) {
          byId[f.id] = Object.assign({}, f, { sortOrder: i });
        });
        window.PlatformFaqs.saveFaqs(
          window.PlatformFaqs.getAllFaqs().map(function (f) {
            return byId[f.id] || f;
          })
        );
        renderFaqTable();
        reloadSitePreview();
      }
    } catch (err) {
      toast((err && err.message) || 'تعذّر تغيير الترتيب', true);
    }
  }

  async function deleteFaqById(id) {
    if (!window.PlatformFaqs) return;
    var key = String(id || '').trim();
    if (!key) return;
    if (!window.confirm('نقل هذا السؤال إلى سلة المهملات؟')) return;

    var Firestore = window.PlatformFaqsFirestore;

    try {
      if (usesFirestoreFaqs() && Firestore) {
        await Firestore.deleteFaq(key);
      } else {
        var list = window.PlatformFaqs.getAllFaqs();
        list.forEach(function (f) {
          if (String(f.id) === key) f.status = 'trash';
        });
        window.PlatformFaqs.saveFaqs(list);
      }
      renderFaqTable();
      reloadSitePreview();
      toast('تم نقل السؤال إلى سلة المهملات');
    } catch (err) {
      toast((err && err.message) || 'تعذّر نقل السؤال إلى سلة المهملات', true);
    }
  }

  async function restoreFaqFromTrash(id) {
    if (!window.PlatformFaqs) return;
    var key = String(id || '').trim();
    if (!key) return;
    var Firestore = window.PlatformFaqsFirestore;

    try {
      if (usesFirestoreFaqs() && Firestore && typeof Firestore.restoreFaq === 'function') {
        await Firestore.restoreFaq(key);
      } else {
        var list = window.PlatformFaqs.getAllFaqs();
        list.forEach(function (f) {
          if (String(f.id) === key) f.status = 'draft';
        });
        window.PlatformFaqs.saveFaqs(list);
      }
      renderFaqTable();
      reloadSitePreview();
      toast('تمت استعادة السؤال كمسودة');
    } catch (err) {
      toast((err && err.message) || 'تعذّر استعادة السؤال', true);
    }
  }

  async function purgeFaqById(id) {
    if (!window.PlatformFaqs) return;
    var key = String(id || '').trim();
    if (!key) return;
    if (!window.confirm('حذف هذا السؤال نهائياً؟ لا يمكن التراجع عن هذا الإجراء.')) return;
    var Firestore = window.PlatformFaqsFirestore;

    try {
      if (usesFirestoreFaqs() && Firestore && typeof Firestore.purgeFaq === 'function') {
        await Firestore.purgeFaq(key);
      } else {
        window.PlatformFaqs.saveFaqs(
          window.PlatformFaqs.getAllFaqs().filter(function (f) {
            return String(f.id) !== key;
          })
        );
      }
      renderFaqTable();
      reloadSitePreview();
      toast('تم الحذف النهائي للسؤال');
    } catch (err) {
      toast((err && err.message) || 'تعذّر الحذف النهائي للسؤال', true);
    }
  }

  /* ---------- Testimonials ---------- */
  function usesFirestoreTestimonials() {
    return !!(
      window.PlatformTestimonialsFirestore &&
      typeof window.PlatformTestimonialsFirestore.isReady === 'function' &&
      window.PlatformTestimonialsFirestore.isReady()
    );
  }

  function testimonialAvatarExtension(file) {
    var name = String((file && file.name) || 'avatar.jpg');
    var ext = name.indexOf('.') > -1 ? name.split('.').pop() : 'jpg';
    ext = String(ext).replace(/[^a-z0-9]/gi, '').toLowerCase();
    return ext || 'jpg';
  }

  async function uploadTestimonialAvatarFile(testimonialId, file) {
    var mod = await import('./cms-storage.js');
    var path =
      'cms/testimonials/' +
      String(testimonialId) +
      '/avatar.' +
      testimonialAvatarExtension(file);
    return mod.uploadCmsFile(path, file);
  }

  async function resolveTestimonialAvatarForSave(testimonialId) {
    var avatar = String($('tstEditorAvatarData').value || '').trim();
    if (pendingTestimonialAvatarFile) {
      avatar = await uploadTestimonialAvatarFile(testimonialId, pendingTestimonialAvatarFile);
      pendingTestimonialAvatarFile = null;
      $('tstEditorAvatarData').value = avatar;
      var preview = $('tstEditorAvatarPreview');
      if (preview) {
        preview.src = avatar;
        preview.hidden = !avatar;
      }
      var fileInput = $('tstEditorAvatarFile');
      if (fileInput) fileInput.value = '';
      return avatar;
    }
    if (usesFirestoreTestimonials()) {
      var mod = await import('./cms-storage.js');
      if (avatar && mod.rejectDataUrl(avatar)) {
        throw new Error('صورة الرأي يجب رفعها إلى التخزين — لا يُسمح بحفظ base64 في Firestore.');
      }
    }
    return avatar;
  }

  function renderTestimonialsTable() {
    var body = $('cmsTestimonialsBody');
    if (!body || !window.PlatformTestimonials) return;
    updateTestimonialsBinToolbar();
    var list = tstBinView
      ? window.PlatformTestimonials.getTrashedTestimonials()
      : window.PlatformTestimonials.getTestimonials();
    if (!list.length) {
      body.innerHTML =
        '<tr><td colspan="5" class="admin-empty-cell">' +
        (tstBinView ? 'سلة المهملات فارغة.' : 'لا توجد آراء.') +
        '</td></tr>';
      return;
    }
    if (tstBinView) {
      body.innerHTML = list
        .map(function (t) {
          return (
            '<tr><td>' +
            escapeHtml(t.name) +
            '</td><td>' +
            escapeHtml(t.role) +
            '</td><td>' +
            escapeHtml(window.PlatformTestimonials.stars(t.rating)) +
            '</td><td>' +
            statusBadge(t.status) +
            '</td><td class="admin-table__actions">' +
            '<button class="admin-btn admin-btn--ghost" type="button" data-tst-restore="' +
            escapeHtml(t.id) +
            '">استعادة</button>' +
            '<button class="admin-btn admin-btn--danger" type="button" data-tst-purge="' +
            escapeHtml(t.id) +
            '">حذف نهائي</button>' +
            '</td></tr>'
          );
        })
        .join('');
      return;
    }
    body.innerHTML = list
      .map(function (t) {
        return (
          '<tr><td>' +
          escapeHtml(t.name) +
          '</td><td>' +
          escapeHtml(t.role) +
          '</td><td>' +
          escapeHtml(window.PlatformTestimonials.stars(t.rating)) +
          '</td><td>' +
          statusBadge(t.status) +
          '</td><td class="admin-table__actions">' +
          '<button class="admin-btn admin-btn--ghost" type="button" data-tst-toggle="' +
          escapeHtml(t.id) +
          '">' +
          (t.status === 'published' ? 'مسودة' : 'نشر') +
          '</button>' +
          '<button class="admin-btn admin-btn--ghost" type="button" data-tst-edit="' +
          escapeHtml(t.id) +
          '">تعديل</button>' +
          '<button class="admin-btn admin-btn--danger" type="button" data-tst-delete="' +
          escapeHtml(t.id) +
          '">حذف</button>' +
          '</td></tr>'
        );
      })
      .join('');
  }

  function openTestimonialModal(item) {
    editingTestimonialId = item && item.id ? item.id : null;
    pendingTestimonialAvatarFile = null;
    var avatarFileInput = $('tstEditorAvatarFile');
    if (avatarFileInput) avatarFileInput.value = '';
    $('tstEditorId').value = editingTestimonialId || '';
    $('tstEditorName').value = item ? item.name : '';
    $('tstEditorRole').value = item ? item.role : '';
    $('tstEditorText').value = item ? item.text : '';
    $('tstEditorRating').value = item ? String(item.rating || 5) : '5';
    $('tstEditorStatus').value = item ? item.status || 'published' : 'published';
    $('tstEditorAvatarData').value = item && item.avatar ? item.avatar : '';
    var preview = $('tstEditorAvatarPreview');
    if (preview) {
      preview.hidden = !item || !item.avatar;
      preview.src = item && item.avatar ? item.avatar : '';
    }
    $('tstEditorTitleLabel').textContent = editingTestimonialId ? 'تعديل رأي' : 'رأي جديد';
    $('tstEditorModal').hidden = false;
  }

  function closeTestimonialModal() {
    $('tstEditorModal').hidden = true;
    editingTestimonialId = null;
    pendingTestimonialAvatarFile = null;
    var fileInput = $('tstEditorAvatarFile');
    if (fileInput) fileInput.value = '';
  }

  async function saveTestimonialFromForm() {
    if (!window.PlatformTestimonials) return;
    var existingId = String($('tstEditorId').value || editingTestimonialId || '').trim();
    var testimonialId = existingId || window.PlatformTestimonials.uid();
    var isDraft = String($('tstEditorStatus').value || '').trim() === 'draft';
    var isPublish = !isDraft;
    var Firestore = window.PlatformTestimonialsFirestore;

    try {
      await runWithCmsPublishProgress(isPublish ? 'جاري النشر...' : 'جاري الحفظ...', async function (setPct) {
        setPct(10);
        var avatar = await resolveTestimonialAvatarForSave(testimonialId);
        var payload = {
          name: $('tstEditorName').value,
          role: $('tstEditorRole').value,
          text: $('tstEditorText').value,
          rating: Number($('tstEditorRating').value) || 5,
          avatar: avatar,
          status: $('tstEditorStatus').value,
        };
        setPct(45);

        if (usesFirestoreTestimonials() && Firestore) {
          var known =
            existingId && typeof Firestore.findTestimonial === 'function'
              ? Firestore.findTestimonial(existingId)
              : null;
          if (known) {
            await Firestore.updateTestimonial(existingId, payload);
          } else {
            await Firestore.addTestimonial(Object.assign({}, payload, { id: testimonialId }));
          }
        } else {
          var list = window.PlatformTestimonials.getAllTestimonials();
          var item = Object.assign({}, payload, { id: testimonialId });
          var idx = -1;
          list.forEach(function (t, i) {
            if (t.id === item.id) idx = i;
          });
          if (idx === -1) list.push(item);
          else list[idx] = item;
          window.PlatformTestimonials.saveTestimonials(list);
        }
        setPct(95);
      });
      closeTestimonialModal();
      renderTestimonialsTable();
      reloadSitePreview();
      if (isPublish) toast(PUBLISH_SUCCESS_TOAST);
      else toast('تم حفظ الرأي');
    } catch (err) {
      toast((err && err.message) || 'تعذّر حفظ الرأي', true);
    }
  }

  async function toggleTestimonialStatus(id) {
    if (!window.PlatformTestimonials || tstToggleInFlight) return;
    var key = String(id || '').trim();
    if (!key) return;

    var item = null;
    window.PlatformTestimonials.getTestimonials().forEach(function (t) {
      if (String(t.id) === key) item = t;
    });
    if (!item) {
      toast('تعذّر العثور على الرأي', true);
      return;
    }

    var nextStatus = item.status === 'published' ? 'draft' : 'published';
    var Firestore = window.PlatformTestimonialsFirestore;

    tstToggleInFlight = true;
    try {
      await runWithCmsPublishProgress(
        nextStatus === 'published' ? 'جاري النشر...' : 'جاري تحديث الحالة...',
        async function (setPct) {
          setPct(30);
          if (usesFirestoreTestimonials() && Firestore && typeof Firestore.setTestimonialStatus === 'function') {
            await Firestore.setTestimonialStatus(key, nextStatus);
          } else if (usesFirestoreTestimonials() && Firestore) {
            await Firestore.updateTestimonial(key, { status: nextStatus });
          } else {
            var list = window.PlatformTestimonials.getAllTestimonials();
            list.forEach(function (t) {
              if (String(t.id) === key) t.status = nextStatus;
            });
            window.PlatformTestimonials.saveTestimonials(list);
          }
          setPct(95);
        }
      );
      renderTestimonialsTable();
      reloadSitePreview();
      toast(nextStatus === 'published' ? PUBLISH_SUCCESS_TOAST : 'تم تحويل الرأي إلى مسودة');
    } catch (err) {
      toast((err && err.message) || 'تعذّر تحديث حالة الرأي', true);
    } finally {
      tstToggleInFlight = false;
    }
  }

  async function restoreDefaultTestimonials() {
    var Firestore = window.PlatformTestimonialsFirestore;
    if (!usesFirestoreTestimonials() || !Firestore || typeof Firestore.restoreDefaultTestimonials !== 'function') {
      toast('استعادة الافتراضيات متاحة فقط عند تفعيل Firestore.', true);
      return;
    }
    if (!window.confirm('استعادة الآراء الافتراضية المفقودة في Firestore؟')) return;

    try {
      var result = await Firestore.restoreDefaultTestimonials();
      renderTestimonialsTable();
      reloadSitePreview();
      toast((result && result.message) || 'تمت استعادة الآراء الافتراضية');
    } catch (err) {
      toast((err && err.message) || 'تعذّر استعادة الآراء الافتراضية', true);
    }
  }

  async function deleteTestimonialById(id) {
    if (!window.PlatformTestimonials) return;
    var key = String(id || '').trim();
    if (!key) return;
    if (!window.confirm('نقل هذا الرأي إلى سلة المهملات؟')) return;

    var Firestore = window.PlatformTestimonialsFirestore;

    try {
      if (usesFirestoreTestimonials() && Firestore) {
        await Firestore.deleteTestimonial(key);
      } else {
        var list = window.PlatformTestimonials.getAllTestimonials();
        list.forEach(function (t) {
          if (String(t.id) === key) t.status = 'trash';
        });
        window.PlatformTestimonials.saveTestimonials(list);
      }
      renderTestimonialsTable();
      reloadSitePreview();
      toast('تم نقل الرأي إلى سلة المهملات');
    } catch (err) {
      toast((err && err.message) || 'تعذّر نقل الرأي إلى سلة المهملات', true);
    }
  }

  async function restoreTestimonialFromTrash(id) {
    if (!window.PlatformTestimonials) return;
    var key = String(id || '').trim();
    if (!key) return;
    var Firestore = window.PlatformTestimonialsFirestore;

    try {
      if (usesFirestoreTestimonials() && Firestore && typeof Firestore.restoreTestimonial === 'function') {
        await Firestore.restoreTestimonial(key);
      } else {
        var list = window.PlatformTestimonials.getAllTestimonials();
        list.forEach(function (t) {
          if (String(t.id) === key) t.status = 'draft';
        });
        window.PlatformTestimonials.saveTestimonials(list);
      }
      renderTestimonialsTable();
      reloadSitePreview();
      toast('تمت استعادة الرأي كمسودة');
    } catch (err) {
      toast((err && err.message) || 'تعذّر استعادة الرأي', true);
    }
  }

  async function purgeTestimonialById(id) {
    if (!window.PlatformTestimonials) return;
    var key = String(id || '').trim();
    if (!key) return;
    if (!window.confirm('حذف هذا الرأي نهائياً؟ لا يمكن التراجع عن هذا الإجراء.')) return;
    var Firestore = window.PlatformTestimonialsFirestore;

    try {
      if (usesFirestoreTestimonials() && Firestore && typeof Firestore.purgeTestimonial === 'function') {
        await Firestore.purgeTestimonial(key);
      } else {
        window.PlatformTestimonials.saveTestimonials(
          window.PlatformTestimonials.getAllTestimonials().filter(function (t) {
            return String(t.id) !== key;
          })
        );
      }
      renderTestimonialsTable();
      reloadSitePreview();
      toast('تم الحذف النهائي للرأي');
    } catch (err) {
      toast((err && err.message) || 'تعذّر الحذف النهائي للرأي', true);
    }
  }

  function bindArticlesAdminLive() {
    if (articlesLiveBound || !$('cmsArticlesBody')) return;
    articlesLiveBound = true;

    document.addEventListener('ifa:articles-firestore-changed', renderArticlesTable);
    window.addEventListener('ifa:articles-firestore-changed', renderArticlesTable);
    document.addEventListener('ifa:platform-articles-changed', renderArticlesTable);
    window.addEventListener('ifa:platform-articles-changed', renderArticlesTable);

    function attachArticlesFirestoreSubscribe(attempts) {
      var Firestore = window.PlatformArticlesFirestore;
      if (Firestore && typeof Firestore.subscribe === 'function') {
        Firestore.subscribe(function () {
          renderArticlesTable();
        });
        renderArticlesTable();
        return;
      }
      if (attempts > 120) {
        renderArticlesTable();
        return;
      }
      window.setTimeout(function () {
        attachArticlesFirestoreSubscribe(attempts + 1);
      }, 50);
    }

    attachArticlesFirestoreSubscribe(0);

    (function waitForArticlesSnapshotReady(attempts) {
      if (isArticlesFirestoreModuleReady()) {
        renderArticlesTable();
        return;
      }
      if (!window.PlatformArticlesFirestore) {
        if (attempts > 120) return;
        window.setTimeout(function () {
          waitForArticlesSnapshotReady(attempts + 1);
        }, 50);
        return;
      }
      if (attempts > 240) return;
      window.setTimeout(function () {
        waitForArticlesSnapshotReady(attempts + 1);
      }, 50);
    })(0);
  }

  function bind() {
    if (
      !$('cmsSimulatorShowcaseList') &&
      !$('cmsShowcaseSettingsForm') &&
      !$('cmsStatsForm') &&
      !$('cmsHeroSlideshowForm') &&
      !$('cmsFooterForm') &&
      !$('cmsArticlesBody') &&
      !$('cmsFaqBody') &&
      !$('cmsTestimonialsBody')
    )
      return;

    bindSimulatorShowcaseManager();
    bindStatsEditor();
    bindHeroSlideshowEditor();
    bindFooterEditor();
    renderArticlesTable();
    renderFaqTable();
    renderTestimonialsTable();
    initRichEditor();

    document.addEventListener('click', function (e) {
      var simIconReset = e.target.closest ? e.target.closest('[data-sim-icon-reset]') : null;
      if (simIconReset) {
        var resetCard =
          simIconReset.closest('[data-showcase-editor]') || simIconReset.closest('[data-sim-editor]');
        if (resetCard) resetSimIcon(resetCard);
        return;
      }
      if (e.target.closest && e.target.closest('[data-article-bin-toggle]')) {
        articlesBinView = !articlesBinView;
        renderArticlesTable();
        return;
      }
      if (e.target.closest && e.target.closest('[data-article-add]')) {
        openArticleModal(null);
        return;
      }
      var artRestore = e.target.closest ? e.target.closest('[data-article-restore]') : null;
      if (artRestore) {
        restoreArticleFromTrash(artRestore.getAttribute('data-article-restore'));
        return;
      }
      var artPurge = e.target.closest ? e.target.closest('[data-article-purge]') : null;
      if (artPurge) {
        purgeArticleById(artPurge.getAttribute('data-article-purge'));
        return;
      }
      var artToggle = e.target.closest ? e.target.closest('[data-article-toggle]') : null;
      if (artToggle) {
        toggleArticleStatus(artToggle.getAttribute('data-article-toggle'));
        return;
      }
      var artEdit = e.target.closest ? e.target.closest('[data-article-edit]') : null;
      if (artEdit) {
        var articles = window.PlatformArticles.getArticles();
        var found = null;
        var editKey = String(artEdit.getAttribute('data-article-edit') || '');
        articles.forEach(function (a) {
          if (String(a.id) === editKey) found = a;
        });
        if (found) openArticleModal(found);
        return;
      }
      var artDel = e.target.closest ? e.target.closest('[data-article-delete]') : null;
      if (artDel) {
        deleteArticleById(artDel.getAttribute('data-article-delete'));
        return;
      }
      if (e.target.closest && e.target.closest('[data-close-article-modal]')) {
        closeArticleModal();
        return;
      }
      if (e.target.closest && e.target.closest('[data-faq-bin-toggle]')) {
        faqBinView = !faqBinView;
        renderFaqTable();
        return;
      }
      if (e.target.closest && e.target.closest('[data-faq-add]')) {
        openFaqModal(null);
        return;
      }
      var faqRestore = e.target.closest ? e.target.closest('[data-faq-restore]') : null;
      if (faqRestore) {
        restoreFaqFromTrash(faqRestore.getAttribute('data-faq-restore'));
        return;
      }
      var faqPurge = e.target.closest ? e.target.closest('[data-faq-purge]') : null;
      if (faqPurge) {
        purgeFaqById(faqPurge.getAttribute('data-faq-purge'));
        return;
      }
      var faqToggle = e.target.closest ? e.target.closest('[data-faq-toggle]') : null;
      if (faqToggle) {
        toggleFaqStatus(faqToggle.getAttribute('data-faq-toggle'));
        return;
      }
      var faqEdit = e.target.closest ? e.target.closest('[data-faq-edit]') : null;
      if (faqEdit) {
        var faqs = window.PlatformFaqs.getFaqs();
        var faq = null;
        faqs.forEach(function (f) {
          if (f.id === faqEdit.getAttribute('data-faq-edit')) faq = f;
        });
        if (faq) openFaqModal(faq);
        return;
      }
      var faqDel = e.target.closest ? e.target.closest('[data-faq-delete]') : null;
      if (faqDel) {
        deleteFaqById(faqDel.getAttribute('data-faq-delete'));
        return;
      }
      var faqUp = e.target.closest ? e.target.closest('[data-faq-up]') : null;
      if (faqUp) {
        moveFaq(Number(faqUp.getAttribute('data-faq-up')), -1);
        return;
      }
      var faqDown = e.target.closest ? e.target.closest('[data-faq-down]') : null;
      if (faqDown) {
        moveFaq(Number(faqDown.getAttribute('data-faq-down')), 1);
        return;
      }
      if (e.target.closest && e.target.closest('[data-close-faq-modal]')) {
        closeFaqModal();
        return;
      }
      if (e.target.closest && e.target.closest('[data-tst-bin-toggle]')) {
        tstBinView = !tstBinView;
        renderTestimonialsTable();
        return;
      }
      if (e.target.closest && e.target.closest('[data-tst-restore-defaults]')) {
        restoreDefaultTestimonials();
        return;
      }
      if (e.target.closest && e.target.closest('[data-tst-add]')) {
        openTestimonialModal(null);
        return;
      }
      var tstRestore = e.target.closest ? e.target.closest('[data-tst-restore]') : null;
      if (tstRestore) {
        restoreTestimonialFromTrash(tstRestore.getAttribute('data-tst-restore'));
        return;
      }
      var tstPurge = e.target.closest ? e.target.closest('[data-tst-purge]') : null;
      if (tstPurge) {
        purgeTestimonialById(tstPurge.getAttribute('data-tst-purge'));
        return;
      }
      var tstToggle = e.target.closest ? e.target.closest('[data-tst-toggle]') : null;
      if (tstToggle) {
        toggleTestimonialStatus(tstToggle.getAttribute('data-tst-toggle'));
        return;
      }
      var tstEdit = e.target.closest ? e.target.closest('[data-tst-edit]') : null;
      if (tstEdit) {
        var tlist = window.PlatformTestimonials.getTestimonials();
        var tst = null;
        tlist.forEach(function (t) {
          if (t.id === tstEdit.getAttribute('data-tst-edit')) tst = t;
        });
        if (tst) openTestimonialModal(tst);
        return;
      }
      var tstDel = e.target.closest ? e.target.closest('[data-tst-delete]') : null;
      if (tstDel) {
        deleteTestimonialById(tstDel.getAttribute('data-tst-delete'));
        return;
      }
      if (e.target.closest && e.target.closest('[data-close-tst-modal]')) {
        closeTestimonialModal();
        return;
      }
    });

    document.addEventListener('change', function (e) {
      var simIconFile = e.target.closest ? e.target.closest('[data-sim-icon-file]') : null;
      if (simIconFile && simIconFile.files && simIconFile.files[0]) {
        var file = simIconFile.files[0];
        var card =
          simIconFile.closest('[data-showcase-editor]') || simIconFile.closest('[data-sim-editor]');
        if (!card) return;
        if (file.size > MAX_SIM_ICON_BYTES) {
          toast('حجم الأيقونة كبير جداً — الحد الأقصى 500 كيلوبايت', true);
          simIconFile.value = '';
          return;
        }
        var simId = getShowcaseCardSimId(card);
        if (simId) pendingSimulatorIconFiles[simId] = file;
        applyCompressedSimulatorIcon(card, file);
        simIconFile.value = '';
        return;
      }
      if (e.target.id === 'articleEditorImageFile' && e.target.files && e.target.files[0]) {
        var coverFile = e.target.files[0];
        if (coverFile.size > MAX_SIM_ICON_BYTES) {
          toast('حجم الصورة كبير جداً — الحد الأقصى 500 كيلوبايت', true);
          e.target.value = '';
          return;
        }
        if (usesFirestoreArticles()) {
          pendingArticleCoverFile = coverFile;
          var coverObjectUrl = URL.createObjectURL(coverFile);
          $('articleEditorImagePreview').hidden = false;
          $('articleEditorImagePreview').src = coverObjectUrl;
          return;
        }
        readFileAsDataUrl(coverFile, function (url) {
          $('articleEditorImageData').value = url;
          $('articleEditorImagePreview').hidden = false;
          $('articleEditorImagePreview').src = url;
        });
        return;
      }
      if (e.target.id === 'tstEditorAvatarFile' && e.target.files && e.target.files[0]) {
        var avatarFile = e.target.files[0];
        if (avatarFile.size > MAX_SIM_ICON_BYTES) {
          toast('حجم الصورة كبير جداً — الحد الأقصى 500 كيلوبايت', true);
          e.target.value = '';
          return;
        }
        if (usesFirestoreTestimonials()) {
          pendingTestimonialAvatarFile = avatarFile;
          var objectUrl = URL.createObjectURL(avatarFile);
          $('tstEditorAvatarPreview').hidden = false;
          $('tstEditorAvatarPreview').src = objectUrl;
          return;
        }
        readFileAsDataUrl(avatarFile, function (url) {
          $('tstEditorAvatarData').value = url;
          $('tstEditorAvatarPreview').hidden = false;
          $('tstEditorAvatarPreview').src = url;
        });
      }
    });

    var articleForm = $('articleEditorForm');
    if (articleForm) {
      articleForm.addEventListener('submit', function (e) {
        e.preventDefault();
        saveArticleFromForm();
      });
    }
    var faqForm = $('faqEditorForm');
    if (faqForm) {
      faqForm.addEventListener('submit', function (e) {
        e.preventDefault();
        saveFaqFromForm();
      });
    }

    document.addEventListener('ifa:faqs-firestore-changed', renderFaqTable);
    window.addEventListener('ifa:faqs-firestore-changed', renderFaqTable);
    document.addEventListener('ifa:platform-faqs-changed', renderFaqTable);
    window.addEventListener('ifa:platform-faqs-changed', renderFaqTable);

    (function waitForFirestoreFaqs(attempts) {
      if (window.PlatformFaqsFirestore && typeof window.PlatformFaqsFirestore.subscribe === 'function') {
        window.PlatformFaqsFirestore.subscribe(function () {
          renderFaqTable();
        });
        return;
      }
      if (attempts > 40) return;
      window.setTimeout(function () {
        waitForFirestoreFaqs(attempts + 1);
      }, 50);
    })(0);
    var tstForm = $('tstEditorForm');
    if (tstForm) {
      tstForm.addEventListener('submit', function (e) {
        e.preventDefault();
        saveTestimonialFromForm();
      });
    }

    document.addEventListener('ifa:testimonials-firestore-changed', renderTestimonialsTable);
    window.addEventListener('ifa:testimonials-firestore-changed', renderTestimonialsTable);
    document.addEventListener('ifa:platform-testimonials-changed', renderTestimonialsTable);
    window.addEventListener('ifa:platform-testimonials-changed', renderTestimonialsTable);

    (function waitForFirestoreTestimonials(attempts) {
      if (
        window.PlatformTestimonialsFirestore &&
        typeof window.PlatformTestimonialsFirestore.subscribe === 'function'
      ) {
        window.PlatformTestimonialsFirestore.subscribe(function () {
          renderTestimonialsTable();
        });
        return;
      }
      if (attempts > 40) return;
      window.setTimeout(function () {
        waitForFirestoreTestimonials(attempts + 1);
      }, 50);
    })(0);

    ['articleEditorFontFamily', 'articleEditorFontSize', 'articleEditorTextColor'].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.addEventListener('input', function () {
        var body = $('articleEditorBody');
        if (!body) return;
        if (id === 'articleEditorFontFamily') body.style.fontFamily = el.value;
        if (id === 'articleEditorFontSize') body.style.fontSize = el.value;
        if (id === 'articleEditorTextColor') body.style.color = el.value;
      });
    });

    var imageUrl = $('articleEditorImageUrl');
    if (imageUrl) {
      imageUrl.addEventListener('change', function () {
        if (!imageUrl.value) return;
        $('articleEditorImageData').value = imageUrl.value;
        $('articleEditorImagePreview').hidden = false;
        $('articleEditorImagePreview').src = imageUrl.value;
      });
    }

    window.renderAdminSiteCms = function () {
      if (window.PlatformSimulatorShowcase && $('cmsShowcaseInterval')) {
        $('cmsShowcaseInterval').value = String(window.PlatformSimulatorShowcase.getIntervalSeconds());
      }
      renderSimulatorShowcaseManager();
      renderStatsEditor();
      renderHeroSlideshowEditor();
      loadFooterEditorForm();
      renderArticlesTable();
      renderFaqTable();
      renderTestimonialsTable();
    };
  }

  function bootAdminSiteCms() {
    bindArticlesAdminLive();
    bind();
    renderArticlesTable();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootAdminSiteCms);
  } else {
    bootAdminSiteCms();
  }
})();
