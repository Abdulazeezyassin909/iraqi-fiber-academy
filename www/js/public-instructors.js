import { db } from './firebase-config.js';
import { collection, getDocs, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

var instructorRows = {};
var CACHE_KEY = 'ifa_public_instructors_v1';
var lastSignature = '';

function ensureInstructorModal() {
  var overlay = document.getElementById('instructorProfileModal');
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'instructorProfileModal';
  overlay.className = 'instructor-modal-overlay';
  overlay.innerHTML =
    '<div class="instructor-modal-content" role="dialog" aria-modal="true" aria-labelledby="instructorModalName">' +
    '<button type="button" class="instructor-modal-close" aria-label="إغلاق">×</button>' +
    '<img class="instructor-modal-img" alt="" />' +
    '<h3 class="instructor-modal-name" id="instructorModalName"></h3>' +
    '<p class="instructor-modal-title"></p>' +
    '<p class="instructor-modal-bio"></p>' +
    '</div>';
  document.body.appendChild(overlay);
  overlay.addEventListener('click', function (event) {
    if (event.target === overlay || (event.target.closest && event.target.closest('.instructor-modal-close'))) {
      overlay.classList.remove('is-active');
    }
  });
  return overlay;
}

function openInstructorModal(row) {
  if (!row) return;
  var overlay = ensureInstructorModal();
  var img = overlay.querySelector('.instructor-modal-img');
  var name = overlay.querySelector('.instructor-modal-name');
  var title = overlay.querySelector('.instructor-modal-title');
  var bio = overlay.querySelector('.instructor-modal-bio');
  if (img) {
    if (row.photoUrl) {
      img.src = row.photoUrl;
      img.hidden = false;
    } else {
      img.removeAttribute('src');
      img.hidden = true;
    }
    img.alt = row.name || '';
  }
  if (name) name.textContent = row.name || '';
  if (title) title.textContent = row.title || '';
  if (bio) bio.textContent = row.bio || '';
  overlay.classList.add('is-active');
}

function render(rows) {
  var grid = document.getElementById('publicInstructorsGrid');
  if (!grid) return;
  instructorRows = {};
  if (!rows.length) {
    grid.innerHTML = '<p class="section__subtitle">سيظهر المدربون هنا بعد إضافتهم من لوحة الإدارة.</p>';
    return;
  }
  grid.innerHTML = rows.map(function (row) {
    instructorRows[row.id] = row;
    var photo = row.photoUrl
      ? '<img src="' + esc(row.photoUrl) + '" alt="' + esc(row.name || '') + '">'
      : '<span class="instructor-image-wrapper__empty" aria-hidden="true"></span>';
    return '<div class="instructor-horizontal-card" role="button" tabindex="0" data-instructor-id="' + esc(row.id) + '">' +
      '<div class="instructor-image-wrapper">' + photo + '</div>' +
      '<div class="instructor-info">' +
      '<h3>' + esc(row.name || '') + '</h3>' +
      '<p class="instructor-title">' + esc(row.title || '') + '</p>' +
      '<p class="instructor-bio">' + esc(row.bio || '') + '</p>' +
      '</div></div>';
  }).join('');
  Array.prototype.forEach.call(grid.querySelectorAll('.instructor-horizontal-card'), function (card) {
    function open() {
      openInstructorModal(instructorRows[card.getAttribute('data-instructor-id')]);
    }
    card.addEventListener('click', open);
    card.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open();
      }
    });
  });
}

function instructorSignature(rows) {
  return JSON.stringify((rows || []).map(function (row) {
    return [
      row.id,
      row.name,
      row.title,
      row.bio,
      row.photoUrl,
      row.displayOrder,
      row.status,
    ];
  }));
}

function sortInstructors(rows) {
  return rows.filter(function (row) {
    return !row.status || row.status === 'approved';
  }).sort(function (a, b) {
    var ao = Number(a.displayOrder);
    var bo = Number(b.displayOrder);
    var aOk = isFinite(ao);
    var bOk = isFinite(bo);
    if (aOk && bOk && ao !== bo) return ao - bo;
    if (aOk && !bOk) return -1;
    if (!aOk && bOk) return 1;
    return String(a.name || '').localeCompare(String(b.name || ''), 'ar');
  });
}

function rowsFromSnapshot(snap) {
  var rows = [];
  snap.forEach(function (docSnap) {
    rows.push(Object.assign({ id: docSnap.id }, docSnap.data() || {}));
  });
  return sortInstructors(rows);
}

function readInstructorCache() {
  try {
    var raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    var parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    return null;
  }
}

function applyInstructorRows(rows) {
  var next = rows || [];
  var signature = instructorSignature(next);
  if (signature === lastSignature) return;
  lastSignature = signature;
  render(next);
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(next));
  } catch (err) {}
}

function refreshInstructors() {
  return getDocs(collection(db, 'instructors')).then(function (snap) {
    applyInstructorRows(rowsFromSnapshot(snap));
  }).catch(function (err) {
    console.warn('[public-instructors] refresh failed', err);
  });
}

var grid = document.getElementById('publicInstructorsGrid');
if (grid) {
  var cached = readInstructorCache();
  if (cached && cached.length) {
    lastSignature = instructorSignature(cached);
    render(cached);
  }
  onSnapshot(collection(db, 'instructors'), function (snap) {
    applyInstructorRows(rowsFromSnapshot(snap));
  }, function () {
    if (!lastSignature) render([]);
  });
  document.addEventListener('ifa:app-resumed', refreshInstructors);
}
