/**
 * FTTH Simulator — layout/label settings persistence and apply helpers.
 * Extracted from ftth-simulator-core.js (Phase 1).
 *
 * FTTH Lab toolbox icon overrides live in js/settings/FtthLabSettings.js
 * (localStorage key: ifa_ftth_lab_config).
 * Optical Power Meter toolbox config is independent: js/settings/OpmSettings.js
 * (localStorage key: ifa_opm_config).
 * Optical Power Meter projects: ifa_opm_projects (never ifa_ftth_lab_projects).
 */
(function (global) {
  'use strict';

  var getSim = null;
  var SETTINGS_STORAGE_KEY = 'ftth_simulator_settings_v1';

  function sim() {
    return getSim ? getSim() : null;
  }

  function clampLabelZoomPct(pct, fallback) {
    var n = parseInt(pct, 10);
    if (!isFinite(n)) return fallback;
    return Math.max(50, Math.min(1000, n));
  }

  function loadPersistedSettings() {
    var S = sim();
    if (!S) return;
    try {
      var raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (!raw) return;
      var saved = JSON.parse(raw);
      if (!saved || typeof saved !== 'object') return;
      if (saved.labelFontSize != null) S.settings.labelFontSize = saved.labelFontSize;
      if (saved.labelColor != null) S.settings.labelColor = saved.labelColor;
      if (saved.mapRotationEnabled != null) {
        S.settings.mapRotationEnabled = !!saved.mapRotationEnabled;
      }
      if (saved.toolLabelZoomMin != null) {
        S.settings.toolLabelZoomMin = clampLabelZoomPct(saved.toolLabelZoomMin, 100);
      }
      if (saved.cableLabelZoomMin != null) {
        S.settings.cableLabelZoomMin = clampLabelZoomPct(saved.cableLabelZoomMin, 150);
      }
    } catch (err) { /* ignore corrupt storage */ }
  }

  function persistLayoutSettings() {
    var S = sim();
    if (!S) return false;
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({
        labelFontSize: S.settings.labelFontSize,
        labelColor: S.settings.labelColor,
        toolLabelZoomMin: S.settings.toolLabelZoomMin,
        cableLabelZoomMin: S.settings.cableLabelZoomMin,
      }));
      return true;
    } catch (err) {
      return false;
    }
  }

  function showSettingsSavedToast() {
    var old = document.getElementById('sim-toast');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var t = document.createElement('div');
    t.id = 'sim-toast';
    t.setAttribute('role', 'status');
    t.className = 'sim-settings-toast';
    t.textContent = '\u2713 Settings Saved';
    document.body.appendChild(t);
    setTimeout(function () {
      if (t.parentNode) t.parentNode.removeChild(t);
    }, 1800);
  }

  function saveSettings() {
    var S = sim();
    if (!S) return;
    S.settings.toolLabelZoomMin = clampLabelZoomPct(S.settings.toolLabelZoomMin, 100);
    S.settings.cableLabelZoomMin = clampLabelZoomPct(S.settings.cableLabelZoomMin, 150);
    if (persistLayoutSettings()) {
      showSettingsSavedToast();
    }
  }

  function normalizeLabelColorHex(color) {
    if (!color || typeof color !== 'string') return '#ffffff';
    var hex = color.trim();
    if (!hex.startsWith('#')) hex = '#' + hex;
    if (/^#[0-9a-f]{3}$/i.test(hex)) {
      hex = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
    }
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return '#ffffff';
    return hex.toLowerCase();
  }

  function applyLabelFontSize() {
    var S = sim();
    if (!S) return;
    var px = S.settings.labelFontSize || 11;
    var canvas = document.getElementById('city-canvas');
    if (canvas) {
      canvas.style.setProperty('--element-label-font-size', px + 'px');
      canvas.style.setProperty('--map-label-font-size', px + 'px');
    }
    document.querySelectorAll('.element-label, .field-node-label').forEach(function (el) {
      el.style.fontSize = px + 'px';
    });
    document.querySelectorAll('#global-map-labels-layer .map-label').forEach(function (el) {
      el.setAttribute('font-size', String(px));
      el.setAttribute('font', 'bold ' + px + 'px Arial, sans-serif');
    });
    if (global.FTTHDrawingEngine?.requestMapLabelsRedraw) {
      global.FTTHDrawingEngine.requestMapLabelsRedraw();
    }
    global.FTTHLabelManager?.refresh?.();
    var valEl = document.getElementById('settings-label-size-value');
    if (valEl) valEl.textContent = px + 'px';
    var slider = document.getElementById('settings-label-size');
    if (slider && slider.value !== String(px)) slider.value = String(px);
  }

  function applyLabelColor() {
    var S = sim();
    if (!S) return;
    var color = normalizeLabelColorHex(S.settings.labelColor || '#ffffff');
    S.settings.labelColor = color;
    var canvas = document.getElementById('city-canvas');
    if (canvas) canvas.style.setProperty('--map-label-color', color);
    document.querySelectorAll('.element-label, .field-node-label').forEach(function (el) {
      el.style.color = color;
    });
    document.querySelectorAll('#global-map-labels-layer .map-label').forEach(function (el) {
      el.setAttribute('fill', color);
    });
    if (global.FTTHDrawingEngine?.requestMapLabelsRedraw) {
      global.FTTHDrawingEngine.requestMapLabelsRedraw();
    }
    global.FTTHLabelManager?.refresh?.();
    var valEl = document.getElementById('settings-label-color-value');
    if (valEl) valEl.textContent = color.toUpperCase();
    var picker = document.getElementById('settings-label-color');
    if (picker && picker.value.toLowerCase() !== color) picker.value = color;
  }

  function applyLabelZoomVisibility() {
    var S = sim();
    if (!S) return;
    S.settings.toolLabelZoomMin = clampLabelZoomPct(S.settings.toolLabelZoomMin, 100);
    S.settings.cableLabelZoomMin = clampLabelZoomPct(S.settings.cableLabelZoomMin, 150);
    global.FTTHLabelManager?.refresh?.();
    var toolSlider = document.getElementById('settings-tool-label-zoom');
    var toolVal = document.getElementById('settings-tool-label-zoom-value');
    var cableSlider = document.getElementById('settings-cable-label-zoom');
    var cableVal = document.getElementById('settings-cable-label-zoom-value');
    if (toolSlider) toolSlider.value = String(S.settings.toolLabelZoomMin);
    if (toolVal) toolVal.textContent = S.settings.toolLabelZoomMin + '%';
    if (cableSlider) cableSlider.value = String(S.settings.cableLabelZoomMin);
    if (cableVal) cableVal.textContent = S.settings.cableLabelZoomMin + '%';
  }

  function init(deps) {
    getSim = deps && deps.getSim ? deps.getSim : null;
  }

  global.FTTHSimulatorSettings = {
    init: init,
    SETTINGS_STORAGE_KEY: SETTINGS_STORAGE_KEY,
    clampLabelZoomPct: clampLabelZoomPct,
    normalizeLabelColorHex: normalizeLabelColorHex,
    loadPersistedSettings: loadPersistedSettings,
    persistLayoutSettings: persistLayoutSettings,
    saveSettings: saveSettings,
    applyLabelFontSize: applyLabelFontSize,
    applyLabelColor: applyLabelColor,
    applyLabelZoomVisibility: applyLabelZoomVisibility,
  };
})(typeof window !== 'undefined' ? window : globalThis);
