/**
 * SC Coupler — single toolbox adapter with SC/PC (UPC) / SC/APC type switching
 * via the side properties panel. Both faces share one polish for matching rules.
 */
(function (global) {
  'use strict';

  var COUPLER_LOSS_DB = 0.2;
  var COUPLER_LOSS_MIN = 0.2;
  var COUPLER_LOSS_MAX = 0.5;
  /* Patch-cord head 14×22; sideways plug → coupler height ≈ head width (+ rim) */
  var CPL_W = 40;
  var CPL_H = 18;

  var ctx = null;
  var layer = null;
  var couplers = [];
  var seq = 0;
  var selection = { kind: 'none', couplerId: null };
  var dragLib = null;
  var selectedTool = null;
  var history = [];
  var historyIndex = -1;
  var historyLocked = false;
  var HISTORY_MAX = 60;

  function setStatus(msg) {
    if (global.FtthLab && FtthLab.setStatus) FtthLab.setStatus(msg);
  }

  function getWorldSize() {
    return (global.FtthLab && FtthLab.getWorldSize) ? FtthLab.getWorldSize() : 20000;
  }

  function getZoom() {
    return (global.FtthLab && FtthLab.getZoom2d) ? FtthLab.getZoom2d() : 1;
  }

  function randomInsertionLoss() {
    var n = COUPLER_LOSS_MIN + Math.random() * (COUPLER_LOSS_MAX - COUPLER_LOSS_MIN);
    return Math.round(n * 100) / 100;
  }

  function couplerIl(c) {
    var n = Number(c && c.lossDb);
    if (isFinite(n) && n >= COUPLER_LOSS_MIN && n <= COUPLER_LOSS_MAX) return n;
    return COUPLER_LOSS_DB;
  }

  function findCoupler(id) {
    for (var i = 0; i < couplers.length; i++) {
      if (couplers[i].id === id) return couplers[i];
    }
    return null;
  }

  function normalizePolish(v) {
    var s = String(v || '').toUpperCase();
    if (s === 'APC' || s === 'SC/APC' || s === 'SCAPC') return 'APC';
    return 'UPC';
  }

  function displayPolish(v) {
    return normalizePolish(v) === 'APC' ? 'SC/APC' : 'SC/PC';
  }

  function snapshot() {
    return JSON.parse(JSON.stringify({
      couplers: couplers,
      seq: seq,
      selection: selection,
    }));
  }

  function applySnapshot(snap) {
    if (!snap) return;
    historyLocked = true;
    couplers = snap.couplers || [];
    couplers.forEach(function (c) {
      if (typeof c.lossDb !== 'number') c.lossDb = COUPLER_LOSS_DB;
      if (!c.polish) c.polish = 'APC';
      delete c.rotation;
    });
    seq = snap.seq || 0;
    selection = snap.selection || { kind: 'none', couplerId: null };
    rebuildLayer();
    updateInspector();
    historyLocked = false;
  }

  function pushHistory() {
    if (historyLocked) return;
    history = history.slice(0, historyIndex + 1);
    history.push(snapshot());
    if (history.length > HISTORY_MAX) history.shift();
    historyIndex = history.length - 1;
    if (global.FtthLab && typeof FtthLab.recordHistory === 'function') {
      FtthLab.recordHistory('sc-coupler');
    }
  }

  function undo() {
    if (historyIndex <= 0) return false;
    historyIndex -= 1;
    applySnapshot(history[historyIndex]);
    setStatus('Undo · coupler');
    return true;
  }

  function redo() {
    if (historyIndex >= history.length - 1) return false;
    historyIndex += 1;
    applySnapshot(history[historyIndex]);
    setStatus('Redo · coupler');
    return true;
  }

  function defaultPos() {
    var w = getWorldSize();
    return {
      x: Math.round(w / 2 + 40 + couplers.length * 28),
      y: Math.round(w / 2 + 160 + (couplers.length % 4) * 36),
    };
  }

  function placeCoupler(x, y, polish) {
    seq += 1;
    var pos = (typeof x === 'number' && typeof y === 'number')
      ? { x: x, y: y }
      : defaultPos();
    var c = {
      id: 'cpl-' + seq,
      x: pos.x,
      y: pos.y,
      polish: normalizePolish(polish || 'APC'),
      lossDb: randomInsertionLoss(),
    };
    couplers.push(c);
    selectCoupler(c.id);
    rebuildLayer();
    pushHistory();
    if (global.FtthLab && typeof FtthLab.notifyLayoutChange === 'function') {
      FtthLab.notifyLayoutChange({ source: 'coupler', couplerId: c.id, opm: true });
    }
    setStatus(
      'SC Coupler placed · ' + displayPolish(c.polish) +
      ' · IL ' + couplerIl(c).toFixed(2) + ' dB · Port 1 / Port 2'
    );
    return c;
  }

  function removeCoupler(id) {
    /* Detach any patch cords seated in this coupler */
    if (global.FtthLab && typeof FtthLab.detachPortsForCoupler === 'function') {
      FtthLab.detachPortsForCoupler(id);
    }
    couplers = couplers.filter(function (c) { return c.id !== id; });
    if (selection.couplerId === id) {
      selection = { kind: 'none', couplerId: null };
    }
    rebuildLayer();
    updateInspector();
    pushHistory();
    setStatus('SC Coupler removed');
  }

  /**
   * Switch coupler type (both faces). Instantly updates visuals + matching polish.
   */
  function setCouplerPolish(id, polish) {
    var c = findCoupler(id);
    if (!c) return;
    polish = normalizePolish(polish);
    if (c.polish === polish) return;
    c.polish = polish;
    rebuildLayer();
    updateInspector();
    if (global.FtthLab && typeof FtthLab.refreshCouplerPolish === 'function') {
      FtthLab.refreshCouplerPolish(id, polish);
    }
    if (global.FtthLab && typeof FtthLab.notifyLayoutChange === 'function') {
      FtthLab.notifyLayoutChange({ source: 'coupler', couplerId: id, opm: true });
    }
    pushHistory();
    setStatus('SC Coupler → ' + displayPolish(polish));
  }

  function selectCoupler(id, opts) {
    selection = { kind: 'coupler', couplerId: id };
    if (global.FtthLab && typeof FtthLab.setSelectionOwner === 'function') {
      FtthLab.setSelectionOwner('sc-coupler');
    }
    updateInspector();
    /* skipRebuild during live drag — rebuild destroys the node under the pointer */
    if (!(opts && opts.skipRebuild)) rebuildLayer();
  }

  function clearSelection() {
    var had = selection.kind === 'coupler';
    selection = { kind: 'none', couplerId: null };
    selectedTool = null;
    renderToolbox();
    if (had) rebuildLayer();
  }

  function deleteSelected() {
    if (selection.kind === 'coupler' && selection.couplerId) {
      removeCoupler(selection.couplerId);
      return true;
    }
    return false;
  }

  function onToolboxClaim(payload) {
    var id = payload && payload.toolId;
    if (id === 'sc-coupler') return;
    if (selectedTool) {
      selectedTool = null;
      renderToolbox();
    }
  }

  /* ─── Toolbox — single SC Coupler ─── */

  function renderToolbox() {
    var host = global.FtthLab && typeof FtthLab.gateToolboxRender === 'function'
      ? FtthLab.gateToolboxRender('lab-coupler-tree', 'coupler')
      : document.getElementById('lab-coupler-tree');
    if (!host) return;

    host.innerHTML =
      '<div class="lab-toolbox" role="list">' +
      '<button type="button" class="lab-tool lab-tool--cpl' +
      (selectedTool === 'coupler' ? ' is-selected' : '') +
      '" draggable="true" data-lab-tool="coupler" role="listitem">' +
      '<span class="lab-tool__mark lab-tool__mark--cpl" aria-hidden="true"></span>' +
      '<span class="lab-tool__copy">' +
      '<strong>SC/APC Coupler</strong>' +
      '<span>Inline sleeve · 0.2–0.5 dB IL</span>' +
      '</span>' +
      '</button>' +
      '</div>';

    bindToolbox(host);
    if (global.FtthLab && typeof FtthLab.applyFtthLabToolboxIcons === 'function') {
      FtthLab.applyFtthLabToolboxIcons();
    }
  }

  function bindToolbox(host) {
    var btn = host.querySelector('[data-lab-tool="coupler"]');
    if (!btn) return;

    btn.addEventListener('click', function () {
      if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
        FtthLab.claimToolboxTool('sc-coupler');
      }
      selectedTool = 'coupler';
      renderToolbox();
      setStatus('SC Coupler · drag onto workspace · set SC/PC or SC/APC in properties');
    });

    btn.addEventListener('dragstart', function (e) {
      if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
        FtthLab.claimToolboxTool('sc-coupler');
      }
      selectedTool = 'coupler';
      dragLib = { kind: 'coupler' };
      if (global.FtthLab && typeof FtthLab.beginDrag === 'function') {
        FtthLab.beginDrag({ kind: 'coupler' });
      }
      try {
        e.dataTransfer.setData('text/plain', 'lab:coupler');
        e.dataTransfer.setData('text/lab-drag', 'coupler');
        e.dataTransfer.effectAllowed = 'copy';
      } catch (err) { /* ignore */ }
      btn.classList.add('is-dragging', 'is-selected');
    });

    btn.addEventListener('dragend', function () {
      dragLib = null;
      if (global.FtthLab && typeof FtthLab.endDrag === 'function') {
        FtthLab.endDrag();
      }
      if (global.FtthLab && typeof FtthLab.clearStageDropHighlight === 'function') {
        FtthLab.clearStageDropHighlight();
      }
      btn.classList.remove('is-dragging');
      renderToolbox();
    });
  }

  function bindStageDrop() {
    var stage = document.getElementById('lab-canvas-2d');
    var mount = document.getElementById('lab-2d-mount');
    var world = document.getElementById('lab-2d-world');
    [stage, mount, world].forEach(function (el) {
      if (!el || el.dataset.couplerDrop === '1') return;
      el.dataset.couplerDrop = '1';
      el.addEventListener('dragover', function (e) {
        var active = global.FtthLab && FtthLab.getActiveDrag && FtthLab.getActiveDrag();
        var isCpl = !!dragLib || (active && active.kind === 'coupler');
        if (!isCpl) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      });
      el.addEventListener('drop', function (e) {
        var active = global.FtthLab && FtthLab.getActiveDrag && FtthLab.getActiveDrag();
        var kind = (e.dataTransfer && e.dataTransfer.getData('text/lab-drag')) ||
          (active && active.kind) ||
          (dragLib ? 'coupler' : '');
        if (kind !== 'coupler') return;
        e.preventDefault();
        e.stopPropagation();

        var wx = 0;
        var wy = 0;
        if (global.FtthLab && typeof FtthLab.clientToWorld2d === 'function') {
          var pt = FtthLab.clientToWorld2d(e.clientX, e.clientY);
          wx = pt.x;
          wy = pt.y;
        } else {
          var stageEl = document.getElementById('lab-canvas-2d');
          if (stageEl) {
            var rect = stageEl.getBoundingClientRect();
            var zoom = getZoom();
            var panX = 0;
            var panY = 0;
            if (global.FtthLab && typeof FtthLab.getPan2d === 'function') {
              var pan = FtthLab.getPan2d();
              panX = pan.x;
              panY = pan.y;
            }
            wx = (e.clientX - rect.left - panX) / zoom;
            wy = (e.clientY - rect.top - panY) / zoom;
          }
        }
        placeCoupler(Math.round(wx - CPL_W / 2), Math.round(wy - CPL_H / 2), 'UPC');
        dragLib = null;
        if (global.FtthLab && typeof FtthLab.endDrag === 'function') FtthLab.endDrag();
        if (global.FtthLab && typeof FtthLab.clearStageDropHighlight === 'function') {
          FtthLab.clearStageDropHighlight();
        }
      });
    });
  }

  /* ─── Render ─── */

  function ensureLayer() {
    var mount = (ctx && ctx.host2d) || document.getElementById('lab-2d-mount');
    if (!mount) return null;
    if (!layer || !layer.parentNode) {
      layer = document.createElement('div');
      layer.className = 'lab-coupler-layer';
      layer.setAttribute('data-lab-coupler-layer', '1');
      mount.appendChild(layer);
    }
    return layer;
  }

  /**
   * Compact top-down SC coupler — body + center flange.
   * Sized so side receptacles match a 14×22 patch-cord head (sideways plug).
   */
  function couplerSvg(c, polish) {
    var isApc = polish === 'APC';
    var uid = String(c.id || 'x').replace(/[^a-zA-Z0-9_-]/g, '');
    var body = isApc ? '#22c55e' : '#2563eb';
    var bodyDeep = isApc ? '#166534' : '#1e3a8a';
    var bodyHi = isApc ? '#4ade80' : '#60a5fa';
    var gBody = 'cplBody-' + uid;
    return (
      '<svg class="lab-cpl__art" viewBox="0 0 80 36" width="' + CPL_W + '" height="' + CPL_H + '" ' +
      'aria-hidden="true" focusable="false">' +
      '<defs>' +
      '<linearGradient id="' + gBody + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="' + bodyHi + '"/>' +
      '<stop offset="100%" stop-color="' + bodyDeep + '"/>' +
      '</linearGradient>' +
      '</defs>' +
      '<rect x="4" y="6" width="72" height="24" rx="3.5" ry="3.5" ' +
      'fill="url(#' + gBody + ')" stroke="' + bodyHi + '" stroke-width="1.25"/>' +
      '<rect x="5.5" y="9" width="9" height="18" rx="1.6" fill="rgba(15,23,42,0.42)"/>' +
      '<rect x="65.5" y="9" width="9" height="18" rx="1.6" fill="rgba(15,23,42,0.42)"/>' +
      '<circle cx="10" cy="18" r="2.6" fill="#e2e8f0" stroke="#94a3b8" stroke-width="0.5"/>' +
      '<circle cx="70" cy="18" r="2.6" fill="#e2e8f0" stroke="#94a3b8" stroke-width="0.5"/>' +
      '<circle cx="10" cy="18" r="1.1" fill="#64748b"/>' +
      '<circle cx="70" cy="18" r="1.1" fill="#64748b"/>' +
      '<rect x="22" y="4" width="10" height="2.4" rx="0.7" fill="#cbd5e1"/>' +
      '<rect x="48" y="4" width="10" height="2.4" rx="0.7" fill="#cbd5e1"/>' +
      '<rect x="22" y="29.6" width="10" height="2.4" rx="0.7" fill="#94a3b8"/>' +
      '<rect x="48" y="29.6" width="10" height="2.4" rx="0.7" fill="#94a3b8"/>' +
      '<rect x="35" y="2.5" width="10" height="31" rx="1.6" ' +
      'fill="' + body + '" stroke="' + bodyHi + '" stroke-width="1.15"/>' +
      '</svg>'
    );
  }

  function couplerMarkup(c) {
    var polish = normalizePolish(c.polish);
    var polishClass = polish === 'APC' ? 'is-apc' : 'is-upc';
    var selected = selection.couplerId === c.id ? ' is-selected' : '';
    var title = 'SC Coupler · ' + displayPolish(polish);
    return (
      '<div class="lab-cpl ' + polishClass + selected + '" data-cpl-node="' + c.id + '" ' +
      'style="left:' + Math.round(c.x) + 'px;top:' + Math.round(c.y) + 'px" ' +
      'title="' + title + '">' +
      couplerSvg(c, polish) +
      '<button type="button" class="lab-cpl-port lab-cpl-port--a ' + polishClass +
      '" data-cpl-id="' + c.id + '" data-cpl-port="A" tabindex="-1" ' +
      'title="Face A · ' + displayPolish(polish) + '" aria-label="Coupler face A"></button>' +
      '<button type="button" class="lab-cpl-port lab-cpl-port--b ' + polishClass +
      '" data-cpl-id="' + c.id + '" data-cpl-port="B" tabindex="-1" ' +
      'title="Face B · ' + displayPolish(polish) + '" aria-label="Coupler face B"></button>' +
      '</div>'
    );
  }

  function rebuildLayer() {
    var host = ensureLayer();
    if (!host) return;
    var html = '';
    couplers.forEach(function (c) {
      html += couplerMarkup(c);
    });
    host.innerHTML = html;
    bindLayerEvents(host);
    reapplyStoredVflGlow();
  }

  function bindLayerEvents(host) {
    host.querySelectorAll('[data-cpl-node]').forEach(function (node) {
      /* Click affirms selection (same pattern as splitter / OLT); stop bubble to stage */
      node.addEventListener('click', function (e) {
        if (e.target.closest && e.target.closest('.lab-cpl-port')) return;
        e.preventDefault();
        e.stopPropagation();
        var id = node.getAttribute('data-cpl-node');
        if (!id) return;
        selectCoupler(id, { skipRebuild: true });
        if (layer) {
          layer.querySelectorAll('.lab-cpl.is-selected').forEach(function (el) {
            if (el !== node) el.classList.remove('is-selected');
          });
        }
        node.classList.add('is-selected');
      });

      node.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        /* Ports are patch-cord hit targets — don't steal for coupler drag */
        if (e.target.closest && e.target.closest('.lab-cpl-port')) return;
        e.preventDefault();
        e.stopPropagation();
        var id = node.getAttribute('data-cpl-node');
        var c = findCoupler(id);
        if (!c) return;

        /* Select without rebuild so the same DOM node stays under the pointer */
        selectCoupler(id, { skipRebuild: true });
        if (layer) {
          layer.querySelectorAll('.lab-cpl.is-selected').forEach(function (el) {
            if (el !== node) el.classList.remove('is-selected');
          });
        }
        node.classList.add('is-selected', 'is-dragging');

        var zoom = getZoom() || 1;
        var sx = e.clientX;
        var sy = e.clientY;
        var ox = c.x;
        var oy = c.y;
        var moved = false;
        var layoutQueued = false;
        try { node.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }

        function onMove(ev) {
          var dx = (ev.clientX - sx) / zoom;
          var dy = (ev.clientY - sy) / zoom;
          moved = true;
          c.x = Math.round(ox + dx);
          c.y = Math.round(oy + dy);
          node.style.left = c.x + 'px';
          node.style.top = c.y + 'px';
          /* Keep plugged patch cords locked to this coupler every frame */
          if (!layoutQueued && global.FtthLab &&
              typeof FtthLab.notifyLayoutChange === 'function') {
            layoutQueued = true;
            requestAnimationFrame(function () {
              layoutQueued = false;
              FtthLab.notifyLayoutChange({
                source: 'coupler',
                couplerId: id,
              });
            });
          }
        }
        function onUp(ev) {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          window.removeEventListener('pointercancel', onUp);
          try { node.releasePointerCapture(ev.pointerId); } catch (err2) { /* ignore */ }
          node.classList.remove('is-dragging');
          /* Keep selection + properties panel open after click or drag */
          if (selection.couplerId === id) {
            node.classList.add('is-selected');
            updateInspector();
          }
          if (moved) {
            if (global.FtthLab && typeof FtthLab.notifyLayoutChange === 'function') {
              FtthLab.notifyLayoutChange({
                source: 'coupler',
                couplerId: id,
              });
            }
            pushHistory();
          }
        }
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
      });
    });
  }

  function updateInspector() {
    var card = document.getElementById('lab-inspector-card');
    var detail = document.getElementById('lab-inspector-detail');
    if (!card) return;
    if (selection.kind !== 'coupler' || !selection.couplerId) return;

    var c = findCoupler(selection.couplerId);
    if (!c) {
      selection = { kind: 'none', couplerId: null };
      return;
    }

    var isApc = normalizePolish(c.polish) === 'APC';
    var meta = (global.FtthLab && FtthLab.getToolMeta && FtthLab.getToolMeta('coupler')) || {};
    card.innerHTML =
      '<h2>' + (meta.label || 'SC/APC Coupler') + '</h2>' +
      '<p>' + (meta.guideText || 'Dual-port mating sleeve · plug a patch cord into Port 1 and Port 2 to bridge the link.') + '</p>';

    if (!detail) return;
    detail.hidden = false;
    detail.innerHTML =
      '<div class="lab-cpl-config">' +
      '<p class="lab-inspector__label">Connector type</p>' +
      '<div class="lab-polish-toggle" role="group" aria-label="SC Coupler type">' +
      '<button type="button" class="lab-polish-btn is-upc' + (!isApc ? ' is-active' : '') +
      '" data-cpl-polish="' + c.id + ':UPC">SC/PC · Blue</button>' +
      '<button type="button" class="lab-polish-btn is-apc' + (isApc ? ' is-active' : '') +
      '" data-cpl-polish="' + c.id + ':APC">SC/APC · Green</button>' +
      '</div>' +
      '<div class="lab-spl-sheet">' +
      '<div><span>Type</span><strong class="' +
      (isApc ? 'is-apc-text' : 'is-upc-text') + '">' + displayPolish(c.polish) +
      '</strong></div>' +
      '<div><span>Faces</span><strong>Port 1 · Port 2</strong></div>' +
      '<div><span>IL</span><strong>' + couplerIl(c).toFixed(2) + ' dB</strong></div>' +
      '</div>' +
      '<button type="button" class="lab-eject-btn" data-remove-cpl="' + c.id +
      '">Remove Coupler</button>' +
      '</div>';

    detail.querySelectorAll('[data-cpl-polish]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var parts = btn.getAttribute('data-cpl-polish').split(':');
        setCouplerPolish(parts[0], parts[1]);
      });
    });
    var rm = detail.querySelector('[data-remove-cpl]');
    if (rm) {
      rm.addEventListener('click', function () {
        removeCoupler(c.id);
        if (global.FtthLab && typeof FtthLab.resetInspectorIdle === 'function') {
          FtthLab.resetInspectorIdle();
        } else {
          var idleCard = document.getElementById('lab-inspector-card');
          var idleDetail = document.getElementById('lab-inspector-detail');
          if (idleCard) {
            idleCard.innerHTML =
              '<h2>No selection</h2>' +
              '<p>Select equipment on the canvas, or drag an item from the toolbox.</p>';
          }
          if (idleDetail) {
            idleDetail.hidden = true;
            idleDetail.innerHTML = '';
          }
        }
      });
    }
  }

  function onViewChange() {
    rebuildLayer();
  }

  function getCouplerLossDb() {
    var sum = 0;
    couplers.forEach(function (c) { sum += couplerIl(c); });
    return Math.round(sum * 100) / 100;
  }

  function getCouplerPassLossDb(id) {
    var c = findCoupler(id);
    return c ? couplerIl(c) : COUPLER_LOSS_DB;
  }

  function getCouplerPortWorld(id, port) {
    var c = findCoupler(id);
    if (!c) return null;
    var face = port === 'B' || port === 'b' ? 'B' : 'A';
    var px = face === 'B' ? (c.x + CPL_W - 5.5) : (c.x + 5.5);
    var py = c.y + CPL_H / 2;
    return {
      x: px,
      y: py,
      rot: face === 'B' ? -90 : 90,
      polish: normalizePolish(c.polish),
    };
  }

  function getCouplerOppositePort(port) {
    return (port === 'B' || port === 'b') ? 'A' : 'B';
  }

  function isCouplerId(id) {
    return !!findCoupler(id);
  }

  function getCouplerIds() {
    return couplers.map(function (c) { return c.id; });
  }

  function applyCouplerLaserGlow(targets) {
    if (!layer) return;
    var mode = String((targets && targets.mode) || 'OFF').toUpperCase();
    var pass = (targets && targets.couplerPass) || {};
    var on = mode !== 'OFF';
    layer.querySelectorAll('[data-cpl-node]').forEach(function (el) {
      var id = el.getAttribute('data-cpl-node');
      var active = on && !!pass[id];
      el.classList.toggle('is-laser-pass', active);
      el.classList.toggle('is-laser-pass--glint', active && mode === 'GLINT');
      el.classList.toggle('is-laser-pass--cw', active && mode !== 'GLINT');
    });
  }

  function reapplyStoredVflGlow() {
    if (global.FtthLab && FtthLab._vflGlow) {
      applyCouplerLaserGlow(FtthLab._vflGlow);
    } else if (global.FtthLab && typeof FtthLab.refreshVflLaser === 'function') {
      FtthLab.refreshVflLaser();
    }
  }

  function onLayoutChange(payload) {
    if (payload && payload.live) return;
    if (global.FtthLab && typeof FtthLab.refreshVflLaser === 'function') {
      FtthLab.refreshVflLaser();
    } else {
      reapplyStoredVflGlow();
    }
  }

  function mount(api) {
    ctx = api || {};
    couplers = [];
    seq = 0;
    history = [];
    historyIndex = -1;
    historyLocked = false;
    selection = { kind: 'none', couplerId: null };
    selectedTool = null;
    renderToolbox();
    bindStageDrop();
    ensureLayer();
    rebuildLayer();
    pushHistory();

    if (global.FtthLab) {
      FtthLab.getCouplerLoss = getCouplerLossDb;
      FtthLab.getCouplerPassLossDb = getCouplerPassLossDb;
      FtthLab.getCouplerPortWorld = getCouplerPortWorld;
      FtthLab.getCouplerOppositePort = getCouplerOppositePort;
      FtthLab.isCouplerId = isCouplerId;
      FtthLab.getCouplerIds = getCouplerIds;

      var prevGlow = FtthLab.applyFiberLaserGlow;
      FtthLab.applyFiberLaserGlow = function (targets) {
        if (typeof prevGlow === 'function') prevGlow(targets);
        applyCouplerLaserGlow(targets);
      };
    }
  }

  var tool = {
    id: 'sc-coupler',
    mount: mount,
    onViewChange: onViewChange,
    onLayoutChange: onLayoutChange,
    placeCoupler: placeCoupler,
    undo: undo,
    redo: redo,
    deleteSelected: deleteSelected,
    clearSelection: clearSelection,
    onToolboxClaim: onToolboxClaim,
    getNetworkLossDb: getCouplerLossDb,
    onLabConfigChanged: function (payload) {
      if (global.FtthLab && typeof FtthLab.handleToolboxConfigChange === 'function') {
        FtthLab.handleToolboxConfigChange('coupler', 'lab-coupler-tree', renderToolbox, payload && payload.config);
      } else {
        renderToolbox();
      }
      updateInspector();
    },
    exportProjectState: snapshot,
    importProjectState: applySnapshot,
    resetProjectState: function () {
      applySnapshot({ couplers: [], seq: 0, selection: { kind: 'none', couplerId: null } });
    },
  };

  function tryRegister() {
    if (global.FtthLab && typeof FtthLab.registerTool === 'function') {
      FtthLab.registerTool('sc-coupler', tool);
      return true;
    }
    return false;
  }

  if (!tryRegister()) {
    document.addEventListener('DOMContentLoaded', function () {
      if (!tryRegister()) {
        var n = 0;
        var t = setInterval(function () {
          if (tryRegister() || ++n > 40) clearInterval(t);
        }, 50);
      }
    });
  }
})(typeof window !== 'undefined' ? window : this);
