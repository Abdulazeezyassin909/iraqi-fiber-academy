/**
 * Macro-Bend Tester — two-segment fiber channel (fixed base + articulated arm).
 * Patch cords snap through the slot; θ drives live macro-bend loss on the OPM path.
 */
(function (global) {
  'use strict';

  var JIG_W = 168;
  var JIG_H = 112;
  var PIVOT_X = 84;
  var PIVOT_Y = 56;
  var ARM_LEN = 62;
  var BEND_K = 32; /* quadratic k so θ=90° ≈ 2.0 dB */
  var HISTORY_MAX = 60;

  var ctx = null;
  var layer = null;
  var jigs = [];
  var seq = 0;
  var selection = { kind: 'none', jigId: null };
  var dragLib = null;
  var selectedTool = null;
  var history = [];
  var historyIndex = -1;
  var historyLocked = false;

  function setStatus(msg) {
    if (global.FtthLab && FtthLab.setStatus) FtthLab.setStatus(msg);
  }

  function getWorldSize() {
    return (global.FtthLab && FtthLab.getWorldSize) ? FtthLab.getWorldSize() : 20000;
  }

  function getZoom() {
    return (global.FtthLab && FtthLab.getZoom2d) ? FtthLab.getZoom2d() : 1;
  }

  function clientToWorld(clientX, clientY) {
    if (global.FtthLab && typeof FtthLab.clientToWorld2d === 'function') {
      return FtthLab.clientToWorld2d(clientX, clientY);
    }
    return { x: 0, y: 0 };
  }

  function clampTheta(deg) {
    var n = Number(deg);
    if (!isFinite(n)) return 180;
    if (n < 0) n = 0;
    if (n > 180) n = 180;
    return Math.round(n);
  }

  /**
   * ΔLoss (dB) = (θ < 120°) ? k·((120−θ)/120)² : 0
   * θ < 90° adds a severe kink floor (≥15 dB, isolating near 0°).
   */
  function macroBendLossDb(thetaDeg) {
    var th = clampTheta(thetaDeg);
    if (th >= 120) return 0;
    var quad = BEND_K * Math.pow((120 - th) / 120, 2);
    if (th < 90) {
      var kink = 15 + 45 * Math.pow((90 - th) / 90, 2);
      return Math.round(Math.min(80, Math.max(quad, kink)) * 100) / 100;
    }
    return Math.round(quad * 100) / 100;
  }

  function findJig(id) {
    for (var i = 0; i < jigs.length; i++) {
      if (jigs[i].id === id) return jigs[i];
    }
    return null;
  }

  function pivotWorld(j) {
    return { x: j.x + PIVOT_X, y: j.y + PIVOT_Y };
  }

  function arm2AngleRad(theta) {
    return ((180 - clampTheta(theta)) * Math.PI) / 180;
  }

  function slotGeometry(j) {
    var p = pivotWorld(j);
    var a = arm2AngleRad(j.theta);
    var p1 = { x: p.x - ARM_LEN, y: p.y };
    var p2 = { x: p.x + ARM_LEN * Math.cos(a), y: p.y + ARM_LEN * Math.sin(a) };
    return {
      id: j.id,
      theta: clampTheta(j.theta),
      lossDb: macroBendLossDb(j.theta),
      p1: p1,
      pivot: p,
      p2: p2,
      entryPoint: p1,
      exitPoint: p2,
      isCableDocked: !!j.isCableDocked,
      dockedCordId: j.dockedCordId || null,
    };
  }

  function listSlots() {
    return jigs.map(slotGeometry);
  }

  function snapshot() {
    return JSON.parse(JSON.stringify({
      jigs: jigs,
      seq: seq,
      selection: selection,
    }));
  }

  function applySnapshot(snap) {
    if (!snap) return;
    historyLocked = true;
    jigs = snap.jigs || [];
    jigs.forEach(function (j) {
      if (typeof j.isCableDocked !== 'boolean') j.isCableDocked = false;
      if (!j.dockedCordId) j.dockedCordId = null;
    });
    seq = snap.seq || 0;
    selection = snap.selection || { kind: 'none', jigId: null };
    rebuildLayer();
    updateInspector();
    historyLocked = false;
    notifyJigs();
  }

  function pushHistory() {
    if (historyLocked) return;
    history = history.slice(0, historyIndex + 1);
    history.push(snapshot());
    if (history.length > HISTORY_MAX) history.shift();
    historyIndex = history.length - 1;
    if (global.FtthLab && typeof FtthLab.recordHistory === 'function') {
      FtthLab.recordHistory('bend-jig');
    }
  }

  function undo() {
    if (historyIndex <= 0) return false;
    historyIndex -= 1;
    applySnapshot(history[historyIndex]);
    setStatus('Undo · Macro-Bend Tester');
    return true;
  }

  function redo() {
    if (historyIndex >= history.length - 1) return false;
    historyIndex += 1;
    applySnapshot(history[historyIndex]);
    setStatus('Redo · Macro-Bend Tester');
    return true;
  }

  function notifyJigs(payload) {
    if (global.FtthLab && typeof FtthLab.notifyLayoutChange === 'function') {
      FtthLab.notifyLayoutChange(payload || { source: 'bend-jig', opm: true });
    }
  }

  function defaultPos() {
    var w = getWorldSize();
    return {
      x: Math.round(w / 2 + 40 + jigs.length * 28),
      y: Math.round(w / 2 + 80 + (jigs.length % 3) * 36),
    };
  }

  function placeJig(x, y) {
    seq += 1;
    var pos = (typeof x === 'number' && typeof y === 'number')
      ? { x: x, y: y }
      : defaultPos();
    var j = {
      id: 'jig-' + seq,
      x: Math.round(pos.x - JIG_W / 2),
      y: Math.round(pos.y - JIG_H / 2),
      theta: 180,
      isCableDocked: false,
      dockedCordId: null,
    };
    jigs.push(j);
    selectJig(j.id);
    rebuildLayer();
    pushHistory();
    notifyJigs({ source: 'bend-jig', jigId: j.id, opm: true });
    setStatus('Macro-Bend Tester placed · route a patch cord through the slot · set θ in properties');
    return j;
  }

  function setCableDocked(jigId, cordId, docked) {
    var j = findJig(jigId);
    if (!j) return false;
    var next = !!docked;
    var nextId = next ? (cordId || j.dockedCordId || null) : null;
    if (j.isCableDocked === next && j.dockedCordId === nextId) return false;
    j.isCableDocked = next;
    j.dockedCordId = nextId;
    if (layer) {
      var node = layer.querySelector('[data-jig-node="' + j.id + '"]');
      if (node) {
        node.title = 'Macro-Bend Tester · θ ' + clampTheta(j.theta) + '°';
      }
    }
    if (selection.jigId === j.id) updateInspector();
    return true;
  }

  function releaseDockedCable(jigId) {
    var j = findJig(jigId);
    if (!j) return;
    var cordId = j.dockedCordId;
    setCableDocked(jigId, null, false);
    if (global.FtthLab && typeof FtthLab.releasePatchCordFromBendJig === 'function') {
      FtthLab.releasePatchCordFromBendJig(cordId || null, jigId);
    }
    notifyJigs({ source: 'bend-jig', jigId: jigId, opm: true });
    setStatus('Macro-Bend Tester · cable released');
  }

  function removeJig(id) {
    var j = findJig(id);
    if (j && j.isCableDocked && global.FtthLab &&
        typeof FtthLab.releasePatchCordFromBendJig === 'function') {
      FtthLab.releasePatchCordFromBendJig(j.dockedCordId || null, id);
    }
    jigs = jigs.filter(function (item) { return item.id !== id; });
    if (selection.jigId === id) selection = { kind: 'none', jigId: null };
    rebuildLayer();
    updateInspector();
    pushHistory();
    notifyJigs({ source: 'bend-jig', opm: true });
    setStatus('Macro-Bend Tester removed');
  }

  function setBendAngle(id, deg, opts) {
    var j = findJig(id);
    if (!j) return;
    var next = clampTheta(deg);
    if (j.theta === next && !(opts && opts.live)) return;
    j.theta = next;
    var live = opts && opts.live;
    if (live) {
      updateArmDom(j);
      updateInspectorLive(j);
    } else {
      rebuildLayer();
      updateInspector();
      pushHistory();
    }
    notifyJigs({ source: 'bend-jig', jigId: id, live: !!live, opm: true });
    if (!live) setStatus('Bending angle θ = ' + j.theta + '° · loss ' + macroBendLossDb(j.theta).toFixed(2) + ' dB');
  }

  function updateArmDom(j) {
    if (!layer) return;
    var node = layer.querySelector('[data-jig-node="' + j.id + '"]');
    if (!node) return;
    var arm = node.querySelector('.lab-jig__arm-dyn');
    if (arm) arm.setAttribute('transform', 'rotate(' + (180 - clampTheta(j.theta)) + ' 84 56)');
    var badge = node.querySelector('.lab-jig__theta');
    if (badge) badge.textContent = clampTheta(j.theta) + '°';
  }

  function selectJig(id, opts) {
    selection = { kind: 'jig', jigId: id };
    if (global.FtthLab && typeof FtthLab.setSelectionOwner === 'function') {
      FtthLab.setSelectionOwner('bend-jig');
    }
    updateInspector();
    if (!(opts && opts.skipRebuild)) rebuildLayer();
  }

  function clearSelection() {
    var had = selection.kind === 'jig';
    selection = { kind: 'none', jigId: null };
    selectedTool = null;
    renderToolbox();
    if (had) rebuildLayer();
  }

  function deleteSelected() {
    if (selection.kind === 'jig' && selection.jigId) {
      removeJig(selection.jigId);
      return true;
    }
    return false;
  }

  function onToolboxClaim(payload) {
    var id = payload && payload.toolId;
    if (id === 'bend-jig') return;
    if (selectedTool) {
      selectedTool = null;
      renderToolbox();
    }
  }

  function renderToolbox() {
    var host = global.FtthLab && typeof FtthLab.gateToolboxRender === 'function'
      ? FtthLab.gateToolboxRender('lab-bendjig-tree', 'jig')
      : document.getElementById('lab-bendjig-tree');
    if (!host) return;
    host.innerHTML =
      '<div class="lab-toolbox" role="list">' +
      '<button type="button" class="lab-tool lab-tool--jig' +
      (selectedTool === 'jig' ? ' is-selected' : '') +
      '" draggable="true" data-lab-tool="jig" role="listitem">' +
      '<span class="lab-tool__mark lab-tool__mark--jig" aria-hidden="true"></span>' +
      '<span class="lab-tool__copy">' +
      '<strong>Macro-Bend Tester</strong>' +
      '<span>Articulated slot · 0–180°</span>' +
      '</span>' +
      '</button>' +
      '</div>';
    bindToolbox(host);
    if (global.FtthLab && typeof FtthLab.applyFtthLabToolboxIcons === 'function') {
      FtthLab.applyFtthLabToolboxIcons();
    }
  }

  function bindToolbox(host) {
    var btn = host.querySelector('[data-lab-tool="jig"]');
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
        FtthLab.claimToolboxTool('bend-jig');
      }
      selectedTool = 'jig';
      renderToolbox();
      setStatus('Macro-Bend Tester · drag onto workspace · snap a patch cord through the slot');
    });
    btn.addEventListener('dragstart', function (e) {
      if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
        FtthLab.claimToolboxTool('bend-jig');
      }
      selectedTool = 'jig';
      dragLib = { kind: 'jig' };
      if (global.FtthLab && typeof FtthLab.beginDrag === 'function') {
        FtthLab.beginDrag({ kind: 'jig' });
      }
      try {
        e.dataTransfer.setData('text/plain', 'lab:jig');
        e.dataTransfer.setData('text/lab-drag', 'jig');
        e.dataTransfer.effectAllowed = 'copy';
      } catch (err) { /* ignore */ }
      btn.classList.add('is-dragging', 'is-selected');
    });
    btn.addEventListener('dragend', function () {
      dragLib = null;
      if (global.FtthLab && typeof FtthLab.endDrag === 'function') FtthLab.endDrag();
      btn.classList.remove('is-dragging');
      renderToolbox();
    });
  }

  function bindStageDrop() {
    var stage = document.getElementById('lab-canvas-2d');
    var mount = document.getElementById('lab-2d-mount');
    var world = document.getElementById('lab-2d-world');
    [stage, mount, world].forEach(function (el) {
      if (!el || el.dataset.jigDrop === '1') return;
      el.dataset.jigDrop = '1';
      el.addEventListener('dragover', function (e) {
        var active = global.FtthLab && FtthLab.getActiveDrag && FtthLab.getActiveDrag();
        if (!dragLib && !(active && active.kind === 'jig')) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      });
      el.addEventListener('drop', function (e) {
        var active = global.FtthLab && FtthLab.getActiveDrag && FtthLab.getActiveDrag();
        var kind = (e.dataTransfer && e.dataTransfer.getData('text/lab-drag')) ||
          (dragLib ? 'jig' : '') ||
          (active && active.kind) || '';
        if (kind !== 'jig') return;
        e.preventDefault();
        e.stopPropagation();
        var pt = clientToWorld(e.clientX, e.clientY);
        placeJig(pt.x, pt.y);
        dragLib = null;
        if (global.FtthLab && FtthLab.endDrag) FtthLab.endDrag();
      });
    });
  }

  function ensureLayer() {
    if (layer && layer.parentNode) return layer;
    var mount = document.getElementById('lab-2d-mount');
    if (!mount) return null;
    layer = document.createElement('div');
    layer.className = 'lab-jig-layer';
    layer.setAttribute('data-lab-jig-layer', '1');
    mount.appendChild(layer);
    return layer;
  }

  function jigSvg(j) {
    var th = clampTheta(j.theta);
    var rot = 180 - th;
    return (
      '<svg class="lab-jig__art" viewBox="0 0 168 112" width="' + JIG_W + '" height="' + JIG_H +
      '" aria-hidden="true" focusable="false">' +
      '<rect x="10" y="28" width="148" height="56" rx="5" fill="#1a2332" stroke="#3d4b5c" stroke-width="1"/>' +
      '<rect x="14" y="32" width="140" height="48" rx="3" fill="#151c27" stroke="#2a3544" stroke-width="0.75"/>' +
      '<g class="lab-jig__arm-fix">' +
      '<rect x="18" y="50" width="66" height="12" rx="2" fill="#2b3645" stroke="#4b5a6c" stroke-width="0.9"/>' +
      '<rect x="22" y="53.6" width="58" height="4.8" rx="1.2" fill="#0b1018"/>' +
      '<line x1="26" y1="56" x2="76" y2="56" stroke="#3a4656" stroke-width="0.6"/>' +
      '</g>' +
      '<g class="lab-jig__arm-dyn" transform="rotate(' + rot + ' 84 56)">' +
      '<rect x="84" y="50" width="66" height="12" rx="2" fill="#323d4c" stroke="#5b6a7c" stroke-width="0.9"/>' +
      '<rect x="88" y="53.6" width="58" height="4.8" rx="1.2" fill="#0b1018"/>' +
      '<line x1="92" y1="56" x2="142" y2="56" stroke="#3a4656" stroke-width="0.6"/>' +
      '<circle class="lab-jig__knob" cx="146" cy="56" r="6" fill="#3e4a59" stroke="#6b7a8c" stroke-width="1"/>' +
      '<circle cx="146" cy="56" r="2" fill="#1a222c"/>' +
      '</g>' +
      '<circle cx="84" cy="56" r="8.5" fill="#3a4654" stroke="#6a7888" stroke-width="1"/>' +
      '<circle cx="84" cy="56" r="3" fill="#0d131c"/>' +
      '</svg>' +
      '<span class="lab-jig__theta">' + th + '°</span>'
    );
  }

  function jigMarkup(j) {
    var selected = selection.jigId === j.id ? ' is-selected' : '';
    return (
      '<div class="lab-jig' + selected + '" data-jig-node="' + j.id + '" ' +
      'style="left:' + Math.round(j.x) + 'px;top:' + Math.round(j.y) + 'px" ' +
      'title="Macro-Bend Tester · θ ' + clampTheta(j.theta) + '°">' +
      jigSvg(j) +
      '</div>'
    );
  }

  function rebuildLayer() {
    var host = ensureLayer();
    if (!host) return;
    var html = '';
    jigs.forEach(function (j) { html += jigMarkup(j); });
    host.innerHTML = html;
    bindLayerEvents(host);
  }

  function bindLayerEvents(host) {
    host.querySelectorAll('[data-jig-node]').forEach(function (node) {
      node.addEventListener('click', function (e) {
        if (e.target.closest('.lab-jig__arm-dyn')) return;
        e.stopPropagation();
        selectJig(node.getAttribute('data-jig-node'), { skipRebuild: true });
        host.querySelectorAll('.lab-jig.is-selected').forEach(function (el) {
          el.classList.remove('is-selected');
        });
        node.classList.add('is-selected');
      });
      node.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        if (e.target.closest('.lab-jig__arm-dyn')) return;
        var id = node.getAttribute('data-jig-node');
        var j = findJig(id);
        if (!j) return;
        e.preventDefault();
        e.stopPropagation();
        selectJig(id, { skipRebuild: true });
        node.classList.add('is-dragging');
        var start = clientToWorld(e.clientX, e.clientY);
        var ox = start.x - j.x;
        var oy = start.y - j.y;
        function onMove(ev) {
          var pt = clientToWorld(ev.clientX, ev.clientY);
          j.x = Math.round(pt.x - ox);
          j.y = Math.round(pt.y - oy);
          node.style.left = j.x + 'px';
          node.style.top = j.y + 'px';
          notifyJigs({ source: 'bend-jig', jigId: id, live: true, opm: true });
        }
        function onUp() {
          node.classList.remove('is-dragging');
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          pushHistory();
          notifyJigs({ source: 'bend-jig', jigId: id, opm: true });
        }
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });

      var arm = node.querySelector('.lab-jig__arm-dyn');
      if (arm) {
        arm.addEventListener('pointerdown', function (e) {
          if (e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          var id = node.getAttribute('data-jig-node');
          var j = findJig(id);
          if (!j) return;
          selectJig(id, { skipRebuild: true });
          function onMove(ev) {
            var pt = clientToWorld(ev.clientX, ev.clientY);
            var p = pivotWorld(j);
            var ang = Math.atan2(pt.y - p.y, pt.x - p.x) * 180 / Math.PI;
            if (ang < 0) ang += 360;
            var phi = ang > 180 ? 360 - ang : ang;
            setBendAngle(id, 180 - phi, { live: true });
          }
          function onUp() {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            setBendAngle(id, j.theta);
          }
          window.addEventListener('pointermove', onMove);
          window.addEventListener('pointerup', onUp);
        });
      }
    });
  }

  function lossBandLabel(th) {
    if (th >= 180) return 'Straight · 0 dB';
    if (th >= 90) return 'Moderate macro-bend';
    return 'Sharp kink · severe loss';
  }

  function updateInspectorLive(j) {
    var ang = document.getElementById('lab-jig-angle-val');
    var loss = document.getElementById('lab-jig-loss-val');
    var band = document.getElementById('lab-jig-band');
    var slider = document.getElementById('lab-jig-angle');
    var num = document.getElementById('lab-jig-angle-num');
    var th = clampTheta(j.theta);
    var db = macroBendLossDb(th);
    if (ang) ang.textContent = th + '°';
    if (loss) loss.textContent = db.toFixed(2) + ' dB';
    if (band) band.textContent = lossBandLabel(th);
    if (slider && Number(slider.value) !== th) slider.value = String(th);
    if (num && Number(num.value) !== th) num.value = String(th);
  }

  function updateInspector() {
    var card = document.getElementById('lab-inspector-card');
    var detail = document.getElementById('lab-inspector-detail');
    if (!card) return;
    if (selection.kind !== 'jig' || !selection.jigId) return;
    var j = findJig(selection.jigId);
    if (!j) {
      selection = { kind: 'none', jigId: null };
      return;
    }
    var th = clampTheta(j.theta);
    var db = macroBendLossDb(th);
    var meta = (global.FtthLab && FtthLab.getToolMeta && FtthLab.getToolMeta('jig')) || {};
    card.innerHTML =
      '<h2>' + (meta.label || 'Macro-Bend Tester') + '</h2>' +
      '<p>' + (meta.guideText || 'Fixed base guide + articulated arm. Snap a patch cord through the slot, then set θ.') + '</p>';
    if (!detail) return;
    detail.hidden = false;
    detail.innerHTML =
      '<div class="lab-jig-config">' +
      '<p class="lab-inspector__label">Bending Angle (°)</p>' +
      '<div class="lab-spool-radius">' +
      '<input id="lab-jig-angle" type="range" min="0" max="180" step="1" value="' + th + '">' +
      '<strong id="lab-jig-angle-val">' + th + '°</strong>' +
      '</div>' +
      '<label class="lab-spool-type-label" for="lab-jig-angle-num">θ</label>' +
      '<input id="lab-jig-angle-num" class="lab-spool-type-select" type="number" min="0" max="180" step="1" value="' + th + '">' +
      '<div class="lab-spl-sheet">' +
      '<div><span>Cable</span><strong>' + (j.isCableDocked ? 'Docked' : 'Open') + '</strong></div>' +
      '<div><span>Macro-bend ΔLoss</span><strong id="lab-jig-loss-val">' + db.toFixed(2) + ' dB</strong></div>' +
      '<div><span>Regime</span><strong id="lab-jig-band">' + lossBandLabel(th) + '</strong></div>' +
      '<div><span>Slot</span><strong>Entry → pivot → Exit</strong></div>' +
      '</div>' +
      '<p class="lab-spool-hint">180° straight = 0 dB. Below 120° quadratic loss. Below 90° is a sharp kink (≥15 dB). Docked cables stay locked until you press Remove Cable.</p>' +
      '<button type="button" class="lab-eject-btn lab-eject-btn--secondary" data-undock-jig="' +
      j.id + '"' + (j.isCableDocked ? '' : ' disabled') + '>Remove Cable</button>' +
      '<button type="button" class="lab-eject-btn" data-remove-jig="' + j.id + '">Remove Tester</button>' +
      '</div>';

    var slider = detail.querySelector('#lab-jig-angle');
    var num = detail.querySelector('#lab-jig-angle-num');
    if (slider) {
      slider.addEventListener('input', function () {
        setBendAngle(j.id, slider.value, { live: true });
        if (num) num.value = slider.value;
      });
      slider.addEventListener('change', function () {
        setBendAngle(j.id, slider.value);
      });
    }
    if (num) {
      num.addEventListener('change', function () {
        setBendAngle(j.id, num.value);
      });
    }
    var undock = detail.querySelector('[data-undock-jig]');
    if (undock) {
      undock.addEventListener('click', function () {
        releaseDockedCable(j.id);
        pushHistory();
      });
    }
    var rm = detail.querySelector('[data-remove-jig]');
    if (rm) {
      rm.addEventListener('click', function () {
        removeJig(j.id);
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
    if (payload && payload.source === 'bend-jig') return;
  }

  function mount(api) {
    ctx = api || {};
    jigs = [];
    seq = 0;
    history = [];
    historyIndex = -1;
    historyLocked = false;
    selection = { kind: 'none', jigId: null };
    selectedTool = null;
    renderToolbox();
    bindStageDrop();
    ensureLayer();
    rebuildLayer();
    pushHistory();

    if (global.FtthLab) {
      FtthLab.listBendJigSlots = listSlots;
      FtthLab.setBendJigCableDocked = setCableDocked;
      FtthLab.releaseBendJigCable = releaseDockedCable;
      FtthLab.macroBendLossDb = macroBendLossDb;
      FtthLab.macroBendLossForJig = function (id) {
        var j = findJig(id);
        return j ? macroBendLossDb(j.theta) : 0;
      };
    }
  }

  var tool = {
    id: 'bend-jig',
    mount: mount,
    onViewChange: onViewChange,
    onLayoutChange: onLayoutChange,
    undo: undo,
    redo: redo,
    deleteSelected: deleteSelected,
    clearSelection: clearSelection,
    onToolboxClaim: onToolboxClaim,
    placeJig: placeJig,
    updateInspector: updateInspector,
    onLabConfigChanged: function (payload) {
      if (global.FtthLab && typeof FtthLab.handleToolboxConfigChange === 'function') {
        FtthLab.handleToolboxConfigChange('jig', 'lab-bendjig-tree', renderToolbox, payload && payload.config);
      } else {
        renderToolbox();
      }
      updateInspector();
    },
    exportProjectState: snapshot,
    importProjectState: applySnapshot,
    resetProjectState: function () {
      applySnapshot({ jigs: [], seq: 0, selection: { kind: 'none', jigId: null } });
    },
  };

  function tryRegister() {
    if (global.FtthLab && typeof FtthLab.registerTool === 'function') {
      FtthLab.registerTool('bend-jig', tool);
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
