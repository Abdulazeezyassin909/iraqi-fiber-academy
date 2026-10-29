/**
 * Shared 6-simulator catalog, course/plan access helpers, and public homepage gating.
 */
(function (global) {
  'use strict';

  var AUTH_KEY = 'ifa_auth_user';
  var USERS_KEY = 'ifa_admin_users';
  var SETTINGS_KEY = 'ifa_platform_settings';
  var META_KEY = 'ifa_simulators_meta';
  var ADMIN_EMAILS = ['abdulazizyassin909@gmail.com'];
  var firestorePlanCache = {};
  var warmEntitlementPromise = null;

  var SIMULATOR_CATALOG = [
    {
      id: 'ftth-simulator',
      label: 'محاكي FTTH متكامل',
      navLabel: 'FTTH Map Sim',
      href: 'simulator.html',
    },
    {
      id: 'otdr-simulator',
      label: 'مختبر OTDR (OTDR Lab)',
      navLabel: 'OTDR',
      href: 'otdr-lab.html',
    },
    {
      id: 'power-meter',
      label: 'قياس القدرة البصرية',
      navLabel: 'Power Meter',
      href: 'power-meter.html',
    },
    {
      id: 'fusion-splicer',
      label: 'مختبر لحام الألياف الضوئية (Fusion Splicer Lab)',
      navLabel: 'Fusion Splicer',
      href: 'fusion-splicer.html',
    },
    {
      id: 'fiber-anatomy',
      label: 'تشريح الألياف 3D / 2D',
      navLabel: 'Cable Anatomy',
      href: 'fiber-3d-simulator.html',
    },
    {
      id: 'patch-panel-lab',
      label: 'محاكي FTTH Network & Patch Panel',
      navLabel: 'FTTH Lab',
      href: 'ftth-lab.html',
    },
  ];

  var PAYWALL_TOAST_MSG = 'يتطلب فتح هذا المحاكي الاشتراك في باقة تدريبية';
  var PAYWALL_PLAN_KEY = 'ifa_paywall_plan';
  var PAYWALL_SIM_KEY = 'ifa_paywall_sim';
  var TRIAL_KICKOUT_FLAG = 'ifa_trial_kickout';
  var TRIAL_EXPIRED_REDIRECT_MSG = 'انتهت تجربتك المجانية. جاري تحويلك إلى الباقات…';
  var TRIAL_KICKOUT_DELAY_MS = 2000;
  var trialKickoutInFlight = false;

  var ALLOWED_IDS = {};
  SIMULATOR_CATALOG.forEach(function (s) {
    ALLOWED_IDS[s.id] = s;
  });

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function normalizeEmail(email) {
    return String(email || '')
      .trim()
      .toLowerCase();
  }

  function readJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch (err) {
      return fallback;
    }
  }

  function defaultSimulatorMeta() {
    return {
      'ftth-simulator': {
        title: 'محاكي FTTH متكامل',
        description:
          'صمّم واربط شبكات الألياف الضوئية من OLT حتى منزل المشترك مع محاكاة واقعية لكل مكوّن في الشبكة.',
        icon: '🌐',
        iconType: 'emoji',
      },
      'otdr-simulator': {
        title: 'مختبر OTDR (OTDR Lab)',
        description:
          'ورشة OTDR كاملة بنفس مختبر لحام الألياف: بناء الشبكة، اللحام، القطع، ثم إضافة منحنيات الانعكاس واختبارات OTDR.',
        icon: '📊',
        iconType: 'emoji',
      },
      'power-meter': {
        title: 'قياس القدرة البصرية',
        description:
          'مدرّب OPM احترافي: أطوال موجية 1310/1490/1550، تحويل dBm↔mW، مرجع الخسارة، ومؤشرات Pass/Warning/Fail وفق GPON و EPON — مع ورشة ربط مصغّرة (Patch Cord · Pigtail · Splitter) لاختبار المسارات مباشرة بجانب جهاز القياس.',
        icon: '⚡',
        iconType: 'emoji',
      },
      'fusion-splicer': {
        title: 'مختبر لحام الألياف الضوئية (Fusion Splicer Lab)',
        description:
          'تعلّم عمليات اللحام البصري (Fusion Splicing) وإدارة الكابلات والموصلات بطريقة تفاعلية خطوة بخطوة.',
        icon: '🔬',
        iconType: 'emoji',
      },
      'fiber-anatomy': {
        title: 'Fiber Optics 3D / 2D Interactive Anatomy',
        description:
          'شرّح كابلات Last Mile وFTTH حتى 288F: الغلاف → الأنابيب → 6 أو 12 ليف لكل أنبوب، مع تمييز 48F Last Mile و48F Feeder، وعلامات الشريط الأوسط لأنابيب T13–T24 في كابل 288F.',
        icon: '🧬',
        iconType: 'emoji',
      },
      'patch-panel-lab': {
        title: 'FTTH Network & Patch Panel Lab',
        description:
          'مختبر FTTH: مقسمات PLC، أسلاك Patch Cord بطرفي A وB بنفس منطق السحب اليدوي (بدون تتبع تلقائي)، يُحفظ المسار عند الإطباق (SC/APC أخضر · SC/PC أزرق)، مع تنبيه عدم التوافق وخصم خسارة إضافي دون حظر التوصيل.',
        icon: '🔌',
        iconType: 'emoji',
      },
    };
  }

  function isIconImageSrc(icon) {
    var s = String(icon || '').trim();
    return (
      /^https?:\/\//i.test(s) ||
      s.indexOf('firebasestorage.googleapis.com') !== -1
    );
  }

  function getSimulatorMeta() {
    var stored = readJson(META_KEY, {});
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) stored = {};
    var defaults = defaultSimulatorMeta();
    var out = {};
    SIMULATOR_CATALOG.forEach(function (s) {
      var d = defaults[s.id] || {};
      var m = stored[s.id] || {};
      var icon = String(m.icon != null ? m.icon : d.icon || '◆');
      var iconType =
        m.iconType === 'image' || isIconImageSrc(icon) ? 'image' : 'emoji';
      out[s.id] = {
        title: String(m.title != null ? m.title : d.title || s.label).trim() || s.label,
        description: String(m.description != null ? m.description : d.description || '').trim(),
        icon: icon,
        iconType: iconType,
      };
    });
    return out;
  }

  function saveSimulatorMeta(partial) {
    var current = getSimulatorMeta();
    var incoming = partial && typeof partial === 'object' ? partial : {};
    SIMULATOR_CATALOG.forEach(function (s) {
      if (!incoming[s.id]) return;
      var m = incoming[s.id];
      current[s.id] = {
        title: String(m.title != null ? m.title : current[s.id].title).trim() || current[s.id].title,
        description: String(m.description != null ? m.description : current[s.id].description),
        icon: String(m.icon != null ? m.icon : current[s.id].icon),
        iconType:
          m.iconType === 'image' || isIconImageSrc(m.icon != null ? m.icon : current[s.id].icon)
            ? 'image'
            : 'emoji',
      };
    });
    try {
      localStorage.setItem(META_KEY, JSON.stringify(current));
    } catch (err) {
      console.error('[PlatformSimulators] meta save failed', err);
    }
    applySimulatorMetaToCards();
    try {
      global.dispatchEvent(new CustomEvent('ifa:simulators-meta-changed', { detail: current }));
    } catch (err2) {
      /* ignore */
    }
    return current;
  }

  function iconHtml(meta) {
    if (!meta) return '◆';
    var icon = meta.icon || '';
    var useImage = (meta.iconType === 'image' || isIconImageSrc(icon)) && icon;
    if (useImage) {
      return '<img class="feature-card__icon-img" src="' + escapeHtml(icon) + '" alt="" />';
    }
    return escapeHtml(icon || '◆');
  }

  function applySimulatorMetaToCards() {
    var metaMap = getSimulatorMeta();
    document.querySelectorAll('[data-simulator-card][data-simulator-id]').forEach(function (card) {
      var id = card.getAttribute('data-simulator-id') || '';
      var meta = metaMap[id];
      if (!meta) return;
      card.classList.remove('feature-card--power-meter');
      var iconEl = card.querySelector('.feature-card__icon');
      var titleEl = card.querySelector('.feature-card__title');
      var descEl = card.querySelector('.feature-card__desc');
      if (iconEl) iconEl.innerHTML = iconHtml(meta);
      if (titleEl) titleEl.textContent = meta.title;
      if (descEl) descEl.textContent = meta.description;
    });
  }

  function getCatalog() {
    var meta = getSimulatorMeta();
    return SIMULATOR_CATALOG.map(function (s) {
      var m = meta[s.id] || {};
      return Object.assign({}, s, {
        label: m.title || s.label,
        description: m.description || '',
        icon: m.icon,
        iconType: m.iconType,
      });
    });
  }

  function findSimulator(id) {
    var base = ALLOWED_IDS[String(id || '')] || null;
    if (!base) return null;
    var meta = getSimulatorMeta()[base.id];
    if (!meta) return Object.assign({}, base);
    return Object.assign({}, base, {
      label: meta.title || base.label,
      description: meta.description || '',
      icon: meta.icon,
      iconType: meta.iconType,
    });
  }

  function normalizeSimulatorIds(list) {
    if (!Array.isArray(list)) return [];
    var out = [];
    var seen = {};
    list.forEach(function (item) {
      var id = String(item || '').trim();
      if (!ALLOWED_IDS[id] || seen[id]) return;
      seen[id] = true;
      out.push(id);
    });
    return out;
  }

  function simulatorLabels(ids) {
    return normalizeSimulatorIds(ids).map(function (id) {
      var sim = findSimulator(id);
      return (sim && sim.label) || ALLOWED_IDS[id].label;
    });
  }

  function isAdminPreviewContext() {
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

  function getLocalAuthUser() {
    if (global.IFAAuth && typeof global.IFAAuth.getLocalAuthUser === 'function') {
      return global.IFAAuth.getLocalAuthUser();
    }
    var parsed = readJson(AUTH_KEY, null);
    if (!parsed || !normalizeEmail(parsed.email)) return null;
    return {
      name: String(parsed.name || '').trim() || String(parsed.email).split('@')[0],
      email: normalizeEmail(parsed.email),
      photoURL: String(parsed.photoURL || ''),
      isSubscriber: !!parsed.isSubscriber,
      isAdmin: !!parsed.isAdmin,
      isInstructor: !!parsed.isInstructor,
      role: String(parsed.role || ''),
      planId: String(parsed.planId || ''),
      enrolledCourseIds: Array.isArray(parsed.enrolledCourseIds) ? parsed.enrolledCourseIds : [],
      allowedSimulators: Array.isArray(parsed.allowedSimulators) ? parsed.allowedSimulators : [],
      trialExpiresAt: Number(parsed.trialExpiresAt) || 0,
    };
  }

  var COMING_SOON_MSG = 'هذا المحاكي قيد التطوير حالياً — سيتوفر قريباً';
  var COMING_SOON_BADGE = 'قريباً — قيد التطوير';

  function normalizeFreeTrialDays(value) {
    var days = parseFloat(value);
    if (!isFinite(days) || days <= 0) return 0;
    return Math.min(365, days);
  }

  function defaultPlatformSettings() {
    return {
      freeSimulatorIds: [],
      comingSoonSimulatorIds: [],
      freeTrialDays: 0,
      trialAnnouncementText: '',
      globalOfferEnabled: false,
      globalOfferText: '',
      globalOfferEndsAt: '',
    };
  }

  function normalizeBannerOfferEndsAt(value) {
    if (value == null || value === '') return '';
    var ms = typeof value === 'number' ? value : Date.parse(String(value));
    if (!isFinite(ms) || ms <= 0) return '';
    try {
      return new Date(ms).toISOString();
    } catch (err) {
      return '';
    }
  }

  function normalizeBannerTimerEnabled(raw) {
    if (raw && typeof raw === 'object' && raw.bannerTimerEnabled != null) {
      return !!raw.bannerTimerEnabled;
    }
    if (raw && raw.bannerTimerMode === 'global_offer' && normalizeBannerOfferEndsAt(raw.bannerOfferEndsAt)) {
      return true;
    }
    return false;
  }

  function normalizeTopBannerFields(src) {
    var raw = src && typeof src === 'object' ? src : {};
    var trialAnnouncementText = String(raw.trialAnnouncementText || '').trim().slice(0, 500);
    var globalOfferText = String(raw.globalOfferText || '').trim().slice(0, 500);
    var globalOfferEndsAt = normalizeBannerOfferEndsAt(raw.globalOfferEndsAt);
    var globalOfferEnabled = raw.globalOfferEnabled;

    if (globalOfferEnabled == null) {
      var legacyEnds = normalizeBannerOfferEndsAt(raw.bannerOfferEndsAt);
      var timerOn = normalizeBannerTimerEnabled(raw);
      globalOfferEnabled = !!raw.announcementEnabled || (timerOn && !!legacyEnds);
      if (!globalOfferText && raw.announcementText) {
        globalOfferText = String(raw.announcementText).trim().slice(0, 500);
      }
      if (!globalOfferEndsAt && legacyEnds) {
        globalOfferEndsAt = legacyEnds;
      }
    }

    return {
      trialAnnouncementText: trialAnnouncementText,
      globalOfferEnabled: !!globalOfferEnabled,
      globalOfferText: globalOfferText,
      globalOfferEndsAt: globalOfferEndsAt,
    };
  }

  function getPlatformSettings() {
    var parsed = readJson(SETTINGS_KEY, null);
    var base = defaultPlatformSettings();
    if (!parsed || typeof parsed !== 'object') return base;
    base.freeSimulatorIds = normalizeSimulatorIds(parsed.freeSimulatorIds);
    base.comingSoonSimulatorIds = normalizeSimulatorIds(parsed.comingSoonSimulatorIds);
    base.freeTrialDays = normalizeFreeTrialDays(parsed.freeTrialDays);
    var banner = normalizeTopBannerFields(parsed);
    base.trialAnnouncementText = banner.trialAnnouncementText;
    base.globalOfferEnabled = banner.globalOfferEnabled;
    base.globalOfferText = banner.globalOfferText;
    base.globalOfferEndsAt = banner.globalOfferEndsAt;
    return base;
  }

  function savePlatformSettings(patch) {
    var next = Object.assign(defaultPlatformSettings(), getPlatformSettings(), patch || {});
    next.freeSimulatorIds = normalizeSimulatorIds(next.freeSimulatorIds);
    next.comingSoonSimulatorIds = normalizeSimulatorIds(next.comingSoonSimulatorIds);
    next.freeTrialDays = normalizeFreeTrialDays(next.freeTrialDays);
    var banner = normalizeTopBannerFields(next);
    next.trialAnnouncementText = banner.trialAnnouncementText;
    next.globalOfferEnabled = banner.globalOfferEnabled;
    next.globalOfferText = banner.globalOfferText;
    next.globalOfferEndsAt = banner.globalOfferEndsAt;
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch (err) {
      console.error('[PlatformSimulators] settings save failed', err);
    }
    try {
      global.dispatchEvent(new CustomEvent('ifa:platform-settings-changed', { detail: next }));
    } catch (err2) {
      /* ignore */
    }
    return next;
  }

  function getTrialTierSimulatorIds() {
    return getPlatformSettings().freeSimulatorIds.slice();
  }

  function isTrialTierSimulator(simulatorId) {
    return getTrialTierSimulatorIds().indexOf(String(simulatorId || '')) !== -1;
  }

  /** @deprecated Use isTrialTierSimulator — list is trial-tier, not permanently free. */
  function isGloballyFreeSimulator(simulatorId) {
    return isTrialTierSimulator(simulatorId);
  }

  function isSimulatorUnderDevelopment(simulatorId) {
    return getPlatformSettings().comingSoonSimulatorIds.indexOf(String(simulatorId || '')) !== -1;
  }

  function trialExpiryMs(user) {
    if (!user) return 0;
    var t = user.trialExpiresAt;
    if (t == null || t === '') return 0;
    var n = typeof t === 'number' ? t : Date.parse(t);
    return isFinite(n) ? n : 0;
  }

  function hasActiveTrial(user) {
    return trialExpiryMs(user) > Date.now();
  }

  function hasActiveTrialForAccess(authUser) {
    if (!authUser) return false;
    var settings = getPlatformSettings();
    if (global.IFAAuth && typeof global.IFAAuth.getTrialExpiryMs === 'function') {
      return global.IFAAuth.getTrialExpiryMs(authUser, settings) > Date.now();
    }
    if (global.IFAAuth && typeof global.IFAAuth.hasActiveTrial === 'function') {
      return global.IFAAuth.hasActiveTrial(authUser, settings);
    }
    return hasActiveTrial(authUser);
  }

  function isGlobalPlatformSubscriber(authUser) {
    return !!(authUser && authUser.isSubscriber === true);
  }

  function canAccessFullTrialTierPool(authUser, directoryUser) {
    if (!authUser) return false;
    if (isPrivilegedRole(authUser, directoryUser)) return true;
    if (hasActiveTrialForAccess(authUser)) return true;
    if (isGlobalPlatformSubscriber(authUser)) return true;
    return false;
  }

  function canAccessTrialTierSimulators(authUser, directoryUser) {
    return canAccessFullTrialTierPool(authUser, directoryUser);
  }

  function mergeTrialTierSimulatorIds(ids, authUser, directoryUser) {
    var out = ids.slice();
    if (!canAccessFullTrialTierPool(authUser, directoryUser)) return out;
    getTrialTierSimulatorIds().forEach(function (trialId) {
      if (out.indexOf(trialId) === -1) out.push(trialId);
    });
    return out;
  }

  function findDirectoryUser(email) {
    var key = normalizeEmail(email);
    if (!key) return null;
    if (global.AdminUsers && typeof global.AdminUsers.getUsers === 'function') {
      var fromAdmin = global.AdminUsers.getUsers();
      for (var i = 0; i < fromAdmin.length; i++) {
        if (normalizeEmail(fromAdmin[i].email) === key) return fromAdmin[i];
      }
    }
    var list = readJson(USERS_KEY, []);
    if (!Array.isArray(list)) return null;
    for (var j = 0; j < list.length; j++) {
      if (normalizeEmail(list[j] && list[j].email) === key) return list[j];
    }
    return null;
  }

  function isPrivilegedRole(authUser, directoryUser) {
    var role = String(
      (directoryUser && directoryUser.role) || (authUser && authUser.role) || ''
    ).toLowerCase();
    if (role === 'admin' || role === 'instructor') return true;
    if (authUser && (authUser.isAdmin || authUser.isInstructor)) {
      if (directoryUser && String(directoryUser.role || '').toLowerCase() === 'student') {
        return false;
      }
      return true;
    }
    var email = normalizeEmail((directoryUser && directoryUser.email) || (authUser && authUser.email));
    return ADMIN_EMAILS.indexOf(email) !== -1;
  }

  function getPublishedCourses() {
    if (global.PlatformCourses && typeof global.PlatformCourses.getPublished === 'function') {
      return global.PlatformCourses.getPublished();
    }
    var list = readJson('platform_courses', []);
    if (!Array.isArray(list)) return [];
    return list.filter(function (c) {
      return c && c.status === 'published' && !c.softDeleted;
    });
  }

  function getPlans() {
    if (global.PlatformPlans && typeof global.PlatformPlans.getCatalogPricingPlans === 'function') {
      return global.PlatformPlans.getCatalogPricingPlans();
    }
    if (global.PlatformPlans && typeof global.PlatformPlans.getPlans === 'function') {
      return global.PlatformPlans.getPlans();
    }
    var primary = readJson('platform_plans', null);
    var alias = readJson('ifa_pricing_plans', null);
    var list = Array.isArray(primary) && primary.length ? primary : alias;
    if (!Array.isArray(list)) return [];
    if (global.PlatformPlans && typeof global.PlatformPlans.isLegacyTierPlan === 'function') {
      return list.filter(function (plan) {
        return plan && !global.PlatformPlans.isLegacyTierPlan(plan);
      });
    }
    return list;
  }

  function cacheFirestorePlan(planId, planData) {
    var key = String(planId || '');
    if (!key || !planData) return null;
    var plan = Object.assign({ id: key }, planData);
    firestorePlanCache[key] = plan;
    return plan;
  }

  function ensurePlanCached(planId) {
    var key = String(planId || '');
    if (!key) return Promise.resolve(null);
    var existing = findPlan(key);
    if (existing) return Promise.resolve(existing);
    if (firestorePlanCache[key]) return Promise.resolve(firestorePlanCache[key]);

    return import('./firebase-config.js')
      .then(function (mod) {
        return import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js').then(function (fs) {
          return fs.getDoc(fs.doc(mod.db, 'pricing', key)).then(function (snap) {
            if (!snap.exists()) return null;
            return cacheFirestorePlan(key, snap.data());
          });
        });
      })
      .catch(function (err) {
        console.warn('[PlatformSimulators] ensurePlanCached failed for', key, err);
        return null;
      });
  }

  function resolvePlanIdForUser(authUser, directoryUser) {
    return String(
      (directoryUser && (directoryUser.planId || directoryUser.subscribedPlanId)) ||
        (authUser && authUser.planId) ||
        ''
    );
  }

  function warmEntitlementCaches(authUser, directoryUser) {
    var planId = resolvePlanIdForUser(authUser, directoryUser);
    if (!planId) return Promise.resolve(null);
    if (warmEntitlementPromise) return warmEntitlementPromise;
    warmEntitlementPromise = ensurePlanCached(planId).finally(function () {
      warmEntitlementPromise = null;
    });
    return warmEntitlementPromise;
  }

  function findPlan(id) {
    var key = String(id || '');
    if (!key) return null;
    if (firestorePlanCache[key]) return firestorePlanCache[key];
    if (global.PlatformPlans && typeof global.PlatformPlans.findPlan === 'function') {
      var fromApi = global.PlatformPlans.findPlan(key);
      if (fromApi) return fromApi;
    }
    if (
      global.PlatformPricingFirestore &&
      typeof global.PlatformPricingFirestore.findPlan === 'function'
    ) {
      var fromFs = global.PlatformPricingFirestore.findPlan(key);
      if (fromFs) return fromFs;
    }
    var plans = getPlans();
    for (var i = 0; i < plans.length; i++) {
      if (String(plans[i].id) === key) return plans[i];
    }
    return null;
  }

  function findCourse(id) {
    var key = String(id || '');
    if (!key) return null;
    if (global.PlatformCourses && typeof global.PlatformCourses.findCourse === 'function') {
      return global.PlatformCourses.findCourse(key);
    }
    var list = getPublishedCourses();
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].id) === key) return list[i];
    }
    return null;
  }

  function simulatorsFromCourse(course) {
    if (!course) return [];
    return normalizeSimulatorIds(course.allowedSimulators);
  }

  function simulatorsFromPlan(plan) {
    if (!plan) return [];
    var fromPlan = normalizeSimulatorIds(plan.allowedSimulators);
    if (fromPlan.length) return fromPlan;
    var union = [];
    var seen = {};
    getPublishedCourses().forEach(function (course) {
      var linked =
        course.requiredPlanId && String(course.requiredPlanId) === String(plan.id);
      var matches =
        linked ||
        (global.PlatformPlans &&
          typeof global.PlatformPlans.courseMatchesPlan === 'function' &&
          global.PlatformPlans.courseMatchesPlan(course, plan));
      if (!matches) return;
      simulatorsFromCourse(course).forEach(function (id) {
        if (seen[id]) return;
        seen[id] = true;
        union.push(id);
      });
    });
    return union;
  }

  function courseUnlockingSimulator(simulatorId) {
    var id = String(simulatorId || '');
    var courses = getPublishedCourses();
    for (var i = 0; i < courses.length; i++) {
      if (simulatorsFromCourse(courses[i]).indexOf(id) !== -1) return courses[i];
    }
    var all =
      global.PlatformCourses && typeof global.PlatformCourses.getCourses === 'function'
        ? global.PlatformCourses.getCourses()
        : readJson('platform_courses', []);
    if (!Array.isArray(all)) return null;
    for (var j = 0; j < all.length; j++) {
      var c = all[j];
      if (!c || c.softDeleted) continue;
      if (simulatorsFromCourse(c).indexOf(id) !== -1) return c;
    }
    return null;
  }

  function lockLabelForSimulator(simulatorId) {
    return PAYWALL_TOAST_MSG;
  }

  function recommendedPlanForSimulator(simulatorId) {
    var id = String(simulatorId || '');
    var plans = getPlans();
    var matches = [];
    plans.forEach(function (plan) {
      if (simulatorsFromPlan(plan).indexOf(id) !== -1) matches.push(plan);
    });
    matches.sort(function (a, b) {
      var rank = (a.accessRank || 0) - (b.accessRank || 0);
      if (rank) return rank;
      return (Number(a.price) || 0) - (Number(b.price) || 0);
    });
    if (matches.length) return matches[0];
    for (var i = 0; i < plans.length; i++) {
      if (plans[i].featured) return plans[i];
    }
    return plans[0] || null;
  }

  function currentPageFile() {
    try {
      var path = String(global.location.pathname || '').replace(/\\/g, '/');
      var file = path.split('/').pop() || '';
      if (!file && global.location.href) {
        file = String(global.location.href).split('/').pop().split('?')[0].split('#')[0];
      }
      return decodeURIComponent(file).toLowerCase();
    } catch (err) {
      return '';
    }
  }

  /** Strip .html so Cloudflare pretty URLs (e.g. /simulator) match catalog hrefs (simulator.html). */
  function normalizeSimulatorPageSlug(pageName) {
    var slug = String(pageName || '')
      .split('?')[0]
      .split('#')[0]
      .toLowerCase()
      .trim();
    if (slug.endsWith('.html')) slug = slug.slice(0, -5);
    return slug;
  }

  function simulatorCatalogHrefSlug(href) {
    return normalizeSimulatorPageSlug(
      String(href || '')
        .split('/')
        .pop()
    );
  }

  function currentPageSlug() {
    return normalizeSimulatorPageSlug(currentPageFile());
  }

  function currentSimulatorIdFromLocation() {
    var slug = currentPageSlug();
    if (!slug) return '';

    if (slug === 'simulator') {
      return 'ftth-simulator';
    }

    for (var i = 0; i < SIMULATOR_CATALOG.length; i++) {
      var hrefSlug = simulatorCatalogHrefSlug(SIMULATOR_CATALOG[i].href);
      if (hrefSlug && hrefSlug === slug) return SIMULATOR_CATALOG[i].id;
    }
    return '';
  }

  function isOnSimulatorEnvironmentPage() {
    return !!currentSimulatorIdFromLocation();
  }

  function isOnHomeOrCatalogPage() {
    var file = currentPageFile();
    if (file === 'index.html' || file === '') return true;
    return !currentSimulatorIdFromLocation();
  }

  var homePaywallUrlStripped = false;

  function stripHomePaywallUrlFromAddressBar() {
    if (homePaywallUrlStripped) return;
    if (!isOnHomeOrCatalogPage()) return;
    var file = currentPageFile();
    if (file !== 'index.html' && file !== '') return;
    var search = String(global.location.search || '');
    var hash = String(global.location.hash || '');
    var needsStrip =
      search.indexOf('needSim=') !== -1 ||
      search.indexOf('highlightPlan=') !== -1 ||
      hash === '#plans' ||
      hash === '#pricing';
    if (!needsStrip) return;
    try {
      var clean = global.location.pathname || 'index.html';
      if (!clean || clean === '/') clean = '/index.html';
      global.history.replaceState(null, document.title, clean);
      homePaywallUrlStripped = true;
    } catch (err) {
      /* ignore */
    }
  }

  function showPaywallNotice(message) {
    var text = message || PAYWALL_TOAST_MSG;
    var el = document.getElementById('ifa-paywall-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ifa-paywall-toast';
      el.className = 'ifa-paywall-toast';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add('is-visible');
    if (el._hideTimer) clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(function () {
      el.classList.remove('is-visible');
    }, 3400);
  }

  function paywallRedirectUrl(simulatorId) {
    var plan = recommendedPlanForSimulator(simulatorId);
    try {
      if (plan) sessionStorage.setItem(PAYWALL_PLAN_KEY, String(plan.id));
      sessionStorage.setItem(PAYWALL_SIM_KEY, String(simulatorId || ''));
    } catch (err) {
      /* ignore */
    }
    var qs = 'needSim=' + encodeURIComponent(simulatorId || '');
    if (plan) qs += '&highlightPlan=' + encodeURIComponent(plan.id);
    return 'index.html?' + qs + '#plans';
  }

  function kickOutTrialExpiredUser(simulatorId) {
    var id = String(simulatorId || currentSimulatorIdFromLocation() || '');
    if (!id || trialKickoutInFlight) return;
    if (!isOnSimulatorEnvironmentPage() || isOnHomeOrCatalogPage()) return;

    var authUser = getLocalAuthUser();
    var expMs = resolveTrialExpiryMsForAccess(authUser);
    if (expMs > Date.now() && viewerCanAccess(id)) return;

    trialKickoutInFlight = true;
    clearTrialExpiryWatch();

    var target = paywallRedirectUrl(id);
    showPaywallNotice(TRIAL_EXPIRED_REDIRECT_MSG);

    try {
      sessionStorage.setItem(PAYWALL_SIM_KEY, id);
      sessionStorage.setItem(TRIAL_KICKOUT_FLAG, '1');
    } catch (err) {
      /* ignore */
    }

    setTimeout(function () {
      global.location.replace(target);
    }, TRIAL_KICKOUT_DELAY_MS);
  }

  function showSimulatorDevLock(simulatorId) {
    var id = String(simulatorId || '');
    var sim = findSimulator(id);
    var title = (sim && sim.label) || id || 'المحاكي';
    var existing = document.getElementById('ifa-sim-dev-lock');
    if (existing) {
      existing.hidden = false;
      existing.setAttribute('aria-hidden', 'false');
      document.body.classList.add('ifa-sim-dev-lock-active');
      return;
    }
    var overlay = document.createElement('div');
    overlay.id = 'ifa-sim-dev-lock';
    overlay.className = 'ifa-sim-dev-lock';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'ifa-sim-dev-lock-title');
    overlay.innerHTML =
      '<div class="ifa-sim-dev-lock__backdrop" aria-hidden="true"></div>' +
      '<div class="ifa-sim-dev-lock__card">' +
      '<span class="ifa-sim-dev-lock__badge">' +
      escapeHtml(COMING_SOON_BADGE) +
      '</span>' +
      '<h2 class="ifa-sim-dev-lock__title" id="ifa-sim-dev-lock-title">' +
      escapeHtml(title) +
      '</h2>' +
      '<p class="ifa-sim-dev-lock__message">' +
      escapeHtml(COMING_SOON_MSG) +
      '</p>' +
      '<div class="ifa-sim-dev-lock__actions">' +
      '<a class="ifa-sim-dev-lock__btn ifa-sim-dev-lock__btn--primary" href="index.html#simulators">العودة إلى المحاكيات</a>' +
      '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    document.body.classList.add('ifa-sim-dev-lock-active');
  }

  function enforceSimulatorPageAccess() {
    var id = currentSimulatorIdFromLocation();
    if (!id) return;
    if (isSimulatorUnderDevelopment(id) && !isAdminPreviewContext()) {
      showSimulatorDevLock(id);
      return;
    }
    if (isAdminPreviewContext()) return;
    if (viewerCanAccess(id)) return;
    showPaywallNotice(PAYWALL_TOAST_MSG);
    global.location.replace(paywallRedirectUrl(id));
  }

  function interceptSimulatorLaunch(simulatorId, href) {
    var id = String(simulatorId || '');
    if (isSimulatorUnderDevelopment(id) && !isAdminPreviewContext()) {
      showPaywallNotice(COMING_SOON_MSG);
      return false;
    }
    var openHref = withPreviewQuery(href || (findSimulator(id) && findSimulator(id).href) || '');
    if (viewerCanAccess(id)) {
      if (!openHref) {
        showPaywallNotice('هذا المحاكي قيد الإعداد — سيكون متاحاً قريباً');
        return false;
      }
      global.location.href = openHref;
      return true;
    }
    showPaywallNotice(PAYWALL_TOAST_MSG);
    setTimeout(function () {
      global.location.href = paywallRedirectUrl(id);
    }, 650);
    return false;
  }

  function highlightTargetPlan() {
    var pricing = document.getElementById('pricing') || document.getElementById('plans');
    if (!pricing && !document.querySelector('.pricing-card')) return;

    var params;
    try {
      params = new URLSearchParams(global.location.search);
    } catch (err) {
      params = { get: function () { return ''; } };
    }
    var planId = String(params.get('highlightPlan') || '');
    var simId = String(params.get('needSim') || '');
    try {
      if (!planId) planId = sessionStorage.getItem(PAYWALL_PLAN_KEY) || '';
      if (!simId) simId = sessionStorage.getItem(PAYWALL_SIM_KEY) || '';
    } catch (err2) {
      /* ignore */
    }
    if (!planId && simId) {
      var rec = recommendedPlanForSimulator(simId);
      planId = rec ? String(rec.id) : '';
    }
    if (!planId) return;

    var cards = document.querySelectorAll('.pricing-card[data-plan-id]');
    if (!cards.length) return;
    var target = null;
    cards.forEach(function (card) {
      var match = String(card.getAttribute('data-plan-id')) === planId;
      card.classList.toggle('pricing-card--paywall-target', match);
      if (match) target = card;
    });
    var hash = String(global.location.hash || '');
    if ((hash === '#pricing' || hash === '#plans') && target) {
      setTimeout(function () {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(stripHomePaywallUrlFromAddressBar, 500);
      }, 80);
    }
  }

  function enrolledSwitcherSimulators() {
    var access = resolveViewerAccess();
    var current = currentSimulatorIdFromLocation();
    var ids = access.unlocked
      ? SIMULATOR_CATALOG.map(function (s) {
          return s.id;
        })
      : access.simulatorIds.slice();
    return normalizeSimulatorIds(ids).filter(function (id) {
      if (id === current) return false;
      if (isSimulatorUnderDevelopment(id)) return false;
      var sim = findSimulator(id);
      return !!(sim && sim.href);
    });
  }

  function renderSimulatorSwitchers() {
    var hosts = document.querySelectorAll('[data-sim-switcher]');
    if (!hosts.length) return;
    var items = enrolledSwitcherSimulators();
    hosts.forEach(function (host) {
      var linkClass = host.getAttribute('data-sim-switcher-class') || 'sim-switcher__link';
      host.innerHTML = items
        .map(function (id) {
          var sim = findSimulator(id);
          var href = withPreviewQuery(sim.href);
          return (
            '<a class="' +
            escapeHtml(linkClass) +
            '" href="' +
            escapeHtml(href) +
            '">' +
            escapeHtml(sim.navLabel || sim.label) +
            '</a>'
          );
        })
        .join('');
    });
  }

  function uniqueEnrolledCourseIds(authUser, directoryUser) {
    var seen = {};
    var enrolled = [];
    function pushId(courseId) {
      var key = String(courseId || '').trim();
      if (!key || seen[key]) return;
      seen[key] = true;
      enrolled.push(key);
    }
    if (directoryUser && Array.isArray(directoryUser.enrolledCourseIds)) {
      directoryUser.enrolledCourseIds.forEach(pushId);
    }
    if (authUser && Array.isArray(authUser.enrolledCourseIds)) {
      authUser.enrolledCourseIds.forEach(pushId);
    }
    return enrolled;
  }

  function simulatorsFromEnrolledCourseIds(enrolledCourseIds) {
    var ids = [];
    var seen = {};
    function add(list) {
      normalizeSimulatorIds(list).forEach(function (id) {
        if (seen[id]) return;
        seen[id] = true;
        ids.push(id);
      });
    }
    (enrolledCourseIds || []).forEach(function (courseId) {
      add(simulatorsFromCourse(findCourse(courseId)));
    });
    return ids;
  }

  function collectViewerSimulatorIds(authUser, directoryUser) {
    return simulatorsFromEnrolledCourseIds(uniqueEnrolledCourseIds(authUser, directoryUser));
  }

  function getUserAllowedSimulatorIds(authUser, directoryUser) {
    return collectViewerSimulatorIds(authUser, directoryUser);
  }

  function resolveViewerAccess() {
    if (isAdminPreviewContext()) {
      return {
        role: 'admin',
        unlocked: true,
        simulatorIds: SIMULATOR_CATALOG.map(function (s) {
          return s.id;
        }),
      };
    }

    var authUser = getLocalAuthUser();
    if (!authUser) {
      return {
        role: 'guest',
        unlocked: false,
        simulatorIds: [],
      };
    }

    var directoryUser = findDirectoryUser(authUser.email);

    if (isPrivilegedRole(authUser, directoryUser)) {
      return {
        role: String((directoryUser && directoryUser.role) || authUser.role || 'admin').toLowerCase(),
        unlocked: true,
        simulatorIds: SIMULATOR_CATALOG.map(function (s) {
          return s.id;
        }),
      };
    }

    var studentActive = true;
    if (directoryUser) {
      if (String(directoryUser.status || '').toLowerCase() === 'suspended') studentActive = false;
      if (
        global.AdminUsers &&
        typeof global.AdminUsers.isSubscriptionEnded === 'function' &&
        global.AdminUsers.isSubscriptionEnded(directoryUser)
      ) {
        studentActive = false;
      } else if (directoryUser.subscriptionEndsAt) {
        studentActive = new Date(directoryUser.subscriptionEndsAt).getTime() >= Date.now();
      }
    }

    if (!studentActive) {
      return {
        role: 'student',
        unlocked: false,
        simulatorIds: [],
      };
    }

    var ids = mergeTrialTierSimulatorIds(
      getUserAllowedSimulatorIds(authUser, directoryUser),
      authUser,
      directoryUser
    );
    return {
      role: 'student',
      unlocked: false,
      simulatorIds: ids,
    };
  }

  function viewerCanAccess(simulatorId) {
    var id = String(simulatorId || '');
    if (isAdminPreviewContext()) return true;

    var authUser = getLocalAuthUser();
    var directoryUser = authUser ? findDirectoryUser(authUser.email) : null;

    if (isPrivilegedRole(authUser, directoryUser)) return true;

    if (!authUser) return false;

    var entitled = getUserAllowedSimulatorIds(authUser, directoryUser);
    if (isGlobalPlatformSubscriber(authUser)) return true;

    if (isTrialTierSimulator(id)) {
      if (hasActiveTrialForAccess(authUser)) return true;
      return entitled.indexOf(id) !== -1;
    }

    return entitled.indexOf(id) !== -1;
  }

  function withPreviewQuery(href) {
    if (!href) return href;
    if (!isAdminPreviewContext()) return href;
    return href + (href.indexOf('?') === -1 ? '?' : '&') + 'mode=admin-preview';
  }

  function applyPublicSimulatorGates() {
    var cards = document.querySelectorAll('[data-simulator-card][data-simulator-id]');
    if (!cards.length) return;
    applySimulatorMetaToCards();

    cards.forEach(function (card) {
      var id = card.getAttribute('data-simulator-id') || '';
      var href = card.getAttribute('data-simulator-href') || (findSimulator(id) && findSimulator(id).href) || '';
      var underDev = isSimulatorUnderDevelopment(id);
      card.classList.remove('feature-card--locked', 'feature-card--dev');
      card.classList.add('feature-card--unlocked');
      card.removeAttribute('data-simulator-locked');
      card.removeAttribute('data-simulator-dev');

      var existingSoon = card.querySelector('.feature-card__soon-badge');
      if (existingSoon) existingSoon.remove();

      var accessEl = card.querySelector('[data-simulator-access]');
      if (!accessEl) {
        accessEl = document.createElement('div');
        accessEl.className = 'feature-card__access';
        accessEl.setAttribute('data-simulator-access', '');
        card.appendChild(accessEl);
      }

      if (underDev) {
        card.classList.add('feature-card--dev');
        card.classList.remove('feature-card--unlocked');
        card.setAttribute('data-simulator-dev', '1');
        var soonBadge = document.createElement('span');
        soonBadge.className = 'feature-card__soon-badge';
        soonBadge.textContent = COMING_SOON_BADGE;
        card.insertBefore(soonBadge, card.firstChild);
        if (isAdminPreviewContext()) {
          var previewHref = withPreviewQuery(href);
          accessEl.innerHTML =
            '<a class="feature-card__open-btn" href="' +
            escapeHtml(previewHref || '#simulators') +
            '" data-simulator-launch="' +
            escapeHtml(id) +
            '">معاينة (المسؤول)</a>';
        } else {
          accessEl.innerHTML =
            '<button type="button" class="feature-card__open-btn feature-card__open-btn--soon" disabled aria-disabled="true" data-simulator-launch="' +
            escapeHtml(id) +
            '">قيد التطوير</button>';
        }
        return;
      }

      var allowed = viewerCanAccess(id);
      var openHref = withPreviewQuery(href);
      var trialTier = isTrialTierSimulator(id);
      var authUser = getLocalAuthUser();
      var directoryUser = authUser ? findDirectoryUser(authUser.email) : null;
      var badgeHtml = '';
      var btnText = allowed ? 'افتح المحاكي' : 'يتطلب الاشتراك بالباقة';
      var btnHref = openHref || '#simulators';

      if (trialTier) {
        var privileged = authUser && isPrivilegedRole(authUser, directoryUser);
        var globalSub = authUser && isGlobalPlatformSubscriber(authUser);
        var entitled = authUser ? getUserAllowedSimulatorIds(authUser, directoryUser) : [];
        var courseGrantsThisSim = entitled.indexOf(id) !== -1;
        var activeTrial = authUser && hasActiveTrialForAccess(authUser);
        var snapMs = authUser ? trialExpiryMs(authUser) : 0;

        if (!privileged && !globalSub && authUser) {
          if (activeTrial && allowed) {
            badgeHtml =
              '<span class="feature-card__free-badge">ضمن التجربة</span>';
          } else if (snapMs > 0 && !activeTrial && !courseGrantsThisSim) {
            badgeHtml =
              '<span class="feature-card__free-badge feature-card__trial-expired">انتهت التجربة</span>';
            btnText = 'يتطلب الاشتراك بالباقة';
            btnHref = paywallRedirectUrl(id);
          }
        }

        if (!allowed) {
          btnText = 'يتطلب الاشتراك بالباقة';
          btnHref = paywallRedirectUrl(id);
        }
      }

      accessEl.innerHTML =
        badgeHtml +
        '<a class="feature-card__open-btn" href="' +
        escapeHtml(btnHref) +
        '" data-simulator-launch="' +
        escapeHtml(id) +
        '">' +
        btnText +
        '</a>';
      if (!allowed) {
        card.classList.add('feature-card--locked');
        card.classList.remove('feature-card--unlocked');
        card.setAttribute('data-simulator-locked', '1');
      }
    });
  }

  function bindLaunchInterceptor() {
    if (document.documentElement.getAttribute('data-sim-paywall-bound') === '1') return;
    document.documentElement.setAttribute('data-sim-paywall-bound', '1');
    document.addEventListener(
      'click',
      function (e) {
        var launch = e.target && e.target.closest ? e.target.closest('[data-simulator-launch]') : null;
        if (!launch) {
          var card = e.target && e.target.closest ? e.target.closest('[data-simulator-card] .feature-card__open-btn') : null;
          if (card) {
            launch = card.closest('[data-simulator-card]');
          }
        }
        if (!launch) return;
        var cardEl = launch.closest ? launch.closest('[data-simulator-card]') : null;
        var id =
          launch.getAttribute('data-simulator-launch') ||
          (cardEl && cardEl.getAttribute('data-simulator-id')) ||
          '';
        if (!id) return;
        e.preventDefault();
        e.stopPropagation();
        var href =
          (cardEl && cardEl.getAttribute('data-simulator-href')) ||
          (findSimulator(id) && findSimulator(id).href) ||
          '';
        interceptSimulatorLaunch(id, href);
      },
      true
    );
  }

  function enrolledCourseIdsForPlan(plan) {
    if (!plan) return [];
    return getPublishedCourses()
      .filter(function (course) {
        if (course.requiredPlanId && String(course.requiredPlanId) === String(plan.id)) return true;
        return (
          global.PlatformPlans &&
          typeof global.PlatformPlans.courseMatchesPlan === 'function' &&
          global.PlatformPlans.courseMatchesPlan(course, plan)
        );
      })
      .map(function (c) {
        return c.id;
      });
  }

  function persistAuthSubscription(planId, enrolledCourseIds, allowedSimulators) {
    var current = readJson(AUTH_KEY, null);
    if (!current || !normalizeEmail(current.email)) return null;
    current.planId = String(planId || '');
    current.enrolledCourseIds = Array.isArray(enrolledCourseIds) ? enrolledCourseIds : [];
    current.allowedSimulators = Array.isArray(allowedSimulators)
      ? normalizeSimulatorIds(allowedSimulators)
      : normalizeSimulatorIds(simulatorsFromPlan(findPlan(planId)));
    current.isSubscriber = true;
    try {
      localStorage.setItem(AUTH_KEY, JSON.stringify(current));
    } catch (err) {
      console.error('[PlatformSimulators] auth subscription save failed', err);
    }
    if (global.IFAAuth && typeof global.IFAAuth.setLocalAuthUser === 'function') {
      global.IFAAuth.setLocalAuthUser(current);
    }
    return current;
  }

  function persistDirectorySubscription(email, planId, enrolledCourseIds) {
    var key = normalizeEmail(email);
    if (!key) return;
    if (global.AdminUsers && typeof global.AdminUsers.getUsers === 'function') {
      var users = global.AdminUsers.getUsers();
      var match = null;
      users.forEach(function (u) {
        if (normalizeEmail(u.email) === key) match = u;
      });
      if (match && typeof global.AdminUsers.updateUser === 'function') {
        global.AdminUsers.updateUser(match.id, {
          planId: String(planId || ''),
          enrolledCourseIds: enrolledCourseIds || [],
          status: 'active',
        });
        return;
      }
    }
    var list = readJson(USERS_KEY, []);
    if (!Array.isArray(list)) return;
    var changed = false;
    list = list.map(function (u) {
      if (normalizeEmail(u && u.email) !== key) return u;
      changed = true;
      return Object.assign({}, u, {
        planId: String(planId || ''),
        enrolledCourseIds: enrolledCourseIds || [],
        status: 'active',
      });
    });
    if (!changed) return;
    try {
      localStorage.setItem(USERS_KEY, JSON.stringify(list));
    } catch (err) {
      /* ignore */
    }
  }

  function subscribeCurrentUserToPlan(planId) {
    var plan = findPlan(planId);
    if (!plan) throw new Error('الباقة غير موجودة');
    var authUser = getLocalAuthUser();
    if (!authUser) throw new Error('يرجى تسجيل الدخول أولاً للاشتراك');
    var enrolled = enrolledCourseIdsForPlan(plan);
    var simulators = simulatorsFromPlan(plan);
    persistAuthSubscription(plan.id, enrolled, simulators);
    persistDirectorySubscription(authUser.email, plan.id, enrolled);
    refreshAccessUi();
    try {
      global.dispatchEvent(
        new CustomEvent('ifa:subscription-changed', {
          detail: { planId: plan.id, allowedSimulators: simulators, enrolledCourseIds: enrolled },
        })
      );
    } catch (err) {
      /* ignore */
    }
    return { plan: plan, enrolledCourseIds: enrolled };
  }

  function refreshAccessUi() {
    applyPublicSimulatorGates();
    renderSimulatorSwitchers();
    highlightTargetPlan();
  }

  var trialExpiryWatchInterval = null;
  var trialExpiryWatchTimeout = null;
  var trialExpiryWatchVisibilityHandler = null;

  function clearTrialExpiryWatch() {
    if (trialExpiryWatchInterval) {
      clearInterval(trialExpiryWatchInterval);
      trialExpiryWatchInterval = null;
    }
    if (trialExpiryWatchTimeout) {
      clearTimeout(trialExpiryWatchTimeout);
      trialExpiryWatchTimeout = null;
    }
    if (trialExpiryWatchVisibilityHandler) {
      document.removeEventListener('visibilitychange', trialExpiryWatchVisibilityHandler);
      trialExpiryWatchVisibilityHandler = null;
    }
  }

  function resolveTrialExpiryMsForAccess(authUser) {
    var settings = getPlatformSettings();
    if (global.IFAAuth && typeof global.IFAAuth.getTrialExpiryMs === 'function') {
      return global.IFAAuth.getTrialExpiryMs(authUser, settings);
    }
    var stored = trialExpiryMs(authUser);
    return stored > 0 ? stored : 0;
  }

  function shouldMonitorTrialExpiryOnPage(simId, authUser, directoryUser) {
    if (!isOnSimulatorEnvironmentPage()) return false;
    if (!simId || !isTrialTierSimulator(simId)) return false;
    if (!authUser) return false;
    if (isAdminPreviewContext()) return false;
    if (isPrivilegedRole(authUser, directoryUser)) return false;
    if (isGlobalPlatformSubscriber(authUser)) return false;
    var entitled = getUserAllowedSimulatorIds(authUser, directoryUser);
    if (entitled.indexOf(simId) !== -1) return false;
    if (!hasActiveTrialForAccess(authUser)) return false;
    return resolveTrialExpiryMsForAccess(authUser) > Date.now();
  }

  function armTrialExpiryWatch() {
    clearTrialExpiryWatch();
    if (!isOnSimulatorEnvironmentPage()) return;
    var simId = currentSimulatorIdFromLocation();
    if (!simId) return;

    var authUser = getLocalAuthUser();
    var directoryUser = authUser ? findDirectoryUser(authUser.email) : null;
    if (!shouldMonitorTrialExpiryOnPage(simId, authUser, directoryUser)) return;

    function onTrialExpiredOrDenied() {
      if (!isOnSimulatorEnvironmentPage()) return;
      if (viewerCanAccess(simId)) return;

      var liveUser = getLocalAuthUser();
      var expMs = resolveTrialExpiryMsForAccess(liveUser || authUser);
      var trialEnded = expMs > 0 && Date.now() >= expMs;

      if (isTrialTierSimulator(simId) && trialEnded) {
        kickOutTrialExpiredUser(simId);
        if (typeof global.applyGlobalAnnouncementBar === 'function') {
          global.applyGlobalAnnouncementBar();
        }
        return;
      }

      clearTrialExpiryWatch();
      enforceSimulatorPageAccess();
      refreshAccessUi();
    }

    trialExpiryWatchInterval = setInterval(onTrialExpiredOrDenied, 1000);

    var expMs = resolveTrialExpiryMsForAccess(authUser);
    var delay = expMs - Date.now();
    if (delay > 0 && delay <= 2147483647) {
      trialExpiryWatchTimeout = setTimeout(onTrialExpiredOrDenied, delay);
    }

    trialExpiryWatchVisibilityHandler = function () {
      if (document.visibilityState !== 'visible') return;
      onTrialExpiredOrDenied();
    };
    document.addEventListener('visibilitychange', trialExpiryWatchVisibilityHandler);
  }

  function scheduleSimulatorPageAccessCheck() {
    if (!currentSimulatorIdFromLocation()) {
      clearTrialExpiryWatch();
      return;
    }
    var authUser = getLocalAuthUser();
    var directoryUser = authUser ? findDirectoryUser(authUser.email) : null;
    warmEntitlementCaches(authUser, directoryUser).then(function () {
      if (!isOnSimulatorEnvironmentPage()) {
        clearTrialExpiryWatch();
        return;
      }
      enforceSimulatorPageAccess();
      refreshAccessUi();
      if (isOnSimulatorEnvironmentPage()) {
        armTrialExpiryWatch();
      }
    });
  }

  function bindPublicRefresh() {
    bindLaunchInterceptor();
    refreshAccessUi();
    scheduleSimulatorPageAccessCheck();
    global.addEventListener('load', function () {
      refreshAccessUi();
      scheduleSimulatorPageAccessCheck();
    });
    global.addEventListener('hashchange', highlightTargetPlan);
    global.addEventListener('ifa:local-auth-changed', function (e) {
      refreshAccessUi();
      var type = e && e.detail ? e.detail.type : '';
      if (type === 'profile-sync' || type === 'login' || type === 'local-session') {
        scheduleSimulatorPageAccessCheck();
      }
    });
    document.addEventListener('ifa:local-auth-changed', function (e) {
      refreshAccessUi();
      var type = e && e.detail ? e.detail.type : '';
      if (type === 'profile-sync' || type === 'login' || type === 'local-session') {
        scheduleSimulatorPageAccessCheck();
      }
    });
    global.addEventListener('ifa:subscription-changed', function () {
      refreshAccessUi();
      scheduleSimulatorPageAccessCheck();
    });
    global.addEventListener('ifa:platform-courses-changed', refreshAccessUi);
    global.addEventListener('ifa:platform-plans-changed', refreshAccessUi);
    document.addEventListener('ifa:platform-plans-changed', refreshAccessUi);
    global.addEventListener('ifa:platform-settings-changed', function () {
      refreshAccessUi();
      scheduleSimulatorPageAccessCheck();
    });
    global.addEventListener('ifa:simulators-meta-changed', refreshAccessUi);
    global.addEventListener('ifa:simulators-firestore-changed', refreshAccessUi);
    document.addEventListener('ifa:simulators-firestore-changed', refreshAccessUi);
    if (global.PlatformSimulatorsFirestore && typeof global.PlatformSimulatorsFirestore.subscribe === 'function') {
      global.PlatformSimulatorsFirestore.subscribe(function () {
        refreshAccessUi();
      });
    }
    global.addEventListener('storage', function (e) {
      if (
        !e.key ||
        e.key === AUTH_KEY ||
        e.key === 'platform_courses' ||
        e.key === 'platform_plans' ||
        e.key === 'ifa_pricing_plans' ||
        e.key === USERS_KEY ||
        e.key === SETTINGS_KEY ||
        e.key === META_KEY
      ) {
        refreshAccessUi();
      }
    });
    setTimeout(highlightTargetPlan, 400);
    setTimeout(highlightTargetPlan, 1600);
    var grid = document.querySelector('#publicPricingGrid, .pricing__grid');
    if (grid && typeof MutationObserver !== 'undefined') {
      new MutationObserver(highlightTargetPlan).observe(grid, { childList: true });
    }
  }

  global.PlatformSimulators = {
    CATALOG: SIMULATOR_CATALOG,
    SETTINGS_KEY: SETTINGS_KEY,
    META_KEY: META_KEY,
    getCatalog: getCatalog,
    getSimulatorMeta: getSimulatorMeta,
    saveSimulatorMeta: saveSimulatorMeta,
    defaultSimulatorMeta: defaultSimulatorMeta,
    applySimulatorMetaToCards: applySimulatorMetaToCards,
    isIconImageSrc: isIconImageSrc,
    iconHtml: iconHtml,
    findSimulator: findSimulator,
    currentSimulatorIdFromLocation: currentSimulatorIdFromLocation,
    normalizeSimulatorIds: normalizeSimulatorIds,
    simulatorLabels: simulatorLabels,
    getPlatformSettings: getPlatformSettings,
    savePlatformSettings: savePlatformSettings,
    normalizeFreeTrialDays: normalizeFreeTrialDays,
    isGloballyFreeSimulator: isGloballyFreeSimulator,
    isTrialTierSimulator: isTrialTierSimulator,
    getTrialTierSimulatorIds: getTrialTierSimulatorIds,
    canAccessTrialTierSimulators: canAccessTrialTierSimulators,
    canAccessFullTrialTierPool: canAccessFullTrialTierPool,
    isGlobalPlatformSubscriber: isGlobalPlatformSubscriber,
    isSimulatorUnderDevelopment: isSimulatorUnderDevelopment,
    COMING_SOON_BADGE: COMING_SOON_BADGE,
    COMING_SOON_MSG: COMING_SOON_MSG,
    hasActiveTrial: hasActiveTrial,
    viewerCanAccess: viewerCanAccess,
    resolveViewerAccess: resolveViewerAccess,
    courseUnlockingSimulator: courseUnlockingSimulator,
    lockLabelForSimulator: lockLabelForSimulator,
    recommendedPlanForSimulator: recommendedPlanForSimulator,
    interceptSimulatorLaunch: interceptSimulatorLaunch,
    applyPublicSimulatorGates: applyPublicSimulatorGates,
    renderSimulatorSwitchers: renderSimulatorSwitchers,
    highlightTargetPlan: highlightTargetPlan,
    subscribeCurrentUserToPlan: subscribeCurrentUserToPlan,
    simulatorsFromCourse: simulatorsFromCourse,
    simulatorsFromEnrolledCourseIds: simulatorsFromEnrolledCourseIds,
    simulatorsFromPlan: simulatorsFromPlan,
    ensurePlanCached: ensurePlanCached,
    warmEntitlementCaches: warmEntitlementCaches,
    scheduleSimulatorPageAccessCheck: scheduleSimulatorPageAccessCheck,
    armTrialExpiryWatch: armTrialExpiryWatch,
    clearTrialExpiryWatch: clearTrialExpiryWatch,
    kickOutTrialExpiredUser: kickOutTrialExpiredUser,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindPublicRefresh);
  } else {
    bindPublicRefresh();
  }
})(typeof window !== 'undefined' ? window : this);
