/**
 * Hero content slider — localStorage CMS (ifa_hero_slideshow).
 */
(function (global) {
  'use strict';

  var KEY = 'ifa_hero_slideshow';
  var MAX_SLIDES = 12;
  var MAX_IMAGE_BYTES = 900000;
  var DEFAULT_INTERVAL = 5;

  var timerId = null;
  var currentIndex = 0;
  var activeConfig = null;

  function uid() {
    return 'hslide-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function normalizeHex(color, fallback) {
    if (!color || typeof color !== 'string') return fallback;
    var hex = color.trim();
    if (!hex.startsWith('#')) hex = '#' + hex;
    if (/^#[0-9a-f]{3}$/i.test(hex)) {
      hex = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
    }
    return /^#[0-9a-f]{6}$/i.test(hex) ? hex.toLowerCase() : fallback;
  }

  function hexToRgba(hex, alpha) {
    var h = normalizeHex(hex, '#0b1220').slice(1);
    var r = parseInt(h.slice(0, 2), 16);
    var g = parseInt(h.slice(2, 4), 16);
    var b = parseInt(h.slice(4, 6), 16);
    return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + alpha + ')';
  }

  function defaultSlides() {
    return [
      {
        id: 'default-ftth',
        visualType: 'network',
        image: '',
        title: 'مسارك المهني الهندسي يبدأ هنا',
        description: 'منصة المسار المهني الهندسي — كورسات منظمة ومحاكيات تفاعلية لبناء مهاراتك خطوة بخطوة.',
        buttonText: 'ابدأ التدريب الآن',
        buttonHref: '#pricing',
        secondaryButtonText: 'Try Simulator',
        secondaryButtonHref: 'simulator.html',
        textColor: '#ffffff',
        bgTint: '#0b1220',
        badge: 'منصة المسار المهني الهندسي',
        showTrust: true,
      },
    ];
  }

  function blankSlide() {
    return {
      id: uid(),
      visualType: 'image',
      image: '',
      title: '',
      description: '',
      buttonText: 'Try Simulator',
      buttonHref: 'simulator.html',
      secondaryButtonText: '',
      secondaryButtonHref: '',
      textColor: '#ffffff',
      bgTint: '#0b1220',
      badge: '',
      showTrust: false,
    };
  }

  function normalizeSlide(raw) {
    var s = raw && typeof raw === 'object' ? raw : {};
    var image = String(s.image != null ? s.image : s.src || '').trim();
    var visualType = s.visualType === 'network' || (!image && s.visualType !== 'image') ? 'network' : 'image';
    if (image) visualType = 'image';
    return {
      id: String(s.id || uid()),
      visualType: visualType,
      image: image,
      title: String(s.title != null ? s.title : s.alt || '').trim().slice(0, 200),
      description: String(s.description || '').trim().slice(0, 600),
      buttonText: String(s.buttonText || 'Try Simulator').trim().slice(0, 80),
      buttonHref: String(s.buttonHref || '#pricing').trim().slice(0, 300),
      secondaryButtonText: String(s.secondaryButtonText || '').trim().slice(0, 80),
      secondaryButtonHref: String(s.secondaryButtonHref || '').trim().slice(0, 300),
      textColor: normalizeHex(s.textColor, '#ffffff'),
      bgTint: normalizeHex(s.bgTint, '#0b1220'),
      badge: String(s.badge || '').trim().slice(0, 120),
      showTrust: !!s.showTrust,
    };
  }

  function readJson() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (err) {
      return null;
    }
  }

  function normalizeConfig(raw) {
    var src = raw && typeof raw === 'object' ? raw : {};
    var interval = Number(src.intervalSeconds);
    if (!isFinite(interval) || interval < 2) interval = DEFAULT_INTERVAL;
    if (interval > 60) interval = 60;
    var slides = Array.isArray(src.slides) ? src.slides : [];
    slides = slides.map(normalizeSlide).slice(0, MAX_SLIDES);
    return {
      intervalSeconds: Math.round(interval),
      slides: slides,
    };
  }

  function getConfig() {
    return normalizeConfig(readJson());
  }

  function translate(key) {
    if (global.PlatformI18n && typeof global.PlatformI18n.t === 'function') {
      return global.PlatformI18n.t(key);
    }
    return key;
  }

  function localizeSlide(slide) {
    if (!slide) return slide;
    if (global.PlatformI18n && global.PlatformI18n.getLang() !== 'en') return slide;
    if (slide.id === 'default-ftth') {
      return Object.assign({}, slide, {
        title: translate('hero.default.title'),
        description: translate('hero.default.description'),
        buttonText: translate('hero.default.cta'),
        secondaryButtonText: translate('hero.default.secondaryCta'),
        badge: translate('hero.default.badge'),
      });
    }
    return slide;
  }

  function getSlidesForDisplay() {
    var slides = getConfig().slides;
    var list = slides.length ? slides : defaultSlides();
    return list.map(localizeSlide);
  }

  function saveConfig(patch) {
    var next = normalizeConfig(Object.assign({}, getConfig(), patch || {}));
    if (patch && Array.isArray(patch.slides)) {
      next.slides = patch.slides.map(normalizeSlide).slice(0, MAX_SLIDES);
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch (err) {
      console.error('[HeroSlideshow] save failed', err);
      return getConfig();
    }
    try {
      global.dispatchEvent(new CustomEvent('ifa:hero-slideshow-changed', { detail: next }));
    } catch (err2) {
      /* ignore */
    }
    return next;
  }

  function getSlideCount() {
    var slidesEl = document.getElementById('heroSlideshowSlides');
    if (!slidesEl) return 0;
    return slidesEl.querySelectorAll('.hero-content-slide').length;
  }

  function stopTimer() {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  function goToSlide(index) {
    var slides = document.querySelectorAll('.hero-content-slide');
    if (!slides.length) return;
    currentIndex = ((index % slides.length) + slides.length) % slides.length;
    slides.forEach(function (el, i) {
      el.classList.toggle('is-active', i === currentIndex);
    });
  }

  function startTimer() {
    stopTimer();
    if (getSlideCount() < 2) return;
    var intervalSec =
      activeConfig && activeConfig.intervalSeconds ? activeConfig.intervalSeconds : DEFAULT_INTERVAL;
    timerId = setInterval(function () {
      goToSlide(currentIndex + 1);
    }, intervalSec * 1000);
  }

  function cloneNetworkVisual() {
    var tpl = document.getElementById('heroNetworkTemplate');
    if (!tpl || !tpl.content) return null;
    return tpl.content.cloneNode(true);
  }

  function buildVisualHtml(slide) {
    if (slide.visualType === 'network' || !slide.image) {
      return '<div class="hero-content-slide__visual-mount hero-content-slide__visual-mount--network"></div>';
    }
    return (
      '<div class="hero-content-slide__visual-mount hero-content-slide__visual-mount--image">' +
      '<div class="hero__visual-card hero__visual-card--image">' +
      '<img src="' +
      String(slide.image).replace(/"/g, '&quot;') +
      '" alt="' +
      escapeHtml(slide.title || 'Hero slide') +
      '" loading="lazy" decoding="async" />' +
      '</div></div>'
    );
  }

  function buildTrustHtml() {
    return (
      '<div class="hero__trust">' +
      '<div class="hero__trust-item"><span class="hero__trust-icon">✓</span><span>' +
      translate('hero.trust.realistic') +
      '</span></div>' +
      '<div class="hero__trust-item"><span class="hero__trust-icon">✓</span><span>' +
      translate('hero.trust.certificates') +
      '</span></div>' +
      '<div class="hero__trust-item"><span class="hero__trust-icon">✓</span><span>' +
      translate('hero.trust.support') +
      '</span></div>' +
      '</div>'
    );
  }

  function buildSlideHtml(slide, index) {
    var tint = normalizeHex(slide.bgTint, '#0b1220');
    var textColor = normalizeHex(slide.textColor, '#ffffff');
    var secondaryBtn =
      slide.secondaryButtonText && slide.secondaryButtonHref
        ? '<a class="btn btn--outline hero-content-slide__btn" href="' +
          escapeHtml(slide.secondaryButtonHref) +
          '">' +
          escapeHtml(slide.secondaryButtonText) +
          '</a>'
        : '';
    var badge = slide.badge
      ? '<div class="hero__badge"><span class="hero__badge-dot"></span> ' + escapeHtml(slide.badge) + '</div>'
      : '';
    var trust = slide.showTrust ? buildTrustHtml() : '';

    return (
      '<article class="hero-content-slide' +
      (index === 0 ? ' is-active' : '') +
      '" data-slide-index="' +
      index +
      '" style="--hero-slide-text:' +
      textColor +
      ';--hero-slide-tint:' +
      tint +
      ';">' +
      '<div class="hero-content-slide__tint" style="background:linear-gradient(135deg,' +
      hexToRgba(tint, 0.92) +
      ' 0%,' +
      hexToRgba(tint, 0.55) +
      ' 55%, rgba(6,10,18,0.35) 100%);"></div>' +
      '<div class="container hero-content-slide__inner">' +
      '<div class="hero-content-slide__copy">' +
      badge +
      '<h1 class="hero-content-slide__title">' +
      escapeHtml(slide.title) +
      '</h1>' +
      '<p class="hero-content-slide__desc">' +
      escapeHtml(slide.description) +
      '</p>' +
      '<div class="hero-content-slide__actions">' +
      (slide.buttonText
        ? '<a class="btn btn--primary hero-content-slide__btn" href="' +
          escapeHtml(slide.buttonHref || '#') +
          '">' +
          escapeHtml(slide.buttonText) +
          '</a>'
        : '') +
      secondaryBtn +
      '</div>' +
      trust +
      '</div>' +
      '<div class="hero-content-slide__visual">' +
      buildVisualHtml(slide) +
      '</div>' +
      '</div></article>'
    );
  }

  function mountNetworkVisuals(root) {
    if (!root) return;
    root.querySelectorAll('.hero-content-slide__visual-mount--network').forEach(function (mount) {
      mount.innerHTML = '';
      var clone = cloneNetworkVisual();
      if (clone) mount.appendChild(clone);
    });
  }

  function mountHeroSlideshow() {
    var slidesEl = document.getElementById('heroSlideshowSlides');
    if (!slidesEl) return;

    activeConfig = getConfig();
    var slides = getSlidesForDisplay();
    var prevIndex = currentIndex;
    stopTimer();

    slidesEl.innerHTML = slides
      .map(function (slide, i) {
        return buildSlideHtml(slide, i);
      })
      .join('');

    mountNetworkVisuals(slidesEl);

    var total = getSlideCount();
    currentIndex = prevIndex >= total ? 0 : prevIndex;
    goToSlide(currentIndex);
    startTimer();
  }

  global.PlatformHeroSlideshow = {
    KEY: KEY,
    MAX_SLIDES: MAX_SLIDES,
    MAX_IMAGE_BYTES: MAX_IMAGE_BYTES,
    DEFAULT_INTERVAL: DEFAULT_INTERVAL,
    uid: uid,
    blankSlide: blankSlide,
    defaultSlides: defaultSlides,
    getConfig: getConfig,
    getSlidesForDisplay: getSlidesForDisplay,
    saveConfig: saveConfig,
    normalizeConfig: normalizeConfig,
    normalizeSlide: normalizeSlide,
    mountHeroSlideshow: mountHeroSlideshow,
  };

  function boot() {
    mountHeroSlideshow();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  global.addEventListener('ifa:hero-slideshow-changed', mountHeroSlideshow);
  global.addEventListener('ifa:settings-lang-changed', mountHeroSlideshow);
  global.addEventListener('storage', function (e) {
    if (e.key === KEY) mountHeroSlideshow();
  });
})(typeof window !== 'undefined' ? window : this);
