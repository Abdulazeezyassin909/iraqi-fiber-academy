/**
 * Admin Panel route guard — Firestore RBAC via IFAAuth.
 * Redirects to /index.html unless the user is logged in with role === 'admin'.
 */
import './auth-manager.js';
import { setupNotificationToggle } from './fcm-push.js';

var redirecting = false;
var OWNER_ACCOUNT_EMAIL = 'abdulazizyassin909@gmail.com';

function normalizeOwnerEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isOwnerAccountSession(Auth, detail) {
  var owner = normalizeOwnerEmail(OWNER_ACCOUNT_EMAIL);
  var candidates = [];

  if (Auth && Auth.getCurrentUser && Auth.getCurrentUser()) {
    candidates.push(Auth.getCurrentUser().email);
  }
  if (detail && detail.email) {
    candidates.push(detail.email);
  }
  if (Auth && Auth.getLocalAuthUser && Auth.getLocalAuthUser()) {
    candidates.push(Auth.getLocalAuthUser().email);
  }
  if (Auth && Auth.getAuthState) {
    var state = Auth.getAuthState();
    if (state && state.profile && state.profile.email) {
      candidates.push(state.profile.email);
    }
    if (state && state.user && state.user.email) {
      candidates.push(state.user.email);
    }
  }
  try {
    var raw = localStorage.getItem('ifa_auth_user');
    if (raw) {
      var parsed = JSON.parse(raw);
      if (parsed && parsed.email) candidates.push(parsed.email);
    }
  } catch (err) {
    /* ignore */
  }

  for (var i = 0; i < candidates.length; i++) {
    if (normalizeOwnerEmail(candidates[i]) === owner) {
      return true;
    }
  }
  return false;
}

function redirectHome(Auth, detail) {
  if (isOwnerAccountSession(Auth || window.IFAAuth, detail || {})) {
    return;
  }
  if (redirecting) return;
  redirecting = true;
  window.location.replace('/index.html');
}

function wireAdminPushToggle() {
  setupNotificationToggle('adminPushNotificationsToggle');
}

function enforceAdminAccess(detail) {
  detail = detail || {};
  var Auth = window.IFAAuth;
  if (!Auth || !Auth.isAuthInitialized()) {
    return;
  }
  if (detail.profileSynced === false) {
    return;
  }
  if (isOwnerAccountSession(Auth, detail)) {
    wireAdminPushToggle();
    return;
  }
  if (!Auth.isLoggedIn()) {
    redirectHome(Auth, detail);
    return;
  }
  var profile = detail.profile != null ? detail.profile : Auth.getAuthState().profile;
  if (!Auth.isAdminUser(profile)) {
    redirectHome(Auth, detail);
    return;
  }

  wireAdminPushToggle();
}

window.IFAAuth.onAuthChange(enforceAdminAccess);
