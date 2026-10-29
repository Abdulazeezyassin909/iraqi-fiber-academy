/**
 * Fusion Splicer Lab — Cleaning Wipes (Kimwipes / alcohol).
 * Persistent workspace wipe entities — drag over stripped bare fiber to clean.
 */
(function (global) {
  'use strict';

  var HISTORY_MAX = 40;
  var DRAG_THRESHOLD_PX = 3;
  var WIPE_W = 44;
  var WIPE_H = 30;

  var layer = null;
  var wipes = [];
  var seq = 0;
  var selection = { kind: 'none', id: null };
  var selectedTool = null;
  var dragLib = null;
  var wipeGhostEl = null;
  var history = [];
  var historyIndex = -1;
  var historyLocked = false;
  /** Per pointer-drag session — suppress duplicate toasts while hovering one fiber. */
  var cleanedToastIds = null;

  function setStatus(msg) {
    if (global.FtthLab && FtthLab.setStatus) FtthLab.setStatus(msg);
  }

  function showToast(msg) {
    if (global.FtthLab && typeof FtthLab.showToast === 'function') {
      FtthLab.showToast(msg);
    }
  }

  function getZoom() {
    return (global.FtthLab && FtthLab.getZoom2d && FtthLab.getZoom2d()) || 1;
  }

  function clientToWorld(clientX, clientY) {
    if (global.FtthLab && typeof FtthLab.clientToWorld2d === 'function') {
      return FtthLab.clientToWorld2d(clientX, clientY);
    }
    return { x: 0, y: 0 };
  }

  function cloneJson(v) {
    return JSON.parse(JSON.stringify(v == null ? null : v));
  }

  function findWipe(id) {
    for (var i = 0; i < wipes.length; i++) {
      if (wipes[i].id === id) return wipes[i];
    }
    return null;
  }

  function captureSnapshot() {
    return { wipes: cloneJson(wipes), seq: seq };
  }

  function applySnapshot(snap) {
    if (!snap) return;
    historyLocked = true;
    wipes = cloneJson(snap.wipes) || [];
    seq = snap.seq || 0;
    selection = { kind: 'none', id: null };
    rebuildLayer();
    updateInspector();
    historyLocked = false;
  }

  function pushHistory() {
    if (historyLocked) return;
    history = history.slice(0, historyIndex + 1);
    history.push(captureSnapshot());
    if (history.length > HISTORY_MAX) history.shift();
    historyIndex = history.length - 1;
    if (historyIndex > 0 && global.FtthLab && typeof FtthLab.recordHistory === 'function') {
      FtthLab.recordHistory('cleaning-wipe');
    }
  }

  function undo() {
    if (historyIndex <= 0) return false;
    historyIndex -= 1;
    applySnapshot(history[historyIndex]);
    setStatus('Undo · Cleaning Wipe');
    return true;
  }

  function redo() {
    if (historyIndex >= history.length - 1) return false;
    historyIndex += 1;
    applySnapshot(history[historyIndex]);
    setStatus('Redo · Cleaning Wipe');
    return true;
  }

  function getWipeDragGhost() {
    if (!wipeGhostEl) {
      wipeGhostEl = document.createElement('div');
      wipeGhostEl.className = 'lab-cleaning-wipe-ghost';
      wipeGhostEl.setAttribute('aria-hidden', 'true');
      document.body.appendChild(wipeGhostEl);
    }
    return wipeGhostEl;
  }

  function findStrippedFiberAtClient(clientX, clientY) {
    if (global.FtthLab && typeof FtthLab.findCleanableStrippedFiberAtClient === 'function') {
      return FtthLab.findCleanableStrippedFiberAtClient(clientX, clientY);
    }
    return null;
  }

  function markFiberCleaned(pigtailId) {
    if (global.FtthLab && typeof FtthLab.markPigtailCleaned === 'function') {
      return FtthLab.markPigtailCleaned(pigtailId);
    }
    return false;
  }

  function getWipeClientCenter(node) {
    if (!node) return null;
    var r = node.getBoundingClientRect();
    return {
      x: r.left + r.width / 2,
      y: r.top + r.height / 2,
    };
  }

  function tryCleanAtWipeNode(node) {
    if (!node) return false;
    var center = getWipeClientCenter(node);
    if (!center) return false;
    var hit = findStrippedFiberAtClient(center.x, center.y);
    if (!hit || hit.isCleaned) return false;
    var ruinedCleave = !!(hit.isCleaved);
    if (!markFiberCleaned(hit.id)) return false;
    if (!cleanedToastIds) cleanedToastIds = {};
    if (!cleanedToastIds[hit.id]) {
      cleanedToastIds[hit.id] = true;
      if (ruinedCleave) {
        showToast('Fiber cleaned — cleave ruined, re-cleave required');
      } else {
        showToast('Fiber Cleaned ✨');
        setStatus('Fiber cleaned · ready for cleave / splice');
      }
    }
    return true;
  }

  function ensureLayer() {
    if (layer && layer.parentNode) return layer;
    var mount = document.getElementById('lab-2d-mount');
    if (!mount) return null;
    layer = document.createElement('div');
    layer.className = 'lab-cleaning-wipe-layer';
    layer.setAttribute('data-lab-cleaning-wipe-layer', '1');
    mount.appendChild(layer);
    return layer;
  }

  function wipeStyle(w) {
    return (
      'left:' + Math.round(w.x - WIPE_W / 2) + 'px;' +
      'top:' + Math.round(w.y - WIPE_H / 2) + 'px;' +
      'width:' + WIPE_W + 'px;' +
      'height:' + WIPE_H + 'px;'
    );
  }

  function wipeMarkup(w) {
    var sel = selection.id === w.id ? ' is-selected' : '';
    return (
      '<button type="button" class="lab-cleaning-wipe' + sel + '" data-wipe-id="' + w.id + '" ' +
      'style="' + wipeStyle(w) + '" title="مناديل تنظيف · drag over stripped fiber" ' +
      'aria-label="Cleaning wipe"></button>'
    );
  }

  function updateWipePosition(w, node) {
    if (!node) node = layer && layer.querySelector('[data-wipe-id="' + w.id + '"]');
    if (!node) return;
    node.style.left = Math.round(w.x - WIPE_W / 2) + 'px';
    node.style.top = Math.round(w.y - WIPE_H / 2) + 'px';
  }

  function rebuildLayer() {
    var host = ensureLayer();
    if (!host) return;
    var html = '';
    wipes.forEach(function (w) { html += wipeMarkup(w); });
    host.innerHTML = html;
    bindLayerEvents(host);
  }

  function placeWipe(x, y) {
    seq += 1;
    var item = {
      id: 'wipe-' + seq,
      x: typeof x === 'number' ? Math.round(x) : 0,
      y: typeof y === 'number' ? Math.round(y) : 0,
    };
    wipes.push(item);
    selection = { kind: 'wipe', id: item.id };
    if (global.FtthLab && typeof FtthLab.setSelectionOwner === 'function') {
      FtthLab.setSelectionOwner('cleaning-wipe');
    }
    rebuildLayer();
    pushHistory();
    updateInspector();
    setStatus('Cleaning wipe placed · drag over stripped bare fiber');
    return item;
  }

  function removeWipe(id) {
    wipes = wipes.filter(function (w) { return w.id !== id; });
    if (selection.id === id) selection = { kind: 'none', id: null };
    rebuildLayer();
    updateInspector();
    pushHistory();
    setStatus('Cleaning wipe removed');
  }

  function selectWipe(id, opts) {
    selection = { kind: 'wipe', id: id };
    if (global.FtthLab && typeof FtthLab.setSelectionOwner === 'function') {
      FtthLab.setSelectionOwner('cleaning-wipe');
    }
    updateInspector();
    if (!(opts && opts.skipRebuild)) rebuildLayer();
  }

  function startWipeDrag(e, w, node) {
    var zoom = getZoom() || 1;
    var sx = e.clientX;
    var sy = e.clientY;
    var ox = w.x;
    var oy = w.y;
    var moved = false;
    cleanedToastIds = {};
    node.classList.add('is-dragging');
    document.body.classList.add('lab-cleaning-wipe-dragging');
    try { node.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }

    function onMove(ev) {
      var dx = (ev.clientX - sx) / zoom;
      var dy = (ev.clientY - sy) / zoom;
      if (!moved && (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX)) {
        moved = true;
      }
      w.x = Math.round(ox + dx);
      w.y = Math.round(oy + dy);
      updateWipePosition(w, node);
      tryCleanAtWipeNode(node);
    }

    function onUp(ev) {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      try { node.releasePointerCapture(ev.pointerId); } catch (err2) { /* ignore */ }
      node.classList.remove('is-dragging');
      document.body.classList.remove('lab-cleaning-wipe-dragging');
      cleanedToastIds = null;
      if (selection.id === w.id) node.classList.add('is-selected');
      tryCleanAtWipeNode(node);
      if (moved) pushHistory();
      updateInspector();
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  function bindLayerEvents(host) {
    host.querySelectorAll('[data-wipe-id]').forEach(function (node) {
      node.addEventListener('click', function (e) {
        e.stopPropagation();
        var id = node.getAttribute('data-wipe-id');
        selectWipe(id, { skipRebuild: true });
        host.querySelectorAll('.lab-cleaning-wipe.is-selected').forEach(function (el) {
          if (el !== node) el.classList.remove('is-selected');
        });
        node.classList.add('is-selected');
      });

      node.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        var id = node.getAttribute('data-wipe-id');
        var w = findWipe(id);
        if (!w) return;
        selectWipe(id, { skipRebuild: true });
        host.querySelectorAll('.lab-cleaning-wipe.is-selected').forEach(function (el) {
          if (el !== node) el.classList.remove('is-selected');
        });
        node.classList.add('is-selected');
        startWipeDrag(e, w, node);
      });
    });
  }

  function updateInspector() {
    var card = document.getElementById('lab-inspector-card');
    var detail = document.getElementById('lab-inspector-detail');
    if (!card) return;
    if (selection.kind !== 'wipe' || !selection.id) return;

    var w = findWipe(selection.id);
    if (!w) {
      selection = { kind: 'none', id: null };
      return;
    }

    card.innerHTML =
      '<h2>Cleaning Wipes</h2>' +
      '<p>Lint-free wipe · drag over stripped bare glass to clean.</p>';

    if (!detail) return;
    detail.hidden = false;
    detail.innerHTML =
      '<div class="lab-cleaning-wipe-config">' +
      '<p class="lab-inspector__label">Position</p>' +
      '<p class="lab-pcord-attach">X ' + w.x + ' · Y ' + w.y + '</p>' +
      '<button type="button" class="lab-eject-btn" data-remove-wipe="' + w.id +
      '">Remove Wipe</button>' +
      '</div>';

    var rm = detail.querySelector('[data-remove-wipe]');
    if (rm) {
      rm.addEventListener('click', function () {
        removeWipe(w.id);
      });
    }
  }

  function renderToolbox() {
    var host = global.FtthLab && typeof FtthLab.gateToolboxRender === 'function'
      ? FtthLab.gateToolboxRender('lab-cleaning-wipe-tree', 'cleaning-wipe')
      : document.getElementById('lab-cleaning-wipe-tree');
    if (!host) return;
    host.innerHTML =
      '<div class="lab-toolbox" role="list">' +
      '<div class="tool-item lab-tool lab-tool--cleaning-wipe' +
      (selectedTool === 'cleaning-wipe' ? ' is-selected' : '') +
      '" data-tool="cleaning-wipe" data-lab-tool="cleaning-wipe" draggable="true" ' +
      'role="listitem" tabindex="0" title="مناديل تنظيف">' +
      '<span class="lab-tool__mark lab-tool__mark--cleaning-wipe" aria-hidden="true"></span>' +
      '<span class="lab-tool__copy">' +
      '<strong>مناديل تنظيف (Cleaning Wipes)</strong>' +
      '<span>Drag onto workspace</span>' +
      '</span>' +
      '</div>' +
      '</div>';
    bindToolbox(host);
    if (global.FtthLab && typeof FtthLab.applyFtthLabToolboxIcons === 'function') {
      FtthLab.applyFtthLabToolboxIcons();
    }
  }

  function bindToolbox(host) {
    var btn = host.querySelector('[data-tool="cleaning-wipe"]');
    if (!btn) return;

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
        FtthLab.claimToolboxTool('cleaning-wipe');
      }
      selectedTool = 'cleaning-wipe';
      renderToolbox();
      setStatus('Cleaning Wipes · drag onto workspace');
    });

    btn.addEventListener('dragstart', function (e) {
      if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
        FtthLab.claimToolboxTool('cleaning-wipe');
      }
      selectedTool = 'cleaning-wipe';
      dragLib = { kind: 'cleaning-wipe' };
      if (global.FtthLab && FtthLab.beginDrag) FtthLab.beginDrag({ kind: 'cleaning-wipe' });
      try {
        e.dataTransfer.setData('text/plain', 'lab:cleaning-wipe');
        e.dataTransfer.setData('text/lab-drag', 'cleaning-wipe');
        e.dataTransfer.effectAllowed = 'copy';
        if (e.dataTransfer.setDragImage) {
          e.dataTransfer.setDragImage(getWipeDragGhost(), 16, 11);
        }
      } catch (err) { /* ignore */ }
      btn.classList.add('is-dragging', 'is-selected');
    });

    btn.addEventListener('dragend', function () {
      dragLib = null;
      if (global.FtthLab && FtthLab.endDrag) FtthLab.endDrag();
      if (global.FtthLab && FtthLab.clearStageDropHighlight) FtthLab.clearStageDropHighlight();
      btn.classList.remove('is-dragging');
      renderToolbox();
    });
  }

  function isStagePlacementTarget(target) {
    if (!target) return false;
    return target.id === 'lab-canvas-2d' ||
      target.id === 'lab-2d-mount' ||
      target.id === 'lab-2d-world';
  }

  function bindStageDrop() {
    var stage = document.getElementById('lab-canvas-2d');
    var mount = document.getElementById('lab-2d-mount');
    var world = document.getElementById('lab-2d-world');
    [stage, mount, world].forEach(function (el) {
      if (!el || el.dataset.cleaningWipeDrop === '1') return;
      el.dataset.cleaningWipeDrop = '1';

      el.addEventListener('dragover', function (e) {
        var active = global.FtthLab && FtthLab.getActiveDrag && FtthLab.getActiveDrag();
        if (!((dragLib && dragLib.kind === 'cleaning-wipe') ||
            (active && active.kind === 'cleaning-wipe'))) {
          return;
        }
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      });

      el.addEventListener('drop', function (e) {
        var active = global.FtthLab && FtthLab.getActiveDrag && FtthLab.getActiveDrag();
        var kind =
          (e.dataTransfer && e.dataTransfer.getData('text/lab-drag')) ||
          (active && active.kind) ||
          (dragLib && dragLib.kind) ||
          '';
        if (kind !== 'cleaning-wipe') return;
        e.preventDefault();
        e.stopPropagation();
        dragLib = null;
        if (global.FtthLab && FtthLab.endDrag) FtthLab.endDrag();
        var pt = clientToWorld(e.clientX, e.clientY);
        var placed = placeWipe(Math.round(pt.x), Math.round(pt.y));
        selectedTool = null;
        renderToolbox();
        if (placed) {
          var node = layer && layer.querySelector('[data-wipe-id="' + placed.id + '"]');
          cleanedToastIds = {};
          tryCleanAtWipeNode(node);
          cleanedToastIds = null;
        }
      });

      el.addEventListener('click', function (e) {
        if (selectedTool !== 'cleaning-wipe') return;
        var active = global.FtthLab && FtthLab.getActiveToolboxTool && FtthLab.getActiveToolboxTool();
        if (active !== 'cleaning-wipe') return;
        if (!isStagePlacementTarget(e.target)) return;
        e.stopPropagation();
        var pt = clientToWorld(e.clientX, e.clientY);
        placeWipe(Math.round(pt.x), Math.round(pt.y));
        selectedTool = null;
        renderToolbox();
      }, true);
    });
  }

  function deleteSelected() {
    if (selection.kind === 'wipe' && selection.id) {
      removeWipe(selection.id);
      return true;
    }
    return false;
  }

  function clearSelection() {
    selection = { kind: 'none', id: null };
    selectedTool = null;
    renderToolbox();
    rebuildLayer();
  }

  function onToolboxClaim(payload) {
    var id = payload && payload.toolId;
    if (id === 'cleaning-wipe') return;
    selectedTool = null;
    renderToolbox();
  }

  function mount() {
    renderToolbox();
    bindStageDrop();
    ensureLayer();
    rebuildLayer();
    pushHistory();
  }

  var tool = {
    id: 'cleaning-wipe',
    mount: mount,
    onToolboxClaim: onToolboxClaim,
    category: 'FUSION SPLICING',
    undo: undo,
    redo: redo,
    deleteSelected: deleteSelected,
    clearSelection: clearSelection,
    exportProjectState: captureSnapshot,
    importProjectState: applySnapshot,
    resetProjectState: function () {
      applySnapshot({ wipes: [], seq: 0 });
    },
  };

  function tryRegister() {
    if (global.FtthLab && typeof FtthLab.registerTool === 'function') {
      FtthLab.registerTool('cleaning-wipe', tool);
      return true;
    }
    return false;
  }

  if (!tryRegister()) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', tryRegister);
    } else {
      setTimeout(tryRegister, 0);
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
