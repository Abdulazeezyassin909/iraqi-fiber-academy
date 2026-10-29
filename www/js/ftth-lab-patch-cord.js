/**
 * Patch Cord — symmetrical click-and-drag for End A and End B
 * Plugged end stays locked; free end moves only on mouse-down+hold.
 * On full connect, mid-span is a true catenary y = c + a·cosh(x/a); cable
 * length is locked (fixedLength) and preserved when relocating a connector.
 * Relocate = fixed-length tether + catenary reset on the new port span.
 * Gravity lock: mid-span sag is always +Y (down); upward bulges are mirrored.
 * Length modes: Free Draw (route/stretch) · Meter Mode (fixed m · pure catenary sag).
 */
(function (global) {
  'use strict';

  var MISMATCH_MSG =
    'Connector polish mismatch (SC/APC ↔ SC/PC): high back reflection expected. ' +
    'Connection allowed — extra insertion loss applied to the power budget.';

  var MISMATCH_PENALTY_DB = 3.0; /* APC ↔ UPC per mismatched end */
  var MATCHED_CONNECTOR_DB = 0.2; /* typical mated pair insertion */

  var ctx = null;
  var layer = null;
  var cords = [];
  var seq = 0;
  var selection = { kind: 'none', cordId: null };
  var dragLib = null;
  var selectedTool = null;
  var history = [];
  var historyIndex = -1;
  var historyLocked = false;
  var HISTORY_MAX = 60;
  var endDragState = null;
  /** Dual-state link: A locked in port, B follows mouse until snap */
  var linkSession = null; /* { cordId, freeEnd } */
  var suppressPortClickUntil = 0;
  /** Ephemeral rope sim keyed by cord id (not persisted in history) */
  var ropePhysics = {};
  var physRafId = 0;

  /** Phase 1: false = spoolWrap latch (legacy). true = contacts[] topology. */
  var USE_CONTACT_TOPOLOGY = true;
  var DEBUG_CONTACTS = false;
  var CONTACT_RELEASE_EPS = 0.08;
  var CONTACT_PITCH_PX = 2;

  function setStatus(msg) {
    if (global.FtthLab && FtthLab.setStatus) FtthLab.setStatus(msg);
  }

  function showWarning(msg) {
    if (global.FtthLab && FtthLab.showAlert) FtthLab.showAlert(msg, 'warn');
    else window.alert(msg);
  }

  function getZoom() {
    return (global.FtthLab && FtthLab.getZoom2d && FtthLab.getZoom2d()) || 1;
  }

  function getWorldSize() {
    return (global.FtthLab && FtthLab.getWorldSize && FtthLab.getWorldSize()) || 20000;
  }

  function clientToWorld(clientX, clientY) {
    if (global.FtthLab && typeof FtthLab.clientToWorld2d === 'function') {
      return FtthLab.clientToWorld2d(clientX, clientY);
    }
    return { x: 0, y: 0 };
  }

  function getPxPerMeter() {
    if (global.FtthLab && typeof FtthLab.getPxPerMeter === 'function') {
      return FtthLab.getPxPerMeter() || 160;
    }
    return 160;
  }

  function metersToPx(m) {
    if (global.FtthLab && typeof FtthLab.metersToWorldPx === 'function') {
      return FtthLab.metersToWorldPx(m);
    }
    return Number(m) * getPxPerMeter();
  }

  function pxToMeters(px) {
    if (global.FtthLab && typeof FtthLab.worldPxToMeters === 'function') {
      return FtthLab.worldPxToMeters(px);
    }
    return Number(px) / getPxPerMeter();
  }

  function isMeterMode(cord) {
    return !!(cord && cord.lengthMode === 'meter');
  }

  function normalizeLengthMeters(m) {
    var n = Math.round(Number(m) * 2) / 2;
    if (!isFinite(n) || n < 0.5) n = 0.5;
    if (n > 100) n = 100;
    return n;
  }

  function normalizeOtdrCableLengthMeters(m) {
    var n = Number(m);
    if (!isFinite(n) || n < 0) n = 0;
    if (n > 50000) n = 50000;
    return Math.round(n * 1000) / 1000;
  }

  function applyPatchCordCableLengthModel(cord, value, unit) {
    if (!cord) return 0;
    unit = unit === 'km' ? 'km' : 'm';
    var displayVal = parseFloat(value);
    if (!isFinite(displayVal) || displayVal < 0) displayVal = 0;
    cord.cableLength = displayVal;
    cord.lengthUnit = unit;
    cord.otdrLengthUnit = unit;
    cord.otdrCableLengthM = normalizeOtdrCableLengthMeters(
      cordLengthInputToMeters(displayVal, unit)
    );
    return cord.otdrCableLengthM;
  }

  function claimSelection() {
    if (global.FtthLab && typeof FtthLab.setSelectionOwner === 'function') {
      FtthLab.setSelectionOwner('patch-cord');
    }
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value == null ? null : value));
  }

  /** Internal: 'APC' | 'PC'  (PC ≈ UPC / SC-PC blue) */
  function normalizePolish(v) {
    var s = String(v || '').toUpperCase().replace(/\s+/g, '');
    if (s === 'APC' || s === 'SC/APC' || s === 'SCAPC') return 'APC';
    return 'PC';
  }

  function displayPolish(v) {
    return normalizePolish(v) === 'APC' ? 'SC/APC' : 'SC/PC';
  }

  function portPolishNorm(v) {
    var s = String(v || '').toUpperCase();
    return s === 'APC' ? 'APC' : 'PC';
  }

  function polishMatch(cordPolish, portPolish) {
    return normalizePolish(cordPolish) === portPolishNorm(portPolish);
  }

  /** VFL and OLP use 2.5 mm adapters that accept both SC/PC and SC/APC. */
  function isUniversalPortOwner(owner) {
    return owner === 'vfl' || owner === 'opm';
  }

  function isUniversalPortEl(el) {
    if (!el || !el.closest) return false;
    if (el.closest('[data-polish-universal="true"], [data-port-universal="true"]')) return true;
    if (el.closest('.protruding-port[data-port-type="vfl"]')) return true;
    return false;
  }

  function isUniversalPortHit(hit) {
    if (!hit) return false;
    if (isUniversalPortOwner(hit.owner)) return true;
    if (hit.universal) return true;
    return isUniversalPortEl(hit.el);
  }

  function isUniversalPortAttach(att) {
    if (!att) return false;
    if (isUniversalPortOwner(att.owner)) return true;
    if (att.universal) return true;
    return false;
  }

  function findCord(id) {
    for (var i = 0; i < cords.length; i++) {
      if (cords[i].id === id) return cords[i];
    }
    return null;
  }

  function endKey(end) {
    return end === 'B' ? 'sideB' : 'sideA';
  }

  function captureSnapshot() {
    return { cords: cloneJson(cords), seq: seq };
  }

  function applySnapshot(snap) {
    if (!snap) return;
    historyLocked = true;
    endLinkSession({ silent: true });
    clearAllRopePhysics();
    cords = cloneJson(snap.cords) || [];
    seq = snap.seq || 0;
    selection = { kind: 'none', cordId: null };
    endDragState = null;
    cords.forEach(function (c) {
      if (!c.lengthMode) c.lengthMode = 'free';
      if (typeof c.lengthMeters !== 'number') {
        c.lengthMeters = typeof c.fixedLength === 'number'
          ? normalizeLengthMeters(pxToMeters(c.fixedLength))
          : 3;
      }
      if (!c.spoolWrap || typeof c.spoolWrap !== 'object') c.spoolWrap = {};
      if (!c.contacts) c.contacts = [];
      if (typeof c.contactSeq !== 'number') c.contactSeq = 0;
      if (!c.bendJigId) c.bendJigId = null;
      if (!c.bendJigIgnoreId) c.bendJigIgnoreId = null;
      ['A', 'B'].forEach(function (end) {
        var side = c[endKey(end)];
        if (side && side.attached) normalizeOtdrAttachmentFields(side.attached);
      });
    });
    rebuildLayer();
    updateInspector();
    refreshBudget();
    historyLocked = false;
  }

  function pushHistory() {
    if (historyLocked) return;
    history = history.slice(0, historyIndex + 1);
    history.push(captureSnapshot());
    if (history.length > HISTORY_MAX) history.shift();
    historyIndex = history.length - 1;
    if (historyIndex > 0 && global.FtthLab && typeof FtthLab.recordHistory === 'function') {
      FtthLab.recordHistory('patch-cord');
    }
  }

  function undo() {
    if (historyIndex <= 0) return false;
    historyIndex -= 1;
    applySnapshot(history[historyIndex]);
    setStatus('Undo · patch cord');
    return true;
  }

  function redo() {
    if (historyIndex >= history.length - 1) return false;
    historyIndex += 1;
    applySnapshot(history[historyIndex]);
    setStatus('Redo · patch cord');
    return true;
  }

  function defaultPos() {
    var w = getWorldSize();
    var x = Math.round(w / 2 + 60 + cords.length * 30);
    var y = Math.round(w / 2 + 200 + (cords.length % 3) * 50);
    return { x: x, y: y };
  }

  /** Default free-spawn span (px) and face-to-face boot rotations. */
  function defaultSpawnSpanPx() {
    if (global.FtthLab && typeof FtthLab.PATCH_CORD_DEFAULT_SPAN_PX === 'number') {
      return Math.max(80, FtthLab.PATCH_CORD_DEFAULT_SPAN_PX);
    }
    return 180;
  }

  function defaultSpawnRotA() {
    if (global.FtthLab && typeof FtthLab.PATCH_CORD_DEFAULT_ROT_A === 'number') {
      return FtthLab.PATCH_CORD_DEFAULT_ROT_A;
    }
    return -90; /* boot toward +X (peer) */
  }

  function defaultSpawnRotB() {
    if (global.FtthLab && typeof FtthLab.PATCH_CORD_DEFAULT_ROT_B === 'number') {
      return FtthLab.PATCH_CORD_DEFAULT_ROT_B;
    }
    return 90; /* boot toward −X (peer) */
  }

  function defaultSpawnSagSlack() {
    if (global.FtthLab && typeof FtthLab.PATCH_CORD_DEFAULT_SAG_SLACK === 'number') {
      return Math.max(1.05, FtthLab.PATCH_CORD_DEFAULT_SAG_SLACK);
    }
    return 1.18;
  }

  /**
   * Seed mid-span samples so a fresh cord paints a natural downward catenary
   * immediately (no straight chord / empty path flash).
   */
  function seedInitialCatenaryRoute(cord) {
    if (!cord) return;
    var ends = reliefSpanEnds(cord);
    var chord = dist2(ends.a.x, ends.a.y, ends.b.x, ends.b.y) || 1;
    var slack = defaultSpawnSagSlack();
    var sag = catenarySagDepth(chord);
    var L = Math.max(
      chord * slack,
      catenaryLengthForSag(ends.a, ends.b, sag)
    );
    var full = sampleTrueCatenary(ends.a, ends.b, L, CATENARY_SAMPLES);
    cord.route = full.slice(1, -1);
    cord.pathLocked = false;
  }

  /**
   * Apply horizontal face-to-face pose: A left / B right, boots toward each
   * other (−90° / +90°), then seed a hanging catenary between the relief tips.
   */
  function applyDefaultFreeSpawnPose(cord, originX, originY) {
    var span = defaultSpawnSpanPx();
    var rotA = defaultSpawnRotA();
    var rotB = defaultSpawnRotB();
    cord.ax = originX;
    cord.ay = originY;
    cord.bx = originX + span;
    cord.by = originY;
    cord.sideA.liveRot = rotA;
    cord.sideB.liveRot = rotB;
    cord.sideA.lockedRot = null;
    cord.sideB.lockedRot = null;
    seedInitialCatenaryRoute(cord);
  }

  function placeCord(x, y) {
    seq += 1;
    var pos = (typeof x === 'number' && typeof y === 'number')
      ? { x: x, y: y }
      : defaultPos();
    var cord = {
      id: 'pc-' + seq,
      ax: pos.x,
      ay: pos.y,
      bx: pos.x,
      by: pos.y,
      sideA: { polish: 'PC', attached: null, mismatch: false, lockedRot: null, liveRot: null },
      sideB: { polish: 'PC', attached: null, mismatch: false, lockedRot: null, liveRot: null },
      route: [],
      pathLocked: false,
      fixedLength: null, /* locked mid-span length once both ends first connect */
      lengthMode: 'free', /* 'free' | 'meter' */
      lengthMeters: 3, /* Meter Mode target length (stored in meters) */
      lengthUnit: 'm', /* 'm' | 'km' — display / input unit for Cable Length */
      relocating: false, /* true while moving a plugged end to a new port */
      spoolWrap: {}, /* DEPRECATED latch — shadow when USE_CONTACT_TOPOLOGY */
      contacts: [],
      contactSeq: 0,
      bendJigId: null,
    };
    applyDefaultFreeSpawnPose(cord, pos.x, pos.y);
    cords.push(cord);
    selectCord(cord.id);
    rebuildLayer();
    pushHistory();
    refreshBudget();
    setStatus(
      'Patch cord placed · horizontal face-to-face · natural sag · ' +
      'drag a free end to route · snap into a port to lock'
    );
    return cord;
  }

  function removeCord(id) {
    if (linkSession && linkSession.cordId === id) endLinkSession({ silent: true });
    clearRopePhysics(id);
    var doomed = findCord(id);
    var oltHits = [];
    if (doomed) {
      ['A', 'B'].forEach(function (end) {
        var att = doomed[endKey(end)] && doomed[endKey(end)].attached;
        if (att && att.owner === 'olt') oltHits.push(att);
      });
    }
    cords = cords.filter(function (c) { return c.id !== id; });
    oltHits.forEach(notifyOltSfpPatch);
    if (selection.cordId === id) selection = { kind: 'none', cordId: null };
    rebuildLayer();
    updateInspector();
    pushHistory();
    refreshBudget();
    setStatus('Patch cord removed');
  }

  function setEndPolish(id, end, polish) {
    var cord = findCord(id);
    if (!cord) return;
    polish = normalizePolish(polish);
    var side = cord[endKey(end)];
    side.polish = polish;
    if (side.attached) {
      var universal = isUniversalPortAttach(side.attached);
      side.mismatch = universal
        ? false
        : !polishMatch(polish, side.attached.polish);
      side.attached.mismatch = side.mismatch;
      if (side.mismatch) showWarning(MISMATCH_MSG);
    }
    rebuildLayer();
    updateInspector();
    pushHistory();
    refreshBudget();
    setStatus('Side ' + end + ' → ' + displayPolish(polish));
  }

  function samePort(att, hit) {
    if (!att || !hit) return false;
    if (att.owner !== hit.owner) return false;
    if (att.owner === 'splitter') {
      return att.splitterId === hit.splitterId && att.port === hit.port;
    }
    if (att.owner === 'olt') {
      return att.slot === hit.slot && att.oltPort === hit.oltPort;
    }
    if (att.owner === 'coupler') {
      return att.couplerId === hit.couplerId && att.port === hit.port;
    }
    if (att.owner === 'vfl') {
      return att.vflId === hit.vflId;
    }
    if (att.owner === 'opm') {
      return att.opmId === hit.opmId;
    }
    if (att.owner === 'ols') {
      return att.olsId === hit.olsId;
    }
    return false;
  }

  function clearPortFromOthers(hit, exceptCordId, exceptEnd) {
    cords.forEach(function (c) {
      ['A', 'B'].forEach(function (end) {
        if (c.id === exceptCordId && end === exceptEnd) return;
        var side = c[endKey(end)];
        if (side.attached && samePort(side.attached, hit)) {
          side.attached = null;
          side.mismatch = false;
          side.lockedRot = null;
        }
      });
    });
  }

  function isPatchOnOltPort(slot, port) {
    slot = parseInt(slot, 10);
    port = parseInt(port, 10);
    var i;
    var c;
    var att;
    for (i = 0; i < cords.length; i++) {
      c = cords[i];
      att = c.sideA && c.sideA.attached;
      if (att && att.owner === 'olt' && att.slot === slot && att.oltPort === port) return true;
      att = c.sideB && c.sideB.attached;
      if (att && att.owner === 'olt' && att.slot === slot && att.oltPort === port) return true;
    }
    return false;
  }

  function notifyOltSfpPatch(hitOrAtt) {
    if (!hitOrAtt || hitOrAtt.owner !== 'olt') return;
    var api = global.FtthLabOltFx16;
    if (api && typeof api.syncSfpPatchState === 'function') {
      api.syncSfpPatchState(hitOrAtt.slot, hitOrAtt.oltPort);
    }
  }

  function attachEnd(cord, end, hit) {
    if (!canDockHit(hit)) {
      setStatus('Insert an SFP before docking a patch cord');
      return;
    }
    if (hit && hit.owner === 'ols') {
      hit = enrichOlsHitDeepSeat(hit) || hit;
    }
    var side = cord[endKey(end)];
    var mismatch = isUniversalPortHit(hit) ? false : !polishMatch(side.polish, hit.polish);
    clearPortFromOthers(hit, cord.id, end);
    if (hit.owner === 'vfl' && global.FtthLab && typeof FtthLab.detachPigtailsFromVfl === 'function') {
      FtthLab.detachPigtailsFromVfl(hit.vflId, null);
    }
    var otherEnd = oppositeEnd(end);
    /* Coupler faces are horizontal; OLT/splitter/VFL/OPM/OLS stay vertical (0° / 180°) */
    var lockedRot = resolveUprightPlugRotation(hit, cord, end);
    var oltSeatRot = oltPortSeatRotation(hit);
    if (hit && (hit.owner === 'vfl' || hit.owner === 'opm' || hit.owner === 'ols')) {
      lockedRot = 180;
    } else if (oltSeatRot != null) {
      /* Angled SFP tier keeps its own seat axis instead of snapping upright */
      lockedRot = oltSeatRot;
    } else if (!(hit && (hit.owner === 'coupler'))) {
      lockedRot = lockedRot === 180 || lockedRot === -180 ? 180 : 0;
    }
    side.liveRot = null;
    side.attached = {
      owner: hit.owner,
      polish: portPolishNorm(hit.polish) === 'APC' ? 'APC' : 'UPC',
      universal: isUniversalPortHit(hit),
      label: hit.label,
      splitterId: hit.splitterId || null,
      couplerId: hit.couplerId || null,
      vflId: hit.vflId || null,
      opmId: hit.opmId || null,
      olsId: hit.olsId || null,
      port: hit.port || null,
      slot: hit.slot || null,
      oltPort: hit.oltPort || null,
      wx: hit.wx,
      wy: hit.wy,
      mismatch: mismatch,
      lockedRot: lockedRot,
    };
    if (isOtdrAttachment(side.attached) || isOtdrAttachment({
      olsId: hit.olsId,
      opmId: hit.opmId,
      vflId: hit.vflId,
      label: hit.label,
    })) {
      side.attached.portId = hit.olsId || hit.opmId || hit.vflId || null;
      normalizeOtdrAttachmentFields(side.attached);
    }
    side.lockedRot = lockedRot;
    side.liveRot = null;
    side.mismatch = mismatch;
    /* Seat only this end — never move or shrink the free end */
    var freePos = getEndWorld(cord, otherEnd);
    seatEndAtPort(cord, end, hit.wx, hit.wy);
    setEndWorld(cord, otherEnd, freePos.x, freePos.y);
    if (mismatch) showWarning(MISMATCH_MSG);
    setStatus(
      'Side ' + end + ' locked · ' + displayPolish(side.polish) + ' → ' + hit.label +
      (mismatch ? ' · mismatch warning · +' + MISMATCH_PENALTY_DB + ' dB' : '')
    );
    if (global.FtthLab && typeof FtthLab.refreshVflLaser === 'function') {
      FtthLab.refreshVflLaser();
    }
    if (global.FtthLab && typeof FtthLab.refreshOpmDocks === 'function') {
      FtthLab.refreshOpmDocks();
    }
    if (global.FtthLab && typeof FtthLab.refreshOlsDocks === 'function') {
      FtthLab.refreshOlsDocks();
    }
    if (global.FtthLab && typeof FtthLab.refreshOtdrPorts === 'function') {
      FtthLab.refreshOtdrPorts();
    }
    if (global.FtthLab && typeof FtthLab.notifyLayoutChange === 'function') {
      FtthLab.notifyLayoutChange({ source: 'patch-cord', opm: true, ols: true });
    }
    notifyOltSfpPatch(hit);
  }

  function detachEnd(cord, end) {
    var side = cord[endKey(end)];
    var other = oppositeEnd(end);
    var otherAttached = !!(cord[endKey(other)] && cord[endKey(other)].attached);
    var prevAtt = side.attached;
    /* Capture span length before unlock so relocate cannot grow the cable */
    if (typeof cord.fixedLength !== 'number' && (cord.pathLocked || otherAttached)) {
      var measured = measureCableSpanLength(cord);
      if (measured > 0) cord.fixedLength = measured;
    }
    side.attached = null;
    side.mismatch = false;
    side.lockedRot = null;
    cord.pathLocked = false;
    cord.relocating = otherAttached && typeof cord.fixedLength === 'number';
    clearRopePhysics(cord.id);
    if (global.FtthLab && typeof FtthLab.refreshVflLaser === 'function') {
      FtthLab.refreshVflLaser();
    }
    if (global.FtthLab && typeof FtthLab.refreshOpmDocks === 'function') {
      FtthLab.refreshOpmDocks();
    }
    if (global.FtthLab && typeof FtthLab.refreshOlsDocks === 'function') {
      FtthLab.refreshOlsDocks();
    }
    if (global.FtthLab && typeof FtthLab.refreshOtdrPorts === 'function') {
      FtthLab.refreshOtdrPorts();
    }
    notifyOltSfpPatch(prevAtt);
  }

  function clearDrawnPath(cord) {
    if (!cord) return;
    cord.route = [];
    cord.pathLocked = false;
    cord.relocating = false;
    /* Keep fixedLength — physical cord length survives path clears / relocates */
  }

  /* ─── Hit-test equipment ports ─── */

  function hitTestPort(clientX, clientY) {
    var list = document.elementsFromPoint
      ? document.elementsFromPoint(clientX, clientY)
      : [];
    var i;
    var el;
    var node;
    var world = clientToWorld(clientX, clientY);

    for (i = 0; i < list.length; i++) {
      el = list[i];
      node = el.closest && el.closest('.lab-fx-port.is-active, .lab-fx-port.is-upc, .lab-fx-port.is-apc');
      if (!node) node = el.closest && el.closest('.lab-fx-port');
      if (node && node.classList.contains('is-active')) {
        var slot = parseInt(node.getAttribute('data-lab-slot'), 10);
        var port = parseInt(node.getAttribute('data-lab-sfp'), 10);
        var polish = node.classList.contains('is-apc') ? 'APC' : 'UPC';
        var cage = node.querySelector('.lab-fx-port__cage') || node;
        var rect = cage.getBoundingClientRect();
        var center = clientToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return {
          owner: 'olt',
          slot: slot,
          oltPort: port,
          hasSfp: true,
          polish: polish,
          label: 'LT' + (slot < 10 ? '0' : '') + slot + '/P' + port,
          wx: center.x,
          wy: center.y,
          el: node,
        };
      }

      node = el.closest && el.closest('.lab-cas-port');
      if (node) {
        var sid = node.getAttribute('data-spl-id');
        var pid = node.getAttribute('data-spl-port');
        var pPolish = node.classList.contains('is-apc') ? 'APC' : 'UPC';
        var face = node.querySelector('i') || node;
        var r2 = face.getBoundingClientRect();
        var c2 = clientToWorld(r2.left + r2.width / 2, r2.top + r2.height / 2);
        return {
          owner: 'splitter',
          splitterId: sid,
          port: pid,
          polish: pPolish,
          label: (sid || 'SPL') + ' ' + pid,
          wx: c2.x,
          wy: c2.y,
          el: node,
        };
      }

      node = el.closest && el.closest('.lab-cpl-port');
      if (node) {
        var cid = node.getAttribute('data-cpl-id');
        var cport = node.getAttribute('data-cpl-port') || 'A';
        var cPolish = node.classList.contains('is-apc') ? 'APC' : 'UPC';
        var cFace = node.querySelector('i') || node;
        var r3 = cFace.getBoundingClientRect();
        var c3 = clientToWorld(r3.left + r3.width / 2, r3.top + r3.height / 2);
        return {
          owner: 'coupler',
          couplerId: cid,
          port: cport,
          polish: cPolish,
          label: 'SC Coupler ' + cport + ' · ' + (cPolish === 'APC' ? 'SC/APC' : 'SC/PC'),
          wx: c3.x,
          wy: c3.y,
          el: node,
        };
      }

      node = el.closest && el.closest('.lab-vfl-port[data-vfl-port]');
      if (node) {
        var vid = node.getAttribute('data-vfl-port');
        var ferrule = node.querySelector('.lab-vfl-port__ferrule') || node;
        var rV = ferrule.getBoundingClientRect();
        var cV = clientToWorld(rV.left + rV.width / 2, rV.top + rV.height / 2);
        return {
          owner: 'vfl',
          vflId: vid,
          polish: 'UPC',
          label: 'VFL · SC port',
          wx: cV.x,
          wy: cV.y,
          el: node,
        };
      }

      node = el.closest && el.closest('.lab-opm-port[data-opm-port]');
      if (node) {
        var oid = node.getAttribute('data-opm-port');
        var conn = (node.getAttribute('data-opm-connector') || 'SC').toUpperCase();
        if (conn !== 'SC') {
          if (global.FtthLab && FtthLab.showAlert) {
            FtthLab.showAlert('OLP-38 accepts SC connectors only (Patch Cord / SC Pigtail).', 'warn');
          } else if (global.FtthLab && FtthLab.setStatus) {
            FtthLab.setStatus('Dock rejected · SC connector required');
          }
          return null;
        }
        var knurl = node.querySelector('.viavi__adapter-knurl, .lab-opm__adapter-knurl') || node;
        var rO = knurl.getBoundingClientRect();
        var cO = clientToWorld(rO.left + rO.width / 2, rO.top + rO.height * 0.35);
        var otdrOpm = otdrPortMetaFromNode(node);
        return {
          owner: 'opm',
          opmId: oid,
          polish: otdrOpm ? otdrOpm.polish : 'UPC',
          universal: isUniversalPortEl(node),
          connectorType: 'SC',
          label: otdrOpm ? otdrOpm.label : 'Viavi OLP-38 · SC adapter',
          wx: cO.x,
          wy: cO.y,
          el: node,
        };
      }

      node = el.closest && el.closest('.lab-ols-port[data-ols-port]');
      if (node) {
        var olsId = node.getAttribute('data-ols-port');
        var olsConn = (node.getAttribute('data-ols-connector') || 'SC').toUpperCase();
        if (olsConn !== 'SC') {
          if (global.FtthLab && FtthLab.showAlert) {
            FtthLab.showAlert('OLS-35 accepts SC connectors only (Patch Cord / SC Pigtail).', 'warn');
          } else if (global.FtthLab && FtthLab.setStatus) {
            FtthLab.setStatus('Dock rejected · SC connector required');
          }
          return null;
        }
        var olsSlot = node.querySelector(
          '.lab-ols__adapter-slot, .lab-ols__adapter-knurl, .viavi__adapter-knurl'
        ) || node;
        var rS = olsSlot.getBoundingClientRect();
        var cS = clientToWorld(rS.left + rS.width / 2, rS.top + Math.max(1, rS.height * 0.2));
        var otdrOls = otdrPortMetaFromNode(node);
        return {
          owner: 'ols',
          olsId: olsId,
          polish: otdrOls ? otdrOls.polish : 'UPC',
          connectorType: 'SC',
          label: otdrOls ? otdrOls.label : 'Viavi OLS-35 · SC adapter',
          wx: cS.x,
          wy: cS.y,
          el: node,
        };
      }
    }

    /* Fallback: no element hit — keep free world point available to callers */
    return null;
  }

  function syncAttachedPositions(cord) {
    ['A', 'B'].forEach(function (end) {
      var side = cord[endKey(end)];
      if (!side.attached) return;
      var att = side.attached;
      if (isOtdrAttachment(att)) {
        var pwOtdr = resolveOtdrPortWorld(att);
        if (pwOtdr) {
          att.wx = pwOtdr.x;
          att.wy = pwOtdr.y;
          side.lockedRot = 180;
          att.lockedRot = 180;
          side.liveRot = null;
          seatEndAtPort(cord, end, pwOtdr.x, pwOtdr.y);
        }
        return;
      }
      var el = null;
      if (att.owner === 'olt') {
        el = document.querySelector(
          '.lab-fx-port[data-lab-slot="' + att.slot + '"][data-lab-sfp="' + att.oltPort + '"]'
        );
        if (el) {
          var cage = el.querySelector('.lab-fx-port__cage') || el;
          var rect = cage.getBoundingClientRect();
          var pt = clientToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
          att.wx = pt.x;
          att.wy = pt.y;
          /* Keep plug-time upright lock — do not re-derive sideways axes on sync */
          if (typeof side.lockedRot !== 'number') {
            side.lockedRot = portAlignedRotation({ owner: 'olt', el: el, wx: pt.x, wy: pt.y });
            att.lockedRot = side.lockedRot;
          }
          side.liveRot = null;
          seatEndAtPort(cord, end, pt.x, pt.y);
        }
        return;
      }
      if (att.owner === 'splitter') {
        el = document.querySelector(
          '.lab-cas-port[data-spl-id="' + att.splitterId + '"][data-spl-port="' + att.port + '"]'
        );
        if (el) {
          var face = el.querySelector('i') || el;
          var r2 = face.getBoundingClientRect();
          var pt2 = clientToWorld(r2.left + r2.width / 2, r2.top + r2.height / 2);
          att.wx = pt2.x;
          att.wy = pt2.y;
          if (typeof side.lockedRot !== 'number') {
            side.lockedRot = portAlignedRotation({ owner: 'splitter', el: el, wx: pt2.x, wy: pt2.y });
            att.lockedRot = side.lockedRot;
          }
          side.liveRot = null;
          seatEndAtPort(cord, end, pt2.x, pt2.y);
        }
        return;
      }
      if (att.owner === 'coupler') {
        var pw = null;
        if (global.FtthLab && typeof FtthLab.getCouplerPortWorld === 'function') {
          pw = FtthLab.getCouplerPortWorld(att.couplerId, att.port);
        }
        if (pw) {
          att.wx = pw.x;
          att.wy = pw.y;
          if (typeof side.lockedRot !== 'number') {
            side.lockedRot = typeof pw.rot === 'number'
              ? pw.rot
              : portAlignedRotation({ owner: 'coupler', port: att.port });
            att.lockedRot = side.lockedRot;
          }
          side.liveRot = null;
          seatEndAtPort(cord, end, pw.x, pw.y);
          return;
        }
        el = document.querySelector(
          '.lab-cpl-port[data-cpl-id="' + att.couplerId + '"][data-cpl-port="' + att.port + '"]'
        );
        if (el) {
          var rC = el.getBoundingClientRect();
          var ptC = clientToWorld(rC.left + rC.width / 2, rC.top + rC.height / 2);
          att.wx = ptC.x;
          att.wy = ptC.y;
          if (typeof side.lockedRot !== 'number') {
            side.lockedRot = portAlignedRotation({
              owner: 'coupler',
              port: att.port,
              el: el,
              wx: ptC.x,
              wy: ptC.y,
            });
            att.lockedRot = side.lockedRot;
          }
          side.liveRot = null;
          seatEndAtPort(cord, end, ptC.x, ptC.y);
        }
        return;
      }
      if (att.owner === 'vfl') {
        var pwV = null;
        if (global.FtthLab && typeof FtthLab.getVflPortWorld === 'function') {
          pwV = FtthLab.getVflPortWorld(att.vflId);
        }
        if (pwV) {
          att.wx = pwV.x;
          att.wy = pwV.y;
          /* Always re-assert upward cable exit (180°) on top test ports */
          side.lockedRot = 180;
          att.lockedRot = 180;
          side.liveRot = null;
          seatEndAtPort(cord, end, pwV.x, pwV.y);
        }
        return;
      }
      if (att.owner === 'opm') {
        var pwO = null;
        if (global.FtthLab && typeof FtthLab.getOpmPortWorld === 'function') {
          pwO = FtthLab.getOpmPortWorld(att.opmId);
        }
        if (pwO) {
          att.wx = pwO.x;
          att.wy = pwO.y;
          side.lockedRot = 180;
          att.lockedRot = 180;
          side.liveRot = null;
          seatEndAtPort(cord, end, pwO.x, pwO.y);
        }
        return;
      }
      if (att.owner === 'ols') {
        var pwS = null;
        if (global.FtthLab && typeof FtthLab.getOlsPortWorld === 'function') {
          pwS = FtthLab.getOlsPortWorld(att.olsId);
        }
        if (pwS) {
          att.wx = pwS.x;
          att.wy = pwS.y;
          side.lockedRot = 180;
          att.lockedRot = 180;
          side.liveRot = null;
          seatEndAtPort(cord, end, pwS.x, pwS.y);
        }
      }
    });
  }

  /* ─── Loss / budget ─── */

  function cordLengthUnit(cord) {
    return cord && cord.lengthUnit === 'km' ? 'km' : 'm';
  }

  function cordLengthDisplayValue(cord) {
    if (!cord || typeof cord.lengthMeters !== 'number') return 3;
    return cordLengthUnit(cord) === 'km'
      ? cord.lengthMeters / 1000
      : cord.lengthMeters;
  }

  function cordLengthInputToMeters(value, unit) {
    var n = Number(value);
    if (!isFinite(n) || n < 0) n = 0;
    return unit === 'km' ? n * 1000 : n;
  }

  function cordFiberLengthMFromGeometry(cord) {
    if (!cord) return 0;
    if (isMeterMode(cord) && typeof cord.lengthMeters === 'number') {
      return cord.lengthMeters;
    }
    if (typeof cord.fixedLength === 'number' && cord.fixedLength > 0) {
      return pxToMeters(cord.fixedLength);
    }
    var dx = cord.bx - cord.ax;
    var dy = cord.by - cord.ay;
    return pxToMeters(Math.sqrt(dx * dx + dy * dy));
  }

  function cordFiberLengthM(cord) {
    if (!cord) return 0;
    if (typeof cord.cableLength === 'number' && isFinite(cord.cableLength)) {
      return normalizeOtdrCableLengthMeters(
        cordLengthInputToMeters(cord.cableLength, cord.lengthUnit || cord.otdrLengthUnit || 'm')
      );
    }
    if (typeof cord.otdrCableLengthM === 'number' && isFinite(cord.otdrCableLengthM)) {
      return Math.max(0, cord.otdrCableLengthM);
    }
    return cordFiberLengthMFromGeometry(cord);
  }

  function cordOtdrLengthUnit(cord) {
    if (cord && cord.otdrLengthUnit === 'km') return 'km';
    return cordLengthUnit(cord);
  }

  function cordOtdrLengthDisplayValue(cord) {
    if (cord && typeof cord.cableLength === 'number' && isFinite(cord.cableLength)) {
      return cord.cableLength;
    }
    var meters = typeof cord.otdrCableLengthM === 'number'
      ? cord.otdrCableLengthM
      : cordFiberLengthMFromGeometry(cord);
    return cordOtdrLengthUnit(cord) === 'km' ? meters / 1000 : meters;
  }

  function setOtdrCableLength(id, value, unit) {
    var cord = findCord(id);
    if (!cord) return;
    var meters = applyPatchCordCableLengthModel(cord, value, unit);
    if (isMeterMode(cord)) {
      cord.lengthMeters = normalizeLengthMeters(meters);
      cord.lengthUnit = cord.otdrLengthUnit;
      clearRopePhysics(cord.id);
      applyMeterLengthToCord(cord);
      rebuildLayer();
      updateFiberPath(cord);
    }
    refreshBudget();
    updateInspector();
    pushHistory();
    setStatus('Cable length · ' + meters.toFixed(2) + ' m (OTDR)');
  }

  function setOtdrCableLengthUnit(id, unit) {
    var cord = findCord(id);
    if (!cord) return;
    cord.otdrLengthUnit = unit === 'km' ? 'km' : 'm';
    updateInspector();
  }

  function cordLossDb(cord) {
    var loss = 0;
    var aOn = !!cord.sideA.attached;
    var bOn = !!cord.sideB.attached;
    if (aOn && bOn) {
      loss += MATCHED_CONNECTOR_DB * 2;
      if (cord.sideA.mismatch) loss += MISMATCH_PENALTY_DB;
      if (cord.sideB.mismatch) loss += MISMATCH_PENALTY_DB;
    } else {
      if (aOn && cord.sideA.mismatch) loss += MISMATCH_PENALTY_DB;
      if (bOn && cord.sideB.mismatch) loss += MISMATCH_PENALTY_DB;
    }
    if (cord.bendJigId && global.FtthLab && typeof FtthLab.macroBendLossForJig === 'function') {
      loss += Number(FtthLab.macroBendLossForJig(cord.bendJigId)) || 0;
    }
    return loss;
  }

  function getNetworkLossDb() {
    var sum = 0;
    cords.forEach(function (c) {
      sum += cordLossDb(c);
    });
    return Math.round(sum * 100) / 100;
  }

  function getMismatchCount() {
    var n = 0;
    cords.forEach(function (c) {
      if (c.sideA.attached && c.sideA.mismatch) n += 1;
      if (c.sideB.attached && c.sideB.mismatch) n += 1;
    });
    return n;
  }

  function refreshBudget() {
    if (global.FtthLab && typeof FtthLab.refreshPowerBudget === 'function') {
      FtthLab.refreshPowerBudget();
      if (typeof FtthLab.publishOpmPowerEquation === 'function') {
        FtthLab.publishOpmPowerEquation();
      }
      return;
    }
    var loss = getNetworkLossDb();
    var text = loss > 0
      ? 'Power budget · Patch + mismatch ' + loss.toFixed(2) + ' dB'
      : 'Power budget · no active patch paths';
    if (global.FtthLab && FtthLab.setBudget) FtthLab.setBudget(text);
  }

  /** Attachment snapshot for VFL laser propagation. */
  function getLaserGraphNodes() {
    return cords.map(function (c) {
      function sideSnap(side) {
        if (!side.attached) return null;
        return {
          owner: side.attached.owner,
          couplerId: side.attached.couplerId || null,
          vflId: side.attached.vflId || null,
          splitterId: side.attached.splitterId || null,
          opmId: side.attached.opmId || null,
          olsId: side.attached.olsId || null,
          port: side.attached.port || null,
          slot: side.attached.slot != null ? side.attached.slot : null,
          oltPort: side.attached.oltPort != null ? side.attached.oltPort : null,
          mismatch: !!side.mismatch,
          polish: side.polish === 'APC' ? 'APC' : 'UPC',
        };
      }
      return {
        id: c.id,
        sideA: sideSnap(c.sideA),
        sideB: sideSnap(c.sideB),
        lossDb: cordLossDb(c),
        cableLength: cordOtdrLengthDisplayValue(c),
        lengthUnit: cordOtdrLengthUnit(c),
        otdrCableLengthM: cordFiberLengthM(c),
        fiberLengthM: cordFiberLengthM(c),
        bendJigId: c.bendJigId || null,
        freeA: !c.sideA.attached,
        freeB: !c.sideB.attached,
      };
    });
  }

  function applyLaserGlow(ids, mode, meta) {
    meta = meta || {};
    var map = {};
    var exits = meta.pcordExits || {};
    (ids || []).forEach(function (id) { map[id] = true; });
    if (!mode && global.FtthLab && FtthLab._vflGlow) mode = FtthLab._vflGlow.mode;
    mode = String(mode || 'OFF').toUpperCase();
    if (!layer) return;

    /* Jacket paths must never pick up laser tint */
    layer.querySelectorAll('[data-pcord-fiber]').forEach(function (el) {
      el.classList.remove('is-vfl-glow', 'is-vfl-glow--cw', 'is-vfl-glow--glint');
    });

    layer.querySelectorAll('[data-pcord-laser]').forEach(function (el) {
      var id = el.getAttribute('data-pcord-laser');
      var on = !!map[id] && mode !== 'OFF';
      el.classList.remove('is-vfl-glow', 'is-vfl-glow--cw', 'is-vfl-glow--glint');
      if (!on) return;
      el.classList.add('is-vfl-glow');
      el.classList.add(mode === 'GLINT' ? 'is-vfl-glow--glint' : 'is-vfl-glow--cw');
    });

    layer.querySelectorAll('[data-pcord-id][data-pcord-end]').forEach(function (el) {
      var id = el.getAttribute('data-pcord-id');
      var end = el.getAttribute('data-pcord-end');
      el.classList.remove('is-vfl-laser-exit', 'is-vfl-laser-exit--cw', 'is-vfl-laser-exit--glint');
      if (map[id] && exits[id] === end && mode !== 'OFF' && !el.classList.contains('is-attached')) {
        el.classList.add('is-vfl-laser-exit');
        el.classList.add(mode === 'GLINT' ? 'is-vfl-laser-exit--glint' : 'is-vfl-laser-exit--cw');
      }
    });
  }

  function reapplyStoredVflGlow() {
    var glow = global.FtthLab && FtthLab._vflGlow;
    if (glow) applyLaserGlow(glow.pcords, glow.mode, { pcordExits: glow.pcordExits });
  }

  function deleteSelected() {
    if (selection.kind === 'cord' && selection.cordId) {
      removeCord(selection.cordId);
      return true;
    }
    return false;
  }

  function selectCord(id) {
    selection = { kind: 'cord', cordId: id };
    claimSelection();
    /* Keep toolbox arm after place/select — only ESC / background / other tool clears it */
    updateInspector();
    rebuildLayer();
  }

  /* ─── Toolbox ─── */

  function renderToolbox() {
    var host = global.FtthLab && typeof FtthLab.gateToolboxRender === 'function'
      ? FtthLab.gateToolboxRender('lab-patchcord-tree', 'patchcord')
      : document.getElementById('lab-patchcord-tree');
    if (!host) return;
    host.innerHTML =
      '<div class="lab-toolbox" role="list">' +
      '<button type="button" class="lab-tool lab-tool--pcord' +
      (selectedTool === 'patchcord' ? ' is-selected' : '') +
      '" draggable="true" data-lab-tool="patchcord" role="listitem">' +
      '<span class="lab-tool__mark lab-tool__mark--pcord" aria-hidden="true"></span>' +
      '<span class="lab-tool__copy">' +
      '<strong>Patch Cord</strong>' +
      '<span>A ↔ B same click-drag rules</span>' +
      '</span>' +
      '</button>' +
      '</div>';
    bindToolbox(host);
    if (global.FtthLab && typeof FtthLab.applyFtthLabToolboxIcons === 'function') {
      FtthLab.applyFtthLabToolboxIcons();
    }
  }

  function bindToolbox(host) {
    var btn = host.querySelector('[data-lab-tool="patchcord"]');
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
        FtthLab.claimToolboxTool('patch-cord');
      }
      selectedTool = 'patchcord';
      renderToolbox();
      setStatus('Patch Cord · click-and-hold End A or End B to drag — no auto-follow');
    });
    btn.addEventListener('dragstart', function (e) {
      if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
        FtthLab.claimToolboxTool('patch-cord');
      }
      selectedTool = 'patchcord';
      dragLib = { kind: 'patchcord' };
      if (global.FtthLab && FtthLab.beginDrag) FtthLab.beginDrag({ kind: 'patchcord' });
      try {
        e.dataTransfer.setData('text/plain', 'lab:patchcord');
        e.dataTransfer.setData('text/lab-drag', 'patchcord');
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
      if (!el || el.dataset.patchcordDrop === '1') return;
      el.dataset.patchcordDrop = '1';
      el.addEventListener('dragover', function (e) {
        var active = global.FtthLab && FtthLab.getActiveDrag && FtthLab.getActiveDrag();
        if (!((dragLib && dragLib.kind === 'patchcord') || (active && active.kind === 'patchcord'))) {
          return;
        }
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      });
      el.addEventListener('drop', function (e) {
        var active = global.FtthLab && FtthLab.getActiveDrag && FtthLab.getActiveDrag();
        var kind = (e.dataTransfer && e.dataTransfer.getData('text/lab-drag')) ||
          (active && active.kind) || (dragLib && dragLib.kind) || '';
        if (kind !== 'patchcord') return;
        e.preventDefault();
        e.stopPropagation();
        dragLib = null;
        if (global.FtthLab && FtthLab.endDrag) FtthLab.endDrag();
        selectedTool = 'patchcord';
        var hit = hitTestPort(e.clientX, e.clientY);
        if (hit) {
          startLinkFromPort(hit);
          return;
        }
        var pt = clientToWorld(e.clientX, e.clientY);
        placeCord(Math.round(pt.x - 20), Math.round(pt.y - 10));
      });
    });
  }

  /* ─── Dual-state link lifecycle (A locked → B follows → B snap) ─── */

  function clearPortHighlights() {
    document.querySelectorAll(
      '.lab-fx-port.is-plug-target, .lab-cas-port.is-plug-target, .lab-cpl-port.is-plug-target, ' +
      '.lab-vfl-port.is-plug-target, .lab-opm-port.is-plug-target, .lab-ols-port.is-plug-target, .lab-otdr-port.is-plug-target'
    ).forEach(function (n) { n.classList.remove('is-plug-target'); });
  }

  function unbindLinkFollow() {
    if (!linkSession) return;
    if (linkSession._onMove) {
      window.removeEventListener('pointermove', linkSession._onMove);
    }
    if (linkSession._onDown) {
      window.removeEventListener('pointerdown', linkSession._onDown, true);
    }
    linkSession._onMove = null;
    linkSession._onDown = null;
  }

  function endLinkSession(opts) {
    opts = opts || {};
    unbindLinkFollow();
    linkSession = null;
    document.body.classList.remove('lab-pcord-linking');
    clearPortHighlights();
    if (global.FtthLab) FtthLab._patchPending = null;
  }

  function cancelLinkSession() {
    if (!linkSession) {
      if (global.FtthLab) FtthLab._patchPending = null;
      return;
    }
    var id = linkSession.cordId;
    var c = findCord(id);
    endLinkSession({ silent: true });
    if (!c) {
      setStatus('Patch link cancelled');
      return;
    }
    var free = getFreeEnd(c);
    if (free) {
      rebuildLayer();
      updateInspector();
      setStatus(
        'End ' + oppositeEnd(free) + ' locked · click-and-hold End ' + free + ' to drag'
      );
      return;
    }
    if (!c.sideA.attached && !c.sideB.attached) {
      removeCord(id);
    }
    setStatus('Patch link cancelled');
  }

  function oppositeEnd(end) {
    return end === 'A' ? 'B' : 'A';
  }

  /** Which connector is free (unplugged), or null if none/both. */
  function getFreeEnd(cord) {
    if (!cord) return null;
    var aOn = !!cord.sideA.attached;
    var bOn = !!cord.sideB.attached;
    if (aOn && !bOn) return 'B';
    if (bOn && !aOn) return 'A';
    return null;
  }

  /**
   * Mark a half-connected cord. The plugged end stays locked; the free end
   * keeps its current workspace position (no auto-shrink / snap-back) until
   * an explicit click-and-hold drag.
   */
  function armHalfConnected(cord, freeEnd) {
    if (!cord) return;
    freeEnd = freeEnd || getFreeEnd(cord);
    if (!freeEnd) return;
    freeEnd = freeEnd === 'A' ? 'A' : 'B';
    var lockedEnd = oppositeEnd(freeEnd);
    if (!cord[endKey(lockedEnd)].attached) return;

    linkSession = { cordId: cord.id, freeEnd: freeEnd };
    if (global.FtthLab) {
      FtthLab._patchPending = {
        fromPatchCord: true,
        cordId: cord.id,
        freeEnd: freeEnd,
      };
    }
    selectCord(cord.id);
    setStatus(
      'End ' + lockedEnd + ' locked · End ' + freeEnd +
      ' stays put — click-and-hold it to drag'
    );
  }

  /**
   * First port click locks End A. End B is created at a fixed offset once,
   * then left alone — never auto-collapsed when A seats.
   */
  function startLinkFromPort(hit) {
    if (!hit || typeof hit.wx !== 'number') return false;
    if (!canDockHit(hit)) {
      setStatus('Insert an SFP before docking a patch cord');
      if (hit.el) {
        hit.el.classList.add('is-plug-reject');
        setTimeout(function () { hit.el.classList.remove('is-plug-reject'); }, 420);
      }
      return false;
    }
    if (linkSession) cancelLinkSession();

    seq += 1;
    var polish = hit.polish === 'APC' || String(hit.polish).toUpperCase() === 'APC' ? 'APC' : 'PC';
    var freeX = hit.wx + 140;
    var freeY = hit.wy + 70;
    var cord = {
      id: 'pc-' + seq,
      ax: hit.wx,
      ay: hit.wy,
      bx: freeX,
      by: freeY,
      sideA: { polish: polish, attached: null, mismatch: false, lockedRot: null, liveRot: null },
      sideB: { polish: polish, attached: null, mismatch: false, lockedRot: null, liveRot: null },
      route: [],
      pathLocked: false,
      fixedLength: null,
      lengthMode: 'free',
      lengthMeters: 3,
      relocating: false,
      spoolWrap: {},
      contacts: [],
      contactSeq: 0,
      bendJigId: null,
    };
    cords.push(cord);
    attachEnd(cord, 'A', hit);
    /* Preserve free-end spawn position — do not re-snap B toward A after seat */
    cord.bx = freeX;
    cord.by = freeY;
    clearDrawnPath(cord);
    selectCord(cord.id);
    rebuildLayer();
    flashPort(hit.el);
    armHalfConnected(cord, 'B');
    return true;
  }

  /** Used only if a pending half-link is completed via API — prefer drag-release. */
  function completeLinkToPort(hit) {
    if (!linkSession || !hit) return false;
    var c = findCord(linkSession.cordId);
    var freeEnd = linkSession.freeEnd || 'B';
    if (!c) {
      endLinkSession({ silent: true });
      return false;
    }
    attachEnd(c, freeEnd, hit);
    var seatTip = bootExitStub(c, freeEnd);
    appendRoutePoint(c, seatTip.x, seatTip.y);
    lockDrawnPath(c);
    flashPort(hit.el);
    endLinkSession({ silent: true });
    suppressPortClickUntil = Date.now() + 450;
    rebuildLayer();
    updateInspector();
    pushHistory();
    refreshBudget();
    setStatus(
      'Patch connected · drawn path locked · ' +
      (c.sideA.attached && c.sideA.attached.label) + ' ↔ ' +
      (c.sideB.attached && c.sideB.attached.label)
    );
    return true;
  }

  /** Enrich a port descriptor from splitter/OLT into a full hit with world coords. */
  function resolvePortDesc(portDesc) {
    if (!portDesc) return null;
    if (typeof portDesc.wx === 'number' && typeof portDesc.wy === 'number' && portDesc.el) {
      return portDesc;
    }
    var el = null;
    if (portDesc.owner === 'olt') {
      el = document.querySelector(
        '.lab-fx-port.is-active[data-lab-slot="' + portDesc.slot +
        '"][data-lab-sfp="' + portDesc.oltPort + '"]'
      );
    } else if (portDesc.owner === 'splitter') {
      el = document.querySelector(
        '.lab-cas-port[data-spl-id="' + portDesc.splitterId +
        '"][data-spl-port="' + portDesc.port + '"]'
      );
    }
    if (!el) return null;
    var face = el.querySelector('.lab-fx-port__cage, i') || el;
    var rect = face.getBoundingClientRect();
    var center = clientToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      owner: portDesc.owner,
      polish: portDesc.polish,
      label: portDesc.label,
      splitterId: portDesc.splitterId || null,
      port: portDesc.port || null,
      slot: portDesc.slot != null ? portDesc.slot : null,
      oltPort: portDesc.oltPort != null ? portDesc.oltPort : null,
      wx: center.x,
      wy: center.y,
      el: el,
    };
  }

  /**
   * Entry from splitter/OLT port clicks (and FtthLab.tryPatchPort).
   * Starts or completes the dual-state yellow patch-cord link.
   */
  function tryPatchPort(portDesc) {
    var hit = resolvePortDesc(portDesc);
    if (!hit) return false;

    if (linkSession) {
      /* No auto-complete on port click — user must click-drag the free end */
      setStatus('Click-and-drag the free connector end onto the target port');
      return true;
    }

    if (selectedTool === 'patchcord' || (portDesc && portDesc.forcePatchCord)) {
      return startLinkFromPort(hit);
    }
    return false;
  }

  function bindPortLifecycle() {
    if (typeof document === 'undefined') return;
    if (document.documentElement.dataset.pcordLifecycle === '1') return;
    document.documentElement.dataset.pcordLifecycle = '1';

    document.addEventListener('click', function (e) {
      var el = e.target.closest && e.target.closest(
        '.lab-fx-port.is-active, .lab-cas-port'
      );
      if (!el) return;

      if (Date.now() < suppressPortClickUntil) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        return;
      }

      /* Half-connected: ignore port clicks — only click-drag free end completes the link */
      if (linkSession) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        setStatus('Click-and-hold the free End and drag it onto the target port');
        return;
      }

      if (selectedTool !== 'patchcord') return;

      var hit = hitTestPort(e.clientX, e.clientY);
      if (!hit) return;
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      startLinkFromPort(hit);
    }, true);
  }

  /* ─── Render ─── */

  function ensureLayer() {
    var mount = (ctx && ctx.host2d) || document.getElementById('lab-2d-mount');
    if (!mount) return null;
    if (!layer || !layer.parentNode) {
      layer = document.createElement('div');
      layer.className = 'lab-pcord-layer';
      layer.setAttribute('data-lab-pcord-layer', '1');
      mount.appendChild(layer);
    }
    return layer;
  }

  function endClass(side) {
    return normalizePolish(side.polish) === 'APC' ? 'is-apc' : 'is-pc';
  }

  var END_W = 14;
  var END_H = 22;
  /*
   * Local frame matches CSS: ferrule at top (−Y), ribbed boot at bottom (+Y).
   * World pos = button center (transform-origin 50% 50%).
   */
  var BOOT_EXIT_OFFSET = END_H / 2; /* rear tip of boot flush with button bottom */
  var BOOT_EXIT_STUB = 10; /* first strain-relief marker past the tip */
  var STRAIN_RELIEF_PX = 22; /* total straight exit before curvature is allowed */
  var STRAIN_LEAD_PTS = 3; /* tip + 2 collinear relief points per end */
  var BODY_CLEAR_PX = END_H / 2 + 3;
  var HEADING_MIN_PX = 2.5; /* ignore micro jitter when updating live heading */
  var HEADING_SMOOTH = 0.42; /* blend factor toward new motion heading */
  /* Free-head upright cone: ±90° = full L/R, never ferrule-down (≈180°) */
  var HEADING_MAX_TILT_DEG = 90;
  var UNPLUG_PULL_PX = 36;
  var PLUG_SNAP_PX = 22;
  /** Generous magnetic capture around the SFP optical aperture */
  var SFP_SNAP_PX = 56;
  /** OLS-35 magnetic capture (screen px) — larger than generic port snap */
  var OLS_MAGNET_SNAP_PX = 56;
  /** Auto-click lock once magnetically seated */
  var OLS_MAGNET_LOCK_PX = 30;
  /** Base gravity sag (px); also scaled by end-to-end distance */
  var GRAVITY_OFFSET = 100;
  var GRAVITY_SAG_RATIO = 0.28;
  var GRAVITY_SAG_MIN = 24;
  var GRAVITY_SAG_MAX = 160;
  /** Slack factor when no user length is available (true catenary) */
  var CATENARY_DEFAULT_SLACK = 1.12;
  /** Dense samples for mathematically accurate mid-span */
  var CATENARY_SAMPLES = 48;
  /** Min world distance between recorded mouse-path samples (anti-jitter) */
  var TRACE_SAMPLE_PX = 14;
  var TRACE_MAX_POINTS = 180;
  var CHAIKIN_ITERATIONS = 2;
  /** Catmull-Rom densify: samples per segment when polishing free-hand ink */
  var SPLINE_SAMPLES_PER_SEG = 5;
  /** SVG Catmull handle divisor — lower = silkier mid-span (always cubic, never raw L) */
  var CATMULL_HANDLE_K = 3.8;
  /* ─── Mid-span rope / spring-damper (fully linked cords) ─── */
  var PHYS_SEGMENTS = 28;
  var PHYS_DAMPING = 0.9;
  var PHYS_REST_SPRING = 0.07;
  var PHYS_STRUCT_ITERS = 5;
  var PHYS_STRUCT_STRENGTH = 0.52;
  var PHYS_GRAB_SIGMA = 2.6; /* particle-index falloff for rubber pull */
  var PHYS_GRAB_NEIGHBOR = 0.62;
  var PHYS_RELEASE_KICK = 0.38; /* initial Verlet impulse toward rest */
  var PHYS_SUBSTEPS = 2;
  var PHYS_SETTLE_EPS = 0.55;
  var PHYS_MAX_SETTLE = 220;

  function dist2(ax, ay, bx, by) {
    var dx = ax - bx;
    var dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function setEndWorld(cord, end, x, y) {
    if (end === 'A') { cord.ax = x; cord.ay = y; }
    else { cord.bx = x; cord.by = y; }
  }

  function getEndWorld(cord, end) {
    return end === 'A' ? { x: cord.ax, y: cord.ay } : { x: cord.bx, y: cord.by };
  }

  /**
   * CSS rotate(θ) with y+ down:
   *   x' = x cosθ − y sinθ
   *   y' = x sinθ + y cosθ
   * Local +Y = boot (rear); local −Y = ferrule (nose).
   * bootOutDir(θ) = (−sin θ, cos θ). Aim that vector at (toward − center):
   *   θ = atan2(−tx, ty)
   */
  function endRotationDeg(cx, cy, towardX, towardY) {
    var tx = towardX - cx;
    var ty = towardY - cy;
    return Math.atan2(-tx, ty) * 180 / Math.PI;
  }

  /** Unit vector of local +Y after CSS rotate — rear boot → cable. */
  function bootOutDir(rotDeg) {
    var r = rotDeg * Math.PI / 180;
    return { x: -Math.sin(r), y: Math.cos(r) };
  }

  /** Map connector-local coords onto world using the same matrix as CSS rotate(). */
  function localToWorld(cx, cy, lx, ly, rotDeg) {
    var r = rotDeg * Math.PI / 180;
    var cos = Math.cos(r);
    var sin = Math.sin(r);
    return {
      x: cx + lx * cos - ly * sin,
      y: cy + lx * sin + ly * cos,
    };
  }

  /** Shortest-path blend between two CSS degrees. */
  function lerpAngleDeg(from, to, t) {
    var d = ((to - from + 540) % 360) - 180;
    return from + d * t;
  }

  /** Clamp free-end CSS rotate into the upright hemisphere (ferrule never nose-down). */
  function clampUprightHeading(rotDeg) {
    if (global.FtthLab && typeof FtthLab.clampConnectorHeadingUpright === 'function') {
      return FtthLab.clampConnectorHeadingUpright(rotDeg, HEADING_MAX_TILT_DEG);
    }
    var a = Number(rotDeg);
    if (!isFinite(a)) return 0;
    a = ((a + 180) % 360 + 360) % 360 - 180;
    if (a > HEADING_MAX_TILT_DEG) return HEADING_MAX_TILT_DEG;
    if (a < -HEADING_MAX_TILT_DEG) return -HEADING_MAX_TILT_DEG;
    return a;
  }

  /** Unconstrained nose→motion degrees (used when choosing 0° vs 180° at plug). */
  function headingRotFromMotionRaw(dx, dy) {
    return Math.atan2(dx, -dy) * 180 / Math.PI;
  }

  /**
   * Free-drag heading: ferrule/nose leads along motion; boot trails opposite.
   * Left/right yaw stays smooth (±90°). Vertical downward motion is ignored
   * so the head stays upright instead of flipping to ~180° (nose-down).
   * Ferrule after rotate = (sin θ, −cos θ) ⇒ upright θ = 0.
   */
  function headingRotFromMotion(dx, dy) {
    if (global.FtthLab && typeof FtthLab.headingRotFromMotionUpright === 'function') {
      return FtthLab.headingRotFromMotionUpright(dx, dy, HEADING_MAX_TILT_DEG);
    }
    var ax = dx;
    var ay = dy > 0 ? 0 : dy;
    if (Math.abs(ax) < 1e-9 && Math.abs(ay) < 1e-9) return 0;
    return clampUprightHeading(Math.atan2(ax, -ay) * 180 / Math.PI);
  }

  /**
   * Strict vertical socket axis for OLT / splitter faceplates.
   * SC coupler barrel uses horizontal faces (A left / B right).
   * Top-mounted test gear (VFL / OLP-38 / OLS-35): always 180° so ferrule seats
   * downward into the adapter and the yellow cable exits straight up.
   */
  /** Angled OLT SFP tier: the seat axis is baked into the port element. */
  function oltPortSeatRotation(hit) {
    var el = hit && hit.el;
    var node = el && el.closest ? el.closest('.lab-fx-port') : null;
    if (!node) return null;
    var v = Number(node.getAttribute('data-lab-port-rot'));
    return isFinite(v) ? v : null;
  }

  function portAlignedRotation(hit) {
    if (hit && hit.owner === 'coupler') {
      return hit.port === 'B' ? -90 : 90;
    }
    if (hit && (hit.owner === 'vfl' || hit.owner === 'opm' || hit.owner === 'ols')) {
      return 180;
    }
    if (hit && (hit.owner === 'splitter' ||
        (hit.el && hit.el.classList && hit.el.classList.contains('lab-cas-port')))) {
      return 180;
    }
    var oltRot = oltPortSeatRotation(hit);
    if (oltRot != null) return oltRot;
    /* OLT / default: upright ferrule-up seat */
    return 0;
  }

  /** Test-equipment top ports never flip with approach direction. */
  function isTopTestPort(hit) {
    return !!(hit && (hit.owner === 'vfl' || hit.owner === 'opm' || hit.owner === 'ols'));
  }

  function olsMagnetRadius() {
    if (global.FtthLab && typeof FtthLab.getOlsMagnetSnapPx === 'function') {
      var n = Number(FtthLab.getOlsMagnetSnapPx());
      if (isFinite(n) && n > 0) return n;
    }
    return OLS_MAGNET_SNAP_PX;
  }

  function plugSnapRadiusFor(hit) {
    if (hit && hit.owner === 'ols') return olsMagnetRadius();
    if (hit && hit.owner === 'olt') return SFP_SNAP_PX;
    return PLUG_SNAP_PX;
  }

  /** Refresh OLS hit to deep-seat metallic adapter center (ferrule flush inside). */
  function otdrPortMetaFromNode(node) {
    if (!node || !node.closest) return null;
    var wrap = node.closest('.protruding-port[data-port-type]');
    if (!wrap) return null;
    var t = (wrap.getAttribute('data-port-type') || '').toLowerCase();
    if (t === 'apc') return { polish: 'APC', label: 'SmartOTDR · APC' };
    if (t === 'apc-live') return { polish: 'APC', label: 'SmartOTDR · APC LIVE' };
    if (t === 'vfl') return { polish: 'UPC', label: 'SmartOTDR · VFL' };
    return { polish: 'UPC', label: 'SmartOTDR' };
  }

  /** True when a plugged cord end is seated on a SmartOTDR port. */
  function isOtdrAttachment(att) {
    if (!att) return false;
    var id = String(att.olsId || att.opmId || att.id || att.portId || att.vflId || '');
    if (id.indexOf('otdr') >= 0 ||
        id.indexOf('port-apc') >= 0 ||
        id.indexOf('port-vfl') >= 0) {
      return true;
    }
    var label = att.label ? String(att.label) : '';
    return label.indexOf('SmartOTDR') >= 0;
  }

  function otdrPortIdFromAttachment(att) {
    if (!att || !isOtdrAttachment(att)) return null;
    return att.portId || att.olsId || att.opmId || att.vflId || null;
  }

  function normalizeOtdrAttachmentFields(att) {
    if (!att || !isOtdrAttachment(att)) return;
    if (!att.portId) {
      att.portId = att.olsId || att.opmId || att.vflId || null;
    }
    if (!att.otdrId && att.portId) {
      var match = String(att.portId).match(/^(otdr-machine-\d+)/);
      if (match) att.otdrId = match[1];
    }
  }

  function resolveOtdrPortWorld(att) {
    if (!att) return null;
    normalizeOtdrAttachmentFields(att);
    var portId = otdrPortIdFromAttachment(att);
    if (!portId) return null;
    var pw = null;
    if (global.FtthLab && typeof FtthLab.getOtdrPortWorld === 'function') {
      pw = FtthLab.getOtdrPortWorld(portId);
    }
    if (!pw && att.olsId && global.FtthLab && typeof FtthLab.getOlsPortWorld === 'function') {
      pw = FtthLab.getOlsPortWorld(att.olsId);
    }
    if (!pw && att.opmId && global.FtthLab && typeof FtthLab.getOpmPortWorld === 'function') {
      pw = FtthLab.getOpmPortWorld(att.opmId);
    }
    return pw;
  }

  function enrichOlsHitDeepSeat(hit) {
    if (!hit || hit.owner !== 'ols' || !hit.olsId) return hit;
    if (isOtdrAttachment({ olsId: hit.olsId, label: hit.label }) ||
        String(hit.olsId).indexOf('otdr') >= 0) {
      if (global.FtthLab && typeof FtthLab.getOtdrPortWorld === 'function') {
        var pwOtdr = FtthLab.getOtdrPortWorld(hit.olsId);
        if (pwOtdr) {
          hit.wx = pwOtdr.x;
          hit.wy = pwOtdr.y;
          hit.rot = 180;
          hit.deepSeat = true;
          return hit;
        }
      }
    }
    if (global.FtthLab && typeof FtthLab.getOlsPortWorld === 'function') {
      var pw = FtthLab.getOlsPortWorld(hit.olsId);
      if (pw) {
        hit.wx = pw.x;
        hit.wy = pw.y;
        hit.rot = 180;
        hit.deepSeat = true;
      }
    }
    return hit;
  }

  function olsPortScreenCenter(el) {
    if (!el) return null;
    var slot = el.querySelector('.lab-ols__adapter-slot, .lab-ols__sc-block') || el;
    var r = slot.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height * 0.25 };
  }

  /**
   * Magnetic OLS capture — proximity to metallic port even when cursor
   * is not directly over the hit-test element.
   */
  function findNearestOlsHit(clientX, clientY, maxPx) {
    maxPx = maxPx != null ? maxPx : olsMagnetRadius();
    var nodes = document.querySelectorAll('.lab-ols-port[data-ols-port]');
    var best = null;
    var bestD = maxPx;
    var i;
    for (i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var c = olsPortScreenCenter(node);
      if (!c) continue;
      var d = dist2(clientX, clientY, c.x, c.y);
      if (d <= bestD) {
        bestD = d;
        var olsId = node.getAttribute('data-ols-port');
        var otdrMeta = otdrPortMetaFromNode(node);
        best = {
          owner: 'ols',
          olsId: olsId,
          polish: otdrMeta ? otdrMeta.polish : 'UPC',
          connectorType: 'SC',
          label: otdrMeta ? otdrMeta.label : 'Viavi OLS-35 · SC adapter',
          el: node,
          screenDist: d,
        };
        enrichOlsHitDeepSeat(best);
      }
    }
    return best;
  }

  function oltApertureScreenCenter(el) {
    if (!el) return null;
    var face = el.querySelector('.lab-fx-port__cage') ||
      el.querySelector('.lab-fx-port__rail') ||
      el.querySelector('.lab-fx-port__module') || el;
    var r = face.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function findNearestOltHit(clientX, clientY, maxPx) {
    maxPx = maxPx != null ? maxPx : SFP_SNAP_PX;
    var nodes = document.querySelectorAll('.lab-fx-port[data-lab-slot][data-lab-sfp]');
    var best = null;
    var bestD = maxPx;
    var i;
    for (i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var c = oltApertureScreenCenter(node);
      if (!c) continue;
      var d = dist2(clientX, clientY, c.x, c.y);
      if (d > bestD) continue;
      bestD = d;
      var slot = parseInt(node.getAttribute('data-lab-slot'), 10);
      var port = parseInt(node.getAttribute('data-lab-sfp'), 10);
      var filled = node.classList.contains('is-active');
      var polish = node.classList.contains('is-apc') ? 'APC' : 'UPC';
      var center = clientToWorld(c.x, c.y);
      best = {
        owner: 'olt',
        slot: slot,
        oltPort: port,
        hasSfp: filled,
        reject: !filled,
        polish: polish,
        label: 'LT' + (slot < 10 ? '0' : '') + slot + '/P' + port,
        wx: center.x,
        wy: center.y,
        el: node,
        screenDist: d,
      };
    }
    return best;
  }

  function canDockHit(hit) {
    if (!hit) return false;
    if (hit.owner !== 'olt') return true;
    if (hit.reject || hit.hasSfp === false) return false;
    if (hit.el && hit.el.classList && !hit.el.classList.contains('is-active')) return false;
    return true;
  }

  function resolvePlugHit(clientX, clientY) {
    var hit = hitTestPort(clientX, clientY);
    if (hit && hit.owner === 'ols') {
      enrichOlsHitDeepSeat(hit);
      var c = olsPortScreenCenter(hit.el);
      if (c) hit.screenDist = dist2(clientX, clientY, c.x, c.y);
      return hit;
    }
    var ols = findNearestOlsHit(clientX, clientY);
    if (ols) return ols;
    var olt = findNearestOltHit(clientX, clientY);
    if (olt) return olt;
    return hit;
  }

  /**
   * While dragging: pull connector into OLS deep seat + force vertical (180°).
   * Returns 'lock' when inside auto-click radius, 'pull' when in magnet zone, else null.
   */
  function applyOlsMagneticPull(cord, end, hit, clientX, clientY) {
    if (!hit || hit.owner !== 'ols' || !cord) return null;
    enrichOlsHitDeepSeat(hit);
    var c = olsPortScreenCenter(hit.el);
    var d = hit.screenDist != null
      ? hit.screenDist
      : (c ? dist2(clientX, clientY, c.x, c.y) : 9999);
    var magnet = olsMagnetRadius();
    if (d > magnet) return null;
    if (hit.el) hit.el.classList.add('is-plug-target');
    var side = cord[endKey(end)];
    side.liveRot = 180;
    seatEndAtPort(cord, end, hit.wx, hit.wy);
    updateFiberPath(cord);
    if (d <= OLS_MAGNET_LOCK_PX) return 'lock';
    return 'pull';
  }

  /** Vertical ports: pick 0° or 180°. Coupler: keep horizontal face axis. */
  function resolveUprightPlugRotation(hit, cord, end) {
    if (hit && hit.owner === 'coupler') return portAlignedRotation(hit);
    /* OPM / VFL / OLS: cable always exits upward — ignore approach vector */
    if (isTopTestPort(hit)) return 180;
    /* Angled SFP cages seat along the module axis — never flip to upright */
    if (oltPortSeatRotation(hit) != null) return portAlignedRotation(hit);
    var base = portAlignedRotation(hit);
    var alt = base === 0 ? 180 : 0;
    var p = getEndWorld(cord, end);
    var dY = (hit && typeof hit.wy === 'number') ? (hit.wy - p.y) : 0;
    if (Math.abs(dY) < 1) return base;
    var preferred = headingRotFromMotionRaw(0, dY);
    var dBase = Math.abs(((preferred - base + 540) % 360) - 180);
    var dAlt = Math.abs(((preferred - alt + 540) % 360) - 180);
    return dAlt < dBase ? alt : base;
  }

  function getEndRotation(cord, end) {
    var side = cord[endKey(end)];
    if (side.attached) {
      if (typeof side.lockedRot === 'number') return side.lockedRot;
      if (side.attached && typeof side.attached.lockedRot === 'number') {
        side.lockedRot = side.attached.lockedRot;
        return side.lockedRot;
      }
    }
    /* Live drag heading (nose → motion) drives CSS rotate + bootAnchor */
    if (typeof side.liveRot === 'number') {
      /* Exact ±180 is the top-port (OPM/VFL) dock preview — do not clamp */
      if (side.liveRot === 180 || side.liveRot === -180) return 180;
      return clampUprightHeading(side.liveRot);
    }
    var p = getEndWorld(cord, end);
    var o = end === 'A' ? { x: cord.bx, y: cord.by } : { x: cord.ax, y: cord.ay };
    /* Free idle: boot toward cable, but never flip ferrule nose-down */
    return clampUprightHeading(endRotationDeg(p.x, p.y, o.x, o.y));
  }

  /** Apply smoothed motion heading while an end is free / being dragged. */
  function updateLiveHeading(cord, end, dx, dy) {
    var side = cord[endKey(end)];
    if (!side || side.attached) return;
    if (dist2(0, 0, dx, dy) < HEADING_MIN_PX) return;
    var target = headingRotFromMotion(dx, dy);
    if (typeof side.liveRot === 'number') {
      side.liveRot = clampUprightHeading(
        lerpAngleDeg(side.liveRot, target, HEADING_SMOOTH)
      );
    } else {
      side.liveRot = target;
    }
  }

  /** Seat on port: ferrule on the port face, boot aimed along the locked axis. */
  function seatEndAtPort(cord, end, portX, portY) {
    var side = cord[endKey(end)];
    var rot = getEndRotation(cord, end);
    if (side.attached && typeof side.lockedRot !== 'number') {
      side.lockedRot = rot;
      side.attached.lockedRot = rot;
    }
    var t = bootOutDir(rot);
    setEndWorld(cord, end, portX + t.x * BOOT_EXIT_OFFSET, portY + t.y * BOOT_EXIT_OFFSET);
  }

  /**
   * Exact rear tip of the ribbed boot in world space (uses current rotation,
   * including live drag heading).
   */
  function bootAnchor(cord, end) {
    var p = getEndWorld(cord, end);
    var rot = getEndRotation(cord, end);
    return localToWorld(p.x, p.y, 0, BOOT_EXIT_OFFSET, rot);
  }

  /** Short outward stub past the boot tip (compat / recording). */
  function bootExitStub(cord, end) {
    var tip = bootAnchor(cord, end);
    var t = bootOutDir(getEndRotation(cord, end));
    return {
      x: tip.x + t.x * BOOT_EXIT_STUB,
      y: tip.y + t.y * BOOT_EXIT_STUB,
    };
  }

  /**
   * Strict strain-relief chain: tip → mid → outer, all on the port/boot axis.
   * Length adapts to connector facing so opposing boots do not fold the span.
   */
  function strainReliefChain(cord, end) {
    var tip = bootAnchor(cord, end);
    var t = bootOutDir(getEndRotation(cord, end));
    var u = unitVec(t.x, t.y);
    var otherTip = end === 'A' ? bootAnchor(cord, 'B') : bootAnchor(cord, 'A');
    var otherDir = bootOutDir(getEndRotation(cord, end === 'A' ? 'B' : 'A'));
    var uOther = unitVec(otherDir.x, otherDir.y);
    var parallel = bootsParallelSameWay(u, uOther);
    var outD = adaptiveBootStubLength(
      u,
      tip,
      otherTip,
      Math.max(STRAIN_RELIEF_PX, BOOT_EXIT_STUB),
      parallel
    );
    var midD = outD * 0.45;
    return [
      tip,
      { x: tip.x + u.x * midD, y: tip.y + u.y * midD },
      { x: tip.x + u.x * outD, y: tip.y + u.y * outD },
    ];
  }

  /** Cosine of boot-out vs tip→other: +1 faces peer, −1 faces away. */
  function bootFacesToward(bootDir, fromTip, toTip) {
    var dx = toTip.x - fromTip.x;
    var dy = toTip.y - fromTip.y;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    return (bootDir.x * dx + bootDir.y * dy) / len;
  }

  /** Same-direction boots: dot(tA, tB) ≈ +1 (both exit parallel). */
  function bootsParallelSameWay(tA, tB) {
    return tA.x * tB.x + tA.y * tB.y > 0.65;
  }

  /**
   * Tip→tip chord that never falls back to a fake vertical when tips coincide.
   * Prefer average boot axis (lateral) then screen-down.
   */
  function safeTipChord(tipA, tipB, tA, tB) {
    var dx = tipB.x - tipA.x;
    var dy = tipB.y - tipA.y;
    if (dx * dx + dy * dy > 4) return unitVec(dx, dy);
    var sx = (tA.x + tB.x) * 0.5;
    var sy = (tA.y + tB.y) * 0.5;
    if (sx * sx + sy * sy > 1e-6) return unitVec(sx, sy);
    return { x: 1, y: 0 };
  }

  /** Unit vector in the downward hemisphere, perpendicular to `along` (screen y+ down). */
  function hangPerp(along) {
    var p = unitVec(-along.y, along.x);
    if (p.y < 0) p = { x: -p.x, y: -p.y };
    if (p.x * p.x + p.y * p.y < 1e-8) p = { x: 0, y: 1 };
    return p;
  }

  /**
   * Strain-relief stub length along boot axis.
   * Full length when facing the peer; shortened when reversed/sideways so
   * stubs do not cross or collapse the mid-span chord.
   * Parallel same-way boots use short stubs (avoid past-end hairpins).
   */
  function adaptiveBootStubLength(bootDir, tip, otherTip, baseStub, parallelSame) {
    var span = dist2(tip.x, tip.y, otherTip.x, otherTip.y) || 1;
    var face = bootFacesToward(bootDir, tip, otherTip);
    var scale;
    if (face >= 0.35) scale = 1;
    else if (face >= 0) scale = 0.55 + 0.45 * (face / 0.35);
    else scale = Math.max(0.28, 0.45 + face * 0.35);
    if (global.FtthLab && typeof FtthLab.adaptiveFiberStubScale === 'function') {
      scale = FtthLab.adaptiveFiberStubScale(face);
    }
    if (parallelSame) scale = Math.min(scale, 0.42);
    var len = baseStub * scale;
    var cap = Math.max(BOOT_EXIT_STUB * 0.75, span * 0.28);
    if (parallelSame) cap = Math.min(cap, Math.max(BOOT_EXIT_STUB, span * 0.16));
    return Math.max(BOOT_EXIT_STUB * 0.45, Math.min(len, cap));
  }

  /**
   * Extra cable length (fraction of tip span) when boots face away / reverse /
   * run parallel — room for a natural hang or lateral service loop.
   */
  function opposingOrientationSlackFraction(tA, tB, tipA, tipB) {
    var faceA = bootFacesToward(tA, tipA, tipB);
    var faceB = bootFacesToward(tB, tipB, tipA);
    if (global.FtthLab && typeof FtthLab.opposingFiberSlackFraction === 'function') {
      var base = FtthLab.opposingFiberSlackFraction(faceA, faceB);
      if (bootsParallelSameWay(tA, tB)) base += 0.18;
      return base;
    }
    var away = 0;
    if (faceA < 0.25) away += (0.25 - faceA) * 0.22;
    if (faceB < 0.25) away += (0.25 - faceB) * 0.22;
    if (bootsParallelSameWay(tA, tB)) away += 0.18;
    return away;
  }

  /**
   * Place mid-span catenary anchors from boot stubs.
   * Parallel same-way: hang anchors under the tip chord (lateral loop) so the
   * far stub never extends past B and forces a hairpin backtrack.
   * Overlap: open a minimum-width downward service loop (no fake vertical axis).
   */
  function resolveOrientedCatenaryAnchors(tipA, tipB, tA, tB, stubA, stubB) {
    var span = dist2(tipA.x, tipA.y, tipB.x, tipB.y);
    var chord = safeTipChord(tipA, tipB, tA, tB);
    var parallel = bootsParallelSameWay(tA, tB);
    var overlapped = span < 18;
    var down = hangPerp(chord);
    var drop = Math.min(52, Math.max(22, (overlapped ? 40 : span * 0.2) + (parallel ? 10 : 0)));

    var p0 = {
      x: tipA.x + tA.x * stubA,
      y: tipA.y + tA.y * stubA,
    };
    var p3 = {
      x: tipB.x + tB.x * stubB,
      y: tipB.y + tB.y * stubB,
    };

    if (overlapped) {
      var halfW = Math.max(32, Math.max(stubA, stubB) * 1.4);
      var cx = (tipA.x + tipB.x) * 0.5;
      var cy = (tipA.y + tipB.y) * 0.5;
      p0 = {
        x: cx - chord.x * halfW + down.x * drop,
        y: cy - chord.y * halfW + down.y * drop,
      };
      p3 = {
        x: cx + chord.x * halfW + down.x * drop,
        y: cy + chord.y * halfW + down.y * drop,
      };
      return { p0: p0, p3: p3, collapsed: true, parallel: parallel, overlapped: true };
    }

    if (parallel) {
      /* Lateral service loop under both tips — short axial lead then drop */
      var along = Math.min(Math.max(span * 0.18, 12), span * 0.35);
      var lead = Math.min(stubA, BOOT_EXIT_STUB);
      var leadB = Math.min(stubB, BOOT_EXIT_STUB);
      p0 = {
        x: tipA.x + tA.x * lead + chord.x * along * 0.35 + down.x * drop,
        y: tipA.y + tA.y * lead + chord.y * along * 0.35 + down.y * drop,
      };
      p3 = {
        x: tipB.x + tB.x * leadB - chord.x * along * 0.35 + down.x * drop,
        y: tipB.y + tB.y * leadB - chord.y * along * 0.35 + down.y * drop,
      };
      /* Keep mid chord open and progressing tipA→tipB */
      var midLen = dist2(p0.x, p0.y, p3.x, p3.y);
      var progress = (p3.x - p0.x) * chord.x + (p3.y - p0.y) * chord.y;
      if (midLen < Math.max(24, span * 0.25) || progress < span * 0.15) {
        p0 = {
          x: tipA.x + chord.x * (span * 0.12) + down.x * drop,
          y: tipA.y + chord.y * (span * 0.12) + down.y * drop,
        };
        p3 = {
          x: tipB.x - chord.x * (span * 0.12) + down.x * drop,
          y: tipB.y - chord.y * (span * 0.12) + down.y * drop,
        };
      }
      return { p0: p0, p3: p3, collapsed: true, parallel: true, overlapped: false };
    }

    return stabilizeCatenaryAnchors(tipA, tipB, tA, tB, p0, p3, chord);
  }

  /** Pull mid-span anchors apart along a safe tip chord when stubs would cross. */
  function stabilizeCatenaryAnchors(tipA, tipB, tA, tB, p0, p3, chordOpt) {
    var span = dist2(tipA.x, tipA.y, tipB.x, tipB.y) || 1;
    var chord = chordOpt || safeTipChord(tipA, tipB, tA, tB);
    var midLen = dist2(p0.x, p0.y, p3.x, p3.y);
    var progress = (p3.x - p0.x) * chord.x + (p3.y - p0.y) * chord.y;
    var collapsed = midLen < Math.max(14, span * 0.18) || progress < span * 0.12;
    if (!collapsed) {
      return { p0: p0, p3: p3, collapsed: false, parallel: false, overlapped: false };
    }
    var down = hangPerp(chord);
    var drop = Math.min(36, Math.max(10, span * 0.16));
    var along = Math.min(STRAIN_RELIEF_PX, span * 0.22);
    var n0 = {
      x: tipA.x + chord.x * along + tA.x * (BOOT_EXIT_STUB * 0.55) + down.x * drop * 0.45,
      y: tipA.y + chord.y * along + tA.y * (BOOT_EXIT_STUB * 0.55) + down.y * drop * 0.45,
    };
    var n3 = {
      x: tipB.x - chord.x * along + tB.x * (BOOT_EXIT_STUB * 0.55) + down.x * drop * 0.45,
      y: tipB.y - chord.y * along + tB.y * (BOOT_EXIT_STUB * 0.55) + down.y * drop * 0.45,
    };
    return {
      p0: { x: p0.x * 0.25 + n0.x * 0.75, y: p0.y * 0.25 + n0.y * 0.75 },
      p3: { x: p3.x * 0.25 + n3.x * 0.75, y: p3.y * 0.25 + n3.y * 0.75 },
      collapsed: true,
      parallel: false,
      overlapped: false,
    };
  }

  function blendUnitTan(primary, secondary, weightPrimary) {
    var w = Math.max(0, Math.min(1, weightPrimary));
    return unitVec(
      primary.x * w + secondary.x * (1 - w),
      primary.y * w + secondary.y * (1 - w)
    );
  }

  function naturalCatenaryTangents(mid) {
    if (!mid || mid.length < 2) {
      return { inTan: { x: 1, y: 0 }, outTan: { x: 1, y: 0 } };
    }
    var a = mid[0];
    var b = mid[Math.min(2, mid.length - 1)];
    var c = mid[Math.max(0, mid.length - 3)];
    var d = mid[mid.length - 1];
    return {
      inTan: unitVec(b.x - a.x, b.y - a.y),
      outTan: unitVec(d.x - c.x, d.y - c.y),
    };
  }

  /**
   * Boot-tangent blend weight. Parallel / fighting tangents defer to the
   * catenary so cubic handles do not form S-cusps at the anchors.
   */
  function bootTangentBlendWeight(face, opts) {
    opts = opts || {};
    if (opts.parallel || opts.overlapped) {
      return Math.max(0.12, Math.min(0.38, 0.22 + Math.max(0, face) * 0.2));
    }
    if (face >= 0.4) return 0.92;
    if (face >= 0) return 0.55 + face * 0.7;
    return Math.max(0.18, 0.45 + face * 0.3);
  }

  /**
   * Soften an end tangent when it fights the natural catenary direction
   * (dot < 0) — prevents forced anti-chord handles on parallel layouts.
   */
  function reconcileEndTangent(desired, natural, preferBoot) {
    var nat = natural || desired;
    var des = desired || nat;
    var d = des.x * nat.x + des.y * nat.y;
    if (d >= 0.15) {
      return blendUnitTan(des, nat, preferBoot);
    }
    /* Fighting: keep mostly natural, tiny boot influence for soft join */
    return blendUnitTan(nat, des, 0.82);
  }

  /** True if a sample sits inside/near a connector body (would pierce housing if used). */
  function pointInsideConnectorBody(cord, end, x, y) {
    var c = getEndWorld(cord, end);
    return dist2(c.x, c.y, x, y) < BODY_CLEAR_PX;
  }

  /** Default sag depth guess from span (used only to pick slack when no user ink). */
  function catenarySagDepth(dist) {
    return Math.min(
      GRAVITY_SAG_MAX,
      Math.max(GRAVITY_SAG_MIN * 0.45, dist * GRAVITY_SAG_RATIO)
    );
  }

  /**
   * Solve catenary scale a from:
   *   2 a sinh(h / (2 a)) = v
   * where h = horizontal span, v = sqrt(L² − Δy²) (physics / y-up frame).
   */
  function solveCatenaryA(h, v) {
    h = Math.abs(h);
    if (h < 1e-8 || v < h * 1.0000001) {
      /* Nearly taut — a → ∞; return large a for a near-straight span */
      return Math.max(h * 50, 1e6);
    }
    /* Initial guess from series: sinh(z)≈z+z³/6 ⇒ a ≈ h / sqrt(24*(v/h - 1)) */
    var r = v / h;
    var a = r > 1.0001
      ? h / Math.sqrt(Math.max(1e-8, 24 * (r - 1)))
      : h * 10;
    if (!isFinite(a) || a <= 0) a = h;
    var i;
    for (i = 0; i < 28; i++) {
      var half = h / (2 * a);
      if (half > 50) {
        a *= 2;
        continue;
      }
      var sh = Math.sinh(half);
      var ch = Math.cosh(half);
      var f = 2 * a * sh - v;
      var df = 2 * sh - (h / a) * ch;
      if (Math.abs(df) < 1e-14) break;
      var next = a - f / df;
      if (next <= 0 || !isFinite(next)) next = a * 0.5;
      if (Math.abs(next - a) < 1e-9 * Math.max(1, a)) {
        a = next;
        break;
      }
      a = next;
    }
    return Math.max(a, 1e-4);
  }

  /**
   * Fit y = y0 + a·cosh((x − x0)/a) through two endpoints with cable length L.
   * Coordinates are physics-frame (Y positive UP).
   * Near-vertical spans (|Δx| tiny) return a flag so the sampler can use a
   * chord-parameterized hang instead of a fake 0.75px x-nudge.
   */
  function fitCatenaryParamsYUp(x1, y1, x2, y2, length) {
    var h = x2 - x1;
    var v = y2 - y1;
    var chord = Math.sqrt(h * h + v * v) || 1;
    var L = Math.max(length, chord * 1.0002);
    var absH = Math.abs(h);
    if (absH < 8) {
      return {
        a: Math.max(chord * 0.35, 1),
        x0: 0.5 * (x1 + x2),
        y0: Math.min(y1, y2) - Math.max(chord * 0.2, 8),
        L: L,
        x1: x1,
        x2: x2,
        degenerateX: true,
      };
    }
    var span = Math.sqrt(L * L - v * v);
    if (!isFinite(span) || span < absH) {
      L = Math.sqrt(absH * absH + v * v) * 1.0002;
      span = Math.sqrt(Math.max(0, L * L - v * v));
    }
    var a = solveCatenaryA(absH, span);
    /* Vertex x-offset for unequal supports:
       x0 = ½ (x1 + x2 − a ln((L+v)/(L−v))) */
    var lv = Math.max(L - Math.abs(v), 1e-9);
    var x0 = 0.5 * (x1 + x2 - a * Math.log((L + v) / (L - v)));
    if (!isFinite(x0)) x0 = 0.5 * (x1 + x2);
    var y0 = y1 - a * Math.cosh((x1 - x0) / a);
    if (!isFinite(y0)) y0 = Math.min(y1, y2) - a;
    return { a: a, x0: x0, y0: y0, L: L, x1: x1, x2: x2, degenerateX: false };
  }

  /** Evaluate physics-frame catenary Y_up at horizontal x. */
  function evalCatenaryYUp(params, x) {
    return params.y0 + params.a * Math.cosh((x - params.x0) / params.a);
  }

  /**
   * Chord-parameterized downward hang for near-vertical / tiny-Δx spans.
   * Avoids the old fake horizontal cosh nudge that created parallel folds.
   */
  function sampleParametricHang(p0, p3, length, count) {
    count = Math.max(2, count || CATENARY_SAMPLES);
    var dx = p3.x - p0.x;
    var dy = p3.y - p0.y;
    var chord = Math.sqrt(dx * dx + dy * dy) || 1;
    var L = Math.max(length || chord * CATENARY_DEFAULT_SLACK, chord * 1.0002);
    var excess = Math.max(0, L - chord);
    var sag = Math.sqrt(Math.max(0, excess * chord * 0.5)) * 0.55;
    if (sag < 10) sag = Math.min(56, Math.max(14, chord * 0.38 + excess * 0.35));
    var pts = [];
    var i;
    for (i = 0; i < count; i++) {
      var t = count === 1 ? 0.5 : i / (count - 1);
      var drop = 4 * sag * t * (1 - t);
      pts.push({
        x: p0.x + dx * t,
        y: p0.y + dy * t + drop,
      });
    }
    pts[0] = { x: p0.x, y: p0.y };
    pts[count - 1] = { x: p3.x, y: p3.y };
    return enforceDownwardSag(pts);
  }

  /**
   * Sample a hanging span between screen-space points (y+ down).
   * Uses true cosh when |Δx| is healthy; otherwise a parametric hang.
   */
  function sampleTrueCatenary(p0, p3, length, count) {
    count = Math.max(2, count || CATENARY_SAMPLES);
    var chord = dist2(p0.x, p0.y, p3.x, p3.y) || 1;
    var L = Math.max(length || chord * CATENARY_DEFAULT_SLACK, chord * 1.0002);
    if (Math.abs(p3.x - p0.x) < 8) {
      return sampleParametricHang(p0, p3, L, count);
    }
    var x1 = p0.x;
    var x2 = p3.x;
    var y1up = -p0.y;
    var y2up = -p3.y;
    var params = fitCatenaryParamsYUp(x1, y1up, x2, y2up, L);
    if (params.degenerateX) {
      return sampleParametricHang(p0, p3, L, count);
    }
    /* a must stay positive so cosh hangs down in Y-up (= +Y sag on screen) */
    if (!(params.a > 0)) params.a = Math.abs(params.a) || 1;
    var pts = [];
    var i;
    for (i = 0; i < count; i++) {
      var t = count === 1 ? 0.5 : i / (count - 1);
      var x = x1 + (params.x2 - params.x1) * t;
      var yUp = evalCatenaryYUp(params, x);
      pts.push({ x: x, y: -yUp });
    }
    /* Exact endpoint lock (numeric cosh drift) */
    pts[0] = { x: p0.x, y: p0.y };
    pts[pts.length - 1] = { x: p3.x, y: p3.y };
    return enforceDownwardSag(pts);
  }

  /** Max drop below chord for a candidate length (screen y+ down). */
  function catenarySagForLength(p0, p3, length) {
    return routeSagDepth(sampleTrueCatenary(p0, p3, length, 36));
  }

  /**
   * Cable length whose true catenary reaches at least targetSag below the chord.
   */
  function catenaryLengthForSag(p0, p3, targetSag) {
    var chord = dist2(p0.x, p0.y, p3.x, p3.y) || 1;
    if (targetSag < 1) return chord * 1.002;
    var lo = chord * 1.0005;
    var hi = chord + Math.max(targetSag * 3.5, chord * 0.15);
    var guard = 0;
    while (catenarySagForLength(p0, p3, hi) < targetSag && guard < 18) {
      hi = chord + (hi - chord) * 1.35;
      guard += 1;
    }
    var i;
    for (i = 0; i < 26; i++) {
      var mid = (lo + hi) * 0.5;
      if (catenarySagForLength(p0, p3, mid) < targetSag) lo = mid;
      else hi = mid;
    }
    return (lo + hi) * 0.5;
  }

  /**
   * Fit a true catenary between relief tips using the user's drawn length and
   * sag depth (L ≥ user length and L ≥ length needed for user sag).
   * Returns mid-span points only (endpoints supplied by strain-relief chains).
   */
  function fitTrueCatenaryFromUser(p0, p3, route, count) {
    count = count || CATENARY_SAMPLES;
    var poly = [{ x: p0.x, y: p0.y }]
      .concat(route || [])
      .concat([{ x: p3.x, y: p3.y }]);
    var chord = dist2(p0.x, p0.y, p3.x, p3.y) || 1;
    var userLen = Math.max(polylineLength(poly), chord * 1.002);
    var userSag = routeSagDepth(poly);
    var L = userLen;
    if (userSag > 2) {
      L = Math.max(L, catenaryLengthForSag(p0, p3, userSag));
    } else {
      L = Math.max(L, chord * CATENARY_DEFAULT_SLACK);
    }
    L = Math.min(L, chord * 6);
    var full = sampleTrueCatenary(p0, p3, L, count);
    return full.slice(1, -1);
  }

  /** Default hanging span (no user ink) via true catenary + distance-scaled slack. */
  function naturalCatenarySamples(p0, p3, count) {
    var chord = dist2(p0.x, p0.y, p3.x, p3.y) || 1;
    var sag = catenarySagDepth(chord);
    var L = Math.max(
      chord * CATENARY_DEFAULT_SLACK,
      catenaryLengthForSag(p0, p3, sag)
    );
    return sampleTrueCatenary(p0, p3, L, count || CATENARY_SAMPLES);
  }

  /**
   * Fixed-length mid-span: always a true catenary.
   * Excess length (L > chord) becomes deeper downward gravitational sag — never loops.
   */
  function sampleFixedLengthSpan(p0, p3, lengthPx, count) {
    return sampleTrueCatenary(p0, p3, lengthPx, count);
  }

  function polylineLength(pts) {
    if (!pts || pts.length < 2) return 0;
    var len = 0;
    var i;
    for (i = 1; i < pts.length; i++) {
      len += dist2(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
    }
    return len;
  }

  /**
   * Max drop below the end-to-end chord (y+ down) — measures user sag depth.
   */
  function routeSagDepth(pts) {
    if (!pts || pts.length < 3) return 0;
    var a = pts[0];
    var b = pts[pts.length - 1];
    var dy = b.y - a.y;
    var cum = [0];
    var i;
    for (i = 1; i < pts.length; i++) {
      cum[i] = cum[i - 1] + dist2(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
    }
    var total = cum[cum.length - 1] || 1;
    var sag = 0;
    for (i = 1; i < pts.length - 1; i++) {
      var t = cum[i] / total;
      var cy = a.y + dy * t;
      var drop = pts[i].y - cy;
      if (drop > sag) sag = drop;
    }
    return sag;
  }

  /**
   * Gravity lock (screen y+ down): mid-span may never rise above the end-to-end
   * chord. Any upward bulge is mirrored to a positive downward offset.
   */
  function enforceDownwardSag(pts) {
    if (!pts || pts.length < 3) return pts ? pts.slice() : [];
    var a = pts[0];
    var b = pts[pts.length - 1];
    var n = pts.length;
    var out = new Array(n);
    out[0] = { x: a.x, y: a.y };
    out[n - 1] = { x: b.x, y: b.y };
    var i;
    for (i = 1; i < n - 1; i++) {
      var t = i / (n - 1);
      var cy = a.y + (b.y - a.y) * t;
      var y = pts[i].y;
      var drop = y - cy; /* >0 = below chord (gravity OK) */
      if (drop < 0) {
        /* Upward inversion — flip to equal downward sag */
        y = cy - drop;
      }
      out[i] = { x: pts[i].x, y: y };
    }
    return out;
  }

  /** Uniform Catmull-Rom sample on segment p1→p2 (t in [0,1]). */
  function catmullRomPoint(p0, p1, p2, p3, t) {
    var t2 = t * t;
    var t3 = t2 * t;
    return {
      x: 0.5 * (
        (2 * p1.x) +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
      ),
      y: 0.5 * (
        (2 * p1.y) +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
      ),
    };
  }

  /**
   * Densify an open polyline with Catmull-Rom samples that pass through every
   * waypoint — used for live free-hand polish before catenary lock.
   */
  function catmullRomResample(pts, samplesPerSeg) {
    if (!pts || pts.length < 2) return pts ? pts.slice() : [];
    if (pts.length === 2) {
      return samplePolyline(pts, Math.max(2, samplesPerSeg + 1));
    }
    samplesPerSeg = Math.max(2, samplesPerSeg || SPLINE_SAMPLES_PER_SEG);
    var out = [];
    var segs = pts.length - 1;
    var i;
    var s;
    for (i = 0; i < segs; i++) {
      var p0 = pts[i === 0 ? 0 : i - 1];
      var p1 = pts[i];
      var p2 = pts[i + 1];
      var p3 = pts[i + 2 < pts.length ? i + 2 : pts.length - 1];
      for (s = 0; s < samplesPerSeg; s++) {
        if (i > 0 && s === 0) continue;
        out.push(catmullRomPoint(p0, p1, p2, p3, s / samplesPerSeg));
      }
    }
    var last = pts[pts.length - 1];
    out.push({ x: last.x, y: last.y });
    return out;
  }

  /**
   * After any shrink-prone polish, restore chord-relative sag + path length
   * so the cable keeps the user's drawn depth instead of collapsing shallow.
   */
  function restoreRouteMetrics(smoothed, reference) {
    if (!smoothed || smoothed.length < 3 || !reference || reference.length < 2) {
      return smoothed;
    }
    var targetSag = routeSagDepth(reference);
    var targetLen = polylineLength(reference);
    var curSag = routeSagDepth(smoothed);
    var a = smoothed[0];
    var b = smoothed[smoothed.length - 1];
    var dx = b.x - a.x;
    var dy = b.y - a.y;
    var cum = [0];
    var i;
    for (i = 1; i < smoothed.length; i++) {
      cum[i] = cum[i - 1] + dist2(
        smoothed[i - 1].x, smoothed[i - 1].y,
        smoothed[i].x, smoothed[i].y
      );
    }
    var total = cum[cum.length - 1] || 1;
    var sagScale = curSag > 1e-3 ? targetSag / curSag : 1;
    if (sagScale > 0.99 && sagScale < 1.01 && Math.abs(polylineLength(smoothed) - targetLen) < 4) {
      return smoothed;
    }
    var out = [{ x: a.x, y: a.y }];
    for (i = 1; i < smoothed.length - 1; i++) {
      var t = cum[i] / total;
      var cx = a.x + dx * t;
      var cy = a.y + dy * t;
      var p = smoothed[i];
      var ox = p.x - cx;
      var oy = p.y - cy;
      /* Never restore an upward bulge — force positive downward offset */
      if (oy < 0) oy = -oy;
      out.push({
        x: cx + ox * sagScale,
        y: cy + oy * sagScale,
      });
    }
    out.push({ x: b.x, y: b.y });
    var newLen = polylineLength(out);
    if (newLen > 1e-3 && targetLen > 1e-3) {
      var lenScale = targetLen / newLen;
      if (Math.abs(lenScale - 1) > 0.02 && Math.abs(lenScale - 1) < 0.45) {
        var mid = [];
        mid.push({ x: a.x, y: a.y });
        for (i = 1; i < out.length - 1; i++) {
          var tt = cum[i] / total;
          var bx = a.x + dx * tt;
          var by = a.y + dy * tt;
          var mx = out[i].x - bx;
          var my = out[i].y - by;
          if (my < 0) my = -my;
          mid.push({
            x: bx + mx * lenScale,
            y: by + my * lenScale,
          });
        }
        mid.push({ x: b.x, y: b.y });
        return enforceDownwardSag(mid);
      }
    }
    return enforceDownwardSag(out);
  }

  function ensureRoute(cord) {
    if (!cord.route) cord.route = [];
    return cord.route;
  }

  /**
   * Record the mouse trail while the free end is dragged (first-time routing only).
   * Relocate / fixed-length mode never appends — length stays locked.
   */
  function appendRoutePoint(cord, x, y) {
    if (!cord || cord.pathLocked || cord.relocating) return false;
    if (typeof cord.fixedLength === 'number') return false;
    var route = ensureRoute(cord);
    var last = route[route.length - 1];
    if (!last) {
      route.push({ x: x, y: y });
      return true;
    }
    if (dist2(last.x, last.y, x, y) < TRACE_SAMPLE_PX) return false;
    route.push({ x: x, y: y });
    if (route.length > TRACE_MAX_POINTS * 2) {
      cord.route = downsampleRoute(route, TRACE_MAX_POINTS);
    }
    return true;
  }

  function downsampleRoute(pts, maxN) {
    if (!pts || pts.length <= maxN) return pts || [];
    var out = [];
    var step = (pts.length - 1) / (maxN - 1);
    var i;
    for (i = 0; i < maxN; i++) {
      var idx = Math.round(i * step);
      out.push({ x: pts[idx].x, y: pts[idx].y });
    }
    return out;
  }

  /** Drop near-duplicate vertices before spline polish (keeps endpoints). */
  function simplifyRouteMinDist(pts, minDist) {
    if (!pts || pts.length < 3) return pts ? pts.slice() : [];
    var out = [{ x: pts[0].x, y: pts[0].y }];
    var i;
    for (i = 1; i < pts.length - 1; i++) {
      var prev = out[out.length - 1];
      if (dist2(prev.x, prev.y, pts[i].x, pts[i].y) >= minDist) {
        out.push({ x: pts[i].x, y: pts[i].y });
      }
    }
    var last = pts[pts.length - 1];
    if (dist2(out[out.length - 1].x, out[out.length - 1].y, last.x, last.y) < 0.5) {
      out[out.length - 1] = { x: last.x, y: last.y };
    } else {
      out.push({ x: last.x, y: last.y });
    }
    return out;
  }

  /**
   * Chaikin's corner-cutting on an open polyline (endpoints preserved).
   * Softens jagged hand-drawn corners — may shorten; pair with restoreRouteMetrics.
   */
  function chaikinSmooth(pts, iterations) {
    if (!pts || pts.length < 3) return pts ? pts.slice() : [];
    iterations = iterations == null ? CHAIKIN_ITERATIONS : iterations;
    var curr = pts.slice();
    var n;
    for (n = 0; n < iterations; n++) {
      if (curr.length < 3) break;
      var next = [{ x: curr[0].x, y: curr[0].y }];
      var i;
      for (i = 0; i < curr.length - 1; i++) {
        var p = curr[i];
        var q = curr[i + 1];
        next.push({
          x: 0.75 * p.x + 0.25 * q.x,
          y: 0.75 * p.y + 0.25 * q.y,
        });
        next.push({
          x: 0.25 * p.x + 0.75 * q.x,
          y: 0.25 * p.y + 0.75 * q.y,
        });
      }
      next.push({
        x: curr[curr.length - 1].x,
        y: curr[curr.length - 1].y,
      });
      curr = next;
    }
    return curr;
  }

  /**
   * Polish user ink: simplify jitter → Catmull-Rom densify (shape/depth kept).
   * Optional light Chaikin + metric restore for extra silk without shallow collapse.
   */
  function smoothDrawnRoute(cord, opts) {
    opts = opts || {};
    if (!cord || (cord.pathLocked && !opts.force)) return;
    var route = ensureRoute(cord);
    if (route.length < 2) return;
    var reference = route.map(function (p) {
      return { x: p.x, y: p.y };
    });
    route = simplifyRouteMinDist(route, TRACE_SAMPLE_PX * 0.65);
    if (route.length < 2) {
      cord.route = reference;
      return;
    }
    var perSeg = opts.samplesPerSeg != null ? opts.samplesPerSeg : SPLINE_SAMPLES_PER_SEG;
    route = catmullRomResample(route, perSeg);
    var chaikinIters = opts.iterations != null ? opts.iterations : 0;
    if (chaikinIters > 0 && route.length >= 3) {
      route = chaikinSmooth(route, Math.min(chaikinIters, 2));
      route = restoreRouteMetrics(route, reference);
    }
    if (route.length > TRACE_MAX_POINTS) {
      route = downsampleRoute(route, TRACE_MAX_POINTS);
      route = restoreRouteMetrics(route, reference);
    }
    cord.route = route;
  }

  /**
   * Arc length of current span from strain-relief tip A → route → tip B.
   */
  function measureCableSpanLength(cord) {
    if (!cord) return 0;
    var ends = reliefSpanEnds(cord);
    var poly = [{ x: ends.a.x, y: ends.a.y }]
      .concat(ensureRoute(cord))
      .concat([{ x: ends.b.x, y: ends.b.y }]);
    var chord = dist2(ends.a.x, ends.a.y, ends.b.x, ends.b.y) || 1;
    return Math.max(polylineLength(poly), chord * 1.002);
  }

  /**
   * Resolve the immutable cable length for catenary fitting.
   * Never grows on relocate; only set once on first full connect.
   */
  function resolveFixedCableLength(cord, p0, p3, route) {
    var chord = dist2(p0.x, p0.y, p3.x, p3.y) || 1;
    if (isMeterMode(cord)) {
      cord.lengthMeters = normalizeLengthMeters(cord.lengthMeters || 3);
      cord.fixedLength = metersToPx(cord.lengthMeters);
      if (chord >= cord.fixedLength) return chord * 1.0002;
      return cord.fixedLength;
    }
    if (typeof cord.fixedLength === 'number' && cord.fixedLength > 0) {
      if (chord >= cord.fixedLength) return chord * 1.0002; /* taut — ports at max reach */
      return cord.fixedLength;
    }
    var poly = [{ x: p0.x, y: p0.y }].concat(route || []).concat([{ x: p3.x, y: p3.y }]);
    var userLen = Math.max(polylineLength(poly), chord * 1.002);
    var userSag = routeSagDepth(poly);
    var L = userLen;
    if (userSag > 2) L = Math.max(L, catenaryLengthForSag(p0, p3, userSag));
    else L = Math.max(L, chord * CATENARY_DEFAULT_SLACK);
    L = Math.min(L, chord * 6);
    cord.fixedLength = L;
    return L;
  }

  /** Keep free connector within fixedLength of the anchored relief tip. */
  function clampFreeEndToFixedLength(cord, freeEnd) {
    if (!cord || typeof cord.fixedLength !== 'number') return;
    var other = oppositeEnd(freeEnd);
    if (!cord[endKey(other)].attached) return;
    var L = cord.fixedLength;
    var anchTip = bootAnchor(cord, other);
    var freeTip = bootAnchor(cord, freeEnd);
    var dx = freeTip.x - anchTip.x;
    var dy = freeTip.y - anchTip.y;
    var d = Math.sqrt(dx * dx + dy * dy) || 1;
    if (d <= L * 0.999) return;
    var s = (L * 0.998) / d;
    var newTipX = anchTip.x + dx * s;
    var newTipY = anchTip.y + dy * s;
    var t = bootOutDir(getEndRotation(cord, freeEnd));
    setEndWorld(
      cord,
      freeEnd,
      newTipX - t.x * BOOT_EXIT_OFFSET,
      newTipY - t.y * BOOT_EXIT_OFFSET
    );
  }

  /**
   * Rebuild mid-span as a true catenary at the cord's locked length (tether preview).
   */
  function rebuildFixedLengthCatenary(cord) {
    if (!cord || typeof cord.fixedLength !== 'number') return;
    var ends = reliefSpanEnds(cord);
    var chord = dist2(ends.a.x, ends.a.y, ends.b.x, ends.b.y) || 1;
    var L = cord.fixedLength;
    if (chord >= L) L = chord * 1.0002;
    var full = sampleFixedLengthSpan(ends.a, ends.b, L, CATENARY_SAMPLES);
    cord.route = full.slice(1, -1);
    cord.pathLocked = true;
  }

  /** Slack used when laying out Meter Mode free/semi-bound spans (more = deeper sag). */
  var METER_SAG_SLACK = 1.32;

  /** Chord length that leaves a strong share of L for downward catenary sag. */
  function meterChordTarget(L) {
    L = Math.max(Number(L) || 0, 12);
    /* ~24% of length reserved for hang — small meter steps read as deeper sag */
    var chord = L / METER_SAG_SLACK;
    if (chord > L * 0.88) chord = L * 0.82;
    if (chord < 20) chord = Math.min(L * 0.85, Math.max(16, L - 8));
    return chord;
  }

  /** Place connector so its boot tip sits at (tipX, tipY) with boot aimed at aim. */
  function seatBootTipAt(cord, end, tipX, tipY, aimX, aimY) {
    var side = cord[endKey(end)];
    if (!side.attached) {
      side.liveRot = clampUprightHeading(endRotationDeg(tipX, tipY, aimX, aimY));
    }
    var t = bootOutDir(getEndRotation(cord, end));
    setEndWorld(
      cord,
      end,
      tipX - t.x * BOOT_EXIT_OFFSET,
      tipY - t.y * BOOT_EXIT_OFFSET
    );
  }

  /**
   * Meter Mode layout for any plug state:
   *  - both plugged → deepen/shallow catenary sag between fixed ports
   *  - one free → extend/retract free-tail vector, then hang at full L
   *  - both free → scale A↔B span, then hang at full L
   */
  function layoutMeterLengthGeometry(cord) {
    if (!cord || typeof cord.fixedLength !== 'number') return;
    var L = cord.fixedLength;
    var aOn = !!cord.sideA.attached;
    var bOn = !!cord.sideB.attached;
    var chordTarget = meterChordTarget(L);

    if (aOn && bOn) {
      rebuildFixedLengthCatenary(cord);
      return;
    }

    if (aOn !== bOn) {
      var freeEnd = aOn ? 'B' : 'A';
      var fixedEnd = aOn ? 'A' : 'B';
      var anch = bootAnchor(cord, fixedEnd);
      var freeTip = bootAnchor(cord, freeEnd);
      var dx = freeTip.x - anch.x;
      var dy = freeTip.y - anch.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      var ux;
      var uy;
      if (d < 10) {
        var out = bootOutDir(getEndRotation(cord, fixedEnd));
        ux = out.x;
        uy = out.y;
      } else {
        ux = dx / d;
        uy = dy / d;
      }
      seatBootTipAt(
        cord,
        freeEnd,
        anch.x + ux * chordTarget,
        anch.y + uy * chordTarget,
        anch.x,
        anch.y
      );
      rebuildFixedLengthCatenary(cord);
      return;
    }

    /* Both free — grow/shrink along current A→B axis about midpoint */
    var tipA = bootAnchor(cord, 'A');
    var tipB = bootAnchor(cord, 'B');
    var mx = (tipA.x + tipB.x) * 0.5;
    var my = (tipA.y + tipB.y) * 0.5;
    var abx = tipB.x - tipA.x;
    var aby = tipB.y - tipA.y;
    var abd = Math.sqrt(abx * abx + aby * aby);
    var ux2;
    var uy2;
    if (abd < 10) {
      ux2 = 0;
      uy2 = 1;
    } else {
      ux2 = abx / abd;
      uy2 = aby / abd;
    }
    var half = chordTarget * 0.5;
    seatBootTipAt(cord, 'A', mx - ux2 * half, my - uy2 * half, mx + ux2 * half, my + uy2 * half);
    seatBootTipAt(cord, 'B', mx + ux2 * half, my + uy2 * half, mx - ux2 * half, my - uy2 * half);
    rebuildFixedLengthCatenary(cord);
  }

  function applyMeterLengthToCord(cord) {
    if (!cord || !isMeterMode(cord)) return;
    cord.lengthMeters = normalizeLengthMeters(cord.lengthMeters || 3);
    cord.fixedLength = metersToPx(cord.lengthMeters);
    cord.pathLocked = true;
    cord.relocating = false;
    syncAttachedPositions(cord);
    layoutMeterLengthGeometry(cord);
  }

  function setLengthMode(id, mode) {
    var cord = findCord(id);
    if (!cord) return;
    mode = mode === 'meter' ? 'meter' : 'free';
    if (cord.lengthMode === mode) {
      updateInspector();
      return;
    }
    cord.lengthMode = mode;
    clearRopePhysics(cord.id);
    if (mode === 'meter') {
      if (typeof cord.lengthMeters !== 'number') {
        cord.lengthMeters = typeof cord.fixedLength === 'number'
          ? normalizeLengthMeters(pxToMeters(cord.fixedLength))
          : 3;
      }
      applyMeterLengthToCord(cord);
      setStatus(
        'Meter Mode · ' + cord.lengthMeters + ' m · mid-span drag disabled · excess length → deeper sag'
      );
    } else {
      /* Free Draw — keep physical length if known; restore hanging catenary */
      if (typeof cord.fixedLength === 'number' &&
          cord.sideA.attached && cord.sideB.attached) {
        var ends = reliefSpanEnds(cord);
        var chord = dist2(ends.a.x, ends.a.y, ends.b.x, ends.b.y) || 1;
        var L = cord.fixedLength;
        if (chord >= L) L = chord * 1.0002;
        var full = sampleTrueCatenary(ends.a, ends.b, L, CATENARY_SAMPLES);
        cord.route = full.slice(1, -1);
        cord.pathLocked = true;
      }
      setStatus('Free Draw · drag ends to route · stretch mid-span when both ports are linked');
    }
    rebuildLayer();
    updateInspector();
    pushHistory();
  }

  function setLengthUnit(id, unit) {
    var cord = findCord(id);
    if (!cord) return;
    cord.lengthUnit = unit === 'km' ? 'km' : 'm';
    updateInspector();
  }

  function setLengthMeters(id, meters, unit) {
    var cord = findCord(id);
    if (!cord) return;
    cord.lengthMode = 'meter';
    if (unit) cord.lengthUnit = unit === 'km' ? 'km' : 'm';
    cord.lengthMeters = normalizeLengthMeters(
      typeof unit === 'string'
        ? cordLengthInputToMeters(meters, unit)
        : meters
    );
    cord.otdrCableLengthM = cord.lengthMeters;
    clearRopePhysics(cord.id);
    applyMeterLengthToCord(cord);
    /* Instant canvas update — geometry already rebuilt above */
    rebuildLayer();
    updateFiberPath(cord);
    updateInspector();
    pushHistory();
    setStatus('Cable length · ' + cord.lengthMeters + ' m');
  }

  /** True if both seated relief tips fit within the locked cable length. */
  function spanFitsFixedLength(cord) {
    if (typeof cord.fixedLength !== 'number') return true;
    var ends = reliefSpanEnds(cord);
    var chord = dist2(ends.a.x, ends.a.y, ends.b.x, ends.b.y) || 0;
    return chord <= cord.fixedLength * 0.998;
  }

  /**
   * Full connection: fit true catenary between strain-relief tips at fixedLength.
   * First connect captures length; relocates reuse it — never accumulate.
   */
  function lockDrawnPath(cord) {
    if (!cord) return;
    cord.pathLocked = false;
    var aChain = strainReliefChain(cord, 'A');
    var bChain = strainReliefChain(cord, 'B');
    var aOuter = aChain[aChain.length - 1];
    var bOuter = bChain[bChain.length - 1];
    var route = ensureRoute(cord);
    var L = resolveFixedCableLength(
      cord,
      aOuter,
      bOuter,
      route.length ? route : null
    );
    var full = sampleFixedLengthSpan(aOuter, bOuter, L, CATENARY_SAMPLES, cord);
    cord.route = full.slice(1, -1);
    if (cord.route.length > TRACE_MAX_POINTS) {
      cord.route = downsampleRoute(cord.route, TRACE_MAX_POINTS);
    }
    cord.pathLocked = true;
    cord.relocating = false;
  }

  function clearRopePhysics(cordId) {
    if (!cordId || !ropePhysics[cordId]) return;
    ropePhysics[cordId].settling = false;
    delete ropePhysics[cordId];
  }

  function clearAllRopePhysics() {
    Object.keys(ropePhysics).forEach(function (id) {
      ropePhysics[id].settling = false;
    });
    ropePhysics = {};
    if (physRafId) {
      cancelAnimationFrame(physRafId);
      physRafId = 0;
    }
  }

  function reliefSpanEnds(cord) {
    var aChain = strainReliefChain(cord, 'A');
    var bChain = strainReliefChain(cord, 'B');
    return {
      a: aChain[aChain.length - 1],
      b: bChain[bChain.length - 1],
    };
  }

  /** Evenly resample a polyline to n points (arc-length). */
  function samplePolyline(pts, n) {
    if (!pts || pts.length < 2 || n < 2) return pts ? pts.slice() : [];
    var cum = [0];
    var i;
    for (i = 1; i < pts.length; i++) {
      cum[i] = cum[i - 1] + dist2(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
    }
    var total = cum[cum.length - 1] || 1;
    var out = [];
    for (var k = 0; k < n; k++) {
      var target = (k / (n - 1)) * total;
      var j = 1;
      while (j < cum.length - 1 && cum[j] < target) j += 1;
      var seg = cum[j] - cum[j - 1] || 1;
      var t = (target - cum[j - 1]) / seg;
      out.push({
        x: pts[j - 1].x + (pts[j].x - pts[j - 1].x) * t,
        y: pts[j - 1].y + (pts[j].y - pts[j - 1].y) * t,
      });
    }
    return out;
  }

  function refreshRopeRest(cord, rope) {
    /* Prefer the user's / pre-stretch shape; only fall back to catenary if empty */
    if (rope.grabBase && rope.grabBase.length === rope.particles.length) {
      bindRopeRestToPoints(rope, rope.grabBase);
      return;
    }
    var ends = reliefSpanEnds(cord);
    var shaped = [];
    var route = ensureRoute(cord);
    if (route.length >= 1) {
      shaped = samplePolyline(
        [{ x: ends.a.x, y: ends.a.y }].concat(route).concat([{ x: ends.b.x, y: ends.b.y }]),
        rope.particles.length
      );
    } else {
      shaped = naturalCatenarySamples(ends.a, ends.b, rope.particles.length);
    }
    bindRopeRestToPoints(rope, shaped);
  }

  function bindRopeRestToPoints(rope, pts) {
    if (!rope || !pts || pts.length !== rope.particles.length) return;
    var i;
    for (i = 0; i < pts.length; i++) {
      rope.particles[i].ox = pts[i].x;
      rope.particles[i].oy = pts[i].y;
    }
    for (i = 0; i < pts.length - 1; i++) {
      rope.lens[i] = dist2(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y) || 1;
    }
  }

  function buildRopeFromCord(cord) {
    var ends = reliefSpanEnds(cord);
    var n = PHYS_SEGMENTS;
    var route = ensureRoute(cord);
    var poly;
    if (route.length >= 1) {
      poly = samplePolyline(
        [{ x: ends.a.x, y: ends.a.y }].concat(route).concat([{ x: ends.b.x, y: ends.b.y }]),
        n
      );
    } else {
      poly = naturalCatenarySamples(ends.a, ends.b, n);
    }
    /* Rest pose = current custom span (not a shallow default catenary) */
    var rest = poly.map(function (p) {
      return { x: p.x, y: p.y };
    });
    var particles = [];
    var lens = [];
    var i;
    for (i = 0; i < n; i++) {
      particles.push({
        x: poly[i].x,
        y: poly[i].y,
        px: poly[i].x,
        py: poly[i].y,
        ox: rest[i].x,
        oy: rest[i].y,
        pinned: i === 0 || i === n - 1,
      });
    }
    for (i = 0; i < n - 1; i++) {
      /* Prefer live span lengths while stretching; settle retargets to rest shape */
      lens.push(dist2(poly[i].x, poly[i].y, poly[i + 1].x, poly[i + 1].y) || 1);
    }
    return {
      particles: particles,
      lens: lens,
      grabIdx: -1,
      grabBase: null,
      settling: false,
      frames: 0,
    };
  }

  function writeRopeToRoute(cord, rope) {
    var ends = reliefSpanEnds(cord);
    var mid = [];
    var i;
    for (i = 1; i < rope.particles.length - 1; i++) {
      mid.push({ x: rope.particles[i].x, y: rope.particles[i].y });
    }
    var full = enforceDownwardSag(
      [{ x: ends.a.x, y: ends.a.y }].concat(mid).concat([{ x: ends.b.x, y: ends.b.y }])
    );
    cord.route = full.slice(1, -1);
    cord.pathLocked = true;
  }

  function pinRopeEnds(cord, rope) {
    var ends = reliefSpanEnds(cord);
    var a = rope.particles[0];
    var b = rope.particles[rope.particles.length - 1];
    a.x = a.px = ends.a.x;
    a.y = a.py = ends.a.y;
    b.x = b.px = ends.b.x;
    b.y = b.py = ends.b.y;
  }

  function findNearestRopeIndex(rope, wx, wy) {
    var best = 1;
    var bestD = Infinity;
    var i;
    for (i = 1; i < rope.particles.length - 1; i++) {
      var p = rope.particles[i];
      var d = dist2(p.x, p.y, wx, wy);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  /** Elastic rubber-band pull from pre-grab snapshot toward the pointer. */
  function applyRopeGrab(rope, wx, wy) {
    var g = rope.grabIdx;
    var base = rope.grabBase;
    if (g < 0 || !base) return;
    var dx = wx - base[g].x;
    var dy = wy - base[g].y;
    var sigma = PHYS_GRAB_SIGMA;
    var i;
    for (i = 1; i < rope.particles.length - 1; i++) {
      var w = Math.exp(-((i - g) * (i - g)) / (2 * sigma * sigma));
      var pull = i === g ? 1 : w * PHYS_GRAB_NEIGHBOR;
      var p = rope.particles[i];
      p.x = base[i].x + dx * pull;
      p.y = base[i].y + dy * pull;
      p.px = p.x;
      p.py = p.y;
    }
    /* Soft length constraints so neighbors feel springy while stretching */
    for (var it = 0; it < 3; it++) {
      solveRopeConstraints(rope, true);
    }
    collideRopeWithSpools(rope);
  }

  function solveRopeConstraints(rope, protectGrab) {
    var pts = rope.particles;
    var i;
    for (i = 0; i < rope.lens.length; i++) {
      var p1 = pts[i];
      var p2 = pts[i + 1];
      var dx = p2.x - p1.x;
      var dy = p2.y - p1.y;
      var d = Math.sqrt(dx * dx + dy * dy) || 1;
      var diff = ((d - rope.lens[i]) / d) * PHYS_STRUCT_STRENGTH * 0.5;
      var move1 = !p1.pinned && !(protectGrab && i === rope.grabIdx);
      var move2 = !p2.pinned && !(protectGrab && (i + 1) === rope.grabIdx);
      if (move1 && move2) {
        p1.x += dx * diff;
        p1.y += dy * diff;
        p2.x -= dx * diff;
        p2.y -= dy * diff;
      } else if (move1) {
        p1.x += dx * diff * 2;
        p1.y += dy * diff * 2;
      } else if (move2) {
        p2.x -= dx * diff * 2;
        p2.y -= dy * diff * 2;
      }
    }
  }

  function stepRope(rope) {
    var pts = rope.particles;
    var i;
    var a = pts[0];
    var b = pts[pts.length - 1];
    for (i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (p.pinned) continue;
      var vx = (p.x - p.px) * PHYS_DAMPING;
      var vy = (p.y - p.py) * PHYS_DAMPING;
      p.px = p.x;
      p.py = p.y;
      p.x += vx;
      p.y += vy;
      p.x += (p.ox - p.x) * PHYS_REST_SPRING;
      p.y += (p.oy - p.y) * PHYS_REST_SPRING;
    }
    /* Gravity clamp: no particle may sit above the end-to-end chord */
    for (i = 1; i < pts.length - 1; i++) {
      var q = pts[i];
      var t = i / (pts.length - 1);
      var cy = a.y + (b.y - a.y) * t;
      if (q.y < cy) {
        q.y = cy + (cy - q.y);
        if (q.py < cy) q.py = cy;
      }
    }
    for (var it = 0; it < PHYS_STRUCT_ITERS; it++) {
      solveRopeConstraints(rope, false);
    }
    collideRopeWithSpools(rope);
  }

  function ropeEnergy(rope) {
    var e = 0;
    var i;
    for (i = 1; i < rope.particles.length - 1; i++) {
      var p = rope.particles[i];
      e += Math.abs(p.x - p.px) + Math.abs(p.y - p.py);
      e += (Math.abs(p.x - p.ox) + Math.abs(p.y - p.oy)) * 0.12;
    }
    return e;
  }

  function snapRopeToRest(rope) {
    var i;
    for (i = 0; i < rope.particles.length; i++) {
      var p = rope.particles[i];
      p.x = p.px = p.ox;
      p.y = p.py = p.oy;
    }
  }

  function ensurePhysLoop() {
    if (physRafId) return;
    function tick() {
      physRafId = 0;
      var any = false;
      var settledIds = [];
      cords.forEach(function (c) {
        var rope = ropePhysics[c.id];
        if (!rope || !rope.settling) return;
        if (!(c.sideA.attached && c.sideB.attached)) {
          rope.settling = false;
          return;
        }
        pinRopeEnds(c, rope);
        var s;
        for (s = 0; s < PHYS_SUBSTEPS; s++) stepRope(rope);
        writeRopeToRoute(c, rope);
        updateFiberPath(c);
        rope.frames += 1;
        if (ropeEnergy(rope) < PHYS_SETTLE_EPS || rope.frames > PHYS_MAX_SETTLE) {
          if (typeof c.fixedLength === 'number' &&
              c.sideA.attached && c.sideB.attached) {
            rebuildFixedLengthCatenary(c);
          } else {
            snapRopeToRest(rope);
            writeRopeToRoute(c, rope);
          }
          updateFiberPath(c);
          rope.settling = false;
          settledIds.push(c.id);
        } else {
          any = true;
        }
      });
      if (settledIds.length && !historyLocked) pushHistory();
      if (any) physRafId = requestAnimationFrame(tick);
    }
    physRafId = requestAnimationFrame(tick);
  }

  function beginRopeSettle(cord) {
    var rope = ropePhysics[cord.id];
    if (!rope) return;
    /* Prefer locked cable length catenary as rest pose */
    if (typeof cord.fixedLength === 'number' &&
        cord.sideA.attached && cord.sideB.attached) {
      var ends = reliefSpanEnds(cord);
      var chord = dist2(ends.a.x, ends.a.y, ends.b.x, ends.b.y) || 1;
      var L = cord.fixedLength;
      if (chord >= L) L = chord * 1.0002;
      bindRopeRestToPoints(
        rope,
        sampleFixedLengthSpan(ends.a, ends.b, L, rope.particles.length, cord)
      );
    } else if (rope.grabBase) {
      bindRopeRestToPoints(rope, rope.grabBase);
    } else {
      refreshRopeRest(cord, rope);
    }
    pinRopeEnds(cord, rope);
    var i;
    for (i = 1; i < rope.particles.length - 1; i++) {
      var p = rope.particles[i];
      p.px = p.x - (p.ox - p.x) * PHYS_RELEASE_KICK;
      p.py = p.y - (p.oy - p.y) * PHYS_RELEASE_KICK;
    }
    rope.grabIdx = -1;
    rope.settling = true;
    rope.frames = 0;
    ensurePhysLoop();
  }

  /**
   * Start interactive mid-span stretch on a fully connected cord.
   */
  function beginRopeGrab(cord, wx, wy) {
    clearRopePhysics(cord.id);
    var rope = buildRopeFromCord(cord);
    pinRopeEnds(cord, rope);
    rope.grabIdx = findNearestRopeIndex(rope, wx, wy);
    rope.grabBase = rope.particles.map(function (p) {
      return { x: p.x, y: p.y };
    });
    bindRopeRestToPoints(rope, rope.grabBase);
    rope.settling = false;
    ropePhysics[cord.id] = rope;
    applyRopeGrab(rope, wx, wy);
    writeRopeToRoute(cord, rope);
    return rope;
  }

  function buildCablePoints(cord) {
    var aChain = strainReliefChain(cord, 'A');
    var bChain = strainReliefChain(cord, 'B');
    var a = aChain[0];
    var b = bChain[0];
    var aOuter = aChain[aChain.length - 1];
    var bOuter = bChain[bChain.length - 1];
    var aDir = bootOutDir(getEndRotation(cord, 'A'));
    var bDir = bootOutDir(getEndRotation(cord, 'B'));
    var route = ensureRoute(cord).slice();

    if (route.length >= 1) {
      var dFirstA = dist2(route[0].x, route[0].y, a.x, a.y);
      var dLastA = dist2(route[route.length - 1].x, route[route.length - 1].y, a.x, a.y);
      if (dLastA < dFirstA) route.reverse();
    }

    var clearR = STRAIN_RELIEF_PX + 2;
    var cleaned = [];
    var i;
    for (i = 0; i < route.length; i++) {
      var p = route[i];
      if (pointInsideConnectorBody(cord, 'A', p.x, p.y)) continue;
      if (pointInsideConnectorBody(cord, 'B', p.x, p.y)) continue;
      /* Keep mid-span clear of the straight strain-relief zones */
      if ((p.x - a.x) * aDir.x + (p.y - a.y) * aDir.y < clearR &&
          dist2(p.x, p.y, a.x, a.y) < clearR + 8) continue;
      if ((p.x - b.x) * bDir.x + (p.y - b.y) * bDir.y < clearR &&
          dist2(p.x, p.y, b.x, b.y) < clearR + 8) continue;
      if (dist2(p.x, p.y, a.x, a.y) < 4) continue;
      if (dist2(p.x, p.y, b.x, b.y) < 4) continue;
      if (dist2(p.x, p.y, aOuter.x, aOuter.y) < 3) continue;
      if (dist2(p.x, p.y, bOuter.x, bOuter.y) < 3) continue;
      if (cleaned.length &&
          dist2(cleaned[cleaned.length - 1].x, cleaned[cleaned.length - 1].y, p.x, p.y) < 2) {
        continue;
      }
      cleaned.push(p);
    }

    if (cleaned.length >= 1) {
      var span = [{ x: aOuter.x, y: aOuter.y }]
        .concat(cleaned)
        .concat([{ x: bOuter.x, y: bOuter.y }]);
      span = enforceDownwardSag(span);
      cleaned = span.slice(1, -1);
    }

    /* tip → relief mid → relief outer … midpoints … outer → mid → tip */
    return aChain.concat(cleaned).concat(bChain.slice().reverse());
  }

  /** Catmull-Rom / cubic spline commands; pen is already at pts[0].
   *  opts.inTan / opts.outTan (unit vectors) keep G1 continuity with strain-relief stubs.
   */
  function catmullRomCubicCommands(pts, opts) {
    opts = opts || {};
    if (!pts || pts.length < 2) return '';
    var inTan = opts.inTan || null;
    var outTan = opts.outTan || null;
    var k = CATMULL_HANDLE_K;

    if (pts.length === 2) {
      var h2 = dist2(pts[0].x, pts[0].y, pts[1].x, pts[1].y) / 3;
      if (h2 < 0.5) return ' L ' + pts[1].x + ' ' + pts[1].y;
      var i0 = inTan || {
        x: (pts[1].x - pts[0].x) / (h2 * 3 || 1),
        y: (pts[1].y - pts[0].y) / (h2 * 3 || 1),
      };
      var o0 = outTan || i0;
      return (
        ' C ' + (pts[0].x + i0.x * h2) + ' ' + (pts[0].y + i0.y * h2) + ', ' +
        (pts[1].x - o0.x * h2) + ' ' + (pts[1].y - o0.y * h2) + ', ' +
        pts[1].x + ' ' + pts[1].y
      );
    }

    if (pts.length === 3) {
      /* Promote Q to C with optional end tangents for fluid joins */
      var a = pts[0];
      var b = pts[1];
      var c = pts[2];
      var hA = dist2(a.x, a.y, b.x, b.y) / 3;
      var hB = dist2(b.x, b.y, c.x, c.y) / 3;
      var tIn = inTan || { x: (b.x - a.x) / (hA * 3 || 1), y: (b.y - a.y) / (hA * 3 || 1) };
      var tOut = outTan || { x: (c.x - b.x) / (hB * 3 || 1), y: (c.y - b.y) / (hB * 3 || 1) };
      return (
        ' C ' + (a.x + tIn.x * hA) + ' ' + (a.y + tIn.y * hA) + ', ' +
        (b.x - (c.x - a.x) / k) + ' ' + (b.y - (c.y - a.y) / k) + ', ' +
        b.x + ' ' + b.y +
        ' C ' + (b.x + (c.x - a.x) / k) + ' ' + (b.y + (c.y - a.y) / k) + ', ' +
        (c.x - tOut.x * hB) + ' ' + (c.y - tOut.y * hB) + ', ' +
        c.x + ' ' + c.y
      );
    }

    var d = '';
    var i;
    for (i = 0; i < pts.length - 1; i++) {
      var p0 = pts[i - 1] || pts[i];
      var p1 = pts[i];
      var p2 = pts[i + 1];
      var p3 = pts[i + 2] || p2;
      var seg = dist2(p1.x, p1.y, p2.x, p2.y);
      var c1x;
      var c1y;
      var c2x;
      var c2y;
      if (i === 0 && inTan) {
        var hIn = Math.max(seg / 3, 4);
        c1x = p1.x + inTan.x * hIn;
        c1y = p1.y + inTan.y * hIn;
      } else {
        c1x = p1.x + (p2.x - p0.x) / k;
        c1y = p1.y + (p2.y - p0.y) / k;
      }
      if (i === pts.length - 2 && outTan) {
        var hOut = Math.max(seg / 3, 4);
        c2x = p2.x - outTan.x * hOut;
        c2y = p2.y - outTan.y * hOut;
      } else {
        c2x = p2.x - (p3.x - p1.x) / k;
        c2y = p2.y - (p3.y - p1.y) / k;
      }
      d += ' C ' + c1x + ' ' + c1y + ', ' + c2x + ' ' + c2y + ', ' + p2.x + ' ' + p2.y;
    }
    return d;
  }

  function unitVec(x, y) {
    var d = Math.sqrt(x * x + y * y);
    if (d < 1e-8) return { x: 0, y: 1 };
    return { x: x / d, y: y / d };
  }

  /**
   * Straight strain-relief leads/trails (L only on the short axial stubs),
   * mid-span always cubic-spline interpolated — never raw polyline vertices.
   */
  function smoothPathThrough(pts, opts) {
    opts = opts || {};
    if (!pts || pts.length < 2) return '';
    var lead = opts.strainLead != null ? opts.strainLead : 0;
    var trail = opts.strainTrail != null ? opts.strainTrail : 0;

    if (lead < 2 && trail < 2) {
      return 'M ' + pts[0].x + ' ' + pts[0].y + catmullRomCubicCommands(pts);
    }

    var d = 'M ' + pts[0].x + ' ' + pts[0].y;
    var i;
    for (i = 1; i < lead && i < pts.length; i++) {
      d += ' L ' + pts[i].x + ' ' + pts[i].y;
    }
    var midStart = Math.max(0, lead - 1);
    var midEnd = Math.min(pts.length - 1, pts.length - trail);
    if (midEnd > midStart) {
      var mid = pts.slice(midStart, midEnd + 1);
      var inTan = null;
      var outTan = null;
      if (midStart >= 1) {
        inTan = unitVec(
          pts[midStart].x - pts[midStart - 1].x,
          pts[midStart].y - pts[midStart - 1].y
        );
      }
      if (midEnd + 1 < pts.length) {
        outTan = unitVec(
          pts[midEnd + 1].x - pts[midEnd].x,
          pts[midEnd + 1].y - pts[midEnd].y
        );
      }
      d += catmullRomCubicCommands(mid, { inTan: inTan, outTan: outTan });
    }
    for (i = midEnd + 1; i < pts.length; i++) {
      d += ' L ' + pts[i].x + ' ' + pts[i].y;
    }
    return d;
  }

  /**
   * Render-only densify of the free mid-span so sparse rope / catenary samples
   * never show polygonal corners. Strain-relief stubs are left untouched.
   */
  function densifyMidSpanForSpline(pts, lead, trail) {
    if (!pts || pts.length < lead + trail) return pts;
    var midStart = Math.max(0, lead - 1);
    var midEnd = Math.min(pts.length - 1, pts.length - trail);
    if (midEnd - midStart < 2) return pts;
    var mid = pts.slice(midStart, midEnd + 1);
    mid = catmullRomResample(mid, 4);
    if (mid.length >= 4) mid = chaikinSmooth(mid, 1);
    mid = enforceDownwardSag(mid);
    return pts.slice(0, midStart).concat(mid).concat(pts.slice(midEnd + 1));
  }

  /**
   * Arc length used for continuous catenary rendering (all modes / live drag).
   * Prefer live rope span length, then locked meters, then traced length, then default slack.
   */
  function resolveRenderCableLength(cord, p0, p3) {
    var chord = dist2(p0.x, p0.y, p3.x, p3.y) || 1;
    var rope = ropePhysics[cord.id];
    if (rope && rope.particles && rope.particles.length >= 2) {
      var rlen = 0;
      var ri;
      for (ri = 1; ri < rope.particles.length; ri++) {
        rlen += dist2(
          rope.particles[ri - 1].x, rope.particles[ri - 1].y,
          rope.particles[ri].x, rope.particles[ri].y
        );
      }
      if (rlen > chord * 1.001) return Math.max(rlen, chord * 1.0002);
    }
    if (typeof cord.fixedLength === 'number' && cord.fixedLength > 0) {
      return Math.max(cord.fixedLength, chord * 1.0002);
    }
    var route = ensureRoute(cord);
    if (route.length >= 2) {
      var poly = [{ x: p0.x, y: p0.y }].concat(route).concat([{ x: p3.x, y: p3.y }]);
      var len = polylineLength(poly);
      var sag = routeSagDepth(poly);
      var L = Math.max(len, chord * CATENARY_DEFAULT_SLACK);
      if (sag > 2) L = Math.max(L, catenaryLengthForSag(p0, p3, sag));
      return Math.max(L, chord * 1.0002);
    }
    var sagD = catenarySagDepth(chord);
    return Math.max(
      chord * CATENARY_DEFAULT_SLACK,
      catenaryLengthForSag(p0, p3, sagD)
    );
  }

  function svgCubic(c1, c2, p) {
    return (
      ' C ' + c1.x + ' ' + c1.y + ', ' +
      c2.x + ' ' + c2.y + ', ' +
      p.x + ' ' + p.y
    );
  }

  /** Cubic Hermite segment as SVG C (unit tangents × handle lengths). */
  function hermiteSvg(p0, t0, h0, p1, t1, h1) {
    return svgCubic(
      { x: p0.x + t0.x * h0, y: p0.y + t0.y * h0 },
      { x: p1.x - t1.x * h1, y: p1.y - t1.y * h1 },
      p1
    );
  }

  /**
   * Effective cable length for elastic sag (fixed meters / route / default slack).
   */
  function resolveElasticLengthPx(cord, tipA, tipB) {
    var chord = dist2(tipA.x, tipA.y, tipB.x, tipB.y) || 1;
    if (typeof cord.fixedLength === 'number' && cord.fixedLength > 0) {
      return Math.max(cord.fixedLength, chord * 1.0002);
    }
    if (isMeterMode(cord) && typeof cord.lengthMeters === 'number') {
      return Math.max(metersToWorldPx(cord.lengthMeters), chord * 1.0002);
    }
    var rope = ropePhysics[cord.id];
    if (rope && rope.particles && rope.particles.length >= 2) {
      var rlen = 0;
      var ri;
      for (ri = 1; ri < rope.particles.length; ri++) {
        rlen += dist2(
          rope.particles[ri - 1].x, rope.particles[ri - 1].y,
          rope.particles[ri].x, rope.particles[ri].y
        );
      }
      if (rlen > chord * 1.001) return Math.max(rlen, chord * 1.0002);
    }
    var route = ensureRoute(cord);
    if (route.length >= 2) {
      var poly = [{ x: tipA.x, y: tipA.y }].concat(route).concat([{ x: tipB.x, y: tipB.y }]);
      return Math.max(polylineLength(poly), chord * CATENARY_DEFAULT_SLACK);
    }
    return chord * CATENARY_DEFAULT_SLACK;
  }

  /**
   * Downward belly depth (screen y+). Scales with tip span; excess length
   * (Meter Mode / fixedLength) deepens the hang like a rubber band.
   */
  function computeElasticSagPx(chord, lengthPx) {
    if (global.FtthLab && typeof FtthLab.elasticFiberSagPx === 'function') {
      return FtthLab.elasticFiberSagPx(chord, lengthPx);
    }
    chord = Math.max(1, chord);
    var sag = Math.min(
      GRAVITY_SAG_MAX,
      Math.max(GRAVITY_SAG_MIN * 0.55, chord * GRAVITY_SAG_RATIO)
    );
    var L = Number(lengthPx);
    if (isFinite(L) && L > chord) {
      var excess = L - chord;
      sag = Math.max(
        sag,
        Math.sqrt(Math.max(0, excess * chord * 0.5)) * 0.55
      );
    }
    return Math.max(16, Math.min(GRAVITY_SAG_MAX, sag));
  }

  /**
   * Fully elastic gravity-biased Bezier path: tipA → belly → tipB.
   * No rigid axial stubs, no x-parameterized cosh. The belly is always the
   * midpoint offset downward in Y, so the cable hangs under any orientation,
   * overlap, or parallel boot layout. Boot exits blend lightly into the curve.
   */
  function buildElasticBezierPath(cord) {
    var tipA = bootAnchor(cord, 'A');
    var tipB = bootAnchor(cord, 'B');
    var dA = bootOutDir(getEndRotation(cord, 'A'));
    var dB = bootOutDir(getEndRotation(cord, 'B'));
    var tA = unitVec(dA.x, dA.y);
    var tB = unitVec(dB.x, dB.y);

    var chord = dist2(tipA.x, tipA.y, tipB.x, tipB.y) || 1;
    var L = resolveElasticLengthPx(cord, tipA, tipB);
    var sag = computeElasticSagPx(chord, L);

    var belly = {
      x: (tipA.x + tipB.x) * 0.5,
      y: (tipA.y + tipB.y) * 0.5 + sag,
    };

    /* Leave A / arrive B: mostly toward the belly, light boot influence (no kinks) */
    var toBellyA = unitVec(belly.x - tipA.x, belly.y - tipA.y);
    var fromBellyB = unitVec(tipB.x - belly.x, tipB.y - belly.y);
    var leaveA = blendUnitTan(toBellyA, tA, 0.28);
    var arriveB = blendUnitTan(fromBellyB, unitVec(-tB.x, -tB.y), 0.28);

    /* Elastic band tangent across the belly follows the tip chord */
    var along = unitVec(tipB.x - tipA.x, tipB.y - tipA.y);
    if (along.x * along.x + along.y * along.y < 1e-8) {
      along = { x: 1, y: 0 };
    }

    var lenA = dist2(tipA.x, tipA.y, belly.x, belly.y) || 1;
    var lenB = dist2(belly.x, belly.y, tipB.x, tipB.y) || 1;
    var hA0 = Math.max(14, Math.min(lenA * 0.42, chord * 0.35 + 18));
    var hA1 = Math.max(14, Math.min(lenA * 0.36, chord * 0.32 + 16));
    var hB0 = Math.max(14, Math.min(lenB * 0.36, chord * 0.32 + 16));
    var hB1 = Math.max(14, Math.min(lenB * 0.42, chord * 0.35 + 18));

    return (
      'M ' + tipA.x + ' ' + tipA.y +
      hermiteSvg(tipA, leaveA, hA0, belly, along, hA1) +
      hermiteSvg(belly, along, hB0, tipB, arriveB, hB1)
    );
  }

  /** Public render entry — elastic gravity Bezier (no rigid stubs / cosh solver). */
  function buildContinuousCatenaryPath(cord) {
    return cordCablePath(cord);
  }

  var SPOOL_HERMITE_SAMPLES = 60;
  var CORD_STROKE_PX = 2.25;

  function spoolDrumR(s) {
    return (s && typeof s.rDrum === 'number') ? s.rDrum : s.r;
  }

  function listSpoolObstacles() {
    if (!global.FtthLab || typeof FtthLab.listFiberSpools !== 'function') return [];
    var list = FtthLab.listFiberSpools() || [];
    var out = [];
    var i;
    for (i = 0; i < list.length; i++) {
      var c = FtthLab.fiberSpoolCenter && FtthLab.fiberSpoolCenter(list[i]);
      if (!c) continue;
      var rOuter = typeof c.rOuter === 'number' ? c.rOuter : c.r;
      out.push({
        id: list[i].id,
        x: c.x,
        y: c.y,
        rDrum: c.r,
        r: rOuter + CORD_STROKE_PX / 2
      });
    }
    return out;
  }

  function pushPointOutOfSpools(p, obs) {
    var q = { x: p.x, y: p.y };
    var iter;
    var i;
    for (iter = 0; iter < 4; iter++) {
      var moved = false;
      for (i = 0; i < obs.length; i++) {
        var s = obs[i];
        var dx = q.x - s.x;
        var dy = q.y - s.y;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d >= s.r) continue;
        if (d < 1e-6) {
          q.x = s.x + s.r;
          q.y = s.y;
        } else {
          q.x = s.x + (dx / d) * s.r;
          q.y = s.y + (dy / d) * s.r;
        }
        moved = true;
      }
      if (!moved) break;
    }
    return q;
  }

  function collideRopeWithSpools(rope) {
    if (!rope || !rope.particles) return;
    var obs = listSpoolObstacles();
    if (!obs.length) return;
    var i;
    for (i = 1; i < rope.particles.length - 1; i++) {
      var q = pushPointOutOfSpools(rope.particles[i], obs);
      rope.particles[i].x = q.x;
      rope.particles[i].y = q.y;
    }
  }

  function sampleCubicBezier(p0, c1, c2, p1, n) {
    var pts = [];
    var i;
    for (i = 0; i <= n; i++) {
      var t = i / n;
      var u = 1 - t;
      pts.push({
        x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x,
        y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y
      });
    }
    return pts;
  }

  /** Dense samples of the native Hermite jacket (does not mutate Bezier construction). */
  function sampleElasticHermitePoints(cord, count) {
    var tipA = bootAnchor(cord, 'A');
    var tipB = bootAnchor(cord, 'B');
    var dA = bootOutDir(getEndRotation(cord, 'A'));
    var dB = bootOutDir(getEndRotation(cord, 'B'));
    var tA = unitVec(dA.x, dA.y);
    var tB = unitVec(dB.x, dB.y);
    var chord = dist2(tipA.x, tipA.y, tipB.x, tipB.y) || 1;
    var L = resolveElasticLengthPx(cord, tipA, tipB);
    var sag = computeElasticSagPx(chord, L);
    var belly = {
      x: (tipA.x + tipB.x) * 0.5,
      y: (tipA.y + tipB.y) * 0.5 + sag
    };
    var toBellyA = unitVec(belly.x - tipA.x, belly.y - tipA.y);
    var fromBellyB = unitVec(tipB.x - belly.x, tipB.y - belly.y);
    var leaveA = blendUnitTan(toBellyA, tA, 0.28);
    var arriveB = blendUnitTan(fromBellyB, unitVec(-tB.x, -tB.y), 0.28);
    var along = unitVec(tipB.x - tipA.x, tipB.y - tipA.y);
    if (along.x * along.x + along.y * along.y < 1e-8) along = { x: 1, y: 0 };
    var lenA = dist2(tipA.x, tipA.y, belly.x, belly.y) || 1;
    var lenB = dist2(belly.x, belly.y, tipB.x, tipB.y) || 1;
    var hA0 = Math.max(14, Math.min(lenA * 0.42, chord * 0.35 + 18));
    var hA1 = Math.max(14, Math.min(lenA * 0.36, chord * 0.32 + 16));
    var hB0 = Math.max(14, Math.min(lenB * 0.36, chord * 0.32 + 16));
    var hB1 = Math.max(14, Math.min(lenB * 0.42, chord * 0.35 + 18));
    var c1a = { x: tipA.x + leaveA.x * hA0, y: tipA.y + leaveA.y * hA0 };
    var c2a = { x: belly.x - along.x * hA1, y: belly.y - along.y * hA1 };
    var c1b = { x: belly.x + along.x * hB0, y: belly.y + along.y * hB0 };
    var c2b = { x: tipB.x - arriveB.x * hB1, y: tipB.y - arriveB.y * hB1 };
    var half = Math.max(8, Math.round((count || SPOOL_HERMITE_SAMPLES) / 2));
    var a = sampleCubicBezier(tipA, c1a, c2a, belly, half);
    var b = sampleCubicBezier(belly, c1b, c2b, tipB, half);
    return a.concat(b.slice(1));
  }

  function wrapAngleDelta(a0, a1) {
    var d = a1 - a0;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  function wrapSweepLocked(angIn, angOut, side) {
    var da = wrapAngleDelta(angIn, angOut);
    if (Math.abs(da) < 0.05) return da;
    if (side > 0 && da < 0) da += Math.PI * 2;
    if (side < 0 && da > 0) da -= Math.PI * 2;
    return da;
  }

  function polarOnSpool(s, ang) {
    return { x: s.x + s.r * Math.cos(ang), y: s.y + s.r * Math.sin(ang) };
  }

  function closestOnSeg(ax, ay, bx, by, px, py) {
    var abx = bx - ax;
    var aby = by - ay;
    var den = abx * abx + aby * aby;
    var t = den < 1e-10 ? 0 : ((px - ax) * abx + (py - ay) * aby) / den;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    return { x: ax + abx * t, y: ay + aby * t, t: t };
  }

  function segmentCutsSpool(a, b, s) {
    var hit = closestOnSeg(a.x, a.y, b.x, b.y, s.x, s.y);
    return Math.hypot(hit.x - s.x, hit.y - s.y) < s.r;
  }

  function inferWrapSide(pts, i0, i1, s) {
    var bestI = i0;
    var bestD = 1e9;
    var i;
    for (i = i0; i <= i1; i++) {
      var d = Math.hypot(pts[i].x - s.x, pts[i].y - s.y);
      if (d < bestD) {
        bestD = d;
        bestI = i;
      }
    }
    var p = pts[bestI];
    var prev = pts[Math.max(i0, bestI - 1)];
    var next = pts[Math.min(i1, bestI + 1)];
    var tx = next.x - prev.x;
    var ty = next.y - prev.y;
    var rx = s.x - p.x;
    var ry = s.y - p.y;
    var cross = tx * ry - ty * rx;
    return cross >= 0 ? 1 : -1;
  }

  function ensureSpoolWrapSide(cord, spoolId, inferred) {
    if (!cord.spoolWrap || typeof cord.spoolWrap !== 'object') cord.spoolWrap = {};
    var prev = cord.spoolWrap[spoolId];
    if (prev && (prev.side === 1 || prev.side === -1)) return prev.side;
    cord.spoolWrap[spoolId] = {
      side: inferred,
      totalAngle: 0,
      lastAngle: null,
      totalAngleSeeded: false
    };
    return inferred;
  }

  /** Integrate connector polar angle around each locked spool. Never wrap totalAngle. */
  function integrateSpoolWrapOnDrag(cord, wx, wy) {
    if (!cord || !cord.spoolWrap) return;
    var obs = listSpoolObstacles();
    var i;
    for (i = 0; i < obs.length; i++) {
      var s = obs[i];
      var w = cord.spoolWrap[s.id];
      if (!w) continue;
      var ang = Math.atan2(wy - s.y, wx - s.x);
      if (typeof w.lastAngle !== 'number') {
        w.lastAngle = ang;
        continue;
      }
      var dTheta = wrapAngleDelta(w.lastAngle, ang);
      w.totalAngle = (typeof w.totalAngle === 'number' ? w.totalAngle : 0) + dTheta;
      w.lastAngle = ang;
    }
  }

  /**
   * Principal tangent arc plus extra full turns from unwrapped totalAngle.
   * Stored totalAngle stays in R; only the step dTheta is a principal delta.
   */
  function unwrappedCoilSweep(wrap, angIn, angOut, side) {
    var principal = wrapSweepLocked(angIn, angOut, side);
    if (Math.abs(principal) < 0.18) {
      principal = side >= 0 ? 0.18 : -0.18;
    }
    if (!wrap.totalAngleSeeded) {
      wrap.totalAngle = principal;
      wrap.totalAngleSeeded = true;
    }
    var twoPi = Math.PI * 2;
    var extra = Math.round((wrap.totalAngle - principal) / twoPi);
    return principal + extra * twoPi;
  }

  var COIL_DTHETA = 0.1;
  var COIL_LAYER_PX = 2;

  /** Archimedes stack: r = s.r + turnIndex * 2px, sampled at ~0.1 rad. */
  function sampleArchimedeanCoil(s, angIn, sweep) {
    var abs = Math.abs(sweep);
    var steps = Math.max(8, Math.ceil(abs / COIL_DTHETA));
    var twoPi = Math.PI * 2;
    var out = [];
    var i;
    for (i = 0; i <= steps; i++) {
      var t = i / steps;
      var ang = angIn + sweep * t;
      var turnIndex = Math.floor((abs * t + 1e-9) / twoPi);
      var r = s.r + turnIndex * COIL_LAYER_PX;
      out.push({
        x: s.x + r * Math.cos(ang),
        y: s.y + r * Math.sin(ang),
        onDrum: true
      });
    }
    return out;
  }

  function localSpanAroundSpool(pts, s) {
    var n = pts.length;
    var closest = 0;
    var bestD = 1e9;
    var i;
    for (i = 0; i < n; i++) {
      var d = Math.hypot(pts[i].x - s.x, pts[i].y - s.y);
      if (d < bestD) {
        bestD = d;
        closest = i;
      }
    }
    var margin = s.r + 32;
    var i0 = closest;
    while (i0 > 0 && Math.hypot(pts[i0].x - s.x, pts[i0].y - s.y) < margin) i0 -= 1;
    var i1 = closest;
    while (i1 < n - 1 && Math.hypot(pts[i1].x - s.x, pts[i1].y - s.y) < margin) i1 += 1;
    return { i0: i0, i1: i1, dist: bestD };
  }

  /** Free-lead cubics + polyline coil so Catmull handles never cross the drum. */
  function jacketPathFromWrapPts(pts) {
    if (!pts || pts.length < 2) return '';
    var d = 'M ' + pts[0].x + ' ' + pts[0].y;
    var hang = [];
    var i;

    function flushHang() {
      if (hang.length < 2) {
        hang = [];
        return;
      }
      if (hang.length === 2) {
        d += ' L ' + hang[1].x + ' ' + hang[1].y;
      } else {
        d += catmullRomCubicCommands(hang);
      }
      hang = [];
    }

    for (i = 1; i < pts.length; i++) {
      var prev = pts[i - 1];
      var cur = pts[i];
      if (prev.onDrum && cur.onDrum) {
        if (hang.length >= 2) flushHang();
        hang = [];
        d += ' L ' + cur.x + ' ' + cur.y;
      } else {
        if (!hang.length) hang.push(prev);
        hang.push(cur);
      }
    }
    if (hang.length >= 2) flushHang();
    return d;
  }

  function pickTangentAng(px, py, cx, cy, r, ccw) {
    var dx = px - cx;
    var dy = py - cy;
    var d = Math.hypot(dx, dy) || 1;
    var base = Math.atan2(dy, dx);
    if (d <= r + 0.6) return base;
    var phi = Math.acos(Math.max(-1, Math.min(1, r / d)));
    return ccw ? base + phi : base - phi;
  }

  function tautHang(a, b, obs) {
    var chord = dist2(a.x, a.y, b.x, b.y);
    if (chord < 4) return [a, b];
    var sag = Math.min(12, chord * 0.04);
    var n = Math.max(3, Math.min(7, Math.ceil(chord / 36)));
    var out = [a];
    var i;
    for (i = 1; i < n; i++) {
      var t = i / n;
      var p = {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t + sag * 4 * t * (1 - t)
      };
      out.push(pushPointOutOfSpools(p, obs));
    }
    out.push(b);
    return out;
  }

  /** Sagged chord samples without radial push — used only for hit tests. */
  function sampleTautHangRaw(a, b) {
    var chord = dist2(a.x, a.y, b.x, b.y);
    if (chord < 4) return [a, b];
    var sag = Math.min(12, chord * 0.04);
    var n = Math.max(3, Math.min(7, Math.ceil(chord / 36)));
    var out = [a];
    var i;
    for (i = 1; i < n; i++) {
      var t = i / n;
      out.push({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t + sag * 4 * t * (1 - t)
      });
    }
    out.push(b);
    return out;
  }

  function contactDebug(msg) {
    if (DEBUG_CONTACTS && typeof console !== 'undefined' && console.log) {
      console.log('[CONTACT] ' + msg);
    }
  }

  function ensureCordContacts(cord) {
    if (!cord.contacts) cord.contacts = [];
    if (typeof cord.contactSeq !== 'number') cord.contactSeq = 0;
  }

  function findObstacleById(obs, id) {
    var i;
    for (i = 0; i < obs.length; i++) {
      if (obs[i].id === id) return obs[i];
    }
    return null;
  }

  function polarOnRadius(s, ang, r) {
    var rr = typeof r === 'number' ? r : s.r;
    return { x: s.x + rr * Math.cos(ang), y: s.y + rr * Math.sin(ang), onDrum: true };
  }

  function unwrapAngleNear(principal, ref) {
    var a = principal;
    if (typeof ref !== 'number' || !isFinite(ref)) return a;
    while (a - ref > Math.PI) a -= Math.PI * 2;
    while (a - ref < -Math.PI) a += Math.PI * 2;
    return a;
  }

  function shortestSweepForDir(angIn, angOut, dir) {
    var sweep = wrapAngleDelta(angIn, angOut);
    if (dir > 0 && sweep < 0 && Math.abs(sweep) > 0.45) sweep += Math.PI * 2;
    if (dir < 0 && sweep > 0 && Math.abs(sweep) > 0.45) sweep -= Math.PI * 2;
    return sweep;
  }

  function contactEntryPt(s, c) {
    return polarOnRadius(s, c.thetaEntry, c.rLayer || spoolDrumR(s));
  }

  function contactExitPt(s, c) {
    return polarOnRadius(s, c.thetaExit, c.rLayer || spoolDrumR(s));
  }

  function refreshContactLayer(s, c) {
    var sweep = c.thetaExit - c.thetaEntry;
    c.wrapCount = Math.floor(Math.abs(sweep) / (Math.PI * 2));
    c.rLayer = spoolDrumR(s) + c.wrapCount * CONTACT_PITCH_PX;
  }

  function occupiedSpoolIds(contacts) {
    var map = {};
    var i;
    for (i = 0; i < contacts.length; i++) map[contacts[i].spoolId] = true;
    return map;
  }

  function contactNeighbors(cord, obs, index) {
    var contacts = cord.contacts;
    var c = contacts[index];
    var s = findObstacleById(obs, c.spoolId);
    var left = index === 0
      ? bootAnchor(cord, 'A')
      : contactExitPt(findObstacleById(obs, contacts[index - 1].spoolId), contacts[index - 1]);
    var right = index === contacts.length - 1
      ? bootAnchor(cord, 'B')
      : contactEntryPt(findObstacleById(obs, contacts[index + 1].spoolId), contacts[index + 1]);
    return { left: left, right: right, spool: s };
  }

  function orient2(a, b, p) {
    return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  }

  function hangsWouldCross(p0, t0, t1, p1) {
    var d1 = orient2(p0, t0, t1);
    var d2 = orient2(p0, t0, p1);
    var d3 = orient2(t1, p1, p0);
    var d4 = orient2(t1, p1, t0);
    return d1 * d2 < 0 && d3 * d4 < 0;
  }

  function lineOfSightClearsSpool(a, b, s) {
    if (!a || !b || !s) return false;
    if (Math.hypot(a.x - s.x, a.y - s.y) < s.r) return false;
    if (Math.hypot(b.x - s.x, b.y - s.y) < s.r) return false;
    return !segmentCutsSpool(a, b, s);
  }

  function unconstrainedSpanHitsSpool(left, right, s, cord, useFullHermite) {
    if (!left || !right || !s) return false;
    if (segmentCutsSpool(left, right, s)) return true;
    if (useFullHermite && cord) {
      var hit = hermiteHitsSpool(sampleElasticHermitePoints(cord, SPOOL_HERMITE_SAMPLES), s);
      if (!hit.miss) return true;
    }
    var hang = sampleTautHangRaw(left, right);
    var i;
    for (i = 1; i < hang.length; i++) {
      if (segmentCutsSpool(hang[i - 1], hang[i], s)) return true;
    }
    return false;
  }

  function freeSpanHitsSpool(a, b, s, useHermite, cord) {
    return unconstrainedSpanHitsSpool(a, b, s, cord, !!useHermite);
  }

  function makeContact(cord, spoolId, dir, thetaEntry, thetaExit, s) {
    cord.contactSeq += 1;
    var c = {
      id: 'ct-' + cord.contactSeq,
      spoolId: spoolId,
      dir: dir,
      wrapCount: 0,
      thetaEntry: thetaEntry,
      thetaExit: thetaExit,
      lastEntryAtan: thetaEntry,
      lastExitAtan: thetaExit,
      rLayer: spoolDrumR(s)
    };
    refreshContactLayer(s, c);
    return c;
  }

  function shouldReleaseContact(c, left, right, s, cord, sole) {
    refreshContactLayer(s, c);
    if (c.wrapCount >= 1) return false;
    if (unconstrainedSpanHitsSpool(left, right, s, cord, !!sole)) return false;
    if (!lineOfSightClearsSpool(left, right, s)) return false;
    return true;
  }

  function trackContact(c, left, right, s) {
    if (!s) return;
    var rd = spoolDrumR(s);
    var angIn = pickTangentAng(left.x, left.y, s.x, s.y, rd, c.dir > 0);
    var angOut = pickTangentAng(right.x, right.y, s.x, s.y, rd, c.dir < 0);
    var prevSweep = c.thetaExit - c.thetaEntry;
    c.thetaEntry = unwrapAngleNear(angIn, c.thetaEntry);
    c.thetaExit = unwrapAngleNear(angOut, c.thetaExit);
    var sweep = c.thetaExit - c.thetaEntry;
    if (c.dir > 0 && sweep < 0 && Math.abs(sweep) > 0.45 && Math.abs(prevSweep) > Math.PI) {
      c.thetaExit = c.thetaEntry + prevSweep;
    }
    if (c.dir < 0 && sweep > 0 && Math.abs(sweep) > 0.45 && Math.abs(prevSweep) > Math.PI) {
      c.thetaExit = c.thetaEntry + prevSweep;
    }
    c.lastEntryAtan = c.thetaEntry;
    c.lastExitAtan = c.thetaExit;
    refreshContactLayer(s, c);
  }

  function engageOnSpan(cord, obs, insertAt, left, right, useHermite) {
    var used = occupiedSpoolIds(cord.contacts);
    var j;
    for (j = 0; j < obs.length; j++) {
      var s = obs[j];
      if (used[s.id]) continue;
      if (!freeSpanHitsSpool(left, right, s, useHermite, cord)) continue;
      var dir = inferWrapSide([left, right], 0, 1, s);
      var rd = spoolDrumR(s);
      var angIn = pickTangentAng(left.x, left.y, s.x, s.y, rd, dir > 0);
      var angOut = pickTangentAng(right.x, right.y, s.x, s.y, rd, dir < 0);
      var sweep = shortestSweepForDir(angIn, angOut, dir);
      var contact = makeContact(cord, s.id, dir, angIn, angIn + sweep, s);
      cord.contacts.splice(insertAt, 0, contact);
      contactDebug('ENGAGE ' + s.id + ' index=' + insertAt);
      return true;
    }
    return false;
  }

  function updateContactTopology(cord) {
    ensureCordContacts(cord);
    var obs = listSpoolObstacles();
    if (!obs.length) {
      if (cord.contacts.length) {
        contactDebug('RELEASE all (no spools)');
        cord.contacts = [];
      }
      return;
    }
    var moving = (endDragState && endDragState.cordId === cord.id) ? endDragState.end : null;
    var i;
    var nb;

    for (i = 0; i < cord.contacts.length; i++) {
      if (moving === 'A' && i !== 0) continue;
      if (moving === 'B' && i !== cord.contacts.length - 1) continue;
      nb = contactNeighbors(cord, obs, i);
      if (!nb.spool) continue;
      var before = cord.contacts[i].thetaExit;
      trackContact(cord.contacts[i], nb.left, nb.right, nb.spool);
      if (Math.abs(cord.contacts[i].thetaExit - before) > 0.25) {
        contactDebug(
          'TRACK ' + cord.contacts[i].spoolId +
          ' theta=' + (cord.contacts[i].thetaExit - cord.contacts[i].thetaEntry).toFixed(3)
        );
      }
    }

    for (i = cord.contacts.length - 1; i >= 0; i--) {
      nb = contactNeighbors(cord, obs, i);
      if (!nb.spool || shouldReleaseContact(
        cord.contacts[i],
        nb.left,
        nb.right,
        nb.spool,
        cord,
        cord.contacts.length === 1
      )) {
        contactDebug('RELEASE ' + (cord.contacts[i] && cord.contacts[i].spoolId));
        cord.contacts.splice(i, 1);
      }
    }

    var guard = 0;
    while (guard < obs.length + 2) {
      guard += 1;
      var engaged = false;
      if (!cord.contacts.length) {
        var tipA = bootAnchor(cord, 'A');
        var tipB = bootAnchor(cord, 'B');
        engaged = engageOnSpan(cord, obs, 0, tipA, tipB, true);
      } else {
        var n = cord.contacts.length;
        for (i = 0; i <= n; i++) {
          var left;
          var right;
          if (i === 0) {
            left = bootAnchor(cord, 'A');
            right = contactEntryPt(
              findObstacleById(obs, cord.contacts[0].spoolId),
              cord.contacts[0]
            );
          } else if (i === n) {
            left = contactExitPt(
              findObstacleById(obs, cord.contacts[n - 1].spoolId),
              cord.contacts[n - 1]
            );
            right = bootAnchor(cord, 'B');
          } else {
            left = contactExitPt(
              findObstacleById(obs, cord.contacts[i - 1].spoolId),
              cord.contacts[i - 1]
            );
            right = contactEntryPt(
              findObstacleById(obs, cord.contacts[i].spoolId),
              cord.contacts[i]
            );
          }
          if (engageOnSpan(cord, obs, i, left, right, false)) {
            engaged = true;
            n = cord.contacts.length;
            break;
          }
        }
      }
      if (!engaged) break;
    }
  }

  function sampleContactRim(s, c) {
    var sweep = c.thetaExit - c.thetaEntry;
    var abs = Math.abs(sweep);
    var steps = Math.max(8, Math.ceil(abs / 0.1));
    var r = c.rLayer || spoolDrumR(s);
    var out = [];
    var i;
    for (i = 0; i <= steps; i++) {
      out.push(polarOnRadius(s, c.thetaEntry + sweep * (i / steps), r));
    }
    return out;
  }

  function realizeCordPath(cord) {
    ensureCordContacts(cord);
    if (!cord.contacts.length) return sampleElasticHermitePoints(cord, SPOOL_HERMITE_SAMPLES);
    var obs = listSpoolObstacles();
    var pts = [];
    var prev = bootAnchor(cord, 'A');
    var i;
    for (i = 0; i < cord.contacts.length; i++) {
      var c = cord.contacts[i];
      var s = findObstacleById(obs, c.spoolId);
      if (!s) continue;
      var entry = contactEntryPt(s, c);
      var hang = tautHang(prev, entry, obs);
      var h;
      for (h = 0; h < hang.length; h++) {
        if (h === hang.length - 1) hang[h].onDrum = true;
        pts.push(hang[h]);
      }
      var arc = sampleContactRim(s, c);
      var a;
      for (a = 1; a < arc.length; a++) pts.push(arc[a]);
      prev = contactExitPt(s, c);
    }
    var tail = tautHang(prev, bootAnchor(cord, 'B'), obs);
    for (i = 1; i < tail.length; i++) pts.push(tail[i]);
    return pts;
  }

  function syncSpoolWrapFromContacts(cord) {
    var next = {};
    var i;
    for (i = 0; i < cord.contacts.length; i++) {
      var c = cord.contacts[i];
      next[c.spoolId] = {
        side: c.dir,
        totalAngle: c.thetaExit - c.thetaEntry,
        lastAngle: c.lastExitAtan
      };
    }
    cord.spoolWrap = next;
  }

  /**
   * Local coil on the drum (Archimedes) plus tautHang leads only.
   * Extra revolutions come from unwrapped wrap.totalAngle, not atan2 folding.
   */
  function splicePersistentWrap(pts, s, wrap, obs) {
    if (!pts || pts.length < 2) return pts;
    var span = localSpanAroundSpool(pts, s);
    if (span.i0 === span.i1 && span.dist > s.r + 8) {
      span.i0 = 0;
      span.i1 = pts.length - 1;
    }
    var P0 = pts[span.i0];
    var P1 = pts[span.i1];
    var side = wrap.side;
    var angA = pickTangentAng(P0.x, P0.y, s.x, s.y, s.r, side > 0);
    var angB = typeof wrap.angB === 'number'
      ? wrap.angB
      : pickTangentAng(P1.x, P1.y, s.x, s.y, s.r, side < 0);
    wrap.angB = angB;
    var sweep = unwrappedCoilSweep(wrap, angB, angA, side);
    var coilInnerToOuter = sampleArchimedeanCoil(s, angB, sweep);
    if (coilInnerToOuter.length < 2) return pts;
    var coil = coilInnerToOuter.slice().reverse();
    var tOuter = coil[0];
    var tInner = coil[coil.length - 1];
    var hangA = tautHang(P0, tOuter, obs);
    var hangB = tautHang(tInner, P1, obs);
    var mid = hangA.concat(coil.slice(1, -1)).concat(hangB);
    var head = pts.slice(0, span.i0);
    var tail = pts.slice(span.i1 + 1);
    return head.concat(mid).concat(tail);
  }

  function hermiteHitsSpool(pts, s) {
    var i;
    for (i = 0; i < pts.length; i++) {
      if (Math.hypot(pts[i].x - s.x, pts[i].y - s.y) < s.r) return { first: i, last: i };
      if (i > 0 && segmentCutsSpool(pts[i - 1], pts[i], s)) {
        return { first: i - 1, last: i };
      }
    }
    var bestI = 0;
    var bestD = 1e9;
    for (i = 0; i < pts.length; i++) {
      var d = Math.hypot(pts[i].x - s.x, pts[i].y - s.y);
      if (d < bestD) {
        bestD = d;
        bestI = i;
      }
    }
    return { first: bestI, last: bestI, miss: true, dist: bestD };
  }

  function deflectHermiteSamplesBySpools(pts, cord) {
    var obs = listSpoolObstacles();
    if (!obs.length || !pts || !pts.length) return pts;
    if (!cord.spoolWrap || typeof cord.spoolWrap !== 'object') cord.spoolWrap = {};
    var visits = [];
    var j;
    for (j = 0; j < obs.length; j++) {
      var s = obs[j];
      var hit = hermiteHitsSpool(pts, s);
      var locked = cord.spoolWrap[s.id];
      if (hit.miss && !locked) continue;
      if (!locked && !hit.miss) {
        var inferred = inferWrapSide(pts, hit.first, Math.max(hit.first, hit.last), s);
        ensureSpoolWrapSide(cord, s.id, inferred);
        locked = cord.spoolWrap[s.id];
      }
      if (!locked) continue;
      visits.push({ spool: s, t: hit.first, wrap: locked });
    }
    visits.sort(function (a, b) { return a.t - b.t; });
    var out = pts;
    for (j = 0; j < visits.length; j++) {
      out = splicePersistentWrap(out, visits[j].spool, visits[j].wrap, obs);
    }
    return out;
  }

  function distToSpool(p, s) {
    return Math.hypot(p.x - s.x, p.y - s.y);
  }

  function clampPointToSpoolRim(p, s) {
    var dx = p.x - s.x;
    var dy = p.y - s.y;
    var d = Math.hypot(dx, dy);
    if (d < 1e-6) {
      return { x: s.x + s.r, y: s.y };
    }
    if (d >= s.r) return { x: p.x, y: p.y };
    return { x: s.x + (dx / d) * s.r, y: s.y + (dy / d) * s.r };
  }

  function polylineCutsSpool(pts, s) {
    var i;
    for (i = 0; i < pts.length; i++) {
      if (distToSpool(pts[i], s) < s.r - 1e-4) return true;
      if (i > 0 && segmentCutsSpool(pts[i - 1], pts[i], s)) return true;
    }
    return false;
  }

  function firstSpoolIntersectIndex(pts, s) {
    var i;
    for (i = 0; i < pts.length; i++) {
      if (distToSpool(pts[i], s) < s.r - 1e-4) return i;
      if (i > 0 && segmentCutsSpool(pts[i - 1], pts[i], s)) return i - 1;
    }
    return -1;
  }

  function lastSpoolIntersectIndex(pts, s) {
    var i;
    for (i = pts.length - 1; i >= 0; i--) {
      if (distToSpool(pts[i], s) < s.r - 1e-4) return i;
      if (i < pts.length - 1 && segmentCutsSpool(pts[i], pts[i + 1], s)) return i + 1;
    }
    return -1;
  }

  function findFirstSpoolCut(pts, obs) {
    var j;
    var best = null;
    var bestI = 1e9;
    for (j = 0; j < obs.length; j++) {
      var i0 = firstSpoolIntersectIndex(pts, obs[j]);
      if (i0 < 0) continue;
      if (i0 < bestI) {
        bestI = i0;
        best = obs[j];
      }
    }
    return best;
  }

  function sampleObstacleArc(s, angIn, sweep) {
    var abs = Math.abs(sweep);
    if (abs < 0.05) sweep = sweep < 0 ? -0.12 : 0.12;
    abs = Math.abs(sweep);
    var steps = Math.max(8, Math.ceil(abs / 0.1));
    var out = [];
    var i;
    for (i = 0; i <= steps; i++) {
      var ang = angIn + sweep * (i / steps);
      out.push({
        x: s.x + s.r * Math.cos(ang),
        y: s.y + s.r * Math.sin(ang),
        onDrum: true
      });
    }
    return out;
  }

  /**
   * Exterior TAT: free tangent in, boundary arc, free tangent out.
   * Arc is the shorter side matching `side` (ccw = +1).
   */
  function obstacleTangentArcTangent(p0, p1, s, side) {
    var a = clampPointToSpoolRim(p0, s);
    var b = clampPointToSpoolRim(p1, s);
    var ccw = side >= 0;
    var angIn = pickTangentAng(a.x, a.y, s.x, s.y, s.r, ccw);
    var angOut = pickTangentAng(b.x, b.y, s.x, s.y, s.r, !ccw);
    var sweep = wrapAngleDelta(angIn, angOut);
    if (ccw && sweep < 0) sweep += Math.PI * 2;
    if (!ccw && sweep > 0) sweep -= Math.PI * 2;
    var tIn = polarOnSpool(s, angIn);
    tIn.onDrum = true;
    var tOut = polarOnSpool(s, angOut);
    tOut.onDrum = true;
    var arc = sampleObstacleArc(s, angIn, sweep);
    var out = [{ x: a.x, y: a.y }];
    if (dist2(a.x, a.y, tIn.x, tIn.y) > 0.6) out.push(tIn);
    else out[0].onDrum = true;
    var k;
    for (k = 1; k < arc.length - 1; k++) out.push(arc[k]);
    if (dist2(tOut.x, tOut.y, b.x, b.y) > 0.6) {
      out.push(tOut);
      out.push({ x: b.x, y: b.y });
    } else {
      tOut.onDrum = true;
      out.push(tOut);
    }
    return out;
  }

  function spliceObstacleAroundSpool(pts, s) {
    var i0 = firstSpoolIntersectIndex(pts, s);
    var i1 = lastSpoolIntersectIndex(pts, s);
    if (i0 < 0 || i1 < 0 || i1 < i0) return pts;
    var side = inferWrapSide(pts, i0, i1, s);
    var p0 = pts[i0];
    var p1 = pts[i1];
    var head = pts.slice(0, i0);
    var tail = pts.slice(i1 + 1);
    var mid = obstacleTangentArcTangent(p0, p1, s, side);
    var out = head.concat(mid).concat(tail);
    if (polylineCutsSpool(out, s)) {
      mid = obstacleTangentArcTangent(p0, p1, s, -side);
      out = head.concat(mid).concat(tail);
    }
    return out;
  }

  function svgPolylinePath(pts) {
    if (!pts || pts.length < 2) return '';
    var d = 'M ' + pts[0].x + ' ' + pts[0].y;
    var i;
    for (i = 1; i < pts.length; i++) {
      d += ' L ' + pts[i].x + ' ' + pts[i].y;
    }
    return d;
  }

  /**
   * Permanent solid-obstacle pass. Independent of contacts / wrap.
   * Uses polyline `L` so Catmull cannot re-enter a disk.
   */
  function solveSpoolObstacles(pts, obs) {
    if (!pts || pts.length < 2 || !obs || !obs.length) return pts;
    var out = pts;
    var guard = 0;
    var limit = obs.length * 4 + 6;
    while (guard < limit) {
      guard += 1;
      var s = findFirstSpoolCut(out, obs);
      if (!s) break;
      var next = spliceObstacleAroundSpool(out, s);
      if (next === out || next.length < 2) break;
      out = next;
    }
    return out;
  }

  function jacketFromObstacleSolvedHermite(cord, obs) {
    var pts = sampleElasticHermitePoints(cord, SPOOL_HERMITE_SAMPLES);
    pts = solveSpoolObstacles(pts, obs);
    if (!pts || pts.length < 2) return buildElasticBezierPath(cord);
    var j;
    var hit = false;
    for (j = 0; j < obs.length; j++) {
      if (polylineCutsSpool(pts, obs[j])) {
        hit = true;
        break;
      }
    }
    if (!hit) {
      var k;
      var usedArc = false;
      for (k = 0; k < pts.length; k++) {
        if (pts[k].onDrum) {
          usedArc = true;
          break;
        }
      }
      if (!usedArc) return buildElasticBezierPath(cord);
    }
    return svgPolylinePath(pts);
  }

  /**
   * Native Hermite jacket, then solid-obstacle TAT, then wrap layer if present.
   * Empty contacts do not skip spool collision.
   */
  var BEND_JIG_SNAP_PX = 36;
  var BEND_JIG_RELEASE_PX = 72;

  function listBendJigSlots() {
    if (!global.FtthLab || typeof FtthLab.listBendJigSlots !== 'function') return [];
    return FtthLab.listBendJigSlots() || [];
  }

  function distPointToSeg(px, py, ax, ay, bx, by) {
    var hit = closestOnSeg(ax, ay, bx, by, px, py);
    return Math.hypot(px - hit.x, py - hit.y);
  }

  function hypotPt(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  /** Distance of the A↔B chord (not a Hermite jacket) to the jig slot. */
  function chordDistToJigSlot(a, b, slot) {
    var dChord1 = distPointToSeg(slot.p1.x, slot.p1.y, a.x, a.y, b.x, b.y);
    var dChordP = distPointToSeg(slot.pivot.x, slot.pivot.y, a.x, a.y, b.x, b.y);
    var dChord2 = distPointToSeg(slot.p2.x, slot.p2.y, a.x, a.y, b.x, b.y);
    var dA1 = distPointToSeg(a.x, a.y, slot.p1.x, slot.p1.y, slot.pivot.x, slot.pivot.y);
    var dA2 = distPointToSeg(a.x, a.y, slot.pivot.x, slot.pivot.y, slot.p2.x, slot.p2.y);
    var dB1 = distPointToSeg(b.x, b.y, slot.p1.x, slot.p1.y, slot.pivot.x, slot.pivot.y);
    var dB2 = distPointToSeg(b.x, b.y, slot.pivot.x, slot.pivot.y, slot.p2.x, slot.p2.y);
    return Math.min(dChord1, dChordP, dChord2, dA1, dA2, dB1, dB2);
  }

  function distToEntryPoint(a, b, slot) {
    var entry = slot.entryPoint || slot.p1;
    if (!entry) return Infinity;
    return distPointToSeg(entry.x, entry.y, a.x, a.y, b.x, b.y);
  }

  function pickLatchedBendJig(cord, jigs) {
    if (!cord || !jigs || !jigs.length) return null;
    var a = bootAnchor(cord, 'A');
    var b = bootAnchor(cord, 'B');
    var i;

    /* Hard lock: stay in the jig until Remove Cable. */
    for (i = 0; i < jigs.length; i++) {
      if (jigs[i].isCableDocked && jigs[i].dockedCordId === cord.id) {
        return jigs[i];
      }
    }
    if (cord.bendJigId) {
      for (i = 0; i < jigs.length; i++) {
        if (jigs[i].id === cord.bendJigId && jigs[i].isCableDocked) {
          return jigs[i];
        }
      }
    }

    var best = null;
    var bestD = BEND_JIG_SNAP_PX;
    for (i = 0; i < jigs.length; i++) {
      var slot = jigs[i];
      if (slot.isCableDocked && slot.dockedCordId && slot.dockedCordId !== cord.id) {
        continue;
      }
      if (cord.bendJigIgnoreId && cord.bendJigIgnoreId === slot.id) {
        var ignoreD = Math.min(chordDistToJigSlot(a, b, slot), distToEntryPoint(a, b, slot));
        if (ignoreD >= BEND_JIG_SNAP_PX) cord.bendJigIgnoreId = null;
        else continue;
      }
      var d = Math.min(chordDistToJigSlot(a, b, slot), distToEntryPoint(a, b, slot));
      if (d < bestD) {
        bestD = d;
        best = slot;
      }
    }
    if (best && global.FtthLab && typeof FtthLab.setBendJigCableDocked === 'function') {
      cord.bendJigIgnoreId = null;
      FtthLab.setBendJigCableDocked(best.id, cord.id, true);
    }
    return best;
  }

  /**
   * Orient slot so the path is always A → entry → pivot → exit → B.
   * Entry is the arm end closer to boot A (never reverse mid-slot).
   */
  function orientedBendJigSlot(cord, slot) {
    var a = bootAnchor(cord, 'A');
    var useP1 = hypotPt(a, slot.p1) <= hypotPt(a, slot.p2);
    var entry = useP1 ? slot.p1 : slot.p2;
    var exit = useP1 ? slot.p2 : slot.p1;
    return {
      id: slot.id,
      pivot: slot.pivot,
      entryPoint: { x: entry.x, y: entry.y },
      exitPoint: { x: exit.x, y: exit.y },
    };
  }

  /** Free sagged span between two world points — local to this lead only. */
  function sampleJigLeadSpan(p0, p3) {
    var chord = dist2(p0.x, p0.y, p3.x, p3.y) || 1;
    if (chord < 4) return [{ x: p0.x, y: p0.y }, { x: p3.x, y: p3.y }];
    var sag = Math.min(catenarySagDepth(chord), Math.max(6, chord * 0.1));
    var L = Math.max(chord * 1.1, catenaryLengthForSag(p0, p3, sag));
    var n = Math.max(8, Math.min(22, Math.ceil(chord / 16)));
    return sampleTrueCatenary(p0, p3, L, n);
  }

  function sampleStraightSlot(p0, p1, n) {
    n = Math.max(2, n || 4);
    var out = [];
    var i;
    for (i = 0; i <= n; i++) {
      var t = i / n;
      out.push({
        x: p0.x + (p1.x - p0.x) * t,
        y: p0.y + (p1.y - p0.y) * t,
        onDrum: true,
      });
    }
    return out;
  }

  /**
   * Strict 3-segment topology. Never Hermite A→B across the slot.
   * Lead-in spline, constrained slot polylines, lead-out spline — stitched once.
   */
  function buildBendJigPolyline(cord, slot) {
    var oriented = orientedBendJigSlot(cord, slot);
    var tipA = bootAnchor(cord, 'A');
    var tipB = bootAnchor(cord, 'B');
    var entry = oriented.entryPoint;
    var pivot = oriented.pivot;
    var exit = oriented.exitPoint;

    var leadIn = sampleJigLeadSpan(tipA, entry);
    var arm1 = sampleStraightSlot(entry, pivot, 5);
    var arm2 = sampleStraightSlot(pivot, exit, 5);
    var leadOut = sampleJigLeadSpan(exit, tipB);

    var pts = [];
    var i;
    for (i = 0; i < leadIn.length - 1; i++) {
      pts.push({ x: leadIn[i].x, y: leadIn[i].y });
    }
    for (i = 0; i < arm1.length; i++) pts.push(arm1[i]);
    for (i = 1; i < arm2.length; i++) pts.push(arm2[i]);
    for (i = 1; i < leadOut.length; i++) {
      pts.push({ x: leadOut[i].x, y: leadOut[i].y });
    }
    return pts;
  }

  function cordCablePath(cord) {
    var jigs = listBendJigSlots();
    if (jigs.length) {
      var latched = pickLatchedBendJig(cord, jigs);
      cord.bendJigId = latched ? latched.id : null;
      if (latched) {
        var jigPts = buildBendJigPolyline(cord, latched);
        if (jigPts && jigPts.length >= 2) return jacketPathFromWrapPts(jigPts);
      }
    } else {
      cord.bendJigId = null;
    }
    var obs = listSpoolObstacles();
    if (!obs.length) {
      if (USE_CONTACT_TOPOLOGY) {
        ensureCordContacts(cord);
        cord.contacts = [];
      }
      return buildElasticBezierPath(cord);
    }
    if (USE_CONTACT_TOPOLOGY) {
      updateContactTopology(cord);
      syncSpoolWrapFromContacts(cord);
      if (cord.contacts.length) {
        var realized = realizeCordPath(cord);
        if (realized && realized.length >= 2) return jacketPathFromWrapPts(realized);
      }
      return jacketFromObstacleSolvedHermite(cord, obs);
    }
    if (cord.spoolWrap && Object.keys(cord.spoolWrap).length) {
      var wrapped = deflectHermiteSamplesBySpools(
        sampleElasticHermitePoints(cord, SPOOL_HERMITE_SAMPLES),
        cord
      );
      if (wrapped && wrapped.length >= 2) return jacketPathFromWrapPts(wrapped);
    }
    return jacketFromObstacleSolvedHermite(cord, obs);
  }

  /** @deprecated alias — elastic Bezier. */
  function gravityBezierPath(cord) {
    return buildElasticBezierPath(cord);
  }

  function endStyle(cord, end) {
    var p = getEndWorld(cord, end);
    var rot = getEndRotation(cord, end);
    /* Pivot at connector center — left/top place the box so (END_W/2, END_H/2) = world p */
    return (
      'left:' + Math.round(p.x - END_W / 2) + 'px;' +
      'top:' + Math.round(p.y - END_H / 2) + 'px;' +
      'transform-origin:50% 50%;' +
      'transform:rotate(' + rot.toFixed(2) + 'deg)'
    );
  }

  function endMarkup(cord, end, side) {
    var label = end === 'B' ? 'B' : 'A';
    return (
      '<button type="button" class="lab-pcord__end lab-pcord__end--' + end.toLowerCase() + ' ' +
      endClass(side) +
      (side.attached ? ' is-attached' : '') +
      (side.mismatch ? ' is-mismatch' : '') +
      '" data-pcord-id="' + cord.id + '" data-pcord-end="' + end + '" ' +
      'style="' + endStyle(cord, end) + '" ' +
      'title="Side ' + label + ' · ' + displayPolish(side.polish) +
      (side.attached
        ? ' · locked in port · pull to unplug'
        : ' · drag to follow mouse · release on port to snap') +
      '" ' +
      'aria-label="Side ' + label + ' ' + displayPolish(side.polish) + '">' +
      '<span class="lab-pcord__housing" aria-hidden="true">' +
      '<i class="lab-pcord__ferrule"></i>' +
      '</span>' +
      '<span class="lab-vfl-exit-flare" aria-hidden="true">' +
      '<i class="lab-vfl-exit-flare__aura"></i>' +
      '<i class="lab-vfl-exit-flare__hot"></i>' +
      '</span>' +
      '<span class="lab-pcord__boot" aria-hidden="true">' +
      '<i></i><i></i><i></i><i></i><i></i>' +
      '</span>' +
      '<b class="lab-pcord__mark">' + label + '</b>' +
      '</button>'
    );
  }

  function flashPort(el) {
    if (!el) return;
    el.classList.add('is-plug-click');
    setTimeout(function () { el.classList.remove('is-plug-click'); }, 280);
  }

  function rebuildLayer() {
    var host = ensureLayer();
    if (!host) return;

    cords.forEach(function (c) { syncAttachedPositions(c); });

    var html =
      '<svg class="lab-pcord-svg" aria-hidden="true">' +
      '<defs>' +
      '<filter id="lab-vfl-core-beam" x="-30%" y="-30%" width="160%" height="160%">' +
      '<feGaussianBlur in="SourceGraphic" stdDeviation="0.55" result="blur"/>' +
      '<feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
      '</defs>';
    cords.forEach(function (c) {
      var path = cordCablePath(c);
      var bad = c.sideA.mismatch || c.sideB.mismatch;
      var sel = selection.cordId === c.id ? ' is-selected' : '';
      html +=
        '<path class="lab-pcord-fiber-hit' + (isMeterMode(c) ? ' is-meter-mode' : '') +
        '" data-pcord-drag="' + c.id + '" d="' + path +
        '" fill="none" />' +
        '<path class="lab-pcord-fiber' + (bad ? ' is-mismatch' : '') + sel +
        (isMeterMode(c) ? ' is-meter-mode' : '') +
        '" data-pcord-fiber="' + c.id + '" d="' + path + '" fill="none" />' +
        '<path class="lab-pcord-laser-core" data-pcord-laser="' + c.id + '" d="' + path +
        '" fill="none" />';
    });
    html += '</svg>';

    cords.forEach(function (c) {
      var selected = selection.cordId === c.id ? ' is-selected' : '';
      var linked = (c.sideA.attached && c.sideB.attached) ? ' is-linked' : '';
      html +=
        '<div class="lab-pcord' + selected + linked + '" data-pcord-node="' + c.id + '">' +
        endMarkup(c, 'A', c.sideA) +
        endMarkup(c, 'B', c.sideB) +
        '</div>';
    });

    host.innerHTML = html;
    bindLayerEvents(host);
    reapplyStoredVflGlow();
  }

  /** Real-time path + free-end pose; plugged ends keep locked style. */
  function updateFiberPath(cord) {
    if (!layer) return;
    var d = cordCablePath(cord);
    var path = layer.querySelector('[data-pcord-fiber="' + cord.id + '"]');
    var hit = layer.querySelector('.lab-pcord-fiber-hit[data-pcord-drag="' + cord.id + '"]');
    var laser = layer.querySelector('[data-pcord-laser="' + cord.id + '"]');
    var selOutline = layer.querySelector(
      '.lab-pcord-fiber-select[data-pcord-fiber-select="' + cord.id + '"]'
    );
    if (path) path.setAttribute('d', d);
    if (hit) hit.setAttribute('d', d);
    if (laser) laser.setAttribute('d', d);
    if (selOutline) selOutline.setAttribute('d', d);
    var aBtn = layer.querySelector('[data-pcord-id="' + cord.id + '"][data-pcord-end="A"]');
    var bBtn = layer.querySelector('[data-pcord-id="' + cord.id + '"][data-pcord-end="B"]');
    if (aBtn) aBtn.setAttribute('style', endStyle(cord, 'A'));
    if (bBtn) bBtn.setAttribute('style', endStyle(cord, 'B'));
  }

  function bindLayerEvents(host) {
    /* Fiber body: free cord translate · fully linked → elastic mid-span pull */
    host.querySelectorAll('[data-pcord-drag]').forEach(function (grip) {
      grip.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        var id = grip.getAttribute('data-pcord-drag');
        var c = findCord(id);
        if (!c) return;
        selectCord(id);
        if (c.bendJigId) {
          setStatus('Cable docked in Macro-Bend Tester · use Remove Cable in properties to release');
          return;
        }
        var zoom = getZoom();
        var sx = e.clientX;
        var sy = e.clientY;
        var oax = c.ax;
        var oay = c.ay;
        var obx = c.bx;
        var oby = c.by;
        var aLocked = !!c.sideA.attached;
        var bLocked = !!c.sideB.attached;

        /* Half-linked: path still drawn via free connector end only */
        if ((aLocked && !bLocked) || (!aLocked && bLocked)) {
          setStatus('Click-and-hold the free connector end to drag and draw the path');
          return;
        }

        /* Both ports locked — rubber-band mid-span (Free Draw only) */
        if (aLocked && bLocked) {
          if (isMeterMode(c)) {
            setStatus(
              'Meter Mode · ' + (c.lengthMeters || pxToMeters(c.fixedLength)).toFixed(1) +
              ' m · adjust length in Properties · mid-span drag disabled'
            );
            return;
          }
          var world0 = clientToWorld(e.clientX, e.clientY);
          beginRopeGrab(c, world0.x, world0.y);
          updateFiberPath(c);
          document.body.classList.add('lab-pcord-stretching');
          grip.classList.add('is-stretching');
          setStatus('Stretching patch cord · release to spring back to your drawn shape');
          var stretched = false;

          function onStretchMove(ev) {
            stretched = true;
            var rope = ropePhysics[c.id];
            if (!rope) return;
            var w = clientToWorld(ev.clientX, ev.clientY);
            applyRopeGrab(rope, w.x, w.y);
            writeRopeToRoute(c, rope);
            updateFiberPath(c);
          }
          function onStretchUp() {
            window.removeEventListener('pointermove', onStretchMove);
            window.removeEventListener('pointerup', onStretchUp);
            document.body.classList.remove('lab-pcord-stretching');
            grip.classList.remove('is-stretching');
            if (ropePhysics[c.id]) {
              beginRopeSettle(c);
              setStatus(
                stretched
                  ? 'Patch cord relaxing · settling to your custom depth and layout'
                  : 'Patch cord selected · drag the cable body to stretch'
              );
            }
          }
          window.addEventListener('pointermove', onStretchMove);
          window.addEventListener('pointerup', onStretchUp);
          return;
        }

        /* Both free — translate whole cord */
        var moved = false;
        var route0 = ensureRoute(c).map(function (p) {
          return { x: p.x, y: p.y };
        });

        function onMove(ev) {
          moved = true;
          var dx = (ev.clientX - sx) / zoom;
          var dy = (ev.clientY - sy) / zoom;
          c.ax = oax + dx;
          c.ay = oay + dy;
          c.bx = obx + dx;
          c.by = oby + dy;
          if (route0.length) {
            c.route = route0.map(function (p) {
              return { x: p.x + dx, y: p.y + dy };
            });
          }
          updateFiberPath(c);
        }
        function onUp() {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          if (moved) pushHistory();
        }
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });
    });

    /* Identical click-and-hold drag for End A and End B — no auto cursor glue */
    host.querySelectorAll('[data-pcord-end]').forEach(function (btn) {
      btn.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        try { btn.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }

        var id = btn.getAttribute('data-pcord-id');
        var end = btn.getAttribute('data-pcord-end');
        var c = findCord(id);
        if (!c) return;
        selectCord(id);

        var side = c[endKey(end)];
        var wasAttached = !!side.attached;
        var portHome = wasAttached
          ? {
              x: side.attached.wx,
              y: side.attached.wy,
              label: side.attached.label,
              lockedRot: side.lockedRot,
            }
          : null;
        var startClientX = e.clientX;
        var startClientY = e.clientY;
        var released = false;
        var breakFreeDrag = false;
        var pluggedNow = false;
        var otherEnd = oppositeEnd(end);
        var otherWasLocked = !!c[endKey(otherEnd)].attached;
        var startWorld = clientToWorld(e.clientX, e.clientY);
        var lastWorld = { x: startWorld.x, y: startWorld.y };

        if (wasAttached && isOtdrAttachment(side.attached)) {
          detachEnd(c, end);
          released = true;
          breakFreeDrag = true;
          lastWorld.x = startWorld.x;
          lastWorld.y = startWorld.y;
          btn.classList.remove('is-attached', 'is-mismatch', 'is-tension');
          btn.classList.add('is-unplugging');
          if (global.FtthLab && typeof FtthLab.refreshOtdrPorts === 'function') {
            FtthLab.refreshOtdrPorts();
          }
          setEndWorld(c, end, startWorld.x, startWorld.y);
          setStatus('SmartOTDR · side ' + end + ' free · release over a port to plug');
          refreshBudget();
          updateInspector();
        }

        /*
         * First-time routing only: seed path when free end starts drawing.
         * Relocate / fixed-length cords never append ink.
         */
        if (!wasAttached && otherWasLocked && !c.pathLocked &&
            typeof c.fixedLength !== 'number' && !c.relocating) {
          if (!ensureRoute(c).length) {
            var seedBoot = bootAnchor(c, otherEnd);
            appendRoutePoint(c, seedBoot.x, seedBoot.y);
          }
        }

        /* Fixed-length relocate whenever the other end is anchored and length is locked */
        if (otherWasLocked && typeof c.fixedLength === 'number') {
          c.relocating = true;
        }

        btn.classList.add('is-dragging');
        document.body.classList.add('lab-pcord-plugging');
        endDragState = { cordId: id, end: end };

        function clearHighlights() {
          document.querySelectorAll(
            '.lab-fx-port.is-plug-target, .lab-fx-port.is-plug-reject, .lab-cas-port.is-plug-target, .lab-cpl-port.is-plug-target, ' +
            '.lab-vfl-port.is-plug-target, .lab-opm-port.is-plug-target, .lab-ols-port.is-plug-target, .lab-otdr-port.is-plug-target'
          ).forEach(function (n) {
            n.classList.remove('is-plug-target', 'is-plug-reject');
          });
        }

        function onMove(ev) {
          var mouse = clientToWorld(ev.clientX, ev.clientY);
          var pullPx = dist2(ev.clientX, ev.clientY, startClientX, startClientY);

          if (wasAttached && !released && !breakFreeDrag) {
            /* Plugged A or B: stay locked until pull clears unplug threshold */
            if (pullPx < UNPLUG_PULL_PX) {
              if (portHome) seatEndAtPort(c, end, portHome.x, portHome.y);
              btn.classList.add('is-tension');
              updateFiberPath(c);
              return;
            }
            released = true;
            detachEnd(c, end);
            lastWorld.x = mouse.x;
            lastWorld.y = mouse.y;
            btn.classList.remove('is-attached', 'is-mismatch', 'is-tension');
            btn.classList.add('is-unplugging');
            setStatus(
              c.relocating
                ? 'Side ' + end + ' relocating · fixed length ' +
                  Math.round(c.fixedLength) + 'px · snap into a port'
                : 'Side ' + end + ' unplugged from ' + (portHome.label || 'port')
            );
            refreshBudget();
            updateInspector();
          }

          /* Opposite plugged end stays seated (symmetrical for A↔B) */
          if (c[endKey(otherEnd)].attached) {
            var oAtt = c[endKey(otherEnd)].attached;
            seatEndAtPort(c, otherEnd, oAtt.wx, oAtt.wy);
          }

          /* Dynamic heading: nose follows mouse motion; boot trails (feeds bootAnchor) */
          if (!c[endKey(end)].attached) {
            updateLiveHeading(c, end, mouse.x - lastWorld.x, mouse.y - lastWorld.y);
            if (dist2(lastWorld.x, lastWorld.y, mouse.x, mouse.y) >= HEADING_MIN_PX) {
              lastWorld.x = mouse.x;
              lastWorld.y = mouse.y;
            }
          }

          setEndWorld(c, end, mouse.x, mouse.y);
          if (!USE_CONTACT_TOPOLOGY) integrateSpoolWrapOnDrag(c, mouse.x, mouse.y);

          if (c.relocating && typeof c.fixedLength === 'number' &&
              c[endKey(otherEnd)].attached) {
            /* Fixed-length elastic tether — no path accumulation */
            clampFreeEndToFixedLength(c, end);
            rebuildFixedLengthCatenary(c);
          } else if (c[endKey(otherEnd)].attached && !c.pathLocked &&
                     typeof c.fixedLength !== 'number') {
            /* First-time freehand routing only */
            var tip = bootExitStub(c, end);
            appendRoutePoint(c, tip.x, tip.y);
          }
          updateFiberPath(c);

          clearHighlights();
          var hit = resolvePlugHit(ev.clientX, ev.clientY);
          if (breakFreeDrag) {
            if (hit && (hit.owner === 'ols' || hit.owner === 'opm' || hit.owner === 'vfl' ||
                (hit.el && hit.el.getAttribute && hit.el.getAttribute('data-otdr-port')))) {
              if (hit.el) hit.el.classList.add('is-plug-target');
              if (!c[endKey(end)].attached) c[endKey(end)].liveRot = 180;
            }
          } else if (hit && hit.owner === 'ols') {
            var mag = applyOlsMagneticPull(c, end, hit, ev.clientX, ev.clientY);
            if (mag === 'lock' && !c[endKey(end)].attached) {
              /* Instant magnetic click — deep seat + vertical lock */
              attachEnd(c, end, hit);
              if (c[endKey(otherEnd)].attached && !spanFitsFixedLength(c)) {
                detachEnd(c, end);
                c.relocating = typeof c.fixedLength === 'number';
                setEndWorld(c, end, mouse.x, mouse.y);
                clampFreeEndToFixedLength(c, end);
                rebuildFixedLengthCatenary(c);
              } else {
                pluggedNow = true;
                flashPort(hit.el);
                if (c[endKey(otherEnd)].attached) {
                  if (!c.pathLocked && typeof c.fixedLength !== 'number' && !c.relocating) {
                    var seatTipM = bootExitStub(c, end);
                    appendRoutePoint(c, seatTipM.x, seatTipM.y);
                    smoothDrawnRoute(c);
                  }
                  lockDrawnPath(c);
                  endLinkSession({ silent: true });
                }
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
                try { btn.releasePointerCapture(ev.pointerId); } catch (errM) { /* ignore */ }
                btn.classList.remove('is-dragging', 'is-tension', 'is-unplugging');
                document.body.classList.remove('lab-pcord-plugging');
                clearHighlights();
                endDragState = null;
                rebuildLayer();
                updateInspector();
                pushHistory();
                refreshBudget();
                setStatus('OLS-35 · magnetic dock · SC seated vertical');
                return;
              }
            }
          } else if (hit && hit.el) {
            var snapRLive = plugSnapRadiusFor(hit);
            var ap = hit.owner === 'olt' ? oltApertureScreenCenter(hit.el) : null;
            var br = hit.el.getBoundingClientRect();
            var dScreen = hit.screenDist != null
              ? hit.screenDist
              : dist2(
                ev.clientX, ev.clientY,
                ap ? ap.x : br.left + br.width / 2,
                ap ? ap.y : br.top + br.height / 2
              );
            if (dScreen <= snapRLive * 1.6) {
              if (!canDockHit(hit)) {
                hit.el.classList.add('is-plug-reject');
              } else {
                hit.el.classList.add('is-plug-target');
                if (isTopTestPort(hit) && !c[endKey(end)].attached) {
                  c[endKey(end)].liveRot = 180;
                }
              }
            }
          }
        }

        function onUp(ev) {
          breakFreeDrag = false;
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          try { btn.releasePointerCapture(ev.pointerId); } catch (err2) { /* ignore */ }
          btn.classList.remove('is-dragging', 'is-tension', 'is-unplugging');
          document.body.classList.remove('lab-pcord-plugging');
          clearHighlights();

          var hit = resolvePlugHit(ev.clientX, ev.clientY);
          var mouse = clientToWorld(ev.clientX, ev.clientY);

          if (wasAttached && !released) {
            syncAttachedPositions(c);
            setStatus('Side ' + end + ' still locked · pull farther to unplug');
          } else if (hit) {
            var snapR = plugSnapRadiusFor(hit);
            var snapEl = hit.el && (
              hit.el.querySelector('.lab-ols__adapter-slot, .lab-ols__sc-block, .lab-fx-port__cage') ||
              hit.el.querySelector('i') || hit.el
            );
            var rect = snapEl
              ? snapEl.getBoundingClientRect()
              : { left: ev.clientX, top: ev.clientY, width: 0, height: 0 };
            var dScreen = hit.screenDist != null
              ? hit.screenDist
              : dist2(
                ev.clientX, ev.clientY,
                rect.left + rect.width / 2, rect.top + rect.height / 2
              );
            var snapMul = hit.owner === 'ols' ? 1 : 1.75;
            if (dScreen <= snapR * snapMul) {
              if (!canDockHit(hit)) {
                if (hit.el) hit.el.classList.add('is-plug-reject');
                setEndWorld(c, end, mouse.x, mouse.y);
                setStatus('No SFP in cage · docking blocked');
              } else {
              attachEnd(c, end, hit);
              /* Reject ports beyond the locked cable reach */
              if (c[endKey(otherEnd)].attached && !spanFitsFixedLength(c)) {
                detachEnd(c, end);
                c.relocating = typeof c.fixedLength === 'number';
                setEndWorld(c, end, mouse.x, mouse.y);
                clampFreeEndToFixedLength(c, end);
                rebuildFixedLengthCatenary(c);
                setStatus(
                  'Port out of reach · cable length locked at ' +
                  Math.round(c.fixedLength) + 'px'
                );
              } else {
                if (!c.pathLocked && typeof c.fixedLength !== 'number' && !c.relocating) {
                  var seatTip = bootExitStub(c, end);
                  appendRoutePoint(c, seatTip.x, seatTip.y);
                  smoothDrawnRoute(c);
                }
                pluggedNow = true;
                flashPort(hit.el);
                if (c[endKey(otherEnd)].attached) {
                  lockDrawnPath(c);
                  endLinkSession({ silent: true });
                  setStatus(
                    'Patch connected · length ' + Math.round(c.fixedLength) +
                    'px · true catenary'
                  );
                } else if (hit.owner === 'ols') {
                  setStatus('OLS-35 · SC docked vertical · deep seat');
                }
              }
              }
            } else {
              setEndWorld(c, end, mouse.x, mouse.y);
              if (c.relocating && typeof c.fixedLength === 'number') {
                clampFreeEndToFixedLength(c, end);
                rebuildFixedLengthCatenary(c);
              } else if (!c.pathLocked && ensureRoute(c).length >= 3) {
                smoothDrawnRoute(c);
              }
              setStatus('Side ' + end + ' free · release over a port to snap-lock');
            }
          } else {
            setEndWorld(c, end, mouse.x, mouse.y);
            if (c.relocating && typeof c.fixedLength === 'number') {
              clampFreeEndToFixedLength(c, end);
              rebuildFixedLengthCatenary(c);
              setStatus(
                'Side ' + end + ' relocating · fixed length ' +
                Math.round(c.fixedLength) + 'px'
              );
            } else if (!c.pathLocked && ensureRoute(c).length >= 3) {
              smoothDrawnRoute(c);
              setStatus('Side ' + end + ' free · click-and-drag to draw, release on a port');
            } else {
              setStatus('Side ' + end + ' free · click-and-drag to draw, release on a port');
            }
          }

          endDragState = null;
          rebuildLayer();
          updateInspector();
          pushHistory();
          refreshBudget();
          if (pluggedNow && layer) {
            var live = layer.querySelector(
              '[data-pcord-id="' + id + '"][data-pcord-end="' + end + '"]'
            );
            if (live) {
              live.classList.add('is-just-plugged');
              setTimeout(function () { live.classList.remove('is-just-plugged'); }, 320);
            }
          }

          /* First end plugged — free end keeps its current position (no shrink/snap-back) */
          if (pluggedNow) {
            var other = oppositeEnd(end);
            if (c[endKey(end)].attached && !c[endKey(other)].attached) {
              armHalfConnected(c, other);
            }
          }
        }

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });
    });

    host.querySelectorAll('[data-pcord-node]').forEach(function (node) {
      node.addEventListener('click', function (e) {
        if (e.target.closest('.lab-pcord__end') || e.target.closest('[data-pcord-drag]')) return;
        selectCord(node.getAttribute('data-pcord-node'));
      });
    });
  }

  function polishToggleHtml(cordId, end, polish, label) {
    var isApc = normalizePolish(polish) === 'APC';
    return (
      '<p class="lab-inspector__label">' + label + '</p>' +
      '<div class="lab-polish-toggle" role="group" aria-label="' + label + '">' +
      '<button type="button" class="lab-polish-btn is-upc' + (!isApc ? ' is-active' : '') +
      '" data-pc-polish="' + cordId + ':' + end + ':PC">SC/PC · Blue</button>' +
      '<button type="button" class="lab-polish-btn is-apc' + (isApc ? ' is-active' : '') +
      '" data-pc-polish="' + cordId + ':' + end + ':APC">SC/APC · Green</button>' +
      '</div>'
    );
  }

  function updateInspector() {
    var card = document.getElementById('lab-inspector-card');
    var detail = document.getElementById('lab-inspector-detail');
    if (!card) return;
    if (selection.kind !== 'cord' || !selection.cordId) return;
    var c = findCord(selection.cordId);
    if (!c) return;

    var pathLoss = cordLossDb(c);
    var meter = isMeterMode(c);
    var meters = normalizeLengthMeters(
      typeof c.lengthMeters === 'number'
        ? c.lengthMeters
        : (typeof c.fixedLength === 'number' ? pxToMeters(c.fixedLength) : 3)
    );
    var chordPx = 0;
    if (c.sideA.attached && c.sideB.attached) {
      var ends = reliefSpanEnds(c);
      chordPx = dist2(ends.a.x, ends.a.y, ends.b.x, ends.b.y) || 0;
    }
    var excessM = meter && typeof c.fixedLength === 'number'
      ? Math.max(0, pxToMeters(c.fixedLength - chordPx))
      : 0;

    card.innerHTML =
      '<h2>Patch Cord</h2>' +
      '<p>' + (meter
        ? 'Meter Mode · fixed length · longer cable = deeper catenary sag'
        : 'Free Draw · drag ends to route · stretch mid-span when linked') + '</p>';

    if (!detail) return;
    detail.hidden = false;

    var presets = [1, 2, 3, 5, 10];
    var presetHtml = presets.map(function (m) {
      return (
        '<button type="button" class="lab-pcord-len-preset' +
        (meters === m ? ' is-active' : '') +
        '" data-pc-len-preset="' + c.id + ':' + m + '">' + m + ' m</button>'
      );
    }).join('');

    detail.innerHTML =
      '<div class="lab-pcord-config">' +
      '<p class="lab-inspector__label">Length control</p>' +
      '<div class="lab-pcord-len-mode" role="group" aria-label="Cable length mode">' +
      '<button type="button" class="lab-pcord-len-mode-btn' + (!meter ? ' is-active' : '') +
      '" data-pc-len-mode="' + c.id + ':free">Free Draw</button>' +
      '<button type="button" class="lab-pcord-len-mode-btn' + (meter ? ' is-active' : '') +
      '" data-pc-len-mode="' + c.id + ':meter">Meter Mode</button>' +
      '</div>' +
      '<div class="lab-pcord-meter"' + (meter ? '' : ' hidden') + '>' +
      '<label class="lab-pcord-meter-label" for="lab-pcord-len-input-' + c.id +
      '">Cable Length</label>' +
      '<div class="lab-cable-len-row">' +
      '<div class="lab-pcord-meter-stepper">' +
      '<button type="button" class="lab-pcord-meter-btn" data-pc-len-step="' +
      c.id + ':-0.5" aria-label="Decrease length">−</button>' +
      '<input id="lab-pcord-len-input-' + c.id +
      '" class="lab-pcord-meter-input" type="number" min="0.5" max="100" step="0.5" ' +
      'value="' + cordLengthDisplayValue(c) + '" data-pc-len-meters="' + c.id + '">' +
      '<button type="button" class="lab-pcord-meter-btn" data-pc-len-step="' +
      c.id + ':0.5" aria-label="Increase length">+</button>' +
      '</div>' +
      '<select class="lab-cable-len-unit" data-pc-len-unit="' + c.id + '" aria-label="Cable length unit">' +
      '<option value="m"' + (cordLengthUnit(c) === 'm' ? ' selected' : '') + '>m</option>' +
      '<option value="km"' + (cordLengthUnit(c) === 'km' ? ' selected' : '') + '>km</option>' +
      '</select>' +
      '</div>' +
      '<div class="lab-pcord-len-presets">' + presetHtml + '</div>' +
      '<p class="lab-pcord-meter-hint">' +
      (excessM > 0.05
        ? 'Span ' + pxToMeters(chordPx).toFixed(2) + ' m · excess ' +
          excessM.toFixed(2) + ' m → deeper sag'
        : 'Length longer than the port span hangs as gravitational sag') +
      '</p>' +
      '</div>' +
      polishToggleHtml(c.id, 'A', c.sideA.polish, 'Side A') +
      '<p class="lab-pcord-attach' + (c.sideA.mismatch ? ' is-warn' : '') + '">' +
      (c.sideA.attached
        ? 'A → ' + c.sideA.attached.label +
          (c.sideA.mismatch ? ' · MISMATCH +' + MISMATCH_PENALTY_DB + ' dB' : '')
        : 'A · unplugged') +
      '</p>' +
      polishToggleHtml(c.id, 'B', c.sideB.polish, 'Side B') +
      '<p class="lab-pcord-attach' + (c.sideB.mismatch ? ' is-warn' : '') + '">' +
      (c.sideB.attached
        ? 'B → ' + c.sideB.attached.label +
          (c.sideB.mismatch ? ' · MISMATCH +' + MISMATCH_PENALTY_DB + ' dB' : '')
        : 'B · unplugged') +
      '</p>' +
      '<div class="property-group lab-pcord-otdr-len-group">' +
      '<label class="lab-inspector__label" for="patchCordLengthInput-' + c.id + '">Cable Length</label>' +
      '<div class="lab-cable-len-row">' +
      '<input type="number" id="patchCordLengthInput-' + c.id +
      '" class="lab-pcord-otdr-len-input" data-pc-otdr-len="' + c.id +
      '" value="' + cordOtdrLengthDisplayValue(c).toFixed(1) + '" min="0" step="0.1">' +
      '<select id="patchCordUnitSelect-' + c.id +
      '" class="lab-cable-len-unit" data-pc-otdr-len-unit="' + c.id +
      '" aria-label="Cable length unit">' +
      '<option value="m"' + (cordOtdrLengthUnit(c) === 'm' ? ' selected' : '') + '>m</option>' +
      '<option value="km"' + (cordOtdrLengthUnit(c) === 'km' ? ' selected' : '') + '>km</option>' +
      '</select>' +
      '</div>' +
      '</div>' +
      '<div class="lab-spl-sheet">' +
      '<div><span>Side A</span><strong class="' +
      (normalizePolish(c.sideA.polish) === 'APC' ? 'is-apc-text' : 'is-upc-text') + '">' +
      displayPolish(c.sideA.polish) + '</strong></div>' +
      '<div><span>Side B</span><strong class="' +
      (normalizePolish(c.sideB.polish) === 'APC' ? 'is-apc-text' : 'is-upc-text') + '">' +
      displayPolish(c.sideB.polish) + '</strong></div>' +
      '<div><span>Path loss</span><strong>' + pathLoss.toFixed(2) + ' dB</strong></div>' +
      (typeof c.fixedLength === 'number'
        ? '<div><span>Length</span><strong>' +
          (meter
            ? meters.toFixed(1) + ' m'
            : Math.round(c.fixedLength) + ' px') +
          '</strong></div>'
        : '') +
      '</div>' +
      '<button type="button" class="lab-eject-btn" data-remove-pcord="' + c.id +
      '">Remove Patch Cord</button>' +
      '</div>';

    detail.querySelectorAll('[data-pc-polish]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var parts = btn.getAttribute('data-pc-polish').split(':');
        setEndPolish(parts[0], parts[1], parts[2]);
      });
    });
    detail.querySelectorAll('[data-pc-len-mode]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var parts = btn.getAttribute('data-pc-len-mode').split(':');
        setLengthMode(parts[0], parts[1]);
      });
    });
    detail.querySelectorAll('[data-pc-len-unit]').forEach(function (sel) {
      sel.addEventListener('change', function () {
        setLengthUnit(c.id, sel.value);
      });
    });
    detail.querySelectorAll('[data-pc-otdr-len-unit]').forEach(function (sel) {
      sel.addEventListener('change', function () {
        var lenInput = detail.querySelector('[data-pc-otdr-len="' + c.id + '"]');
        setOtdrCableLengthUnit(c.id, sel.value);
        if (lenInput) {
          setOtdrCableLength(c.id, lenInput.value, sel.value);
        }
      });
    });
    var otdrLenInput = detail.querySelector('[data-pc-otdr-len]');
    if (otdrLenInput) {
      otdrLenInput.addEventListener('input', function () {
        var unitSel = detail.querySelector('[data-pc-otdr-len-unit="' + c.id + '"]');
        var unit = unitSel ? unitSel.value : cordOtdrLengthUnit(c);
        applyPatchCordCableLengthModel(c, otdrLenInput.value, unit);
      });
      otdrLenInput.addEventListener('change', function () {
        var unitSel = detail.querySelector('[data-pc-otdr-len-unit="' + c.id + '"]');
        setOtdrCableLength(c.id, otdrLenInput.value, unitSel ? unitSel.value : cordOtdrLengthUnit(c));
      });
      otdrLenInput.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          var unitSel = detail.querySelector('[data-pc-otdr-len-unit="' + c.id + '"]');
          setOtdrCableLength(c.id, otdrLenInput.value, unitSel ? unitSel.value : cordOtdrLengthUnit(c));
        }
      });
    }
    detail.querySelectorAll('[data-pc-len-step]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var parts = btn.getAttribute('data-pc-len-step').split(':');
        var unitSel = detail.querySelector('[data-pc-len-unit="' + c.id + '"]');
        var unit = unitSel ? unitSel.value : cordLengthUnit(c);
        var cur = cordLengthDisplayValue(c);
        var step = Number(parts[1]);
        if (unit === 'km') step = step / 1000;
        setLengthMeters(parts[0], cur + step, unit);
      });
    });
    detail.querySelectorAll('[data-pc-len-preset]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var parts = btn.getAttribute('data-pc-len-preset').split(':');
        setLengthMeters(parts[0], parts[1], 'm');
      });
    });
    var lenInput = detail.querySelector('[data-pc-len-meters]');
    if (lenInput) {
      lenInput.addEventListener('input', function () {
        var v = Number(lenInput.value);
        if (!isFinite(v) || v < 0.5) return;
        var unitSel = detail.querySelector('[data-pc-len-unit="' + c.id + '"]');
        var unit = unitSel ? unitSel.value : cordLengthUnit(c);
        cord.lengthMode = 'meter';
        cord.lengthUnit = unit === 'km' ? 'km' : 'm';
        cord.lengthMeters = normalizeLengthMeters(cordLengthInputToMeters(v, unit));
        cord.otdrCableLengthM = cord.lengthMeters;
        cord.otdrLengthUnit = cord.lengthUnit;
        clearRopePhysics(cord.id);
        applyMeterLengthToCord(cord);
        rebuildLayer();
        updateFiberPath(cord);
      });
      lenInput.addEventListener('change', function () {
        var unitSel = detail.querySelector('[data-pc-len-unit="' + c.id + '"]');
        setLengthMeters(c.id, lenInput.value, unitSel ? unitSel.value : cordLengthUnit(c));
      });
      lenInput.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          var unitSel = detail.querySelector('[data-pc-len-unit="' + c.id + '"]');
          setLengthMeters(c.id, lenInput.value, unitSel ? unitSel.value : cordLengthUnit(c));
        }
      });
    }
    var rm = detail.querySelector('[data-remove-pcord]');
    if (rm) {
      rm.addEventListener('click', function () { removeCord(c.id); });
    }
  }

  function onViewChange() {
    rebuildLayer();
  }

  /** Shift freehand mid-span with a moved end (keeps far tip planted). */
  function morphRouteForEndMove(cord, end, dx, dy) {
    if ((!dx && !dy) || !cord) return;
    var route = ensureRoute(cord);
    if (!route.length) return;
    var n = route.length;
    var i;
    for (i = 0; i < n; i++) {
      /* t=0 at A, t=1 at B — weight toward the moved connector */
      var t = (i + 1) / (n + 1);
      var w = end === 'A' ? (1 - t) : t;
      route[i].x += dx * w;
      route[i].y += dy * w;
    }
  }

  /**
   * After equipment moves (coupler / splitter / OLT): reseat plugs and
   * rebuild or morph the cable so heads + curve travel as one unit.
   */
  function onLayoutChange(payload) {
    if (!layer) return;
    if (payload && payload.source === 'bend-jig') {
      cords.forEach(function (c) { updateFiberPath(c); });
      refreshBudget();
      if (payload.live) return;
    }
    if (payload && payload.source === 'spool') {
      cords.forEach(function (c) { updateFiberPath(c); });
      if (payload.live) return;
    }
    var onlyCoupler = payload && payload.source === 'coupler' ? payload.couplerId : null;
    var onlyVfl = payload && payload.source === 'vfl' ? payload.vflId : null;

    cords.forEach(function (c) {
      if (onlyCoupler) {
        var aOnC = c.sideA.attached && c.sideA.attached.owner === 'coupler' &&
          c.sideA.attached.couplerId === onlyCoupler;
        var bOnC = c.sideB.attached && c.sideB.attached.owner === 'coupler' &&
          c.sideB.attached.couplerId === onlyCoupler;
        if (!aOnC && !bOnC) return;
      }
      if (onlyVfl) {
        var aOnV = c.sideA.attached && c.sideA.attached.owner === 'vfl' &&
          c.sideA.attached.vflId === onlyVfl;
        var bOnV = c.sideB.attached && c.sideB.attached.owner === 'vfl' &&
          c.sideB.attached.vflId === onlyVfl;
        if (!aOnV && !bOnV) return;
      }

      var oax = c.ax;
      var oay = c.ay;
      var obx = c.bx;
      var oby = c.by;
      syncAttachedPositions(c);
      var dax = c.ax - oax;
      var day = c.ay - oay;
      var dbx = c.bx - obx;
      var dby = c.by - oby;
      if (!dax && !day && !dbx && !dby) {
        updateFiberPath(c);
        return;
      }

      if (typeof c.fixedLength === 'number') {
        /* Locked physical length — true catenary follows the new port span */
        rebuildFixedLengthCatenary(c);
      } else {
        if ((dax || day) && !(dbx || dby)) morphRouteForEndMove(c, 'A', dax, day);
        else if ((dbx || dby) && !(dax || day)) morphRouteForEndMove(c, 'B', dbx, dby);
        else if ((dax || day) && (dbx || dby)) {
          if (dax === dbx && day === dby) {
            var route = ensureRoute(c);
            var i;
            for (i = 0; i < route.length; i++) {
              route[i].x += dax;
              route[i].y += day;
            }
          } else {
            morphRouteForEndMove(c, 'A', dax, day);
            morphRouteForEndMove(c, 'B', dbx, dby);
          }
        }
      }
      updateFiberPath(c);
    });
  }

  function resyncAllAttachments() {
    if (!layer) return;
    cords.forEach(function (c) {
      syncAttachedPositions(c);
      updateFiberPath(c);
    });
    refreshBudget();
    if (global.FtthLab && typeof FtthLab.refreshOtdrPorts === 'function') {
      FtthLab.refreshOtdrPorts();
    }
  }

  function cancelPatch() {
    endDragState = null;
    clearAllRopePhysics();
    cancelLinkSession();
  }

  function onToolboxClaim(payload) {
    var id = payload && payload.toolId;
    if (id === 'patch-cord') return;
    if (selectedTool) {
      selectedTool = null;
      renderToolbox();
    }
  }

  function clearSelection() {
    selection = { kind: 'none', cordId: null };
    selectedTool = null;
    endDragState = null;
    clearAllRopePhysics();
    cancelLinkSession();
    renderToolbox();
    rebuildLayer();
  }

  function refreshCouplerPolish(couplerId, polish) {
    polish = portPolishNorm(polish) === 'APC' ? 'APC' : 'UPC';
    var warned = false;
    cords.forEach(function (c) {
      ['A', 'B'].forEach(function (end) {
        var side = c[endKey(end)];
        if (!side.attached || side.attached.owner !== 'coupler') return;
        if (side.attached.couplerId !== couplerId) return;
        side.attached.polish = polish;
        side.attached.label =
          'SC Coupler ' + side.attached.port + ' · ' +
          (polish === 'APC' ? 'SC/APC' : 'SC/PC');
        side.mismatch = !polishMatch(side.polish, polish);
        side.attached.mismatch = side.mismatch;
        if (side.mismatch) warned = true;
      });
    });
    if (warned) showWarning(MISMATCH_MSG);
    rebuildLayer();
    updateInspector();
    refreshBudget();
  }

  function detachPortsForCoupler(couplerId) {
    var changed = false;
    cords.forEach(function (c) {
      ['A', 'B'].forEach(function (end) {
        var side = c[endKey(end)];
        if (!side.attached || side.attached.owner !== 'coupler') return;
        if (side.attached.couplerId !== couplerId) return;
        detachEnd(c, end);
        changed = true;
      });
    });
    if (changed) {
      rebuildLayer();
      updateInspector();
      refreshBudget();
    }
  }

  function detachPcordsFromOltPort(slot, port) {
    slot = parseInt(slot, 10);
    port = parseInt(port, 10);
    var changed = false;
    cords.forEach(function (c) {
      ['A', 'B'].forEach(function (end) {
        var side = c[endKey(end)];
        var att = side.attached;
        if (att && att.owner === 'olt' && att.slot === slot && att.oltPort === port) {
          detachEnd(c, end);
          changed = true;
        }
      });
    });
    if (changed) {
      rebuildLayer();
      updateInspector();
      refreshBudget();
    }
  }

  function detachPcordsFromVfl(vflId, exceptCordId, exceptEnd) {
    cords.forEach(function (c) {
      ['A', 'B'].forEach(function (end) {
        if (c.id === exceptCordId && end === exceptEnd) return;
        var side = c[endKey(end)];
        if (side.attached && side.attached.owner === 'vfl' &&
            side.attached.vflId === vflId) {
          detachEnd(c, end);
        }
      });
    });
    rebuildLayer();
    refreshBudget();
  }

  /**
   * Move every patch cord plugged into a VFL as one rigid group with the pen.
   * opts.live — update SVG paths without full layer rebuild (during drag).
   */
  function translateForVfl(vflId, dx, dy, opts) {
    opts = opts || {};
    if (!dx && !dy) return;
    var changed = false;
    cords.forEach(function (c) {
      var onVfl = false;
      ['A', 'B'].forEach(function (end) {
        var side = c[endKey(end)];
        if (side.attached && side.attached.owner === 'vfl' &&
            side.attached.vflId === vflId) {
          onVfl = true;
        }
      });
      if (!onVfl) return;
      changed = true;
      c.ax += dx;
      c.ay += dy;
      c.bx += dx;
      c.by += dy;
      var route = ensureRoute(c);
      var i;
      for (i = 0; i < route.length; i++) {
        route[i].x += dx;
        route[i].y += dy;
      }
      syncAttachedPositions(c);
      if (opts.live) updateFiberPath(c);
    });
    if (changed && !opts.live) rebuildLayer();
    if (changed && global.FtthLab && typeof FtthLab.refreshVflLaser === 'function') {
      FtthLab.refreshVflLaser();
    }
  }

  function mount(api) {
    ctx = api || {};
    cords = [];
    seq = 0;
    history = [];
    historyIndex = -1;
    historyLocked = false;
    selection = { kind: 'none', cordId: null };
    selectedTool = null;
    dragLib = null;
    endDragState = null;
    clearAllRopePhysics();
    endLinkSession({ silent: true });
    renderToolbox();
    bindStageDrop();
    bindPortLifecycle();
    ensureLayer();
    rebuildLayer();
    pushHistory();
    refreshBudget();

    if (global.FtthLab) {
      var prevTry = FtthLab.tryPatchPort;
      FtthLab.tryPatchPort = function (portDesc) {
        if (tryPatchPort(portDesc)) return true;
        if (typeof prevTry === 'function' && prevTry !== tryPatchPort) {
          return prevTry(portDesc);
        }
        return false;
      };
      FtthLab.refreshCouplerPolish = refreshCouplerPolish;
      FtthLab.detachPortsForCoupler = detachPortsForCoupler;
      FtthLab.detachPcordsFromVfl = detachPcordsFromVfl;

      var prevTranslate = FtthLab.translateVflGroup;
      FtthLab.translateVflGroup = function (vflId, dx, dy, opts) {
        translateForVfl(vflId, dx, dy, opts);
        if (typeof prevTranslate === 'function' && prevTranslate !== translateForVfl) {
          prevTranslate(vflId, dx, dy, opts);
        }
      };

      FtthLab.releasePatchCordFromBendJig = function (cordId, jigId) {
        var changed = false;
        cords.forEach(function (c) {
          if ((cordId && c.id === cordId) || (jigId && c.bendJigId === jigId)) {
            c.bendJigId = null;
            c.bendJigIgnoreId = jigId || c.bendJigIgnoreId || null;
            changed = true;
            updateFiberPath(c);
          }
        });
        if (changed) {
          rebuildLayer();
          refreshBudget();
        }
      };

      var prevGraph = FtthLab.getFiberLaserGraph;
      FtthLab.getFiberLaserGraph = function () {
        var base = typeof prevGraph === 'function'
          ? (prevGraph() || { pcords: [], pigtails: [] })
          : { pcords: [], pigtails: [] };
        base.pcords = getLaserGraphNodes();
        return base;
      };

      var prevGlow = FtthLab.applyFiberLaserGlow;
      FtthLab.applyFiberLaserGlow = function (targets) {
        applyLaserGlow(
          targets && targets.pcords,
          targets && targets.mode,
          { pcordExits: targets && targets.pcordExits }
        );
        if (typeof prevGlow === 'function') prevGlow(targets);
      };

      /* Shared continuous-catenary sampler for pigtails / other fiber tools */
      FtthLab.sampleFiberCatenary = function (p0, p3, length, count) {
        return sampleTrueCatenary(p0, p3, length, count || CATENARY_SAMPLES);
      };
      FtthLab.fiberCatenaryLengthForSag = catenaryLengthForSag;
      FtthLab.fiberCatenarySagDepth = catenarySagDepth;
      FtthLab.CATENARY_DEFAULT_SLACK = CATENARY_DEFAULT_SLACK;

      FtthLab.hitTestLabPort = hitTestPort;
      FtthLab.isPatchOnOltPort = isPatchOnOltPort;
      FtthLab.detachPcordsFromOltPort = detachPcordsFromOltPort;
    }
  }

  var tool = {
    id: 'patch-cord',
    mount: mount,
    onViewChange: onViewChange,
    onLayoutChange: onLayoutChange,
    cancelPatch: cancelPatch,
    clearSelection: clearSelection,
    onToolboxClaim: onToolboxClaim,
    undo: undo,
    redo: redo,
    deleteSelected: deleteSelected,
    placeCord: placeCord,
    startLinkFromPort: startLinkFromPort,
    tryPatchPort: tryPatchPort,
    getNetworkLossDb: getNetworkLossDb,
    getMismatchCount: getMismatchCount,
    rebuildLayer: rebuildLayer,
    getLaserGraphNodes: getLaserGraphNodes,
    applyLaserGlow: applyLaserGlow,
    translateForVfl: translateForVfl,
    detachPcordsFromOltPort: detachPcordsFromOltPort,
    onLabConfigChanged: function (payload) {
      if (global.FtthLab && typeof FtthLab.handleToolboxConfigChange === 'function') {
        FtthLab.handleToolboxConfigChange('patchcord', 'lab-patchcord-tree', renderToolbox, payload && payload.config);
      } else {
        renderToolbox();
      }
      updateInspector();
    },
    exportProjectState: captureSnapshot,
    importProjectState: applySnapshot,
    resyncAllAttachments: resyncAllAttachments,
    resetProjectState: function () {
      applySnapshot({ cords: [], seq: 0 });
    },
  };

  function tryRegister() {
    if (global.FtthLab && typeof FtthLab.registerTool === 'function') {
      FtthLab.registerTool('patch-cord', tool);
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
