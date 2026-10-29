/**
 * Fiber Management Spools (pin tools) — 2D canvas entities.
 * Three visual presets: Quarter 90° Hoffman, Half 180° shelf, Full 360° drum.
 * Winding is manual (patch-cord mouse Δθ); this module owns placement, art, and properties.
 */
(function (global) {
  'use strict';

  var PX_PER_MM = 1.25;
  var R_MIN = 25;
  var R_MAX = 60;
  var R_DEFAULT = 35;
  var BEND_SAFE_MM = 30;
  var FLANGE_MM = 7;

  var ctx = null;
  var layer = null;
  var spools = [];
  var seq = 0;
  var selection = { kind: 'none', spoolId: null };
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

  function mmToPx(mm) {
    if (global.FtthLab && typeof FtthLab.mmToWorldPx === 'function') {
      return FtthLab.mmToWorldPx(mm);
    }
    return mm * PX_PER_MM;
  }

  function clampRadius(mm) {
    var n = Number(mm);
    if (!isFinite(n)) return R_DEFAULT;
    if (n < R_MIN) return R_MIN;
    if (n > R_MAX) return R_MAX;
    return Math.round(n);
  }

  function normalizeType(t) {
    var s = String(t || '').toLowerCase();
    if (s === 'quarter' || s === '90' || s === 'hoffman') return 'quarter';
    if (s === 'half' || s === '180' || s === 'shelf') return 'half';
    return 'full';
  }

  function normalizeRot(deg) {
    var n = Number(deg) || 0;
    n = ((Math.round(n / 90) * 90) % 360 + 360) % 360;
    return n;
  }

  function typeLabel(t) {
    if (t === 'quarter') return 'Quarter Spool (90°)';
    if (t === 'half') return 'Half Spool (180°)';
    return 'Full Spool (360°)';
  }

  function findSpool(id) {
    for (var i = 0; i < spools.length; i++) {
      if (spools[i].id === id) return spools[i];
    }
    return null;
  }

  function spoolSizePx(s) {
    var r = mmToPx(s.radiusMm) + mmToPx(FLANGE_MM);
    return Math.max(48, Math.round(r * 2));
  }

  function spoolArcSpanRad(type) {
    if (type === 'quarter') return Math.PI / 2;
    if (type === 'half') return Math.PI;
    return Math.PI * 2;
  }

  function spoolCenter(s) {
    var sz = spoolSizePx(s);
    var type = s.type || 'full';
    var span = spoolArcSpanRad(type);
    return {
      x: s.x + sz / 2,
      y: s.y + sz / 2,
      r: mmToPx(s.radiusMm),
      rOuter: mmToPx(s.radiusMm) + mmToPx(FLANGE_MM),
      size: sz,
      type: type,
      rot: s.rot || 0,
      arcSpanRad: span,
      startAng: ((s.rot || 0) * Math.PI) / 180,
      maxWindRad: type === 'full' ? Math.PI * 36 : span
    };
  }

  function snapshot() {
    return JSON.parse(JSON.stringify({
      spools: spools,
      seq: seq,
      selection: selection,
    }));
  }

  function applySnapshot(snap) {
    if (!snap) return;
    historyLocked = true;
    spools = snap.spools || [];
    seq = snap.seq || 0;
    selection = snap.selection || { kind: 'none', spoolId: null };
    rebuildLayer();
    updateInspector();
    historyLocked = false;
    notifySpoolsChanged();
  }

  function pushHistory() {
    if (historyLocked) return;
    history = history.slice(0, historyIndex + 1);
    history.push(snapshot());
    if (history.length > HISTORY_MAX) history.shift();
    historyIndex = history.length - 1;
    if (global.FtthLab && typeof FtthLab.recordHistory === 'function') {
      FtthLab.recordHistory('fiber-spool');
    }
  }

  function undo() {
    if (historyIndex <= 0) return false;
    historyIndex -= 1;
    applySnapshot(history[historyIndex]);
    setStatus('Undo · fiber spool');
    return true;
  }

  function redo() {
    if (historyIndex >= history.length - 1) return false;
    historyIndex += 1;
    applySnapshot(history[historyIndex]);
    setStatus('Redo · fiber spool');
    return true;
  }

  function notifySpoolsChanged(payload) {
    if (global.FtthLab && typeof FtthLab.notifyLayoutChange === 'function') {
      FtthLab.notifyLayoutChange(payload || { source: 'spool', opm: true });
    }
  }

  function defaultPos() {
    var w = getWorldSize();
    return {
      x: Math.round(w / 2 + 80 + spools.length * 36),
      y: Math.round(w / 2 + 220 + (spools.length % 3) * 40),
    };
  }

  function placeSpool(x, y, type) {
    seq += 1;
    var pos = (typeof x === 'number' && typeof y === 'number')
      ? { x: x, y: y }
      : defaultPos();
    var s = {
      id: 'spool-' + seq,
      type: normalizeType(type && type !== 'spool' ? type : 'full'),
      x: pos.x,
      y: pos.y,
      radiusMm: R_DEFAULT,
      rot: 0,
    };
    var sz = spoolSizePx(s);
    s.x = Math.round(pos.x - sz / 2);
    s.y = Math.round(pos.y - sz / 2);
    spools.push(s);
    selectSpool(s.id);
    rebuildLayer();
    pushHistory();
    setStatus(typeLabel(s.type) + ' placed · R ' + s.radiusMm + ' mm · wind fiber by hand');
    notifySpoolsChanged({ source: 'spool', spoolId: s.id, opm: true });
    return s;
  }

  function keepCenterWhileResize(s, nextMm) {
    var c0 = spoolCenter(s);
    s.radiusMm = clampRadius(nextMm);
    var sz = spoolSizePx(s);
    s.x = Math.round(c0.x - sz / 2);
    s.y = Math.round(c0.y - sz / 2);
  }

  function setSpoolType(id, type) {
    var s = findSpool(id);
    if (!s) return;
    type = normalizeType(type);
    if (s.type === type) return;
    s.type = type;
    if (type === 'full') s.rot = 0;
    rebuildLayer();
    updateInspector();
    pushHistory();
    notifySpoolsChanged({ source: 'spool', spoolId: id, opm: true });
    setStatus('Spool → ' + typeLabel(type));
  }

  function setSpoolRadius(id, mm, opts) {
    var s = findSpool(id);
    if (!s) return;
    keepCenterWhileResize(s, mm);
    var live = opts && opts.live;
    if (!live) {
      rebuildLayer();
      updateInspector();
      pushHistory();
    } else {
      var node = layer && layer.querySelector('[data-spool-node="' + id + '"]');
      if (node) {
        node.style.left = s.x + 'px';
        node.style.top = s.y + 'px';
        node.style.width = spoolSizePx(s) + 'px';
        node.style.height = spoolSizePx(s) + 'px';
        var art = node.querySelector('.lab-spool__art');
        if (art) {
          art.setAttribute('width', String(spoolSizePx(s)));
          art.setAttribute('height', String(spoolSizePx(s)));
        }
      }
    }
    notifySpoolsChanged({ source: 'spool', spoolId: id, live: !!live, opm: true });
    if (!live) setStatus('Bend radius R = ' + s.radiusMm + ' mm');
  }

  function setSpoolRot(id, deg) {
    var s = findSpool(id);
    if (!s) return;
    if (s.type === 'full') return;
    s.rot = normalizeRot(deg);
    rebuildLayer();
    updateInspector();
    pushHistory();
    notifySpoolsChanged({ source: 'spool', spoolId: id, opm: true });
    setStatus('Spool rotation ' + s.rot + '°');
  }

  function removeSpool(id) {
    if (global.FtthLab && typeof FtthLab.detachSpoolWinds === 'function') {
      FtthLab.detachSpoolWinds(id);
    }
    spools = spools.filter(function (s) { return s.id !== id; });
    if (selection.spoolId === id) {
      selection = { kind: 'none', spoolId: null };
    }
    rebuildLayer();
    updateInspector();
    pushHistory();
    notifySpoolsChanged({ source: 'spool', spoolId: id, opm: true });
    setStatus('Fiber spool removed');
  }

  function duplicateSpool(id) {
    var src = findSpool(id);
    if (!src) return null;
    seq += 1;
    var copy = {
      id: 'spool-' + seq,
      type: src.type,
      x: src.x + 28,
      y: src.y + 28,
      radiusMm: src.radiusMm,
      rot: src.rot,
    };
    spools.push(copy);
    selectSpool(copy.id);
    rebuildLayer();
    pushHistory();
    notifySpoolsChanged({ source: 'spool', spoolId: copy.id, opm: true });
    setStatus('Spool duplicated');
    return copy;
  }

  function selectSpool(id, opts) {
    selection = { kind: 'spool', spoolId: id };
    if (global.FtthLab && typeof FtthLab.setSelectionOwner === 'function') {
      FtthLab.setSelectionOwner('fiber-spool');
    }
    updateInspector();
    if (!(opts && opts.skipRebuild)) rebuildLayer();
  }

  function clearSelection() {
    var had = selection.kind === 'spool';
    selection = { kind: 'none', spoolId: null };
    selectedTool = null;
    renderToolbox();
    if (had) rebuildLayer();
  }

  function deleteSelected() {
    if (selection.kind === 'spool' && selection.spoolId) {
      removeSpool(selection.spoolId);
      return true;
    }
    return false;
  }

  function onToolboxClaim(payload) {
    var id = payload && payload.toolId;
    if (id === 'fiber-spool') return;
    if (selectedTool) {
      selectedTool = null;
      renderToolbox();
    }
  }

  function pickSpoolForWind(wx, wy) {
    var best = null;
    var bestScore = 1e9;
    var i;
    for (i = 0; i < spools.length; i++) {
      var s = spools[i];
      var c = spoolCenter(s);
      var d = Math.hypot(wx - c.x, wy - c.y);
      /* Wide capture so stacked coils stay on the drum through 360° / 720° / 1080°. */
      var inner = 0;
      var outer = c.r + mmToPx(FLANGE_MM) + 36;
      if (d < inner || d > outer) continue;
      var score = Math.abs(d - c.r);
      if (score < bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return best;
  }

  function listSpools() {
    return spools.slice();
  }

  function spoolBendLossDb(s, loopCount) {
    if (!s) return 0;
    if (s.radiusMm >= BEND_SAFE_MM) return 0;
    var loops = Math.max(1, Number(loopCount) || 0);
    return Math.round((BEND_SAFE_MM - s.radiusMm) * 0.04 * loops * 100) / 100;
  }

  function spoolSlackMeters(s, loopCount) {
    if (!s) return 0;
    var n = Math.max(0, Number(loopCount) || 0);
    return (2 * Math.PI * (s.radiusMm / 1000)) * n;
  }

  /* ─── Toolbox ─── */

  function renderToolbox() {
    var host = global.FtthLab && typeof FtthLab.gateToolboxRender === 'function'
      ? FtthLab.gateToolboxRender('lab-spool-tree', 'spool')
      : document.getElementById('lab-spool-tree');
    if (!host) return;
    host.innerHTML =
      '<div class="lab-toolbox" role="list">' +
      '<button type="button" class="lab-tool lab-tool--spool' +
      (selectedTool === 'spool' ? ' is-selected' : '') +
      '" draggable="true" data-lab-tool="spool" role="listitem">' +
      '<span class="lab-tool__mark lab-tool__mark--spool" aria-hidden="true"></span>' +
      '<span class="lab-tool__copy">' +
      '<strong>Fiber Spool</strong>' +
      '<span>Type in properties panel</span>' +
      '</span>' +
      '</button>' +
      '</div>';
    bindToolbox(host);
    if (global.FtthLab && typeof FtthLab.applyFtthLabToolboxIcons === 'function') {
      FtthLab.applyFtthLabToolboxIcons();
    }
  }

  function bindToolbox(host) {
    var btn = host.querySelector('[data-lab-tool="spool"]');
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
        FtthLab.claimToolboxTool('fiber-spool');
      }
      selectedTool = 'spool';
      renderToolbox();
      setStatus('Fiber Spool · drag onto workspace · set type in properties');
    });
    btn.addEventListener('dragstart', function (e) {
      if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
        FtthLab.claimToolboxTool('fiber-spool');
      }
      selectedTool = 'spool';
      dragLib = { kind: 'spool', type: 'full' };
      if (global.FtthLab && typeof FtthLab.beginDrag === 'function') {
        FtthLab.beginDrag({ kind: 'spool', type: 'full' });
      }
      try {
        e.dataTransfer.setData('text/plain', 'lab:spool:full');
        e.dataTransfer.setData('text/lab-drag', 'spool');
        e.dataTransfer.setData('text/lab-spool-type', 'full');
        e.dataTransfer.effectAllowed = 'copy';
      } catch (err) { /* ignore */ }
      btn.classList.add('is-dragging', 'is-selected');
    });
    btn.addEventListener('dragend', function () {
      dragLib = null;
      if (global.FtthLab && typeof FtthLab.endDrag === 'function') FtthLab.endDrag();
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
      if (!el || el.dataset.spoolDrop === '1') return;
      el.dataset.spoolDrop = '1';
      el.addEventListener('dragover', function (e) {
        var active = global.FtthLab && FtthLab.getActiveDrag && FtthLab.getActiveDrag();
        var isSp = !!dragLib || (active && active.kind === 'spool');
        if (!isSp) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      });
      el.addEventListener('drop', function (e) {
        var active = global.FtthLab && FtthLab.getActiveDrag && FtthLab.getActiveDrag();
        var kind = (e.dataTransfer && e.dataTransfer.getData('text/lab-drag')) ||
          (active && active.kind) ||
          (dragLib ? 'spool' : '');
        if (kind !== 'spool') return;
        e.preventDefault();
        e.stopPropagation();
        var type = (e.dataTransfer && e.dataTransfer.getData('text/lab-spool-type')) ||
          (active && active.type) ||
          (dragLib && dragLib.type) ||
          selectedTool ||
          'full';
        var wx = 0;
        var wy = 0;
        if (global.FtthLab && typeof FtthLab.clientToWorld2d === 'function') {
          var pt = FtthLab.clientToWorld2d(e.clientX, e.clientY);
          wx = pt.x;
          wy = pt.y;
        }
        placeSpool(Math.round(wx), Math.round(wy), type);
        dragLib = null;
        if (global.FtthLab && typeof FtthLab.endDrag === 'function') FtthLab.endDrag();
        if (global.FtthLab && typeof FtthLab.clearStageDropHighlight === 'function') {
          FtthLab.clearStageDropHighlight();
        }
      });
    });
  }

  /* ─── Art ─── */

  function spoolSvg(s) {
    var uid = String(s.id || 'x').replace(/[^a-zA-Z0-9_-]/g, '');
    var t = s.type;
    var sz = spoolSizePx(s);
    if (t === 'quarter') return quarterSvg(uid, sz);
    if (t === 'half') return halfSvg(uid, sz);
    return fullSvg(uid, sz);
  }

  function quarterSvg(uid, sz) {
    return (
      '<svg class="lab-spool__art" viewBox="0 0 100 100" width="' + sz + '" height="' + sz +
      '" aria-hidden="true" focusable="false">' +
      '<path d="M92 50 A42 42 0 0 1 50 92 L50 78 A28 28 0 0 0 78 50 Z" ' +
      'fill="#27272a" stroke="#18181b" stroke-width="1.2"/>' +
      '<path d="M90 50 A40 40 0 0 1 50 90" fill="none" stroke="#3f3f46" stroke-width="7" ' +
      'stroke-linecap="round"/>' +
      '<path d="M84 50 A34 34 0 0 1 50 84" fill="none" stroke="#52525b" stroke-width="2.2"/>' +
      '<circle cx="50" cy="50" r="7.5" fill="#18181b" stroke="#71717a" stroke-width="1.4"/>' +
      '<circle cx="50" cy="50" r="2.4" fill="#a1a1aa"/>' +
      '</svg>'
    );
  }

  function halfSvg(uid, sz) {
    return (
      '<svg class="lab-spool__art" viewBox="0 0 100 100" width="' + sz + '" height="' + sz +
      '" aria-hidden="true" focusable="false">' +
      '<path d="M12 50 A38 38 0 0 1 88 50 L82 50 A32 32 0 0 0 18 50 Z" ' +
      'fill="#d4d4d8" stroke="#a1a1aa" stroke-width="1.15"/>' +
      '<rect x="10" y="46" width="10" height="8" rx="2" fill="#e4e4e7" stroke="#a1a1aa"/>' +
      '<rect x="80" y="46" width="10" height="8" rx="2" fill="#e4e4e7" stroke="#a1a1aa"/>' +
      '<path d="M18 50 A32 32 0 0 1 82 50" fill="none" stroke="#a8a29e" stroke-width="5.5" ' +
      'stroke-linecap="round"/>' +
      '<circle cx="50" cy="50" r="7" fill="#e4e4e7" stroke="#71717a" stroke-width="1.3"/>' +
      '<circle cx="50" cy="50" r="2.2" fill="#52525b"/>' +
      '</svg>'
    );
  }

  function fullSvg(uid, sz) {
    return (
      '<svg class="lab-spool__art" viewBox="0 0 100 100" width="' + sz + '" height="' + sz +
      '" aria-hidden="true" focusable="false">' +
      '<circle cx="50" cy="50" r="44" fill="#d6d3d1" stroke="#a8a29e" stroke-width="1.4"/>' +
      '<circle cx="50" cy="50" r="36" fill="none" stroke="#a8a29e" stroke-width="6"/>' +
      '<circle cx="50" cy="50" r="28" fill="none" stroke="#78716c" stroke-width="1.1"/>' +
      '<rect x="46" y="6" width="8" height="12" rx="1.6" fill="#d6d3d1" stroke="#78716c"/>' +
      '<rect x="46" y="82" width="8" height="12" rx="1.6" fill="#d6d3d1" stroke="#78716c"/>' +
      '<rect x="6" y="46" width="12" height="8" rx="1.6" fill="#d6d3d1" stroke="#78716c"/>' +
      '<rect x="82" y="46" width="12" height="8" rx="1.6" fill="#d6d3d1" stroke="#78716c"/>' +
      '<circle cx="50" cy="50" r="8" fill="#e7e5e4" stroke="#78716c" stroke-width="1.35"/>' +
      '<circle cx="50" cy="50" r="2.6" fill="#44403c"/>' +
      '</svg>'
    );
  }

  function spoolMarkup(s) {
    var selected = selection.spoolId === s.id ? ' is-selected' : '';
    var sz = spoolSizePx(s);
    var rot = s.type === 'full' ? 0 : (s.rot || 0);
    var title = typeLabel(s.type) + ' · R ' + s.radiusMm + ' mm';
    return (
      '<div class="lab-spool lab-spool--' + s.type + selected + '" data-spool-node="' + s.id +
      '" style="left:' + Math.round(s.x) + 'px;top:' + Math.round(s.y) +
      'px;width:' + sz + 'px;height:' + sz + 'px" title="' +
      title + '">' +
      '<div class="lab-spool__body" style="transform:rotate(' + rot + 'deg)">' +
      spoolSvg(s) +
      '</div>' +
      '<span class="lab-spool__select-box" aria-hidden="true"></span>' +
      '</div>'
    );
  }

  function ensureLayer() {
    var mount = (ctx && ctx.host2d) || document.getElementById('lab-2d-mount');
    if (!mount) return null;
    if (!layer || !layer.parentNode) {
      layer = document.createElement('div');
      layer.className = 'lab-spool-layer';
      layer.setAttribute('data-lab-spool-layer', '1');
      mount.appendChild(layer);
    }
    return layer;
  }

  function rebuildLayer() {
    var host = ensureLayer();
    if (!host) return;
    var html = '';
    spools.forEach(function (s) { html += spoolMarkup(s); });
    host.innerHTML = html;
    bindLayerEvents(host);
  }

  function bindLayerEvents(host) {
    host.querySelectorAll('[data-spool-node]').forEach(function (node) {
      node.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var id = node.getAttribute('data-spool-node');
        if (!id) return;
        selectSpool(id, { skipRebuild: true });
        if (layer) {
          layer.querySelectorAll('.lab-spool.is-selected').forEach(function (el) {
            if (el !== node) el.classList.remove('is-selected');
          });
        }
        node.classList.add('is-selected');
      });

      node.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        var id = node.getAttribute('data-spool-node');
        var s = findSpool(id);
        if (!s) return;
        selectSpool(id, { skipRebuild: true });
        node.classList.add('is-selected', 'is-dragging');
        var zoom = getZoom() || 1;
        var sx = e.clientX;
        var sy = e.clientY;
        var ox = s.x;
        var oy = s.y;
        var moved = false;
        var queued = false;
        try { node.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }

        function onMove(ev) {
          var dx = (ev.clientX - sx) / zoom;
          var dy = (ev.clientY - sy) / zoom;
          moved = true;
          s.x = Math.round(ox + dx);
          s.y = Math.round(oy + dy);
          node.style.left = s.x + 'px';
          node.style.top = s.y + 'px';
          if (!queued) {
            queued = true;
            requestAnimationFrame(function () {
              queued = false;
              notifySpoolsChanged({ source: 'spool', spoolId: id, live: true, opm: true });
            });
          }
        }
        function onUp(ev) {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          window.removeEventListener('pointercancel', onUp);
          try { node.releasePointerCapture(ev.pointerId); } catch (err2) { /* ignore */ }
          node.classList.remove('is-dragging');
          if (selection.spoolId === id) {
            node.classList.add('is-selected');
            updateInspector();
          }
          if (moved) {
            notifySpoolsChanged({ source: 'spool', spoolId: id, opm: true });
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
    if (selection.kind !== 'spool' || !selection.spoolId) return;
    var s = findSpool(selection.spoolId);
    if (!s) {
      selection = { kind: 'none', spoolId: null };
      return;
    }

    var winds = (global.FtthLab && typeof FtthLab.getSpoolWindStats === 'function')
      ? FtthLab.getSpoolWindStats(s.id)
      : { loopCount: 0, slackM: 0, bendDb: 0 };
    var loops = winds.loopCount || 0;
    var slack = spoolSlackMeters(s, loops);
    var bend = spoolBendLossDb(s, loops);
    var safe = s.radiusMm >= BEND_SAFE_MM;

    card.innerHTML =
      '<h2>Fiber Spool</h2>' +
      '<p>Pin tool · ' + typeLabel(s.type) +
      ' · wind the patch cord by hand (no auto-snap).</p>';

    if (!detail) return;
    detail.hidden = false;
    var rotDisabled = s.type === 'full' ? ' disabled' : '';
    detail.innerHTML =
      '<div class="lab-spool-config">' +
      '<p class="lab-inspector__label">Spool type</p>' +
      '<label class="lab-spool-type-label" for="lab-spool-type-' + s.id + '">Shape</label>' +
      '<select id="lab-spool-type-' + s.id + '" class="lab-spool-type-select" ' +
      'data-spool-type-select="' + s.id + '" aria-label="Spool type">' +
      '<option value="quarter"' + (s.type === 'quarter' ? ' selected' : '') +
      '>Quarter Spool (90°)</option>' +
      '<option value="half"' + (s.type === 'half' ? ' selected' : '') +
      '>Half Spool (180°)</option>' +
      '<option value="full"' + (s.type === 'full' ? ' selected' : '') +
      '>Full Spool (360°)</option>' +
      '</select>' +
      '<p class="lab-inspector__label">Radius R</p>' +
      '<div class="lab-spool-radius">' +
      '<input type="range" min="' + R_MIN + '" max="' + R_MAX + '" step="1" value="' +
      s.radiusMm + '" data-spool-radius="' + s.id + '" aria-label="Bend radius millimetres">' +
      '<strong data-spool-radius-val>' + s.radiusMm + ' mm</strong>' +
      '</div>' +
      '<p class="lab-inspector__label">Rotation</p>' +
      '<div class="lab-spool-rot" role="group" aria-label="Spool rotation">' +
      [0, 90, 180, 270].map(function (d) {
        return (
          '<button type="button" class="lab-pcord-len-preset' +
          (s.rot === d ? ' is-active' : '') + '"' + rotDisabled +
          ' data-spool-rot="' + s.id + ':' + d + '">' + d + '°</button>'
        );
      }).join('') +
      '</div>' +
      '<div class="lab-spl-sheet">' +
      '<div><span>Loops</span><strong>' + loops + '</strong></div>' +
      '<div><span>Slack</span><strong>' + slack.toFixed(3) + ' m</strong></div>' +
      '<div><span>Macro-bend</span><strong>' +
      (safe ? '0.00 dB' : bend.toFixed(2) + ' dB') + '</strong></div>' +
      '</div>' +
      '<p class="lab-spool-hint">' +
      (safe
        ? 'R ≥ 30 mm · cable follows the drum with 0.0 dB macro-bending loss.'
        : 'R < 30 mm · extra macro-bending loss applied to OLP-38 telemetry.') +
      '</p>' +
      '<div class="lab-spool-actions">' +
      '<button type="button" class="lab-pcord-len-mode-btn" data-dup-spool="' + s.id +
      '">Duplicate</button>' +
      '<button type="button" class="lab-eject-btn" data-remove-spool="' + s.id +
      '">Delete</button>' +
      '</div></div>';

    var typeSel = detail.querySelector('[data-spool-type-select]');
    if (typeSel) {
      typeSel.addEventListener('change', function () {
        setSpoolType(s.id, typeSel.value);
      });
    }
    var range = detail.querySelector('[data-spool-radius]');
    var valEl = detail.querySelector('[data-spool-radius-val]');
    if (range) {
      range.addEventListener('input', function () {
        var mm = Number(range.value);
        setSpoolRadius(s.id, mm, { live: true });
        if (valEl) valEl.textContent = clampRadius(mm) + ' mm';
      });
      range.addEventListener('change', function () {
        setSpoolRadius(s.id, range.value);
      });
    }
    detail.querySelectorAll('[data-spool-rot]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.disabled) return;
        var parts = btn.getAttribute('data-spool-rot').split(':');
        setSpoolRot(parts[0], parts[1]);
      });
    });
    var dup = detail.querySelector('[data-dup-spool]');
    if (dup) dup.addEventListener('click', function () { duplicateSpool(s.id); });
    var rm = detail.querySelector('[data-remove-spool]');
    if (rm) {
      rm.addEventListener('click', function () {
        removeSpool(s.id);
        if (global.FtthLab && typeof FtthLab.resetInspectorIdle === 'function') {
          FtthLab.resetInspectorIdle();
        }
      });
    }
  }

  function onViewChange() {
    rebuildLayer();
  }

  function onLayoutChange(payload) {
    if (payload && payload.source === 'spool') return;
  }

  function mount(api) {
    ctx = api || {};
    spools = [];
    seq = 0;
    history = [];
    historyIndex = -1;
    historyLocked = false;
    selection = { kind: 'none', spoolId: null };
    selectedTool = null;
    renderToolbox();
    bindStageDrop();
    ensureLayer();
    rebuildLayer();
    pushHistory();

    if (global.FtthLab) {
      FtthLab.listFiberSpools = listSpools;
      FtthLab.getFiberSpool = findSpool;
      FtthLab.fiberSpoolCenter = function (id) {
        var s = typeof id === 'object' ? id : findSpool(id);
        return s ? spoolCenter(s) : null;
      };
      FtthLab.pickSpoolForWind = pickSpoolForWind;
      FtthLab.spoolBendLossDb = spoolBendLossDb;
      FtthLab.spoolSlackMeters = spoolSlackMeters;
      FtthLab.refreshSpoolInspector = updateInspector;
      FtthLab.SPOOL_FLANGE_MM = FLANGE_MM;
      FtthLab.SPOOL_BEND_SAFE_MM = BEND_SAFE_MM;
    }
  }

  var tool = {
    id: 'fiber-spool',
    mount: mount,
    onViewChange: onViewChange,
    onLayoutChange: onLayoutChange,
    undo: undo,
    redo: redo,
    deleteSelected: deleteSelected,
    clearSelection: clearSelection,
    onToolboxClaim: onToolboxClaim,
    placeSpool: placeSpool,
    updateInspector: updateInspector,
    onLabConfigChanged: function (payload) {
      if (global.FtthLab && typeof FtthLab.handleToolboxConfigChange === 'function') {
        FtthLab.handleToolboxConfigChange('spool', 'lab-spool-tree', renderToolbox, payload && payload.config);
      } else {
        renderToolbox();
      }
      updateInspector();
    },
    exportProjectState: snapshot,
    importProjectState: applySnapshot,
    resetProjectState: function () {
      applySnapshot({ spools: [], seq: 0, selection: { kind: 'none', spoolId: null } });
    },
  };

  function tryRegister() {
    if (global.FtthLab && typeof FtthLab.registerTool === 'function') {
      FtthLab.registerTool('fiber-spool', tool);
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
