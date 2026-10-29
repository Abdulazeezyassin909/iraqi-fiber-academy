/**
 * FiberCleaver — golden-master 3D cleaver widget (standalone FiberCleaver.js.html).
 * Markup, hinge math, and clamp toggle match the reference file exactly.
 */
(function (global) {
  'use strict';

  var BASE_W = 480;
  var BASE_H = 340;

  function FiberCleaver() {}

  FiberCleaver.BASE_W = BASE_W;
  FiberCleaver.BASE_H = BASE_H;
  FiberCleaver.DEFAULT_DISPLAY_W = BASE_W;
  FiberCleaver.BODY_ASPECT = BASE_H / BASE_W;
  FiberCleaver.SPRITE_ASPECT = FiberCleaver.BODY_ASPECT;

  function assemblyMarkup() {
    return (
      '<div class="fiber-cleaver" data-cleaver-root="1" role="img" aria-label="Fiber cleaver">' +
      '<div class="slider-rail" aria-hidden="true"></div>' +
      '<div class="blade-cartridge" aria-hidden="true"></div>' +
      '<div class="fiber-anvil" aria-hidden="true">' +
      '<div class="fiber-anvil-pads left" aria-hidden="true"></div>' +
      '<div class="fiber-anvil-pads" aria-hidden="true"></div>' +
      '</div>' +
      '<div class="warning-sticker" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" width="36" height="36" fill="none" aria-hidden="true">' +
      '<path d="M12 2L1 21h22L12 2z" fill="#D32F2F"/>' +
      '<text x="12" y="17" text-anchor="middle" fill="white" font-size="10" font-weight="bold">!</text>' +
      '</svg>' +
      '<div class="warning-text">The blade is to<br>your side before<br>setting a fiber.</div>' +
      '</div>' +
      '<div class="cleaver-arm" data-cleaver-arm="1" aria-hidden="true">' +
      '<div class="arm-body">' +
      '<div class="arm-inner-detail"></div>' +
      '</div>' +
      '<div class="arm-silver-head">' +
      '<div class="arm-magnet"></div>' +
      '</div>' +
      '</div>' +
      '<div class="status-indicator" aria-hidden="true">' +
      '<div class="status-dot" data-cleaver-status-dot="1"></div>' +
      '<div class="status-label" data-cleaver-status-label="1">OPEN</div>' +
      '</div>' +
      '</div>'
    );
  }

  function getParts(root) {
    if (!root) return null;
    return {
      root: root,
      arm: root.querySelector('[data-cleaver-arm]') || root.querySelector('.cleaver-arm'),
      label: root.querySelector('[data-cleaver-status-label]') || root.querySelector('.status-label'),
    };
  }

  function applyState(root, state) {
    var parts = getParts(root);
    if (!parts || !parts.arm) return;
    var clamped = !!(state && state.clamped);
    parts.arm.classList.toggle('clamped', clamped);
    parts.root.classList.toggle('is-clamped', clamped);
    if (parts.label) parts.label.textContent = clamped ? 'CLAMPED' : 'OPEN';
  }

  function getState(root) {
    var parts = getParts(root);
    if (!parts || !parts.arm) return { clamped: false };
    return { clamped: parts.arm.classList.contains('clamped') };
  }

  function toggleClamp(root) {
    var parts = getParts(root);
    if (!parts || !parts.arm) return false;
    var clamped = !parts.arm.classList.contains('clamped');
    applyState(root, { clamped: clamped });
    return clamped;
  }

  function bind(root) {
    var parts = getParts(root);
    if (!parts || !parts.root) return;
    parts.root.addEventListener('click', function () {
      toggleClamp(parts.root);
    });
  }

  function render(container) {
    if (!container) return null;
    container.innerHTML = assemblyMarkup();
    return container.querySelector('[data-cleaver-root]') || container.querySelector('.fiber-cleaver');
  }

  function normalizeState(state) {
    return {
      clamped: !!(state && state.clamped),
    };
  }

  function noop() {}

  global.FiberCleaver = FiberCleaver;
  FiberCleaver.init = noop;
  FiberCleaver.normalizeState = normalizeState;
  FiberCleaver.render = render;
  FiberCleaver.assemblyMarkup = assemblyMarkup;
  FiberCleaver.applyState = applyState;
  FiberCleaver.getState = getState;
  FiberCleaver.toggleClamp = toggleClamp;
  FiberCleaver.bind = bind;
  FiberCleaver.playCutVideo = noop;
})(typeof window !== 'undefined' ? window : this);
