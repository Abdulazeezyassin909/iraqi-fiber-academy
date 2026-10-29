/**
 * Admin users management UI for admin.html
 * Binds to window.AdminUsers (localStorage store).
 */
(function () {
  'use strict';

  function bind() {
    if (!window.AdminUsers) {
      console.warn('[AdminUsersUI] AdminUsers missing');
      return;
    }

    function escapeHtml(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    var usersSearchQuery = '';
    var usersStatusFilter = 'all';
    var usersSelectionMode = null;
    var usersShowingArchive = false;
    var usersToolsMenuOpen = false;
    var usersFloatingMenu = null;

    function usersIsArchiveView() {
      return usersShowingArchive === true;
    }

    function getSelectedUserIds() {
      return Array.prototype.map
        .call(document.querySelectorAll('.user-row-check:checked'), function (el) {
          return el.value;
        })
        .filter(Boolean);
    }

    function clearUserChecks() {
      document.querySelectorAll('.user-row-check').forEach(function (cb) {
        cb.checked = false;
      });
      var selectAll = document.getElementById('usersSelectAll');
      if (selectAll) selectAll.checked = false;
    }

    function closeUsersToolsMenu() {
      var dropdown = document.getElementById('usersMenuDropdown');
      var btn = document.getElementById('usersMenuBtn');
      usersToolsMenuOpen = false;
      if (dropdown) dropdown.hidden = true;
      if (btn) {
        btn.setAttribute('aria-expanded', 'false');
        if (!usersSelectionMode) btn.classList.remove('is-active');
      }
    }

    function openUsersToolsMenu() {
      var dropdown = document.getElementById('usersMenuDropdown');
      var btn = document.getElementById('usersMenuBtn');
      if (!dropdown) return;
      var exitItem = dropdown.querySelector('[data-users-menu="exit-archive"]');
      var selectItem = dropdown.querySelector('[data-users-menu="select-delete"]');
      var viewItem = dropdown.querySelector('[data-users-menu="view-archive"]');
      var divider = dropdown.querySelector('[data-users-menu-main]');
      if (exitItem) exitItem.hidden = !usersShowingArchive;
      if (selectItem) selectItem.hidden = usersShowingArchive;
      if (viewItem) viewItem.hidden = usersShowingArchive;
      if (divider) divider.hidden = usersShowingArchive;
      usersToolsMenuOpen = true;
      dropdown.hidden = false;
      if (btn) btn.setAttribute('aria-expanded', 'true');
    }

    function syncUsersSelectionUi() {
      var panel = document.getElementById('users');
      var modeBtn = document.getElementById('usersMenuBtn');
      var cancelBtn = document.getElementById('usersCancelMode');
      var addBtn = document.getElementById('addUserBtn');
      var ids = getSelectedUserIds();
      var inSelection = !!usersSelectionMode;

      if (panel) panel.classList.toggle('is-selection-mode', inSelection);
      if (cancelBtn) cancelBtn.hidden = !inSelection;
      if (addBtn) addBtn.hidden = usersShowingArchive || inSelection;

      if (modeBtn) {
        modeBtn.classList.toggle('is-active', inSelection || usersToolsMenuOpen);
        modeBtn.classList.toggle('is-execute', inSelection);
        modeBtn.classList.toggle('admin-btn--danger', inSelection);

        if (inSelection) {
          modeBtn.textContent = 'حذف المحدد (' + ids.length + ')';
          modeBtn.title = 'حذف المحدد (إلى الأرشيف)';
        } else {
          modeBtn.textContent = '☰';
          modeBtn.title = 'قائمة الإجراءات';
          modeBtn.classList.remove('admin-btn--danger', 'admin-btn--primary');
        }
      }
    }

    function exitUsersSelectionMode() {
      usersSelectionMode = null;
      clearUserChecks();
      closeUsersToolsMenu();
      syncUsersSelectionUi();
    }

    function enterUsersSelectionMode() {
      usersShowingArchive = false;
      usersSelectionMode = 'delete';
      clearUserChecks();
      closeUsersToolsMenu();
      renderUsersTable();
      syncUsersSelectionUi();
    }

    function openUsersArchiveView() {
      usersSelectionMode = null;
      usersShowingArchive = true;
      clearUserChecks();
      closeUsersToolsMenu();
      renderUsersTable();
      syncUsersSelectionUi();
    }

    function exitUsersArchiveView() {
      usersShowingArchive = false;
      usersSelectionMode = null;
      clearUserChecks();
      closeUsersToolsMenu();
      renderUsersTable();
      syncUsersSelectionUi();
    }

    function executeUsersSelectionAction() {
      if (!window.AdminUsers) return;
      var ids = getSelectedUserIds();
      if (!ids.length) {
        alert('حدد عنصراً واحداً على الأقل.');
        return;
      }
      try {
        if (!window.confirm('نقل ' + ids.length + ' مستخدم إلى الأرشيف؟')) return;
        window.AdminUsers.archiveUsers(ids);
        exitUsersSelectionMode();
        renderUsersTable();
      } catch (err) {
        alert((err && err.message) || 'تعذر تنفيذ الإجراء');
      }
    }

    function userRoleBadge(role) {
      var cls = 'admin-badge--student';
      if (role === 'instructor') cls = 'admin-badge--instructor';
      if (role === 'admin') cls = 'admin-badge--admin';
      return (
        '<span class="admin-badge ' +
        cls +
        '">' +
        escapeHtml(window.AdminUsers.roleLabel(role)) +
        '</span>'
      );
    }

    function userStatusBadge(status) {
      var cls = 'admin-badge--active';
      if (status === 'pending') cls = 'admin-badge--pending';
      if (status === 'suspended') cls = 'admin-badge--suspended';
      if (status === 'expired') cls = 'admin-badge--expired';
      return (
        '<span class="admin-badge ' +
        cls +
        '">' +
        escapeHtml(window.AdminUsers.statusLabel(status)) +
        '</span>'
      );
    }

    function closeUsersRowMenus() {
      if (usersFloatingMenu) {
        usersFloatingMenu.remove();
        usersFloatingMenu = null;
      }
      document.querySelectorAll('[data-user-more].open').forEach(function (el) {
        el.classList.remove('open');
      });
    }

    function openUsersRowMenu(toggle, userId) {
      closeUsersRowMenus();
      var user = window.AdminUsers.findUser(userId);
      if (!user && !usersShowingArchive) return;

      var archived = usersShowingArchive
        ? window.AdminUsers.getArchivedUsers().filter(function (u) {
            return u.id === userId;
          })[0]
        : null;
      var target = user || archived;
      if (!target) return;

      toggle.classList.add('open');
      var menu = document.createElement('div');
      menu.className = 'admin-row-more__menu';
      menu.setAttribute('role', 'menu');

      var items = [];
      if (target.role === 'student' && (target.status === 'expired' || window.AdminUsers.isSubscriptionEnded(target))) {
        items.push(
          '<button type="button" role="menuitem" data-renew-user="' +
            escapeHtml(userId) +
            '">تجديد الاشتراك</button>'
        );
      }
      items.push(
        '<button type="button" role="menuitem" data-archive-user="' +
          escapeHtml(userId) +
          '">أرشفة</button>'
      );
      menu.innerHTML = items.join('');
      document.body.appendChild(menu);
      usersFloatingMenu = menu;

      var rect = toggle.getBoundingClientRect();
      var menuW = menu.offsetWidth || 160;
      var left = Math.min(window.innerWidth - menuW - 8, Math.max(8, rect.left + rect.width - menuW));
      menu.style.position = 'fixed';
      menu.style.top = rect.bottom + 6 + 'px';
      menu.style.left = left + 'px';
      menu.style.right = 'auto';
      menu.hidden = false;
    }

    function closeUserEditor() {
      var modal = document.getElementById('userEditorModal');
      if (modal) modal.hidden = true;
    }

    function openUserEditor(user) {
      var modal = document.getElementById('userEditorModal');
      var title = document.getElementById('userEditorTitle');
      var idEl = document.getElementById('userEditorId');
      var nameEl = document.getElementById('userEditorName');
      var emailEl = document.getElementById('userEditorEmail');
      var statusEl = document.getElementById('userEditorStatus');
      if (!modal) return;

      if (title) title.textContent = user ? 'تعديل مستخدم' : 'إضافة مستخدم';
      if (idEl) idEl.value = user ? user.id : '';
      if (nameEl) nameEl.value = user ? user.name : '';
      if (emailEl) emailEl.value = user ? user.email : '';
      if (statusEl) statusEl.value = user ? user.status : 'active';
      modal.hidden = false;
      if (nameEl) nameEl.focus();
    }

    function renderUsersTable() {
      var body = document.getElementById('usersTableBody');
      var meta = document.getElementById('usersMeta');
      var heading = document.getElementById('usersHeading');
      var desc = document.getElementById('usersDesc');
      var selectAll = document.getElementById('usersSelectAll');
      var showingArchive = usersIsArchiveView();
      if (!body || !window.AdminUsers) return;

      closeUsersRowMenus();
      if (selectAll) selectAll.checked = false;

      var filterWrap = document.getElementById('usersFilterWrap');
      if (filterWrap) filterWrap.hidden = showingArchive;

      if (heading) heading.textContent = showingArchive ? 'أرشيف المستخدمين' : 'إدارة المستخدمين';
      if (desc) {
        desc.textContent = showingArchive
          ? 'المستخدمون المؤرشفون — يمكنك الاستعادة أو الحذف النهائي'
          : 'عرض وإدارة حسابات الطلاب';
      }

      var list = showingArchive
        ? window.AdminUsers.getArchivedUsers().slice()
        : window.AdminUsers.getUsers().slice();

      list.sort(function (a, b) {
        var ka = showingArchive ? a.archivedAt || a.createdAt : a.createdAt;
        var kb = showingArchive ? b.archivedAt || b.createdAt : b.createdAt;
        return String(kb || '').localeCompare(String(ka || ''));
      });

      var q = usersSearchQuery;
      var statusFilter = usersStatusFilter || 'all';
      var filtered = list.filter(function (u) {
        if (!showingArchive && statusFilter !== 'all') {
          var displayStatus = window.AdminUsers.getDisplayStatus
            ? window.AdminUsers.getDisplayStatus(u)
            : u.status;
          if (statusFilter === 'expired') {
            var isExpired =
              displayStatus === 'expired' || window.AdminUsers.isSubscriptionEnded(u);
            if (!isExpired) return false;
          } else if (displayStatus !== statusFilter) {
            return false;
          }
        }
        if (!q) return true;
        return (
          String(u.name || '').toLowerCase().indexOf(q) !== -1 ||
          String(u.email || '').toLowerCase().indexOf(q) !== -1
        );
      });

      var archiveCount = window.AdminUsers.getArchivedUsers().length;
      if (meta) {
        if (
          !showingArchive &&
          window.AdminUsers.isFirestoreLive &&
          !window.AdminUsers.isFirestoreLive()
        ) {
          meta.textContent = 'جاري مزامنة المستخدمين من Firestore…';
        } else {
          meta.textContent = showingArchive
            ? archiveCount + ' في الأرشيف · عرض ' + filtered.length
            : 'عرض ' + filtered.length + ' من ' + list.length +
              (archiveCount ? ' · الأرشيف: ' + archiveCount : '') +
              (window.AdminUsers.isFirestoreLive && window.AdminUsers.isFirestoreLive()
                ? ' · Firestore'
                : '');
        }
      }

      if (!filtered.length) {
        body.innerHTML =
          '<tr><td colspan="7" class="admin-empty-cell">' +
          (showingArchive
            ? q
              ? 'لا نتائج في الأرشيف.'
              : 'الأرشيف فارغ.'
            : list.length
              ? 'لا نتائج مطابقة للتصفية أو البحث.'
              : 'لا يوجد مستخدمون.') +
          '</td></tr>';
        syncUsersSelectionUi();
        return;
      }

      body.innerHTML = filtered
        .map(function (user) {
          var id = escapeHtml(user.id);
          var initial = escapeHtml((user.name || '?').charAt(0));
          var rowStatus = window.AdminUsers.getDisplayStatus
            ? window.AdminUsers.getDisplayStatus(user)
            : user.status;
          var subLabel;
          var access = window.AdminUsers.resolveUserAccess
            ? window.AdminUsers.resolveUserAccess(user)
            : null;

          if (user.role === 'student' || user.role === 'instructor') {
            var subText = access
              ? access.subscriptionLabel
              : window.AdminUsers.getSubscriptionLabel(user);
            if (rowStatus === 'expired' || window.AdminUsers.isSubscriptionEnded(user)) {
              subLabel =
                '<span class="admin-sub-ended">' + escapeHtml(subText) + '</span>';
            } else {
              subLabel = escapeHtml(subText);
            }
          } else {
            subLabel = '—';
          }

          var actions;
          if (showingArchive) {
            actions =
              '<div class="admin-table__actions admin-table__actions--row">' +
              '<button class="admin-btn admin-btn--ghost admin-btn--sm" type="button" data-restore-user="' +
              id +
              '">استعادة</button>' +
              '<button class="admin-btn admin-btn--danger admin-btn--sm" type="button" data-purge-user="' +
              id +
              '">حذف نهائي</button>' +
              '</div>';
          } else {
            var suspendLabel = rowStatus === 'suspended' ? 'تفعيل' : 'إيقاف';
            var suspendCls =
              rowStatus === 'suspended'
                ? 'admin-btn admin-btn--ghost admin-btn--sm admin-btn--activate'
                : 'admin-btn admin-btn--danger admin-btn--sm';
            var moreNeeded =
              user.role === 'student' ||
              rowStatus === 'expired' ||
              window.AdminUsers.isSubscriptionEnded(user);

            actions =
              '<div class="admin-table__actions admin-table__actions--row">' +
              '<button class="admin-btn admin-btn--ghost admin-btn--sm" type="button" data-edit-user="' +
              id +
              '">تعديل</button>' +
              '<button class="' +
              suspendCls +
              '" type="button" data-toggle-suspend="' +
              id +
              '">' +
              suspendLabel +
              '</button>' +
              '<button class="admin-btn admin-btn--danger admin-btn--sm" type="button" data-delete-user="' +
              id +
              '">حذف</button>';

            if (rowStatus === 'expired') {
              actions +=
                '<button class="admin-btn admin-btn--primary admin-btn--sm" type="button" data-renew-user="' +
                id +
                '">تجديد</button>';
            }

            if (moreNeeded) {
              actions +=
                '<div class="admin-row-more">' +
                '<button class="admin-row-more__toggle" type="button" aria-label="المزيد" data-user-more="' +
                id +
                '">⋯</button>' +
                '</div>';
            }
            actions += '</div>';
          }

          return (
            '<tr data-user-id="' +
            id +
            '" data-name="' +
            escapeHtml(user.name) +
            '" data-email="' +
            escapeHtml(user.email) +
            '">' +
            '<td class="admin-td-check">' +
            '<input type="checkbox" class="user-row-check" value="' +
            id +
            '" aria-label="تحديد المستخدم" />' +
            '</td>' +
            '<td>' +
            '<div class="admin-user-cell">' +
            '<div class="admin-user-cell__avatar">' +
            initial +
            '</div>' +
            '<div>' +
            '<div class="admin-user-cell__name">' +
            escapeHtml(user.name) +
            '</div>' +
            '<div class="admin-user-cell__email">' +
            escapeHtml(user.email) +
            '</div>' +
            '</div>' +
            '</div>' +
            '</td>' +
            '<td>' +
            userRoleBadge(user.role) +
            '</td>' +
            '<td>' +
            userStatusBadge(rowStatus) +
            '</td>' +
            '<td>' +
            subLabel +
            '</td>' +
            '<td>' +
            escapeHtml(
              window.AdminUsers.formatDate(showingArchive ? user.archivedAt || user.createdAt : user.createdAt)
            ) +
            '</td>' +
            '<td>' +
            actions +
            '</td>' +
            '</tr>'
          );
        })
        .join('');

      syncUsersSelectionUi();
    }

    var userSearch = document.getElementById('userSearch');
    if (userSearch) {
      userSearch.addEventListener('input', function () {
        usersSearchQuery = userSearch.value.trim().toLowerCase();
        renderUsersTable();
      });
    }

    var usersFilterEl = document.getElementById('usersStatusFilter');
    if (usersFilterEl) {
      usersFilterEl.addEventListener('change', function () {
        usersStatusFilter = usersFilterEl.value || 'all';
        renderUsersTable();
      });
    }

    var usersMenuBtn = document.getElementById('usersMenuBtn');
    if (usersMenuBtn) {
      usersMenuBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (usersSelectionMode) {
          executeUsersSelectionAction();
          return;
        }
        if (usersToolsMenuOpen) closeUsersToolsMenu();
        else openUsersToolsMenu();
        syncUsersSelectionUi();
      });
    }

    var usersCancelBtn = document.getElementById('usersCancelMode');
    if (usersCancelBtn) {
      usersCancelBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        exitUsersSelectionMode();
      });
    }

    var usersMenuDropdown = document.getElementById('usersMenuDropdown');
    if (usersMenuDropdown) {
      usersMenuDropdown.addEventListener('click', function (e) {
        var item = e.target.closest ? e.target.closest('[data-users-menu]') : null;
        if (!item) return;
        e.stopPropagation();
        var action = item.getAttribute('data-users-menu');
        if (action === 'select-delete') enterUsersSelectionMode();
        else if (action === 'view-archive') openUsersArchiveView();
        else if (action === 'exit-archive') exitUsersArchiveView();
      });
    }

    var addUserBtn = document.getElementById('addUserBtn');
    if (addUserBtn) {
      addUserBtn.addEventListener('click', function () {
        openUserEditor(null);
      });
    }

    var userEditorForm = document.getElementById('userEditorForm');
    if (userEditorForm) {
      userEditorForm.addEventListener('submit', function (e) {
        e.preventDefault();
        if (!window.AdminUsers) return;
        var id = (document.getElementById('userEditorId') || {}).value || '';
        var payload = {
          name: (document.getElementById('userEditorName') || {}).value,
          email: (document.getElementById('userEditorEmail') || {}).value,
          role: 'student',
          status: (document.getElementById('userEditorStatus') || {}).value,
        };
        try {
          if (id) window.AdminUsers.updateUser(id, payload);
          else window.AdminUsers.addUser(payload);
          closeUserEditor();
          renderUsersTable();
        } catch (err) {
          alert((err && err.message) || 'تعذر حفظ المستخدم');
        }
      });
    }

    document.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('[data-close-user-modal]')) {
        closeUserEditor();
      }

      if (usersToolsMenuOpen) {
        var tools = document.getElementById('usersToolsMenu');
        if (tools && !tools.contains(e.target)) closeUsersToolsMenu();
      }

      if (!window.AdminUsers) return;

      var moreToggle = e.target.closest ? e.target.closest('[data-user-more]') : null;
      if (moreToggle) {
        e.preventDefault();
        e.stopPropagation();
        var mid = moreToggle.getAttribute('data-user-more');
        if (moreToggle.classList.contains('open')) closeUsersRowMenus();
        else openUsersRowMenu(moreToggle, mid);
        return;
      }

      if (
        usersFloatingMenu &&
        !e.target.closest('.admin-row-more__menu') &&
        !e.target.closest('[data-user-more]')
      ) {
        closeUsersRowMenus();
      }

      var editBtn = e.target.closest ? e.target.closest('[data-edit-user]') : null;
      var suspendBtn = e.target.closest ? e.target.closest('[data-toggle-suspend]') : null;
      var renewBtn = e.target.closest ? e.target.closest('[data-renew-user]') : null;
      var archiveBtn = e.target.closest ? e.target.closest('[data-archive-user]') : null;
      var restoreBtn = e.target.closest ? e.target.closest('[data-restore-user]') : null;
      var purgeBtn = e.target.closest ? e.target.closest('[data-purge-user]') : null;
      var deleteUserBtn = e.target.closest ? e.target.closest('[data-delete-user]') : null;

      try {
        if (deleteUserBtn) {
          var deleteId = deleteUserBtn.getAttribute('data-delete-user');
          if (
            !window.confirm(
              'هل أنت متأكد من حذف هذا المستخدم نهائياً؟ سيتم مسح جميع بياناته.'
            )
          ) {
            return;
          }
          if (!window.AdminUsers || typeof window.AdminUsers.deleteUser !== 'function') {
            alert('تعذر الحذف: Firestore غير متصل.');
            return;
          }
          deleteUserBtn.disabled = true;
          Promise.resolve(window.AdminUsers.deleteUser(deleteId))
            .then(function () {
              alert('تم حذف المستخدم بنجاح.');
              renderUsersTable();
            })
            .catch(function (err) {
              alert((err && err.message) || 'تعذر حذف المستخدم');
            })
            .finally(function () {
              deleteUserBtn.disabled = false;
            });
          return;
        }
        if (editBtn) {
          var editUser = window.AdminUsers.findUser(editBtn.getAttribute('data-edit-user'));
          if (editUser) openUserEditor(editUser);
          return;
        }
        if (suspendBtn) {
          window.AdminUsers.toggleSuspend(suspendBtn.getAttribute('data-toggle-suspend'));
          closeUsersRowMenus();
          renderUsersTable();
          return;
        }
        if (renewBtn) {
          window.AdminUsers.renewSubscription(renewBtn.getAttribute('data-renew-user'), 90);
          closeUsersRowMenus();
          renderUsersTable();
          return;
        }
        if (archiveBtn) {
          if (!window.confirm('نقل هذا المستخدم إلى الأرشيف؟')) return;
          window.AdminUsers.archiveUser(archiveBtn.getAttribute('data-archive-user'));
          closeUsersRowMenus();
          renderUsersTable();
          return;
        }
        if (restoreBtn) {
          window.AdminUsers.restoreUser(restoreBtn.getAttribute('data-restore-user'));
          renderUsersTable();
          return;
        }
        if (purgeBtn) {
          if (!window.confirm('حذف نهائي؟ سيتم إلغاء الاشتراك وحذف الطلبات المرتبطة في Firestore.')) return;
          var purgeId = purgeBtn.getAttribute('data-purge-user');
          closeUsersRowMenus();
          purgeBtn.disabled = true;
          var purgeFn =
            window.AdminUsers.permanentDeleteUserWithFirestore ||
            window.AdminUsers.permanentDeleteUser;
          Promise.resolve(purgeFn(purgeId))
            .then(function () {
              renderUsersTable();
            })
            .catch(function (err) {
              alert((err && err.message) || 'تعذر حذف المستخدم');
            })
            .finally(function () {
              purgeBtn.disabled = false;
            });
        }
      } catch (err) {
        alert((err && err.message) || 'تعذر تنفيذ الإجراء');
      }
    });

    document.addEventListener('change', function (e) {
      if (e.target && e.target.id === 'usersSelectAll') {
        document.querySelectorAll('.user-row-check').forEach(function (cb) {
          cb.checked = e.target.checked;
        });
        syncUsersSelectionUi();
        return;
      }
      if (e.target && e.target.classList && e.target.classList.contains('user-row-check')) {
        syncUsersSelectionUi();
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var modal = document.getElementById('userEditorModal');
      if (modal && !modal.hidden) {
        closeUserEditor();
        return;
      }
      if (usersToolsMenuOpen) closeUsersToolsMenu();
      else if (usersSelectionMode) exitUsersSelectionMode();
    });

    window.addEventListener('scroll', closeUsersRowMenus, true);
    window.addEventListener('resize', closeUsersRowMenus);

    document.addEventListener('ifa:admin-users-changed', renderUsersTable);
    window.addEventListener('ifa:admin-users-changed', renderUsersTable);

    renderUsersTable();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
