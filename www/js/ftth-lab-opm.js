/**
 * Viavi OLP-38 Optical Power Meter — dockable SC adapter on FTTH lab canvas.
 * Live dBm only when an SC Patch Cord / Pigtail is snapped into the metal port.
 */
(function (global) {
  'use strict';

  var TOOL_CATEGORY = 'TEST EQUIPMENT';

  /** Lab grid cell = 24px → master OLP-38 footprint = 5×7 cells (locked). */
  var OPM_GRID = 24;
  var OPM_W = 5 * OPM_GRID; /* 120 */
  var OPM_H = 7 * OPM_GRID; /* 168 */
  var OPM_DESIGN_W = 220;
  var OPM_FIT = OPM_W / OPM_DESIGN_W;
  var HISTORY_MAX = 40;
  var DOCK_LOSS_DB = 0.15;

  var ctx = null;
  var layer = null;
  var devices = [];
  var seq = 0;
  var selection = { kind: 'none', id: null };
  var selectedTool = null;
  var history = [];
  var historyIndex = -1;
  var historyLocked = false;
  var wavelengthNm = 1310;
  var unitMode = 'dbm'; /* dbm | mw */

  var WAVELENGTH_ORDER = [850, 980, 1310, 1490, 1550, 1625];
  var WAVELENGTH_HINT = {
    850: 'Legacy MM / VCSEL test band',
    980: 'EDFA pump · specialty sensing',
    1310: 'Upstream · ONU → OLT (GPON/EPON TX)',
    1490: 'Downstream · OLT → ONU (GPON primary)',
    1550: 'Long-haul SM · RF overlay / CATV',
    1625: 'Maintenance / OTDR band',
  };

  function resolveWavelengthNm() {
    if (global.PowerMeterTrainer && typeof PowerMeterTrainer.getWavelength === 'function') {
      var ext = Number(PowerMeterTrainer.getWavelength());
      if (isFinite(ext) && WAVELENGTH_ORDER.indexOf(ext) >= 0) {
        wavelengthNm = ext;
        return ext;
      }
    }
    if (global.FtthLab && typeof FtthLab.getOpmWavelength === 'function') {
      var wl = Number(FtthLab.getOpmWavelength());
      if (isFinite(wl) && WAVELENGTH_ORDER.indexOf(wl) >= 0) {
        wavelengthNm = wl;
        return wl;
      }
    }
    return wavelengthNm;
  }

  function resolveUnitMode() {
    if (global.PowerMeterTrainer && typeof PowerMeterTrainer.getUnit === 'function') {
      var u = PowerMeterTrainer.getUnit();
      if (u === 'mw' || u === 'dbm') {
        unitMode = u;
        return u;
      }
    }
    return unitMode;
  }

  function wavelengthHint(nm) {
    if (global.PowerMeterTrainer && typeof PowerMeterTrainer.getWavelengthHint === 'function') {
      return PowerMeterTrainer.getWavelengthHint(nm) || WAVELENGTH_HINT[nm] || '';
    }
    return WAVELENGTH_HINT[nm] || '';
  }

  function cycleLocalWavelength() {
    if (global.PowerMeterTrainer && typeof PowerMeterTrainer.cycleWavelength === 'function') {
      PowerMeterTrainer.cycleWavelength();
      return;
    }
    var ix = WAVELENGTH_ORDER.indexOf(resolveWavelengthNm());
    if (ix < 0) ix = WAVELENGTH_ORDER.indexOf(1310);
    wavelengthNm = WAVELENGTH_ORDER[(ix + 1) % WAVELENGTH_ORDER.length];
    if (global.FtthLab && typeof FtthLab.setOpmWavelength === 'function') {
      FtthLab.setOpmWavelength(wavelengthNm);
    } else {
      refreshDockReadings();
    }
    rebuildLayer();
  }

  function toggleLocalUnit() {
    if (global.PowerMeterTrainer && typeof PowerMeterTrainer.toggleUnit === 'function') {
      PowerMeterTrainer.toggleUnit();
      return;
    }
    unitMode = resolveUnitMode() === 'mw' ? 'dbm' : 'mw';
    rebuildLayer();
    lastBroadcast();
  }

  function toggleLocalStandard() {
    if (global.PowerMeterTrainer && typeof PowerMeterTrainer.toggleStandard === 'function') {
      PowerMeterTrainer.toggleStandard();
    }
  }

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
      FtthLab.setSelectionOwner('opm');
    }
  }

  function findDevice(id) {
    for (var i = 0; i < devices.length; i++) {
      if (devices[i].id === id) return devices[i];
    }
    return null;
  }

  function defaultPos() {
    var w = getWorldSize();
    return {
      x: Math.round(w / 2 + 80 + devices.length * 40),
      y: Math.round(w / 2 - 40),
    };
  }

  function formatDbm(dBm) {
    if (dBm == null || !isFinite(dBm)) return null;
    return (dBm >= 0 ? '+' : '') + dBm.toFixed(2);
  }

  function formatMw(dBm) {
    if (dBm == null || !isFinite(dBm)) return null;
    var mw = global.FtthLab && typeof FtthLab.dbmToMilliwatts === 'function'
      ? FtthLab.dbmToMilliwatts(dBm)
      : Math.pow(10, dBm / 10);
    if (mw == null || !isFinite(mw)) return null;
    if (global.FtthLab && typeof FtthLab.formatMilliwatts === 'function') {
      return FtthLab.formatMilliwatts(mw);
    }
    if (mw >= 1) return mw.toFixed(3) + ' mW';
    if (mw >= 0.001) return mw.toFixed(4) + ' mW';
    return mw.toExponential(2) + ' mW';
  }

  function getPortWorld(opmId) {
    var el = document.querySelector('.lab-opm-port[data-opm-port="' + opmId + '"]');
    if (!el) {
      var d = findDevice(opmId);
      if (!d) return null;
      /* rot 180°: ferrule down into top SC adapter, yellow cable exits upward */
      return { x: d.x + OPM_W / 2, y: d.y + Math.round(12 * OPM_FIT), rot: 180 };
    }
    var bore = el.querySelector('.viavi__adapter-knurl, .lab-opm__adapter-knurl') || el;
    var r = bore.getBoundingClientRect();
    var pt = clientToWorld(r.left + r.width / 2, r.top + r.height * 0.35);
    return { x: pt.x, y: pt.y, rot: 180 };
  }

  function measureAtDock(opmId) {
    if (!global.FtthLab || typeof FtthLab.measureOpticalAtKey !== 'function') {
      return null;
    }
    var key = 'opm:' + opmId;
    var reading = FtthLab.measureOpticalAtKey(key);
    if (reading) {
      reading.docked = true;
      reading.opmId = opmId;
      reading.label = reading.label || 'Viavi OLP-38 dock';
    }
    return reading;
  }

  /** All reachable TX readings at this dock (one per source wavelength). */
  function sourcesAtDock(opmId) {
    if (!global.FtthLab || typeof FtthLab.measureOpticalSourcesAtKey !== 'function') {
      return [];
    }
    return FtthLab.measureOpticalSourcesAtKey('opm:' + opmId) || [];
  }

  /**
   * OLP-38 mirrors the driving OLS-35 display mode (single / auto / multi).
   * Returns null when the strongest source is not an OLS-35.
   */
  function olsMirrorState(d) {
    var r = d && d.lastReading;
    var src = r && r.source;
    if (!src || src.kind !== 'ols') return null;
    var mode = src.displayMode || 'single';
    var rows = [];
    if (mode === 'multi') {
      var seen = {};
      (d.lastSources || []).forEach(function (item) {
        if (!item.source || item.source.kind !== 'ols') return;
        if (item.source.olsId !== src.olsId) return;
        var wl = item.wavelengthNm;
        if (wl == null || seen[wl]) return;
        seen[wl] = true;
        rows.push({
          wavelengthNm: wl,
          /* Use received path power, not raw OLS TX power. */
          dBm: item.dBm,
          lossDb: item.lossDb,
        });
      });
      rows.sort(function (a, b) { return a.wavelengthNm - b.wavelengthNm; });
    }
    var lightNm = src.wavelengthNm || resolveWavelengthNm();
    /* r.dBm already includes patch, fiber, splitter, and connector losses. */
    var trueDbm = r.dBm;
    var calNm = resolveWavelengthNm();
    /* Single-λ reads through the operator-selected table; Auto/Multi self-tune */
    var calError = mode === 'single' ? calibrationErrorDb(lightNm, calNm) : 0;
    return {
      mode: mode,
      modeLabel: src.modeLabel || 'Single-λ',
      modulation: src.modulation || 'CW',
      wavelengthNm: lightNm,
      calibrationNm: calNm,
      trueDbm: trueDbm,
      txDbm: src.txDbm,
      pathLossDb: r.lossDb,
      outputDbm: mode === 'single' ? calibratedDbm(trueDbm, lightNm) : trueDbm,
      calErrorDb: Math.round(calError * 100) / 100,
      calMismatch: mode === 'single' && Math.abs(calError) >= 0.01,
      photocurrentA: photocurrentA(trueDbm, lightNm),
      rows: rows,
    };
  }

  /* ── Photodiode calibration (I = R(λ)·P, shown P = I / R(λ_set)) ── */

  function responsivityAt(nm) {
    if (global.FtthLab && typeof FtthLab.photodiodeResponsivity === 'function') {
      return FtthLab.photodiodeResponsivity(nm);
    }
    return 1;
  }

  function calibrationErrorDb(lightNm, calNm) {
    if (global.FtthLab && typeof FtthLab.responsivityErrorDb === 'function') {
      return FtthLab.responsivityErrorDb(lightNm, calNm);
    }
    return 0;
  }

  /** Value the meter prints for light at lightNm while calibrated to its own λ. */
  function calibratedDbm(trueDbm, lightNm) {
    if (trueDbm == null || !isFinite(trueDbm)) return trueDbm;
    if (global.FtthLab && typeof FtthLab.calibratedReadingDbm === 'function') {
      return FtthLab.calibratedReadingDbm(trueDbm, lightNm, resolveWavelengthNm());
    }
    return trueDbm;
  }

  function photocurrentA(trueDbm, lightNm) {
    if (global.FtthLab && typeof FtthLab.photodiodeCurrentA === 'function') {
      return FtthLab.photodiodeCurrentA(trueDbm, lightNm);
    }
    return null;
  }

  function formatCurrent(amps) {
    if (amps == null || !isFinite(amps)) return '—';
    if (amps >= 1e-3) return (amps * 1e3).toFixed(3) + ' mA';
    if (amps >= 1e-6) return (amps * 1e6).toFixed(2) + ' µA';
    return (amps * 1e9).toFixed(1) + ' nA';
  }

  /** Fiber graph snapshots expose attachments directly; live models wrap them. */
  function endpointAttachment(side) {
    if (!side) return null;
    return side.attached || side;
  }

  function endpointIsOpm(side, opmId) {
    var att = endpointAttachment(side);
    return !!(att && att.owner === 'opm' && att.opmId === opmId);
  }

  function isDockOccupied(opmId) {
    var graph = global.FtthLab && typeof FtthLab.getFiberLaserGraph === 'function'
      ? FtthLab.getFiberLaserGraph()
      : { pcords: [], pigtails: [] };
    var i;
    var pcords = graph.pcords || [];
    for (i = 0; i < pcords.length; i++) {
      var c = pcords[i];
      if (endpointIsOpm(c.sideA, opmId) || endpointIsOpm(c.sideB, opmId)) return true;
    }
    var pigtails = graph.pigtails || [];
    for (i = 0; i < pigtails.length; i++) {
      var p = pigtails[i];
      if (endpointIsOpm(p.connector, opmId)) return true;
    }
    return false;
  }

  function isDockMismatch(opmId) {
    var graph = global.FtthLab && typeof FtthLab.getFiberLaserGraph === 'function'
      ? FtthLab.getFiberLaserGraph()
      : { pcords: [], pigtails: [] };
    var i;
    var pcords = graph.pcords || [];
    for (i = 0; i < pcords.length; i++) {
      var c = pcords[i];
      if (endpointIsOpm(c.sideA, opmId) && c.sideA.mismatch) return true;
      if (endpointIsOpm(c.sideB, opmId) && c.sideB.mismatch) return true;
    }
    var pigtails = graph.pigtails || [];
    for (i = 0; i < pigtails.length; i++) {
      var p = pigtails[i];
      if (endpointIsOpm(p.connector, opmId) && p.connector.mismatch) return true;
    }
    return false;
  }

  function refreshDockReadings() {
    devices.forEach(function (d) {
      var occupied = isDockOccupied(d.id);
      d.docked = occupied;
      d.dockMismatch = occupied && isDockMismatch(d.id);
      if (!occupied) {
        d.carrierActive = false;
        d.lastSources = [];
        d.lastReading = {
          dBm: null,
          lossDb: null,
          source: null,
          label: 'UNCONNECTED',
          path: [],
          note: 'NO CABLE',
          docked: false,
        };
      } else {
        d.lastSources = sourcesAtDock(d.id);
        var reading = measureAtDock(d.id);
        if (reading && reading.source && isFinite(reading.dBm)) {
          d.lastReading = reading;
          d.lastReading.mismatch = d.dockMismatch;
          d.carrierActive = reading.source.kind === 'ols';
        } else {
          d.carrierActive = false;
          d.lastReading = {
            dBm: reading && reading.dBm,
            lossDb: reading && reading.lossDb,
            source: reading && reading.source,
            label: 'SIGNAL LOW',
            path: (reading && reading.path) || [],
            note: (reading && reading.note) || 'No optical path to OLT',
            docked: true,
            mismatch: d.dockMismatch,
          };
        }
      }
    });
    lastBroadcast();
    rebuildLayer();
    updateInspector();
  }

  function lastBroadcast() {
    var primary = null;
    var i;
    for (i = devices.length - 1; i >= 0; i--) {
      if (devices[i].docked) {
        primary = devices[i];
        break;
      }
    }
    if (!primary) primary = devices.length ? devices[devices.length - 1] : null;
    var reading = primary && primary.lastReading;
    if (global.PowerMeterTrainer && typeof PowerMeterTrainer.applyDockReading === 'function') {
      PowerMeterTrainer.applyDockReading(reading, primary);
    }
    if (typeof global.dispatchEvent === 'function') {
      try {
        global.dispatchEvent(new CustomEvent('opm-dock-reading', {
          detail: { reading: reading, device: primary },
        }));
      } catch (err) { /* ignore */ }
    }
  }

  function ensureLayer() {
    if (layer && layer.parentNode) return layer;
    var mount = document.getElementById('lab-2d-mount');
    if (!mount) return null;
    layer = document.createElement('div');
    layer.className = 'lab-opm-layer';
    layer.setAttribute('data-lab-opm-layer', '1');
    mount.appendChild(layer);
    bindKeypadDelegation(layer);
    return layer;
  }

  /** Softkey advertises the unit it switches to, as on the real OLP-38. */
  function softUnitLabel(mode) {
    return mode === 'mw' ? 'Pow. [dBm]' : 'Pow. [W]';
  }

  function lcdHeaderMarkup() {
    return (
      '<div class="viavi__lcd-top">' +
      '<span class="viavi__lcd-mode">Broadband / Expert</span>' +
      '<span class="viavi__lcd-clock" aria-label="Session timer">' +
      '<svg class="viavi__lcd-clock-icon" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">' +
      '<circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.2"/>' +
      '<path d="M8 4.5V8l2.5 1.5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>' +
      '</svg>' +
      '<span class="viavi__lcd-clock-val">00:00</span>' +
      '<span class="opm__batt" title="Battery" aria-hidden="true">' +
      '<span class="opm__batt-body"><span class="opm__batt-fill"></span></span>' +
      '<span class="opm__batt-nip"></span>' +
      '</span>' +
      '</span>' +
      '</div>'
    );
  }

  /** Received power text for the active unit mode. */
  function readingText(dBm, unitMode2) {
    if (dBm == null || !isFinite(dBm)) return '——.—';
    if (unitMode2 === 'mw') return formatMw(dBm) || '——.—';
    return formatDbm(dBm);
  }

  function softKeysMarkup(leftLabel, softUnit) {
    return (
      '<div class="viavi__lcd-soft">' +
      '<span class="viavi__soft-key viavi__lambda-chip">' + leftLabel + '</span>' +
      '<span class="viavi__soft-key viavi__soft-ref">Abs&gt;Ref</span>' +
      '<span class="viavi__soft-key viavi__soft-unit">' + softUnit + '</span>' +
      '</div>'
    );
  }

  function screenMarkup(d) {
    var r = d.lastReading;
    var unitMode2 = resolveUnitMode();
    var idle = !d.docked || !r || !isFinite(r.dBm) || !r.source;
    var wl = resolveWavelengthNm();
    var softUnit = softUnitLabel(unitMode2);
    var mirror = idle ? null : olsMirrorState(d);

    /* Multi-λ mirror: one row per wavelength with its own received value */
    if (mirror && mirror.mode === 'multi' && mirror.rows.length) {
      var rowsHtml = mirror.rows.map(function (row) {
        return (
          '<div class="opm__lcd-row">' +
          '<span class="opm__row-wl">' + row.wavelengthNm + ' nm</span>' +
          '<span class="opm__row-val">' + readingText(row.dBm, unitMode2) + '</span>' +
          '</div>'
        );
      }).join('');
      return (
        '<div class="viavi__lcd opm__lcd opm__lcd--multi" aria-live="polite">' +
        lcdHeaderMarkup() +
        '<div class="opm__lcd-stack">' + rowsHtml + '</div>' +
        softKeysMarkup('Multi-λ', softUnit) +
        '</div>'
      );
    }

    var shownDbm = mirror ? mirror.outputDbm : (r && r.dBm);
    var main = idle ? 'SIGNAL LOW' : readingText(shownDbm, unitMode2);
    var unit = (!idle && unitMode2 !== 'mw') ? 'dBm' : '';

    /* Auto-λ mirror: wavelength printed under the power value */
    if (mirror && mirror.mode === 'auto') {
      return (
        '<div class="viavi__lcd opm__lcd opm__lcd--auto" aria-live="polite">' +
        lcdHeaderMarkup() +
        '<div class="viavi__lcd-main is-live">' +
        '<span class="viavi__lcd-value">' + main + '</span>' +
        (unit ? '<span class="viavi__lcd-unit">' + unit + '</span>' : '') +
        '</div>' +
        '<div class="opm__lcd-meta"><span class="opm__meta-left">' +
        mirror.wavelengthNm + ' nm</span></div>' +
        softKeysMarkup('Auto-λ', softUnit) +
        '</div>'
      );
    }

    /* Single-λ mirror: CW / tone label under the power value */
    if (mirror && mirror.mode === 'single') {
      var modTxt = mirror.modulation === 'CW'
        ? 'CW'
        : String(mirror.modulation) + ' Hz';
      var calWarn = mirror.calMismatch
        ? '<span class="opm__cal-warn" title="λ calibration mismatch · ' +
          mirror.wavelengthNm + ' nm light read on the ' + mirror.calibrationNm +
          ' nm table">CAL</span>'
        : '';
      return (
        '<div class="viavi__lcd opm__lcd opm__lcd--single' +
        (mirror.calMismatch ? ' is-cal-error' : '') + '" aria-live="polite">' +
        lcdHeaderMarkup() +
        '<div class="viavi__lcd-main is-live">' +
        '<span class="viavi__lcd-value">' + main + '</span>' +
        (unit ? '<span class="viavi__lcd-unit">' + unit + '</span>' : '') +
        '</div>' +
        '<div class="opm__lcd-meta"><span class="opm__meta-left">' + modTxt + '</span>' +
        calWarn + '</div>' +
        softKeysMarkup(mirror.calibrationNm + ' nm', softUnit) +
        '</div>'
      );
    }

    return (
      '<div class="viavi__lcd opm__lcd" aria-live="polite">' +
      lcdHeaderMarkup() +
      '<div class="viavi__lcd-main' + (idle ? ' is-idle' : ' is-live') + '">' +
      '<span class="viavi__lcd-value">' + main + '</span>' +
      (unit ? '<span class="viavi__lcd-unit">' + unit + '</span>' : '') +
      '</div>' +
      softKeysMarkup(wl + ' nm', softUnit) +
      '</div>'
    );
  }

  function closestEl(start, sel) {
    var t = start;
    if (t && t.nodeType === 3) t = t.parentElement;
    return t && t.closest ? t.closest(sel) : null;
  }

  function isOpmKeyTarget(e) {
    return !!closestEl(e.target, '.lab-opm .viavi__key, .lab-opm .viavi__keys, .lab-opm button');
  }

  function handleOpmKey(btn) {
    if (!btn) return;
    if (btn.hasAttribute('data-opm-wave-cycle')) {
      cycleLocalWavelength();
      return;
    }
    if (btn.hasAttribute('data-opm-mode')) {
      toggleLocalUnit();
      return;
    }
    if (btn.hasAttribute('data-opm-std-cycle')) {
      toggleLocalStandard();
      return;
    }
    if (btn.hasAttribute('data-opm-save')) {
      if (global.PowerMeterTrainer && typeof PowerMeterTrainer.takeSnapshot === 'function') {
        PowerMeterTrainer.takeSnapshot();
      } else {
        setStatus('OLP-38 · SAVE');
      }
      return;
    }
    if (btn.hasAttribute('data-opm-ref')) {
      var trainerRef = document.getElementById('opm-btn-ref');
      if (trainerRef) trainerRef.click();
    }
  }

  function bindKeypadDelegation(host) {
    if (!host || host.dataset.opmKeypadBound === '1') return;
    host.dataset.opmKeypadBound = '1';

    host.addEventListener('pointerdown', function (e) {
      if (!isOpmKeyTarget(e)) return;
      e.stopPropagation();
    }, true);

    host.addEventListener('pointerup', function (e) {
      if (!isOpmKeyTarget(e)) return;
      e.stopPropagation();
    }, true);

    host.addEventListener('click', function (e) {
      var btn = closestEl(
        e.target,
        '[data-opm-wave-cycle], [data-opm-mode], [data-opm-save], [data-opm-std-cycle], [data-opm-ref], [data-opm-pwr]'
      );
      if (!btn || !btn.closest('.lab-opm')) return;
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      handleOpmKey(btn);
    }, true);
  }

  function rebuildLayer() {
    var host = ensureLayer();
    if (!host) return;

    var html = '';
    devices.forEach(function (d) {
      var sel = selection.kind === 'opm' && selection.id === d.id ? ' is-selected' : '';
      var mismatch = d.dockMismatch ? ' is-mismatch' : '';
      var warn = d.docked && d.lastReading && !d.lastReading.source ? ' is-warning' : '';
      var carrier = d.carrierActive ? ' is-carrier-active' : '';
      var portCls = 'viavi__port lab-opm-port' + (d.docked ? ' is-occupied' : '') + mismatch + warn;
      var dockedAttr = d.docked ? '1' : '0';
      var mismatchAttr = d.dockMismatch ? '1' : '0';
      var warnAttr = warn ? '1' : '0';
      html +=
        '<div class="lab-opm lab-opm--viavi lab-opm--fixed' + sel + (d.docked ? ' is-docked' : '') +
        carrier + '" data-opm-node="' + d.id + '" data-carrier-active="' +
        (d.carrierActive ? '1' : '0') + '" style="left:' + d.x + 'px;top:' + d.y + 'px">' +
        '<div class="viavi" data-docked="' + dockedAttr +
        '" data-mismatch="' + mismatchAttr + '" data-warning="' + warnAttr + '">' +
        '<div class="viavi__bumper viavi__bumper--tl" aria-hidden="true"></div>' +
        '<div class="viavi__bumper viavi__bumper--tr" aria-hidden="true"></div>' +
        '<div class="viavi__bumper viavi__bumper--bl" aria-hidden="true"></div>' +
        '<div class="viavi__bumper viavi__bumper--br" aria-hidden="true"></div>' +
        '<div class="viavi__face" data-opm-drag="' + d.id + '">' +
        '<div class="' + portCls +
        '" data-opm-port="' + d.id + '" data-opm-connector="SC" title="SC optical adapter · dock patch/pigtail here">' +
        '<span class="viavi__adapter-base" aria-hidden="true"></span>' +
        '<span class="viavi__adapter-knurl" aria-hidden="true"></span>' +
        '<span class="viavi__adapter-bore" aria-hidden="true"></span>' +
        '</div>' +
        '<div class="viavi__badge">VIAVI</div>' +
        screenMarkup(d) +
        '<div class="viavi__keys">' +
        '<button type="button" class="viavi__key viavi__key--lambda" data-opm-wave-cycle title="Wavelength — cycle λ" aria-label="Cycle wavelength">λ</button>' +
        '<button type="button" class="viavi__key" data-opm-std-cycle title="Standard"></button>' +
        '<button type="button" class="viavi__key" data-opm-ref title="Set REF"></button>' +
        '<button type="button" class="viavi__key viavi__key--mode" data-opm-mode title="MODE — toggle dBm / mW" aria-label="Toggle dBm and mW">MODE</button>' +
        '<button type="button" class="viavi__key viavi__key--save" data-opm-save title="SAVE">SAVE</button>' +
        '<button type="button" class="viavi__key viavi__key--pwr" data-opm-pwr title="Power" aria-label="Power">⏻</button>' +
        '</div>' +
        '<div class="viavi__model">OLP-38</div>' +
        '</div></div></div>';
    });
    host.innerHTML = html;
    bindLayerEvents(host);
    if (global.PowerMeterTrainer && typeof PowerMeterTrainer.refreshViaviClocks === 'function') {
      PowerMeterTrainer.refreshViaviClocks();
    }
  }

  function bindLayerEvents(host) {
    host.querySelectorAll('[data-opm-drag]').forEach(function (grip) {
      grip.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        if (isOpmKeyTarget(e)) return;
        if (closestEl(e.target, '.lab-opm-port, .viavi__lcd')) return;
        e.preventDefault();
        e.stopPropagation();
        var id = grip.getAttribute('data-opm-drag');
        var d = findDevice(id);
        if (!d) return;
        selectOpm(id, { skipRebuild: true });
        var zoom = getZoom() || 1;
        var sx = e.clientX;
        var sy = e.clientY;
        var ox = d.x;
        var oy = d.y;
        var node = host.querySelector('[data-opm-node="' + id + '"]');
        if (node) node.classList.add('is-dragging', 'is-selected');

        function onMove(ev) {
          d.x = Math.round(ox + (ev.clientX - sx) / zoom);
          d.y = Math.round(oy + (ev.clientY - sy) / zoom);
          if (node) {
            node.style.left = d.x + 'px';
            node.style.top = d.y + 'px';
          }
          if (global.FtthLab && typeof FtthLab.notifyLayoutChange === 'function') {
            FtthLab.notifyLayoutChange({ source: 'opm', live: true, opmId: id });
          }
        }
        function onUp() {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          if (node) node.classList.remove('is-dragging');
          rebuildLayer();
          pushHistory();
          if (global.FtthLab && typeof FtthLab.notifyLayoutChange === 'function') {
            FtthLab.notifyLayoutChange({ source: 'opm', opmId: id });
          }
        }
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });
    });
  }

  function placeOpm(x, y) {
    seq += 1;
    var pos = (typeof x === 'number' && typeof y === 'number')
      ? { x: x, y: y }
      : defaultPos();
    var d = {
      id: 'opm-' + seq,
      x: pos.x,
      y: pos.y,
      docked: false,
      lastSources: [],
      lastReading: {
        dBm: null,
        lossDb: null,
        source: null,
        label: 'UNCONNECTED',
        path: [],
        note: 'NO CABLE',
        docked: false,
      },
    };
    devices.push(d);
    selectOpm(d.id);
    rebuildLayer();
    pushHistory();
    lastBroadcast();
    publishOpmPowerEquation();
    return d;
  }

  function selectOpm(id, opts) {
    opts = opts || {};
    selection = { kind: 'opm', id: id };
    claimSelection();
    renderToolbox();
    if (opts.skipRebuild) {
      if (layer) {
        layer.querySelectorAll('[data-opm-node]').forEach(function (n) {
          n.classList.toggle('is-selected', n.getAttribute('data-opm-node') === id);
        });
      }
    } else {
      rebuildLayer();
    }
    updateInspector();
  }

  function removeOpm(id) {
    devices = devices.filter(function (d) { return d.id !== id; });
    if (selection.id === id) selection = { kind: 'none', id: null };
    rebuildLayer();
    updateInspector();
    pushHistory();
    lastBroadcast();
  }

  function renderToolbox() {
    var host = global.FtthLab && typeof FtthLab.gateToolboxRender === 'function'
      ? FtthLab.gateToolboxRender('lab-opm-tree', 'opm')
      : document.getElementById('lab-opm-tree');
    if (!host) return;
    var meta = (global.FtthLab && FtthLab.getToolMeta && FtthLab.getToolMeta('opm')) || {};
    host.innerHTML =
      '<div class="lab-toolbox" role="list">' +
      '<button type="button" class="lab-tool lab-tool--opm' +
      (selectedTool === 'opm' ? ' is-selected' : '') +
      '" draggable="true" data-lab-tool="opm" data-lab-category="' + TOOL_CATEGORY + '" role="listitem">' +
      '<span class="lab-tool__mark lab-tool__mark--opm" aria-hidden="true"></span>' +
      '<span class="lab-tool__copy">' +
      '<strong>' + (meta.label || 'Viavi OLP-38') + '</strong>' +
      '<span>' + (meta.sublabel || 'SC dock · live dBm') + '</span>' +
      '</span>' +
      '</button>' +
      '</div>';
    bindToolbox(host);
    if (global.FtthLab && typeof FtthLab.applyFtthLabToolboxIcons === 'function') {
      FtthLab.applyFtthLabToolboxIcons();
    }
  }

  function bindToolbox(host) {
    var btn = host.querySelector('[data-lab-tool="opm"]');
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (global.FtthLab && typeof FtthLab.armDragOnlyToolboxTool === 'function') {
        FtthLab.armDragOnlyToolboxTool('opm', 'OLP-38 · drag onto workspace to place');
      } else if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
        FtthLab.claimToolboxTool('opm');
      }
      selectedTool = 'opm';
      renderToolbox();
    });
    btn.addEventListener('dragstart', function (e) {
      if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
        FtthLab.claimToolboxTool('opm');
      }
      selectedTool = 'opm';
      if (global.FtthLab && FtthLab.beginDrag) {
        FtthLab.beginDrag({ kind: 'opm' });
      }
      try {
        e.dataTransfer.setData('text/plain', 'lab:opm');
        e.dataTransfer.setData('text/lab-drag', 'opm');
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
    if (!stage || stage.dataset.opmDropBound === '1') return;
    stage.dataset.opmDropBound = '1';
    stage.addEventListener('drop', function (e) {
      var drag = global.FtthLab && FtthLab.getActiveDrag && FtthLab.getActiveDrag();
      if (!drag || drag.kind !== 'opm') return;
      e.preventDefault();
      var pt = clientToWorld(e.clientX, e.clientY);
      placeOpm(Math.round(pt.x - OPM_W / 2), Math.round(pt.y - 24));
      if (global.FtthLab && FtthLab.endDrag) FtthLab.endDrag();
      selectedTool = 'opm';
      renderToolbox();
    });
  }

  function formatSignedDbm(n) {
    if (n == null || !isFinite(n)) return '—';
    return (n >= 0 ? '+' : '') + Number(n).toFixed(2) + ' dBm';
  }

  function formatLossDb(db) {
    var n = Number(db);
    if (!isFinite(n)) return '—';
    return n.toFixed(2) + ' dB';
  }

  function powerEquationText(d) {
    var r = d && d.lastReading;
    if (!d || !d.docked || !r || !r.source || !isFinite(r.dBm)) {
      return 'OLP-38 · no optical path · SIGNAL LOW';
    }
    var tx = Number(r.source.txDbm);
    var b = r.lossBreakdown;
    var total = b && isFinite(b.totalDb) ? Number(b.totalDb) : Number(r.lossDb);
    var rx = isFinite(tx) && isFinite(total)
      ? Math.round((tx - total) * 100) / 100
      : Number(r.dBm);
    var parts = [];
    parts.push('[' + (isFinite(tx) ? (tx >= 0 ? '+' : '') + tx.toFixed(2) : '—') +
      ' dBm (TX)]');
    function sub(db, label) {
      var n = Number(db);
      if (!isFinite(n) || Math.abs(n) < 0.005) return;
      parts.push('[' + n.toFixed(2) + ' dB (' + label + ')]');
    }
    if (b) {
      sub(b.splitterDb, 'Splitters');
      sub(b.spliceDb, 'Splices');
      sub(b.connectorDb, 'Connectors');
      sub(b.couplerDb, 'Couplers');
      sub(b.fiberDb, 'Fiber');
      sub(b.bendDb, 'Bend');
      sub(b.mismatchDb, 'Mismatch');
    } else if (isFinite(r.lossDb)) {
      sub(r.lossDb, 'Loss');
    }
    return parts.join(' − ') + ' = ' +
      (rx >= 0 ? '+' : '') + rx.toFixed(2) + ' dBm (OLP-38)';
  }

  function publishOpmPowerEquation() {
    if (selection.kind !== 'opm' || !selection.id) return false;
    var d = findDevice(selection.id);
    if (!d) return false;
    if (global.FtthLab && typeof FtthLab.setStatus === 'function') {
      FtthLab.setStatus(powerEquationText(d), true);
    }
    return true;
  }

  function lossItemRow(label, db, note, extraClass) {
    var n = Number(db);
    if (!isFinite(n) || Math.abs(n) < 0.005) return '';
    extraClass = extraClass || '';
    return (
      '<div class="lab-loss-row' + (extraClass ? ' ' + extraClass : '') + '">' +
      '<div class="lab-loss-row__head">' +
      '<span class="lab-loss-row__label">' + label + '</span>' +
      '<strong class="lab-loss-row__val">' + formatLossDb(n) + '</strong>' +
      '</div>' +
      (note
        ? '<p class="lab-loss-row__note">' + note + '</p>'
        : '') +
      '</div>'
    );
  }

  function summaryRow(label, valueHtml, extraClass) {
    return (
      '<div class="lab-loss-row ' + extraClass + '">' +
      '<div class="lab-loss-row__head">' +
      '<span class="lab-loss-row__label">' + label + '</span>' +
      '<strong class="lab-loss-row__val">' + valueHtml + '</strong>' +
      '</div></div>'
    );
  }

  function lossBreakdownMarkup(reading) {
    var b = reading && reading.lossBreakdown;
    if (!b || !reading || !reading.source || !isFinite(reading.dBm)) return '';
    var tx = Number(reading.source.txDbm);
    var opmNm = resolveWavelengthNm();
    var total = Number(b.totalDb);
    if (!isFinite(total)) total = Number(reading.lossDb);
    var rx = isFinite(tx) && isFinite(total) ? Math.round((tx - total) * 100) / 100 : reading.dBm;
    var spliceN = b.spliceCount || 0;
    if (!spliceN && b.spliceDb >= 0.005) {
      spliceN = Math.max(1, Math.round(b.spliceDb / (b.spliceEachDb || 0.1)));
    }
    var mismatchN = b.mismatchCount || 0;
    if (!mismatchN && b.mismatchDb >= 0.005) {
      mismatchN = Math.max(1, Math.round(b.mismatchDb / (b.mismatchEachDb || 3)));
    }
    var splitterNote = b.splitterNote
      ? b.splitterNote + (b.splitterNote.indexOf('PLC') >= 0 ? '' : ' PLC')
      : '';
    var spliceNote = spliceN
      ? spliceN + '× fusion @ ' + Number(b.spliceEachDb || 0.1).toFixed(2) + ' dB'
      : '';
    var couplerNote = b.couplerCount ? b.couplerCount + '× adapter · 0.20 dB each' : '';
    var fiberNote = (b.fiberLengthM >= 0.01)
      ? Number(b.fiberLengthM).toFixed(2) + ' m @ ' + opmNm + ' nm'
      : opmNm + ' nm';
    var mismatchNote = mismatchN
      ? mismatchN + '× APC ↔ UPC · ≥ ' + Number(b.mismatchEachDb || 3).toFixed(1) + ' dB'
      : '';
    return (
      '<p class="lab-inspector__label">Optical Path Loss</p>' +
      '<div class="lab-spl-sheet lab-spl-sheet--loss">' +
      summaryRow('Ptx', isFinite(tx) ? formatSignedDbm(tx) : '—', 'is-ptx') +
      lossItemRow('PLC Splitters', b.splitterDb, splitterNote) +
      lossItemRow('Fusion Splices', b.spliceDb, spliceNote) +
      lossItemRow('Connectors', b.connectorDb, b.connectorNote) +
      lossItemRow('Couplers', b.couplerDb, couplerNote) +
      lossItemRow('Fiber Cable', b.fiberDb, fiberNote) +
      lossItemRow('Macro-Bend', b.bendDb, b.bendDb >= 0.005 ? 'Macro-Bend Tester' : '') +
      lossItemRow('Mismatched Penalty', b.mismatchDb, mismatchNote) +
      summaryRow('Total Link Loss', formatLossDb(total), 'is-total') +
      summaryRow('Final Power (Reading)', formatSignedDbm(rx), 'is-reading') +
      '</div>'
    );
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

  function updateInspector() {
    var card = document.getElementById('lab-inspector-card');
    var detail = document.getElementById('lab-inspector-detail');
    if (!card || !detail) return;
    if (selection.kind !== 'opm' || !selection.id) {
      if (card.dataset.opmInspector === '1') {
        card.dataset.opmInspector = '';
        if (global.FtthLab && typeof FtthLab.resetInspectorIdle === 'function') {
          FtthLab.resetInspectorIdle();
        }
      }
      return;
    }
    var d = findDevice(selection.id);
    if (!d) return;
    card.dataset.opmInspector = '1';
    card.hidden = true;
    detail.hidden = false;
    var meta = (global.FtthLab && FtthLab.getToolMeta && FtthLab.getToolMeta('opm')) || {};
    var title = meta.label || 'Viavi OLP-38';
    var guide = meta.guideText || 'Dock an <strong>SC</strong> Patch Cord or Pigtail into the metal adapter on top.';
    var r = d.lastReading;
    detail.innerHTML =
      '<div class="lab-inspector__card">' +
      '<h2>' + title + '</h2>' +
      '<p>' + guide + '</p>' +
      performanceSpecsMarkup(meta) +
      '<div class="lab-spl-sheet">' +
      '<div><span>Dock</span><strong>' + (d.docked ? 'Occupied' : 'Open') + '</strong></div>' +
      '<div><span>Reading</span><strong>' +
      (r && isFinite(r.dBm) ? formatDbm(r.dBm) + ' dBm' : (r && r.label === 'UNCONNECTED' ? 'SIGNAL LOW' : (r && r.label) || 'SIGNAL LOW')) +
      '</strong></div>' +
      '<div><span>λ</span><strong>' + resolveWavelengthNm() + ' nm</strong></div>' +
      '<div><span>R(λ)</span><strong>' +
      responsivityAt(resolveWavelengthNm()).toFixed(2) + ' A/W</strong></div>' +
      (function () {
        var m = olsMirrorState(d);
        if (!m) return '';
        var rows =
          '<div><span>TX link</span><strong>OLS-35 · ' + m.modeLabel + '</strong></div>' +
          '<div><span>Photocurrent</span><strong>' + formatCurrent(m.photocurrentA) +
          '</strong></div>';
        if (m.calMismatch) {
          rows +=
            '<div><span>Cal error</span><strong>' +
            (m.calErrorDb >= 0 ? '+' : '') + m.calErrorDb.toFixed(2) + ' dB · ' +
            m.wavelengthNm + ' nm light on ' + m.calibrationNm + ' nm table</strong></div>';
        }
        return rows;
      })() +
      '</div>' +
      lossBreakdownMarkup(r) +
      '<button type="button" class="lab-eject-btn" data-remove-opm="' + d.id + '">Remove OLP-38</button>' +
      '</div>';
    var rm = detail.querySelector('[data-remove-opm]');
    if (rm) {
      rm.addEventListener('click', function () {
        removeOpm(d.id);
        if (global.FtthLab && typeof FtthLab.resetInspectorIdle === 'function') {
          FtthLab.resetInspectorIdle();
        }
      });
    }
    publishOpmPowerEquation();
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
    return JSON.parse(JSON.stringify({
      devices: devices,
      seq: seq,
      wavelengthNm: wavelengthNm,
      unitMode: unitMode,
    }));
  }

  function importProjectState(snap) {
    devices = (snap && snap.devices) ? JSON.parse(JSON.stringify(snap.devices)) : [];
    seq = (snap && snap.seq) || 0;
    if (snap && typeof snap.wavelengthNm === 'number') wavelengthNm = snap.wavelengthNm;
    if (snap && snap.unitMode) unitMode = snap.unitMode;
    selection = { kind: 'none', id: null };
    rebuildLayer();
    updateInspector();
    refreshDockReadings();
  }

  function onLayoutChange() {
    refreshDockReadings();
  }

  function onLaunchRequest(payload) {
    if (!payload || payload.tool !== 'opm') return;
    selectedTool = 'opm';
    renderToolbox();
    if (global.FtthLab && typeof FtthLab.armDragOnlyToolboxTool === 'function') {
      FtthLab.armDragOnlyToolboxTool('opm', 'OLP-38 · drag onto workspace to place');
    } else if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
      FtthLab.claimToolboxTool('opm');
    }
  }

  function deleteSelected() {
    if (selection.kind === 'opm' && selection.id) {
      removeOpm(selection.id);
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
    if (id === 'opm') return;
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
      FtthLab.getOpmPortWorld = getPortWorld;
      FtthLab.refreshOpmDocks = refreshDockReadings;
      FtthLab.publishOpmPowerEquation = publishOpmPowerEquation;
      FtthLab.getOpmDevices = function () {
        return devices.map(function (d) {
          return {
            id: d.id,
            x: d.x,
            y: d.y,
            docked: !!d.docked,
            carrierActive: !!d.carrierActive,
            reading: d.lastReading,
          };
        });
      };
      FtthLab.registerOpmRefresh(function () {
        refreshDockReadings();
      });
      if (FtthLab._launchTool === 'opm') {
        onLaunchRequest({ tool: 'opm' });
      }
    }
  }

  var tool = {
    id: 'opm',
    category: TOOL_CATEGORY,
    mount: mount,
    onLayoutChange: onLayoutChange,
    onLaunchRequest: onLaunchRequest,
    undo: function () {},
    redo: function () {},
    deleteSelected: deleteSelected,
    clearSelection: clearSelection,
    onToolboxClaim: onToolboxClaim,
    placeOpm: placeOpm,
    refreshDockReadings: refreshDockReadings,
    onLabConfigChanged: function (payload) {
      if (global.FtthLab && typeof FtthLab.handleToolboxConfigChange === 'function') {
        FtthLab.handleToolboxConfigChange('opm', 'lab-opm-tree', renderToolbox, payload && payload.config);
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
      FtthLab.registerTool('opm', tool);
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
