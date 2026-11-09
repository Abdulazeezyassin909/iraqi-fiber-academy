/**
 * Notifications inside the header settings menu — list panel and live toasts.
 */
(function (global) {
  'use strict';

  var state = {
    uid: '',
    profile: null,
    lastReadAt: 0,
    readIds: {},
    notifications: [],
    panelOpen: false,
    hydrated: false,
    firestoreUnsub: null,
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function translate(key) {
    if (global.PlatformI18n && typeof global.PlatformI18n.t === 'function') {
      return global.PlatformI18n.t(key);
    }
    return key;
  }

  function formatRelativeTime(ms) {
    var ts = Number(ms);
    if (!isFinite(ts) || ts <= 0) return '';
    var diff = Date.now() - ts;
    var lang =
      global.PlatformI18n && typeof global.PlatformI18n.getLang === 'function'
        ? global.PlatformI18n.getLang()
        : global.PlatformSettings && typeof global.PlatformSettings.getLang === 'function'
          ? global.PlatformSettings.getLang()
          : 'ar';
    if (diff < 60000) return translate('time.now');
    if (diff < 3600000) {
      var mins = Math.floor(diff / 60000);
      return mins + translate('time.minutes');
    }
    if (diff < 86400000) {
      var hours = Math.floor(diff / 3600000);
      return hours + translate('time.hours');
    }
    return new Date(ts).toLocaleDateString(lang === 'en' ? 'en-US' : 'ar-IQ', {
      month: 'short',
      day: 'numeric',
    });
  }

  function getFirestoreApi() {
    return global.PlatformNotificationsFirestore || null;
  }

  function ensureNotificationsFirestoreSync() {
    var api = getFirestoreApi();
    if (api && typeof api.start === 'function') {
      api.start();
    }
  }

  function isAdminViewer() {
    var role = state.profile && state.profile.role ? String(state.profile.role) : '';
    if (!role && typeof global.getSynchronousUserRole === 'function') {
      role = String(global.getSynchronousUserRole() || '');
    }
    return role.toLowerCase() === 'admin';
  }

  function adminMaySee(notification) {
    var type = String((notification && notification.type) || '');
    return type === 'new_order' || type === 'course_published' || type === 'instructor_application';
  }

  function appliesToCurrentUser(notification) {
    if (!notification || notification.active === false) return false;
    if (isAdminViewer()) return adminMaySee(notification);
    if (String((notification && notification.target) || '').toLowerCase() === 'admins') return false;
    if (String(notification.type || '') === 'instructor_application') return false;
    var api = getFirestoreApi();
    if (api && typeof api.notificationAppliesToUser === 'function') {
      return api.notificationAppliesToUser(notification, state.profile);
    }
    if (!notification || !notification.active) return false;
    if (notification.targetAudience === 'all') return true;
    return !!(state.profile && state.profile.isSubscriber);
  }

  function visibleNotifications() {
    return state.notifications.filter(appliesToCurrentUser);
  }

  function isUnread(notification) {
    if (!notification) return false;
    if (notification.isRead === true) return false;
    if (state.readIds[notification.id]) return false;
    return Number(notification.createdAt) > (Number(state.lastReadAt) || 0);
  }

  async function authToken() {
    var user =
      global.IFAAuth && typeof global.IFAAuth.getCurrentUser === 'function'
        ? global.IFAAuth.getCurrentUser()
        : null;
    if (!user || typeof user.getIdToken !== 'function') return '';
    return user.getIdToken();
  }

  async function loadApiNotifications() {
    var token = await authToken();
    if (!token) return;
    var response = await fetch('/api/notifications', {
      headers: { Authorization: 'Bearer ' + token },
    });
    if (!response.ok) return;
    var data = await response.json();
    var rows = Array.isArray(data.notifications) ? data.notifications : [];
    state.notifications = rows.map(function (row) {
      return {
        id: row.id,
        title: row.title || '',
        body: row.message || '',
        message: row.message || '',
        type: row.type || (/course-details\.html/i.test(row.linkUrl || '') ? 'course_published' : 'announcement'),
        target: row.target || '',
        targetAudience: 'all_students',
        active: true,
        linkUrl: row.linkUrl || '',
        createdAt: Date.parse(row.createdAt) || Date.now(),
        isRead: !!row.isRead,
      };
    });
    state.apiMode = true;
    renderBell();
  }

  function unreadCount() {
    return visibleNotifications().filter(isUnread).length;
  }

  function panelTitle() {
    return translate('settings.notifications');
  }

  function emptyListMessage() {
    return translate('settings.emptyNotifications');
  }

  function markAllLabel() {
    return translate('settings.markAllRead');
  }

  function ensureToastHost() {
    var host = document.getElementById('ifaNotificationToast');
    if (host) return host;
    host = document.createElement('div');
    host.id = 'ifaNotificationToast';
    host.className = 'ifa-notification-toast';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    host.hidden = true;
    document.body.appendChild(host);
    return host;
  }

  var toastTimer = null;

  function showNotificationToast(notification) {
    if (!notification || !appliesToCurrentUser(notification)) return;
    var host = ensureToastHost();
    var viewLabel = translate('settings.viewDetails');
    host.innerHTML =
      '<div class="ifa-notification-toast__title">' +
      escapeHtml(notification.title || 'إشعار جديد') +
      '</div>' +
      '<div class="ifa-notification-toast__body">' +
      escapeHtml(notification.body || '') +
      '</div>' +
      (notification.linkUrl
        ? '<a class="ifa-notification-toast__link" href="' +
          escapeHtml(notification.linkUrl) +
          '">' +
          escapeHtml(viewLabel) +
          '</a>'
        : '');
    host.hidden = false;
    host.classList.add('ifa-notification-toast--visible');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      host.classList.remove('ifa-notification-toast--visible');
      window.setTimeout(function () {
        host.hidden = true;
      }, 260);
    }, 5200);
  }

  function courseLink(notification) {
    var link = String((notification && notification.linkUrl) || '');
    var type = String((notification && notification.type) || '');
    if (type === 'new_order' || type === 'order_approved' || type === 'order_rejected') {
      if (isAdminViewer() && type === 'new_order') return 'admin.html#orders';
      return 'instructor.html#orders';
    }
    if (type === 'instructor_application') return link || 'admin.html#instructors';
    if (type === 'course_published' || /course-details\.html/i.test(link)) return link;
    return '';
  }

  function renderBell() {
    var roots = document.querySelectorAll('[data-settings-root]');
    if (!roots.length) return;

    var count = unreadCount();
    roots.forEach(function (root) {
      var row = root.querySelector('[data-notifications-toggle]');
      var badge = root.querySelector('[data-notifications-badge]');
      var panel = root.querySelector('[data-notifications-panel]');
      var list = root.querySelector('[data-notifications-list]');
      var titleEl = root.querySelector('[data-notifications-panel-title]');
      var markAll = root.querySelector('[data-notifications-mark-all]');

      if (!row || !panel || !list) return;

      if (!state.uid) {
        row.hidden = true;
        panel.hidden = true;
        return;
      }
      row.hidden = false;

      if (badge) {
        if (count > 0) {
          badge.hidden = false;
          badge.textContent = count > 99 ? '99+' : String(count);
        } else {
          badge.hidden = true;
          badge.textContent = '';
        }
      }

      if (titleEl) titleEl.textContent = panelTitle();
      if (markAll) markAll.textContent = markAllLabel();

      var items = visibleNotifications();
      if (!items.length) {
        list.innerHTML = '<p class="notif-panel__empty">' + escapeHtml(emptyListMessage()) + '</p>';
      } else {
        list.innerHTML = items
          .map(function (n) {
            var unread = isUnread(n);
            return (
              '<button type="button" class="notif-item' +
              (unread ? ' notif-item--unread' : '') +
              '" data-notification-id="' +
              escapeHtml(n.id) +
              '" data-notification-type="' +
              escapeHtml(n.type || '') +
              '" data-notification-link="' +
              escapeHtml(courseLink(n) ? n.linkUrl : '') +
              '">' +
              '<span class="notif-item__title">' +
              escapeHtml(n.title) +
              '</span>' +
              '<span class="notif-item__body">' +
              escapeHtml(n.body) +
              '</span>' +
              '<span class="notif-item__time">' +
              escapeHtml(formatRelativeTime(n.createdAt)) +
              '</span>' +
              '</button>'
            );
          })
          .join('');
      }

      row.setAttribute('aria-expanded', state.panelOpen ? 'true' : 'false');
      panel.hidden = !state.panelOpen;
      root.classList.toggle('settings-menu--notif-open', state.panelOpen);
    });
  }

  function mountNotificationRoots() {
    if (global.PlatformSettings && typeof global.PlatformSettings.mountSettingsMenu === 'function') {
      global.PlatformSettings.mountSettingsMenu();
    }
    renderBell();
  }

  function closePanel() {
    state.panelOpen = false;
    renderBell();
  }

  function openPanel() {
    if (!state.uid) return;
    state.panelOpen = true;
    renderBell();
  }

  async function markOneRead(id) {
    var api = getFirestoreApi();
    if (!id) return;
    state.readIds[id] = true;
    renderBell();
    try {
      if (state.apiMode) {
        var token = await authToken();
        if (token) {
          await fetch('/api/notifications/read/' + encodeURIComponent(id), {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + token },
          });
        }
      }
      if (api && state.uid && typeof api.markNotificationRead === 'function') {
        await api.markNotificationRead(state.uid, id);
      }
    } catch (err) {
      console.error('[PlatformNotifications] markOneRead failed', err);
    }
  }

  async function markAllRead() {
    var api = getFirestoreApi();
    if (!api || !state.uid || typeof api.markNotificationsRead !== 'function') return;
    try {
      await api.markNotificationsRead(state.uid);
      state.lastReadAt = Date.now();
      closePanel();
      renderBell();
    } catch (err) {
      console.error('[PlatformNotifications] markAllRead failed', err);
    }
  }

  async function refreshLastReadAt() {
    var api = getFirestoreApi();
    if (!api || !state.uid || typeof api.getUserNotificationsLastReadAt !== 'function') return;
    state.lastReadAt = await api.getUserNotificationsLastReadAt(state.uid);
  }

  function handleFirestoreUpdate(list, meta) {
    if (state.apiMode) {
      renderBell();
      return;
    }
    state.notifications = Array.isArray(list) ? list.slice() : [];
    if (!state.hydrated) {
      state.hydrated = true;
    } else if (meta && Array.isArray(meta.added) && meta.added.length) {
      meta.added.forEach(function (notification) {
        showNotificationToast(notification);
      });
    }
    renderBell();
  }

  function bindUi() {
    if (document.body.dataset.notificationsUiBound === '1') return;
    document.body.dataset.notificationsUiBound = '1';

    document.addEventListener('click', function (e) {
      var rowToggle = e.target.closest ? e.target.closest('[data-notifications-toggle]') : null;
      if (!rowToggle) return;
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      state.panelOpen = !state.panelOpen;
      renderBell();
    }, true);

    document.addEventListener('click', function (e) {
      var back = e.target.closest ? e.target.closest('[data-notifications-back]') : null;
      if (back) {
        e.preventDefault();
        e.stopPropagation();
        closePanel();
        if (global.PlatformSettings && typeof global.PlatformSettings.setPanelOpen === 'function') {
          global.PlatformSettings.setPanelOpen(true);
        }
        return;
      }

      var markAll = e.target.closest ? e.target.closest('[data-notifications-mark-all]') : null;
      if (markAll) {
        e.preventDefault();
        markAllRead();
        return;
      }

      var item = e.target.closest ? e.target.closest('[data-notification-id]') : null;
      if (item) {
        e.preventDefault();
        var link = item.getAttribute('data-notification-link') || '';
        var noteId = item.getAttribute('data-notification-id') || '';
        markOneRead(noteId).then(function () {
          if (link) global.location.href = link;
        });
        return;
      }

      if (state.panelOpen && !e.target.closest('[data-settings-root]')) {
        closePanel();
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closePanel();
    });

    global.addEventListener('ifa:notifications-firestore-changed', function (e) {
      var detail = (e && e.detail) || {};
      handleFirestoreUpdate(detail.list || [], detail.meta || {});
    });

    global.addEventListener('ifa:settings-lang-changed', function () {
      renderBell();
    });
  }

  async function start(uid, profile) {
    mountNotificationRoots();
    bindUi();
    state.uid = String(uid || '');
    state.profile = profile || null;
    if (!state.uid) {
      stop();
      return;
    }

    ensureNotificationsFirestoreSync();
    await refreshLastReadAt();
    var readApi = getFirestoreApi();
    if (readApi && typeof readApi.getUserNotificationReadIds === 'function') {
      var ids = await readApi.getUserNotificationReadIds(state.uid);
      state.readIds = {};
      ids.forEach(function (id) {
        state.readIds[id] = true;
      });
    }
    try {
      await loadApiNotifications();
    } catch (err) {
      console.warn('[PlatformNotifications] API list failed', err);
    }
    if (readApi && typeof readApi.fetchNotifications === 'function') {
      try {
        var fetched = await readApi.fetchNotifications();
        if (Array.isArray(fetched) && fetched.length) {
          handleFirestoreUpdate(fetched, { initial: true, added: [] });
        }
      } catch (err) {
        console.warn('[PlatformNotifications] fetchNotifications failed', err);
      }
    }

    var api = getFirestoreApi();
    if (api) {
      if (typeof api.subscribe === 'function') {
        if (state.firestoreUnsub) state.firestoreUnsub();
        state.firestoreUnsub = api.subscribe(handleFirestoreUpdate);
      }
      if (typeof api.getCachedNotifications === 'function') {
        handleFirestoreUpdate(api.getCachedNotifications(), { initial: true, added: [] });
      }
    }
    renderBell();
    scheduleLiveStream();
  }

  var reconnectTimer = null;

  function scheduleLiveStream() {
    var open = function () {
      if (state.uid) openLiveStream();
    };
    if (document.readyState === 'complete') {
      global.setTimeout(open, 0);
      return;
    }
    global.addEventListener('load', function () {
      global.setTimeout(open, 0);
    }, { once: true });
  }

  function closeLiveStream() {
    if (reconnectTimer) {
      global.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (state.liveSource) {
      state.liveSource.close();
      state.liveSource = null;
    }
  }

  function onLiveNotification(row) {
    if (!row || !row.id) return;
    var exists = state.notifications.some(function (item) {
      return item.id === row.id;
    });
    if (exists) return;
    var link = row.linkUrl || '';
    var item = {
      id: row.id,
      title: row.title || '',
      body: row.message || '',
      message: row.message || '',
      type: row.type || (/course-details\.html/i.test(link) ? 'course_published' : 'announcement'),
      target: row.target || '',
      targetAudience: 'all_students',
      active: true,
      linkUrl: link,
      createdAt: Date.parse(row.createdAt) || Date.now(),
      isRead: false,
    };
    if (!appliesToCurrentUser(item)) return;
    state.notifications = [item].concat(state.notifications);
    state.apiMode = true;
    renderBell();
    showNotificationToast({
      title: 'إشعار جديد: ' + item.title,
      body: item.body,
      linkUrl: courseLink(item),
      active: true,
      targetAudience: 'all_students',
    });
  }

  async function openLiveStream() {
    closeLiveStream();
    if (!state.uid || typeof EventSource === 'undefined') return;
    var token = await authToken();
    if (!token || !state.uid) return;
    var source = new EventSource('/api/notifications/stream?token=' + encodeURIComponent(token));
    state.liveSource = source;
    source.onmessage = function (event) {
      try {
        onLiveNotification(JSON.parse(event.data));
      } catch (err) {
        /* ignore malformed events */
      }
    };
    source.onerror = function () {
      if (state.liveSource !== source) return;
      source.close();
      state.liveSource = null;
      if (reconnectTimer) global.clearTimeout(reconnectTimer);
      reconnectTimer = global.setTimeout(function () {
        reconnectTimer = null;
        if (state.uid) openLiveStream();
      }, 8000);
    };
  }

  function stop() {
    state.uid = '';
    state.profile = null;
    state.notifications = [];
    state.panelOpen = false;
    state.hydrated = false;
    if (state.firestoreUnsub) {
      state.firestoreUnsub();
      state.firestoreUnsub = null;
    }
    closeLiveStream();
    renderBell();
  }

  function updateProfile(profile) {
    state.profile = profile || state.profile;
    renderBell();
  }

  global.PlatformNotifications = {
    start: start,
    stop: stop,
    updateProfile: updateProfile,
    mountNotificationRoots: mountNotificationRoots,
    renderBell: renderBell,
    openPanel: openPanel,
    closePanel: closePanel,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountNotificationRoots);
  } else {
    mountNotificationRoots();
  }
})(typeof window !== 'undefined' ? window : this);
