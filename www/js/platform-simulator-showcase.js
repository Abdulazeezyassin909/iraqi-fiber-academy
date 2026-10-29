/**
 * Simulator showcase — localStorage CMS + landing-page rotation (#simulatorShowcase).
 */
(function (global) {
  'use strict';

  var SHOWCASE_KEY = 'ifa_simulator_showcase';
  var DEFAULT_INTERVAL_SEC = 5;
  var FADE_MS = 420;
  var MAX_SHOWCASE_IMAGE_BYTES = 900000;

  var SHOWCASE_CONFIG = [
    {
      id: 'ftth-simulator',
      screenTitle: 'FTTH Network Designer',
      activeTab: 'FTTH',
      theme: 'ftth',
      stats: [
        { value: '-18.5 dBm', label: 'Power Level' },
        { value: '0.02 dB', label: 'Splice Loss' },
        { value: '12.4 km', label: 'Fiber Length' },
      ],
    },
    {
      id: 'otdr-simulator',
      screenTitle: 'OTDR Trace Viewer',
      activeTab: 'OTDR',
      theme: 'otdr',
      stats: [
        { value: '2.4 km', label: 'Event @ 2.4km' },
        { value: '-0.35 dB', label: 'Splice Loss' },
        { value: '1310 nm', label: 'Wavelength' },
      ],
    },
    {
      id: 'power-meter',
      screenTitle: 'Optical Power Meter',
      activeTab: 'Power',
      theme: 'power',
      stats: [
        { value: '-22.1 dBm', label: 'RX Power' },
        { value: '1550 nm', label: 'Wavelength' },
        { value: 'PASS', label: 'GPON Check' },
      ],
    },
    {
      id: 'fusion-splicer',
      screenTitle: 'Fusion Splicer Lab',
      activeTab: 'Splice',
      theme: 'splice',
      stats: [
        { value: '0.01 dB', label: 'Est. Loss' },
        { value: '12.8 s', label: 'Arc Time' },
        { value: 'OK', label: 'Alignment' },
      ],
    },
    {
      id: 'fiber-anatomy',
      screenTitle: 'Fiber Cable Anatomy 3D',
      activeTab: 'Anatomy',
      theme: 'anatomy',
      stats: [
        { value: '288F', label: 'Max Count' },
        { value: '12F', label: 'Per Tube' },
        { value: 'T13–T24', label: 'Ribbon ID' },
      ],
    },
    {
      id: 'patch-panel-lab',
      screenTitle: 'FTTH Patch Panel Lab',
      activeTab: 'Patch',
      theme: 'patch',
      stats: [
        { value: '1:8', label: 'PLC Split' },
        { value: 'SC/APC', label: 'Connector' },
        { value: '-0.4 dB', label: 'Patch Loss' },
      ],
    },
  ];

  var TAB_LABELS = ['FTTH', 'OTDR', 'Power', 'Splice', 'Anatomy', 'Patch'];

  var timerId = null;
  var fadeTimerId = null;
  var currentIndex = 0;
  var paused = false;
  var items = [];

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function readShowcaseJson() {
    try {
      var raw = localStorage.getItem(SHOWCASE_KEY);
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (err) {
      return {};
    }
  }

  function normalizeIntervalSeconds(value) {
    var sec = Number(value);
    if (!isFinite(sec) || sec < 2) sec = DEFAULT_INTERVAL_SEC;
    if (sec > 60) sec = 60;
    return Math.round(sec);
  }

  function getIntervalSeconds() {
    var stored = readShowcaseJson();
    return normalizeIntervalSeconds(stored._intervalSeconds);
  }

  function getRotateMs() {
    return getIntervalSeconds() * 1000;
  }

  function writeShowcaseStore(slides, intervalSeconds) {
    var stored = readShowcaseJson();
    var toSave = {};
    toSave._intervalSeconds = normalizeIntervalSeconds(
      intervalSeconds != null ? intervalSeconds : stored._intervalSeconds
    );
    Object.keys(stored).forEach(function (key) {
      if (key.charAt(0) === '_') return;
      toSave[key] = normalizeShowcaseEntry(stored[key]);
    });
    var src = slides || {};
    Object.keys(src).forEach(function (id) {
      if (id.charAt(0) === '_') return;
      toSave[id] = normalizeShowcaseEntry(
        Object.assign({}, toSave[id] || defaultShowcaseEntry(), src[id])
      );
    });
    try {
      localStorage.setItem(SHOWCASE_KEY, JSON.stringify(toSave));
    } catch (err) {
      console.error('[SimulatorShowcase] save failed', err);
      return toSave;
    }
    try {
      global.dispatchEvent(
        new CustomEvent('ifa:simulator-showcase-changed', {
          detail: { slides: src, intervalSeconds: toSave._intervalSeconds },
        })
      );
    } catch (err2) {
      /* ignore */
    }
    return toSave;
  }

  function saveIntervalSeconds(seconds) {
    return writeShowcaseStore(getShowcaseMeta(), seconds);
  }

  function defaultShowcaseEntry() {
    return {
      title: '',
      description: '',
      showcaseImage: '',
      visibleInShowcase: true,
    };
  }

  function normalizeShowcaseEntry(raw) {
    var s = raw && typeof raw === 'object' ? raw : {};
    return {
      title: String(s.title || '').trim().slice(0, 200),
      description: String(s.description || '').trim().slice(0, 800),
      showcaseImage: String(s.showcaseImage || '').trim(),
      visibleInShowcase: s.visibleInShowcase !== false,
    };
  }

  function getShowcaseMeta() {
    var stored = readShowcaseJson();
    var out = {};
    if (global.PlatformSimulators && global.PlatformSimulators.CATALOG) {
      global.PlatformSimulators.CATALOG.forEach(function (sim) {
        out[sim.id] = normalizeShowcaseEntry(stored[sim.id]);
      });
      return out;
    }
    Object.keys(stored).forEach(function (key) {
      if (key.charAt(0) === '_') return;
      out[key] = normalizeShowcaseEntry(stored[key]);
    });
    return out;
  }

  function saveShowcaseMeta(partial) {
    var current = getShowcaseMeta();
    var incoming = partial && typeof partial === 'object' ? partial : {};
    Object.keys(incoming).forEach(function (id) {
      if (id.charAt(0) === '_') return;
      current[id] = normalizeShowcaseEntry(Object.assign({}, current[id] || defaultShowcaseEntry(), incoming[id]));
    });
    return writeShowcaseStore(current, null);
  }

  function isSimulatorUnderDevelopment(id) {
    if (
      global.PlatformSimulators &&
      typeof global.PlatformSimulators.isSimulatorUnderDevelopment === 'function'
    ) {
      return global.PlatformSimulators.isSimulatorUnderDevelopment(id);
    }
    return false;
  }

  function getExtras(id) {
    for (var i = 0; i < SHOWCASE_CONFIG.length; i++) {
      if (SHOWCASE_CONFIG[i].id === id) return SHOWCASE_CONFIG[i];
    }
    return null;
  }

  function buildShowcaseItems() {
    if (!global.PlatformSimulators) return [];
    var catalog = global.PlatformSimulators.getCatalog();
    var showcaseMeta = getShowcaseMeta();

    return catalog
      .map(function (sim) {
        var sm = showcaseMeta[sim.id] || defaultShowcaseEntry();
        var extras = getExtras(sim.id) || {};
        return {
          id: sim.id,
          title: sm.title || sim.label || sim.id,
          description: sm.description || sim.description || '',
          href: sim.href || '',
          icon: sim.icon || '◆',
          iconType: sim.iconType || 'emoji',
          showcaseImage: sm.showcaseImage || '',
          visibleInShowcase: sm.visibleInShowcase !== false,
          underDevelopment: isSimulatorUnderDevelopment(sim.id),
          screenTitle: extras.screenTitle || sim.navLabel || sim.label,
          activeTab: extras.activeTab || 'Sim',
          theme: extras.theme || 'ftth',
          stats: Array.isArray(extras.stats) ? extras.stats : [],
        };
      })
      .filter(function (item) {
        return item.visibleInShowcase;
      });
  }

  function buildToolbarHtml(activeTab) {
    return TAB_LABELS.map(function (label) {
      return (
        '<span class="demo__mock-btn' +
        (label === activeTab ? ' demo__mock-btn--active' : '') +
        '">' +
        escapeHtml(label) +
        '</span>'
      );
    }).join('');
  }

  function buildStatsHtml(stats) {
    if (!stats.length) return '';
    return stats
      .map(function (stat) {
        return (
          '<div class="demo__mock-stat"><div class="demo__mock-stat-value">' +
          escapeHtml(stat.value) +
          '</div><div class="demo__mock-stat-label">' +
          escapeHtml(stat.label) +
          '</div></div>'
        );
      })
      .join('');
  }

  function isIconImageSrc(icon) {
    var s = String(icon || '').trim();
    return (
      /^https?:\/\//i.test(s) ||
      s.indexOf('firebasestorage.googleapis.com') !== -1
    );
  }

  function buildVisualHtml(item) {
    if (item.showcaseImage) {
      return (
        '<div class="sim-showcase__visual-inner sim-showcase__visual-inner--photo">' +
        '<img class="sim-showcase__visual-photo" src="' +
        String(item.showcaseImage).replace(/"/g, '&quot;') +
        '" alt="' +
        escapeHtml(item.title) +
        '" loading="lazy" decoding="async" />' +
        '</div>'
      );
    }
    var useImageIcon = (item.iconType === 'image' || isIconImageSrc(item.icon)) && item.icon;
    var icon = useImageIcon
      ? '<img class="sim-showcase__visual-icon-img" src="' + escapeHtml(item.icon) + '" alt="" />'
      : '<span class="sim-showcase__visual-icon">' + escapeHtml(item.icon) + '</span>';
    return (
      '<div class="sim-showcase__visual-inner sim-showcase__visual-inner--' +
      escapeHtml(item.theme) +
      '">' +
      icon +
      '<span class="sim-showcase__visual-label">' +
      escapeHtml(item.activeTab) +
      '</span></div>'
    );
  }

  function resolveHref(item) {
    if (!item.href) return '#simulators';
    if (
      global.PlatformSimulators &&
      typeof global.PlatformSimulators.viewerCanAccess === 'function' &&
      !global.PlatformSimulators.viewerCanAccess(item.id) &&
      !item.underDevelopment
    ) {
      return '#simulators';
    }
    return item.href;
  }

  function applyShowcaseItem(item, animate) {
    var copy = document.getElementById('simShowcaseCopy');
    var screen = document.getElementById('simShowcaseScreen');
    var titleEl = document.getElementById('simShowcaseTitle');
    var descEl = document.getElementById('simShowcaseDesc');
    var ctaEl = document.getElementById('simShowcaseCta');
    var screenTitleEl = document.getElementById('simShowcaseScreenTitle');
    var toolbarEl = document.getElementById('simShowcaseToolbar');
    var visualEl = document.getElementById('simShowcaseVisual');
    var statsEl = document.getElementById('simShowcaseStats');
    var soonEl = document.getElementById('simShowcaseSoon');
    if (!copy || !item) return;

    var underDev = !!item.underDevelopment;
    if (
      global.PlatformSimulators &&
      typeof global.PlatformSimulators.isSimulatorUnderDevelopment === 'function'
    ) {
      underDev = global.PlatformSimulators.isSimulatorUnderDevelopment(item.id);
    }

    function paint() {
      if (titleEl) titleEl.textContent = item.title;
      if (descEl) descEl.textContent = item.description;
      if (screenTitleEl) screenTitleEl.textContent = item.screenTitle;
      if (toolbarEl) toolbarEl.innerHTML = buildToolbarHtml(item.activeTab);
      if (visualEl) {
        visualEl.className = 'sim-showcase__visual sim-showcase__visual--' + item.theme;
        visualEl.innerHTML = buildVisualHtml(item);
      }
      if (statsEl) statsEl.innerHTML = buildStatsHtml(item.stats);
      if (ctaEl) {
        ctaEl.setAttribute('data-simulator-launch', item.id);
        ctaEl.href = resolveHref(item);
        if (underDev) {
          ctaEl.textContent = 'قيد التطوير';
          ctaEl.classList.add('sim-showcase__cta--soon');
        } else {
          ctaEl.textContent = 'Try Simulator';
          ctaEl.classList.remove('sim-showcase__cta--soon');
        }
      }
      if (soonEl) {
        soonEl.hidden = !underDev;
        if (underDev) {
          var badge =
            global.PlatformSimulators && global.PlatformSimulators.COMING_SOON_BADGE
              ? global.PlatformSimulators.COMING_SOON_BADGE
              : 'قريباً — قيد التطوير';
          var span = soonEl.querySelector('span');
          if (span) span.textContent = badge;
        }
      }
      if (screen) screen.classList.toggle('sim-showcase__screen--soon', underDev);
    }

    if (!animate) {
      paint();
      return;
    }

    copy.classList.add('is-fading');
    if (screen) screen.classList.add('is-fading');
    if (fadeTimerId) clearTimeout(fadeTimerId);
    fadeTimerId = setTimeout(function () {
      paint();
      copy.classList.remove('is-fading');
      if (screen) screen.classList.remove('is-fading');
    }, FADE_MS);
  }

  function goTo(index, animate) {
    if (!items.length) return;
    currentIndex = ((index % items.length) + items.length) % items.length;
    applyShowcaseItem(items[currentIndex], animate !== false);
  }

  function stopTimer() {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  function startTimer() {
    stopTimer();
    if (paused || items.length < 2) return;
    timerId = setInterval(function () {
      goTo(currentIndex + 1, true);
    }, getRotateMs());
  }

  function restartShowcaseTimer() {
    stopTimer();
    startTimer();
  }

  function bindHoldToPause(root) {
    var holdActive = false;

    function isInteractiveTarget(target) {
      if (!target || !target.closest) return false;
      return !!target.closest(
        'a, button, input, select, textarea, label, [data-simulator-launch]'
      );
    }

    function isEmptyShowcaseSpace(target) {
      if (!target || !root.contains(target)) return false;
      return !isInteractiveTarget(target);
    }

    function onHoldStart(e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (!isEmptyShowcaseSpace(e.target)) return;
      holdActive = true;
      paused = true;
      stopTimer();
    }

    function onHoldEnd() {
      if (!holdActive) return;
      holdActive = false;
      paused = false;
      startTimer();
    }

    root.addEventListener('pointerdown', onHoldStart);
    document.addEventListener('pointerup', onHoldEnd);
    document.addEventListener('pointercancel', onHoldEnd);
  }

  function mountSimulatorShowcase() {
    var root = document.getElementById('simulatorShowcase');
    if (!root) return;

    var prevId = items.length && items[currentIndex] ? items[currentIndex].id : '';
    items = buildShowcaseItems();

    if (!items.length) {
      stopTimer();
      return;
    }

    if (prevId) {
      var nextIdx = 0;
      items.forEach(function (item, i) {
        if (item.id === prevId) nextIdx = i;
      });
      currentIndex = nextIdx;
    } else if (currentIndex >= items.length) {
      currentIndex = 0;
    }

    goTo(currentIndex, false);
    startTimer();

    if (root.dataset.bound === '1') return;
    root.dataset.bound = '1';

    bindHoldToPause(root);
  }

  global.PlatformSimulatorShowcase = {
    SHOWCASE_KEY: SHOWCASE_KEY,
    SHOWCASE_CONFIG: SHOWCASE_CONFIG,
    MAX_SHOWCASE_IMAGE_BYTES: MAX_SHOWCASE_IMAGE_BYTES,
    DEFAULT_INTERVAL_SEC: DEFAULT_INTERVAL_SEC,
    defaultShowcaseEntry: defaultShowcaseEntry,
    getIntervalSeconds: getIntervalSeconds,
    getRotateMs: getRotateMs,
    saveIntervalSeconds: saveIntervalSeconds,
    getShowcaseMeta: getShowcaseMeta,
    saveShowcaseMeta: saveShowcaseMeta,
    buildShowcaseItems: buildShowcaseItems,
    mountSimulatorShowcase: mountSimulatorShowcase,
    restartShowcaseTimer: restartShowcaseTimer,
  };

  function boot() {
    mountSimulatorShowcase();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  global.addEventListener('ifa:simulator-showcase-changed', mountSimulatorShowcase);
  global.addEventListener('ifa:simulators-meta-changed', mountSimulatorShowcase);
  global.addEventListener('ifa:platform-settings-changed', mountSimulatorShowcase);
  global.addEventListener('ifa:simulators-firestore-changed', mountSimulatorShowcase);
  document.addEventListener('ifa:simulators-firestore-changed', mountSimulatorShowcase);
  if (global.PlatformSimulatorsFirestore && typeof global.PlatformSimulatorsFirestore.subscribe === 'function') {
    global.PlatformSimulatorsFirestore.subscribe(function () {
      mountSimulatorShowcase();
    });
  }
  global.addEventListener('storage', function (e) {
    if (
      !e.key ||
      e.key === SHOWCASE_KEY ||
      e.key === 'ifa_simulators_meta' ||
      e.key === 'ifa_platform_settings'
    ) {
      mountSimulatorShowcase();
    }
  });
})(typeof window !== 'undefined' ? window : this);
