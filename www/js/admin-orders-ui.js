/**
 * Admin Orders UI — review manual checkout requests (Base64 receipts in Firestore).
 */
import { auth, db } from './firebase-config.js';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { notifyStudentOrderApproved, notifyStudentOrderStatus } from './mail-notifications.js';
import { syncEntitlementsFromApprovedOrders } from './entitlements-sync.js';

var ordersUnsubscribe = null;
var cachedOrders = [];
var pendingApproveOrderId = '';
var pendingRejectOrderId = '';

function updatePendingOrdersNavBadge() {
  var badge = document.getElementById('adminOrdersPendingBadge');
  if (!badge) return;
  var pending = cachedOrders.filter(function (o) {
    return String(o.status || 'pending') === 'pending';
  }).length;
  if (pending <= 0) {
    badge.hidden = true;
    badge.textContent = '';
    badge.removeAttribute('title');
    return;
  }
  badge.hidden = false;
  badge.textContent = pending > 99 ? '99+' : String(pending);
  badge.setAttribute('title', pending + ' طلب قيد المراجعة');
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatIqd(amount) {
  var n = Number(amount);
  if (!isFinite(n) || n <= 0) return '0 د.ع';
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' د.ع';
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatDate(value) {
  if (!value) return '—';
  try {
    var d = value.toDate ? value.toDate() : new Date(value);
    if (isNaN(d.getTime())) return '—';
    return (
      d.getFullYear() +
      '/' +
      pad2(d.getMonth() + 1) +
      '/' +
      pad2(d.getDate()) +
      ' ' +
      pad2(d.getHours()) +
      ':' +
      pad2(d.getMinutes())
    );
  } catch (err) {
    return '—';
  }
}

function paymentMethodLabel(method) {
  if (method === 'zaincash') return 'زين كاش';
  if (method === 'mastercard') return 'ماستر كارد / كي كارد';
  return String(method || '—');
}

function statusBadge(status) {
  var key = String(status || 'pending');
  var cls = 'admin-badge admin-badge--pending';
  var label = 'قيد المراجعة';
  if (key === 'approved') {
    cls = 'admin-badge admin-badge--active';
    label = 'مقبول';
  } else if (key === 'rejected') {
    cls = 'admin-badge admin-badge--suspended';
    label = 'مرفوض';
  }
  return '<span class="' + cls + '">' + label + '</span>';
}

function sortOrders(list) {
  return (list || []).slice().sort(function (a, b) {
    var ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : Date.parse(a.createdAt) || 0;
    var tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : Date.parse(b.createdAt) || 0;
    return tb - ta;
  });
}

function uniqueIds(list) {
  var seen = {};
  var out = [];
  (list || []).forEach(function (id) {
    var key = String(id || '').trim();
    if (!key || seen[key]) return;
    seen[key] = true;
    out.push(key);
  });
  return out;
}

async function fetchPublishedCourses() {
  if (window.PlatformCourses && typeof window.PlatformCourses.getPublished === 'function') {
    return window.PlatformCourses.getPublished();
  }
  try {
    var snap = await getDocs(collection(db, 'courses'));
    return snap.docs
      .map(function (d) {
        return Object.assign({ id: d.id }, d.data());
      })
      .filter(function (c) {
        return String(c.status || '').toLowerCase() === 'published';
      });
  } catch (err) {
    return [];
  }
}

function mergeSimulatorIds(existing, additions) {
  var seen = {};
  var out = [];
  (existing || []).concat(additions || []).forEach(function (id) {
    var key = String(id || '').trim();
    if (!key || seen[key]) return;
    seen[key] = true;
    out.push(key);
  });
  return out;
}

async function computeAllowedSimulators(_order, enrolledCourseIds) {
  var courses = await fetchPublishedCourses();
  var ids = [];
  (enrolledCourseIds || []).forEach(function (courseId) {
    var course = courses.find(function (c) {
      return String(c.id) === String(courseId);
    });
    if (course && Array.isArray(course.allowedSimulators)) {
      ids = mergeSimulatorIds(ids, course.allowedSimulators);
    }
  });
  return ids;
}

async function computeEnrolledCourseIds(order) {
  var ids = [];
  if (order.courseId) ids.push(String(order.courseId));
  if (order.planId) {
    var planSnap = await getDoc(doc(db, 'pricing', String(order.planId)));
    if (planSnap.exists()) {
      var plan = planSnap.data() || {};
      if (plan.sourceCourseId) ids.push(String(plan.sourceCourseId));
      if (Array.isArray(plan.includedCourseIds)) {
        plan.includedCourseIds.forEach(function (id) {
          ids.push(String(id));
        });
      }
      var courses = await fetchPublishedCourses();
      courses.forEach(function (course) {
        if (course && String(course.requiredPlanId || '') === String(order.planId)) {
          ids.push(String(course.id));
        }
      });
    }
  }
  return uniqueIds(ids);
}

function applyEntitlementsToActiveSession(userId, userEmail, entitlements) {
  if (
    !userId ||
    !auth.currentUser ||
    auth.currentUser.uid !== userId ||
    !window.IFAAuth ||
    typeof window.IFAAuth.applyEntitlements !== 'function'
  ) {
    return;
  }
  window.IFAAuth.applyEntitlements(
    {
      isSubscriber: !!(entitlements && entitlements.isSubscriber),
      planId: entitlements && entitlements.planId != null ? String(entitlements.planId) : '',
      enrolledCourseIds:
        entitlements && Array.isArray(entitlements.enrolledCourseIds) ? entitlements.enrolledCourseIds : [],
      allowedSimulators:
        entitlements && Array.isArray(entitlements.allowedSimulators) ? entitlements.allowedSimulators : [],
    },
    userEmail
  );
}

function dispatchSubscriptionChanged(order, entitlements) {
  var detail = {
    userId: order.userId,
    planId: entitlements.planId,
    enrolledCourseIds: entitlements.enrolledCourseIds,
    allowedSimulators: entitlements.allowedSimulators,
    isSubscriber: !!(entitlements && entitlements.isSubscriber),
  };
  try {
    window.dispatchEvent(new CustomEvent('ifa:subscription-changed', { detail: detail }));
    document.dispatchEvent(new CustomEvent('ifa:subscription-changed', { detail: detail }));
  } catch (err) {
    /* ignore */
  }
  applyEntitlementsToActiveSession(order.userId, order.userEmail, entitlements);
}

async function grantUserAccess(order) {
  var userRef = doc(db, 'users', order.userId);
  var userSnap = await getDoc(userRef);
  var existing = userSnap.exists() ? userSnap.data() || {} : {};
  var enrolled = Array.isArray(existing.enrolledCourseIds) ? existing.enrolledCourseIds.slice() : [];
  var newIds = await computeEnrolledCourseIds(order);
  newIds.forEach(function (id) {
    if (enrolled.indexOf(id) === -1) enrolled.push(id);
  });
  enrolled = uniqueIds(enrolled);

  var allowedSimulators = await computeAllowedSimulators(null, enrolled);

  var globalFromOrder = !!(order.planId && !order.courseId);
  var entitlements = {
    isSubscriber: globalFromOrder || existing.isSubscriber === true,
    planId: globalFromOrder
      ? String(order.planId || existing.planId || '')
      : String(existing.planId || order.planId || ''),
    enrolledCourseIds: enrolled,
    allowedSimulators: allowedSimulators,
  };

  var patch = Object.assign({}, entitlements, {
    lastOrderId: order.id,
    updatedAt: serverTimestamp(),
  });
  if (!userSnap.exists()) {
    patch.uid = order.userId;
    patch.email = order.userEmail || '';
    patch.name = order.userName || '';
    patch.role = 'user';
    patch.isAdmin = false;
    patch.createdAt = serverTimestamp();
  }
  await setDoc(userRef, patch, { merge: true });
  dispatchSubscriptionChanged(order, entitlements);
  return entitlements;
}

function showReceiptModal(src, title) {
  var modal = document.getElementById('adminOrderReceiptModal');
  if (!modal) return;
  var img = document.getElementById('adminOrderReceiptImage');
  var cap = document.getElementById('adminOrderReceiptCaption');
  if (img) img.src = src;
  if (cap) cap.textContent = title || '';
  modal.hidden = false;
  modal.setAttribute('aria-hidden', 'false');
}

function closeReceiptModal() {
  var modal = document.getElementById('adminOrderReceiptModal');
  if (!modal) return;
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');
  var img = document.getElementById('adminOrderReceiptImage');
  if (img) img.removeAttribute('src');
}

function renderOrdersTable() {
  var body = document.getElementById('adminOrdersBody');
  var meta = document.getElementById('adminOrdersMeta');
  if (!body) return;

  var filter = document.getElementById('adminOrdersStatusFilter');
  var statusFilter = filter ? filter.value : 'all';
  var list = sortOrders(cachedOrders).filter(function (order) {
    if (statusFilter === 'all') return true;
    return String(order.status || 'pending') === statusFilter;
  });

  if (meta) {
    var pending = cachedOrders.filter(function (o) {
      return o.status === 'pending';
    }).length;
    meta.textContent =
      'عرض ' + list.length + ' من ' + cachedOrders.length + ' طلب' + (pending ? ' · ' + pending + ' قيد المراجعة' : '');
  }

  if (!list.length) {
    body.innerHTML =
      '<tr><td colspan="8" class="admin-empty-cell">' +
      (cachedOrders.length ? 'لا توجد طلبات ضمن التصفية المحددة.' : 'لا توجد طلبات شراء بعد.') +
      '</td></tr>';
    return;
  }

  body.innerHTML = list
    .map(function (order) {
      var id = escapeHtml(order.id);
      var status = String(order.status || 'pending');
      var isPending = status === 'pending';
      var receiptSrc = order.receiptBase64 || order.receiptUrl || '';
      var thumb = receiptSrc
        ? '<button type="button" class="admin-order-thumb" data-view-receipt="' +
          id +
          '" title="عرض الوصل"><img src="' +
          escapeHtml(receiptSrc) +
          '" alt="وصل" /></button>'
        : '<span class="admin-order-thumb admin-order-thumb--empty">—</span>';

      var deleteBtn =
        '<button class="admin-btn admin-btn--danger admin-btn--sm" type="button" data-delete-order="' +
        id +
        '">حذف</button>';
      var actions = '';
      if (isPending) {
        actions =
          '<div class="admin-table__actions admin-table__actions--row">' +
          '<button class="admin-btn admin-btn--primary admin-btn--sm" type="button" data-approve-order="' +
          id +
          '">قبول</button>' +
          '<button class="admin-btn admin-btn--danger admin-btn--sm" type="button" data-reject-order="' +
          id +
          '">رفض</button>' +
          deleteBtn +
          '</div>';
      } else {
        actions =
          '<div class="admin-table__actions admin-table__actions--row">' +
          '<span class="admin-row-status-note">' +
          (order.adminNote || order.rejectNote
            ? escapeHtml(order.adminNote || order.rejectNote)
            : status === 'approved'
              ? 'تم التفعيل'
              : '—') +
          '</span>' +
          deleteBtn +
          '</div>';
      }

      return (
        '<tr data-order-id="' +
        id +
        '">' +
        '<td>' +
        thumb +
        '</td>' +
        '<td><div class="admin-order-user"><strong>' +
        escapeHtml(order.userName || '—') +
        '</strong><span dir="ltr">' +
        escapeHtml(order.userEmail || '') +
        '</span></div></td>' +
        '<td>' +
        escapeHtml(order.productTitle || '—') +
        '</td>' +
        '<td>' +
        formatIqd(order.amount) +
        '</td>' +
        '<td>' +
        escapeHtml(paymentMethodLabel(order.paymentMethod)) +
        '</td>' +
        '<td>' +
        escapeHtml(formatDate(order.createdAt)) +
        '</td>' +
        '<td>' +
        statusBadge(status) +
        '</td>' +
        '<td>' +
        actions +
        '</td>' +
        '</tr>'
      );
    })
    .join('');
}

function bindOrdersPanel() {
  var panel = document.getElementById('orders');
  if (!panel || panel.dataset.bound === '1') return;
  panel.dataset.bound = '1';

  var filter = document.getElementById('adminOrdersStatusFilter');
  if (filter) {
    filter.addEventListener('change', renderOrdersTable);
  }

  var body = document.getElementById('adminOrdersBody');
  if (body) {
    body.addEventListener('click', function (e) {
      var viewBtn = e.target.closest('[data-view-receipt]');
      if (viewBtn) {
        var orderId = viewBtn.getAttribute('data-view-receipt');
        var order = cachedOrders.find(function (o) {
          return o.id === orderId;
        });
        if (order) {
          showReceiptModal(order.receiptBase64 || order.receiptUrl || '', order.productTitle || '');
        }
        return;
      }

      var approveBtn = e.target.closest('[data-approve-order]');
      if (approveBtn) {
        handleApprove(approveBtn.getAttribute('data-approve-order'));
        return;
      }

      var rejectBtn = e.target.closest('[data-reject-order]');
      if (rejectBtn) {
        handleReject(rejectBtn.getAttribute('data-reject-order'));
        return;
      }

      var deleteBtn = e.target.closest('[data-delete-order]');
      if (deleteBtn) {
        deleteOrder(deleteBtn.getAttribute('data-delete-order'));
      }
    });
  }

  var receiptModal = document.getElementById('adminOrderReceiptModal');
  if (receiptModal && receiptModal.dataset.bound !== '1') {
    receiptModal.dataset.bound = '1';
    receiptModal.querySelectorAll('[data-close-receipt-modal]').forEach(function (el) {
      el.addEventListener('click', closeReceiptModal);
    });
  }

  var approveModal = document.getElementById('adminOrderApproveModal');
  if (approveModal && approveModal.dataset.bound !== '1') {
    approveModal.dataset.bound = '1';
    approveModal.querySelectorAll('[data-close-approve-modal]').forEach(function (el) {
      el.addEventListener('click', closeApproveModal);
    });
    var approveForm = document.getElementById('adminOrderApproveForm');
    if (approveForm) {
      approveForm.addEventListener('submit', function (ev) {
        ev.preventDefault();
        submitApprove();
      });
    }
  }

  var rejectModal = document.getElementById('adminOrderRejectModal');
  if (rejectModal && rejectModal.dataset.bound !== '1') {
    rejectModal.dataset.bound = '1';
    rejectModal.querySelectorAll('[data-close-reject-modal]').forEach(function (el) {
      el.addEventListener('click', closeRejectModal);
    });
    var rejectForm = document.getElementById('adminOrderRejectForm');
    if (rejectForm) {
      rejectForm.addEventListener('submit', function (ev) {
        ev.preventDefault();
        submitReject();
      });
    }
  }
}

function openApproveModal(orderId) {
  pendingApproveOrderId = orderId;
  var modal = document.getElementById('adminOrderApproveModal');
  var note = document.getElementById('adminOrderApproveNote');
  if (note) note.value = '';
  if (modal) {
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
  }
}

function closeApproveModal() {
  pendingApproveOrderId = '';
  var modal = document.getElementById('adminOrderApproveModal');
  if (modal) {
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
  }
}

function openRejectModal(orderId) {
  pendingRejectOrderId = orderId;
  var modal = document.getElementById('adminOrderRejectModal');
  var note = document.getElementById('adminOrderRejectNote');
  if (note) note.value = '';
  if (modal) {
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
  }
}

function closeRejectModal() {
  pendingRejectOrderId = '';
  var modal = document.getElementById('adminOrderRejectModal');
  if (modal) {
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
  }
}

function showToast(message) {
  var toast = document.getElementById('adminToast');
  if (!toast) {
    alert(message);
    return;
  }
  toast.textContent = message;
  toast.hidden = false;
  window.setTimeout(function () {
    toast.hidden = true;
  }, 3200);
}

function warnIfMailNotSent(result, context) {
  if (result && result.sent === true) return;
  console.warn(
    '[AdminOrders] Student notification email was not sent (' + (context || 'unknown') + ').',
    'Order status was updated, but email delivery failed.',
    'Configure EmailJS in Admin → إعدادات الدفع والإشعارات',
    'or install Firebase Trigger Email Extension.',
    {
      queued: result && result.queued,
      sent: result && result.sent,
      notificationId: result && result.notificationId,
      error: result && result.error,
    }
  );
}

function handleApprove(orderId) {
  var order = cachedOrders.find(function (o) {
    return o.id === orderId;
  });
  if (!order || order.status !== 'pending') return;
  openApproveModal(orderId);
}

function handleReject(orderId) {
  var order = cachedOrders.find(function (o) {
    return o.id === orderId;
  });
  if (!order || order.status !== 'pending') return;
  openRejectModal(orderId);
}

async function submitApprove() {
  var orderId = pendingApproveOrderId;
  if (!orderId) return;
  var order = cachedOrders.find(function (o) {
    return o.id === orderId;
  });
  if (!order) return;

  var noteEl = document.getElementById('adminOrderApproveNote');
  var note = noteEl ? String(noteEl.value || '').trim() : '';

  try {
    await grantUserAccess(order);
    await updateDoc(doc(db, 'orders', orderId), {
      status: 'approved',
      adminNote: note,
      rejectNote: '',
      reviewedAt: serverTimestamp(),
      reviewedBy: auth.currentUser ? auth.currentUser.uid : '',
    });
    var entitlements = await syncEntitlementsFromApprovedOrders(order.userId);
    dispatchSubscriptionChanged(order, entitlements);
    var approvedOrder = Object.assign({}, order, {
      id: orderId,
      amountLabel: formatIqd(order.amount),
    });
    var mailResult = await notifyStudentOrderApproved(approvedOrder, note);
    warnIfMailNotSent(mailResult, 'approve');
    closeApproveModal();
    showToast('تم قبول الطلب وتفعيل وصول الطالب.');
  } catch (err) {
    console.error('[AdminOrders] approve failed', err);
    alert((err && err.message) || 'تعذر قبول الطلب.');
  }
}

async function deleteOrder(orderId) {
  if (!orderId) return;
  var order = cachedOrders.find(function (o) {
    return o.id === orderId;
  });
  if (!order) return;
  if (!window.confirm('حذف هذا الطلب نهائياً من Firestore؟ لا يمكن التراجع.')) return;

  var userId = String(order.userId || '');
  var userEmail = order.userEmail || '';

  try {
    await deleteDoc(doc(db, 'orders', orderId));
    if (userId) {
      var entitlements = await syncEntitlementsFromApprovedOrders(userId);
      applyEntitlementsToActiveSession(userId, userEmail, entitlements);
    }
    showToast('تم حذف الطلب.');
    renderOrdersTable();
  } catch (err) {
    console.error('[AdminOrders] delete failed', err);
    alert((err && err.message) || 'تعذر حذف الطلب.');
  }
}

async function submitReject() {
  var orderId = pendingRejectOrderId;
  if (!orderId) return;
  var order = cachedOrders.find(function (o) {
    return o.id === orderId;
  });
  if (!order) return;

  var noteEl = document.getElementById('adminOrderRejectNote');
  var note = noteEl ? String(noteEl.value || '').trim() : '';

  try {
    await updateDoc(doc(db, 'orders', orderId), {
      status: 'rejected',
      adminNote: note,
      rejectNote: note,
      reviewedAt: serverTimestamp(),
      reviewedBy: auth.currentUser ? auth.currentUser.uid : '',
    });
    var mailResult = await notifyStudentOrderStatus(
      Object.assign({}, order, { amountLabel: formatIqd(order.amount) }),
      'rejected',
      note
    );
    warnIfMailNotSent(mailResult, 'reject');
    closeRejectModal();
    showToast('تم رفض الطلب.');
  } catch (err) {
    console.error('[AdminOrders] reject failed', err);
    alert((err && err.message) || 'تعذر رفض الطلب.');
  }
}

function subscribeOrders() {
  if (ordersUnsubscribe) return;
  ordersUnsubscribe = onSnapshot(
    collection(db, 'orders'),
    function (snap) {
      cachedOrders = snap.docs.map(function (d) {
        return Object.assign({ id: d.id }, d.data());
      });
      updatePendingOrdersNavBadge();
      renderOrdersTable();
    },
    function (err) {
      console.error('[AdminOrders] snapshot failed', err);
      var body = document.getElementById('adminOrdersBody');
      if (body) {
        body.innerHTML =
          '<tr><td colspan="8" class="admin-empty-cell">تعذر تحميل الطلبات. تحقق من صلاحيات Firestore.</td></tr>';
      }
    }
  );
}

function unsubscribeOrders() {
  if (ordersUnsubscribe) {
    ordersUnsubscribe();
    ordersUnsubscribe = null;
  }
}

function initAdminOrdersUi() {
  bindOrdersPanel();
  subscribeOrders();
}

window.renderAdminOrdersTable = function () {
  bindOrdersPanel();
  if (!ordersUnsubscribe) subscribeOrders();
  renderOrdersTable();
};

window.destroyAdminOrdersUi = unsubscribeOrders;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAdminOrdersUi);
} else {
  initAdminOrdersUi();
}
