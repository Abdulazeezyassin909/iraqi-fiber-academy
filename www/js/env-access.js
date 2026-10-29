/**
 * Shared environment detection for local-dev bypass vs production enforcement.
 * Classic script — safe to load before modules; exposes window.IFA_ENV.
 */
(function (global) {
  'use strict';

  var PRODUCTION_HOSTS = [
    'iraqi-fiber-academy.web.app',
    'iraqi-fiber-academy.firebaseapp.com',
  ];

  function hostname() {
    try {
      return String((global.location && global.location.hostname) || '').toLowerCase();
    } catch (err) {
      return '';
    }
  }

  function protocol() {
    try {
      return String((global.location && global.location.protocol) || '').toLowerCase();
    } catch (err) {
      return '';
    }
  }

  /** file:// or localhost / 127.0.0.1 / ::1 */
  function isLocalDevEnvironment() {
    var proto = protocol();
    if (proto === 'file:') return true;
    var host = hostname();
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  }

  /** Live Firebase Hosting production domains only */
  function isProductionEnvironment() {
    var host = hostname();
    for (var i = 0; i < PRODUCTION_HOSTS.length; i++) {
      if (host === PRODUCTION_HOSTS[i]) return true;
    }
    return false;
  }

  /**
   * Bypass subscription / login / role walls in local development.
   * Production domain always enforces strict checks.
   */
  function shouldBypassAccessControl() {
    return isLocalDevEnvironment();
  }

  function shouldEnforceAccessControl() {
    return !shouldBypassAccessControl();
  }

  var api = {
    PRODUCTION_HOSTS: PRODUCTION_HOSTS.slice(),
    isLocalDevEnvironment: isLocalDevEnvironment,
    isProductionEnvironment: isProductionEnvironment,
    shouldBypassAccessControl: shouldBypassAccessControl,
    shouldEnforceAccessControl: shouldEnforceAccessControl,
  };

  global.IFA_ENV = api;
})(typeof window !== 'undefined' ? window : globalThis);
