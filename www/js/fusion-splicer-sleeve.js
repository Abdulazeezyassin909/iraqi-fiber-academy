/**
 * Fusion Splicer Lab — 60mm splice protection sleeve.
 * Standard canvas node: spawn via toolbox drag/drop, select, hold-to-move, release to drop.
 */
(function (global) {
  'use strict';

  var HISTORY_MAX = 40;
  var DRAG_THRESHOLD_PX = 3;
  var SLEEVE_MOUNT_PROX_PX = 25;

  var layer = null;
  var sleeves = [];
  var seq = 0;
  var selection = { kind: 'none', id: null };
  var selectedTool = null;
  var dragLib = null;
  var history = [];
  var historyIndex = -1;
  var historyLocked = false;

  function setStatus(msg) {
    if (global.FtthLab && FtthLab.setStatus) FtthLab.setStatus(msg);
  }

  function getSleeveSizePx() {
    if (global.FtthLab && typeof FtthLab.getSleeveSizePx === 'function') {
      return FtthLab.getSleeveSizePx();
    }
    return { w: 56, h: 8 };
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

  function findSleeve(id) {
    for (var i = 0; i < sleeves.length; i++) {
      if (sleeves[i].id === id) return sleeves[i];
    }
    return null;
  }

  function captureSnapshot() {
    return { sleeves: cloneJson(sleeves), seq: seq };
  }

  function applySnapshot(snap) {
    if (!snap) return;
    historyLocked = true;
    sleeves = cloneJson(snap.sleeves) || [];
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
      FtthLab.recordHistory('splice-sleeve');
    }
  }

  function undo() {
    if (historyIndex <= 0) return false;
    historyIndex -= 1;
    applySnapshot(history[historyIndex]);
    setStatus('Undo · Sleeve');
    return true;
  }

  function redo() {
    if (historyIndex >= history.length - 1) return false;
    historyIndex += 1;
    applySnapshot(history[historyIndex]);
    setStatus('Redo · Sleeve');
    return true;
  }

  function applyToPigtail(id, opts) {
    if (!id) return false;
    if (global.FtthLab && typeof FtthLab.mountSleeveOnPigtail === 'function') {
      return !!FtthLab.mountSleeveOnPigtail(id, opts || {});
    }
    if (global.FtthLab && typeof FtthLab.applySleeveToPigtail === 'function') {
      return !!FtthLab.applySleeveToPigtail(id, opts || {});
    }
    return false;
  }

  function findBareTipProximity(clientX, clientY) {
    if (global.FtthLab && typeof FtthLab.findBareTipProximity === 'function') {
      return FtthLab.findBareTipProximity(clientX, clientY, SLEEVE_MOUNT_PROX_PX);
    }
    return null;
  }

  function consumeFreeSleeve(id) {
    sleeves = sleeves.filter(function (s) { return s.id !== id; });
    if (selection.id === id) selection = { kind: 'none', id: null };
    rebuildLayer();
  }

  function placeFreeSleeve(x, y, opts) {
    opts = opts || {};
    seq += 1;
    var item = {
      id: 'slv-' + seq,
      x: typeof x === 'number' ? Math.round(x) : 0,
      y: typeof y === 'number' ? Math.round(y) : 0,
    };
    sleeves.push(item);
    selection = { kind: 'sleeve', id: item.id };
    if (global.FtthLab && typeof FtthLab.setSelectionOwner === 'function') {
      FtthLab.setSelectionOwner('splice-sleeve');
    }
    rebuildLayer();
    if (!opts.silent) pushHistory();
    updateInspector();
    if (opts.fromEject) {
      setStatus('Sleeve ejected · drag along fiber or move freely');
    }
    return item;
  }

  function tryProximityMount(clientX, clientY, freeSleeveId) {
    var hit = findBareTipProximity(clientX, clientY);
    if (!hit) return false;
    if (!applyToPigtail(hit.id, {
      consumeFreeSleeveId: freeSleeveId,
      slideIn: true,
    })) {
      return false;
    }
    selectedTool = null;
    renderToolbox();
    updateInspector();
    return true;
  }

  function ensureLayer() {
    if (layer && layer.parentNode) return layer;
    var mount = document.getElementById('lab-2d-mount');
    if (!mount) return null;
    layer = document.createElement('div');
    layer.className = 'lab-sleeve-layer';
    layer.setAttribute('data-lab-sleeve-layer', '1');
    mount.appendChild(layer);
    return layer;
  }

  function sleeveFreeStyle(s) {
    var size = getSleeveSizePx();
    return (
      'left:' + Math.round(s.x - size.w / 2) + 'px;' +
      'top:' + Math.round(s.y - size.h / 2) + 'px;' +
      'width:' + size.w + 'px;' +
      'height:' + size.h + 'px;'
    );
  }

  function rebuildLayer() {
    var host = ensureLayer();
    if (!host) return;
    var html = '';
    sleeves.forEach(function (s) {
      var sel = selection.id === s.id ? ' is-selected' : '';
      html +=
        '<button type="button" class="lab-sleeve-free lab-sleeve-tube' + sel + '" data-sleeve-id="' + s.id +
        '" style="' + sleeveFreeStyle(s) + '" title="علبة حماية الوصلة (60mm)" ' +
        'aria-label="Splice protection sleeve 60mm"></button>';
    });
    host.innerHTML = html;
    bindLayerEvents(host);
  }

  function placeSleeve(x, y) {
    seq += 1;
    var item = {
      id: 'slv-' + seq,
      x: typeof x === 'number' ? x : 0,
      y: typeof y === 'number' ? y : 0,
    };
    sleeves.push(item);
    selection = { kind: 'sleeve', id: item.id };
    if (global.FtthLab && typeof FtthLab.setSelectionOwner === 'function') {
      FtthLab.setSelectionOwner('splice-sleeve');
    }
    rebuildLayer();
    pushHistory();
    updateInspector();
    setStatus('Sleeve 60mm placed');
    return item;
  }

  function removeSleeve(id) {
    sleeves = sleeves.filter(function (s) { return s.id !== id; });
    if (selection.id === id) selection = { kind: 'none', id: null };
    rebuildLayer();
    updateInspector();
    pushHistory();
    setStatus('Sleeve removed');
  }

  function tryAttachAtClient(clientX, clientY, freeSleeveId) {
    return tryProximityMount(clientX, clientY, freeSleeveId);
  }

  function updateInspector() {
    var card = document.getElementById('lab-inspector-card');
    var detail = document.getElementById('lab-inspector-detail');
    if (!card) return;
    if (selection.kind !== 'sleeve' || !selection.id) return;
    if (!findSleeve(selection.id)) return;
    card.innerHTML = '<h2>Sleeve 60mm</h2><p></p>';
    if (detail) {
      detail.hidden = false;
      detail.innerHTML = '';
    }
  }

  function selectSleeve(id, opts) {
    selection = { kind: 'sleeve', id: id };
    if (global.FtthLab && typeof FtthLab.setSelectionOwner === 'function') {
      FtthLab.setSelectionOwner('splice-sleeve');
    }
    updateInspector();
    /* skipRebuild during live drag — rebuild destroys the node under the pointer */
    if (!(opts && opts.skipRebuild)) rebuildLayer();
  }

  /** Hold-to-move with window listeners (same pattern as other lab nodes). */
  function bindLayerEvents(host) {
    host.querySelectorAll('[data-sleeve-id]').forEach(function (btn) {
      btn.addEventListener('pointerdown', function (e) {
        if (e.button != null && e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        var id = btn.getAttribute('data-sleeve-id');
        var s = findSleeve(id);
        if (!s) return;
        selectSleeve(id, { skipRebuild: true });
        if (layer) {
          layer.querySelectorAll('.lab-sleeve-free.is-selected').forEach(function (el) {
            if (el !== btn) el.classList.remove('is-selected');
          });
        }
        btn.classList.add('is-selected', 'is-dragging');
        document.body.classList.add('lab-sleeve-dragging');
        try { btn.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }

        var zoom = getZoom() || 1;
        var sx = e.clientX;
        var sy = e.clientY;
        var ox = s.x;
        var oy = s.y;
        var moved = false;
        var mounted = false;

        function endFreeDrag(ev) {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          window.removeEventListener('pointercancel', onUp);
          try { btn.releasePointerCapture(ev.pointerId); } catch (err2) { /* ignore */ }
          btn.classList.remove('is-dragging');
          document.body.classList.remove('lab-sleeve-dragging');
        }

        function onMove(ev) {
          var dx = (ev.clientX - sx) / zoom;
          var dy = (ev.clientY - sy) / zoom;
          if (!moved && Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) {
            return;
          }
          moved = true;
          s.x = Math.round(ox + dx);
          s.y = Math.round(oy + dy);
          var size = getSleeveSizePx();
          btn.style.left = Math.round(s.x - size.w / 2) + 'px';
          btn.style.top = Math.round(s.y - size.h / 2) + 'px';
          if (tryProximityMount(ev.clientX, ev.clientY, id)) {
            mounted = true;
            endFreeDrag(ev);
          }
        }

        function onUp(ev) {
          if (mounted) return;
          endFreeDrag(ev);
          if (tryProximityMount(ev.clientX, ev.clientY, id)) return;
          if (moved) pushHistory();
          rebuildLayer();
          updateInspector();
        }

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
      });
    });
  }

  function renderToolbox() {
    var host = global.FtthLab && typeof FtthLab.gateToolboxRender === 'function'
      ? FtthLab.gateToolboxRender('lab-sleeve-tree', 'sleeve')
      : document.getElementById('lab-sleeve-tree');
    if (!host) return;
    host.innerHTML =
      '<div class="lab-toolbox" role="list">' +
      '<div class="tool-item lab-tool lab-tool--sleeve' +
      (selectedTool === 'sleeve' ? ' is-selected' : '') +
      '" data-tool="sleeve" data-lab-tool="sleeve" draggable="true" ' +
      'role="listitem" tabindex="0" title="علبة حماية الوصلة (60mm)">' +
      '<span class="lab-tool__mark lab-tool__mark--sleeve" aria-hidden="true">' +
      '<img src="images/splice-sleeve-60mm.png" alt="" width="22" height="10" />' +
      '</span>' +
      '<span class="lab-tool__copy">' +
      '<strong>علبة حماية (Sleeve 60mm)</strong>' +
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
    var btn = host.querySelector('[data-tool="sleeve"]');
    if (!btn) return;

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
        FtthLab.claimToolboxTool('splice-sleeve');
      }
      selectedTool = 'sleeve';
      renderToolbox();
      setStatus('Sleeve 60mm · drag onto workspace');
    });

    btn.addEventListener('dragstart', function (e) {
      if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
        FtthLab.claimToolboxTool('splice-sleeve');
      }
      selectedTool = 'sleeve';
      dragLib = { kind: 'sleeve' };
      if (global.FtthLab && FtthLab.beginDrag) FtthLab.beginDrag({ kind: 'sleeve' });
      try {
        e.dataTransfer.setData('text/plain', 'lab:sleeve');
        e.dataTransfer.setData('text/lab-drag', 'sleeve');
        e.dataTransfer.effectAllowed = 'copy';
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

  function bindStageDrop() {
    var stage = document.getElementById('lab-canvas-2d');
    var mount = document.getElementById('lab-2d-mount');
    var world = document.getElementById('lab-2d-world');
    [stage, mount, world].forEach(function (el) {
      if (!el || el.dataset.sleeveDrop === '1') return;
      el.dataset.sleeveDrop = '1';

      el.addEventListener('dragover', function (e) {
        var active = global.FtthLab && FtthLab.getActiveDrag && FtthLab.getActiveDrag();
        if (!((dragLib && dragLib.kind === 'sleeve') || (active && active.kind === 'sleeve'))) {
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
        if (kind !== 'sleeve') return;
        e.preventDefault();
        e.stopPropagation();
        dragLib = null;
        if (global.FtthLab && FtthLab.endDrag) FtthLab.endDrag();

        if (tryAttachAtClient(e.clientX, e.clientY, null)) {
          selectedTool = null;
          renderToolbox();
          return;
        }
        var pt = clientToWorld(e.clientX, e.clientY);
        placeSleeve(Math.round(pt.x), Math.round(pt.y));
        selectedTool = null;
        renderToolbox();
      });
    });
  }

  function deleteSelected() {
    if (selection.kind === 'sleeve' && selection.id) {
      removeSleeve(selection.id);
      return true;
    }
    return false;
  }

  function clearSelection() {
    selection = { kind: 'none', id: null };
    rebuildLayer();
  }

  function onToolboxClaim(payload) {
    var id = payload && payload.toolId;
    if (id === 'splice-sleeve') return;
    selectedTool = null;
    renderToolbox();
  }

  function mount() {
    renderToolbox();
    bindStageDrop();
    ensureLayer();
    rebuildLayer();
    pushHistory();
    if (global.FtthLab) {
      FtthLab.placeFreeSleeve = placeFreeSleeve;
      FtthLab.consumeFreeSleeve = consumeFreeSleeve;
    }
  }

  var tool = {
    id: 'splice-sleeve',
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
      applySnapshot({ sleeves: [], seq: 0 });
    },
  };

  function tryRegister() {
    if (global.FtthLab && typeof FtthLab.registerTool === 'function') {
      FtthLab.registerTool('splice-sleeve', tool);
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
})(typeof window !== 'undefined' ? window : this);
