/**
 * Admin dashboard shell — hash router, sidebar, overview stats.
 */
(function () {
  'use strict';

  function bind() {
    var sidebar = document.getElementById('adminSidebar');
    var overlay = document.getElementById('adminOverlay');
    var toggle = document.getElementById('adminMenuToggle');
    var navLinks = document.querySelectorAll('.admin-nav__link, .admin-nav__sublink');
    var topbarTitle = document.querySelector('.admin-topbar__title');
    var topbarSubtitle = document.querySelector('.admin-topbar__subtitle');

    var SITE_VIEWS = {
      'site-simulator-showcase': true,
      'site-hero-slideshow': true,
      'site-articles': true,
      'site-faq': true,
      'site-testimonials': true,
      'admin-instructors-section': true,
      'site-preview': true,
      'site-footer': true,
    };

    var VIEW_META = {
      overview: { title: 'نظرة عامة', subtitle: 'ENGINEER PATH °360 Admin — منصة المسار المهني الهندسي' },
      users: { title: 'إدارة المستخدمين', subtitle: 'عرض وإدارة حسابات الطلاب' },
      'site-stats': { title: 'إدارة الإحصائيات', subtitle: 'Website Statistics — أرقام قسم الإحصائيات على الصفحة الرئيسية' },
      instructors: { title: 'إدارة المدربين', subtitle: 'طلبات الانضمام وحسابات المدربين' },
      courses: { title: 'الكورسات', subtitle: 'إنشاء وإدارة ونشر الكورسات التعليمية' },
      plans: { title: 'الباقات والأسعار', subtitle: 'إدارة خطط الاشتراك المعروضة على الموقع' },
      orders: { title: 'طلبات الشراء', subtitle: 'مراجعة أواصر الدفع اليدوي وقبول أو رفض الطلبات' },
      'settings-checkout': {
        title: 'إعدادات الدفع والإشعارات',
        subtitle: 'بريد الإشعارات وأرقام الدفع اليدوي لصفحة الشراء',
      },
      'site-simulator-showcase': {
        title: 'إدارة المحاكيات',
        subtitle: 'بطاقات الشبكة وعرض الدوران على الصفحة الرئيسية',
      },
      simulators: {
        title: 'إدارة موقعي',
        subtitle: 'إدارة المحاكيات — بطاقات الشبكة وعرض الدوران',
      },
      'site-hero-slideshow': { title: 'إدارة موقعي', subtitle: 'الصفحة الرئيسية — Homepage' },
      'site-articles': { title: 'المقالات التقنية', subtitle: 'إضافة وتعديل المقالات المعروضة في الصفحة الرئيسية' },
      'site-faq': { title: 'الأسئلة الشائعة', subtitle: 'إدارة الأسئلة والأجوبة في الصفحة الرئيسية' },
      'site-testimonials': { title: 'آراء المستخدمين', subtitle: 'إدارة آراء وتقييمات المستخدمين' },
      'admin-instructors-section': { title: 'مدربونا', subtitle: 'ملفات المدربين الظاهرة في الموقع العام' },
      'site-preview': { title: 'معاينة الموقع', subtitle: 'معاينة الموقع المباشر' },
      'site-footer': { title: 'إدارة موقعي', subtitle: 'Footer Settings — وصف العلامة وروابط التواصل' },
      settings: { title: 'الإعدادات', subtitle: 'إعدادات النظام' },
    };

    function closeSidebar() {
      sidebar.classList.remove('open');
      overlay.classList.remove('visible');
    }

    function openSidebar() {
      sidebar.classList.add('open');
      overlay.classList.add('visible');
    }

    function showAdminView(sectionId) {
      var id = VIEW_META[sectionId] ? sectionId : 'overview';
      if (id === 'simulators') id = 'site-simulator-showcase';
      document.querySelectorAll('[data-admin-view]').forEach(function (view) {
        view.hidden = view.getAttribute('data-admin-view') !== id;
      });
      navLinks.forEach(function (link) {
        var section = link.getAttribute('data-section');
        var active = section === id;
        if (link.hasAttribute('data-site-parent')) {
          active = !!SITE_VIEWS[id];
        }
        link.classList.toggle('active', active);
      });
      var meta = VIEW_META[id];
      if (topbarTitle) topbarTitle.textContent = meta.title;
      if (topbarSubtitle) topbarSubtitle.textContent = meta.subtitle;
      try {
        if (window.history && window.history.replaceState) {
          window.history.replaceState(null, '', '#' + id);
        } else {
          window.location.hash = id;
        }
      } catch (err) {
        /* ignore */
      }
      if (id === 'overview' && typeof window.refreshAdminOverviewStats === 'function') {
        window.refreshAdminOverviewStats();
      }
      if (id === 'courses' && typeof window.renderAdminCoursesTable === 'function') {
        window.renderAdminCoursesTable();
      }
      if (id === 'orders' && typeof window.renderAdminOrdersTable === 'function') {
        window.renderAdminOrdersTable();
      }
      if (id === 'settings-checkout' && typeof window.loadAdminCheckoutSettings === 'function') {
        window.loadAdminCheckoutSettings();
      }
      if ((SITE_VIEWS[id] || id.indexOf('site-') === 0) && typeof window.renderAdminSiteCms === 'function') {
        window.renderAdminSiteCms();
      }
      document.body.classList.toggle('admin-body--site-preview', id === 'site-preview');
    }

    function escapeOverviewHtml(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    window.refreshAdminOverviewStats = function () {
      var publishedEl = document.getElementById('statPublishedCourses');
      var totalCoursesEl = document.getElementById('statTotalCourses');
      var coursesTrendEl = document.getElementById('statCoursesTrend');
      var totalUsersEl = document.getElementById('statTotalUsers');
      var activeUsersEl = document.getElementById('statActiveUsers');
      var summaryEl = document.getElementById('overviewCoursesSummary');

      if (window.PlatformCourses) {
        var allCourses = window.PlatformCourses.getCourses();
        var published = window.PlatformCourses.getPublishedCount();
        var drafts = typeof window.PlatformCourses.getDraftCount === 'function'
          ? window.PlatformCourses.getDraftCount()
          : allCourses.filter(function (c) {
              return c.status === 'draft' || c.softDeleted;
            }).length;
        if (publishedEl) publishedEl.textContent = String(published);
        if (totalCoursesEl) totalCoursesEl.textContent = String(allCourses.length);
        if (coursesTrendEl) coursesTrendEl.textContent = drafts + ' مسودة';

        if (summaryEl) {
          if (!allCourses.length) {
            summaryEl.innerHTML = '<p class="admin-empty-cell">لا توجد كورسات بعد.</p>';
          } else {
            var latest = allCourses.slice().sort(function (a, b) {
              return String(b.updatedAt || b.createdAt || '').localeCompare(
                String(a.updatedAt || a.createdAt || '')
              );
            }).slice(0, 5);
            summaryEl.innerHTML =
              '<ul class="admin-overview-courses__list">' +
              latest
                .map(function (c) {
                  return (
                    '<li>' +
                    '<div>' +
                    '<strong>' +
                    escapeOverviewHtml(c.title) +
                    '</strong>' +
                    '<span>' +
                    escapeOverviewHtml(window.PlatformCourses.formatDuration(c)) +
                    (c.instructorName || c.instructorEmail
                      ? ' · ' + escapeOverviewHtml(c.instructorName || c.instructorEmail)
                      : '') +
                    '</span>' +
                    '</div>' +
                    '<span class="admin-badge ' +
                    (c.status === 'published' ? 'admin-badge--active' : 'admin-badge--pending') +
                    '">' +
                    (c.status === 'published' ? 'منشور' : 'مسودة') +
                    '</span>' +
                    '</li>'
                  );
                })
                .join('') +
              '</ul>';
          }
        }
      }

      if (window.AdminUsers) {
        var users = window.AdminUsers.getUsers();
        var active = users.filter(function (u) {
          return u.status === 'active';
        }).length;
        if (totalUsersEl) totalUsersEl.textContent = String(users.length);
        if (activeUsersEl) activeUsersEl.textContent = String(active);
        var usersTrend = document.getElementById('statUsersTrend');
        var activeTrend = document.getElementById('statActiveUsersTrend');
        if (usersTrend) usersTrend.textContent = users.length ? 'محدّث' : '—';
        if (activeTrend) activeTrend.textContent = active ? 'نشط' : '—';
      }
    };

    if (toggle) {
      toggle.addEventListener('click', function () {
        if (sidebar.classList.contains('open')) closeSidebar();
        else openSidebar();
      });
    }

    if (overlay) overlay.addEventListener('click', closeSidebar);

    navLinks.forEach(function (link) {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        var section = link.getAttribute('data-section') || 'overview';
        showAdminView(section);
        if (window.innerWidth <= 900) closeSidebar();
      });
    });

    document.addEventListener('click', function (e) {
      var go = e.target.closest ? e.target.closest('[data-goto-section]') : null;
      if (!go) return;
      e.preventDefault();
      showAdminView(go.getAttribute('data-goto-section') || 'overview');
    });

    document.addEventListener('ifa:platform-courses-changed', function () {
      if (typeof window.refreshAdminOverviewStats === 'function') {
        window.refreshAdminOverviewStats();
      }
    });

    document.addEventListener('ifa:admin-users-changed', function () {
      if (typeof window.refreshAdminOverviewStats === 'function') {
        window.refreshAdminOverviewStats();
      }
    });

    window.addEventListener('hashchange', function () {
      var hash = (window.location.hash || '#overview').replace(/^#/, '') || 'overview';
      showAdminView(hash);
    });

    var initialHash = (window.location.hash || '#overview').replace(/^#/, '') || 'overview';
    showAdminView(initialHash);
    window.refreshAdminOverviewStats();
    bindPlatformSettingsForm();
    bindAdminFtthLabConfigPanel();
    bindLabConfigPreviewForwarder();
  }

  function bindLabConfigPreviewForwarder() {
    if (window.__ifaLabConfigPreviewForwarderBound) return;
    window.__ifaLabConfigPreviewForwarderBound = true;

    function forwardLabConfigMessage(data) {
      if (!data || data.type !== 'ifa:lab-config-apply' || data._ifaRouted) return;
      var payload = Object.assign({}, data, { _ifaRouted: true });
      document.querySelectorAll('iframe').forEach(function (frame) {
        if (!frame.contentWindow) return;
        try {
          frame.contentWindow.postMessage(payload, '*');
        } catch (err) { /* ignore */ }
      });
    }

    window.addEventListener('message', function (ev) {
      forwardLabConfigMessage(ev.data);
    });
    window.addEventListener('ifa:lab-config-apply-local', function (ev) {
      forwardLabConfigMessage((ev && ev.detail) || null);
    });
  }

  function bindAdminFtthLabConfigPanel() {
    if (!window.FtthLabSettingsCms ||
        typeof FtthLabSettingsCms.mountAdminEmbeddedPanel !== 'function') {
      return;
    }
    FtthLabSettingsCms.mountAdminEmbeddedPanel('admin-ftth-lab-config-root');
  }

  function isoToDatetimeLocalValue(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (!isFinite(d.getTime())) return '';
    var offset = d.getTimezoneOffset();
    var local = new Date(d.getTime() - offset * 60000);
    return local.toISOString().slice(0, 16);
  }

  function datetimeLocalToIso(value) {
    if (!value) return '';
    var d = new Date(value);
    if (!isFinite(d.getTime())) return '';
    return d.toISOString();
  }

  function parseGlobalOfferEndsAtMs(settings) {
    var raw = settings && settings.globalOfferEndsAt;
    if (raw == null || raw === '') return 0;
    var ms = typeof raw === 'number' ? raw : Date.parse(String(raw));
    return isFinite(ms) ? ms : 0;
  }

  function isGlobalOfferCurrentlyActive(settings) {
    if (!settings || !settings.globalOfferEnabled) return false;
    var expiryMs = parseGlobalOfferEndsAtMs(settings);
    return expiryMs > Date.now();
  }

  function formatPlatformSettingsStatus(saved) {
    var bannerNote = '';
    if (isGlobalOfferCurrentlyActive(saved)) {
      bannerNote = ' · عرض عام مفعّل';
    } else if (saved.globalOfferEnabled) {
      bannerNote = ' · عرض عام (منتهي أو بلا تاريخ)';
    } else if ((saved.freeTrialDays || 0) > 0) {
      bannerNote = ' · شريط تجربة تلقائي';
    }
    return (
      'تم الحفظ — تجربة ' +
      formatFreeTrialDaysForStatus(saved.freeTrialDays) +
      '، تجريبي: ' +
      (saved.freeSimulatorIds.length || 0) +
      '، قيد التطوير: ' +
      (saved.comingSoonSimulatorIds.length || 0) +
      bannerNote
    );
  }

  function splitFreeTrialDaysToDhm(totalDays) {
    var total = parseFloat(totalDays);
    if (!isFinite(total) || total <= 0) {
      return { days: 0, hours: 0, minutes: 0 };
    }
    var totalMinutes = Math.round(total * 24 * 60);
    var days = Math.floor(totalMinutes / 1440);
    var rem = totalMinutes - days * 1440;
    var hours = Math.floor(rem / 60);
    var minutes = rem - hours * 60;
    return { days: days, hours: hours, minutes: minutes };
  }

  function combineDhmToFreeTrialDays(days, hours, minutes) {
    var d = parseFloat(days) || 0;
    var h = parseFloat(hours) || 0;
    var m = parseFloat(minutes) || 0;
    if (d < 0 || h < 0 || m < 0) return 0;
    return d + h / 24 + m / 1440;
  }

  function formatFreeTrialDaysForStatus(totalDays) {
    var parts = splitFreeTrialDaysToDhm(totalDays);
    if (!parts.days && !parts.hours && !parts.minutes) return '0';
    var bits = [];
    if (parts.days) bits.push(parts.days + ' يوم');
    if (parts.hours) bits.push(parts.hours + ' س');
    if (parts.minutes) bits.push(parts.minutes + ' د');
    return bits.join(' · ');
  }

  function persistPlatformSettingsToFirestore(platformSettings) {
    var ready = window.__ifaSimulatorsFirestoreReady;
    if (!ready) {
      return Promise.resolve({ ok: false, reason: 'firestore-not-ready' });
    }
    return Promise.resolve(ready)
      .then(function (api) {
        if (!api || typeof api.saveSimulatorsBundle !== 'function') {
          return { ok: false, reason: 'missing-api' };
        }
        return api.saveSimulatorsBundle({ platformSettings: platformSettings }).then(function () {
          return { ok: true };
        });
      })
      .catch(function (err) {
        console.error('[Admin] platform settings Firestore save failed', err);
        return { ok: false, error: err };
      });
  }

  function bindPlatformSettingsForm() {
    var form = document.getElementById('platformSettingsForm');
    var list = document.getElementById('settingsFreeSimulators');
    var comingSoonList = document.getElementById('settingsComingSoonSimulators');
    var trialDaysInput = document.getElementById('settingsTrialDays');
    var trialHoursInput = document.getElementById('settingsTrialHours');
    var trialMinutesInput = document.getElementById('settingsTrialMinutes');
    var trialAnnouncementTextInput = document.getElementById('settingsTrialAnnouncementText');
    var globalOfferEnabledInput = document.getElementById('settingsGlobalOfferEnabled');
    var globalOfferTextInput = document.getElementById('settingsGlobalOfferText');
    var globalOfferEndsAtInput = document.getElementById('settingsGlobalOfferEndsAt');
    var globalOfferEndsAtWrap = document.getElementById('settingsGlobalOfferEndsAtWrap');
    var statusEl = document.getElementById('settingsSaveStatus');
    if (!form || !window.PlatformSimulators) return;
    if (form.dataset.platformSettingsBound === '1') return;
    form.dataset.platformSettingsBound = '1';

    var catalog =
      typeof window.PlatformSimulators.getCatalog === 'function'
        ? window.PlatformSimulators.getCatalog()
        : [];

    function applyPlatformSettingsToForm(settings) {
      settings = settings || { freeSimulatorIds: [], comingSoonSimulatorIds: [], freeTrialDays: 0 };
      var selected = {};
      (settings.freeSimulatorIds || []).forEach(function (id) {
        selected[id] = true;
      });
      var comingSoonSelected = {};
      (settings.comingSoonSimulatorIds || []).forEach(function (id) {
        comingSoonSelected[id] = true;
      });

      function renderChecklist(host, name, selectedMap) {
        if (!host) return;
        host.innerHTML = catalog
          .map(function (sim) {
            return (
              '<label>' +
              '<input type="checkbox" name="' +
              name +
              '" value="' +
              String(sim.id).replace(/"/g, '') +
              '"' +
              (selectedMap[sim.id] ? ' checked' : '') +
              ' />' +
              '<span>' +
              String(sim.label || sim.id) +
              ' <code>' +
              String(sim.id) +
              '</code></span>' +
              '</label>'
            );
          })
          .join('');
      }

      renderChecklist(list, 'freeSimulator', selected);
      renderChecklist(comingSoonList, 'comingSoonSimulator', comingSoonSelected);
      var trialParts = splitFreeTrialDaysToDhm(settings.freeTrialDays);
      if (trialDaysInput) trialDaysInput.value = String(trialParts.days);
      if (trialHoursInput) trialHoursInput.value = String(trialParts.hours);
      if (trialMinutesInput) trialMinutesInput.value = String(trialParts.minutes);
      if (trialAnnouncementTextInput) {
        trialAnnouncementTextInput.value = String(settings.trialAnnouncementText || '');
      }
      if (globalOfferEnabledInput) {
        globalOfferEnabledInput.checked = !!settings.globalOfferEnabled;
      }
      if (globalOfferTextInput) {
        globalOfferTextInput.value = String(settings.globalOfferText || '');
      }
      if (globalOfferEndsAtInput) {
        globalOfferEndsAtInput.value = isoToDatetimeLocalValue(settings.globalOfferEndsAt || '');
      }
      if (globalOfferEndsAtWrap && globalOfferEnabledInput) {
        var showEndDate = globalOfferEnabledInput.checked;
        globalOfferEndsAtWrap.hidden = !showEndDate;
        globalOfferEndsAtWrap.setAttribute('aria-hidden', showEndDate ? 'false' : 'true');
      }
    }

    if (globalOfferEnabledInput) {
      globalOfferEnabledInput.addEventListener('change', function () {
        if (!globalOfferEndsAtWrap) return;
        var showEndDate = globalOfferEnabledInput.checked;
        globalOfferEndsAtWrap.hidden = !showEndDate;
        globalOfferEndsAtWrap.setAttribute('aria-hidden', showEndDate ? 'false' : 'true');
      });
    }

    applyPlatformSettingsToForm(
      typeof window.PlatformSimulators.getPlatformSettings === 'function'
        ? window.PlatformSimulators.getPlatformSettings()
        : null
    );

    window.addEventListener('ifa:platform-settings-changed', function (ev) {
      var detail = ev && ev.detail;
      if (detail && typeof detail === 'object') {
        applyPlatformSettingsToForm(detail);
        return;
      }
      if (typeof window.PlatformSimulators.getPlatformSettings === 'function') {
        applyPlatformSettingsToForm(window.PlatformSimulators.getPlatformSettings());
      }
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var ids = [];
      form.querySelectorAll('input[name="freeSimulator"]:checked').forEach(function (input) {
        if (input.value) ids.push(input.value);
      });
      var comingSoonIds = [];
      form.querySelectorAll('input[name="comingSoonSimulator"]:checked').forEach(function (input) {
        if (input.value) comingSoonIds.push(input.value);
      });
      var totalTrialDays = combineDhmToFreeTrialDays(
        trialDaysInput ? trialDaysInput.value : 0,
        trialHoursInput ? trialHoursInput.value : 0,
        trialMinutesInput ? trialMinutesInput.value : 0
      );
      if (
        window.PlatformSimulators &&
        typeof window.PlatformSimulators.normalizeFreeTrialDays === 'function'
      ) {
        totalTrialDays = window.PlatformSimulators.normalizeFreeTrialDays(totalTrialDays);
      } else if (isFinite(totalTrialDays) && totalTrialDays > 0) {
        totalTrialDays = Math.min(365, totalTrialDays);
      } else {
        totalTrialDays = 0;
      }
      var trialAnnouncementText = trialAnnouncementTextInput
        ? String(trialAnnouncementTextInput.value || '').trim()
        : '';
      var globalOfferEnabled = !!(globalOfferEnabledInput && globalOfferEnabledInput.checked);
      var globalOfferText = globalOfferTextInput ? String(globalOfferTextInput.value || '').trim() : '';
      var globalOfferEndsAt = '';
      if (globalOfferEnabled) {
        if (!globalOfferEndsAtInput || !globalOfferEndsAtInput.value) {
          window.alert('يرجى تحديد تاريخ انتهاء العرض');
          return;
        }
        globalOfferEndsAt = datetimeLocalToIso(globalOfferEndsAtInput.value);
        if (!globalOfferEndsAt || Date.parse(globalOfferEndsAt) <= Date.now()) {
          window.alert('يرجى تحديد تاريخ انتهاء العرض');
          return;
        }
      }
      var saved = window.PlatformSimulators.savePlatformSettings({
        freeSimulatorIds: ids,
        comingSoonSimulatorIds: comingSoonIds,
        freeTrialDays: totalTrialDays,
        trialAnnouncementText: trialAnnouncementText.slice(0, 500),
        globalOfferEnabled: globalOfferEnabled,
        globalOfferText: globalOfferText.slice(0, 500),
        globalOfferEndsAt: globalOfferEndsAt,
      });
      if (statusEl) statusEl.textContent = 'جاري الحفظ في Firestore…';

      persistPlatformSettingsToFirestore(saved).then(function (result) {
        if (!statusEl) return;
        if (result.ok) {
          statusEl.textContent = formatPlatformSettingsStatus(saved) + ' · تم النشر على Firestore';
          return;
        }
        statusEl.textContent =
          formatPlatformSettingsStatus(saved) +
          ' · محفوظ محلياً — فشل النشر على Firestore (تحقق من صلاحيات المسؤول والاتصال)';
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
