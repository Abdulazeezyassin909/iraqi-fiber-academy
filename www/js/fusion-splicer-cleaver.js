/**
 * Fusion Splicer Lab — Fiber cleaver tool registration.
 * Toolbox drag/drop + canvas placement (same pattern as CFS-3 Stripper / SC Coupler).
 */
(function (global) {
  'use strict';

  var HISTORY_MAX = 40;
  var DRAG_THRESHOLD_PX = 3;

  var CLEAVER_W = (global.FiberCleaver && FiberCleaver.BASE_W) || 480;
  var CLEAVER_H = (global.FiberCleaver && FiberCleaver.BASE_H) || 340;
  /** Must match `.lab-cleaver { transform: scale(...) }` in ftth-lab.css */
  var CLEAVER_VISUAL_SCALE = 0.35;
  var CLEAVER_LOCAL_CX = CLEAVER_W / 2;
  var CLEAVER_LOCAL_CY = CLEAVER_H / 2;
  /*
   * V-groove + blade in fiber-cleaver art (480×340 local px).
   * Slider-rail (.slider-rail) = black ruler groove; anvil pads begin at local X 340.
   */
  var RULER_RAIL_LEFT_NAT = -15;
  var RULER_RAIL_WIDTH_NAT = 320;
  /** Right edge of black ruler — jacket stop / clamp pad boundary (art px). */
  var RULER_STOP_NAT_X = RULER_RAIL_LEFT_NAT + RULER_RAIL_WIDTH_NAT;
  var GROOVE_NAT_Y = 142;
  var GROOVE_NAT_X1 = RULER_RAIL_LEFT_NAT;
  /** Bare-glass channel runs ruler stop → anvil (not the silver slider at ~175). */
  var FIBER_ANVIL_NAT_X = 380;
  var BLADE_NAT_X = FIBER_ANVIL_NAT_X;
  var GROOVE_NAT_X2 = BLADE_NAT_X;
  var BLADE_NAT_Y = 142;
  /** Perpendicular tolerance — fiber must overlap groove centerline. */
  var CLEAVE_HIT_PX = 8;
  /** Point-to-line hit radius: blade drop → pigtail polyline. */
  var BLADE_HIT_RADIUS_PX = 20;
  /** Magnetic snap radius for V-groove seating (Phase 1). */
  var CLEAVER_SNAP_PX = 36;
  /** Pull distance before undocking a seated fiber. */
  var CLEAVER_UNDOCK_PX = 18;

  var layer = null;
  var cleavers = [];
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

  function dist2(ax, ay, bx, by) {
    var dx = ax - bx;
    var dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /** Map cleaver art local coords to lab world space (includes CSS scale). */
  function localToWorld(c, localX, localY) {
    return {
      x: c.x + (localX - CLEAVER_LOCAL_CX) * CLEAVER_VISUAL_SCALE,
      y: c.y + (localY - CLEAVER_LOCAL_CY) * CLEAVER_VISUAL_SCALE,
    };
  }

  /** Horizontal V-groove segment in world space. */
  function grooveWorldSegment(c) {
    var a = localToWorld(c, GROOVE_NAT_X1, GROOVE_NAT_Y);
    var b = localToWorld(c, GROOVE_NAT_X2, GROOVE_NAT_Y);
    return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  }

  /** Blade intersection point in world space. */
  function bladeWorldPos(c) {
    return localToWorld(c, BLADE_NAT_X, BLADE_NAT_Y);
  }

  /** Blade drop point where the cartridge meets the V-groove (world space). */
  function bladeDropPoint(c) {
    return bladeWorldPos(c);
  }

  /** World position of the ruler stop wall (jacket may not cross right of this X). */
  function rulerStopWorldPos(c) {
    return localToWorld(c, RULER_STOP_NAT_X, GROOVE_NAT_Y);
  }

  /** Ruler slot + blade geometry for pigtail seating (world space). */
  function getCleaverRulerStopWorld(c) {
    if (!c) return null;
    var grooveY = grooveWorldY(c);
    var slotLeft = localToWorld(c, RULER_RAIL_LEFT_NAT, GROOVE_NAT_Y);
    var rulerStop = rulerStopWorldPos(c);
    var blade = bladeWorldPos(c);
    var groove = grooveWorldSegment(c);
    return {
      cleaverId: c.id,
      id: c.id,
      open: !c.clamped,
      grooveY: grooveY,
      rulerStopX: rulerStop.x,
      rulerStopY: rulerStop.y,
      slotX1: slotLeft.x,
      slotX2: rulerStop.x,
      bladeX: blade.x,
      bladeY: blade.y,
      groove: groove,
      slot: {
        x1: slotLeft.x,
        y1: grooveY,
        x2: rulerStop.x,
        y2: grooveY,
      },
      blade: blade,
      rulerStop: rulerStop,
    };
  }

  /**
   * Exact world Y of the rubber V-groove centerline (horizontal channel).
   * All fiber snap/seat logic must use this value.
   */
  function grooveWorldY(c) {
    return c.y + (GROOVE_NAT_Y - CLEAVER_LOCAL_CY) * CLEAVER_VISUAL_SCALE;
  }

  /** World offset from cleaver center to groove centerline Y. */
  function grooveCenterOffsetY() {
    return (GROOVE_NAT_Y - CLEAVER_LOCAL_CY) * CLEAVER_VISUAL_SCALE;
  }

  /** World offset from cleaver center to blade X. */
  function bladeCenterOffsetX() {
    return (BLADE_NAT_X - CLEAVER_LOCAL_CX) * CLEAVER_VISUAL_SCALE;
  }

  /** Export groove + blade geometry for pigtail snap (Phase 1 API). */
  function getCleaverGrooveWorld(c) {
    if (!c) return null;
    var ruler = getCleaverRulerStopWorld(c);
    if (!ruler) return null;
    return {
      id: c.id,
      open: ruler.open,
      x: c.x,
      y: c.y,
      grooveY: ruler.grooveY,
      groove: ruler.groove,
      slot: ruler.slot,
      rulerStopX: ruler.rulerStopX,
      rulerStopY: ruler.rulerStopY,
      slotX1: ruler.slotX1,
      slotX2: ruler.slotX2,
      blade: ruler.blade,
      bladeX: ruler.bladeX,
      bladeY: ruler.bladeY,
      dockedPigtailId: c.dockedPigtailId || null,
    };
  }

  function listOpenCleaverGrooves() {
    var out = [];
    var i;
    for (i = 0; i < cleavers.length; i++) {
      if (!cleavers[i].clamped) out.push(getCleaverGrooveWorld(cleavers[i]));
    }
    return out;
  }

  /**
   * Find nearest open cleaver groove to a world point (tip or cursor).
   * Returns snap point clamped to groove span.
   */
  function findCleaverGrooveNear(wx, wy, radiusPx) {
    var thr = typeof radiusPx === 'number' ? radiusPx : CLEAVER_SNAP_PX;
    var best = null;
    var bestD = thr + 1;
    var i;
    for (i = 0; i < cleavers.length; i++) {
      var c = cleavers[i];
      if (!c || c.clamped) continue;
      var groove = grooveWorldSegment(c);
      var gx1 = Math.min(groove.x1, groove.x2);
      var gx2 = Math.max(groove.x1, groove.x2);
      var gy = grooveWorldY(c);
      var snapX = Math.max(gx1, Math.min(gx2, wx));
      var d = dist2(wx, wy, snapX, gy);
      if (d <= thr && d < bestD) {
        bestD = d;
        best = {
          cleaverId: c.id,
          groove: groove,
          grooveY: gy,
          blade: bladeWorldPos(c),
          snapX: snapX,
          snapY: gy,
          dist: d,
        };
      }
    }
    return best;
  }

  /**
   * Position cleaver so blade + groove centerline catch the fiber tip.
   * Returns the seated snap point on the groove.
   */
  function alignCleaverBladeToPoint(c, tipX, tipY) {
    if (!c) return null;
    var groove = grooveWorldSegment(c);
    var gx1 = Math.min(groove.x1, groove.x2);
    var gx2 = Math.max(groove.x1, groove.x2);
    var snapX = Math.max(gx1, Math.min(gx2, tipX));
    c.x = Math.round(snapX - bladeCenterOffsetX());
    c.y = Math.round(tipY - grooveCenterOffsetY());
    var gy = grooveWorldY(c);
    return { snapX: snapX, snapY: gy, grooveY: gy };
  }

  function setCleaverDockedPigtail(cleaverId, pigtailId) {
    var c = findCleaver(cleaverId);
    if (!c) return;
    c.dockedPigtailId = pigtailId || null;
  }

  function clearCleaverDockState(c) {
    if (!c) return;
    if (c.dockedPigtailId && global.FtthLab &&
        typeof FtthLab.clearPigtailCleaverSnap === 'function') {
      FtthLab.clearPigtailCleaverSnap(c.dockedPigtailId);
    } else if (c.dockedPigtailId && global.FtthLab &&
        typeof FtthLab.clearPigtailCleaverDock === 'function') {
      FtthLab.clearPigtailCleaverDock(c.dockedPigtailId);
    }
    c.dockedPigtailId = null;
  }

  /** Highlight / clear cleaver dropzone while pigtail is dragged nearby (snap happens on release). */
  function setCleaverDropzoneActive(cleaverId, active) {
    if (!layer) return;
    layer.querySelectorAll('.lab-cleaver.cleaver-dropzone-active').forEach(function (node) {
      node.classList.remove('cleaver-dropzone-active');
    });
    if (!active || !cleaverId) return;
    var node = layer.querySelector('[data-cleaver-node="' + cleaverId + '"]');
    if (node) node.classList.add('cleaver-dropzone-active');
  }

  function clearCleaverDropzones() {
    setCleaverDropzoneActive(null, false);
  }

  /**
   * Point-to-line cleave on clamp — blade drop vs pigtail polyline (no snap required).
   * Arm stays clamped whether or not a fiber is hit.
   */
  function tryPerformCleave(c) {
    if (!c || !global.FtthLab) return false;
    var blade = bladeDropPoint(c);
    var ok = false;
    if (typeof FtthLab.commitPigtailCleaveAtBlade === 'function') {
      ok = FtthLab.commitPigtailCleaveAtBlade(blade.x, blade.y, {
        hitRadius: BLADE_HIT_RADIUS_PX,
        cleaverId: c.id,
      });
    }
    if (!ok && c.dockedPigtailId && typeof FtthLab.commitPigtailCleave === 'function') {
      ok = !!FtthLab.commitPigtailCleave(c.dockedPigtailId, {
        cleaverId: c.id,
        fromCleaverDock: true,
      });
    }
    if (ok) {
      clearCleaverDockState(c);
      setStatus('Fiber Cleaver · cleaved 90°');
    }
    return ok;
  }

  function assemblyMarkup() {
    if (global.FiberCleaver && typeof FiberCleaver.assemblyMarkup === 'function') {
      return FiberCleaver.assemblyMarkup();
    }
    return '<div class="fiber-cleaver" data-cleaver-root="1"></div>';
  }

  function syncCleaverWidget(node, c) {
    var root = node.querySelector('[data-cleaver-root]') || node.querySelector('.fiber-cleaver');
    if (!root || !global.FiberCleaver || typeof FiberCleaver.applyState !== 'function') return;
    FiberCleaver.applyState(root, { clamped: !!(c && c.clamped) });
  }

  function findCleaver(id) {
    for (var i = 0; i < cleavers.length; i++) {
      if (cleavers[i].id === id) return cleavers[i];
    }
    return null;
  }

  function captureSnapshot() {
    return { cleavers: cloneJson(cleavers), seq: seq };
  }

  function applySnapshot(snap) {
    if (!snap) return;
    historyLocked = true;
    cleavers = cloneJson(snap.cleavers) || [];
    cleavers.forEach(function (c) {
      if (!c) return;
      c.dockedPigtailId = c.dockedPigtailId || null;
    });
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
      FtthLab.recordHistory('fiber-cleaver');
    }
  }

  function undo() {
    if (historyIndex <= 0) return false;
    historyIndex -= 1;
    applySnapshot(history[historyIndex]);
    setStatus('Undo · Fiber Cleaver');
    return true;
  }

  function redo() {
    if (historyIndex >= history.length - 1) return false;
    historyIndex += 1;
    applySnapshot(history[historyIndex]);
    setStatus('Redo · Fiber Cleaver');
    return true;
  }

  function ensureLayer() {
    if (layer && layer.parentNode) return layer;
    var mount = document.getElementById('lab-2d-mount');
    if (!mount) return null;
    layer = document.createElement('div');
    layer.className = 'lab-cleaver-layer';
    layer.setAttribute('data-lab-cleaver-layer', '1');
    mount.appendChild(layer);
    return layer;
  }

  function cleaverMarkup(c) {
    var selected = selection.id === c.id ? ' is-selected' : '';
    return (
      '<div class="lab-cleaver' + selected + '" data-cleaver-node="' + c.id + '" ' +
      'style="left:' + Math.round(c.x - CLEAVER_W / 2) + 'px;top:' +
      Math.round(c.y - CLEAVER_H / 2) + 'px;width:' + CLEAVER_W + 'px;height:' + CLEAVER_H + 'px" ' +
      'title="Fiber Cleaver · precision cleave">' +
      '<div class="lab-cleaver__body">' + assemblyMarkup() + '</div>' +
      '<button type="button" class="lab-cleaver__hit" aria-label="Fiber Cleaver"></button>' +
      '</div>'
    );
  }

  function rebuildLayer() {
    var host = ensureLayer();
    if (!host) return;
    var html = '';
    cleavers.forEach(function (c) { html += cleaverMarkup(c); });
    host.innerHTML = html;
    host.querySelectorAll('[data-cleaver-node]').forEach(function (node) {
      var id = node.getAttribute('data-cleaver-node');
      syncCleaverWidget(node, findCleaver(id));
    });
    bindLayerEvents(host);
  }

  function updateCleaverPosition(c, node) {
    if (!node) node = layer && layer.querySelector('[data-cleaver-node="' + c.id + '"]');
    if (!node) return;
    node.style.left = Math.round(c.x - CLEAVER_W / 2) + 'px';
    node.style.top = Math.round(c.y - CLEAVER_H / 2) + 'px';
  }

  function placeCleaver(x, y) {
    seq += 1;
    var item = {
      id: 'clv-' + seq,
      x: typeof x === 'number' ? Math.round(x) : 0,
      y: typeof y === 'number' ? Math.round(y) : 0,
      clamped: false,
      dockedPigtailId: null,
    };
    cleavers.push(item);
    selection = { kind: 'cleaver', id: item.id };
    if (global.FtthLab && typeof FtthLab.setSelectionOwner === 'function') {
      FtthLab.setSelectionOwner('fiber-cleaver');
    }
    rebuildLayer();
    pushHistory();
    updateInspector();
    setStatus('Fiber Cleaver placed · align bare fiber in V-groove');
    return item;
  }

  function removeCleaver(id) {
    if (global.FtthLab && typeof FtthLab.undockPigtailsFromCleaver === 'function') {
      FtthLab.undockPigtailsFromCleaver(id);
    }
    cleavers = cleavers.filter(function (c) { return c.id !== id; });
    if (selection.id === id) selection = { kind: 'none', id: null };
    rebuildLayer();
    updateInspector();
    pushHistory();
    setStatus('Fiber Cleaver removed');
  }

  function selectCleaver(id, opts) {
    selection = { kind: 'cleaver', id: id };
    if (global.FtthLab && typeof FtthLab.setSelectionOwner === 'function') {
      FtthLab.setSelectionOwner('fiber-cleaver');
    }
    updateInspector();
    if (!(opts && opts.skipRebuild)) rebuildLayer();
  }

  function isClientOnCleaverHit(node, clientX, clientY) {
    if (!node) return false;
    var hit = node.querySelector('.lab-cleaver__hit');
    if (!hit) return false;
    var r = hit.getBoundingClientRect();
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  }

  function startCleaverDrag(e, c, node) {
    var zoom = getZoom() || 1;
    var sx = e.clientX;
    var sy = e.clientY;
    var ox = c.x;
    var oy = c.y;
    var moved = false;
    node.classList.add('is-dragging');
    document.body.classList.add('lab-cleaver-dragging');
    try { node.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }

    function onMove(ev) {
      var dx = (ev.clientX - sx) / zoom;
      var dy = (ev.clientY - sy) / zoom;
      if (!moved && (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX)) {
        moved = true;
      }
      c.x = Math.round(ox + dx);
      c.y = Math.round(oy + dy);
      updateCleaverPosition(c, node);
      if (c.dockedPigtailId && global.FtthLab &&
          typeof FtthLab.refreshPigtailCleaverSlot === 'function') {
        FtthLab.refreshPigtailCleaverSlot(c.dockedPigtailId, c.id);
      }
    }

    function onUp(ev) {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      try { node.releasePointerCapture(ev.pointerId); } catch (err2) { /* ignore */ }
      node.classList.remove('is-dragging');
      document.body.classList.remove('lab-cleaver-dragging');
      if (selection.id === c.id) node.classList.add('is-selected');
      if (!moved) {
        var root = node.querySelector('[data-cleaver-root]') || node.querySelector('.fiber-cleaver');
        if (root && global.FiberCleaver && typeof FiberCleaver.toggleClamp === 'function') {
          var wasOpen = !c.clamped;
          c.clamped = FiberCleaver.toggleClamp(root);
          syncCleaverWidget(node, c);
          if (c.clamped && wasOpen) {
            if (!tryPerformCleave(c)) {
              setStatus('Fiber Cleaver clamped');
            }
          } else {
            setStatus(c.clamped ? 'Fiber Cleaver clamped' : 'Fiber Cleaver open');
          }
          pushHistory();
        }
      } else {
        if (c.dockedPigtailId && global.FtthLab &&
            typeof FtthLab.finalizePigtailCleaverDock === 'function') {
          FtthLab.finalizePigtailCleaverDock(c.dockedPigtailId);
        } else if (global.FtthLab && typeof FtthLab.clearCleaverGuideLine === 'function') {
          FtthLab.clearCleaverGuideLine();
        }
        pushHistory();
      }
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  function bindLayerEvents(host) {
    host.querySelectorAll('[data-cleaver-node]').forEach(function (node) {
      var hit = node.querySelector('.lab-cleaver__hit') || node;

      hit.addEventListener('click', function (e) {
        if (!isClientOnCleaverHit(node, e.clientX, e.clientY)) return;
        e.stopPropagation();
        selectCleaver(node.getAttribute('data-cleaver-node'), { skipRebuild: true });
        host.querySelectorAll('.lab-cleaver.is-selected').forEach(function (el) {
          if (el !== node) el.classList.remove('is-selected');
        });
        node.classList.add('is-selected');
      });

      hit.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        if (!isClientOnCleaverHit(node, e.clientX, e.clientY)) return;
        e.preventDefault();
        e.stopPropagation();
        var id = node.getAttribute('data-cleaver-node');
        var c = findCleaver(id);
        if (!c) return;
        selectCleaver(id, { skipRebuild: true });
        host.querySelectorAll('.lab-cleaver.is-selected').forEach(function (el) {
          if (el !== node) el.classList.remove('is-selected');
        });
        node.classList.add('is-selected');
        startCleaverDrag(e, c, node);
      });
    });
  }

  function updateInspector() {
    var card = document.getElementById('lab-inspector-card');
    var detail = document.getElementById('lab-inspector-detail');
    if (!card) return;
    if (selection.kind !== 'cleaver' || !selection.id) return;

    var c = findCleaver(selection.id);
    if (!c) {
      selection = { kind: 'none', id: null };
      return;
    }

    card.innerHTML =
      '<h2>Fiber Cleaver</h2>' +
      '<p>Precision cleaver · seat bare fiber in the V-groove channel.</p>';

    if (!detail) return;
    detail.hidden = false;
    detail.innerHTML =
      '<div class="lab-cleaver-config">' +
      '<p class="lab-inspector__label">Position</p>' +
      '<p class="lab-pcord-attach">X ' + c.x + ' · Y ' + c.y + '</p>' +
      '<p class="lab-pcord-attach">Arm · ' + (c.clamped ? 'CLAMPED' : 'OPEN') + '</p>' +
      '<button type="button" class="lab-eject-btn" data-remove-cleaver="' + c.id +
      '">Remove Cleaver</button>' +
      '</div>';

    var rm = detail.querySelector('[data-remove-cleaver]');
    if (rm) {
      rm.addEventListener('click', function () {
        removeCleaver(c.id);
      });
    }
  }

  function renderToolbox() {
    var host = global.FtthLab && typeof FtthLab.gateToolboxRender === 'function'
      ? FtthLab.gateToolboxRender('lab-cleaver-tree', 'fiber-cleaver')
      : document.getElementById('lab-cleaver-tree');
    if (!host) return;
    host.innerHTML =
      '<div class="lab-toolbox" role="list">' +
      '<div class="tool-item lab-tool lab-tool--cleaver' +
      (selectedTool === 'cleaver' ? ' is-selected' : '') +
      '" data-tool="cleaver" data-lab-tool="fiber-cleaver" draggable="true" ' +
      'role="listitem" tabindex="0" title="Fiber Cleaver">' +
      '<span class="lab-tool__mark lab-tool__mark--cleaver" aria-hidden="true"></span>' +
      '<span class="lab-tool__copy">' +
      '<strong>Fiber Cleaver</strong>' +
      '<span>Precision cleave · V-groove</span>' +
      '</span>' +
      '</div>' +
      '</div>';
    bindToolbox(host);
    if (global.FtthLab && typeof FtthLab.applyFtthLabToolboxIcons === 'function') {
      FtthLab.applyFtthLabToolboxIcons();
    }
  }

  function bindToolbox(host) {
    var btn = host.querySelector('[data-tool="cleaver"]');
    if (!btn) return;

    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
        FtthLab.claimToolboxTool('fiber-cleaver');
      }
      selectedTool = 'cleaver';
      renderToolbox();
      setStatus('Fiber Cleaver · drag onto workspace');
    });

    btn.addEventListener('dragstart', function (ev) {
      if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
        FtthLab.claimToolboxTool('fiber-cleaver');
      }
      selectedTool = 'cleaver';
      dragLib = { kind: 'cleaver' };
      if (global.FtthLab && FtthLab.beginDrag) FtthLab.beginDrag({ kind: 'cleaver' });
      try {
        ev.dataTransfer.setData('text/plain', 'lab:cleaver');
        ev.dataTransfer.setData('text/lab-drag', 'cleaver');
        ev.dataTransfer.effectAllowed = 'copy';
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
      if (!el || el.dataset.cleaverDrop === '1') return;
      el.dataset.cleaverDrop = '1';

      el.addEventListener('dragover', function (ev) {
        var active = global.FtthLab && FtthLab.getActiveDrag && FtthLab.getActiveDrag();
        if (!((dragLib && dragLib.kind === 'cleaver') || (active && active.kind === 'cleaver'))) {
          return;
        }
        ev.preventDefault();
        if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
      });

      el.addEventListener('drop', function (ev) {
        var active = global.FtthLab && FtthLab.getActiveDrag && FtthLab.getActiveDrag();
        var kind =
          (ev.dataTransfer && ev.dataTransfer.getData('text/lab-drag')) ||
          (active && active.kind) ||
          (dragLib && dragLib.kind) ||
          '';
        if (kind !== 'cleaver') return;
        ev.preventDefault();
        ev.stopPropagation();
        dragLib = null;
        if (global.FtthLab && FtthLab.endDrag) FtthLab.endDrag();
        var pt = clientToWorld(ev.clientX, ev.clientY);
        placeCleaver(Math.round(pt.x), Math.round(pt.y));
        selectedTool = null;
        renderToolbox();
      });

      el.addEventListener('click', function (ev) {
        if (selectedTool !== 'cleaver') return;
        var active = global.FtthLab && FtthLab.getActiveToolboxTool && FtthLab.getActiveToolboxTool();
        if (active !== 'fiber-cleaver') return;
        if (!isStagePlacementTarget(ev.target)) return;
        ev.stopPropagation();
        var pt = clientToWorld(ev.clientX, ev.clientY);
        placeCleaver(Math.round(pt.x), Math.round(pt.y));
        selectedTool = null;
        renderToolbox();
      }, true);
    });
  }

  function deleteSelected() {
    if (selection.kind === 'cleaver' && selection.id) {
      removeCleaver(selection.id);
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
    if (id === 'fiber-cleaver') return;
    selectedTool = null;
    renderToolbox();
  }

  function mount() {
    renderToolbox();
    bindStageDrop();
    ensureLayer();
    rebuildLayer();
    pushHistory();
    registerCleaverApis();
    liftPigtailLayerAboveCleaver();
  }

  function liftPigtailLayerAboveCleaver() {
    var mount = document.getElementById('lab-2d-mount');
    if (!mount) return;
    var pigLayer = mount.querySelector('[data-lab-pigtail-layer]');
    if (pigLayer) mount.appendChild(pigLayer);
  }

  function registerCleaverApis() {
    if (!global.FtthLab) return;
    FtthLab.getCleaverGrooveWorld = function (id) {
      return getCleaverGrooveWorld(findCleaver(id));
    };
    FtthLab.getCleaverRulerStopWorld = function (id) {
      return getCleaverRulerStopWorld(findCleaver(id));
    };
    FtthLab.getCleaverGrooveY = function (id) {
      var c = findCleaver(id);
      return c ? grooveWorldY(c) : null;
    };
    FtthLab.listOpenCleaverGrooves = listOpenCleaverGrooves;
    FtthLab.findCleaverGrooveNear = findCleaverGrooveNear;
    FtthLab.alignCleaverToFiberTip = function (cleaverId, tipX, tipY) {
      var c = findCleaver(cleaverId);
      if (!c || c.clamped) return null;
      var snap = alignCleaverBladeToPoint(c, tipX, tipY);
      var node = layer && layer.querySelector('[data-cleaver-node="' + cleaverId + '"]');
      updateCleaverPosition(c, node);
      return snap;
    };
    FtthLab.setCleaverDockedPigtail = setCleaverDockedPigtail;
    FtthLab.setCleaverDropzoneActive = setCleaverDropzoneActive;
    FtthLab.clearCleaverDropzones = clearCleaverDropzones;
    FtthLab.cleaverSnapRadiusPx = function () {
      return CLEAVER_SNAP_PX;
    };
  }

  var tool = {
    id: 'fiber-cleaver',
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
      applySnapshot({ cleavers: [], seq: 0 });
    },
  };

  function tryRegister() {
    if (global.FtthLab && typeof FtthLab.registerTool === 'function') {
      FtthLab.registerTool('fiber-cleaver', tool);
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
