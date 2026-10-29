/**
 * Sync course documents to pricing plans (Udemy-style: Course = Package).
 * Paid courses → plan_course_{courseId}; free courses → delete linked plan.
 */
(function (global) {
  'use strict';

  var LEGACY_TIER_IDS = { plan_free: true, plan_standard: true, plan_pro: true };
  var LEGACY_TIER_NAMES = {
    المجانية: true,
    القياسية: true,
    الاحترافية: true,
    Free: true,
    Standard: true,
    Pro: true,
  };

  function planIdForCourse(courseId) {
    return 'plan_course_' + String(courseId || '').trim();
  }

  function parseCoursePrice(course) {
    if (global.PlatformPlans && typeof global.PlatformPlans.parsePrice === 'function') {
      return global.PlatformPlans.parsePrice(course && course.price);
    }
    if (global.PlatformCourses && typeof global.PlatformCourses.parsePrice === 'function') {
      return global.PlatformCourses.parsePrice(course && course.price);
    }
    var n = Number(course && course.price);
    return isFinite(n) && n > 0 ? n : 0;
  }

  function normalizeCurrency(value) {
    if (global.PlatformPlans && typeof global.PlatformPlans.normalizeCurrency === 'function') {
      return global.PlatformPlans.normalizeCurrency(value);
    }
    return String(value || 'IQD').trim() || 'IQD';
  }

  function normalizeSimulatorIds(ids) {
    if (global.PlatformPlans && typeof global.PlatformPlans.normalizeSimulatorIds === 'function') {
      return global.PlatformPlans.normalizeSimulatorIds(ids);
    }
    return Array.isArray(ids)
      ? ids
          .map(function (id) {
            return String(id || '').trim();
          })
          .filter(Boolean)
      : [];
  }

  function simulatorFeatureLines(ids) {
    if (global.PlatformPlans && typeof global.PlatformPlans.simulatorFeatureLines === 'function') {
      return global.PlatformPlans.simulatorFeatureLines(ids);
    }
    return normalizeSimulatorIds(ids).map(function (text) {
      return { text: 'محاكي: ' + text, included: true };
    });
  }

  function buildPlanFromCourse(course) {
    if (!course || !course.id) return null;
    var sims = normalizeSimulatorIds(course.allowedSimulators);
    var lessonCount = Array.isArray(course.lessons) ? course.lessons.length : 0;
    var features = [{ text: 'وصول كامل للكورس: ' + (course.title || ''), included: true }];
    if (lessonCount) {
      features.push({ text: 'عدد الدروس: ' + lessonCount, included: true });
    }
    features = features.concat(simulatorFeatureLines(sims));

    return {
      planType: 'course',
      name: String(course.title || '').trim() || 'باقة الكورس',
      description: String(course.description || '').trim() || 'باقة وصول للكورس',
      price: parseCoursePrice(course),
      currency: normalizeCurrency(course.currency),
      period: 'شراء لمرة واحدة',
      ctaLabel: 'اشترِ الكورس',
      ctaStyle: 'primary',
      featured: false,
      badge: '',
      features: features,
      allowedSimulators: sims,
      sourceCourseId: String(course.id),
      includedCourseIds: [String(course.id)],
      courseCategories: course.category ? [course.category] : ['individual'],
    };
  }

  function usesFirestoreCourses() {
    return !!(
      global.PlatformCoursesFirestore &&
      typeof global.PlatformCoursesFirestore.isReady === 'function' &&
      global.PlatformCoursesFirestore.isReady()
    );
  }

  async function patchCourse(courseId, patch) {
    if (usesFirestoreCourses() && global.PlatformCoursesFirestore.updateCourse) {
      return global.PlatformCoursesFirestore.updateCourse(courseId, patch);
    }
    if (global.PlatformCourses && global.PlatformCourses.updateCourse) {
      return global.PlatformCourses.updateCourse(courseId, patch);
    }
    return null;
  }

  async function deletePlanIfExists(planId) {
    var FS = global.PlatformPricingFirestore;
    if (!FS || typeof FS.deletePlan !== 'function') return false;
    try {
      await FS.deletePlan(planId);
      return true;
    } catch (err) {
      return false;
    }
  }

  async function upsertPlan(planId, payload) {
    var FS = global.PlatformPricingFirestore;
    if (!FS) return null;
    if (typeof FS.upsertPlan === 'function') {
      return FS.upsertPlan(planId, payload);
    }
    if (FS.findPlan && FS.findPlan(planId)) {
      return FS.updatePlan(planId, payload);
    }
    if (typeof FS.addPlan === 'function') {
      return FS.addPlan(Object.assign({}, payload, { id: planId }));
    }
    return null;
  }

  async function syncPlanForCourse(course) {
    if (!course || !course.id) return course;
    if (course.suppressPricingPlan === true) return course;

    var planId = planIdForCourse(course.id);

    if (course.autoPricingPlan === false) {
      await deletePlanIfExists(planId);
      if (String(course.requiredPlanId || '') === planId) {
        return (await patchCourse(course.id, { requiredPlanId: '' })) || course;
      }
      return course;
    }

    var FS = global.PlatformPricingFirestore;
    var existingPlan = FS && typeof FS.findPlan === 'function' ? FS.findPlan(planId) : null;
    if (existingPlan && existingPlan.catalogHidden === true) return course;

    var price = parseCoursePrice(course);

    if (price <= 0) {
      await deletePlanIfExists(planId);
      if (String(course.requiredPlanId || '') === planId || course.autoPricingPlan) {
        return (
          (await patchCourse(course.id, {
            requiredPlanId: '',
            autoPricingPlan: false,
          })) || course
        );
      }
      return course;
    }

    var payload = buildPlanFromCourse(course);
    if (!payload) return course;

    await upsertPlan(planId, payload);

    if (String(course.requiredPlanId || '') === planId && course.autoPricingPlan) {
      return course;
    }

    return (
      (await patchCourse(course.id, {
        requiredPlanId: planId,
        autoPricingPlan: true,
        currency: normalizeCurrency(course.currency),
      })) || course
    );
  }

  async function deletePlanForCourse(courseId) {
    var key = String(courseId || '').trim();
    if (!key) return false;
    return deletePlanIfExists(planIdForCourse(key));
  }

  async function hidePlanForCourse(courseId, options) {
    options = options || {};
    var key = String(courseId || '').trim();
    if (!key) return false;

    await patchCourse(key, {
      autoPricingPlan: false,
      suppressPricingPlan: true,
    });

    var planId = planIdForCourse(key);
    var pricingFs = global.PlatformPricingFirestore;
    if (pricingFs) {
      if (options.hardDelete && typeof pricingFs.deletePlan === 'function') {
        await pricingFs.deletePlan(planId);
      } else if (typeof pricingFs.updatePlan === 'function') {
        await pricingFs.updatePlan(planId, { catalogHidden: true });
      }
    }
    return true;
  }

  function isLegacyTierPlan(plan) {
    if (!plan) return false;
    if (LEGACY_TIER_IDS[String(plan.id || '')]) return true;
    if (LEGACY_TIER_NAMES[String(plan.name || '').trim()]) return true;
    return false;
  }

  function isCatalogPricingPlan(plan) {
    if (!plan || isLegacyTierPlan(plan)) return false;
    if (plan.catalogHidden === true) return false;
    var price =
      global.PlatformPlans && typeof global.PlatformPlans.parsePrice === 'function'
        ? global.PlatformPlans.parsePrice(plan.price)
        : parseCoursePrice(plan);
    if (price <= 0) return false;

    var type = String(plan.planType || '').toLowerCase();
    if (type === 'course') {
      return !!String(plan.sourceCourseId || '').trim();
    }
    if (type === 'bundle') return true;
    if (String(plan.sourceCourseId || '').trim()) return true;
    if (Array.isArray(plan.includedCourseIds) && plan.includedCourseIds.length) return true;
    return !type;
  }

  var LESSON_FEATURE_MIGRATION_KEY = 'ifa_course_plan_lesson_feature_v2';

  async function resyncAllCoursePlans() {
    if (!global.PlatformCourses || typeof global.PlatformCourses.getCourses !== 'function') {
      return { ok: false, reason: 'courses-unavailable' };
    }
    var FS = global.PlatformPricingFirestore;
    if (!FS || typeof FS.isReady !== 'function' || !FS.isReady()) {
      return { ok: false, reason: 'pricing-not-ready' };
    }

    var courses = global.PlatformCourses.getCourses();
    var synced = 0;
    var i;
    for (i = 0; i < courses.length; i++) {
      var course = courses[i];
      if (!course || !course.id || parseCoursePrice(course) <= 0) continue;
      try {
        await syncPlanForCourse(course);
        synced += 1;
      } catch (err) {
        console.warn('[CoursePlanSync] resync failed for', course.id, err);
      }
    }
    return { ok: true, count: synced };
  }

  function tryRunLessonFeatureMigration(attempts) {
    try {
      if (localStorage.getItem(LESSON_FEATURE_MIGRATION_KEY) === '1') return;
    } catch (err) {
      return;
    }

    var coursesReady =
      global.PlatformCoursesFirestore &&
      typeof global.PlatformCoursesFirestore.isReady === 'function' &&
      global.PlatformCoursesFirestore.isReady();
    var pricingReady =
      global.PlatformPricingFirestore &&
      typeof global.PlatformPricingFirestore.isReady === 'function' &&
      global.PlatformPricingFirestore.isReady();

    if (!coursesReady || !pricingReady) {
      if (attempts > 80) return;
      setTimeout(function () {
        tryRunLessonFeatureMigration((attempts || 0) + 1);
      }, 100);
      return;
    }

    resyncAllCoursePlans()
      .then(function (result) {
        if (result && result.ok) {
          try {
            localStorage.setItem(LESSON_FEATURE_MIGRATION_KEY, '1');
          } catch (storeErr) {
            /* ignore */
          }
        }
      })
      .catch(function (err) {
        console.warn('[CoursePlanSync] lesson feature migration failed', err);
      });
  }

  global.CoursePlanSync = {
    planIdForCourse: planIdForCourse,
    buildPlanFromCourse: buildPlanFromCourse,
    syncPlanForCourse: syncPlanForCourse,
    resyncAllCoursePlans: resyncAllCoursePlans,
    deletePlanForCourse: deletePlanForCourse,
    hidePlanForCourse: hidePlanForCourse,
    isCatalogPricingPlan: isCatalogPricingPlan,
    isLegacyTierPlan: isLegacyTierPlan,
  };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        tryRunLessonFeatureMigration(0);
      });
    } else {
      tryRunLessonFeatureMigration(0);
    }
  }
})(typeof window !== 'undefined' ? window : this);
