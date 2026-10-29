/**
 * FTTH Network Simulator — Virtual City Core v3.9
 * As-Built GIS symbols, LM_Excavation polylines, FAT Pole, settings panel.
 */
(function (global) {
  'use strict';

  var DEBUG = !!(global && global.FTTH_DEBUG);

  var FIELD_HH_GREEN = '#39ff14';
  var FIELD_HH_GREEN_FILL = 'transparent';
  /** FAT pole glyph — tight bbox; bottom of stem = anchor (no phantom padding). */
  var FAT_POLE_GLYPH_W = 24;
  var FAT_POLE_GLYPH_H = 31;
  /** Hollow splitter-box center in pole viewBox (y=3..7.5). */
  var FAT_POLE_BOX_CENTER_Y = 5.25;
  var FIELD_CL_RED = '#FF0000';
  var FIELD_SPLITTER_STROKE = '#c4b5fd';
  var FIELD_SPLITTER_FILL = 'rgba(124, 58, 237, 0.72)';
  var FIELD_SPLITTER_LINE = '#ddd6fe';
  var FIELD_SPLITTER_TEXT = '#f5f3ff';

  var Sim = {
    activeCityId: 'training_city_1',
    coordinateMode: 'geographic',
    uploadedMapLayout: null,
    uploadedMapImage: null,
    selectedTool: null,
    selectedCableSpec: null,
    cableDraftFrom: null,
    layout: null,
    nodes: [],
    connections: [],
    nodeId: 0,
    connId: 0,
    zoom: 1,
    panX: 0,
    panY: 0,
    navigationMode: 'open',
    templateOrigin: { x: 0, y: 0 },
    interactionMode: 'select',
    currentTool: 'select',
    isPanning: false,
    panSession: null,
    suppressMapClick: false,
    selectedNodeId: null,
    moveNodeId: null,
    dragMoveNodeId: null,
    nestDropHandled: false,
    labelDragSession: null,
    selectedSplitterVariant: null,
    mapRotation: 0,
    settings: {
      labelFontSize: 11,
      labelColor: '#ffffff',
      mapRotationEnabled: false,
    },
    counters: {
      handhole: 0,
      closure: 0,
      fdt: 0,
      fatHandhole: 0,
      fatSystem: 0,
      pole: 0,
      cableByCapacity: {},
    },
    /* Per-cabinet (FDT) naming domains — keyed by FDT node id */
    countersByCabinet: {},
    excavationPaths: [],
    excavationPathId: 0,
    fiberCablePaths: [],
    fiberCablePathId: 0,
    penDraft: null,
    crosshair: null,
    selectedPath: null,
    topologyHighlight: null,
    activeCanvasTool: 'select',
    currentMode: 'pan',
    pathEdit: {
      drag: null, context: null, editActive: false,
      splitToolActive: false, vertexToolActive: false,
      cutHover: null, cutSwipe: null,
      selectedVertexIndex: null, editingPathId: null, isDraggingVertex: false,
      ghostPosition: null, ghostActive: false, ghostDragging: false,
      ghostPendingCommit: false, ghostCommit: null,
      ghostSnapped: false, ghostSnapTarget: null, frozenPoints: null, frozenPathD: null,
    },
    hoveredPath: null,
    pen: {
      lineMode: null,
      excavKind: 'direct_buried',
      cableGroupId: 'ftth',
      cableCapacity: 72,
      cableKind: 'distribution',
      selectedLineId: null,
    },
    ui: {
      toolboxCollapsed: false,
      evalCollapsed: false,
      categoryCollapsed: {},
      cableCapacity: { distribution: 72, lastmile: 12 },
      cableConfig: {
        lastmile: { capacity: 12, batch: 1 },
        distribution: { capacity: 72, batch: 1 },
      },
      activeCableKind: 'distribution',
      lastInstalledElementLabel: null,
      cableCategoryCollapsed: { ftth: true, lastmile: true },
      propertyPanelTab: 'attributes',
      pathPanelTab: 'info',
      pathExcavAccordionOpen: false,
      topologyTreeFocus: null,
      pathHighlightFromSidebar: false,
      sidebarEditMode: false,
      /** Active Cabinet/FDT node id — scopes naming, badges, and matrix.
       *  Locked: only toolbox quick-switcher may change this (never map inspect). */
      activeFdtId: null,
      /** Once user picks a toolbox batch, never auto-advance/reset it. */
      cableBatchLocked: false,
      toolboxWidth: 250,
      evalPanelWidth: 256,
      sidePanelResizeBound: false,
      sidebarSectionCollapsed: { excav: false, cable: false },
      sidebarEventsBound: false,
      splitterVariant: '1x8',
      toolboxLockMode: false,
      spacePanActive: false,
      middleMousePanActive: false,
      mapGesturePanActive: false,
      mapGestureSession: null,
      toolboxClickDelayMs: 280,
      hudBound: false,
      workspaceDelegationBound: false,
      contextMenuNodeId: null,
      wheelZoomTimer: null,
      workspaceDropBound: false,
      dragDropCleanupBound: false,
      toolboxDragPreviewBound: false,
      smartStatusBarBound: false,
      clickToMoveActive: false,
      pathPickCycle: null,
      dragDropActive: false,
      lastDragOverCell: null,
      lastDragOverPointer: null,
      lastCanvasPointer: null,
      toolbarClipboard: null,
      canvasPointerTrackBound: false,
      workspaceModeBound: false,
      settingsBound: false,
      currentProjectName: null,
      penEventsBound: false,
      pathEditBound: false,
      drawEngineBound: false,
      pathEditorBound: false,
      wheelZoomBound: false,
      globalKeyboardBound: false,
      wasFullscreen: false,
      fullscreenKeydownBound: false,
    },
    history: {
      undoStack: [],
      redoStack: [],
      applying: false,
      max: 50,
    },
    metrics: {
      coverageScore: null,
      fiberDistanceM: null,
      spareCapacityPct: null,
      lossBudgetDb: null,
      otdrLinks: [],
      boqItems: [],
      fdtCount: 0,
      homesPassed: 0,
    },
  };

  var CELL = {
    BUILD: 'build', STREET: 'street', SIDEWALK: 'sidewalk',
    CANVAS: 'canvas',
    ITPC: 'itpc', PARK: 'park', POI: 'poi', RES_BLOCK: 'res_block',
  };

  var HOME_COUNTS = [4, 6, 7, 8, 10, 12, 15, 18, 24, 32, 48, 64];
  var SIDEWALK_TOOLS = { handhole: 1, fat_handhole: 1, fdt: 1, olt: 1 };

  var EQUIPMENT = [
    { id: 'olt', label: 'OLT / ITPC Exchange', icon: '🏛️', color: '#7c3aed', visual: 'olt' },
    { id: 'fdt', label: 'FDT', icon: 'FDT', color: '#f59e0b', visual: 'fdt' },
    { id: 'closure', label: 'Closure', icon: '🟥', color: '#ef4444', visual: 'closure', nestOnly: true },
  ];

  var LM_HOLES_CATEGORY = {
    id: 'LM_Holes',
    label: 'LM_Holes',
    color: '#39ff14',
  };

  var LM_HOLES_TOOLS = [
    { id: 'handhole', label: 'Handhole', color: '#39ff14', visual: 'handhole' },
    { id: 'fat_handhole', label: 'FAT Handhole', color: '#39ff14', visual: 'fat_handhole' },
  ];

  var LM_POLES_CATEGORY = {
    id: 'LM_Poles',
    label: 'LM_Poles',
    color: '#808080',
  };

  var LM_POLES_TOOLS = [
    { id: 'fat_pole', label: 'FAT Pole', color: '#808080', visual: 'fat_pole', nestOnly: true, hostType: 'fat_handhole' },
  ];

  /** Live map counts on toolbox cards (cables/trenches excluded). */
  var TOOLBOX_ASSET_COUNT_TOOLS = {
    olt: 'OLT exchanges',
    fdt: 'cabinets',
    closure: 'closures',
    handhole: 'handholes',
    fat_handhole: 'FAT handholes',
    fat_pole: 'poles',
  };

  var PEN_TOOL_ID = 'pen_tool';

  var EXCAVATION_TOOLS = [
    { id: 'excav_microtrench', label: 'MicroTrench', color: '#a8a29e', routeKind: 'microtrench', dash: '' },
    { id: 'excav_direct_buried', label: 'Direct Buried', color: '#78716c', routeKind: 'direct_buried', dash: '4 3' },
    { id: 'excav_hdd', label: 'HDD', color: '#6366f1', routeKind: 'hdd', dash: '2 4' },
  ];

  var CABLE_GROUPS = [
    { id: 'ftth', label: 'FTTH Cable', kind: 'distribution', capacities: [48, 72, 144, 288], defaultCap: 72 },
    { id: 'lastmile', label: 'Last Mile Cabel', kind: 'lastmile', capacities: [12, 24, 36, 48], defaultCap: 12 },
  ];

  var SPLITTER_VARIANTS = ['1x2', '1x4', '1x8', '1x16', '2x4', '2x8', '2x16'];

  var TOOLBOX = EQUIPMENT.concat(LM_HOLES_TOOLS);

  function loadPersistedSettings() {
    global.FTTHSimulatorSettings.loadPersistedSettings();
  }

  function persistLayoutSettings() {
    return global.FTTHSimulatorSettings.persistLayoutSettings();
  }

  function saveSettings() {
    global.FTTHSimulatorSettings.saveSettings();
  }

  function emptyCabinetCounters() {
    return {
      handhole: 0,
      closure: 0,
      fatHandhole: 0,
      fatSystem: 0,
      pole: 0,
      cableByCapacity: {},
    };
  }

  function resetNameCounters() {
    Sim.counters.handhole = 0;
    Sim.counters.closure = 0;
    Sim.counters.fdt = 0;
    Sim.counters.fatHandhole = 0;
    Sim.counters.fatSystem = 0;
    Sim.counters.pole = 0;
    Sim.counters.cableByCapacity = {};
    Sim.countersByCabinet = {};
  }

  function getActiveFdtId() {
    return Sim.ui && Sim.ui.activeFdtId ? String(Sim.ui.activeFdtId) : null;
  }

  function getActiveFdtNode() {
    var id = getActiveFdtId();
    return id ? findNode(id) : null;
  }

  function getActiveFdtLabel() {
    var n = getActiveFdtNode();
    if (!n) return '';
    return getFdtCabinetCode(n) || n.autoName || ('FDT');
  }

  function getActiveFdtNumber() {
    var label = getActiveFdtLabel();
    var m = String(label || '').match(/(\d+)\s*$/);
    return m ? m[1] : '';
  }

  function ensureCabinetCounterBucket(cabinetId) {
    if (!cabinetId) return emptyCabinetCounters();
    var key = String(cabinetId);
    if (!Sim.countersByCabinet) Sim.countersByCabinet = {};
    if (!Sim.countersByCabinet[key]) {
      Sim.countersByCabinet[key] = emptyCabinetCounters();
    } else if (!Sim.countersByCabinet[key].cableByCapacity) {
      Sim.countersByCabinet[key].cableByCapacity = {};
    }
    return Sim.countersByCabinet[key];
  }

  function mirrorActiveCabinetCountersToSim() {
    var cabId = getActiveFdtId();
    if (!cabId) return;
    var bucket = ensureCabinetCounterBucket(cabId);
    Sim.counters.handhole = bucket.handhole || 0;
    Sim.counters.closure = bucket.closure || 0;
    Sim.counters.fatHandhole = bucket.fatHandhole || 0;
    Sim.counters.fatSystem = bucket.fatSystem || 0;
    Sim.counters.pole = bucket.pole || 0;
    Sim.counters.cableByCapacity = JSON.parse(JSON.stringify(bucket.cableByCapacity || {}));
  }

  function nodeBelongsToCabinet(node, cabinetId) {
    if (!cabinetId) return true;
    if (!node) return false;
    if (node.type === 'fdt') return String(node.id) === String(cabinetId);
    if (node.type === 'olt') return false;
    return String(node.ownerFdtId || '') === String(cabinetId);
  }

  function resolveCableOwnerFdtId(cable) {
    if (!cable) return null;
    if (cable.ownerFdtId && findNode(cable.ownerFdtId)) return String(cable.ownerFdtId);
    if (cable.mainCableTrail && cable.mainCableTrail.cabinetId) {
      return String(cable.mainCableTrail.cabinetId);
    }
    if (cable.subCableTrail && cable.subCableTrail.closureId) {
      var clo = findNode(cable.subCableTrail.closureId);
      if (clo && clo.ownerFdtId) return String(clo.ownerFdtId);
      var viaClo = findServingFdt(clo);
      if (viaClo) return String(viaClo.id);
    }
    var ends = getCableEndpointNodes(cable.pointSnapNodeIds || []);
    var fdt = (ends.start && ends.start.type === 'fdt') ? ends.start
      : (ends.end && ends.end.type === 'fdt') ? ends.end
      : findServingFdt(ends.start) || findServingFdt(ends.end);
    return fdt ? String(fdt.id) : getActiveFdtId();
  }

  function cableBelongsToCabinet(cableOrId, cabinetId) {
    if (!cabinetId) return true;
    if (cableOrId == null) return false;
    var cable = cableOrId;
    if (typeof cableOrId !== 'object') {
      cable = findPathByRef({ type: 'fiber', id: cableOrId });
    }
    if (!cable) return false;
    return String(resolveCableOwnerFdtId(cable) || '') === String(cabinetId);
  }

  /**
   * Cabinet scope for Evaluation/Details inspection of a selected node.
   * Returns that node's owner cabinet — never the locked Active FDT fallback —
   * so foreign-cabinet reviews stay visible without shifting draw domain.
   * null = show linked assets without cabinet filtering.
   */
  function resolveInspectionCabinetId(node) {
    if (!node) return null;
    if (node.type === 'fdt') return String(node.id);
    if (node.ownerFdtId) return String(node.ownerFdtId);
    return null;
  }

  /** Cabinet id for the current Evaluation selection (node or path), if any. */
  function getInspectedCabinetId() {
    if (Sim.selectedNodeId) {
      return resolveInspectionCabinetId(findNode(Sim.selectedNodeId));
    }
    if (!Sim.selectedPath) return null;
    var meta = getPathSidebarMeta(Sim.selectedPath);
    if (!meta || !meta.path) return null;
    var path = meta.path;
    var pType = Sim.selectedPath.type;
    if (pType === 'fiber' || pType === 'cable') {
      return resolveCableOwnerFdtId(path);
    }
    if (path.ownerFdtId) return String(path.ownerFdtId);
    var linked = (Sim.nodes || []).filter(function (n) {
      return n && (n.type === 'handhole' || n.type === 'fat_handhole' || n.type === 'fdt') &&
        pathEndpointTouchesNode(path, n);
    });
    var i;
    for (i = 0; i < linked.length; i++) {
      if (linked[i].type === 'fdt') return String(linked[i].id);
      if (linked[i].ownerFdtId) return String(linked[i].ownerFdtId);
    }
    return null;
  }

  function formatCabinetBadgeSuffix(cabinetId) {
    if (!cabinetId) return '';
    var fdt = findNode(cabinetId);
    if (!fdt) return '';
    var label = getFdtCabinetCode(fdt) || fdt.autoName || '';
    return label ? (' · ' + label) : '';
  }

  /** Details-panel section suffix: inspected cabinet when reviewing, else Active FDT. */
  function formatDetailsPanelFdtBadgeSuffix() {
    var inspected = getInspectedCabinetId();
    if (inspected) return formatCabinetBadgeSuffix(inspected);
    return formatActiveFdtBadgeSuffix();
  }

  /**
   * Infer trench ownership from endpoint assets / hosted cables.
   * Strict: trenches owned by another cabinet are excluded from the active domain.
   */
  function excavationBelongsToCabinet(path, cabinetId) {
    if (!cabinetId) return true;
    if (!path) return false;
    if (path.ownerFdtId && findNode(path.ownerFdtId)) {
      return String(path.ownerFdtId) === String(cabinetId);
    }

    var sawOwn = false;
    var sawForeign = false;
    var i;
    var nodes = Sim.nodes || [];
    for (i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (!n) continue;
      if (n.type !== 'handhole' && n.type !== 'fat_handhole' &&
          n.type !== 'fdt' && n.type !== 'pole_foundation') continue;
      if (!pathEndpointTouchesNode(path, n)) continue;
      if (n.type === 'fdt') {
        if (String(n.id) === String(cabinetId)) sawOwn = true;
        else sawForeign = true;
      } else if (nodeBelongsToCabinet(n, cabinetId)) {
        sawOwn = true;
      } else if (n.ownerFdtId) {
        sawForeign = true;
      }
    }

    var cables = Sim.fiberCablePaths || [];
    for (i = 0; i < cables.length; i++) {
      var c = cables[i];
      if (!c) continue;
      var onTrench = c.hostTrenchId === path.id || c.trenchPathId === path.id ||
        ((c.trenchPathIds || []).indexOf(path.id) >= 0);
      if (!onTrench) continue;
      if (cableBelongsToCabinet(c, cabinetId)) sawOwn = true;
      else if (resolveCableOwnerFdtId(c)) sawForeign = true;
    }

    if (sawOwn) return true;
    if (sawForeign) return false;
    return true;
  }

  function syncSelectionToActiveFdt() {
    var cabId = getActiveFdtId();
    if (!cabId) return false;
    var cleared = false;

    if (Sim.selectedNodeId) {
      var node = findNode(Sim.selectedNodeId);
      if (node && !nodeBelongsToCabinet(node, cabId)) {
        Sim.selectedNodeId = null;
        document.querySelectorAll('.placed-node.selected').forEach(function (el) {
          el.classList.remove('selected');
        });
        cleared = true;
      }
    }

    if (Sim.selectedPath) {
      var meta = getPathSidebarMeta(Sim.selectedPath);
      var path = meta && meta.path;
      var pType = Sim.selectedPath.type;
      var outOfScope = false;
      if (!path) {
        outOfScope = true;
      } else if (pType === 'fiber' || pType === 'cable') {
        outOfScope = !cableBelongsToCabinet(path, cabId);
      } else if (pType === 'excavation') {
        outOfScope = !excavationBelongsToCabinet(path, cabId);
      }
      if (outOfScope) {
        Sim.selectedPath = null;
        if (Sim.pathEdit) {
          Sim.pathEdit.editingPathId = null;
          Sim.pathEdit.editActive = false;
        }
        cleared = true;
      }
    }

    if (cleared) {
      clearTopologyHighlight();
      Sim.ui.topologyTreeFocus = null;
      Sim.ui.pathHighlightFromSidebar = false;
      Sim.ui.sidebarEditMode = false;
    }
    return cleared;
  }

  function syncSmartBarActiveFdtBadge() {
    var badge = document.getElementById('status-bar-active-fdt');
    var sep = document.getElementById('status-bar-fdt-sep');
    var label = getActiveFdtLabel();
    var num = getActiveFdtNumber();
    if (!badge) return;
    if (!label) {
      badge.hidden = true;
      badge.setAttribute('aria-hidden', 'true');
      badge.textContent = '';
      badge.removeAttribute('title');
      if (sep) {
        sep.hidden = true;
        sep.setAttribute('aria-hidden', 'true');
      }
      return;
    }
    var text = 'FDT ' + (num || String(label).replace(/^FDT\s*/i, ''));
    badge.hidden = false;
    badge.removeAttribute('aria-hidden');
    badge.textContent = text;
    badge.title = 'Active cabinet · ' + label;
    if (sep) {
      sep.hidden = false;
      sep.removeAttribute('aria-hidden');
    }
  }

  function ensureNodeOwnerFdt(node) {
    if (!node || node.type === 'fdt' || node.type === 'olt') return null;
    if (node.ownerFdtId && findNode(node.ownerFdtId)) return String(node.ownerFdtId);
    var active = getActiveFdtId();
    if (active) {
      node.ownerFdtId = active;
      return active;
    }
    var serving = findServingFdt(node);
    if (serving) {
      node.ownerFdtId = String(serving.id);
      return node.ownerFdtId;
    }
    return null;
  }

  function migrateOwnerFdtIdsFromMap() {
    (Sim.nodes || []).forEach(function (node) {
      if (!node || node.type === 'fdt' || node.type === 'olt') return;
      if (node.ownerFdtId && findNode(node.ownerFdtId)) return;
      var serving = findServingFdt(node);
      if (serving) node.ownerFdtId = String(serving.id);
      else if (getActiveFdtId()) node.ownerFdtId = getActiveFdtId();
    });
    (Sim.fiberCablePaths || []).forEach(function (cable) {
      if (!cable) return;
      if (cable.ownerFdtId && findNode(cable.ownerFdtId)) return;
      var oid = resolveCableOwnerFdtId(cable);
      if (oid) cable.ownerFdtId = oid;
    });
  }

  /**
   * Set Active FDT. Strict lock: map/draw/select must NOT change cabinet context.
   * Allowed only via:
   *   - opts.manual (toolbox quick-switcher arrows/dropdown)
   *   - opts.bootstrap (no active FDT yet — first cabinet / load fallback)
   */
  function setActiveFdt(fdtNodeOrId, opts) {
    opts = opts || {};
    if (!opts.manual && !opts.bootstrap) {
      return false;
    }
    var node = null;
    if (fdtNodeOrId && typeof fdtNodeOrId === 'object') node = fdtNodeOrId;
    else if (fdtNodeOrId != null) node = findNode(fdtNodeOrId);
    if (!node || node.type !== 'fdt') return false;
    var id = String(node.id);
    var changed = String(Sim.ui.activeFdtId || '') !== id;
    Sim.ui.activeFdtId = id;
    ensureCabinetCounterBucket(id);
    mirrorActiveCabinetCountersToSim();
    /* Batch preference is independently locked — never auto-reset here. */
    refreshBatchDuplicationHint(getActiveCableKind());
    updateToolboxAssetCounts();
    if (changed || opts.force) {
      /* Manual switch only: drop selections that belong to another cabinet. */
      if (opts.manual) syncSelectionToActiveFdt();
    }
    syncActiveFdtChrome();
    if (changed || opts.force) {
      if (global.FTTHFiberDesignUI && typeof global.FTTHFiberDesignUI.onActiveFdtChanged === 'function') {
        global.FTTHFiberDesignUI.onActiveFdtChanged(id, getActiveFdtLabel());
      }
      updateMetrics();
      renderUnifiedSidebar();
      renderGlobalDrawingLayer();
    }
    return true;
  }

  function ensureActiveFdtFallback() {
    if (getActiveFdtNode()) return getActiveFdtId();
    var fdts = (Sim.nodes || []).filter(function (n) { return n && n.type === 'fdt'; });
    if (!fdts.length) {
      Sim.ui.activeFdtId = null;
      syncActiveFdtChrome();
      return null;
    }
    fdts.sort(function (a, b) {
      return String(a.autoName || a.id).localeCompare(String(b.autoName || b.id), undefined, { numeric: true });
    });
    setActiveFdt(fdts[0], { bootstrap: true, force: true });
    return getActiveFdtId();
  }

  function formatActiveFdtBadgeSuffix() {
    var label = getActiveFdtLabel();
    return label ? (' · ' + label) : '';
  }

  function listFdtNodesSorted() {
    var fdts = (Sim.nodes || []).filter(function (n) { return n && n.type === 'fdt'; });
    fdts.sort(function (a, b) {
      return String(a.autoName || a.id).localeCompare(String(b.autoName || b.id), undefined, { numeric: true });
    });
    return fdts;
  }

  function cycleActiveFdt(delta) {
    var fdts = listFdtNodesSorted();
    if (!fdts.length) return false;
    var cur = getActiveFdtId();
    var idx = 0;
    var i;
    for (i = 0; i < fdts.length; i++) {
      if (String(fdts[i].id) === String(cur)) {
        idx = i;
        break;
      }
    }
    var next = fdts[(idx + (delta || 1) + fdts.length * 10) % fdts.length];
    return setActiveFdt(next, { manual: true, force: true });
  }

  function closeFdtHeadMenu(head) {
    if (!head) {
      document.querySelectorAll('.toolbox-fdt-head__menu').forEach(function (m) {
        m.hidden = true;
        m.classList.remove('is-open');
      });
      document.querySelectorAll('.toolbox-fdt-head__badge[aria-expanded="true"]').forEach(function (b) {
        b.setAttribute('aria-expanded', 'false');
      });
      return;
    }
    var menu = head.querySelector('.toolbox-fdt-head__menu');
    var badge = head.querySelector('.toolbox-fdt-head__badge');
    if (menu) {
      menu.hidden = true;
      menu.classList.remove('is-open');
    }
    if (badge) badge.setAttribute('aria-expanded', 'false');
  }

  function openFdtHeadMenu(head) {
    if (!head) return;
    closeFdtHeadMenu();
    var menu = head.querySelector('.toolbox-fdt-head__menu');
    var badge = head.querySelector('.toolbox-fdt-head__badge');
    if (!menu) return;
    menu.hidden = false;
    menu.classList.add('is-open');
    if (badge) badge.setAttribute('aria-expanded', 'true');
  }

  function rebuildFdtHeadMenu(head) {
    if (!head) return;
    var menu = head.querySelector('.toolbox-fdt-head__menu');
    if (!menu) return;
    var fdts = listFdtNodesSorted();
    var activeId = getActiveFdtId();
    menu.innerHTML = '';
    if (!fdts.length) {
      var empty = document.createElement('div');
      empty.className = 'toolbox-fdt-head__menu-empty';
      empty.textContent = 'No cabinets placed';
      menu.appendChild(empty);
      return;
    }
    fdts.forEach(function (fdt) {
      var opt = document.createElement('button');
      opt.type = 'button';
      opt.className = 'toolbox-fdt-head__option';
      opt.setAttribute('role', 'option');
      opt.dataset.fdtId = String(fdt.id);
      var lbl = getFdtCabinetCode(fdt) || fdt.autoName || String(fdt.id);
      opt.textContent = lbl;
      opt.title = 'Switch to ' + lbl;
      if (activeId && String(fdt.id) === String(activeId)) {
        opt.classList.add('is-active');
        opt.setAttribute('aria-selected', 'true');
      } else {
        opt.setAttribute('aria-selected', 'false');
      }
      menu.appendChild(opt);
    });
  }

  /** FDT Head switcher — exclusively on the FDT toolbox card (Body tools never show this). */
  function ensureFdtHeadSwitcher(fdtCard) {
    if (!fdtCard) return null;
    fdtCard.classList.add('toolbox-item--fdt-head');
    var head = fdtCard.querySelector('.toolbox-fdt-head');
    if (!head) {
      head = document.createElement('div');
      head.className = 'toolbox-fdt-head';
      head.setAttribute('data-fdt-head', '1');
      head.innerHTML =
        '<button type="button" class="toolbox-fdt-head__arrow" data-fdt-cycle="-1" aria-label="Previous FDT" title="Previous FDT">&lt;</button>' +
        '<button type="button" class="toolbox-fdt-head__badge" data-fdt-menu-trigger="1" aria-haspopup="listbox" aria-expanded="false" title="Select active FDT">' +
          '<span class="toolbox-fdt-head__label">FDT —</span>' +
          '<span class="toolbox-fdt-head__chevron" aria-hidden="true">▾</span>' +
        '</button>' +
        '<button type="button" class="toolbox-fdt-head__arrow" data-fdt-cycle="1" aria-label="Next FDT" title="Next FDT">&gt;</button>' +
        '<div class="toolbox-fdt-head__menu" data-fdt-menu="1" role="listbox" hidden></div>';
      /* Keep switcher below the main row even if controls are injected later */
      fdtCard.appendChild(head);
    }
    fdtCard.classList.add('toolbox-item--fdt-head');
    return head;
  }

  function formatFdtSwitcherLabel(label, num) {
    if (!label && !num) return 'FDT —';
    if (num) return 'FDT ' + num;
    var raw = String(label || '').trim();
    var m = raw.match(/(\d+)\s*$/);
    if (m) return 'FDT ' + m[1];
    if (/^FDT/i.test(raw)) return raw.replace(/^FDT\s*/i, 'FDT ').replace(/\s+/g, ' ').trim();
    return raw || 'FDT —';
  }

  function syncFdtHeadSwitcher() {
    var box = document.getElementById('toolbox-items');
    if (!box) return;
    /* Strip legacy / misplaced badges from Body tools */
    box.querySelectorAll('.toolbox-active-fdt-status').forEach(function (el) {
      el.remove();
    });
    box.querySelectorAll('.toolbox-fdt-head').forEach(function (head) {
      var host = head.closest('.toolbox-item[data-type], .toolbox-card[data-type]');
      if (!host || host.getAttribute('data-type') !== 'fdt') head.remove();
    });

    var fdtCard = box.querySelector('.toolbox-item[data-type="fdt"], .toolbox-card[data-type="fdt"]');
    if (!fdtCard) return;
    var head = ensureFdtHeadSwitcher(fdtCard);
    if (!head) return;

    /* Ensure DOM order: icon/text → controls → switcher (controls stay top-right) */
    var controls = fdtCard.querySelector(':scope > .toolbox-item-controls');
    if (controls && controls.nextElementSibling !== head) {
      fdtCard.appendChild(controls);
    }
    if (head.parentElement === fdtCard) fdtCard.appendChild(head);

    var fdts = listFdtNodesSorted();
    var label = getActiveFdtLabel();
    var num = getActiveFdtNumber();
    var statusText = formatFdtSwitcherLabel(label, num);
    var labelEl = head.querySelector('.toolbox-fdt-head__label');
    if (labelEl) labelEl.textContent = statusText;
    var badge = head.querySelector('.toolbox-fdt-head__badge');
    if (badge) {
      badge.title = fdts.length ? ('Active cabinet · ' + statusText) : 'Place an FDT to begin';
      badge.setAttribute('aria-label', fdts.length ? ('Select active cabinet, ' + statusText) : 'No FDT placed');
      badge.disabled = !fdts.length;
    }
    head.querySelectorAll('.toolbox-fdt-head__arrow').forEach(function (btn) {
      btn.disabled = fdts.length < 2;
    });
    rebuildFdtHeadMenu(head);
    if (!fdts.length) closeFdtHeadMenu(head);
  }

  function bindFdtHeadSwitcherEvents() {
    var box = document.getElementById('toolbox-items');
    if (!box || box.dataset.fdtHeadBound === '1') return;
    box.dataset.fdtHeadBound = '1';

    box.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var head = t.closest('[data-fdt-head]');
      if (!head || !box.contains(head)) return;

      var cycleBtn = t.closest('[data-fdt-cycle]');
      if (cycleBtn) {
        e.preventDefault();
        e.stopPropagation();
        var delta = parseInt(cycleBtn.getAttribute('data-fdt-cycle'), 10) || 1;
        closeFdtHeadMenu(head);
        cycleActiveFdt(delta);
        return;
      }

      var option = t.closest('.toolbox-fdt-head__option[data-fdt-id]');
      if (option) {
        e.preventDefault();
        e.stopPropagation();
        closeFdtHeadMenu(head);
        setActiveFdt(option.getAttribute('data-fdt-id'), { manual: true, force: true });
        return;
      }

      var trigger = t.closest('[data-fdt-menu-trigger]');
      if (trigger) {
        e.preventDefault();
        e.stopPropagation();
        var menu = head.querySelector('.toolbox-fdt-head__menu');
        if (menu && !menu.hidden) closeFdtHeadMenu(head);
        else {
          rebuildFdtHeadMenu(head);
          openFdtHeadMenu(head);
        }
      }
    }, true);

    document.addEventListener('click', function (e) {
      var t = e.target;
      if (t && t.closest && t.closest('[data-fdt-head]')) return;
      closeFdtHeadMenu();
    });
  }

  function syncActiveFdtChrome() {
    var label = getActiveFdtLabel();

    var evalHeader = document.querySelector('#evaluation-panel .evaluation-panel__header h2');
    if (evalHeader) {
      evalHeader.setAttribute('data-active-fdt', label || '');
      evalHeader.textContent = label ? ('Evaluation' + formatActiveFdtBadgeSuffix()) : 'Evaluation';
    }
    var evalSub = document.querySelector('#evaluation-panel .evaluation-panel__header p');
    if (evalSub && evalSub.getAttribute('dir') === 'rtl') {
      evalSub.setAttribute('data-active-fdt', label || '');
    }

    bindFdtHeadSwitcherEvents();
    syncFdtHeadSwitcher();
    syncSmartBarActiveFdtBadge();

    /* Details AB_LM titles follow the inspected item's cabinet; Active FDT chrome stays above. */
    var detailsSuffix = formatDetailsPanelFdtBadgeSuffix();
    document.querySelectorAll('#property-panel-body .sidebar-section__title[data-ab-base]').forEach(function (titleEl) {
      var base = titleEl.getAttribute('data-ab-base') || '';
      var arrow = titleEl.querySelector('.sidebar-section__toggle');
      var suffix = titleEl.getAttribute('data-ab-suffix');
      if (suffix == null) suffix = detailsSuffix;
      if (arrow) {
        titleEl.innerHTML = '';
        titleEl.appendChild(arrow);
        titleEl.appendChild(document.createTextNode(base + suffix));
      } else {
        titleEl.textContent = base + suffix;
      }
    });
  }

  function parseLabeledNumericId(value, pattern) {
    if (value == null || value === '') return null;
    var m = String(value).match(pattern);
    if (!m) return null;
    var n = parseInt(m[1], 10);
    return (!isNaN(n) && n > 0) ? n : null;
  }

  /** Smallest positive integer not present in usedIds (1 when none are in use). */
  function findLowestAvailableNumericId(usedIds) {
    var used = {};
    var i;
    for (i = 0; i < usedIds.length; i++) {
      var n = usedIds[i];
      if (n != null && n > 0) used[n] = true;
    }
    var id = 1;
    while (used[id]) id++;
    return id;
  }

  function maxNumericId(usedIds) {
    var max = 0;
    var i;
    for (i = 0; i < usedIds.length; i++) {
      var n = usedIds[i];
      if (n != null && n > 0) max = Math.max(max, n);
    }
    return max;
  }

  function collectHandholeNumericIds(excludeNodeId, cabinetId) {
    var scope = cabinetId !== undefined ? cabinetId : getActiveFdtId();
    var ids = [];
    (Sim.nodes || []).forEach(function (node) {
      if (!node || node.type !== 'handhole') return;
      if (excludeNodeId && node.id === excludeNodeId) return;
      if (scope && !nodeBelongsToCabinet(node, scope)) return;
      var n = parseLabeledNumericId(node.autoName, /^H(\d+)$/i);
      if (n != null) ids.push(n);
    });
    return ids;
  }

  function collectFdtNumericIds(excludeNodeId) {
    var ids = [];
    (Sim.nodes || []).forEach(function (node) {
      if (!node || node.type !== 'fdt') return;
      if (excludeNodeId && node.id === excludeNodeId) return;
      var n = parseLabeledNumericId(node.autoName, /^FDT(\d+)$/i);
      if (n != null) ids.push(n);
    });
    return ids;
  }

  function collectFatHandholeNumericIds(excludeNodeId, cabinetId) {
    var scope = cabinetId !== undefined ? cabinetId : getActiveFdtId();
    var ids = [];
    (Sim.nodes || []).forEach(function (node) {
      if (!node || node.type !== 'fat_handhole') return;
      if (excludeNodeId && node.id === excludeNodeId) return;
      if (scope && !nodeBelongsToCabinet(node, scope)) return;
      var n = parseLabeledNumericId(node.autoName, /^FH(\d+)$/i);
      if (n != null) ids.push(n);
    });
    return ids;
  }

  function collectFatSystemNumericIds(excludeNodeId, cabinetId) {
    var scope = cabinetId !== undefined ? cabinetId : getActiveFdtId();
    var ids = [];
    (Sim.nodes || []).forEach(function (node) {
      if (!node || node.type !== 'fat_handhole' || !node.fatSystemName) return;
      if (excludeNodeId && node.id === excludeNodeId) return;
      if (scope && !nodeBelongsToCabinet(node, scope)) return;
      var n = parseLabeledNumericId(node.fatSystemName, /^FAT(\d+)$/i);
      if (n != null) ids.push(n);
    });
    return ids;
  }

  function collectPoleNumericIds(excludeNodeId, cabinetId) {
    var scope = cabinetId !== undefined ? cabinetId : getActiveFdtId();
    var ids = [];
    (Sim.nodes || []).forEach(function (node) {
      if (!node || node.type !== 'pole_foundation' || !node.hasPole || !node.poleName) return;
      if (excludeNodeId && node.id === excludeNodeId) return;
      if (scope && !nodeBelongsToCabinet(node, scope)) return;
      var n = parseLabeledNumericId(node.poleName, /^P(\d+)$/i);
      if (n != null) ids.push(n);
    });
    return ids;
  }

  function collectClosureNumericIds(excludeNodeId, cabinetId) {
    var scope = cabinetId !== undefined ? cabinetId : getActiveFdtId();
    var ids = [];
    (Sim.nodes || []).forEach(function (node) {
      if (!node || !node.closureName) return;
      if (excludeNodeId && node.id === excludeNodeId) return;
      if (scope && !nodeBelongsToCabinet(node, scope)) return;
      var n = parseLabeledNumericId(node.closureName, /C(\d+)$/i);
      if (n != null) ids.push(n);
    });
    return ids;
  }

  function collectCableBatchIdsForCapacity(capacity, excludeCableId, cabinetId) {
    var scope = cabinetId !== undefined ? cabinetId : getActiveFdtId();
    var ids = [];
    var cap = parseInt(capacity, 10);
    if (!cap || cap <= 0) return ids;
    (Sim.fiberCablePaths || []).forEach(function (cable) {
      if (!cable) return;
      if (excludeCableId && cable.id === excludeCableId) return;
      if (scope && !cableBelongsToCabinet(cable, scope)) return;
      var cableCap = cable.capacity || getCableCapacityForKind(cable.kind);
      if (cableCap !== cap) return;
      var batch = cable.batch;
      if (batch == null) {
        batch = parseLabeledNumericId(cable.asBuiltId || cable.name || '', new RegExp('^' + cap + 'F(\\d+)$', 'i'));
      }
      if (batch != null && batch > 0) ids.push(batch);
    });
    (Sim.connections || []).forEach(function (conn) {
      if (!conn || !conn.name || !conn.capacity) return;
      if (conn.capacity !== cap) return;
      if (scope && conn.ownerFdtId && String(conn.ownerFdtId) !== String(scope)) return;
      var batch = parseLabeledNumericId(conn.name, new RegExp('^' + cap + 'F(\\d+)$', 'i'));
      if (batch != null) ids.push(batch);
    });
    return ids;
  }

  /**
   * Keep pen/draft/labels aligned with the locked toolbox batch.
   * Never auto-advances batch numbers — that is a manual toolbox preference.
   */
  function syncDefaultCableBatchesToMap() {
    var cabId = getActiveFdtId();
    if (Sim.penDraft && Sim.penDraft.lineMode === 'cable' && !Sim.penDraft.continueFromCable) {
      var kind = Sim.penDraft.kind || getActiveCableKind();
      if (kind) {
        Sim.penDraft.batch = getCableBatchForKind(kind);
        Sim.penDraft.capacity = getCableCapacityForKind(kind);
        Sim.penDraft.cableName = resolveActiveToolboxCableLabel(kind);
        if (cabId) Sim.penDraft.ownerFdtId = cabId;
      }
    }
    refreshCableConfiguratorLabels();
    updateFieldStatusCounters();
  }

  function lockActiveCableBatchPreference() {
    if (!Sim.ui) Sim.ui = {};
    Sim.ui.cableBatchLocked = true;
  }

  /** Push current toolbox capacity/batch into pen + draft + Smart Bar immediately. */
  function syncActiveCableBatchToEngines(kind) {
    kind = kind || getActiveCableKind();
    if (!kind) return;
    var key = getCableConfigKey(kind);
    var capacity = getCableCapacityForKind(key);
    var batch = getCableBatchForKind(key);
    var label = formatCableLabel(capacity, batch);

    if (Sim.pen && Sim.pen.lineMode === 'cable') {
      var penKey = getCableConfigKey(Sim.pen.cableKind || key);
      if (penKey === key) {
        Sim.pen.cableKind = Sim.pen.cableKind || key;
        Sim.pen.cableCapacity = capacity;
        Sim.pen.selectedLineId = cableIdForKind(Sim.pen.cableKind, capacity);
      }
    }

    if (Sim.penDraft && Sim.penDraft.lineMode === 'cable' && !Sim.penDraft.continueFromCable) {
      var draftKey = getCableConfigKey(Sim.penDraft.kind || key);
      if (draftKey === key) {
        Sim.penDraft.kind = Sim.penDraft.kind || key;
        Sim.penDraft.capacity = capacity;
        Sim.penDraft.batch = batch;
        Sim.penDraft.cableName = label;
      }
    }

    setPushHint(getActivePathStatusLabel());
  }

  /* ─── Map history (undo / redo) ─── */
  function cloneMapState() {
    return {
      nodes: JSON.parse(JSON.stringify(Sim.nodes)),
      connections: JSON.parse(JSON.stringify(Sim.connections)),
      excavationPaths: JSON.parse(JSON.stringify(Sim.excavationPaths)),
      fiberCablePaths: JSON.parse(JSON.stringify(Sim.fiberCablePaths || [])),
      nodeId: Sim.nodeId,
      connId: Sim.connId,
      excavationPathId: Sim.excavationPathId,
      fiberCablePathId: Sim.fiberCablePathId,
      counters: JSON.parse(JSON.stringify(Sim.counters)),
      countersByCabinet: JSON.parse(JSON.stringify(Sim.countersByCabinet || {})),
      activeFdtId: Sim.ui.activeFdtId || null,
      cableDraftFrom: Sim.cableDraftFrom,
    };
  }

  function restoreMapState(state) {
    if (!state) return;
    Sim.nodes = JSON.parse(JSON.stringify(state.nodes));
    Sim.connections = JSON.parse(JSON.stringify(state.connections));
    Sim.excavationPaths = JSON.parse(JSON.stringify(state.excavationPaths || []));
    Sim.excavationPaths.forEach(function (ep) { normalizeExcavationPath(ep); });
    Sim.fiberCablePaths = JSON.parse(JSON.stringify(state.fiberCablePaths || []));
    syncAllCablePathsToTrenches();
    Sim.nodeId = state.nodeId;
    Sim.connId = state.connId;
    Sim.excavationPathId = state.excavationPathId || 0;
    Sim.fiberCablePathId = state.fiberCablePathId || 0;
    Sim.counters = JSON.parse(JSON.stringify(state.counters));
    Sim.countersByCabinet = JSON.parse(JSON.stringify(state.countersByCabinet || {}));
    if (!Sim.ui) Sim.ui = {};
    Sim.ui.activeFdtId = state.activeFdtId || null;
    Sim.cableDraftFrom = state.cableDraftFrom;
    syncNameCountersFromNodes();
    syncDefaultCableBatchesToMap();
    Sim.penDraft = null;
    Sim.selectedPath = null;
    Sim.pathEdit = { drag: null, context: null };
    clearNodeSelection();
    renderAllNodes();
    renderGlobalDrawingLayer();
    updateMetrics();
    syncBatchDuplicationHintForDrawingState();
    notifyFiberDesignTopologyChanged();
  }

  function updateHistoryButtons() {
    var undoBtn = document.getElementById('btn-undo');
    var redoBtn = document.getElementById('btn-redo');
    var canUndo = Sim.history.undoStack.length > 1;
    var canRedo = Sim.history.redoStack.length > 0;
    if (undoBtn) {
      undoBtn.disabled = !canUndo;
      undoBtn.setAttribute('aria-disabled', canUndo ? 'false' : 'true');
    }
    if (redoBtn) {
      redoBtn.disabled = !canRedo;
      redoBtn.setAttribute('aria-disabled', canRedo ? 'false' : 'true');
    }
  }

  function resetMapHistory() {
    Sim.history.undoStack = [cloneMapState()];
    Sim.history.redoStack = [];
    Sim.history.applying = false;
    updateHistoryButtons();
  }

  function saveState() {
    if (Sim.history.applying) return;
    Sim.history.undoStack.push(cloneMapState());
    if (Sim.history.undoStack.length > Sim.history.max) {
      Sim.history.undoStack.shift();
    }
    Sim.history.redoStack = [];
    updateHistoryButtons();
  }

  function undo() {
    if (Sim.history.undoStack.length <= 1) return;
    Sim.history.applying = true;
    var current = Sim.history.undoStack.pop();
    Sim.history.redoStack.push(current);
    restoreMapState(Sim.history.undoStack[Sim.history.undoStack.length - 1]);
    Sim.history.applying = false;
    updateHistoryButtons();
    updateStatus('Undo');
  }

  function redo() {
    if (Sim.history.redoStack.length === 0) return;
    Sim.history.applying = true;
    var next = Sim.history.redoStack.pop();
    Sim.history.undoStack.push(next);
    restoreMapState(next);
    Sim.history.applying = false;
    updateHistoryButtons();
    updateStatus('Redo');
  }

  function syncNameCountersFromNodes() {
    migrateOwnerFdtIdsFromMap();
    resetNameCounters();
    Sim.counters.fdt = maxNumericId(collectFdtNumericIds());

    var cabinetIds = {};
    (Sim.nodes || []).forEach(function (node) {
      if (node && node.type === 'fdt') cabinetIds[String(node.id)] = true;
      if (node && node.ownerFdtId) cabinetIds[String(node.ownerFdtId)] = true;
    });
    (Sim.fiberCablePaths || []).forEach(function (cable) {
      var oid = resolveCableOwnerFdtId(cable);
      if (oid) cabinetIds[oid] = true;
    });

    Object.keys(cabinetIds).forEach(function (cabId) {
      var bucket = ensureCabinetCounterBucket(cabId);
      bucket.handhole = maxNumericId(collectHandholeNumericIds(null, cabId));
      bucket.fatHandhole = maxNumericId(collectFatHandholeNumericIds(null, cabId));
      bucket.fatSystem = maxNumericId(collectFatSystemNumericIds(null, cabId));
      bucket.pole = maxNumericId(collectPoleNumericIds(null, cabId));
      bucket.closure = maxNumericId(collectClosureNumericIds(null, cabId));
      bucket.cableByCapacity = {};
      var cableCapKeys = {};
      (Sim.fiberCablePaths || []).forEach(function (cable) {
        if (!cable || !cableBelongsToCabinet(cable, cabId)) return;
        var cap = cable.capacity || getCableCapacityForKind(cable.kind);
        if (cap) cableCapKeys[cap] = true;
      });
      Object.keys(cableCapKeys).forEach(function (capKey) {
        var cap = parseInt(capKey, 10);
        var maxBatch = maxNumericId(collectCableBatchIdsForCapacity(cap, null, cabId));
        if (maxBatch > 0) bucket.cableByCapacity[cap] = maxBatch;
      });
    });

    Sim.nodes.forEach(function (node) {
      if (node.type === 'pole_foundation' && node.hasPole && !node.poleName) assignPoleName(node);
    });

    if (!getActiveFdtNode()) ensureActiveFdtFallback();
    else mirrorActiveCabinetCountersToSim();
  }

  function assignCableAsBuiltLabel(meta) {
    var cap = meta.capacity || getCableCapacityForKind(meta.kind) || 12;
    var cabId = (meta && meta.ownerFdtId) || getActiveFdtId();
    var batch = meta.batch;
    if (batch == null) {
      batch = findLowestAvailableNumericId(collectCableBatchIdsForCapacity(cap, null, cabId));
    } else {
      batch = Math.max(1, parseInt(batch, 10) || 1);
    }
    if (cabId) {
      var bucket = ensureCabinetCounterBucket(cabId);
      if (!bucket.cableByCapacity[cap]) bucket.cableByCapacity[cap] = 0;
      bucket.cableByCapacity[cap] = Math.max(bucket.cableByCapacity[cap], batch);
    }
    if (!Sim.counters.cableByCapacity[cap]) Sim.counters.cableByCapacity[cap] = 0;
    if (!cabId || cabId === getActiveFdtId()) {
      Sim.counters.cableByCapacity[cap] = Math.max(Sim.counters.cableByCapacity[cap], batch);
    }
    return formatCableLabel(cap, batch);
  }

  function assignPoleName(node) {
    if (!node || node.type !== 'pole_foundation') return;
    var cabId = ensureNodeOwnerFdt(node);
    var poleId = findLowestAvailableNumericId(collectPoleNumericIds(node.id, cabId));
    node.poleName = 'P' + poleId;
    if (cabId) {
      var bucket = ensureCabinetCounterBucket(cabId);
      bucket.pole = Math.max(bucket.pole || 0, poleId);
    }
    if (!cabId || cabId === getActiveFdtId()) {
      Sim.counters.pole = Math.max(Sim.counters.pole || 0, poleId);
    }
  }

  function assignAutoName(type, node) {
    if (type === 'fdt') {
      var fdtId = findLowestAvailableNumericId(collectFdtNumericIds(node && node.id));
      node.autoName = 'FDT' + fdtId;
      Sim.counters.fdt = Math.max(Sim.counters.fdt || 0, fdtId);
      ensureCabinetCounterBucket(node.id);
      /* Active FDT is set after the node is pushed to Sim.nodes (see addNode). */
      return;
    }
    var cabId = ensureNodeOwnerFdt(node);
    if (type === 'handhole') {
      var handholeId = findLowestAvailableNumericId(collectHandholeNumericIds(node && node.id, cabId));
      node.autoName = 'H' + handholeId;
      if (cabId) {
        var hb = ensureCabinetCounterBucket(cabId);
        hb.handhole = Math.max(hb.handhole || 0, handholeId);
      }
      if (!cabId || cabId === getActiveFdtId()) {
        Sim.counters.handhole = Math.max(Sim.counters.handhole || 0, handholeId);
      }
    } else if (type === 'fat_handhole') {
      var fhId = findLowestAvailableNumericId(collectFatHandholeNumericIds(node && node.id, cabId));
      node.autoName = 'FH' + fhId;
      if (cabId) {
        var fb = ensureCabinetCounterBucket(cabId);
        fb.fatHandhole = Math.max(fb.fatHandhole || 0, fhId);
      }
      if (!cabId || cabId === getActiveFdtId()) {
        Sim.counters.fatHandhole = Math.max(Sim.counters.fatHandhole || 0, fhId);
      }
    }
  }

  /**
   * Extract trailing numeric ID from handhole labels (FH25, H25, FH-25, etc.).
   * @returns {number|null}
   */
  function extractHandholeNumericId(node) {
    if (!node) return null;
    var candidates = [node.autoName, node.fatSystemName, node.code];
    var i;
    for (i = 0; i < candidates.length; i++) {
      var raw = candidates[i];
      if (!raw) continue;
      var m = String(raw).match(/(\d+)\s*$/);
      if (m) {
        var n = parseInt(m[1], 10);
        if (!isNaN(n) && n > 0) return n;
      }
    }
    return null;
  }

  /**
   * FAT Pole ID inherits the parent FAT Handhole number (FH25 → FAT25).
   * Overrides the global sequential counter for this node when inheritance applies.
   */
  function assignFatSystemName(target) {
    if (!target || target.type !== 'fat_handhole') return;
    var cabId = ensureNodeOwnerFdt(target);

    var inherited = extractHandholeNumericId(target);
    if (inherited != null) {
      target.fatSystemName = 'FAT' + inherited;
      if (cabId) {
        var bucket = ensureCabinetCounterBucket(cabId);
        bucket.fatSystem = Math.max(bucket.fatSystem || 0, inherited);
      }
      if (!cabId || cabId === getActiveFdtId()) {
        Sim.counters.fatSystem = Math.max(Sim.counters.fatSystem || 0, inherited);
      }
      return;
    }

    var fatId = findLowestAvailableNumericId(collectFatSystemNumericIds(target && target.id, cabId));
    target.fatSystemName = 'FAT' + fatId;
    if (cabId) {
      var b2 = ensureCabinetCounterBucket(cabId);
      b2.fatSystem = Math.max(b2.fatSystem || 0, fatId);
    }
    if (!cabId || cabId === getActiveFdtId()) {
      Sim.counters.fatSystem = Math.max(Sim.counters.fatSystem || 0, fatId);
    }
  }

  function assignClosureName(target) {
    if (!target || target.type !== 'handhole') return;
    var cabId = ensureNodeOwnerFdt(target);
    var closureId = findLowestAvailableNumericId(collectClosureNumericIds(target && target.id, cabId));
    target.closureCount = closureId;
    /* Short C# within each FDT domain (H labels already restart per cabinet). */
    target.closureName = 'C' + closureId;
    if (cabId) {
      var bucket = ensureCabinetCounterBucket(cabId);
      bucket.closure = Math.max(bucket.closure || 0, closureId);
    }
    if (!cabId || cabId === getActiveFdtId()) {
      Sim.counters.closure = Math.max(Sim.counters.closure || 0, closureId);
    }
  }

  function formatCableLabel(capacity, batch) {
    return String(capacity) + 'F' + String(batch || 1);
  }

  function getCableConfigKey(kind) {
    return kind === 'lastmile' ? 'lastmile' : 'distribution';
  }

  function ensureCableConfig() {
    if (!Sim.ui.cableConfig) {
      Sim.ui.cableConfig = {
        lastmile: { capacity: 12, batch: 1 },
        distribution: { capacity: 72, batch: 1 },
      };
    }
    if (!Sim.ui.cableConfig.lastmile) Sim.ui.cableConfig.lastmile = { capacity: 12, batch: 1 };
    if (!Sim.ui.cableConfig.distribution) Sim.ui.cableConfig.distribution = { capacity: 72, batch: 1 };
    return Sim.ui.cableConfig;
  }

  function getCableBatchForKind(kind) {
    var cfg = ensureCableConfig()[getCableConfigKey(kind)];
    return cfg ? Math.max(1, parseInt(cfg.batch, 10) || 1) : 1;
  }

  function getCableCapacityForKind(kind) {
    var cfg = ensureCableConfig()[getCableConfigKey(kind)];
    if (!cfg) return kind === 'lastmile' ? 12 : 72;
    return cfg.capacity;
  }

  function getCableLabelForKind(kind) {
    return formatCableLabel(getCableCapacityForKind(kind), getCableBatchForKind(kind));
  }

  function setActiveCableKind(kind) {
    if (!kind) return;
    if (!Sim.ui) Sim.ui = {};
    Sim.ui.activeCableKind = getCableConfigKey(kind);
  }

  /** Active cable kind for toolbox / duplication hint (`lastmile` | `distribution`). */
  function getActiveCableKind() {
    var raw = (Sim.ui && Sim.ui.activeCableKind) ||
      (Sim.pen && Sim.pen.cableKind) ||
      (Sim.penDraft && Sim.penDraft.lineMode === 'cable' && Sim.penDraft.kind) ||
      null;
    if (!raw) return null;
    return getCableConfigKey(raw);
  }

  var DEFAULT_TOOLBOX_FOOTER_HINT = '💡 على الرصيف فقط · FAT Pole فوق المثلث → FAT1';

  function normalizeStatusElementLabel(label) {
    label = String(label || '').trim();
    if (!label || /^no handhole$/i.test(label)) return null;
    return label;
  }

  function rememberLastInstalledElement(label) {
    var clean = normalizeStatusElementLabel(label);
    if (!clean) return;
    if (!Sim.ui) Sim.ui = {};
    Sim.ui.lastInstalledElementLabel = clean;
    updateFieldStatusCounters();
  }

  function setCableCapacity(kind, capacity, box) {
    var cfg = ensureCableConfig()[getCableConfigKey(kind)];
    if (!cfg) return;
    setActiveCableKind(kind);
    cfg.capacity = capacity;
    if (!Sim.ui.cableCapacity) Sim.ui.cableCapacity = {};
    Sim.ui.cableCapacity[kind] = capacity;
    refreshCableConfiguratorLabels(box);
    var grp = cableGroupByKind(kind);
    if (grp && Sim.pen.lineMode === 'cable' &&
        getCableConfigKey(Sim.pen.cableKind) === getCableConfigKey(kind)) {
      armPenCable(grp, capacity, box, null);
    }
    syncActiveCableBatchToEngines(kind);
    updateFieldStatusCounters();
  }

  function resolveCableCapacityValue(cableOrCapacity, kind) {
    if (cableOrCapacity != null && typeof cableOrCapacity === 'object') {
      var cable = cableOrCapacity;
      var fromField = Number(cable.capacity);
      if (fromField > 0) return fromField;
      var label = String(cable.asBuiltId || cable.name || '');
      var m = label.match(/^(\d+)F/i);
      if (m) return parseInt(m[1], 10) || 0;
      return Number(getCableCapacityForKind(cable.kind || kind)) || 0;
    }
    var direct = Number(cableOrCapacity);
    if (direct > 0) return direct;
    return Number(getCableCapacityForKind(kind)) || 0;
  }

  /**
   * True when an existing saved cable already uses this exact capacity+batch+kind.
   * @param {number} batchNumber
   * @param {string} kind
   * @param {number} capacity
   * @param {string} [excludeCableId] skip this id (e.g. self when editing)
   */
  function isBatchDuplicated(batchNumber, kind, capacity, excludeCableId) {
    if (!Sim || !Sim.fiberCablePaths) return false;
    var kindKey = kind ? getCableConfigKey(kind) : kind;
    var capKey = resolveCableCapacityValue(capacity, kindKey);
    if (!kindKey || !(capKey > 0) || batchNumber == null) return false;
    var cabId = getActiveFdtId();

    for (var i = 0; i < Sim.fiberCablePaths.length; i++) {
      var cable = Sim.fiberCablePaths[i];
      if (!cable) continue;
      if (excludeCableId && String(cable.id) === String(excludeCableId)) continue;
      /* Same batch on another FDT is allowed — domains are independent */
      if (cabId && !cableBelongsToCabinet(cable, cabId)) continue;
      if (Number(cable.batch) !== Number(batchNumber)) continue;
      if (getCableConfigKey(cable.kind) !== kindKey) continue;
      if (resolveCableCapacityValue(cable, kindKey) !== capKey) continue;
      return true;
    }
    return false;
  }

  function updateHintAlarm(message, isError) {
    var hintElement = document.getElementById('toolbox-footer-hint');
    if (hintElement) {
      hintElement.textContent = message;
      hintElement.classList.toggle('toolbox-footer-hint--alarm', !!isError);
      if (isError) {
        hintElement.style.color = '#ff4d4d';
        hintElement.style.fontWeight = 'bold';
      } else {
        hintElement.style.color = '';
        hintElement.style.fontWeight = '';
      }
    }
    /* Dual surface: toolbox footer + bottom status bar (next to Rotation). */
    syncStatusBarDuplicationDisplay(isError ? message : null);
  }

  /**
   * Swap bottom-bar Active Path ↔ duplication badge in the push-hint slot.
   * @param {string|null} dupText warning text, or null to restore Active Path
   */
  function syncStatusBarDuplicationDisplay(dupText) {
    if (!Sim.ui) Sim.ui = {};
    Sim.ui.batchDuplicationWarning = dupText || null;

    var wrap = document.getElementById('status-bar-push-hint');
    var activeEl = document.getElementById('status-bar-active-path');
    var dupEl = document.getElementById('status-bar-dup-badge');

    if (dupText) {
      if (activeEl) {
        activeEl.classList.add('is-hidden');
        activeEl.setAttribute('aria-hidden', 'true');
      }
      if (dupEl) {
        dupEl.textContent = dupText;
        dupEl.classList.add('is-visible');
        dupEl.removeAttribute('hidden');
        dupEl.setAttribute('aria-hidden', 'false');
      } else if (wrap && !activeEl) {
        wrap.textContent = dupText;
      }
      if (wrap) {
        wrap.classList.add('gis-status-bar__push-hint--alarm');
        wrap.title = dupText;
      }
      return;
    }

    if (dupEl) {
      dupEl.classList.remove('is-visible');
      dupEl.setAttribute('hidden', '');
      dupEl.setAttribute('aria-hidden', 'true');
      dupEl.textContent = '';
    }
    if (activeEl) {
      activeEl.classList.remove('is-hidden');
      activeEl.setAttribute('aria-hidden', 'false');
      var restore = Sim.ui.pushHint || getActivePathStatusLabel() || ACTIVE_PATH_IDLE_LABEL;
      activeEl.textContent = restore;
      activeEl.title = restore;
    } else if (wrap) {
      wrap.textContent = Sim.ui.pushHint || ACTIVE_PATH_IDLE_LABEL;
    }
    if (wrap) {
      wrap.classList.remove('gis-status-bar__push-hint--alarm');
      var restoreTitle = (activeEl && activeEl.textContent) ||
        Sim.ui.pushHint || ACTIVE_PATH_IDLE_LABEL;
      wrap.title = restoreTitle;
      setStatusBarInteractivePathMode(isInteractiveCablePathStatusActive());
    }
  }

  var ACTIVE_PATH_IDLE_LABEL = 'Active Path · ...';
  var ACTIVE_PATH_PREFIX_RE = /^Active Path\s*·\s*/i;

  function stripActivePathPrefix(msg) {
    return String(msg == null ? '' : msg).replace(ACTIVE_PATH_PREFIX_RE, '');
  }

  /** True while Main/Sub interactive trail is driving the status slot (no idle prefix). */
  function isInteractiveCablePathStatusActive() {
    if (Sim.mainCableStartConfirmUntil && Date.now() < Sim.mainCableStartConfirmUntil) return true;
    if (Sim.subCableStartConfirmUntil && Date.now() < Sim.subCableStartConfirmUntil) return true;
    if (Sim.mainCableCheckpointConfirmUntil && Date.now() < Sim.mainCableCheckpointConfirmUntil) {
      return true;
    }
    if (Sim.subCableDropConfirmUntil && Date.now() < Sim.subCableDropConfirmUntil) return true;
    var draft = Sim.penDraft;
    if (draft && draft.subCableTrail && draft.subCableTrail.closureLabel) return true;
    if (draft && draft.mainCableTrail && draft.mainCableTrail.cabinetLabel) return true;
    if (!draft && Sim.subCableTrail && Sim.subCableTrail.closureLabel) return true;
    if (!draft && Sim.mainCableTrail && Sim.mainCableTrail.cabinetLabel) return true;
    return false;
  }

  /** Handhole identity only (H5 / FH5) — no closure C suffix for pass-through main hops. */
  function getHandholePassThroughDisplayLabel(node) {
    if (!node) return '';
    if (node.type === 'handhole' || node.type === 'fat_handhole') {
      return node.autoName ? String(node.autoName) : '';
    }
    return '';
  }

  function mainCableTrailIncludesClosureNode(trail, nodeId) {
    if (!trail || nodeId == null || nodeId === '') return false;
    var nid = String(nodeId);
    return (trail.closures || []).some(function (c) {
      return c && String(c.id) === nid;
    });
  }

  /** First saved main cable whose interactive trail terminates at this closure node. */
  function findPrimaryMainCableOwnerForClosureNode(nodeId) {
    if (nodeId == null || nodeId === '') return null;
    var paths = Sim.fiberCablePaths || [];
    var i;
    for (i = 0; i < paths.length; i++) {
      var cable = paths[i];
      if (!cable || !cable.mainCableTrail || !cable.mainCableTrail.cabinetId) continue;
      if (mainCableTrailIncludesClosureNode(cable.mainCableTrail, nodeId)) {
        return cable.id != null ? String(cable.id) : null;
      }
    }
    return null;
  }

  function isPassThroughMainTrailHop(cableId, closureHop) {
    if (!closureHop || closureHop.id == null) return false;
    var ownerId = findPrimaryMainCableOwnerForClosureNode(closureHop.id);
    if (!ownerId) return false;
    var cid = cableId != null && cableId !== '' ? String(cableId) : '';
    if (!cid) return true;
    return String(ownerId) !== cid;
  }

  function resolveMainTrailHopDisplayLabel(cableId, closureHop) {
    if (!closureHop) return '';
    if (isPassThroughMainTrailHop(cableId, closureHop)) {
      var node = findNode(closureHop.id);
      var handholeOnly = getHandholePassThroughDisplayLabel(node);
      if (handholeOnly) return handholeOnly;
      var stored = String(closureHop.label || '');
      var head = stored.match(/^(H\d+|FH\d+)/i);
      if (head) return head[1];
      return stored.replace(/\s+C\d+\s*$/i, '').trim() || stored;
    }
    return closureHop.label ? String(closureHop.label) : '';
  }

  function formatMainCableTrailLabelForDisplay(trail, draftCableId) {
    return formatInteractiveMainCablePathLabel(trail, draftCableId);
  }

  function formatInteractiveSubCablePathLabel(subTrail) {
    if (!subTrail || !subTrail.closureLabel) return '';
    var subCableDes = String(subTrail.cableName || '').trim();
    var subHead = subCableDes
      ? (String(subTrail.closureLabel) + ' ' + subCableDes + ' S-Cable')
      : (String(subTrail.closureLabel) + ' S-Cable');
    var subParts = [subHead];
    (subTrail.drops || []).forEach(function (d) {
      if (d && d.label) subParts.push(String(d.label));
    });
    return subParts.join(' --> ');
  }

  function formatInteractiveMainCablePathLabel(trail, cableId) {
    if (!trail || !trail.cabinetLabel) return '';
    var mainCableDes = String(trail.cableName || '').trim();
    var mainHead = mainCableDes
      ? (String(trail.cabinetLabel) + ' ' + mainCableDes + ' M-Cable')
      : (String(trail.cabinetLabel) + ' M-Cable');
    var parts = [mainHead];
    (trail.closures || []).forEach(function (c) {
      var hopLabel = resolveMainTrailHopDisplayLabel(cableId, c);
      if (hopLabel) parts.push(hopLabel);
    });
    if (!(trail.closures || []).length) {
      (trail.drops || []).forEach(function (d) {
        if (d && d.label) parts.push(String(d.label));
      });
    }
    return parts.join(' --> ');
  }

  function getActivePathStatusLabel() {
    /* Phase 1: keep Main Cable cabinet registration visible in Active Path slot */
    if (Sim.mainCableStartConfirmUntil && Date.now() < Sim.mainCableStartConfirmUntil &&
        Sim.mainCableStartConfirmMsg) {
      return stripActivePathPrefix(Sim.mainCableStartConfirmMsg);
    }
    /* Phase 3: Sub-Cable start confirmation */
    if (Sim.subCableStartConfirmUntil && Date.now() < Sim.subCableStartConfirmUntil &&
        Sim.subCableStartConfirmMsg) {
      return stripActivePathPrefix(Sim.subCableStartConfirmMsg);
    }
    /* Phase 3: progressive Sub-Cable → FH/pole sequence (no "Active Path" prefix while drawing)
       Format: C3 12F8 S-Cable --> FH45 --> FH46 --> FH47 */
    var subTrail = (Sim.penDraft && Sim.penDraft.subCableTrail) || Sim.subCableTrail;
    if (subTrail && subTrail.closureLabel) {
      if (Sim.subCableTrailStatusMsg) {
        return stripActivePathPrefix(Sim.subCableTrailStatusMsg);
      }
      return formatInteractiveSubCablePathLabel(subTrail);
    }
    /* Phase 2: progressive Main Cable → closure sequence while drawing */
    var trail = (Sim.penDraft && Sim.penDraft.mainCableTrail) || Sim.mainCableTrail;
    if (trail && trail.cabinetLabel) {
      if (Sim.mainCableTrailStatusMsg) {
        return stripActivePathPrefix(Sim.mainCableTrailStatusMsg);
      }
      var pathDraft = Sim.penDraft;
      var pathCableId = pathDraft && pathDraft.continueFromCable && pathDraft.continueFromCable.id
        ? pathDraft.continueFromCable.id
        : null;
      return formatInteractiveMainCablePathLabel(trail, pathCableId);
    }
    var draft = Sim.penDraft;
    if (draft && draft.points && draft.points.length > 0) {
      if (draft.lineMode === 'cable') {
        var draftLabel = draft.cableName ||
          formatCableLabel(draft.capacity, draft.batch || 1);
        if (draftLabel) return 'Active Path · ' + draftLabel;
      }
      if (draft.lineMode === 'excavation') {
        return 'Active Path · ' + String(draft.kind || 'excavation');
      }
    }
    if (Sim.selectedPath) {
      var path = findPathByRef(Sim.selectedPath);
      if (path) {
        var pathName = path.asBuiltId || path.name || path.id;
        if (pathName) return 'Active Path · ' + pathName;
      }
    }
    /* Toolbox cable batch selected / pen armed — show live batch name. */
    if (Sim.pen && Sim.pen.lineMode === 'cable' && Sim.pen.cableKind) {
      return 'Active Path · ' + getCableLabelForKind(Sim.pen.cableKind);
    }
    if (Sim.pen && Sim.pen.lineMode === 'excavation') {
      return 'Active Path · ' + String(Sim.pen.excavKind || 'excavation');
    }
    /* Cold start / nothing selected: keep "Active Path" prefix + dots. */
    return ACTIVE_PATH_IDLE_LABEL;
  }

  /**
   * Re-evaluate capacity+batch+kind duplication and refresh #toolbox-footer-hint.
   * @param {string} [kind]
   * @param {{ capacity?: number, batch?: number, excludeCableId?: string }} [opts]
   * @returns {boolean} true when the combination is already saved
   */
  function refreshBatchDuplicationHint(kind, opts) {
    opts = opts || {};
    var activeKind = kind ? getCableConfigKey(kind) : getActiveCableKind();
    if (!activeKind) {
      updateHintAlarm(DEFAULT_TOOLBOX_FOOTER_HINT, false);
      return false;
    }
    var cfg = ensureCableConfig()[activeKind];
    if (!cfg) {
      updateHintAlarm(DEFAULT_TOOLBOX_FOOTER_HINT, false);
      return false;
    }
    var capacity = opts.capacity != null
      ? resolveCableCapacityValue(opts.capacity, activeKind)
      : resolveCableCapacityValue(cfg.capacity, activeKind);
    var batch = opts.batch != null
      ? Math.max(1, parseInt(opts.batch, 10) || 1)
      : Math.max(1, parseInt(cfg.batch, 10) || 1);

    if (isBatchDuplicated(batch, activeKind, capacity, opts.excludeCableId || null)) {
      updateHintAlarm(formatCableLabel(capacity, batch) + ' Duplicated ❗', true);
      return true;
    }
    updateHintAlarm(DEFAULT_TOOLBOX_FOOTER_HINT, false);
    return false;
  }

  /**
   * Sync footer duplication badge with live draw / map undo state.
   * Warn only while an active cable draft has points AND the toolbox
   * capacity+batch+kind already exists in Sim.fiberCablePaths; otherwise clear.
   */
  function syncBatchDuplicationHintForDrawingState() {
    var draft = Sim.penDraft;
    setPushHint(getActivePathStatusLabel());
    if (draft && draft.continueFromCable) {
      updateHintAlarm(DEFAULT_TOOLBOX_FOOTER_HINT, false);
      return false;
    }
    if (draft && draft.lineMode === 'cable' && draft.points && draft.points.length > 0) {
      return refreshBatchDuplicationHint(draft.kind || getActiveCableKind(), {
        capacity: draft.capacity,
        batch: draft.batch,
      });
    }
    updateHintAlarm(DEFAULT_TOOLBOX_FOOTER_HINT, false);
    return false;
  }

  function setCableBatch(kind, batch, box) {
    var cfg = ensureCableConfig()[getCableConfigKey(kind)];
    if (!cfg) return;
    setActiveCableKind(kind);
    cfg.batch = Math.max(1, Math.min(999, parseInt(batch, 10) || 1));
    lockActiveCableBatchPreference();
    /* Keep pen armed on this kind so Active Path / draft never stay on a stale batch. */
    if (Sim.pen) {
      if (Sim.pen.lineMode !== 'cable' || getCableConfigKey(Sim.pen.cableKind) !== getCableConfigKey(kind)) {
        var grp = cableGroupByKind(kind);
        if (grp) {
          armPenCable(grp, cfg.capacity, box || document.getElementById('toolbox-items'), null);
        } else {
          Sim.pen.lineMode = 'cable';
          Sim.pen.cableKind = kind;
          Sim.pen.cableCapacity = cfg.capacity;
        }
      } else {
        Sim.pen.cableCapacity = cfg.capacity;
      }
    }
    refreshBatchDuplicationHint(kind);
    refreshCableConfiguratorLabels(box);
    syncActiveCableBatchToEngines(kind);
    updateFieldStatusCounters();
  }

  function cableGroupByKind(kind) {
    for (var i = 0; i < CABLE_GROUPS.length; i++) {
      if (CABLE_GROUPS[i].kind === kind) return CABLE_GROUPS[i];
    }
    return null;
  }

  function refreshCableConfiguratorLabels(box) {
    if (!box) box = document.getElementById('toolbox-items');
    if (!box) return;
    ensureCableConfig();
    ['lastmile', 'distribution'].forEach(function (kind) {
      var cfg = Sim.ui.cableConfig[getCableConfigKey(kind)];
      var preview = box.querySelector('[data-cable-preview="' + kind + '"]');
      if (preview) preview.textContent = formatCableLabel(cfg.capacity, cfg.batch);
      var batchVal = box.querySelector('[data-cable-batch-val="' + kind + '"]');
      if (batchVal) batchVal.textContent = String(cfg.batch);
      box.querySelectorAll('[data-cable-cap="' + kind + '"]').forEach(function (btn) {
        btn.classList.toggle('cable-cap-chip--active', parseInt(btn.dataset.cap, 10) === cfg.capacity);
      });
    });
    refreshBatchDuplicationHint(getActiveCableKind());
  }

  function findServingFdt(node) {
    if (!node) return null;
    if (node.type === 'fdt') return node;
    if (node.type === 'olt') return null;
    var fdts = Sim.nodes.filter(function (n) { return n.type === 'fdt'; });
    if (!fdts.length) return null;
    var best = null;
    var bestDist = Infinity;
    fdts.forEach(function (fdt) {
      var d = Math.abs(fdt.col - node.col) + Math.abs(fdt.row - node.row);
      if (d < bestDist) { bestDist = d; best = fdt; }
    });
    return best;
  }

  function getCableEndpointNodes(pointSnapNodeIds) {
    var ids = pointSnapNodeIds || [];
    var startId = null;
    var endId = null;
    for (var i = 0; i < ids.length; i++) {
      if (!ids[i]) continue;
      if (!startId) startId = ids[i];
      endId = ids[i];
    }
    return { start: startId ? findNode(startId) : null, end: endId ? findNode(endId) : null };
  }

  function validateDistributionEndpoints(startNode, endNode) {
    if (!startNode || !endNode) {
      return { ok: false, msg: 'Main cable must connect two endpoints (OLT or FDT)' };
    }
    var types = [startNode.type, endNode.type];
    var hasOlt = types.indexOf('olt') >= 0;
    var hasFdt = types.indexOf('fdt') >= 0;
    if (hasOlt && hasFdt) return { ok: true };
    if (startNode.type === 'fdt' && endNode.type === 'fdt') return { ok: true };
    return { ok: false, msg: 'Main cable: FDT↔FDT or OLT↔FDT only' };
  }

  function validateLastMileEndpoints(startNode, endNode) {
    if (!startNode || !endNode) {
      return { ok: false, msg: 'Last mile must connect equipment within the same FDT cabinet' };
    }
    if (startNode.type === 'olt' || endNode.type === 'olt') {
      return { ok: false, msg: 'Last mile cannot connect to OLT' };
    }
    if (startNode.type === 'fdt' && endNode.type === 'fdt' && startNode.id !== endNode.id) {
      return { ok: false, msg: 'Last mile cannot span between FDT cabinets' };
    }
    var allowed = { fdt: 1, fat_handhole: 1, handhole: 1 };
    if (!allowed[startNode.type] || !allowed[endNode.type]) {
      return { ok: false, msg: 'Last mile: FDT, Handhole, or FAT Handhole only' };
    }
    var fdtA = findServingFdt(startNode);
    var fdtB = findServingFdt(endNode);
    if (!fdtA || !fdtB || fdtA.id !== fdtB.id) {
      return { ok: false, msg: 'Last mile must stay within one FDT cabinet scope' };
    }
    return { ok: true };
  }

  function validateCableRouting(kind, pointSnapNodeIds) {
    try {
      var ids = pointSnapNodeIds || [];
      var hasDeviceSnaps = false;
      for (var i = 0; i < ids.length; i++) {
        if (ids[i]) { hasDeviceSnaps = true; break; }
      }
      if (!hasDeviceSnaps) return { ok: true };
      var endpoints = getCableEndpointNodes(pointSnapNodeIds);
      if (kind === 'distribution' || kind === 'ftth') {
        return validateDistributionEndpoints(endpoints.start, endpoints.end);
      }
      if (kind === 'lastmile') {
        return validateLastMileEndpoints(endpoints.start, endpoints.end);
      }
      return { ok: true };
    } catch (err) {
      return { ok: true };
    }
  }

  function projectPointToTrenchPolyline(x, y, trench) {
    if (!trench?.points || trench.points.length < 2) return { x: x, y: y };
    var bestDist = Infinity;
    var bestX = x;
    var bestY = y;
    var pts = trench.points;
    for (var i = 0; i < pts.length - 1; i++) {
      var proj = projectPointToSegment(x, y, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
      var d = Math.hypot(x - proj[0], y - proj[1]);
      if (d < bestDist) {
        bestDist = d;
        bestX = proj[0];
        bestY = proj[1];
      }
    }
    return { x: bestX, y: bestY };
  }

  function snapCableToTrench(points, preferredTrenchId) {
    try {
      var trench = preferredTrenchId
        ? findPathByRef({ type: 'excavation', id: preferredTrenchId })
        : null;
      if (!trench) trench = findBestTrenchForCable(points);
      if (!trench || !trench.points || trench.points.length < 2 || !points || points.length < 2) {
        return { points: points, cornerRadii: {}, trenchPathId: null, trenchPath: null };
      }
      var projected = clonePathPointArray(points).map(function (pt) {
        var p = projectPointToTrenchPolyline(pt[0], pt[1], trench);
        return [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10];
      });
      return {
        points: projected,
        cornerRadii: {},
        trenchPathId: trench.id,
        trenchPath: trench,
      };
    } catch (err) {
      return { points: points, cornerRadii: {}, trenchPathId: null, trenchPath: null };
    }
  }

  function dedupeConsecutiveCablePoints(points) {
    var out = [];
    (points || []).forEach(function (pt) {
      if (!pt) return;
      var prev = out[out.length - 1];
      if (prev && prev[0] === pt[0] && prev[1] === pt[1]) return;
      out.push([pt[0], pt[1]]);
    });
    return out;
  }

  function polylineTotalLength(pts) {
    if (!pts || pts.length < 2) return 0;
    var total = 0;
    for (var i = 0; i < pts.length - 1; i++) {
      total += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    }
    return total;
  }

  function pointAtPolylineDistance(pts, dist) {
    if (!pts || pts.length < 2) return pts && pts[0] ? pts[0].slice() : [0, 0];
    var total = polylineTotalLength(pts);
    if (dist <= 0) return [pts[0][0], pts[0][1]];
    if (dist >= total) return [pts[pts.length - 1][0], pts[pts.length - 1][1]];
    var cum = 0;
    for (var i = 0; i < pts.length - 1; i++) {
      var p1 = pts[i];
      var p2 = pts[i + 1];
      var segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      if (cum + segLen >= dist - 1e-6) {
        var t = segLen < 1e-6 ? 0 : (dist - cum) / segLen;
        return [
          Math.round((p1[0] + t * (p2[0] - p1[0])) * 10) / 10,
          Math.round((p1[1] + t * (p2[1] - p1[1])) * 10) / 10,
        ];
      }
      cum += segLen;
    }
    return [pts[pts.length - 1][0], pts[pts.length - 1][1]];
  }

  function projectPointOntoTrenchWithDistance(x, y, trench) {
    if (!trench?.points || trench.points.length < 2) {
      return { x: x, y: y, along: 0 };
    }
    var pts = trench.points;
    var bestDist = Infinity;
    var best = { x: x, y: y, along: 0 };
    var cum = 0;
    for (var i = 0; i < pts.length - 1; i++) {
      var p1 = pts[i];
      var p2 = pts[i + 1];
      var segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      var proj = projectPointToSegment(x, y, p1[0], p1[1], p2[0], p2[1]);
      var d = Math.hypot(x - proj[0], y - proj[1]);
      if (d < bestDist) {
        var alongSeg = Math.hypot(proj[0] - p1[0], proj[1] - p1[1]);
        bestDist = d;
        best = {
          x: Math.round(proj[0] * 10) / 10,
          y: Math.round(proj[1] * 10) / 10,
          along: cum + alongSeg,
        };
      }
      cum += segLen;
    }
    return best;
  }

  function extractTrenchSubpathBetweenDistances(trench, distA, distB) {
    if (!trench?.points || trench.points.length < 2) return [];
    var pts = trench.points;
    var total = polylineTotalLength(pts);
    var start = Math.max(0, Math.min(total, distA));
    var end = Math.max(0, Math.min(total, distB));
    if (end < start) { var tmp = start; start = end; end = tmp; }
    if (Math.abs(end - start) < 0.05) {
      return [pointAtPolylineDistance(pts, start)];
    }
    var out = [pointAtPolylineDistance(pts, start)];
    var cum = 0;
    for (var i = 0; i < pts.length - 1; i++) {
      var p2 = pts[i + 1];
      var segLen = Math.hypot(p2[0] - pts[i][0], p2[1] - pts[i][1]);
      var segEnd = cum + segLen;
      if (segEnd > start + 0.05 && segEnd < end - 0.05) {
        out.push([p2[0], p2[1]]);
      }
      cum += segLen;
    }
    var endPt = pointAtPolylineDistance(pts, end);
    var last = out[out.length - 1];
    if (!last || last[0] !== endPt[0] || last[1] !== endPt[1]) out.push(endPt);
    return dedupeConsecutiveCablePoints(out);
  }

  function snapCablePointsAlongTrench(points, preferredTrenchId) {
    if (!points || points.length < 2) {
      return { points: points || [], trenchPathId: preferredTrenchId || null, cornerRadii: {} };
    }
    var out = [];
    var trenchId = preferredTrenchId || null;
    points.forEach(function (pt) {
      if (!pt) return;
      var proj = projectPointOnAnyExcavation(pt[0], pt[1], SNAP_THRESHOLD * 1.5);
      if (proj) {
        out.push([proj.x, proj.y]);
        if (!trenchId) trenchId = proj.trenchId;
      } else {
        out.push([Math.round(pt[0] * 10) / 10, Math.round(pt[1] * 10) / 10]);
      }
    });
    out = dedupeConsecutiveCablePoints(out);
    if (out.length < 2) {
      return { points: points, trenchPathId: trenchId, cornerRadii: {} };
    }
    return { points: out, trenchPathId: trenchId, cornerRadii: {} };
  }

  function findNearestEquipmentAtPoint(x, y, maxDist) {
    var de = global.FTTHDrawingEngine;
    var best = null;
    var bestD = maxDist;
    (Sim.nodes || []).forEach(function (node) {
      if (!node || node.type === 'pole') return;
      var center = de?.getDeviceSnapCenter?.(node) || getNodeCenterXY(node);
      if (!center) return;
      var d = Math.hypot(center.x - x, center.y - y);
      if (d <= maxDist && d < bestD) {
        bestD = d;
        best = node;
      }
    });
    return best;
  }

  function finalizeSavedCableTopology(cable) {
    if (!cable?.points || cable.points.length < 2) return;
    var cs = (Sim.layout && Sim.layout.cellSize) || 50;
    var linkDist = cs * 0.65;
    var startPt = cable.points[0];
    var endPt = cable.points[cable.points.length - 1];
    var startNode = findNearestEquipmentAtPoint(startPt[0], startPt[1], linkDist);
    var endNode = findNearestEquipmentAtPoint(endPt[0], endPt[1], linkDist);
    if (startNode && endNode && startNode.id === endNode.id) endNode = null;
    cable.connectedTo = {
      start: startNode ? getNodeSnapLabel(startNode) : (cable.connectedTo?.start || null),
      end: endNode ? getNodeSnapLabel(endNode) : (cable.connectedTo?.end || null),
    };
    cable.freeEnds = { start: !cable.connectedTo.start, end: !cable.connectedTo.end };
    var trenchIds = collectTrenchIdsFromCablePoints(cable.points);
    if (!trenchIds.length && cable.trenchPathId) trenchIds = [cable.trenchPathId];
    if (trenchIds.length) {
      cable.hostTrenchId = trenchIds[0];
      cable.trenchPathId = trenchIds[0];
      trenchIds.forEach(function (tid) { registerCableOnTrench(tid, cable.id); });
    }
    if (!cable.pointSnapNodeIds) cable.pointSnapNodeIds = [];
    while (cable.pointSnapNodeIds.length < cable.points.length) cable.pointSnapNodeIds.push(null);
    var handholeTol = Math.max(linkDist, 36);
    function nearestResumeHandhole(pt) {
      if (!pt) return null;
      var best = null;
      var bestDist = handholeTol;
      for (var hi = 0; hi < (Sim.nodes || []).length; hi++) {
        var n = Sim.nodes[hi];
        if (!n || (n.type !== 'handhole' && n.type !== 'fat_handhole')) continue;
        var c = global.FTTHDrawingEngine?.getDeviceSnapCenter?.(n) || getNodeCenterXY(n);
        if (!c) continue;
        var d = Math.hypot(pt[0] - c.x, pt[1] - c.y);
        if (d <= bestDist) { bestDist = d; best = n; }
      }
      return best;
    }
    if (!cable.pointSnapNodeIds[0]) {
      var hhStart = nearestResumeHandhole(startPt);
      if (hhStart) cable.pointSnapNodeIds[0] = hhStart.id;
    }
    var lastIdx = cable.points.length - 1;
    if (!cable.pointSnapNodeIds[lastIdx]) {
      var hhEnd = nearestResumeHandhole(endPt);
      if (hhEnd) cable.pointSnapNodeIds[lastIdx] = hhEnd.id;
    }
    snapCableEndpointsToHandholeCenters(cable);
  }

  function buildCableConnectedToFromSnapLabels(snapLabels) {
    var start = null;
    var end = null;
    (snapLabels || []).forEach(function (lbl) {
      if (!lbl) return;
      if (!start) start = lbl;
      end = lbl;
    });
    return { start: start, end: end };
  }

  function saveCableToDatabase(currentCablePoints, meta) {
    meta = meta || {};
    if (!currentCablePoints || currentCablePoints.length < 2) {
      if (DEBUG) {
        console.warn('[saveCableToDatabase] rejected — need at least 2 points', currentCablePoints);
      }
      return null;
    }
    var userDrawn = meta.userDrawn !== false;
    var pointsToSave = userDrawn
      ? clonePathPointArray(currentCablePoints)
      : dedupeConsecutiveCablePoints(clonePathPointArray(currentCablePoints));
    if (pointsToSave.length < 2) {
      if (DEBUG) {
        console.warn('[saveCableToDatabase] rejected — need at least 2 distinct waypoints');
      }
      return null;
    }
    var pointSnapNodeIds = (meta.pointSnapNodeIds || []).slice(0, pointsToSave.length);
    while (pointSnapNodeIds.length < pointsToSave.length) pointSnapNodeIds.push(null);
    if (!userDrawn) {
      pointsToSave = strictifyCableWaypoints(pointsToSave, pointSnapNodeIds);
      if (pointsToSave.length < 2) {
        if (DEBUG) {
          console.warn('[saveCableToDatabase] rejected — waypoints collapsed below 2 after trench snap');
        }
        return null;
      }
    }
    var snapLabels = (meta.snapLabels || []).slice(0, pointsToSave.length);
    while (snapLabels.length < pointsToSave.length) snapLabels.push(null);

    if (!userDrawn) {
      var routeCheck = validateCableRouting(meta.kind, pointSnapNodeIds);
      if (routeCheck && routeCheck.ok === false) {
        updateStatus(routeCheck.msg || 'Invalid cable routing', true);
        return null;
      }
      if (!validateCablePointsOnTrench(pointsToSave, pointSnapNodeIds, meta.trenchPathId)) {
        updateStatus('Cable must follow an existing excavation/trench path — draw trench first', true);
        return null;
      }
    }

    var trenchIds = (meta.trenchPathIds && meta.trenchPathIds.length)
      ? meta.trenchPathIds.slice()
      : collectTrenchIdsFromCablePoints(pointsToSave);
    var preferredTrenchId = meta.trenchPathId || (trenchIds.length ? trenchIds[0] : null);
    var snapResult = { points: pointsToSave, trenchPathId: preferredTrenchId || null, cornerRadii: {} };
    pointsToSave = snapResult.points || pointsToSave;
    if (pointsToSave.length < 2) {
      if (DEBUG) {
        console.warn('[saveCableToDatabase] rejected — path collapsed below 2 points after snap');
      }
      return null;
    }
    if (!trenchIds.length && snapResult.trenchPathId) trenchIds = [snapResult.trenchPathId];
    var cableCornerRadii = {};
    var cableBatch = meta.batch || getCableBatchForKind(meta.kind) || 1;
    var cableCapacity = meta.capacity || getCableCapacityForKind(meta.kind) || 12;
    setActiveCableKind(meta.kind);
    var ownerFdtId = meta.ownerFdtId ||
      (meta.mainCableTrail && meta.mainCableTrail.cabinetId) ||
      getActiveFdtId() ||
      null;
    /* Active FDT stays locked — map/cable save must not switch cabinet context. */
    var toolboxLabel = meta.cableName || assignCableAsBuiltLabel({
      kind: meta.kind,
      capacity: cableCapacity,
      batch: cableBatch,
      ownerFdtId: ownerFdtId,
    });
    if (ownerFdtId) {
      var cabBucket = ensureCabinetCounterBucket(ownerFdtId);
      if (!cabBucket.cableByCapacity[cableCapacity]) cabBucket.cableByCapacity[cableCapacity] = 0;
      cabBucket.cableByCapacity[cableCapacity] =
        Math.max(cabBucket.cableByCapacity[cableCapacity], cableBatch);
    }
    if (!Sim.counters.cableByCapacity[cableCapacity]) Sim.counters.cableByCapacity[cableCapacity] = 0;
    Sim.counters.cableByCapacity[cableCapacity] =
      Math.max(Sim.counters.cableByCapacity[cableCapacity], cableBatch);
    var connectedTo = buildCableConnectedToFromSnapLabels(snapLabels);

    Sim.fiberCablePathId++;
    var cableId = 'cable_path_' + Sim.fiberCablePathId;
    var cableRef = {
      id: cableId,
      type: 'Fiber_Cable',
      kind: meta.kind,
      capacity: cableCapacity,
      batch: cableBatch,
      name: toolboxLabel,
      asBuiltId: toolboxLabel,
      trenchPathId: preferredTrenchId || snapResult.trenchPathId || null,
      hostTrenchId: preferredTrenchId || snapResult.trenchPathId || null,
      trenchPathIds: trenchIds.length ? trenchIds.slice() : (preferredTrenchId ? [preferredTrenchId] : []),
      points: pointsToSave,
      cornerRadii: cableCornerRadii,
      connectedTo: connectedTo,
      freeEnds: { start: !connectedTo.start, end: !connectedTo.end },
      userDrawn: true,
      mergedToTrench: false,
      pointSnapNodeIds: pointSnapNodeIds.slice(),
      snapLabels: snapLabels.slice(),
    };
    if (ownerFdtId) cableRef.ownerFdtId = String(ownerFdtId);

    /* Phase 2–3: optional Main/Sub Cable visual sequences — metadata only */
    if (meta.mainCableTrail && typeof meta.mainCableTrail === 'object') {
      cableRef.mainCableTrail = {
        cabinetId: meta.mainCableTrail.cabinetId || null,
        cabinetLabel: meta.mainCableTrail.cabinetLabel || '',
        cableRoleLabel: meta.mainCableTrail.cableRoleLabel || 'M-CABLE',
        cableName: meta.mainCableTrail.cableName || toolboxLabel,
        closures: Array.isArray(meta.mainCableTrail.closures)
          ? meta.mainCableTrail.closures.map(function (c) {
            return { id: c && c.id, label: c && c.label };
          })
          : [],
        drops: Array.isArray(meta.mainCableTrail.drops)
          ? meta.mainCableTrail.drops.map(function (d) {
            return { id: d && d.id, label: d && d.label };
          })
          : [],
        nodeIds: Array.isArray(meta.mainCableTrail.nodeIds)
          ? meta.mainCableTrail.nodeIds.slice()
          : [],
      };
    }
    if (meta.subCableTrail && typeof meta.subCableTrail === 'object') {
      cableRef.subCableTrail = {
        closureId: meta.subCableTrail.closureId || null,
        closureLabel: meta.subCableTrail.closureLabel || '',
        cableRoleLabel: meta.subCableTrail.cableRoleLabel || 'S-CABLE',
        cableName: meta.subCableTrail.cableName || toolboxLabel,
        drops: Array.isArray(meta.subCableTrail.drops)
          ? meta.subCableTrail.drops.map(function (d) {
            return { id: d && d.id, label: d && d.label };
          })
          : [],
        nodeIds: Array.isArray(meta.subCableTrail.nodeIds)
          ? meta.subCableTrail.nodeIds.slice()
          : [],
      };
    }

    Sim.fiberCablePaths.push(cableRef);
    finalizeSavedCableTopology(cableRef);
    cableRef.userDrawn = true;
    cableRef.mergedToTrench = false;

    /* Clear hint after first-time save — warn only when a NEW draw session starts
       with an already-saved capacity+batch+kind (see ensurePenDraft). */
    updateHintAlarm(DEFAULT_TOOLBOX_FOOTER_HINT, false);

    /* Keep the user-selected batch locked after routing/save (e.g. stay on 12F4). */
    lockActiveCableBatchPreference();
    syncActiveCableBatchToEngines(meta.kind);

    saveState();
    renderGlobalDrawingLayer();
    requestCanvasRedraw();
    renderUnifiedSidebar();
    updateFieldStatusCounters();

    if (DEBUG) {
      console.log('[saveCableToDatabase] saved cable:', cableId, pointsToSave.length, 'vertices');
    }
    /* Phase 4: interactive trails → matrix immediately; otherwise debounced topology refresh */
    if (cableRef.mainCableTrail || cableRef.subCableTrail) {
      notifyFiberDesignTopologyChanged({
        immediate: true,
        interactive: true,
        path: {
          cableId: cableId,
          mainCableTrail: cableRef.mainCableTrail || null,
          subCableTrail: cableRef.subCableTrail || null,
        },
      });
    } else {
      notifyFiberDesignTopologyChanged();
    }

    return { type: 'fiber', id: cableId, cable: cableRef };
  }


  /**
   * Append (or prepend) a new drawn segment onto an existing cable polyline,
   * keeping the same batch / capacity / kind. Join vertices snap to Handhole centers.
   */
  function extendCableInDatabase(cableId, extensionPoints, meta) {
    meta = meta || {};
    var cable = null;
    var i;
    for (i = 0; i < (Sim.fiberCablePaths || []).length; i++) {
      if (String(Sim.fiberCablePaths[i].id) === String(cableId)) {
        cable = Sim.fiberCablePaths[i];
        break;
      }
    }
    if (!cable) {
      if (DEBUG) {
        console.warn('[extendCableInDatabase] cable not found', cableId);
      }
      return null;
    }

    var joinEnd = meta.continueEnd === 'start' ? 'start' : 'end';
    var extPts = clonePathPointArray(extensionPoints);
    if (!extPts || extPts.length < 2) {
      if (DEBUG) {
        console.warn('[extendCableInDatabase] need at least 2 extension points');
      }
      return null;
    }

    var existing = clonePathPointArray(cable.points || []);
    if (existing.length < 1) return null;

    var extSnaps = (meta.pointSnapNodeIds || []).slice(0, extPts.length);
    var extLabels = (meta.snapLabels || []).slice(0, extPts.length);
    while (extSnaps.length < extPts.length) extSnaps.push(null);
    while (extLabels.length < extPts.length) extLabels.push(null);

    var baseSnaps = (cable.pointSnapNodeIds || []).slice();
    var baseLabels = (cable.snapLabels || []).slice();
    while (baseSnaps.length < existing.length) baseSnaps.push(null);
    while (baseLabels.length < existing.length) baseLabels.push(null);
    baseSnaps = baseSnaps.slice(0, existing.length);
    baseLabels = baseLabels.slice(0, existing.length);

    function handholeCenterForNodeId(nodeId) {
      if (!nodeId) return null;
      var node = findNode(nodeId);
      if (!node || (node.type !== 'handhole' && node.type !== 'fat_handhole')) return null;
      var c = global.FTTHDrawingEngine?.getDeviceSnapCenter?.(node) || getNodeCenterXY(node);
      if (!c || !isFinite(c.x) || !isFinite(c.y)) return null;
      return [Math.round(c.x * 10) / 10, Math.round(c.y * 10) / 10];
    }

    function nearJoin(a, b) {
      return !!(a && b && Math.hypot(a[0] - b[0], a[1] - b[1]) <= 40);
    }

    var joinNodeId = meta.joinNodeId ||
      (joinEnd === 'end'
        ? (baseSnaps[baseSnaps.length - 1] || extSnaps[0])
        : (baseSnaps[0] || extSnaps[0]));
    var joinCenter = handholeCenterForNodeId(joinNodeId);

    if (joinEnd === 'end') {
      if (joinCenter) {
        existing[existing.length - 1] = joinCenter.slice();
        if (joinNodeId) baseSnaps[baseSnaps.length - 1] = joinNodeId;
        if (extPts[0]) extPts[0] = joinCenter.slice();
        if (joinNodeId) extSnaps[0] = joinNodeId;
      }
      if (nearJoin(extPts[0], existing[existing.length - 1])) {
        extPts = extPts.slice(1);
        extSnaps = extSnaps.slice(1);
        extLabels = extLabels.slice(1);
      }
      if (!extPts.length) return null;
      cable.points = existing.concat(extPts);
      cable.pointSnapNodeIds = baseSnaps.concat(extSnaps);
      cable.snapLabels = baseLabels.concat(extLabels);
    } else {
      if (joinCenter) {
        existing[0] = joinCenter.slice();
        if (joinNodeId) baseSnaps[0] = joinNodeId;
        if (extPts[0]) extPts[0] = joinCenter.slice();
        if (joinNodeId) extSnaps[0] = joinNodeId;
      }
      if (nearJoin(extPts[0], existing[0])) {
        extPts = extPts.slice(1);
        extSnaps = extSnaps.slice(1);
        extLabels = extLabels.slice(1);
      }
      if (!extPts.length) return null;
      extPts.reverse();
      extSnaps.reverse();
      extLabels.reverse();
      cable.points = extPts.concat(existing);
      cable.pointSnapNodeIds = extSnaps.concat(baseSnaps);
      cable.snapLabels = extLabels.concat(baseLabels);
    }

    var trenchIds = (meta.trenchPathIds && meta.trenchPathIds.length)
      ? meta.trenchPathIds.slice()
      : collectTrenchIdsFromCablePoints(cable.points);
    if (trenchIds.length) {
      cable.trenchPathIds = trenchIds.slice();
      if (!cable.trenchPathId) cable.trenchPathId = trenchIds[0];
      if (!cable.hostTrenchId) cable.hostTrenchId = trenchIds[0];
    }

    cable.connectedTo = buildCableConnectedToFromSnapLabels(cable.snapLabels);
    cable.freeEnds = {
      start: !cable.connectedTo.start,
      end: !cable.connectedTo.end,
    };
    cable.userDrawn = true;
    cable.mergedToTrench = false;
    var extendOwner = meta.ownerFdtId ||
      (meta.mainCableTrail && meta.mainCableTrail.cabinetId) ||
      cable.ownerFdtId ||
      getActiveFdtId() ||
      null;
    if (extendOwner) cable.ownerFdtId = String(extendOwner);
    /* Phase 2–3: merge visual Main/Sub Cable trail metadata when continuing a draw */
    if (meta.mainCableTrail && typeof meta.mainCableTrail === 'object') {
      cable.mainCableTrail = {
        cabinetId: meta.mainCableTrail.cabinetId || (cable.mainCableTrail && cable.mainCableTrail.cabinetId) || null,
        cabinetLabel: meta.mainCableTrail.cabinetLabel || (cable.mainCableTrail && cable.mainCableTrail.cabinetLabel) || '',
        cableRoleLabel: meta.mainCableTrail.cableRoleLabel || 'M-CABLE',
        cableName: meta.mainCableTrail.cableName || cable.name || cable.asBuiltId || '',
        closures: Array.isArray(meta.mainCableTrail.closures)
          ? meta.mainCableTrail.closures.map(function (c) {
            return { id: c && c.id, label: c && c.label };
          })
          : ((cable.mainCableTrail && cable.mainCableTrail.closures) || []).slice(),
        drops: Array.isArray(meta.mainCableTrail.drops)
          ? meta.mainCableTrail.drops.map(function (d) {
            return { id: d && d.id, label: d && d.label };
          })
          : ((cable.mainCableTrail && cable.mainCableTrail.drops) || []).slice(),
        nodeIds: Array.isArray(meta.mainCableTrail.nodeIds)
          ? meta.mainCableTrail.nodeIds.slice()
          : ((cable.mainCableTrail && cable.mainCableTrail.nodeIds) || []).slice(),
      };
    }
    if (meta.subCableTrail && typeof meta.subCableTrail === 'object') {
      cable.subCableTrail = {
        closureId: meta.subCableTrail.closureId || (cable.subCableTrail && cable.subCableTrail.closureId) || null,
        closureLabel: meta.subCableTrail.closureLabel || (cable.subCableTrail && cable.subCableTrail.closureLabel) || '',
        cableRoleLabel: meta.subCableTrail.cableRoleLabel || 'S-CABLE',
        cableName: meta.subCableTrail.cableName || cable.name || cable.asBuiltId || '',
        drops: Array.isArray(meta.subCableTrail.drops)
          ? meta.subCableTrail.drops.map(function (d) {
            return { id: d && d.id, label: d && d.label };
          })
          : ((cable.subCableTrail && cable.subCableTrail.drops) || []).slice(),
        nodeIds: Array.isArray(meta.subCableTrail.nodeIds)
          ? meta.subCableTrail.nodeIds.slice()
          : ((cable.subCableTrail && cable.subCableTrail.nodeIds) || []).slice(),
      };
    }

    finalizeSavedCableTopology(cable);
    snapCableEndpointsToHandholeCenters(cable);
    cable.userDrawn = true;
    cable.mergedToTrench = false;

    updateHintAlarm(DEFAULT_TOOLBOX_FOOTER_HINT, false);
    saveState();
    renderGlobalDrawingLayer();
    requestCanvasRedraw();
    renderUnifiedSidebar();
    updateFieldStatusCounters();

    if (DEBUG) {
      console.log('[extendCableInDatabase] extended cable:', cable.id, cable.points.length, 'vertices');
    }
    if (cable.mainCableTrail || cable.subCableTrail) {
      notifyFiberDesignTopologyChanged({
        immediate: true,
        interactive: true,
        path: {
          cableId: cable.id,
          mainCableTrail: cable.mainCableTrail || null,
          subCableTrail: cable.subCableTrail || null,
        },
      });
    } else {
      notifyFiberDesignTopologyChanged();
    }

    return { type: 'fiber', id: cable.id, cable: cable };
  }

  function snapCableEndpointsToHandholeCenters(cable) {
    if (!cable?.points || cable.points.length < 2) return;
    if (!cable.pointSnapNodeIds) cable.pointSnapNodeIds = [];
    while (cable.pointSnapNodeIds.length < cable.points.length) cable.pointSnapNodeIds.push(null);

    function centerFor(nodeId, fallbackPt) {
      var node = nodeId ? findNode(nodeId) : null;
      if (!node || (node.type !== 'handhole' && node.type !== 'fat_handhole')) {
        if (!fallbackPt) return null;
        var cs = (Sim.layout && Sim.layout.cellSize) || 50;
        var tol = Math.max(cs * 0.65, 36);
        var best = null;
        var bestDist = tol;
        for (var ni = 0; ni < (Sim.nodes || []).length; ni++) {
          var n = Sim.nodes[ni];
          if (!n || (n.type !== 'handhole' && n.type !== 'fat_handhole')) continue;
          var c0 = global.FTTHDrawingEngine?.getDeviceSnapCenter?.(n) || getNodeCenterXY(n);
          if (!c0) continue;
          var d = Math.hypot(fallbackPt[0] - c0.x, fallbackPt[1] - c0.y);
          if (d <= bestDist) {
            bestDist = d;
            best = { node: n, center: c0 };
          }
        }
        if (!best) return null;
        return {
          nodeId: best.node.id,
          pt: [Math.round(best.center.x * 10) / 10, Math.round(best.center.y * 10) / 10],
        };
      }
      var c = global.FTTHDrawingEngine?.getDeviceSnapCenter?.(node) || getNodeCenterXY(node);
      if (!c || !isFinite(c.x) || !isFinite(c.y)) return null;
      return {
        nodeId: node.id,
        pt: [Math.round(c.x * 10) / 10, Math.round(c.y * 10) / 10],
      };
    }

    var startFix = centerFor(cable.pointSnapNodeIds[0], cable.points[0]);
    if (startFix) {
      cable.points[0] = startFix.pt;
      cable.pointSnapNodeIds[0] = startFix.nodeId;
    }
    var last = cable.points.length - 1;
    var endFix = centerFor(cable.pointSnapNodeIds[last], cable.points[last]);
    if (endFix) {
      cable.points[last] = endFix.pt;
      cable.pointSnapNodeIds[last] = endFix.nodeId;
    }
  }

  function projectPointToSegment(px, py, ax, ay, bx, by) {
    var dx = bx - ax;
    var dy = by - ay;
    var lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-6) return [ax, ay];
    var t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
    return [Math.round((ax + t * dx) * 10) / 10, Math.round((ay + t * dy) * 10) / 10];
  }

  function projectPointOntoPolyline(pt, polyPts) {
    if (!pt || !polyPts || polyPts.length < 2) return pt ? pt.slice() : [0, 0];
    var best = null;
    var bestDist = Infinity;
    for (var i = 0; i < polyPts.length - 1; i++) {
      var proj = projectPointToSegment(pt[0], pt[1], polyPts[i][0], polyPts[i][1], polyPts[i + 1][0], polyPts[i + 1][1]);
      var d = Math.hypot(pt[0] - proj[0], pt[1] - proj[1]);
      if (d < bestDist) { bestDist = d; best = proj; }
    }
    return best || pt.slice();
  }

  function findBestTrenchForCable(cablePoints) {
    var trenches = Sim.excavationPaths || [];
    if (!trenches.length || !cablePoints || !cablePoints.length) return null;
    var best = null;
    var bestScore = Infinity;
    trenches.forEach(function (trench) {
      if (!trench.points || trench.points.length < 2) return;
      var totalDist = 0;
      cablePoints.forEach(function (pt) {
        var proj = projectPointOntoPolyline(pt, trench.points);
        totalDist += Math.hypot(pt[0] - proj[0], pt[1] - proj[1]);
      });
      var avgDist = totalDist / cablePoints.length;
      if (avgDist < bestScore) { bestScore = avgDist; best = trench; }
    });
    if (!best || bestScore > 50) return null;
    return best;
  }

  function joinCableToTrench(cable, trenchId, opts) {
    opts = opts || {};
    if (!cable || !trenchId) return false;
    var trench = findPathByRef({ type: 'excavation', id: trenchId });
    if (!trench) return false;
    registerCableOnTrench(trench.id, cable.id);
    if (!cable.hostTrenchId) cable.hostTrenchId = trench.id;
    if (!cable.trenchPathId) cable.trenchPathId = trench.id;
    if (opts.replaceGeometry) {
      alignCablePointsToTrench(cable, trench);
      cable.mergedToTrench = trench.id;
    }
    return true;
  }

  function mergeCableDraftToTrench(draft, trenchId) {
    var trench = findPathByRef({ type: 'excavation', id: trenchId });
    if (!draft || !trench?.points || trench.points.length < 2) return false;
    draft.trenchPathId = trench.id;
    draft.hostTrenchId = trench.id;
    draft.mergedToTrench = true;
    draft.points = clonePathPointArray(trench.points);
    draft.cornerRadii = JSON.parse(JSON.stringify(trench.cornerRadii || {}));
    draft.activePathPoints = draft.points.map(function (p) { return [p[0], p[1]]; });
    draft.snapLabels = draft.points.map(function () { return null; });
    draft.pointSnapNodeIds = draft.points.map(function () { return null; });
    var last = draft.points[draft.points.length - 1];
    draft.cursor = last ? last.slice() : null;
    return true;
  }

  function screenDistSqToCanvasPoint(clientX, clientY, cx, cy) {
    var de = global.FTTHDrawingEngine;
    if (de?.canvasXYToScreenXY) {
      var sp = de.canvasXYToScreenXY(cx, cy);
      var sdx = sp.x - clientX;
      var sdy = sp.y - clientY;
      return sdx * sdx + sdy * sdy;
    }
    var dx = cx - clientX;
    var dy = cy - clientY;
    return dx * dx + dy * dy;
  }

  function canvasSnapTolerance() {
    return (SNAP_THRESHOLD || 10) / Math.max(getMapCoordZoom(), 0.08);
  }

  function findExcavationTrenchSnapPoint(clientX, clientY, canvasX, canvasY, onlyTrenchId) {
    var trenches = Sim.excavationPaths || [];
    if (!trenches.length) return null;
    var probeX = isFinite(canvasX) ? canvasX : null;
    var probeY = isFinite(canvasY) ? canvasY : null;
    if ((probeX == null || probeY == null) && clientX != null && clientY != null) {
      var probe = pointerEventToCanvasXY({ clientX: clientX, clientY: clientY });
      if (probe) {
        probeX = probe.x;
        probeY = probe.y;
      }
    }
    if (probeX == null || probeY == null) return null;

    var canvasTol = canvasSnapTolerance();
    var canvasTolSq = canvasTol * canvasTol;
    var bestDistSq = canvasTolSq + 1;
    var best = null;

    trenches.forEach(function (trench) {
      if (onlyTrenchId && trench.id !== onlyTrenchId) return;
      var pts = trench.points;
      if (pts && pts.length >= 2) {
        for (var j = 0; j < pts.length - 1; j++) {
          var p1 = pts[j];
          var p2 = pts[j + 1];
          if (!p1 || !p2) continue;
          var proj = projectPointToSegment(probeX, probeY, p1[0], p1[1], p2[0], p2[1]);
          var dx = probeX - proj[0];
          var dy = probeY - proj[1];
          var d2 = dx * dx + dy * dy;
          if (d2 <= canvasTolSq && d2 < bestDistSq) {
            bestDistSq = d2;
            best = {
              x: proj[0],
              y: proj[1],
              kind: 'trench-segment',
              pathType: 'excavation',
              pathId: trench.id,
              segIndex: j,
            };
          }
        }
      }
      var editor = global.FTTHPathwayEditor;
      (trench.connectorSegments || []).forEach(function (connSeg, connIdx) {
        var connPts = editor?.buildConnectorRenderPoints?.(trench, connSeg) || [];
        for (var cj = 0; cj < connPts.length - 1; cj++) {
          var cp1 = connPts[cj];
          var cp2 = connPts[cj + 1];
          if (!cp1 || !cp2) continue;
          var cproj = projectPointToSegment(probeX, probeY, cp1[0], cp1[1], cp2[0], cp2[1]);
          var cdx = probeX - cproj[0];
          var cdy = probeY - cproj[1];
          var cd2 = cdx * cdx + cdy * cdy;
          if (cd2 <= canvasTolSq && cd2 < bestDistSq) {
            bestDistSq = cd2;
            best = {
              x: cproj[0],
              y: cproj[1],
              kind: 'trench-segment',
              pathType: 'excavation',
              pathId: trench.id,
              segIndex: cj,
              connectorIndex: connIdx,
            };
          }
        }
      });
    });
    return best;
  }

  function trenchPointsNear(a, b, tol) {
    tol = tol == null ? 2 : tol;
    if (!a || !b) return false;
    return Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol;
  }

  function findTrenchVertexIndex(trench, x, y) {
    if (!trench?.points) return -1;
    for (var i = 0; i < trench.points.length; i++) {
      if (trenchPointsNear(trench.points[i], [x, y], 4)) return i;
    }
    return -1;
  }

  function findExcavationTrenchVertexSnapPoint(clientX, clientY, onlyTrenchId) {
    var trenches = Sim.excavationPaths || [];
    if (!trenches.length) return null;
    var probe = (clientX != null && clientY != null)
      ? pointerEventToCanvasXY({ clientX: clientX, clientY: clientY })
      : null;
    if (!probe) return null;

    var canvasTol = canvasSnapTolerance();
    var canvasTolSq = canvasTol * canvasTol;
    var bestDistSq = canvasTolSq + 1;
    var best = null;

    trenches.forEach(function (trench) {
      if (onlyTrenchId && trench.id !== onlyTrenchId) return;
      var pts = trench.points;
      if (pts && pts.length) {
        for (var j = 0; j < pts.length; j++) {
          var vtx = pts[j];
          if (!vtx) continue;
          var dx = probe.x - vtx[0];
          var dy = probe.y - vtx[1];
          var d2 = dx * dx + dy * dy;
          if (d2 <= canvasTolSq && d2 < bestDistSq) {
            bestDistSq = d2;
            best = {
              x: vtx[0],
              y: vtx[1],
              kind: 'trench-vertex',
              pathType: 'excavation',
              pathId: trench.id,
              vertexIndex: j,
            };
          }
        }
      }
      var editor = global.FTTHPathwayEditor;
      (trench.connectorSegments || []).forEach(function (connSeg, connIdx) {
        var connPts = editor?.buildConnectorRenderPoints?.(trench, connSeg) || connSeg.points || [];
        for (var cj = 0; cj < connPts.length; cj++) {
          var cv = connPts[cj];
          if (!cv) continue;
          var cdx = probe.x - cv[0];
          var cdy = probe.y - cv[1];
          var cd2 = cdx * cdx + cdy * cdy;
          if (cd2 <= canvasTolSq && cd2 < bestDistSq) {
            bestDistSq = cd2;
            best = {
              x: cv[0],
              y: cv[1],
              kind: 'trench-vertex',
              pathType: 'excavation',
              pathId: trench.id,
              vertexIndex: connSeg.fromVertexIndex,
              connectorIndex: connIdx,
            };
          }
        }
      });
    });
    return best;
  }

  var CABLE_TRENCH_VERTEX_HIT_PX = 10;
  var CABLE_TRENCH_SEGMENT_HIT_PX = 8;

  function getCableTrenchVertexHitSq() {
    var r = CABLE_TRENCH_VERTEX_HIT_PX;
    return r * r;
  }

  function getCableTrenchSegmentHitSq() {
    var r = CABLE_TRENCH_SEGMENT_HIT_PX;
    return r * r;
  }

  function getCableTrenchSegmentHitCanvasTol() {
    return CABLE_TRENCH_SEGMENT_HIT_PX / Math.max(getMapCoordZoom(), 0.08);
  }

  function getCableEffectiveSnapRadius() {
    return CABLE_TRENCH_SEGMENT_HIT_PX;
  }

  function getCableEffectiveSnapRadiusSq() {
    var r = getCableEffectiveSnapRadius();
    return r * r;
  }

  function formatCableSnapHit(payload) {
    if (!payload) return null;
    return {
      x: payload.x,
      y: payload.y,
      target: payload,
      snapKind: payload.snapKind || payload.kind,
      snapLabel: payload.label || null,
      snapNodeId: payload.nodeId || null,
    };
  }

  /** Handhole/device proximity snap (preview + click assist). */
  function findCableNodeMagneticSnap(clientX, clientY) {
    if (clientX == null || clientY == null) return null;
    var de = global.FTTHDrawingEngine;
    if (!de?.screenDistSqToCanvasPoint) return null;

    var effectiveRadiusSq = getCableEffectiveSnapRadiusSq();
    var best = null;

    function consider(d2, payload, priority) {
      if (d2 == null || d2 > effectiveRadiusSq) return;
      if (!best || priority > best.priority || (priority === best.priority && d2 < best.d2)) {
        best = { d2: d2, payload: payload, priority: priority };
      }
    }

    (Sim.nodes || []).forEach(function (node) {
      if (!node || node.type !== 'handhole') return;
      var center = de.getDeviceSnapCenter?.(node);
      if (!center) return;
      consider(de.screenDistSqToCanvasPoint(clientX, clientY, center.x, center.y), {
        x: center.x,
        y: center.y,
        kind: 'handhole',
        nodeId: node.id,
        label: getNodeSnapLabel(node),
        snapKind: 'handhole',
      }, 30);
    });

    (Sim.nodes || []).forEach(function (node) {
      if (!node || node.type !== 'fat_handhole') return;
      var center = de.getDeviceSnapCenter?.(node);
      if (!center) return;
      consider(de.screenDistSqToCanvasPoint(clientX, clientY, center.x, center.y), {
        x: center.x,
        y: center.y,
        kind: 'handhole',
        nodeId: node.id,
        label: getNodeSnapLabel(node),
        snapKind: 'handhole',
        handholeVariant: 'fat_triangle',
      }, 30);
    });

    (Sim.nodes || []).forEach(function (node) {
      if (!node || node.type === 'handhole' || node.type === 'fat_handhole' || node.type === 'pole') return;
      if (node.type !== 'fdt' && node.type !== 'pole_foundation') return;
      var center = de.getDeviceSnapCenter?.(node);
      if (!center) return;
      consider(de.screenDistSqToCanvasPoint(clientX, clientY, center.x, center.y), {
        x: center.x,
        y: center.y,
        kind: 'device',
        nodeId: node.id,
        label: getNodeSnapLabel(node),
        snapKind: 'device',
      }, 25);
    });

    return best ? formatCableSnapHit(best.payload) : null;
  }

  function probePathGuideSnap(clientX, clientY, probeX, probeY, path, pathType, de) {
    if (!path) return null;
    var best = null;
    var vertexHitSq = getCableTrenchVertexHitSq();
    var segmentHitSq = getCableTrenchSegmentHitSq();
    var canvasTol = getCableTrenchSegmentHitCanvasTol();
    var canvasTolSq = canvasTol * canvasTol;
    var isFiber = pathType === 'fiber';
    var resolvedPathType = isFiber ? 'fiber' : 'excavation';

    function consider(priority, d2, payload) {
      if (d2 == null) return;
      if (!best || priority > best.priority || (priority === best.priority && d2 < best.d2)) {
        best = { priority: priority, d2: d2, payload: payload };
      }
    }

    var pts = path.points || [];
    for (var j = 0; j < pts.length; j++) {
      var vtx = pts[j];
      if (!vtx) continue;
      var vtxD2 = de.screenDistSqToCanvasPoint(clientX, clientY, vtx[0], vtx[1]);
      if (vtxD2 > vertexHitSq) continue;
      var isEndpoint = j === 0 || j === pts.length - 1;
      var vtxKind = isFiber
        ? (isEndpoint ? 'path-endpoint' : 'path-vertex')
        : 'trench-vertex';
      consider(20, vtxD2, {
        x: vtx[0],
        y: vtx[1],
        kind: vtxKind,
        pathType: resolvedPathType,
        pathId: path.id,
        vertexIndex: j,
        snapKind: vtxKind,
      });
    }

    if (probeX != null && probeY != null && pts.length >= 2) {
      for (var sj = 0; sj < pts.length - 1; sj++) {
        var p1 = pts[sj];
        var p2 = pts[sj + 1];
        if (!p1 || !p2) continue;
        var proj = projectPointToSegment(probeX, probeY, p1[0], p1[1], p2[0], p2[1]);
        var cdx = probeX - proj[0];
        var cdy = probeY - proj[1];
        if (cdx * cdx + cdy * cdy > canvasTolSq) continue;
        var screenD2 = de.screenDistSqToCanvasPoint(clientX, clientY, proj[0], proj[1]);
        if (screenD2 > segmentHitSq) continue;
        var segKind = isFiber ? 'cable-segment' : 'trench-segment';
        consider(10, screenD2, {
          x: proj[0],
          y: proj[1],
          kind: segKind,
          pathType: resolvedPathType,
          pathId: path.id,
          segIndex: sj,
          snapKind: segKind,
        });
      }
    }

    if (!isFiber && path.connectorSegments && global.FTTHPathwayEditor?.buildConnectorRenderPoints) {
      var editor = global.FTTHPathwayEditor;
      (path.connectorSegments || []).forEach(function (connSeg, connIdx) {
        var connPts = editor.buildConnectorRenderPoints(path, connSeg) || [];
        for (var cj = 0; cj < connPts.length; cj++) {
          var cv = connPts[cj];
          if (!cv) continue;
          var connVtxD2 = de.screenDistSqToCanvasPoint(clientX, clientY, cv[0], cv[1]);
          if (connVtxD2 <= vertexHitSq) {
            consider(20, connVtxD2, {
              x: cv[0],
              y: cv[1],
              kind: 'trench-vertex',
              pathType: resolvedPathType,
              pathId: path.id,
              vertexIndex: connSeg.fromVertexIndex,
              connectorIndex: connIdx,
              snapKind: 'trench-vertex',
            });
          }
        }
        for (var ck = 0; ck < connPts.length - 1; ck++) {
          var cp1 = connPts[ck];
          var cp2 = connPts[ck + 1];
          if (!cp1 || !cp2 || probeX == null || probeY == null) continue;
          var cproj = projectPointToSegment(probeX, probeY, cp1[0], cp1[1], cp2[0], cp2[1]);
          var csdx = probeX - cproj[0];
          var csdy = probeY - cproj[1];
          if (csdx * csdx + csdy * csdy > canvasTolSq) continue;
          var connSegD2 = de.screenDistSqToCanvasPoint(clientX, clientY, cproj[0], cproj[1]);
          if (connSegD2 > segmentHitSq) continue;
          consider(10, connSegD2, {
            x: cproj[0],
            y: cproj[1],
            kind: 'trench-segment',
            pathType: resolvedPathType,
            pathId: path.id,
            segIndex: ck,
            connectorIndex: connIdx,
            snapKind: 'trench-segment',
          });
        }
      });
    }

    return best;
  }

  function probeTrenchPathGuideSnap(clientX, clientY, probeX, probeY, trench, de) {
    return probePathGuideSnap(clientX, clientY, probeX, probeY, trench, 'excavation', de);
  }

  /**
   * Snap-to-path guide: trench/cable vertices + segment projection (preview only).
   */
  function findPathGuideSnap(clientX, clientY, canvasX, canvasY, opts) {
    opts = opts || {};
    if (clientX == null || clientY == null) return null;
    var de = global.FTTHDrawingEngine;
    if (!de?.screenDistSqToCanvasPoint) return null;

    var probeX = isFinite(canvasX) ? canvasX : null;
    var probeY = isFinite(canvasY) ? canvasY : null;
    if (probeX == null || probeY == null) {
      var probe = pointerEventToCanvasXY({ clientX: clientX, clientY: clientY });
      if (probe) {
        probeX = probe.x;
        probeY = probe.y;
      }
    }
    if (probeX == null || probeY == null) return null;

    var preferTrenchId = opts.preferTrenchId || null;
    var excludeFiberId = opts.excludeFiberId || null;
    var includeExcavation = opts.includeExcavation !== false;
    var includeFiber = opts.includeFiber !== false;

    var globalBest = null;
    function mergeBest(local) {
      if (!local) return;
      if (!globalBest || local.priority > globalBest.priority ||
          (local.priority === globalBest.priority && local.d2 < globalBest.d2)) {
        globalBest = local;
      }
    }

    if (includeExcavation) {
      var trenches = Sim.excavationPaths || [];
      if (preferTrenchId) {
        var preferred = findPathByRef({ type: 'excavation', id: preferTrenchId });
        if (preferred) mergeBest(probePathGuideSnap(clientX, clientY, probeX, probeY, preferred, 'excavation', de));
      }
      for (var ti = 0; ti < trenches.length; ti++) {
        var trench = trenches[ti];
        if (!trench || (preferTrenchId && trench.id === preferTrenchId)) continue;
        mergeBest(probePathGuideSnap(clientX, clientY, probeX, probeY, trench, 'excavation', de));
      }
    }

    if (includeFiber) {
      (Sim.fiberCablePaths || []).forEach(function (cable) {
        if (!cable || (excludeFiberId && cable.id === excludeFiberId)) return;
        mergeBest(probePathGuideSnap(clientX, clientY, probeX, probeY, cable, 'fiber', de));
      });
    }

    return globalBest ? formatCableSnapHit(globalBest.payload) : null;
  }

  /**
   * Snap-to-trench-path guide: existing vertices + segment projection.
   * Preview only — never inserts cable vertices.
   */
  function findCableTrenchPathGuideSnap(clientX, clientY, canvasX, canvasY, preferTrenchId) {
    var draft = Sim.penDraft;
    var excludeFiberId = draft?.continueFromCable?.id || draft?.hostCableId || null;
    return findPathGuideSnap(clientX, clientY, canvasX, canvasY, {
      preferTrenchId: preferTrenchId,
      excludeFiberId: excludeFiberId,
      includeExcavation: true,
      includeFiber: true,
    });
  }

  /** Preview snap for excavation pen — trenches + existing cables. */
  function findPenPathGuideSnap(clientX, clientY, canvasX, canvasY) {
    return findPathGuideSnap(clientX, clientY, canvasX, canvasY, {
      includeExcavation: true,
      includeFiber: true,
    });
  }

  function findCableMagneticSnapPoint(clientX, clientY, canvasX, canvasY) {
    var nodeHit = findCableNodeMagneticSnap(clientX, clientY);
    if (nodeHit) return nodeHit;
    return findCableTrenchPathGuideSnap(clientX, clientY, canvasX, canvasY, null);
  }

  function getTrenchVertexSubpathPoints(trenchId, fromIndex, toIndex, includeFrom) {
    var trench = findPathByRef({ type: 'excavation', id: trenchId });
    if (!trench?.points || fromIndex == null || toIndex == null) return [];
    if (fromIndex === toIndex) return [];
    var out = [];
    if (toIndex > fromIndex) {
      var start = includeFrom ? fromIndex : fromIndex + 1;
      for (var i = start; i <= toIndex; i++) {
        var pt = trench.points[i];
        if (pt) out.push([pt[0], pt[1]]);
      }
    } else {
      var startRev = includeFrom ? fromIndex : fromIndex - 1;
      for (var j = startRev; j >= toIndex; j--) {
        var ptRev = trench.points[j];
        if (ptRev) out.push([ptRev[0], ptRev[1]]);
      }
    }
    return out;
  }

  function appendCableVerticesAlongTrench(draft, trenchId, targetVertexIndex) {
    if (!draft || trenchId == null || targetVertexIndex == null) return false;
    var trench = findPathByRef({ type: 'excavation', id: trenchId });
    if (!trench?.points || targetVertexIndex < 0 || targetVertexIndex >= trench.points.length) return false;

    draft.trenchPathId = trenchId;
    draft.hostTrenchId = trenchId;

    var fromIndex = draft.lastTrenchVertexIndex;
    if (fromIndex == null && draft.points?.length) {
      fromIndex = findTrenchVertexIndex(trench, draft.points[draft.points.length - 1][0], draft.points[draft.points.length - 1][1]);
      if (fromIndex >= 0) draft.lastTrenchVertexIndex = fromIndex;
    }

    if (fromIndex == null) {
      var firstPt = trench.points[targetVertexIndex];
      if (!firstPt) return false;
      draft.points.push([firstPt[0], firstPt[1]]);
      draft.snapLabels.push(null);
      draft.pointSnapNodeIds.push(null);
      draft.lastTrenchVertexIndex = targetVertexIndex;
      return true;
    }

    if (fromIndex === targetVertexIndex) return false;

    var segmentPts = getTrenchVertexSubpathPoints(trenchId, fromIndex, targetVertexIndex, false);
    if (!segmentPts.length) return false;

    segmentPts.forEach(function (pt) {
      var last = draft.points[draft.points.length - 1];
      if (last && trenchPointsNear(last, pt, 2)) return;
      draft.points.push(pt.slice());
      draft.snapLabels.push(null);
      draft.pointSnapNodeIds.push(null);
    });
    draft.lastTrenchVertexIndex = targetVertexIndex;
    return true;
  }

  function isCablePenDrawActive() {
    return canPenDraw() && !!(Sim.pen && Sim.pen.lineMode === 'cable');
  }

  function isHandholeTypeNode(node) {
    return !!(node && (node.type === 'handhole' || node.type === 'fat_handhole'));
  }

  function isHandholeGeometryLocked() {
    if (isCablePenDrawActive()) return true;
    if (Sim.pen && Sim.pen.lineMode === 'cable' && (hasActiveDrawingStroke() || Sim.penDraft)) return true;
    if (Sim.pathEdit?.ghostDragging && Sim.pathEdit?.editingPathId?.type === 'fiber') return true;
    if (Sim.pathEdit?.vertexToolActive && Sim.pathEdit?.editingPathId?.type === 'fiber') return true;
    if (Sim.pathEdit?.splitToolActive && Sim.pathEdit?.editingPathId?.type === 'fiber') return true;
    if (Sim.selectedPath?.type === 'fiber' &&
        (Sim.pathEdit?.editActive || Sim.pathEdit?.vertexToolActive || Sim.pathEdit?.splitToolActive)) {
      return true;
    }
    return false;
  }

  function isHandholeNodePositionLocked(node) {
    return isHandholeTypeNode(node) && (node.locked || isHandholeGeometryLocked());
  }

  function clonePathPointArray(points) {
    return (points || []).map(function (p) {
      return [p[0], p[1]];
    });
  }

  function alignCablePointsToTrench(cable, trench) {
    if (!cable || !trench || !trench.points || trench.points.length < 2) return false;
    cable.points = clonePathPointArray(trench.points);
    cable.cornerRadii = JSON.parse(JSON.stringify(trench.cornerRadii || {}));
    cable.trenchPathId = trench.id;
    cable.hostTrenchId = trench.id;
    return true;
  }

  function isCableTrenchVertexLocked(cable) {
    if (!cable || cable.userDrawn) return false;
    if (cable.trenchPathIds && cable.trenchPathIds.length > 1) return false;
    if (collectTrenchIdsFromCablePoints(cable.points || []).length > 1) return false;
    var trench = resolveTrenchForCable(cable);
    if (!trench || !cable.points || !trench.points) return false;
    if (cable.points.length !== trench.points.length) return false;
    return !!(cable.mergedToTrench || cable.trenchPathId || cable.hostTrenchId);
  }

  function propagateLockedVertexEdit(pathType, pathId, vertexIndex, point) {
    if (vertexIndex == null || vertexIndex < 0 || !point) return;
    var pt = [point[0], point[1]];
    if (pathType === 'excavation') {
      getCablesOnTrench(pathId).forEach(function (cable) {
        if (isCableTrenchVertexLocked(cable) && cable.points[vertexIndex]) {
          cable.points[vertexIndex] = [pt[0], pt[1]];
        }
      });
      return;
    }
    if (pathType === 'fiber') {
      var cable = findPathByRef({ type: 'fiber', id: pathId });
      if (!isCableTrenchVertexLocked(cable)) return;
      var trench = resolveTrenchForCable(cable);
      if (!trench || !trench.points[vertexIndex]) return;
      trench.points[vertexIndex] = [pt[0], pt[1]];
      getCablesOnTrench(trench.id).forEach(function (other) {
        if (other.id === cable.id || !isCableTrenchVertexLocked(other)) return;
        if (other.points[vertexIndex]) other.points[vertexIndex] = [pt[0], pt[1]];
      });
    }
  }

  function propagateLockedVertexInsert(pathType, pathId, insertIndex, point) {
    if (insertIndex == null || insertIndex < 0 || !point) return;
    var pt = [point[0], point[1]];
    if (pathType === 'excavation') {
      getCablesOnTrench(pathId).forEach(function (cable) {
        if (!isCableTrenchVertexLocked(cable)) return;
        cable.points.splice(insertIndex, 0, [pt[0], pt[1]]);
      });
      return;
    }
    if (pathType === 'fiber') {
      var cable = findPathByRef({ type: 'fiber', id: pathId });
      if (!isCableTrenchVertexLocked(cable)) return;
      var trench = resolveTrenchForCable(cable);
      if (!trench) return;
      trench.points.splice(insertIndex, 0, [pt[0], pt[1]]);
      getCablesOnTrench(trench.id).forEach(function (other) {
        if (other.id === cable.id || !isCableTrenchVertexLocked(other)) return;
        other.points.splice(insertIndex, 0, [pt[0], pt[1]]);
      });
    }
  }

  function propagateLockedVertexDelete(pathType, pathId, vertexIndex) {
    if (vertexIndex == null || vertexIndex <= 0) return;
    if (pathType === 'excavation') {
      getCablesOnTrench(pathId).forEach(function (cable) {
        if (!isCableTrenchVertexLocked(cable)) return;
        if (cable.points.length > 2) cable.points.splice(vertexIndex, 1);
      });
      return;
    }
    if (pathType === 'fiber') {
      var cable = findPathByRef({ type: 'fiber', id: pathId });
      if (!isCableTrenchVertexLocked(cable)) return;
      var trench = resolveTrenchForCable(cable);
      if (!trench || trench.points.length <= 2) return;
      trench.points.splice(vertexIndex, 1);
      getCablesOnTrench(trench.id).forEach(function (other) {
        if (other.id === cable.id || !isCableTrenchVertexLocked(other)) return;
        if (other.points.length > 2) other.points.splice(vertexIndex, 1);
      });
    }
  }

  function syncLockedPathFromCable(cableId) {
    var cable = findPathByRef({ type: 'fiber', id: cableId });
    if (!cable || !isCableTrenchVertexLocked(cable)) return false;
    var trench = resolveTrenchForCable(cable);
    if (!trench) return false;
    trench.points = clonePathPointArray(cable.points);
    trench.cornerRadii = JSON.parse(JSON.stringify(cable.cornerRadii || {}));
    getCablesOnTrench(trench.id).forEach(function (other) {
      if (other.id === cable.id || !isCableTrenchVertexLocked(other)) return;
      alignCablePointsToTrench(other, trench);
    });
    return true;
  }

  function syncCablesOnTrench(trenchId) {
    if (!trenchId) return;
    var trench = findPathByRef({ type: 'excavation', id: trenchId });
    if (!trench) return;
    getCablesOnTrench(trenchId).forEach(function (cable) {
      if (cable.userDrawn || (cable.trenchPathIds && cable.trenchPathIds.length > 1)) return;
      if (collectTrenchIdsFromCablePoints(cable.points).length > 1) return;
      alignCablePointsToTrench(cable, trench);
      cable.mergedToTrench = trench.id;
    });
  }

  function syncAllCablePathsToTrenches() {
    (Sim.fiberCablePaths || []).forEach(function (cable) {
      if (cable.userDrawn || (cable.trenchPathIds && cable.trenchPathIds.length > 1)) return;
      if (collectTrenchIdsFromCablePoints(cable.points).length > 1) return;
      var trench = resolveTrenchForCable(cable);
      if (trench) {
        if (!cable.trenchPathId && !cable.hostTrenchId) {
          registerCableOnTrench(trench.id, cable.id);
        }
        alignCablePointsToTrench(cable, trench);
        cable.mergedToTrench = trench.id;
      }
    });
  }

  function resolveTrenchForCable(cable) {
    if (!cable) return null;
    if (cable.trenchPathId) {
      var byTrenchId = findPathByRef({ type: 'excavation', id: cable.trenchPathId });
      if (byTrenchId) return byTrenchId;
    }
    if (cable.hostTrenchId) {
      var byHostId = findPathByRef({ type: 'excavation', id: cable.hostTrenchId });
      if (byHostId) return byHostId;
    }
    var trenches = Sim.excavationPaths || [];
    for (var i = 0; i < trenches.length; i++) {
      var ids = trenches[i].cableIds || [];
      if (ids.indexOf(cable.id) >= 0) return trenches[i];
    }
    if (cable.points && cable.points.length >= 2) {
      return findBestTrenchForCable(cable.points);
    }
    return null;
  }

  function getCablesGroupedByTrench() {
    var groups = {};
    (Sim.fiberCablePaths || []).forEach(function (cable) {
      if (!cable) return;
      var trenchId = cable.hostTrenchId || cable.trenchPathId;
      if (!trenchId) {
        var trench = resolveTrenchForCable(cable);
        trenchId = trench ? trench.id : ('orphan_' + cable.id);
      }
      if (!groups[trenchId]) groups[trenchId] = [];
      groups[trenchId].push(cable);
    });
    return groups;
  }

  function sortCablesForLaneOrder(cables) {
    return (cables || []).slice().sort(function (a, b) {
      var ai = parseInt(String(a.id).replace(/\D/g, ''), 10) || 0;
      var bi = parseInt(String(b.id).replace(/\D/g, ''), 10) || 0;
      if (ai !== bi) return ai - bi;
      return String(a.id).localeCompare(String(b.id));
    });
  }

  function computeCableLaneOffsetPx(laneIndex, laneTotal) {
    var DE = global.FTTHDrawingEngine;
    if (DE?.calculateCableOffset) {
      return DE.calculateCableOffset(Sim.zoom || 1, laneIndex, laneTotal);
    }
    if (laneTotal <= 1) return 0;
    var spacing = CABLE_LANE_STEP_PX;
    var groupShift = ((laneTotal - 1) * spacing) / 2;
    return Math.round((laneIndex * spacing - groupShift) * 10) / 10;
  }

  function getCableLaneInfo(cable) {
    if (!cable) return { laneIndex: 0, laneTotal: 1, offsetPx: 0, trenchId: null };
    var trenchId = cable.hostTrenchId || cable.trenchPathId || null;
    if (!trenchId) {
      var trench = resolveTrenchForCable(cable);
      trenchId = trench ? trench.id : null;
    }
    var group = [cable];
    if (trenchId) {
      group = sortCablesForLaneOrder((Sim.fiberCablePaths || []).filter(function (c) {
        if (!c) return false;
        var tid = c.hostTrenchId || c.trenchPathId || null;
        if (!tid) {
          var t = resolveTrenchForCable(c);
          tid = t ? t.id : null;
        }
        return tid === trenchId;
      }));
      if (!group.length) group = [cable];
    }
    var laneIndex = 0;
    for (var i = 0; i < group.length; i++) {
      if (group[i].id === cable.id) {
        laneIndex = i;
        break;
      }
    }
    return {
      laneIndex: laneIndex,
      laneTotal: group.length,
      offsetPx: computeCableLaneOffsetPx(laneIndex, group.length),
      trenchId: trenchId,
    };
  }

  function getCableDraftLaneOffsetPx(draft) {
    return 0;
  }

  function snapCableWaypointToTrench(x, y, snapTarget, clientX, clientY) {
    if (snapTarget?.kind === 'handhole' || snapTarget?.nodeId) {
      var snapNode = snapTarget.nodeId ? findNode(snapTarget.nodeId) : null;
      if (!snapNode && clientX != null && clientY != null) {
        var magnetic = findCableMagneticSnapPoint(clientX, clientY, x, y);
        if (magnetic?.snapNodeId) snapNode = findNode(magnetic.snapNodeId);
      }
      var center = snapNode && (global.FTTHDrawingEngine?.getDeviceSnapCenter?.(snapNode));
      if (center) {
        return [Math.round(center.x * 10) / 10, Math.round(center.y * 10) / 10];
      }
    }
    if (snapTarget?.kind === 'trench-vertex') {
      if (isFinite(snapTarget.x) && isFinite(snapTarget.y)) {
        return [Math.round(snapTarget.x * 10) / 10, Math.round(snapTarget.y * 10) / 10];
      }
      var path = findPathByRef({ type: 'excavation', id: snapTarget.pathId });
      var vi = snapTarget.vertexIndex;
      if (path?.points?.[vi]) {
        return [path.points[vi][0], path.points[vi][1]];
      }
    }
    if (clientX != null && clientY != null) {
      var magneticPt = findCableMagneticSnapPoint(clientX, clientY, x, y);
      if (magneticPt) {
        if (magneticPt.snapKind === 'handhole' || magneticPt.snapNodeId) {
          return [Math.round(magneticPt.x * 10) / 10, Math.round(magneticPt.y * 10) / 10];
        }
        if (magneticPt.snapKind === 'trench-vertex') {
          return [Math.round(magneticPt.x * 10) / 10, Math.round(magneticPt.y * 10) / 10];
        }
      }
      var vtx = findExcavationTrenchVertexSnapPoint(clientX, clientY, null);
      if (vtx) return [Math.round(vtx.x * 10) / 10, Math.round(vtx.y * 10) / 10];
    }
    var proj = projectPointOnAnyExcavation(x, y, getCableEffectiveSnapRadius() / Math.max(getMapCoordZoom(), 0.08));
    if (proj) return [Math.round(proj.x * 10) / 10, Math.round(proj.y * 10) / 10];
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
  }

  function strictifyCableWaypoints(points, pointSnapNodeIds) {
    var snapIds = pointSnapNodeIds || [];
    return (points || []).map(function (pt, i) {
      if (!pt) return null;
      var nodeId = snapIds[i];
      if (nodeId) {
        var node = findNode(nodeId);
        var center = node && (global.FTTHDrawingEngine?.getDeviceSnapCenter?.(node));
        if (center) {
          return [Math.round(center.x * 10) / 10, Math.round(center.y * 10) / 10];
        }
      }
      return snapCableWaypointToTrench(pt[0], pt[1], null);
    }).filter(Boolean);
  }

  function offsetPolylineLateral(points, offsetPx) {
    if (!points || points.length < 2 || !offsetPx) {
      return clonePathPointArray(points || []);
    }
    var out = [];
    for (var i = 0; i < points.length; i++) {
      var nx;
      var ny;
      if (i === 0) {
        var dx0 = points[1][0] - points[0][0];
        var dy0 = points[1][1] - points[0][1];
        var len0 = Math.hypot(dx0, dy0) || 1;
        nx = -dy0 / len0;
        ny = dx0 / len0;
      } else if (i === points.length - 1) {
        var dx1 = points[i][0] - points[i - 1][0];
        var dy1 = points[i][1] - points[i - 1][1];
        var len1 = Math.hypot(dx1, dy1) || 1;
        nx = -dy1 / len1;
        ny = dx1 / len1;
      } else {
        var dxA = points[i][0] - points[i - 1][0];
        var dyA = points[i][1] - points[i - 1][1];
        var lenA = Math.hypot(dxA, dyA) || 1;
        var dxB = points[i + 1][0] - points[i][0];
        var dyB = points[i + 1][1] - points[i][1];
        var lenB = Math.hypot(dxB, dyB) || 1;
        nx = (-dyA / lenA + -dyB / lenB) * 0.5;
        ny = (dxA / lenA + dxB / lenB) * 0.5;
        var nLen = Math.hypot(nx, ny) || 1;
        nx /= nLen;
        ny /= nLen;
      }
      out.push([
        roundMapCoord(points[i][0] + nx * offsetPx),
        roundMapCoord(points[i][1] + ny * offsetPx),
      ]);
    }
    return out;
  }

  function polylineLineStringCenter(points) {
    if (!points || points.length < 2) return null;
    var totalLen = 0;
    for (var i = 0; i < points.length - 1; i++) {
      totalLen += Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]);
    }
    if (totalLen < 1e-6) {
      return { x: points[0][0], y: points[0][1], nx: 0, ny: 1 };
    }
    var half = totalLen / 2;
    var walked = 0;
    for (var j = 0; j < points.length - 1; j++) {
      var x1 = points[j][0];
      var y1 = points[j][1];
      var x2 = points[j + 1][0];
      var y2 = points[j + 1][1];
      var seg = Math.hypot(x2 - x1, y2 - y1);
      if (walked + seg >= half) {
        var t = seg < 1e-6 ? 0 : (half - walked) / seg;
        return {
          x: x1 + t * (x2 - x1),
          y: y1 + t * (y2 - y1),
          nx: seg < 1e-6 ? 0 : -(y2 - y1) / seg,
          ny: seg < 1e-6 ? 1 : (x2 - x1) / seg,
        };
      }
      walked += seg;
    }
    var last = points[points.length - 1];
    return { x: last[0], y: last[1], nx: 0, ny: 1 };
  }

  function getTrenchDynamicStrokeWidth(trenchId) {
    var trench = findPathByRef({ type: 'excavation', id: trenchId });
    var widthTrenchId = (trench && trench.loopParentTrenchId) ? trench.loopParentTrenchId : trenchId;
    var cables = getCablesOnTrench(widthTrenchId) || [];
    var DE = global.FTTHDrawingEngine;
    if (DE?.calculateRequiredTrenchWidth) {
      return DE.calculateRequiredTrenchWidth(cables.length, 1);
    }
    var cableCount = cables.length;
    if (cableCount <= 0) return TRENCH_CEMENT_BASE_WIDTH;
    return TRENCH_CEMENT_BASE_WIDTH + cableCount * TRENCH_CEMENT_WIDTH_PER_EXTRA_CABLE;
  }

  function getChildClosureSegments(parentTrenchId) {
    if (!parentTrenchId) return [];
    return (Sim.excavationPaths || []).filter(function (p) {
      return p && p.loopParentTrenchId === parentTrenchId;
    });
  }

  function unregisterCableFromTrench(trenchId, cableId) {
    var trench = findPathByRef({ type: 'excavation', id: trenchId });
    if (!trench || !trench.cableIds) return;
    trench.cableIds = trench.cableIds.filter(function (id) { return id !== cableId; });
  }

  function deleteExcavationWithContents(trenchId) {
    if (!trenchId) return;
    getCablesOnTrench(trenchId).forEach(function (cable) {
      if (!cable) return;
      purgePathVisuals('fiber', cable.id);
      unregisterCableFromTrench(trenchId, cable.id);
    });
    Sim.fiberCablePaths = (Sim.fiberCablePaths || []).filter(function (c) {
      if (!c) return false;
      return c.trenchPathId !== trenchId &&
        c.hostTrenchId !== trenchId &&
        (c.trenchPathIds || []).indexOf(trenchId) < 0;
    });
    getChildClosureSegments(trenchId).forEach(function (child) {
      purgePathVisuals('excavation', child.id);
    });
    Sim.excavationPaths = (Sim.excavationPaths || []).filter(function (p) {
      if (!p) return false;
      return p.id !== trenchId && p.loopParentTrenchId !== trenchId;
    });
  }

  function extractClosureNumber(node) {
    if (!node) return '';
    if (node.closureName) {
      var paired = String(node.closureName).match(/C(\d+)/i);
      if (paired) return String(parseInt(paired[1], 10));
    }
    if (node.hasClosure && node.closureCount != null) {
      return String(parseInt(node.closureCount, 10) || 0);
    }
    return '';
  }

  /**
   * Single canvas/sidebar identity for a map component.
   * Handhole: H5 | Handhole+Closure: H5 C3 | FAT HH: FH5 | FAT pole: FAT5 only.
   */
  function resolveComponentMapLabel(node) {
    if (!node) return '';
    if (node.type === 'handhole') {
      var hName = node.autoName ? String(node.autoName) : '';
      if (!hName) return '';
      if (node.hasClosure) {
        var cNum = extractClosureNumber(node);
        return cNum ? (hName + ' C' + cNum) : hName;
      }
      return hName;
    }
    if (node.type === 'fat_handhole') {
      if (node.hasFatPole && node.fatSystemName) return String(node.fatSystemName);
      var fhName = node.autoName ? String(node.autoName) : '';
      if (!fhName) return '';
      if (node.hasClosure) {
        var fhC = extractClosureNumber(node);
        return fhC ? (fhName + ' C' + fhC) : fhName;
      }
      return fhName;
    }
    if (node.type === 'pole_foundation') {
      return String(node.poleName || node.autoName || '');
    }
    if (node.type === 'fdt') return getFdtCabinetCode(node);
    if (node.type === 'olt') return 'OLT';
    return node.autoName ? String(node.autoName) : '';
  }

  function formatHandholeShortLabel(node) {
    if (!node) return '—';
    return resolveComponentMapLabel(node) || '—';
  }

  function formatClosureShortLabel(node) {
    if (!node) return '';
    var n = extractClosureNumber(node);
    return n ? ('C' + n) : '';
  }

  function getHandholePropertyLabel(node) {
    return formatHandholeShortLabel(node);
  }

  function getClosurePropertyLabel(node) {
    return formatClosureShortLabel(node);
  }

  function getHandholeSidebarTitle(node) {
    if (node && node.type === 'pole_foundation') {
      return resolveComponentMapLabel(node) || 'Pole';
    }
    return resolveComponentMapLabel(node) || '—';
  }

  function estimateCableLabelBoxPx(label) {
    var fontSize = Math.max(9, (Sim.settings?.labelFontSize || 11) - 2);
    return {
      width: Math.max(38, String(label || '').length * fontSize * 0.68 + 12),
      height: Math.max(14, fontSize + 5),
    };
  }

  function cableLabelBoxesOverlap(a, b) {
    return Math.abs(a.x - b.x) < ((a.width + b.width) / 2) &&
      Math.abs(a.y - b.y) < ((a.height + b.height) / 2);
  }

  function assignCableLabelCollisionOffsets(layouts) {
    var zoom = Math.max(getMapCoordZoom(), 0.1);
    var rowStepPx = 15;
    var placed = [];
    var ordered = (layouts || []).slice().sort(function (a, b) {
      if (Math.abs(a.y - b.y) > 0.1) return a.y - b.y;
      if (Math.abs(a.x - b.x) > 0.1) return a.x - b.x;
      return String(a.cable?.id || '').localeCompare(String(b.cable?.id || ''));
    });
    var rowOrder = [0];
    for (var r = 1; r <= 12; r++) {
      rowOrder.push(-r, r);
    }

    ordered.forEach(function (entry) {
      var size = estimateCableLabelBoxPx(entry.label);
      var baseX = (entry.x * zoom) + (Sim.panX || 0);
      var baseY = (entry.y * zoom) + (Sim.panY || 0);
      var chosenRow = 0;
      for (var i = 0; i < rowOrder.length; i++) {
        var row = rowOrder[i];
        var candidate = {
          x: baseX,
          y: baseY + (row * rowStepPx),
          width: size.width,
          height: size.height,
        };
        var collides = placed.some(function (box) { return cableLabelBoxesOverlap(candidate, box); });
        if (!collides) {
          chosenRow = row;
          placed.push(candidate);
          break;
        }
      }
      entry.stackIndex = 0;
      entry.stackTotal = 1;
      entry.labelOffsetPx = chosenRow * rowStepPx;
    });
    return layouts;
  }

  function endpointLabelKey(x, y) {
    return Math.round(Number(x) || 0) + ',' + Math.round(Number(y) || 0);
  }

  function normalizeEndpointNormal(dx, dy) {
    var len = Math.hypot(dx, dy) || 1;
    return { nx: dx / len, ny: dy / len };
  }

  function getCableLabelLayoutForRender() {
    var layouts = [];
    var endpointBuckets = {};
    var ENDPOINT_STACK_STEP = 14;

    function pushEndpointLayout(cable, x, y, anchor, nx, ny, trenchId) {
      var key = endpointLabelKey(x, y);
      if (!endpointBuckets[key]) endpointBuckets[key] = [];
      var entry = {
        cable: cable,
        x: x,
        y: y,
        anchor: anchor,
        normalX: nx,
        normalY: ny,
        endpointKey: key,
        label: getCableDisplayBatchLabel(cable),
        trenchId: trenchId,
      };
      endpointBuckets[key].push(entry);
      layouts.push(entry);
    }

    (Sim.fiberCablePaths || []).forEach(function (cable) {
      if (!cable) return;
      var geom = getCableRenderGeometry(cable);
      var pts = geom?.points || cable.points;
      if (!pts || pts.length < 2) return;
      var trenchId = geom?.trenchId || cable.hostTrenchId || cable.trenchPathId || null;

      var startNorm = normalizeEndpointNormal(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
      pushEndpointLayout(
        cable, pts[0][0], pts[0][1], 'start',
        -startNorm.ny, startNorm.nx, trenchId
      );

      var last = pts.length - 1;
      var endNorm = normalizeEndpointNormal(
        pts[last][0] - pts[last - 1][0],
        pts[last][1] - pts[last - 1][1]
      );
      pushEndpointLayout(
        cable, pts[last][0], pts[last][1], 'end',
        endNorm.ny, -endNorm.nx, trenchId
      );
    });

    Object.keys(endpointBuckets).forEach(function (key) {
      var bucket = endpointBuckets[key].slice().sort(function (a, b) {
        return String(a.cable?.id || '').localeCompare(String(b.cable?.id || ''));
      });
      bucket.forEach(function (entry, idx) {
        var centered = idx - ((bucket.length - 1) / 2);
        entry.stackIndex = idx;
        entry.stackTotal = bucket.length;
        entry.labelOffsetPx = centered * ENDPOINT_STACK_STEP;
        entry.labelOffsetCrossPx = centered * ENDPOINT_STACK_STEP;
      });
    });

    return layouts;
  }

  function buildCableUnifiedCenterline(points) {
    if (!points || points.length < 2) return clonePathPointArray(points || []);
    var chained = [];
    for (var pi = 0; pi < points.length - 1; pi++) {
      var seg = buildCablePreviewAlongExcavation(points[pi], points[pi + 1]);
      if (!seg.length) {
        seg = [[points[pi][0], points[pi][1]], [points[pi + 1][0], points[pi + 1][1]]];
      }
      if (!chained.length) appendTrenchSubpaths(chained, seg);
      else appendTrenchSubpaths(chained, seg.slice(1));
    }
    return chained.length >= 2 ? dedupeConsecutiveCablePoints(chained) : clonePathPointArray(points);
  }

  function collectTrenchIdsFromCablePoints(points) {
    var seen = {};
    var ordered = [];
    (points || []).forEach(function (pt) {
      if (!pt) return;
      var proj = projectPointOnAnyExcavation(pt[0], pt[1], SNAP_THRESHOLD * 1.5);
      if (proj?.trenchId && !seen[proj.trenchId]) {
        seen[proj.trenchId] = true;
        ordered.push(proj.trenchId);
      }
    });
    return ordered;
  }

  function buildCableCenterlineOnTrench(cable, trench) {
    if (!cable?.points || cable.points.length < 2) return [];
    var trenchIds = collectTrenchIdsFromCablePoints(cable.points);
    if (trenchIds.length > 1) return buildCableUnifiedCenterline(cable.points);
    if (!trench?.points || trench.points.length < 2) {
      return buildCableUnifiedCenterline(cable.points);
    }
    var chained = [];
    for (var pi = 0; pi < cable.points.length - 1; pi++) {
      var a = projectPointOntoTrenchWithDistance(
        cable.points[pi][0], cable.points[pi][1], trench
      );
      var b = projectPointOntoTrenchWithDistance(
        cable.points[pi + 1][0], cable.points[pi + 1][1], trench
      );
      if (!a || !b) continue;
      var segPts = extractTrenchSubpathBetweenDistances(trench, a.along, b.along);
      if (!segPts.length) continue;
      if (!chained.length) {
        appendTrenchSubpaths(chained, segPts);
      } else {
        appendTrenchSubpaths(chained, segPts.slice(1));
      }
    }
    if (chained.length >= 2) return dedupeConsecutiveCablePoints(chained);
    var fallbackA = projectPointOntoTrenchWithDistance(
      cable.points[0][0], cable.points[0][1], trench
    );
    var fallbackB = projectPointOntoTrenchWithDistance(
      cable.points[cable.points.length - 1][0],
      cable.points[cable.points.length - 1][1],
      trench
    );
    if (fallbackA && fallbackB) {
      return extractTrenchSubpathBetweenDistances(trench, fallbackA.along, fallbackB.along);
    }
    return clonePathPointArray(cable.points);
  }

  function resolveCableHostTrench(cable) {
    if (!cable) return null;
    if (cable.hostTrenchId || cable.trenchPathId) {
      return findPathByRef({
        type: 'excavation',
        id: cable.hostTrenchId || cable.trenchPathId,
      });
    }
    return resolveTrenchForCable(cable);
  }

  function isUnifiedTrenchMapHighlighted(trenchId) {
    if (!trenchId) return false;
    /* Isolated excavation selection wins over handhole topology fan-out. */
    if (Sim.selectedPath?.type === 'excavation') {
      return Sim.selectedPath.id === trenchId;
    }
    if (Sim.topologyHighlight?.paths?.length) {
      for (var i = 0; i < Sim.topologyHighlight.paths.length; i++) {
        var ref = Sim.topologyHighlight.paths[i];
        if (ref.type === 'excavation' && ref.id === trenchId) return true;
      }
    }
    return false;
  }

  function getCableRenderGeometry(cable) {
    var DE = global.FTTHDrawingEngine;
    if (DE?.buildTrenchAdaptiveCableGeometry) {
      return DE.buildTrenchAdaptiveCableGeometry(cable);
    }
    if (!cable) return { points: [], hitPoints: [], cornerRadii: {} };
    var lane = getCableLaneInfo(cable);
    var base;
    if (cable.userDrawn || (cable.trenchPathIds && cable.trenchPathIds.length > 1)) {
      base = clonePathPointArray(cable.points || []);
    } else {
      var trench = resolveCableHostTrench(cable);
      if (trench?.points?.length >= 2) {
        base = clonePathPointArray(trench.points);
      } else {
        base = clonePathPointArray(cable.points || []);
      }
    }
    var points = base;
    if (lane.offsetPx) points = offsetPolylineLateral(base, lane.offsetPx);
    points = roundPathPoints(points);
    return {
      points: points,
      hitPoints: points,
      cornerRadii: {},
      laneIndex: lane.laneIndex,
      laneTotal: lane.laneTotal,
      laneOffsetPx: lane.offsetPx,
      trenchId: lane.trenchId,
    };
  }

  function isPathEndpointFree(path, vertexIndex) {
    if (!path || !path.points || path.points.length < 2) return false;
    if (path.freeEnds) {
      return vertexIndex === 0 ? !!path.freeEnds.start : !!path.freeEnds.end;
    }
    var ct = path.connectedTo || {};
    return vertexIndex === 0 ? !ct.start : !ct.end;
  }

  function findNearbyExcavationEndpoint(x, y, excludePathId) {
    var best = null;
    var bestDistSq = SNAP_THRESHOLD_SQ + 1;
    (Sim.excavationPaths || []).forEach(function (path) {
      if (!path.points || path.points.length < 2 || path.id === excludePathId) return;
      [0, path.points.length - 1].forEach(function (vi) {
        var pt = path.points[vi];
        if (!pt) return;
        var d2 = global.FTTHDrawingEngine?.screenDistSqBetweenCanvasPoints?.(x, y, pt[0], pt[1]);
        if (d2 == null) d2 = (x - pt[0]) * (x - pt[0]) + (y - pt[1]) * (y - pt[1]);
        if (d2 <= SNAP_THRESHOLD_SQ && d2 < bestDistSq) {
          bestDistSq = d2;
          best = { type: 'excavation', id: path.id, vertexIndex: vi };
        }
      });
    });
    return best;
  }

  function snapExcavationEndpointsToNodes(path) {
    if (!path?.points?.length) return false;
    var changed = false;
    var ends = [0, path.points.length - 1];
    for (var i = 0; i < ends.length; i++) {
      var vi = ends[i];
      if (!isPathEndpointFree(path, vi)) continue;
      var pt = path.points[vi];
      if (!pt) continue;
      var bestNode = null;
      var bestDistSq = SNAP_THRESHOLD_SQ + 1;
      (Sim.nodes || []).forEach(function (node) {
        if (!node || (node.type !== 'handhole' && node.type !== 'fat_handhole' &&
            node.type !== 'pole_foundation' && node.type !== 'fdt')) return;
        var center = global.FTTHDrawingEngine?.getDeviceSnapCenter?.(node) || getNodeCenterXY(node);
        if (!center) return;
        var d2 = global.FTTHDrawingEngine?.screenDistSqBetweenCanvasPoints?.(pt[0], pt[1], center.x, center.y);
        if (d2 == null) d2 = (pt[0] - center.x) * (pt[0] - center.x) + (pt[1] - center.y) * (pt[1] - center.y);
        if (d2 <= SNAP_THRESHOLD_SQ && d2 < bestDistSq) {
          bestDistSq = d2;
          bestNode = { node: node, center: center };
        }
      });
      if (!bestNode) continue;
      path.points[vi] = [
        Math.round(bestNode.center.x * 10) / 10,
        Math.round(bestNode.center.y * 10) / 10,
      ];
      if (!path.connectedTo) path.connectedTo = { start: null, end: null };
      var label = getNodeSnapLabel(bestNode.node);
      if (vi === 0) path.connectedTo.start = label;
      else path.connectedTo.end = label;
      if (!path.freeEnds) path.freeEnds = { start: false, end: false };
      if (vi === 0) path.freeEnds.start = false;
      else path.freeEnds.end = false;
      changed = true;
    }
    return changed;
  }

  function tryAutoMergePathGaps(pathType, pathId) {
    if (pathType !== 'excavation' || !pathId) return pathId;
    var seedPath = findPathByRef({ type: 'excavation', id: pathId });
    if (seedPath?.independentClosureSegment || seedPath?.noAutoMerge) return pathId;
    var editor = global.FTTHPathwayEditor;
    if (!editor?.mergePathsAtEndpoints) return pathId;
    var currentId = pathId;
    var maxPasses = 6;

    for (var pass = 0; pass < maxPasses; pass++) {
      var path = findPathByRef({ type: 'excavation', id: currentId });
      if (!path?.points || path.points.length < 2) break;
      var merged = false;

      if (snapExcavationEndpointsToNodes(path)) merged = true;

      var endIndexes = [0, path.points.length - 1];
      for (var e = 0; e < endIndexes.length; e++) {
        var vi = endIndexes[e];
        if (!isPathEndpointFree(path, vi)) continue;
        var pt = path.points[vi];
        if (!pt) continue;
        var near = findNearbyExcavationEndpoint(pt[0], pt[1], path.id);
        if (!near) continue;
        var nearPath = findPathByRef({ type: 'excavation', id: near.id });
        if (nearPath?.independentClosureSegment || nearPath?.noAutoMerge) continue;
        if (path.independentClosureSegment && nearPath?.loopParentTrenchId === path.loopParentTrenchId) continue;
        if (path.loopParentTrenchId && (near.id === path.loopParentTrenchId || nearPath?.loopParentTrenchId === path.id)) continue;
        var ok = editor.mergePathsAtEndpoints(
          { type: 'excavation', id: path.id, vertexIndex: vi },
          { type: near.type, id: near.id, vertexIndex: near.vertexIndex },
          { silent: true }
        );
        if (ok) {
          currentId = path.id;
          merged = true;
          break;
        }
      }
      if (!merged) break;
    }

    syncCablesOnTrench(currentId);
    return currentId;
  }

  function registerCableOnTrench(trenchId, cableId) {
    var trench = (Sim.excavationPaths || []).filter(function (p) { return p.id === trenchId; })[0];
    if (!trench) return;
    if (!trench.cableIds) trench.cableIds = [];
    if (trench.cableIds.indexOf(cableId) < 0) trench.cableIds.push(cableId);
  }

  function getCablesOnTrench(trenchId) {
    var cables = (Sim.fiberCablePaths || []).filter(function (c) {
      return c.trenchPathId === trenchId ||
        (c.hostTrenchId && c.hostTrenchId === trenchId) ||
        ((c.trenchPathIds || []).indexOf(trenchId) >= 0);
    });
    if (cables.length) return cables;
    var trench = (Sim.excavationPaths || []).filter(function (p) { return p.id === trenchId; })[0];
    if (!trench || !trench.cableIds || !trench.cableIds.length) return [];
    return trench.cableIds.map(function (cid) {
      for (var i = 0; i < (Sim.fiberCablePaths || []).length; i++) {
        if (Sim.fiberCablePaths[i].id === cid) return Sim.fiberCablePaths[i];
      }
      return null;
    }).filter(function (c) { return !!c; });
  }

  function distancePointToTrenchPolyline(x, y, trench) {
    var pts = trench?.points;
    if (!pts || pts.length < 2 || x == null || y == null) return Infinity;
    var best = Infinity;
    for (var i = 0; i < pts.length - 1; i++) {
      var d = distancePointToSegment(x, y, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
      if (d < best) best = d;
    }
    return best;
  }

  /** Geometric membership: cable samples must lie on this trench polyline. */
  function cableIsPhysicallyInsideTrench(cable, trench) {
    if (!cable || !trench?.points || trench.points.length < 2) return false;
    var pts = cable.points || [];
    if (pts.length < 2) return false;

    var tol = Math.max(12, (Sim.layout?.cellSize || 50) * 0.28);
    var onCount = 0;
    var samples = 0;

    function consider(x, y) {
      if (x == null || y == null) return;
      samples++;
      if (distancePointToTrenchPolyline(x, y, trench) <= tol) onCount++;
    }

    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (!p) continue;
      consider(p[0], p[1]);
      if (i < pts.length - 1 && pts[i + 1]) {
        consider((p[0] + pts[i + 1][0]) / 2, (p[1] + pts[i + 1][1]) / 2);
      }
    }
    if (samples < 2 || onCount < 2) return false;

    var multi = !!(cable.userDrawn || ((cable.trenchPathIds || []).length > 1));
    if (multi) {
      /* Multi-trench cable: require real occupancy on this trench, not a shared endpoint. */
      return onCount >= 2 && (onCount / samples >= 0.25 || onCount >= 3);
    }
    return onCount / samples >= 0.55;
  }

  /**
   * Evaluation-only: cables that truly belong inside this trench.
   * Rejects stray cables hosted on other excavations that only appear via stale
   * cableIds / junction trenchPathIds listings.
   *
   * @param {string} trenchId
   * @param {string|null|undefined} scopeCabinetId
   *   - undefined: default to Active FDT (toolbox draw domain)
   *   - null: no cabinet filter (free trench inspection — show all in-trench cables)
   *   - string: filter to that cabinet only
   */
  function getCablesStrictlyOnTrench(trenchId, scopeCabinetId) {
    if (!trenchId) return [];
    var trench = findPathByRef({ type: 'excavation', id: trenchId });
    if (!trench) return [];

    var seen = {};
    var candidates = [];

    function addCandidate(cable) {
      if (!cable || !cable.id || seen[cable.id]) return;
      seen[cable.id] = true;
      candidates.push(cable);
    }

    (Sim.fiberCablePaths || []).forEach(function (cable) {
      if (!cable) return;
      if (cable.hostTrenchId === trenchId || cable.trenchPathId === trenchId) {
        addCandidate(cable);
        return;
      }
      if ((cable.trenchPathIds || []).indexOf(trenchId) >= 0) addCandidate(cable);
    });
    (trench.cableIds || []).forEach(function (cid) {
      addCandidate(findPathByRef({ type: 'fiber', id: cid }));
    });

    var cabId = scopeCabinetId !== undefined ? scopeCabinetId : getActiveFdtId();
    return candidates.filter(function (cable) {
      var primary = cable.hostTrenchId || cable.trenchPathId || null;
      var inPathIds = (cable.trenchPathIds || []).indexOf(trenchId) >= 0;
      var multi = !!(cable.userDrawn || ((cable.trenchPathIds || []).length > 1));

      /* Never show a cable whose primary host is a different trench. */
      if (primary && primary !== trenchId) {
        if (!(multi && inPathIds)) return false;
      }

      if (!cableIsPhysicallyInsideTrench(cable, trench)) return false;

      if (!primary) {
        var resolved = resolveTrenchForCable(cable);
        if (resolved && resolved.id !== trenchId && !multi) return false;
      }

      if (cabId && !cableBelongsToCabinet(cable, cabId)) return false;
      return true;
    });
  }

  /** Free Evaluation inspection: every cable physically inside the trench, any cabinet. */
  function getCablesOnTrenchForInspection(trenchId) {
    return getCablesStrictlyOnTrench(trenchId, null);
  }

  function pathLengthMeters(path) {
    var cs = Sim.layout?.cellSize || 50;
    var editor = global.FTTHPathwayEditor;
    var px = editor?.getPathLength?.(path, cs) || 0;
    return (px / cs) * 10;
  }

  function distancePointToSegment(px, py, ax, ay, bx, by) {
    var dx = bx - ax;
    var dy = by - ay;
    var lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-6) return Math.hypot(px - ax, py - ay);
    var t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  function isPointOnExcavationTrench(x, y, tolerance) {
    if (x == null || y == null) return false;
    var de = global.FTTHDrawingEngine;
    if (de?.canvasXYToScreenXY) {
      var sp = de.canvasXYToScreenXY(x, y);
      if (findExcavationTrenchSnapPoint(sp.x, sp.y, x, y)) return true;
    }
    tolerance = tolerance == null ? SNAP_THRESHOLD : tolerance;
    var editor = global.FTTHPathwayEditor;
    var trenches = Sim.excavationPaths || [];
    if (!trenches.length) return false;
    for (var i = 0; i < trenches.length; i++) {
      var pts = trenches[i].points;
      if (pts && pts.length >= 2) {
        for (var j = 0; j < pts.length - 1; j++) {
          if (distancePointToSegment(x, y, pts[j][0], pts[j][1], pts[j + 1][0], pts[j + 1][1]) <= tolerance) {
            return true;
          }
        }
      }
      var connectors = trenches[i].connectorSegments || [];
      for (var c = 0; c < connectors.length; c++) {
        var connPts = editor?.buildConnectorRenderPoints?.(trenches[i], connectors[c]) || [];
        for (var k = 0; k < connPts.length - 1; k++) {
          if (distancePointToSegment(x, y, connPts[k][0], connPts[k][1], connPts[k + 1][0], connPts[k + 1][1]) <= tolerance) {
            return true;
          }
        }
      }
    }
    return false;
  }

  function canStartCableDrawing(resolved) {
    if (!resolved) return false;
    if (!resolved.snapped) return false;
    if (resolved.snapKind === 'handhole' || resolved.snapKind === 'device') return true;
    if (resolved.snapTarget?.kind === 'handhole' || resolved.snapTarget?.nodeId) return true;
    if (resolved.snapTarget?.kind === 'trench-segment' || resolved.snapTarget?.kind === 'trench-vertex') return true;
    return isPointOnExcavationTrench(resolved.x, resolved.y);
  }

  function canPlaceCablePoint(resolved) {
    return canStartCableDrawing(resolved);
  }

  function validateCablePointsOnTrench(points, pointSnapNodeIds, trenchPathId) {
    if (!points || points.length < 2) return false;
    if (!(Sim.excavationPaths || []).length) return false;
    var snapIds = pointSnapNodeIds || [];
    for (var i = 0; i < points.length; i++) {
      if (snapIds[i]) continue;
      if (!isPointOnExcavationTrench(points[i][0], points[i][1])) return false;
    }
    return true;
  }

  function findNodeBySnapLabel(label) {
    if (!label) return null;
    var want = String(label);
    for (var i = 0; i < Sim.nodes.length; i++) {
      var node = Sim.nodes[i];
      if (!node) continue;
      if (getNodeSnapLabel(node) === want) return node;
      if (node.autoName && String(node.autoName) === want) return node;
      if (node.poleName && String(node.poleName) === want) return node;
      if (node.fatSystemName && String(node.fatSystemName) === want) return node;
      /* Closure names identify the host handhole, not a separate node. */
      if (node.closureName && String(node.closureName) === want) return node;
    }
    return null;
  }

  function getFdtCabinetCode(node) {
    if (!node) return '—';
    var raw = node.autoName || node.code || '';
    if (!raw && node.type === 'fdt') return 'FDT';
    return String(raw).replace(/^FDY/i, 'FDT');
  }

  function getNodeAsBuiltCode(node) {
    if (!node) return '—';
    if (node.type === 'handhole') return node.autoName || 'HH';
    if (node.type === 'fat_handhole') return node.autoName || node.fatSystemName || 'FH';
    if (node.type === 'pole_foundation') return node.poleName || node.autoName || 'P';
    if (node.type === 'fdt') return getFdtCabinetCode(node);
    if (node.autoName) return node.autoName;
    return node.type.toUpperCase();
  }

  function nodePickPriority(node) {
    if (!node) return 0;
    if (node.type === 'handhole' || node.type === 'fat_handhole') return 100;
    if (node.type === 'pole_foundation') return 90;
    if (node.type === 'fdt') return 70;
    if (node.type === 'olt') return 65;
    return 10;
  }

  function nodeHitRadius(node) {
    var cs = (Sim.layout && Sim.layout.cellSize) || 22;
    if (!node) return cs * 0.35;
    if (node.type === 'handhole' || node.type === 'fat_handhole') return cs * 0.52;
    if (node.type === 'fdt') return cs * 0.5;
    if (node.type === 'pole_foundation') return cs * 0.48;
    if (node.type === 'olt') return cs * 0.45;
    return cs * 0.4;
  }

  function pickNodeIdByGeometry(clientX, clientY) {
    var xy = pointerToWorkspaceXY(clientX, clientY);
    if (!xy) return null;
    var bestId = null;
    var bestRank = -1;
    var bestDist = Infinity;
    Sim.nodes.forEach(function (node) {
      if (node.type === 'pole') return;
      var center = global.FTTHDrawingEngine?.getDeviceSnapCenter?.(node) || getNodeCenterXY(node);
      if (!center) return;
      var dist = Math.hypot(xy.x - center.x, xy.y - center.y);
      if (dist > nodeHitRadius(node)) return;
      var rank = nodePickPriority(node);
      if (dist < bestDist - 0.5 || (Math.abs(dist - bestDist) <= 0.5 && rank > bestRank)) {
        bestRank = rank;
        bestDist = dist;
        bestId = node.id;
      }
    });
    return bestId;
  }

  function resolveMapPick(clientX, clientY) {
    var xy = pointerToWorkspaceXY(clientX, clientY);
    var editor = global.FTTHPathwayEditor;
    var pathHit = null;
    if (xy && editor?.pickPathHitAtPoint) {
      pathHit = editor.pickPathHitAtPoint(xy.x, xy.y, editor.PATH_HIT_TOLERANCE || 12);
    } else if (xy && editor?.hitTestPaths) {
      pathHit = editor.hitTestPaths(xy.x, xy.y, editor.PATH_HIT_TOLERANCE || 12);
    }
    var nodeId = pickPlacedNodeUnderPointer(clientX, clientY);
    if (nodeId && pathHit && xy) {
      var node = findNode(nodeId);
      var center = node && (global.FTTHDrawingEngine?.getDeviceSnapCenter?.(node) || getNodeCenterXY(node));
      if (center) {
        var nodeDist = Math.hypot(xy.x - center.x, xy.y - center.y);
        var pathDist = pathHit.dist != null ? pathHit.dist : Infinity;
        if (pathDist < nodeDist && pathDist <= (editor.PATH_HIT_TOLERANCE || 12)) {
          return { kind: 'path', type: pathHit.type, id: pathHit.id, segIndex: pathHit.segIndex };
        }
      }
      return { kind: 'node', id: nodeId };
    }
    if (nodeId) return { kind: 'node', id: nodeId };
    if (pathHit) {
      return { kind: 'path', type: pathHit.type, id: pathHit.id, segIndex: pathHit.segIndex };
    }
    return null;
  }

  function applyMapPick(pick, e) {
    if (isCablePenDrawActive() || canPenDraw()) return false;
    if (!pick) return false;
    if (pick.kind === 'node') {
      onPlacedNodeClick(pick.id, e);
      return true;
    }
    if (pick.kind === 'path') {
      var segmentToolsActive = getActiveCanvasTool() === 'vertex' || getActiveCanvasTool() === 'cut' ||
        !!Sim.pathEdit?.vertexToolActive || !!Sim.pathEdit?.splitToolActive;
      var pathType = pick.type;
      var pathId = pick.id;
      /* Select/Hand map picks on a cable over a trench resolve to the host excavation
         so Evaluation isolates that trench + its exact in-trench cables. */
      if (!segmentToolsActive && pathType === 'fiber') {
        var cable = findPathByRef({ type: 'fiber', id: pathId });
        var host = cable ? resolveTrenchForCable(cable) : null;
        if (host?.id) {
          pathType = 'excavation';
          pathId = host.id;
        }
      }
      selectPath(pathType, pathId, false, {
        segIndex: segmentToolsActive && pick.segIndex != null ? pick.segIndex : null,
        fromSidebar: false,
      });
      return true;
    }
    return false;
  }

  function isMapSelectableNodeType(node) {
    if (!node) return false;
    return node.type === 'handhole' || node.type === 'fat_handhole' || node.type === 'pole_foundation';
  }

  function trySelectMapNodeAtPointer(e) {
    if (!e || (e.button != null && e.button !== 0)) return false;
    if (canPenDraw() || isCablePenDrawActive()) return false;
    if (Sim.pathEdit?.isDraggingVertex || Sim.pathEdit?.drag) return false;
    if (Sim.moveNodeId) return false;
    var mode = getCurrentMode();
    if (mode === WORKSPACE_MODES.CUT || mode === WORKSPACE_MODES.VERTEX || mode === WORKSPACE_MODES.MEASURE) return false;

    var clientX = e.clientX;
    var clientY = e.clientY;
    if (clientX == null || clientY == null) return false;

    var nodeId = pickPlacedNodeUnderPointer(clientX, clientY);
    if (!nodeId) {
      var pick = resolveMapPick(clientX, clientY);
      if (pick && pick.kind === 'node') nodeId = pick.id;
    }
    if (!nodeId) return false;

    var node = findNode(nodeId);
    if (!isMapSelectableNodeType(node)) return false;

    onPlacedNodeClick(nodeId, e);
    return true;
  }

  function getNodesAtCell(col, row) {
    return Sim.nodes.filter(function (n) {
      return n.col === col && n.row === row;
    });
  }

  function pickBestNodeIdFromCandidates(ids, clientX, clientY) {
    var xy = (clientX != null && clientY != null) ? pointerToWorkspaceXY(clientX, clientY) : null;
    var bestId = null;
    var bestDist = Infinity;
    var bestRank = -1;
    ids.forEach(function (id) {
      var node = findNode(id);
      if (!node) return;
      var rank = nodePickPriority(node);
      var dist = Infinity;
      if (xy) {
        var center = global.FTTHDrawingEngine?.getDeviceSnapCenter?.(node) || getNodeCenterXY(node);
        if (center) dist = Math.hypot(xy.x - center.x, xy.y - center.y);
      }
      /* Nearest asset wins so a pole/handhole is not overridden by a neighbor with a closure. */
      if (dist < bestDist - 0.5 || (Math.abs(dist - bestDist) <= 0.5 && rank > bestRank)) {
        bestDist = dist;
        bestRank = rank;
        bestId = id;
      }
    });
    return bestId;
  }

  function pickPlacedNodeUnderPointer(clientX, clientY) {
    var ids = [];
    var svg = getGlobalDrawingLayer();
    var labels = document.getElementById('global-map-labels-layer');
    var prevSvgPe = svg ? svg.style.pointerEvents : '';
    var prevLblPe = labels ? labels.style.pointerEvents : '';
    if (svg) svg.style.pointerEvents = 'none';
    if (labels) labels.style.pointerEvents = 'none';

    var stack = document.elementsFromPoint(clientX, clientY) || [];
    stack.forEach(function (el) {
      var nodeEl = el.closest && el.closest('.placed-node');
      if (nodeEl && nodeEl.dataset.id && ids.indexOf(nodeEl.dataset.id) < 0) {
        ids.push(nodeEl.dataset.id);
      }
    });

    if (svg) svg.style.pointerEvents = prevSvgPe;
    if (labels) labels.style.pointerEvents = prevLblPe;

    var cellPt = pointerToGridCell(clientX, clientY);
    if (cellPt) {
      getNodesAtCell(cellPt.col, cellPt.row).forEach(function (node) {
        if (ids.indexOf(node.id) < 0) ids.push(node.id);
      });
    }

    var geoId = pickNodeIdByGeometry(clientX, clientY);
    if (geoId && ids.indexOf(geoId) < 0) ids.push(geoId);

    if (!ids.length) return null;
    return pickBestNodeIdFromCandidates(ids, clientX, clientY);
  }

  function cablePassesThroughNode(cable, node) {
    if (!cable || !node) return false;
    var nodeId = node.id;
    // Strict topological: snap-node IDs recorded on cable vertices
    var snapIds = cable.pointSnapNodeIds || [];
    for (var si = 0; si < snapIds.length; si++) {
      if (snapIds[si] && snapIds[si] === nodeId) return true;
    }
    // Strict topological: connectedTo start/end by node id or snap labels
    var ct = cable.connectedTo || {};
    var labels = [];
    if (nodeId) labels.push(nodeId);
    if (node.label) labels.push(node.label);
    if (node.autoName) labels.push(node.autoName);
    if (node.closureName) labels.push(node.closureName);
    if (node.fatSystemName) labels.push(node.fatSystemName);
    var snapLbl = getNodeSnapLabel(node);
    if (snapLbl) labels.push(snapLbl);
    for (var i = 0; i < labels.length; i++) {
      if (ct.start === labels[i] || ct.end === labels[i]) return true;
    }
    // Precision spatial fallback only (micro-tolerance; not cellSize * 0.55)
    var center = getNodeCenterXY(node);
    if (!center || !cable.points) return false;
    var tol = 2.0;
    for (var j = 0; j < cable.points.length; j++) {
      var pt = cable.points[j];
      if (!pt) continue;
      if (Math.hypot(pt[0] - center.x, pt[1] - center.y) <= tol) return true;
    }
    return false;
  }

  function getCablesThroughNode(node) {
    var cabId = resolveInspectionCabinetId(node);
    return (Sim.fiberCablePaths || []).filter(function (c) {
      if (!cablePassesThroughNode(c, node)) return false;
      if (cabId && !cableBelongsToCabinet(c, cabId)) return false;
      return true;
    });
  }

  function projectPointOnAnyExcavation(x, y, maxDist) {
    maxDist = maxDist == null ? SNAP_THRESHOLD : maxDist;
    var best = null;
    (Sim.excavationPaths || []).forEach(function (trench) {
      if (!trench?.points || trench.points.length < 2) return;
      var proj = projectPointOntoTrenchWithDistance(x, y, trench);
      var d = Math.hypot(x - proj.x, y - proj.y);
      if (d <= maxDist && (!best || d < best.dist)) {
        best = {
          x: proj.x,
          y: proj.y,
          along: proj.along,
          dist: d,
          trench: trench,
          trenchId: trench.id,
        };
      }
    });
    return best;
  }

  function excavationEndpointsNear(aPt, bPt, tol) {
    tol = tol == null ? 6 : tol;
    if (!aPt || !bPt) return false;
    return Math.abs(aPt[0] - bPt[0]) <= tol && Math.abs(aPt[1] - bPt[1]) <= tol;
  }

  function trenchesShareEndpoint(trenchA, trenchB) {
    if (!trenchA?.points?.length || !trenchB?.points?.length) return null;
    var aEnds = [
      { index: 0, pt: trenchA.points[0] },
      { index: trenchA.points.length - 1, pt: trenchA.points[trenchA.points.length - 1] },
    ];
    var bEnds = [
      { index: 0, pt: trenchB.points[0] },
      { index: trenchB.points.length - 1, pt: trenchB.points[trenchB.points.length - 1] },
    ];
    for (var i = 0; i < aEnds.length; i++) {
      for (var j = 0; j < bEnds.length; j++) {
        if (excavationEndpointsNear(aEnds[i].pt, bEnds[j].pt)) {
          return {
            aIndex: aEnds[i].index,
            bIndex: bEnds[j].index,
            aAlong: aEnds[i].index === 0 ? 0 : polylineTotalLength(trenchA.points),
            bAlong: bEnds[j].index === 0 ? 0 : polylineTotalLength(trenchB.points),
          };
        }
      }
    }
    return null;
  }

  function appendTrenchSubpaths(out, part) {
    (part || []).forEach(function (pt) {
      var last = out[out.length - 1];
      if (!last || last[0] !== pt[0] || last[1] !== pt[1]) out.push([pt[0], pt[1]]);
    });
    return out;
  }

  function resolveActiveToolboxCableLabel(kind) {
    kind = kind || Sim.pen?.cableKind;
    if (!kind) return '';
    return formatCableLabel(getCableCapacityForKind(kind), getCableBatchForKind(kind));
  }

  function syncPenDraftCableFromToolbox(draft) {
    if (!draft || draft.lineMode !== 'cable') return draft;
    var kind = Sim.pen?.cableKind || draft.kind;
    if (!kind) return draft;
    draft.kind = kind;
    draft.capacity = getCableCapacityForKind(kind);
    draft.batch = getCableBatchForKind(kind);
    draft.cableName = resolveActiveToolboxCableLabel(kind);
    return draft;
  }

  function buildCablePreviewAlongExcavation(fromPt, toPt) {
    if (!fromPt || !toPt) return [];
    var start = projectPointOnAnyExcavation(fromPt[0], fromPt[1], SNAP_THRESHOLD * 1.5);
    var end = projectPointOnAnyExcavation(toPt[0], toPt[1], SNAP_THRESHOLD * 1.5);
    if (!start || !end) {
      return dedupeConsecutiveCablePoints([[fromPt[0], fromPt[1]], [toPt[0], toPt[1]]]);
    }

    if (start.trenchId === end.trenchId) {
      return extractTrenchSubpathBetweenDistances(start.trench, start.along, end.along);
    }

    var directLink = trenchesShareEndpoint(start.trench, end.trench);
    if (directLink) {
      var linked = [];
      appendTrenchSubpaths(linked, extractTrenchSubpathBetweenDistances(start.trench, start.along, directLink.aAlong));
      appendTrenchSubpaths(linked, extractTrenchSubpathBetweenDistances(end.trench, directLink.bAlong, end.along));
      if (linked.length >= 2) return linked;
    }

    var bestRoute = null;
    var bestCost = Infinity;
    (Sim.excavationPaths || []).forEach(function (midTrench) {
      if (!midTrench?.points || midTrench.points.length < 2) return;
      if (midTrench.id === start.trenchId || midTrench.id === end.trenchId) return;
      var linkA = trenchesShareEndpoint(start.trench, midTrench);
      var linkB = trenchesShareEndpoint(midTrench, end.trench);
      if (!linkA || !linkB) return;
      var route = [];
      appendTrenchSubpaths(route, extractTrenchSubpathBetweenDistances(start.trench, start.along, linkA.aAlong));
      appendTrenchSubpaths(route, extractTrenchSubpathBetweenDistances(midTrench, linkA.bAlong, linkB.aAlong));
      appendTrenchSubpaths(route, extractTrenchSubpathBetweenDistances(end.trench, linkB.bAlong, end.along));
      if (route.length < 2) return;
      var cost = Math.abs(end.along - start.along) + route.length;
      if (cost < bestCost) {
        bestCost = cost;
        bestRoute = route;
      }
    });
    if (bestRoute?.length >= 2) return bestRoute;

    return dedupeConsecutiveCablePoints([[start.x, start.y], [end.x, end.y]]);
  }

  function getCableDisplayBatchLabel(cable) {
    if (!cable) return '';
    if (cable.name) return cable.name;
    return formatCableLabel(
      cable.capacity || getCableCapacityForKind(cable.kind),
      cable.batch || getCableBatchForKind(cable.kind)
    );
  }

  function formatCableAsBuiltId(cable) {
    return getCableDisplayBatchLabel(cable) || '—';
  }

  function getExcavationDisplayNumber(path) {
    if (!path) return '—';
    var idStr = String(path.id || '').trim();
    if (!idStr) return '—';
    var m = idStr.match(/(\d+)$/);
    if (m) return String(parseInt(m[1], 10));
    return idStr;
  }

  function isCablePenModeActive() {
    return !!(Sim.pen && Sim.pen.lineMode === 'cable');
  }

  function nextCableName(capacity, kind, batch) {
    if (kind) return formatCableLabel(capacity || getCableCapacityForKind(kind), batch || getCableBatchForKind(kind));
    return formatCableLabel(capacity, batch || 1);
  }

  function mapShortLabel(node, key) {
    if (!node) return '';
    var full = resolveComponentMapLabel(node);
    if (key === 'unified' && node.type === 'fat_handhole' && node.hasFatPole) return full;
    if (key === 'closure') return formatClosureShortLabel(node);
    if (key === 'primary') return full;
    return full;
  }

  function getNodeAutoLabel(node) {
    return resolveComponentMapLabel(node);
  }

  function getNodeLabelEntries(node) {
    if (!node) return [];
    var text = resolveComponentMapLabel(node);
    if (!text) return [];
    var cls = 'equipment';
    var key = 'primary';
    if (node.type === 'handhole') cls = 'handhole';
    else if (node.type === 'fat_handhole' && node.hasFatPole) {
      cls = 'fat-system';
      key = 'unified';
    } else if (node.type === 'fat_handhole') cls = 'fat-handhole';
    else if (node.type === 'fdt') cls = 'fdt';
    else if (node.type === 'olt') cls = 'olt';
    else if (node.type === 'pole_foundation') cls = node.hasPole ? 'pole' : 'foundation';
    return [{ key: key, text: text, cls: cls }];
  }

  /** Read-only snapshot for LabelManager plugin — does not mutate Sim state. */
  function getEntities() {
    return (Sim.nodes || []).map(function (node) {
      if (!node) return null;
      var center = getNodeCenterXY(node);
      if (!center || !isFinite(center.x) || !isFinite(center.y)) return null;
      var label = getNodeAutoLabel(node);
      if (!label) return null;
      return {
        id: node.id,
        type: node.type,
        x: center.x,
        y: center.y,
        label: label,
      };
    }).filter(Boolean);
  }

  /** Read-only entity label rows (uses existing naming; no logic changes). */
  function getEntityLabelEntries() {
    var entries = global.FTTHLabelDataProviders.getEntityLabelEntries();
    var VM = global.FTTHVisibilityManager;
    return entries.filter(function (entry) {
      var node = findNode(entry.nodeId);
      if (!node) return false;
      if (VM && VM.isNodeVisible && !VM.isNodeVisible(node)) return false;
      /* Pole-attached FAT handhole: suppress all overlay labels (FH# must not overlap FAT#). */
      if (node.type === 'fat_handhole' && node.hasFatPole) return false;
      return true;
    });
  }

  /** Read-only cable labels — node-anchored badges for LabelManager overlay. */
  function getCableSegmentLabels() {
    var results = global.FTTHLabelDataProviders.getCableSegmentLabels();
    var VM = global.FTTHVisibilityManager;
    if (!VM || !VM.isCableVisible) return results;
    return results.filter(function (entry) {
      var cable = (Sim.fiberCablePaths || []).filter(function (c) { return String(c.id) === String(entry.id); })[0];
      return VM.isCableVisible(cable);
    });
  }

  /** Read-only object circles for label collision scoring. */
  function getLabelObjectObstacles() {
    return global.FTTHLabelDataProviders.getLabelObjectObstacles();
  }

  /** Read-only cable segment lines for label collision scoring. */
  function getCablePathSegments() {
    return global.FTTHLabelDataProviders.getCablePathSegments();
  }

  function getNodeTitle(node) {
    if (!node) return '';
    var parts = [];
    if (node.type === 'handhole') parts.push('Handhole ' + (node.autoName || ''));
    if (node.type === 'fat_handhole') {
      parts.push('FAT Handhole ' + (node.autoName || ''));
      if (node.hasFatPole && node.fatSystemName) parts.push('FAT Pole ' + node.fatSystemName);
    }
    if (node.type === 'fdt') parts.push('FDT ' + (node.autoName || ''));
    if (node.closureName && node.type === 'handhole') parts.push('Closure ' + node.closureName);
    if (node.hasClosure && node.type === 'fat_handhole') parts.push('Closure nested');
    if (node.fatSplitter) {
      if (node.type === 'fdt') parts.push('Splitter ' + node.fatSplitter);
      else if (node.type === 'fat_handhole' && node.hasFatPole) parts.push('FAT Box Splitter ' + node.fatSplitter);
    }
    parts.push('Cell ' + node.col + ',' + node.row);
    if (node.locked) parts.push('[locked]');
    return parts.filter(Boolean).join(' · ');
  }

  function findTool(id) {
    for (var i = 0; i < TOOLBOX.length; i++) {
      if (TOOLBOX[i].id === id) return TOOLBOX[i];
    }
    for (var j = 0; j < LM_HOLES_TOOLS.length; j++) {
      if (LM_HOLES_TOOLS[j].id === id) return LM_HOLES_TOOLS[j];
    }
    for (var k = 0; k < LM_POLES_TOOLS.length; k++) {
      if (LM_POLES_TOOLS[k].id === id) return LM_POLES_TOOLS[k];
    }
    return null;
  }

  function isDraggableTool(item) {
    return !item.isCable;
  }

  function toolboxIconHtml(item) {
    var s = 28;
    if (item.visual === 'handhole') return handholeIconSvg(s);
    if (item.visual === 'fat_handhole') return fatHandholeIconSvg(s);
    if (item.visual === 'fat_pole') return fatPoleIconHtml(s);
    if (item.visual === 'closure') return closureIconSvg(s);
    if (item.visual === 'fdt') return fdtCabinetGlyphHtml(s);
    if (item.visual === 'olt') return oltBuildingGlyphHtml(s);
    if (item.visual === 'excav') return excavationToolIconSvg(item.routeKind, s);
    if (item.visual === 'excav_pen') return excavationPenIconSvg(s);
    if (item.visual === 'splitter') return splitterIconSvg(item.variant || '1x8', s);
    return item.icon;
  }

  function isPenToolSelected() {
    return Sim.selectedTool === PEN_TOOL_ID;
  }

  function isPenToolActive() {
    return isPenToolSelected() && !!Sim.pen.lineMode;
  }

  function canPenDraw() {
    return isPenToolActive() && Sim.interactionMode !== 'hand';
  }

  function findExcavationTool(id) {
    for (var i = 0; i < EXCAVATION_TOOLS.length; i++) {
      if (EXCAVATION_TOOLS[i].id === id) return EXCAVATION_TOOLS[i];
    }
    return null;
  }

  function cableGroupById(id) {
    for (var i = 0; i < CABLE_GROUPS.length; i++) {
      if (CABLE_GROUPS[i].id === id) return CABLE_GROUPS[i];
    }
    return CABLE_GROUPS[0];
  }

  var FOUNDATION_BASE_RATIO = 0.42 * 1.3 * 1.3 * 1.4; /* legacy toolbox scaling */

  function foundationIconAnchor() {
    return { x: 24, y: 47, label: 'bottom-center' };
  }

  function fieldIconSizeForNode(node) {
    var layerSize = iconSizeForStackLayer(node);
    return { w: layerSize, h: layerSize, anchor: 'center' };
  }

  function getStackLayerCount(node) {
    if (!node) return 1;
    if (node.type === 'handhole') return 1;
    if (node.type === 'fdt') return 1 + (node.fatSplitter ? 1 : 0);
    return 1;
  }

  function iconSizeForStackLayer(node) {
    var cs = (Sim.layout && Sim.layout.cellSize) || 22;
    var comp = getIconCompensation();
    var count = Math.max(1, getStackLayerCount(node));
    var usable = Math.round(cs * 0.78 * comp);
    return Math.max(8, Math.floor(usable / count));
  }

  function svgOpenTag(cls, w, h, viewBox) {
    return '<svg class="field-icon ' + cls + '" viewBox="' + (viewBox || '0 0 48 48') + '" width="' + w + '" height="' + h + '" aria-hidden="true" overflow="visible">';
  }

  function iconBaseSize(kind) {
    var comp = getIconCompensation();
    var bases = { handhole: 24, closure: 20, foundation: 28, pole: 30, splitter: 22, default: 26 };
    return Math.round((bases[kind] || bases.default) * comp);
  }

  function getIconCompensation() {
    return 1;
  }

  function getWorkspaceContainer() {
    return document.getElementById('canvas-zoom-inner') ||
      document.querySelector('.workspace-container');
  }

  /** Label overlay host — template-local coords (same as placed nodes / SVG). */
  function getLabelOverlayHost() {
    return getDrawingCanvas() || getTemplateSheetElement() || getWorkspaceContainer();
  }

  /** Viewport bounds in template-local canvas px (for LabelManager on #city-canvas). */
  function getLabelMapViewportCanvasBounds() {
    var bounds = global.FTTHDrawingEngine?.getMapViewportCanvasBounds?.();
    if (!bounds) return null;
    var o = getTemplateSheetOrigin();
    return {
      x0: bounds.x0 - o.x,
      y0: bounds.y0 - o.y,
      x1: bounds.x1 - o.x,
      y1: bounds.y1 - o.y,
    };
  }

  /** Visible map viewport between toolbox and evaluation panels (#canvas-wrapper). */
  function getMapViewportWrapper() {
    return document.getElementById('canvas-wrapper');
  }

  function isOpenWorkspaceNavigation() {
    return (Sim.navigationMode || 'open') !== 'bounded';
  }

  function getOpenWorldPixelSize() {
    return { width: FTTH_WORLD_SIZE, height: FTTH_WORLD_SIZE };
  }

  function getTemplateSheetElement() {
    return document.getElementById('ftth-template-sheet');
  }

  function getTemplateSheetOrigin() {
    var o = Sim.templateOrigin || { x: 0, y: 0 };
    return { x: Number(o.x) || 0, y: Number(o.y) || 0 };
  }

  function computeCenteredTemplateOrigin(templateW, templateH) {
    var w = templateW || 0;
    var h = templateH || 0;
    return {
      x: (FTTH_WORLD_SIZE - w) / 2,
      y: (FTTH_WORLD_SIZE - h) / 2,
    };
  }

  /**
   * Content-box viewport frame for zoom/pan math (padding-aware; matches clientWidth/Height).
   */
  function getMapZoomViewportFrame() {
    var wrap = getMapViewportWrapper();
    if (!wrap) {
      return { left: 0, top: 0, width: 0, height: 0, centerX: 0, centerY: 0 };
    }
    var rect = wrap.getBoundingClientRect();
    var padLeft = wrap.clientLeft || 0;
    var padTop = wrap.clientTop || 0;
    if (!padLeft && !padTop && typeof getComputedStyle === 'function') {
      try {
        var cs = getComputedStyle(wrap);
        padLeft = parseFloat(cs.paddingLeft) || 0;
        padTop = parseFloat(cs.paddingTop) || 0;
      } catch (padErr) { /* use 0 */ }
    }
    var fw = wrap.clientWidth;
    var fh = wrap.clientHeight;
    return {
      left: rect.left + padLeft,
      top: rect.top + padTop,
      width: fw,
      height: fh,
      centerX: fw / 2,
      centerY: fh / 2,
    };
  }

  function clientPointToMapZoomLocal(clientX, clientY) {
    var frame = getMapZoomViewportFrame();
    return {
      x: (Number(clientX) || 0) - frame.left,
      y: (Number(clientY) || 0) - frame.top,
    };
  }

  function ensureFtthWorldDom() {
    var world = getWorkspaceContainer();
    if (!world) return;
    var grid = document.getElementById('ftth-world-grid');
    if (!grid) {
      grid = document.createElement('div');
      grid.id = 'ftth-world-grid';
      grid.className = 'ftth-world-grid';
      grid.setAttribute('aria-hidden', 'true');
      world.insertBefore(grid, world.firstChild);
    }
    var sheet = getTemplateSheetElement();
    var canvas = document.getElementById('city-canvas');
    if (!sheet && canvas) {
      sheet = document.createElement('div');
      sheet.id = 'ftth-template-sheet';
      sheet.className = 'ftth-template-sheet';
      world.insertBefore(sheet, canvas);
      sheet.appendChild(canvas);
    } else if (sheet && canvas && canvas.parentElement !== sheet) {
      sheet.appendChild(canvas);
    }
    world.classList.add('ftth-world-root');
  }

  function syncOpenWorldShell() {
    ensureFtthWorldDom();
    var world = getWorkspaceContainer();
    if (!world) return;
    world.style.width = FTTH_WORLD_SIZE + 'px';
    world.style.height = FTTH_WORLD_SIZE + 'px';
    world.style.setProperty('--ftth-world-size', FTTH_WORLD_SIZE + 'px');

    var map = getMapContentPixelSize();
    var origin = computeCenteredTemplateOrigin(map.width, map.height);
    Sim.templateOrigin = { x: origin.x, y: origin.y };

    var sheet = getTemplateSheetElement();
    if (sheet) {
      sheet.style.left = origin.x + 'px';
      sheet.style.top = origin.y + 'px';
      sheet.style.width = map.width + 'px';
      sheet.style.height = map.height + 'px';
    }

    var cityGrid = getWorkspaceGrid();
    if (cityGrid) {
      /* Training cities paint streets/zones on grid cells — only strip cell chrome for uploaded maps. */
      cityGrid.classList.toggle('ftth-hide-cell-grid', Sim.activeCityId === 'uploaded_map');
    }
  }

  /** Screen-space center of #canvas-wrapper (excludes toolbox / evaluation panels). */
  function getWorkspaceViewportScreenCenter() {
    var workspaceContainer = getMapViewportWrapper();
    if (!workspaceContainer) return { x: 0, y: 0 };
    var rect = workspaceContainer.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  }

  function getMapRotationDeg() {
    if (!Sim.settings || !Sim.settings.mapRotationEnabled) return 0;
    return Number(Sim.mapRotation) || 0;
  }

  function getTemplateSheetCenterLocal() {
    var map = getMapContentPixelSize();
    return { x: (map.width || 0) / 2, y: (map.height || 0) / 2 };
  }

  function rotatePointAroundCenter(px, py, cx, cy, rotDeg) {
    var deg = Number(rotDeg) || 0;
    if (!deg) return { x: px, y: py };
    var rad = deg * Math.PI / 180;
    var cos = Math.cos(rad);
    var sin = Math.sin(rad);
    var dx = px - cx;
    var dy = py - cy;
    return {
      x: cx + dx * cos - dy * sin,
      y: cy + dx * sin + dy * cos,
    };
  }

  /** Template-local map XY → #canvas-zoom-inner desk coordinates (sheet rotate @ 50% 50%). */
  function templateLocalToDeskWorldXY(tx, ty) {
    var o = getTemplateSheetOrigin();
    var center = getTemplateSheetCenterLocal();
    var rot = getMapRotationDeg();
    var sheetPt = rotatePointAroundCenter(
      Number(tx) || 0,
      Number(ty) || 0,
      center.x,
      center.y,
      rot
    );
    return { x: o.x + sheetPt.x, y: o.y + sheetPt.y };
  }

  /** Desk (#canvas-zoom-inner) coordinates → template-local map XY. */
  function deskWorldToTemplateLocalXY(deskX, deskY) {
    var o = getTemplateSheetOrigin();
    var center = getTemplateSheetCenterLocal();
    var rot = getMapRotationDeg();
    var sheetX = (Number(deskX) || 0) - o.x;
    var sheetY = (Number(deskY) || 0) - o.y;
    return rotatePointAroundCenter(sheetX, sheetY, center.x, center.y, -rot);
  }

  /* ─── Virtual XY grid (no Lat/Lng) ─── */
  function getWorkspaceGrid() {
    return document.getElementById('city-grid');
  }

  function getWorkspaceItemsLayer() {
    return document.getElementById('workspace-items-layer');
  }

  function getGridCellForNode(node) {
    var grid = getWorkspaceGrid();
    if (!grid || !node) return null;
    return grid.querySelector('[data-col="' + node.col + '"][data-row="' + node.row + '"]');
  }

  function getGridCellForNodeElement(el) {
    if (!el) return null;
    if (el.parentElement && el.parentElement.classList.contains('grid-cell')) return el.parentElement;
    var node = findNode(el.dataset.id);
    return getGridCellForNode(node);
  }

  function getDropCanvasViewport() {
    return getDrawingCanvas() || document.getElementById('canvas-wrapper') || getWorkspaceGrid();
  }

  /**
   * Screen client point → map/world XY for placement, pick, and draw.
   * Uses map-container rect + inverse zoom; prefers SVG CTM when available.
   */
  function mapContainerPointerToWorldXY(clientX, clientY) {
    var rotDeg = getMapRotationDeg();
    if (!rotDeg) {
      var canvas = getDrawingCanvas();
      if (canvas) {
        var canvasRect = canvas.getBoundingClientRect();
        if (canvasRect.width > 0.5 && canvasRect.height > 0.5) {
          var map = getMapContentPixelSize();
          return {
            x: ((clientX - canvasRect.left) / canvasRect.width) * map.width,
            y: ((clientY - canvasRect.top) / canvasRect.height) * map.height,
          };
        }
      }
    }
    var frame = getMapZoomViewportFrame();
    var mx = (Number(clientX) || 0) - frame.left;
    var my = (Number(clientY) || 0) - frame.top;
    var zoom = Math.max(getMapCoordZoom(), 0.1);
    var px = Sim.panX || 0;
    var py = Sim.panY || 0;
    var deskX = (mx - px) / zoom;
    var deskY = (my - py) / zoom;
    return deskWorldToTemplateLocalXY(deskX, deskY);
  }

  function clientPointToWorldXY(clientX, clientY) {
    var svg = getGlobalDrawingLayer();
    if (!svg && typeof ensureGlobalDrawingLayer === 'function') {
      svg = ensureGlobalDrawingLayer();
    }
    if (svg && typeof svg.createSVGPoint === 'function') {
      try {
        var pt = svg.createSVGPoint();
        pt.x = clientX;
        pt.y = clientY;
        var ctm = svg.getScreenCTM && svg.getScreenCTM();
        if (ctm && typeof ctm.inverse === 'function') {
          var mapped = pt.matrixTransform(ctm.inverse());
          if (mapped && isFinite(mapped.x) && isFinite(mapped.y)) {
            return { x: mapped.x, y: mapped.y };
          }
        }
      } catch (err) { /* fallback below */ }
    }
    return mapContainerPointerToWorldXY(clientX, clientY);
  }

  function pointerToWorkspaceXY(clientX, clientY) {
    return clientPointToWorldXY(clientX, clientY);
  }

  function screenPointToWorldXY(sx, sy) {
    var mapContainer = getDropCanvasViewport();
    if (!mapContainer) return { x: 0, y: 0 };
    var rect = mapContainer.getBoundingClientRect();
    return mapContainerPointerToWorldXY(rect.left + sx, rect.top + sy);
  }

  function worldPointToScreenXY(wx, wy) {
    var zoom = Math.max(getMapCoordZoom(), 0.1);
    var desk = templateLocalToDeskWorldXY(wx, wy);
    var px = Sim.panX || 0;
    var py = Sim.panY || 0;
    return {
      x: px + desk.x * zoom,
      y: py + desk.y * zoom,
    };
  }

  function eventToGridCellWithFallback(e, fallbackCell) {
    var dropPt = (eventHasUsableClientPoint(e) || Sim.ui.lastDragOverPointer)
      ? eventToGridCell(e)
      : null;
    if ((!dropPt || isNaN(dropPt.col) || isNaN(dropPt.row)) && fallbackCell) {
      dropPt = {
        col: parseInt(fallbackCell.dataset.col, 10),
        row: parseInt(fallbackCell.dataset.row, 10),
      };
    }
    if (!dropPt) return { point: null, cell: null };
    var grid = getWorkspaceGrid();
    var cell = grid && grid.querySelector('[data-col="' + dropPt.col + '"][data-row="' + dropPt.row + '"]');
    return { point: dropPt, cell: cell || fallbackCell || null };
  }

  function eventHasUsableClientPoint(e) {
    if (!e || typeof e.clientX !== 'number' || typeof e.clientY !== 'number') return false;
    if (!isFinite(e.clientX) || !isFinite(e.clientY)) return false;
    var canvas = getDropCanvasViewport();
    if (!canvas) return true;
    var rect = canvas.getBoundingClientRect();
    return e.clientX >= rect.left - 4 && e.clientX <= rect.right + 4 &&
      e.clientY >= rect.top - 4 && e.clientY <= rect.bottom + 4;
  }

  function rememberDragPointer(e) {
    if (!eventHasUsableClientPoint(e)) return;
    Sim.ui.lastDragOverPointer = { clientX: e.clientX, clientY: e.clientY };
  }

  function getDropClientPoint(e) {
    if (eventHasUsableClientPoint(e)) return { clientX: e.clientX, clientY: e.clientY };
    if (Sim.ui.lastDragOverPointer) return Sim.ui.lastDragOverPointer;
    return { clientX: e?.clientX || 0, clientY: e?.clientY || 0 };
  }

  function workspaceXYToCell(x, y) {
    if (!Sim.layout) return { col: 0, row: 0 };
    var cs = Sim.layout.cellSize;
    var col = Math.max(0, Math.min(Sim.layout.cols - 1, Math.floor(x / cs)));
    var row = Math.max(0, Math.min(Sim.layout.rows - 1, Math.floor(y / cs)));
    return { col: col, row: row };
  }

  function pointerToGridCell(clientX, clientY) {
    var xy = pointerToWorkspaceXY(clientX, clientY);
    var cell = workspaceXYToCell(xy.x, xy.y);
    return cell;
  }

  function eventToGridCell(e) {
    var pt = getDropClientPoint(e);
    return pointerToGridCell(pt.clientX, pt.clientY);
  }

  function snapNodeToCell(node) {
    if (!node || !Sim.layout) return;
    delete node.x;
    delete node.y;
  }

  function isFatRigidMapNode(node) {
    return !!(node && node.type === 'fat_handhole' && node.hasFatPole);
  }

  function isFatHandholeMapNode(node) {
    return !!(node && node.type === 'fat_handhole');
  }

  /**
   * FAT handhole shell — quarantine children; grid XY stays on .placed-node.
   */
  function isFatRigidMarkerChild(el) {
    if (!el || !el.classList || !el.closest('.fat-rigid-marker')) return false;
    return el.classList.contains('fat-pole-icon') ||
      el.classList.contains('fat-handhole-base') ||
      el.classList.contains('pole-label') ||
      el.classList.contains('field-node-label--fat-system');
  }

  /** Strip inline layout from passengers — hub fixed; pole+label rotate via CSS only. */
  function quarantineFatRigidMarkerChildren(marker) {
    if (!marker) return;
    marker.querySelectorAll(
      '.fat-handhole-base, .pole-label, .field-node-label--fat-system'
    ).forEach(function (el) {
      if (!el || !el.style) return;
      el.style.removeProperty('position');
      el.style.removeProperty('top');
      el.style.removeProperty('left');
      el.style.removeProperty('right');
      el.style.removeProperty('bottom');
      el.style.removeProperty('transform');
      el.style.removeProperty('transform-origin');
      el.style.removeProperty('will-change');
      el.style.removeProperty('margin');
      el.style.removeProperty('padding');
    });
    marker.querySelectorAll('.fat-pole-stack > .fat-pole-icon, .fat-pole-stack > .pole-label, .fat-pole-stack > .field-node-label--fat-system').forEach(function (el) {
      if (!el || !el.style) return;
      el.style.removeProperty('position');
      el.style.removeProperty('top');
      el.style.removeProperty('left');
      el.style.removeProperty('right');
      el.style.removeProperty('bottom');
      el.style.removeProperty('transform');
      el.style.removeProperty('transform-origin');
      el.style.removeProperty('will-change');
      el.style.removeProperty('margin');
      el.style.removeProperty('padding');
    });
    marker.querySelectorAll(':scope > .fat-pole-stack').forEach(function (el) {
      if (!el || !el.style) return;
      el.style.removeProperty('position');
      el.style.removeProperty('top');
      el.style.removeProperty('left');
      el.style.removeProperty('right');
      el.style.removeProperty('bottom');
      el.style.removeProperty('margin');
      el.style.removeProperty('padding');
      el.style.removeProperty('will-change');
    });
  }
  Sim.quarantineFatRigidMarkerChildren = quarantineFatRigidMarkerChildren;

  /** Runtime block: passengers inside .fat-rigid-marker must never get layout via JS. */
  function installFatRigidMarkerQuarantineGuard() {
    if (installFatRigidMarkerQuarantineGuard._done) return;
    installFatRigidMarkerQuarantineGuard._done = true;
    var blockedProps = {
      top: 1, left: 1, right: 1, bottom: 1,
      transform: 1, 'transform-origin': 1, position: 1,
      margin: 1, 'margin-top': 1, 'margin-left': 1, 'margin-right': 1, 'margin-bottom': 1,
    };
    function findRigidMarkerPassenger(styleDecl) {
      if (!styleDecl) return null;
      var markers = document.querySelectorAll('.fat-rigid-marker');
      for (var m = 0; m < markers.length; m++) {
        var kids = markers[m].querySelectorAll(
          '.fat-pole-stack > .fat-pole-icon, .fat-pole-stack > .pole-label, .fat-pole-stack > .field-node-label--fat-system, ' +
          '.fat-handhole-base, .pole-label, .field-node-label--fat-system'
        );
        for (var k = 0; k < kids.length; k++) {
          if (kids[k].style === styleDecl) return kids[k];
        }
      }
      return null;
    }
    function shouldBlock(styleDecl, prop, value) {
      if (!prop || !blockedProps[String(prop).toLowerCase()]) return false;
      if (value == null || value === '') return false;
      return !!findRigidMarkerPassenger(styleDecl);
    }
    try {
      var proto = CSSStyleDeclaration.prototype;
      var nativeSetProperty = proto.setProperty;
      proto.setProperty = function (property, value, priority) {
        if (shouldBlock(this, property, value)) return;
        return nativeSetProperty.call(this, property, value, priority);
      };
      ['top', 'left', 'right', 'bottom', 'transform', 'position', 'margin'].forEach(function (prop) {
        var desc = Object.getOwnPropertyDescriptor(proto, prop);
        if (!desc || !desc.set || desc.configurable === false) return;
        Object.defineProperty(proto, prop, {
          configurable: true,
          enumerable: desc.enumerable,
          get: desc.get,
          set: function (value) {
            if (shouldBlock(this, prop, value)) return;
            return desc.set.call(this, value);
          },
        });
      });
    } catch (guardErr) {
      if (DEBUG) {
        console.warn('[FAT rigid marker] quarantine guard install failed', guardErr);
      }
    }
  }
  installFatRigidMarkerQuarantineGuard();

  /** Quarantine only — grid XY stays on .placed-node; marker is a relative child shell. */
  function pinFatRigidMarkerPosition(node) {
    if (!isFatHandholeMapNode(node) || Sim._isMapTransformFlush) return;
    var placed = document.querySelector('.placed-node[data-id="' + node.id + '"]');
    if (!placed) return;
    var marker = placed.querySelector('.fat-rigid-marker');
    if (!marker) return;
    marker.style.removeProperty('left');
    marker.style.removeProperty('top');
    marker.style.pointerEvents = 'auto';
    quarantineFatRigidMarkerChildren(marker);
  }

  function dedupePlacedNodesById(nodeId) {
    var nodes = document.querySelectorAll('.placed-node[data-id="' + nodeId + '"]');
    for (var i = 1; i < nodes.length; i++) nodes[i].remove();
  }

  function applyCellLockPosition(el, node) {
    if (!el) return;
    el.style.setProperty('position', 'absolute', 'important');
    el.style.setProperty('inset', 'auto', 'important');
    if (el.classList.contains('placed-node--top-layer') && node && Sim.layout) {
      el.classList.add('placed-node--grid-xy');
      var cs = Sim.layout.cellSize || 50;
      var x = node.col * cs;
      var y = node.row * cs;
      el.style.setProperty('width', cs + 'px', 'important');
      el.style.setProperty('height', cs + 'px', 'important');
      el.style.setProperty('left', x + 'px', 'important');
      el.style.setProperty('top', y + 'px', 'important');
      el.style.transform = 'none';
      if (isFatHandholeMapNode(node)) pinFatRigidMarkerPosition(node);
    } else {
      el.style.setProperty('left', '0', 'important');
      el.style.setProperty('top', '0', 'important');
      el.style.setProperty('width', '100%', 'important');
      el.style.setProperty('height', '100%', 'important');
      el.style.transform = 'none';
    }
    el.style.setProperty('right', 'auto', 'important');
    el.style.setProperty('bottom', 'auto', 'important');
    el.style.margin = '0';
    el.style.padding = '0';
    el.style.boxSizing = 'border-box';
    el.style.display = 'flex';
    el.style.alignItems = 'center';
    el.style.justifyContent = 'center';
    el.style.overflow = 'visible';
    el.style.pointerEvents = 'auto';
    el.style.zIndex = '100';
    if (node && (node.type === 'handhole' || node.type === 'fat_handhole')) el.style.zIndex = '120';
  }

  function getDrawingCanvas() {
    return document.getElementById('city-canvas');
  }

  function getGlobalDrawingLayer() {
    return document.getElementById('global-drawing-layer');
  }

  function getCanvasContainer() {
    return getDrawingCanvas();
  }

  /** Screen pointer → SVG user space via transformation matrix (zoom/pan/fullscreen safe). */
  function pointerClientToCanvasXY(clientX, clientY) {
    return clientPointToWorldXY(clientX, clientY);
  }

  function pointerClientToCanvasXYLegacy(clientX, clientY) {
    return mapContainerPointerToWorldXY(clientX, clientY);
  }

  /** @deprecated internal alias — prefer pointerEventToCanvasXY / pointerClientToCanvasXY */
  function getExactCanvasPoints(e, canvasContainer) {
    if (e && typeof e.clientX === 'number' && typeof e.clientY === 'number') {
      return pointerClientToCanvasXY(e.clientX, e.clientY);
    }
    return { x: 0, y: 0 };
  }

  function getBottomPanelHost() {
    return getFullscreenOverlayHost();
  }

  function getFullscreenOverlayHost() {
    var container = document.getElementById('simulator-container');
    var host = document.getElementById('sim-workspace-overlays');
    if (host && container && container.contains(host)) return host;
    if (container) return container;
    return document.body;
  }

  function ensureBottomPanelInWorkspace() {
    /* Path bottom panel retired — unified sidebar only */
  }

  var ACTIVE_EDIT_PATH_COLOR = '#22c55e';
  var MAP_SELECTION_HIGHLIGHT = '#FFD400';
  var CABLE_SIDEBAR_HIGHLIGHT = '#dc2626';
  var CABLE_STROKE_BLUE = '#2563eb';
  var CABLE_STROKE_WIDTH = '1.15';
  var CABLE_LANE_STEP_PX = 1.5;
  var CABLE_LANE_MAX_SPREAD_PX = 4;
  var TRENCH_CEMENT_BASE_WIDTH = 3.5;
  var TRENCH_CEMENT_WIDTH_PER_EXTRA_CABLE = 2;
  var UNIFIED_TRENCH_CEMENT_WIDTH = String(TRENCH_CEMENT_BASE_WIDTH);
  var MAP_ZOOM_MIN = 0.2;
  var MAP_ZOOM_MAX = 2.75;
  /** Pan drag: 1:1 screen px (cursor lock) × optional product gain — never divide by zoom. */
  var MAP_PAN_DRAG_GAIN = 1;
  var MAP_ZOOM_STEP = 0.08;
  var MAP_WHEEL_BURST_IDLE_MS = 180;
  var FTTH_WORLD_SIZE = 20000;
  var PAN_CLAMP_BUFFER = 300;
  var MAP_LOAD_CENTER_DELAY_MS = 300;
  var mapViewportTransformRaf = 0;

  function roundMapCoord(v) {
    return Math.round(Number(v) || 0);
  }

  function roundPathPoints(points) {
    if (!points) return [];
    return points.map(function (p) {
      return p ? [roundMapCoord(p[0]), roundMapCoord(p[1])] : [0, 0];
    });
  }

  function getMapCoordZoom() {
    return Sim.zoom || 1;
  }

  /** Base map dimensions at logical zoom=1 — visual zoom uses CSS scale on the workspace container. */
  function syncBaseMapLayerSizes() {
    if (!Sim.layout) return;
    var L = Sim.layout;
    var cs = L.cellSize;
    var w = L.cols * cs;
    var h = L.rows * cs;

    document.documentElement.style.setProperty('--map-zoom', String(Sim.zoom || 1));
    document.documentElement.style.setProperty('--map-cell-size', cs + 'px');

    var grid = document.getElementById('city-grid');
    var canvas = getDrawingCanvas();
    var itemsLayer = getWorkspaceItemsLayer();
    var streetLayer = document.getElementById('street-layer');
    var satLayer = document.getElementById('satellite-bg-layer');

    if (grid) {
      grid.style.gridTemplateColumns = 'repeat(' + L.cols + ', ' + cs + 'px)';
      grid.style.gridTemplateRows = 'repeat(' + L.rows + ', ' + cs + 'px)';
      grid.style.width = w + 'px';
      grid.style.height = h + 'px';
    }
    if (canvas) {
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
    }
    if (itemsLayer) {
      itemsLayer.style.width = w + 'px';
      itemsLayer.style.height = h + 'px';
    }
    if (streetLayer) {
      streetLayer.style.width = w + 'px';
      streetLayer.style.height = h + 'px';
    }
    if (satLayer) {
      satLayer.style.width = w + 'px';
      satLayer.style.height = h + 'px';
    }
    var gridOverlay = document.getElementById('image-map-grid-overlay');
    if (gridOverlay) {
      gridOverlay.style.width = w + 'px';
      gridOverlay.style.height = h + 'px';
    }

    syncOpenWorldShell();

    var svg = getGlobalDrawingLayer();
    if (svg) {
      svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
      svg.setAttribute('width', w);
      svg.setAttribute('height', h);
      svg.style.width = w + 'px';
      svg.style.height = h + 'px';
      svg.setAttribute('preserveAspectRatio', 'none');
    }
    var labels = document.getElementById('global-map-labels-layer');
    if (labels) {
      labels.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
      labels.setAttribute('width', w);
      labels.setAttribute('height', h);
      labels.style.width = w + 'px';
      labels.style.height = h + 'px';
      labels.setAttribute('preserveAspectRatio', 'none');
    }
  }

  function isPathActiveToolEdit() {
    return !!(Sim.pathEdit?.vertexToolActive || Sim.pathEdit?.splitToolActive);
  }

  function isPathInTopologyHighlight(pathType, pathId) {
    if (!Sim.topologyHighlight || !pathType || !pathId) return false;
    /* Individual path selection isolates canvas highlight from topology fan-out. */
    if (Sim.selectedPath &&
        (Sim.selectedPath.type === 'excavation' || Sim.selectedPath.type === 'fiber')) {
      return false;
    }
    var paths = Sim.topologyHighlight.paths || [];
    for (var i = 0; i < paths.length; i++) {
      if (paths[i].type === pathType && paths[i].id === pathId) return true;
    }
    return false;
  }

  function pathEndpointTouchesNode(path, node) {
    if (!path || !node) return false;
    var identityLabels = [];
    if (node.autoName) identityLabels.push(String(node.autoName));
    if (node.poleName) identityLabels.push(String(node.poleName));
    if (node.type === 'fat_handhole' && node.fatSystemName) {
      identityLabels.push(String(node.fatSystemName));
    }
    var ct = path.connectedTo || {};
    var i;
    for (i = 0; i < identityLabels.length; i++) {
      var snapLabel = identityLabels[i];
      if (ct.start === snapLabel || ct.end === snapLabel) return true;
    }
    if ((path.associatedHandholeNodeIds || []).indexOf(node.id) >= 0) return true;
    var snaps = path.snapLabels || [];
    if (snaps.length && identityLabels.length) {
      var endSnaps = [snaps[0], snaps[snaps.length - 1]];
      for (i = 0; i < endSnaps.length; i++) {
        if (endSnaps[i] && identityLabels.indexOf(String(endSnaps[i])) >= 0) return true;
      }
    }
    var center = global.FTTHDrawingEngine?.getDeviceSnapCenter?.(node) || getNodeCenterXY(node);
    if (!center || !path.points || path.points.length < 2) return false;
    var cs = Sim.layout?.cellSize || 50;
    var tol = cs * 0.55;
    var ends = [0, path.points.length - 1];
    for (i = 0; i < ends.length; i++) {
      var pt = path.points[ends[i]];
      if (pt && Math.hypot(pt[0] - center.x, pt[1] - center.y) <= tol) return true;
    }
    return false;
  }

  /** Strict: only excavations whose ends are linked to this node (not mid-path near-misses). */
  function excavationPassesThroughNode(path, node) {
    return pathEndpointTouchesNode(path, node);
  }

  function getExcavationsLinkedToNode(node) {
    if (!node) return [];
    var cabId = resolveInspectionCabinetId(node);
    return (Sim.excavationPaths || []).filter(function (path) {
      if (!pathEndpointTouchesNode(path, node)) return false;
      if (cabId && !excavationBelongsToCabinet(path, cabId)) return false;
      return true;
    });
  }

  function getCablesLinkedToNode(node) {
    // Strict: only cables that themselves connect/terminate/intersect this node.
    // Do NOT dump all cables from parent trenches that merely touch the node.
    // Inspection scope follows the selected node's owner (Active FDT stays locked).
    return getCablesThroughNode(node) || [];
  }

  function getHandholesLinkedToExcavation(path) {
    var cabId = getActiveFdtId();
    if (path && path.ownerFdtId) cabId = String(path.ownerFdtId);
    return (Sim.nodes || []).filter(function (n) {
      if (!(n.type === 'handhole' || n.type === 'fat_handhole')) return false;
      if (!excavationPassesThroughNode(path, n)) return false;
      if (cabId && !nodeBelongsToCabinet(n, cabId)) return false;
      return true;
    });
  }

  function getPolesLinkedToNode(node) {
    var poles = [];
    if (!node) return poles;
    if (node.type === 'fat_handhole' && node.hasFatPole) {
      poles.push({ node: node, label: node.fatSystemName || (getNodeAsBuiltCode(node) + ' Pole') });
    }
    (Sim.nodes || []).forEach(function (n) {
      if (n.type !== 'pole_foundation') return;
      if (Math.abs(n.col - node.col) + Math.abs(n.row - node.row) <= 2) {
        poles.push({ node: n, label: getNodeAsBuiltCode(n) });
      }
    });
    return poles;
  }

  function getCabinetLinkedToNode(node) {
    return findServingFdt(node);
  }

  function resolvePrimaryHandholeForPath(pathType, path) {
    if (!path) return null;
    if (pathType === 'excavation') {
      var exHoles = getHandholesLinkedToExcavation(path);
      return exHoles[0] || null;
    }
    if (pathType === 'fiber') {
      var trench = resolveTrenchForCable(path);
      if (trench) {
        var linked = getHandholesLinkedToExcavation(trench);
        if (linked.length) return linked[0];
      }
      if (path.connectedTo?.start) {
        var startNode = findNodeBySnapLabel(path.connectedTo.start);
        if (startNode && (startNode.type === 'handhole' || startNode.type === 'fat_handhole')) return startNode;
      }
    }
    return null;
  }

  function getSidebarAnchorHandholeNode() {
    if (Sim.selectedNodeId) {
      var selected = findNode(Sim.selectedNodeId);
      if (selected && (selected.type === 'handhole' || selected.type === 'fat_handhole')) return selected;
    }
    if (Sim.topologyHighlight?.nodeId) {
      var highlighted = findNode(Sim.topologyHighlight.nodeId);
      if (highlighted && (highlighted.type === 'handhole' || highlighted.type === 'fat_handhole')) return highlighted;
    }
    return null;
  }

  function buildTopologyHighlight(node) {
    if (!node || (node.type !== 'handhole' && node.type !== 'fat_handhole')) return null;
    var excavations = getExcavationsLinkedToNode(node);
    var paths = [];
    excavations.forEach(function (path) {
      paths.push({ type: 'excavation', id: path.id });
    });
    return { nodeId: node.id, paths: paths };
  }

  function clearTopologyHighlight() {
    Sim.topologyHighlight = null;
    applyTopologyHighlightClasses();
  }

  function applyTopologyHighlightClasses() {
    document.querySelectorAll('.placed-node').forEach(function (el) {
      el.classList.remove('topology-trace-root');
    });
    if (!Sim.topologyHighlight?.nodeId) return;
    var root = document.querySelector('.placed-node[data-id="' + Sim.topologyHighlight.nodeId + '"]');
    if (root) root.classList.add('topology-trace-root');
  }

  function syncTopologyHighlightForNode(node) {
    if (node && (node.type === 'handhole' || node.type === 'fat_handhole')) {
      Sim.topologyHighlight = buildTopologyHighlight(node);
      if (!Sim.ui.topologyTreeFocus) {
        Sim.ui.topologyTreeFocus = { kind: 'node', nodeId: node.id };
      }
    } else {
      clearTopologyHighlight();
      return;
    }
    applyTopologyHighlightClasses();
  }

  function isPathPropertiesPanelOpen() {
    return !!(Sim.selectedPath && (Sim.selectedNodeId == null));
  }

  function syncPathBottomPanelLayout(isOpen) {
    var wrap = document.getElementById('canvas-wrapper');
    if (wrap) wrap.classList.remove('path-panel-canvas-active');
    requestAnimationFrame(function () {
      applyMapTransform();
    });
  }

  function hidePathPropertiesPanel() {
    /* Path properties retired — unified sidebar only */
  }

  function isPathEditSessionActive() {
    if (!Sim.selectedPath) return false;
    return !!(Sim.pathEdit?.vertexToolActive || Sim.pathEdit?.splitToolActive ||
      Sim.pathEdit?.editActive || Sim.ui.sidebarEditMode);
  }

  function hasActiveDrawingStroke() {
    return !!(Sim.penDraft && Sim.penDraft.points && Sim.penDraft.points.length > 0);
  }

  /** After trench/cable commit - one forced LabelManager pass (signature + content check). */
  function refreshLabelsAfterPathCommit() {
    global.FTTHLabelManager?.refresh?.({ force: true });
  }

  function isDrawingActive() {
    return hasActiveDrawingStroke() || !!(isPenToolActive() && Sim.pen.lineMode);
  }

  function resetDrawingPointsKeepTool() {
    if (global.FTTHDrawingEngine?.cancelCurrentDrawing) {
      global.FTTHDrawingEngine.cancelCurrentDrawing();
    } else if (Sim.penDraft) {
      Sim.penDraft.points = [];
      if (!Sim.penDraft.points.length) Sim.penDraft = null;
    }
    syncPenModeClass();
    syncDrawingLayerInteraction();
    renderGlobalDrawingLayer();
    syncBatchDuplicationHintForDrawingState();
    updateStatus('Drawing stroke cleared — tool still active');
  }

  function cancelCurrentDrawingStrokeOnly() {
    resetDrawingPointsKeepTool();
  }

  function getAppFullscreenRoot() {
    return document.getElementById('app-shell') || document.getElementById('app-workspace');
  }

  function getFullscreenContainer() {
    return document.getElementById('simulator-container') ||
      document.querySelector('.simulator-wrapper') ||
      document.getElementById('fullscreen-zone');
  }

  function getSimulatorWorkspaceRoot() {
    return getFullscreenContainer();
  }

  function isAppFullscreen() {
    var root = getAppFullscreenRoot();
    if (!root || !document.fullscreenElement) return false;
    return document.fullscreenElement === root || root.contains(document.fullscreenElement);
  }

  function isFakeFullscreen() {
    return isAppFullscreen();
  }

  function selectTool(element) {
    if (!element) return;
    var toolbar = document.getElementById('action-toolbar');
    if (!toolbar) return;
    toolbar.querySelectorAll('.tool-selected').forEach(function (btn) {
      // EXEMPT THE MOVE TOGGLE FROM BEING WIPED
      if (btn.id === 'btn-toolbar-move-node') return;
      btn.classList.remove('tool-selected');
    });
    // Only add the class to the clicked element if it's not the move node (move node handles itself)
    if (element.id !== 'btn-toolbar-move-node') {
      element.classList.add('tool-selected');
    }
  }

  function ensureSimulatorContainerFocusable() {
    var simulatorContainer = getFullscreenContainer();
    if (simulatorContainer) simulatorContainer.setAttribute('tabindex', '0');
    var appRoot = getAppFullscreenRoot();
    if (appRoot) appRoot.setAttribute('tabindex', '-1');
  }

  function syncFullscreenButtonUi() {
    try {
      var isFs = isAppFullscreen();
      var buttons = [
        document.getElementById('btn-fullscreen'),
      ].filter(Boolean);
      buttons.forEach(function (btn) {
        btn.textContent = isFs ? '⛶' : '🖥️';
        btn.title = isFs ? 'Exit full screen' : 'Full screen';
        btn.setAttribute('aria-pressed', isFs ? 'true' : 'false');
        btn.classList.toggle('grid-ctrl-btn--active', isFs);
        if (!isFs) btn.classList.remove('tool-selected');
      });
    } catch (err) {
      if (DEBUG) {
        console.warn('Fullscreen UI sync skipped:', err);
      }
    }
  }

  function onFullscreenChange() {
    var isFs = isAppFullscreen();
    var root = getAppFullscreenRoot();
    var workspace = getFullscreenContainer();
    document.body.classList.toggle('ftth-fake-fullscreen-active', isFs);
    if (root) root.classList.toggle('is-fullscreen', isFs);
    if (workspace) workspace.classList.toggle('is-fullscreen', isFs);
    syncFullscreenButtonUi();
    applyMapTransform();
    applyEvaluationPanelCollapseState();
    requestAnimationFrame(positionNodeActionHud);
    var menu = document.getElementById('sim-context-menu');
    if (menu) menu.style.zIndex = isFs ? '1000055' : '9999';
  }

  function toggleAppFullscreen() {
    try {
      var root = getAppFullscreenRoot();
      if (!root) return;

      root.setAttribute('tabindex', '-1');
      if (!document.fullscreenElement) {
        var request = root.requestFullscreen ||
          root.webkitRequestFullscreen ||
          root.msRequestFullscreen;
        if (!request) {
          if (DEBUG) {
            console.warn('Fullscreen API is not supported in this browser.');
          }
          return;
        }
        Promise.resolve(request.call(root)).then(function () {
          root.focus({ preventScroll: true });
          if (typeof window.focus === 'function') window.focus();
        }).catch(function (error) {
          console.error('Fullscreen request failed:', error);
        });
      } else {
        var exit = document.exitFullscreen ||
          document.webkitExitFullscreen ||
          document.msExitFullscreen;
        if (exit) Promise.resolve(exit.call(document)).catch(function (error) {
          console.error('Fullscreen exit failed:', error);
        });
      }
    } catch (error) {
      console.error('Fullscreen toggle error:', error);
    }
  }

  function syncFullscreenLayoutClasses() {
    onFullscreenChange();
  }

  function bindFullscreenButton() {
    var buttons = [
      document.getElementById('btn-fullscreen'),
    ].filter(function (btn) { return btn && btn.dataset.ftthFsBound !== '1'; });
    if (!buttons.length && document.documentElement.dataset.ftthFsChangeBound === '1') return;

    buttons.forEach(function (fsButton) {
      fsButton.dataset.ftthFsBound = '1';
      fsButton.addEventListener('click', function () {
        selectTool(fsButton);
        toggleAppFullscreen();
      });
    });

    if (document.documentElement.dataset.ftthFsChangeBound !== '1') {
      document.documentElement.dataset.ftthFsChangeBound = '1';
      document.addEventListener('fullscreenchange', onFullscreenChange);
      document.addEventListener('webkitfullscreenchange', onFullscreenChange);
    }
  }

  function focusSimulatorContainer() {
    try {
      var simulatorContainer = getFullscreenContainer();
      if (simulatorContainer) {
        simulatorContainer.setAttribute('tabindex', '0');
        simulatorContainer.focus({ preventScroll: true });
      }
    } catch (_) { /* optional */ }
  }

  var shortcutsHandler = null;
  var shortcutBoundTargets = [];
  var SHORTCUT_LISTENER_OPTS = { capture: true, passive: false };

  function isEditableShortcutTarget(e) {
    return !!(e.target && e.target.closest &&
      e.target.closest('input, textarea, select, [contenteditable="true"]'));
  }

  function getShortcutCaptureTargets() {
    var targets = [window, document];
    if (document.body) targets.push(document.body);

    var mainCanvas = document.querySelector('canvas') || document.getElementById('map');
    if (mainCanvas) targets.push(mainCanvas);

    var cityCanvas = document.getElementById('city-canvas');
    var canvasWrapper = document.getElementById('canvas-wrapper');
    var simulatorContainer = getFullscreenContainer();
    var drawingLayer = getGlobalDrawingLayer();
    if (cityCanvas) targets.push(cityCanvas);
    if (canvasWrapper) targets.push(canvasWrapper);
    if (simulatorContainer) targets.push(simulatorContainer);
    if (drawingLayer && drawingLayer !== cityCanvas) targets.push(drawingLayer);

    var seen = new Set();
    return targets.filter(function (target) {
      if (!target || seen.has(target)) return false;
      seen.add(target);
      return true;
    });
  }

  function isCtrlUndo(e) {
    if (!e || e.repeat) return false;
    if (!(e.ctrlKey || e.metaKey)) return false;
    var isZ = e.key === 'z' || e.key === 'Z' || e.keyCode === 90;
    return isZ && !e.shiftKey;
  }

  function isCtrlRedo(e) {
    if (!e || e.repeat) return false;
    var mod = e.ctrlKey || e.metaKey;
    var isY = e.key === 'y' || e.key === 'Y' || e.keyCode === 89;
    var isShiftZ = (e.key === 'z' || e.key === 'Z' || e.keyCode === 90) && e.shiftKey;
    return mod && (isY || isShiftZ);
  }

  function cancelActiveDrawingStrokeForEscape() {
    resetDrawingPointsKeepTool();
  }

  function handleShortcuts(e) {
    if (!e) return;
    if (DEBUG) {
      console.log('Key pressed:', e.key, 'Ctrl:', e.ctrlKey);
    }
    if (isEditableShortcutTarget(e)) return;

    if (isCtrlUndo(e)) {
      e.stopImmediatePropagation();
      e.preventDefault();
      e.stopPropagation();
      /* Active cable/trench stroke: pop last vertex only — never map-level undo. */
      if (hasActiveDrawingStroke()) {
        if (global.FTTHDrawingEngine?.removeLastVertex) {
          global.FTTHDrawingEngine.removeLastVertex();
          return;
        }
        if (global.FTTHDrawingEngine?.handlePenKeyDown?.(e)) return;
      }
      var undoBtn = document.getElementById('btn-undo');
      if (undoBtn && !undoBtn.disabled) undoBtn.click();
      return;
    }

    if (isCtrlRedo(e)) {
      e.stopImmediatePropagation();
      e.preventDefault();
      e.stopPropagation();
      /* Restore a vertex popped during the current pen stroke (including empty draft shell). */
      if (Sim.penDraft?.vertexRedo?.length) {
        if (global.FTTHDrawingEngine?.redoLastVertex) {
          global.FTTHDrawingEngine.redoLastVertex();
          return;
        }
        if (global.FTTHDrawingEngine?.handlePenKeyDown?.(e)) return;
      }
      var redoBtn = document.getElementById('btn-redo');
      if (redoBtn && !redoBtn.disabled) redoBtn.click();
      return;
    }

    if (e.key === 'Escape') {
      e.stopImmediatePropagation();
      e.preventDefault();
      e.stopPropagation();
      if (hasActiveDrawingStroke()) {
        cancelActiveDrawingStrokeForEscape();
        return;
      }
      if (getCurrentMode() === WORKSPACE_MODES.MEASURE) {
        cancelMeasureMode();
        return;
      }
      if (global.FTTHUiController?.handleEscapeKey?.()) return;
      return;
    }
  }

  function teardownGlobalShortcuts() {
    if (shortcutsHandler && shortcutBoundTargets.length) {
      shortcutBoundTargets.forEach(function (target) {
        try {
          target.removeEventListener('keydown', shortcutsHandler, SHORTCUT_LISTENER_OPTS);
        } catch (_) { /* ignore */ }
      });
    }
    shortcutBoundTargets = [];
    shortcutsHandler = null;
    window.__FTTH_WINDOW_KEYDOWN__ = false;
    window.__FTTH_GLOBAL_SHORTCUTS__ = false;
  }

  function bindGlobalKeyboardShortcuts() {
    teardownGlobalShortcuts();
    shortcutsHandler = handleShortcuts;
    shortcutBoundTargets = getShortcutCaptureTargets();
    shortcutBoundTargets.forEach(function (target) {
      target.addEventListener('keydown', shortcutsHandler, SHORTCUT_LISTENER_OPTS);
    });
    window.__FTTH_WINDOW_KEYDOWN__ = true;
    window.__FTTH_GLOBAL_SHORTCUTS__ = true;
  }

  function handlePathDeleteKey(e) {
    if (!Sim.selectedPath) return false;
    var key = e.key;
    if (key !== 'Delete' && key !== 'Backspace') return false;
    if (e.ctrlKey || e.metaKey) return false;
    if (canVertexEdit()) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      global.FTTHPathwayEditor?.deleteSelectedVertex?.();
      return true;
    }
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    deleteSelectedPath();
    return true;
  }

  function ensureFloatingUiInFullscreenHost() {
    ensureBottomPanelInWorkspace();
  }

  /** SVG matrix transform — zoom/pan/fullscreen safe user-space coordinates. */
  function getSVGCoordinates(e, svgElement) {
    var svg = svgElement || getGlobalDrawingLayer();
    if (!svg && typeof ensureGlobalDrawingLayer === 'function') {
      svg = ensureGlobalDrawingLayer();
    }
    if (svg && e && typeof e.clientX === 'number' && typeof svg.createSVGPoint === 'function') {
      try {
        var point = svg.createSVGPoint();
        point.x = e.clientX;
        point.y = e.clientY;
        var ctm = svg.getScreenCTM && svg.getScreenCTM();
        if (ctm && typeof ctm.inverse === 'function') {
          var mapped = point.matrixTransform(ctm.inverse());
          if (mapped && isFinite(mapped.x) && isFinite(mapped.y)) {
            return { x: mapped.x, y: mapped.y };
          }
        }
      } catch (err) { /* fallback */ }
    }
    if (e && typeof e.clientX === 'number') {
      return pointerClientToCanvasXY(e.clientX, e.clientY);
    }
    return { x: 0, y: 0 };
  }

  function pointerEventToCanvasXY(e) {
    return getSVGCoordinates(e);
  }

  function cancelPenDrawingMode() {
    resetDrawingPointsKeepTool();
    updateStatus('Drawing cancelled — pen tool still active');
  }

  function reorderDrawingLayerAboveNodes() {
    var canvas = getDrawingCanvas();
    var grid = getWorkspaceGrid();
    var svg = getGlobalDrawingLayer();
    if (!canvas || !svg) return;
    /* SVG must stay a city-canvas overlay — never a #city-grid child (breaks 48×34 matrix). */
    if (grid && svg.parentElement === grid) {
      canvas.appendChild(svg);
    }
    if (svg.parentElement !== canvas) {
      canvas.appendChild(svg);
    }
    var itemsLayer = document.getElementById('workspace-items-layer');
    if (itemsLayer && itemsLayer.parentElement === canvas && svg.previousElementSibling !== itemsLayer) {
      canvas.appendChild(svg);
    }
    var staleHit = document.getElementById('draw-hit-layer');
    if (staleHit) staleHit.remove();
  }

  function syncMapLabelsLayerSize() {
    syncBaseMapLayerSizes();
  }

  function ensureMapLabelsLayer() {
    var canvas = getDrawingCanvas();
    if (!canvas) return null;
    var layer = document.getElementById('global-map-labels-layer');
    if (!layer) {
      layer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      layer.id = 'global-map-labels-layer';
      layer.setAttribute('class', 'global-map-labels-layer');
      layer.setAttribute('aria-hidden', 'true');
      canvas.appendChild(layer);
    }
    if (canvas.lastElementChild !== layer) {
      canvas.appendChild(layer);
    }
    syncMapLabelsLayerSize();
    return layer;
  }

  function syncGlobalDrawingLayerSize() {
    syncBaseMapLayerSizes();
  }

  function ensureGlobalDrawingLayer() {
    var canvas = getDrawingCanvas();
    var svg = getGlobalDrawingLayer();
    if (!svg && canvas) {
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.id = 'global-drawing-layer';
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('class', 'global-drawing-layer');
      canvas.appendChild(svg);
    }
    reorderDrawingLayerAboveNodes();
    syncGlobalDrawingLayerSize();
    syncMapLabelsLayerSize();
    syncDrawingLayerInteraction();
    return svg;
  }

  function getConnectionsLayer() {
    return ensureGlobalDrawingLayer();
  }

  function ensureConnectionsLayer() {
    return ensureGlobalDrawingLayer();
  }

  function applyIconZoomCompensation() {
    var canvas = document.getElementById('city-canvas');
    if (canvas) canvas.style.setProperty('--node-icon-scale', '1');
  }

  function cableIdForKind(kind, cap) {
    return 'cable_' + (kind === 'lastmile' ? 'lm' : 'dist') + '_' + cap;
  }

  function clearToolboxSelection(box) {
    box.querySelectorAll('.toolbox-item--selected, .toolbox-card--selected').forEach(function (n) {
      n.classList.remove('toolbox-item--selected', 'toolbox-card--selected');
    });
    box.querySelectorAll('.cable-accordion-header--armed').forEach(function (n) {
      n.classList.remove('cable-accordion-header--armed');
    });
  }

  function isToolboxToolDblClickTarget(target) {
    if (!target || !target.closest) return null;
    var toolbox = document.getElementById('toolbox');
    if (!toolbox || !toolbox.contains(target)) return null;
    if (target.closest('.toolbox-category__header')) return null;
    if (target.closest('select')) return null;
    return target.closest('.toolbox-item, .toolbox-card, .pen-line-option, .fiber-cable-card, .cable-config-panel');
  }

  function deselectAllToolboxTools() {
    var box = document.getElementById('toolbox-items');
    if (box) clearToolboxSelection(box);
    document.querySelectorAll('.pen-line-option--active').forEach(function (el) {
      el.classList.remove('pen-line-option--active');
    });
    Sim.selectedTool = null;
    Sim.selectedCableSpec = null;
    Sim.selectedSplitterVariant = null;
    Sim.cableDraftFrom = null;
    Sim.penDraft = null;
    if (Sim.ui) Sim.ui.toolboxLockMode = false;
    if (Sim.pen) {
      Sim.pen.lineMode = null;
      Sim.pen.selectedLineId = null;
    }
    syncPenModeClass();
    syncDrawingLayerInteraction();
    global.FTTHDrawingEngine?.clearCableContinueSession?.();
    global.FTTHDrawingEngine?.hidePenDrawingOverlays?.();
    global.FTTHDrawingEngine?.syncPenPointerTracking?.();
    renderGlobalDrawingLayer();
    setInteractionMode('hand');
    updateStatus('Hand mode — pan map or pick elements');
  }

  function notifyPlacementToolUsed() {
    global.FTTHUiController?.onPlacementComplete?.();
  }

  function bindSmartToolboxActivation(el, toolId, onActivate) {
    if (!el || typeof onActivate !== 'function') return;
    var suppressClickUntil = 0;

    el.addEventListener('click', function (e) {
      if (e.target?.closest?.('select')) return;
      if (Date.now() < suppressClickUntil) return;
      onActivate({ event: e, lockMode: false });
      global.FTTHUiController?.onToolSelected?.({ lockMode: false });
    });

    el.addEventListener('dblclick', function (e) {
      if (e.target?.closest?.('select')) return;
      e.preventDefault();
      e.stopPropagation();
      suppressClickUntil = Date.now() + 450;
      if (isActiveToolboxTool(el, toolId)) {
        global.FTTHUiController?.deselectTool?.('Hand mode — pan map or pick elements');
        return;
      }
      onActivate({ event: e, lockMode: true });
      global.FTTHUiController?.onToolSelected?.({ lockMode: true });
    });
  }

  function resolveToolboxToolId(el) {
    if (!el) return null;
    if (el.dataset.type) return el.dataset.type;
    if (el.classList.contains('pen-line-option')) return PEN_TOOL_ID;
    if (el.classList.contains('cable-config-panel') && Sim.pen && Sim.pen.lineMode) return PEN_TOOL_ID;
    if (el.classList.contains('fiber-cable-card')) return 'cable';
    var host = el.closest('[data-type]');
    return host ? host.dataset.type : null;
  }

  function isToolboxElementActive(el) {
    if (!el) return false;
    if (el.classList.contains('toolbox-item--selected') || el.classList.contains('toolbox-card--selected')) return true;
    if (el.classList.contains('pen-line-option--active')) return true;
    if (el.classList.contains('cable-config-panel') && el.classList.contains('toolbox-item--selected')) return true;
    var armedHeader = el.closest('.toolbox-category') &&
      el.closest('.toolbox-category').querySelector('.cable-accordion-header--armed');
    if (armedHeader && (el.classList.contains('cable-config-panel') || el.classList.contains('fiber-cable-card'))) return true;
    return false;
  }

  function isActiveToolboxTool(el, toolId) {
    if (!isToolboxElementActive(el)) return false;
    if (!toolId) return false;
    if (toolId === PEN_TOOL_ID) return isPenToolSelected();
    if (toolId === 'splitter') return Sim.selectedTool === 'splitter';
    if (toolId === 'cable') return isPenToolSelected() && Sim.pen && Sim.pen.lineMode === 'cable';
    return Sim.selectedTool === toolId;
  }

  function onToolboxToolDblClick(e) {
    var el = isToolboxToolDblClickTarget(e.target);
    if (!el) return;
    var toolEl = el.closest('.toolbox-item, .toolbox-card, .pen-line-option, .fiber-cable-card, .cable-config-panel') || el;
    var toolId = resolveToolboxToolId(toolEl);
    if (!isActiveToolboxTool(toolEl, toolId)) return;
    e.preventDefault();
    e.stopPropagation();
    global.FTTHUiController?.deselectTool?.('Hand mode — pan map or pick elements');
  }

  function bindToolboxDeselectOnDblClick() {
    var toolbox = document.getElementById('toolbox');
    if (!toolbox || toolbox.dataset.ftthDblDeselectBound === '1') return;
    toolbox.dataset.ftthDblDeselectBound = '1';
    toolbox.addEventListener('dblclick', onToolboxToolDblClick);
  }

  function armCableTool(box, grp, capacity, cardEl) {
    armPenCable(grp, capacity, box, cardEl);
  }

  function armSplitterTool(box, variant, cardEl, opts) {
    opts = opts || {};
    Sim.ui.splitterVariant = variant;
    Sim.selectedTool = 'splitter';
    Sim.selectedSplitterVariant = variant;
    Sim.selectedCableSpec = null;
    if (Sim.ui) Sim.ui.toolboxLockMode = !!opts.lockMode;
    clearToolboxSelection(box);
    if (cardEl) cardEl.classList.add('toolbox-card--selected');
    var iconWrap = cardEl && cardEl.querySelector('.toolbox-card__icon');
    if (iconWrap) iconWrap.innerHTML = splitterIconSvg(variant, 28);
    setInteractionMode('select');
    updateStatus('Splitter ' + variant.replace('x', '×') + ' — drop on FDT');
    global.FTTHUiController?.onToolSelected?.({ lockMode: !!opts.lockMode });
  }

  function appendSplitterDropdownCard(box) {
    var variant = Sim.ui.splitterVariant || '1x8';
    if (SPLITTER_VARIANTS.indexOf(variant) < 0) variant = '1x8';

    var card = document.createElement('div');
    card.className = 'toolbox-card toolbox-card--splitter toolbox-item--nest';
    card.dataset.type = 'splitter';
    card.draggable = true;

    var header = document.createElement('div');
    header.className = 'toolbox-card__header';
    header.innerHTML =
      '<span class="toolbox-card__icon">' + splitterIconSvg(variant, 28) + '</span>' +
      '<span class="toolbox-card__title toolbox-collapsible-text">Splitter</span>';

    var selectWrap = document.createElement('div');
    selectWrap.className = 'toolbox-card__select-wrap toolbox-collapsible-text';
    var select = document.createElement('select');
    select.className = 'toolbox-card__select';
    select.setAttribute('aria-label', 'Splitter ratio');

    var grp1 = document.createElement('optgroup');
    grp1.label = '1 Input';
    ['1x2', '1x4', '1x8', '1x16'].forEach(function (v) {
      var opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      if (v === variant) opt.selected = true;
      grp1.appendChild(opt);
    });
    var grp2 = document.createElement('optgroup');
    grp2.label = '2 Inputs';
    ['2x4', '2x8', '2x16'].forEach(function (v) {
      var opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      if (v === variant) opt.selected = true;
      grp2.appendChild(opt);
    });
    select.appendChild(grp1);
    select.appendChild(grp2);

    function refreshIcon() {
      var v = select.value;
      var iconWrap = card.querySelector('.toolbox-card__icon');
      if (iconWrap) iconWrap.innerHTML = splitterIconSvg(v, 28);
    }

    select.addEventListener('change', function () {
      refreshIcon();
      armSplitterTool(box, select.value, card);
    });
    select.addEventListener('click', function (e) { e.stopPropagation(); });
    select.addEventListener('mousedown', function (e) { e.stopPropagation(); });

    card.addEventListener('dragstart', function (e) {
      if (e.target === select || select.contains(e.target)) {
        e.preventDefault();
        return;
      }
      var v = select.value;
      e.dataTransfer.setData('text/tool-type', 'splitter');
      e.dataTransfer.setData('text/tool-variant', v);
      Sim.selectedTool = 'splitter';
      Sim.selectedSplitterVariant = v;
      Sim.selectedCableSpec = null;
      armSplitterTool(box, v, card);
    });

    bindSmartToolboxActivation(card, 'splitter', function (opts) {
      if (opts?.event?.target === select || select.contains(opts?.event?.target)) return;
      armSplitterTool(box, select.value, card, opts);
    });

    selectWrap.appendChild(select);
    card.appendChild(header);
    card.appendChild(selectWrap);
    box.appendChild(card);
  }

  function appendLMHolesCategory(box) {
    var section = document.createElement('div');
    section.className = 'toolbox-category toolbox-category--lm-holes';
    section.dataset.categoryId = LM_HOLES_CATEGORY.id;

    var header = document.createElement('button');
    header.type = 'button';
    header.className = 'toolbox-category__header';
    header.style.borderColor = LM_HOLES_CATEGORY.color + '66';
    header.style.background = LM_HOLES_CATEGORY.color + '18';
    header.innerHTML =
      '<span class="toolbox-category__chevron" aria-hidden="true">▾</span>' +
      '<span class="toolbox-category__title toolbox-collapsible-text">' + LM_HOLES_CATEGORY.label + '</span>';

    var body = document.createElement('div');
    body.className = 'toolbox-category__body space-y-2';

    if (Sim.ui.categoryCollapsed[LM_HOLES_CATEGORY.id]) {
      section.classList.add('toolbox-category--collapsed');
    }

    header.addEventListener('click', function () {
      section.classList.toggle('toolbox-category--collapsed');
      Sim.ui.categoryCollapsed[LM_HOLES_CATEGORY.id] = section.classList.contains('toolbox-category--collapsed');
    });

    LM_HOLES_TOOLS.forEach(function (tool) {
      var el = document.createElement('div');
      el.className = 'toolbox-item toolbox-item--lm-hole flex items-center gap-3 p-3 rounded-xl border border-fiber-border bg-fiber-card hover:border-fiber-cyan/40 transition-all select-none cursor-pointer';
      el.dataset.type = tool.id;
      el.draggable = true;
      el.setAttribute('draggable', 'true');
      el.addEventListener('dragstart', function (e) {
        e.dataTransfer.setData('text/tool-type', tool.id);
        e.dataTransfer.effectAllowed = 'copy';
        armToolboxSelection(tool.id);
      });
      el.innerHTML =
        '<span class="toolbox-item__icon toolbox-item__icon--' + tool.visual + ' text-xl w-9 h-9 shrink-0 flex items-center justify-center rounded-lg" style="background:' +
        tool.color + '12;border:1px solid ' + tool.color + '44">' +
        toolboxIconHtml(tool) + '</span>' +
        '<div class="toolbox-item__text toolbox-collapsible-text flex-1 min-w-0"><p class="text-xs font-semibold text-white truncate">' + tool.label + '</p></div>';
      if (tool.nestOnly) el.classList.add('toolbox-item--nest');
      el.addEventListener('click', function () {
        clearToolboxSelection(box);
        el.classList.add('toolbox-item--selected');
        armToolboxSelection(tool.id, 'Tool: ' + tool.label + ' — drop on sidewalk');
      });
      body.appendChild(el);
    });

    section.appendChild(header);
    section.appendChild(body);
    box.appendChild(section);
  }

  function appendLMPolesCategory(box) {
    var section = document.createElement('div');
    section.className = 'toolbox-category toolbox-category--lm-poles';
    section.dataset.categoryId = LM_POLES_CATEGORY.id;

    var header = document.createElement('button');
    header.type = 'button';
    header.className = 'toolbox-category__header';
    header.style.borderColor = LM_POLES_CATEGORY.color + '66';
    header.style.background = LM_POLES_CATEGORY.color + '18';
    header.innerHTML =
      '<span class="toolbox-category__chevron" aria-hidden="true">▾</span>' +
      '<span class="toolbox-category__title toolbox-collapsible-text">' + LM_POLES_CATEGORY.label + '</span>';

    var body = document.createElement('div');
    body.className = 'toolbox-category__body space-y-2';

    if (Sim.ui.categoryCollapsed[LM_POLES_CATEGORY.id]) {
      section.classList.add('toolbox-category--collapsed');
    }

    header.addEventListener('click', function () {
      section.classList.toggle('toolbox-category--collapsed');
      Sim.ui.categoryCollapsed[LM_POLES_CATEGORY.id] = section.classList.contains('toolbox-category--collapsed');
    });

    LM_POLES_TOOLS.forEach(function (tool) {
      var el = document.createElement('div');
      el.className = 'toolbox-item toolbox-item--lm-pole flex items-center gap-3 p-3 rounded-xl border border-fiber-border bg-fiber-card hover:border-fiber-cyan/40 transition-all select-none cursor-pointer';
      el.dataset.type = tool.id;
      el.draggable = true;
      el.setAttribute('draggable', 'true');
      if (tool.nestOnly) el.classList.add('toolbox-item--nest');
      el.addEventListener('dragstart', function (e) {
        e.dataTransfer.setData('text/tool-type', tool.id);
        e.dataTransfer.effectAllowed = 'copy';
        armToolboxSelection(tool.id);
      });
      el.innerHTML =
        '<span class="toolbox-item__icon toolbox-item__icon--' + tool.visual + ' text-xl w-9 h-9 shrink-0 flex items-center justify-center rounded-lg" style="background:' +
        tool.color + '12;border:1px solid ' + tool.color + '44">' +
        toolboxIconHtml(tool) + '</span>' +
        '<div class="toolbox-item__text toolbox-collapsible-text flex-1 min-w-0"><p class="text-xs font-semibold text-white truncate">' + tool.label + '</p></div>';
      el.addEventListener('click', function () {
        clearToolboxSelection(box);
        el.classList.add('toolbox-item--selected');
        armToolboxSelection(tool.id, 'Tool: ' + tool.label + ' (drop onto FAT Handhole in LM_Holes)');
      });
      body.appendChild(el);
    });

    section.appendChild(header);
    section.appendChild(body);
    box.appendChild(section);
  }

  /** Floating emergency save badge removed — finish via double-click / standard gestures only. */
  function syncCableEmergencySaveButton() {
    var btn = document.getElementById('cable-emergency-save-btn');
    if (btn && btn.parentNode) btn.parentNode.removeChild(btn);
  }

  function isQuickNestToolSelected() {
    return Sim.selectedTool === 'closure' || Sim.selectedTool === 'fat_pole';
  }

  function syncQuickNestToolClass() {
    var wrap = document.getElementById('canvas-wrapper');
    if (wrap) wrap.classList.toggle('quick-nest-tool-active', isQuickNestToolSelected());
  }

  function armToolboxSelection(toolId, statusMsg, opts) {
    opts = opts || {};
    Sim.selectedTool = toolId;
    Sim.selectedCableSpec = null;
    Sim.selectedSplitterVariant = null;
    Sim.cableDraftFrom = null;
    Sim.penDraft = null;
    if (Sim.ui) Sim.ui.toolboxLockMode = !!opts.lockMode;
    syncPenModeClass();
    syncQuickNestToolClass();
    if (statusMsg) updateStatus(statusMsg);
    setInteractionMode('select');
    global.FTTHUiController?.onToolSelected?.({ lockMode: !!opts.lockMode });
  }

  function syncPenModeClass() {
    var wrap = document.getElementById('canvas-wrapper');
    var canvas = getDrawingCanvas();
    if (!wrap) return;
    var cablePenActive = !!(isPenToolActive() && Sim.pen && Sim.pen.lineMode === 'cable');
    wrap.classList.toggle('pen-tool-active', isPenToolSelected());
    wrap.classList.toggle('pen-tool-ready', isPenToolActive());
    wrap.classList.toggle('pen-cable-mode', cablePenActive);
    wrap.classList.toggle('pen-drawing-active', !!(isPenToolActive() && Sim.penDraft && Sim.penDraft.points.length));
    /* Phase 3: hide labels only while a cable stroke is in progress; restore on commit */
    wrap.classList.toggle(
      'cable-pen-labels-hidden',
      !!(cablePenActive && hasActiveDrawingStroke())
    );
    if (canvas) {
      canvas.classList.toggle('pen-tool-active', isPenToolSelected());
      canvas.classList.toggle('pen-tool-ready', isPenToolActive());
    }
    syncDrawingLayerInteraction();
    refreshPenLineUi();
    syncCableEmergencySaveButton();
    syncQuickNestToolClass();
    updateFieldStatusCounters();
    if (global.FTTHDrawingEngine?.syncPenPointerTracking) {
      global.FTTHDrawingEngine.syncPenPointerTracking();
    }
    global.FTTHDrawingEngine?.syncMapInteractionCursor?.();
  }

  var WORKSPACE_MODES = { PAN: 'pan', SELECT: 'select', CUT: 'cut', VERTEX: 'vertex', MEASURE: 'measure' };
  var MEASURE_OVERLAY_COLOR = '#38bdf8';
  var MEASURE_OVERLAY_DASH = '6,4';
  var MEASURE_PANEL_MIN_W = 220;
  var MEASURE_PANEL_MIN_H = 160;
  var measureRedrawPending = false;
  var measurePanelDragState = null;
  var measurePanelResizeState = null;
  var measurePanelWindowEventsBound = false;

  function getCurrentMode() {
    return Sim.currentMode || WORKSPACE_MODES.PAN;
  }

  function syncPathEditFlagsForMode(mode) {
    if (!Sim.pathEdit) {
      Sim.pathEdit = {
        drag: null, context: null, editActive: false,
        splitToolActive: false, vertexToolActive: false,
        cutHover: null, cutSwipe: null,
        selectedVertexIndex: null, editingPathId: null, isDraggingVertex: false,
        ghostPosition: null, ghostActive: false, ghostDragging: false,
        ghostPendingCommit: false, ghostCommit: null,
        ghostSnapped: false, ghostSnapTarget: null, frozenPoints: null, frozenPathD: null,
      };
    }
    Sim.pathEdit.splitToolActive = mode === WORKSPACE_MODES.CUT;
    Sim.pathEdit.vertexToolActive = mode === WORKSPACE_MODES.VERTEX;
    Sim.pathEdit.cutHover = null;
    Sim.pathEdit.cutSwipe = null;
    if (mode === WORKSPACE_MODES.CUT || mode === WORKSPACE_MODES.VERTEX) {
      if (Sim.selectedPath) {
        Sim.pathEdit.editActive = true;
        Sim.pathEdit.editingPathId = { type: Sim.selectedPath.type, id: Sim.selectedPath.id };
        if (mode === WORKSPACE_MODES.VERTEX && Sim.pathEdit.selectedVertexIndex == null) {
          Sim.pathEdit.selectedVertexIndex = 0;
        }
      } else {
        Sim.pathEdit.editActive = false;
        Sim.pathEdit.editingPathId = null;
        if (mode === WORKSPACE_MODES.VERTEX) Sim.pathEdit.selectedVertexIndex = null;
      }
    } else if (mode === WORKSPACE_MODES.SELECT) {
      Sim.pathEdit.vertexToolActive = false;
      Sim.pathEdit.splitToolActive = false;
      Sim.pathEdit.editActive = !!isPathPropertiesPanelOpen();
    } else if (mode === WORKSPACE_MODES.PAN) {
      Sim.pathEdit.vertexToolActive = false;
      Sim.pathEdit.splitToolActive = false;
      Sim.pathEdit.editActive = false;
      Sim.pathEdit.editingPathId = null;
    } else if (mode === WORKSPACE_MODES.MEASURE) {
      Sim.pathEdit.vertexToolActive = false;
      Sim.pathEdit.splitToolActive = false;
      Sim.pathEdit.editActive = false;
      Sim.pathEdit.editingPathId = null;
    }
    Sim.activeCanvasTool = mode === WORKSPACE_MODES.CUT ? 'cut'
      : (mode === WORKSPACE_MODES.VERTEX ? 'vertex'
        : (mode === WORKSPACE_MODES.MEASURE ? 'measure' : 'select'));
  }

  function applyCurrentModeEffects(mode) {
    syncPathEditFlagsForMode(mode);
    var wasHand = Sim.interactionMode === 'hand';
    if (mode === WORKSPACE_MODES.PAN) {
      Sim.interactionMode = 'hand';
      Sim.currentTool = 'hand';
    } else {
      Sim.interactionMode = 'select';
      Sim.currentTool = 'select';
    }
    applyInteractionModeClasses();
    if (wasHand && Sim.interactionMode === 'select') {
      renderAllNodes();
    }
    if (global.FTTHDrawingEngine?.syncCanvasToolChrome) {
      global.FTTHDrawingEngine.syncCanvasToolChrome();
    }
    if (global.FTTHDrawingEngine?.hideCrosshair &&
        (mode === WORKSPACE_MODES.SELECT || mode === WORKSPACE_MODES.PAN)) {
      global.FTTHDrawingEngine.hideCrosshair();
    }
    syncCutTargetCursor();
    syncDrawingLayerInteraction();
    syncVertexControlBarContent();
    renderGlobalDrawingLayer();
    if (mode === WORKSPACE_MODES.VERTEX) {
      updateStatus(Sim.selectedPath
        ? 'Vertex Tool — drag vertices on map · double-click path to add point'
        : 'Vertex Tool — click a path on the map to edit vertices');
    } else if (mode === WORKSPACE_MODES.CUT) {
      updateStatus(Sim.selectedPath
        ? 'Cut — swipe through path or click segment'
        : 'Cut Tool — click a path on the map to cut or split');
    } else if (mode === WORKSPACE_MODES.PAN) {
      updateStatus('Hand Tool — pan map (hold Space + drag to pan while editing)');
    } else if (mode === WORKSPACE_MODES.MEASURE) {
      ensureMeasurePanel();
      showMeasurePanel();
      positionMeasurePanel(Sim.ui?.lastCanvasClient || null);
      renderMeasurePanel();
      updateStatus('Measure — click to trace · Esc or 📏 to cancel');
    }
    if (mode !== WORKSPACE_MODES.MEASURE) {
      hideMeasurePanel();
    }
    renderUnifiedSidebar();
    syncGisToolbarActiveStates();
    global.FTTHDrawingEngine?.syncMapInteractionCursor?.();
  }

  function setCurrentMode(mode, opts) {
    opts = opts || {};
    var next = mode;
    if (next !== WORKSPACE_MODES.PAN && next !== WORKSPACE_MODES.SELECT &&
        next !== WORKSPACE_MODES.CUT && next !== WORKSPACE_MODES.VERTEX &&
        next !== WORKSPACE_MODES.MEASURE) {
      next = WORKSPACE_MODES.SELECT;
    }
    if (getCurrentMode() === next && !opts.force) return;
    Sim.currentMode = next;
    if (next === WORKSPACE_MODES.CUT || next === WORKSPACE_MODES.VERTEX) {
      ensureToolbarEditMode();
      resetMapPointerState({ keepCrosshair: next === WORKSPACE_MODES.VERTEX });
    } else if (next === WORKSPACE_MODES.SELECT) {
      Sim.crosshair = null;
      syncVertexPanelLayout(false);
    } else if (next === WORKSPACE_MODES.PAN) {
      resetMapPointerState();
    } else if (next === WORKSPACE_MODES.MEASURE) {
      resetMapPointerState({ keepCrosshair: true });
      resetMeasureTrace();
    }
    applyCurrentModeEffects(next);
  }

  function enablePanMode() {
    setCurrentMode(WORKSPACE_MODES.PAN);
  }

  function enableSelectMode() {
    setCurrentMode(WORKSPACE_MODES.SELECT);
  }

  function enableCutMode() {
    setCurrentMode(WORKSPACE_MODES.CUT);
  }

  function enableVertexMode() {
    setCurrentMode(WORKSPACE_MODES.VERTEX);
  }

  function toggleCutMode() {
    setCurrentMode(getCurrentMode() === WORKSPACE_MODES.CUT ? WORKSPACE_MODES.SELECT : WORKSPACE_MODES.CUT);
  }

  function toggleVertexMode() {
    setCurrentMode(getCurrentMode() === WORKSPACE_MODES.VERTEX ? WORKSPACE_MODES.SELECT : WORKSPACE_MODES.VERTEX);
  }

  function ensureMeasureTraceState() {
    if (!Sim.measureTrace) {
      Sim.measureTrace = { tracing: false, points: [], segments: [], hover: null };
    }
    return Sim.measureTrace;
  }

  function resetMeasureTrace() {
    Sim.measureTrace = { tracing: false, points: [], segments: [], hover: null };
  }

  function canvasSegmentMeters(ax, ay, bx, by) {
    var cs = Sim.layout?.cellSize || 50;
    return (Math.hypot(bx - ax, by - ay) / cs) * 10;
  }

  function getMeasureTotalMeters(includePreview) {
    var trace = ensureMeasureTraceState();
    var total = trace.segments.reduce(function (sum, seg) { return sum + seg.lengthM; }, 0);
    if (includePreview && trace.tracing && trace.hover && trace.points.length >= 1) {
      var last = trace.points[trace.points.length - 1];
      total += canvasSegmentMeters(last.x, last.y, trace.hover.x, trace.hover.y);
    }
    return total;
  }

  function formatMeasureCoord(n) {
    return Number(n).toFixed(1);
  }

  function getMeasurePanelOverlayHost() {
    return document.getElementById('sim-workspace-overlays') ||
      document.getElementById('canvas-wrapper');
  }

  function ensureMeasurePanel() {
    var host = getMeasurePanelOverlayHost();
    if (!host) return null;
    var existing = document.getElementById('measure-panel');
    if (existing && (!existing.querySelector('#btn-measure-undo') || !existing.querySelector('.measure-panel__resize'))) {
      existing.remove();
      existing = null;
    }
    if (existing) {
      if (existing.parentNode !== host) {
        host.appendChild(existing);
      }
      return existing;
    }
    var panel = document.createElement('div');
    panel.id = 'measure-panel';
    panel.className = 'measure-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-labelledby', 'measure-panel-title');
    panel.setAttribute('aria-hidden', 'true');
    panel.innerHTML =
      '<div class="measure-panel__header">' +
        '<h3 id="measure-panel-title" class="measure-panel__title measure-panel__drag-handle">Measure</h3>' +
        '<div class="measure-panel__toolbar">' +
          '<button type="button" id="btn-measure-copy-top" class="measure-panel__btn measure-panel__btn--sm">Copy</button>' +
          '<button type="button" id="btn-measure-close-top" class="measure-panel__btn measure-panel__btn--sm measure-panel__btn--ghost">Close</button>' +
        '</div>' +
      '</div>' +
      '<div class="measure-panel__body">' +
        '<div class="measure-panel__table-wrap">' +
          '<table class="measure-panel__table">' +
            '<thead><tr><th>Seg</th><th>X, Y</th><th>Length</th></tr></thead>' +
            '<tbody id="measure-panel-segments"></tbody>' +
          '</table>' +
        '</div>' +
        '<p id="measure-panel-total-line" class="measure-panel__total-line">Total Distance: 0.00 m</p>' +
        '<div class="measure-panel__actions">' +
          '<button type="button" id="btn-measure-undo" class="measure-panel__btn" disabled>Undo (Back)</button>' +
          '<button type="button" id="btn-measure-close-bottom" class="measure-panel__btn measure-panel__btn--ghost">Close</button>' +
        '</div>' +
      '</div>';
    host.appendChild(panel);
    bindMeasurePanelDrag(panel);
    bindMeasurePanelResize(panel);
    bindMeasurePanelControls(panel);
    return panel;
  }

  function getMeasurePanelHostRect() {
    var wrap = document.getElementById('canvas-wrapper');
    if (!wrap) {
      return { left: 8, top: 8, width: window.innerWidth - 16, height: window.innerHeight - 16 };
    }
    var rect = wrap.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
  }

  function measurePanelOffsetRect(panel) {
    if (!panel) return { left: 0, top: 0, width: 0, height: 0 };
    var rect = panel.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
  }

  function clampMeasurePanelBox(left, top, width, height) {
    var host = getMeasurePanelHostRect();
    width = Math.max(MEASURE_PANEL_MIN_W, Math.min(width, host.width - 16));
    height = Math.max(MEASURE_PANEL_MIN_H, Math.min(height, host.height - 16));
    left = Math.max(host.left + 8, Math.min(left, host.left + host.width - width - 8));
    top = Math.max(host.top + 8, Math.min(top, host.top + host.height - height - 8));
    return { left: left, top: top, width: width, height: height };
  }

  function applyMeasurePanelBox(panel, box) {
    if (!panel || !box) return;
    panel.style.left = box.left + 'px';
    panel.style.top = box.top + 'px';
    panel.style.width = box.width + 'px';
    panel.style.height = box.height + 'px';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.maxHeight = 'none';
  }

  function ensureMeasurePanelWindowEvents() {
    if (measurePanelWindowEventsBound) return;
    measurePanelWindowEventsBound = true;
    document.addEventListener('pointermove', onMeasurePanelPointerMove);
    document.addEventListener('pointerup', onMeasurePanelPointerUp);
    document.addEventListener('pointercancel', onMeasurePanelPointerUp);
  }

  function onMeasurePanelPointerMove(e) {
    if (measurePanelResizeState) {
      onMeasurePanelResizeMove(e);
    } else if (measurePanelDragState) {
      onMeasurePanelDragMove(e);
    }
  }

  function onMeasurePanelPointerUp() {
    onMeasurePanelResizeEnd();
    onMeasurePanelDragEnd();
  }

  function onMeasurePanelDragMove(e) {
    if (!measurePanelDragState) return;
    var panel = measurePanelDragState.panel;
    if (!panel) return;
    var dx = e.clientX - measurePanelDragState.startX;
    var dy = e.clientY - measurePanelDragState.startY;
    var box = clampMeasurePanelBox(
      measurePanelDragState.origLeft + dx,
      measurePanelDragState.origTop + dy,
      measurePanelDragState.width,
      measurePanelDragState.height
    );
    applyMeasurePanelBox(panel, box);
  }

  function onMeasurePanelDragEnd() {
    if (!measurePanelDragState) return;
    if (measurePanelDragState.panel) {
      measurePanelDragState.panel.classList.remove('is-dragging');
    }
    measurePanelDragState = null;
  }

  function onMeasurePanelResizeMove(e) {
    if (!measurePanelResizeState) return;
    var panel = measurePanelResizeState.panel;
    if (!panel) return;
    var dx = e.clientX - measurePanelResizeState.startX;
    var dy = e.clientY - measurePanelResizeState.startY;
    var edges = measurePanelResizeState.edges;
    var left = measurePanelResizeState.origLeft;
    var top = measurePanelResizeState.origTop;
    var width = measurePanelResizeState.width;
    var height = measurePanelResizeState.height;

    if (edges.indexOf('e') >= 0) width = measurePanelResizeState.width + dx;
    if (edges.indexOf('s') >= 0) height = measurePanelResizeState.height + dy;
    if (edges.indexOf('w') >= 0) {
      width = measurePanelResizeState.width - dx;
      left = measurePanelResizeState.origLeft + (measurePanelResizeState.width - width);
    }
    if (edges.indexOf('n') >= 0) {
      height = measurePanelResizeState.height - dy;
      top = measurePanelResizeState.origTop + (measurePanelResizeState.height - height);
    }

    applyMeasurePanelBox(panel, clampMeasurePanelBox(left, top, width, height));
  }

  function onMeasurePanelResizeEnd() {
    if (!measurePanelResizeState) return;
    if (measurePanelResizeState.panel) {
      measurePanelResizeState.panel.classList.remove('is-resizing');
    }
    measurePanelResizeState = null;
  }

  function positionMeasurePanel(clientPt) {
    var panel = document.getElementById('measure-panel');
    if (!panel) return;
    var rect = measurePanelOffsetRect(panel);
    var width = rect.width || MEASURE_PANEL_MIN_W;
    var height = rect.height || 280;
    if (clientPt && typeof clientPt.clientX === 'number') {
      applyMeasurePanelBox(panel, clampMeasurePanelBox(
        clientPt.clientX + 14,
        clientPt.clientY + 14,
        width,
        height
      ));
      return;
    }
    var host = getMeasurePanelHostRect();
    applyMeasurePanelBox(panel, clampMeasurePanelBox(
      host.left + 12,
      host.top + 12,
      width,
      height
    ));
  }

  function showMeasurePanel() {
    var panel = ensureMeasurePanel();
    if (!panel) return;
    panel.classList.add('measure-panel--open');
    panel.setAttribute('aria-hidden', 'false');
  }

  function hideMeasurePanel() {
    var panel = document.getElementById('measure-panel');
    if (!panel) return;
    panel.classList.remove('measure-panel--open');
    panel.setAttribute('aria-hidden', 'true');
  }

  function updateMeasureTotalLive() {
    var totalLine = document.getElementById('measure-panel-total-line');
    if (!totalLine) return;
    totalLine.textContent = 'Total Distance: ' + getMeasureTotalMeters(true).toFixed(2) + ' m';
  }

  function renderMeasurePanel() {
    var tbody = document.getElementById('measure-panel-segments');
    if (!tbody) return;
    var trace = ensureMeasureTraceState();
    tbody.innerHTML = '';
    if (trace.points.length >= 1 && !trace.segments.length) {
      var anchor = trace.points[0];
      var anchorRow = document.createElement('tr');
      var aSeg = document.createElement('td');
      aSeg.textContent = '—';
      var aCoord = document.createElement('td');
      aCoord.className = 'measure-panel__coords';
      aCoord.textContent = formatMeasureCoord(anchor.x) + ', ' + formatMeasureCoord(anchor.y);
      var aLen = document.createElement('td');
      aLen.textContent = '—';
      anchorRow.appendChild(aSeg);
      anchorRow.appendChild(aCoord);
      anchorRow.appendChild(aLen);
      tbody.appendChild(anchorRow);
    }
    trace.segments.forEach(function (seg, idx) {
      var tr = document.createElement('tr');
      var tdSeg = document.createElement('td');
      tdSeg.textContent = String(idx + 1);
      var tdCoord = document.createElement('td');
      tdCoord.className = 'measure-panel__coords';
      tdCoord.textContent = formatMeasureCoord(seg.x) + ', ' + formatMeasureCoord(seg.y);
      var tdLen = document.createElement('td');
      tdLen.textContent = seg.lengthM.toFixed(2) + ' m';
      tr.appendChild(tdSeg);
      tr.appendChild(tdCoord);
      tr.appendChild(tdLen);
      tbody.appendChild(tr);
    });
    if (trace.tracing && trace.hover && trace.points.length >= 1) {
      var preview = document.createElement('tr');
      preview.className = 'measure-panel__row--preview';
      var pSeg = document.createElement('td');
      pSeg.textContent = String(trace.segments.length + 1);
      var pCoord = document.createElement('td');
      pCoord.className = 'measure-panel__coords';
      pCoord.textContent = formatMeasureCoord(trace.hover.x) + ', ' + formatMeasureCoord(trace.hover.y);
      var pLen = document.createElement('td');
      var last = trace.points[trace.points.length - 1];
      pLen.textContent = canvasSegmentMeters(last.x, last.y, trace.hover.x, trace.hover.y).toFixed(2) + ' m';
      preview.appendChild(pSeg);
      preview.appendChild(pCoord);
      preview.appendChild(pLen);
      tbody.appendChild(preview);
    }
    updateMeasureTotalLive();
    syncMeasurePanelActions();
  }

  function syncMeasurePanelActions() {
    var undoBtn = document.getElementById('btn-measure-undo');
    if (!undoBtn) return;
    var hasPoints = !!(Sim.measureTrace && Sim.measureTrace.points.length);
    undoBtn.disabled = !hasPoints;
  }

  function showMeasureCopiedFeedback(btn) {
    if (!btn) return;
    var original = btn.dataset.defaultLabel || btn.textContent;
    btn.dataset.defaultLabel = original;
    btn.textContent = 'Copied!';
    btn.classList.add('measure-panel__btn--copied');
    window.clearTimeout(btn._copyFeedbackTimer);
    btn._copyFeedbackTimer = window.setTimeout(function () {
      btn.textContent = btn.dataset.defaultLabel || original;
      btn.classList.remove('measure-panel__btn--copied');
    }, 1400);
  }

  function copyMeasureDistance(triggerBtn) {
    var text = getMeasureTotalMeters(false).toFixed(2) + ' m';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        showMeasureCopiedFeedback(triggerBtn || document.getElementById('btn-measure-copy-top'));
        updateStatus('Total distance copied');
      }).catch(function () {
        updateStatus('Copy failed', true);
      });
    } else {
      updateStatus('Clipboard unavailable', true);
    }
  }

  function undoMeasurePoint() {
    var trace = ensureMeasureTraceState();
    if (!trace.points.length) return;
    trace.points.pop();
    if (trace.segments.length) trace.segments.pop();
    if (!trace.points.length) {
      trace.tracing = false;
      trace.hover = null;
    } else {
      var last = trace.points[trace.points.length - 1];
      trace.hover = { x: last.x, y: last.y };
      trace.tracing = true;
    }
    renderMeasurePanel();
    renderGlobalDrawingLayer();
  }

  function bindMeasurePanelControls(panel) {
    if (panel.dataset.controlsBound) return;
    panel.dataset.controlsBound = '1';
    var copyTop = panel.querySelector('#btn-measure-copy-top');
    var closeTop = panel.querySelector('#btn-measure-close-top');
    var undoBtn = panel.querySelector('#btn-measure-undo');
    var closeBottom = panel.querySelector('#btn-measure-close-bottom');
    if (copyTop) {
      copyTop.addEventListener('click', function (e) {
        e.stopPropagation();
        copyMeasureDistance(copyTop);
      });
    }
    if (closeTop) {
      closeTop.addEventListener('click', function (e) {
        e.stopPropagation();
        cancelMeasureMode();
      });
    }
    if (undoBtn) {
      undoBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        undoMeasurePoint();
      });
    }
    if (closeBottom) {
      closeBottom.addEventListener('click', function (e) {
        e.stopPropagation();
        cancelMeasureMode();
      });
    }
  }

  function bindMeasurePanelDrag(panel) {
    var header = panel.querySelector('.measure-panel__header');
    if (!header || header.dataset.dragBound) return;
    header.dataset.dragBound = '1';
    ensureMeasurePanelWindowEvents();
    header.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      if (e.target.closest('button, select, input, a')) return;
      if (measurePanelResizeState) return;
      var rect = measurePanelOffsetRect(panel);
      measurePanelDragState = {
        panel: panel,
        startX: e.clientX,
        startY: e.clientY,
        origLeft: rect.left,
        origTop: rect.top,
        width: rect.width,
        height: rect.height,
      };
      panel.classList.add('is-dragging');
      header.setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    });
  }

  function bindMeasurePanelResize(panel) {
    if (!panel || panel.dataset.resizeBound) return;
    panel.dataset.resizeBound = '1';
    ensureMeasurePanelWindowEvents();
    var handles = [
      { cls: 'measure-panel__resize measure-panel__resize--n', edges: 'n' },
      { cls: 'measure-panel__resize measure-panel__resize--s', edges: 's' },
      { cls: 'measure-panel__resize measure-panel__resize--e', edges: 'e' },
      { cls: 'measure-panel__resize measure-panel__resize--w', edges: 'w' },
      { cls: 'measure-panel__resize measure-panel__resize--ne', edges: 'ne' },
      { cls: 'measure-panel__resize measure-panel__resize--nw', edges: 'nw' },
      { cls: 'measure-panel__resize measure-panel__resize--se', edges: 'se' },
      { cls: 'measure-panel__resize measure-panel__resize--sw', edges: 'sw' },
    ];
    handles.forEach(function (h) {
      var el = document.createElement('div');
      el.className = h.cls;
      el.setAttribute('data-resize-edges', h.edges);
      el.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        if (measurePanelDragState) return;
        var rect = measurePanelOffsetRect(panel);
        measurePanelResizeState = {
          panel: panel,
          edges: h.edges,
          startX: e.clientX,
          startY: e.clientY,
          origLeft: rect.left,
          origTop: rect.top,
          width: rect.width,
          height: rect.height,
        };
        panel.classList.add('is-resizing');
        el.setPointerCapture(e.pointerId);
        e.preventDefault();
        e.stopPropagation();
      });
      panel.appendChild(el);
    });
  }

  function cancelMeasureMode() {
    resetMeasureTrace();
    hideMeasurePanel();
    renderGlobalDrawingLayer();
    if (getCurrentMode() === WORKSPACE_MODES.MEASURE) {
      enablePanMode();
    }
    syncGisToolbarActiveStates();
  }

  function requestMeasureRedraw() {
    if (measureRedrawPending) return;
    measureRedrawPending = true;
    requestAnimationFrame(function () {
      measureRedrawPending = false;
      if (getCurrentMode() !== WORKSPACE_MODES.MEASURE) return;
      updateMeasureTotalLive();
      renderMeasurePanel();
      renderGlobalDrawingLayer();
    });
  }

  function onMeasurePointerDown(e) {
    if (getCurrentMode() !== WORKSPACE_MODES.MEASURE) return;
    if (e.button !== 0) return;
    if (Sim.ui?.spacePanActive || Sim.isPanning) return;
    if (e.target.closest('.measure-panel') || e.target.closest('button') ||
        e.target.closest('.grid-controls') || e.target.closest('.map-tool-bar')) return;
    var trace = ensureMeasureTraceState();
    var xy = pointerClientToCanvasXY(e.clientX, e.clientY);
    if (!xy) return;
    var prev = trace.points.length ? trace.points[trace.points.length - 1] : null;
    if (prev) {
      trace.segments.push({
        lengthM: canvasSegmentMeters(prev.x, prev.y, xy.x, xy.y),
        x: xy.x,
        y: xy.y,
      });
    }
    trace.points.push({ x: xy.x, y: xy.y });
    trace.tracing = true;
    trace.hover = { x: xy.x, y: xy.y };
    e.preventDefault();
    e.stopPropagation();
    renderMeasurePanel();
    renderGlobalDrawingLayer();
  }

  function onMeasurePointerMove(e) {
    if (getCurrentMode() !== WORKSPACE_MODES.MEASURE) return;
    var trace = ensureMeasureTraceState();
    var xy = pointerClientToCanvasXY(e.clientX, e.clientY);
    if (!xy) return;
    if (trace.points.length >= 1) {
      trace.hover = xy;
      trace.tracing = true;
      requestMeasureRedraw();
    } else {
      updateMeasureTotalLive();
    }
  }

  function onMeasureContextMenu(e) {
    if (getCurrentMode() !== WORKSPACE_MODES.MEASURE) return;
    e.preventDefault();
    e.stopPropagation();
  }

  function bindMeasureModeEvents() {
    if (Sim.ui.measureModeBound) return;
    var wrap = document.getElementById('canvas-wrapper');
    if (!wrap) return;
    Sim.ui.measureModeBound = true;
    wrap.addEventListener('pointerdown', onMeasurePointerDown, true);
    wrap.addEventListener('contextmenu', onMeasureContextMenu, true);
  }

  function enableMeasureMode() {
    setCurrentMode(WORKSPACE_MODES.MEASURE);
  }

  function toggleMeasureMode() {
    if (getCurrentMode() === WORKSPACE_MODES.MEASURE) {
      cancelMeasureMode();
    } else {
      enableMeasureMode();
    }
  }

  function renderMeasureOverlay(svg) {
    if (!svg || getCurrentMode() !== WORKSPACE_MODES.MEASURE) return;
    var trace = Sim.measureTrace;
    if (!trace || !trace.points.length) return;
    var ns = 'http://www.w3.org/2000/svg';
    var group = document.createElementNS(ns, 'g');
    group.setAttribute('class', 'measure-overlay');
    group.setAttribute('pointer-events', 'none');

    if (trace.points.length >= 2) {
      var d = trace.points.map(function (p, i) {
        return (i === 0 ? 'M' : 'L') + p.x + ' ' + p.y;
      }).join(' ');
      var committed = document.createElementNS(ns, 'path');
      committed.setAttribute('d', d);
      committed.setAttribute('class', 'measure-overlay__path measure-overlay__path--committed');
      committed.setAttribute('fill', 'none');
      committed.setAttribute('stroke', '#f8fafc');
      committed.setAttribute('stroke-width', '2');
      committed.setAttribute('vector-effect', 'non-scaling-stroke');
      committed.setAttribute('stroke-linecap', 'round');
      committed.setAttribute('stroke-linejoin', 'round');
      committed.setAttribute('opacity', '0.95');
      group.appendChild(committed);
    }

    if (trace.tracing && trace.hover && trace.points.length >= 1) {
      var last = trace.points[trace.points.length - 1];
      var preview = document.createElementNS(ns, 'line');
      preview.setAttribute('class', 'measure-overlay__shadow');
      preview.setAttribute('x1', String(last.x));
      preview.setAttribute('y1', String(last.y));
      preview.setAttribute('x2', String(trace.hover.x));
      preview.setAttribute('y2', String(trace.hover.y));
      preview.setAttribute('stroke', MEASURE_OVERLAY_COLOR);
      preview.setAttribute('stroke-width', '2');
      preview.setAttribute('stroke-dasharray', MEASURE_OVERLAY_DASH);
      preview.setAttribute('vector-effect', 'non-scaling-stroke');
      preview.setAttribute('stroke-linecap', 'round');
      preview.setAttribute('opacity', '0.9');
      group.appendChild(preview);
    }

    trace.points.forEach(function (p, idx) {
      var dot = document.createElementNS(ns, 'circle');
      dot.setAttribute('class', 'measure-overlay__vertex');
      dot.setAttribute('cx', String(p.x));
      dot.setAttribute('cy', String(p.y));
      dot.setAttribute('r', idx === 0 ? '4.5' : '3.5');
      dot.setAttribute('fill', idx === 0 ? '#f8fafc' : MEASURE_OVERLAY_COLOR);
      dot.setAttribute('stroke', '#0f172a');
      dot.setAttribute('stroke-width', '1.25');
      dot.setAttribute('vector-effect', 'non-scaling-stroke');
      group.appendChild(dot);
    });

    svg.appendChild(group);
  }

  function pickPathForVertexEdit(e) {
    var editor = global.FTTHPathwayEditor;
    if (!editor || !e) return null;
    var xy = pointerClientToCanvasXY(e.clientX, e.clientY);
    if (!xy) return null;
    var tol = editor.PATH_HIT_TOLERANCE || 14;
    if (editor.pickPathHitAtPoint) {
      var precise = editor.pickPathHitAtPoint(xy.x, xy.y, tol);
      if (precise) return precise;
    }
    return editor.hitTestPaths?.(xy.x, xy.y) || null;
  }

  function activateVertexPathEdit(pathType, pathId, segIndex) {
    if (!pathType || !pathId) return false;
    Sim.currentMode = WORKSPACE_MODES.VERTEX;
    if (!Sim.pathEdit) Sim.pathEdit = { drag: null, context: null };
    Sim.pathEdit.vertexToolActive = true;
    Sim.pathEdit.splitToolActive = false;
    Sim.pathEdit.editActive = true;
    Sim.pathEdit.editingPathId = { type: pathType, id: pathId };
    if (Sim.pathEdit.selectedVertexIndex == null) Sim.pathEdit.selectedVertexIndex = 0;
    Sim.activeCanvasTool = 'vertex';
    Sim.interactionMode = 'select';
    Sim.currentTool = 'select';
    selectPath(pathType, pathId, false, { segIndex: segIndex != null ? segIndex : null });
    renderGlobalDrawingLayer();
    syncDrawingLayerInteraction();
    syncGisToolbarActiveStates();
    global.FTTHDrawingEngine?.syncMapInteractionCursor?.();
    updateStatus('Vertex Tool — drag handles to edit path');
    return true;
  }

  function onWorkspaceModePointerDown(e) {
    if (e.button !== 0) return;
    if (Sim.ui?.spacePanActive || Sim.isPanning) return;
    if (e.target.closest('.grid-controls') || e.target.closest('.map-tool-bar') ||
        e.target.closest('button') || e.target.closest('select')) return;

    var mode = getCurrentMode();
    if (mode === WORKSPACE_MODES.MEASURE) return;
    if (mode === WORKSPACE_MODES.CUT) {
      if (global.FTTHDrawingEngine?.routePointerDown?.(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    if (mode === WORKSPACE_MODES.VERTEX) {
      var handled = !!(global.FTTHDrawingEngine?.routeVertexPointerDown?.(e));
      if (!handled) {
        var pick = pickPathForVertexEdit(e);
        if (pick) handled = activateVertexPathEdit(pick.type, pick.id, pick.segIndex);
      }
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
  }

  function onWorkspaceModePointerMove(e) {
    if (Sim.isPanning && isTemporaryPanOverrideActive()) return;
    var mode = getCurrentMode();
    if (mode === WORKSPACE_MODES.CUT || mode === WORKSPACE_MODES.VERTEX) {
      global.FTTHDrawingEngine?.routePointerMove?.(e);
    }
  }

  function bindWorkspaceModeEvents() {
    if (Sim.ui.workspaceModeBound) return;
    var wrap = document.getElementById('canvas-wrapper');
    if (!wrap) return;
    Sim.ui.workspaceModeBound = true;
    wrap.addEventListener('pointerdown', onWorkspaceModePointerDown, true);
    wrap.addEventListener('pointermove', onWorkspaceModePointerMove, false);
    bindMeasureModeEvents();
  }

  function isMapNavigationLocked() {
    if (isTemporaryPanOverrideActive()) return false;
    return false;
  }

  function resetMapPointerState(opts) {
    opts = opts || {};
    Sim.isPanning = false;
    Sim.panSession = null;
    if (Sim.ui) Sim.ui.handPathPick = null;
    var wrap = document.getElementById('canvas-wrapper');
    if (wrap) wrap.classList.remove('is-panning');

    if (Sim.pathEdit) {
      if (!opts.keepCutSwipe) {
        Sim.pathEdit.cutSwipe = null;
        Sim.pathEdit.cutHover = null;
      }
      if (!opts.keepVertexDrag) {
        global.FTTHDrawingEngine?.resetAllGhostState?.({ keepCrosshair: !!opts.keepCrosshair });
        Sim.pathEdit.insertHover = null;
      }
    }

    syncCutTargetCursor();
    syncDrawingLayerInteraction();
  }

  function canVertexEdit() {
    if (getCurrentMode() === WORKSPACE_MODES.VERTEX || !!Sim.pathEdit?.vertexToolActive) return true;
    if (canPenDraw() && Sim.penDraft?.points?.length >= 1) return true;
    return false;
  }

  function isVertexEditToolBlockingNode(e) {
    if (getActiveCanvasTool() === 'vertex' || getActiveCanvasTool() === 'cut') return true;
    if (Sim.pathEdit?.editActive || Sim.pathEdit?.vertexToolActive || Sim.pathEdit?.splitToolActive) return true;
    if (canPenDraw() && Sim.pen && Sim.pen.lineMode !== 'cable') return true;
    if (canPenDraw() && Sim.pen && Sim.pen.lineMode === 'cable') return false;
    if (e && global.FTTHDrawingEngine?.isGhostSessionActive?.()) return true;
    return false;
  }

  function getActiveCanvasTool() {
    var mode = getCurrentMode();
    if (mode === WORKSPACE_MODES.MEASURE) return 'measure';
    if (mode === WORKSPACE_MODES.CUT || Sim.pathEdit?.splitToolActive) return 'cut';
    if (mode === WORKSPACE_MODES.VERTEX || Sim.pathEdit?.vertexToolActive) return 'vertex';
    return Sim.activeCanvasTool || 'select';
  }

  function setActiveCanvasTool(tool) {
    if (tool === 'cut') enableCutMode();
    else if (tool === 'vertex') enableVertexMode();
    else enableSelectMode();
  }

  function syncGisToolbarActiveStates() {
    var cutBtn = document.getElementById('btn-toolbar-cut');
    var vtxBtn = document.getElementById('btn-toolbar-vertex');
    var measureBtn = document.getElementById('btn-toolbar-measure');
    var handBtn = document.getElementById('tool-hand');
    var selectBtn = document.getElementById('tool-select');
    var activeTool = getActiveCanvasTool();
    var cutActive = getCurrentMode() === WORKSPACE_MODES.CUT || activeTool === 'cut';
    var vtxActive = getCurrentMode() === WORKSPACE_MODES.VERTEX || activeTool === 'vertex';
    var measureActive = getCurrentMode() === WORKSPACE_MODES.MEASURE || activeTool === 'measure';
    var navExclusive = !cutActive && !vtxActive && !measureActive;

    if (cutBtn) cutBtn.classList.toggle('tool-selected', cutActive);
    if (vtxBtn) vtxBtn.classList.toggle('tool-selected', vtxActive);
    if (measureBtn) measureBtn.classList.toggle('tool-selected', measureActive);
    if (handBtn) {
      handBtn.classList.toggle('tool-selected', navExclusive && Sim.interactionMode === 'hand');
    }
    if (selectBtn) {
      selectBtn.classList.toggle('tool-selected', navExclusive && Sim.interactionMode !== 'hand');
    }

    // SYNC THE MOVE TOGGLE STATE
    var moveBtn = document.getElementById('btn-toolbar-move-node');
    var isMoveOn = !!(Sim.ui && Sim.ui.clickToMoveActive);
    if (moveBtn) {
      moveBtn.classList.toggle('tool-selected', isMoveOn);
    }
  }

  function ensureToolbarEditMode() {
    if (!Sim.ui.sidebarEditMode) Sim.ui.sidebarEditMode = true;
    if (Sim.selectedPath) {
      focusPathEditTarget(Sim.selectedPath.type, Sim.selectedPath.id);
    }
  }

  function runToolbarMeasure() {
    toggleMeasureMode();
  }

  function runToolbarDelete() {
    if (Sim.selectedPath) {
      ensureToolbarEditMode();
      handleSidebarAction('delete', Sim.selectedPath.type, Sim.selectedPath.id);
    } else if (Sim.selectedNodeId) {
      ensureToolbarEditMode();
      handleSidebarAction('delete-node', null, null, Sim.selectedNodeId);
    } else {
      updateStatus('Delete — select an item first', true);
    }
    syncGisToolbarActiveStates();
  }

  function runToolbarCut() {
    toggleCutMode();
  }

  function runToolbarVertex() {
    toggleVertexMode();
  }

  function buildToolbarNodeClipboardSnapshot(node) {
    if (!node) return null;
    return {
      type: node.type,
      col: node.col,
      row: node.row,
      variant: node.variant,
      hasClosure: !!node.hasClosure,
      hasFatPole: !!node.hasFatPole,
      fatSystemName: node.fatSystemName || null,
      fatSplitter: node.fatSplitter ? JSON.parse(JSON.stringify(node.fatSplitter)) : null,
      labelOffsets: node.labelOffsets ? JSON.parse(JSON.stringify(node.labelOffsets)) : {},
    };
  }

  function buildToolbarPathClipboardSnapshot(path, pathType) {
    if (!path || !path.points || path.points.length < 2) return null;
    return {
      pathType: pathType,
      data: {
        type: path.type,
        kind: path.kind,
        capacity: path.capacity,
        batch: path.batch,
        name: path.name,
        trenchPathId: path.trenchPathId || path.hostTrenchId || null,
        hostTrenchId: path.hostTrenchId || path.trenchPathId || null,
        trenchPathIds: path.trenchPathIds ? path.trenchPathIds.slice() : [],
        points: clonePathPointArray(path.points),
        cornerRadii: JSON.parse(JSON.stringify(path.cornerRadii || {})),
        userDrawn: path.userDrawn,
        mergedToTrench: path.mergedToTrench,
      },
    };
  }

  function getToolbarPasteCanvasXY() {
    if (Sim.ui.lastCanvasPointer) return Sim.ui.lastCanvasPointer;
    var ptr = Sim.ui.lastDragOverPointer;
    if (ptr) return pointerClientToCanvasXY(ptr.clientX, ptr.clientY);
    var wrap = document.getElementById('canvas-wrapper');
    if (!wrap) {
      var cs = Sim.layout?.cellSize || 50;
      return { x: cs * 2, y: cs * 2 };
    }
    var rect = wrap.getBoundingClientRect();
    return pointerClientToCanvasXY(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  function pathPointsCentroid(points) {
    if (!points || !points.length) return { x: 0, y: 0 };
    var cx = 0;
    var cy = 0;
    points.forEach(function (p) {
      cx += p[0];
      cy += p[1];
    });
    return { x: cx / points.length, y: cy / points.length };
  }

  function offsetPathPoints(points, dx, dy) {
    return points.map(function (p) { return [p[0] + dx, p[1] + dy]; });
  }

  function pasteToolbarNodeFromClipboard(clip, targetXY) {
    var cell = workspaceXYToCell(targetXY.x, targetXY.y);
    if (getNodeAt(cell.col, cell.row)) {
      updateStatus('Paste blocked — cell occupied', true);
      return false;
    }
    var snap = clip.data;
    Sim.nodeId++;
    var node = {
      id: 'n' + Sim.nodeId,
      type: snap.type,
      col: cell.col,
      row: cell.row,
      locked: false,
    };
    if (snap.variant) node.variant = snap.variant;
    if (snap.type === 'handhole') node.hasClosure = !!snap.hasClosure;
    if (snap.type === 'fat_handhole') {
      node.hasFatPole = !!snap.hasFatPole;
      node.hasClosure = !!snap.hasClosure;
      node.fatSystemName = snap.fatSystemName;
      node.fatSplitter = snap.fatSplitter ? JSON.parse(JSON.stringify(snap.fatSplitter)) : null;
    }
    if (snap.type === 'fdt' && snap.fatSplitter) {
      node.fatSplitter = JSON.parse(JSON.stringify(snap.fatSplitter));
    }
    node.labelOffsets = snap.labelOffsets ? JSON.parse(JSON.stringify(snap.labelOffsets)) : {};
    snapNodeToCell(node);
    if (snap.type !== 'fdt' && snap.type !== 'olt') ensureNodeOwnerFdt(node);
    assignAutoName(snap.type, node);
    Sim.nodes.push(node);
    /* Bootstrap Active FDT only when none is set — never steal focus from a locked cabinet. */
    if (snap.type === 'fdt' && !getActiveFdtId()) {
      setActiveFdt(node, { bootstrap: true, force: true });
    }
    renderNode(node);
    selectNode(node.id);
    rememberLastInstalledElement(getNodeAutoLabel(node) || node.autoName || node.type);
    updateMetrics();
    return true;
  }

  function pasteToolbarPathFromClipboard(clip, targetXY) {
    var src = clip.data;
    if (!src.points || src.points.length < 2) {
      updateStatus('Paste failed — invalid path data', true);
      return false;
    }
    var centroid = pathPointsCentroid(src.points);
    var dx = targetXY.x - centroid.x;
    var dy = targetXY.y - centroid.y;
    var newPoints = offsetPathPoints(src.points, dx, dy);
    var newPath;
    if (clip.pathType === 'excavation') {
      Sim.excavationPathId++;
      newPath = {
        id: 'excavation_' + Sim.excavationPathId,
        type: src.type || 'LM_Excavation',
        kind: src.kind || 'direct_buried',
        points: newPoints,
        cornerRadii: JSON.parse(JSON.stringify(src.cornerRadii || {})),
        connectedTo: { start: null, end: null },
        freeEnds: { start: true, end: true },
        cableIds: [],
      };
      normalizeExcavationPath(newPath);
      Sim.excavationPaths.push(newPath);
      selectPath('excavation', newPath.id);
    } else {
      Sim.fiberCablePathId++;
      var newId = 'cable_path_' + Sim.fiberCablePathId;
      var cableCapacity = src.capacity || getCableCapacityForKind(src.kind) || 12;
      var toolboxLabel = assignCableAsBuiltLabel({
        kind: src.kind,
        capacity: cableCapacity,
      });
      var cableBatch = parseLabeledNumericId(toolboxLabel, new RegExp('^' + cableCapacity + 'F(\\d+)$', 'i')) || 1;
      if (!Sim.counters.cableByCapacity[cableCapacity]) Sim.counters.cableByCapacity[cableCapacity] = 0;
      Sim.counters.cableByCapacity[cableCapacity] = Math.max(Sim.counters.cableByCapacity[cableCapacity], cableBatch);
      newPath = {
        id: newId,
        type: 'Fiber_Cable',
        kind: src.kind,
        capacity: cableCapacity,
        batch: cableBatch,
        name: toolboxLabel,
        asBuiltId: toolboxLabel,
        trenchPathId: src.trenchPathId,
        hostTrenchId: src.hostTrenchId,
        trenchPathIds: src.trenchPathIds ? src.trenchPathIds.slice() : [],
        points: newPoints,
        cornerRadii: JSON.parse(JSON.stringify(src.cornerRadii || {})),
        connectedTo: { start: null, end: null },
        freeEnds: { start: true, end: true },
        userDrawn: src.userDrawn !== false,
        mergedToTrench: false,
        pointSnapNodeIds: [],
        snapLabels: [],
      };
      Sim.fiberCablePaths.push(newPath);
      selectPath('fiber', newId);
    }
    notifyNetworkTopologyChanged();
    return true;
  }

  function runToolbarCopy() {
    if (Sim.selectedNodeId) {
      var node = findNode(Sim.selectedNodeId);
      if (!node) {
        updateStatus('Copy failed — node not found', true);
        return;
      }
      Sim.ui.toolbarClipboard = {
        kind: 'node',
        data: buildToolbarNodeClipboardSnapshot(node),
      };
      updateStatus('Copied ' + (getNodeAutoLabel(node) || node.type));
      return;
    }
    if (Sim.selectedPath) {
      var path = findPathByRef(Sim.selectedPath);
      if (!path) {
        updateStatus('Copy failed — path not found', true);
        return;
      }
      Sim.ui.toolbarClipboard = buildToolbarPathClipboardSnapshot(path, Sim.selectedPath.type);
      updateStatus('Copied path');
      return;
    }
    updateStatus('Copy — select an object first', true);
  }

  function runToolbarPaste() {
    var clip = Sim.ui.toolbarClipboard;
    if (!clip || !clip.data) {
      updateStatus('Nothing to paste — copy an object first', true);
      return;
    }
    var targetXY = getToolbarPasteCanvasXY();
    var ok = false;
    if (clip.kind === 'node') {
      ok = pasteToolbarNodeFromClipboard(clip, targetXY);
    } else if (clip.pathType) {
      ok = pasteToolbarPathFromClipboard(clip, targetXY);
    }
    if (ok) {
      if (clip.kind === 'node') saveState();
      updateStatus('Pasted at cursor');
    }
  }

  function bindGisToolbarControls() {
    if (Sim.ui.gisToolbarBound) return;
    Sim.ui.gisToolbarBound = true;

    var wrap = document.getElementById('canvas-wrapper');
    if (wrap && !Sim.ui.canvasPointerTrackBound) {
      Sim.ui.canvasPointerTrackBound = true;
      wrap.addEventListener('pointermove', function (e) {
        Sim.ui.lastCanvasPointer = pointerClientToCanvasXY(e.clientX, e.clientY);
        Sim.ui.lastCanvasClient = { clientX: e.clientX, clientY: e.clientY };
        if (getCurrentMode() === WORKSPACE_MODES.MEASURE) {
          onMeasurePointerMove(e);
        }
      });
    }

    var measureBtn = document.getElementById('btn-toolbar-measure');
    var copyBtn = document.getElementById('btn-toolbar-copy');
    var pasteBtn = document.getElementById('btn-toolbar-paste');
    var deleteBtn = document.getElementById('btn-toolbar-delete');
    var cutBtn = document.getElementById('btn-toolbar-cut');
    var vertexBtn = document.getElementById('btn-toolbar-vertex');
    var moveNodeBtn = document.getElementById('btn-toolbar-move-node');

    if (measureBtn) {
      measureBtn.addEventListener('click', function () {
        runToolbarMeasure();
      });
    }
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        runToolbarCopy();
      });
    }
    if (pasteBtn) {
      pasteBtn.addEventListener('click', function () {
        runToolbarPaste();
      });
    }
    if (deleteBtn) {
      deleteBtn.addEventListener('click', function () {
        runToolbarDelete();
      });
    }
    if (cutBtn) {
      cutBtn.addEventListener('click', function () {
        runToolbarCut();
      });
    }
    if (vertexBtn) {
      vertexBtn.addEventListener('click', function () {
        runToolbarVertex();
      });
    }
    if (moveNodeBtn) {
      document.getElementById('btn-toolbar-move-node').addEventListener('click', function () {
        var isActive = !(Sim.ui && Sim.ui.clickToMoveActive);
        Sim.ui.clickToMoveActive = isActive;
        var canvasWrapper = document.getElementById('canvas-wrapper');
        if (isActive) {
          if (canvasWrapper) canvasWrapper.classList.add('click-to-move-active');
          updateStatus('Move Mode ON', true);
        } else {
          if (canvasWrapper) canvasWrapper.classList.remove('click-to-move-active');
          Sim.moveNodeId = null;
          updateStatus('Move Mode OFF');
        }
        if (typeof syncGisToolbarActiveStates === 'function') {
          syncGisToolbarActiveStates();
        }
        if (typeof renderAllNodes === 'function') renderAllNodes();
      });
    }
    syncGisToolbarActiveStates();
  }

  function syncVertexPanelLayout() {
    /* vertex controls in unified sidebar */
  }

  function syncVertexControlBar() {
    syncVertexControlBarContent();
    renderUnifiedSidebar();
  }

  function syncVertexControlBarContent() {
    /* vertex bottom panel removed — canvas-only interaction */
  }

  function syncCutTargetCursor() {
    var wrap = document.getElementById('canvas-wrapper');
    if (!wrap) return;
    var cutActive = getActiveCanvasTool() === 'cut';
    wrap.classList.toggle('canvas-tool-cut-target', cutActive && !!Sim.pathEdit?.cutHover);
  }

  function isDrawingLayerInteractive() {
    var tool = getActiveCanvasTool();
    if (tool === 'measure' || tool === 'vertex' || tool === 'cut') return true;
    if (Sim.selectedPath && (Sim.pathEdit?.editActive || Sim.pathEdit?.splitToolActive)) return true;
    if (Sim.pathEdit?.vertexToolActive) return true;
    if (canPenDraw()) return true;
    if (Sim.selectedPath) return true;
    if ((Sim.interactionMode === 'select' || Sim.interactionMode === 'hand') &&
        !Sim.selectedTool && !Sim.selectedCableSpec && !Sim.moveNodeId) return true;
    if (isPenToolSelected() && !Sim.pen.lineMode) return false;
    return false;
  }

  function syncDrawingLayerInteraction() {
    var wrap = document.getElementById('canvas-wrapper');
    var canvas = getDrawingCanvas();
    var svg = getGlobalDrawingLayer();
    var active = isDrawingLayerInteractive();
    var draggingVtx = !!(Sim.pathEdit && Sim.pathEdit.isDraggingVertex);
    var canvasTool = getActiveCanvasTool();
    if (wrap) {
      wrap.classList.toggle('drawing-layer-interactive', active);
      wrap.classList.toggle('path-edit-active', !!(Sim.selectedPath && !canPenDraw()));
      wrap.classList.toggle('path-vertex-dragging', draggingVtx);
      wrap.classList.toggle('canvas-tool-vertex', canvasTool === 'vertex');
      wrap.classList.toggle('canvas-tool-map-locked', isMapNavigationLocked());
      var crosshairAllowed = global.FTTHDrawingEngine?.isCrosshairOverMap?.() === true;
      var showCrosshair = crosshairAllowed &&
        canvasTool !== 'measure' &&
        (canPenDraw() || canvasTool === 'vertex' ||
          (canvasTool !== 'vertex' && Sim.interactionMode !== 'hand'));
      wrap.classList.toggle('canvas-tool-crosshair', showCrosshair);
      wrap.classList.toggle('canvas-tool-vertex-hand', false);
      wrap.classList.toggle('canvas-tool-cut', canvasTool === 'cut');
      wrap.classList.toggle('canvas-tool-measure', canvasTool === 'measure');
      wrap.classList.toggle('canvas-tool-select', canvasTool === 'select');
      wrap.classList.toggle('canvas-tool-cut-target', canvasTool === 'cut' && !!Sim.pathEdit?.cutHover);
    }
    if (canvas) canvas.classList.toggle('drawing-layer-interactive', active);
    if (svg) svg.classList.toggle('drawing-layer-interactive', active);
    global.FTTHDrawingEngine?.syncMapInteractionCursor?.();
  }

  function peekBelowDrawingLayer(clientX, clientY) {
    var svg = getGlobalDrawingLayer();
    if (!svg) return null;
    var prev = svg.style.pointerEvents;
    svg.style.pointerEvents = 'none';
    var el = document.elementFromPoint(clientX, clientY);
    svg.style.pointerEvents = prev;
    return el;
  }

  function refreshPenLineUi() {
    document.querySelectorAll('.pen-line-option--active').forEach(function (el) {
      el.classList.remove('pen-line-option--active');
    });
    if (!Sim.pen.selectedLineId) return;
    var active = document.querySelector('.pen-line-option[data-line-id="' + Sim.pen.selectedLineId + '"]');
    if (active) active.classList.add('pen-line-option--active');
  }

  function selectPenTool(box, opts) {
    opts = opts || {};
    Sim.selectedTool = PEN_TOOL_ID;
    Sim.selectedCableSpec = null;
    Sim.selectedSplitterVariant = null;
    Sim.cableDraftFrom = null;
    if (Sim.ui) Sim.ui.toolboxLockMode = !!opts.lockMode;
    setInteractionMode('select');
    syncPenModeClass();
    if (!Sim.pen.lineMode) {
      updateStatus('Pen Tool — pick Direct Buried or a cable type below');
    } else {
      updateStatus('Pen ready — click street/sidewalk · snap 15px · dbl-click finish · Esc cancel');
    }
    global.FTTHUiController?.onToolSelected?.({ lockMode: !!opts.lockMode });
  }

  function armPenExcavation(tool, box, opts) {
    opts = opts || {};
    Sim.pen.lineMode = 'excavation';
    Sim.pen.excavKind = tool.routeKind;
    Sim.pen.selectedLineId = tool.id;
    Sim.penDraft = null;
    Sim.selectedPath = null;
    Sim.selectedTool = PEN_TOOL_ID;
    Sim.selectedCableSpec = null;
    Sim.selectedSplitterVariant = null;
    if (Sim.ui) Sim.ui.toolboxLockMode = !!opts.lockMode;
    if (box) {
      clearToolboxSelection(box);
      var penEl = box.querySelector('[data-type="' + PEN_TOOL_ID + '"]');
      if (penEl) penEl.classList.add('toolbox-item--selected');
    }
    setInteractionMode('select');
    syncPenModeClass();
    updateStatus('Pen · ' + tool.label + ' — click street or sidewalk to draw');
    global.FTTHUiController?.onToolSelected?.({ lockMode: !!opts.lockMode });
  }

  function armPenCable(grp, capacity, box, rowEl, opts) {
    opts = opts || {};
    ensureCableConfig();
    setActiveCableKind(grp.kind);
    var cfg = Sim.ui.cableConfig[getCableConfigKey(grp.kind)];
    cfg.capacity = capacity;
    if (!Sim.ui.cableCapacity) Sim.ui.cableCapacity = {};
    Sim.ui.cableCapacity[grp.kind] = capacity;
    Sim.pen.lineMode = 'cable';
    Sim.pen.cableGroupId = grp.id;
    Sim.pen.cableCapacity = capacity;
    Sim.pen.cableKind = grp.kind;
    Sim.pen.selectedLineId = cableIdForKind(grp.kind, capacity);
    /* Preserve in-progress draft batch/capacity when re-arming the same cable kind. */
    if (Sim.penDraft && Sim.penDraft.lineMode === 'cable' &&
        getCableConfigKey(Sim.penDraft.kind) === getCableConfigKey(grp.kind) &&
        Sim.penDraft.points && Sim.penDraft.points.length &&
        !Sim.penDraft.continueFromCable) {
      syncPenDraftCableFromToolbox(Sim.penDraft);
    } else if (!(Sim.penDraft && Sim.penDraft.continueFromCable)) {
      Sim.penDraft = null;
    }
    Sim.selectedPath = null;
    Sim.selectedTool = PEN_TOOL_ID;
    Sim.selectedCableSpec = null;
    Sim.selectedSplitterVariant = null;
    if (Sim.ui) Sim.ui.toolboxLockMode = !!opts.lockMode;
    if (box) {
      clearToolboxSelection(box);
      var penEl = box.querySelector('[data-type="' + PEN_TOOL_ID + '"]');
      if (penEl) penEl.classList.add('toolbox-item--selected');
      var accordionWrap = box.querySelector('[data-category-id="cable_' + grp.id + '"]');
      if (accordionWrap) {
        accordionWrap.classList.remove('toolbox-category--collapsed');
        Sim.ui.cableCategoryCollapsed[grp.id] = false;
        var header = accordionWrap.querySelector('.cable-accordion-header');
        if (header) header.classList.add('cable-accordion-header--armed');
      }
      if (rowEl && rowEl.classList.contains('cable-config-panel')) {
        rowEl.classList.add('toolbox-item--selected');
      }
      refreshCableConfiguratorLabels(box);
    }
    refreshBatchDuplicationHint(grp.kind);
    syncPenModeClass();
    lockActiveCableBatchPreference();
    syncActiveCableBatchToEngines(grp.kind);
    var label = getCableLabelForKind(grp.kind);
    updateStatus('Pen · ' + grp.label + ' · ' + label + ' — draw only over existing excavation paths');
    updateFieldStatusCounters();
    setInteractionMode('select');
    global.FTTHUiController?.onToolSelected?.({ lockMode: !!opts.lockMode });
  }

  function appendCableConfiguratorPanel(box, parent, grp) {
    var cfg = ensureCableConfig()[getCableConfigKey(grp.kind)];
    var panel = document.createElement('div');
    panel.className = 'cable-config-panel cable-config-panel--' + grp.kind;
    panel.dataset.cableKind = grp.kind;

    var chips = document.createElement('div');
    chips.className = 'cable-capacity-chips';
    grp.capacities.forEach(function (cap) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'cable-cap-chip cable-glow-btn' + (cap === cfg.capacity ? ' cable-cap-chip--active' : '');
      chip.dataset.cableCap = grp.kind;
      chip.dataset.cap = String(cap);
      chip.textContent = cap + 'F';
      chip.addEventListener('click', function (e) {
        e.stopPropagation();
        setCableCapacity(grp.kind, cap, box);
        armPenCable(grp, cap, box, panel);
      });
      chips.appendChild(chip);
    });
    panel.appendChild(chips);

    var batchRow = document.createElement('div');
    batchRow.className = 'cable-batch-row';
    batchRow.innerHTML =
      '<span class="cable-batch-row__label">Batch</span>' +
      '<button type="button" class="cable-batch-btn cable-glow-btn" data-cable-batch-minus="' + grp.kind + '" aria-label="Decrease batch">−</button>' +
      '<span class="cable-batch-row__value" data-cable-batch-val="' + grp.kind + '">' + cfg.batch + '</span>' +
      '<button type="button" class="cable-batch-btn cable-glow-btn" data-cable-batch-plus="' + grp.kind + '" aria-label="Increase batch">+</button>';

    batchRow.querySelector('[data-cable-batch-minus="' + grp.kind + '"]').addEventListener('click', function (e) {
      e.stopPropagation();
      setCableBatch(grp.kind, getCableBatchForKind(grp.kind) - 1, box);
    });
    batchRow.querySelector('[data-cable-batch-plus="' + grp.kind + '"]').addEventListener('click', function (e) {
      e.stopPropagation();
      setCableBatch(grp.kind, getCableBatchForKind(grp.kind) + 1, box);
    });
    panel.appendChild(batchRow);

    var preview = document.createElement('div');
    preview.className = 'cable-label-preview cable-glow-preview';
    preview.dataset.cablePreview = grp.kind;
    preview.textContent = formatCableLabel(cfg.capacity, cfg.batch);
    panel.appendChild(preview);

    bindSmartToolboxActivation(panel, PEN_TOOL_ID, function (opts) {
      if (opts?.event?.target?.closest?.('button, select')) return;
      armPenCable(grp, getCableCapacityForKind(grp.kind), box, panel, opts);
    });

    parent.appendChild(panel);
  }

  function appendCableAccordionSection(box, section, grp) {
    if (!Sim.ui.cableCategoryCollapsed) {
      Sim.ui.cableCategoryCollapsed = { ftth: true, lastmile: true };
    }
    var wrap = document.createElement('div');
    wrap.className = 'toolbox-category toolbox-category--cable toolbox-category--collapsed' +
      (grp.id === 'ftth' ? ' ftth-cable' : grp.id === 'lastmile' ? ' last-mile-cable' : '');
    wrap.dataset.categoryId = 'cable_' + grp.id;

    var accent = grp.kind === 'lastmile' ? '#0ea5e9' : '#2563eb';
    var header = document.createElement('button');
    header.type = 'button';
    header.className = 'toolbox-category__header cable-accordion-header cable-accordion-header--' + grp.kind;
    header.style.borderColor = accent + '44';
    header.style.background = accent + '14';
    header.innerHTML =
      '<span class="toolbox-category__chevron" aria-hidden="true">▾</span>' +
      '<span class="toolbox-category__icon">' + cableIconSvg(getCableCapacityForKind(grp.kind), grp.kind, 18) + '</span>' +
      '<span class="toolbox-category__title toolbox-collapsible-text">' + grp.label + '</span>';

    var body = document.createElement('div');
    body.className = 'toolbox-category__body';
    appendCableConfiguratorPanel(box, body, grp);

    if (!Sim.ui.cableCategoryCollapsed[grp.id]) {
      wrap.classList.remove('toolbox-category--collapsed');
    }

    header.addEventListener('click', function (e) {
      e.stopPropagation();
      wrap.classList.toggle('toolbox-category--collapsed');
      Sim.ui.cableCategoryCollapsed[grp.id] = wrap.classList.contains('toolbox-category--collapsed');
    });

    wrap.appendChild(header);
    wrap.appendChild(body);
    section.appendChild(wrap);
  }

  function appendPenToolSection(box) {
    var section = document.createElement('div');
    section.className = 'toolbox-pen-section rounded-xl border border-amber-500/25 bg-fiber-card/80 p-2 space-y-2';
    section.innerHTML =
      '<p class="text-[10px] font-bold uppercase tracking-wider text-amber-400/90 px-1">Drawing</p>';

    var penRow = document.createElement('div');
    penRow.className = 'toolbox-item toolbox-item--pen flex items-center gap-3 p-3 rounded-xl border border-amber-500/30 bg-fiber-card hover:border-amber-400/50 transition-all select-none cursor-pointer';
    penRow.dataset.type = PEN_TOOL_ID;
    penRow.innerHTML =
      '<span class="toolbox-item__icon toolbox-item__icon--excav-pen text-xl w-9 h-9 shrink-0 flex items-center justify-center rounded-lg" style="background:#f59e0b22;border:1px solid #f59e0b66">' +
      excavationPenIconSvg(28) + '</span>' +
      '<div class="toolbox-item__text toolbox-collapsible-text flex-1 min-w-0">' +
      '<p class="text-xs font-semibold text-white truncate">Pen Tool</p>' +
      '<p class="text-[10px] text-slate-500 truncate">Pick line type below</p></div>';
    bindSmartToolboxActivation(penRow, PEN_TOOL_ID, function (opts) {
      clearToolboxSelection(box);
      penRow.classList.add('toolbox-item--selected');
      selectPenTool(box, opts);
    });
    section.appendChild(penRow);

    var excavHdr = document.createElement('p');
    excavHdr.className = 'text-[9px] font-bold uppercase tracking-wider text-slate-500 px-1 pt-1';
    excavHdr.textContent = 'Excavation';
    section.appendChild(excavHdr);

    EXCAVATION_TOOLS.forEach(function (tool) {
      var el = document.createElement('div');
      el.className = 'pen-line-option toolbox-item toolbox-item--excav flex items-center gap-2 p-2 rounded-lg border border-fiber-border bg-fiber-card/60 hover:border-amber-500/40 transition-all select-none cursor-pointer';
      el.dataset.lineId = tool.id;
      el.innerHTML =
        '<span class="toolbox-item__icon text-lg w-7 h-7 shrink-0 flex items-center justify-center rounded-md" style="background:' +
        tool.color + '22;border:1px solid ' + tool.color + '55">' +
        excavationToolIconSvg(tool.routeKind, 22) + '</span>' +
        '<span class="text-[11px] font-semibold text-white truncate">' + tool.label + '</span>';
      bindSmartToolboxActivation(el, PEN_TOOL_ID, function (opts) {
        armPenExcavation(tool, box, opts);
      });
      section.appendChild(el);
    });

    var cableHdr = document.createElement('p');
    cableHdr.className = 'text-[9px] font-bold uppercase tracking-wider text-slate-500 px-1 pt-2';
    cableHdr.textContent = 'Fiber Cables';
    section.appendChild(cableHdr);

    CABLE_GROUPS.forEach(function (grp) {
      appendCableAccordionSection(box, section, grp);
    });

    box.appendChild(section);
  }

  /* ─── Pen drawing (#global-drawing-layer) ─── */
  var SNAP_THRESHOLD = 6;
  var SNAP_THRESHOLD_SQ = SNAP_THRESHOLD * SNAP_THRESHOLD;
  var PEN_RUBBER_COLOR = '#f97316';
  var PEN_RUBBER_DASH = '5,5';

  function excavationStrokeForKind(kind) {
    for (var i = 0; i < EXCAVATION_TOOLS.length; i++) {
      if (EXCAVATION_TOOLS[i].routeKind === kind) return EXCAVATION_TOOLS[i];
    }
    return EXCAVATION_TOOLS[0];
  }

  function cableStrokeForKind(kind) {
    return { color: CABLE_STROKE_BLUE, width: CABLE_STROKE_WIDTH, dash: '' };
  }

  function getNodeSnapLabel(node) {
    if (!node) return null;
    /* Snap connectivity uses base IDs — not composite "H5 C3" display text. */
    if (node.type === 'pole_foundation') return node.poleName || node.autoName || null;
    if (node.autoName) return node.autoName;
    if (node.type === 'fat_handhole' && node.hasFatPole && node.fatSystemName) return node.fatSystemName;
    return null;
  }

  function getNodeCenterXY(node) {
    if (!node || !Sim.layout) return null;
    var cs = Sim.layout.cellSize;
    return {
      x: node.col * cs + cs / 2,
      y: node.row * cs + cs / 2,
      label: getNodeSnapLabel(node),
      nodeId: node.id,
    };
  }

  function getPenSnapTargets() {
    var targets = [];
    Sim.nodes.forEach(function (node) {
      if (node.type === 'pole_foundation') return;
      var center = global.FTTHDrawingEngine?.getDeviceSnapCenter?.(node) || getNodeCenterXY(node);
      if (center) targets.push(center);
    });
    return targets;
  }

  function resolvePenPointerFromEvent(e) {
    var xy = pointerEventToCanvasXY(e);
    if (!xy) return { x: 0, y: 0, snapped: false, snapLabel: null, snapNodeId: null };
    if (e?.clientX == null || e?.clientY == null) return resolvePenPointerXY(xy.x, xy.y);
    var snap = global.FTTHDrawingEngine?.getSnappedPosition?.(e.clientX, e.clientY, xy.x, xy.y, { mode: 'pen' });
    if (!snap) return { x: xy.x, y: xy.y, snapped: false, snapLabel: null, snapNodeId: null };
    return {
      x: isFinite(snap.x) ? snap.x : xy.x,
      y: isFinite(snap.y) ? snap.y : xy.y,
      snapped: !!snap.snapped,
      snapLabel: snap.snapLabel || snap.target?.label || null,
      snapNodeId: snap.snapNodeId || snap.target?.nodeId || null,
      snapTarget: snap.target || null,
    };
  }

  function resolvePenPointerXY(x, y) {
    var best = null;
    var bestDist = SNAP_THRESHOLD + 1;
    getPenSnapTargets().forEach(function (t) {
      var dx = t.x - x;
      var dy = t.y - y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= SNAP_THRESHOLD && dist < bestDist) {
        bestDist = dist;
        best = t;
      }
    });
    if (best) {
      return { x: best.x, y: best.y, snapped: true, snapLabel: best.label, snapNodeId: best.nodeId };
    }
    return { x: x, y: y, snapped: false, snapLabel: null, snapNodeId: null };
  }

  function getSnapCandidateNodes(clientX, clientY) {
    var pt = pointerToGridCell(clientX, clientY);
    if (!pt) return [];
    var out = [];
    var seen = {};
    for (var dr = -1; dr <= 1; dr++) {
      for (var dc = -1; dc <= 1; dc++) {
        var n = getNodeAt(pt.col + dc, pt.row + dr);
        if (n && !seen[n.id]) {
          seen[n.id] = 1;
          out.push(n);
        }
      }
    }
    return out;
  }

  function normalizeDrawPoint(pt, cs) {
    if (Array.isArray(pt) && pt.length >= 2) return [pt[0], pt[1]];
    if (pt && typeof pt.col === 'number' && typeof pt.row === 'number') {
      return [pt.col * cs + cs / 2, pt.row * cs + cs / 2];
    }
    return [0, 0];
  }

  function collectHandholeAssociationLabelsForPath(path) {
    var labels = [];
    var seen = {};
    function add(label) {
      if (!label || seen[label]) return;
      seen[label] = 1;
      labels.push(label);
    }
    function addFromPath(p) {
      if (!p) return;
      var ct = p.connectedTo || {};
      add(ct.start);
      add(ct.end);
      (p.snapLabels || []).forEach(add);
      (p.associatedHandholeLabels || []).forEach(add);
    }
    function addByGeometry(p) {
      if (!p || !p.points || !Sim.layout) return;
      var cs = Sim.layout.cellSize || 50;
      var tol = cs * 0.65;
      (Sim.nodes || []).forEach(function (node) {
        if (!node || (node.type !== 'handhole' && node.type !== 'fat_handhole')) return;
        var label = getNodeSnapLabel(node);
        var center = getNodeCenterXY(node);
        if (!label || !center) return;
        for (var i = 0; i < p.points.length; i++) {
          var pt = p.points[i];
          if (pt && Math.hypot(pt[0] - center.x, pt[1] - center.y) <= tol) {
            add(label);
            break;
          }
        }
      });
    }
    addFromPath(path);
    addByGeometry(path);
    if (path?.loopParentTrenchId) {
      var parent = findPathByRef({ type: 'excavation', id: path.loopParentTrenchId });
      addFromPath(parent);
      addByGeometry(parent);
    }
    return labels.filter(function (label) {
      return (Sim.nodes || []).some(function (node) {
        return (node.type === 'handhole' || node.type === 'fat_handhole') &&
          getNodeSnapLabel(node) === label;
      });
    });
  }

  function normalizeExcavationPath(ep) {
    if (!ep || !Sim.layout) return ep;
    var cs = Sim.layout.cellSize;
    if (ep.points && ep.points.length && !Array.isArray(ep.points[0])) {
      ep.points = ep.points.map(function (p) { return normalizeDrawPoint(p, cs); });
    }
    if (!ep.type) ep.type = 'LM_Excavation';
    if (!ep.cornerRadii) ep.cornerRadii = {};
    if (!ep.connectorSegments) ep.connectorSegments = [];
    if (ep.independentClosureSegment && !(ep.associatedHandholeLabels || []).length) {
      ep.associatedHandholeLabels = collectHandholeAssociationLabelsForPath(ep);
    }
    return ep;
  }

  function isDrawableSurfaceXY(x, y) {
    if (isCanvas2dCoordinateMode()) return true;
    var cell = workspaceXYToCell(x, y);
    var t = getCellType(cell.col, cell.row);
    return t === CELL.SIDEWALK || t === CELL.STREET;
  }

  function findPathByRef(ref) {
    if (!ref) return null;
    if (ref.type === 'excavation') {
      for (var i = 0; i < Sim.excavationPaths.length; i++) {
        if (Sim.excavationPaths[i].id === ref.id) return Sim.excavationPaths[i];
      }
    } else if (ref.type === 'fiber') {
      for (var j = 0; j < Sim.fiberCablePaths.length; j++) {
        if (Sim.fiberCablePaths[j].id === ref.id) return Sim.fiberCablePaths[j];
      }
    }
    return null;
  }

  function getPathHighlightSegment(pathType, pathId) {
    if (!pathType || !pathId) return null;
    if (Sim.hoveredPath &&
        Sim.hoveredPath.type === pathType && Sim.hoveredPath.id === pathId &&
        Sim.hoveredPath.segIndex != null) {
      return Sim.hoveredPath.segIndex;
    }
    /* Segment overlay only while vertex/cut tools need a specific segment. */
    var segmentToolsActive = getActiveCanvasTool() === 'vertex' || getActiveCanvasTool() === 'cut' ||
      !!Sim.pathEdit?.vertexToolActive || !!Sim.pathEdit?.splitToolActive;
    if (segmentToolsActive &&
        Sim.selectedPath &&
        Sim.selectedPath.type === pathType && Sim.selectedPath.id === pathId &&
        !Sim.ui.pathHighlightFromSidebar &&
        Sim.selectedPath.segIndex != null) {
      return Sim.selectedPath.segIndex;
    }
    return null;
  }

  function segmentPointsToD(points, segIndex) {
    if (!points || segIndex == null || segIndex < 0 || segIndex >= points.length - 1) return '';
    var p1 = points[segIndex];
    var p2 = points[segIndex + 1];
    if (!p1 || !p2) return '';
    return 'M' + p1[0] + ' ' + p1[1] + ' L' + p2[0] + ' ' + p2[1];
  }

  function setHoveredPath(pathType, pathId, segIndex) {
    var next = pathType && pathId
      ? { type: pathType, id: pathId, segIndex: segIndex != null ? segIndex : null }
      : null;
    var prev = Sim.hoveredPath;
    if (prev && next &&
        prev.type === next.type && prev.id === next.id && prev.segIndex === next.segIndex) return;
    Sim.hoveredPath = next;
    var wrap = document.getElementById('canvas-wrapper');
    if (wrap) wrap.classList.toggle('path-hover-active', !!next);
    renderGlobalDrawingLayer();
  }

  function clearMapSelection() {
    var hadNode = !!Sim.selectedNodeId;
    var hadPath = !!Sim.selectedPath;
    var hadTopology = !!Sim.topologyHighlight;
    if (!hadNode && !hadPath && !hadTopology) return;
    if (hadNode) {
      Sim.selectedNodeId = null;
      Sim.moveNodeId = null;
      document.querySelectorAll('.placed-node.selected').forEach(function (el) { el.classList.remove('selected'); });
    }
    clearTopologyHighlight();
    if (hadPath) clearSelectedPath();
    else if (hadTopology) renderGlobalDrawingLayer();
    Sim.ui.sidebarEditMode = false;
    hideContextMenu();
    Sim.ui.contextMenuNodeId = null;
    syncSidebarSelectionState();
    renderUnifiedSidebar();
  }

  function trySelectionModeDblClick(e) {
    if (Sim.interactionMode !== 'hand' && Sim.interactionMode !== 'select') return false;
    if (hasActiveDrawingStroke() || canPenDraw()) return false;
    if (!Sim.selectedNodeId && !Sim.selectedPath) return false;
    clearMapSelection();
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    updateStatus('Selection cleared');
    return true;
  }

  function isPlacementToolActive() {
    var tool = Sim.selectedTool;
    if (!tool || tool === PEN_TOOL_ID) return false;
    if (tool.indexOf('cable') === 0) return false;
    return true;
  }

  function clearSelectedPath() {
    var hadState = !!(Sim.selectedPath || Sim.pathEdit?.editActive || Sim.pathEdit?.splitToolActive ||
      Sim.pathEdit?.vertexToolActive);
    Sim.selectedPath = null;
    Sim.ui.pathHighlightFromSidebar = false;
    Sim.ui.sidebarEditMode = false;
    if (Sim.pathEdit) {
      Sim.pathEdit.editActive = false;
      Sim.pathEdit.splitToolActive = false;
      Sim.pathEdit.vertexToolActive = false;
      Sim.crosshair = null;
      Sim.pathEdit.cutHover = null;
      Sim.pathEdit.cutSwipe = null;
      Sim.pathEdit.editingPathId = null;
      Sim.pathEdit.isDraggingVertex = false;
      global.FTTHDrawingEngine?.resetAllGhostState?.();
      if (getCurrentMode() === WORKSPACE_MODES.CUT || getCurrentMode() === WORKSPACE_MODES.VERTEX) {
        syncPathEditFlagsForMode(getCurrentMode());
      } else {
        Sim.activeCanvasTool = 'select';
      }
    }
    syncPathBottomPanelLayout(false);
    setHoveredPath(null, null);
    syncDrawingLayerInteraction();
    renderGlobalDrawingLayer();
    syncVertexPanelLayout(false);
    if (hadState) renderUnifiedSidebar();
  }

  function selectPath(pathType, pathId, openModal, options) {
    options = options || {};
    if (hasActiveDrawingStroke() || isCablePenDrawActive()) return;
    var preserveVertex = getActiveCanvasTool() === 'vertex' || Sim.pathEdit?.vertexToolActive;
    var preserveCut = getActiveCanvasTool() === 'cut' || Sim.pathEdit?.splitToolActive;
    var fromSidebar = !!options.fromSidebar;
    var anchorNode = fromSidebar ? getSidebarAnchorHandholeNode() : null;
    /* Keep Evaluation hole context when focusing a linked path from the sidebar,
       but always clear topology fan-out so the chosen path highlights alone. */
    var keepSidebarAnchor = !!(fromSidebar && anchorNode);

    clearTopologyHighlight();
    applyTopologyHighlightClasses();
    if (!keepSidebarAnchor) {
      Sim.selectedNodeId = null;
      document.querySelectorAll('.placed-node.selected').forEach(function (el) { el.classList.remove('selected'); });
    }

    var segIndex = null;
    if ((preserveVertex || preserveCut) && options.segIndex != null) {
      segIndex = options.segIndex;
    }

    Sim.selectedPath = {
      type: pathType,
      id: pathId,
      segIndex: segIndex,
    };
    /* Map/path inspection is read-only for Active FDT — toolbox switcher only. */
    Sim.ui.topologyTreeFocus = {
      kind: pathType === 'fiber' ? 'cable' : 'excavation',
      pathType: pathType,
      pathId: pathId,
      anchorNodeId: keepSidebarAnchor ? anchorNode.id : null,
    };
    Sim.ui.pathHighlightFromSidebar = fromSidebar;
    setHoveredPath(null, null);
    hideContextMenu();

    if (!Sim.pathEdit) Sim.pathEdit = { drag: null, context: null };
    Sim.pathEdit.editingPathId = { type: pathType, id: pathId };
    if (preserveVertex || preserveCut) Sim.pathEdit.editActive = true;
    if (preserveVertex && Sim.pathEdit.selectedVertexIndex == null) Sim.pathEdit.selectedVertexIndex = 0;

    if (!preserveVertex && !preserveCut) {
      if (!fromSidebar) {
        Sim.ui.sidebarEditMode = false;
      }
    }

    syncDrawingLayerInteraction();
    renderGlobalDrawingLayer();
    syncVertexControlBarContent();
    renderUnifiedSidebar();

    if (preserveVertex) {
      Sim.currentMode = WORKSPACE_MODES.VERTEX;
      Sim.pathEdit.vertexToolActive = true;
      Sim.activeCanvasTool = 'vertex';
      updateStatus('Vertex Tool — edit selected path');
      syncGisToolbarActiveStates();
      return;
    }

    if (preserveCut) {
      Sim.currentMode = WORKSPACE_MODES.CUT;
      Sim.pathEdit.splitToolActive = true;
      Sim.activeCanvasTool = 'cut';
      updateStatus('Cut — swipe or click segment on map');
      syncGisToolbarActiveStates();
      return;
    }

    updateStatus('Path selected — inspect in Features & Properties');
  }

  function purgePathVisuals(pathType, pathId) {
    if (!pathType || !pathId) return;
    var svg = getGlobalDrawingLayer();
    var attrSel = '[data-path-type="' + pathType + '"][data-path-id="' + pathId + '"]';
    if (svg) {
      svg.querySelectorAll(attrSel).forEach(function (el) { el.remove(); });
      svg.querySelectorAll('.vertex-handles, .midpoint-handles, .vertex-insert-preview').forEach(function (g) {
        if (g.matches(attrSel) || g.querySelector(attrSel)) g.remove();
      });
    }
    var labels = document.getElementById('global-map-labels-layer');
    if (labels) {
      labels.querySelectorAll(attrSel).forEach(function (el) { el.remove(); });
    }
  }

  function resetPathEditToSelect() {
    Sim.selectedPath = null;
    if (Sim.pathEdit) {
      Sim.pathEdit.editActive = false;
      Sim.pathEdit.splitToolActive = false;
      Sim.pathEdit.vertexToolActive = false;
      Sim.crosshair = null;
      Sim.pathEdit.cutHover = null;
      Sim.pathEdit.cutSwipe = null;
      Sim.pathEdit.editingPathId = null;
      Sim.pathEdit.isDraggingVertex = false;
      Sim.pathEdit.selectedVertexIndex = null;
      Sim.pathEdit.insertHover = null;
      global.FTTHDrawingEngine?.resetAllGhostState?.();
    }
    enableSelectMode();
    setHoveredPath(null, null);
    syncDrawingLayerInteraction();
    syncVertexPanelLayout(false);
  }

  function deleteSelectedPath() {
    if (!Sim.selectedPath) return;
    var ref = { type: Sim.selectedPath.type, id: Sim.selectedPath.id };

    if (ref.type === 'excavation') {
      deleteExcavationWithContents(ref.id);
    } else {
      purgePathVisuals(ref.type, ref.id);
      var cable = findPathByRef({ type: 'fiber', id: ref.id });
      if (cable) {
        var hostId = cable.hostTrenchId || cable.trenchPathId;
        if (hostId) unregisterCableFromTrench(hostId, ref.id);
      }
      Sim.fiberCablePaths = Sim.fiberCablePaths.filter(function (p) { return p.id !== ref.id; });
    }

    resetPathEditToSelect();
    Sim.ui.sidebarEditMode = false;
    syncNameCountersFromNodes();
    syncDefaultCableBatchesToMap();
    renderUnifiedSidebar();
    syncPathBottomPanelLayout(false);
    updateStatus('Path deleted');
    notifyFiberDesignTopologyChanged();

    window.setTimeout(function () {
      saveState();
      global.FTTHDrawingEngine?.requestMapLabelsRedraw?.();
    }, 0);
  }

  function deletePathway(pathType, pathId) {
    if (!pathType || !pathId) return;
    Sim.selectedPath = { type: pathType, id: pathId };
    deleteSelectedPath();
  }

  function focusPathEditTarget(pathType, pathId) {
    if (!Sim.pathEdit) {
      Sim.pathEdit = {
        drag: null, context: null, editActive: false, splitToolActive: false,
        vertexToolActive: false, selectedVertexIndex: null, editingPathId: null,
      };
    }
    Sim.pathEdit.editActive = true;
    Sim.pathEdit.editingPathId = { type: pathType, id: pathId };
    syncDrawingLayerInteraction();
    renderGlobalDrawingLayer();
  }

  function setPathEditActive(active, pathType, pathId) {
    if (!Sim.pathEdit) {
      Sim.pathEdit = { drag: null, context: null, editActive: false, splitToolActive: false, vertexToolActive: false, selectedVertexIndex: null, editingPathId: null };
    }
    Sim.pathEdit.editActive = !!active;
    if (active && pathType && pathId) {
      Sim.pathEdit.editingPathId = { type: pathType, id: pathId };
      if (!Sim.selectedPath || Sim.selectedPath.type !== pathType || Sim.selectedPath.id !== pathId) {
        Sim.selectedPath = { type: pathType, id: pathId };
      }
    } else if (!active) {
      Sim.pathEdit.editingPathId = null;
      Sim.pathEdit.splitToolActive = false;
      Sim.pathEdit.vertexToolActive = false;
      Sim.crosshair = null;
      Sim.pathEdit.cutHover = null;
      Sim.pathEdit.cutSwipe = null;
      Sim.activeCanvasTool = 'select';
      Sim.pathEdit.isDraggingVertex = false;
      global.FTTHDrawingEngine?.resetAllGhostState?.();
    }
    syncDrawingLayerInteraction();
    renderGlobalDrawingLayer();
  }

  function setEditingPathwayId(pathType, pathId) {
    if (!Sim.pathEdit) {
      Sim.pathEdit = { drag: null, context: null, editActive: false, splitToolActive: false, vertexToolActive: false, selectedVertexIndex: null, editingPathId: null };
    }
    Sim.pathEdit.editingPathId = (pathType && pathId) ? { type: pathType, id: pathId } : null;
    syncDrawingLayerInteraction();
    renderGlobalDrawingLayer();
  }

  function setActivePathTool(tool) {
    if (!tool) {
      setActiveCanvasTool('select');
      return;
    }
    if (tool === 'split') setActiveCanvasTool('cut');
    else if (tool === 'vertex' || tool === 'connect') setActiveCanvasTool('vertex');
    else setActiveCanvasTool('select');
  }

  function onUpdatePathCurve(pathType, pathId, vertexIndex, radius) {
    if (pathType == null || pathId == null || vertexIndex == null) return;
    global.FTTHPathwayEditor?.setCornerRadius?.(pathType, pathId, vertexIndex, radius);
  }

  function closePathwayModal() {
    Sim.ui.sidebarEditMode = false;
    clearSelectedPath();
    renderUnifiedSidebar();
  }

  var pathBridge = null;

  function buildPathBridge() {
    return {
      getSim: function () { return Sim; },
      getDrawingCanvas: getDrawingCanvas,
      ensureGlobalDrawingLayer: ensureGlobalDrawingLayer,
      ensureMapLabelsLayer: ensureMapLabelsLayer,
      bindDraggableLabels: bindDraggableLabels,
      attachNodeLabels: attachNodeLabels,
      resolveComponentMapLabel: resolveComponentMapLabel,
      pointerEventToCanvasXY: pointerEventToCanvasXY,
      getSVGCoordinates: getSVGCoordinates,
      pointerClientToCanvasXY: pointerClientToCanvasXY,
      getOverlayHost: getBottomPanelHost,
      getBottomPanelHost: getBottomPanelHost,
      ensureBottomPanelInWorkspace: ensureBottomPanelInWorkspace,
      syncPathBottomPanelLayout: syncPathBottomPanelLayout,
      ensureFloatingUiInFullscreenHost: ensureFloatingUiInFullscreenHost,
      setInteractionMode: setInteractionMode,
      cancelPenDrawingMode: cancelPenDrawingMode,
      resetDrawingPointsKeepTool: resetDrawingPointsKeepTool,
      hasActiveDrawingStroke: hasActiveDrawingStroke,
      resolvePenPointerFromEvent: resolvePenPointerFromEvent,
      resolvePenPointerXY: resolvePenPointerXY,
      isDrawableSurfaceXY: isDrawableSurfaceXY,
      canPenDraw: canPenDraw,
      isMapNavigationLocked: isMapNavigationLocked,
      resetMapPointerState: resetMapPointerState,
      panMapBy: panMapBy,
      clampMapPan: clampMapPan,
      getMapPanClampLimits: getMapPanClampLimits,
      applyMapPanClamp: applyMapPanClamp,
      getMapViewportWrapper: getMapViewportWrapper,
      getMapZoomViewportFrame: getMapZoomViewportFrame,
      clientPointToMapZoomLocal: clientPointToMapZoomLocal,
      isOpenWorkspaceNavigation: isOpenWorkspaceNavigation,
      getOpenWorldPixelSize: getOpenWorldPixelSize,
      getTemplateSheetOrigin: getTemplateSheetOrigin,
      syncOpenWorldShell: syncOpenWorldShell,
      zoomPreserveLocalPoint: zoomPreserveLocalPoint,
      getWorkspaceViewportScreenCenter: getWorkspaceViewportScreenCenter,
      templateLocalToDeskWorldXY: templateLocalToDeskWorldXY,
      deskWorldToTemplateLocalXY: deskWorldToTemplateLocalXY,
      setZoom: setZoom,
      setMapRotation: setMapRotation,
      canVertexEdit: canVertexEdit,
      isPenToolActive: isPenToolActive,
      isPenToolSelected: isPenToolSelected,
      isDrawingLayerInteractive: isDrawingLayerInteractive,
      syncPenModeClass: syncPenModeClass,
      syncDrawingLayerInteraction: syncDrawingLayerInteraction,
      refreshLabelsAfterPathCommit: refreshLabelsAfterPathCommit,
      renderGlobalDrawingLayer: renderGlobalDrawingLayer,
      requestCanvasRedraw: requestCanvasRedraw,
      requestOverlayRedraw: requestOverlayRedraw,
      patchVertexDragVisuals: patchVertexDragVisuals,
      updateStatus: updateStatus,
      setPushHint: setPushHint,
      setActiveFdt: setActiveFdt,
      getActiveFdtId: getActiveFdtId,
      getActiveFdtLabel: getActiveFdtLabel,
      findServingFdt: findServingFdt,
      syncGisStatusBar: syncGisStatusBar,
      saveState: saveState,
      findPathByRef: findPathByRef,
      selectPath: selectPath,
      deleteSelectedPath: deleteSelectedPath,
      onDeletePathway: deletePathway,
      onClose: closePathwayModal,
      setPathEditActive: setPathEditActive,
      setEditingPathwayId: setEditingPathwayId,
      setActiveTool: setActivePathTool,
      getActiveCanvasTool: getActiveCanvasTool,
      setActiveCanvasTool: setActiveCanvasTool,
      getCurrentMode: getCurrentMode,
      setCurrentMode: setCurrentMode,
      enableCutMode: enableCutMode,
      enableVertexMode: enableVertexMode,
      enablePanMode: enablePanMode,
      enableSelectMode: enableSelectMode,
      toggleCutMode: toggleCutMode,
      toggleVertexMode: toggleVertexMode,
      activateVertexPathEdit: activateVertexPathEdit,
      pickPathForVertexEdit: pickPathForVertexEdit,
      getNodeCenterXY: getNodeCenterXY,
      notifyNetworkTopologyChanged: notifyNetworkTopologyChanged,
      syncCutTargetCursor: syncCutTargetCursor,
      syncVertexControlBar: syncVertexControlBar,
      syncVertexPanelLayout: syncVertexPanelLayout,
      hidePathPropertiesPanel: hidePathPropertiesPanel,
      isPathPropertiesPanelOpen: isPathPropertiesPanelOpen,
      isPathEditSessionActive: isPathEditSessionActive,
      updateMetrics: updateMetrics,
      onUpdateCurve: onUpdatePathCurve,
      setHoveredPath: setHoveredPath,
      nextCableName: nextCableName,
      getCableLabelForKind: getCableLabelForKind,
      getCableBatchForKind: getCableBatchForKind,
      syncActiveCableBatchToEngines: syncActiveCableBatchToEngines,
      getCableCapacityForKind: getCableCapacityForKind,
      getActiveCableKind: getActiveCableKind,
      refreshBatchDuplicationHint: refreshBatchDuplicationHint,
      syncBatchDuplicationHintForDrawingState: syncBatchDuplicationHintForDrawingState,
      syncStatusBarDuplicationDisplay: syncStatusBarDuplicationDisplay,
      getActivePathStatusLabel: getActivePathStatusLabel,
      formatMainCableTrailLabelForDisplay: formatMainCableTrailLabelForDisplay,
      resolveMainTrailHopDisplayLabel: resolveMainTrailHopDisplayLabel,
      resolveActiveToolboxCableLabel: resolveActiveToolboxCableLabel,
      syncPenDraftCableFromToolbox: syncPenDraftCableFromToolbox,
      formatCableLabel: formatCableLabel,
      validateCableRouting: validateCableRouting,
      snapCableToTrench: snapCableToTrench,
      snapCablePointsAlongTrench: snapCablePointsAlongTrench,
      buildCablePreviewAlongExcavation: buildCablePreviewAlongExcavation,
      projectPointOnAnyExcavation: projectPointOnAnyExcavation,
      getCableDisplayBatchLabel: getCableDisplayBatchLabel,
      syncCablesOnTrench: syncCablesOnTrench,
      syncLockedPathFromCable: syncLockedPathFromCable,
      isCableTrenchVertexLocked: isCableTrenchVertexLocked,
      propagateLockedVertexEdit: propagateLockedVertexEdit,
      propagateLockedVertexInsert: propagateLockedVertexInsert,
      propagateLockedVertexDelete: propagateLockedVertexDelete,
      resolveTrenchForCable: resolveTrenchForCable,
      syncAllCablePathsToTrenches: syncAllCablePathsToTrenches,
      joinCableToTrench: joinCableToTrench,
      mergeCableDraftToTrench: mergeCableDraftToTrench,
      findExcavationTrenchSnapPoint: findExcavationTrenchSnapPoint,
      findExcavationTrenchVertexSnapPoint: findExcavationTrenchVertexSnapPoint,
      findCableMagneticSnapPoint: findCableMagneticSnapPoint,
      findCableNodeMagneticSnap: findCableNodeMagneticSnap,
      findCableTrenchPathGuideSnap: findCableTrenchPathGuideSnap,
      findPenPathGuideSnap: findPenPathGuideSnap,
      findPathGuideSnap: findPathGuideSnap,
      getCableEffectiveSnapRadius: getCableEffectiveSnapRadius,
      CABLE_MAGNETIC_SNAP_RADIUS: 32,
      getTrenchVertexSubpathPoints: getTrenchVertexSubpathPoints,
      appendCableVerticesAlongTrench: appendCableVerticesAlongTrench,
      isCablePenDrawActive: isCablePenDrawActive,
      isCableContinuePromptActive: function () {
        return !!global.FTTHDrawingEngine?.isCableContinuePromptActive?.();
      },
      isHandholeGeometryLocked: isHandholeGeometryLocked,
      isHandholeNodePositionLocked: isHandholeNodePositionLocked,
      getCableRenderGeometry: getCableRenderGeometry,
      buildCableCenterlineOnTrench: buildCableCenterlineOnTrench,
      buildCableUnifiedCenterline: buildCableUnifiedCenterline,
      resolveCableHostTrench: resolveCableHostTrench,
      getCableLaneInfo: getCableLaneInfo,
      getCableDraftLaneOffsetPx: getCableDraftLaneOffsetPx,
      snapCableWaypointToTrench: snapCableWaypointToTrench,
      strictifyCableWaypoints: strictifyCableWaypoints,
      getCablesGroupedByTrench: getCablesGroupedByTrench,
      getCableLabelLayoutForRender: getCableLabelLayoutForRender,
      offsetPolylineLateral: offsetPolylineLateral,
      roundPathPoints: roundPathPoints,
      TRENCH_CEMENT_BASE_WIDTH: TRENCH_CEMENT_BASE_WIDTH,
      tryAutoMergePathGaps: tryAutoMergePathGaps,
      focusPathEditTarget: focusPathEditTarget,
      getSnapCandidateNodes: getSnapCandidateNodes,
      clearMapSelection: clearMapSelection,
      trySelectionModeDblClick: trySelectionModeDblClick,
      isPlacementToolActive: isPlacementToolActive,
      isMapGesturePanActive: isMapGesturePanActive,
      isTemporaryPanOverrideActive: isTemporaryPanOverrideActive,
      deselectAllToolboxTools: deselectAllToolboxTools,
      clearToolboxSelection: clearToolboxSelection,
      registerCableOnTrench: registerCableOnTrench,
      getCablesOnTrench: getCablesOnTrench,
      getCablesStrictlyOnTrench: getCablesStrictlyOnTrench,
      getCablesOnTrenchForInspection: getCablesOnTrenchForInspection,
      getChildClosureSegments: getChildClosureSegments,
      unregisterCableFromTrench: unregisterCableFromTrench,
      deleteExcavationWithContents: deleteExcavationWithContents,
      getTrenchDynamicStrokeWidth: getTrenchDynamicStrokeWidth,
      pathLengthMeters: pathLengthMeters,
      canPlaceCablePoint: canPlaceCablePoint,
      canStartCableDrawing: canStartCableDrawing,
      validateCablePointsOnTrench: validateCablePointsOnTrench,
      saveCableToDatabase: saveCableToDatabase,
      extendCableInDatabase: extendCableInDatabase,
      finalizeSavedCableTopology: finalizeSavedCableTopology,
      isPointOnExcavationTrench: isPointOnExcavationTrench,
      isCablePenModeActive: isCablePenModeActive,
      getCablesThroughNode: getCablesThroughNode,
      getNodeAsBuiltCode: getNodeAsBuiltCode,
      formatCableAsBuiltId: formatCableAsBuiltId,
      getExcavationDisplayNumber: getExcavationDisplayNumber,
      getExcavationTools: function () { return EXCAVATION_TOOLS; },
      cableStrokeForKind: cableStrokeForKind,
      excavationStrokeForKind: excavationStrokeForKind,
      peekBelowDrawingLayer: peekBelowDrawingLayer,
      pickPlacedNodeUnderPointer: pickPlacedNodeUnderPointer,
      resolveMapPick: resolveMapPick,
      applyMapPick: applyMapPick,
      onPlacedNodeClick: onPlacedNodeClick,
      tryHandholeQuickNestDblClick: tryHandholeQuickNestDblClick,
      renderUnifiedSidebar: renderUnifiedSidebar,
    };
  }

  function initPathModules() {
    if (pathBridge) return;
    pathBridge = buildPathBridge();
    if (global.FTTHDrawingEngine) global.FTTHDrawingEngine.init(pathBridge);
    if (global.FTTHUiController) global.FTTHUiController.init(pathBridge);
    if (global.FTTHPathwayEditor) global.FTTHPathwayEditor.init(pathBridge);
    if (global.PathwayPropertiesModal) {
      global.PathwayPropertiesModal.init(pathBridge);
      if (global.PathwayPropertiesModal.ensureMounted) global.PathwayPropertiesModal.ensureMounted();
    }
  }

  function bindPenDrawingEvents() {
    initPathModules();
    if (global.FTTHDrawingEngine?.bindCrosshairBoundaries) global.FTTHDrawingEngine.bindCrosshairBoundaries();
    if (global.FTTHPathwayEditor) global.FTTHPathwayEditor.bindCanvasInteraction();
    Sim.ui.drawEngineBound = true;
  }

  var canvasRedrawPending = false;
  var overlayRedrawPending = false;

  function requestCanvasRedraw() {
    if (Sim.pathEdit?.ghostDragging) {
      requestOverlayRedraw();
      return;
    }
    if (hasActiveDrawingStroke() || canPenDraw()) {
      canvasRedrawPending = false;
      renderGlobalDrawingLayer();
      return;
    }
    if (canvasRedrawPending) return;
    canvasRedrawPending = true;
    requestAnimationFrame(function () {
      canvasRedrawPending = false;
      renderGlobalDrawingLayer();
    });
  }

  function requestOverlayRedraw() {
    if (hasActiveDrawingStroke() || canPenDraw()) {
      overlayRedrawPending = false;
      var svgLive = getGlobalDrawingLayer();
      if (svgLive && global.FTTHDrawingEngine?.renderGisOverlays) {
        global.FTTHDrawingEngine.renderGisOverlays(svgLive);
      } else if (global.FTTHDrawingEngine?.flushPenCursorVisuals) {
        global.FTTHDrawingEngine.flushPenCursorVisuals();
      } else if (global.FTTHDrawingEngine?.flushPenDrawingVisuals) {
        global.FTTHDrawingEngine.flushPenDrawingVisuals();
      }
      return;
    }
    if (overlayRedrawPending) return;
    overlayRedrawPending = true;
    requestAnimationFrame(function () {
      overlayRedrawPending = false;
      var svg = getGlobalDrawingLayer();
      if (svg && global.FTTHDrawingEngine?.renderGisOverlays) {
        global.FTTHDrawingEngine.renderGisOverlays(svg);
      }
    });
  }

  function patchVertexDragVisuals() {
    var drag = Sim.pathEdit?.drag;
    if (!drag || !Sim.pathEdit?.ghostActive || !Sim.pathEdit.ghostPosition) return false;
    var svg = getGlobalDrawingLayer();
    if (!svg || !global.FTTHDrawingEngine?.patchVertexDragGhost) return false;
    global.FTTHDrawingEngine.patchVertexDragGhost(svg);
    var gp = Sim.pathEdit.ghostPosition;
    if (global.FTTHDrawingEngine.patchActiveVertexRing) {
      global.FTTHDrawingEngine.patchActiveVertexRing(svg, [gp.x, gp.y], Sim.pathEdit.ghostSnapped);
    }
    return true;
  }

  function renderGlobalDrawingLayer() {
    if (Sim.pathEdit?.ghostDragging) {
      requestOverlayRedraw();
      return;
    }
    var svg = ensureGlobalDrawingLayer();
    if (!svg || !Sim.layout) return;
    syncGlobalDrawingLayerSize();
    var cs = Sim.layout.cellSize;
    svg.innerHTML = '';

    function appendPath(d, className, strokeSpec, opacity, dashed, strokeWidth, meta, pathOpts) {
      pathOpts = pathOpts || {};
      if (!d) return;
      var isSegmentHighlight = !!pathOpts.segmentHighlight;
      var isHovered = !isSegmentHighlight && meta && Sim.hoveredPath &&
        Sim.hoveredPath.type === meta.type && Sim.hoveredPath.id === meta.id;
      var isEditing = meta && Sim.pathEdit?.editingPathId &&
        Sim.pathEdit.editingPathId.type === meta.type &&
        Sim.pathEdit.editingPathId.id === meta.id;
      var isSelected = meta && Sim.selectedPath &&
        Sim.selectedPath.type === meta.type && Sim.selectedPath.id === meta.id;
      var isTopologyHighlighted = meta && isPathInTopologyHighlight(meta.type, meta.id);
      var isActiveToolEdit = isSelected && isPathActiveToolEdit();
      var isSidebarSelection = isSelected && !isActiveToolEdit && !!Sim.ui.pathHighlightFromSidebar;
      var isMapPathSelection = isSelected && !isActiveToolEdit && !Sim.ui.pathHighlightFromSidebar;
      var isNetworkHighlight = isTopologyHighlighted && !isActiveToolEdit;
      var isSidebarCableHighlight = isSidebarSelection && meta.type === 'fiber';
      var isSidebarExcavHighlight = isSidebarSelection && meta.type === 'excavation';
      var activeSegIndex = meta ? getPathHighlightSegment(meta.type, meta.id) : null;
      /* Cables never inherit yellow from a selected/highlighted host trench.
         Cable color changes only via explicit sidebar selection (red). */
      var parentTrenchHighlight = false;
      var trenchMapHighlight = !!(meta && meta.trenchMapHighlight);
      /* Hover segment overlay may dim full trench; keep selected excavation fully yellow. */
      if (meta?.type === 'excavation' && activeSegIndex != null && !isSidebarExcavHighlight && !isSelected) {
        trenchMapHighlight = false;
      }
      var useSegmentHighlight = activeSegIndex != null &&
        (meta?.type === 'fiber' || meta?.type === 'excavation') &&
        (isSegmentHighlight || isHovered || (isMapPathSelection && !!isActiveToolEdit));
      /* Sidebar / selected excavation: always full-path yellow — never segment-dim the rest. */
      if (!isSegmentHighlight && isSelected && meta?.type === 'excavation' && !isActiveToolEdit) {
        useSegmentHighlight = false;
      }
      var isMapYellowHighlight = !useSegmentHighlight && (isMapPathSelection || isNetworkHighlight ||
        trenchMapHighlight || isSidebarExcavHighlight || parentTrenchHighlight) && !isSidebarCableHighlight;
      if (isSegmentHighlight) {
        isMapYellowHighlight = true;
      }
      if (meta?.type === 'excavation' && isSelected && !isActiveToolEdit && !isSidebarCableHighlight) {
        isMapYellowHighlight = true;
      }
      /* Hard rule: cables are never map-yellow — only sidebar red or active edit color. */
      if (meta?.type === 'fiber' && !isActiveToolEdit) {
        isMapYellowHighlight = false;
      }

      var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      var cls = className;
      if (meta) {
        cls += ' draw-path-editable draw-path-visible';
        if (isSidebarCableHighlight) cls += ' draw-path--sidebar-cable-highlight';
        if (isMapYellowHighlight) cls += ' draw-path--map-highlight';
        if (isNetworkHighlight && !isSegmentHighlight) cls += ' draw-path--topology-highlight';
        if (isSelected && !useSegmentHighlight) cls += ' draw-path--selected';
        if (isHovered && !isMapYellowHighlight && !isSidebarCableHighlight && !useSegmentHighlight) {
          cls += ' draw-path--hover';
        }
        if (isActiveToolEdit) cls += ' draw-path--active-edit';
        if (isSegmentHighlight) cls += ' draw-path--segment-highlight';
      }
      path.setAttribute('class', cls);
      path.setAttribute('fill', 'none');
      var strokeColor = dashed ? PEN_RUBBER_COLOR : strokeSpec.color;
      if (isActiveToolEdit) {
        strokeColor = ACTIVE_EDIT_PATH_COLOR;
      } else if (isSidebarCableHighlight) {
        strokeColor = CABLE_SIDEBAR_HIGHLIGHT;
      } else if (isMapYellowHighlight) {
        strokeColor = MAP_SELECTION_HIGHLIGHT;
      }
      path.setAttribute('stroke', strokeColor);
      var baseWidth;
      if (meta && meta.type === 'fiber') {
        baseWidth = strokeSpec.width || CABLE_STROKE_WIDTH;
      } else if (meta && meta.type === 'excavation') {
        baseWidth = strokeWidth || UNIFIED_TRENCH_CEMENT_WIDTH;
      } else {
        baseWidth = strokeWidth || (dashed ? '2.5' : (strokeSpec.width || '2.5'));
        if (isMapYellowHighlight && !isActiveToolEdit) baseWidth = '2.5';
      }
      path.setAttribute('stroke-width', baseWidth);
      path.setAttribute('vector-effect', 'non-scaling-stroke');
      path.setAttribute('filter', 'none');
      path.setAttribute('stroke-linecap', 'butt');
      path.setAttribute('stroke-linejoin', 'miter');
      /* Selection must never dim sibling pathways — committed paths stay fully opaque. */
      var pathOpacity = 1;
      if (dashed || (className && className.indexOf('draw-path--draft') >= 0)) {
        pathOpacity = opacity != null && opacity !== '' ? opacity : 0.8;
      }
      path.setAttribute('opacity', String(pathOpacity));
      if (meta && !dashed && !hasActiveDrawingStroke() && !isCablePenDrawActive()) {
        var hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        hit.setAttribute('d', (meta.hitPathD && meta.hitPathD.length) ? meta.hitPathD : d);
        hit.setAttribute('class', 'draw-path-hit draw-path-editable svg-pathway-line');
        hit.setAttribute('fill', 'none');
        hit.setAttribute('stroke', 'transparent');
        hit.setAttribute('stroke-width', '14');
        hit.setAttribute('vector-effect', 'non-scaling-stroke');
        hit.setAttribute('stroke-linecap', 'round');
        hit.setAttribute('stroke-linejoin', 'round');
        hit.setAttribute('data-path-type', meta.type);
        hit.setAttribute('data-path-id', meta.id);
        svg.appendChild(hit);
      }
      if (meta) {
        path.setAttribute('data-path-type', meta.type);
        path.setAttribute('data-path-id', meta.id);
      }
      if (dashed) {
        path.setAttribute('stroke-dasharray', PEN_RUBBER_DASH);
      } else if (strokeSpec.dash) {
        path.setAttribute('stroke-dasharray', strokeSpec.dash);
      }
      svg.appendChild(path);
    }

    function pointsToD(points, cornerRadii) {
      var editor = global.FTTHPathwayEditor;
      var renderPts = global.FTTHDrawingEngine?.resolvePathPointsForRender?.(points) || points;
      if (editor && editor.pointsToD) return editor.pointsToD(renderPts, cs, cornerRadii);
      if (!renderPts || renderPts.length < 2) return '';
      var d = '';
      for (var i = 0; i < renderPts.length; i++) {
        var p = normalizeDrawPoint(renderPts[i], cs);
        d += (i === 0 ? 'M' : 'L') + p[0] + ' ' + p[1] + ' ';
      }
      return d.trim();
    }

    Sim.connections.forEach(function (conn) {
      var a = Sim.nodes.filter(function (n) { return n.id === conn.from; })[0];
      var b = Sim.nodes.filter(function (n) { return n.id === conn.to; })[0];
      if (!a || !b) return;
      var x1 = a.col * cs + cs / 2;
      var y1 = a.row * cs + cs / 2;
      var x2 = b.col * cs + cs / 2;
      var y2 = b.row * cs + cs / 2;
      var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', x1);
      line.setAttribute('y1', y1);
      line.setAttribute('x2', x2);
      line.setAttribute('y2', y2);
      line.setAttribute('class', 'conn-line conn-line--' + (conn.kind || 'distribution'));
      line.setAttribute('stroke', conn.kind === 'lastmile' ? '#0ea5e9' : '#3b82f6');
      line.setAttribute('stroke-width', '2.5');
      line.setAttribute('vector-effect', 'non-scaling-stroke');
      line.setAttribute('filter', 'none');
      line.setAttribute('stroke-linecap', 'butt');
      line.setAttribute('pointer-events', 'none');
      svg.appendChild(line);
    });


    function appendFiberCablePath(cableGeom, cp, parentTrenchId) {
      if (!cableGeom.points || cableGeom.points.length < 2) return;
      var cableD = pointsToD(cableGeom.points, cp.cornerRadii);
      var hitD = (cableGeom.hitPoints && cableGeom.hitPoints.length >= 2)
        ? pointsToD(cableGeom.hitPoints, cp.cornerRadii)
        : cableD;
      var cableMeta = {
        type: 'fiber',
        id: cp.id,
        parentTrenchId: parentTrenchId || null,
        hitPathD: hitD,
      };
      var cableCls = 'draw-path draw-path--cable draw-path--unified-cable-core cable-path-line--' + cp.kind;
      var cableStroke = cableStrokeForKind(cp.kind);
      appendPath(cableD, cableCls, cableStroke, 1, false, null, cableMeta);
      var segIdx = getPathHighlightSegment('fiber', cp.id);
      if (segIdx != null) {
        var segD = segmentPointsToD(cableGeom.points, segIdx);
        if (segD) {
          appendPath(segD, cableCls, cableStroke, 1, false, '4.5', cableMeta, { segmentHighlight: true });
        }
      }
    }

    Sim.excavationPaths.forEach(function (ep) {
      if (global.FTTHVisibilityManager?.isExcavationVisible && !global.FTTHVisibilityManager.isExcavationVisible(ep)) {
        return;
      }
      normalizeExcavationPath(ep);
      var DE = global.FTTHDrawingEngine;
      var excavWidthNum = getTrenchDynamicStrokeWidth(ep.id);
      var excavWidth = String(excavWidthNum);
      var widthParent = ep.loopParentTrenchId
        ? findPathByRef({ type: 'excavation', id: ep.loopParentTrenchId })
        : ep;
      var renderCornerRadii = DE?.resolveDynamicCornerRadiiForTrench
        ? DE.resolveDynamicCornerRadiiForTrench(widthParent || ep, excavWidthNum)
        : (ep.cornerRadii || {});
      var trenchD = pointsToD(ep.points, renderCornerRadii);
      var excavSegIdx = getPathHighlightSegment('excavation', ep.id);
      var trenchMapHighlight = isUnifiedTrenchMapHighlighted(ep.id);
      var excavMeta = { type: 'excavation', id: ep.id, trenchMapHighlight: trenchMapHighlight };
      var excavCls = 'draw-path draw-path--excav draw-path--unified-trench excav-path-line--' + ep.kind;
      var excavStroke = excavationStrokeForKind(ep.kind);
      appendPath(trenchD, excavCls, excavStroke, 1, false, excavWidth, excavMeta);
      if (excavSegIdx != null) {
        var renderPts = global.FTTHDrawingEngine?.resolvePathPointsForRender?.(ep.points) || ep.points;
        var segD = segmentPointsToD(renderPts, excavSegIdx);
        if (segD) {
          appendPath(segD, excavCls, excavStroke, 1, false, excavWidth, excavMeta, { segmentHighlight: true });
        }
      }

      (ep.connectorSegments || []).forEach(function (connSeg, connIdx) {
        var connPts = global.FTTHPathwayEditor?.buildConnectorRenderPoints?.(ep, connSeg) || [];
        if (connPts.length < 2) return;
        var connD = pointsToD(connPts, renderCornerRadii);
        var connMeta = {
          type: 'excavation',
          id: ep.id,
          trenchMapHighlight: trenchMapHighlight,
          connectorIndex: connIdx,
        };
        appendPath(connD, excavCls, excavStroke, 1, false, excavWidth, connMeta);
      });
    });

    var cableRenderQueue = (Sim.fiberCablePaths || []).slice().sort(function (a, b) {
      var la = getCableLaneInfo(a);
      var lb = getCableLaneInfo(b);
      if (la.trenchId !== lb.trenchId) {
        return String(la.trenchId || '').localeCompare(String(lb.trenchId || ''));
      }
      if (la.laneIndex !== lb.laneIndex) return la.laneIndex - lb.laneIndex;
      return String(a.id).localeCompare(String(b.id));
    });
    cableRenderQueue.forEach(function (cp) {
      if (global.FTTHVisibilityManager?.isCableVisible && !global.FTTHVisibilityManager.isCableVisible(cp)) {
        return;
      }
      var cableGeom = getCableRenderGeometry(cp);
      var parentTrenchId = cableGeom.trenchId || cp.hostTrenchId || cp.trenchPathId || null;
      appendFiberCablePath(cableGeom, cp, parentTrenchId);
    });

    if (Sim.penDraft && Sim.penDraft.points.length >= 1 && !canPenDraw()) {
      var draftSpec = Sim.penDraft.lineMode === 'cable'
        ? cableStrokeForKind(Sim.penDraft.kind)
        : excavationStrokeForKind(Sim.penDraft.kind);
      appendPath(pointsToD(Sim.penDraft.points), 'draw-path draw-path--draft', draftSpec, 0.8, false);
    }

    var vtxRef = Sim.pathEdit?.editingPathId || Sim.selectedPath;
    if (vtxRef && canVertexEdit() && !(canPenDraw() && Sim.penDraft?.points?.length)) {
      var selPath = findPathByRef(vtxRef);
      var editor = global.FTTHPathwayEditor;
      if (selPath && editor) {
        editor.renderVertexHandles(svg, selPath, vtxRef.type);
      }
    }

    if (canPenDraw() && Sim.penDraft && Sim.penDraft.points.length >= 1) {
      var draftEditor = global.FTTHPathwayEditor;
      if (draftEditor?.renderVertexHandles) {
        draftEditor.renderVertexHandles(svg, {
          id: '__pen_draft__',
          points: Sim.penDraft.points,
          cornerRadii: {},
        }, Sim.penDraft.lineMode === 'cable' ? 'fiber' : 'excavation');
      }
    }

    if (global.FTTHDrawingEngine) {
      global.FTTHDrawingEngine.prepareDrawingLayer?.(svg);
      global.FTTHDrawingEngine.updateLiveRubberLine();
      global.FTTHDrawingEngine.renderGisOverlays(svg);
      global.FTTHDrawingEngine.renderMapLabels();
    }

    renderMeasureOverlay(svg);
  }

  function renderConnections() {
    renderGlobalDrawingLayer();
  }

  function renderToolbox() {
    var box = document.getElementById('toolbox-items');
    if (!box) return;
    box.innerHTML = '';

    function bindItemClick(el, item, onSelect) {
      bindSmartToolboxActivation(el, item.id, function (opts) {
        clearToolboxSelection(box);
        el.classList.add('toolbox-item--selected');
        onSelect(item, opts || {});
      });
    }

    function appendEquipmentItem(item) {
      var el = document.createElement('div');
      var isFdt = item.id === 'fdt';
      el.className = 'toolbox-item flex items-center gap-3 p-3 rounded-xl border border-fiber-border bg-fiber-card hover:border-fiber-cyan/40 transition-all select-none cursor-pointer';
      el.dataset.type = item.id;
      if (isFdt) el.classList.add('toolbox-item--fdt-head');
      if (item.nestOnly) el.classList.add('toolbox-item--nest');
      if (isDraggableTool(item)) {
        el.draggable = true;
        el.setAttribute('draggable', 'true');
        el.addEventListener('dragstart', function (e) {
          e.dataTransfer.setData('text/tool-type', item.id);
          e.dataTransfer.effectAllowed = 'copy';
          armToolboxSelection(item.id);
          syncDrawingLayerInteraction();
        });
      }
      var iconInner = item.visual
        ? '<span class="toolbox-item__icon toolbox-item__icon--' + item.visual + ' text-xl w-9 h-9 shrink-0 flex items-center justify-center rounded-lg" style="background:' +
          item.color + '18;border:1px solid ' + item.color + '44">' + toolboxIconHtml(item) + '</span>'
        : '<span class="toolbox-item__icon text-xl w-9 h-9 shrink-0 flex items-center justify-center rounded-lg" style="background:' +
          item.color + '22;border:1px solid ' + item.color + '44">' + item.icon + '</span>';
      el.innerHTML = iconInner +
        '<div class="toolbox-item__text toolbox-collapsible-text flex-1 min-w-0"><p class="text-xs font-semibold text-white truncate">' + item.label + '</p></div>';
      bindItemClick(el, item, function (it, opts) {
        armToolboxSelection(it.id, 'Tool: ' + it.label + (it.nestOnly ? ' (drop onto host)' : ''), opts);
        Sim.selectedPath = null;
        setInteractionMode('select');
      });
      box.appendChild(el);
    }

    EQUIPMENT.forEach(appendEquipmentItem);

    appendLMHolesCategory(box);
    appendLMPolesCategory(box);
    appendPenToolSection(box);

    appendSplitterDropdownCard(box);
    bindToolboxDragPreview();
    bindToolboxDeselectOnDblClick();
    global.FTTHUiController?.rebindToolboxHover?.();
    global.FTTHVisibilityManager?.bindToolbox?.(box);
    global.FTTHToolboxInventory?.bindToolbox?.(box);
    global.FTTHToolboxManager?.onToolboxRendered?.(box);
    updateToolboxAssetCounts();
    bindFdtHeadSwitcherEvents();
    syncActiveFdtChrome();
  }

  /* ─── Field SVG icons ─── */
  function parseSplitterRatio(ratioStr) {
    var p = (ratioStr || '1x8').toLowerCase().split('x');
    return { inputs: parseInt(p[0], 10) || 1, outputs: parseInt(p[1], 10) || 8 };
  }

  function splitterRatioLabel(ratioStr) {
    var spec = parseSplitterRatio(ratioStr);
    return spec.inputs + '×' + spec.outputs;
  }

  function splitterParts(ratioStr) {
    var spec = parseSplitterRatio(ratioStr);
    var parts = [];
    var label = splitterRatioLabel(ratioStr);
    var apexX = 14;
    var baseX = 34;
    var topY = 10;
    var botY = 38;
    var midY = 24;

    parts.push('<polygon points="' + apexX + ',' + midY + ' ' + baseX + ',' + topY + ' ' + baseX + ',' + botY +
      '" fill="' + FIELD_SPLITTER_FILL + '" stroke="' + FIELD_SPLITTER_STROKE + '" stroke-width="1.5" stroke-linejoin="round"/>');
    parts.push('<text x="23" y="25" text-anchor="middle" dominant-baseline="middle" fill="' + FIELD_SPLITTER_TEXT + '" font-size="6.5" font-weight="800" font-family="Consolas,monospace">' +
      label + '</text>');

    if (spec.inputs === 2) {
      parts.push('<line x1="2" y1="17" x2="' + apexX + '" y2="20" stroke="' + FIELD_SPLITTER_LINE + '" stroke-width="1.6" stroke-linecap="round"/>');
      parts.push('<line x1="2" y1="31" x2="' + apexX + '" y2="28" stroke="' + FIELD_SPLITTER_LINE + '" stroke-width="1.6" stroke-linecap="round"/>');
    } else {
      parts.push('<line x1="2" y1="' + midY + '" x2="' + apexX + '" y2="' + midY + '" stroke="' + FIELD_SPLITTER_LINE + '" stroke-width="1.6" stroke-linecap="round"/>');
    }

    var outDraw = Math.min(spec.outputs, 12);
    for (var i = 0; i < outDraw; i++) {
      var oy = outDraw === 1 ? midY : topY + 4 + ((botY - topY - 8) * i / Math.max(outDraw - 1, 1));
      parts.push('<line x1="' + baseX + '" y1="' + oy + '" x2="46" y2="' + oy + '" stroke="' + FIELD_SPLITTER_LINE + '" stroke-width="1.2" stroke-linecap="round"/>');
    }
    return parts;
  }

  function cableIconSvg(capacity, kind, size) {
    var s = size || 24;
    var stroke = kind === 'lastmile' ? '#0ea5e9' : '#3b82f6';
    var fill = kind === 'lastmile' ? 'rgba(14,165,233,0.18)' : 'rgba(59,130,246,0.18)';
    return '<svg class="field-icon field-icon--cable field-icon--cable-' + capacity + '" viewBox="0 0 32 32" width="' + s + '" height="' + s + '" aria-hidden="true">' +
      '<rect x="4" y="10" width="24" height="12" rx="3" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.4"/>' +
      '<line x1="8" y1="14" x2="24" y2="14" stroke="' + stroke + '" stroke-width="1" opacity="0.45"/>' +
      '<line x1="8" y1="18" x2="24" y2="18" stroke="' + stroke + '" stroke-width="1" opacity="0.45"/>' +
      '<text x="16" y="18" text-anchor="middle" dominant-baseline="middle" fill="' + stroke + '" font-size="7.5" font-weight="800" font-family="Consolas,monospace">' +
      capacity + 'F</text></svg>';
  }

  function splitterIconSvg(ratioStr, size) {
    var s = size || 36;
    return '<svg class="field-icon field-icon--splitter" viewBox="0 0 48 48" width="' + s + '" height="' + s + '" aria-hidden="true" overflow="visible">' +
      splitterParts(ratioStr).join('') + '</svg>';
  }

  function handholeMapGlyph(size) {
    var s = size || 28;
    return '<span class="field-glyph field-glyph--handhole" style="width:' + s + 'px;height:' + s + 'px" aria-hidden="true"></span>';
  }

  function fatHandholeMapGlyph(size) {
    var s = size || 28;
    /* Static SVG — no transform attribute; orientation from #canvas-zoom-inner only. */
    return '<svg class="field-glyph field-glyph--fat-handhole" style="width:' + s + 'px;height:' + s + 'px" viewBox="0 0 48 48" aria-hidden="true">' +
      '<polygon class="fat-handhole-triangle" points="24,5 43,42 5,42" fill="none" stroke="' + FIELD_HH_GREEN + '" stroke-width="6" stroke-linejoin="miter"/>' +
      '</svg>';
  }

  function fatPoleMapGlyph() {
    /* Tip → square outline → stem; ymax = stem bottom = anchor (viewBox height). */
    var d = 'M 12 0.5 L 12 3 L 14.25 3 L 14.25 7.5 L 9.75 7.5 L 9.75 3 L 12 3 L 12 7.5 L 12 ' + FAT_POLE_GLYPH_H;
    /* Static SVG path — passive child of .fat-unified-map-marker / .fat-pole-stack. */
    return '<svg class="field-glyph field-glyph--fat-pole fat-pole-glyph" viewBox="0 0 ' + FAT_POLE_GLYPH_W + ' ' + FAT_POLE_GLYPH_H + '" width="100%" height="100%" aria-hidden="true">' +
      '<path class="fat-pole-path" d="' + d + '" fill="none" stroke="#808080" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="miter"/>' +
      '</svg>';
  }

  function handholeIconSvg(size) {
    return handholeMapGlyph(size || 28);
  }

  function fatHandholeIconSvg(size) {
    return fatHandholeMapGlyph(size || 28);
  }

  function fatPoleIconHtml(size) {
    return '<div class="fat-pole fat-pole--mini" aria-hidden="true">' + fatPoleMapGlyph() + '</div>';
  }

  function fatPoleHtml(node) {
    var boxInner = '';
    if (node && node.fatSplitter) {
      boxInner = '<div class="splitter-inside-fat">' + splitterIconSvg(node.fatSplitter, 12) + '</div>';
    }
    return '<div class="fat-pole pole-icon fat-pole-icon" aria-hidden="true">' + fatPoleMapGlyph() + boxInner + '</div>';
  }

  function fatPoleStackHtml(node) {
    var parts = [];
    parts.push(fatPoleHtml(node));
    if (node && node.hasFatPole) {
      var name = escapeSidebarHtml(resolveComponentMapLabel(node) || node.fatSystemName || '');
      if (name) {
        parts.push(
          '<span class="element-label element-label--fat-system field-node-label field-node-label--map ' +
          'field-node-label--fat-system pole-label" data-label-key="unified" role="button" tabindex="-1" ' +
          'aria-label="' + name + '">' + name + '</span>'
        );
      }
    }
    return '<div class="fat-pole-stack">' + parts.join('') + '</div>';
  }

  function shouldUseExpandedClosure(node) {
    return !!(node && node.type === 'fat_handhole' && node.hasFatPole && node.hasClosure);
  }

  function closureWrapperHtml(node, size, context) {
    if (context === 'fat_handhole') {
      var wrapperCls = 'closure-inside-fat-handhole';
      var clSize;
      if (shouldUseExpandedClosure(node)) {
        wrapperCls += ' expanded-closure';
        clSize = 25;
      } else {
        clSize = Math.max(12, Math.round(size * 0.55));
      }
      return '<div class="' + wrapperCls + '">' + closureIconSvg(clSize) + '</div>';
    }
    var hhSize = Math.max(12, Math.round(size * 0.62));
    return '<div class="closure-inside-handhole">' + closureIconSvg(hhSize) + '</div>';
  }

  function fatHandholeHostHtml(node, size) {
    var s = size || iconSizeForStackLayer(node);
    var host = '<div class="fat-handhole-base">' + fatHandholeMapGlyph(s);
    if (node.hasClosure) {
      host += closureWrapperHtml(node, s, 'fat_handhole');
    }
    host += '</div>';
    return host;
  }

  function fatSystemHtml(node, size) {
    var anchorCls = 'fat-system-anchor';
    if (node.hasFatPole) anchorCls += ' fat-system-anchor--with-pole';
    var markerOpen = node.hasFatPole
      ? '<div class="fat-rigid-marker fat-unified-map-marker" data-map-marker="fat-unified">'
      : '<div class="fat-rigid-marker">';
    return '<div class="' + anchorCls + '">' +
      markerOpen +
        fatHandholeHostHtml(node, size) +
        (node.hasFatPole ? fatPoleStackHtml(node) : '') +
      '</div>' +
    '</div>';
  }

  function closureIconSvg(size) {
    var s = size || iconBaseSize('closure');
    return svgOpenTag('field-icon--closure', s, s, '0 0 48 48') +
      '<rect x="14" y="14" width="20" height="20" fill="' + FIELD_CL_RED + '" stroke="#ffffff" stroke-width="2.5"/>' +
      '<rect x="22" y="22" width="4" height="4" fill="#ffffff"/>' +
      '</svg>';
  }

  function fdtCabinetGlyphHtml(size) {
    var s = size || iconBaseSize('fdt') || 28;
    var h = Math.max(26, Math.round(s * 1.14));
    return '<div class="fdt-cabinet-glyph" style="width:' + s + 'px;height:' + h + 'px" aria-hidden="true">' +
      '<div class="fdt-body"><div class="fdt-door"></div><span class="fdt-label">FDT</span></div></div>';
  }

  function oltBuildingGlyphHtml(size) {
    var s = size || iconBaseSize('olt') || 28;
    return '<div class="olt-building-glyph" style="width:' + s + 'px;height:' + s + 'px" aria-hidden="true">' +
      '<span class="olt-glyph" role="img" aria-label="OLT">🏛️</span></div>';
  }

  function greenTriangleIconSvg(size, classExtra) {
    var s = size || iconBaseSize('handhole');
    var extra = classExtra ? ' ' + classExtra : '';
    return '<svg class="field-icon field-icon--green-triangle' + extra + '" viewBox="0 0 48 48" width="' + s + '" height="' + s + '" aria-hidden="true">' +
      '<polygon points="24,10 40,38 8,38" fill="' + FIELD_HH_GREEN_FILL + '" stroke="' + FIELD_HH_GREEN + '" stroke-width="2.5" stroke-linejoin="round"/>' +
      '</svg>';
  }

  function excavationPenIconSvg(size) {
    var s = size || 28;
    return '<svg class="field-icon field-icon--excav-pen" viewBox="0 0 48 48" width="' + s + '" height="' + s + '" aria-hidden="true">' +
      '<path d="M10 38 L16 32 L32 16 L38 22 L22 38 Z" fill="#fbbf24" stroke="#f59e0b" stroke-width="2" stroke-linejoin="round"/>' +
      '<line x1="32" y1="10" x2="40" y2="18" stroke="#94a3b8" stroke-width="2.5" stroke-linecap="round"/>' +
      '<circle cx="40" cy="10" r="2" fill="#64748b"/>' +
      '</svg>';
  }

  function excavationToolIconSvg(routeKind, size) {
    var s = size || 24;
    var tool = null;
    for (var i = 0; i < EXCAVATION_TOOLS.length; i++) {
      if (EXCAVATION_TOOLS[i].routeKind === routeKind) { tool = EXCAVATION_TOOLS[i]; break; }
    }
    var stroke = tool ? tool.color : '#78716c';
    var dash = tool && tool.dash ? tool.dash : '';
    return '<svg class="field-icon field-icon--excav field-icon--excav-' + routeKind + '" viewBox="0 0 48 48" width="' + s + '" height="' + s + '" aria-hidden="true">' +
      '<line x1="6" y1="36" x2="42" y2="12" stroke="' + stroke + '" stroke-width="3" stroke-linecap="round"' +
      (dash ? ' stroke-dasharray="' + dash + '"' : '') + '/>' +
      '<circle cx="6" cy="36" r="3" fill="' + stroke + '"/><circle cx="42" cy="12" r="3" fill="' + stroke + '"/>' +
      '</svg>';
  }

  function handholeClosureIconSvg(size) {
    var s = size || iconBaseSize('handhole');
    return handholeMapGlyph(s);
  }

  var LABEL_DRAG_LIMIT = 10;
  var LABEL_OFFSET_BASE_PX = 6;
  var LABEL_OFFSET_MIN_PX = 3;
  var LABEL_OFFSET_MAX_PX = 8;
  var LABEL_OFFSET_ZOOM_EXPONENT = 0.55;

  function clampLabelOffset(value) {
    return Math.max(-LABEL_DRAG_LIMIT, Math.min(LABEL_DRAG_LIMIT, value));
  }

  function getZoomAdaptiveLabelOffsetPx(basePx, minPx, maxPx) {
    var z = Number(Sim && Sim.zoom);
    if (!isFinite(z) || z <= 0) z = 1;
    var scaled = Number(basePx) / Math.pow(z, LABEL_OFFSET_ZOOM_EXPONENT);
    return Math.max(Number(minPx), Math.min(Number(maxPx), scaled));
  }

  function clampLabelPositionFromAnchorCenter(left, top, anchorEl) {
    if (!anchorEl) return { left: left, top: top };
    var centerX = anchorEl.offsetWidth / 2;
    var centerY = anchorEl.offsetHeight / 2;
    var dx = clampLabelOffset(left - centerX);
    var dy = clampLabelOffset(top - centerY);
    return { left: centerX + dx, top: centerY + dy };
  }

  function ensureNodeLabelOffsets(node) {
    if (!node.labelOffsets) node.labelOffsets = {};
  }

  function getLabelOffset(node, key) {
    ensureNodeLabelOffsets(node);
    return node.labelOffsets[key] || null;
  }

  function defaultLabelBottom(key) {
    return -getZoomAdaptiveLabelOffsetPx(
      LABEL_OFFSET_BASE_PX,
      LABEL_OFFSET_MIN_PX,
      LABEL_OFFSET_MAX_PX
    );
  }

  function usesPoleCenterLabel(node, key) {
    return key === 'unified' && node && node.type === 'fat_handhole' && node.hasFatPole;
  }

  function poleSquareLabelTopPx(node, anchorEl) {
    var poleEl = anchorEl && anchorEl.classList && anchorEl.classList.contains('fat-pole-stack')
      ? anchorEl.querySelector('.fat-pole, .pole-icon, .fat-pole-icon')
      : null;
    var anchorH = (poleEl && poleEl.offsetHeight > 0)
      ? poleEl.offsetHeight
      : (anchorEl && anchorEl.offsetHeight > 0 ? anchorEl.offsetHeight : iconSizeForStackLayer(node));
    return (anchorH / 2) - FAT_POLE_GLYPH_H + FAT_POLE_BOX_CENTER_Y;
  }

  function applyElementLabelStyle(labelEl, node, key) {
    if (!labelEl || !node) return;
    var isFatPoleLabel = !!(usesPoleCenterLabel(node, key) &&
      (labelEl.closest('.fat-pole-stack') || labelEl.closest('.fat-rigid-marker')));
    if (isFatPoleLabel) {
      var rigidMarker = labelEl.closest('.fat-rigid-marker');
      labelEl.textContent = labelEl.textContent || '';
      if (rigidMarker) quarantineFatRigidMarkerChildren(rigidMarker);
      labelEl.classList.remove('is-dragged');
      labelEl.classList.remove('field-map-entity__label--upright');
      labelEl.classList.remove('pole-label--column-spin');
      return;
    }
    var off = getLabelOffset(node, key);
    labelEl.style.display = 'inline-block';
    labelEl.style.visibility = 'visible';
    labelEl.style.opacity = '1';
    labelEl.style.margin = '0';
    labelEl.style.zIndex = '9999';
    labelEl.textContent = labelEl.textContent || '';
    if (off && off.mode === 'custom') {
      if (isFatRigidMarkerChild(labelEl)) {
        quarantineFatRigidMarkerChildren(labelEl.closest('.fat-rigid-marker'));
        return;
      }
      var anchorEl = labelEl.parentElement;
      var clamped = clampLabelPositionFromAnchorCenter(off.left, off.top, anchorEl);
      off.left = clamped.left;
      off.top = clamped.top;
      labelEl.style.position = 'absolute';
      labelEl.style.left = off.left + 'px';
      labelEl.style.top = off.top + 'px';
      labelEl.style.bottom = 'auto';
      labelEl.style.transform = 'none';
      labelEl.classList.add('is-dragged');
    } else {
      var dx = clampLabelOffset((off && off.x) || 0);
      var dy = clampLabelOffset((off && off.y) || 0);
      labelEl.style.position = 'absolute';
      labelEl.style.left = 'calc(50% + ' + dx + 'px)';
      labelEl.style.right = 'auto';
      if (usesPoleCenterLabel(node, key)) {
        if (labelEl.closest('.fat-rigid-marker')) {
          quarantineFatRigidMarkerChildren(labelEl.closest('.fat-rigid-marker'));
          return;
        }
        var poleAnchor = labelEl.parentElement;
        labelEl.style.top = (poleSquareLabelTopPx(node, poleAnchor) + dy) + 'px';
        labelEl.style.bottom = 'auto';
        labelEl.style.textAlign = 'center';
        labelEl.style.lineHeight = '1';
        labelEl.style.transform = 'translate(-50%, -50%)';
      } else {
        labelEl.style.top = 'auto';
        labelEl.style.bottom = (defaultLabelBottom(key) + dy) + 'px';
        labelEl.style.transform = 'translateX(-50%)';
      }
      labelEl.classList.remove('is-dragged');
    }
  }

  function startElementLabelDrag(node, key, labelEl, anchorEl, e) {
    if (node.locked || isHandholeNodePositionLocked(node)) return;
    if (isFatRigidMarkerChild(labelEl)) return;
    var anchorRect = anchorEl.getBoundingClientRect();
    var labelRect = labelEl.getBoundingClientRect();
    var off = getLabelOffset(node, key);
    var startLeft = off && off.mode === 'custom' ? off.left : (labelRect.left - anchorRect.left);
    var startTop = off && off.mode === 'custom' ? off.top : (labelRect.top - anchorRect.top);

    ensureNodeLabelOffsets(node);
    node.labelOffsets[key] = { mode: 'custom', left: startLeft, top: startTop };
    applyElementLabelStyle(labelEl, node, key);

    var startX = e.clientX;
    var startY = e.clientY;
    var moved = false;
    labelEl.classList.add('is-dragging');

    function onMouseMove(ev) {
      moved = true;
      var centerX = anchorEl.offsetWidth / 2;
      var centerY = anchorEl.offsetHeight / 2;
      var deltaX = startLeft + (ev.clientX - startX) - centerX;
      var deltaY = startTop + (ev.clientY - startY) - centerY;
      var constrainedX = clampLabelOffset(deltaX);
      var constrainedY = clampLabelOffset(deltaY);
      node.labelOffsets[key].left = centerX + constrainedX;
      node.labelOffsets[key].top = centerY + constrainedY;
      applyElementLabelStyle(labelEl, node, key);
    }

    function onMouseUp() {
      labelEl.classList.remove('is-dragging');
      var clamped = clampLabelPositionFromAnchorCenter(
        node.labelOffsets[key].left,
        node.labelOffsets[key].top,
        anchorEl
      );
      node.labelOffsets[key].left = clamped.left;
      node.labelOffsets[key].top = clamped.top;
      applyElementLabelStyle(labelEl, node, key);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      Sim.labelDragSession = null;
      if (moved) saveState();
    }

    Sim.labelDragSession = { nodeId: node.id, key: key };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  function attachNodeLabels(placedEl, node) {
    if (!placedEl || !node) return;
    var anchor = placedEl.querySelector('.placed-node__glyph-anchor');
    if (!anchor) return;

    anchor.querySelectorAll('.element-label[data-label-key]').forEach(function (el) {
      el.remove();
    });
    placedEl.querySelectorAll('.marker-container .element-label[data-label-key]').forEach(function (el) {
      el.remove();
    });
    placedEl.querySelectorAll(':scope > .fat-pole-stack, :scope > .fat-pole, :scope > .marker-container').forEach(function (el) {
      el.remove();
    });
    placedEl.querySelectorAll('.fat-rigid-marker .element-label[data-label-key]').forEach(function (el) {
      if (node.type === 'fat_handhole' && node.hasFatPole &&
          el.getAttribute('data-label-key') === 'unified' && el.closest('.fat-pole-stack')) {
        return;
      }
      el.remove();
    });

    function bindLabelPointer(nodeRef, entryRef, labelEl, dragAnchorEl) {
      labelEl.addEventListener('mousedown', function (e) {
        if (nodeRef.locked) return;
        if (e.button !== 0) return;
        e.stopPropagation();
        var downX = e.clientX;
        var downY = e.clientY;
        var dragArmed = false;

        function onDocMove(ev) {
          if (dragArmed) return;
          if (Math.hypot(ev.clientX - downX, ev.clientY - downY) > 3) {
            dragArmed = true;
            startElementLabelDrag(nodeRef, entryRef.key, labelEl, dragAnchorEl, e);
          }
        }

        function onDocUp(ev) {
          document.removeEventListener('mousemove', onDocMove);
          document.removeEventListener('mouseup', onDocUp);
          if (!dragArmed) onPlacedNodeClick(nodeRef.id, ev);
        }

        document.addEventListener('mousemove', onDocMove);
        document.addEventListener('mouseup', onDocUp);
      });
    }

    /* Only the FAT pole stack keeps an on-node label (rotates with the pole).
       All other component IDs are rendered once by LabelManager overlay. */
    getNodeLabelEntries(node).forEach(function (entry) {
      if (!usesPoleCenterLabel(node, entry.key)) return;
      var preset = placedEl.querySelector('.fat-pole-stack .element-label[data-label-key="unified"]');
      if (preset) {
        preset.textContent = entry.text;
        preset.setAttribute('aria-label', entry.text);
        applyElementLabelStyle(preset, node, entry.key);
        preset.style.fontSize = Math.max(10, Sim.settings.labelFontSize || 11) + 'px';
        if (Sim.settings.labelColor) preset.style.color = Sim.settings.labelColor;
        var presetStack = preset.closest('.fat-pole-stack') || preset.parentElement;
        bindLabelPointer(node, entry, preset, presetStack);
        return;
      }
      var marker = placedEl.querySelector('.fat-rigid-marker');
      var stack = marker && marker.querySelector('.fat-pole-stack');
      var mount = stack || marker || anchor;
      var lbl = document.createElement('span');
      lbl.className = 'element-label element-label--fat-system field-node-label field-node-label--map ' +
        'field-node-label--fat-system pole-label';
      lbl.setAttribute('data-label-key', 'unified');
      lbl.setAttribute('role', 'button');
      lbl.setAttribute('tabindex', '-1');
      lbl.setAttribute('aria-label', entry.text);
      lbl.textContent = entry.text;
      if (mount.classList.contains('fat-pole-stack') || mount.classList.contains('fat-rigid-marker')) {
        mount.insertBefore(lbl, mount.firstChild);
      } else {
        mount.appendChild(lbl);
      }
      applyElementLabelStyle(lbl, node, entry.key);
      lbl.style.fontSize = Math.max(10, Sim.settings.labelFontSize || 11) + 'px';
      if (Sim.settings.labelColor) lbl.style.color = Sim.settings.labelColor;
      bindLabelPointer(node, entry, lbl, mount);
    });

    var rigidMarker = placedEl.querySelector('.fat-rigid-marker');
    if (rigidMarker) quarantineFatRigidMarkerChildren(rigidMarker);
  }

  function bindDraggableLabels(placedEl, node) {
    attachNodeLabels(placedEl, node);
  }

  function handholeHostHtml(node, size) {
    var s = size || iconSizeForStackLayer(node);
    var host = '<div class="placed-node__handhole-host">' + handholeMapGlyph(s);
    if (node.hasClosure) {
      host += closureWrapperHtml(node, s, 'handhole');
    }
    host += '</div>';
    return host;
  }

  function buildNodeStackHtml(node) {
    var layers = [];
    var sz = function () { return iconSizeForStackLayer(node); };

    if (node.type === 'handhole') {
      layers.push(
        '<div class="placed-node__glyph-anchor">' +
          '<div class="placed-node__layer placed-node__layer--base placed-node__layer--handhole">' +
            handholeHostHtml(node, sz()) +
          '</div>' +
        '</div>'
      );
    } else if (node.type === 'fat_handhole') {
      layers.push(
        '<div class="placed-node__glyph-anchor">' +
          '<div class="placed-node__layer placed-node__layer--base placed-node__layer--fat-handhole">' +
            fatSystemHtml(node, sz()) +
          '</div>' +
        '</div>'
      );
    } else if (node.type === 'fdt') {
      var fdtLayers = '';
      if (node.fatSplitter) {
        fdtLayers += '<div class="placed-node__layer placed-node__layer--splitter">' + splitterIconSvg(node.fatSplitter, sz()) + '</div>';
      }
      fdtLayers += '<div class="placed-node__layer placed-node__layer--base placed-node__layer--fdt">' + fdtCabinetGlyphHtml(sz()) + '</div>';
      layers.push(
        '<div class="placed-node__glyph-anchor">' +
          '<div class="placed-node__fdt-stack">' + fdtLayers + '</div>' +
        '</div>'
      );
    } else if (node.type === 'olt') {
      layers.push(
        '<div class="placed-node__glyph-anchor">' +
          '<div class="placed-node__layer placed-node__layer--base placed-node__layer--olt">' +
            oltBuildingGlyphHtml(sz()) +
          '</div>' +
        '</div>'
      );
    }

    return '<div class="placed-node__stack">' + layers.join('') + '</div>';
  }

  function buildPlacedNodeContent(node) {
    return buildNodeStackHtml(node);
  }

  function syncPlacedNodeCellClasses(node) {
    var el = document.querySelector('.placed-node[data-id="' + node.id + '"]');
    if (!el) return;
    var cell = getGridCellForNode(node) || getGridCellForNodeElement(el);
    if (cell && cell.classList.contains('grid-cell')) {
      cell.classList.toggle('has-fat-handhole', node.type === 'fat_handhole');
    }
  }

  function updatePlacedNodeContent(node) {
    dedupePlacedNodesById(node.id);
    var el = document.querySelector('.placed-node[data-id="' + node.id + '"]');
    if (!el) {
      renderNode(node);
      return;
    }
    el.classList.add('placed-node--top-layer');
    el.classList.toggle('placed-node--fat-pole', node.type === 'fat_handhole' && !!node.hasFatPole);
    if (node.type === 'fat_handhole' && node.hasFatPole) {
      el.setAttribute('data-map-marker', 'fat-unified');
    } else {
      el.removeAttribute('data-map-marker');
    }
    el.innerHTML = buildPlacedNodeContent(node);
    el.title = getNodeTitle(node);
    applyCellLockPosition(el, node);
    syncPlacedNodeCellClasses(node);
    bindDraggableLabels(el, node);
    if (isFatHandholeMapNode(node)) pinFatRigidMarkerPosition(node);
    if (Sim.selectedNodeId === node.id) {
      requestAnimationFrame(positionNodeActionHud);
    }
  }

  function patchHandholeClosure(node) { updatePlacedNodeContent(node); }

  /* ─── Training cities ─── */
  var TRAINING_CITIES = {
    training_city_1: { id: 'training_city_1', cols: 48, rows: 34, cellSize: 22, fdtCapacity: 4 },
    training_city_2: { id: 'training_city_2', cols: 62, rows: 44, cellSize: 20, fdtCapacity: 8 },
    training_city_3: { id: 'training_city_3', cols: 78, rows: 56, cellSize: 18, fdtCapacity: 16 },
  };

  function makeGrid(cols, rows) {
    var cells = new Array(cols * rows);
    for (var i = 0; i < cells.length; i++) cells[i] = { type: CELL.BUILD, label: '' };
    return cells;
  }

  function idx(c, r, cols) { return r * cols + c; }

  function paintHStreet(cells, cols, rows, r, c0, c1) {
    for (var c = c0; c <= c1; c++) {
      if (c < 0 || c >= cols || r < 0 || r >= rows) continue;
      cells[idx(c, r, cols)] = { type: CELL.STREET, label: '' };
      if (r - 1 >= 0) cells[idx(c, r - 1, cols)] = { type: CELL.SIDEWALK, label: '' };
      if (r + 1 < rows) cells[idx(c, r + 1, cols)] = { type: CELL.SIDEWALK, label: '' };
    }
  }

  function paintVStreet(cells, cols, rows, c, r0, r1) {
    for (var r = r0; r <= r1; r++) {
      if (c < 0 || c >= cols || r < 0 || r >= rows) continue;
      cells[idx(c, r, cols)] = { type: CELL.STREET, label: '' };
      if (c - 1 >= 0) cells[idx(c - 1, r, cols)] = { type: CELL.SIDEWALK, label: '' };
      if (c + 1 < cols) cells[idx(c + 1, r, cols)] = { type: CELL.SIDEWALK, label: '' };
    }
  }

  function fillRect(cells, cols, rows, x, y, w, h, type, label) {
    for (var cy = y; cy < y + h; cy++) {
      for (var cx = x; cx < x + w; cx++) {
        if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) continue;
        var cur = cells[idx(cx, cy, cols)];
        if (cur.type === CELL.STREET || cur.type === CELL.SIDEWALK) continue;
        cells[idx(cx, cy, cols)] = { type: type, label: label || '' };
      }
    }
  }

  function placeItpc(cells, cols, rows, x, y, w, h) {
    fillRect(cells, cols, rows, x, y, w, h, CELL.ITPC, 'ITPC Exchange');
    cells[idx(x + 1, y + 1, cols)].label = 'Main ITPC Building';
    cells[idx(x + w - 2, y + 1, cols)].label = 'OLT Core Hub';
    cells[idx(x + Math.floor(w / 2), y + h - 2, cols)].label = 'Fiber Cross-Connect';
  }

  function placeResBlock(cells, cols, rows, x, y, w, h, blockName, homes) {
    fillRect(cells, cols, rows, x, y, w, h, CELL.RES_BLOCK, blockName + ' — ' + homes + ' Homes');
  }

  function pickHomes(seed) { return HOME_COUNTS[seed % HOME_COUNTS.length]; }

  function generateCity1() {
    var cfg = TRAINING_CITIES.training_city_1;
    var cols = cfg.cols, rows = cfg.rows, cells = makeGrid(cols, rows);
    placeItpc(cells, cols, rows, 2, 2, 8, 6);
    paintHStreet(cells, cols, rows, 10, 0, cols - 1);
    paintHStreet(cells, cols, rows, 22, 0, cols - 1);
    paintVStreet(cells, cols, rows, 12, 0, rows - 1);
    paintVStreet(cells, cols, rows, 28, 0, rows - 1);
    placeResBlock(cells, cols, rows, 14, 12, 10, 8, 'Residential Block A', pickHomes(0));
    placeResBlock(cells, cols, rows, 30, 12, 10, 8, 'Residential Block B', pickHomes(1));
    placeResBlock(cells, cols, rows, 14, 24, 10, 8, 'Residential Block C', pickHomes(2));
    fillRect(cells, cols, rows, 36, 3, 6, 5, CELL.POI, 'Community Market');
    fillRect(cells, cols, rows, 36, 24, 5, 5, CELL.POI, 'Mosque');
    fillRect(cells, cols, rows, 14, 3, 6, 5, CELL.POI, 'School');
    fillRect(cells, cols, rows, 30, 24, 8, 6, CELL.PARK, 'Central Park');
    return { cfg: cfg, cols: cols, rows: rows, cellSize: cfg.cellSize, cells: cells };
  }

  function generateCity2() {
    var cfg = TRAINING_CITIES.training_city_2;
    var cols = cfg.cols, rows = cfg.rows, cells = makeGrid(cols, rows);
    placeItpc(cells, cols, rows, 2, 2, 10, 7);
    for (var r = 12; r < rows; r += 10) paintHStreet(cells, cols, rows, r, 0, cols - 1);
    for (var c = 10; c < cols; c += 12) paintVStreet(cells, cols, rows, c, 0, rows - 1);
    placeResBlock(cells, cols, rows, 12, 14, 9, 7, 'Residential Block A', pickHomes(3));
    placeResBlock(cells, cols, rows, 24, 14, 9, 7, 'Residential Block B', pickHomes(4));
    placeResBlock(cells, cols, rows, 36, 14, 9, 7, 'Residential Block C', pickHomes(5));
    placeResBlock(cells, cols, rows, 48, 14, 9, 7, 'Residential Block D', pickHomes(6));
    placeResBlock(cells, cols, rows, 12, 26, 12, 8, 'Apartment Block E', pickHomes(7));
    placeResBlock(cells, cols, rows, 28, 26, 12, 8, 'Apartment Block F', pickHomes(8));
    fillRect(cells, cols, rows, 44, 3, 10, 6, CELL.POI, 'Commercial Complex');
    fillRect(cells, cols, rows, 44, 28, 12, 8, CELL.POI, 'Healthcare Hospital');
    fillRect(cells, cols, rows, 14, 3, 8, 6, CELL.PARK, 'Public Garden');
    return { cfg: cfg, cols: cols, rows: rows, cellSize: cfg.cellSize, cells: cells };
  }

  function generateCity3() {
    var cfg = TRAINING_CITIES.training_city_3;
    var cols = cfg.cols, rows = cfg.rows, cells = makeGrid(cols, rows);
    placeItpc(cells, cols, rows, 2, 2, 12, 8);
    paintHStreet(cells, cols, rows, 14, 0, cols - 1);
    paintHStreet(cells, cols, rows, 28, 0, cols - 1);
    paintHStreet(cells, cols, rows, 42, 0, cols - 1);
    for (var c = 8; c < cols; c += 10) paintVStreet(cells, cols, rows, c, 0, rows - 1);
    paintVStreet(cells, cols, rows, 26, 0, rows - 1);
    paintVStreet(cells, cols, rows, 52, 0, rows - 1);
    var blocks = [
      [10, 16, 10, 10, 'Residential Block A', 0], [22, 16, 10, 10, 'Residential Block B', 1],
      [34, 16, 10, 10, 'Residential Block C', 2], [46, 16, 10, 10, 'Residential Block D', 3],
      [58, 16, 10, 10, 'Residential Block E', 4], [10, 30, 12, 10, 'Residential Block F', 5],
      [24, 30, 12, 10, 'Residential Block G', 6], [38, 30, 12, 10, 'Residential Block H', 7],
      [54, 30, 12, 10, 'Residential Block I', 8], [10, 44, 14, 10, 'Residential Block J', 9],
      [28, 44, 14, 10, 'Residential Block K', 10], [48, 44, 14, 10, 'Residential Block L', 11],
    ];
    blocks.forEach(function (b) {
      placeResBlock(cells, cols, rows, b[0], b[1], b[2], b[3], b[4], pickHomes(b[5]));
    });
    fillRect(cells, cols, rows, 58, 3, 14, 8, CELL.POI, 'University Campus');
    fillRect(cells, cols, rows, 36, 3, 12, 8, CELL.POI, 'Telecom Center');
    fillRect(cells, cols, rows, 16, 3, 10, 8, CELL.POI, 'Government Offices');
    fillRect(cells, cols, rows, 58, 44, 14, 10, CELL.POI, 'Shopping Mall');
    fillRect(cells, cols, rows, 36, 44, 10, 10, CELL.POI, 'Industrial Cluster');
    fillRect(cells, cols, rows, 24, 3, 8, 8, CELL.PARK, 'Smart Park');
    return { cfg: cfg, cols: cols, rows: rows, cellSize: cfg.cellSize, cells: cells };
  }

  function isCanvas2dCoordinateMode() {
    return Sim.coordinateMode === 'canvas2d';
  }

  function generateLayout(cityId) {
    if (cityId === 'uploaded_map' && Sim.uploadedMapLayout) {
      return Sim.uploadedMapLayout;
    }
    if (cityId === 'training_city_2') return generateCity2();
    if (cityId === 'training_city_3') return generateCity3();
    return generateCity1();
  }

  function renderVirtualCity() {
    Sim.layout = generateLayout(Sim.activeCityId);
    var L = Sim.layout;
    var grid = document.getElementById('city-grid');
    if (!grid) return;
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(' + L.cols + ', ' + L.cellSize + 'px)';
    grid.style.gridTemplateRows = 'repeat(' + L.rows + ', ' + L.cellSize + 'px)';
    grid.style.width = (L.cols * L.cellSize) + 'px';
    grid.style.height = (L.rows * L.cellSize) + 'px';

    grid.innerHTML = '';
    removeDragDropPreviewEl();
    ensureGlobalDrawingLayer();

    for (var r = 0; r < L.rows; r++) {
      for (var c = 0; c < L.cols; c++) {
        var cell = L.cells[idx(c, r, L.cols)];
        var div = document.createElement('div');
        div.className = 'grid-cell cell-' + cell.type;
        div.dataset.col = c;
        div.dataset.row = r;
        div.dataset.cellType = cell.type;
        if (cell.label) div.innerHTML = '<span class="cell-label">' + cell.label + '</span>';
        div.addEventListener('click', onVirtualCellClick);
        div.addEventListener('dblclick', onVirtualCellDblClick);
        div.addEventListener('dragover', onVirtualCellDragOver);
        div.addEventListener('dragleave', onVirtualCellDragLeave);
        div.addEventListener('drop', onVirtualCellDrop);
        grid.appendChild(div);
      }
    }
    renderAllNodes();
    renderConnections();
    updateMetrics();
    if (!Sim.ui.pathEditorBound) bindPenDrawingEvents();
    if (!Sim.ui.workspaceModeBound) bindWorkspaceModeEvents();
    if (!Sim.ui.workspaceDropBound) {
      grid.addEventListener('drop', onWorkspaceGridDrop);
      grid.addEventListener('dragover', onWorkspaceGridDragOver);
      grid.addEventListener('dragleave', onWorkspaceGridDragLeave);
      Sim.ui.workspaceDropBound = true;
    }
    bindDragDropCleanup();
    bindToolboxDragPreview();
    if (global.FTTHImageMapProject?.onCityRendered) {
      global.FTTHImageMapProject.onCityRendered();
    }
    syncBaseMapLayerSizes();
  }

  function onWorkspaceGridDrop(e) {
    e.preventDefault();
    if (Sim.interactionMode === 'hand' && !(Sim.ui && Sim.ui.clickToMoveActive)) return;
    if (e.target.closest('.placed-node')) {
      finishDragSession();
      return;
    }
    if (Sim.nestDropHandled) {
      Sim.nestDropHandled = false;
      finishDragSession();
      return;
    }
    var resolvedDrop = eventToGridCellWithFallback(e, null);
    var dropPt = resolvedDrop.point;
    var cell = resolvedDrop.cell;
    if (!dropPt) {
      finishDragSession();
      return;
    }
    var moveId = e.dataTransfer.getData('text/move-node-id') || Sim.dragMoveNodeId;
    if (moveId) {
      var moving = findNode(moveId);
      var moveCheck = checkValidPlacement(null, dropPt.col, dropPt.row, { moveNodeId: moveId });
      if (moving && !moving.locked && !isHandholeNodePositionLocked(moving) && moveCheck.state === 'valid') {
        relocateNode(moving, dropPt.col, dropPt.row, dropPt);
        if (cell) flashDropFeedback(cell, 'valid');
      } else if (cell) {
        flashDropFeedback(cell, 'invalid');
      }
      finishDragSession();
      return;
    }
    var type = e.dataTransfer.getData('text/tool-type');
    var variant = e.dataTransfer.getData('text/tool-variant') || Sim.selectedSplitterVariant || null;
    if (!type || type.indexOf('cable') === 0) {
      finishDragSession();
      return;
    }
    var existingAtCell = getNodeAt(dropPt.col, dropPt.row);
    if (existingAtCell && isNestTool(type) && canNestOnHost(type, existingAtCell)) {
      var nested = tryNestOnHost(type, existingAtCell, variant);
      if (cell) flashDropFeedback(cell, nested ? 'valid' : 'invalid');
      finishDragSession();
      return;
    }
    var placeCheck = checkValidPlacement(type, dropPt.col, dropPt.row);
    if (placeCheck.state === 'valid') {
      handlePlacement(type, dropPt.col, dropPt.row, variant, dropPt);
      if (cell) flashDropFeedback(cell, 'valid');
    } else if (cell) {
      flashDropFeedback(cell, 'invalid');
    }
    finishDragSession();
  }

  function getCellType(col, row) {
    if (!Sim.layout) return null;
    var i = idx(col, row, Sim.layout.cols);
    return Sim.layout.cells[i] ? Sim.layout.cells[i].type : null;
  }

  function getNodeAt(col, row) {
    for (var i = 0; i < Sim.nodes.length; i++) {
      if (Sim.nodes[i].col === col && Sim.nodes[i].row === row) return Sim.nodes[i];
    }
    return null;
  }

  function isClosureHost(node) {
    return node && (node.type === 'handhole' || node.type === 'fat_handhole');
  }

  function isFatPoleHost(node) {
    return node && node.type === 'fat_handhole' && !node.hasFatPole;
  }

  function canNestOnHost(toolType, hostNode) {
    if (!hostNode) return false;
    if (toolType === 'closure') return isClosureHost(hostNode) && !hostNode.hasClosure;
    if (toolType === 'fat_pole') return isFatPoleHost(hostNode);
    if (toolType === 'splitter') {
      if (hostNode.type === 'fdt' && !hostNode.fatSplitter) return true;
      if (hostNode.type === 'fat_handhole' && hostNode.hasFatPole && !hostNode.fatSplitter) return true;
      return false;
    }
    return false;
  }

  function tryNestOnHost(toolType, hostNode, variant) {
    if (toolType === 'closure') return tryInstallClosure(hostNode);
    if (toolType === 'fat_pole') return tryInstallFatPole(hostNode);
    if (toolType === 'splitter') return tryInstallSplitter(hostNode, variant);
    return false;
  }

  function canPlaceVirtual(type, col, row) {
    if (isCanvas2dCoordinateMode()) return true;
    var t = getCellType(col, row);
    if (SIDEWALK_TOOLS[type]) return t === CELL.SIDEWALK;
    return false;
  }

  function getDragContext(e) {
    var moveId = Sim.dragMoveNodeId;
    if (!moveId && e?.dataTransfer) {
      try { moveId = e.dataTransfer.getData('text/move-node-id'); } catch (err) { moveId = null; }
    }
    if (moveId) {
      var moving = findNode(moveId);
      return { mode: 'move', moveNodeId: moveId, type: moving ? moving.type : null };
    }
    var type = null;
    if (e?.dataTransfer) {
      try { type = e.dataTransfer.getData('text/tool-type'); } catch (err2) { type = null; }
    }
    if (!type) type = Sim.selectedTool;
    return { mode: 'place', type: type };
  }

  function buildDragPreviewContent(type) {
    if (!type) return '';
    if (type === 'handhole' || type === 'fat_handhole' || type === 'fdt' || type === 'olt') {
      var html = buildPlacedNodeContent({
        type: type,
        hasClosure: false,
        hasFatPole: false,
        fatSystemName: 'FH',
        fatSplitter: null,
      });

      if (type === 'fat_handhole') {
        html = html.replace(/pointer-events:\s*auto/gi, 'pointer-events: none');
        return '<div class="fat-ghost-safe" style="pointer-events: none !important;">' +
          html +
          '<style>.fat-ghost-safe, .fat-ghost-safe * { pointer-events: none !important; }</style>' +
          '</div>';
      }

      return html;
    }
    var sz = iconSizeForStackLayer({ type: type });
    if (type === 'closure') {
      return '<div class="ftth-drag-preview__glyph">' + closureIconSvg(sz) + '</div>';
    }
    if (type === 'fat_pole') {
      return '<div class="ftth-drag-preview__glyph">' + fatPoleIconHtml(sz) + '</div>';
    }
    if (type === 'splitter') {
      return '<div class="ftth-drag-preview__glyph">' +
        splitterIconSvg(Sim.selectedSplitterVariant || Sim.ui.splitterVariant || '1x8', sz) +
        '</div>';
    }
    var tool = findTool(type);
    if (tool) {
      return '<div class="ftth-drag-preview__glyph">' + toolboxIconHtml(tool) + '</div>';
    }
    return '';
  }

  function ensureDragDropPreviewEl() {
    var el = document.getElementById('ftth-drag-drop-preview');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'ftth-drag-drop-preview';
    el.className = 'ftth-drag-drop-preview';
    el.setAttribute('aria-hidden', 'true');
    var host = document.getElementById('city-canvas') || getWorkspaceGrid();
    if (host) host.appendChild(el);
    return el;
  }

  function hideDragDropPreviewEl() {
    var preview = document.getElementById('ftth-drag-drop-preview');
    if (!preview) return;
    preview.style.display = 'none';
    preview.classList.remove(
      'ftth-drag-drop-preview--valid',
      'ftth-drag-drop-preview--invalid',
      'ftth-drag-drop-preview--neutral'
    );
    preview.dataset.cacheKey = '';
  }

  function removeDragDropPreviewEl() {
    hideDragDropPreviewEl();
    var preview = document.getElementById('ftth-drag-drop-preview');
    if (preview) preview.remove();
  }

  function positionDragDropPreviewOnCell(cell) {
    var preview = ensureDragDropPreviewEl();
    if (!preview || !cell) return preview;
    var cs = Sim.layout?.cellSize || 50;
    var col = parseInt(cell.dataset.col, 10);
    var row = parseInt(cell.dataset.row, 10);
    if (isNaN(col) || isNaN(row)) return preview;
    preview.style.width = cs + 'px';
    preview.style.height = cs + 'px';
    preview.style.left = (col * cs) + 'px';
    preview.style.top = (row * cs) + 'px';
    return preview;
  }

  function getEmptyDragImage() {
    if (!getEmptyDragImage._img) {
      getEmptyDragImage._img = new Image();
      getEmptyDragImage._img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    }
    return getEmptyDragImage._img;
  }

  function suppressNativeDragGhost(e) {
    if (!e?.dataTransfer?.setDragImage) return;
    try {
      e.dataTransfer.setDragImage(getEmptyDragImage(), 0, 0);
    } catch (err) { /* ignore */ }
  }

  function beginDragPreview() {
    Sim.ui.dragDropActive = true;
    var preview = ensureDragDropPreviewEl();
    if (preview) preview.dataset.cacheKey = '';
  }

  function updateDragGlyphPreview(cell, e) {
    if (!cell) return;
    if (Sim.ui.lastDragOverCell && Sim.ui.lastDragOverCell !== cell) {
      clearDragDropHighlight(Sim.ui.lastDragOverCell);
    }
    Sim.ui.lastDragOverCell = cell;
    Sim.ui.dragDropActive = true;
    cell.classList.add('drag-hover');

    var preview = positionDragDropPreviewOnCell(cell);
    if (!preview) return;

    var ctx = getDragContext(e);
    var cacheKey = (ctx.moveNodeId || ctx.type || 'tool') + ':' + (Sim.selectedSplitterVariant || '');
    if (preview.dataset.cacheKey !== cacheKey) {
      preview.dataset.cacheKey = cacheKey;
      var glyphHtml = '';
      if (ctx.mode === 'move' && ctx.moveNodeId) {
        var moving = findNode(ctx.moveNodeId);
        if (moving) {
          glyphHtml = buildPlacedNodeContent(moving);
          if (moving.type === 'fat_handhole') {
            glyphHtml = glyphHtml.replace(/pointer-events:\s*auto/gi, 'pointer-events: none');
            glyphHtml = '<div class="fat-ghost-safe" style="pointer-events: none !important;">' +
              glyphHtml +
              '<style>.fat-ghost-safe, .fat-ghost-safe * { pointer-events: none !important; }</style>' +
              '</div>';
          }
        }
      } else {
        glyphHtml = buildDragPreviewContent(ctx.type);
      }
      preview.innerHTML = '<div class="ftth-drag-preview__inner">' + (glyphHtml || '') + '</div>';
    }

    var col = parseInt(cell.dataset.col, 10);
    var row = parseInt(cell.dataset.row, 10);
    var check = ctx.mode === 'move'
      ? checkValidPlacement(null, col, row, { moveNodeId: ctx.moveNodeId })
      : checkValidPlacement(ctx.type, col, row);

    preview.classList.remove(
      'ftth-drag-drop-preview--valid',
      'ftth-drag-drop-preview--invalid',
      'ftth-drag-drop-preview--neutral'
    );
    if (check.state === 'valid') preview.classList.add('ftth-drag-drop-preview--valid');
    else if (check.state === 'forbidden') preview.classList.add('ftth-drag-drop-preview--invalid');
    else preview.classList.add('ftth-drag-drop-preview--neutral');

    preview.style.display = 'flex';
    preview.style.pointerEvents = 'none';
    if (e?.dataTransfer) {
      e.dataTransfer.dropEffect = check.state === 'valid'
        ? (check.move ? 'move' : 'copy')
        : (check.state === 'forbidden' ? 'none' : 'copy');
    }
  }

  function cancelDragDropPreviewRaf() {
    if (dragDropPreviewRaf) {
      cancelAnimationFrame(dragDropPreviewRaf);
      dragDropPreviewRaf = 0;
    }
    dragDropPreviewPending = null;
  }

  function clearDragDropHighlight(cell) {
    if (!cell) return;
    cell.classList.remove('drag-hover', 'drag-over', 'valid-drop', 'forbidden-drop', 'drop-flash-valid', 'drop-flash-invalid');
  }

  function clearAllDragDropHighlights() {
    cancelDragDropPreviewRaf();
    document.querySelectorAll(
      '.grid-cell.drag-hover, .grid-cell.drag-over, .grid-cell.valid-drop, .grid-cell.forbidden-drop, ' +
      '.grid-cell.drop-flash-valid, .grid-cell.drop-flash-invalid'
    ).forEach(function (cell) {
      clearDragDropHighlight(cell);
    });
    Sim.ui.lastDragOverCell = null;
    Sim.ui.lastDragOverPointer = null;
    Sim.ui.dragDropActive = false;
    clearNestHighlights();
    hideDragDropPreviewEl();
  }

  function finishDragSession() {
    cancelDragDropPreviewRaf();
    document.querySelectorAll(
      '.grid-cell.drag-hover, .grid-cell.drag-over, .grid-cell.valid-drop, .grid-cell.forbidden-drop, ' +
      '.grid-cell.drop-flash-valid, .grid-cell.drop-flash-invalid'
    ).forEach(function (cell) {
      clearDragDropHighlight(cell);
    });
    Sim.ui.lastDragOverCell = null;
    Sim.ui.lastDragOverPointer = null;
    Sim.ui.dragDropActive = false;
    clearNestHighlights();
    hideDragDropPreviewEl();
    Sim.dragMoveNodeId = null;
  }

  function flashDropFeedback(cell, state) {
    if (!cell || !state) return;
    clearDragDropHighlight(cell);
    cell.classList.add(state === 'valid' ? 'drop-flash-valid' : 'drop-flash-invalid');
    window.setTimeout(function () {
      cell.classList.remove('drop-flash-valid', 'drop-flash-invalid');
    }, 260);
  }

  var dragDropPreviewRaf = 0;
  var dragDropPreviewPending = null;

  function scheduleDragDropPreview(cell, e) {
    dragDropPreviewPending = { cell: cell, event: e };
    if (dragDropPreviewRaf) return;
    dragDropPreviewRaf = requestAnimationFrame(function () {
      dragDropPreviewRaf = 0;
      var job = dragDropPreviewPending;
      dragDropPreviewPending = null;
      if (!job?.cell) return;
      updateDragGlyphPreview(job.cell, job.event);
    });
  }

  function updateDragDropCell(cell, e) {
    if (!cell || (Sim.interactionMode === 'hand' && !(Sim.ui && Sim.ui.clickToMoveActive))) return;
    scheduleDragDropPreview(cell, e);
  }

  function checkValidPlacement(type, col, row, opts) {
    opts = opts || {};
    var existing = getNodeAt(col, row);

    if (opts.moveNodeId) {
      var moving = findNode(opts.moveNodeId);
      if (!moving) return { state: 'invalid' };
      if (moving.locked) return { state: 'forbidden', move: true };
      if (existing && existing.id !== moving.id) return { state: 'forbidden', move: true };
      if (!canPlaceVirtual(moving.type, col, row)) return { state: 'invalid', move: true };
      return { state: 'valid', move: true };
    }

    if (!type || type.indexOf('cable') === 0) return { state: 'invalid' };

    if (isNestTool(type)) {
      if (existing && canNestOnHost(type, existing)) return { state: 'valid', nest: true };
      if (existing) return { state: 'forbidden', nest: true };
      return { state: 'invalid', nest: true };
    }

    if (existing) return { state: 'forbidden' };
    if (!canPlaceVirtual(type, col, row)) return { state: 'invalid' };
    return { state: 'valid' };
  }

  function onVirtualCellDragOver(e) {
    if (Sim.interactionMode === 'hand' && !(Sim.ui && Sim.ui.clickToMoveActive)) return;
    rememberDragPointer(e);
    e.preventDefault();
    updateDragDropCell(e.currentTarget, e);
  }

  function onVirtualCellDragLeave(e) {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    clearDragDropHighlight(e.currentTarget);
    if (Sim.ui.lastDragOverCell === e.currentTarget) Sim.ui.lastDragOverCell = null;
  }

  function onWorkspaceGridDragOver(e) {
    if (Sim.interactionMode === 'hand' && !(Sim.ui && Sim.ui.clickToMoveActive)) return;
    rememberDragPointer(e);
    e.preventDefault();
    var grid = getWorkspaceGrid();
    if (!grid) return;
    var cell = e.target.closest('.grid-cell');
    if (!cell && e.clientX != null) {
      var pt = eventToGridCell(e);
      cell = grid.querySelector('[data-col="' + pt.col + '"][data-row="' + pt.row + '"]');
    }
    if (!cell) return;
    updateDragDropCell(cell, e);
  }

  function onWorkspaceGridDragLeave(e) {
    var grid = getWorkspaceGrid();
    if (!grid) return;
    if (grid.contains(e.relatedTarget)) return;
    clearAllDragDropHighlights();
  }

  function bindDragDropCleanup() {
    if (Sim.ui.dragDropCleanupBound) return;
    document.addEventListener('dragend', finishDragSession);
    Sim.ui.dragDropCleanupBound = true;
  }

  function bindToolboxDragPreview() {
    if (Sim.ui.toolboxDragPreviewBound) return;
    var box = document.getElementById('toolbox');
    if (!box) return;
    box.addEventListener('dragstart', function (e) {
      if (!e.target.closest('.toolbox-item, .toolbox-card, .pen-line-option, .fiber-cable-card, .cable-config-panel')) return;
      suppressNativeDragGhost(e);
      beginDragPreview();
    });
    box.addEventListener('dragend', finishDragSession);
    Sim.ui.toolboxDragPreviewBound = true;
  }

  function isNestTool(type) {
    return type === 'closure' || type === 'splitter' || type === 'fat_pole';
  }

  function clearNestHighlights() {
    document.querySelectorAll('.grid-cell.nest-drop-target').forEach(function (el) {
      el.classList.remove('nest-drop-target', 'closure-drop-target', 'fat-drop-target', 'valid-drop', 'forbidden-drop');
    });
    document.querySelectorAll('.placed-node.nest-drop-target').forEach(function (el) {
      el.classList.remove('nest-drop-target', 'closure-drop-target', 'fat-drop-target', 'valid-drop', 'forbidden-drop');
    });
  }

  function highlightNestTarget(cell, type, existing, isValid) {
    clearNestHighlights();
    if (!cell || !existing) return;
    var cls = 'nest-drop-target';
    if (type === 'closure' && isClosureHost(existing) && !existing.hasClosure) cls += ' closure-drop-target';
    else if (type === 'fat_pole' && isFatPoleHost(existing)) cls += ' pole-drop-target';
    else if (type === 'splitter' && (
      (existing.type === 'fdt' && !existing.fatSplitter) ||
      (existing.type === 'fat_handhole' && existing.hasFatPole && !existing.fatSplitter)
    )) cls += ' fat-drop-target';
    else return;
    cell.classList.add(cls);
    if (isValid) cell.classList.add('valid-drop');
    else cell.classList.add('forbidden-drop');
    var nodeEl = document.querySelector('.placed-node[data-id="' + existing.id + '"]');
    if (nodeEl) {
      nodeEl.classList.add(cls);
      if (isValid) nodeEl.classList.add('valid-drop');
      else nodeEl.classList.add('forbidden-drop');
    }
  }

  function tryInstallClosure(target) {
    if (!isClosureHost(target)) {
      updateStatus('Closure → Handhole or FAT Handhole only', true);
      return false;
    }
    if (target.hasClosure) {
      updateStatus('Already has a Closure', true);
      return false;
    }
    target.hasClosure = true;
    ensureNodeOwnerFdt(target);
    ensureNodeLabelOffsets(target);
    if (target.type === 'handhole') {
      assignClosureName(target);
      if (target.labelOffsets.primary) delete target.labelOffsets.primary;
    } else if (target.type === 'fat_handhole') {
      if (target.labelOffsets.primary) delete target.labelOffsets.primary;
    }
    patchHandholeClosure(target);
    var statusLabel = target.type === 'handhole'
      ? 'Closure ' + target.closureName + ' nested in ' + (target.autoName || 'Handhole') + ' ✓'
      : 'Closure nested in ' + (target.fatSystemName || target.autoName || 'FAT Handhole') + ' ✓';
    rememberLastInstalledElement(target.closureName || target.fatSystemName || target.autoName);
    updateStatus(statusLabel);
    updateMetrics();
    saveState();
    notifyFiberDesignTopologyChanged();
    return true;
  }

  function tryInstallFatPole(target) {
    if (!isFatPoleHost(target)) {
      updateStatus('FAT Pole → FAT Handhole only', true);
      return false;
    }
    target.hasFatPole = true;
    ensureNodeOwnerFdt(target);
    assignFatSystemName(target);
    ensureNodeLabelOffsets(target);
    if (target.labelOffsets.primary) delete target.labelOffsets.primary;
    if (target.labelOffsets.unified) delete target.labelOffsets.unified;
    /* Full node rebuild so FH## DOM label is replaced by FAT## instantly */
    renderNode(target);
    if (global.FTTHDrawingEngine?.renderMapLabels) {
      global.FTTHDrawingEngine.renderMapLabels();
    } else {
      global.FTTHDrawingEngine?.requestMapLabelsRedraw?.();
    }
    /* Drop stale LabelManager overlay text (FH##) — force clear, do not wait for pan/click */
    global.FTTHLabelManager?.refresh?.({ force: true });
    rememberLastInstalledElement(target.fatSystemName);
    notifyFiberDesignTopologyChanged();
    updateStatus('FAT Pole mounted — ' + target.fatSystemName + ' ✓');
    updateMetrics();
    saveState();
    return true;
  }

  function tryInstallSplitter(target, variant) {
    var ratio = variant || Sim.selectedSplitterVariant || '1x8';
    if (!target) {
      updateStatus('Splitter → FDT or FAT Pole only', true);
      return false;
    }
    if (target.fatSplitter) {
      updateStatus('Host already has a Splitter', true);
      return false;
    }
    if (target.type === 'fdt') {
      target.fatSplitter = ratio;
      target.splitterMeta = parseSplitterRatio(target.fatSplitter);
      updatePlacedNodeContent(target);
      updateMetrics();
      updateStatus('Splitter ' + target.fatSplitter + ' nested in FDT ✓');
      saveState();
      return true;
    }
    if (target.type === 'fat_handhole' && target.hasFatPole) {
      target.fatSplitter = ratio;
      target.splitterMeta = parseSplitterRatio(target.fatSplitter);
      updatePlacedNodeContent(target);
      updateMetrics();
      updateStatus('Splitter ' + target.fatSplitter + ' nested in FAT box ✓');
      saveState();
      return true;
    }
    updateStatus('Drop Splitter onto FDT or FAT Pole', true);
    return false;
  }

  function handlePlacement(type, col, row, variant, dropPt) {
    var existing = getNodeAt(col, row);

    if (isNestTool(type)) {
      if (existing && canNestOnHost(type, existing)) {
        var nested = tryNestOnHost(type, existing, variant);
        if (nested) notifyPlacementToolUsed();
        return nested;
      }
      if (type === 'closure') {
        updateStatus('Drop Closure onto Handhole or FAT Handhole', true);
        return false;
      }
      if (type === 'fat_pole') {
        updateStatus('Drop FAT Pole onto FAT Handhole (LM_Holes)', true);
        return false;
      }
      if (type === 'splitter') {
        updateStatus('Drop Splitter onto FDT or FAT Pole', true);
        return false;
      }
    }

    if (existing) {
      updateStatus('Cell already occupied', true);
      return false;
    }
    if (!canPlaceVirtual(type, col, row)) {
      updateStatus('Placement Error: sidewalk only', true);
      return false;
    }
    addNode(type, col, row, variant, dropPt);
    notifyPlacementToolUsed();
    return true;
  }

  function addNode(type, col, row, variant, dropPt) {
    if (type === 'fat_pole') {
      updateStatus('FAT Pole → drop onto FAT Handhole', true);
      return;
    }
    Sim.nodeId++;
    var node = { id: 'n' + Sim.nodeId, type: type, col: col, row: row };
    if (type === 'handhole') node.hasClosure = false;
    if (type === 'fat_handhole') {
      node.hasFatPole = false;
      node.hasClosure = false;
      node.fatSystemName = null;
      node.fatSplitter = null;
    }
    if (type === 'fdt') node.fatSplitter = null;
    node.labelOffsets = {};
    if (variant) node.variant = variant;
    node.locked = false;
    snapNodeToCell(node);
    if (type !== 'fdt' && type !== 'olt') ensureNodeOwnerFdt(node);
    assignAutoName(type, node);
    Sim.nodes.push(node);
    if (type === 'fdt' && !getActiveFdtId()) {
      setActiveFdt(node, { bootstrap: true, force: true });
    }
    renderNode(node);
    rememberLastInstalledElement(getNodeAutoLabel(node) || node.autoName || type);
    updateMetrics();
    var placedLabel = getNodeAutoLabel(node) || type;
    updateStatus(placedLabel + ' placed');
    saveState();
    notifyFiberDesignTopologyChanged();
  }

  function isHandholeKindNode(node) {
    return !!(node && (node.type === 'handhole' || node.type === 'fat_handhole'));
  }

  function isPenDrawingBusy() {
    if (global.FTTHDrawingEngine?.isCablePenDrawActive?.()) return true;
    if (canPenDraw() && Sim.penDraft && Sim.penDraft.points && Sim.penDraft.points.length > 0) return true;
    return false;
  }

  function resolveHandholeNodeFromDblClickEvent(e) {
    var nodeEl = e?.target?.closest?.('.placed-node');
    if (nodeEl?.dataset?.id) {
      var direct = findNode(nodeEl.dataset.id);
      if (isHandholeKindNode(direct)) return direct;
    }
    var pickedId = pickPlacedNodeUnderPointer(e?.clientX, e?.clientY);
    if (!pickedId) return null;
    var picked = findNode(pickedId);
    return isHandholeKindNode(picked) ? picked : null;
  }

  /** Nest Closure / FAT Pole onto an existing handhole host (same cell + parent node). */
  function createNodeAtHost(parentNode, toolType) {
    if (!parentNode || !toolType) return false;
    return tryNestOnHost(toolType, parentNode);
  }

  function createNodeAtPosition(x, y, toolType, parentNodeId) {
    var parent = parentNodeId ? findNode(parentNodeId) : null;
    if (!parent && x != null && y != null) {
      var cell = pointerToGridCell(x, y);
      if (cell) parent = getNodeAt(cell.col, cell.row);
    }
    if (!parent) return false;
    return createNodeAtHost(parent, toolType);
  }

  /** Double-click handhole/FAT handhole: quick-nest Closure or FAT Pole from toolbox selection. */
  function tryQuickNestOnHandholeDblClick(node, e) {
    if (!isHandholeKindNode(node) || !isQuickNestToolSelected()) return false;
    if (isPenDrawingBusy()) return false;
    var tool = Sim.selectedTool;
    if (tool === 'fat_pole') {
      if (node.type !== 'fat_handhole') {
        updateStatus('FAT Pole → FAT Handhole only', true);
        return true;
      }
      if (!canNestOnHost('fat_pole', node)) {
        updateStatus(node.hasFatPole ? 'Already has a FAT Pole' : 'FAT Pole → FAT Handhole only', true);
        return true;
      }
      createNodeAtHost(node, tool);
      return true;
    }
    if (tool === 'closure') {
      if (!canNestOnHost('closure', node)) {
        updateStatus(node.hasClosure ? 'Already has a Closure' : 'Closure → Handhole or FAT Handhole only', true);
        return true;
      }
      createNodeAtHost(node, tool);
      return true;
    }
    return false;
  }

  function tryHandholeQuickNestDblClick(e) {
    var node = resolveHandholeNodeFromDblClickEvent(e);
    if (!node) return false;
    return tryQuickNestOnHandholeDblClick(node, e);
  }

  function renderNode(node) {
    if (node.type === 'pole_foundation' || node.type === 'pole') return;
    if (global.FTTHVisibilityManager?.isNodeVisible && !global.FTTHVisibilityManager.isNodeVisible(node)) {
      return;
    }
    var grid = getWorkspaceGrid();
    if (!grid) return;
    var old = document.querySelector('.placed-node[data-id="' + node.id + '"]');
    if (old) old.remove();
    dedupePlacedNodesById(node.id);

    snapNodeToCell(node);

    var cell = grid.querySelector('[data-col="' + node.col + '"][data-row="' + node.row + '"]');
    if (!cell) return;
    cell.classList.add('has-node');
    if (node.type === 'handhole') cell.classList.add('has-handhole');
    if (node.type === 'fat_handhole') cell.classList.add('has-fat-handhole');

    var m = document.createElement('div');
    m.className = 'placed-node placed-node--cell-locked placed-node--top-layer placed-node--' + node.type;
    if (node.locked) m.classList.add('placed-node--locked');
    if (Sim.selectedNodeId === node.id) m.classList.add('selected');
    if (Sim.topologyHighlight && Sim.topologyHighlight.nodeId === node.id) {
      m.classList.add('topology-trace-root');
    }
    if (node.type === 'fat_handhole' && node.hasFatPole) {
      m.classList.add('placed-node--fat-pole');
      m.setAttribute('data-map-marker', 'fat-unified');
    }
    m.dataset.id = node.id;
    m.dataset.type = node.type;
    m.dataset.col = String(node.col);
    m.dataset.row = String(node.row);
    m.innerHTML = buildPlacedNodeContent(node);
    m.title = getNodeTitle(node);

    var isMoveActive = Sim.ui && Sim.ui.clickToMoveActive;
    var legacyDrag = !node.locked && (typeof isHandholeNodePositionLocked !== 'function' || !isHandholeNodePositionLocked(node)) && Sim.interactionMode === 'select';

    if (isMoveActive || legacyDrag) {
      m.draggable = true;
      m.addEventListener('dragstart', function (e) {
        Sim.dragMoveNodeId = node.id;
        e.dataTransfer.setData('text/move-node-id', node.id);
        e.dataTransfer.effectAllowed = 'move';
        suppressNativeDragGhost(e);
        beginDragPreview();
      });
      m.addEventListener('dragend', finishDragSession);
    }
    m.addEventListener('click', function (e) {
      if (isQuickNestToolSelected() && isHandholeKindNode(node) && e.detail >= 2) return;
      e.stopPropagation();
      if (canPenDraw() && e.detail >= 2) return;
      /* Use the clicked node's own id — do not re-resolve to a neighboring closure host. */
      onPlacedNodeClick(node.id, e);
    });
    m.addEventListener('dblclick', function (e) {
      if (Sim.interactionMode === 'hand' && typeof isHandholeTypeNode === 'function' && isHandholeTypeNode(node)) {
        var cables = typeof getCablesThroughNode === 'function' ? getCablesThroughNode(node) : [];
        if (cables.length === 0 && !node.locked) {
          if (typeof setInteractionMode === 'function') setInteractionMode('select');
          else if (typeof enableSelectMode === 'function') enableSelectMode();

          if (typeof startMoveNode === 'function') {
            startMoveNode(node.id);
            updateStatus('Empty Handhole armed for move. Click destination cell.');
            e.stopPropagation();
            return;
          }
        }
      }
      if (tryQuickNestOnHandholeDblClick(node, e)) return;
      if (!canPenDraw() || !Sim.penDraft) return;
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      if (global.FTTHDrawingEngine?.onPenDblClick?.(e)) return;
    }, true);
    m.addEventListener('dragover', onNodeDragOver);
    m.addEventListener('dragleave', onNodeDragLeave);
    m.addEventListener('drop', onNodeDrop);

    m.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      if (canPenDraw() || isVertexEditToolBlockingNode(e)) return;
      if (isQuickNestToolSelected() && isHandholeKindNode(node)) return;
      e.stopPropagation();
    });
    applyCellLockPosition(m, node);
    var topLayer = getWorkspaceItemsLayer();
    if (topLayer) topLayer.appendChild(m);
    else cell.appendChild(m);
    bindDraggableLabels(m, node);
    if (isFatHandholeMapNode(node)) pinFatRigidMarkerPosition(node);

    if (global.FTTHDrawingEngine?.requestMapLabelsRedraw) {
      global.FTTHDrawingEngine.requestMapLabelsRedraw();
    }

    if (Sim.selectedNodeId === node.id) {
      requestAnimationFrame(positionNodeActionHud);
    }
  }

  function renderAllNodes() {
    document.querySelectorAll('.placed-node').forEach(function (n) { n.remove(); });
    var layer = document.getElementById('workspace-items-layer');
    if (layer) layer.innerHTML = '';
    document.querySelectorAll('.grid-cell').forEach(function (c) {
      c.classList.remove('has-node', 'has-pole-foundation', 'has-pole-tower', 'has-handhole', 'has-fat-handhole');
    });
    Sim.nodes.forEach(function (n) {
      if (n.type === 'pole_foundation' || n.type === 'pole') return;
      renderNode(n);
    });
    renderGlobalDrawingLayer();
  }

  function onPlacedNodeClick(nodeId, e) {
    if (canPenDraw() && (e?.detail >= 2 || global.FTTHDrawingEngine?.isPenFinishingDblClick?.())) return;

    if (canPenDraw() && Sim.pen && Sim.pen.lineMode === 'cable') {
      e.preventDefault();
      e.stopPropagation();
      if (global.FTTHDrawingEngine?.isCableContinuePromptActive?.()) {
        updateStatus(
          'Continue batch — choose Yes to merge existing cable or No to draw new',
          true
        );
        return;
      }
      if (global.FTTHDrawingEngine?.addPenVertexFromPlacedNode) {
        global.FTTHDrawingEngine.addPenVertexFromPlacedNode(nodeId, e);
      } else if (global.FTTHDrawingEngine) {
        global.FTTHDrawingEngine.addPenVertexFromEvent(e);
      }
      return;
    }

    if (canPenDraw()) {
      e.preventDefault();
      e.stopPropagation();
      if (global.FTTHDrawingEngine) global.FTTHDrawingEngine.addPenVertexFromEvent(e);
      return;
    }

    if (Sim.selectedCableSpec) {
      if (!Sim.cableDraftFrom) {
        Sim.cableDraftFrom = nodeId;
        document.querySelectorAll('.placed-node').forEach(function (el) { el.classList.remove('connect-source'); });
        var el = document.querySelector('.placed-node[data-id="' + nodeId + '"]');
        if (el) el.classList.add('connect-source');
        updateStatus('Cable: select destination node (' + Sim.selectedCableSpec.capacity + 'F)');
        return;
      }
      if (Sim.cableDraftFrom === nodeId) return;
      addConnection(Sim.cableDraftFrom, nodeId, Sim.selectedCableSpec);
      Sim.cableDraftFrom = null;
      document.querySelectorAll('.placed-node.connect-source').forEach(function (el) { el.classList.remove('connect-source'); });
      return;
    }

    selectNode(nodeId);
  }

  function addConnection(fromId, toId, spec) {
    var fromNode = findNode(fromId);
    var cableName = getCableLabelForKind(spec.kind);
    var sourceLabel = getNodeAutoLabel(fromNode);
    Sim.connId++;
    Sim.connections.push({
      id: 'c' + Sim.connId,
      from: fromId,
      to: toId,
      cableType: spec.id,
      kind: spec.kind,
      capacity: spec.capacity,
      batch: getCableBatchForKind(spec.kind),
      name: cableName,
      sourceLabel: sourceLabel,
    });
    renderConnections();
    updateMetrics();
    var msg = cableName + ' linked';
    if (sourceLabel) msg += ' from ' + sourceLabel;
    updateStatus(msg + ' ✓');
  }

  function onVirtualCellDblClick(e) {
    if (Sim.interactionMode === 'hand') {
      if (trySelectionModeDblClick(e)) return;
      return;
    }
    if (canPenDraw() && Sim.penDraft && Sim.pen?.lineMode === 'cable') {
      e.preventDefault();
      e.stopPropagation();
      var hadCableDraft = !!Sim.penDraft;
      if (global.FTTHDrawingEngine) {
        global.FTTHDrawingEngine.finishPenDrawing({
          trimDblClick: false,
          finishEvent: e,
          fromDoubleClick: true,
        });
      }
      if (hadCableDraft && !Sim.penDraft) {
        global.FTTHUiController?.finishPath?.();
      }
      return;
    }
    if (canPenDraw() && Sim.penDraft) {
      e.preventDefault();
      e.stopPropagation();
      var hadExcDraft = !!Sim.penDraft;
      if (global.FTTHDrawingEngine) {
        global.FTTHDrawingEngine.finishPenDrawing({ trimDblClick: true });
      }
      if (hadExcDraft && !Sim.penDraft) {
        global.FTTHUiController?.finishPath?.();
      }
    }
  }

  function onVirtualCellClick(e) {
    if (trySelectMapNodeAtPointer(e)) return;
    if (Sim.interactionMode === 'hand') return;
    if (Sim.suppressMapClick) { Sim.suppressMapClick = false; return; }
    var resolvedCell = eventToGridCellWithFallback(e, e.currentTarget);
    var clickPt = resolvedCell.point || {
      col: parseInt(e.currentTarget.dataset.col, 10),
      row: parseInt(e.currentTarget.dataset.row, 10),
    };
    var col = clickPt.col;
    var row = clickPt.row;

    if (Sim.moveNodeId) {
      Sim.moveNodeId = null;
      return;
    }

    if (Sim.selectedCableSpec) return;

    if (canPenDraw()) return;

    if (!Sim.moveNodeId && !Sim.selectedCableSpec) clearSelectedPath();

    if (!Sim.selectedTool || Sim.selectedTool.indexOf('cable') === 0) return;
    var variant = Sim.selectedSplitterVariant || null;
    handlePlacement(Sim.selectedTool, col, row, variant);
  }

  function onVirtualCellDrop(e) {
    e.preventDefault();
    if (Sim.interactionMode === 'hand' && !(Sim.ui && Sim.ui.clickToMoveActive)) return;
    e.stopPropagation();
    var cell = e.currentTarget;
    if (Sim.nestDropHandled) {
      Sim.nestDropHandled = false;
      finishDragSession();
      return;
    }
    var resolvedDrop = eventToGridCellWithFallback(e, cell);
    var dropPt = resolvedDrop.point;
    if (!dropPt) {
      finishDragSession();
      return;
    }
    if (resolvedDrop.cell) cell = resolvedDrop.cell;
    var col = dropPt.col;
    var row = dropPt.row;
    if (isNaN(col) || isNaN(row)) {
      col = parseInt(cell.dataset.col, 10);
      row = parseInt(cell.dataset.row, 10);
    }
    var moveId = e.dataTransfer.getData('text/move-node-id') || Sim.dragMoveNodeId;
    if (moveId) {
      var moving = findNode(moveId);
      var moveCheck = checkValidPlacement(null, col, row, { moveNodeId: moveId });
      if (moving && !moving.locked && !isHandholeNodePositionLocked(moving) && moveCheck.state === 'valid') {
        relocateNode(moving, col, row, dropPt);
        flashDropFeedback(cell, 'valid');
      } else {
        flashDropFeedback(cell, 'invalid');
      }
      finishDragSession();
      return;
    }
    var type = e.dataTransfer.getData('text/tool-type');
    var variant = e.dataTransfer.getData('text/tool-variant') || Sim.selectedSplitterVariant || null;
    if (!type || type.indexOf('cable') === 0) {
      finishDragSession();
      return;
    }
    var existing = getNodeAt(col, row);
    if (existing && isNestTool(type) && canNestOnHost(type, existing)) {
      var nested = tryNestOnHost(type, existing, variant);
      if (nested) notifyPlacementToolUsed();
      flashDropFeedback(cell, nested ? 'valid' : 'invalid');
      finishDragSession();
      return;
    }
    var placeCheck = checkValidPlacement(type, col, row);
    if (placeCheck.state === 'valid') {
      handlePlacement(type, col, row, variant, dropPt);
      flashDropFeedback(cell, 'valid');
    } else {
      flashDropFeedback(cell, 'invalid');
    }
    finishDragSession();
  }

  function onNodeDragOver(e) {
    e.preventDefault();
    var cell = getGridCellForNodeElement(e.currentTarget);
    if (!cell || !cell.classList.contains('grid-cell')) return;
    updateDragDropCell(cell, e);
    e.stopPropagation();
  }

  function onNodeDragLeave(e) {
    e.currentTarget.classList.remove('closure-drop-target', 'pole-drop-target', 'fat-drop-target', 'nest-drop-target', 'valid-drop', 'forbidden-drop');
    var cell = getGridCellForNodeElement(e.currentTarget);
    if (cell) clearDragDropHighlight(cell);
  }

  function onNodeDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    Sim.suppressMapClick = true;
    Sim.nestDropHandled = true;
    var type = e.dataTransfer.getData('text/tool-type');
    var variant = e.dataTransfer.getData('text/tool-variant') || null;
    var node = Sim.nodes.filter(function (n) { return n.id === e.currentTarget.dataset.id; })[0];
    var cell = getGridCellForNodeElement(e.currentTarget);
    if (!node || !isNestTool(type)) {
      finishDragSession();
      return;
    }
    if (!canNestOnHost(type, node)) {
      if (cell) flashDropFeedback(cell, 'invalid');
      finishDragSession();
      return;
    }
    var ok = false;
    if (type === 'closure') ok = tryInstallClosure(node);
    else if (type === 'fat_pole') ok = tryInstallFatPole(node);
    else if (type === 'splitter') ok = tryInstallSplitter(node, variant);
    if (cell) flashDropFeedback(cell, ok ? 'valid' : 'invalid');
    finishDragSession();
  }

  function findNode(id) {
    for (var i = 0; i < Sim.nodes.length; i++) {
      if (Sim.nodes[i].id === id) return Sim.nodes[i];
    }
    return null;
  }

  function selectNode(nodeId, options) {
    options = options || {};
    Sim.ui.pathHighlightFromSidebar = !!options.fromSidebar;
    Sim.selectedNodeId = nodeId;
    var node = findNode(nodeId);
    /* Active FDT is locked — map/sidebar selection never switches cabinet context. */
    if (Sim.selectedPath) {
      Sim.selectedPath = null;
      if (Sim.pathEdit) {
        Sim.pathEdit.editActive = false;
        Sim.pathEdit.splitToolActive = false;
        Sim.pathEdit.vertexToolActive = false;
        Sim.pathEdit.editingPathId = null;
        Sim.pathEdit.selectedVertexIndex = null;
      }
      if (!options.fromSidebar) {
        Sim.ui.sidebarEditMode = false;
      }
      setHoveredPath(null, null);
      syncDrawingLayerInteraction();
      renderGlobalDrawingLayer();
    }
    if (node && (node.type === 'handhole' || node.type === 'fat_handhole')) {
      Sim.ui.propertyPanelTab = 'attributes';
      if (node.type === 'fat_handhole' && node.hasFatPole) {
        Sim.ui.topologyTreeFocus = { kind: 'pole', nodeId: node.id };
      } else {
        Sim.ui.topologyTreeFocus = { kind: 'node', nodeId: node.id };
      }
      syncTopologyHighlightForNode(node);
    } else if (node && node.type === 'pole_foundation') {
      Sim.ui.propertyPanelTab = 'attributes';
      Sim.ui.topologyTreeFocus = { kind: 'pole', nodeId: node.id };
      clearTopologyHighlight();
      if (!options.fromSidebar) {
        Sim.ui.sidebarEditMode = false;
      }
      renderGlobalDrawingLayer();
    } else if (!options.fromSidebar) {
      clearTopologyHighlight();
      Sim.ui.sidebarEditMode = false;
      renderGlobalDrawingLayer();
    }
    document.querySelectorAll('.placed-node').forEach(function (el) {
      el.classList.toggle('selected', el.dataset.id === nodeId);
    });
    applyTopologyHighlightClasses();
    renderGlobalDrawingLayer();
    renderUnifiedSidebar();
    syncSplicingToolbarState();
  }

  function clearNodeSelection() {
    Sim.selectedNodeId = null;
    Sim.moveNodeId = null;
    Sim.ui.sidebarEditMode = false;
    clearTopologyHighlight();
    document.querySelectorAll('.placed-node.selected').forEach(function (el) { el.classList.remove('selected'); });
    renderGlobalDrawingLayer();
    renderUnifiedSidebar();
    hideContextMenu();
    Sim.ui.contextMenuNodeId = null;
    syncSplicingToolbarState();
  }

  function isMapNodeSpliceable(node) {
    if (!node) return false;
    if (node.type === 'handhole' && (node.hasClosure || node.closureName)) return true;
    if (node.type === 'fat_handhole' && node.hasClosure) return true;
    return false;
  }

  function syncSplicingToolbarState() {
    var btn = document.getElementById('btn-toolbar-splicing');
    if (!btn) return;
    var closures = getClosureNodesForFiberDesign();
    var ok = closures.length > 0;
    btn.classList.toggle('action-toolbar__btn--disabled', !ok);
    btn.title = ok
      ? 'Splicing — pulse all Closure markers (visual only)'
      : 'Splicing — place Closures on the map first';
    btn.setAttribute('aria-disabled', ok ? 'false' : 'true');
  }

  function tryOpenSplicingActionUI() {
    if (global.FTTHSplicingActionUI && global.FTTHSplicingActionUI.triggerSpliceAnimation) {
      global.FTTHSplicingActionUI.triggerSpliceAnimation();
      return;
    }
    if (global.FTTHSplicingActionUI && global.FTTHSplicingActionUI.open) {
      global.FTTHSplicingActionUI.open();
    }
  }

  function notifyFiberDesignTopologyChanged(opts) {
    opts = opts || {};
    if (global.FTTHFiberDesignManager) {
      if (opts.immediate && opts.interactive &&
          typeof global.FTTHFiberDesignManager.notifyInteractivePathCommitted === 'function') {
        global.FTTHFiberDesignManager.notifyInteractivePathCommitted(opts.path || null);
      } else if (typeof global.FTTHFiberDesignManager.notifyTopologyChanged === 'function') {
        global.FTTHFiberDesignManager.notifyTopologyChanged(opts);
      }
    }
    syncSplicingToolbarState();
  }

  function onFiberSpliceComplete(nodeId) {
    var panel = document.getElementById('evaluation-panel');
    if (global.FTTHFiberDesignUI && global.FTTHFiberDesignUI.refreshPanelContent && panel) {
      global.FTTHFiberDesignUI.refreshPanelContent(panel, nodeId);
    }
    renderUnifiedSidebar();
  }

  function ensureWorkspaceOverlays() {
    var host = document.getElementById('simulator-container');
    var overlays = document.getElementById('sim-workspace-overlays');
    if (host && overlays && overlays.parentElement !== host) {
      host.appendChild(overlays);
    }
  }

  function bindWorkspaceActionDelegation() {
    /* Floating quick actions retired — unified sidebar handles actions */
  }

  function bindNodeActionHud() {
    /* Floating HUD retired */
  }

  function positionNodeActionHud() {}

  function showNodeActionHud(node) {}

  function hideNodeActionHud() {}

  function enableInteractions() {
    ensureWorkspaceOverlays();
    bindWorkspaceActionDelegation();
    bindNodeActionHud();
    ensureFloatingUiInFullscreenHost();
    syncFullscreenLayoutClasses();
    var container = getSimulatorWorkspaceRoot();
    if (container) {
      container.classList.toggle('is-fullscreen', isFakeFullscreen());
    }
    var menu = document.getElementById('sim-context-menu');
    if (menu) menu.style.zIndex = isFakeFullscreen() ? '1000055' : '9999';
    if (Sim.selectedNodeId) {
      var node = findNode(Sim.selectedNodeId);
      if (!node) clearNodeSelection();
    }
  }

  function hideContextMenu() {
    var menu = document.getElementById('sim-context-menu');
    if (menu) {
      menu.classList.add('hidden');
      menu.setAttribute('aria-hidden', 'true');
    }
    Sim.ui.contextMenuNodeId = null;
  }

  function showContextMenu(clientX, clientY, node) {
    var menu = document.getElementById('sim-context-menu');
    if (!menu || !node) return;
    Sim.ui.contextMenuNodeId = node.id;
    var ratioLabel = node.fatSplitter ? ' (' + node.fatSplitter + ')' : '';
    var headerLabel = getNodeAutoLabel(node) || node.type;
    menu.innerHTML =
      '<div class="sim-context-menu__header">' + headerLabel + ratioLabel + '</div>' +
      '<button type="button" class="sim-context-menu__item" data-action="move">↔ Move</button>' +
      '<button type="button" class="sim-context-menu__item' + (node.locked ? ' sim-context-menu__item--active' : '') +
      '" data-action="lock">' + (node.locked ? '🔒 Unlock' : '🔓 Lock') + '</button>' +
      '<div class="sim-context-menu__divider"></div>' +
      '<button type="button" class="sim-context-menu__item sim-context-menu__item--danger" data-action="delete">✕ Delete</button>';
    menu.classList.remove('hidden');
    menu.setAttribute('aria-hidden', 'false');
    menu.style.left = Math.min(clientX, window.innerWidth - 220) + 'px';
    menu.style.top = Math.min(clientY, window.innerHeight - 160) + 'px';
    menu.style.zIndex = isFakeFullscreen() ? '1000055' : '9999';
    menu.style.pointerEvents = 'auto';
  }

  function escapeSidebarHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getExcavLabelForKind(kind) {
    for (var i = 0; i < EXCAVATION_TOOLS.length; i++) {
      if (EXCAVATION_TOOLS[i].routeKind === kind) return EXCAVATION_TOOLS[i].label;
    }
    return kind || '—';
  }

  function getCableClassLabel(kind) {
    return kind === 'lastmile' ? 'Last Mile' : 'FTTH Main';
  }

  function formatCableCapacityLabel(cable) {
    if (!cable) return '—';
    return String(cable.capacity || getCableCapacityForKind(cable.kind) || '?') + 'F';
  }

  function formatCableEndpointsLabel(cable) {
    if (!cable) return '—';
    var ct = cable.connectedTo || {};
    return (ct.start || '—') + ' → ' + (ct.end || '—');
  }

  function renderSidebarMetaRow(label, value) {
    return '<div class="sidebar-card__meta-row">' +
      '<dt class="sidebar-card__meta-dt">' + escapeSidebarHtml(label) + '</dt>' +
      '<dd class="sidebar-card__meta-dd">' + escapeSidebarHtml(value) + '</dd>' +
      '</div>';
  }

  function renderCableCardDetails(cable) {
    if (!cable) return '';
    return '<div class="sidebar-card__details">' +
      '<dl class="sidebar-card__meta">' +
      renderSidebarMetaRow('Capacity', formatCableCapacityLabel(cable)) +
      renderSidebarMetaRow('Batch', String(cable.batch || getCableBatchForKind(cable.kind) || 1)) +
      renderSidebarMetaRow('Cable Class', getCableClassLabel(cable.kind)) +
      renderSidebarMetaRow('Length', pathLengthMeters(cable).toFixed(1) + ' m') +
      renderSidebarMetaRow('Endpoints', formatCableEndpointsLabel(cable)) +
      '</dl></div>';
  }

  function renderExcavationCardDetails(path) {
    if (!path) return '';
    return '<div class="sidebar-card__details">' +
      '<dl class="sidebar-card__meta">' +
      renderSidebarMetaRow('Trench ID', getExcavationDisplayNumber(path)) +
      renderSidebarMetaRow('Length', pathLengthMeters(path).toFixed(1) + ' m') +
      renderSidebarMetaRow('Type / Class', getExcavLabelForKind(path.kind)) +
      '</dl></div>';
  }

  function getPathSidebarMeta(ref) {
    if (!ref) return null;
    var path = findPathByRef(ref);
    if (!path) return null;
    var lenM = pathLengthMeters(path).toFixed(1);
    var typeLabel = ref.type === 'excavation'
      ? getExcavLabelForKind(path.kind)
      : (path.name || formatCableLabel(path.capacity, path.batch || 1));
    return { ref: ref, path: path, lengthM: lenM, typeLabel: typeLabel };
  }

  function syncSidebarSelectionState() {
    var panel = document.getElementById('evaluation-panel');
    var propWrap = document.getElementById('property-panel');
    var evalContent = document.getElementById('evaluation-content');
    var hasSelection = !!(Sim.selectedNodeId || Sim.selectedPath);
    if (panel) {
      panel.classList.toggle('sidebar--selection-active', hasSelection);
      panel.classList.toggle('sidebar--idle', !hasSelection);
    }
    if (propWrap) propWrap.classList.toggle('hidden', !hasSelection);
    if (evalContent) evalContent.classList.toggle('hidden', hasSelection);
  }

  function renderSidebarHeader() {
    return '<div class="unified-sidebar__head features-header">' +
      '<p class="unified-sidebar__title">Features &amp; Properties</p>' +
      '</div>';
  }

  function renderPathSectionTools(pathType, pathId) {
    return '';
  }

  function renderNodeSectionTools(nodeId) {
    if (!Sim.ui.sidebarEditMode || !nodeId) return '';
    var node = findNode(nodeId);
    if (!node) return '';
    return '<div class="path-section-tools sidebar-node-tools" data-path-section="' + escapeSidebarHtml('node:' + nodeId) + '">' +
      '<button type="button" class="path-section-tools__btn" data-sidebar-action="move" data-focus-node-id="' +
      escapeSidebarHtml(nodeId) + '" title="Move">🎯</button>' +
      '<button type="button" class="path-section-tools__btn' + (node.locked ? ' path-section-tools__btn--active' : '') +
      '" data-sidebar-action="lock" data-focus-node-id="' + escapeSidebarHtml(nodeId) + '" title="Lock">' +
      (node.locked ? '🔒' : '🔓') + '</button>' +
      '</div>';
  }

  function renderSidebarCardTools(toolsHtml) {
    if (!toolsHtml) return '';
    return '<div class="sidebar-card__tools">' + toolsHtml + '</div>';
  }

  function shouldShowSidebarCardTools(active) {
    return !!Sim.ui.sidebarEditMode && !!active;
  }

  function renderHandholeSidebarCard(node, active) {
    var attrs = 'data-topology-focus="node" data-focus-node-id="' + escapeSidebarHtml(node.id) + '"';
    var tools = shouldShowSidebarCardTools(active)
      ? renderSidebarCardTools(renderNodeSectionTools(node.id))
      : '';
    return '<li class="sidebar-card sidebar-card--holes' + (active ? ' sidebar-card--active' : '') +
      (tools ? ' sidebar-card--has-tools' : '') + '">' +
      '<button type="button" class="sidebar-card__btn" ' + attrs + '>' +
      '<span class="sidebar-card__label">' + escapeSidebarHtml(getHandholeSidebarTitle(node)) + '</span>' +
      '</button>' + tools + '</li>';
  }

  function renderExcavationSidebarCard(path, active) {
    var attrs = 'data-topology-focus="excavation" data-path-type="excavation" data-path-id="' +
      escapeSidebarHtml(path.id) + '"';
    var tools = shouldShowSidebarCardTools(active)
      ? renderSidebarCardTools(renderPathSectionTools('excavation', path.id))
      : '';
    var details = active ? renderExcavationCardDetails(path) : '';
    return '<li class="sidebar-card sidebar-card--excav' + (active ? ' sidebar-card--active sidebar-card--expanded' : '') +
      (tools ? ' sidebar-card--has-tools' : '') + (details ? ' sidebar-card--has-details' : '') + '">' +
      '<button type="button" class="sidebar-card__btn" ' + attrs + '>' +
      '<span class="sidebar-card__label">' + escapeSidebarHtml(getExcavationDisplayNumber(path)) + '</span>' +
      '<span class="sidebar-card__chevron" aria-hidden="true">' + (active ? '▾' : '▸') + '</span>' +
      '</button>' + details + tools + '</li>';
  }

  function renderCableSidebarCard(cable, active) {
    var attrs = 'data-topology-focus="cable" data-path-type="fiber" data-path-id="' +
      escapeSidebarHtml(cable.id) + '"';
    var tools = shouldShowSidebarCardTools(active)
      ? renderSidebarCardTools(renderPathSectionTools('fiber', cable.id))
      : '';
    var details = active ? renderCableCardDetails(cable) : '';
    return '<li class="sidebar-card sidebar-card--cable' + (active ? ' sidebar-card--active sidebar-card--expanded' : '') +
      (tools ? ' sidebar-card--has-tools' : '') + (details ? ' sidebar-card--has-details' : '') + '">' +
      '<button type="button" class="sidebar-card__btn" ' + attrs + '>' +
      '<span class="sidebar-card__label">' + escapeSidebarHtml(getCableDisplayBatchLabel(cable)) + '</span>' +
      '<span class="sidebar-card__chevron" aria-hidden="true">' + (active ? '▾' : '▸') + '</span>' +
      '</button>' + details + tools + '</li>';
  }

  function renderSidebarSection(title, cardsHtml, emptyText, modifier, options) {
    options = options || {};
    var body = cardsHtml ||
      '<li class="sidebar-section__empty">' + escapeSidebarHtml(emptyText || '—') + '</li>';
    var modCls = modifier ? (' sidebar-section--' + modifier) : '';
    var collapsible = !!options.collapsible;
    var sectionKey = options.sectionKey || '';
    var collapsed = collapsible && !!(Sim.ui.sidebarSectionCollapsed && Sim.ui.sidebarSectionCollapsed[sectionKey]);
    var arrowCls = 'toggle-arrow sidebar-section__toggle' + (collapsed ? ' collapsed' : '');
    var cardsCls = 'sidebar-section__cards' + (collapsed ? ' hidden' : '');
    var suffix = '';
    if (!options.skipFdtSuffix) {
      if (options.fdtSuffix != null) suffix = options.fdtSuffix;
      else suffix = formatDetailsPanelFdtBadgeSuffix();
    }
    var displayTitle = title + suffix;
    var titleInner = collapsible
      ? '<span class="' + arrowCls + '" data-sidebar-section-toggle="' + escapeSidebarHtml(sectionKey) + '" role="button" tabindex="0" aria-expanded="' + (collapsed ? 'false' : 'true') + '" aria-label="Toggle ' + escapeSidebarHtml(displayTitle) + '">▾</span>' +
        escapeSidebarHtml(displayTitle)
      : escapeSidebarHtml(displayTitle);
    return '<section class="sidebar-section' + modCls + '">' +
      '<h3 class="sidebar-section__title" data-ab-base="' + escapeSidebarHtml(title) +
      '" data-ab-suffix="' + escapeSidebarHtml(suffix) + '">' + titleInner + '</h3>' +
      '<ul class="' + cardsCls + '">' + body + '</ul>' +
      '</section>';
  }

  function renderFiberDesignSidebarSection(nodeId) {
    if (global.FTTHFiberDesignUI && global.FTTHFiberDesignUI.renderSection) {
      return global.FTTHFiberDesignUI.renderSection(nodeId);
    }
    return '';
  }

  function getFiberDesignSidebarNodeId() {
    if (Sim.selectedNodeId) return Sim.selectedNodeId;
    var anchor = getSidebarAnchorHandholeNode();
    return anchor ? anchor.id : null;
  }

  function toggleSidebarSection(arrowEl) {
    if (!arrowEl) return;
    var titleEl = arrowEl.closest('.sidebar-section__title');
    var cards = titleEl && titleEl.nextElementSibling;
    if (!cards || !cards.classList.contains('sidebar-section__cards')) return;
    if (!Sim.ui.sidebarSectionCollapsed) Sim.ui.sidebarSectionCollapsed = { excav: false, cable: false };
    var key = arrowEl.getAttribute('data-sidebar-section-toggle') || '';
    var willCollapse = !cards.classList.contains('hidden');
    cards.classList.toggle('hidden', willCollapse);
    arrowEl.classList.toggle('collapsed', willCollapse);
    arrowEl.setAttribute('aria-expanded', willCollapse ? 'false' : 'true');
    if (key) Sim.ui.sidebarSectionCollapsed[key] = willCollapse;
  }

  function renderThreeSectionSidebar(node, focus) {
    focus = focus || Sim.ui.topologyTreeFocus || { kind: 'node', nodeId: node.id };
    /* Inspect selected node's own cabinet domain — Active FDT chrome stays locked. */
    var cabId = resolveInspectionCabinetId(node);
    /* Trench focus: list every in-trench cable (any cabinet), like free node/closure inspection. */
    var trenchInspectMode = focus.kind === 'excavation' && !!focus.pathId;

    var excavations = getExcavationsLinkedToNode(node);
    var cables = sortCablesForLaneOrder(getCablesLinkedToNode(node));

    /* Path focus isolates Evaluation only for map picks.
       Sidebar focus keeps the full linked inventory; only the active card is marked. */
    if (!Sim.ui.pathHighlightFromSidebar) {
      if (trenchInspectMode) {
        var focusedEx = excavations.filter(function (ex) { return ex.id === focus.pathId; });
        if (!focusedEx.length) {
          var aloneEx = findPathByRef({ type: 'excavation', id: focus.pathId });
          if (aloneEx) focusedEx = [aloneEx];
        }
        excavations = focusedEx;
        /* All cables physically inside this trench — not filtered by Active/inspected FDT. */
        cables = sortCablesForLaneOrder(getCablesOnTrenchForInspection(focus.pathId) || []);
      } else if (focus.kind === 'cable' && focus.pathId) {
        var focusedCable = findPathByRef({ type: 'fiber', id: focus.pathId });
        cables = focusedCable ? [focusedCable] : [];
        var hostTrench = focusedCable ? resolveTrenchForCable(focusedCable) : null;
        excavations = hostTrench ? [hostTrench] : [];
      }
    } else if (trenchInspectMode) {
      /* Sidebar trench card focus: still expose full in-trench cable list for comparison. */
      cables = sortCablesForLaneOrder(getCablesOnTrenchForInspection(focus.pathId) || []);
    }

    var holeActive = focus.kind === 'node' || focus.kind === 'pole' ||
      focus.anchorNodeId === node.id || focus.nodeId === node.id;
    var holesHtml = renderHandholeSidebarCard(node, holeActive);

    var excavHtml = '';
    excavations.forEach(function (ex) {
      if (!trenchInspectMode && cabId && !excavationBelongsToCabinet(ex, cabId)) return;
      var exActive = focus.kind === 'excavation' && focus.pathId === ex.id;
      excavHtml += renderExcavationSidebarCard(ex, exActive);
    });

    var cableHtml = '';
    cables.forEach(function (cable) {
      if (!trenchInspectMode && cabId && !cableBelongsToCabinet(cable, cabId)) return;
      cableHtml += renderCableSidebarCard(cable, focus.kind === 'cable' && focus.pathId === cable.id);
    });

    return '<div class="sidebar-sections-view">' +
      renderSidebarSection('AB_LM_Holes', holesHtml, 'No handhole', 'holes') +
      renderSidebarSection('AB_LM_Excavation', excavHtml, 'No excavation', 'excav', { collapsible: true, sectionKey: 'excav' }) +
      renderSidebarSection('AB_LM_Cabel', cableHtml, 'No cables', 'cable', { collapsible: true, sectionKey: 'cable' }) +
      renderFiberDesignSidebarSection(node.id) +
      '</div>';
  }

  function renderOrphanPathSidebar(path, pathType, focus) {
    focus = focus || Sim.ui.topologyTreeFocus || {
      kind: pathType === 'fiber' ? 'cable' : 'excavation',
      pathType: pathType,
      pathId: path.id,
    };

    var holesHtml = '';
    var excavHtml = '';
    var cableHtml = '';

    if (pathType === 'excavation') {
      /* Free trench inspection: always show the trench + every cable inside it. */
      var pathActive = focus.kind === 'excavation' && focus.pathId === path.id;
      excavHtml = renderExcavationSidebarCard(path, pathActive);
      sortCablesForLaneOrder(getCablesOnTrenchForInspection(path.id) || []).forEach(function (cable) {
        cableHtml += renderCableSidebarCard(cable, focus.kind === 'cable' && focus.pathId === cable.id);
      });
    } else if (pathType === 'fiber') {
      cableHtml = renderCableSidebarCard(path, focus.kind === 'cable' && focus.pathId === path.id);
      var trench = resolveTrenchForCable(path);
      if (trench) {
        var trenchActive = focus.kind === 'excavation' && focus.pathId === trench.id;
        excavHtml = renderExcavationSidebarCard(trench, trenchActive);
      }
    }

    // Only render sections that have content to reduce visual clutter
    var sectionsHtml = '';
    if (excavHtml) {
      sectionsHtml += renderSidebarSection('AB_LM_Excavation', excavHtml, 'No excavation', 'excav', { collapsible: true, sectionKey: 'excav' });
    }
    if (cableHtml) {
      sectionsHtml += renderSidebarSection('AB_LM_Cabel', cableHtml, 'No cables', 'cable', { collapsible: true, sectionKey: 'cable' });
    }

    return '<div class="sidebar-sections-view">' + sectionsHtml + '</div>';
  }

  function renderPathPropertyContent() {
    var meta = getPathSidebarMeta(Sim.selectedPath);
    if (!meta) return '<p class="prop-panel__hint text-slate-500 text-[11px]">Path not found.</p>';
    var path = meta.path;
    var pathType = Sim.selectedPath.type;
    var prevFocus = Sim.ui.topologyTreeFocus || {};
    var focus = {
      kind: pathType === 'fiber' ? 'cable' : 'excavation',
      pathType: pathType,
      pathId: path.id,
      anchorNodeId: prevFocus.anchorNodeId || null,
    };
    Sim.ui.topologyTreeFocus = focus;

    /* Map clicks: isolated path + in-trench cables only — never jump to parent handhole inventory. */
    if (!Sim.ui.pathHighlightFromSidebar) {
      return renderOrphanPathSidebar(path, pathType, focus);
    }

    var anchorNode = getSidebarAnchorHandholeNode();
    if (anchorNode) {
      return renderThreeSectionSidebar(anchorNode, focus);
    }
    return renderOrphanPathSidebar(path, pathType, focus);
  }

  function renderCablesInlineSection(node, heading) {
    var cables = getCablesThroughNode(node);
    var html = '<div class="prop-panel__cables mt-3 pole-unified-block__cables">';
    html += '<p class="prop-panel__subhead">' + escapeSidebarHtml(heading || ('Cables through ' + getNodeAsBuiltCode(node))) + '</p>';
    if (!cables.length) {
      html += '<p class="prop-panel__hint text-slate-500 text-[11px]">No cables pass through this asset yet.</p>';
    } else {
      html += '<ul class="prop-panel__cable-list">';
      cables.forEach(function (cable) {
        var lenM = pathLengthMeters(cable).toFixed(1);
        var asBuiltId = formatCableAsBuiltId(cable);
        html += '<li class="prop-panel__cable-item">' +
          '<span class="font-mono text-fiber-cyan">' + escapeSidebarHtml(asBuiltId) + '</span>' +
          '<span class="text-slate-400"> · ' + escapeSidebarHtml(String(cable.capacity || '?') + 'F') + '</span>' +
          '<span class="font-mono text-slate-300"> · ' + escapeSidebarHtml(lenM) + ' m</span></li>';
      });
      html += '</ul>';
    }
    html += '</div>';
    return html;
  }

  function renderHandholeUnifiedPanel(node) {
    return renderThreeSectionSidebar(node);
  }

  function renderNodePropertyContent(node) {
    if (!node) return '<p class="prop-panel__hint text-slate-500 text-[11px]">Component not found.</p>';
    if (node.type === 'fat_handhole' && node.hasFatPole) {
      /* Same linked excav/cable filter as handholes — pole focus still scopes to this node only. */
      return renderThreeSectionSidebar(node);
    }
    if (node.type === 'pole_foundation') {
      return renderPoleFoundationUnifiedPanel(node);
    }
    if (node.type === 'handhole' || node.type === 'fat_handhole') {
      return renderHandholeUnifiedPanel(node);
    }
    if (node.type === 'fdt') {
      return renderFdtCabinetUnifiedPanel(node);
    }
    var html = '<div class="pole-unified-view">';
    html += renderNodeAttributesPanel(node, getNodeAsBuiltAssetTag(node));
    html += renderCablesInlineSection(node);
    html += '</div>';
    return html;
  }

  function renderFdtCabinetUnifiedPanel(node) {
    var cabinetCode = getFdtCabinetCode(node);
    var html = '<div class="pole-unified-view">';
    html += '<p class="prop-panel__asbuilt-tag">AB_FDT</p>';
    html += '<dl class="prop-panel__list pole-unified-block text-[11px] space-y-1.5 mt-2">';
    html += '<div class="flex justify-between"><dt class="text-slate-500">Asset Type</dt><dd class="text-white font-mono">AB_FDT</dd></div>';
    html += '<div class="flex justify-between"><dt class="text-slate-500">Code</dt><dd class="text-fiber-cyan font-mono font-bold">' + escapeSidebarHtml(cabinetCode) + '</dd></div>';
    html += '<div class="flex justify-between"><dt class="text-slate-500">Cabinet</dt><dd class="text-fiber-cyan font-mono font-bold">' + escapeSidebarHtml(cabinetCode) + '</dd></div>';
    if (node.fatSplitter) {
      var sp = parseSplitterRatio(node.fatSplitter);
      html += '<div class="flex justify-between"><dt class="text-slate-500">Splitter</dt><dd class="text-purple-300 font-mono">' +
        node.fatSplitter + ' (' + sp.inputs + '×' + sp.outputs + ')</dd></div>';
    } else {
      html += '<div class="flex justify-between"><dt class="text-slate-500">Splitter</dt><dd class="text-slate-500">Not installed</dd></div>';
    }
    html += '<div class="flex justify-between"><dt class="text-slate-500">Grid Cell</dt><dd class="text-white font-mono">' + node.col + ',' + node.row + '</dd></div>';
    html += '<div class="flex justify-between"><dt class="text-slate-500">Locked</dt><dd class="text-white">' + (node.locked ? 'Yes' : 'No') + '</dd></div>';
    html += '</dl>';
    if (!node.fatSplitter) {
      html += '<div class="mt-3"><p class="text-[10px] text-slate-500 mb-1">Install Splitter Ratio</p><select id="prop-splitter-ratio" class="w-full text-[11px] rounded-lg bg-fiber-bg border border-fiber-border px-2 py-1.5">';
      SPLITTER_VARIANTS.forEach(function (v) {
        html += '<option value="' + v + '">' + v + '</option>';
      });
      html += '</select></div>';
    } else {
      html += '<div class="mt-3"><p class="text-[10px] text-slate-500 mb-1">Change Splitter Ratio</p><select id="prop-splitter-ratio" class="w-full text-[11px] rounded-lg bg-fiber-bg border border-fiber-border px-2 py-1.5">';
      SPLITTER_VARIANTS.forEach(function (v) {
        html += '<option value="' + v + '"' + (node.fatSplitter === v ? ' selected' : '') + '>' + v + '</option>';
      });
      html += '</select></div>';
    }
    html += renderCablesInlineSection(node, 'Cables through ' + cabinetCode);
    html += '</div>';
    return html;
  }

  function renderLmPoleUnifiedPanel(node) {
    var html = '<div class="pole-unified-view">';
    html += '<p class="prop-panel__asbuilt-tag">AB_LM_Poles</p>';
    html += '<dl class="prop-panel__list pole-unified-block text-[11px] space-y-1.5 mt-2">';
    html += '<div class="flex justify-between"><dt class="text-slate-500">Asset Type</dt><dd class="text-white font-mono">AB_LM_Poles</dd></div>';
    html += '<div class="flex justify-between"><dt class="text-slate-500">FAT System</dt><dd class="text-fiber-cyan font-mono font-bold">' +
      escapeSidebarHtml(node.fatSystemName || getNodeAsBuiltCode(node)) + '</dd></div>';
    html += '<div class="flex justify-between"><dt class="text-slate-500">Handhole Host</dt><dd class="text-slate-300 font-mono">' +
      escapeSidebarHtml(node.autoName || 'FAT Handhole') + '</dd></div>';
    html += '<div class="flex justify-between"><dt class="text-slate-500">Pole</dt><dd class="text-slate-200">Mounted</dd></div>';
    if (node.fatSplitter) {
      var sp = parseSplitterRatio(node.fatSplitter);
      html += '<div class="flex justify-between"><dt class="text-slate-500">Splitter</dt><dd class="text-purple-300 font-mono">' +
        node.fatSplitter + ' (' + sp.inputs + '×' + sp.outputs + ')</dd></div>';
    } else {
      html += '<div class="flex justify-between"><dt class="text-slate-500">Splitter</dt><dd class="text-slate-500">Not installed</dd></div>';
    }
    if (node.hasClosure) {
      html += '<div class="flex justify-between"><dt class="text-slate-500">Closure</dt><dd class="text-red-400">Nested in triangle</dd></div>';
    }
    html += '<div class="flex justify-between"><dt class="text-slate-500">Grid Cell</dt><dd class="text-white font-mono">' + node.col + ',' + node.row + '</dd></div>';
    html += '<div class="flex justify-between"><dt class="text-slate-500">Locked</dt><dd class="text-white">' + (node.locked ? 'Yes' : 'No') + '</dd></div>';
    html += '</dl>';
    if (!node.fatSplitter) {
      html += '<div class="mt-3"><p class="text-[10px] text-slate-500 mb-1">Install Splitter Ratio</p><select id="prop-splitter-ratio" class="w-full text-[11px] rounded-lg bg-fiber-bg border border-fiber-border px-2 py-1.5">';
      SPLITTER_VARIANTS.forEach(function (v) {
        html += '<option value="' + v + '">' + v + '</option>';
      });
      html += '</select></div>';
    } else {
      html += '<div class="mt-3"><p class="text-[10px] text-slate-500 mb-1">Change Splitter Ratio</p><select id="prop-splitter-ratio" class="w-full text-[11px] rounded-lg bg-fiber-bg border border-fiber-border px-2 py-1.5">';
      SPLITTER_VARIANTS.forEach(function (v) {
        html += '<option value="' + v + '"' + (node.fatSplitter === v ? ' selected' : '') + '>' + v + '</option>';
      });
      html += '</select></div>';
    }
    html += renderCablesInlineSection(node, 'Cables through pole system');
    html += '</div>';
    return html;
  }

  function renderPoleFoundationUnifiedPanel(node) {
    var html = '<div class="pole-unified-view">';
    html += '<p class="prop-panel__asbuilt-tag">AB_LM_Poles</p>';
    html += '<dl class="prop-panel__list pole-unified-block text-[11px] space-y-1.5 mt-2">';
    html += '<div class="flex justify-between"><dt class="text-slate-500">Asset Type</dt><dd class="text-white font-mono">AB_LM_Poles</dd></div>';
    html += '<div class="flex justify-between"><dt class="text-slate-500">Element</dt><dd class="text-white font-mono">' +
      (node.hasPole ? 'Pole' : 'Pole Foundation') + '</dd></div>';
    html += '<div class="flex justify-between"><dt class="text-slate-500">Foundation</dt><dd class="text-slate-300 font-mono">' +
      escapeSidebarHtml(node.poleName || node.autoName || getNodeAsBuiltCode(node)) + '</dd></div>';
    html += '<div class="flex justify-between"><dt class="text-slate-500">Pole Tower</dt><dd class="text-slate-200">' +
      (node.hasPole ? 'Mounted' : 'Not mounted') + '</dd></div>';
    if (node.hasClosure) {
      html += '<div class="flex justify-between"><dt class="text-slate-500">Closure</dt><dd class="text-red-400">Installed on foundation</dd></div>';
    }
    if (node.fatSplitter) {
      var sp = parseSplitterRatio(node.fatSplitter);
      html += '<div class="flex justify-between"><dt class="text-slate-500">Splitter</dt><dd class="text-purple-300 font-mono">' +
        node.fatSplitter + ' (' + sp.inputs + '×' + sp.outputs + ')</dd></div>';
    }
    html += '<div class="flex justify-between"><dt class="text-slate-500">Grid Cell</dt><dd class="text-white font-mono">' + node.col + ',' + node.row + '</dd></div>';
    html += '<div class="flex justify-between"><dt class="text-slate-500">Locked</dt><dd class="text-white">' + (node.locked ? 'Yes' : 'No') + '</dd></div>';
    html += '</dl>';
    var excavHtml = '';
    getExcavationsLinkedToNode(node).forEach(function (ex) {
      excavHtml += renderExcavationSidebarCard(ex, false);
    });
    html += renderSidebarSection('AB_LM_Excavation', excavHtml, 'No excavation linked to this pole', 'excav', {
      collapsible: true,
      sectionKey: 'excav',
    });
    html += renderCablesInlineSection(node, 'Cables through pole foundation');
    html += '</div>';
    return html;
  }

  function handleSidebarAction(action, pathType, pathId, nodeId) {
    if (action === 'toggle-excav-accordion') {
      Sim.ui.pathExcavAccordionOpen = !Sim.ui.pathExcavAccordionOpen;
      renderUnifiedSidebar();
      return;
    }
    if (action === 'toggle-edit') {
      Sim.ui.sidebarEditMode = !Sim.ui.sidebarEditMode;
      if (!Sim.ui.sidebarEditMode) {
        if (getCurrentMode() === WORKSPACE_MODES.CUT || getCurrentMode() === WORKSPACE_MODES.VERTEX) {
          enableSelectMode();
        } else if (Sim.pathEdit) {
          Sim.pathEdit.editActive = false;
          Sim.pathEdit.editingPathId = null;
        }
        syncDrawingLayerInteraction();
        renderGlobalDrawingLayer();
      } else {
        var focus = Sim.ui.topologyTreeFocus;
        if (Sim.selectedPath) {
          focusPathEditTarget(Sim.selectedPath.type, Sim.selectedPath.id);
        } else if (focus?.kind === 'excavation' && focus.pathId) {
          focusPathEditTarget('excavation', focus.pathId);
        } else if (focus?.kind === 'cable' && focus.pathId) {
          focusPathEditTarget('fiber', focus.pathId);
        }
      }
      renderUnifiedSidebar();
      return;
    }
    if (!Sim.ui.sidebarEditMode) return;

    var targetType = pathType || (Sim.selectedPath && Sim.selectedPath.type);
    var targetId = pathId || (Sim.selectedPath && Sim.selectedPath.id);

    if (targetType && targetId && (action === 'cut' || action === 'vertex' || action === 'delete')) {
      focusPathEditTarget(targetType, targetId);
      if (action === 'cut') {
        var cutOn = !!(Sim.pathEdit?.splitToolActive || getActiveCanvasTool() === 'cut');
        if (cutOn && Sim.pathEdit?.editingPathId?.type === targetType &&
            Sim.pathEdit.editingPathId?.id === targetId) {
          Sim.pathEdit.splitToolActive = false;
          setActiveCanvasTool('select');
        } else {
          if (Sim.pathEdit) Sim.pathEdit.vertexToolActive = false;
          Sim.pathEdit.splitToolActive = true;
          setActiveCanvasTool('cut');
        }
        syncDrawingLayerInteraction();
        renderUnifiedSidebar();
        updateStatus(cutOn ? 'Cut tool off' : 'Cut — ' + targetType + ' on map');
        return;
      }
      if (action === 'vertex') {
        var vtxOn = !!(Sim.pathEdit?.vertexToolActive || getActiveCanvasTool() === 'vertex');
        if (vtxOn && Sim.pathEdit?.editingPathId?.type === targetType &&
            Sim.pathEdit.editingPathId?.id === targetId) {
          Sim.pathEdit.vertexToolActive = false;
          setActiveCanvasTool('select');
        } else {
          if (Sim.pathEdit) Sim.pathEdit.splitToolActive = false;
          Sim.pathEdit.vertexToolActive = true;
          setActiveCanvasTool('vertex');
        }
        syncDrawingLayerInteraction();
        renderGlobalDrawingLayer();
        renderUnifiedSidebar();
        updateStatus(vtxOn ? 'Vertex tool off' : 'Vertex tool — ' + targetType + ' on map');
        return;
      }
      if (action === 'delete') {
        deletePathway(targetType, targetId);
        return;
      }
    }

    if (action === 'delete-node') {
      var delNodeId = nodeId || Sim.selectedNodeId;
      if (delNodeId) removeElement(delNodeId);
      return;
    }

    if (action === 'move' || action === 'lock') {
      var targetNodeId = nodeId || Sim.selectedNodeId;
      if (!targetNodeId) return;
      if (action === 'move') startMoveNode(targetNodeId);
      else toggleNodeLock(targetNodeId);
      renderUnifiedSidebar();
    }
  }

  function handleTopologyTreeFocus(btn) {
    var kind = btn.getAttribute('data-topology-focus');
    if (!kind) return;
    /* Sidebar focus is inspection-only — never gated by / never changes Active FDT. */
    if (kind === 'node') {
      var nodeId = btn.getAttribute('data-focus-node-id') || Sim.selectedNodeId;
      if (nodeId) {
        selectNode(nodeId, { fromSidebar: true });
        renderUnifiedSidebar();
      }
      return;
    }
    if (kind === 'excavation' || kind === 'cable') {
      var pathType = btn.getAttribute('data-path-type');
      var pathId = btn.getAttribute('data-path-id');
      if (pathType && pathId) {
        selectPath(pathType, pathId, false, { fromSidebar: true });
        renderUnifiedSidebar();
      }
      return;
    }
    if (kind === 'pole' || kind === 'cabinet') {
      var focusNodeId = btn.getAttribute('data-focus-node-id');
      if (!focusNodeId) return;
      clearTopologyHighlight();
      Sim.selectedPath = null;
      if (Sim.pathEdit) {
        Sim.pathEdit.editingPathId = null;
        Sim.pathEdit.editActive = false;
      }
      Sim.ui.pathHighlightFromSidebar = false;
      Sim.ui.topologyTreeFocus = { kind: kind, nodeId: focusNodeId };
      Sim.selectedNodeId = focusNodeId;
      document.querySelectorAll('.placed-node').forEach(function (el) {
        el.classList.toggle('selected', el.dataset.id === focusNodeId);
      });
      applyTopologyHighlightClasses();
      renderGlobalDrawingLayer();
      renderUnifiedSidebar();
    }
  }

  function bindUnifiedSidebarEvents() {
    var body = document.getElementById('property-panel-body');
    if (!body) return;
    body.querySelectorAll('[data-sidebar-section-toggle]').forEach(function (arrow) {
      arrow.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        toggleSidebarSection(arrow);
      });
      arrow.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        e.stopPropagation();
        toggleSidebarSection(arrow);
      });
    });
    body.querySelectorAll('[data-topology-focus]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        handleTopologyTreeFocus(btn);
      });
    });
    body.querySelectorAll('[data-sidebar-action]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        handleSidebarAction(
          btn.getAttribute('data-sidebar-action'),
          btn.getAttribute('data-path-type'),
          btn.getAttribute('data-path-id'),
          btn.getAttribute('data-focus-node-id')
        );
      });
    });
    var ratioSel = document.getElementById('prop-splitter-ratio');
    if (ratioSel && Sim.selectedNodeId) {
      var node = findNode(Sim.selectedNodeId);
      if (node) {
        ratioSel.addEventListener('change', function () {
          node.fatSplitter = ratioSel.value;
          node.splitterMeta = parseSplitterRatio(ratioSel.value);
          renderNode(node);
          renderUnifiedSidebar();
        });
      }
    }
    if (global.FTTHFiberDesignUI && global.FTTHFiberDesignUI.bind) {
      global.FTTHFiberDesignUI.bind(body, getFiberDesignSidebarNodeId());
    }
  }

  function renderUnifiedSidebar() {
    syncSidebarSelectionState();
    var body = document.getElementById('property-panel-body');
    if (!body) return;

    if (!Sim.selectedNodeId && !Sim.selectedPath) {
      body.innerHTML = '';
      Sim.ui.sidebarEditMode = false;
      return;
    }

    var html = renderSidebarHeader();
    /* Selected path always owns Evaluation content (blocks parent-hole inventory jumps). */
    if (Sim.selectedPath) {
      html += renderPathPropertyContent();
    } else if (Sim.selectedNodeId) {
      html += renderNodePropertyContent(findNode(Sim.selectedNodeId));
    }
    body.innerHTML = html;
    bindUnifiedSidebarEvents();
  }

  function renderPropertyPanel(node) {
    renderUnifiedSidebar();
  }

  function getNodeAsBuiltAssetTag(node) {
    if (!node) return 'AB_Asset';
    if (node.type === 'handhole' || node.type === 'fat_handhole') return 'AB_LM_Holes';
    if (node.type === 'fdt') return 'AB_FDT';
    if (node.type === 'olt') return 'AB_OLT';
    return 'AB_Asset';
  }

  function renderNodeAttributesPanel(node, assetTag) {
    var tag = assetTag || getNodeAsBuiltAssetTag(node);
    var html = '<dl class="prop-panel__list text-[11px] space-y-1.5 mt-2">';
    html += '<div class="flex justify-between"><dt class="text-slate-500">Asset Type</dt><dd class="text-white font-mono">' + tag + '</dd></div>';
    html += '<div class="flex justify-between"><dt class="text-slate-500">Element</dt><dd class="text-white font-mono">' + node.type + '</dd></div>';
    html += '<div class="flex justify-between"><dt class="text-slate-500">Code</dt><dd class="text-fiber-cyan font-mono font-bold">' + getNodeAsBuiltCode(node) + '</dd></div>';
    if (node.autoName) {
      html += '<div class="flex justify-between"><dt class="text-slate-500">Name</dt><dd class="text-fiber-cyan font-mono font-bold">' + node.autoName + '</dd></div>';
    }
    if (node.fatSystemName) {
      html += '<div class="flex justify-between"><dt class="text-slate-500">FAT System</dt><dd class="text-slate-300 font-mono">' + node.fatSystemName + '</dd></div>';
    }
    if (node.closureName && node.type === 'handhole') {
      html += '<div class="flex justify-between"><dt class="text-slate-500">Closure</dt><dd class="text-red-400 font-mono">' + node.closureName + '</dd></div>';
    }
    if (node.hasClosure && node.type === 'handhole' && !node.closureName) {
      html += '<div class="flex justify-between"><dt class="text-slate-500">Closure</dt><dd class="text-red-400">Installed</dd></div>';
    }
    if (node.hasClosure && node.type === 'fat_handhole') {
      html += '<div class="flex justify-between"><dt class="text-slate-500">Closure</dt><dd class="text-red-400">Nested in triangle</dd></div>';
    }
    if (node.hasFatPole) {
      html += '<div class="flex justify-between"><dt class="text-slate-500">FAT Pole</dt><dd class="text-slate-400">Mounted (see Cables tab)</dd></div>';
    }
    html += '<div class="flex justify-between"><dt class="text-slate-500">Grid Cell</dt><dd class="text-white font-mono">' + node.col + ',' + node.row + '</dd></div>';
    html += '<div class="flex justify-between"><dt class="text-slate-500">Locked</dt><dd class="text-white">' + (node.locked ? 'Yes' : 'No') + '</dd></div>';
    if (node.fatSplitter) {
      var sp = parseSplitterRatio(node.fatSplitter);
      html += '<div class="flex justify-between"><dt class="text-slate-500">Splitter</dt><dd class="text-purple-300">' +
        sp.inputs + '×' + sp.outputs + '</dd></div>';
    }
    html += '</dl>';
    if ((node.type === 'fdt' || (node.type === 'fat_handhole' && node.hasFatPole)) && node.fatSplitter) {
      html += '<div class="mt-3"><p class="text-[10px] text-slate-500 mb-1">Change Splitter Ratio</p><select id="prop-splitter-ratio" class="w-full text-[11px] rounded-lg bg-fiber-bg border border-fiber-border px-2 py-1.5">';
      SPLITTER_VARIANTS.forEach(function (v) {
        html += '<option value="' + v + '"' + (node.fatSplitter === v ? ' selected' : '') + '>' + v + '</option>';
      });
      html += '</select></div>';
    }
    return html;
  }

  function renderNodeCablesPanel(node) {
    var cables = getCablesThroughNode(node);
    var html = '<div class="prop-panel__cables mt-2">';
    html += '<p class="prop-panel__subhead">Cables through ' + getNodeAsBuiltCode(node) + '</p>';
    if (!cables.length) {
      html += '<p class="prop-panel__hint text-slate-500 text-[11px]">No cables pass through this handhole yet.</p>';
    } else {
      html += '<ul class="prop-panel__cable-list">';
      cables.forEach(function (cable) {
        var lenM = pathLengthMeters(cable).toFixed(1);
        var asBuiltId = formatCableAsBuiltId(cable);
        html += '<li class="prop-panel__cable-item">' +
          '<span class="font-mono text-fiber-cyan">' + asBuiltId + '</span>' +
          '<span class="text-slate-400"> · ' + (cable.capacity || '?') + 'F</span>' +
          '<span class="font-mono text-slate-300"> · ' + lenM + ' m</span></li>';
      });
      html += '</ul>';
    }
    html += '</div>';
    return html;
  }

  function startMoveNode(nodeId) {
    var node = findNode(nodeId);
    if (!node) return;
    Sim.moveNodeId = null;
    selectNode(nodeId);
    updateStatus('Use Hand tool drag-and-drop to move — click-to-relocate is disabled');
  }

  function toggleNodeLock(nodeId) {
    var node = findNode(nodeId);
    if (!node) return;
    node.locked = !node.locked;
    renderNode(node);
    selectNode(nodeId);
    updateStatus(node.locked ? 'Node locked' : 'Node unlocked');
  }

  function removeElement(nodeId) {
    deleteNode(nodeId);
  }

  function deleteNode(nodeId) {
    var node = findNode(nodeId);
    if (!node) return;
    if (node.locked) {
      updateStatus('Unlock node before deleting', true);
      return;
    }
    Sim.nodes = Sim.nodes.filter(function (n) { return n.id !== nodeId; });
    Sim.connections = Sim.connections.filter(function (c) { return c.from !== nodeId && c.to !== nodeId; });
    var el = document.querySelector('.placed-node[data-id="' + nodeId + '"]');
    if (el) el.remove();
    document.querySelectorAll('.grid-cell').forEach(function (c) {
      var col = parseInt(c.dataset.col, 10);
      var row = parseInt(c.dataset.row, 10);
      if (!getNodeAt(col, row)) {
        c.classList.remove('has-node', 'has-pole-foundation', 'has-pole-tower', 'has-handhole', 'has-fat-handhole');
      }
    });
    if (Sim.selectedNodeId === nodeId) clearNodeSelection();
    if (Sim.moveNodeId === nodeId) Sim.moveNodeId = null;
    syncNameCountersFromNodes();
    syncDefaultCableBatchesToMap();
    renderConnections();
    updateMetrics();
    updateStatus('Component deleted');
    saveState();
    notifyFiberDesignTopologyChanged();
  }

  function relocateNode(node, col, row, dropPt) {
    if (!Sim.ui.clickToMoveActive && isHandholeNodePositionLocked(node)) {
      updateStatus('Handhole position is locked during cable draw/edit', true);
      return false;
    }
    if (!canPlaceVirtual(node.type, col, row)) {
      updateStatus('Invalid destination cell', true);
      return false;
    }
    if (getNodeAt(col, row)) {
      updateStatus('Destination occupied', true);
      return false;
    }
    node.col = col;
    node.row = row;
    snapNodeToCell(node);
    Sim.moveNodeId = null;
    renderAllNodes();
    selectNode(node.id);
    updateStatus('Component moved');
    saveState();
    return true;
  }

  function openFullscreen() {
    toggleAppFullscreen();
  }

  function updateStatus(msg, warn) {
    var el = document.getElementById('workspace-status');
    if (el) el.textContent = msg;
    if (warn && DEBUG) console.warn(msg);
  }

  function setSmartStatusHint(msg) {
    setPushHint(msg);
  }

  function syncSmartStatusBarTools() {
    /* legacy — quick nav controls retired from bottom bar */
  }

  function getMapScaleDenom() {
    var z = Sim.zoom || 1;
    return Math.max(1, Math.round(1000 / z));
  }

  function formatStatusCoord(n) {
    if (!isFinite(n)) return '—';
    var val = Number(n).toFixed(1);
    var sign = val.charAt(0) === '-' ? '-' : '';
    var body = sign ? val.slice(1) : val;
    var parts = body.split('.');
    var intPart = parts[0] || '0';
    while (intPart.length < 3) intPart = '0' + intPart;
    return sign + intPart + '.' + (parts[1] || '0');
  }

  function syncGisStatusBarCoords(xy) {
    var el = Sim.ui && Sim.ui.gisStatusBarCoordsEl;
    if (!el) {
      el = document.getElementById('status-bar-coords');
      if (!Sim.ui) Sim.ui = {};
      Sim.ui.gisStatusBarCoordsEl = el;
    }
    if (!el) return;

    if (xy && isFinite(xy.x) && isFinite(xy.y)) {
      Sim.ui.lastKnownCanvasCoords = { x: Number(xy.x), y: Number(xy.y) };
      Sim.ui.lastCanvasPointer = Sim.ui.lastKnownCanvasCoords;
      el.textContent = 'X: ' + formatStatusCoord(xy.x) + ' Y: ' + formatStatusCoord(xy.y);
      el.classList.remove('gis-status-bar__value--coords-idle');
      return;
    }

    /* Retain last known coordinates — never collapse to dashes (prevents reflow). */
    var last = Sim.ui.lastKnownCanvasCoords || Sim.ui.lastCanvasPointer;
    if (last && isFinite(last.x) && isFinite(last.y)) {
      el.textContent = 'X: ' + formatStatusCoord(last.x) + ' Y: ' + formatStatusCoord(last.y);
      el.classList.remove('gis-status-bar__value--coords-idle');
      return;
    }

    el.textContent = 'X: 000.0 Y: 000.0';
    el.classList.add('gis-status-bar__value--coords-idle');
  }

  function syncGisStatusBarScale() {
    var el = document.getElementById('status-bar-scale');
    if (el) el.textContent = '1:' + getMapScaleDenom();
  }

  function syncGisStatusBarZoom() {
    var el = document.getElementById('status-bar-zoom');
    if (el) el.textContent = Math.round((Sim.zoom || 1) * 100) + '%';
  }

  function syncGisStatusBarRotation() {
    var input = document.getElementById('status-bar-rotation');
    if (!input) return;
    var applied = Sim.settings.mapRotationEnabled
      ? (((Sim.mapRotation || 0) % 360 + 360) % 360)
      : 0;
    input.value = applied.toFixed(1);
  }

  function syncGisStatusBar() {
    syncGisStatusBarScale();
    syncGisStatusBarZoom();
    syncGisStatusBarRotation();
    syncGisStatusBarCoords(Sim.ui?.lastKnownCanvasCoords || Sim.ui?.lastCanvasPointer || null);
  }

  function setStatusBarInteractivePathMode(enabled) {
    var wrap = document.getElementById('status-bar-push-hint');
    var group = wrap && wrap.closest
      ? wrap.closest('.gis-status-bar__group--rotation')
      : null;
    if (wrap) {
      if (enabled) wrap.classList.add('is-interactive-path');
      else wrap.classList.remove('is-interactive-path');
    }
    if (group) {
      if (enabled) group.classList.add('is-interactive-path');
      else group.classList.remove('is-interactive-path');
    }
  }

  /**
   * Update Active Path / push-hint slot.
   * @param {string|null|undefined} msg
   * @param {{ interactivePath?: boolean }} [opts]
   *   interactivePath:true → full trail layout, no idle "Active Path" prefix.
   *   interactivePath:false → idle layout. Omit → infer from live trail/confirm state.
   */
  function setPushHint(msg, opts) {
    if (!Sim.ui) Sim.ui = {};
    opts = opts || {};
    var next = (msg == null || msg === '') ? ACTIVE_PATH_IDLE_LABEL : String(msg);
    var interactive = typeof opts.interactivePath === 'boolean'
      ? opts.interactivePath
      : isInteractiveCablePathStatusActive();

    if (interactive) {
      next = stripActivePathPrefix(next);
      if (!next) next = ACTIVE_PATH_IDLE_LABEL;
    } else {
      /* Idle / batch selection: always show the original "Active Path · …" form. */
      if (next !== ACTIVE_PATH_IDLE_LABEL && !ACTIVE_PATH_PREFIX_RE.test(next) &&
          !/^(Main Cable|Sub-Cable|Checkpoint|Drop)\b/i.test(next)) {
        next = 'Active Path · ' + next;
      }
      interactive = false;
    }

    Sim.ui.pushHint = next;
    setStatusBarInteractivePathMode(!!interactive && next !== ACTIVE_PATH_IDLE_LABEL);
    var activeEl = document.getElementById('status-bar-active-path');
    if (activeEl) {
      activeEl.textContent = next;
      activeEl.title = next;
    } else {
      var el = document.getElementById('status-bar-push-hint');
      if (el && !Sim.ui.batchDuplicationWarning) {
        el.textContent = next;
        el.title = next;
      }
    }
    /* Keep duplication badge on top when active — Active Path stays stored for restore. */
    if (Sim.ui.batchDuplicationWarning) {
      syncStatusBarDuplicationDisplay(Sim.ui.batchDuplicationWarning);
    }
  }

  function ensureMapRotationEnabled() {
    if (Sim.settings.mapRotationEnabled) return;
    Sim.settings.mapRotationEnabled = true;
    var rotToggle = document.getElementById('settings-map-rotation');
    var rotControls = document.getElementById('settings-rotation-controls');
    if (rotToggle) rotToggle.checked = true;
    if (rotControls) {
      rotControls.classList.remove('hidden');
      rotControls.setAttribute('aria-hidden', 'false');
    }
  }

  function applyStatusBarRotation(deg) {
    var nextDisplay = ((parseFloat(deg) || 0) % 360 + 360) % 360;
    var currentInternal = Number(Sim.mapRotation) || 0;
    var nearestTurns = Math.round((currentInternal - nextDisplay) / 360);
    var next = nextDisplay + nearestTurns * 360;
    ensureMapRotationEnabled();
    setMapRotation(next);
  }

  function nudgeStatusBarRotation(delta) {
    ensureMapRotationEnabled();
    var currentInternal = Number(Sim.mapRotation) || 0;
    setMapRotation(currentInternal + delta);
  }

  var statusBarRotationHoldDelay = null;
  var statusBarRotationHoldInterval = null;

  function stopStatusBarRotationHold() {
    if (statusBarRotationHoldDelay) {
      clearTimeout(statusBarRotationHoldDelay);
      statusBarRotationHoldDelay = null;
    }
    if (statusBarRotationHoldInterval) {
      clearInterval(statusBarRotationHoldInterval);
      statusBarRotationHoldInterval = null;
    }
  }

  function startStatusBarRotationHold(delta) {
    stopStatusBarRotationHold();
    nudgeStatusBarRotation(delta);
    statusBarRotationHoldDelay = setTimeout(function () {
      statusBarRotationHoldDelay = null;
      statusBarRotationHoldInterval = setInterval(function () {
        nudgeStatusBarRotation(delta);
      }, 45);
    }, 280);
  }

  function bindStatusBarRotationHoldButton(btn, delta) {
    if (!btn) return;
    btn.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      startStatusBarRotationHold(delta);
    });
    btn.addEventListener('mouseleave', stopStatusBarRotationHold);
  }

  function bindGisStatusBar() {
    if (Sim.ui.gisStatusBarBound) return;
    Sim.ui.gisStatusBarBound = true;

    var wrap = document.getElementById('canvas-wrapper');
    if (wrap) {
      wrap.addEventListener('pointermove', function (e) {
        syncGisStatusBarCoords(pointerClientToCanvasXY(e.clientX, e.clientY));
      });
      /* Do not clear coords on leave — lock last known values for layout stability. */
      wrap.addEventListener('pointerleave', function () {
        syncGisStatusBarCoords(Sim.ui?.lastKnownCanvasCoords || null);
      });
    }

    var rotInput = document.getElementById('status-bar-rotation');
    var rotDown = document.getElementById('status-bar-rotation-down');
    var rotUp = document.getElementById('status-bar-rotation-up');
    var rotReset = document.getElementById('status-bar-rotation-reset');

    if (rotInput) {
      rotInput.addEventListener('change', function () {
        applyStatusBarRotation(rotInput.value);
      });
      rotInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          rotInput.blur();
          applyStatusBarRotation(rotInput.value);
        }
      });
    }
    bindStatusBarRotationHoldButton(rotDown, -1);
    bindStatusBarRotationHoldButton(rotUp, 1);
    if (rotReset) {
      rotReset.addEventListener('mousedown', function (e) { e.preventDefault(); });
      rotReset.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        stopStatusBarRotationHold();
        applyStatusBarRotation(0);
      });
    }
    document.addEventListener('mouseup', stopStatusBarRotationHold);

    syncGisStatusBar();
    refreshPushHintFromContext();
  }

  function refreshPushHintFromContext() {
    setPushHint(getActivePathStatusLabel());
  }

  function bindSmartStatusBar() {
    bindGisStatusBar();
  }

  function notifyNetworkTopologyChanged() {
    saveState();
    updateMetrics();
    renderGlobalDrawingLayer();
    renderUnifiedSidebar();
  }

  function sumPathLengthsPx() {
    var editor = global.FTTHPathwayEditor;
    var cs = Sim.layout?.cellSize || 50;
    var total = 0;
    if (!editor?.getPathLength) return 0;
    var cabId = getActiveFdtId();
    (Sim.excavationPaths || []).forEach(function (p) {
      if (cabId && !excavationBelongsToCabinet(p, cabId)) return;
      total += editor.getPathLength(p, cs);
    });
    (Sim.fiberCablePaths || []).forEach(function (p) {
      if (cabId && !cableBelongsToCabinet(p, cabId)) return;
      total += editor.getPathLength(p, cs);
    });
    return total;
  }

  function getActiveFieldCounterContext() {
    if (Sim.pen?.lineMode === 'cable') {
      return {
        mode: 'cable',
        capacity: getCableCapacityForKind(Sim.pen.cableKind),
        kind: Sim.pen.cableKind,
      };
    }
    if (Sim.pen?.lineMode === 'excavation') {
      return {
        mode: 'duct',
        excavKind: Sim.pen.excavKind || 'direct_buried',
      };
    }
    if (Sim.pen?.cableKind && isPenToolSelected()) {
      return {
        mode: 'cable',
        capacity: getCableCapacityForKind(Sim.pen.cableKind),
        kind: Sim.pen.cableKind,
      };
    }
    return {
      mode: 'duct',
      excavKind: Sim.pen?.excavKind || 'direct_buried',
    };
  }

  function buildHandholeFieldStats() {
    var total = (Sim.nodes || []).filter(function (n) { return n && n.type === 'handhole'; }).length;
    var lastId = Sim.counters.handhole > 0 ? ('H' + Sim.counters.handhole) : '—';
    if (lastId === '—' && total > 0) {
      var maxH = 0;
      (Sim.nodes || []).forEach(function (n) {
        if (n?.type !== 'handhole' || !n.autoName) return;
        var hm = String(n.autoName).match(/^H(\d+)$/i);
        if (hm) maxH = Math.max(maxH, parseInt(hm[1], 10) || 0);
      });
      if (maxH > 0) lastId = 'H' + maxH;
    }
    return { total: total, lastId: lastId };
  }

  function buildCableFieldStats(capacity) {
    var cap = capacity || 12;
    var matching = (Sim.fiberCablePaths || []).filter(function (c) {
      if (!c) return false;
      return (c.capacity || getCableCapacityForKind(c.kind)) === cap;
    });
    var lastLabel = '—';
    var maxSeq = 0;
    matching.forEach(function (c) {
      var lbl = c.asBuiltId || c.name || '';
      var m = String(lbl).match(/^(\d+)F(\d+)$/i);
      if (m && parseInt(m[1], 10) === cap) {
        var seq = parseInt(m[2], 10);
        if (seq >= maxSeq) {
          maxSeq = seq;
          lastLabel = lbl;
        }
      }
    });
    if (lastLabel === '—' && Sim.counters.cableByCapacity[cap] > 0) {
      lastLabel = formatCableLabel(cap, Sim.counters.cableByCapacity[cap]);
    }
    return { total: matching.length, lastLabel: lastLabel, capacity: cap };
  }

  function buildDuctFieldStats(excavKind) {
    var kind = excavKind || 'direct_buried';
    var matching = (Sim.excavationPaths || []).filter(function (p) {
      return p && (p.kind || 'direct_buried') === kind;
    });
    var lastLabel = '—';
    if (matching.length) {
      var lastPath = matching[matching.length - 1];
      lastLabel = getExcavLabelForKind(kind) + getExcavationDisplayNumber(lastPath);
    }
    return {
      total: matching.length,
      lastLabel: lastLabel,
      kindLabel: getExcavLabelForKind(kind),
    };
  }

  function buildPoleFieldStats() {
    var lastId = Sim.counters.pole > 0 ? ('P' + Sim.counters.pole) : '—';
    if (lastId === '—') {
      var maxP = 0;
      (Sim.nodes || []).forEach(function (n) {
        if (n?.type !== 'pole_foundation' || !n.hasPole || !n.poleName) return;
        var pm = String(n.poleName).match(/^P(\d+)$/i);
        if (pm) maxP = Math.max(maxP, parseInt(pm[1], 10) || 0);
      });
      if (maxP > 0) lastId = 'P' + maxP;
    }
    return { lastId: lastId };
  }

  function getActiveBatchLabel() {
    var ctx = getActiveFieldCounterContext();
    if (ctx.mode === 'cable') {
      return formatCableLabel(ctx.capacity, getCableBatchForKind(ctx.kind));
    }
    var kind = Sim.ui?.activeCableKind || Sim.pen?.cableKind || 'lastmile';
    return formatCableLabel(getCableCapacityForKind(kind), getCableBatchForKind(kind));
  }

  function getLastInstalledElementLabel() {
    var remembered = normalizeStatusElementLabel(Sim.ui?.lastInstalledElementLabel);
    if (remembered) return remembered;
    for (var i = (Sim.nodes || []).length - 1; i >= 0; i--) {
      var node = Sim.nodes[i];
      if (!node) continue;
      if (node.type === 'handhole' && node.hasClosure && node.closureName) return node.closureName;
      if (node.type === 'fat_handhole' && node.hasFatPole && node.fatSystemName) return node.fatSystemName;
      if ((node.type === 'handhole' || node.type === 'fat_handhole') && node.autoName) return node.autoName;
      if (node.type === 'fdt' && node.autoName) return node.autoName;
    }
    return '—';
  }

  function updateFieldStatusCounters() {
    var batch = getActiveBatchLabel();
    var last = getLastInstalledElementLabel();
    setPushHint(getActivePathStatusLabel());
    var summaryEl = document.getElementById('field-status-summary');
    if (summaryEl) {
      summaryEl.textContent = '[ Active Batch: ' + batch +
        ' | Last Element: ' + last + ' ]';
    }
  }

  function countPlacedAssetByToolId(toolId) {
    var nodes = Sim.nodes || [];
    var cabId = getActiveFdtId();
    function inScope(n) {
      if (!cabId) return true;
      if (toolId === 'fdt' || toolId === 'olt') return true;
      return nodeBelongsToCabinet(n, cabId);
    }
    if (toolId === 'olt') {
      return nodes.filter(function (n) { return n && n.type === 'olt'; }).length;
    }
    if (toolId === 'handhole') {
      return nodes.filter(function (n) { return n && n.type === 'handhole' && inScope(n); }).length;
    }
    if (toolId === 'fat_handhole') {
      return nodes.filter(function (n) { return n && n.type === 'fat_handhole' && inScope(n); }).length;
    }
    if (toolId === 'fdt') {
      return nodes.filter(function (n) { return n && n.type === 'fdt'; }).length;
    }
    if (toolId === 'closure') {
      return nodes.filter(function (n) {
        return n && n.hasClosure && (n.type === 'handhole' || n.type === 'fat_handhole') && inScope(n);
      }).length;
    }
    if (toolId === 'fat_pole') {
      return nodes.filter(function (n) {
        return n && n.type === 'fat_handhole' && n.hasFatPole && inScope(n);
      }).length;
    }
    return 0;
  }

  function ensureToolboxAssetCountBadge(el, toolId) {
    if (!TOOLBOX_ASSET_COUNT_TOOLS[toolId]) return;
    el.classList.add('toolbox-item--has-count');

    var legacy = el.querySelector(':scope > .toolbox-asset-count[data-tool-id="' + toolId + '"]');
    if (legacy) legacy.remove();

    var ensureControls = global.FTTHVisibilityManager?.ensureToolboxControls;
    var controls = typeof ensureControls === 'function' ? ensureControls(el) : null;
    if (!controls) {
      controls = el.querySelector(':scope > .toolbox-item-controls');
      if (!controls) {
        controls = document.createElement('div');
        controls.className = 'toolbox-item-controls';
        el.appendChild(controls);
      }
      el.classList.add('toolbox-item--has-controls');
    }

    var badge = controls.querySelector('.toolbox-asset-count[data-tool-id="' + toolId + '"]');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'toolbox-asset-count';
      badge.dataset.toolId = toolId;
      controls.appendChild(badge);
    }

    var audit = controls.querySelector('.toolbox-audit-btn');
    if (audit && badge.nextElementSibling !== audit) {
      audit.insertAdjacentElement('beforebegin', badge);
    } else if (!audit) {
      var eye = controls.querySelector('.toolbox-visibility-btn');
      if (eye && badge.nextElementSibling !== eye) controls.insertBefore(badge, eye);
    }

    var count = countPlacedAssetByToolId(toolId);
    var noun = TOOLBOX_ASSET_COUNT_TOOLS[toolId];
    badge.textContent = String(count);
    badge.dataset.count = String(count);
    badge.setAttribute('aria-label', count + ' ' + noun + ' placed on map');
  }

  function updateToolboxAssetCounts() {
    var box = document.getElementById('toolbox-items');
    if (!box) return;
    Object.keys(TOOLBOX_ASSET_COUNT_TOOLS).forEach(function (toolId) {
      box.querySelectorAll('.toolbox-item[data-type="' + toolId + '"], .toolbox-card[data-type="' + toolId + '"]').forEach(function (el) {
        ensureToolboxAssetCountBadge(el, toolId);
      });
    });
  }

  function updateMetrics() {
    var mc = document.getElementById('metric-components');
    var mconn = document.getElementById('metric-connections');
    var mlength = document.getElementById('metric-length');
    var cabId = getActiveFdtId();
    var scopedNodes = (Sim.nodes || []).filter(function (n) {
      if (!cabId) return true;
      if (n && n.type === 'fdt') return String(n.id) === String(cabId);
      if (n && n.type === 'olt') return true;
      return nodeBelongsToCabinet(n, cabId);
    });
    var scopedCables = (Sim.fiberCablePaths || []).filter(function (c) {
      return !cabId || cableBelongsToCabinet(c, cabId);
    });
    var scopedExcav = (Sim.excavationPaths || []).filter(function (p) {
      return !cabId || excavationBelongsToCabinet(p, cabId);
    });
    if (mc) mc.textContent = String(scopedNodes.length);
    if (mconn) {
      var pathCount = scopedExcav.length + scopedCables.length;
      mconn.textContent = String((Sim.connections.length || 0) + pathCount);
    }
    if (mlength) {
      var cs = Sim.layout?.cellSize || 50;
      var metersPerCell = 10;
      var px = sumPathLengthsPx();
      var meters = Math.round(px * (metersPerCell / cs));
      mlength.textContent = meters + ' m';
    }
    Sim.metrics.fdtCount = Sim.nodes.filter(function (n) { return n.type === 'fdt'; }).length;
    updateFieldStatusCounters();
    updateToolboxAssetCounts();
    syncActiveFdtChrome();
  }

  function syncPanelToggleArrows() {
    var collapsed = !!Sim.ui.toolboxCollapsed;
    var tbArrow = collapsed ? '▶' : '◀';
    var tbBtn = document.getElementById('toggle-toolbox');
    var evBtn = document.getElementById('toggle-eval');
    if (tbBtn) tbBtn.textContent = tbArrow;
    if (evBtn) evBtn.textContent = Sim.ui.evalCollapsed ? '◀' : '▶';
  }

  function applyToolboxCollapseState() {
    var toolbox = document.getElementById('toolbox');
    if (!toolbox) return;
    toolbox.classList.toggle('collapsed', !!Sim.ui.toolboxCollapsed);
    syncPanelToggleArrows();
    syncSidePanelResizeHandles();
  }

  function toggleToolboxCollapsed(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    Sim.ui.toolboxCollapsed = !Sim.ui.toolboxCollapsed;
    applyToolboxCollapseState();
    requestAnimationFrame(applyMapTransform);
  }

  function applyEvaluationPanelCollapseState() {
    var evalPanel = document.getElementById('evaluation-panel');
    var canvasMain = document.getElementById('canvas-main');
    if (!evalPanel) return;
    evalPanel.classList.toggle('collapsed', !!Sim.ui.evalCollapsed);
    if (canvasMain) canvasMain.classList.toggle('eval-is-hidden', !!Sim.ui.evalCollapsed);
    syncPanelToggleArrows();
    syncSidePanelResizeHandles();
    requestAnimationFrame(applyMapTransform);
  }

  function bindPanelToggles() {
    if (Sim.ui.panelTogglesBound) return;
    var tbBtn = document.getElementById('toggle-toolbox');
    var evBtn = document.getElementById('toggle-eval');
    var toolbox = document.getElementById('toolbox');

    if (tbBtn && toolbox) {
      tbBtn.addEventListener('click', toggleToolboxCollapsed);
    }
    if (evBtn) {
      evBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        Sim.ui.evalCollapsed = !Sim.ui.evalCollapsed;
        applyEvaluationPanelCollapseState();
      });
    }
    applyToolboxCollapseState();
    applyEvaluationPanelCollapseState();
    bindSidePanelResize();
    installWorkspaceViewportPivotObserver();
    Sim.ui.panelTogglesBound = true;
  }

  var SIDE_PANEL_LAYOUT_KEY = 'ftth-sidebar-layout';
  var TOOLBOX_WIDTH_MIN = 180;
  var TOOLBOX_WIDTH_MAX = 520;
  var TOOLBOX_WIDTH_DEFAULT = 250;
  var TOOLBOX_WIDTH_COLLAPSED = 60;
  var EVAL_WIDTH_MIN = 200;
  var EVAL_WIDTH_MAX = 520;
  var EVAL_WIDTH_DEFAULT = 256;
  var SIDE_PANEL_MIN_CANVAS = 280;
  var sidePanelResizeState = null;

  function clampSidePanelWidth(value, min, max) {
    return Math.max(min, Math.min(max, Math.round(value)));
  }

  function getEffectiveToolboxWidth() {
    if (Sim.ui.toolboxCollapsed) return TOOLBOX_WIDTH_COLLAPSED;
    return Sim.ui.toolboxWidth || TOOLBOX_WIDTH_DEFAULT;
  }

  function getEffectiveEvalWidth() {
    if (Sim.ui.evalCollapsed) return 0;
    return Sim.ui.evalPanelWidth || EVAL_WIDTH_DEFAULT;
  }

  function getSidePanelResizeLimits(resizing) {
    var layout = document.getElementById('main-layout');
    var totalW = layout ? layout.clientWidth : window.innerWidth;
    var evalW = getEffectiveEvalWidth();
    var toolboxW = getEffectiveToolboxWidth();
    if (resizing === 'toolbox') {
      toolboxW = Sim.ui.toolboxWidth || TOOLBOX_WIDTH_DEFAULT;
    } else if (resizing === 'eval') {
      evalW = Sim.ui.evalPanelWidth || EVAL_WIDTH_DEFAULT;
    }
    return {
      maxToolboxW: Math.min(TOOLBOX_WIDTH_MAX, totalW - evalW - SIDE_PANEL_MIN_CANVAS),
      maxEvalW: Math.min(EVAL_WIDTH_MAX, totalW - toolboxW - SIDE_PANEL_MIN_CANVAS),
    };
  }

  function loadSidePanelWidthsFromStorage() {
    try {
      var raw = localStorage.getItem(SIDE_PANEL_LAYOUT_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      if (data && isFinite(data.toolboxWidth)) {
        Sim.ui.toolboxWidth = clampSidePanelWidth(data.toolboxWidth, TOOLBOX_WIDTH_MIN, TOOLBOX_WIDTH_MAX);
      }
      if (data && isFinite(data.evalPanelWidth)) {
        Sim.ui.evalPanelWidth = clampSidePanelWidth(data.evalPanelWidth, EVAL_WIDTH_MIN, EVAL_WIDTH_MAX);
      }
    } catch (err) { /* ignore */ }
  }

  function persistSidePanelWidths() {
    try {
      localStorage.setItem(SIDE_PANEL_LAYOUT_KEY, JSON.stringify({
        toolboxWidth: Sim.ui.toolboxWidth || TOOLBOX_WIDTH_DEFAULT,
        evalPanelWidth: Sim.ui.evalPanelWidth || EVAL_WIDTH_DEFAULT,
      }));
    } catch (err) { /* ignore */ }
  }

  function syncSidePanelResizeHandles() {
    var tbHandle = document.getElementById('toolbox-resize-handle');
    var evHandle = document.getElementById('eval-resize-handle');
    if (tbHandle) tbHandle.hidden = !!Sim.ui.toolboxCollapsed;
    if (evHandle) evHandle.hidden = !!Sim.ui.evalCollapsed;
  }

  function applySidePanelWidths() {
    var limits = getSidePanelResizeLimits();
    Sim.ui.toolboxWidth = clampSidePanelWidth(
      Sim.ui.toolboxWidth || TOOLBOX_WIDTH_DEFAULT,
      TOOLBOX_WIDTH_MIN,
      limits.maxToolboxW
    );
    Sim.ui.evalPanelWidth = clampSidePanelWidth(
      Sim.ui.evalPanelWidth || EVAL_WIDTH_DEFAULT,
      EVAL_WIDTH_MIN,
      limits.maxEvalW
    );
    document.body.style.setProperty('--ftth-toolbox-width', Sim.ui.toolboxWidth + 'px');
    document.body.style.setProperty('--ftth-eval-panel-width', Sim.ui.evalPanelWidth + 'px');
    syncSidePanelResizeHandles();
  }

  function ensureSidePanelResizeHandle(panel, side) {
    var handleId = side === 'toolbox' ? 'toolbox-resize-handle' : 'eval-resize-handle';
    var existing = document.getElementById(handleId);
    if (existing) return existing;
    var handle = document.createElement('div');
    handle.id = handleId;
    handle.className = 'side-panel-resize-handle side-panel-resize-handle--' + side;
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', 'vertical');
    handle.setAttribute('aria-label', side === 'toolbox' ? 'Resize toolbox width' : 'Resize evaluation panel width');
    panel.appendChild(handle);
    return handle;
  }

  function onSidePanelResizeMove(e) {
    if (!sidePanelResizeState) return;
    var dx = e.clientX - sidePanelResizeState.startX;
    var limits = getSidePanelResizeLimits(sidePanelResizeState.which);
    if (sidePanelResizeState.which === 'toolbox') {
      Sim.ui.toolboxWidth = clampSidePanelWidth(
        sidePanelResizeState.startToolboxW + dx,
        TOOLBOX_WIDTH_MIN,
        limits.maxToolboxW
      );
    } else {
      Sim.ui.evalPanelWidth = clampSidePanelWidth(
        sidePanelResizeState.startEvalW - dx,
        EVAL_WIDTH_MIN,
        limits.maxEvalW
      );
    }
    applySidePanelWidths();
  }

  function onSidePanelResizeEnd() {
    if (!sidePanelResizeState) return;
    sidePanelResizeState = null;
    document.body.classList.remove('is-resizing-side-panel');
    persistSidePanelWidths();
    requestAnimationFrame(applyMapTransform);
  }

  function startSidePanelResize(which, e) {
    sidePanelResizeState = {
      which: which,
      startX: e.clientX,
      startToolboxW: Sim.ui.toolboxWidth || TOOLBOX_WIDTH_DEFAULT,
      startEvalW: Sim.ui.evalPanelWidth || EVAL_WIDTH_DEFAULT,
    };
    document.body.classList.add('is-resizing-side-panel');
    e.preventDefault();
    e.stopPropagation();
    if (e.target.setPointerCapture) e.target.setPointerCapture(e.pointerId);
  }

  function bindSidePanelResize() {
    if (Sim.ui.sidePanelResizeBound) return;
    var toolbox = document.getElementById('toolbox');
    var evalPanel = document.getElementById('evaluation-panel');
    if (!toolbox || !evalPanel) return;
    Sim.ui.sidePanelResizeBound = true;
    loadSidePanelWidthsFromStorage();
    applySidePanelWidths();
    var tbHandle = ensureSidePanelResizeHandle(toolbox, 'toolbox');
    var evHandle = ensureSidePanelResizeHandle(evalPanel, 'eval');
    tbHandle.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || Sim.ui.toolboxCollapsed) return;
      startSidePanelResize('toolbox', e);
    });
    evHandle.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || Sim.ui.evalCollapsed) return;
      startSidePanelResize('eval', e);
    });
    document.addEventListener('pointermove', onSidePanelResizeMove);
    document.addEventListener('pointerup', onSidePanelResizeEnd);
    document.addEventListener('pointercancel', onSidePanelResizeEnd);
    window.addEventListener('resize', function () {
      if (sidePanelResizeState) return;
      applySidePanelWidths();
      requestAnimationFrame(applyMapTransform);
    });
    syncSidePanelResizeHandles();
  }

  function applyLabelFontSize() {
    global.FTTHSimulatorSettings.applyLabelFontSize();
  }

  function normalizeLabelColorHex(color) {
    return global.FTTHSimulatorSettings.normalizeLabelColorHex(color);
  }

  function applyLabelColor() {
    global.FTTHSimulatorSettings.applyLabelColor();
  }

  function applyLayoutSettingsFromStorage() {
    applyLabelFontSize();
    applyLabelColor();
    loadSidePanelWidthsFromStorage();
    applySidePanelWidths();
  }

  function setMapRotation(deg) {
    var next = Number(deg);
    if (!isFinite(next)) next = 0;
    Sim.mapRotation = next;
    var display = ((next % 360) + 360) % 360;
    var rotSlider = document.getElementById('settings-map-rotation-deg');
    var rotVal = document.getElementById('settings-map-rotation-value');
    if (rotSlider) rotSlider.value = String(Math.round(display));
    if (rotVal) rotVal.textContent = Math.round(display) + '°';
    syncGisStatusBarRotation();
    applyMapTransform({ skipPanClamp: true });
  }

  function applyMapContainerTransform(container, wrap, panX, panY, z, rot, rotationEnabled) {
    if (!container) return;
    var viewport = wrap || getMapViewportWrapper();
    var px = panX || 0;
    var py = panY || 0;
    var scale = z || 1;
    var rotDeg = rotationEnabled ? (Number(rot) || 0) : 0;

    container.style.transformOrigin = '0 0';
    container.style.transform =
      'translate3d(' + px + 'px,' + py + 'px, 0) scale(' + scale + ')';

    var sheet = getTemplateSheetElement();
    if (sheet) {
      sheet.style.transformOrigin = '50% 50%';
      sheet.style.transform = Math.abs(rotDeg) > 0.001 ? ('rotate(' + rotDeg + 'deg)') : '';
    }

    if (viewport) {
      viewport.classList.toggle('map-rotation-active', rotationEnabled && Math.abs(rotDeg) > 0.001);
    }
  }

  function flushMapViewportTransform(opts) {
    opts = opts || {};
    if (!opts.skipPanClamp && !isOpenWorkspaceNavigation()) applyMapPanClamp();
    var container = getWorkspaceContainer();
    var wrap = document.getElementById('canvas-wrapper');
    var lbl = document.getElementById('zoom-label');
    var lowZoom = Sim.zoom <= 0.65;
    var z = Sim.zoom || 1;
    var panX = Sim.panX || 0;
    var panY = Sim.panY || 0;
    var rotationEnabled = !!Sim.settings.mapRotationEnabled;
    var rot = rotationEnabled ? (Sim.mapRotation || 0) : 0;
    Sim._isMapTransformFlush = true;
    try {
      document.body.classList.toggle('ftth-low-zoom-performance', lowZoom);
      if (wrap) {
        wrap.classList.toggle('ftth-low-zoom-performance', lowZoom);
      }
      if (container) container.classList.toggle('ftth-low-zoom-performance', lowZoom);
      applyMapContainerTransform(container, wrap, panX, panY, z, rot, rotationEnabled);
      if (lbl) lbl.textContent = Math.round(z * 100) + '%';
      if (container) container.style.setProperty('--ftth-map-zoom', String(z));
      if (wrap) wrap.style.setProperty('--ftth-map-zoom', String(z));
      syncGisStatusBarScale();
      syncGisStatusBarZoom();
      syncGisStatusBarRotation();
      global.FTTHDrawingEngine?.syncMapViewportLabelPresentation?.(
        Sim.mapRotation || 0,
        !!Sim.settings.mapRotationEnabled
      );
      global.FTTHDrawingEngine?.applyViewportCullingToPlacedNodes?.();
      /* LabelManager overlay only — must not rewrite FAT child top/left */
      global.FTTHLabelManager?.refresh?.();
      try {
        document.dispatchEvent(new CustomEvent('ftth-map-transform', {
          detail: { rotation: rot, zoom: z, panX: panX, panY: panY },
        }));
        if (DEBUG) {
          var zoomInner = document.getElementById('canvas-zoom-inner');
          var rigidMarker = document.querySelector('.fat-rigid-marker');
          var poleIcon = document.querySelector('.fat-pole-icon');
          console.log('--- FAT RIGID MARKER AUTO-AUDIT ---', {
            rotationDeg: rot,
            mode: 'atomic marker — runtime quarantine guard',
            pivot: 'marker transform-origin center center',
            '--map-rotation': wrap ? wrap.style.getPropertyValue('--map-rotation') : '',
            'Marker transform': rigidMarker ? getComputedStyle(rigidMarker).transform : '(n/a)',
            'Marker origin': rigidMarker ? getComputedStyle(rigidMarker).transformOrigin : '(n/a)',
            'Pole vs handhole center': (function () {
              var pole = document.querySelector('.fat-pole-icon');
              var hh = document.querySelector('.fat-handhole-base');
              if (!pole || !hh) return '(n/a)';
              var pr = pole.getBoundingClientRect();
              var hr = hh.getBoundingClientRect();
              var pcx = pr.left + pr.width / 2;
              var pcy = pr.top + pr.height / 2;
              var hcx = hr.left + hr.width / 2;
              var hcy = hr.top + hr.height / 2;
              return {
                poleCenter: { x: Math.round(pcx * 10) / 10, y: Math.round(pcy * 10) / 10 },
                handholeCenter: { x: Math.round(hcx * 10) / 10, y: Math.round(hcy * 10) / 10 },
                deltaX: Math.round((pcx - hcx) * 10) / 10,
                deltaY: Math.round((pcy - hcy) * 10) / 10,
              };
            })(),
            'Upright wrapper': (function () {
              var uw = document.querySelector('.fat-upright-wrapper');
              return uw ? getComputedStyle(uw).transform : '(n/a)';
            })(),
            'Pole icon': poleIcon ? getComputedStyle(poleIcon).transform : '(n/a)',
            'Handhole': (function () {
              var hh = document.querySelector('.fat-handhole-base');
              return hh ? getComputedStyle(hh).transform : '(n/a)';
            })(),
            'Zoom-Inner': zoomInner ? getComputedStyle(zoomInner).transform : '(n/a)',
          });
          if (typeof global.__FTTH_AUDIT_POLE_TRANSFORM__ === 'function') {
            global.__FTTH_AUDIT_POLE_TRANSFORM__();
          }
        }
      } catch (spyErr) { /* spy optional */ }
    } finally {
      Sim._isMapTransformFlush = false;
      document.querySelectorAll('.fat-rigid-marker').forEach(function (m) {
        quarantineFatRigidMarkerChildren(m);
      });
    }
  }

  var mapViewportTransformPendingOpts = null;
  function scheduleMapViewportTransform(opts) {
    opts = opts || {};
    if (!mapViewportTransformPendingOpts) {
      mapViewportTransformPendingOpts = { skipPanClamp: !!opts.skipPanClamp };
    } else {
      mapViewportTransformPendingOpts.skipPanClamp =
        !!(mapViewportTransformPendingOpts.skipPanClamp || opts.skipPanClamp);
    }
    if (mapViewportTransformRaf) return;
    mapViewportTransformRaf = requestAnimationFrame(function () {
      var pendingOpts = mapViewportTransformPendingOpts || {};
      mapViewportTransformPendingOpts = null;
      mapViewportTransformRaf = 0;
      flushMapViewportTransform(pendingOpts);
    });
  }

  var workspaceViewportPivotObserverInstalled = false;
  function installWorkspaceViewportPivotObserver() {
    if (workspaceViewportPivotObserverInstalled) return;
    var viewport = getMapViewportWrapper();
    if (!viewport || typeof ResizeObserver === 'undefined') return;
    workspaceViewportPivotObserverInstalled = true;
    var ro = new ResizeObserver(function () {
      scheduleMapViewportTransform();
    });
    ro.observe(viewport);
    var canvasMain = document.getElementById('canvas-main');
    if (canvasMain) ro.observe(canvasMain);
    var toolbox = document.getElementById('toolbox');
    if (toolbox) ro.observe(toolbox);
    var evalPanel = document.getElementById('evaluation-panel');
    if (evalPanel) ro.observe(evalPanel);
  }

  function applyMapTransform(opts) {
    opts = opts || {};
    scheduleMapViewportTransform(opts);
    if (opts.skipRedraw) return;
    applyIconZoomCompensation();
  }

  function getMapContentPixelSize() {
    var L = Sim.layout;
    if (L && L.cols && L.rows && L.cellSize) {
      return { width: L.cols * L.cellSize, height: L.rows * L.cellSize };
    }
    var sheet = getTemplateSheetElement();
    if (sheet) {
      var sw = sheet.offsetWidth || parseFloat(sheet.style.width) || 0;
      var sh = sheet.offsetHeight || parseFloat(sheet.style.height) || 0;
      if (sw > 0 && sh > 0) return { width: sw, height: sh };
    }
    return { width: 2400, height: 1700 };
  }

  function getFitZoomLevel() {
    var wrap = document.getElementById('canvas-wrapper');
    var map = getMapContentPixelSize();
    if (!wrap || !map.width || !map.height) return MAP_ZOOM_MIN;
    return Math.min(wrap.clientWidth / map.width, wrap.clientHeight / map.height);
  }

  function clampMapZoom(z) {
    return Math.max(MAP_ZOOM_MIN, Math.min(z, MAP_ZOOM_MAX));
  }

  function getViewportCenterScreenXY() {
    var frame = getMapZoomViewportFrame();
    return { x: frame.centerX, y: frame.centerY };
  }

  /** Lab-identical zoom-about-point (stage-local mx/my, transform-origin 0 0). */
  function zoomPreserveLocalPoint(oldZoom, newZoom, panX, panY, localMx, localMy) {
    var prev = oldZoom || 1;
    var next = newZoom || 1;
    if (!prev) prev = 1;
    if (!next) next = 1;
    var mx = localMx || 0;
    var my = localMy || 0;
    var px = panX || 0;
    var py = panY || 0;
    if (next === prev) {
      return { panX: px, panY: py };
    }
    return {
      panX: mx - ((mx - px) * (next / prev)),
      panY: my - ((my - py) * (next / prev)),
    };
  }

  function zoomPanAboutMouse(oldZoom, newZoom, panX, panY, mouseX, mouseY) {
    return zoomPreserveLocalPoint(oldZoom, newZoom, panX, panY, mouseX, mouseY);
  }

  function centerMapInViewport() {
    return centerMapOnLoad({ force: true });
  }

  function centerMapOnLoad(opts) {
    opts = opts || {};
    var mapWrapper = document.getElementById('canvas-wrapper');
    var mapContent = getWorkspaceContainer();
    if (!mapWrapper || !mapContent) return false;

    if (!opts.force) {
      var workspace = document.getElementById('app-shell') || document.getElementById('app-workspace');
      if (workspace && workspace.hidden) return false;
    }

    var viewportW = mapWrapper.clientWidth;
    var viewportH = mapWrapper.clientHeight;
    if (!viewportW || !viewportH) return false;

    var contentW = mapContent.scrollWidth || 0;
    var contentH = mapContent.scrollHeight || 0;
    if (!contentW || !contentH) {
      var layout = getMapContentPixelSize();
      contentW = layout.width || 0;
      contentH = layout.height || 0;
    }
    if (!contentW || !contentH) return false;

    mapWrapper.scrollLeft = 0;
    mapWrapper.scrollTop = 0;

    syncOpenWorldShell();
    var map = getMapContentPixelSize();
    var o = getTemplateSheetOrigin();
    var tcx = o.x + map.width / 2;
    var tcy = o.y + map.height / 2;
    var frame = getMapZoomViewportFrame();
    var z = Sim.zoom || 1;
    Sim.panX = frame.centerX - tcx * z;
    Sim.panY = frame.centerY - tcy * z;
    if (!isOpenWorkspaceNavigation()) applyMapPanClamp();
    applyMapTransform({ skipPanClamp: isOpenWorkspaceNavigation() });
    return true;
  }

  var mapLoadScrollCenterBound = false;
  function bindMapLoadScrollCenter() {
    if (mapLoadScrollCenterBound) return;
    mapLoadScrollCenterBound = true;
    window.addEventListener('load', function () {
      setTimeout(function () {
        if (centerMapOnLoad({ force: true })) {
          if (!Sim.ui) Sim.ui = {};
          Sim.ui.mapViewportInitialized = true;
        } else {
          scheduleInitialMapCenter({ force: true, delayMs: 0 });
        }
      }, MAP_LOAD_CENTER_DELAY_MS);
    });
  }

  function scheduleInitialMapCenter(opts) {
    opts = opts || {};
    if (!Sim.ui) Sim.ui = {};
    if (!opts.force && Sim.ui.mapViewportInitialized) return;

    var attempts = 0;
    var maxAttempts = 80;
    var delayMs = typeof opts.delayMs === 'number' ? opts.delayMs : MAP_LOAD_CENTER_DELAY_MS;

    setTimeout(function () {
      function tryCenter() {
        if (!opts.force && Sim.ui.mapViewportInitialized) return;

        if (!centerMapOnLoad()) {
          if (++attempts < maxAttempts) requestAnimationFrame(tryCenter);
          return;
        }

        Sim.ui.mapViewportInitialized = true;
      }

      requestAnimationFrame(tryCenter);
    }, delayMs);
  }

  function getMapPanClampLimits() {
    if (isOpenWorkspaceNavigation()) {
      return {
        minX: -Infinity, maxX: Infinity, minY: -Infinity, maxY: Infinity, buffer: 0,
      };
    }
    var wrap = document.getElementById('canvas-wrapper');
    var viewportW = wrap ? wrap.clientWidth : 0;
    var viewportH = wrap ? wrap.clientHeight : 0;
    if (!viewportW || !viewportH) {
      return { minX: -Infinity, maxX: Infinity, minY: -Infinity, maxY: Infinity };
    }
    var zoom = Sim.zoom || 1;
    var map = getMapContentPixelSize();
    var mapW = map.width * zoom;
    var mapH = map.height * zoom;
    var buf = PAN_CLAMP_BUFFER;
    var halfSlackX = (mapW - viewportW) / 2;
    var halfSlackY = (mapH - viewportH) / 2;
    var minLimitX = (viewportW - mapW) - buf;
    var maxLimitX = 0 + buf;
    var minLimitY = (viewportH - mapH) - buf;
    var maxLimitY = 0 + buf;
    var minX = Math.min(minLimitX, maxLimitX);
    var maxX = Math.max(minLimitX, maxLimitX);
    var minY = Math.min(minLimitY, maxLimitY);
    var maxY = Math.max(minLimitY, maxLimitY);

    /* Center-origin pan: convert edge-aligned limits to translate(panX/panY) space. */
    minX += halfSlackX;
    maxX += halfSlackX;
    minY += halfSlackY;
    maxY += halfSlackY;

    if (minX > maxX) {
      minX = maxX = 0;
    }
    if (minY > maxY) {
      minY = maxY = 0;
    }

    return { minX: minX, maxX: maxX, minY: minY, maxY: maxY, buffer: buf };
  }

  function computePanClampBounds() {
    return getMapPanClampLimits();
  }

  function clampMapPan(panX, panY) {
    var bounds = getMapPanClampLimits();
    return {
      panX: Math.min(Math.max(panX, bounds.minX), bounds.maxX),
      panY: Math.min(Math.max(panY, bounds.minY), bounds.maxY),
    };
  }

  function applyMapPanClamp() {
    if (isOpenWorkspaceNavigation()) return;
    var clamped = clampMapPan(Sim.panX || 0, Sim.panY || 0);
    Sim.panX = clamped.panX;
    Sim.panY = clamped.panY;
    if (Sim.ui?.mapGestureSession) {
      Sim.ui.mapGestureSession.panX = Sim.panX;
      Sim.ui.mapGestureSession.panY = Sim.panY;
    }
  }

  /** Screen drag → pan (translate then scale @ origin 0 0): direct manipulation / cursor lock. */
  function scalePanDragDelta(dx, dy) {
    var g = MAP_PAN_DRAG_GAIN;
    return {
      dx: (Number(dx) || 0) * g,
      dy: (Number(dy) || 0) * g,
    };
  }

  function panMapBy(dx, dy, opts) {
    opts = opts || {};
    if (isMapNavigationLocked() && !opts.force) return false;
    dx = Number(dx) || 0;
    dy = Number(dy) || 0;
    if (!dx && !dy) return false;
    Sim.panX += dx;
    Sim.panY += dy;
    if (!isOpenWorkspaceNavigation()) applyMapPanClamp();
    applyMapTransform({
      skipRedraw: !!opts.light,
      skipPanClamp: isOpenWorkspaceNavigation(),
    });
    return true;
  }

  function setZoom(val, pivotX, pivotY, clientX, clientY, opts) {
    opts = opts || {};
    if (isMapNavigationLocked() && !opts.force) return;
    var oldZoom = Sim.zoom || 1;
    var newZoom = clampMapZoom(Math.round(val * 1000) / 1000);
    if (Math.abs(newZoom - oldZoom) < 1e-6) return;

    var mouseX;
    var mouseY;
    var hasCursorPivot = false;
    if (pivotX != null && pivotY != null) {
      mouseX = pivotX;
      mouseY = pivotY;
      hasCursorPivot = true;
    } else if (clientX != null && clientY != null) {
      var localPt = clientPointToMapZoomLocal(clientX, clientY);
      mouseX = localPt.x;
      mouseY = localPt.y;
      hasCursorPivot = true;
    } else {
      var center = getViewportCenterScreenXY();
      mouseX = center.x;
      mouseY = center.y;
    }

    var adj = zoomPreserveLocalPoint(
      oldZoom,
      newZoom,
      Sim.panX || 0,
      Sim.panY || 0,
      mouseX,
      mouseY
    );
    Sim.panX = adj.panX;
    Sim.panY = adj.panY;
    Sim.zoom = newZoom;
    var skipClamp = hasCursorPivot || isOpenWorkspaceNavigation();
    if (!skipClamp) applyMapPanClamp();
    applyMapTransform({ skipRedraw: !!opts.light, skipPanClamp: skipClamp });
    if (!opts.light) applyIconZoomCompensation();
  }

  function onToolSelectClick() {
    var mode = getCurrentMode();
    if (mode === WORKSPACE_MODES.CUT || mode === WORKSPACE_MODES.VERTEX) {
      Sim.interactionMode = 'select';
      Sim.currentTool = 'select';
      applyInteractionModeClasses();
      syncDrawingLayerInteraction();
      global.FTTHDrawingEngine?.syncMapInteractionCursor?.();
      return;
    }
    enableSelectMode();
  }

  function onToolHandClick() {
    enablePanMode();
  }

  var mapGesturePointerMap = null;

  function ensureMapGesturePointerMap() {
    if (!mapGesturePointerMap) mapGesturePointerMap = new Map();
    return mapGesturePointerMap;
  }

  function getMapGesturePointerCount() {
    return mapGesturePointerMap ? mapGesturePointerMap.size : 0;
  }

  function isMapGesturePanActive() {
    return !!(Sim.ui && (Sim.ui.mapGesturePanActive || getMapGesturePointerCount() >= 2));
  }

  function isTemporaryPanOverrideActive() {
    if (!Sim.ui) return false;
    return !!(Sim.ui.spacePanActive || Sim.ui.middleMousePanActive || Sim.ui.mapGesturePanActive);
  }

  function syncTemporaryPanCursor() {
    global.FTTHDrawingEngine?.syncMapInteractionCursor?.();
  }

  function mapGesturePairMetrics() {
    if (!mapGesturePointerMap || mapGesturePointerMap.size < 2) return null;
    var pts = [];
    mapGesturePointerMap.forEach(function (p) { pts.push(p); });
    if (pts.length < 2) return null;
    var p0 = pts[0];
    var p1 = pts[1];
    return {
      cx: (p0.clientX + p1.clientX) / 2,
      cy: (p0.clientY + p1.clientY) / 2,
    };
  }

  function endMapGesturePan() {
    if (!Sim.ui) return;
    Sim.ui.mapGesturePanActive = false;
    Sim.ui.mapGestureSession = null;
    var wrap = document.getElementById('canvas-wrapper');
    if (wrap) wrap.classList.remove('is-map-gesture-nav');
    syncTemporaryPanCursor();
    requestAnimationFrame(function () {
      global.FTTHLabelManager?.flushDeferredRefresh?.();
    });
  }

  function onMapGesturePointerDown(e) {
    if (!e.target?.closest?.('#canvas-wrapper')) return;
    if (e.target.closest('#toolbox') || e.target.closest('.grid-controls') ||
        e.target.closest('.map-tool-bar')) {
      return;
    }
    var map = ensureMapGesturePointerMap();
    map.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY, pointerId: e.pointerId });
    if (map.size >= 2) {
      if (!Sim.ui.mapGesturePanActive) {
        Sim.ui.mapGesturePanActive = true;
        var metrics = mapGesturePairMetrics();
        Sim.ui.mapGestureSession = metrics ? {
          lastCx: metrics.cx,
          lastCy: metrics.cy,
          panX: Sim.panX || 0,
          panY: Sim.panY || 0,
        } : null;
        var wrap = document.getElementById('canvas-wrapper');
        if (wrap) wrap.classList.add('is-map-gesture-nav');
        syncTemporaryPanCursor();
      }
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    }
  }

  function onMapGesturePointerMove(e) {
    if (!Sim.ui?.mapGesturePanActive || getMapGesturePointerCount() < 2) return;
    var map = ensureMapGesturePointerMap();
    if (map.has(e.pointerId)) {
      map.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY, pointerId: e.pointerId });
    }
    var metrics = mapGesturePairMetrics();
    var session = Sim.ui.mapGestureSession;
    if (!metrics || !session) return;
    var dx = metrics.cx - session.lastCx;
    var dy = metrics.cy - session.lastCy;
    if (dx || dy) {
      session.lastCx = metrics.cx;
      session.lastCy = metrics.cy;
      var panDelta = scalePanDragDelta(dx, dy);
      var nextX = session.panX + panDelta.dx;
      var nextY = session.panY + panDelta.dy;
      var clamped = clampMapPan(nextX, nextY);
      session.panX = clamped.panX;
      session.panY = clamped.panY;
      Sim.panX = clamped.panX;
      Sim.panY = clamped.panY;
      applyMapTransform({ skipRedraw: true });
    }
    e.preventDefault();
    e.stopPropagation();
  }

  function onMapGesturePointerUp(e) {
    var map = ensureMapGesturePointerMap();
    map.delete(e.pointerId);
    if (map.size < 2) endMapGesturePan();
  }

  function shouldIgnoreSpacePanKeyTarget(e) {
    var t = e?.target;
    if (!t) return true;
    if (t.isContentEditable) return true;
    var tag = String(t.tagName || '').toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  function cancelSpacePanOverride() {
    if (!Sim.ui?.spacePanActive) return;
    Sim.ui.spacePanActive = false;
    if (Sim.isPanning) {
      Sim.isPanning = false;
      Sim.panSession = null;
      var wrap = document.getElementById('canvas-wrapper');
      if (wrap) wrap.classList.remove('is-panning', 'is-temporary-pan');
    }
    syncTemporaryPanCursor();
  }

  function onSpacePanKeyDown(e) {
    if (e.code !== 'Space' && e.key !== ' ') return;
    if (shouldIgnoreSpacePanKeyTarget(e)) return;
    if (Sim.ui?.spacePanActive) {
      e.preventDefault();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    Sim.ui.spacePanActive = true;
    syncTemporaryPanCursor();
  }

  function onSpacePanKeyUp(e) {
    if (e.code !== 'Space' && e.key !== ' ') return;
    if (!Sim.ui?.spacePanActive) return;
    e.preventDefault();
    e.stopPropagation();
    cancelSpacePanOverride();
  }

  function onSpacePanWindowBlur() {
    cancelSpacePanOverride();
    if (Sim.ui?.middleMousePanActive) Sim.ui.middleMousePanActive = false;
    endMapGesturePan();
    if (mapGesturePointerMap) mapGesturePointerMap.clear();
  }

  function onCanvasWrapPointerLeave(e) {
    if (getActiveCanvasTool() === 'cut') resetMapPointerState();
    if (Sim.isPanning) onPanEnd(e || {});
  }

  function onDocumentPointerCancel() {
    resetMapPointerState();
  }

  function applyInteractionModeClasses() {
    var wrapper = document.getElementById('canvas-wrapper');
    var grid = document.getElementById('city-grid');
    var container = document.getElementById('simulator-container');
    var toolSelect = document.getElementById('tool-select');
    var toolHand = document.getElementById('tool-hand');
    var isHand = Sim.interactionMode === 'hand';
    if (wrapper) {
      wrapper.classList.toggle('map-mode-hand', isHand);
      wrapper.classList.toggle('map-mode-select', !isHand);
    }
    if (grid) grid.classList.toggle('map-mode-hand-active', isHand);
    if (container) {
      container.classList.toggle('ftth-tool-hand', isHand);
      container.classList.toggle('ftth-tool-select', !isHand);
    }
    if (toolSelect) {
      toolSelect.setAttribute('aria-pressed', !isHand ? 'true' : 'false');
    }
    if (toolHand) {
      toolHand.setAttribute('aria-pressed', isHand ? 'true' : 'false');
    }
    var editToolActive = getCurrentMode() === WORKSPACE_MODES.CUT ||
      getCurrentMode() === WORKSPACE_MODES.VERTEX;
    if (!editToolActive) {
      if (isHand && toolHand) selectTool(toolHand);
      else if (toolSelect) selectTool(toolSelect);
    }
    syncGisToolbarActiveStates();
    syncSmartStatusBarTools();
  }

  function setInteractionMode(mode) {
    if (mode === 'hand') {
      enablePanMode();
      return;
    }
    var editMode = getCurrentMode() === WORKSPACE_MODES.CUT || getCurrentMode() === WORKSPACE_MODES.VERTEX;
    if (editMode) {
      if (Sim.interactionMode === 'select' && Sim.currentTool === 'select') {
        applyInteractionModeClasses();
        syncDrawingLayerInteraction();
        return;
      }
      Sim.interactionMode = 'select';
      Sim.currentTool = 'select';
      applyInteractionModeClasses();
      syncDrawingLayerInteraction();
      global.FTTHDrawingEngine?.syncMapInteractionCursor?.();
      return;
    }
    enableSelectMode();
  }

  function getMapContainerElement() {
    return document.getElementById('map-container') ||
      document.getElementById('canvas-wrapper');
  }

  function isMapBackgroundPanTarget(target) {
    if (!target || typeof target.closest !== 'function') return false;
    var mapEl = getMapContainerElement();
    if (!mapEl || !mapEl.contains(target)) return false;
    if (target.closest('#toolbox, .toolbox, .toolbox-item, #evaluation-panel')) return false;
    if (target.closest('.grid-controls, #sim-settings-panel, .map-tool-bar, .pathway-bottom-panel, #pathway-corner-radius')) return false;
    if (target.closest('button, select, input, textarea, label, a, .panel-toggle')) return false;
    if (target.closest('.placed-node, .vertex-handle, .sim-node-actions, .field-node-label')) return false;
    if (canPenDraw() || isCablePenDrawActive()) return false;
    if (Sim.pathEdit?.isDraggingVertex || Sim.pathEdit?.drag) return false;
    var mode = getCurrentMode();
    if (mode === WORKSPACE_MODES.CUT || mode === WORKSPACE_MODES.VERTEX || mode === WORKSPACE_MODES.MEASURE) return false;
    if ((mode === WORKSPACE_MODES.SELECT || mode === WORKSPACE_MODES.PAN) &&
        target.closest('path.draw-path-hit, .draw-path-hit')) return false;
    return true;
  }

  function onPanStart(e) {
    if (Sim.pathEdit?.isDraggingVertex || Sim.pathEdit?.drag) return;
    if (e.target.closest('.grid-controls') || e.target.closest('.map-tool-bar') ||
        e.target.closest('.pathway-bottom-panel') || e.target.closest('#pathway-corner-radius') ||
        e.target.closest('button') || e.target.closest('select')) return;

    var isHandPan = getCurrentMode() === WORKSPACE_MODES.PAN && e.button === 0 &&
      isMapBackgroundPanTarget(e.target);
    var isMiddlePan = e.button === 1;
    var isSpacePan = e.button === 0 && !!Sim.ui?.spacePanActive;
    var isMapBackgroundPan = e.button === 0 && isMapBackgroundPanTarget(e.target);

    if (!isHandPan && !isMiddlePan && !isSpacePan && !isMapBackgroundPan) return;

    if (isMiddlePan) {
      e.preventDefault();
      Sim.ui.middleMousePanActive = true;
    }

    e.preventDefault();
    Sim.isPanning = true;
    Sim.panSession = {
      x: e.clientX,
      y: e.clientY,
      panX: Sim.panX,
      panY: Sim.panY,
      panButton: e.button,
      temporary: !!(isMiddlePan || isSpacePan),
      backgroundPan: !!isMapBackgroundPan && !isHandPan,
    };
    var wrap = getMapContainerElement();
    if (wrap) {
      wrap.classList.add('is-panning');
      if (isMiddlePan || isSpacePan) wrap.classList.add('is-temporary-pan');
    }
    syncTemporaryPanCursor();
  }

  function onPanMove(e) {
    if (!Sim.isPanning || !Sim.panSession) return;
    if (Sim.pathEdit?.isDraggingVertex || Sim.pathEdit?.drag) return;
    var dx = e.clientX - Sim.panSession.x;
    var dy = e.clientY - Sim.panSession.y;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
      Sim.panSession.moved = true;
      if (Sim.ui) Sim.ui.handPathPick = null;
    }
    var panDelta = scalePanDragDelta(dx, dy);
    var nextX = Sim.panSession.panX + panDelta.dx;
    var nextY = Sim.panSession.panY + panDelta.dy;
    var clamped = clampMapPan(nextX, nextY);
    Sim.panX = clamped.panX;
    Sim.panY = clamped.panY;
    Sim.panSession.panX = clamped.panX;
    Sim.panSession.panY = clamped.panY;
    Sim.panSession.x = e.clientX;
    Sim.panSession.y = e.clientY;
    var temporaryPan = !!Sim.panSession.temporary;
    applyMapTransform({
      skipRedraw: temporaryPan,
      skipPanClamp: temporaryPan && isOpenWorkspaceNavigation(),
    });
  }

  function tryHandModeMapSelect(e) {
    if (Sim.interactionMode !== 'hand' || canPenDraw()) return false;
    var stored = Sim.ui?.handPathPick;
    if (Sim.ui) Sim.ui.handPathPick = null;
    var clientX = e?.clientX;
    var clientY = e?.clientY;
    if (clientX == null || clientY == null) {
      if (!stored) return false;
      clientX = stored.x;
      clientY = stored.y;
    }
    var pick = resolveMapPick(clientX, clientY);
    if (!pick) return false;
    return applyMapPick(pick, e);
  }

  function tryHandModePathSelect(e) {
    return tryHandModeMapSelect(e);
  }

  function onMapContainerClick(e) {
    if (Sim.suppressMapClick) {
      Sim.suppressMapClick = false;
      return;
    }
    if (e.target.closest('.placed-node, .grid-controls, .map-tool-bar, #sim-settings-panel, button, select, input, textarea, label, a')) {
      return;
    }
    trySelectMapNodeAtPointer(e);
  }

  function onPanEnd(e) {
    if (!Sim.isPanning) return;
    var session = Sim.panSession;
    var wasTemporary = !!(session && session.temporary);
    if (session && !session.temporary && !session.moved && tryHandModePathSelect(e)) {
      Sim.isPanning = false;
      Sim.panSession = null;
      var wrapPick = document.getElementById('canvas-wrapper');
      if (wrapPick) wrapPick.classList.remove('is-panning', 'is-temporary-pan');
      requestAnimationFrame(positionNodeActionHud);
      syncTemporaryPanCursor();
      return;
    }
    if (session && !session.moved && !session.temporary && trySelectMapNodeAtPointer(e)) {
      Sim.isPanning = false;
      Sim.panSession = null;
      var wrapNodePick = document.getElementById('canvas-wrapper');
      if (wrapNodePick) wrapNodePick.classList.remove('is-panning', 'is-temporary-pan');
      requestAnimationFrame(positionNodeActionHud);
      syncTemporaryPanCursor();
      return;
    }
    if (session && session.moved) Sim.suppressMapClick = true;
    if (Sim.ui) Sim.ui.handPathPick = null;
    Sim.isPanning = false;
    Sim.panSession = null;
    if (wasTemporary && Sim.ui && session.panButton === 1) Sim.ui.middleMousePanActive = false;
    var wrap = document.getElementById('canvas-wrapper');
    if (wrap) wrap.classList.remove('is-panning', 'is-temporary-pan');
    requestAnimationFrame(function () {
      global.FTTHLabelManager?.flushDeferredRefresh?.();
      positionNodeActionHud();
    });
    syncTemporaryPanCursor();
  }

  function beginMapWheelZoomBurst() {
    if (!Sim.ui) Sim.ui = {};
    var wrap = getMapViewportWrapper();
    if (!wrap) return;
    wrap.classList.add('is-wheel-zooming');
    clearTimeout(Sim.ui.wheelZoomTimer);
    Sim.ui.wheelZoomTimer = setTimeout(function () {
      wrap.classList.remove('is-wheel-zooming');
      applyIconZoomCompensation();
      if (hasActiveDrawingStroke() || canPenDraw()) {
        global.FTTHDrawingEngine?.flushPenDrawingVisuals?.();
      }
    }, MAP_WHEEL_BURST_IDLE_MS);
  }

  function stepMapZoomAtPivot(localMx, localMy, direction) {
    if (isMapNavigationLocked()) return;
    var dir = direction > 0 ? 1 : direction < 0 ? -1 : 0;
    if (!dir) return;
    var oldZ = Sim.zoom || 1;
    var newZ = clampMapZoom(Math.round((oldZ + dir * MAP_ZOOM_STEP) * 1000) / 1000);
    if (Math.abs(newZ - oldZ) < 1e-6) return;
    var adj = zoomPreserveLocalPoint(oldZ, newZ, Sim.panX || 0, Sim.panY || 0, localMx, localMy);
    Sim.zoom = newZ;
    Sim.panX = adj.panX;
    Sim.panY = adj.panY;
    beginMapWheelZoomBurst();
    applyMapTransform({ skipRedraw: true, skipPanClamp: true });
    if (hasActiveDrawingStroke() || canPenDraw()) {
      global.FTTHDrawingEngine?.flushPenCursorVisuals?.();
    }
  }

  /** Pivot for +/- buttons: last in-map pointer, else viewport center. */
  function getButtonZoomPivotLocal() {
    var frame = getMapZoomViewportFrame();
    var client = Sim.ui && Sim.ui.lastCanvasClient;
    if (client && isFinite(client.clientX) && isFinite(client.clientY)) {
      var local = clientPointToMapZoomLocal(client.clientX, client.clientY);
      if (local.x >= 0 && local.y >= 0 && local.x <= frame.width && local.y <= frame.height) {
        return local;
      }
    }
    return { x: frame.centerX, y: frame.centerY };
  }

  function bindWheelZoom() {
    var wrap = document.getElementById('canvas-wrapper');
    if (!wrap || Sim.ui.wheelZoomBound) return;
    wrap.addEventListener('wheel', function (e) {
      /* Vertex tool blocks wheel; active cable/trench pen drawing must still zoom. */
      if (canVertexEdit() && !(canPenDraw() && Sim.penDraft?.points?.length)) return;
      if (e.target.closest('#toolbox') || e.target.closest('#property-panel') ||
          e.target.closest('.grid-controls') ||
          e.target.closest('#sim-settings-panel')) {
        return;
      }
      if (Sim.settings.mapRotationEnabled && e.shiftKey) {
        e.preventDefault();
        var rotDelta = e.deltaY > 0 ? -2 : 2;
        setMapRotation((Sim.mapRotation || 0) + rotDelta);
        return;
      }
      e.preventDefault();
      var dir = e.deltaY > 0 ? -1 : 1;
      var pivot = clientPointToMapZoomLocal(e.clientX, e.clientY);
      stepMapZoomAtPivot(pivot.x, pivot.y, dir);
    }, { passive: false });
    Sim.ui.wheelZoomBound = true;
  }

  function reRenderWorkspace() {
    renderAllNodes();
    renderConnections();
    syncAllCablePathsToTrenches();
    renderGlobalDrawingLayer();
    applyMapTransform();
    renderUnifiedSidebar();
    updateMetrics();
    applyIconZoomCompensation();
  }

  function bindActionToolbarSelection() {
    var toolbar = document.getElementById('action-toolbar');
    if (!toolbar || toolbar.dataset.toolSelectBound === '1') return;
    toolbar.dataset.toolSelectBound = '1';
    toolbar.addEventListener('click', function (e) {
      var btn = e.target.closest('.map-tool-btn');
      if (!btn || btn.disabled) return;
      if (btn.id === 'btn-undo' || btn.id === 'btn-redo') return;
      if (btn.id === 'btn-fullscreen') return;
      if (btn.id === 'btn-zoom-in' || btn.id === 'btn-zoom-out') return;
      if (btn.id === 'btn-toolbar-copy' || btn.id === 'btn-toolbar-paste') return;
      if (btn.id === 'btn-toolbar-delete' || btn.id === 'btn-toolbar-cut' ||
          btn.id === 'btn-toolbar-vertex' || btn.id === 'btn-toolbar-measure' ||
          btn.id === 'btn-toolbar-move-node') return;
      if (btn.id === 'btn-refresh-workspace' || btn.id === 'btn-sim-settings') return;
      if (btn.id === 'btn-toolbar-splicing' || btn.id === 'btn-toolbar-fiber-matrix') return;
      selectTool(btn);
    });
  }

  function bindHistoryControls() {
    var undoBtn = document.getElementById('btn-undo');
    var redoBtn = document.getElementById('btn-redo');
    var refreshBtn = document.getElementById('btn-refresh-workspace');
    if (undoBtn) undoBtn.addEventListener('click', function () { undo(); });
    if (redoBtn) redoBtn.addEventListener('click', function () { redo(); });
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function () {
        reRenderWorkspace();
      });
    }
    bindActionToolbarSelection();
    bindGisToolbarControls();
    bindFiberDesignToolbarControls();
  }

  function bindFiberDesignToolbarControls() {
    if (Sim.ui.fiberDesignToolbarBound) return;
    Sim.ui.fiberDesignToolbarBound = true;
    var spliceBtn = document.getElementById('btn-toolbar-splicing');
    var matrixBtn = document.getElementById('btn-toolbar-fiber-matrix');
    if (spliceBtn) {
      spliceBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        tryOpenSplicingActionUI();
      });
    }
    if (matrixBtn) {
      matrixBtn.addEventListener('click', function (e) {
        if (DEBUG) {
          console.log('[Matrix Button] CLICKED');
        }
        e.preventDefault();
        e.stopPropagation();
        if (DEBUG) {
          console.log('[Matrix Button] global.FTTHFiberDesignUI =', !!global.FTTHFiberDesignUI);
          console.log('[Matrix Button] global.FTTHFiberDesignUI.openMatrix =', !!(global.FTTHFiberDesignUI && global.FTTHFiberDesignUI.openMatrix));
          console.log('[Matrix Button] global.FTTHFiberDesignMatrixModal =', !!global.FTTHFiberDesignMatrixModal);
          console.log('[Matrix Button] global.FTTHFiberDesignMatrixModal.open =', !!(global.FTTHFiberDesignMatrixModal && global.FTTHFiberDesignMatrixModal.open));
        }
        if (global.FTTHFiberDesignUI && global.FTTHFiberDesignUI.openMatrix) {
          if (DEBUG) {
            console.log('[Matrix Button] Calling global.FTTHFiberDesignUI.openMatrix()');
          }
          global.FTTHFiberDesignUI.openMatrix();
        } else if (global.FTTHFiberDesignMatrixModal && global.FTTHFiberDesignMatrixModal.open) {
          if (DEBUG) {
            console.log('[Matrix Button] Calling global.FTTHFiberDesignMatrixModal.open()');
          }
          global.FTTHFiberDesignMatrixModal.open();
        } else {
          console.error('[Matrix Button] ERROR: No Matrix open function available!');
        }
      });
    } else {
      console.error('[Matrix Button] ERROR: matrixBtn element not found!');
    }
  }

  function bindSimulatorGlobalEvents() {
    if (window.__FTTH_SIM_GLOBAL_EVENTS__) return;
    window.__FTTH_SIM_GLOBAL_EVENTS__ = true;

    ensureSimulatorContainerFocusable();
    bindGlobalKeyboardShortcuts();

    var container = getFullscreenContainer();
    var wrap = document.getElementById('canvas-wrapper');
    if (container) {
      container.addEventListener('mousedown', focusSimulatorContainer, true);
      container.addEventListener('pointerdown', focusSimulatorContainer, true);
      container.addEventListener('keydown', focusSimulatorContainer, true);
    }
    if (wrap) {
      wrap.addEventListener('pointerdown', focusSimulatorContainer, true);
      wrap.addEventListener('keydown', focusSimulatorContainer, true);
    }
    Sim.ui.globalKeyboardBound = true;
  }

  function teardownPanToolEvents() {
    var wrap = getMapContainerElement();
    var toolSelect = document.getElementById('tool-select');
    var toolHand = document.getElementById('tool-hand');
    if (toolSelect) toolSelect.removeEventListener('click', onToolSelectClick);
    if (toolHand) toolHand.removeEventListener('click', onToolHandClick);
    if (wrap) {
      wrap.removeEventListener('pointerdown', onPanStart);
      wrap.removeEventListener('pointerleave', onCanvasWrapPointerLeave);
      wrap.removeEventListener('mouseleave', onCanvasWrapPointerLeave);
      wrap.removeEventListener('click', onMapContainerClick);
      wrap.removeEventListener('pointerdown', onMapGesturePointerDown, true);
    }
    document.removeEventListener('pointermove', onPanMove);
    document.removeEventListener('pointermove', onMapGesturePointerMove, true);
    document.removeEventListener('pointerup', onPanEnd, true);
    document.removeEventListener('pointerup', onMapGesturePointerUp, true);
    document.removeEventListener('pointercancel', onDocumentPointerCancel, true);
    document.removeEventListener('pointercancel', onMapGesturePointerUp, true);
    document.removeEventListener('keydown', onSpacePanKeyDown, true);
    document.removeEventListener('keyup', onSpacePanKeyUp, true);
    window.removeEventListener('blur', onSpacePanWindowBlur, true);
    Sim.ui.panToolEventsBound = false;
  }

  function bindPanAndToolEvents() {
    if (Sim.ui.panToolEventsBound) return;
    bindSimulatorGlobalEvents();
    var wrap = getMapContainerElement();
    var toolSelect = document.getElementById('tool-select');
    var toolHand = document.getElementById('tool-hand');
    if (toolSelect) toolSelect.addEventListener('click', onToolSelectClick);
    if (toolHand) toolHand.addEventListener('click', onToolHandClick);
    if (wrap) {
      wrap.addEventListener('pointerdown', onMapGesturePointerDown, true);
      wrap.addEventListener('pointerdown', onPanStart);
      wrap.addEventListener('pointerleave', onCanvasWrapPointerLeave);
      wrap.addEventListener('mouseleave', onCanvasWrapPointerLeave);
      wrap.addEventListener('click', onMapContainerClick);
    }
    document.addEventListener('pointermove', onPanMove);
    document.addEventListener('pointermove', onMapGesturePointerMove, true);
    document.addEventListener('pointerup', onPanEnd, true);
    document.addEventListener('pointerup', onMapGesturePointerUp, true);
    document.addEventListener('pointercancel', onDocumentPointerCancel, true);
    document.addEventListener('pointercancel', onMapGesturePointerUp, true);
    document.addEventListener('keydown', onSpacePanKeyDown, true);
    document.addEventListener('keyup', onSpacePanKeyUp, true);
    window.addEventListener('blur', onSpacePanWindowBlur, true);
    bindWheelZoom();
    Sim.ui.panToolEventsBound = true;
    applyCurrentModeEffects(getCurrentMode());
  }

  function bindSettingsPanel() {
    if (Sim.ui.settingsBound) return;
    var btn = document.getElementById('btn-sim-settings');
    var anchor = document.getElementById('sim-settings-anchor');
    var actionBar = document.getElementById('main-action-bar');
    var panel = document.getElementById('sim-settings-panel');
    var backdrop = document.getElementById('sim-settings-backdrop');
    var labelSlider = document.getElementById('settings-label-size');
    var labelColor = document.getElementById('settings-label-color');
    var saveSettingsBtn = document.getElementById('settings-save');
    var rotToggle = document.getElementById('settings-map-rotation');
    var rotControls = document.getElementById('settings-rotation-controls');
    var rotSlider = document.getElementById('settings-map-rotation-deg');
    var rotLeft = document.getElementById('settings-rotate-left');
    var rotRight = document.getElementById('settings-rotate-right');
    var closeBtn = document.getElementById('btn-sim-settings-close');
    var settingsDropdownListenersBound = false;

    function positionSettingsDropdown() {
      if (!panel || !btn || !panel.classList.contains('sim-settings-panel--open')) return;
      var rect = btn.getBoundingClientRect();
      var gap = 4;
      var margin = 8;
      var panelW = panel.offsetWidth || 220;
      var panelH = panel.offsetHeight || 320;
      var top = rect.bottom + gap;
      var left = rect.left;
      if (top + panelH > window.innerHeight - margin) {
        top = Math.max(margin, rect.top - panelH - gap);
      }
      if (left + panelW > window.innerWidth - margin) {
        left = window.innerWidth - panelW - margin;
      }
      left = Math.max(margin, left);
      panel.style.top = top + 'px';
      panel.style.left = left + 'px';
      panel.style.right = 'auto';
    }

    function bindSettingsDropdownListeners() {
      if (settingsDropdownListenersBound) return;
      settingsDropdownListenersBound = true;
      window.addEventListener('resize', positionSettingsDropdown);
      window.addEventListener('scroll', positionSettingsDropdown, true);
    }

    function unbindSettingsDropdownListeners() {
      if (!settingsDropdownListenersBound) return;
      settingsDropdownListenersBound = false;
      window.removeEventListener('resize', positionSettingsDropdown);
      window.removeEventListener('scroll', positionSettingsDropdown, true);
    }

    function setSettingsPanelOpen(open) {
      if (!panel || !btn) return;
      panel.classList.toggle('sim-settings-panel--open', open);
      panel.setAttribute('aria-hidden', open ? 'false' : 'true');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (anchor) anchor.classList.toggle('sim-settings-anchor--open', open);
      if (actionBar) actionBar.classList.toggle('sim-settings-open', open);
      if (backdrop) {
        backdrop.classList.toggle('sim-settings-backdrop--open', open);
        backdrop.setAttribute('aria-hidden', open ? 'false' : 'true');
      }
      if (open) {
        bindSettingsDropdownListeners();
        requestAnimationFrame(function () {
          positionSettingsDropdown();
        });
      } else {
        unbindSettingsDropdownListeners();
      }
    }

    function syncRotationControlsVisibility() {
      if (!rotControls || !rotToggle) return;
      rotControls.classList.toggle('hidden', !rotToggle.checked);
      rotControls.setAttribute('aria-hidden', rotToggle.checked ? 'false' : 'true');
    }

    if (btn && panel) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        selectTool(btn);
        setSettingsPanelOpen(!panel.classList.contains('sim-settings-panel--open'));
      });
      if (closeBtn) closeBtn.addEventListener('click', function () { setSettingsPanelOpen(false); });
      if (backdrop) {
        backdrop.addEventListener('click', function () { setSettingsPanelOpen(false); });
      }
      document.addEventListener('click', function (e) {
        if (!panel.classList.contains('sim-settings-panel--open')) return;
        if (e.target.closest('#sim-settings-panel') || e.target.closest('#btn-sim-settings')) return;
        if (e.target.closest('#sim-settings-backdrop')) return;
        setSettingsPanelOpen(false);
      });
    }

    if (labelSlider) {
      labelSlider.value = String(Sim.settings.labelFontSize || 11);
      function onLabelSizeChange() {
        Sim.settings.labelFontSize = parseInt(labelSlider.value, 10) || 11;
        applyLabelFontSize();
      }
      labelSlider.addEventListener('input', onLabelSizeChange);
      labelSlider.addEventListener('change', onLabelSizeChange);
    }

    if (labelColor) {
      labelColor.value = normalizeLabelColorHex(Sim.settings.labelColor || '#ffffff');
      function onLabelColorChange() {
        Sim.settings.labelColor = normalizeLabelColorHex(labelColor.value);
        applyLabelColor();
      }
      labelColor.addEventListener('input', onLabelColorChange);
      labelColor.addEventListener('change', onLabelColorChange);
    }

    if (saveSettingsBtn) {
      saveSettingsBtn.addEventListener('click', function () {
        saveSettings();
      });
    }

    if (rotToggle) {
      rotToggle.checked = !!Sim.settings.mapRotationEnabled;
      rotToggle.addEventListener('change', function () {
        Sim.settings.mapRotationEnabled = rotToggle.checked;
        syncRotationControlsVisibility();
        applyMapTransform();
      });
    }

    if (rotSlider) {
      rotSlider.addEventListener('input', function () {
        applyStatusBarRotation(parseInt(rotSlider.value, 10) || 0);
      });
    }

    if (rotLeft) {
      rotLeft.addEventListener('click', function () {
        ensureMapRotationEnabled();
        setMapRotation((Number(Sim.mapRotation) || 0) - 15);
      });
    }

    if (rotRight) {
      rotRight.addEventListener('click', function () {
        ensureMapRotationEnabled();
        setMapRotation((Number(Sim.mapRotation) || 0) + 15);
      });
    }

    syncRotationControlsVisibility();
    applyLayoutSettingsFromStorage();
    Sim.ui.settingsBound = true;
  }

  function bindControls() {
    bindPanelToggles();
    bindToolboxDeselectOnDblClick();
    bindSmartStatusBar();
    bindPanAndToolEvents();
    bindSettingsPanel();
    bindPenDrawingEvents();
    bindWorkspaceModeEvents();

    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-sidebar-action]')) return;
      if (e.target.closest('#property-panel') || e.target.closest('#evaluation-panel')) return;
      if (e.target.closest('.placed-node')) return;
      if (e.target.closest('#city-canvas') || e.target.closest('#global-drawing-layer') ||
          e.target.closest('#canvas-wrapper')) return;
      if (!Sim.moveNodeId) {
        clearNodeSelection();
        clearSelectedPath();
      }
    });

    var sel = document.getElementById('layout-select');
    if (sel) {
      sel.addEventListener('change', function () {
        Sim.activeCityId = sel.value;
      Sim.nodes = [];
      Sim.connections = [];
      Sim.excavationPaths = [];
      Sim.excavationPathId = 0;
      Sim.fiberCablePaths = [];
      Sim.fiberCablePathId = 0;
      Sim.penDraft = null;
      Sim.selectedPath = null;
      resetNameCounters();
      clearNodeSelection();
      renderVirtualCity();
      resetMapHistory();
      });
    }

    bindFullscreenButton();

    var zi = document.getElementById('btn-zoom-in');
    var zo = document.getElementById('btn-zoom-out');
    /* Same multiplicative notch + animation pipeline as mouse-wheel (deltaMode===1). */
    if (zi) zi.addEventListener('click', function () {
      var pivot = getButtonZoomPivotLocal();
      stepMapZoomAtPivot(pivot.x, pivot.y, 1);
    });
    if (zo) zo.addEventListener('click', function () {
      var pivot = getButtonZoomPivotLocal();
      stepMapZoomAtPivot(pivot.x, pivot.y, -1);
    });

    var clr = document.getElementById('btn-clear');
    if (clr) clr.addEventListener('click', function () {
      clearWorkspace();
    });

    syncFullscreenButtonUi();
    window.addEventListener('resize', function () {
      if (!isOpenWorkspaceNavigation()) applyMapPanClamp();
      scheduleMapViewportTransform({ skipPanClamp: isOpenWorkspaceNavigation() });
      requestAnimationFrame(positionNodeActionHud);
    });
  }

  function clearWorkspace() {
    if (global.FTTHImageMapProject?.onWorkspaceCleared) {
      global.FTTHImageMapProject.onWorkspaceCleared();
    }
    Sim.nodes = [];
    Sim.connections = [];
    Sim.excavationPaths = [];
    Sim.excavationPathId = 0;
    Sim.fiberCablePaths = [];
    Sim.fiberCablePathId = 0;
    Sim.penDraft = null;
    Sim.selectedPath = null;
    Sim.cableDraftFrom = null;
    resetNameCounters();
    clearNodeSelection();
    if (Sim.ui) Sim.ui.mapViewportInitialized = false;
    renderVirtualCity();
    syncAllCablePathsToTrenches();
    renderGlobalDrawingLayer();
    updateMetrics();
    resetMapHistory();
    scheduleInitialMapCenter({ force: true });
  }

  function serializeProjectState() {
    var payload = {
      version: 1,
      savedAt: new Date().toISOString(),
      layout: Sim.activeCityId,
      coordinateMode: Sim.coordinateMode || 'geographic',
      zoom: Sim.zoom,
      panX: Sim.panX,
      panY: Sim.panY,
      mapRotation: Sim.mapRotation || 0,
      map: cloneMapState(),
      ui: {
        cableConfig: JSON.parse(JSON.stringify(Sim.ui.cableConfig || {})),
        cableCapacity: JSON.parse(JSON.stringify(Sim.ui.cableCapacity || {})),
        splitterVariant: Sim.ui.splitterVariant || '1x8',
        activeCableKind: Sim.ui.activeCableKind || 'distribution',
      },
    };
    if (global.FTTHImageMapProject?.extendSerialize) {
      global.FTTHImageMapProject.extendSerialize(payload);
    }
    return payload;
  }

  function restoreProjectState(payload) {
    if (!payload) return false;
    var mapState = payload.map || payload;
    if (!mapState || !mapState.nodes) return false;
    restoreMapState(mapState);
    if (payload.layout != null) {
      Sim.activeCityId = payload.layout;
      var sel = document.getElementById('layout-select');
      if (sel) sel.value = payload.layout;
    }
    if (payload.zoom != null) Sim.zoom = clampMapZoom(payload.zoom);
    if (payload.panX != null) Sim.panX = payload.panX;
    if (payload.panY != null) Sim.panY = payload.panY;
    syncOpenWorldShell();
    if (!isOpenWorkspaceNavigation()) applyMapPanClamp();
    if (!Sim.ui) Sim.ui = {};
    Sim.ui.mapViewportInitialized = true;
    if (payload.mapRotation != null) Sim.mapRotation = payload.mapRotation;
    if (payload.ui) {
      if (payload.ui.cableConfig) Sim.ui.cableConfig = JSON.parse(JSON.stringify(payload.ui.cableConfig));
      if (payload.ui.cableCapacity) Sim.ui.cableCapacity = JSON.parse(JSON.stringify(payload.ui.cableCapacity));
      if (payload.ui.splitterVariant) Sim.ui.splitterVariant = payload.ui.splitterVariant;
      if (payload.ui.activeCableKind) Sim.ui.activeCableKind = payload.ui.activeCableKind;
    }
    if (payload.coordinateMode) Sim.coordinateMode = payload.coordinateMode;
    else if (payload.layout !== 'uploaded_map') Sim.coordinateMode = 'geographic';
    if (global.FTTHImageMapProject?.restoreFromProject) {
      global.FTTHImageMapProject.restoreFromProject(payload);
    }
    renderVirtualCity();
    syncAllCablePathsToTrenches();
    renderGlobalDrawingLayer();
    renderToolbox();
    applyMapTransform();
    renderUnifiedSidebar();
    resetMapHistory();
    updateMetrics();
    notifyFiberDesignTopologyChanged();
    return true;
  }

  function initControls() {
    bindControls();
    bindHistoryControls();
    enableInteractions();
  }

  function removeElementInfoBar() {
    var bar = document.getElementById('virtual-map-bar');
    if (bar) bar.remove();
  }

  function boot() {
    try {
      removeElementInfoBar();
      loadPersistedSettings();
      ensureSimulatorContainerFocusable();
      bindSimulatorGlobalEvents();
      if (!Sim.ui.cableCapacity) Sim.ui.cableCapacity = { distribution: 72, lastmile: 12 };
      if (!Sim.ui.splitterVariant) Sim.ui.splitterVariant = '1x8';
      initControls();
      initPathModules();
      if (global.FTTHToolboxManager?.bindDom) global.FTTHToolboxManager.bindDom();
      ensureBottomPanelInWorkspace();
      renderToolbox();
      ensureFtthWorldDom();
      renderVirtualCity();
      syncAllCablePathsToTrenches();
      renderGlobalDrawingLayer();
      bindGlobalKeyboardShortcuts();
      resetMapHistory();
      syncPenModeClass();
      Sim.zoom = clampMapZoom(Sim.zoom || 1);
      installWorkspaceViewportPivotObserver();
      scheduleInitialMapCenter();
      applyLayoutSettingsFromStorage();
      applyIconZoomCompensation();
      renderUnifiedSidebar();
      initFiberDesignModules();
      syncSplicingToolbarState();
      if (global.FTTHFileMenu?.init) global.FTTHFileMenu.init();
      updateStatus('Ready — modular draw engine v6');
      if (DEBUG) {
        console.info('[FTTH Simulator] Shortcuts (capture): window/document/body/canvas; Ctrl+Z/Y; Esc -> #tool-select');
      }
      if (global.FTTHLabelManager?.init) {
        global.FTTHLabelManager.init({
          getEntities: getEntities,
          getEntityLabelEntries: getEntityLabelEntries,
          getCableSegmentLabels: getCableSegmentLabels,
          getAbLmCabelLabelEntriesForNode: function (nodeId) {
            return global.FTTHLabelDataProviders.getAbLmCabelLabelEntriesForNode(nodeId);
          },
          getLabelObjectObstacles: getLabelObjectObstacles,
          getCablePathSegments: getCablePathSegments,
          getZoomFactor: function () { return Sim.zoom || 1; },
          getViewportState: function () {
            return {
              panX: Sim.panX || 0,
              panY: Sim.panY || 0,
              zoom: Sim.zoom || 1,
              rotation: Sim.mapRotation || 0,
            };
          },
          getViewportWorldCenter: function () {
            var sc = getWorkspaceViewportScreenCenter();
            return pointerClientToCanvasXY(sc.x, sc.y);
          },
          getSelectedNodeId: function () { return Sim.selectedNodeId || null; },
          getNodeWorldXY: function (nodeId) {
            var node = findNode(nodeId);
            if (!node) return null;
            var center = global.FTTHDrawingEngine?.getDeviceSnapCenter?.(node) || getNodeCenterXY(node);
            if (!center || !isFinite(center.x) || !isFinite(center.y)) return null;
            var radius = 14;
            if (node.type === 'fdt' || node.type === 'olt') radius = 18;
            else if (node.type === 'fat_handhole') radius = node.hasFatPole ? 18 : 16;
            else if (node.type === 'pole_foundation') radius = 15;
            else if (node.type === 'handhole') radius = 14;
            return {
              x: center.x,
              y: center.y,
              radius: radius,
              type: node.type,
              autoName: node.autoName || node.poleName || node.fatSystemName || null,
              isPole: node.type === 'pole_foundation' || !!(node.type === 'fat_handhole' && node.hasFatPole),
            };
          },
          getOverlayHost: getLabelOverlayHost,
          getMapViewportCanvasBounds: getLabelMapViewportCanvasBounds,
          getLabelColor: function () { return Sim.settings?.labelColor || '#ffffff'; },
          getLabelFontSize: function () { return Sim.settings?.labelFontSize || 11; },
          canPenDraw: canPenDraw,
          hasActiveDrawingStroke: hasActiveDrawingStroke,
          isPenPointerTrackingActive: function () {
            return !!global.FTTHDrawingEngine?.isPenPointerTrackingActive?.();
          },
          isMapViewportNavigating: function () {
            if (Sim.isPanning) return true;
            var wrap = document.getElementById('canvas-wrapper');
            if (wrap && wrap.classList.contains('is-wheel-zooming')) return true;
            if (wrap && wrap.classList.contains('is-map-gesture-nav')) return true;
            return false;
          },
        });
      }
      if (global.FTTHFiberDesignUI?.init) {
        global.FTTHFiberDesignUI.init({
          getFiberDesignManager: function () { return global.FTTHFiberDesignManager || null; },
          getSelectedNodeId: function () { return Sim.selectedNodeId || null; },
          getOverlayHost: function () {
            return document.getElementById('sim-workspace-overlays') ||
              document.getElementById('simulator-container');
          },
        });
      }
      if (global.FTTHFiberDesignMatrixModal && global.FTTHFiberDesignMatrixModal.init) {
        global.FTTHFiberDesignMatrixModal.init({
          getFiberDesignManager: function () { return global.FTTHFiberDesignManager || null; },
          getOverlayHost: function () {
            return document.getElementById('sim-workspace-overlays') ||
              document.getElementById('simulator-container');
          },
        });
      }
      if (global.FTTHSplicingActionUI && global.FTTHSplicingActionUI.init) {
        global.FTTHSplicingActionUI.init({
          getFiberDesignManager: function () { return global.FTTHFiberDesignManager || null; },
          getClosureNodes: getClosureNodesForFiberDesign,
          showStatus: updateStatus,
        });
      }
    } catch (err) {
      console.error('[FTTH Simulator] Boot error:', err);
      renderToolbox();
    }
  }

  global.FTTHSim = Sim;
  Sim.centerMapInViewport = centerMapInViewport;
  Sim.centerMapOnLoad = centerMapOnLoad;
  Sim.scheduleInitialMapCenter = scheduleInitialMapCenter;
  global.enableCutMode = enableCutMode;
  global.enableVertexMode = enableVertexMode;
  global.enablePanMode = enablePanMode;
  global.enableSelectMode = enableSelectMode;
  global.toggleCutMode = toggleCutMode;
  global.toggleVertexMode = toggleVertexMode;
  global.getCurrentMode = getCurrentMode;
  global.setCurrentMode = setCurrentMode;
  Object.defineProperty(global, 'currentMode', {
    get: function () { return getCurrentMode(); },
    set: function (mode) { setCurrentMode(mode); },
    configurable: true,
  });
  global.getEntities = getEntities;
  global.getEntityLabelEntries = getEntityLabelEntries;
  global.getCableSegmentLabels = getCableSegmentLabels;
  global.getLabelObjectObstacles = getLabelObjectObstacles;
  global.getCablePathSegments = getCablePathSegments;
  global.__renderToolboxBootstrap = renderToolbox;
  global.removeElement = removeElement;
  global.enableInteractions = enableInteractions;
  global.saveState = saveState;
  global.undo = undo;
  global.redo = redo;
  global.handleUndo = undo;
  global.handleRedo = redo;
  global.selectTool = selectTool;
  global.reRenderWorkspace = reRenderWorkspace;
  global.cancelCurrentDrawing = resetDrawingPointsKeepTool;
  Object.defineProperty(global, 'isDrawing', {
    get: function () { return isDrawingActive(); },
    configurable: true,
  });
  Object.defineProperty(global, 'currentDrawingPoints', {
    get: function () { return (Sim.penDraft && Sim.penDraft.points) ? Sim.penDraft.points : []; },
    configurable: true,
  });
  global.openFullscreen = toggleAppFullscreen;
  global.toggleAppFullscreen = toggleAppFullscreen;
  global.enterFullscreenContainer = toggleAppFullscreen;
  global.handleShortcuts = handleShortcuts;
  global.handleGlobalShortcuts = handleShortcuts;
  global.isPenDrawingActive = function () {
    return !!(Sim.penDraft && isPenToolActive());
  };
  global.isPathEditActive = function () {
    return !!(Sim.selectedPath && (Sim.pathEdit?.editActive || Sim.pathEdit?.drag || Sim.pathEdit?.isDraggingVertex));
  };
  global.isExcavationDrawingActive = global.isPenDrawingActive;

  global.FTTHProjectIO = {
    serializeProjectState: serializeProjectState,
    restoreProjectState: restoreProjectState,
    clearWorkspace: clearWorkspace,
    getCurrentProjectName: function () { return Sim.ui.currentProjectName || null; },
    setCurrentProjectName: function (name) {
      Sim.ui.currentProjectName = name ? String(name).trim() : null;
      if (global.FTTHFileMenu?.refreshProjectLabel) global.FTTHFileMenu.refreshProjectLabel();
    },
  };

  function panToCanvasPointForInventory(cx, cy) {
    if (!isFinite(cx) || !isFinite(cy)) return;

    // Ensure world shell dimensions are accurate
    if (typeof syncOpenWorldShell === 'function') syncOpenWorldShell();

    var wrap = document.getElementById('canvas-wrapper');
    var frame = typeof getMapZoomViewportFrame === 'function' ? getMapZoomViewportFrame() : { centerX: 0, centerY: 0 };
    var zoom = (typeof getMapCoordZoom === 'function' ? getMapCoordZoom() : Sim.zoom) || 1;

    // Convert local template coordinates (cx, cy) to true Open-World absolute coordinates
    // This handles the new massive origin offsets and potential map rotation correctly!
    var desk = typeof templateLocalToDeskWorldXY === 'function'
               ? templateLocalToDeskWorldXY(cx, cy)
               : { x: cx, y: cy };

    // Calculate the precise PanX and PanY to center this point on the screen
    Sim.panX = frame.centerX - (desk.x * zoom);
    Sim.panY = frame.centerY - (desk.y * zoom);

    if (typeof isOpenWorkspaceNavigation === 'function' && !isOpenWorkspaceNavigation() && typeof applyMapPanClamp === 'function') {
      applyMapPanClamp();
    }

    if (wrap) {
      wrap.scrollLeft = 0;
      wrap.scrollTop = 0;
    }

    if (typeof applyMapTransform === 'function') {
      applyMapTransform({ skipPanClamp: typeof isOpenWorkspaceNavigation === 'function' ? isOpenWorkspaceNavigation() : true });
    }
  }

  function getExcavationRouteKindForLineId(lineId) {
    for (var i = 0; i < EXCAVATION_TOOLS.length; i++) {
      if (EXCAVATION_TOOLS[i].id === lineId) return EXCAVATION_TOOLS[i].routeKind;
    }
    return null;
  }

  function getClosureNodesForFiberDesign() {
    return (Sim.nodes || []).filter(function (n) {
      if (!n) return false;
      if (n.type === 'handhole' && (n.hasClosure || n.closureName)) return true;
      if (n.type === 'fat_handhole' && n.hasClosure) return true;
      return false;
    });
  }

  function getClosureLabelForFiberDesign(nodeId) {
    var node = findNode(nodeId);
    if (!node) return String(nodeId);
    if (node.closureName) return node.closureName;
    return getNodeAsBuiltCode(node);
  }

  function getFatIdForClosureForFiberDesign(nodeId) {
    var node = findNode(nodeId);
    if (!node) return '';
    if (node.type === 'fat_handhole') {
      return node.autoName || node.fatSystemName || getNodeAsBuiltCode(node);
    }
    var best = null;
    var bestD = Infinity;
    var maxCells = 2.5;
    (Sim.nodes || []).forEach(function (n) {
      if (!n || n.type !== 'fat_handhole') return;
      var d = Math.hypot((n.col || 0) - (node.col || 0), (n.row || 0) - (node.row || 0));
      if (d > maxCells) return;
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    });
    if (best) return best.autoName || best.fatSystemName || getNodeAsBuiltCode(best);
    return '';
  }

  function getNodeLocationForFiberDesign(node) {
    if (!node) return null;
    var center = getNodeCenterXY(node);
    if (center && isFinite(center.x) && isFinite(center.y)) {
      return { x: center.x, y: center.y, col: node.col, row: node.row };
    }
    return { col: node.col, row: node.row };
  }

  function initFiberDesignModules() {
    if (global.FTTHFiberDesignManager && global.FTTHFiberDesignManager.init) {
      global.FTTHFiberDesignManager.init({
        getClosureNodes: getClosureNodesForFiberDesign,
        getClosureLabel: getClosureLabelForFiberDesign,
        getMapCablesForNode: getCablesLinkedToNode,
        getMapCableLabel: getCableDisplayBatchLabel,
        getFatIdForClosure: getFatIdForClosureForFiberDesign,
        getNodeLocation: getNodeLocationForFiberDesign,
        getCurrentUserId: function () { return Sim.currentUserId || null; },
        getMapNodes: function () { return Sim.nodes || []; },
        getMapCables: function () { return Sim.fiberCablePaths || []; },
        resolveNodeById: findNode,
        resolveNodeBySnapLabel: findNodeBySnapLabel,
        findServingFdt: findServingFdt,
        getCabinetLabel: getFdtCabinetCode,
        getNodeWorldXY: function (node) {
          return global.FTTHDrawingEngine?.getDeviceSnapCenter?.(node) || getNodeCenterXY(node);
        },
        findNearestNodeAt: function (x, y, maxDist) {
          return findNearestEquipmentAtPoint(x, y, maxDist != null ? maxDist : (((Sim.layout && Sim.layout.cellSize) || 50) * 0.85));
        },
        getCableLinkDistance: function () {
          return ((Sim.layout && Sim.layout.cellSize) || 50) * 0.85;
        },
        formatMainCableTrailLabelForDisplay: formatMainCableTrailLabelForDisplay,
        resolveMainTrailHopDisplayLabel: resolveMainTrailHopDisplayLabel,
      });
      notifyFiberDesignTopologyChanged();
    }
  }

  function initPhase1Modules() {
    if (global.FTTHSimulatorSettings?.init) {
      global.FTTHSimulatorSettings.init({ getSim: function () { return Sim; } });
    }
    if (global.FTTHLabelDataProviders?.init) {
      global.FTTHLabelDataProviders.init({
        getSim: function () { return Sim; },
        findNode: findNode,
        getNodeCenterXY: getNodeCenterXY,
        getDeviceSnapCenter: function (node) {
          return global.FTTHDrawingEngine?.getDeviceSnapCenter?.(node) || getNodeCenterXY(node);
        },
        getNodeLabelEntries: getNodeLabelEntries,
        getCableRenderGeometry: getCableRenderGeometry,
        getCableDisplayBatchLabel: getCableDisplayBatchLabel,
        getCableLaneInfo: getCableLaneInfo,
        getCablesLinkedToNode: getCablesLinkedToNode,
        sortCablesForLaneOrder: sortCablesForLaneOrder,
      });
    }
    if (global.FTTHToolboxInventory?.init) {
      global.FTTHToolboxInventory.init({
        getSim: function () { return Sim; },
        getNodeCenterXY: getNodeCenterXY,
        getNodeAutoLabel: getNodeAutoLabel,
        getCableDisplayBatchLabel: getCableDisplayBatchLabel,
        getExcavationDisplayNumber: getExcavationDisplayNumber,
        getCableRenderGeometry: getCableRenderGeometry,
        getExcavationRouteKind: getExcavationRouteKindForLineId,
        panToCanvasPoint: panToCanvasPointForInventory,
      });
    }
    if (global.FTTHToolboxManager?.init) {
      global.FTTHToolboxManager.init({ deferDom: true });
    }
    if (global.FTTHVisibilityManager?.init) {
      global.FTTHVisibilityManager.init({
        requestRender: function () {
          renderAllNodes();
          if (global.FTTHDrawingEngine?.renderMapLabels) {
            global.FTTHDrawingEngine.renderMapLabels();
          }
        },
      });
    }
    initFiberDesignModules();
  }

  initPhase1Modules();
  bindMapLoadScrollCenter();

  var workspaceBooted = false;
  function runWorkspaceBoot() {
    if (workspaceBooted) return;
    workspaceBooted = true;
    boot();
  }

  global.FTTHSimBoot = {
    run: runWorkspaceBoot,
    isBooted: function () { return workspaceBooted; },
  };

  global.FTTHStatusBar = {
    setPushHint: setPushHint,
    sync: syncGisStatusBar,
    refreshFromContext: refreshPushHintFromContext,
  };

  global.FTTHActiveFdt = {
    /** Requires { manual:true } (toolbox) or { bootstrap:true } (no active FDT yet). */
    setActiveFdt: setActiveFdt,
    getActiveFdtId: getActiveFdtId,
    getActiveFdtLabel: getActiveFdtLabel,
    getActiveFdtNumber: getActiveFdtNumber,
    nodeBelongsToCabinet: nodeBelongsToCabinet,
    cableBelongsToCabinet: cableBelongsToCabinet,
    excavationBelongsToCabinet: excavationBelongsToCabinet,
    syncChrome: syncActiveFdtChrome,
  };

  var deferBoot = !!document.getElementById('startup-view');
  if (!deferBoot) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', runWorkspaceBoot);
    } else {
      runWorkspaceBoot();
    }
  }
})(window);
