/**
 * VIAVI SmartOTDR — modular physical device component.
 * Toolbox drag-drop + chassis markup on #lab-2d-mount; ports expose fixed bounding boxes for magnetic snap.
 */
(function (global) {
  'use strict';

  var TOOL_ID = 'otdr-machine';
  var TOOL_CATEGORY = 'TESTING EQUIPMENT';
  var DEVICE_NAT_W = 400;
  var DEVICE_NAT_H = 500;
  var VIAVI_FIT = 0.5454545455;
  var OLS_PORT_DESIGN_W = 54;
  var OLS_PORT_DESIGN_H = 46;
  var OPM_PORT_DESIGN_W = 48;
  var OPM_PORT_DESIGN_H = 34;
  var PORT_PROTRUDE = Math.round(OLS_PORT_DESIGN_H * VIAVI_FIT);

  /** Scaled snap footprints — match OLS/OLP on canvas (5×7 grid @ --opm-fit). */
  var PORT_WIDTH = Math.round(OLS_PORT_DESIGN_W * VIAVI_FIT);
  var PORT_HEIGHT = Math.round(OLS_PORT_DESIGN_H * VIAVI_FIT);
  var VFL_PORT_WIDTH = Math.round(OPM_PORT_DESIGN_W * VIAVI_FIT);
  var VFL_PORT_HEIGHT = Math.round(OPM_PORT_DESIGN_H * VIAVI_FIT);

  /** Exact inner DOM cloned from ftth-lab-opm.js SC adapter (OLP-38). */
  var OLP_PORT_INNER =
    '<span class="viavi__adapter-base" aria-hidden="true"></span>' +
    '<span class="viavi__adapter-knurl" aria-hidden="true"></span>' +
    '<span class="viavi__adapter-bore" aria-hidden="true"></span>';

  /** Exact inner DOM cloned from ftth-lab-ols.js metallic SC adapter. */
  var OLS_PORT_INNER =
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
    '</span>';

  function buildOlsStylePortMarkup(id, portType, label) {
    return (
      '<div class="protruding-port protruding-port--optical protruding-port--' + portType + ' device-port"' +
      ' id="' + id + '" data-port-type="' + portType + '" data-port-id="' + id + '"' +
      ' style="width:' + PORT_WIDTH + 'px;height:' + PORT_HEIGHT + 'px"' +
      ' role="button" tabindex="0" aria-label="' + label + ' port">' +
      '<div class="viavi__port lab-ols-port lab-ols-port--metal lab-otdr-port" data-ols-port="' + id + '"' +
      ' data-otdr-port="' + id + '" data-ols-connector="SC" title="SC metallic adapter · ' + label + '">' +
      OLS_PORT_INNER +
      '</div></div>'
    );
  }

  function buildVflPortMarkup(id) {
    return (
      '<div class="protruding-port protruding-port--vfl protruding-port--opm device-port"' +
      ' id="' + id + '" data-port-type="vfl" data-port-id="' + id + '"' +
      ' data-polish-universal="true"' +
      ' style="width:' + VFL_PORT_WIDTH + 'px;height:' + VFL_PORT_HEIGHT + 'px"' +
      ' role="button" tabindex="0" aria-label="VFL port">' +
      '<div class="viavi__port lab-opm-port lab-otdr-port" data-opm-port="' + id + '"' +
      ' data-otdr-port="' + id + '" data-opm-connector="SC" data-polish-universal="true"' +
      ' title="SC optical adapter · VFL (universal PC/APC)">' +
      OLP_PORT_INNER +
      '</div></div>'
    );
  }

  function buildProtrudingPortsMarkup(deviceId) {
    return (
      '<div class="otdr-protruding-ports" aria-label="Protruding test ports (north-facing)">' +
      buildVflPortMarkup(deviceId + '-port-vfl') +
      buildOlsStylePortMarkup(deviceId + '-port-apc', 'apc', 'APC') +
      buildOlsStylePortMarkup(deviceId + '-port-apc-live', 'apc-live', 'APC LIVE') +
      '</div>'
    );
  }

  var devices = [];
  var seq = 0;
  var selectedTool = null;
  var dragLib = null;
  var layer = null;
  var selection = { kind: 'none', id: null };
  var history = [];
  var historyIndex = -1;
  var HISTORY_MAX = 48;
  var historyLocked = false;
  var CONNECTION_BOX_COUNT = 8;
  var CONNECTION_STEP_MS = 1500;
  var CONNECTION_GREEN_FROM = 3;
  var CONNECTION_VALIDATION_DELAY_MS = 5000;
  var connectionAnimTimers = {};
  var connectionValidationTimers = {};
  var acquisitionTimers = {};
  var isRealTimeActive = false;
  var realTimeInterval = null;
  var realTimeDeviceId = null;
  var realTimeNoisePhase = 0;
  var realTimeQualityScore = 100;
  var traceLiveNoiseActive = false;
  var traceLiveNoiseAmplitude = 0;
  var traceLiveNoisePhase = 0;
  var REAL_TIME_SCAN_MS = 300;
  var fiberDisconnectWarnedFor = null;
  var isDevicePoweredOn = true;
  var liveTrafficAcknowledged = {};
  var liveTrafficChoiceCallbacks = {};
  var smartlinkLiveWarningDismissed = {};
  var activeLaser = '1550';
  var activeOtdrPort = 'APC';

  var currentOtdrTestState = {
    configFile: '',
    durationSec: 20,
    laser: '1550 nm',
    distanceUnit: 'meter',
    launchCable: 'No',
    alarms: 'Yes',
    alarmsEnabled: true,
  };

  function parseDurationFromConfig(configFile) {
    if (!configFile) return 20;
    var match = configFile.match(/(\d+)s/i);
    if (match) return parseInt(match[1], 10) || 20;
    return 20;
  }

  function syncConfigToTestState(configFile) {
    if (!configFile) return;
    currentOtdrTestState.configFile = configFile;
    currentOtdrTestState.durationSec = parseDurationFromConfig(configFile);
  }

  function getAcquisitionDurationMs() {
    return (currentOtdrTestState.durationSec || 20) * 1000;
  }

  function laserDataValueFromState() {
    var m = (currentOtdrTestState.laser || '').match(/(\d+)/);
    return m ? m[1] : '1550';
  }

  function launchCableDataValue() {
    return (currentOtdrTestState.launchCable || 'No').toLowerCase() === 'yes' ? 'yes' : 'no';
  }

  function alarmsDataValue() {
    return (currentOtdrTestState.alarms || 'Yes').toLowerCase() === 'yes' ? 'yes' : 'no';
  }

  function resetTestStateToDefaults() {
    activeLaser = '1550';
    currentOtdrTestState.laser = '1550 nm';
    currentOtdrTestState.distanceUnit = 'meter';
    currentOtdrTestState.launchCable = 'No';
    currentOtdrTestState.alarms = 'Yes';
    currentOtdrTestState.alarmsEnabled = true;
  }

  function syncActiveLaserToDevice(deviceId) {
    var d = findDevice(deviceId);
    if (d) d.activeLaser = activeLaser;
  }

  function getActiveLaserValue(deviceId) {
    var d = findDevice(deviceId);
    if (d && d.activeLaser) return String(d.activeLaser);
    return laserDataValueFromState();
  }

  function isLiveLaserSelected(deviceId) {
    var laserVal = getActiveLaserValue(deviceId);
    var laserLabel = currentOtdrTestState.laser || '';
    return laserVal === '1625' ||
      laserVal.indexOf('1625') >= 0 ||
      laserLabel.indexOf('1625') >= 0;
  }

  function getActiveOtdrPortForDevice(deviceId) {
    var d = findDevice(deviceId);
    if (d && d.activeOtdrPort) return d.activeOtdrPort;
    return resolveActiveOtdrPortForDevice(deviceId);
  }

  function getRequiredOtdrPortName(deviceId) {
    return isLiveLaserSelected(deviceId) ? 'APC LIVE' : 'APC';
  }

  function getRequiredOtdrPortSuffix(deviceId) {
    return isLiveLaserSelected(deviceId) ? '-port-apc-live' : '-port-apc';
  }

  function isPigtailConnectedToRequiredPort(deviceId) {
    if (!deviceId) return false;
    return isOtdrPortConnected(deviceId, getRequiredOtdrPortSuffix(deviceId));
  }

  function validateConnection(deviceId) {
    if (!deviceId) return false;
    var laser = getActiveLaserValue(deviceId);
    var requiredPort = getRequiredOtdrPortName(deviceId);

    if ((laser === '1310' || laser === '1550') && requiredPort !== 'APC') {
      return false;
    }
    if (isLiveLaserSelected(deviceId) && requiredPort !== 'APC LIVE') {
      return false;
    }

    if (requiredPort === 'APC LIVE') {
      return isApcLivePortConnected(deviceId);
    }
    return isApcPortConnected(deviceId);
  }

  function isSafeLiveTest(deviceId) {
    return isLiveLaserSelected(deviceId) && isApcLivePortConnected(deviceId) && validateConnection(deviceId);
  }

  function setSetupRowValue(deviceNode, rowKey, dataValue) {
    var row = deviceNode.querySelector('[data-sts-row="' + rowKey + '"]');
    if (!row) return;
    row.querySelectorAll('.sts-opt:not(.sts-opt--default)').forEach(function (opt) {
      var match = opt.getAttribute('data-value') === dataValue;
      opt.classList.toggle('is-active', match);
      opt.classList.toggle('selected', match);
    });
  }

  function syncSetupRowToTestState(row, opt) {
    if (!row || !opt) return;
    var rowKey = row.getAttribute('data-sts-row');
    var val = opt.getAttribute('data-value');
    if (rowKey === 'laser') {
      activeLaser = val;
      currentOtdrTestState.laser = val === '1625' ? '1625 nm (LIVE)' : val + ' nm';
    }
    else if (rowKey === 'distance') currentOtdrTestState.distanceUnit = val || 'meter';
    else if (rowKey === 'launch-cable') {
      currentOtdrTestState.launchCable = val === 'yes' ? 'Yes' : 'No';
    } else if (rowKey === 'alarms') {
      currentOtdrTestState.alarms = val === 'yes' ? 'Yes' : 'No';
      currentOtdrTestState.alarmsEnabled = val === 'yes';
    }
  }

  function readSetupSelectionsFromDevice(deviceNode) {
    if (!deviceNode) return;
    var laserOpt = deviceNode.querySelector('[data-sts-row="laser"] .sts-opt.is-active');
    if (laserOpt) {
      var laserVal = laserOpt.getAttribute('data-value');
      activeLaser = laserVal;
      currentOtdrTestState.laser = laserVal === '1625' ? '1625 nm (LIVE)' : laserVal + ' nm';
      var laserDeviceId = deviceNode.getAttribute('data-otdr-node');
      if (laserDeviceId) syncActiveLaserToDevice(laserDeviceId);
    }
    var distOpt = deviceNode.querySelector('[data-sts-row="distance"] .sts-opt.is-active');
    if (distOpt) currentOtdrTestState.distanceUnit = distOpt.getAttribute('data-value') || 'meter';
    var lcOpt = deviceNode.querySelector('[data-sts-row="launch-cable"] .sts-opt.is-active');
    if (lcOpt) currentOtdrTestState.launchCable = lcOpt.getAttribute('data-value') === 'yes' ? 'Yes' : 'No';
    var alarmOpt = deviceNode.querySelector('[data-sts-row="alarms"] .sts-opt.is-active:not(.sts-opt--default)');
    if (alarmOpt) {
      currentOtdrTestState.alarms = alarmOpt.getAttribute('data-value') === 'yes' ? 'Yes' : 'No';
      currentOtdrTestState.alarmsEnabled = alarmOpt.getAttribute('data-value') === 'yes';
    }
    var configLabel = deviceNode.querySelector('.sts-config-name');
    if (configLabel && configLabel.textContent.trim()) {
      syncConfigToTestState(configLabel.textContent.trim());
    }
  }

  function applyTestStateToSetupUI(deviceNode) {
    if (!deviceNode) return;
    setSetupRowValue(deviceNode, 'laser', laserDataValueFromState());
    setSetupRowValue(deviceNode, 'distance', currentOtdrTestState.distanceUnit || 'meter');
    setSetupRowValue(deviceNode, 'launch-cable', launchCableDataValue());
    setSetupRowValue(deviceNode, 'alarms', alarmsDataValue());
    if (currentOtdrTestState.configFile) {
      updateSetupConfigLabel(deviceNode, currentOtdrTestState.configFile);
    }
  }

  function getDistanceDisplayScale() {
    var unit = currentOtdrTestState.distanceUnit || 'meter';
    if (unit === 'km') return { factor: 0.001, label: 'km', decimals: 3 };
    if (unit === 'feet') return { factor: 3.28084, label: 'ft', decimals: 1 };
    if (unit === 'kfeet') return { factor: 3.28084 / 1000, label: 'kft', decimals: 3 };
    if (unit === 'miles') return { factor: 0.000621371, label: 'mi', decimals: 3 };
    return { factor: 1, label: 'm', decimals: 3 };
  }

  function formatTraceDistance(meters, digits) {
    if (meters == null || !isFinite(meters)) return '—';
    var scale = getDistanceDisplayScale();
    var val = meters * scale.factor;
    var d = typeof digits === 'number' ? digits : scale.decimals;
    return val.toFixed(d);
  }

  function resolveTraceAxisDistanceDecimals(meterStep) {
    var unit = currentOtdrTestState.distanceUnit || 'meter';
    var scale = getDistanceDisplayScale();
    var stepDisplay = meterStep != null && isFinite(meterStep)
      ? meterStep * scale.factor
      : null;

    if (stepDisplay == null || stepDisplay <= 0) {
      if (unit === 'km') return 1;
      if (unit === 'kfeet' || unit === 'miles') return 3;
      return 0;
    }

    if (unit === 'km') {
      if (stepDisplay >= 1) return 0;
      if (stepDisplay >= 0.1) return 1;
      if (stepDisplay >= 0.01) return 2;
      return 3;
    }
    if (unit === 'kfeet' || unit === 'miles') {
      if (stepDisplay >= 1) return 1;
      if (stepDisplay >= 0.1) return 2;
      return 3;
    }
    if (unit === 'feet') {
      if (stepDisplay >= 100) return 0;
      if (stepDisplay >= 10) return 0;
      if (stepDisplay >= 1) return 1;
      return 2;
    }
    if (stepDisplay >= 100) return 0;
    if (stepDisplay >= 10) return 0;
    if (stepDisplay >= 1) return 1;
    return 2;
  }

  function formatTraceAxisDistance(meters, meterStep) {
    if (meters == null || !isFinite(meters)) return '';
    var unit = currentOtdrTestState.distanceUnit || 'meter';
    var scale = getDistanceDisplayScale();
    var val = meters * scale.factor;

    if (meterStep != null && isFinite(meterStep)) {
      var tickDecimals = resolveTraceAxisDistanceDecimals(meterStep);
      if (Math.abs(val) < Math.pow(10, -(tickDecimals + 1))) return '0';
      return val.toFixed(tickDecimals);
    }

    if (unit === 'km') {
      if (Math.abs(val) < 0.0005) return '0';
      if (val >= 10) return String(Math.round(val));
      if (val >= 1) return val.toFixed(1).replace(/\.0$/, '');
      return val.toFixed(2).replace(/\.?0+$/, '');
    }
    if (unit === 'kfeet' || unit === 'miles') {
      if (Math.abs(val) < 0.0005) return '0';
      if (val >= 10) return String(Math.round(val));
      if (val >= 1) return val.toFixed(1).replace(/\.0$/, '');
      return val.toFixed(3).replace(/\.?0+$/, '');
    }
    return String(Math.round(val));
  }

  function getTraceDistanceMeterStep(distMin, distMax) {
    var distScale = getDistanceDisplayScale();
    var displaySpan = Math.max((distMax - distMin) * distScale.factor, 0.001);
    var displayStep = pickTraceAxisStep(displaySpan);
    var unit = currentOtdrTestState.distanceUnit || 'meter';
    if (unit === 'meter' && displayStep > 50) {
      var meterSteps = [10, 25, 50, 100, 200, 500, 1000];
      var mi;
      for (mi = 0; mi < meterSteps.length; mi++) {
        if (meterSteps[mi] >= displayStep / distScale.factor * 0.85) {
          displayStep = meterSteps[mi] * distScale.factor;
          break;
        }
      }
    }
    if (unit === 'km' && displayStep > 1) {
      var kmSteps = [0.1, 0.2, 0.5, 1, 2, 5];
      var ki;
      for (ki = 0; ki < kmSteps.length; ki++) {
        if (kmSteps[ki] >= displayStep * 0.85) {
          displayStep = kmSteps[ki];
          break;
        }
      }
    }
    var meterStep = displayStep / distScale.factor;
    if (!isFinite(meterStep) || meterStep <= 0) meterStep = 1;
    return meterStep;
  }

  function updateAcquisitionTimerUI(deviceNode) {
    if (!deviceNode) return;
    var dur = currentOtdrTestState.durationSec || 20;
    var timerRight = deviceNode.querySelector('.acq-timer-right');
    if (timerRight) timerRight.textContent = formatAcqTimer(dur, dur);
  }

  function getTraceEventDistanceHeaderLabel() {
    var unit = currentOtdrTestState.distanceUnit || 'meter';
    if (unit === 'km') return 'Distance km';
    if (unit === 'meter' || unit === 'm') return 'Distance m';
    var scale = getDistanceDisplayScale();
    return 'Distance ' + scale.label;
  }

  function getTraceEventSectionHeaderLabel() {
    return 'Section km';
  }

  function formatTraceNumeric(value, digits) {
    if (value == null || !isFinite(value)) return null;
    return String(parseFloat(Number(value).toFixed(digits)));
  }

  function formatTraceEventDistance(meters) {
    if (meters == null || !isFinite(meters)) return '—';
    var m = Number(meters);
    var unit = currentOtdrTestState.distanceUnit || 'meter';
    if (unit === 'km') {
      return formatTraceNumeric(m / 1000, 3);
    }
    if (unit === 'meter' || unit === 'm') {
      return formatTraceNumeric(m, 2);
    }
    var scale = getDistanceDisplayScale();
    return formatTraceNumeric(m * scale.factor, scale.decimals);
  }

  function updateTraceUIFromTestState(deviceNode) {
    if (!deviceNode) return;
    var distTh = deviceNode.querySelector('.trace-event-table thead th:nth-child(2)');
    if (distTh) distTh.textContent = getTraceEventDistanceHeaderLabel();
    var secTh = deviceNode.querySelector('.trace-event-table thead th:nth-child(6)');
    if (secTh) secTh.textContent = getTraceEventSectionHeaderLabel();
    var lambdaVal = deviceNode.querySelector('.trace-summary-lambda-val');
    if (lambdaVal) {
      lambdaVal.textContent = (currentOtdrTestState.laser || '1550 nm').replace(/\s+/g, '');
    }
  }

  function resolveFiberAttachment(record) {
    if (!record) return null;
    if (record.attached && (record.attached.olsId || record.attached.opmId || record.attached.vflId)) {
      return record.attached;
    }
    if (record.olsId || record.opmId || record.vflId) return record;
    return null;
  }

  function attachmentMatchesPort(att, portId) {
    if (!att || !portId) return false;
    return att.olsId === portId || att.opmId === portId || att.vflId === portId;
  }

  function closestEl(node, selector) {
    return node && node.closest ? node.closest(selector) : null;
  }

  function claimSelection() {
    if (global.FtthLab && typeof FtthLab.setSelectionOwner === 'function') {
      FtthLab.setSelectionOwner(TOOL_ID);
    }
  }

  function findDevice(id) {
    for (var i = 0; i < devices.length; i++) {
      if (devices[i].id === id) return devices[i];
    }
    return null;
  }

  function getZoom() {
    if (global.FtthLab && typeof FtthLab.getZoom2d === 'function') {
      return FtthLab.getZoom2d() || 1;
    }
    return 1;
  }

  function getWorldSize() {
    if (global.FtthLab && typeof FtthLab.getWorldSize2d === 'function') {
      return FtthLab.getWorldSize2d();
    }
    return 4096;
  }

  function defaultPos() {
    var c = (global.FtthLab && typeof FtthLab.getViewportCenterWorld === 'function')
      ? FtthLab.getViewportCenterWorld()
      : { x: getWorldSize() / 2, y: getWorldSize() / 2 };
    var n = devices.length;
    return {
      x: Math.round(c.x - DEVICE_NAT_W / 2 + (n % 3) * 28),
      y: Math.round(c.y - DEVICE_NAT_H / 2 + Math.floor(n / 3) * 24),
    };
  }

  function captureSnapshot() {
    return JSON.parse(JSON.stringify({ devices: devices, seq: seq, selection: selection }));
  }

  function applySnapshot(snap) {
    devices = (snap && snap.devices) ? JSON.parse(JSON.stringify(snap.devices)) : [];
    seq = (snap && snap.seq) || 0;
    selection = (snap && snap.selection) ? JSON.parse(JSON.stringify(snap.selection)) : { kind: 'none', id: null };
    rebuildLayer();
    updateInspector();
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

  function isOtdrControlTarget(e) {
    return !!closestEl(
      e.target,
      '.otdr-btn, .otdr-dpad__btn, .otdr-dpad__center, .otdr-power-btn, .app-btn, .otdr-screen, .otdr-os-home, .otdr-smart-test-app, .otdr-smart-test-setup, .otdr-smart-test-running, .st-list-item, .st-btn, .sts-opt, .sts-action-btn, .sidebar-btn, .sidebar-btn-start, .running-tabs-header .tab, .zoom-in-btn, .zoom-out-btn, .cursor-a-btn, .otdr-trace-canvas, .trace-graph-area, .trace-resizer, .trace-summary-bar, .otdr-error-popup, .traffic-detected-popup, .traffic-detected-popup__btn, .smartlink-live-warning-popup, .smartlink-status-popup, .smartlink-schematic, .sl-event-wrapper, .sl-fiber-section'
    );
  }

  function isOtdrPortTarget(e) {
    return !!closestEl(
      e.target,
      '.lab-otdr-port, .lab-ols-port, .lab-opm-port, .protruding-port, .device-port, .otdr-protruding-ports'
    );
  }

  function fiberGraph() {
    return (global.FtthLab && typeof FtthLab.getFiberLaserGraph === 'function')
      ? FtthLab.getFiberLaserGraph()
      : { pcords: [], pigtails: [] };
  }

  var OTDR_CONNECTOR_LOSS_DB = 0.2;
  var OTDR_LAUNCH_REFLECT_DB = -45;
  var OTDR_FAR_REFLECT_DB = -14.8;
  var OTDR_FUSION_SPLICE_DB = 0.05;
  var OTDR_COUPLER_PASS_DB = 0.3;
  var VIAVI_MIN_SECTION_KM_FOR_SLOPE = 0.02;
  var OTDR_FALLBACK_PX_PER_M = 160;

  function roundTrace2(n) {
    return Math.round(n * 100) / 100;
  }

  function roundTrace3(n) {
    return Math.round(n * 1000) / 1000;
  }

  function parseOtdrWavelengthNm() {
    var m = (currentOtdrTestState.laser || '1550 nm').match(/(\d+)/);
    return m ? parseInt(m[1], 10) : 1550;
  }

  function labFiberAttenuationDbKm(wavelengthNm) {
    if (global.FtthLab && typeof FtthLab.fiberAttenuationDbPerKm === 'function') {
      return FtthLab.fiberAttenuationDbPerKm(wavelengthNm);
    }
    if (global.FtthLab && typeof FtthLab.fiberSpanLossDb === 'function') {
      return FtthLab.fiberSpanLossDb(1000, wavelengthNm);
    }
    return 0.2;
  }

  function labFiberSpanLossDb(lengthM, wavelengthNm) {
    if (global.FtthLab && typeof FtthLab.fiberSpanLossDb === 'function') {
      return FtthLab.fiberSpanLossDb(lengthM, wavelengthNm);
    }
    return (Math.max(0, lengthM) / 1000) * labFiberAttenuationDbKm(wavelengthNm);
  }

  /** OTDR trace slope — aligned with FtthLab.fiberAttenuationDbPerKm (0.20 dB/km @ 1550). */
  function getOtdrFiberAttenuationDbKm() {
    return roundTrace3(labFiberAttenuationDbKm(parseOtdrWavelengthNm()));
  }

  function worldPxToMetersForOtdr(px) {
    var n = Number(px);
    if (!isFinite(n) || n <= 0) return 0;
    if (global.FtthLab && typeof FtthLab.worldPxToMeters === 'function') {
      return Math.max(0, FtthLab.worldPxToMeters(n));
    }
    return Math.max(0, n / OTDR_FALLBACK_PX_PER_M);
  }

  function resolveOtdrFiberGeometryLengthM(link) {
    if (!link) return 0;
    if (global.FtthLab && typeof FtthLab.pigtailFiberLengthM === 'function') {
      var labLen = Number(FtthLab.pigtailFiberLengthM(link));
      if (isFinite(labLen) && labLen > 0) return labLen;
    }
    if (link.route && link.route.length >= 2) {
      var ri;
      var routePx = 0;
      for (ri = 1; ri < link.route.length; ri++) {
        var p0 = link.route[ri - 1];
        var p1 = link.route[ri];
        if (!p0 || !p1) continue;
        var rdx = (p1.x || 0) - (p0.x || 0);
        var rdy = (p1.y || 0) - (p0.y || 0);
        routePx += Math.sqrt(rdx * rdx + rdy * rdy);
      }
      var routeM = worldPxToMetersForOtdr(routePx);
      if (routeM > 0) return routeM;
    }
    if (typeof link.fixedLength === 'number' && isFinite(link.fixedLength) && link.fixedLength > 0) {
      return worldPxToMetersForOtdr(link.fixedLength);
    }
    if (typeof link.ax === 'number' && typeof link.bx === 'number') {
      var dx = link.bx - link.ax;
      var dy = (typeof link.by === 'number' ? link.by : 0) - (typeof link.ay === 'number' ? link.ay : 0);
      return worldPxToMetersForOtdr(Math.sqrt(dx * dx + dy * dy));
    }
    return 0;
  }

  function cableEndpointKey(cableId, end) {
    return 'cable:' + cableId + ':' + (end === 'start' ? 'start' : 'end');
  }

  function portKeyFromFiberSnap(att) {
    if (!att || !att.owner) return null;
    if (att.owner === 'olt') {
      return 'olt:' + att.slot + ':' + att.oltPort;
    }
    if (att.owner === 'splitter') {
      return 'spl:' + att.splitterId + ':' + att.port;
    }
    if (att.owner === 'coupler') {
      var face = (att.port === 'B' || att.port === 'b' || att.port === '2') ? 'B' : 'A';
      return 'cpl:' + att.couplerId + ':' + face;
    }
    if (att.owner === 'vfl') return 'vfl:' + att.vflId;
    if (att.owner === 'opm') return 'opm:' + att.opmId;
    if (att.owner === 'ols') return 'ols:' + att.olsId;
    return null;
  }

  function couplerOppositeKey(key) {
    var m = /^cpl:([^:]+):([AB])$/.exec(key || '');
    if (!m) return null;
    return 'cpl:' + m[1] + ':' + (m[2] === 'A' ? 'B' : 'A');
  }

  function findPigtailInGraph(graph, id) {
    var pts = graph.pigtails || [];
    var i;
    for (i = 0; i < pts.length; i++) {
      if (pts[i].id === id) return pts[i];
    }
    return null;
  }

  function resolveOtdrFiberLengthM(link) {
    if (!link) return 0;
    var cableLength = link.cableLength != null ? Number(link.cableLength) : NaN;
    if (isFinite(cableLength) && cableLength > 0) {
      var unit = link.lengthUnit === 'km' ? 'km' : 'm';
      return Math.max(0, unit === 'km' ? cableLength * 1000 : cableLength);
    }
    if (typeof link.otdrCableLengthM === 'number' && isFinite(link.otdrCableLengthM) && link.otdrCableLengthM > 0) {
      return Math.max(0, link.otdrCableLengthM);
    }
    if (typeof link.lengthMeters === 'number' && isFinite(link.lengthMeters) && link.lengthMeters > 0) {
      return Math.max(0, link.lengthMeters);
    }
    var fiberLen = Number(link.fiberLengthM);
    if (isFinite(fiberLen) && fiberLen > 0) return fiberLen;
    return resolveOtdrFiberGeometryLengthM(link);
  }

  function readComponentLossDb(component, fallback) {
    if (!component) return fallback;
    if (typeof component.loss === 'number' && isFinite(component.loss)) return component.loss;
    if (typeof component.lossDb === 'number' && isFinite(component.lossDb)) return component.lossDb;
    if (typeof component.spliceLossDb === 'number' && isFinite(component.spliceLossDb)) {
      return component.spliceLossDb;
    }
    return fallback;
  }

  function readComponentReflectanceDb(component, fallback) {
    if (!component) return fallback;
    if (typeof component.reflectance === 'number' && isFinite(component.reflectance)) {
      return component.reflectance;
    }
    if (typeof component.reflectanceDb === 'number' && isFinite(component.reflectanceDb)) {
      return component.reflectanceDb;
    }
    if (typeof component.reflect === 'number' && isFinite(component.reflect)) return component.reflect;
    return fallback;
  }

  function findPcordInGraph(graph, id) {
    var pcords = (graph && graph.pcords) || [];
    var i;
    for (i = 0; i < pcords.length; i++) {
      if (pcords[i].id === id) return pcords[i];
    }
    return null;
  }

  function getPcordSideAtKey(pcord, key) {
    if (!pcord || !key) return null;
    var ka = portKeyFromFiberSnap(pcord.sideA);
    var kb = portKeyFromFiberSnap(pcord.sideB);
    if (ka === key) return pcord.sideA;
    if (kb === key) return pcord.sideB;
    return null;
  }

  function normalizeOtdrPolish(value) {
    var s = String(value || '').toUpperCase();
    if (s === 'APC' || s === 'SC/APC' || s === 'SCAPC' || s === 'GREEN') return 'APC';
    if (s === 'PC' || s === 'UPC' || s === 'SC/PC' || s === 'BLUE') return 'UPC';
    return 'UPC';
  }

  function readPolishDescriptor(source) {
    if (!source) return null;
    if (source.connectorType != null) return source.connectorType;
    if (source.color != null) return source.color;
    if (source.polish != null) return source.polish;
    if (source.portType != null) return source.portType;
    if (source.type != null) return source.type;
    return null;
  }

  function readCableConnectorPolish(incomingSide, component) {
    var sources = [];
    if (component) sources.push(component);
    if (incomingSide) sources.push(incomingSide);
    var si;
    for (si = 0; si < sources.length; si++) {
      var descriptor = readPolishDescriptor(sources[si]);
      if (descriptor != null) return descriptor;
    }
    return null;
  }

  function readCouplerReceivingPortPolish(couplerId, couplerPortKey, incomingSide, component) {
    var portFace = 'A';
    if (couplerPortKey) {
      var keyMatch = /^cpl:[^:]+:([AB])$/i.exec(couplerPortKey);
      if (keyMatch) portFace = keyMatch[1].toUpperCase();
    }
    if (global.FtthLab && typeof FtthLab.getCouplerPortWorld === 'function') {
      var portWorld = FtthLab.getCouplerPortWorld(couplerId, portFace);
      if (portWorld) {
        if (portWorld.portType != null) return portWorld.portType;
        if (portWorld.color != null) return portWorld.color;
        if (portWorld.polish != null) return portWorld.polish;
      }
    }
    var attached = null;
    if (incomingSide && incomingSide.attached && incomingSide.attached.owner === 'coupler' &&
        incomingSide.attached.couplerId === couplerId) {
      attached = incomingSide.attached;
    } else if (component && component.connector && component.connector.attached &&
        component.connector.attached.owner === 'coupler' &&
        component.connector.attached.couplerId === couplerId) {
      attached = component.connector.attached;
    }
    if (attached) return readPolishDescriptor(attached);
    return null;
  }

  function readPortPolishDescriptor(incomingSide, explicitPortPolish) {
    if (explicitPortPolish != null) return explicitPortPolish;
    if (incomingSide && incomingSide.attached) {
      var fromAttached = readPolishDescriptor(incomingSide.attached);
      if (fromAttached != null) return fromAttached;
    }
    return null;
  }

  function detectPolishMismatchBetween(cableDescriptor, portDescriptor) {
    var leftType = (cableDescriptor != null ? String(cableDescriptor) : 'blue').toLowerCase();
    var rightType = (portDescriptor != null ? String(portDescriptor) : 'blue').toLowerCase();
    var isLeftAPC = leftType.indexOf('green') >= 0 || leftType.indexOf('apc') >= 0;
    var isRightAPC = rightType.indexOf('green') >= 0 || rightType.indexOf('apc') >= 0;
    return isLeftAPC !== isRightAPC;
  }

  function syncPolishMismatchFlags(incomingSide, component, hasMismatch) {
    if (incomingSide) incomingSide.mismatch = hasMismatch;
    if (component && component.connector) component.connector.mismatch = hasMismatch;
    if (incomingSide && incomingSide.attached) incomingSide.attached.mismatch = hasMismatch;
  }

  function couplerPortKeyFromFace(couplerId, portFace) {
    var face = String(portFace || 'A').charAt(0).toUpperCase();
    if (face !== 'A' && face !== 'B') face = 'A';
    return 'cpl:' + couplerId + ':' + face;
  }

  function detectCouplerPortSideMismatch(couplerId, portFace, graph) {
    if (!couplerId || !graph) return false;
    var portKey = couplerPortKeyFromFace(couplerId, portFace);
    var fiber = findIncomingFiberAtPortKey(portKey, graph);
    if (!fiber.side && !fiber.component) return false;
    var cableDescriptor = readCableConnectorPolish(fiber.side, fiber.component);
    var portDescriptor = readCouplerReceivingPortPolish(
      couplerId,
      portKey,
      fiber.side,
      fiber.component
    );
    var hasMismatch = detectPolishMismatchBetween(cableDescriptor, portDescriptor);
    syncPolishMismatchFlags(fiber.side, fiber.component, hasMismatch);
    return hasMismatch;
  }

  function evaluateCouplerDualSidePolish(couplerId, graph) {
    var leftMismatch = detectCouplerPortSideMismatch(couplerId, 'A', graph);
    var rightMismatch = detectCouplerPortSideMismatch(couplerId, 'B', graph);
    return leftMismatch || rightMismatch;
  }

  function detectConnectionPolishMismatch(incomingSide, component, explicitPortPolish, couplerId, couplerPortKey) {
    var cableDescriptor = readCableConnectorPolish(incomingSide, component);
    var portDescriptor = couplerId
      ? readCouplerReceivingPortPolish(couplerId, couplerPortKey, incomingSide, component)
      : readPortPolishDescriptor(incomingSide, explicitPortPolish);
    var hasMismatch = detectPolishMismatchBetween(cableDescriptor, portDescriptor);
    syncPolishMismatchFlags(incomingSide, component, hasMismatch);
    return hasMismatch;
  }

  function healthyMatedConnectionLossDb() {
    return roundTrace3(Math.random() * 0.15 + 0.10);
  }

  function evaluateMatedConnectorPolish(cablePolishRaw, portPolishRaw, incomingSide, component, couplerId, couplerPortKey) {
    var hasMismatch = couplerId
      ? detectConnectionPolishMismatch(incomingSide, component, null, couplerId, couplerPortKey)
      : detectConnectionPolishMismatch(incomingSide, component, portPolishRaw);
    if (hasMismatch) {
      return {
        loss: roundTrace3(Math.random() * 1.5 + 3.5),
        reflectance: -14.0,
        mismatch: true,
        polishMismatch: true,
      };
    }
    var matchedPolish = normalizeOtdrPolish(portPolishRaw || cablePolishRaw || 'UPC');
    return {
      loss: healthyMatedConnectionLossDb(),
      reflectance: matchedPolish === 'APC' ? -65.0 : -45.0,
      mismatch: false,
      polishMismatch: false,
    };
  }

  function resolveConnectorEventOptics(side, component) {
    var portPolishRaw = null;
    if (side && side.attached) portPolishRaw = readPolishDescriptor(side.attached);
    if (portPolishRaw == null && component && component.connector && component.connector.attached) {
      portPolishRaw = readPolishDescriptor(component.connector.attached);
    }
    var cablePolishRaw = readCableConnectorPolish(side, component);
    return evaluateMatedConnectorPolish(cablePolishRaw, portPolishRaw, side, component);
  }

  function resolveCouplerPassOptics(couplerId, incomingSide, couplerPortKey, component, graph) {
    var hasAnyMismatch = evaluateCouplerDualSidePolish(couplerId, graph);
    if (!hasAnyMismatch && (incomingSide || component)) {
      hasAnyMismatch = detectConnectionPolishMismatch(
        incomingSide,
        component,
        null,
        couplerId,
        couplerPortKey
      );
    }
    if (hasAnyMismatch) {
      return {
        loss: roundTrace3(Math.random() * 1.5 + 3.5),
        reflectance: -14.0,
        mismatch: true,
        polishMismatch: true,
      };
    }
    var portPolishRaw = readCouplerReceivingPortPolish(
      couplerId,
      couplerPortKey,
      incomingSide,
      component
    );
    var cablePolishRaw = readCableConnectorPolish(incomingSide, component);
    var matchedPolish = normalizeOtdrPolish(portPolishRaw || cablePolishRaw || 'UPC');
    return {
      loss: healthyMatedConnectionLossDb(),
      reflectance: matchedPolish === 'APC' ? -65.0 : -45.0,
      mismatch: false,
      polishMismatch: false,
    };
  }

  function findIncomingFiberAtPortKey(portKey, graph) {
    if (!portKey || !graph) return { side: null, component: null };
    var pigtails = graph.pigtails || [];
    var pi;
    var cplMatch = /^cpl:([^:]+):([AB])$/i.exec(portKey);
    for (pi = 0; pi < pigtails.length; pi++) {
      var pigtail = pigtails[pi];
      if (portKeyFromFiberSnap(pigtail.connector) === portKey) {
        return { side: pigtail.connector || null, component: pigtail };
      }
      if (cplMatch && pigtail.connector && pigtail.connector.attached &&
          pigtail.connector.attached.owner === 'coupler' &&
          pigtail.connector.attached.couplerId === cplMatch[1]) {
        var attachedPort = String(pigtail.connector.attached.port || 'A').toUpperCase();
        if (attachedPort.charAt(0) === cplMatch[2].toUpperCase()) {
          return { side: pigtail.connector || null, component: pigtail };
        }
      }
    }
    var pcords = graph.pcords || [];
    var ci;
    for (ci = 0; ci < pcords.length; ci++) {
      var pc = pcords[ci];
      var ka = portKeyFromFiberSnap(pc.sideA);
      var kb = portKeyFromFiberSnap(pc.sideB);
      if (ka === portKey) return { side: pc.sideA || null, component: pc };
      if (kb === portKey) return { side: pc.sideB || null, component: pc };
    }
    return { side: null, component: null };
  }

  function lookupCouplerPassLossDb(couplerId) {
    if (global.FtthLab && typeof FtthLab.getCouplerPassLossDb === 'function') {
      var n = Number(FtthLab.getCouplerPassLossDb(couplerId));
      if (isFinite(n)) return n;
    }
    return OTDR_COUPLER_PASS_DB;
  }

  function findSplitterById(splitterId) {
    if (global.FtthLab && typeof FtthLab.getOpticalSplitters === 'function') {
      var splitters = FtthLab.getOpticalSplitters() || [];
      var i;
      for (i = 0; i < splitters.length; i++) {
        if (splitters[i].id === splitterId) return splitters[i];
      }
    }
    return null;
  }

  function fusionPairMatchesLookup(pair, assemblyId, endpointKey, memberId) {
    if (!pair) return false;
    if (assemblyId && (pair.assemblyId === assemblyId || pair.fusionAssemblyId === assemblyId)) {
      return true;
    }
    if (endpointKey && (pair.leftKey === endpointKey || pair.rightKey === endpointKey)) {
      return true;
    }
    if (memberId && (pair.leftId === memberId || pair.rightId === memberId)) {
      if (!endpointKey) return true;
      if (pair.leftKey === endpointKey || pair.rightKey === endpointKey) return true;
    }
    return false;
  }

  function readFusionPairSpliceLossDb(pair) {
    if (!pair) return null;
    if (typeof pair.spliceLossDb === 'number' && isFinite(pair.spliceLossDb)) {
      return pair.spliceLossDb;
    }
    if (typeof pair.loss === 'number' && isFinite(pair.loss)) {
      return pair.loss;
    }
    return null;
  }

  function lookupFusionSpliceLoss(assemblyId, member, opts) {
    opts = opts || {};
    var endpointKey = opts.endpointKey || null;
    var memberId = member && member.id ? member.id : null;

    if (member) {
      var memberLoss = readComponentLossDb(member, null);
      if (memberLoss != null) return memberLoss;
    }

    if (global.FtthLab && typeof FtthLab.getFusedAssemblyOpticalPairs === 'function') {
      var pairs = FtthLab.getFusedAssemblyOpticalPairs() || [];
      var i;
      for (i = 0; i < pairs.length; i++) {
        var pair = pairs[i];
        if (!fusionPairMatchesLookup(pair, assemblyId, endpointKey, memberId)) continue;
        var exactLoss = readFusionPairSpliceLossDb(pair);
        if (exactLoss != null) return exactLoss;
      }
    }

    return OTDR_FUSION_SPLICE_DB;
  }

  function getMockFiberEventsSeven() {
    return [
      { id: 1, distance: 0, type: 'start', loss: 0.0, reflect: -45.0 },
      { id: 2, distance: 500, type: 'connector', loss: 0.5, reflect: -35.0 },
      { id: 3, distance: 1000, type: 'splice', loss: 0.1, reflect: 0 },
      { id: 4, distance: 1500, type: 'connector', loss: 0.4, reflect: -40.0 },
      { id: 5, distance: 2000, type: 'splice', loss: 0.2, reflect: 0 },
      { id: 6, distance: 2500, type: 'connector', loss: 0.6, reflect: -30.0 },
      { id: 7, distance: 3000, type: 'splitter', loss: 3.5, reflect: -45.0 },
    ];
  }

  function traceEventLabelFromType(type) {
    if (type === 'start') return 'OTDR Port';
    if (type === 'connector' || type === 'reflective') return 'Connector';
    if (type === 'splice') return 'Splice';
    if (type === 'bend') return 'Bend';
    if (type === 'splitter') return 'Splitter';
    if (type === 'end') return 'End of fiber';
    return 'Event';
  }

  function findBendJigSlotForPcord(pcord) {
    if (!pcord || !pcord.bendJigId) return null;
    if (!global.FtthLab || typeof FtthLab.listBendJigSlots !== 'function') return null;
    var slots = FtthLab.listBendJigSlots();
    var i;
    var matched = null;
    for (i = 0; i < slots.length; i++) {
      var slot = slots[i];
      if (slot.id !== pcord.bendJigId) continue;
      matched = slot;
      if (!slot.isCableDocked) continue;
      if (slot.dockedCordId && slot.dockedCordId !== pcord.id) continue;
      return slot;
    }
    return matched;
  }

  function findBendComponentOnGraphForLink(graph, linkId) {
    if (!graph || !linkId) return null;
    var lists = [graph.bends, graph.bendComponents, graph.components];
    var li;
    var bi;
    for (li = 0; li < lists.length; li++) {
      var list = lists[li];
      if (!list || !list.length) continue;
      for (bi = 0; bi < list.length; bi++) {
        var comp = list[bi];
        if (!comp) continue;
        var compType = comp.type || comp.componentType;
        if (compType !== 'bend' && compType !== 'micro-bend') continue;
        if (comp.pcordId === linkId || comp.linkId === linkId || comp.id === linkId) {
          return {
            type: compType,
            angle: comp.angle != null ? comp.angle : (comp.theta != null ? comp.theta : 90),
          };
        }
      }
    }
    return null;
  }

  function resolveBendComponentOnLink(link, graph) {
    if (!link) return null;
    if (link.type === 'bend' || link.type === 'micro-bend') {
      return {
        type: link.type,
        angle: link.angle != null ? link.angle : (link.theta != null ? link.theta : 90),
      };
    }
    if (link.bendAngle != null || link.theta != null) {
      return {
        type: 'micro-bend',
        angle: link.bendAngle != null ? link.bendAngle : link.theta,
      };
    }
    if (link.bendComponent && (link.bendComponent.type === 'bend' || link.bendComponent.type === 'micro-bend')) {
      return {
        type: link.bendComponent.type,
        angle: link.bendComponent.angle != null ? link.bendComponent.angle : 90,
      };
    }
    var graphBend = findBendComponentOnGraphForLink(graph, link.id);
    if (graphBend) return graphBend;
    var jigSlot = findBendJigSlotForPcord(link);
    if (jigSlot) {
      return { type: 'micro-bend', angle: jigSlot.theta };
    }
    return null;
  }

  function computeOtdrMicroBendLossDb(angle) {
    var deg = Number(angle);
    if (!isFinite(deg)) deg = 90;
    if (deg >= 90) return 0;
    return parseFloat(((90 - deg) * 0.03 + 0.05).toFixed(3));
  }

  function normalizeMockEventType(type, label) {
    if (type === 'reflective') {
      if (label === 'End' || label === 'Open Tail' || label === 'End of fiber') return 'end';
      if (label === 'Splitter' || label === 'End Splitter') return 'splitter';
      return 'connector';
    }
    return type || 'connector';
  }

  function getViaviFiberSlopeDbKm() {
    return getOtdrFiberAttenuationDbKm();
  }

  /**
   * VIAVI traversal engine: Section km, Slope dB/km, T.Loss dB.
   * T.Loss(N) = Parent T.Loss + Parent Loss dB + (Section km × Slope).
   * Current-event Loss dB is excluded from its own T.Loss (carried to the next event).
   */
  function computeViaviTraversalMetrics(parentDistM, parentTLossDb, parentLossDb, currentDistM, fiberSlopeDbKm) {
    var sectionM = Math.max(0, Number(currentDistM) - Number(parentDistM));
    var sectionKm = roundTrace3(sectionM / 1000);
    var slopeDbKm = typeof fiberSlopeDbKm === 'number' && isFinite(fiberSlopeDbKm)
      ? fiberSlopeDbKm
      : getViaviFiberSlopeDbKm();
    var displaySlope = sectionKm < VIAVI_MIN_SECTION_KM_FOR_SLOPE ? null : slopeDbKm;
    var fiberAttenLoss = sectionKm * slopeDbKm;
    var parentLoss = typeof parentLossDb === 'number' && isFinite(parentLossDb) ? parentLossDb : 0;
    var parentTLoss = typeof parentTLossDb === 'number' && isFinite(parentTLossDb) ? parentTLossDb : 0;
    var tLoss = roundTrace3(parentTLoss + parentLoss + fiberAttenLoss);
    return {
      sectionM: roundTrace3(sectionM),
      sectionKm: sectionKm,
      sectionAtt: displaySlope,
      tLoss: tLoss,
    };
  }

  function applyViaviOtdrEventMetrics(events) {
    if (!events || !events.length) return 0;
    var allPathComputed = true;
    var checkIdx;
    for (checkIdx = 0; checkIdx < events.length; checkIdx++) {
      if (!events[checkIdx]._pathComputed) {
        allPathComputed = false;
        break;
      }
    }
    if (allPathComputed) return computeMaxBranchEndpointLoss(events);

    var slope = getViaviFiberSlopeDbKm();
    var prevDistance = 0;
    var prevTLoss = 0;
    var prevEventLoss = 0;
    var i;

    for (i = 0; i < events.length; i++) {
      var ev = events[i];
      if (ev._pathComputed) continue;
      var currentDistance = typeof ev.distance === 'number' ? ev.distance : 0;

      if (i === 0) {
        ev.distance = 0;
        ev.loss = null;
        ev.reflect = ev._reflectance != null ? ev._reflectance : OTDR_LAUNCH_REFLECT_DB;
        ev.sectionAtt = null;
        ev.sectionM = 0;
        ev.sectionKm = 0;
        ev.tLoss = 0;
        ev.totalLoss = 0;
        prevDistance = 0;
        prevTLoss = 0;
        prevEventLoss = 0;
        continue;
      }

      var insertionLoss = 0;
      if (ev._insertionLoss != null && isFinite(ev._insertionLoss)) {
        insertionLoss = ev._insertionLoss;
      }

      var viaviMetrics = computeViaviTraversalMetrics(
        prevDistance,
        prevTLoss,
        prevEventLoss,
        currentDistance,
        slope
      );
      ev.sectionM = viaviMetrics.sectionM;
      ev.sectionKm = viaviMetrics.sectionKm;
      ev.sectionAtt = viaviMetrics.sectionAtt;
      ev.tLoss = viaviMetrics.tLoss;
      ev.totalLoss = ev.tLoss;
      ev.loss = insertionLoss > 0 ? insertionLoss : null;

      if (ev.type === 'splice') {
        ev.reflect = null;
      } else if (ev._reflectance != null && isFinite(ev._reflectance)) {
        ev.reflect = ev._reflectance;
      } else {
        ev.reflect = null;
      }

      prevDistance = currentDistance;
      prevTLoss = ev.tLoss;
      prevEventLoss = insertionLoss;
    }

    var last = events[events.length - 1];
    var lastInsertion = 0;
    if (last._insertionLoss != null && isFinite(last._insertionLoss)) {
      lastInsertion = last._insertionLoss;
    }
    return roundTrace3((last.tLoss || 0) + lastInsertion);
  }

  function computeMockFinalTotalLoss(mockEvents) {
    return applyViaviOtdrEventMetrics(buildTraceTableEventsFromMock(mockEvents));
  }

  function buildTraceTableEventsFromMock(mockEvents) {
    var rows = [];
    var i;
    var maxDist = 3000;
    for (i = 0; i < mockEvents.length; i++) {
      var m = mockEvents[i];
      var evType = normalizeMockEventType(m.type, traceEventLabelFromType(m.type));
      var row = {
        eventNum: m.id != null ? m.id : (i + 1),
        event: String(m.id != null ? m.id : (i + 1)),
        type: evType,
        label: traceEventLabelFromType(m.type),
        distance: i === 0 ? 0 : m.distance,
        linearPos: i === 0
          ? 0.02
          : Math.min(0.99, Math.max(0.02, m.distance / maxDist)),
      };
      if (i > 0) {
        row._insertionLoss = m.loss || 0;
        row._reflectance = m.reflect;
      } else if (m.reflect != null) {
        row._reflectance = m.reflect;
      }
      rows.push(row);
    }
    applyViaviOtdrEventMetrics(rows);
    return rows;
  }

  function syncMockFiberEventsFromTrace(events, totalLengthM) {
    if (!events || !events.length) {
      mockFiberEvents = getMockFiberEventsSeven();
      return;
    }
    var mock = [];
    var i;
    for (i = 0; i < events.length; i++) {
      var ev = events[i];
      mock.push({
        id: ev.eventNum != null ? ev.eventNum : (i + 1),
        distance: ev.distance,
        type: normalizeMockEventType(ev.type, ev.label),
        loss: ev._insertionLoss != null ? ev._insertionLoss : (ev.loss || 0),
        reflect: ev._reflectance != null ? ev._reflectance
          : (ev.reflect != null ? ev.reflect : 0),
      });
    }
    mockFiberEvents = mock;
  }

  function getSplitterLossDb(splitterId) {
    var splitter = findSplitterById(splitterId);
    if (splitter) return readComponentLossDb(splitter, 3.5);
    return 3.5;
  }

  function getSplitterReflectanceDb(splitterId) {
    var splitter = findSplitterById(splitterId);
    return readComponentReflectanceDb(splitter, -45);
  }

  function isPortKeyConnected(portKey, graph) {
    return !!findFiberStepFromPort(portKey, graph, {}, {});
  }

  function isSplitterInputPortKey(key) {
    if (!key || key.indexOf('spl:') !== 0) return false;
    var portId = (key.split(':')[2] || '');
    return portId.indexOf('IN') === 0;
  }

  function splitterIdFromPortKey(key) {
    var parts = (key || '').split(':');
    return parts.length >= 2 ? parts[1] : null;
  }

  function compareBranchPaths(pathA, pathB) {
    var a = pathA || '0';
    var b = pathB || '0';
    if (a === b) return 0;
    return a.localeCompare(b, undefined, { numeric: true });
  }

  function traceEventPhysicalSortRank(ev) {
    if (!ev) return 99;
    if (ev.type === 'start') return 0;
    if (ev.type === 'splitter' && ev.label === 'End Splitter') return 50;
    if (ev.type === 'splitter') return 10;
    if (ev.type === 'splice') return 20;
    if (ev.type === 'bend') return 22;
    if (ev.type === 'connector') return 30;
    if (ev.type === 'end') return 60;
    return 40;
  }

  function shouldEmitConnectorAtPort(exitKey, graph, visitedPc, visitedPt, fromSplitterBranch) {
    if (!exitKey) return false;
    if (exitKey.indexOf('cpl:') === 0) return true;
    if (isSplitterInputPortKey(exitKey) || exitKey.indexOf('spl:') === 0) return false;
    var nextStep = findFiberStepFromPort(exitKey, graph, visitedPc || {}, visitedPt || {});
    if (nextStep && (nextStep.kind === 'pigtail' || nextStep.kind === 'cable')) return false;
    if (fromSplitterBranch) return false;
    return true;
  }

  function finalizeTraceEventOrdering(eventList) {
    if (!eventList || !eventList.length) return;
    eventList.sort(function (a, b) {
      var pathCmp = compareBranchPaths(a.branchPath, b.branchPath);
      if (pathCmp !== 0) return pathCmp;
      var da = typeof a.distance === 'number' ? a.distance : 0;
      var db = typeof b.distance === 'number' ? b.distance : 0;
      if (da !== db) return da - db;
      var rankDiff = traceEventPhysicalSortRank(a) - traceEventPhysicalSortRank(b);
      if (rankDiff !== 0) return rankDiff;
      return (a._traversalSeq || 0) - (b._traversalSeq || 0);
    });
    var idx;
    for (idx = 0; idx < eventList.length; idx++) {
      eventList[idx].eventNum = idx + 1;
      eventList[idx].event = String(idx + 1);
    }
  }

  function shallowCopyObj(obj) {
    var copy = {};
    var k;
    for (k in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) copy[k] = obj[k];
    }
    return copy;
  }

  function cloneBranchTraversalState(src) {
    return {
      pc: shallowCopyObj(src.pc),
      pt: shallowCopyObj(src.pt),
      couplers: shallowCopyObj(src.couplers),
      fusedSeen: shallowCopyObj(src.fusedSeen),
      distanceM: src.distanceM,
      lastTraversedSpanM: src.lastTraversedSpanM,
      lastConnectorSide: src.lastConnectorSide,
      lastConnectorComponent: src.lastConnectorComponent,
      lastEventDistanceM: src.lastEventDistanceM,
      tLossDb: src.tLossDb,
      lastInsertionLoss: src.lastInsertionLoss,
      fromSplitterBranch: !!src.fromSplitterBranch,
      branchPath: src.branchPath || '0',
    };
  }

  function branchSnapshotAtSplitter(branchState) {
    return {
      distanceM: branchState.distanceM,
      tLossDb: branchState.tLossDb,
      lastEventDistanceM: branchState.lastEventDistanceM,
      lastInsertionLoss: branchState.lastInsertionLoss,
    };
  }

  function applyBranchSnapshotToState(branchState, snapshot) {
    branchState.distanceM = snapshot.distanceM;
    branchState.tLossDb = snapshot.tLossDb;
    branchState.lastEventDistanceM = snapshot.lastEventDistanceM;
    branchState.lastInsertionLoss = snapshot.lastInsertionLoss;
    branchState.lastTraversedSpanM = 0;
  }

  function computeMaxBranchEndpointLoss(events) {
    var max = 0;
    var i;
    for (i = 0; i < events.length; i++) {
      var ev = events[i];
      if (ev.type !== 'end') continue;
      var ins = 0;
      if (ev._insertionLoss != null && isFinite(ev._insertionLoss)) ins = ev._insertionLoss;
      var total = (ev.tLoss || 0) + ins;
      if (total > max) max = total;
    }
    if (!max && events.length) {
      var last = events[events.length - 1];
      var lastIns = 0;
      if (last._insertionLoss != null && isFinite(last._insertionLoss)) lastIns = last._insertionLoss;
      max = (last.tLoss || 0) + lastIns;
    }
    return roundTrace3(max);
  }

  function isCableGraphNode(member) {
    return !!(member && member.type === 'cable');
  }

  function oppositeCableMemberEnd(end) {
    return end === 'start' ? 'end' : 'start';
  }

  function parseCableEndpointKey(key) {
    var m = /^cable:([^:]+):(start|end)$/.exec(key || '');
    if (!m) return null;
    return { id: m[1], end: m[2] };
  }

  function cablePartnerAtMemberEnd(cable, end) {
    if (!cable || !isCableGraphNode(cable)) return null;
    if (end === 'start') return cable.startFusedPartnerId || null;
    return cable.endFusedPartnerId || cable.fusedPartnerId || null;
  }

  function cableFusionAssemblyAtMemberEnd(cable, end) {
    if (!cable || !isCableGraphNode(cable)) return null;
    if (end === 'start') return cable.startFusionAssemblyId || null;
    return cable.endFusionAssemblyId || cable.fusionAssemblyId || null;
  }

  function resolveFusionPartnerEntryEnd(partner, fromMemberId) {
    if (!partner || !fromMemberId) return null;
    if (isCableGraphNode(partner)) {
      if (partner.startFusedPartnerId === fromMemberId) return 'start';
      if (partner.endFusedPartnerId === fromMemberId) return 'end';
      if (partner.fusedPartnerId === fromMemberId) return 'end';
      return null;
    }
    if (partner.fusedPartnerId === fromMemberId) return 'tail';
    return 'tail';
  }

  function findFiberStepFromPort(currentKey, graph, visitedPc, visitedPt) {
    if (!currentKey) return null;
    var pcords = graph.pcords || [];
    var ci;
    for (ci = 0; ci < pcords.length; ci++) {
      var c = pcords[ci];
      if (visitedPc[c.id]) continue;
      var ka = portKeyFromFiberSnap(c.sideA);
      var kb = portKeyFromFiberSnap(c.sideB);
      var exitKey = null;
      var openEnd = false;
      if (ka === currentKey) {
        exitKey = kb;
        if (!exitKey && c.freeB) openEnd = true;
      } else if (kb === currentKey) {
        exitKey = ka;
        if (!exitKey && c.freeA) openEnd = true;
      }
      if (!exitKey && !openEnd) continue;
      var exitSide = exitKey ? getPcordSideAtKey(c, exitKey) : null;
      if (openEnd && !exitSide) {
        if (ka === currentKey && c.freeB) exitSide = c.sideB;
        else if (kb === currentKey && c.freeA) exitSide = c.sideA;
      }
      return {
        kind: 'pcord',
        linkId: c.id,
        pcord: c,
        lengthM: resolveOtdrFiberLengthM(c),
        exitKey: exitKey,
        exitSide: exitSide,
        openEnd: openEnd,
      };
    }

    var pigtails = graph.pigtails || [];
    var pi;
    for (pi = 0; pi < pigtails.length; pi++) {
      var p = pigtails[pi];
      if (visitedPt[p.id]) continue;
      var pk = portKeyFromFiberSnap(p.connector);
      if (pk !== currentKey) continue;
      return {
        kind: 'pigtail',
        linkId: p.id,
        lengthM: resolveOtdrFiberLengthM(p),
        pigtail: p,
      };
    }

    var cableMatch = parseCableEndpointKey(currentKey);
    if (cableMatch) {
      var cableNode = findPigtailInGraph(graph, cableMatch.id);
      if (cableNode && isCableGraphNode(cableNode) && !visitedPt[cableNode.id]) {
        return {
          kind: 'cable',
          linkId: cableNode.id,
          cable: cableNode,
          entryEnd: cableMatch.end,
          lengthM: resolveOtdrFiberLengthM(cableNode),
        };
      }
    }
    return null;
  }

  function applyCumulativeDistancesToEvents(events, linearPosFn) {
    if (!events || !events.length) return 0;
    events[0].distance = 0;
    events[0].sectionM = null;
    var cum = 0;
    var i;
    for (i = 1; i < events.length; i++) {
      var span = events[i]._spanLengthM;
      if (typeof span === 'number' && isFinite(span) && span > 0) {
        cum += span;
      }
      events[i].distance = roundTrace3(cum);
      events[i].sectionM = (typeof span === 'number' && span > 0) ? roundTrace3(span) : null;
      if (linearPosFn) events[i].linearPos = linearPosFn(cum);
    }
    return roundTrace3(cum);
  }

  function buildDynamicOtdrEvents(deviceId, graph) {
    var currentKey = getOtdrPortProbeKey(deviceId);
    var fiberLossTotal = 0;
    var connectorLossTotal = 0;
    var spliceLossTotal = 0;
    var bendLossTotal = 0;
    var events = [];
    var maxTraceM = 50000;
    traceEventCounter = 1;

    function linearPos(atM) {
      return Math.min(0.99, Math.max(0.02, atM / Math.max(atM + 100, 2500)));
    }

    function makeBranchState() {
      return {
        pc: {},
        pt: {},
        couplers: {},
        fusedSeen: {},
        distanceM: 0,
        lastTraversedSpanM: 0,
        lastConnectorSide: null,
        lastConnectorComponent: null,
        lastEventDistanceM: 0,
        tLossDb: 0,
        lastInsertionLoss: 0,
        fromSplitterBranch: false,
        branchPath: '0',
      };
    }

    function pushTraceEvent(type, label, insertionLossAfter, internalOpts, branchState) {
      internalOpts = internalOpts || {};
      var traversalSeq = traceEventCounter;
      traceEventCounter += 1;
      var spanM = type === 'start' ? 0 : branchState.lastTraversedSpanM;
      var distM = type === 'start' ? 0 : roundTrace3(branchState.distanceM);
      var insertionLoss = 0;
      if (typeof insertionLossAfter === 'number' && isFinite(insertionLossAfter)) {
        insertionLoss = insertionLossAfter;
      }
      var row = {
        eventNum: traversalSeq,
        event: String(traversalSeq),
        _traversalSeq: traversalSeq,
        type: type,
        label: label,
        distance: distM,
        linearPos: linearPos(distM),
        _spanLengthM: spanM > 0 ? spanM : 0,
        _pathComputed: true,
        branchPath: branchState.branchPath || '0',
      };
      if (internalOpts.reflectance != null) row._reflectance = internalOpts.reflectance;
      if (internalOpts.icon) row.icon = internalOpts.icon;
      if (internalOpts.polishMismatch) {
        row._polishMismatch = true;
        row._alarm = true;
      }
      if (insertionLoss > 0) row._insertionLoss = insertionLoss;

      if (type === 'start') {
        row.loss = null;
        row.reflect = row._reflectance != null ? row._reflectance : OTDR_LAUNCH_REFLECT_DB;
        row.sectionAtt = null;
        row.sectionM = 0;
        row.sectionKm = 0;
        row.tLoss = 0;
        row.totalLoss = 0;
        branchState.lastEventDistanceM = 0;
        branchState.tLossDb = 0;
        branchState.lastInsertionLoss = 0;
      } else {
        var viaviMetrics = computeViaviTraversalMetrics(
          branchState.lastEventDistanceM,
          branchState.tLossDb,
          branchState.lastInsertionLoss,
          distM,
          getViaviFiberSlopeDbKm()
        );
        row.sectionM = viaviMetrics.sectionM;
        row.sectionKm = viaviMetrics.sectionKm;
        row.sectionAtt = viaviMetrics.sectionAtt;
        row.tLoss = viaviMetrics.tLoss;
        row.totalLoss = row.tLoss;
        row.loss = insertionLoss > 0 ? insertionLoss : null;
        if (type === 'splice') {
          row.reflect = null;
        } else if (type === 'bend') {
          row.reflect = '--';
          row.icon = row.icon || 'bend';
        } else if (row._reflectance != null && isFinite(row._reflectance)) {
          row.reflect = row._reflectance;
        } else {
          row.reflect = null;
        }
        branchState.tLossDb = row.tLoss;
        branchState.lastEventDistanceM = distM;
        branchState.lastInsertionLoss = insertionLoss;
      }

      events.push(row);
      branchState.lastTraversedSpanM = 0;
    }

    function traverseFiberSpan(lengthM, branchState) {
      var span = Math.max(0, Number(lengthM) || 0);
      branchState.lastTraversedSpanM = span;
      if (span <= 0) return 0;
      branchState.distanceM += span;
      var segmentLoss = (span / 1000) * getOtdrFiberAttenuationDbKm();
      fiberLossTotal += segmentLoss;
      return segmentLoss;
    }

    function traversePigtailFiberSpan(pigtail, branchState) {
      traverseFiberSpan(resolveOtdrFiberLengthM(pigtail), branchState);
    }

    function tryEmitBendEventOnTraversedLink(link, branchState) {
      var bendComponent = resolveBendComponentOnLink(link, graph);
      if (!bendComponent) return;
      var angle = bendComponent.angle || 90;
      if (angle >= 90) return;
      var bendLoss = computeOtdrMicroBendLossDb(angle);
      if (bendLoss <= 0) return;
      bendLossTotal += bendLoss;
      pushTraceEvent('bend', 'Bend', bendLoss, { icon: 'bend' }, branchState);
    }

    function emitFusionSpliceIfNew(assemblyId, leftId, rightId, memberForLoss, branchState, opts) {
      opts = opts || {};
      var fuseKey = assemblyId || [leftId, rightId].sort().join('|');
      if (branchState.fusedSeen[fuseKey]) return;
      branchState.fusedSeen[fuseKey] = true;
      var spLoss = lookupFusionSpliceLoss(assemblyId, memberForLoss, opts);
      spliceLossTotal += spLoss;
      pushTraceEvent('splice', 'Fusion Splice', spLoss, null, branchState);
    }

    function pushOpenFiberEnd(branchState, connectorSide, component) {
      var endOptics = resolveConnectorEventOptics(connectorSide, component);
      connectorLossTotal += endOptics.loss;
      pushTraceEvent('end', 'End of fiber', endOptics.loss, {
        reflectance: endOptics.reflectance != null ? endOptics.reflectance : OTDR_FAR_REFLECT_DB,
      }, branchState);
    }

    function continueFromPigtailConnector(partner, branchState) {
      var partnerPortKey = portKeyFromFiberSnap(partner.connector);
      branchState.lastConnectorSide = partner.connector || null;
      branchState.lastConnectorComponent = partner;

      if (isSplitterInputPortKey(partnerPortKey)) {
        handleSplitterBranching(splitterIdFromPortKey(partnerPortKey), branchState);
        return null;
      }
      if (!partnerPortKey) {
        pushOpenFiberEnd(branchState, partner.connector, partner);
        return null;
      }
      if (partnerPortKey.indexOf('cpl:') === 0) {
        return pushNodeEventAtKey(partnerPortKey, branchState);
      }
      if (shouldEmitConnectorAtPort(
        partnerPortKey,
        graph,
        branchState.pc,
        branchState.pt,
        branchState.fromSplitterBranch
      )) {
        return pushNodeEventAtKey(partnerPortKey, branchState);
      }
      return partnerPortKey;
    }

    function traverseCableFromEntry(cable, entryEnd, branchState) {
      if (branchState.pt[cable.id]) {
        pushTraceEvent('end', 'End of fiber', 0, { reflectance: OTDR_FAR_REFLECT_DB }, branchState);
        return null;
      }
      branchState.pt[cable.id] = true;
      traverseFiberSpan(resolveOtdrFiberLengthM(cable), branchState);

      var exitEnd = oppositeCableMemberEnd(entryEnd);
      var nextPartnerId = cablePartnerAtMemberEnd(cable, exitEnd);
      if (nextPartnerId) {
        emitFusionSpliceIfNew(
          cableFusionAssemblyAtMemberEnd(cable, exitEnd),
          cable.id,
          nextPartnerId,
          cable,
          branchState,
          { endpointKey: cableEndpointKey(cable.id, exitEnd) }
        );
        return advanceFromFusionJoint(nextPartnerId, cable.id, branchState);
      }

      branchState.lastConnectorSide = null;
      branchState.lastConnectorComponent = cable;
      pushTraceEvent('end', 'End of fiber', 0, { reflectance: OTDR_FAR_REFLECT_DB }, branchState);
      return null;
    }

    function advanceFromFusionJoint(partnerId, fromMemberId, branchState) {
      var partner = findPigtailInGraph(graph, partnerId);
      if (!partner) {
        pushTraceEvent('end', 'End of fiber', 0, { reflectance: OTDR_FAR_REFLECT_DB }, branchState);
        return null;
      }
      if (branchState.pt[partner.id]) {
        pushTraceEvent('end', 'End of fiber', 0, { reflectance: OTDR_FAR_REFLECT_DB }, branchState);
        return null;
      }

      if (isCableGraphNode(partner)) {
        var entryEnd = resolveFusionPartnerEntryEnd(partner, fromMemberId);
        if (!entryEnd) {
          pushTraceEvent('end', 'End of fiber', 0, { reflectance: OTDR_FAR_REFLECT_DB }, branchState);
          return null;
        }
        return traverseCableFromEntry(partner, entryEnd, branchState);
      }

      branchState.pt[partner.id] = true;
      traverseFiberSpan(resolveOtdrFiberLengthM(partner), branchState);
      return continueFromPigtailConnector(partner, branchState);
    }

    function pushNodeEventAtKey(exitKey, branchState) {
      if (!exitKey) {
        var endOptics = resolveConnectorEventOptics(
          branchState.lastConnectorSide,
          branchState.lastConnectorComponent
        );
        connectorLossTotal += endOptics.loss;
        pushTraceEvent('end', 'End of fiber', endOptics.loss, {
          reflectance: endOptics.reflectance != null ? endOptics.reflectance : OTDR_FAR_REFLECT_DB,
        }, branchState);
        branchState.lastConnectorSide = null;
        branchState.lastConnectorComponent = null;
        return null;
      }

      if (exitKey.indexOf('cpl:') === 0) {
        var cplParts = exitKey.split(':');
        var couplerId = cplParts[1];
        var incomingCouplerSide = branchState.lastConnectorSide;
        var incomingCouplerComponent = branchState.lastConnectorComponent;
        if (!incomingCouplerSide) {
          var incomingFiber = findIncomingFiberAtPortKey(exitKey, graph);
          incomingCouplerSide = incomingFiber.side;
          incomingCouplerComponent = incomingFiber.component;
        }
        if (branchState.couplers[couplerId]) {
          branchState.lastConnectorSide = null;
          branchState.lastConnectorComponent = null;
          pushTraceEvent('end', 'End of fiber', 0, { reflectance: OTDR_FAR_REFLECT_DB }, branchState);
          return null;
        }
        branchState.couplers[couplerId] = true;
        var oppKey = couplerOppositeKey(exitKey);
        var couplerOptics = resolveCouplerPassOptics(
          couplerId,
          incomingCouplerSide,
          exitKey,
          incomingCouplerComponent,
          graph
        );
        branchState.lastConnectorSide = null;
        branchState.lastConnectorComponent = null;
        connectorLossTotal += couplerOptics.loss;
        pushTraceEvent('connector', 'Coupler', couplerOptics.loss, {
          reflectance: couplerOptics.reflectance,
          polishMismatch: couplerOptics.polishMismatch === true,
        }, branchState);
        return oppKey || null;
      }

      if (exitKey.indexOf('spl:') === 0) {
        branchState.lastConnectorSide = null;
        branchState.lastConnectorComponent = null;
        return exitKey;
      }

      if (!shouldEmitConnectorAtPort(
        exitKey,
        graph,
        branchState.pc,
        branchState.pt,
        branchState.fromSplitterBranch
      )) {
        branchState.lastConnectorSide = null;
        branchState.lastConnectorComponent = null;
        return exitKey;
      }

      var connectorOptics = resolveConnectorEventOptics(
        branchState.lastConnectorSide,
        branchState.lastConnectorComponent
      );
      connectorLossTotal += connectorOptics.loss;
      pushTraceEvent('connector', 'Connector', connectorOptics.loss, {
        reflectance: connectorOptics.reflectance,
        polishMismatch: connectorOptics.polishMismatch === true,
      }, branchState);
      branchState.lastConnectorSide = null;
      branchState.lastConnectorComponent = null;
      return exitKey;
    }

    function tryAdvanceSplitterInput(activeKey, branchState) {
      if (!isSplitterInputPortKey(activeKey)) return false;
      branchState.lastConnectorSide = null;
      branchState.lastConnectorComponent = null;
      handleSplitterBranching(splitterIdFromPortKey(activeKey), branchState);
      return true;
    }

    function scanSplitterOutPortsDepthFirst(splitterId, branchState) {
      var splitter = findSplitterById(splitterId);
      if (!splitter || !splitter.outputs || !splitter.outputs.length) return;

      var forkSnapshot = branchSnapshotAtSplitter(branchState);
      var parentBranchPath = branchState.branchPath || '0';
      var outPorts = splitter.outputs;
      var pi;

      for (pi = 0; pi < outPorts.length; pi++) {
        var portKey = 'spl:' + splitterId + ':' + outPorts[pi];
        if (!isPortKeyConnected(portKey, graph)) continue;

        var branchSuffix = String(pi + 1);
        var childState = cloneBranchTraversalState(branchState);
        applyBranchSnapshotToState(childState, forkSnapshot);
        childState.fromSplitterBranch = true;
        childState.branchPath = parentBranchPath + '.' + branchSuffix;
        tracePath(portKey, childState);
      }
    }

    function handleSplitterBranching(splitterId, branchState) {
      var splitterLoss = getSplitterLossDb(splitterId);
      var splitterLabel = branchState.fromSplitterBranch ? 'End Splitter' : 'Splitter';
      connectorLossTotal += splitterLoss;
      pushTraceEvent('splitter', splitterLabel, splitterLoss, {
        reflectance: getSplitterReflectanceDb(splitterId),
      }, branchState);

      scanSplitterOutPortsDepthFirst(splitterId, branchState);
    }

    function tracePath(pathKey, branchState) {
      var guard;
      var activeKey = pathKey;
      for (guard = 0; guard < 80 && activeKey && branchState.distanceM < maxTraceM; guard++) {
        var step = findFiberStepFromPort(activeKey, graph, branchState.pc, branchState.pt);
        if (!step) break;

        if (step.kind === 'pcord') {
          branchState.pc[step.linkId] = true;
          traverseFiberSpan(step.lengthM, branchState);
          tryEmitBendEventOnTraversedLink(step.pcord || findPcordInGraph(graph, step.linkId), branchState);
          branchState.lastConnectorSide = step.exitSide || null;
          branchState.lastConnectorComponent = step.pcord || findPcordInGraph(graph, step.linkId);

          if (step.openEnd || !step.exitKey) {
            pushNodeEventAtKey(null, branchState);
            return;
          }

          var exitKey = step.exitKey;
          if (exitKey.indexOf('spl:') === 0) {
            var splParts = exitKey.split(':');
            var splPortId = splParts[2] || '';
            if (splPortId.indexOf('IN') === 0) {
              branchState.lastConnectorSide = null;
              branchState.lastConnectorComponent = null;
              handleSplitterBranching(splParts[1], branchState);
              return;
            }
          }

          var cableExitStep = findFiberStepFromPort(
            exitKey,
            graph,
            branchState.pc,
            branchState.pt
          );
          if (cableExitStep && (cableExitStep.kind === 'pigtail' || cableExitStep.kind === 'cable')) {
            if (exitKey.indexOf('cpl:') === 0) {
              activeKey = pushNodeEventAtKey(exitKey, branchState);
              if (!activeKey) return;
              if (tryAdvanceSplitterInput(activeKey, branchState)) return;
              continue;
            }
            branchState.lastConnectorSide = null;
            branchState.lastConnectorComponent = null;
            activeKey = exitKey;
            continue;
          }

          activeKey = pushNodeEventAtKey(exitKey, branchState);
          if (!activeKey) return;
          if (tryAdvanceSplitterInput(activeKey, branchState)) return;
          continue;
        }

        if (step.kind === 'pigtail') {
          var p = step.pigtail;
          branchState.pt[p.id] = true;
          traversePigtailFiberSpan(p, branchState);

          if (p.fusedPartnerId) {
            emitFusionSpliceIfNew(
              p.fusionAssemblyId,
              p.id,
              p.fusedPartnerId,
              p,
              branchState,
              { endpointKey: 'pigtail:' + p.id + ':tail' }
            );
            activeKey = advanceFromFusionJoint(p.fusedPartnerId, p.id, branchState);
            if (!activeKey) return;
            if (tryAdvanceSplitterInput(activeKey, branchState)) return;
            continue;
          }

          pushOpenFiberEnd(branchState, p.connector, p);
          return;
        }

        if (step.kind === 'cable') {
          activeKey = traverseCableFromEntry(step.cable, step.entryEnd, branchState);
          if (!activeKey) return;
          if (tryAdvanceSplitterInput(activeKey, branchState)) return;
          continue;
        }
      }
    }

    var rootState = makeBranchState();
    pushTraceEvent('start', 'OTDR Port', 0, { reflectance: OTDR_LAUNCH_REFLECT_DB }, rootState);
    tracePath(currentKey, rootState);

    finalizeTraceEventOrdering(events);

    var totalLinkM = 0;
    var evIdx;
    for (evIdx = 0; evIdx < events.length; evIdx++) {
      var evDist = typeof events[evIdx].distance === 'number' ? events[evIdx].distance : 0;
      if (evDist > totalLinkM) totalLinkM = evDist;
      events[evIdx].linearPos = linearPos(evDist);
    }
    totalLinkM = roundTrace3(totalLinkM);

    var cumulativeTotalLoss = applyViaviOtdrEventMetrics(events);

    return {
      events: events,
      totalLengthM: totalLinkM,
      cumulativeTotalLoss: cumulativeTotalLoss,
      fiberLossTotal: roundTrace2(fiberLossTotal),
      spliceLossTotal: roundTrace2(spliceLossTotal),
      connectorLossTotal: roundTrace2(connectorLossTotal),
    };
  }

  function computeLabOtdrTrace(deviceId) {
    var wavelengthNm = parseOtdrWavelengthNm();
    var attCoeff = labFiberAttenuationDbKm(wavelengthNm);
    if (!isPigtailConnectedToPort(deviceId)) {
      return {
        events: [],
        totalLengthM: 0,
        totalLoss: 0,
        orl: null,
        attCoeff: attCoeff,
        disconnected: true,
      };
    }

    var graph = fiberGraph();
    var built = buildDynamicOtdrEvents(deviceId, graph);
    var events = built.events;
    var totalLengthM = built.totalLengthM;
    var totalLoss = built.cumulativeTotalLoss;
    if (totalLoss == null && events.length) {
      var lastEv = events[events.length - 1];
      totalLoss = lastEv.tLoss != null ? lastEv.tLoss : lastEv.totalLoss;
    }
    var orl = roundTrace2(Math.max(28, 48.5 - totalLoss * 0.38));

    return {
      events: events,
      totalLengthM: totalLengthM,
      totalLoss: totalLoss,
      orl: orl,
      attCoeff: attCoeff,
      fiberLossTotal: built.fiberLossTotal,
      spliceLossTotal: built.spliceLossTotal,
      connectorLossTotal: built.connectorLossTotal,
    };
  }

  function isPortOccupied(portId) {
    if (!portId) return false;
    var graph = fiberGraph();
    var i;
    var pcords = graph.pcords || [];
    for (i = 0; i < pcords.length; i++) {
      var c = pcords[i];
      var sides = [c.sideA, c.sideB];
      for (var s = 0; s < sides.length; s++) {
        if (attachmentMatchesPort(resolveFiberAttachment(sides[s]), portId)) return true;
      }
    }
    var pigtails = graph.pigtails || [];
    for (i = 0; i < pigtails.length; i++) {
      if (attachmentMatchesPort(resolveFiberAttachment(pigtails[i].connector), portId)) return true;
    }
    return false;
  }

  function isOtdrPortConnected(deviceId, portSuffix) {
    var portId = deviceId + portSuffix;
    if (isPortOccupied(portId)) return true;
    if (!layer) return false;
    var node = layer.querySelector('[data-otdr-node="' + deviceId + '"]');
    if (!node) return false;
    var port = node.querySelector('[data-ols-port="' + portId + '"], [data-otdr-port="' + portId + '"]');
    if (port && port.classList.contains('is-occupied')) return true;
    var wrap = node.querySelector('[data-port-id="' + portId + '"]');
    if (wrap && wrap.classList.contains('is-occupied')) return true;
    return false;
  }

  function isApcPortConnected(deviceId) {
    return isOtdrPortConnected(deviceId, '-port-apc');
  }

  function isApcLivePortConnected(deviceId) {
    return isOtdrPortConnected(deviceId, '-port-apc-live');
  }

  function resolveActiveOtdrPortForDevice(deviceId) {
    if (isApcLivePortConnected(deviceId)) return 'APC LIVE';
    if (isApcPortConnected(deviceId)) return 'APC';
    return activeOtdrPort || 'APC';
  }

  function syncActiveOtdrPortForDevice(deviceId) {
    if (!deviceId) return;
    var port = resolveActiveOtdrPortForDevice(deviceId);
    activeOtdrPort = port;
    var d = findDevice(deviceId);
    if (d) d.activeOtdrPort = port;
  }

  function isPigtailConnectedToPort(deviceId) {
    if (!deviceId) return false;
    if (layer) {
      var node = layer.querySelector('[data-otdr-node="' + deviceId + '"]');
      if (node) refreshPortOccupancy(node);
    }
    return validateConnection(deviceId);
  }

  function getOtdrPortProbeKey(deviceId) {
    return 'ols:' + deviceId + getRequiredOtdrPortSuffix(deviceId);
  }

  function detectLiveTrafficOnFiber(deviceId) {
    if (!deviceId || !isPigtailConnectedToPort(deviceId)) return false;
    if (!global.FtthLab || typeof FtthLab.measureOpticalAtKey !== 'function') return false;
    var reading = FtthLab.measureOpticalAtKey(getOtdrPortProbeKey(deviceId));
    if (!reading || !reading.source) return false;
    var noise = FtthLab.OPM_NOISE_DBM != null ? FtthLab.OPM_NOISE_DBM : -70;
    return reading.dBm != null && isFinite(reading.dBm) && reading.dBm > noise + 0.01;
  }

  function hasLiveTraffic(deviceId) {
    if (isSafeLiveTest(deviceId)) return false;
    return detectLiveTrafficOnFiber(deviceId);
  }

  function shouldApplyLiveTrafficEffects(deviceId) {
    return hasLiveTraffic(deviceId) && !!liveTrafficAcknowledged[deviceId];
  }

  function clearLiveTrafficState(deviceId) {
    delete liveTrafficAcknowledged[deviceId];
    delete liveTrafficChoiceCallbacks[deviceId];
    delete smartlinkLiveWarningDismissed[deviceId];
    var d = findDevice(deviceId);
    if (d) {
      d.liveTrafficDetected = false;
      d.liveTrafficCorrupted = false;
    }
  }

  function shouldShowSmartlinkLiveWarning(deviceId) {
    if (!hasLiveTraffic(deviceId)) return false;
    if (liveTrafficAcknowledged[deviceId]) return true;
    var d = findDevice(deviceId);
    if (!d) return false;
    return !!(d.liveTrafficDetected || d.liveTrafficCorrupted);
  }

  function getSmartlinkLiveWarningPopupEl(deviceNode, deviceId) {
    if (!deviceNode) return null;
    return deviceNode.querySelector('#smartlink-live-warning-popup-' + deviceId) ||
      deviceNode.querySelector('.smartlink-live-warning-popup');
  }

  function hideSmartlinkLiveWarningPopup(deviceId, deviceNode) {
    if (!deviceNode) return;
    var popup = getSmartlinkLiveWarningPopupEl(deviceNode, deviceId);
    if (popup) popup.classList.add('hidden');
  }

  function showSmartlinkLiveWarningPopup(deviceId, deviceNode) {
    if (!deviceId || !deviceNode) return;
    if (!shouldShowSmartlinkLiveWarning(deviceId)) return;
    if (smartlinkLiveWarningDismissed[deviceId]) return;
    var d = findDevice(deviceId);
    if (!d || d.runningTab !== 'smartlink') return;
    var smartlink = deviceNode.querySelector('[data-running-panel="smartlink"]');
    if (!smartlink || smartlink.hidden) return;
    var popup = getSmartlinkLiveWarningPopupEl(deviceNode, deviceId);
    if (popup) popup.classList.remove('hidden');
    setStatus('FO-1202 · Signal detected on fiber under test');
  }

  function dismissSmartlinkLiveWarningPopup(deviceId, deviceNode) {
    smartlinkLiveWarningDismissed[deviceId] = true;
    hideSmartlinkLiveWarningPopup(deviceId, deviceNode);
  }

  function updateSmartlinkLiveWarningVisibility(deviceId, deviceNode) {
    if (!deviceId || !deviceNode) return;
    var d = findDevice(deviceId);
    if (!d || d.runningTab !== 'smartlink') {
      hideSmartlinkLiveWarningPopup(deviceId, deviceNode);
      return;
    }
    if (shouldShowSmartlinkLiveWarning(deviceId) && !smartlinkLiveWarningDismissed[deviceId]) {
      showSmartlinkLiveWarningPopup(deviceId, deviceNode);
    } else {
      hideSmartlinkLiveWarningPopup(deviceId, deviceNode);
    }
  }

  function getTrafficDetectedPopupEl(deviceNode, deviceId) {
    if (!deviceNode) return null;
    return deviceNode.querySelector('#traffic-detected-popup-' + deviceId) ||
      deviceNode.querySelector('.traffic-detected-popup');
  }

  function showTrafficDetectedPopup(deviceId, deviceNode, onChoice) {
    if (!deviceId || !deviceNode) return;
    liveTrafficChoiceCallbacks[deviceId] = onChoice;
    var popup = getTrafficDetectedPopupEl(deviceNode, deviceId);
    if (popup) popup.classList.remove('hidden');
  }

  function hideTrafficDetectedPopup(deviceId, deviceNode) {
    if (!deviceNode) return;
    var popup = getTrafficDetectedPopupEl(deviceNode, deviceId);
    if (popup) popup.classList.add('hidden');
    delete liveTrafficChoiceCallbacks[deviceId];
  }

  function handleTrafficDetectedChoice(deviceId, deviceNode, choice) {
    var cb = liveTrafficChoiceCallbacks[deviceId];
    hideTrafficDetectedPopup(deviceId, deviceNode);
    if (cb) {
      delete liveTrafficChoiceCallbacks[deviceId];
      cb(choice === 'yes');
    }
  }

  function promptLiveTrafficContinue(deviceId, deviceNode, onProceed) {
    if (isSafeLiveTest(deviceId)) {
      clearLiveTrafficState(deviceId);
      if (deviceNode) {
        hideTrafficDetectedPopup(deviceId, deviceNode);
        hideSmartlinkLiveWarningPopup(deviceId, deviceNode);
      }
      if (onProceed) onProceed();
      return;
    }
    if (!hasLiveTraffic(deviceId)) {
      if (onProceed) onProceed();
      return;
    }
    showTrafficDetectedPopup(deviceId, deviceNode, function (yes) {
      if (!yes) {
        setStatus('FD-1200 · Live traffic on fiber · measurement cancelled');
        return;
      }
      liveTrafficAcknowledged[deviceId] = true;
      delete smartlinkLiveWarningDismissed[deviceId];
      var d = findDevice(deviceId);
      if (d) d.liveTrafficDetected = true;
      if (onProceed) onProceed();
    });
  }

  function corruptTraceResultForLiveTraffic(deviceId, traceResult) {
    if (!traceResult) return traceResult;
    var baseLen = traceResult.totalLengthM || 4.5;
    var chaosEvents = [
      { type: 'start', distance: 0, loss: null, reflect: -12.0, _reflectance: -12.0 },
      { type: 'connector', distance: roundTrace3(0.12 + Math.random() * 0.4), loss: roundTrace3(4.2 + Math.random() * 3), reflect: -8.0, _insertionLoss: roundTrace3(4.2 + Math.random() * 3), _reflectance: -8.0 },
      { type: 'splice', distance: roundTrace3(baseLen * 0.35 + Math.random() * 2), loss: roundTrace3(1.8 + Math.random() * 2.5), reflect: null, _insertionLoss: roundTrace3(1.8 + Math.random() * 2.5) },
      { type: 'connector', distance: roundTrace3(baseLen * 0.72 + Math.random() * 1.5), loss: roundTrace3(6.1 + Math.random() * 4), reflect: -5.0, _insertionLoss: roundTrace3(6.1 + Math.random() * 4), _reflectance: -5.0 },
      { type: 'end', distance: roundTrace3(baseLen * (0.9 + Math.random() * 0.4)), loss: roundTrace3(2.0 + Math.random() * 3), reflect: -3.0, _insertionLoss: roundTrace3(2.0 + Math.random() * 3), _reflectance: -3.0 },
    ];
    chaosEvents.forEach(function (ev, idx) {
      ev.eventNum = idx + 1;
      ev.event = String(idx + 1);
      ev.label = traceEventLabelFromType(ev.type);
      ev.linearPos = Math.min(0.98, Math.max(0.02, ev.distance / Math.max(baseLen, 5)));
    });
    applyViaviOtdrEventMetrics(chaosEvents);
    traceResult.events = chaosEvents;
    traceResult.totalLengthM = chaosEvents[chaosEvents.length - 1].distance;
    traceResult.totalLoss = roundTrace2(12 + Math.random() * 18);
    traceResult.orl = roundTrace2(8 + Math.random() * 11);
    traceResult.liveTrafficCorrupted = true;
    var corruptDevice = findDevice(deviceId);
    if (corruptDevice) corruptDevice.liveTrafficCorrupted = true;
    return traceResult;
  }

  function showLiveSignalDetectedPopup(deviceId, deviceNode) {
    if (!deviceNode) return;
    var d = findDevice(deviceId);
    if (d) d.liveTrafficDetected = true;
    updateSmartlinkLiveWarningVisibility(deviceId, deviceNode);
  }

  function restoreOtdrErrorDescVisibility(deviceNode) {
    if (!deviceNode) return;
    var descEl = deviceNode.querySelector('.otdr-error-desc');
    if (descEl) descEl.style.display = '';
  }

  function setOtdrErrorPopupContent(deviceNode, code, title, desc) {
    if (!deviceNode) return;
    var popup = deviceNode.querySelector('.otdr-error-popup');
    if (!popup) return;
    var codeEl = popup.querySelector('.otdr-error-code');
    var titleEl = popup.querySelector('.otdr-error-title');
    var descEl = popup.querySelector('.otdr-error-desc');
    if (codeEl && code) codeEl.textContent = code;
    if (titleEl && title) titleEl.textContent = title;
    if (descEl && desc) descEl.textContent = desc;
  }

  function restoreOtdrErrorPopupDefaults(deviceNode) {
    restoreOtdrErrorDescVisibility(deviceNode);
    setOtdrErrorPopupContent(
      deviceNode,
      'FO-1128',
      'Connection to test instrument is bad',
      'Check that the fiber is connected to the right test port first then inspect test port and patchcord fiber ends'
    );
  }

  function showFiberDisconnectedNotice(deviceId, deviceNode) {
    if (!deviceNode) return;
    setOtdrErrorPopupContent(
      deviceNode,
      'FO-1129',
      'Fiber Disconnected',
      'Check launch cable connection to the test port.'
    );
    showErrorPopup(deviceNode);
    setStatus('FO-1129 · Fiber Disconnected · Check launch cable connection');
    var d = findDevice(deviceId);
    if (d) d.fiberDisconnected = true;
  }

  function clearFiberDisconnectedNotice(deviceId, deviceNode) {
    if (fiberDisconnectWarnedFor === deviceId) fiberDisconnectWarnedFor = null;
    clearLiveTrafficState(deviceId);
    var d = findDevice(deviceId);
    if (d) d.fiberDisconnected = false;
    if (!deviceNode) return;
    var stillError = d && d.connectionError;
    if (!stillError) {
      hideErrorPopup(deviceNode);
      restoreOtdrErrorPopupDefaults(deviceNode);
    }
  }

  function resetRealtimeHudDisconnected(deviceNode) {
    var hud = getRealtimeHudEl(deviceNode);
    if (!hud) return;
    var track = hud.querySelector('.rt-track');
    var thumb = hud.querySelector('.rt-thumb');
    if (thumb) {
      thumb.style.left = '50%';
      thumb.style.backgroundColor = '#95a5a6';
      thumb.classList.remove('is-red', 'is-orange', 'is-green');
    }
    if (track) {
      track.setAttribute('aria-valuenow', '0');
      track.setAttribute('aria-valuetext', 'No signal');
    }
    hud.classList.remove('is-bad', 'is-fair', 'is-good');
    hud.classList.add('is-no-signal');
  }

  function drawNoiseFloorTraceLine(ctx, w, h) {
    var floorDb = -28;
    var distMax = Math.max(
      120,
      traceCamera.x + (w - TRACE_PLOT_MARGIN_LEFT) / Math.max(traceCamera.scaleX, 0.01)
    );
    ctx.strokeStyle = TRACE_LINE_COLOR;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(
      toCanvasX(0, w),
      toCanvasY(applyRayleighBackscatterNoiseDb(floorDb, 0), h)
    );
    var stepM = getRayleighTraceStepM(w);
    var d;
    for (d = stepM; d <= distMax; d += stepM) {
      ctx.lineTo(
        toCanvasX(d, w),
        toCanvasY(applyRayleighBackscatterNoiseDb(floorDb, d), h)
      );
    }
    ctx.stroke();
  }

  function applyFiberDisconnectedRealtimeState(deviceId, deviceNode) {
    traceLiveNoiseActive = false;
    traceLiveNoiseAmplitude = 0;
    traceLiveNoisePhase = 0;
    resetRealtimeHudDisconnected(deviceNode);
    var d = findDevice(deviceId);
    if (d) {
      d.fiberDisconnected = true;
      d.traceEvents = [];
    }
    var tableWrap = getOtdrTableContainer(deviceNode, deviceId);
    var tbody = tableWrap && tableWrap.querySelector('.trace-event-tbody');
    if (tbody) tbody.innerHTML = '';
    if (fiberDisconnectWarnedFor !== deviceId) {
      fiberDisconnectWarnedFor = deviceId;
      showFiberDisconnectedNotice(deviceId, deviceNode);
    }
    renderTraceForDevice(deviceId, deviceNode, { disconnected: true });
  }

  function abortOtdrTestFiberDisconnected(deviceId, deviceNode) {
    stopAcquisitionProgress(deviceId);
    var d = findDevice(deviceId);
    if (d) {
      d.acquisitionActive = false;
      d.acquisitionComplete = false;
      d.connectionError = true;
      d.fiberDisconnected = true;
      d.traceEvents = [];
    }
    if (deviceNode) {
      showFiberDisconnectedNotice(deviceId, deviceNode);
      showConnectionBadState(deviceNode);
      resetRealtimeHudDisconnected(deviceNode);
      var tbody = deviceNode.querySelector('.trace-event-tbody');
      if (tbody) tbody.innerHTML = '';
      renderTraceForDevice(deviceId, deviceNode, { disconnected: true });
    }
    setStatus('FO-1129 · Test aborted · Fiber disconnected');
  }

  function refreshPortOccupancy(root) {
    if (!root) return;
    root.querySelectorAll('.lab-otdr-port').forEach(function (port) {
      var id = port.getAttribute('data-ols-port') || port.getAttribute('data-opm-port');
      var occupied = isPortOccupied(id);
      port.classList.toggle('is-occupied', occupied);
      var wrap = port.closest('.protruding-port');
      if (wrap) wrap.classList.toggle('is-occupied', occupied);
    });
    var deviceId = root.getAttribute && root.getAttribute('data-otdr-node');
    if (deviceId) syncActiveOtdrPortForDevice(deviceId);
  }

  function updateInspector() {
    var card = document.getElementById('lab-inspector-card');
    var detail = document.getElementById('lab-inspector-detail');
    if (!card) return;
    if (selection.kind !== 'otdr' || !selection.id) {
      if (card.dataset.otdrInspector === '1') {
        card.dataset.otdrInspector = '';
        if (global.FtthLab && typeof FtthLab.resetInspectorIdle === 'function') {
          FtthLab.resetInspectorIdle();
        }
      }
      return;
    }
    var d = findDevice(selection.id);
    if (!d) return;
    card.dataset.otdrInspector = '1';
    card.hidden = false;
    card.innerHTML =
      '<h2>VIAVI SmartOTDR</h2>' +
      '<p>Position <strong>(' + d.x + ', ' + d.y + ')</strong> · VFL + APC + APC LIVE ports</p>' +
      '<p class="lab-inspector__hint">Drag chassis to move · Del to remove · plug SC pigtails into north ports</p>';
    if (detail) detail.hidden = true;
  }

  function selectOtdr(id, opts) {
    opts = opts || {};
    selection = { kind: 'otdr', id: id };
    claimSelection();
    renderToolbox();
    if (opts.skipRebuild) {
      if (layer) {
        layer.querySelectorAll('[data-otdr-node]').forEach(function (n) {
          n.classList.toggle('is-selected', n.getAttribute('data-otdr-node') === id);
        });
      }
    } else {
      rebuildLayer();
    }
    updateInspector();
  }

  function removeOtdr(id) {
    stopRealTimeMode(id);
    stopConnectionAnimation(id);
    stopAcquisitionProgress(id);
    stopConnectionValidationTimer(id);
    devices = devices.filter(function (d) { return d.id !== id; });
    if (selection.id === id) selection = { kind: 'none', id: null };
    rebuildLayer();
    updateInspector();
    pushHistory();
    setStatus('SmartOTDR removed');
  }

  function buildOsHomeMarkup() {
    return (
      '<div class="otdr-os-home">' +
      '<div class="os-top-bar">' +
      '<div class="bar-left">' +
      '<span class="home-icon" aria-hidden="true">🏠</span> Home' +
      '</div>' +
      '<div class="bar-right">' +
      '<span class="bt-icon" aria-hidden="true">⭐</span>' +
      '<span class="wifi-icon" aria-hidden="true">📶</span>' +
      '<span class="battery-icon" aria-hidden="true">🔋</span>' +
      '<span class="time-date">14:16 07/09/2026</span>' +
      '</div>' +
      '</div>' +
      '<div class="os-app-grid">' +
      '<div class="app-row">' +
      '<div class="app-btn" data-app="explorer" role="button" tabindex="0">' +
      '<div class="app-icon-box"><span class="icon" aria-hidden="true">📁</span></div>' +
      '<div class="app-label">EXPLORER</div></div>' +
      '<div class="app-btn is-selected" data-app="settings" role="button" tabindex="0">' +
      '<div class="app-icon-box"><span class="icon" aria-hidden="true">⚙️</span></div>' +
      '<div class="app-label text-green">Settings</div></div>' +
      '<div class="app-btn" data-app="connectivity" role="button" tabindex="0">' +
      '<div class="app-icon-box"><span class="icon" aria-hidden="true">🔌</span></div>' +
      '<div class="app-label">CONNECTIVITY</div></div>' +
      '<div class="app-btn" data-app="smart-access" role="button" tabindex="0">' +
      '<div class="app-label-box"><span class="icon" aria-hidden="true">📲</span></div>' +
      '<div class="app-label">SmartAccess</div></div>' +
      '<div class="app-btn" data-app="stratasync" role="button" tabindex="0">' +
      '<div class="app-icon-box"><span class="icon" aria-hidden="true">☁️</span></div>' +
      '<div class="app-label">STRATASYNC</div></div>' +
      '<div class="app-btn" data-app="add-options" role="button" tabindex="0">' +
      '<div class="app-icon-box"><span class="icon" aria-hidden="true">➕</span></div>' +
      '<div class="app-label">ADD OPTIONS</div></div>' +
      '</div>' +
      '<div class="app-row vfl-row">' +
      '<div class="app-btn" data-app="vfl" role="button" tabindex="0">' +
      '<div class="app-icon-box"><span class="icon" aria-hidden="true">🪄</span></div>' +
      '<div class="app-label">VFL</div></div>' +
      '</div>' +
      '<div class="app-row">' +
      '<div class="app-btn" data-app="expert-otdr" role="button" tabindex="0">' +
      '<div class="app-icon-box"><span class="icon" aria-hidden="true">📈</span></div>' +
      '<div class="app-label">EXPERT OTDR</div></div>' +
      '<div class="app-btn" data-app="smart-test" role="button" tabindex="0">' +
      '<div class="app-icon-box bg-yellow"><span class="icon" aria-hidden="true">⭐</span></div>' +
      '<div class="app-label">SMART TEST</div></div>' +
      '<div class="app-btn" data-app="ftth-otdr" role="button" tabindex="0">' +
      '<div class="app-icon-box"><span class="icon" aria-hidden="true">🏘️</span></div>' +
      '<div class="app-label">FTTH OTDR</div></div>' +
      '<div class="app-btn" data-app="source" role="button" tabindex="0">' +
      '<div class="app-icon-box"><span class="icon" aria-hidden="true">☀️</span></div>' +
      '<div class="app-label">SOURCE</div></div>' +
      '<div class="app-btn" data-app="powermeter" role="button" tabindex="0">' +
      '<div class="app-icon-box"><span class="icon" aria-hidden="true">📟</span></div>' +
      '<div class="app-label">POWERMETER</div></div>' +
      '</div>' +
      '</div>' +
      '</div>'
    );
  }

  function buildSmartTestAppMarkup() {
    return (
      '<div class="otdr-smart-test-app" aria-label="SMART TEST configuration">' +
      '<div class="st-top-bar">' +
      '<div class="st-bar-icons">' +
      '<span aria-hidden="true">🪄 🔌 📶 🔋</span>' +
      '<span class="st-time">12:19 10/01/2023</span>' +
      '</div>' +
      '</div>' +
      '<div class="st-title-bar">Please select a user configuration file</div>' +
      '<div class="st-config-list">' +
      '<div class="st-list-item">CERTIFICATION_AutoTest_20s</div>' +
      '<div class="st-list-item">CERTIFICATION_SmartAcq_20s</div>' +
      '<div class="st-list-item selected">EXPRESS_AutoTest_5s</div>' +
      '<div class="st-list-item">JDSU_ShortReach_20km</div>' +
      '</div>' +
      '<div class="st-bottom-bar">' +
      '<div class="st-path">/disk/config/SMART_TEST</div>' +
      '<div class="st-actions">' +
      '<div class="st-btn st-btn-icon" role="button" tabindex="0">' +
      '<svg viewBox="0 0 24 24" width="20" height="20" fill="white" aria-hidden="true">' +
      '<path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>' +
      '<path d="M12 9v4h-2l3 3 3-3h-2V9h-2z" fill="white" transform="rotate(180 12 13)"/>' +
      '</svg></div>' +
      '<div class="st-btn st-btn-text" role="button" tabindex="0">LOAD</div>' +
      '</div>' +
      '</div>' +
      '</div>'
    );
  }

  function buildSmartTestSetupMarkup(configName) {
    var name = configName || 'CERTIFICATION_AutoTest_20s';
    return (
      '<div class="otdr-smart-test-setup" aria-label="SMART TEST setup">' +
      '<div class="sts-top-bar">' +
      '<div class="sts-bar-icons">' +
      '<span aria-hidden="true">🪄 📶 🔋</span>' +
      '<span class="sts-time">14:28 07/09/2026</span>' +
      '</div>' +
      '</div>' +
      '<div class="sts-settings setup-content">' +
      '<div class="sts-row setup-row" data-sts-row="laser">' +
      '<div class="sts-label setup-label">Laser</div>' +
      '<div class="sts-options setup-options">' +
      '<button type="button" class="sts-opt opt-btn" data-value="1310">1310 nm</button>' +
      '<button type="button" class="sts-opt opt-btn is-active selected" data-value="1550">1550 nm</button>' +
      '<button type="button" class="sts-opt opt-btn sts-opt--live" data-value="1625">1625 nm (LIVE)</button>' +
      '</div></div>' +
      '<div class="sts-row setup-row" data-sts-row="distance">' +
      '<div class="sts-label setup-label">Distance Unit</div>' +
      '<div class="sts-options setup-options">' +
      '<button type="button" class="sts-opt opt-btn" data-value="km">km</button>' +
      '<button type="button" class="sts-opt opt-btn" data-value="kfeet">kfeet</button>' +
      '<button type="button" class="sts-opt opt-btn" data-value="miles">miles</button>' +
      '<button type="button" class="sts-opt opt-btn is-active selected" data-value="meter">meter</button>' +
      '<button type="button" class="sts-opt opt-btn" data-value="feet">feet</button>' +
      '</div></div>' +
      '<div class="sts-row setup-row" data-sts-row="launch-cable">' +
      '<div class="sts-label setup-label">Launch Cable</div>' +
      '<div class="sts-options setup-options">' +
      '<button type="button" class="sts-opt opt-btn is-active selected" data-value="no">No</button>' +
      '<button type="button" class="sts-opt opt-btn" data-value="yes">Yes</button>' +
      '</div></div>' +
      '<div class="sts-row setup-row" data-sts-row="alarms">' +
      '<div class="sts-label setup-label">Alarms</div>' +
      '<div class="sts-options setup-options">' +
      '<button type="button" class="sts-opt opt-btn" data-value="no">No</button>' +
      '<button type="button" class="sts-opt opt-btn is-active selected" data-value="yes">Yes</button>' +
      '<button type="button" class="sts-opt opt-btn sts-opt--default setup-default-btn" data-sts-action="default">' +
      'Default<span class="sts-gear" aria-hidden="true">⚙️</span></button>' +
      '</div></div>' +
      '</div>' +
      '<div class="sts-bottom-bar">' +
      '<div class="sts-config-name">' + name + '</div>' +
      '<div class="sts-actions">' +
      '<button type="button" class="sts-action-btn" data-sts-action="configs">' +
      '<span class="sts-action-label">Configs.</span>' +
      '<span class="sts-action-icon" aria-hidden="true">📁</span></button>' +
      '<button type="button" class="sts-action-btn" data-sts-action="start-test">' +
      '<span class="sts-action-stack">START<br>TEST</span></button>' +
      '<button type="button" class="sts-action-btn" data-sts-action="real-time">' +
      '<span class="sts-action-stack">REAL<br>TIME</span></button>' +
      '<button type="button" class="sts-action-btn sts-action-btn--disabled" disabled data-sts-action="results">' +
      '<span class="sts-action-label">Results</span>' +
      '<span class="sts-action-icon" aria-hidden="true">📈</span></button>' +
      '</div></div>' +
      '</div>'
    );
  }

  function buildSmartlinkLiveWarningPopupMarkup(deviceId) {
    return (
      '<div class="smartlink-live-warning-popup hidden" id="smartlink-live-warning-popup-' + deviceId + '"' +
      ' role="alertdialog" aria-labelledby="smartlink-live-warning-title-' + deviceId + '">' +
      '<div class="smartlink-live-warning-popup__code">FO-1202</div>' +
      '<div class="smartlink-live-warning-popup__row">' +
      '<span class="smartlink-live-warning-popup__warn" aria-hidden="true">⚠️</span>' +
      '<strong class="smartlink-live-warning-popup__title" id="smartlink-live-warning-title-' + deviceId + '">' +
      'Signal detected on fiber under test</strong>' +
      '</div>' +
      '<div class="smartlink-live-warning-popup__footer">Touch the popup window to close it</div>' +
      '</div>'
    );
  }

  function buildTrafficDetectedPopupMarkup(deviceId) {
    return (
      '<div class="traffic-detected-popup hidden" id="traffic-detected-popup-' + deviceId + '"' +
      ' role="alertdialog" aria-labelledby="traffic-detected-title-' + deviceId + '">' +
      '<div class="traffic-detected-popup__row">' +
      '<span class="traffic-detected-popup__warn" aria-hidden="true">⚠️</span>' +
      '<div class="traffic-detected-popup__text">' +
      '<span class="traffic-detected-popup__code">FD-1200</span>' +
      '<strong class="traffic-detected-popup__message" id="traffic-detected-title-' + deviceId + '">' +
      'Traffic Detected on Fiber !<br>Do you want to continue?</strong>' +
      '</div></div>' +
      '<div class="traffic-detected-popup__actions">' +
      '<button type="button" class="traffic-detected-popup__btn" id="btn-traffic-yes-' + deviceId + '"' +
      ' data-traffic-choice="yes">Yes</button>' +
      '<button type="button" class="traffic-detected-popup__btn" id="btn-traffic-no-' + deviceId + '"' +
      ' data-traffic-choice="no">No</button>' +
      '</div></div>'
    );
  }

  function buildConnBoxesMarkup() {
    var html = '';
    var i;
    for (i = 0; i < CONNECTION_BOX_COUNT; i++) {
      html += '<div class="conn-box"></div>';
    }
    return html;
  }

  function buildSmartTestRunningMarkup(deviceId) {
    var canvasId = deviceId + '-otdr-trace-canvas';
    return (
      '<div class="otdr-smart-test-running" aria-label="SMART TEST running">' +
      '<div class="str-top-bar">' +
      '<div class="str-bar-icons">' +
      '<span aria-hidden="true">🪄 📶 🔋</span>' +
      '<span class="str-time">14:46 07/09/2026</span>' +
      '</div></div>' +
      '<div class="running-workspace">' +
      '<div class="running-main-content">' +
      '<div class="running-tabs-header">' +
      '<div class="tabs-left">' +
      '<span class="tab active" data-running-tab="smartlink" role="button" tabindex="0">SmartLink</span>' +
      '<span class="tab" data-running-tab="trace" role="button" tabindex="0">Trace</span>' +
      '<span class="tab" data-running-tab="table" role="button" tabindex="0">Table</span>' +
      '</div>' +
      '<div class="tabs-right">' +
      '<span class="event-line-text">Event line</span>' +
      '<div class="toggle-switch active" role="switch" aria-checked="true">' +
      '<div class="toggle-circle"></div></div>' +
      '<span class="info-text">Info</span>' +
      '</div></div>' +
      '<div class="running-viewport smartlink-view" data-running-panel="smartlink">' +
      '<div class="viewport-top">' +
      '<div class="smartlink-container" id="smartlink-container-' + deviceId + '">' +
      '<div class="smartlink-schematic" id="smartlink-schematic-' + deviceId + '" aria-label="SmartLink schematic">' +
      '<div class="smartlink-empty-state">Connect fiber and start the test to view the link schematic.</div>' +
      '</div>' +
      '<div class="smartlink-detail" id="smartlink-detail-' + deviceId + '">' +
      '<div class="smartlink-detail-status">' +
      '<div class="sl-detail-status-icon sl-detail-status-icon--pass" id="sl-detail-status-icon-' + deviceId + '" aria-hidden="true">✓</div>' +
      '<span class="sl-detail-info" aria-hidden="true">i</span>' +
      '<div class="sl-detail-title" id="sl-detail-title-' + deviceId + '">Front Connector (Test Port)</div>' +
      '</div>' +
      '<div class="smartlink-detail-metrics">' +
      '<div class="smartlink-metric-col"><span class="smartlink-metric-label">Laser (nm)</span>' +
      '<span class="smartlink-metric-val" id="sl-metric-laser-' + deviceId + '">1550</span></div>' +
      '<div class="smartlink-metric-col"><span class="smartlink-metric-label">Distance (m)</span>' +
      '<span class="smartlink-metric-val" id="sl-metric-distance-' + deviceId + '">0.00</span></div>' +
      '<div class="smartlink-metric-col"><span class="smartlink-metric-label">Loss (dB)</span>' +
      '<span class="smartlink-metric-val" id="sl-metric-loss-' + deviceId + '">—</span></div>' +
      '<div class="smartlink-metric-col"><span class="smartlink-metric-label">Reflectance (dB)</span>' +
      '<span class="smartlink-metric-val" id="sl-metric-reflect-' + deviceId + '">—</span></div>' +
      '</div></div></div></div>' +
      '<div class="viewport-bottom">' +
      '<div class="connection-indicator">' +
      '<div class="conn-title">Connection</div>' +
      '<div class="conn-bar-container">' +
      '<span class="conn-label">Bad</span>' +
      '<div class="conn-boxes">' + buildConnBoxesMarkup() + '</div>' +
      '<span class="conn-label">Good</span>' +
      '</div></div>' +
      '<div class="acquisition-indicator" hidden>' +
      '<div class="acq-panel">' +
      '<div class="acq-title">Acquisition in progress ...</div>' +
      '<div class="acq-progress-row">' +
      '<span class="acq-timer acq-timer-left">00:00</span>' +
      '<div class="acq-progress-track">' +
      '<div class="acq-progress-fill">' +
      '<span class="acq-progress-pct">0%</span>' +
      '</div></div>' +
      '<span class="acq-timer acq-timer-right">00:20</span>' +
      '</div></div></div></div>' +
      buildSmartlinkLiveWarningPopupMarkup(deviceId) +
      '<div class="smartlink-status-popup hidden" id="smartlink-status-popup-' + deviceId + '" role="dialog" aria-labelledby="popup-title-' + deviceId + '">' +
      '<div class="popup-modal">' +
      '<div class="popup-header">' +
      '<div class="popup-icon" id="popup-icon-' + deviceId + '" aria-hidden="true"></div>' +
      '<h3 class="popup-title" id="popup-title-' + deviceId + '">Pass</h3>' +
      '</div>' +
      '<div class="popup-body">' +
      '<p>Length : <span class="popup-length" id="popup-length-' + deviceId + '">0.00</span> m</p>' +
      '<p>Loss @1550nm (10ns): <span class="popup-loss" id="popup-loss-' + deviceId + '">0.00</span> dB</p>' +
      '</div>' +
      '<div class="popup-footer">' +
      '<small>Touch the popup window to close it</small>' +
      '</div></div></div>' +
      '</div>' +
      '<div class="trace-view-container" hidden data-running-panel="trace">' +
      '<div class="trace-linear-view" aria-label="Event line">' +
      '<div class="trace-linear-track">' +
      '<span class="trace-linear-icon trace-linear-icon--start" data-trace-icon="start" title="Source">⚡</span>' +
      '<span class="trace-linear-icon trace-linear-icon--splice" data-trace-icon="splice" title="Splice">◇</span>' +
      '<span class="trace-linear-icon trace-linear-icon--end" data-trace-icon="end" title="End">▲</span>' +
      '</div></div>' +
      '<div class="trace-graph-area">' +
      '<div class="trace-floating-controls">' +
      '<button type="button" class="zoom-in-btn" aria-label="Zoom in">+</button>' +
      '<button type="button" class="zoom-out-btn" aria-label="Zoom out">-</button>' +
      '<button type="button" class="cursor-a-btn" aria-label="Cursor A">A</button>' +
      '</div>' +
      '<canvas class="otdr-trace-canvas" id="otdrTraceCanvas" data-trace-canvas="' + canvasId + '" aria-label="OTDR trace graph"></canvas>' +
      '</div>' +
      '<div class="trace-resizer" role="separator" aria-label="Resize graph and table">' +
      '<div class="purple-scroll-indicator"></div></div>' +
      '<div class="trace-summary-bar">' +
      '<span class="trace-summary-item">Nb Evts : <span id="summary-evts-' + deviceId + '">0</span></span>' +
      '<span class="trace-summary-item trace-summary-orl">Link Orl : ' +
      '<span id="summary-orl-' + deviceId + '">33.11</span> dB</span>' +
      '<span class="trace-summary-item trace-summary-lambda">λ: <span class="trace-summary-lambda-val">1550nm</span></span>' +
      '</div>' +
      '<div class="realtime-hud hidden" id="realtime-hud-' + deviceId + '" aria-label="Real Time connection alignment">' +
      '<div class="rt-connection-title">Connection</div>' +
      '<div class="rt-connection-row">' +
      '<span class="rt-connection-label rt-connection-label--bad">Bad</span>' +
      '<div class="rt-track" id="rt-track-' + deviceId + '" role="meter" aria-valuemin="0" aria-valuemax="100">' +
      '<div class="rt-thumb" id="rt-thumb-' + deviceId + '"></div>' +
      '</div>' +
      '<span class="rt-connection-label rt-connection-label--good">Good</span>' +
      '</div></div>' +
      '<div class="trace-event-table-wrap" id="otdr-table-container-' + deviceId + '">' +
      '<table class="trace-event-table">' +
      '<thead><tr>' +
      '<th>Event</th><th>Distance m</th><th>Loss dB</th><th>Reflect. dB</th>' +
      '<th>Slope dB/km</th><th>Section km</th><th>T. Loss dB</th>' +
      '</tr></thead>' +
      '<tbody class="trace-event-tbody"></tbody>' +
      '</table></div>' +
      '</div></div>' +
      '<div class="running-sidebar">' +
      '<div class="sidebar-btn sidebar-btn-start" role="button" tabindex="0" data-sidebar-mode="start" aria-label="Start test">' +
      '<span class="btn-text">START</span>' +
      '<span class="btn-icon btn-icon-play" aria-hidden="true"><span class="play-triangle"></span></span></div>' +
      '<div class="sidebar-btn sidebar-btn-realtime" role="button" tabindex="0"' +
      ' data-sidebar-action="real-time" aria-pressed="false" aria-label="Tiempo Real">' +
      '<span class="btn-text">Tiempo<br>Real</span>' +
      '<span class="btn-icon" aria-hidden="true">⏱️</span></div>' +
      '<div class="sidebar-btn" role="button" tabindex="0">' +
      '<span class="btn-text">Config.</span>' +
      '<span class="btn-icon" aria-hidden="true">⚙️</span></div>' +
      '<div class="sidebar-btn" role="button" tabindex="0">' +
      '<span class="btn-text">Explorador<br>Archivos</span>' +
      '<span class="btn-icon" aria-hidden="true">📁</span></div>' +
      '<div class="sidebar-btn" role="button" tabindex="0">' +
      '<span class="btn-text">Reportes</span>' +
      '<span class="btn-icon" aria-hidden="true">📄</span></div>' +
      '<div class="sidebar-btn" role="button" tabindex="0">' +
      '<span class="btn-text">Análisis</span>' +
      '<span class="btn-icon" aria-hidden="true">📐</span></div>' +
      '</div></div>' +
      '<div class="otdr-error-popup" hidden role="alertdialog" aria-labelledby="otdr-error-title">' +
      '<div class="otdr-error-modal">' +
      '<div class="otdr-error-body">' +
      '<span class="otdr-error-icon" aria-hidden="true">⚠️</span>' +
      '<div class="otdr-error-text">' +
      '<div class="otdr-error-code">FO-1128</div>' +
      '<div class="otdr-error-title" id="otdr-error-title">Connection to test instrument is bad</div>' +
      '<div class="otdr-error-desc">Check that the fiber is connected to the right test port first then inspect test port and patchcord fiber ends</div>' +
      '</div></div>' +
      '<div class="otdr-error-footer">Touch the popup window to close it</div>' +
      '</div></div></div>'
    );
  }

  function resetConnectionBoxes(container) {
    if (!container) return;
    container.querySelectorAll('.conn-box').forEach(function (box) {
      box.classList.remove('bg-orange', 'bg-green', 'bg-red');
    });
  }

  function showConnectionBadState(deviceNode) {
    var boxesContainer = deviceNode && deviceNode.querySelector('.conn-boxes');
    if (!boxesContainer) return;
    resetConnectionBoxes(boxesContainer);
    var boxes = boxesContainer.querySelectorAll('.conn-box');
    if (boxes[0]) boxes[0].classList.add('bg-orange');
  }

  function showConnectionLiveTrafficBadState(deviceNode) {
    var boxesContainer = deviceNode && deviceNode.querySelector('.conn-boxes');
    if (!boxesContainer) return;
    resetConnectionBoxes(boxesContainer);
    var boxes = boxesContainer.querySelectorAll('.conn-box');
    if (boxes[0]) boxes[0].classList.add('bg-red');
  }

  function applyLiveTrafficConnectionFailure(deviceId, deviceNode) {
    var d = findDevice(deviceId);
    if (d) {
      d.connectionError = true;
      d.acquisitionActive = false;
      d.liveTrafficDetected = true;
    }
    stopConnectionAnimation(deviceId);
    stopConnectionValidationTimer(deviceId);
    stopAcquisitionProgress(deviceId);
    resetRunningViewportUI(deviceNode);
    showConnectionLiveTrafficBadState(deviceNode);
    showLiveSignalDetectedPopup(deviceId, deviceNode);
    updateSidebarStartStopButton(deviceNode, false);
  }

  function formatAcqTimer(seconds, maxSeconds) {
    var max = typeof maxSeconds === 'number' ? maxSeconds : (currentOtdrTestState.durationSec || 20);
    var total = Math.max(0, Math.min(max, Math.floor(seconds)));
    var ss = total < 10 ? '0' + total : String(total);
    return '00:' + ss;
  }

  var TRACE_MAX_M = 3000;
  var TRACE_DB_MIN = -30;
  var TRACE_DB_MAX = 15;
  var TRACE_Y_TICKS = [15, 10, 5, 0, -5, -10, -15, -30];
  var TRACE_X_TICKS = [500, 1000, 1500, 2000];
  var TRACE_LINE_COLOR = '#302060';
  var TRACE_GRID_COLOR = '#e0e0e0';
  var TRACE_ZOOM_FACTOR_IN = 1.2;
  var TRACE_ZOOM_FACTOR_OUT = 0.8;
  var TRACE_ZOOM_MIN = 0.35;
  var TRACE_ZOOM_MAX = 5;
  var TRACE_GRAPH_COLLAPSE_THRESHOLD = 60;
  var TRACE_DEFAULT_GRAPH_HEIGHT = '65%';
  var TRACE_PLOT_MARGIN_LEFT = 36;
  var TRACE_OPTICAL_BASELINE_DB = 0;
  var TRACE_RAYLEIGH_AMP_DB = 2.75;

  var traceCamera = { x: -100, y: 0, scaleX: 1.5, scaleY: 8 };
  var currentTraceEventIndex = -1;
  var isTraceDragging = false;
  var lastTracePan = { x: 0, y: 0 };
  var mockFiberEvents = getMockFiberEventsSeven();
  var traceEventCounter = 1;
  var traceRedrawPending = null;
  var traceRedrawTarget = null;

  function resetTraceEventCycleIndex() {
    currentTraceEventIndex = -1;
  }

  function getTraceTableEvents(deviceId) {
    var d = deviceId ? findDevice(deviceId) : null;
    if (d && d.traceEvents && d.traceEvents.length) return d.traceEvents;
    return getDefaultTraceEvents();
  }

  function computeTraceEventCenterDb(ev) {
    if (!ev) return TRACE_OPTICAL_BASELINE_DB;
    var tLoss = ev.tLoss != null ? ev.tLoss : ev.totalLoss;
    if (typeof tLoss === 'number' && isFinite(tLoss)) {
      return TRACE_OPTICAL_BASELINE_DB - tLoss;
    }
    return TRACE_OPTICAL_BASELINE_DB;
  }

  function formatTraceAxisDbLabel(dbVal) {
    if (!isFinite(dbVal)) return '0';
    var rounded = Math.round(dbVal * 10) / 10;
    if (Math.abs(rounded) < 0.05) return '0';
    return rounded.toFixed(1);
  }

  function resolveTraceEventTLossDb(ev) {
    if (!ev) return null;
    var tLoss = ev.tLoss != null ? ev.tLoss : ev.totalLoss;
    return typeof tLoss === 'number' && isFinite(tLoss) ? tLoss : null;
  }

  function resolveTraceSegmentEndDb(ev, currentDb, lastEventDist, eventDist, defaultSlope) {
    var tLoss = resolveTraceEventTLossDb(ev);
    if (tLoss != null) return TRACE_OPTICAL_BASELINE_DB - tLoss;
    var sectionKm = resolveTraceEventSectionKm(ev);
    if (sectionKm == null || !isFinite(sectionKm)) {
      sectionKm = Math.max(0, (eventDist - lastEventDist) / 1000);
    }
    var slopeDbKm = resolveTraceEventSlopeDbKm(ev, defaultSlope);
    return currentDb - sectionKm * slopeDbKm;
  }

  function focusTraceCameraOnEvent(targetEvent, canvas) {
    if (!targetEvent || !canvas) return;
    var prepared = prepareTraceCanvas(canvas);
    if (!prepared) return;
    var w = prepared.w;
    var eventDist = typeof targetEvent.distance === 'number' ? targetEvent.distance : 0;

    if (traceCamera.scaleX < 3.0) {
      traceCamera.scaleX = 4.0;
      traceCamera.scaleY = 2.0;
    }
    clampTraceZoomInScales(canvas);

    var plotCenterX = w / 2;
    traceCamera.x = eventDist - (plotCenterX - TRACE_PLOT_MARGIN_LEFT) / traceCamera.scaleX;
    if (traceCamera.x < 0) traceCamera.x = 0;
    traceCamera.y = computeTraceEventCenterDb(targetEvent);
    traceCamera.y = Math.max(-50, Math.min(50, traceCamera.y));
  }

  function persistTraceCameraState(deviceId) {
    var d = findDevice(deviceId);
    if (!d) return;
    d.traceCamera = {
      x: traceCamera.x,
      y: traceCamera.y,
      scaleX: traceCamera.scaleX,
      scaleY: traceCamera.scaleY,
    };
  }

  function cycleTraceCursorView(deviceId, deviceNode, canvas, cursorButton) {
    var events = getTraceTableEvents(deviceId);
    currentTraceEventIndex += 1;
    if (currentTraceEventIndex >= events.length) {
      currentTraceEventIndex = -1;
    }

    var vp = getTraceViewport(deviceId);
    var wrap = deviceNode && deviceNode.querySelector('.trace-floating-controls');
    if (wrap) {
      wrap.querySelectorAll('.cursor-a-btn').forEach(function (b) {
        b.classList.remove('is-active');
      });
    }

    if (currentTraceEventIndex === -1) {
      resetTraceViewport(deviceId);
      vp.selectedEventIndex = 0;
      if (deviceNode) populateTraceEventTable(deviceNode, events, 0);
    } else {
      focusTraceCameraOnEvent(events[currentTraceEventIndex], canvas);
      persistTraceCameraState(deviceId);
      vp.selectedEventIndex = currentTraceEventIndex;
      vp.activeCursor = 'A';
      if (deviceNode) populateTraceEventTable(deviceNode, events, currentTraceEventIndex);
      if (cursorButton) cursorButton.classList.add('is-active');
    }

    if (canvas) scheduleTraceRedraw(canvas);
    else if (deviceNode) renderTraceForDevice(deviceId, deviceNode);
  }

  function resetOtdrTraceAcquisitionState(deviceId, deviceNode) {
    resetTraceEventCycleIndex();
    mockFiberEvents = [];
    traceEventCounter = 1;
    var d = deviceId ? findDevice(deviceId) : null;
    if (d) {
      d.traceEvents = null;
      d.traceTotalLoss = null;
      d.traceOrl = null;
      d.traceLengthM = null;
      d.acquisitionComplete = false;
    }
    if (deviceNode) {
      var tbody = deviceNode.querySelector('.trace-event-table tbody');
      if (!tbody) tbody = deviceNode.querySelector('.trace-event-tbody');
      if (tbody) tbody.innerHTML = '';
      updateTraceSummaryBar(deviceNode);
    }
  }

  function ensureTraceEvents(events) {
    if (!events || !events.length) return getDefaultTraceEvents();
    return events;
  }

  function toCanvasX(d, w) {
    return TRACE_PLOT_MARGIN_LEFT + (d - traceCamera.x) * traceCamera.scaleX;
  }

  function toCanvasY(db, h) {
    return (h / 2) - ((db - traceCamera.y) * traceCamera.scaleY);
  }

  function clampTraceZoomInScales(canvas) {
    if (!canvas) return;
    var rect = canvas.getBoundingClientRect();
    var canvasWidth = rect.width || canvas.clientWidth || 1;
    var canvasHeight = rect.height || canvas.clientHeight || 1;
    var maxScaleX = canvasWidth / 0.5;
    var maxScaleY = canvasHeight / 0.1;
    if (traceCamera.scaleX > maxScaleX) traceCamera.scaleX = maxScaleX;
    if (traceCamera.scaleY > maxScaleY) traceCamera.scaleY = maxScaleY;
  }

  function pickTraceAxisStep(range) {
    var rough = range / 8;
    if (!isFinite(rough) || rough <= 0) return 1;
    var pow = Math.pow(10, Math.floor(Math.log10(rough)));
    var norm = rough / pow;
    var nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
    return nice * pow;
  }

  function calcTraceDBAtDistance(distance) {
    if (distance <= 0) return 0;

    var currentDB = -(distance * 0.0002);
    var launchSpanM = 18;
    var launchPeakDb = 4.2;
    if (distance < launchSpanM) {
      var launchPhase = distance / launchSpanM;
      var launchShape = Math.sin(Math.PI * launchPhase);
      currentDB += launchPeakDb * launchShape * launchShape;
    }

    var ei;
    for (ei = 0; ei < mockFiberEvents.length; ei++) {
      var ev = mockFiberEvents[ei];
      var delta = distance - ev.distance;
      if (ev.type === 'start') {
        if (ev.reflect != null) {
          var startWidth = 10;
          currentDB += Math.abs(ev.reflect) * 0.12 *
            Math.exp(-(delta * delta) / (startWidth * startWidth));
        }
        continue;
      }
      if (ev.type === 'connector' || ev.type === 'reflective') {
        var width = 14;
        var amp = Math.abs(ev.reflect || 35) * 0.12;
        currentDB += amp * Math.exp(-(delta * delta) / (width * width));
        if (delta >= 0 && delta < 3 && ev.loss) {
          currentDB -= ev.loss * 0.5;
        }
      } else if (ev.type === 'splice') {
        if (delta >= 0 && delta < 4) {
          currentDB -= ev.loss || 0.1;
        }
      } else if (ev.type === 'splitter') {
        if (delta >= -10 && delta <= 2) {
          currentDB -= ev.loss || 3.5;
          currentDB += Math.abs(ev.reflect || 45) * 0.1 *
            Math.exp(-(delta * delta) / 30);
        }
      } else if (ev.type === 'end' && delta >= -6 && delta <= 0) {
        currentDB += Math.abs(ev.reflect || 45) * 0.2 *
          Math.exp(-(delta * delta) / 36);
      }
    }
    var traceEndM = mockFiberEvents.length
      ? mockFiberEvents[mockFiberEvents.length - 1].distance
      : TRACE_MAX_M;
    if (distance > traceEndM) {
      currentDB += (Math.random() - 0.5) * 12;
    }
    return currentDB;
  }

  function scheduleTraceRedraw(canvas) {
    traceRedrawTarget = canvas;
    if (traceRedrawPending) return;
    traceRedrawPending = requestAnimationFrame(function () {
      traceRedrawPending = null;
      if (traceRedrawTarget) {
        drawOTDRTrace(traceRedrawTarget);
        traceRedrawTarget = null;
      }
    });
  }

  function resolveTraceCanvas(canvasIdOrEl, deviceNode) {
    if (canvasIdOrEl && canvasIdOrEl.tagName === 'CANVAS') return canvasIdOrEl;
    if (typeof canvasIdOrEl === 'string' && canvasIdOrEl) {
      var byId = document.getElementById(canvasIdOrEl);
      if (byId) return byId;
    }
    if (deviceNode) {
      var scoped = deviceNode.querySelector('.trace-graph-area canvas');
      if (scoped) return scoped;
    }
    return document.getElementById('otdrTraceCanvas');
  }

  function getDefaultTraceEvents() {
    return buildTraceTableEventsFromMock(getMockFiberEventsSeven());
  }

  function formatTraceCell(value, digits) {
    if (value == null || value === '' || value === '-') return '—';
    if (typeof value === 'number' && isFinite(value)) {
      if (typeof digits === 'number') {
        var formatted = formatTraceNumeric(value, digits);
        return formatted != null ? formatted : '—';
      }
      return String(value);
    }
    return String(value);
  }

  function formatTraceEventLoss(loss) {
    if (loss == null || !isFinite(loss)) return '—';
    return parseFloat(Number(loss)).toFixed(3);
  }

  function formatTraceSectionKm(sectionKm) {
    if (sectionKm == null || !isFinite(sectionKm)) return '—';
    return parseFloat(Number(sectionKm)).toFixed(3);
  }

  function formatTraceSlopeDbKm(sectionAtt) {
    if (sectionAtt == null || sectionAtt === '--') return '—';
    if (!isFinite(sectionAtt)) return '—';
    return parseFloat(Number(sectionAtt)).toFixed(3);
  }

  function formatTraceEventTLoss(tLoss) {
    if (tLoss == null || !isFinite(tLoss)) return '—';
    return parseFloat(Number(tLoss)).toFixed(3);
  }

  function resolveTraceEventSectionKm(ev) {
    if (!ev) return null;
    if (ev.sectionKm != null && isFinite(ev.sectionKm)) return ev.sectionKm;
    if (ev.sectionM != null && isFinite(ev.sectionM)) return roundTrace3(ev.sectionM / 1000);
    return null;
  }

  function getTraceViewport(deviceId) {
    var d = findDevice(deviceId);
    if (!d) {
      return {
        zoomX: 1, zoomY: 1, offsetX: 0, offsetY: 0,
        isDragging: false, selectedEventIndex: 0, activeCursor: 'A',
      };
    }
    if (!d.traceViewport) {
      d.traceViewport = {
        zoomX: 1,
        zoomY: 1,
        offsetX: 0,
        offsetY: 0,
        isDragging: false,
        selectedEventIndex: 0,
        activeCursor: 'A',
      };
    }
    return d.traceViewport;
  }

  function resetTraceViewport(deviceId) {
    var d = findDevice(deviceId);
    traceCamera = { x: -100, y: 0, scaleX: 1.5, scaleY: 8 };
    isTraceDragging = false;
    lastTracePan = { x: 0, y: 0 };
    if (!d) return;
    d.traceViewport = {
      zoomX: 1,
      zoomY: 1,
      offsetX: 0,
      offsetY: 0,
      isDragging: false,
      selectedEventIndex: 0,
      activeCursor: 'A',
    };
    d.traceCamera = {
      x: traceCamera.x,
      y: traceCamera.y,
      scaleX: traceCamera.scaleX,
      scaleY: traceCamera.scaleY,
    };
  }

  function getEventIconHtml(type, label, opts) {
    opts = opts || {};
    var stroke = opts.stroke || '#302060';
    var fill = opts.fill || stroke;
    var strokeW = opts.strokeWidth || '1.5';
    var rectFill = opts.rectFill != null ? opts.rectFill : '#ffffff';
    var iconClass = opts.iconClass || 'trace-ev-icon';
    var t = type || 'connector';
    if (t === 'reflective') {
      t = (label === 'Splitter' || label === 'End Splitter') ? 'splitter'
        : (label === 'End' || label === 'Open Tail' || label === 'End of fiber' ? 'end' : 'connector');
    }

    if (t === 'splice') {
      return (
        '<svg class="' + iconClass + '" viewBox="0 0 32 14" aria-hidden="true">' +
        '<line x1="1" y1="7" x2="11" y2="7" stroke="' + stroke + '" stroke-width="' + strokeW + '"/>' +
        '<rect x="11" y="4" width="10" height="6" fill="' + rectFill + '" stroke="' + stroke + '" stroke-width="' + strokeW + '"/>' +
        '<line x1="21" y1="7" x2="31" y2="7" stroke="' + stroke + '" stroke-width="' + strokeW + '"/>' +
        '</svg>'
      );
    }

    if (t === 'bend') {
      return (
        '<svg class="' + iconClass + '" viewBox="0 0 32 14" aria-hidden="true">' +
        '<line x1="1" y1="10" x2="8" y2="10" stroke="' + stroke + '" stroke-width="' + strokeW + '"/>' +
        '<path d="M8 10 Q16 2.5 24 10" fill="none" stroke="' + stroke + '" stroke-width="' + strokeW + '"/>' +
        '<line x1="24" y1="10" x2="31" y2="10" stroke="' + stroke + '" stroke-width="' + strokeW + '"/>' +
        '</svg>'
      );
    }

    if (t === 'connector' || t === 'coupler') {
      return (
        '<svg class="' + iconClass + '" viewBox="0 0 32 14" aria-hidden="true">' +
        '<line x1="1" y1="7" x2="6" y2="7" stroke="' + stroke + '" stroke-width="' + strokeW + '"/>' +
        '<rect x="5.5" y="3" width="3" height="8" fill="' + rectFill + '" stroke="' + stroke + '" stroke-width="' + strokeW + '"/>' +
        '<rect x="8.5" y="2.5" width="15" height="9" fill="' + rectFill + '" stroke="' + stroke + '" stroke-width="' + strokeW + '"/>' +
        '<path d="M13.5 4.8 L15.8 7 L13.5 9.2 Z" fill="' + fill + '"/>' +
        '<path d="M18.5 4.8 L16.2 7 L18.5 9.2 Z" fill="' + fill + '"/>' +
        '<rect x="23.5" y="3" width="3" height="8" fill="' + rectFill + '" stroke="' + stroke + '" stroke-width="' + strokeW + '"/>' +
        '<line x1="26.5" y1="7" x2="31" y2="7" stroke="' + stroke + '" stroke-width="' + strokeW + '"/>' +
        '</svg>'
      );
    }

    if (t === 'splitter') {
      return (
        '<svg class="' + iconClass + '" viewBox="0 0 32 14" aria-hidden="true">' +
        '<line x1="1" y1="7" x2="7" y2="7" stroke="' + stroke + '" stroke-width="' + strokeW + '"/>' +
        '<path d="M27 2.5 L27 11.5 L11 7 Z" fill="' + rectFill + '" stroke="' + stroke + '" stroke-width="' + strokeW + '" stroke-linejoin="round"/>' +
        '<line x1="21.5" y1="3.2" x2="21.5" y2="10.8" stroke="' + stroke + '" stroke-width="' + strokeW + '"/>' +
        '<text x="24.2" y="8.2" font-size="4.2" font-weight="700" font-family="Arial,sans-serif" fill="' + fill + '" text-anchor="middle">2</text>' +
        '</svg>'
      );
    }

    if (t === 'end') {
      return (
        '<svg class="' + iconClass + '" viewBox="0 0 32 14" aria-hidden="true">' +
        '<line x1="1" y1="5" x2="5" y2="5" stroke="' + stroke + '" stroke-width="' + strokeW + '"/>' +
        '<line x1="1" y1="7" x2="5" y2="7" stroke="' + stroke + '" stroke-width="' + strokeW + '"/>' +
        '<line x1="1" y1="9" x2="5" y2="9" stroke="' + stroke + '" stroke-width="' + strokeW + '"/>' +
        '<rect x="5" y="3" width="10" height="8" fill="' + rectFill + '" stroke="' + stroke + '" stroke-width="' + strokeW + '"/>' +
        '<line x1="10" y1="5.5" x2="10" y2="8.5" stroke="' + stroke + '" stroke-width="' + strokeW + '"/>' +
        '<line x1="10" y1="7" x2="13" y2="7" stroke="' + stroke + '" stroke-width="' + strokeW + '"/>' +
        '<rect x="15" y="5.5" width="2.5" height="3" fill="' + fill + '"/>' +
        '</svg>'
      );
    }

    return (
      '<svg class="' + iconClass + '" viewBox="0 0 32 14" aria-hidden="true">' +
      '<rect x="5" y="5.5" width="2.5" height="3" fill="' + fill + '"/>' +
      '<rect x="7.5" y="3" width="10" height="8" fill="' + rectFill + '" stroke="' + stroke + '" stroke-width="' + strokeW + '"/>' +
      '<line x1="12.5" y1="5.5" x2="12.5" y2="8.5" stroke="' + stroke + '" stroke-width="' + strokeW + '"/>' +
      '<line x1="12.5" y1="7" x2="9.5" y2="7" stroke="' + stroke + '" stroke-width="' + strokeW + '"/>' +
      '<line x1="19" y1="5" x2="23" y2="5" stroke="' + stroke + '" stroke-width="' + strokeW + '"/>' +
      '<line x1="19" y1="7" x2="23" y2="7" stroke="' + stroke + '" stroke-width="' + strokeW + '"/>' +
      '<line x1="19" y1="9" x2="23" y2="9" stroke="' + stroke + '" stroke-width="' + strokeW + '"/>' +
      '<line x1="23" y1="7" x2="31" y2="7" stroke="' + stroke + '" stroke-width="' + strokeW + '"/>' +
      '</svg>'
    );
  }

  function traceEventIconSvg(type, label) {
    return getEventIconHtml(type, label);
  }

  function getSmartLinkEventIconHtml(type, label, failed, active) {
    var iconType = type || 'connector';
    if (label === 'Coupler') iconType = 'connector';
    if (type === 'bend' || label === 'Bend') iconType = 'bend';
    var themeColor = active ? '#ffffff' : (failed ? '#d32f2f' : '#5c3a92');
    return getEventIconHtml(iconType, label, {
      stroke: themeColor,
      fill: themeColor,
      rectFill: active ? '#1b1b3a' : '#ffffff',
      iconClass: 'trace-ev-icon sl-event-icon-svg',
    });
  }

  function updateSmartLinkDetailPanel(deviceNode, events, selection) {
    if (!deviceNode) return;
    var deviceId = deviceNode.getAttribute('data-otdr-node');
    var displayEvents = getSmartLinkDisplayEvents(events);
    if (!displayEvents.length) return;
    selection = selection || { kind: 'event', index: 0 };
    var laserEl = deviceNode.querySelector('#sl-metric-laser-' + deviceId);
    var distEl = deviceNode.querySelector('#sl-metric-distance-' + deviceId);
    var lossEl = deviceNode.querySelector('#sl-metric-loss-' + deviceId);
    var reflectEl = deviceNode.querySelector('#sl-metric-reflect-' + deviceId);
    var titleEl = deviceNode.querySelector('#sl-detail-title-' + deviceId);
    var statusIcon = deviceNode.querySelector('#sl-detail-status-icon-' + deviceId);
    var wl = parseOtdrWavelengthNm() || 1550;
    if (laserEl) laserEl.textContent = String(wl);

    if (selection.kind === 'fiber') {
      var fiberIdx = selection.index;
      var segM = getSmartLinkFiberSegmentM(displayEvents, fiberIdx);
      var segLoss = getSmartLinkFiberSegmentLossDb(displayEvents, fiberIdx);
      if (titleEl) titleEl.textContent = 'Fiber Section';
      if (distEl) distEl.textContent = formatSmartLinkSchematicDistance(segM);
      if (lossEl) lossEl.textContent = segLoss != null ? segLoss.toFixed(3) : '—';
      if (reflectEl) {
        reflectEl.textContent = '—';
        reflectEl.classList.remove('is-alarm');
      }
      if (statusIcon) {
        statusIcon.textContent = 'i';
        statusIcon.className = 'sl-detail-status-icon sl-detail-status-icon--info';
      }
      return;
    }

    var evIdx = Math.max(0, Math.min(selection.index || 0, displayEvents.length - 1));
    var ev = displayEvents[evIdx];
    var failed = isSmartLinkEventFailed(ev);
    if (titleEl) titleEl.textContent = smartLinkEventDescription(ev);
    if (distEl) distEl.textContent = formatSmartLinkSchematicDistance(ev.distance);
    if (lossEl) {
      var lossVal = ev.loss;
      if (lossVal == null || !isFinite(lossVal)) lossVal = ev._insertionLoss;
      lossEl.textContent = lossVal != null && isFinite(lossVal) ? Number(lossVal).toFixed(3) : '—';
      lossEl.classList.toggle('is-alarm', failed && lossVal != null && isFinite(lossVal));
    }
    if (reflectEl) {
      var reflectVal = ev.reflect;
      if (reflectVal == null || reflectVal === '--') reflectVal = ev._reflectance;
      if (reflectVal != null && isFinite(reflectVal)) {
        reflectEl.textContent = reflectVal > -35 ? ('> ' + Number(reflectVal).toFixed(2)) : Number(reflectVal).toFixed(2);
        reflectEl.classList.toggle('is-alarm', reflectVal > -35);
      } else {
        reflectEl.textContent = '—';
        reflectEl.classList.remove('is-alarm');
      }
    }
    if (statusIcon) {
      statusIcon.textContent = failed ? '✕' : '✓';
      statusIcon.className = 'sl-detail-status-icon ' + (failed ? 'sl-detail-status-icon--fail' : 'sl-detail-status-icon--pass');
    }
  }

  function selectSmartLinkTarget(deviceNode, kind, index) {
    if (!deviceNode) return;
    var deviceId = deviceNode.getAttribute('data-otdr-node');
    var d = findDevice(deviceId);
    if (!d) return;
    d.smartLinkSelection = { kind: kind, index: index };
    applySmartLinkSelection(deviceNode);
    updateSmartLinkDetailPanel(deviceNode, d.traceEvents, d.smartLinkSelection);
  }

  function applySmartLinkSelection(deviceNode) {
    if (!deviceNode) return;
    var deviceId = deviceNode.getAttribute('data-otdr-node');
    var d = findDevice(deviceId);
    var events = d && d.traceEvents ? d.traceEvents : [];
    var displayEvents = getSmartLinkDisplayEvents(events);
    var selection = d && d.smartLinkSelection ? d.smartLinkSelection : { kind: 'event', index: 0 };
    deviceNode.querySelectorAll('.sl-event-box').forEach(function (box) {
      box.classList.remove('active');
    });
    deviceNode.querySelectorAll('.sl-fiber-line').forEach(function (line) {
      line.classList.remove('active');
    });
    deviceNode.querySelectorAll('.sl-event-wrapper').forEach(function (wrapper, wi) {
      var box = wrapper.querySelector('.sl-event-box');
      var iconHost = wrapper.querySelector('.sl-event-icon');
      if (!box || !iconHost || wi >= displayEvents.length) return;
      var ev = displayEvents[wi];
      var isActive = selection.kind === 'event' && selection.index === wi;
      if (isActive) box.classList.add('active');
      iconHost.innerHTML = getSmartLinkEventIconHtml(
        ev.type,
        ev.label,
        isSmartLinkEventFailed(ev),
        isActive
      );
    });
    if (selection.kind === 'fiber') {
      var fiberSec = deviceNode.querySelector('.sl-fiber-section[data-sl-fiber-index="' + selection.index + '"]');
      if (fiberSec) {
        var line = fiberSec.querySelector('.sl-fiber-line');
        if (line) line.classList.add('active');
      }
    }
  }

  function bindSmartLinkDragScroll(host) {
    host.querySelectorAll('.smartlink-schematic').forEach(function (schematic) {
      if (schematic.dataset.slDragBound === '1') return;
      schematic.dataset.slDragBound = '1';

      var dragActive = false;
      var dragMoved = false;
      var dragStartX = 0;
      var dragStartScroll = 0;
      var dragThreshold = 4;

      function endDrag() {
        if (!dragActive) return;
        dragActive = false;
        schematic.classList.remove('active-drag');
        document.removeEventListener('mousemove', onDragMove);
        document.removeEventListener('mouseup', endDrag);
        if (dragMoved) {
          schematic.dataset.slSuppressClick = '1';
        }
      }

      function onDragMove(e) {
        if (!dragActive) return;
        var dx = e.pageX - dragStartX;
        if (Math.abs(dx) > dragThreshold) dragMoved = true;
        schematic.scrollLeft = dragStartScroll - dx;
      }

      schematic.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        dragActive = true;
        dragMoved = false;
        dragStartX = e.pageX;
        dragStartScroll = schematic.scrollLeft;
        schematic.classList.add('active-drag');
        document.addEventListener('mousemove', onDragMove);
        document.addEventListener('mouseup', endDrag);
      });
    });
  }

  function bindSmartLinkInteractions(host) {
    bindSmartLinkDragScroll(host);
    host.querySelectorAll('.smartlink-schematic').forEach(function (schematic) {
      if (schematic.dataset.slBound === '1') return;
      schematic.dataset.slBound = '1';
      schematic.addEventListener('click', function (e) {
        if (schematic.dataset.slSuppressClick === '1') {
          schematic.dataset.slSuppressClick = '';
          e.stopPropagation();
          return;
        }
        var wrapper = e.target.closest('.sl-event-wrapper');
        var fiberSec = e.target.closest('.sl-fiber-section');
        if (!wrapper && !fiberSec) return;
        e.stopPropagation();
        var deviceNode = schematic.closest('[data-otdr-node]');
        if (!deviceNode) return;
        if (wrapper) {
          var eventIdx = parseInt(wrapper.getAttribute('data-sl-event-index'), 10);
          if (!isFinite(eventIdx)) return;
          selectSmartLinkTarget(deviceNode, 'event', eventIdx);
          return;
        }
        var fiberIdx = parseInt(fiberSec.getAttribute('data-sl-fiber-index'), 10);
        if (!isFinite(fiberIdx)) return;
        selectSmartLinkTarget(deviceNode, 'fiber', fiberIdx);
      });
    });
  }

  function populateTraceEventTable(deviceNode, eventsData, selectedIndex) {
    var tbody = deviceNode && deviceNode.querySelector('.trace-event-tbody');
    if (!tbody && deviceNode) {
      tbody = deviceNode.querySelector('.trace-event-table tbody');
    }
    if (!tbody) return;
    tbody.innerHTML = '';
    eventsData = ensureTraceEvents(eventsData || null);
    var deviceId = deviceNode.getAttribute('data-otdr-node');
    var vp = getTraceViewport(deviceId);
    if (typeof selectedIndex === 'number') {
      vp.selectedEventIndex = selectedIndex;
    }
    var sel = vp.selectedEventIndex != null ? vp.selectedEventIndex : 0;
    var html = '';
    var i;
    for (i = 0; i < eventsData.length; i++) {
      var ev = eventsData[i];
      var num = ev.eventNum != null ? ev.eventNum : (i + 1);
      var icon = getEventIconHtml(ev.type, ev.label);
      var rowCls = i === sel ? ' class="selected"' : '';
      var formattedDist = formatTraceEventDistance(ev.distance);
      var formattedLoss = formatTraceEventLoss(ev.loss);
      var formattedReflect = formatTraceCell(ev.reflect, 2);
      var formattedSlope = formatTraceSlopeDbKm(ev.sectionAtt);
      var formattedSection = formatTraceSectionKm(resolveTraceEventSectionKm(ev));
      var formattedTLoss = formatTraceEventTLoss(ev.tLoss != null ? ev.tLoss : ev.totalLoss);
      var isLossAlarm = false;
      var isReflectAlarm = false;
      if (currentOtdrTestState.alarmsEnabled && ev.loss != null && ev.loss !== '--') {
        var lossVal = parseFloat(ev.loss);
        if (ev.type === 'splice' || ev.type === 'bend') {
          if (lossVal > 0.30) isLossAlarm = true;
        } else {
          if (lossVal > 0.50) isLossAlarm = true;
        }
      }
      if (currentOtdrTestState.alarmsEnabled) {
        if (ev.reflect != null && isFinite(ev.reflect)) {
          var reflectVal = parseFloat(ev.reflect);
          if (reflectVal > -35.00) {
            isReflectAlarm = true;
          }
        }
      }
      var lossColorStyle = isLossAlarm ? 'color: #ff4444 !important; font-weight: bold;' : '';
      var reflectColorStyle = isReflectAlarm ? 'color: #ff4444 !important; font-weight: bold;' : '';
      html +=
        '<tr' + rowCls + ' data-trace-event-row="' + i + '">' +
        '<td class="trace-event-cell">' +
        '<span class="trace-ev-num">' + num + '</span>' +
        icon +
        '</td>' +
        '<td>' + formattedDist + '</td>' +
        '<td style="' + lossColorStyle + '">' + formattedLoss + '</td>' +
        '<td style="' + reflectColorStyle + '">' + formattedReflect + '</td>' +
        '<td>' + formattedSlope + '</td>' +
        '<td>' + formattedSection + '</td>' +
        '<td>' + formattedTLoss + '</td></tr>';
    }
    tbody.innerHTML = html;
    updateTraceSummaryBar(deviceNode);
    updateTraceUIFromTestState(deviceNode);
  }

  function updateTraceSummaryBar(deviceNode) {
    if (!deviceNode) return;
    var deviceId = deviceNode.getAttribute('data-otdr-node') || '';
    var evtsEl = document.getElementById('summary-evts-' + deviceId);
    if (evtsEl) evtsEl.textContent = String(mockFiberEvents.length);
    var d = deviceId ? findDevice(deviceId) : null;
    var orlEl = document.getElementById('summary-orl-' + deviceId);
    if (orlEl) {
      var orl = d && typeof d.traceOrl === 'number' ? d.traceOrl : 33.11;
      orlEl.textContent = orl.toFixed(2);
    }
  }

  function applyDefaultTraceSplitLayout(deviceNode) {
    if (!deviceNode) return;
    var container = deviceNode.querySelector('.trace-view-container');
    var graphArea = container && container.querySelector('.trace-graph-area');
    var tableWrap = container && container.querySelector('.trace-event-table-wrap');
    if (!container || !graphArea || !tableWrap) return;

    setTraceGraphCollapsed(graphArea, container, false);

    graphArea.style.flex = '0 0 auto';
    graphArea.style.height = TRACE_DEFAULT_GRAPH_HEIGHT;
    graphArea.style.maxHeight = '';
    tableWrap.style.flex = '1 1 auto';
    tableWrap.style.minHeight = '48px';
    tableWrap.style.height = 'auto';
    tableWrap.style.overflowY = 'auto';
  }

  function resetTraceGraphLayout(deviceNode) {
    if (!deviceNode) return;
    var container = deviceNode.querySelector('.trace-view-container');
    var graphArea = container && container.querySelector('.trace-graph-area');
    if (!graphArea || !container) return;
    graphArea.style.height = '';
    graphArea.style.maxHeight = '';
    graphArea.style.flex = '';
    setTraceGraphCollapsed(graphArea, container, false);
  }

  function setTraceGraphCollapsed(graphArea, container, collapsed) {
    if (!graphArea || !container) return;
    graphArea.classList.toggle('is-graph-collapsed', collapsed);
    container.classList.toggle('is-graph-collapsed', collapsed);
    if (collapsed) {
      graphArea.style.flex = '0 0 0';
      graphArea.style.height = '0px';
      graphArea.style.minHeight = '0';
      graphArea.style.display = '';
    } else {
      graphArea.style.flex = '0 0 auto';
      graphArea.style.minHeight = '0';
      graphArea.style.display = '';
    }
  }

  function applyTraceGraphHeight(graphArea, tableWrap, heightPx, container) {
    if (!graphArea || !tableWrap || !container) return;
    if (heightPx < TRACE_GRAPH_COLLAPSE_THRESHOLD) {
      setTraceGraphCollapsed(graphArea, container, true);
      return;
    }
    setTraceGraphCollapsed(graphArea, container, false);
    graphArea.style.height = heightPx + 'px';
    tableWrap.style.flex = '1 1 auto';
    tableWrap.style.minHeight = '0';
  }

  function resolveTraceGraphHeight(container, linearHeight, pointerY, isCollapsed) {
    var containerRect = container.getBoundingClientRect();
    var containerTotalHeight = containerRect.height;
    var calculatedHeight = pointerY - containerRect.top - linearHeight;
    var maxHeight = Math.max(TRACE_GRAPH_COLLAPSE_THRESHOLD, containerTotalHeight - 100);

    if (isCollapsed) {
      if (calculatedHeight <= TRACE_GRAPH_COLLAPSE_THRESHOLD) return 0;
      return Math.min(calculatedHeight, maxHeight);
    }

    if (calculatedHeight < TRACE_GRAPH_COLLAPSE_THRESHOLD) return 0;
    return Math.min(calculatedHeight, maxHeight);
  }

  function bindTraceResizer(host) {
    host.querySelectorAll('.trace-resizer').forEach(function (resizer) {
      if (resizer.dataset.traceResizerBound === '1') return;
      resizer.dataset.traceResizerBound = '1';

      function beginResize(e) {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();

        var container = resizer.closest('.trace-view-container');
        if (!container) return;
        var graphArea = container.querySelector('.trace-graph-area');
        var tableWrap = container.querySelector('.trace-event-table-wrap');
        if (!graphArea || !tableWrap) return;

        var linearView = container.querySelector('.trace-linear-view');
        var linearHeight = linearView ? linearView.offsetHeight : 0;
        var deviceNode = container.closest('[data-otdr-node]');
        var deviceId = deviceNode ? deviceNode.getAttribute('data-otdr-node') : null;
        var activePointerId = e.pointerId;

        function pointerClientY(ev) {
          return ev.clientY;
        }

        function onMove(ev) {
          if (ev.pointerId !== activePointerId) return;
          ev.preventDefault();
          var isCollapsed = graphArea.classList.contains('is-graph-collapsed');
          var nextHeight = resolveTraceGraphHeight(
            container,
            linearHeight,
            pointerClientY(ev),
            isCollapsed
          );
          if (nextHeight === 0) {
            setTraceGraphCollapsed(graphArea, container, true);
            return;
          }
          applyTraceGraphHeight(graphArea, tableWrap, nextHeight, container);
        }

        function onEnd(ev) {
          if (ev.pointerId !== activePointerId) return;
          resizer.removeEventListener('pointermove', onMove);
          resizer.removeEventListener('pointerup', onEnd);
          resizer.removeEventListener('pointercancel', onEnd);
          document.body.classList.remove('trace-resizing');
          if (resizer.releasePointerCapture) {
            try { resizer.releasePointerCapture(activePointerId); } catch (err) { /* ignore */ }
          }
          if (deviceId && deviceNode && !graphArea.classList.contains('is-graph-collapsed')) {
            renderTraceForDevice(deviceId, deviceNode);
          }
        }

        document.body.classList.add('trace-resizing');
        if (resizer.setPointerCapture) {
          try { resizer.setPointerCapture(activePointerId); } catch (err) { /* ignore */ }
        }
        onMove(e);
        resizer.addEventListener('pointermove', onMove);
        resizer.addEventListener('pointerup', onEnd);
        resizer.addEventListener('pointercancel', onEnd);
      }

      resizer.addEventListener('pointerdown', beginResize);

      resizer.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
      });

      resizer.addEventListener('touchstart', function (e) {
        e.stopPropagation();
      }, { passive: false });
    });
  }

  function bindTraceEventTableRows(host) {
    host.querySelectorAll('.trace-event-tbody').forEach(function (tbody) {
      if (tbody.dataset.traceRowBound === '1') return;
      tbody.dataset.traceRowBound = '1';
      tbody.addEventListener('click', function (e) {
        var row = e.target.closest('[data-trace-event-row]');
        if (!row) return;
        e.stopPropagation();
        var deviceNode = tbody.closest('[data-otdr-node]');
        if (!deviceNode) return;
        var deviceId = deviceNode.getAttribute('data-otdr-node');
        var idx = parseInt(row.getAttribute('data-trace-event-row'), 10);
        var d = findDevice(deviceId);
        var events = (d && d.traceEvents) ? d.traceEvents : getDefaultTraceEvents();
        populateTraceEventTable(deviceNode, events, idx);
      });
    });
  }

  function positionTraceLinearIcons(deviceNode, eventsData) {
    if (!deviceNode) return;
    eventsData = eventsData || getDefaultTraceEvents();
    eventsData.forEach(function (ev) {
      if (!ev.type) return;
      var iconType = ev.type === 'start' ? 'start'
        : ev.type === 'splice' ? 'splice'
        : ev.type === 'splitter' ? 'splice'
        : (ev.type === 'end' || ev.label === 'End of fiber') ? 'end' : 'start';
      var icon = deviceNode.querySelector('[data-trace-icon="' + iconType + '"]');
      if (!icon) return;
      var pos = typeof ev.linearPos === 'number'
        ? ev.linearPos
        : (typeof ev.distance === 'number' ? ev.distance / TRACE_MAX_M : 0);
      icon.style.left = (Math.max(0, Math.min(1, pos)) * 100) + '%';
    });
  }

  function buildTracePolyline(events) {
    events = events || getDefaultTraceEvents();
    var spliceM = 484.09;
    var endM = 2000;
    var i;
    for (i = 0; i < events.length; i++) {
      if (events[i].type === 'splice' && typeof events[i].distance === 'number') {
        spliceM = events[i].distance;
      }
      if (events[i].type === 'end' || events[i].type === 'reflective') {
        if (typeof events[i].distance === 'number') endM = events[i].distance;
      }
    }
    return [
      { m: 0, db: 14 },
      { m: 0, db: 0 },
      { m: spliceM * 0.85, db: -0.2 },
      { m: spliceM, db: -0.2 },
      { m: spliceM + 3, db: -0.55 },
      { m: endM * 0.92, db: -1.1 },
      { m: endM * 0.96, db: -1.2 },
      { m: endM * 0.985, db: 12 },
      { m: endM, db: -8 },
      { m: endM, db: -6 },
    ];
  }

  function deterministicNoise(i, seed) {
    var x = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453;
    return x - Math.floor(x);
  }

  function getRayleighTraceStepM(w) {
    var viewSpanM = (w - TRACE_PLOT_MARGIN_LEFT) / Math.max(traceCamera.scaleX, 0.01);
    var targetSamples = Math.max(96, Math.min(420, w * 1.35));
    var stepM = viewSpanM / targetSamples;
    if (traceLiveNoiseActive) stepM *= 0.72;
    return Math.max(1.1, Math.min(7.5, stepM));
  }

  function applyRayleighBackscatterNoiseDb(db, distM) {
    var amp = TRACE_RAYLEIGH_AMP_DB;
    var n1 = deterministicNoise(distM * 0.41, 17);
    var n2 = deterministicNoise(distM * 0.97, 91);
    var n3 = deterministicNoise(distM * 1.73, 53);
    var n4 = deterministicNoise(distM * 2.31, 31);
    var texture = (n1 + n2 * 0.75 + n3 * 0.5 + n4 * 0.35) / 2.6 - 0.5;
    var out = db + texture * amp;
    if (traceLiveNoiseActive) {
      var liveAmp = amp * (0.9 + (traceLiveNoiseAmplitude || 1) * 0.22);
      out += (Math.random() - 0.5) * liveAmp;
      out += (Math.random() - 0.5) * liveAmp * 0.62;
      out += (deterministicNoise(distM * 0.13 + traceLiveNoisePhase, 7) - 0.5) * liveAmp * 0.45;
    }
    return out;
  }

  function traceNoisySegmentTo(ctx, w, h, fromDistM, toDistM, fromDb, toDb) {
    var segLenM = Math.max(0, toDistM - fromDistM);
    if (segLenM <= 0.001) {
      ctx.lineTo(
        toCanvasX(toDistM, w),
        toCanvasY(applyRayleighBackscatterNoiseDb(toDb, toDistM), h)
      );
      return;
    }
    var stepM = getRayleighTraceStepM(w);
    var steps = Math.max(2, Math.ceil(segLenM / stepM));
    if (traceLiveNoiseActive) {
      steps = Math.max(steps, Math.min(180, Math.round(segLenM / Math.max(1, stepM * 0.6))));
    }
    var si;
    for (si = 1; si <= steps; si++) {
      var t = si / steps;
      var midDist = fromDistM + segLenM * t;
      var midDb = fromDb + (toDb - fromDb) * t;
      midDb = applyRayleighBackscatterNoiseDb(midDb, midDist);
      ctx.lineTo(toCanvasX(midDist, w), toCanvasY(midDb, h));
    }
  }

  function parseTraceEventLoss(ev) {
    if (!ev) return 0;
    var v = ev.loss;
    if (v == null || v === '--') v = ev._insertionLoss;
    var n = parseFloat(v);
    return isFinite(n) ? n : 0;
  }

  function parseTraceEventReflect(ev) {
    if (!ev) return null;
    var v = ev.reflect;
    if (v == null || v === '--') v = ev._reflectance;
    var n = parseFloat(v);
    return isFinite(n) ? n : null;
  }

  function getReflectiveSpikeHeightDb(reflectVal) {
    if (reflectVal == null || !isFinite(reflectVal)) return 0.2;
    return Math.max(0.2, (75 + reflectVal) / 10);
  }

  function resolveTraceEventSlopeDbKm(ev, defaultSlope) {
    if (!ev) return defaultSlope;
    if (typeof ev.slope === 'number' && isFinite(ev.slope)) return ev.slope;
    if (typeof ev.sectionAtt === 'number' && isFinite(ev.sectionAtt)) return ev.sectionAtt;
    return defaultSlope;
  }

  function isTraceEndEvent(ev, index, total) {
    if (!ev) return false;
    if (ev.type === 'end') return true;
    if (ev.label === 'End of fiber') return true;
    return index === total - 1 && ev.type !== 'start';
  }

  function getTracePathDrawEvents(events) {
    if (!events || !events.length) return [];
    var drawEvents = [];
    var i;
    for (i = 0; i < events.length; i++) {
      var branchPath = events[i].branchPath || '0';
      if (branchPath === '0') drawEvents.push(events[i]);
    }
    if (!drawEvents.length) drawEvents = events.slice();
    drawEvents.sort(function (a, b) {
      var ea = a.eventNum != null ? a.eventNum : (a._traversalSeq || 0);
      var eb = b.eventNum != null ? b.eventNum : (b._traversalSeq || 0);
      if (ea !== eb) return ea - eb;
      var da = typeof a.distance === 'number' ? a.distance : 0;
      var db = typeof b.distance === 'number' ? b.distance : 0;
      if (da !== db) return da - db;
      return (a._traversalSeq || 0) - (b._traversalSeq || 0);
    });
    return drawEvents;
  }

  function drawEventDrivenTracePath(ctx, events, w, h) {
    var drawEvents = getTracePathDrawEvents(events);
    if (!drawEvents.length) return;

    var currentDb = TRACE_OPTICAL_BASELINE_DB;
    var defaultSlope = getViaviFiberSlopeDbKm();
    var lastEventDist = 0;
    var i;
    var ended = false;

    ctx.beginPath();
    ctx.moveTo(
      toCanvasX(0, w),
      toCanvasY(applyRayleighBackscatterNoiseDb(currentDb, 0), h)
    );

    for (i = 0; i < drawEvents.length && !ended; i++) {
      var ev = drawEvents[i];
      var eventDist = typeof ev.distance === 'number' ? ev.distance : 0;
      var eventX = toCanvasX(eventDist, w);
      var eventType = ev.type || '';
      var eventLoss = parseTraceEventLoss(ev);
      var reflectVal = parseTraceEventReflect(ev);
      var isStart = eventType === 'start' || i === 0;
      var isEnd = isTraceEndEvent(ev, i, drawEvents.length);

      if (!isStart) {
        var segStartDb = currentDb;
        var segEndDb = resolveTraceSegmentEndDb(ev, currentDb, lastEventDist, eventDist, defaultSlope);
        traceNoisySegmentTo(ctx, w, h, lastEventDist, eventDist, segStartDb, segEndDb);
        currentDb = segEndDb;
      }

      if (isStart) {
        if (reflectVal != null) {
          var startSpike = getReflectiveSpikeHeightDb(reflectVal);
          ctx.lineTo(eventX, toCanvasY(currentDb + startSpike, h));
          ctx.lineTo(eventX, toCanvasY(currentDb, h));
        }
      } else if (eventType === 'splice' || eventType === 'bend') {
        if (eventLoss > 0) {
          currentDb -= eventLoss;
          ctx.lineTo(eventX, toCanvasY(currentDb, h));
        }
      } else if (eventType === 'connector' || eventType === 'reflective' || eventType === 'splitter') {
        var spikeHeight = getReflectiveSpikeHeightDb(reflectVal);
        ctx.lineTo(eventX, toCanvasY(currentDb + spikeHeight, h));
        ctx.lineTo(eventX, toCanvasY(currentDb, h));
        if (eventLoss > 0) {
          currentDb -= eventLoss;
          ctx.lineTo(eventX, toCanvasY(currentDb, h));
        }
      } else if (isEnd) {
        var endSpike = getReflectiveSpikeHeightDb(reflectVal != null ? reflectVal : -45);
        ctx.lineTo(eventX, toCanvasY(currentDb + endSpike, h));
        ctx.lineTo(eventX, toCanvasY(currentDb, h));
        if (eventLoss > 0) {
          currentDb -= eventLoss;
          ctx.lineTo(eventX, toCanvasY(currentDb, h));
        }
        currentDb = Math.min(currentDb - 10, -15);
        ctx.lineTo(eventX, toCanvasY(currentDb, h));
        var plotWidth = Math.max(1, w - TRACE_PLOT_MARGIN_LEFT);
        var noiseEndDist = eventDist + Math.max(80, plotWidth / Math.max(traceCamera.scaleX, 0.01) * 0.12);
        traceNoisySegmentTo(ctx, w, h, eventDist, noiseEndDist, currentDb, currentDb);
        ended = true;
      }

      lastEventDist = eventDist;
    }

    if (!ended && lastEventDist >= 0) {
      var tailDist = lastEventDist + 40;
      var tailStartDb = currentDb;
      currentDb -= (40 / 1000) * defaultSlope;
      traceNoisySegmentTo(ctx, w, h, lastEventDist, tailDist, tailStartDb, currentDb);
    }

    ctx.stroke();
  }

  function prepareTraceCanvas(canvas) {
    var dpr = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    var cssW = rect.width;
    var cssH = rect.height;
    if (!cssW || !cssH) return null;
    var bufW = Math.max(1, Math.round(cssW * dpr));
    var bufH = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width !== bufW || canvas.height !== bufH) {
      canvas.width = bufW;
      canvas.height = bufH;
    }
    var ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    return { ctx: ctx, w: cssW, h: cssH, dpr: dpr };
  }

  function fitCanvasToDisplay(canvas) {
    return prepareTraceCanvas(canvas);
  }

  /**
   * Draw OTDR trace — physics-based camera trace with dynamic axes.
   * @param {string|HTMLCanvasElement} canvasIdOrEl
   * @param {Array|null} [eventsData]
   * @param {object} [viewport]
   */
  function drawOTDRTrace(canvasIdOrEl, eventsData, viewport) {
    var canvas = resolveTraceCanvas(canvasIdOrEl);
    if (!canvas) return;
    var prepared = prepareTraceCanvas(canvas);
    if (!prepared) return;
    var ctx = prepared.ctx;
    var w = prepared.w;
    var h = prepared.h;
    var labelSize = Math.max(8, Math.round(Math.min(w, h) * 0.08));
    var distMin = traceCamera.x;
    var distMax = traceCamera.x + (w - TRACE_PLOT_MARGIN_LEFT) / traceCamera.scaleX;
    var dbMin = traceCamera.y - (h / 2) / traceCamera.scaleY;
    var dbMax = traceCamera.y + (h / 2) / traceCamera.scaleY;
    var distStep = getTraceDistanceMeterStep(distMin, distMax);
    var dbStep = pickTraceAxisStep(dbMax - dbMin);
    var distStart = Math.floor(distMin / distStep) * distStep;
    var distanceUnitLabel = currentOtdrTestState.distanceUnit || 'meter';
    var dbStart = Math.floor(dbMin / dbStep) * dbStep;
    var dist;
    var dbVal;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = TRACE_GRID_COLOR;
    ctx.lineWidth = 1;
    for (dist = distStart; dist <= distMax; dist += distStep) {
      if (dist < 0) continue;
      var gx = toCanvasX(dist, w);
      if (gx < 0 || gx > w) continue;
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, h);
      ctx.stroke();
    }
    for (dbVal = dbStart; dbVal <= dbMax; dbVal += dbStep) {
      if (dbVal > 50 || dbVal < -50) continue;
      var gy = toCanvasY(dbVal, h);
      if (gy < 0 || gy > h) continue;
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(w, gy);
      ctx.stroke();
    }

    ctx.fillStyle = '#333333';
    ctx.font = labelSize + 'px Arial, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (dbVal = dbStart; dbVal <= dbMax; dbVal += dbStep) {
      if (dbVal > 50 || dbVal < -50) continue;
      var ly = toCanvasY(dbVal, h);
      if (ly < labelSize || ly > h - labelSize) continue;
      ctx.fillText(formatTraceAxisDbLabel(dbVal), 28, ly);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    for (dist = distStart; dist <= distMax; dist += distStep) {
      if (dist < 0) continue;
      var lx = toCanvasX(dist, w);
      if (lx < 0 || lx > w - 24) continue;
      ctx.fillText(formatTraceAxisDistance(dist, distStep), lx - 8, h - labelSize - 2);
    }

    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#999999';
    ctx.lineWidth = 1;
    ctx.fillRect(5, 5, 22, 16);
    ctx.strokeRect(5, 5, 22, 16);
    ctx.fillStyle = '#000000';
    ctx.font = 'bold ' + Math.max(9, labelSize - 1) + 'px Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('dB', 8, 16);

    var unitBoxFont = 'bold ' + Math.max(8, labelSize - 2) + 'px Arial, sans-serif';
    ctx.font = unitBoxFont;
    var unitBoxW = Math.max(20, Math.ceil(ctx.measureText(distanceUnitLabel).width) + 8);
    var unitBoxH = 16;
    var unitBoxX = w - unitBoxW - 5;
    var unitBoxY = h - 25;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#999999';
    ctx.fillRect(unitBoxX, unitBoxY, unitBoxW, unitBoxH);
    ctx.strokeRect(unitBoxX, unitBoxY, unitBoxW, unitBoxH);
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(distanceUnitLabel, unitBoxX + unitBoxW / 2, unitBoxY + unitBoxH / 2);

    if (viewport && viewport.disconnected) {
      drawNoiseFloorTraceLine(ctx, w, h);
      return;
    }

    ctx.strokeStyle = TRACE_LINE_COLOR;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    var events = eventsData;
    if (!events || !events.length) {
      var traceDeviceNode = canvas.closest('[data-otdr-node]');
      if (traceDeviceNode) {
        var traceDevice = findDevice(traceDeviceNode.getAttribute('data-otdr-node'));
        if (traceDevice && traceDevice.traceEvents && traceDevice.traceEvents.length) {
          events = traceDevice.traceEvents;
        }
      }
    }
    if (!events || !events.length) events = getDefaultTraceEvents();
    drawEventDrivenTracePath(ctx, events, w, h);
    events.forEach(function (ev) {
      if (typeof ev.distance !== 'number') return;
      var mx = toCanvasX(ev.distance, w);
      if (mx < -8 || mx > w + 8) return;
      ctx.strokeStyle = 'rgba(48, 32, 96, 0.22)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(mx, 0);
      ctx.lineTo(mx, h);
      ctx.stroke();
      ctx.setLineDash([]);
    });
  }

  function renderTraceForDevice(deviceId, deviceNode, opts) {
    opts = opts || {};
    if (!deviceNode && deviceId) deviceNode = document.getElementById(deviceId);
    if (!deviceId && deviceNode) deviceId = deviceNode.getAttribute('data-otdr-node');
    if (!deviceId) return;
    if (deviceNode) {
      var graphArea = deviceNode.querySelector('.trace-graph-area');
      ensureTraceFloatingControls(graphArea);
    }
    var canvas = resolveTraceCanvas(null, deviceNode);
    if (!canvas) return;
    if (opts.disconnected || !isPigtailConnectedToPort(deviceId)) {
      drawOTDRTrace(canvas, [], { disconnected: true });
      return;
    }
    var d = findDevice(deviceId);
    if (shouldApplyLiveTrafficEffects(deviceId)) {
      traceLiveNoiseActive = true;
      traceLiveNoiseAmplitude = Math.max(traceLiveNoiseAmplitude || 0, 8);
    }
    var events = opts.previewEvents ||
      (d && d.traceEvents && d.traceEvents.length ? d.traceEvents : getDefaultTraceEvents());
    drawOTDRTrace(canvas, events);
  }

  function getTracePointerClient(ev) {
    if (ev.touches && ev.touches.length) {
      return { x: ev.touches[0].clientX, y: ev.touches[0].clientY };
    }
    if (ev.changedTouches && ev.changedTouches.length) {
      return { x: ev.changedTouches[0].clientX, y: ev.changedTouches[0].clientY };
    }
    return { x: ev.clientX, y: ev.clientY };
  }

  function bindTraceCanvasInteractions(host) {
    host.querySelectorAll('.otdr-trace-canvas, #otdrTraceCanvas').forEach(function (canvas) {
      if (canvas.dataset.traceBound === '1') return;
      canvas.dataset.traceBound = '1';

      var isPinching = false;
      var pinchStartDist = 0;
      var pinchStartScaleX = 1;
      var pinchStartScaleY = 1;

      function getTouchSpan(touches) {
        var dx = touches[0].clientX - touches[1].clientX;
        var dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
      }

      function onPinchMove(e) {
        if (!isPinching || !e.touches || e.touches.length < 2) return;
        e.preventDefault();
        var span = getTouchSpan(e.touches);
        if (!pinchStartDist) return;
        var zoomRatio = span / pinchStartDist;
        traceCamera.scaleX = pinchStartScaleX * zoomRatio;
        traceCamera.scaleY = pinchStartScaleY * zoomRatio;
        traceCamera.scaleX = Math.max(TRACE_ZOOM_MIN, traceCamera.scaleX);
        traceCamera.scaleY = Math.max(TRACE_ZOOM_MIN, traceCamera.scaleY);
        clampTraceZoomInScales(canvas);
        scheduleTraceRedraw(canvas);
      }

      function endPinch(e) {
        if (!e.touches || e.touches.length < 2) {
          isPinching = false;
          pinchStartDist = 0;
        }
      }

      function onPanMove(e) {
        if (isPinching) return;
        if (!isTraceDragging) return;
        e.preventDefault();
        var p = getTracePointerClient(e);
        var deltaX = p.x - lastTracePan.x;
        var deltaY = p.y - lastTracePan.y;
        traceCamera.x -= deltaX / traceCamera.scaleX;
        traceCamera.y += deltaY / traceCamera.scaleY;
        if (traceCamera.x < 0) traceCamera.x = 0;
        traceCamera.y = Math.max(-50, Math.min(50, traceCamera.y));
        lastTracePan.x = p.x;
        lastTracePan.y = p.y;
        scheduleTraceRedraw(canvas);
      }

      function endPan() {
        if (!isTraceDragging) return;
        isTraceDragging = false;
        canvas.classList.remove('is-panning');
        window.removeEventListener('mousemove', onPanMove);
        window.removeEventListener('mouseup', endPan);
      }

      function beginPan(e) {
        if (e.touches && e.touches.length >= 2) {
          e.preventDefault();
          isPinching = true;
          isTraceDragging = false;
          pinchStartDist = getTouchSpan(e.touches);
          pinchStartScaleX = traceCamera.scaleX;
          pinchStartScaleY = traceCamera.scaleY;
          canvas.classList.remove('is-panning');
          return;
        }
        if (e.type === 'mousedown' && e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        isTraceDragging = true;
        var p = getTracePointerClient(e);
        lastTracePan.x = p.x;
        lastTracePan.y = p.y;
        canvas.classList.add('is-panning');
        window.addEventListener('mousemove', onPanMove);
        window.addEventListener('mouseup', endPan);
      }

      canvas.addEventListener('mousedown', beginPan);
      canvas.addEventListener('touchstart', beginPan, { passive: false });
      canvas.addEventListener('mousemove', onPanMove);
      canvas.addEventListener('touchmove', function (e) {
        if (isPinching) onPinchMove(e);
        else onPanMove(e);
      }, { passive: false });
      canvas.addEventListener('mouseup', endPan);
      canvas.addEventListener('mouseleave', endPan);
      canvas.addEventListener('touchend', function (e) {
        endPinch(e);
        endPan();
      });
      canvas.addEventListener('touchcancel', function (e) {
        endPinch(e);
        endPan();
      });

      canvas.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        e.stopPropagation();
      });
    });
  }

  function switchRunningTab(deviceNode, tabName) {
    if (!deviceNode) return;
    var switchDeviceId = deviceNode.getAttribute('data-otdr-node');
    if (isRealTimeActive && realTimeDeviceId === switchDeviceId && tabName === 'table') {
      tabName = 'trace';
    }
    var tabs = deviceNode.querySelectorAll('.tabs-left .tab[data-running-tab]');
    var i;
    for (i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('active', tabs[i].getAttribute('data-running-tab') === tabName);
    }
    var smartlink = deviceNode.querySelector('[data-running-panel="smartlink"]');
    var trace = deviceNode.querySelector('.trace-view-container');
    if (tabName === 'smartlink') {
      if (smartlink) smartlink.hidden = false;
      if (trace) {
        trace.hidden = true;
        trace.classList.remove('is-table-only');
      }
      var smartDeviceId = deviceNode.getAttribute('data-otdr-node');
      var smartDevice = smartDeviceId ? findDevice(smartDeviceId) : null;
      renderSmartLinkView(deviceNode, {
        events: smartDevice && smartDevice.traceEvents ? smartDevice.traceEvents : null,
        totalLoss: smartDevice && smartDevice.traceTotalLoss,
        orl: smartDevice && smartDevice.traceOrl,
      });
      updateSmartlinkLiveWarningVisibility(switchDeviceId, deviceNode);
    } else {
      hideSmartlinkLiveWarningPopup(switchDeviceId, deviceNode);
      if (smartlink) smartlink.hidden = true;
      if (trace) {
        trace.hidden = false;
        trace.classList.toggle('is-table-only', tabName === 'table');
      }
      if (tabName === 'trace') {
        var deviceId = deviceNode.getAttribute('data-otdr-node');
        var d = findDevice(deviceId);
        var events = (d && d.traceEvents) ? d.traceEvents : getDefaultTraceEvents();
        applyDefaultTraceSplitLayout(deviceNode);
        enforceTraceFloatingControlStyles(deviceNode);
        renderTraceForDevice(deviceId, deviceNode);
      }
    }
    var deviceId = deviceNode.getAttribute('data-otdr-node');
    var d = findDevice(deviceId);
    if (d) d.runningTab = tabName;
    if (isRealTimeActive && realTimeDeviceId === deviceId) {
      if (tabName === 'trace') showRealtimeHud(deviceNode);
      else hideRealtimeHud(deviceNode);
    }
  }

  function getRealtimeHudEl(deviceNode, deviceId) {
    if (!deviceNode) return null;
    var id = deviceId || deviceNode.getAttribute('data-otdr-node');
    return deviceNode.querySelector('#realtime-hud-' + id) ||
      deviceNode.querySelector('.realtime-hud');
  }

  function getOtdrTableContainer(deviceNode, deviceId) {
    if (!deviceNode) return null;
    var id = deviceId || deviceNode.getAttribute('data-otdr-node');
    return deviceNode.querySelector('#otdr-table-container-' + id) ||
      deviceNode.querySelector('.trace-event-table-wrap');
  }

  function applyRealTimeUILayout(deviceNode, active) {
    if (!deviceNode) return;
    var traceContainer = deviceNode.querySelector('.trace-view-container');
    var tableWrap = getOtdrTableContainer(deviceNode);
    var resizer = deviceNode.querySelector('.trace-resizer');
    var summary = deviceNode.querySelector('.trace-summary-bar');
    var hud = getRealtimeHudEl(deviceNode);
    if (active) {
      deviceNode.classList.add('is-realtime-active');
      if (traceContainer) traceContainer.classList.add('is-realtime-mode');
      if (tableWrap) {
        tableWrap.hidden = true;
        tableWrap.style.display = 'none';
      }
      if (resizer) resizer.hidden = true;
      if (summary) summary.hidden = true;
      if (hud) hud.classList.remove('hidden');
      var graphArea = deviceNode.querySelector('.trace-graph-area');
      if (graphArea) {
        graphArea.style.height = '';
        graphArea.classList.add('is-realtime-expanded');
      }
    } else {
      deviceNode.classList.remove('is-realtime-active');
      if (traceContainer) traceContainer.classList.remove('is-realtime-mode');
      if (tableWrap) {
        tableWrap.hidden = false;
        tableWrap.style.display = '';
      }
      if (resizer) resizer.hidden = false;
      if (summary) summary.hidden = false;
      if (hud) hud.classList.add('hidden');
      var graphAreaOff = deviceNode.querySelector('.trace-graph-area');
      if (graphAreaOff) graphAreaOff.classList.remove('is-realtime-expanded');
      applyDefaultTraceSplitLayout(deviceNode);
    }
  }

  function showRealtimeHud(deviceNode) {
    if (!deviceNode) return;
    applyRealTimeUILayout(deviceNode, true);
  }

  function hideRealtimeHud(deviceNode) {
    if (!deviceNode) return;
    applyRealTimeUILayout(deviceNode, false);
  }

  function mapWorstAngleToTrackPercent(deg) {
    if (!isFinite(deg)) return 85;
    if (deg >= 120) return 85;
    if (deg >= 90) return 45 + ((deg - 90) / 30) * 35;
    return 5 + (Math.max(0, deg) / 90) * 37;
  }

  function clampRealtimeThumbToZone(deg, pos) {
    if (deg >= 120) return Math.max(82, Math.min(88, pos));
    if (deg >= 90) return Math.max(45, Math.min(80, pos));
    return Math.max(5, Math.min(42, pos));
  }

  function updateRealtimeHudFromAngle(deviceNode, worstAngle) {
    var hud = getRealtimeHudEl(deviceNode);
    if (!hud) return;
    var track = hud.querySelector('.rt-track');
    var thumb = hud.querySelector('.rt-thumb');
    if (!track || !thumb) return;

    var deg = Number(worstAngle);
    if (!isFinite(deg)) deg = 120;
    var calculatedPos = mapWorstAngleToTrackPercent(deg);
    var jitter = (Math.random() - 0.5) * 4;
    var clampedPos = clampRealtimeThumbToZone(deg, calculatedPos + jitter);

    var color;
    var stateClass;
    var label;
    if (deg >= 120) {
      color = '#2ecc71';
      stateClass = 'is-good';
      label = 'Good';
    } else if (deg >= 90) {
      color = '#d35400';
      stateClass = 'is-fair';
      label = 'Fair';
    } else {
      color = '#e74c3c';
      stateClass = 'is-bad';
      label = 'Bad';
    }

    thumb.style.left = clampedPos + '%';
    thumb.style.backgroundColor = color;
    thumb.classList.remove('is-red', 'is-orange', 'is-green');
    if (deg >= 120) thumb.classList.add('is-green');
    else if (deg >= 90) thumb.classList.add('is-orange');
    else thumb.classList.add('is-red');

    track.setAttribute('aria-valuenow', String(Math.round(clampedPos)));
    track.setAttribute('aria-valuetext', label);
    hud.classList.remove('is-bad', 'is-fair', 'is-good', 'is-no-signal');
    hud.classList.add(stateClass);
  }

  function computeRealTimeQualityScore(angle) {
    var deg = Number(angle);
    if (!isFinite(deg)) return 100;
    if (deg >= 120) return 100;
    if (deg >= 90) return Math.round(50 + ((deg - 90) / 30) * 50);
    return Math.round(Math.max(0, Math.min(50, (deg / 90) * 50)));
  }

  function collectAllNetworkBendAngles() {
    var angles = [];
    var graph = fiberGraph();
    var seenJigIds = {};
    var pcords = graph.pcords || [];
    var pigtails = graph.pigtails || [];
    var lists = [graph.bends, graph.bendComponents, graph.components];
    var i;
    var li;
    var bi;

    for (i = 0; i < pcords.length; i++) {
      var pcBend = resolveBendComponentOnLink(pcords[i], graph);
      if (pcBend && isFinite(pcBend.angle)) angles.push(Number(pcBend.angle));
    }

    for (i = 0; i < pigtails.length; i++) {
      var ptBend = resolveBendComponentOnLink(pigtails[i], graph);
      if (ptBend && isFinite(ptBend.angle)) angles.push(Number(ptBend.angle));
    }

    for (li = 0; li < lists.length; li++) {
      var list = lists[li];
      if (!list || !list.length) continue;
      for (bi = 0; bi < list.length; bi++) {
        var comp = list[bi];
        if (!comp) continue;
        var compType = comp.type || comp.componentType;
        if (compType !== 'bend' && compType !== 'micro-bend') continue;
        var compAngle = comp.angle != null ? comp.angle : (comp.theta != null ? comp.theta : null);
        if (compAngle != null && isFinite(compAngle)) angles.push(Number(compAngle));
      }
    }

    if (global.FtthLab && typeof FtthLab.listBendJigSlots === 'function') {
      var slots = FtthLab.listBendJigSlots();
      for (i = 0; i < slots.length; i++) {
        var slot = slots[i];
        if (!slot || seenJigIds[slot.id]) continue;
        if (!slot.isCableDocked) continue;
        seenJigIds[slot.id] = true;
        if (isFinite(slot.theta)) angles.push(Number(slot.theta));
      }
    }

    return angles;
  }

  function getWorstNetworkBendAngle(deviceId) {
    var angles = collectAllNetworkBendAngles();
    if (!angles.length) return 120;
    var worstAngle = angles[0];
    var i;
    for (i = 1; i < angles.length; i++) {
      if (angles[i] < worstAngle) worstAngle = angles[i];
    }
    return worstAngle;
  }

  function getActiveNetworkBendAngle(deviceId) {
    return getWorstNetworkBendAngle(deviceId);
  }

  function updateRealTimeButtonState(deviceNode, active) {
    if (!deviceNode) return;
    var buttons = deviceNode.querySelectorAll(
      '[data-sts-action="real-time"], [data-sidebar-action="real-time"]'
    );
    var bi;
    for (bi = 0; bi < buttons.length; bi++) {
      buttons[bi].classList.toggle('is-active', !!active);
      buttons[bi].classList.toggle('active', !!active);
      buttons[bi].setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    updateSidebarStartStopButton(deviceNode, false);
  }

  function stopRealTimeMode(deviceId) {
    if (realTimeInterval) {
      clearInterval(realTimeInterval);
      realTimeInterval = null;
    }
    var stopId = deviceId || realTimeDeviceId;
    isRealTimeActive = false;
    realTimeDeviceId = null;
    realTimeNoisePhase = 0;
    realTimeQualityScore = 100;
    traceLiveNoiseActive = false;
    traceLiveNoiseAmplitude = 0;
    traceLiveNoisePhase = 0;
    if (stopId) {
      var stoppedDevice = findDevice(stopId);
      if (stoppedDevice) {
        stoppedDevice.realTimePreviewEvents = null;
        stoppedDevice.realTimePreviewLoss = null;
        stoppedDevice.realTimePreviewOrl = null;
        stoppedDevice.realTimePreviewLengthM = null;
      }
    }
    if (stopId && layer) {
      var node = layer.querySelector('[data-otdr-node="' + stopId + '"]');
      if (node) {
        hideTrafficDetectedPopup(stopId, node);
        updateRealTimeButtonState(node, false);
        hideRealtimeHud(node);
        renderTraceForDevice(stopId, node);
      }
    }
  }

  function commitRealTimeMeasurement(deviceId, deviceNode) {
    if (!deviceId || !deviceNode) return;
    stopRealTimeMode(deviceId);
    if (!isPigtailConnectedToPort(deviceId)) {
      applyFiberDisconnectedRealtimeState(deviceId, deviceNode);
      setStatus('FO-1129 · Cannot measure · Fiber disconnected');
      return;
    }
    if (shouldApplyLiveTrafficEffects(deviceId)) {
      traceLiveNoiseActive = true;
      traceLiveNoiseAmplitude = 8;
      traceLiveNoisePhase = realTimeNoisePhase;
    }
    runOtdrTest(deviceId, deviceNode);
    switchRunningTab(deviceNode, 'trace');
    setStatus('SMART TEST · Real Time measurement committed');
  }

  function tickRealTimePreview(deviceId, deviceNode) {
    if (!deviceId || !deviceNode || !isRealTimeActive || realTimeDeviceId !== deviceId) return;
    var d = findDevice(deviceId);
    if (!d || d.screen !== 'smart-test-running') return;
    if (!devicePoweredOn(deviceId)) {
      stopRealTimeMode(deviceId);
      return;
    }

    if (!isPigtailConnectedToPort(deviceId)) {
      applyFiberDisconnectedRealtimeState(deviceId, deviceNode);
      return;
    }
    clearFiberDisconnectedNotice(deviceId, deviceNode);

    var worstAngle = getWorstNetworkBendAngle(deviceId);
    if (shouldApplyLiveTrafficEffects(deviceId)) {
      worstAngle = 45;
      realTimeQualityScore = 12;
      traceLiveNoiseAmplitude = 6.5 + Math.random() * 2.5;
    } else {
      realTimeQualityScore = computeRealTimeQualityScore(worstAngle);
      traceLiveNoiseAmplitude = 2.4 + (100 - realTimeQualityScore) * 0.18;
    }
    realTimeNoisePhase += 1;
    traceLiveNoiseActive = true;
    traceLiveNoisePhase = realTimeNoisePhase;

    updateRealtimeHudFromAngle(deviceNode, worstAngle);

    var trace = deviceNode.querySelector('.trace-view-container');
    if (trace && !trace.hidden) {
      enforceTraceFloatingControlStyles(deviceNode);
      renderTraceForDevice(deviceId, deviceNode);
    }
  }

  function refreshOtdrLiveScan(deviceId, deviceNode) {
    if (!deviceId || !deviceNode) return;
    var d = findDevice(deviceId);
    if (!d || d.screen !== 'smart-test-running') return;
    if (!isPigtailConnectedToPort(deviceId)) {
      applyFiberDisconnectedRealtimeState(deviceId, deviceNode);
      return;
    }
    clearFiberDisconnectedNotice(deviceId, deviceNode);

    var traceResult = computeLabOtdrTrace(deviceId);
    if (shouldApplyLiveTrafficEffects(deviceId)) {
      traceLiveNoiseActive = true;
      traceLiveNoiseAmplitude = 9;
      traceResult = corruptTraceResultForLiveTraffic(deviceId, traceResult);
    }
    traceResult.events = ensureTraceEvents(traceResult.events);
    syncMockFiberEventsFromTrace(traceResult.events, traceResult.totalLengthM);

    var activeTab = d.runningTab || 'trace';
    var smartLinkSelection = d.smartLinkSelection;

    d.acquisitionActive = false;
    d.acquisitionComplete = true;
    d.traceEvents = traceResult.events;
    d.traceTotalLoss = traceResult.totalLoss;
    d.traceOrl = traceResult.orl;
    d.traceLengthM = traceResult.totalLengthM;

    populateTraceEventTable(deviceNode, traceResult.events);
    positionTraceLinearIcons(deviceNode, traceResult.events);
    updateTraceUIFromTestState(deviceNode);
    renderSmartLinkView(deviceNode, {
      events: traceResult.events,
      totalLoss: traceResult.totalLoss,
      orl: traceResult.orl,
      lengthM: traceResult.totalLengthM,
      selection: smartLinkSelection,
    });

    var trace = deviceNode.querySelector('.trace-view-container');
    var smartlink = deviceNode.querySelector('[data-running-panel="smartlink"]');
    if (activeTab === 'smartlink') {
      if (smartlink) smartlink.hidden = false;
      if (trace) trace.hidden = true;
    } else {
      if (smartlink) smartlink.hidden = true;
      if (trace) {
        trace.hidden = false;
        trace.classList.toggle('is-table-only', activeTab === 'table');
      }
      if (activeTab === 'trace' || activeTab === 'table') {
        applyDefaultTraceSplitLayout(deviceNode);
        enforceTraceFloatingControlStyles(deviceNode);
        renderTraceForDevice(deviceId, deviceNode);
      }
    }
  }

  function beginRealTimeMode(deviceId, deviceNode) {
    if (!deviceId || !deviceNode) return;
    stopRealTimeMode(realTimeDeviceId);
    stopAcquisitionProgress(deviceId);
    stopConnectionValidationTimer(deviceId);
    stopConnectionAnimation(deviceId);
    isRealTimeActive = true;
    realTimeDeviceId = deviceId;
    updateRealTimeButtonState(deviceNode, true);

    readSetupSelectionsFromDevice(deviceNode);
    var d = findDevice(deviceId);
    if (!d || d.screen !== 'smart-test-running') {
      setDeviceScreen(deviceId, 'smart-test-running');
      deviceNode = layer ? layer.querySelector('[data-otdr-node="' + deviceId + '"]') : deviceNode;
      d = findDevice(deviceId);
    }
    if (d) {
      d.acquisitionActive = false;
      d.acquisitionComplete = !!d.traceEvents;
    }

    switchRunningTab(deviceNode, 'trace');
    showRealtimeHud(deviceNode);
    enforceTraceFloatingControlStyles(deviceNode);
    renderTraceForDevice(deviceId, deviceNode);
    tickRealTimePreview(deviceId, deviceNode);
    requestAnimationFrame(function () {
      if (isRealTimeActive && realTimeDeviceId === deviceId) {
        tickRealTimePreview(deviceId, deviceNode);
      }
    });

    realTimeInterval = setInterval(function () {
      if (!isRealTimeActive || realTimeDeviceId !== deviceId) return;
      var liveNode = layer && layer.querySelector('[data-otdr-node="' + deviceId + '"]');
      var liveDevice = findDevice(deviceId);
      if (!liveNode || !liveDevice || liveDevice.screen !== 'smart-test-running') {
        stopRealTimeMode(deviceId);
        return;
      }
      tickRealTimePreview(deviceId, liveNode);
    }, REAL_TIME_SCAN_MS);

    setStatus('SMART TEST · Real Time active · adjust bend and press MEASURE to commit');
  }

  function startRealTimeMode(deviceId, deviceNode) {
    if (!deviceId || !deviceNode) return;
    if (!devicePoweredOn(deviceId)) return;
    readSetupSelectionsFromDevice(deviceNode);
    syncActiveLaserToDevice(deviceId);
    if (!validateConnection(deviceId)) {
      applyFiberDisconnectedRealtimeState(deviceId, deviceNode);
      return;
    }
    promptLiveTrafficContinue(deviceId, deviceNode, function () {
      beginRealTimeMode(deviceId, deviceNode);
    });
  }

  function toggleRealTimeMode(deviceId, deviceNode) {
    if (!deviceId || !deviceNode) return;
    if (isRealTimeActive && realTimeDeviceId === deviceId) {
      commitRealTimeMeasurement(deviceId, deviceNode);
      return;
    }
    startRealTimeMode(deviceId, deviceNode);
  }

  function devicePoweredOn(deviceId) {
    var d = findDevice(deviceId);
    if (d) return d.poweredOn !== false;
    return isDevicePoweredOn;
  }

  function restoreTraceEventTableVisibility(deviceNode, deviceId) {
    if (!deviceNode) return;
    deviceNode.classList.remove('is-realtime-active');
    var traceContainer = deviceNode.querySelector('.trace-view-container');
    if (traceContainer) {
      traceContainer.classList.remove('is-realtime-mode');
      traceContainer.hidden = false;
      traceContainer.classList.remove('is-table-only');
    }
    var tableWrap = getOtdrTableContainer(deviceNode, deviceId);
    if (tableWrap) {
      tableWrap.hidden = false;
      tableWrap.style.display = 'block';
    }
    var resizer = deviceNode.querySelector('.trace-resizer');
    if (resizer) resizer.hidden = false;
    var summary = deviceNode.querySelector('.trace-summary-bar');
    if (summary) summary.hidden = false;
    var graphArea = deviceNode.querySelector('.trace-graph-area');
    if (graphArea) graphArea.classList.remove('is-realtime-expanded');
    applyDefaultTraceSplitLayout(deviceNode);
  }

  function applyDevicePowerUI(deviceNode, poweredOn) {
    if (!deviceNode) return;
    isDevicePoweredOn = !!poweredOn;
    deviceNode.classList.toggle('is-powered-off', !poweredOn);
    var screen = deviceNode.querySelector('.otdr-screen');
    if (screen) {
      screen.classList.toggle('is-powered-off', !poweredOn);
      screen.setAttribute('aria-hidden', poweredOn ? 'false' : 'true');
    }
    var powerOverlay = deviceNode.querySelector('.otdr-screen-power-off');
    if (powerOverlay) {
      powerOverlay.hidden = !!poweredOn;
      powerOverlay.setAttribute('aria-hidden', poweredOn ? 'true' : 'false');
    }
    var powerLeds = deviceNode.querySelectorAll('.otdr-led-group .otdr-led');
    var onLed = powerLeds.length > 1 ? powerLeds[1] : deviceNode.querySelector('.otdr-led.is-on');
    if (onLed) onLed.classList.toggle('is-on', !!poweredOn);
    var powerBtn = deviceNode.querySelector('[data-otdr-btn="power"]');
    if (powerBtn) {
      powerBtn.classList.toggle('is-pressed', !poweredOn);
      powerBtn.setAttribute('aria-pressed', poweredOn ? 'false' : 'true');
    }
  }

  function setDevicePoweredOn(deviceId, deviceNode, poweredOn) {
    var d = findDevice(deviceId);
    if (!d) return;
    d.poweredOn = !!poweredOn;
    isDevicePoweredOn = !!poweredOn;
    if (!poweredOn) {
      stopRealTimeMode(deviceId);
      stopOtdrAcquisition(deviceId, deviceNode);
      stopConnectionAnimation(deviceId);
      stopConnectionValidationTimer(deviceId);
      stopAcquisitionProgress(deviceId);
      updateRealTimeButtonState(deviceNode, false);
    }
    applyDevicePowerUI(deviceNode, poweredOn);
  }

  function toggleDevicePower(deviceId, deviceNode) {
    if (!deviceId || !deviceNode) return;
    var d = findDevice(deviceId);
    if (!d) return;
    var nextPoweredOn = d.poweredOn === false;
    setDevicePoweredOn(deviceId, deviceNode, nextPoweredOn);
    setStatus(nextPoweredOn ? 'SmartOTDR powered on' : 'SmartOTDR powered off');
  }

  function handlePhysicalStartStop(deviceId, deviceNode) {
    if (!deviceId || !deviceNode) return;
    if (!devicePoweredOn(deviceId)) return;
    readSetupSelectionsFromDevice(deviceNode);
    syncActiveLaserToDevice(deviceId);

    if (isRealTimeActive && realTimeDeviceId === deviceId) {
      stopRealTimeMode(deviceId);
      updateRealTimeButtonState(deviceNode, false);
      hideRealtimeHud(deviceNode);
    }

    if (isOtdrTestInProgress(deviceId)) {
      stopOtdrAcquisition(deviceId, deviceNode);
      return;
    }

    var d = findDevice(deviceId);
    if (!d || d.screen !== 'smart-test-running') {
      setDeviceScreen(deviceId, 'smart-test-running');
      deviceNode = layer ? layer.querySelector('[data-otdr-node="' + deviceId + '"]') : deviceNode;
    }

    stopRealTimeMode(deviceId);
    updateRealTimeButtonState(deviceNode, false);
    hideRealtimeHud(deviceNode);
    switchRunningTab(deviceNode, 'trace');
    restoreTraceEventTableVisibility(deviceNode, deviceId);
    if (!validateConnection(deviceId)) {
      abortOtdrTestFiberDisconnected(deviceId, deviceNode);
      return;
    }
    promptLiveTrafficContinue(deviceId, deviceNode, function () {
      runOtdrTest(deviceId, deviceNode);
    });
  }

  function runOtdrTest(deviceId, deviceNode, opts) {
    opts = opts || {};
    if (!deviceNode && deviceId) deviceNode = document.getElementById(deviceId);
    if (!deviceId && deviceNode) deviceId = deviceNode.getAttribute('data-otdr-node');
    if (opts.realTimeRefresh) {
      refreshOtdrLiveScan(deviceId, deviceNode);
      return;
    }
    if (!devicePoweredOn(deviceId)) return;
    if (!isPigtailConnectedToPort(deviceId)) {
      abortOtdrTestFiberDisconnected(deviceId, deviceNode);
      return;
    }
    resetTraceEventCycleIndex();
    finishAcquisitionAndShowTrace(deviceId, deviceNode);
  }

  function finishAcquisitionAndShowTrace(deviceId, deviceNode) {
    if (!isPigtailConnectedToPort(deviceId)) {
      abortOtdrTestFiberDisconnected(deviceId, deviceNode);
      return;
    }
    var traceResult = computeLabOtdrTrace(deviceId);
    if (shouldApplyLiveTrafficEffects(deviceId)) {
      traceLiveNoiseActive = true;
      traceLiveNoiseAmplitude = 9;
      traceResult = corruptTraceResultForLiveTraffic(deviceId, traceResult);
    }
    traceResult.events = ensureTraceEvents(traceResult.events);
    syncMockFiberEventsFromTrace(traceResult.events, traceResult.totalLengthM);
    traceEventCounter = 1;
    resetTraceEventCycleIndex();
    var d = findDevice(deviceId);
    if (d) {
      d.acquisitionActive = false;
      d.acquisitionComplete = true;
      d.traceEvents = traceResult.events;
      d.traceTotalLoss = traceResult.totalLoss;
      d.traceOrl = traceResult.orl;
      d.traceLengthM = traceResult.totalLengthM;
      d.runningTab = 'trace';
      resetTraceViewport(deviceId);
    }
    if (!deviceNode) return;

    stopAcquisitionProgress(deviceId);

    var acqInd = deviceNode.querySelector('.acquisition-indicator');
    if (acqInd) acqInd.hidden = true;
    var smartlink = deviceNode.querySelector('[data-running-panel="smartlink"]');
    if (smartlink) smartlink.hidden = true;
    var viewportBottom = deviceNode.querySelector('.viewport-bottom');
    if (viewportBottom) viewportBottom.hidden = true;
    var connInd = deviceNode.querySelector('.connection-indicator');
    if (connInd) connInd.hidden = true;

    var events = (d && d.traceEvents) ? d.traceEvents : getDefaultTraceEvents();
    populateTraceEventTable(deviceNode, events);
    positionTraceLinearIcons(deviceNode, events);
    updateTraceUIFromTestState(deviceNode);
    renderSmartLinkView(deviceNode, {
      events: events,
      totalLoss: traceResult.totalLoss,
      orl: traceResult.orl,
      lengthM: traceResult.totalLengthM,
    });
    showSmartLinkStatusPopup(deviceNode, {
      pass: computeSmartLinkPassState(events),
      lengthM: traceResult.totalLengthM,
      lossDb: traceResult.totalLoss,
    });

    var tabs = deviceNode.querySelectorAll('.tabs-left .tab[data-running-tab]');
    var ti;
    for (ti = 0; ti < tabs.length; ti++) {
      var tabName = tabs[ti].getAttribute('data-running-tab');
      tabs[ti].classList.toggle('active', tabName === 'trace');
    }
    var trace = deviceNode.querySelector('.trace-view-container');
    if (trace) {
      trace.hidden = false;
      trace.classList.remove('is-table-only');
    }

    applyDefaultTraceSplitLayout(deviceNode);
    enforceTraceFloatingControlStyles(deviceNode);
    renderTraceForDevice(deviceId, deviceNode);

    requestAnimationFrame(function () {
      applyDefaultTraceSplitLayout(deviceNode);
      enforceTraceFloatingControlStyles(deviceNode);
      renderTraceForDevice(deviceId, deviceNode);
      requestAnimationFrame(function () {
        applyDefaultTraceSplitLayout(deviceNode);
        enforceTraceFloatingControlStyles(deviceNode);
        renderTraceForDevice(deviceId, deviceNode);
      });
    });

    hideRealtimeHud(deviceNode);
    restoreTraceEventTableVisibility(deviceNode, deviceId);
    setStatus('SMART TEST · trace acquired');
    updateSidebarStartStopButton(deviceNode, false);
  }

  function isOtdrTestInProgress(deviceId) {
    if (connectionAnimTimers[deviceId] || connectionValidationTimers[deviceId] || acquisitionTimers[deviceId]) {
      return true;
    }
    var d = findDevice(deviceId);
    return !!(d && d.acquisitionActive && !d.acquisitionComplete);
  }

  function updateSidebarStartStopButton(deviceNode, isRunning) {
    if (!deviceNode) return;
    var btn = deviceNode.querySelector('.sidebar-btn-start');
    if (!btn) return;
    var deviceId = deviceNode.getAttribute('data-otdr-node');
    var textEl = btn.querySelector('.btn-text');
    var iconEl = btn.querySelector('.btn-icon-play, .btn-icon-stop');
    if (isRealTimeActive && realTimeDeviceId === deviceId) {
      btn.classList.remove('btn-stop');
      btn.setAttribute('data-sidebar-mode', 'measure');
      btn.setAttribute('aria-label', 'Measure and commit');
      if (textEl) textEl.textContent = 'MEASURE';
      if (iconEl) {
        iconEl.className = 'btn-icon btn-icon-play';
        iconEl.innerHTML = '<span class="play-triangle" aria-hidden="true"></span>';
      }
      return;
    }
    if (isRunning) {
      btn.classList.add('btn-stop');
      btn.setAttribute('data-sidebar-mode', 'stop');
      btn.setAttribute('aria-label', 'Stop test');
      if (textEl) textEl.textContent = 'STOP';
      if (iconEl) {
        iconEl.className = 'btn-icon btn-icon-stop';
        iconEl.innerHTML = '<span class="red-square" aria-hidden="true"></span>';
      }
    } else {
      btn.classList.remove('btn-stop');
      btn.setAttribute('data-sidebar-mode', 'start');
      btn.setAttribute('aria-label', 'Start test');
      if (textEl) textEl.textContent = 'START';
      if (iconEl) {
        iconEl.className = 'btn-icon btn-icon-play';
        iconEl.innerHTML = '<span class="play-triangle" aria-hidden="true"></span>';
      }
    }
  }

  function resetRunningViewToSmartLink(deviceNode) {
    if (!deviceNode) return;
    var deviceId = deviceNode.getAttribute('data-otdr-node');
    var d = findDevice(deviceId);
    if (d) {
      d.acquisitionComplete = false;
      d.acquisitionActive = false;
      d.connectionError = false;
      d.traceEvents = null;
      d.smartLinkSelection = null;
      d.runningTab = 'smartlink';
      resetTraceViewport(deviceId);
    }
    hideErrorPopup(deviceNode);
    var trace = deviceNode.querySelector('.trace-view-container');
    if (trace) {
      trace.hidden = true;
      trace.classList.remove('is-table-only');
    }
    var smartlink = deviceNode.querySelector('[data-running-panel="smartlink"]');
    if (smartlink) smartlink.hidden = false;
    var viewportBottom = deviceNode.querySelector('.viewport-bottom');
    if (viewportBottom) viewportBottom.hidden = false;
    var tabs = deviceNode.querySelectorAll('.tabs-left .tab[data-running-tab]');
    var ti;
    for (ti = 0; ti < tabs.length; ti++) {
      tabs[ti].classList.toggle('active', tabs[ti].getAttribute('data-running-tab') === 'smartlink');
    }
    stopConnectionAnimation(deviceId);
    stopAcquisitionProgress(deviceId);
    var connInd = deviceNode.querySelector('.connection-indicator');
    var acqInd = deviceNode.querySelector('.acquisition-indicator');
    if (connInd) connInd.hidden = false;
    if (acqInd) acqInd.hidden = true;
    resetAcquisitionUI(deviceNode);
    var boxesContainer = deviceNode.querySelector('.conn-boxes');
    if (boxesContainer) resetConnectionBoxes(boxesContainer);
    resetTraceGraphLayout(deviceNode);
    var tbody = deviceNode.querySelector('.trace-event-tbody');
    if (tbody) tbody.innerHTML = '';
    renderSmartLinkView(deviceNode, null);
    hideSmartLinkStatusPopup(deviceNode);
  }

  function stopOtdrAcquisition(deviceId, deviceNode) {
    if (!deviceNode && deviceId) deviceNode = document.getElementById(deviceId);
    if (!deviceId && deviceNode) deviceId = deviceNode.getAttribute('data-otdr-node');
    if (!deviceId || !deviceNode) return;
    stopRealTimeMode(deviceId);
    hideTrafficDetectedPopup(deviceId, deviceNode);
    var d = findDevice(deviceId);
    stopConnectionAnimation(deviceId);
    stopAcquisitionProgress(deviceId);
    if (d) {
      d.acquisitionActive = false;
      d.acquisitionComplete = false;
      d.connectionError = false;
      d.liveTrafficDetected = false;
    }
    clearLiveTrafficState(deviceId);
    var boxesContainer = deviceNode.querySelector('.conn-boxes');
    if (boxesContainer) resetConnectionBoxes(boxesContainer);
    resetRunningViewportUI(deviceNode);
    hideErrorPopup(deviceNode);
    updateSidebarStartStopButton(deviceNode, false);
    setStatus('SMART TEST · stopped');
  }

  function beginStartOtdrAcquisition(deviceId, deviceNode) {
    if (!deviceNode && deviceId) deviceNode = document.getElementById(deviceId);
    if (!deviceId && deviceNode) deviceId = deviceNode.getAttribute('data-otdr-node');
    if (!deviceId || !deviceNode) return;
    stopRealTimeMode(deviceId);
    resetOtdrTraceAcquisitionState(deviceId, deviceNode);
    var d = findDevice(deviceId);
    readSetupSelectionsFromDevice(deviceNode);
    if (d) {
      d.connectionError = false;
      d.acquisitionActive = false;
      d.acquisitionComplete = false;
      d.traceEvents = null;
      d.runningTab = 'smartlink';
      resetTraceViewport(deviceId);
    }
    refreshPortOccupancy(deviceNode);
    if (!d || d.screen !== 'smart-test-running') {
      setDeviceScreen(deviceId, 'smart-test-running');
    } else {
      stopConnectionAnimation(deviceId);
      stopAcquisitionProgress(deviceId);
      hideErrorPopup(deviceNode);
      resetRunningViewportUI(deviceNode);
      applyRunningConnectionState(deviceId, deviceNode);
    }
    updateAcquisitionTimerUI(deviceNode);
    updateSidebarStartStopButton(deviceNode, true);
    setStatus('SMART TEST running · SmartLink · ' + (currentOtdrTestState.configFile || 'test'));
  }

  function startOtdrAcquisition(deviceId, deviceNode) {
    if (!deviceNode && deviceId) deviceNode = document.getElementById(deviceId);
    if (!deviceId && deviceNode) deviceId = deviceNode.getAttribute('data-otdr-node');
    if (!deviceId || !deviceNode) return;
    if (!devicePoweredOn(deviceId)) return;
    readSetupSelectionsFromDevice(deviceNode);
    syncActiveLaserToDevice(deviceId);
    if (!validateConnection(deviceId)) {
      if (findDevice(deviceId) && findDevice(deviceId).screen !== 'smart-test-running') {
        setDeviceScreen(deviceId, 'smart-test-running');
        deviceNode = layer ? layer.querySelector('[data-otdr-node="' + deviceId + '"]') : deviceNode;
      }
      abortOtdrTestFiberDisconnected(deviceId, deviceNode);
      return;
    }
    promptLiveTrafficContinue(deviceId, deviceNode, function () {
      beginStartOtdrAcquisition(deviceId, deviceNode);
    });
  }

  function resetTraceViewUI(deviceNode) {
    if (!deviceNode) return;
    resetTraceGraphLayout(deviceNode);
    switchRunningTab(deviceNode, 'smartlink');
    var trace = deviceNode.querySelector('.trace-view-container');
    if (trace) trace.hidden = true;
    var smartlink = deviceNode.querySelector('[data-running-panel="smartlink"]');
    if (smartlink) smartlink.hidden = false;
    var viewportBottom = deviceNode.querySelector('.viewport-bottom');
    if (viewportBottom) viewportBottom.hidden = false;
    var tbody = deviceNode.querySelector('.trace-event-tbody');
    if (tbody) tbody.innerHTML = '';
    var deviceId = deviceNode.getAttribute('data-otdr-node');
    var d = findDevice(deviceId);
    if (d) {
      d.acquisitionComplete = false;
      d.traceEvents = null;
      d.runningTab = 'smartlink';
      resetTraceViewport(deviceId);
    }
  }

  function resetAcquisitionUI(deviceNode) {
    if (!deviceNode) return;
    var fill = deviceNode.querySelector('.acq-progress-fill');
    var pctEl = deviceNode.querySelector('.acq-progress-pct');
    var timerLeft = deviceNode.querySelector('.acq-timer-left');
    if (fill) fill.style.width = '0%';
    if (pctEl) pctEl.textContent = '0%';
    if (timerLeft) timerLeft.textContent = '00:00';
    updateAcquisitionTimerUI(deviceNode);
  }

  function resetRunningViewportUI(deviceNode) {
    if (!deviceNode) return;
    var connInd = deviceNode.querySelector('.connection-indicator');
    var acqInd = deviceNode.querySelector('.acquisition-indicator');
    if (connInd) connInd.hidden = false;
    if (acqInd) acqInd.hidden = true;
    resetAcquisitionUI(deviceNode);
    resetTraceViewUI(deviceNode);
  }

  function showConnectionErrorState(deviceId, deviceNode) {
    var d = findDevice(deviceId);
    if (d) {
      d.connectionError = true;
      d.acquisitionActive = false;
    }
    stopConnectionAnimation(deviceId);
    stopConnectionValidationTimer(deviceId);
    stopAcquisitionProgress(deviceId);
    resetRunningViewportUI(deviceNode);
    showConnectionBadState(deviceNode);
    showErrorPopup(deviceNode);
    updateSidebarStartStopButton(deviceNode, false);
    setStatus('FO-1128 · Connection to test instrument is bad');
  }

  function showAcquisitionPhase(deviceId, deviceNode) {
    var d = findDevice(deviceId);
    if (d) {
      d.connectionError = false;
      d.acquisitionActive = true;
    }
    stopConnectionAnimation(deviceId);
    hideErrorPopup(deviceNode);
    var connInd = deviceNode.querySelector('.connection-indicator');
    var acqInd = deviceNode.querySelector('.acquisition-indicator');
    if (connInd) connInd.hidden = true;
    if (acqInd) acqInd.hidden = false;
    updateAcquisitionTimerUI(deviceNode);
    startAcquisitionProgress(deviceId, deviceNode);
    setStatus('SMART TEST · acquisition in progress');
  }

  function finishConnectionValidation(deviceId, deviceNode) {
    if (!deviceNode) return;
    refreshPortOccupancy(deviceNode);
    if (!isPigtailConnectedToPort(deviceId)) {
      showConnectionErrorState(deviceId, deviceNode);
      return;
    }
    if (hasLiveTraffic(deviceId)) {
      if (!liveTrafficAcknowledged[deviceId]) {
        applyLiveTrafficConnectionFailure(deviceId, deviceNode);
        return;
      }
      showConnectionLiveTrafficBadState(deviceNode);
      showSmartlinkLiveWarningPopup(deviceId, deviceNode);
      showAcquisitionPhase(deviceId, deviceNode);
      return;
    }
    showAcquisitionPhase(deviceId, deviceNode);
  }

  function stopConnectionValidationTimer(deviceId) {
    if (!connectionValidationTimers[deviceId]) return;
    clearTimeout(connectionValidationTimers[deviceId]);
    delete connectionValidationTimers[deviceId];
  }

  function scheduleConnectionValidation(deviceId, deviceNode) {
    stopConnectionValidationTimer(deviceId);
    connectionValidationTimers[deviceId] = setTimeout(function () {
      delete connectionValidationTimers[deviceId];
      finishConnectionValidation(deviceId, deviceNode);
    }, CONNECTION_VALIDATION_DELAY_MS);
  }

  function stopAcquisitionProgress(deviceId) {
    if (!acquisitionTimers[deviceId]) return;
    clearInterval(acquisitionTimers[deviceId]);
    delete acquisitionTimers[deviceId];
  }

  function startAcquisitionProgress(deviceId, deviceNode) {
    stopAcquisitionProgress(deviceId);
    if (!deviceNode) return;
    var fill = deviceNode.querySelector('.acq-progress-fill');
    var pctEl = deviceNode.querySelector('.acq-progress-pct');
    var timerLeft = deviceNode.querySelector('.acq-timer-left');
    if (!fill) return;
    resetAcquisitionUI(deviceNode);
    var started = Date.now();
    var durationMs = getAcquisitionDurationMs();
    var durationSec = currentOtdrTestState.durationSec || 20;
    acquisitionTimers[deviceId] = setInterval(function () {
      var elapsed = Date.now() - started;
      var pct = Math.min(100, (elapsed / durationMs) * 100);
      var elapsedSec = elapsed / 1000;
      fill.style.width = pct + '%';
      if (pctEl) pctEl.textContent = Math.round(pct) + '%';
      if (timerLeft) timerLeft.textContent = formatAcqTimer(elapsedSec, durationSec);
      if (pct >= 100) {
        fill.style.width = '100%';
        if (pctEl) pctEl.textContent = '100%';
        if (timerLeft) timerLeft.textContent = formatAcqTimer(durationSec, durationSec);
        stopAcquisitionProgress(deviceId);
        finishAcquisitionAndShowTrace(deviceId, deviceNode);
      }
    }, 120);
  }

  function showErrorPopup(deviceNode) {
    var popup = deviceNode && deviceNode.querySelector('.otdr-error-popup');
    if (popup) popup.hidden = false;
  }

  function hideErrorPopup(deviceNode) {
    var popup = deviceNode && deviceNode.querySelector('.otdr-error-popup');
    if (popup) popup.hidden = true;
  }

  function getSmartLinkLaserLabel() {
    var wl = parseOtdrWavelengthNm() || 1550;
    return String(wl) + ' nm (10ns)';
  }

  function formatSmartLinkDistanceM(sectionM) {
    if (sectionM == null || !isFinite(sectionM)) return '—';
    var m = Math.max(0, Number(sectionM));
    if (m < 100) return m.toFixed(2) + ' m';
    return m.toFixed(1) + ' m';
  }

  function getSmartLinkDisplayEvents(events) {
    if (!events || !events.length) return [];
    var displayEvents = events.slice();
    displayEvents.sort(function (a, b) {
      var ea = a.eventNum != null ? a.eventNum : (a._traversalSeq || 0);
      var eb = b.eventNum != null ? b.eventNum : (b._traversalSeq || 0);
      if (ea !== eb) return ea - eb;
      var pathCmp = compareBranchPaths(a.branchPath, b.branchPath);
      if (pathCmp !== 0) return pathCmp;
      var da = typeof a.distance === 'number' ? a.distance : 0;
      var db = typeof b.distance === 'number' ? b.distance : 0;
      if (da !== db) return da - db;
      return (a._traversalSeq || 0) - (b._traversalSeq || 0);
    });
    return displayEvents;
  }

  function getSmartLinkSchematicEvents(events) {
    return getSmartLinkDisplayEvents(events);
  }

  function formatSmartLinkSchematicDistance(distM) {
    if (distM == null || !isFinite(distM)) return '—';
    return Number(distM).toFixed(2);
  }

  function smartLinkEventDescription(ev) {
    if (!ev) return 'Event';
    if (ev.type === 'start') return 'Front Connector (Test Port)';
    if (ev.label === 'Coupler') return 'Coupler';
    if (ev.type === 'splice') return 'Fusion Splice';
    if (ev.type === 'bend') return 'Bend';
    if (ev.type === 'splitter') return ev.label || 'Splitter';
    if (ev.type === 'end' || ev.label === 'End of fiber') return 'End of fiber';
    if (ev.type === 'connector') return 'Connector (possible mechanical splice)';
    return ev.label || traceEventLabelFromType(ev.type);
  }

  function getSmartLinkFiberSegmentM(events, fiberIndex) {
    if (!events || fiberIndex < 1 || fiberIndex >= events.length) return 0;
    var ev = events[fiberIndex];
    if (typeof ev.sectionM === 'number' && isFinite(ev.sectionM)) return ev.sectionM;
    return Math.max(0, (ev.distance || 0) - (events[fiberIndex - 1].distance || 0));
  }

  function getSmartLinkFiberSegmentLossDb(events, fiberIndex) {
    if (!events || fiberIndex < 1 || fiberIndex >= events.length) return null;
    var ev = events[fiberIndex];
    var sectionKm = typeof ev.sectionKm === 'number' ? ev.sectionKm : getSmartLinkFiberSegmentM(events, fiberIndex) / 1000;
    var slope = typeof ev.sectionAtt === 'number' && isFinite(ev.sectionAtt) ? ev.sectionAtt : getViaviFiberSlopeDbKm();
    return roundTrace3(sectionKm * slope);
  }

  function isSmartLinkEventFailed(ev) {
    if (!ev) return false;
    if (ev._polishMismatch || ev._alarm) return true;
    if (currentOtdrTestState.alarmsEnabled && ev.loss != null && isFinite(ev.loss)) {
      if (ev.type === 'splice' || ev.type === 'bend') return ev.loss > 0.30;
      if (ev.type !== 'start') return ev.loss > 0.50;
    }
    if (currentOtdrTestState.alarmsEnabled && ev.reflect != null && isFinite(ev.reflect)) {
      return ev.reflect > -35.0;
    }
    return false;
  }

  function computeSmartLinkPassState(events) {
    var schematicEvents = getSmartLinkSchematicEvents(events);
    var i;
    for (i = 0; i < schematicEvents.length; i++) {
      if (isSmartLinkEventFailed(schematicEvents[i])) return false;
    }
    return schematicEvents.length > 0;
  }

  function smartLinkEventClassName(type, label) {
    if (type === 'splice') return 'sl-event--splice';
    if (type === 'bend') return 'sl-event--bend';
    if (type === 'splitter') return 'sl-event--splitter';
    if (type === 'end' || label === 'End of fiber') return 'sl-event--end';
    if (label === 'Coupler') return 'sl-event--coupler';
    return 'sl-event--connector';
  }

  function setSmartLinkViewportMode(deviceNode, mode) {
    if (!deviceNode) return;
    var view = deviceNode.querySelector('.smartlink-view');
    var bottom = deviceNode.querySelector('.viewport-bottom');
    if (view) view.classList.toggle('is-link-ready', mode === 'results');
    if (bottom) bottom.hidden = mode === 'results';
  }

  function renderSmartLinkView(deviceNode, opts) {
    if (!deviceNode) return;
    opts = opts || {};
    var deviceId = deviceNode.getAttribute('data-otdr-node');
    var d = deviceId ? findDevice(deviceId) : null;
    var events = opts.events || (d && d.traceEvents) || null;
    var schematic = deviceNode.querySelector('.smartlink-schematic');
    if (!schematic) return;

    if (!events || !events.length) {
      schematic.innerHTML = '<div class="smartlink-empty-state">Connect fiber and start the test to view the link schematic.</div>';
      if (d) d.smartLinkSelection = null;
      updateSmartLinkDetailPanel(deviceNode, [], { kind: 'event', index: 0 });
      setSmartLinkViewportMode(deviceNode, 'connection');
      return;
    }

    var schematicEvents = getSmartLinkDisplayEvents(events);
    if (!schematicEvents.length) {
      schematic.innerHTML = '<div class="smartlink-empty-state">No link events detected.</div>';
      setSmartLinkViewportMode(deviceNode, 'results');
      return;
    }

    if (d && !d.smartLinkSelection) {
      d.smartLinkSelection = { kind: 'event', index: 0 };
    }
    var selection = opts.selection || (d && d.smartLinkSelection) || { kind: 'event', index: 0 };

    var html = '<div class="sl-chain">';
    var i;
    for (i = 0; i < schematicEvents.length; i++) {
      var ev = schematicEvents[i];
      if (i > 0) {
        var segM = getSmartLinkFiberSegmentM(schematicEvents, i);
        var fiberActive = selection.kind === 'fiber' && selection.index === i;
        html +=
          '<div class="sl-fiber-section sl-fiber" data-sl-fiber-index="' + i + '" data-sl-kind="fiber">' +
          '<span class="sl-fiber-dist">' + formatSmartLinkSchematicDistance(segM) + '</span>' +
          '<div class="sl-fiber-line' + (fiberActive ? ' active' : '') + '"></div>' +
          '</div>';
      }
      var failed = isSmartLinkEventFailed(ev);
      var eventNum = ev.eventNum != null ? ev.eventNum : (i + 1);
      var eventActive = selection.kind === 'event' && selection.index === i;
      html +=
        '<div class="sl-event-wrapper" data-sl-event-index="' + i + '" data-sl-kind="event">' +
        '<div class="sl-event-num">' + eventNum + '</div>' +
        '<div class="sl-event-box sl-event ' + smartLinkEventClassName(ev.type, ev.label) +
        (failed ? ' is-failed' : ' is-passed') +
        (eventActive ? ' active' : '') + '">' +
        '<div class="sl-event-status ' + (failed ? 'sl-event-status--fail' : 'sl-event-status--pass') + '">' +
        (failed ? '✕' : '✓') + '</div>' +
        '<div class="sl-event-icon" aria-hidden="true">' +
        getSmartLinkEventIconHtml(ev.type, ev.label, failed, eventActive) +
        '</div></div>' +
        '<div class="sl-event-dist">' + formatSmartLinkSchematicDistance(ev.distance) + '</div>' +
        '</div>';
    }
    html += '<span class="sl-chain-unit">m</span></div>';
    schematic.innerHTML = html;
    setSmartLinkViewportMode(deviceNode, 'results');
    updateSmartLinkDetailPanel(deviceNode, events, selection);
  }

  function hideSmartLinkStatusPopup(deviceNode) {
    var popup = deviceNode && deviceNode.querySelector('.smartlink-status-popup');
    if (popup) popup.classList.add('hidden');
  }

  function showSmartLinkStatusPopup(deviceNode, opts) {
    if (!deviceNode) return;
    opts = opts || {};
    var popup = deviceNode.querySelector('.smartlink-status-popup');
    if (!popup) return;
    var passed = opts.pass !== false;
    var lengthM = typeof opts.lengthM === 'number' && isFinite(opts.lengthM) ? opts.lengthM : 0;
    var lossDb = typeof opts.lossDb === 'number' && isFinite(opts.lossDb) ? opts.lossDb : 0;
    var titleEl = popup.querySelector('.popup-title');
    var lengthEl = popup.querySelector('.popup-length');
    var lossEl = popup.querySelector('.popup-loss');
    popup.classList.remove('is-pass', 'is-fail');
    popup.classList.add(passed ? 'is-pass' : 'is-fail');
    if (titleEl) titleEl.textContent = passed ? 'Pass' : 'Fail';
    if (lengthEl) lengthEl.textContent = lengthM.toFixed(2);
    if (lossEl) lossEl.textContent = lossDb.toFixed(3);
    popup.classList.remove('hidden');
  }

  function applyRunningConnectionState(deviceId, deviceNode) {
    stopConnectionAnimation(deviceId);
    stopConnectionValidationTimer(deviceId);
    stopAcquisitionProgress(deviceId);
    if (!deviceNode) return;
    var d = findDevice(deviceId);
    hideErrorPopup(deviceNode);
    var boxesContainer = deviceNode.querySelector('.conn-boxes');
    if (boxesContainer) resetConnectionBoxes(boxesContainer);
    if (d && d.connectionError) {
      resetRunningViewportUI(deviceNode);
      showConnectionBadState(deviceNode);
      showErrorPopup(deviceNode);
      return;
    }
    if (d && d.acquisitionActive) {
      showAcquisitionPhase(deviceId, deviceNode);
      return;
    }
    if (d && d.acquisitionComplete) {
      hideErrorPopup(deviceNode);
      var connInd = deviceNode.querySelector('.connection-indicator');
      var acqInd = deviceNode.querySelector('.acquisition-indicator');
      if (connInd) connInd.hidden = true;
      if (acqInd) acqInd.hidden = true;
      var smartlink = deviceNode.querySelector('[data-running-panel="smartlink"]');
      if (smartlink) smartlink.hidden = true;
      var viewportBottom = deviceNode.querySelector('.viewport-bottom');
      if (viewportBottom) viewportBottom.hidden = true;
      var events = d.traceEvents || getDefaultTraceEvents();
      populateTraceEventTable(deviceNode, events);
      positionTraceLinearIcons(deviceNode, events);
      renderSmartLinkView(deviceNode, {
        events: events,
        totalLoss: d.traceTotalLoss,
        orl: d.traceOrl,
        lengthM: d.traceLengthM,
      });
      switchRunningTab(deviceNode, d.runningTab || 'trace');
      applyDefaultTraceSplitLayout(deviceNode);
      renderTraceForDevice(deviceId, deviceNode);
      updateSidebarStartStopButton(deviceNode, false);
      return;
    }
    resetRunningViewportUI(deviceNode);
    runConnectionCheckAnimation(deviceId, deviceNode);
  }

  function stopConnectionAnimation(deviceId) {
    if (!connectionAnimTimers[deviceId]) return;
    if (connectionAnimTimers[deviceId].timer) {
      clearInterval(connectionAnimTimers[deviceId].timer);
    }
    delete connectionAnimTimers[deviceId];
    stopConnectionValidationTimer(deviceId);
  }

  function paintConnectionBoxes(boxesContainer, boxes, upToIndex) {
    resetConnectionBoxes(boxesContainer);
    var colorClass = upToIndex >= CONNECTION_GREEN_FROM ? 'bg-green' : 'bg-orange';
    var i;
    for (i = 0; i <= upToIndex; i++) {
      if (boxes[i]) boxes[i].classList.add(colorClass);
    }
  }

  function runConnectionCheckAnimation(deviceId, deviceNode) {
    stopConnectionAnimation(deviceId);
    var root = deviceNode || (layer && layer.querySelector('[data-otdr-node="' + deviceId + '"]'));
    if (!root) return;
    var boxesContainer = root.querySelector('.conn-boxes');
    if (!boxesContainer) return;
    var boxes = boxesContainer.querySelectorAll('.conn-box');
    if (!boxes.length) return;

    resetConnectionBoxes(boxesContainer);
    if (hasLiveTraffic(deviceId)) {
      showConnectionLiveTrafficBadState(root);
      scheduleConnectionValidation(deviceId, root);
      return;
    }
    var index = 0;
    scheduleConnectionValidation(deviceId, root);

    function paintStep() {
      paintConnectionBoxes(boxesContainer, boxes, index);
      if (index >= boxes.length - 1) {
        if (connectionAnimTimers[deviceId] && connectionAnimTimers[deviceId].timer) {
          clearInterval(connectionAnimTimers[deviceId].timer);
          connectionAnimTimers[deviceId].timer = null;
        }
        return;
      }
      index += 1;
    }

    paintStep();
    var timer = setInterval(paintStep, CONNECTION_STEP_MS);
    connectionAnimTimers[deviceId] = { timer: timer };
  }

  function applyDeviceScreenClasses(screenEl, screenName) {
    screenEl.classList.remove('is-smart-test', 'is-smart-test-setup', 'is-smart-test-running');
    if (screenName === 'smart-test') screenEl.classList.add('is-smart-test');
    if (screenName === 'smart-test-setup') screenEl.classList.add('is-smart-test-setup');
    if (screenName === 'smart-test-running') screenEl.classList.add('is-smart-test-running');
  }

  function getSelectedConfigName(deviceNode) {
    var selected = deviceNode.querySelector('.st-list-item.selected');
    if (selected) return selected.textContent.trim();
    var first = deviceNode.querySelector('.st-list-item');
    return first ? first.textContent.trim() : 'CERTIFICATION_AutoTest_20s';
  }

  function updateSetupConfigLabel(deviceNode, name) {
    var label = deviceNode.querySelector('.sts-config-name');
    if (label) label.textContent = name;
  }

  function setDeviceScreen(deviceId, screenName, opts) {
    opts = opts || {};
    var d = findDevice(deviceId);
    if (!d) return;
    if ((screenName || 'home') !== 'smart-test-running') {
      stopRealTimeMode(deviceId);
      if (layer) {
        var prevNode = layer.querySelector('[data-otdr-node="' + deviceId + '"]');
        if (prevNode) hideTrafficDetectedPopup(deviceId, prevNode);
      }
    }
    d.screen = screenName || 'home';
    if (opts.selectedConfig) {
      d.selectedConfig = opts.selectedConfig;
      syncConfigToTestState(opts.selectedConfig);
    }
    if (opts.connectionError !== undefined) d.connectionError = !!opts.connectionError;
    if (!layer) return;
    var node = layer.querySelector('[data-otdr-node="' + deviceId + '"]');
    if (!node) return;
    var screen = node.querySelector('.otdr-screen');
    if (!screen) return;
    applyDeviceScreenClasses(screen, d.screen);
    if (d.screen === 'smart-test-setup' && d.selectedConfig) {
      updateSetupConfigLabel(node, d.selectedConfig);
      applyTestStateToSetupUI(node);
    }
    if (d.screen === 'smart-test-running') {
      applyRunningConnectionState(deviceId, node);
    } else {
      stopConnectionAnimation(deviceId);
      stopAcquisitionProgress(deviceId);
      d.connectionError = false;
      d.acquisitionActive = false;
      hideErrorPopup(node);
    }
  }

  var TOOLBOX_ICON_SVG =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">' +
    '<rect x="3" y="3" width="18" height="18" rx="2" ry="2" stroke="currentColor" fill="none" stroke-width="2"/>' +
    '<path d="M3 15h4l3-6 4 10 3-4h4" stroke="currentColor" fill="none" stroke-width="2" stroke-linejoin="round"/>' +
    '</svg>';

  function setStatus(msg) {
    if (global.FtthLab && typeof FtthLab.setStatus === 'function') {
      FtthLab.setStatus(msg);
    }
  }

  function clientToWorld(clientX, clientY) {
    if (global.FtthLab && typeof FtthLab.clientToWorld2d === 'function') {
      return FtthLab.clientToWorld2d(clientX, clientY);
    }
    return { x: 0, y: 0 };
  }

  function isOtdrLabPage() {
    return !!(document.body && document.body.classList.contains('otdr-lab-page'));
  }

  function buildPortLabelsMarkup() {
    return (
      '<div class="otdr-port-labels">' +
      '<span class="label-vfl">' +
      '<span class="label-vfl__warn" aria-hidden="true">⚠</span>' +
      '<span class="label-vfl__text">VFL</span>' +
      '</span>' +
      '<span class="label-apc">APC</span>' +
      '<span class="label-live">APC LIVE</span>' +
      '</div>'
    );
  }

  function getScreenClass(screen) {
    if (screen === 'smart-test') return ' is-smart-test';
    if (screen === 'smart-test-setup') return ' is-smart-test-setup';
    if (screen === 'smart-test-running') return ' is-smart-test-running';
    return '';
  }

  function buildDeviceMarkup(deviceId, selected, screen, selectedConfig) {
    var sel = selected ? ' is-selected' : '';
    var activeScreen = getScreenClass(screen);
    var configName = selectedConfig || 'CERTIFICATION_AutoTest_20s';
    return (
      '<div class="lab-otdr lab-otdr--fixed lab-otdr-device lab-workspace-item' + sel +
      '" id="' + deviceId + '" data-otdr-device="1" data-otdr-node="' + deviceId + '"' +
      ' data-otdr-id="' + deviceId + '" role="img" aria-label="VIAVI SmartOTDR">' +
      buildProtrudingPortsMarkup(deviceId) +
      '<div class="otdr-device-shell" data-otdr-drag="' + deviceId + '">' +
      '<div class="otdr-body">' +
      buildPortLabelsMarkup() +
      '<div class="otdr-brand-bar">' +
      '<span class="otdr-viavi-logo" aria-label="VIAVI">VIAVI</span>' +
      '<span class="otdr-model-name">SmartOTDR</span>' +
      '</div>' +
      '<div class="otdr-screen' + activeScreen + '" id="' + deviceId + '-display" role="region" aria-label="SmartOTDR touchscreen">' +
      buildOsHomeMarkup() +
      buildSmartTestAppMarkup() +
      buildSmartTestSetupMarkup(configName) +
      buildSmartTestRunningMarkup(deviceId) +
      buildTrafficDetectedPopupMarkup(deviceId) +
      '<div class="otdr-screen-power-off" hidden aria-hidden="true"></div>' +
      '</div>' +
      '<div class="otdr-controls" aria-label="Physical controls">' +
      '<div class="otdr-controls__row">' +
      '<div class="otdr-led-group" aria-label="Power indicators">' +
      '<span class="otdr-led"><span class="otdr-led__dot"></span>Charge</span>' +
      '<span class="otdr-led is-on"><span class="otdr-led__dot"></span>On</span>' +
      '</div>' +
      '<div class="otdr-btn-grid">' +
      '<button type="button" class="otdr-btn" data-otdr-btn="file">FILE</button>' +
      '<button type="button" class="otdr-btn" data-otdr-btn="setup">SETUP</button>' +
      '<button type="button" class="otdr-btn" data-otdr-btn="home">HOME</button>' +
      '<button type="button" class="otdr-btn" data-otdr-btn="cancel">CANCEL</button>' +
      '</div>' +
      '<nav class="otdr-dpad" aria-label="Navigation pad">' +
      '<div class="otdr-dpad__ring" aria-hidden="true"></div>' +
      '<button type="button" class="otdr-dpad__btn otdr-dpad__btn--up" data-otdr-dpad="up" aria-label="Up">▲</button>' +
      '<button type="button" class="otdr-dpad__btn otdr-dpad__btn--down" data-otdr-dpad="down" aria-label="Down">▼</button>' +
      '<button type="button" class="otdr-dpad__btn otdr-dpad__btn--left" data-otdr-dpad="left" aria-label="Left">◀</button>' +
      '<button type="button" class="otdr-dpad__btn otdr-dpad__btn--right" data-otdr-dpad="right" aria-label="Right">▶</button>' +
      '<button type="button" class="otdr-dpad__center" data-otdr-dpad="select" aria-label="Select"></button>' +
      '</nav>' +
      '<div class="otdr-controls__right">' +
      '<span class="otdr-led"><span class="otdr-led__dot"></span>Testing</span>' +
      '<button type="button" class="otdr-btn otdr-btn--start" data-otdr-btn="start-stop">START/STOP</button>' +
      '<button type="button" class="otdr-btn otdr-btn--results" data-otdr-btn="results">RESULTS</button>' +
      '<div class="otdr-power-section">' +
      '<button type="button" class="otdr-power-btn" data-otdr-btn="power" aria-label="Power on off">ON<br>OFF</button>' +
      '<span class="otdr-speaker" aria-hidden="true"></span>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>'
    );
  }

  function ensureLayer() {
    var mount = document.getElementById('lab-2d-mount');
    if (!mount) return null;
    layer = mount.querySelector('.lab-otdr-layer');
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'lab-otdr-layer';
      layer.setAttribute('data-lab-otdr-layer', '1');
      mount.appendChild(layer);
    }
    return layer;
  }

  function bindPortIsolation(host) {
    host.querySelectorAll('.protruding-port, .lab-otdr-port').forEach(function (port) {
      if (port.dataset.otdrPortIsoBound === '1') return;
      port.dataset.otdrPortIsoBound = '1';
      port.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        e.stopPropagation();
      }, true);
    });
  }

  function ensureTraceFloatingControls(graphArea) {
    if (!graphArea) return;
    var wrap = graphArea.querySelector('.trace-floating-controls');
    var canvas = graphArea.querySelector('canvas');
    if (wrap) return;
    wrap = document.createElement('div');
    wrap.className = 'trace-floating-controls';
    wrap.innerHTML =
      '<button type="button" class="zoom-in-btn" aria-label="Zoom in">+</button>' +
      '<button type="button" class="zoom-out-btn" aria-label="Zoom out">-</button>' +
      '<button type="button" class="cursor-a-btn" aria-label="Cursor A">A</button>';
    if (canvas) graphArea.insertBefore(wrap, canvas);
    else graphArea.appendChild(wrap);
  }

  function enforceTraceFloatingControlStyles(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('.trace-graph-area').forEach(function (graphArea) {
      ensureTraceFloatingControls(graphArea);
    });
  }

  function bindTraceFloatingControls(host) {
    host.querySelectorAll('.trace-graph-area').forEach(function (graphArea) {
      if (graphArea.dataset.otdrFloatBound === '1') return;
      graphArea.dataset.otdrFloatBound = '1';
      graphArea.addEventListener('click', function (e) {
        var zoomIn = e.target.closest('.zoom-in-btn');
        var zoomOut = e.target.closest('.zoom-out-btn');
        var cursorA = e.target.closest('.cursor-a-btn');
        if (!zoomIn && !zoomOut && !cursorA) return;
        e.stopPropagation();
        var deviceNode = graphArea.closest('[data-otdr-node]');
        if (!deviceNode) return;
        var deviceId = deviceNode.getAttribute('data-otdr-node');
        var vp = getTraceViewport(deviceId);
        var canvas = graphArea.querySelector('canvas');
        if (zoomIn) {
          traceCamera.scaleX *= TRACE_ZOOM_FACTOR_IN;
          traceCamera.scaleY *= TRACE_ZOOM_FACTOR_IN;
          traceCamera.scaleX = Math.max(TRACE_ZOOM_MIN, traceCamera.scaleX);
          traceCamera.scaleY = Math.max(TRACE_ZOOM_MIN, traceCamera.scaleY);
          clampTraceZoomInScales(canvas);
          if (canvas) scheduleTraceRedraw(canvas);
          else renderTraceForDevice(deviceId, deviceNode);
          return;
        }
        if (zoomOut) {
          traceCamera.scaleX *= TRACE_ZOOM_FACTOR_OUT;
          traceCamera.scaleY *= TRACE_ZOOM_FACTOR_OUT;
          traceCamera.scaleX = Math.max(TRACE_ZOOM_MIN, Math.min(TRACE_ZOOM_MAX, traceCamera.scaleX));
          traceCamera.scaleY = Math.max(TRACE_ZOOM_MIN, Math.min(TRACE_ZOOM_MAX, traceCamera.scaleY));
          if (canvas) scheduleTraceRedraw(canvas);
          else renderTraceForDevice(deviceId, deviceNode);
          return;
        }
        if (cursorA) {
          cycleTraceCursorView(deviceId, deviceNode, canvas, cursorA);
        }
      });
    });
  }

  function bindScreenNavigation(host) {
    host.querySelectorAll('.app-btn[data-app="smart-test"]').forEach(function (btn) {
      if (btn.dataset.otdrScreenBound === '1') return;
      btn.dataset.otdrScreenBound = '1';
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var deviceNode = btn.closest('[data-otdr-node]');
        if (!deviceNode) return;
        setDeviceScreen(deviceNode.getAttribute('data-otdr-node'), 'smart-test');
        setStatus('SMART TEST · select configuration file');
      });
    });

    host.querySelectorAll('[data-otdr-btn="home"]').forEach(function (btn) {
      if (btn.dataset.otdrScreenBound === '1') return;
      btn.dataset.otdrScreenBound = '1';
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var deviceNode = btn.closest('[data-otdr-node]');
        if (!deviceNode) return;
        var deviceId = deviceNode.getAttribute('data-otdr-node');
        if (!devicePoweredOn(deviceId)) return;
        setDeviceScreen(deviceId, 'home');
        setStatus('SmartOTDR home');
      });
    });

    host.querySelectorAll('[data-otdr-btn="start-stop"]').forEach(function (btn) {
      if (btn.dataset.otdrScreenBound === '1') return;
      btn.dataset.otdrScreenBound = '1';
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var deviceNode = btn.closest('[data-otdr-node]');
        if (!deviceNode) return;
        handlePhysicalStartStop(deviceNode.getAttribute('data-otdr-node'), deviceNode);
      });
    });

    host.querySelectorAll('[data-otdr-btn="power"]').forEach(function (btn) {
      if (btn.dataset.otdrScreenBound === '1') return;
      btn.dataset.otdrScreenBound = '1';
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var deviceNode = btn.closest('[data-otdr-node]');
        if (!deviceNode) return;
        toggleDevicePower(deviceNode.getAttribute('data-otdr-node'), deviceNode);
      });
    });

    host.querySelectorAll('.st-list-item').forEach(function (item) {
      if (item.dataset.otdrScreenBound === '1') return;
      item.dataset.otdrScreenBound = '1';
      item.addEventListener('click', function (e) {
        e.stopPropagation();
        var list = item.closest('.st-config-list');
        if (!list) return;
        list.querySelectorAll('.st-list-item').forEach(function (li) {
          li.classList.remove('selected');
        });
        item.classList.add('selected');
        syncConfigToTestState(item.textContent.trim());
      });
    });

    host.querySelectorAll('.st-btn-text').forEach(function (btn) {
      if (btn.dataset.otdrScreenBound === '1') return;
      btn.dataset.otdrScreenBound = '1';
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var deviceNode = btn.closest('[data-otdr-node]');
        if (!deviceNode) return;
        var deviceId = deviceNode.getAttribute('data-otdr-node');
        var configName = getSelectedConfigName(deviceNode);
        syncConfigToTestState(configName);
        setDeviceScreen(deviceId, 'smart-test-setup', { selectedConfig: configName });
        setStatus('SMART TEST setup · ' + configName);
      });
    });

    host.querySelectorAll('[data-sts-action="configs"]').forEach(function (btn) {
      if (btn.dataset.otdrScreenBound === '1') return;
      btn.dataset.otdrScreenBound = '1';
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var deviceNode = btn.closest('[data-otdr-node]');
        if (!deviceNode) return;
        setDeviceScreen(deviceNode.getAttribute('data-otdr-node'), 'smart-test');
        setStatus('SMART TEST · select configuration file');
      });
    });

    host.querySelectorAll('[data-sts-action="start-test"]').forEach(function (btn) {
      if (btn.dataset.otdrScreenBound === '1') return;
      btn.dataset.otdrScreenBound = '1';
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var deviceNode = btn.closest('[data-otdr-node]');
        if (!deviceNode) return;
        var deviceId = deviceNode.getAttribute('data-otdr-node');
        if (isRealTimeActive && realTimeDeviceId === deviceId) {
          commitRealTimeMeasurement(deviceId, deviceNode);
          return;
        }
        startOtdrAcquisition(deviceId, deviceNode);
      });
    });

    host.querySelectorAll('[data-sts-action="real-time"]').forEach(function (btn) {
      if (btn.dataset.otdrScreenBound === '1') return;
      btn.dataset.otdrScreenBound = '1';
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var deviceNode = btn.closest('[data-otdr-node]');
        if (!deviceNode) return;
        var deviceId = deviceNode.getAttribute('data-otdr-node');
        toggleRealTimeMode(deviceId, deviceNode);
      });
    });

    host.querySelectorAll('[data-sidebar-action="real-time"]').forEach(function (btn) {
      if (btn.dataset.otdrScreenBound === '1') return;
      btn.dataset.otdrScreenBound = '1';
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var deviceNode = btn.closest('[data-otdr-node]');
        if (!deviceNode) return;
        var deviceId = deviceNode.getAttribute('data-otdr-node');
        var d = findDevice(deviceId);
        if (!d || d.screen !== 'smart-test-running') {
          setDeviceScreen(deviceId, 'smart-test-running');
          deviceNode = layer ? layer.querySelector('[data-otdr-node="' + deviceId + '"]') : deviceNode;
        }
        toggleRealTimeMode(deviceId, deviceNode);
      });
    });

    host.querySelectorAll('.sidebar-btn-start').forEach(function (btn) {
      if (btn.dataset.otdrScreenBound === '1') return;
      btn.dataset.otdrScreenBound = '1';
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var deviceNode = btn.closest('[data-otdr-node]');
        if (!deviceNode) return;
        var deviceId = deviceNode.getAttribute('data-otdr-node');
        if (isRealTimeActive && realTimeDeviceId === deviceId) {
          commitRealTimeMeasurement(deviceId, deviceNode);
          return;
        }
        if (isOtdrTestInProgress(deviceId)) {
          stopOtdrAcquisition(deviceId, deviceNode);
          return;
        }
        resetRunningViewToSmartLink(deviceNode);
        startOtdrAcquisition(deviceId, deviceNode);
      });
    });

    host.querySelectorAll('.traffic-detected-popup__btn').forEach(function (btn) {
      if (btn.dataset.otdrScreenBound === '1') return;
      btn.dataset.otdrScreenBound = '1';
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var deviceNode = btn.closest('[data-otdr-node]');
        if (!deviceNode) return;
        var deviceId = deviceNode.getAttribute('data-otdr-node');
        handleTrafficDetectedChoice(deviceId, deviceNode, btn.getAttribute('data-traffic-choice'));
      });
    });

    host.querySelectorAll('.otdr-error-popup').forEach(function (popup) {
      if (popup.dataset.otdrScreenBound === '1') return;
      popup.dataset.otdrScreenBound = '1';
      popup.addEventListener('click', function (e) {
        e.stopPropagation();
        popup.hidden = true;
        restoreOtdrErrorDescVisibility(popup.closest('[data-otdr-node]'));
      });
    });

    host.querySelectorAll('.smartlink-live-warning-popup').forEach(function (popup) {
      if (popup.dataset.otdrScreenBound === '1') return;
      popup.dataset.otdrScreenBound = '1';
      popup.addEventListener('click', function (e) {
        e.stopPropagation();
        var deviceNode = popup.closest('[data-otdr-node]');
        if (!deviceNode) return;
        dismissSmartlinkLiveWarningPopup(deviceNode.getAttribute('data-otdr-node'), deviceNode);
      });
    });

    host.querySelectorAll('.smartlink-status-popup').forEach(function (popup) {
      if (popup.dataset.otdrScreenBound === '1') return;
      popup.dataset.otdrScreenBound = '1';
      popup.addEventListener('click', function (e) {
        e.stopPropagation();
        popup.classList.add('hidden');
      });
    });

    host.querySelectorAll('[data-sts-action="stop-test"]').forEach(function (btn) {
      if (btn.dataset.otdrScreenBound === '1') return;
      btn.dataset.otdrScreenBound = '1';
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var deviceNode = btn.closest('[data-otdr-node]');
        if (!deviceNode) return;
        var deviceId = deviceNode.getAttribute('data-otdr-node');
        stopOtdrAcquisition(deviceId, deviceNode);
        setDeviceScreen(deviceId, 'smart-test-setup');
        setStatus('SMART TEST setup');
      });
    });

    host.querySelectorAll('.tabs-left .tab[data-running-tab]').forEach(function (tab) {
      if (tab.dataset.otdrScreenBound === '1') return;
      tab.dataset.otdrScreenBound = '1';
      tab.addEventListener('click', function (e) {
        e.stopPropagation();
        var deviceNode = tab.closest('[data-otdr-node]');
        if (!deviceNode) return;
        var tabName = tab.getAttribute('data-running-tab');
        if (!tabName) return;
        switchRunningTab(deviceNode, tabName);
      });
    });

    bindTraceFloatingControls(host);
    bindTraceCanvasInteractions(host);
    bindTraceEventTableRows(host);
    bindTraceResizer(host);
    bindSmartLinkInteractions(host);

    host.querySelectorAll('.running-tabs-header .tab:not([data-running-tab])').forEach(function (tab) {
      if (tab.dataset.otdrScreenBound === '1') return;
      tab.dataset.otdrScreenBound = '1';
      tab.addEventListener('click', function (e) {
        e.stopPropagation();
        var header = tab.closest('.running-tabs-header');
        if (!header) return;
        header.querySelectorAll('.tab').forEach(function (t) {
          t.classList.remove('active');
        });
        tab.classList.add('active');
      });
    });

    host.querySelectorAll('.sts-row .sts-opt:not(.sts-opt--default)').forEach(function (opt) {
      if (opt.dataset.otdrScreenBound === '1') return;
      opt.dataset.otdrScreenBound = '1';
      opt.addEventListener('click', function (e) {
        e.stopPropagation();
        var row = opt.closest('.sts-row');
        if (!row) return;
        row.querySelectorAll('.sts-opt.is-active, .sts-opt.selected').forEach(function (activeOpt) {
          activeOpt.classList.remove('is-active', 'selected');
        });
        opt.classList.add('is-active', 'selected');
        syncSetupRowToTestState(row, opt);
        var deviceNode = opt.closest('[data-otdr-node]');
        if (!deviceNode) return;
        var deviceId = deviceNode.getAttribute('data-otdr-node');
        syncActiveLaserToDevice(deviceId);
        var rowKey = row.getAttribute('data-sts-row');
        if (rowKey === 'laser') {
          updateTraceUIFromTestState(deviceNode);
        }
        if (rowKey === 'distance' || rowKey === 'alarms') {
          var deviceId = deviceNode.getAttribute('data-otdr-node');
          var d = findDevice(deviceId);
          var events = (d && d.traceEvents) ? d.traceEvents : getDefaultTraceEvents();
          populateTraceEventTable(deviceNode, events);
          if (rowKey === 'distance') {
            var trace = deviceNode.querySelector('.trace-view-container');
            if (trace && !trace.hidden) {
              renderTraceForDevice(deviceId, deviceNode);
            }
          }
        }
      });
    });

    host.querySelectorAll('[data-sts-action="default"]').forEach(function (btn) {
      if (btn.dataset.otdrScreenBound === '1') return;
      btn.dataset.otdrScreenBound = '1';
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var deviceNode = btn.closest('[data-otdr-node]');
        if (!deviceNode) return;
        resetTestStateToDefaults();
        applyTestStateToSetupUI(deviceNode);
      });
    });

    enforceTraceFloatingControlStyles(host);
  }

  function bindLayerEvents(host) {
    bindPortIsolation(host);
    bindScreenNavigation(host);

    host.querySelectorAll('[data-otdr-node]').forEach(function (node) {
      node.addEventListener('click', function (e) {
        if (isOtdrPortTarget(e) || isOtdrControlTarget(e)) return;
        e.stopPropagation();
        selectOtdr(node.getAttribute('data-otdr-node'));
      });
    });

    host.querySelectorAll('[data-otdr-drag]').forEach(function (grip) {
      grip.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        if (isOtdrControlTarget(e) || isOtdrPortTarget(e)) return;
        e.preventDefault();
        e.stopPropagation();
        var id = grip.getAttribute('data-otdr-drag');
        var d = findDevice(id);
        if (!d) return;
        selectOtdr(id, { skipRebuild: true });
        var zoom = getZoom() || 1;
        var sx = e.clientX;
        var sy = e.clientY;
        var ox = d.x;
        var oy = d.y;
        var node = host.querySelector('[data-otdr-node="' + id + '"]');
        if (node) node.classList.add('is-dragging', 'is-selected');

        function onMove(ev) {
          d.x = Math.round(ox + (ev.clientX - sx) / zoom);
          d.y = Math.round(oy + (ev.clientY - sy) / zoom);
          if (node) {
            node.style.left = d.x + 'px';
            node.style.top = d.y + 'px';
          }
          if (global.FtthLab && typeof FtthLab.notifyLayoutChange === 'function') {
            FtthLab.notifyLayoutChange({ source: 'otdr', live: true, otdrId: id });
          }
        }

        function onUp() {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          if (node) node.classList.remove('is-dragging');
          rebuildLayer();
          pushHistory();
          updateInspector();
          if (global.FtthLab && typeof FtthLab.notifyLayoutChange === 'function') {
            FtthLab.notifyLayoutChange({ source: 'otdr', otdrId: id });
          }
        }

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });
    });
  }

  function rebuildLayer() {
    layer = ensureLayer();
    if (!layer) return;
    devices.forEach(function (d) {
      stopConnectionAnimation(d.id);
    });
    layer.innerHTML = '';
    devices.forEach(function (d) {
      var wrapper = document.createElement('div');
      var selected = selection.kind === 'otdr' && selection.id === d.id;
      wrapper.innerHTML = buildDeviceMarkup(d.id, selected, d.screen || 'home', d.selectedConfig);
      var el = wrapper.firstElementChild;
      if (!el) return;
      el.style.left = d.x + 'px';
      el.style.top = d.y + 'px';
      refreshPortOccupancy(el);
      layer.appendChild(el);
      if (d.screen === 'smart-test-running') {
        applyRunningConnectionState(d.id, el);
        updateSidebarStartStopButton(el, isOtdrTestInProgress(d.id));
      }
      if (d.screen === 'smart-test-setup') {
        if (d.selectedConfig) syncConfigToTestState(d.selectedConfig);
        applyTestStateToSetupUI(el);
      }
      applyDevicePowerUI(el, d.poweredOn !== false);
    });
    bindLayerEvents(layer);
  }

  function placeOTDR(x, y) {
    seq += 1;
    var device = {
      id: 'otdr-machine-' + seq,
      x: Math.round(x - DEVICE_NAT_W / 2),
      y: Math.round(y - DEVICE_NAT_H / 2),
      screen: 'home',
      poweredOn: true,
      activeLaser: activeLaser,
      activeOtdrPort: activeOtdrPort,
    };
    devices.push(device);
    selectOtdr(device.id);
    rebuildLayer();
    pushHistory();
    setStatus('SmartOTDR placed · APC / APC LIVE ports ready');
    return device;
  }

  function renderToolbox() {
    var host = global.FtthLab && typeof FtthLab.gateToolboxRender === 'function'
      ? FtthLab.gateToolboxRender('lab-otdr-tree', TOOL_ID)
      : document.getElementById('lab-otdr-tree');
    if (!host) return;
    host.innerHTML =
      '<div class="lab-toolbox" role="list">' +
      '<button type="button" class="lab-tool lab-tool--otdr' +
      (selectedTool === TOOL_ID ? ' is-selected' : '') +
      '" draggable="true" data-lab-tool="' + TOOL_ID + '" data-tool-type="' + TOOL_ID +
      '" data-lab-category="' + TOOL_CATEGORY + '" role="listitem">' +
      '<span class="lab-tool__mark lab-tool__mark--otdr" aria-hidden="true">' + TOOLBOX_ICON_SVG + '</span>' +
      '<span class="lab-tool__copy">' +
      '<strong>VIAVI SmartOTDR</strong>' +
      '<span>Drag onto workspace</span>' +
      '</span>' +
      '</button>' +
      '</div>';
    bindToolbox(host);
    if (global.FtthLab && typeof FtthLab.applyFtthLabToolboxIcons === 'function') {
      FtthLab.applyFtthLabToolboxIcons();
    }
  }

  function bindToolbox(host) {
    var btn = host.querySelector('[data-tool-type="' + TOOL_ID + '"]');
    if (!btn) return;

    btn.addEventListener('click', function () {
      if (global.FtthLab && typeof FtthLab.armDragOnlyToolboxTool === 'function') {
        FtthLab.armDragOnlyToolboxTool(TOOL_ID, 'SmartOTDR · drag onto workspace to place');
      } else if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
        FtthLab.claimToolboxTool(TOOL_ID);
      }
      selectedTool = TOOL_ID;
      renderToolbox();
      setStatus('SmartOTDR · drag onto workspace');
    });

    btn.addEventListener('dragstart', function (ev) {
      if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
        FtthLab.claimToolboxTool(TOOL_ID);
      }
      selectedTool = TOOL_ID;
      dragLib = { kind: TOOL_ID };
      if (global.FtthLab && FtthLab.beginDrag) {
        FtthLab.beginDrag({ kind: TOOL_ID });
      }
      try {
        ev.dataTransfer.setData('text/plain', 'lab:' + TOOL_ID);
        ev.dataTransfer.setData('text/lab-drag', TOOL_ID);
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
      if (!el || el.dataset.otdrDropBound === '1') return;
      el.dataset.otdrDropBound = '1';

      el.addEventListener('dragover', function (ev) {
        var active = global.FtthLab && FtthLab.getActiveDrag && FtthLab.getActiveDrag();
        if (!((dragLib && dragLib.kind === TOOL_ID) || (active && active.kind === TOOL_ID))) {
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
        if (kind !== TOOL_ID) return;
        ev.preventDefault();
        ev.stopPropagation();
        dragLib = null;
        if (global.FtthLab && FtthLab.endDrag) FtthLab.endDrag();
        var pt = clientToWorld(ev.clientX, ev.clientY);
        placeOTDR(pt.x, pt.y);
        selectedTool = null;
        renderToolbox();
      });

      el.addEventListener('click', function (ev) {
        if (selectedTool !== TOOL_ID) return;
        var active = global.FtthLab && FtthLab.getActiveToolboxTool && FtthLab.getActiveToolboxTool();
        if (active !== TOOL_ID) return;
        if (!isStagePlacementTarget(ev.target)) return;
        ev.stopPropagation();
        var pt = clientToWorld(ev.clientX, ev.clientY);
        placeOTDR(pt.x, pt.y);
        selectedTool = null;
        renderToolbox();
      }, true);
    });
  }

  function onToolboxClaim(payload) {
    var id = payload && payload.toolId;
    if (id === TOOL_ID) return;
    selectedTool = null;
    renderToolbox();
  }

  function deleteSelected() {
    if (selection.kind === 'otdr' && selection.id) {
      removeOtdr(selection.id);
      return true;
    }
    return false;
  }

  function clearSelection() {
    selection = { kind: 'none', id: null };
    selectedTool = null;
    renderToolbox();
    rebuildLayer();
    updateInspector();
  }

  function onLayoutChange(payload) {
    if (payload && payload.source === 'otdr' && payload.live) return;
    if (!layer) return;
    layer.querySelectorAll('[data-otdr-node]').forEach(function (node) {
      refreshPortOccupancy(node);
      var otdrId = node.getAttribute('data-otdr-node');
      if (otdrId) syncActiveOtdrPortForDevice(otdrId);
    });
    if (isRealTimeActive && realTimeDeviceId) {
      var rtNode = layer.querySelector('[data-otdr-node="' + realTimeDeviceId + '"]');
      if (rtNode) tickRealTimePreview(realTimeDeviceId, rtNode);
    }
  }

  function isOtdrPortId(portId) {
    if (!portId) return false;
    var id = String(portId);
    return id.indexOf('otdr') >= 0 ||
      id.indexOf('port-apc') >= 0 ||
      id.indexOf('port-vfl') >= 0;
  }

  function otdrDeviceIdFromPortId(portId) {
    if (!portId) return null;
    var match = String(portId).match(/^(otdr-machine-\d+)/);
    return match ? match[1] : null;
  }

  /** World coordinates for a SmartOTDR north-facing test port (APC / APC LIVE / VFL). */
  function getOtdrPortWorld(portId) {
    if (!portId) return null;
    var el = document.querySelector(
      '.lab-otdr-port[data-ols-port="' + portId + '"],' +
      '.lab-otdr-port[data-opm-port="' + portId + '"],' +
      '[data-otdr-port="' + portId + '"]'
    );
    if (!el) {
      var wrap = document.getElementById(portId);
      if (wrap) el = wrap.querySelector('.lab-otdr-port') || wrap;
    }
    if (el) {
      var olsNode = el.closest && el.closest('.lab-ols-port[data-ols-port]');
      if (olsNode || (el.classList && el.classList.contains('lab-ols-port'))) {
        var olsEl = olsNode || el;
        var block = olsEl.querySelector('.lab-ols__sc-block');
        var target = block || olsEl.querySelector('.lab-ols__adapter-slot, .lab-ols__sc-block') || olsEl;
        var rect = target.getBoundingClientRect();
        var cx = rect.left + rect.width / 2;
        var cy = block
          ? rect.top + Math.max(6, Math.min(12, rect.height * 0.3))
          : rect.top + Math.max(2, rect.height * 0.35);
        var pt = clientToWorld(cx, cy);
        return { x: pt.x, y: pt.y, rot: 180, deepSeat: true };
      }
      var bore = el.querySelector('.viavi__adapter-knurl, .lab-opm__adapter-knurl') || el;
      var rOpm = bore.getBoundingClientRect();
      var ptOpm = clientToWorld(rOpm.left + rOpm.width / 2, rOpm.top + rOpm.height * 0.35);
      return { x: ptOpm.x, y: ptOpm.y, rot: 180 };
    }
    var deviceId = otdrDeviceIdFromPortId(portId);
    var d = deviceId ? findDevice(deviceId) : null;
    if (!d) return null;
    var chassisW = DEVICE_NAT_W;
    var portKind = String(portId).split('-').pop();
    var localX = chassisW * 0.5;
    if (portId.indexOf('port-vfl') >= 0) localX = chassisW * 0.22;
    else if (portId.indexOf('port-apc-live') >= 0) localX = chassisW * 0.78;
    else if (portId.indexOf('port-apc') >= 0) localX = chassisW * 0.58;
    return {
      x: d.x + localX,
      y: d.y + Math.round(PORT_PROTRUDE * 0.35),
      rot: 180,
      deepSeat: true,
      estimated: true,
      portKind: portKind,
    };
  }

  function refreshOtdrPorts() {
    if (!layer) return;
    layer.querySelectorAll('[data-otdr-node]').forEach(function (node) {
      refreshPortOccupancy(node);
    });
  }

  function undo() {
    if (historyIndex <= 0) return false;
    historyIndex -= 1;
    historyLocked = true;
    applySnapshot(history[historyIndex]);
    historyLocked = false;
    setStatus('Undo · SmartOTDR');
    return true;
  }

  function redo() {
    if (historyIndex >= history.length - 1) return false;
    historyIndex += 1;
    historyLocked = true;
    applySnapshot(history[historyIndex]);
    historyLocked = false;
    setStatus('Redo · SmartOTDR');
    return true;
  }

  function mount(api) {
    if (!isOtdrLabPage()) return;
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
      FtthLab.refreshOtdrPorts = refreshOtdrPorts;
      FtthLab.getOtdrPortWorld = getOtdrPortWorld;
      FtthLab.isOtdrPortId = isOtdrPortId;
    }
  }

  /**
   * @param {{ mount?: HTMLElement, left?: number, top?: number }} [options]
   * @returns {HTMLElement|null}
   */
  function initOTDRMachine(options) {
    options = options || {};
    var x = typeof options.left === 'number' ? options.left + DEVICE_NAT_W / 2 : 320;
    var y = typeof options.top === 'number' ? options.top + DEVICE_NAT_H / 2 : 300;
    var device = placeOTDR(x, y);
    if (options.mount) {
      var el = document.getElementById(device.id);
      if (el && options.mount !== document.getElementById('lab-2d-mount')) {
        options.mount.appendChild(el);
      }
    }
    return document.getElementById(device.id);
  }

  var tool = {
    id: TOOL_ID,
    category: TOOL_CATEGORY,
    mount: mount,
    onLayoutChange: onLayoutChange,
    undo: undo,
    redo: redo,
    deleteSelected: deleteSelected,
    clearSelection: clearSelection,
    onToolboxClaim: onToolboxClaim,
    placeOTDR: placeOTDR,
    onLabConfigChanged: function (payload) {
      if (global.FtthLab && typeof FtthLab.handleToolboxConfigChange === 'function') {
        FtthLab.handleToolboxConfigChange(TOOL_ID, 'lab-otdr-tree', renderToolbox, payload && payload.config);
      } else {
        renderToolbox();
      }
    },
    exportProjectState: function () {
      return JSON.parse(JSON.stringify({ devices: devices, seq: seq, selection: selection }));
    },
    importProjectState: function (snap) {
      devices = (snap && snap.devices) ? JSON.parse(JSON.stringify(snap.devices)) : [];
      seq = (snap && snap.seq) || 0;
      selection = { kind: 'none', id: null };
      rebuildLayer();
      updateInspector();
      if (global.FtthLab && typeof FtthLab.notifyLayoutChange === 'function') {
        FtthLab.notifyLayoutChange({ source: 'otdr', otdrRestore: true });
      }
    },
    resetProjectState: function () {
      devices = [];
      seq = 0;
      selection = { kind: 'none', id: null };
      rebuildLayer();
      updateInspector();
    },
  };

  function tryRegister() {
    if (!isOtdrLabPage()) return false;
    if (global.FtthLab && typeof FtthLab.registerTool === 'function') {
      FtthLab.registerTool(TOOL_ID, tool);
      return true;
    }
    return false;
  }

  global.OTDRDevice = {
    init: initOTDRMachine,
    place: placeOTDR,
    getPortWorld: getOtdrPortWorld,
    isOtdrPortId: isOtdrPortId,
    drawOTDRTrace: drawOTDRTrace,
    renderTraceForDevice: renderTraceForDevice,
    computeLabOtdrTrace: computeLabOtdrTrace,
    getDefaultTraceEvents: getDefaultTraceEvents,
    startOtdrAcquisition: startOtdrAcquisition,
    stopOtdrAcquisition: stopOtdrAcquisition,
    runOtdrTest: runOtdrTest,
    getTestState: function () {
      return JSON.parse(JSON.stringify(currentOtdrTestState));
    },
    VIAVI_FIT: VIAVI_FIT,
    PORT_WIDTH: PORT_WIDTH,
    PORT_HEIGHT: PORT_HEIGHT,
    PORT_PROTRUDE: PORT_PROTRUDE,
    TOOL_ID: TOOL_ID,
  };
  global.initOTDRMachine = initOTDRMachine;
  global.startOtdrAcquisition = startOtdrAcquisition;
  global.stopOtdrAcquisition = stopOtdrAcquisition;
  global.runOtdrTest = runOtdrTest;

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
