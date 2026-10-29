/**
 * FTTH Smart State Manager — toolbox hover cursor, persistent tool selection, cursor sync.
 */
(function (global) {
  'use strict';

  var bridge = null;
  var toolboxHoverActive = false;
  var uiStyleInjected = false;

  function b() { return bridge; }
  function sim() { return b()?.getSim?.(); }

  function isPenToolArmed() {
    return !!b()?.isPenToolSelected?.();
  }

  function isPlacementArmed() {
    return !!b()?.isPlacementToolActive?.();
  }

  function isAnyToolArmed() {
    return isPlacementArmed() || isPenToolArmed();
  }

  function updateCursorStyle() {
    global.FTTHDrawingEngine?.syncMapInteractionCursor?.();
  }

  function syncCursor() {
    updateCursorStyle();
  }

  /** Toolbox / ESC: drop active tool and enter hand mode. */
  function deselectTool(statusMsg) {
    if (b()?.deselectAllToolboxTools) {
      b().deselectAllToolboxTools();
      return true;
    }
    if (statusMsg) b()?.updateStatus?.(statusMsg);
    return false;
  }

  /** Toolbox click: arm tool; selection persists until manual deselect (ESC / toolbox dbl-click). */
  function onToolSelected(opts) {
    opts = opts || {};
    if (sim()?.ui) sim().ui.toolboxLockMode = !!opts.lockMode;
    if (sim()?.interactionMode === 'hand') {
      b()?.setInteractionMode?.('select');
    }
    b()?.syncDrawingLayerInteraction?.();
    updateCursorStyle();
  }

  /** Map placement complete — keep tool active; only sync cursor. */
  function onPlacementComplete() {
    if (sim()?.interactionMode === 'hand' && isAnyToolArmed()) {
      b()?.setInteractionMode?.('select');
    }
    b()?.syncPenModeClass?.();
    b()?.syncDrawingLayerInteraction?.();
    updateCursorStyle();
  }

  /** Canvas dbl-click path/cable finish — keep tool active. */
  function finishPath() {
    if (sim()?.interactionMode === 'hand' && isAnyToolArmed()) {
      b()?.setInteractionMode?.('select');
    }
    b()?.syncPenModeClass?.();
    b()?.syncDrawingLayerInteraction?.();
    updateCursorStyle();
  }

  function handleEscapeKey() {
    if (isAnyToolArmed()) {
      deselectTool('Hand mode — pan map or pick elements');
      return true;
    }
    if (sim()?.interactionMode !== 'hand') {
      b()?.setInteractionMode?.('hand');
      b()?.updateStatus?.('Hand mode — pan map or pick elements');
      updateCursorStyle();
      return true;
    }
    return false;
  }

  function isToolboxHoverActive() {
    return toolboxHoverActive;
  }

  function injectToolboxStyles() {
    if (uiStyleInjected) return;
    uiStyleInjected = true;
    var style = document.createElement('style');
    style.id = 'ftth-ui-controller-styles';
    style.textContent = [
      '#toolbox.ftth-toolbox-interaction-zone { cursor: pointer; }',
      '#canvas-wrapper.ftth-toolbox-hover { cursor: default !important; }',
      '#canvas-wrapper.ftth-cursor-hand { cursor: grab !important; }',
      '#canvas-wrapper.ftth-cursor-hand.is-panning,',
      '#canvas-wrapper.ftth-cursor-hand.is-temporary-pan,',
      '#canvas-wrapper.is-temporary-pan { cursor: grabbing !important; }',
      '#canvas-wrapper.ftth-cursor-crosshair { cursor: crosshair !important; }',
      '#canvas-wrapper.ftth-cursor-active-tool { cursor: default !important; }',
      '#canvas-wrapper.ftth-cursor-pointer { cursor: default !important; }',
    ].join('\n');
    document.head.appendChild(style);
  }

  function bindToolboxHoverCursor() {
    var toolbox = document.getElementById('toolbox');
    if (!toolbox || toolbox.dataset.ftthUiHoverBound === '1') return;
    toolbox.dataset.ftthUiHoverBound = '1';
    toolbox.classList.add('ftth-toolbox-interaction-zone');
    injectToolboxStyles();

    toolbox.addEventListener('mouseenter', function () {
      toolboxHoverActive = true;
      var wrap = document.getElementById('canvas-wrapper');
      if (wrap) wrap.classList.add('ftth-toolbox-hover');
      updateCursorStyle();
    });
    toolbox.addEventListener('mouseleave', function () {
      toolboxHoverActive = false;
      var wrap = document.getElementById('canvas-wrapper');
      if (wrap) wrap.classList.remove('ftth-toolbox-hover');
      updateCursorStyle();
    });
  }

  function rebindToolboxHover() {
    global.FTTHToolboxManager?.bindRedHeader?.();
    bindToolboxHoverCursor();
  }

  function init(deps) {
    bridge = deps;
    global.FTTHToolboxManager?.bindRedHeader?.();
    bindToolboxHoverCursor();
  }

  global.FTTHUiController = {
    init: init,
    onToolSelected: onToolSelected,
    onPlacementComplete: onPlacementComplete,
    finishPath: finishPath,
    deselectTool: deselectTool,
    handleEscapeKey: handleEscapeKey,
    isToolboxHoverActive: isToolboxHoverActive,
    rebindToolboxHover: rebindToolboxHover,
    updateCursorStyle: updateCursorStyle,
    syncCursor: syncCursor,
    enterHandMode: function (msg) { deselectTool(msg); },
  };
})(typeof window !== 'undefined' ? window : globalThis);
