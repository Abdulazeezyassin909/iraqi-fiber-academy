/**
 * FTTH Fiber Design Matrix — Stage 4 compatibility shim.
 * Floating window lives in FiberDesignUI; this keeps existing call sites working.
 */
(function (global) {
  'use strict';

  function ui() {
    return global.FTTHFiberDesignUI || null;
  }

  function init(api) {
    var u = ui();
    if (u && u.init) {
      u.init(Object.assign({}, api || {}, {
        getOverlayHost: (api && api.getOverlayHost) || function () {
          return document.getElementById('sim-workspace-overlays') ||
            document.getElementById('simulator-container');
        },
      }));
    }
  }

  function open(options) {
    var u = ui();
    if (u && u.openMatrix) return u.openMatrix(options);
    if (u && u.open) return u.open(options);
  }

  function close() {
    var u = ui();
    if (u && u.closeMatrix) return u.closeMatrix();
    if (u && u.close) return u.close();
  }

  function refresh() {
    var u = ui();
    if (u && u.refreshMatrix) return u.refreshMatrix();
    if (u && u.refresh) return u.refresh();
  }

  function exportPdf() {
    var u = ui();
    if (u && u.exportMatrixPdf) return u.exportMatrixPdf();
  }

  function isOpen() {
    var u = ui();
    if (u && u.isMatrixOpen) return u.isMatrixOpen();
    return false;
  }

  global.FTTHFiberDesignMatrixModal = {
    init: init,
    open: open,
    close: close,
    isOpen: isOpen,
    refresh: refresh,
    exportPdf: exportPdf,
  };
})(typeof window !== 'undefined' ? window : globalThis);
