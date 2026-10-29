/**
 * Nokia 7360 ISAM FX-16 OLT + FGLT-D + SFP hierarchy
 * Blank-slate assembly: drag Chassis → FGLT-D → SFP (nothing pre-placed).
 */
(function (global) {
  'use strict';

  var SLOT_COUNT = 16;
  var PORT_COUNT = 16;

  var SFP_PROFILES = {
    'huawei-ssx1t1ltb': {
      id: 'huawei-ssx1t1ltb',
      name: 'Huawei SSX1T1LTB (GPON Class B+)',
      shortName: 'GPON B+',
      txNm: 1490,
      rxNm: 1310,
      txMin: 1.5,
      txMax: 5.0,
      txDefault: 3.0,
      sensitivity: -28
    },
    'gpon-cplus': {
      id: 'gpon-cplus',
      name: 'GPON OLT Class C+',
      shortName: 'GPON C+',
      txNm: 1490,
      rxNm: 1310,
      txMin: 3.0,
      txMax: 7.0,
      txDefault: 5.0,
      sensitivity: -32
    },
    'xgs-pon-n1n2': {
      id: 'xgs-pon-n1n2',
      name: 'XGS-PON N1/N2',
      shortName: 'XGS-PON',
      txNm: 1577,
      rxNm: 1270,
      txMin: 4.0,
      txMax: 9.0,
      txDefault: 5.5,
      sensitivity: -28
    }
  };
  var SFP_PROFILE_DEFAULT = 'huawei-ssx1t1ltb';

  var ctx = null;
  var el2d = null;
  var group3d = null;
  var root3d = null;
  var pickables = [];
  var stageDropBound = false;

  /* Blank slate — nothing on canvas until user places hardware */
  var chassisPlaced = false;
  var chassisInLibrary = true;
  var chassisScale = 1;
  var chassisX = 0;
  var chassisY = 0;
  var WORLD_SIZE = 20000;
  var CHASSIS_BASE_W = 1100;
  var CHASSIS_SCALE_MIN = 0.45;
  var CHASSIS_SCALE_MAX = 1.7;

  function getWorldSize() {
    return (global.FtthLab && FtthLab.getWorldSize) ? FtthLab.getWorldSize() : WORLD_SIZE;
  }

  function defaultChassisPos() {
    var world = getWorldSize();
    var w = Math.round(CHASSIS_BASE_W * chassisScale);
    return {
      x: Math.round(world / 2 - w / 2),
      y: Math.round(world / 2 - 180),
    };
  }

  /* installed[slot] = { id, model } — stock minted from toolbox on demand */
  var installed = {};
  var cardInventory = [];
  var sfpInventory = [];
  var sfpMap = {};

  var selection = {
    kind: 'none',
    slot: null,
    port: null,
    cardId: null,
    sfpId: null,
  };
  /** Sidebar arm highlight only — independent of workspace item selection */
  var armedToolbox = null;

  var portWiring = {};
  /** Port id that just received a module — plays the seat-in animation once. */
  var justSeated = null;
  var dragState = null;
  var cardSeq = 0;
  var sfpSeq = 0;

  /* Undo / Redo history of hardware placement */
  var history = [];
  var historyIndex = -1;
  var historyLocked = false;
  var HISTORY_MAX = 80;

  function resetAssembly() {
    chassisPlaced = false;
    chassisInLibrary = true;
    chassisScale = 1;
    var pos = defaultChassisPos();
    chassisX = pos.x;
    chassisY = pos.y;
    installed = {};
    sfpMap = {};
    portWiring = {};
    cardInventory = [];
    sfpInventory = [];
    cardSeq = 0;
    sfpSeq = 0;
    selection = { kind: 'none', slot: null, port: null, cardId: null, sfpId: null };
    armedToolbox = null;
    history = [];
    historyIndex = -1;
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value == null ? null : value));
  }

  function captureSnapshot() {
    return {
      chassisPlaced: chassisPlaced,
      chassisInLibrary: chassisInLibrary,
      chassisScale: chassisScale,
      chassisX: chassisX,
      chassisY: chassisY,
      installed: cloneJson(installed),
      sfpMap: cloneJson(sfpMap),
      cardSeq: cardSeq,
      sfpSeq: sfpSeq,
    };
  }

  function rebuildWiringFromMaps() {
    portWiring = {};
    for (var s = 1; s <= SLOT_COUNT; s++) {
      if (!installed[s]) continue;
      ensureSlotWiring(s);
      if (!sfpMap[s]) continue;
      Object.keys(sfpMap[s]).forEach(function (pk) {
        var id = portId(s, parseInt(pk, 10));
        if (portWiring[id]) portWiring[id].hasSfp = true;
      });
    }
  }

  function applySnapshot(snap) {
    if (!snap) return;
    historyLocked = true;
    chassisPlaced = !!snap.chassisPlaced;
    chassisInLibrary = !!snap.chassisInLibrary;
    chassisScale = typeof snap.chassisScale === 'number' ? snap.chassisScale : 1;
    chassisX = typeof snap.chassisX === 'number' ? snap.chassisX : defaultChassisPos().x;
    chassisY = typeof snap.chassisY === 'number' ? snap.chassisY : defaultChassisPos().y;
    installed = cloneJson(snap.installed) || {};
    sfpMap = cloneJson(snap.sfpMap) || {};
    Object.keys(sfpMap).forEach(function (sk) {
      Object.keys(sfpMap[sk] || {}).forEach(function (pk) {
        normalizeSfpModule(sfpMap[sk][pk]);
      });
    });
    cardSeq = snap.cardSeq || 0;
    sfpSeq = snap.sfpSeq || 0;
    cardInventory = [];
    sfpInventory = [];
    rebuildWiringFromMaps();
    selection = { kind: 'none', slot: null, port: null, cardId: null, sfpId: null };
    rebuildViews();
    var hud = document.getElementById('lab-hud-mode');
    if (hud) {
      hud.textContent = chassisPlaced
        ? '2D Layout · FX-16 Chassis'
        : '2D Layout · Empty Workspace';
    }
    if (chassisPlaced) selectChassis();
    else {
      updateInspector();
      renderToolbox();
    }
    historyLocked = false;
    updateUndoRedoUi();
  }

  function updateUndoRedoUi() {
    if (global.FtthLab && typeof FtthLab.updateHistoryUi === 'function') {
      FtthLab.updateHistoryUi();
      return;
    }
    var undoBtn = document.getElementById('lab-btn-undo');
    var redoBtn = document.getElementById('lab-btn-redo');
    if (undoBtn) undoBtn.disabled = historyIndex <= 0;
    if (redoBtn) redoBtn.disabled = historyIndex < 0 || historyIndex >= history.length - 1;
  }

  function pushHistory() {
    if (historyLocked) return;
    history = history.slice(0, historyIndex + 1);
    history.push(captureSnapshot());
    if (history.length > HISTORY_MAX) {
      history.shift();
    }
    historyIndex = history.length - 1;
    updateUndoRedoUi();
    if (historyIndex > 0 && global.FtthLab && typeof FtthLab.recordHistory === 'function') {
      FtthLab.recordHistory('olt-fx16');
    }
  }

  function undo() {
    if (historyIndex <= 0) return false;
    historyIndex -= 1;
    applySnapshot(history[historyIndex]);
    return true;
  }

  function redo() {
    if (historyIndex >= history.length - 1) return false;
    historyIndex += 1;
    applySnapshot(history[historyIndex]);
    return true;
  }

  function deleteSelected() {
    if (selection.kind === 'port' && hasSfp(selection.slot, selection.port)) {
      ejectSfp(selection.slot, selection.port);
      return true;
    }
    if (selection.kind === 'card' ||
        (selection.kind === 'slot' && selection.slot && installed[selection.slot])) {
      ejectCard(selection.slot);
      return true;
    }
    if (selection.kind === 'chassis' && chassisPlaced) {
      removeChassis();
      return true;
    }
    return false;
  }

  function clampChassisScale(v) {
    return Math.max(CHASSIS_SCALE_MIN, Math.min(CHASSIS_SCALE_MAX, v));
  }

  function applyChassisLayout() {
    if (!el2d || !chassisPlaced) return;
    var frame = el2d.querySelector('.lab-fx-chassis-frame');
    var w = Math.round(CHASSIS_BASE_W * chassisScale);
    if (frame) {
      frame.style.width = w + 'px';
      frame.style.setProperty('--fx-scale', String(chassisScale));
    }
    el2d.style.left = Math.round(chassisX) + 'px';
    el2d.style.top = Math.round(chassisY) + 'px';
    el2d.style.width = w + 'px';
    el2d.style.maxWidth = 'none';
    el2d.style.maxHeight = 'none';
    el2d.style.transform = 'none';
    el2d.style.overflow = 'visible';
  }

  /** Toolbox tools are always available — mint stock on demand */
  function takeNextCard() {
    cardSeq += 1;
    var card = { id: 'fglt-d-' + cardSeq, model: 'FGLT-D' };
    cardInventory.push(card);
    return card.id;
  }

  function getSfpProfileMap() {
    var map = JSON.parse(JSON.stringify(SFP_PROFILES));
    var settings =
      global.FtthLab && typeof global.FtthLab.getLabSettings === 'function'
        ? global.FtthLab.getLabSettings()
        : global.FtthLabSettings;
    if (settings && typeof settings.getSfpVariants === 'function') {
      settings.getSfpVariants().forEach(function (v) {
        var ps = v.performanceSpecs || {};
        var range = ps.powerRangeDbm || {};
        var txMin = isFinite(range.min) ? range.min : 0;
        var txMax = isFinite(range.max) ? range.max : 5;
        map[v.id] = {
          id: v.id,
          name: v.name,
          shortName: v.shortName,
          txNm: v.txNm || 1490,
          rxNm: v.rxNm || 1310,
          txMin: txMin,
          txMax: txMax,
          txDefault: isFinite(ps.txDefault) ? ps.txDefault : (ps.txLevels && ps.txLevels[0]) || txMin,
          sensitivity: isFinite(ps.sensitivity) ? ps.sensitivity : ((ps.rxLevels && ps.rxLevels[0]) || -28),
          txLevels: ps.txLevels || [],
          rxLevels: ps.rxLevels || [],
        };
      });
    }
    return map;
  }

  function getSfpProfile(id) {
    var map = getSfpProfileMap();
    return map[id] || map[SFP_PROFILE_DEFAULT] || SFP_PROFILES[SFP_PROFILE_DEFAULT];
  }

  function clampSfpTx(profile, value) {
    var n = Number(value);
    if (!isFinite(n)) n = profile.txDefault;
    n = Math.min(profile.txMax, Math.max(profile.txMin, n));
    return Math.round(n * 10) / 10;
  }

  function normalizeSfpModule(mod) {
    if (!mod) return mod;
    var spec = getSfpProfile(mod.profileId);
    mod.profileId = spec.id;
    mod.model = spec.name;
    if (mod.dustCap === undefined) mod.dustCap = true;
    mod.txDbm = clampSfpTx(spec, mod.txDbm != null ? mod.txDbm : spec.txDefault);
    return mod;
  }

  function takeNextSfp(profileId) {
    sfpSeq += 1;
    var mod = normalizeSfpModule({
      id: 'sfp-' + sfpSeq,
      profileId: profileId || SFP_PROFILE_DEFAULT,
      dustCap: true
    });
    sfpInventory.push(mod);
    return mod.id;
  }

  function refreshOpticalOutputs() {
    if (global.FtthLab && typeof FtthLab.refreshPowerBudget === 'function') {
      FtthLab.refreshPowerBudget();
    }
    if (global.FtthLab && typeof FtthLab.refreshOpmDocks === 'function') {
      FtthLab.refreshOpmDocks();
    }
  }

  function setSfpProfile(slot, port, profileId) {
    var mod = sfpModule(slot, port);
    if (!mod) return;
    var spec = getSfpProfile(profileId);
    mod.profileId = spec.id;
    mod.model = spec.name;
    mod.txDbm = clampSfpTx(spec, spec.txDefault);
    updateInspector();
    refreshOpticalOutputs();
    setStatus(spec.shortName + ' · TX ' + spec.txNm + ' nm · ' + fmtDbm(mod.txDbm));
  }

  function setSfpTxPower(slot, port, value, opts) {
    opts = opts || {};
    var mod = sfpModule(slot, port);
    if (!mod) return;
    var spec = getSfpProfile(mod.profileId);
    mod.txDbm = clampSfpTx(spec, value);
    refreshOpticalOutputs();
    if (!opts.silent) setStatus('SFP TX · ' + fmtDbm(mod.txDbm));
    return mod.txDbm;
  }

  function fmtDbm(n) {
    var v = Number(n);
    if (!isFinite(v)) return '—';
    var s = v >= 0 ? '+' + v.toFixed(1) : v.toFixed(1);
    return s + ' dBm';
  }

  function portId(slot, port) {
    return 'fx16-lt' + slot + '-pon' + port;
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function setStatus(msg) {
    if (global.FtthLab && FtthLab.setStatus) FtthLab.setStatus(msg);
  }

  function ensureSlotWiring(slot) {
    if (!sfpMap[slot]) sfpMap[slot] = {};
    for (var p = 1; p <= PORT_COUNT; p++) {
      var id = portId(slot, p);
      if (!portWiring[id]) {
        portWiring[id] = {
          portId: id,
          slot: slot,
          port: p,
          connected: false,
          jumperId: null,
          peer: null,
          readyForJumper: true,
          hasSfp: false,
          polish: 'UPC',
        };
      }
    }
  }

  function clearSlotWiring(slot) {
    for (var p = 1; p <= PORT_COUNT; p++) {
      delete portWiring[portId(slot, p)];
    }
    delete sfpMap[slot];
  }

  function findCardInv(cardId) {
    for (var i = 0; i < cardInventory.length; i++) {
      if (cardInventory[i].id === cardId) return cardInventory[i];
    }
    return null;
  }

  function findSfpInv(sfpId) {
    for (var i = 0; i < sfpInventory.length; i++) {
      if (sfpInventory[i].id === sfpId) return sfpInventory[i];
    }
    return null;
  }

  function findInstalledSlot(cardId) {
    for (var s = 1; s <= SLOT_COUNT; s++) {
      if (installed[s] && installed[s].id === cardId) return s;
    }
    return null;
  }

  function hasSfp(slot, port) {
    return !!(sfpMap[slot] && sfpMap[slot][port]);
  }

  function sfpModule(slot, port) {
    return (sfpMap[slot] && sfpMap[slot][port]) || null;
  }

  /** Factory rubber dust plug — on until the user pops it or a jumper seats. */
  function sfpHasDustCap(slot, port) {
    var mod = sfpModule(slot, port);
    return !!(mod && mod.dustCap !== false);
  }

  function isSfpPatched(slot, port) {
    if (global.FtthLab && typeof FtthLab.isPatchOnOltPort === 'function') {
      return !!FtthLab.isPatchOnOltPort(slot, port);
    }
    var w = portWiring[portId(slot, port)];
    return !!(w && w.connected);
  }

  function applySfpDustDom(slot, port) {
    var el = portElement(slot, port);
    if (!el) return;
    var patched = isSfpPatched(slot, port);
    var capped = sfpHasDustCap(slot, port) && !patched;
    el.classList.toggle('is-capped', capped);
    el.classList.toggle('is-patched', patched);
    var cap = el.querySelector('[data-lab-sfp-dust]');
    if (!cap) return;
    cap.classList.toggle('is-stowed', !capped && !patched);
    cap.classList.toggle('is-hidden', patched);
    cap.title = patched
      ? 'Dust cover hidden · patch seated'
      : (capped ? 'Dust cover · click to remove' : 'Dust cover stowed · click to refit');
  }

  function toggleSfpDustCap(slot, port) {
    var mod = sfpModule(slot, port);
    if (!mod) return;
    if (isSfpPatched(slot, port)) {
      setStatus('Unplug the patch cord before refitting the SFP dust cover');
      return;
    }
    mod.dustCap = !sfpHasDustCap(slot, port);
    applySfpDustDom(slot, port);
    setStatus(
      mod.dustCap
        ? 'SFP dust cover fitted on Port ' + port
        : 'SFP dust cover removed from Port ' + port
    );
  }

  /** Patch-cord hook: hide the dust cover the moment a jumper seats. */
  function syncSfpPatchState(slot, port) {
    var mod = sfpModule(slot, port);
    if (!mod) return;
    var patched = isSfpPatched(slot, port);
    if (patched) mod.dustCap = false;
    else mod.dustCap = true;
    var w = portWiring[portId(slot, port)];
    if (w) w.connected = patched;
    applySfpDustDom(slot, port);
  }

  function detachPatchesFromOltPort(slot, port) {
    if (global.FtthLab && typeof FtthLab.detachPcordsFromOltPort === 'function') {
      FtthLab.detachPcordsFromOltPort(slot, port);
    }
  }

  /* ─── Chassis place / remove ─── */

  function placeChassis() {
    if (chassisPlaced) {
      setStatus('Chassis already on workspace');
      return false;
    }
    chassisPlaced = true;
    chassisInLibrary = false;
    var pos = defaultChassisPos();
    chassisX = pos.x;
    chassisY = pos.y;
    chassisScale = 1;
    rebuildViews();
    selectChassis();
    var hud = document.getElementById('lab-hud-mode');
    if (hud) hud.textContent = '2D Layout · FX-16 Chassis';
    pushHistory();
    setStatus('FX-16 placed · drag chassis to move · corner handles to resize');
    return true;
  }

  function removeChassis() {
    if (!chassisPlaced) return false;
    /* Clear all cards + SFPs with chassis */
    for (var s = 1; s <= SLOT_COUNT; s++) {
      if (installed[s]) {
        clearSlotWiring(s);
        delete installed[s];
      }
    }
    cardInventory = [];
    sfpInventory = [];
    chassisPlaced = false;
    chassisInLibrary = true;
    chassisScale = 1;
    var pos = defaultChassisPos();
    chassisX = pos.x;
    chassisY = pos.y;
    rebuildViews();
    selectLibraryChassis();
    var hud = document.getElementById('lab-hud-mode');
    if (hud) hud.textContent = '2D Layout · Empty Workspace';
    pushHistory();
    setStatus('Chassis removed · workspace empty · drag FX-16 from the toolbox to restart');
    return true;
  }

  /* ─── Card install / eject ─── */

  function installCard(cardId, slot) {
    if (!chassisPlaced) {
      setStatus('Place the FX-16 chassis on the workspace first');
      return false;
    }
    slot = parseInt(slot, 10);
    if (slot < 1 || slot > SLOT_COUNT) return false;
    if (installed[slot]) {
      setStatus('LT' + pad2(slot) + ' occupied — eject first');
      return false;
    }

    var card = cardId ? findCardInv(cardId) : null;
    var fromSlot = cardId ? findInstalledSlot(cardId) : null;
    if (!card && fromSlot == null) {
      cardId = takeNextCard();
      card = findCardInv(cardId);
    }
    if (card) {
      cardInventory = cardInventory.filter(function (c) { return c.id !== cardId; });
    } else if (fromSlot != null) {
      if (fromSlot === slot) return true;
      card = installed[fromSlot];
      var movedSfps = sfpMap[fromSlot] || {};
      delete installed[fromSlot];
      delete sfpMap[fromSlot];
      for (var p = 1; p <= PORT_COUNT; p++) delete portWiring[portId(fromSlot, p)];
      installed[slot] = { id: card.id, model: card.model || 'FGLT-D' };
      ensureSlotWiring(slot);
      sfpMap[slot] = movedSfps;
      Object.keys(movedSfps).forEach(function (pk) {
        var port = parseInt(pk, 10);
        if (portWiring[portId(slot, port)]) {
          portWiring[portId(slot, port)].hasSfp = true;
        }
      });
      rebuildViews();
      selectCard(slot);
      pushHistory();
      setStatus('FGLT-D moved to LT' + pad2(slot));
      return true;
    } else {
      return false;
    }

    installed[slot] = { id: card.id, model: card.model || 'FGLT-D' };
    ensureSlotWiring(slot);
    if (!sfpMap[slot]) sfpMap[slot] = {};
    rebuildViews();
    selectCard(slot);
    pushHistory();
    setStatus('FGLT-D seated in LT' + pad2(slot) + ' · drag SFP modules into square ports');
    return true;
  }

  function ejectCard(slot) {
    slot = parseInt(slot, 10);
    if (!installed[slot]) return false;
    for (var p = 1; p <= PORT_COUNT; p++) {
      detachPatchesFromOltPort(slot, p);
    }
    delete installed[slot];
    clearSlotWiring(slot);
    rebuildViews();
    selectSlot(slot);
    pushHistory();
    setStatus('FGLT-D ejected from LT' + pad2(slot));
    return true;
  }

  /* ─── SFP insert / remove ─── */

  function installSfp(sfpId, slot, port) {
    if (!chassisPlaced) {
      setStatus('Place the FX-16 chassis first');
      return false;
    }
    slot = parseInt(slot, 10);
    port = parseInt(port, 10);
    if (!installed[slot]) {
      setStatus('Install an FGLT-D card before inserting SFP modules');
      return false;
    }
    if (port < 1 || port > PORT_COUNT) return false;
    if (!sfpMap[slot]) sfpMap[slot] = {};
    if (sfpMap[slot][port]) {
      setStatus('Port ' + port + ' already has an SFP — remove it first');
      return false;
    }
    var mod = sfpId ? findSfpInv(sfpId) : null;
    if (!mod) {
      sfpId = takeNextSfp();
      mod = findSfpInv(sfpId);
    }
    if (!mod) return false;
    sfpInventory = sfpInventory.filter(function (m) { return m.id !== sfpId; });
    normalizeSfpModule(mod);
    mod.dustCap = true;
    sfpMap[slot][port] = mod;
    justSeated = portId(slot, port);
    if (portWiring[portId(slot, port)]) {
      portWiring[portId(slot, port)].hasSfp = true;
      if (!portWiring[portId(slot, port)].polish) {
        portWiring[portId(slot, port)].polish = 'UPC';
      }
    }
    rebuildViews();
    selectPort(slot, port);
    pushHistory();
    refreshOpticalOutputs();
    setStatus('SFP seated in LT' + pad2(slot) + ' · Port ' + port + ' · jumper-ready');
    return true;
  }

  function ejectSfp(slot, port) {
    slot = parseInt(slot, 10);
    port = parseInt(port, 10);
    if (!sfpMap[slot] || !sfpMap[slot][port]) return false;
    detachPatchesFromOltPort(slot, port);
    delete sfpMap[slot][port];
    if (portWiring[portId(slot, port)]) {
      portWiring[portId(slot, port)].hasSfp = false;
      portWiring[portId(slot, port)].connected = false;
    }
    rebuildViews();
    selectPort(slot, port);
    pushHistory();
    refreshOpticalOutputs();
    setStatus('SFP ejected from Port ' + port + ' · cage dust cap restored');
    return true;
  }

  /* ─── Selection ─── */

  function claimSelection() {
    if (global.FtthLab && typeof FtthLab.setSelectionOwner === 'function') {
      FtthLab.setSelectionOwner('olt-fx16');
    }
  }

  function claimOltToolbox() {
    if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
      FtthLab.claimToolboxTool('olt-fx16');
    }
  }

  function disarmToolboxHighlight() {
    if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
      FtthLab.claimToolboxTool(null);
    } else {
      armedToolbox = null;
      renderToolbox();
    }
  }

  function selectLibraryChassis(opts) {
    opts = opts || {};
    claimSelection();
    claimOltToolbox();
    armedToolbox = 'chassis';
    selection = { kind: 'lib-chassis', slot: null, port: null, cardId: null, sfpId: null };
    updateInspector();
    if (!opts.keepToolbox) renderToolbox();
    setStatus('FX-16 selected · drag onto the empty workspace grid to place');
  }

  function selectChassis(opts) {
    opts = opts || {};
    if (!chassisPlaced) {
      selectLibraryChassis();
      return;
    }
    claimSelection();
    selection = { kind: 'chassis', slot: null, port: null, cardId: null, sfpId: null };
    updateInspector();
    if (opts.keepArm || armedToolbox) renderToolbox();
    setStatus('FX-16 on workspace · drag FGLT-D into LT slots 01–16');
  }

  function selectSlot(slot) {
    claimSelection();
    selection = { kind: 'slot', slot: slot, port: null, cardId: null, sfpId: null };
    updateInspector();
    setStatus(installed[slot]
      ? 'LT' + pad2(slot) + ' · FGLT-D installed'
      : 'LT' + pad2(slot) + ' · blanking plate · drop FGLT-D here');
  }

  function selectCard(slot) {
    if (!installed[slot]) {
      selectSlot(slot);
      return;
    }
    claimSelection();
    selection = {
      kind: 'card',
      slot: slot,
      port: null,
      cardId: installed[slot].id,
      sfpId: null,
    };
    updateInspector();
    setStatus('FGLT-D in LT' + pad2(slot) + ' · drag SFP into square ports 1–16');
  }

  function selectPort(slot, port) {
    if (!installed[slot]) return;
    claimSelection();

    /* Smart Splitter patch mode — validate UPC/APC before normal select */
    if (hasSfp(slot, port) && global.FtthLab && typeof FtthLab.tryPatchPort === 'function') {
      var wiring = portWiring[portId(slot, port)] || {};
      var handled = FtthLab.tryPatchPort({
        owner: 'olt',
        polish: wiring.polish || 'UPC',
        label: 'LT' + pad2(slot) + '/P' + port,
        slot: slot,
        oltPort: port,
      });
      if (handled) {
        selection = {
          kind: 'port',
          slot: slot,
          port: port,
          cardId: installed[slot].id,
          sfpId: sfpMap[slot][port].id,
        };
        updateInspector();
        return;
      }
    }

    selection = {
      kind: 'port',
      slot: slot,
      port: port,
      cardId: installed[slot].id,
      sfpId: hasSfp(slot, port) ? sfpMap[slot][port].id : null,
    };
    updateInspector();
    setStatus(
      hasSfp(slot, port)
        ? 'Port ' + port + ' · SFP active · ' + portId(slot, port) +
          ' · ' + ((portWiring[portId(slot, port)] && portWiring[portId(slot, port)].polish) || 'UPC')
        : 'Port ' + port + ' · empty square cage · drop SFP module'
    );
  }

  function selectLibraryCard(cardId, opts) {
    opts = opts || {};
    claimSelection();
    claimOltToolbox();
    armedToolbox = 'card';
    selection = { kind: 'lib-card', slot: null, port: null, cardId: cardId, sfpId: null };
    updateInspector();
    if (!opts.keepToolbox) renderToolbox();
    setStatus('FGLT-D selected · drop onto empty LT slot 01–16');
  }

  function selectLibrarySfp(sfpId, opts) {
    opts = opts || {};
    claimSelection();
    claimOltToolbox();
    armedToolbox = 'sfp';
    selection = { kind: 'lib-sfp', slot: null, port: null, cardId: null, sfpId: sfpId };
    updateInspector();
    if (!opts.keepToolbox) renderToolbox();
    setStatus('SFP selected · drop onto an empty square port on an installed FGLT-D');
  }

  /* ─── Simple 3-item toolbox drawer ─── */

  function renderToolbox() {
    var host = document.getElementById('lab-hw-tree');
    if (!host) return;
    if (global.FtthLab && typeof FtthLab.anyToolboxToolVisible === 'function' &&
        !FtthLab.anyToolboxToolVisible(['chassis', 'card', 'sfp'])) {
      host.innerHTML = '';
      return;
    }

    var chassisSel = armedToolbox === 'chassis';
    var cardSel = armedToolbox === 'card';
    var sfpSel = armedToolbox === 'sfp';

    host.innerHTML =
      '<div class="lab-toolbox" role="list">' +
      '<button type="button" class="lab-tool' + (chassisSel ? ' is-selected' : '') +
      (chassisPlaced ? ' is-used' : '') +
      '" draggable="' + (chassisPlaced ? 'false' : 'true') +
      '" data-lab-tool="chassis" role="listitem">' +
      '<span class="lab-tool__mark lab-tool__mark--chassis" aria-hidden="true"></span>' +
      '<span class="lab-tool__copy"><strong>Nokia 7360 FX-16</strong><span>OLT</span></span>' +
      '</button>' +
      '<button type="button" class="lab-tool' + (cardSel ? ' is-selected' : '') +
      '" draggable="true" data-lab-tool="card" role="listitem">' +
      '<span class="lab-tool__mark lab-tool__mark--card" aria-hidden="true"></span>' +
      '<span class="lab-tool__copy"><strong>FGLT-D Line Card</strong><span>Line card</span></span>' +
      '</button>' +
      '<button type="button" class="lab-tool' + (sfpSel ? ' is-selected' : '') +
      '" draggable="true" data-lab-tool="sfp" role="listitem">' +
      '<span class="lab-tool__mark lab-tool__mark--sfp" aria-hidden="true"></span>' +
      '<span class="lab-tool__copy"><strong>SFP Transceiver</strong><span>Optical module</span></span>' +
      '</button>' +
      '</div>';

    bindToolboxEvents(host);
    if (global.FtthLab && typeof FtthLab.applyFtthLabToolboxIcons === 'function') {
      FtthLab.applyFtthLabToolboxIcons();
    }
  }

  function occupiedSlots() {
    var list = [];
    for (var s = 1; s <= SLOT_COUNT; s++) {
      if (installed[s]) list.push(s);
    }
    return list;
  }

  function beginLabDrag(payload) {
    if (global.FtthLab && typeof FtthLab.beginDrag === 'function') {
      FtthLab.beginDrag(payload);
    }
  }

  function endLabDrag() {
    if (global.FtthLab && typeof FtthLab.endDrag === 'function') {
      FtthLab.endDrag();
    }
    if (global.FtthLab && typeof FtthLab.clearStageDropHighlight === 'function') {
      FtthLab.clearStageDropHighlight();
    }
  }

  function getLabDrag() {
    if (global.FtthLab && typeof FtthLab.getActiveDrag === 'function') {
      return FtthLab.getActiveDrag();
    }
    return null;
  }

  function bindToolboxEvents(host) {
    var chassisBtn = host.querySelector('[data-lab-tool="chassis"]');
    var cardBtn = host.querySelector('[data-lab-tool="card"]');
    var sfpBtn = host.querySelector('[data-lab-tool="sfp"]');

    if (chassisBtn) {
      chassisBtn.addEventListener('click', function () {
        claimOltToolbox();
        armedToolbox = 'chassis';
        if (chassisPlaced) selectChassis({ keepArm: true });
        else selectLibraryChassis({ keepToolbox: true });
        renderToolbox();
      });
      chassisBtn.addEventListener('dragstart', function (e) {
        if (chassisPlaced) {
          e.preventDefault();
          setStatus('Chassis already on workspace');
          return;
        }
        dragState = { type: 'chassis' };
        beginLabDrag({ kind: 'chassis' });
        try {
          e.dataTransfer.setData('text/plain', 'lab:chassis');
          e.dataTransfer.setData('text/lab-drag', 'chassis');
          e.dataTransfer.effectAllowed = 'copy';
        } catch (err) { /* ignore */ }
        chassisBtn.classList.add('is-dragging', 'is-selected');
        /* keepToolbox: rebuilding HTML mid-drag cancels HTML5 DnD */
        selectLibraryChassis({ keepToolbox: true });
      });
      chassisBtn.addEventListener('dragend', function () {
        dragState = null;
        endLabDrag();
        chassisBtn.classList.remove('is-dragging');
        clearDropHighlights();
        renderToolbox();
      });
    }

    if (cardBtn) {
      cardBtn.addEventListener('click', function () {
        selectLibraryCard(null);
      });
      cardBtn.addEventListener('dragstart', function (e) {
        if (!chassisPlaced) {
          e.preventDefault();
          setStatus('Place the FX-16 chassis on the workspace first');
          return;
        }
        var cardId = takeNextCard();
        dragState = { type: 'card', cardId: cardId };
        beginLabDrag({ kind: 'card', cardId: cardId });
        try {
          e.dataTransfer.setData('text/plain', 'lab:card:' + cardId);
          e.dataTransfer.setData('text/lab-drag', 'card');
          e.dataTransfer.setData('text/lab-card-id', cardId);
          e.dataTransfer.effectAllowed = 'copy';
        } catch (err) { /* ignore */ }
        cardBtn.classList.add('is-dragging', 'is-selected');
        selectLibraryCard(cardId, { keepToolbox: true });
      });
      cardBtn.addEventListener('dragend', function () {
        dragState = null;
        endLabDrag();
        cardBtn.classList.remove('is-dragging');
        clearDropHighlights();
        renderToolbox();
      });
    }

    if (sfpBtn) {
      sfpBtn.addEventListener('click', function () {
        selectLibrarySfp(null);
      });
      sfpBtn.addEventListener('dragstart', function (e) {
        if (!occupiedSlots().length) {
          e.preventDefault();
          setStatus('Install an FGLT-D card before placing SFP modules');
          return;
        }
        var sfpId = takeNextSfp();
        dragState = { type: 'sfp', sfpId: sfpId };
        beginLabDrag({ kind: 'sfp', sfpId: sfpId });
        try {
          e.dataTransfer.setData('text/plain', 'lab:sfp:' + sfpId);
          e.dataTransfer.setData('text/lab-drag', 'sfp');
          e.dataTransfer.setData('text/lab-sfp-id', sfpId);
          e.dataTransfer.effectAllowed = 'copy';
        } catch (err) { /* ignore */ }
        sfpBtn.classList.add('is-dragging', 'is-selected');
        selectLibrarySfp(sfpId, { keepToolbox: true });
      });
      sfpBtn.addEventListener('dragend', function () {
        dragState = null;
        endLabDrag();
        sfpBtn.classList.remove('is-dragging');
        clearDropHighlights();
        renderToolbox();
      });
    }
  }

  function clearDropHighlights() {
    document.querySelectorAll('.is-drop-target').forEach(function (n) {
      n.classList.remove('is-drop-target');
    });
  }

  function isChassisDragPayload() {
    var active = getLabDrag();
    if (active && active.kind === 'chassis') return true;
    return !!(dragState && dragState.type === 'chassis');
  }

  function bindStageDrop() {
    if (stageDropBound) return;
    stageDropBound = true;

    function onDragOver(e) {
      if (chassisPlaced) return;
      if (!isChassisDragPayload()) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      var zone = e.currentTarget;
      if (zone) zone.classList.add('is-drop-target');
    }

    function onDragLeave(e) {
      var zone = e.currentTarget;
      if (!zone) return;
      var related = e.relatedTarget;
      if (related && zone.contains(related)) return;
      zone.classList.remove('is-drop-target');
    }

    function onDrop(e) {
      var active = getLabDrag();
      var kind = (e.dataTransfer && e.dataTransfer.getData('text/lab-drag')) ||
        (active && active.kind) ||
        (dragState && dragState.type);
      if (kind !== 'chassis') return;
      e.preventDefault();
      e.stopPropagation();
      var zone = e.currentTarget;
      if (zone) zone.classList.remove('is-drop-target');
      placeChassis();
      dragState = null;
      endLabDrag();
    }

    ['lab-2d-mount', 'lab-canvas-2d', 'lab-2d-world', 'lab-canvas-3d'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('dragover', onDragOver);
      el.addEventListener('dragleave', onDragLeave);
      el.addEventListener('drop', onDrop);
    });
  }

  /* ─── Inspector ─── */

  function updateInspector() {
    var card = document.getElementById('lab-inspector-card');
    var detail = document.getElementById('lab-inspector-detail');
    if (!card) return;

    var title = 'No selection';
    var body = 'Select equipment on the canvas, or drag an item from the toolbox.';

    if (selection.kind === 'lib-chassis') {
      title = 'Nokia 7360 FX-16 · OLT';
      body = 'Drag onto the workspace to place the chassis.';
    } else if (selection.kind === 'lib-card') {
      title = 'FGLT-D Line Card';
      body = chassisPlaced
        ? 'Drop onto an empty LT slot, or click a slot while selected.'
        : 'Place the FX-16 chassis before installing cards.';
    } else if (selection.kind === 'lib-sfp') {
      title = 'SFP Transceiver';
      body = occupiedSlots().length
        ? 'Drop onto an empty square port on an FGLT-D.'
        : 'Install an FGLT-D card first, then insert SFPs.';
    } else if (selection.kind === 'chassis') {
      title = 'Nokia 7360 ISAM FX-16';
      body = '16 LT slots · drag FGLT-D from the toolbox into a slot.';
    } else if (selection.kind === 'slot') {
      title = 'LT Slot ' + pad2(selection.slot);
      body = installed[selection.slot]
        ? 'FGLT-D installed · select ports or eject the card.'
        : 'Empty slot · drop FGLT-D here to install.';
    } else if (selection.kind === 'card') {
      title = 'FGLT-D · LT' + pad2(selection.slot);
      body = '16 SFP cages · drop modules into empty ports.';
    } else if (selection.kind === 'port') {
      var active = hasSfp(selection.slot, selection.port);
      var spec = active ? getSfpProfile(sfpModule(selection.slot, selection.port).profileId) : null;
      title = 'Port ' + selection.port + (active ? ' · ' + spec.shortName : ' · Empty');
      body = 'LT' + pad2(selection.slot) + ' · ' + portId(selection.slot, selection.port) +
        (active ? ' · TX ' + spec.txNm + ' nm' : ' · insert an SFP');
    }

    card.innerHTML = '<h2>' + title + '</h2><p>' + body + '</p>';

    if (!detail) return;

    if (selection.kind === 'port') {
      var activePort = hasSfp(selection.slot, selection.port);
      var w = portWiring[portId(selection.slot, selection.port)] || {};
      var polish = w.polish || 'UPC';
      var mod = activePort ? sfpModule(selection.slot, selection.port) : null;
      if (mod) normalizeSfpModule(mod);
      var spec = mod ? getSfpProfile(mod.profileId) : null;
      var profileOpts = '';
      var profileMap = getSfpProfileMap();
      Object.keys(profileMap).forEach(function (pid) {
        var pr = profileMap[pid];
        profileOpts +=
          '<option value="' + pr.id + '"' +
          (spec && spec.id === pr.id ? ' selected' : '') + '>' +
          pr.name + '</option>';
      });
      var sfpControls = '';
      if (activePort && spec) {
        sfpControls =
          '<p class="lab-inspector__label">SFP model</p>' +
          '<select class="lab-sfp-profile" data-sfp-profile="1">' + profileOpts + '</select>' +
          '<div class="lab-sfp-spec">' +
          '<span>TX ' + spec.txNm + ' nm</span>' +
          '<span>RX ' + spec.rxNm + ' nm</span>' +
          '<span>Sens ' + spec.sensitivity + ' dBm</span>' +
          (spec.txLevels && spec.txLevels.length
            ? '<span>TX levels ' + spec.txLevels.map(function (n) {
              return (n >= 0 ? '+' : '') + n;
            }).join(', ') + ' dBm</span>'
            : '') +
          (spec.rxLevels && spec.rxLevels.length
            ? '<span>RX levels ' + spec.rxLevels.map(function (n) {
              return (n >= 0 ? '+' : '') + n;
            }).join(', ') + ' dBm</span>'
            : '') +
          '<span>Range ' + spec.txMin + ' … ' + spec.txMax + ' dBm</span>' +
          '</div>' +
          '<p class="lab-inspector__label">TX power <strong data-sfp-tx-val>' +
          fmtDbm(mod.txDbm) + '</strong></p>' +
          '<div class="lab-sfp-tx">' +
          '<input type="range" data-sfp-tx-range min="' + spec.txMin + '" max="' + spec.txMax +
          '" step="0.1" value="' + mod.txDbm + '" aria-label="SFP TX power">' +
          '<input type="number" data-sfp-tx-num min="' + spec.txMin + '" max="' + spec.txMax +
          '" step="0.1" value="' + mod.txDbm.toFixed(1) + '" aria-label="SFP TX dBm">' +
          '</div>' +
          '<p class="lab-sfp-tx-bounds">' + fmtDbm(spec.txMin) + ' – ' + fmtDbm(spec.txMax) + '</p>' +
          '<p class="lab-inspector__label">SFP polish</p>' +
          '<div class="lab-polish-toggle" role="group">' +
          '<button type="button" class="lab-polish-btn is-upc' +
          (polish === 'UPC' ? ' is-active' : '') +
          '" data-set-olt-polish="UPC">UPC · Blue</button>' +
          '<button type="button" class="lab-polish-btn is-apc' +
          (polish === 'APC' ? ' is-active' : '') +
          '" data-set-olt-polish="APC">APC · Green</button>' +
          '</div>' +
          '<button type="button" class="lab-eject-btn" data-lab-eject-sfp="1">Eject SFP</button>';
      }
      detail.innerHTML =
        '<div class="lab-port-sheet">' +
        '<div><span>Status</span><strong>' + (activePort ? 'SFP seated' : 'Empty cage') + '</strong></div>' +
        '<div><span>Port</span><strong>' + selection.port + ' / 16</strong></div>' +
        '<div><span>Port ID</span><strong>' + portId(selection.slot, selection.port) + '</strong></div>' +
        (activePort
          ? '<div><span>Polish</span><strong>' + polish + '</strong></div>'
          : '') +
        '</div>' +
        (activePort
          ? sfpControls
          : '<button type="button" class="lab-install-btn" data-lab-install-sfp="1">Insert SFP into Port ' +
            selection.port + '</button>');
      detail.hidden = false;
      detail.querySelectorAll('[data-set-olt-polish]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var pid = portId(selection.slot, selection.port);
          if (!portWiring[pid]) return;
          portWiring[pid].polish = btn.getAttribute('data-set-olt-polish');
          rebuildViews();
          selectPort(selection.slot, selection.port);
          setStatus('OLT port polish → ' + portWiring[pid].polish);
        });
      });
      var profileEl = detail.querySelector('[data-sfp-profile]');
      if (profileEl) {
        profileEl.addEventListener('change', function () {
          setSfpProfile(selection.slot, selection.port, profileEl.value);
          pushHistory();
        });
      }
      var rangeEl = detail.querySelector('[data-sfp-tx-range]');
      var numEl = detail.querySelector('[data-sfp-tx-num]');
      var valEl = detail.querySelector('[data-sfp-tx-val]');
      function syncTxUi(v) {
        if (rangeEl) rangeEl.value = String(v);
        if (numEl) numEl.value = v.toFixed(1);
        if (valEl) valEl.textContent = fmtDbm(v);
      }
      function onTxInput(raw, commit) {
        var next = setSfpTxPower(selection.slot, selection.port, raw, { silent: !commit });
        if (next == null) return;
        syncTxUi(next);
        if (commit) pushHistory();
      }
      if (rangeEl) {
        rangeEl.addEventListener('input', function () { onTxInput(rangeEl.value, false); });
        rangeEl.addEventListener('change', function () { onTxInput(rangeEl.value, true); });
      }
      if (numEl) {
        numEl.addEventListener('input', function () { onTxInput(numEl.value, false); });
        numEl.addEventListener('change', function () { onTxInput(numEl.value, true); });
      }
      var ej = detail.querySelector('[data-lab-eject-sfp]');
      if (ej) ej.addEventListener('click', function () {
        ejectSfp(selection.slot, selection.port);
      });
      var ins = detail.querySelector('[data-lab-install-sfp]');
      if (ins) ins.addEventListener('click', function () {
        installSfp(null, selection.slot, selection.port);
      });
    } else if (selection.kind === 'card' || (selection.kind === 'slot' && installed[selection.slot])) {
      var slot = selection.slot;
      var ports = '';
      for (var i = 1; i <= PORT_COUNT; i++) {
        var on = hasSfp(slot, i);
        ports += '<button type="button" class="lab-port-chip' +
          (selection.port === i ? ' is-active' : '') +
          (on ? ' is-filled' : '') +
          '" data-lab-port="' + i + '">P' + i + '</button>';
      }
      detail.innerHTML =
        '<p class="lab-inspector__label">SFP ports</p>' +
        '<div class="lab-port-grid">' + ports + '</div>' +
        '<button type="button" class="lab-eject-btn" data-lab-eject="' + slot + '">Eject FGLT-D</button>';
      detail.hidden = false;
      detail.querySelectorAll('[data-lab-port]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          selectPort(slot, parseInt(btn.getAttribute('data-lab-port'), 10));
        });
      });
      var eject = detail.querySelector('[data-lab-eject]');
      if (eject) eject.addEventListener('click', function () {
        ejectCard(parseInt(eject.getAttribute('data-lab-eject'), 10));
      });
    } else if (selection.kind === 'chassis' && chassisPlaced) {
      detail.innerHTML =
        '<button type="button" class="lab-eject-btn" data-lab-remove-chassis="1">Remove Chassis</button>';
      detail.hidden = false;
      detail.querySelector('[data-lab-remove-chassis]').addEventListener('click', removeChassis);
    } else if (selection.kind === 'lib-chassis' && chassisInLibrary) {
      detail.innerHTML =
        '<button type="button" class="lab-install-btn" data-lab-place-chassis="1">Place FX-16 on Workspace</button>';
      detail.hidden = false;
      detail.querySelector('[data-lab-place-chassis]').addEventListener('click', placeChassis);
    } else if (selection.kind === 'slot' && !installed[selection.slot]) {
      detail.innerHTML =
        '<button type="button" class="lab-install-btn" data-lab-install-slot="' + selection.slot + '">' +
        'Install FGLT-D into LT' + pad2(selection.slot) + '</button>';
      detail.hidden = false;
      detail.querySelector('[data-lab-install-slot]').addEventListener('click', function () {
        installCard(selection.cardId, selection.slot);
      });
    } else {
      detail.hidden = true;
      detail.innerHTML = '';
    }

    syncSelectionUi();
  }

  function syncSelectionUi() {
    if (!el2d) return;
    el2d.querySelectorAll('.lab-fx-slot').forEach(function (node) {
      var s = parseInt(node.getAttribute('data-lab-slot'), 10);
      node.classList.toggle('is-selected', selection.slot === s);
      node.classList.toggle(
        'is-drop-target',
        !!(dragState && dragState.type === 'card' && !installed[s])
      );
    });
    el2d.querySelectorAll('.lab-fx-port').forEach(function (node) {
      var p = parseInt(node.getAttribute('data-lab-sfp'), 10);
      var s = parseInt(node.getAttribute('data-lab-slot'), 10);
      var filled = hasSfp(s, p);
      node.classList.toggle('is-selected',
        selection.kind === 'port' && selection.port === p && selection.slot === s);
      node.classList.toggle('is-active', filled);
      node.classList.toggle('is-empty', !filled);
      node.classList.toggle(
        'is-drop-target',
        !!(dragState && dragState.type === 'sfp' && installed[s] && !filled)
      );
    });

    pickables.forEach(function (mesh) {
      if (!mesh || !mesh.material || !mesh.userData) return;
      var ud = mesh.userData;
      var on = false;
      if (ud.kind === 'slot' && selection.slot === ud.slot) on = true;
      if (ud.kind === 'card' && selection.slot === ud.slot &&
        (selection.kind === 'card' || selection.kind === 'port')) on = true;
      if (ud.kind === 'port' && selection.kind === 'port' &&
        selection.slot === ud.slot && selection.port === ud.port) on = true;
      if (mesh.material.emissive) {
        mesh.material.emissive.setHex(on ? 0x38bdf8 : 0x000000);
        mesh.material.emissiveIntensity = on ? 0.4 : 0;
      }
    });
  }

  /* ─── 2D faceplate · top-down angled SFP tier ─── */

  /**
   * LC-GP16 seats its 16 cages on a slanted tier, so the modules read as a
   * side-by-side diagonal cascade when the board is viewed from above.
   */
  var PORT_TILT_DEG = -18;

  /** Slot seat angle — an inserted SFP adopts exactly this rotation. */
  function portTiltDeg(slot, port) {
    return PORT_TILT_DEG;
  }

  /** Ferrule points back down the module axis; 0° = ferrule up. */
  function portConnectorRot(tiltDeg) {
    return tiltDeg - 90;
  }

  /** Smooth metallic SFP: body, front optical bore, bail latch, dust cover. */
  function sfpAssetHtml(opts) {
    opts = opts || {};
    var patched = !!opts.patched;
    var capped = !!opts.capped && !patched;
    var dustClass = patched ? ' is-hidden' : (capped ? '' : ' is-stowed');
    var dustTitle = patched
      ? 'Dust cover hidden · patch seated'
      : (capped ? 'Dust cover · click to remove' : 'Dust cover stowed · click to refit');
    return (
      '<span class="lab-fx-sfp">' +
      '<span class="lab-fx-sfp__shell"></span>' +
      '<span class="lab-fx-sfp__bail"></span>' +
      '<span class="lab-fx-port__cage"><i></i><i></i></span>' +
      '<span class="lab-fx-sfp__dust' + dustClass + '" ' +
      'data-lab-sfp-dust="1" role="button" tabindex="0" title="' + dustTitle + '" ' +
      'aria-label="SFP dust cover"></span>' +
      '</span>'
    );
  }

  function fgltFaceHtml(slot) {
    var ports = '';
    for (var p = 1; p <= PORT_COUNT; p++) {
      var filled = hasSfp(slot, p);
      var id = portId(slot, p);
      var polish = (portWiring[id] && portWiring[id].polish) || 'UPC';
      var polishClass = filled ? (polish === 'APC' ? ' is-apc' : ' is-upc') : '';
      var tilt = portTiltDeg(slot, p);
      var seating = filled && justSeated === id ? ' is-seating' : '';
      var patched = filled && isSfpPatched(slot, p);
      var capped = filled && sfpHasDustCap(slot, p) && !patched;
      var dustClass = capped ? ' is-capped' : '';
      var patchedClass = patched ? ' is-patched' : '';
      ports +=
        '<button type="button" class="lab-fx-port' + (filled ? ' is-active' : ' is-empty') +
        polishClass + seating + dustClass + patchedClass + '" ' +
        'style="--fx-i:' + (p - 1) + ';--fx-port-tilt:' + tilt + 'deg" ' +
        'data-lab-sfp="' + p + '" data-lab-slot="' + slot + '" data-lab-port-id="' + id + '" ' +
        'data-lab-port-tilt="' + tilt + '" ' +
        'data-lab-port-rot="' + portConnectorRot(tilt) + '" ' +
        'data-lab-drop="sfp" title="Port ' + p + (filled ? ' · SFP · ' + polish : ' · empty') + '">' +
        '<span class="lab-fx-port__module">' +
        '<span class="lab-fx-port__rail"></span>' +
        (filled
          ? sfpAssetHtml({ capped: capped, patched: patched })
          : '<span class="lab-fx-cage-dust" title="Cage dust cap" aria-hidden="true"></span>') +
        '</span>' +
        '<span class="lab-fx-port__num">' + p + '</span>' +
        '<span class="lab-fx-port__led' + (filled ? ' is-on' : '') + '"></span>' +
        '</button>';
    }
    return (
      '<div class="lab-fx-card" data-lab-card-slot="' + slot + '">' +
      '<div class="lab-fx-card__leds" title="Status">' +
      '<i class="is-traffic" title="Traffic"></i>' +
      '<i class="is-active" title="Active"></i>' +
      '<i class="is-alarm" title="Alarm"></i>' +
      '<i class="is-fault" title="Fault"></i>' +
      '</div>' +
      '<div class="lab-fx-card__sku">LC-GP16</div>' +
      '<div class="lab-fx-card__ports">' + ports + '</div>' +
      '<div class="lab-fx-card__name">FGLT-D</div>' +
      '</div>'
    );
  }

  function blankingHtml() {
    return '<div class="lab-fx-blank" aria-hidden="true"><span></span><span></span></div>';
  }

  function build2d(host) {
    if (!host) return;
    if (el2d && el2d.parentNode) el2d.parentNode.removeChild(el2d);
    el2d = null;

    /* Blank slate — clean grid, no instructional overlay */
    if (!chassisPlaced) {
      syncSelectionUi();
      return;
    }

    el2d = document.createElement('div');
    el2d.className = 'lab-olt-2d';

    var slotsHtml = '';
    for (var s = 1; s <= SLOT_COUNT; s++) {
      var filled = !!installed[s];
      slotsHtml +=
        '<div class="lab-fx-slot' + (filled ? ' is-filled' : ' is-empty') + '" ' +
        'data-lab-slot="' + s + '" data-lab-drop="lt" title="LT' + pad2(s) + '">' +
        (filled ? fgltFaceHtml(s) : blankingHtml()) +
        '</div>';
    }

    var nums = '';
    for (var n = 1; n <= SLOT_COUNT; n++) {
      nums += '<span>' + pad2(n) + '</span>';
    }

    el2d.innerHTML =
      '<div class="lab-fx-workspace lab-fx-workspace--solo">' +
      '<div class="lab-fx-chassis-frame" data-lab-chassis-frame="1">' +
      '<div class="lab-fx-chassis" data-lab-olt="chassis">' +
      '<div class="lab-fx-comb" data-lab-chassis-drag="1" aria-hidden="true"></div>' +
      '<div class="lab-fx-bay">' + slotsHtml + '</div>' +
      '<div class="lab-fx-numbers">' + nums + '</div>' +
      '<div class="lab-fx-power" data-lab-chassis-drag="1">' +
      '<span class="lab-fx-power__model">7360 ISAM FX-16</span>' +
      '<span class="lab-fx-power__spec">40.5V–72V · 70A</span>' +
      '<span class="lab-fx-power__brand">NOKIA</span>' +
      '</div>' +
      '<div class="lab-fx-fan" data-lab-chassis-drag="1"><span>FAN TRAY</span>' +
      '<span class="lab-fx-fan__leds"><i></i><i class="is-on"></i></span></div>' +
      '</div>' +
      /* Invisible edge/corner hit zones — no visual chrome */
      '<span class="lab-fx-edge lab-fx-edge--n" data-lab-resize="n" aria-hidden="true"></span>' +
      '<span class="lab-fx-edge lab-fx-edge--s" data-lab-resize="s" aria-hidden="true"></span>' +
      '<span class="lab-fx-edge lab-fx-edge--e" data-lab-resize="e" aria-hidden="true"></span>' +
      '<span class="lab-fx-edge lab-fx-edge--w" data-lab-resize="w" aria-hidden="true"></span>' +
      '<span class="lab-fx-edge lab-fx-edge--nw" data-lab-resize="nw" aria-hidden="true"></span>' +
      '<span class="lab-fx-edge lab-fx-edge--ne" data-lab-resize="ne" aria-hidden="true"></span>' +
      '<span class="lab-fx-edge lab-fx-edge--sw" data-lab-resize="sw" aria-hidden="true"></span>' +
      '<span class="lab-fx-edge lab-fx-edge--se" data-lab-resize="se" aria-hidden="true"></span>' +
      '</div></div>';

    host.appendChild(el2d);
    justSeated = null;
    applyChassisLayout();
    bind2dEvents();
    bindChassisMove();
    bindResizeHandles();
    syncSelectionUi();
  }

  function bindChassisMove() {
    if (!el2d || !chassisPlaced) return;
    var frame = el2d.querySelector('.lab-fx-chassis-frame');
    if (!frame) return;

    function startMove(e) {
      if (e.button !== 0) return;
      if (e.target.closest('[data-lab-resize]')) return;
      if (e.target.closest('.lab-fx-slot')) return;
      if (e.target.closest('.lab-fx-port')) return;
      if (!e.target.closest('[data-lab-chassis-drag]')) return;

      e.preventDefault();
      e.stopPropagation();
      selectChassis();

      var zoom = (global.FtthLab && FtthLab.getZoom2d) ? FtthLab.getZoom2d() : 1;
      var startX = e.clientX;
      var startY = e.clientY;
      var originX = chassisX;
      var originY = chassisY;
      var moved = false;
      frame.classList.add('is-dragging');

      function onMove(ev) {
        var dx = (ev.clientX - startX) / zoom;
        var dy = (ev.clientY - startY) / zoom;
        if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
        chassisX = originX + dx;
        chassisY = originY + dy;
        applyChassisLayout();
        if (global.FtthLab && typeof FtthLab.notifyLayoutChange === 'function') {
          FtthLab.notifyLayoutChange();
        }
      }

      function onUp() {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        frame.classList.remove('is-dragging');
        if (moved) {
          pushHistory();
          setStatus('Chassis moved on grid');
          if (global.FtthLab && typeof FtthLab.notifyLayoutChange === 'function') {
            FtthLab.notifyLayoutChange();
          }
        }
      }

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    }

    frame.querySelectorAll('[data-lab-chassis-drag]').forEach(function (el) {
      el.addEventListener('pointerdown', startMove);
    });
  }

  function bindResizeHandles() {
    if (!el2d) return;
    var frame = el2d.querySelector('.lab-fx-chassis-frame');
    if (!frame) return;

    frame.querySelectorAll('[data-lab-resize]').forEach(function (handle) {
      handle.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var mode = handle.getAttribute('data-lab-resize');
        var startX = e.clientX;
        var startY = e.clientY;
        var startScale = chassisScale;
        var startLeft = chassisX;
        var startTop = chassisY;
        var startW = CHASSIS_BASE_W * startScale;
        var zoom = (global.FtthLab && FtthLab.getZoom2d) ? FtthLab.getZoom2d() : 1;
        var startH = frame.getBoundingClientRect().height / zoom;
        var moved = false;

        function onMove(ev) {
          var dx = (ev.clientX - startX) / zoom;
          var dy = (ev.clientY - startY) / zoom;
          var delta = 0;
          if (mode === 'e') delta = dx;
          else if (mode === 'w') delta = -dx;
          else if (mode === 's') delta = dy;
          else if (mode === 'n') delta = -dy;
          else if (mode === 'se') delta = Math.max(dx, dy);
          else if (mode === 'ne') delta = Math.max(dx, -dy);
          else if (mode === 'sw') delta = Math.max(-dx, dy);
          else delta = Math.max(-dx, -dy); /* nw */

          var next = clampChassisScale(startScale + delta / CHASSIS_BASE_W);
          if (Math.abs(next - chassisScale) < 0.001) return;
          moved = true;
          var nextW = CHASSIS_BASE_W * next;
          var nextH = startH * (next / startScale);
          chassisScale = next;

          /* Anchor opposite edge/corner */
          if (mode === 'e' || mode === 's' || mode === 'se') {
            /* top-left fixed */
          } else if (mode === 'w' || mode === 'sw') {
            chassisX = startLeft + (startW - nextW);
          } else if (mode === 'n' || mode === 'ne') {
            chassisY = startTop + (startH - nextH);
          } else {
            chassisX = startLeft + (startW - nextW);
            chassisY = startTop + (startH - nextH);
          }

          applyChassisLayout();
          if (group3d) group3d.scale.setScalar(chassisScale);
        }

        function onUp() {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          if (moved) {
            pushHistory();
            setStatus('Chassis size · ' + Math.round(chassisScale * 100) + '%');
          }
        }

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        try { handle.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      });
    });
  }

  function bind2dEvents() {
    if (!el2d) return;

    el2d.querySelector('.lab-fx-power').addEventListener('click', selectChassis);

    el2d.querySelectorAll('.lab-fx-slot').forEach(function (slotEl) {
      var slot = parseInt(slotEl.getAttribute('data-lab-slot'), 10);

      slotEl.addEventListener('click', function (e) {
        if (e.target.closest('.lab-fx-port')) return;
        if (installed[slot]) {
          selectCard(slot);
        } else if (selection.kind === 'lib-card') {
          installCard(selection.cardId, slot);
        } else {
          selectSlot(slot);
        }
      });

      slotEl.addEventListener('dragover', function (e) {
        var active = getLabDrag();
        var isCard = (dragState && dragState.type === 'card') || (active && active.kind === 'card');
        if (isCard && !installed[slot]) {
          e.preventDefault();
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
          slotEl.classList.add('is-drop-target');
        }
      });
      slotEl.addEventListener('dragleave', function () {
        slotEl.classList.remove('is-drop-target');
      });
      slotEl.addEventListener('drop', function (e) {
        e.preventDefault();
        e.stopPropagation();
        slotEl.classList.remove('is-drop-target');
        var active = getLabDrag();
        var kind = (e.dataTransfer && e.dataTransfer.getData('text/lab-drag')) ||
          (active && active.kind) ||
          (dragState && dragState.type);
        if (kind === 'card') {
          var cardId = (e.dataTransfer && e.dataTransfer.getData('text/lab-card-id')) ||
            (active && active.cardId) ||
            (dragState && dragState.cardId);
          if (cardId) installCard(cardId, slot);
        }
        dragState = null;
        endLabDrag();
      });
    });

    el2d.querySelectorAll('.lab-fx-port').forEach(function (btn) {
      var slot = parseInt(btn.getAttribute('data-lab-slot'), 10);
      var port = parseInt(btn.getAttribute('data-lab-sfp'), 10);

      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (e.target.closest('[data-lab-sfp-dust]')) {
          e.preventDefault();
          toggleSfpDustCap(slot, port);
          return;
        }
        if (selection.kind === 'lib-sfp' && !hasSfp(slot, port)) {
          installSfp(selection.sfpId, slot, port);
        } else {
          selectPort(slot, port);
        }
      });

      btn.addEventListener('dragover', function (e) {
        var active = getLabDrag();
        var isSfp = (dragState && dragState.type === 'sfp') || (active && active.kind === 'sfp');
        if (isSfp && !hasSfp(slot, port)) {
          e.preventDefault();
          e.stopPropagation();
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
          btn.classList.add('is-drop-target');
        }
      });
      btn.addEventListener('dragleave', function () {
        btn.classList.remove('is-drop-target');
      });
      btn.addEventListener('drop', function (e) {
        e.preventDefault();
        e.stopPropagation();
        btn.classList.remove('is-drop-target');
        var active = getLabDrag();
        var kind = (e.dataTransfer && e.dataTransfer.getData('text/lab-drag')) ||
          (active && active.kind) ||
          (dragState && dragState.type);
        if (kind === 'sfp') {
          var sfpId = (e.dataTransfer && e.dataTransfer.getData('text/lab-sfp-id')) ||
            (active && active.sfpId) ||
            (dragState && dragState.sfpId);
          if (sfpId) installSfp(sfpId, slot, port);
        }
        dragState = null;
        endLabDrag();
      });
    });
  }

  /* ─── 3D ─── */

  function clear3d() {
    if (group3d && group3d.parent) group3d.parent.remove(group3d);
    pickables = [];
    group3d = null;
  }

  function build3d(root) {
    if (!root || typeof THREE === 'undefined') return;
    clear3d();
    root3d = root;

    /* Blank slate — no 3D chassis until user places it */
    if (!chassisPlaced) return;

    group3d = new THREE.Group();
    group3d.name = 'nokia-fx16';
    group3d.position.set(0, 1.15, 0);
    group3d.scale.setScalar(chassisScale);

    var silver = new THREE.MeshStandardMaterial({
      color: 0xc0c6ce, roughness: 0.45, metalness: 0.55,
    });
    var dark = new THREE.MeshStandardMaterial({
      color: 0x3f4650, roughness: 0.55, metalness: 0.35,
    });

    var body = new THREE.Mesh(new THREE.BoxGeometry(5.2, 2.55, 1.5), silver);
    body.userData = { kind: 'chassis' };
    group3d.add(body);
    pickables.push(body);

    for (var h = 0; h < 18; h++) {
      var hook = new THREE.Mesh(
        new THREE.TorusGeometry(0.07, 0.015, 6, 10, Math.PI),
        silver
      );
      hook.rotation.z = Math.PI;
      hook.position.set(-2.2 + h * 0.26, 1.42, 0.78);
      group3d.add(hook);
    }

    var power = new THREE.Mesh(new THREE.BoxGeometry(5.0, 0.35, 0.08), silver);
    power.position.set(0, -0.95, 0.78);
    power.userData = { kind: 'chassis' };
    group3d.add(power);
    pickables.push(power);

    var fan = new THREE.Mesh(new THREE.BoxGeometry(5.0, 0.28, 0.1), dark);
    fan.position.set(0, -1.25, 0.78);
    group3d.add(fan);

    var slotW = 0.28;
    var gap = 0.03;
    var totalW = SLOT_COUNT * slotW + (SLOT_COUNT - 1) * gap;
    var startX = -totalW / 2 + slotW / 2;

    for (var s = 1; s <= SLOT_COUNT; s++) {
      var x = startX + (s - 1) * (slotW + gap);

      if (installed[s]) {
        var cardMat = new THREE.MeshStandardMaterial({
          color: 0xd6d9de, roughness: 0.5, metalness: 0.35,
          emissive: 0x000000, emissiveIntensity: 0,
        });
        var card = new THREE.Mesh(new THREE.BoxGeometry(slotW * 0.92, 1.7, 0.2), cardMat);
        card.position.set(x, 0.15, 0.88);
        card.userData = { kind: 'card', slot: s, card: 'FGLT-D' };
        group3d.add(card);
        pickables.push(card);

        for (var p = 1; p <= PORT_COUNT; p++) {
          var filled = hasSfp(s, p);
          var portMat = new THREE.MeshStandardMaterial({
            color: filled ? 0x0ea5e9 : 0x111827,
            roughness: 0.4,
            metalness: 0.5,
            emissive: 0x000000,
            emissiveIntensity: 0,
          });
          /* square SFP cage */
          var port = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.08), portMat);
          port.position.set(x, 0.88 - (p - 1) * 0.1, 1.02);
          port.userData = {
            kind: 'port',
            slot: s,
            port: p,
            portId: portId(s, p),
            hasSfp: filled,
            wiringReady: true,
          };
          group3d.add(port);
          pickables.push(port);
        }
      } else {
        var blankMat = new THREE.MeshStandardMaterial({
          color: 0xf1f5f9, roughness: 0.7, metalness: 0.1,
          emissive: 0x000000, emissiveIntensity: 0,
        });
        var blank = new THREE.Mesh(new THREE.BoxGeometry(slotW * 0.92, 1.7, 0.08), blankMat);
        blank.position.set(x, 0.15, 0.82);
        blank.userData = { kind: 'slot', slot: s, empty: true };
        group3d.add(blank);
        pickables.push(blank);

        var hit = new THREE.Mesh(
          new THREE.BoxGeometry(slotW, 1.75, 0.15),
          new THREE.MeshBasicMaterial({ visible: false })
        );
        hit.position.set(x, 0.15, 0.9);
        hit.userData = { kind: 'slot', slot: s, empty: true };
        group3d.add(hit);
        pickables.push(hit);
      }
    }

    root.add(group3d);
  }

  function rebuildViews() {
    var host2d = (ctx && ctx.host2d) || (global.FtthLab && FtthLab.getMount2d && FtthLab.getMount2d());
    var host3d = root3d || (ctx && ctx.host3d) || (global.FtthLab && FtthLab.getRoot3d && FtthLab.getRoot3d());
    if (host2d) build2d(host2d);
    if (host3d) build3d(host3d);
    renderToolbox();
    updateInspector();
  }

  function handlePick(ud) {
    if (!ud || !ud.kind) return;
    if (ud.kind === 'chassis') selectChassis();
    else if (ud.kind === 'slot') {
      if (ud.empty) {
        if (selection.kind === 'lib-card') installCard(selection.cardId, ud.slot);
        else selectSlot(ud.slot);
      } else selectSlot(ud.slot);
    } else if (ud.kind === 'card') selectCard(ud.slot);
    else if (ud.kind === 'port') {
      if (selection.kind === 'lib-sfp' && !hasSfp(ud.slot, ud.port)) {
        installSfp(selection.sfpId, ud.slot, ud.port);
      } else {
        selectPort(ud.slot, ud.port);
      }
    }
  }

  function onStageClick(payload) {
    if (!payload || !payload.userData) return;
    handlePick(payload.userData);
  }

  function onViewChange() {
    syncSelectionUi();
  }

  function mount(api) {
    ctx = api || {};
    root3d = ctx.host3d || null;
    resetAssembly();
    bindStageDrop();
    rebuildViews();
    pushHistory();
    updateUndoRedoUi();
    updateInspector();
    setStatus('Blank workspace · scroll to zoom · تراجع / تقدم خطوة · drag FX-16 to begin');

    if (global.FtthLab) {
      FtthLab.getOltPortWorld = getPortWorld;
      FtthLab.getOltTxSources = function () {
        var out = [];
        var s;
        var p;
        for (s = 1; s <= SLOT_COUNT; s++) {
          if (!installed[s]) continue;
          for (p = 1; p <= PORT_COUNT; p++) {
            if (!hasSfp(s, p)) continue;
            var srcMod = normalizeSfpModule(sfpModule(s, p));
            var srcSpec = getSfpProfile(srcMod.profileId);
            out.push({
              key: 'olt:' + s + ':' + p,
              kind: 'olt',
              txDbm: srcMod.txDbm,
              wavelengthNm: srcSpec.txNm,
              rxNm: srcSpec.rxNm,
              sensitivity: srcSpec.sensitivity,
              profileId: srcSpec.id,
              slot: s,
              port: p,
              label: 'OLT LT' + (s < 10 ? '0' : '') + s + '/P' + p + ' · ' + srcSpec.shortName,
            });
          }
        }
        return out;
      };
    }
  }

  function portElement(slot, port) {
    return document.querySelector(
      '.lab-fx-port[data-lab-slot="' + slot + '"][data-lab-sfp="' + port + '"]'
    );
  }

  /**
   * Dock anchor for jumpers: world centre of the seated SFP's optical bore
   * plus the seat axis, so a connector lands square in the module.
   * Null while the cage is empty — jumpers dock to the module, not the slot.
   */
  function getPortWorld(slot, port) {
    if (!hasSfp(slot, port)) return null;
    var el = portElement(slot, port);
    if (!el) return null;
    var cage = el.querySelector('.lab-fx-port__cage');
    if (!cage) return null;
    var rect = cage.getBoundingClientRect();
    if (!rect.width && !rect.height) return null;
    var cx = rect.left + rect.width / 2;
    var cy = rect.top + rect.height / 2;
    var pt = (global.FtthLab && typeof FtthLab.clientToWorld2d === 'function')
      ? FtthLab.clientToWorld2d(cx, cy)
      : { x: cx, y: cy };
    var rot = Number(el.getAttribute('data-lab-port-rot'));
    var tilt = Number(el.getAttribute('data-lab-port-tilt'));
    return {
      x: pt.x,
      y: pt.y,
      rot: isFinite(rot) ? rot : portConnectorRot(PORT_TILT_DEG),
      tilt: isFinite(tilt) ? tilt : PORT_TILT_DEG,
      el: el,
    };
  }

  function getPortWiring(portOrId) {
    if (typeof portOrId === 'number') {
      var slots = occupiedSlots();
      if (!slots.length) return null;
      return portWiring[portId(slots[0], portOrId)] || null;
    }
    return portWiring[portOrId] || null;
  }

  function getPickables() {
    return pickables.slice();
  }

  function onToolboxClaim(payload) {
    var id = payload && payload.toolId;
    if (id === 'olt-fx16') return;
    armedToolbox = null;
    if (selection.kind === 'lib-chassis' || selection.kind === 'lib-card' ||
        selection.kind === 'lib-sfp') {
      selection = { kind: 'none', slot: null, port: null, cardId: null, sfpId: null };
    }
    renderToolbox();
  }

  function clearSelection() {
    armedToolbox = null;
    selection = { kind: 'none', slot: null, port: null, cardId: null, sfpId: null };
    renderToolbox();
    syncSelectionUi();
  }

  var tool = {
    id: 'olt-fx16',
    mount: mount,
    onViewChange: onViewChange,
    onStageClick: onStageClick,
    undo: undo,
    redo: redo,
    deleteSelected: deleteSelected,
    clearSelection: clearSelection,
    onToolboxClaim: onToolboxClaim,
    getPortWiring: getPortWiring,
    getPortWorld: getPortWorld,
    getPickables: getPickables,
    installCard: installCard,
    ejectCard: ejectCard,
    installSfp: installSfp,
    ejectSfp: ejectSfp,
    toggleSfpDustCap: toggleSfpDustCap,
    syncSfpPatchState: syncSfpPatchState,
    setSfpProfile: setSfpProfile,
    setSfpTxPower: setSfpTxPower,
    getSfpProfiles: function () { return getSfpProfileMap(); },
    selectPort: selectPort,
    selectCard: selectCard,
    onLabConfigChanged: function (payload) {
      if (global.FtthLab && typeof FtthLab.handleToolboxConfigChangeMulti === 'function') {
        FtthLab.handleToolboxConfigChangeMulti(
          ['chassis', 'card', 'sfp'],
          'lab-hw-tree',
          renderToolbox,
          payload && payload.config
        );
      } else {
        renderToolbox();
      }
      updateInspector();
      rebuildViews();
    },
    exportProjectState: captureSnapshot,
    importProjectState: applySnapshot,
    resetProjectState: function () {
      resetAssembly();
      rebuildViews();
      updateInspector();
      renderToolbox();
      var hud = document.getElementById('lab-hud-mode');
      if (hud) hud.textContent = '2D Layout · Empty Workspace';
    },
  };

  function tryRegister() {
    if (global.FtthLab && typeof FtthLab.registerTool === 'function') {
      FtthLab.registerTool('olt-fx16', tool);
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

  global.FtthLabOltFx16 = tool;
})(typeof window !== 'undefined' ? window : this);
