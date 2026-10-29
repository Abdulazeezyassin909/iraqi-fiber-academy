/**
 * Visual Fault Locator (VFL) — laser pen for continuity / fault location.
 * Tip docks on patch-cord ends, pigtail connectors, or SC coupler ports;
 * when powered, injects a visible red glow along continuous fiber paths.
 */
(function (global) {
  'use strict';

  var VFL_W = 28;
  var VFL_H = 78;
  /* Center of exposed 2.5 mm SC adapter ferrule — plug target for Patch Cord / Pigtail */
  var PORT_LOCAL_X = 14;
  var PORT_LOCAL_Y = 9;
  var HISTORY_MAX = 60;

  var ctx = null;
  var layer = null;
  var devices = [];
  var seq = 0;
  var selection = { kind: 'none', id: null };
  var dragLib = null;
  var selectedTool = null;
  var history = [];
  var historyIndex = -1;
  var historyLocked = false;

  function setStatus(msg) {
    if (global.FtthLab && FtthLab.setStatus) FtthLab.setStatus(msg);
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

  function claimSelection() {
    if (global.FtthLab && typeof FtthLab.setSelectionOwner === 'function') {
      FtthLab.setSelectionOwner('vfl');
    }
  }

  function cloneJson(v) {
    return JSON.parse(JSON.stringify(v == null ? null : v));
  }

  function findDevice(id) {
    for (var i = 0; i < devices.length; i++) {
      if (devices[i].id === id) return devices[i];
    }
    return null;
  }

  function dist2(ax, ay, bx, by) {
    var dx = ax - bx;
    var dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function portWorld(d) {
    return { x: d.x + PORT_LOCAL_X, y: d.y + PORT_LOCAL_Y };
  }

  function getVflPortWorld(vflId) {
    var d = findDevice(vflId);
    if (!d) return null;
    var pw = portWorld(d);
    /* rot 180°: SC housing seated on top adapter, boot/cable exits straight up */
    return { x: pw.x, y: pw.y, rot: 180 };
  }

  /** What is currently seated in this VFL's open SC adapter (from fiber graph). */
  function syncPortPlugState(d) {
    if (!d) return;
    d.plugged = null;
    var graph = null;
    if (global.FtthLab && typeof FtthLab.getFiberLaserGraph === 'function') {
      graph = FtthLab.getFiberLaserGraph();
    }
    graph = graph || { pcords: [], pigtails: [] };
    var i;
    var end;
    var att;
    for (i = 0; i < (graph.pcords || []).length; i++) {
      var c = graph.pcords[i];
      ['A', 'B'].forEach(function (e) {
        if (d.plugged) return;
        att = e === 'A' ? c.sideA : c.sideB;
        if (att && att.owner === 'vfl' && att.vflId === d.id) {
          d.plugged = {
            kind: 'pcord',
            id: c.id,
            end: e,
            label: 'SC Patch Cord · End ' + e,
          };
        }
      });
    }
    for (i = 0; i < (graph.pigtails || []).length; i++) {
      var p = graph.pigtails[i];
      if (d.plugged) break;
      att = p.connector;
      if (att && att.owner === 'vfl' && att.vflId === d.id) {
        d.plugged = {
          kind: 'pigtail',
          id: p.id,
          end: 'A',
          label: 'SC Pigtail · Connector',
        };
      }
    }
  }

  function normalizeMode(v) {
    var s = String(v || '').toUpperCase();
    if (s === 'CW' || s === 'ON' || s === '1' || s === 'TRUE' || s === 'CONTINUOUS') return 'CW';
    if (s === 'GLINT' || s === 'PULSE' || s === 'FLASH' || s === 'BLINK') return 'GLINT';
    return 'OFF';
  }

  function modeLabel(mode) {
    mode = normalizeMode(mode);
    if (mode === 'CW') return 'CW · Continuous';
    if (mode === 'GLINT') return 'GLINT · Pulsing';
    return 'OFF';
  }

  function isLaserOn(d) {
    return normalizeMode(d && d.mode) !== 'OFF';
  }

  /** Effective emit mode across all active VFLs with a plugged fiber (GLINT wins over CW). */
  function activeEmitMode() {
    var mode = 'OFF';
    devices.forEach(function (d) {
      if (!isLaserOn(d)) return;
      syncPortPlugState(d);
      if (!d.plugged) return;
      var m = normalizeMode(d.mode);
      if (m === 'GLINT') mode = 'GLINT';
      else if (m === 'CW' && mode !== 'GLINT') mode = 'CW';
    });
    return mode;
  }

  function migrateDevice(d) {
    if (!d) return d;
    if (!d.mode && typeof d.power === 'boolean') d.mode = d.power ? 'CW' : 'OFF';
    d.mode = normalizeMode(d.mode);
    delete d.power;
    delete d.attached;
    if (!('plugged' in d)) d.plugged = null;
    return d;
  }

  function captureSnapshot() {
    return { devices: cloneJson(devices), seq: seq };
  }

  function applySnapshot(snap) {
    if (!snap) return;
    historyLocked = true;
    devices = (cloneJson(snap.devices) || []).map(migrateDevice);
    seq = snap.seq || 0;
    selection = { kind: 'none', id: null };
    rebuildLayer();
    updateInspector();
    refreshLaserGlow();
    historyLocked = false;
  }

  function pushHistory() {
    if (historyLocked) return;
    history = history.slice(0, historyIndex + 1);
    history.push(captureSnapshot());
    if (history.length > HISTORY_MAX) history.shift();
    historyIndex = history.length - 1;
    if (historyIndex > 0 && global.FtthLab && typeof FtthLab.recordHistory === 'function') {
      FtthLab.recordHistory('vfl');
    }
  }

  function undo() {
    if (historyIndex <= 0) return false;
    historyIndex -= 1;
    applySnapshot(history[historyIndex]);
    setStatus('Undo · VFL');
    return true;
  }

  function redo() {
    if (historyIndex >= history.length - 1) return false;
    historyIndex += 1;
    applySnapshot(history[historyIndex]);
    setStatus('Redo · VFL');
    return true;
  }

  function defaultPos() {
    var w = getWorldSize();
    return {
      x: Math.round(w / 2 + 140 + devices.length * 24),
      y: Math.round(w / 2 + 280 + (devices.length % 3) * 36),
    };
  }

  function placeVfl(x, y) {
    seq += 1;
    var pos = (typeof x === 'number' && typeof y === 'number')
      ? { x: x, y: y }
      : defaultPos();
    var item = {
      id: 'vfl-' + seq,
      x: pos.x,
      y: pos.y,
      mode: 'OFF',
      scale: 1,
      plugged: null,
    };
    devices.push(item);
    selectVfl(item.id);
    rebuildLayer();
    pushHistory();
    refreshLaserGlow();
    setStatus('VFL placed · plug Patch Cord or SC Pigtail into central SC port · set CW or GLINT');
    return item;
  }

  function removeVfl(id) {
    devices = devices.filter(function (d) { return d.id !== id; });
    if (selection.id === id) selection = { kind: 'none', id: null };
    rebuildLayer();
    updateInspector();
    pushHistory();
    refreshLaserGlow();
    setStatus('VFL removed');
  }

  function selectVfl(id) {
    selection = { kind: 'vfl', id: id };
    claimSelection();
    updateInspector();
    rebuildLayer();
  }

  function switchTopPct(mode) {
    mode = normalizeMode(mode);
    if (mode === 'CW') return '14%';
    if (mode === 'GLINT') return '86%';
    return '50%';
  }

  function modeFromTrackRatio(t) {
    if (t < 0.33) return 'CW';
    if (t < 0.67) return 'OFF';
    return 'GLINT';
  }

  function setMode(id, mode) {
    var d = findDevice(id);
    if (!d) return;
    var next = normalizeMode(mode);
    if (normalizeMode(d.mode) === next) {
      refreshLaserGlow();
      updateInspector();
      return;
    }
    d.mode = next;
    rebuildLayer();
    updateInspector();
    pushHistory();
    refreshLaserGlow();
    setStatus('VFL · ' + modeLabel(d.mode) + ' · 650 nm · 10 mW');
  }

  /** Live track drag — update UI + laser without history spam. */
  function applyModeLive(id, mode) {
    var d = findDevice(id);
    if (!d) return;
    var next = normalizeMode(mode);
    if (normalizeMode(d.mode) === next) return;
    d.mode = next;
    var node = layer && layer.querySelector('[data-vfl-node="' + id + '"]');
    if (node) {
      node.classList.remove('is-mode-cw', 'is-mode-off', 'is-mode-glint');
      node.classList.add('is-mode-' + next.toLowerCase());
      var slider = node.querySelector('.lab-vfl__slider');
      if (slider) slider.style.top = switchTopPct(next);
      node.querySelectorAll('[data-vfl-set-mode]').forEach(function (btn) {
        var m = (btn.getAttribute('data-vfl-set-mode') || '').split(':')[1];
        btn.classList.toggle('is-active', m === next);
      });
      var laserOn = next !== 'OFF';
      var beam = node.querySelector('.lab-vfl__beam');
      if (laserOn && !beam) {
        var span = document.createElement('span');
        span.className = 'lab-vfl__beam' + (next === 'GLINT' ? ' is-glint' : '');
        span.setAttribute('aria-hidden', 'true');
        node.appendChild(span);
      } else if (!laserOn && beam) {
        beam.parentNode.removeChild(beam);
      } else if (beam) {
        beam.classList.toggle('is-glint', next === 'GLINT');
      }
      var port = node.querySelector('[data-vfl-port]');
      if (port) port.classList.toggle('is-emitting', laserOn);
    }
    refreshLaserGlow();
    updateInspector();
  }

  /* ─── Laser propagation (emit from central SC adapter when fiber is plugged) ─── */

  /** Open end — ferrule or cleave exposed to workspace; beam may exit here. */
  function isOpenEnd(att) {
    return !att;
  }

  function findPcord(graph, id) {
    var i;
    for (i = 0; i < (graph.pcords || []).length; i++) {
      if (graph.pcords[i].id === id) return graph.pcords[i];
    }
    return null;
  }

  function findPigtail(graph, id) {
    var i;
    for (i = 0; i < (graph.pigtails || []).length; i++) {
      if (graph.pigtails[i].id === id) return graph.pigtails[i];
    }
    return null;
  }

  function collectLaserTargets() {
    var pcords = {};
    var pigtails = {};
    var pcordExits = {};
    var pigtailExits = {};
    var splitterExits = {};
    var visitedSplEntry = {};
    var visitedCplEntry = {};
    var couplerPass = {};
    var visitedPcordHop = {};
    var visitedMemberHop = {};

    function markPcord(id) {
      if (!id || pcords[id]) return false;
      pcords[id] = true;
      return true;
    }
    function markPigtail(id) {
      if (!id || pigtails[id]) return false;
      pigtails[id] = true;
      return true;
    }

    var graph = null;
    if (global.FtthLab && typeof FtthLab.getFiberLaserGraph === 'function') {
      graph = FtthLab.getFiberLaserGraph();
    }
    graph = graph || { pcords: [], pigtails: [] };

    function splitterModels() {
      if (global.FtthLab && typeof FtthLab.getSplitterLaserModels === 'function') {
        return FtthLab.getSplitterLaserModels() || [];
      }
      return [];
    }

    function findModel(sid) {
      var list = splitterModels();
      var i;
      for (i = 0; i < list.length; i++) {
        if (list[i].id === sid) return list[i];
      }
      return null;
    }

    function findFiberOnSplitterPort(sid, portId) {
      var i;
      var att;
      for (i = 0; i < (graph.pcords || []).length; i++) {
        var c = graph.pcords[i];
        att = c.sideA;
        if (att && att.owner === 'splitter' && att.splitterId === sid &&
            att.port === portId) {
          return { kind: 'pcord', id: c.id, fromEnd: 'A' };
        }
        att = c.sideB;
        if (att && att.owner === 'splitter' && att.splitterId === sid &&
            att.port === portId) {
          return { kind: 'pcord', id: c.id, fromEnd: 'B' };
        }
      }
      for (i = 0; i < (graph.pigtails || []).length; i++) {
        var p = graph.pigtails[i];
        att = p.connector;
        if (att && att.owner === 'splitter' && att.splitterId === sid &&
            att.port === portId) {
          return { kind: 'pigtail', id: p.id };
        }
      }
      return null;
    }

    function normalizeCplPort(port) {
      var s = String(port == null ? 'A' : port).toUpperCase();
      if (s === 'B' || s === '2') return 'B';
      return 'A';
    }

    function oppositeCplPort(port) {
      if (global.FtthLab && typeof FtthLab.getCouplerOppositePort === 'function') {
        return FtthLab.getCouplerOppositePort(port);
      }
      return normalizeCplPort(port) === 'B' ? 'A' : 'B';
    }

    function couplerAttachment(att) {
      if (!att || att.owner !== 'coupler' || !att.couplerId) return null;
      return {
        couplerId: att.couplerId,
        port: normalizeCplPort(att.port),
      };
    }

    function buildCouplerFiberMap() {
      var map = {};
      function add(cid, face, fiber) {
        if (!map[cid]) map[cid] = { A: [], B: [] };
        map[cid][face].push(fiber);
      }
      (graph.pcords || []).forEach(function (c) {
        var sides = [
          { att: c.sideA, fromEnd: 'A' },
          { att: c.sideB, fromEnd: 'B' },
        ];
        sides.forEach(function (s) {
          var cpl = couplerAttachment(s.att);
          if (!cpl) return;
          add(cpl.couplerId, cpl.port, { kind: 'pcord', id: c.id, fromEnd: s.fromEnd });
        });
      });
      (graph.pigtails || []).forEach(function (p) {
        var cpl = couplerAttachment(p.connector);
        if (!cpl) return;
        add(cpl.couplerId, cpl.port, { kind: 'pigtail', id: p.id });
      });
      return map;
    }

    function isFiberLit(fiber) {
      if (!fiber) return false;
      return fiber.kind === 'pcord' ? !!pcords[fiber.id] : !!pigtails[fiber.id];
    }

    function findFibersOnCouplerPort(cid, portId) {
      var face = normalizeCplPort(portId);
      var map = buildCouplerFiberMap();
      var ports = map[cid];
      return ports ? (ports[face] || []).slice() : [];
    }

    function findFiberOnCouplerPort(cid, portId) {
      var list = findFibersOnCouplerPort(cid, portId);
      return list.length ? list[0] : null;
    }

    /**
     * SC adapter = optically transparent bridge.
     * Light on face A passes to face B (and reverse) at full source intensity.
     */
    function injectCoupler(cid, entryPort) {
      if (!cid || entryPort == null) return;
      var face = normalizeCplPort(entryPort);
      var key = cid + ':' + face;
      if (visitedCplEntry[key]) return;
      visitedCplEntry[key] = true;
      couplerPass[cid] = true;

      var exitFace = oppositeCplPort(face);
      var fibers = findFibersOnCouplerPort(cid, exitFace);
      var fi;
      for (fi = 0; fi < fibers.length; fi++) {
        var fiber = fibers[fi];
        if (fiber.kind === 'pcord') injectPcord(fiber.id, fiber.fromEnd);
        else injectPigtail(fiber.id, { enteredViaCoupler: true });
      }
    }

    /**
     * After any fiber is lit, bridge every coupler whose opposite port is also
     * seated so VFL / power traverse A↔B even if the first hop missed a port.
     */
    function bridgeCouplerPassThrough() {
      var fiberMap = buildCouplerFiberMap();
      var changed = true;
      var guard = 0;
      while (changed && guard < 24) {
        changed = false;
        guard += 1;
        Object.keys(fiberMap).forEach(function (cid) {
          var ports = fiberMap[cid];
          if (!ports.A.length || !ports.B.length) return;
          var aLit = ports.A.some(isFiberLit);
          var bLit = ports.B.some(isFiberLit);
          if (!aLit && !bLit) return;
          couplerPass[cid] = true;
          if (aLit) {
            ports.B.forEach(function (fiber) {
              if (isFiberLit(fiber)) return;
              if (fiber.kind === 'pcord') {
                injectPcord(fiber.id, fiber.fromEnd);
                changed = true;
              } else {
                injectPigtail(fiber.id, { enteredViaCoupler: true });
                changed = true;
              }
            });
          }
          if (bLit) {
            ports.A.forEach(function (fiber) {
              if (isFiberLit(fiber)) return;
              if (fiber.kind === 'pcord') {
                injectPcord(fiber.id, fiber.fromEnd);
                changed = true;
              } else {
                injectPigtail(fiber.id, { enteredViaCoupler: true });
                changed = true;
              }
            });
          }
        });
      }
    }

    function emitFromSplitterPort(sid, portSpec, intensity) {
      var portId = typeof portSpec === 'string' ? portSpec : portSpec.id;
      var dustCap = typeof portSpec === 'object' ? !!portSpec.dustCap : false;
      var level = intensity === 'high' ? 'high' : 'dim';
      var fiber = findFiberOnSplitterPort(sid, portId);
      if (fiber) {
        if (fiber.kind === 'pcord') injectPcord(fiber.id, fiber.fromEnd);
        else injectPigtail(fiber.id);
        return;
      }
      /* Open ferrule (dust cap removed) → beam exits this cassette port */
      if (dustCap) return;
      var key = sid + ':' + portId;
      /* High reverse injection wins over dim forward split if both present */
      if (splitterExits[key] === 'high') return;
      splitterExits[key] = level;
    }

    /**
     * PLC optics:
     *  A) Light on IN → split to all OUTs at dim (attenuated) intensity
     *  B) Light on OUT → reverse to all INs (+ other open INs) at high intensity
     */
    function injectSplitter(sid, entryPort) {
      if (!sid || !entryPort) return;
      var key = sid + ':' + entryPort;
      if (visitedSplEntry[key]) return;
      visitedSplEntry[key] = true;

      var model = findModel(sid);
      if (!model) return;

      function portIdOf(spec) {
        return typeof spec === 'string' ? spec : spec.id;
      }

      var isIn = false;
      var isOut = false;
      var ii;
      for (ii = 0; ii < (model.inputs || []).length; ii++) {
        if (portIdOf(model.inputs[ii]) === entryPort) {
          isIn = true;
          break;
        }
      }
      for (ii = 0; ii < (model.outputs || []).length; ii++) {
        if (portIdOf(model.outputs[ii]) === entryPort) {
          isOut = true;
          break;
        }
      }

      if (isIn) {
        /* Scenario A — forward split, attenuated on every OUT */
        (model.outputs || []).forEach(function (op) {
          emitFromSplitterPort(sid, op, 'dim');
        });
      } else if (isOut) {
        /* Scenario B — reverse: concentrated high intensity on every IN */
        (model.inputs || []).forEach(function (ip) {
          emitFromSplitterPort(sid, ip, 'high');
        });
        /* Other open INs already covered; sibling OUTs stay dark (high isolation) */
      }
    }

    /**
     * Light enters at fromEnd and travels toward the opposite end.
     * Open end → workspace exit flare. Splitter → optical fan-out.
     * Coupler → full-pass to opposite face at matching intensity.
     * OLT terminates the beam.
     */
    function injectPcord(id, fromEnd) {
      var hop = id + ':' + (fromEnd === 'B' ? 'B' : 'A');
      if (visitedPcordHop[hop]) return;
      visitedPcordHop[hop] = true;
      markPcord(id);
      var c = findPcord(graph, id);
      if (!c) return;
      var exitEnd = fromEnd === 'A' ? 'B' : 'A';
      var exitAtt = exitEnd === 'A' ? c.sideA : c.sideB;
      if (isOpenEnd(exitAtt)) {
        pcordExits[id] = exitEnd;
        return;
      }
      if (exitAtt && exitAtt.owner === 'splitter') {
        injectSplitter(exitAtt.splitterId, exitAtt.port);
        return;
      }
      if (exitAtt && exitAtt.owner === 'coupler') {
        injectCoupler(exitAtt.couplerId, exitAtt.port);
        return;
      }
      /* OLT / VFL far end: core glows, no further hop */
    }

    function isCableNode(p) {
      return !!(p && p.type === 'cable');
    }

    function cableUiEnd(end) {
      return end === 'start' ? 'A' : 'B';
    }

    function oppositeCableMemberEnd(end) {
      return end === 'start' ? 'end' : 'start';
    }

    function cablePartnerAtEnd(p, end) {
      if (!p || !isCableNode(p)) return null;
      return end === 'start' ? (p.startFusedPartnerId || null) : (p.endFusedPartnerId || null);
    }

    function resolvePartnerEntryEnd(partner, fromMemberId) {
      if (!partner || !fromMemberId) return null;
      if (isCableNode(partner)) {
        if (partner.startFusedPartnerId === fromMemberId) return 'start';
        if (partner.endFusedPartnerId === fromMemberId) return 'end';
        return null;
      }
      if (partner.fusedPartnerId === fromMemberId) return 'end';
      return 'end';
    }

    /** Mark laser exit at a free cable terminal (A = start, B = end). */
    function markCableExit(p, end) {
      if (!p || !isCableNode(p)) return;
      if (cablePartnerAtEnd(p, end)) return;
      pigtailExits[p.id] = cableUiEnd(end);
    }

    /** Light crosses a fusion weld into the next chain member. */
    function injectFromFusion(partnerId, fromMemberId) {
      if (!partnerId || !fromMemberId) return;
      var partner = findPigtail(graph, partnerId);
      if (!partner) return;
      var entryEnd = resolvePartnerEntryEnd(partner, fromMemberId);
      if (!entryEnd) return;
      if (isCableNode(partner)) {
        injectCable(partner.id, { entryEnd: entryEnd, fromFusion: true });
      } else {
        injectPigtail(partner.id, { entryEnd: entryEnd, fromFusion: true });
      }
    }

    /**
     * Light enters at one cable end, traverses the full span, and continues
     * through any fusion on the opposite terminal.
     */
    function injectCable(id, opts) {
      opts = opts || {};
      if (!id) return;
      var p = findPigtail(graph, id);
      if (!p || !isCableNode(p)) return;
      var entryEnd = opts.entryEnd;
      if (entryEnd !== 'start' && entryEnd !== 'end') return;
      var hopKey = id + ':entry-' + entryEnd;
      if (visitedMemberHop[hopKey]) return;
      visitedMemberHop[hopKey] = true;
      markPigtail(id);

      var exitEnd = oppositeCableMemberEnd(entryEnd);
      var partnerId = cablePartnerAtEnd(p, exitEnd);
      if (partnerId) {
        injectFromFusion(partnerId, id);
        return;
      }
      markCableExit(p, exitEnd);
    }

    /**
     * Pigtail: light enters at connector (A) or tail/weld (B) and propagates
     * through fusions across N-segment welded chains.
     */
    function injectPigtail(id, opts) {
      opts = opts || {};
      if (!id) return;
      var p = findPigtail(graph, id);
      if (!p) return;
      if (isCableNode(p)) {
        injectCable(id, opts);
        return;
      }

      var entryEnd = opts.entryEnd || 'connector';
      var hopKey = id + ':entry-' + entryEnd;
      if (visitedMemberHop[hopKey]) return;
      visitedMemberHop[hopKey] = true;
      markPigtail(id);

      if (entryEnd === 'connector') {
        var connAtt = p.connector;
        if (connAtt && connAtt.owner === 'coupler' && !opts.enteredViaCoupler) {
          injectCoupler(connAtt.couplerId, connAtt.port);
        }
        if (p.fusedPartnerId) {
          injectFromFusion(p.fusedPartnerId, id);
          return;
        }
        if (isOpenEnd(p.tail)) {
          pigtailExits[p.id] = 'B';
        }
        return;
      }

      /* Entered at tail / fusion weld — propagate toward connector. */
      connAtt = p.connector;
      if (connAtt && connAtt.owner === 'coupler' && !opts.enteredViaCoupler) {
        injectCoupler(connAtt.couplerId, connAtt.port);
      }
      if (isOpenEnd(p.connector)) {
        pigtailExits[p.id] = 'A';
      }
    }

    devices.forEach(function (d) {
      if (!isLaserOn(d)) return;
      (graph.pcords || []).forEach(function (c) {
        ['A', 'B'].forEach(function (end) {
          var att = end === 'A' ? c.sideA : c.sideB;
          if (att && att.owner === 'vfl' && att.vflId === d.id) {
            injectPcord(c.id, end);
          }
        });
      });
      (graph.pigtails || []).forEach(function (p) {
        var att = p.connector;
        if (att && att.owner === 'vfl' && att.vflId === d.id) {
          injectPigtail(p.id);
        }
      });
    });

    bridgeCouplerPassThrough();

    return {
      mode: activeEmitMode(),
      pcords: Object.keys(pcords),
      pigtails: Object.keys(pigtails),
      pcordExits: pcordExits,
      pigtailExits: pigtailExits,
      splitterExits: splitterExits,
      couplerPass: couplerPass,
    };
  }

  function setFiberGlowClass(el, on, mode) {
    if (!el) return;
    el.classList.remove('is-vfl-glow', 'is-vfl-glow--cw', 'is-vfl-glow--glint');
    if (!on || !mode || mode === 'OFF') return;
    el.classList.add('is-vfl-glow');
    el.classList.add(mode === 'GLINT' ? 'is-vfl-glow--glint' : 'is-vfl-glow--cw');
  }

  function refreshLaserGlow() {
    var targets = collectLaserTargets();
    targets.mode = targets.mode || 'OFF';

    if (global.FtthLab) {
      FtthLab._vflGlow = targets;
    }
    if (global.FtthLab && typeof FtthLab.applyFiberLaserGlow === 'function') {
      FtthLab.applyFiberLaserGlow(targets);
    } else {
      applyDomGlow(targets);
    }
  }

  function applyDomGlow(targets) {
    var mode = (targets && targets.mode) || 'OFF';
    var pc = {};
    var pt = {};
    var fusedGlow = {};
    var pcExits = (targets && targets.pcordExits) || {};
    var ptExits = (targets && targets.pigtailExits) || {};
    (targets.pcords || []).forEach(function (id) { pc[id] = true; });
    (targets.pigtails || []).forEach(function (id) {
      pt[id] = true;
      if (!global.FtthLab || typeof FtthLab.getFiberLaserGraph !== 'function') return;
      var graph = FtthLab.getFiberLaserGraph() || { pigtails: [] };
      var i;
      for (i = 0; i < (graph.pigtails || []).length; i++) {
        var node = graph.pigtails[i];
        if (node.id !== id) continue;
        if (node.fusedPartnerId && node.splicerWeldMachineId) {
          pt[node.fusedPartnerId] = true;
          fusedGlow[node.splicerWeldMachineId] = true;
        }
        break;
      }
    });

    document.querySelectorAll('[data-pcord-fiber], [data-pt-fiber]').forEach(function (el) {
      el.classList.remove('is-vfl-glow', 'is-vfl-glow--cw', 'is-vfl-glow--glint');
    });
    document.querySelectorAll('[data-pcord-laser]').forEach(function (el) {
      setFiberGlowClass(el, !!pc[el.getAttribute('data-pcord-laser')], mode);
    });

    var svgRoots = [];
    var mainSvg = document.querySelector('.lab-pigtail-layer .lab-pigtail-svg');
    if (mainSvg) svgRoots.push(mainSvg);
    document.querySelectorAll('[data-fusion-fiber-layer] .lab-pigtail-svg').forEach(function (svg) {
      if (svgRoots.indexOf(svg) < 0) svgRoots.push(svg);
    });
    svgRoots.forEach(function (svgRoot) {
      svgRoot.querySelectorAll('[data-pt-fiber], [data-fused-asm-id], .lab-splicer-fusion-bridge__glass').forEach(function (el) {
        el.classList.remove('is-vfl-glow', 'is-vfl-glow--cw', 'is-vfl-glow--glint');
      });
      svgRoot.querySelectorAll('[data-fused-assembly]').forEach(function (el) {
        var mid = el.getAttribute('data-fused-assembly');
        el.classList.toggle('is-vfl-fused-lit', !!(mid && fusedGlow[mid] && mode !== 'OFF'));
      });
      svgRoot.querySelectorAll('[data-pt-laser], [data-fused-laser]').forEach(function (el) {
        var id = el.getAttribute('data-pt-laser');
        var mid = el.getAttribute('data-fused-laser');
        var on = false;
        if (mid) {
          on = !!fusedGlow[mid];
        } else if (id) {
          var baseId = String(id).split(':')[0];
          var suppressFusedPigtail = false;
          if (global.FtthLab && typeof FtthLab.getFiberLaserGraph === 'function') {
            var graphPigtails = (FtthLab.getFiberLaserGraph() || {}).pigtails || [];
            var gi;
            for (gi = 0; gi < graphPigtails.length; gi++) {
              if (graphPigtails[gi].id !== baseId) continue;
              if (graphPigtails[gi].type === 'cable') break;
              suppressFusedPigtail = !!(
                graphPigtails[gi].splicerWeldMachineId && graphPigtails[gi].fusedPartnerId
              );
              break;
            }
          }
          on = !!(pt[id] || pt[baseId]) && !suppressFusedPigtail;
        }
        setFiberGlowClass(el, on, mode);
      });
    });
    document.querySelectorAll('[data-pcord-id][data-pcord-end]').forEach(function (el) {
      var cid = el.getAttribute('data-pcord-id');
      var end = el.getAttribute('data-pcord-end');
      el.classList.remove('is-vfl-laser-exit', 'is-vfl-laser-exit--cw', 'is-vfl-laser-exit--glint');
      if (pc[cid] && pcExits[cid] === end && mode !== 'OFF' && !el.classList.contains('is-attached')) {
        el.classList.add('is-vfl-laser-exit');
        el.classList.add(mode === 'GLINT' ? 'is-vfl-laser-exit--glint' : 'is-vfl-laser-exit--cw');
      }
    });
    document.querySelectorAll('[data-pt-id][data-pt-end]').forEach(function (el) {
      var pid = el.getAttribute('data-pt-id');
      var end = el.getAttribute('data-pt-end');
      el.classList.remove('is-vfl-laser-exit', 'is-vfl-laser-exit--cw', 'is-vfl-laser-exit--glint');
      if (pt[pid] && ptExits[pid] === end && mode !== 'OFF' && !el.classList.contains('is-attached')) {
        el.classList.add('is-vfl-laser-exit');
        el.classList.add(mode === 'GLINT' ? 'is-vfl-laser-exit--glint' : 'is-vfl-laser-exit--cw');
      }
    });
  }

  /* ─── Render ─── */

  function ensureLayer() {
    if (layer && layer.parentNode) return layer;
    var mount = document.getElementById('lab-2d-mount');
    if (!mount) return null;
    layer = document.createElement('div');
    layer.className = 'lab-vfl-layer';
    layer.setAttribute('data-lab-vfl-layer', '1');
    mount.appendChild(layer);
    return layer;
  }

  function deviceMarkup(d) {
    syncPortPlugState(d);
    var mode = normalizeMode(d.mode);
    var selected = selection.id === d.id ? ' is-selected' : '';
    var modeClass = ' is-mode-' + mode.toLowerCase();
    var plugged = d.plugged ? ' is-plugged' : '';
    var laserOn = mode !== 'OFF';
    var switchPos = switchTopPct(mode);
    var scale = Number(d.scale);
    if (!isFinite(scale) || scale <= 0) scale = 1;
    if (global.FtthLab && typeof FtthLab.clampNodeScale === 'function') {
      scale = FtthLab.clampNodeScale(scale);
    }
    var handleHtml = (global.FtthLab && typeof FtthLab.resizeHandleHtml === 'function')
      ? FtthLab.resizeHandleHtml()
      : '<span class="lab-resize-handle lab-resize-handle--se" data-lab-resize="se" aria-hidden="true"></span>';
    return (
      '<div class="lab-vfl' + selected + modeClass + plugged + '" data-vfl-node="' + d.id + '" ' +
      'data-lab-scale="' + scale + '" ' +
      'style="left:' + Math.round(d.x) + 'px;top:' + Math.round(d.y) +
      'px;transform-origin:0 0;transform:translateZ(0) scale(' + scale + ')" ' +
      'title="Visual Fault Locator · 10 mW · 650 nm">' +
      '<div class="lab-vfl__head" aria-hidden="true">' +
      '<svg class="lab-vfl__flanges" viewBox="0 0 28 18" width="28" height="18" focusable="false">' +
      '<defs>' +
      '<linearGradient id="vfl-ear-' + d.id + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#1a1a1a"/>' +
      '<stop offset="100%" stop-color="#0a0a0a"/>' +
      '</linearGradient>' +
      '</defs>' +
      '<path fill="url(#vfl-ear-' + d.id + ')" d="' +
      'M0 18 L0 11 Q0 5 3 4 L5 3 Q7 1 9 4 L9 9 Q9 13 7 15 L5 17 Q2 18 0 18 Z' +
      '"/>' +
      '<path fill="url(#vfl-ear-' + d.id + ')" d="' +
      'M28 18 L28 11 Q28 5 25 4 L23 3 Q21 1 19 4 L19 9 Q19 13 21 15 L23 17 Q26 18 28 18 Z' +
      '"/>' +
      '<path fill="none" stroke="#262626" stroke-width="0.4" d="M3 12h3M3 14h3M3 16h3"/>' +
      '<path fill="none" stroke="#262626" stroke-width="0.4" d="M25 12h-3M25 14h-3M25 16h-3"/>' +
      '<ellipse cx="23" cy="3.2" rx="1.1" ry="0.7" fill="#f97316"/>' +
      '</svg>' +
      '<button type="button" class="lab-vfl-port' + (laserOn ? ' is-emitting' : '') +
      (d.plugged ? ' is-plugged' : '') + '" data-vfl-port="' + d.id + '" ' +
      'title="SC optical port · plug Patch Cord or SC Pigtail" ' +
      'aria-label="VFL SC optical port">' +
      '<span class="lab-vfl-port__thread" aria-hidden="true"></span>' +
      '<span class="lab-vfl-port__ferrule" aria-hidden="true"></span>' +
      '<span class="lab-vfl-port__bore" aria-hidden="true"></span>' +
      '</button>' +
      '</div>' +
      '<div class="lab-vfl__body" data-vfl-drag="' + d.id + '">' +
      '<span class="lab-vfl__label">FAULT LOCATOR</span>' +
      '<span class="lab-vfl__caution" aria-hidden="true">CAUTION · LASER</span>' +
      '<span class="lab-vfl__ring" aria-hidden="true"></span>' +
      '<div class="lab-vfl__switch-row" data-vfl-switch="' + d.id + '" ' +
      'role="group" aria-label="VFL laser mode switch">' +
      '<button type="button" class="lab-vfl__mode-hit' + (mode === 'CW' ? ' is-active' : '') +
      '" data-vfl-set-mode="' + d.id + ':CW" title="CW · Continuous">CW</button>' +
      '<button type="button" class="lab-vfl__mode-hit' + (mode === 'OFF' ? ' is-active' : '') +
      '" data-vfl-set-mode="' + d.id + ':OFF" title="OFF">OFF</button>' +
      '<button type="button" class="lab-vfl__mode-hit' + (mode === 'GLINT' ? ' is-active' : '') +
      '" data-vfl-set-mode="' + d.id + ':GLINT" title="GLINT · Pulsing">GLINT</button>' +
      '<div class="lab-vfl__track" data-vfl-switch-track="' + d.id + '" ' +
      'title="Drag to set CW / OFF / GLINT" role="slider" ' +
      'aria-valuemin="0" aria-valuemax="2" aria-valuenow="' +
      (mode === 'CW' ? '0' : mode === 'GLINT' ? '2' : '1') + '" ' +
      'aria-valuetext="' + mode + '">' +
      '<i class="lab-vfl__slider" style="top:' + switchPos + '"></i>' +
      '</div>' +
      '</div>' +
      '<span class="lab-vfl__grip" aria-hidden="true"></span>' +
      '</div>' +
      (laserOn
        ? '<span class="lab-vfl__beam' + (mode === 'GLINT' ? ' is-glint' : '') +
          '" aria-hidden="true"></span>'
        : '') +
      handleHtml +
      '</div>'
    );
  }

  function rebuildLayer() {
    var host = ensureLayer();
    if (!host) return;
    var html = '';
    devices.forEach(function (d) { html += deviceMarkup(d); });
    host.innerHTML = html;
    bindLayerEvents(host);
    refreshLaserGlow();
  }

  function bindLayerEvents(host) {
    host.querySelectorAll('[data-vfl-node]').forEach(function (node) {
      var id = node.getAttribute('data-vfl-node');
      var d = findDevice(id);
      if (d && global.FtthLab && typeof FtthLab.bindUniformNodeResize === 'function') {
        FtthLab.bindUniformNodeResize(node, {
          baseSize: 78,
          min: 0.6,
          max: 2.2,
          getScale: function () {
            var s = Number(d.scale);
            return isFinite(s) && s > 0 ? s : 1;
          },
          setScale: function (s) { d.scale = s; },
          onLive: function () {
            if (global.FtthLab && typeof FtthLab.notifyLayoutChange === 'function') {
              FtthLab.notifyLayoutChange({ source: 'vfl', live: true, vflId: id });
            }
          },
          onCommit: function () {
            pushHistory();
            if (global.FtthLab && typeof FtthLab.notifyLayoutChange === 'function') {
              FtthLab.notifyLayoutChange({ source: 'vfl', vflId: id });
            }
            setStatus('VFL resized · ' + Math.round((Number(d.scale) || 1) * 100) + '%');
          },
        });
      }
      node.addEventListener('click', function (e) {
        if (e.target.closest('[data-vfl-port]')) return;
        if (e.target.closest('[data-lab-resize]')) return;
        if (e.target.closest(
          '[data-vfl-switch], [data-vfl-set-mode], [data-vfl-switch-track]'
        )) return;
        e.stopPropagation();
        selectVfl(node.getAttribute('data-vfl-node'));
      });
    });

    host.querySelectorAll('[data-vfl-port]').forEach(function (port) {
      port.addEventListener('click', function (e) {
        e.stopPropagation();
        selectVfl(port.getAttribute('data-vfl-port'));
      });
    });

    /* Click CW / OFF / GLINT labels */
    host.querySelectorAll('[data-vfl-set-mode]').forEach(function (btn) {
      btn.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        e.stopPropagation();
      });
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var parts = (btn.getAttribute('data-vfl-set-mode') || '').split(':');
        if (parts.length < 2) return;
        selectVfl(parts[0]);
        setMode(parts[0], parts[1]);
      });
    });

    /* Click / drag orange slider track → CW / OFF / GLINT */
    host.querySelectorAll('[data-vfl-switch-track]').forEach(function (track) {
      track.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        var id = track.getAttribute('data-vfl-switch-track');
        var d = findDevice(id);
        if (!d) return;
        selectVfl(id);
        var startMode = normalizeMode(d.mode);
        var lastMode = startMode;

        function ratioFromEvent(ev) {
          var r = track.getBoundingClientRect();
          var t = r.height > 0 ? (ev.clientY - r.top) / r.height : 0.5;
          if (t < 0) t = 0;
          if (t > 1) t = 1;
          return t;
        }

        function applyFromEvent(ev, liveThumb) {
          var t = ratioFromEvent(ev);
          var mode = modeFromTrackRatio(t);
          if (mode !== lastMode) {
            lastMode = mode;
            applyModeLive(id, mode);
          }
          var slider = track.querySelector('.lab-vfl__slider');
          if (slider && liveThumb) {
            slider.style.top = Math.max(8, Math.min(92, t * 100)) + '%';
          } else if (slider) {
            slider.style.top = switchTopPct(mode);
          }
        }

        applyFromEvent(e, false);
        try { track.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }

        function onMove(ev) {
          applyFromEvent(ev, true);
        }
        function onUp(ev) {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          window.removeEventListener('pointercancel', onUp);
          try { track.releasePointerCapture(e.pointerId); } catch (err2) { /* ignore */ }
          var finalMode = modeFromTrackRatio(ratioFromEvent(ev));
          if (finalMode !== startMode) {
            /* Commit once: rebuild + history (applyModeLive already set d.mode) */
            d.mode = normalizeMode(finalMode);
            rebuildLayer();
            updateInspector();
            pushHistory();
            refreshLaserGlow();
            setStatus('VFL · ' + modeLabel(d.mode) + ' · 650 nm · 10 mW');
          } else {
            rebuildLayer();
            refreshLaserGlow();
          }
        }
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
      });
    });

    host.querySelectorAll('[data-vfl-drag]').forEach(function (grip) {
      grip.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        if (e.target.closest(
          '[data-vfl-switch], [data-vfl-set-mode], [data-vfl-switch-track], .lab-vfl__slider, [data-lab-resize]'
        )) return;
        e.preventDefault();
        e.stopPropagation();
        var id = grip.getAttribute('data-vfl-drag');
        var d = findDevice(id);
        if (!d) return;
        selectVfl(id);
        var zoom = getZoom() || 1;
        var sx = e.clientX;
        var sy = e.clientY;
        var ox = d.x;
        var oy = d.y;
        var moved = false;
        nodeDragClass(id, true);

        function onMove(ev) {
          moved = true;
          var newX = Math.round(ox + (ev.clientX - sx) / zoom);
          var newY = Math.round(oy + (ev.clientY - sy) / zoom);
          var dx = newX - d.x;
          var dy = newY - d.y;
          d.x = newX;
          d.y = newY;
          var el = layer && layer.querySelector('[data-vfl-node="' + id + '"]');
          if (el) {
            el.style.left = d.x + 'px';
            el.style.top = d.y + 'px';
          }
          if ((dx || dy) && global.FtthLab &&
              typeof FtthLab.translateVflGroup === 'function') {
            FtthLab.translateVflGroup(id, dx, dy, { live: true });
          }
        }
        function onUp() {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          nodeDragClass(id, false);
          if (moved) {
            rebuildLayer();
            pushHistory();
            if (global.FtthLab && typeof FtthLab.notifyLayoutChange === 'function') {
              FtthLab.notifyLayoutChange({ source: 'vfl', vflId: id });
            }
          }
        }
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });
    });
  }

  function nodeDragClass(id, on) {
    var el = layer && layer.querySelector('[data-vfl-node="' + id + '"]');
    if (el) el.classList.toggle('is-dragging', !!on);
  }

  /* ─── Toolbox ─── */

  function renderToolbox() {
    var host = global.FtthLab && typeof FtthLab.gateToolboxRender === 'function'
      ? FtthLab.gateToolboxRender('lab-vfl-tree', 'vfl')
      : document.getElementById('lab-vfl-tree');
    if (!host) return;
    host.innerHTML =
      '<div class="lab-toolbox" role="list">' +
      '<button type="button" class="lab-tool lab-tool--vfl' +
      (selectedTool === 'vfl' ? ' is-selected' : '') +
      '" draggable="true" data-lab-tool="vfl" role="listitem">' +
      '<span class="lab-tool__mark lab-tool__mark--vfl" aria-hidden="true"></span>' +
      '<span class="lab-tool__copy">' +
      '<strong>Visual Fault Locator</strong>' +
      '<span>10 mW · 650 nm laser</span>' +
      '</span>' +
      '</button>' +
      '</div>';
    bindToolbox(host);
    if (global.FtthLab && typeof FtthLab.applyFtthLabToolboxIcons === 'function') {
      FtthLab.applyFtthLabToolboxIcons();
    }
  }

  function bindToolbox(host) {
    var btn = host.querySelector('[data-lab-tool="vfl"]');
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
        FtthLab.claimToolboxTool('vfl');
      }
      selectedTool = 'vfl';
      renderToolbox();
      setStatus('VFL · drag onto canvas · plug fiber into SC port · CW or GLINT');
    });
    btn.addEventListener('dragstart', function (e) {
      if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
        FtthLab.claimToolboxTool('vfl');
      }
      selectedTool = 'vfl';
      dragLib = { kind: 'vfl' };
      if (global.FtthLab && FtthLab.beginDrag) FtthLab.beginDrag({ kind: 'vfl' });
      try {
        e.dataTransfer.setData('text/plain', 'lab:vfl');
        e.dataTransfer.setData('text/lab-drag', 'vfl');
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
      if (!el || el.dataset.vflDrop === '1') return;
      el.dataset.vflDrop = '1';
      el.addEventListener('dragover', function (e) {
        var active = global.FtthLab && FtthLab.getActiveDrag && FtthLab.getActiveDrag();
        if (!((dragLib && dragLib.kind === 'vfl') || (active && active.kind === 'vfl'))) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      });
      el.addEventListener('drop', function (e) {
        var active = global.FtthLab && FtthLab.getActiveDrag && FtthLab.getActiveDrag();
        var kind = (e.dataTransfer && e.dataTransfer.getData('text/lab-drag')) ||
          (active && active.kind) || (dragLib && dragLib.kind) || '';
        if (kind !== 'vfl') return;
        e.preventDefault();
        e.stopPropagation();
        dragLib = null;
        if (global.FtthLab && FtthLab.endDrag) FtthLab.endDrag();
        selectedTool = 'vfl';
        var pt = clientToWorld(e.clientX, e.clientY);
        placeVfl(Math.round(pt.x - VFL_W / 2), Math.round(pt.y - VFL_H / 2));
      });
    });
  }

  function updateInspector() {
    var card = document.getElementById('lab-inspector-card');
    var detail = document.getElementById('lab-inspector-detail');
    if (!card) return;
    if (selection.kind !== 'vfl' || !selection.id) return;
    var d = findDevice(selection.id);
    if (!d) return;

    var mode = normalizeMode(d.mode);
    var glow = collectLaserTargets();
    var pathCount = (glow.pcords || []).length + (glow.pigtails || []).length;
    var laserOn = mode !== 'OFF';
    var meta = (global.FtthLab && FtthLab.getToolMeta && FtthLab.getToolMeta('vfl')) || {};

    card.innerHTML =
      '<h2>' + (meta.label || 'Visual Fault Locator') + '</h2>' +
      '<p>' + (meta.guideText || '10 mW · 650 nm · plug SC Patch Cord or Pigtail into the open central adapter.') + '</p>';

    if (!detail) return;
    detail.hidden = false;
    detail.innerHTML =
      '<div class="lab-vfl-config">' +
      '<p class="lab-inspector__label">Laser mode</p>' +
      '<div class="lab-vfl-mode-toggle" role="group" aria-label="VFL laser mode">' +
      '<button type="button" class="lab-vfl-mode-btn' + (mode === 'CW' ? ' is-active' : '') +
      '" data-vfl-mode="' + d.id + ':CW">CW</button>' +
      '<button type="button" class="lab-vfl-mode-btn' + (mode === 'OFF' ? ' is-active' : '') +
      '" data-vfl-mode="' + d.id + ':OFF">OFF</button>' +
      '<button type="button" class="lab-vfl-mode-btn' + (mode === 'GLINT' ? ' is-active' : '') +
      '" data-vfl-mode="' + d.id + ':GLINT">GLINT</button>' +
      '</div>' +
      '<p class="lab-vfl-mode-hint">' +
      (mode === 'CW'
        ? 'Continuous wave · steady red glow along the fiber'
        : mode === 'GLINT'
          ? 'Pulsing glint · flashing red for fault tracing'
          : 'Laser off · no emission') +
      '</p>' +
      (laserOn
        ? '<div class="lab-vfl-preview' + (mode === 'GLINT' ? ' is-glint' : '') +
          '" aria-hidden="true">' +
          '<span class="lab-vfl-preview__beam"></span>' +
          '<span>' + (mode === 'GLINT' ? 'Pulsing red laser' : 'Steady red laser') +
          ' on fiber</span>' +
          '</div>'
        : '') +
      '<p class="lab-pcord-attach">' +
      (d.plugged
        ? 'Port ← ' + d.plugged.label
        : 'Port · open · drag SC connector onto central adapter') +
      '</p>' +
      '<div class="lab-spl-sheet">' +
      '<div><span>Power</span><strong>10 mW</strong></div>' +
      '<div><span>λ</span><strong>650 nm</strong></div>' +
      '<div><span>Mode</span><strong class="' +
      (laserOn ? 'lab-vfl-on-text' : '') + '">' + modeLabel(mode) + '</strong></div>' +
      '<div><span>Lit paths</span><strong>' +
      (laserOn && d.plugged ? pathCount : '—') +
      '</strong></div>' +
      '</div>' +
      '<button type="button" class="lab-eject-btn" data-remove-vfl="' + d.id +
      '">Remove VFL</button>' +
      '</div>';

    detail.querySelectorAll('[data-vfl-mode]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var parts = btn.getAttribute('data-vfl-mode').split(':');
        setMode(parts[0], parts[1]);
      });
    });
    var rm = detail.querySelector('[data-remove-vfl]');
    if (rm) {
      rm.addEventListener('click', function () {
        removeVfl(d.id);
        if (global.FtthLab && typeof FtthLab.resetInspectorIdle === 'function') {
          FtthLab.resetInspectorIdle();
        }
      });
    }
  }

  function onLayoutChange() {
    if (!layer) return;
    devices.forEach(function (d) {
      var el = layer.querySelector('[data-vfl-node="' + d.id + '"]');
      if (el) {
        el.style.left = d.x + 'px';
        el.style.top = d.y + 'px';
      }
    });
    refreshLaserGlow();
  }

  function deleteSelected() {
    if (selection.kind === 'vfl' && selection.id) {
      removeVfl(selection.id);
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

  function cancelPatch() {}

  function onToolboxClaim(payload) {
    var id = payload && payload.toolId;
    if (id === 'vfl') return;
    if (selectedTool) {
      selectedTool = null;
      renderToolbox();
    }
  }

  function onViewChange() {
    rebuildLayer();
  }

  function mount(api) {
    ctx = api || {};
    devices = [];
    seq = 0;
    history = [];
    historyIndex = -1;
    historyLocked = false;
    selection = { kind: 'none', id: null };
    selectedTool = null;
    dragLib = null;
    renderToolbox();
    bindStageDrop();
    ensureLayer();
    rebuildLayer();
    pushHistory();

    if (global.FtthLab) {
      FtthLab.refreshVflLaser = refreshLaserGlow;
      FtthLab.getVflPortWorld = getVflPortWorld;
      document.documentElement.style.setProperty('--lab-vfl-exit-flare-size', '72px');
    }
  }

  var tool = {
    id: 'vfl',
    mount: mount,
    onViewChange: onViewChange,
    onLayoutChange: onLayoutChange,
    undo: undo,
    redo: redo,
    deleteSelected: deleteSelected,
    clearSelection: clearSelection,
    cancelPatch: cancelPatch,
    onToolboxClaim: onToolboxClaim,
    onLabConfigChanged: function (payload) {
      if (global.FtthLab && typeof FtthLab.handleToolboxConfigChange === 'function') {
        FtthLab.handleToolboxConfigChange('vfl', 'lab-vfl-tree', renderToolbox, payload && payload.config);
      } else {
        renderToolbox();
      }
      updateInspector();
    },
    exportProjectState: captureSnapshot,
    importProjectState: applySnapshot,
    resetProjectState: function () {
      applySnapshot({ devices: [], seq: 0 });
    },
  };

  function tryRegister() {
    if (global.FtthLab && typeof FtthLab.registerTool === 'function') {
      FtthLab.registerTool('vfl', tool);
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
