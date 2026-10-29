/**
 * FTTH Label Manager — standalone overlay plugin (read-only data).
 * Visual label placement only; does not modify drawing/placement/cable logic.
 */
(function (global) {
  'use strict';

  var api = null;
  var overlayEl = null;
  var stylesInjected = false;
  var renderScheduled = false;
  var deferredViewportRefresh = false;
  var measureCanvas = null;
  var measureCtx = null;
  var cachedCanvasWrapper = null;

  /** Ephemeral pen/crosshair/rubber-band overlay — not structural map geometry. */
  var DRAWING_OVERLAY_ROOT_IDS = {
    'drawing-overlay-top': 1,
    'pen-rubber-band': 1,
    'qfield-crosshair': 1,
    'pen-draft-live-path': 1,
    'cable-magnetic-snap-marker': 1,
    'pen-vertex-markers': 1,
    'cable-anchor-dots': 1,
    'device-snap-center-point': 1,
    'vertex-active-ring': 1,
    'vertex-insert-preview': 1,
    'vertex-ghost-line-prev': 1,
    'vertex-ghost-line-next': 1,
  };

  var HANDHOLE_SLOTS = ['TL', 'T', 'TR', 'L', 'R', 'BL', 'B', 'BR'];
  var POLE_SLOTS = ['T', 'TL', 'TR', 'L', 'R', 'BL', 'BR'];
  var SLOT_GAP = 1;
  var RADII = { handhole: 4, pole: 5, cabinet: 6 };
  var TOOL_LABEL_EDGE_GAP = 1;
  var TOOL_LABEL_EDGE_GAP_MIN = 0;
  var TOOL_LABEL_EDGE_GAP_MAX = 3;
  var CABLE_OFFSET_PATTERN = [0, 4, -4, 8, -8];
  var CABLE_BADGE_SAFETY_SCREEN_MIN = 4;
  var CABLE_BADGE_SAFETY_SCREEN_MAX = 10;
  var CABLE_LOD_FONT_MIN_SCALE = 0.82;
  var CABLE_LOD_FONT_FULL_SCALE = 1;
  var CABLE_LOD_ZOOM_FULL = 2.5;
  /* Longitudinal array along the cable path (map px) — packed tight. */
  var CABLE_PATH_LOCK_DIST_MIN_PX = 18;
  var CABLE_PATH_LOCK_DIST_MAX_PX = 22;
  var CABLE_PATH_BASE_SAFETY_PX = 20;
  var CABLE_TERMINAL_SAFETY_MARGIN_PX = 18;
  var CABLE_TERMINAL_STACK_GAP_PX = 10;
  /* Sequential along-path gap: distance = base + index * gap (~text width). */
  var CABLE_LABEL_ALONG_GAP_PX = 35;
  var CABLE_LABEL_BRANCH_BUCKET_DEG = 20;
  var CABLE_LABEL_PEER_CLEAR_PX = 1;
  var CABLE_LABEL_PEER_PUSH_MAX = 4;
  var CABLE_SEGMENT_SIDE_OFFSET_PX = 0;
  var CABLE_BADGE_PAD_X = 0;
  var CABLE_BADGE_PAD_Y = 0;
  var CABLE_TERMINAL_PAD_H_PX = 18;
  var CABLE_TERMINAL_PAD_FH_PX = 18;
  var CABLE_TERMINAL_PAD_FH_TOP_EXTRA_PX = 0;
  var CABLE_TERMINAL_PAD_CABINET_PX = 18;
  var CABLE_TERMINAL_PAD_POLE_PX = 18;
  var CABLE_TERMINAL_HEADER_CLEAR_PX = 2;
  var CABLE_TERMINAL_HEADER_PUSH_MAX = 2;
  var LABEL_TEXT_PAD = 2;
  var OBJECT_AVOID_PAD = 10;
  var ZOOM_CABLE_LABELS_MIN = 3;
  var CABLE_ROW_GAP = 4;
  var CABLE_ALONG_GAP = 3;
  var CABLE_LABELS_PER_ROW = 3;
  var CABLE_MAX_ROWS = 12;
  var CABLE_MAX_ANCHOR_DIST = 15;
  var DEFAULT_TOOL_LABEL_ZOOM_MIN = 1;
  /* Cable badges only when heavily zoomed on a node (~300%+). */
  var DEFAULT_CABLE_LABEL_ZOOM_MIN = 3;
  var CABLE_LABEL_BASE_FONT_SIZE_PX = 10;
  /* Cable-label-only adaptive distance from cable/object (zoom in → closer). */
  var CABLE_OFFSET_ZOOM_REF = 1;
  var CABLE_OFFSET_FACTOR_MIN = 0.4;
  var CABLE_OFFSET_FACTOR_MAX = 1;
  var CABLE_OFFSET_CURVE = 0.9;
  /* Cable zoom-lerp: stop this far outside owned device boundary (map px). */
  var CABLE_ENDPOINT_SYNTHETIC_RADIUS = 14;
  var CABLE_BASE_LAYOUT_ZOOM = 1;
  var CABLE_FOCUS_ZOOM_MIN = 3;
  var CABLE_FOCUS_DEVICE_PAD = 22;
  var CABLE_FOCUS_POLE_LIFT = 26;
  var CABLE_FOCUS_LABEL_GAP = 6;
  var lastRenderSignature = '';
  var lastRenderedHtml = '';

  function getZoomFactor() {
    return api?.getZoomFactor?.() || 1;
  }

  /**
   * Cable labels only: scale perpendicular distance from the cable/object.
   * Zoom in → factor ↓ → labels tuck closer along their existing offset side.
   * Does not alter along-path spacing or inter-label gaps.
   */
  function getCableLabelOffsetFactor(zoom) {
    var z = zoom != null ? zoom : getZoomFactor();
    z = Number(z);
    if (!isFinite(z) || z <= 0) z = 1;
    if (z <= CABLE_OFFSET_ZOOM_REF) return CABLE_OFFSET_FACTOR_MAX;
    var raw = Math.pow(CABLE_OFFSET_ZOOM_REF / z, CABLE_OFFSET_CURVE);
    return Math.max(CABLE_OFFSET_FACTOR_MIN, Math.min(CABLE_OFFSET_FACTOR_MAX, raw));
  }

  function getToolLabelZoomMin() {
    var pct = api?.getToolLabelZoomMinPct?.();
    if (!isFinite(pct)) return DEFAULT_TOOL_LABEL_ZOOM_MIN;
    return Math.max(0.5, pct / 100);
  }

  function getCableLabelZoomMin() {
    var pct = api?.getCableLabelZoomMinPct?.();
    if (!isFinite(pct)) return DEFAULT_CABLE_LABEL_ZOOM_MIN;
    return Math.max(0.5, pct / 100);
  }

  function shouldShowToolLabels() {
    return true;
  }

  function shouldShowCableLabels() {
    /* No upper zoom cap — labels stay visible through MAP_ZOOM_MAX (500%) and above. */
    return getZoomFactor() >= getCableLabelZoomMin();
  }

  /** Stable terminal-label mode: on/off by zoom threshold only (no per-frame flicker). */
  function getCableLabelLod(zoom) {
    var z = Number(zoom != null ? zoom : getZoomFactor());
    if (!isFinite(z) || z <= 0) z = 1;
    if (z < getCableLabelZoomMin()) {
      return { show: false, fontScale: 1, safetyGapCanvas: CABLE_TERMINAL_SAFETY_MARGIN_PX, opacity: 1 };
    }
    /* Dynamic font scale: starts at 1.0 at threshold, grows with zoom */
    var fontScale = z / getCableLabelZoomMin();
    return {
      show: true,
      fontScale: fontScale,
      safetyGapCanvas: CABLE_TERMINAL_SAFETY_MARGIN_PX,
      opacity: 1,
    };
  }

  function renderSignature(zoom, entityCount, cableCount, color, fontSize, showTools, showCables, activeNodeId) {
    var vs = api?.getViewportState?.() || {};
    var vpCenter = getMapViewportCenter({
      zoom: vs.zoom != null ? vs.zoom : zoom,
      panX: vs.panX || 0,
      panY: vs.panY || 0,
    });
    return [
      showTools ? 'tool-visible' : 'tool-hidden',
      showCables ? 'cable-visible' : 'cable-hidden',
      getToolLabelZoomMin().toFixed(3),
      getCableLabelZoomMin().toFixed(3),
      zoom.toFixed(2),
      Math.round(Number(vs.panX) || 0),
      Math.round(Number(vs.panY) || 0),
      Math.round(vpCenter.x),
      Math.round(vpCenter.y),
      activeNodeId || '',
      entityCount,
      cableCount,
      color,
      fontSize,
    ].join('|');
  }

  function ensureStyles() {
    var style = document.getElementById('ftth-label-manager-overlay-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'ftth-label-manager-overlay-style';
      document.head.appendChild(style);
    }
    stylesInjected = true;
    style.textContent = [
      '#ftth-entity-label-overlay{',
      'position:absolute;left:0;top:0;width:100%;height:100%;',
      'pointer-events:none!important;z-index:1000;overflow:visible;}',
      '.ftth-entity-label{',
      'position:absolute;white-space:nowrap;line-height:1.2;',
      'font-family:Arial,sans-serif!important;',
      'font-weight:400!important;',
      'background:none!important;padding:0!important;margin:0!important;',
      'border:none!important;border-radius:0!important;',
      'text-shadow:1px 1px 1px rgba(0,0,0,0.8)!important;',
      'filter:none!important;box-shadow:none!important;',
      '-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;',
      '-webkit-text-stroke:0!important;paint-order:normal!important;',
      'pointer-events:none!important;user-select:none;box-sizing:content-box;}',
      '.ftth-entity-label--entity{z-index:1005!important;}',
      '.ftth-entity-label--cable{z-index:1001!important;}',
      '.ftth-entity-label--cable-badge{',
      'z-index:1002!important;',
      'background:transparent!important;',
      'padding:0!important;margin:0!important;',
      'border:none!important;border-radius:0!important;',
      'box-shadow:none!important;filter:none!important;',
      'color:#FFFFFF!important;',
      'font-weight:400!important;',
      '-webkit-text-stroke:0!important;',
      'paint-order:normal!important;',
      'transform-origin:center center!important;',
      'text-shadow:1px 1px 2px rgba(0,0,0,0.9)!important;}',
      '.ftth-entity-label--cable-focus{z-index:1002!important;}',
      'html.ftth-overlay-labels-visible .placed-node .element-label.field-node-label--map:not(.pole-label){',
      'visibility:hidden!important;pointer-events:none!important;',
      'background:none!important;text-shadow:none!important;box-shadow:none!important;}',
      'html.ftth-overlay-labels-visible .placed-node .marker-container .pole-label{',
      'visibility:visible!important;pointer-events:auto!important;}',
      'html.ftth-tool-labels-zoom-hidden .placed-node .element-label.field-node-label--map:not(.pole-label){',
      'visibility:hidden!important;pointer-events:none!important;}',
      'html.ftth-tool-labels-zoom-hidden .placed-node .marker-container .pole-label{',
      'visibility:visible!important;}',
    ].join('');
  }

  function ensureOverlay() {
    if (overlayEl && overlayEl.isConnected) return overlayEl;
    var host = api?.getOverlayHost?.();
    if (!host) return null;
    overlayEl = document.getElementById('ftth-entity-label-overlay');
    if (!overlayEl) {
      overlayEl = document.createElement('div');
      overlayEl.id = 'ftth-entity-label-overlay';
      overlayEl.setAttribute('aria-hidden', 'true');
      host.appendChild(overlayEl);
    } else if (overlayEl.parentElement !== host) {
      host.appendChild(overlayEl);
    }
    return overlayEl;
  }

  function pointAtPathPercentage(points, pct) {
    if (!points || points.length < 2) return null;
    var totalLen = 0;
    var segLens = [];
    var i;
    for (i = 0; i < points.length - 1; i++) {
      var dx = points[i + 1][0] - points[i][0];
      var dy = points[i + 1][1] - points[i][1];
      var len = Math.hypot(dx, dy);
      segLens.push(len);
      totalLen += len;
    }
    if (totalLen <= 0) {
      return { x: points[0][0], y: points[0][1], angle: 0 };
    }
    var target = Math.max(0, Math.min(1, pct)) * totalLen;
    var acc = 0;
    for (i = 0; i < segLens.length; i++) {
      if (acc + segLens[i] >= target) {
        var t = segLens[i] > 0 ? (target - acc) / segLens[i] : 0;
        return {
          x: points[i][0] + t * (points[i + 1][0] - points[i][0]),
          y: points[i][1] + t * (points[i + 1][1] - points[i][1]),
          angle: Math.atan2(
            points[i + 1][1] - points[i][1],
            points[i + 1][0] - points[i][0]
          ) * (180 / Math.PI),
        };
      }
      acc += segLens[i];
    }
    var last = points.length - 1;
    return {
      x: points[last][0],
      y: points[last][1],
      angle: Math.atan2(
        points[last][1] - points[last - 1][1],
        points[last][0] - points[last - 1][0]
      ) * (180 / Math.PI),
    };
  }

  function findObstacleByNodeId(obstacles, nodeId) {
    if (nodeId == null || nodeId === '' || !obstacles || !obstacles.length) return null;
    var id = String(nodeId);
    var i;
    for (i = 0; i < obstacles.length; i++) {
      var obs = obstacles[i];
      if (obs && String(obs.nodeId) === id) return obs;
    }
    return null;
  }

  /**
   * Owned endpoint obstacle: table lookup first, else cable polyline endpoint
   * at the snapped node id (ownership from cable data — never nearest-device).
   */
  function ownedEndpointObstacle(nodeId, endPct, points, obstacles) {
    if (nodeId == null || nodeId === '') return null;
    var obs = findObstacleByNodeId(obstacles, nodeId);
    if (obs) return obs;
    if (!points || points.length < 2) return null;
    var last = points.length - 1;
    return {
      nodeId: String(nodeId),
      x: endPct < 0.5 ? points[0][0] : points[last][0],
      y: endPct < 0.5 ? points[0][1] : points[last][1],
      radius: CABLE_ENDPOINT_SYNTHETIC_RADIUS,
    };
  }

  /**
   * Attraction target from cable ownership only (snapped start/end nodes).
   * Never picks an unrelated nearby device.
   */
  function resolveOwnedEndpointTarget(points, obstacles, opts) {
    opts = opts || {};
    if (!points || points.length < 2) return null;
    var startId = opts.endpointStartNodeId || null;
    var endId = opts.endpointEndNodeId || null;
    if (!startId && !endId && opts.endpointNodeIds && opts.endpointNodeIds.length) {
      startId = opts.endpointNodeIds[0];
      if (opts.endpointNodeIds.length > 1) {
        endId = opts.endpointNodeIds[opts.endpointNodeIds.length - 1];
      }
    }
    var startObs = ownedEndpointObstacle(startId, 0, points, obstacles);
    var endObs = ownedEndpointObstacle(endId, 1, points, obstacles);
    var owned = [];
    if (startObs) owned.push({ endPct: 0, obs: startObs, nodeId: String(startId) });
    if (endObs && String(endId) !== String(startId)) {
      owned.push({ endPct: 1, obs: endObs, nodeId: String(endId) });
    }
    if (!owned.length) return null;
    if (owned.length === 1) {
      var single = owned[0];
      var lastIdx = points.length - 1;
      var ds0 = Math.hypot(single.obs.x - points[0][0], single.obs.y - points[0][1]);
      var dsL = Math.hypot(single.obs.x - points[lastIdx][0], single.obs.y - points[lastIdx][1]);
      single.endPct = ds0 <= dsL ? 0 : 1;
      return single;
    }

    var mid = pointAtPathPercentage(points, 0.5);
    if (!mid) return owned[0];
    var d0 = Math.hypot(mid.x - owned[0].obs.x, mid.y - owned[0].obs.y);
    var dL = Math.hypot(mid.x - owned[1].obs.x, mid.y - owned[1].obs.y);
    return d0 <= dL ? owned[0] : owned[1];
  }

  function shouldShowCableFocusMode(zoom) {
    return (zoom != null ? zoom : getZoomFactor()) >= CABLE_FOCUS_ZOOM_MIN;
  }

  function getCanvasWrapper() {
    if (cachedCanvasWrapper && cachedCanvasWrapper.isConnected) return cachedCanvasWrapper;
    cachedCanvasWrapper = document.getElementById('canvas-wrapper');
    return cachedCanvasWrapper;
  }

  function getMapViewportBounds(vs) {
    var bounds = api?.getMapViewportCanvasBounds?.();
    if (bounds && isFinite(bounds.x0) && isFinite(bounds.x1)) {
      return bounds;
    }
    var wrap = getCanvasWrapper();
    if (!wrap) return null;
    var w = wrap.clientWidth || 0;
    var h = wrap.clientHeight || 0;
    var z = (vs && vs.zoom != null ? vs.zoom : getZoomFactor());
    if (!isFinite(z) || z <= 0) z = 1;
    var panX = (vs && vs.panX) || 0;
    var panY = (vs && vs.panY) || 0;
    var pad = 96 / Math.max(z, 0.1);
    return {
      x0: (-panX) / z - pad,
      y0: (-panY) / z - pad,
      x1: (w - panX) / z + pad,
      y1: (h - panY) / z + pad,
    };
  }

  function getMapViewportCenter(vs) {
    var fromApi = api?.getViewportWorldCenter?.();
    if (fromApi && isFinite(fromApi.x) && isFinite(fromApi.y)) {
      return { x: fromApi.x, y: fromApi.y };
    }
    var bounds = getMapViewportBounds(vs);
    if (bounds) {
      return {
        x: (bounds.x0 + bounds.x1) / 2,
        y: (bounds.y0 + bounds.y1) / 2,
      };
    }
    return { x: 0, y: 0 };
  }

  function isPointInMapViewport(x, y, vs) {
    if (!isFinite(x) || !isFinite(y)) return true;
    var bounds = getMapViewportBounds(vs);
    if (!bounds) return true;
    return x >= bounds.x0 && x <= bounds.x1 && y >= bounds.y0 && y <= bounds.y1;
  }

  function buildFocusDeviceIndex(obstacles, entityEntries) {
    var index = {};
    (obstacles || []).forEach(function (obs) {
      if (!obs || obs.nodeId == null) return;
      index[String(obs.nodeId)] = {
        nodeId: String(obs.nodeId),
        x: obs.x,
        y: obs.y,
        radius: obs.radius || 14,
        isPole: false,
        type: obs.type || 'handhole',
        autoName: obs.autoName || null,
      };
    });
    (entityEntries || []).forEach(function (ent) {
      if (!ent || !ent.nodeId) return;
      var dev = index[String(ent.nodeId)];
      if (!dev) return;
      if (ent.type === 'pole_foundation' || ent.type === 'pole') {
        dev.isPole = true;
      }
      if (ent.type === 'fdt' || ent.type === 'olt') dev.type = 'cabinet';
      else if (ent.type === 'fat_handhole') dev.type = 'fat';
      else if (ent.type === 'handhole') dev.type = 'handhole';
    });
    (api?.getEntities?.() || []).forEach(function (ent) {
      if (!ent || !ent.id) return;
      var dev = index[String(ent.id)];
      if (!dev) return;
      if (ent.type === 'pole_foundation' || ent.type === 'pole') dev.isPole = true;
      if (ent.type === 'fdt' || ent.type === 'olt') dev.type = 'cabinet';
      else if (ent.type === 'fat_handhole') dev.type = 'fat';
      else if (ent.type === 'handhole') dev.type = 'handhole';
      if (ent.autoName) dev.autoName = ent.autoName;
    });
    return index;
  }

  function cableConnectedToDevice(entry, nodeId) {
    if (!entry || nodeId == null || nodeId === '') return false;
    var id = String(nodeId);
    if (String(entry.endpointStartNodeId) === id || String(entry.endpointEndNodeId) === id) {
      return true;
    }
    var eps = entry.endpointNodeIds || [];
    var i;
    for (i = 0; i < eps.length; i++) {
      if (String(eps[i]) === id) return true;
    }
    return false;
  }

  /** Focus-only: cable polyline endpoint within device clearance when snap ids are absent. */
  function cableEndpointNearDevice(entry, device) {
    if (!entry || !device || !entry.points || entry.points.length < 2) return false;
    var clearance = (device.radius || 14) + CABLE_ENDPOINT_SYNTHETIC_RADIUS + 4;
    var first = entry.points[0];
    var last = entry.points[entry.points.length - 1];
    return Math.hypot(first[0] - device.x, first[1] - device.y) <= clearance ||
      Math.hypot(last[0] - device.x, last[1] - device.y) <= clearance;
  }

  function resolveDeviceWorldXY(nodeId, fallbackDevice) {
    var id = nodeId != null ? String(nodeId) : '';
    var fromApi = id && api?.getNodeWorldXY?.(id);
    if (fromApi && isFinite(fromApi.x) && isFinite(fromApi.y)) {
      return {
        nodeId: id,
        x: fromApi.x,
        y: fromApi.y,
        radius: fromApi.radius || (fallbackDevice && fallbackDevice.radius) || CABLE_ENDPOINT_SYNTHETIC_RADIUS,
        isPole: !!(fromApi.isPole || (fallbackDevice && fallbackDevice.isPole)),
        type: fromApi.type || (fallbackDevice && fallbackDevice.type) || 'handhole',
        autoName: fromApi.autoName || (fallbackDevice && fallbackDevice.autoName) || null,
      };
    }
    if (fallbackDevice && isFinite(fallbackDevice.x) && isFinite(fallbackDevice.y)) {
      return {
        nodeId: String(fallbackDevice.nodeId || id),
        x: fallbackDevice.x,
        y: fallbackDevice.y,
        radius: fallbackDevice.radius || CABLE_ENDPOINT_SYNTHETIC_RADIUS,
        isPole: !!fallbackDevice.isPole,
        type: fallbackDevice.type || 'handhole',
        autoName: fallbackDevice.autoName || null,
      };
    }
    return null;
  }

  /** Classify terminal node geometry: fh (triangle+header), h (square), pole, cabinet. */
  function classifyTerminalNodeKind(device) {
    if (!device) return 'h';
    var t = String(device.type || '');
    var name = String(device.autoName || '');
    if (device.isPole || t === 'pole' || t === 'pole_foundation') return 'pole';
    if (t === 'cabinet' || t === 'fdt' || t === 'olt') return 'cabinet';
    if (t === 'fat' || t === 'fat_handhole' || /^FH/i.test(name)) return 'fh';
    if (t === 'handhole' || /^H\d/i.test(name)) return 'h';
    return 'h';
  }

  function terminalSafetyMarginForNode(device, exitUy) {
    var kind = classifyTerminalNodeKind(device);
    var radius = (device && device.radius) || CABLE_ENDPOINT_SYNTHETIC_RADIUS;
    var base;
    if (kind === 'fh') {
      base = Math.max(CABLE_TERMINAL_PAD_FH_PX, radius + 18);
      /* Triangle apex + FH## header sit above center — add extra when branch goes upward. */
      if (exitUy < -0.25) base += CABLE_TERMINAL_PAD_FH_TOP_EXTRA_PX;
      return base;
    }
    if (kind === 'cabinet') {
      return Math.max(CABLE_TERMINAL_PAD_CABINET_PX, radius + 12);
    }
    if (kind === 'pole') {
      return Math.max(CABLE_TERMINAL_PAD_POLE_PX, radius + 10);
    }
    /* Standard square H / H#C# handhole */
    return Math.max(CABLE_TERMINAL_PAD_H_PX, radius + 8);
  }

  function cableLabelOverlapsNodeHeader(rect, ctx, nodeId) {
    if (!rect || !ctx || !ctx.placed) return false;
    var id = String(nodeId || '');
    var i;
    for (i = 0; i < ctx.placed.length; i++) {
      var p = ctx.placed[i];
      if (!p || p.labelKind !== 'tool') continue;
      if (p.nodeId != null && String(p.nodeId) !== id) continue;
      if (rectsOverlap(rect, p, CABLE_TERMINAL_HEADER_CLEAR_PX)) return true;
    }
    return false;
  }

  function pushCableLabelClearOfHeaders(rect, anchorX, anchorY, exit, stackOffset, perpX, perpY, size, angle, safety, ctx, nodeId) {
    var cx = rect.anchorX;
    var cy = rect.anchorY;
    var bump = safety;
    var step;
    for (step = 0; step < CABLE_TERMINAL_HEADER_PUSH_MAX; step++) {
      if (!cableLabelOverlapsNodeHeader(rect, ctx, nodeId)) return rect;
      bump += size.height * 0.55 + CABLE_TERMINAL_HEADER_CLEAR_PX;
      cx = anchorX + exit.ux * bump + perpX * stackOffset;
      cy = anchorY + exit.uy * bump + perpY * stackOffset;
      rect = cableLabelRect(cx, cy, size, angle, 0, 0);
      rect.labelKind = 'cable';
    }
    return rect;
  }

  /** Nearest visible device to map viewport center (read-only). */
  function getNearestDeviceToViewportCenter(deviceIndex, vs) {
    if (!deviceIndex) return null;
    var center = getMapViewportCenter(vs);
    var best = null;
    var bestDist = Infinity;
    Object.keys(deviceIndex).forEach(function (nodeId) {
      var raw = deviceIndex[nodeId];
      if (!raw) return;
      var dev = resolveDeviceWorldXY(nodeId, raw);
      if (!dev || !isPointInMapViewport(dev.x, dev.y, vs)) return;
      var d = Math.hypot(dev.x - center.x, dev.y - center.y);
      if (d < bestDist) {
        bestDist = d;
        best = dev;
      }
    });
    return best;
  }

  /** Active zoom node: prefer selected node, else nearest to true viewport world center. */
  function getActiveZoomNodeForLabels(deviceIndex, vs) {
    var z = vs && vs.zoom != null ? vs.zoom : getZoomFactor();
    if (z < getCableLabelZoomMin()) return null;

    var selectedId = api?.getSelectedNodeId?.();
    if (selectedId != null && selectedId !== '') {
      var selectedRaw = deviceIndex && deviceIndex[String(selectedId)];
      var selectedDev = resolveDeviceWorldXY(selectedId, selectedRaw);
      if (selectedDev) return selectedDev;
    }

    return getNearestDeviceToViewportCenter(deviceIndex, vs);
  }

  /** Single viewport-focused device: nearest visible node to map viewport center. */
  function getFocusedDeviceForViewport(deviceIndex, vs) {
    if (!deviceIndex || !shouldShowCableFocusMode(vs.zoom)) return null;
    return getNearestDeviceToViewportCenter(deviceIndex, vs);
  }

  function buildNodeCableGroups(entries) {
    var nodeGroups = {};
    (entries || []).forEach(function (entry) {
      (entry.endpointNodeIds || []).forEach(function (nodeId) {
        if (!nodeGroups[nodeId]) nodeGroups[nodeId] = [];
        if (nodeGroups[nodeId].indexOf(entry) === -1) nodeGroups[nodeId].push(entry);
      });
    });
    return nodeGroups;
  }

  /**
   * Orient cable badge towards the viewport-active node (start or end — never fromNode default).
   */
  function applyActiveZoomNodeAnchor(entry, activeNode, nodeGroups) {
    if (!entry || !activeNode || activeNode.nodeId == null || activeNode.nodeId === '') return;
    if (!cableConnectedToDevice(entry, activeNode.nodeId) &&
        !cableEndpointNearDevice(entry, activeNode)) {
      return;
    }

    var nodeId = String(activeNode.nodeId);
    entry.anchorNodeId = nodeId;

    if (String(entry.endpointEndNodeId) === nodeId) {
      entry.anchorEnd = 'end';
    } else if (String(entry.endpointStartNodeId) === nodeId) {
      entry.anchorEnd = 'start';
    } else if (entry.points && entry.points.length >= 2) {
      var pts = entry.points;
      var d0 = Math.hypot(pts[0][0] - activeNode.x, pts[0][1] - activeNode.y);
      var dL = Math.hypot(pts[pts.length - 1][0] - activeNode.x, pts[pts.length - 1][1] - activeNode.y);
      entry.anchorEnd = d0 <= dL ? 'start' : 'end';
    }

    var group = nodeGroups && nodeGroups[nodeId];
    if (group && group.length) {
      var sorted = group.slice().sort(function (a, b) {
        return String(a.id).localeCompare(String(b.id));
      });
      entry.laneIndex = sorted.indexOf(entry);
      if (entry.laneIndex < 0) entry.laneIndex = 0;
      entry.laneTotal = sorted.length;
    }
  }

  function buildCableFocusGroups(cableEntries, deviceIndex, vs) {
    var groups = {};
    var hiddenCenterIds = {};
    var focusedDevice = getFocusedDeviceForViewport(deviceIndex, vs);
    if (!focusedDevice) {
      return { groups: groups, hiddenCenterIds: hiddenCenterIds, focusedDeviceId: null };
    }

    var nodeId = focusedDevice.nodeId;
    var items = [];
    cableEntries.forEach(function (entry) {
      if (!cableConnectedToDevice(entry, nodeId) && !cableEndpointNearDevice(entry, focusedDevice)) {
        return;
      }
      hiddenCenterIds[String(entry.id)] = true;
      items.push({
        entry: entry,
        device: focusedDevice,
        laneIndex: entry.laneIndex || 0,
      });
    });

    if (items.length) {
      items.sort(function (a, b) {
        if (a.laneIndex !== b.laneIndex) return a.laneIndex - b.laneIndex;
        return String(a.entry.id).localeCompare(String(b.entry.id));
      });
      groups[nodeId] = items;
    }

    return {
      groups: groups,
      hiddenCenterIds: hiddenCenterIds,
      focusedDeviceId: items.length ? nodeId : null,
    };
  }

  /** Handhole / FAT / cabinet: vertical stack above device; lane 0 nearest device, higher lanes above. */
  function focusLabelPositionsVerticalStack(device, items, fontSize) {
    var placements = [];
    var sizes = items.map(function (item) {
      return measureLabel(item.entry.label, fontSize);
    });
    var yCursor = device.y - (device.radius || 14) - CABLE_FOCUS_DEVICE_PAD;
    var i;
    for (i = items.length - 1; i >= 0; i--) {
      var size = sizes[i];
      yCursor -= size.height;
      placements.unshift({
        entry: items[i].entry,
        x: device.x,
        y: yCursor + size.height / 2,
        angle: 0,
      });
      yCursor -= CABLE_FOCUS_LABEL_GAP;
    }
    return placements;
  }

  function focusLabelPositionsForPole(device, items, fontSize) {
    var placements = [];
    var totalWidth = 0;
    var sizes = items.map(function (item) {
      var size = measureLabel(item.entry.label, fontSize);
      totalWidth += size.width;
      return size;
    });
    totalWidth += CABLE_FOCUS_LABEL_GAP * Math.max(0, items.length - 1);
    var cursor = device.x - totalWidth / 2;
    var y = device.y - (device.radius || 14) - CABLE_FOCUS_POLE_LIFT;
    items.forEach(function (item, idx) {
      var size = sizes[idx];
      placements.push({
        entry: item.entry,
        x: cursor + size.width / 2,
        y: y,
        angle: 0,
      });
      cursor += size.width + CABLE_FOCUS_LABEL_GAP;
    });
    return placements;
  }

  function buildCableFocusPlacements(focusGroups, fontSize) {
    var nodeIds = Object.keys(focusGroups || {});
    if (!nodeIds.length) return [];
    var items = focusGroups[nodeIds[0]];
    if (!items || !items.length) return [];
    var device = items[0].device;
    if (device.isPole) {
      return focusLabelPositionsForPole(device, items, fontSize);
    }
    return focusLabelPositionsVerticalStack(device, items, fontSize);
  }

  function readableCableAngle(angleDeg, mapRotation) {
    var a = (angleDeg || 0) + (mapRotation || 0);
    while (a > 180) a -= 360;
    while (a <= -180) a += 360;
    if (a > 90) a -= 180;
    if (a <= -90) a += 180;
    return a - (mapRotation || 0);
  }

  function measureLabel(text, fontSize) {
    if (!measureCanvas) {
      measureCanvas = document.createElement('canvas');
      measureCtx = measureCanvas.getContext('2d');
    }
    measureCtx.font = '400 ' + fontSize + 'px Arial,sans-serif';
    var textW = measureCtx.measureText(String(text)).width;
    return { width: Math.ceil(textW), height: Math.ceil(fontSize * 1.15) };
  }

  function rectsOverlap(a, b, pad) {
    pad = pad || 0;
    return (a.left - pad) < (b.left + b.width + pad) &&
      (a.left + a.width + pad) > (b.left - pad) &&
      (a.top - pad) < (b.top + b.height + pad) &&
      (a.top + a.height + pad) > (b.top - pad);
  }

  function pointSegDist(px, py, seg) {
    var x1 = seg.x1;
    var y1 = seg.y1;
    var x2 = seg.x2;
    var y2 = seg.y2;
    var dx = x2 - x1;
    var dy = y2 - y1;
    var lenSq = dx * dx + dy * dy;
    if (lenSq <= 0) return Math.hypot(px - x1, py - y1);
    var t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  function rectNearSegment(rect, seg, tol) {
    var cx = rect.left + rect.width / 2;
    var cy = rect.top + rect.height / 2;
    if (pointSegDist(cx, cy, seg) <= tol) return true;
    return pointSegDist(rect.left, rect.top, seg) <= tol ||
      pointSegDist(rect.left + rect.width, rect.top, seg) <= tol ||
      pointSegDist(rect.left, rect.top + rect.height, seg) <= tol ||
      pointSegDist(rect.left + rect.width, rect.top + rect.height, seg) <= tol;
  }

  function circleRectOverlap(obs, rect) {
    var cx = Math.max(rect.left, Math.min(obs.x, rect.left + rect.width));
    var cy = Math.max(rect.top, Math.min(obs.y, rect.top + rect.height));
    return Math.hypot(obs.x - cx, obs.y - cy) < obs.radius;
  }

  function profileForEntry(entry) {
    if (entry.role === 'fat-system') return 'pole';
    if (entry.type === 'fdt' || entry.type === 'olt' ||
        entry.role === 'fdt' || entry.role === 'splitter') return 'cabinet';
    return 'handhole';
  }

  function slotsForProfile(profile) {
    if (profile === 'pole') return POLE_SLOTS;
    return HANDHOLE_SLOTS;
  }

  function radiusForProfile(profile) {
    return RADII[profile] || RADII.handhole;
  }

  function buildSlotRect(x, y, size, slotId, objRadius, edgeGap) {
    var gap = edgeGap != null ? edgeGap : TOOL_LABEL_EDGE_GAP;
    var r = objRadius + gap;
    var w = size.width;
    var h = size.height;
    var rect = { width: w, height: h, slot: slotId };

    if (slotId === 'TL') {
      rect.left = x - r - w;
      rect.top = y - r - h;
    } else if (slotId === 'T') {
      rect.left = x - w / 2;
      rect.top = y - r - h;
    } else if (slotId === 'TR') {
      rect.left = x + r;
      rect.top = y - r - h;
    } else if (slotId === 'L') {
      rect.left = x - r - w;
      rect.top = y - h / 2;
    } else if (slotId === 'C') {
      rect.left = x - w / 2;
      rect.top = y - h / 2;
    } else if (slotId === 'R') {
      rect.left = x + r;
      rect.top = y - h / 2;
    } else if (slotId === 'BL') {
      rect.left = x - r - w;
      rect.top = y + r;
    } else if (slotId === 'B') {
      rect.left = x - w / 2;
      rect.top = y + r;
    } else if (slotId === 'BR') {
      rect.left = x + r;
      rect.top = y + r;
    }
    return rect;
  }

  function labelCenter(rect) {
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  }

  function labelTextOverlapsKind(rect, placed, kind) {
    var i;
    for (i = 0; i < placed.length; i++) {
      if (placed[i].labelKind !== kind) continue;
      if (rectsOverlap(rect, placed[i], LABEL_TEXT_PAD)) return true;
    }
    return false;
  }

  function labelTextOverlaps(rect, placed) {
    var i;
    for (i = 0; i < placed.length; i++) {
      if (rectsOverlap(rect, placed[i], LABEL_TEXT_PAD)) return true;
    }
    return false;
  }

  function entityParentDistance(rect, ox, oy) {
    var c = labelCenter(rect);
    return Math.hypot(c.x - ox, c.y - oy);
  }

  function entityObstacleHit(rect, entry, ctx) {
    var c = labelCenter(rect);
    var i;
    for (i = 0; i < ctx.obstacles.length; i++) {
      var obs = ctx.obstacles[i];
      if (obs.nodeId === entry.nodeId) continue;
      if (circleRectOverlap(obs, rect)) return true;
      if (Math.hypot(c.x - obs.x, c.y - obs.y) < obs.radius + 4) return true;
    }
    return false;
  }

  function ownObjectRadius(entry, ctx, profileRadius) {
    var i;
    for (i = 0; i < ctx.obstacles.length; i++) {
      if (ctx.obstacles[i].nodeId === entry.nodeId) return ctx.obstacles[i].radius;
    }
    return profileRadius;
  }

  function entityInsideOwnObject(rect, entry, objRadius) {
    if (circleRectOverlap({ x: entry.x, y: entry.y, radius: objRadius }, rect)) return true;
    var c = labelCenter(rect);
    return Math.hypot(c.x - entry.x, c.y - entry.y) < objRadius + 2;
  }

  function entityEdgeGap(rect, entry, objRadius) {
    var cx = Math.max(rect.left, Math.min(entry.x, rect.left + rect.width));
    var cy = Math.max(rect.top, Math.min(entry.y, rect.top + rect.height));
    return Math.hypot(entry.x - cx, entry.y - cy) - objRadius;
  }

  function buildToolSlotCandidates(entry, size, objRadius) {
    var profile = profileForEntry(entry);
    var slots = slotsForProfile(profile);
    var gaps = [4, 3, 5, 2, 6];
    var rects = [];
    var g;
    var s;
    for (g = 0; g < gaps.length; g++) {
      for (s = 0; s < slots.length; s++) {
        rects.push(buildSlotRect(entry.x, entry.y, size, slots[s], objRadius, gaps[g]));
      }
    }
    return rects;
  }

  function entitySlotValid(rect, entry, ctx, objRadius) {
    var edgeGap = entityEdgeGap(rect, entry, objRadius);
    if (edgeGap < TOOL_LABEL_EDGE_GAP_MIN - 0.5 || edgeGap > TOOL_LABEL_EDGE_GAP_MAX + 1) {
      return false;
    }
    if (entityInsideOwnObject(rect, entry, objRadius)) return false;
    if (labelTextOverlapsKind(rect, ctx.placed, 'tool')) return false;
    if (entityObstacleHit(rect, entry, ctx)) return false;
    return true;
  }

  function scoreEntitySlot(rect, entry, ctx, objRadius) {
    var score = 1000;
    if (entityInsideOwnObject(rect, entry, objRadius)) return -Infinity;
    var edgeGap = entityEdgeGap(rect, entry, objRadius);
    score -= Math.abs(edgeGap - TOOL_LABEL_EDGE_GAP) * 18;
    if (edgeGap < TOOL_LABEL_EDGE_GAP_MIN || edgeGap > TOOL_LABEL_EDGE_GAP_MAX) score -= 350;
    if (rect.slot === 'T' || rect.slot === 'TL' || rect.slot === 'TR') score += 35;
    if (rect.slot === 'L' || rect.slot === 'R') score += 20;
    var i;
    for (i = 0; i < ctx.placed.length; i++) {
      if (ctx.placed[i].labelKind !== 'tool') continue;
      if (rectsOverlap(rect, ctx.placed[i], LABEL_TEXT_PAD)) score -= 800;
      else if (rectsOverlap(rect, ctx.placed[i], 4)) score -= 200;
    }
    for (i = 0; i < ctx.obstacles.length; i++) {
      var obs = ctx.obstacles[i];
      if (obs.nodeId === entry.nodeId) continue;
      if (circleRectOverlap(obs, rect)) score -= 400;
    }
    return score;
  }

  function buildEntityFallbackRect(entry, size, radius, objRadius) {
    return buildSlotRect(entry.x, entry.y, size, 'T', objRadius, TOOL_LABEL_EDGE_GAP);
  }

  function pickEntitySlot(entry, size, ctx) {
    var profile = profileForEntry(entry);
    var radius = radiusForProfile(profile);
    var objRadius = ownObjectRadius(entry, ctx, radius);
    var candidates = buildToolSlotCandidates(entry, size, objRadius);
    var best = null;
    var bestScore = -Infinity;
    var c;

    for (c = 0; c < candidates.length; c++) {
      if (entitySlotValid(candidates[c], entry, ctx, objRadius)) return candidates[c];
    }

    for (c = 0; c < candidates.length; c++) {
      var score = scoreEntitySlot(candidates[c], entry, ctx, objRadius);
      if (score > bestScore) {
        bestScore = score;
        best = candidates[c];
      }
    }
    if (best) return best;
    return buildEntityFallbackRect(entry, size, radius, objRadius);
  }

  function cableLabelRect(x, y, size, angleDeg, alongOffset, normalOffset) {
    var rad = angleDeg * (Math.PI / 180);
    var tx = Math.cos(rad);
    var ty = Math.sin(rad);
    var nx = -Math.sin(rad);
    var ny = Math.cos(rad);
    var cx = x + tx * (alongOffset || 0) + nx * (normalOffset || 0);
    var cy = y + ty * (alongOffset || 0) + ny * (normalOffset || 0);
    return {
      left: cx - size.width / 2,
      top: cy - size.height / 2,
      width: size.width,
      height: size.height,
      anchorX: cx,
      anchorY: cy,
      angle: angleDeg,
    };
  }

  function buildCableLayoutCandidates(entry, size, layoutZoom) {
    var laneIndex = entry.laneIndex || 0;
    var laneTotal = Math.max(1, entry.laneTotal || 1);
    var factor = getCableLabelOffsetFactor(layoutZoom != null ? layoutZoom : CABLE_BASE_LAYOUT_ZOOM);
    var alongStep = size.width + CABLE_ALONG_GAP;
    /* Scale only perpendicular standoff from cable/object; keep along + row gaps fixed. */
    var baseNormal = (isFinite(entry.laneOffsetPx) ? entry.laneOffsetPx : 0) * factor;
    var candidates = [];
    var row;
    var col;
    var itemsInRow;
    var baseAlong;
    var rowNormal;
    var nudge;

    for (row = 0; row < CABLE_MAX_ROWS; row++) {
      itemsInRow = Math.min(CABLE_LABELS_PER_ROW, laneTotal - row * CABLE_LABELS_PER_ROW);
      if (itemsInRow <= 0) break;
      col = laneIndex - row * CABLE_LABELS_PER_ROW;
      if (col < 0 || col >= itemsInRow) continue;
      baseAlong = (col - (itemsInRow - 1) / 2) * alongStep;
      rowNormal = baseNormal + row * (size.height + CABLE_ROW_GAP);

      candidates.push({ along: baseAlong, normal: rowNormal, row: row, tier: row === 0 ? 1 : row + 1 });
      candidates.push({ along: baseAlong - alongStep * 0.35, normal: rowNormal, row: row, tier: row === 0 ? 1 : row + 1 });
      candidates.push({ along: baseAlong + alongStep * 0.35, normal: rowNormal, row: row, tier: row === 0 ? 1 : row + 1 });

      for (nudge = 0; nudge < CABLE_OFFSET_PATTERN.length; nudge++) {
        candidates.push({
          along: baseAlong,
          normal: rowNormal + CABLE_OFFSET_PATTERN[nudge] * factor,
          row: row,
          tier: row + 2,
        });
      }
    }
    return candidates;
  }

  function anchorDistance(rect, anchorX, anchorY) {
    return Math.hypot((rect.anchorX || 0) - anchorX, (rect.anchorY || 0) - anchorY);
  }

  function labelToPolylineDist(rect, points) {
    if (!points || points.length < 2) return 0;
    var cx = rect.left + rect.width / 2;
    var cy = rect.top + rect.height / 2;
    var min = Infinity;
    var i;
    for (i = 0; i < points.length - 1; i++) {
      var d = pointSegDist(cx, cy, {
        x1: points[i][0],
        y1: points[i][1],
        x2: points[i + 1][0],
        y2: points[i + 1][1],
      });
      if (d < min) min = d;
    }
    return min;
  }

  function cableMaxPathDist(row, size, layoutZoom) {
    var factor = getCableLabelOffsetFactor(layoutZoom != null ? layoutZoom : CABLE_BASE_LAYOUT_ZOOM);
    var base = CABLE_MAX_ANCHOR_DIST * factor;
    if (!row) return base;
    return base + row * (size.height + CABLE_ROW_GAP);
  }

  function cableSlotValid(rect, ctx, anchorX, anchorY, points, row, size, layoutZoom) {
    var maxDist = cableMaxPathDist(row || 0, size, layoutZoom);
    if (points) {
      if (labelToPolylineDist(rect, points) > maxDist) return false;
    } else if (anchorDistance(rect, anchorX, anchorY) > maxDist) {
      return false;
    }
    if (labelTextOverlapsKind(rect, ctx.placed, 'tool')) return false;
    if (labelTextOverlapsKind(rect, ctx.placed, 'cable')) return false;
    var i;
    for (i = 0; i < ctx.obstacles.length; i++) {
      var obs = ctx.obstacles[i];
      if (circleRectOverlap(obs, rect)) return false;
      var cx = rect.left + rect.width / 2;
      var cy = rect.top + rect.height / 2;
      if (Math.hypot(cx - obs.x, cy - obs.y) < obs.radius + OBJECT_AVOID_PAD) return false;
    }
    return true;
  }

  function cableSlotValidAllowCableOverlap(rect, ctx, anchorX, anchorY, points, row, size, layoutZoom) {
    var maxDist = cableMaxPathDist(row || 0, size, layoutZoom);
    if (points) {
      if (labelToPolylineDist(rect, points) > maxDist) return false;
    } else if (anchorDistance(rect, anchorX, anchorY) > maxDist) {
      return false;
    }
    if (labelTextOverlapsKind(rect, ctx.placed, 'tool')) return false;
    return true;
  }

  function buildCableFallbackRect(entry, size, anchor, localAngle, layoutZoom) {
    var laneIndex = entry.laneIndex || 0;
    var laneTotal = Math.max(1, entry.laneTotal || 1);
    var factor = getCableLabelOffsetFactor(layoutZoom != null ? layoutZoom : CABLE_BASE_LAYOUT_ZOOM);
    var alongStep = size.width + CABLE_ALONG_GAP;
    var row = Math.floor(laneIndex / CABLE_LABELS_PER_ROW);
    var col = laneIndex - row * CABLE_LABELS_PER_ROW;
    var itemsInRow = Math.min(CABLE_LABELS_PER_ROW, laneTotal - row * CABLE_LABELS_PER_ROW);
    if (itemsInRow <= 0) {
      row = 0;
      col = laneIndex;
      itemsInRow = Math.min(CABLE_LABELS_PER_ROW, laneTotal);
    }
    var baseNormal = (isFinite(entry.laneOffsetPx) ? entry.laneOffsetPx : 0) * factor;
    var baseAlong = (col - (itemsInRow - 1) / 2) * alongStep;
    var rowNormal = baseNormal + row * (size.height + CABLE_ROW_GAP);
    return cableLabelRect(anchor.x, anchor.y, size, localAngle, baseAlong, rowNormal);
  }

  function assignCableLanesByHandhole(entries) {
    var nodeGroups = {};
    entries.forEach(function (entry) {
      (entry.endpointNodeIds || []).forEach(function (nodeId) {
        if (!nodeGroups[nodeId]) nodeGroups[nodeId] = [];
        if (nodeGroups[nodeId].indexOf(entry) === -1) nodeGroups[nodeId].push(entry);
      });
    });

    entries.forEach(function (entry) {
      var laneGroup = [entry];
      var anchorNodeId = entry.endpointStartNodeId || null;
      (entry.endpointNodeIds || []).forEach(function (nodeId) {
        var group = nodeGroups[nodeId];
        if (group && group.length > laneGroup.length) {
          laneGroup = group;
          anchorNodeId = nodeId;
        }
      });
      if (!anchorNodeId && entry.endpointNodeIds && entry.endpointNodeIds.length) {
        anchorNodeId = entry.endpointNodeIds[0];
      }
      laneGroup.sort(function (a, b) { return String(a.id).localeCompare(String(b.id)); });
      var laneIndex = laneGroup.indexOf(entry);
      if (laneIndex < 0) laneIndex = 0;
      entry.laneIndex = laneIndex;
      entry.laneTotal = laneGroup.length;
      entry.anchorNodeId = anchorNodeId;
      if (String(anchorNodeId) === String(entry.endpointEndNodeId)) {
        entry.anchorEnd = 'end';
      } else {
        entry.anchorEnd = 'start';
      }
      entry.normalOffset = CABLE_OFFSET_PATTERN[laneIndex % CABLE_OFFSET_PATTERN.length];
    });
  }

  /**
   * Exit direction from focused node along a cable branch.
   * Uses nearest path endpoint to the node, then the outward segment vector.
   */
  function cableExitUnitFromNode(entry, device) {
    var points = entry.points;
    if (!points || points.length < 2 || !device) {
      return { ux: 1, uy: 0, angleDeg: 0, anchorEnd: 'start', fromStart: true };
    }
    var d0 = Math.hypot(points[0][0] - device.x, points[0][1] - device.y);
    var last = points.length - 1;
    var dL = Math.hypot(points[last][0] - device.x, points[last][1] - device.y);
    var isStart = d0 <= dL;
    if (String(entry.endpointStartNodeId) === String(device.nodeId)) isStart = true;
    else if (String(entry.endpointEndNodeId) === String(device.nodeId)) isStart = false;

    var nodePt = isStart ? points[0] : points[last];
    var neighborPt = isStart ? points[1] : points[last - 1];
    var ux = neighborPt[0] - nodePt[0];
    var uy = neighborPt[1] - nodePt[1];
    var len = Math.hypot(ux, uy);
    if (!isFinite(len) || len < 0.001) {
      var angleDeg = isStart ? entry.startExitAngle : entry.endExitAngle;
      var rad = (angleDeg || 0) * (Math.PI / 180);
      return {
        ux: Math.cos(rad),
        uy: Math.sin(rad),
        angleDeg: angleDeg || 0,
        anchorEnd: isStart ? 'start' : 'end',
        fromStart: isStart,
        endpointX: nodePt[0],
        endpointY: nodePt[1],
      };
    }
    ux /= len;
    uy /= len;
    return {
      ux: ux,
      uy: uy,
      angleDeg: Math.atan2(uy, ux) * (180 / Math.PI),
      anchorEnd: isStart ? 'start' : 'end',
      fromStart: isStart,
      endpointX: nodePt[0],
      endpointY: nodePt[1],
    };
  }

  /**
   * Parametric point ON the cable polyline at distance `distPx` from the
   * node-connected endpoint. Guarantees the anchor lies on the actual path.
   */
  function pointOnCablePathFromNode(points, fromStart, distPx) {
    if (!points || points.length < 2) return null;
    var dist = Math.max(0, Number(distPx) || 0);
    var i;
    var dx;
    var dy;
    var len;
    var t;
    var acc = 0;

    if (fromStart) {
      for (i = 0; i < points.length - 1; i++) {
        dx = points[i + 1][0] - points[i][0];
        dy = points[i + 1][1] - points[i][1];
        len = Math.hypot(dx, dy);
        if (len <= 0.0001) continue;
        if (acc + len >= dist) {
          t = (dist - acc) / len;
          return {
            x: points[i][0] + t * dx,
            y: points[i][1] + t * dy,
            ux: dx / len,
            uy: dy / len,
            angleDeg: Math.atan2(dy, dx) * (180 / Math.PI),
          };
        }
        acc += len;
      }
      i = points.length - 1;
      dx = points[i][0] - points[i - 1][0];
      dy = points[i][1] - points[i - 1][1];
      len = Math.hypot(dx, dy) || 1;
      return {
        x: points[i][0],
        y: points[i][1],
        ux: dx / len,
        uy: dy / len,
        angleDeg: Math.atan2(dy, dx) * (180 / Math.PI),
      };
    }

    for (i = points.length - 1; i > 0; i--) {
      dx = points[i - 1][0] - points[i][0];
      dy = points[i - 1][1] - points[i][1];
      len = Math.hypot(dx, dy);
      if (len <= 0.0001) continue;
      if (acc + len >= dist) {
        t = (dist - acc) / len;
        return {
          x: points[i][0] + t * dx,
          y: points[i][1] + t * dy,
          ux: dx / len,
          uy: dy / len,
          angleDeg: Math.atan2(dy, dx) * (180 / Math.PI),
        };
      }
      acc += len;
    }
    dx = points[0][0] - points[1][0];
    dy = points[0][1] - points[1][1];
    len = Math.hypot(dx, dy) || 1;
    return {
      x: points[0][0],
      y: points[0][1],
      ux: dx / len,
      uy: dy / len,
      angleDeg: Math.atan2(dy, dx) * (180 / Math.PI),
    };
  }

  function cableTouchesFocusedNode(entry, device) {
    if (!entry || !device || !entry.points || entry.points.length < 2) return false;
    if (cableConnectedToDevice(entry, device.nodeId)) return true;
    return cableEndpointNearDevice(entry, device);
  }

  function pathLockDistanceForNode(device, exitUy) {
    var safety = terminalSafetyMarginForNode(device, exitUy);
    return Math.max(
      CABLE_PATH_LOCK_DIST_MIN_PX,
      Math.max(CABLE_PATH_BASE_SAFETY_PX, Math.min(CABLE_PATH_LOCK_DIST_MAX_PX, safety))
    );
  }

  /** Bucket exit angle so cables on the same branch share a stagger sequence. */
  function cableBranchBucketKey(exit) {
    var ang = Number(exit && exit.angleDeg) || 0;
    while (ang < 0) ang += 360;
    while (ang >= 360) ang -= 360;
    var bucket = Math.round(ang / CABLE_LABEL_BRANCH_BUCKET_DEG) * CABLE_LABEL_BRANCH_BUCKET_DEG;
    if (bucket === 360) bucket = 0;
    return String(bucket);
  }

  /**
   * Assign longitudinal indices within each exit-direction branch.
   * Labels array one after another along the path — no perpendicular offsets.
   */
  function assignAbLmCableStackIndices(entries, device) {
    var buckets = {};
    (entries || []).forEach(function (entry) {
      if (!entry || !entry.points || entry.points.length < 2 || !device) {
        entry.alongIndex = 0;
        entry.stackIndex = 0;
        entry.branchTotal = 1;
        entry.branchBucket = '0';
        entry.perpStackOffset = 0;
        return;
      }
      var exit = cableExitUnitFromNode(entry, device);
      var key = cableBranchBucketKey(exit);
      if (!buckets[key]) buckets[key] = [];
      buckets[key].push(entry);
    });
    Object.keys(buckets).forEach(function (key) {
      var list = buckets[key];
      var n = list.length;
      var i;
      for (i = 0; i < n; i++) {
        var entry = list[i];
        entry.alongIndex = i;
        entry.stackIndex = i;
        entry.branchTotal = n;
        entry.branchBucket = key;
        entry.perpStackOffset = 0;
      }
    });
  }

  function cableBadgeCollisionSize(size) {
    return {
      width: (size && size.width || 0) + CABLE_BADGE_PAD_X * 2,
      height: (size && size.height || 0) + CABLE_BADGE_PAD_Y * 2,
    };
  }

  function cableLabelOverlapsPlacedCables(rect, placed, pad) {
    if (!rect || !placed) return false;
    pad = pad != null ? pad : CABLE_LABEL_PEER_CLEAR_PX;
    var i;
    for (i = 0; i < placed.length; i++) {
      var p = placed[i];
      if (!p || p.labelKind !== 'cable') continue;
      if (rectsOverlap(rect, p, pad)) return true;
    }
    return false;
  }

  /**
   * Exact first segment of the cable polyline at the focused node:
   * (x1,y1) = node-end vertex ON the line, (x2,y2) = next vertex.
   */
  function cableExitSegmentFromNode(entry, device) {
    var points = entry && entry.points;
    if (!points || points.length < 2 || !device) return null;

    var d0 = Math.hypot(points[0][0] - device.x, points[0][1] - device.y);
    var last = points.length - 1;
    var dL = Math.hypot(points[last][0] - device.x, points[last][1] - device.y);
    var isStart = d0 <= dL;
    if (String(entry.endpointStartNodeId) === String(device.nodeId)) isStart = true;
    else if (String(entry.endpointEndNodeId) === String(device.nodeId)) isStart = false;

    var x1 = isStart ? points[0][0] : points[last][0];
    var y1 = isStart ? points[0][1] : points[last][1];
    var x2 = isStart ? points[1][0] : points[last - 1][0];
    var y2 = isStart ? points[1][1] : points[last - 1][1];
    var dx = x2 - x1;
    var dy = y2 - y1;
    var len = Math.hypot(dx, dy);
    if (!isFinite(len) || len < 0.001) return null;

    var cosT = dx / len;
    var sinT = dy / len;
    return {
      x1: x1,
      y1: y1,
      x2: x2,
      y2: y2,
      cos: cosT,
      sin: sinT,
      len: len,
      thetaDeg: Math.atan2(dy, dx) * (180 / Math.PI),
      thetaRad: Math.atan2(dy, dx),
      fromStart: isStart,
      anchorEnd: isStart ? 'start' : 'end',
    };
  }

  /**
   * Point ON the cable polyline at distance along from the node endpoint.
   * Prefers full-path walk so sequential labels stay glued past the first segment.
   */
  function pointAlongCableFromNode(entry, seg, distance) {
    var d = Math.max(0, Number(distance) || 0);
    var onPath = pointOnCablePathFromNode(entry.points, seg.fromStart, d);
    if (onPath) {
      return {
        x: onPath.x,
        y: onPath.y,
        thetaRad: Math.atan2(onPath.uy, onPath.ux),
        thetaDeg: Math.atan2(onPath.uy, onPath.ux) * (180 / Math.PI),
      };
    }
    /* Fallback: first-segment projection P = (x1,y1) + (cos,sin)*d */
    if (d > seg.len) d = Math.max(seg.len * 0.85, 1);
    return {
      x: seg.x1 + seg.cos * d,
      y: seg.y1 + seg.sin * d,
      thetaRad: seg.thetaRad,
      thetaDeg: seg.thetaDeg,
    };
  }

  function buildCableLabelCollisionRect(baseX, baseY, angleDeg, size) {
    var rect = cableLabelRect(baseX, baseY, size, angleDeg, 0, 0);
    rect.labelKind = 'cable';
    rect.segmentAngle = angleDeg;
    rect.baseX = baseX;
    rect.baseY = baseY;
    rect.stackOffset = 0;
    rect.anchorX = baseX;
    rect.anchorY = baseY;
    return rect;
  }

  /**
   * Strict longitudinal array on the cable path:
   *   distanceAlongLine = baseMargin + (alongIndex * tightGap)
   *   P = point on polyline at that distance (center intersects the line)
   * No perpendicular offsets / translateY / world normals.
   */
  function placeAbLmCabelTerminalLabel(entry, device, size, ctx) {
    if (!entry || !device || !entry.label) return null;
    if (!entry.points || entry.points.length < 2) return null;

    var target = resolveDeviceWorldXY(device.nodeId, device);
    if (!target) return null;
    if (!cableTouchesFocusedNode(entry, target)) return null;

    var seg = cableExitSegmentFromNode(entry, target);
    if (!seg) return null;

    entry.anchorNodeId = String(target.nodeId);
    entry.anchorEnd = seg.anchorEnd;

    var collSize = cableBadgeCollisionSize(size);
    var alongIndex = entry.alongIndex != null ? entry.alongIndex : (entry.stackIndex || 0);
    /* Longitudinal sequential spacing: distance = baseMargin + (index * tightGap) */
    var baseMargin = CABLE_PATH_BASE_SAFETY_PX;
    var alongDist = baseMargin + alongIndex * CABLE_LABEL_ALONG_GAP_PX;

    function buildAtDistance(dist) {
      var P = pointAlongCableFromNode(entry, seg, dist);
      var rect = buildCableLabelCollisionRect(P.x, P.y, P.thetaDeg, collSize);
      rect.thetaRad = P.thetaRad;
      rect.pathDist = dist;
      rect.perpOffset = 0;
      return rect;
    }

    var rect = buildAtDistance(alongDist);

    /* Peer overlap: step further ALONG the path only (stay on the line). */
    var peerSteps = 0;
    while (cableLabelOverlapsPlacedCables(rect, ctx && ctx.placed) && peerSteps < CABLE_LABEL_PEER_PUSH_MAX) {
      alongDist += CABLE_LABEL_ALONG_GAP_PX;
      rect = buildAtDistance(alongDist);
      peerSteps++;
    }

    return rect;
  }

  function pickCableSlot(entry, size, ctx) {
    if (ctx.activeZoomNode && entry.fromAbLmCabel) {
      return placeAbLmCabelTerminalLabel(entry, ctx.activeZoomNode, size, ctx);
    }
    var points = entry.points && entry.points.length >= 2 ? entry.points : null;
    if (!points) return null;

    if (ctx.activeZoomNode) {
      applyActiveZoomNodeAnchor(entry, ctx.activeZoomNode, ctx.nodeGroups);
    }

    var anchorNodeId = entry.anchorNodeId;
    var obstacles = ctx.obstacles || [];
    var obs = findObstacleByNodeId(obstacles, anchorNodeId);
    if (!obs && points.length >= 2) {
      var clearance = CABLE_ENDPOINT_SYNTHETIC_RADIUS + 8;
      var ends = [
        { pt: points[0], end: 'start' },
        { pt: points[points.length - 1], end: 'end' },
      ];
      var bestD = Infinity;
      var bestPick = null;
      var ei;
      for (ei = 0; ei < ends.length; ei++) {
        var oi;
        for (oi = 0; oi < obstacles.length; oi++) {
          var candidate = obstacles[oi];
          if (!candidate) continue;
          var d = Math.hypot(ends[ei].pt[0] - candidate.x, ends[ei].pt[1] - candidate.y);
          if (d <= clearance + (candidate.radius || 14) && d < bestD) {
            bestD = d;
            bestPick = { obs: candidate, end: ends[ei].end };
          }
        }
      }
      if (bestPick) {
        obs = bestPick.obs;
        entry.anchorNodeId = bestPick.obs.nodeId;
        entry.anchorEnd = bestPick.end;
      }
    }
    if (!obs) {
      var endPct = entry.anchorEnd === 'end' ? 1 : 0;
      obs = ownedEndpointObstacle(
        anchorNodeId,
        endPct,
        points,
        obstacles
      );
    }
    if (!obs) return null;

    var isStart = entry.anchorEnd !== 'end';
    var neighborIdx = isStart ? 1 : points.length - 2;
    var nodePt = isStart ? points[0] : points[points.length - 1];
    var neighborPt = points[neighborIdx];
    var ux = neighborPt[0] - nodePt[0];
    var uy = neighborPt[1] - nodePt[1];
    var len = Math.hypot(ux, uy);
    if (!isFinite(len) || len < 0.001) {
      var angleDeg = isStart ? entry.startExitAngle : entry.endExitAngle;
      var rad = (angleDeg || 0) * (Math.PI / 180);
      ux = Math.cos(rad);
      uy = Math.sin(rad);
      len = 1;
    } else {
      ux /= len;
      uy /= len;
    }

    var perpX = -uy;
    var perpY = ux;
    var safety = Math.max(
      CABLE_TERMINAL_SAFETY_MARGIN_PX,
      (obs.radius || CABLE_ENDPOINT_SYNTHETIC_RADIUS) + 8
    );
    var laneIndex = entry.laneIndex || 0;
    var laneTotal = Math.max(1, entry.laneTotal || 1);
    var laneCenter = laneIndex - (laneTotal - 1) / 2;
    var stackOffset = laneCenter * CABLE_TERMINAL_STACK_GAP_PX;

    var cx = obs.x + ux * safety + perpX * stackOffset;
    var cy = obs.y + uy * safety + perpY * stackOffset;
    var mapRotation = ctx.mapRotation || 0;
    var angle = readableCableAngle(Math.atan2(uy, ux) * (180 / Math.PI), mapRotation);

    var rect = cableLabelRect(cx, cy, size, angle, 0, 0);
    rect.labelKind = 'cable';

    if (circleRectOverlap(obs, rect)) {
      var bump = safety + size.height * 0.35;
      cx = obs.x + ux * bump + perpX * stackOffset;
      cy = obs.y + uy * bump + perpY * stackOffset;
      rect = cableLabelRect(cx, cy, size, angle, 0, 0);
      rect.labelKind = 'cable';
    }

    return rect;
  }

  function buildEntityLabelHtml(entry, rect, color, fontSize, mapRotation) {
    /* FAT pole label lives inside .fat-rigid-marker — never overlay counter-rotate */
    if (entry && (entry.role === 'fat-system' || entry.key === 'unified')) {
      if (entry.type === 'fat_handhole') return '';
    }
    var cx = Math.round(rect.left + rect.width / 2);
    var cy = Math.round(rect.top + rect.height / 2);
    /* Overlay host rotates with the map — counter-rotate TEXT only so labels stay upright. */
    var angle = -(Number(mapRotation) || 0);
    return '<span class="ftth-entity-label ftth-entity-label--entity" data-label-id="' +
      escapeAttr(entry.id) + '" style="left:' + cx + 'px;top:' + cy +
      'px;color:' + color + ';font-size:' + fontSize + 'px;font-weight:400;' +
      'transform:translate(-50%,-50%) rotate(' + angle + 'deg);">' +
      escapeHtml(entry.label) + '</span>';
  }

  function buildCableLabelHtml(entry, rect, color, fontSize, lod) {
    var Px = Math.round(rect.baseX != null ? rect.baseX : rect.anchorX);
    var Py = Math.round(rect.baseY != null ? rect.baseY : rect.anchorY);
    var thetaRad = rect.thetaRad;
    if (thetaRad == null) {
      var deg = rect.segmentAngle != null ? rect.segmentAngle : (rect.angle || 0);
      thetaRad = deg * (Math.PI / 180);
    }
    /*
     * Center of text sits on P (on the cable line).
     * left/top = P; translate(-50%,-50%) centers; rotate parallel to segment.
     * NO perpendicular offsets - labels stay on the line.
     */
    return '<span class="ftth-entity-label ftth-entity-label--cable ftth-entity-label--cable-badge" data-label-id="' +
      escapeAttr(entry.id) + '" data-anchor-node="' + escapeAttr(entry.anchorNodeId || '') +
      '" data-ab-lm-cabel="1" style="left:' + Px + 'px;top:' + Py +
      'px;color:#FFFFFF;font-size:' + (fontSize * cableLod.fontScale) + 'px;font-weight:400;opacity:1;' +
      'transform-origin:center center;' +
      'transform:translate(-50%,-50%) rotate(' + thetaRad + 'rad);">' +
      escapeHtml(entry.label) + '</span>';
  }

  function buildCableFocusLabelHtml(entry, x, y, color, fontSize, angleDeg) {
    var ax = Math.round(x);
    var ay = Math.round(y);
    return '<span class="ftth-entity-label ftth-entity-label--cable ftth-entity-label--cable-focus" data-label-id="' +
      escapeAttr(entry.id) + '" data-focus-label="1" style="left:' + ax + 'px;top:' + ay +
      'px;color:' + color + ';font-size:' + fontSize + 'px;font-weight:400;' +
      'transform:translate(-50%,-50%) rotate(' + (angleDeg || 0) + 'deg);">' +
      escapeHtml(entry.label) + '</span>';
  }

  function entityRolePriority(entry) {
    if (entry.type === 'fdt' || entry.role === 'fdt') return 0;
    if (entry.role === 'closure') return 1;
    if (entry.role === 'handhole' || entry.role === 'fat-handhole') return 2;
    if (entry.role === 'fat-system') return 3;
    if (entry.role === 'splitter') return 4;
    if (entry.type === 'olt' || entry.role === 'olt') return 5;
    return 6;
  }

  function setOverlayLabelsVisible(visible) {
    var root = document.documentElement;
    if (visible) root.classList.add('ftth-overlay-labels-visible');
    else root.classList.remove('ftth-overlay-labels-visible');
  }

  function setToolLabelsZoomSuppressed(suppressed) {
    var root = document.documentElement;
    if (suppressed) root.classList.add('ftth-tool-labels-zoom-hidden');
    else root.classList.remove('ftth-tool-labels-zoom-hidden');
  }

  function renderLabels() {
    renderScheduled = false;
    var overlay = ensureOverlay();
    if (!overlay) return;

    var entityEntries = (api?.getEntityLabelEntries?.() || []).slice();
    var labelColor = api?.getLabelColor?.() || '#ffffff';
    var fontSize = api?.getLabelFontSize?.() || 11;
    var zoom = getZoomFactor();
    var showTools = shouldShowToolLabels();
    var showCables = shouldShowCableLabels();
    var cableLod = getCableLabelLod(zoom);
    var obstacles = api?.getLabelObjectObstacles?.() || [];
    var viewportState = api?.getViewportState?.() || {};
    var focusVs = {
      zoom: viewportState.zoom != null ? viewportState.zoom : zoom,
      panX: viewportState.panX || 0,
      panY: viewportState.panY || 0,
    };
    var deviceIndex = buildFocusDeviceIndex(obstacles, entityEntries);
    var activeZoomNode = getActiveZoomNodeForLabels(deviceIndex, focusVs);

    /* AB_LM_Cabel 1:1 — skip entirely when node has no connected cables (no phantom labels). */
    var cableEntries = [];
    var hasAbLmCables = false;
    if (showCables && cableLod.show && activeZoomNode && activeZoomNode.nodeId != null) {
      cableEntries = (api?.getAbLmCabelLabelEntriesForNode?.(activeZoomNode.nodeId) || []).slice();
      hasAbLmCables = cableEntries.length > 0;
      if (!hasAbLmCables) {
        cableEntries = [];
      }
    }

    var signature = renderSignature(
      zoom, entityEntries.length, cableEntries.length, labelColor, fontSize,
      showTools, showCables,
      hasAbLmCables && activeZoomNode ? activeZoomNode.nodeId : ''
    );

    if (signature === lastRenderSignature && overlay.childElementCount > 0) return;
    lastRenderSignature = signature;

    overlay.style.display = 'block';
    setOverlayLabelsVisible(showTools);
    setToolLabelsZoomSuppressed(!showTools);

    var cableSegments = api?.getCablePathSegments?.() || [];
    var mapRotation = viewportState.rotation || 0;
    var placed = [];
    var html = '';
    var ctx = {
      placed: placed,
      obstacles: obstacles,
      cableSegments: cableSegments,
      mapRotation: mapRotation,
      zoom: zoom,
      activeZoomNode: activeZoomNode,
      nodeGroups: null,
    };

    entityEntries.sort(function (a, b) {
      var pa = entityRolePriority(a);
      var pb = entityRolePriority(b);
      if (pa !== pb) return pa - pb;
      if (a.y !== b.y) return a.y - b.y;
      return a.x - b.x;
    });

    if (showTools) {
      entityEntries.forEach(function (entry) {
        /* Skip FAT rigid-marker labels — DOM .pole-label inherits map via parent only */
        if (entry.type === 'fat_handhole' && (entry.key === 'unified' || entry.role === 'fat-system')) {
          return;
        }
        /*
         * Defense: when a FAT pole is mounted, never paint FH# (or any handhole overlay)
         * — pole DOM label is the sole identity.
         */
        if (entry.type === 'fat_handhole') {
          var world = api?.getNodeWorldXY?.(entry.nodeId);
          if (world && world.isPole) return;
          var dev = deviceIndex[String(entry.nodeId)];
          if (dev && dev.isPole) return;
        }
        var size = measureLabel(entry.label, fontSize);
        var rect = pickEntitySlot(entry, size, ctx);
        rect.labelKind = 'tool';
        rect.nodeId = entry.nodeId;
        placed.push(rect);
        html += buildEntityLabelHtml(entry, rect, labelColor, fontSize, mapRotation);
      });
    }

    if (showCables && cableLod.show && hasAbLmCables && activeZoomNode && cableEntries.length) {
      cableEntries.sort(function (a, b) {
        var la = a.laneIndex || 0;
        var lb = b.laneIndex || 0;
        if (la !== lb) return la - lb;
        return String(a.id).localeCompare(String(b.id));
      });
      assignAbLmCableStackIndices(cableEntries, activeZoomNode);

      var cableFontSize = CABLE_LABEL_BASE_FONT_SIZE_PX * cableLod.fontScale;

      cableEntries.forEach(function (entry) {
        if (!entry || !entry.label || !entry.points || entry.points.length < 2) return;
        var size = measureLabel(entry.label, cableFontSize);
        var rect = placeAbLmCabelTerminalLabel(entry, activeZoomNode, size, ctx);
        if (!rect) return;
        if (!rect.labelKind) rect.labelKind = 'cable';
        placed.push(rect);
        html += buildCableLabelHtml(entry, rect, labelColor, cableFontSize, cableLod);
      });
    }

    /* Skip DOM wipe when label markup is unchanged - prevents 1-frame flicker
       after pen vertex SVG rebuilds / redundant scheduled passes.
       Exception: empty html must always clear — otherwise stale FH## survives pole attach
       after refresh() resets lastRenderedHtml to ''. */
    if (html === lastRenderedHtml && overlay.childElementCount > 0) {
      if (html === '') {
        overlay.innerHTML = '';
        lastRenderedHtml = '';
        lastRenderSignature = signature;
        return;
      }
      lastRenderSignature = signature;
      return;
    }
    lastRenderedHtml = html;
    overlay.innerHTML = html;
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(text) {
    return escapeHtml(text).replace(/'/g, '&#39;');
  }

  function isPenDrawHoverActive() {
    if (!api?.canPenDraw?.()) return false;
    if (api.isPenPointerTrackingActive?.()) return true;
    if (api.hasActiveDrawingStroke?.()) return true;
    return false;
  }

  /** True while drafting trench/cable vertices (pen-drawing-active / active stroke). */
  function isPenDrawingSessionActive() {
    if (api?.hasActiveDrawingStroke?.()) return true;
    var wrap = document.getElementById('canvas-wrapper');
    if (wrap && wrap.classList.contains('pen-drawing-active')) return true;
    return false;
  }

  function isMapViewportNavigating() {
    return !!(api?.isMapViewportNavigating?.());
  }

  function shouldDeferRefreshForDrawingNav(opts) {
    if (opts?.force) return false;
    return !!(api?.canPenDraw?.() && isMapViewportNavigating());
  }

  function isTransientDrawingOverlayNode(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.closest && el.closest('#drawing-overlay-top')) return true;
    if (el.id && DRAWING_OVERLAY_ROOT_IDS[el.id]) return true;
    if (el.classList) {
      if (el.classList.contains('pen-rubber-band') ||
          el.classList.contains('qfield-crosshair') ||
          el.classList.contains('draw-path--draft-live') ||
          el.classList.contains('vertex-ghost-line')) {
        return true;
      }
    }
    return false;
  }

  function isStructuralDrawingPathNode(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.classList &&
        (el.classList.contains('draw-path-visible') ||
         el.classList.contains('draw-path-hit') ||
         el.classList.contains('draw-path-editable'))) {
      return true;
    }
    if (el.querySelector &&
        el.querySelector('.draw-path-visible, .draw-path-hit, .draw-path-editable')) {
      return true;
    }
    return false;
  }

  function nodeListHasStructuralDrawingPath(list) {
    if (!list || !list.length) return false;
    for (var i = 0; i < list.length; i++) {
      var node = list[i];
      if (node.nodeType !== 1) continue;
      if (isStructuralDrawingPathNode(node)) return true;
    }
    return false;
  }

  /**
   * Ignore drawing-layer MutationObserver noise while pen drafting:
   * vertex placement wipes/rebuilds #global-drawing-layer but does not
   * change entity label content (FH##). Suppress scheduleRender so we
   * do not clear lastRenderSignature or recreate overlay DOM.
   */
  function shouldIgnoreDrawingLayerMutations(mutations) {
    if (isPenDrawingSessionActive()) return true;
    if (!isPenDrawHoverActive() || !mutations || !mutations.length) return false;
    for (var i = 0; i < mutations.length; i++) {
      var m = mutations[i];
      if (m.type === 'attributes') {
        if (!isTransientDrawingOverlayNode(m.target)) return false;
        continue;
      }
      if (m.type === 'childList') {
        if (nodeListHasStructuralDrawingPath(m.addedNodes)) return false;
        if (nodeListHasStructuralDrawingPath(m.removedNodes)) return false;
        if (m.target && m.target.id === 'global-drawing-layer' &&
            (m.addedNodes.length > 2 || m.removedNodes.length > 2)) {
          return false;
        }
        var j;
        for (j = 0; j < m.addedNodes.length; j++) {
          var added = m.addedNodes[j];
          if (added.nodeType !== 1) continue;
          if (!isTransientDrawingOverlayNode(added) && !isStructuralDrawingPathNode(added)) {
            return false;
          }
        }
        for (j = 0; j < m.removedNodes.length; j++) {
          var removed = m.removedNodes[j];
          if (removed.nodeType !== 1) continue;
          if (!isTransientDrawingOverlayNode(removed) && !isStructuralDrawingPathNode(removed)) {
            return false;
          }
        }
      }
    }
    return true;
  }

  function scheduleRender(opts) {
    opts = opts || {};
    if (shouldDeferRefreshForDrawingNav(opts)) {
      deferredViewportRefresh = true;
      return;
    }
    /* Only invalidate signature on forced/invalidating passes - not every schedule. */
    if (opts.force || opts.invalidate) lastRenderSignature = '';
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(renderLabels);
  }

  function scheduleRenderFromDrawingLayer(mutations) {
    if (shouldIgnoreDrawingLayerMutations(mutations)) return;
    scheduleRender();
  }

  function flushDeferredRefresh() {
    if (!deferredViewportRefresh) return;
    if (isMapViewportNavigating()) return;
    deferredViewportRefresh = false;
    refresh({ force: true });
  }

  function bindRefreshHooks() {
    if (typeof MutationObserver !== 'function') return;
    if (!api.gridObserverBound) {
      api.gridObserverBound = true;
      var gridObserver = new MutationObserver(function () { scheduleRender({ force: true }); });
      var grid = document.getElementById('city-grid');
      if (grid) gridObserver.observe(grid, { childList: true, subtree: true, attributes: true });
      var svg = document.getElementById('global-drawing-layer');
      if (svg) {
        var svgObserver = new MutationObserver(function (mutations) {
          scheduleRenderFromDrawingLayer(mutations);
        });
        svgObserver.observe(svg, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['d', 'points', 'x', 'y', 'cx', 'cy', 'x1', 'y1', 'x2', 'y2', 'transform'],
        });
      }
    }
    global.addEventListener('resize', function () { scheduleRender({ force: true }); }, { passive: true });
  }

  function init(deps) {
    api = deps || {};
    ensureStyles();
    ensureOverlay();
    bindRefreshHooks();
    scheduleRender();
  }

  function refresh(opts) {
    opts = opts || {};
    if (shouldDeferRefreshForDrawingNav(opts)) {
      deferredViewportRefresh = true;
      return;
    }
    deferredViewportRefresh = false;
    ensureStyles();
    lastRenderSignature = '';
    lastRenderedHtml = '';
    renderScheduled = false;
    renderLabels();
  }

  global.FTTHLabelManager = {
    init: init,
    refresh: refresh,
    flushDeferredRefresh: flushDeferredRefresh,
    shouldShowToolLabels: shouldShowToolLabels,
    shouldShowCableLabels: shouldShowCableLabels,
    getCableLabelOffsetFactor: getCableLabelOffsetFactor,
    getCableLabelLod: getCableLabelLod,
    pointAtPathPercentage: pointAtPathPercentage,
    getActiveZoomNodeForLabels: getActiveZoomNodeForLabels,
    getNearestDeviceToViewportCenter: getNearestDeviceToViewportCenter,
    shouldShowCableFocusMode: shouldShowCableFocusMode,
    getFocusedDeviceForViewport: getFocusedDeviceForViewport,
    CABLE_FOCUS_ZOOM_MIN: CABLE_FOCUS_ZOOM_MIN,
    ZOOM_CABLE_LABELS_MIN: DEFAULT_CABLE_LABEL_ZOOM_MIN,
    MIN_ZOOM_TO_SHOW: 0,
  };
})(typeof window !== 'undefined' ? window : globalThis);
