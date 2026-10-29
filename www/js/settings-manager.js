/**
 * Global header settings menu — notifications row, theme & language toggles.
 */
(function (global) {
  'use strict';

  var THEME_KEY = 'ifa_theme';
  var LANG_KEY = 'ifa_lang';
  var panelOpen = false;

  function getTheme() {
    try {
      return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
    } catch (err) {
      return 'dark';
    }
  }

  function getLang() {
    try {
      return localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'ar';
    } catch (err) {
      return 'ar';
    }
  }

  function applyTheme(theme) {
    var isLight = theme === 'light';
    function setBodyTheme() {
      if (document.body) {
        document.body.classList.toggle('light-theme', isLight);
      }
    }
    if (document.body) {
      setBodyTheme();
    } else {
      document.addEventListener('DOMContentLoaded', setBodyTheme, { once: true });
    }
    try {
      localStorage.setItem(THEME_KEY, isLight ? 'light' : 'dark');
    } catch (err) {
      /* ignore */
    }
    syncPanelControls();
  }

  function applyLang(lang) {
    var isEn = lang === 'en';
    var html = document.documentElement;
    html.lang = isEn ? 'en' : 'ar';
    html.dir = isEn ? 'ltr' : 'rtl';
    function setBodyDir() {
      if (document.body) {
        document.body.dir = isEn ? 'ltr' : 'rtl';
      }
    }
    if (document.body) {
      setBodyDir();
    } else {
      document.addEventListener('DOMContentLoaded', setBodyDir, { once: true });
    }
    try {
      localStorage.setItem(LANG_KEY, isEn ? 'en' : 'ar');
    } catch (err) {
      /* ignore */
    }
    syncPanelControls();
    if (global.PlatformI18n && typeof global.PlatformI18n.apply === 'function') {
      global.PlatformI18n.apply(isEn ? 'en' : 'ar');
    }
    try {
      global.dispatchEvent(new CustomEvent('ifa:settings-lang-changed', { detail: { lang: getLang() } }));
    } catch (err2) {
      /* ignore */
    }
  }

  function applyStoredPreferences() {
    applyTheme(getTheme());
    applyLang(getLang());
  }

  function syncPanelControls() {
    document.querySelectorAll('[data-settings-root]').forEach(function (root) {
      var themeToggle = root.querySelector('[data-settings-theme-toggle]');
      if (themeToggle) themeToggle.checked = getTheme() === 'light';

      var langToggle = root.querySelector('[data-settings-lang-toggle]');
      if (langToggle) langToggle.checked = getLang() === 'en';

      if (global.PlatformI18n && typeof global.PlatformI18n.applyTo === 'function') {
        global.PlatformI18n.applyTo(root);
      }
    });
  }

  function setPanelOpen(open) {
    panelOpen = !!open;
    document.querySelectorAll('[data-settings-root]').forEach(function (root) {
      if (root.classList.contains('settings-menu--drawer')) return;
      var panel = root.querySelector('[data-settings-panel]');
      var toggle = root.querySelector('[data-settings-toggle]');
      if (panel) panel.hidden = !panelOpen;
      if (toggle) toggle.setAttribute('aria-expanded', panelOpen ? 'true' : 'false');
    });
    if (!panelOpen && global.PlatformNotifications && typeof global.PlatformNotifications.closePanel === 'function') {
      global.PlatformNotifications.closePanel();
    }
  }

  function buildSettingsControlsHtml(pushToggleId) {
    var pushIdAttr = pushToggleId ? ' id="' + pushToggleId + '"' : '';
    return (
      '<button type="button" class="settings-dropdown__row settings-dropdown__row--notifications" data-notifications-toggle hidden>' +
      '<span class="settings-dropdown__row-main">' +
      '<span class="settings-dropdown__row-icon" aria-hidden="true">' +
      '<svg class="settings-dropdown__bell-icon" viewBox="0 0 24 24">' +
      '<path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M10 20a2 2 0 0 0 4 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
      '</svg>' +
      '</span>' +
      '<span class="settings-dropdown__row-label" data-notifications-row-label data-i18n="settings.notifications">الإشعارات</span>' +
      '</span>' +
      '<span class="settings-dropdown__badge" data-notifications-badge hidden>0</span>' +
      '</button>' +
      '<div class="settings-dropdown__row">' +
      '<div class="settings-dropdown__row-main">' +
      '<span class="settings-dropdown__row-icon" aria-hidden="true">' +
      '<svg class="settings-dropdown__bell-icon" viewBox="0 0 24 24">' +
      '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M13.7 21a2 2 0 0 1-3.4 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
      '</svg>' +
      '</span>' +
      '<span class="settings-dropdown__row-label" data-i18n="settings.pushNotifications">إشعارات المتصفح</span>' +
      '</div>' +
      '<label class="toggle-switch" title="Push notifications">' +
      '<input type="checkbox"' +
      pushIdAttr +
      ' data-settings-push-toggle />' +
      '<span class="toggle-switch__track" aria-hidden="true"><span class="toggle-switch__thumb"></span></span>' +
      '</label>' +
      '</div>' +
      '<div class="settings-dropdown__row">' +
      '<div class="settings-dropdown__row-main">' +
      '<span class="settings-dropdown__row-icon settings-dropdown__row-icon--theme" aria-hidden="true">' +
      '<svg class="settings-dropdown__theme-icon settings-dropdown__theme-icon--moon" viewBox="0 0 24 24"><path d="M21 14.5A8.5 8.5 0 1 1 9.5 3 6.5 6.5 0 0 0 21 14.5Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>' +
      '<svg class="settings-dropdown__theme-icon settings-dropdown__theme-icon--sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' +
      '</span>' +
      '<span class="settings-dropdown__row-label" data-settings-theme-label data-i18n="settings.theme">المظهر</span>' +
      '</div>' +
      '<label class="toggle-switch toggle-switch--theme" title="Light mode">' +
      '<input type="checkbox" data-settings-theme-toggle />' +
      '<span class="toggle-switch__track" aria-hidden="true"><span class="toggle-switch__thumb"></span></span>' +
      '</label>' +
      '</div>' +
      '<div class="settings-dropdown__row">' +
      '<div class="settings-dropdown__row-main">' +
      '<span class="settings-dropdown__row-icon settings-dropdown__row-icon--lang" aria-hidden="true">Aa</span>' +
      '<span class="settings-dropdown__row-label" data-settings-lang-label data-i18n="settings.language">اللغة</span>' +
      '</div>' +
      '<label class="toggle-switch toggle-switch--lang" title="English">' +
      '<input type="checkbox" data-settings-lang-toggle />' +
      '<span class="toggle-switch__track toggle-switch__track--lang" aria-hidden="true">' +
      '<span class="toggle-switch__lang toggle-switch__lang--ar">AR</span>' +
      '<span class="toggle-switch__lang toggle-switch__lang--en">EN</span>' +
      '<span class="toggle-switch__thumb"></span>' +
      '</span>' +
      '</label>' +
      '</div>'
    );
  }

  function buildNotificationsPanelHtml() {
    return (
      '<div class="notif-panel notif-panel--menu" data-notifications-panel hidden>' +
      '<div class="notif-panel__head">' +
      '<h3 class="notif-panel__title" data-notifications-panel-title data-i18n="settings.notifications">الإشعارات</h3>' +
      '<button type="button" class="notif-panel__mark-all" data-notifications-mark-all data-i18n="settings.markAllRead">تعيين الكل كمقروء</button>' +
      '</div>' +
      '<div class="notif-panel__list" data-notifications-list></div>' +
      '</div>'
    );
  }

  var MOBILE_BREAKPOINT_MQ = '(max-width: 1024px)';

  function isMobileLayout() {
    return global.innerWidth <= 1024 || global.matchMedia(MOBILE_BREAKPOINT_MQ).matches;
  }

  function removeHeaderSettingsMenu() {
    document.querySelectorAll('.header__actions').forEach(function (actions) {
      var headerRoot = actions.querySelector('[data-settings-root]:not(.settings-menu--drawer)');
      if (headerRoot) headerRoot.remove();
    });
    setPanelOpen(false);
  }

  function removeNavDrawerSettings() {
    document.querySelectorAll('.settings-menu--drawer').forEach(function (drawerRoot) {
      drawerRoot.remove();
    });
  }

  function mountHeaderSettingsMenu() {
    if (isMobileLayout()) return;

    document.querySelectorAll('.header__actions').forEach(function (actions) {
      if (actions.querySelector('[data-settings-root]:not(.settings-menu--drawer)')) return;

      var root = document.createElement('div');
      root.className = 'settings-menu';
      root.setAttribute('data-settings-root', '');
      root.innerHTML =
        '<button type="button" id="settingsMenuBtn" class="settings-menu__btn" data-settings-toggle data-settings-trigger data-i18n-aria="settings.menu" aria-label="الإعدادات" aria-expanded="false" aria-haspopup="true">' +
        '<svg class="settings-menu__icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<circle cx="12" cy="12" r="3"/>' +
        '<path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>' +
        '</svg>' +
        '</button>' +
        '<div class="settings-dropdown" data-settings-panel hidden>' +
        buildSettingsControlsHtml('settingsPushNotificationsToggle') +
        '</div>' +
        buildNotificationsPanelHtml();

      var authSlot = actions.querySelector('[data-auth-slot]');
      if (authSlot) {
        actions.insertBefore(root, authSlot);
      } else {
        actions.appendChild(root);
      }
    });
  }

  function mountNavDrawerSettings(navEl) {
    var nav = navEl || document.querySelector('#nav') || document.querySelector('.nav');
    if (!nav) return;
    if (nav.querySelector('.settings-menu--drawer')) return;

    var root = document.createElement('div');
    root.className = 'settings-menu settings-menu--drawer drawer-settings';
    root.setAttribute('data-settings-root', '');
    root.setAttribute('data-settings-root-drawer', '');
    root.innerHTML =
      '<div class="nav__drawer-settings" data-nav-drawer-settings>' +
      '<p class="nav__drawer-settings-title" data-i18n="settings.menu">الإعدادات</p>' +
      '<div class="settings-dropdown settings-dropdown--drawer" data-settings-panel>' +
      buildSettingsControlsHtml('settingsPushNotificationsToggleDrawer') +
      '</div>' +
      buildNotificationsPanelHtml() +
      '</div>';

    var list = nav.querySelector('.nav__list');
    if (list && list.parentNode === nav) {
      nav.insertBefore(root, list.nextSibling);
    } else {
      nav.appendChild(root);
    }
  }

  function mountSettingsMenu() {
    var isMobile = isMobileLayout();
    var headerActions = document.querySelector('.header__actions');
    var navDrawer = document.querySelector('#nav') || document.querySelector('.nav');

    if (isMobile) {
      removeHeaderSettingsMenu();
      if (navDrawer) {
        mountNavDrawerSettings(navDrawer);
      }
    } else {
      removeNavDrawerSettings();
      if (headerActions) {
        mountHeaderSettingsMenu();
      }
    }

    syncPanelControls();
    if (global.PlatformNotifications && typeof global.PlatformNotifications.renderBell === 'function') {
      global.PlatformNotifications.renderBell();
    }
    try {
      global.dispatchEvent(new CustomEvent('ifa:settings-menu-mounted'));
    } catch (errMount) {
      /* ignore */
    }
  }

  function bindUi() {
    if (document.body.dataset.settingsUiBound === '1') return;
    document.body.dataset.settingsUiBound = '1';

    document.addEventListener('change', function (e) {
      if (e.target && e.target.matches && e.target.matches('[data-settings-theme-toggle]')) {
        applyTheme(e.target.checked ? 'light' : 'dark');
        return;
      }
      if (e.target && e.target.matches && e.target.matches('[data-settings-lang-toggle]')) {
        applyLang(e.target.checked ? 'en' : 'ar');
      }
    });

    document.addEventListener('click', function (e) {
      var toggle = e.target.closest
        ? e.target.closest('[data-settings-toggle], [data-settings-trigger]')
        : null;
      if (toggle) {
        e.preventDefault();
        e.stopPropagation();
        if (global.PlatformNotifications && typeof global.PlatformNotifications.closePanel === 'function') {
          global.PlatformNotifications.closePanel();
        }
        setPanelOpen(!panelOpen);
        return;
      }

      if (panelOpen && !e.target.closest('[data-settings-root]')) {
        setPanelOpen(false);
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') setPanelOpen(false);
    });

    global.addEventListener('ifa:settings-lang-changed', syncPanelControls);

    var remountTimer = null;
    function scheduleRemountSettings() {
      if (remountTimer) global.clearTimeout(remountTimer);
      remountTimer = global.setTimeout(function () {
        remountTimer = null;
        mountSettingsMenu();
      }, 120);
    }

    try {
      var mobileMq = global.matchMedia(MOBILE_BREAKPOINT_MQ);
      var onBreakpointChange = function () {
        scheduleRemountSettings();
      };
      if (typeof mobileMq.addEventListener === 'function') {
        mobileMq.addEventListener('change', onBreakpointChange);
      } else if (typeof mobileMq.addListener === 'function') {
        mobileMq.addListener(onBreakpointChange);
      }
    } catch (errMq) {
      /* ignore */
    }

    global.addEventListener('resize', scheduleRemountSettings);
  }

  function boot() {
    mountSettingsMenu();
    bindUi();
    setPanelOpen(false);
  }

  applyStoredPreferences();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  global.PlatformSettings = {
    THEME_KEY: THEME_KEY,
    LANG_KEY: LANG_KEY,
    getTheme: getTheme,
    getLang: getLang,
    applyTheme: applyTheme,
    applyLang: applyLang,
    applyStoredPreferences: applyStoredPreferences,
    isMobileLayout: isMobileLayout,
    mountSettingsMenu: mountSettingsMenu,
    mountNavDrawerSettings: mountNavDrawerSettings,
    removeHeaderSettingsMenu: removeHeaderSettingsMenu,
    removeNavDrawerSettings: removeNavDrawerSettings,
    setPanelOpen: setPanelOpen,
    syncPanelControls: syncPanelControls,
  };
})(typeof window !== 'undefined' ? window : this);
