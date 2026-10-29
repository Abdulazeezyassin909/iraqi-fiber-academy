/**
 * Admin UI — manage pricing plans (platform_plans).
 */
(function () {
  'use strict';

  var Plans = null;
  var editingId = null;
  var editingPlan = null;

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

  function featuresToText(features) {
    return (features || [])
      .map(function (f) {
        var mark = f.included === false ? '✗ ' : '';
        return mark + (f.text || '');
      })
      .join('\n');
  }

  function textToFeatures(text) {
    return String(text || '')
      .split(/\r?\n/)
      .map(function (line) {
        var t = line.trim();
        if (!t) return null;
        var included = true;
        if (/^[✗xX×]\s*/.test(t)) {
          included = false;
          t = t.replace(/^[✗xX×]\s*/, '');
        } else if (/^[-–]\s*/.test(t)) {
          included = false;
          t = t.replace(/^[-–]\s*/, '');
        }
        if (!t) return null;
        return { text: t, included: included };
      })
      .filter(Boolean);
  }

  function parsePriceValue(val) {
    if (Plans && typeof Plans.parsePrice === 'function') return Plans.parsePrice(val);
    if (window.PlatformCourses && typeof window.PlatformCourses.parsePrice === 'function') {
      return window.PlatformCourses.parsePrice(val);
    }
    var clean = String(val == null ? '' : val).replace(/,/g, '').trim();
    var n = Number(clean);
    return isFinite(n) && n >= 0 ? n : 0;
  }

  function formatPriceInputValue(val) {
    var n = parsePriceValue(val);
    if (!n) return '';
    if (Plans && typeof Plans.formatGroupedAmount === 'function') return Plans.formatGroupedAmount(n);
    if (window.PlatformCourses && typeof window.PlatformCourses.formatGroupedAmount === 'function') {
      return window.PlatformCourses.formatGroupedAmount(n);
    }
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function bindPriceInput(id) {
    var el = $(id);
    if (!el || el.dataset.priceBound === '1') return;
    el.dataset.priceBound = '1';
    el.addEventListener('blur', function () {
      if (!String(el.value || '').trim()) return;
      el.value = formatPriceInputValue(el.value);
    });
  }

  function readCategoriesFromForm() {
    var cats = [];
    if ($('planCatIndividual') && $('planCatIndividual').checked) cats.push('individual');
    if ($('planCatProgram') && $('planCatProgram').checked) cats.push('program');
    if ($('planCatMaster') && $('planCatMaster').checked) cats.push('master');
    return cats.length ? cats : ['individual'];
  }

  function writeCategoriesToForm(categories) {
    var set = {};
    (categories || []).forEach(function (c) {
      set[c] = true;
    });
    if ($('planCatIndividual')) $('planCatIndividual').checked = !!set.individual || !categories || !categories.length;
    if ($('planCatProgram')) $('planCatProgram').checked = !!set.program;
    if ($('planCatMaster')) $('planCatMaster').checked = !!set.master;
  }

  function countLinkedCourses(plan) {
    if (!plan || !window.PlatformCourses) return 0;
    var courses = window.PlatformCourses.getPublished
      ? window.PlatformCourses.getPublished()
      : [];
    if (Plans && typeof Plans.countCoursesForPlan === 'function') {
      return Plans.countCoursesForPlan(plan, courses);
    }
    return courses.filter(function (c) {
      return c && String(c.requiredPlanId || '') === String(plan.id);
    }).length;
  }

  function usesFirestorePricing() {
    return !!(
      window.PlatformPricingFirestore &&
      typeof window.PlatformPricingFirestore.isReady === 'function' &&
      window.PlatformPricingFirestore.isReady()
    );
  }

  function isPlansAdminDataLoading() {
    var Firestore = window.PlatformPricingFirestore;
    if (!Firestore) return true;
    return typeof Firestore.isReady === 'function' && !Firestore.isReady();
  }

  function isCourseManagedPlan(plan) {
    return !!(plan && String(plan.planType || '').toLowerCase() === 'course');
  }

  function getPlansList() {
    if (Plans && typeof Plans.isFirestoreBootstrapping === 'function' && Plans.isFirestoreBootstrapping()) {
      return [];
    }
    var plans = [];
    if (usesFirestorePricing()) {
      plans = window.PlatformPricingFirestore.getCachedPlans();
    } else if (Plans) {
      plans = Plans.getPlans();
    }
    if (window.CoursePlanSync && typeof window.CoursePlanSync.isLegacyTierPlan === 'function') {
      plans = plans.filter(function (plan) {
        return !window.CoursePlanSync.isLegacyTierPlan(plan);
      });
    }
    return plans;
  }

  function renderPlansList() {
    var list = $('adminPlansList');
    if (!list || (!Plans && !window.PlatformPricingFirestore)) return;
    var plans = getPlansList();
    if (!plans.length) {
      var emptyMessage = isPlansAdminDataLoading()
        ? 'جاري تحميل الباقات…'
        : 'لا توجد باقات بعد. أضف باقة جديدة.';
      list.innerHTML =
        '<div class="admin-empty" role="status"><p>' + emptyMessage + '</p></div>';
      return;
    }
    list.innerHTML = plans
      .map(function (plan) {
        var priceLabel =
          Plans && typeof Plans.formatPrice === 'function'
            ? Plans.formatPrice(plan)
            : parsePriceValue(plan.price) === 0
              ? 'مجاناً'
              : escapeHtml(formatPriceInputValue(plan.price)) + ' د.ع';
        var linked = countLinkedCourses(plan);
        return (
          '<article class="admin-plan-card' +
          (plan.featured ? ' admin-plan-card--featured' : '') +
          '" data-plan-id="' +
          escapeHtml(plan.id) +
          '">' +
          '<div class="admin-plan-card__top">' +
          '<div>' +
          '<h3 class="admin-plan-card__name">' +
          escapeHtml(plan.name) +
          (plan.featured
            ? ' <span class="admin-plan-card__badge">' +
              escapeHtml(plan.badge || 'مميزة') +
              '</span>'
            : '') +
          '</h3>' +
          '<p class="admin-plan-card__desc">' +
          escapeHtml(plan.description || '—') +
          '</p>' +
          '<p class="admin-plan-card__meta">' +
          (isCourseManagedPlan(plan) ? 'باقة كورس · ' : 'باقة مخصصة · ') +
          linked +
          ' كورس منشور · ' +
          (Array.isArray(plan.allowedSimulators) ? plan.allowedSimulators.length : 0) +
          ' محاكيات</p>' +
          '</div>' +
          '<div class="admin-plan-card__price">' +
          '<strong>' +
          priceLabel +
          '</strong>' +
          '<span>' +
          escapeHtml(plan.period || '') +
          '</span>' +
          '</div>' +
          '</div>' +
          '<ul class="admin-plan-card__features">' +
          (plan.features || [])
            .slice(0, 6)
            .map(function (f) {
              return (
                '<li class="' +
                (f.included === false ? 'is-disabled' : '') +
                '">' +
                (f.included === false ? '✗ ' : '✓ ') +
                escapeHtml(f.text) +
                '</li>'
              );
            })
            .join('') +
          '</ul>' +
          '<div class="admin-plan-card__actions">' +
          '<button type="button" class="admin-btn admin-btn--ghost admin-btn--sm" data-edit-plan="' +
          escapeHtml(plan.id) +
          '">تعديل</button>' +
          '<button type="button" class="admin-btn admin-btn--danger admin-btn--sm" data-delete-plan="' +
          escapeHtml(plan.id) +
          '">حذف</button>' +
          '</div>' +
          '</article>'
        );
      })
      .join('');
  }

  function writeSimulatorChecks(ids) {
    var selected = {};
    (ids || []).forEach(function (id) {
      selected[String(id)] = true;
    });
    document.querySelectorAll('#planEditorSimulators input[name="planSimulator"]').forEach(function (input) {
      input.checked = !!selected[input.value];
    });
  }

  function readSimulatorChecks() {
    var ids = [];
    document.querySelectorAll('#planEditorSimulators input[name="planSimulator"]:checked').forEach(function (input) {
      if (input.value) ids.push(input.value);
    });
    if (window.PlatformSimulators && typeof window.PlatformSimulators.normalizeSimulatorIds === 'function') {
      return window.PlatformSimulators.normalizeSimulatorIds(ids);
    }
    if (Plans && typeof Plans.normalizeSimulatorIds === 'function') {
      return Plans.normalizeSimulatorIds(ids);
    }
    return ids;
  }

  function openModal(plan) {
    editingId = plan ? String(plan.id) : null;
    editingPlan = plan || null;
    var modal = $('planEditorModal');
    var title = $('planEditorTitle');
    if (!modal) return;
    if (title) title.textContent = plan ? 'تعديل الباقة' : 'إضافة باقة جديدة';
    $('planEditorName').value = plan ? plan.name : '';
    $('planEditorDescription').value = plan ? plan.description || '' : '';
    $('planEditorPrice').value = plan ? formatPriceInputValue(plan.price) : '';
    $('planEditorCurrency').value = plan ? plan.currency || 'ر.س' : 'ر.س';
    $('planEditorPeriod').value = plan ? plan.period || '' : 'شهرياً';
    $('planEditorCta').value = plan ? plan.ctaLabel || 'اشترك الآن' : 'اشترك الآن';
    $('planEditorCtaStyle').value = plan && plan.ctaStyle === 'primary' ? 'primary' : 'outline';
    $('planEditorFeatured').checked = !!(plan && plan.featured);
    $('planEditorBadge').value = plan ? plan.badge || '' : '';
    $('planEditorFeatures').value = plan ? featuresToText(plan.features) : '';
    writeCategoriesToForm(plan ? plan.courseCategories : ['individual']);
    writeSimulatorChecks(plan ? plan.allowedSimulators : []);
    modal.hidden = false;
    var scroll = modal.querySelector('.admin-modal__scroll');
    if (scroll) scroll.scrollTop = 0;
  }

  function closeModal() {
    var modal = $('planEditorModal');
    if (modal) modal.hidden = true;
    editingId = null;
    editingPlan = null;
  }

  function collectPayload() {
    var isCoursePlan =
      editingPlan && String(editingPlan.planType || '').toLowerCase() === 'course';
    var payload = {
      planType: isCoursePlan ? 'course' : 'bundle',
      name: $('planEditorName').value.trim(),
      description: $('planEditorDescription').value.trim(),
      price: parsePriceValue($('planEditorPrice') && $('planEditorPrice').value),
      currency: $('planEditorCurrency').value.trim() || 'ر.س',
      period: $('planEditorPeriod').value.trim(),
      courseCategories: readCategoriesFromForm(),
      ctaLabel: $('planEditorCta').value.trim() || 'اشترك الآن',
      ctaStyle: $('planEditorCtaStyle').value,
      featured: $('planEditorFeatured').checked,
      badge: $('planEditorBadge').value.trim(),
      features: textToFeatures($('planEditorFeatures').value),
      allowedSimulators: readSimulatorChecks(),
      includedCourseIds:
        editingPlan && Array.isArray(editingPlan.includedCourseIds)
          ? editingPlan.includedCourseIds.slice()
          : [],
    };
    if (isCoursePlan && editingPlan.sourceCourseId) {
      payload.sourceCourseId = editingPlan.sourceCourseId;
    }
    return payload;
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (!Plans && !window.PlatformPricingFirestore) return;
    var payload = collectPayload();
    var Firestore = window.PlatformPricingFirestore;
    try {
      if (usesFirestorePricing() && Firestore && typeof Firestore.addPlan === 'function') {
        if (editingId) {
          await Firestore.updatePlan(editingId, payload);
          toast('تم تحديث الباقة — ستظهر على الموقع فوراً');
        } else {
          await Firestore.addPlan(payload);
          toast('تمت إضافة الباقة — ستظهر على الموقع فوراً');
        }
      } else if (Plans) {
        if (editingId) {
          Plans.updatePlan(editingId, payload);
          toast('تم تحديث الباقة — ستظهر على الموقع فوراً');
        } else {
          Plans.addPlan(payload);
          toast('تمت إضافة الباقة — ستظهر على الموقع فوراً');
        }
      }
      closeModal();
      renderPlansList();
    } catch (err) {
      toast((err && err.message) || 'تعذّر الحفظ', true);
    }
  }

  async function handleDeletePlan(id) {
    var key = String(id || '').trim();
    if (!key || (!Plans && !window.PlatformPricingFirestore)) return;
    var plan =
      window.PlatformPricingFirestore && window.PlatformPricingFirestore.findPlan
        ? window.PlatformPricingFirestore.findPlan(key)
        : Plans && Plans.findPlan
          ? Plans.findPlan(key)
          : null;

    var isCoursePlan = isCourseManagedPlan(plan);
    var confirmMsg = isCoursePlan
      ? 'إخفاء باقة الكورس من صفحة الأسعار؟ (الكورس سيبقى موجوداً في قسم الكورسات)'
      : 'هل أنت متأكد من حذف هذه الباقة من الموقع؟';
    if (!window.confirm(confirmMsg)) return;

    try {
      if (isCoursePlan) {
        if (
          !window.CoursePlanSync ||
          typeof window.CoursePlanSync.hidePlanForCourse !== 'function' ||
          !plan ||
          !plan.sourceCourseId
        ) {
          throw new Error('تعذّر إخفاء باقة الكورس');
        }
        await window.CoursePlanSync.hidePlanForCourse(plan.sourceCourseId, { hardDelete: true });
        toast('تم إخفاء الباقة من صفحة الأسعار بنجاح');
      } else {
        var Firestore = window.PlatformPricingFirestore;
        if (Firestore && typeof Firestore.deletePlan === 'function') {
          await Firestore.deletePlan(key);
        } else if (Plans) {
          Plans.deletePlan(key);
        }
        toast('تم حذف الباقة بنجاح');
      }
      renderPlansList();
    } catch (err) {
      toast((err && err.message) || 'تعذّر الحذف', true);
      renderPlansList();
    }
  }

  function handleEditPlan(id) {
    var Firestore = window.PlatformPricingFirestore;
    var plan =
      Firestore && typeof Firestore.findPlan === 'function'
        ? Firestore.findPlan(id)
        : Plans && Plans.findPlan
          ? Plans.findPlan(id)
          : null;
    if (plan) openModal(plan);
  }

  function bind() {
    Plans = window.PlatformPlans;
    if (!Plans && !window.PlatformPricingFirestore) {
      console.warn('[AdminPlans] PlatformPlans and PlatformPricingFirestore missing');
      return;
    }

    var addBtn = $('addPlanBtn');
    if (addBtn) {
      addBtn.addEventListener('click', function () {
        openModal(null);
      });
    }

    var form = $('planEditorForm');
    if (form) form.addEventListener('submit', onSubmit);
    bindPriceInput('planEditorPrice');

    document.querySelectorAll('[data-close-plan-modal]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        closeModal();
      });
    });

    // Single document-level delegation (survives re-renders)
    document.addEventListener('click', function (e) {
      var target = e.target;
      if (!target || typeof target.closest !== 'function') return;
      var delBtn = target.closest('#adminPlansList [data-delete-plan]');
      if (delBtn) {
        e.preventDefault();
        e.stopPropagation();
        handleDeletePlan(delBtn.getAttribute('data-delete-plan'));
        return;
      }
      var editBtn = target.closest('#adminPlansList [data-edit-plan]');
      if (editBtn) {
        e.preventDefault();
        handleEditPlan(editBtn.getAttribute('data-edit-plan'));
      }
    });

    document.addEventListener('ifa:pricing-firestore-changed', renderPlansList);
    window.addEventListener('ifa:pricing-firestore-changed', renderPlansList);
    document.addEventListener('ifa:platform-plans-changed', renderPlansList);
    window.addEventListener('ifa:platform-plans-changed', renderPlansList);
    document.addEventListener('ifa:platform-courses-changed', renderPlansList);
    window.addEventListener('storage', function (e) {
      if (usesFirestorePricing()) return;
      if (!e.key || e.key === 'platform_plans' || e.key === 'ifa_pricing_plans' || e.key === 'platform_courses') {
        renderPlansList();
      }
    });

    (function waitForFirestoreSubscribe(attempts) {
      if (window.PlatformPricingFirestore && typeof window.PlatformPricingFirestore.subscribe === 'function') {
        window.PlatformPricingFirestore.subscribe(function () {
          renderPlansList();
        });
        return;
      }
      if (attempts > 40) return;
      window.setTimeout(function () {
        waitForFirestoreSubscribe(attempts + 1);
      }, 50);
    })(0);

    renderPlansList();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
