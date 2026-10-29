/**
 * drawingEngine.js — QField crosshair, pen rubber band, clean cut overlays.
 * Depends on bridge injected via FTTHDrawingEngine.init(bridge).
 */
(function (global) {
  'use strict';

  var DEBUG = !!(global && global.FTTH_DEBUG);

  var SNAP_THRESHOLD = 6;
  var SNAP_THRESHOLD_SQ = SNAP_THRESHOLD * SNAP_THRESHOLD;
  /* Hard geographic cap: zoomed-out screen magnets must not latch across the map. */
  var MAX_SNAP_MAP_UNITS = 2.5;
  var CABLE_MAGNETIC_SNAP_RADIUS = 32;
  var CABLE_MAGNETIC_SNAP_SQ = CABLE_MAGNETIC_SNAP_RADIUS * CABLE_MAGNETIC_SNAP_RADIUS;
  var CABLE_SNAP_MARKER_RADIUS = 6;
  var CABLE_ANCHOR_DOT_RADIUS = 4;
  var PEN_CLICK_PULSE_MS = 150;
  /** Phase 1–3: Main/Sub Cable interactive cues (feedback only — no geometry changes). */
  var MAIN_CABLE_START_CONFIRM_MS = 2800;
  var MAIN_CABLE_CHECKPOINT_CONFIRM_MS = 2200;
  var SUB_CABLE_CONFIRM_MS = 2200;
  var MAIN_CABLE_HOVER_RING = '#dc2626';
  var MAIN_CABLE_CONFIRM_RING = '#16a34a';
  var MAIN_CABLE_CLOSURE_HOVER_RING = '#eab308';
  var SUB_CABLE_START_HOVER_RING = '#38bdf8';
  var SUB_CABLE_DROP_HOVER_RING = '#f97316'; /* Orange — FH/pole drop hover */
  var PEN_RUBBER_COLOR = '#f97316';
  var PEN_RUBBER_DASH = '5,5';
  var CUT_PREVIEW_COLOR = '#ef4444';
  var CUT_OPEN_DOT_COLOR = '#dc2626';
  var CROSSHAIR_STROKE = '#334155';
  var CROSSHAIR_PLUS = '#1e293b';
  var PEN_TARGET_RADIUS = 8;
  var PEN_SNAP_LOCKED_RADIUS = 5;
  var PEN_VERTEX_SNAP_RADIUS = 3;
  var RECONNECT_SNAP_RADIUS = 14;
  var PEN_TARGET_PLUS_LEN = 5;
  var PEN_SNAP_LOCKED_PLUS_LEN = 3;
  var PEN_VERTEX_SNAP_PLUS_LEN = 2;
  var PEN_VERTEX_RADIUS = 5;
  var PEN_VERTEX_PLUS_LEN = 4;
  var GHOST_PREVIEW_COLOR = '#f97316';
  var GHOST_DASH = '5,5';
  var GHOST_LINE_WIDTH = '1.2';
  var VERTEX_RING_RADIUS = 5;
  var SVG_NS = 'http://www.w3.org/2000/svg';

  /** Integer pixel snap — prevents sub-pixel stroke/fill jitter during zoom. */
  function snapPixel(v) {
    return Math.round(Number(v) || 0);
  }

  function snapPixelPathPoints(points) {
    if (!points || !points.length) return [];
    var out = new Array(points.length);
    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      out[i] = p ? [snapPixel(p[0]), snapPixel(p[1])] : [0, 0];
    }
    return out;
  }

  function applyPixelPerfectCanvasContexts() {
    if (typeof document === 'undefined') return;
    var canvases = document.querySelectorAll('canvas');
    for (var i = 0; i < canvases.length; i++) {
      try {
        var ctx = canvases[i].getContext('2d');
        if (ctx && 'imageSmoothingEnabled' in ctx) ctx.imageSmoothingEnabled = false;
      } catch (err) { /* ignore */ }
    }
  }

  function preparePixelPerfectRenderContext(svg) {
    applyPixelPerfectCanvasContexts();
    if (svg && svg.setAttribute) {
      svg.setAttribute('shape-rendering', 'crispEdges');
      svg.setAttribute('text-rendering', 'geometricPrecision');
    }
  }

  function setSvgLineCoords(line, x1, y1, x2, y2) {
    if (!line) return;
    line.setAttribute('x1', snapPixel(x1));
    line.setAttribute('y1', snapPixel(y1));
    line.setAttribute('x2', snapPixel(x2));
    line.setAttribute('y2', snapPixel(y2));
  }

  function setSvgCircleCenter(circle, cx, cy) {
    if (!circle) return;
    circle.setAttribute('cx', snapPixel(cx));
    circle.setAttribute('cy', snapPixel(cy));
  }

  /* Sequential cable stacking — tight bundle spacing (px between adjacent cables). */
  var CABLE_STACK_SPACING_PX_FULL = 1.5;
  var CABLE_STACK_SPACING_PX_MIN = 1;
  var CABLE_OFFSET_ZOOM_FULL = 1;
  var CABLE_OFFSET_ZOOM_MIN = 0.5;
  var CABLE_LABEL_ZOOM_SHOW = 0.7;
  var TRENCH_MIN_WIDTH_PX = 3.5;
  var CABLE_ENDPOINT_SAFE_GAP_SCREEN_PX_MIN = 3;
  var CABLE_ENDPOINT_SAFE_GAP_SCREEN_PX_MAX = 8;

  var bridge = null;
  var ghostRedrawPending = false;
  var cableSaveInProgress = false;
  var cableFinishingDblClick = false;
  var penFinishingDblClick = false;
  var mapLabelsRedrawPending = false;
  var deviceLabelObserverBound = false;
  var vertexGhostListenersAttached = false;
  var penPointerTrackingAttached = false;
  var rubberBandRaf = 0;
  var rubberBandPendingEvent = null;
  var penDblClickCaptureBound = false;
  var lastPenSnapCache = null;
  var penClickPulseTimer = null;
  var mainCableConfirmTimer = null;
  var mainCableCheckpointTimer = null;
  var subCableStartConfirmTimer = null;
  var subCableDropConfirmTimer = null;
  var cableContinueOffer = null;
  var cableContinueFabEl = null;
  var cableContinueFabBound = false;
  var cableContinuePromptLocked = false;
  var cableContinueRejectedIds = Object.create(null);
  var pendingCableForceNodeId = null;
  function b() { return bridge; }
  function sim() { return b()?.getSim?.(); }

  function findSimNodeById(nodeId) {
    var nodes = sim()?.nodes || [];
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i] && nodes[i].id === nodeId) return nodes[i];
    }
    return null;
  }

  function nodeDisplayName(node) {
    if (!node) return '';
    if (node.type === 'fdt') {
      var fdtCode = node.autoName || node.code || '';
      return String(fdtCode).replace(/^FDY/i, 'FDT') || 'FDT';
    }
    if (node.name) return String(node.name);
    if (node.type === 'fat_handhole' && node.hasFatPole && node.fatSystemName) return node.fatSystemName;
    if (node.autoName) return String(node.autoName);
    if (node.closureName) return String(node.closureName);
    if (node.type === 'olt') return 'OLT';
    return '';
  }

  function queryDeviceGlyphEl(placedEl) {
    if (!placedEl) return null;
    return placedEl.querySelector(
      '.fdt-cabinet-glyph, .field-glyph--handhole, .field-glyph--fat-handhole, .field-glyph--fat-pole, .field-glyph, .fat-handhole-base, .fat-pole'
    ) || placedEl.querySelector('.placed-node__glyph-anchor, .placed-node__stack');
  }

  function getHandholeAssetCenter(node) {
    if (!node) return null;
    var gridCenter = b()?.getNodeCenterXY?.(node);
    if (!gridCenter) return null;
    var label = nodeDisplayName(node) || gridCenter.label || null;
    var placed = document.querySelector('.placed-node[data-id="' + node.id + '"]');
    var measureEl = null;
    if (placed) {
      if (node.type === 'fat_handhole' && node.hasFatPole) {
        measureEl = placed.querySelector('.fat-unified-map-marker, .fat-rigid-marker') ||
          placed.querySelector('.fat-handhole-base .field-glyph--fat-handhole');
      } else {
        measureEl = placed.querySelector('.placed-node__glyph-anchor .field-glyph--handhole, .placed-node__glyph-anchor .field-glyph--fat-handhole') ||
          placed.querySelector('.placed-node__glyph-anchor') ||
          queryDeviceGlyphEl(placed);
      }
    }
    if (measureEl?.getBoundingClientRect) {
      var rect = measureEl.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        var clientX = rect.left + rect.width / 2;
        var clientY = rect.top + rect.height / 2;
        var mapped = b()?.pointerClientToCanvasXY?.(clientX, clientY);
        if (mapped && isFinite(mapped.x) && isFinite(mapped.y)) {
          return {
            x: Math.round(mapped.x * 10) / 10,
            y: Math.round(mapped.y * 10) / 10,
            label: label,
            nodeId: node.id,
          };
        }
      }
    }
    return {
      x: Math.round(gridCenter.x * 10) / 10,
      y: Math.round(gridCenter.y * 10) / 10,
      label: label,
      nodeId: node.id,
    };
  }

  function getDeviceSnapCenter(node) {
    if (!node) return null;
    if (node.type === 'handhole' || node.type === 'fat_handhole') {
      return getHandholeAssetCenter(node);
    }
    var gridCenter = b()?.getNodeCenterXY?.(node);
    if (!gridCenter) return null;

    var label = nodeDisplayName(node) || gridCenter.label || null;

    var placed = document.querySelector('.placed-node[data-id="' + node.id + '"]');
    var glyph = placed ? queryDeviceGlyphEl(placed) : null;
    if (glyph && glyph.getBoundingClientRect) {
      var rect = glyph.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        var clientX = rect.left + rect.width / 2;
        var clientY = rect.top + rect.height / 2;
        var mapped = b()?.pointerClientToCanvasXY?.(clientX, clientY);
        if (mapped && isFinite(mapped.x) && isFinite(mapped.y)) {
          return {
            x: Math.round(mapped.x * 10) / 10,
            y: Math.round(mapped.y * 10) / 10,
            label: label,
            nodeId: node.id,
          };
        }
      }
    }

    return {
      x: Math.round(gridCenter.x * 10) / 10,
      y: Math.round(gridCenter.y * 10) / 10,
      label: label,
      nodeId: node.id,
    };
  }

  function normalizeDeviceSnapHit(hit) {
    if (!hit) return hit;
    var node = hit.nodeId ? findSimNodeById(hit.nodeId) : null;
    if (!node) return hit;
    var center = getDeviceSnapCenter(node);
    if (!center) return hit;
    return {
      x: center.x,
      y: center.y,
      kind: 'device',
      nodeId: center.nodeId,
      label: center.label,
      pathType: hit.pathType,
      pathId: hit.pathId,
      vertexIndex: hit.vertexIndex,
    };
  }

  var DEVICE_CENTER_ALIGN_RADIUS = SNAP_THRESHOLD;

  function alignPointToDeviceCenter(x, y) {
    if (!isFinite(x) || !isFinite(y)) return null;
    var best = null;
    var bestDist = DEVICE_CENTER_ALIGN_RADIUS + 1;
    (sim()?.nodes || []).forEach(function (node) {
      if (!isSnappableDeviceNode(node)) return;
      var center = getDeviceSnapCenter(node);
      if (!center) return;
      var d = Math.hypot(center.x - x, center.y - y);
      if (d <= DEVICE_CENTER_ALIGN_RADIUS && d < bestDist) {
        bestDist = d;
        best = center;
      }
    });
    return best;
  }

  function resolvePathPointsForRender(points) {
    if (!points || !points.length) return points || [];
    return points.map(function (pt) {
      if (!pt) return pt;
      var px = Array.isArray(pt) ? pt[0] : pt.x;
      var py = Array.isArray(pt) ? pt[1] : pt.y;
      if (!isFinite(px) || !isFinite(py)) return pt;
      return [px, py];
    });
  }

  function normalizePathPointsForSave(points) {
    if (!points || !points.length) return [];
    var out = [];
    points.forEach(function (p) {
      if (!p) return;
      var px = Array.isArray(p) ? p[0] : p.x;
      var py = Array.isArray(p) ? p[1] : p.y;
      if (!isFinite(px) || !isFinite(py)) return;
      var pt = [Math.round(px * 10) / 10, Math.round(py * 10) / 10];
      var prev = out[out.length - 1];
      if (prev && Math.abs(prev[0] - pt[0]) < 0.1 && Math.abs(prev[1] - pt[1]) < 0.1) return;
      out.push(pt);
    });
    return out;
  }

  function clonePathPointsForSave(points) {
    return normalizePathPointsForSave(points).map(function (p) { return [p[0], p[1]]; });
  }

  /** Exact clone for merge — no collinear/duplicate simplification (preserves H1 in/out loops). */
  function clonePathPointsForMerge(points) {
    return (points || []).map(function (p) {
      if (!p) return null;
      var px = Array.isArray(p) ? p[0] : p.x;
      var py = Array.isArray(p) ? p[1] : p.y;
      if (!isFinite(px) || !isFinite(py)) return null;
      return [Math.round(px * 10) / 10, Math.round(py * 10) / 10];
    }).filter(Boolean);
  }

  function cloneCablePointsForSave(points) {
    return (points || []).map(function (p) {
      if (!p) return null;
      var px = Array.isArray(p) ? p[0] : p.x;
      var py = Array.isArray(p) ? p[1] : p.y;
      if (!isFinite(px) || !isFinite(py)) return null;
      return [Math.round(px * 10) / 10, Math.round(py * 10) / 10];
    }).filter(Boolean);
  }

  function dedupeConsecutiveExactCablePoints(points) {
    var out = [];
    (points || []).forEach(function (pt) {
      var prev = out[out.length - 1];
      if (prev && prev[0] === pt[0] && prev[1] === pt[1]) return;
      out.push(pt);
    });
    return out;
  }

  function resolveCableFinishCursorPoint(draft, finishEvent) {
    if (finishEvent && finishEvent.clientX != null && finishEvent.clientY != null) {
      var xy = b()?.pointerEventToCanvasXY?.(finishEvent) || b()?.getSVGCoordinates?.(finishEvent);
      var guided = resolveCableGuidedSnap(finishEvent, xy);
      if (guided) return [Math.round(guided.x * 10) / 10, Math.round(guided.y * 10) / 10];

      var nodeId = b()?.pickPlacedNodeUnderPointer?.(finishEvent.clientX, finishEvent.clientY);
      if (nodeId) {
        var node = findSimNodeById(nodeId);
        var center = node ? getDeviceSnapCenter(node) : null;
        if (center) {
          var snapTol = getCableEffectiveSnapRadius() * 3 / Math.max(sim()?.zoom || 1, 0.08);
          var proj = b()?.projectPointOnAnyExcavation?.(center.x, center.y, snapTol);
          if (proj) return [Math.round(proj.x * 10) / 10, Math.round(proj.y * 10) / 10];
        }
      }
    }
    var ch = sim()?.crosshair;
    if (ch?.snapped && isFinite(ch.snapX) && isFinite(ch.snapY) &&
        b()?.isPointOnExcavationTrench?.(ch.snapX, ch.snapY)) {
      return [Math.round(ch.snapX * 10) / 10, Math.round(ch.snapY * 10) / 10];
    }
    if (draft?.cursor?.length === 2 &&
        b()?.isPointOnExcavationTrench?.(draft.cursor[0], draft.cursor[1])) {
      return [draft.cursor[0], draft.cursor[1]];
    }
    if (draft?.points?.length) {
      var lastPt = draft.points[draft.points.length - 1];
      if (lastPt && b()?.isPointOnExcavationTrench?.(lastPt[0], lastPt[1])) {
        return [lastPt[0], lastPt[1]];
      }
    }
    return null;
  }

  function applySnappedFinishToDraft(draft, finishEvent) {
    if (!draft || draft.lineMode === 'cable') return;
    var pt = null;
    var snapLabel = null;
    var snapNodeId = null;

    var ch = sim()?.crosshair;
    if (ch?.snapped && isFinite(ch.snapX) && isFinite(ch.snapY)) {
      pt = [Math.round(ch.snapX * 10) / 10, Math.round(ch.snapY * 10) / 10];
    }

    if (finishEvent && finishEvent.clientX != null && finishEvent.clientY != null) {
      if (draft.lineMode === 'cable') {
        var cablePt = resolveCableFinishCursorPoint(draft, finishEvent);
        if (cablePt) pt = cablePt;
      } else {
        var xy = b()?.pointerEventToCanvasXY?.(finishEvent) || b()?.getSVGCoordinates?.(finishEvent);
        var snap = getSnappedPosition(finishEvent.clientX, finishEvent.clientY, xy?.x, xy?.y, { mode: 'pen' });
        if (snap?.snapped) {
          pt = [Math.round(snap.x * 10) / 10, Math.round(snap.y * 10) / 10];
          snapLabel = snap.snapLabel || snap.target?.label || null;
          snapNodeId = snap.snapNodeId || snap.target?.nodeId || null;
        }
        var pickedNodeId = b()?.pickPlacedNodeUnderPointer?.(finishEvent.clientX, finishEvent.clientY);
        if (pickedNodeId) {
          var pickedNode = findSimNodeById(pickedNodeId);
          var pickedCenter = pickedNode ? getDeviceSnapCenter(pickedNode) : null;
          if (pickedCenter) {
            pt = [Math.round(pickedCenter.x * 10) / 10, Math.round(pickedCenter.y * 10) / 10];
            snapLabel = pickedCenter.label || snapLabel;
            snapNodeId = pickedCenter.nodeId || pickedNodeId;
          }
        }
      }
    }

    if (!pt || !draft.points) return;

    var last = draft.points[draft.points.length - 1];
    if (!last || !pointsNear(last, pt, 1.5)) {
      draft.points.push(pt);
      if (!draft.snapLabels) draft.snapLabels = [];
      if (!draft.pointSnapNodeIds) draft.pointSnapNodeIds = [];
      draft.snapLabels.push(snapLabel || null);
      draft.pointSnapNodeIds.push(snapNodeId || null);
    } else if (snapLabel || snapNodeId) {
      var li = draft.points.length - 1;
      if (snapLabel) draft.snapLabels[li] = snapLabel;
      if (snapNodeId) draft.pointSnapNodeIds[li] = snapNodeId;
    }
    draft.cursor = pt.slice();
    draft.cursorSnapNodeId = snapNodeId || null;

    if (draft.lineMode !== 'cable' && finishEvent?.clientX != null && finishEvent?.clientY != null) {
      var xyFinish = b()?.pointerEventToCanvasXY?.(finishEvent) || b()?.getSVGCoordinates?.(finishEvent);
      var finishSnap = getSnappedPosition(finishEvent.clientX, finishEvent.clientY, xyFinish?.x, xyFinish?.y, { mode: 'pen' });
      var snapTarget = finishSnap?.target;
      if ((!snapTarget || snapTarget.vertexIndex == null) && ch?.snapped) {
        var editor = global.FTTHPathwayEditor;
        var rc = draft.reconnectFrom;
        if (rc && editor?.findPathByRef) {
          var hostPath = editor.findPathByRef({ type: rc.type, id: rc.id });
          var inferred = hostPath
            ? editor.inferReconnectToVertex?.(hostPath, draft.points, rc.vertexIndex)
            : null;
          if (inferred != null) {
            snapTarget = {
              pathType: rc.type,
              pathId: rc.id,
              vertexIndex: inferred,
              kind: inferred === 0 || inferred === (hostPath.points.length - 1) ? 'path-endpoint' : 'path-vertex',
            };
          }
        }
      }
      if (snapTarget?.pathType && snapTarget.pathId != null && snapTarget.vertexIndex != null &&
          (snapTarget.kind === 'path-vertex' || snapTarget.kind === 'path-endpoint')) {
        draft.reconnectTo = {
          type: snapTarget.pathType,
          id: snapTarget.pathId,
          vertexIndex: snapTarget.vertexIndex,
        };
      }
      ensurePenMergeReconnectTargets(draft);
    }

    syncPenDraftPathState();
  }

  function forceExitPenDrawing(statusMsg, isError) {
    var S = sim();
    if (S) S.penDraft = null;
    lastPenSnapCache = null;
    cableFinishingDblClick = false;
    penFinishingDblClick = false;
    clearCableContinueSession();
    unbindPenPointerTracking();
    cancelRubberBandRaf();
    hidePenDrawingOverlays();
    updatePenSnapGlow();
    updateReconnectSnapGlow();
    b()?.renderGlobalDrawingLayer?.();
    b()?.requestCanvasRedraw?.();
    b()?.syncPenModeClass?.();
    b()?.syncDrawingLayerInteraction?.();
    b()?.syncBatchDuplicationHintForDrawingState?.();
    if (statusMsg) b()?.updateStatus?.(statusMsg, !!isError);
  }

  function collectCompleteCablePointsForSave(draft, finishEvent, opts) {
    if (!draft?.points?.length) return [];
    return cloneCablePointsForSave(draft.points);
  }

  function syncPenDraftPathState() {
    var S = sim();
    var draft = S?.penDraft;
    if (!draft) return [];
    if (!draft.pointSnapNodeIds) draft.pointSnapNodeIds = [];
    if (!draft.snapLabels) draft.snapLabels = [];
    while (draft.pointSnapNodeIds.length < draft.points.length) draft.pointSnapNodeIds.push(null);
    while (draft.pointSnapNodeIds.length > draft.points.length) draft.pointSnapNodeIds.pop();
    while (draft.snapLabels.length < draft.points.length) draft.snapLabels.push(null);
    while (draft.snapLabels.length > draft.points.length) draft.snapLabels.pop();
    draft.activePathPoints = normalizePathPointsForSave(draft.points);
    return draft.activePathPoints.slice();
  }

  function updatePathState() {
    return syncPenDraftPathState();
  }

  function trimDblClickFinishArtifact(draft) {
    if (!draft?.points || draft.points.length < 2) return;
    var last = draft.points[draft.points.length - 1];
    var prev = draft.points[draft.points.length - 2];
    if (last && prev && pointsNear(last, prev, 3)) {
      draft.points.pop();
      draft.snapLabels.pop();
      if (draft.pointSnapNodeIds) draft.pointSnapNodeIds.pop();
    }
  }

  function prepareDrawingLayer(svg) {
    if (!svg) return;
    preparePixelPerfectRenderContext(svg);
    var staleDefs = svg.querySelector('#fiber-glow-defs');
    if (staleDefs) staleDefs.remove();
    ensureDrawingOverlayGroup(svg);
  }

  function ensureDrawingOverlayGroup(svg) {
    if (!svg) return null;
    var g = svg.querySelector('#drawing-overlay-top');
    if (!g) {
      g = document.createElementNS(SVG_NS, 'g');
      g.id = 'drawing-overlay-top';
      g.setAttribute('class', 'drawing-overlay-top');
      g.setAttribute('pointer-events', 'none');
      svg.appendChild(g);
    } else if (svg.lastElementChild !== g) {
      svg.appendChild(g);
    }
    return g;
  }

  function mountOverlayEl(svg, el) {
    if (!svg || !el) return el;
    var host = ensureDrawingOverlayGroup(svg);
    if (host && el.parentNode !== host) host.appendChild(el);
    return el;
  }

  function renderMapLabels() {
    syncRigidGroupedMapEntityLabels();
    var bounds = getMapViewportCanvasBounds();
    applyViewportCullingToPlacedNodes(bounds);
    syncMapViewportLabelPresentation(sim()?.mapRotation || 0, !!sim()?.settings?.mapRotationEnabled);
  }

  function requestMapLabelsRedraw() {
    if (mapLabelsRedrawPending) return;
    mapLabelsRedrawPending = true;
    requestAnimationFrame(function () {
      mapLabelsRedrawPending = false;
      renderMapLabels();
    });
  }

  function bindDeviceLabelAutoRefresh() {
    if (deviceLabelObserverBound) return;
    var grid = document.getElementById('city-grid');
    if (!grid || typeof MutationObserver !== 'function') return;
    deviceLabelObserverBound = true;
    var observer = new MutationObserver(function () {
      requestMapLabelsRedraw();
    });
    observer.observe(grid, { childList: true, subtree: true });
  }

  function isPointerInsideClientRect(clientX, clientY, rect) {
    if (!rect || rect.width <= 0 || rect.height <= 0) return false;
    return clientX >= rect.left && clientX <= rect.right &&
      clientY >= rect.top && clientY <= rect.bottom;
  }

  function getDeviceGlyphClientRect(node) {
    if (!node) return null;
    var placed = document.querySelector('.placed-node[data-id="' + node.id + '"]');
    var glyph = placed ? queryDeviceGlyphEl(placed) : null;
    if (!glyph?.getBoundingClientRect) return null;
    var rect = glyph.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return rect;
  }

  function isPointerOverDeviceGlyph(node, clientX, clientY) {
    if (clientX == null || clientY == null) return false;
    var rect = getDeviceGlyphClientRect(node);
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      var placed = document.querySelector('.placed-node[data-id="' + node.id + '"]');
      var glyph = placed ? queryDeviceGlyphEl(placed) : null;
      if (glyph?.getBoundingClientRect) rect = glyph.getBoundingClientRect();
    }
    return rect ? isPointerInsideClientRect(clientX, clientY, rect) : false;
  }

  function penSnapThresholdSq() {
    return SNAP_THRESHOLD_SQ;
  }

  function commitPenPointFromResolved(resolved) {
    if (!resolved) return null;
    var px = isFinite(resolved.x) ? resolved.x : 0;
    var py = isFinite(resolved.y) ? resolved.y : 0;
    if (resolved.snapNodeId) {
      var node = findSimNodeById(resolved.snapNodeId);
      var center = node ? getDeviceSnapCenter(node) : null;
      if (center) {
        px = center.x;
        py = center.y;
        resolved.snapLabel = center.label || resolved.snapLabel || null;
        resolved.snapNodeId = center.nodeId || resolved.snapNodeId;
        resolved.snapped = true;
      }
    }
    return {
      pt: [Math.round(px * 10) / 10, Math.round(py * 10) / 10],
      snapLabel: resolved.snapLabel || null,
      snapNodeId: resolved.snapNodeId || null,
      snapped: !!resolved.snapped,
    };
  }

  function shouldSkipPenVertex(draft, pt, commitMeta) {
    if (!draft?.points?.length) return false;
    var last = draft.points[draft.points.length - 1];
    if (!last) return false;
    if (commitMeta?.snapNodeId) {
      var lastNodeId = draft.pointSnapNodeIds && draft.pointSnapNodeIds[draft.points.length - 1];
      if (lastNodeId && lastNodeId === commitMeta.snapNodeId && pointsNear(last, pt, 0.3)) return true;
      return false;
    }
    return pointsNear(last, pt, 0.3);
  }

  function shouldSkipCableVertex(draft, pt) {
    if (!draft?.points?.length || !pt) return false;
    var last = draft.points[draft.points.length - 1];
    if (!last) return false;
    return pointsNear(last, pt, 0.2);
  }

  var CABLE_TRENCH_SEGMENT_HIT_PX = 8;

  function getCableEffectiveSnapRadius() {
    return CABLE_TRENCH_SEGMENT_HIT_PX;
  }

  function getCableEffectiveSnapRadiusSq() {
    var r = getCableEffectiveSnapRadius();
    return r * r;
  }

  function buildCableDeviceSnapHit(node, center) {
    if (!node || !center) return null;
    var isHandhole = node.type === 'handhole' || node.type === 'fat_handhole';
    var isCabinet = node.type === 'fdt';
    var isClosureCheckpoint = isClosureCheckpointNode(node);
    return {
      x: center.x,
      y: center.y,
      snapKind: isHandhole ? 'handhole' : 'device',
      snapLabel: center.label || nodeDisplayName(node),
      snapNodeId: node.id,
      target: {
        kind: isHandhole ? 'handhole' : 'device',
        x: center.x,
        y: center.y,
        nodeId: node.id,
        label: center.label || nodeDisplayName(node),
        snapKind: isHandhole ? 'handhole' : 'device',
        nodeType: node.type || null,
        isCabinet: isCabinet,
        isClosureCheckpoint: isClosureCheckpoint,
      },
    };
  }

  /** True closures only (hasClosure) — bare pass-through handholes are ignored. */
  function isClosureCheckpointNode(node) {
    if (!node) return false;
    if (node.type !== 'handhole' && node.type !== 'fat_handhole') return false;
    return !!node.hasClosure;
  }

  function getClosureCheckpointLabel(node) {
    if (!node) return '';
    var raw = node.closureName || '';
    if (raw) {
      var m = String(raw).match(/C(\d+)/i);
      if (m) return 'C' + m[1];
      return String(raw);
    }
    return b()?.getNodeAsBuiltCode?.(node) || nodeDisplayName(node) || 'Closure';
  }

  function resolveSnapNodeId(resolvedOrHit) {
    if (!resolvedOrHit) return null;
    return resolvedOrHit.snapNodeId ||
      resolvedOrHit.target?.nodeId ||
      resolvedOrHit.snapTarget?.nodeId ||
      null;
  }

  /** Magnetic Cabinet/FDT probe for Main Cable start cue (visual only). */
  function pickCableCabinetMagneticSnap(clientX, clientY) {
    if (clientX == null || clientY == null) return null;
    var limitSq = getCableEffectiveSnapRadiusSq();
    var best = null;
    (sim()?.nodes || []).forEach(function (node) {
      if (!node || node.type !== 'fdt') return;
      var center = getDeviceSnapCenter(node);
      if (!center) return;
      var d2 = screenDistSqToDevice(node, clientX, clientY);
      if (d2 == null || d2 > limitSq) return;
      if (!best || d2 < best.d2) best = { d2: d2, node: node, center: center };
    });
    if (!best) return null;
    return buildCableDeviceSnapHit(best.node, best.center);
  }

  /** Magnetic closure probe (Main checkpoint or Sub start — visual only). */
  function pickCableClosureMagneticSnap(clientX, clientY) {
    if (clientX == null || clientY == null) return null;
    var limitSq = Math.max(getCableEffectiveSnapRadiusSq(), 28 * 28);
    var best = null;
    (sim()?.nodes || []).forEach(function (node) {
      if (!isClosureCheckpointNode(node)) return;
      var center = getDeviceSnapCenter(node);
      if (!center) return;
      var d2 = screenDistSqToDevice(node, clientX, clientY);
      if (d2 == null || d2 > limitSq) return;
      if (!best || d2 < best.d2) best = { d2: d2, node: node, center: center };
    });
    if (!best) return null;
    return buildCableDeviceSnapHit(best.node, best.center);
  }

  /** Poles / FAT handholes as Sub-Cable drop targets (visual only). */
  function isSubCableDropTargetNode(node) {
    if (!node) return false;
    if (node.type === 'fat_handhole') return true;
    if (node.type === 'pole') return true;
    if (node.type === 'pole_foundation' && node.hasPole) return true;
    return false;
  }

  function getSubCableDropLabel(node) {
    if (!node) return '';
    if (node.type === 'fat_handhole') {
      return node.autoName || node.fatSystemName ||
        b()?.getNodeAsBuiltCode?.(node) || 'FH';
    }
    if (node.type === 'pole_foundation' || node.type === 'pole') {
      return node.poleName || node.autoName ||
        b()?.getNodeAsBuiltCode?.(node) || 'P';
    }
    return b()?.getNodeAsBuiltCode?.(node) || nodeDisplayName(node) || 'Drop';
  }

  function pickCableSubDropMagneticSnap(clientX, clientY, excludeNodeId) {
    if (clientX == null || clientY == null) return null;
    var limitSq = Math.max(getCableEffectiveSnapRadiusSq(), 28 * 28);
    var skipId = excludeNodeId != null ? String(excludeNodeId) : '';
    var best = null;
    (sim()?.nodes || []).forEach(function (node) {
      if (!isSubCableDropTargetNode(node)) return;
      if (skipId && String(node.id) === skipId) return;
      var center = getDeviceSnapCenter(node);
      if (!center) return;
      var d2 = screenDistSqToDevice(node, clientX, clientY);
      if (d2 == null || d2 > limitSq) return;
      if (!best || d2 < best.d2) best = { d2: d2, node: node, center: center };
    });
    if (!best) return null;
    var hit = buildCableDeviceSnapHit(best.node, best.center);
    if (hit && hit.target) hit.target.isSubDrop = true;
    return hit;
  }

  function isCabinetFdtNode(node) {
    return !!(node && node.type === 'fdt');
  }

  function resolveCabinetNodeFromSnap(resolvedOrHit) {
    var node = findSimNodeById(resolveSnapNodeId(resolvedOrHit));
    return isCabinetFdtNode(node) ? node : null;
  }

  function resolveClosureCheckpointFromSnap(resolvedOrHit) {
    var node = findSimNodeById(resolveSnapNodeId(resolvedOrHit));
    return isClosureCheckpointNode(node) ? node : null;
  }

  function resolveSubDropFromSnap(resolvedOrHit) {
    var node = findSimNodeById(resolveSnapNodeId(resolvedOrHit));
    return isSubCableDropTargetNode(node) ? node : null;
  }

  function isCableAwaitingTrailStart(draft) {
    return !draft || !draft.points || draft.points.length === 0;
  }

  /** @deprecated alias */
  function isCableAwaitingMainStart(draft) {
    return isCableAwaitingTrailStart(draft);
  }

  function isMainCableTrailActive(draft) {
    var trail = (draft && draft.mainCableTrail) || sim()?.mainCableTrail;
    return !!(trail && trail.cabinetId);
  }

  function isSubCableTrailActive(draft) {
    var trail = (draft && draft.subCableTrail) || sim()?.subCableTrail;
    return !!(trail && trail.closureId);
  }

  function cloneMainCableTrail(trail) {
    if (!trail) return null;
    return {
      cabinetId: trail.cabinetId,
      cabinetLabel: trail.cabinetLabel,
      cableRoleLabel: trail.cableRoleLabel || 'M-CABLE',
      cableName: trail.cableName || '',
      closures: Array.isArray(trail.closures)
        ? trail.closures.map(function (c) {
          return { id: c.id, label: c.label };
        })
        : [],
      drops: Array.isArray(trail.drops)
        ? trail.drops.map(function (d) {
          return { id: d.id, label: d.label };
        })
        : [],
      nodeIds: Array.isArray(trail.nodeIds) ? trail.nodeIds.slice() : [],
    };
  }

  function cloneSubCableTrail(trail) {
    if (!trail) return null;
    return {
      closureId: trail.closureId,
      closureLabel: trail.closureLabel,
      cableRoleLabel: trail.cableRoleLabel || 'S-CABLE',
      cableName: trail.cableName || '',
      drops: Array.isArray(trail.drops)
        ? trail.drops.map(function (d) {
          return { id: d.id, label: d.label };
        })
        : [],
      nodeIds: Array.isArray(trail.nodeIds) ? trail.nodeIds.slice() : [],
    };
  }

  var ACTIVE_PATH_SEP = ' --> ';

  function formatMainCableTrailLabel(trail) {
    if (b()?.formatMainCableTrailLabelForDisplay) return b().formatMainCableTrailLabelForDisplay(trail, sim()?.penDraft?.continueFromCable?.id);
    if (!trail || !trail.cabinetLabel) return '';
    var cableDes = String(trail.cableName || '').trim();
    var head = cableDes
      ? (String(trail.cabinetLabel) + ' ' + cableDes + ' M-Cable')
      : (String(trail.cabinetLabel) + ' M-Cable');
    var parts = [head];
    (trail.closures || []).forEach(function (c) {
      if (c && c.label) parts.push(String(c.label));
    });
    /* Direct Cabinet→Pole (no closure): append FH/pole chain */
    if (!(trail.closures || []).length) {
      (trail.drops || []).forEach(function (d) {
        if (d && d.label) parts.push(String(d.label));
      });
    }
    return parts.join(ACTIVE_PATH_SEP);
  }

  /**
   * Sub-Cable Active Path: `C3 12F3 S-Cable --> FH45 --> FH46 --> FH47`
   */
  function formatSubCableTrailLabel(trail) {
    if (!trail || !trail.closureLabel) return '';
    var cableDes = String(trail.cableName || '').trim();
    var head = cableDes
      ? (String(trail.closureLabel) + ' ' + cableDes + ' S-Cable')
      : (String(trail.closureLabel) + ' S-Cable');
    var parts = [head];
    (trail.drops || []).forEach(function (d) {
      if (d && d.label) parts.push(String(d.label));
    });
    return parts.join(ACTIVE_PATH_SEP);
  }

  /** Project a map point onto the draft polyline → { d2, along } path distance. */
  function projectPointOntoDraftPath(px, py, pts) {
    var best = { d2: Infinity, along: 0 };
    if (!pts || !pts.length) return best;
    if (pts.length === 1 && pts[0]) {
      var sx = px - pts[0][0];
      var sy = py - pts[0][1];
      return { d2: sx * sx + sy * sy, along: 0 };
    }
    var acc = 0;
    var i;
    for (i = 0; i < pts.length - 1; i++) {
      var a = pts[i];
      var b = pts[i + 1];
      if (!a || !b) continue;
      var dx = b[0] - a[0];
      var dy = b[1] - a[1];
      var len2 = dx * dx + dy * dy;
      var len = Math.sqrt(len2) || 0;
      var t = len2 < 1e-9 ? 0 : ((px - a[0]) * dx + (py - a[1]) * dy) / len2;
      if (t < 0) t = 0;
      if (t > 1) t = 1;
      var qx = a[0] + t * dx;
      var qy = a[1] + t * dy;
      var rx = px - qx;
      var ry = py - qy;
      var d2 = rx * rx + ry * ry;
      if (d2 < best.d2) {
        best.d2 = d2;
        best.along = acc + t * len;
      }
      acc += len;
    }
    return best;
  }

  /**
   * Collect every FH/pole along the drawn sub-cable route (snap ids + segment proximity),
   * ordered by distance along the path — does not truncate the chain.
   */
  function collectSubCableDropsAlongDraft(draft) {
    var trail = draft && draft.subCableTrail;
    if (!trail || trail.closureId == null) return [];
    var closureId = String(trail.closureId);
    var seen = Object.create(null);
    var ranked = [];

    function consider(node, along) {
      if (!node || !isSubCableDropTargetNode(node)) return;
      var id = String(node.id);
      if (id === closureId || seen[id]) return;
      seen[id] = true;
      ranked.push({
        id: id,
        label: getSubCableDropLabel(node),
        along: isFinite(along) ? along : ranked.length,
      });
    }

    var pts = draft.points || [];
    var snapIds = draft.pointSnapNodeIds || [];
    var labels = draft.snapLabels || [];
    var i;
    for (i = 0; i < Math.max(snapIds.length, pts.length); i++) {
      var alongHint = i;
      if (pts[i] && i > 0) {
        var acc = 0;
        var k;
        for (k = 0; k < i && k < pts.length - 1; k++) {
          if (pts[k] && pts[k + 1]) {
            acc += Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]);
          }
        }
        alongHint = acc;
      }
      if (snapIds[i]) {
        consider(findSimNodeById(snapIds[i]), alongHint);
      } else if (labels[i]) {
        var byLabel = null;
        if (typeof b()?.resolveNodeBySnapLabel === 'function') {
          byLabel = b().resolveNodeBySnapLabel(labels[i]);
        } else if (typeof b()?.findNodeBySnapLabel === 'function') {
          byLabel = b().findNodeBySnapLabel(labels[i]);
        }
        if (byLabel) consider(byLabel, alongHint);
      }
    }

    /* Segment proximity: every FH/pole the continuous route passes near */
    var proxTol = Math.max(1.35, MAX_SNAP_MAP_UNITS);
    var proxTolSq = proxTol * proxTol;
    (sim()?.nodes || []).forEach(function (node) {
      if (!isSubCableDropTargetNode(node) || String(node.id) === closureId) return;
      if (seen[String(node.id)]) return;
      var center = getDeviceSnapCenter(node);
      if (!center) return;
      var proj = projectPointOntoDraftPath(center.x, center.y, pts);
      if (proj.d2 <= proxTolSq) consider(node, proj.along);
    });

    ranked.sort(function (a, b) {
      if (a.along !== b.along) return a.along - b.along;
      return String(a.label).localeCompare(String(b.label), undefined, { numeric: true });
    });

    return ranked.map(function (r) {
      return { id: r.id, label: r.label };
    });
  }

  /**
   * Rebuild sub-cable drop chain from the full draft route.
   * Returns { grew, newest } when new poles were captured.
   */
  function syncSubCableTrailFromDraft(draft) {
    if (!draft || !isSubCableTrailActive(draft)) {
      return { grew: false, newest: null };
    }
    var trail = draft.subCableTrail;
    if (draft.cableName) trail.cableName = draft.cableName;
    var prevLen = (trail.drops || []).length;
    var prevTail = prevLen ? String(trail.drops[prevLen - 1].id) : '';
    var drops = collectSubCableDropsAlongDraft(draft);
    trail.drops = drops;
    trail.nodeIds = [String(trail.closureId)].concat(drops.map(function (d) {
      return String(d.id);
    }));
    var S = sim();
    if (S) S.subCableTrail = trail;
    var grew = drops.length > prevLen;
    var newest = null;
    if (grew && drops.length) {
      newest = drops[drops.length - 1];
      /* If multiple new poles appeared at once, flash the latest */
      if (prevTail && newest && String(newest.id) === prevTail && drops.length > 1) {
        newest = drops[drops.length - 1];
      }
    }
    return { grew: grew, newest: newest, drops: drops };
  }

  /**
   * Direct Cabinet→Pole: collect FH/poles along a Main trail that has no closures.
   */
  function isMainCableDirectDropMode(draft) {
    var trail = draft && draft.mainCableTrail;
    return !!(isMainCableTrailActive(draft) && trail && !(trail.closures || []).length);
  }

  function collectMainCableDirectDropsAlongDraft(draft) {
    var trail = draft && draft.mainCableTrail;
    if (!trail || trail.cabinetId == null) return [];
    if ((trail.closures || []).length) return [];
    var cabinetId = String(trail.cabinetId);
    var seen = Object.create(null);
    var ranked = [];

    function consider(node, along) {
      if (!node || !isSubCableDropTargetNode(node)) return;
      var id = String(node.id);
      if (id === cabinetId || seen[id]) return;
      seen[id] = true;
      ranked.push({
        id: id,
        label: getSubCableDropLabel(node),
        along: isFinite(along) ? along : ranked.length,
      });
    }

    var pts = draft.points || [];
    var snapIds = draft.pointSnapNodeIds || [];
    var labels = draft.snapLabels || [];
    var i;
    for (i = 0; i < Math.max(snapIds.length, pts.length); i++) {
      var alongHint = i;
      if (pts[i] && i > 0) {
        var acc = 0;
        var k;
        for (k = 0; k < i && k < pts.length - 1; k++) {
          if (pts[k] && pts[k + 1]) {
            acc += Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]);
          }
        }
        alongHint = acc;
      }
      if (snapIds[i]) {
        consider(findSimNodeById(snapIds[i]), alongHint);
      } else if (labels[i]) {
        var byLabel = null;
        if (typeof b()?.resolveNodeBySnapLabel === 'function') {
          byLabel = b().resolveNodeBySnapLabel(labels[i]);
        } else if (typeof b()?.findNodeBySnapLabel === 'function') {
          byLabel = b().findNodeBySnapLabel(labels[i]);
        }
        if (byLabel) consider(byLabel, alongHint);
      }
    }

    var proxTol = Math.max(1.35, MAX_SNAP_MAP_UNITS);
    var proxTolSq = proxTol * proxTol;
    (sim()?.nodes || []).forEach(function (node) {
      if (!isSubCableDropTargetNode(node) || String(node.id) === cabinetId) return;
      if (seen[String(node.id)]) return;
      var center = getDeviceSnapCenter(node);
      if (!center) return;
      var proj = projectPointOntoDraftPath(center.x, center.y, pts);
      if (proj.d2 <= proxTolSq) consider(node, proj.along);
    });

    ranked.sort(function (a, b) {
      if (a.along !== b.along) return a.along - b.along;
      return String(a.label).localeCompare(String(b.label), undefined, { numeric: true });
    });

    return ranked.map(function (r) {
      return { id: r.id, label: r.label };
    });
  }

  function syncMainCableDirectDropsFromDraft(draft) {
    if (!draft || !isMainCableDirectDropMode(draft)) {
      return { grew: false, newest: null };
    }
    var trail = draft.mainCableTrail;
    if (draft.cableName) trail.cableName = draft.cableName;
    var prevLen = (trail.drops || []).length;
    var drops = collectMainCableDirectDropsAlongDraft(draft);
    trail.drops = drops;
    trail.nodeIds = [String(trail.cabinetId)].concat(drops.map(function (d) {
      return String(d.id);
    }));
    var S = sim();
    if (S) S.mainCableTrail = trail;
    var grew = drops.length > prevLen;
    var newest = grew && drops.length ? drops[drops.length - 1] : null;
    return { grew: grew, newest: newest, drops: drops };
  }

  function flashMainCableDirectDropConfirm(dropEntry, draft) {
    if (!dropEntry) return;
    var S = sim();
    if (!S) return;
    var node = findSimNodeById(dropEntry.id);
    var center = node ? getDeviceSnapCenter(node) : null;
    pinInteractiveConfirmOrigin(node, center
      ? { x: center.x, y: center.y }
      : { x: 0, y: 0 });
    S.subCableDropConfirmUntil = Date.now() + SUB_CABLE_CONFIRM_MS;
    S.subCableDropConfirmMsg = 'Drop ' + dropEntry.label + ' linked';
    syncActiveCableTrailStatusHint();
    b()?.updateStatus?.(
      'Drop ' + dropEntry.label + ' linked · ' +
      formatMainCableTrailLabel((draft && draft.mainCableTrail) || S.mainCableTrail)
    );

    if (subCableDropConfirmTimer) clearTimeout(subCableDropConfirmTimer);
    subCableDropConfirmTimer = setTimeout(function () {
      subCableDropConfirmTimer = null;
      var live = sim();
      if (!live) return;
      if (live.subCableDropConfirmUntil && Date.now() >= live.subCableDropConfirmUntil) {
        live.subCableDropConfirmUntil = 0;
        live.subCableDropConfirmMsg = null;
        if (!live.mainCableStartConfirmUntil && !live.mainCableCheckpointConfirmUntil &&
            !live.subCableStartConfirmUntil) {
          live.mainCableConfirmOrigin = null;
        }
        syncActiveCableTrailStatusHint();
      }
      flushPenCursorVisuals();
    }, SUB_CABLE_CONFIRM_MS + 40);
    flushPenCursorVisuals();
  }

  function signalMainCableDirectDropConfirmed(resolved) {
    var S = sim();
    if (!S) return false;
    var draft = S.penDraft;
    if (!isMainCableDirectDropMode(draft)) return false;

    var drop = resolveSubDropFromSnap(resolved);
    if (drop && draft.pointSnapNodeIds && draft.pointSnapNodeIds.length) {
      var lastIdx = draft.pointSnapNodeIds.length - 1;
      if (!draft.pointSnapNodeIds[lastIdx]) {
        draft.pointSnapNodeIds[lastIdx] = drop.id;
      }
      if (draft.snapLabels && !draft.snapLabels[lastIdx]) {
        draft.snapLabels[lastIdx] = getSubCableDropLabel(drop);
      }
    }

    var sync = syncMainCableDirectDropsFromDraft(draft);
    if (sync.grew && sync.newest) {
      flashMainCableDirectDropConfirm(sync.newest, draft);
      return true;
    }
    syncActiveCableTrailStatusHint();
    return !!drop;
  }

  function flashSubCableDropConfirm(dropEntry, draft) {
    if (!dropEntry) return;
    var S = sim();
    if (!S) return;
    var node = findSimNodeById(dropEntry.id);
    var center = node ? getDeviceSnapCenter(node) : null;
    pinInteractiveConfirmOrigin(node, center
      ? { x: center.x, y: center.y }
      : { x: 0, y: 0 });
    S.subCableDropConfirmUntil = Date.now() + SUB_CABLE_CONFIRM_MS;
    S.subCableDropConfirmMsg = 'Drop ' + dropEntry.label + ' linked';
    syncActiveCableTrailStatusHint();
    b()?.updateStatus?.(
      'Drop ' + dropEntry.label + ' linked · ' +
      formatSubCableTrailLabel((draft && draft.subCableTrail) || S.subCableTrail)
    );

    if (subCableDropConfirmTimer) clearTimeout(subCableDropConfirmTimer);
    subCableDropConfirmTimer = setTimeout(function () {
      subCableDropConfirmTimer = null;
      var live = sim();
      if (!live) return;
      if (live.subCableDropConfirmUntil && Date.now() >= live.subCableDropConfirmUntil) {
        live.subCableDropConfirmUntil = 0;
        live.subCableDropConfirmMsg = null;
        if (!live.mainCableStartConfirmUntil && !live.mainCableCheckpointConfirmUntil &&
            !live.subCableStartConfirmUntil) {
          live.mainCableConfirmOrigin = null;
        }
        syncActiveCableTrailStatusHint();
      }
      flushPenCursorVisuals();
    }, SUB_CABLE_CONFIRM_MS + 40);
    flushPenCursorVisuals();
  }

  function syncActiveCableTrailStatusHint() {
    var S = sim();
    var draft = S?.penDraft;
    /* During interactive draw: status shows ONLY the path string (no "Active Path" prefix). */
    if (isSubCableTrailActive(draft)) {
      var subLabel = formatSubCableTrailLabel((draft && draft.subCableTrail) || S.subCableTrail);
      if (!subLabel) return;
      if (S) S.subCableTrailStatusMsg = subLabel;
      b()?.setPushHint?.(subLabel, { interactivePath: true });
      return;
    }
    if (isMainCableTrailActive(draft)) {
      var mainLabel = formatMainCableTrailLabel((draft && draft.mainCableTrail) || S.mainCableTrail);
      if (!mainLabel) return;
      if (S) S.mainCableTrailStatusMsg = mainLabel;
      b()?.setPushHint?.(mainLabel, { interactivePath: true });
    }
  }

  function syncMainCableTrailStatusHint() {
    syncActiveCableTrailStatusHint();
  }

  function ensureMainCableTrailFromCabinet(cabinet, draft) {
    if (!cabinet || !draft) return null;
    var cabinetLabel = b()?.getNodeAsBuiltCode?.(cabinet) ||
      nodeDisplayName(cabinet) ||
      'Cabinet';
    var cableName = draft.cableName ||
      b()?.resolveActiveToolboxCableLabel?.(draft.kind) ||
      b()?.formatCableLabel?.(draft.capacity, draft.batch || 1) ||
      '';
    var trail = {
      cabinetId: String(cabinet.id),
      cabinetLabel: cabinetLabel,
      cableRoleLabel: 'M-CABLE',
      cableName: cableName,
      closures: [],
      drops: [],
      nodeIds: [String(cabinet.id)],
    };
    draft.mainCableTrail = trail;
    draft.subCableTrail = null;
    var S = sim();
    if (S) {
      S.mainCableTrail = trail;
      S.subCableTrail = null;
    }
    return trail;
  }

  function ensureSubCableTrailFromClosure(closure, draft) {
    if (!closure || !draft) return null;
    var closureLabel = getClosureCheckpointLabel(closure);
    var cableName = draft.cableName ||
      b()?.resolveActiveToolboxCableLabel?.(draft.kind) ||
      b()?.formatCableLabel?.(draft.capacity, draft.batch || 1) ||
      '';
    var trail = {
      closureId: String(closure.id),
      closureLabel: closureLabel,
      cableRoleLabel: 'S-CABLE',
      cableName: cableName,
      drops: [],
      nodeIds: [String(closure.id)],
    };
    draft.subCableTrail = trail;
    draft.mainCableTrail = null;
    var S = sim();
    if (S) {
      S.subCableTrail = trail;
      S.mainCableTrail = null;
    }
    return trail;
  }

  function getCableInteractiveCursorPhase() {
    var S = sim();
    if (!S || S.pen?.lineMode !== 'cable' || !b()?.canPenDraw?.()) return null;
    if (S.mainCableStartConfirmUntil && Date.now() < S.mainCableStartConfirmUntil) {
      return 'main-confirm';
    }
    if (S.mainCableCheckpointConfirmUntil && Date.now() < S.mainCableCheckpointConfirmUntil) {
      return 'main-closure-confirm';
    }
    if (S.subCableStartConfirmUntil && Date.now() < S.subCableStartConfirmUntil) {
      return 'sub-confirm';
    }
    if (S.subCableDropConfirmUntil && Date.now() < S.subCableDropConfirmUntil) {
      return 'sub-drop-confirm';
    }
    if (S.crosshair?.cabinetHover) return 'main-cabinet-hover';
    if (S.crosshair?.mainClosureHover) return 'main-closure-hover';
    if (S.crosshair?.subClosureHover) return 'sub-closure-hover';
    if (S.crosshair?.subDropHover) return 'sub-drop-hover';
    return null;
  }

  /** @deprecated alias for Phase 1–2 call sites */
  function getMainCableCursorPhase() {
    var phase = getCableInteractiveCursorPhase();
    if (phase === 'main-confirm') return 'confirm';
    if (phase === 'main-closure-confirm') return 'closure-confirm';
    if (phase === 'main-cabinet-hover') return 'hover';
    if (phase === 'main-closure-hover') return 'closure-hover';
    if (phase === 'sub-confirm' || phase === 'sub-drop-confirm') return 'closure-confirm';
    if (phase === 'sub-closure-hover') return 'sub-closure-hover';
    if (phase === 'sub-drop-hover') return 'sub-drop-hover';
    return null;
  }

  function clearMainCableCheckpointConfirm(restoreHint) {
    if (mainCableCheckpointTimer) {
      clearTimeout(mainCableCheckpointTimer);
      mainCableCheckpointTimer = null;
    }
    var S = sim();
    if (!S) return;
    S.mainCableCheckpointConfirmUntil = 0;
    S.mainCableCheckpointConfirmMsg = null;
    if (restoreHint) syncActiveCableTrailStatusHint();
  }

  function clearMainCableStartConfirm(restoreHint) {
    var S = sim();
    if (mainCableConfirmTimer) {
      clearTimeout(mainCableConfirmTimer);
      mainCableConfirmTimer = null;
    }
    if (!S) return;
    S.mainCableStartConfirmUntil = 0;
    S.mainCableStartConfirmMsg = null;
    S.mainCableStartConfirmCabinet = null;
    if (!S.mainCableCheckpointConfirmUntil && !S.subCableStartConfirmUntil &&
        !S.subCableDropConfirmUntil) {
      S.mainCableConfirmOrigin = null;
    }
    if (restoreHint) {
      if (isMainCableTrailActive(S.penDraft) || isSubCableTrailActive(S.penDraft)) {
        syncActiveCableTrailStatusHint();
      } else {
        b()?.setPushHint?.(b()?.getActivePathStatusLabel?.() || 'Active Path · ...');
      }
    }
  }

  function clearSubCableConfirms(restoreHint) {
    if (subCableStartConfirmTimer) {
      clearTimeout(subCableStartConfirmTimer);
      subCableStartConfirmTimer = null;
    }
    if (subCableDropConfirmTimer) {
      clearTimeout(subCableDropConfirmTimer);
      subCableDropConfirmTimer = null;
    }
    var S = sim();
    if (!S) return;
    S.subCableStartConfirmUntil = 0;
    S.subCableStartConfirmMsg = null;
    S.subCableDropConfirmUntil = 0;
    S.subCableDropConfirmMsg = null;
    if (!S.mainCableStartConfirmUntil && !S.mainCableCheckpointConfirmUntil) {
      S.mainCableConfirmOrigin = null;
    }
    if (restoreHint) syncActiveCableTrailStatusHint();
  }

  function clearCableInteractiveVisualSession() {
    clearMainCableStartConfirm(false);
    clearMainCableCheckpointConfirm(false);
    clearSubCableConfirms(false);
    var S = sim();
    if (!S) return;
    S.mainCableTrail = null;
    S.mainCableTrailStatusMsg = null;
    S.subCableTrail = null;
    S.subCableTrailStatusMsg = null;
    S.mainCableConfirmOrigin = null;
    if (S.penDraft) {
      S.penDraft.mainCableTrail = null;
      S.penDraft.subCableTrail = null;
    }
    if (S.crosshair) {
      S.crosshair.cabinetHover = false;
      S.crosshair.mainClosureHover = false;
      S.crosshair.subClosureHover = false;
      S.crosshair.subDropHover = false;
      S.crosshair.closureHover = false;
    }
    /* Idle: restore default "Active Path · …" / batch label behavior */
    b()?.setPushHint?.(b()?.getActivePathStatusLabel?.() || 'Active Path · ...', {
      interactivePath: false,
    });
  }

  function clearMainCableVisualSession() {
    clearCableInteractiveVisualSession();
  }

  function pinInteractiveConfirmOrigin(node, resolved) {
    var S = sim();
    if (!S) return;
    var ox = resolved && isFinite(resolved.x) ? resolved.x : 0;
    var oy = resolved && isFinite(resolved.y) ? resolved.y : 0;
    var center = node ? getDeviceSnapCenter(node) : null;
    if (center) {
      ox = center.x;
      oy = center.y;
    }
    S.mainCableConfirmOrigin = { x: ox, y: oy };
    S.crosshair = S.crosshair || {};
    S.crosshair.cabinetHover = false;
    S.crosshair.mainClosureHover = false;
    S.crosshair.subClosureHover = false;
    S.crosshair.subDropHover = false;
    S.crosshair.closureHover = false;
    S.crosshair.visible = true;
    S.crosshair.snapped = true;
    S.crosshair.snapX = ox;
    S.crosshair.snapY = oy;
    S.crosshair.x = ox;
    S.crosshair.y = oy;
  }

  /**
   * Phase 1 feedback only — does not alter points, snapLabels, or save geometry.
   * Green ring + bottom-bar confirmation when first cable vertex pins a Cabinet/FDT.
   */
  function signalMainCableStartConfirmed(resolved) {
    var cabinet = resolveCabinetNodeFromSnap(resolved);
    if (!cabinet) return false;
    var S = sim();
    if (!S) return false;
    var draft = S.penDraft || ensurePenDraft();
    if (!draft) return false;

    var cabinetName = b()?.getNodeAsBuiltCode?.(cabinet) ||
      nodeDisplayName(cabinet) ||
      'Cabinet';
    ensureMainCableTrailFromCabinet(cabinet, draft);
    /* Active FDT is toolbox-locked — main-cable registration must not switch cabinet. */
    var msg = 'Main Cable successfully registered from ' + cabinetName;

    S.mainCableStartConfirmUntil = Date.now() + MAIN_CABLE_START_CONFIRM_MS;
    S.mainCableStartConfirmMsg = msg;
    S.mainCableStartConfirmCabinet = cabinetName;
    pinInteractiveConfirmOrigin(cabinet, resolved);

    b()?.setPushHint?.(msg, { interactivePath: true });
    b()?.updateStatus?.(msg);

    if (mainCableConfirmTimer) clearTimeout(mainCableConfirmTimer);
    mainCableConfirmTimer = setTimeout(function () {
      mainCableConfirmTimer = null;
      var live = sim();
      if (!live) return;
      if (live.mainCableStartConfirmUntil && Date.now() >= live.mainCableStartConfirmUntil) {
        live.mainCableStartConfirmUntil = 0;
        live.mainCableStartConfirmMsg = null;
        live.mainCableStartConfirmCabinet = null;
        if (!live.mainCableCheckpointConfirmUntil && !live.subCableStartConfirmUntil &&
            !live.subCableDropConfirmUntil) {
          live.mainCableConfirmOrigin = null;
        }
        syncActiveCableTrailStatusHint();
      }
      flushPenCursorVisuals();
    }, MAIN_CABLE_START_CONFIRM_MS + 40);

    flushPenCursorVisuals();
    return true;
  }

  /**
   * Phase 2 feedback only — sequential closure checkpoint on Main Cable trail.
   * Yellow hover is separate; this green-flashes and appends C1/C2… to the path label.
   */
  function signalClosureCheckpointConfirmed(resolved) {
    var closure = resolveClosureCheckpointFromSnap(resolved);
    if (!closure) return false;
    var S = sim();
    if (!S) return false;
    var draft = S.penDraft;
    if (!isMainCableTrailActive(draft)) return false;

    var trail = draft.mainCableTrail;
    var closureId = String(closure.id);
    if ((trail.nodeIds || []).indexOf(closureId) >= 0) return false;
    if ((trail.closures || []).some(function (c) { return String(c.id) === closureId; })) {
      return false;
    }

    var label = getClosureCheckpointLabel(closure);
    trail.closures.push({ id: closureId, label: label });
    trail.nodeIds.push(closureId);
    /* Entering closure mode clears any direct Cabinet→Pole drops */
    trail.drops = [];
    S.mainCableTrail = trail;

    pinInteractiveConfirmOrigin(closure, resolved);
    S.mainCableCheckpointConfirmUntil = Date.now() + MAIN_CABLE_CHECKPOINT_CONFIRM_MS;
    S.mainCableCheckpointConfirmMsg = 'Checkpoint ' + label + ' linked';

    var pathMsg = formatMainCableTrailLabel(trail);
    S.mainCableTrailStatusMsg = pathMsg;
    b()?.setPushHint?.(pathMsg, { interactivePath: true });
    b()?.updateStatus?.('Closure ' + label + ' linked · ' + pathMsg);

    if (mainCableCheckpointTimer) clearTimeout(mainCableCheckpointTimer);
    mainCableCheckpointTimer = setTimeout(function () {
      mainCableCheckpointTimer = null;
      var live = sim();
      if (!live) return;
      if (live.mainCableCheckpointConfirmUntil &&
          Date.now() >= live.mainCableCheckpointConfirmUntil) {
        live.mainCableCheckpointConfirmUntil = 0;
        live.mainCableCheckpointConfirmMsg = null;
        if (!live.mainCableStartConfirmUntil && !live.subCableStartConfirmUntil &&
            !live.subCableDropConfirmUntil) {
          live.mainCableConfirmOrigin = null;
        }
        syncActiveCableTrailStatusHint();
      }
      flushPenCursorVisuals();
    }, MAIN_CABLE_CHECKPOINT_CONFIRM_MS + 40);

    flushPenCursorVisuals();
    return true;
  }

  /**
   * Phase 3: Sub-Cable start at a Closure (sky-blue hover → green confirm).
   * Only when not already on a Main Cable trail.
   */
  function signalSubCableStartConfirmed(resolved) {
    var closure = resolveClosureCheckpointFromSnap(resolved);
    if (!closure) return false;
    var S = sim();
    if (!S) return false;
    var draft = S.penDraft || ensurePenDraft();
    if (!draft || isMainCableTrailActive(draft)) return false;

    ensureSubCableTrailFromClosure(closure, draft);
    /* Active FDT is toolbox-locked — sub-cable registration must not switch cabinet. */
    var label = getClosureCheckpointLabel(closure);
    var msg = 'Sub-Cable successfully registered from ' + label;

    S.subCableStartConfirmUntil = Date.now() + SUB_CABLE_CONFIRM_MS;
    S.subCableStartConfirmMsg = msg;
    pinInteractiveConfirmOrigin(closure, resolved);

    b()?.setPushHint?.(msg, { interactivePath: true });
    b()?.updateStatus?.(msg);

    if (subCableStartConfirmTimer) clearTimeout(subCableStartConfirmTimer);
    subCableStartConfirmTimer = setTimeout(function () {
      subCableStartConfirmTimer = null;
      var live = sim();
      if (!live) return;
      if (live.subCableStartConfirmUntil && Date.now() >= live.subCableStartConfirmUntil) {
        live.subCableStartConfirmUntil = 0;
        live.subCableStartConfirmMsg = null;
        if (!live.mainCableStartConfirmUntil && !live.mainCableCheckpointConfirmUntil &&
            !live.subCableDropConfirmUntil) {
          live.mainCableConfirmOrigin = null;
        }
        syncActiveCableTrailStatusHint();
      }
      flushPenCursorVisuals();
    }, SUB_CABLE_CONFIRM_MS + 40);

    flushPenCursorVisuals();
    return true;
  }

  /**
   * Phase 3: Sub-Cable drop target (FH / pole) linkage — green flash + sequence append.
   * Full chain is rebuilt from the draft route so intermediate poles are never truncated.
   */
  function signalSubCableDropConfirmed(resolved) {
    var S = sim();
    if (!S) return false;
    var draft = S.penDraft;
    if (!isSubCableTrailActive(draft)) return false;

    /* Prefer the snapped drop, then rebuild entire route chain from all vertices */
    var drop = resolveSubDropFromSnap(resolved);
    if (drop && draft.pointSnapNodeIds && draft.pointSnapNodeIds.length) {
      var lastIdx = draft.pointSnapNodeIds.length - 1;
      if (!draft.pointSnapNodeIds[lastIdx]) {
        draft.pointSnapNodeIds[lastIdx] = drop.id;
      }
      if (draft.snapLabels && !draft.snapLabels[lastIdx]) {
        draft.snapLabels[lastIdx] = getSubCableDropLabel(drop);
      }
    }

    var sync = syncSubCableTrailFromDraft(draft);
    if (sync.grew && sync.newest) {
      flashSubCableDropConfirm(sync.newest, draft);
      return true;
    }
    /* Even without growth, keep Active Path naming up to date (cable designator, etc.) */
    syncActiveCableTrailStatusHint();
    return !!drop;
  }

  function pickCableDeviceSnapOnClick(clientX, clientY) {
    if (clientX == null || clientY == null) return null;
    var trenchSnapSq = getCableEffectiveSnapRadiusSq();
    var handholeSnapSq = Math.max(trenchSnapSq, 28 * 28);
    var bestNode = null;
    var bestDistSq = Infinity;
    (sim()?.nodes || []).forEach(function (node) {
      if (!node) return;
      if (node.type !== 'fdt' && node.type !== 'pole_foundation' &&
          node.type !== 'handhole' && node.type !== 'fat_handhole') return;
      var center = getDeviceSnapCenter(node);
      if (!center) return;
      var d2 = screenDistSqToDevice(node, clientX, clientY);
      var limitSq = (node.type === 'handhole' || node.type === 'fat_handhole')
        ? handholeSnapSq
        : trenchSnapSq;
      if (d2 <= limitSq && d2 < bestDistSq) {
        bestDistSq = d2;
        bestNode = { node: node, center: center };
      }
    });
    if (!bestNode) return null;
    return buildCableDeviceSnapHit(bestNode.node, bestNode.center);
  }

  function mergeCableHitWithDevice(trenchHit, deviceHit) {
    if (!deviceHit) return trenchHit || null;
    if (!trenchHit) return deviceHit;
    var preferDevice = deviceHit.snapKind === 'handhole' || deviceHit.snapKind === 'device';
    return {
      x: preferDevice ? deviceHit.x : trenchHit.x,
      y: preferDevice ? deviceHit.y : trenchHit.y,
      snapKind: deviceHit.snapKind || trenchHit.snapKind,
      snapLabel: deviceHit.snapLabel || trenchHit.snapLabel || null,
      snapNodeId: deviceHit.snapNodeId || trenchHit.snapNodeId || null,
      target: Object.assign({}, trenchHit.target || {}, deviceHit.target || {}, {
        nodeId: deviceHit.snapNodeId || trenchHit.target?.nodeId || null,
        label: deviceHit.snapLabel || trenchHit.target?.label || null,
        snapKind: deviceHit.snapKind || trenchHit.target?.snapKind || trenchHit.snapKind,
        kind: trenchHit.target?.kind || trenchHit.snapKind || 'trench-segment',
        x: preferDevice ? deviceHit.x : (trenchHit.target?.x ?? trenchHit.x),
        y: preferDevice ? deviceHit.y : (trenchHit.target?.y ?? trenchHit.y),
      }),
    };
  }

  function buildCableResolvedFromSnapHit(hit) {
    if (!hit) return null;
    return {
      x: hit.x,
      y: hit.y,
      snapped: true,
      snapLabel: hit.snapLabel || hit.target?.label || null,
      snapNodeId: hit.snapNodeId || hit.target?.nodeId || null,
      snapTarget: hit.target || null,
      snapKind: hit.snapKind || hit.target?.kind || null,
    };
  }

  function getCableCommittedPoint(resolved, e) {
    if (!resolved) return null;
    var nodeId = resolved.snapNodeId || resolved.snapTarget?.nodeId;
    var isHandhole = resolved.snapKind === 'handhole' || resolved.snapTarget?.kind === 'handhole';
    var isDevice = resolved.snapKind === 'device' || resolved.snapTarget?.kind === 'device';
    if (nodeId && (isHandhole || isDevice)) {
      var node = findSimNodeById(nodeId);
      var center = node ? getDeviceSnapCenter(node) : null;
      if (center) {
        return [Math.round(center.x * 10) / 10, Math.round(center.y * 10) / 10];
      }
    }
    var strictPt = b()?.snapCableWaypointToTrench?.(
      resolved.x, resolved.y, resolved.snapTarget, e?.clientX, e?.clientY
    );
    if (strictPt) return strictPt;
    return [Math.round(resolved.x * 10) / 10, Math.round(resolved.y * 10) / 10];
  }

  function triggerPenClickPulse() {
    var S = sim();
    if (!S) return;
    S.penClickPulseUntil = Date.now() + PEN_CLICK_PULSE_MS;
    S.penClickPulseOrigin = {
      x: S.crosshair?.snapped ? S.crosshair.snapX : S.crosshair?.x,
      y: S.crosshair?.snapped ? S.crosshair.snapY : S.crosshair?.y,
    };
    flushPenCursorVisuals();
    if (penClickPulseTimer) clearTimeout(penClickPulseTimer);
    penClickPulseTimer = setTimeout(function () {
      penClickPulseTimer = null;
      if (S.penClickPulseUntil && Date.now() >= S.penClickPulseUntil) {
        S.penClickPulseUntil = 0;
        S.penClickPulseOrigin = null;
      }
      flushPenCursorVisuals();
    }, PEN_CLICK_PULSE_MS + 24);
  }

  function confirmPenVertexPlaced(resolved) {
    var S = sim();
    if (!S) return;
    if (resolved && isFinite(resolved.x) && isFinite(resolved.y)) {
      if (!S.crosshair) S.crosshair = {};
      S.crosshair.x = resolved.x;
      S.crosshair.y = resolved.y;
      S.crosshair.snapX = resolved.x;
      S.crosshair.snapY = resolved.y;
      S.crosshair.snapped = !!resolved.snapped;
      S.crosshair.visible = true;
    }
    triggerPenClickPulse();
  }

  function getPenDraftPolylinePoints(S) {
    if (!S?.penDraft?.points?.length) return [];
    var draft = S.penDraft;
    var committed = draft.points.map(function (p) { return [p[0], p[1]]; });
    var preview = penPreviewCursorXY(S);
    if (!preview || !isFinite(preview.x) || !isFinite(preview.y)) return committed;

    if (draft.lineMode === 'cable' && committed.length >= 1) {
      var manual = committed.slice();
      manual.push([preview.x, preview.y]);
      return manual.length >= 2 ? manual : committed;
    }

    committed.push([preview.x, preview.y]);
    return committed;
  }

  function resolveCableTrenchTrackSnap(e, xy) {
    if (e?.clientX == null || e?.clientY == null) return null;
    var draft = sim()?.penDraft;
    var preferTrenchId = draft?.trenchPathId || draft?.hostTrenchId || null;
    var hit = b()?.findCableTrenchPathGuideSnap?.(
      e.clientX,
      e.clientY,
      xy?.x,
      xy?.y,
      preferTrenchId
    );
    if (!hit) return null;
    return { x: hit.x, y: hit.y, target: hit.target || hit };
  }

  function formatCableTrenchSnapHit(trench) {
    if (!trench) return null;
    var target = trench.target || trench;
    return {
      x: trench.x,
      y: trench.y,
      snapKind: target.snapKind || target.kind || 'trench-segment',
      snapLabel: target.label || null,
      snapNodeId: null,
      target: target,
    };
  }

  /** Preview guide: trench path hit-test only (vertices → segment). No auto vertices. */
  function resolveCableGuidedSnap(e, xy) {
    if (e?.clientX == null || e?.clientY == null) return null;
    var draft = sim()?.penDraft;
    var preferTrenchId = draft?.trenchPathId || draft?.hostTrenchId || null;
    return b()?.findCableTrenchPathGuideSnap?.(
      e.clientX, e.clientY, xy?.x, xy?.y, preferTrenchId
    ) || null;
  }

  function resolveCableTrenchHover(e, xy) {
    return resolveCableTrenchTrackSnap(e, xy);
  }

  function penPointsToD(points) {
    if (!points || points.length < 2) return '';
    var d = 'M' + snapPixel(points[0][0]) + ' ' + snapPixel(points[0][1]);
    for (var i = 1; i < points.length; i++) {
      d += ' L' + snapPixel(points[i][0]) + ' ' + snapPixel(points[i][1]);
    }
    return d;
  }

  function patchPenDraftLivePath(svg) {
    if (!svg || !b()?.canPenDraw?.()) {
      hideSvgEl(svg, 'pen-draft-live-path');
      return;
    }
    var S = sim();
    var pts = getPenDraftPolylinePoints(S);
    if (pts.length < 2) {
      hideSvgEl(svg, 'pen-draft-live-path');
      return;
    }
    var draft = S?.penDraft;
    var strokeSpec = draft?.lineMode === 'cable'
      ? { color: '#2563eb', width: '1.15', dash: '' }
      : (b()?.excavationStrokeForKind?.(draft.kind) || { color: '#78716c', width: '2.5', dash: '' });
    var path = svg.querySelector('#pen-draft-live-path');
    if (!path) {
      path = document.createElementNS(SVG_NS, 'path');
      path.id = 'pen-draft-live-path';
      path.setAttribute('class', 'draw-path draw-path--draft draw-path--draft-live draw-path--cable-live draw-path--unified-cable-core');
      path.setAttribute('fill', 'none');
      path.setAttribute('filter', 'none');
      path.setAttribute('stroke-linecap', 'butt');
      path.setAttribute('stroke-linejoin', 'miter');
      path.setAttribute('pointer-events', 'none');
      mountOverlayEl(svg, path);
    } else {
      mountOverlayEl(svg, path);
    }
    path.setAttribute('d', penPointsToD(pts));
    path.setAttribute('stroke', strokeSpec.color || PEN_RUBBER_COLOR);
    path.setAttribute('stroke-width', strokeSpec.width || '2.5');
    path.setAttribute('opacity', draft?.lineMode === 'cable' ? '1' : '0.92');
    path.style.display = '';
  }

  function flushPenCursorVisuals() {
    var svg = b()?.ensureGlobalDrawingLayer?.();
    if (!svg) return;
    updateLiveRubberLine();
    patchPenDraftLivePath(svg);
    renderCableMagneticSnapIndicator(svg);
    renderCrosshair(svg);
    if (cableContinuePromptLocked && cableContinueOffer) {
      positionCableContinueFab(cableContinueOffer);
    }
  }

  function flushPenDrawingVisuals() {
    var svg = b()?.ensureGlobalDrawingLayer?.();
    if (!svg) return;
    flushPenCursorVisuals();
    renderPenPlacedVertices(svg);
    renderDeviceSnapCenterPoint(svg);
  }

  var penDraftVertexDrag = null;
  var penDraftVertexDragBound = false;
  var PEN_DRAFT_VERTEX_HIT = 4;

  function resolvePenDraftPointerXY(e) {
    var resolved = b()?.resolvePenPointerFromEvent?.(e);
    if (resolved && isFinite(resolved.x) && isFinite(resolved.y)) {
      return { x: resolved.x, y: resolved.y, resolved: resolved };
    }
    var xy = svgCoordsFromEvent(e);
    if (xy && isFinite(xy.x) && isFinite(xy.y)) {
      return { x: xy.x, y: xy.y, resolved: null };
    }
    if (e?.clientX != null && b()?.pointerClientToCanvasXY) {
      var mapped = b().pointerClientToCanvasXY(e.clientX, e.clientY);
      if (mapped) return { x: mapped.x, y: mapped.y, resolved: null };
    }
    return null;
  }

  function pickPenDraftVertexIndex(e) {
    var S = sim();
    var draft = S?.penDraft;
    if (!draft?.points?.length) return -1;
    var ptr = resolvePenDraftPointerXY(e);
    if (!ptr) return -1;
    var best = -1;
    var bestD = PEN_DRAFT_VERTEX_HIT + 1;
    draft.points.forEach(function (pt, i) {
      if (!pt) return;
      var d = Math.hypot(pt[0] - ptr.x, pt[1] - ptr.y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return bestD <= PEN_DRAFT_VERTEX_HIT ? best : -1;
  }

  function syncPenDraftVertexMeta(draft, index, resolved, snap) {
    if (!draft || index == null || index < 0) return;
    if (!draft.pointSnapNodeIds) draft.pointSnapNodeIds = [];
    if (!draft.snapLabels) draft.snapLabels = [];
    while (draft.pointSnapNodeIds.length < draft.points.length) draft.pointSnapNodeIds.push(null);
    while (draft.snapLabels.length < draft.points.length) draft.snapLabels.push(null);
    if (resolved) {
      draft.pointSnapNodeIds[index] = resolved.snapNodeId || resolved.target?.nodeId || null;
      draft.snapLabels[index] = resolved.snapLabel || null;
    } else if (snap) {
      draft.pointSnapNodeIds[index] = snap.snapNodeId || null;
      draft.snapLabels[index] = snap.snapLabel || null;
    }
  }

  function applyPenDraftVertexPosition(draft, index, x, y, meta) {
    if (!draft?.points?.[index]) return;
    draft.points[index] = [x, y];
    syncPenDraftVertexMeta(draft, index, meta?.resolved || null, meta?.snap || null);
    if (index === draft.points.length - 1) {
      draft.cursor = [x, y];
      draft.cursorSnapNodeId = draft.pointSnapNodeIds[index] || null;
    }
    draft.activePathPoints = normalizePathPointsForSave(draft.points);
    draft.vertexRedo = draft.vertexRedo || [];
  }

  function onPenDraftVertexDragMove(e) {
    if (!penDraftVertexDrag || e.pointerId !== penDraftVertexDrag.pointerId) return;
    beginScreenCtmCacheFrame();
    try {
    var S = sim();
    var draft = S?.penDraft;
    if (!draft?.points) return;
    var idx = penDraftVertexDrag.index;
    var ptr = resolvePenDraftPointerXY(e);
    if (!ptr) return;

    if (S?.pen?.lineMode === 'cable') {
      var cableResolved = resolveCablePointClick(e);
      if (!cableResolved) return;
      applyPenDraftVertexPosition(draft, idx, cableResolved.x, cableResolved.y, { resolved: cableResolved });
    } else {
      var snap = getSnappedPosition(e.clientX, e.clientY, ptr.x, ptr.y, { mode: 'pen' });
      var px = isFinite(snap.x) ? snap.x : ptr.x;
      var py = isFinite(snap.y) ? snap.y : ptr.y;
      if (snap.snapped && snap.snapNodeId) {
        var node = findSimNodeById(snap.snapNodeId);
        var center = node ? getDeviceSnapCenter(node) : null;
        if (center) {
          px = center.x;
          py = center.y;
        }
      }
      applyPenDraftVertexPosition(draft, idx, px, py, { snap: snap });
    }

    penDraftVertexDrag.moved = true;
    b()?.renderGlobalDrawingLayer?.();
    flushPenDrawingVisuals();
    e.preventDefault();
    } finally {
      sealScreenCtmCacheFrame();
    }
  }

  function endPenDraftVertexDrag(e) {
    if (!penDraftVertexDrag) return;
    if (e && penDraftVertexDrag.pointerId != null && e.pointerId !== penDraftVertexDrag.pointerId) return;
    if (penDraftVertexDrag.moved) {
      b()?.updateStatus?.('Vertex adjusted while drawing');
    }
    penDraftVertexDrag = null;
    if (e) e.preventDefault();
  }

  function bindPenDraftVertexDragListeners() {
    if (penDraftVertexDragBound) return;
    document.addEventListener('pointermove', onPenDraftVertexDragMove, true);
    document.addEventListener('pointerup', endPenDraftVertexDrag, true);
    document.addEventListener('pointercancel', endPenDraftVertexDrag, true);
    penDraftVertexDragBound = true;
  }

  function beginPenDraftVertexDrag(e, index) {
    var S = sim();
    if (!S?.penDraft?.points?.[index]) return false;
    bindPenDraftVertexDragListeners();
    penDraftVertexDrag = {
      index: index,
      pointerId: e.pointerId,
      moved: false,
    };
    e.preventDefault();
    e.stopPropagation();
    return true;
  }

  function onPenDocumentPointerMove(e) {
    if (penDraftVertexDrag) return;
    if (!b()?.canPenDraw?.()) return;
    if (sim()?.pathEdit?.ghostDragging) return;
    rubberBandPendingEvent = e;
    if (rubberBandRaf) return;
    rubberBandRaf = requestAnimationFrame(function () {
      rubberBandRaf = 0;
      var ev = rubberBandPendingEvent;
      rubberBandPendingEvent = null;
      if (ev) updateRubberBandFromEvent(ev);
    });
  }

  function bindPenDblClickCapture() {
    if (penDblClickCaptureBound) return;
    document.addEventListener('dblclick', onDocumentPenDblClick, true);
    penDblClickCaptureBound = true;
  }

  function unbindPenDblClickCapture() {
    if (!penDblClickCaptureBound) return;
    document.removeEventListener('dblclick', onDocumentPenDblClick, true);
    penDblClickCaptureBound = false;
  }

  function onDocumentPenDblClick(e) {
    if (!b()?.canPenDraw?.() || !sim()?.penDraft) return;
    if (onPenDblClick(e)) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    }
  }

  function bindPenPointerTracking() {
    if (penPointerTrackingAttached) return;
    document.addEventListener('pointermove', onPenDocumentPointerMove, true);
    bindPenDblClickCapture();
    penPointerTrackingAttached = true;
  }

  function cancelRubberBandRaf() {
    if (rubberBandRaf) {
      cancelAnimationFrame(rubberBandRaf);
      rubberBandRaf = 0;
    }
    rubberBandPendingEvent = null;
  }

  function unbindPenPointerTracking() {
    if (!penPointerTrackingAttached) return;
    document.removeEventListener('pointermove', onPenDocumentPointerMove, true);
    unbindPenDblClickCapture();
    penPointerTrackingAttached = false;
    cableFinishingDblClick = false;
    lastPenSnapCache = null;
    cancelRubberBandRaf();
  }

  function syncPenPointerTracking() {
    if (b()?.canPenDraw?.()) {
      bindPenPointerTracking();
      bindPenDblClickCapture();
    } else {
      unbindPenPointerTracking();
    }
  }

  function pointsNear(a, pt, tol) {
    if (!a || !pt) return false;
    return Math.abs(a[0] - pt[0]) <= tol && Math.abs(a[1] - pt[1]) <= tol;
  }

  function ensurePenDraft() {
    var S = sim();
    if (!S || !b()?.isPenToolActive?.()) return null;
    var draftKind = S.pen.lineMode === 'excavation' ? S.pen.excavKind : S.pen.cableKind;
    var activeSession = !!(S.penDraft?.points?.length);
    /* New cable draw start = no committed vertices yet (post-save or fresh arm). */
    var startingNewCableSession = S.pen.lineMode === 'cable' && !activeSession;

    if (S.pen.lineMode === 'cable') {
      S.pen.cableCapacity = b()?.getCableCapacityForKind?.(S.pen.cableKind) || S.pen.cableCapacity;
      if (activeSession && S.penDraft?.lineMode === 'cable') {
        if (!S.penDraft.continueFromCable) {
          S.penDraft.kind = draftKind;
          S.penDraft.capacity = S.pen.cableCapacity;
          S.penDraft.batch = b()?.getCableBatchForKind?.(S.pen.cableKind) || S.penDraft.batch || 1;
          b()?.syncPenDraftCableFromToolbox?.(S.penDraft);
        }
        if (!S.penDraft.pointSnapNodeIds) S.penDraft.pointSnapNodeIds = [];
        if (!S.penDraft.vertexRedo) S.penDraft.vertexRedo = [];
        if (!S.penDraft.trenchPathIds) S.penDraft.trenchPathIds = [];
        return S.penDraft;
      }
    }

    var draftStale = !S.penDraft ||
      S.penDraft.lineMode !== S.pen.lineMode ||
      S.penDraft.kind !== draftKind ||
      (S.pen.lineMode === 'cable' && S.pen.cableCapacity != null &&
        S.penDraft.capacity !== S.pen.cableCapacity);

    if (draftStale) {
      if (activeSession) {
        S.penDraft.lineMode = S.pen.lineMode;
        S.penDraft.kind = draftKind;
        if (S.pen.lineMode === 'cable') {
          S.penDraft.capacity = S.pen.cableCapacity;
        }
      } else {
        var preservedRedo = (S.penDraft && S.penDraft.lineMode === S.pen.lineMode &&
          Array.isArray(S.penDraft.vertexRedo) && S.penDraft.vertexRedo.length)
          ? S.penDraft.vertexRedo.slice()
          : [];
        var cableBatch = S.pen.lineMode === 'cable' ? (b()?.getCableBatchForKind?.(S.pen.cableKind) || 1) : null;
        var cableName = S.pen.lineMode === 'cable'
          ? (b()?.resolveActiveToolboxCableLabel?.(S.pen.cableKind) || null)
          : null;
        S.penDraft = {
          lineMode: S.pen.lineMode,
          kind: draftKind,
          capacity: S.pen.cableCapacity,
          batch: cableBatch,
          cableName: cableName,
          points: [],
          snapLabels: [],
          pointSnapNodeIds: [],
          activePathPoints: [],
          vertexRedo: preservedRedo,
          cursor: null,
          cursorSnapNodeId: null,
          reconnectFrom: null,
          reconnectSnap: null,
          trenchPathId: null,
          hostTrenchId: null,
          trenchPathIds: [],
          trenchSnapLocked: false,
          hoverTrenchSnap: null,
          cornerRadii: {},
          continueFromCable: null,
        };
      }
    }
    if (S.pen.lineMode === 'cable') {
      if (!S.penDraft.continueFromCable) {
        S.penDraft.batch = b()?.getCableBatchForKind?.(S.pen.cableKind) || S.penDraft.batch || 1;
        S.penDraft.capacity = b()?.getCableCapacityForKind?.(S.pen.cableKind) || S.pen.cableCapacity;
        b()?.syncPenDraftCableFromToolbox?.(S.penDraft);
      }
      if (startingNewCableSession && !S.penDraft.continueFromCable) {
        b()?.refreshBatchDuplicationHint?.(S.pen.cableKind || S.penDraft.kind, {
          capacity: S.penDraft.capacity,
          batch: S.penDraft.batch,
        });
      }
    }
    if (!S.penDraft.pointSnapNodeIds) S.penDraft.pointSnapNodeIds = [];
    if (!S.penDraft.vertexRedo) S.penDraft.vertexRedo = [];
    if (!S.penDraft.trenchPathIds) S.penDraft.trenchPathIds = [];
    return S.penDraft;
  }

  function updatePenSnapGlow() { /* glow disabled — QField crosshair shows snap */ }

  function updateReconnectSnapGlow() { /* legacy no-op */ }

  function getPenSnapPathType() {
    var pen = sim()?.pen;
    if (!pen?.lineMode) return null;
    return pen.lineMode === 'cable' ? 'fiber' : 'excavation';
  }

  function isSnappableDeviceNode(node) {
    return !!(node && node.type !== 'pole_foundation');
  }

  function isPathEndpointAvailable(path, vertexIndex) {
    if (!path?.points?.length || path.points.length < 2) return false;
    if (vertexIndex !== 0 && vertexIndex !== path.points.length - 1) return false;
    if (path.freeEnds) return vertexIndex === 0 ? !!path.freeEnds.start : !!path.freeEnds.end;
    var ct = path.connectedTo || {};
    return vertexIndex === 0 ? !ct.start : !ct.end;
  }

  function reconnectEndFromVertexIndex(path, vertexIndex) {
    if (!path?.points?.length || vertexIndex == null) return null;
    if (vertexIndex === 0) return 'start';
    if (vertexIndex === path.points.length - 1) return 'end';
    return null;
  }

  function attachReconnectFromSnapTarget(draft, snapTarget) {
    if (!draft || !snapTarget || snapTarget.pathType == null || snapTarget.pathId == null) return;
    if (snapTarget.vertexIndex == null) return;
    if (snapTarget.kind !== 'path-vertex' && snapTarget.kind !== 'path-endpoint') return;
    draft.reconnectFrom = {
      type: snapTarget.pathType,
      id: snapTarget.pathId,
      vertexIndex: snapTarget.vertexIndex,
      end: reconnectEndFromVertexIndex(
        global.FTTHPathwayEditor?.findPathByRef?.({ type: snapTarget.pathType, id: snapTarget.pathId }),
        snapTarget.vertexIndex
      ),
    };
  }

  function findReconnectEndpoint(x, y, clientX, clientY) {
    if (sim()?.pen?.lineMode === 'cable') return null;
    var editor = global.FTTHPathwayEditor;
    if (editor?.findFreeExcavationEndpointNear) {
      return editor.findFreeExcavationEndpointNear(x, y, clientX, clientY, {
        pathType: getPenSnapPathType(),
        radius: editor.RECONNECT_SNAP_RADIUS || RECONNECT_SNAP_RADIUS,
        freeOnly: true,
      });
    }
    if (editor?.findNearestPathVertex) {
      return editor.findNearestPathVertex(x, y, clientX, clientY, {
        pathType: getPenSnapPathType(),
        radius: SNAP_THRESHOLD,
      });
    }
    if (!editor?.iterateAllPaths) return null;
    var wantType = getPenSnapPathType();
    var best = null;
    var bestMetric = SNAP_THRESHOLD_SQ + 1;
    var useScreen = clientX != null && clientY != null;
    editor.iterateAllPaths(function (type, path) {
      if (wantType && type !== wantType) return;
      var pts = path?.points;
      if (!pts?.length) return;
      for (var i = 0; i < pts.length; i++) {
        var pt = pts[i];
        if (!pt) continue;
        var metric;
        if (useScreen) {
          metric = screenDistSqToCanvasPoint(clientX, clientY, pt[0], pt[1]);
          if (metric > SNAP_THRESHOLD_SQ) continue;
        } else {
          metric = Math.hypot(pt[0] - x, pt[1] - y);
          if (metric > SNAP_THRESHOLD) continue;
          metric = metric * metric;
        }
        if (metric < bestMetric) {
          bestMetric = metric;
          best = {
            type: type,
            id: path.id,
            pt: [pt[0], pt[1]],
            vertexIndex: i,
            end: reconnectEndFromVertexIndex(path, i),
            path: path,
          };
        }
      }
    });
    return best;
  }

  function tryPenReconnect(x, y, clientX, clientY) {
    if (!b()?.canPenDraw?.()) return false;
    if (sim()?.pen?.lineMode === 'cable') return false;
    var draft = ensurePenDraft();
    if (!draft || draft.points.length > 0) return false;
    var snap = findReconnectEndpoint(x, y, clientX, clientY);
    if (!snap) return false;
    draft.points.push(snap.pt.slice());
    draft.snapLabels.push(null);
    draft.reconnectFrom = {
      type: snap.type,
      id: snap.id,
      vertexIndex: snap.vertexIndex,
      end: snap.end || null,
    };
    draft.cursor = snap.pt.slice();
    draft.vertexRedo.length = 0;
    b()?.syncPenModeClass?.();
    b()?.renderGlobalDrawingLayer?.();
    confirmPenVertexPlaced({ x: snap.pt[0], y: snap.pt[1], snapped: true });
    var vtxLabel = snap.vertexIndex != null ? 'vertex ' + (snap.vertexIndex + 1) : 'path end';
    b()?.updateStatus?.('Re-connected at path end — draw triangle base · double-click to save new trench ID');
    return true;
  }

  function isDeviceNodeSnap(commit) {
    return !!(commit && commit.snapNodeId);
  }

  function getPenDraftTemplate(draft) {
    return {
      lineMode: draft.lineMode,
      kind: draft.kind,
      capacity: draft.capacity,
      batch: draft.batch,
      cableName: draft.cableName,
    };
  }

  function restartPenDraftAtNode(commit, template) {
    var S = sim();
    if (!S || !commit) return null;
    var startPt = commit.pt.slice();
    S.penDraft = {
      lineMode: template.lineMode,
      kind: template.kind,
      capacity: template.capacity,
      batch: template.batch,
      cableName: template.cableName,
      points: [startPt],
      snapLabels: [commit.snapLabel || null],
      pointSnapNodeIds: [commit.snapNodeId || null],
      activePathPoints: normalizePathPointsForSave([startPt]),
      vertexRedo: [],
      cursor: startPt.slice(),
      cursorSnapNodeId: commit.snapNodeId || null,
      reconnectFrom: null,
      reconnectSnap: null,
    };
    return S.penDraft;
  }

  function ensurePenMergeReconnectTargets(draft) {
    if (!draft?.reconnectFrom || draft.lineMode === 'cable') return;
    if (draft.reconnectTo?.vertexIndex != null && draft.reconnectTo?.id) return;
    var editor = global.FTTHPathwayEditor;
    if (!editor || !draft.points?.length) return;

    var last = draft.points[draft.points.length - 1];
    var cross = editor.inferReconnectTargetAnyExcavation?.(last, draft.reconnectFrom);
    if (cross) {
      draft.reconnectTo = cross;
      return;
    }

    var path = editor.findPathByRef?.({ type: draft.reconnectFrom.type, id: draft.reconnectFrom.id });
    if (!path || !editor.inferReconnectToVertex) return;
    var vi = editor.inferReconnectToVertex(path, draft.points, draft.reconnectFrom.vertexIndex);
    if (vi != null) {
      draft.reconnectTo = {
        type: draft.reconnectFrom.type,
        id: draft.reconnectFrom.id,
        vertexIndex: vi,
      };
    }
  }

  function persistPenDraftToPaths(draft, opts) {
    opts = opts || {};
    var S = sim();
    if (!S || !draft || draft.lineMode === 'cable') return null;
    if (opts.trimDblClick) trimDblClickFinishArtifact(draft);
    draft.activePathPoints = normalizePathPointsForSave(draft.points);
    var merging = !!(draft.reconnectFrom && !opts.skipReconnect);
    var pointsToSave = merging
      ? clonePathPointsForMerge(draft.activePathPoints || draft.points)
      : clonePathPointsForSave(draft.activePathPoints || draft.points);
    if (!pointsToSave || pointsToSave.length < 2) return null;

    var snapLabels = (draft.snapLabels || []).slice(0, pointsToSave.length);
    while (snapLabels.length < pointsToSave.length) snapLabels.push(null);
    var pointSnapNodeIds = (draft.pointSnapNodeIds || []).slice(0, pointsToSave.length);
    while (pointSnapNodeIds.length < pointsToSave.length) pointSnapNodeIds.push(null);
    var connectedTo = buildPathConnectedTo(snapLabels);
    var editor = global.FTTHPathwayEditor;
    var createdRef = null;

    if (!opts.skipReconnect && draft.reconnectFrom && editor?.mergeReconnect) {
      ensurePenMergeReconnectTargets(draft);
      var mergeResult = editor.mergeReconnect({
        lineMode: draft.lineMode,
        kind: draft.kind,
        capacity: draft.capacity,
        points: pointsToSave,
        snapLabels: snapLabels,
        pointSnapNodeIds: pointSnapNodeIds,
        reconnectFrom: draft.reconnectFrom,
        reconnectTo: draft.reconnectTo || null,
      });
      if (mergeResult) {
        b()?.saveState?.();
        if (typeof mergeResult === 'object' && mergeResult.id) {
          return { type: mergeResult.type || draft.reconnectFrom.type, id: mergeResult.id };
        }
        return { type: draft.reconnectFrom.type, id: draft.reconnectFrom.id };
      }
    }

    if (draft.lineMode === 'excavation') {
      S.excavationPathId++;
      var excavId = 'excavation_' + S.excavationPathId;
      S.excavationPaths.push({
        id: excavId,
        type: 'LM_Excavation',
        kind: draft.kind,
        points: pointsToSave,
        cornerRadii: {},
        connectedTo: connectedTo,
        freeEnds: { start: !connectedTo.start, end: !connectedTo.end },
      });
      createdRef = { type: 'excavation', id: excavId };
      var mergedId = b()?.tryAutoMergePathGaps?.('excavation', excavId);
      if (mergedId) createdRef.id = mergedId;
    } else {
      createdRef = b()?.saveCableToDatabase?.(pointsToSave, {
        kind: draft.kind,
        capacity: draft.capacity,
        batch: draft.batch,
        cableName: draft.cableName || b()?.resolveActiveToolboxCableLabel?.(draft.kind),
        trenchPathId: draft.trenchPathId,
        pointSnapNodeIds: draft.pointSnapNodeIds,
        snapLabels: snapLabels,
        cornerRadii: draft.cornerRadii,
      });
      if (!createdRef) return null;
      return createdRef;
    }
    b()?.saveState?.();
    return createdRef;
  }

  function splitPenPathAtNode(draft, commit) {
    if (penFinishingDblClick || cableFinishingDblClick) return false;
    if (!draft || draft.lineMode === 'cable') return false;
    if (!commit || !isDeviceNodeSnap(commit)) return false;
    if (!draft.points || draft.points.length < 1) return false;

    var template = getPenDraftTemplate(draft);

    draft.vertexRedo.length = 0;
    draft.points.push(commit.pt);
    draft.snapLabels.push(commit.snapLabel || null);
    draft.pointSnapNodeIds.push(commit.snapNodeId || null);
    draft.cursor = commit.pt.slice();
    draft.cursorSnapNodeId = commit.snapNodeId || null;
    syncPenDraftPathState();

    if (!persistPenDraftToPaths(draft, { skipReconnect: true })) {
      draft.points.pop();
      draft.snapLabels.pop();
      draft.pointSnapNodeIds.pop();
      syncPenDraftPathState();
      return false;
    }

    restartPenDraftAtNode(commit, template);
    b()?.syncPenModeClass?.();
    syncPenPointerTracking();
    b()?.renderGlobalDrawingLayer?.();
    flushPenDrawingVisuals();
    confirmPenVertexPlaced({ x: commit.pt[0], y: commit.pt[1], snapped: true, snapLabel: commit.snapLabel });
    var nodeLabel = commit.snapLabel || 'node';
    b()?.updateStatus?.('Path saved at ' + nodeLabel + ' — new segment started');
    return true;
  }


  /* ─── Handhole / FAT Handhole path resumption (Continue batch Yes/No) ─── */

  function isResumeHandholeNode(node) {
    return !!(node && (node.type === 'handhole' || node.type === 'fat_handhole'));
  }

  function getActiveCableBatchIdentity() {
    var S = sim();
    var kind = S?.pen?.cableKind || S?.penDraft?.kind;
    if (!kind) return null;
    var capacity = Number(
      S?.penDraft?.capacity != null
        ? S.penDraft.capacity
        : (S?.pen?.cableCapacity != null
          ? S.pen.cableCapacity
          : b()?.getCableCapacityForKind?.(kind))
    );
    var batch = Number(
      S?.penDraft?.batch != null
        ? S.penDraft.batch
        : (b()?.getCableBatchForKind?.(kind) || 1)
    );
    return {
      kind: kind,
      capacity: capacity,
      batch: batch,
      label: b()?.formatCableLabel?.(capacity, batch) || (capacity + 'F' + batch),
    };
  }

  function cableMatchesActiveBatch(cable, identity) {
    if (!cable || !identity) return false;
    return String(cable.kind) === String(identity.kind) &&
      Number(cable.capacity) === Number(identity.capacity) &&
      Number(cable.batch) === Number(identity.batch);
  }

  function findMatchingBatchCableAtHandhole(node) {
    if (!isResumeHandholeNode(node)) return null;
    var identity = getActiveCableBatchIdentity();
    if (!identity) return null;
    var nodeId = String(node.id);
    var center = getDeviceSnapCenter(node) || b()?.getNodeCenterXY?.(node);
    var centerPt = center && isFinite(center.x) && isFinite(center.y)
      ? [center.x, center.y]
      : null;
    var geoTol = 36;
    var cables = sim()?.fiberCablePaths || [];
    var best = null;
    var bestDist = Infinity;
    var ci;
    for (ci = cables.length - 1; ci >= 0; ci--) {
      var cable = cables[ci];
      if (!cableMatchesActiveBatch(cable, identity)) continue;
      if (cableContinueRejectedIds[String(cable.id)]) continue;
      var pts = cable.points;
      if (!pts || pts.length < 2) continue;
      var snapIds = cable.pointSnapNodeIds || [];
      var endMeta = cableEndpointSnapNodeIds(cable);
      var ends = [
        {
          end: 'start',
          vertexIndex: 0,
          pt: pts[0],
          nodeId: snapIds[0] || endMeta.start || null,
        },
        {
          end: 'end',
          vertexIndex: pts.length - 1,
          pt: pts[pts.length - 1],
          nodeId: snapIds[pts.length - 1] || endMeta.end || null,
        },
      ];
      var ei;
      for (ei = 0; ei < ends.length; ei++) {
        var tip = ends[ei];
        if (!tip.pt) continue;
        var idMatch = tip.nodeId && String(tip.nodeId) === nodeId;
        var dist = centerPt
          ? Math.hypot(tip.pt[0] - centerPt[0], tip.pt[1] - centerPt[1])
          : Infinity;
        var geoMatch = isFinite(dist) && dist <= geoTol;
        if (!idMatch && !geoMatch) continue;
        if (dist < bestDist || (dist === bestDist && idMatch)) {
          bestDist = dist;
          best = {
            cableId: cable.id,
            cable: cable,
            end: tip.end,
            vertexIndex: tip.vertexIndex,
            pt: [tip.pt[0], tip.pt[1]],
            nodeId: nodeId,
            label: identity.label,
          };
        }
      }
    }
    return best;
  }

  function ensureCableContinueFab() {
    if (cableContinueFabEl && document.body.contains(cableContinueFabEl)) {
      return cableContinueFabEl;
    }
    var panel = document.createElement('div');
    panel.id = 'cable-continue-fab';
    panel.className = 'cable-continue-fab';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-hidden', 'true');
    panel.innerHTML =
      '<span class="cable-continue-fab__text">Continue</span>' +
      '<span class="cable-continue-fab__actions">' +
        '<button type="button" class="cable-continue-fab__btn cable-continue-fab__btn--yes" data-continue-choice="yes">Yes</button>' +
        '<button type="button" class="cable-continue-fab__btn cable-continue-fab__btn--no" data-continue-choice="no">No</button>' +
      '</span>';
    document.body.appendChild(panel);
    cableContinueFabEl = panel;
    if (!cableContinueFabBound) {
      cableContinueFabBound = true;
      var busy = false;
      var handleChoice = function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        var btn = e.target && e.target.closest
          ? e.target.closest('[data-continue-choice]')
          : null;
        if (!btn || busy) return;
        busy = true;
        var choice = btn.getAttribute('data-continue-choice');
        try {
          if (choice === 'yes') acceptCableContinueOffer();
          else if (choice === 'no') declineCableContinueOffer();
        } finally {
          setTimeout(function () { busy = false; }, 0);
        }
      };
      panel.addEventListener('pointerdown', function (e) {
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      }, true);
      panel.addEventListener('pointerup', handleChoice, true);
      panel.addEventListener('click', handleChoice, true);
    }
    return panel;
  }

  function getCableContinueAnchorScreen(offer) {
    if (!offer) return null;
    var node = offer.nodeId ? findSimNodeById(offer.nodeId) : null;
    var center = node ? getDeviceSnapCenter(node) : null;
    if ((!center || !isFinite(center.x)) && offer.pt) {
      center = { x: offer.pt[0], y: offer.pt[1] };
    }
    if (center && isFinite(center.x) && isFinite(center.y)) {
      var screen = canvasXYToScreenXY(center.x, center.y);
      return { x: screen.x + 36, y: screen.y - 44 };
    }
    var wrap = document.getElementById('canvas-wrapper') ||
      document.getElementById('simulator-container');
    if (wrap && wrap.getBoundingClientRect) {
      var rect = wrap.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + Math.min(120, rect.height * 0.18),
      };
    }
    return { x: (window.innerWidth || 800) / 2, y: 96 };
  }

  function clampCableContinueFabToViewport(panel, left, top) {
    var pad = 8;
    var w = panel.offsetWidth || 220;
    var h = panel.offsetHeight || 40;
    var maxL = Math.max(pad, (window.innerWidth || w) - w - pad);
    var maxT = Math.max(pad, (window.innerHeight || h) - h - pad);
    return {
      left: Math.min(Math.max(pad, left), maxL),
      top: Math.min(Math.max(pad, top), maxT),
    };
  }

  function positionCableContinueFab(offer) {
    var panel = ensureCableContinueFab();
    if (!offer) {
      hideCableContinueFab();
      return;
    }
    var textEl = panel.querySelector('.cable-continue-fab__text');
    if (textEl) textEl.textContent = 'Continue ' + (offer.label || 'Batch');
    panel.hidden = false;
    panel.removeAttribute('hidden');
    panel.setAttribute('aria-hidden', 'false');
    panel.classList.add('cable-continue-fab--visible');

    /* Freeze screen position once — never track the mouse. */
    if (isFinite(offer.anchorScreenX) && isFinite(offer.anchorScreenY)) {
      panel.style.left = Math.round(offer.anchorScreenX) + 'px';
      panel.style.top = Math.round(offer.anchorScreenY) + 'px';
      return;
    }
    var anchor = getCableContinueAnchorScreen(offer);
    if (!anchor) {
      hideCableContinueFab();
      return;
    }
    var clamped = clampCableContinueFabToViewport(panel, anchor.x, anchor.y);
    panel.style.left = Math.round(clamped.left) + 'px';
    panel.style.top = Math.round(clamped.top) + 'px';
    offer.anchorScreenX = clamped.left;
    offer.anchorScreenY = clamped.top;
  }

  function hideCableContinueFab(opts) {
    opts = opts || {};
    if (!opts.keepOffer) cableContinueOffer = null;
    if (!opts.keepLocked) cableContinuePromptLocked = false;
    if (!cableContinueFabEl) return;
    cableContinueFabEl.hidden = true;
    cableContinueFabEl.setAttribute('hidden', '');
    cableContinueFabEl.setAttribute('aria-hidden', 'true');
    cableContinueFabEl.classList.remove('cable-continue-fab--visible');
  }

  function clearCableContinueSession() {
    cableContinueRejectedIds = Object.create(null);
    cableContinuePromptLocked = false;
    hideCableContinueFab();
  }

  function findResumeHandholeAtDraftStart(draft, resolved) {
    var nodeId = (draft.pointSnapNodeIds && draft.pointSnapNodeIds[0]) ||
      resolved?.snapNodeId || resolved?.snapTarget?.nodeId || null;
    if (nodeId) {
      var byId = findSimNodeById(nodeId);
      if (isResumeHandholeNode(byId)) return byId;
    }
    var pt = draft?.points?.[0];
    if (!pt) return null;
    var geoTol = 40;
    var best = null;
    var bestDist = geoTol + 1;
    (sim()?.nodes || []).forEach(function (node) {
      if (!isResumeHandholeNode(node)) return;
      var center = getDeviceSnapCenter(node);
      if (!center) return;
      var d = Math.hypot(center.x - pt[0], center.y - pt[1]);
      if (d <= geoTol && d < bestDist) {
        bestDist = d;
        best = node;
      }
    });
    return best;
  }

  function isCableContinuePromptActive() {
    return !!(cableContinuePromptLocked && cableContinueOffer);
  }

  function offerCableContinueAfterFirstVertex(draft, resolved) {
    if (!draft || draft.continueFromCable || draft.points?.length !== 1) return null;
    var node = findResumeHandholeAtDraftStart(draft, resolved);
    if (!node) return null;
    var offer = findMatchingBatchCableAtHandhole(node);
    if (!offer) return null;
    cableContinueOffer = offer;
    cableContinuePromptLocked = true;
    positionCableContinueFab(offer);
    b()?.updateStatus?.(
      'Continue ' + (offer.label || 'batch') + ' — Yes merges · No draws a new cable'
    );
    return offer;
  }

  function acceptCableContinueOffer() {
    var offer = cableContinueOffer;
    if (!offer || !offer.cableId) return false;
    var S = sim();
    if (!S || S.pen?.lineMode !== 'cable') return false;
    var cable = offer.cable;
    if (!cable) {
      var paths = S.fiberCablePaths || [];
      for (var i = 0; i < paths.length; i++) {
        if (String(paths[i].id) === String(offer.cableId)) {
          cable = paths[i];
          break;
        }
      }
    }
    if (!cable || !cable.points || cable.points.length < 2) {
      hideCableContinueFab();
      b()?.updateStatus?.('Could not resume cable — path missing', true);
      return false;
    }
    var draft = ensurePenDraft();
    if (!draft) return false;

    var joinNode = offer.nodeId ? findSimNodeById(offer.nodeId) : null;
    var joinCenter = joinNode ? getDeviceSnapCenter(joinNode) : null;
    var joinPt = joinCenter && isFinite(joinCenter.x) && isFinite(joinCenter.y)
      ? [Math.round(joinCenter.x * 10) / 10, Math.round(joinCenter.y * 10) / 10]
      : (offer.pt
        ? offer.pt.slice()
        : (offer.end === 'start'
          ? cable.points[0].slice()
          : cable.points[cable.points.length - 1].slice()));
    var tipIndex = offer.vertexIndex != null
      ? offer.vertexIndex
      : (offer.end === 'start' ? 0 : cable.points.length - 1);
    var joinSnapId = offer.nodeId ||
      (cable.pointSnapNodeIds && cable.pointSnapNodeIds[tipIndex]) || null;
    var joinLabel = (joinCenter && joinCenter.label) ||
      (cable.snapLabels && cable.snapLabels[tipIndex]) || null;

    if (tipIndex >= 0 && tipIndex < cable.points.length) {
      cable.points[tipIndex] = joinPt.slice();
      if (!cable.pointSnapNodeIds) cable.pointSnapNodeIds = [];
      while (cable.pointSnapNodeIds.length < cable.points.length) cable.pointSnapNodeIds.push(null);
      if (joinSnapId) cable.pointSnapNodeIds[tipIndex] = joinSnapId;
    }

    if (!draft.points.length) {
      draft.points = [joinPt.slice()];
      draft.snapLabels = [joinLabel];
      draft.pointSnapNodeIds = [joinSnapId];
    } else {
      draft.points[0] = joinPt.slice();
      if (!draft.snapLabels) draft.snapLabels = [];
      if (!draft.pointSnapNodeIds) draft.pointSnapNodeIds = [];
      draft.snapLabels[0] = joinLabel || draft.snapLabels[0] || null;
      draft.pointSnapNodeIds[0] = joinSnapId || draft.pointSnapNodeIds[0] || null;
    }
    draft.vertexRedo = [];
    draft.cursor = joinPt.slice();
    draft.continueFromCable = {
      id: cable.id,
      end: offer.end,
      vertexIndex: tipIndex,
      joinNodeId: joinSnapId,
    };
    draft.kind = cable.kind || draft.kind;
    draft.capacity = cable.capacity != null ? cable.capacity : draft.capacity;
    draft.batch = cable.batch != null ? cable.batch : draft.batch;
    draft.cableName = cable.asBuiltId || cable.name || draft.cableName;
    if (cable.trenchPathId) draft.trenchPathId = cable.trenchPathId;
    if (cable.trenchPathIds) draft.trenchPathIds = cable.trenchPathIds.slice();

    cableContinuePromptLocked = false;
    hideCableContinueFab();
    syncPenDraftPathState();
    b()?.syncPenModeClass?.();
    b()?.renderGlobalDrawingLayer?.();
    b()?.syncBatchDuplicationHintForDrawingState?.();
    flushPenDrawingVisuals();
    b()?.updateStatus?.(
      'Continuing ' + (draft.cableName || offer.label || 'cable') +
      ' — draw next segment · double-click to merge'
    );
    return true;
  }

  function declineCableContinueOffer() {
    var offer = cableContinueOffer;
    if (offer && offer.cableId) {
      cableContinueRejectedIds[String(offer.cableId)] = true;
    }
    cableContinuePromptLocked = false;
    hideCableContinueFab();
    b()?.syncBatchDuplicationHintForDrawingState?.();
    b()?.updateStatus?.(
      'New cable — click trench vertices/handholes · double-click to finish'
    );
    return true;
  }

  function isCableTrenchSegmentResolved(resolved) {
    if (!resolved) return false;
    if (resolved.snapKind === 'handhole' || resolved.snapKind === 'device') return true;
    if (resolved.snapTarget?.kind === 'handhole' || resolved.snapTarget?.kind === 'device') return true;
    if (resolved.snapNodeId || resolved.snapTarget?.nodeId) return true;
    if (resolved.snapTarget?.kind === 'trench-segment' || resolved.snapTarget?.kind === 'trench-vertex' ||
        resolved.snapTarget?.kind === 'cable-segment' || resolved.snapTarget?.kind === 'path-vertex' ||
        resolved.snapTarget?.kind === 'path-endpoint') return true;
    if (resolved.snapKind === 'trench-segment' || resolved.snapKind === 'trench-vertex' ||
        resolved.snapKind === 'cable-segment' || resolved.snapKind === 'path-vertex' ||
        resolved.snapKind === 'path-endpoint') return true;
    return !!(resolved.snapped && b()?.isPointOnExcavationTrench?.(resolved.x, resolved.y));
  }

  function resolveCablePointClick(e) {
    var S = sim();
    var xy = b()?.pointerEventToCanvasXY?.(e) || b()?.getSVGCoordinates?.(e);
    var hit = resolveCableGuidedSnap(e, xy);

    if (!hit && lastPenSnapCache?.guidedSnap) {
      hit = lastPenSnapCache.guidedSnap;
    }

    if (!hit && S?.crosshair?.snapped &&
        isFinite(S.crosshair.snapX) && isFinite(S.crosshair.snapY)) {
      var chKind = S.crosshair.snapKind;
      if (chKind === 'trench-vertex' || chKind === 'trench-segment' || chKind === 'cable-segment' ||
          chKind === 'path-vertex' || chKind === 'path-endpoint' ||
          chKind === 'handhole' || chKind === 'device') {
        var draftTarget = S.penDraft?.magneticSnapTarget;
        hit = {
          x: S.crosshair.snapX,
          y: S.crosshair.snapY,
          snapKind: chKind,
          snapLabel: draftTarget?.label || null,
          snapNodeId: draftTarget?.nodeId || S.penDraft?.cursorSnapNodeId || null,
          target: draftTarget || {
            kind: chKind,
            x: S.crosshair.snapX,
            y: S.crosshair.snapY,
            snapKind: chKind,
          },
        };
      }
    }

    var deviceHit = null;
    if (pendingCableForceNodeId) {
      var forcedNode = findSimNodeById(pendingCableForceNodeId);
      var forcedCenter = forcedNode ? getDeviceSnapCenter(forcedNode) : null;
      deviceHit = buildCableDeviceSnapHit(forcedNode, forcedCenter);
    }
    if (!deviceHit && e?.clientX != null && e?.clientY != null) {
      deviceHit = pickCableDeviceSnapOnClick(e.clientX, e.clientY);
    }
    hit = mergeCableHitWithDevice(hit, deviceHit);

    return buildCableResolvedFromSnapHit(hit);
  }

  function commitCablePointFromResolved(draft, resolved, e) {
    if (!draft || !resolved || !isCableTrenchSegmentResolved(resolved)) return false;
    if (!draft.points?.length) {
      if (!b()?.canStartCableDrawing?.(resolved)) return false;
    } else if (!b()?.canPlaceCablePoint?.(resolved)) {
      return false;
    }

    var pt = getCableCommittedPoint(resolved, e);
    if (!pt) return false;

    if (draft.points?.length && shouldSkipCableVertex(draft, pt)) return false;

    if (resolved.snapTarget?.pathId) {
      if (!draft.trenchPathIds) draft.trenchPathIds = [];
      if (draft.trenchPathIds.indexOf(resolved.snapTarget.pathId) < 0) {
        draft.trenchPathIds.push(resolved.snapTarget.pathId);
      }
      if (!draft.trenchPathId) {
        draft.trenchPathId = resolved.snapTarget.pathId;
        draft.hostTrenchId = resolved.snapTarget.pathId;
      }
    }

    draft.vertexRedo.length = 0;
    draft.points.push(pt);
    draft.snapLabels.push(resolved.snapLabel || resolved.snapTarget?.label || null);
    draft.pointSnapNodeIds.push(resolved.snapNodeId || resolved.snapTarget?.nodeId || null);
    return true;
  }

  function finalizeCableDraftAfterPoint(draft, e) {
    if (!draft?.points?.length) return;
    var cableLast = draft.points[draft.points.length - 1];
    draft.cursor = cableLast ? cableLast.slice() : null;
    draft.cursorSnapNodeId = draft.pointSnapNodeIds?.[draft.points.length - 1] || null;
    draft.activePathPoints = (draft.points || []).map(function (p) {
      return [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10];
    });
    updatePenSnapGlow();
    b()?.syncPenModeClass?.();
    syncPenPointerTracking();
    b()?.renderGlobalDrawingLayer?.();
    flushPenDrawingVisuals();
    if (e) updateRubberBandFromEvent(e);
  }

  function trimCableDblClickArtifact(draft) {
    if (!draft?.points || draft.points.length < 2) return;
    var last = draft.points[draft.points.length - 1];
    var prev = draft.points[draft.points.length - 2];
    if (last && prev && pointsNear(last, prev, 3)) {
      draft.points.pop();
      draft.snapLabels.pop();
      if (draft.pointSnapNodeIds) draft.pointSnapNodeIds.pop();
    }
  }

  function appendCableFinishPointFromEvent(draft, finishEvent) {
    if (!draft || draft.lineMode !== 'cable' || !finishEvent) return false;
    var resolved = resolveCablePointClick(finishEvent);
    if (!resolved || !isCableTrenchSegmentResolved(resolved)) return false;
    var added = commitCablePointFromResolved(draft, resolved, finishEvent);
    if (!added) return false;
    finalizeCableDraftAfterPoint(draft, null);
    return true;
  }

  function addPenVertexFromEvent(e) {
    if (penFinishingDblClick || cableFinishingDblClick) return false;
    if (e?.detail >= 2) return false;
    if (!b()?.canPenDraw?.()) {
      if (b()?.isPenToolSelected?.() && !sim()?.pen?.lineMode) {
        b()?.updateStatus?.('Pick Direct Buried or a cable type first', true);
      }
      return false;
    }
    var S = sim();
    var isCable = S?.pen?.lineMode === 'cable';
    var resolved = isCable ? resolveCablePointClick(e) : b()?.resolvePenPointerFromEvent?.(e);
    if (!resolved) {
      if (isCable) {
        b()?.updateStatus?.('Click on excavation trench — off-trench clicks are blocked', true);
      }
      return false;
    }
    var draft = ensurePenDraft();
    if (!draft) return false;

    if (isCable) {
      if (cableContinuePromptLocked) {
        b()?.updateStatus?.(
          'Continue ' + (cableContinueOffer?.label || 'batch') +
          ' — choose Yes to merge or No for a new cable',
          true
        );
        return false;
      }
      if (!commitCablePointFromResolved(draft, resolved, e)) {
        b()?.updateStatus?.('Stay on the excavation trench to add cable points', true);
        return false;
      }
      finalizeCableDraftAfterPoint(draft, e);
      confirmPenVertexPlaced(resolved);
      b()?.syncBatchDuplicationHintForDrawingState?.();
      if (draft.points.length === 1 && !draft.continueFromCable) {
        offerCableContinueAfterFirstVertex(draft, resolved);
      }
      /* Phase 1/3: first vertex — Main from FDT or Sub from Closure */
      var mainStartConfirmed = false;
      var subStartConfirmed = false;
      if (draft.points.length === 1 && !draft.continueFromCable) {
        mainStartConfirmed = signalMainCableStartConfirmed(resolved);
        if (!mainStartConfirmed) {
          subStartConfirmed = signalSubCableStartConfirmed(resolved);
        }
      }
      /* Phase 2: Main Cable closure checkpoints */
      var closureLinked = false;
      if (!mainStartConfirmed && !subStartConfirmed && isMainCableTrailActive(draft)) {
        closureLinked = signalClosureCheckpointConfirmed(resolved);
      }
      /* Direct Cabinet→Pole (no closure): FH/pole drops on Main trail */
      var mainDirectDropLinked = false;
      if (!mainStartConfirmed && !subStartConfirmed && !closureLinked &&
          isMainCableDirectDropMode(draft)) {
        mainDirectDropLinked = signalMainCableDirectDropConfirmed(resolved);
        if (!mainDirectDropLinked) {
          var mainDropSync = syncMainCableDirectDropsFromDraft(draft);
          if (mainDropSync.grew && mainDropSync.newest) {
            flashMainCableDirectDropConfirm(mainDropSync.newest, draft);
            mainDirectDropLinked = true;
          } else {
            syncActiveCableTrailStatusHint();
          }
        }
      }
      /* Phase 3: Sub-Cable FH/pole drops — full chain along draft route */
      var dropLinked = false;
      if (!mainStartConfirmed && !subStartConfirmed && !closureLinked &&
          !mainDirectDropLinked && isSubCableTrailActive(draft)) {
        dropLinked = signalSubCableDropConfirmed(resolved);
        if (!dropLinked) {
          var chainSync = syncSubCableTrailFromDraft(draft);
          if (chainSync.grew && chainSync.newest) {
            flashSubCableDropConfirm(chainSync.newest, draft);
            dropLinked = true;
          } else {
            syncActiveCableTrailStatusHint();
          }
        }
      }
      if (mainStartConfirmed || subStartConfirmed || closureLinked ||
          mainDirectDropLinked || dropLinked) {
        /* Bottom bar already shows Main/Sub Cable sequence. */
      } else if (isMainCableTrailActive(draft) || isSubCableTrailActive(draft)) {
        syncActiveCableTrailStatusHint();
      } else if (draft.continueFromCable) {
        b()?.updateStatus?.(
          'Continuing ' + (draft.cableName || 'cable') +
          ' — draw next segment · double-click to merge'
        );
      } else if (cableContinuePromptLocked) {
        /* Keep Continue Yes/No status. */
      } else if (draft.points.length === 1) {
        b()?.updateStatus?.('Cable — click trench vertices/handholes · double-click to finish');
      } else {
        var lastLabel = resolved.snapLabel || resolved.snapKind || '';
        var suffix = lastLabel ? ' @ ' + lastLabel : '';
        b()?.updateStatus?.('Cable · waypoint ' + draft.points.length + suffix + ' — double-click to finish');
      }
      return true;
    }

    var commit = commitPenPointFromResolved(resolved);
    if (!commit) return false;
    var onSnappedNode = isDeviceNodeSnap(commit);

    var onTrenchSnap = !!(resolved.snapTarget?.kind === 'trench-segment' ||
      resolved.snapTarget?.kind === 'trench-vertex' ||
      resolved.snapTarget?.kind === 'cable-segment' ||
      resolved.snapTarget?.kind === 'path-endpoint' ||
      resolved.snapTarget?.kind === 'path-vertex' ||
      (resolved.snapped && b()?.isPointOnExcavationTrench?.(resolved.x, resolved.y)));
    var onReconnect = !!draft.reconnectFrom;
    var ch = S?.crosshair;
    var onCrosshairSnap = !!(ch?.snapped && isFinite(ch.snapX) && isFinite(ch.snapY) &&
      (ch.snapKind === 'path-endpoint' || ch.snapKind === 'path-vertex' ||
       ch.snapKind === 'handhole' || ch.snapKind === 'device' ||
       ch.snapKind === 'trench-segment' || ch.snapKind === 'trench-vertex' ||
       ch.snapKind === 'cable-segment'));
    if (!onSnappedNode && !onTrenchSnap && !onReconnect && !onCrosshairSnap &&
        !b()?.isDrawableSurfaceXY?.(resolved.x, resolved.y)) {
      b()?.updateStatus?.('Draw on street or sidewalk only', true);
      return false;
    }
    if (shouldSkipPenVertex(draft, commit.pt, commit)) return false;

    if (onSnappedNode && draft.points.length >= 1) {
      if (splitPenPathAtNode(draft, commit)) return;
    }

    draft.vertexRedo.length = 0;
    draft.points.push(commit.pt);
    draft.snapLabels.push(commit.snapLabel || null);
    draft.pointSnapNodeIds.push(commit.snapNodeId || null);
    draft.cursor = commit.pt.slice();
    draft.cursorSnapNodeId = commit.snapNodeId || null;
    if (draft.points.length === 1 && resolved.snapTarget) {
      attachReconnectFromSnapTarget(draft, resolved.snapTarget);
    }
    draft.activePathPoints = normalizePathPointsForSave(draft.points);
    updatePenSnapGlow();
    b()?.syncPenModeClass?.();
    syncPenPointerTracking();
    b()?.renderGlobalDrawingLayer?.();
    flushPenDrawingVisuals();
    updateRubberBandFromEvent(e);
    confirmPenVertexPlaced(resolved);
    if (draft.points.length === 1) {
      b()?.updateStatus?.('Pen — keep clicking · dbl-click or Enter to finish');
    } else {
      b()?.updateStatus?.('Pen · vertex ' + draft.points.length + (commit.snapped ? ' (snap ' + (commit.snapLabel || 'device') + ')' : ''));
    }
    return true;
  }

  function handleCablePointClick(e) {
    return addPenVertexFromEvent(e);
  }

  function addPenVertexFromPlacedNode(nodeId, e) {
    if (!nodeId) return addPenVertexFromEvent(e);
    pendingCableForceNodeId = nodeId;
    try {
      return addPenVertexFromEvent(e);
    } finally {
      pendingCableForceNodeId = null;
    }
  }

  function startCableDrawingFromEvent(e) {
    return addPenVertexFromEvent(e);
  }

  function tryPenReconnectOrAdd(e) {
    var S = sim();
    if (S?.pen?.lineMode === 'cable') {
      return addPenVertexFromEvent(e);
    }
    var resolved = b()?.resolvePenPointerFromEvent?.(e);
    if (!resolved) return false;
    if (tryPenReconnect(resolved.x, resolved.y, e?.clientX, e?.clientY)) return true;
    var ch = S?.crosshair;
    if (ch?.snapped && isFinite(ch.snapX) && isFinite(ch.snapY) &&
        (ch.snapKind === 'path-endpoint' || ch.snapKind === 'path-vertex')) {
      return tryPenReconnect(ch.snapX, ch.snapY, e?.clientX, e?.clientY) || addPenVertexFromEvent(e);
    }
    return addPenVertexFromEvent(e);
  }

  function updateRubberBandFromEvent(e) {
    beginScreenCtmCacheFrame();
    try {
    var S = sim();
    if (!b()?.canPenDraw?.()) return;
    if (e?.clientX == null || e?.clientY == null) return;

    var movedLittle = false;
    if (lastPenSnapCache &&
        lastPenSnapCache.clientX === e.clientX &&
        lastPenSnapCache.clientY === e.clientY) {
      movedLittle = true;
    } else if (lastPenSnapCache) {
      var mdx = e.clientX - lastPenSnapCache.clientX;
      var mdy = e.clientY - lastPenSnapCache.clientY;
      movedLittle = (mdx * mdx + mdy * mdy) < 1;
    }

    if (!movedLittle) {
      syncCrosshairMapHoverFromEvent(e);
    }

    var xy = lastPenSnapCache?.xy;
    if (!movedLittle || !xy) {
      xy = b()?.getSVGCoordinates?.(e) || b()?.pointerEventToCanvasXY?.(e);
      if (!xy) return;
    }

    if (S?.pen?.lineMode === 'cable') {
      var guidedSnap = movedLittle && lastPenSnapCache?.guidedSnap !== undefined
        ? lastPenSnapCache.guidedSnap
        : resolveCableGuidedSnap(e, xy);
      var draft = S.penDraft;
      /*
       * Interactive cues (feedback only):
       * - awaiting start → Cabinet (red) else Closure (sky) for Sub start
       * - Main trail → closure checkpoint (yellow) or direct FH/pole (orange)
       * - Sub trail → FH/pole drop (orange)
       */
      var cabinetSnap = null;
      var mainClosureSnap = null;
      var subClosureSnap = null;
      var subDropSnap = null;
      if (isCableAwaitingTrailStart(draft)) {
        cabinetSnap = movedLittle && lastPenSnapCache && lastPenSnapCache.cabinetSnap !== undefined
          ? lastPenSnapCache.cabinetSnap
          : pickCableCabinetMagneticSnap(e.clientX, e.clientY);
        if (!cabinetSnap) {
          subClosureSnap = movedLittle && lastPenSnapCache && lastPenSnapCache.subClosureSnap !== undefined
            ? lastPenSnapCache.subClosureSnap
            : pickCableClosureMagneticSnap(e.clientX, e.clientY);
        }
      } else if (isMainCableTrailActive(draft)) {
        mainClosureSnap = movedLittle && lastPenSnapCache && lastPenSnapCache.mainClosureSnap !== undefined
          ? lastPenSnapCache.mainClosureSnap
          : pickCableClosureMagneticSnap(e.clientX, e.clientY);
        /* Direct Cabinet→Pole: orange FH/pole hover when no closures yet */
        if (!mainClosureSnap && isMainCableDirectDropMode(draft)) {
          var excludeCab = draft.mainCableTrail && draft.mainCableTrail.cabinetId;
          subDropSnap = movedLittle && lastPenSnapCache && lastPenSnapCache.subDropSnap !== undefined
            ? lastPenSnapCache.subDropSnap
            : pickCableSubDropMagneticSnap(e.clientX, e.clientY, excludeCab);
        }
      } else if (isSubCableTrailActive(draft)) {
        var excludeStart = draft.subCableTrail && draft.subCableTrail.closureId;
        subDropSnap = movedLittle && lastPenSnapCache && lastPenSnapCache.subDropSnap !== undefined
          ? lastPenSnapCache.subDropSnap
          : pickCableSubDropMagneticSnap(e.clientX, e.clientY, excludeStart);
      }
      var visualSnap = cabinetSnap || mainClosureSnap || subClosureSnap || subDropSnap || guidedSnap;
      var trackX = visualSnap ? visualSnap.x : null;
      var trackY = visualSnap ? visualSnap.y : null;
      if (!movedLittle) {
        updateCrosshairState(
          xy.x, xy.y, !!visualSnap,
          trackX != null ? trackX : xy.x,
          trackY != null ? trackY : xy.y,
          visualSnap?.snapKind || visualSnap?.target?.kind || null
        );
        if (S.crosshair) {
          S.crosshair.cabinetHover = !!cabinetSnap;
          S.crosshair.mainClosureHover = !!mainClosureSnap;
          S.crosshair.subClosureHover = !!subClosureSnap;
          S.crosshair.subDropHover = !!subDropSnap;
          S.crosshair.closureHover = !!mainClosureSnap;
        }
        if (draft && visualSnap) {
          draft.cursor = [visualSnap.x, visualSnap.y];
          draft.cursorSnapNodeId = visualSnap.snapNodeId || visualSnap.target?.nodeId || null;
          draft.magneticSnapTarget = visualSnap.target || null;
        } else if (draft) {
          draft.cursorSnapNodeId = null;
          draft.magneticSnapTarget = null;
        }
        lastPenSnapCache = {
          clientX: e.clientX,
          clientY: e.clientY,
          xy: xy,
          guidedSnap: guidedSnap,
          cabinetSnap: cabinetSnap,
          mainClosureSnap: mainClosureSnap,
          subClosureSnap: subClosureSnap,
          subDropSnap: subDropSnap,
          closureSnap: mainClosureSnap,
        };
      } else if (S.crosshair) {
        S.crosshair.x = xy.x;
        S.crosshair.y = xy.y;
        S.crosshair.cabinetHover = !!cabinetSnap;
        S.crosshair.mainClosureHover = !!mainClosureSnap;
        S.crosshair.subClosureHover = !!subClosureSnap;
        S.crosshair.subDropHover = !!subDropSnap;
        S.crosshair.closureHover = !!mainClosureSnap;
        if (visualSnap) {
          S.crosshair.snapped = true;
          S.crosshair.snapX = visualSnap.x;
          S.crosshair.snapY = visualSnap.y;
          S.crosshair.snapKind = visualSnap.snapKind || visualSnap.target?.kind || null;
          if (draft) {
            draft.cursor = [visualSnap.x, visualSnap.y];
            draft.cursorSnapNodeId = visualSnap.snapNodeId || visualSnap.target?.nodeId || null;
            draft.magneticSnapTarget = visualSnap.target || null;
          }
        } else {
          S.crosshair.snapped = false;
          S.crosshair.snapKind = null;
          if (draft) {
            draft.cursorSnapNodeId = null;
            draft.magneticSnapTarget = null;
          }
        }
      }
      flushPenCursorVisuals();
      return;
    }

    var snap = movedLittle && lastPenSnapCache?.snap
      ? lastPenSnapCache.snap
      : getSnappedPosition(e.clientX, e.clientY, xy.x, xy.y, { mode: 'pen' });
    var px = isFinite(snap.x) ? snap.x : xy.x;
    var py = isFinite(snap.y) ? snap.y : xy.y;

    if (snap.snapped && snap.snapNodeId) {
      var node = findSimNodeById(snap.snapNodeId);
      var center = node ? getDeviceSnapCenter(node) : null;
      if (center) {
        px = center.x;
        py = center.y;
      }
    }

    if (!movedLittle) {
      updateCrosshairState(xy.x, xy.y, !!snap.snapped, px, py, snap.target?.kind || null);
      lastPenSnapCache = {
        clientX: e.clientX,
        clientY: e.clientY,
        xy: xy,
        snap: snap,
      };
    } else if (S.crosshair) {
      S.crosshair.x = xy.x;
      S.crosshair.y = xy.y;
      S.crosshair.snapped = !!snap.snapped;
      S.crosshair.snapX = px;
      S.crosshair.snapY = py;
      S.crosshair.snapKind = snap.snapped ? (snap.target?.kind || null) : null;
    }

    if (!S?.penDraft?.points?.length) {
      flushPenCursorVisuals();
      return;
    }

    S.penDraft.cursor = [px, py];
    S.penDraft.cursorSnapNodeId = snap.snapNodeId || snap.target?.nodeId || null;
    flushPenCursorVisuals();
    } finally {
      sealScreenCtmCacheFrame();
    }
  }

  function penPreviewCursorXY(S) {
    if (!S?.penDraft) return null;
    if (S.pen?.lineMode === 'cable') {
      var ch = S.crosshair;
      if (!ch?.snapped || !isFinite(ch.snapX) || !isFinite(ch.snapY)) return null;
      return { x: ch.snapX, y: ch.snapY };
    }
    var cur = S.penDraft.cursor;
    if (cur && isFinite(cur[0]) && isFinite(cur[1])) {
      return { x: cur[0], y: cur[1] };
    }
    var ch2 = S.crosshair;
    if (ch2?.visible) {
      return {
        x: ch2.snapped && isFinite(ch2.snapX) ? ch2.snapX : ch2.x,
        y: ch2.snapped && isFinite(ch2.snapY) ? ch2.snapY : ch2.y,
      };
    }
    return null;
  }

  function updateLiveRubberLine() {
    var S = sim();
    var svg = b()?.ensureGlobalDrawingLayer?.();
    if (!svg || !b()?.canPenDraw?.() || !S?.penDraft?.points?.length) {
      if (svg) hideSvgEl(svg, 'pen-rubber-band');
      return;
    }
    if (S.pen?.lineMode === 'cable') {
      var last = S.penDraft.points[S.penDraft.points.length - 1];
      if (!last) return;
      var preview = penPreviewCursorXY(S);
      if (!preview || !isFinite(preview.x) || !isFinite(preview.y)) {
        hideSvgEl(svg, 'pen-rubber-band');
        return;
      }
      var line = svg.querySelector('#pen-rubber-band');
      if (!line) {
        line = document.createElementNS(SVG_NS, 'line');
        line.id = 'pen-rubber-band';
        line.setAttribute('class', 'pen-rubber-band pen-rubber-band--cable');
        line.setAttribute('stroke', '#2563eb');
        line.setAttribute('stroke-width', '1.15');
        line.setAttribute('filter', 'none');
        line.setAttribute('stroke-dasharray', '5,5');
        line.setAttribute('stroke-linecap', 'butt');
        line.setAttribute('pointer-events', 'none');
        mountOverlayEl(svg, line);
      } else {
        mountOverlayEl(svg, line);
      }
      setSvgLineCoords(line, last[0], last[1], preview.x, preview.y);
      line.style.display = '';
      return;
    }
    var last = S.penDraft.points[S.penDraft.points.length - 1];
    if (!last) return;
    var preview = penPreviewCursorXY(S);
    if (!preview || !isFinite(preview.x) || !isFinite(preview.y)) {
      hideSvgEl(svg, 'pen-rubber-band');
      return;
    }
    var line = svg.querySelector('#pen-rubber-band');
    if (!line) {
      line = document.createElementNS(SVG_NS, 'line');
      line.id = 'pen-rubber-band';
      line.setAttribute('class', 'pen-rubber-band');
      line.setAttribute('stroke', PEN_RUBBER_COLOR);
      line.setAttribute('stroke-width', '2.5');
      line.setAttribute('filter', 'none');
      line.setAttribute('stroke-dasharray', PEN_RUBBER_DASH);
      line.setAttribute('stroke-linecap', 'butt');
      line.setAttribute('pointer-events', 'none');
      mountOverlayEl(svg, line);
    } else {
      mountOverlayEl(svg, line);
    }
    setSvgLineCoords(line, last[0], last[1], preview.x, preview.y);
    line.style.display = '';
  }

  function removeLastVertex() {
    var S = sim();
    if (!S?.penDraft?.points?.length) return;
    var draft = S.penDraft;
    if (!draft.vertexRedo) draft.vertexRedo = [];
    if (!draft.snapLabels) draft.snapLabels = [];
    if (!draft.pointSnapNodeIds) draft.pointSnapNodeIds = [];
    var removedPt = draft.points.pop();
    var removedSnap = draft.snapLabels.length ? draft.snapLabels.pop() : null;
    var removedNodeId = draft.pointSnapNodeIds.length ? draft.pointSnapNodeIds.pop() : null;
    draft.vertexRedo.push({ pt: removedPt, snap: removedSnap, snapNodeId: removedNodeId });
    var remain = draft.points.length;
    draft.cursor = remain ? draft.points[remain - 1].slice() : null;
    draft.activePathPoints = remain ? normalizePathPointsForSave(draft.points) : [];
    if (!remain) {
      /* Keep empty draft shell so Ctrl+Y can restore and the pen session stays armed. */
      draft.continueFromCable = null;
      clearCableContinueSession();
      updatePenSnapGlow();
    }
    syncPenDraftPathState();
    b()?.syncPenModeClass?.();
    b()?.syncDrawingLayerInteraction?.();
    flushPenDrawingVisuals();
    b()?.renderGlobalDrawingLayer?.();
    b()?.syncBatchDuplicationHintForDrawingState?.();
    b()?.updateStatus?.('Vertex removed — ' + remain + ' remain');
  }

  function redoLastVertex() {
    var S = sim();
    if (!S?.penDraft?.vertexRedo?.length) return;
    var draft = S.penDraft;
    var item = draft.vertexRedo.pop();
    draft.points.push(item.pt);
    if (!draft.snapLabels) draft.snapLabels = [];
    draft.snapLabels.push(item.snap);
    if (!draft.pointSnapNodeIds) draft.pointSnapNodeIds = [];
    draft.pointSnapNodeIds.push(item.snapNodeId || null);
    draft.cursor = item.pt.slice();
    draft.activePathPoints = normalizePathPointsForSave(draft.points);
    syncPenDraftPathState();
    b()?.syncPenModeClass?.();
    b()?.syncDrawingLayerInteraction?.();
    flushPenDrawingVisuals();
    b()?.renderGlobalDrawingLayer?.();
    b()?.syncBatchDuplicationHintForDrawingState?.();
    b()?.updateStatus?.('Vertex restored — ' + draft.points.length + ' total');
  }

  function cancelCurrentDrawing() {
    var S = sim();
    if (!S) return;
    cableFinishingDblClick = false;
    S.penDraft = null;
    clearCableContinueSession();
    unbindPenPointerTracking();
    cancelRubberBandRaf();
    hidePenDrawingOverlays();
    updatePenSnapGlow();
    updateReconnectSnapGlow();
    b()?.syncPenModeClass?.();
    b()?.renderGlobalDrawingLayer?.();
    b()?.syncBatchDuplicationHintForDrawingState?.();
    b()?.updateStatus?.('Drawing cancelled');
  }

  function buildPathConnectedTo(snapLabels) {
    var start = null;
    var end = null;
    (snapLabels || []).forEach(function (lbl) {
      if (!lbl) return;
      if (!start) start = lbl;
      end = lbl;
    });
    return { start: start, end: end };
  }

  function finishPenDrawing(opts) {
    opts = opts || {};
    var S = sim();
    if (!S?.penDraft) return;
    if (cableSaveInProgress) return;
    cableFinishingDblClick = false;
    var draft = S.penDraft;

    if (draft.lineMode === 'cable') {
      if (!opts.fromDoubleClick && !opts.emergency) return;
      if (!draft.points?.length) {
        b()?.updateStatus?.('Single-click on excavation line to start — double-click finishes', true);
        return;
      }
      cableSaveInProgress = true;
      try {
        if (opts.fromDoubleClick && opts.finishEvent) {
          appendCableFinishPointFromEvent(draft, opts.finishEvent);
        }
        if (opts.fromDoubleClick) trimCableDblClickArtifact(draft);
        var pointsSnapshot = collectCompleteCablePointsForSave(draft, opts.finishEvent || null, opts);
        var snapLabelsSnapshot = (draft.snapLabels || []).slice(0, draft.points.length);
        while (snapLabelsSnapshot.length < pointsSnapshot.length) snapLabelsSnapshot.push(null);
        if (pointsSnapshot.length < 2) {
          b()?.updateStatus?.('Could not save cable — keep at least 2 points on excavation trench', true);
          return;
        }

        if (DEBUG) {
        console.log('[finishPenDrawing] saving complete cable path:', pointsSnapshot.length, 'vertices', pointsSnapshot);
        }

        var createdRef = null;
        var wasContinue = !!(draft.continueFromCable && draft.continueFromCable.id);
        /* Phase 2–3: persist visual Main/Sub Cable sequences (metadata only).
           Rebuild full FH chain from the complete route before snapshot. */
        if (isSubCableTrailActive(draft)) {
          syncSubCableTrailFromDraft(draft);
          syncActiveCableTrailStatusHint();
        } else if (isMainCableDirectDropMode(draft)) {
          syncMainCableDirectDropsFromDraft(draft);
          syncActiveCableTrailStatusHint();
        }
        var mainCableTrailSnapshot = cloneMainCableTrail(draft.mainCableTrail);
        var subCableTrailSnapshot = cloneSubCableTrail(draft.subCableTrail);
        if (wasContinue) {
          createdRef = b()?.extendCableInDatabase?.(draft.continueFromCable.id, pointsSnapshot, {
            continueEnd: draft.continueFromCable.end || 'end',
            joinNodeId: draft.continueFromCable.joinNodeId ||
              (draft.pointSnapNodeIds && draft.pointSnapNodeIds[0]) || null,
            kind: draft.kind,
            capacity: draft.capacity,
            batch: draft.batch,
            cableName: draft.cableName,
            trenchPathId: draft.trenchPathId,
            trenchPathIds: draft.trenchPathIds,
            pointSnapNodeIds: (draft.pointSnapNodeIds || []).slice(0, pointsSnapshot.length),
            snapLabels: snapLabelsSnapshot,
            userDrawn: true,
            mainCableTrail: mainCableTrailSnapshot,
            subCableTrail: subCableTrailSnapshot,
          });
        } else {
          createdRef = b()?.saveCableToDatabase?.(pointsSnapshot, {
            kind: draft.kind,
            capacity: draft.capacity,
            batch: draft.batch,
            cableName: draft.cableName || b()?.resolveActiveToolboxCableLabel?.(draft.kind),
            trenchPathId: draft.trenchPathId,
            trenchPathIds: draft.trenchPathIds,
            pointSnapNodeIds: (draft.pointSnapNodeIds || []).slice(0, pointsSnapshot.length),
            snapLabels: snapLabelsSnapshot,
            cornerRadii: draft.cornerRadii,
            userDrawn: true,
            mainCableTrail: mainCableTrailSnapshot,
            subCableTrail: subCableTrailSnapshot,
          });
        }
        if (!createdRef) {
          b()?.updateStatus?.('Could not save cable — adjust points and double-click again', true);
          return;
        }

        var verified = (S.fiberCablePaths || []).some(function (p) { return p.id === createdRef.id; });
        if (!verified) {
          console.error('[finishPenDrawing] cable missing from fiberCablePaths after save', createdRef.id);
          b()?.updateStatus?.('Cable save verification failed — try the emergency save button', true);
          return;
        }

        S.penDraft = null;
        clearCableContinueSession();
        unbindPenPointerTracking();
        cancelRubberBandRaf();
        hidePenDrawingOverlays();
        updatePenSnapGlow();
        updateReconnectSnapGlow();
        b()?.renderGlobalDrawingLayer?.();
        b()?.requestCanvasRedraw?.();
        b()?.syncPenModeClass?.();
        b()?.syncDrawingLayerInteraction?.();
        b()?.refreshLabelsAfterPathCommit?.();
        Sim.selectedPath = null;
        if (!Sim.ui) Sim.ui = {};
        Sim.ui.topologyTreeFocus = {
          kind: 'cable',
          pathType: 'fiber',
          pathId: createdRef.id,
        };
        b()?.syncBatchDuplicationHintForDrawingState?.();
        b()?.renderUnifiedSidebar?.();

        var connectedTo = buildPathConnectedTo(snapLabelsSnapshot);
        var saveLabel = createdRef.cable?.asBuiltId || createdRef.cable?.name || draft.cableName || '';
        b()?.updateStatus?.(
          (wasContinue ? 'Cable ' + saveLabel + ' continued ✓ · ' : 'Cable ' + saveLabel + ' saved ✓ · ') +
          (connectedTo.start || '—') + ' → ' + (connectedTo.end || '—')
        );
      } finally {
        cableSaveInProgress = false;
      }
      return;
    }

    var createdRef = persistPenDraftToPaths(draft, { trimDblClick: !!opts.trimDblClick });
    if (!createdRef) {
      b()?.updateStatus?.('Could not save path — keep at least 2 points', true);
      return;
    }
    var mergedIntoExisting = !!(draft.reconnectFrom && (draft.reconnectTo ||
      draft.reconnectFrom.vertexIndex != null || draft.reconnectFrom.end));
    S.penDraft = null;
    unbindPenPointerTracking();
    cancelRubberBandRaf();
    hidePenDrawingOverlays();
    updatePenSnapGlow();
    updateReconnectSnapGlow();
    b()?.renderGlobalDrawingLayer?.();
    b()?.updateMetrics?.();
    b()?.syncPenModeClass?.();
    b()?.syncDrawingLayerInteraction?.();
    b()?.refreshLabelsAfterPathCommit?.();
    if (createdRef.type === 'fiber') {
      b()?.selectPath?.('fiber', createdRef.id, false);
    }
    var connectedTo = buildPathConnectedTo(draft.snapLabels || []);
    if (mergedIntoExisting) {
      b()?.updateStatus?.('Path merged ✓ — loop preserved · connected segment added · ' +
        (connectedTo.start || '—') + ' → ' + (connectedTo.end || '—'));
    } else {
      b()?.updateStatus?.('Path saved ✓ · ' + (connectedTo.start || '—') + ' → ' + (connectedTo.end || '—'));
    }
  }

  function handlePenKeyDown(e) {
    var S = sim();
    var penArmed = !!(b()?.isPenToolActive?.() || S?.penDraft);
    if (!penArmed) return false;
    var key = e.key;
    var mod = e.ctrlKey || e.metaKey;
    var k = key.toLowerCase();
    if (key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (S?.penDraft?.points?.length) {
        if (b()?.resetDrawingPointsKeepTool) {
          b().resetDrawingPointsKeepTool();
        } else {
          cancelCurrentDrawing();
        }
        return true;
      }
      return true;
    }
    if ((mod && k === 'z' && !e.shiftKey) || (key === 'Backspace' && !mod)) {
      if (!S?.penDraft?.points?.length) return false;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation?.();
      removeLastVertex();
      return true;
    }
    if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) {
      if (!S?.penDraft?.vertexRedo?.length) return false;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation?.();
      redoLastVertex();
      return true;
    }
    if (key === 'Enter') {
      if (S?.pen?.lineMode === 'cable') return false;
      e.preventDefault();
      e.stopPropagation();
      finishPenDrawing({ trimDblClick: false, finishEvent: null });
      return true;
    }
    return false;
  }

  function onPenPointerDown(e) {
    if (!b()?.canPenDraw?.()) return false;
    if (e?.button === 1) return false;
    if (penFinishingDblClick || cableFinishingDblClick) return true;
    if (e?.detail >= 2) {
      return onPenDblClick(e);
    }
    syncPenPointerTracking();
    var S = sim();

    var draftVtx = pickPenDraftVertexIndex(e);
    if (draftVtx >= 0) {
      return beginPenDraftVertexDrag(e, draftVtx);
    }

    if (S?.pen?.lineMode === 'cable') {
      if (cableFinishingDblClick || cableSaveInProgress) return true;
      if (cableContinuePromptLocked) {
        e.preventDefault();
        e.stopPropagation();
        b()?.updateStatus?.(
          'Continue ' + (cableContinueOffer?.label || 'batch') +
          ' — choose Yes to merge or No for a new cable',
          true
        );
        return true;
      }
      var cableAdded = addPenVertexFromEvent(e);
      if (cableAdded) {
        e.preventDefault();
        e.stopPropagation();
      }
      return cableAdded;
    }

    var draft = S?.penDraft;

    var handled = false;
    if (!draft?.points?.length) handled = !!tryPenReconnectOrAdd(e);
    else {
      handled = !!addPenVertexFromEvent(e);
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
    return handled;
  }

  function upsertSvgLine(svg, id, className, x1, y1, x2, y2, stroke, dash) {
    var line = svg.querySelector('#' + id);
    if (!line) {
      line = document.createElementNS(SVG_NS, 'line');
      line.id = id;
      line.setAttribute('class', className);
      line.setAttribute('stroke-linecap', 'butt');
      line.setAttribute('pointer-events', 'none');
      line.setAttribute('filter', 'none');
      svg.appendChild(line);
    }
    setSvgLineCoords(line, x1, y1, x2, y2);
    line.setAttribute('stroke', stroke);
    line.setAttribute('stroke-width', '2.5');
    line.setAttribute('stroke-linecap', 'butt');
    if (dash) line.setAttribute('stroke-dasharray', dash);
    else line.removeAttribute('stroke-dasharray');
    line.style.display = '';
    return line;
  }

  function hideSvgEl(svg, id) {
    var el = svg && svg.querySelector('#' + id);
    if (el) el.style.display = 'none';
  }

  function isEndpointFree(path, vertexIndex) {
    if (!path?.points || path.points.length < 2) return false;
    var fe = path.freeEnds;
    if (fe) return vertexIndex === 0 ? !!fe.start : !!fe.end;
    var ct = path.connectedTo || {};
    return vertexIndex === 0 ? !ct.start : !ct.end;
  }

  function findCrosshairSnapTarget(x, y, clientX, clientY) {
    if (clientX != null && clientY != null) {
      var bestNode = null;
      var bestDistSq = SNAP_THRESHOLD_SQ + 1;
      (sim()?.nodes || []).forEach(function (node) {
        if (!isSnappableDeviceNode(node)) return;
        var c = getDeviceSnapCenter(node);
        if (!c) return;
        var d2 = screenDistSqToDevice(node, clientX, clientY);
        if (d2 <= SNAP_THRESHOLD_SQ && d2 < bestDistSq) {
          bestDistSq = d2;
          bestNode = { kind: 'node', x: c.x, y: c.y, label: c.label };
        }
      });
      if (bestNode) return bestNode;
    }
    return null;
  }

  var crosshairOverMap = false;
  var crosshairHoverRaf = 0;
  var crosshairHoverClient = null;

  function getMapCanvasElement() {
    return document.getElementById('city-canvas') ||
      document.getElementById('canvas-zoom-inner') ||
      document.getElementById('canvas-wrapper');
  }

  function isPointOverMapCanvas(clientX, clientY) {
    var mapEl = getMapCanvasElement();
    if (!mapEl) return false;
    var rect = mapEl.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
      return false;
    }
    var panel = document.getElementById('pathway-properties-modal');
    if (panel && !panel.classList.contains('hidden') &&
        (panel.classList.contains('active') || panel.classList.contains('is-expanded'))) {
      var pr = panel.getBoundingClientRect();
      if (clientX >= pr.left && clientX <= pr.right && clientY >= pr.top && clientY <= pr.bottom) return false;
    }
    var gridCtrl = document.querySelector('#canvas-wrapper .grid-controls');
    if (gridCtrl) {
      var gr = gridCtrl.getBoundingClientRect();
      if (clientX >= gr.left && clientX <= gr.right && clientY >= gr.top && clientY <= gr.bottom) return false;
    }
    return true;
  }

  function scheduleCrosshairMapHoverCheck(clientX, clientY) {
    crosshairHoverClient = { x: clientX, y: clientY };
    if (crosshairHoverRaf) return;
    crosshairHoverRaf = requestAnimationFrame(function () {
      crosshairHoverRaf = 0;
      var pt = crosshairHoverClient;
      crosshairHoverClient = null;
      if (!pt) return;
      setCrosshairMapHover(isPointOverMapCanvas(pt.x, pt.y));
    });
  }

  function isCrosshairOverMap() {
    return crosshairOverMap;
  }

  function setCrosshairMapHover(over) {
    var next = !!over;
    if (crosshairOverMap === next) return;
    crosshairOverMap = next;
    if (!next) {
      hideCrosshair();
      var S = sim();
      if (S?.pathEdit) S.pathEdit.insertHover = null;
    }
    b()?.syncDrawingLayerInteraction?.();
  }

  function syncCrosshairMapHoverFromEvent(e) {
    if (!e || e.clientX == null || e.clientY == null) {
      setCrosshairMapHover(false);
      return;
    }
    setCrosshairMapHover(isPointOverMapCanvas(e.clientX, e.clientY));
  }

  function bindCrosshairBoundaries() {
    if (sim()?.ui?.crosshairBoundBound) return;
    var mapEl = getMapCanvasElement();
    var wrap = document.getElementById('canvas-wrapper');

    function onEnter() { setCrosshairMapHover(true); }
    function onLeave() { setCrosshairMapHover(false); }

    if (mapEl) {
      mapEl.addEventListener('mouseenter', onEnter);
      mapEl.addEventListener('mouseleave', onLeave);
    }
    if (wrap && wrap !== mapEl) {
      wrap.addEventListener('mouseleave', onLeave);
    }

    document.addEventListener('mousemove', function (e) {
      if (!shouldShowCrosshairToolwise()) {
        if (crosshairOverMap) setCrosshairMapHover(false);
        return;
      }
      scheduleCrosshairMapHoverCheck(e.clientX, e.clientY);
    }, { passive: true });

    document.addEventListener('mouseleave', onLeave);

    var ui = sim()?.ui;
    if (ui) ui.crosshairBoundBound = true;
    bindGhostSafetyListeners();
    bindCutPointerSafety();
  }

  function shouldShowCrosshairToolwise() {
    var S = sim();
    var tool = b()?.getActiveCanvasTool?.() || 'select';
    if (tool === 'cut') return false;
    if (tool === 'vertex') return true;
    if (S?.interactionMode === 'hand') return false;
    if (b()?.canPenDraw?.()) return true;
    return false;
  }

  function shouldShowCrosshair() {
    if (!crosshairOverMap) return false;
    return shouldShowCrosshairToolwise();
  }

  function updateCrosshairState(x, y, snapped, snapX, snapY, snapKind) {
    var S = sim();
    if (!S) return;
    if (!shouldShowCrosshair()) {
      S.crosshair = null;
      return;
    }
    S.crosshair = {
      x: x, y: y,
      visible: true,
      snapped: !!snapped,
      snapX: snapped ? snapX : x,
      snapY: snapped ? snapY : y,
      snapKind: snapped ? (snapKind || null) : null,
    };
  }

  function updateVertexInsertHover(x, y) {
    var S = sim();
    if (!S?.pathEdit) return;
    if (b()?.getActiveCanvasTool?.() !== 'vertex' || S.pathEdit.ghostDragging) {
      S.pathEdit.insertHover = null;
      return;
    }
    var editor = global.FTTHPathwayEditor;
    S.pathEdit.insertHover = editor?.hitTestSegmentInsertOnSelected?.(x, y) || null;
  }

  function updateCrosshairFromXY(x, y, clientX, clientY) {
    updateVertexInsertHover(x, y);
    if (clientX != null && clientY != null) {
      if (b()?.canPenDraw?.()) {
        var penSnap = getSnappedPosition(clientX, clientY, x, y, { mode: 'pen' });
        var px = isFinite(penSnap.x) ? penSnap.x : x;
        var py = isFinite(penSnap.y) ? penSnap.y : y;
        updateCrosshairState(x, y, penSnap.snapped, px, py, penSnap.target?.kind || null);
        return;
      }
      if (b()?.canVertexEdit?.()) {
        var vtxSnap = getSnappedPosition(clientX, clientY, x, y, { mode: 'crosshair', activePathOnly: true });
        var vx = isFinite(vtxSnap.x) ? vtxSnap.x : x;
        var vy = isFinite(vtxSnap.y) ? vtxSnap.y : y;
        updateCrosshairState(x, y, vtxSnap.snapped, vx, vy, vtxSnap.target?.kind || null);
        return;
      }
    }
    var snap = findCrosshairSnapTarget(x, y, clientX, clientY);
    if (snap) updateCrosshairState(x, y, true, snap.x, snap.y, snap.kind || null);
    else updateCrosshairState(x, y, false, x, y, null);
  }

  function updateCrosshairFromEvent(e) {
    beginScreenCtmCacheFrame();
    try {
    syncCrosshairMapHoverFromEvent(e);
    if (!shouldShowCrosshair()) {
      var S = sim();
      if (S) S.crosshair = null;
      b()?.requestOverlayRedraw?.();
      return false;
    }
    var xy = b()?.getSVGCoordinates?.(e) || b()?.pointerEventToCanvasXY?.(e);
    if (!xy) return false;
    updateCrosshairFromXY(xy.x, xy.y, e.clientX, e.clientY);
    b()?.requestOverlayRedraw?.();
    return true;
    } finally {
      sealScreenCtmCacheFrame();
    }
  }

  function hidePenDrawingOverlays() {
    var S = sim();
    if (S) S.crosshair = null;
    clearMainCableVisualSession();
    var svg = b()?.ensureGlobalDrawingLayer?.();
    if (!svg) return;
    hideSvgEl(svg, 'qfield-crosshair');
    hideSvgEl(svg, 'pen-rubber-band');
    hideSvgEl(svg, 'pen-vertex-markers');
    hideSvgEl(svg, 'cable-anchor-dots');
    hideSvgEl(svg, 'cable-magnetic-snap-marker');
    hideSvgEl(svg, 'pen-draft-live-path');
    hideSvgEl(svg, 'device-snap-center-point');
    if (!cableContinuePromptLocked) hideCableContinueFab();
  }

  function penToolCrosshairInk() {
    var S = sim();
    if (S?.pen?.lineMode === 'cable') {
      var phase = getCableInteractiveCursorPhase();
      if (phase === 'main-confirm' || phase === 'main-closure-confirm' ||
          phase === 'sub-confirm' || phase === 'sub-drop-confirm') {
        return { ring: MAIN_CABLE_CONFIRM_RING, plus: MAIN_CABLE_CONFIRM_RING };
      }
      if (phase === 'main-cabinet-hover') {
        return { ring: MAIN_CABLE_HOVER_RING, plus: MAIN_CABLE_HOVER_RING };
      }
      if (phase === 'main-closure-hover') {
        return { ring: MAIN_CABLE_CLOSURE_HOVER_RING, plus: MAIN_CABLE_CLOSURE_HOVER_RING };
      }
      if (phase === 'sub-closure-hover') {
        return { ring: SUB_CABLE_START_HOVER_RING, plus: SUB_CABLE_START_HOVER_RING };
      }
      if (phase === 'sub-drop-hover') {
        return { ring: SUB_CABLE_DROP_HOVER_RING, plus: SUB_CABLE_DROP_HOVER_RING };
      }
      return {
        ring: '#2563eb',
        plus: '#2563eb',
      };
    }
    var kind = S?.pen?.excavKind || S?.penDraft?.kind || 'direct_buried';
    var stroke = b()?.excavationStrokeForKind?.(kind);
    var color = (stroke && stroke.color) ? stroke.color : '#78716c';
    return {
      ring: color,
      plus: color,
    };
  }

  /** Shared hollow-ring + center-plus preview for trench and cable pen tools. */
  function getPenPreviewCrosshairStyle(vertexLocked) {
    var ink = penToolCrosshairInk();
    return {
      fill: 'none',
      stroke: ink.ring,
      strokeWidth: vertexLocked ? '1.4' : '1.5',
      dasharray: vertexLocked ? null : '7,5',
      plusColor: ink.plus,
      plusLen: vertexLocked ? PEN_VERTEX_SNAP_PLUS_LEN : PEN_TARGET_PLUS_LEN,
      radius: vertexLocked ? PEN_VERTEX_SNAP_RADIUS : PEN_TARGET_RADIUS,
      plusWeight: vertexLocked ? '1.6' : '1.3',
    };
  }

  function applyPenPreviewCrosshairRing(circle, style) {
    if (!circle || !style) return;
    circle.setAttribute('fill', style.fill);
    circle.setAttribute('stroke', style.stroke);
    circle.setAttribute('stroke-width', style.strokeWidth);
    if (style.dasharray) circle.setAttribute('stroke-dasharray', style.dasharray);
    else circle.removeAttribute('stroke-dasharray');
    circle.setAttribute('r', String(style.radius));
    circle.setAttribute('pointer-events', 'none');
  }

  function gisCrosshairInk(x, y) {
    var canvas = document.getElementById('city-canvas');
    var light = canvas && canvas.getAttribute('data-map-theme') === 'light';
    if (light) {
      return { ring: '#0f172a', plus: '#0f172a', fill: 'rgba(15, 23, 42, 0.14)' };
    }
    return { ring: '#ffffff', plus: '#f8fafc', fill: 'rgba(255, 255, 255, 0.18)' };
  }

  function appendGisPlus(parent, x, y, len, color, strokeWidth) {
    var sx = snapPixel(x);
    var sy = snapPixel(y);
    var sw = strokeWidth || '1.2';
    var hLine = document.createElementNS(SVG_NS, 'line');
    hLine.setAttribute('x1', snapPixel(sx - len));
    hLine.setAttribute('y1', sy);
    hLine.setAttribute('x2', snapPixel(sx + len));
    hLine.setAttribute('y2', sy);
    hLine.setAttribute('stroke', color);
    hLine.setAttribute('stroke-width', sw);
    hLine.setAttribute('filter', 'none');
    hLine.setAttribute('stroke-linecap', 'round');
    parent.appendChild(hLine);

    var vLine = document.createElementNS(SVG_NS, 'line');
    vLine.setAttribute('x1', sx);
    vLine.setAttribute('y1', snapPixel(sy - len));
    vLine.setAttribute('x2', sx);
    vLine.setAttribute('y2', snapPixel(sy + len));
    vLine.setAttribute('stroke', color);
    vLine.setAttribute('stroke-width', sw);
    vLine.setAttribute('filter', 'none');
    vLine.setAttribute('stroke-linecap', 'round');
    parent.appendChild(vLine);
  }

  function renderPenPlacedVertices(svg) {
    if (!svg) return;
    if (!b()?.canPenDraw?.()) {
      hideSvgEl(svg, 'pen-vertex-markers');
      hideSvgEl(svg, 'cable-anchor-dots');
      return;
    }
    var draft = sim()?.penDraft;
    if (!draft?.points?.length) {
      hideSvgEl(svg, 'pen-vertex-markers');
      hideSvgEl(svg, 'cable-anchor-dots');
      return;
    }

    if (draft.lineMode === 'cable') {
      hideSvgEl(svg, 'pen-vertex-markers');
      hideSvgEl(svg, 'cable-anchor-dots');
      return;
    }

    hideSvgEl(svg, 'cable-anchor-dots');
    hideSvgEl(svg, 'pen-vertex-markers');
  }

  function renderCableAnchorDots(svg, draft) {
    if (!svg || !draft?.points?.length) {
      hideSvgEl(svg, 'cable-anchor-dots');
      return;
    }

    var g = svg.querySelector('#cable-anchor-dots');
    if (!g) {
      g = document.createElementNS(SVG_NS, 'g');
      g.id = 'cable-anchor-dots';
      g.setAttribute('class', 'cable-anchor-dots');
      g.setAttribute('pointer-events', 'none');
      mountOverlayEl(svg, g);
    } else {
      mountOverlayEl(svg, g);
    }
    g.innerHTML = '';

    draft.points.forEach(function (pt, idx) {
      if (!pt) return;
      var nodeId = draft.pointSnapNodeIds?.[idx];
      var isHandhole = !!nodeId;
      var dot = document.createElementNS(SVG_NS, 'circle');
      setSvgCircleCenter(dot, pt[0], pt[1]);
      dot.setAttribute('r', String(CABLE_ANCHOR_DOT_RADIUS));
      dot.setAttribute('class', 'cable-anchor-dot' + (isHandhole ? ' cable-anchor-dot--handhole' : ''));
      dot.setAttribute('fill', isHandhole ? '#15803d' : '#1e3a8a');
      dot.setAttribute('stroke', isHandhole ? '#22c55e' : '#2563eb');
      dot.setAttribute('stroke-width', '1.5');
      dot.setAttribute('filter', 'none');
      g.appendChild(dot);
    });
    g.style.display = '';
  }

  function renderPenTargetCrosshair(g, x, y, snapped) {
    var S = sim();
    var snapKind = S?.crosshair?.snapKind;
    var vertexLocked = !!(snapped && (
      snapKind === 'path-vertex' || snapKind === 'path-endpoint' ||
      snapKind === 'trench-vertex' || snapKind === 'trench-segment' ||
      snapKind === 'cable-segment' || snapKind === 'handhole' || snapKind === 'device'
    ));
    var clickPulse = !!(S?.penClickPulseUntil && Date.now() < S.penClickPulseUntil);
    var toolClass = S?.pen?.lineMode === 'cable'
      ? ' qfield-crosshair--cable-tool'
      : ' qfield-crosshair--excav-tool';
    var cuePhase = getCableInteractiveCursorPhase();
    var cueClass = '';
    if (cuePhase === 'main-confirm') cueClass = ' qfield-crosshair--cabinet-confirm';
    else if (cuePhase === 'main-closure-confirm' || cuePhase === 'sub-confirm' ||
             cuePhase === 'sub-drop-confirm') {
      cueClass = ' qfield-crosshair--closure-confirm';
    } else if (cuePhase === 'main-cabinet-hover') cueClass = ' qfield-crosshair--cabinet-hover';
    else if (cuePhase === 'main-closure-hover') cueClass = ' qfield-crosshair--closure-hover';
    else if (cuePhase === 'sub-closure-hover') cueClass = ' qfield-crosshair--sub-closure-hover';
    else if (cuePhase === 'sub-drop-hover') cueClass = ' qfield-crosshair--sub-drop-hover';
    g.setAttribute('class', 'qfield-crosshair qfield-crosshair--pen-target' + toolClass +
      (vertexLocked ? ' qfield-crosshair--vertex-locked' : '') +
      (clickPulse ? ' qfield-crosshair--click-pulse' : '') +
      cueClass);
    if (clickPulse) {
      g.style.transformOrigin = x + 'px ' + y + 'px';
    } else {
      g.style.transformOrigin = '';
      g.style.transform = '';
    }

    var style = getPenPreviewCrosshairStyle(vertexLocked);

    var circle = g.querySelector('.qfield-crosshair__ring');
    if (!circle) {
      circle = document.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('class', 'qfield-crosshair__ring');
      circle.setAttribute('filter', 'none');
      g.appendChild(circle);
    }
    setSvgCircleCenter(circle, x, y);
    applyPenPreviewCrosshairRing(circle, style);

    var plusG = g.querySelector('.qfield-crosshair__plus');
    if (!plusG) {
      plusG = document.createElementNS(SVG_NS, 'g');
      plusG.setAttribute('class', 'qfield-crosshair__plus');
      g.appendChild(plusG);
    }
    plusG.innerHTML = '';
    appendGisPlus(plusG, x, y, style.plusLen, style.plusColor, style.plusWeight);
  }

  function renderVertexToolCrosshair(g, x, y, ch) {
    g.setAttribute('class', 'qfield-crosshair qfield-crosshair--vertex');
    var r = ch.snapped ? 6 : 9;
    var plusLen = ch.snapped ? 3 : 4;
    var circle = document.createElementNS(SVG_NS, 'circle');
    setSvgCircleCenter(circle, x, y);
    circle.setAttribute('r', String(r));
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', CROSSHAIR_STROKE);
    circle.setAttribute('stroke-width', ch.snapped ? '1.5' : '1.2');
    circle.setAttribute('filter', 'none');
    if (!ch.snapped) circle.setAttribute('stroke-dasharray', '5,4');
    g.appendChild(circle);
    appendGisPlus(g, x, y, plusLen, CROSSHAIR_PLUS, '1');
  }

  function hideCrosshair() {
    var S = sim();
    if (S) S.crosshair = null;
    var svg = b()?.ensureGlobalDrawingLayer?.();
    if (svg) hideSvgEl(svg, 'qfield-crosshair');
  }

  function renderCrosshair(svg) {
    if (!svg) return;
    var S = sim();
    var ch = S?.crosshair;
    var cuePhase = getCableInteractiveCursorPhase();
    var holdConfirmRing = (
      cuePhase === 'main-confirm' || cuePhase === 'main-closure-confirm' ||
      cuePhase === 'sub-confirm' || cuePhase === 'sub-drop-confirm'
    ) && !!S?.mainCableConfirmOrigin;
    if (!ch?.visible || !shouldShowCrosshair()) {
      /* Keep green confirm ring visible briefly even if crosshair was cleared mid-timer */
      if (!holdConfirmRing) {
        hideSvgEl(svg, 'qfield-crosshair');
        return;
      }
      ch = {
        visible: true,
        snapped: true,
        snapX: S.mainCableConfirmOrigin.x,
        snapY: S.mainCableConfirmOrigin.y,
        x: S.mainCableConfirmOrigin.x,
        y: S.mainCableConfirmOrigin.y,
      };
    }
    if (S?.pen?.lineMode === 'cable' && b()?.canPenDraw?.() && !ch.snapped && !holdConfirmRing) {
      hideSvgEl(svg, 'qfield-crosshair');
      return;
    }
    var x = snapPixel(
      (holdConfirmRing)
        ? S.mainCableConfirmOrigin.x
        : (ch.snapped ? ch.snapX : ch.x)
    );
    var y = snapPixel(
      (holdConfirmRing)
        ? S.mainCableConfirmOrigin.y
        : (ch.snapped ? ch.snapY : ch.y)
    );
    var g = svg.querySelector('#qfield-crosshair');
    if (!g) {
      g = document.createElementNS(SVG_NS, 'g');
      g.id = 'qfield-crosshair';
      g.setAttribute('pointer-events', 'none');
      mountOverlayEl(svg, g);
    } else {
      mountOverlayEl(svg, g);
    }

    if (b()?.canPenDraw?.()) {
      renderPenTargetCrosshair(g, x, y, !!ch.snapped);
    } else {
      g.innerHTML = '';
      renderVertexToolCrosshair(g, x, y, ch);
    }
    g.style.display = '';
  }

  function renderCutOverlays(svg) {
    if (!svg) return;
    var pe = sim()?.pathEdit;
    var tool = b()?.getActiveCanvasTool?.() || 'select';

    if (tool !== 'cut' || !pe?.cutHover) {
      hideSvgEl(svg, 'cut-hover-segment');
    } else {
      var h = pe.cutHover;
      upsertSvgLine(svg, 'cut-hover-segment', 'cut-hover-segment',
        h.x1, h.y1, h.x2, h.y2, CUT_PREVIEW_COLOR, null);
    }

    if (tool !== 'cut' || !pe?.cutSwipe) {
      hideSvgEl(svg, 'cut-swipe-line');
    } else {
      var sw = pe.cutSwipe;
      upsertSvgLine(svg, 'cut-swipe-line', 'cut-swipe-line',
        sw.x0, sw.y0, sw.x1, sw.y1, CUT_PREVIEW_COLOR, '6,5');
    }
  }

  function renderCutOpenDots(svg) {
    if (!svg) return;
    var tool = b()?.getActiveCanvasTool?.() || 'select';
    var host = svg.querySelector('#cut-open-dots-layer');
    if (tool !== 'cut') {
      if (host) host.innerHTML = '';
      return;
    }
    if (!host) {
      host = document.createElementNS(SVG_NS, 'g');
      host.id = 'cut-open-dots-layer';
      host.setAttribute('pointer-events', 'none');
      svg.appendChild(host);
    }
    host.innerHTML = '';
    var editor = global.FTTHPathwayEditor;
    if (!editor?.iterateAllPaths) return;
    editor.iterateAllPaths(function (type, path) {
      var pts = path?.points;
      if (!pts || pts.length < 2) return;
      [[0, 'start'], [pts.length - 1, 'end']].forEach(function (pair) {
        if (!isEndpointFree(path, pair[0])) return;
        var pt = pts[pair[0]];
        if (!pt) return;
        var dot = document.createElementNS(SVG_NS, 'circle');
        dot.setAttribute('class', 'cut-open-dot');
        setSvgCircleCenter(dot, pt[0], pt[1]);
        dot.setAttribute('r', '3');
        dot.setAttribute('fill', CUT_OPEN_DOT_COLOR);
        dot.setAttribute('stroke', 'none');
        dot.setAttribute('filter', 'none');
        host.appendChild(dot);
      });
    });
  }

  function renderVertexInsertPreview(svg) {
    if (!svg) return;
    var hover = sim()?.pathEdit?.insertHover;
    var dragging = sim()?.pathEdit?.ghostDragging;
    if (!hover || dragging || b()?.getActiveCanvasTool?.() !== 'vertex') {
      hideSvgEl(svg, 'vertex-insert-preview');
      return;
    }
    var size = 4;
    var g = svg.querySelector('#vertex-insert-preview');
    if (!g) {
      g = document.createElementNS(SVG_NS, 'g');
      g.id = 'vertex-insert-preview';
      g.setAttribute('class', 'vertex-insert-preview');
      g.setAttribute('pointer-events', 'none');
      svg.appendChild(g);
    }
    g.innerHTML = '';
    var hx = snapPixel(hover.x);
    var hy = snapPixel(hover.y);
    var diamond = document.createElementNS(SVG_NS, 'polygon');
    diamond.setAttribute('class', 'vertex-insert-preview__diamond');
    diamond.setAttribute('points',
      hx + ',' + snapPixel(hy - size) + ' ' +
      snapPixel(hx + size) + ',' + hy + ' ' +
      hx + ',' + snapPixel(hy + size) + ' ' +
      snapPixel(hx - size) + ',' + hy
    );
    diamond.setAttribute('fill', 'none');
    diamond.setAttribute('stroke', '#dc2626');
    diamond.setAttribute('stroke-width', '1.5');
    diamond.setAttribute('filter', 'none');
    g.appendChild(diamond);
    g.style.display = '';
  }

  function renderActiveVertexRing(svg) {
    if (!svg) return;
    var S = sim();
    var pe = S?.pathEdit;
    if (!pe?.ghostActive && !pe?.ghostPendingCommit) {
      hideSvgEl(svg, 'vertex-active-ring');
      return;
    }
    var pt;
    if (pe.ghostPosition) {
      pt = [pe.ghostPosition.x, pe.ghostPosition.y];
    } else if (pe.frozenPoints?.[pe.selectedVertexIndex]) {
      pt = pe.frozenPoints[pe.selectedVertexIndex];
    } else {
      var path = b()?.findPathByRef?.(S.selectedPath);
      pt = path?.points?.[pe.selectedVertexIndex];
    }
    if (!pt) {
      hideSvgEl(svg, 'vertex-active-ring');
      return;
    }
    patchActiveVertexRing(svg, pt, pe.ghostSnapped);
  }

  function snapGhostXY(x, y) {
    var nx = Number(x);
    var ny = Number(y);
    if (!isFinite(nx) || !isFinite(ny)) return { x: 0, y: 0 };
    return {
      x: Math.round(nx * 10) / 10,
      y: Math.round(ny * 10) / 10,
    };
  }

  function snapFallback(canvasX, canvasY) {
    var free = snapGhostXY(canvasX, canvasY);
    return { x: free.x, y: free.y, snapped: false, target: null, snapLabel: null, snapNodeId: null };
  }

  var screenCtmCacheGen = 0;
  var screenCtmCache = { gen: -1, svg: null, ctm: null };
  var screenCtmCacheSealed = true;

  /** One getScreenCTM() per pointer/snap frame — reused by all snap distance tests. */
  function beginScreenCtmCacheFrame() {
    if (!screenCtmCacheSealed) return;
    screenCtmCacheSealed = false;
    screenCtmCacheGen++;
  }

  function sealScreenCtmCacheFrame() {
    screenCtmCacheSealed = true;
  }

  function getCachedScreenCTM(svg) {
    if (!svg?.getScreenCTM) return null;
    if (screenCtmCache.gen === screenCtmCacheGen && screenCtmCache.svg === svg) {
      return screenCtmCache.ctm;
    }
    var ctm = svg.getScreenCTM();
    screenCtmCache = { gen: screenCtmCacheGen, svg: svg, ctm: ctm };
    return ctm;
  }

  function canvasXYToScreenXY(cx, cy) {
    var svg = b()?.ensureGlobalDrawingLayer?.();
    if (!svg?.createSVGPoint) return { x: cx, y: cy };
    try {
      var pt = svg.createSVGPoint();
      pt.x = cx;
      pt.y = cy;
      var ctm = getCachedScreenCTM(svg);
      if (!ctm) return { x: cx, y: cy };
      var sp = pt.matrixTransform(ctm);
      return { x: sp.x, y: sp.y };
    } catch (err) {
      return { x: cx, y: cy };
    }
  }

  function probeCanvasFromClient(clientX, clientY) {
    if (clientX == null || clientY == null) return null;
    return b()?.pointerClientToCanvasXY?.(clientX, clientY) || null;
  }

  /** Reject snaps whose map distance exceeds MAX_SNAP_MAP_UNITS (zoom overreach guard). */
  function exceedsMaxSnapMapUnits(clientX, clientY, cx, cy) {
    if (!isFinite(cx) || !isFinite(cy)) return true;
    var probe = probeCanvasFromClient(clientX, clientY);
    if (!probe || !isFinite(probe.x) || !isFinite(probe.y)) return false;
    return Math.hypot(probe.x - cx, probe.y - cy) > MAX_SNAP_MAP_UNITS;
  }

  function screenDistSqToCanvasPoint(clientX, clientY, cx, cy) {
    if (exceedsMaxSnapMapUnits(clientX, clientY, cx, cy)) return Infinity;
    var sp = canvasXYToScreenXY(cx, cy);
    var dx = sp.x - clientX;
    var dy = sp.y - clientY;
    return dx * dx + dy * dy;
  }

  function screenDistSqBetweenCanvasPoints(ax, ay, bx, by) {
    if (!isFinite(ax) || !isFinite(ay) || !isFinite(bx) || !isFinite(by)) return Infinity;
    var sp1 = canvasXYToScreenXY(ax, ay);
    var sp2 = canvasXYToScreenXY(bx, by);
    var dx = sp1.x - sp2.x;
    var dy = sp1.y - sp2.y;
    return dx * dx + dy * dy;
  }

  function makeSnapResult(hit, scope) {
    return {
      x: hit.x,
      y: hit.y,
      snapped: true,
      snapLabel: hit.label || null,
      snapNodeId: hit.nodeId || null,
      target: {
        kind: hit.kind || hit.snapKind || 'vertex',
        scope: scope,
        pathType: hit.pathType,
        pathId: hit.pathId,
        vertexIndex: hit.vertexIndex,
        segIndex: hit.segIndex,
        connectorIndex: hit.connectorIndex,
        end: hit.end,
        nodeId: hit.nodeId,
        label: hit.label,
        snapKind: hit.snapKind || hit.kind,
        x: hit.x,
        y: hit.y,
      },
    };
  }

  function penSnapKindPriority(kind) {
    if (kind === 'device' || kind === 'handhole') return 30;
    if (kind === 'path-endpoint' || kind === 'path-vertex' || kind === 'trench-vertex') return 20;
    if (kind === 'trench-segment' || kind === 'cable-segment') return 10;
    return 0;
  }

  function guideSnapToHit(guide) {
    if (!guide) return null;
    var target = guide.target || {};
    return {
      x: guide.x,
      y: guide.y,
      kind: guide.snapKind || target.kind || 'trench-segment',
      snapKind: guide.snapKind || target.kind,
      pathType: target.pathType,
      pathId: target.pathId,
      vertexIndex: target.vertexIndex,
      segIndex: target.segIndex,
      connectorIndex: target.connectorIndex,
      nodeId: guide.snapNodeId || target.nodeId,
      label: guide.snapLabel || target.label,
    };
  }

  function mergePenGuideWithPointerHit(guideSnap, pointerHit, clientX, clientY) {
    if (!guideSnap && !pointerHit) return null;
    if (!guideSnap) return pointerHit;
    var guideHit = guideSnapToHit(guideSnap);
    if (!pointerHit) return guideHit;
    var guideKind = guideHit.kind;
    var pointerKind = pointerHit.kind;
    var guidePriority = penSnapKindPriority(guideKind);
    var pointerPriority = penSnapKindPriority(pointerKind);
    if (pointerPriority > guidePriority) return pointerHit;
    if (guidePriority > pointerPriority) return guideHit;
    var guideD2 = screenDistSqToCanvasPoint(clientX, clientY, guideHit.x, guideHit.y);
    var pointerD2 = screenDistSqToCanvasPoint(clientX, clientY, pointerHit.x, pointerHit.y);
    return guideD2 <= pointerD2 ? guideHit : pointerHit;
  }

  function screenDistSqToDevice(node, clientX, clientY) {
    if (!node) return Infinity;
    var mapCenter = getDeviceSnapCenter(node) || b()?.getNodeCenterXY?.(node);
    if (mapCenter && exceedsMaxSnapMapUnits(clientX, clientY, mapCenter.x, mapCenter.y)) {
      return Infinity;
    }
    var placed = document.querySelector('.placed-node[data-id="' + node.id + '"]');
    var glyph = placed ? queryDeviceGlyphEl(placed) : null;
    if (glyph && glyph.getBoundingClientRect) {
      var rect = glyph.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        var gx = rect.left + rect.width / 2;
        var gy = rect.top + rect.height / 2;
        var sdx = gx - clientX;
        var sdy = gy - clientY;
        return sdx * sdx + sdy * sdy;
      }
    }
    var gridCenter = mapCenter || b()?.getNodeCenterXY?.(node);
    if (!gridCenter) return Infinity;
    return screenDistSqToCanvasPoint(clientX, clientY, gridCenter.x, gridCenter.y);
  }

  function collectPointerSnapHit(clientX, clientY, opts) {
    opts = opts || {};
    var S = sim();
    var editor = global.FTTHPathwayEditor;
    var bestDistSq = SNAP_THRESHOLD_SQ + 1;
    var bestHit = null;

    function consider(x, y, meta) {
      if (!isFinite(x) || !isFinite(y)) return;
      if (exceedsMaxSnapMapUnits(clientX, clientY, x, y)) return;
      var d2 = screenDistSqToCanvasPoint(clientX, clientY, x, y);
      if (d2 <= SNAP_THRESHOLD_SQ && d2 <= bestDistSq) {
        bestDistSq = d2;
        bestHit = {
          x: x,
          y: y,
          kind: meta.kind || 'vertex',
          pathType: meta.pathType,
          pathId: meta.pathId,
          vertexIndex: meta.vertexIndex,
          nodeId: meta.nodeId,
          label: meta.label,
        };
      }
    }

    if (!opts.verticesOnly) {
      (S?.nodes || []).forEach(function (node) {
        if (!isSnappableDeviceNode(node)) return;
        var center = getDeviceSnapCenter(node);
        if (!center) return;
        var d2 = screenDistSqToDevice(node, clientX, clientY);
        if (d2 <= SNAP_THRESHOLD_SQ && d2 <= bestDistSq) {
          bestDistSq = d2;
          bestHit = {
            x: center.x,
            y: center.y,
            kind: 'device',
            nodeId: center.nodeId,
            label: center.label,
          };
        }
      });
    }

    if (!opts.devicesOnly && editor?.iterateAllPaths) {
      var sel = opts.activePathOnly ? S?.selectedPath : null;
      var penExcavSnap = opts.mode === 'pen' && sim()?.pen?.lineMode !== 'cable';
      var endpointsOnly = opts.endpointsOnly === true;
      var wantType = penExcavSnap ? getPenSnapPathType() : null;
      var reconnectRadiusSq = (global.FTTHPathwayEditor?.RECONNECT_SNAP_RADIUS || RECONNECT_SNAP_RADIUS);
      reconnectRadiusSq = reconnectRadiusSq * reconnectRadiusSq;
      editor.iterateAllPaths(function (type, path) {
        if (!path?.id || !path.points) return;
        if (wantType && type !== wantType) return;
        if (sel && (type !== sel.type || path.id !== sel.id)) return;
        if (opts.excludePath && type === opts.excludePath.type && path.id === opts.excludePath.id) return;
        var pts = path.points;
        var indexes = endpointsOnly && pts.length >= 2
          ? [0, pts.length - 1]
          : null;
        var count = indexes ? indexes.length : pts.length;
        for (var i = 0; i < count; i++) {
          var vi = indexes ? indexes[i] : i;
          var pt = pts[vi];
          if (!pt) continue;
          var vtxKind = (vi === 0 || vi === pts.length - 1) ? 'path-endpoint' : 'path-vertex';
          consider(pt[0], pt[1], {
            kind: endpointsOnly ? 'path-endpoint' : vtxKind,
            pathType: type,
            pathId: path.id,
            vertexIndex: vi,
          });
        }
        if (penExcavSnap && type === 'excavation' && editor.collectExcavationReconnectVertices) {
          editor.collectExcavationReconnectVertices(path).forEach(function (vtx) {
            if (!vtx?.pt) return;
            var d2 = screenDistSqToCanvasPoint(clientX, clientY, vtx.pt[0], vtx.pt[1]);
            if (d2 <= reconnectRadiusSq && d2 <= bestDistSq) {
              bestDistSq = d2;
              bestHit = {
                x: vtx.pt[0],
                y: vtx.pt[1],
                kind: vtx.kind || 'path-endpoint',
                pathType: type,
                pathId: path.id,
                vertexIndex: vtx.vertexIndex,
              };
            }
          });
        }
      });
    }

    return bestHit;
  }

  function getSnappedPosition(clientX, clientY, canvasX, canvasY, opts) {
    opts = opts || {};
    var fallbackX = isFinite(canvasX) ? canvasX : 0;
    var fallbackY = isFinite(canvasY) ? canvasY : 0;
    try {
      if (clientX == null || clientY == null) return snapFallback(fallbackX, fallbackY);

      var mode = opts.mode || 'crosshair';

      if (mode === 'ghost') {
      var S = sim();
      var editor = global.FTTHPathwayEditor;
      var ctx = getGhostContext(S?.pathEdit);
      var exType = opts.excludePath?.type || ctx?.pathType;
      var exId = opts.excludePath?.id || ctx?.pathId;
      var bestDistSq = SNAP_THRESHOLD_SQ;
      var otherHit = null;

      if (editor?.iterateAllPaths) {
        editor.iterateAllPaths(function (type, path) {
          if (!path?.id || !path.points) return;
          if (exType && exId && type === exType && path.id === exId) return;
          for (var i = 0; i < path.points.length; i++) {
            var pt = path.points[i];
            if (!pt) continue;
            var d2 = screenDistSqToCanvasPoint(clientX, clientY, pt[0], pt[1]);
            if (d2 <= bestDistSq) {
              bestDistSq = d2;
              otherHit = {
                x: pt[0], y: pt[1],
                pathType: type, pathId: path.id, vertexIndex: i,
              };
            }
          }
        });
      }
      if (otherHit) return makeSnapResult(otherHit, 'external');

      var frozen = S?.pathEdit?.frozenPoints;
      if (frozen?.length) {
        bestDistSq = SNAP_THRESHOLD_SQ;
        var sameHit = null;
        var dragIdx = ctx && !ctx.isNewVertex ? ctx.vertexIndex : null;
        for (var j = 0; j < frozen.length; j++) {
          if (dragIdx != null && j === dragIdx) continue;
          var fpt = frozen[j];
          if (!fpt) continue;
          var d2f = screenDistSqToCanvasPoint(clientX, clientY, fpt[0], fpt[1]);
          if (d2f <= bestDistSq) {
            bestDistSq = d2f;
            sameHit = {
              x: fpt[0], y: fpt[1],
              pathType: exType, pathId: exId, vertexIndex: j,
            };
          }
        }
        if (sameHit) return makeSnapResult(sameHit, 'same-path');
      }

      var deviceGhost = collectPointerSnapHit(clientX, clientY, { devicesOnly: true });
      if (deviceGhost) return makeSnapResult(normalizeDeviceSnapHit(deviceGhost), 'device');
    } else if (mode === 'pen' || mode === 'crosshair') {
      if (mode === 'pen' && b()?.isCablePenDrawActive?.()) {
        var cableDraft = sim()?.penDraft;
        var preferTrenchId = cableDraft?.trenchPathId || cableDraft?.hostTrenchId || null;
        var guided = b()?.findCableTrenchPathGuideSnap?.(
          clientX, clientY, canvasX, canvasY, preferTrenchId
        );
        if (guided) {
          return {
            x: guided.x,
            y: guided.y,
            snapped: true,
            snapLabel: guided.snapLabel || guided.target?.label || null,
            snapNodeId: null,
            target: guided.target || null,
          };
        }
        return snapFallback(fallbackX, fallbackY);
      }
      var pointerHit = null;
      var guideSnap = null;
      if (mode === 'pen' && sim()?.pen?.lineMode !== 'cable') {
        guideSnap = b()?.findPenPathGuideSnap?.(clientX, clientY, canvasX, canvasY);
      }
      pointerHit = collectPointerSnapHit(clientX, clientY, {
        activePathOnly: !!opts.activePathOnly && mode !== 'pen',
        mode: mode,
        excludePath: opts.excludePath,
      });
      var mergedHit = mergePenGuideWithPointerHit(guideSnap, pointerHit, clientX, clientY);
      if (mergedHit) {
        if (mergedHit.kind === 'device') mergedHit = normalizeDeviceSnapHit(mergedHit);
        return makeSnapResult(mergedHit, mergedHit.kind === 'device' ? 'device' : 'pointer');
      }
    }

      return snapFallback(fallbackX, fallbackY);
    } catch (err) {
      return snapFallback(fallbackX, fallbackY);
    }
  }

  function snapGhostFromPointer(clientX, clientY, canvasX, canvasY) {
    var pe = sim()?.pathEdit;
    var ctx = getGhostContext(pe);
    var exclude = ctx ? { type: ctx.pathType, id: ctx.pathId } : null;
    var snap = getSnappedPosition(clientX, clientY, canvasX, canvasY, {
      mode: 'ghost',
      excludePath: exclude,
    });
    if (pe) {
      pe.ghostSnapped = !!snap.snapped;
      pe.ghostSnapTarget = snap.target || null;
    }
    return { x: snap.x, y: snap.y };
  }

  function getGhostContext(pe) {
    return pe?.drag || pe?.ghostCommit || null;
  }

  function resetAllGhostState(opts) {
    opts = opts || {};
    detachVertexGhostDragListeners();
    var S = sim();
    if (S?.pathEdit) {
      S.pathEdit.drag = null;
      S.pathEdit.ghostCommit = null;
      S.pathEdit.isDraggingVertex = false;
      S.pathEdit.ghostDragging = false;
      S.pathEdit.ghostActive = false;
      S.pathEdit.ghostPendingCommit = false;
      S.pathEdit.ghostPosition = null;
      S.pathEdit.ghostSnapped = false;
      S.pathEdit.ghostSnapTarget = null;
      S.pathEdit.frozenPoints = null;
      S.pathEdit.frozenPathD = null;
    }
    if (!opts.keepCrosshair && S) S.crosshair = null;
    clearVertexDragGhost();
    b()?.syncDrawingLayerInteraction?.();
  }

  function setUnifiedPointerPosition(pos, snapped, snapTarget) {
    var S = sim();
    var pe = S?.pathEdit;
    if (!pe || !pos) return;
    pe.ghostPosition = { x: pos.x, y: pos.y };
    pe.ghostSnapped = !!snapped;
    pe.ghostSnapTarget = snapTarget || null;
    if (S) {
      S.crosshair = {
        x: pos.x,
        y: pos.y,
        visible: true,
        snapped: !!snapped,
        snapX: pos.x,
        snapY: pos.y,
      };
    }
    requestGhostRedraw();
  }

  function bindGhostSafetyListeners() {
    if (sim()?.ui?.ghostSafetyBound) return;
    window.addEventListener('pointerup', onGhostSafetyPointerUp, true);
    window.addEventListener('pointercancel', onGhostSafetyPointerUp, true);
    window.addEventListener('blur', onGhostSafetyBlur, true);
    var ui = sim()?.ui;
    if (ui) ui.ghostSafetyBound = true;
  }

  function onGhostSafetyPointerUp(e) {
    var pe = sim()?.pathEdit;
    if (!pe?.ghostDragging) return;
    releaseGhostPointer();
  }

  function onGhostSafetyBlur() {
    var pe = sim()?.pathEdit;
    if (!pe?.ghostDragging) return;
    releaseGhostPointer();
  }
  function buildGhostPreviewPoints(pe) {
    var ctx = getGhostContext(pe);
    if (!pe?.frozenPoints?.length || !pe.ghostPosition) return null;
    var pts = pe.frozenPoints.map(function (p) { return [p[0], p[1]]; });
    if (ctx?.isNewVertex) {
      var si = ctx.insertSegIndex;
      if (si != null && pts[si + 1]) {
        pts.splice(si + 1, 0, [pe.ghostPosition.x, pe.ghostPosition.y]);
      }
    } else {
      var vi = ctx.vertexIndex != null ? ctx.vertexIndex : pe.selectedVertexIndex;
      if (vi != null && pts[vi]) {
        pts[vi] = [pe.ghostPosition.x, pe.ghostPosition.y];
      }
    }
    return pts;
  }

  function previewPathDFromPoints(points, cornerRadii) {
    if (!points || points.length < 2) return '';
    var snapped = snapPixelPathPoints(points);
    var editor = global.FTTHPathwayEditor;
    var cs = sim()?.layout?.cellSize || 50;
    if (editor?.pointsToD) return editor.pointsToD(snapped, cs, cornerRadii || {});
    return penPointsToD(snapped);
  }

  function getEffectiveMapZoom() {
    var z = sim()?.zoom;
    if (!isFinite(z) || z <= 0) return CABLE_OFFSET_ZOOM_FULL;
    return z;
  }

  function calculateCableStackSpacing(zoomLevel) {
    var step = CABLE_STACK_SPACING_PX_MIN;
    if (!isFinite(zoomLevel)) zoomLevel = CABLE_OFFSET_ZOOM_FULL;
    if (zoomLevel >= CABLE_OFFSET_ZOOM_FULL) {
      step = CABLE_STACK_SPACING_PX_FULL;
    } else if (zoomLevel <= CABLE_OFFSET_ZOOM_MIN) {
      step = CABLE_STACK_SPACING_PX_MIN;
    } else {
      var t = (zoomLevel - CABLE_OFFSET_ZOOM_MIN) /
        (CABLE_OFFSET_ZOOM_FULL - CABLE_OFFSET_ZOOM_MIN);
      step = CABLE_STACK_SPACING_PX_MIN + t * (CABLE_STACK_SPACING_PX_FULL - CABLE_STACK_SPACING_PX_MIN);
    }
    return step;
  }

  /**
   * Sequential (tiled) cable offsets: lane 0, +spacing, +2*spacing… then shift the
   * whole group to center on the trench centerline. No per-lane compression cap.
   */
  function calculateCableOffset(zoomLevel, laneIndex, laneTotal) {
    if (laneTotal <= 1) return 0;
    var spacing = calculateCableStackSpacing(zoomLevel);
    var tiledOffset = laneIndex * spacing;
    var groupShift = ((laneTotal - 1) * spacing) / 2;
    return Math.round((tiledOffset - groupShift) * 10) / 10;
  }

  function calculateCableOffsets(zoomLevel, laneIndex, laneTotal) {
    return {
      visual: calculateCableOffset(zoomLevel, laneIndex, laneTotal),
      hit: calculateCableOffset(CABLE_OFFSET_ZOOM_FULL, laneIndex, laneTotal),
    };
  }

  /** Total band width = cableCount * spacing; trench never shrinks below minimum. */
  function calculateRequiredTrenchWidth(cableCount, zoomLevel) {
    var minWidth = b()?.TRENCH_CEMENT_BASE_WIDTH || TRENCH_MIN_WIDTH_PX;
    if (!cableCount || cableCount <= 0) return minWidth;
    var spacing = calculateCableStackSpacing(
      zoomLevel != null ? zoomLevel : getEffectiveMapZoom()
    );
    var totalCableWidth = cableCount * spacing;
    return Math.max(minWidth, Math.round(totalCableWidth * 100) / 100);
  }

  function shouldShowCableMapLabels(zoom) {
    return (zoom != null ? zoom : getEffectiveMapZoom()) > CABLE_LABEL_ZOOM_SHOW;
  }

  /**
   * Zoom-to-cursor pan adjustment (camera matrix anchor).
   * Keeps the world point under the pointer fixed while zoom changes.
   */
  /** Corner fillet radii scaled to current trench band width (closure legs follow parent width). */
  function resolveDynamicCornerRadiiForTrench(trench, widthPx) {
    if (!trench) return {};
    var manual = trench.cornerRadii || {};
    var pts = trench.points || [];
    if (pts.length < 3) return manual;
    var band = Math.max(Number(widthPx) || TRENCH_MIN_WIDTH_PX, TRENCH_MIN_WIDTH_PX);
    var autoR = Math.max(2, Math.min(50, Math.round(band * 0.45 * 10) / 10));
    var out = {};
    for (var i = 1; i < pts.length - 1; i++) {
      if (manual[i] != null && manual[i] > 0) {
        out[i] = Math.min(50, Math.max(manual[i], autoR));
      } else {
        out[i] = autoR;
      }
    }
    return out;
  }

  function computeZoomPanAdjust(oldZoom, newZoom, offsetX, offsetY, clientX, clientY) {
    var panX = offsetX || 0;
    var panY = offsetY || 0;
    var oldZ = oldZoom || 1;
    var newZ = newZoom || 1;
    if (Math.abs(oldZ - newZ) < 1e-9) {
      return { panX: panX, panY: panY, worldX: 0, worldY: 0 };
    }
    var viewport = document.getElementById('canvas-wrapper') ||
      b()?.getDropCanvasViewport?.() ||
      b()?.getDrawingCanvas?.();
    if (!viewport || clientX == null || clientY == null) {
      return { panX: panX, panY: panY, worldX: 0, worldY: 0 };
    }
    var rect = viewport.getBoundingClientRect();
    var sx = clientX - rect.left;
    var sy = clientY - rect.top;
    var scrollX = viewport.scrollLeft || 0;
    var scrollY = viewport.scrollTop || 0;
    var sim = b()?.getSim?.();
    var L = sim?.layout;
    var mapW = L ? L.cols * L.cellSize : 2400;
    var mapH = L ? L.rows * L.cellSize : 1700;
    var ox = mapW / 2;
    var oy = mapH / 2;
    var mx = sx + scrollX - ox;
    var my = sy + scrollY - oy;
    var ratio = newZ / oldZ;
    var worldX = ox + (mx - panX) / oldZ;
    var worldY = oy + (my - panY) / oldZ;
    return {
      panX: Math.round(mx - (mx - panX) * ratio),
      panY: Math.round(my - (my - panY) * ratio),
      worldX: worldX,
      worldY: worldY,
    };
  }

  function cloneRenderPathPoints(pts) {
    if (!pts) return [];
    return pts.map(function (p) { return p ? [p[0], p[1]] : [0, 0]; });
  }

  function cableEndpointSnapNodeIds(cable) {
    var ids = (cable && cable.pointSnapNodeIds) || [];
    var first = null;
    var last = null;
    for (var i = 0; i < ids.length; i++) {
      if (ids[i] == null || ids[i] === '') continue;
      if (!first) first = ids[i];
      last = ids[i];
    }
    return { start: first, end: last };
  }

  function getDeviceGlyphRadiusCanvas(node) {
    if (!node) return null;
    var placed = document.querySelector('.placed-node[data-id="' + node.id + '"]');
    var glyph = placed ? queryDeviceGlyphEl(placed) : null;
    var z = getEffectiveMapZoom();
    if (glyph && glyph.getBoundingClientRect) {
      var rect = glyph.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        var screenRadius = Math.max(rect.width, rect.height) / 2;
        return Math.max(0, screenRadius / Math.max(z, 0.08));
      }
    }
    return null;
  }

  function endpointSafetyGapCanvas(zoom) {
    var z = Number(zoom);
    if (!isFinite(z) || z <= 0) z = CABLE_OFFSET_ZOOM_FULL;
    var screenGap = CABLE_ENDPOINT_SAFE_GAP_SCREEN_PX_MIN +
      (CABLE_ENDPOINT_SAFE_GAP_SCREEN_PX_MAX - CABLE_ENDPOINT_SAFE_GAP_SCREEN_PX_MIN) / Math.max(z, 1);
    return screenGap / Math.max(z, 0.08);
  }

  function nodeIsHandholeFamily(node) {
    if (!node) return false;
    return node.type === 'handhole' || node.type === 'fat_handhole';
  }

  function truncateEndpointTowardNode(points, endpointIndex, node, zoom) {
    /* Snap flush to Handhole / FAT Handhole center — no retract gap. */
    if (!points || points.length < 2 || !nodeIsHandholeFamily(node)) return;
    var center = getDeviceSnapCenter(node) || b()?.getNodeCenterXY?.(node);
    if (!center || !isFinite(center.x) || !isFinite(center.y)) return;
    points[endpointIndex] = [
      Math.round(center.x * 10) / 10,
      Math.round(center.y * 10) / 10,
    ];
  }

  function applyZoomAdaptiveEndpointMargins(points, cable, zoom) {
    if (!points || points.length < 2 || !cable) return points;
    var out = cloneRenderPathPoints(points);
    var snapIds = cableEndpointSnapNodeIds(cable);
    if (!snapIds.start && !snapIds.end) return out;
    var startNode = snapIds.start ? findSimNodeById(snapIds.start) : null;
    var endNode = snapIds.end ? findSimNodeById(snapIds.end) : null;
    if (startNode) truncateEndpointTowardNode(out, 0, startNode, zoom);
    if (endNode) truncateEndpointTowardNode(out, out.length - 1, endNode, zoom);
    return out;
  }

  /** Render-only: trench.points is the fixed master line; never rebuild or offset the trench itself. */
  function buildCableRenderBasePoints(cable) {
    if (!cable) return [];
    if (cable.userDrawn) return cloneRenderPathPoints(cable.points || []);
    if (cable.trenchPathIds && cable.trenchPathIds.length > 1) {
      return cloneRenderPathPoints(cable.points || []);
    }
    var trench = b()?.resolveCableHostTrench?.(cable);
    if (trench && trench.points && trench.points.length >= 2) {
      return cloneRenderPathPoints(trench.points);
    }
    return cloneRenderPathPoints(cable.points || []);
  }

  function buildCableGeometryFromBasePoints(basePts, cable) {
    if (!basePts || basePts.length < 2) {
      return { points: [], hitPoints: [], cornerRadii: {} };
    }
    var lane = b()?.getCableLaneInfo?.(cable) || { laneIndex: 0, laneTotal: 1, trenchId: null };
    var offsets = calculateCableOffsets(CABLE_OFFSET_ZOOM_FULL, lane.laneIndex, lane.laneTotal);
    var visualOffset = offsets.visual;
    var hitOffset = offsets.hit;
    var offsetFn = b()?.offsetPolylineLateral;
    var points = basePts;
    var hitPoints = basePts;
    if (visualOffset && offsetFn) points = offsetFn(basePts, visualOffset) || basePts;
    if (hitOffset && offsetFn) hitPoints = offsetFn(basePts, hitOffset) || basePts;
    points = applyZoomAdaptiveEndpointMargins(points, cable, getEffectiveMapZoom());
    hitPoints = applyZoomAdaptiveEndpointMargins(hitPoints, cable, CABLE_OFFSET_ZOOM_FULL);
    var roundPts = b()?.roundPathPoints || snapPixelPathPoints;
    points = roundPts(points);
    hitPoints = roundPts(hitPoints);
    return {
      points: points,
      hitPoints: hitPoints,
      cornerRadii: {},
      laneIndex: lane.laneIndex,
      laneTotal: lane.laneTotal,
      visualOffsetPx: visualOffset,
      hitOffsetPx: hitOffset,
      laneOffsetPx: visualOffset,
      trenchId: lane.trenchId,
    };
  }

  function buildTrenchAdaptiveCableGeometry(cable) {
    if (!cable) return { points: [], hitPoints: [], cornerRadii: {} };
    return buildCableGeometryFromBasePoints(buildCableRenderBasePoints(cable), cable);
  }

  function patchPathPreviewD(svg, pathType, pathId, previewD, hitD) {
    if (!svg || !previewD) return;
    var vis = svg.querySelector(
      '.draw-path-visible[data-path-type="' + pathType + '"][data-path-id="' + pathId + '"]'
    );
    if (vis) vis.setAttribute('d', previewD);
    var hit = svg.querySelector(
      '.draw-path-hit[data-path-type="' + pathType + '"][data-path-id="' + pathId + '"]'
    );
    if (hit) hit.setAttribute('d', hitD || previewD);
  }

  function patchMergedCablesDuringExcavationDrag(svg, previewPts, trenchId) {
    if (!svg || !previewPts || !trenchId) return;
    var cables = b()?.getCablesOnTrench?.(trenchId) || [];
    cables.forEach(function (cable) {
      if (!cable || !b()?.isCableTrenchVertexLocked?.(cable)) return;
      if (cable.userDrawn) {
        var userD = previewPathDFromPoints(previewPts, {});
        if (userD) patchPathPreviewD(svg, 'fiber', cable.id, userD);
        return;
      }
      var geom = buildCableGeometryFromBasePoints(previewPts, cable);
      var radii = cable.cornerRadii || {};
      var visD = previewPathDFromPoints(geom.points, radii);
      var hitD = previewPathDFromPoints(geom.hitPoints, radii);
      if (!visD) return;
      patchPathPreviewD(svg, 'fiber', cable.id, visD, hitD);
    });
  }

  function patchHostTrenchDuringCableDrag(svg, previewPts, cableId) {
    if (!svg || !previewPts || !cableId) return;
    var cable = b()?.findPathByRef?.({ type: 'fiber', id: cableId });
    if (!cable || !b()?.isCableTrenchVertexLocked?.(cable)) return;
    var trench = b()?.resolveTrenchForCable?.(cable);
    if (!trench) return;
    var d = previewPathDFromPoints(previewPts, trench.cornerRadii);
    if (!d) return;
    patchPathPreviewD(svg, 'excavation', trench.id, d);
    patchMergedCablesDuringExcavationDrag(svg, previewPts, trench.id);
  }

  function lockFrozenPathSVGElement() {
    var pe = sim()?.pathEdit;
    var ctx = getGhostContext(pe);
    if (!pe?.ghostActive || !ctx) return;
    var svg = b()?.ensureGlobalDrawingLayer?.();
    if (!svg) return;
    var type = ctx.pathType;
    var id = ctx.pathId;
    var path = b()?.findPathByRef?.({ type: type, id: id });
    var previewPts = buildGhostPreviewPoints(pe);
    var previewD = previewPts
      ? previewPathDFromPoints(previewPts, path?.cornerRadii)
      : pe.frozenPathD;
    if (!previewD) return;

    var vis = svg.querySelector(
      '.draw-path-visible[data-path-type="' + type + '"][data-path-id="' + id + '"]'
    );
    if (vis && vis.getAttribute('d') !== previewD) {
      vis.setAttribute('d', previewD);
    }
    var hit = svg.querySelector(
      '.draw-path-hit[data-path-type="' + type + '"][data-path-id="' + id + '"]'
    );
    if (hit && hit.getAttribute('d') !== previewD) {
      hit.setAttribute('d', previewD);
    }

    if (type === 'excavation' && previewPts) {
      patchMergedCablesDuringExcavationDrag(svg, previewPts, id);
    } else if (type === 'fiber' && previewPts) {
      patchHostTrenchDuringCableDrag(svg, previewPts, id);
    }
  }

  function freezePathSnapshot(pathType, pathId) {
    var path = b()?.findPathByRef?.({ type: pathType, id: pathId });
    var pts = path?.points;
    if (!pts?.length) return null;
    var editor = global.FTTHPathwayEditor;
    var cs = sim()?.layout?.cellSize || 50;
    var frozenPoints = pts.map(function (p) { return p ? [p[0], p[1]] : [0, 0]; });
    var frozenPathD = editor?.pointsToD
      ? editor.pointsToD(frozenPoints, cs, path.cornerRadii)
      : '';
    return { frozenPoints: frozenPoints, frozenPathD: frozenPathD };
  }

  function upsertGhostLine(svg, id, x1, y1, x2, y2) {
    var line = svg.querySelector('#' + id);
    if (!line) {
      line = document.createElementNS(SVG_NS, 'line');
      line.id = id;
      line.setAttribute('class', 'vertex-drag-ghost-line');
      line.setAttribute('pointer-events', 'none');
      line.setAttribute('stroke', GHOST_PREVIEW_COLOR);
      line.setAttribute('stroke-width', GHOST_LINE_WIDTH);
      line.setAttribute('stroke-dasharray', GHOST_DASH);
      line.setAttribute('filter', 'none');
      line.setAttribute('stroke-linecap', 'round');
      svg.appendChild(line);
    }
    setSvgLineCoords(line, x1, y1, x2, y2);
    line.style.display = '';
  }

  function hideGhostLines(svg) {
    if (!svg) return;
    hideSvgEl(svg, 'vertex-ghost-line-prev');
    hideSvgEl(svg, 'vertex-ghost-line-next');
    hideSvgEl(svg, 'vertex-drag-ghost');
  }

  function renderVertexDragGhost(svg) {
    if (!svg) return;
    var pe = sim()?.pathEdit;
    var ctx = getGhostContext(pe);
    hideGhostLines(svg);
    lockFrozenPathSVGElement();
    if (!pe?.ghostActive || !ctx || !pe.ghostPosition) return;

    var pts = pe.frozenPoints;
    if (!pts?.length) {
      var path = b()?.findPathByRef?.({ type: ctx.pathType, id: ctx.pathId });
      pts = path?.points;
    }
    if (!pts?.length) return;

    var gx = pe.ghostPosition.x;
    var gy = pe.ghostPosition.y;

    if (ctx.isNewVertex) {
      var si = ctx.insertSegIndex;
      if (si == null || !pts[si] || !pts[si + 1]) return;
      upsertGhostLine(svg, 'vertex-ghost-line-prev', pts[si][0], pts[si][1], gx, gy);
      upsertGhostLine(svg, 'vertex-ghost-line-next', gx, gy, pts[si + 1][0], pts[si + 1][1]);
      return;
    }

    var vi = ctx.vertexIndex;
    if (vi == null || !pts[vi]) return;
    var prev = vi > 0 ? pts[vi - 1] : null;
    var next = vi < pts.length - 1 ? pts[vi + 1] : null;
    if (prev) upsertGhostLine(svg, 'vertex-ghost-line-prev', prev[0], prev[1], gx, gy);
    if (next) upsertGhostLine(svg, 'vertex-ghost-line-next', gx, gy, next[0], next[1]);
  }

  function requestGhostRedraw() {
    if (ghostRedrawPending) return;
    ghostRedrawPending = true;
    requestAnimationFrame(function () {
      ghostRedrawPending = false;
      var svg = b()?.ensureGlobalDrawingLayer?.();
      if (!svg) return;
      lockFrozenPathSVGElement();
      renderVertexDragGhost(svg);
      var pe = sim()?.pathEdit;
      if (pe?.ghostPosition && pe.ghostActive) {
        patchActiveVertexRing(svg, [pe.ghostPosition.x, pe.ghostPosition.y], pe.ghostSnapped);
      }
    });
  }

  function attachVertexGhostDragListeners() {
    if (vertexGhostListenersAttached) return;
    document.addEventListener('pointermove', onGhostPointerMove, true);
    document.addEventListener('pointerup', onGhostPointerUp, true);
    document.addEventListener('pointercancel', onGhostPointerUp, true);
    document.addEventListener('contextmenu', onGhostContextMenu, true);
    vertexGhostListenersAttached = true;
  }

  function detachVertexGhostDragListeners() {
    if (!vertexGhostListenersAttached) return;
    document.removeEventListener('pointermove', onGhostPointerMove, true);
    document.removeEventListener('pointerup', onGhostPointerUp, true);
    document.removeEventListener('pointercancel', onGhostPointerUp, true);
    document.removeEventListener('contextmenu', onGhostContextMenu, true);
    vertexGhostListenersAttached = false;
  }

  function onGhostPointerMove(e) {
    var pe = sim()?.pathEdit;
    if (!pe?.ghostDragging || !pe.drag) return;
    e.preventDefault();
    updateGhostPositionFromEvent(e);
  }

  function onGhostPointerUp(e) {
    var pe = sim()?.pathEdit;
    if (!pe?.ghostDragging) return;
    releaseGhostPointer();
  }

  function onGhostContextMenu(e) {
    var pe = sim()?.pathEdit;
    if (!pe?.ghostActive && !pe?.ghostPendingCommit) return;
    e.preventDefault();
    resetAllGhostState();
    b()?.renderGlobalDrawingLayer?.();
    b()?.updateStatus?.('Vertex edit cancelled');
  }

  function releaseGhostPointer() {
    var pe = sim()?.pathEdit;
    if (!pe?.ghostDragging) return;
    pe.ghostDragging = false;
    pe.isDraggingVertex = false;
    if (pe.drag) {
      pe.ghostCommit = {
        pathType: pe.drag.pathType,
        pathId: pe.drag.pathId,
        vertexIndex: pe.drag.vertexIndex,
        origin: pe.drag.origin ? pe.drag.origin.slice() : null,
        isNewVertex: !!pe.drag.isNewVertex,
        insertSegIndex: pe.drag.insertSegIndex,
      };
      pe.drag = null;
    }
    detachVertexGhostDragListeners();
    finalizeGhostVertexCommit();
  }

  function beginGhostVertexDrag(cfg) {
    var S = sim();
    if (!S || !cfg) return false;
    if (!S.pathEdit) S.pathEdit = { drag: null, context: null };
    var pe = S.pathEdit;
    if (pe.ghostDragging) return false;

    var snap = freezePathSnapshot(cfg.pathType, cfg.pathId);
    if (!snap) return false;

    pe.ghostActive = true;
    pe.ghostDragging = true;
    pe.ghostPendingCommit = false;
    pe.isDraggingVertex = true;
    pe.ghostSnapped = false;
    pe.ghostSnapTarget = null;
    pe.ghostCommit = null;
    pe.frozenPoints = snap.frozenPoints;
    pe.frozenPathD = snap.frozenPathD;
    pe.drag = {
      mode: 'vertex',
      pathType: cfg.pathType,
      pathId: cfg.pathId,
      vertexIndex: cfg.vertexIndex != null ? cfg.vertexIndex : null,
      origin: cfg.origin ? cfg.origin.slice() : null,
      isNewVertex: !!cfg.isNewVertex,
      insertSegIndex: cfg.insertSegIndex != null ? cfg.insertSegIndex : null,
    };
    pe.selectedVertexIndex = cfg.isNewVertex
      ? (cfg.insertSegIndex != null ? cfg.insertSegIndex + 1 : null)
      : cfg.vertexIndex;
    pe.ghostPosition = cfg.ghostPosition
      ? snapGhostXY(cfg.ghostPosition.x, cfg.ghostPosition.y)
      : (cfg.origin ? { x: cfg.origin[0], y: cfg.origin[1] } : null);
    pe.insertHover = null;

    attachVertexGhostDragListeners();
    bindGhostSafetyListeners();
    b()?.resetMapPointerState?.({ keepVertexDrag: true });
    b()?.syncDrawingLayerInteraction?.();
    requestGhostRedraw();
    return true;
  }

  function updateGhostPositionFromEvent(e) {
    beginScreenCtmCacheFrame();
    try {
    var pe = sim()?.pathEdit;
    if (!pe?.ghostDragging || !pe.drag) return false;
    var xy = svgCoordsFromEvent(e);
    if (!xy) return false;
    var resolved = b()?.resolvePenPointerXY?.(xy.x, xy.y);
    var snap = getSnappedPosition(e.clientX, e.clientY, resolved.x, resolved.y, {
      mode: 'ghost',
      excludePath: pe.drag ? { type: pe.drag.pathType, id: pe.drag.pathId } : null,
    });
    setUnifiedPointerPosition({ x: snap.x, y: snap.y }, snap.snapped, snap.target);
    return true;
    } finally {
      sealScreenCtmCacheFrame();
    }
  }

  function commitGhostVertexDrag() {
    var S = sim();
    var pe = S?.pathEdit;
    var ctx = getGhostContext(pe);
    if (!pe?.ghostActive || !ctx || !pe.ghostPosition) return { changed: false, merged: false };

    var path = b()?.findPathByRef?.({ type: ctx.pathType, id: ctx.pathId });
    var pts = path?.points;
    if (!pts) {
      resetAllGhostState();
      return { changed: false, merged: false };
    }

    var snapTarget = pe.ghostSnapped && pe.ghostSnapTarget ? pe.ghostSnapTarget : null;
    var committed = [pe.ghostPosition.x, pe.ghostPosition.y];
    if (snapTarget) {
      committed = [snapTarget.x, snapTarget.y];
    }
    var changed = false;
    var mergeVertexIndex = null;

    if (ctx.isNewVertex) {
      var segIndex = ctx.insertSegIndex;
      if (segIndex != null && pts[segIndex + 1]) {
        pts.splice(segIndex + 1, 0, committed);
        mergeVertexIndex = segIndex + 1;
        pe.selectedVertexIndex = mergeVertexIndex;
        changed = true;
      }
    } else {
      var vi = ctx.vertexIndex != null ? ctx.vertexIndex : pe.selectedVertexIndex;
      if (vi != null && pts[vi]) {
        var origin = ctx.origin;
        if (!origin || origin[0] !== committed[0] || origin[1] !== committed[1]) {
          pts[vi] = committed;
          changed = true;
        }
        mergeVertexIndex = vi;
      }
    }

    if (changed && mergeVertexIndex != null) {
      if (ctx.isNewVertex) {
        b()?.propagateLockedVertexInsert?.(ctx.pathType, ctx.pathId, mergeVertexIndex, committed);
      } else {
        b()?.propagateLockedVertexEdit?.(ctx.pathType, ctx.pathId, mergeVertexIndex, committed);
      }
    }

    var merged = false;
    if (snapTarget && snapTarget.scope === 'external' && mergeVertexIndex != null) {
      merged = !!global.FTTHPathwayEditor?.mergePathsAtSnapTarget?.({
        pathType: ctx.pathType,
        pathId: ctx.pathId,
        vertexIndex: mergeVertexIndex,
      }, snapTarget);
      if (merged) changed = true;
    }

    resetAllGhostState({ keepCrosshair: true });
    if (!merged) b()?.renderGlobalDrawingLayer?.();
    return { changed: changed, merged: merged };
  }

  function finalizeGhostVertexCommit() {
    var pe = sim()?.pathEdit;
    var ctx = getGhostContext(pe);
    var editedPathType = ctx?.pathType;
    var editedPathId = ctx?.pathId;
    var externalSnap = !!(pe?.ghostSnapped && pe?.ghostSnapTarget?.scope === 'external');
    var result = commitGhostVertexDrag();
    if (sim()?.pathEdit?.ghostActive) {
      resetAllGhostState({ keepCrosshair: true });
      b()?.renderGlobalDrawingLayer?.();
    }
    if (result.changed) {
      if (editedPathType === 'excavation' && editedPathId) {
        var mergedId = b()?.tryAutoMergePathGaps?.('excavation', editedPathId);
        if (mergedId) editedPathId = mergedId;
        b()?.syncCablesOnTrench?.(editedPathId);
      } else if (editedPathType === 'fiber' && editedPathId) {
        b()?.syncLockedPathFromCable?.(editedPathId);
      }
      if (!result.merged) {
        b()?.saveState?.();
        b()?.updateMetrics?.();
        b()?.renderGlobalDrawingLayer?.();
      }
      global.PathwayPropertiesModal?.refresh?.();
      if (result.merged) {
        b()?.updateStatus?.('Paths merged into single route ✓');
      } else if (externalSnap) {
        b()?.updateStatus?.('Vertex welded to cable ✓');
      } else {
        b()?.updateStatus?.('Vertex committed ✓');
      }
    } else {
      b()?.updateStatus?.('Vertex unchanged');
    }
    return result.changed;
  }

  function cancelGhostVertexDrag() {
    resetAllGhostState();
  }

  function isGhostSessionActive() {
    var pe = sim()?.pathEdit;
    return !!(pe?.ghostActive || pe?.ghostPendingCommit);
  }

  function isGhostPointerDown() {
    return !!sim()?.pathEdit?.ghostDragging;
  }

  function hitTestVertexScreenPx(clientX, clientY, pathType, pathId) {
    var path = b()?.findPathByRef?.({ type: pathType, id: pathId });
    var pts = path?.points;
    if (!pts) return null;
    var best = null;
    var bestDistSq = SNAP_THRESHOLD_SQ;
    for (var i = 0; i < pts.length; i++) {
      var pt = pts[i];
      if (!pt) continue;
      var d2 = screenDistSqToCanvasPoint(clientX, clientY, pt[0], pt[1]);
      if (d2 <= bestDistSq) {
        bestDistSq = d2;
        best = { pathType: pathType, pathId: pathId, index: i, x: pt[0], y: pt[1] };
      }
    }
    return best;
  }

  function hitTestVertexScreenPxAny(clientX, clientY) {
    var editor = global.FTTHPathwayEditor;
    if (!editor?.iterateAllPaths) return null;
    var best = null;
    var bestDistSq = SNAP_THRESHOLD_SQ;
    editor.iterateAllPaths(function (type, path) {
      if (!path?.id) return;
      var hit = hitTestVertexScreenPx(clientX, clientY, type, path.id);
      if (!hit) return;
      var d2 = screenDistSqToCanvasPoint(clientX, clientY, hit.x, hit.y);
      if (d2 < bestDistSq) {
        bestDistSq = d2;
        best = hit;
      }
    });
    return best;
  }

  function patchVertexDragGhost(svg) {
    renderVertexDragGhost(svg);
    return true;
  }

  function clearVertexDragGhost() {
    var svg = b()?.ensureGlobalDrawingLayer?.();
    if (svg) {
      hideGhostLines(svg);
      hideSvgEl(svg, 'vertex-active-ring');
    }
  }

  function focusVertexPathAtClick(xy, clientX, clientY) {
    var S = sim();
    var editor = global.FTTHPathwayEditor;
    if (!S || !editor || !xy) return null;

    var vtxHit = hitTestVertexScreenPxAny(clientX, clientY);
    if (vtxHit) {
      if (!S.selectedPath || S.selectedPath.type !== vtxHit.pathType || S.selectedPath.id !== vtxHit.pathId) {
        b()?.selectPath?.(vtxHit.pathType, vtxHit.pathId, false);
      }
      return vtxHit;
    }

    var pathHit = editor.hitTestPaths?.(xy.x, xy.y);
    if (pathHit) {
      if (!S.selectedPath || S.selectedPath.type !== pathHit.type || S.selectedPath.id !== pathHit.id) {
        b()?.selectPath?.(pathHit.type, pathHit.id, false);
      }
    }
    return null;
  }

  function patchActiveVertexRing(svg, pt, snapped) {
    if (!svg || !pt) return false;
    var ring = svg.querySelector('#vertex-active-ring');
    if (!ring) {
      ring = document.createElementNS(SVG_NS, 'circle');
      ring.id = 'vertex-active-ring';
      ring.setAttribute('class', 'vertex-active-ring');
      ring.setAttribute('pointer-events', 'none');
      ring.setAttribute('fill', 'none');
      ring.setAttribute('stroke', '#3b82f6');
      ring.setAttribute('stroke-width', '1');
      ring.setAttribute('filter', 'none');
      mountOverlayEl(svg, ring);
    } else {
      mountOverlayEl(svg, ring);
    }
    ring.removeAttribute('stroke-dasharray');
    ring.setAttribute('stroke', snapped ? '#f97316' : '#3b82f6');
    ring.setAttribute('r', String(snapped ? VERTEX_RING_RADIUS : VERTEX_RING_RADIUS + 1));
    setSvgCircleCenter(ring, pt[0], pt[1]);
    ring.style.display = '';
    return true;
  }

  function renderCableMagneticSnapIndicator(svg) {
    /* Unified pen preview crosshair handles all snap visuals — no filled cable overlay. */
    hideSvgEl(svg, 'cable-magnetic-snap-marker');
  }

  function renderDeviceSnapCenterPoint(svg) {
    if (!svg) return;
    if (b()?.canPenDraw?.()) {
      hideSvgEl(svg, 'device-snap-center-point');
      return;
    }
    var S = sim();
    var cx = null;
    var cy = null;
    var show = false;

    if (b()?.canPenDraw?.() && S?.penDraft?.cursorSnapNodeId) {
      var penNode = findSimNodeById(S.penDraft.cursorSnapNodeId);
      var penCenter = penNode && getDeviceSnapCenter(penNode);
      if (penCenter) {
        cx = penCenter.x;
        cy = penCenter.y;
        show = true;
      }
    } else if (S?.crosshair?.visible && S.crosshair.snapped &&
        isFinite(S.crosshair.snapX) && isFinite(S.crosshair.snapY)) {
      cx = S.crosshair.snapX;
      cy = S.crosshair.snapY;
      show = true;
    } else if (S?.pathEdit?.ghostSnapped && S.pathEdit.ghostPosition) {
      cx = S.pathEdit.ghostPosition.x;
      cy = S.pathEdit.ghostPosition.y;
      show = true;
    }

    if (!show) {
      hideSvgEl(svg, 'device-snap-center-point');
      return;
    }

    var dot = svg.querySelector('#device-snap-center-point');
    if (!dot) {
      dot = document.createElementNS(SVG_NS, 'circle');
      dot.id = 'device-snap-center-point';
      dot.setAttribute('class', 'device-snap-center-point');
      dot.setAttribute('pointer-events', 'none');
      dot.setAttribute('fill', '#f97316');
      dot.setAttribute('stroke', '#ffffff');
      dot.setAttribute('stroke-width', '1.5');
      dot.setAttribute('filter', 'none');
      mountOverlayEl(svg, dot);
    } else {
      mountOverlayEl(svg, dot);
    }
    setSvgCircleCenter(dot, cx, cy);
    dot.setAttribute('r', '4.5');
    dot.style.display = '';
  }

  function renderGisOverlays(svg) {
    prepareDrawingLayer(svg);
    patchPenDraftLivePath(svg);
    updateLiveRubberLine();
    renderPenPlacedVertices(svg);
    renderCrosshair(svg);
    renderVertexInsertPreview(svg);
    renderVertexDragGhost(svg);
    renderActiveVertexRing(svg);
    renderDeviceSnapCenterPoint(svg);
    renderCutOverlays(svg);
    renderCutOpenDots(svg);
    ensureDrawingOverlayGroup(svg);
  }

  function ensureFloatingLabelLayerStyles() {
    var styleId = 'ftth-floating-label-layer-style';
    var style = document.getElementById(styleId);
    if (!style) {
      style = document.createElement('style');
      style.id = styleId;
      document.head.appendChild(style);
    }
    /* FAT matrix lock: GPU layer on parent; children relative flex only */
    style.textContent = [
      '#global-map-labels-layer,.global-map-labels-layer{z-index:6!important;pointer-events:none!important;}',
      '.field-map-entity--rigid{position:relative;transform-origin:50% 50%;}',
      '.placed-node--rigid-entity .field-map-entity__label--upright{',
      'visibility:visible!important;opacity:1!important;pointer-events:auto!important;',
      'transform-origin:center center;}',
      '#canvas-wrapper,#city-canvas{--map-rotation:var(--ftth-map-rotation, 0deg);}',
      '.placed-node--fat_handhole .fat-rigid-marker,',
      '.placed-node--fat_handhole .fat-unified-map-marker,',
      '.placed-node--fat-pole .fat-rigid-marker,',
      '.placed-node--fat-pole .fat-unified-map-marker{',
      'position:relative!important;display:grid!important;grid-template:1fr/1fr!important;',
      'place-items:center!important;width:28px!important;height:28px!important;',
      '--fat-pole-icon-size:24px!important;--fat-pole-icon-height:31px!important;',
      'margin:0!important;padding:0!important;',
      'transform:none!important;',
      'transform-origin:center center!important;',
      'transition:none!important;pointer-events:auto!important;}',
      '.placed-node--fat_handhole .fat-rigid-marker>.fat-handhole-base,',
      '.placed-node--fat-pole .fat-rigid-marker>.fat-handhole-base{',
      'grid-area:1/1!important;position:relative!important;margin:0!important;padding:0!important;',
      'transform:none!important;transform-origin:center center!important;',
      'width:28px!important;height:28px!important;}',
      '.placed-node--fat-pole .fat-rigid-marker>.fat-pole-stack{',
      'grid-area:1/1!important;position:absolute!important;left:50%!important;bottom:50%!important;',
      'top:auto!important;right:auto!important;width:max-content!important;height:auto!important;',
      'margin:0!important;padding:0!important;display:grid!important;grid-template:1fr/1fr!important;',
      'align-content:end!important;justify-items:center!important;',
      'transform:translateX(-50%)!important;transform-origin:bottom center!important;pointer-events:none!important;}',
      '.placed-node--fat-pole .fat-pole-stack>.pole-label,',
      '.placed-node--fat-pole .fat-pole-stack>.field-node-label--fat-system{',
      'grid-area:1/1!important;align-self:end!important;justify-self:center!important;',
      'position:relative!important;inset:auto!important;padding:0!important;',
      'transform:none!important;transform-origin:bottom center!important;',
      'margin:0 0 calc(var(--fat-pole-icon-height,31px) + 4px) 0!important;}',
      '.placed-node--fat-pole .fat-pole-stack>.fat-pole-icon{',
      'grid-area:1/1!important;align-self:end!important;justify-self:center!important;',
      'position:relative!important;inset:auto!important;padding:0!important;margin:0!important;',
      'transform:none!important;transform-origin:bottom center!important;',
      'width:var(--fat-pole-icon-size,24px)!important;height:var(--fat-pole-icon-height,31px)!important;',
      'display:flex!important;justify-content:center!important;align-items:flex-end!important;}',
      '#canvas-wrapper.map-rotation-active .placed-node--fat-pole .fat-rigid-marker,',
      '#canvas-wrapper.map-rotation-active .placed-node--fat-pole .fat-unified-map-marker{',
      'transform:none!important;}',
      '#canvas-wrapper.map-rotation-active .placed-node--fat-pole .fat-rigid-marker>.fat-handhole-base,',
      '#canvas-wrapper.map-rotation-active .placed-node--fat_handhole .fat-rigid-marker>.fat-handhole-base{',
      'transform:none!important;}',
      '#canvas-wrapper.map-rotation-active .placed-node--fat-pole .fat-rigid-marker>.fat-pole-stack,',
      '#canvas-wrapper.map-rotation-active .placed-node--fat_handhole .fat-rigid-marker>.fat-pole-stack{',
      'transform:translateX(-50%) rotate(calc(-1 * var(--ftth-map-rotation, 0deg)))!important;',
      'transform-origin:bottom center!important;}',
      '#canvas-wrapper.map-rotation-active .placed-node--fat-pole .fat-pole-stack>.fat-pole-icon,',
      '#canvas-wrapper.map-rotation-active .placed-node--fat-pole .fat-pole-stack>.pole-label,',
      '#canvas-wrapper.map-rotation-active .placed-node--fat-pole .fat-pole-stack>.field-node-label--fat-system{',
      'transform:none!important;}',
      '.placed-node--fat-pole .fat-pole-stack>.pole-label,',
      '.placed-node--fat-pole .fat-pole-stack>.field-node-label--fat-system{',
      'visibility:visible!important;opacity:1!important;}',
      '.placed-node--fat-pole .fat-rigid-marker>.fat-upright-wrapper,',
      '.placed-node--fat-pole .fat-rigid-marker>.fat-upright-cluster{display:contents!important;}',
      '#canvas-wrapper.map-rotation-active .placed-node:not(.placed-node--fat-pole) .field-map-entity__label--upright:not(.is-dragged):not(.pole-label),',
      '#canvas-wrapper.map-rotation-active .placed-node:not(.placed-node--fat-pole) .element-label.field-node-label--map:not(.is-dragged):not(.pole-label),',
      '#canvas-wrapper.map-rotation-active .placed-node:not(.placed-node--fat-pole) .field-node-label--foundation:not(.is-dragged),',
      '#canvas-wrapper.map-rotation-active .placed-node:not(.placed-node--fat-pole) .field-node-label--pole:not(.is-dragged){',
      'transform:translate(-50%,-50%) rotate(calc(-1 * var(--ftth-map-rotation, 0deg)))!important;',
      'transform-origin:center center;}',
      '#canvas-wrapper.map-rotation-active .placed-node--rigid-entity:not(.placed-node--fat-pole)',
      ' .field-map-entity__label--upright:not(.is-dragged):not(.field-node-label--fat-system):not(.pole-label){',
      'transform:translateX(-50%) rotate(calc(-1 * var(--ftth-map-rotation, 0deg)))!important;}',
      '.field-node-label--map,.field-node-label--floating,.field-map-entity__label--upright,',
      '.field-node-label--foundation,.field-node-label--pole,.field-node-label--fat-system,.pole-label,',
      '#global-map-labels-layer text,.global-map-labels-layer text{',
      'text-rendering:geometricPrecision!important;font-kerning:normal!important;',
      'font-variant-ligatures:contextual common-ligatures!important;',
      '-webkit-font-smoothing:antialiased!important;-moz-osx-font-smoothing:grayscale!important;',
      'backface-visibility:hidden!important;}',
    ].join('');
  }

  var MAP_LABEL_FONT = 'bold 14px Arial, sans-serif';
  var MAP_LABEL_FILL = '#ffffff';
  var MAP_LABEL_FLOAT_OFFSET = 15;
  var MAP_LABEL_CABLE_ALONG_OFFSET = 10;
  var MAP_LABEL_NODE_STACK_STEP = 14;

  function getMapLabelFill() {
    var configured = sim()?.settings?.labelColor;
    if (typeof configured === 'string' && configured.trim()) return configured.trim();
    return MAP_LABEL_FILL;
  }

  function getMapLabelFont() {
    var px = sim()?.settings?.labelFontSize || 14;
    return 'bold ' + px + 'px Arial, sans-serif';
  }

  function upsertFloatingMapLabel(svg, id, className, x, y, text) {
    if (!svg || !text) return;
    var el = svg.querySelector('#' + id);
    if (!el) {
      el = document.createElementNS(SVG_NS, 'text');
      el.id = id;
      el.setAttribute('class', className);
      el.setAttribute('pointer-events', 'none');
      el.setAttribute('text-anchor', 'middle');
      el.setAttribute('dominant-baseline', 'auto');
      el.setAttribute('stroke', 'none');
      svg.appendChild(el);
    }
    el.setAttribute('x', snapPixel(x));
    el.setAttribute('y', snapPixel(y - MAP_LABEL_FLOAT_OFFSET));
    el.setAttribute('fill', getMapLabelFill());
    el.setAttribute('font', getMapLabelFont());
    el.textContent = text;
    el.style.display = '';
  }

  function collectNodeMapLabelEntries(node) {
    if (!node) return [];
    var entries = [];
    if (node.type === 'handhole') {
      if (node.hasClosure && node.closureName) {
        entries.push({ key: 'closure', text: node.closureName });
      } else {
        var hhName = nodeDisplayName(node);
        if (hhName) entries.push({ key: 'primary', text: hhName });
      }
    } else if (node.type === 'fat_handhole') {
      if (node.hasFatPole && node.fatSystemName) {
        entries.push({ key: 'unified', text: node.fatSystemName });
      } else {
        var fhName = nodeDisplayName(node);
        if (fhName) entries.push({ key: 'primary', text: fhName });
      }
    } else if (node.type === 'fdt') {
      var fdtName = nodeDisplayName(node);
      if (fdtName) entries.push({ key: 'primary', text: fdtName });
      if (node.fatSplitter) entries.push({ key: 'splitter', text: String(node.fatSplitter) });
    } else if (node.type === 'olt') {
      entries.push({ key: 'primary', text: nodeDisplayName(node) || 'OLT' });
    } else if (node.type === 'pole_foundation') {
      var poleName = nodeDisplayName(node);
      if (poleName) entries.push({ key: 'primary', text: poleName });
    } else {
      var generic = nodeDisplayName(node);
      if (generic) entries.push({ key: 'primary', text: generic });
    }
    return entries;
  }

  function renderNodeMapLabels(svg) {
    if (!svg) return;
    (sim()?.nodes || []).forEach(function (node) {
      if (isRigidGroupedMapEntity(node)) return;
      var center = getDeviceSnapCenter(node) || b()?.getNodeCenterXY?.(node);
      if (!center) return;
      if (!isPointInMapViewport(center.x, center.y, getMapViewportCanvasBounds())) return;
      var entries = collectNodeMapLabelEntries(node);
      entries.forEach(function (entry, idx) {
        var safeId = String(node.id).replace(/[^a-zA-Z0-9_-]/g, '_');
        var id = 'map-label-node-' + safeId + '-' + entry.key;
        upsertFloatingMapLabel(
          svg,
          id,
          'map-label map-label--node map-label--floating',
          center.x,
          center.y - idx * MAP_LABEL_NODE_STACK_STEP,
          entry.text
        );
      });
    });
  }

  function renderCableMapLabels(svg) {
    if (!svg || !shouldShowCableMapLabels()) return;
    var layouts = b()?.getCableLabelLayoutForRender?.() || [];
    layouts.forEach(function (layout) {
      if (!layout?.label) return;
      var along = layout.labelOffsetPx || 0;
      var cross = layout.labelOffsetCrossPx || 0;
      var nx = layout.normalX || 0;
      var ny = layout.normalY || 0;
      var lx = layout.x + nx * (MAP_LABEL_CABLE_ALONG_OFFSET + along) + (-ny) * cross;
      var ly = layout.y + ny * (MAP_LABEL_CABLE_ALONG_OFFSET + along) + nx * cross;
      if (!isPointInMapViewport(lx, ly, getMapViewportCanvasBounds())) return;
      var cableId = String(layout.cable?.id || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
      var id = 'map-label-cable-' + cableId + '-' + (layout.anchor || 'end');
      upsertFloatingMapLabel(
        svg,
        id,
        'map-label map-label--path map-label--floating',
        lx,
        ly,
        layout.label
      );
    });
  }

  /** Default label offset from symbol center (canvas px) for rigid FAT/pole entities. */
  var RIGID_ENTITY_LABEL_OFFSET_X = 0;
  var RIGID_ENTITY_LABEL_OFFSET_Y = -18;
  var MAP_VIEWPORT_CULL_PADDING_PX = 72;

  function getMapViewportCanvasBounds(paddingPx) {
    var S = sim();
    var wrap = document.getElementById('canvas-wrapper');
    if (!S || !wrap) return null;
    paddingPx = paddingPx == null ? MAP_VIEWPORT_CULL_PADDING_PX : paddingPx;
    var zoom = S.zoom || 1;
    var panX = S.panX || 0;
    var panY = S.panY || 0;
    var w = wrap.clientWidth || wrap.getBoundingClientRect().width || 0;
    var h = wrap.clientHeight || wrap.getBoundingClientRect().height || 0;
    var padCanvas = paddingPx / Math.max(zoom, 0.08);
    return {
      x0: (-panX) / zoom - padCanvas,
      y0: (-panY) / zoom - padCanvas,
      x1: (w - panX) / zoom + padCanvas,
      y1: (h - panY) / zoom + padCanvas,
    };
  }

  function isPointInMapViewport(x, y, bounds) {
    if (!bounds || !isFinite(x) || !isFinite(y)) return true;
    return x >= bounds.x0 && x <= bounds.x1 && y >= bounds.y0 && y <= bounds.y1;
  }

  function applyViewportCullingToPlacedNodes(bounds) {
    /* Viewport culling disabled — map items must stay visible at all zoom levels (incl. 500%). */
    document.querySelectorAll('.placed-node--viewport-culled').forEach(function (placed) {
      placed.classList.remove('placed-node--viewport-culled');
    });
  }

  function isRigidGroupedMapEntity(node) {
    if (!node) return false;
    return node.type === 'fat_handhole' || node.type === 'pole_foundation';
  }

  /**
   * NO-OP during rotation. FAT coords are pinned at create via applyCellLockPosition
   * CSS flex atomic unit — rotation on parent only; never write child top/left/transform.
   * Never write top/left/transform here — that caused JS↔CSS drift.
   */
  function syncFatRigidMarkerRotation(/* rotationDeg, rotationEnabled */) {
    /* intentionally empty — do not touch FAT DOM during map rotation */
  }

  function purgeFatRigidMarkerInternalTransforms() {
    /* no-op — see syncFatRigidMarkerRotation */
  }

  function clearFatPoleIconInlineTransforms() {
    /* no-op */
  }

  function syncMapViewportLabelPresentation(rotationDeg, rotationEnabled) {
    var rot = rotationEnabled ? (Number(rotationDeg) || 0) : 0;
    var rotCss = rot + 'deg';
    var wrap = document.getElementById('canvas-wrapper');
    var canvas = document.getElementById('city-canvas');
    var zoomInner = document.getElementById('canvas-zoom-inner');
    [wrap, canvas, zoomInner].forEach(function (el) {
      if (!el) return;
      el.style.setProperty('--ftth-map-rotation', rotCss);
      el.style.setProperty('--map-rotation', rotCss);
    });
    /* FAT: handhole untouched; .fat-pole-stack counter-rotates (poleRotation = -mapRotation) */
  }

  /** Bind symbol + label as one rigid HTML entity (no separate SVG label pass). */
  function syncRigidGroupedMapEntityLabels(S) {
    if (!S) S = sim();
    if (!S) return;
    ensureFloatingLabelLayerStyles();
    syncMapViewportLabelPresentation(S.mapRotation || 0, !!S.settings?.mapRotationEnabled);

    (S.nodes || []).forEach(function (node) {
      if (!isRigidGroupedMapEntity(node)) return;
      /* During map rotate: never re-sync FAT child DOM (CSS-only rigid body) */
      if (sim()?._isMapTransformFlush && node.type === 'fat_handhole' && node.hasFatPole) return;
      var placed = document.querySelector('.placed-node[data-id="' + node.id + '"]');
      if (!placed) return;
      placed.classList.add('placed-node--rigid-entity');

      var rigidMarker = placed.querySelector('.fat-rigid-marker');
      if (rigidMarker && node.type === 'fat_handhole' && node.hasFatPole) {
        sim()?.quarantineFatRigidMarkerChildren?.(rigidMarker);
      }

      var anchor = placed.querySelector('.placed-node__glyph-anchor');
      if (anchor) {
        anchor.classList.add('field-map-entity', 'field-map-entity--rigid');
        if (node.type === 'fat_handhole' && node.hasFatPole) {
          anchor.classList.add('field-map-entity--fat-pole');
        }
        anchor.style.setProperty('--entity-label-x-offset', RIGID_ENTITY_LABEL_OFFSET_X + 'px');
        anchor.style.setProperty('--entity-label-y-offset', RIGID_ENTITY_LABEL_OFFSET_Y + 'px');
      }

      placed.querySelectorAll('.element-label.field-node-label--map[data-label-key]').forEach(function (lbl) {
        lbl.classList.add('field-map-entity__label');
        var isFatPoleUnified = node.type === 'fat_handhole' && node.hasFatPole &&
          (lbl.classList.contains('pole-label') || lbl.getAttribute('data-label-key') === 'unified');
        if (!isFatPoleUnified) {
          lbl.classList.add('field-map-entity__label--upright');
        } else {
          lbl.classList.remove('field-map-entity__label--upright');
        }
        lbl.style.visibility = 'visible';
        lbl.style.pointerEvents = node.locked ? 'none' : 'auto';
        /* FAT pole labels: CSS-only layout inside .fat-rigid-marker — no top/left/transform writes */
      });
    });

    /* Class sync only — no FAT coordinate/transform writes during viewport sync */
    /* syncFatRigidMarkerRotation intentionally not called */

    document.querySelectorAll('.placed-node--pole_foundation, .placed-node--foundation-pole, .placed-node--foundation-only').forEach(function (placed) {
      placed.classList.add('placed-node--rigid-entity');
      placed.querySelectorAll('.field-node-label--foundation, .field-node-label--pole').forEach(function (lbl) {
        lbl.classList.add('field-map-entity__label', 'field-map-entity__label--upright');
      });
    });
  }

  function routeVertexPointerDown(e) {
    if (e?.button === 1) return false;
    var tool = b()?.getActiveCanvasTool?.() || 'select';
    if (tool !== 'vertex') return false;
    var S = sim();
    if (!S?.pathEdit || S.pathEdit.ghostDragging) return false;

    var xy = svgCoordsFromEvent(e);
    if (!xy) return false;
    var editor = global.FTTHPathwayEditor;
    if (!editor) return false;

    if (isGhostSessionActive()) {
      resetAllGhostState();
      b()?.renderGlobalDrawingLayer?.();
      e.preventDefault();
      e.stopPropagation();
      return true;
    }

    var vtxOnAny = focusVertexPathAtClick(xy, e.clientX, e.clientY);
    if (vtxOnAny) {
      editor.beginVertexDragFromPick(e, {
        kind: 'vertex',
        pathType: vtxOnAny.pathType,
        pathId: vtxOnAny.pathId,
        index: vtxOnAny.index,
      });
      return true;
    }

    var pick = editor.pickVertexDragTarget(xy.x, xy.y, e.clientX, e.clientY);
    if (pick) {
      editor.beginVertexDragFromPick(e, pick);
      return true;
    }

    var hover = S.pathEdit.insertHover;
    if (hover) {
      var hdx = hover.x - xy.x;
      var hdy = hover.y - xy.y;
      if (hdx * hdx + hdy * hdy <= 144) {
        if (editor.beginVertexGhostInsertFromHover(e, hover)) return true;
      }
    }

    if (editor.hitTestPaths(xy.x, xy.y)) {
      return false;
    }

    if (S.interactionMode === 'hand') {
      var segHit = editor.hitTestSegmentInsertOnSelected(xy.x, xy.y, 12);
      if (segHit && editor.beginVertexGhostInsertFromHover(e, segHit)) return true;
      return false;
    }

    return false;
  }

  function syncCanvasToolChrome() {
    var wrap = document.getElementById('canvas-wrapper');
    if (wrap) wrap.classList.toggle('canvas-tool-cut-target', false);
  }

  function svgCoordsFromEvent(e) {
    return b()?.getSVGCoordinates?.(e) || b()?.pointerEventToCanvasXY?.(e);
  }

  function routePointerDown(e) {
    var tool = b()?.getActiveCanvasTool?.() || 'select';
    if (tool !== 'cut') return false;
    if (!b()?.isDrawingLayerInteractive?.()) return false;
    var S = sim();
    if (!S?.pathEdit || S.pathEdit.ghostDragging) return false;
    var xy = svgCoordsFromEvent(e);
    if (!xy) return false;
    b()?.resetMapPointerState?.({ keepVertexDrag: true });
    var editor = global.FTTHPathwayEditor;
    S.pathEdit.cutSwipe = { x0: xy.x, y0: xy.y, x1: xy.x, y1: xy.y };
    editor?.updateCutToolHover?.(xy.x, xy.y);
    b()?.requestOverlayRedraw?.();
    e.preventDefault();
    e.stopPropagation();
    return true;
  }

  function routePointerMove(e) {
    var tool = b()?.getActiveCanvasTool?.() || 'select';
    var S = sim();
    if (S?.pathEdit?.ghostDragging) return false;

    if (tool === 'vertex' || b()?.canPenDraw?.()) {
      if (!isGhostPointerDown() && !penPointerTrackingAttached) {
        updateCrosshairFromEvent(e);
      }
    }

    if (tool !== 'cut') return false;
    var xy = svgCoordsFromEvent(e);
    if (!xy) return false;
    var editor = global.FTTHPathwayEditor;
    editor?.updateCutToolHover?.(xy.x, xy.y);
    if (S?.pathEdit?.cutSwipe) {
      S.pathEdit.cutSwipe.x1 = xy.x;
      S.pathEdit.cutSwipe.y1 = xy.y;
      b()?.syncCutTargetCursor?.();
      b()?.requestOverlayRedraw?.();
    }
    return true;
  }

  function routePointerUp(e) {
    var tool = b()?.getActiveCanvasTool?.() || 'select';
    if (tool !== 'cut') return false;
    var S = sim();
    if (!S?.pathEdit) return false;
    var hadSwipe = !!S.pathEdit.cutSwipe;
    if (!hadSwipe) return false;
    var xy = svgCoordsFromEvent(e);
    if (!xy) {
      b()?.resetMapPointerState?.();
      return true;
    }
    var editor = global.FTTHPathwayEditor;
    var sw = S.pathEdit.cutSwipe;
    var didCut = false;
    if (sw && Math.hypot(sw.x1 - sw.x0, sw.y1 - sw.y0) > 6) {
      didCut = editor?.splitBySwipe?.(sw.x0, sw.y0, sw.x1, sw.y1);
      if (didCut) b()?.updateStatus?.('Path cut — open ends marked with red dots');
    } else {
      didCut = editor?.smartSplitAtClick?.(xy.x, xy.y);
    }
    b()?.resetMapPointerState?.();
    if (didCut) b()?.requestCanvasRedraw?.();
    return true;
  }

  function routeVertexDblClick(e) {
    if (b()?.getActiveCanvasTool?.() !== 'vertex') return false;

    if (isGhostSessionActive() && sim()?.pathEdit?.ghostPosition) {
      finalizeGhostVertexCommit();
      e.preventDefault();
      e.stopPropagation();
      return true;
    }

    var xy = svgCoordsFromEvent(e);
    if (!xy) return false;
    focusVertexPathAtClick(xy, e.clientX, e.clientY);
    var editor = global.FTTHPathwayEditor;
    if (!editor?.addVertexAtDblClick?.(xy.x, xy.y)) return false;
    e.preventDefault();
    e.stopPropagation();
    return true;
  }

  function bindCutPointerSafety() {
    if (sim()?.ui?.cutPointerSafetyBound) return;
    document.addEventListener('pointerup', function (e) {
      var S = sim();
      if (b()?.getActiveCanvasTool?.() !== 'cut' || !S?.pathEdit?.cutSwipe) return;
      routePointerUp(e);
    }, true);
    document.addEventListener('pointercancel', function () {
      if (b()?.getActiveCanvasTool?.() === 'cut') b()?.resetMapPointerState?.();
    }, true);
    var ui = sim()?.ui;
    if (ui) ui.cutPointerSafetyBound = true;
  }

  function onPenDblClick(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    }

    if (!b()?.canPenDraw?.()) return false;
    var S = sim();
    if (!S?.penDraft) return false;

    penFinishingDblClick = true;
    cableFinishingDblClick = true;

    try {
      applySnappedFinishToDraft(S.penDraft, e);

      if (S.pen?.lineMode === 'cable') {
        if (cableContinuePromptLocked) return true;
        if (!S.penDraft.points?.length) {
          forceExitPenDrawing('Drawing cancelled');
          return true;
        }
        if (cableSaveInProgress) return true;
        finishPenDrawing({ trimDblClick: false, finishEvent: e, fromDoubleClick: true });
        return true;
      }

      if (S.penDraft.points?.length >= 2) {
        finishPenDrawing({ trimDblClick: true, finishEvent: e, fromDoubleClick: true });
        return true;
      }

      if (S.penDraft.points?.length === 1) {
        forceExitPenDrawing('Drawing cancelled');
        return true;
      }

      return false;
    } finally {
      penFinishingDblClick = false;
    }
  }

  function syncMapInteractionCursor() {
    var wrap = document.getElementById('canvas-wrapper');
    if (!wrap) return;
    var S = sim();
    var ui = S?.ui;

    if (global.FTTHUiController?.isToolboxHoverActive?.()) {
      wrap.classList.remove(
        'ftth-cursor-hand', 'ftth-cursor-placement', 'ftth-cursor-draw',
        'ftth-cursor-crosshair', 'ftth-cursor-select', 'ftth-cursor-active-tool', 'ftth-cursor-tool-locked'
      );
      wrap.classList.add('ftth-cursor-pointer');
      return;
    }
    wrap.classList.remove('ftth-cursor-pointer');

    var temporaryPan = !!(ui?.spacePanActive || ui?.middleMousePanActive || ui?.mapGesturePanActive);
    var hand = S?.interactionMode === 'hand';
    var placement = !!b()?.isPlacementToolActive?.();
    var pen = !!b()?.canPenDraw?.();
    var vertex = b()?.getActiveCanvasTool?.() === 'vertex';
    var measure = b()?.getActiveCanvasTool?.() === 'measure';
    var toolActive = placement || pen;

    wrap.classList.remove('ftth-cursor-draw', 'ftth-cursor-placement', 'ftth-cursor-select');

    if (temporaryPan) {
      wrap.classList.add('ftth-cursor-hand');
      wrap.classList.remove('ftth-cursor-crosshair', 'ftth-cursor-active-tool', 'ftth-cursor-tool-locked');
      return;
    }

    if (measure) {
      wrap.classList.remove('ftth-cursor-hand', 'ftth-cursor-active-tool', 'ftth-cursor-tool-locked');
      wrap.classList.add('ftth-cursor-crosshair');
      return;
    }

    if (hand || (!toolActive && !vertex)) {
      wrap.classList.add('ftth-cursor-hand');
      wrap.classList.remove('ftth-cursor-crosshair', 'ftth-cursor-active-tool', 'ftth-cursor-tool-locked');
      return;
    }

    wrap.classList.remove('ftth-cursor-hand');
    wrap.classList.toggle('ftth-cursor-crosshair', pen || vertex);
    wrap.classList.toggle('ftth-cursor-active-tool', placement && !pen);
    wrap.classList.toggle('ftth-cursor-tool-locked', toolActive);
  }

  global.FTTHDrawingEngine = {
    SNAP_THRESHOLD: SNAP_THRESHOLD,
    SNAP_THRESHOLD_SQ: SNAP_THRESHOLD_SQ,
    CABLE_MAGNETIC_SNAP_RADIUS: CABLE_MAGNETIC_SNAP_RADIUS,
    CABLE_MAGNETIC_SNAP_SQ: CABLE_MAGNETIC_SNAP_SQ,
    PEN_SNAP_RADIUS: SNAP_THRESHOLD,
    CROSSHAIR_SNAP_RADIUS: SNAP_THRESHOLD,
    PEN_RUBBER_COLOR: PEN_RUBBER_COLOR,
    PEN_RUBBER_DASH: PEN_RUBBER_DASH,
    init: function (deps) {
      bridge = deps;
      ensureFloatingLabelLayerStyles();
    },
    ensurePenDraft: ensurePenDraft,
    addPenVertexFromEvent: addPenVertexFromEvent,
    addPenVertexFromPlacedNode: addPenVertexFromPlacedNode,
    handleCablePointClick: handleCablePointClick,
    tryPenReconnectOrAdd: tryPenReconnectOrAdd,
    startCableDrawingFromEvent: startCableDrawingFromEvent,
    updateRubberBandFromEvent: updateRubberBandFromEvent,
    updateLiveRubberLine: updateLiveRubberLine,
    flushPenDrawingVisuals: flushPenDrawingVisuals,
    flushPenCursorVisuals: flushPenCursorVisuals,
    syncPenPointerTracking: syncPenPointerTracking,
    isPenPointerTrackingActive: function () { return penPointerTrackingAttached; },
    penPreviewCursorXY: penPreviewCursorXY,
    removeLastVertex: removeLastVertex,
    redoLastVertex: redoLastVertex,
    cancelCurrentDrawing: cancelCurrentDrawing,
    finishPenDrawing: finishPenDrawing,
    acceptCableContinueOffer: acceptCableContinueOffer,
    declineCableContinueOffer: declineCableContinueOffer,
    isCableContinuePromptActive: isCableContinuePromptActive,
    hideCableContinueFab: hideCableContinueFab,
    clearCableContinueSession: clearCableContinueSession,
    syncPenDraftPathState: syncPenDraftPathState,
    updatePathState: updatePathState,
    handlePenKeyDown: handlePenKeyDown,
    onPenPointerDown: onPenPointerDown,
    onPenDblClick: onPenDblClick,
    isPenFinishingDblClick: function () { return penFinishingDblClick || cableFinishingDblClick; },
    findReconnectEndpoint: findReconnectEndpoint,
    findCrosshairSnapTarget: findCrosshairSnapTarget,
    getSnappedPosition: getSnappedPosition,
    screenDistSqBetweenCanvasPoints: screenDistSqBetweenCanvasPoints,
    getCableEffectiveSnapRadius: getCableEffectiveSnapRadius,
    screenDistSqToCanvasPoint: screenDistSqToCanvasPoint,
    getDeviceSnapCenter: getDeviceSnapCenter,
    resolvePathPointsForRender: resolvePathPointsForRender,
    getEffectiveMapZoom: getEffectiveMapZoom,
    calculateCableStackSpacing: calculateCableStackSpacing,
    calculateCableOffset: calculateCableOffset,
    calculateCableOffsets: calculateCableOffsets,
    calculateRequiredTrenchWidth: calculateRequiredTrenchWidth,
    resolveDynamicCornerRadiiForTrench: resolveDynamicCornerRadiiForTrench,
    computeZoomPanAdjust: computeZoomPanAdjust,
    snapPixel: snapPixel,
    snapPixelPathPoints: snapPixelPathPoints,
    preparePixelPerfectRenderContext: preparePixelPerfectRenderContext,
    shouldShowCableMapLabels: shouldShowCableMapLabels,
    buildTrenchAdaptiveCableGeometry: buildTrenchAdaptiveCableGeometry,
    buildCableGeometryFromBasePoints: buildCableGeometryFromBasePoints,
    prepareDrawingLayer: prepareDrawingLayer,
    renderGisOverlays: renderGisOverlays,
    renderMapLabels: renderMapLabels,
    requestMapLabelsRedraw: requestMapLabelsRedraw,
    syncRigidGroupedMapEntityLabels: syncRigidGroupedMapEntityLabels,
    syncMapViewportLabelPresentation: syncMapViewportLabelPresentation,
    clearFatPoleIconInlineTransforms: clearFatPoleIconInlineTransforms,
    purgeFatRigidMarkerInternalTransforms: purgeFatRigidMarkerInternalTransforms,
    syncFatRigidMarkerRotation: syncFatRigidMarkerRotation,
    getMapViewportCanvasBounds: getMapViewportCanvasBounds,
    applyViewportCullingToPlacedNodes: applyViewportCullingToPlacedNodes,
    isRigidGroupedMapEntity: isRigidGroupedMapEntity,
    patchActiveVertexRing: patchActiveVertexRing,
    patchVertexDragGhost: patchVertexDragGhost,
    clearVertexDragGhost: clearVertexDragGhost,
    beginGhostVertexDrag: beginGhostVertexDrag,
    updateGhostPositionFromEvent: updateGhostPositionFromEvent,
    commitGhostVertexDrag: commitGhostVertexDrag,
    finalizeGhostVertexCommit: finalizeGhostVertexCommit,
    cancelGhostVertexDrag: cancelGhostVertexDrag,
    resetAllGhostState: resetAllGhostState,
    isGhostSessionActive: isGhostSessionActive,
    isGhostPointerDown: isGhostPointerDown,
    releaseGhostPointer: releaseGhostPointer,
    hitTestVertexScreenPxAny: hitTestVertexScreenPxAny,
    hitTestVertexScreenPx: hitTestVertexScreenPx,
    canvasXYToScreenXY: canvasXYToScreenXY,
    requestGhostRedraw: requestGhostRedraw,
    focusVertexPathAtClick: focusVertexPathAtClick,
    renderCrosshair: renderCrosshair,
    renderCutOverlays: renderCutOverlays,
    renderCutOpenDots: renderCutOpenDots,
    updateCrosshairFromEvent: updateCrosshairFromEvent,
    updateCrosshairFromXY: updateCrosshairFromXY,
    hideCrosshair: hideCrosshair,
    shouldShowCrosshair: shouldShowCrosshair,
    isCrosshairOverMap: isCrosshairOverMap,
    setCrosshairMapHover: setCrosshairMapHover,
    bindCrosshairBoundaries: bindCrosshairBoundaries,
    isPointOverMapCanvas: isPointOverMapCanvas,
    routePointerDown: routePointerDown,
    routeVertexPointerDown: routeVertexPointerDown,
    routeVertexDblClick: routeVertexDblClick,
    routePointerMove: routePointerMove,
    routePointerUp: routePointerUp,
    syncCanvasToolChrome: syncCanvasToolChrome,
    syncMapInteractionCursor: syncMapInteractionCursor,
  };
})(window);
