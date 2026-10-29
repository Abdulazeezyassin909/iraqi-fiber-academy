/**
 * Fusion Splicer Lab — draggable native DOM machine (shared document with pigtails).
 * Drop from toolbox onto the grid; drag via top handle; fibers use native z-index stack.
 */
(function (global) {
  'use strict';

  var TOOL_ID = 'fusion-splicer-machine';
  var HISTORY_MAX = 40;
  var DRAG_THRESHOLD_PX = 3;

  /** Native artboard size (matches #machineBody in fusion-splicer-machine.html). */
  var MACHINE_NAT_W = 720;
  var MACHINE_NAT_H = 820;
  /** Must match `.lab-fusion-machine { transform: scale(...) }` in ftth-lab.css */
  var MACHINE_VISUAL_SCALE = 0.32;
  var MACHINE_LOCAL_CX = MACHINE_NAT_W / 2;
  var MACHINE_LOCAL_CY = MACHINE_NAT_H / 2;
  /** Magnetic snap — expanded client px padding around `.clamp-base-groove`. */
  var GROOVE_HIT_PAD_CLIENT_X = 32;
  var GROOVE_HIT_PAD_CLIENT_Y = 28;
  /** Magnetic snap — expanded client px padding around `.fsm-heat-oven-channel`. */
  var OVEN_HIT_PAD_CLIENT_X = 28;
  var OVEN_HIT_PAD_CLIENT_Y = 22;
  /** Bare glass past inner groove lip toward fusion electrodes (world px). */
  var GROOVE_BARE_PROTRUDE_WORLD = 14;
  /** Must match `.clamp-assembly { transition: transform 1.5s ... }` in fusion-splicer-machine.css */
  var MOTOR_ALIGN_TRANSITION_MS = 1500;
  var DEFAULT_CLAMP_TRAVEL_PX = 40;
  var FALLBACK_ALIGN_TRAVEL_PX = 95;
  /** Cleaved bare-glass length (world px) — must match ftth-lab-pigtail DEFAULT_CLEAVED_GLASS_LENGTH_PX. */
  var DEFAULT_CLEAVED_GLASS_LENGTH_PX = 16;
  var MOTOR_ALIGN_CALIB_LOCAL_PX = 20;

  function getClampForwardLimitPx() {
    if (global.FusionSplicerMachineUI && typeof FusionSplicerMachineUI.getClampForwardLimit === 'function') {
      return FusionSplicerMachineUI.getClampForwardLimit();
    }
    var n = global.clampForwardLimit;
    if (typeof n === 'number' && isFinite(n)) return Math.max(0, Math.round(n));
    return FALLBACK_ALIGN_TRAVEL_PX;
  }

  function getClampBackwardLimitPx() {
    if (global.FusionSplicerMachineUI && typeof FusionSplicerMachineUI.getClampBackwardLimit === 'function') {
      return FusionSplicerMachineUI.getClampBackwardLimit();
    }
    var n = global.clampBackwardLimit;
    if (typeof n === 'number' && isFinite(n)) return Math.max(0, Math.round(n));
    return 0;
  }

  function getCleavedGlassLengthPx() {
    if (global.FtthLab && typeof FtthLab.getBareGlassLengthAfterCutPx === 'function') {
      return FtthLab.getBareGlassLengthAfterCutPx();
    }
    return DEFAULT_CLEAVED_GLASS_LENGTH_PX;
  }

  function worldToClient(worldX, worldY) {
    var stage = document.getElementById('lab-canvas-2d');
    if (!stage) return { x: worldX, y: worldY };
    var rect = stage.getBoundingClientRect();
    var z = getZoom();
    var pan = global.FtthLab && typeof FtthLab.getPan2d === 'function'
      ? FtthLab.getPan2d()
      : { x: 0, y: 0 };
    return {
      x: rect.left + pan.x + worldX * z,
      y: rect.top + pan.y + worldY * z,
    };
  }

  function buildFallbackTravelPlan(reason) {
    if (reason) console.warn('Alignment:', reason);
    var d = getClampAlignmentTravelPx();
    if (!isFinite(d) || d <= 0) d = FALLBACK_ALIGN_TRAVEL_PX;
    return { leftTravelPx: d, rightTravelPx: d, fallback: true };
  }

  function getBareGlassPathEl(machineId, pigtailId) {
    if (!global.FusionSplicerMachine ||
        typeof FusionSplicerMachine.ensureFiberLayer !== 'function' ||
        !pigtailId) {
      return null;
    }
    var host = FusionSplicerMachine.ensureFiberLayer(machineId);
    if (!host) return null;
    var raw = String(pigtailId);
    var escaped = raw.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    var path = host.querySelector(
      '[data-pt-fiber-stripped="' + escaped + '"][data-pt-fiber-seg="bare"]'
    );
    if (path) return path;
    if (raw.indexOf(':') >= 0) {
      var end = raw.split(':')[1];
      return host.querySelector(
        '[data-pt-fiber-stripped="' + escaped + '"][data-pt-fiber-end="' + end + '"][data-pt-fiber-seg="bare"]'
      );
    }
    return host.querySelector(
      '[data-pt-fiber-stripped="' + escaped + '"][data-pt-fiber-seg="bare"]'
    );
  }

  function getBareGlassTipClient(machineId, pigtailId, pigtail) {
    var path = getBareGlassPathEl(machineId, pigtailId);
    if (path && typeof path.getTotalLength === 'function') {
      try {
        var pt = path.getPointAtLength(path.getTotalLength());
        var svg = path.ownerSVGElement;
        if (svg && typeof svg.createSVGPoint === 'function') {
          var sp = svg.createSVGPoint();
          sp.x = pt.x;
          sp.y = pt.y;
          var mat = path.getScreenCTM();
          if (mat) {
            var screen = sp.matrixTransform(mat);
            return { x: screen.x, y: screen.y };
          }
        }
      } catch (err) {
        console.warn('Alignment: bare glass SVG tip read failed', err);
      }
    }
    if (pigtail && isFinite(pigtail.bx)) {
      return worldToClient(pigtail.bx, pigtail.by || 0);
    }
    return null;
  }

  function getBareGlassTipClientX(machineId, pigtailId, pigtail) {
    var tip = getBareGlassTipClient(machineId, pigtailId, pigtail);
    return tip ? tip.x : null;
  }

  function getFusionChamberCenterClient(machineId) {
    var uiRoot = getMachineUiRoot(machineId);
    if (!uiRoot) return null;
    var stage = uiRoot.querySelector('.fsm-alignment-stage');
    if (!stage) return null;
    var rect = stage.getBoundingClientRect();
    if (!rect.width && !rect.height) return null;
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      element: stage,
    };
  }

  function getFusionChamberCenterWorld(machineId) {
    var center = getFusionChamberCenterClient(machineId);
    if (!center) return null;
    return clientToWorld(center.x, center.y);
  }

  /**
   * Auto Alignment — cleaved-glass equation:
   *   travelDistance = distanceToCenter(innerEdge → chamberCenter) - cleavedGlassLength
   * Converts world travel to clamp-local translateX px; does not move clamps.
   */
  function calculateAutoAlignment(machineId) {
    var plan = computeAlignmentTravelPlan(machineId);
    var cleavedGlassLength = getCleavedGlassLengthPx();
    var centerWorld = getFusionChamberCenterWorld(machineId);
    var slotL = getGrooveSlot(machineId, 'L');
    var slotR = getGrooveSlot(machineId, 'R');
    var distanceToCenterL = slotL && centerWorld ? centerWorld.x - slotL.innerEdgeX : null;
    var distanceToCenterR = slotR && centerWorld ? slotR.innerEdgeX - centerWorld.x : null;

    var result = {
      ok: !!plan && !plan.fallback,
      machineId: machineId,
      cleavedGlassLength: cleavedGlassLength,
      centerWorldX: centerWorld ? centerWorld.x : null,
      distanceToCenterL: distanceToCenterL,
      distanceToCenterR: distanceToCenterR,
      leftTravelPx: plan ? plan.leftTravelPx : null,
      rightTravelPx: plan ? plan.rightTravelPx : null,
      fallback: plan ? !!plan.fallback : true,
    };

    console.log('[Auto Alignment] calculateAutoAlignment(' + machineId + ')', {
      cleavedGlassLength: cleavedGlassLength,
      centerWorldX: result.centerWorldX,
      distanceToCenterL: distanceToCenterL,
      distanceToCenterR: distanceToCenterR,
      leftTravelPx: result.leftTravelPx,
      rightTravelPx: result.rightTravelPx,
      formula: 'travelDistance = distanceToCenter - cleavedGlassLength',
      fallback: result.fallback,
    });

    return result;
  }

  function getGrooveCenterWorldX(grooveEl) {
    if (!grooveEl) return null;
    var rect = grooveEl.getBoundingClientRect();
    if (!rect.width && !rect.height) return null;
    return clientToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2).x;
  }

  function measureAssemblyWorldDxPerLocalPx(assembly, grooveEl, deltaLocal) {
    if (!assembly || !grooveEl || !deltaLocal) return 0;
    var beforeX = getGrooveCenterWorldX(grooveEl);
    if (beforeX == null) return 0;
    var prev = assembly.style.transform;
    assembly.style.transform = 'translateX(' + deltaLocal + 'px)';
    void assembly.offsetWidth;
    var afterX = getGrooveCenterWorldX(grooveEl);
    assembly.style.transform = prev;
    void assembly.offsetWidth;
    if (afterX == null) return 0;
    return (afterX - beforeX) / deltaLocal;
  }

  /**
   * Cleaved auto-alignment travel plan:
   *   travelDistance = distanceToCenter(innerEdge → chamberCenter) - cleavedGlassLength
   * World travel is converted to clamp-local translateX via groove calibration.
   */
  function computeAlignmentTravelPlan(machineId) {
    var fallback = buildFallbackTravelPlan('using default travel');
    try {
      if (global.FtthLab && typeof FtthLab.prepareSplicerAlignmentTips === 'function') {
        FtthLab.prepareSplicerAlignmentTips(machineId);
      }

      var pair = null;
      if (global.FtthLab && typeof FtthLab.getSplicerDockedPair === 'function') {
        pair = FtthLab.getSplicerDockedPair(machineId);
      }
      if (!pair || !pair.left || !pair.right) {
        return buildFallbackTravelPlan('L/R pigtails not snapped');
      }

      var cleavedGlassLength = getCleavedGlassLengthPx();
      var centerWorld = getFusionChamberCenterWorld(machineId);
      var slotL = getGrooveSlot(machineId, 'L');
      var slotR = getGrooveSlot(machineId, 'R');
      if (!centerWorld || !slotL || !slotR) {
        return buildFallbackTravelPlan('chamber center or groove slots unavailable');
      }

      var distanceToCenterL = centerWorld.x - slotL.innerEdgeX;
      var distanceToCenterR = slotR.innerEdgeX - centerWorld.x;
      if (distanceToCenterL <= 0 || distanceToCenterR <= 0) {
        return buildFallbackTravelPlan('invalid inner-edge geometry');
      }

      var travelWorldL = distanceToCenterL - cleavedGlassLength;
      var travelWorldR = distanceToCenterR - cleavedGlassLength;

      var leftAsm = getClampAssemblyEl(machineId, 'L');
      var rightAsm = getClampAssemblyEl(machineId, 'R');
      var grooveL = leftAsm && leftAsm.querySelector('.clamp-base-groove');
      var grooveR = rightAsm && rightAsm.querySelector('.clamp-base-groove');
      if (!leftAsm || !rightAsm || !grooveL || !grooveR) {
        return buildFallbackTravelPlan('clamp assemblies not found');
      }

      var kL = measureAssemblyWorldDxPerLocalPx(leftAsm, grooveL, MOTOR_ALIGN_CALIB_LOCAL_PX);
      var kR = measureAssemblyWorldDxPerLocalPx(rightAsm, grooveR, -MOTOR_ALIGN_CALIB_LOCAL_PX);
      if (!kL || !kR) return buildFallbackTravelPlan('clamp calibration failed');

      var leftTravelPx = Math.max(0, Math.round(travelWorldL / kL));
      var rightTravelPx = Math.max(0, Math.round(travelWorldR / Math.abs(kR)));

      if (leftTravelPx <= 0 && rightTravelPx <= 0) {
        return buildFallbackTravelPlan('cleaved glass already at center or too long');
      }

      return {
        leftTravelPx: leftTravelPx,
        rightTravelPx: rightTravelPx,
        fallback: false,
        cleavedGlassLength: cleavedGlassLength,
        distanceToCenterL: distanceToCenterL,
        distanceToCenterR: distanceToCenterR,
        targetWorldX: centerWorld.x,
      };
    } catch (e) {
      console.error('Alignment Error:', e);
      return fallback;
    }
  }

  var layer = null;
  /** Per-machine RAF handles for SET motor-align pigtail sync (cancel on reset / re-trigger). */
  var motorAlignRafByMachine = {};
  var machines = [];
  var seq = 0;
  var selection = { kind: 'none', id: null };
  var selectedTool = null;
  var dragLib = null;
  var history = [];
  var historyIndex = -1;
  var historyLocked = false;
  var parentListeners = {};
  var bridges = {};
  var armedMachineId = null;
  var layerEventsBound = false;
  var outsideIsolationBound = false;
  var activeDrag = null;

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

  function dist2(ax, ay, bx, by) {
    var dx = ax - bx;
    var dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function clientRectCenterToWorld(rect) {
    if (!rect) return null;
    return clientToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  function clientRectSpanToWorld(rect) {
    if (!rect) return null;
    var cy = rect.top + rect.height / 2;
    var a = clientToWorld(rect.left, cy);
    var b = clientToWorld(rect.right, cy);
    return {
      x1: Math.min(a.x, b.x),
      x2: Math.max(a.x, b.x),
      y: (a.y + b.y) / 2,
    };
  }

  function clientRectToWorldBox(rect) {
    if (!rect) return null;
    var tl = clientToWorld(rect.left, rect.top);
    var br = clientToWorld(rect.right, rect.bottom);
    return {
      x1: Math.min(tl.x, br.x),
      y1: Math.min(tl.y, br.y),
      x2: Math.max(tl.x, br.x),
      y2: Math.max(tl.y, br.y),
    };
  }

  function queryGrooveElements(uiRoot, side) {
    if (!uiRoot || (side !== 'L' && side !== 'R')) return null;
    var suffix = side === 'L' ? 'l' : 'r';
    return {
      assembly: uiRoot.querySelector('.fsm-clamp-assembly-' + suffix),
      groove: uiRoot.querySelector('.fsm-clamp-assembly-' + suffix + ' .clamp-base-groove'),
      entry: uiRoot.querySelector(side === 'L' ? '.fsm-fiber-entry-left' : '.fsm-fiber-entry-right'),
      lid: uiRoot.querySelector('.fsm-clamp-lid-' + suffix),
    };
  }

  function grooveRectToWorldSlot(rect, machineId, side, opts) {
    opts = opts || {};
    if (!rect || (!rect.width && !rect.height)) return null;

    var centerClientX = rect.left + rect.width / 2;
    var centerClientY = rect.top + rect.height / 2;
    var centerWorld = clientToWorld(centerClientX, centerClientY);
    var leftWorld = clientToWorld(rect.left, centerClientY);
    var rightWorld = clientToWorld(rect.right, centerClientY);

    var grooveX1 = Math.min(leftWorld.x, rightWorld.x);
    var grooveX2 = Math.max(leftWorld.x, rightWorld.x);
    var grooveY = centerWorld.y;
    var centerX = centerWorld.x;
    var grooveW = Math.max(4, grooveX2 - grooveX1);
    var innerEdgeX = side === 'L' ? grooveX2 : grooveX1;
    var outerEdgeX = side === 'L' ? grooveX1 : grooveX2;
    var bareProtrude = Math.max(8, Math.min(GROOVE_BARE_PROTRUDE_WORLD, grooveW * 0.28));
    var tipX = side === 'L' ? innerEdgeX + bareProtrude : innerEdgeX - bareProtrude;
    var anchorX = innerEdgeX;
    var entryX = side === 'L' ? outerEdgeX - 28 : outerEdgeX + 28;
    var entryY = grooveY;

    if (opts.entryRect) {
      var entryCenterY = opts.entryRect.top + opts.entryRect.height / 2;
      var entryCenter = clientToWorld(
        opts.entryRect.left + opts.entryRect.width / 2,
        entryCenterY
      );
      entryX = entryCenter.x;
      entryY = entryCenter.y;
    }

    return {
      machineId: machineId,
      side: side,
      open: opts.open !== false,
      lidClosed: !!opts.lidClosed,
      grooveY: grooveY,
      centerX: centerX,
      tipX: tipX,
      anchorX: anchorX,
      innerEdgeX: innerEdgeX,
      outerEdgeX: outerEdgeX,
      bareProtrude: bareProtrude,
      clampFaceX: anchorX,
      entryX: entryX,
      entryY: entryY,
      workspaceEdgeX: entryX,
      grooveX1: grooveX1,
      grooveX2: grooveX2,
      groove: { x1: grooveX1, y1: grooveY, x2: grooveX2, y2: grooveY },
      clampRect: opts.clampRect || null,
    };
  }

  function buildGrooveSlotFromElement(grooveEl) {
    if (!grooveEl || !grooveEl.classList || !grooveEl.classList.contains('clamp-base-groove')) {
      return null;
    }

    var assembly = grooveEl.closest('.fsm-clamp-assembly-l, .fsm-clamp-assembly-r');
    if (!assembly || !assembly.classList.contains('lid-open')) return null;

    var side = assembly.classList.contains('fsm-clamp-assembly-l') ? 'L' : 'R';
    var machineNode = grooveEl.closest('[data-fusion-node]');
    if (!machineNode) return null;
    var machineId = machineNode.getAttribute('data-fusion-node');
    if (!machineId) return null;

    var bridge = bridges[machineId];
    var api = bridge && bridge.api;
    if (!api || typeof api.getState !== 'function') return null;

    var state = api.getState();
    var closed = !!(state.clampsClosed && state.clampsClosed[side]);
    if (closed) return null;

    var uiRoot = machineNode.querySelector('[data-fusion-ui-root]');
    var parts = queryGrooveElements(uiRoot, side);
    var rect = grooveEl.getBoundingClientRect();
    var entryRect = parts && parts.entry ? parts.entry.getBoundingClientRect() : null;
    var assemblyBox = clientRectToWorldBox(
      parts && parts.assembly ? parts.assembly.getBoundingClientRect() : rect
    );

    return grooveRectToWorldSlot(rect, machineId, side, {
      open: true,
      lidClosed: false,
      entryRect: entryRect,
      clampRect: assemblyBox,
    });
  }

  function getGrooveSlot(machineId, side) {
    var node = getMachineNode(machineId);
    var bridge = bridges[machineId];
    var api = bridge && bridge.api;
    if (!node || !api || typeof api.getState !== 'function') return null;

    var uiRoot = node.querySelector('[data-fusion-ui-root]');
    var parts = queryGrooveElements(uiRoot, side);
    if (!parts || !parts.groove) return null;

    var state = api.getState();
    var closed = !!(state.clampsClosed && state.clampsClosed[side]);
    var rect = parts.groove.getBoundingClientRect();
    var entryRect = parts.entry ? parts.entry.getBoundingClientRect() : null;
    var assemblyBox = clientRectToWorldBox(
      parts.assembly ? parts.assembly.getBoundingClientRect() : rect
    );

    return grooveRectToWorldSlot(rect, machineId, side, {
      open: !closed,
      lidClosed: closed,
      entryRect: entryRect,
      clampRect: assemblyBox,
    });
  }

  /** Live clamp coordinates for docked-fiber tracking — ignores lid-open / magnet guards. */
  function getGrooveSlotForTracking(machineId, side) {
    return getGrooveSlot(machineId, side);
  }

  function makeGrooveHit(slot, grooveEl) {
    return {
      machineId: slot.machineId,
      side: slot.side,
      slot: slot,
      grooveEl: grooveEl,
      snapX: slot.tipX,
      grooveY: slot.grooveY,
    };
  }

  function clientInExpandedGrooveRect(clientX, clientY, rect, padX, padY) {
    if (!rect) return false;
    return (
      clientX >= rect.left - padX &&
      clientX <= rect.right + padX &&
      clientY >= rect.top - padY &&
      clientY <= rect.bottom + padY
    );
  }

  function hitTestGrooveStackAtClient(clientX, clientY) {
    var list = document.elementsFromPoint
      ? document.elementsFromPoint(clientX, clientY)
      : [];
    var i;
    for (i = 0; i < list.length; i++) {
      var grooveEl = list[i].closest && list[i].closest('.clamp-base-groove');
      if (!grooveEl) continue;
      var slot = buildGrooveSlotFromElement(grooveEl);
      if (slot && slot.open) return makeGrooveHit(slot, grooveEl);
    }
    return null;
  }

  function hitTestGrooveExpandedAtClient(clientX, clientY) {
    var padX = GROOVE_HIT_PAD_CLIENT_X;
    var padY = GROOVE_HIT_PAD_CLIENT_Y;
    var best = null;
    var bestD = Infinity;
    var i;
    for (i = 0; i < machines.length; i++) {
      var m = machines[i];
      var node = getMachineNode(m.id);
      if (!node) continue;
      var uiRoot = node.querySelector('[data-fusion-ui-root]');
      if (!uiRoot) continue;
      var sides = ['L', 'R'];
      var s;
      for (s = 0; s < sides.length; s++) {
        var side = sides[s];
        var parts = queryGrooveElements(uiRoot, side);
        if (!parts || !parts.groove || !parts.assembly) continue;
        if (!parts.assembly.classList.contains('lid-open')) continue;
        var slot = getGrooveSlot(m.id, side);
        if (!slot || !slot.open) continue;
        var rect = parts.groove.getBoundingClientRect();
        if (!clientInExpandedGrooveRect(clientX, clientY, rect, padX, padY)) continue;
        var cx = rect.left + rect.width / 2;
        var cy = rect.top + rect.height / 2;
        var dx = clientX - cx;
        var dy = clientY - cy;
        var d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = makeGrooveHit(slot, parts.groove);
        }
      }
    }
    return best;
  }

  /** DOM hit-test: pointer near silver `.clamp-base-groove` (forgiving padded zone). */
  function hitTestSplicerGrooveAtClient(clientX, clientY) {
    var hit = hitTestGrooveStackAtClient(clientX, clientY);
    if (hit) return hit;
    return hitTestGrooveExpandedAtClient(clientX, clientY);
  }

  function findGrooveNearWorld(wx, wy, radiusPx) {
    var thr = typeof radiusPx === 'number' ? radiusPx : 40;
    var best = null;
    var bestD = thr + 1;
    var i;
    for (i = 0; i < machines.length; i++) {
      var m = machines[i];
      var sides = ['L', 'R'];
      var s;
      for (s = 0; s < sides.length; s++) {
        var side = sides[s];
        var slot = getGrooveSlot(m.id, side);
        if (!slot || !slot.open) continue;
        var d = dist2(wx, wy, slot.centerX, slot.grooveY);
        if (d <= thr && d < bestD) {
          bestD = d;
          best = {
            machineId: m.id,
            side: side,
            slot: slot,
            dist: d,
            snapX: slot.tipX,
            grooveY: slot.grooveY,
          };
        }
      }
    }
    return best;
  }

  function findGrooveNearClient(clientX, clientY, radiusPx) {
    var hit = hitTestSplicerGrooveAtClient(clientX, clientY);
    if (hit) return hit;
    var world = clientToWorld(clientX, clientY);
    return findGrooveNearWorld(world.x, world.y, radiusPx);
  }

  function queryOvenElements(uiRoot) {
    if (!uiRoot) return null;
    return {
      channel: uiRoot.querySelector('.fsm-heat-oven-channel'),
      slot: uiRoot.querySelector('.fsm-heat-oven-slot'),
      module: uiRoot.querySelector('.fsm-heat-oven-module'),
    };
  }

  function isOvenLidOpen(machineId) {
    return true;
  }

  function makeOvenSlotPublic(slot) {
    if (!slot) return null;
    return {
      machineId: slot.machineId,
      open: slot.open,
      centerX: slot.centerX,
      centerY: slot.centerY,
      channelX1: slot.channelX1,
      channelX2: slot.channelX2,
      channelY: slot.channelY,
    };
  }

  /**
   * Heat-oven channel geometry in world space (measured from live DOM each call).
   * Prefers `.fsm-heat-oven-channel`; falls back to `.fsm-heat-oven-slot`.
   */
  function getOvenSlot(machineId) {
    var uiRoot = getMachineUiRoot(machineId);
    if (!uiRoot) return null;
    var parts = queryOvenElements(uiRoot);
    if (!parts) return null;
    var target = parts.channel || parts.slot;
    if (!target) return null;
    var rect = target.getBoundingClientRect();
    if (!rect.width && !rect.height) return null;
    var center = clientRectCenterToWorld(rect);
    var span = clientRectSpanToWorld(rect);
    if (!center || !span) return null;
    return {
      machineId: machineId,
      open: isOvenLidOpen(machineId),
      centerX: center.x,
      centerY: center.y,
      channelX1: span.x1,
      channelX2: span.x2,
      channelY: span.y,
      clientRect: {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      },
      channelEl: parts.channel,
      slotEl: parts.slot,
    };
  }

  function clientInExpandedRect(clientX, clientY, rect, padX, padY) {
    if (!rect) return false;
    return (
      clientX >= rect.left - padX &&
      clientX <= rect.right + padX &&
      clientY >= rect.top - padY &&
      clientY <= rect.bottom + padY
    );
  }

  /**
   * Padded hit-test on the heat oven channel. Returns slot descriptor when hit.
   */
  function hitTestOvenSlotAtClient(machineId, clientX, clientY) {
    var slot = getOvenSlot(machineId);
    if (!slot) return null;
    if (!clientInExpandedRect(
      clientX,
      clientY,
      slot.clientRect,
      OVEN_HIT_PAD_CLIENT_X,
      OVEN_HIT_PAD_CLIENT_Y
    )) {
      return null;
    }
    return makeOvenSlotPublic(slot);
  }

  function highlightOvenSlot(machineId) {
    clearOvenMagnetHighlights();
    var uiRoot = getMachineUiRoot(machineId);
    if (!uiRoot) return;
    var parts = queryOvenElements(uiRoot);
    if (parts && parts.channel) {
      parts.channel.classList.add('magnet-active');
    }
  }

  function clearOvenMagnetHighlights() {
    document.querySelectorAll('.fsm-heat-oven-channel.magnet-active').forEach(function (el) {
      el.classList.remove('magnet-active');
    });
  }

  function ensureFiberLayer(machineId) {
    var mount = document.getElementById('lab-2d-mount');
    if (!mount) return null;
    var layerEl = mount.querySelector('[data-fusion-fiber-layer="' + machineId + '"]');
    if (!layerEl) {
      layerEl = document.createElement('div');
      layerEl.className = 'lab-fusion-fiber-layer';
      layerEl.setAttribute('data-fusion-fiber-layer', machineId);
      layerEl.innerHTML =
        '<svg class="lab-pigtail-svg lab-fusion-pigtail-svg" aria-hidden="true"></svg>';
      mount.appendChild(layerEl);
    }
    layerEl.removeAttribute('data-fusion-fiber-sealed');
    return layerEl;
  }

  function ensureLidLayer(machineId) {
    var mount = document.getElementById('lab-2d-mount');
    if (!mount) return null;
    var layerEl = mount.querySelector('[data-fusion-lid-layer="' + machineId + '"]');
    if (!layerEl) {
      layerEl = document.createElement('div');
      layerEl.className = 'lab-fusion-lid-layer';
      layerEl.setAttribute('data-fusion-lid-layer', machineId);
      mount.appendChild(layerEl);
    }
    return layerEl;
  }

  function removeMachineOverlays(machineId) {
    var mount = document.getElementById('lab-2d-mount');
    if (!mount) return;
    ['data-fusion-fiber-layer', 'data-fusion-lid-layer'].forEach(function (attr) {
      var el = mount.querySelector('[' + attr + '="' + machineId + '"]');
      if (el) el.remove();
    });
  }

  function syncLidOverlays(machineId) {
    var mount = document.getElementById('lab-2d-mount');
    var node = getMachineNode(machineId);
    var bridge = bridges[machineId];
    var api = bridge && bridge.api;
    if (!mount || !node || !api) return;

    var lidLayer = ensureLidLayer(machineId);
    if (!lidLayer) return;
    lidLayer.innerHTML = '';

    var uiRoot = node.querySelector('[data-fusion-ui-root]');
    var state = api.getState();
    ['L', 'R'].forEach(function (side) {
      if (!state.clampsClosed || !state.clampsClosed[side]) return;
      var parts = queryGrooveElements(uiRoot, side);
      if (!parts || !parts.lid) return;
      var lr = parts.lid.getBoundingClientRect();
      if (!lr.width && !lr.height) return;
      var box = clientRectToWorldBox(lr);
      if (!box) return;
      var proxy = document.createElement('div');
      proxy.className = 'lab-fusion-lid-proxy lab-fusion-lid-proxy--' + side.toLowerCase();
      proxy.setAttribute('data-fusion-lid-proxy', side);
      proxy.style.left = Math.round(box.x1) + 'px';
      proxy.style.top = Math.round(box.y1) + 'px';
      proxy.style.width = Math.round(box.x2 - box.x1) + 'px';
      proxy.style.height = Math.round(box.y2 - box.y1) + 'px';
      lidLayer.appendChild(proxy);
    });

    lidLayer.classList.toggle('is-machine-selected', selection.id === machineId);
    mount.appendChild(lidLayer);
  }

  function syncFiberPorts(machineId) {
    if (global.FtthLab && typeof FtthLab.renderSplicerFiberOverlays === 'function') {
      FtthLab.renderSplicerFiberOverlays(machineId);
    }
    syncLidOverlays(machineId);
  }

  function syncAllFiberPorts() {
    machines.forEach(function (m) {
      syncFiberPorts(m.id);
    });
  }

  function setSplicerDropzoneActive(machineId, side, active) {
    var node = getMachineNode(machineId);
    if (!node) return;
    var uiRoot = node.querySelector('[data-fusion-ui-root]');
    var parts = queryGrooveElements(uiRoot, side);
    if (!parts || !parts.groove) return;
    parts.groove.classList.toggle('splicer-dropzone-active', !!active);
  }

  function highlightSplicerGroove(grooveEl) {
    clearSplicerMagnetHighlights();
    if (grooveEl) grooveEl.classList.add('magnet-active');
  }

  function clearSplicerMagnetHighlights() {
    document.querySelectorAll('.clamp-base-groove.magnet-active').forEach(function (el) {
      el.classList.remove('magnet-active');
    });
  }

  function clearSplicerDropzones() {
    clearSplicerMagnetHighlights();
    document.querySelectorAll('.clamp-base-groove.splicer-dropzone-active').forEach(function (el) {
      el.classList.remove('splicer-dropzone-active');
    });
  }

  function cloneJson(v) {
    return JSON.parse(JSON.stringify(v == null ? null : v));
  }

  function findMachine(id) {
    for (var i = 0; i < machines.length; i++) {
      if (machines[i].id === id) return machines[i];
    }
    return null;
  }

  function getMachineNode(id) {
    return layer && layer.querySelector('[data-fusion-node="' + id + '"]');
  }

  function getMachineUiRoot(id) {
    var node = getMachineNode(id);
    return node ? node.querySelector('[data-fusion-ui-root]') : null;
  }

  function getClampAlignmentTravelPx() {
    var settings =
      global.FtthLab && typeof global.FtthLab.getLabSettings === 'function'
        ? global.FtthLab.getLabSettings()
        : (global.FusionSplicerSettings || global.FtthLabSettings);
    if (settings && typeof settings.getItem === 'function') {
      var item = settings.getItem('fusion-splicer-machine');
      if (item && item.specs) {
        var n = Number(
          item.specs.splicerClampTravelPx != null
            ? item.specs.splicerClampTravelPx
            : item.specs.splicer_clamp_travel
        );
        if (isFinite(n) && n >= 0) return Math.round(n);
      }
    }
    return DEFAULT_CLAMP_TRAVEL_PX;
  }

  function getClampAssemblyEl(machineId, side) {
    var uiRoot = getMachineUiRoot(machineId);
    var parts = queryGrooveElements(uiRoot, side);
    return parts && parts.assembly ? parts.assembly : null;
  }

  function cancelMotorAlignRaf(machineId) {
    var rafId = motorAlignRafByMachine[machineId];
    if (rafId == null) return;
    cancelAnimationFrame(rafId);
    delete motorAlignRafByMachine[machineId];
  }

  function syncMotorAlignPigtails(machineId) {
    if (global.FtthLab && typeof FtthLab.syncSplicerMotorAlignFrame === 'function') {
      FtthLab.syncSplicerMotorAlignFrame(machineId);
    } else if (global.FtthLab && typeof FtthLab.refreshSplicerDocks === 'function') {
      FtthLab.refreshSplicerDocks(machineId);
    }
    syncFiberPorts(machineId);
  }

  function resetMotorAlignment(machineId) {
    cancelMotorAlignRaf(machineId);
    ['L', 'R'].forEach(function (side) {
      var asm = getClampAssemblyEl(machineId, side);
      if (!asm) return;
      asm.classList.remove('is-motor-aligning');
      asm.style.transform = '';
    });
    var m = findMachine(machineId);
    if (m) m.motorAlignTravelPx = 0;
  }

  /**
   * Motor-align RAF sync only — clamps already translated (e.g. from FusionSplicerMachineUI SET).
   */
  function runMotorAlignSyncOnly(machineId, travelPlan) {
    travelPlan = travelPlan || { leftTravelPx: 0, rightTravelPx: 0, fallback: false };
    return new Promise(function (resolve) {
      try {
        cancelMotorAlignRaf(machineId);

        var m = findMachine(machineId);
        if (m) {
          m.motorAlignLeftTravelPx = travelPlan.leftTravelPx;
          m.motorAlignRightTravelPx = travelPlan.rightTravelPx;
          m.motorAlignTravelPx = Math.max(travelPlan.leftTravelPx, travelPlan.rightTravelPx);
        }

        emitParent('clampNudge', { machineId: machineId, phase: 'motorAlign' });
        syncMotorAlignPigtails(machineId);

        var start = performance.now();
        function tick(now) {
          try {
            syncMotorAlignPigtails(machineId);
          } catch (tickErr) {
            console.error('Alignment Error:', tickErr);
          }
          if (now - start < MOTOR_ALIGN_TRANSITION_MS) {
            motorAlignRafByMachine[machineId] = requestAnimationFrame(tick);
            return;
          }
          delete motorAlignRafByMachine[machineId];
          syncMotorAlignPigtails(machineId);
          emitParent('alignmentComplete', {
            machineId: machineId,
            leftTravelPx: travelPlan.leftTravelPx,
            rightTravelPx: travelPlan.rightTravelPx,
            fallback: !!travelPlan.fallback,
          });
          resolve(true);
        }
        motorAlignRafByMachine[machineId] = requestAnimationFrame(tick);
      } catch (err) {
        console.error('Alignment Error:', err);
        resolve(false);
      }
    });
  }

  /**
   * Motor alignment phase — translate L/R clamp assemblies inward, live-track docked fibers.
   * Returns a promise that resolves when the CSS transition completes.
   */
  function executeMotorAlignment(machineId, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      try {
        var leftAsm = getClampAssemblyEl(machineId, 'L');
        var rightAsm = getClampAssemblyEl(machineId, 'R');
        if (!leftAsm || !rightAsm) {
          console.warn('Alignment: clamp assemblies missing');
          resolve(false);
          return;
        }

        var travelPlan = null;
        if (typeof opts.travelPx === 'number') {
          var fixed = Math.max(0, Math.round(opts.travelPx));
          travelPlan = { leftTravelPx: fixed, rightTravelPx: fixed, fallback: false };
        } else if (typeof global.clampForwardLimit === 'number' && isFinite(global.clampForwardLimit)) {
          var adminForward = getClampForwardLimitPx();
          travelPlan = { leftTravelPx: adminForward, rightTravelPx: adminForward, fallback: false };
        } else {
          travelPlan = computeAlignmentTravelPlan(machineId);
        }
        if (!travelPlan) {
          travelPlan = buildFallbackTravelPlan('no travel plan');
        }

        cancelMotorAlignRaf(machineId);

        var m = findMachine(machineId);
        if (m) {
          m.motorAlignLeftTravelPx = travelPlan.leftTravelPx;
          m.motorAlignRightTravelPx = travelPlan.rightTravelPx;
          m.motorAlignTravelPx = Math.max(travelPlan.leftTravelPx, travelPlan.rightTravelPx);
        }

        leftAsm.classList.add('is-motor-aligning');
        rightAsm.classList.add('is-motor-aligning');
        void leftAsm.offsetWidth;
        leftAsm.style.transform = 'translateX(' + travelPlan.leftTravelPx + 'px)';
        rightAsm.style.transform = 'translateX(-' + travelPlan.rightTravelPx + 'px)';

        emitParent('clampNudge', { machineId: machineId, phase: 'motorAlign' });
        syncMotorAlignPigtails(machineId);

        var start = performance.now();
        function tick(now) {
          try {
            syncMotorAlignPigtails(machineId);
          } catch (tickErr) {
            console.error('Alignment Error:', tickErr);
          }
          if (now - start < MOTOR_ALIGN_TRANSITION_MS) {
            motorAlignRafByMachine[machineId] = requestAnimationFrame(tick);
            return;
          }
          delete motorAlignRafByMachine[machineId];
          syncMotorAlignPigtails(machineId);
          emitParent('alignmentComplete', {
            machineId: machineId,
            leftTravelPx: travelPlan.leftTravelPx,
            rightTravelPx: travelPlan.rightTravelPx,
            fallback: !!travelPlan.fallback,
          });
          resolve(true);
        }
        motorAlignRafByMachine[machineId] = requestAnimationFrame(tick);
      } catch (err) {
        console.error('Alignment Error:', err);
        resolve(false);
      }
    });
  }

  function blurMachineUi(id) {
    var b = bridges[id];
    if (b && b.api && typeof b.api.setActive === 'function') {
      b.api.setActive(false);
    }
  }

  function syncMachineDomState() {
    if (!layer) return;
    layer.querySelectorAll('[data-fusion-node]').forEach(function (node) {
      var id = node.getAttribute('data-fusion-node');
      node.classList.toggle('is-selected', selection.id === id);
      node.classList.toggle('is-armed', armedMachineId === id);
    });
    syncAllFiberPorts();
  }

  function disarmMachine(id, opts) {
    opts = opts || {};
    if (!id) return;
    if (armedMachineId === id) armedMachineId = null;
    var node = getMachineNode(id);
    if (node) node.classList.remove('is-armed');
    if (opts.blur !== false) blurMachineUi(id);
  }

  function armMachine(id) {
    if (!id || !findMachine(id)) return;
    if (armedMachineId && armedMachineId !== id) disarmMachine(armedMachineId);
    armedMachineId = id;
    var node = getMachineNode(id);
    if (node) node.classList.add('is-armed');
    var b = bridges[id];
    if (b && b.api && typeof b.api.setActive === 'function') b.api.setActive(true);
  }

  function disarmAllMachines(opts) {
    opts = opts || {};
    var ids = machines.map(function (m) { return m.id; });
    ids.forEach(function (id) {
      disarmMachine(id, { blur: opts.blur !== false });
    });
    armedMachineId = null;
    if (layer) {
      layer.querySelectorAll('.lab-fusion-machine.is-armed').forEach(function (node) {
        node.classList.remove('is-armed');
      });
    }
  }

  function isPointerOnFusionMachine(target) {
    return !!(target && target.closest && target.closest('.lab-fusion-machine'));
  }

  function bindOutsideIsolation() {
    if (outsideIsolationBound) return;
    var mount = document.getElementById('lab-2d-mount');
    var stage = document.getElementById('lab-canvas-2d');
    if (!mount && !stage) return;
    outsideIsolationBound = true;

    function onOutsidePointerDown(e) {
      if (isPointerOnFusionMachine(e.target)) return;
      if (activeDrag) {
        var draggingNode = layer &&
          layer.querySelector('[data-fusion-node="' + activeDrag + '"].is-dragging');
        if (!draggingNode) recoverStaleDragState();
        else return;
      }
      disarmAllMachines({ blur: true });
    }

    if (mount) mount.addEventListener('pointerdown', onOutsidePointerDown, true);
    if (stage) stage.addEventListener('pointerdown', onOutsidePointerDown, true);
    document.addEventListener('pointerdown', function (e) {
      if (e.target && e.target.closest && e.target.closest('.lab-rail')) {
        disarmAllMachines({ blur: true });
      }
    }, true);
  }

  function emitParent(evt, payload) {
    (parentListeners[evt] || []).forEach(function (fn) {
      try { fn(payload); } catch (err) { console.error(err); }
    });
    if (global.CustomEvent) {
      document.dispatchEvent(new CustomEvent('fusion-splicer:' + evt, { detail: payload }));
    }
  }

  function clearBridge(id) {
    var b = bridges[id];
    if (!b) return;
    (b.offs || []).forEach(function (off) {
      try { if (typeof off === 'function') off(); } catch (err) { /* ignore */ }
    });
    if (b.root && global.FusionSplicerMachineUI && typeof FusionSplicerMachineUI.destroy === 'function') {
      try { FusionSplicerMachineUI.destroy(b.root); } catch (errDestroy) { /* ignore */ }
    }
    removeMachineOverlays(id);
    delete bridges[id];
    if (selection.id === id && global.FusionSplicerUI === b.api) {
      try { delete global.FusionSplicerUI; } catch (err2) {
        global.FusionSplicerUI = null;
      }
    }
  }

  function initNativeMachine(id, uiRoot) {
    clearBridge(id);
    if (!uiRoot || !global.FusionSplicerMachineUI || typeof FusionSplicerMachineUI.mount !== 'function') {
      return;
    }

    var api = FusionSplicerMachineUI.mount(uiRoot, { machineId: id });
    if (!api) return;

    var offs = [];
    if (typeof api.on === 'function') {
      [
        'ready', 'power', 'ovenLid', 'clampSelect', 'clampNudge', 'clampConfirm',
        'clampLid', 'fiberPlaced', 'heatStart', 'heatProgress', 'heatComplete', 'alarm',
        'setPress', 'alignmentComplete', 'spliceStart', 'spliceComplete', 'button'
      ].forEach(function (evt) {
        var off = api.on(evt, function (payload) {
          emitParent(evt, Object.assign({ machineId: id }, payload || {}));
        });
        if (typeof off === 'function') offs.push(off);
      });

      api.on('spliceComplete', function (payload) {
        payload = payload || {};
        if (typeof payload.lossDb === 'number' && isFinite(payload.lossDb)) {
          var bridge = bridges[id];
          if (bridge) bridge.lastSpliceLossDb = payload.lossDb;
        }
      });

      api.on('reset', function (payload) {
        payload = payload || {};
        emitParent('reset', Object.assign({ machineId: id }, payload));

        if (payload.skipMotorTransform) {
          var backward = Math.max(0, Math.round(
            typeof payload.backward === 'number'
              ? payload.backward
              : getClampBackwardLimitPx()
          ));
          runMotorAlignSyncOnly(id, {
            leftTravelPx: backward,
            rightTravelPx: backward,
            fallback: false,
          }).then(function () {
            if (payload.deferCleanup) {
              emitParent('resetMotorComplete', { machineId: id, backward: backward });
            } else {
              resetMotorAlignment(id);
            }
          });
          return;
        }
        resetMotorAlignment(id);
      });

      api.on('setPress', function (payload) {
        payload = payload || {};
        var forward = typeof payload.forward === 'number'
          ? Math.max(0, Math.round(payload.forward))
          : getClampForwardLimitPx();
        var travelPlan = { leftTravelPx: forward, rightTravelPx: forward, fallback: false };
        var alignPromise = payload.skipMotorTransform
          ? runMotorAlignSyncOnly(id, travelPlan)
          : executeMotorAlignment(id, { travelPx: forward });
        alignPromise.then(function (ok) {
          if (!ok) {
            if (typeof api.finishAligning === 'function') api.finishAligning(false);
            return;
          }
          if (api && typeof api.runArcSpliceSequence === 'function') {
            api.runArcSpliceSequence();
          }
        }).catch(function (err) {
          console.error('Alignment Error:', err);
          if (typeof api.finishAligning === 'function') api.finishAligning(false);
        });
      });
    }

    bridges[id] = { api: api, offs: offs, root: uiRoot };
    if (selection.id === id) global.FusionSplicerUI = api;
    ensureFiberLayer(id);
    ensureLidLayer(id);
    syncFiberPorts(id);
    emitParent('ready', { machineId: id, empty: true, native: true });
  }

  function ensureLayer() {
    if (layer && layer.parentNode) return layer;
    var mount = document.getElementById('lab-2d-mount');
    if (!mount) return null;
    layer = document.createElement('div');
    layer.className = 'lab-fusion-machine-layer';
    layer.setAttribute('data-lab-fusion-machine-layer', '1');
    mount.appendChild(layer);
    bindLayerEvents(layer);
    return layer;
  }

  function machinePositionStyle(m) {
    return (
      'left:' + Math.round(m.x - MACHINE_LOCAL_CX) + 'px;' +
      'top:' + Math.round(m.y - MACHINE_LOCAL_CY) + 'px;' +
      'width:' + MACHINE_NAT_W + 'px;height:' + MACHINE_NAT_H + 'px'
    );
  }

  function machineBodyMarkup() {
    if (global.FusionSplicerMachineUI && typeof FusionSplicerMachineUI.assemblyMarkup === 'function') {
      return FusionSplicerMachineUI.assemblyMarkup();
    }
    return '<div class="fusion-splicer-machine" data-fusion-ui-root="1"></div>';
  }

  function createMachineNode(m) {
    var selected = selection.id === m.id ? ' is-selected' : '';
    var node = document.createElement('div');
    node.className = 'lab-fusion-machine' + selected;
    node.setAttribute('data-fusion-node', m.id);
    node.setAttribute('title', 'Fusion Splicer · drag to move · click to operate');
    node.style.cssText = machinePositionStyle(m);
    node.innerHTML =
      '<div class="lab-fusion-machine__body">' +
        '<div class="fusion-splicer-machine" data-fusion-ui-root="1">' +
          machineBodyMarkup() +
        '</div>' +
      '</div>' +
      '<button type="button" class="lab-fusion-machine__hit" aria-label="Fusion Splicer"></button>';
    initNativeMachine(m.id, node.querySelector('[data-fusion-ui-root]'));
    return node;
  }

  function updateMachineNode(m, node) {
    if (!node) return;
    node.style.cssText = machinePositionStyle(m);
    node.classList.toggle('is-selected', selection.id === m.id);
  }

  function rebuildLayer() {
    var host = ensureLayer();
    if (!host) return;

    var existing = {};
    host.querySelectorAll('[data-fusion-node]').forEach(function (node) {
      existing[node.getAttribute('data-fusion-node')] = node;
    });

    var frag = document.createDocumentFragment();
    machines.forEach(function (m) {
      var node = existing[m.id];
      if (node) {
        updateMachineNode(m, node);
        delete existing[m.id];
      } else {
        node = createMachineNode(m);
      }
      frag.appendChild(node);
    });

    Object.keys(existing).forEach(function (id) {
      clearBridge(id);
      existing[id].remove();
    });

    host.innerHTML = '';
    host.appendChild(frag);
    syncMachineDomState();
    syncAllFiberPorts();
  }

  function updateMachinePosition(m, node) {
    if (!node) node = layer && layer.querySelector('[data-fusion-node="' + m.id + '"]');
    if (!node) return;
    node.style.left = Math.round(m.x - MACHINE_LOCAL_CX) + 'px';
    node.style.top = Math.round(m.y - MACHINE_LOCAL_CY) + 'px';
  }

  function placeMachine(x, y) {
    seq += 1;
    var item = {
      id: 'fsm-' + seq,
      x: typeof x === 'number' ? Math.round(x) : 0,
      y: typeof y === 'number' ? Math.round(y) : 0,
    };
    machines.push(item);
    selection = { kind: 'fusion-machine', id: item.id };
    if (global.FtthLab && typeof FtthLab.setSelectionOwner === 'function') {
      FtthLab.setSelectionOwner(TOOL_ID);
    }
    rebuildLayer();
    pushHistory();
    updateInspector();
    setStatus('Fusion Splicer placed · drag to move · click to operate controls');
    emitParent('placed', { machineId: item.id, x: item.x, y: item.y });
    return item;
  }

  function removeMachine(id) {
    disarmMachine(id);
    clearBridge(id);
    if (armedMachineId === id) armedMachineId = null;
    machines = machines.filter(function (m) { return m.id !== id; });
    if (selection.id === id) selection = { kind: 'none', id: null };
    rebuildLayer();
    updateInspector();
    pushHistory();
    setStatus('Fusion Splicer removed');
    emitParent('removed', { machineId: id });
  }

  function selectMachine(id, opts) {
    selection = { kind: 'fusion-machine', id: id };
    if (global.FtthLab && typeof FtthLab.setSelectionOwner === 'function') {
      FtthLab.setSelectionOwner(TOOL_ID);
    }
    var b = bridges[id];
    if (b && b.api) global.FusionSplicerUI = b.api;
    updateInspector();
    if (!(opts && opts.skipRebuild)) syncMachineDomState();
  }

  function isClientOnMachineHit(node, clientX, clientY) {
    if (!node) return false;
    var hit = node.querySelector('.lab-fusion-machine__hit');
    if (!hit) return false;
    var r = hit.getBoundingClientRect();
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  }

  function isFusionMachineDragSuppressTarget(target) {
    if (!target || !target.closest) return false;
    return !!target.closest(
      '.fsm-power-btn, .fsm-dpad, .dpad-btn, .fsm-dpad-center, .func-btn, .xo-btn, ' +
      '.clamp-assembly, .fsm-heat-oven-channel, .fsm-heat-oven-lid, .fsm-screen-section, ' +
      '.fsm-control-panel'
    );
  }

  function recoverStaleDragState() {
    activeDrag = null;
    document.body.classList.remove('lab-fusion-machine-dragging');
    if (layer) {
      layer.querySelectorAll('.lab-fusion-machine.is-dragging').forEach(function (node) {
        node.classList.remove('is-dragging');
      });
    }
  }

  function bindDragRecoveryGuards() {
    if (global.__fsmDragRecoverBound) return;
    global.__fsmDragRecoverBound = true;
    window.addEventListener('blur', recoverStaleDragState);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') recoverStaleDragState();
    });
  }

  function bindLayerEvents(host) {
    if (layerEventsBound || !host) return;
    layerEventsBound = true;

    host.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      var node = e.target.closest && e.target.closest('[data-fusion-node]');
      if (!node) return;
      if (!isClientOnMachineHit(node, e.clientX, e.clientY)) return;
      if (isFusionMachineDragSuppressTarget(e.target)) return;
      e.preventDefault();
      e.stopPropagation();

      recoverStaleDragState();

      var id = node.getAttribute('data-fusion-node');
      var m = findMachine(id);
      if (!m) return;

      if (global.FtthLab && typeof FtthLab.setSelectionOwner === 'function') {
        FtthLab.setSelectionOwner(TOOL_ID);
      }
      selection = { kind: 'fusion-machine', id: id };
      var b = bridges[id];
      if (b && b.api) global.FusionSplicerUI = b.api;
      syncMachineDomState();

      var zoom = getZoom() || 1;
      var sx = e.clientX;
      var sy = e.clientY;
      var ox = m.x;
      var oy = m.y;
      var moved = false;
      node.classList.add('is-dragging');
      document.body.classList.add('lab-fusion-machine-dragging');
      activeDrag = id;
      var pointerId = e.pointerId;
      var hit = node.querySelector('.lab-fusion-machine__hit');
      try { if (hit) hit.setPointerCapture(pointerId); } catch (err) { /* ignore */ }

      function onMove(ev) {
        if (ev.pointerId !== pointerId) return;
        var dx = (ev.clientX - sx) / zoom;
        var dy = (ev.clientY - sy) / zoom;
        if (!moved && (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX)) {
          moved = true;
          disarmAllMachines({ blur: true });
        }
        if (moved) {
          m.x = Math.round(ox + dx);
          m.y = Math.round(oy + dy);
          updateMachinePosition(m, node);
          if (global.FtthLab && typeof FtthLab.refreshSplicerDocks === 'function') {
            FtthLab.refreshSplicerDocks(m.id);
          }
          syncLidOverlays(m.id);
        }
      }

      function onUp(ev) {
        if (ev && ev.pointerId != null && ev.pointerId !== pointerId) return;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        if (hit) {
          hit.removeEventListener('lostpointercapture', onUp);
          try { hit.releasePointerCapture(pointerId); } catch (err2) { /* ignore */ }
        }
        node.classList.remove('is-dragging');
        document.body.classList.remove('lab-fusion-machine-dragging');
        activeDrag = null;
        if (moved) {
          pushHistory();
          syncMachineDomState();
        } else {
          armMachine(id);
        }
      }

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
      if (hit) hit.addEventListener('lostpointercapture', onUp);
    }, true);
  }

  function updateInspector() {
    var card = document.getElementById('lab-inspector-card');
    var detail = document.getElementById('lab-inspector-detail');
    if (!card) return;
    if (selection.kind !== 'fusion-machine' || !selection.id) return;

    var m = findMachine(selection.id);
    if (!m) {
      selection = { kind: 'none', id: null };
      return;
    }

    card.innerHTML =
      '<h2>Fusion Splicer</h2>' +
      '<p>Industrial splice machine · clamps, heat oven, D-pad alignment.</p>';

    if (!detail) return;
    detail.hidden = false;
    detail.innerHTML =
      '<div class="lab-fusion-machine-config">' +
      '<p class="lab-inspector__label">Position</p>' +
      '<p class="lab-pcord-attach">X ' + m.x + ' · Y ' + m.y + '</p>' +
      '<p class="lab-pcord-attach">Drag to reposition · click once to operate controls.</p>' +
      '<button type="button" class="lab-eject-btn" data-remove-fusion="' + m.id +
      '">Remove Splicer</button>' +
      '</div>';

    var rm = detail.querySelector('[data-remove-fusion]');
    if (rm) {
      rm.addEventListener('click', function () {
        removeMachine(m.id);
      });
    }
  }

  function captureSnapshot() {
    return { machines: cloneJson(machines), seq: seq };
  }

  function applySnapshot(snap) {
    if (!snap) return;
    historyLocked = true;
    machines.forEach(function (m) { clearBridge(m.id); });
    machines = cloneJson(snap.machines) || [];
    seq = snap.seq || 0;
    armedMachineId = null;
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
      FtthLab.recordHistory(TOOL_ID);
    }
  }

  function undo() {
    if (historyIndex <= 0) return false;
    historyIndex -= 1;
    applySnapshot(history[historyIndex]);
    setStatus('Undo · Fusion Splicer');
    return true;
  }

  function redo() {
    if (historyIndex >= history.length - 1) return false;
    historyIndex += 1;
    applySnapshot(history[historyIndex]);
    setStatus('Redo · Fusion Splicer');
    return true;
  }

  function renderToolbox() {
    var host = global.FtthLab && typeof FtthLab.gateToolboxRender === 'function'
      ? FtthLab.gateToolboxRender('lab-machine-tree', 'fusion-splicer-machine')
      : document.getElementById('lab-machine-tree');
    if (!host) return;
    host.innerHTML =
      '<div class="lab-toolbox" role="list">' +
      '<div class="tool-item lab-tool lab-tool--fusion-machine' +
      (selectedTool === 'fusion-machine' ? ' is-selected' : '') +
      '" data-tool="fusion-machine" data-lab-tool="fusion-splicer-machine" draggable="true" ' +
      'role="listitem" tabindex="0" title="Fusion Splicer">' +
      '<span class="lab-tool__mark lab-tool__mark--fusion-machine" aria-hidden="true">FS</span>' +
      '<span class="lab-tool__copy">' +
      '<strong>Fusion Splicer</strong>' +
      '<span>Machine UI · drag to grid</span>' +
      '</span>' +
      '</div>' +
      '</div>';
    bindToolbox(host);
    if (global.FtthLab && typeof FtthLab.applyFtthLabToolboxIcons === 'function') {
      FtthLab.applyFtthLabToolboxIcons();
    }
  }

  function bindToolbox(host) {
    var btn = host.querySelector('[data-tool="fusion-machine"]');
    if (!btn) return;

    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
        FtthLab.claimToolboxTool(TOOL_ID);
      }
      selectedTool = 'fusion-machine';
      renderToolbox();
      setStatus('Fusion Splicer · drag onto workspace');
    });

    btn.addEventListener('dragstart', function (ev) {
      if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
        FtthLab.claimToolboxTool(TOOL_ID);
      }
      selectedTool = 'fusion-machine';
      dragLib = { kind: 'fusion-machine' };
      if (global.FtthLab && FtthLab.beginDrag) FtthLab.beginDrag({ kind: 'fusion-machine' });
      try {
        ev.dataTransfer.setData('text/plain', 'lab:fusion-machine');
        ev.dataTransfer.setData('text/lab-drag', 'fusion-machine');
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
      if (!el || el.dataset.fusionMachineDrop === '1') return;
      el.dataset.fusionMachineDrop = '1';

      el.addEventListener('dragover', function (ev) {
        var active = global.FtthLab && FtthLab.getActiveDrag && FtthLab.getActiveDrag();
        if (!((dragLib && dragLib.kind === 'fusion-machine') ||
            (active && active.kind === 'fusion-machine'))) {
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
        if (kind !== 'fusion-machine') return;
        ev.preventDefault();
        ev.stopPropagation();
        dragLib = null;
        if (global.FtthLab && FtthLab.endDrag) FtthLab.endDrag();
        var pt = clientToWorld(ev.clientX, ev.clientY);
        placeMachine(Math.round(pt.x), Math.round(pt.y));
        selectedTool = null;
        renderToolbox();
      });

      el.addEventListener('click', function (ev) {
        if (selectedTool !== 'fusion-machine') return;
        var active = global.FtthLab && FtthLab.getActiveToolboxTool && FtthLab.getActiveToolboxTool();
        if (active !== TOOL_ID) return;
        if (!isStagePlacementTarget(ev.target)) return;
        ev.stopPropagation();
        var pt = clientToWorld(ev.clientX, ev.clientY);
        placeMachine(Math.round(pt.x), Math.round(pt.y));
        selectedTool = null;
        renderToolbox();
      }, true);
    });
  }

  function deleteSelected() {
    if (selection.kind === 'fusion-machine' && selection.id) {
      removeMachine(selection.id);
      return true;
    }
    return false;
  }

  function clearSelection() {
    selection = { kind: 'none', id: null };
    selectedTool = null;
    disarmAllMachines({ blur: true });
    renderToolbox();
    syncMachineDomState();
  }

  function onToolboxClaim(payload) {
    var id = payload && payload.toolId;
    if (id === TOOL_ID) return;
    selectedTool = null;
    disarmAllMachines({ blur: true });
    renderToolbox();
  }

  function on(evt, fn) {
    if (!parentListeners[evt]) parentListeners[evt] = [];
    parentListeners[evt].push(fn);
    return function off() {
      parentListeners[evt] = (parentListeners[evt] || []).filter(function (f) {
        return f !== fn;
      });
    };
  }

  function getUI(machineId) {
    var id = machineId || selection.id;
    if (!id) return null;
    return (bridges[id] && bridges[id].api) || null;
  }

  function listMachines() {
    return machines.map(function (m) {
      return { id: m.id, x: m.x, y: m.y };
    });
  }

  function mount() {
    renderToolbox();
    bindStageDrop();
    bindOutsideIsolation();
    bindDragRecoveryGuards();
    ensureLayer();
    rebuildLayer();
    pushHistory();
    document.addEventListener('fusion-splicer:clampLid', function () {
      syncAllFiberPorts();
      if (global.FtthLab && typeof FtthLab.refreshSplicerDocks === 'function') {
        FtthLab.refreshSplicerDocks();
      }
    });
    document.addEventListener('fusion-splicer:clampNudge', function (ev) {
      syncAllFiberPorts();
      if (global.FtthLab && typeof FtthLab.refreshSplicerDocks === 'function') {
        FtthLab.refreshSplicerDocks(ev.detail && ev.detail.machineId);
      }
    });
    document.addEventListener('fusion-splicer:reset', function (ev) {
      var machineId = ev.detail && ev.detail.machineId;
      var detail = ev.detail || {};
      if (!machineId || detail.skipMotorTransform) return;
      resetMotorAlignment(machineId);
    });
  }

  var tool = {
    id: TOOL_ID,
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
      applySnapshot({ machines: [], seq: 0 });
    },
  };

  global.FusionSplicerMachine = {
    place: placeMachine,
    remove: removeMachine,
    list: listMachines,
    getUI: getUI,
    on: on,
    getGrooveSlot: getGrooveSlot,
    getGrooveSlotForTracking: getGrooveSlotForTracking,
    buildGrooveSlotFromElement: buildGrooveSlotFromElement,
    hitTestSplicerGrooveAtClient: hitTestSplicerGrooveAtClient,
    findGrooveNearWorld: findGrooveNearWorld,
    findGrooveNearClient: findGrooveNearClient,
    highlightSplicerGroove: highlightSplicerGroove,
    clearSplicerMagnetHighlights: clearSplicerMagnetHighlights,
    getOvenSlot: getOvenSlot,
    hitTestOvenSlotAtClient: hitTestOvenSlotAtClient,
    highlightOvenSlot: highlightOvenSlot,
    clearOvenMagnetHighlights: clearOvenMagnetHighlights,
    worldToClient: worldToClient,
    OVEN_HIT_PAD_CLIENT_X: OVEN_HIT_PAD_CLIENT_X,
    OVEN_HIT_PAD_CLIENT_Y: OVEN_HIT_PAD_CLIENT_Y,
    syncFiberPorts: syncFiberPorts,
    syncAllFiberPorts: syncAllFiberPorts,
    syncLidOverlays: syncLidOverlays,
    ensureFiberLayer: ensureFiberLayer,
    setSplicerDropzoneActive: setSplicerDropzoneActive,
    clearSplicerDropzones: clearSplicerDropzones,
    executeMotorAlignment: executeMotorAlignment,
    calculateAutoAlignment: calculateAutoAlignment,
    getCleavedGlassLengthPx: getCleavedGlassLengthPx,
    DEFAULT_CLEAVED_GLASS_LENGTH_PX: DEFAULT_CLEAVED_GLASS_LENGTH_PX,
    resetMotorAlignment: resetMotorAlignment,
    getClampAlignmentTravelPx: getClampAlignmentTravelPx,
    MOTOR_ALIGN_TRANSITION_MS: MOTOR_ALIGN_TRANSITION_MS,
    SNAP_PX: GROOVE_HIT_PAD_CLIENT_X,
    GROOVE_HIT_PAD_CLIENT_X: GROOVE_HIT_PAD_CLIENT_X,
    GROOVE_HIT_PAD_CLIENT_Y: GROOVE_HIT_PAD_CLIENT_Y,
  };

  function tryRegister() {
    if (global.FtthLab && typeof FtthLab.registerTool === 'function') {
      FtthLab.registerTool(TOOL_ID, tool);
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
