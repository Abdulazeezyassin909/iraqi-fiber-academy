/**
 * Project Setup modal — training city selection when entering the workspace.
 */
(function (global) {
  'use strict';

  var isOpen = false;
  var pendingOnStart = null;

  function getModal() {
    return document.getElementById('project-setup-modal');
  }

  function open(opts) {
    var modal = getModal();
    if (!modal) return;
    pendingOnStart = (opts && typeof opts.onStart === 'function') ? opts.onStart : null;
    isOpen = true;
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    modal.classList.add('project-setup-modal--open');
    var startBtn = document.getElementById('project-setup-start');
    if (startBtn) startBtn.focus();
  }

  function close() {
    var modal = getModal();
    if (!modal) return;
    isOpen = false;
    pendingOnStart = null;
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    modal.classList.remove('project-setup-modal--open');
  }

  function bind() {
    var startBtn = document.getElementById('project-setup-start');
    if (startBtn) {
      startBtn.addEventListener('click', function (e) {
        e.preventDefault();
        var onStart = pendingOnStart;
        pendingOnStart = null;
        close();
        if (onStart) onStart();
      });
    }

    var modal = getModal();
    if (modal) {
      modal.addEventListener('click', function (e) {
        if (e.target.classList.contains('project-setup-modal__backdrop')) {
          /* Require explicit Start — do not dismiss on backdrop click */
        }
      });
    }

    document.addEventListener('keydown', function (e) {
      if (!isOpen || e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
    }, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }

  global.FTTHProjectSetupModal = {
    open: open,
    close: close,
    isOpen: function () { return isOpen; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
