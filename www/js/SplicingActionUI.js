/**
 * FTTH Splicing Action — Stage 4 (animation only).
 * The -o- toolbar button triggers a 5s pulse/glow on all Closure markers.
 * No manual splice UI. Design intelligence lives in AutoFiberEngine.
 */
(function (global) {
  'use strict';

  var deps = null;
  var pulseTimer = null;
  var stylesInjected = false;
  var PULSE_MS = 5000;

  function init(api) {
    deps = api || {};
    ensureStyles();
  }

  function showMessage(msg, warn) {
    if (deps && deps.showStatus) {
      deps.showStatus(msg, !!warn);
    }
  }

  function getClosureNodes() {
    if (deps && typeof deps.getClosureNodes === 'function') {
      return deps.getClosureNodes() || [];
    }
    var mgr = global.FTTHFiberDesignManager;
    if (mgr && mgr.getClosureRegistry) {
      return (mgr.getClosureRegistry() || []).map(function (c) {
        return { id: c.node_id };
      });
    }
    return [];
  }

  function clearPulse() {
    document.querySelectorAll('.placed-node.is-splice-pulse').forEach(function (el) {
      el.classList.remove('is-splice-pulse');
    });
    if (pulseTimer) {
      clearTimeout(pulseTimer);
      pulseTimer = null;
    }
  }

  /**
   * Visual-only “Splicing Executed” pulse on all closure markers.
   * @returns {boolean}
   */
  function triggerSpliceAnimation() {
    ensureStyles();
    clearPulse();

    var closures = getClosureNodes();
    var pulsed = 0;
    closures.forEach(function (node) {
      var id = node && (node.id || node.node_id);
      if (!id) return;
      var el = document.querySelector('.placed-node[data-id="' + id + '"]');
      if (!el) return;
      el.classList.add('is-splice-pulse');
      pulsed++;
    });

    if (!pulsed) {
      showMessage('No Closure markers on the map to pulse.', true);
      return false;
    }

    pulseTimer = setTimeout(function () {
      clearPulse();
      showMessage('Splicing animation complete.');
    }, PULSE_MS);

    showMessage('Splicing executed — pulsing ' + pulsed + ' closure(s).');
    return true;
  }

  /** @deprecated Stage 4 — open() is animation-only; nodeId ignored */
  function open() {
    return triggerSpliceAnimation();
  }

  function close() {
    clearPulse();
  }

  function ensureStyles() {
    if (stylesInjected) return;
    var style = document.getElementById('splice-ui-pulse-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'splice-ui-pulse-style';
      document.head.appendChild(style);
    }
    stylesInjected = true;
    style.textContent = [
      '@keyframes ftth-splice-glow-pulse{',
      '0%,100%{box-shadow:0 0 0 0 rgba(250,204,21,0.0),0 0 0 0 rgba(56,189,248,0);',
      'filter:brightness(1);}',
      '40%{box-shadow:0 0 0 4px rgba(250,204,21,0.55),0 0 22px 6px rgba(56,189,248,0.45);',
      'filter:brightness(1.35);}',
      '70%{box-shadow:0 0 0 2px rgba(250,204,21,0.35),0 0 14px 4px rgba(34,211,238,0.35);',
      'filter:brightness(1.15);}',
      '}',
      '.placed-node.is-splice-pulse{',
      'animation:ftth-splice-glow-pulse 0.7s ease-in-out infinite;',
      'z-index:40 !important;outline:2px solid rgba(250,204,21,0.85);',
      'outline-offset:2px;border-radius:4px;}',
      '.placed-node.is-splice-pulse .placed-node__icon-wrap,',
      '.placed-node.is-splice-pulse svg{',
      'filter:drop-shadow(0 0 6px rgba(250,204,21,0.85));}',
    ].join('');
  }

  global.FTTHSplicingActionUI = {
    init: init,
    open: open,
    close: close,
    triggerSpliceAnimation: triggerSpliceAnimation,
    isOpen: function () { return !!pulseTimer; },
    refresh: function () {},
  };
})(typeof window !== 'undefined' ? window : globalThis);
