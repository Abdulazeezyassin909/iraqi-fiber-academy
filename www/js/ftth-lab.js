/**
 * FTTH Network & Patch Panel Lab — workspace shell
 * Empty modular stage: 2D layout canvas + 3D grid.
 * Tools register via FtthLab.registerTool(...) when added one-by-one.
 */
(function (global) {
  'use strict';

  var state = {
    viewMode: '2d', /* 2d | 3d */
    scene: null,
    camera: null,
    renderer: null,
    root: null,
    grid: null,
    raycaster: null,
    pointer: null,
    raf: 0,
    tools: {},
    booted: false,
    pendingTools: [],
    /* 2D canvas zoom (mouse wheel) */
    zoom2d: 1,
    pan2dX: 0,
    pan2dY: 0,
  };

  var ZOOM_MIN = 0.2;
  var ZOOM_MAX = 2.75;
  var ZOOM_STEP = 0.08;
  var WORLD_SIZE = 20000; /* virtually infinite workspace */

  function $(id) {
    return document.getElementById(id);
  }

  function setStatus(msg, force) {
    var el = $('lab-status');
    if (!el) return;
    if (!force && selectionOwner === 'opm') return;
    el.textContent = msg || '';
  }

  /* ─── Public tool registry (plug-and-play) ─── */

  function mountTool(id, tool) {
    if (typeof tool.mount !== 'function') return;
    try {
      tool.mount({
        viewMode: state.viewMode,
        host2d: document.getElementById('lab-2d-mount'),
        host3d: state.root,
        scene: state.scene,
        camera: state.camera,
        renderer: state.renderer,
        getViewMode: function () { return state.viewMode; },
      });
    } catch (err) {
      console.warn('[FtthLab] tool mount failed:', id, err);
    }
  }

  function registerTool(id, tool) {
    if (!id || !tool) return;
    if (!state.booted) {
      state.pendingTools.push({ id: id, tool: tool });
      return;
    }
    state.tools[id] = tool;
    mountTool(id, tool);
    setStatus('Tool registered: ' + id);
  }

  function flushPendingTools() {
    var queue = state.pendingTools.splice(0);
    queue.forEach(function (item) {
      state.tools[item.id] = item.tool;
      mountTool(item.id, item.tool);
    });
  }

  function notifyTools(eventName, payload) {
    Object.keys(state.tools).forEach(function (id) {
      var tool = state.tools[id];
      if (tool && typeof tool[eventName] === 'function') {
        try {
          tool[eventName](payload);
        } catch (err) {
          console.warn('[FtthLab] tool event failed:', id, eventName, err);
        }
      }
    });
  }

  function collectPickables() {
    var list = [];
    Object.keys(state.tools).forEach(function (id) {
      var tool = state.tools[id];
      if (tool && typeof tool.getPickables === 'function') {
        list = list.concat(tool.getPickables() || []);
      }
    });
    return list;
  }

  /* ─── View mode ─── */

  function setViewMode(mode) {
    state.viewMode = mode === '3d' ? '3d' : '2d';
    var app = $('lab-app');
    if (app) {
      app.classList.toggle('lab-app--2d', state.viewMode === '2d');
      app.classList.toggle('lab-app--3d', state.viewMode === '3d');
    }
    document.querySelectorAll('[data-lab-view]').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-lab-view') === state.viewMode);
    });
    var host2d = $('lab-canvas-2d');
    var host3d = $('lab-canvas-3d');
    if (host2d) host2d.hidden = state.viewMode !== '2d';
    if (host3d) host3d.hidden = state.viewMode !== '3d';

    notifyTools('onViewChange', { viewMode: state.viewMode });
    onResize();
    applyZoom2d();
  }

  /* ─── 2D mouse-wheel zoom ─── */

  var transformSettleTimer = null;

  function clampZoom(z) {
    return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
  }

  /** Promote world layer only while transforming; settle clears will-change for sharp paint. */
  function markWorldTransforming() {
    var world = $('lab-2d-world');
    if (world) world.classList.add('is-transforming');
    if (transformSettleTimer) clearTimeout(transformSettleTimer);
    transformSettleTimer = setTimeout(function () {
      transformSettleTimer = null;
      var w = $('lab-2d-world');
      if (w) w.classList.remove('is-transforming');
    }, 180);
  }

  function applyZoom2d() {
    var world = $('lab-2d-world');
    if (world) {
      world.style.width = WORLD_SIZE + 'px';
      world.style.height = WORLD_SIZE + 'px';
      world.style.transform =
        'translate3d(' + state.pan2dX + 'px, ' + state.pan2dY + 'px, 0) scale(' + state.zoom2d + ')';
    }
    var chip = $('lab-hud-zoom');
    if (chip) chip.textContent = 'Zoom ' + Math.round(state.zoom2d * 100) + '%';
  }

  function zoom2dAt(clientX, clientY, nextZoom) {
    var stage = $('lab-canvas-2d');
    if (!stage) {
      state.zoom2d = clampZoom(nextZoom);
      markWorldTransforming();
      applyZoom2d();
      return;
    }
    var rect = stage.getBoundingClientRect();
    var mx = clientX - rect.left;
    var my = clientY - rect.top;
    var prev = state.zoom2d;
    var next = clampZoom(nextZoom);
    if (next === prev) return;
    /* Keep point under cursor stable while scaling */
    state.pan2dX = mx - ((mx - state.pan2dX) * (next / prev));
    state.pan2dY = my - ((my - state.pan2dY) * (next / prev));
    state.zoom2d = next;
    markWorldTransforming();
    applyZoom2d();
  }

  function onStageWheel(e) {
    if (state.viewMode !== '2d') return;
    e.preventDefault();
    var dir = e.deltaY > 0 ? -1 : 1;
    zoom2dAt(e.clientX, e.clientY, state.zoom2d + dir * ZOOM_STEP);
  }

  function centerWorldInView() {
    var stage = $('lab-canvas-2d');
    if (!stage) return;
    var z = state.zoom2d || 1;
    state.pan2dX = (stage.clientWidth / 2) - (WORLD_SIZE / 2) * z;
    state.pan2dY = (stage.clientHeight / 2) - (WORLD_SIZE / 2) * z;
    applyZoom2d();
  }

  function isCanvasPanTarget(target) {
    if (!target || !target.closest) return true;
    if (target.closest('[data-lab-resize]')) return false;
    if (target.closest('[data-lab-chassis-drag]')) return false;
    if (target.closest('.lab-fx-slot')) return false;
    if (target.closest('.lab-fx-port')) return false;
    if (target.closest('.lab-fx-chassis-frame')) return false;
    if (target.closest('.lab-cas-cassette') || target.closest('.lab-spl-node')) return false;
    if (target.closest('.lab-pcord')) return false;
    if (target.closest('.lab-pigtail')) return false;
    if (target.closest('.lab-stripper') || target.closest('.lab-stripper__hit')) return false;
    if (target.closest('.lab-cleaver') || target.closest('.lab-cleaver__hit')) return false;
    if (target.closest('.lab-fusion-machine') || target.closest('.lab-fusion-machine__hit')) return false;
    if (target.closest('.lab-sleeve-free') || target.closest('[data-sleeve-id]')) return false;
    if (target.closest('.lab-cpl') || target.closest('.lab-cpl-port')) return false;
    if (target.closest('.lab-vfl')) return false;
    if (target.closest('.lab-opm') || target.closest('.lab-opm-port') ||
        target.closest('.lab-ols') || target.closest('.lab-ols-port') ||
        target.closest('.lab-otdr-device') || target.closest('.lab-otdr-port') ||
        target.closest('.otdr-protruding-ports') || target.closest('.protruding-port.device-port') ||
        target.closest('.viavi__key') || target.closest('.viavi__keys')) return false;
    if (target.closest('.lab-toolbox') || target.closest('.lab-tool')) return false;
    return true;
  }

  function bindPan2d(stage) {
    if (!stage || stage.dataset.panBound === '1') return;
    stage.dataset.panBound = '1';
    var pan = null;
    var panMoved = false;

    stage.addEventListener('pointerdown', function (e) {
      if (state.viewMode !== '2d') return;
      var middle = e.button === 1;
      var leftEmpty = e.button === 0 && isCanvasPanTarget(e.target);
      if (!middle && !leftEmpty) return;
      if (middle) e.preventDefault();
      panMoved = false;
      pan = {
        x: e.clientX,
        y: e.clientY,
        panX: state.pan2dX,
        panY: state.pan2dY,
        pointerId: e.pointerId,
      };
      stage.classList.add('is-panning');
      markWorldTransforming();
      try { stage.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });

    stage.addEventListener('pointermove', function (e) {
      if (!pan) return;
      if (Math.abs(e.clientX - pan.x) > 3 || Math.abs(e.clientY - pan.y) > 3) {
        panMoved = true;
      }
      state.pan2dX = pan.panX + (e.clientX - pan.x);
      state.pan2dY = pan.panY + (e.clientY - pan.y);
      markWorldTransforming();
      applyZoom2d();
    });

    function endPan() {
      if (!pan) return;
      pan = null;
      stage.classList.remove('is-panning');
      markWorldTransforming();
    }

    stage.addEventListener('pointerup', endPan);
    stage.addEventListener('pointercancel', endPan);
    stage.addEventListener('lostpointercapture', endPan);

    /* Empty workspace click clears toolbox arm + selection (not after a pan drag) */
    stage.addEventListener('click', function (e) {
      if (state.viewMode !== '2d') return;
      if (panMoved) {
        panMoved = false;
        return;
      }
      if (!isCanvasPanTarget(e.target)) return;
      clearWorkspaceSelection();
    });

    /* Prevent middle-click autoscroll */
    stage.addEventListener('auxclick', function (e) {
      if (e.button === 1) e.preventDefault();
    });
  }

  function bindZoom2d() {
    var stage = $('lab-canvas-2d');
    if (!stage || stage.dataset.zoomBound === '1') return;
    stage.dataset.zoomBound = '1';
    stage.addEventListener('wheel', onStageWheel, { passive: false });
    bindPan2d(stage);
    centerWorldInView();
  }

  function undo() {
    if (timelineIndex < 0) {
      setStatus('Nothing to undo');
      return false;
    }
    var toolId = timeline[timelineIndex];
    var tool = state.tools[toolId];
    var ok = false;
    if (tool && typeof tool.undo === 'function') {
      try { ok = !!tool.undo(); } catch (err) {
        console.warn('[FtthLab] undo failed:', toolId, err);
      }
    }
    if (ok) {
      timelineIndex -= 1;
      updateHistoryUi();
      setStatus('Undo');
    } else {
      setStatus('Nothing to undo');
    }
    return ok;
  }

  function redo() {
    if (timelineIndex >= timeline.length - 1) {
      setStatus('Nothing to redo');
      return false;
    }
    var next = timelineIndex + 1;
    var toolId = timeline[next];
    var tool = state.tools[toolId];
    var ok = false;
    if (tool && typeof tool.redo === 'function') {
      try { ok = !!tool.redo(); } catch (err) {
        console.warn('[FtthLab] redo failed:', toolId, err);
      }
    }
    if (ok) {
      timelineIndex = next;
      updateHistoryUi();
      setStatus('Redo');
    } else {
      setStatus('Nothing to redo');
    }
    return ok;
  }

  var timeline = [];
  var timelineIndex = -1;
  var selectionOwner = null;

  function recordHistory(toolId) {
    if (!toolId) return;
    timeline = timeline.slice(0, timelineIndex + 1);
    timeline.push(toolId);
    timelineIndex = timeline.length - 1;
    updateHistoryUi();
  }

  function updateHistoryUi() {
    var undoBtn = $('lab-btn-undo');
    var redoBtn = $('lab-btn-redo');
    if (undoBtn) undoBtn.disabled = timelineIndex < 0;
    if (redoBtn) redoBtn.disabled = timelineIndex < 0 || timelineIndex >= timeline.length - 1;
  }

  /**
   * Strip canvas selection outlines so only one workspace entity can appear
   * selected. Toolbox sidebar highlights (.lab-rail) are untouched.
   */
  function stripWorkspaceSelectionOutlines() {
    var stage = $('lab-canvas-2d');
    if (!stage) return;
    stage.querySelectorAll('.is-selected').forEach(function (el) {
      if (el.closest('.lab-rail')) return;
      el.classList.remove('is-selected');
    });
  }

  /** Deselect every tool except the one about to claim selection. */
  function clearOtherToolSelections(exceptToolId) {
    Object.keys(state.tools).forEach(function (id) {
      if (id === exceptToolId) return;
      var tool = state.tools[id];
      if (!tool || typeof tool.clearSelection !== 'function') return;
      try {
        tool.clearSelection();
      } catch (err) {
        console.warn('[FtthLab] clearSelection failed:', id, err);
      }
    });
    stripWorkspaceSelectionOutlines();
  }

  function setSelectionOwner(toolId) {
    if (toolId) {
      clearOtherToolSelections(toolId);
    }
    selectionOwner = toolId || null;
  }

  var activeToolboxTool = null;

  /** Sidebar category labels keyed by registered tool id. */
  var TOOLBOX_CATEGORIES = {
    'olt-fx16': 'ACTIVE EQUIPMENT',
    'ols': 'TEST EQUIPMENT',
    'smart-splitter': 'SPLITTERS',
    'patch-cord': 'FIBER JUMPERS',
    'sc-pigtail': 'FIBER JUMPERS',
    'cable': 'FIBER JUMPERS',
    'splice-sleeve': 'FUSION SPLICING',
    'cfs-stripper': 'FUSION SPLICING',
    'cleaning-wipe': 'FUSION SPLICING',
    'fiber-cleaver': 'FUSION SPLICING',
    'fusion-splicer-machine': 'FUSION SPLICING',
    'fiber-spool': 'FIBER JUMPERS',
    'bend-jig': 'FIBER JUMPERS',
    'sc-coupler': 'ADAPTERS',
    'opm': 'TEST EQUIPMENT',
    'vfl': 'TEST EQUIPMENT',
    'otdr-machine': 'TESTING EQUIPMENT',
  };

  function getToolboxCategory(toolId) {
    if (!toolId) return null;
    var tool = state.tools[toolId];
    if (tool && tool.category) return tool.category;
    return TOOLBOX_CATEGORIES[toolId] || null;
  }

  /**
   * Enforce a single toolbox active highlight across all rail categories
   * (Active Equipment / Splitters / Fiber Jumpers / Adapters / Test Equipment).
   * Pass null to strip every sidebar tool highlight.
   */
  function claimToolboxTool(toolId) {
    activeToolboxTool = toolId || null;
    document.querySelectorAll('.lab-rail .lab-tool.is-selected').forEach(function (el) {
      el.classList.remove('is-selected');
    });
    notifyTools('onToolboxClaim', { toolId: activeToolboxTool });
  }

  function getActiveToolboxTool() {
    return activeToolboxTool;
  }

  function resetInspectorIdle() {
    var card = $('lab-inspector-card');
    var detail = $('lab-inspector-detail');
    if (card) {
      card.hidden = false;
      card.dataset.opmInspector = '';
      card.innerHTML =
        '<h2>No selection</h2>' +
        '<p>Select equipment on the canvas, or drag an item from the toolbox.</p>';
    }
    if (detail) {
      detail.hidden = true;
      detail.innerHTML = '';
    }
  }

  /** ESC: clear workspace selection, disarm tools, reset active UI states. */
  function clearWorkspaceSelection() {
    if (global.FtthLab) global.FtthLab._patchPending = null;
    notifyTools('cancelPatch');
    notifyTools('clearSelection');
    claimToolboxTool(null);
    selectionOwner = null;
    resetInspectorIdle();
    setStatus('Selection cleared', true);
  }

  function flipSelected() {
    var pigTool = state.tools['sc-pigtail'];
    if (pigTool && typeof pigTool.flipSelected === 'function') {
      try {
        if (pigTool.flipSelected()) {
          return true;
        }
      } catch (errPig) {
        console.warn('[FtthLab] flipSelected failed: sc-pigtail', errPig);
      }
    }
    if (selectionOwner && selectionOwner !== 'sc-pigtail' &&
        state.tools[selectionOwner] &&
        typeof state.tools[selectionOwner].flipSelected === 'function') {
      try {
        if (state.tools[selectionOwner].flipSelected()) {
          return true;
        }
      } catch (err) {
        console.warn('[FtthLab] flipSelected failed:', selectionOwner, err);
      }
    }
    var ids = Object.keys(state.tools);
    for (var i = ids.length - 1; i >= 0; i--) {
      var tool = state.tools[ids[i]];
      if (!tool || tool.id === 'sc-pigtail' || typeof tool.flipSelected !== 'function') continue;
      try {
        if (tool.flipSelected()) {
          return true;
        }
      } catch (err2) {
        console.warn('[FtthLab] flipSelected failed:', ids[i], err2);
      }
    }
    setStatus('Select a pigtail or cable to flip');
    return false;
  }

  function deleteSelected() {
    if (selectionOwner && state.tools[selectionOwner] &&
        typeof state.tools[selectionOwner].deleteSelected === 'function') {
      try {
        if (state.tools[selectionOwner].deleteSelected()) {
          setStatus('Deleted', true);
          return true;
        }
      } catch (err) {
        console.warn('[FtthLab] deleteSelected failed:', selectionOwner, err);
      }
    }
    var ids = Object.keys(state.tools);
    for (var i = ids.length - 1; i >= 0; i--) {
      var tool = state.tools[ids[i]];
      if (tool && typeof tool.deleteSelected === 'function') {
        try {
          if (tool.deleteSelected()) {
            setStatus('Deleted', true);
            return true;
          }
        } catch (err) {
          console.warn('[FtthLab] deleteSelected failed:', ids[i], err);
        }
      }
    }
    setStatus('Nothing selected to delete');
    return false;
  }

  function isTypingTarget(el) {
    if (!el) return false;
    var tag = (el.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (el.isContentEditable) return true;
    return false;
  }

  /* ─── 3D empty grid stage ─── */

  function initThree() {
    var host = $('lab-canvas-3d');
    if (!host || typeof THREE === 'undefined') {
      setStatus('3D engine unavailable — 2D stage still active');
      return;
    }

    var w = host.clientWidth || 800;
    var h = host.clientHeight || 500;

    state.scene = new THREE.Scene();
    state.scene.background = new THREE.Color(0x070b12);

    state.camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 200);
    state.camera.position.set(5.5, 3.2, 6.5);
    state.camera.lookAt(0, 1.0, 0);

    state.renderer = new THREE.WebGLRenderer({ antialias: true });
    state.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    state.renderer.setSize(w, h, false);
    host.appendChild(state.renderer.domElement);

    state.raycaster = new THREE.Raycaster();
    state.pointer = new THREE.Vector2();

    state.scene.add(new THREE.AmbientLight(0xb8c4d6, 0.55));
    var key = new THREE.DirectionalLight(0xffffff, 0.95);
    key.position.set(5, 8, 4);
    state.scene.add(key);
    var fill = new THREE.DirectionalLight(0x38bdf8, 0.25);
    fill.position.set(-4, 3, -2);
    state.scene.add(fill);

    var grid = new THREE.GridHelper(20, 40, 0x164e63, 0x0f172a);
    state.scene.add(grid);
    state.grid = grid;

    state.root = new THREE.Group();
    state.root.name = 'lab-tool-root';
    state.scene.add(state.root);

    var drag = null;
    host.addEventListener('pointerdown', function (e) {
      drag = { x: e.clientX, y: e.clientY, moved: false };
      try { host.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
    host.addEventListener('pointermove', function (e) {
      if (!drag || !state.root) return;
      var dx = e.clientX - drag.x;
      var dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      drag.x = e.clientX;
      drag.y = e.clientY;
      if (drag.moved) {
        state.root.rotation.y += dx * 0.01;
        state.root.rotation.x += dy * 0.008;
        state.root.rotation.x = Math.max(-1.0, Math.min(1.0, state.root.rotation.x));
      }
    });
    host.addEventListener('pointerup', function (e) {
      if (!drag) return;
      var wasClick = !drag.moved;
      drag = null;
      if (wasClick) handleStageClick(e);
    });
    host.addEventListener('pointerleave', function () { drag = null; });
    host.addEventListener('wheel', function (e) {
      e.preventDefault();
      if (!state.camera) return;
      var z = state.camera.position.z + (e.deltaY > 0 ? 0.4 : -0.4);
      state.camera.position.z = Math.max(3.5, Math.min(16, z));
      state.camera.position.x = state.camera.position.z * 0.75;
      state.camera.position.y = 1.2 + state.camera.position.z * 0.35;
      state.camera.lookAt(0, 1.0, 0);
    }, { passive: false });

    animate();
    window.addEventListener('resize', onResize);
  }

  function handleStageClick(e) {
    if (state.viewMode !== '3d' || !state.raycaster || !state.camera || !state.renderer) return;
    var host = $('lab-canvas-3d');
    if (!host) return;
    var rect = host.getBoundingClientRect();
    state.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    state.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    state.raycaster.setFromCamera(state.pointer, state.camera);
    var targets = collectPickables();
    var hits = state.raycaster.intersectObjects(targets, false);
    if (!hits.length) return;
    notifyTools('onStageClick', {
      object: hits[0].object,
      userData: hits[0].object.userData,
      point: hits[0].point,
    });
  }

  function onResize() {
    var host = $('lab-canvas-3d');
    if (!host || !state.camera || !state.renderer || state.viewMode !== '3d') return;
    var w = host.clientWidth || 1;
    var h = host.clientHeight || 1;
    state.camera.aspect = w / h;
    state.camera.updateProjectionMatrix();
    state.renderer.setSize(w, h, false);
  }

  function animate() {
    state.raf = requestAnimationFrame(animate);
    if (state.renderer && state.scene && state.camera && state.viewMode === '3d') {
      state.renderer.render(state.scene, state.camera);
    }
  }

  function isAdminPreviewContext() {
    try {
      if (global.self !== global.top) return true;
    } catch (err) {
      return true;
    }
    try {
      return new URLSearchParams(global.location.search || '').get('mode') === 'admin-preview';
    } catch (err2) {
      return false;
    }
  }

  function isOpmWorkspacePage() {
    return !!(document.body && document.body.classList.contains('opm-page'));
  }

  function isOtdrWorkspacePage() {
    return !!(document.body && document.body.classList.contains('otdr-lab-page'));
  }

  function isSplicerOnlyWorkspacePage() {
    return !!(
      document.body &&
      document.body.classList.contains('splicer-lab-page') &&
      !document.body.classList.contains('otdr-lab-page')
    );
  }

  function projectWorkspaceKind() {
    if (isOpmWorkspacePage()) return 'ifa-opm-project';
    if (isOtdrWorkspacePage()) return 'ifa-otdr-lab-project';
    return 'ifa-ftth-lab-project';
  }

  function activeLabSettings() {
    if (isOpmWorkspacePage() && global.OpmSettings) return global.OpmSettings;
    if (isOtdrWorkspacePage() && global.OtdrSettings) return global.OtdrSettings;
    if (isSplicerOnlyWorkspacePage() && global.FusionSplicerSettings) return global.FusionSplicerSettings;
    return global.FtthLabSettings || null;
  }

  function canShowSimulatorAdminSettingsUI() {
    if (global.IFAAuth && typeof global.IFAAuth.canShowSimulatorAdminSettingsUI === 'function') {
      return global.IFAAuth.canShowSimulatorAdminSettingsUI();
    }
    return false;
  }

  function syncFtthLabAdminSettingsButton() {
    var show = canShowSimulatorAdminSettingsUI();
    [
      'ftth-lab-admin-settings-btn',
      'opm-admin-settings-btn',
      'otdr-admin-settings-btn',
      'splicer-admin-settings-btn',
    ].forEach(function (id) {
      var btn = $(id);
      if (!btn) return;
      btn.hidden = !show;
      btn.style.display = show ? 'inline-flex' : 'none';
      btn.classList.toggle('is-admin-visible', show);
    });
  }

  function bindAdminSettingsUiAuthListener() {
    if (global.__ifaFtthLabAdminSettingsAuthListenerBound) return;
    if (!global.IFAAuth || typeof global.IFAAuth.onAuthChange !== 'function') {
      global.setTimeout(bindAdminSettingsUiAuthListener, 50);
      return;
    }
    global.__ifaFtthLabAdminSettingsAuthListenerBound = true;
    global.IFAAuth.onAuthChange(function () {
      syncFtthLabAdminSettingsButton();
    });
  }

  var toolboxPreviewConfig = null;

  function setToolboxPreviewConfig(config) {
    toolboxPreviewConfig = config && typeof config === 'object' ? config : null;
  }

  function clearToolboxPreviewConfig() {
    toolboxPreviewConfig = null;
  }

  function resolveToolboxConfig(explicit) {
    if (explicit && typeof explicit === 'object') return explicit;
    if (toolboxPreviewConfig) return toolboxPreviewConfig;
    var s = activeLabSettings();
    if (s && typeof s.getActiveConfig === 'function') return s.getActiveConfig();
    return null;
  }

  function getItemFromToolboxConfig(config, toolKey) {
    if (!config || !toolKey || !Array.isArray(config.items)) return null;
    var key = resolveToolboxToolKey(toolKey);
    var i;
    for (i = 0; i < config.items.length; i++) {
      if (config.items[i] && config.items[i].toolKey === key) return config.items[i];
    }
    return null;
  }

  function resolveToolboxToolKey(domKey) {
    var s = activeLabSettings();
    if (s && typeof s.resolveToolKeyFromDom === 'function') {
      return s.resolveToolKeyFromDom(domKey);
    }
    return domKey || '';
  }

  function isToolboxToolVisible(toolId, config) {
    if (!toolId) return true;
    var key = resolveToolboxToolKey(toolId);
    var cfg = config || resolveToolboxConfig();
    if (cfg && Array.isArray(cfg.items)) {
      var fromCfg = getItemFromToolboxConfig(cfg, key);
      if (!fromCfg) return true;
      return fromCfg.visible !== false;
    }
    var s = activeLabSettings();
    if (!s || typeof s.getItem !== 'function') return true;
    var item = s.getItem(key);
    if (!item) return true;
    return item.visible !== false;
  }

  function shouldRenderToolboxTool(toolKey, config) {
    return isToolboxToolVisible(toolKey, config);
  }

  function anyToolboxToolVisible(toolKeys, config) {
    if (!toolKeys || !toolKeys.length) return true;
    var cfg = config || resolveToolboxConfig();
    var i;
    for (i = 0; i < toolKeys.length; i++) {
      if (shouldRenderToolboxTool(toolKeys[i], cfg)) return true;
    }
    return false;
  }

  function gateToolboxRender(hostId, toolKey, config) {
    var host = document.getElementById(hostId);
    if (!host) return null;
    if (!shouldRenderToolboxTool(toolKey, config)) {
      host.innerHTML = '';
      return null;
    }
    return host;
  }

  function enforceToolboxVisibility(config) {
    var cfg = resolveToolboxConfig(config);
    var s = activeLabSettings();
    if (s && typeof s.applyToolboxVisibility === 'function') {
      s.applyToolboxVisibility(cfg);
      return;
    }
    if (s && typeof s.applyToolboxPresentation === 'function') {
      s.applyToolboxPresentation(cfg);
    }
  }

  function applyFtthLabToolboxPresentation(config) {
    var cfg = resolveToolboxConfig(config);
    var s = activeLabSettings();
    if (s && typeof s.applyToolboxPresentation === 'function') {
      s.applyToolboxPresentation(cfg);
      return;
    }
    if (s && typeof s.applyToolboxIcons === 'function') {
      s.applyToolboxIcons(cfg);
    }
  }

  function handleToolboxConfigChange(toolKey, hostId, renderFn, config) {
    handleToolboxConfigChangeMulti([toolKey], hostId, renderFn, config);
  }

  function handleToolboxConfigChangeMulti(toolKeys, hostId, renderFn, config) {
    var cfg = config || resolveToolboxConfig();
    var host = typeof hostId === 'string' ? document.getElementById(hostId) : hostId;
    if (!host) return;
    if (!anyToolboxToolVisible(toolKeys, cfg)) {
      host.innerHTML = '';
      enforceToolboxVisibility(cfg);
      return;
    }
    var hasButtons = host.querySelector('.lab-tool[data-lab-tool]');
    if (!hasButtons && typeof renderFn === 'function') {
      renderFn();
      enforceToolboxVisibility(cfg);
      return;
    }
    applyFtthLabToolboxPresentation(cfg);
    enforceToolboxVisibility(cfg);
  }

  function armDragOnlyToolboxTool(toolId, message) {
    if (!isToolboxToolVisible(toolId)) {
      setStatus('This tool is hidden by the lab administrator.');
      return false;
    }
    claimToolboxTool(toolId);
    setStatus(message || 'Drag onto workspace to place equipment.');
    return true;
  }

  function getPerformanceSpecs(toolKey) {
    var s = activeLabSettings();
    if (s && typeof s.getPerformanceSpecs === 'function') {
      return s.getPerformanceSpecs(toolKey);
    }
    return null;
  }

  function getSfpVariants() {
    var s = activeLabSettings();
    if (s && typeof s.getSfpVariants === 'function') {
      return s.getSfpVariants();
    }
    return [];
  }

  function applyFtthLabToolboxIcons(config) {
    applyFtthLabToolboxPresentation(config);
    enforceToolboxVisibility(config);
  }

  function resolveLabSettingsStore(storeName) {
    if (storeName === 'OpmSettings' && global.OpmSettings) return global.OpmSettings;
    if (storeName === 'OtdrSettings' && global.OtdrSettings) return global.OtdrSettings;
    if (storeName === 'FusionSplicerSettings' && global.FusionSplicerSettings) {
      return global.FusionSplicerSettings;
    }
    if (storeName === 'FtthLabSettings' && global.FtthLabSettings) return global.FtthLabSettings;
    return activeLabSettings();
  }

  function shouldApplyLabConfigStore(storeName) {
    if (!storeName) return true;
    if (isOpmWorkspacePage()) return storeName === 'OpmSettings';
    if (isOtdrWorkspacePage()) return storeName === 'OtdrSettings';
    if (isSplicerOnlyWorkspacePage()) return storeName === 'FusionSplicerSettings';
    return storeName === 'FtthLabSettings';
  }

  function applyLabConfigPayload(data) {
    if (!data || !data.config) return false;
    if (!shouldApplyLabConfigStore(data.store)) return false;
    var s = resolveLabSettingsStore(data.store);
    if (!s) return false;
    if (data.preview) {
      setToolboxPreviewConfig(data.config);
      if (typeof s.importPreviewDraft === 'function') {
        s.importPreviewDraft(data.config, false);
      }
    } else {
      clearToolboxPreviewConfig();
      if (typeof s.importRemoteConfig === 'function') {
        s.importRemoteConfig(data.config);
      }
    }
    applyFtthLabToolboxPresentation(data.config);
    enforceToolboxVisibility(data.config);
    notifyTools('onLabConfigChanged', { config: data.config, preview: !!data.preview });
    return true;
  }

  function getToolMeta(toolKey) {
    var cfg = resolveToolboxConfig();
    if (cfg) {
      var fromCfg = getItemFromToolboxConfig(cfg, toolKey);
      if (fromCfg) return fromCfg;
    }
    var s = activeLabSettings();
    if (s && typeof s.getItem === 'function') {
      return s.getItem(toolKey);
    }
    return null;
  }

  function applyFtthLabConfig(config, options) {
    options = options || {};
    var cfg = config || resolveToolboxConfig();
    if (options.preview && cfg) {
      setToolboxPreviewConfig(cfg);
    } else if (!options.preview) {
      clearToolboxPreviewConfig();
    }
    applyFtthLabToolboxPresentation(cfg);
    enforceToolboxVisibility(cfg);
    if (!options.skipNotify) {
      notifyTools('onLabConfigChanged', { config: cfg, preview: !!options.preview });
    }
  }

  function notifyLabConfigPreview(previewConfig) {
    var s = activeLabSettings();
    var cfg = previewConfig || (s && typeof s.getDraft === 'function' ? s.getDraft() : null);
    applyFtthLabConfig(cfg, { preview: true });
  }

  function bindLabConfigBroadcastBridge() {
    if (bindLabConfigBroadcastBridge._bound) return;
    bindLabConfigBroadcastBridge._bound = true;

    window.addEventListener('message', function (ev) {
      var data = ev.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'ifa:lab-config-apply') {
        applyLabConfigPayload(data);
        return;
      }
      if (data.type === 'ifa:ftth-lab-apply-draft' || data.type === 'ifa:ftth-lab-draft-live') {
        applyLabConfigPayload({
          type: 'ifa:lab-config-apply',
          store: data.store || 'FtthLabSettings',
          config: data.draft || data.config,
          preview: true,
        });
      }
    });

    window.addEventListener('ifa:lab-config-apply-local', function (ev) {
      applyLabConfigPayload((ev && ev.detail) || null);
    });

    if (canShowSimulatorAdminSettingsUI()) {
      var draftEvt = 'ifa:ftth-lab-draft-changed';
      if (activeLabSettings() && activeLabSettings().EVENTS && activeLabSettings().EVENTS.draft) {
        draftEvt = activeLabSettings().EVENTS.draft;
      }
      window.addEventListener(draftEvt, function () {
        var s = activeLabSettings();
        var draft = s && typeof s.getDraft === 'function' ? s.getDraft() : null;
        applyFtthLabConfig(draft, { preview: true });
      });
    }
  }

  function watchToolboxForIconRefresh() {
    var panel = document.querySelector('.lab-rail__panel');
    if (!panel || panel.dataset.iconWatch === '1') return;
    panel.dataset.iconWatch = '1';
    var debounceTimer;
    var obs = new MutationObserver(function () {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        applyFtthLabToolboxIcons();
        enforceToolboxVisibility();
      }, 0);
    });
    obs.observe(panel, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  }

  function bindUi() {
    var undoBtn = $('lab-btn-undo');
    var redoBtn = $('lab-btn-redo');
    var deleteBtn = $('lab-btn-delete');
    var flipBtn = $('ftth-flip-btn');
    if (undoBtn) undoBtn.addEventListener('click', undo);
    if (redoBtn) redoBtn.addEventListener('click', redo);
    if (flipBtn) flipBtn.addEventListener('click', function () { flipSelected(); });
    if (deleteBtn) deleteBtn.addEventListener('click', function () { deleteSelected(); });

    /* Capture-phase on window: works without focusing a field; blocks browser Undo/Redo */
    if (!bindUi._keysBound) {
      bindUi._keysBound = true;
      window.addEventListener('keydown', function (e) {
        var settingsModal =
          $('ftth-lab-settings-modal') ||
          $('opm-settings-modal') ||
          $('otdr-settings-modal') ||
          $('splicer-settings-modal');
        if (settingsModal && !settingsModal.hidden) return;

        var ctrl = e.ctrlKey || e.metaKey;
        var code = e.code || '';
        var key = e.key || '';
        var keyLower = key.toLowerCase();
        var isZ = code === 'KeyZ' || keyLower === 'z';
        var isY = code === 'KeyY' || keyLower === 'y';

        if (ctrl && isZ && !e.shiftKey && !e.altKey) {
          e.preventDefault();
          e.stopPropagation();
          if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
          undo();
          return;
        }
        if (ctrl && !e.altKey && (isY || (isZ && e.shiftKey))) {
          e.preventDefault();
          e.stopPropagation();
          if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
          redo();
          return;
        }

        if (isTypingTarget(e.target)) return;

        if (key === 'Escape') {
          e.preventDefault();
          clearWorkspaceSelection();
          return;
        }
        if (key === 'Delete' || key === 'Backspace') {
          e.preventDefault();
          deleteSelected();
        }
      }, true);
    }

    bindZoom2d();
    bindWorkspaceDnD();
    bindToolboxVisibilityGuards();
    updateHistoryUi();
  }

  function bindToolboxVisibilityGuards() {
    if (bindToolboxVisibilityGuards._bound) return;
    bindToolboxVisibilityGuards._bound = true;
    document.addEventListener('dragstart', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('.lab-tool[data-lab-tool]') : null;
      if (!btn) return;
      if (!isToolboxToolVisible(btn.getAttribute('data-lab-tool'))) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
    document.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('.lab-tool[data-lab-tool]') : null;
      if (!btn) return;
      if (!isToolboxToolVisible(btn.getAttribute('data-lab-tool'))) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
  }

  function boot() {
    bindUi();
    initThree();
    state.booted = true;
    flushPendingTools();
    setViewMode('2d');
    syncFtthLabAdminSettingsButton();
    bindAdminSettingsUiAuthListener();
    handleLaunchQuery();
    if (api._launchTool === 'opm') {
      setTimeout(function () {
        notifyTools('onLaunchRequest', { tool: 'opm' });
      }, 120);
    }
    setTimeout(applyFtthLabToolboxIcons, 0);
    watchToolboxForIconRefresh();
    bindLabConfigBroadcastBridge();
    [
      'ifa:ftth-lab-config-saved',
      'ifa:opm-config-saved',
      'ifa:otdr-config-saved',
      'ifa:splicer-config-saved',
    ].forEach(function (evt) {
      global.addEventListener(evt, function (ev) {
        var detail = (ev && ev.detail) || {};
        clearToolboxPreviewConfig();
        var cfg = detail.config || resolveToolboxConfig();
        applyFtthLabToolboxPresentation(cfg);
        enforceToolboxVisibility(cfg);
        notifyTools('onLabConfigChanged', { config: cfg, preview: false });
        setStatus('Lab device settings updated');
      });
    });
    setStatus('FTTH Lab ready · Ctrl+Z / Ctrl+Y · Del delete · Esc clear · scroll to zoom');
  }

  function showAlert(msg, kind) {
    var host = $('lab-alert');
    if (!host) {
      host = document.createElement('div');
      host.id = 'lab-alert';
      host.className = 'lab-alert';
      host.setAttribute('role', 'alert');
      var stage = document.querySelector('.lab-stage-wrap') || document.body;
      stage.appendChild(host);
    }
    host.className = 'lab-alert' + (kind === 'warn' ? ' lab-alert--warn' : '');
    host.innerHTML =
      '<strong>Physical incompatibility</strong>' +
      '<p>' + (msg || '') + '</p>' +
      '<button type="button" class="lab-alert__close" aria-label="Dismiss">×</button>';
    host.hidden = false;
    var close = host.querySelector('.lab-alert__close');
    if (close) {
      close.onclick = function () { host.hidden = true; };
    }
    clearTimeout(showAlert._t);
    showAlert._t = setTimeout(function () {
      if (host) host.hidden = true;
    }, 7000);
    setStatus(msg);
  }

  function showToast(msg, durationMs) {
    var old = document.getElementById('lab-toast');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var t = document.createElement('div');
    t.id = 'lab-toast';
    t.className = 'file-menu-toast lab-file-menu-toast lab-lab-toast';
    t.setAttribute('role', 'status');
    t.setAttribute('aria-live', 'polite');
    t.textContent = msg || '';
    document.body.appendChild(t);
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () {
      if (t.parentNode) t.parentNode.removeChild(t);
    }, typeof durationMs === 'number' ? durationMs : 2200);
  }

  function setBudget(text) {
    var chip = $('lab-hud-budget');
    if (chip) chip.textContent = text || 'Power budget · —';
  }

  function refreshPowerBudget() {
    var loss = 0;
    var mismatches = 0;
    Object.keys(state.tools).forEach(function (id) {
      var tool = state.tools[id];
      if (tool && typeof tool.getNetworkLossDb === 'function') {
        try {
          loss += Number(tool.getNetworkLossDb()) || 0;
        } catch (err) { /* ignore */ }
      }
      if (tool && typeof tool.getMismatchCount === 'function') {
        try {
          mismatches += Number(tool.getMismatchCount()) || 0;
        } catch (err2) { /* ignore */ }
      }
    });
    loss = Math.round(loss * 100) / 100;
    var text;
    if (loss <= 0) {
      text = 'Power budget · no active fiber path';
    } else if (mismatches > 0) {
      text = 'Power budget · Total Signal Loss ' + loss.toFixed(2) +
        ' dB · ' + mismatches + ' polish mismatch warning' + (mismatches > 1 ? 's' : '');
    } else {
      text = 'Power budget · Total Signal Loss ' + loss.toFixed(2) + ' dB';
    }
    setBudget(text);
    refreshOpmDisplay();
    return loss;
  }

  /* ─── Shared HTML5 drag session (toolbox → workspace) ─── */

  var activeDrag = null;

  function beginDrag(payload) {
    if (payload && payload.kind && !isToolboxToolVisible(payload.kind)) {
      activeDrag = null;
      return false;
    }
    activeDrag = payload && typeof payload === 'object' ? payload : null;
    return true;
  }

  function endDrag() {
    activeDrag = null;
  }

  function getActiveDrag() {
    return activeDrag;
  }

  function clientToWorld2d(clientX, clientY) {
    var stage = $('lab-canvas-2d');
    if (!stage) return { x: 0, y: 0 };
    var rect = stage.getBoundingClientRect();
    var z = state.zoom2d || 1;
    return {
      x: (clientX - rect.left - state.pan2dX) / z,
      y: (clientY - rect.top - state.pan2dY) / z,
    };
  }

  function clearStageDropHighlight() {
    ['lab-canvas-2d', 'lab-2d-mount', 'lab-canvas-3d'].forEach(function (id) {
      var el = $(id);
      if (el) el.classList.remove('is-drop-target');
    });
  }

  /** Allow drops anywhere on the 2D stage while a toolbox drag is active */
  function bindWorkspaceDnD() {
    var stage = $('lab-canvas-2d');
    var world = $('lab-2d-world');
    var mount = $('lab-2d-mount');
    var canvas3d = $('lab-canvas-3d');

    function onDragOver(e) {
      if (!activeDrag) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      if (stage && state.viewMode === '2d') stage.classList.add('is-drop-target');
      if (canvas3d && state.viewMode === '3d') canvas3d.classList.add('is-drop-target');
    }

    function onDragLeave(e) {
      var zone = e.currentTarget;
      if (!zone) return;
      var related = e.relatedTarget;
      if (related && zone.contains(related)) return;
      zone.classList.remove('is-drop-target');
    }

    function onDrop(e) {
      if (!activeDrag) return;
      e.preventDefault();
      clearStageDropHighlight();
      /* Tools handle placement via their own drop listeners + getActiveDrag() */
    }

    [stage, world, mount, canvas3d].forEach(function (el) {
      if (!el || el.dataset.labWorkspaceDnd === '1') return;
      el.dataset.labWorkspaceDnd = '1';
      el.addEventListener('dragover', onDragOver);
      el.addEventListener('dragleave', onDragLeave);
      el.addEventListener('drop', onDrop);
    });
  }

  /* ─── Optical Power Meter — live topology & dBm probe ─── */

  var OPM_NOISE_DBM = -70;
  var COUPLER_PASS_LOSS_DB = 0.3;
  var PIGTAIL_CONN_LOSS_DB = 0.2;
  var PIGTAIL_MISMATCH_DB = 3.0;
  var MATCHED_CONNECTOR_DB = 0.2;
  var FUSION_SPLICE_DB = 0.10;
  var FUSED_WELD_LOSS_DB = 0.05;
  var opmRefreshHook = null;
  var opmWavelengthNm = 1310;

  /**
   * Convert logarithmic optical power to linear milliwatts.
   * P(mW) = 10 ^ (P(dBm) / 10)
   */
  function dbmToMilliwatts(dBm) {
    var value = Number(dBm);
    if (!isFinite(value)) return null;
    return Math.pow(10, value / 10);
  }

  /**
   * mW display text. The OLP-38 supports only dBm and mW, so weak readings
   * keep the mW unit (extra decimals / exponent) instead of switching to µW.
   */
  function formatMilliwatts(mw) {
    var v = Number(mw);
    if (!isFinite(v) || v <= 0) return null;
    if (v >= 1000) return v.toFixed(1) + ' mW';
    if (v >= 1) return v.toFixed(3) + ' mW';
    if (v >= 0.001) return v.toFixed(4) + ' mW';
    return v.toExponential(2) + ' mW';
  }

  /** SM fiber attenuation (dB/km) at common OPM test wavelengths */
  var FIBER_ATTENUATION_DB_KM = {
    850: 3.0,
    980: 2.5,
    1310: 0.35,
    1490: 0.25,
    1550: 0.20,
    1625: 0.22,
  };

  /** GPON-class OLT TX coupling penalty when meter is tuned off primary λ */
  var OLT_WAVELENGTH_PENALTY_DB = {
    850: 12,
    980: 9,
    1310: 0.4,
    1490: 0,
    1550: 1.2,
    1625: 2.5,
  };

  function getOpmWavelengthNm() {
    if (global.PowerMeterTrainer && typeof PowerMeterTrainer.getWavelength === 'function') {
      var ext = Number(PowerMeterTrainer.getWavelength());
      if (isFinite(ext) && FIBER_ATTENUATION_DB_KM[ext] != null) return ext;
    }
    return opmWavelengthNm;
  }

  function setOpmWavelength(nm) {
    var n = Number(nm);
    if (!isFinite(n) || FIBER_ATTENUATION_DB_KM[n] == null) return;
    opmWavelengthNm = n;
    refreshOpmDisplay();
    refreshPowerBudget();
  }

  function fiberAttenuationDbPerKm(wavelengthNm) {
    var alpha = FIBER_ATTENUATION_DB_KM[wavelengthNm];
    return alpha != null ? alpha : FIBER_ATTENUATION_DB_KM[1490];
  }

  function fiberSpanLossDb(lengthM, wavelengthNm) {
    var km = Math.max(0, Number(lengthM) || 0) / 1000;
    return km * fiberAttenuationDbPerKm(wavelengthNm);
  }

  function oltWavelengthPenaltyDb(probeNm, sourceNm) {
    var probe = Number(probeNm);
    var src = Number(sourceNm);
    if (!isFinite(src)) src = 1490;
    if (isFinite(probe) && probe === src) return 0;
    if (src === 1490 && OLT_WAVELENGTH_PENALTY_DB[probe] != null) {
      return OLT_WAVELENGTH_PENALTY_DB[probe];
    }
    if (!isFinite(probe)) return 2;
    var d = Math.abs(probe - src);
    if (d < 20) return 0.4;
    if (d < 80) return 1.5;
    if (d < 250) return 4;
    return 10;
  }

  /**
   * OLP-38 photodiode responsivity R(λ) in A/W (InGaAs detector head).
   * The meter senses photocurrent I = R(λ_light) · P, then divides by the
   * responsivity of the λ the operator selected: P_shown = I / R(λ_set).
   */
  var PD_RESPONSIVITY_AW = [
    { nm: 850, r: 0.32 },
    { nm: 980, r: 0.55 },
    { nm: 1310, r: 0.85 },
    { nm: 1490, r: 0.92 },
    { nm: 1550, r: 0.95 },
    { nm: 1625, r: 0.88 },
  ];

  function photodiodeResponsivity(wavelengthNm) {
    var x = Number(wavelengthNm);
    var table = PD_RESPONSIVITY_AW;
    if (!isFinite(x)) return table[3].r;
    if (x <= table[0].nm) return table[0].r;
    var last = table[table.length - 1];
    if (x >= last.nm) return last.r;
    var i;
    for (i = 1; i < table.length; i++) {
      var hi = table[i];
      if (x > hi.nm) continue;
      var lo = table[i - 1];
      var t = (x - lo.nm) / (hi.nm - lo.nm);
      return lo.r + (hi.r - lo.r) * t;
    }
    return last.r;
  }

  /** Photocurrent (amps) produced by P dBm of light at λ_light. */
  function photodiodeCurrentA(dBm, wavelengthNm) {
    if (dBm == null || !isFinite(dBm)) return null;
    var milliWatts = dbmToMilliwatts(dBm);
    if (milliWatts == null) return null;
    var watts = milliWatts / 1000;
    return photodiodeResponsivity(wavelengthNm) * watts;
  }

  /**
   * Calibration error (dB) from reading λ_light with the R(λ_set) table.
   * Zero when the meter λ matches the incoming λ.
   */
  function responsivityErrorDb(lightNm, calibrationNm) {
    var rLight = photodiodeResponsivity(lightNm);
    var rCal = photodiodeResponsivity(calibrationNm);
    if (!(rLight > 0) || !(rCal > 0)) return 0;
    return 10 * Math.log10(rLight / rCal);
  }

  /** Power the meter prints: I / R(λ_set), expressed back in dBm. */
  function calibratedReadingDbm(trueDbm, lightNm, calibrationNm) {
    if (trueDbm == null || !isFinite(trueDbm)) return trueDbm;
    var shown = trueDbm + responsivityErrorDb(lightNm, calibrationNm);
    return Math.round(shown * 100) / 100;
  }

  function normalizeCouplerFace(port) {
    var s = String(port == null ? 'A' : port).toUpperCase();
    return (s === 'B' || s === '2') ? 'B' : 'A';
  }

  function portKeyFromAtt(att) {
    if (!att || !att.owner) return null;
    if (att.owner === 'olt') {
      return 'olt:' + att.slot + ':' + att.oltPort;
    }
    if (att.owner === 'splitter') {
      return 'spl:' + att.splitterId + ':' + att.port;
    }
    if (att.owner === 'coupler') {
      return 'cpl:' + att.couplerId + ':' + normalizeCouplerFace(att.port);
    }
    if (att.owner === 'vfl') {
      return 'vfl:' + att.vflId;
    }
    if (att.owner === 'opm') {
      return 'opm:' + att.opmId;
    }
    if (att.owner === 'ols') {
      return 'ols:' + att.olsId;
    }
    return null;
  }

  function portKeyFromHit(hit) {
    if (!hit) return null;
    return portKeyFromAtt(hit);
  }

  function emptyLossParts() {
    return {
      splitter: 0,
      splice: 0,
      connector: 0,
      coupler: 0,
      fiber: 0,
      bend: 0,
      mismatch: 0,
    };
  }

  function cloneLossParts(p) {
    p = p || emptyLossParts();
    return {
      splitter: p.splitter || 0,
      splice: p.splice || 0,
      connector: p.connector || 0,
      coupler: p.coupler || 0,
      fiber: p.fiber || 0,
      bend: p.bend || 0,
      mismatch: p.mismatch || 0,
    };
  }

  function sumLossParts(base, extra) {
    var o = cloneLossParts(base);
    extra = extra || emptyLossParts();
    o.splitter += extra.splitter || 0;
    o.splice += extra.splice || 0;
    o.connector += extra.connector || 0;
    o.coupler += extra.coupler || 0;
    o.fiber += extra.fiber || 0;
    o.bend += extra.bend || 0;
    o.mismatch += extra.mismatch || 0;
    return o;
  }

  function totalLossParts(p) {
    p = p || emptyLossParts();
    return (p.splitter || 0) + (p.splice || 0) + (p.connector || 0) +
      (p.coupler || 0) + (p.fiber || 0) + (p.bend || 0) + (p.mismatch || 0);
  }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  function scaleLossParts(p, s) {
    p = cloneLossParts(p);
    p.splitter *= s;
    p.splice *= s;
    p.connector *= s;
    p.coupler *= s;
    p.fiber *= s;
    p.bend *= s;
    p.mismatch *= s;
    return p;
  }

  function polishKind(side) {
    if (!side) return 'UPC';
    var p = String(side.polish || '').toUpperCase();
    return p === 'APC' ? 'APC' : 'UPC';
  }

  function plcRatioLabel(type) {
    var t = String(type || '');
    var m = /^(\d+)x(\d+)$/i.exec(t);
    if (m) return m[1] + ':' + m[2] + ' PLC';
    return t ? t + ' PLC' : 'PLC';
  }

  function pcordLossParts(c, wavelengthNm) {
    var parts = emptyLossParts();
    var ka = portKeyFromAtt(c.sideA);
    var kb = portKeyFromAtt(c.sideB);
    if (ka && kb) parts.connector = MATCHED_CONNECTOR_DB * 2;
    if (c.sideA && c.sideA.mismatch) parts.mismatch += PIGTAIL_MISMATCH_DB;
    if (c.sideB && c.sideB.mismatch) parts.mismatch += PIGTAIL_MISMATCH_DB;
    parts.fiber = fiberSpanLossDb(c.fiberLengthM, wavelengthNm);
    if (c.bendJigId && global.FtthLab && typeof FtthLab.macroBendLossForJig === 'function') {
      parts.bend = Math.max(0, Number(FtthLab.macroBendLossForJig(c.bendJigId)) || 0);
    }
    return parts;
  }

  function keyKind(k) {
    if (!k) return '';
    if (k.indexOf('spl:') === 0) return 'spl';
    if (k.indexOf('cpl:') === 0) return 'cpl';
    if (k.indexOf('pigtail:') === 0) return 'pigtail';
    return '';
  }

  function splitterIdFromKey(k) {
    var m = /^spl:([^:]+):/.exec(k || '');
    return m ? m[1] : null;
  }

  function pigtailIdFromKey(k) {
    var m = /^pigtail:([^:]+):/.exec(k || '');
    return m ? m[1] : null;
  }

  function buildLossBreakdown(parts, path, graph, wavelengthNm) {
    parts = cloneLossParts(parts);
    path = path || [];
    graph = graph || { pcords: [], pigtails: [] };
    var pcords = graph.pcords || [];
    var pigtails = graph.pigtails || [];
    var splitters = (typeof api.getOpticalSplitters === 'function')
      ? (api.getOpticalSplitters() || [])
      : [];
    var connCount = 0;
    var polishN = { UPC: 0, APC: 0 };
    var fiberM = 0;
    var couplerN = 0;
    var spliceN = 0;
    var mismatchN = 0;
    var splitterNotes = [];
    var seenSpl = {};
    var seenPig = {};
    var i;
    var j;

    for (i = 0; i < path.length - 1; i++) {
      var a = path[i];
      var b = path[i + 1];
      if (keyKind(a) === 'cpl' && keyKind(b) === 'cpl') couplerN += 1;
      if (keyKind(a) === 'spl' && keyKind(b) === 'spl') {
        var sid = splitterIdFromKey(a) || splitterIdFromKey(b);
        if (sid && !seenSpl[sid]) {
          seenSpl[sid] = true;
          var spec = null;
          for (j = 0; j < splitters.length; j++) {
            if (splitters[j].id === sid) { spec = splitters[j]; break; }
          }
          splitterNotes.push(plcRatioLabel(spec && spec.type));
        }
      }
      for (j = 0; j < pcords.length; j++) {
        var c = pcords[j];
        var ka = portKeyFromAtt(c.sideA);
        var kb = portKeyFromAtt(c.sideB);
        if (!((ka === a && kb === b) || (ka === b && kb === a))) continue;
        if (ka) {
          connCount += 1;
          polishN[polishKind(c.sideA)] += 1;
          if (c.sideA.mismatch) mismatchN += 1;
        }
        if (kb) {
          connCount += 1;
          polishN[polishKind(c.sideB)] += 1;
          if (c.sideB.mismatch) mismatchN += 1;
        }
        fiberM += Number(c.fiberLengthM) || 0;
      }
      for (j = 0; j < pigtails.length; j++) {
        var p = pigtails[j];
        var pid = pigtailIdFromKey(a) || pigtailIdFromKey(b);
        if (pid && p.id === pid) {
          if (seenPig[p.id]) continue;
          seenPig[p.id] = true;
          fiberM += Number(p.fiberLengthM) || 0;
          if (p.tail && p.tail.spliceId) spliceN += 1;
          if (p.connector) {
            connCount += 1;
            polishN[p.connector.polish === 'APC' ? 'APC' : 'UPC'] += 1;
            if (p.connector.mismatch) mismatchN += 1;
          }
        }
      }
    }

    var polishBits = [];
    if (polishN.UPC) polishBits.push(polishN.UPC + '× SC/UPC');
    if (polishN.APC) polishBits.push(polishN.APC + '× SC/APC');
    return {
      splitterDb: round2(parts.splitter),
      spliceDb: round2(parts.splice),
      connectorDb: round2(parts.connector),
      couplerDb: round2(parts.coupler),
      fiberDb: round2(parts.fiber),
      bendDb: round2(parts.bend),
      mismatchDb: round2(parts.mismatch),
      totalDb: round2(totalLossParts(parts)),
      splitterNote: splitterNotes.length ? splitterNotes.join(' + ') : '',
      spliceCount: spliceN,
      spliceEachDb: FUSION_SPLICE_DB,
      connectorNote: connCount
        ? polishBits.join(' + ') || (connCount + '× connector')
        : '',
      couplerCount: couplerN,
      mismatchCount: mismatchN,
      mismatchEachDb: PIGTAIL_MISMATCH_DB,
      fiberLengthM: round2(fiberM),
      wavelengthNm: wavelengthNm,
    };
  }

  function addUndirectedEdge(adj, a, b, lossDb, parts) {
    if (!a || !b) return;
    lossDb = Math.max(0, Number(lossDb) || 0);
    parts = cloneLossParts(parts);
    if (totalLossParts(parts) < 1e-9 && lossDb > 0) parts.connector = lossDb;
    if (!adj[a]) adj[a] = [];
    if (!adj[b]) adj[b] = [];
    adj[a].push({ to: b, loss: lossDb, parts: parts });
    adj[b].push({ to: a, loss: lossDb, parts: parts });
  }

  function collectCouplerIdsFromGraph(pcords, pigtails, extraIds) {
    var couplerIds = {};
    function mark(cid) {
      if (cid) couplerIds[cid] = true;
    }
    var ei;
    for (ei = 0; extraIds && ei < extraIds.length; ei++) mark(extraIds[ei]);
    pcords.forEach(function (c) {
      [c.sideA, c.sideB].forEach(function (att) {
        if (att && att.owner === 'coupler') mark(att.couplerId);
      });
    });
    pigtails.forEach(function (p) {
      if (p.connector && p.connector.owner === 'coupler') mark(p.connector.couplerId);
    });
    return couplerIds;
  }

  function collectHostsAtCouplerFace(graph, cid, face) {
    var hosts = {};
    function add(key) {
      if (key) hosts[key] = true;
    }
    (graph.pcords || []).forEach(function (c) {
      var sides = [
        { att: c.sideA, other: c.sideB, otherEnd: 'B', freeOther: c.freeB },
        { att: c.sideB, other: c.sideA, otherEnd: 'A', freeOther: c.freeA },
      ];
      sides.forEach(function (s) {
        if (!s.att || s.att.owner !== 'coupler' || s.att.couplerId !== cid) return;
        if (normalizeCouplerFace(s.att.port) !== face) return;
        var otherKey = portKeyFromAtt(s.other);
        if (otherKey) add(otherKey);
        else if (s.freeOther) add('pcord:' + c.id + ':' + s.otherEnd);
      });
    });
    (graph.pigtails || []).forEach(function (p) {
      var att = p.connector;
      if (!att || att.owner !== 'coupler' || att.couplerId !== cid) return;
      if (normalizeCouplerFace(att.port) !== face) return;
      add('pigtail:' + p.id + ':tail');
      add('pigtail:' + p.id + ':conn');
    });
    return Object.keys(hosts);
  }

  function addCouplerPassThroughEdges(adj, graph, pcords, pigtails) {
    var extraIds = typeof api.getCouplerIds === 'function' ? api.getCouplerIds() : [];
    var couplerIds = collectCouplerIdsFromGraph(pcords, pigtails, extraIds);
    Object.keys(couplerIds).forEach(function (cid) {
      var passLoss = COUPLER_PASS_LOSS_DB;
      if (typeof api.getCouplerPassLossDb === 'function') {
        var custom = Number(api.getCouplerPassLossDb(cid));
        if (isFinite(custom) && custom >= 0) passLoss = custom;
      }
      var portA = 'cpl:' + cid + ':A';
      var portB = 'cpl:' + cid + ':B';
      var couplerParts = { coupler: passLoss };
      addUndirectedEdge(adj, portA, portB, passLoss, couplerParts);

      var hostsA = collectHostsAtCouplerFace(graph, cid, 'A');
      var hostsB = collectHostsAtCouplerFace(graph, cid, 'B');
      var ai;
      var bi;
      for (ai = 0; ai < hostsA.length; ai++) {
        for (bi = 0; bi < hostsB.length; bi++) {
          if (hostsA[ai] !== hostsB[bi]) {
            addUndirectedEdge(adj, hostsA[ai], hostsB[bi], passLoss, couplerParts);
          }
        }
      }
    });
  }

  function expandProbeKeys(probeKey, graph) {
    var keys = [];
    var seen = {};
    function add(k) {
      if (!k || seen[k]) return;
      seen[k] = true;
      keys.push(k);
    }
    add(probeKey);
    if (!graph || !probeKey) return keys;

    var opmMatch = /^opm:(.+)$/.exec(probeKey);
    if (opmMatch) {
      var opmId = opmMatch[1];
      (graph.pigtails || []).forEach(function (p) {
        var att = p.connector;
        if (!att || att.owner !== 'opm' || att.opmId !== opmId) return;
        add('pigtail:' + p.id + ':tail');
        add('pigtail:' + p.id + ':conn');
      });
      (graph.pcords || []).forEach(function (c) {
        var sides = [
          { att: c.sideA, end: 'A', other: c.sideB, otherEnd: 'B', freeOther: c.freeB },
          { att: c.sideB, end: 'B', other: c.sideA, otherEnd: 'A', freeOther: c.freeA },
        ];
        sides.forEach(function (s) {
          if (!s.att || s.att.owner !== 'opm' || s.att.opmId !== opmId) return;
          add('pcord:' + c.id + ':' + s.end);
          var otherKey = portKeyFromAtt(s.other);
          if (otherKey) add(otherKey);
          else if (s.freeOther) add('pcord:' + c.id + ':' + s.otherEnd);
        });
      });
    }
    return keys;
  }

  function registerFusionWeldEdges(adj, pigtails, fusedSeen) {
    function endpointKeyForFusedId(id, sideKey) {
      if (sideKey) return sideKey;
      return 'pigtail:' + id + ':tail';
    }

    function addFusedWeldEdge(idA, idB, dedupeKey, lossDb, keyA, keyB) {
      if (!idA || !idB || idA === idB) return;
      var seenKey = dedupeKey || [idA, idB].sort().join('|');
      if (fusedSeen[seenKey]) return;
      fusedSeen[seenKey] = true;
      var weldLoss = typeof lossDb === 'number' && isFinite(lossDb) ? lossDb : FUSED_WELD_LOSS_DB;
      var weldParts = { splice: weldLoss };
      addUndirectedEdge(
        adj,
        endpointKeyForFusedId(idA, keyA),
        endpointKeyForFusedId(idB, keyB),
        weldLoss,
        weldParts
      );
    }

    if (typeof api.getFusedAssemblyOpticalPairs === 'function') {
      var fusedPairs = api.getFusedAssemblyOpticalPairs() || [];
      fusedPairs.forEach(function (pair) {
        if (!pair || !pair.leftId || !pair.rightId) return;
        var key = pair.assemblyId || pair.fusionAssemblyId ||
          [pair.leftId, pair.rightId].sort().join('|');
        addFusedWeldEdge(
          pair.leftId,
          pair.rightId,
          key,
          pair.spliceLossDb,
          pair.leftKey,
          pair.rightKey
        );
      });
    }

    pigtails.forEach(function (fp) {
      var partnerId = fp.fusedPartnerId;
      if (!partnerId) return;
      var key = fp.fusionAssemblyId || [fp.id, partnerId].sort().join('|');
      addFusedWeldEdge(fp.id, partnerId, key);
    });
  }

  function buildOpticalAdjacency() {
    var adj = {};
    var wavelengthNm = getOpmWavelengthNm();
    var graph = typeof api.getFiberLaserGraph === 'function'
      ? api.getFiberLaserGraph()
      : { pcords: [], pigtails: [] };
    var pcords = graph.pcords || [];
    var pigtails = graph.pigtails || [];
    var i;
    var j;
    var k;

    for (i = 0; i < pcords.length; i++) {
      var c = pcords[i];
      var ka = portKeyFromAtt(c.sideA);
      var kb = portKeyFromAtt(c.sideB);
      var parts = pcordLossParts(c, wavelengthNm);
      var loss = totalLossParts(parts);
      if (ka && kb) {
        addUndirectedEdge(adj, ka, kb, loss, parts);
      }
      if (ka && c.freeB) {
        addUndirectedEdge(adj, ka, 'pcord:' + c.id + ':B', loss * 0.5, scaleLossParts(parts, 0.5));
      }
      if (kb && c.freeA) {
        addUndirectedEdge(adj, kb, 'pcord:' + c.id + ':A', loss * 0.5, scaleLossParts(parts, 0.5));
      }
      if (!ka && c.freeA) {
        adj['pcord:' + c.id + ':A'] = adj['pcord:' + c.id + ':A'] || [];
      }
      if (!kb && c.freeB) {
        adj['pcord:' + c.id + ':B'] = adj['pcord:' + c.id + ':B'] || [];
      }
    }

    for (i = 0; i < pigtails.length; i++) {
      var p = pigtails[i];
      if (p.type === 'cable') {
        var startKey = 'cable:' + p.id + ':start';
        var endKey = 'cable:' + p.id + ':end';
        var cableFiberM = typeof p.fiberLengthM === 'number' ? p.fiberLengthM :
          (typeof p.lengthMeters === 'number' ? p.lengthMeters : 0);
        var cableParts = { fiber: fiberSpanLossDb(cableFiberM, wavelengthNm) };
        addUndirectedEdge(adj, startKey, endKey, totalLossParts(cableParts), cableParts);
        adj[startKey] = adj[startKey] || [];
        adj[endKey] = adj[endKey] || [];
        continue;
      }
      var kc = portKeyFromAtt(p.connector);
      var tailKey = 'pigtail:' + p.id + ':tail';
      var ptLoss = PIGTAIL_CONN_LOSS_DB;
      var pigFiberLoss = fiberSpanLossDb(p.fiberLengthM, wavelengthNm);
      var spliceLoss = (p.tail && p.tail.spliceId) ? FUSION_SPLICE_DB : 0;
      var mismatchLoss = (p.connector && p.connector.mismatch) ? PIGTAIL_MISMATCH_DB : 0;
      var pigParts = {
        connector: ptLoss,
        fiber: pigFiberLoss,
        splice: spliceLoss,
        mismatch: mismatchLoss,
      };
      if (kc) {
        addUndirectedEdge(adj, kc, tailKey, totalLossParts(pigParts), pigParts);
      } else {
        adj['pigtail:' + p.id + ':conn'] = adj['pigtail:' + p.id + ':conn'] || [];
        addUndirectedEdge(adj, 'pigtail:' + p.id + ':conn', tailKey, totalLossParts(pigParts), pigParts);
      }
    }

    var fusedSeen = {};
    registerFusionWeldEdges(adj, pigtails, fusedSeen);

    if (typeof api.getOpticalSplitters === 'function') {
      var splitters = api.getOpticalSplitters() || [];
      for (i = 0; i < splitters.length; i++) {
        var sp = splitters[i];
        var inPorts = sp.inputs || [];
        var outPorts = sp.outputs || [];
        for (j = 0; j < inPorts.length; j++) {
          for (k = 0; k < outPorts.length; k++) {
            addUndirectedEdge(
              adj,
              'spl:' + sp.id + ':' + inPorts[j],
              'spl:' + sp.id + ':' + outPorts[k],
              sp.lossDb || 10,
              { splitter: sp.lossDb || 10 }
            );
          }
        }
      }
    }

    addCouplerPassThroughEdges(adj, graph, pcords, pigtails);

    return adj;
  }

  /**
   * Per-source optical readings at a probe key. One entry per reachable TX
   * source (OLT SFP or OLS-35 wavelength), so multi-λ sources yield one
   * reading each.
   */
  function collectOpticalSourceReadings(probeKey) {
    var sources = typeof api.getOltTxSources === 'function'
      ? api.getOltTxSources()
      : [];
    if (typeof api.getOlsTxSources === 'function') {
      sources = sources.concat(api.getOlsTxSources() || []);
    }
    var result = { sources: sources, readings: [] };
    if (!sources.length) return result;

    var adj = buildOpticalAdjacency();
    var graph = typeof api.getFiberLaserGraph === 'function'
      ? api.getFiberLaserGraph()
      : { pcords: [], pigtails: [] };
    var probeKeys = expandProbeKeys(probeKey, graph);
    var probeKeySet = {};
    probeKeys.forEach(function (k) { probeKeySet[k] = true; });
    var probeWavelengthNm = getOpmWavelengthNm();
    var si;
    for (si = 0; si < sources.length; si++) {
      var src = sources[si];
      if (!adj[src.key]) adj[src.key] = [];
      /* OLS emits at its calibrated λ — skip OLT SFP wavelength mismatch penalty */
      var wlPenalty = (src.kind === 'ols')
        ? 0
        : oltWavelengthPenaltyDb(probeWavelengthNm, src.wavelengthNm);
      var queue = [{
        key: src.key,
        loss: 0,
        path: [src.key],
        parts: emptyLossParts(),
      }];
      var visited = {};
      visited[src.key] = 0;
      var qi = 0;
      var bestForSrc = null;
      while (qi < queue.length) {
        var cur = queue[qi++];
        if (probeKeySet[cur.key]) {
          if (!bestForSrc || cur.loss < bestForSrc.loss) {
            bestForSrc = {
              loss: cur.loss,
              path: cur.path.slice(),
              parts: cloneLossParts(cur.parts),
            };
          }
          continue;
        }
        var edges = adj[cur.key] || [];
        var ei;
        for (ei = 0; ei < edges.length; ei++) {
          var e = edges[ei];
          var nextLoss = cur.loss + e.loss;
          if (visited[e.to] != null && visited[e.to] <= nextLoss + 1e-6) continue;
          visited[e.to] = nextLoss;
          queue.push({
            key: e.to,
            loss: nextLoss,
            path: cur.path.concat([e.to]),
            parts: sumLossParts(cur.parts, e.parts),
          });
        }
      }
      if (!bestForSrc) continue;
      var pathParts = cloneLossParts(bestForSrc.parts);
      result.readings.push({
        dBm: round2(src.txDbm - bestForSrc.loss - wlPenalty),
        lossDb: round2(bestForSrc.loss + wlPenalty),
        source: src,
        label: probeKey,
        path: bestForSrc.path,
        wavelengthNm: src.wavelengthNm || probeWavelengthNm,
        lossBreakdown: buildLossBreakdown(
          pathParts,
          bestForSrc.path,
          graph,
          probeWavelengthNm
        ),
      });
    }
    return result;
  }

  /** All reachable source readings (strongest first) — used for multi-λ displays. */
  function measureOpticalSourcesAtKey(probeKey) {
    if (!probeKey) return [];
    var readings = collectOpticalSourceReadings(probeKey).readings;
    return readings.sort(function (a, b) { return b.dBm - a.dBm; });
  }

  function measureOpticalAtKey(probeKey) {
    if (!probeKey) {
      return {
        dBm: null,
        lossDb: null,
        source: null,
        label: 'No probe target',
        path: [],
      };
    }
    var collected = collectOpticalSourceReadings(probeKey);
    if (!collected.sources.length) {
      return {
        dBm: OPM_NOISE_DBM,
        lossDb: null,
        source: null,
        label: probeKey,
        path: [],
        note: 'No TX source (OLT SFP or OLS-35 laser ON + docked fiber)',
      };
    }

    var best = null;
    collected.readings.forEach(function (r) {
      if (!best || r.dBm > best.dBm) best = r;
    });
    if (!best) {
      return {
        dBm: OPM_NOISE_DBM,
        lossDb: null,
        source: null,
        label: probeKey,
        path: [],
        note: 'No optical path to active TX source',
      };
    }
    best.allReadings = collected.readings.slice();
    if (!best.wavelengthNm) best.wavelengthNm = getOpmWavelengthNm();
    return best;
  }

  function hitTestProbeTarget(clientX, clientY) {
    if (typeof api.hitTestLabPort === 'function') {
      var portHit = api.hitTestLabPort(clientX, clientY);
      if (portHit) {
        return {
          kind: 'port',
          key: portKeyFromHit(portHit),
          label: portHit.label || 'Port',
          hit: portHit,
        };
      }
    }

    var list = document.elementsFromPoint
      ? document.elementsFromPoint(clientX, clientY)
      : [];
    var i;
    var el;
    for (i = 0; i < list.length; i++) {
      el = list[i];

      var pcEnd = el.closest && el.closest('[data-pcord-id][data-pcord-end]');
      if (pcEnd) {
        var cid = pcEnd.getAttribute('data-pcord-id');
        var end = pcEnd.getAttribute('data-pcord-end');
        return {
          kind: 'pcord-end',
          key: 'pcord:' + cid + ':' + end,
          label: 'Patch Cord · End ' + end,
        };
      }

      var pcDrag = el.closest && el.closest('[data-pcord-drag]');
      if (pcDrag) {
        var pid = pcDrag.getAttribute('data-pcord-drag');
        return {
          kind: 'pcord-fiber',
          key: 'pcord:' + pid + ':A',
          label: 'Patch Cord · fiber',
          altKeys: ['pcord:' + pid + ':B'],
        };
      }

      var pigConn = el.closest && el.closest('.lab-pigtail__conn');
      if (pigConn) {
        var pnode = pigConn.closest('[data-pigtail-node]');
        if (pnode) {
          var ptId = pnode.getAttribute('data-pigtail-node');
          var graph = typeof api.getFiberLaserGraph === 'function'
            ? api.getFiberLaserGraph()
            : { pigtails: [] };
          var pi;
          var pk = 'pigtail:' + ptId + ':conn';
          var plabel = 'SC Pigtail · Connector';
          for (pi = 0; pi < (graph.pigtails || []).length; pi++) {
            if (graph.pigtails[pi].id === ptId && graph.pigtails[pi].connector) {
              var attK = portKeyFromAtt(graph.pigtails[pi].connector);
              if (attK) {
                pk = attK;
                plabel = 'SC Pigtail · ' + (graph.pigtails[pi].connector.port || 'port');
              }
              break;
            }
          }
          return { kind: 'pigtail-conn', key: pk, label: plabel };
        }
      }

      var pigTail = el.closest && el.closest('.lab-pigtail__tail');
      if (pigTail) {
        var pnode2 = pigTail.closest('[data-pigtail-node]');
        if (pnode2) {
          return {
            kind: 'pigtail-tail',
            key: 'pigtail:' + pnode2.getAttribute('data-pigtail-node') + ':tail',
            label: 'SC Pigtail · Bare fiber',
          };
        }
      }
    }
    return null;
  }

  function probeOpticalAt(clientX, clientY) {
    var target = hitTestProbeTarget(clientX, clientY);
    if (!target) {
      return {
        dBm: null,
        lossDb: null,
        source: null,
        label: '—',
        path: [],
        note: 'Click a port, connector, or fiber to probe',
      };
    }
    var result = measureOpticalAtKey(target.key);
    if ((!result.source || result.dBm <= OPM_NOISE_DBM + 0.01) && target.altKeys) {
      var ai;
      for (ai = 0; ai < target.altKeys.length; ai++) {
        var alt = measureOpticalAtKey(target.altKeys[ai]);
        if (alt.source && (!result.source || alt.dBm > result.dBm)) {
          result = alt;
        }
      }
    }
    result.probe = target;
    result.label = target.label || result.label;
    return result;
  }

  function refreshOpmDisplay() {
    if (typeof opmRefreshHook === 'function') opmRefreshHook();
  }

  function handleLaunchQuery() {
    try {
      var params = new URLSearchParams(global.location.search || '');
      var tool = params.get('tool');
      if (tool === 'opm' || tool === 'power-meter') {
        api._launchTool = 'opm';
      }
    } catch (err) { /* ignore */ }
  }

  var currentProjectName = null;
  var currentProjectId = null;
  var TOOL_RESTORE_ORDER = [
    'olt-fx16',
    'smart-splitter',
    'sc-coupler',
    'fiber-spool',
    'bend-jig',
    'ols',
    'opm',
    'vfl',
    'otdr-machine',
    'sc-pigtail',
    'cable',
    'patch-cord',
  ];

  function cloneJson(value) {
    try {
      return JSON.parse(JSON.stringify(value == null ? null : value));
    } catch (err) {
      return null;
    }
  }

  function serializeProjectState() {
    var tools = {};
    Object.keys(state.tools).forEach(function (id) {
      var tool = state.tools[id];
      if (tool && typeof tool.exportProjectState === 'function') {
        try {
          tools[id] = tool.exportProjectState();
        } catch (err) {
          console.warn('[FtthLab] exportProjectState failed:', id, err);
        }
      }
    });
    return {
      version: 1,
      kind: projectWorkspaceKind(),
      savedAt: new Date().toISOString(),
      zoom2d: state.zoom2d,
      pan2dX: state.pan2dX,
      pan2dY: state.pan2dY,
      tools: tools,
    };
  }

  function resetAllToolWorkspaces() {
    Object.keys(state.tools).forEach(function (id) {
      var tool = state.tools[id];
      if (tool && typeof tool.resetProjectState === 'function') {
        try { tool.resetProjectState(); } catch (err) {
          console.warn('[FtthLab] resetProjectState failed:', id, err);
        }
      }
    });
    if (global.FtthLab) global.FtthLab._patchPending = null;
    notifyTools('cancelPatch');
    notifyTools('clearSelection');
    selectionOwner = null;
    resetInspectorIdle();
  }

  function resyncFiberAttachmentsAfterRestore() {
    var pigTool = state.tools['sc-pigtail'];
    var pcTool = state.tools['patch-cord'];
    if (pigTool && typeof pigTool.resyncAllAttachments === 'function') {
      try { pigTool.resyncAllAttachments(); } catch (err) {
        console.warn('[FtthLab] pigtail resync failed:', err);
      }
    }
    if (pcTool && typeof pcTool.resyncAllAttachments === 'function') {
      try { pcTool.resyncAllAttachments(); } catch (err2) {
        console.warn('[FtthLab] patch-cord resync failed:', err2);
      }
    }
  }

  function restoreProjectState(payload) {
    if (!payload || typeof payload !== 'object') return false;
    var kind = payload.kind;
    if (kind && kind !== projectWorkspaceKind()) {
      return false;
    }
    var toolsPayload = payload.tools && typeof payload.tools === 'object' ? payload.tools : {};
    resetAllToolWorkspaces();
    var seen = {};
    TOOL_RESTORE_ORDER.forEach(function (id) {
      seen[id] = true;
      var tool = state.tools[id];
      if (!tool || typeof tool.importProjectState !== 'function') return;
      try { tool.importProjectState(cloneJson(toolsPayload[id]) || {}); } catch (err) {
        console.warn('[FtthLab] importProjectState failed:', id, err);
      }
    });
    Object.keys(toolsPayload).forEach(function (id) {
      if (seen[id]) return;
      var tool = state.tools[id];
      if (!tool || typeof tool.importProjectState !== 'function') return;
      try { tool.importProjectState(cloneJson(toolsPayload[id]) || {}); } catch (err2) {
        console.warn('[FtthLab] importProjectState failed:', id, err2);
      }
    });
    if (typeof payload.zoom2d === 'number') state.zoom2d = payload.zoom2d;
    if (typeof payload.pan2dX === 'number') state.pan2dX = payload.pan2dX;
    if (typeof payload.pan2dY === 'number') state.pan2dY = payload.pan2dY;
    applyZoom2d();
    notifyTools('onLayoutChange', { source: 'project-restore' });
    resyncFiberAttachmentsAfterRestore();
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(function () {
        resyncFiberAttachmentsAfterRestore();
        notifyTools('onLayoutChange', { source: 'project-restore-final' });
      });
    }
    return true;
  }

  function clearWorkspace() {
    resetAllToolWorkspaces();
    state.zoom2d = 1;
    applyZoom2d();
    currentProjectName = null;
    currentProjectId = null;
    notifyTools('onLayoutChange', { source: 'project-clear' });
    setStatus('New empty project', true);
  }

  var api = {
    registerTool: registerTool,
    setViewMode: setViewMode,
    getViewMode: function () { return state.viewMode; },
    getRoot3d: function () { return state.root; },
    getMount2d: function () { return document.getElementById('lab-2d-mount'); },
    getCamera: function () { return state.camera; },
    getRenderer: function () { return state.renderer; },
    setStatus: setStatus,
    undo: undo,
    redo: redo,
    getZoom2d: function () { return state.zoom2d; },
    getPan2d: function () { return { x: state.pan2dX, y: state.pan2dY }; },
    getWorldSize: function () { return WORLD_SIZE; },
    /**
     * Lab scale for patch-cord Meter Mode (world px per real meter).
     * Amplified so 1–3 m jumpers read as long hanging spans on the 2D stage
     * (≈160 px/m — about 3× the previous 50 px/m feel).
     */
    getPxPerMeter: function () { return 160; },
    metersToWorldPx: function (m) {
      var n = Number(m);
      if (!isFinite(n) || n < 0) return 0;
      return n * 160;
    },
    worldPxToMeters: function (px) {
      var n = Number(px);
      if (!isFinite(n)) return 0;
      return n / 160;
    },
    /** Visual millimetre scale for pin tools (fiber spools). Independent of Meter Mode px/m. */
    getPxPerMm: function () { return 1.25; },
    mmToWorldPx: function (mm) {
      var n = Number(mm);
      if (!isFinite(n)) return 0;
      return n * 1.25;
    },
    centerWorldInView: centerWorldInView,
    showAlert: showAlert,
    showToast: showToast,
    setBudget: setBudget,
    refreshPowerBudget: refreshPowerBudget,
    /** Clamp uniform node scale used by OPM / VFL / splitter resize. */
    clampNodeScale: function (s, minS, maxS) {
      var lo = minS != null ? minS : 0.55;
      var hi = maxS != null ? maxS : 1.85;
      var n = Number(s);
      if (!isFinite(n)) return 1;
      if (n < lo) return lo;
      if (n > hi) return hi;
      return Math.round(n * 100) / 100;
    },
    /** SE corner resize grip markup for selected/hovered workspace nodes. */
    resizeHandleHtml: function () {
      return (
        '<span class="lab-resize-handle lab-resize-handle--se" data-lab-resize="se" ' +
        'title="Resize" role="presentation" aria-hidden="true"></span>'
      );
    },
    /** Apply uniform CSS scale (top-left origin) without destroying node markup. */
    applyNodeScale: function (el, scale) {
      if (!el) return 1;
      var s = api.clampNodeScale(scale);
      el.style.transformOrigin = '0 0';
      el.style.transform = 'translateZ(0) scale(' + s + ')';
      el.setAttribute('data-lab-scale', String(s));
      return s;
    },
    /**
     * Bind SE-corner uniform resize. opts:
     *   getScale / setScale(number), onLive(), onCommit(), min, max, baseSize (px diagonal driver)
     */
    bindUniformNodeResize: function (root, opts) {
      if (!root || !opts) return;
      opts = opts || {};
      root.querySelectorAll('[data-lab-resize]').forEach(function (handle) {
        if (handle.dataset.labResizeBound === '1') return;
        handle.dataset.labResizeBound = '1';
        handle.addEventListener('pointerdown', function (e) {
          if (e.button !== 0) return;
          e.preventDefault();
          e.stopPropagation();
          if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
          var startX = e.clientX;
          var startY = e.clientY;
          var startScale = api.clampNodeScale(
            typeof opts.getScale === 'function' ? opts.getScale() : 1,
            opts.min,
            opts.max
          );
          var base = opts.baseSize != null ? opts.baseSize : 220;
          var zoom = state.zoom2d || 1;
          var moved = false;
          root.classList.add('is-resizing');
          document.body.classList.add('lab-node-resizing');

          function onMove(ev) {
            var dx = (ev.clientX - startX) / zoom;
            var dy = (ev.clientY - startY) / zoom;
            var delta = Math.max(dx, dy);
            var next = api.clampNodeScale(startScale + delta / base, opts.min, opts.max);
            if (Math.abs(next - startScale) < 0.001 && !moved) return;
            moved = true;
            if (typeof opts.setScale === 'function') opts.setScale(next);
            api.applyNodeScale(root, next);
            if (typeof opts.onLive === 'function') opts.onLive(next);
          }

          function onUp() {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onUp);
            root.classList.remove('is-resizing');
            document.body.classList.remove('lab-node-resizing');
            if (moved && typeof opts.onCommit === 'function') opts.onCommit();
          }

          window.addEventListener('pointermove', onMove);
          window.addEventListener('pointerup', onUp);
          window.addEventListener('pointercancel', onUp);
        });
      });
    },
    getNetworkTelemetry: function () {
      var loss = 0;
      var mismatches = 0;
      Object.keys(state.tools).forEach(function (id) {
        var tool = state.tools[id];
        if (tool && typeof tool.getNetworkLossDb === 'function') {
          try { loss += Number(tool.getNetworkLossDb()) || 0; } catch (err) { /* ignore */ }
        }
        if (tool && typeof tool.getMismatchCount === 'function') {
          try { mismatches += Number(tool.getMismatchCount()) || 0; } catch (err2) { /* ignore */ }
        }
      });
      return {
        lossDb: Math.round(loss * 100) / 100,
        mismatches: mismatches,
      };
    },
    notifyLayoutChange: function (payload) {
      notifyTools('onLayoutChange', payload);
      refreshOpmDisplay();
    },
    beginDrag: beginDrag,
    endDrag: endDrag,
    getActiveDrag: getActiveDrag,
    clientToWorld2d: clientToWorld2d,
    clearStageDropHighlight: clearStageDropHighlight,
    recordHistory: recordHistory,
    updateHistoryUi: updateHistoryUi,
    deleteSelected: deleteSelected,
    flipSelected: flipSelected,
    setSelectionOwner: setSelectionOwner,
    claimToolboxTool: claimToolboxTool,
    getActiveToolboxTool: getActiveToolboxTool,
    getToolboxCategory: getToolboxCategory,
    TOOLBOX_CATEGORIES: TOOLBOX_CATEGORIES,
    applyFtthLabToolboxIcons: applyFtthLabToolboxIcons,
    applyFtthLabToolboxPresentation: applyFtthLabToolboxPresentation,
    enforceToolboxVisibility: enforceToolboxVisibility,
    applyLabConfigPayload: applyLabConfigPayload,
    isToolboxToolVisible: isToolboxToolVisible,
    shouldRenderToolboxTool: shouldRenderToolboxTool,
    anyToolboxToolVisible: anyToolboxToolVisible,
    gateToolboxRender: gateToolboxRender,
    handleToolboxConfigChange: handleToolboxConfigChange,
    handleToolboxConfigChangeMulti: handleToolboxConfigChangeMulti,
    resolveToolboxConfig: resolveToolboxConfig,
    setToolboxPreviewConfig: setToolboxPreviewConfig,
    clearToolboxPreviewConfig: clearToolboxPreviewConfig,
    applyFtthLabConfig: applyFtthLabConfig,
    notifyLabConfigPreview: notifyLabConfigPreview,
    getToolMeta: getToolMeta,
    getLabSettings: activeLabSettings,
    serializeProjectState: serializeProjectState,
    restoreProjectState: restoreProjectState,
    clearWorkspace: clearWorkspace,
    getCurrentProjectName: function () { return currentProjectName; },
    setCurrentProjectName: function (name) { currentProjectName = name || null; },
    getCurrentProjectId: function () { return currentProjectId; },
    setCurrentProjectId: function (id) { currentProjectId = id || null; },
    getPerformanceSpecs: getPerformanceSpecs,
    getSfpVariants: getSfpVariants,
    armDragOnlyToolboxTool: armDragOnlyToolboxTool,
    syncFtthLabAdminSettingsButton: syncFtthLabAdminSettingsButton,
    clearWorkspaceSelection: clearWorkspaceSelection,
    resetInspectorIdle: resetInspectorIdle,
    tryPatchPort: null,
    _patchPending: null,
    /* Optical / VFL laser — tools fill these in on mount */
    getFiberLaserGraph: function () { return { pcords: [], pigtails: [] }; },
    applyFiberLaserGlow: function () {},
    getSplitterLaserModels: function () { return []; },
    refreshVflLaser: null,
    refreshSplitterPorts: null,
    getCouplerOppositePort: function (port) {
      return (port === 'B' || port === 'b') ? 'A' : 'B';
    },
    isCouplerId: function () { return false; },
    getOltTxSources: function () { return []; },
    getOlsTxSources: function () { return []; },
    getOpticalSplitters: function () { return []; },
    hitTestLabPort: null,
    probeOpticalAt: probeOpticalAt,
    measureOpticalAtKey: measureOpticalAtKey,
    measureOpticalSourcesAtKey: measureOpticalSourcesAtKey,
    photodiodeResponsivity: photodiodeResponsivity,
    photodiodeCurrentA: photodiodeCurrentA,
    responsivityErrorDb: responsivityErrorDb,
    calibratedReadingDbm: calibratedReadingDbm,
    dbmToMilliwatts: dbmToMilliwatts,
    formatMilliwatts: formatMilliwatts,
    getOpmWavelength: getOpmWavelengthNm,
    setOpmWavelength: setOpmWavelength,
    fiberSpanLossDb: fiberSpanLossDb,
    fiberAttenuationDbPerKm: fiberAttenuationDbPerKm,
    registerOpmRefresh: function (fn) {
      if (typeof fn !== 'function') return;
      var prev = opmRefreshHook;
      opmRefreshHook = function () {
        if (typeof prev === 'function') {
          try { prev(); } catch (err) { /* ignore */ }
        }
        try { fn(); } catch (err2) { /* ignore */ }
      };
    },
    OPM_NOISE_DBM: OPM_NOISE_DBM,
    /**
     * Lab 2D world uses screen Y+ downward. Fiber mid-span sag / catenary
     * offsets must stay on the +Y (hanging) side of the chord — never upward.
     */
    worldYDown: true,
    /**
     * Free connector CSS rotate() clamp (degrees).
     * 0° = ferrule up / boot down. Values outside ±maxTilt put the head
     * upside-down — keep free ends in the upright hemisphere while still
     * allowing full left (−90) / right (+90) yaw.
     */
    HEADING_MAX_TILT_DEG: 90,
    /**
     * Normalize to (−180, 180] then clamp into the upright cone so the
     * ferrule never flips nose-down during free drag / layout.
     */
    clampConnectorHeadingUpright: function (rotDeg, maxTiltDeg) {
      var maxTilt = maxTiltDeg != null ? maxTiltDeg : api.HEADING_MAX_TILT_DEG;
      if (!(maxTilt > 0)) maxTilt = 90;
      var a = Number(rotDeg);
      if (!isFinite(a)) return 0;
      a = ((a + 180) % 360 + 360) % 360 - 180;
      if (a > maxTilt) return maxTilt;
      if (a < -maxTilt) return -maxTilt;
      return a;
    },
    /**
     * Motion → free-head CSS degrees. Horizontal drag keeps natural L/R yaw;
     * downward screen motion is ignored so the nose never aims down.
     */
    headingRotFromMotionUpright: function (dx, dy, maxTiltDeg) {
      var ax = Number(dx) || 0;
      var ay = Number(dy) || 0;
      /* Screen Y+ down — drop positive dy so vertical pulls stay upright */
      if (ay > 0) ay = 0;
      if (Math.abs(ax) < 1e-9 && Math.abs(ay) < 1e-9) return 0;
      var rot = Math.atan2(ax, -ay) * 180 / Math.PI;
      return api.clampConnectorHeadingUpright(rot, maxTiltDeg);
    },
    /**
     * Scale strain-relief stub length from boot→peer facing cosine
     * (+1 toward peer, −1 away). Short stubs when reversed prevent fold-over.
     */
    adaptiveFiberStubScale: function (face) {
      var f = Number(face);
      if (!isFinite(f)) return 1;
      if (f >= 0.35) return 1;
      if (f >= 0) return 0.55 + 0.45 * (f / 0.35);
      return Math.max(0.28, 0.45 + f * 0.35);
    },
    /**
     * Extra cable length as a fraction of tip-to-tip span when either boot
     * faces away — room for a natural U-turn catenary instead of a kink.
     */
    opposingFiberSlackFraction: function (faceA, faceB) {
      var away = 0;
      var a = Number(faceA);
      var b = Number(faceB);
      if (isFinite(a) && a < 0.25) away += (0.25 - a) * 0.22;
      if (isFinite(b) && b < 0.25) away += (0.25 - b) * 0.22;
      return away;
    },
    /**
     * Default free patch-cord spawn (horizontal face-to-face + catenary sag).
     * CSS rotate: bootOut(θ)=(−sin θ, cos θ) → A −90° boot +X, B +90° boot −X.
     */
    PATCH_CORD_DEFAULT_SPAN_PX: 180,
    PATCH_CORD_DEFAULT_ROT_A: -90,
    PATCH_CORD_DEFAULT_ROT_B: 90,
    PATCH_CORD_DEFAULT_SAG_SLACK: 1.18,
    /**
     * 60mm splice protection sleeve — fixed lab-world px (~7:1 vs 2.15px bare fiber).
     * Same size for free workspace sleeves and pigtail-mounted sleeves.
     */
    SLEEVE_60MM_W_PX: 56,
    SLEEVE_60MM_H_PX: 8,
    getSleeveSizePx: function () {
      return { w: api.SLEEVE_60MM_W_PX, h: api.SLEEVE_60MM_H_PX };
    },
    /**
     * Elastic rubber-band sag (screen y+ down). Depth scales with tip span;
     * excess lengthPx (Meter Mode / locked length) deepens the belly.
     */
    elasticFiberSagPx: function (chordPx, lengthPx) {
      var chord = Math.max(1, Number(chordPx) || 1);
      var sag = Math.min(160, Math.max(14, chord * 0.28));
      var L = Number(lengthPx);
      if (isFinite(L) && L > chord) {
        var excess = L - chord;
        sag = Math.max(
          sag,
          Math.sqrt(Math.max(0, excess * chord * 0.5)) * 0.55
        );
      }
      return Math.max(16, Math.min(160, sag));
    },
    /**
     * Midpoint belly for elastic fiber curves (screen y+ down).
     */
    elasticFiberBelly: function (p0, p3, lengthPx) {
      if (!p0 || !p3) return { x: 0, y: 0 };
      var dx = p3.x - p0.x;
      var dy = p3.y - p0.y;
      var chord = Math.sqrt(dx * dx + dy * dy) || 1;
      var sag = api.elasticFiberSagPx(chord, lengthPx);
      return {
        x: (p0.x + p3.x) * 0.5,
        y: (p0.y + p3.y) * 0.5 + sag,
      };
    },
    /**
     * Sample an elastic hang between two tips (parabolic through gravity belly).
     * Used by pigtails / fallbacks before patch-cord overrides samplers.
     */
    CATENARY_DEFAULT_SLACK: 1.12,
    sampleFiberCatenary: function (p0, p3, length, count) {
      count = Math.max(2, count || 48);
      if (!p0 || !p3) return [];
      var dx = p3.x - p0.x;
      var dy = p3.y - p0.y;
      var chord = Math.sqrt(dx * dx + dy * dy) || 1;
      var slack = api.CATENARY_DEFAULT_SLACK || 1.12;
      var L = Math.max(length || chord * slack, chord * 1.0002);
      var sag = api.elasticFiberSagPx(chord, L);
      var pts = [];
      var i;
      for (i = 0; i < count; i++) {
        var t = count === 1 ? 0.5 : i / (count - 1);
        pts.push({
          x: p0.x + dx * t,
          y: p0.y + dy * t + 4 * sag * t * (1 - t),
        });
      }
      pts[0] = { x: p0.x, y: p0.y };
      pts[count - 1] = { x: p3.x, y: p3.y };
      return pts;
    },
    fiberCatenarySagDepth: function (dist) {
      return api.elasticFiberSagPx(dist, dist * (api.CATENARY_DEFAULT_SLACK || 1.12));
    },
    fiberCatenaryLengthForSag: function (p0, p3, targetSag) {
      if (!p0 || !p3) return 1;
      var dx = p3.x - p0.x;
      var dy = p3.y - p0.y;
      var chord = Math.sqrt(dx * dx + dy * dy) || 1;
      var sag = Math.max(0, Number(targetSag) || 0);
      if (sag < 1) return chord * 1.002;
      /* Approximate arc length for a parabolic hang of depth `sag`. */
      return chord + (8 * sag * sag) / (3 * Math.max(chord, 1));
    },
    /** Recompute VFL → fiber → PLC / coupler glow (full-pass adapters). */
    refreshOpticalLaser: function () {
      if (typeof api.refreshVflLaser === 'function') api.refreshVflLaser();
    },
  };

  global.FtthLab = api;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(typeof window !== 'undefined' ? window : this);
