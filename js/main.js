(function () {
  'use strict';

  function resolvePlatformSettingsForBanner(override) {
    if (override && typeof override === 'object') return override;
    if (window.PlatformSimulators && typeof window.PlatformSimulators.getPlatformSettings === 'function') {
      return window.PlatformSimulators.getPlatformSettings();
    }
    try {
      var raw = localStorage.getItem('ifa_platform_settings');
      if (raw) return JSON.parse(raw);
    } catch (err) {
      /* ignore */
    }
    return {
      freeTrialDays: 0,
      trialAnnouncementText: '',
      globalOfferEnabled: false,
      globalOfferText: '',
      globalOfferEndsAt: '',
    };
  }

  var DEFAULT_TRIAL_BANNER_TEXT = 'استمتع بتجربتك المجانية على المحاكيات';

  function parseGlobalOfferEndsAtMs(settings) {
    var raw = settings && settings.globalOfferEndsAt;
    if (raw == null || raw === '') return 0;
    var ms = typeof raw === 'number' ? raw : Date.parse(String(raw));
    return isFinite(ms) ? ms : 0;
  }

  function resolveAuthUserForBanner() {
    if (window.IFAAuth && typeof window.IFAAuth.resolveAuthUserForTrial === 'function') {
      return window.IFAAuth.resolveAuthUserForTrial();
    }
    if (window.IFAAuth && typeof window.IFAAuth.getLocalAuthUser === 'function') {
      return window.IFAAuth.getLocalAuthUser();
    }
    return null;
  }

  function isPrivilegedBannerUser(authUser) {
    if (!authUser) return false;
    if (authUser.isAdmin || authUser.isInstructor) return true;
    var role = String(authUser.role || '').toLowerCase();
    if (role === 'admin' || role === 'instructor') return true;
    if (window.IFAAuth && typeof window.IFAAuth.isAdminUser === 'function') {
      return window.IFAAuth.isAdminUser(authUser);
    }
    return false;
  }

  function isPaidSubscriberForBanner(authUser) {
    if (!authUser) return false;
    if (authUser.isSubscriber === true) return true;
    var enrolled = authUser.enrolledCourseIds;
    return Array.isArray(enrolled) && enrolled.length > 0;
  }

  function getTrialExpiryMs(authUser, settings) {
    if (window.IFAAuth && typeof window.IFAAuth.getTrialExpiryMs === 'function') {
      return window.IFAAuth.getTrialExpiryMs(authUser, settings);
    }
    if (!authUser) return 0;
    var raw = authUser.trialExpiresAt;
    if (raw != null && raw !== '') {
      var stored = typeof raw === 'number' ? raw : Date.parse(raw);
      if (isFinite(stored) && stored > 0) return stored;
    }
    return 0;
  }

  function isGlobalOfferActive(settings) {
    if (!settings || !settings.globalOfferEnabled) return false;
    var expiryMs = parseGlobalOfferEndsAtMs(settings);
    if (expiryMs <= 0 || expiryMs <= Date.now()) return false;
    var text = settings.globalOfferText ? String(settings.globalOfferText).trim() : '';
    return !!(text || expiryMs > Date.now());
  }

  function isAutomaticTrialBannerEligible(authUser, settings) {
    if (!authUser) return false;
    if (isPrivilegedBannerUser(authUser)) return false;
    if (isPaidSubscriberForBanner(authUser)) return false;
    var days = settings && parseFloat(settings.freeTrialDays);
    if (!isFinite(days) || days <= 0) return false;
    if (window.IFAAuth && typeof window.IFAAuth.hasActiveTrial === 'function') {
      return window.IFAAuth.hasActiveTrial(authUser, settings);
    }
    return getTrialExpiryMs(authUser, settings) > Date.now();
  }

  function resolveTopBannerState(settings, authUser) {
    settings = settings || {};
    if (isGlobalOfferActive(settings)) {
      return {
        mode: 'global',
        text: settings.globalOfferText ? String(settings.globalOfferText).trim() : '',
        expiryMs: parseGlobalOfferEndsAtMs(settings),
        showTimer: true,
      };
    }
    if (isAutomaticTrialBannerEligible(authUser, settings)) {
      var trialText = settings.trialAnnouncementText
        ? String(settings.trialAnnouncementText).trim()
        : '';
      if (!trialText) trialText = DEFAULT_TRIAL_BANNER_TEXT;
      return {
        mode: 'trial',
        text: trialText,
        expiryMs: getTrialExpiryMs(authUser, settings),
        showTimer: true,
      };
    }
    return { mode: 'hidden', text: '', expiryMs: 0, showTimer: false };
  }

  function getRemainingTrialDays(authUser, settings) {
    if (window.IFAAuth && typeof window.IFAAuth.getRemainingTrialDays === 'function') {
      return window.IFAAuth.getRemainingTrialDays(authUser, settings);
    }
    if (!authUser) return 0;
    var totalTrialDays =
      settings && typeof settings.freeTrialDays !== 'undefined' ? parseFloat(settings.freeTrialDays) : 7;
    if (!isFinite(totalTrialDays)) totalTrialDays = 7;
    if (totalTrialDays <= 0) return 0;
    var createdAt =
      authUser.metadata && authUser.metadata.creationTime
        ? new Date(authUser.metadata.creationTime)
        : new Date();
    var now = new Date();
    var diffDays = Math.floor(Math.abs(now - createdAt) / (1000 * 60 * 60 * 24));
    var remaining = totalTrialDays - diffDays;
    return remaining > 0 ? remaining : 0;
  }

  function stopTrialCountdown() {
    if (window.trialInterval) {
      clearInterval(window.trialInterval);
      window.trialInterval = null;
    }
  }

  function escapeBannerHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function pad2(value) {
    return String(value).length < 2 ? '0' + String(value) : String(value);
  }

  function formatTrialTimerText(days, hours, minutes, seconds) {
    return (
      String(days) +
      'd : ' +
      pad2(hours) +
      'h : ' +
      pad2(minutes) +
      'm : ' +
      pad2(seconds) +
      's'
    );
  }

  function hideBannerBar(bar) {
    if (!bar) return;
    stopTrialCountdown();
    bar.style.display = 'none';
    bar.innerHTML = '';
    document.body.classList.remove('has-announcement-bar');
  }

  function syncBannerAnnouncementText(customText) {
    var announcementEl = document.getElementById('trialBannerAnnouncement');
    if (!announcementEl) return;
    var text = customText ? String(customText).trim() : '';
    announcementEl.textContent = text;
  }

  function renderFlexBanner(bar, customText, withTimerSlot) {
    var trimmedText = customText ? String(customText).trim() : '';
    var timerColumn = withTimerSlot
      ? '<div class="trial-banner-flex__timer" dir="ltr">' +
        '<span id="liveCountdownText" class="trial-timer-badge" dir="ltr"></span></div>'
      : '';
    var layoutClass = '';
    if (trimmedText && !withTimerSlot) {
      layoutClass = ' trial-banner-flex--announcement-only';
    } else if (!trimmedText && withTimerSlot) {
      layoutClass = ' trial-banner-flex--timer-only';
    }

    bar.innerHTML =
      '<div class="trial-banner-flex' +
      layoutClass +
      '" dir="rtl" role="status">' +
      '<div id="trialBannerAnnouncement" class="trial-banner-flex__announcement"></div>' +
      timerColumn +
      '</div>';
    syncBannerAnnouncementText(trimmedText);
    bar.style.display = 'block';
    document.body.classList.add('has-announcement-bar');
  }

  function startBannerCountdownInterval(bar) {
    function updateTimer() {
      var liveSettings = resolvePlatformSettingsForBanner();
      var authUser = resolveAuthUserForBanner();
      var state = resolveTopBannerState(liveSettings, authUser);

      if (state.mode === 'hidden') {
        applyGlobalAnnouncementBar(liveSettings);
        return;
      }

      var liveDistance = state.expiryMs - Date.now();

      if (!state.showTimer || liveDistance < 0) {
        applyGlobalAnnouncementBar(liveSettings);
        return;
      }

      var timerSpan = document.getElementById('liveCountdownText');
      if (!timerSpan) {
        renderFlexBanner(bar, state.text, true);
        timerSpan = document.getElementById('liveCountdownText');
      }

      syncBannerAnnouncementText(state.text);

      var days = Math.floor(liveDistance / (1000 * 60 * 60 * 24));
      var hours = Math.floor((liveDistance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      var minutes = Math.floor((liveDistance % (1000 * 60 * 60)) / (1000 * 60));
      var seconds = Math.floor((liveDistance % (1000 * 60)) / 1000);

      if (timerSpan) {
        timerSpan.textContent = formatTrialTimerText(days, hours, minutes, seconds);
      }
    }

    updateTimer();
    stopTrialCountdown();
    window.trialInterval = setInterval(updateTimer, 1000);
  }

  function initTrialCountdown(settings, authUser) {
    applyGlobalAnnouncementBar(settings);
  }

  function applyGlobalAnnouncementBar(settings) {
    var bar = document.getElementById('globalAnnouncementBar') || document.getElementById('trialBannerContainer');
    if (!bar) return;

    stopTrialCountdown();
    settings = resolvePlatformSettingsForBanner(settings);
    var authUser = resolveAuthUserForBanner();
    var state = resolveTopBannerState(settings, authUser);

    if (state.mode === 'hidden') {
      hideBannerBar(bar);
      return;
    }

    var showTimer = state.showTimer && state.expiryMs > Date.now();

    if (!state.text && !showTimer) {
      hideBannerBar(bar);
      return;
    }

    if (showTimer) {
      renderFlexBanner(bar, state.text, true);
      startBannerCountdownInterval(bar);
      return;
    }

    if (state.text) {
      renderFlexBanner(bar, state.text, false);
      return;
    }

    hideBannerBar(bar);
  }

  window.applyGlobalAnnouncementBar = applyGlobalAnnouncementBar;
  window.resolveTopBannerState = resolveTopBannerState;
  window.getRemainingTrialDays = getRemainingTrialDays;
  window.initTrialCountdown = initTrialCountdown;
  window.stopTrialCountdown = stopTrialCountdown;

  document.addEventListener('DOMContentLoaded', function () {
    try {
      sessionStorage.removeItem('ifa_trial_kickout');
    } catch (err) {
      /* ignore */
    }
    applyGlobalAnnouncementBar();
    window.addEventListener('ifa:platform-settings-changed', function (ev) {
      applyGlobalAnnouncementBar(ev && ev.detail);
    });
    document.addEventListener('ifa:platform-settings-changed', function (ev) {
      applyGlobalAnnouncementBar(ev && ev.detail);
    });
    window.addEventListener('ifa:simulators-firestore-changed', function () {
      applyGlobalAnnouncementBar();
    });
    document.addEventListener('ifa:simulators-firestore-changed', function () {
      applyGlobalAnnouncementBar();
    });
    window.addEventListener('ifa:local-auth-changed', function () {
      applyGlobalAnnouncementBar();
    });
    document.addEventListener('ifa:local-auth-changed', function () {
      applyGlobalAnnouncementBar();
    });
    document.addEventListener('click', function (e) {
      var question = e.target.closest ? e.target.closest('.faq-item__question') : null;
      if (!question) return;
      var item = question.closest('.faq-item');
      if (!item) return;
      var isActive = item.classList.contains('active');
      document.querySelectorAll('.faq-item').forEach(function (other) {
        other.classList.remove('active');
        var q = other.querySelector('.faq-item__question');
        if (q) q.setAttribute('aria-expanded', 'false');
      });
      if (!isActive) {
        item.classList.add('active');
        question.setAttribute('aria-expanded', 'true');
      }
    });

    var modal = document.getElementById('instructorModal');
    var form = document.getElementById('instructorApplyForm');
    var errorEl = document.getElementById('instructorFormError');
    var successEl = document.getElementById('instructorFormSuccess');
    var successAlert = document.getElementById('instructorSuccessAlert');
    var cvFileInput = document.getElementById('instructorCvFile');
    var cvFileNameEl = document.getElementById('instructorCvFileName');
    var selectedCvName = '';

    function resetInstructorForm() {
      if (form) form.reset();
      selectedCvName = '';
      if (cvFileNameEl) cvFileNameEl.textContent = 'لم يتم اختيار ملف';
      if (errorEl) {
        errorEl.hidden = true;
        errorEl.textContent = '';
      }
      if (successEl) {
        successEl.hidden = true;
        successEl.textContent = '';
      }
    }

    function signedInApplicant() {
      var authApi = window.IFAAuth;
      var user = authApi && typeof authApi.getCurrentUser === 'function' ? authApi.getCurrentUser() : null;
      if (!user || !user.uid) return null;
      return user;
    }

    function prefillInstructorIdentity(user) {
      var nameInput = document.getElementById('instructorFullName');
      var emailInput = document.getElementById('instructorEmail');
      var profile = window.IFAAuth && window.IFAAuth.getAuthState ? window.IFAAuth.getAuthState() : null;
      var profileName = profile && profile.profile && profile.profile.name ? profile.profile.name : '';
      if (nameInput) {
        nameInput.value = profileName || user.displayName || nameInput.value || '';
        nameInput.readOnly = true;
      }
      if (emailInput) {
        emailInput.value = user.email || '';
        emailInput.readOnly = true;
      }
    }

    function openInstructorModal() {
      var user = signedInApplicant();
      if (!user) {
        alert('سجّل الدخول أولاً لتقديم طلب الانضمام كمدرب.');
        if (window.IFAAuth && typeof window.IFAAuth.openAuthModal === 'function') {
          window.IFAAuth.openAuthModal();
        }
        return;
      }
      if (!modal) return;
      modal.hidden = false;
      modal.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      if (errorEl) {
        errorEl.hidden = true;
        errorEl.textContent = '';
      }
      if (successEl) {
        successEl.hidden = true;
        successEl.textContent = '';
      }
      prefillInstructorIdentity(user);
      var bioInput = document.getElementById('instructorBio');
      if (bioInput) bioInput.focus();
    }

    function closeInstructorModal() {
      if (!modal) return;
      modal.hidden = true;
      modal.setAttribute('aria-hidden', 'true');
      if (!successAlert || successAlert.hidden) {
        document.body.style.overflow = '';
      }
    }

    function openSuccessAlert() {
      if (!successAlert) return;
      successAlert.hidden = false;
      successAlert.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      var okBtn = document.getElementById('instructorSuccessOk');
      if (okBtn) okBtn.focus();
    }

    function closeSuccessAlert() {
      if (!successAlert) return;
      successAlert.hidden = true;
      successAlert.setAttribute('aria-hidden', 'true');
      resetInstructorForm();
      closeInstructorModal();
      document.body.style.overflow = '';
    }

    window.openInstructorModal = openInstructorModal;
    window.closeInstructorModal = closeInstructorModal;

    if (cvFileInput && cvFileNameEl) {
      cvFileInput.addEventListener('change', function () {
        selectedCvName = cvFileInput.files && cvFileInput.files[0] ? cvFileInput.files[0].name : '';
        cvFileNameEl.textContent = selectedCvName || 'لم يتم اختيار ملف';
      });
    }

    document.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('[data-instructor-success-ok]')) {
        closeSuccessAlert();
        return;
      }

      if (e.target.closest && e.target.closest('[data-instructor-modal-close]')) {
        closeInstructorModal();
        return;
      }

      var panelLink = e.target.closest ? e.target.closest('[data-panel]') : null;
      if (panelLink) {
        e.preventDefault();
        if (panelLink.getAttribute('data-instructor-locked') != null || panelLink.classList.contains('is-locked')) {
          alert('لوحة المدرب مقفلة. قدّم طلب انضمام وانتظر موافقة الإدارة.');
          return;
        }
        const panel = panelLink.getAttribute('data-panel');
        if (panel === 'student') return;
        if (panel === 'instructor') {
          window.location.href = 'instructor.html';
          return;
        }
        const routes = {
          login: '/auth/login',
          admin: 'admin.html',
        };
        alert('سيتم ربط هذه الواجهة بلوحة التحكم قريباً.\nالوجهة: ' + (routes[panel] || panel));
        return;
      }

      var joinInstructor = e.target.closest ? e.target.closest('[data-join-instructor]') : null;
      if (joinInstructor) {
        e.preventDefault();
        openInstructorModal();
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (successAlert && !successAlert.hidden) {
        closeSuccessAlert();
        return;
      }
      if (modal && !modal.hidden) closeInstructorModal();
    });

    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        if (!window.InstructorApps) {
          alert('تعذر حفظ الطلب. أعد تحميل الصفحة.');
          return;
        }

        if (errorEl) {
          errorEl.hidden = true;
          errorEl.textContent = '';
        }
        if (successEl) {
          successEl.hidden = true;
          successEl.textContent = '';
        }

        var submitBtn = document.getElementById('instructorSubmitBtn');
        if (submitBtn) submitBtn.disabled = true;
        window.InstructorApps.submitApplication({
          fullName: document.getElementById('instructorFullName').value,
          email: document.getElementById('instructorEmail').value,
          bio: document.getElementById('instructorBio').value,
          specialization: document.getElementById('instructorCourses').value,
          courses: document.getElementById('instructorCourses').value,
          cvFile: (document.getElementById('instructorCvFile') && document.getElementById('instructorCvFile').files[0]) || null,
        }).then(function (app) {
          document.dispatchEvent(
            new CustomEvent('ifa:instructor-application-submitted', { detail: app })
          );
          closeInstructorModal();
          openSuccessAlert();
        }).catch(function (err) {
          console.error('[InstructorApps] submit failed:', err);
          if (errorEl) {
            errorEl.textContent = (err && err.message) || 'تعذر إرسال الطلب.';
            errorEl.hidden = false;
          }
        }).then(function () {
          if (submitBtn) submitBtn.disabled = false;
        });
      });
    }

    document.addEventListener('click', function (e) {
      var button = e.target && e.target.closest ? e.target.closest('[data-plan]') : null;
      if (!button) return;

      if (button.getAttribute('data-plan-state') === 'pending' || button.disabled) {
        e.preventDefault();
        return;
      }

      if (window.PlatformPlansPublic && typeof window.PlatformPlansPublic.handlePlanClick === 'function') {
        e.preventDefault();
        window.PlatformPlansPublic.handlePlanClick(button);
        return;
      }
    });

    if (window.PlatformSimulatorShowcase && typeof window.PlatformSimulatorShowcase.mountSimulatorShowcase === 'function') {
      window.PlatformSimulatorShowcase.mountSimulatorShowcase();
    }

    function refreshSimulatorPublicState() {
      if (
        window.PlatformSimulators &&
        typeof window.PlatformSimulators.isSimulatorUnderDevelopment === 'function' &&
        typeof window.PlatformSimulators.applyPublicSimulatorGates === 'function'
      ) {
        window.PlatformSimulators.applyPublicSimulatorGates();
      }
      if (window.PlatformSimulatorShowcase && typeof window.PlatformSimulatorShowcase.mountSimulatorShowcase === 'function') {
        window.PlatformSimulatorShowcase.mountSimulatorShowcase();
      }
    }

    window.addEventListener('ifa:platform-settings-changed', refreshSimulatorPublicState);
    window.addEventListener('ifa:platform-settings-changed', function (ev) {
      applyGlobalAnnouncementBar(ev && ev.detail);
    });

    if (window.PlatformFooter && typeof window.PlatformFooter.applyFooter === 'function') {
      window.PlatformFooter.applyFooter(document);
    }
    window.addEventListener('ifa:platform-footer-changed', function () {
      if (window.PlatformFooter && typeof window.PlatformFooter.applyFooter === 'function') {
        window.PlatformFooter.applyFooter(document);
      }
    });

    function readShowcaseIntervalMs() {
      if (window.PlatformSimulatorShowcase && typeof window.PlatformSimulatorShowcase.getRotateMs === 'function') {
        return window.PlatformSimulatorShowcase.getRotateMs();
      }
      try {
        var raw = JSON.parse(localStorage.getItem('ifa_simulator_showcase') || '{}');
        var sec = Number(raw._intervalSeconds);
        if (!isFinite(sec) || sec < 2) sec = 5;
        if (sec > 60) sec = 60;
        return Math.round(sec) * 1000;
      } catch (err) {
        return 5000;
      }
    }

    function restartShowcaseRotation() {
      if (!window.PlatformSimulatorShowcase) return;
      if (typeof window.PlatformSimulatorShowcase.restartShowcaseTimer === 'function') {
        window.PlatformSimulatorShowcase.restartShowcaseTimer();
        return;
      }
      if (typeof window.PlatformSimulatorShowcase.mountSimulatorShowcase === 'function') {
        window.PlatformSimulatorShowcase.mountSimulatorShowcase();
      }
    }

    window.addEventListener('ifa:simulator-showcase-changed', restartShowcaseRotation);
    window.addEventListener('storage', function (e) {
      if (e.key === 'ifa_simulator_showcase') restartShowcaseRotation();
      if (e.key === 'ifa_platform_settings') {
        refreshSimulatorPublicState();
        applyGlobalAnnouncementBar();
      }
    });
  });
})();
