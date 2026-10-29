/**
 * Render subscription plans on the public homepage from platform_plans.
 * Shows access-tier correlation with published courses + dynamic CTA by user state.
 */
(function () {
  'use strict';

  var GRID_SELECTOR = '#publicPricingGrid, .pricing__grid';
  var AUTH_KEY = 'ifa_auth_user';
  var PLANS_KEY = 'platform_plans';
  var PLANS_LEGACY_KEY = 'ifa_pricing_plans';
  var lastSignature = '';
  var pendingPlanIds = {};
  var pendingOrdersUnsub = null;

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function readAuthUser() {
    if (window.IFAAuth && typeof window.IFAAuth.getLocalAuthUser === 'function') {
      return window.IFAAuth.getLocalAuthUser();
    }
    try {
      var raw = localStorage.getItem(AUTH_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && parsed.email ? parsed : null;
    } catch (err) {
      return null;
    }
  }

  function readRawPlansList(key) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch (err) {
      return null;
    }
  }

  function hasCachedPlansInStorage() {
    var list = readRawPlansList(PLANS_KEY) || readRawPlansList(PLANS_LEGACY_KEY);
    return !!(list && list.length);
  }

  function isLegacyTierPlan(plan) {
    if (window.PlatformPlans && typeof window.PlatformPlans.isLegacyTierPlan === 'function') {
      return window.PlatformPlans.isLegacyTierPlan(plan);
    }
    if (window.CoursePlanSync && typeof window.CoursePlanSync.isLegacyTierPlan === 'function') {
      return window.CoursePlanSync.isLegacyTierPlan(plan);
    }
    var id = String(plan && plan.id ? plan.id : '');
    if (id === 'plan_free' || id === 'plan_standard' || id === 'plan_pro') return true;
    var name = String(plan && plan.name ? plan.name : '').trim();
    return name === 'المجانية' || name === 'القياسية' || name === 'الاحترافية';
  }

  function filterPublicCatalogPlans(list) {
    return (list || []).filter(function (plan) {
      if (!plan || isLegacyTierPlan(plan)) return false;
      if (window.CoursePlanSync && typeof window.CoursePlanSync.isCatalogPricingPlan === 'function') {
        return window.CoursePlanSync.isCatalogPricingPlan(plan);
      }
      if (window.PlatformPlans && typeof window.PlatformPlans.isCatalogPricingPlan === 'function') {
        return window.PlatformPlans.isCatalogPricingPlan(plan);
      }
      return true;
    });
  }

  function getPlansFromStorageOnly() {
    var list = readRawPlansList(PLANS_KEY);
    if (!list) list = readRawPlansList(PLANS_LEGACY_KEY);
    return filterPublicCatalogPlans(list || []);
  }

  function usesFirestorePricing() {
    return !!(
      window.PlatformPricingFirestore &&
      typeof window.PlatformPricingFirestore.isReady === 'function' &&
      window.PlatformPricingFirestore.isReady()
    );
  }

  function isPlansDataLoading() {
    if (window.PlatformPlans && typeof window.PlatformPlans.isFirestoreBootstrapping === 'function') {
      if (window.PlatformPlans.isFirestoreBootstrapping()) return true;
    }
    var FS = window.PlatformPricingFirestore;
    if (FS && typeof FS.isReady === 'function' && !FS.isReady()) return true;
    return false;
  }

  function getAllPlansRaw() {
    if (usesFirestorePricing()) {
      return window.PlatformPricingFirestore.getCachedPlans();
    }
    if (window.PlatformPlans && typeof window.PlatformPlans.getPlans === 'function') {
      return window.PlatformPlans.getPlans();
    }
    var list = readRawPlansList(PLANS_KEY);
    if (!list) list = readRawPlansList(PLANS_LEGACY_KEY);
    return list || [];
  }

  function getPlans() {
    if (window.PlatformPlans && typeof window.PlatformPlans.getCatalogPricingPlans === 'function') {
      return window.PlatformPlans.getCatalogPricingPlans();
    }
    return filterPublicCatalogPlans(getAllPlansRaw());
  }

  function getPublishedCourses() {
    if (window.PlatformCourses && typeof window.PlatformCourses.getPublished === 'function') {
      return window.PlatformCourses.getPublished();
    }
    return [];
  }

  function courseCountForPlan(plan) {
    if (window.PlatformPlans && typeof window.PlatformPlans.countCoursesForPlan === 'function') {
      return window.PlatformPlans.countCoursesForPlan(plan, getPublishedCourses());
    }
    return 0;
  }

  function planIdForCourseId(courseId) {
    if (window.CoursePlanSync && typeof window.CoursePlanSync.planIdForCourse === 'function') {
      return window.CoursePlanSync.planIdForCourse(courseId);
    }
    return 'plan_course_' + String(courseId || '').trim();
  }

  function isPlanPending(planId) {
    return !!pendingPlanIds[String(planId || '')];
  }

  function isFreeTierPlan(plan) {
    if (!plan) return false;
    var price =
      window.PlatformPlans && typeof window.PlatformPlans.parsePrice === 'function'
        ? window.PlatformPlans.parsePrice(plan.price)
        : Number(plan.price);
    if (isFinite(price) && price <= 0) return true;
    var level = String(plan.accessLevel || '').toLowerCase();
    return level === 'free';
  }

  function userHasActiveTrial(user) {
    if (!user) return false;
    if (window.IFAAuth && typeof window.IFAAuth.hasActiveTrial === 'function' && window.IFAAuth.hasActiveTrial(user)) {
      return true;
    }
    return Number(user.trialExpiresAt) > Date.now();
  }

  function userHasPlanAccess(plan, user) {
    if (!plan || !user || !user.email) return false;
    if (user.isAdmin || user.isInstructor || String(user.role || '').toLowerCase() === 'admin') return true;
    if (userHasActiveTrial(user) && isFreeTierPlan(plan)) return true;

    var planId = String(plan.id || '');
    if (planId && String(user.planId || '') === planId) return true;

    var enrolled = Array.isArray(user.enrolledCourseIds) ? user.enrolledCourseIds.map(String) : [];
    var sourceCourseId = String(plan.sourceCourseId || '').trim();
    if (sourceCourseId && enrolled.indexOf(sourceCourseId) !== -1) return true;

    var included = Array.isArray(plan.includedCourseIds) ? plan.includedCourseIds : [];
    for (var i = 0; i < included.length; i++) {
      if (enrolled.indexOf(String(included[i])) !== -1) return true;
    }

    var courses = getPublishedCourses();
    for (var j = 0; j < courses.length; j++) {
      var course = courses[j];
      if (String(course.requiredPlanId || '') === planId && enrolled.indexOf(String(course.id)) !== -1) {
        return true;
      }
    }
    return false;
  }

  function getPlanContinueUrl(plan) {
    if (!plan) return 'index.html#courses';
    var sourceCourseId = String(plan.sourceCourseId || '').trim();
    if (sourceCourseId) {
      return 'course-details.html?id=' + encodeURIComponent(sourceCourseId);
    }
    var included = Array.isArray(plan.includedCourseIds) ? plan.includedCourseIds : [];
    if (included.length) {
      return 'course-details.html?id=' + encodeURIComponent(String(included[0]));
    }
    var planId = String(plan.id || '');
    var courses = getPublishedCourses();
    for (var i = 0; i < courses.length; i++) {
      if (String(courses[i].requiredPlanId || '') === planId) {
        return 'course-details.html?id=' + encodeURIComponent(String(courses[i].id));
      }
    }
    if (Array.isArray(plan.allowedSimulators) && plan.allowedSimulators.length) {
      return 'index.html#demo';
    }
    return 'index.html#courses';
  }

  function resolvePlanCta(plan) {
    var user = readAuthUser();
    var planId = String(plan.id || '');
    var defaultLabel = plan.ctaLabel || (plan.planType === 'course' ? 'اشترِ الكورس' : 'اشترك الآن');

    if (user && isPlanPending(planId)) {
      return {
        state: 'pending',
        label: 'قيد المراجعة',
        href: '',
        disabled: true,
      };
    }

    if (user && userHasPlanAccess(plan, user)) {
      return {
        state: 'owned',
        label: 'متابعة التعلم',
        href: getPlanContinueUrl(plan),
        disabled: false,
      };
    }

    return {
      state: 'available',
      label: defaultLabel,
      href: 'checkout.html?planId=' + encodeURIComponent(planId),
      disabled: false,
    };
  }

  function viewerSignature() {
    var user = readAuthUser();
    var pending = Object.keys(pendingPlanIds).sort().join(',');
    if (!user) return 'guest::' + pending;
    return [
      user.email || '',
      user.isSubscriber ? '1' : '0',
      user.planId || '',
      (Array.isArray(user.enrolledCourseIds) ? user.enrolledCourseIds.join(',') : ''),
      pending,
    ].join('|');
  }

  function signature(plans) {
    var courses = getPublishedCourses();
    return (
      plans
        .map(function (p) {
          return [
            p.id,
            p.name,
            p.price,
            p.period,
            p.accessLevel || '',
            p.updatedAt || '',
            (p.features || []).length,
            courseCountForPlan(p),
          ].join(':');
        })
        .join('|') +
      '::' +
      courses.length +
      '##' +
      viewerSignature()
    );
  }

  function renderPlanCta(plan, btnClass) {
    var cta = resolvePlanCta(plan);
    var planId = escapeHtml(plan.id);

    if (cta.state === 'owned') {
      return (
        '<a class="' +
        btnClass +
        '" href="' +
        escapeHtml(cta.href) +
        '" data-plan="' +
        planId +
        '" data-plan-action="continue" data-plan-href="' +
        escapeHtml(cta.href) +
        '">' +
        escapeHtml(cta.label) +
        '</a>'
      );
    }

    if (cta.state === 'pending') {
      return (
        '<button class="' +
        btnClass +
        ' pricing-card__btn--pending" type="button" disabled aria-disabled="true" data-plan="' +
        planId +
        '" data-plan-state="pending">' +
        escapeHtml(cta.label) +
        '</button>'
      );
    }

    return (
      '<button class="' +
      btnClass +
      '" type="button" data-plan="' +
      planId +
      '" data-plan-action="checkout">' +
      escapeHtml(cta.label) +
      '</button>'
    );
  }

  function renderPlanCard(plan) {
    var featured = plan.featured ? ' pricing-card--featured' : '';
    var badge =
      plan.featured && plan.badge
        ? '<span class="pricing-card__badge">' + escapeHtml(plan.badge) + '</span>'
        : '';
    var currencyText =
      window.PlatformPlans && typeof window.PlatformPlans.currencyLabel === 'function'
        ? window.PlatformPlans.currencyLabel(plan.currency)
        : plan.currency === 'USD' || plan.currency === '$'
          ? '$'
          : 'د.ع';
    var grouped =
      window.PlatformPlans && typeof window.PlatformPlans.formatGroupedAmount === 'function'
        ? window.PlatformPlans.formatGroupedAmount(plan.price)
        : String(plan.price || 0);
    var amount =
      Number(plan.price) === 0
        ? '0 <span>' + escapeHtml(currencyText) + '</span>'
        : escapeHtml(grouped) +
          ' <span>' +
          escapeHtml(currencyText) +
          '</span>';
    var count = courseCountForPlan(plan);
    var simCount = Array.isArray(plan.allowedSimulators) ? plan.allowedSimulators.length : 0;
    var isCoursePlan = String(plan.planType || '').toLowerCase() === 'course';
    var accessNote = '';
    if (!isCoursePlan) {
      accessNote =
        '<li><span class="pricing-card__check">✓</span> ' +
        (count ? 'يشمل ' + count + ' كورساً منشوراً' : 'باقة مخصصة') +
        '</li>' +
        (simCount
          ? '<li><span class="pricing-card__check">✓</span> ' + simCount + ' محاكيات مضمّنة</li>'
          : '');
    }
    var features = (plan.features || [])
      .map(function (f) {
        var ok = f.included !== false;
        return (
          '<li><span class="pricing-card__check' +
          (ok ? '' : ' pricing-card__check--disabled') +
          '">' +
          (ok ? '✓' : '✗') +
          '</span> ' +
          escapeHtml(f.text) +
          '</li>'
        );
      })
      .join('');
    var btnClass =
      plan.ctaStyle === 'primary'
        ? 'pricing-card__btn pricing-card__btn--primary'
        : 'pricing-card__btn pricing-card__btn--outline';
    var cta = resolvePlanCta(plan);
    var stateClass =
      cta.state === 'owned'
        ? ' pricing-card--owned'
        : cta.state === 'pending'
          ? ' pricing-card--pending'
          : '';

    return (
      '<article class="pricing-card fade-in visible' +
      featured +
      stateClass +
      '" data-plan-id="' +
      escapeHtml(plan.id) +
      '" data-access-level="' +
      escapeHtml(plan.accessLevel || '') +
      '" data-plan-cta-state="' +
      escapeHtml(cta.state) +
      '">' +
      badge +
      '<h3 class="pricing-card__name">' +
      escapeHtml(plan.name) +
      '</h3>' +
      '<p class="pricing-card__desc">' +
      escapeHtml(plan.description || '') +
      '</p>' +
      '<div class="pricing-card__price">' +
      '<div class="pricing-card__amount">' +
      amount +
      '</div>' +
      '<div class="pricing-card__period">' +
      escapeHtml(plan.period || '') +
      '</div>' +
      '</div>' +
      '<ul class="pricing-card__features">' +
      accessNote +
      features +
      '</ul>' +
      renderPlanCta(plan, btnClass) +
      '</article>'
    );
  }

  function renderPublicPlans(force) {
    var grid = document.querySelector(GRID_SELECTOR);
    if (!grid) return;
    var plans = getPlans();
    var sig = signature(plans);
    if (!force && sig === lastSignature && grid.childElementCount) return;
    lastSignature = sig;

    if (!plans.length) {
      var emptyMessage = isPlansDataLoading()
        ? 'جاري تحميل الباقات…'
        : 'لا توجد باقات متاحة حالياً.';
      grid.innerHTML =
        '<p class="section__subtitle" style="grid-column:1/-1;text-align:center;">' +
        emptyMessage +
        '</p>';
      return;
    }
    grid.innerHTML = plans.map(renderPlanCard).join('');
  }

  function findPlanById(planId) {
    if (window.PlatformPlans && typeof window.PlatformPlans.findPlan === 'function') {
      return window.PlatformPlans.findPlan(planId);
    }
    var plans = getAllPlansRaw();
    for (var i = 0; i < plans.length; i++) {
      if (String(plans[i].id) === String(planId)) return plans[i];
    }
    return null;
  }

  function handlePlanClick(button) {
    if (!button) return false;
    var planId = button.getAttribute('data-plan') || '';
    if (!planId) return false;

    if (button.getAttribute('data-plan-state') === 'pending' || button.disabled) {
      return true;
    }

    var planAction = button.getAttribute('data-plan-action') || '';
    var continueHref = button.getAttribute('data-plan-href') || button.getAttribute('href') || '';
    if (planAction === 'continue' && continueHref) {
      window.location.href = continueHref;
      return true;
    }

    var plan = findPlanById(planId);
    var user = readAuthUser();
    if (plan && user && userHasPlanAccess(plan, user)) {
      window.location.href = getPlanContinueUrl(plan);
      return true;
    }

    var planName = (plan && plan.name) || planId;
    var checkoutUrl = 'checkout.html?planId=' + encodeURIComponent(planId);

    if (plan && Number(plan.price) > 0) {
      window.location.href = checkoutUrl;
      return true;
    }

    if (window.PlatformSimulators && typeof window.PlatformSimulators.subscribeCurrentUserToPlan === 'function') {
      try {
        window.PlatformSimulators.subscribeCurrentUserToPlan(planId);
        alert('تم تفعيل اشتراكك في باقة: ' + planName + '\nستظهر المحاكيات المسموحة في قسم المحاكيات.');
        renderPublicPlans(true);
        return true;
      } catch (err) {
        alert((err && err.message) || 'تعذر تفعيل الاشتراك.\nالباقة المختارة: ' + planName);
        return true;
      }
    }

    window.location.href = checkoutUrl;
    return true;
  }

  function applyPendingOrdersSnapshot(docs) {
    pendingPlanIds = {};
    (docs || []).forEach(function (entry) {
      var data = entry.data ? entry.data() : entry;
      if (!data || String(data.status || '') !== 'pending') return;
      if (data.planId) pendingPlanIds[String(data.planId)] = true;
      if (data.courseId) pendingPlanIds[planIdForCourseId(data.courseId)] = true;
    });
    renderPublicPlans(true);
  }

  function subscribePendingOrders() {
    if (pendingOrdersUnsub) {
      pendingOrdersUnsub();
      pendingOrdersUnsub = null;
    }
    pendingPlanIds = {};

    import('./firebase-config.js')
      .then(function (mod) {
        return import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js').then(function (fs) {
          mod.auth.onAuthStateChanged(function (user) {
            if (pendingOrdersUnsub) {
              pendingOrdersUnsub();
              pendingOrdersUnsub = null;
            }
            pendingPlanIds = {};
            if (!user) {
              renderPublicPlans(true);
              return;
            }

            var ordersQuery = fs.query(
              fs.collection(mod.db, 'orders'),
              fs.where('userId', '==', user.uid)
            );
            pendingOrdersUnsub = fs.onSnapshot(
              ordersQuery,
              function (snap) {
                applyPendingOrdersSnapshot(snap.docs);
              },
              function (err) {
                console.warn('[PlatformPlansPublic] pending orders snapshot failed', err);
              }
            );
          });
        });
      })
      .catch(function (err) {
        console.warn('[PlatformPlansPublic] could not subscribe to pending orders', err);
      });
  }

  function bind() {
    renderPublicPlans(true);
    subscribePendingOrders();

    window.addEventListener('storage', function (e) {
      if (!e.key || e.key === AUTH_KEY || e.key === 'platform_plans' || e.key === 'platform_courses') {
        renderPublicPlans(true);
      }
      if (usesFirestorePricing()) return;
      if (e.key === 'platform_plans' || e.key === 'platform_courses') {
        renderPublicPlans(true);
      }
    });

    document.addEventListener('ifa:local-auth-changed', function () {
      renderPublicPlans(true);
    });
    window.addEventListener('ifa:local-auth-changed', function () {
      renderPublicPlans(true);
    });
    document.addEventListener('ifa:subscription-changed', function () {
      renderPublicPlans(true);
    });
    window.addEventListener('ifa:subscription-changed', function () {
      renderPublicPlans(true);
    });

    document.addEventListener('ifa:pricing-firestore-changed', function () {
      renderPublicPlans(true);
    });
    window.addEventListener('ifa:pricing-firestore-changed', function () {
      renderPublicPlans(true);
    });
    document.addEventListener('ifa:platform-plans-changed', function () {
      renderPublicPlans(true);
    });
    window.addEventListener('ifa:platform-plans-changed', function () {
      renderPublicPlans(true);
    });
    document.addEventListener('ifa:platform-courses-changed', function () {
      renderPublicPlans(true);
    });
    window.addEventListener('ifa:platform-courses-changed', function () {
      renderPublicPlans(true);
    });

    (function waitForFirestoreSubscribe(attempts) {
      if (window.PlatformPricingFirestore && typeof window.PlatformPricingFirestore.subscribe === 'function') {
        window.PlatformPricingFirestore.subscribe(function () {
          renderPublicPlans(true);
        });
        return;
      }
      if (attempts > 40) return;
      window.setTimeout(function () {
        waitForFirestoreSubscribe(attempts + 1);
      }, 50);
    })(0);

    window.setInterval(function () {
      var next = signature(getPlans());
      if (next !== lastSignature) renderPublicPlans(true);
    }, 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }

  window.renderPublicPlans = renderPublicPlans;
  window.PlatformPlansPublic = {
    readAuthUser: readAuthUser,
    userHasPlanAccess: userHasPlanAccess,
    isPlanPending: isPlanPending,
    resolvePlanCta: resolvePlanCta,
    getPlanContinueUrl: getPlanContinueUrl,
    handlePlanClick: handlePlanClick,
    findPlanById: findPlanById,
  };
})();
