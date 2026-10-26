import { db } from './firebase-config.js';
import { collection, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function render(rows) {
  var grid = document.getElementById('publicInstructorsGrid');
  if (!grid) return;
  if (!rows.length) {
    grid.innerHTML = '<p class="section__subtitle">سيظهر المدربون هنا بعد إضافتهم من لوحة الإدارة.</p>';
    return;
  }
  grid.innerHTML = rows.map(function (row) {
    var photo = row.photoUrl
      ? '<img src="' + esc(row.photoUrl) + '" alt="' + esc(row.name || '') + '">'
      : '<span class="instructor-image-wrapper__empty" aria-hidden="true"></span>';
    return '<div class="instructor-horizontal-card">' +
      '<div class="instructor-image-wrapper">' + photo + '</div>' +
      '<div class="instructor-info">' +
      '<h3>' + esc(row.name || '') + '</h3>' +
      '<p class="instructor-title">' + esc(row.title || '') + '</p>' +
      '<p class="instructor-bio">' + esc(row.bio || '') + '</p>' +
      '</div></div>';
  }).join('');
}

var grid = document.getElementById('publicInstructorsGrid');
if (grid) {
  onSnapshot(collection(db, 'instructors'), function (snap) {
    var rows = [];
    snap.forEach(function (docSnap) {
      rows.push(Object.assign({ id: docSnap.id }, docSnap.data() || {}));
    });
    rows = rows.filter(function (row) {
      return !row.status || row.status === 'approved';
    });
    rows.sort(function (a, b) {
      return String(a.name || '').localeCompare(String(b.name || ''), 'ar');
    });
    render(rows);
  }, function () {
    render([]);
  });
}
