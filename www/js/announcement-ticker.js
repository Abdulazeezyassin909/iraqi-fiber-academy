(function () {
  'use strict';

  var SETTINGS_KEY = 'ifa_platform_settings';

  function bindAnnouncementBannerEvents() {
    if (typeof window.applyGlobalAnnouncementBar !== 'function') return;

    window.addEventListener('ifa:platform-settings-changed', function (ev) {
      window.applyGlobalAnnouncementBar(ev && ev.detail);
    });
    document.addEventListener('ifa:platform-settings-changed', function (ev) {
      window.applyGlobalAnnouncementBar(ev && ev.detail);
    });
    window.addEventListener('ifa:simulators-firestore-changed', function () {
      window.applyGlobalAnnouncementBar();
    });
    document.addEventListener('ifa:simulators-firestore-changed', function () {
      window.applyGlobalAnnouncementBar();
    });
    window.addEventListener('ifa:local-auth-changed', function () {
      window.applyGlobalAnnouncementBar();
    });
    document.addEventListener('ifa:local-auth-changed', function () {
      window.applyGlobalAnnouncementBar();
    });
    window.addEventListener('storage', function (e) {
      if (e.key === SETTINGS_KEY) window.applyGlobalAnnouncementBar();
    });
  }

  function init() {
    if (typeof window.applyGlobalAnnouncementBar === 'function') {
      window.applyGlobalAnnouncementBar();
    }
    bindAnnouncementBannerEvents();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
