/**
 * Admin instructors management UI for admin.html
 * Binds to window.InstructorApps (localStorage store).
 */
(function () {
  'use strict';

  function bind() {
    if (!window.InstructorApps) {
      console.warn('[AdminInstructorsUI] InstructorApps missing');
      return;
    }

    function escapeHtml(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function statusBadge(status) {
      if (status === 'approved') return '<span class="admin-badge admin-badge--active">موافق عليه</span>';
      if (status === 'rejected') return '<span class="admin-badge admin-badge--suspended">مرفوض</span>';
      if (status === 'on_hold') return '<span class="admin-badge admin-badge--hold">معلّق</span>';
      return '<span class="admin-badge admin-badge--pending">قيد المراجعة</span>';
    }

    function cvCell(app) {
      var parts = [];
      if (app.cvLink) {
        parts.push('<a href="' + escapeHtml(app.cvLink) + '" target="_blank" rel="noopener noreferrer" class="admin-cv-link">عرض السيرة الذاتية</a>');
      }
      if (app.cvFileName) {
        parts.push('<span class="admin-cv-file">' + escapeHtml(app.cvFileName) + '</span>');
      }
      return parts.length ? parts.join('<br>') : '—';
    }

    var instructorFilter = 'all';
    var instructorTab = 'requests'; /* requests | roster */
    var selectionModeType = null; /* null | 'delete' */
    var showingArchiveView = false;
    var floatingMenu = null;
    var toolsMenuOpen = false;

    function isArchiveView() {
      return showingArchiveView === true;
    }

    function isRosterTab() {
      return instructorTab === 'roster' && !showingArchiveView;
    }

    function getSelectedIds() {
      return Array.prototype.map
        .call(document.querySelectorAll('.instructor-row-check:checked'), function (el) {
          return el.value;
        })
        .filter(Boolean);
    }

    function clearRowChecks() {
      document.querySelectorAll('.instructor-row-check').forEach(function (cb) {
        cb.checked = false;
      });
      var selectAll = document.getElementById('instructorSelectAll');
      if (selectAll) selectAll.checked = false;
    }

    function syncInstructorTabsUi() {
      var tabs = document.getElementById('instructorTabs');
      if (tabs) tabs.hidden = showingArchiveView;
      document.querySelectorAll('[data-instructor-tab]').forEach(function (btn) {
        var active = btn.getAttribute('data-instructor-tab') === instructorTab;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-selected', active ? 'true' : 'false');
      });
    }

    function setInstructorTab(tab) {
      instructorTab = tab === 'roster' ? 'roster' : 'requests';
      showingArchiveView = false;
      selectionModeType = null;
      clearRowChecks();
      closeToolsMenu();
      var filterEl = document.getElementById('instructorRequestsFilter');
      if (filterEl) {
        if (instructorTab === 'roster') {
          filterEl.innerHTML =
            '<option value="all">الكل</option>' +
            '<option value="active">نشط</option>' +
            '<option value="suspended">موقوف</option>';
        } else {
          filterEl.innerHTML =
            '<option value="all">الكل</option>' +
            '<option value="pending">قيد المراجعة</option>' +
            '<option value="on_hold">معلّق</option>' +
            '<option value="rejected">مرفوض</option>';
        }
        instructorFilter = 'all';
        filterEl.value = 'all';
      }
      renderInstructorPanel();
    }

    function closeToolsMenu() {
      var dropdown = document.getElementById('instructorMenuDropdown');
      var btn = document.getElementById('instructorMenuBtn');
      toolsMenuOpen = false;
      if (dropdown) dropdown.hidden = true;
      if (btn) {
        btn.setAttribute('aria-expanded', 'false');
        if (!selectionModeType) btn.classList.remove('is-active');
      }
    }

    function openToolsMenu() {
      var dropdown = document.getElementById('instructorMenuDropdown');
      var btn = document.getElementById('instructorMenuBtn');
      var exitArchiveItem = dropdown
        ? dropdown.querySelector('[data-menu-action="exit-archive"]')
        : null;
      var selectItem = dropdown
        ? dropdown.querySelector('[data-menu-action="select-delete"]')
        : null;
      var viewArchiveItem = dropdown
        ? dropdown.querySelector('[data-menu-action="view-archive"]')
        : null;
      var divider = dropdown ? dropdown.querySelector('[data-menu-main]') : null;

      if (exitArchiveItem) exitArchiveItem.hidden = !showingArchiveView;
      if (selectItem) selectItem.hidden = showingArchiveView;
      if (viewArchiveItem) viewArchiveItem.hidden = showingArchiveView;
      if (divider) divider.hidden = showingArchiveView;

      toolsMenuOpen = true;
      if (dropdown) dropdown.hidden = false;
      if (btn) btn.setAttribute('aria-expanded', 'true');
    }

    function syncSelectionUi() {
      var panel = document.getElementById('instructors');
      var modeBtn = document.getElementById('instructorMenuBtn');
      var cancelBtn = document.getElementById('instructorCancelMode');
      var ids = getSelectedIds();
      var inSelection = !!selectionModeType;

      if (panel) panel.classList.toggle('is-selection-mode', inSelection);
      if (cancelBtn) cancelBtn.hidden = !inSelection;

      if (modeBtn) {
        modeBtn.classList.toggle('is-active', inSelection || toolsMenuOpen);
        modeBtn.classList.toggle('is-execute', inSelection);
        modeBtn.classList.toggle('admin-btn--danger', inSelection);

        if (inSelection) {
          modeBtn.textContent = 'حذف المحدد (' + ids.length + ')';
          modeBtn.setAttribute('aria-label', 'حذف المحدد');
          modeBtn.title = 'حذف المحدد';
        } else {
          modeBtn.textContent = '☰';
          modeBtn.setAttribute('aria-label', 'قائمة الإجراءات');
          modeBtn.title = 'قائمة الإجراءات';
          modeBtn.classList.remove('admin-btn--danger', 'admin-btn--primary');
        }
      }
    }

    function updateBatchBar() {
      syncSelectionUi();
    }

    function exitSelectionMode() {
      selectionModeType = null;
      clearRowChecks();
      closeToolsMenu();
      syncSelectionUi();
    }

    function enterSelectionMode() {
      showingArchiveView = false;
      selectionModeType = 'delete';
      clearRowChecks();
      closeToolsMenu();
      renderInstructorPanel();
      syncSelectionUi();
    }

    function openArchiveView() {
      selectionModeType = null;
      showingArchiveView = true;
      clearRowChecks();
      closeToolsMenu();
      renderInstructorPanel();
      syncSelectionUi();
    }

    function exitArchiveView() {
      showingArchiveView = false;
      selectionModeType = null;
      clearRowChecks();
      closeToolsMenu();
      renderInstructorPanel();
      syncSelectionUi();
    }

    function executeSelectionAction() {
      var ids = getSelectedIds();
      if (!ids.length) {
        alert('حدد عنصراً واحداً على الأقل.');
        return;
      }
      try {
        if (isRosterTab()) {
          if (!window.confirm('حذف ' + ids.length + ' مدرب ونقلهم إلى الأرشيف؟')) return;
          window.InstructorApps.removeInstructors(ids);
          refreshAfterAction({ type: 'batch-remove-instructors', ids: ids });
        } else {
          if (!window.confirm('نقل ' + ids.length + ' عنصر إلى الأرشيف؟')) return;
          window.InstructorApps.archiveApplications(ids);
          refreshAfterAction({ type: 'batch-delete-to-archive', ids: ids });
        }
        exitSelectionMode();
      } catch (err) {
        alert((err && err.message) || 'تعذر تنفيذ الإجراء');
      }
    }

    function closeAllRowMenus() {
      document.querySelectorAll('.admin-row-more__toggle.open').forEach(function (t) {
        t.classList.remove('open');
      });
      if (floatingMenu && floatingMenu.parentNode) {
        floatingMenu.parentNode.removeChild(floatingMenu);
      }
      floatingMenu = null;
    }

    function openRowMenu(toggleBtn, id) {
      closeAllRowMenus();
      toggleBtn.classList.add('open');
      var rect = toggleBtn.getBoundingClientRect();
      var menu = document.createElement('div');
      menu.className = 'admin-row-more__menu admin-row-more__menu--fixed';
      menu.setAttribute('data-row-more-menu', id);

      if (isArchiveView()) {
        menu.innerHTML =
          '<button type="button" data-restore-instructor="' + id + '">استعادة</button>' +
          '<button type="button" class="is-danger" data-purge-instructor="' + id + '">حذف نهائي</button>';
      } else if (isRosterTab()) {
        menu.innerHTML =
          '<button type="button" class="is-danger" data-remove-instructor="' + id + '">حذف المدرب</button>';
      } else {
        var app =
          window.InstructorApps &&
          window.InstructorApps.getApplications().filter(function (a) {
            return a.id === id;
          })[0];
        var status = app ? app.status : 'pending';
        var items = [];
        if (status !== 'pending') {
          items.push(
            '<button type="button" data-reset-instructor="' + id + '">إعادة قيد المراجعة</button>'
          );
        }
        if (status !== 'on_hold') {
          items.push(
            '<button type="button" data-hold-instructor="' + id + '">تعليق الطلب</button>'
          );
        }
        items.push(
          '<button type="button" class="is-danger" data-delete-instructor="' + id + '">حذف الطلب</button>'
        );
        menu.innerHTML = items.join('');
      }

      document.body.appendChild(menu);
      floatingMenu = menu;

      var menuWidth = menu.offsetWidth || 150;
      var left = rect.left;
      if (left + menuWidth > window.innerWidth - 8) {
        left = Math.max(8, rect.right - menuWidth);
      }
      var top = rect.bottom + 6;
      if (top + menu.offsetHeight > window.innerHeight - 8) {
        top = Math.max(8, rect.top - menu.offsetHeight - 6);
      }
      menu.style.position = 'fixed';
      menu.style.top = top + 'px';
      menu.style.left = left + 'px';
      menu.style.right = 'auto';
      menu.hidden = false;
    }

    function closeInstructorEditor() {
      var modal = document.getElementById('instructorEditorModal');
      if (modal) modal.hidden = true;
    }

    function openInstructorEditor(instructor) {
      var modal = document.getElementById('instructorEditorModal');
      if (!modal || !instructor) return;
      var idEl = document.getElementById('instructorEditorId');
      var nameEl = document.getElementById('instructorEditorName');
      var emailEl = document.getElementById('instructorEditorEmail');
      var bioEl = document.getElementById('instructorEditorBio');
      var coursesEl = document.getElementById('instructorEditorCourses');
      if (idEl) idEl.value = instructor.id || instructor.email;
      if (nameEl) nameEl.value = instructor.fullName || '';
      if (emailEl) emailEl.value = instructor.email || '';
      if (bioEl) bioEl.value = instructor.bio || '';
      if (coursesEl) coursesEl.value = instructor.courses || '';
      modal.hidden = false;
      if (nameEl) nameEl.focus();
    }

    window.editInstructor = function (instructorId) {
      if (!window.InstructorApps || typeof window.InstructorApps.findActiveInstructor !== 'function') {
        alert('تعذر فتح التعديل.');
        return;
      }
      var instructor = window.InstructorApps.findActiveInstructor(instructorId);
      if (!instructor) {
        alert('تعذر العثور على بيانات هذا المدرب.');
        return;
      }
      openInstructorEditor(instructor);
    };

    function setTableHead(mode) {
      var head = document.getElementById('instructorTableHead');
      if (!head) return;
      if (mode === 'roster') {
        head.innerHTML =
          '<tr>' +
          '<th scope="col" class="admin-th-check"><input type="checkbox" id="instructorSelectAll" aria-label="تحديد الكل" /></th>' +
          '<th scope="col">المدرب</th>' +
          '<th scope="col">النبذة</th>' +
          '<th scope="col">الكورسات</th>' +
          '<th scope="col">تاريخ الاعتماد</th>' +
          '<th scope="col">الحالة</th>' +
          '<th scope="col">الإجراءات</th>' +
          '</tr>';
      } else {
        head.innerHTML =
          '<tr>' +
          '<th scope="col" class="admin-th-check"><input type="checkbox" id="instructorSelectAll" aria-label="تحديد الكل" /></th>' +
          '<th scope="col">المتقدم</th>' +
          '<th scope="col">السيرة الذاتية</th>' +
          '<th scope="col">التاريخ</th>' +
          '<th scope="col">الحالة</th>' +
          '<th scope="col">الإجراءات</th>' +
          '</tr>';
      }
    }

    function accountStatusBadge(status) {
      if (status === 'suspended') {
        return '<span class="admin-badge admin-badge--suspended">موقوف</span>';
      }
      return '<span class="admin-badge admin-badge--active">نشط</span>';
    }

    function renderInstructorPanel() {
      var body = document.getElementById('instructorRequestsBody');
      var meta = document.getElementById('instructorRequestsMeta');
      var heading = document.getElementById('instructorsHeading');
      var desc = document.getElementById('instructorsDesc');
      var showingArchive = isArchiveView();
      var roster = isRosterTab();
      if (!body || !window.InstructorApps) return;

      closeAllRowMenus();
      syncInstructorTabsUi();
      setTableHead(showingArchive ? 'requests' : roster ? 'roster' : 'requests');

      var filterWrap = document.getElementById('instructorFilterWrap');
      if (filterWrap) filterWrap.hidden = showingArchive;

      if (heading) {
        heading.textContent = showingArchive ? 'سجل الأرشيف' : 'إدارة المدربين';
      }
      if (desc) {
        desc.textContent = showingArchive
          ? 'العناصر المؤرشفة — يمكنك الاستعادة أو الحذف النهائي'
          : roster
            ? 'إدارة حسابات المدربين المعتمدين'
            : 'مراجعة طلبات الانضمام كمدرب والموافقة أو الرفض';
      }

      var pendingCount = window.InstructorApps.getPendingApplications().length;
      var rosterCount = window.InstructorApps.getActiveInstructors().length;
      var archiveCount = window.InstructorApps.getArchivedApplications().length;

      if (showingArchive) {
        var archived = window.InstructorApps.getArchivedApplications().slice();
        archived.sort(function (a, b) {
          return String(b.archivedAt || b.createdAt || '').localeCompare(
            String(a.archivedAt || a.createdAt || '')
          );
        });
        if (meta) meta.textContent = archiveCount + ' عنصر في الأرشيف · عرض ' + archived.length;
        if (!archived.length) {
          body.innerHTML = '<tr><td colspan="6" class="admin-empty-cell">الأرشيف فارغ.</td></tr>';
          syncSelectionUi();
          return;
        }
        body.innerHTML = archived
          .map(function (app) {
            return renderRequestRow(app, true);
          })
          .join('');
        syncSelectionUi();
        return;
      }

      if (roster) {
        var instructors = window.InstructorApps.getActiveInstructors().slice();
        var filteredRoster = instructors.filter(function (inst) {
          return instructorFilter === 'all' || inst.accountStatus === instructorFilter;
        });
        if (meta) {
          meta.textContent =
            rosterCount +
            ' مدرب معتمد · عرض ' +
            filteredRoster.length +
            (archiveCount ? ' · الأرشيف: ' + archiveCount : '');
        }
        if (!filteredRoster.length) {
          var loadError = window.InstructorApps.getInstructorsLoadError
            ? window.InstructorApps.getInstructorsLoadError()
            : '';
          body.innerHTML =
            '<tr><td colspan="7" class="admin-empty-cell">' +
            (loadError
              ? escapeHtml(loadError)
              : instructors.length
              ? 'لا يوجد مدربون ضمن التصفية المحددة.'
              : 'لا يوجد مدربون معتمدون بعد. وافق على طلب من تبويب «طلبات الانضمام».') +
            '</td></tr>';
          syncSelectionUi();
          return;
        }
        body.innerHTML = filteredRoster.map(renderRosterRow).join('');
        syncSelectionUi();
        return;
      }

      /* Requests tab — exclude approved (they live in roster) */
      var apps = window.InstructorApps.getApplications()
        .slice()
        .filter(function (a) {
          return a.status !== 'approved';
        });
      apps.sort(function (a, b) {
        return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
      });
      var filtered = apps.filter(function (a) {
        return instructorFilter === 'all' || a.status === instructorFilter;
      });

      if (meta) {
        meta.textContent =
          pendingCount +
          ' طلب قيد المراجعة · ' +
          rosterCount +
          ' مدرب · عرض ' +
          filtered.length +
          (archiveCount ? ' · الأرشيف: ' + archiveCount : '');
      }

      if (!filtered.length) {
        body.innerHTML =
          '<tr><td colspan="6" class="admin-empty-cell">' +
          (apps.length
            ? 'لا توجد طلبات ضمن التصفية المحددة.'
            : 'لا توجد طلبات حالياً. ستظهر هنا بعد الإرسال من صفحة الموقع.') +
          '</td></tr>';
        syncSelectionUi();
        return;
      }

      body.innerHTML = filtered
        .map(function (app) {
          return renderRequestRow(app, false);
        })
        .join('');
      syncSelectionUi();
    }

    function renderRequestRow(app, showingArchive) {
      var initial = escapeHtml((app.fullName || '?').charAt(0));
      var id = escapeHtml(app.id);
      var dateLabel = showingArchive
        ? window.InstructorApps.formatDate(app.archivedAt || app.createdAt)
        : window.InstructorApps.formatDate(app.createdAt);

      var actions =
        '<div class="admin-table__actions admin-table__actions--row">' +
        (showingArchive
          ? '<button class="admin-btn admin-btn--ghost admin-btn--sm" type="button" data-restore-instructor="' +
            id +
            '">استعادة</button>' +
            '<button class="admin-btn admin-btn--danger admin-btn--sm" type="button" data-purge-instructor="' +
            id +
            '">حذف نهائي</button>'
          : '<button type="button" class="admin-btn admin-btn--ghost admin-btn--sm" data-app-details="' +
            id +
            '">التفاصيل</button>') +
        '</div>';

      return (
        '<tr data-app-id="' +
        id +
        '">' +
        '<td class="admin-td-check">' +
        '<input type="checkbox" class="instructor-row-check" value="' +
        id +
        '" aria-label="تحديد الطلب" />' +
        '</td>' +
        '<td>' +
        '<button type="button" class="admin-user-cell" data-app-details="' +
        id +
        '" style="background:none;border:0;padding:0;cursor:pointer;text-align:inherit;color:inherit;">' +
        '<div class="admin-user-cell__avatar">' +
        initial +
        '</div>' +
        '<div>' +
        '<div class="admin-user-cell__name">' +
        escapeHtml(app.fullName) +
        '</div>' +
        '<div class="admin-user-cell__email">' +
        escapeHtml(app.email) +
        '</div>' +
        '</div>' +
        '</button>' +
        '</td>' +
        '<td>' +
        cvCell(app) +
        '</td>' +
        '<td>' +
        escapeHtml(dateLabel) +
        '</td>' +
        '<td>' +
        statusBadge(app.status) +
        '</td>' +
        '<td>' +
        actions +
        '</td>' +
        '</tr>'
      );
    }

    function renderRosterRow(inst) {
      var initial = escapeHtml((inst.fullName || '?').charAt(0));
      var id = escapeHtml(inst.id);
      var suspendLabel = inst.accountStatus === 'suspended' ? 'تفعيل' : 'إيقاف';
      var suspendCls =
        inst.accountStatus === 'suspended'
          ? 'admin-btn admin-btn--ghost admin-btn--sm admin-btn--activate'
          : 'admin-btn admin-btn--danger admin-btn--sm';

      var actions =
        '<div class="admin-table__actions admin-table__actions--row">' +
        '<button class="admin-btn admin-btn--ghost admin-btn--sm" type="button" data-edit-instructor="' +
        id +
        '" onclick="editInstructor(\'' +
        id +
        '\')">تعديل</button>' +
        '<button class="' +
        suspendCls +
        '" type="button" data-toggle-instructor="' +
        id +
        '">' +
        suspendLabel +
        '</button>' +
        '<button class="admin-btn admin-btn--danger admin-btn--sm" type="button" onclick="window.AdminInstructors.revokeInstructor(\'' +
        id +
        '\')">حذف</button>' +
        '<div class="admin-row-more">' +
        '<button class="admin-row-more__toggle" type="button" aria-label="المزيد" data-row-more="' +
        id +
        '">⋯</button>' +
        '</div>' +
        '</div>';

      return (
        '<tr data-instructor-id="' +
        id +
        '">' +
        '<td class="admin-td-check">' +
        '<input type="checkbox" class="instructor-row-check" value="' +
        id +
        '" aria-label="تحديد المدرب" />' +
        '</td>' +
        '<td>' +
        '<div class="admin-user-cell">' +
        '<div class="admin-user-cell__avatar">' +
        initial +
        '</div>' +
        '<div>' +
        '<div class="admin-user-cell__name">' +
        escapeHtml(inst.fullName) +
        '</div>' +
        '<div class="admin-user-cell__email">' +
        escapeHtml(inst.email) +
        '</div>' +
        '</div>' +
        '</div>' +
        '</td>' +
        '<td><div class="admin-cell-clamp">' +
        escapeHtml(inst.bio) +
        '</div></td>' +
        '<td><div class="admin-cell-clamp">' +
        escapeHtml(inst.courses) +
        '</div></td>' +
        '<td>' +
        escapeHtml(window.InstructorApps.formatDate(inst.approvedAt)) +
        '</td>' +
        '<td>' +
        accountStatusBadge(inst.accountStatus) +
        '</td>' +
        '<td>' +
        actions +
        '</td>' +
        '</tr>'
      );
    }

    function closeAppDetailsModal() {
      var modal = document.getElementById('appDetailsModal');
      if (!modal) return;
      modal.hidden = true;
    }

    function openAppDetails(uid) {
      var list = window.InstructorApps && window.InstructorApps.getApplications
        ? window.InstructorApps.getApplications()
        : [];
      var app = null;
      for (var i = 0; i < list.length; i++) {
        if (list[i] && (list[i].id === uid || list[i].uid === uid)) {
          app = list[i];
          break;
        }
      }
      if (!app) return;
      var nameEl = document.getElementById('appDetailsName');
      var emailEl = document.getElementById('appDetailsEmail');
      var bioEl = document.getElementById('appDetailsBio');
      var coursesEl = document.getElementById('appDetailsCourses');
      var cvEl = document.getElementById('appDetailsCv');
      if (nameEl) nameEl.textContent = app.fullName || '—';
      if (emailEl) emailEl.textContent = app.email || '—';
      if (bioEl) bioEl.textContent = app.bio || '—';
      if (coursesEl) coursesEl.textContent = app.specialization || app.courses || '—';
      if (cvEl) {
        if (app.cvLink) {
          cvEl.innerHTML = '<a href="' + escapeHtml(app.cvLink) + '" target="_blank" rel="noopener noreferrer" style="color:#0ea5e9;text-decoration:underline;font-weight:bold;">اضغط هنا لعرض السيرة الذاتية</a>';
        } else {
          cvEl.innerHTML = '<span style="color:#ef4444;font-weight:bold;">لا توجد سيرة ذاتية</span>';
        }
      }
      var approveBtn = document.getElementById('modalApproveBtn');
      var rejectBtn = document.getElementById('modalRejectBtn');
      var pending = app.status === 'pending';
      if (approveBtn) {
        approveBtn.hidden = !pending;
        approveBtn.onclick = function () {
          Promise.resolve(window.InstructorApps.approveApplication(uid))
            .then(function () {
              closeAppDetailsModal();
              renderInstructorPanel();
            })
            .catch(function (err) {
              alert((err && err.message) || 'تعذر تنفيذ الموافقة');
            });
        };
      }
      if (rejectBtn) {
        rejectBtn.hidden = !pending;
        rejectBtn.onclick = function () {
          Promise.resolve(window.InstructorApps.rejectApplication(uid))
            .then(function () {
              closeAppDetailsModal();
              renderInstructorPanel();
            })
            .catch(function (err) {
              alert((err && err.message) || 'تعذر تنفيذ الرفض');
            });
        };
      }
      var modal = document.getElementById('appDetailsModal');
      if (modal) modal.hidden = false;
    }

    window.AdminInstructors = {
      openAppDetails: openAppDetails,
      closeAppDetailsModal: closeAppDetailsModal,
      revokeInstructor: function (uid) {
        if (window.InstructorApps && window.InstructorApps.revokeInstructor) {
          window.InstructorApps.revokeInstructor(uid);
        }
      },
    };

    function refreshAfterAction(detail) {
      document.dispatchEvent(new CustomEvent('ifa:instructor-status-changed', { detail: detail || null }));
      renderInstructorPanel();
    }

    document.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('[data-close-app-details]')) {
        closeAppDetailsModal();
      }

      if (e.target.closest && e.target.closest('[data-close-instructor-modal]')) {
        closeInstructorEditor();
      }

      var tabBtn = e.target.closest ? e.target.closest('[data-instructor-tab]') : null;
      if (tabBtn) {
        setInstructorTab(tabBtn.getAttribute('data-instructor-tab'));
        return;
      }

      if (!window.InstructorApps) return;

      var moreToggle = e.target.closest ? e.target.closest('[data-row-more]') : null;
      if (moreToggle) {
        e.preventDefault();
        e.stopPropagation();
        var mid = moreToggle.getAttribute('data-row-more');
        if (moreToggle.classList.contains('open')) closeAllRowMenus();
        else openRowMenu(moreToggle, mid);
        return;
      }

      if (floatingMenu && !e.target.closest('.admin-row-more__menu') && !e.target.closest('[data-row-more]')) {
        closeAllRowMenus();
      }

      var detailsBtn = e.target.closest ? e.target.closest('[data-app-details]') : null;
      if (detailsBtn) {
        openAppDetails(detailsBtn.getAttribute('data-app-details'));
        return;
      }

      var approveBtn = e.target.closest ? e.target.closest('[data-approve-instructor]') : null;
      var rejectBtn = e.target.closest ? e.target.closest('[data-reject-instructor]') : null;
      var resetBtn = e.target.closest ? e.target.closest('[data-reset-instructor]') : null;
      var holdBtn = e.target.closest ? e.target.closest('[data-hold-instructor]') : null;
      var deleteBtn = e.target.closest ? e.target.closest('[data-delete-instructor]') : null;
      var removeBtn = e.target.closest ? e.target.closest('[data-remove-instructor]') : null;
      var editInstBtn = e.target.closest ? e.target.closest('[data-edit-instructor]') : null;
      var toggleInstBtn = e.target.closest ? e.target.closest('[data-toggle-instructor]') : null;
      var restoreBtn = e.target.closest ? e.target.closest('[data-restore-instructor]') : null;
      var purgeBtn = e.target.closest ? e.target.closest('[data-purge-instructor]') : null;

      if (approveBtn) {
        var approveId = approveBtn.getAttribute('data-approve-instructor');
        Promise.resolve(window.InstructorApps.approveApplication(approveId))
          .then(function (approved) {
            closeAllRowMenus();
            document.dispatchEvent(
              new CustomEvent('ifa:instructor-status-changed', { detail: approved || null })
            );
            alert('تمت الموافقة ومنح صلاحية المدرب.');
            renderInstructorPanel();
          })
          .catch(function (err) {
            alert((err && err.message) || 'تعذر تنفيذ الموافقة');
          });
        return;
      }

      if (rejectBtn) {
        var rejectId = rejectBtn.getAttribute('data-reject-instructor');
        Promise.resolve(window.InstructorApps.rejectApplication(rejectId))
          .then(function (rejected) {
            closeAllRowMenus();
            refreshAfterAction(rejected);
          })
          .catch(function (err) {
            alert((err && err.message) || 'تعذر تنفيذ الرفض');
          });
        return;
      }

      if (resetBtn) {
        try {
          var resetApp = window.InstructorApps.resetApplication(
            resetBtn.getAttribute('data-reset-instructor')
          );
          closeAllRowMenus();
          refreshAfterAction(resetApp);
        } catch (err) {
          alert((err && err.message) || 'تعذر إعادة الطلب لقيد المراجعة');
        }
        return;
      }

      if (holdBtn) {
        try {
          var held = window.InstructorApps.holdApplication(holdBtn.getAttribute('data-hold-instructor'));
          closeAllRowMenus();
          refreshAfterAction(held);
        } catch (err) {
          alert((err && err.message) || 'تعذر تعليق الطلب');
        }
        return;
      }

      if (deleteBtn) {
        if (!window.confirm('نقل هذا الطلب إلى سجل الأرشيف؟')) return;
        try {
          var deleted = window.InstructorApps.archiveApplication(
            deleteBtn.getAttribute('data-delete-instructor')
          );
          closeAllRowMenus();
          refreshAfterAction(deleted);
        } catch (err) {
          alert((err && err.message) || 'تعذر حذف الطلب');
        }
        return;
      }

      if (editInstBtn) {
        window.editInstructor(editInstBtn.getAttribute('data-edit-instructor'));
        return;
      }

      if (toggleInstBtn) {
        try {
          window.InstructorApps.toggleInstructorSuspend(
            toggleInstBtn.getAttribute('data-toggle-instructor')
          );
          closeAllRowMenus();
          refreshAfterAction({ type: 'toggle-suspend' });
        } catch (err) {
          alert((err && err.message) || 'تعذر تحديث حالة المدرب');
        }
        return;
      }

      if (removeBtn) {
        if (!window.confirm('حذف هذا المدرب ونقله إلى الأرشيف؟')) return;
        try {
          window.InstructorApps.removeInstructor(removeBtn.getAttribute('data-remove-instructor'));
          closeAllRowMenus();
          refreshAfterAction({ type: 'remove-instructor' });
        } catch (err) {
          alert((err && err.message) || 'تعذر حذف المدرب');
        }
        return;
      }

      if (restoreBtn) {
        try {
          var restored = window.InstructorApps.restoreApplication(
            restoreBtn.getAttribute('data-restore-instructor')
          );
          closeAllRowMenus();
          refreshAfterAction(restored);
        } catch (err) {
          alert((err && err.message) || 'تعذر الاستعادة');
        }
        return;
      }

      if (purgeBtn) {
        if (!window.confirm('حذف نهائي؟ لا يمكن التراجع عن هذا الإجراء.')) return;
        try {
          var purged = window.InstructorApps.permanentDeleteApplication(
            purgeBtn.getAttribute('data-purge-instructor')
          );
          closeAllRowMenus();
          refreshAfterAction(purged);
        } catch (err) {
          alert((err && err.message) || 'تعذر الحذف النهائي');
        }
      }
    });

    var instructorEditorForm = document.getElementById('instructorEditorForm');
    if (instructorEditorForm) {
      instructorEditorForm.addEventListener('submit', function (e) {
        e.preventDefault();
        if (!window.InstructorApps) return;
        var id = (document.getElementById('instructorEditorId') || {}).value || '';
        try {
          window.InstructorApps.updateInstructor(id, {
            fullName: (document.getElementById('instructorEditorName') || {}).value,
            bio: (document.getElementById('instructorEditorBio') || {}).value,
            courses: (document.getElementById('instructorEditorCourses') || {}).value,
          });
          closeInstructorEditor();
          refreshAfterAction({ type: 'edit-instructor' });
        } catch (err) {
          alert((err && err.message) || 'تعذر حفظ المدرب');
        }
      });
    }

    document.addEventListener('change', function (e) {
      if (e.target && e.target.id === 'instructorSelectAll') {
        document.querySelectorAll('.instructor-row-check').forEach(function (cb) {
          cb.checked = e.target.checked;
        });
        updateBatchBar();
        return;
      }
      if (e.target && e.target.classList && e.target.classList.contains('instructor-row-check')) {
        updateBatchBar();
      }
    });

    var refreshBtn = document.getElementById('refreshInstructorRequests');
    if (refreshBtn) refreshBtn.addEventListener('click', renderInstructorPanel);

    var filterEl = document.getElementById('instructorRequestsFilter');
    if (filterEl) {
      filterEl.addEventListener('change', function () {
        instructorFilter = filterEl.value || 'all';
        renderInstructorPanel();
      });
    }

    var menuBtn = document.getElementById('instructorMenuBtn');
    if (menuBtn) {
      menuBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (selectionModeType) {
          executeSelectionAction();
          return;
        }
        if (toolsMenuOpen) closeToolsMenu();
        else openToolsMenu();
        syncSelectionUi();
      });
    }

    var cancelModeBtn = document.getElementById('instructorCancelMode');
    if (cancelModeBtn) {
      cancelModeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        exitSelectionMode();
      });
    }

    var menuDropdown = document.getElementById('instructorMenuDropdown');
    if (menuDropdown) {
      menuDropdown.addEventListener('click', function (e) {
        var item = e.target.closest ? e.target.closest('[data-menu-action]') : null;
        if (!item) return;
        e.stopPropagation();
        var action = item.getAttribute('data-menu-action');
        if (action === 'select-delete') enterSelectionMode();
        else if (action === 'view-archive') openArchiveView();
        else if (action === 'exit-archive') exitArchiveView();
      });
    }

    document.addEventListener('click', function (e) {
      if (!toolsMenuOpen) return;
      var tools = document.getElementById('instructorToolsMenu');
      if (tools && !tools.contains(e.target)) closeToolsMenu();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var instModal = document.getElementById('instructorEditorModal');
        if (instModal && !instModal.hidden) {
          closeInstructorEditor();
          return;
        }
        if (toolsMenuOpen) closeToolsMenu();
        else if (selectionModeType) exitSelectionMode();
      }
    });

    window.addEventListener('scroll', closeAllRowMenus, true);
    window.addEventListener('resize', closeAllRowMenus);

    window.addEventListener('storage', function (e) {
      if (
        e.key === 'ifa_instructor_applications' ||
        e.key === 'ifa_instructor_archive' ||
        e.key === 'ifa_approved_instructors' ||
        e.key === 'isInstructorApproved' ||
        e.key === 'approvedInstructorEmail'
      ) {
        renderInstructorPanel();
      }
    });

    if (window.InstructorApps && typeof window.InstructorApps.watchPendingApplications === 'function') {
      window.InstructorApps.watchPendingApplications(function () {
        renderInstructorPanel();
      });
    }
    if (window.InstructorApps && typeof window.InstructorApps.watchActiveInstructors === 'function') {
      window.InstructorApps.watchActiveInstructors(function () {
        renderInstructorPanel();
      });
    }

    renderInstructorPanel();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
