/**
 * Unified pricing plans database (localStorage).
 * Primary key: platform_plans
 * Shared by Admin Dashboard and public homepage.
 * Plans expose accessLevel ranks used by courses for access gating.
 */
(function (global) {
  'use strict';

  var PLANS_KEY = 'platform_plans';
  var PLANS_ALIAS_KEY = 'ifa_pricing_plans';
  var SEED_FLAG_KEY = 'platform_plans_initialized';
  var SEED_VERSION_KEY = 'platform_plans_seed_version';
  var SEED_VERSION = '4';

  var LEGACY_TIER_IDS = { plan_free: true, plan_standard: true, plan_pro: true };
  var LEGACY_TIER_NAMES = {
    المجانية: true,
    القياسية: true,
    الاحترافية: true,
    Free: true,
    Standard: true,
    Pro: true,
  };

  var DEFAULT_SIMULATOR_IDS = [
    'ftth-simulator',
    'otdr-simulator',
    'power-meter',
    'fusion-splicer',
    'fiber-anatomy',
    'patch-panel-lab',
  ];

  var ACCESS_LEVELS = {
    free: { key: 'free', rank: 0, label: 'مجاني' },
    standard: { key: 'standard', rank: 1, label: 'قياسي' },
    professional: { key: 'professional', rank: 2, label: 'احترافي' },
  };

  function uid(prefix) {
    return (prefix || 'plan') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }

  function storageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (err) {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (err) {
      console.error('[PlatformPlans] set failed', key, err);
      return false;
    }
  }

  function readJson(key, fallback) {
    try {
      var raw = storageGet(key);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch (err) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    var ok = storageSet(key, JSON.stringify(value));
    if (key === PLANS_KEY) {
      storageSet(PLANS_ALIAS_KEY, JSON.stringify(value));
    }
    return ok;
  }

  function normalizeSimulatorIds(list) {
    if (global.PlatformSimulators && typeof global.PlatformSimulators.normalizeSimulatorIds === 'function') {
      return global.PlatformSimulators.normalizeSimulatorIds(list);
    }
    if (!Array.isArray(list)) return [];
    var allowed = {};
    DEFAULT_SIMULATOR_IDS.forEach(function (id) {
      allowed[id] = true;
    });
    var out = [];
    var seen = {};
    list.forEach(function (item) {
      var id = String(item || '').trim();
      if (!allowed[id] || seen[id]) return;
      seen[id] = true;
      out.push(id);
    });
    return out;
  }

  function normalizeAccessLevel(value) {
    var key = String(value || '')
      .trim()
      .toLowerCase();
    if (key === 'pro') key = 'professional';
    if (key === 'basic') key = 'free';
    if (ACCESS_LEVELS[key]) return key;
    return 'standard';
  }

  function getAccessMeta(level) {
    var key = normalizeAccessLevel(level);
    return ACCESS_LEVELS[key] || ACCESS_LEVELS.standard;
  }

  function normalizeCategories(list) {
    if (!Array.isArray(list)) return [];
    var allowed = { individual: 1, program: 1, master: 1 };
    var out = [];
    list.forEach(function (c) {
      var key = String(c || '')
        .trim()
        .toLowerCase();
      if (allowed[key] && out.indexOf(key) === -1) out.push(key);
    });
    return out;
  }

  function normalizeFeatures(features) {
    if (!Array.isArray(features)) return [];
    return features
      .map(function (f) {
        if (typeof f === 'string') {
          return { text: String(f).trim(), included: true };
        }
        if (!f || typeof f !== 'object') return null;
        var text = String(f.text || f.label || '').trim();
        if (!text) return null;
        return {
          text: text,
          included: f.included !== false && f.included !== 0 && f.included !== 'false',
        };
      })
      .filter(Boolean);
  }

  function normalizeCurrency(value) {
    if (global.PlatformCourses && typeof global.PlatformCourses.normalizeCurrency === 'function') {
      return global.PlatformCourses.normalizeCurrency(value);
    }
    var raw = String(value || '').trim();
    var key = raw.toUpperCase();
    if (key === 'USD' || key === '$' || key === 'DOLLAR' || raw === 'دولار') return 'USD';
    return 'IQD';
  }

  function currencyLabel(code) {
    if (global.PlatformCourses && typeof global.PlatformCourses.currencyLabel === 'function') {
      return global.PlatformCourses.currencyLabel(code);
    }
    return normalizeCurrency(code) === 'USD' ? '$' : 'د.ع';
  }

  function parsePrice(val) {
    if (global.PlatformCourses && typeof global.PlatformCourses.parsePrice === 'function') {
      return global.PlatformCourses.parsePrice(val);
    }
    if (typeof val === 'number' && isFinite(val)) return val < 0 ? 0 : val;
    var clean = String(val == null ? '' : val)
      .replace(/,/g, '')
      .replace(/٬/g, '')
      .replace(/،/g, '')
      .replace(/\s/g, '')
      .trim();
    if (!clean) return 0;
    var n = Number(clean);
    if (!isFinite(n) || n < 0) return 0;
    return n;
  }

  function formatGroupedAmount(val) {
    if (global.PlatformCourses && typeof global.PlatformCourses.formatGroupedAmount === 'function') {
      return global.PlatformCourses.formatGroupedAmount(val);
    }
    var n = parsePrice(val);
    if (!n) return '0';
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function defaultCategoriesForLevel(level) {
    var key = normalizeAccessLevel(level);
    if (key === 'free') return ['individual'];
    if (key === 'standard') return ['individual', 'program'];
    return ['individual', 'program', 'master'];
  }

  function normalizePlanType(raw) {
    var type = String((raw && raw.planType) || '').trim().toLowerCase();
    if (type === 'course' || type === 'bundle') return type;
    if (raw && raw.sourceCourseId) return 'course';
    return 'bundle';
  }

  function normalizeIncludedCourseIds(raw) {
    if (Array.isArray(raw && raw.includedCourseIds)) {
      return raw.includedCourseIds
        .map(function (id) {
          return String(id || '').trim();
        })
        .filter(Boolean);
    }
    if (raw && raw.sourceCourseId) return [String(raw.sourceCourseId).trim()];
    return [];
  }

  function normalizePlan(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var price = parsePrice(raw.price);
    var planType = normalizePlanType(raw);
    var includedCourseIds = normalizeIncludedCourseIds(raw);
    var categories = normalizeCategories(raw.courseCategories);
    if (!categories.length) categories = ['individual'];
    return {
      id: String(raw.id || uid('plan')),
      planType: planType,
      name: String(raw.name || '').trim(),
      description: String(raw.description || '').trim(),
      price: price,
      currency: normalizeCurrency(raw.currency),
      period: String(raw.period || '').trim(),
      ctaLabel: String(raw.ctaLabel || 'اشترك الآن').trim() || 'اشترك الآن',
      ctaStyle: raw.ctaStyle === 'primary' ? 'primary' : 'outline',
      featured: !!raw.featured,
      badge: String(raw.badge || '').trim(),
      features: normalizeFeatures(raw.features),
      courseCategories: categories,
      sortOrder: isFinite(Number(raw.sortOrder)) ? Number(raw.sortOrder) : 0,
      allowedSimulators: normalizeSimulatorIds(raw.allowedSimulators),
      sourceCourseId: String(raw.sourceCourseId || '').trim(),
      includedCourseIds: includedCourseIds,
      catalogHidden: raw.catalogHidden === true,
      updatedAt: raw.updatedAt || new Date().toISOString(),
      createdAt: raw.createdAt || new Date().toISOString(),
    };
  }

  function seedPlans() {
    return [];
  }

  function isLegacyTierPlan(plan) {
    if (!plan) return false;
    if (LEGACY_TIER_IDS[String(plan.id || '')]) return true;
    if (LEGACY_TIER_NAMES[String(plan.name || '').trim()]) return true;
    return false;
  }

  function stripLegacyTierPlans(list) {
    return (list || []).filter(function (plan) {
      return plan && !isLegacyTierPlan(plan);
    });
  }

  function migratePlanFields(list) {
    return (list || []).map(normalizePlan).filter(Boolean);
  }

  function ensureSeeded() {
    var initialized = storageGet(SEED_FLAG_KEY) === '1';
    var version = storageGet(SEED_VERSION_KEY);
    var current = readJson(PLANS_KEY, null);
    if (!Array.isArray(current) || !current.length) {
      var alias = readJson(PLANS_ALIAS_KEY, null);
      if (Array.isArray(alias) && alias.length) current = alias;
    }

    // First visit only — never re-seed after the admin clears the list.
    if (!initialized && (!Array.isArray(current) || !current.length)) {
      writeJson(PLANS_KEY, seedPlans());
      storageSet(SEED_FLAG_KEY, '1');
      storageSet(SEED_VERSION_KEY, SEED_VERSION);
      return;
    }

    if (!Array.isArray(current)) {
      writeJson(PLANS_KEY, []);
      storageSet(SEED_FLAG_KEY, '1');
      storageSet(SEED_VERSION_KEY, SEED_VERSION);
      return;
    }

    if (version !== SEED_VERSION) {
      // Soft migrate + drop deprecated default tier cards (plan_free / المجانية etc.).
      writeJson(PLANS_KEY, stripLegacyTierPlans(migratePlanFields(current)));
      storageSet(SEED_FLAG_KEY, '1');
      storageSet(SEED_VERSION_KEY, SEED_VERSION);
    } else if (!initialized) {
      storageSet(SEED_FLAG_KEY, '1');
    }
  }

  function emitChanged(list, detail) {
    writeJson(PLANS_KEY, list);
    storageSet(SEED_FLAG_KEY, '1');
    var payload = Object.assign({ count: list.length, key: PLANS_KEY }, detail || {});
    try {
      var evt = new CustomEvent('ifa:platform-plans-changed', { detail: payload, bubbles: true });
      global.dispatchEvent(evt);
      if (global.document) global.document.dispatchEvent(evt);
    } catch (err) {
      /* ignore */
    }
  }

  function usesFirestorePlans() {
    return !!(
      global.PlatformPricingFirestore &&
      typeof global.PlatformPricingFirestore.isReady === 'function' &&
      global.PlatformPricingFirestore.isReady()
    );
  }

  function isFirestorePlansBootstrapping() {
    var FS = global.PlatformPricingFirestore;
    if (!FS || typeof FS.isReady !== 'function') return false;
    if (FS.isReady()) return false;
    var cached = typeof FS.getCachedPlans === 'function' ? FS.getCachedPlans() : [];
    return !(cached && cached.length);
  }

  function readLocalPlansCache() {
    ensureSeeded();
    var list = readJson(PLANS_KEY, null);
    if (!list) list = readJson(PLANS_ALIAS_KEY, []);
    return stripLegacyTierPlans(migratePlanFields(Array.isArray(list) ? list : [])).sort(function (a, b) {
      return (a.sortOrder || 0) - (b.sortOrder || 0);
    });
  }

  function getPlans() {
    if (isFirestorePlansBootstrapping()) {
      return readLocalPlansCache();
    }
    if (usesFirestorePlans()) {
      return stripLegacyTierPlans(
        (global.PlatformPricingFirestore.getCachedPlans() || [])
          .map(normalizePlan)
          .filter(Boolean)
      ).sort(function (a, b) {
        return (a.sortOrder || 0) - (b.sortOrder || 0);
      });
    }
    return readLocalPlansCache();
  }

  function savePlans(list, detail) {
    if (usesFirestorePlans()) {
      console.warn(
        '[PlatformPlans] savePlans ignored while Firestore sync is active — use PlatformPricingFirestore CRUD'
      );
      return (list || []).map(normalizePlan).filter(Boolean);
    }
    var normalized = (list || [])
      .map(normalizePlan)
      .filter(Boolean)
      .map(function (p, index) {
        return Object.assign({}, p, { sortOrder: index, updatedAt: new Date().toISOString() });
      });
    emitChanged(normalized, detail);
    return normalized;
  }

  function findPlan(id) {
    var key = String(id || '');
    if (!key) return null;
    if (isFirestorePlansBootstrapping()) {
      var localList = readLocalPlansCache();
      for (var li = 0; li < localList.length; li++) {
        if (String(localList[li].id) === key) return localList[li];
      }
      return null;
    }
    if (usesFirestorePlans() && global.PlatformPricingFirestore.findPlan) {
      var cached = global.PlatformPricingFirestore.findPlan(key);
      return cached ? normalizePlan(cached) : null;
    }
    var list = getPlans();
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].id) === key) return list[i];
    }
    return null;
  }

  function findPlanByAccessLevel(level) {
    var key = normalizeAccessLevel(level);
    var list = getPlans();
    for (var i = 0; i < list.length; i++) {
      if (list[i].accessLevel === key) return list[i];
    }
    return null;
  }

  function updatePlan(id, patch) {
    if (usesFirestorePlans()) {
      console.warn(
        '[PlatformPlans] updatePlan ignored while Firestore sync is active — use PlatformPricingFirestore.updatePlan'
      );
      return findPlan(id);
    }
    var key = String(id || '');
    var list = getPlans();
    var found = null;
    list = list.map(function (p) {
      if (String(p.id) !== key) return p;
      found = normalizePlan(
        Object.assign({}, p, patch || {}, {
          id: p.id,
          createdAt: p.createdAt,
          updatedAt: new Date().toISOString(),
        })
      );
      if (!found.name) throw new Error('اسم الباقة مطلوب');
      return found;
    });
    if (!found) throw new Error('الباقة غير موجودة');
    savePlans(list, { type: 'update', id: key });
    return found;
  }

  function addPlan(payload) {
    if (usesFirestorePlans()) {
      console.warn(
        '[PlatformPlans] addPlan ignored while Firestore sync is active — use PlatformPricingFirestore.addPlan'
      );
      return null;
    }
    var list = getPlans();
    var plan = normalizePlan(
      Object.assign({}, payload || {}, {
        id: uid('plan'),
        sortOrder: list.length,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    );
    if (!plan.name) throw new Error('اسم الباقة مطلوب');
    list.push(plan);
    savePlans(list, { type: 'add', id: plan.id });
    return plan;
  }

  function deletePlan(id) {
    var key = String(id || '').trim();
    if (!key) throw new Error('معرّف الباقة غير صالح');
    ensureSeeded();
    var list = readJson(PLANS_KEY, []);
    if (!Array.isArray(list)) list = [];
    var next = list.filter(function (p) {
      return p && String(p.id) !== key;
    });
    if (next.length === list.length) {
      // Retry against normalized getPlans ids
      var normalized = getPlans();
      next = normalized.filter(function (p) {
        return String(p.id) !== key;
      });
      if (next.length === normalized.length) throw new Error('الباقة غير موجودة');
    }
    savePlans(next, { type: 'delete', id: key });
    return true;
  }

  function formatPrice(plan) {
    if (!plan) return '—';
    var amount = parsePrice(plan.price);
    if (!amount) return 'مجاناً';
    return formatGroupedAmount(amount) + ' ' + currencyLabel(plan.currency);
  }

  function planUnlocksCategory(plan, category) {
    if (!plan) return false;
    var cat = String(category || 'individual').toLowerCase();
    var cats = plan.courseCategories || [];
    return cats.indexOf(cat) !== -1;
  }

  function courseMatchesPlan(course, plan) {
    if (!course || !plan) return false;
    var courseId = String(course.id || '');
    if (!courseId) return false;
    if (plan.sourceCourseId && String(plan.sourceCourseId) === courseId) return true;
    var included = plan.includedCourseIds || [];
    for (var i = 0; i < included.length; i++) {
      if (String(included[i]) === courseId) return true;
    }
    return false;
  }

  function countCoursesForPlan(plan, courses) {
    if (!plan) return 0;
    var list = Array.isArray(courses) ? courses : [];
    return list.filter(function (c) {
      return c && !c.softDeleted && c.status === 'published' && courseMatchesPlan(c, plan);
    }).length;
  }

  function getAccessLevels() {
    return [
      { key: 'free', rank: 0, label: 'مجاني' },
      { key: 'standard', rank: 1, label: 'قياسي' },
      { key: 'professional', rank: 2, label: 'احترافي' },
    ];
  }

  function simulatorFeatureLines(ids) {
    var labels =
      global.PlatformSimulators && typeof global.PlatformSimulators.simulatorLabels === 'function'
        ? global.PlatformSimulators.simulatorLabels(ids)
        : normalizeSimulatorIds(ids);
    return labels.map(function (text) {
      return { text: 'محاكي: ' + text, included: true };
    });
  }

  function findPlanBySourceCourse(courseId) {
    var key = String(courseId || '');
    if (!key) return null;
    var list = getPlans();
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].sourceCourseId || '') === key) return list[i];
    }
    return null;
  }

  function isCatalogPricingPlan(plan) {
    if (global.CoursePlanSync && typeof global.CoursePlanSync.isCatalogPricingPlan === 'function') {
      return global.CoursePlanSync.isCatalogPricingPlan(plan);
    }
    if (!plan || isLegacyTierPlan(plan)) return false;
    if (plan.catalogHidden === true) return false;
    if (parsePrice(plan.price) <= 0) return false;
    var type = String(plan.planType || '').toLowerCase();
    if (type === 'course') return !!plan.sourceCourseId;
    if (type === 'bundle') return true;
    return !plan.sourceCourseId || !!plan.sourceCourseId;
  }

  function getCatalogPricingPlans() {
    return getPlans().filter(isCatalogPricingPlan);
  }

  function upsertFromCourse(course) {
    if (global.CoursePlanSync && typeof global.CoursePlanSync.syncPlanForCourse === 'function') {
      return global.CoursePlanSync.syncPlanForCourse(course);
    }
    return Promise.resolve(course);
  }

  ensureSeeded();

  global.PlatformPlans = {
    PLANS_KEY: PLANS_KEY,
    PLANS_ALIAS_KEY: PLANS_ALIAS_KEY,
    defaultSeedPlans: seedPlans,
    usesFirestore: usesFirestorePlans,
    isFirestoreBootstrapping: isFirestorePlansBootstrapping,
    getPlans: getPlans,
    savePlans: savePlans,
    findPlan: findPlan,
    findPlanByAccessLevel: findPlanByAccessLevel,
    addPlan: addPlan,
    updatePlan: updatePlan,
    deletePlan: deletePlan,
    formatPrice: formatPrice,
    parsePrice: parsePrice,
    formatGroupedAmount: formatGroupedAmount,
    normalizePlan: normalizePlan,
    normalizeCurrency: normalizeCurrency,
    currencyLabel: currencyLabel,
    normalizeAccessLevel: normalizeAccessLevel,
    getAccessMeta: getAccessMeta,
    getAccessLevels: getAccessLevels,
    planUnlocksCategory: planUnlocksCategory,
    courseMatchesPlan: courseMatchesPlan,
    countCoursesForPlan: countCoursesForPlan,
    isLegacyTierPlan: isLegacyTierPlan,
    isCatalogPricingPlan: isCatalogPricingPlan,
    getCatalogPricingPlans: getCatalogPricingPlans,
    normalizeSimulatorIds: normalizeSimulatorIds,
    simulatorFeatureLines: simulatorFeatureLines,
    findPlanBySourceCourse: findPlanBySourceCourse,
    upsertFromCourse: upsertFromCourse,
    planIdForCourse: function (courseId) {
      if (global.CoursePlanSync && global.CoursePlanSync.planIdForCourse) {
        return global.CoursePlanSync.planIdForCourse(courseId);
      }
      return 'plan_course_' + String(courseId || '');
    },
  };
})(typeof window !== 'undefined' ? window : this);
