/**
 * Moderated lesson Q&A stored in Firestore collection `lesson_comments`.
 */
import { auth, db } from './firebase-config.js';
import {
  addDoc,
  collection,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  deleteDoc,
  doc,
  where,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

var COLLECTION = 'lesson_comments';

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function mapDoc(snap) {
  var data = snap.data() || {};
  return {
    id: snap.id,
    lesson_id: String(data.lesson_id || ''),
    user_uid: String(data.user_uid || ''),
    user_name: String(data.user_name || ''),
    text: String(data.text || ''),
    status: String(data.status || 'pending'),
    parent_comment_id: String(data.parent_comment_id || ''),
    lesson_title: String(data.lesson_title || ''),
    course_title: String(data.course_title || ''),
    instructor_reply: String(data.instructor_reply || ''),
    createdAt: data.createdAt || null,
  };
}

export async function submitComment(input) {
  var user = auth.currentUser;
  if (!user || !user.uid) throw new Error('يجب تسجيل الدخول لنشر تعليق');
  var text = String((input && input.text) || '').trim();
  var lessonId = String((input && input.lessonId) || '').trim();
  if (!lessonId) throw new Error('الدرس غير محدد');
  if (!text) throw new Error('نص التعليق مطلوب');
  var name =
    String(user.displayName || '').trim() ||
    String(user.email || '').trim() ||
    'طالب';
  var ref = await addDoc(collection(db, COLLECTION), {
    lesson_id: lessonId,
    user_uid: user.uid,
    user_name: name,
    text: text.slice(0, 2000),
    status: 'pending',
    parent_comment_id: String((input && input.parentCommentId) || ''),
    lesson_title: String((input && input.lessonTitle) || ''),
    course_title: String((input && input.courseTitle) || ''),
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export function watchApproved(lessonId, onChange) {
  var q = query(collection(db, COLLECTION), where('status', '==', 'approved'));
  return onSnapshot(q, function (snap) {
    var list = snap.docs
      .map(mapDoc)
      .filter(function (item) {
        return item.lesson_id === String(lessonId || '');
      });
    onChange(list);
  });
}

export function watchPending(onChange) {
  var q = query(collection(db, COLLECTION), where('status', '==', 'pending'));
  return onSnapshot(q, function (snap) {
    onChange(snap.docs.map(mapDoc));
  });
}

export async function setCommentStatus(id, status) {
  if (status !== 'approved' && status !== 'rejected' && status !== 'pending') {
    throw new Error('حالة غير صالحة');
  }
  await updateDoc(doc(db, COLLECTION, String(id)), { status: status });
}

export async function saveCommentReply(id, reply) {
  await updateDoc(doc(db, COLLECTION, String(id)), {
    instructor_reply: String(reply || '').trim(),
  });
}

export async function deleteComment(id) {
  await deleteDoc(doc(db, COLLECTION, String(id)));
}

function timeAgo(value) {
  var date = value && value.toDate ? value.toDate() : value ? new Date(value) : null;
  if (!date || isNaN(date.getTime())) return '';
  var diff = Date.now() - date.getTime();
  var minute = 60 * 1000;
  var hour = 60 * minute;
  var day = 24 * hour;
  if (diff < hour) return 'منذ ' + Math.max(1, Math.round(diff / minute)) + ' دقيقة';
  if (diff < day) return 'منذ ' + Math.max(1, Math.round(diff / hour)) + ' ساعة';
  return 'منذ ' + Math.max(1, Math.round(diff / day)) + ' يوم';
}

function commentHtml(item) {
  return (
    '<article class="lesson-qa__item">' +
    '<strong>' +
    escapeHtml(item.user_name || 'طالب') +
    '</strong>' +
    '<p>' +
    escapeHtml(item.text) +
    '</p>' +
    (item.instructor_reply
      ? '<p class="lesson-qa__reply"><strong>رد المدرب:</strong> ' + escapeHtml(item.instructor_reply) + '</p>'
      : '') +
    '</article>'
  );
}

export function mountLesson(host, lesson) {
  if (!host || !lesson || !lesson.id) return;
  host.innerHTML =
    '<section class="lesson-qa">' +
    '<h2>الأسئلة والنقاشات</h2>' +
    '<form class="lesson-qa__form">' +
    '<textarea rows="3" maxlength="2000" placeholder="اكتب سؤالك أو تعليقك" required></textarea>' +
    '<button type="submit">نشر</button>' +
    '<p class="lesson-qa__status" role="status"></p>' +
    '</form>' +
    '<div class="lesson-qa__list"></div>' +
    '</section>';
  var list = host.querySelector('.lesson-qa__list');
  var status = host.querySelector('.lesson-qa__status');
  watchApproved(lesson.id, function (items) {
    list.innerHTML = items.length
      ? items.map(commentHtml).join('')
      : '<p class="lesson-qa__empty">لا توجد تعليقات منشورة بعد.</p>';
  });
  host.querySelector('form').addEventListener('submit', async function (event) {
    event.preventDefault();
    var field = host.querySelector('textarea');
    try {
      await submitComment({
        lessonId: lesson.id,
        lessonTitle: lesson.title || '',
        courseTitle: lesson.courseTitle || '',
        text: field.value,
      });
      field.value = '';
      status.textContent = 'تم إرسال تعليقك للمراجعة وسيظهر بعد موافقة المدرب';
    } catch (err) {
      status.textContent = (err && err.message) || 'تعذّر إرسال التعليق';
    }
  });
}

export function mountModeration(host) {
  if (!host) return;
  host.innerHTML = '<p class="admin-empty-cell">جاري تحميل التعليقات...</p>';
  watchPending(function (items) {
    if (!items.length) {
      host.innerHTML = '<p class="admin-empty-cell">لا توجد تعليقات قيد المراجعة.</p>';
      return;
    }
    host.innerHTML =
      '<table class="admin-table"><thead><tr><th>الدرس</th><th>الطالب</th><th>التعليق</th><th></th></tr></thead><tbody>' +
      items
        .map(function (item) {
          var lesson = item.lesson_title || item.lesson_id;
          if (item.course_title) lesson = item.course_title + ' — ' + lesson;
          return (
            '<tr><td>' +
            escapeHtml(lesson) +
            '</td><td>' +
            escapeHtml(item.user_name) +
            '</td><td>' +
            escapeHtml(item.text) +
            '</td><td class="admin-table__actions">' +
            '<button class="admin-btn admin-btn--primary" type="button" data-comment-approve="' +
            escapeHtml(item.id) +
            '">موافقة</button>' +
            '<button class="admin-btn admin-btn--danger" type="button" data-comment-reject="' +
            escapeHtml(item.id) +
            '">رفض</button></td></tr>'
          );
        })
        .join('') +
      '</tbody></table>';
  });
  if (host.dataset.bound === '1') return;
  host.dataset.bound = '1';
  host.addEventListener('click', async function (event) {
    var approve = event.target.closest('[data-comment-approve]');
    var reject = event.target.closest('[data-comment-reject]');
    var id = approve
      ? approve.getAttribute('data-comment-approve')
      : reject
        ? reject.getAttribute('data-comment-reject')
        : '';
    if (!id) return;
    try {
      await setCommentStatus(id, approve ? 'approved' : 'rejected');
    } catch (err) {
      window.alert((err && err.message) || 'تعذّر تحديث التعليق');
    }
  });
}

window.LessonComments = {
  mountLesson: mountLesson,
  mountModeration: mountModeration,
  mountInstructor: mountInstructor,
  submitComment: submitComment,
  setCommentStatus: setCommentStatus,
};

function relativeEmpty(label) {
  return (
    '<div class="inst-comment-empty">' +
    '<div class="inst-comment-empty__icon" aria-hidden="true">💬</div>' +
    '<h3>لا توجد تعليقات</h3>' +
    '<p>' +
    escapeHtml(label) +
    '</p></div>'
  );
}

function instructorCard(item) {
  var pending = item.status === 'pending';
  var initial = (item.user_name || 'ط').trim().charAt(0);
  var actions = pending
    ? '<button type="button" class="admin-btn admin-btn--primary admin-btn--sm" data-comment-approve="' +
      escapeHtml(item.id) +
      '">موافقة</button>'
    : '<button type="button" class="admin-btn admin-btn--ghost admin-btn--sm" data-comment-unpublish="' +
      escapeHtml(item.id) +
      '">إلغاء النشر</button>';
  return (
    '<article class="inst-comment-card">' +
    '<div class="inst-comment-card__top">' +
    '<span class="inst-comment-card__avatar">' +
    escapeHtml(initial) +
    '</span>' +
    '<div>' +
    '<strong>' +
    escapeHtml(item.user_name || 'طالب') +
    '</strong>' +
    '<div class="inst-comment-card__meta">' +
    '<span class="inst-comment-card__badge">' +
    escapeHtml(item.course_title || 'كورس') +
    '</span>' +
    '<span class="inst-comment-card__badge">' +
    escapeHtml(item.lesson_title || 'درس') +
    '</span>' +
    '<time>' +
    escapeHtml(timeAgo(item.createdAt)) +
    '</time>' +
    '</div></div>' +
    '<span class="inst-comment-card__status' +
    (pending ? ' is-pending' : ' is-live') +
    '">' +
    (pending ? 'معلق' : 'منشور') +
    '</span></div>' +
    '<p class="inst-comment-card__text">' +
    escapeHtml(item.text) +
    '</p>' +
    (item.instructor_reply
      ? '<p class="inst-comment-card__reply">ردك: ' + escapeHtml(item.instructor_reply) + '</p>'
      : '') +
    '<div class="inst-comment-card__actions">' +
    actions +
    '<button type="button" class="admin-btn admin-btn--danger admin-btn--sm" data-comment-delete="' +
    escapeHtml(item.id) +
    '">حذف</button>' +
    '<button type="button" class="admin-btn admin-btn--ghost admin-btn--sm" data-comment-reply="' +
    escapeHtml(item.id) +
    '">رد</button>' +
    '</div>' +
    '<form class="inst-comment-card__reply-form" data-reply-for="' +
    escapeHtml(item.id) +
    '" hidden>' +
    '<textarea rows="2" maxlength="2000" placeholder="اكتب الرد الرسمي"></textarea>' +
    '<button type="submit" class="admin-btn admin-btn--primary admin-btn--sm">نشر الرد</button>' +
    '</form></article>'
  );
}

var instructorItems = [];
var instructorFilter = 'pending';
var instructorScope = { lessonIds: [], courseTitles: [] };

function instructorVisible(items) {
  return items.filter(function (item) {
    if (item.status === 'rejected') return false;
    var lessonOk =
      !instructorScope.lessonIds.length || instructorScope.lessonIds.indexOf(item.lesson_id) !== -1;
    var courseOk =
      !instructorScope.courseTitles.length ||
      instructorScope.courseTitles.indexOf(item.course_title) !== -1;
    if (instructorScope.lessonIds.length || instructorScope.courseTitles.length) {
      if (!lessonOk && !courseOk) return false;
    }
    if (instructorFilter === 'pending') return item.status === 'pending';
    if (instructorFilter === 'approved') return item.status === 'approved';
    return item.status === 'pending' || item.status === 'approved';
  });
}

function paintInstructor(host) {
  var list = instructorVisible(instructorItems);
  var empty =
    instructorFilter === 'pending'
      ? 'لا توجد تعليقات بانتظار الموافقة.'
      : instructorFilter === 'approved'
        ? 'لا توجد تعليقات منشورة حالياً.'
        : 'لا توجد تعليقات على كورساتك بعد.';
  var tabs =
    '<div class="inst-comment-tabs" role="tablist">' +
    '<button type="button" data-comment-tab="pending"' +
    (instructorFilter === 'pending' ? ' class="is-active"' : '') +
    '>قيد المراجعة</button>' +
    '<button type="button" data-comment-tab="approved"' +
    (instructorFilter === 'approved' ? ' class="is-active"' : '') +
    '>المنشورة</button>' +
    '<button type="button" data-comment-tab="all"' +
    (instructorFilter === 'all' ? ' class="is-active"' : '') +
    '>الكل</button></div>';
  host.innerHTML = tabs + (list.length ? list.map(instructorCard).join('') : relativeEmpty(empty));
}

export function mountInstructor(host, scope) {
  if (!host) return;
  instructorScope = scope || instructorScope;
  if (host.dataset.instructorBound === '1') {
    paintInstructor(host);
    return;
  }
  host.dataset.instructorBound = '1';
  host.innerHTML = relativeEmpty('جاري تحميل التعليقات...');
  onSnapshot(collection(db, COLLECTION), function (snap) {
    instructorItems = snap.docs.map(mapDoc);
    paintInstructor(host);
  });
  host.addEventListener('click', async function (event) {
    var tab = event.target.closest('[data-comment-tab]');
    if (tab) {
      instructorFilter = tab.getAttribute('data-comment-tab') || 'pending';
      paintInstructor(host);
      return;
    }
    var replyBtn = event.target.closest('[data-comment-reply]');
    if (replyBtn) {
      var form = host.querySelector('[data-reply-for="' + replyBtn.getAttribute('data-comment-reply') + '"]');
      if (form) form.hidden = !form.hidden;
      return;
    }
    var approve = event.target.closest('[data-comment-approve]');
    var unpublish = event.target.closest('[data-comment-unpublish]');
    var remove = event.target.closest('[data-comment-delete]');
    try {
      if (approve) await setCommentStatus(approve.getAttribute('data-comment-approve'), 'approved');
      if (unpublish) await setCommentStatus(unpublish.getAttribute('data-comment-unpublish'), 'pending');
      if (remove) await deleteComment(remove.getAttribute('data-comment-delete'));
    } catch (err) {
      window.alert((err && err.message) || 'تعذّر تحديث التعليق');
    }
  });
  host.addEventListener('submit', async function (event) {
    var form = event.target.closest('[data-reply-for]');
    if (!form) return;
    event.preventDefault();
    try {
      await saveCommentReply(form.getAttribute('data-reply-for'), form.querySelector('textarea').value);
      form.hidden = true;
    } catch (err) {
      window.alert((err && err.message) || 'تعذّر حفظ الرد');
    }
  });
}

function updatePendingCommentsNavBadge(count) {
  var badge = document.getElementById('adminCommentsPendingBadge');
  if (!badge) return;
  if (!count) {
    badge.hidden = true;
    badge.textContent = '';
    return;
  }
  badge.hidden = false;
  badge.textContent = count > 99 ? '99+' : String(count);
}

function bootModeration() {
  var host = document.getElementById('lessonCommentsModeration');
  if (host) mountModeration(host);
  if (document.getElementById('adminCommentsPendingBadge')) {
    watchPending(function (items) {
      updatePendingCommentsNavBadge((items || []).length);
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootModeration);
} else {
  bootModeration();
}
