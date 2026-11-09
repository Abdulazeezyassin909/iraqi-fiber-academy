/**
 * Desktop website in every browser. App chrome only inside the native shell.
 * Browsers keep the desktop viewport. The native shell is marked only by
 * IFAFlutterApp, Capacitor, or androidBridge — not by a generic WebView.
 */
(function () {
  'use strict';

  var ua = '';
  var search = '';
  try { ua = String(navigator.userAgent || ''); } catch (err) { ua = ''; }
  try { search = String(location.search || ''); } catch (err) { search = ''; }

  var native = /IFAFlutterApp/i.test(ua) ||
    /Capacitor/i.test(ua) ||
    /(?:\?|&)app=1(?:&|$)/.test(search);

  try {
    if (window.androidBridge) native = true;
  } catch (err) { /* ignore */ }

  var savedDesktop = false;
  try { savedDesktop = localStorage.getItem('ifa_desktop_site') === '1'; } catch (err) { savedDesktop = false; }
  var phoneUa = /Mobile|Android|iPhone|iPad|iPod/i.test(ua);
  var narrowScreen = false;
  try {
    narrowScreen = Math.min(window.screen.width || 1920, window.screen.height || 1920) <= 1024;
  } catch (errScreen) { narrowScreen = false; }
  var phoneLike = phoneUa || narrowScreen;

  if (native) document.documentElement.classList.add('is-native-app');
  if (!savedDesktop && phoneLike) return;

  var meta = document.querySelector('meta[name="viewport"]');
  if (!meta) return;
  if (phoneLike) {
    document.documentElement.classList.add('is-phone-desktop');
    var dw = 390;
    try {
      dw = Math.min(window.screen.width || 390, window.innerWidth || 390) || 390;
    } catch (errSize) { dw = 390; }
    var scale = Math.max(0.25, Math.round((dw / 1280) * 1000) / 1000);
    meta.setAttribute(
      'content',
      'width=1280, initial-scale=' + scale + ', minimum-scale=' + scale + ', maximum-scale=5, user-scalable=yes'
    );
    return;
  }
  meta.setAttribute('content', 'width=1280');
})();
