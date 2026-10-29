/**
 * Viavi OLS-35 Optical Laser Source — fixed 5×7 grid footprint (same as OLP-38).
 * Top SC adapter docks Patch Cord / Pigtail (cable exits straight up).
 * Laser ON injects CW / tone power into the optical graph.
 */
(function (global) {
  'use strict';

  var OLS_GRID = 24;
  var OLS_W = 5 * OLS_GRID; /* 120 */
  var OLS_H = 7 * OLS_GRID; /* 168 */
  var OLS_DESIGN_W = 220;
  var OLS_FIT = OLS_W / OLS_DESIGN_W;
  var HISTORY_MAX = 40;

  var WAVELENGTH_ORDER = [1310, 1550];
  var MOD_ORDER = ['CW', '270', '330', '1000', '2000'];
  var DISPLAY_MODE_ORDER = ['single', 'auto', 'multi'];
  var MODE_TX_DBM = {
    single: -3,
    auto: -6,
    multi: -6,
  };
  var TX_PRESETS_DEFAULT = [-3, -6];
  var DEFAULT_TX_DBM = -3;
  var TOOL_CATEGORY = 'TEST EQUIPMENT';

  function getToolMeta() {
    if (global.FtthLab && typeof FtthLab.getToolMeta === 'function') {
      return FtthLab.getToolMeta('ols');
    }
    var settings =
      global.FtthLab && typeof global.FtthLab.getLabSettings === 'function'
        ? global.FtthLab.getLabSettings()
        : global.FtthLabSettings;
    if (settings && typeof settings.getItem === 'function') {
      return settings.getItem('ols');
    }
    return null;
  }

  function getTxPresets() {
    var meta = getToolMeta();
    if (meta && meta.performanceSpecs && meta.performanceSpecs.txLevels && meta.performanceSpecs.txLevels.length) {
      return meta.performanceSpecs.txLevels.slice();
    }
    if (meta && meta.specs && meta.specs.txLevels && meta.specs.txLevels.length) {
      return meta.specs.txLevels.slice();
    }
    return TX_PRESETS_DEFAULT.slice();
  }

  function formatDbmList(levels) {
    if (!levels || !levels.length) return '—';
    return levels.map(function (n) {
      return (n >= 0 ? '+' : '') + n + ' dBm';
    }).join(' · ');
  }

  function formatPowerRange(range) {
    if (!range) return '—';
    var min = range.min;
    var max = range.max;
    if (min == null && max == null) return '—';
    if (min != null && max != null) {
      return (min >= 0 ? '+' : '') + min + ' … ' + (max >= 0 ? '+' : '') + max + ' dBm';
    }
    if (min != null) return (min >= 0 ? '+' : '') + min + ' dBm min';
    return (max >= 0 ? '+' : '') + max + ' dBm max';
  }

  function performanceSpecsMarkup(meta) {
    var ps = meta && meta.performanceSpecs;
    if (!ps) return '';
    var html = '<div class="lab-spl-sheet lab-spl-sheet--perf">';
    if (ps.powerRangeDbm && (ps.powerRangeDbm.min != null || ps.powerRangeDbm.max != null)) {
      html += '<div><span>Power range</span><strong>' + formatPowerRange(ps.powerRangeDbm) + '</strong></div>';
    }
    if (ps.txLevels && ps.txLevels.length) {
      html += '<div><span>TX levels</span><strong>' + formatDbmList(ps.txLevels) + '</strong></div>';
    }
    if (ps.rxLevels && ps.rxLevels.length) {
      html += '<div><span>RX levels</span><strong>' + formatDbmList(ps.rxLevels) + '</strong></div>';
    }
    html += '</div>';
    return html;
  }

  function getDefaultTxDbm() {
    var presets = getTxPresets();
    var meta = getToolMeta();
    if (meta && meta.specs && meta.specs.defaultTxDbm != null) {
      var d = Number(meta.specs.defaultTxDbm);
      if (presets.indexOf(d) >= 0) return d;
    }
    if (presets.indexOf(-3) >= 0) return -3;
    return presets[0];
  }

  var ctx = null;
  var layer = null;
  var devices = [];
  var seq = 0;
  var selection = { kind: 'none', id: null };
  var selectedTool = null;
  var history = [];
  var historyIndex = -1;
  var historyLocked = false;
  var sessionStarted = Date.now();

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
      FtthLab.setSelectionOwner('ols');
    }
  }

  function findDevice(id) {
    for (var i = 0; i < devices.length; i++) {
      if (devices[i].id === id) return devices[i];
    }
    return null;
  }

  function defaultPos() {
    var c = (global.FtthLab && typeof FtthLab.getViewportCenterWorld === 'function')
      ? FtthLab.getViewportCenterWorld()
      : { x: getWorldSize() / 2, y: getWorldSize() / 2 };
    var n = devices.length;
    return {
      x: Math.round(c.x - OLS_W / 2 + (n % 3) * 28),
      y: Math.round(c.y - OLS_H / 2 + Math.floor(n / 3) * 24),
    };
  }

  function normalizeDisplayMode(d) {
    if (!d) return 'single';
    if (d.displayMode === 'auto' || d.displayMode === 'multi' || d.displayMode === 'single') {
      return d.displayMode;
    }
    return d.autoLambda ? 'auto' : 'single';
  }

  function displayModeLabel(mode) {
    if (mode === 'auto') return 'Auto';
    if (mode === 'multi') return 'Multi';
    return 'Single';
  }

  function modeTxDbm(mode) {
    var n = MODE_TX_DBM[mode];
    return n != null ? n : MODE_TX_DBM.single;
  }

  function applyModeTx(d) {
    if (!d) return;
    d.txDbm = modeTxDbm(normalizeDisplayMode(d));
  }

  function txCalDbm() {
    return modeTxDbm('single');
  }

  /** Launch power for the active MODE (Single −3 dBm · Auto/Multi −6 dBm). */
  function configuredDbm(d, wavelengthNm) {
    var preset = Number(d && d.txDbm);
    if (getTxPresets().indexOf(preset) >= 0) return preset;
    return modeTxDbm(normalizeDisplayMode(d));
  }

  function formatCfgDbm(n) {
    return (n >= 0 ? '+' : '') + String(n) + ' dBm';
  }

  function outputDbm(d, wavelengthNm) {
    if (!d || !d.poweredOn || !d.laserOn) return null;
    return configuredDbm(d, wavelengthNm);
  }

  /** Keep OLP-38 / trainer λ on the same calibrated band as this OLS. */
  function syncLinkedOpmWavelength(nm) {
    var wl = Number(nm);
    if (!isFinite(wl)) return;
    if (global.PowerMeterTrainer && typeof PowerMeterTrainer.setWavelength === 'function') {
      PowerMeterTrainer.setWavelength(wl);
      return;
    }
    if (global.FtthLab && typeof FtthLab.setOpmWavelength === 'function') {
      FtthLab.setOpmWavelength(wl);
    }
  }

  function modLabel(mod) {
    if (mod === 'CW') return 'CW';
    return String(mod) + ' Hz';
  }

  function formatClock() {
    var sec = Math.floor((Date.now() - sessionStarted) / 1000);
    var mm = String(Math.floor(sec / 60)).padStart(2, '0');
    var ss = String(sec % 60).padStart(2, '0');
    return mm + ':' + ss;
  }

  function getPortWorld(olsId) {
    var el = document.querySelector('.lab-ols-port[data-ols-port="' + olsId + '"]');
    if (!el) {
      var d = findDevice(olsId);
      if (!d) return null;
      /* Deep seat estimate: into metallic housing below top edge */
      return {
        x: d.x + OLS_W / 2,
        y: d.y + Math.round(14 * OLS_FIT),
        rot: 180,
        magnetPx: 56,
        deepSeat: true,
      };
    }
    /*
     * Deep vertical dock: ferrule tip seats into the metallic SC block
     * (below the open crown slot) so the blue housing sits flush inside.
     */
    var block = el.querySelector('.lab-ols__sc-block');
    var slot = el.querySelector(
      '.lab-ols__adapter-slot, .lab-ols__adapter-knurl, .viavi__adapter-knurl'
    );
    var target = block || slot || el;
    var r = target.getBoundingClientRect();
    var cx = r.left + r.width / 2;
    var cy = block
      ? r.top + Math.max(6, Math.min(12, r.height * 0.3))
      : r.top + Math.max(2, r.height * 0.35);
    var pt = clientToWorld(cx, cy);
    return {
      x: pt.x,
      y: pt.y,
      rot: 180,
      magnetPx: 56,
      deepSeat: true,
    };
  }

  /** Screen-pixel magnetic capture radius for OLS-35 docking. */
  function getMagnetSnapPx() {
    return 56;
  }

  function sideIsOls(side, olsId) {
    if (!side) return false;
    var att = side.attached || side;
    return !!(att && att.owner === 'ols' && att.olsId === olsId);
  }

  function isDockOccupied(olsId) {
    var graph = global.FtthLab && typeof FtthLab.getFiberLaserGraph === 'function'
      ? FtthLab.getFiberLaserGraph()
      : { pcords: [], pigtails: [] };
    var i;
    var pcords = graph.pcords || [];
    for (i = 0; i < pcords.length; i++) {
      var c = pcords[i];
      if (sideIsOls(c.sideA, olsId) || sideIsOls(c.sideB, olsId)) return true;
    }
    var pigtails = graph.pigtails || [];
    for (i = 0; i < pigtails.length; i++) {
      var p = pigtails[i];
      var conn = p.connector && (p.connector.attached || p.connector);
      if (conn && conn.owner === 'ols' && conn.olsId === olsId) return true;
    }
    return false;
  }

  function refreshDockState() {
    devices.forEach(function (d) {
      d.docked = isDockOccupied(d.id);
    });
    rebuildLayer();
    updateInspector();
    if (global.FtthLab && typeof FtthLab.notifyLayoutChange === 'function') {
      FtthLab.notifyLayoutChange({ source: 'ols' });
    }
  }

  function getOlsTxSources() {
    var out = [];
    devices.forEach(function (d) {
      if (!d.poweredOn || !d.laserOn) return;
      var mode = normalizeDisplayMode(d);
      var waves = mode === 'multi' ? WAVELENGTH_ORDER.slice() : [d.wavelength];
      waves.forEach(function (wl) {
        var tx = outputDbm(d, wl);
        if (tx == null) return;
        out.push({
          key: 'ols:' + d.id,
          kind: 'ols',
          txDbm: tx,
          wavelengthNm: wl,
          modulation: mode === 'single' ? d.modulation : 'CW',
          displayMode: mode,
          modeLabel: displayModeLabel(mode),
          label: 'OPL · OLS-35 · ' + displayModeLabel(mode) + ' · ' + wl + ' nm',
          olsId: d.id,
        });
      });
    });
    return out;
  }

  function ensureLayer() {
    if (layer && layer.parentNode) return layer;
    var mount = document.getElementById('lab-2d-mount');
    if (!mount) return null;
    layer = document.createElement('div');
    layer.className = 'lab-ols-layer';
    layer.setAttribute('data-lab-ols-layer', '1');
    mount.appendChild(layer);
    bindKeypadDelegation(layer);
    return layer;
  }

  /** Pixel-style triangular laser hazard mark — sits beside the λ readout. */
  function hazardIconSvg(variant) {
    return (
      '<span class="ols__hazard' + (variant ? ' ols__hazard--' + variant : '') +
      '" role="img" aria-label="Laser radiation active">' +
      '<svg viewBox="0 0 16 14" width="13" height="12" aria-hidden="true">' +
      '<path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="miter" ' +
      'd="M8 1.2L15 13H1L8 1.2z"/>' +
      '<rect x="7.3" y="5" width="1.4" height="4.2" fill="currentColor"/>' +
      '<rect x="7.3" y="10.2" width="1.4" height="1.4" fill="currentColor"/>' +
      '</svg>' +
      '</span>'
    );
  }

  function lcdHeader(modeLabel) {
    return (
      '<div class="viavi__lcd-top ols__lcd-top">' +
      '<span class="viavi__lcd-mode">' + modeLabel + '</span>' +
      '<span class="viavi__lcd-clock" aria-label="Session timer">' +
      '<svg class="viavi__lcd-clock-icon" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">' +
      '<circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.2"/>' +
      '<path d="M8 4.5V8l2.5 1.5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>' +
      '</svg>' +
      '<span class="viavi__lcd-clock-val">' + formatClock() + '</span>' +
      '<span class="ols__batt" title="Battery" aria-hidden="true">' +
      '<span class="ols__batt-body"><span class="ols__batt-fill"></span></span>' +
      '<span class="ols__batt-nip"></span>' +
      '</span>' +
      '</span>' +
      '</div>'
    );
  }

  function screenMarkup(d) {
    if (!d.poweredOn) {
      return '<div class="viavi__lcd ols__lcd ols__lcd--off" aria-live="polite"></div>';
    }
    var mode = normalizeDisplayMode(d);
    var cfg = configuredDbm(d, d.wavelength);
    var pwrTxt = formatCfgDbm(cfg);
    var wlTxt = d.wavelength + ' nm';
    /* Hazard mark rides next to the λ readout while the laser emits */
    var hazard = d.laserOn ? hazardIconSvg() : '';
    var hazardStack = d.laserOn ? hazardIconSvg('stack') : '';
    var inner = '';
    var soft = '';

    if (mode === 'multi') {
      inner =
        '<div class="ols__lcd-stack" aria-label="Multi-λ wavelengths">' +
        '<div class="ols__lcd-row">' +
        '<span class="ols__wl-group"><span class="ols__wl ols__wl--stack">1310 nm</span>' +
        hazardStack + '</span>' +
        '<span class="ols__pwr-txt">' + formatCfgDbm(configuredDbm(d, 1310)) + '</span>' +
        '</div>' +
        '<div class="ols__lcd-row">' +
        '<span class="ols__wl-group"><span class="ols__wl ols__wl--stack">1550 nm</span>' +
        hazardStack + '</span>' +
        '<span class="ols__pwr-txt">' + formatCfgDbm(configuredDbm(d, 1550)) + '</span>' +
        '</div>' +
        '</div>';
      soft =
        '<div class="viavi__lcd-soft ols__lcd-soft ols__lcd-soft--multi">' +
        '<span class="viavi__soft-key is-active">1310 nm</span>' +
        '<span class="viavi__soft-key is-active">1550 nm</span>' +
        '</div>';
    } else if (mode === 'auto') {
      inner =
        '<div class="viavi__lcd-main ols__lcd-main">' +
        '<span class="viavi__lcd-value ols__wl">' + wlTxt + '</span>' + hazard +
        '</div>' +
        '<div class="ols__lcd-meta ols__lcd-meta--auto">' +
        '<span class="ols__pwr-txt">' + pwrTxt + '</span>' +
        '</div>';
      soft =
        '<div class="viavi__lcd-soft ols__lcd-soft ols__lcd-soft--auto">' +
        '<span class="viavi__soft-key is-active">' + wlTxt + '</span>' +
        '<span class="viavi__soft-key ols__soft-empty" aria-hidden="true"></span>' +
        '</div>';
    } else {
      inner =
        '<div class="viavi__lcd-main ols__lcd-main">' +
        '<span class="viavi__lcd-value ols__wl">' + wlTxt + '</span>' + hazard +
        '</div>' +
        '<div class="ols__lcd-meta">' +
        '<span class="ols__mod-txt">' + modLabel(d.modulation) + '</span>' +
        '<span class="ols__pwr-txt">' + pwrTxt + '</span>' +
        '</div>';
      soft =
        '<div class="viavi__lcd-soft ols__lcd-soft ols__lcd-soft--single">' +
        '<span class="viavi__soft-key is-active">' + wlTxt + '</span>' +
        '<span class="viavi__soft-key is-active">' + modLabel(d.modulation) + '</span>' +
        '</div>';
    }

    return (
      '<div class="viavi__lcd ols__lcd ols__lcd--' + mode +
      (d.laserOn ? ' is-emitting' : '') +
      '" data-ols-mode="' + mode + '" aria-live="polite">' +
      lcdHeader(displayModeLabel(mode)) +
      inner +
      soft +
      '</div>'
    );
  }

  function closestEl(start, sel) {
    var t = start;
    if (t && t.nodeType === 3) t = t.parentElement;
    return t && t.closest ? t.closest(sel) : null;
  }

  function isOlsKeyTarget(e) {
    return !!closestEl(e.target, '.lab-ols .viavi__key, .lab-ols .viavi__keys, .lab-ols .ols__pad, .lab-ols .ols__pwr, .lab-ols button');
  }

  function cycleWavelength(d) {
    if (!d.poweredOn) return;
    var ix = WAVELENGTH_ORDER.indexOf(d.wavelength);
    if (ix < 0) ix = 0;
    d.wavelength = WAVELENGTH_ORDER[(ix + 1) % WAVELENGTH_ORDER.length];
    if (normalizeDisplayMode(d) !== 'multi') {
      syncLinkedOpmWavelength(d.wavelength);
    }
    rebuildLayer();
    updateInspector();
    pushHistory();
    notifyOptical();
    setStatus('OLS-35 · λ ' + d.wavelength + ' nm · ' +
      formatCfgDbm(configuredDbm(d, d.wavelength)));
  }

  function cycleModulation(d) {
    if (!d.poweredOn) return;
    var ix = MOD_ORDER.indexOf(d.modulation);
    if (ix < 0) ix = 0;
    d.modulation = MOD_ORDER[(ix + 1) % MOD_ORDER.length];
    rebuildLayer();
    updateInspector();
    pushHistory();
    notifyOptical();
    setStatus('OLS-35 · ' + modLabel(d.modulation) + ' · ' +
      formatCfgDbm(configuredDbm(d, d.wavelength)));
  }

  function toggleLaser(d) {
    if (!d.poweredOn) {
      setStatus('OLS-35 powered off · press green power first');
      return;
    }
    d.laserOn = !d.laserOn;
    rebuildLayer();
    updateInspector();
    pushHistory();
    notifyOptical();
    setStatus(d.laserOn
      ? 'OLS-35 laser ON · ' + d.wavelength + ' nm · ' +
        formatCfgDbm(outputDbm(d, d.wavelength))
      : 'OLS-35 laser OFF');
  }

  function cycleDisplayMode(d) {
    if (!d.poweredOn) return;
    var cur = normalizeDisplayMode(d);
    var ix = DISPLAY_MODE_ORDER.indexOf(cur);
    if (ix < 0) ix = 0;
    d.displayMode = DISPLAY_MODE_ORDER[(ix + 1) % DISPLAY_MODE_ORDER.length];
    d.autoLambda = d.displayMode === 'auto';
    if (d.displayMode === 'single' && (cur === 'auto' || cur === 'multi')) {
      d.modulation = 'CW';
    }
    applyModeTx(d);
    rebuildLayer();
    updateInspector();
    pushHistory();
    notifyOptical();
    setStatus('OLS-35 · ' + displayModeLabel(d.displayMode) + ' · ' +
      formatCfgDbm(configuredDbm(d, d.wavelength)));
  }

  function togglePower(d) {
    d.poweredOn = !d.poweredOn;
    if (!d.poweredOn) d.laserOn = false;
    rebuildLayer();
    updateInspector();
    pushHistory();
    notifyOptical();
    setStatus(d.poweredOn ? 'OLS-35 powered on' : 'OLS-35 powered off');
  }

  function notifyOptical() {
    if (global.FtthLab && typeof FtthLab.refreshOpmDocks === 'function') {
      FtthLab.refreshOpmDocks();
    }
    if (global.FtthLab && typeof FtthLab.notifyLayoutChange === 'function') {
      FtthLab.notifyLayoutChange({ source: 'ols' });
    }
    if (global.FtthLab && typeof FtthLab.refreshPowerBudget === 'function') {
      FtthLab.refreshPowerBudget();
    }
  }

  function setTxDbm(id, dbm) {
    var d = findDevice(id);
    if (!d) return;
    var n = Number(dbm);
    if (getTxPresets().indexOf(n) < 0) return;
    if (d.txDbm === n) return;
    d.txDbm = n;
    rebuildLayer();
    updateInspector();
    pushHistory();
    notifyOptical();
    setStatus('OPL TX · ' + formatCfgDbm(n));
  }

  function handleOlsKey(btn) {
    if (!btn) return;
    var node = btn.closest('[data-ols-node]');
    var id = node && node.getAttribute('data-ols-node');
    var d = findDevice(id);
    if (!d) return;
    selectOls(id, { skipRebuild: true });
    if (btn.hasAttribute('data-ols-power')) {
      togglePower(d);
      return;
    }
    if (btn.hasAttribute('data-ols-wave-cycle')) {
      cycleWavelength(d);
      return;
    }
    if (btn.hasAttribute('data-ols-hz')) {
      cycleModulation(d);
      return;
    }
    if (btn.hasAttribute('data-ols-laser')) {
      toggleLaser(d);
      return;
    }
    if (btn.hasAttribute('data-ols-mode')) {
      cycleDisplayMode(d);
    }
  }

  function bindKeypadDelegation(host) {
    if (!host || host.dataset.olsKeypadBound === '1') return;
    host.dataset.olsKeypadBound = '1';

    host.addEventListener('pointerdown', function (e) {
      if (!isOlsKeyTarget(e)) return;
      e.stopPropagation();
    }, true);

    host.addEventListener('pointerup', function (e) {
      if (!isOlsKeyTarget(e)) return;
      e.stopPropagation();
    }, true);

    host.addEventListener('click', function (e) {
      var btn = closestEl(
        e.target,
        '[data-ols-wave-cycle], [data-ols-hz], [data-ols-mode], [data-ols-laser], [data-ols-power]'
      );
      if (!btn || !btn.closest('.lab-ols')) return;
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      handleOlsKey(btn);
    }, true);
  }

  function gearIconSvg() {
    return (
      '<svg class="ols__btn-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
      '<path fill="currentColor" d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.03 7.03 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.59.24-1.13.55-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.83 14.52a.5.5 0 0 0-.12.64l1.92 3.32c.14.24.43.34.68.22l2.39-.96c.5.39 1.04.7 1.63.94l.36 2.54c.05.24.26.42.5.42h3.84c.24 0 .45-.18.5-.42l.36-2.54c.59-.24 1.13-.55 1.63-.94l2.39.96c.25.1.54 0 .68-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z"/>' +
      '</svg>'
    );
  }

  function laserIconSvg() {
    /* Laser radiation burst + beam (matches OLS-35 ON/OFF legend) */
    return (
      '<svg class="ols__btn-icon ols__laser-icon" viewBox="0 0 24 24" width="16" height="14" aria-hidden="true">' +
      '<circle cx="8" cy="12" r="2.2" fill="currentColor"/>' +
      '<path fill="currentColor" d="M8 4.5l.7 2.4L11 8l-2.3 1.1L8 11.5l-.7-2.4L5 8l2.3-1.1L8 4.5zm0 9l.7 2.4L11 17l-2.3 1.1L8 20.5l-.7-2.4L5 17l2.3-1.1L8 13.5z"/>' +
      '<path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M11.5 12H21"/>' +
      '<path fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" d="M14 9.5l5.5 0M14 14.5l5.5 0"/>' +
      '</svg>'
    );
  }

  function powerIconSvg() {
    return (
      '<svg class="ols__pwr-icon" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">' +
      '<path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" ' +
      'd="M12 3.5v8M7.2 6.2a7 7 0 1 0 9.6 0"/>' +
      '</svg>'
    );
  }

  function keypadMarkup(d) {
    var laserOn = d.laserOn ? ' is-on' : '';
    var powered = d.poweredOn ? ' is-powered' : '';
    return (
      '<div class="ols__pad">' +
      '<div class="ols__ridges" aria-hidden="true">' +
      '<span></span><span></span><span></span>' +
      '</div>' +
      '<div class="viavi__keys ols__keys" role="group" aria-label="OLS-35 keypad">' +
      '<button type="button" class="viavi__key ols__key ols__key--soft ols__key--lambda" ' +
      'data-ols-wave-cycle title="Wavelength" aria-label="Cycle wavelength">λ</button>' +
      '<button type="button" class="viavi__key ols__key ols__key--soft ols__key--neutral" ' +
      'disabled aria-label="Unused softkey" tabindex="-1"></button>' +
      '<button type="button" class="viavi__key ols__key ols__key--soft ols__key--hz" ' +
      'data-ols-hz title="Modulation / Hz" aria-label="Cycle modulation frequency">HZ</button>' +
      '<button type="button" class="viavi__key ols__key ols__key--large ols__key--mode" ' +
      'data-ols-mode title="MODE — Single (−3 dBm) → Auto (−6 dBm) → Multi (−6 dBm)" aria-label="Cycle mode and TX power">' +
      '<span class="ols__key-stack">' + gearIconSvg() + '<span class="ols__key-label">MODE</span></span>' +
      '</button>' +
      '<button type="button" class="viavi__key ols__key ols__key--large ols__key--laser' + laserOn + '" ' +
      'data-ols-laser title="Laser ON/OFF" aria-label="Laser on or off" aria-pressed="' +
      (d.laserOn ? 'true' : 'false') + '">' +
      '<span class="ols__key-stack">' + laserIconSvg() + '<span class="ols__key-label">ON/OFF</span></span>' +
      '</button>' +
      '</div>' +
      '<button type="button" class="ols__pwr' + powered + '" data-ols-power ' +
      'title="Power" aria-label="Device power" aria-pressed="' +
      (d.poweredOn ? 'true' : 'false') + '">' + powerIconSvg() + '</button>' +
      '</div>'
    );
  }

  function rebuildLayer() {
    var host = ensureLayer();
    if (!host) return;

    var html = '';
    devices.forEach(function (d) {
      var sel = selection.kind === 'ols' && selection.id === d.id ? ' is-selected' : '';
      var laser = d.laserOn ? ' is-laser-on' : '';
      var powered = d.poweredOn ? ' is-powered' : ' is-powered-off';
      var docked = d.docked ? ' is-docked' : '';
      var portCls = 'viavi__port lab-ols-port lab-ols-port--metal' +
        (d.docked ? ' is-occupied' : '') +
        (d.laserOn ? ' is-emitting' : '');
      html +=
        '<div class="lab-ols lab-ols--viavi lab-ols--fixed' + sel + laser + powered + docked +
        '" data-ols-node="' + d.id + '" style="left:' + d.x + 'px;top:' + d.y + 'px">' +
        '<div class="viavi ols-viavi" data-laser="' + (d.laserOn ? '1' : '0') +
        '" data-powered="' + (d.poweredOn ? '1' : '0') +
        '" data-docked="' + (d.docked ? '1' : '0') + '">' +
        '<div class="viavi__bumper viavi__bumper--tl" aria-hidden="true"></div>' +
        '<div class="viavi__bumper viavi__bumper--tr" aria-hidden="true"></div>' +
        '<div class="viavi__bumper viavi__bumper--bl" aria-hidden="true"></div>' +
        '<div class="viavi__bumper viavi__bumper--br" aria-hidden="true"></div>' +
        '<div class="viavi__face" data-ols-drag="' + d.id + '">' +
        '<div class="' + portCls +
        '" data-ols-port="' + d.id + '" data-ols-connector="SC" title="SC metallic adapter · dock patch/pigtail vertically into top slot">' +
        '<span class="lab-ols__well" aria-hidden="true"></span>' +
        '<span class="lab-ols__sc" aria-hidden="true">' +
        '<span class="lab-ols__sc-block">' +
        '<span class="lab-ols__sc-crown">' +
        '<span class="lab-ols__adapter-slot lab-ols__adapter-knurl" data-ols-dock-slot="1"></span>' +
        '</span>' +
        '<span class="lab-ols__sc-face"></span>' +
        '<span class="lab-ols__sc-side"></span>' +
        '<span class="lab-ols__sc-notch"></span>' +
        '</span>' +
        '<span class="lab-ols__sc-flange">' +
        '<span class="lab-ols__sc-step"></span>' +
        '<span class="lab-ols__sc-plate">' +
        '<i class="lab-ols__sc-screw lab-ols__sc-screw--l"></i>' +
        '<i class="lab-ols__sc-screw lab-ols__sc-screw--r"></i>' +
        '</span>' +
        '</span>' +
        '</span>' +
        '</div>' +
        '<div class="viavi__badge">VIAVI</div>' +
        screenMarkup(d) +
        keypadMarkup(d) +
        '<div class="viavi__model">OLS-35</div>' +
        '</div></div></div>';
    });
    host.innerHTML = html;
    bindLayerEvents(host);
  }

  function bindLayerEvents(host) {
    host.querySelectorAll('[data-ols-drag]').forEach(function (grip) {
      grip.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        if (isOlsKeyTarget(e)) return;
        if (closestEl(e.target, '.lab-ols-port, .viavi__lcd')) return;
        e.preventDefault();
        e.stopPropagation();
        var id = grip.getAttribute('data-ols-drag');
        var d = findDevice(id);
        if (!d) return;
        selectOls(id, { skipRebuild: true });
        var zoom = getZoom() || 1;
        var sx = e.clientX;
        var sy = e.clientY;
        var ox = d.x;
        var oy = d.y;
        var node = host.querySelector('[data-ols-node="' + id + '"]');
        if (node) node.classList.add('is-dragging', 'is-selected');

        function onMove(ev) {
          d.x = Math.round(ox + (ev.clientX - sx) / zoom);
          d.y = Math.round(oy + (ev.clientY - sy) / zoom);
          if (node) {
            node.style.left = d.x + 'px';
            node.style.top = d.y + 'px';
          }
          if (global.FtthLab && typeof FtthLab.notifyLayoutChange === 'function') {
            FtthLab.notifyLayoutChange({ source: 'ols', live: true, olsId: id });
          }
        }
        function onUp() {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          if (node) node.classList.remove('is-dragging');
          rebuildLayer();
          pushHistory();
          if (global.FtthLab && typeof FtthLab.notifyLayoutChange === 'function') {
            FtthLab.notifyLayoutChange({ source: 'ols', olsId: id });
          }
        }
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });
    });
  }

  function placeOls(x, y) {
    seq += 1;
    var pos = (typeof x === 'number' && typeof y === 'number')
      ? { x: x, y: y }
      : defaultPos();
    var d = {
      id: 'ols-' + seq,
      x: pos.x,
      y: pos.y,
      wavelength: 1310,
      modulation: 'CW',
      laserOn: false,
      poweredOn: true,
      displayMode: 'single',
      autoLambda: false,
      docked: false,
      txDbm: getDefaultTxDbm(),
    };
    devices.push(d);
    syncLinkedOpmWavelength(d.wavelength);
    selectOls(d.id);
    rebuildLayer();
    pushHistory();
    setStatus('OLS-35 placed · Single · TX ' + formatCfgDbm(getDefaultTxDbm()) + ' · dock SC fiber · laser ON');
    return d;
  }

  function selectOls(id, opts) {
    opts = opts || {};
    selection = { kind: 'ols', id: id };
    claimSelection();
    renderToolbox();
    if (opts.skipRebuild) {
      if (layer) {
        layer.querySelectorAll('[data-ols-node]').forEach(function (n) {
          n.classList.toggle('is-selected', n.getAttribute('data-ols-node') === id);
        });
      }
    } else {
      rebuildLayer();
    }
    updateInspector();
  }

  function removeOls(id) {
    devices = devices.filter(function (d) { return d.id !== id; });
    if (selection.id === id) selection = { kind: 'none', id: null };
    rebuildLayer();
    updateInspector();
    pushHistory();
    notifyOptical();
  }

  function renderToolbox() {
    var host = global.FtthLab && typeof FtthLab.gateToolboxRender === 'function'
      ? FtthLab.gateToolboxRender('lab-ols-tree', 'ols')
      : document.getElementById('lab-ols-tree');
    if (!host) return;
    var meta = getToolMeta() || {};
    var title = meta.label || 'OLS-35';
    var sub = meta.sublabel || 'Calibrated source · 1310 / 1550';
    host.innerHTML =
      '<div class="lab-toolbox" role="list">' +
      '<button type="button" class="lab-tool lab-tool--ols' +
      (selectedTool === 'ols' ? ' is-selected' : '') +
      '" draggable="true" data-lab-tool="ols" data-lab-category="' + TOOL_CATEGORY + '" role="listitem">' +
      '<span class="lab-tool__mark lab-tool__mark--ols" aria-hidden="true"></span>' +
      '<span class="lab-tool__copy">' +
      '<strong>' + title + '</strong>' +
      '<span>' + sub + '</span>' +
      '</span>' +
      '</button>' +
      '</div>';
    bindToolbox(host);
    if (global.FtthLab && typeof FtthLab.applyFtthLabToolboxIcons === 'function') {
      FtthLab.applyFtthLabToolboxIcons();
    }
  }

  function bindToolbox(host) {
    var btn = host.querySelector('[data-lab-tool="ols"]');
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (global.FtthLab && typeof FtthLab.armDragOnlyToolboxTool === 'function') {
        FtthLab.armDragOnlyToolboxTool('ols', 'OLS-35 · drag onto workspace to place');
      } else if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
        FtthLab.claimToolboxTool('ols');
      }
      selectedTool = 'ols';
      renderToolbox();
    });
    btn.addEventListener('dragstart', function (e) {
      if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
        FtthLab.claimToolboxTool('ols');
      }
      selectedTool = 'ols';
      if (global.FtthLab && FtthLab.beginDrag) {
        FtthLab.beginDrag({ kind: 'ols' });
      }
      try {
        e.dataTransfer.setData('text/plain', 'lab:ols');
        e.dataTransfer.setData('text/lab-drag', 'ols');
        e.dataTransfer.effectAllowed = 'copy';
      } catch (err) { /* ignore */ }
      btn.classList.add('is-dragging', 'is-selected');
    });
    btn.addEventListener('dragend', function () {
      btn.classList.remove('is-dragging');
      if (global.FtthLab && FtthLab.endDrag) FtthLab.endDrag();
    });
  }

  function bindStageDrop() {
    var stage = document.getElementById('lab-canvas-2d');
    if (!stage || stage.dataset.olsDropBound === '1') return;
    stage.dataset.olsDropBound = '1';
    stage.addEventListener('drop', function (e) {
      var drag = global.FtthLab && FtthLab.getActiveDrag && FtthLab.getActiveDrag();
      if (!drag || drag.kind !== 'ols') return;
      e.preventDefault();
      var pt = clientToWorld(e.clientX, e.clientY);
      placeOls(Math.round(pt.x - OLS_W / 2), Math.round(pt.y - 24));
      if (global.FtthLab && FtthLab.endDrag) FtthLab.endDrag();
      selectedTool = 'ols';
      renderToolbox();
    });
  }

  function updateInspector() {
    var card = document.getElementById('lab-inspector-card');
    var detail = document.getElementById('lab-inspector-detail');
    if (!card || !detail) return;
    if (selection.kind !== 'ols' || !selection.id) {
      if (card.dataset.olsInspector === '1') {
        card.dataset.olsInspector = '';
        if (global.FtthLab && typeof FtthLab.resetInspectorIdle === 'function') {
          FtthLab.resetInspectorIdle();
        }
      }
      return;
    }
    var d = findDevice(selection.id);
    if (!d) return;
    card.dataset.olsInspector = '1';
    card.hidden = true;
    detail.hidden = false;
    var cfg = configuredDbm(d);
    var pwr = outputDbm(d);
    var mode = normalizeDisplayMode(d);
    var meta = getToolMeta() || {};
    var title = meta.label || 'OLS-35';
    var guide = meta.guideText || 'Calibrated optical source · 1310 / 1550 nm · dock a patch cord, then enable laser.';
    var txBtns = getTxPresets().map(function (n) {
      var lab = (n >= 0 ? '+' : '') + n + ' dBm';
      return (
        '<button type="button" class="lab-polish-btn' +
        (cfg === n ? ' is-active' : '') +
        '" data-ols-tx="' + n + '">' + lab + '</button>'
      );
    }).join('');
    detail.innerHTML =
      '<div class="lab-inspector__card">' +
      '<h2>' + title + '</h2>' +
      '<p>' + guide + '</p>' +
      '<p class="lab-inspector__label">TX level</p>' +
      '<div class="lab-polish-toggle" role="group" aria-label="Calibrated TX">' +
      txBtns +
      '</div>' +
      performanceSpecsMarkup(meta) +
      '<div class="lab-spl-sheet">' +
      '<div><span>Power</span><strong>' + (d.poweredOn ? 'ON' : 'OFF') + '</strong></div>' +
      '<div><span>Laser</span><strong>' + (d.laserOn ? 'ON' : 'OFF') + '</strong></div>' +
      '<div><span>Display</span><strong>' + displayModeLabel(mode) + '</strong></div>' +
      '<div><span>λ</span><strong>' +
      (mode === 'multi' ? '1310 / 1550 nm' : d.wavelength + ' nm') + '</strong></div>' +
      '<div><span>Hz</span><strong>' +
      (mode === 'single' ? modLabel(d.modulation) : '—') + '</strong></div>' +
      '<div><span>Output</span><strong>' +
      (pwr != null ? pwr.toFixed(2) + ' dBm' : formatCfgDbm(cfg) + ' (armed)') + '</strong></div>' +
      '<div><span>Dock</span><strong>' + (d.docked ? 'Occupied' : 'Open') + '</strong></div>' +
      '</div>' +
      '<button type="button" class="lab-eject-btn" data-remove-ols="' + d.id + '">Remove OLS-35</button>' +
      '</div>';
    detail.querySelectorAll('[data-ols-tx]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setTxDbm(d.id, btn.getAttribute('data-ols-tx'));
      });
    });
    var rm = detail.querySelector('[data-remove-ols]');
    if (rm) {
      rm.addEventListener('click', function () {
        removeOls(d.id);
        if (global.FtthLab && typeof FtthLab.resetInspectorIdle === 'function') {
          FtthLab.resetInspectorIdle();
        }
      });
    }
  }

  function pushHistory() {
    if (historyLocked) return;
    history = history.slice(0, historyIndex + 1);
    history.push(JSON.parse(JSON.stringify({
      devices: devices,
      seq: seq,
      selection: selection,
    })));
    if (history.length > HISTORY_MAX) history.shift();
    historyIndex = history.length - 1;
    if (global.FtthLab && FtthLab.recordHistory) FtthLab.recordHistory();
  }

  function exportProjectState() {
    return JSON.parse(JSON.stringify({ devices: devices, seq: seq }));
  }

  function importProjectState(snap) {
    devices = (snap && snap.devices) ? JSON.parse(JSON.stringify(snap.devices)) : [];
    seq = (snap && snap.seq) || 0;
    selection = { kind: 'none', id: null };
    rebuildLayer();
    updateInspector();
    notifyOptical();
  }

  function onLayoutChange(payload) {
    if (payload && payload.source === 'ols' && payload.live) return;
    devices.forEach(function (d) {
      d.docked = isDockOccupied(d.id);
    });
    rebuildLayer();
  }

  function onLaunchRequest(payload) {
    if (!payload || payload.tool !== 'ols') return;
    selectedTool = 'ols';
    renderToolbox();
    if (global.FtthLab && typeof FtthLab.armDragOnlyToolboxTool === 'function') {
      FtthLab.armDragOnlyToolboxTool('ols', 'OLS-35 · drag onto workspace to place');
    } else if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
      FtthLab.claimToolboxTool('ols');
    }
  }

  function deleteSelected() {
    if (selection.kind === 'ols' && selection.id) {
      removeOls(selection.id);
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
    if (id === 'ols') return;
    if (selectedTool) {
      selectedTool = null;
      renderToolbox();
    }
  }

  function mount(api) {
    ctx = api || {};
    devices = [];
    seq = 0;
    selection = { kind: 'none', id: null };
    selectedTool = null;
    history = [];
    historyIndex = -1;
    renderToolbox();
    bindStageDrop();
    ensureLayer();
    rebuildLayer();

    if (global.FtthLab) {
      FtthLab.getOlsPortWorld = getPortWorld;
      FtthLab.getOlsMagnetSnapPx = getMagnetSnapPx;
      FtthLab.getOlsTxSources = getOlsTxSources;
      FtthLab.getOplTxCalDbm = txCalDbm;
      FtthLab.refreshOlsDocks = refreshDockState;
      FtthLab.getOlsDevices = function () {
        return devices.map(function (d) {
          return {
            id: d.id,
            x: d.x,
            y: d.y,
            wavelength: d.wavelength,
            modulation: d.modulation,
            displayMode: normalizeDisplayMode(d),
            laserOn: !!d.laserOn,
            poweredOn: d.poweredOn !== false,
            docked: !!d.docked,
            txDbm: outputDbm(d, d.wavelength),
          };
        });
      };
      if (FtthLab._launchTool === 'ols') {
        onLaunchRequest({ tool: 'ols' });
      }
    }

    setInterval(function () {
      if (!layer) return;
      var t = formatClock();
      layer.querySelectorAll('.viavi__lcd-clock-val').forEach(function (el) {
        el.textContent = t;
      });
    }, 1000);
  }

  var tool = {
    id: 'ols',
    category: TOOL_CATEGORY,
    mount: mount,
    onLayoutChange: onLayoutChange,
    onLaunchRequest: onLaunchRequest,
    undo: function () {},
    redo: function () {},
    deleteSelected: deleteSelected,
    clearSelection: clearSelection,
    onToolboxClaim: onToolboxClaim,
    placeOls: placeOls,
    onLabConfigChanged: function (payload) {
      if (global.FtthLab && typeof FtthLab.handleToolboxConfigChange === 'function') {
        FtthLab.handleToolboxConfigChange('ols', 'lab-ols-tree', renderToolbox, payload && payload.config);
      } else {
        renderToolbox();
      }
      updateInspector();
    },
    exportProjectState: exportProjectState,
    importProjectState: importProjectState,
    resetProjectState: function () {
      importProjectState({ devices: [], seq: 0 });
    },
  };

  function tryRegister() {
    if (global.FtthLab && typeof FtthLab.registerTool === 'function') {
      FtthLab.registerTool('ols', tool);
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
