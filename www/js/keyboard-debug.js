/**
 * FTTH Keyboard Spy — تشخيص ضغطات المفاتيح + Focus + Full Screen
 * ─────────────────────────────────────────────────────────────
 * يُحمَّل قبل باقي سكربتات المحاكي.
 * لتعطيله: احذف السكربت من simulator.html أو ضع:
 *   window.__FTTH_KEYBOARD_DEBUG__ = false;
 * قبل تحميل هذا الملف.
 */
(function () {
  'use strict';

  if (window.__FTTH_KEYBOARD_DEBUG__ === false) return;
  window.__FTTH_KEYBOARD_DEBUG__ = true;

  function describeEl(el) {
    if (!el) return '(null)';
    if (el === document) return '#document';
    if (el === window) return '#window';
    var parts = [el.tagName ? el.tagName.toLowerCase() : String(el)];
    if (el.id) parts.push('#' + el.id);
    if (el.className && typeof el.className === 'string') {
      var cls = el.className.trim().split(/\s+/).slice(0, 3).join('.');
      if (cls) parts.push('.' + cls);
    }
    return parts.join('');
  }

  function fsState() {
    var fs = document.fullscreenElement;
    if (!fs) return 'OFF (null)';
    return 'ON → ' + describeEl(fs);
  }

  function logKeyEvent(phase, e) {
    var key = e.key;
    var code = e.code;
    var ctrl = !!(e.ctrlKey || e.metaKey);
    var mods = [
      e.ctrlKey ? 'Ctrl' : '',
      e.metaKey ? 'Meta' : '',
      e.altKey ? 'Alt' : '',
      e.shiftKey ? 'Shift' : '',
    ].filter(Boolean).join('+') || 'none';

    console.groupCollapsed(
      '%c[KEY SPY] ' + phase + ' | key="' + key + '" code=' + code,
      'color:#00e5ff;font-weight:bold;'
    );
    console.log('key:', key);
    console.log('code:', code);
    console.log('ctrlKey (Ctrl OR Meta for undo):', ctrl, '| modifiers:', mods);
    console.log('fullscreenElement:', fsState());
    console.log('document.activeElement:', describeEl(document.activeElement));
    console.log('event.target:', describeEl(e.target));
    console.log('defaultPrevented:', e.defaultPrevented, '| cancelBubble:', e.cancelBubble);
    console.groupEnd();
  }

  function bindSpy(target, label) {
    target.addEventListener('keydown', function (e) {
      if (e.repeat) return;
      logKeyEvent(label + ' [capture]', e);
    }, true);
    target.addEventListener('keydown', function (e) {
      if (e.repeat) return;
      logKeyEvent(label + ' [bubble]', e);
    }, false);
  }

  bindSpy(window, 'window');
  bindSpy(document, 'document');

  document.addEventListener('DOMContentLoaded', function () {
    var container = document.getElementById('simulator-container');
    if (container) bindSpy(container, '#simulator-container');
    console.info(
      '%c[KEY SPY] Keyboard debug active — press any key (Esc, Ctrl+Z, Ctrl+Y) in normal + Full Screen mode.',
      'color:#39ff14;font-weight:bold;'
    );
  });

  document.addEventListener('fullscreenchange', function () {
    console.log(
      '%c[KEY SPY] fullscreenchange → ' + fsState() + ' | activeElement: ' + describeEl(document.activeElement),
      'color:#f59e0b;font-weight:bold;'
    );
  });

  document.addEventListener('focusin', function (e) {
    console.log(
      '%c[KEY SPY] focusin → ' + describeEl(e.target),
      'color:#94a3b8;'
    );
  });
})();
