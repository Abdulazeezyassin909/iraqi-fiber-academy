/**
 * Admin dashboard — dynamic profile chip from IFAAuth.
 */
import './auth-manager.js';

function escapeAttr(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

function resolveDisplayName(profile, user) {
  if (profile && profile.name) return String(profile.name).trim();
  if (user && user.displayName) return String(user.displayName).trim();
  var email = (profile && profile.email) || (user && user.email) || '';
  if (email) return email.split('@')[0];
  return '';
}

function resolveEmail(profile, user) {
  return String((profile && profile.email) || (user && user.email) || '').trim();
}

function updateAdminProfileChip(detail) {
  detail = detail || {};
  if (!detail.profileSynced) return;

  var nameEl = document.querySelector('.admin-user-chip__name');
  var avatarEl = document.querySelector('.admin-user-chip__avatar');
  var roleEl = document.querySelector('.admin-user-chip__role');
  if (!nameEl && !avatarEl && !roleEl) return;

  var profile = detail.profile || null;
  var user = detail.user || null;
  var displayName = resolveDisplayName(profile, user);
  var email = resolveEmail(profile, user);
  var label = displayName || email || 'مسؤول';

  if (nameEl) nameEl.textContent = label;
  if (roleEl) roleEl.textContent = 'مسؤول النظام';

  if (!avatarEl) return;

  var photoUrl = (user && user.photoURL) || (profile && profile.photoURL) || '';
  if (photoUrl) {
    avatarEl.innerHTML =
      '<img src="' + escapeAttr(photoUrl) + '" alt="" referrerpolicy="no-referrer" />';
    return;
  }

  var initial = (label.charAt(0) || 'م').toUpperCase();
  avatarEl.textContent = initial;
}

if (window.IFAAuth && typeof window.IFAAuth.onAuthChange === 'function') {
  window.IFAAuth.onAuthChange(updateAdminProfileChip);
}
