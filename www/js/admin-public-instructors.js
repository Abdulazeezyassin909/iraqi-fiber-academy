import { db } from './firebase-config.js';
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

var rows = [];

function formEls() {
  return {
    form: document.getElementById('publicInstructorForm'),
    id: document.getElementById('publicInstructorId'),
    name: document.getElementById('publicInstructorName'),
    title: document.getElementById('publicInstructorTitle'),
    bio: document.getElementById('publicInstructorBio'),
    photo: document.getElementById('instructorPhotoInput'),
    preview: document.getElementById('instructorPhotoPreview'),
    save: document.getElementById('publicInstructorSave'),
    cancel: document.getElementById('publicInstructorCancel'),
    body: document.getElementById('publicInstructorsBody'),
    pending: document.getElementById('pendingInstructorsBody'),
  };
}

function resetForm() {
  var el = formEls();
  if (!el.form) return;
  el.form.reset();
  el.id.value = '';
  el.form.dataset.existingPhoto = '';
  if (el.preview) el.preview.innerHTML = '';
  el.save.textContent = 'إضافة مدرب';
  el.cancel.hidden = true;
}

function readAsDataURL(file) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function () { resolve(String(reader.result || '')); };
    reader.onerror = function () { reject(reader.error || new Error('تعذر قراءة الصورة')); };
    reader.readAsDataURL(file);
  });
}

function showPreview(src) {
  var el = formEls();
  if (!el.preview) return;
  el.preview.innerHTML = src
    ? '<img src="' + esc(src) + '" alt="" style="width:72px;height:72px;object-fit:cover;border-radius:50%">'
    : '';
}

function instructorRow(row, actions) {
  var photo = row.photoUrl
    ? '<img src="' + esc(row.photoUrl) + '" alt="" width="40" height="40" style="width:40px;height:40px;object-fit:cover;border-radius:50%">'
    : '—';
  return '<tr><td>' + photo + '</td><td>' + esc(row.name) + '</td><td>' + esc(row.title) + '</td><td>' + esc(row.bio) + '</td><td>' + actions + '</td></tr>';
}

function render() {
  var el = formEls();
  var active = rows.filter(function (row) { return !row.status || row.status === 'approved'; });
  var pending = rows.filter(function (row) { return row.status === 'pending'; });
  if (el.body) {
    el.body.innerHTML = active.length
      ? active.map(function (row) {
          return instructorRow(
            row,
            '<button type="button" class="admin-btn admin-btn--ghost admin-btn--sm" data-edit-public-instructor="' + esc(row.id) + '">تعديل</button> ' +
            '<button type="button" class="admin-btn admin-btn--danger admin-btn--sm" data-delete-public-instructor="' + esc(row.id) + '">حذف</button>'
          );
        }).join('')
      : '<tr><td colspan="5">لا يوجد مدربون حاليون</td></tr>';
  }
  if (el.pending) {
    el.pending.innerHTML = pending.length
      ? pending.map(function (row) {
          return instructorRow(
            row,
            '<button type="button" class="admin-btn admin-btn--primary admin-btn--sm" data-approve-public-instructor="' + esc(row.id) + '">موافقة</button> ' +
            '<button type="button" class="admin-btn admin-btn--danger admin-btn--sm" data-delete-public-instructor="' + esc(row.id) + '">رفض</button>'
          );
        }).join('')
      : '<tr><td colspan="5">لا توجد طلبات بانتظار الموافقة</td></tr>';
  }
}

function bind() {
  var el = formEls();
  if (!el.form || el.form.dataset.bound === '1') return;
  el.form.dataset.bound = '1';

  onSnapshot(collection(db, 'instructors'), function (snap) {
    rows = [];
    snap.forEach(function (docSnap) {
      rows.push(Object.assign({ id: docSnap.id }, docSnap.data() || {}));
    });
    rows.sort(function (a, b) {
      return String(a.name || '').localeCompare(String(b.name || ''), 'ar');
    });
    render();
  }, function (err) {
    console.error('[PublicInstructorsAdmin]', err);
    if (el.body) el.body.innerHTML = '<tr><td colspan="5">تعذر تحميل المدربين</td></tr>';
  });

  if (el.photo) {
    el.photo.addEventListener('change', function () {
      var file = el.photo.files && el.photo.files[0];
      if (!file) {
        showPreview(el.form.dataset.existingPhoto || '');
        return;
      }
      readAsDataURL(file).then(showPreview).catch(function () {
        showPreview(el.form.dataset.existingPhoto || '');
      });
    });
  }

  el.form.addEventListener('submit', function (event) {
    event.preventDefault();
    var submitBtn = el.save;
    var editing = !!el.id.value;
    submitBtn.textContent = 'جاري الحفظ...';
    submitBtn.disabled = true;

    (async function () {
      try {
        var photoUrl = el.form.dataset.existingPhoto || '';
        var file = el.photo && el.photo.files && el.photo.files.length ? el.photo.files[0] : null;
        if (file) {
          photoUrl = await readAsDataURL(file);
        }
        var payload = {
          name: el.name.value.trim(),
          title: el.title.value.trim(),
          bio: el.bio.value.trim(),
          photoUrl: photoUrl,
          updatedAt: serverTimestamp(),
        };
        var id = el.id.value;
        if (id) await updateDoc(doc(db, 'instructors', id), payload);
        else await addDoc(collection(db, 'instructors'), Object.assign({ createdAt: serverTimestamp() }, payload));

        submitBtn.textContent = 'تم النشر بنجاح!';
        alert('تم النشر بنجاح');
        setTimeout(function () {
          resetForm();
          submitBtn.disabled = false;
        }, 1500);
      } catch (error) {
        console.error('Error saving instructor:', error);
        alert('حدث خطأ أثناء الحفظ: ' + (error && error.message ? error.message : ''));
        submitBtn.textContent = editing ? 'حفظ التعديل' : 'إضافة مدرب';
        submitBtn.disabled = false;
      }
    })();
  });

  el.cancel.addEventListener('click', resetForm);

  function onTableClick(event) {
    var editBtn = event.target.closest('[data-edit-public-instructor]');
    var deleteBtn = event.target.closest('[data-delete-public-instructor]');
    var approveBtn = event.target.closest('[data-approve-public-instructor]');
    if (approveBtn) {
      var approveId = approveBtn.getAttribute('data-approve-public-instructor');
      updateDoc(doc(db, 'instructors', approveId), { status: 'approved' }).catch(function (err) {
        console.error(err);
        alert('تعذر قبول الطلب.');
      });
      return;
    }
    if (editBtn) {
      var found = rows.find(function (row) { return row.id === editBtn.getAttribute('data-edit-public-instructor'); });
      if (!found) return;
      el.id.value = found.id;
      el.name.value = found.name || '';
      el.title.value = found.title || '';
      el.bio.value = found.bio || '';
      el.photo.value = '';
      el.form.dataset.existingPhoto = found.photoUrl || '';
      showPreview(found.photoUrl || '');
      el.save.textContent = 'حفظ التعديل';
      el.cancel.hidden = false;
      return;
    }
    if (deleteBtn) {
      var deleteId = deleteBtn.getAttribute('data-delete-public-instructor');
      if (!confirm('حذف هذا المدرب من قسم مدربونا؟')) return;
      deleteDoc(doc(db, 'instructors', deleteId)).catch(function (err) {
        console.error(err);
        alert('تعذر حذف المدرب.');
      });
    }
  }
  if (el.body) el.body.addEventListener('click', onTableClick);
  if (el.pending) el.pending.addEventListener('click', onTableClick);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
else bind();
